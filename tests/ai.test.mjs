import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { createTripApi } from '../route-api.mjs'
import { decryptSecret, encryptSecret, readSecretKey } from '../ai-crypto.mjs'
import { aiSkillNames, loadAiSkills } from '../ai-skills.mjs'
import { normalizeAssistResult, parseAssistRequest, runAiAssist } from '../ai-assistant.mjs'
import {
  AiInputError,
  AiOutputError,
  buildProviderRequest,
  callAiProvider,
  parseAiSettingsInput,
  parseJsonObject,
} from '../ai-providers.mjs'
import { defineTrip } from '../src/services/trip.service.ts'
import { createMockSynologyOidc, oidcTestConfig, requestApi, synologyLogin } from './helpers/mock-synology-oidc.mjs'

const secret = 'test-secret-key-0123456789abcdef0123456789'
const otherSecret = 'another-secret-key-0123456789abcdef0123'
const apiKey = 'sk-test-provider-key-123456'

const adminClaims = { sub: 'sub-admin', username: 'nas-admin', groups: ['administrators'] }
const viewerClaims = { sub: 'sub-viewer', username: 'nas-viewer', groups: ['users'] }

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function openAiContent(content) {
  return jsonResponse({ choices: [{ message: { content: JSON.stringify(content) } }] })
}

function recordingFetch(respond) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init })
    return respond(String(url), init)
  }
  return { fetchImpl, calls }
}

function useMockOidc(t) {
  const mock = createMockSynologyOidc()
  t.after(mock.install())
  return mock
}

async function cookieFor(api, provider, claims) {
  const result = await synologyLogin(api, provider, claims)
  assert.equal(result.callback.status, 200)
  return result.cookie
}

function aiApi(database, options = {}) {
  return createTripApi(database, { oidc: oidcTestConfig, secureCookie: false, ...options })
}

function testTrip(id) {
  return defineTrip({
    id,
    title: `${id} 測試`,
    destination: '北京',
    startDate: '2026-05-15',
    endDate: '2026-05-15',
    timeZone: 'Asia/Shanghai',
    notepad: '集合地點待確認',
  })
}

test('secrets round-trip through AES-GCM and reject the wrong key', () => {
  const payload = encryptSecret(apiKey, secret)
  assert.ok(payload.startsWith('v1.'))
  assert.ok(!payload.includes(apiKey))
  assert.notEqual(encryptSecret(apiKey, secret), payload)
  assert.equal(decryptSecret(payload, secret), apiKey)
  assert.throws(() => decryptSecret(payload, otherSecret))
  assert.throws(() => decryptSecret('not-a-payload', secret))
})

test('secret keys must be at least 32 characters', () => {
  assert.equal(readSecretKey('short'), null)
  assert.equal(readSecretKey(undefined), null)
  assert.equal(readSecretKey(secret), secret)
})

test('provider settings accept only https custom base URLs', () => {
  const base = { provider: 'openai_compatible', model: 'gpt-4o-mini' }
  assert.throws(() => parseAiSettingsInput({ ...base, baseUrl: 'http://api.example.test/v1' }), AiInputError)
  assert.throws(() => parseAiSettingsInput({ ...base, baseUrl: 'https://user:pw@api.example.test/v1' }), AiInputError)
  assert.throws(() => parseAiSettingsInput({ ...base, baseUrl: 'https://api.example.test/v1?key=1' }), AiInputError)
  assert.throws(() => parseAiSettingsInput({ ...base }), AiInputError)
  assert.equal(parseAiSettingsInput({ ...base, baseUrl: 'https://api.example.test/v1/' }).baseUrl, 'https://api.example.test/v1')
  assert.equal(parseAiSettingsInput({ provider: 'gemini', model: 'gemini-2.5-flash', baseUrl: 'https://evil.example.test' }).baseUrl, null)
})

