package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"travel-api/config"
	"travel-api/database"
	"travel-api/middleware"
	"travel-api/models"

	"github.com/gin-gonic/gin"
)

func setupTestRouter(t *testing.T) (*gin.Engine, *database.DB, config.Config, func()) {
	gin.SetMode(gin.TestMode)
	tmpDir, err := os.MkdirTemp("", "travel-api-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}

	dbPath := filepath.Join(tmpDir, "test.sqlite")
	db, err := database.Open(dbPath)
	if err != nil {
		t.Fatalf("failed to open test db: %v", err)
	}

	cfg := config.Config{
		Port:         "4173",
		Host:         "127.0.0.1",
		DatabasePath: dbPath,
		CookieSecure: false,
		TrustProxy:   false,
		AmapAPIKey:   "test-amap-key",
		AmapWebKey:   "test-amap-web-key",
		Oidc: config.OidcConfig{
			Configured:   true,
			Issuer:       "https://dsm.example.com",
			ClientID:     "client-id",
			ClientSecret: "client-secret",
			RedirectURI:  "https://travel.example.com/api/auth/oidc/callback",
			AdminGroup:   "administrators",
			AdminUsers:   []string{"admin"},
		},
	}

	r := gin.New()
	rateLimiter := middleware.NewRateLimiter()

	authH := NewAuthHandler(db, cfg, rateLimiter)
	oidcH := NewOidcHandler(db, cfg)
	workH := NewWorkspaceHandler(db)
	codeH := NewAccessCodeHandler(db)
	walkH := NewWalkHandler(db, cfg)
	aiH := NewAiHandler(db)

	api := r.Group("/api")
	{
		api.GET("/auth/status", authH.Status)
		api.POST("/auth/login", authH.Login)
		api.POST("/auth/logout", authH.Logout)
		api.GET("/auth/oidc/start", oidcH.Start)
		api.GET("/auth/oidc/callback", oidcH.Callback)

		api.GET("/map-config", walkH.MapConfig)
		api.POST("/walk", walkH.Walk)

		authed := api.Group("", middleware.RequireAuth(db, cfg))
		{
			authed.GET("/workspace", workH.GetWorkspace)
			authed.PUT("/workspace", workH.SaveWorkspace)
			authed.PUT("/notepad", workH.UpdateNotepad)

			authed.GET("/access-codes", middleware.RequireAdmin(), codeH.List)
			authed.POST("/access-codes", middleware.RequireAdmin(), codeH.Create)
			authed.PATCH("/access-codes/:id", middleware.RequireAdmin(), codeH.Update)
			authed.DELETE("/access-codes/:id", middleware.RequireAdmin(), codeH.Delete)

			authed.GET("/ai/availability", aiH.Availability)
			authed.GET("/ai/settings", aiH.GetSettings)
			authed.PUT("/ai/settings", aiH.SaveSettings)
			authed.POST("/ai/test", aiH.Test)
			authed.POST("/ai/assist", aiH.Assist)
		}
	}

	cleanup := func() {
		_ = db.Close()
		_ = os.RemoveAll(tmpDir)
	}

	return r, db, cfg, cleanup
}

func createAdminCookie(t *testing.T, db *database.DB, cfg config.Config) *http.Cookie {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", "/", nil)
	if err := middleware.SetSessionCookie(c, db, "admin", "admin-user", cfg); err != nil {
		t.Fatalf("failed to set admin session cookie: %v", err)
	}
	cookies := w.Result().Cookies()
	for _, ck := range cookies {
		if ck.Name == middleware.SessionCookie {
			return ck
		}
	}
	t.Fatalf("session cookie not found in response")
	return nil
}

func createViewerCookie(t *testing.T, db *database.DB, cfg config.Config) *http.Cookie {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", "/", nil)
	if err := middleware.SetSessionCookie(c, db, "viewer", "viewer-user", cfg); err != nil {
		t.Fatalf("failed to set viewer session cookie: %v", err)
	}
	for _, ck := range w.Result().Cookies() {
		if ck.Name == middleware.SessionCookie {
			return ck
		}
	}
	t.Fatalf("session cookie not found")
	return nil
}

func TestAuthStatus(t *testing.T) {
	r, _, _, cleanup := setupTestRouter(t)
	defer cleanup()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/auth/status", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp models.AuthStatusResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}

	if !resp.Configured || resp.Authenticated || resp.Role != nil {
		t.Fatalf("unexpected status response: %+v", resp)
	}
}

func TestWorkspaceSaveAndGet(t *testing.T) {
	r, db, cfg, cleanup := setupTestRouter(t)
	defer cleanup()

	adminCookie := createAdminCookie(t, db, cfg)

	workspacePayload := map[string]interface{}{
		"version":      1,
		"activeTripId": "trip-tokyo",
		"trips": []map[string]interface{}{
			{
				"id":        "trip-tokyo",
				"title":     "東京五日遊",
				"country":   "日本",
				"startDate": "2026-12-01",
				"endDate":   "2026-12-05",
				"timeZone":  "Asia/Tokyo",
				"notepad":   "初始記事",
			},
		},
	}
	body, _ := json.Marshal(workspacePayload)

	// 1. Save workspace as admin
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("PUT", "/api/workspace", bytes.NewReader(body))
	req.AddCookie(adminCookie)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("save workspace failed: %d, body: %s", w.Code, w.Body.String())
	}

	// 2. Get workspace as admin
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("GET", "/api/workspace", nil)
	req.AddCookie(adminCookie)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("get workspace failed: %d, body: %s", w.Code, w.Body.String())
	}

	var fetched map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &fetched)
	if fetched["activeTripId"] != "trip-tokyo" {
		t.Fatalf("expected trip-tokyo, got %v", fetched["activeTripId"])
	}

	// 3. Save workspace as viewer should fail 403
	viewerCookie := createViewerCookie(t, db, cfg)
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("PUT", "/api/workspace", bytes.NewReader(body))
	req.AddCookie(viewerCookie)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for viewer, got %d", w.Code)
	}
}

