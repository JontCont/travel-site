import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'

export const oidcTestConfig = {
  configured: true,
  issuer: 'https://nas.example.test/webman/sso',
  clientId: 'travel-test-client',
  clientSecret: 'test-client-secret',
  redirectUri: 'https://travel.example.test/api/auth/oidc/callback',
  adminGroup: 'administrators',
  adminUsers: ['break-glass-admin'],
}

function parseBody(value) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export async function requestApi(api, path, method, body, headers = {}) {
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
    end(value) { output = parseBody(value) },
  }
  await api(req, res, () => assert.fail('Unexpected next'))
  return { status, output, headers: responseHeaders }
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function signJwt(header, claims, privateKey) {
  const encodedHeader = base64UrlJson(header)
  const encodedPayload = base64UrlJson(claims)
  const signature = sign('sha256', Buffer.from(`${encodedHeader}.${encodedPayload}`), privateKey).toString('base64url')
  return `${encodedHeader}.${encodedPayload}.${signature}`
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export function createMockSynologyOidc() {
  const { issuer } = oidcTestConfig
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const { privateKey: otherPrivateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: 'mock-key-1', use: 'sig', alg: 'RS256' }
  const pendingCodes = new Map()
  const accessTokens = new Map()
  let offline = false

  function buildIdToken(user, nonce, options) {
    const now = Math.floor(Date.now() / 1000)
    const claims = {
      iss: issuer,
      aud: oidcTestConfig.clientId,
      sub: user.sub,
      username: user.username,
      email: user.email,
      groups: user.groups,
      nonce,
      iat: now,
      exp: now + 300,
      ...options.overrides,
    }
    if (options.omitGroups) delete claims.groups
    return signJwt({ alg: 'RS256', typ: 'JWT', kid: 'mock-key-1' }, claims, options.badSignature ? otherPrivateKey : privateKey)
  }

  function issueTokens(form) {
    if (form.get('client_id') !== oidcTestConfig.clientId || form.get('client_secret') !== oidcTestConfig.clientSecret) {
      return jsonResponse({ error: 'invalid_client' }, 401)
    }
    const pending = pendingCodes.get(form.get('code') ?? '')
    if (!pending || form.get('grant_type') !== 'authorization_code') return jsonResponse({ error: 'invalid_grant' }, 400)
    pendingCodes.delete(form.get('code'))
    if (form.get('redirect_uri') !== pending.redirectUri) return jsonResponse({ error: 'invalid_grant' }, 400)
    const expectedChallenge = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url')
    if (expectedChallenge !== pending.codeChallenge) return jsonResponse({ error: 'invalid_grant' }, 400)

    const accessToken = randomUUID()
    accessTokens.set(accessToken, pending.user)
    return jsonResponse({
      token_type: 'Bearer',
      expires_in: 3600,
      access_token: accessToken,
      id_token: buildIdToken(pending.user, pending.nonce, pending.idTokenOptions),
    })
  }

  function userInfo(authorization) {
    const token = (authorization ?? '').startsWith('Bearer ') ? authorization.slice('Bearer '.length) : ''
    const user = accessTokens.get(token)
    if (!user) return jsonResponse({ error: 'invalid_token' }, 401)
    return jsonResponse({ sub: user.sub, username: user.username, email: user.email, groups: user.groups })
  }

  async function handleFetch(input, init = {}) {
    if (offline) throw new TypeError('fetch failed')
    const url = new URL(String(input))
    const href = url.href
    if (href === `${issuer}/.well-known/openid-configuration`) {
      return jsonResponse({
        issuer,
        authorization_endpoint: `${issuer}/SSOOauth.cgi`,
        token_endpoint: `${issuer}/SSOAccessToken.cgi`,
        userinfo_endpoint: `${issuer}/SSOUserInfo.cgi`,
        jwks_uri: `${issuer}/openid-jwks.json`,
      })
    }
    if (href === `${issuer}/openid-jwks.json`) return jsonResponse({ keys: [publicJwk] })
    if (href === `${issuer}/SSOAccessToken.cgi`) return issueTokens(new URLSearchParams(init.body))
    if (href === `${issuer}/SSOUserInfo.cgi`) return userInfo(new Headers(init.headers).get('Authorization'))
    return jsonResponse({ error: 'not_found' }, 404)
  }

  return {
    install() {
      const original = globalThis.fetch
      globalThis.fetch = handleFetch
      return () => { globalThis.fetch = original }
    },
    setOffline(value) {
      offline = value
    },
    beginLogin(authorizeUrl, claims, idTokenOptions = {}) {
      const url = new URL(authorizeUrl)
      assert.equal(`${url.origin}${url.pathname}`, `${issuer}/SSOOauth.cgi`)
      const params = url.searchParams
      const code = randomUUID()
      const user = { email: `${claims.username}@example.test`, groups: [], ...claims }
      user.sub ??= user.username
      pendingCodes.set(code, {
        redirectUri: params.get('redirect_uri'),
        codeChallenge: params.get('code_challenge'),
        nonce: params.get('nonce'),
        user,
        idTokenOptions,
      })
      return { code, state: params.get('state') }
    },
  }
}

export async function synologyLogin(api, provider, claims, idTokenOptions = {}) {
  const start = await requestApi(api, '/api/auth/oidc/start', 'GET')
  assert.equal(start.status, 302)
  const { code, state } = provider.beginLogin(start.headers.Location, claims, idTokenOptions)
  const callback = await requestApi(api, `/api/auth/oidc/callback?${new URLSearchParams({ code, state })}`, 'GET')
  const setCookie = callback.headers?.['Set-Cookie']
  return { start, callback, setCookie, cookie: setCookie?.split(';')[0], code, state }
}
