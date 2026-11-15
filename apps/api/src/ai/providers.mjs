export class AiInputError extends Error {}
export class AiOutputError extends Error {}
export class AiProviderError extends Error {}

export const aiProviderCatalog = {
  openai_compatible: { label: 'OpenAI 相容 API（可自訂 Base URL）', baseUrl: null },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  anthropic: { label: 'Anthropic Claude', baseUrl: 'https://api.anthropic.com' },
  gemini: { label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com' },
}

const aiProviderIds = Object.keys(aiProviderCatalog)
const maxModelCharacters = 120
const maxBaseUrlCharacters = 300
const maxApiKeyCharacters = 500
const anthropicMaxTokens = 8192
const providerTimeoutMs = 90000

export function aiProviderOptions() {
  return aiProviderIds.map((id) => ({
    id,
    label: aiProviderCatalog[id].label,
    baseUrl: aiProviderCatalog[id].baseUrl,
    baseUrlEditable: aiProviderCatalog[id].baseUrl === null,
  }))
}

export function parseAiSettingsInput(body) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new AiInputError('AI 設定格式不正確。')
  if (!aiProviderIds.includes(body.provider)) throw new AiInputError('請選擇支援的 AI 服務商。')
  const model = typeof body.model === 'string' ? body.model.trim() : ''
  if (!model || model.length > maxModelCharacters) throw new AiInputError(`模型名稱不可空白，且不可超過 ${maxModelCharacters} 字元。`)
  if (body.apiKey !== undefined && typeof body.apiKey !== 'string') throw new AiInputError('API Key 格式不正確。')
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
  if (apiKey.length > maxApiKeyCharacters) throw new AiInputError('API Key 過長。')
  return {
    provider: body.provider,
    baseUrl: normalizeProviderBaseUrl(body.provider, body.baseUrl),
    model,
    apiKey,
    clearApiKey: body.clearApiKey === true,
  }
}

export function normalizeProviderBaseUrl(provider, value) {
  if (aiProviderCatalog[provider].baseUrl !== null) return null
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxBaseUrlCharacters) {
    throw new AiInputError('OpenAI 相容 API 需要填寫 Base URL（例如 https://api.openai.com/v1）。')
  }
  let url
  try {
    url = new URL(value.trim())
  } catch {
    throw new AiInputError('Base URL 格式不正確。')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new AiInputError('Base URL 必須是 https:// 開頭，且不可包含帳密、查詢字串或 #。')
  }
  return url.href.replace(/\/+$/, '')
}

export function buildProviderRequest({ provider, baseUrl, model, apiKey, system, user }) {
  if (provider === 'openai_compatible' || provider === 'openrouter') {
    const root = provider === 'openrouter' ? aiProviderCatalog.openrouter.baseUrl : baseUrl
    return {
      url: `${root}/chat/completions`,
      headers: { Authorization: `Bearer ${apiKey}` },
      body: {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      },
    }
  }
  if (provider === 'anthropic') {
    return {
      url: `${aiProviderCatalog.anthropic.baseUrl}/v1/messages`,
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: {
        model,
        max_tokens: anthropicMaxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      },
    }
  }
  return {
    url: `${aiProviderCatalog.gemini.baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    headers: { 'x-goog-api-key': apiKey },
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { responseMimeType: 'application/json' },
    },
  }
}

function extractText(provider, payload) {
  let text = ''
  if (provider === 'anthropic') {
    text = Array.isArray(payload?.content)
      ? payload.content.filter((block) => block?.type === 'text').map((block) => String(block.text ?? '')).join('')
      : ''
  } else if (provider === 'gemini') {
    text = Array.isArray(payload?.candidates?.[0]?.content?.parts)
      ? payload.candidates[0].content.parts.map((part) => String(part?.text ?? '')).join('')
      : ''
  } else {
    const content = payload?.choices?.[0]?.message?.content
    text = typeof content === 'string' ? content : ''
  }
  if (!text.trim()) throw new AiProviderError('AI 服務商沒有回傳文字內容。')
  return text
}

function providerStatusMessage(status) {
  if (status === 401 || status === 403) return 'API Key 無效或沒有權限'
  if (status === 404) return '找不到指定的模型，或 Base URL 不正確'
  if (status === 429) return '已達 AI 服務商的速率或額度限制'
  return `AI 服務商回應 HTTP ${status}`
}

export async function callAiProvider({ provider, baseUrl, model, apiKey, system, user, fetchImpl = fetch }) {
  const request = buildProviderRequest({ provider, baseUrl, model, apiKey, system, user })
  let response
  try {
    response = await fetchImpl(request.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...request.headers },
      body: JSON.stringify(request.body),
      redirect: 'error',
      signal: AbortSignal.timeout(providerTimeoutMs),
    })
  } catch {
    throw new AiProviderError('無法連線到 AI 服務商，請確認網路與 Base URL 設定。')
  }
  if (!response.ok) throw new AiProviderError(`${providerStatusMessage(response.status)}。`)
  const payload = await response.json().catch(() => null)
  return extractText(provider, payload)
}

export function parseJsonObject(text) {
  const cleaned = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) throw new AiOutputError('AI 回傳的內容不是 JSON 物件。')
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    throw new AiOutputError('AI 回傳的 JSON 無法解析，請再試一次。')
  }
}
