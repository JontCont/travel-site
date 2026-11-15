import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto'

const requestTimeoutMs = 10_000
const clockSkewSeconds = 60

export class OidcError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'OidcError'
    this.code = code
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function normalizeIssuer(value) {
  return value.replace(/\/+$/, '')
}

function identityError(message) {
  return new OidcError('oidc_identity', message)
}

export function readOidcConfig(env = process.env) {
  const issuer = normalizeIssuer((env.TRIP_OIDC_ISSUER ?? '').trim())
  const clientId = (env.TRIP_OIDC_CLIENT_ID ?? '').trim()
  const clientSecret = (env.TRIP_OIDC_CLIENT_SECRET ?? '').trim()
  const redirectUri = (env.TRIP_OIDC_REDIRECT_URI ?? '').trim()
  return {
    configured: Boolean(clientId && clientSecret && isHttpsUrl(issuer) && isHttpsUrl(redirectUri)),
    issuer,
    clientId,
    clientSecret,
    redirectUri,
    adminGroup: (env.TRIP_OIDC_ADMIN_GROUP ?? '').trim().toLowerCase() || 'administrators',
    adminUsers: (env.TRIP_OIDC_ADMIN_USERS ?? '')
      .split(',')
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  }
}

async function fetchJson(url, errorCode, init = {}) {
  let response
  try {
    response = await globalThis.fetch(url, { ...init, signal: AbortSignal.timeout(requestTimeoutMs) })
  } catch {
    throw new OidcError(errorCode, `無法連線到 ${new URL(url).origin}。`)
  }
  if (!response.ok) throw new OidcError(errorCode, `Synology 登入服務回應 HTTP ${response.status}。`)
  try {
    return await response.json()
  } catch {
    throw new OidcError(errorCode, 'Synology 登入服務回傳的 JSON 無效。')
  }
}

function sameOriginHttpsEndpoint(value, name, origin) {
  let url = null
  try {
    url = new URL(value)
  } catch {
    url = null
  }
  if (!url || url.protocol !== 'https:' || url.origin !== origin) {
    throw new OidcError('oidc_unavailable', `${name} 必須是與 issuer 同來源的 HTTPS 位址。`)
  }
  return url.toString()
}

export async function discoverOidc(config) {
  const metadata = await fetchJson(`${config.issuer}/.well-known/openid-configuration`, 'oidc_unavailable')
  if (!isRecord(metadata) || typeof metadata.issuer !== 'string' || normalizeIssuer(metadata.issuer) !== config.issuer) {
    throw new OidcError('oidc_unavailable', 'Synology 登入服務的 issuer 與設定不一致。')
  }
  const origin = new URL(config.issuer).origin
  const endpoint = (name) => {
    if (typeof metadata[name] !== 'string' || !metadata[name]) {
      throw new OidcError('oidc_unavailable', `Synology 登入服務缺少 ${name}。`)
    }
    return sameOriginHttpsEndpoint(metadata[name], name, origin)
  }
  return {
    issuer: metadata.issuer,
    authorizationEndpoint: endpoint('authorization_endpoint'),
    tokenEndpoint: endpoint('token_endpoint'),
    jwksUri: endpoint('jwks_uri'),
    userinfoEndpoint: typeof metadata.userinfo_endpoint === 'string' && metadata.userinfo_endpoint
      ? endpoint('userinfo_endpoint')
      : null,
  }
}

export function createAuthorizationRequest(config, discovery) {
  const state = randomBytes(32).toString('base64url')
  const nonce = randomBytes(32).toString('base64url')
  const codeVerifier = randomBytes(48).toString('base64url')
  const url = new URL(discovery.authorizationEndpoint)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: 'openid email groups',
    state,
    nonce,
    code_challenge: createHash('sha256').update(codeVerifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString()
  return { url: url.toString(), state, nonce, codeVerifier }
}

export async function exchangeAuthorizationCode(config, discovery, { code, codeVerifier }) {
  const tokens = await fetchJson(discovery.tokenEndpoint, 'oidc_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code_verifier: codeVerifier,
    }).toString(),
  })
  if (!isRecord(tokens) || typeof tokens.id_token !== 'string') {
    throw new OidcError('oidc_token', 'Synology 登入服務的 Token 回應不完整。')
  }
  return tokens
}

