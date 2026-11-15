import { useEffect, useState, type FormEvent } from 'react'
import type { Stop, Trip } from './models/trip'
import { listDates } from './services/trip.service'
import {
  getAiSettings,
  runAiAssist,
  saveAiSettings,
  testAiSettings,
  type AiAssistRequest,
  type AiAssistResult,
  type AiProviderId,
  type AiSettingsInput,
  type AiSettingsSummary,
} from './services/ai.service'

type AiAssistMode = AiAssistRequest['mode']

type AiSettingsPanelProps = {
  onReadyChange: (ready: boolean) => void
}

type AiAssistantPanelProps = {
  trips: Trip[]
  activeTrip: Trip
  askOnly?: boolean
  onCreateTrip: (trip: Trip) => void
  onAddStops: (tripId: string, date: string, stops: Stop[]) => void
  onReplaceNotepad: (tripId: string, notepad: string) => void
}

type AssistOutcome = {
  result: AiAssistResult
  tripId: string
  date: string
}

const defaultProviderId: AiProviderId = 'openai_compatible'

const assistModes: { value: AiAssistMode; label: string; runLabel: string; description: string }[] = [
  { value: 'generate_itinerary', label: '生成新行程', runLabel: '生成行程', description: '依目的地與日期產生新旅程，確認預覽後才會建立。' },
  { value: 'suggest_day_stops', label: '推薦單日景點', runLabel: '取得推薦', description: '為指定日期推薦景點，勾選後才會加入行程。' },
  { value: 'check_conflicts', label: '檢查衝突', runLabel: '開始檢查', description: '檢查目前旅程的時間安排與問題，只提供建議，不會修改資料。' },
  { value: 'tidy_notepad', label: '整理筆記', runLabel: '整理筆記', description: '整理旅程筆記，預覽確認後才會套用到該旅程的筆記。' },
  { value: 'ask', label: '詢問', runLabel: '送出問題', description: '針對旅程內容提問，只回答問題，不會修改行程或筆記。' },
]

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function datesOf(trip: Trip) {
  return listDates(trip.startDate, trip.endDate)
}

