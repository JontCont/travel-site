# 途間｜旅程規劃

途間是一個用來規劃與整理旅程的網站，將多趟旅程、每日行程和時間軸集中管理。可記錄航班、住宿、旅客、行李與備忘事項；地圖路線資料不足或尚未驗證時，會清楚標示狀態。

每日行程項目可展開查看營業時間與備註；管理員也可將入境、提領行李等非地點流程標記為不顯示於地圖。營業時間由管理員手動維護，只有填妥資訊來源與確認日期時才標示為已確認。

住宿卡可檢視地址、電話、評分、參考價、資料來源與確認日期，以及按類別整理的飯店設施與服務；價格及設施資訊仍須以實際訂房頁面或飯店現場為準。登入方式有兩種：「Synology 登入」（DSM SSO，OAuth/OIDC）與「通行碼」。DSM 管理員可編輯完整旅程，並可產生訪客通行碼；其他 DSM 使用者為唯讀，可瀏覽全部旅程並編輯共用記事本；訪客通行碼同樣唯讀，只能瀏覽管理員指定的旅程。資料儲存在 SQLite 資料庫。
登入狀態最長有效六個月，服務重啟後仍有效；管理員撤銷訪客通行碼後，使用該通行碼的登入會立即失效。## 本機啟動

需求：Node.js 24 與 npm。

1. 安裝相依套件：

   ```bash
   npm ci
   ```

2. 複製 `.env.example` 為 `.env`，填入 Synology SSO 設定（見下方「Synology 登入設定」）與高德 JavaScript API Key（`AMAP_API_KEY`）。未設定 SSO 時，登入畫面會顯示尚未設定，無法進入網站。
3. 啟動開發伺服器：

   ```bash
   npm run dev
   ```

4. 開啟終端機顯示的本機網址。

## Docker Compose 啟動

在 `.env` 設定 Synology SSO 參數（見下方「Synology 登入設定」），並確認 `TRIP_IMAGE` 指向要使用的映像，例如 `ghcr.io/jontcont/travel-site:latest`。`docker-compose.yml` 只會把列在 `environment` 的變數傳入容器，新增設定時請一併加入。接著執行：

```bash
docker compose pull
docker compose up -d
```

`AMAP_API_KEY` 用於開啟高德 LightMap 的步行導航連結，建議在高德控制台限制可使用的網域。目前網站沒有步行檢查按鈕，行程中的交通線都會標示「移動時間尚未驗證」。伺服器仍保留 `/api/walk` 端點，查詢路線需另外設定高德 Web 服務 Key `AMAP_WEB_KEY`；JavaScript API Key 不能取代它。詳見 [walkable-map-routing](.github/skills/walkable-map-routing/SKILL.md)。

停止服務：

```bash
docker compose down
```

## Synology 登入設定

登入畫面提供兩個按鈕：「通行碼」與「Synology 登入」。Synology 登入使用 DSM 的 SSO Server 套件（OAuth 2.0 / OpenID Connect）。

1. 在 DSM 的 SSO Server 新增一個 OpenID Connect 用戶端。Redirect URI 必須與 `.env` 的 `TRIP_OIDC_REDIRECT_URI` 完全相同，例如 `https://<旅程網域>/api/auth/oidc/callback`。
2. 把用戶端 ID 與密鑰填入 `TRIP_OIDC_CLIENT_ID`、`TRIP_OIDC_CLIENT_SECRET`。`TRIP_OIDC_ISSUER` 填 `https://<NAS 網域>/webman/sso`。密鑰只放在 `.env`，不要提交到 git。
3. 重新啟動容器：`docker compose up -d`。

登入後的角色：

- 屬於 `TRIP_OIDC_ADMIN_GROUP`（預設 `administrators`）或列在 `TRIP_OIDC_ADMIN_USERS`（逗號分隔）的 DSM 使用者為管理員。
- 其他 DSM 使用者為唯讀（NAS 使用者）。
- 管理員可在「管理 → 訪客通行碼」產生通行碼並指定可瀏覽的旅程。通行碼只顯示一次，之後無法再取得原文；遺失時請撤銷後重新產生。

