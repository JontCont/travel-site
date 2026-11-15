package handlers

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"net/http"

	"travel-api/config"
	"travel-api/database"
	"travel-api/middleware"
	"travel-api/models"

	"github.com/gin-gonic/gin"
)

type AuthHandler struct {
	db          *database.DB
	cfg         config.Config
	rateLimiter *middleware.RateLimiter
}

func NewAuthHandler(db *database.DB, cfg config.Config, rl *middleware.RateLimiter) *AuthHandler {
	return &AuthHandler{db: db, cfg: cfg, rateLimiter: rl}
}

func (h *AuthHandler) Status(c *gin.Context) {
	session := middleware.ResolveSession(c, h.db)
	var role *string
	if session != nil {
		role = &session.Role
	}
	c.JSON(http.StatusOK, models.AuthStatusResponse{
		Configured:    h.cfg.Oidc.Configured || h.cfg.AdminCode != "",
		Authenticated: session != nil,
		Role:          role,
	})
}

func (h *AuthHandler) Login(c *gin.Context) {
	if !h.cfg.Oidc.Configured && h.cfg.AdminCode == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "NAS 尚未設定 Synology 登入。"})
		return
	}

	addr := h.rateLimiter.ClientAddress(c, h.cfg)
	if h.rateLimiter.CheckBlocked(addr) {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "嘗試次數過多，請稍後再試。"})
		return
	}

	var req models.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "讀取登入請求失敗。"})
		return
	}

	code := req.Code
	if code == "" {
		h.rateLimiter.RecordFailure(addr)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "通行碼不正確。"})
		return
	}

	// 1. Check TRIP_ADMIN_CODE if configured
	if h.cfg.AdminCode != "" && subtle.ConstantTimeCompare([]byte(code), []byte(h.cfg.AdminCode)) == 1 {
		h.rateLimiter.RecordSuccess(addr)
		if err := middleware.SetSessionCookie(c, h.db, "admin", "admin", h.cfg); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "建立連線階段失敗。"})
			return
		}
		c.JSON(http.StatusOK, models.LoginResponse{
			Authenticated: true,
			Role:          "admin",
		})
		return
	}

	// 2. Check TRIP_VIEW_CODE if configured
	if h.cfg.ViewCode != "" && subtle.ConstantTimeCompare([]byte(code), []byte(h.cfg.ViewCode)) == 1 {
		h.rateLimiter.RecordSuccess(addr)
		if err := middleware.SetSessionCookie(c, h.db, "viewer", "viewer", h.cfg); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "建立連線階段失敗。"})
			return
		}
		c.JSON(http.StatusOK, models.LoginResponse{
			Authenticated: true,
			Role:          "viewer",
		})
		return
	}

	// 3. Check database access codes

	hSum := sha256.Sum256([]byte(code))
	codeHash := hex.EncodeToString(hSum[:])

	ac, err := h.db.GetAccessCodeByHash(codeHash)
	if err != nil || ac == nil {
		h.rateLimiter.RecordFailure(addr)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "通行碼不正確。"})
		return
	}

	now := c.Request.Context()
	_ = now
	nowMilli := timeNowMilli()
	if ac.ExpiresAt != nil && *ac.ExpiresAt <= nowMilli {
		_ = h.db.DeleteSessionsBySubject(ac.ID)
		c.JSON(http.StatusForbidden, gin.H{"error": "通行碼已到期，請向管理員索取新的通行碼。"})
		return
	}

	h.rateLimiter.RecordSuccess(addr)
	if err := middleware.SetSessionCookie(c, h.db, "code", ac.ID, h.cfg); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "建立連線階段失敗。"})
		return
	}

	c.JSON(http.StatusOK, models.LoginResponse{
		Authenticated: true,
		Role:          "code",
	})
}

func (h *AuthHandler) Logout(c *gin.Context) {
	middleware.ClearSessionCookie(c, h.db, h.cfg)
	c.JSON(http.StatusOK, models.LogoutResponse{
		Authenticated: false,
	})
}
