/**
 * Audio transcription via AssemblyAI.
 *
 * This is the one converter that cannot run locally: speech recognition of any
 * useful quality needs either a cloud service or a multi-gigabyte local model,
 * and bundling the latter would triple the installer. So audio is explicitly a
 * cloud feature, the user supplies their own key, and the UI says so plainly.
 *
 * Runs in the main process so the key never reaches renderer code.
 */
import { getSettings } from './store'
import { open as openSecret } from './secrets'

const BASE = 'https://api.assemblyai.com/v2'

export interface TranscribeResult {
  ok: boolean
  text?: string
  error?: string
  code?: string
  meta?: { seconds?: number; words?: number }
}

export type Progress = (message: string, fraction?: number) => void

function friendly(status: number, body: string): string {
  if (status === 401) return 'That AssemblyAI key was rejected. Check it and try again.'
  if (status === 400 && /audio/i.test(body)) return 'The service could not read this audio file.'
  if (status === 429) return 'AssemblyAI rate limit reached. Wait a moment and try again.'
  return `AssemblyAI replied ${status}: ${body.slice(0, 200)}`
}

export async function transcribe(
  bytes: Uint8Array,
  onProgress: Progress,
  signal?: AbortSignal
): Promise<TranscribeResult> {
  const key = openSecret(getSettings().aiKeys.assemblyai ?? '')
  if (!key) {
    return { ok: false, code: 'NO_KEY', error: 'No AssemblyAI API key has been saved.' }
  }

  try {
    // 1 — upload the audio
    onProgress('Uploading the audio…', 0.1)
    const upload = await fetch(`${BASE}/upload`, {
      method: 'POST',
      headers: { authorization: key, 'content-type': 'application/octet-stream' },
      body: Buffer.from(bytes),
      signal
    })
    if (!upload.ok) {
      return { ok: false, code: 'UPLOAD_FAILED', error: friendly(upload.status, await upload.text()) }
    }
    const { upload_url: audioUrl } = (await upload.json()) as { upload_url: string }

    // 2 — request a transcript
    onProgress('Queued for transcription…', 0.3)
    const created = await fetch(`${BASE}/transcript`, {
      method: 'POST',
      headers: { authorization: key, 'content-type': 'application/json' },
      body: JSON.stringify({ audio_url: audioUrl, punctuate: true, format_text: true }),
      signal
    })
    if (!created.ok) {
      return { ok: false, code: 'REQUEST_FAILED', error: friendly(created.status, await created.text()) }
    }
    const { id } = (await created.json()) as { id: string }

    // 3 — poll until it finishes. Transcription is roughly real-time/20, but
    // queue time varies, so this waits generously rather than guessing.
    const deadline = Date.now() + 30 * 60_000
    let waited = 0
    while (Date.now() < deadline) {
      if (signal?.aborted) return { ok: false, code: 'CANCELLED', error: 'Cancelled.' }
      await new Promise((r) => setTimeout(r, 3000))
      waited += 3

      const poll = await fetch(`${BASE}/transcript/${id}`, { headers: { authorization: key }, signal })
      if (!poll.ok) {
        return { ok: false, code: 'POLL_FAILED', error: friendly(poll.status, await poll.text()) }
      }
      const data = (await poll.json()) as {
        status: string
        text?: string
        error?: string
        audio_duration?: number
        words?: unknown[]
      }

      if (data.status === 'completed') {
        const text = (data.text ?? '').trim()
        if (!text) return { ok: false, code: 'EMPTY', error: 'No speech was detected in this file.' }
        return {
          ok: true,
          text,
          meta: { seconds: data.audio_duration, words: data.words?.length }
        }
      }
      if (data.status === 'error') {
        return { ok: false, code: 'PROVIDER_ERROR', error: data.error ?? 'Transcription failed.' }
      }
      onProgress(`Transcribing… (${waited}s)`, Math.min(0.9, 0.3 + waited / 300))
    }

    return { ok: false, code: 'TIMEOUT', error: 'Transcription did not finish within 30 minutes.' }
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      return { ok: false, code: 'CANCELLED', error: 'Cancelled.' }
    }
    return { ok: false, code: 'NETWORK', error: String((err as Error)?.message ?? err) }
  }
}
