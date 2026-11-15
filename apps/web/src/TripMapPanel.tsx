import { useState, useMemo, useCallback } from 'react'
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
  Line,
  ZoomableGroup,
  useMapContext,
} from 'react-simple-maps'
import geoData from 'world-atlas/countries-110m.json'
import {
  buildTripMapSearchUrl,
  listDates,
  type Stop,
  type Trip,
} from '@travel/shared'

function prettyDate(date: string, options: Intl.DateTimeFormatOptions = {
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
}) {
  const [year, month, day] = date.split('-').map(Number)
  return new Intl.DateTimeFormat('zh-TW', options).format(new Date(year, month - 1, day))
}

export interface TripMapPanelProps {
  trip: Trip
  authRole: string
  onUpdateTrip: (updater: (prev: Trip) => Trip) => void
}

const DESTINATION_COORDS: Record<string, [number, number]> = {
  北京: [116.4074, 39.9042],
  東京: [139.6917, 35.6895],
  京都: [135.7681, 35.0116],
  大阪: [135.5023, 34.6937],
  首爾: [126.978, 37.5665],
  台北: [121.5654, 25.033],
  高雄: [120.3014, 22.6273],
  香港: [114.1694, 22.3193],
  澳門: [113.5439, 22.1987],
  新加坡: [103.8198, 1.3521],
  曼谷: [100.5018, 13.7563],
  倫敦: [-0.1276, 51.5074],
  巴黎: [2.3522, 48.8566],
  紐約: [-74.006, 40.7128],
  舊金山: [-122.4194, 37.7749],
  羅馬: [12.4964, 41.9028],
  雪梨: [151.2093, -33.8688],
}

function parseCoordinates(value: string | undefined): [number, number] | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!/^-?\d{1,3}(?:\.\d{1,6})?,-?\d{1,2}(?:\.\d{1,6})?$/.test(trimmed)) {
    return null
  }
  const [lng, lat] = trimmed.split(',').map(Number)
  if (lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90) {
    return [lng, lat]
  }
  return null
}

interface MapClickHandlerProps {
  active: boolean
  onMapClick: (coords: [number, number]) => void
}

function MapClickHandler({ active, onMapClick }: MapClickHandlerProps) {
  const { projection } = useMapContext()

  if (!active) return null

  return (
    <rect
      width="100%"
      height="100%"
      fill="transparent"
      style={{ cursor: 'crosshair' }}
      onClick={(e) => {
        const svg = e.currentTarget.ownerSVGElement
        if (!svg || !projection) return
        const pt = svg.createSVGPoint()
        pt.x = e.clientX
        pt.y = e.clientY
        const svgP = pt.matrixTransform(svg.getScreenCTM()?.inverse())
        const inverted = projection.invert?.([svgP.x, svgP.y])
        if (inverted && !isNaN(inverted[0]) && !isNaN(inverted[1])) {
          onMapClick([
            Number(inverted[0].toFixed(5)),
            Number(inverted[1].toFixed(5)),
          ])
        }
      }}
    />
  )
}