test('each provider uses its own endpoint and auth header', () => {
  const gemini = buildProviderRequest({ provider: 'gemini', baseUrl: null, model: 'gemini-2.5-flash', apiKey, system: 's', user: 'u' })
  assert.equal(gemini.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent')
  assert.equal(gemini.headers['x-goog-api-key'], apiKey)
  assert.ok(!gemini.url.includes(apiKey))

  const anthropic = buildProviderRequest({ provider: 'anthropic', baseUrl: null, model: 'claude-sonnet-4-5', apiKey, system: 's', user: 'u' })
  assert.equal(anthropic.url, 'https://api.anthropic.com/v1/messages')
  assert.equal(anthropic.headers['x-api-key'], apiKey)

  const custom = buildProviderRequest({ provider: 'openai_compatible', baseUrl: 'https://api.example.test/v1', model: 'gpt-4o-mini', apiKey, system: 's', user: 'u' })
  assert.equal(custom.url, 'https://api.example.test/v1/chat/completions')
  assert.equal(custom.headers.Authorization, `Bearer ${apiKey}`)
})

test('provider calls disable redirects and surface only generic errors', async () => {
  const { fetchImpl, calls } = recordingFetch(() => jsonResponse({ error: 'upstream secret detail' }, 401))
  await assert.rejects(
    callAiProvider({ provider: 'openrouter', baseUrl: null, model: 'm', apiKey, system: 's', user: 'u', fetchImpl }),
    (error) => error.message === 'API Key 無效或沒有權限。' && !error.message.includes('upstream secret detail'),
  )
  assert.equal(calls[0].init.redirect, 'error')
})

test('parseJsonObject accepts fenced JSON and rejects non-JSON text', () => {
  assert.deepEqual(parseJsonObject('```json\n{"ok": true}\n```'), { ok: true })
  assert.throws(() => parseJsonObject('沒有 JSON'), AiOutputError)
})

test('assistant loads only the whitelisted travel skills', async () => {
  const text = await loadAiSkills()
  assert.equal(aiSkillNames.length, 5)
  for (const name of aiSkillNames) assert.ok(text.includes(`## Skill: ${name}`), name)
  assert.ok(!text.includes('## Skill: app-architecture'))
  assert.ok(!text.includes('## Skill: project-reference'))
})

test('assist requests reject oversized ranges and unknown time zones', () => {
  assert.throws(() => parseAssistRequest({
    mode: 'generate_itinerary', destination: '東京', startDate: '2026-01-01', endDate: '2026-02-01', timeZone: 'Asia/Tokyo',
  }), AiInputError)
  assert.throws(() => parseAssistRequest({
    mode: 'generate_itinerary', destination: '東京', startDate: '2026-01-01', endDate: '2026-01-02', timeZone: 'Mars/Olympus',
  }), AiInputError)
})

test('generated itineraries become valid trips with fresh stop ids', () => {
  const request = parseAssistRequest({
    mode: 'generate_itinerary', destination: '京都', startDate: '2026-04-01', endDate: '2026-04-02', timeZone: 'Asia/Tokyo', preferences: '慢慢走',
  })
  const text = JSON.stringify({
    title: '京都兩日',
    country: '日本',
    days: {
      '2026-04-01': [{ name: '伏見稻荷大社', address: '京都市伏見區', time: '8:00', duration: 90 }],
      '2026-04-02': [{ name: '嵐山', address: '京都市右京區', time: '10:00', duration: 180, notes: '竹林步道' }],
    },
  })
  const { trip } = normalizeAssistResult(request, null, text)
  assert.equal(trip.title, '京都兩日')
  assert.deepEqual(Object.keys(trip.days), ['2026-04-01', '2026-04-02'])
  const stops = Object.values(trip.days).flat()
  assert.equal(stops.length, 2)
  assert.notEqual(stops[0].id, stops[1].id)
  assert.equal(stops[0].time, '08:00')
  assert.equal(stops[0].coordinates, '')
})

test('conflict issues keep only trip dates and normalize severity', () => {
  const trip = testTrip('conflict-trip')
  const text = JSON.stringify({
    issues: [
      { date: '2026-05-15', severity: 'warning', message: '午餐與博物館時間重疊' },
      { date: '2026-06-01', severity: 'critical', message: '日期不在行程內' },
      { date: null, severity: 'info', message: '' },
    ],
  })
  const result = normalizeAssistResult({ mode: 'check_conflicts', tripId: trip.id }, trip, text)
  assert.deepEqual(result.issues, [
    { date: '2026-05-15', severity: 'warning', message: '午餐與博物館時間重疊' },
    { date: null, severity: 'info', message: '日期不在行程內' },
  ])
})

test('requests for dates outside the trip or empty notepads never reach the provider', async () => {
  const trip = testTrip('guard-trip')
  const { fetchImpl, calls } = recordingFetch(() => openAiContent({ stops: [] }))
  const settings = { provider: 'openrouter', baseUrl: null, model: 'm' }
  await assert.rejects(runAiAssist({
    settings, apiKey, trip, fetchImpl,
    request: { mode: 'suggest_day_stops', tripId: trip.id, date: '2026-06-01', preferences: '' },
  }), AiInputError)
  await assert.rejects(runAiAssist({
    settings, apiKey, trip: { ...trip, notepad: '  ' }, fetchImpl,
    request: { mode: 'tidy_notepad', tripId: trip.id },
  }), AiInputError)
  assert.equal(calls.length, 0)
})

test('ask requests need a trip and a bounded question', () => {
  assert.deepEqual(parseAssistRequest({ mode: 'ask', tripId: 'trip-a', question: '  故宮哪天休館？ ' }), {
    mode: 'ask', tripId: 'trip-a', question: '故宮哪天休館？',
  })
  assert.throws(() => parseAssistRequest({ mode: 'ask', question: '故宮哪天休館？' }), AiInputError)
  assert.throws(() => parseAssistRequest({ mode: 'ask', tripId: 'trip-a', question: '   ' }), AiInputError)
  assert.throws(() => parseAssistRequest({ mode: 'ask', tripId: 'trip-a', question: 'x'.repeat(1001) }), AiInputError)
  assert.throws(() => parseAssistRequest({ mode: 'ask', tripId: 'trip-a', question: 123 }), AiInputError)
})

test('ask answers are plain text capped at 4000 characters', () => {
  const trip = testTrip('trip-a')
  const request = { mode: 'ask', tripId: 'trip-a', question: '問題' }
  assert.deepEqual(normalizeAssistResult(request, trip, JSON.stringify({ answer: '  可以先去故宮。  ' })), {
    answer: '可以先去故宮。',
  })
  assert.equal(normalizeAssistResult(request, trip, JSON.stringify({ answer: 'a'.repeat(5000) })).answer.length, 4000)
  assert.throws(() => normalizeAssistResult(request, trip, JSON.stringify({ answer: '   ' })), AiOutputError)
  assert.throws(() => normalizeAssistResult(request, trip, JSON.stringify({ stops: [] })), AiOutputError)
})

test('AI settings are admin-only and never return the API key', async (t) => {
  const provider = useMockOidc(t)
  const database = new DatabaseSync(':memory:')
  const api = aiApi(database)
  const admin = await cookieFor(api, provider, adminClaims)
  const viewer = await cookieFor(api, provider, viewerClaims)

  assert.equal((await requestApi(api, '/api/ai/settings', 'GET')).status, 401)
  assert.equal((await requestApi(api, '/api/ai/settings', 'GET', undefined, { cookie: viewer })).status, 403)
  assert.equal((await requestApi(api, '/api/ai/assist', 'POST', { mode: 'tidy_notepad', tripId: 'x' }, { cookie: viewer })).status, 403)

  const saved = await requestApi(api, '/api/ai/settings', 'PUT', {
    provider: 'openrouter', model: 'openai/gpt-4o-mini', apiKey,
  }, { cookie: admin })
  assert.equal(saved.status, 200)
  assert.equal(saved.output.settings.hasApiKey, true)
  assert.equal(saved.output.ready, true)
  assert.ok(!JSON.stringify(saved.output).includes(apiKey))

  const fetched = await requestApi(api, '/api/ai/settings', 'GET', undefined, { cookie: admin })
  assert.ok(!JSON.stringify(fetched.output).includes(apiKey))

  const stored = database.prepare('SELECT api_key_encrypted FROM ai_settings WHERE id = 1').get()
  assert.ok(stored.api_key_encrypted.startsWith('v1.'))
  assert.ok(!stored.api_key_encrypted.includes(apiKey))
  assert.ok(readSecretKey(database.prepare('SELECT secret FROM ai_secret WHERE id = 1').get().secret))
})

test('AI settings validate key handling on save', async (t) => {
  const provider = useMockOidc(t)
  const database = new DatabaseSync(':memory:')
  const api = aiApi(database)
  const admin = await cookieFor(api, provider, adminClaims)
  const put = (body) => requestApi(api, '/api/ai/settings', 'PUT', body, { cookie: admin })

  assert.equal((await put({ provider: 'openrouter', model: 'm', apiKey })).status, 200)
  assert.equal((await put({ provider: 'anthropic', model: 'claude-sonnet-4-5' })).status, 400)
  assert.equal((await put({ provider: 'openrouter', model: 'm', apiKey, clearApiKey: true })).status, 400)

  const cleared = await put({ provider: 'openrouter', model: 'm', clearApiKey: true })
  assert.equal(cleared.status, 200)
  assert.equal(cleared.output.settings.hasApiKey, false)
  assert.equal(cleared.output.ready, false)
})

test('AI stays unavailable until settings are saved and the key in SQLite is valid', async (t) => {
  const provider = useMockOidc(t)
  const database = new DatabaseSync(':memory:')
  const api = aiApi(database)
  const admin = await cookieFor(api, provider, adminClaims)

  const status = await requestApi(api, '/api/ai/settings', 'GET', undefined, { cookie: admin })
  assert.equal(status.output.settings, null)
  assert.equal(status.output.ready, false)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM ai_secret').get().count, 0)

  const saved = await requestApi(api, '/api/ai/settings', 'PUT', { provider: 'openrouter', model: 'm', apiKey }, { cookie: admin })
  assert.equal(saved.status, 200)
  assert.equal(saved.output.ready, true)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM ai_secret').get().count, 1)

  database.prepare('UPDATE ai_secret SET secret = ? WHERE id = 1').run(otherSecret)
  const mismatched = await requestApi(api, '/api/ai/test', 'POST', undefined, { cookie: admin })
  assert.equal(mismatched.status, 500)
  assert.ok(mismatched.output.error.includes('無法解密'))

  database.prepare('DELETE FROM ai_secret').run()
  const removed = await requestApi(api, '/api/ai/settings', 'GET', undefined, { cookie: admin })
  assert.equal(removed.output.ready, false)
  assert.equal((await requestApi(api, '/api/ai/test', 'POST', undefined, { cookie: admin })).status, 503)
})

test('AI test and assist send the stored key only to the configured provider', async (t) => {
  const provider = useMockOidc(t)
  const database = new DatabaseSync(':memory:')
  const { fetchImpl, calls } = recordingFetch(() => openAiContent({
    stops: [{ name: '故宮博物院', address: '北京市東城區景山前街 4 號', time: '9:30', duration: 120, notes: '提早入場' }],
  }))
  const api = aiApi(database, { aiFetch: fetchImpl })
  const admin = await cookieFor(api, provider, adminClaims)

  const saved = await requestApi(api, '/api/ai/settings', 'PUT', {
    provider: 'openrouter', model: 'openai/gpt-4o-mini', apiKey,
  }, { cookie: admin })
  assert.equal(saved.status, 200)

  const tested = await requestApi(api, '/api/ai/test', 'POST', undefined, { cookie: admin })
  assert.equal(tested.status, 200)
  assert.deepEqual(tested.output, { ok: true })
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions')
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${apiKey}`)

  const workspace = { trips: [testTrip('ai-trip')], activeTripId: 'ai-trip' }
  assert.equal((await requestApi(api, '/api/workspace', 'PUT', workspace, { cookie: admin })).status, 200)

  const result = await requestApi(api, '/api/ai/assist', 'POST', {
    mode: 'suggest_day_stops', tripId: 'ai-trip', date: '2026-05-15', preferences: '親子友善',
  }, { cookie: admin })
  assert.equal(result.status, 200)
  assert.equal(result.output.mode, 'suggest_day_stops')
  assert.equal(result.output.stops.length, 1)
  assert.equal(result.output.stops[0].name, '故宮博物院')
  assert.equal(result.output.stops[0].time, '09:30')
  assert.equal(result.output.stops[0].duration, 120)
  assert.ok(!JSON.stringify(result.output).includes(apiKey))

  const assistCall = calls[1]
  assert.equal(assistCall.url, 'https://openrouter.ai/api/v1/chat/completions')
  assert.equal(assistCall.init.headers.Authorization, `Bearer ${apiKey}`)
  assert.equal(assistCall.init.redirect, 'error')
  const sent = JSON.parse(assistCall.init.body)
  assert.ok(sent.messages[0].content.includes('## Skill: travel-plan-foundation'))
  assert.ok(!JSON.stringify(sent).includes(apiKey))
})

test('AI assist maps provider failures to 502 and missing trips to 404', async (t) => {
  const provider = useMockOidc(t)
  const database = new DatabaseSync(':memory:')
  const { fetchImpl } = recordingFetch(() => jsonResponse({ error: { message: 'upstream secret detail' } }, 401))
  const api = aiApi(database, { aiFetch: fetchImpl })
  const admin = await cookieFor(api, provider, adminClaims)

  assert.equal((await requestApi(api, '/api/ai/settings', 'PUT', {
    provider: 'openrouter', model: 'm', apiKey,
  }, { cookie: admin })).status, 200)

  const missing = await requestApi(api, '/api/ai/assist', 'POST', {
    mode: 'check_conflicts', tripId: 'missing-trip',
  }, { cookie: admin })
  assert.equal(missing.status, 404)

  const workspace = { trips: [testTrip('failing-trip')], activeTripId: 'failing-trip' }
  assert.equal((await requestApi(api, '/api/workspace', 'PUT', workspace, { cookie: admin })).status, 200)
  const failed = await requestApi(api, '/api/ai/assist', 'POST', {
    mode: 'check_conflicts', tripId: 'failing-trip',
  }, { cookie: admin })
  assert.equal(failed.status, 502)
  assert.ok(failed.output.error.includes('API Key'))
  assert.ok(!JSON.stringify(failed.output).includes('upstream secret detail'))

  const invalid = await requestApi(api, '/api/ai/assist', 'POST', { mode: 'unknown' }, { cookie: admin })
  assert.equal(invalid.status, 400)
})

async function guestCookieFor(api, code) {
  const result = await requestApi(api, '/api/auth/login', 'POST', { code })
  assert.equal(result.status, 200)
  return result.headers['Set-Cookie'].split(';')[0]
}

test('per-trip AI ask access is admin-controlled and viewers can only ask questions', async (t) => {
  const provider = useMockOidc(t)
  const database = new DatabaseSync(':memory:')
  const { fetchImpl, calls } = recordingFetch(() => openAiContent({ answer: '故宮週一閉館。' }))
  const api = aiApi(database, { aiFetch: fetchImpl })
  const admin = await cookieFor(api, provider, adminClaims)
  const viewer = await cookieFor(api, provider, viewerClaims)
  const askBody = { mode: 'ask', tripId: 'ask-trip', question: '故宮哪天休館？' }

  assert.equal((await requestApi(api, '/api/ai/settings', 'PUT', {
    provider: 'openrouter', model: 'openai/gpt-4o-mini', apiKey,
  }, { cookie: admin })).status, 200)
  assert.deepEqual((await requestApi(api, '/api/ai/availability', 'GET', undefined, { cookie: viewer })).output, { ready: true })
  assert.equal((await requestApi(api, '/api/workspace', 'PUT', {
    trips: [testTrip('ask-trip')], activeTripId: 'ask-trip',
  }, { cookie: admin })).status, 200)

  const closed = await requestApi(api, '/api/ai/assist', 'POST', askBody, { cookie: viewer })
  assert.equal(closed.status, 403)
  assert.deepEqual(closed.output, { error: '管理員尚未開放此旅程的 AI 助理。' })
  assert.equal(calls.length, 0)

  const adminAsk = await requestApi(api, '/api/ai/assist', 'POST', askBody, { cookie: admin })
  assert.equal(adminAsk.status, 200)
  assert.equal(calls.length, 1)

  assert.equal((await requestApi(api, '/api/workspace', 'PUT', {
    trips: [{ ...testTrip('ask-trip'), aiAskEnabled: true }], activeTripId: 'ask-trip',
  }, { cookie: admin })).status, 200)
  const answered = await requestApi(api, '/api/ai/assist', 'POST', askBody, { cookie: viewer })
  assert.equal(answered.status, 200)
  assert.deepEqual(answered.output, { mode: 'ask', answer: '故宮週一閉館。' })
  assert.equal(calls.length, 2)

  for (const body of [{ mode: 'tidy_notepad', tripId: 'ask-trip' }, { mode: 'check_conflicts', tripId: 'ask-trip' }]) {
    const denied = await requestApi(api, '/api/ai/assist', 'POST', body, { cookie: viewer })
    assert.equal(denied.status, 403)
    assert.deepEqual(denied.output, { error: '此 AI 功能只限管理員使用。' })
  }
  assert.equal((await requestApi(api, '/api/ai/settings', 'GET', undefined, { cookie: viewer })).status, 403)
  assert.equal((await requestApi(api, '/api/ai/settings', 'PUT', {
    provider: 'openrouter', model: 'm', apiKey,
  }, { cookie: viewer })).status, 403)
  assert.equal((await requestApi(api, '/api/ai/test', 'POST', undefined, { cookie: viewer })).status, 403)
  assert.equal(calls.length, 2)
})

test('guest codes can ask only inside their trips and only when the admin allows it', async (t) => {
  const provider = useMockOidc(t)
  const database = new DatabaseSync(':memory:')
  const { fetchImpl, calls } = recordingFetch(() => openAiContent({ answer: '可以搭地鐵前往。' }))
  const api = aiApi(database, { aiFetch: fetchImpl })
  const admin = await cookieFor(api, provider, adminClaims)

  assert.equal((await requestApi(api, '/api/ai/settings', 'PUT', {
    provider: 'openrouter', model: 'openai/gpt-4o-mini', apiKey,
  }, { cookie: admin })).status, 200)
  assert.equal((await requestApi(api, '/api/workspace', 'PUT', {
    trips: [{ ...testTrip('open-trip'), aiAskEnabled: true }, testTrip('closed-trip')],
    activeTripId: 'open-trip',
  }, { cookie: admin })).status, 200)

  const family = await requestApi(api, '/api/access-codes', 'POST', { label: '家人', tripIds: ['open-trip', 'closed-trip'] }, { cookie: admin })
  const friend = await requestApi(api, '/api/access-codes', 'POST', { label: '朋友', tripIds: ['open-trip'] }, { cookie: admin })
  assert.equal(family.status, 201)
  assert.equal(friend.status, 201)
  const familyCookie = await guestCookieFor(api, family.output.code)
  const friendCookie = await guestCookieFor(api, friend.output.code)

  const ask = (tripId, cookie) => requestApi(api, '/api/ai/assist', 'POST', {
    mode: 'ask', tripId, question: '要帶傘嗎？',
  }, { cookie })
  assert.equal((await ask('open-trip', familyCookie)).status, 200)
  const closed = await ask('closed-trip', familyCookie)
  assert.equal(closed.status, 403)
  assert.deepEqual(closed.output, { error: '管理員尚未開放此旅程的 AI 助理。' })
  assert.equal((await ask('closed-trip', friendCookie)).status, 404)
  assert.equal((await requestApi(api, '/api/ai/assist', 'POST', {
    mode: 'tidy_notepad', tripId: 'open-trip',
  }, { cookie: familyCookie })).status, 403)
  assert.equal(calls.length, 1)
})