function decodeJwtSegment(segment) {
  let value
  try {
    value = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
  } catch {
    value = undefined
  }
  if (!isRecord(value)) throw identityError('ID Token 格式不正確。')
  return value
}

async function verifyIdToken(idToken, config, discovery, nonce) {
  const parts = idToken.split('.')
  if (parts.length !== 3) throw identityError('ID Token 格式不正確。')
  const [encodedHeader, encodedPayload, encodedSignature] = parts
  const header = decodeJwtSegment(encodedHeader)
  const claims = decodeJwtSegment(encodedPayload)
  if (header.alg !== 'RS256') throw identityError('ID Token 必須使用 RS256 簽章。')

  const jwks = await fetchJson(discovery.jwksUri, 'oidc_unavailable')
  const jwk = isRecord(jwks) && Array.isArray(jwks.keys)
    ? jwks.keys.find((key) => isRecord(key) && key.kty === 'RSA' &&
      (key.use === undefined || key.use === 'sig') &&
      (header.kid === undefined || key.kid === header.kid))
    : undefined
  if (!jwk) throw identityError('找不到可驗證 ID Token 的 Synology 公開金鑰。')
  const signatureValid = verify(
    'sha256',
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    createPublicKey({ key: jwk, format: 'jwk' }),
    Buffer.from(encodedSignature, 'base64url'),
  )
  if (!signatureValid) throw identityError('ID Token 簽章驗證失敗。')

  const now = Math.floor(Date.now() / 1000)
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (claims.iss !== discovery.issuer) throw identityError('ID Token 的 issuer 不符。')
  if (!audiences.includes(config.clientId)) throw identityError('ID Token 的 audience 不符。')
  if ((audiences.length > 1 || claims.azp !== undefined) && claims.azp !== config.clientId) {
    throw identityError('ID Token 的 azp 不符。')
  }
  if (typeof claims.exp !== 'number' || claims.exp + clockSkewSeconds <= now) throw identityError('ID Token 已過期。')
  if (typeof claims.iat !== 'number' || claims.iat > now + clockSkewSeconds) throw identityError('ID Token 簽發時間不正確。')
  if (typeof claims.nonce !== 'string' || claims.nonce !== nonce) throw identityError('ID Token nonce 不符。')
  if (typeof claims.sub !== 'string' || !claims.sub) throw identityError('ID Token 缺少 sub。')
  if (typeof claims.username !== 'string' || !claims.username) throw identityError('ID Token 缺少 username。')
  return claims
}

export async function resolveOidcIdentity(config, discovery, tokens, nonce) {
  const claims = await verifyIdToken(tokens.id_token, config, discovery, nonce)
  let groups = Array.isArray(claims.groups) ? claims.groups : null
  if (!groups) {
    if (!discovery.userinfoEndpoint || typeof tokens.access_token !== 'string') {
      throw identityError('無法取得 Synology 群組資訊。')
    }
    const userinfo = await fetchJson(discovery.userinfoEndpoint, 'oidc_identity', {
      headers: { Accept: 'application/json', Authorization: `Bearer ${tokens.access_token}` },
    })
    if (!isRecord(userinfo) || (userinfo.sub !== undefined && userinfo.sub !== claims.sub)) {
      throw identityError('UserInfo 與 ID Token 的使用者不符。')
    }
    groups = Array.isArray(userinfo.groups) ? userinfo.groups : []
  }
  return {
    subject: claims.sub,
    username: claims.username,
    groups: groups.filter((group) => typeof group === 'string'),
  }
}

export function oidcRoleFor(identity, config) {
  const username = identity.username.toLowerCase()
  const isAdministrator = config.adminUsers.includes(username) ||
    identity.groups.some((group) => group.toLowerCase() === config.adminGroup)
  return isAdministrator ? 'admin' : 'viewer'
}
