function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isChinaTrip(country: string): boolean {
  return country.trim().startsWith('中國')
}

function normalizePlaceLabel(placeLabel: string): string {
  return placeLabel.includes('→')
    ? placeLabel.split('→').at(-1)?.trim() || placeLabel.trim()
    : placeLabel.trim()
}

export function buildAmapPlaceSearchUrl(placeLabel: string, city: string, address = ''): string {
  const url = new URL('https://uri.amap.com/search')
  url.searchParams.set('keyword', [normalizePlaceLabel(placeLabel), address.trim()].filter(Boolean).join(' '))
  url.searchParams.set('city', city)
  return url.toString()
}

export function buildGoogleMapsSearchUrl(placeLabel: string, address = ''): string {
  const url = new URL('https://www.google.com/maps/search/')
  url.searchParams.set('api', '1')
  url.searchParams.set('query', [normalizePlaceLabel(placeLabel), address.trim()].filter(Boolean).join(' '))
  return url.toString()
}

export function buildTripMapSearchUrl(
  trip: { country: string; destination: string },
  placeLabel: string,
  address = '',
): string {
  return isChinaTrip(trip.country)
    ? buildAmapPlaceSearchUrl(placeLabel, trip.destination, address)
    : buildGoogleMapsSearchUrl(placeLabel, address)
}

export type RouteMode = 'walking' | 'transit' | 'driving'
export const routeModeLabels: Record<RouteMode, string> = { walking: '步行', transit: '大眾運輸', driving: '開車' }

export function buildGoogleDirectionsUrl(origin: string, destination: string, mode: RouteMode): string {
  const url = new URL('https://www.google.com/maps/dir/')
  url.searchParams.set('api', '1')
  url.searchParams.set('origin', origin)
  url.searchParams.set('destination', destination)
  url.searchParams.set('travelmode', mode)
  return url.toString()
}

export function buildGoogleMapsCoordinateUrl(coordinates: string): string {
  const [longitude, latitude] = coordinates.split(',')
  const url = new URL('https://www.google.com/maps/search/')
  url.searchParams.set('api', '1')
  url.searchParams.set('query', `${latitude},${longitude}`)
  return url.toString()
}


export async function getMapApiKey(): Promise<string> {
  const response = await fetch('/api/map-config', { credentials: 'same-origin' })
  let value: unknown
  try {
    value = await response.json()
  } catch {
    throw new Error('地圖設定服務回傳的資料格式不正確。')
  }
  if (!response.ok) {
    throw new Error(isRecord(value) && typeof value.error === 'string'
      ? value.error
      : `讀取地圖設定失敗（HTTP ${response.status}）。`)
  }
  if (!isRecord(value) || typeof value.apiKey !== 'string') {
    throw new Error('地圖設定服務回傳的資料格式不正確。')
  }
  return value.apiKey
}
