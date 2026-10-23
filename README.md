# 途間｜旅程規劃

途間是一個用來規劃與整理旅程的網站，將多趟旅程、每日行程和時間軸集中管理。可記錄航班、住宿、旅客、行李與備忘事項；地圖路線資料不足或尚未驗證時，會清楚標示狀態。

每日行程項目可展開查看營業時間與備註；管理員也可將入境、提領行李等非地點流程標記為不顯示於地圖。營業時間由管理員手動維護，只有填妥資訊來源與確認日期時才標示為已確認。

住宿卡可檢視地址、電話、評分、參考價、資料來源與確認日期，以及按類別整理的飯店設施與服務；價格及設施資訊仍須以實際訂房頁面或飯店現場為準。登入方式有兩種：「Synology 登入」（DSM SSO，OAuth/OIDC）與「通行碼」。DSM 管理員可編輯完整旅程、產生訪客通行碼，並可使用 AI 助手（設定見「AI 助手」一節）；其他 DSM 使用者為唯讀，可瀏覽全部旅程並編輯共用記事本；訪客通行碼同樣唯讀，只能瀏覽管理員指定的旅程。管理員可在個別旅程開放 AI 詢問給一般使用者（僅能提問，不會修改行程）。資料儲存在 SQLite 資料庫。
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
- 管理員可在「管理 → 訪客通行碼」產生通行碼並指定可瀏覽的旅程，同時選擇到期時間（7、30、90 天或永久）。通行碼只顯示一次，之後無法再取得原文；遺失時請撤銷後重新產生。
- 已產生的通行碼可以編輯可瀏覽的旅程與到期時間，變更立即生效，不需要重新產生通行碼。通行碼到期後，該碼的登入會立即失效；管理員可再編輯到期時間讓它重新生效，但訪客需要重新登入。

使用限制：

- Redirect URI 固定為 HTTPS 的旅程網域，因此無法用 `http://localhost` 或區網 IP（例如 `http://192.168.x.x:4187`）完成 Synology 登入。區網裝置可改用訪客通行碼。
- 容器必須能連到 NAS 的 HTTPS 位址，才能完成 token 交換與身分驗證。若連不回 NAS 網域，請檢查 NAT 迴流設定。
- 若透過反向代理或 Cloudflare 接入（本站目前經 Cloudflare），請在 `.env` 設定 `TRIP_TRUST_PROXY=1`，讓登入失敗次數限制以實際用戶端 IP 計算。程式會優先讀取 `CF-Connecting-IP`，其次取 `X-Forwarded-For` 最右側的值。使用此設定時，容器的 4187 埠不可被外網直接連到。

## AI 助手

管理員可在側邊欄「管理 → AI 設定」設定 AI 服務商。設定存在 SQLite，不需要 `.env`。尚未完成設定時，「AI 助手」按鈕不會顯示。

- 服務商：OpenAI 相容 API（可自訂 Base URL，必須是 `https://`）、OpenRouter、Anthropic Claude、Google Gemini。模型名稱由管理員自行填入。
- 功能（側邊欄「AI 助手」）：
  - 生成行程：依目的地、日期與偏好建立新旅程，預覽並可修改標題後才會建立。
  - 推薦當日景點：針對指定日期推薦景點，勾選後加入行程；加入後當日景點會依時間重新排序。
  - 檢查衝突：列出行程中可能的時間或安排問題，只顯示結果，不會修改資料。
  - 整理記事本：預覽後才會覆蓋記事本。
- 一般使用者（DSM 一般使用者與訪客通行碼）：只能在管理員開放的旅程使用「詢問」，可針對行程與記事本提問，回答只顯示在畫面上，不會修改行程。管理員在各旅程的「設定」分頁勾選「開放 AI 助理詢問給一般使用者」即可開放，預設關閉。其餘三種功能僅限管理員使用。
- AI 會參考 `.github/skills/` 內的 travel-plan-foundation、itinerary-timeline、walkable-map-routing、travel-record-writing、trip-photo-album 等 skill 作為指引。Docker 映像會包含這五個 `SKILL.md`。

資料與金鑰：

