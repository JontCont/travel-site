import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { createAuthorizationRequest, oidcRoleFor, readOidcConfig } from '../oidc.mjs'
import { createTripApi } from '../route-api.mjs'
import { createMockSynologyOidc, oidcTestConfig, requestApi, synologyLogin } from './helpers/mock-synology-oidc.mjs'

const adminClaims = { sub: 'sub-alice', username: 'alice', groups: ['administrators'] }
const viewerClaims = { sub: 'sub-bob', username: 'bob', groups: ['users'] }

function setup(oidc = oidcTestConfig) {
  const database = new DatabaseSync(':memory:')
  return { database, api: createTripApi(database, { oidc, secureCookie: false }) }
}

function useMockOidc(t) {
  const mock = createMockSynologyOidc()
  t.after(mock.install())
  return mock
}

function callback(api, params) {
  return requestApi(api, `/api/auth/oidc/callback?${new URLSearchParams(params)}`, 'GET')
}

function sessionCount(database) {
  return database.prepare('SELECT COUNT(*) AS count FROM auth_sessions').get().count
}

test('readOidcConfig requires HTTPS issuer and redirect values and normalizes admin settings', () => {
  assert.equal(readOidcConfig({}).configured, false)
  assert.equal(readOidcConfig({}).adminGroup, 'administrators')
  assert.deepEqual(readOidcConfig({}).adminUsers, [])

  const env = {
    TRIP_OIDC_ISSUER: 'https://nas.example.test/webman/sso/',
    TRIP_OIDC_CLIENT_ID: ' travel-test-client ',
    TRIP_OIDC_CLIENT_SECRET: 'test-client-secret',
    TRIP_OIDC_REDIRECT_URI: 'https://travel.example.test/api/auth/oidc/callback',
    TRIP_OIDC_ADMIN_GROUP: ' Admins ',
    TRIP_OIDC_ADMIN_USERS: ' Alice, ,BOB ',
  }
  const config = readOidcConfig(env)
  assert.equal(config.configured, true)
  assert.equal(config.issuer, 'https://nas.example.test/webman/sso')
  assert.equal(config.clientId, 'travel-test-client')
  assert.equal(config.adminGroup, 'admins')
  assert.deepEqual(config.adminUsers, ['alice', 'bob'])
  assert.equal(readOidcConfig({ ...env, TRIP_OIDC_ISSUER: 'http://nas.example.test/webman/sso' }).configured, false)
  assert.equal(readOidcConfig({ ...env, TRIP_OIDC_CLIENT_SECRET: '' }).configured, false)
})

test('oidcRoleFor grants admin by configured username or group and viewer otherwise', () => {
  assert.equal(oidcRoleFor({ username: 'Break-Glass-Admin', groups: [] }, oidcTestConfig), 'admin')
  assert.equal(oidcRoleFor({ username: 'carol', groups: ['Administrators'] }, oidcTestConfig), 'admin')
  assert.equal(oidcRoleFor({ username: 'bob', groups: ['users'] }, oidcTestConfig), 'viewer')
  assert.equal(oidcRoleFor({ username: 'bob', groups: [] }, oidcTestConfig), 'viewer')
})

test('createAuthorizationRequest uses PKCE S256 with fresh state and nonce', () => {
  const discovery = { authorizationEndpoint: `${oidcTestConfig.issuer}/SSOOauth.cgi` }
  const first = createAuthorizationRequest(oidcTestConfig, discovery)
  const second = createAuthorizationRequest(oidcTestConfig, discovery)
  const url = new URL(first.url)
  assert.equal(url.origin + url.pathname, `${oidcTestConfig.issuer}/SSOOauth.cgi`)
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.equal(url.searchParams.get('client_id'), oidcTestConfig.clientId)
  assert.equal(url.searchParams.get('redirect_uri'), oidcTestConfig.redirectUri)
  assert.equal(url.searchParams.get('scope'), 'openid email groups')
  assert.equal(url.searchParams.get('state'), first.state)
  assert.equal(url.searchParams.get('nonce'), first.nonce)
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(first.codeVerifier).digest('base64url'))
  assert.notEqual(first.state, second.state)
  assert.notEqual(first.nonce, second.nonce)
})

test('Synology login issues an admin session for a DSM administrator', async (t) => {
  const mock = useMockOidc(t)
  const { api } = setup()
  const login = await synologyLogin(api, mock, adminClaims)
  assert.equal(login.callback.status, 200)
  assert.match(login.callback.headers['Content-Type'], /text\/html/)
  assert.match(login.setCookie, /^trip_session=[A-Za-z0-9_-]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=\d+$/)
  const status = await requestApi(api, '/api/auth/status', 'GET', undefined, { cookie: login.cookie })
  assert.equal(status.output.authenticated, true)
  assert.equal(status.output.role, 'admin')
})

test('Synology login grants admin to a configured break-glass username', async (t) => {
  const mock = useMockOidc(t)
  const { api } = setup()
  const login = await synologyLogin(api, mock, { sub: 'sub-root', username: 'break-glass-admin', groups: [] })
  const status = await requestApi(api, '/api/auth/status', 'GET', undefined, { cookie: login.cookie })
  assert.equal(status.output.role, 'admin')
})

test('Synology login grants viewer to other DSM users', async (t) => {
  const mock = useMockOidc(t)
  const { api } = setup()
  const login = await synologyLogin(api, mock, viewerClaims)
  assert.equal(login.callback.status, 200)
  const status = await requestApi(api, '/api/auth/status', 'GET', undefined, { cookie: login.cookie })
  assert.equal(status.output.role, 'viewer')
})

