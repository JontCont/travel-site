package handlers

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"travel-api/database"
	"travel-api/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

var uuidRegex = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

const (
	accessCodeTripLimit  = 100
	accessCodeLabelLimit = 60
	dayMilli             = 24 * 60 * 60 * 1000
)

var allowedExpiryDays = map[int]bool{7: true, 30: true, 90: true}

type AccessCodeHandler struct {
	db *database.DB
}

func NewAccessCodeHandler(db *database.DB) *AccessCodeHandler {
	return &AccessCodeHandler{db: db}
}

func (h *AccessCodeHandler) readKnownTripIDs() (map[string]bool, int, string) {
	rawJSON, found, err := h.db.GetWorkspace()
	if err != nil || !found {
		return nil, http.StatusNotFound, "SQLite 尚未建立旅程資料。"
	}

	var root map[string]interface{}
	if err := json.Unmarshal([]byte(rawJSON), &root); err != nil {
		return nil, http.StatusInternalServerError, "SQLite 旅程資料不是有效 JSON。"
	}

	tripsRaw, ok := root["trips"].([]interface{})
	if !ok {
		return nil, http.StatusInternalServerError, "SQLite 旅程資料格式不正確。"
	}

	known := make(map[string]bool)
	for _, tr := range tripsRaw {
		if tmap, ok := tr.(map[string]interface{}); ok {
			if tid, ok := tmap["id"].(string); ok && tid != "" {
				known[tid] = true
			}
		}
	}
	return known, 0, ""
}

func toSummary(ac models.AccessCode) models.AccessCodeSummary {
	var tripIDs []string
	_ = json.Unmarshal([]byte(ac.TripIDsJSON), &tripIDs)
	var expStr *string
	if ac.ExpiresAt != nil {
		s := formatISO(*ac.ExpiresAt)
		expStr = &s
	}
	return models.AccessCodeSummary{
		ID:        ac.ID,
		Label:     ac.Label,
		TripIDs:   tripIDs,
		CreatedAt: ac.CreatedAt,
		ExpiresAt: expStr,
	}
}

func (h *AccessCodeHandler) List(c *gin.Context) {
	list, err := h.db.ListAccessCodes()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "讀取通行碼失敗。"})
		return
	}

	summaries := make([]models.AccessCodeSummary, 0, len(list))
	for _, item := range list {
		summaries = append(summaries, toSummary(item))
	}

	c.JSON(http.StatusOK, models.AccessCodeListResponse{Codes: summaries})
}

func (h *AccessCodeHandler) Create(c *gin.Context) {
	var body struct {
		Label         string   `json:"label"`
		TripIDs       []string `json:"tripIds"`
		ExpiresInDays *int     `json:"expiresInDays"`
	}

	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "讀取通行碼請求失敗。"})
		return
	}

	label := strings.TrimSpace(body.Label)
	if label == "" || len([]rune(label)) > accessCodeLabelLimit {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("通行碼名稱需為 1 到 %d 個字。", accessCodeLabelLimit)})
		return
	}

	if len(body.TripIDs) == 0 || len(body.TripIDs) > accessCodeTripLimit {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("請指定 1 到 %d 個旅程。", accessCodeTripLimit)})
		return
	}

	dedupMap := make(map[string]bool)
	var dedupTripIDs []string
	for _, tid := range body.TripIDs {
		tid = strings.TrimSpace(tid)
		if tid == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("請指定 1 到 %d 個旅程。", accessCodeTripLimit)})
			return
		}
		if !dedupMap[tid] {
			dedupMap[tid] = true
			dedupTripIDs = append(dedupTripIDs, tid)
		}
	}

	if body.ExpiresInDays != nil && !allowedExpiryDays[*body.ExpiresInDays] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "到期時間只能是 7、30、90 天或永久。"})
		return
	}

	known, status, errMsg := h.readKnownTripIDs()
	if status != 0 {
		c.JSON(status, gin.H{"error": errMsg})
		return
	}

	for _, tid := range dedupTripIDs {
		if !known[tid] {
			c.JSON(http.StatusBadRequest, gin.H{"error": "指定的旅程不存在。"})
			return
		}
	}

	codeBytes := make([]byte, 18)
	if _, err := io.ReadFull(rand.Reader, codeBytes); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "產生通行碼失敗。"})
		return
	}
	rawCode := base64.RawURLEncoding.EncodeToString(codeBytes)
	codeHash := sha256Hex(rawCode)

	var expiresAt *int64
	if body.ExpiresInDays != nil {
		exp := time.Now().UnixMilli() + int64(*body.ExpiresInDays)*dayMilli
		expiresAt = &exp
	}

	tripIDsBytes, _ := json.Marshal(dedupTripIDs)
	ac := models.AccessCode{
		ID:          uuid.NewString(),
		Label:       label,
		CodeHash:    codeHash,
		TripIDsJSON: string(tripIDsBytes),
		CreatedAt:   time.Now().UTC().Format(time.RFC3339Nano),
		ExpiresAt:   expiresAt,
	}

	if err := h.db.CreateAccessCode(ac); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "儲存通行碼失敗。"})
		return
	}

	c.JSON(http.StatusCreated, models.CreateAccessCodeResponse{
		Code:   rawCode,
		Access: toSummary(ac),
	})
}

