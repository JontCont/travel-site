import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { createTripApi, walkApi } from '../route-api.mjs'
import { defineTrip } from '../src/trips.ts'

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

async function requestWorkspace(api, method, body) {
  const req = {
    url: '/api/workspace',
    method,
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield JSON.stringify(body)
    },
  }
  let status, output
  const res = {
    writeHead(code) { status = code },
    end(value) { output = value ? JSON.parse(value) : null },
  }
  await api(req, res, () => assert.fail('Unexpected next'))
  return { status, output }
}

function testWorkspace() {
  const trip = defineTrip({
    id: 'sqlite-trip',
    title: 'SQLite 測試',
    destination: '北京',
    startDate: '2026-05-15',
    endDate: '2026-05-15',
    timeZone: 'Asia/Shanghai',
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
    const api = createTripApi(database)
    const workspace = testWorkspace()

    assert.deepEqual(await requestWorkspace(api, 'GET'), {
      status: 404,
      output: { error: 'SQLite 尚未建立旅程資料。' },
    })
    assert.deepEqual(await requestWorkspace(api, 'PUT', workspace), {
      status: 200,
      output: { saved: true },
    })
    assert.deepEqual(await requestWorkspace(api, 'GET'), {
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
    const api = createTripApi(database)
    const workspace = testWorkspace()
    await requestWorkspace(api, 'PUT', workspace)

    assert.deepEqual(await requestWorkspace(api, 'PUT', { trips: [], activeTripId: 'missing' }), {
      status: 400,
      output: { error: '旅程資料格式不正確，未寫入 SQLite。' },
    })
    assert.deepEqual(await requestWorkspace(api, 'GET'), { status: 200, output: workspace })
  } finally {
    database.close()
  }
})
