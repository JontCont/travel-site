export type AccessRole = 'viewer' | 'admin' | 'code'

export type AuthStatus = {
  configured: boolean
  authenticated: boolean
  role: AccessRole | null
}

function isAccessRole(value: unknown): value is AccessRole {
  return value === 'viewer' || value === 'admin' || value === 'code'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readError(response: Response, fallback: string): Promise<string> {
  const payload: unknown = await response.json().catch(() => null)
  return typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string'
    ? payload.error
    : fallback
}

export async function getAuthStatus(): Promise<AuthStatus> {
  const response = await fetch('/api/auth/status', { credentials: 'same-origin' })
  if (!response.ok) throw new Error(await readError(response, `讀取登入狀態失敗（HTTP ${response.status}）。`))
  const value: unknown = await response.json()
  if (!isRecord(value) ||
    typeof value.configured !== 'boolean' || typeof value.authenticated !== 'boolean' ||
    !(value.role === null || isAccessRole(value.role))) {
    throw new Error('登入服務回傳的資料格式不正確。')
  }
  return {
    configured: value.configured,
    authenticated: value.authenticated,
    role: value.role,
  }
}

export async function loginWithAccessCode(code: string): Promise<AccessRole> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  if (!response.ok) throw new Error(await readError(response, `登入失敗（HTTP ${response.status}）。`))
  const value: unknown = await response.json()
  if (!isRecord(value) || !isAccessRole(value.role)) {
    throw new Error('登入服務回傳的資料格式不正確。')
  }
  return value.role
}

export async function logout(): Promise<void> {
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
  })
  if (!response.ok) throw new Error(await readError(response, `登出失敗（HTTP ${response.status}）。`))
}

export function startSynologyLogin(): void {
  window.location.assign('/api/auth/oidc/start')
}

const authErrorMessages: Record<string, string> = {
  oidc_denied: 'Synology 登入已取消或被拒絕。',
  oidc_state: 'Synology 登入逾時或已使用過，請重新登入。',
  oidc_token: 'Synology 登入權杖驗證失敗，請重新登入。',
  oidc_identity: '無法取得 Synology 帳號資訊，請確認 NAS 設定。',
  oidc_unavailable: '無法連線到 Synology 登入服務，請確認 NAS 與網路設定。',
}

export function readAuthErrorFromUrl(): string {
  const code = new URLSearchParams(window.location.search).get('auth_error')
  if (!code) return ''
  return authErrorMessages[code] ?? 'Synology 登入失敗，請稍後再試。'
}

export function clearAuthErrorFromUrl(): void {
  if (!new URLSearchParams(window.location.search).has('auth_error')) return
  window.history.replaceState(null, '', window.location.pathname)
}

export type AccessCodeExpiryDays = 7 | 30 | 90 | null

export type AccessCodeSummary = {
  id: string
  label: string
  tripIds: string[]
  createdAt: string
  expiresAt: string | null
}

export type AccessCodeUpdate = {
  tripIds?: string[]
  expiresInDays?: AccessCodeExpiryDays
}

export type CreatedAccessCode = {
  code: string
  access: AccessCodeSummary
}

function isAccessCodeSummary(value: unknown): value is AccessCodeSummary {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    Array.isArray(value.tripIds) && value.tripIds.every((tripId) => typeof tripId === 'string') &&
    typeof value.createdAt === 'string' &&
    (value.expiresAt === null || typeof value.expiresAt === 'string')
}

export async function listAccessCodes(): Promise<AccessCodeSummary[]> {
  const response = await fetch('/api/access-codes', { credentials: 'same-origin' })
  if (!response.ok) throw new Error(await readError(response, `讀取通行碼失敗（HTTP ${response.status}）。`))
  const value: unknown = await response.json()
  if (!isRecord(value) || !Array.isArray(value.codes)) throw new Error('通行碼清單回傳的資料格式不正確。')
  const codes: unknown[] = value.codes
  if (!codes.every(isAccessCodeSummary)) throw new Error('通行碼清單回傳的資料格式不正確。')
  return codes
}

export async function createAccessCode(
  label: string,
  tripIds: string[],
  expiresInDays: AccessCodeExpiryDays,
): Promise<CreatedAccessCode> {
  const response = await fetch('/api/access-codes', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, tripIds, expiresInDays }),
  })
  if (!response.ok) throw new Error(await readError(response, `建立通行碼失敗（HTTP ${response.status}）。`))
  const value: unknown = await response.json()
  if (!isRecord(value) || typeof value.code !== 'string') throw new Error('建立通行碼回傳的資料格式不正確。')
  const access: unknown = value.access
  if (!isAccessCodeSummary(access)) throw new Error('建立通行碼回傳的資料格式不正確。')
  return { code: value.code, access }
}

export async function updateAccessCode(id: string, update: AccessCodeUpdate): Promise<AccessCodeSummary> {
  const response = await fetch(`/api/access-codes/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  })
  if (!response.ok) throw new Error(await readError(response, `更新通行碼失敗（HTTP ${response.status}）。`))
  const value: unknown = await response.json()
  if (!isRecord(value)) throw new Error('更新通行碼回傳的資料格式不正確。')
  const access: unknown = value.access
  if (!isAccessCodeSummary(access)) throw new Error('更新通行碼回傳的資料格式不正確。')
  return access
}

export async function revokeAccessCode(id: string): Promise<void> {
  const response = await fetch(`/api/access-codes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  })
  if (!response.ok) throw new Error(await readError(response, `撤銷通行碼失敗（HTTP ${response.status}）。`))
}