func TestNotepadUpdate(t *testing.T) {
	r, db, cfg, cleanup := setupTestRouter(t)
	defer cleanup()

	adminCookie := createAdminCookie(t, db, cfg)

	// Seed workspace
	workspacePayload := map[string]interface{}{
		"version":      1,
		"activeTripId": "trip-1",
		"trips": []map[string]interface{}{
			{
				"id":      "trip-1",
				"title":   "首爾行",
				"notepad": "",
			},
		},
	}
	body, _ := json.Marshal(workspacePayload)
	req, _ := http.NewRequest("PUT", "/api/workspace", bytes.NewReader(body))
	req.AddCookie(adminCookie)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	// Update notepad as viewer
	viewerCookie := createViewerCookie(t, db, cfg)
	notepadBody, _ := json.Marshal(map[string]interface{}{
		"tripId":  "trip-1",
		"notepad": "明洞小吃清單",
	})
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("PUT", "/api/notepad", bytes.NewReader(notepadBody))
	req.AddCookie(viewerCookie)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 on notepad update, got %d: %s", w.Code, w.Body.String())
	}

	// Verify in workspace
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("GET", "/api/workspace", nil)
	req.AddCookie(viewerCookie)
	r.ServeHTTP(w, req)

	var fetched map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &fetched)
	trips := fetched["trips"].([]interface{})
	trip0 := trips[0].(map[string]interface{})
	if trip0["notepad"] != "明洞小吃清單" {
		t.Fatalf("expected notepad update, got %v", trip0["notepad"])
	}
}

func TestAccessCodeLifecycle(t *testing.T) {
	r, db, cfg, cleanup := setupTestRouter(t)
	defer cleanup()

	adminCookie := createAdminCookie(t, db, cfg)

	// Seed workspace
	workspacePayload := map[string]interface{}{
		"version":      1,
		"activeTripId": "trip-osaka",
		"trips": []map[string]interface{}{
			{
				"id":    "trip-osaka",
				"title": "大阪五日遊",
			},
		},
	}
	body, _ := json.Marshal(workspacePayload)
	req, _ := http.NewRequest("PUT", "/api/workspace", bytes.NewReader(body))
	req.AddCookie(adminCookie)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	// Create access code
	createBody, _ := json.Marshal(map[string]interface{}{
		"label":         "給朋友的碼",
		"tripIds":       []string{"trip-osaka"},
		"expiresInDays": 7,
	})
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("POST", "/api/access-codes", bytes.NewReader(createBody))
	req.AddCookie(adminCookie)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 for create access code, got %d: %s", w.Code, w.Body.String())
	}

	var createResp models.CreateAccessCodeResponse
	_ = json.Unmarshal(w.Body.Bytes(), &createResp)
	code := createResp.Code
	codeID := createResp.Access.ID

	if code == "" || codeID == "" {
		t.Fatalf("empty code or id in response: %+v", createResp)
	}

	// Test login with code
	loginBody, _ := json.Marshal(map[string]string{"code": code})
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("POST", "/api/auth/login", bytes.NewReader(loginBody))
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 on login, got %d: %s", w.Code, w.Body.String())
	}

	codeCookie := w.Result().Cookies()[0]

	// Access workspace with code cookie
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("GET", "/api/workspace", nil)
	req.AddCookie(codeCookie)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 on workspace get with code, got %d: %s", w.Code, w.Body.String())
	}

	// Revoke (Delete) access code
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("DELETE", "/api/access-codes/"+codeID, nil)
	req.AddCookie(adminCookie)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 on delete access code, got %d", w.Code)
	}

	// Session should now be revoked (unauthorized)
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("GET", "/api/workspace", nil)
	req.AddCookie(codeCookie)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 after code revocation, got %d", w.Code)
	}
}
