package oidc

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"math/big"
	"testing"

	"travel-api/config"
)

func TestCreateAuthorizationRequest(t *testing.T) {
	cfg := config.OidcConfig{
		Configured:   true,
		Issuer:       "https://dsm.example.com",
		ClientID:     "my-client-id",
		ClientSecret: "my-secret",
		RedirectURI:  "https://my-app.example.com/api/auth/oidc/callback",
		AdminGroup:   "administrators",
		AdminUsers:   []string{"admin"},
	}

	disc := &DiscoveryResponse{
		Issuer:                "https://dsm.example.com",
		AuthorizationEndpoint: "https://dsm.example.com/oauth2/authorize",
		TokenEndpoint:         "https://dsm.example.com/oauth2/token",
		JwksURI:               "https://dsm.example.com/oauth2/jwks",
	}

	req, err := CreateAuthorizationRequest(cfg, disc)
	if err != nil {
		t.Fatalf("failed to create auth request: %v", err)
	}

	if req.State == "" || req.Nonce == "" || req.CodeVerifier == "" || req.URL == "" {
		t.Fatalf("empty field in auth request: %+v", req)
	}
}

func TestOidcRoleAssignment(t *testing.T) {
	cfg := config.OidcConfig{
		AdminGroup: "administrators",
		AdminUsers: []string{"nas-superadmin"},
	}

	// 1. Matched by admin user
	id1 := &Identity{Subject: "s1", Username: "nas-superadmin", Groups: []string{"users"}}
	if RoleFor(id1, cfg) != "admin" {
		t.Fatalf("expected admin for nas-superadmin")
	}

	// 2. Matched by admin group
	id2 := &Identity{Subject: "s2", Username: "someone", Groups: []string{"Administrators", "users"}}
	if RoleFor(id2, cfg) != "admin" {
		t.Fatalf("expected admin for group administrators (case-insensitive)")
	}

	// 3. Regular viewer
	id3 := &Identity{Subject: "s3", Username: "guest_user", Groups: []string{"guests"}}
	if RoleFor(id3, cfg) != "viewer" {
		t.Fatalf("expected viewer for guest_user")
	}
}

func TestJWTRSAKeyParsing(t *testing.T) {
	privKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("failed to generate rsa key: %v", err)
	}

	nBytes := privKey.N.Bytes()
	nStr := base64.RawURLEncoding.EncodeToString(nBytes)

	eBytes := big.NewInt(int64(privKey.E)).Bytes()
	eStr := base64.RawURLEncoding.EncodeToString(eBytes)

	decN, err := base64.RawURLEncoding.DecodeString(nStr)
	if err != nil {
		t.Fatalf("decode N failed: %v", err)
	}
	decE, err := base64.RawURLEncoding.DecodeString(eStr)
	if err != nil {
		t.Fatalf("decode E failed: %v", err)
	}

	var e int
	for _, b := range decE {
		e = (e << 8) | int(b)
	}

	reconstructed := &rsa.PublicKey{
		N: new(big.Int).SetBytes(decN),
		E: e,
	}

	if reconstructed.N.Cmp(privKey.N) != 0 || reconstructed.E != privKey.E {
		t.Fatalf("reconstructed public key does not match original")
	}
}
