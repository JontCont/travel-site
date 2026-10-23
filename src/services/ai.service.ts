import { isTripDto, type TripDto } from '../dto/trip-workspace.dto.ts'
import type { Stop } from '../models/trip.ts'

export type AiProviderId = 'openai_compatible' | 'openrouter' | 'anthropic' | 'gemini'

export type AiProviderOption = {
  id: AiProviderId
  label: string
  baseUrl: string | null
  baseUrlEditable: boolean
}

export type AiSettings = {
  provider: AiProviderId
  baseUrl: string | null
  model: string
  hasApiKey: boolean
  updatedAt: string
}

export type AiSettingsSummary = {
  settings: AiSettings | null
  ready: boolean
  providers: AiProviderOption[]
}

export type AiSettingsInput = {
  provider: AiProviderId
  baseUrl?: string
  model: string
  apiKey?: string
  clearApiKey?: boolean
}

export type AiGenerateRequest = {
  mode: 'generate_itinerary'
  destination: string
  startDate: string
  endDate: string
  timeZone: string
  preferences?: string
}

export type AiSuggestRequest = {
  mode: 'suggest_day_stops'
  tripId: string
  date: string
  preferences?: string
}

export type AiCheckRequest = {
  mode: 'check_conflicts'
  tripId: string
}

export type AiTidyRequest = {
  mode: 'tidy_notepad'
  tripId: string
}

export type AiAskRequest = {
  mode: 'ask'
  tripId: string
  question: string
}

export type AiAssistRequest = AiGenerateRequest | AiSuggestRequest | AiCheckRequest | AiTidyRequest | AiAskRequest

export type AiIssue = {
  date: string | null
  severity: 'warning' | 'info'
  message: string
}

export type AiAssistResult =
  | { mode: 'generate_itinerary'; trip: TripDto }
  | { mode: 'suggest_day_stops'; stops: Stop[] }
  | { mode: 'check_conflicts'; issues: AiIssue[] }
  | { mode: 'tidy_notepad'; notepad: string }
  | { mode: 'ask'; answer: string }

const providerIds: AiProviderId[] = ['openai_compatible', 'openrouter', 'anthropic', 'gemini']
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readError(response: Response, fallback: string): Promise<string> {
  const payload: unknown = await response.json().catch(() => null)
  return typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string'
    ? payload.error
    : fallback
}

function isProviderId(value: unknown): value is AiProviderId {
  return providerIds.some((id) => id === value)
}

function isAiProviderOption(value: unknown): value is AiProviderOption {
  return isRecord(value) &&
    isProviderId(value.id) &&
    typeof value.label === 'string' &&
    (value.baseUrl === null || typeof value.baseUrl === 'string') &&
    typeof value.baseUrlEditable === 'boolean'
}

function isAiSettings(value: unknown): value is AiSettings {
  return isRecord(value) &&
    isProviderId(value.provider) &&
    (value.baseUrl === null || typeof value.baseUrl === 'string') &&
    typeof value.model === 'string' &&
    typeof value.hasApiKey === 'boolean' &&
    typeof value.updatedAt === 'string'
}

function parseAiSettingsSummary(value: unknown): AiSettingsSummary {
  if (!isRecord(value) ||
    !(value.settings === null || isAiSettings(value.settings)) ||
    typeof value.ready !== 'boolean' ||
    !Array.isArray(value.providers) || !value.providers.every(isAiProviderOption)) {
    throw new Error('AI 設定回傳的資料格式不正確。')
  }
  return {
    settings: value.settings,
    ready: value.ready,
    providers: value.providers,
  }
}

function isStop(value: unknown): value is Stop {
  return isRecord(value) &&
    typeof value.id === 'string' && value.id !== '' &&
    typeof value.name === 'string' &&
    typeof value.address === 'string' &&
    typeof value.time === 'string' && timePattern.test(value.time) &&
    typeof value.duration === 'number' && Number.isFinite(value.duration) && value.duration >= 0 &&
    typeof value.coordinates === 'string' &&
    (value.notes === undefined || typeof value.notes === 'string')
}

function isAiIssue(value: unknown): value is AiIssue {
  return isRecord(value) &&
    (value.date === null || typeof value.date === 'string') &&
    (value.severity === 'warning' || value.severity === 'info') &&
    typeof value.message === 'string'
}

function parseAiAssistResult(value: unknown): AiAssistResult {
  if (isRecord(value)) {
    if (value.mode === 'generate_itinerary' && isTripDto(value.trip)) {
      return { mode: 'generate_itinerary', trip: value.trip }
    }
    if (value.mode === 'suggest_day_stops') {
      const stops = value.stops
      if (Array.isArray(stops) && stops.every(isStop)) return { mode: 'suggest_day_stops', stops }
    }
    if (value.mode === 'check_conflicts') {
      const issues = value.issues
      if (Array.isArray(issues) && issues.every(isAiIssue)) return { mode: 'check_conflicts', issues }
    }
    if (value.mode === 'tidy_notepad' && typeof value.notepad === 'string') {
      return { mode: 'tidy_notepad', notepad: value.notepad }
    }
    if (value.mode === 'ask' && typeof value.answer === 'string') {
      return { mode: 'ask', answer: value.answer }
    }
  }
  throw new Error('AI 回傳的資料格式不正確。')
}

export async function getAiAvailability(): Promise<boolean> {
  const response = await fetch('/api/ai/availability', { credentials: 'same-origin' })
  if (!response.ok) throw new Error(await readError(response, `讀取 AI 狀態失敗（HTTP ${response.status}）。`))
  const value: unknown = await response.json().catch(() => null)
  if (!isRecord(value) || typeof value.ready !== 'boolean') throw new Error('AI 狀態回傳的資料格式不正確。')
  return value.ready
}

export async function getAiSettings(): Promise<AiSettingsSummary> {
  const response = await fetch('/api/ai/settings', { credentials: 'same-origin' })
  if (!response.ok) throw new Error(await readError(response, `讀取 AI 設定失敗（HTTP ${response.status}）。`))
  return parseAiSettingsSummary(await response.json())
}

export async function saveAiSettings(input: AiSettingsInput): Promise<AiSettingsSummary> {
  const response = await fetch('/api/ai/settings', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) throw new Error(await readError(response, `儲存 AI 設定失敗（HTTP ${response.status}）。`))
  return parseAiSettingsSummary(await response.json())
}

export async function testAiSettings(): Promise<void> {
  const response = await fetch('/api/ai/test', { method: 'POST', credentials: 'same-origin' })
  if (!response.ok) throw new Error(await readError(response, `AI 連線測試失敗（HTTP ${response.status}）。`))
  const value: unknown = await response.json().catch(() => null)
  if (!isRecord(value) || value.ok !== true) throw new Error('AI 連線測試回傳的資料格式不正確。')
}

export async function runAiAssist(request: AiAssistRequest): Promise<AiAssistResult> {
  const response = await fetch('/api/ai/assist', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!response.ok) throw new Error(await readError(response, `AI 呼叫失敗（HTTP ${response.status}）。`))
  return parseAiAssistResult(await response.json())
}
