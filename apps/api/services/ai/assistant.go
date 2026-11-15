package ai

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"travel-api/models"

	"github.com/google/uuid"
)

var jsonFenceRegex = regexp.MustCompile("(?s)```(?:json)?\\s*(\\{.*\\}|\\[.*\\])\\s*```")

func ExtractJSONObject(raw string) (map[string]interface{}, error) {
	trimmed := strings.TrimSpace(raw)
	var out map[string]interface{}
	if err := json.Unmarshal([]byte(trimmed), &out); err == nil {
		return out, nil
	}

	matches := jsonFenceRegex.FindStringSubmatch(trimmed)
	if len(matches) > 1 {
		if err := json.Unmarshal([]byte(matches[1]), &out); err == nil {
			return out, nil
		}
	}

	return nil, fmt.Errorf("%w: AI 回傳的內容不是有效 JSON 物件。", ErrAiOutput)
}

const (
	maxGenerateDays       = 31
	maxStopsPerDay        = 30
	maxSuggestStops       = 10
	maxIssues             = 30
	maxNotepadCharacters  = 20000
	maxQuestionCharacters = 1000
	maxAnswerCharacters   = 4000
)

var modeInstructions = map[string]string{
	"generate_itinerary": "根據使用者提供的目的地、日期與偏好，規劃完整的每日行程。",
	"suggest_day_stops":  "為指定日期補充 1 到 10 個適合的景點或活動，並避免與當天既有行程重複。",
	"check_conflicts":    "檢查整個行程的時間衝突、交通距離、營業時間與不合理安排，只列出有依據的問題。",
	"tidy_notepad":       "整理使用者的旅遊筆記：修正排版、合併重複內容、分段與條列，保留所有原始事實，不要新增未提及的資訊。",
	"ask":                fmt.Sprintf("根據提供的旅程資料與筆記回答使用者的問題。只能依據提供的內容作答，資料中沒有的資訊請明確說明無法確認，不要捏造。此功能為唯讀，只回答問題，不提出修改行程的動作。回答請控制在 %d 字以內。", maxAnswerCharacters),
}

var outputContracts = map[string]string{
	"generate_itinerary": fmt.Sprintf(`{"title": "行程標題（100 字以內）", "country": "國家或地區", "days": {"<日期>": [{"name": "景點或活動名稱", "address": "地址", "time": "HH:mm", "duration": 停留分鐘數, "notes": "選填備註"}]}}
days 的 key 必須剛好是提供給你的每一個日期，每天最多 %d 個項目。`, maxStopsPerDay),
	"suggest_day_stops": fmt.Sprintf(`{"stops": [{"name": "景點或活動名稱", "address": "地址", "time": "HH:mm", "duration": 停留分鐘數, "notes": "選填備註"}]}
最多 %d 個項目。`, maxSuggestStops),
	"check_conflicts": fmt.Sprintf(`{"issues": [{"date": "YYYY-MM-DD 或 null（整體性問題）", "severity": "warning 或 info", "message": "問題說明與建議"}]}
最多 %d 個項目；沒有問題時回傳空陣列。`, maxIssues),
	"tidy_notepad": `{"notepad": "整理後的完整筆記文字"}`,
	"ask":          `{"answer": "針對問題的回答"}`,
}

func BuildSystemPrompt(mode string) string {
	skills := LoadAiSkills()
	instruction := modeInstructions[mode]
	contract := outputContracts[mode]

	return fmt.Sprintf(`你是嚴格遵守規格的旅遊行程助手。請先閱讀專案技能規範，再依任務指示回覆。

# 技能規範
%s

# 任務指示
%s

# 輸出契約
必須只輸出符合下列 JSON 格式的內容，不要包含額外說明或 Markdown 外框：
%s`, skills, instruction, contract)
}

func ListDates(startDate, endDate string) ([]string, error) {
	start, err := time.Parse("2006-01-02", startDate)
	if err != nil {
		return nil, fmt.Errorf("%w: 無效的開始日期格式。", ErrAiInput)
	}
	end, err := time.Parse("2006-01-02", endDate)
	if err != nil {
		return nil, fmt.Errorf("%w: 無效的結束日期格式。", ErrAiInput)
	}
	if end.Before(start) {
		return nil, fmt.Errorf("%w: 結束日期不能早於開始日期。", ErrAiInput)
	}

	var dates []string
	cur := start
	for !cur.After(end) {
		dates = append(dates, cur.Format("2006-01-02"))
		cur = cur.AddDate(0, 0, 1)
	}
	return dates, nil
}

func RunAiAssist(req ProviderRequest, assistReq models.AssistRequest, tripData map[string]interface{}) (interface{}, error) {
	systemPrompt := BuildSystemPrompt(assistReq.Mode)

	var userPrompt string
	switch assistReq.Mode {
	case "generate_itinerary":
		userPrompt = fmt.Sprintf("目的地：%s\n開始日期：%s\n結束日期：%s\n時區：%s\n偏好：%s\n包含日期：%s",
			assistReq.Destination, assistReq.StartDate, assistReq.EndDate, assistReq.TimeZone, assistReq.Preferences, strings.Join(assistReq.Dates, ", "))

	case "suggest_day_stops":
		tripJSON, _ := json.Marshal(tripData)
		userPrompt = fmt.Sprintf("旅程資料：%s\n指定日期：%s\n偏好：%s",
			string(tripJSON), assistReq.Date, assistReq.Preferences)

	case "check_conflicts":
		tripJSON, _ := json.Marshal(tripData)
		userPrompt = fmt.Sprintf("請檢查以下旅程的衝突與合理性：\n%s", string(tripJSON))

	case "tidy_notepad":
		notepad, _ := tripData["notepad"].(string)
		if len(notepad) > maxNotepadCharacters {
			notepad = notepad[:maxNotepadCharacters]
		}
		userPrompt = fmt.Sprintf("請整理以下旅程筆記：\n%s", notepad)

	case "ask":
		tripJSON, _ := json.Marshal(tripData)
		userPrompt = fmt.Sprintf("旅程資料：%s\n問題：%s", string(tripJSON), assistReq.Question)
	}

	req.System = systemPrompt
	req.User = userPrompt

	rawText, err := CallProvider(req)
	if err != nil {
		return nil, err
	}

	obj, err := ExtractJSONObject(rawText)
	if err != nil {
		return nil, err
	}

	// Post-processing for generate_itinerary to assign UUIDs to stops
	if assistReq.Mode == "generate_itinerary" {
		if days, ok := obj["days"].(map[string]interface{}); ok {
			for _, stopsRaw := range days {
				if stopList, ok := stopsRaw.([]interface{}); ok {
					for _, st := range stopList {
						if stopMap, ok := st.(map[string]interface{}); ok {
							stopMap["id"] = uuid.NewString()
						}
					}
				}
			}
		}
	}

	return obj, nil
}
