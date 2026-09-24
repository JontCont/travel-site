# 途間 · 多趟旅程規劃

React + Vite 的本機旅行規劃網站。MVP 支援多趟旅程、每日行程 timeline、跨旅程年月時間軸、依當地日期自動分類的排定／進行／封存狀態、航班、住宿、行李、旅客座位、每趟旅程獨立記事本，以及可明確標示未驗證狀態的步行路線規劃。

## 資料儲存

旅程資料存於專案下的 `data/trips.sqlite`，由本機 Vite API 讀寫。為保持 MVP 簡單，目前以單一 SQLite workspace 記錄保存整個旅程集合。沒有帳號、雲端同步或多人協作。

SQLite 檔案已加入 `.gitignore`，因為可能含有姓名、座位和行程等私人資料。備份或搬移專案時，請自行複製 `data/trips.sqlite`；不要公開分享。若資料庫是空的，網站會嘗試將舊版瀏覽器 `localStorage` 的 `travel-planner-v1` 資料遷移至 SQLite，原本的瀏覽器資料不會刪除。

目前資料庫包含福州之旅和 2026 年 5 月北京歷史行程。介面不提供新增旅程按鈕；新增旅程由維護流程寫入 SQLite，不再把整份旅程資料放在 TypeScript 原始碼。每日行程編輯仍可由介面操作並保存至資料庫。

## 執行與測試

使用支援 `node:sqlite` 的 Node.js 24，執行 `npm install` 與 `npm run dev`，再開啟終端機顯示的本機網址。`npm run build` 建置，`npm run preview` 預覽，`npm test` 執行旅程資料、SQLite 及路線 API 測試。

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
