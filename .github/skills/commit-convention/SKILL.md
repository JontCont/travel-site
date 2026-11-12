---
name: commit-convention
description: Use when preparing, formatting, or validating Git commit messages. Enforces strict '[category] description' commit message format. Also use for commit 規範、提交訊息格式、Git commit 格式.
---

# Git Commit Convention Skill

本專案強制規定所有 Git Commit 訊息必須遵循統一的格式：

```text
[類別] 修改說明
```

## 1. 格式規則

- 必須以括弧 `[類別]` 開頭，後接一個空格，再加上簡明扼要的中文或英文修改說明。
- 說明文字需清楚表達本次提交的目的與改動重點。
- 範例：
  - `[bug] 版型跑版調整共用 scrollbar`
  - `[feat] 新增旅程相片即時預覽功能`
  - `[chore] 更新 GitHub Actions deploy 工作流程`
  - `[docs] 新增 Commit 訊息規範 skill`
  - `[refactor] 重構 route-api 驗證邏輯`

## 2. 常用類別 (Categories)

| 類別標籤 | 說明與適用情境 | 範例 |
|---|---|---|
| `[bug]` 或 `[fix]` | 修復 Bug、錯誤修正、跑版或破圖等視覺異常修復 | `[bug] 版型跑版調整共用 scrollbar` |
| `[feat]` | 新增功能、新模組、新 API 或介面功能擴充 | `[feat] 新增 NAS n8n 部署觸發流程` |
| `[style]` | 純樣式、排版微調（不影響邏輯或功能） | `[style] 調整按鈕間距與字體大小` |
| `[refactor]` | 程式碼重構（既非修復錯誤亦未新增功能） | `[refactor] 抽出共通驗證函式至 utils` |
| `[chore]` | 建置工具、相依套件更新、設定檔、CI/CD 調整 | `[chore] 升級 Vite 與相依套件版本` |
| `[docs]` | 僅修改文件、註解、README 或 Skill 說明 | `[docs] 更新專案架構說明文件` |
| `[test]` | 新增、修改或補充測試案例 | `[test] 補充 SQLite 旅程儲存單元測試` |

## 3. Agent 執行規範

當 Agent 或使用者需要提交 Commit 時：
1. 檢查 `git status` 與變更內容。
2. 判斷改動的核心分類（主要涉及 Bug 修復則使用 `[bug]`，新功能使用 `[feat]` 等）。
3. 嚴格輸出符合 `[類別] 修改說明` 格式的 commit 訊息，**不得**使用未包含 `[類別]` 的一般 commit message。
