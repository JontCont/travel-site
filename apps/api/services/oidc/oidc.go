package oidc

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"time"

	"travel-api/config"
)

const (
	RequestTimeout   = 10 * time.Second
	ClockSkewSeconds = 60
)

type OidcError struct {
	Code    string
	Message string
}

func (e *OidcError) Error() string {
	return e.Message
}

func NewOidcError(code, message string) *OidcError {
	return &OidcError{Code: code, Message: message}
}

type DiscoveryResponse struct {
	Issuer                string `json:"issuer"`
	AuthorizationEndpoint string `json:"authorization_endpoint"`
	TokenEndpoint         string `json:"token_endpoint"`
	JwksURI               string `json:"jwks_uri"`
	UserinfoEndpoint      string `json:"userinfo_endpoint,omitempty"`
}

type AuthorizationRequest struct {
	URL          string
	State        string
	Nonce        string
	CodeVerifier string
}

type TokenResponse struct {
	IDToken      string `json:"id_token"`
	AccessToken  string `json:"access_token,omitempty"`
	TokenType    string `json:"token_type,omitempty"`
	ExpiresIn    int    `json:"expires_in,omitempty"`
	RefreshToken string `json:"refresh_token,omitempty"`
}

type JWKKey struct {
	Kty string `json:"kty"`
	Use string `json:"use,omitempty"`
	Kid string `json:"kid,omitempty"`
	Alg string `json:"alg,omitempty"`
	N   string `json:"n"`
	E   string `json:"e"`
}

type JWKSResponse struct {
	Keys []JWKKey `json:"keys"`
}

type Identity struct {
	Subject  string
	Username string
	Groups   []string
}

func fetchJSON(targetURL string, errCode string, target interface{}, initReq ...func(*http.Request)) error {
	client := &http.Client{Timeout: RequestTimeout}
	req, err := http.NewRequest(http.MethodGet, targetURL, nil)
	if err != nil {
		return NewOidcError(errCode, err.Error())
	}
	for _, fn := range initReq {
		fn(req)
	}

	resp, err := client.Do(req)
	if err != nil {
		u, _ := url.Parse(targetURL)
		origin := targetURL
		if u != nil {
			origin = u.Scheme + "://" + u.Host
		}
		return NewOidcError(errCode, fmt.Sprintf("無法連線到 %s。", origin))
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return NewOidcError(errCode, fmt.Sprintf("Synology 登入服務回應 HTTP %d。", resp.StatusCode))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return NewOidcError(errCode, "Synology 登入服務回傳的 JSON 無效。")
	}

	if err := json.Unmarshal(body, target); err != nil {
		return NewOidcError(errCode, "Synology 登入服務回傳的 JSON 無效。")
	}
	return nil
}

func sameOriginHTTPS(endpoint, name, origin string) (string, error) {
	u, err := url.Parse(endpoint)
	if err != nil || u.Scheme != "https" {
		return "", NewOidcError("oidc_unavailable", fmt.Sprintf("%s 必須是與 issuer 同來源的 HTTPS 位址。", name))
	}
	epOrigin := u.Scheme + "://" + u.Host
	if epOrigin != origin {
		return "", NewOidcError("oidc_unavailable", fmt.Sprintf("%s 必須是與 issuer 同來源的 HTTPS 位址。", name))
	}
	return endpoint, nil
}

func Discover(cfg config.OidcConfig) (*DiscoveryResponse, error) {
	var disc DiscoveryResponse
	wellKnown := fmt.Sprintf("%s/.well-known/openid-configuration", cfg.Issuer)
	if err := fetchJSON(wellKnown, "oidc_unavailable", &disc); err != nil {
		return nil, err
	}

	if strings.TrimRight(disc.Issuer, "/") != cfg.Issuer {
		return nil, NewOidcError("oidc_unavailable", "Synology 登入服務的 issuer 與設定不一致。")
	}

	u, err := url.Parse(cfg.Issuer)
	if err != nil {
		return nil, NewOidcError("oidc_unavailable", "無效的 issuer。")
	}
	origin := u.Scheme + "://" + u.Host

	authEp, err := sameOriginHTTPS(disc.AuthorizationEndpoint, "authorization_endpoint", origin)
	if err != nil {
		return nil, err
	}
	tokenEp, err := sameOriginHTTPS(disc.TokenEndpoint, "token_endpoint", origin)
	if err != nil {
		return nil, err
	}
	jwksEp, err := sameOriginHTTPS(disc.JwksURI, "jwks_uri", origin)
	if err != nil {
		return nil, err
	}

	var userinfoEp string
	if disc.UserinfoEndpoint != "" {
		userinfoEp, err = sameOriginHTTPS(disc.UserinfoEndpoint, "userinfo_endpoint", origin)
		if err != nil {
			return nil, err
		}
	}

	return &DiscoveryResponse{
		Issuer:                disc.Issuer,
		AuthorizationEndpoint: authEp,
		TokenEndpoint:         tokenEp,
		JwksURI:               jwksEp,
		UserinfoEndpoint:      userinfoEp,
	}, nil
}

