package handlers

import (
	"fmt"
	"net/http"
	"time"

	"travel-api/config"
	"travel-api/database"
	"travel-api/middleware"
	"travel-api/services/oidc"

	"github.com/gin-gonic/gin"
)

const loginCompleteHTML = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="refresh" content="0;url=/"><title>登入完成</title></head><body><p>登入完成，正在返回旅程網站。</p></body></html>`
const oidcTransactionDuration = 10 * time.Minute

type OidcHandler struct {
	db  *database.DB
	cfg config.Config
}

func NewOidcHandler(db *database.DB, cfg config.Config) *OidcHandler {
	return &OidcHandler{db: db, cfg: cfg}
}

func (h *OidcHandler) Start(c *gin.Context) {
	if !h.cfg.Oidc.Configured {
		c.Redirect(http.StatusFound, "/?auth_error=oidc_unavailable")
		return
	}

	disc, err := oidc.Discover(h.cfg.Oidc)
	if err != nil {
		c.Redirect(http.StatusFound, fmt.Sprintf("/?auth_error=%s", oidc.ErrorCode(err)))
		return
	}

	req, err := oidc.CreateAuthorizationRequest(h.cfg.Oidc, disc)
	if err != nil {
		c.Redirect(http.StatusFound, "/?auth_error=oidc_unavailable")
		return
	}

	now := time.Now()
	_ = h.db.DeleteExpiredOidcTransactions(now.UnixMilli())
	stateHash := sha256Hex(req.State)
	expiresAt := now.Add(oidcTransactionDuration).UnixMilli()

	if err := h.db.SaveOidcTransaction(stateHash, req.Nonce, req.CodeVerifier, expiresAt); err != nil {
		c.Redirect(http.StatusFound, "/?auth_error=oidc_unavailable")
		return
	}

	c.Redirect(http.StatusFound, req.URL)
}

func (h *OidcHandler) Callback(c *gin.Context) {
	if c.Query("error") != "" {
		c.Redirect(http.StatusFound, "/?auth_error=oidc_denied")
		return
	}

	state := c.Query("state")
	code := c.Query("code")

	_ = h.db.DeleteExpiredOidcTransactions(time.Now().UnixMilli())

	if state == "" {
		c.Redirect(http.StatusFound, "/?auth_error=oidc_state")
		return
	}

	stateHash := sha256Hex(state)
	nonce, codeVerifier, found, err := h.db.GetAndDeleteOidcTransaction(stateHash)
	if err != nil || !found {
		c.Redirect(http.StatusFound, "/?auth_error=oidc_state")
		return
	}

	if code == "" {
		c.Redirect(http.StatusFound, "/?auth_error=oidc_token")
		return
	}

	if !h.cfg.Oidc.Configured {
		c.Redirect(http.StatusFound, "/?auth_error=oidc_unavailable")
		return
	}

	disc, err := oidc.Discover(h.cfg.Oidc)
	if err != nil {
		c.Redirect(http.StatusFound, fmt.Sprintf("/?auth_error=%s", oidc.ErrorCode(err)))
		return
	}

	tokens, err := oidc.ExchangeAuthorizationCode(h.cfg.Oidc, disc, code, codeVerifier)
	if err != nil {
		c.Redirect(http.StatusFound, fmt.Sprintf("/?auth_error=%s", oidc.ErrorCode(err)))
		return
	}

	identity, err := oidc.ResolveIdentity(h.cfg.Oidc, disc, tokens, nonce)
	if err != nil {
		c.Redirect(http.StatusFound, fmt.Sprintf("/?auth_error=%s", oidc.ErrorCode(err)))
		return
	}

	role := oidc.RoleFor(identity, h.cfg.Oidc)
	if err := middleware.SetSessionCookie(c, h.db, role, identity.Subject, h.cfg); err != nil {
		c.Redirect(http.StatusFound, "/?auth_error=oidc_unavailable")
		return
	}

	c.Header("Content-Type", "text/html; charset=utf-8")
	c.Header("Cache-Control", "no-store")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("X-Content-Type-Options", "nosniff")
	c.String(http.StatusOK, loginCompleteHTML)
}
