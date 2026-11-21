package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"travel-api/config"
	"travel-api/database"
	"travel-api/handlers"
	"travel-api/middleware"

	"github.com/gin-gonic/gin"
)

func resolveStaticFile(distDir, reqPath string) (string, bool) {
	absDist, err := filepath.Abs(distDir)
	if err != nil {
		return filepath.Join(distDir, "index.html"), false
	}
	fallback := filepath.Join(absDist, "index.html")

	cleanRel := filepath.Clean(strings.TrimPrefix(reqPath, "/"))
	if cleanRel == "." || cleanRel == ".." || strings.HasPrefix(cleanRel, ".."+string(filepath.Separator)) {
		return fallback, false
	}

	absTarget, err := filepath.Abs(filepath.Join(absDist, cleanRel))
	if err != nil {
		return fallback, false
	}
	if !strings.HasPrefix(absTarget, absDist+string(filepath.Separator)) {
		return fallback, false
	}

	rel, err := filepath.Rel(absDist, absTarget)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return fallback, false
	}

	fi, err := os.Stat(absTarget)
	if err != nil || fi.IsDir() {
		return fallback, false
	}

	return absTarget, true
}

func findDistDir() string {
	candidates := []string{
		"../web/dist",
		"../../apps/web/dist",
		"apps/web/dist",
		"dist",
		"web/dist",
	}
	for _, c := range candidates {
		idx := filepath.Join(c, "index.html")
		if _, err := os.Stat(idx); err == nil {
			return filepath.Clean(c)
		}
	}
	return ""
}

func main() {
	log.SetOutput(os.Stdout)
	cfg := config.LoadConfig()

	if os.Getenv("NODE_ENV") == "production" || os.Getenv("GIN_MODE") == "release" {
		gin.SetMode(gin.ReleaseMode)
	}

	db, err := database.Open(cfg.DatabasePath)
	if err != nil {
		log.Fatalf("無法開啟 SQLite 資料庫: %v", err)
	}
	defer db.Close()

	r := gin.New()
	r.Use(gin.Recovery())

	rateLimiter := middleware.NewRateLimiter()

	authH := handlers.NewAuthHandler(db, cfg, rateLimiter)
	oidcH := handlers.NewOidcHandler(db, cfg)
	workH := handlers.NewWorkspaceHandler(db)
	codeH := handlers.NewAccessCodeHandler(db)
	walkH := handlers.NewWalkHandler(db, cfg)
	aiH := handlers.NewAiHandler(db)

	// API routes
	api := r.Group("/api")
	{
		// Auth endpoints
		api.GET("/auth/status", authH.Status)
		api.POST("/auth/login", authH.Login)
		api.POST("/auth/logout", authH.Logout)
		api.GET("/auth/oidc/start", oidcH.Start)
		api.GET("/auth/oidc/callback", oidcH.Callback)

		// Map & Walk
		api.GET("/map-config", walkH.MapConfig)
		api.POST("/walk", walkH.Walk)

		// Authenticated endpoints
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

	// SPA Static File Serving
	distDir := findDistDir()
	r.NoRoute(func(c *gin.Context) {
		reqPath := c.Request.URL.Path
		if strings.HasPrefix(reqPath, "/api/") {
			c.JSON(http.StatusNotFound, gin.H{"error": "找不到指定的 API。"})
			return
		}

		if distDir == "" {
			c.String(http.StatusServiceUnavailable, "前端尚未建置，找不到 dist/index.html；請先執行 pnpm build。")
			return
		}

		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Header("X-Robots-Tag", "noindex, nofollow")

		targetFile, isAsset := resolveStaticFile(distDir, reqPath)
		if !isAsset || strings.HasSuffix(targetFile, "index.html") {
			c.Header("Cache-Control", "no-cache")
		} else {
			c.Header("Cache-Control", "public, max-age=31536000, immutable")
		}
		c.File(targetFile)
	})

	addr := fmt.Sprintf("%s:%s", cfg.Host, cfg.Port)
	log.Printf("[INFO] Trip site Go backend listening on http://%s", addr)
	if err := r.Run(addr); err != nil {
		log.Fatalf("Server failed to run: %v", err)
	}
}
