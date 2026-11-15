package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"travel-api/config"
	"travel-api/database"
	"travel-api/middleware"
	"travel-api/models"

	"github.com/gin-gonic/gin"
)

var coordinateRegex = regexp.MustCompile(`^-?\d{1,3}(?:\.\d{1,6})?,-?\d{1,2}(?:\.\d{1,6})?$`)

type WalkHandler struct {
	db  *database.DB
	cfg config.Config
}

func NewWalkHandler(db *database.DB, cfg config.Config) *WalkHandler {
	return &WalkHandler{db: db, cfg: cfg}
}

func validCoordinate(val string) bool {
	if !coordinateRegex.MatchString(val) {
		return false
	}
	parts := strings.Split(val, ",")
	if len(parts) != 2 {
		return false
	}
	lng, err1 := strconv.ParseFloat(parts[0], 64)
	lat, err2 := strconv.ParseFloat(parts[1], 64)
	if err1 != nil || err2 != nil {
		return false
	}
	return lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90
}

func (h *WalkHandler) MapConfig(c *gin.Context) {
	session := middleware.ResolveSession(c, h.db)
	if session == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "請先登入才能存取地圖設定。"})
		return
	}
	c.JSON(http.StatusOK, models.MapConfigResponse{
		APIKey: h.cfg.AmapAPIKey,
	})
}

func (h *WalkHandler) Walk(c *gin.Context) {
	if h.cfg.AmapWebKey == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "尚未設定高德 Web 服務 Key。請在啟動網站前設定 AMAP_WEB_KEY。"})
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2048)
	bodyBytes, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "請求內容過長。"})
		return
	}

	var req models.WalkRequest
	if err := json.Unmarshal(bodyBytes, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "請求內容不是有效 JSON。"})
		return
	}

	if !validCoordinate(req.Origin) || !validCoordinate(req.Destination) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "請輸入有效的 GCJ-02 經度,緯度。"})
		return
	}

	targetURL := fmt.Sprintf("https://restapi.amap.com/v5/direction/walking?key=%s&origin=%s&destination=%s&show_fields=cost",
		url.QueryEscape(h.cfg.AmapWebKey), url.QueryEscape(req.Origin), url.QueryEscape(req.Destination))

	client := &http.Client{Timeout: 12 * time.Second}
	resp, err := client.Get(targetURL)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("路線查詢失敗：%s", err.Error())})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("高德服務回應 HTTP %d。", resp.StatusCode)})
		return
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "讀取高德回應失敗。"})
		return
	}

	var payload struct {
		Status string `json:"status"`
		Info   string `json:"info"`
		Route  struct {
			Paths []struct {
				Distance string `json:"distance"`
				Cost     struct {
					Duration string `json:"duration"`
				} `json:"cost"`
			} `json:"paths"`
		} `json:"route"`
	}

	if err := json.Unmarshal(respBody, &payload); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "解析高德回應失敗。"})
		return
	}

	if payload.Status != "1" {
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("高德路線查詢失敗：%s", payload.Info)})
		return
	}

	if len(payload.Route.Paths) == 0 {
		c.JSON(http.StatusBadGateway, gin.H{"error": "高德未回傳完整步行距離與時間，無法確認是否符合限制。"})
		return
	}

	path := payload.Route.Paths[0]
	if path.Cost.Duration == "" {
		c.JSON(http.StatusBadGateway, gin.H{"error": "高德未回傳完整步行距離與時間，無法確認是否符合限制。"})
		return
	}

	meters, err1 := strconv.ParseFloat(path.Distance, 64)
	seconds, err2 := strconv.ParseFloat(path.Cost.Duration, 64)
	if err1 != nil || err2 != nil || meters < 0 || seconds < 0 {
		c.JSON(http.StatusBadGateway, gin.H{"error": "高德未回傳完整步行距離與時間，無法確認是否符合限制。"})
		return
	}

	minutes := int(math.Ceil(seconds / 60.0))
	c.JSON(http.StatusOK, models.WalkResponse{
		Meters:  meters,
		Minutes: minutes,
	})
}
