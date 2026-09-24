import { mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isTripWorkspaceDto } from './src/dto/trip-workspace.dto.ts'

const coordinatePattern = /^-?\d{1,3}(?:\.\d{1,6})?,-?\d{1,2}(?:\.\d{1,6})?$/
const defaultDatabasePath = fileURLToPath(new URL('./data/trips.sqlite', import.meta.url))

export function openTripDatabase(databasePath = process.env.TRIP_DATABASE_PATH ?? defaultDatabasePath) {
  const resolvedPath = resolve(databasePath)
  mkdirSync(dirname(resolvedPath), { recursive: true })
  const database = new DatabaseSync(resolvedPath)
  database.exec('CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK (id = 1), data_json TEXT NOT NULL)')
  return database
}

export function createTripApi(database) {
  database.exec('CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK (id = 1), data_json TEXT NOT NULL)')
  const readWorkspace = database.prepare('SELECT data_json FROM workspace WHERE id = 1')
  const writeWorkspace = database.prepare(`
    INSERT INTO workspace (id, data_json) VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json
  `)

  return async function tripApi(req, res, next) {
    if (req.url?.split('?')[0] !== '/api/workspace') return next()
    const reply = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(data))
    }
    if (req.method === 'GET') {
      const row = readWorkspace.get()
      if (!row) return reply(404, { error: 'SQLite 尚未建立旅程資料。' })
      try {
        const workspace = JSON.parse(row.data_json)
        if (!isTripWorkspaceDto(workspace)) return reply(500, { error: 'SQLite 旅程資料格式不正確。' })
        return reply(200, workspace)
      } catch (error) {
        return reply(500, { error: error instanceof Error ? `讀取 SQLite 旅程資料失敗：${error.message}` : '讀取 SQLite 旅程資料失敗。' })
      }
    }
    if (req.method !== 'PUT') return reply(405, { error: '只支援 GET 與 PUT。' })

    let body = ''
    try {
      for await (const chunk of req) {
        body += chunk
        if (body.length > 10 * 1024 * 1024) return reply(413, { error: '旅程資料超過 10 MB。' })
      }
    } catch (error) {
      return reply(400, { error: error instanceof Error ? `讀取請求失敗：${error.message}` : '讀取請求失敗。' })
    }
    let workspace
    try {
      workspace = JSON.parse(body)
    } catch {
      return reply(400, { error: '請求內容不是有效 JSON。' })
    }
    if (!isTripWorkspaceDto(workspace)) return reply(400, { error: '旅程資料格式不正確，未寫入 SQLite。' })
    try {
      writeWorkspace.run(JSON.stringify(workspace))
      return reply(200, { saved: true })
    } catch (error) {
      return reply(500, { error: error instanceof Error ? `寫入 SQLite 失敗：${error.message}` : '寫入 SQLite 失敗。' })
    }
  }
}

function validCoordinate(value) {
  if (typeof value !== 'string' || !coordinatePattern.test(value)) return false
  const [longitude, latitude] = value.split(',').map(Number)
  return longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90
}

export async function walkApi(req, res, next) {
  if (req.url?.split('?')[0] !== '/api/walk') return next()
  const reply = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(data))
  }
  if (req.method !== 'POST') return reply(405, { error: '只支援 POST。' })
  const key = process.env.AMAP_WEB_KEY
  if (!key) return reply(503, { error: '尚未設定高德 Web 服務 Key。請在啟動網站前設定 AMAP_WEB_KEY。' })
  let body = ''
  try {
    for await (const chunk of req) {
      body += chunk
      if (body.length > 2048) return reply(413, { error: '請求內容過長。' })
    }
    let data
    try {
      data = JSON.parse(body)
    } catch {
      return reply(400, { error: '請求內容不是有效 JSON。' })
    }
    if (!validCoordinate(data?.origin) || !validCoordinate(data?.destination)) return reply(400, { error: '請輸入有效的 GCJ-02 經度,緯度。' })
    const url = new URL('https://restapi.amap.com/v5/direction/walking')
    url.search = new URLSearchParams({
      key, origin: data.origin, destination: data.destination,
      show_fields: 'cost',
    }).toString()
    const result = await fetch(url, { signal: AbortSignal.timeout(12000) })
    if (!result.ok) return reply(502, { error: `高德服務回應 HTTP ${result.status}。` })
    const payload = await result.json()
    if (payload?.status !== '1') return reply(502, { error: `高德路線查詢失敗：${String(payload?.info ?? '未知錯誤')}` })
    const path = payload.route?.paths?.[0]
    const meters = Number(path?.distance)
    const seconds = Number(path?.cost?.duration)
    if (!Number.isFinite(meters) || !Number.isFinite(seconds) || meters < 0 || seconds < 0 || !path?.cost?.duration) {
      return reply(502, { error: '高德未回傳完整步行距離與時間，無法確認是否符合限制。' })
    }
    return reply(200, { meters, minutes: Math.ceil(seconds / 60) })
  } catch (error) {
    return reply(502, { error: error instanceof Error ? `路線查詢失敗：${error.message}` : '路線查詢失敗。' })
  }
}