func randomBase64URL(bytesCount int) (string, error) {
	buf := make([]byte, bytesCount)
	if _, err := io.ReadFull(rand.Reader, buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func CreateAuthorizationRequest(cfg config.OidcConfig, disc *DiscoveryResponse) (*AuthorizationRequest, error) {
	state, err := randomBase64URL(32)
	if err != nil {
		return nil, err
	}
	nonce, err := randomBase64URL(32)
	if err != nil {
		return nil, err
	}
	codeVerifier, err := randomBase64URL(48)
	if err != nil {
		return nil, err
	}

	h := sha256.Sum256([]byte(codeVerifier))
	codeChallenge := base64.RawURLEncoding.EncodeToString(h[:])

	u, err := url.Parse(disc.AuthorizationEndpoint)
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("response_type", "code")
	q.Set("client_id", cfg.ClientID)
	q.Set("redirect_uri", cfg.RedirectURI)
	q.Set("scope", "openid email groups")
	q.Set("state", state)
	q.Set("nonce", nonce)
	q.Set("code_challenge", codeChallenge)
	q.Set("code_challenge_method", "S256")
	u.RawQuery = q.Encode()

	return &AuthorizationRequest{
		URL:          u.String(),
		State:        state,
		Nonce:        nonce,
		CodeVerifier: codeVerifier,
	}, nil
}

func ExchangeAuthorizationCode(cfg config.OidcConfig, disc *DiscoveryResponse, code, codeVerifier string) (*TokenResponse, error) {
	formData := url.Values{}
	formData.Set("grant_type", "authorization_code")
	formData.Set("code", code)
	formData.Set("redirect_uri", cfg.RedirectURI)
	formData.Set("client_id", cfg.ClientID)
	formData.Set("client_secret", cfg.ClientSecret)
	formData.Set("code_verifier", codeVerifier)

	client := &http.Client{Timeout: RequestTimeout}
	req, err := http.NewRequest(http.MethodPost, disc.TokenEndpoint, strings.NewReader(formData.Encode()))
	if err != nil {
		return nil, NewOidcError("oidc_token", err.Error())
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, NewOidcError("oidc_token", "無法連線到 Synology Token 端點。")
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, NewOidcError("oidc_token", fmt.Sprintf("Synology 登入服務回應 HTTP %d。", resp.StatusCode))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, NewOidcError("oidc_token", "Synology 登入服務回傳的 Token 無效。")
	}

	var tokens TokenResponse
	if err := json.Unmarshal(body, &tokens); err != nil || tokens.IDToken == "" {
		return nil, NewOidcError("oidc_token", "Synology 登入服務的 Token 回應不完整。")
	}
	return &tokens, nil
}

func decodeJWTSegment(seg string, target interface{}) error {
	bytes, err := base64.RawURLEncoding.DecodeString(seg)
	if err != nil {
		return NewOidcError("oidc_identity", "ID Token 格式不正確。")
	}
	if err := json.Unmarshal(bytes, target); err != nil {
		return NewOidcError("oidc_identity", "ID Token 格式不正確。")
	}
	return nil
}

type jwtHeader struct {
	Alg string `json:"alg"`
	Kid string `json:"kid,omitempty"`
}

type jwtClaims struct {
	Iss      string      `json:"iss"`
	Sub      string      `json:"sub"`
	Aud      interface{} `json:"aud"`
	Azp      string      `json:"azp,omitempty"`
	Exp      int64       `json:"exp"`
	Iat      int64       `json:"iat"`
	Nonce    string      `json:"nonce"`
	Username string      `json:"username"`
	Groups   []string    `json:"groups,omitempty"`
}

func parseAudience(aud interface{}) []string {
	switch v := aud.(type) {
	case string:
		return []string{v}
	case []interface{}:
		var out []string
		for _, item := range v {
			if s, ok := item.(string); ok {
				out = append(out, s)
			}
		}
		return out
	default:
		return nil
	}
}

func verifyIDToken(idToken string, cfg config.OidcConfig, disc *DiscoveryResponse, nonce string) (*jwtClaims, error) {
	parts := strings.Split(idToken, ".")
	if len(parts) != 3 {
		return nil, NewOidcError("oidc_identity", "ID Token 格式不正確。")
	}

	var header jwtHeader
	if err := decodeJWTSegment(parts[0], &header); err != nil {
		return nil, err
	}
	if header.Alg != "RS256" {
		return nil, NewOidcError("oidc_identity", "ID Token 必須使用 RS256 簽章。")
	}

	var claims jwtClaims
	if err := decodeJWTSegment(parts[1], &claims); err != nil {
		return nil, err
	}

	sigBytes, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, NewOidcError("oidc_identity", "ID Token 格式不正確。")
	}

	var jwks JWKSResponse
	if err := fetchJSON(disc.JwksURI, "oidc_unavailable", &jwks); err != nil {
		return nil, err
	}

	var matchedKey *JWKKey
	for _, k := range jwks.Keys {
		if k.Kty == "RSA" && (k.Use == "" || k.Use == "sig") {
			if header.Kid == "" || k.Kid == header.Kid {
				matchedKey = &k
				break
			}
		}
	}
	if matchedKey == nil {
		return nil, NewOidcError("oidc_identity", "找不到可驗證 ID Token 的 Synology 公開金鑰。")
	}

	nBytes, err := base64.RawURLEncoding.DecodeString(matchedKey.N)
	if err != nil {
		return nil, NewOidcError("oidc_identity", "公鑰格式不正確。")
	}
	eBytes, err := base64.RawURLEncoding.DecodeString(matchedKey.E)
	if err != nil {
		return nil, NewOidcError("oidc_identity", "公鑰格式不正確。")
	}
	var e int
	for _, b := range eBytes {
		e = (e << 8) | int(b)
	}
	pubKey := &rsa.PublicKey{
		N: new(big.Int).SetBytes(nBytes),
		E: e,
	}

	signedContent := parts[0] + "." + parts[1]
	hash := sha256.Sum256([]byte(signedContent))
	if err := rsa.VerifyPKCS1v15(pubKey, crypto.SHA256, hash[:], sigBytes); err != nil {
		return nil, NewOidcError("oidc_identity", "ID Token 簽章驗證失敗。")
	}

	now := time.Now().Unix()
	audiences := parseAudience(claims.Aud)

	if claims.Iss != disc.Issuer {
		return nil, NewOidcError("oidc_identity", "ID Token 的 issuer 不符。")
	}
	hasAud := false
	for _, a := range audiences {
		if a == cfg.ClientID {
			hasAud = true
			break
		}
	}
	if !hasAud {
		return nil, NewOidcError("oidc_identity", "ID Token 的 audience 不符。")
	}
	if (len(audiences) > 1 || claims.Azp != "") && claims.Azp != cfg.ClientID {
		return nil, NewOidcError("oidc_identity", "ID Token 的 azp 不符。")
	}
	if claims.Exp+ClockSkewSeconds <= now {
		return nil, NewOidcError("oidc_identity", "ID Token 已過期。")
	}
	if claims.Iat > now+ClockSkewSeconds {
		return nil, NewOidcError("oidc_identity", "ID Token 簽發時間不正確。")
	}
	if claims.Nonce != nonce {
		return nil, NewOidcError("oidc_identity", "ID Token nonce 不符。")
	}
	if claims.Sub == "" {
		return nil, NewOidcError("oidc_identity", "ID Token 缺少 sub。")
	}
	if claims.Username == "" {
		return nil, NewOidcError("oidc_identity", "ID Token 缺少 username。")
	}

	return &claims, nil
}

func ResolveIdentity(cfg config.OidcConfig, disc *DiscoveryResponse, tokens *TokenResponse, nonce string) (*Identity, error) {
	claims, err := verifyIDToken(tokens.IDToken, cfg, disc, nonce)
	if err != nil {
		return nil, err
	}

	groups := claims.Groups
	if groups == nil {
		if disc.UserinfoEndpoint == "" || tokens.AccessToken == "" {
			return nil, NewOidcError("oidc_identity", "無法取得 Synology 群組資訊。")
		}

		var userinfo struct {
			Sub    string   `json:"sub"`
			Groups []string `json:"groups"`
		}
		err := fetchJSON(disc.UserinfoEndpoint, "oidc_identity", &userinfo, func(req *http.Request) {
			req.Header.Set("Authorization", "Bearer "+tokens.AccessToken)
			req.Header.Set("Accept", "application/json")
		})
		if err != nil {
			return nil, err
		}
		if userinfo.Sub != "" && userinfo.Sub != claims.Sub {
			return nil, NewOidcError("oidc_identity", "UserInfo 與 ID Token 的使用者不符。")
		}
		groups = userinfo.Groups
	}

	return &Identity{
		Subject:  claims.Sub,
		Username: claims.Username,
		Groups:   groups,
	}, nil
}

func RoleFor(identity *Identity, cfg config.OidcConfig) string {
	username := strings.ToLower(identity.Username)
	for _, admin := range cfg.AdminUsers {
		if admin == username {
			return "admin"
		}
	}
	for _, grp := range identity.Groups {
		if strings.ToLower(grp) == cfg.AdminGroup {
			return "admin"
		}
	}
	return "viewer"
}

func ErrorCode(err error) string {
	var oidcErr *OidcError
	if errors.As(err, &oidcErr) {
		return oidcErr.Code
	}
	return "oidc_unavailable"
}
