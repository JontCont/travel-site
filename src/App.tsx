import { useEffect, useRef, useState } from 'react'
import { evaluateWalk, type WalkLeg } from './walking'
import { isWorkspace, listDates, loadWorkspace, type Trip, type TripWorkspace } from './trips'
import './App.css'

function amapSearch(keyword: string, city: string) {
  return `https://uri.amap.com/search?keyword=${encodeURIComponent(keyword)}&city=${encodeURIComponent(city)}`
}

function prettyDate(date: string, options: Intl.DateTimeFormatOptions = {
  month: 'long', day: 'numeric', weekday: 'short',
}) {
  return new Intl.DateTimeFormat('zh-TW', { ...options, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
}

function currentDateInTimeZone(timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

async function writeWorkspace(workspace: TripWorkspace) {
  const response = await fetch('/api/workspace', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(workspace),
  })
  if (response.ok) return
  const payload: unknown = await response.json().catch(() => null)
  const message = typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string'
    ? payload.error
    : `SQLite 儲存失敗（HTTP ${response.status}）。`
  throw new Error(message)
}

function App() {
  const [workspace, setWorkspace] = useState<TripWorkspace | null>(null)
  const [day, setDay] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [tab, setTab] = useState<'overview' | 'itinerary' | 'flights' | 'travelers'>('overview')
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
    let cancelled = false
    async function loadTripData() {
      try {
        const response = await fetch('/api/workspace')
        let loadedWorkspace: TripWorkspace
        if (response.status === 404) {
          const oldWorkspace = loadWorkspace(localStorage)
          if (!oldWorkspace) throw new Error('SQLite 尚無旅程資料，且找不到可遷移的舊版瀏覽器資料。')
          await writeWorkspace(oldWorkspace)
          loadedWorkspace = oldWorkspace
        } else {
          if (!response.ok) throw new Error(`讀取 SQLite 旅程資料失敗（HTTP ${response.status}）。`)
          const value: unknown = await response.json()
          if (!isWorkspace(value)) throw new Error('SQLite 回傳的旅程資料格式不正確。')
          loadedWorkspace = value
        }
        if (!cancelled) {
          setWorkspace(loadedWorkspace)
          setDay(loadedWorkspace.trips.find((trip) => trip.id === loadedWorkspace.activeTripId)?.startDate ?? '')
        }
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : '讀取旅程資料失敗。')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadTripData()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (loading || !workspace) return
    const version = ++saveVersion.current
    const snapshot = workspace
    saveSequence.current = saveSequence.current
      .catch(() => undefined)
      .then(() => writeWorkspace(snapshot))
      .then(() => {
        if (saveVersion.current === version) setSaveError('')
      })
      .catch((error: unknown) => {
        if (saveVersion.current === version) {
          setSaveError(error instanceof Error ? error.message : '保存旅程資料失敗。')
        }
      })
  }, [workspace, loading])

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
    if (!workspace || !trip) return
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

  const status = evaluateWalk(legs, Number(limits.leg), Number(limits.daily),
    Math.max(0, stops.length + (includeHotel ? 1 : -1)))
  const journeyStatus = trip && trip.endDate < currentDateInTimeZone(trip.timeZone)
    ? 'PAST JOURNEY'
    : 'UPCOMING JOURNEY'

  if (loading) return <main className="load-error">正在讀取本機 SQLite 旅程資料…</main>
  if (loadError || !workspace || !trip) return <main className="load-error" role="alert"><h1>無法開啟旅程</h1><p>{loadError || '目前沒有有效的旅程資料。'}</p><p>資料庫位於專案的 `data/trips.sqlite`；請先確認檔案存在或恢復備份。</p></main>

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" aria-label="途間首頁：我的旅程" onClick={() => setTab('overview')}><span className="brand-mark">✳</span><span>途間 <small>TRIP STUDIO</small></span></button>
        <div className="nav-label">你的旅程 <span className="trip-count">{workspace.trips.length}</span></div>
        <div className="trip-list">{workspace.trips.map((item) => <button key={item.id} className={`trip-link ${item.id === trip.id ? 'active' : ''}`} onClick={() => changeTrip(item.id)}><strong>{item.title}</strong><small>{item.destination} · {prettyDate(item.startDate, { month: 'numeric', day: 'numeric' })}</small></button>)}</div>
        <div className="nav-label nav-section">這趟旅程</div>
        <button className={`side-link ${tab === 'itinerary' ? 'active' : ''}`} onClick={() => setTab('itinerary')}>▦ <span>每日行程</span></button>
        <button className={`side-link ${tab === 'flights' ? 'active' : ''}`} onClick={() => setTab('flights')}>✈ <span>航班與住宿</span></button>
        <button className={`side-link ${tab === 'travelers' ? 'active' : ''}`} onClick={() => setTab('travelers')}>♙ <span>同行旅客</span></button>
        <div className="sidebar-bottom">
          <span className="status-dot" /> 本機 SQLite 儲存
          <p>不會同步其他裝置；請備份 data/trips.sqlite。</p>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">{tab !== 'overview' && <button className="topbar-back" onClick={() => setTab('overview')}>‹ 我的旅程</button>}<span className="topbar-title">{tab === 'overview' ? '我的旅程' : <>我的旅程 <span className="slash">/</span> {trip.title}</>}</span><span className="top-right">{workspace.trips.length} 趟旅程 · 本機 SQLite</span></header>
        <div className="content">
          {saveError && <p className="notice danger" role="alert">SQLite 儲存失敗：{saveError}</p>}
          {tab === 'overview' ? <section className="trips-overview">
            <div className="eyebrow">YOUR TRAVEL COLLECTION <span className="eyebrow-rule" /></div>
            <div className="section-heading"><div><span className="overline">TRIP LIBRARY · {workspace.trips.length} TRIPS</span><h2>每一趟旅程，都從這裡開始。</h2><p className="overview-caption">管理你的出國計畫，選取旅程以查看每日安排。</p></div></div>
            <div className="trip-cards">{workspace.trips.map((item, index) => {
              const tripDays = listDates(item.startDate, item.endDate)
              const places = Object.values(item.days).reduce((total, stopsForDay) => total + stopsForDay.length, 0)
              return <button className="trip-card" key={item.id} onClick={() => changeTrip(item.id)}>
                <div className={`trip-card-art art-${index % 4}`}><span>{item.country || 'TRAVEL PLAN'}</span><strong>{item.destination}</strong><small>{String(index + 1).padStart(2, '0')} / JOURNEY</small></div>
                <div className="trip-card-body"><div className="trip-card-title"><h3>{item.title}</h3><span>查看旅程 ↗</span></div><p>{prettyDate(item.startDate, { year: 'numeric', month: 'long', day: 'numeric' })} — {prettyDate(item.endDate, { year: 'numeric', month: 'long', day: 'numeric' })}</p><div className="trip-card-meta"><span>{tripDays.length} 天 {Math.max(0, tripDays.length - 1)} 夜</span><span>{places} 個行程項目</span><span>{item.timeZone}</span></div></div>
              </button>
            })}</div>
          </section> : <>
          <div className="eyebrow">{journeyStatus} <span className="eyebrow-rule" /></div>
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
          </nav>
          {tab === 'itinerary' && <>
            <div className="section-heading"><div><span className="overline">YOUR ITINERARY</span><h2>每天，都有新的風景。</h2></div><span className="muted">當地時間 · {trip.timeZone}</span></div>
            <div className="day-tabs" role="tablist" aria-label="選擇日期">
              {dates.map((date, index) => <button role="tab" aria-selected={activeDay === date} className={activeDay === date ? 'chosen' : ''} key={date} onClick={() => { setDay(date); setEditing(null); invalidateRoute() }}><small>DAY {String(index + 1).padStart(2, '0')}</small><strong>{prettyDate(date)}</strong></button>)}
            </div>
            <div className="workspace">
              <section className="schedule">
                <div className="panel-title"><div><span className="overline">DAY {dates.indexOf(activeDay) + 1} / {String(dates.length).padStart(2, '0')}</span><h3>{prettyDate(activeDay)} 的行程</h3></div><button className="small-action" onClick={() => { const id = crypto.randomUUID(); updateStops([...stops, { id, name: '', address: '', time: '10:00', duration: 60, coordinates: '' }]); setEditing(id) }}>＋ 新增景點</button></div>
                {isDeparture && trip.outboundFlight && <div className="event fixed"><div className="event-time">{trip.outboundFlight.departureTime}<small>{trip.outboundFlight.departureAirport}</small></div><span className="event-symbol">✈</span><div><span className="tag">固定行程 · 航班</span><h4>出發前往{trip.destination}</h4><p>{trip.outboundFlight.number} · {trip.outboundFlight.departureAirport} {trip.outboundFlight.departureTerminal} → {trip.outboundFlight.arrivalAirport} {trip.outboundFlight.arrivalTerminal} · {trip.outboundFlight.arrivalTime} 抵達</p></div></div>}
                {flightConflict && <p className="route-error" role="alert">景點時間與航班時段衝突；請另計入機場出入境及交通時間。</p>}
                {timeConflict && <p className="route-error" role="alert">景點時間有重疊或順序不符；請調整開始時間及停留時間，並預留移動時間。</p>}
                {stops.map((stop, index) => <div className="stop-block" key={stop.id}>
                  <div className="event"><div className="event-time">{stop.time}<small>當地</small></div><span className="event-symbol spot">{index + 1}</span><div className="event-body">
                    {editing === stop.id ? <form onSubmit={(event) => { event.preventDefault(); if (stop.name.trim()) setEditing(null) }}>
                      <label>景點名稱<input required value={stop.name} onChange={(event) => updateStop(stop.id, { name: event.target.value })} placeholder="輸入景點名稱" /></label>
                      <label>地址<input value={stop.address} onChange={(event) => updateStop(stop.id, { address: event.target.value })} placeholder="確認後再填寫" /></label>
                      <div className="form-row"><label>時間<input type="time" value={stop.time} onChange={(event) => updateStop(stop.id, { time: event.target.value })} /></label><label>最短停留分鐘<input type="number" min="0" value={stop.duration} onChange={(event) => { const duration = Math.max(0, Number(event.target.value)); updateStop(stop.id, { duration, ...(stop.durationMax !== undefined && stop.durationMax < duration ? { durationMax: duration } : {}) }) }} /></label><label>最長停留分鐘（選填）<input type="number" min={stop.duration} value={stop.durationMax ?? ''} onChange={(event) => updateStop(stop.id, { durationMax: event.target.value === '' ? undefined : Math.max(stop.duration, Number(event.target.value)) })} /></label></div>
                      <label>高德 GCJ-02 座標（經度,緯度）<input value={stop.coordinates} onChange={(event) => updateStop(stop.id, { coordinates: event.target.value })} placeholder="尚未確認可留空" /></label>
                      <label>備註<textarea value={stop.notes ?? ''} onChange={(event) => updateStop(stop.id, { notes: event.target.value })} placeholder="可記錄預約、票價或交通資訊" /></label>
                      <div className="form-actions"><button type="submit">完成</button><button type="button" className="plain" onClick={() => { updateStops(stops.filter((item) => item.id !== stop.id)); setEditing(null) }}>刪除</button></div>
                    </form> : <><span className="tag soft">{stop.duration === 0 ? '時間點' : `自由行程 · ${stop.duration}${stop.durationMax !== undefined && stop.durationMax > stop.duration ? `–${stop.durationMax}` : ''} 分鐘`}</span><h4>{stop.name || '未命名景點'}</h4><p>{stop.address || '地點地址未提供'} · {stop.coordinates ? '已輸入座標（請確認來源）' : '尚無座標'}</p>{stop.notes && <p className="stop-notes">{stop.notes}</p>}<div className="inline-actions"><button onClick={() => setEditing(stop.id)}>編輯</button><button disabled={index === 0} onClick={() => moveStop(index, -1)}>上移</button><button disabled={index === stops.length - 1} onClick={() => moveStop(index, 1)}>下移</button><a target="_blank" rel="noreferrer" href={amapSearch(`${stop.name} ${stop.address}`, trip.destination)}>地圖查看 ↗</a></div></>}
                  </div></div>
                  {index < stops.length - 1 && <div className="transfer">↳ 景點間步行路線尚未驗證</div>}
                </div>)}
                {isReturn && trip.returnFlight && <div className="event fixed"><div className="event-time">{trip.returnFlight.departureTime}<small>{trip.returnFlight.departureAirport}</small></div><span className="event-symbol">✈</span><div><span className="tag">固定行程 · 航班</span><h4>返程</h4><p>{trip.returnFlight.number} · {trip.returnFlight.departureAirport} {trip.returnFlight.departureTerminal} → {trip.returnFlight.arrivalAirport} {trip.returnFlight.arrivalTerminal} · {trip.returnFlight.arrivalTime} 抵達</p></div></div>}
                {!stops.length && <div className="empty"><span>✧</span><strong>這一天，留給你自由安排。</strong><p>新增想去的地方，開始規劃屬於你的{trip.destination}路線。</p></div>}
              </section>
              <aside className="route-panel">
                <div className="route-visual"><div className="map-grid" /><div className="map-route"><span className="pin-one">⌂</span><span className="dashes">············</span><span className="pin-two">✦</span></div><span className="map-note">路線示意 · 非真實地圖</span></div>
                <div className="route-content"><span className="overline">WALKABLE ROUTE</span><h3>走得剛剛好</h3><p>以高德實際步行路線驗證每一段與全天距離；未取得可驗證的完整路線前，不會判定符合上限。</p>
                  {trip.hotelName && <label>住宿座標（高德 GCJ-02 經度,緯度）<input value={trip.hotelCoordinates ?? ''} onChange={(event) => updateTrip((current) => ({ ...current, hotelCoordinates: event.target.value }))} placeholder="確認後填入" /></label>}
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
          </>}
        </div>
      </main>
    </div>
  )
}

export default App
