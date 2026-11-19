<div align="center">

# 途間｜Travel Planner

**把每一趟出國與旅行，整理成清晰、可檢視、好分享的每日行程時間軸。**

Multi-Trip Workspace · Daily Timeline · Walkable Routing · AI Assistant · Self-Hosted

</div>

**途間** 是一個自架設（Self-Hosted）的個人與親友旅程規劃網站。它將分散在各處的航班資訊、飯店住宿、每日景點時間軸、步行移動路線與旅途隨手筆記，收斂進同一個乾淨直覺的工作區。

不論是行前排定每日動線、旅途中隨時翻看下一站的交通與停留資訊，或是透過唯讀連結將行程分享給同行旅伴，都能在同一個介面上輕鬆完成，不必再於零散的對話紀錄、試算表與地圖書籤之間來回切換。

## 特色

| 能力 | 帶來的效果 |
| --- | --- |
| 多趟旅程集中管理 | 統一管理過往與即將出發的跨國旅程，支援不同目的地時區與日期跨度 |
| 每日行程時間軸 | 以直覺的時間軸串聯每日景點、交通移動與停留備註，動線一目了然 |
| 旅途資訊一站整合 | 集中收納來回航班、住宿飯店、隨行旅伴清單與共用記事本 |
| 地圖與步行距離輔助 | 整合跨區地圖檢視與相鄰站點的步行距離預估，避免排入過度疲勞的動線 |
| 旅途相簿嵌入 | 支援嵌入外部相簿分享頁，將行程紀錄與旅途照片保存在同一處 |
| AI 行程助手 | 可自選串接主流 LLM 服務，協助草擬初步行程、推薦當日景點、整理筆記或回答旅伴提問 |
| 彈性分享與檢視 | 支援 OIDC 單一登入與唯讀訪客通行碼，安心分享給同行親友而不怕誤改行程 |

## 技術架構

- **Frontend**：React 19、TypeScript、Vite
- **Backend**：Node.js 24（內建 HTTP Server 與 `node:sqlite`）
- **Deployment**：Docker / Docker Compose

## 快速開始

### 本機開發

需求：Node.js 24 與 `pnpm`。

1. 安裝相依套件：

   ```bash
   pnpm install
   ```

2. 複製環境變數範本並填入必要設定：

   ```bash
   cp .env.example .env
   ```

3. 啟動開發伺服器：

   ```bash
   pnpm dev
   ```

### Docker 部署

```bash
# 開發環境（支援熱重載）
docker compose -f docker/docker-compose.dev.yml up --build

# 生產環境
docker compose -f docker/docker-compose.prod.yml up -d
```

## 環境變數

部署或本機啟動前，請將 `.env.example` 複製為 `.env` 並依需求調整：

| 變數名稱 | 必填 | 說明 |
| --- | --- | --- |
| `TRIP_OIDC_ISSUER` | 是 | OIDC 身分驗證服務的 Issuer URL |
| `TRIP_OIDC_CLIENT_ID` | 是 | OIDC 應用程式的 Client ID |
| `TRIP_OIDC_CLIENT_SECRET` | 是 | OIDC 應用程式的 Client Secret |
| `TRIP_OIDC_REDIRECT_URI` | 是 | OIDC 登入完成後的回呼網址（如 `https://your-domain/api/auth/oidc/callback`） |
| `TRIP_OIDC_ADMIN_USERS` | 否 | 指定擁有管理權限的帳號清單（以逗號分隔） |
| `TRIP_OIDC_ADMIN_GROUP` | 否 | 指定擁有管理權限的群組名稱（預設為 `administrators`） |
| `AMAP_API_KEY` | 否 | 高德地圖 JavaScript API Key（供中國大陸行程開啟地圖導航使用） |
| `AMAP_WEB_KEY` | 否 | 高德地圖 Web 服務 API Key（供路線步行距離查詢使用） |
| `TRIP_TRUST_PROXY` | 否 | 若部署於反向代理後方，設為 `1` 以啟用代理標頭信任 |
| `TRIP_IMAGE` | 否 | Docker 生產環境部署時使用的容器映像檔名稱 |
| `TRIP_DATABASE_PATH` | 否 | 自訂 SQLite 資料庫檔案儲存路徑（預設為 `data/trips.sqlite`） |
| `PORT` | 否 | 伺服器監聽埠號（預設為 `4187`） |

## 常用指令

| 指令 | 說明 |
| --- | --- |
| `pnpm dev` | 啟動本機開發環境 |
| `pnpm build` | 執行 TypeScript 型別檢查並建置前端靜態檔案 |
| `pnpm start` | 啟動生產環境伺服器 |
| `pnpm test` | 執行單元與整合測試 |
