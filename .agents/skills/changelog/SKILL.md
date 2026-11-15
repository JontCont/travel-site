---
name: changelog
description: Use when updating CHANGELOG.md, creating release notes, bumping versions, or maintaining version history. Adheres strictly to Keep a Changelog 1.1.0 and pyOpenSci guidelines. Also use for 更新日誌、版本紀錄、changelog、release notes.
---

# Changelog Management Skill

本專案的所有版本變更與更新紀錄必須集中維護於根目錄的 `CHANGELOG.md`。
規範嚴格遵循 [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) 與 [pyOpenSci Package Guide - Changelog File](https://www.pyopensci.org/python-package-guide/documentation/repository-files/changelog-file.html)。

---

## 1. 核心原則 (Guiding Principles)

1. **為人類讀者而寫 (Changelogs are for humans, not machines)**：
   - 條目應說明「對使用者或開發者有何實質影響」，而非生硬傾倒 `git log` 的提交字串。
   - 語氣清晰、簡明扼要、條理分明。
2. **統一分類歸納 (Grouped by Change Type)**：
   - 每一個版本內部的改動必須依指定分類歸納。
3. **時間倒序排列 (Reverse Chronological Order)**：
   - 最新的變更置於最上方。
   - 最頂層常駐 `## [Unreleased]` 區塊，記錄已合併但尚未釋出正式版號的變更。
4. **標準日期格式 (ISO 8601)**：
   - 正式版本標註發布日期：`YYYY-MM-DD`（例如 `## [1.0.0] - 2026-11-15`）。
5. **遵循語意化版本 (Semantic Versioning 2.0.0)**：
   - `MAJOR.MINOR.PATCH`（破壞性重大改動 . 新增向後相容功能 . 向後相容的 Bug 修復）。
6. **提供超連結比較 (Linkable Versions and Diff References)**：
   - 檔案底部必須維護各版本與 GitHub compare / releases 的 Markdown 連結。

---

## 2. 變更分類類別 (Standard Categories)

每次改動依性質歸入以下 6 種標準標題（按字母排序或習慣順序，若該版無該類改動則省略該標題）：

| 類別標題 | 說明與適用情境 | Commit 標籤對應 |
|---|---|---|
| `### Added` | 新功能、新模組、新 API、新畫面或新設定檔 | `[feat]` |
| `### Changed` | 現有功能的修改、架構重構、流程微調、效能優化 | `[chore]`, `[refactor]`, `[style]` |
| `### Deprecated` | 即將在未來版本棄用或移除的功能宣告 | - |
| `### Removed` | 本次版本中正式移除的功能、端點或檔案 | `[refactor]` (移除代碼) |
| `### Fixed` | 錯誤修正、Bug 修復、跑版修復、邊界例外處理 | `[bug]`, `[fix]` |
| `### Security` | 安全性修復、認證漏洞、敏感金鑰防護或權限漏洞修補 | `[bug]`, `[chore]` (安全性套件更新) |

---

## 3. 檔案結構範本 (Template)

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- 新功能說明條目。

### Changed
- 現有架構或行為調整說明。

### Fixed
- Bug 修復說明。

## [0.1.0] - 2026-11-12

### Added
- 初版基礎功能：旅程管理、地圖導航、相簿整合。

[Unreleased]: https://github.com/JontCont/travel-site/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/JontCont/travel-site/releases/tag/v0.1.0
```

---

## 4. Agent 開發工作流程

當 Agent 在本專案中進行功能開發、重構、Bug 修復或版本發布時，必須依序遵循下列流程維護 `CHANGELOG.md`：

### 4.1 日常開發 / PR / Commit 時
1. 完成功能修改與驗證測試後，檢視本次修改實質影響。
2. 開啟根目錄 `CHANGELOG.md`。
3. 在 `## [Unreleased]` 區塊下方尋找或建立對應的分類標題（如 `### Added`, `### Changed`, `### Fixed`）。
4. 新增簡潔、易讀的一至多行說明條目。
5. 與程式碼一同加入 Git 暫存區並提交（依 Commit 規範格式）。

### 4.2 發布新版本時 (Release Cut)
1. 依據語意化版本原則決定新版號 `[X.Y.Z]`。
2. 將 `## [Unreleased]` 下累積的所有條目移入新版號區塊：
   ```markdown
   ## [Unreleased]

   ## [X.Y.Z] - YYYY-MM-DD
   ### Added
   ...
   ```
3. 更新檔案底部的連結參照清單：
   - 更新 `[Unreleased]` 指向 `vX.Y.Z...HEAD`。
   - 新增 `[X.Y.Z]` 指向上一版號到本版號的比較連結或 Release Tag。
