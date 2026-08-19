/**
 * AI provider layer.
 *
 * Every network call happens here, in the main process, so API keys are never
 * exposed to renderer code or to anything running in the page. Model lists are
 * fetched live from each provider rather than hard-coded, so the app does not
 * go stale as providers rename their models.
 *
 * Privacy: nothing is sent anywhere unless the user picks a cloud provider and
 * supplies their own key. The Ollama provider talks only to localhost, so a
 * user who chooses it never transmits document text off the machine.
 */
import { getSettings } from './store'
import { open as openSecret } from './secrets'

export type ProviderId = 'ollama' | 'anthropic' | 'openai' | 'gemini'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  provider: ProviderId
  model: string
  system: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
}

export interface ChatResponse {
  ok: boolean
  text?: string
  error?: string
  code?: string
  model?: string
}

export interface ModelsResponse {
  ok: boolean
  models?: string[]
  error?: string
  code?: string
}

export const OLLAMA_URL = 'http://127.0.0.1:11434'

/** Shown when a provider's model list cannot be reached. */
const FALLBACK_MODELS: Record<ProviderId, string[]> = {
  ollama: [],
  anthropic: ['claude-sonnet-4-5', 'claude-opus-4-5', 'claude-haiku-4-5'],
  openai: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash']
}

export function keyName(provider: ProviderId): 'anthropic' | 'openai' | 'gemini' | null {
  return provider === 'ollama' ? null : provider
}

