import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Trip, TripWorkspace } from './models/trip'
import type { WalkLeg } from './models/walking'
import { getTripStatus, sortTripsNearToFar, type TripStatus } from './services/date.service'
import { listDates } from './services/trip.service'
import { loadTripWorkspace, saveWorkspace } from './services/trip-workspace.service'
import { getAuthStatus, loginWithAccessCode, logout as logoutFromServer, type AccessRole } from './services/auth.service'
import { evaluateWalk } from './services/walking.service'
import './App.scss'

function amapSearch(keyword: string, city: string) {
  return `https://uri.amap.com/search?keyword=${encodeURIComponent(keyword)}&city=${encodeURIComponent(city)}`
}

function prettyDate(date: string, options: Intl.DateTimeFormatOptions = {
  month: 'long', day: 'numeric', weekday: 'short',
}) {
  return new Intl.DateTimeFormat('zh-TW', { ...options, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
}

const tripStatusLabels: Record<TripStatus, string> = {
  scheduled: '排定',
  'in-progress': '進行',
  ended: '結束',
}

type AccessGateProps = {
  configured: boolean
  error: string
  busy: boolean
  code: string
  onCodeChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

function AccessGate({ configured, error, busy, code, onCodeChange, onSubmit }: AccessGateProps) {
  return <main className="access-page">
    <section className="access-card">
      <div className="access-brand"><span className="brand-mark">✳</span><span>途間 <small>TRIP STUDIO</small></span></div>
      <span className="overline">PRIVATE TRAVEL SPACE</span>
      <h1>旅程只和同行的人分享。</h1>
      <p className="access-description">輸入 NAS 管理員或訪客通行碼。訪客只能查看，管理員可以編輯旅程。</p>
      {error && <p className="access-error" role="alert">{error}</p>}
      {!configured ? <p className="access-setup">{error ? '目前無法連線到 NAS 登入服務，請確認伺服器狀態與反向代理設定。' : <>請在 NAS 設定至少 16 個字元、彼此不同的 <code>TRIP_VIEW_CODE</code> 與 <code>TRIP_ADMIN_CODE</code>，再重新啟動網站。</>}</p> : <form onSubmit={onSubmit}>
        <label htmlFor="access-code">通行碼</label>
        <input
          id="access-code"
          type="password"
          autoComplete="current-password"
          minLength={16}
          required
          value={code}
          onChange={(event) => onCodeChange(event.target.value)}
          placeholder="輸入通行碼"
        />
        <button type="submit" disabled={busy}>{busy ? '正在登入…' : '登入旅程'}</button>
      </form>}
      <p className="access-footnote">通行碼由 NAS 驗證，不會儲存在瀏覽器或旅程資料中。</p>
    </section>
  </main>
}

function App() {
  const [workspace, setWorkspace] = useState<TripWorkspace | null>(null)
  const [day, setDay] = useState('')
  const [loading, setLoading] = useState(true)
  const [authLoading, setAuthLoading] = useState(true)
  const [authConfigured, setAuthConfigured] = useState(false)
  const [authRole, setAuthRole] = useState<AccessRole | null>(null)
  const [authCode, setAuthCode] = useState('')
  const [authError, setAuthError] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [tab, setTab] = useState<'overview' | 'timeline' | 'archive' | 'itinerary' | 'flights' | 'travelers' | 'notepad'>('overview')
  const [statusTime, setStatusTime] = useState(() => new Date())
  const [editing, setEditing] = useState<string | null>(null)
  const [limits, setLimits] = useState({ leg: '', daily: '' })
  const [includeHotel, setIncludeHotel] = useState(false)
  const [modes, setModes] = useState('')
  const [legs, setLegs] = useState<WalkLeg[]>([])
  const [routeError, setRouteError] = useState('')
  const [routing, setRouting] = useState(false)
  const [routeCheckedAt, setRouteCheckedAt] = useState('')
  const activeRequest = useRef<AbortController | null>(null)
  const saveSequence = useRef<Promise<void>>(Promise.resolve())
  const saveVersion = useRef(0)

  useEffect(() => {
    const timer = window.setInterval(() => setStatusTime(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function initializeAccess() {
      try {
        const auth = await getAuthStatus()
        if (!cancelled) {
          setAuthConfigured(auth.configured)
          setAuthRole(auth.authenticated ? auth.role : null)
        }
        if (!auth.configured || !auth.authenticated || !auth.role) return
        const loadedWorkspace = await loadTripWorkspace(localStorage, auth.role === 'admin')
        if (!cancelled) {
          setWorkspace(loadedWorkspace)
          setDay(loadedWorkspace.trips.find((trip) => trip.id === loadedWorkspace.activeTripId)?.startDate ?? '')
        }
      } catch (error) {
        if (!cancelled) setAuthError(error instanceof Error ? error.message : '無法確認登入狀態。')
      } finally {
        if (!cancelled) {
          setLoading(false)
          setAuthLoading(false)
        }
      }
    }
    void initializeAccess()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!authRole) return
    let cancelled = false
    async function verifySession() {
      try {
        const auth = await getAuthStatus()
        if (!cancelled && (!auth.configured || !auth.authenticated)) {
          setWorkspace(null)
          setAuthRole(null)
          setEditing(null)
          setAuthCode('')
          setAuthError('登入已逾時，請重新輸入通行碼。')
        }
      } catch (error) {
        if (!cancelled) setAuthError(error instanceof Error ? error.message : '確認登入狀態失敗。')
      }
    }
    const timer = window.setInterval(() => void verifySession(), 60_000)
    window.addEventListener('focus', verifySession)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('focus', verifySession)
    }
  }, [authRole])

  useEffect(() => {
    if (loading || !workspace || authRole !== 'admin') return
    const version = ++saveVersion.current
    const snapshot = workspace
    saveSequence.current = saveSequence.current
      .catch(() => undefined)
      .then(() => saveWorkspace(snapshot))
      .then(() => {
        if (saveVersion.current === version) setSaveError('')
      })
      .catch((error: unknown) => {
        if (saveVersion.current === version) {
          setSaveError(error instanceof Error ? error.message : '保存旅程資料失敗。')
        }
      })
  }, [workspace, loading, authRole])

  const trip = workspace?.trips.find((item) => item.id === workspace.activeTripId)
  const dates = trip ? listDates(trip.startDate, trip.endDate) : []
  const activeDay = dates.includes(day) ? day : (dates[0] ?? '')
  const stops = trip?.days[activeDay] ?? []
  const isDeparture = activeDay === trip?.startDate
  const isReturn = activeDay === trip?.endDate
  const flightConflict = Boolean(
    trip?.outboundFlight && isDeparture && stops.some((stop) => stop.time < trip.outboundFlight!.arrivalTime) ||
    trip?.returnFlight && isReturn && stops.some((stop) => stop.time >= trip.returnFlight!.departureTime),
  )
  const timeConflict = stops.some((stop, index) => {
    if (!index) return false
    const previous = stops[index - 1]
    const [hours, minutes] = previous.time.split(':').map(Number)
    const [nextHours, nextMinutes] = stop.time.split(':').map(Number)
    return nextHours * 60 + nextMinutes < hours * 60 + minutes + (previous.durationMax ?? previous.duration)
  })
  useEffect(() => () => activeRequest.current?.abort(), [])

  function invalidateRoute() {
    activeRequest.current?.abort()
    activeRequest.current = null
    setRouting(false)
    setLegs([])
    setRouteError('')
    setRouteCheckedAt('')
  }

  function updateTrip(update: (current: Trip) => Trip) {
    if (authRole !== 'admin' || !workspace || !trip) return
    setWorkspace({
      ...workspace,
      trips: workspace.trips.map((item) => item.id === trip.id ? update(item) : item),
    })
    invalidateRoute()
  }

  function updateStops(next: Trip['days'][string]) {
    if (!trip) return
    updateTrip((current) => ({ ...current, days: { ...current.days, [activeDay]: next } }))
  }

  function changeTrip(id: string) {
    if (!workspace) return
    const selected = workspace.trips.find((item) => item.id === id)
    if (!selected) return
    setWorkspace({ ...workspace, activeTripId: id })
    setDay(selected.startDate)
    setTab('itinerary')
    setEditing(null)
    setLimits({ leg: '', daily: '' })
    setModes('')
    setIncludeHotel(false)
    invalidateRoute()
  }

  function updateStop(id: string, patch: Partial<Trip['days'][string][number]>) {
    updateStops(stops.map((stop) => stop.id === id ? { ...stop, ...patch } : stop))
  }

  function moveStop(index: number, direction: number) {
    const target = index + direction
    if (target < 0 || target >= stops.length) return
    const next = [...stops]
    ;[next[index], next[target]] = [next[target], next[index]]
    updateStops(next)
  }

  async function calculateRoute() {
    invalidateRoute()
    if (!trip) return
    if (!limits.leg || !limits.daily || Number(limits.leg) <= 0 || Number(limits.daily) <= 0) {
      setRouteError('請先填寫每段與每日可步行的分鐘上限。')
      return
    }
    if (!modes) {
      setRouteError('請選擇可接受的替代交通方式。')
      return
    }
    if (includeHotel && !trip.hotelName) {
      setRouteError('請先填寫住宿名稱，再將住宿納入每日起終點。')
      return
    }
    if (!stops.length || (!includeHotel && stops.length < 2)) {
      setRouteError(includeHotel ? '請先新增當日景點。' : '至少需要兩個景點，或選擇將住宿納入起終點。')
      return
    }
    const stopPoints = stops.map((stop) => ({ id: stop.id, coordinates: stop.coordinates }))
    const points = includeHotel
      ? [{ id: 'hotel', coordinates: trip.hotelCoordinates ?? '' }, ...stopPoints, { id: 'hotel', coordinates: trip.hotelCoordinates ?? '' }]
      : stopPoints
    const coordinatePattern = /^-?\d{1,3}(?:\.\d{1,6})?,-?\d{1,2}(?:\.\d{1,6})?$/
    if (points.some((point) => !coordinatePattern.test(point.coordinates))) {
      setRouteError('請先從高德確認住宿及所有景點的 GCJ-02 座標，格式為經度,緯度（最多六位小數）。')
      return
    }
    setRouting(true)
    const controller = new AbortController()
    activeRequest.current = controller
    try {
      const results: WalkLeg[] = []
      for (let index = 0; index < points.length - 1; index++) {
        const response = await fetch('/api/walk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ origin: points[index].coordinates, destination: points[index + 1].coordinates }),
          signal: controller.signal,
        })
        const data: unknown = await response.json()
        if (!response.ok || typeof data !== 'object' || data === null || !('minutes' in data) || !('meters' in data) ||
          typeof data.minutes !== 'number' || typeof data.meters !== 'number') {
          throw new Error(typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
            ? data.error : '高德路線服務回應無效，請稍後重試。')
        }
        results.push({ fromId: points[index].id, toId: points[index + 1].id, minutes: data.minutes, meters: data.meters })
      }
      if (controller.signal.aborted) return
      setLegs(results)
      setRouteCheckedAt(new Intl.DateTimeFormat('zh-TW', { timeZone: trip.timeZone, dateStyle: 'short', timeStyle: 'short' }).format(new Date()))
    } catch (error) {
      if (!controller.signal.aborted) {
        setRouteError(error instanceof Error ? error.message : '路線查詢失敗。')
        setLegs([])
      }
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null
        setRouting(false)
      }
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAuthBusy(true)
    setAuthError('')
    try {
      const role = await loginWithAccessCode(authCode)
      setAuthRole(role)
      setAuthCode('')
      setLoading(true)
      try {
        const loadedWorkspace = await loadTripWorkspace(localStorage, role === 'admin')
        setWorkspace(loadedWorkspace)
        setDay(loadedWorkspace.trips.find((item) => item.id === loadedWorkspace.activeTripId)?.startDate ?? '')
        setLoadError('')
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : '讀取旅程資料失敗。')
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : '登入失敗。')
    } finally {
      setLoading(false)
      setAuthBusy(false)
    }
  }

  async function handleLogout() {
    try {
      await logoutFromServer()
      setWorkspace(null)
      setAuthRole(null)
      setAuthCode('')
      setAuthError('')
      setLoadError('')
      setTab('overview')
      setEditing(null)
      invalidateRoute()
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : '登出失敗。')
    }
  }

  const status = evaluateWalk(legs, Number(limits.leg), Number(limits.daily),
    Math.max(0, stops.length + (includeHotel ? 1 : -1)))

  if (authLoading || (authRole && loading)) return <main className="load-error">正在確認登入權限與旅程資料…</main>
  if (!authConfigured || !authRole) {
    return <AccessGate
      configured={authConfigured}
      error={authError}
      busy={authBusy}
      code={authCode}
      onCodeChange={setAuthCode}
      onSubmit={(event) => void handleLogin(event)}
    />
  }
  if (loading) return <main className="load-error">正在讀取 NAS 旅程資料…</main>
  if (loadError || !workspace || !trip) return <main className="load-error" role="alert"><h1>無法開啟旅程</h1><p>{loadError || '目前沒有有效的旅程資料。'}</p><button className="access-logout" onClick={() => void handleLogout()}>登出</button></main>
  const activeTripId = trip.id
  const activeTripStatus = getTripStatus(trip.startDate, trip.endDate, trip.timeZone, statusTime)
  const currentTrips = workspace.trips.filter((item) =>
    getTripStatus(item.startDate, item.endDate, item.timeZone, statusTime) !== 'ended')
  const archivedTrips = workspace.trips.filter((item) =>
    getTripStatus(item.startDate, item.endDate, item.timeZone, statusTime) === 'ended')

  function renderTripLinks(trips: Trip[]) {
    return trips.map((item) => {
      const itemStatus = getTripStatus(item.startDate, item.endDate, item.timeZone, statusTime)
      return <button key={item.id} className={`trip-link ${item.id === activeTripId ? 'active' : ''}`} onClick={() => changeTrip(item.id)}>
        <strong><span className="trip-link-title">{item.title}</span><span className={`trip-status-badge status-${itemStatus}`}>{tripStatusLabels[itemStatus]}</span></strong>
        <small>{item.destination} · {prettyDate(item.startDate, { month: 'numeric', day: 'numeric' })}</small>
      </button>
    })
  }

  function renderTripCards(trips: Trip[]) {
    if (!trips.length) {
      return <div className="empty"><span>◷</span><strong>目前沒有{tab === 'archive' ? '已結束' : '排定或進行中'}的旅程</strong></div>
    }
    return <div className="trip-cards">{trips.map((item, index) => {
      const tripDays = listDates(item.startDate, item.endDate)
      const itemStatus = getTripStatus(item.startDate, item.endDate, item.timeZone, statusTime)
      const places = Object.values(item.days).reduce((total, stopsForDay) => total + stopsForDay.length, 0)
      return <button className="trip-card" key={item.id} onClick={() => changeTrip(item.id)}>
        <div className={`trip-card-art art-${index % 4}`}><span>{item.country || 'TRAVEL PLAN'}</span><strong>{item.destination}</strong><small>{String(index + 1).padStart(2, '0')} / JOURNEY</small></div>
        <div className="trip-card-body"><div className="trip-card-title"><h3>{item.title}</h3><span className={`trip-status-badge status-${itemStatus}`}>{tripStatusLabels[itemStatus]}</span></div><p>{prettyDate(item.startDate, { year: 'numeric', month: 'long', day: 'numeric' })} — {prettyDate(item.endDate, { year: 'numeric', month: 'long', day: 'numeric' })}</p><div className="trip-card-meta"><span>{tripDays.length} 天 {Math.max(0, tripDays.length - 1)} 夜</span><span>{places} 個行程項目</span><span>{item.timeZone}</span></div></div>
      </button>
    })}</div>
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" aria-label="途間首頁：我的旅程" onClick={() => setTab('overview')}><span className="brand-mark">✳</span><span>途間 <small>TRIP STUDIO</small></span></button>
        <div className="nav-label">你的旅程 <span className="trip-count">{currentTrips.length}</span></div>
        <button className={`side-link ${tab === 'timeline' ? 'active' : ''}`} onClick={() => setTab('timeline')}>◷ <span>旅程時間軸</span></button>
        <div className="trip-list">{renderTripLinks(currentTrips.slice(0, 3))}</div>
        {currentTrips.length > 3 && <button className="trip-list-more" onClick={() => setTab('overview')}>瀏覽更多</button>}
        <div className="nav-label nav-section">這趟旅程</div>
        <button className={`side-link ${tab === 'itinerary' ? 'active' : ''}`} onClick={() => setTab('itinerary')}>▦ <span>每日行程</span></button>
        <button className={`side-link ${tab === 'flights' ? 'active' : ''}`} onClick={() => setTab('flights')}>✈ <span>航班與住宿</span></button>
        <button className={`side-link ${tab === 'travelers' ? 'active' : ''}`} onClick={() => setTab('travelers')}>♙ <span>同行旅客</span></button>
        <div className="sidebar-bottom">
          <span className="status-dot" /> NAS SQLite · {authRole === 'admin' ? '管理員' : '訪客唯讀'}
          <p>旅程資料由 NAS 儲存；請勿分享管理員通行碼。</p>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">{tab !== 'overview' && tab !== 'timeline' && tab !== 'archive' && <button className="topbar-back" onClick={() => setTab('overview')}>‹ 我的旅程</button>}<span className="topbar-title">{tab === 'overview' ? '我的旅程' : tab === 'timeline' ? '我的旅程 / 旅程時間軸' : tab === 'archive' ? '我的旅程 / 封存' : <>我的旅程 <span className="slash">/</span> {trip.title}</>}</span><span className="top-right">{workspace.trips.length} 趟旅程 · {authRole === 'admin' ? '管理員' : '訪客唯讀'}</span><button className="logout-button" onClick={() => void handleLogout()}>登出</button></header>
        <div className="content">
          {saveError && <p className="notice danger" role="alert">SQLite 儲存失敗：{saveError}</p>}
          {authError && <p className="notice danger" role="alert">{authError}</p>}
          {tab === 'overview' || tab === 'timeline' || tab === 'archive' ? <section className="trips-overview">
            <div className="eyebrow">MY TRIPS <span className="eyebrow-rule" /></div>
            <nav className="tabs home-tabs" aria-label="旅程總覽檢視">
              <button className={tab === 'overview' ? 'selected' : ''} onClick={() => setTab('overview')}>旅程卡片</button>
              <button className={tab === 'timeline' ? 'selected' : ''} onClick={() => setTab('timeline')}>旅程時間軸</button>
              <button className={tab === 'archive' ? 'selected' : ''} onClick={() => setTab('archive')}>封存</button>
            </nav>
            <div className="section-heading"><div><span className="overline">旅程總覽 · {workspace.trips.length} 趟</span><h2>每一趟旅程，都從這裡開始。</h2><p className="overview-caption">管理你的出國計畫，選取旅程以查看每日安排。</p></div></div>
            {tab === 'overview' && renderTripCards(currentTrips)}
            {tab === 'timeline' && <div className="journey-timeline">
              {sortTripsNearToFar(workspace.trips, statusTime).map((item) => {
                const itemStatus = getTripStatus(item.startDate, item.endDate, item.timeZone, statusTime)
                return <button className="journey-timeline-entry" key={item.id} onClick={() => changeTrip(item.id)}>
                  <span className="journey-timeline-period"><strong>{item.startDate.slice(0, 4)}</strong><small>{Number(item.startDate.slice(5, 7))} 月</small></span>
                  <span className="journey-timeline-marker" aria-hidden="true" />
                  <span className="journey-timeline-card">
                    <span className="journey-timeline-heading"><strong>{item.destination}</strong><span className={`trip-status-badge status-${itemStatus}`}>{tripStatusLabels[itemStatus]}</span></span>
                    <span className="journey-timeline-title">{item.title}</span>
                    <span className="journey-timeline-date">{prettyDate(item.startDate, { year: 'numeric', month: 'long', day: 'numeric' })} — {prettyDate(item.endDate, { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                  </span>
                </button>
              })}
            </div>}
            {tab === 'archive' && renderTripCards(archivedTrips)}
          </section> : <>
          <div className="eyebrow"><span className={`trip-status-badge status-${activeTripStatus}`}>{tripStatusLabels[activeTripStatus]}</span><span className="eyebrow-rule" /></div>
          <section className="hero">
            <div className="hero-content">
              <div className="hero-kicker">{trip.country || trip.destination} <span>✦</span> {dates.length} 天 {Math.max(0, dates.length - 1)} 夜</div>
              <h1>遇見<span>{trip.destination}</span></h1>
              <p>{trip.description || `開始規劃你的${trip.destination}旅程。`}</p>
              <div className="hero-meta"><span>◷ &nbsp;{trip.startDate.replaceAll('-', '.')} — {trip.endDate.slice(5).replaceAll('-', '.')}</span><span>◷ &nbsp;當地時間 {trip.timeZone}</span></div>
            </div>
            <div className="hero-illustration" aria-hidden="true"><span className="sun" /><div className="hill hill-one" /><div className="hill hill-two" /><div className="building building-one" /><div className="building building-two" /></div>
            <div className="hero-index">{String(workspace.trips.indexOf(trip) + 1).padStart(2, '0')} / {trip.destination.toUpperCase()}</div>
          </section>
          <div className="summary-row">
            <button className="summary-card" onClick={() => setTab('flights')}><span className="summary-icon peach">✈</span><span><strong>航班資訊</strong><small>{trip.outboundFlight ? `${trip.outboundFlight.airline} · ${trip.outboundFlight.number}${trip.returnFlight ? ` / ${trip.returnFlight.number}` : ''}` : '尚未新增航班資料'}</small></span><span className="arrow">↗</span></button>
            {trip.hotelName ? <a className="summary-card" href={amapSearch(`${trip.hotelName} ${trip.hotelAddress}`, trip.destination)} target="_blank" rel="noreferrer"><span className="summary-icon green">⌂</span><span><strong>入住住宿</strong><small>{trip.hotelName}</small></span><span className="arrow">↗</span></a> : <button className="summary-card" onClick={() => setTab('flights')}><span className="summary-icon green">⌂</span><span><strong>入住住宿</strong><small>尚未新增住宿資訊</small></span><span className="arrow">↗</span></button>}
            <button className="summary-card" onClick={() => setTab('travelers')}><span className="summary-icon blue">♙</span><span><strong>同行旅客</strong><small>{trip.travelers.length ? `已儲存 ${trip.travelers.length} 位` : '尚未新增旅客'}</small></span><span className="arrow">↗</span></button>
          </div>
          <nav className="tabs" aria-label="旅程分頁">
            <button className={tab === 'itinerary' ? 'selected' : ''} onClick={() => setTab('itinerary')}>每日行程</button>
            <button className={tab === 'flights' ? 'selected' : ''} onClick={() => setTab('flights')}>航班與住宿</button>
            <button className={tab === 'travelers' ? 'selected' : ''} onClick={() => setTab('travelers')}>旅客與座位</button>
            <button className={tab === 'notepad' ? 'selected' : ''} onClick={() => setTab('notepad')}>記事本</button>
          </nav>
          {tab === 'itinerary' && <>
            <div className="section-heading"><div><span className="overline">YOUR ITINERARY</span><h2>每天，都有新的風景。</h2></div><span className="muted">當地時間 · {trip.timeZone}</span></div>
            <div className="day-tabs" role="tablist" aria-label="選擇日期">
              {dates.map((date, index) => <button role="tab" aria-selected={activeDay === date} className={activeDay === date ? 'chosen' : ''} key={date} onClick={() => { setDay(date); setEditing(null); invalidateRoute() }}><small>DAY {String(index + 1).padStart(2, '0')}</small><strong>{prettyDate(date)}</strong></button>)}
            </div>
            <div className="workspace">
              <section className="schedule">
                <div className="panel-title"><div><span className="overline">DAY {dates.indexOf(activeDay) + 1} / {String(dates.length).padStart(2, '0')}</span><h3>{prettyDate(activeDay)} 的行程</h3></div>{authRole === 'admin' && <button className="small-action" onClick={() => { const id = crypto.randomUUID(); updateStops([...stops, { id, name: '', address: '', time: '10:00', duration: 60, coordinates: '' }]); setEditing(id) }}>＋ 新增景點</button>}</div>
                {isDeparture && trip.outboundFlight && <div className="event fixed"><div className="event-time">{trip.outboundFlight.departureTime}<small>{trip.outboundFlight.departureAirport}</small></div><span className="event-symbol">✈</span><div><span className="tag">固定行程 · 航班</span><h4>出發前往{trip.destination}</h4><p>{trip.outboundFlight.number} · {trip.outboundFlight.departureAirport} {trip.outboundFlight.departureTerminal} → {trip.outboundFlight.arrivalAirport} {trip.outboundFlight.arrivalTerminal} · {trip.outboundFlight.arrivalTime} 抵達</p></div></div>}
                {flightConflict && <p className="route-error" role="alert">景點時間與航班時段衝突；請另計入機場出入境及交通時間。</p>}
                {timeConflict && <p className="route-error" role="alert">景點時間有重疊或順序不符；請調整開始時間及停留時間，並預留移動時間。</p>}
                {stops.map((stop, index) => <div className="stop-block" key={stop.id}>
                  <div className="event"><div className="event-time">{stop.time}<small>當地</small></div><span className="event-symbol spot">{index + 1}</span><div className="event-body">
                    {editing === stop.id && authRole === 'admin' ? <form onSubmit={(event) => { event.preventDefault(); if (stop.name.trim()) setEditing(null) }}>
                      <label>景點名稱<input required value={stop.name} onChange={(event) => updateStop(stop.id, { name: event.target.value })} placeholder="輸入景點名稱" /></label>
                      <label>地址<input value={stop.address} onChange={(event) => updateStop(stop.id, { address: event.target.value })} placeholder="確認後再填寫" /></label>
                      <div className="form-row"><label>時間<input type="time" value={stop.time} onChange={(event) => updateStop(stop.id, { time: event.target.value })} /></label><label>最短停留分鐘<input type="number" min="0" value={stop.duration} onChange={(event) => { const duration = Math.max(0, Number(event.target.value)); updateStop(stop.id, { duration, ...(stop.durationMax !== undefined && stop.durationMax < duration ? { durationMax: duration } : {}) }) }} /></label><label>最長停留分鐘（選填）<input type="number" min={stop.duration} value={stop.durationMax ?? ''} onChange={(event) => updateStop(stop.id, { durationMax: event.target.value === '' ? undefined : Math.max(stop.duration, Number(event.target.value)) })} /></label></div>
                      <label>高德 GCJ-02 座標（經度,緯度）<input value={stop.coordinates} onChange={(event) => updateStop(stop.id, { coordinates: event.target.value })} placeholder="尚未確認可留空" /></label>
                      <label>備註<textarea value={stop.notes ?? ''} onChange={(event) => updateStop(stop.id, { notes: event.target.value })} placeholder="可記錄預約、票價或交通資訊" /></label>
                      <div className="form-actions"><button type="submit">完成</button><button type="button" className="plain" onClick={() => { updateStops(stops.filter((item) => item.id !== stop.id)); setEditing(null) }}>刪除</button></div>
                    </form> : <><span className="tag soft">{stop.duration === 0 ? '時間點' : `自由行程 · ${stop.duration}${stop.durationMax !== undefined && stop.durationMax > stop.duration ? `–${stop.durationMax}` : ''} 分鐘`}</span><h4>{stop.name || '未命名景點'}</h4><p>{stop.address || '地點地址未提供'} · {stop.coordinates ? '已輸入座標（請確認來源）' : '尚無座標'}</p>{stop.notes && <p className="stop-notes">{stop.notes}</p>}<div className="inline-actions">{authRole === 'admin' && <><button onClick={() => setEditing(stop.id)}>編輯</button><button disabled={index === 0} onClick={() => moveStop(index, -1)}>上移</button><button disabled={index === stops.length - 1} onClick={() => moveStop(index, 1)}>下移</button></>}<a target="_blank" rel="noreferrer" href={amapSearch(`${stop.name} ${stop.address}`, trip.destination)}>地圖查看 ↗</a></div></>}
                  </div></div>
                  {index < stops.length - 1 && <div className="transfer">↳ 景點間步行路線尚未驗證</div>}
                </div>)}
                {isReturn && trip.returnFlight && <div className="event fixed"><div className="event-time">{trip.returnFlight.departureTime}<small>{trip.returnFlight.departureAirport}</small></div><span className="event-symbol">✈</span><div><span className="tag">固定行程 · 航班</span><h4>返程</h4><p>{trip.returnFlight.number} · {trip.returnFlight.departureAirport} {trip.returnFlight.departureTerminal} → {trip.returnFlight.arrivalAirport} {trip.returnFlight.arrivalTerminal} · {trip.returnFlight.arrivalTime} 抵達</p></div></div>}
                {!stops.length && <div className="empty"><span>✧</span><strong>這一天，留給你自由安排。</strong><p>新增想去的地方，開始規劃屬於你的{trip.destination}路線。</p></div>}
              </section>
              <aside className="route-panel">
                <div className="route-visual"><div className="map-grid" /><div className="map-route"><span className="pin-one">⌂</span><span className="dashes">············</span><span className="pin-two">✦</span></div><span className="map-note">路線示意 · 非真實地圖</span></div>
                <div className="route-content"><span className="overline">WALKABLE ROUTE</span><h3>走得剛剛好</h3><p>以高德實際步行路線驗證每一段與全天距離；未取得可驗證的完整路線前，不會判定符合上限。</p>
                  {authRole === 'admin' && trip.hotelName && <label>住宿座標（高德 GCJ-02 經度,緯度）<input value={trip.hotelCoordinates ?? ''} onChange={(event) => updateTrip((current) => ({ ...current, hotelCoordinates: event.target.value }))} placeholder="確認後填入" /></label>}
                  <label>每段最多步行（分鐘）<input type="number" min="1" value={limits.leg} onChange={(event) => { setLimits({ ...limits, leg: event.target.value }); invalidateRoute() }} placeholder="由你決定" /></label>
                  <label>每天最多步行（分鐘）<input type="number" min="1" value={limits.daily} onChange={(event) => { setLimits({ ...limits, daily: event.target.value }); invalidateRoute() }} placeholder="由你決定" /></label>
                  <label>可接受的替代交通<select value={modes} onChange={(event) => { setModes(event.target.value); invalidateRoute() }}><option value="">請選擇</option><option value="transit">大眾運輸</option><option value="taxi">計程車</option><option value="both">大眾運輸及計程車</option><option value="none">只走路</option></select></label>
                  {trip.hotelName && <label className="checkbox"><input type="checkbox" checked={includeHotel} onChange={(event) => { setIncludeHotel(event.target.checked); invalidateRoute() }} /> 將住宿納入每日起點與終點</label>}
                  <button className="route-button" onClick={calculateRoute} disabled={routing}>{routing ? '正在查詢…' : '檢查步行路線 →'}</button>
                  {routeError && <p className="route-error" role="alert">{routeError}</p>}
                  <div className="route-status"><span className="status-dot amber" /> {status === 'unverified' ? '尚未驗證 · 不視為符合上限' : status === 'over' ? '超過步行上限' : '符合步行上限'}</div>
                  {legs.length > 0 && <div className="route-results"><p>高德步行 API · {routeCheckedAt} 查詢</p>{legs.map((leg, index) => <p key={`${leg.fromId}-${leg.toId}-${index}`}>{leg.fromId === 'hotel' ? trip.hotelName : stops.find((stop) => stop.id === leg.fromId)?.name} → {leg.toId === 'hotel' ? trip.hotelName : stops.find((stop) => stop.id === leg.toId)?.name}：{leg.minutes} 分鐘 / {leg.meters} 公尺{leg.minutes > Number(limits.leg) ? ' · 單段超標' : ''}</p>)}<strong>全天步行 {legs.reduce((sum, leg) => sum + leg.minutes, 0)} 分鐘{legs.reduce((sum, leg) => sum + leg.minutes, 0) > Number(limits.daily) ? ' · 全天超標' : ''}</strong></div>}
                  {status === 'over' && <p className="route-error">行程超標。可調整景點順序、刪減景點，或考慮{modes === 'taxi' ? '計程車' : modes === 'transit' ? '大眾運輸' : modes === 'both' ? '大眾運輸／計程車' : '分拆當日行程'}；替代方案仍需另外規劃及驗證。</p>}
                  {trip.hotelName && <a className="external-map" href={amapSearch(`${trip.hotelName} ${trip.hotelAddress}`, trip.destination)} target="_blank" rel="noreferrer">在高德地圖查看住宿 ↗</a>}
                </div>
              </aside>
            </div>
          </>}
          {tab === 'flights' && <div className="details-grid">
            {(['outboundFlight', 'returnFlight'] as const).map((direction) => {
              const flight = trip[direction]
              const isOutbound = direction === 'outboundFlight'
              return <div className="detail-card" key={direction}>
                <span className="overline">{isOutbound ? `OUTBOUND · ${trip.startDate}` : `RETURN · ${trip.endDate}`}</span>
                <h2>{isOutbound ? '去程航班' : '回程航班'}</h2>
                {flight ? <>
                  <div className="flight-route">
                    <div><strong>{flight.departureTime}</strong><span>{flight.departureAirport} {flight.departureTerminal}</span></div>
                    <span className="flight-arrow" aria-hidden="true">→</span>
                    <div><strong>{flight.arrivalTime}</strong><span>{flight.arrivalAirport} {flight.arrivalTerminal}</span></div>
                  </div>
                  <p className="flight-number">{flight.airline} · {flight.number}</p>
                </> : <p>尚未提供航班資料。</p>}
                <p>顯示時間為機場當地時間。</p>
              </div>
            })}
            <div className="detail-card"><span className="overline">YOUR STAY · {trip.startDate} — {trip.endDate}</span><h2>住宿</h2><div className="read-only-value"><span>住宿名稱</span><strong>{trip.hotelName || '尚未提供'}</strong></div><div className="read-only-value"><span>地址</span><strong>{trip.hotelAddress || '尚未提供'}</strong></div>{trip.hotelName && <a href={amapSearch(`${trip.hotelName} ${trip.hotelAddress}`, trip.destination)} target="_blank" rel="noreferrer">地圖查看住宿 ↗</a>}<p>住宿資訊僅依提供內容顯示，不會自動驗證訂房狀態。</p></div>
            <div className="detail-card"><span className="overline">BAGGAGE · PER PERSON</span><h2>每人行李額度</h2><div className="baggage"><div><span>個人物品</span><strong>{trip.personalItemPieces ?? '件數未提供'}{trip.personalItemPieces !== undefined ? ' 件' : ''}</strong></div><div><span>手提行李</span><strong>{trip.carryOnPieces ?? '件數未提供'}{trip.carryOnPieces !== undefined ? ' 件 · ' : ' · '}{trip.carryOnKg ?? '重量未提供'}{trip.carryOnKg !== undefined ? ' 公斤/件' : ''}</strong></div><div><span>託運行李</span><strong>{trip.checkedBagPieces ?? '件數未提供'}{trip.checkedBagPieces !== undefined ? ' 件 · ' : ' · '}{trip.checkedBagKg ?? '重量未提供'}{trip.checkedBagKg !== undefined ? ' 公斤/件' : ''}</strong></div></div><p>出發前請再次查閱訂單及航空公司規定。</p></div>
          </div>}
          {tab === 'travelers' && <div className="travelers-panel">
            <div className="section-heading"><div><span className="overline">TRAVEL PARTY</span><h2>同行旅客與座位</h2></div></div>
            <p className="muted">座位資訊依提供的機票資料整理。</p>
            <div className="seat-flight-routes">
              {(['outboundFlight', 'returnFlight'] as const).map((direction) => {
                const flight = trip[direction]
                const isOutbound = direction === 'outboundFlight'
                return <div className="seat-flight-route" key={direction}>
                  <div className="seat-flight-heading">
                    <strong>{isOutbound ? '去程' : '回程'}</strong>
                    <span>{prettyDate(isOutbound ? trip.startDate : trip.endDate, { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                  </div>
                  {flight ? <>
                    <p>{flight.departureAirport} {flight.departureTerminal} <span aria-hidden="true">→</span> {flight.arrivalAirport} {flight.arrivalTerminal}</p>
                    <small>{flight.airline} · {flight.number} · {flight.departureTime}–{flight.arrivalTime}</small>
                  </> : <p>尚未提供航班資料</p>}
                </div>
              })}
            </div>
            {trip.travelers.map((traveler) => <div className="traveler-row" key={traveler.id}>
              <div className="traveler-value"><span>英文姓名</span><strong>{traveler.name}</strong></div>
              <div className="traveler-value"><span>去程座位 · {trip.outboundFlight?.number ?? '未提供'}</span><strong>{traveler.outbound || '—'}</strong></div>
              <div className="traveler-value"><span>回程座位 · {trip.returnFlight?.number ?? '未提供'}</span><strong>{traveler.inbound || '—'}</strong></div>
            </div>)}
            {!trip.travelers.length && <div className="empty"><span>♙</span><strong>尚未提供旅客資料</strong></div>}
          </div>}
          {tab === 'notepad' && <section className="notepad-panel">
            <div className="section-heading"><div><span className="overline">TRIP NOTES</span><h2>旅程記事本</h2></div></div>
            <p className="notepad-description">{authRole === 'admin' ? '貼上這趟旅程需要留存的資訊、備忘或確認事項。' : '管理員與訪客共用這份記事；訪客只能查看。'}</p>
            {authRole === 'admin' ? <>
              <label className="visually-hidden" htmlFor="trip-notepad">記事本內容</label>
              <textarea
                id="trip-notepad"
                className="notepad-editor"
                value={trip.notepad ?? ''}
                onChange={(event) => updateTrip((current) => ({ ...current, notepad: event.target.value }))}
                placeholder="在這裡貼上或輸入記事…"
              />
            </> : <div className="notepad-readonly">{trip.notepad || '目前沒有記事。'}</div>}
            <div className="notepad-footer"><span>{authRole === 'admin' ? '自動保存至 NAS SQLite' : '唯讀 · NAS SQLite'}</span><span>{(trip.notepad ?? '').length} 字元</span></div>
          </section>}
          </>}
        </div>
      </main>
    </div>
  )
}

export default App
