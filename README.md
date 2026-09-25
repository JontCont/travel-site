# 途間 · 多趟旅程規劃

React + Vite 的 NAS 旅程規劃網站。支援多趟旅程、每日行程 timeline、跨旅程年月時間軸、依當地日期自動分類的排定／進行／封存狀態、航班、住宿、行李、旅客座位、每趟旅程獨立記事本，以及可明確標示未驗證狀態的步行路線規劃。

## 資料儲存

旅程資料存於 NAS 專案下的 `data/trips.sqlite`，由 Node API 讀寫。以單一 SQLite workspace 保存整個旅程集合。現階段網站使用訪客／管理員兩種共用通行碼：訪客可查看所有旅程，管理員可編輯；Synology SSO/OIDC 尚未接上。兩種通行碼都必須由 NAS 環境變數設定，且至少 16 個字元、彼此不同；未設定時 API 會拒絕存取旅程資料。

SQLite 檔案已加入 `.gitignore`，因為可能含有姓名、座位和行程等私人資料。備份或搬移專案時，請自行複製 `data/trips.sqlite`；不要公開分享。管理員登入時，若 SQLite 尚無 workspace，網站可嘗試將舊版瀏覽器 `localStorage` 的 `travel-planner-v1` 資料遷移至 SQLite；訪客登入不會遷移或寫入資料。

共用訪客通行碼可查看旅程中的旅客姓名、座位、航班及記事本；只應提供給你信任的人。管理員通行碼具有完整行程編輯權限，請勿與訪客共用。

## Docker Compose 部署

GitHub Pages 只能託管靜態檔案，無法執行此專案需要的 Node API 或 SQLite。NAS 請使用支援 Docker Compose 的 Container Manager；Node.js 24 會在映像中執行，NAS 主機不必另外安裝 Node.js。

- 複製 `.env.example` 為 `.env`，設定彼此不同、至少 16 個字元的隨機 `TRIP_VIEW_CODE` 與 `TRIP_ADMIN_CODE`。不要使用已在聊天中貼出的短碼。
- 將 `TRIP_IMAGE` 改成 `ghcr.io/<GitHub擁有者>/<repository>:latest`；GitHub Actions 會在 `main` 分支的檢查全部通過後，自動發布此 GHCR 映像。
- `TRIP_BIND_IP` 預設為 `192.168.0.18`；請改成 NAS 實際的區域網路 IP。
- `TRIP_UID`、`TRIP_GID` 預設為 `1000`；需讓該 UID/GID 對 NAS 上的 `data/` 資料夾有讀寫權限。
- `AMAP_WEB_KEY` 選填；只有需要高德步行路線查詢時才設定。

把既有 `data/trips.sqlite` 放進 NAS 專案的 `data/` 資料夾後，從專案目錄執行 `docker compose pull`，再執行 `docker compose up -d`。之後每次 GitHub Actions 發布成功，NAS 再執行這兩個指令即可更新到 `latest`。容器會將 NAS 的 `192.168.0.18:4187` 導到 Node 伺服器；Cloudflare Tunnel 的服務位址可設為 `http://192.168.0.18:4187`，公開網址則使用 `https://travel.startfms.uk`。Tunnel 對外使用 HTTPS，應用程式啟用 Secure cookie；不要另開路由器的公網連接埠或使用未加密的公網 HTTP。

Compose 預設只公開指定的 NAS 區網 IP，資料庫以 `./data:/app/data` 掛載持久化，且容器以非 root 使用者執行。請將 `data/` 權限設為 `.env` 中的 UID/GID 可讀寫。可用 `docker compose logs -f travel-site` 查看啟動錯誤，停止服務則執行 `docker compose down`。

GHCR package 預設可能是 private；若 NAS 尚未登入 GitHub Container Registry，請將該 package 設為 public，否則先在 NAS 執行 `docker login ghcr.io` 並使用具備該 package 讀取權限的 token。

登入 session 使用 HttpOnly、SameSite=Strict cookie，12 小時後過期，伺服器重啟時會失效；登入錯誤會觸發暫時限流。每個持有管理員碼的人都能編輯所有旅程。

## 本機開發與測試

使用支援 `node:sqlite` 的 Node.js 24。先設定至少 16 個字元且彼此不同的 `TRIP_VIEW_CODE` 和 `TRIP_ADMIN_CODE`，再執行 `npm install`、`npm run dev`，並開啟終端機顯示的本機網址。不要將通行碼寫進程式碼、提交到 Git 或放在 `VITE_` 前綴的前端環境變數中。

`npm run build` 建置，`npm start` 以 NAS 用的 Node HTTP 伺服器提供建置檔與 API，`npm run preview` 僅供本機預覽，`npm test` 執行旅程資料、SQLite、驗證權限及路線 API 測試。

## 地圖路線

目前右側地圖為**示意圖，不是真實地圖**；地點連結可在高德查看。若要驗證步行路線，先至[高德開放平台](https://lbs.amap.com/api/webservice/guide/api/newroute)申請 **Web 服務 API Key**，並在啟動 Vite 的同一個 PowerShell 終端機設定 `$env:AMAP_WEB_KEY = '你的金鑰'`。金鑰只由本機 Vite 伺服器使用，不要填入網頁或寫進程式碼。

路線驗證前需提供正確的高德 GCJ-02 座標、每段與每日步行上限、替代交通方式及是否包含住宿起終點。資料不足時會保持未驗證，不會將直線距離當成步行路線。北京歷史行程目前沒有地點座標，因此不會顯示已驗證路線。

航班、住宿及旅遊資訊依使用者提供內容儲存，網站尚未連線驗證航班異動、訂房狀態或景點開放資訊。

## 程式結構

- `src/models/`：旅程、每日停留、航班、旅客與步行路段的核心型別。
- `src/dto/`：前端與本機 API／SQLite 共用的資料傳輸型別及輸入驗證。
- `src/services/`：建立旅程、日期處理、workspace 載入／保存、舊版資料遷移與步行限制檢查。
- `src/App.tsx`：畫面與互動；不要把資料模型或儲存流程再塞回 `src/` 根目錄。
- `src/*.scss`：全域與畫面樣式，透過 Sass 編譯。
