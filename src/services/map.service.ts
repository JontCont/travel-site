function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function buildAmapPlaceSearchUrl(placeLabel: string, city: string, address = ''): string {
  const destination = placeLabel.includes('→')
    ? placeLabel.split('→').at(-1)?.trim() || placeLabel.trim()
    : placeLabel.trim()
  const url = new URL('https://uri.amap.com/search')
  url.searchParams.set('keyword', [destination, address.trim()].filter(Boolean).join(' '))
  url.searchParams.set('city', city)
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
