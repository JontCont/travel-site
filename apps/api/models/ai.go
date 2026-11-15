package models

type AiSettingsView struct {
	Provider  string  `json:"provider"`
	BaseURL   *string `json:"baseUrl"`
	Model     string  `json:"model"`
	HasApiKey bool    `json:"hasApiKey"`
	UpdatedAt string  `json:"updatedAt"`
}

type AiProviderCatalogItem struct {
	ID              string  `json:"id"`
	Label           string  `json:"label"`
	BaseURL         *string `json:"baseUrl"`
	BaseURLEditable bool    `json:"baseUrlEditable"`
}

type AiSettingsSummaryResponse struct {
	Settings  *AiSettingsView         `json:"settings"`
	Ready     bool                    `json:"ready"`
	Providers []AiProviderCatalogItem `json:"providers"`
}

type AiAvailabilityResponse struct {
	Ready bool `json:"ready"`
}

type SaveAiSettingsRequest struct {
	Provider    string  `json:"provider"`
	BaseURL     *string `json:"baseUrl"`
	Model       string  `json:"model"`
	ApiKey      *string `json:"apiKey"`
	ClearApiKey bool    `json:"clearApiKey"`
}

type AssistRequest struct {
	Mode         string   `json:"mode"`
	Destination  string   `json:"destination,omitempty"`
	StartDate    string   `json:"startDate,omitempty"`
	EndDate      string   `json:"endDate,omitempty"`
	Dates        []string `json:"dates,omitempty"`
	TimeZone     string   `json:"timeZone,omitempty"`
	Preferences  string   `json:"preferences,omitempty"`
	TripID       string   `json:"tripId,omitempty"`
	Date         string   `json:"date,omitempty"`
	Question     string   `json:"question,omitempty"`
}
