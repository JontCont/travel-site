import { mkdirSync } from 'node:fs'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isTripWorkspaceDto } from './src/dto/trip-workspace.dto.ts'

const coordinatePattern = /^-?\d{1,3}(?:\.\d{1,6})?,-?\d{1,2}(?:\.\d{1,6})?$/
const defaultDatabasePath = fileURLToPath(new URL('./data/trips.sqlite', import.meta.url))
const sessionCookie = 'trip_session'
const sessionDurationMonths = 6
const minimumAccessCodeLength = 16

export function openTripDatabase(databasePath = process.env.TRIP_DATABASE_PATH ?? defaultDatabasePath) {
  const resolvedPath = resolve(databasePath)
  mkdirSync(dirname(resolvedPath), { recursive: true })
  const database = new DatabaseSync(resolvedPath)
  database.exec('CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK (id = 1), data_json TEXT NOT NULL)')
  return database
}

function getCookie(req, name) {
  const cookieHeader = req.headers?.cookie
  if (typeof cookieHeader !== 'string') return ''
  const cookie = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))
  return cookie ? cookie.slice(name.length + 1) : ''
}

function hashAccessCode(code) {
  return createHash('sha256').update(code, 'utf8').digest()
}

function hashSessionToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function addCalendarMonths(timestamp, months) {
  const date = new Date(timestamp)
  const originalDay = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() + months)
  const lastDayOfMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(originalDay, lastDayOfMonth))
  return date.getTime()
}

/**
 * @param {{ viewCode?: string, adminCode?: string, secureCookie?: boolean }} [options]
 */
