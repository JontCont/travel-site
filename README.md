# 途間｜旅程規劃

途間是一個用來規劃與整理旅程的網站，將多趟旅程、每日行程和時間軸集中管理。可記錄航班、住宿、旅客、行李與備忘事項；地圖路線資料不足或尚未驗證時，會清楚標示狀態。

旅程可透過訪客通行碼唯讀瀏覽，管理員通行碼則可編輯。資料儲存在 SQLite 資料庫。
登入狀態最長有效六個月，服務重啟後仍有效；更換對應的通行碼後，舊登入會失效。

## 本機啟動

需求：Node.js 24 與 npm。

1. 安裝相依套件：

   ```bash
   npm ci
   ```

2. 複製 `.env.example` 為 `.env`，設定不同且至少 16 個字元的 `TRIP_VIEW_CODE` 與 `TRIP_ADMIN_CODE`。
3. 啟動開發伺服器：

   ```bash
   npm run dev
   ```

4. 開啟終端機顯示的本機網址。

## Docker Compose 啟動

在 `.env` 設定訪客與管理員通行碼，並確認 `TRIP_IMAGE` 指向要使用的映像，例如 `ghcr.io/jontcont/travel-site:latest`。接著執行：

```bash
docker compose pull
docker compose up -d
```

停止服務：

```bash
docker compose down
```
