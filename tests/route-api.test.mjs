import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { createTripApi, walkApi } from '../route-api.mjs'
import { defineTrip } from '../src/services/trip.service.ts'
import { createMockSynologyOidc, oidcTestConfig, requestApi, synologyLogin } from './helpers/mock-synology-oidc.mjs'

async function request(body) {
  const req = { url: '/api/walk', method: 'POST', async *[Symbol.asyncIterator]() { yield JSON.stringify(body) } }
  let status, output
  const res = {
    writeHead(code) { status = code },
    end(value) { output = JSON.parse(value) },
  }
  await walkApi(req, res, () => assert.fail('Unexpected next'))
  return { status, output }
}

async function requestWorkspace(api, method, body, headers) {
  const { status, output } = await requestApi(api, '/api/workspace', method, body, headers)
  return { status, output }
}

async function requestNotepad(api, method, body, headers) {
  const { status, output } = await requestApi(api, '/api/notepad', method, body, headers)
  return { status, output }
}

function useMockOidc(t) {
  const mock = createMockSynologyOidc()
  t.after(mock.install())
  return mock
}

function apiWith(database, oidc = oidcTestConfig) {
  return createTripApi(database, { oidc, secureCookie: false })
}

async function synologyCookie(api, provider, claims) {
  const result = await synologyLogin(api, provider, claims)
  assert.equal(result.callback.status, 200)
  return result.cookie
}

function adminCookie(api, provider) {
  return synologyCookie(api, provider, { sub: 'sub-admin', username: 'nas-admin', groups: ['administrators'] })
}

function viewerCookie(api, provider) {
  return synologyCookie(api, provider, { sub: 'sub-viewer', username: 'nas-viewer', groups: ['users'] })
}

function createAccessCode(api, cookie, body) {
  return requestApi(api, '/api/access-codes', 'POST', body, { cookie })
}

async function guestCookie(api, code) {
  const result = await requestApi(api, '/api/auth/login', 'POST', { code })
  assert.equal(result.status, 200)
  return result.headers['Set-Cookie'].split(';')[0]
}

function testTrip(id) {
  return defineTrip({
    id,
    title: `${id} 測試`,
    destination: '北京',
    startDate: '2026-05-15',
    endDate: '2026-05-15',
    timeZone: 'Asia/Shanghai',
    notepad: '測試備忘：集合地點待確認',
  })
}

function testWorkspace(tripIds = ['sqlite-trip']) {
  const trips = tripIds.map(testTrip)
  return { trips, activeTripId: trips[0].id }
}

test('rejects invalid coordinates before calling provider', async () => {
  const previous = process.env.AMAP_WEB_KEY
  process.env.AMAP_WEB_KEY = 'test-key'
  try {
    const result = await request({ origin: '999,999', destination: '119,26' })
    assert.equal(result.status, 400)
  } finally {
    if (previous === undefined) delete process.env.AMAP_WEB_KEY
    else process.env.AMAP_WEB_KEY = previous
  }
})

test('uses Amap routed duration and distance, not straight-line estimates', async () => {
  const previous = process.env.AMAP_WEB_KEY
  const originalFetch = globalThis.fetch
  process.env.AMAP_WEB_KEY = 'test-key'
  globalThis.fetch = async (url) => {
    assert.equal(url.pathname, '/v5/direction/walking')
    assert.equal(url.searchParams.get('show_fields'), 'cost')
    return { ok: true, json: async () => ({ status: '1', route: { paths: [{ distance: '460', cost: { duration: '481' } }] } }) }
  }
  try {
    assert.deepEqual(await request({ origin: '119.3,26.1', destination: '119.4,26.2' }), {
      status: 200, output: { meters: 460, minutes: 9 },
    })
  } finally {
    globalThis.fetch = originalFetch
    if (previous === undefined) delete process.env.AMAP_WEB_KEY
    else process.env.AMAP_WEB_KEY = previous
  }
})

test('reports missing duration as an error, not zero walking', async () => {
  const previous = process.env.AMAP_WEB_KEY
  const originalFetch = globalThis.fetch
  process.env.AMAP_WEB_KEY = 'test-key'
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ status: '1', route: { paths: [{ distance: '460' }] } }) })
  try {
    const result = await request({ origin: '119.3,26.1', destination: '119.4,26.2' })
    assert.equal(result.status, 502)
  } finally {
    globalThis.fetch = originalFetch
    if (previous === undefined) delete process.env.AMAP_WEB_KEY
    else process.env.AMAP_WEB_KEY = previous
  }
})

