package middleware

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"travel-api/config"
	"travel-api/database"
	"travel-api/models"

	"github.com/gin-gonic/gin"
)

const SessionCookie = "trip_session"
const SessionDurationMonths = 6

func Sha256Hex(value string) string {
	h := sha256.Sum256([]byte(value))
	return hex.EncodeToString(h[:])
}

func AddCalendarMonths(t time.Time, months int) time.Time {
	return t.AddDate(0, months, 0)
}

func ResolveSession(c *gin.Context, db *database.DB) *models.SessionContext {
	token, err := c.Cookie(SessionCookie)
	if err != nil || token == "" {
		return nil
	}

	tokenHash := Sha256Hex(token)
	sess, err := db.GetSession(tokenHash)
	if err != nil || sess == nil {
		return nil
	}

	now := time.Now().UnixMilli()
	if sess.ExpiresAt <= now {
		_ = db.DeleteSession(tokenHash)
		return nil
	}

	if sess.Role != "code" {
		return &models.SessionContext{Role: sess.Role, TripIDs: nil}
	}

	codeRow, err := db.GetAccessCodeByID(sess.Subject)
	if err != nil || codeRow == nil {
		_ = db.DeleteSession(tokenHash)
		return nil
	}

	if codeRow.ExpiresAt != nil && *codeRow.ExpiresAt <= now {
		_ = db.DeleteSessionsBySubject(codeRow.ID)
		return nil
	}

	var tripIDs []string
	_ = json.Unmarshal([]byte(codeRow.TripIDsJSON), &tripIDs)
	return &models.SessionContext{Role: "code", TripIDs: tripIDs}
}

func SetSessionCookie(c *gin.Context, db *database.DB, role, subject string, cfg config.Config) error {
	now := time.Now()
	expires := AddCalendarMonths(now, SessionDurationMonths)
	expiresAt := expires.UnixMilli()
	_ = db.DeleteExpiredSessions(now.UnixMilli())

	buf := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, buf); err != nil {
		return err
	}
	token := base64.RawURLEncoding.EncodeToString(buf)
	tokenHash := Sha256Hex(token)

	if err := db.CreateSession(tokenHash, role, subject, expiresAt); err != nil {
		return err
	}

	maxAge := int(expires.Sub(now).Seconds())
	c.SetSameSite(http.SameSiteStrictMode)
	c.SetCookie(SessionCookie, token, maxAge, "/", "", cfg.CookieSecure, true)
	return nil
}

func ClearSessionCookie(c *gin.Context, db *database.DB, cfg config.Config) {
	token, err := c.Cookie(SessionCookie)
	if err == nil && token != "" {
		_ = db.DeleteSession(Sha256Hex(token))
	}
	c.SetSameSite(http.SameSiteStrictMode)
	c.SetCookie(SessionCookie, "", -1, "/", "", cfg.CookieSecure, true)
}

func RequireAuth(db *database.DB, cfg config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		session := ResolveSession(c, db)
		if session == nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "請先登入才能存取旅程資料。"})
			c.Abort()
			return
		}
		if !cfg.Oidc.Configured {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "NAS 尚未設定 Synology 登入。"})
			c.Abort()
			return
		}
		c.Set("session", session)
		c.Next()
	}
}

func RequireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		sessVal, exists := c.Get("session")
		if !exists {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "請先登入。"})
			c.Abort()
			return
		}
		session := sessVal.(*models.SessionContext)
		if session.Role != "admin" {
			c.JSON(http.StatusForbidden, gin.H{"error": "只有管理員可以執行此操作。"})
			c.Abort()
			return
		}
		c.Next()
	}
}
