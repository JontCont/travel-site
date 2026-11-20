import { useState, useMemo } from 'react'
import {
  AlertTriangleIcon,
  CalendarGridIcon,
  CloseIcon,
  CodeBracesIcon,
  CompassRocketIcon,
  HelpCircleIcon,
  InfoCircleIcon,
  KeyShieldIcon,
  MapPinIcon,
  PlaneIcon,
  SearchIcon,
} from './Icons'

interface DocSection {
  id: string
  title: string
  icon: React.ReactNode
  category: string
  badge?: string
  content: React.ReactNode
}

export function DocsPanel() {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('all')

  const sections: DocSection[] = useMemo(
    () => [
      {
        id: 'getting-started',
        title: '快速入門與介面導覽',
        icon: <CompassRocketIcon size={20} />,
        category: '入門',
        content: (
          <div className="doc-article">
            <p className="lead-text">
              <strong>途間 (TRIP STUDIO)</strong> 是為私人出國旅行量身打造的私有化行程管理系統。支援 Synology NAS 部署與本機 Docker 運行，所有旅程、航班、地圖與筆記資料皆保存在私有 SQLite 資料庫中。
            </p>

            <div className="doc-grid-2">
              <div className="doc-feature-card">
                <h4>旅程總覽與時間軸</h4>
                <p>首頁提供兩種檢視模式：</p>
                <ul>
                  <li><strong>旅程卡片</strong>：卡片式陳列進行中與預定的旅程，可直觀查看目的地、天數、景點數與當地時區。</li>
                  <li><strong>旅程時間軸</strong>：依月份與年份將旅程依時間先後排序，清楚回顧與展望每一趟出國計畫。</li>
                </ul>
              </div>

              <div className="doc-feature-card">
                <h4>角色與權限機制</h4>
                <ul>
                  <li><strong>系統管理員 (Admin)</strong>：擁有最高權限，可建立與編輯行程、管理景點座標、發放訪客通行碼、使用 VS Code JSON 編輯器直接調整資料庫。</li>
                  <li><strong>一般訪客 (Viewer)</strong>：使用訪客通行碼或 DSM 一般帳號登入，僅能檢視被授權的旅程，並擁有個人的獨立記事本。</li>
                </ul>
              </div>
            </div>

            <div className="doc-callout info">
              <span className="callout-icon"><InfoCircleIcon size={18} /></span>
              <div>
                <strong>行動裝置支援</strong>：系統針對手機與平板進行完整響應式優化，包含平滑橫向滾動的每日分頁、可收合的抽屜式側邊選單與友善的觸控點擊熱區。
              </div>
            </div>
          </div>
        ),
      },
      {
        id: 'itinerary',
        title: '每日行程與景點規劃',
        icon: <CalendarGridIcon size={20} />,
        category: '行程',
        badge: '核心功能',
        content: (
          <div className="doc-article">
            <p>
              每日行程是規劃旅程的核心頁面，以直觀的時間軸陳列景點、交通移動與航班銜接。
            </p>

            <div className="doc-steps">
              <div className="doc-step">
                <span className="step-badge">1</span>
                <div>
                  <strong>新增景點與時間排定</strong>
                  <p>點選「＋ 新增景點」即可建立行程項目。輸入景點名稱、抵達時間 (24小時制，如 <code>10:30</code>) 與預估停留分鐘數 (duration)。系統會自動依時間順序排序。</p>
                </div>
              </div>

              <div className="doc-step">
                <span className="step-badge">2</span>
                <div>
                  <strong>排序調整與編輯</strong>
                  <p>管理員可隨時點選「編輯」修改詳細內容，或透過「上移」與「下移」快捷按鈕快速調整同一時段景點的前後順序。</p>
                </div>
              </div>

              <div className="doc-step">
                <span className="step-badge">3</span>
                <div>
                  <strong>營業時間與核實狀態</strong>
                  <p>支援填寫營業時間（如 <code>09:00–18:00，週二公休</code>），並標註「已確認」或「待確認」狀態及資料來源，避免撲空。</p>
                </div>
              </div>

              <div className="doc-step">
                <span className="step-badge">4</span>
                <div>
                  <strong>路線導航與一鍵複製</strong>
                  <p>景點地址旁設有複製按鈕，方便複製貼入當地地圖 App；兩景點之間提供 Google 地圖步行/大眾運輸/開車路線以及高德地圖跳轉連結。</p>
                </div>
              </div>
            </div>

            <div className="doc-callout warning">
              <span className="callout-icon"><AlertTriangleIcon size={18} /></span>
              <div>
                <strong>時段衝突警示</strong>：當相鄰景點的停留時間與下一個景點重疊，或與當日起飛/返程航班時間衝突時，系統會以顯眼的橘紅色橫條提醒調整預留時間。
              </div>
            </div>
          </div>
        ),
      },
      {
        id: 'location-map',
        title: '地點地圖與座標標記 (React Simple Maps)',
        icon: <MapPinIcon size={20} />,
        category: '地圖',
        badge: '新增',
        content: (
          <div className="doc-article">
            <p>
              採用 <code>react-simple-maps</code> 向量地圖引擎，內建打包世界地理數據，完全離線私有化運作，無須載入外部公網圖磚。
            </p>

            <div className="doc-grid-2">
              <div className="doc-feature-card">
                <h4>向量圖層與路線軌跡</h4>
                <ul>
                  <li><strong>順序標記圖釘</strong>：地圖上以帶數字的圓形圖釘（<code>1</code>、<code>2</code>、<code>3</code>...）標示每日景點造訪順序。</li>
                  <li><strong>住宿圖釘</strong>：若已填寫住宿飯店座標，會顯示專屬飯店標記。</li>
                  <li><strong>每日路線虛線</strong>：切換至單日檢視時，地圖會自動繪製連接各景點的行走路徑虛線。</li>
                </ul>
              </div>

              <div className="doc-feature-card">
                <h4>點擊地圖標記新地點</h4>
                <ul>
                  <li><strong>地圖點選拾取座標</strong>：點擊「標記新地點」進入標記模式，在世界地圖上任一點按即可精準捕獲經緯度（精確度達小數點後 5 位）。</li>
                  <li><strong>直接新增景點</strong>：右側表單會自動代入座標，填入名稱與時間後可直接存入指定天數。</li>
                  <li><strong>現有景點補齊座標</strong>：清單中未帶座標的景點可點「點地圖標記」，在地圖上點一下立即完成座標綁定。</li>
                </ul>
              </div>
            </div>

            <div className="doc-callout info">
              <span className="callout-icon"><InfoCircleIcon size={18} /></span>
              <div>
                <strong>視角操控技巧</strong>：地圖支援使用滑鼠滾輪或右上角 <code>＋</code> / <code>−</code> 縮放，滑鼠左鍵可拖曳平移地圖；點選 <code>置中對齊</code> 可瞬間將視角自動置中於當前旅程的所有景點分佈。
              </div>
            </div>
          </div>
        ),
      },
      {
        id: 'json-editor',
        title: 'VS Code 核心 Monaco JSON 行程編輯器',
        icon: <CodeBracesIcon size={20} />,
        category: '編輯器',
        badge: '進階',
        content: (
          <div className="doc-article">
            <p>
              整合 VS Code 原生核心 <code>Monaco Editor</code>（深色模式 <code>vs-dark</code>），讓技術使用者與管理員能夠以最高效率透過 JSON 批量檢視、修改或備份行程。
            </p>

            <div className="doc-grid-2">
              <div className="doc-feature-card">
                <h4>雙重模式切換</h4>
                <ul>
                  <li><strong>當前旅程 (<code>trip-xxxx.json</code>)</strong>：只聚焦在當前選取的旅程，可直接批次修改每日景點、日期、航班、住宿或行李欄位。</li>
                  <li><strong>全部工作區 (<code>workspace.json</code>)</strong>：展開整個資料庫結構，適合將舊行程快速匯入或備份。</li>
                </ul>
              </div>

              <div className="doc-feature-card">
                <h4>即時診斷與防呆防護</h4>
                <ul>
                  <li><strong>語法驗證</strong>：即時提示 JSON 括號或逗點語法錯誤。</li>
                  <li><strong>結構防呆</strong>：自動比對 DTO 定義，若日期格式不符 (非 <code>YYYY-MM-DD</code>)、<code>endDate</code> 早於 <code>startDate</code> 或缺少必要 key，下方會彈出詳細問題清單並阻止儲存，確保資料庫安全。</li>
                </ul>
              </div>
            </div>

            <h4>鍵盤快捷鍵一覽</h4>
            <div className="doc-table-wrap">
              <table className="doc-table">
                <thead>
                  <tr>
                    <th>快捷鍵</th>
                    <th>操作動作</th>
                    <th>說明</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><kbd>Ctrl</kbd> + <kbd>S</kbd> / <kbd>Cmd</kbd> + <kbd>S</kbd></td>
                    <td><strong>儲存並套用</strong></td>
                    <td>在編輯器內隨時按下即可完成驗證並同步寫入 SQLite 資料庫。</td>
                  </tr>
                  <tr>
                    <td><kbd>Shift</kbd> + <kbd>Alt</kbd> + <kbd>F</kbd> 或點擊 <code>格式化</code></td>
                    <td><strong>自動排版</strong></td>
                    <td>依 2 格縮排標準自動對齊所有 JSON 節點。</td>
                  </tr>
                  <tr>
                    <td>點擊 <code>還原</code></td>
                    <td><strong>放棄修改</strong></td>
                    <td>還原至資料庫目前保存的最新內容。</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h4>怎麼撰寫：先選模式，再改內容</h4>
            <ol>
              <li>在左側選單進入 <code>JSON 編輯器</code>（僅管理員可見）。</li>
              <li>上方切換 <code>當前旅程</code>（只含這一趟旅程）或 <code>全部工作區</code>（含 <code>trips</code> 與 <code>activeTripId</code>）。一般修改請用「當前旅程」，風險較小。</li>
              <li>直接在編輯器內修改文字，標題旁出現 <code>●</code> 代表尚有未儲存的變更。</li>
              <li>下方狀態列顯示「驗證通過」後，按 <code>儲存並套用</code> 或 <kbd>Ctrl</kbd> + <kbd>S</kbd> 寫入資料庫；若顯示問題清單，需先修正才能儲存。</li>
              <li>改壞了可按 <code>還原</code> 回到上次儲存的內容；切換模式或旅程時若有未儲存內容會先詢問確認。</li>
            </ol>

            <h4>旅程 (Trip) 欄位說明</h4>
            <div className="doc-table-wrap">
              <table className="doc-table">
                <thead><tr><th>欄位</th><th>型別</th><th>必填</th><th>說明與範例</th></tr></thead>
                <tbody>
                  <tr><td><code>id</code></td><td>字串</td><td>是</td><td>旅程唯一代碼，不可與其他旅程重複，建議不要在建立後更改（通行碼會依此指派旅程），例如 <code>"trip-japan-2024"</code>。</td></tr>
                  <tr><td><code>title</code></td><td>字串</td><td>是</td><td>旅程名稱，例如 <code>"2024 日本關西"</code>。</td></tr>
                  <tr><td><code>destination</code></td><td>字串</td><td>是</td><td>目的地，例如 <code>"日本 · 關西"</code>。</td></tr>
                  <tr><td><code>country</code></td><td>字串</td><td>是</td><td>國家名稱，可為空字串；中國旅程會改用高德地圖，其他國家使用 Google 地圖。</td></tr>
                  <tr><td><code>startDate</code> / <code>endDate</code></td><td>字串</td><td>是</td><td>格式 <code>YYYY-MM-DD</code>，結束日不可早於開始日。</td></tr>
                  <tr><td><code>timeZone</code></td><td>字串</td><td>是</td><td>IANA 時區，例如 <code>"Asia/Tokyo"</code>、<code>"Asia/Shanghai"</code>。</td></tr>
                  <tr><td><code>description</code></td><td>字串</td><td>是</td><td>旅程簡介，可為空字串。</td></tr>
                  <tr><td><code>hotelName</code> / <code>hotelAddress</code></td><td>字串</td><td>是</td><td>住宿名稱與地址，無住宿可留空字串；<code>hotelCoordinates</code> 為選填座標。</td></tr>
                  <tr><td><code>days</code></td><td>物件</td><td>是</td><td>以日期為 key，值為景點陣列。<strong>key 必須與開始～結束日期逐日完全對應</strong>，多一天或少一天都會驗證失敗；當天沒有行程請填 <code>[]</code>。</td></tr>
                  <tr><td><code>travelers</code></td><td>陣列</td><td>是</td><td>同行旅客，可為 <code>[]</code>。</td></tr>
                  <tr><td><code>outboundFlight</code> / <code>returnFlight</code></td><td>物件</td><td>否</td><td>去程 / 回程航班，若填寫，下列 8 個欄位都必須存在且為字串。</td></tr>
                  <tr><td><code>notepad</code>、<code>photoShareUrl</code>、<code>aiAskEnabled</code></td><td>—</td><td>否</td><td>記事本內容、相簿分享連結、是否開啟 AI 詢問。</td></tr>
                </tbody>
              </table>
            </div>

            <h4>景點 (Stop) 欄位說明</h4>
            <div className="doc-table-wrap">
              <table className="doc-table">
                <thead><tr><th>欄位</th><th>必填</th><th>說明</th></tr></thead>
                <tbody>
                  <tr><td><code>id</code></td><td>是</td><td>景點唯一代碼，同一份資料中不要重複，例如 <code>"d1-kiyomizu"</code>。</td></tr>
                  <tr><td><code>name</code></td><td>是</td><td>景點名稱。</td></tr>
                  <tr><td><code>address</code></td><td>是</td><td>地址，可為空字串。</td></tr>
                  <tr><td><code>time</code></td><td>是</td><td>抵達時間，24 小時制 <code>HH:mm</code>，例如 <code>"09:30"</code>。</td></tr>
                  <tr><td><code>duration</code></td><td>是</td><td>停留分鐘數（數字，不可為負）。</td></tr>
                  <tr><td><code>coordinates</code></td><td>是</td><td>座標字串，格式 <code>"經度,緯度"</code>（注意經度在前），中國景點使用高德 GCJ-02；尚未確認請填 <code>""</code>。</td></tr>
                  <tr><td><code>durationMax</code></td><td>否</td><td>最長停留分鐘數，必須大於或等於 <code>duration</code>。</td></tr>
                  <tr><td><code>notes</code></td><td>否</td><td>備註。</td></tr>
                  <tr><td><code>hideFromMap</code></td><td>否</td><td><code>true</code> 代表非地點行程（如「搭車」「午休」），不顯示於地圖也不計算移動路線。</td></tr>
                  <tr><td><code>openingHours</code></td><td>否</td><td>營業時間文字；搭配 <code>openingHoursStatus</code>（只能是 <code>"unverified"</code> 或 <code>"confirmed"</code>）、<code>openingHoursSource</code>、<code>openingHoursCheckedAt</code> 標示是否已查證與來源。</td></tr>
                </tbody>
              </table>
            </div>

            <h4>範例：一趟 2 天的旅程</h4>
            <pre className="doc-code" style={{ overflowX: 'auto', padding: 14, borderRadius: 10, background: '#1e1e1e', color: '#d4d4d4', fontSize: 12, lineHeight: 1.6 }}><code>{`{
  "id": "trip-demo-2025",
  "title": "2025 東京小旅行",
  "destination": "日本 · 東京",
  "country": "日本",
  "startDate": "2025-05-01",
  "endDate": "2025-05-02",
  "timeZone": "Asia/Tokyo",
  "description": "兩天一夜東京散步",
  "hotelName": "Shinjuku Hotel",
  "hotelAddress": "東京都新宿區 1-1-1",
  "days": {
    "2025-05-01": [
      {
        "id": "d1-senso-ji",
        "name": "淺草寺",
        "address": "東京都台東區淺草 2-3-1",
        "time": "10:00",
        "duration": 90,
        "durationMax": 120,
        "coordinates": "139.7966,35.7148",
        "notes": "雷門前拍照"
      },
      {
        "id": "d1-move",
        "name": "搭電車前往新宿",
        "address": "",
        "time": "12:00",
        "duration": 40,
        "coordinates": "",
        "hideFromMap": true
      }
    ],
    "2025-05-02": []
  },
  "travelers": [
    { "id": "t1", "name": "小明", "outbound": "12A", "inbound": "12B" }
  ]
}`}</code></pre>

            <h4>撰寫小技巧與常見錯誤</h4>
            <ul>
              <li><strong>JSON 語法</strong>：key 與字串一律使用雙引號；最後一個項目後<strong>不能</strong>有逗號；不可加註解。</li>
              <li><strong>延長或縮短旅程日期</strong>：修改 <code>startDate</code> / <code>endDate</code> 的同時，必須同步新增或刪除 <code>days</code> 內對應的日期 key。</li>
              <li><strong>調整景點順序</strong>：移動陣列內物件的位置即可，同一天的景點依陣列順序顯示。</li>
              <li><strong>貼上新景點</strong>：複製既有景點整段 <code>{'{ ... }'}</code>，並務必改成新的 <code>id</code>。</li>
              <li><strong>全部工作區模式</strong>：<code>activeTripId</code> 必須對應 <code>trips</code> 內存在的旅程 <code>id</code>，且各旅程 <code>id</code> 不可重複；至少要保留一趟旅程。</li>
              <li><strong>儲存前先備份</strong>：大幅修改前建議在「全部工作區」模式複製整份 JSON 存檔，儲存後會直接覆寫資料庫。</li>
              <li><strong>常見錯誤訊息</strong>：<code>days 物件缺少日期 key</code> 表示日期與 <code>days</code> 不一致；<code>結構不符合 Trip 定義</code> 通常是景點 <code>time</code> 格式錯誤、<code>duration</code> 寫成文字，或缺少必填欄位。</li>
            </ul>
          </div>
        ),
      },
      {
        id: 'flights-hotel',
        title: '航班、住宿與行李額度',
        icon: <PlaneIcon size={20} />,
        category: '行程',
        content: (
          <div className="doc-article">
            <p>
              將出行前必備的機票航廈、行李公斤數限制與住宿地址整合在專屬分頁中。
            </p>

            <div className="doc-grid-3">
              <div className="doc-feature-card">
                <h4>航班資訊</h4>
                <p>分別呈現去程與回程航班：</p>
                <ul>
                  <li>航空公司與航班號碼</li>
                  <li>起降機場與出發/抵達航廈</li>
                  <li>當地時間標示（支援時區換算）</li>
                </ul>
              </div>

              <div className="doc-feature-card">
                <h4>每人行李額度</h4>
                <p>各航空公司限制一目了然：</p>
                <ul>
                  <li><strong>個人物品</strong>：背包/隨身包件數</li>
                  <li><strong>手提行李</strong>：件數與單件重量上限 (KG)</li>
                  <li><strong>託運行李</strong>：件數與單件重量限制 (KG)</li>
                </ul>
              </div>

              <div className="doc-feature-card">
                <h4>入住住宿細節</h4>
                <p>入住資訊與便利導航：</p>
                <ul>
                  <li>飯店中文與英文名稱</li>
                  <li>詳細地址與一鍵複製</li>
                  <li>地圖評分、參考價與聯絡電話</li>
                  <li>設施分組（WiFi、早餐、吹風機等）</li>
                </ul>
              </div>
            </div>
          </div>
        ),
      },
      {
        id: 'access-control',
        title: '訪客通行碼與權限管理',
        icon: <KeyShieldIcon size={20} />,
        category: '管理',
        content: (
          <div className="doc-article">
            <p>
              「旅程只和同行的人分享。」管理員可以針對不同同行朋友或家人發放專屬通行碼，無需開放 NAS 管理員帳號。
            </p>

            <div className="doc-steps">
              <div className="doc-step">
                <span className="step-badge">1</span>
                <div>
                  <strong>建立通行碼</strong>
                  <p>輸入好友名稱（如「小明與家人」），選擇有效期限（3天、7天、30天、90天或永久），並勾選其可以檢視的旅程（可多選）。</p>
                </div>
              </div>

              <div className="doc-step">
                <span className="step-badge">2</span>
                <div>
                  <strong>複製通行碼給同行夥伴</strong>
                  <p>系統會產生一組隨機通行碼（例如 <code>trip_xxxxxx</code>），點選「複製」即可直接發給同行朋友登入。</p>
                </div>
              </div>

              <div className="doc-step">
                <span className="step-badge">3</span>
                <div>
                  <strong>編輯旅程授權或撤銷通行碼</strong>
                  <p>管理員可隨時在「訪客通行碼」面板中新增或移除該碼可查看的旅程；若行程結束或需要終止分享，點擊「撤銷」立即失效。</p>
                </div>
              </div>
            </div>

            <div className="doc-callout info">
              <span className="callout-icon"><KeyShieldIcon size={18} /></span>
              <div>
                <strong>安全儲存規範</strong>：訪客通行碼在伺服器端均以安全單向雜湊保存，原始通行碼僅在建立當下顯示一次，資料庫不會明文存放。
              </div>
            </div>
          </div>
        ),
      },
      {
        id: 'faq',
        title: '常見問題 FAQ',
        icon: <HelpCircleIcon size={20} />,
        category: 'FAQ',
        content: (
          <div className="doc-article">
            <div className="doc-faq-list">
              <details className="doc-faq-item">
                <summary>Q1：資料儲存在哪裡？是否有外洩風險？</summary>
                <div className="faq-answer">
                  所有旅程資訊（包含景點、筆記、通行碼雜湊）均存放於您本地掛載的 <code>/database/trips.sqlite</code> 資料庫中。本系統採用私有化部署架構，完全不依賴任何外部雲端儲存，資料由您本人完全掌控。
                </div>
              </details>

              <details className="doc-faq-item">
                <summary>Q2：如果沒有網路，系統能正常運作嗎？</summary>
                <div className="faq-answer">
                  可以！前端所有的核心元件（包括 Monaco Editor 編輯器、React Simple Maps 向量地圖、世界地理圖資 TopoJSON）均已於建置階段打包進專案內，在無對外連線的私人 NAS 或內部網路均可 100% 正常載入與操作。
                </div>
              </details>

              <details className="doc-faq-item">
                <summary>Q3：經緯度座標的格式是什麼？如何輸入？</summary>
                <div className="faq-answer">
                  系統一律採用 <code>經度,緯度</code> 格式（例如台北 101 為 <code>121.5654,25.0330</code>，東京鐵塔為 <code>139.7454,35.6586</code>）。在「地點地圖」頁面中，您只需開啟標記模式並點擊地圖任意位置，系統即會自動填入該格式。
                </div>
              </details>

              <details className="doc-faq-item">
                <summary>Q4：記事本是全體共用還是個人獨立的？</summary>
                <div className="faq-answer">
                  管理員編輯的記事本為「全域記事本」，會同步給所有能查看該旅程的人；而使用訪客通行碼登入的夥伴，在記事本中保存的內容為「個人獨立筆記」，僅保存在該訪客本人的 Session 資料庫中，彼此不會互相覆蓋。
                </div>
              </details>
            </div>
          </div>
        ),
      },
    ],
    []
  )

  const categories = useMemo(() => {
    const set = new Set(sections.map((s) => s.category))
    return ['all', ...Array.from(set)]
  }, [sections])

  const filteredSections = useMemo(() => {
    return sections.filter((sec) => {
      const matchCategory = activeCategory === 'all' || sec.category === activeCategory
      if (!matchCategory) return false
      if (!searchQuery.trim()) return true
      const q = searchQuery.toLowerCase().trim()
      return (
        sec.title.toLowerCase().includes(q) ||
        sec.category.toLowerCase().includes(q)
      )
    })
  }, [sections, activeCategory, searchQuery])

  return (
    <div className="docs-container">
      {/* Docs Header */}
      <div className="docs-header">
        <div className="docs-header-main">
          <span className="overline">DOCUMENTATION & USER GUIDE</span>
          <h2>途間 (TRIP STUDIO) 系統使用手冊</h2>
          <p className="docs-subtitle">
            深入了解行程規劃、地點地圖標記、VS Code 編輯器與權限管理等完整功能。
          </p>
        </div>

        {/* Search Input */}
        <div className="docs-search-box">
          <span className="search-icon"><SearchIcon size={15} /></span>
          <input
            type="text"
            placeholder="搜尋功能、操作步驟或說明..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="clear-search-btn"
              onClick={() => setSearchQuery('')}
            >
              <CloseIcon size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Category Pills */}
      <div className="docs-categories">
        <button
          type="button"
          className={activeCategory === 'all' ? 'active' : ''}
          onClick={() => setActiveCategory('all')}
        >
          全部文件 ({sections.length})
        </button>
        {categories.filter((c) => c !== 'all').map((cat) => (
          <button
            key={cat}
            type="button"
            className={activeCategory === cat ? 'active' : ''}
            onClick={() => setActiveCategory(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Main Content Layout */}
      <div className="docs-body">
        {/* Quick Nav Anchors */}
        <aside className="docs-nav-sidebar">
          <div className="docs-nav-title">章節目錄</div>
          <nav className="docs-nav-links">
            {filteredSections.map((sec) => (
              <a key={sec.id} href={`#${sec.id}`} className="docs-nav-item">
                <span className="nav-icon">{sec.icon}</span>
                <span className="nav-text">{sec.title}</span>
                {sec.badge && <span className="nav-badge">{sec.badge}</span>}
              </a>
            ))}
          </nav>
        </aside>

        {/* Articles List */}
        <div className="docs-content-area">
          {filteredSections.length === 0 ? (
            <div className="docs-empty">
              <span><SearchIcon size={32} /></span>
              <h4>找不到符合「{searchQuery}」的說明文件</h4>
              <p>請嘗試使用其他關鍵字（如：地圖、座標、JSON、航班、通行碼）。</p>
            </div>
          ) : (
            filteredSections.map((sec) => (
              <section key={sec.id} id={sec.id} className="doc-section-card">
                <div className="doc-section-header">
                  <span className="section-icon">{sec.icon}</span>
                  <div>
                    <div className="section-title-row">
                      <h3>{sec.title}</h3>
                      {sec.badge && <span className="section-badge">{sec.badge}</span>}
                    </div>
                    <span className="section-category">類別：{sec.category}</span>
                  </div>
                </div>
                <div className="doc-section-content">{sec.content}</div>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