test('Secure cookies are marked Secure when the API is configured for HTTPS cookies', async (t) => {
  const mock = useMockOidc(t)
  const database = new DatabaseSync(':memory:')
  const api = createTripApi(database, { oidc: oidcTestConfig, secureCookie: true })
  const login = await synologyLogin(api, mock, adminClaims)
  assert.match(login.setCookie, /; Secure$/)
})

test('UserInfo supplies groups when the ID token omits them', async (t) => {
  const mock = useMockOidc(t)
  const { api } = setup()
  const login = await synologyLogin(api, mock, adminClaims, { omitGroups: true })
  assert.equal(login.callback.status, 200)
  const status = await requestApi(api, '/api/auth/status', 'GET', undefined, { cookie: login.cookie })
  assert.equal(status.output.role, 'admin')
})

test('OIDC callback rejects a denied authorization', async () => {
  const { database, api } = setup()
  const result = await callback(api, { error: 'access_denied', state: 'anything' })
  assert.equal(result.status, 302)
  assert.equal(result.headers.Location, '/?auth_error=oidc_denied')
  assert.equal(sessionCount(database), 0)
})

test('OIDC callback rejects a missing or unknown state', async () => {
  const { database, api } = setup()
  const missing = await callback(api, { code: 'anything' })
  assert.equal(missing.headers.Location, '/?auth_error=oidc_state')

  const unknown = await callback(api, { code: 'anything', state: 'never-issued' })
  assert.equal(unknown.headers.Location, '/?auth_error=oidc_state')
  assert.equal(sessionCount(database), 0)
})

test('OIDC state is single-use', async (t) => {
  const mock = useMockOidc(t)
  const { api } = setup()
  const login = await synologyLogin(api, mock, adminClaims)
  assert.equal(login.callback.status, 200)
  const replay = await callback(api, { code: login.code, state: login.state })
  assert.equal(replay.status, 302)
  assert.equal(replay.headers.Location, '/?auth_error=oidc_state')
})

test('OIDC callback without a code reports a token error', async (t) => {
  const mock = useMockOidc(t)
  const { api } = setup()
  const start = await requestApi(api, '/api/auth/oidc/start', 'GET')
  const { state } = mock.beginLogin(start.headers.Location, adminClaims)
  const result = await callback(api, { state })
  assert.equal(result.headers.Location, '/?auth_error=oidc_token')
})

test('OIDC callback with a code the IdP did not issue reports a token error', async (t) => {
  const mock = useMockOidc(t)
  const { database, api } = setup()
  const start = await requestApi(api, '/api/auth/oidc/start', 'GET')
  const { state } = mock.beginLogin(start.headers.Location, adminClaims)
  const result = await callback(api, { code: 'not-issued-by-idp', state })
  assert.equal(result.headers.Location, '/?auth_error=oidc_token')
  assert.equal(sessionCount(database), 0)
})

test('expired OIDC transactions cannot complete login', async (t) => {
  const mock = useMockOidc(t)
  const { database, api } = setup()
  const start = await requestApi(api, '/api/auth/oidc/start', 'GET')
  const { code, state } = mock.beginLogin(start.headers.Location, adminClaims)
  database.prepare('UPDATE oidc_transactions SET expires_at = 0').run()
  const result = await callback(api, { code, state })
  assert.equal(result.headers.Location, '/?auth_error=oidc_state')
})

const identityFailures = [
  ['bad signature', { badSignature: true }],
  ['expired', { overrides: { exp: Math.floor(Date.now() / 1000) - 3600 } }],
  ['future issued-at', { overrides: { iat: Math.floor(Date.now() / 1000) + 3600 } }],
  ['wrong nonce', { overrides: { nonce: 'stale-nonce' } }],
  ['wrong audience', { overrides: { aud: 'another-client' } }],
  ['wrong issuer', { overrides: { iss: 'https://evil.example.test/webman/sso' } }],
  ['missing subject', { overrides: { sub: '' } }],
]

for (const [name, options] of identityFailures) {
  test(`OIDC callback rejects an ID token with ${name}`, async (t) => {
    const mock = useMockOidc(t)
    const { database, api } = setup()
    const login = await synologyLogin(api, mock, adminClaims, options)
    assert.equal(login.callback.status, 302)
    assert.equal(login.callback.headers.Location, '/?auth_error=oidc_identity')
    assert.equal(login.setCookie, undefined)
    assert.equal(sessionCount(database), 0)
  })
}

test('OIDC start reports an unreachable Synology service without storing a transaction', async (t) => {
  const mock = useMockOidc(t)
  mock.setOffline(true)
  const { database, api } = setup()
  const start = await requestApi(api, '/api/auth/oidc/start', 'GET')
  assert.equal(start.status, 302)
  assert.equal(start.headers.Location, '/?auth_error=oidc_unavailable')
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM oidc_transactions').get().count, 0)
})

test('OIDC start and access-code login fail closed when Synology login is not configured', async () => {
  const { api } = setup({ ...oidcTestConfig, configured: false })
  const start = await requestApi(api, '/api/auth/oidc/start', 'GET')
  assert.equal(start.headers.Location, '/?auth_error=oidc_unavailable')
  const login = await requestApi(api, '/api/auth/login', 'POST', { code: 'anything-123456789012' })
  assert.equal(login.status, 503)
})
