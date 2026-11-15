# SDD: Go (Gin) API 重構設計規範 (Backend Migration)

- **目標分支**：`refactor/go-gin-backend`
- **後端架構**：Go + Gin Web Framework
- **資料庫**：SQLite (純 Go 驅動，目錄規格化為 `database/`)
- **核心指標**：記憶體佔用 < 20MB、啟動時間 < 20ms、零 CGO 依賴、完全相容現有前端 API 契約。

---

## 1. 輕量化框架分析與技術選型

### 為什麼選擇 Go (Gin) 而非 Ruby？
| 指標 | Ruby (Sinatra / Roda) | Node.js (原實作) | Go (Gin) (推薦選型) |
| :--- | :--- | :--- | :--- |
| **記憶體佔用 (RAM)** | 60MB ~ 120MB+ | 35MB ~ 50MB | **10MB ~ 20MB**（極低消耗） |
| **啟動時間** | 1 ~ 3 秒 | 300 ~ 800ms | **< 20ms**（即時啟動） |
| **執行檔型態** | 依賴 Ruby VM 與 Gems | 依賴 Node 執行期 | **單一靜態二進位檔 (Single Binary)** |
| **Docker 映像大小** | 100MB ~ 200MB | ~90MB | **~25MB** (基於 Alpine / Distroless) |
| **SQLite 整合** | 需編譯 C extension | Node 24 原生 | **純 Go 驅動 (modernc.org/sqlite，免 CGO)** |
| **NAS 運行適配度** | 較重、低功耗 CPU 吃力 | 普通 | **神級表現 (極致省電與低資源)** |

---

## 2. 目錄結構規劃 (apps/api)

```text
apps/api/
├── go.mod
├── go.sum
├── main.go                      # 入口檔 (監聽 PORT，靜態檔案託管與路由註冊)
├── config/                      # 環境變數載入與驗證 (SSO, AMap, Port 等)
│   └── config.go
├── database/                    # SQLite 儲存庫操作 (初始化 schema、查詢與事務)
│   └── db.go
├── models/                      # Go 結構體定義 (Workspace, AccessCode, AI, Auth)
│   ├── workspace.go
│   ├── auth.go
│   ├── access_code.go
│   └── ai.go
├── middleware/                  # 中間件 (Session 鑑權、角色防護、CORS/TrustProxy 限流)
│   ├── auth.go
│   └── ratelimit.go
├── handlers/                    # HTTP 端點處理器
│   ├── auth_handler.go          # /api/auth/* (Login, Logout, Status)
│   ├── oidc_handler.go          # /api/auth/oidc/* (Start, Callback, PKCE, DSM SSO)
│   ├── workspace_handler.go     # /api/workspace (GET, PUT, Notepad PATCH)
│   ├── access_code_handler.go   # /api/access-codes (CRUD, 訪客碼管理)
│   ├── walk_handler.go          # /api/walk & /api/map-config (高德地圖步行代理)
│   └── ai_handler.go            # /api/ai/* (Settings, Availability, Assist, Skills)
└── services/                    # 業務邏輯服務
    ├── oidc/                    # OIDC Discovery, PKCE, Token 驗證
    └── ai/                      # AI Provider 調度, AES-GCM 金鑰加解密, Skills 載入
```

---

## 3. 資料庫規範調整 (`database/`)

- 專案資料庫目錄由 `data/` 規格化為 **`database/`**。
- SQLite 檔案預設路徑：`database/trips.sqlite`。
- 環境變數 `TRIP_DATABASE_PATH` 預設值調整為 `database/trips.sqlite`。
- Docker Volume 掛載：`./database:/database`。

---

## 4. API 規格與相容性保證 (Contract Parity)

Go (Gin) 實作必須 100% 相容既有的前端契約與 83 項測試場景：
1. **認證與授權 (Auth & Roles)**：
   - Session Cookie: `trip_session` (6 個月有效期，SHA-256 Hash 存於 DB)。
   - 角色：`admin`、`viewer`、`code`。
   - 失敗關閉 (Fail-Closed)：SSO 未設定時，登入與資料端點返回 503。
   - 訪客通行碼：支援 7、30、90 天或永久過期控制；撤銷後立即失效。
2. **安全規範**：
   - AI Key 儲存：AES-256-GCM + HKDF 金鑰衍生。
   - 代理標頭：`TRIP_TRUST_PROXY=1` 時以 `CF-Connecting-IP` / `X-Forwarded-For` 計算限流。
3. **靜態檔案託管**：
   - 託管 `apps/web/dist`，支援 SPA 路由回退 (`index.html`)。

---

## 5. 重構執行檢核表 (Roadmap)

- [x] 建立並切換至新開發分支 `refactor/go-gin-backend`。
- [x] 規格化資料庫目錄為 `database/`。
- [x] 初始化 `apps/api` 的 Go 模組 (`go.mod`) 與 Gin 相依。
- [x] 實作 SQLite 連線、Schema 自動建立與 Session 管理。
- [x] 實作 OIDC (DSM SSO) 與訪客通行碼認證機制。
- [x] 實作 Workspace 與地圖導航 API。
- [x] 實作 AI 助手服務與 AES-256-GCM 金鑰管理。
- [x] 實作 SPA 靜態檔案服務與 SPA Fallback。
- [x] 更新 Dockerfile（Go 多階段編譯）與 docker-compose。
- [x] 驗證前端、API、測試與 Docker 建置全數通過。
