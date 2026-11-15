package handlers

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"travel-api/database"
	"travel-api/models"
	"travel-api/services/ai"

	"github.com/gin-gonic/gin"
)

type AiHandler struct {
	db *database.DB
}

func NewAiHandler(db *database.DB) *AiHandler {
	return &AiHandler{db: db}
}

func (h *AiHandler) summary() (*models.AiSettingsSummaryResponse, error) {
	view, encKey, err := h.db.GetAiSettings()
	if err != nil {
		return nil, err
	}
	secret, _ := h.db.GetAiSecret()
	ready := encKey != nil && *encKey != "" && ai.ReadSecretKey(secret) != ""

	return &models.AiSettingsSummaryResponse{
		Settings:  view,
		Ready:     ready,
		Providers: ai.ProviderOptions(),
	}, nil
}

func (h *AiHandler) loadRuntime() (*ai.ProviderRequest, int, string) {
	view, encKey, err := h.db.GetAiSettings()
	if err != nil || view == nil || encKey == nil || *encKey == "" {
		return nil, http.StatusServiceUnavailable, "尚未完成 AI 設定，請先儲存服務商、模型與 API Key。"
	}

	secret, err := h.db.GetAiSecret()
	if err != nil || ai.ReadSecretKey(secret) == "" {
		return nil, http.StatusServiceUnavailable, "尚未完成 AI 設定，請先儲存服務商、模型與 API Key。"
	}

	apiKey, err := ai.DecryptSecret(*encKey, secret)
	if err != nil {
		return nil, http.StatusInternalServerError, "無法解密已儲存的 API Key，請重新輸入 API Key。"
	}

	return &ai.ProviderRequest{
		Provider: view.Provider,
		BaseURL:  view.BaseURL,
		Model:    view.Model,
		APIKey:   apiKey,
	}, 0, ""
}

func (h *AiHandler) Availability(c *gin.Context) {
	sum, err := h.summary()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "讀取 AI 狀態失敗。"})
		return
	}
	c.JSON(http.StatusOK, models.AiAvailabilityResponse{Ready: sum.Ready})
}

func (h *AiHandler) GetSettings(c *gin.Context) {
	sessVal, exists := c.Get("session")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "請先登入。"})
		return
	}
	session := sessVal.(*models.SessionContext)
	if session.Role != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "只有管理員可以設定 AI。"})
		return
	}

	sum, err := h.summary()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "讀取 AI 設定失敗。"})
		return
	}
	c.JSON(http.StatusOK, sum)
}

func (h *AiHandler) SaveSettings(c *gin.Context) {
	sessVal, exists := c.Get("session")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "請先登入。"})
		return
	}
	session := sessVal.(*models.SessionContext)
	if session.Role != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "只有管理員可以設定 AI。"})
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4*1024)
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "AI 設定格式不正確。"})
		return
	}

	var req models.SaveAiSettingsRequest
	if err := json.Unmarshal(body, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "AI 設定格式不正確。"})
		return
	}

	if _, ok := ai.Catalog[req.Provider]; !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "請選擇支援的 AI 服務商。"})
		return
	}

	model := strings.TrimSpace(req.Model)
	if model == "" || len(model) > 120 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "模型名稱不可空白，且不可超過 120 字元。"})
		return
	}

	if req.ClearApiKey && req.ApiKey != nil && *req.ApiKey != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "不能同時清除並更新 API Key。"})
		return
	}

	normBaseURL, err := ai.NormalizeProviderBaseURL(req.Provider, req.BaseURL)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	secret, err := h.db.EnsureAiSecretKey()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "無法建立 AI 加密金鑰。"})
		return
	}

	existingView, existingEnc, _ := h.db.GetAiSettings()

	var encryptedKey *string
	if req.ClearApiKey {
		encryptedKey = nil
	} else if req.ApiKey != nil && strings.TrimSpace(*req.ApiKey) != "" {
		trimmedKey := strings.TrimSpace(*req.ApiKey)
		if len(trimmedKey) > 500 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "API Key 過長。"})
			return
		}
		enc, err := ai.EncryptSecret(trimmedKey, secret)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "加密 API Key 失敗。"})
			return
		}
		encryptedKey = &enc
	} else if existingEnc != nil && existingView != nil && existingView.Provider == req.Provider {
		encryptedKey = existingEnc
	} else {
		c.JSON(http.StatusBadRequest, gin.H{"error": "請輸入此服務商的 API Key；切換服務商時必須重新輸入。"})
		return
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	if err := h.db.SaveAiSettings(req.Provider, normBaseURL, model, encryptedKey, now); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "儲存 AI 設定失敗。"})
		return
	}

	sum, _ := h.summary()
	c.JSON(http.StatusOK, sum)
}

