import type { Footprint } from '../models/trip.ts'

const maxFootprints = 300

type TripRange = { startDate: string; endDate: string; timeZone: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseGeo(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const match = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(value.trim())
  if (!match) return undefined
  const latitude = Number(match[1])
  const longitude = Number(match[2])
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return undefined
  return `${longitude},${latitude}`
}

function toIso(value: unknown): string | undefined {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return undefined
  return new Date(value).toISOString()
}

function localDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(iso))
}

function visitsFromSemanticEntry(entry: unknown): Footprint[] {
  if (!isRecord(entry) || !isRecord(entry.visit)) return []
  const candidate = isRecord(entry.visit.topCandidate) ? entry.visit.topCandidate : undefined
  const coordinates = parseGeo(candidate?.placeLocation)
  const startedAt = toIso(entry.startTime)
  const endedAt = toIso(entry.endTime)
  if (!coordinates || !startedAt || !endedAt) return []
  return [{ id: `${startedAt}|${coordinates}`, startedAt, endedAt, coordinates }]
}

function pointsFromRecordsLocation(entry: unknown): Footprint[] {
  if (!isRecord(entry) || typeof entry.latitudeE7 !== 'number' || typeof entry.longitudeE7 !== 'number') return []
  const latitude = entry.latitudeE7 / 1e7
  const longitude = entry.longitudeE7 / 1e7
  const iso = typeof entry.timestamp === 'string'
    ? toIso(entry.timestamp)
    : typeof entry.timestampMs === 'string' && Number.isFinite(Number(entry.timestampMs))
      ? new Date(Number(entry.timestampMs)).toISOString()
      : undefined
  if (!iso || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return []
  const coordinates = `${longitude.toFixed(7)},${latitude.toFixed(7)}`
  return [{ id: `${iso}|${coordinates}`, startedAt: iso, endedAt: iso, coordinates }]
}

export function parseTimelineExport(data: unknown, range: TripRange): Footprint[] {
  let footprints: Footprint[]
  if (Array.isArray(data)) {
    footprints = data.flatMap(visitsFromSemanticEntry)
  } else if (isRecord(data) && Array.isArray(data.timelineObjects)) {
    footprints = data.timelineObjects.flatMap(visitsFromSemanticEntry)
  } else if (isRecord(data) && Array.isArray(data.locations)) {
    footprints = data.locations.flatMap(pointsFromRecordsLocation)
  } else {
    throw new Error('無法辨識的時間軸檔案；請使用 Google 地圖時間軸匯出的 JSON。')
  }

  const seen = new Set<string>()
  return footprints
    .filter((item) => {
      const date = localDate(item.startedAt, range.timeZone)
      if (date < range.startDate || date > range.endDate || seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .slice(0, maxFootprints)
}

export function mergeFootprints(existing: Footprint[] = [], incoming: Footprint[]): Footprint[] {
  const ids = new Set(existing.map((item) => item.id))
  const merged = [...existing, ...incoming.filter((item) => !ids.has(item.id))]
  return merged.sort((a, b) => a.startedAt.localeCompare(b.startedAt)).slice(0, maxFootprints)
}
