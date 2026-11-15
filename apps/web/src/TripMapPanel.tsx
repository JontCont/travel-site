import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
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
  舊金山: [-122.4194, 37.7749],
  紐約: [-74.006, 40.7128],
  倫敦: [-0.1276, 51.5074],
  巴黎: [2.3522, 48.8566],
  羅馬: [12.4964, 41.9028],
  雪梨: [151.2093, -33.8688],
}

type MapStyleKey = 'osm' | 'dark' | 'satellite' | 'hot'

const MAP_STYLES: Record<MapStyleKey, { name: string; style: maplibregl.StyleSpecification }> = {
  osm: {
    name: '🗺 標準街道 (OSM)',
    style: {
      version: 8,
      sources: {
        'osm-tiles': {
          type: 'raster',
          tiles: [
            'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          ],
          tileSize: 256,
          attribution: '&copy; OpenStreetMap contributors',
        },
      },
      layers: [
        {
          id: 'osm-layer',
          type: 'raster',
          source: 'osm-tiles',
          minzoom: 0,
          maxzoom: 19,
        },
      ],
    },
  },
  dark: {
    name: '🌙 深色夜間 (Dark Mode)',
    style: {
      version: 8,
      sources: {
        'esri-dark-base': {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          attribution: '&copy; Esri, HERE, Garmin, OpenStreetMap contributors',
        },
        'esri-dark-ref': {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          attribution: '&copy; Esri',
        },
      },
      layers: [
        {
          id: 'esri-dark-base-layer',
          type: 'raster',
          source: 'esri-dark-base',
          minzoom: 0,
          maxzoom: 19,
        },
        {
          id: 'esri-dark-ref-layer',
          type: 'raster',
          source: 'esri-dark-ref',
          minzoom: 0,
          maxzoom: 19,
        },
      ],
    },
  },
  satellite: {
    name: '🛰 衛星空照 (Satellite)',
    style: {
      version: 8,
      sources: {
        'esri-satellite': {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          attribution: '&copy; Esri, Maxar, Earthstar Geographics',
        },
      },
      layers: [
        {
          id: 'esri-satellite-layer',
          type: 'raster',
          source: 'esri-satellite',
          minzoom: 0,
          maxzoom: 19,
        },
      ],
    },
  },
  hot: {
    name: '🌿 暖色街道 (OSM HOT)',
    style: {
      version: 8,
      sources: {
        'osm-hot': {
          type: 'raster',
          tiles: [
            'https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
          ],
          tileSize: 256,
          attribution: '&copy; OpenStreetMap contributors, Humanitarian OpenStreetMap Team',
        },
      },
      layers: [
        {
          id: 'osm-hot-layer',
          type: 'raster',
          source: 'osm-hot',
          minzoom: 0,
          maxzoom: 19,
        },
      ],
    },
  },
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

export function TripMapPanel({ trip, authRole, onUpdateTrip }: TripMapPanelProps) {
  const tripDates = useMemo(() => listDates(trip.startDate, trip.endDate), [trip.startDate, trip.endDate])
  const [selectedDay, setSelectedDay] = useState<string>('all')
  const [mapStyleKey, setMapStyleKey] = useState<MapStyleKey>('osm')
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

  // Map references
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const tempMarkerRef = useRef<maplibregl.Marker | null>(null)

  // Gather all stops
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

  // Filtered stops
  const displayedStops = useMemo(() => {
    if (selectedDay === 'all') return allStopsWithMeta
    return allStopsWithMeta.filter((item) => item.dayDate === selectedDay)
  }, [allStopsWithMeta, selectedDay])

  // Stops with valid coords
  const mappedStops = useMemo(() => {
    return displayedStops
      .map((item) => {
        const coords = parseCoordinates(item.stop.coordinates)
        return coords ? { ...item, coords } : null
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
  }, [displayedStops])

  // Hotel coords
  const hotelCoords = useMemo(() => parseCoordinates(trip.hotelCoordinates), [trip.hotelCoordinates])

  // Default center calculation
  const defaultCenter = useMemo<[number, number]>(() => {
    if (mappedStops.length > 0) {
      const sumLng = mappedStops.reduce((sum, s) => sum + s.coords[0], 0)
      const sumLat = mappedStops.reduce((sum, s) => sum + s.coords[1], 0)
      return [sumLng / mappedStops.length, sumLat / mappedStops.length]
    }
    if (hotelCoords) {
      return hotelCoords
    }
    for (const [key, coords] of Object.entries(DESTINATION_COORDS)) {
      if (trip.destination.includes(key) || trip.title.includes(key)) {
        return coords
      }
    }
    return [116.4074, 39.9042]
  }, [mappedStops, hotelCoords, trip.destination, trip.title])

  // Focused stop detail
  const activeStopDetail = useMemo(() => {
    if (!selectedStopId) return null
    return allStopsWithMeta.find((item) => item.stop.id === selectedStopId) ?? null
  }, [allStopsWithMeta, selectedStopId])

  // Initialize MapLibre GL
  useEffect(() => {
    if (!mapContainerRef.current) return

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLES[mapStyleKey].style,
      center: defaultCenter,
      zoom: mappedStops.length > 0 ? 12 : 11,
      minZoom: 1,
      maxZoom: 19,
    })

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left')

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Update Route Polyline Layer
  const updateRouteLine = useCallback(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return

    const sourceId = 'route-source'
    const layerId = 'route-layer'

    if (map.getLayer(layerId)) map.removeLayer(layerId)
    if (map.getSource(sourceId)) map.removeSource(sourceId)

    if (mappedStops.length < 2) return

    const coordinates = mappedStops.map((s) => s.coords)

    map.addSource(sourceId, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates,
        },
      },
    })

    map.addLayer({
      id: layerId,
      type: 'line',
      source: sourceId,
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': '#2e6647',
        'line-width': 4,
        'line-dasharray': [2, 2],
      },
    })
  }, [mappedStops])

  // Handle map style change
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.setStyle(MAP_STYLES[mapStyleKey].style)
    map.once('style.load', () => {
      updateRouteLine()
    })
  }, [mapStyleKey, updateRouteLine])

  // Re-render markers and route lines when mappedStops or map changes
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Clear existing markers
    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []

    // Hotel marker
    if (hotelCoords) {
      const el = document.createElement('div')
      el.className = 'maplibre-marker hotel'
      el.innerHTML = '<span class="pin-symbol">⌂</span>'
      el.onclick = (e) => {
        e.stopPropagation()
        setSelectedStopId('hotel')
      }
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat(hotelCoords)
        .addTo(map)
      markersRef.current.push(marker)
    }

    // Stop markers
    mappedStops.forEach((item, idx) => {
      const el = document.createElement('div')
      el.className = `maplibre-marker stop ${selectedStopId === item.stop.id ? 'active' : ''}`
      el.innerHTML = `<span class="pin-num">${idx + 1}</span>`
      el.title = `${idx + 1}. ${item.stop.name} (${item.stop.time})`
      el.onclick = (e) => {
        e.stopPropagation()
        setSelectedStopId(item.stop.id)
      }

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat(item.coords)
        .addTo(map)
      markersRef.current.push(marker)
    })

    // If map is loaded, update polyline
    if (map.isStyleLoaded()) {
      updateRouteLine()
    } else {
      map.once('style.load', updateRouteLine)
    }
  }, [mappedStops, hotelCoords, selectedStopId, updateRouteLine])

  // Map Click Listener for Marking mode
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const handleMapClick = (e: maplibregl.MapMouseEvent) => {
      if (!isMarkingMode) return

      const coords: [number, number] = [
        Number(e.lngLat.lng.toFixed(5)),
        Number(e.lngLat.lat.toFixed(5)),
      ]
      setMarkedCoords(coords)

      // Add temporary marker
      if (tempMarkerRef.current) tempMarkerRef.current.remove()
      const el = document.createElement('div')
      el.className = 'maplibre-marker temp-pin'
      el.innerHTML = '<span class="pulse-dot"></span>'
      tempMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat(coords)
        .addTo(map)

      // If assigning to an existing stop
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
        if (tempMarkerRef.current) {
          tempMarkerRef.current.remove()
          tempMarkerRef.current = null
        }
      }
    }

    map.on('click', handleMapClick)
    return () => {
      map.off('click', handleMapClick)
    }
  }, [isMarkingMode, pendingStopTargetId, onUpdateTrip])

  // Change cursor when marking mode toggles
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.getCanvas().style.cursor = isMarkingMode ? 'crosshair' : ''
  }, [isMarkingMode])

  // Reset view to bounds
  const handleResetBounds = () => {
    const map = mapRef.current
    if (!map) return

    if (mappedStops.length > 1) {
      const bounds = new maplibregl.LngLatBounds()
      mappedStops.forEach((s) => bounds.extend(s.coords))
      if (hotelCoords) bounds.extend(hotelCoords)
      map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 1000 })
    } else if (mappedStops.length === 1) {
      map.flyTo({ center: mappedStops[0].coords, zoom: 14, duration: 1000 })
    } else {
      map.flyTo({ center: defaultCenter, zoom: 12, duration: 1000 })
    }
  }

  // Pan to stop
  const panToStop = (stop: Stop) => {
    const coords = parseCoordinates(stop.coordinates)
    setSelectedStopId(stop.id)
    if (coords && mapRef.current) {
      mapRef.current.flyTo({ center: coords, zoom: 15, duration: 1000 })
    }
  }

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
    setFormSuccessMessage(`✓ 景點「${newStop.name}」已成功新增！`)
    setTimeout(() => setFormSuccessMessage(''), 4000)
    setIsMarkingMode(false)
    setMarkedCoords(null)
    setSelectedStopId(newStop.id)
    if (tempMarkerRef.current) {
      tempMarkerRef.current.remove()
      tempMarkerRef.current = null
    }
  }

  return (
    <div className="trip-map-container">
      {/* Header */}
      <div className="trip-map-header">
        <div className="trip-map-title">
          <span className="overline">MAPLIBRE STREET MAP</span>
          <h3>{trip.destination} · 街道級高精度地圖</h3>
          <span className="map-badge">已標記 {mappedStops.length} 處地點</span>
        </div>

        {/* Day selection */}
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

        {/* Style Selector & Controls */}
        <div className="trip-map-actions">
          <select
            className="map-style-select"
            value={mapStyleKey}
            onChange={(e) => setMapStyleKey(e.target.value as MapStyleKey)}
          >
            {Object.entries(MAP_STYLES).map(([key, item]) => (
              <option key={key} value={key}>
                {item.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="map-btn"
            onClick={handleResetBounds}
            title="自動縮放對齊所有景點"
          >
            ⌖ 置中對齊
          </button>

          {authRole === 'admin' && (
            <button
              type="button"
              className={`map-btn map-btn-primary ${isMarkingMode ? 'active' : ''}`}
              onClick={() => {
                setIsMarkingMode((m) => !m)
                setPendingStopTargetId(null)
                if (tempMarkerRef.current) {
                  tempMarkerRef.current.remove()
                  tempMarkerRef.current = null
                }
              }}
            >
              {isMarkingMode ? '✕ 取消標記' : '⚲ 標記新地點'}
            </button>
          )}
        </div>
      </div>

      {/* Marking Instructions */}
      {isMarkingMode && (
        <div className="map-instruction-banner">
          {pendingStopTargetId ? (
            <>請直接點擊地圖上的街道或建築位置，即可將該座標賦予選定景點。</>
          ) : (
            <>點擊地圖任意街道或建築位置進行標記，下方表單將自動填入經緯度以新增景點。</>
          )}
        </div>
      )}

      {/* Success Alert */}
      {formSuccessMessage && <div className="map-success-alert">{formSuccessMessage}</div>}

      {/* Main Map + Sidebar */}
      <div className="trip-map-body">
        {/* MapLibre WebGL Canvas Container */}
        <div className="trip-map-canvas">
          <div ref={mapContainerRef} className="maplibre-gl-canvas-holder" />

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

        {/* Sidebar */}
        <aside className="trip-map-sidebar">
          {/* New Spot Form */}
          {isMarkingMode && !pendingStopTargetId && (
            <form className="map-add-form" onSubmit={handleCreateMarkedStop}>
              <h4>⚲ 標記並新增景點</h4>
              <p className="form-subtext">在左側街道地圖上點擊以獲取精確經緯度。</p>

              <label>
                景點名稱 *
                <input
                  type="text"
                  required
                  placeholder="例如：故宮博物院"
                  value={newStopName}
                  onChange={(e) => setNewStopName(e.target.value)}
                />
              </label>

              <label>
                經緯度 (經度,緯度)
                <input
                  type="text"
                  placeholder="點擊街道地圖自動填入"
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
                  placeholder="詳細街道地址"
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
                    if (tempMarkerRef.current) {
                      tempMarkerRef.current.remove()
                      tempMarkerRef.current = null
                    }
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
                            <span className="status-tag tagged">✓ 已標記座標</span>
                          ) : (
                            <span className="status-tag untagged">✕ 尚無座標</span>
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
