export type AccessRole = 'viewer' | 'admin'

export type AuthStatus = {
  configured: boolean
  authenticated: boolean
  role: AccessRole | null
}

function isAccessRole(value: unknown): value is AccessRole {
  return value === 'viewer' || value === 'admin'
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
