# 途間｜旅程規劃

途間是一個用來規劃與整理旅程的網站，將多趟旅程、每日行程和時間軸集中管理。可記錄航班、住宿、旅客、行李與備忘事項；地圖路線資料不足或尚未驗證時，會清楚標示狀態。

每日行程項目可展開查看營業時間與備註；管理員也可將入境、提領行李等非地點流程標記為不顯示於地圖。營業時間由管理員手動維護，只有填妥資訊來源與確認日期時才標示為已確認。

住宿卡可檢視地址、電話、評分、參考價、資料來源與確認日期，以及按類別整理的飯店設施與服務；價格及設施資訊仍須以實際訂房頁面或飯店現場為準。訪客可唯讀瀏覽旅程並編輯共用記事本；管理員通行碼可編輯完整旅程資料。資料儲存在 SQLite 資料庫。
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

`AMAP_API_KEY` 用於開啟高德 LightMap 的步行導航連結，建議在高德控制台限制可使用的網域。目前網站沒有步行檢查按鈕，行程中的交通線都會標示「移動時間尚未驗證」。伺服器仍保留 `/api/walk` 端點，查詢路線需另外設定高德 Web 服務 Key `AMAP_WEB_KEY`；JavaScript API Key 不能取代它。詳見 [walkable-map-routing](.github/skills/walkable-map-routing/SKILL.md)。

停止服務：

```bash
docker compose down
```

## 資料庫結構

資料庫檔案預設為 `data/trips.sqlite`，可用環境變數 `TRIP_DATABASE_PATH` 指定位置。啟動時會自動建立下列兩張表（`CREATE TABLE IF NOT EXISTS`），不需要手動執行 migration。

```sql
-- 整個網站的旅程資料，只會有一列（id 固定為 1）
CREATE TABLE IF NOT EXISTS workspace (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data_json TEXT NOT NULL
);

-- 登入 session，token 與通行碼都只存 SHA-256 雜湊值
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
  credential_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
```

說明：

- 設計初衷：旅程資料主要由 agent 讀寫，而不是靠使用者一筆一筆在畫面上操作。因此 `workspace.data_json` 採用整包 JSON，讓 agent 能一次讀取完整旅程、修改後整包寫回，不需要理解多張表之間的關聯，也不需要為每次結構改動撰寫 migration。
- 網頁介面是給人檢視與少量編輯用的；資料的結構以 `src/` 內的型別定義為準。
- `auth_sessions.role` 只能是 `viewer`（訪客）或 `admin`（管理員）。
- `credential_hash` 記錄登入時使用的通行碼雜湊。更換通行碼後，與舊雜湊不符的 session 會失效。
- `expires_at` 為毫秒時間戳，session 有效期為六個月；登入時會順便清除已過期的 session。

備份時直接複製 `trips.sqlite` 即可。若服務在執行中，建議先停止容器再複製，避免讀到寫到一半的檔案。

## 寫入權限

容器以 `user: "1026:100"` 執行，且根檔案系統為唯讀，只有 `/data` 可寫。如果 `data/` 目錄或 `trips.sqlite` 的擁有者不是 UID 1026，登入與登出會失敗並回傳 500，錯誤訊息為 `attempt to write a readonly database`。

處理方式是把資料目錄的擁有者改為 `1026:100`，並只授權該帳號讀寫，不建議對 `Everyone` 開放完整權限。
