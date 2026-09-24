import { isTripWorkspaceDto, type TripWorkspaceDto } from '../dto/trip-workspace.dto.ts'

const workspaceKey = 'travel-planner-v1'

export function loadWorkspace(storage: Pick<Storage, 'getItem'>): TripWorkspaceDto | null {
  const raw = storage.getItem(workspaceKey)
  if (raw === null) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('舊版本機旅程資料不是有效 JSON；原有資料未被修改。')
  }
  if (!isTripWorkspaceDto(value)) throw new Error('舊版本機旅程資料格式不正確；原有資料未被修改。')
  return value
}

export async function saveWorkspace(workspace: TripWorkspaceDto): Promise<void> {
  const response = await fetch('/api/workspace', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(workspace),
  })
  if (response.ok) return
  const payload: unknown = await response.json().catch(() => null)
  const message = typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string'
    ? payload.error
    : `SQLite 儲存失敗（HTTP ${response.status}）。`
  throw new Error(message)
}

export async function loadTripWorkspace(storage: Pick<Storage, 'getItem'>): Promise<TripWorkspaceDto> {
  const response = await fetch('/api/workspace')
  if (response.status === 404) {
    const legacyWorkspace = loadWorkspace(storage)
    if (!legacyWorkspace) throw new Error('SQLite 尚無旅程資料，且找不到可遷移的舊版瀏覽器資料。')
    await saveWorkspace(legacyWorkspace)
    return legacyWorkspace
  }
  if (!response.ok) throw new Error(`讀取 SQLite 旅程資料失敗（HTTP ${response.status}）。`)
  const value: unknown = await response.json()
  if (!isTripWorkspaceDto(value)) throw new Error('SQLite 回傳的旅程資料格式不正確。')
  return value
}