func (h *AccessCodeHandler) Update(c *gin.Context) {
	id := c.Param("id")
	if !uuidRegex.MatchString(id) {
		c.JSON(http.StatusNotFound, gin.H{"error": "找不到指定通行碼。"})
		return
	}

	var raw map[string]interface{}
	if err := c.ShouldBindJSON(&raw); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "讀取通行碼請求失敗。"})
		return
	}

	_, hasTripIDs := raw["tripIds"]
	_, hasExpiry := raw["expiresInDays"]
	if !hasTripIDs && !hasExpiry {
		c.JSON(http.StatusBadRequest, gin.H{"error": "請指定要更新的旅程或到期時間。"})
		return
	}

	existing, err := h.db.GetAccessCodeByID(id)
	if err != nil || existing == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "找不到指定通行碼。"})
		return
	}

	tripIDsJSON := existing.TripIDsJSON
	if hasTripIDs {
		tripIDsRaw, ok := raw["tripIds"].([]interface{})
		if !ok || len(tripIDsRaw) == 0 || len(tripIDsRaw) > accessCodeTripLimit {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("請指定 1 到 %d 個旅程。", accessCodeTripLimit)})
			return
		}
		dedupMap := make(map[string]bool)
		var dedup []string
		for _, item := range tripIDsRaw {
			s, ok := item.(string)
			if !ok || s == "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("請指定 1 到 %d 個旅程。", accessCodeTripLimit)})
				return
			}
			if !dedupMap[s] {
				dedupMap[s] = true
				dedup = append(dedup, s)
			}
		}

		known, status, errMsg := h.readKnownTripIDs()
		if status != 0 {
			c.JSON(status, gin.H{"error": errMsg})
			return
		}
		for _, tid := range dedup {
			if !known[tid] {
				c.JSON(http.StatusBadRequest, gin.H{"error": "指定的旅程不存在。"})
				return
			}
		}
		b, _ := json.Marshal(dedup)
		tripIDsJSON = string(b)
	}

	expiresAt := existing.ExpiresAt
	if hasExpiry {
		if raw["expiresInDays"] == nil {
			expiresAt = nil
		} else {
			expFloat, ok := raw["expiresInDays"].(float64)
			expInt := int(expFloat)
			if !ok || !allowedExpiryDays[expInt] {
				c.JSON(http.StatusBadRequest, gin.H{"error": "到期時間只能是 7、30、90 天或永久。"})
				return
			}
			val := time.Now().UnixMilli() + int64(expInt)*dayMilli
			expiresAt = &val
		}
	}

	updated, err := h.db.UpdateAccessCode(id, tripIDsJSON, expiresAt)
	if err != nil || !updated {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新通行碼失敗。"})
		return
	}

	latest, _ := h.db.GetAccessCodeByID(id)
	c.JSON(http.StatusOK, models.AccessCodeSingleResponse{Access: toSummary(*latest)})
}

func (h *AccessCodeHandler) Delete(c *gin.Context) {
	id := c.Param("id")
	if !uuidRegex.MatchString(id) {
		c.JSON(http.StatusNotFound, gin.H{"error": "找不到指定通行碼。"})
		return
	}

	deleted, err := h.db.DeleteAccessCode(id)
	if err != nil || !deleted {
		c.JSON(http.StatusNotFound, gin.H{"error": "找不到指定通行碼。"})
		return
	}

	_ = h.db.DeleteSessionsBySubject(id)
	c.JSON(http.StatusOK, models.SimpleDeletedResponse{Deleted: true})
}
