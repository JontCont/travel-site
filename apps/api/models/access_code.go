package models

type AccessCode struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	CodeHash    string `json:"codeHash"`
	TripIDsJSON string `json:"tripIdsJson"`
	CreatedAt   string `json:"createdAt"`
	ExpiresAt   *int64 `json:"expiresAt"` // millisecond epoch or nil
}

type AccessCodeSummary struct {
	ID        string   `json:"id"`
	Label     string   `json:"label"`
	TripIDs   []string `json:"tripIds"`
	CreatedAt string   `json:"createdAt"`
	ExpiresAt *string  `json:"expiresAt"` // ISO string or nil
}

type CreateAccessCodeRequest struct {
	Label         string   `json:"label"`
	TripIDs       []string `json:"tripIds"`
	ExpiresInDays *int     `json:"expiresInDays"`
}

type CreateAccessCodeResponse struct {
	Code   string            `json:"code"`
	Access AccessCodeSummary `json:"access"`
}

type UpdateAccessCodeRequest struct {
	TripIDs       *[]string `json:"tripIds"`
	ExpiresInDays *int      `json:"expiresInDays"`
}

type AccessCodeListResponse struct {
	Codes []AccessCodeSummary `json:"codes"`
}

type AccessCodeSingleResponse struct {
	Access AccessCodeSummary `json:"access"`
}
