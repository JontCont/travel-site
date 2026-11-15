package models

type Session struct {
	TokenHash string `json:"tokenHash"`
	Role      string `json:"role"` // 'admin', 'viewer', 'code'
	Subject   string `json:"subject"`
	ExpiresAt int64  `json:"expiresAt"` // millisecond epoch
}

type SessionContext struct {
	Role    string   `json:"role"`
	TripIDs []string `json:"tripIds"` // nil if admin or viewer with full access
}

type AuthStatusResponse struct {
	Configured    bool    `json:"configured"`
	Authenticated bool    `json:"authenticated"`
	Role          *string `json:"role"`
}

type LoginRequest struct {
	Code string `json:"code"`
}

type LoginResponse struct {
	Authenticated bool   `json:"authenticated"`
	Role          string `json:"role"`
}

type LogoutResponse struct {
	Authenticated bool `json:"authenticated"`
}