使用限制：

- Redirect URI 固定為 HTTPS 的旅程網域，因此無法用 `http://localhost` 或區網 IP（例如 `http://192.168.x.x:4187`）完成 Synology 登入。區網裝置可改用訪客通行碼。
- 容器必須能連到 NAS 的 HTTPS 位址，才能完成 token 交換與身分驗證。若連不回 NAS 網域，請檢查 NAT 迴流設定。
- 若透過反向代理或 Cloudflare 接入（本站目前經 Cloudflare），請在 `.env` 設定 `TRIP_TRUST_PROXY=1`，讓登入失敗次數限制以實際用戶端 IP 計算。程式會優先讀取 `CF-Connecting-IP`，其次取 `X-Forwarded-For` 最右側的值。使用此設定時，容器的 4187 埠不可被外網直接連到。

## 資料庫結構

資料庫檔案預設為 `data/trips.sqlite`，可用環境變數 `TRIP_DATABASE_PATH` 指定位置。啟動時會自動建立下列三張表（`CREATE TABLE IF NOT EXISTS`），不需要手動執行 migration。

```sql
-- 整個網站的旅程資料，只會有一列（id 固定為 1）
CREATE TABLE IF NOT EXISTS workspace (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data_json TEXT NOT NULL
);

-- 登入 session，只存 token 的 SHA-256 雜湊值
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('admin', 'viewer', 'code')),
  subject TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- 訪客通行碼，只存 SHA-256 雜湊值，原文只在建立時顯示一次
CREATE TABLE IF NOT EXISTS access_codes (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  trip_ids_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Synology 登入進行中的交易（state、nonce、PKCE verifier），十分鐘內有效
CREATE TABLE IF NOT EXISTS oidc_transactions (
  state_hash TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
```

說明：

- 設計初衷：旅程資料主要由 agent 讀寫，而不是靠使用者一筆一筆在畫面上操作。因此 `workspace.data_json` 採用整包 JSON，讓 agent 能一次讀取完整旅程、修改後整包寫回，不需要理解多張表之間的關聯，也不需要為每次結構改動撰寫 migration。
- 網頁介面是給人檢視與少量編輯用的；資料的結構以 `src/` 內的型別定義為準。
- `auth_sessions.role` 為 `admin`（DSM 管理員）、`viewer`（其他 DSM 使用者，唯讀）或 `code`（訪客通行碼）。`subject` 為 DSM 帳號或通行碼 id。
- `code` session 每次請求都會重新檢查通行碼是否仍存在；管理員撤銷通行碼時，會刪除該通行碼的所有 session。
- `expires_at` 為毫秒時間戳，session 有效期為六個月；登入時會順便清除已過期的 session 與 OIDC 交易。
- 升級注意：舊版 `auth_sessions` 含有 `credential_hash` 欄位，首次啟動新版時會刪除該表，既有登入會失效，需要重新登入一次。`TRIP_VIEW_CODE` 與 `TRIP_ADMIN_CODE` 已不再使用，可從 `.env` 移除。

備份時直接複製 `trips.sqlite` 即可。若服務在執行中，建議先停止容器再複製，避免讀到寫到一半的檔案。

## 寫入權限

容器以 `user: "1026:100"` 執行，且根檔案系統為唯讀，只有 `/data` 可寫。如果 `data/` 目錄或 `trips.sqlite` 的擁有者不是 UID 1026，登入、登出與 Synology 登入流程會失敗並回傳 500，錯誤訊息為 `attempt to write a readonly database`。
處理方式是把資料目錄的擁有者改為 `1026:100`，並只授權該帳號讀寫，不建議對 `Everyone` 開放完整權限。