test('persists validated trip workspaces in SQLite', async (t) => {
  const provider = useMockOidc(t)
  const database = new DatabaseSync(':memory:')
  try {
    const api = apiWith(database)
    const workspace = testWorkspace()
    const cookie = await adminCookie(api, provider)

    assert.deepEqual(await requestWorkspace(api, 'GET'), {
      status: 401,
      output: { error: '請先登入才能存取旅程資料。' },
    })
    assert.deepEqual(await requestWorkspace(api, 'PUT', workspace, { cookie }), {
      status: 200,
      output: { saved: true },
    })
    assert.deepEqual(await requestWorkspace(api, 'GET', undefined, { cookie }), {
      status: 200,
      output: workspace,
    })
  } finally {
    database.close()
  }
})

test('rejects invalid workspaces without changing saved SQLite data', async (t) => {
  const provider = useMockOidc(t)
  const database = new DatabaseSync(':memory:')
  try {
    const api = apiWith(database)
    const workspace = testWorkspace()
    const cookie = await adminCookie(api, provider)
    await requestWorkspace(api, 'PUT', workspace, { cookie })

    assert.deepEqual(await requestWorkspace(api, 'PUT', { trips: [], activeTripId: 'missing' }, { cookie }), {
      status: 400,
      output: { error: '旅程資料格式不正確，未寫入 SQLite。' },
    })
    assert.deepEqual(await requestWorkspace(api, 'GET', undefined, { cookie }), { status: 200, output: workspace })
  } finally {
    database.close()
  }
})

