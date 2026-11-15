package config

import (
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

type OidcConfig struct {
	Configured   bool
	Issuer       string
	ClientID     string
	ClientSecret string
	RedirectURI  string
	AdminGroup   string
	AdminUsers   []string
}

type Config struct {
	Port         string
	Host         string
	DatabasePath string
	CookieSecure bool
	TrustProxy   bool
	AmapAPIKey   string
	AmapWebKey   string
	AdminCode    string
	ViewCode     string
	Oidc         OidcConfig
}

func isHTTPS(rawURL string) bool {
	u, err := url.Parse(rawURL)
	return err == nil && u.Scheme == "https"
}

func normalizeIssuer(value string) string {
	return strings.TrimRight(strings.TrimSpace(value), "/")
}

func LoadOidcConfig() OidcConfig {
	issuer := normalizeIssuer(os.Getenv("TRIP_OIDC_ISSUER"))
	clientID := strings.TrimSpace(os.Getenv("TRIP_OIDC_CLIENT_ID"))
	clientSecret := strings.TrimSpace(os.Getenv("TRIP_OIDC_CLIENT_SECRET"))
	redirectURI := strings.TrimSpace(os.Getenv("TRIP_OIDC_REDIRECT_URI"))

	configured := clientID != "" && clientSecret != "" && isHTTPS(issuer) && isHTTPS(redirectURI)

	adminGroup := strings.ToLower(strings.TrimSpace(os.Getenv("TRIP_OIDC_ADMIN_GROUP")))
	if adminGroup == "" {
		adminGroup = "administrators"
	}

	rawUsers := os.Getenv("TRIP_OIDC_ADMIN_USERS")
	var adminUsers []string
	for _, u := range strings.Split(rawUsers, ",") {
		u = strings.ToLower(strings.TrimSpace(u))
		if u != "" {
			adminUsers = append(adminUsers, u)
		}
	}

	return OidcConfig{
		Configured:   configured,
		Issuer:       issuer,
		ClientID:     clientID,
		ClientSecret: clientSecret,
		RedirectURI:  redirectURI,
		AdminGroup:   adminGroup,
		AdminUsers:   adminUsers,
	}
}

func LoadConfig() Config {
	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = "4187"
	}

	host := strings.TrimSpace(os.Getenv("TRIP_HOST"))
	if host == "" {
		host = "127.0.0.1"
	}

	dbPath := strings.TrimSpace(os.Getenv("TRIP_DATABASE_PATH"))
	if dbPath == "" {
		// Priority: database/trips.sqlite, then fallback data/trips.sqlite
		candidates := []string{
			"database/trips.sqlite",
			"../../database/trips.sqlite",
			"data/trips.sqlite",
			"../../data/trips.sqlite",
		}
		found := false
		for _, c := range candidates {
			if _, err := os.Stat(c); err == nil {
				dbPath = c
				found = true
				break
			}
		}
		if !found {
			dbPath = "database/trips.sqlite"
		}
	}

	cookieSecure := os.Getenv("TRIP_COOKIE_SECURE") == "1" ||
		(os.Getenv("TRIP_COOKIE_SECURE") == "" && (os.Getenv("NODE_ENV") == "production" || os.Getenv("GIN_MODE") == "release"))

	trustProxy := os.Getenv("TRIP_TRUST_PROXY") == "1"

	return Config{
		Port:         port,
		Host:         host,
		DatabasePath: filepath.Clean(dbPath),
		CookieSecure: cookieSecure,
		TrustProxy:   trustProxy,
		AmapAPIKey:   strings.TrimSpace(os.Getenv("AMAP_API_KEY")),
		AmapWebKey:   strings.TrimSpace(os.Getenv("AMAP_WEB_KEY")),
		AdminCode:    strings.TrimSpace(os.Getenv("TRIP_ADMIN_CODE")),
		ViewCode:     strings.TrimSpace(os.Getenv("TRIP_VIEW_CODE")),
		Oidc:         LoadOidcConfig(),
	}
}