func (h *AiHandler) Test(c *gin.Context) {
	sessVal, exists := c.Get("session")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "請先登入。"})
		return
	}
	session := sessVal.(*models.SessionContext)
	if session.Role != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "只有管理員可以設定 AI。"})
		return
	}

	runtime, status, errMsg := h.loadRuntime()
	if status != 0 {
		c.JSON(status, gin.H{"error": errMsg})
		return
	}

	runtime.System = "你是連線測試程式，請只回覆 JSON 物件 {\"ok\": true}。"
	runtime.User = "ping"

	resp, err := ai.CallProvider(*runtime)
	if err != nil {
		replyAiError(c, err)
		return
	}

	if !strings.Contains(resp, "ok") {
		c.JSON(http.StatusBadGateway, gin.H{"error": "AI 測試回應不符合預期。"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *AiHandler) Assist(c *gin.Context) {
	sessVal, exists := c.Get("session")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "請先登入。"})
		return
	}
	session := sessVal.(*models.SessionContext)

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16*1024)
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "AI 請求格式不正確。"})
		return
	}

	var req models.AssistRequest
	if err := json.Unmarshal(body, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "AI 請求格式不正確。"})
		return
	}

	if session.Role != "admin" && req.Mode != "ask" {
		c.JSON(http.StatusForbidden, gin.H{"error": "此 AI 功能只限管理員使用。"})
		return
	}

	var tripData map[string]interface{}
	if req.Mode != "generate_itinerary" {
		if req.TripID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "請選擇旅程。"})
			return
		}

		if session.TripIDs != nil {
			allowed := false
			for _, tid := range session.TripIDs {
				if tid == req.TripID {
					allowed = true
					break
				}
			}
			if !allowed {
				c.JSON(http.StatusNotFound, gin.H{"error": "找不到指定旅程。"})
				return
			}
		}

		rawJSON, found, err := h.db.GetWorkspace()
		if err != nil || !found {
			c.JSON(http.StatusNotFound, gin.H{"error": "SQLite 尚未建立旅程資料。"})
			return
		}

		var root map[string]interface{}
		if err := json.Unmarshal([]byte(rawJSON), &root); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "SQLite 旅程資料不是有效 JSON。"})
			return
		}

		tripsRaw, ok := root["trips"].([]interface{})
		if !ok {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "SQLite 旅程資料格式不正確。"})
			return
		}

		for _, tr := range tripsRaw {
			if tmap, ok := tr.(map[string]interface{}); ok {
				if tmap["id"] == req.TripID {
					tripData = tmap
					break
				}
			}
		}

		if tripData == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "找不到指定旅程。"})
			return
		}

		if session.Role != "admin" {
			enabled, _ := tripData["aiAskEnabled"].(bool)
			if !enabled {
				c.JSON(http.StatusForbidden, gin.H{"error": "管理員尚未開放此旅程的 AI 助理。"})
				return
			}
		}
	} else {
		if req.Destination == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "請填寫目的地。"})
			return
		}
		dates, err := ai.ListDates(req.StartDate, req.EndDate)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if len(dates) > 31 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "行程最多 31 天。"})
			return
		}
		req.Dates = dates
	}

	runtime, status, errMsg := h.loadRuntime()
	if status != 0 {
		c.JSON(status, gin.H{"error": errMsg})
		return
	}

	result, err := ai.RunAiAssist(*runtime, req, tripData)
	if err != nil {
		replyAiError(c, err)
		return
	}

	c.JSON(http.StatusOK, result)
}

func replyAiError(c *gin.Context, err error) {
	if errors.Is(err, ai.ErrAiInput) {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if errors.Is(err, ai.ErrAiOutput) || errors.Is(err, ai.ErrAiProvider) {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": "AI 處理失敗，請稍後再試。"})
}
