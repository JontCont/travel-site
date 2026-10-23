import { mkdirSync } from 'node:fs'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isTripWorkspaceDto } from './src/dto/trip-workspace.dto.ts'
import {
  OidcError,
  createAuthorizationRequest,
  discoverOidc,
  exchangeAuthorizationCode,
  oidcRoleFor,
  readOidcConfig,
  resolveOidcIdentity,
} from './oidc.mjs'
import { decryptSecret, encryptSecret, readSecretKey } from './ai-crypto.mjs'
import { parseAssistRequest, runAiAssist } from './ai-assistant.mjs'
import {
  AiInputError,
  AiOutputError,
  AiProviderError,
  aiProviderOptions,
  callAiProvider,
  parseAiSettingsInput,
} from './ai-providers.mjs'

const coordinatePattern = /^-?\d{1,3}(?:\.\d{1,6})?,-?\d{1,2}(?:\.\d{1,6})?$/
const defaultDatabasePath = fileURLToPath(new URL('./data/trips.sqlite', import.meta.url))
const sessionCookie = 'trip_session'
const sessionDurationMonths = 6
const oidcTransactionMinutes = 10
const accessCodeTripLimit = 100
const accessCodeLabelLimit = 60
const accessCodeExpiryDays = [7, 30, 90]
const accessCodeExpiryError = `到期時間只能是 ${accessCodeExpiryDays.join('、')} 天或永久。`
const dayMilliseconds = 24 * 60 * 60 * 1000
const loginCompleteHtml = '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="refresh" content="0;url=/"><title>登入完成</title></head><body><p>登入完成，正在返回旅程網站。</p></body></html>'

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

