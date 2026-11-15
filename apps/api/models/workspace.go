package models

type NotepadRequest struct {
	TripID  string `json:"tripId"`
	Notepad string `json:"notepad"`
}

type SimpleSavedResponse struct {
	Saved bool `json:"saved"`
}

type SimpleDeletedResponse struct {
	Deleted bool `json:"deleted"`
}

type WalkRequest struct {
	Origin      string `json:"origin"`
	Destination string `json:"destination"`
}

type WalkResponse struct {
	Meters  float64 `json:"meters"`
	Minutes int     `json:"minutes"`
}

type MapConfigResponse struct {
	APIKey string `json:"apiKey"`
}