test('fails closed when Synology login is not configured', async () => {
  const database = new DatabaseSync(':memory:')
  try {
    const api = apiWith(database, { ...oidcTestConfig, configured: false })
    assert.deepEqual(await requestApi(api, '/api/auth/status', 'GET'), {
      status: 200,
      output: { configured: false, authenticated: false, role: null },
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
    assert.equal((await requestApi(api, '/api/auth/login', 'POST', { code: 'any-access-code' })).status, 503)
    assert.equal((await requestWorkspace(api, 'GET')).status, 401)
  } finally {
    database.close()
  }
})

test('serves the AMap JavaScript API key only to authenticated sessions', async (t) => {
  const provider = useMockOidc(t)
  const database = new DatabaseSync(':memory:')
  const previous = process.env.AMAP_API_KEY
  process.env.AMAP_API_KEY = 'test-amap-js-key'
  try {
    const api = apiWith(database)
    assert.deepEqual(await requestApi(api, '/api/map-config', 'GET'), {
      status: 401,
      output: { error: '請先登入才能存取地圖設定。' },
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
    const cookie = await adminCookie(api, provider)
    assert.equal((await requestApi(api, '/api/map-config', 'GET', undefined, { cookie })).output.apiKey, 'test-amap-js-key')
  } finally {
    database.close()
    if (previous === undefined) delete process.env.AMAP_API_KEY
    else process.env.AMAP_API_KEY = previous
  }
})

test('uses the destination rather than an entire transfer description in AMap place searches', async () => {
  const { buildAmapPlaceSearchUrl } = await import('../src/services/map.service.ts')
  const url = new URL(buildAmapPlaceSearchUrl(
    '福州長樂機場 → 桔E酒店(福州三坊七巷东街口地铁站店)',
    '福州',
    '福州市鼓楼区八一七北路5号红霞新城37号',
  ))
  assert.equal(url.searchParams.get('keyword'), '桔E酒店(福州三坊七巷东街口地铁站店) 福州市鼓楼区八一七北路5号红霞新城37号')
  assert.equal(url.searchParams.get('city'), '福州')
})

test('rate-limits repeated invalid access-code attempts', async () => {
  const database = new DatabaseSync(':memory:')
  try {
    const api = apiWith(database)
    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal((await requestApi(api, '/api/auth/login', 'POST', { code: 'invalid-access-code' })).status, 401)
    }
    assert.deepEqual(await requestApi(api, '/api/auth/login', 'POST', { code: 'invalid-access-code' }), {
      status: 429,
      output: { error: '嘗試次數過多，請稍後再試。' },
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } finally {
    database.close()
  }
})

test('keys login rate limits by Cloudflare client IP when the proxy flag is set', async (t) => {
  t.after(() => {
    delete process.env.TRIP_TRUST_PROXY
  })
  process.env.TRIP_TRUST_PROXY = '1'
  const database = new DatabaseSync(':memory:')
  try {
    const api = apiWith(database)
    const attacker = { 'cf-connecting-ip': '203.0.113.7' }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await requestApi(api, '/api/auth/login', 'POST', { code: 'invalid-access-code' }, { ...attacker, 'x-forwarded-for': `198.51.100.${attempt}` })
    }
    assert.equal((await requestApi(api, '/api/auth/login', 'POST', { code: 'invalid-access-code' }, { ...attacker, 'x-forwarded-for': '198.51.100.99' })).status, 429)
    assert.equal((await requestApi(api, '/api/auth/login', 'POST', { code: 'invalid-access-code' }, { 'cf-connecting-ip': '203.0.113.8' })).status, 401)
  } finally {
    database.close()
  }
})

test('viewer access can read but cannot write trip data', async (t) => {
  const provider = useMockOidc(t)
  const database = new DatabaseSync(':memory:')
  try {
    const api = apiWith(database)
    const cookie = await adminCookie(api, provider)
    const viewer = await viewerCookie(api, provider)
    const workspace = testWorkspace()
    await requestWorkspace(api, 'PUT', workspace, { cookie })

    assert.equal((await requestApi(api, '/api/auth/status', 'GET', undefined, { cookie: viewer })).output.role, 'viewer')
    assert.deepEqual(await requestWorkspace(api, 'GET', undefined, { cookie: viewer }), {
      status: 200,
      output: workspace,
    })
    assert.deepEqual(await requestWorkspace(api, 'PUT', testWorkspace(), { cookie: viewer }), {
      status: 403,
      output: { error: '目前帳號只有查看權限。' },
    })
    assert.deepEqual(await requestWorkspace(api, 'GET', undefined, { cookie }), {
      status: 200,
      output: workspace,
    })
  } finally {
    database.close()
  }
})

test('viewers can update only the notepad through the dedicated endpoint', async (t) => {
  const provider = useMockOidc(t)
  const database = new DatabaseSync(':memory:')
  try {
    const api = apiWith(database)
    const workspace = testWorkspace()
    const cookie = await adminCookie(api, provider)
    await requestWorkspace(api, 'PUT', workspace, { cookie })
    const viewer = await viewerCookie(api, provider)

    assert.deepEqual(await requestNotepad(api, 'PUT', {
      tripId: 'sqlite-trip',
      notepad: '訪客補充：集合時間待確認',
    }, { cookie: viewer }), { status: 200, output: { saved: true } })

    const stored = await requestWorkspace(api, 'GET', undefined, { cookie: viewer })
    assert.equal(stored.output.trips[0].notepad, '訪客補充：集合時間待確認')
    assert.equal(stored.output.trips[0].title, workspace.trips[0].title)

    assert.deepEqual(await requestNotepad(api, 'PUT', {
      tripId: 'sqlite-trip',
      notepad: '不應保存',
      title: '未授權改名',
    }, { cookie: viewer }), {
      status: 400,
      output: { error: '記事本請求格式不正確；只接受旅程 ID 與記事內容。' },
    })
    assert.deepEqual(await requestNotepad(api, 'PUT', {
      tripId: 'missing-trip',
      notepad: '不應保存',
    }, { cookie: viewer }), {
      status: 404,
      output: { error: '找不到指定旅程；記事本未修改。' },
    })
    assert.equal((await requestWorkspace(api, 'GET', undefined, { cookie: viewer })).output.trips[0].notepad,
      '訪客補充：集合時間待確認')
  } finally {
    database.close()
  }
})

test('requires a session for every API endpoint and expires it on logout', async (t) => {
  const provider = useMockOidc(t)
  const database = new DatabaseSync(':memory:')
  try {
    const api = apiWith(database)
    assert.deepEqual(await requestApi(api, '/api/walk', 'POST', { origin: '119.3,26.1', destination: '119.4,26.2' }), {
      status: 401,
      output: { error: '請先登入才能存取旅程資料。' },
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })

    const cookie = await viewerCookie(api, provider)
    assert.equal((await requestApi(api, '/api/auth/logout', 'POST', undefined, { cookie })).status, 200)
    assert.equal((await requestWorkspace(api, 'GET', undefined, { cookie })).status, 401)
  } finally {
    database.close()
  }
})

test('persists six-month sessions across restarts', async (t) => {
  const provider = useMockOidc(t)
  const database = new DatabaseSync(':memory:')
  try {
    const firstApi = apiWith(database)
    const workspace = testWorkspace()
    const login = await synologyLogin(firstApi, provider, { sub: 'sub-admin', username: 'nas-admin', groups: ['administrators'] })
    assert.equal(login.callback.status, 200)
    const maxAge = Number(login.setCookie.match(/Max-Age=(\d+)/)?.[1])
    assert.ok(maxAge >= 181 * 24 * 60 * 60 && maxAge <= 184 * 24 * 60 * 60)
    await requestWorkspace(firstApi, 'PUT', workspace, { cookie: login.cookie })

    const restartedApi = apiWith(database)
    assert.deepEqual(await requestWorkspace(restartedApi, 'GET', undefined, { cookie: login.cookie }), {
      status: 200,
      output: workspace,
    })
  } finally {
    database.close()
  }
})

test('drops the legacy auth_sessions table and rejects its cookies', async () => {
  const database = new DatabaseSync(':memory:')
  try {
    database.exec('CREATE TABLE auth_sessions (credential_hash TEXT PRIMARY KEY, role TEXT NOT NULL, expires_at TEXT NOT NULL)')
    database.prepare('INSERT INTO auth_sessions (credential_hash, role, expires_at) VALUES (?, ?, ?)')
      .run(createHash('sha256').update('legacy-token').digest('hex'), 'admin', '2999-01-01T00:00:00.000Z')

    const api = apiWith(database)
    const columns = database.prepare('PRAGMA table_info(auth_sessions)').all().map((column) => column.name)
    assert.ok(!columns.includes('credential_hash'))
    assert.ok(columns.includes('token_hash'))
    assert.equal((await requestApi(api, '/api/auth/status', 'GET', undefined, { cookie: 'trip_session=legacy-token' })).output.authenticated, false)
  } finally {
    database.close()
  }
})

test('administrators issue scoped guest codes that see only assigned trips', async (t) => {
  const provider = useMockOidc(t)
  const database = new DatabaseSync(':memory:')
  try {
    const api = apiWith(database)
    const cookie = await adminCookie(api, provider)
    const workspace = testWorkspace(['trip-a', 'trip-b'])
    await requestWorkspace(api, 'PUT', workspace, { cookie })

    const created = await createAccessCode(api, cookie, { label: '  家人  ', tripIds: ['trip-a'] })
    assert.equal(created.status, 201)
    assert.match(created.output.code, /^[A-Za-z0-9_-]{24}$/)
    assert.equal(created.output.access.label, '家人')
    assert.deepEqual(created.output.access.tripIds, ['trip-a'])

    const guest = await guestCookie(api, created.output.code)
    assert.deepEqual((await requestApi(api, '/api/auth/status', 'GET', undefined, { cookie: guest })).output, {
      configured: true,
      authenticated: true,
      role: 'code',
    })
    assert.deepEqual(await requestWorkspace(api, 'GET', undefined, { cookie: guest }), {
      status: 200,
      output: { trips: [workspace.trips[0]], activeTripId: 'trip-a' },
    })
    assert.deepEqual(await requestWorkspace(api, 'PUT', workspace, { cookie: guest }), {
      status: 403,
      output: { error: '目前帳號只有查看權限。' },
    })
    assert.equal((await requestNotepad(api, 'PUT', { tripId: 'trip-b', notepad: '越權' }, { cookie: guest })).status, 404)
    assert.deepEqual(await requestNotepad(api, 'PUT', { tripId: 'trip-a', notepad: '家人補充' }, { cookie: guest }), {
      status: 200,
      output: { saved: true },
    })
    assert.equal((await requestWorkspace(api, 'GET', undefined, { cookie: guest })).output.trips[0].notepad, '家人補充')

    const listed = await requestApi(api, '/api/access-codes', 'GET', undefined, { cookie })
    assert.deepEqual(listed.output.codes.map((code) => [code.label, code.tripIds]), [['家人', ['trip-a']]])
    assert.ok(!JSON.stringify(listed.output).includes(created.output.code))
  } finally {
    database.close()
  }
})

test('revoking a guest code ends its session and blocks future logins', async (t) => {
  const provider = useMockOidc(t)
  const database = new DatabaseSync(':memory:')
  try {
    const api = apiWith(database)
    const cookie = await adminCookie(api, provider)
    await requestWorkspace(api, 'PUT', testWorkspace(), { cookie })
    const created = await createAccessCode(api, cookie, { label: '朋友', tripIds: ['sqlite-trip'] })
    const guest = await guestCookie(api, created.output.code)
    const codePath = `/api/access-codes/${created.output.access.id}`

    const deleted = await requestApi(api, codePath, 'DELETE', undefined, { cookie })
    assert.equal(deleted.status, 200)
    assert.deepEqual(deleted.output, { deleted: true })
    assert.equal((await requestWorkspace(api, 'GET', undefined, { cookie: guest })).status, 401)
    assert.equal((await requestApi(api, '/api/auth/login', 'POST', { code: created.output.code })).status, 401)
    assert.deepEqual((await requestApi(api, '/api/access-codes', 'GET', undefined, { cookie })).output, { codes: [] })

    const missing = await requestApi(api, codePath, 'DELETE', undefined, { cookie })
    assert.equal(missing.status, 404)
    assert.deepEqual(missing.output, { error: '找不到指定通行碼。' })
  } finally {
    database.close()
  }
})

test('only administrators can list, create, or revoke access codes', async (t) => {
  const provider = useMockOidc(t)
  const database = new DatabaseSync(':memory:')
  try {
    const api = apiWith(database)
    const admin = await adminCookie(api, provider)
    await requestWorkspace(api, 'PUT', testWorkspace(), { cookie: admin })
    const created = await createAccessCode(api, admin, { label: '家人', tripIds: ['sqlite-trip'] })
    const codePath = `/api/access-codes/${created.output.access.id}`
    const viewer = await viewerCookie(api, provider)
    const guest = await guestCookie(api, created.output.code)

    for (const cookie of [viewer, guest]) {
      assert.equal((await requestApi(api, '/api/access-codes', 'GET', undefined, { cookie })).status, 403)
      assert.equal((await createAccessCode(api, cookie, { label: '越權', tripIds: ['sqlite-trip'] })).status, 403)
      assert.equal((await requestApi(api, codePath, 'DELETE', undefined, { cookie })).status, 403)
    }
    assert.equal((await requestApi(api, '/api/access-codes', 'GET')).status, 401)
    assert.equal((await requestApi(api, codePath, 'DELETE')).status, 401)
    assert.equal((await requestApi(api, '/api/access-codes', 'GET', undefined, { cookie: admin })).output.codes.length, 1)
  } finally {
    database.close()
  }
})

test('validates access-code requests before issuing a code', async (t) => {
  const provider = useMockOidc(t)
  const database = new DatabaseSync(':memory:')
  try {
    const api = apiWith(database)
    const cookie = await adminCookie(api, provider)

    const withoutWorkspace = await createAccessCode(api, cookie, { label: '家人', tripIds: ['sqlite-trip'] })
    assert.equal(withoutWorkspace.status, 404)
    assert.deepEqual(withoutWorkspace.output, { error: 'SQLite 尚未建立旅程資料。' })

    await requestWorkspace(api, 'PUT', testWorkspace(), { cookie })
    const invalidRequests = [
      [{ label: '   ', tripIds: ['sqlite-trip'] }, '通行碼名稱需為 1 到 60 個字。'],
      [{ label: 'x'.repeat(61), tripIds: ['sqlite-trip'] }, '通行碼名稱需為 1 到 60 個字。'],
      [{ label: '家人', tripIds: [] }, '請指定 1 到 100 個旅程。'],
      [{ label: '家人', tripIds: 'sqlite-trip' }, '請指定 1 到 100 個旅程。'],
      [{ label: '家人', tripIds: Array.from({ length: 101 }, (_, index) => `trip-${index}`) }, '請指定 1 到 100 個旅程。'],
      [{ label: '家人', tripIds: ['missing-trip'] }, '指定的旅程不存在。'],
    ]
    for (const [body, error] of invalidRequests) {
      const result = await createAccessCode(api, cookie, body)
      assert.equal(result.status, 400)
      assert.deepEqual(result.output, { error })
    }
    assert.deepEqual((await requestApi(api, '/api/access-codes', 'GET', undefined, { cookie })).output, { codes: [] })
  } finally {
    database.close()
  }
})

test('guest access fails with a clear message when its trips are removed', async (t) => {
  const provider = useMockOidc(t)
  const database = new DatabaseSync(':memory:')
  try {
    const api = apiWith(database)
    const cookie = await adminCookie(api, provider)
    await requestWorkspace(api, 'PUT', testWorkspace(['trip-a']), { cookie })
    const created = await createAccessCode(api, cookie, { label: '家人', tripIds: ['trip-a'] })
    const guest = await guestCookie(api, created.output.code)

    await requestWorkspace(api, 'PUT', testWorkspace(['trip-b']), { cookie })
    assert.deepEqual(await requestWorkspace(api, 'GET', undefined, { cookie: guest }), {
      status: 403,
      output: { error: '此通行碼尚未指派可查看的旅程。' },
    })
  } finally {
    database.close()
  }
})

