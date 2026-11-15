# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- 實作 Go (Gin) 後端 API 服務 (`apps/api`)，達成純 Go、無 CGO 依賴（`modernc.org/sqlite`），全面支援 OIDC (DSM SSO)、訪客通行碼、Workspace CRUD、高德地圖步行代理與 AI 助手等功能。
- 新增 Go 單元測試與整合測試 (`apps/api/handlers`, `apps/api/services/ai`, `apps/api/services/oidc`)，相容現有 83 項既有測試場景。
- 新增 `pnpm test:go` 與 `pnpm test:all` 測試指令，並於 GitHub Actions CI 整合 Go 1.24 驗證步驟。
- 新增 Changelog 管理規範 Skill (`.agents/skills/changelog/SKILL.md`)，依循 Keep a Changelog 1.1.0 與 pyOpenSci 標準。
- 新增 `.specs/pnpm-workspace-sdd.md` 與 `.specs/go-gin-api-sdd.md` 軟體規格藍圖設計（SDD）。
- 新增專案根目錄 `CHANGELOG.md`，建立標準化版本異動紀錄。

### Changed
- 更新 `docker/Dockerfile` 與 `docker/Dockerfile.prod` 為 Go 多階段編譯架構，以極輕量 Alpine 映像檔運行，映像檔體積縮減至約 25MB，記憶體佔用小於 20MB。
- 將專案架構重構為 pnpm monorepo workspace (`apps/web`, `apps/api`, `packages/shared`)。
  - `apps/web`: React 19 + Vite 前端 SPA。
  - `apps/api`: 後端 API 服務。
  - `packages/shared`: 共享 TypeScript DTOs 與領域服務 (`trip`, `date`, `walking`, `map`)。
- 將 SQLite 資料庫路徑從 `data/` 統整遷移至 `database/` (`database/trips.sqlite`)，並保留舊路徑自動相容載入。
- 重構 Docker 配置至專用 `docker/` 目錄，支援多階段建置 (`base`, `dev`, `prod`)，並讓 CI/CD 流程直接採用 `prod` target。
- 將 AI Agent Skills 從 `.github/skills/` 遷移至 `.agents/skills/`，提升各 AI 工具跨平台載入相容性。

## [0.1.0] - 2026-11-12

### Added
- 旅程規劃 MVP：支援多行程建立、天數時間軸、景點安排、飯店住宿與航班資訊記錄。
- 認證與授權機制：支援管理者密碼登入、Synology SSO 登入，以及具備過期時間的訪客訪問碼（Access Code）。
- 旅程相簿管理：支援 Immich 與外部相簿連結嵌入與網址驗證。
- 地圖導航與步行評估：整合高德地圖（AMap）搜尋、步行距離路線計算與路程時間評估。
- 旅程記事本（Notepad）即時編輯與自動儲存功能。
- NAS 自動化部署 Webhook 與 CI/CD 工作流程。
- 團隊 Git Commit 規範 Skill 與 Agent 規範導引。

### Fixed
- 修復 Dockerfile 與 docker-compose 容器內資料庫掛載路徑與環境變數設定。
- 修復 Cloudflare 反向代理環境下 Client IP 取得與 Rate Limit 計數。
- 修復部署 Webhook 逾時但連線已建立時視為成功送達之問題。

[Unreleased]: https://github.com/JontCont/travel-site/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/JontCont/travel-site/releases/tag/v0.1.0