export function createTripApi(database, options = {}) {
  database.exec('CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK (id = 1), data_json TEXT NOT NULL)')
  database.exec(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
      credential_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `)
  const readWorkspace = database.prepare('SELECT data_json FROM workspace WHERE id = 1')
  const writeWorkspace = database.prepare(`
    INSERT INTO workspace (id, data_json) VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json
  `)
  const readSession = database.prepare('SELECT role, credential_hash, expires_at FROM auth_sessions WHERE token_hash = ?')
  const writeSession = database.prepare(`
    INSERT INTO auth_sessions (token_hash, role, credential_hash, expires_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(token_hash) DO UPDATE SET
      role = excluded.role,
      credential_hash = excluded.credential_hash,
      expires_at = excluded.expires_at
  `)
  const deleteSession = database.prepare('DELETE FROM auth_sessions WHERE token_hash = ?')
  const deleteExpiredSessions = database.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?')
  const viewCode = options.viewCode ?? process.env.TRIP_VIEW_CODE ?? ''
  const adminCode = options.adminCode ?? process.env.TRIP_ADMIN_CODE ?? ''
  const configured = viewCode.length >= minimumAccessCodeLength &&
    adminCode.length >= minimumAccessCodeLength &&
    viewCode !== adminCode
  const viewCodeHash = configured ? hashAccessCode(viewCode) : null
  const adminCodeHash = configured ? hashAccessCode(adminCode) : null
  const secureCookie = options.secureCookie ?? (
    process.env.TRIP_COOKIE_SECURE === '1' || process.env.NODE_ENV === 'production'
  )
  const loginAttempts = new Map()

  function roleFor(req) {
    const token = getCookie(req, sessionCookie)
    if (!token) return null
    const tokenHash = hashSessionToken(token)
    const session = readSession.get(tokenHash)
    if (!session) return null
    if (session.expires_at <= Date.now()) {
      deleteSession.run(tokenHash)
      return null
    }
    const currentCredentialHash = session.role === 'admin' ? adminCodeHash : viewCodeHash
    const sessionCredentialHash = Buffer.from(session.credential_hash, 'hex')
    if (
      !configured ||
      !currentCredentialHash ||
      sessionCredentialHash.length !== currentCredentialHash.length ||
      !timingSafeEqual(sessionCredentialHash, currentCredentialHash)
    ) {
      deleteSession.run(tokenHash)
      return null
    }
    return session.role
  }

  function clientAddress(req) {
    if (process.env.TRIP_TRUST_PROXY === '1') {
      const forwarded = req.headers?.['x-forwarded-for']
      if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim()
    }
    return req.socket?.remoteAddress ?? 'unknown'
  }

  function cookieValue(token, maxAge) {
    return `${sessionCookie}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureCookie ? '; Secure' : ''}`
  }

  async function readJsonBody(req, limit) {
    let body = ''
    for await (const chunk of req) {
      body += chunk
      if (Buffer.byteLength(body, 'utf8') > limit) throw new Error('請求內容過長。')
    }
    try {
      return JSON.parse(body)
    } catch {
      throw new Error('請求內容不是有效 JSON。')
    }
  }

  return async function tripApi(req, res, next) {
    const path = req.url?.split('?')[0]
    if (!path?.startsWith('/api/')) return next()
    const reply = (status, data, headers = {}) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...headers,
      })
      res.end(JSON.stringify(data))
    }

    if (path === '/api/auth/status') {
      if (req.method !== 'GET') return reply(405, { error: '只支援 GET。' })
      const role = roleFor(req)
      return reply(200, { configured, authenticated: Boolean(role), role })
    }

    if (path === '/api/map-config') {
      if (req.method !== 'GET') return reply(405, { error: '只支援 GET。' })
      if (!roleFor(req)) return reply(401, { error: '請先登入才能存取地圖設定。' })
      return reply(200, { apiKey: process.env.AMAP_API_KEY ?? '' })
    }

    if (path === '/api/auth/login') {
      if (req.method !== 'POST') return reply(405, { error: '只支援 POST。' })
      if (!configured || !viewCodeHash || !adminCodeHash) {
        return reply(503, { error: 'NAS 尚未設定有效的訪客與管理員通行碼。' })
      }

      const address = clientAddress(req)
      const now = Date.now()
      const attempt = loginAttempts.get(address)
      if (attempt?.blockedUntil && attempt.blockedUntil > now) {
        return reply(429, { error: '嘗試次數過多，請稍後再試。' })
      }

      let body
      try {
        body = await readJsonBody(req, 2048)
      } catch (error) {
        return reply(400, { error: error instanceof Error ? error.message : '讀取登入請求失敗。' })
      }
      const candidate = typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string'
        ? body.code
        : ''
      const candidateHash = hashAccessCode(candidate)
      const role = timingSafeEqual(candidateHash, adminCodeHash)
        ? 'admin'
        : timingSafeEqual(candidateHash, viewCodeHash)
          ? 'viewer'
          : null

      if (!role) {
        const failedCount = (attempt?.blockedUntil && attempt.blockedUntil <= now ? 0 : attempt?.failedCount ?? 0) + 1
        loginAttempts.set(address, {
          failedCount,
          ...(failedCount >= 5 ? { blockedUntil: now + 15 * 60 * 1000 } : {}),
        })
        return reply(401, { error: '通行碼不正確。' })
      }

      loginAttempts.delete(address)
      deleteExpiredSessions.run(now)
      const token = randomBytes(32).toString('base64url')
      const issuedAt = Date.now()
      const expiresAt = addCalendarMonths(issuedAt, sessionDurationMonths)
      const credentialHash = (role === 'admin' ? adminCodeHash : viewCodeHash).toString('hex')
      writeSession.run(hashSessionToken(token), role, credentialHash, expiresAt)
      return reply(200, { authenticated: true, role }, {
        'Set-Cookie': cookieValue(token, Math.floor((expiresAt - issuedAt) / 1000)),
      })
    }

    if (path === '/api/auth/logout') {
      if (req.method !== 'POST') return reply(405, { error: '只支援 POST。' })
      const token = getCookie(req, sessionCookie)
      if (token) deleteSession.run(hashSessionToken(token))
      return reply(200, { authenticated: false }, { 'Set-Cookie': cookieValue('', 0) })
    }

    const role = roleFor(req)
    if (!role) return reply(401, { error: '請先登入才能存取旅程資料。' })
    if (!configured) return reply(503, { error: 'NAS 尚未設定有效的訪客與管理員通行碼。' })
    if (path === '/api/notepad') {
      if (req.method !== 'PUT') return reply(405, { error: '只支援 PUT。' })

      let body
      try {
        body = await readJsonBody(req, 100 * 1024)
      } catch (error) {
        return reply(400, { error: error instanceof Error ? error.message : '讀取記事本請求失敗。' })
      }
      if (typeof body !== 'object' || body === null || Array.isArray(body) ||
        Object.keys(body).length !== 2 || typeof body.tripId !== 'string' || !body.tripId ||
        typeof body.notepad !== 'string') {
        return reply(400, { error: '記事本請求格式不正確；只接受旅程 ID 與記事內容。' })
      }

      let inTransaction = false
      try {
        database.exec('BEGIN IMMEDIATE')
        inTransaction = true
        const row = readWorkspace.get()
        if (!row) {
          database.exec('ROLLBACK')
          inTransaction = false
          return reply(404, { error: 'SQLite 尚未建立旅程資料。' })
        }
        let workspace
        try {
          workspace = JSON.parse(row.data_json)
        } catch {
          database.exec('ROLLBACK')
          inTransaction = false
          return reply(500, { error: 'SQLite 旅程資料不是有效 JSON；記事本未修改。' })
        }
        if (!isTripWorkspaceDto(workspace)) {
          database.exec('ROLLBACK')
          inTransaction = false
          return reply(500, { error: 'SQLite 旅程資料格式不正確；記事本未修改。' })
        }
        const trip = workspace.trips.find((item) => item.id === body.tripId)
        if (!trip) {
          database.exec('ROLLBACK')
          inTransaction = false
          return reply(404, { error: '找不到指定旅程；記事本未修改。' })
        }
        trip.notepad = body.notepad
        writeWorkspace.run(JSON.stringify(workspace))
        database.exec('COMMIT')
        inTransaction = false
        return reply(200, { saved: true })
      } catch (error) {
        if (inTransaction) database.exec('ROLLBACK')
        return reply(500, { error: error instanceof Error ? `寫入記事本失敗：${error.message}` : '寫入記事本失敗。' })
      }
    }
    if (path !== '/api/workspace') return next()

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
    if (role !== 'admin') return reply(403, { error: '訪客通行碼只有查看權限。' })

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
