package handlers

import (
	"encoding/json"
	"io"
	"net/http"

	"travel-api/database"
	"travel-api/models"

	"github.com/gin-gonic/gin"
)

type WorkspaceHandler struct {
	db *database.DB
}

func NewWorkspaceHandler(db *database.DB) *WorkspaceHandler {
	return &WorkspaceHandler{db: db}
}

func (h *WorkspaceHandler) GetWorkspace(c *gin.Context) {
	sessVal, exists := c.Get("session")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "請先登入才能存取旅程資料。"})
		return
	}
	session := sessVal.(*models.SessionContext)

	rawJSON, found, err := h.db.GetWorkspace()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "讀取 SQLite 旅程資料失敗。"})
		return
	}
	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "SQLite 尚未建立旅程資料。"})
		return
	}

	var root map[string]interface{}
	if err := json.Unmarshal([]byte(rawJSON), &root); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "SQLite 旅程資料格式不正確。"})
		return
	}

	tripsRaw, ok := root["trips"].([]interface{})
	if !ok || len(tripsRaw) == 0 {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "SQLite 旅程資料格式不正確。"})
		return
	}

	if session.TripIDs != nil {
		var filtered []interface{}
		for _, tr := range tripsRaw {
			if tmap, ok := tr.(map[string]interface{}); ok {
				tid, _ := tmap["id"].(string)
				for _, aid := range session.TripIDs {
					if aid == tid {
						filtered = append(filtered, tmap)
						break
					}
				}
			}
		}

		if len(filtered) == 0 {
			c.JSON(http.StatusForbidden, gin.H{"error": "此通行碼尚未指派可查看的旅程。"})
			return
		}

		root["trips"] = filtered
		activeID, _ := root["activeTripId"].(string)
		hasActive := false
		for _, tr := range filtered {
			if tmap, ok := tr.(map[string]interface{}); ok {
				if tmap["id"] == activeID {
					hasActive = true
					break
				}
			}
		}
		if !hasActive {
			if first, ok := filtered[0].(map[string]interface{}); ok {
				root["activeTripId"] = first["id"]
			}
		}
	}

	c.JSON(http.StatusOK, root)
}

func (h *WorkspaceHandler) SaveWorkspace(c *gin.Context) {
	sessVal, exists := c.Get("session")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "請先登入。"})
		return
	}
	session := sessVal.(*models.SessionContext)
	if session.Role != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "目前帳號只有查看權限。"})
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 10*1024*1024)
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "旅程資料超過 10 MB。"})
		return
	}

	var root map[string]interface{}
	if err := json.Unmarshal(body, &root); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "請求內容不是有效 JSON。"})
		return
	}

	activeTripID, ok := root["activeTripId"].(string)
	if !ok || activeTripID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "旅程資料格式不正確，未寫入 SQLite。"})
		return
	}

	tripsRaw, ok := root["trips"].([]interface{})
	if !ok || len(tripsRaw) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "旅程資料格式不正確，未寫入 SQLite。"})
		return
	}

	activeFound := false
	for _, tr := range tripsRaw {
		tmap, ok := tr.(map[string]interface{})
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "旅程資料格式不正確，未寫入 SQLite。"})
			return
		}
		tid, _ := tmap["id"].(string)
		if tid == activeTripID {
			activeFound = true
		}
	}
	if !activeFound {
		c.JSON(http.StatusBadRequest, gin.H{"error": "旅程資料格式不正確，未寫入 SQLite。"})
		return
	}

	if err := h.db.SaveWorkspace(string(body)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "寫入 SQLite 失敗。"})
		return
	}

	c.JSON(http.StatusOK, models.SimpleSavedResponse{Saved: true})
}

func (h *WorkspaceHandler) UpdateNotepad(c *gin.Context) {
	sessVal, exists := c.Get("session")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "請先登入才能存取旅程資料。"})
		return
	}
	session := sessVal.(*models.SessionContext)

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 100*1024)
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "讀取記事本請求失敗。"})
		return
	}

	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "記事本請求格式不正確；只接受旅程 ID 與記事內容。"})
		return
	}

	if len(raw) != 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "記事本請求格式不正確；只接受旅程 ID 與記事內容。"})
		return
	}

	tripID, ok1 := raw["tripId"].(string)
	notepad, ok2 := raw["notepad"].(string)
	if !ok1 || tripID == "" || !ok2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "記事本請求格式不正確；只接受旅程 ID 與記事內容。"})
		return
	}

	if err := h.db.UpdateNotepad(tripID, notepad, session.TripIDs); err != nil {
		msg := err.Error()
		if msg == "SQLite 尚未建立旅程資料。" || msg == "找不到指定旅程；記事本未修改。" {
			c.JSON(http.StatusNotFound, gin.H{"error": msg})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": msg})
		return
	}

	c.JSON(http.StatusOK, models.SimpleSavedResponse{Saved: true})
}
