package ai

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"travel-api/models"
)

var (
	ErrAiInput    = errors.New("ai_input_error")
	ErrAiOutput   = errors.New("ai_output_error")
	ErrAiProvider = errors.New("ai_provider_error")
)

type ProviderCatalogItem struct {
	Label   string
	BaseURL *string
}

func strPtr(s string) *string {
	return &s
}

var Catalog = map[string]ProviderCatalogItem{
	"openai_compatible": {Label: "OpenAI 相容 API（可自訂 Base URL）", BaseURL: nil},
	"openrouter":        {Label: "OpenRouter", BaseURL: strPtr("https://openrouter.ai/api/v1")},
	"anthropic":         {Label: "Anthropic Claude", BaseURL: strPtr("https://api.anthropic.com")},
	"gemini":            {Label: "Google Gemini", BaseURL: strPtr("https://generativelanguage.googleapis.com")},
}

var CatalogOrder = []string{"openai_compatible", "openrouter", "anthropic", "gemini"}

const (
	maxModelCharacters   = 120
	maxBaseURLCharacters = 300
	maxAPIKeyCharacters  = 500
	anthropicMaxTokens   = 8192
	providerTimeout      = 90 * time.Second
)

func ProviderOptions() []models.AiProviderCatalogItem {
	var opts []models.AiProviderCatalogItem
	for _, id := range CatalogOrder {
		item := Catalog[id]
		opts = append(opts, models.AiProviderCatalogItem{
			ID:              id,
			Label:           item.Label,
			BaseURL:         item.BaseURL,
			BaseURLEditable: item.BaseURL == nil,
		})
	}
	return opts
}

func NormalizeProviderBaseURL(provider string, val *string) (*string, error) {
	if Catalog[provider].BaseURL != nil {
		return nil, nil
	}
	if val == nil || strings.TrimSpace(*val) == "" || len(strings.TrimSpace(*val)) > maxBaseURLCharacters {
		return nil, fmt.Errorf("%w: OpenAI 相容 API 需要填寫 Base URL（例如 https://api.openai.com/v1）。", ErrAiInput)
	}
	trimmed := strings.TrimSpace(*val)
	u, err := url.Parse(trimmed)
	if err != nil {
		return nil, fmt.Errorf("%w: Base URL 格式不正確。", ErrAiInput)
	}
	if u.Scheme != "https" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, fmt.Errorf("%w: Base URL 必須是 https:// 開頭，且不可包含帳密、查詢字串或 #。", ErrAiInput)
	}
	cleaned := strings.TrimRight(u.String(), "/")
	return &cleaned, nil
}

type ProviderRequest struct {
	Provider string
	BaseURL  *string
	Model    string
	APIKey   string
	System   string
	User     string
}

func CallProvider(req ProviderRequest) (string, error) {
	client := &http.Client{Timeout: providerTimeout}

	var targetURL string
	headers := make(map[string]string)
	var bodyBytes []byte
	var err error

	switch req.Provider {
	case "openai_compatible", "openrouter":
		root := ""
		if req.Provider == "openrouter" {
			root = *Catalog["openrouter"].BaseURL
		} else if req.BaseURL != nil {
			root = *req.BaseURL
		}
		targetURL = root + "/chat/completions"
		headers["Authorization"] = "Bearer " + req.APIKey
		headers["Content-Type"] = "application/json"

		payload := map[string]interface{}{
			"model": req.Model,
			"messages": []map[string]string{
				{"role": "system", "content": req.System},
				{"role": "user", "content": req.User},
			},
		}
		bodyBytes, err = json.Marshal(payload)

	case "anthropic":
		targetURL = *Catalog["anthropic"].BaseURL + "/v1/messages"
		headers["x-api-key"] = req.APIKey
		headers["anthropic-version"] = "2023-06-01"
		headers["Content-Type"] = "application/json"

		payload := map[string]interface{}{
			"model":      req.Model,
			"max_tokens": anthropicMaxTokens,
			"system":     req.System,
			"messages": []map[string]string{
				{"role": "user", "content": req.User},
			},
		}
		bodyBytes, err = json.Marshal(payload)

	case "gemini":
		targetURL = fmt.Sprintf("%s/v1beta/models/%s:generateContent",
			*Catalog["gemini"].BaseURL, url.PathEscape(req.Model))
		headers["x-goog-api-key"] = req.APIKey
		headers["Content-Type"] = "application/json"

		payload := map[string]interface{}{
			"systemInstruction": map[string]interface{}{
				"parts": []map[string]string{{"text": req.System}},
			},
			"contents": []map[string]interface{}{
				{"role": "user", "parts": []map[string]string{{"text": req.User}}},
			},
			"generationConfig": map[string]interface{}{
				"responseMimeType": "application/json",
			},
		}
		bodyBytes, err = json.Marshal(payload)

	default:
		return "", fmt.Errorf("%w: 不支援的 AI 服務商。", ErrAiInput)
	}

	if err != nil {
		return "", err
	}

	httpReq, err := http.NewRequest(http.MethodPost, targetURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return "", fmt.Errorf("%w: 建立請求失敗：%s", ErrAiProvider, err.Error())
	}
	for k, v := range headers {
		httpReq.Header.Set(k, v)
	}

	resp, err := client.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("%w: 連線到 AI 服務商失敗：%s", ErrAiProvider, err.Error())
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("%w: 讀取 AI 回應失敗。", ErrAiProvider)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("%w: AI 服務商回應 HTTP %d: %s", ErrAiProvider, resp.StatusCode, string(respBody))
	}

	var parsed map[string]interface{}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return "", fmt.Errorf("%w: AI 服務商回傳非有效 JSON。", ErrAiOutput)
	}

	text := extractText(req.Provider, parsed)
	if text == "" {
		return "", fmt.Errorf("%w: AI 服務商未回傳文字內容。", ErrAiOutput)
	}
	return text, nil
}

func extractText(provider string, payload map[string]interface{}) string {
	switch provider {
	case "openai_compatible", "openrouter":
		choices, ok := payload["choices"].([]interface{})
		if !ok || len(choices) == 0 {
			return ""
		}
		first, ok := choices[0].(map[string]interface{})
		if !ok {
			return ""
		}
		msg, ok := first["message"].(map[string]interface{})
		if !ok {
			return ""
		}
		content, _ := msg["content"].(string)
		return content

	case "anthropic":
		contentList, ok := payload["content"].([]interface{})
		if !ok || len(contentList) == 0 {
			return ""
		}
		first, ok := contentList[0].(map[string]interface{})
		if !ok {
			return ""
		}
		txt, _ := first["text"].(string)
		return txt

	case "gemini":
		candidates, ok := payload["candidates"].([]interface{})
		if !ok || len(candidates) == 0 {
			return ""
		}
		first, ok := candidates[0].(map[string]interface{})
		if !ok {
			return ""
		}
		content, ok := first["content"].(map[string]interface{})
		if !ok {
			return ""
		}
		parts, ok := content["parts"].([]interface{})
		if !ok || len(parts) == 0 {
			return ""
		}
		firstPart, ok := parts[0].(map[string]interface{})
		if !ok {
			return ""
		}
		txt, _ := firstPart["text"].(string)
		return txt

	default:
		return ""
	}
}