export function TripMapPanel({ trip, authRole, onUpdateTrip }: TripMapPanelProps) {
  const tripDates = useMemo(() => listDates(trip.startDate, trip.endDate), [trip.startDate, trip.endDate])
  const [selectedDay, setSelectedDay] = useState<string>('all')
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null)
  const [isMarkingMode, setIsMarkingMode] = useState(false)
  const [markedCoords, setMarkedCoords] = useState<[number, number] | null>(null)
  const [pendingStopTargetId, setPendingStopTargetId] = useState<string | null>(null)

  // New Stop Form State
  const [newStopName, setNewStopName] = useState('')
  const [newStopDay, setNewStopDay] = useState(tripDates[0] ?? trip.startDate)
  const [newStopTime, setNewStopTime] = useState('11:00')
  const [newStopDuration, setNewStopDuration] = useState('60')
  const [newStopAddress, setNewStopAddress] = useState('')
  const [formSuccessMessage, setFormSuccessMessage] = useState('')

  // Gather all stops for display
  const allStopsWithMeta = useMemo(() => {
    const list: Array<{ stop: Stop; dayDate: string; dayIndex: number; order: number }> = []
    tripDates.forEach((date, dayIndex) => {
      const stopsForDay = trip.days[date] ?? []
      stopsForDay.forEach((stop, order) => {
        list.push({ stop, dayDate: date, dayIndex, order })
      })
    })
    return list
  }, [tripDates, trip.days])

  // Filtered stops based on selected day
  const displayedStops = useMemo(() => {
    if (selectedDay === 'all') return allStopsWithMeta
    return allStopsWithMeta.filter((item) => item.dayDate === selectedDay)
  }, [allStopsWithMeta, selectedDay])

  // Valid coordinate stops
  const mappedStops = useMemo(() => {
    return displayedStops
      .map((item) => {
        const coords = parseCoordinates(item.stop.coordinates)
        return coords ? { ...item, coords } : null
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
  }, [displayedStops])

  // Hotel location
  const hotelCoords = useMemo(() => parseCoordinates(trip.hotelCoordinates), [trip.hotelCoordinates])

  // Calculate default map center
  const defaultCenter = useMemo<[number, number]>(() => {
    // 1. If we have mapped stops, average their coordinates
    if (mappedStops.length > 0) {
      const sumLng = mappedStops.reduce((sum, s) => sum + s.coords[0], 0)
      const sumLat = mappedStops.reduce((sum, s) => sum + s.coords[1], 0)
      return [sumLng / mappedStops.length, sumLat / mappedStops.length]
    }
    // 2. Hotel
    if (hotelCoords) {
      return hotelCoords
    }
    // 3. Known destination
    for (const [key, coords] of Object.entries(DESTINATION_COORDS)) {
      if (trip.destination.includes(key) || trip.title.includes(key)) {
        return coords
      }
    }
    // 4. Default fallback: Tokyo / East Asia
    return [116.4074, 39.9042]
  }, [mappedStops, hotelCoords, trip.destination, trip.title])

  const [mapCenter, setMapCenter] = useState<[number, number]>(defaultCenter)
  const [zoom, setZoom] = useState<number>(mappedStops.length > 0 ? 8 : 4)

  // Consecutive paths between stops on the same day
  const pathLines = useMemo(() => {
    const lines: Array<{ from: [number, number]; to: [number, number]; key: string }> = []
    if (selectedDay !== 'all') {
      for (let i = 0; i < mappedStops.length - 1; i++) {
        lines.push({
          from: mappedStops[i].coords,
          to: mappedStops[i + 1].coords,
          key: `line-${mappedStops[i].stop.id}-${mappedStops[i + 1].stop.id}`,
        })
      }
    }
    return lines
  }, [mappedStops, selectedDay])

  // Currently focused / active stop
  const activeStopDetail = useMemo(() => {
    if (!selectedStopId) return null
    return allStopsWithMeta.find((item) => item.stop.id === selectedStopId) ?? null
  }, [allStopsWithMeta, selectedStopId])

  // Handle map click
  const handleMapClick = useCallback((coords: [number, number]) => {
    setMarkedCoords(coords)

    // If we were waiting to mark an existing stop
    if (pendingStopTargetId) {
      const coordStr = `${coords[0]},${coords[1]}`
      onUpdateTrip((prev) => {
        const nextDays = { ...prev.days }
        for (const [d, stops] of Object.entries(nextDays)) {
          if (stops.some((s) => s.id === pendingStopTargetId)) {
            nextDays[d] = stops.map((s) => (s.id === pendingStopTargetId ? { ...s, coordinates: coordStr } : s))
            break
          }
        }
        return { ...prev, days: nextDays }
      })
      setFormSuccessMessage(`✓ 已為景點設定座標：${coordStr}`)
      setTimeout(() => setFormSuccessMessage(''), 3000)
      setPendingStopTargetId(null)
      setIsMarkingMode(false)
    }
  }, [pendingStopTargetId, onUpdateTrip])

  // Save new marked stop
  const handleCreateMarkedStop = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newStopName.trim()) return

    const coordStr = markedCoords ? `${markedCoords[0]},${markedCoords[1]}` : ''
    const newStop: Stop = {
      id: crypto.randomUUID(),
      name: newStopName.trim(),
      time: newStopTime,
      duration: Number(newStopDuration) || 60,
      address: newStopAddress.trim(),
      coordinates: coordStr,
    }

    onUpdateTrip((prev) => {
      const currentList = prev.days[newStopDay] ?? []
      const updated = [...currentList, newStop].sort((a, b) => a.time.localeCompare(b.time))
      return {
        ...prev,
        days: {
          ...prev.days,
          [newStopDay]: updated,
        },
      }
    })

    setNewStopName('')
    setNewStopAddress('')
    setFormSuccessMessage(`✓ 景點「${newStop.name}」已成功新增至 ${prettyDate(newStopDay)}！`)
    setTimeout(() => setFormSuccessMessage(''), 4000)
    setIsMarkingMode(false)
    setMarkedCoords(null)
    setSelectedStopId(newStop.id)
  }

  // Pan to a specific stop
  const panToStop = (stop: Stop) => {
    const coords = parseCoordinates(stop.coordinates)
    setSelectedStopId(stop.id)
    if (coords) {
      setMapCenter(coords)
      setZoom(12)
    }
  }

  return (
    <div className="trip-map-container">
      {/* Map Control Header */}
      <div className="trip-map-header">
        <div className="trip-map-title">
          <span className="overline">LOCATION MAP</span>
          <h3>{trip.destination} · 地點標記地圖</h3>
          <span className="map-badge">
            已標記 {mappedStops.length} 個地點
          </span>
        </div>

        {/* Day selection tabs */}
        <div className="trip-map-days">
          <button
            type="button"
            className={selectedDay === 'all' ? 'active' : ''}
            onClick={() => setSelectedDay('all')}
          >
            全部 ({allStopsWithMeta.length})
          </button>
          {tripDates.map((date, idx) => (
            <button
              key={date}
              type="button"
              className={selectedDay === date ? 'active' : ''}
              onClick={() => setSelectedDay(date)}
            >
              DAY {idx + 1}
            </button>
          ))}
        </div>

        {/* Zoom & Action Controls */}
        <div className="trip-map-actions">
          <button
            type="button"
            className="map-btn"
            onClick={() => setZoom((z) => Math.min(z * 1.5, 40))}
            title="放大地圖"
          >
            ＋
          </button>
          <button
            type="button"
            className="map-btn"
            onClick={() => setZoom((z) => Math.max(z / 1.5, 1))}
            title="縮小地圖"
          >
            −
          </button>
          <button
            type="button"
            className="map-btn"
            onClick={() => {
              setMapCenter(defaultCenter)
              setZoom(mappedStops.length > 0 ? 8 : 4)
            }}
            title="重設視角"
          >
            ⌖ 重設
          </button>

          {authRole === 'admin' && (
            <button
              type="button"
              className={`map-btn map-btn-primary ${isMarkingMode ? 'active' : ''}`}
              onClick={() => {
                setIsMarkingMode((m) => !m)
                setPendingStopTargetId(null)
              }}
            >
              {isMarkingMode ? '✕ 取消標記' : '⚲ 標記新地點'}
            </button>
          )}
        </div>
      </div>

      {/* Marking Instructions Banner */}
      {isMarkingMode && (
        <div className="map-instruction-banner">
          {pendingStopTargetId ? (
            <>請直接點擊地圖上的任意位置，即可將該經緯度賦予選定景點。</>
          ) : (
            <>點擊地圖上的任意位置進行標記，下方表單將自動填入經緯度以新增景點。</>
          )}
        </div>
      )}

      {/* Success Alert */}
      {formSuccessMessage && (
        <div className="map-success-alert">
          {formSuccessMessage}
        </div>
      )}

      {/* Main Map + Sidebar Workspace */}
      <div className="trip-map-body">
        {/* SVG Map Canvas */}
        <div className="trip-map-canvas">
          <ComposableMap
            projection="geoMercator"
            projectionConfig={{ scale: 100 }}
            width={800}
            height={500}
            style={{ width: '100%', height: '100%' }}
          >
            <ZoomableGroup
              center={mapCenter}
              zoom={zoom}
              onMoveEnd={({ coordinates, zoom: newZoom }) => {
                if (coordinates) setMapCenter(coordinates)
                if (newZoom) setZoom(newZoom)
              }}
            >
              {/* World Geographies */}
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <Geographies geography={geoData as any}>
                {({ geographies }) =>
                  geographies.map((geo) => (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      fill="#dbe5da"
                      stroke="#c2d4c0"
                      strokeWidth={Math.max(0.2, 0.6 / Math.sqrt(zoom))}
                      className="map-geography"
                      style={{ outline: 'none' }}
                    />
                  ))
                }
              </Geographies>

              {/* Sequential Path Lines between stops on selected day */}
              {pathLines.map((line) => (
                <Line
                  key={line.key}
                  from={line.from}
                  to={line.to}
                  stroke="#2e6647"
                  strokeWidth={Math.max(1, 2.5 / zoom)}
                  strokeDasharray={`${5 / zoom} ${3 / zoom}`}
                  strokeLinecap="round"
                />
              ))}

              {/* Hotel Marker if available */}
              {hotelCoords && (
                <Marker coordinates={hotelCoords}>
                  <g
                    transform={`scale(${1 / Math.max(0.5, zoom)})`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelectedStopId('hotel')}
                  >
                    <circle r={12} fill="#b85d38" stroke="#ffffff" strokeWidth={2} />
                    <text textAnchor="middle" y={4} fontSize={11} fill="#ffffff" fontWeight="bold">
                      ⌂
                    </text>
                  </g>
                </Marker>
              )}

              {/* Stop Markers */}
              {mappedStops.map((item, idx) => {
                const isSelected = selectedStopId === item.stop.id
                return (
                  <Marker
                    key={item.stop.id}
                    coordinates={item.coords}
                    onClick={() => setSelectedStopId(item.stop.id)}
                  >
                    <g
                      transform={`scale(${1 / Math.max(0.5, zoom)})`}
                      style={{ cursor: 'pointer' }}
                    >
                      {isSelected && (
                        <circle r={18} fill="none" stroke="#2e6647" strokeWidth={3} opacity={0.5} />
                      )}
                      <circle
                        r={12}
                        fill={isSelected ? '#143827' : '#2e6647'}
                        stroke="#ffffff"
                        strokeWidth={2}
                      />
                      <text
                        textAnchor="middle"
                        y={4}
                        fontSize={11}
                        fill="#ffffff"
                        fontWeight="bold"
                        fontFamily="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
                      >
                        {idx + 1}
                      </text>
                    </g>
                  </Marker>
                )
              })}

              {/* Click Pin Marker (when in marking mode) */}
              {markedCoords && (
                <Marker coordinates={markedCoords}>
                  <g transform={`scale(${1 / Math.max(0.5, zoom)})`}>
                    <circle r={7} fill="#e63946" stroke="#ffffff" strokeWidth={2} />
                    <circle r={14} fill="none" stroke="#e63946" strokeWidth={2} strokeDasharray="3 2" />
                  </g>
                </Marker>
              )}

              {/* Map Click Listener */}
              <MapClickHandler active={isMarkingMode} onMapClick={handleMapClick} />
            </ZoomableGroup>
          </ComposableMap>

          {/* Floating Selected Spot Card */}
          {activeStopDetail && (
            <div className="map-stop-popup">
              <div className="popup-header">
                <div>
                  <span className="popup-tag">DAY {activeStopDetail.dayIndex + 1} · {activeStopDetail.stop.time}</span>
                  <h4>{activeStopDetail.stop.name}</h4>
                </div>
                <button
                  type="button"
                  className="popup-close"
                  onClick={() => setSelectedStopId(null)}
                  aria-label="關閉"
                >
                  ✕
                </button>
              </div>
              <p className="popup-address">{activeStopDetail.stop.address || '尚未提供詳細地址'}</p>
              {activeStopDetail.stop.coordinates && (
                <p className="popup-coords">
                  經緯度：<code>{activeStopDetail.stop.coordinates}</code>
                </p>
              )}
              {activeStopDetail.stop.notes && (
                <p className="popup-notes">{activeStopDetail.stop.notes}</p>
              )}
              <div className="popup-actions">
                <a
                  href={buildTripMapSearchUrl(trip, activeStopDetail.stop.name, activeStopDetail.stop.address)}
                  target="_blank"
                  rel="noreferrer"
                  className="popup-btn"
                >
                  外部地圖查看 ↗
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar: Spot List & Add Form */}
        <aside className="trip-map-sidebar">
          {/* New Spot Form when in Marking Mode */}
          {isMarkingMode && !pendingStopTargetId && (
            <form className="map-add-form" onSubmit={handleCreateMarkedStop}>
              <h4>⚲ 標記並新增景點</h4>
              <p className="form-subtext">在左側地圖上點擊以獲取精確經緯度。</p>

              <label>
                景點名稱 *
                <input
                  type="text"
                  required
                  placeholder="例如：景山公園"
                  value={newStopName}
                  onChange={(e) => setNewStopName(e.target.value)}
                />
              </label>

              <label>
                經緯度 (經度,緯度)
                <input
                  type="text"
                  placeholder="點地圖自動填入"
                  value={markedCoords ? `${markedCoords[0]},${markedCoords[1]}` : ''}
                  onChange={(e) => {
                    const parsed = parseCoordinates(e.target.value)
                    if (parsed) setMarkedCoords(parsed)
                  }}
                />
              </label>

              <div className="form-row">
                <label>
                  日期
                  <select value={newStopDay} onChange={(e) => setNewStopDay(e.target.value)}>
                    {tripDates.map((date, idx) => (
                      <option key={date} value={date}>
                        DAY {idx + 1} ({prettyDate(date)})
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  時間
                  <input
                    type="time"
                    value={newStopTime}
                    onChange={(e) => setNewStopTime(e.target.value)}
                  />
                </label>
              </div>

              <div className="form-row">
                <label>
                  預計停留 (分鐘)
                  <input
                    type="number"
                    min="10"
                    step="5"
                    value={newStopDuration}
                    onChange={(e) => setNewStopDuration(e.target.value)}
                  />
                </label>
              </div>

              <label>
                地址 (選填)
                <input
                  type="text"
                  placeholder="詳細地址"
                  value={newStopAddress}
                  onChange={(e) => setNewStopAddress(e.target.value)}
                />
              </label>

              <div className="form-submit-row">
                <button type="submit" className="add-submit-btn">
                  新增至行程
                </button>
                <button
                  type="button"
                  className="cancel-btn"
                  onClick={() => {
                    setIsMarkingMode(false)
                    setMarkedCoords(null)
                  }}
                >
                  取消
                </button>
              </div>
            </form>
          )}

          {/* Spots List */}
          <div className="map-spots-list-section">
            <div className="list-title">
              <h4>行程地點清單</h4>
              <span>共 {displayedStops.length} 處</span>
            </div>

            <div className="map-spots-scroll">
              {displayedStops.length === 0 ? (
                <div className="empty-spots-notice">
                  <span>⚲</span>
                  <p>這一天目前沒有安排景點。</p>
                </div>
              ) : (
                displayedStops.map((item, idx) => {
                  const hasCoords = Boolean(parseCoordinates(item.stop.coordinates))
                  const isSelected = selectedStopId === item.stop.id

                  return (
                    <div
                      key={item.stop.id}
                      className={`map-spot-item ${isSelected ? 'selected' : ''}`}
                      onClick={() => panToStop(item.stop)}
                    >
                      <div className="spot-num-badge">{idx + 1}</div>
                      <div className="spot-meta">
                        <div className="spot-header-line">
                          <strong>{item.stop.name}</strong>
                          <span className="spot-time">{item.stop.time}</span>
                        </div>
                        <p className="spot-address">{item.stop.address || '地址尚未提供'}</p>

                        <div className="spot-status-row">
                          {hasCoords ? (
                            <span className="status-tag tagged">
                              ✓ 已標記座標
                            </span>
                          ) : (
                            <span className="status-tag untagged">
                              ✕ 尚無座標
                            </span>
                          )}

                          {authRole === 'admin' && !hasCoords && (
                            <button
                              type="button"
                              className="mark-this-btn"
                              onClick={(e) => {
                                e.stopPropagation()
                                setIsMarkingMode(true)
                                setPendingStopTargetId(item.stop.id)
                              }}
                            >
                              點地圖標記
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