function storedKey(provider: ProviderId): string {
  const name = keyName(provider)
  if (!name) return ''
  const keys = getSettings().aiKeys ?? {}
  return openSecret(keys[name] ?? '')
}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fn(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

function friendlyError(err: unknown): string {
  const msg = String((err as Error)?.message ?? err)
  if (/abort/i.test(msg)) return 'The request timed out.'
  if (/ECONNREFUSED|fetch failed/i.test(msg)) return 'Could not reach the service.'
  return msg
}

/* ------------------------------------------------------------------ models */

export async function listModels(provider: ProviderId): Promise<ModelsResponse> {
  const key = storedKey(provider)
  if (provider !== 'ollama' && !key) {
    return { ok: false, code: 'NO_KEY', error: `No ${provider} API key has been saved yet.` }
  }

  try {
    return await withTimeout(async (signal) => {
      if (provider === 'ollama') {
        const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal })
        if (!r.ok) return { ok: false, code: 'OLLAMA_DOWN', error: `Ollama replied ${r.status}.` }
        const data = (await r.json()) as { models?: Array<{ name: string }> }
        const models = (data.models ?? []).map((m) => m.name)
        if (!models.length) {
          return {
            ok: false,
            code: 'NO_MODELS',
            error: 'Ollama is running but has no models. Pull one first, for example: ollama pull llama3.1'
          }
        }
        return { ok: true, models }
      }

      if (provider === 'anthropic') {
        const r = await fetch('https://api.anthropic.com/v1/models?limit=100', {
          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          signal
        })
        if (!r.ok) return { ok: false, code: r.status === 401 ? 'BAD_KEY' : 'HTTP', error: `Anthropic replied ${r.status}.` }
        const data = (await r.json()) as { data?: Array<{ id: string }> }
        return { ok: true, models: (data.data ?? []).map((m) => m.id) }
      }

      if (provider === 'openai') {
        const r = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
          signal
        })
        if (!r.ok) return { ok: false, code: r.status === 401 ? 'BAD_KEY' : 'HTTP', error: `OpenAI replied ${r.status}.` }
        const data = (await r.json()) as { data?: Array<{ id: string }> }
        return {
          ok: true,
          models: (data.data ?? [])
            .map((m) => m.id)
            .filter((id) => /^(gpt|o\d|chatgpt)/i.test(id))
            .sort()
        }
      }

      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`, { signal })
      if (!r.ok) return { ok: false, code: r.status === 400 || r.status === 403 ? 'BAD_KEY' : 'HTTP', error: `Gemini replied ${r.status}.` }
      const data = (await r.json()) as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> }
      return {
        ok: true,
        models: (data.models ?? [])
          .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
          .map((m) => m.name.replace(/^models\//, ''))
      }
    }, 20_000)
  } catch (err) {
    return { ok: false, code: 'NETWORK', error: friendlyError(err), models: FALLBACK_MODELS[provider] }
  }
}

/* -------------------------------------------------------------------- chat */

export async function chat(req: ChatRequest): Promise<ChatResponse> {
  const key = storedKey(req.provider)
  if (req.provider !== 'ollama' && !key) {
    return { ok: false, code: 'NO_KEY', error: `No ${req.provider} API key has been saved yet.` }
  }
  if (!req.model) return { ok: false, code: 'NO_MODEL', error: 'No model selected.' }

  const maxTokens = req.maxTokens ?? 2048
  const temperature = req.temperature ?? 0.2

  try {
    return await withTimeout(async (signal) => {
      if (req.provider === 'ollama') {
        const r = await fetch(`${OLLAMA_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({
            model: req.model,
            stream: false,
            options: { temperature, num_predict: maxTokens },
            messages: [{ role: 'system', content: req.system }, ...req.messages]
          })
        })
        if (!r.ok) return { ok: false, code: 'HTTP', error: `Ollama replied ${r.status}: ${(await r.text()).slice(0, 300)}` }
        const data = (await r.json()) as { message?: { content?: string } }
        return { ok: true, text: data.message?.content ?? '', model: req.model }
      }

      if (req.provider === 'anthropic') {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01'
          },
          signal,
          body: JSON.stringify({
            model: req.model,
            max_tokens: maxTokens,
            temperature,
            system: req.system,
            messages: req.messages
          })
        })
        const data = (await r.json()) as {
          content?: Array<{ type: string; text?: string }>
          error?: { message?: string }
        }
        if (!r.ok) {
          return { ok: false, code: r.status === 401 ? 'BAD_KEY' : 'HTTP', error: data.error?.message ?? `Anthropic replied ${r.status}.` }
        }
        const text = (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('')
        return { ok: true, text, model: req.model }
      }

      if (req.provider === 'openai') {
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          signal,
          body: JSON.stringify({
            model: req.model,
            temperature,
            max_completion_tokens: maxTokens,
            messages: [{ role: 'system', content: req.system }, ...req.messages]
          })
        })
        const data = (await r.json()) as {
          choices?: Array<{ message?: { content?: string } }>
          error?: { message?: string }
        }
        if (!r.ok) {
          return { ok: false, code: r.status === 401 ? 'BAD_KEY' : 'HTTP', error: data.error?.message ?? `OpenAI replied ${r.status}.` }
        }
        return { ok: true, text: data.choices?.[0]?.message?.content ?? '', model: req.model }
      }

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${req.model}:generateContent?key=${encodeURIComponent(key)}`
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          generationConfig: { temperature, maxOutputTokens: maxTokens },
          contents: req.messages.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
          }))
        })
      })
      const data = (await r.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
        error?: { message?: string }
      }
      if (!r.ok) {
        return { ok: false, code: r.status === 400 || r.status === 403 ? 'BAD_KEY' : 'HTTP', error: data.error?.message ?? `Gemini replied ${r.status}.` }
      }
      const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
      return { ok: true, text, model: req.model }
    }, 180_000)
  } catch (err) {
    return { ok: false, code: 'NETWORK', error: friendlyError(err) }
  }
}

/* --------------------------------------------------------------- vision OCR */

const OCR_PROMPT =
  'Perform full OCR text extraction on this image. Transcribe all text accurately into clean Markdown. ' +
  'If there are charts, tables, diagrams or graphics, describe them beneath the text so a reader who ' +
  'cannot see the image still understands the visual structure. Do not wrap your whole answer in a code fence.'

/** Model names change; try in order and use whichever the account can reach. */
const VISION_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest', 'gemini-1.5-flash']

export async function visionOcr(
  key: string,
  base64Image: string,
  mimeType: string
): Promise<{ ok: boolean; text?: string; error?: string; code?: string; model?: string }> {
  const payload = {
    contents: [
      {
        parts: [{ inlineData: { mimeType, data: base64Image } }, { text: OCR_PROMPT }]
      }
    ]
  }

  let lastError = 'No Gemini model could be reached.'
  for (const model of VISION_MODELS) {
    try {
      const r = await withTimeout(
        (signal) =>
          fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
              signal
            }
          ),
        180_000
      )
      const data = (await r.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
        error?: { message?: string }
      }
      if (r.ok) {
        const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
        if (text.trim()) return { ok: true, text, model }
        lastError = 'Gemini returned no readable content.'
        continue
      }
      lastError = data.error?.message ?? `HTTP ${r.status}`
      if (r.status === 400 || r.status === 403) return { ok: false, code: 'BAD_KEY', error: lastError }
    } catch (err) {
      lastError = friendlyError(err)
    }
  }
  return { ok: false, code: 'PROVIDER_ERROR', error: lastError }
}

/** Cheap reachability check used to light up the status dot in the UI. */
export async function status(provider: ProviderId): Promise<{ ready: boolean; detail: string }> {
  if (provider === 'ollama') {
    try {
      const r = await withTimeout((signal) => fetch(`${OLLAMA_URL}/api/tags`, { signal }), 4000)
      if (!r.ok) return { ready: false, detail: `Ollama replied ${r.status}` }
      const data = (await r.json()) as { models?: unknown[] }
      const count = (data.models ?? []).length
      return count
        ? { ready: true, detail: `Ollama running · ${count} model${count > 1 ? 's' : ''}` }
        : { ready: false, detail: 'Ollama running but no models pulled' }
    } catch {
      return { ready: false, detail: 'Ollama not running on this computer' }
    }
  }
  return storedKey(provider)
    ? { ready: true, detail: 'API key saved' }
    : { ready: false, detail: 'No API key saved' }
}
