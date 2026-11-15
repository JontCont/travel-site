# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-11-15

### Added
- **Go (Gin) 後端架構重構**：實作純 Go 原生後端服務 (`apps/api`)，達成零 CGO 依賴（`modernc.org/sqlite`），全面支援 OIDC (DSM SSO)、訪客通行碼、Workspace CRUD、高德地圖步行代理等核心功能。
- **VS Code Monaco JSON 行程編輯器**：整合 Monaco Editor 提供沉浸式 JSON 編輯體驗，支援即時語法與 DTO Schema 驗證、問題診斷清單、格式化、重置與快捷鍵 (`Ctrl+S`) 自動同步寫入 SQLite。
- **MapLibre GL 街道級高精度地圖**：升級為 MapLibre GL 互動式向量地圖，支援高達 Level 19 街道與建築級縮放，提供四種免 Key 高畫質底圖切換（OSM 標準街道、Esri 深色夜間模式、Esri 衛星空照、OSM 暖色街道）、點選地圖直接標記座標，並自動繪製每日行程路線軌跡。
- **系統功能說明與操作手冊介面**：新增專用文件說明面板 (`DocsPanel`)，提供全站功能即時搜尋與分類指引（快速上手、時間軸、JSON 編輯、高精度地圖、權限管理與常見問答）。
- **環境變數通行碼自動載入**：支援透過 `TRIP_ADMIN_CODE` 與 `TRIP_VIEW_CODE` 環境變數自訂管理者與訪客訪問碼，相容 Docker compose 部署。
- **全方位測試覆蓋**：新增 Go 單元與整合測試 (`apps/api/handlers`, `apps/api/services/ai`, `apps/api/services/oidc`)，以及 `pnpm test:go` 與 `pnpm test:all` 整合測試指令，於 CI 流程全面驗證。
- **規格文件與規範指引**：建立 `.specs/pnpm-workspace-sdd.md`、`.specs/go-gin-api-sdd.md` 規格設計藍圖，以及 Changelog 管理規範 Skill (`.agents/skills/changelog/SKILL.md`)。

### Changed
- **Monorepo Workspace 架構**：重構為 pnpm monorepo workspace 架構 (`apps/web`, `apps/api`, `packages/shared`)，實現領域模型與驗證邏輯全端集中共享。
- **極輕量 Docker 映像檔**：更新 `docker/Dockerfile` 與 `docker/Dockerfile.prod` 為 Go 多階段編譯架構，以 Alpine 運行，映像檔體積縮減至約 25MB，記憶體佔用小於 20MB。
- **行動端版面與體驗優化**：優化手機版型排版，支援旅程天數與標籤頁（Tabs）橫向平滑滾動，並修復行動端側邊抽屜選單展開與收合時之陰影遮擋問題。
- **資料庫路徑規格化**：將 SQLite 資料庫路徑統一規格化至 `database/trips.sqlite`，並完整保留舊版 `data/` 相容自動遷移機制。
- **Skill 遷移**：將 AI Agent Skills 遷移至 `.agents/skills/`，提升各 AI 工具跨平台相容性。

### Fixed
- **地圖標記縮放失真修正**：修復地圖放大縮小時景點序號標記變形遮擋的問題，改採固定像素 DOM Marker 保持清晰尺寸。
- **底圖切換軌跡保留修復**：修復切換地圖樣式時底圖圖層重置導致當日路線軌跡消失的問題。
- **Docker 開發環境熱重載修復**：修正 Vite 在 Windows Docker 容器掛載下的檔案輪詢監聽，確保前端修改即時更新。

### Removed
- **移除舊版 Node.js 後端實作**：正式移除 `apps/api/src/` 與舊版 npm 配置，後端全權由 Go 原生服務接管。
- **移除前端 AI 助理功能**：依使用需求移除前端 AI 助理對話介面、相關選單與啟動健康檢查，簡化系統介面與運作負擔。
- **清理遺留程式碼與設定**：移除前端重複維護的領域模型、舊版 npm `package-lock.json`、舊版 `docker/Dockerfile.base` 與 `docker/Dockerfile.dev`。

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

[Unreleased]: https://github.com/JontCont/travel-site/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/JontCont/travel-site/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/JontCont/travel-site/releases/tag/v0.1.0
