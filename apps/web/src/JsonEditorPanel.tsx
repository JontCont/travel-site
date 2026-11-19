import { useState, useRef, useCallback } from 'react'
import Editor, { loader, type OnMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import {
  isTripDto,
  isTripWorkspaceDto,
  listDates,
  isLocalDate,
  type Trip,
  type TripWorkspace,
} from '@travel/shared'
import {
  BoltIcon,
  CheckIcon,
  CloseIcon,
  CodeBracesIcon,
  RotateCcwIcon,
  SaveIcon,
} from './Icons'

// Use locally installed monaco-editor for offline/private deployment
loader.config({ monaco })

export interface JsonEditorPanelProps {
  workspace: TripWorkspace
  activeTrip: Trip
  onUpdateTrip: (updatedTrip: Trip) => void
  onUpdateWorkspace: (updatedWorkspace: TripWorkspace) => void
}

type EditorMode = 'trip' | 'workspace'

interface ValidationResult {
  valid: boolean
  errors: string[]
}

function validateTripDetailed(parsed: unknown): ValidationResult {
  const errors: string[] = []
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { valid: false, errors: ['JSON 根層級必須是一個物件 ({ ... })'] }
  }

  const obj = parsed as Record<string, unknown>

  if (typeof obj.id !== 'string' || !obj.id.trim()) {
    errors.push('缺少旅程 ID (id 必須為非空字串)')
  }
  if (typeof obj.title !== 'string' || !obj.title.trim()) {
    errors.push('缺少旅程標題 (title 必須為非空字串)')
  }
  if (typeof obj.destination !== 'string' || !obj.destination.trim()) {
    errors.push('缺少目的地 (destination 必須為非空字串)')
  }
  if (typeof obj.country !== 'string') {
    errors.push('國家名稱 (country) 必須為字串')
  }
  if (typeof obj.startDate !== 'string' || !isLocalDate(obj.startDate)) {
    errors.push('開始日期 (startDate) 格式必須為 YYYY-MM-DD')
  }
  if (typeof obj.endDate !== 'string' || !isLocalDate(obj.endDate)) {
    errors.push('結束日期 (endDate) 格式必須為 YYYY-MM-DD')
  }
  if (
    typeof obj.startDate === 'string' &&
    typeof obj.endDate === 'string' &&
    isLocalDate(obj.startDate) &&
    isLocalDate(obj.endDate) &&
    obj.endDate < obj.startDate
  ) {
    errors.push('結束日期 (endDate) 不能早於開始日期 (startDate)')
  }
  if (typeof obj.timeZone !== 'string' || !obj.timeZone.trim()) {
    errors.push('時區 (timeZone) 必須為非空字串，例如 "Asia/Tokyo" 或 "Asia/Shanghai"')
  }
  if (!Array.isArray(obj.travelers)) {
    errors.push('同行旅客 (travelers) 必須為陣列')
  }

  if (
    typeof obj.startDate === 'string' &&
    typeof obj.endDate === 'string' &&
    isLocalDate(obj.startDate) &&
    isLocalDate(obj.endDate) &&
    obj.startDate <= obj.endDate
  ) {
    if (typeof obj.days !== 'object' || obj.days === null || Array.isArray(obj.days)) {
      errors.push('每日行程 (days) 必須為物件，以日期字串為 key')
    } else {
      const days = obj.days as Record<string, unknown>
      const expectedDates = listDates(obj.startDate, obj.endDate)
      for (const date of expectedDates) {
        if (!(date in days)) {
          errors.push(`days 物件缺少日期 key: "${date}"`)
        } else if (!Array.isArray(days[date])) {
          errors.push(`days["${date}"] 必須為景點項目陣列`)
        }
      }
    }
  }

  // Final check using shared schema
  if (errors.length === 0 && !isTripDto(parsed)) {
    errors.push('旅程資料結構不符合 Trip 定義（請檢查住宿、航班或行李等選用欄位格式）')
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

function validateWorkspaceDetailed(parsed: unknown): ValidationResult {
  const errors: string[] = []
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { valid: false, errors: ['JSON 根層級必須是一個物件 ({ ... })'] }
  }

  const obj = parsed as Record<string, unknown>
  if (!Array.isArray(obj.trips) || obj.trips.length === 0) {
    errors.push('trips 必須為包含至少一筆旅程的陣列')
  } else {
    obj.trips.forEach((item, index) => {
      const res = validateTripDetailed(item)
      if (!res.valid) {
        errors.push(`旅程 #${index + 1} (${(item as Record<string, unknown>)?.title ?? '未知'}) 驗證失敗: ${res.errors.join('; ')}`)
      }
    })
  }

  if (typeof obj.activeTripId !== 'string' || !obj.activeTripId) {
    errors.push('缺少 activeTripId (必須為字串)')
  } else if (Array.isArray(obj.trips) && !obj.trips.some((t) => (t as Record<string, unknown>)?.id === obj.activeTripId)) {
    errors.push(`activeTripId "${obj.activeTripId}" 在 trips 陣列中找不到對應的旅程 ID`)
  }

  if (errors.length === 0 && !isTripWorkspaceDto(parsed)) {
    errors.push('工作區結構不符合 TripWorkspace 定義')
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

export function JsonEditorPanel({
  workspace,
  activeTrip,
  onUpdateTrip,
  onUpdateWorkspace,
}: JsonEditorPanelProps) {
  const [mode, setMode] = useState<EditorMode>('trip')
  const getInitialText = useCallback(
    (targetMode: EditorMode) =>
      targetMode === 'trip' ? JSON.stringify(activeTrip, null, 2) : JSON.stringify(workspace, null, 2),
    [activeTrip, workspace]
  )

  const [rawText, setRawText] = useState(() => getInitialText('trip'))
  const [dirty, setDirty] = useState(false)
  const [saveSuccessNotice, setSaveSuccessNotice] = useState('')
  const [validation, setValidation] = useState<ValidationResult>({ valid: true, errors: [] })
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 })
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)

  const switchMode = (nextMode: EditorMode) => {
    if (dirty && !window.confirm('有未儲存的變更，確定切換嗎？')) return
    setMode(nextMode)
    const text = getInitialText(nextMode)
    setRawText(text)
    if (editorRef.current) {
      editorRef.current.setValue(text)
    }
    setDirty(false)
    setSaveSuccessNotice('')
    setValidation({ valid: true, errors: [] })
  }

  // Real-time validation helper
  const handleContentChange = useCallback((value: string | undefined) => {
    const currentText = value ?? ''
    setRawText(currentText)
    setDirty(true)
    setSaveSuccessNotice('')

    try {
      const parsed = JSON.parse(currentText)
      const res = mode === 'trip' ? validateTripDetailed(parsed) : validateWorkspaceDetailed(parsed)
      setValidation(res)
    } catch (e) {
      setValidation({
        valid: false,
        errors: [`JSON 語法錯誤: ${(e as Error).message}`],
      })
    }
  }, [mode])

  // Save handler
  const handleSave = () => {
    try {
      const parsed = JSON.parse(rawText)
      const res = mode === 'trip' ? validateTripDetailed(parsed) : validateWorkspaceDetailed(parsed)
      if (!res.valid) {
        setValidation(res)
        return
      }

      if (mode === 'trip') {
        onUpdateTrip(parsed as Trip)
      } else {
        onUpdateWorkspace(parsed as TripWorkspace)
      }

      setDirty(false)
      setValidation({ valid: true, errors: [] })
      setSaveSuccessNotice('✓ 行程已儲存並自動同步至 SQLite 資料庫！')
      setTimeout(() => setSaveSuccessNotice(''), 4000)
    } catch (e) {
      setValidation({
        valid: false,
        errors: [`無法儲存：JSON 語法錯誤 - ${(e as Error).message}`],
      })
    }
  }

  // Prettify / Format
  const handlePrettify = () => {
    try {
      const parsed = JSON.parse(rawText)
      const formatted = JSON.stringify(parsed, null, 2)
      setRawText(formatted)
      if (editorRef.current) {
        editorRef.current.setValue(formatted)
      }
    } catch {
      // Keep as-is if invalid JSON
    }
  }

  // Reset to original
  const handleReset = () => {
    const text = getInitialText(mode)
    setRawText(text)
    if (editorRef.current) {
      editorRef.current.setValue(text)
    }
    setDirty(false)
    setValidation({ valid: true, errors: [] })
    setSaveSuccessNotice('')
  }

  // Monaco mount callback
  const handleEditorDidMount: OnMount = (editor, monacoInstance) => {
    editorRef.current = editor

    // Track cursor position
    editor.onDidChangeCursorPosition((e) => {
      setCursorPos({ line: e.position.lineNumber, col: e.position.column })
    })

    // Keyboard shortcut: Ctrl+S or Cmd+S to Save
    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
      handleSave()
    })
  }

  return (
    <div className="vscode-editor-container">
      {/* VS Code Title / Tabs Bar */}
      <div className="vscode-titlebar">
        <div className="vscode-tabs">
          <div className="vscode-tab active">
            <span className="vscode-tab-icon"><CodeBracesIcon size={15} /></span>
            <span className="vscode-tab-title">
              {mode === 'trip' ? `trip-${activeTrip.id.slice(0, 8)}.json` : 'workspace.json'}
            </span>
            {dirty && <span className="vscode-dirty-dot" title="未儲存的變更">●</span>}
          </div>
        </div>

        {/* Mode Switcher */}
        <div className="vscode-mode-switch">
          <button
            type="button"
            className={mode === 'trip' ? 'active' : ''}
            onClick={() => switchMode('trip')}
          >
            當前旅程 ({activeTrip.destination})
          </button>
          <button
            type="button"
            className={mode === 'workspace' ? 'active' : ''}
            onClick={() => switchMode('workspace')}
          >
            全部工作區 (Workspace)
          </button>
        </div>

        {/* Actions Toolbar */}
        <div className="vscode-toolbar">
          <button
            type="button"
            className="vscode-btn"
            onClick={handlePrettify}
            title="格式化 JSON (排版對齊)"
          >
            <BoltIcon size={13} /> 格式化
          </button>
          <button
            type="button"
            className="vscode-btn"
            onClick={handleReset}
            disabled={!dirty}
            title="還原回上次儲存的內容"
          >
            <RotateCcwIcon size={13} /> 還原
          </button>
          <button
            type="button"
            className="vscode-btn vscode-btn-primary"
            onClick={handleSave}
            title="儲存並同步至行程 (Ctrl+S)"
          >
            <SaveIcon size={13} /> 儲存並套用
          </button>
        </div>
      </div>

      {/* Success Notification */}
      {saveSuccessNotice && (
        <div className="vscode-alert vscode-alert-success">
          {saveSuccessNotice}
        </div>
      )}

      {/* Editor Main */}
      <div className="vscode-editor-body">
        <Editor
          height="100%"
          language="json"
          theme="vs-dark"
          value={rawText}
          onChange={handleContentChange}
          onMount={handleEditorDidMount}
          options={{
            automaticLayout: true,
            fontSize: 13,
            lineNumbers: 'on',
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            tabSize: 2,
            wordWrap: 'on',
            formatOnPaste: true,
            formatOnType: true,
            bracketPairColorization: { enabled: true },
            suggest: { showWords: false },
          }}
        />
      </div>

      {/* Problem / Error Panel if invalid */}
      {!validation.valid && (
        <div className="vscode-problems-panel">
          <div className="vscode-problems-header">
            <span className="error-icon"><CloseIcon size={10} /></span>
            <strong>驗證未通過 ({validation.errors.length} 項問題)：</strong>
          </div>
          <ul className="vscode-problems-list">
            {validation.errors.map((err, idx) => (
              <li key={idx}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* VS Code Status Bar */}
      <div className={`vscode-statusbar ${!validation.valid ? 'status-error' : dirty ? 'status-dirty' : 'status-clean'}`}>
        <div className="vscode-statusbar-left">
          <span className="status-item">
            {validation.valid ? (
              dirty ? (
                <>● 尚未儲存 (按 Ctrl+S 儲存)</>
              ) : (
                <><CheckIcon size={12} /> JSON 格式與結構驗證通過</>
              )
            ) : (
              <><CloseIcon size={12} /> 結構或語法有誤 ({validation.errors.length} 個問題)</>
            )}
          </span>
          <span className="status-item">模式：{mode === 'trip' ? '單一旅程' : '完整資料庫'}</span>
        </div>

        <div className="vscode-statusbar-right">
          <span className="status-item">第 {cursorPos.line} 行，第 {cursorPos.col} 欄</span>
          <span className="status-item">縮排: 2 空格</span>
          <span className="status-item">UTF-8</span>
          <span className="status-item">JSON</span>
        </div>
      </div>
    </div>
  )
}
