import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { createTripApi, walkApi } from '../route-api.mjs'
import { defineTrip } from '../src/services/trip.service.ts'

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

const accessCodes = {
  viewCode: 'test-view-access-code-123456',
  adminCode: 'test-admin-access-code-123456',
}

async function requestApi(api, path, method, body, headers = {}) {
  const req = {
    url: path,
    method,
    headers,
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield JSON.stringify(body)
    },
  }
  let status, output, responseHeaders
  const res = {
    writeHead(code, values) { status = code; responseHeaders = values },
    end(value) { output = value ? JSON.parse(value) : null },
  }
  await api(req, res, () => assert.fail('Unexpected next'))
  return { status, output, headers: responseHeaders }
}

async function requestWorkspace(api, method, body, headers) {
  const { status, output } = await requestApi(api, '/api/workspace', method, body, headers)
  return { status, output }
}

async function login(api, code) {
  return requestApi(api, '/api/auth/login', 'POST', { code })
}

function testWorkspace() {
  const trip = defineTrip({
    id: 'sqlite-trip',
    title: 'SQLite 測試',
    destination: '北京',
    startDate: '2026-05-15',
    endDate: '2026-05-15',
    timeZone: 'Asia/Shanghai',
    notepad: '測試備忘：集合地點待確認',
  })
  return { trips: [trip], activeTripId: trip.id }
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

test('persists validated trip workspaces in SQLite', async () => {
  const database = new DatabaseSync(':memory:')
  try {
    const api = createTripApi(database, accessCodes)
    const workspace = testWorkspace()
    const { headers } = await login(api, accessCodes.adminCode)
    const cookie = headers['Set-Cookie'].split(';')[0]

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

test('rejects invalid workspaces without changing saved SQLite data', async () => {
  const database = new DatabaseSync(':memory:')
  try {
    const api = createTripApi(database, accessCodes)
    const workspace = testWorkspace()
    const { headers } = await login(api, accessCodes.adminCode)
    const cookie = headers['Set-Cookie'].split(';')[0]
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

test('fails closed when the NAS access codes are not configured', async () => {
  const database = new DatabaseSync(':memory:')
  try {
    const api = createTripApi(database, { viewCode: '', adminCode: '' })
    assert.deepEqual(await requestApi(api, '/api/auth/status', 'GET'), {
      status: 200,
      output: { configured: false, authenticated: false, role: null },
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
    assert.equal((await login(api, accessCodes.viewCode)).status, 503)
    assert.equal((await requestWorkspace(api, 'GET')).status, 401)
  } finally {
    database.close()
  }
})

test('rate-limits repeated invalid access-code attempts', async () => {
  const database = new DatabaseSync(':memory:')
  try {
    const api = createTripApi(database, accessCodes)
    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal((await login(api, 'invalid-access-code')).status, 401)
    }
    assert.deepEqual(await login(api, 'invalid-access-code'), {
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

test('viewer access can read but cannot write trip data', async () => {
  const database = new DatabaseSync(':memory:')
  try {
    const api = createTripApi(database, accessCodes)
    const adminLogin = await login(api, accessCodes.adminCode)
    const adminCookie = adminLogin.headers['Set-Cookie'].split(';')[0]
    const workspace = testWorkspace()
    await requestWorkspace(api, 'PUT', workspace, { cookie: adminCookie })

    const viewerLogin = await login(api, accessCodes.viewCode)
    assert.equal(viewerLogin.output.role, 'viewer')
    const viewerCookie = viewerLogin.headers['Set-Cookie'].split(';')[0]
    assert.deepEqual(await requestWorkspace(api, 'GET', undefined, { cookie: viewerCookie }), {
      status: 200,
      output: workspace,
    })
    assert.deepEqual(await requestWorkspace(api, 'PUT', testWorkspace(), { cookie: viewerCookie }), {
      status: 403,
      output: { error: '訪客通行碼只有查看權限。' },
    })
    assert.deepEqual(await requestWorkspace(api, 'GET', undefined, { cookie: adminCookie }), {
      status: 200,
      output: workspace,
    })
  } finally {
    database.close()
  }
})

test('requires a session for every API endpoint and expires it on logout', async () => {
  const database = new DatabaseSync(':memory:')
  try {
    const api = createTripApi(database, accessCodes)
    assert.deepEqual(await requestApi(api, '/api/walk', 'POST', { origin: '119.3,26.1', destination: '119.4,26.2' }), {
      status: 401,
      output: { error: '請先登入才能存取旅程資料。' },
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })

    const loginResult = await login(api, accessCodes.viewCode)
    const cookie = loginResult.headers['Set-Cookie'].split(';')[0]
    assert.equal((await requestApi(api, '/api/auth/logout', 'POST', undefined, { cookie })).status, 200)
    assert.equal((await requestWorkspace(api, 'GET', undefined, { cookie })).status, 401)
  } finally {
    database.close()
  }
})