- **旅程資料會送到你選擇的服務商。** 每次 AI 請求都會送出該旅程的行程、記事本等內容。不會送出旅伴、班機、相簿連結與通行碼。請只選擇你信任的服務商。
- API Key 以 AES-256-GCM 加密後存在 `ai_settings`。加密金鑰會在第一次儲存 AI 設定時自動產生，存在 `ai_secret` 表，與旅程資料位於同一個 `trips.sqlite`。因此備份 `trips.sqlite` 等同同時備份金鑰與加密後的 API Key，請把備份當作機密保存。
- 變更服務商時必須重新輸入 API Key。同一服務商更新其他欄位時，留空 API Key 會沿用已儲存的金鑰。
- 一般使用者的詢問同樣使用管理員設定的 API Key 並計入其費用，目前沒有每人次數限制。
- OpenAI 相容服務的 Base URL 可指向任何 `https://` 位址，因此 AI 設定只開放給管理員。

## 資料庫結構

資料庫檔案預設為 `data/trips.sqlite`，可用環境變數 `TRIP_DATABASE_PATH` 指定位置。啟動時會自動建立下列資料表（`CREATE TABLE IF NOT EXISTS`），不需要手動執行 migration。

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

-- 訪客通行碼，只存 SHA-256 雜湊值，原文只在建立時顯示一次；expires_at 為毫秒時間戳，NULL 表示永久
CREATE TABLE IF NOT EXISTS access_codes (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  trip_ids_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at INTEGER
);

-- Synology 登入進行中的交易（state、nonce、PKCE verifier），十分鐘內有效
CREATE TABLE IF NOT EXISTS oidc_transactions (
  state_hash TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- AI 服務商設定，只會有一列（id 固定為 1）；API Key 以 ai_secret 的金鑰加密後儲存
CREATE TABLE IF NOT EXISTS ai_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  provider TEXT NOT NULL,
  base_url TEXT,
  model TEXT NOT NULL,
  api_key_encrypted TEXT,
  updated_at TEXT NOT NULL
);

-- AI API Key 的加密金鑰，只會有一列；第一次儲存 AI 設定時自動產生
CREATE TABLE IF NOT EXISTS ai_secret (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  secret TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

說明：

- 設計初衷：旅程資料主要由 agent 讀寫，而不是靠使用者一筆一筆在畫面上操作。因此 `workspace.data_json` 採用整包 JSON，讓 agent 能一次讀取完整旅程、修改後整包寫回，不需要理解多張表之間的關聯，也不需要為每次結構改動撰寫 migration。
- 網頁介面是給人檢視與少量編輯用的；資料的結構以 `src/` 內的型別定義為準。
- `auth_sessions.role` 為 `admin`（DSM 管理員）、`viewer`（其他 DSM 使用者，唯讀）或 `code`（訪客通行碼）。`subject` 為 DSM 帳號或通行碼 id。
- `code` session 每次請求都會重新檢查通行碼是否仍存在且未到期；管理員撤銷通行碼，或通行碼到期時，會刪除該通行碼的所有 session。到期的通行碼登入會回傳 403，且不計入登入失敗次數。
- `expires_at` 為毫秒時間戳，session 有效期為六個月；登入時會順便清除已過期的 session 與 OIDC 交易。
- 升級注意：舊版 `auth_sessions` 含有 `credential_hash` 欄位，首次啟動新版時會刪除該表，既有登入會失效，需要重新登入一次。既有的 `access_codes` 會自動新增 `expires_at` 欄位，原有通行碼維持永久有效。`TRIP_VIEW_CODE` 與 `TRIP_ADMIN_CODE` 已不再使用，可從 `.env` 移除。

備份時直接複製 `trips.sqlite` 即可。若服務在執行中，建議先停止容器再複製，避免讀到寫到一半的檔案。

## 寫入權限

容器以 `user: "1026:100"` 執行，且根檔案系統為唯讀，只有 `/data` 可寫。如果 `data/` 目錄或 `trips.sqlite` 的擁有者不是 UID 1026，登入、登出與 Synology 登入流程會失敗並回傳 500，錯誤訊息為 `attempt to write a readonly database`。
處理方式是把資料目錄的擁有者改為 `1026:100`，並只授權該帳號讀寫，不建議對 `Everyone` 開放完整權限。