function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function migrateAuthSessions(database) {
  const columns = database.prepare('PRAGMA table_info(auth_sessions)').all()
  if (columns.some((column) => column.name === 'credential_hash')) database.exec('DROP TABLE auth_sessions')
  database.exec(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('admin', 'viewer', 'code')),
      subject TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `)
}

function migrateAccessCodes(database) {
  const columns = database.prepare('PRAGMA table_info(access_codes)').all()
  if (!columns.some((column) => column.name === 'expires_at')) database.exec('ALTER TABLE access_codes ADD COLUMN expires_at INTEGER')
}

function accessCodeSummary(row) {
  return {
    id: row.id,
    label: row.label,
    tripIds: JSON.parse(row.trip_ids_json),
    createdAt: row.created_at,
    expiresAt: row.expires_at === null ? null : new Date(row.expires_at).toISOString(),
  }
}

function isAccessCodeExpired(row, now = Date.now()) {
  return row.expires_at !== null && row.expires_at <= now
}

function isAccessCodeExpiry(value) {
  return value === null || accessCodeExpiryDays.includes(value)
}

function accessCodeExpiresAt(expiresInDays) {
  return expiresInDays === null ? null : Date.now() + expiresInDays * dayMilliseconds
}

function parseTripIds(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > accessCodeTripLimit ||
    !value.every((tripId) => typeof tripId === 'string' && tripId)) {
    return null
  }
  return [...new Set(value)]
}

function oidcErrorCode(error) {
  return error instanceof OidcError ? error.code : 'oidc_unavailable'
}

function redirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' })
  res.end()
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
 * @param {{ oidc?: ReturnType<typeof readOidcConfig>, secureCookie?: boolean, aiFetch?: typeof fetch }} [options]
 */
export function createTripApi(database, options = {}) {
  database.exec('CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK (id = 1), data_json TEXT NOT NULL)')
  migrateAuthSessions(database)
  database.exec(`
    CREATE TABLE IF NOT EXISTS access_codes (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      code_hash TEXT NOT NULL UNIQUE,
      trip_ids_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS oidc_transactions (
      state_hash TEXT PRIMARY KEY,
      nonce TEXT NOT NULL,
      code_verifier TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      provider TEXT NOT NULL,
      base_url TEXT,
      model TEXT NOT NULL,
      api_key_encrypted TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_secret (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      secret TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `)
  migrateAccessCodes(database)
  const readWorkspace = database.prepare('SELECT data_json FROM workspace WHERE id = 1')
  const writeWorkspace = database.prepare(`
    INSERT INTO workspace (id, data_json) VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json
  `)
  const readSession = database.prepare('SELECT role, subject, expires_at FROM auth_sessions WHERE token_hash = ?')
  const writeSession = database.prepare('INSERT INTO auth_sessions (token_hash, role, subject, expires_at) VALUES (?, ?, ?, ?)')
  const deleteSession = database.prepare('DELETE FROM auth_sessions WHERE token_hash = ?')
  const deleteSessionsBySubject = database.prepare("DELETE FROM auth_sessions WHERE role = 'code' AND subject = ?")
  const deleteExpiredSessions = database.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?')
  const readAccessCodeByHash = database.prepare('SELECT id, label, trip_ids_json, created_at, expires_at FROM access_codes WHERE code_hash = ?')
  const readAccessCodeById = database.prepare('SELECT id, label, trip_ids_json, created_at, expires_at FROM access_codes WHERE id = ?')
  const listAccessCodes = database.prepare('SELECT id, label, trip_ids_json, created_at, expires_at FROM access_codes ORDER BY created_at, id')
  const insertAccessCode = database.prepare('INSERT INTO access_codes (id, label, code_hash, trip_ids_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
  const updateAccessCode = database.prepare('UPDATE access_codes SET trip_ids_json = ?, expires_at = ? WHERE id = ?')
  const deleteAccessCode = database.prepare('DELETE FROM access_codes WHERE id = ?')
  const writeOidcTransaction = database.prepare('INSERT INTO oidc_transactions (state_hash, nonce, code_verifier, expires_at) VALUES (?, ?, ?, ?)')
  const readOidcTransaction = database.prepare('SELECT nonce, code_verifier FROM oidc_transactions WHERE state_hash = ?')
  const deleteOidcTransaction = database.prepare('DELETE FROM oidc_transactions WHERE state_hash = ?')
  const deleteExpiredOidcTransactions = database.prepare('DELETE FROM oidc_transactions WHERE expires_at <= ?')
  const readAiSettings = database.prepare('SELECT provider, base_url, model, api_key_encrypted, updated_at FROM ai_settings WHERE id = 1')
  const readAiSecret = database.prepare('SELECT secret FROM ai_secret WHERE id = 1')
  const insertAiSecret = database.prepare('INSERT OR IGNORE INTO ai_secret (id, secret, created_at) VALUES (1, ?, ?)')
  const writeAiSettings = database.prepare(`
    INSERT INTO ai_settings (id, provider, base_url, model, api_key_encrypted, updated_at) VALUES (1, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      provider = excluded.provider,
      base_url = excluded.base_url,
      model = excluded.model,
      api_key_encrypted = excluded.api_key_encrypted,
      updated_at = excluded.updated_at
  `)
  const oidcConfig = options.oidc ?? readOidcConfig(process.env)
  const configured = oidcConfig.configured
  const secureCookie = options.secureCookie ?? (
    process.env.TRIP_COOKIE_SECURE === '1' || process.env.NODE_ENV === 'production'
  )
  const loginAttempts = new Map()
  const aiFetch = options.aiFetch ?? fetch

  /** 加密金鑰只存在 SQLite，首次需要加密時自動產生。 */
  function readAiSecretKey() {
    return readSecretKey(readAiSecret.get()?.secret)
  }

  function ensureAiSecretKey() {
    const existing = readAiSecretKey()
    if (existing) return existing
    insertAiSecret.run(randomBytes(32).toString('base64url'), new Date().toISOString())
    const secret = readAiSecretKey()
    if (!secret) throw new Error('無法建立 AI 加密金鑰。')
    return secret
  }

  function resolveSession(req) {
    const token = getCookie(req, sessionCookie)
    if (!token) return null
    const tokenHash = sha256Hex(token)
    const session = readSession.get(tokenHash)
    if (!session) return null
    if (session.expires_at <= Date.now()) {
      deleteSession.run(tokenHash)
      return null
    }
    if (session.role !== 'code') return { role: session.role, tripIds: null }
    const codeRow = readAccessCodeById.get(session.subject)
    if (!codeRow) {
      deleteSession.run(tokenHash)
      return null
    }
    if (isAccessCodeExpired(codeRow)) {
      deleteSessionsBySubject.run(codeRow.id)
      return null
    }
    return { role: 'code', tripIds: JSON.parse(codeRow.trip_ids_json) }
  }

  function createSession(role, subject) {
    const issuedAt = Date.now()
    const expiresAt = addCalendarMonths(issuedAt, sessionDurationMonths)
    deleteExpiredSessions.run(issuedAt)
    const token = randomBytes(32).toString('base64url')
    writeSession.run(sha256Hex(token), role, subject, expiresAt)
    return cookieValue(token, Math.floor((expiresAt - issuedAt) / 1000))
  }

  function clientAddress(req) {
    if (process.env.TRIP_TRUST_PROXY === '1') {
      // Cloudflare overwrites CF-Connecting-IP; the leftmost X-Forwarded-For entry can be client-supplied.
      const cloudflareAddress = req.headers?.['cf-connecting-ip']
      if (typeof cloudflareAddress === 'string' && cloudflareAddress.trim()) return cloudflareAddress.trim()
      const forwarded = req.headers?.['x-forwarded-for']
      if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',').at(-1).trim()
    }
    return req.socket?.remoteAddress ?? 'unknown'
  }

  function cookieValue(token, maxAge) {
    return `${sessionCookie}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureCookie ? '; Secure' : ''}`
  }

  function readKnownTripIds() {
    const row = readWorkspace.get()
    if (!row) return { error: { status: 404, message: 'SQLite 尚未建立旅程資料。' } }
    let workspace
    try {
      workspace = JSON.parse(row.data_json)
    } catch {
      return { error: { status: 500, message: 'SQLite 旅程資料不是有效 JSON。' } }
    }
    if (!isTripWorkspaceDto(workspace)) return { error: { status: 500, message: 'SQLite 旅程資料格式不正確。' } }
    return { tripIds: new Set(workspace.trips.map((trip) => trip.id)) }
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

  function aiSettingsSummary() {
    const row = readAiSettings.get()
    return {
      settings: row ? {
        provider: row.provider,
        baseUrl: row.base_url,
        model: row.model,
        hasApiKey: Boolean(row.api_key_encrypted),
        updatedAt: row.updated_at,
      } : null,
      ready: Boolean(row?.api_key_encrypted) && readAiSecretKey() !== null,
      providers: aiProviderOptions(),
    }
  }

  function loadAiRuntime() {
    const row = readAiSettings.get()
    const secret = readAiSecretKey()
    if (!row?.api_key_encrypted || !secret) return { error: { status: 503, message: '尚未完成 AI 設定，請先儲存服務商、模型與 API Key。' } }
    try {
      return {
        settings: { provider: row.provider, baseUrl: row.base_url, model: row.model },
        apiKey: decryptSecret(row.api_key_encrypted, secret),
      }
    } catch {
      return { error: { status: 500, message: '無法解密已儲存的 API Key，請重新輸入 API Key。' } }
    }
  }

  function readWorkspaceTrip(tripId) {
    const row = readWorkspace.get()
    if (!row) return { error: { status: 404, message: 'SQLite 尚未建立旅程資料。' } }
    let workspace
    try {
      workspace = JSON.parse(row.data_json)
    } catch {
      return { error: { status: 500, message: 'SQLite 旅程資料不是有效 JSON。' } }
    }
    if (!isTripWorkspaceDto(workspace)) return { error: { status: 500, message: 'SQLite 旅程資料格式不正確。' } }
    const trip = workspace.trips.find((item) => item.id === tripId)
    if (!trip) return { error: { status: 404, message: '找不到指定旅程。' } }
    return { trip }
  }

  function readAssistTrip(session, tripId) {
    if (Array.isArray(session.tripIds) && !session.tripIds.includes(tripId)) {
      return { error: { status: 404, message: '找不到指定旅程。' } }
    }
    const found = readWorkspaceTrip(tripId)
    if (found.error || session.role === 'admin') return found
    if (found.trip.aiAskEnabled !== true) return { error: { status: 403, message: '管理員尚未開放此旅程的 AI 助理。' } }
    return found
  }

  function replyAiError(reply, error) {
    if (error instanceof AiInputError) return reply(400, { error: error.message })
    if (error instanceof AiOutputError || error instanceof AiProviderError) return reply(502, { error: error.message })
    return reply(500, { error: 'AI 處理失敗，請稍後再試。' })
  }

  async function saveAiSettings(req, reply) {
    let input
    try {
      input = parseAiSettingsInput(await readJsonBody(req, 4 * 1024))
    } catch (error) {
      return reply(400, { error: error instanceof Error ? error.message : 'AI 設定格式不正確。' })
    }
    if (input.clearApiKey && input.apiKey) return reply(400, { error: '不能同時清除並更新 API Key。' })
    const existing = readAiSettings.get()
    let apiKeyEncrypted
    if (input.clearApiKey) apiKeyEncrypted = null
    else if (input.apiKey) apiKeyEncrypted = encryptSecret(input.apiKey, ensureAiSecretKey())
    else if (existing?.api_key_encrypted && existing.provider === input.provider) apiKeyEncrypted = existing.api_key_encrypted
    else return reply(400, { error: '請輸入此服務商的 API Key；切換服務商時必須重新輸入。' })
    writeAiSettings.run(input.provider, input.baseUrl, input.model, apiKeyEncrypted, new Date().toISOString())
    return reply(200, aiSettingsSummary())
  }

  async function handleAiRoute(path, req, reply, session) {
    if (path === '/api/ai/availability') {
      if (req.method !== 'GET') return reply(405, { error: '只支援 GET。' })
      return reply(200, { ready: aiSettingsSummary().ready })
    }

    if (path === '/api/ai/settings') {
      if (session.role !== 'admin') return reply(403, { error: '只有管理員可以設定 AI。' })
      if (req.method === 'GET') return reply(200, aiSettingsSummary())
      if (req.method === 'PUT') return saveAiSettings(req, reply)
      return reply(405, { error: '只支援 GET 與 PUT。' })
    }

    if (path === '/api/ai/test') {
      if (session.role !== 'admin') return reply(403, { error: '只有管理員可以設定 AI。' })
      if (req.method !== 'POST') return reply(405, { error: '只支援 POST。' })
      const runtime = loadAiRuntime()
      if (runtime.error) return reply(runtime.error.status, { error: runtime.error.message })
      try {
        await callAiProvider({
          ...runtime.settings,
          apiKey: runtime.apiKey,
          system: '你是連線測試程式，請只回覆 JSON 物件 {"ok": true}。',
          user: 'ping',
          fetchImpl: aiFetch,
        })
        return reply(200, { ok: true })
      } catch (error) {
        return replyAiError(reply, error)
      }
    }

    if (path === '/api/ai/assist') {
      if (req.method !== 'POST') return reply(405, { error: '只支援 POST。' })
      let request
      try {
        request = parseAssistRequest(await readJsonBody(req, 16 * 1024))
      } catch (error) {
        return reply(400, { error: error instanceof Error ? error.message : 'AI 請求格式不正確。' })
      }
      if (session.role !== 'admin' && request.mode !== 'ask') return reply(403, { error: '此 AI 功能只限管理員使用。' })
      const runtime = loadAiRuntime()
      if (runtime.error) return reply(runtime.error.status, { error: runtime.error.message })
      let trip
      if (request.mode !== 'generate_itinerary') {
        const found = readAssistTrip(session, request.tripId)
        if (found.error) return reply(found.error.status, { error: found.error.message })
        trip = found.trip
      }
      try {
        const result = await runAiAssist({
          settings: runtime.settings,
          apiKey: runtime.apiKey,
          request,
          trip,
          fetchImpl: aiFetch,
        })
        return reply(200, result)
      } catch (error) {
        return replyAiError(reply, error)
      }
    }

    return reply(404, { error: '找不到指定的 AI API。' })
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
      const session = resolveSession(req)
      return reply(200, { configured, authenticated: Boolean(session), role: session?.role ?? null })
    }

    if (path === '/api/map-config') {
      if (req.method !== 'GET') return reply(405, { error: '只支援 GET。' })
      if (!resolveSession(req)) return reply(401, { error: '請先登入才能存取地圖設定。' })
      return reply(200, { apiKey: process.env.AMAP_API_KEY ?? '' })
    }

    if (path === '/api/auth/login') {
      if (req.method !== 'POST') return reply(405, { error: '只支援 POST。' })
      if (!configured) return reply(503, { error: 'NAS 尚未設定 Synology 登入。' })

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
      const codeRow = candidate ? readAccessCodeByHash.get(sha256Hex(candidate)) : undefined

      if (!codeRow) {
        const failedCount = (attempt?.blockedUntil && attempt.blockedUntil <= now ? 0 : attempt?.failedCount ?? 0) + 1
        loginAttempts.set(address, {
          failedCount,
          ...(failedCount >= 5 ? { blockedUntil: now + 15 * 60 * 1000 } : {}),
        })
        return reply(401, { error: '通行碼不正確。' })
      }

      if (isAccessCodeExpired(codeRow)) {
        deleteSessionsBySubject.run(codeRow.id)
        return reply(403, { error: '通行碼已到期，請向管理員索取新的通行碼。' })
      }

      loginAttempts.delete(address)
      return reply(200, { authenticated: true, role: 'code' }, { 'Set-Cookie': createSession('code', codeRow.id) })
    }

    if (path === '/api/auth/logout') {
      if (req.method !== 'POST') return reply(405, { error: '只支援 POST。' })
      const token = getCookie(req, sessionCookie)
      if (token) deleteSession.run(sha256Hex(token))
      return reply(200, { authenticated: false }, { 'Set-Cookie': cookieValue('', 0) })
    }

    if (path === '/api/auth/oidc/start') {
      if (req.method !== 'GET') return reply(405, { error: '只支援 GET。' })
      if (!configured) return redirect(res, '/?auth_error=oidc_unavailable')
      try {
        const discovery = await discoverOidc(oidcConfig)
        const authorization = createAuthorizationRequest(oidcConfig, discovery)
        const now = Date.now()
        deleteExpiredOidcTransactions.run(now)
        writeOidcTransaction.run(
          sha256Hex(authorization.state),
          authorization.nonce,
          authorization.codeVerifier,
          now + oidcTransactionMinutes * 60 * 1000,
        )
        return redirect(res, authorization.url)
      } catch (error) {
        return redirect(res, `/?auth_error=${oidcErrorCode(error)}`)
      }
    }

    if (path === '/api/auth/oidc/callback') {
      if (req.method !== 'GET') return reply(405, { error: '只支援 GET。' })
      const params = new URL(req.url, 'http://localhost').searchParams
      if (params.has('error')) return redirect(res, '/?auth_error=oidc_denied')
      const state = params.get('state') ?? ''
      const code = params.get('code') ?? ''
      deleteExpiredOidcTransactions.run(Date.now())
      const stateHash = state ? sha256Hex(state) : ''
      const transaction = stateHash ? readOidcTransaction.get(stateHash) : undefined
      if (stateHash) deleteOidcTransaction.run(stateHash)
      if (!transaction) return redirect(res, '/?auth_error=oidc_state')
      if (!code) return redirect(res, '/?auth_error=oidc_token')
      if (!configured) return redirect(res, '/?auth_error=oidc_unavailable')
      try {
        const discovery = await discoverOidc(oidcConfig)
        const tokens = await exchangeAuthorizationCode(oidcConfig, discovery, {
          code,
          codeVerifier: transaction.code_verifier,
        })
        const identity = await resolveOidcIdentity(oidcConfig, discovery, tokens, transaction.nonce)
        const cookie = createSession(oidcRoleFor(identity, oidcConfig), identity.subject)
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
          'X-Content-Type-Options': 'nosniff',
          'Set-Cookie': cookie,
        })
        return res.end(loginCompleteHtml)
      } catch (error) {
        return redirect(res, `/?auth_error=${oidcErrorCode(error)}`)
      }
    }

    const session = resolveSession(req)
    if (!session) return reply(401, { error: '請先登入才能存取旅程資料。' })
    if (!configured) return reply(503, { error: 'NAS 尚未設定 Synology 登入。' })
    if (path.startsWith('/api/ai/')) return handleAiRoute(path, req, reply, session)
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
        const trip = workspace.trips.find((item) => item.id === body.tripId && (session.tripIds === null || session.tripIds.includes(item.id)))
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
    if (path === '/api/access-codes') {
      if (session.role !== 'admin') return reply(403, { error: '只有管理員可以管理通行碼。' })
      if (req.method === 'GET') return reply(200, { codes: listAccessCodes.all().map(accessCodeSummary) })
      if (req.method !== 'POST') return reply(405, { error: '只支援 GET 與 POST。' })

      let body
      try {
        body = await readJsonBody(req, 16 * 1024)
      } catch (error) {
        return reply(400, { error: error instanceof Error ? error.message : '讀取通行碼請求失敗。' })
      }
      const label = typeof body?.label === 'string' ? body.label.trim() : ''
      if (!label || label.length > accessCodeLabelLimit) {
        return reply(400, { error: `通行碼名稱需為 1 到 ${accessCodeLabelLimit} 個字。` })
      }
      const tripIds = parseTripIds(body?.tripIds)
      if (!tripIds) return reply(400, { error: `請指定 1 到 ${accessCodeTripLimit} 個旅程。` })
      const expiresInDays = body?.expiresInDays ?? null
      if (!isAccessCodeExpiry(expiresInDays)) return reply(400, { error: accessCodeExpiryError })

      const known = readKnownTripIds()
      if (known.error) return reply(known.error.status, { error: known.error.message })
      if (!tripIds.every((tripId) => known.tripIds.has(tripId))) return reply(400, { error: '指定的旅程不存在。' })

      const code = randomBytes(18).toString('base64url')
      const access = {
        id: randomUUID(),
        label,
        trip_ids_json: JSON.stringify(tripIds),
        created_at: new Date().toISOString(),
        expires_at: accessCodeExpiresAt(expiresInDays),
      }
      insertAccessCode.run(access.id, access.label, sha256Hex(code), access.trip_ids_json, access.created_at, access.expires_at)
      return reply(201, { code, access: accessCodeSummary(access) })
    }

    const accessCodeId = path.match(/^\/api\/access-codes\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/)?.[1]
    if (accessCodeId) {
      if (session.role !== 'admin') return reply(403, { error: '只有管理員可以管理通行碼。' })
      if (req.method === 'DELETE') {
        if (deleteAccessCode.run(accessCodeId).changes === 0) return reply(404, { error: '找不到指定通行碼。' })
        deleteSessionsBySubject.run(accessCodeId)
        return reply(200, { deleted: true })
      }
      if (req.method !== 'PATCH') return reply(405, { error: '只支援 PATCH 與 DELETE。' })

      let body
      try {
        body = await readJsonBody(req, 16 * 1024)
      } catch (error) {
        return reply(400, { error: error instanceof Error ? error.message : '讀取通行碼請求失敗。' })
      }
      const changes = typeof body === 'object' && body !== null && !Array.isArray(body) ? body : {}
      const hasTripIds = 'tripIds' in changes
      const hasExpiry = 'expiresInDays' in changes
      if (!hasTripIds && !hasExpiry) return reply(400, { error: '請指定要更新的旅程或到期時間。' })

      const existing = readAccessCodeById.get(accessCodeId)
      if (!existing) return reply(404, { error: '找不到指定通行碼。' })

      let tripIdsJson = existing.trip_ids_json
      if (hasTripIds) {
        const tripIds = parseTripIds(changes.tripIds)
        if (!tripIds) return reply(400, { error: `請指定 1 到 ${accessCodeTripLimit} 個旅程。` })
        const known = readKnownTripIds()
        if (known.error) return reply(known.error.status, { error: known.error.message })
        if (!tripIds.every((tripId) => known.tripIds.has(tripId))) return reply(400, { error: '指定的旅程不存在。' })
        tripIdsJson = JSON.stringify(tripIds)
      }
      if (hasExpiry && !isAccessCodeExpiry(changes.expiresInDays)) return reply(400, { error: accessCodeExpiryError })

      const expiresAt = hasExpiry ? accessCodeExpiresAt(changes.expiresInDays) : existing.expires_at
      updateAccessCode.run(tripIdsJson, expiresAt, accessCodeId)
      return reply(200, { access: accessCodeSummary(readAccessCodeById.get(accessCodeId)) })
    }

    if (path !== '/api/workspace') return next()

    if (req.method === 'GET') {
      const row = readWorkspace.get()
      if (!row) return reply(404, { error: 'SQLite 尚未建立旅程資料。' })
      try {
        const workspace = JSON.parse(row.data_json)
        if (!isTripWorkspaceDto(workspace)) return reply(500, { error: 'SQLite 旅程資料格式不正確。' })
        if (session.tripIds === null) return reply(200, workspace)
        const trips = workspace.trips.filter((trip) => session.tripIds.includes(trip.id))
        if (trips.length === 0) return reply(403, { error: '此通行碼尚未指派可查看的旅程。' })
        const activeTripId = trips.some((trip) => trip.id === workspace.activeTripId) ? workspace.activeTripId : trips[0].id
        return reply(200, { ...workspace, trips, activeTripId })
      } catch (error) {
        return reply(500, { error: error instanceof Error ? `讀取 SQLite 旅程資料失敗：${error.message}` : '讀取 SQLite 旅程資料失敗。' })
      }
    }
    if (req.method !== 'PUT') return reply(405, { error: '只支援 GET 與 PUT。' })
    if (session.role !== 'admin') return reply(403, { error: '目前帳號只有查看權限。' })

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