export function AiSettingsPanel({ onReadyChange }: AiSettingsPanelProps) {
  const [summary, setSummary] = useState<AiSettingsSummary | null>(null)
  const [loadError, setLoadError] = useState('')
  const [provider, setProvider] = useState<AiProviderId>(defaultProviderId)
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [clearKey, setClearKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [testing, setTesting] = useState(false)
  const [testError, setTestError] = useState('')
  const [testMessage, setTestMessage] = useState('')

  function applySummary(next: AiSettingsSummary) {
    setSummary(next)
    setProvider(next.settings?.provider ?? defaultProviderId)
    setBaseUrl(next.settings?.baseUrl ?? '')
    setModel(next.settings?.model ?? '')
    setApiKey('')
    setClearKey(false)
  }

  useEffect(() => {
    let cancelled = false
    getAiSettings()
      .then((next) => {
        if (!cancelled) applySummary(next)
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(errorMessage(error, '讀取 AI 設定失敗。'))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const selectedOption = summary?.providers.find((option) => option.id === provider) ?? null
  const savedProvider = summary?.settings?.provider ?? null
  const hasSavedKey = summary?.settings?.hasApiKey ?? false
  const providerChanged = savedProvider !== null && savedProvider !== provider

  function changeProvider(value: string) {
    const next = summary?.providers.find((option) => option.id === value)
    if (next) setProvider(next.id)
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setSaveError('')
    setSaveMessage('')
    setTestError('')
    setTestMessage('')
    const trimmedKey = apiKey.trim()
    const input: AiSettingsInput = {
      provider,
      model: model.trim(),
      ...(selectedOption?.baseUrlEditable ? { baseUrl: baseUrl.trim() } : {}),
      ...(trimmedKey ? { apiKey: trimmedKey } : {}),
      ...(clearKey && !trimmedKey ? { clearApiKey: true } : {}),
    }
    try {
      const next = await saveAiSettings(input)
      applySummary(next)
      onReadyChange(next.ready)
      setSaveMessage(next.ready ? 'AI 設定已儲存，AI 助手已可使用。' : 'AI 設定已儲存。')
    } catch (error: unknown) {
      setSaveError(errorMessage(error, '儲存 AI 設定失敗。'))
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    setTestError('')
    setTestMessage('')
    try {
      await testAiSettings()
      setTestMessage('連線成功，AI 服務可以正常回應。')
    } catch (error: unknown) {
      setTestError(errorMessage(error, 'AI 連線測試失敗。'))
    } finally {
      setTesting(false)
    }
  }

  if (loadError) return <section className="ai-panel"><p className="notice danger" role="alert">{loadError}</p></section>
  if (!summary) return <section className="ai-panel"><p className="muted">讀取 AI 設定中…</p></section>

  return (
    <section className="ai-panel">
      <div className="section-heading">
        <div><span className="overline">AI PROVIDER</span><h2>AI 設定</h2></div>
        <span className={summary.ready ? 'ai-status ready' : 'ai-status'}>{summary.ready ? '已就緒' : '尚未設定'}</span>
      </div>
      <p className="ai-note">啟用後，AI 助手會把旅程內容（目的地、日期、景點與筆記）傳送給您選擇的服務商，請只使用您信任的服務商。尚未設定時，AI 助手不會出現在側欄。</p>
      <form className="ai-form" onSubmit={(event) => void handleSave(event)}>
        <label>服務商
          <select value={provider} onChange={(event) => changeProvider(event.target.value)}>
            {summary.providers.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        {selectedOption?.baseUrlEditable ? (
          <label>Base URL
            <input type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.openai.com/v1" required autoComplete="off" />
            <small>必須是 https://，系統會呼叫 Base URL + /chat/completions。</small>
          </label>
        ) : selectedOption ? (
          <p className="ai-fixed">API 端點：<code>{selectedOption.baseUrl}</code></p>
        ) : null}
        <label>模型
          <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="填寫服務商提供的模型 ID" required autoComplete="off" />
        </label>
        <label>API Key
          <input
            type="password"
            value={apiKey}
            onChange={(event) => {
              setApiKey(event.target.value)
              if (event.target.value) setClearKey(false)
            }}
            placeholder={hasSavedKey ? '已儲存，留空則沿用目前的 Key' : '貼上 API Key'}
            required={!hasSavedKey || providerChanged}
            autoComplete="new-password"
          />
        </label>
        {hasSavedKey && (
          <label className="ai-check">
            <input type="checkbox" checked={clearKey} disabled={apiKey.trim() !== ''} onChange={(event) => setClearKey(event.target.checked)} />
            清除已儲存的 API Key（清除後 AI 助手會停用）
          </label>
        )}
        {providerChanged && <p className="ai-warning">切換服務商後，需要重新輸入 API Key。</p>}
        <div className="ai-actions">
          <button type="submit" className="ai-primary" disabled={saving}>{saving ? '儲存中…' : '儲存設定'}</button>
          <button type="button" className="ai-secondary" disabled={!summary.ready || saving || testing} onClick={() => void handleTest()}>{testing ? '測試中…' : '測試連線'}</button>
        </div>
        <p className="muted">測試會使用已儲存的設定。</p>
        {saveError && <p className="notice danger" role="alert">{saveError}</p>}
        {saveMessage && <p className="ai-ok" role="status">{saveMessage}</p>}
        {testError && <p className="notice danger" role="alert">{testError}</p>}
        {testMessage && <p className="ai-ok" role="status">{testMessage}</p>}
      </form>
      <p className="muted">API Key 以 AES-256-GCM 加密後存入 SQLite。加密金鑰由系統自動產生並存放在同一個資料庫，備份資料庫時請一併妥善保管。</p>
    </section>
  )
}

export function AiAssistantPanel({ trips, activeTrip, askOnly = false, onCreateTrip, onAddStops, onReplaceNotepad }: AiAssistantPanelProps) {
  const [mode, setMode] = useState<AiAssistMode>(askOnly ? 'ask' : 'generate_itinerary')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [outcome, setOutcome] = useState<AssistOutcome | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftNotepad, setDraftNotepad] = useState('')
  const [selectedStopIds, setSelectedStopIds] = useState<string[]>([])
  const [destination, setDestination] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [timeZone, setTimeZone] = useState(activeTrip.timeZone)
  const [preferences, setPreferences] = useState('')
  const [question, setQuestion] = useState('')
  const [tripId, setTripId] = useState(activeTrip.id)
  const [suggestDate, setSuggestDate] = useState('')

  const targetTrip = trips.find((trip) => trip.id === tripId) ?? activeTrip
  const targetDates = datesOf(targetTrip)
  const effectiveDate = targetDates.includes(suggestDate) ? suggestDate : (targetDates[0] ?? '')
  const currentMode = assistModes.find((option) => option.value === mode)
  const result = outcome?.result ?? null
  const generatedTrip = result?.mode === 'generate_itinerary' ? result.trip : null
  const suggestedStops = result?.mode === 'suggest_day_stops' ? result.stops : null
  const issues = result?.mode === 'check_conflicts' ? result.issues : null
  const tidied = result?.mode === 'tidy_notepad'
  const answer = result?.mode === 'ask' ? result.answer : null

  function changeMode(next: AiAssistMode) {
    setMode(next)
    setOutcome(null)
    setError('')
    setNotice('')
  }

  function toggleStop(stopId: string, checked: boolean) {
    setSelectedStopIds((current) => checked ? [...current, stopId] : current.filter((id) => id !== stopId))
  }

  function buildRequest(): AiAssistRequest {
    const preferenceText = preferences.trim() || undefined
    if (mode === 'generate_itinerary') {
      return { mode, destination: destination.trim(), startDate, endDate, timeZone: timeZone.trim(), preferences: preferenceText }
    }
    if (mode === 'suggest_day_stops') {
      return { mode, tripId: targetTrip.id, date: effectiveDate, preferences: preferenceText }
    }
    if (mode === 'check_conflicts') return { mode, tripId: targetTrip.id }
    if (mode === 'ask') return { mode, tripId: targetTrip.id, question: question.trim() }
    return { mode: 'tidy_notepad', tripId: targetTrip.id }
  }

  async function handleRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    setOutcome(null)
    try {
      const next = await runAiAssist(buildRequest())
      if (next.mode === 'generate_itinerary') setDraftTitle(next.trip.title)
      if (next.mode === 'tidy_notepad') setDraftNotepad(next.notepad)
      if (next.mode === 'suggest_day_stops') setSelectedStopIds(next.stops.map((stop) => stop.id))
      setOutcome({ result: next, tripId: targetTrip.id, date: effectiveDate })
    } catch (caught: unknown) {
      setError(errorMessage(caught, 'AI 處理失敗。'))
    } finally {
      setBusy(false)
    }
  }

  function applyGenerated() {
    if (!generatedTrip) return
    const title = draftTitle.trim()
    if (!title) {
      setError('請填寫旅程名稱。')
      return
    }
    onCreateTrip({ ...generatedTrip, title })
    setOutcome(null)
  }

  function applySuggested() {
    if (!suggestedStops || !outcome) return
    const stops = suggestedStops.filter((stop) => selectedStopIds.includes(stop.id))
    if (!stops.length) {
      setError('請至少勾選一個景點。')
      return
    }
    onAddStops(outcome.tripId, outcome.date, stops)
    setOutcome(null)
  }

  function applyTidy() {
    if (!outcome || !tidied) return
    onReplaceNotepad(outcome.tripId, draftNotepad)
    setOutcome(null)
    setNotice('已套用到筆記。')
  }

  const tripSelect = (
    <label>旅程
      <select value={targetTrip.id} onChange={(event) => setTripId(event.target.value)}>
        {trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.title}</option>)}
      </select>
    </label>
  )

  const preferencesField = (
    <label>偏好（選填）
      <textarea rows={3} value={preferences} onChange={(event) => setPreferences(event.target.value)} placeholder="例如 步行為主、喜歡美食、不要太趕" />
    </label>
  )

  return (
    <section className="ai-panel">
      <div className="section-heading">
        <div><span className="overline">AI ASSISTANT</span><h2>AI 助手</h2></div>
      </div>
      {!askOnly && (
        <div className="ai-modes">
          {assistModes.map((option) => (
            <button
              key={option.value}
              type="button"
              className={option.value === mode ? 'ai-mode active' : 'ai-mode'}
              aria-pressed={option.value === mode}
              onClick={() => changeMode(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
      <p className="muted">{currentMode?.description}</p>
      <form className="ai-form" onSubmit={(event) => void handleRun(event)}>
        {mode === 'generate_itinerary' && (
          <>
            <label>目的地
              <input value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="例如 東京、京都" required />
            </label>
            <div className="ai-grid-2">
              <label>開始日期
                <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required />
              </label>
              <label>結束日期
                <input type="date" value={endDate} min={startDate || undefined} onChange={(event) => setEndDate(event.target.value)} required />
              </label>
            </div>
            <label>時區
              <input value={timeZone} onChange={(event) => setTimeZone(event.target.value)} placeholder="例如 Asia/Tokyo" required />
            </label>
            {preferencesField}
            <p className="muted">最多 31 天。時區請使用 IANA 名稱。</p>
          </>
        )}
        {mode === 'suggest_day_stops' && (
          <>
            {tripSelect}
            <label>日期
              <select value={effectiveDate} onChange={(event) => setSuggestDate(event.target.value)}>
                {targetDates.map((date) => <option key={date} value={date}>{date}</option>)}
              </select>
            </label>
            {preferencesField}
          </>
        )}
        {(mode === 'check_conflicts' || mode === 'tidy_notepad') && tripSelect}
        {mode === 'ask' && (
          <>
            {tripSelect}
            <label>問題
              <textarea rows={4} maxLength={1000} required value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="例如 第一天有哪些景點需要提早預約？" />
            </label>
          </>
        )}
        <div className="ai-actions">
          <button type="submit" className="ai-primary" disabled={busy}>{busy ? 'AI 處理中…' : currentMode?.runLabel}</button>
        </div>
      </form>

      {busy && <p className="muted" role="status">AI 處理中，可能需要數十秒，請稍候。</p>}
      {error && <p className="notice danger" role="alert">{error}</p>}
      {notice && <p className="ai-ok" role="status">{notice}</p>}

      {generatedTrip && outcome && (
        <div className="ai-preview">
          <label>旅程名稱
            <input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} />
          </label>
          <p className="muted">{generatedTrip.destination} · {generatedTrip.startDate} 至 {generatedTrip.endDate} · {generatedTrip.timeZone}</p>
          {datesOf(generatedTrip).map((date) => (
            <div className="ai-day" key={date}>
              <strong>{date}</strong>
              <span>{generatedTrip.days[date]?.map((stop) => stop.name).join('、') || '（尚未安排景點）'}</span>
            </div>
          ))}
          <div className="ai-actions">
            <button type="button" className="ai-primary" onClick={applyGenerated}>套用為新旅程</button>
            <button type="button" className="ai-secondary" onClick={() => setOutcome(null)}>捨棄</button>
          </div>
        </div>
      )}

      {suggestedStops && outcome && (
        <div className="ai-preview">
          <p className="muted">推薦加入 {outcome.date}，勾選要加入的景點：</p>
          {suggestedStops.map((stop) => (
            <label className="ai-stop-check" key={stop.id}>
              <input type="checkbox" checked={selectedStopIds.includes(stop.id)} onChange={(event) => toggleStop(stop.id, event.target.checked)} />
              <span>
                <strong>{stop.time} · {stop.name}</strong>
                <small>{stop.address}{stop.notes ? ` · ${stop.notes}` : ''}</small>
              </span>
            </label>
          ))}
          <div className="ai-actions">
            <button type="button" className="ai-primary" disabled={selectedStopIds.length === 0} onClick={applySuggested}>加入 {outcome.date}</button>
            <button type="button" className="ai-secondary" onClick={() => setOutcome(null)}>捨棄</button>
          </div>
        </div>
      )}

      {issues && (
        <div className="ai-preview">
          {issues.length === 0 && <p className="ai-ok">AI 沒有發現明顯的衝突。</p>}
          {issues.map((issue, index) => (
            <div className={`ai-issue ${issue.severity}`} key={`${issue.date ?? 'overall'}-${index}`}>
              <strong>{issue.date ?? '整體'} · {issue.severity === 'warning' ? '注意' : '提示'}</strong>
              <span>{issue.message}</span>
            </div>
          ))}
          <p className="muted">此功能只提供建議，不會修改行程。</p>
          <div className="ai-actions">
            <button type="button" className="ai-secondary" onClick={() => setOutcome(null)}>關閉</button>
          </div>
        </div>
      )}

      {tidied && outcome && (
        <div className="ai-preview">
          <label>整理後的筆記
            <textarea rows={10} value={draftNotepad} onChange={(event) => setDraftNotepad(event.target.value)} />
          </label>
          <div className="ai-actions">
            <button type="button" className="ai-primary" onClick={applyTidy}>套用到筆記</button>
            <button type="button" className="ai-secondary" onClick={() => setOutcome(null)}>捨棄</button>
          </div>
        </div>
      )}

      {answer !== null && (
        <div className="ai-preview">
          <p className="muted">AI 回答（僅供參考，不會修改行程）：</p>
          <div className="ai-answer">{answer}</div>
          <div className="ai-actions">
            <button type="button" className="ai-secondary" onClick={() => setOutcome(null)}>關閉</button>
          </div>
        </div>
      )}
    </section>
  )
}
