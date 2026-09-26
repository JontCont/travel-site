# 途間｜旅程規劃

途間是一個用來規劃與整理旅程的網站，將多趟旅程、每日行程和時間軸集中管理。可記錄航班、住宿、旅客、行李與備忘事項；地圖路線資料不足或尚未驗證時，會清楚標示狀態。

每日行程項目可展開查看營業時間與備註；營業時間由管理員手動維護，只有填妥資訊來源與確認日期時才標示為已確認。

訪客可唯讀瀏覽旅程並編輯共用記事本；管理員通行碼可編輯完整旅程資料。資料儲存在 SQLite 資料庫。
登入狀態最長有效六個月，服務重啟後仍有效；更換對應的通行碼後，舊登入會失效。

## 本機啟動

需求：Node.js 24 與 npm。

1. 安裝相依套件：

   ```bash
   npm ci
   ```

2. 複製 `.env.example` 為 `.env`，設定不同且至少 16 個字元的 `TRIP_VIEW_CODE` 與 `TRIP_ADMIN_CODE`，並填入高德 JavaScript API Key（`AMAP_API_KEY`）。
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

`AMAP_API_KEY` 用於開啟高德 LightMap 的步行導航連結，建議在高德控制台限制可使用的網域。網站的「檢查步行路線」會向伺服器查詢路線距離與時間，需另外設定高德 Web 服務 Key `AMAP_WEB_KEY`；JavaScript API Key 不能取代它。未設定 Web 服務 Key 時，路線會明確保持未驗證。

停止服務：

```bash
docker compose down
```
