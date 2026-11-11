/**
 * Natural English voices: Kokoro-82M (Apache-2.0), run on the processor with
 * ONNX Runtime in a worker, so the page never stutters while a sentence is
 * being made.
 *
 * Only a handful of voices are offered (the best-rated American and British,
 * female and male), each a 0.5 MB style file fetched when first used. The
 * model is downloaded once (114 MB, uint8f16, run on the graphics chip) and
 * kept in the cache; `bundled` reads it from the app's own files instead.
 *
 * Messages in:  { type: 'load', bundled, base, wasmPaths }
 *               { type: 'speak', id, text, voice, speed }
 * Messages out: { type: 'progress', file, loaded, total } · { type: 'ready' }
 *               { type: 'audio', id, samples (Float32Array), rate } · { type: 'error', message, id? }
 *
 * Kept identical across the Windows app and the web app.
 */
import { KokoroTTS, env as kokoroEnv } from 'kokoro-js'
import { env } from '@huggingface/transformers'

export const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX'

let tts: KokoroTTS | null = null
let loading: Promise<void> | null = null
const post = (m: unknown, transfer: Transferable[] = []): void => (self as unknown as Worker).postMessage(m, transfer)

/**
 * kokoro-js reads voice files from Hugging Face through the "kokoro-voices"
 * cache; putting the bundled copies there first means it never goes online.
 */
async function primeVoices(base: string, voices: string[]): Promise<void> {
  const cache = await caches.open('kokoro-voices')
  for (const v of voices) {
    const key = `https://huggingface.co/${KOKORO_MODEL}/resolve/main/voices/${v}.bin`
    if (await cache.match(key)) continue
    const res = await fetch(`${base}${KOKORO_MODEL}/voices/${v}.bin`)
    if (res.ok) await cache.put(key, new Response(await res.arrayBuffer(), { headers: { 'Content-Type': 'application/octet-stream' } }))
  }
}

async function load(m: { bundled: boolean; base: string; wasmPaths: string; voices: string[]; device?: 'webgpu' | 'wasm'; dtype?: string }): Promise<void> {
  kokoroEnv.wasmPaths = m.wasmPaths
  const onnx = env.backends.onnx as unknown as { wasm: { numThreads?: number } }
  if (!(self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated) onnx.wasm.numThreads = 1
  if (m.bundled) {
    // Shipped inside the app: read from the app's own files, never the network.
    env.allowLocalModels = true
    env.allowRemoteModels = false
    env.localModelPath = m.base
    env.useBrowserCache = false
    await primeVoices(m.base, m.voices)
  } else {
    env.allowLocalModels = false
    env.allowRemoteModels = true
    env.useBrowserCache = true
  }
  tts = await KokoroTTS.from_pretrained(KOKORO_MODEL, {
    // 8-bit weights with 16-bit maths on the graphics chip (114 MB, faster
    // than real time). Plain fp16 gives silent (NaN) audio on WebGPU, so it is
    // never used. 8-bit on the processor is the fallback, and much slower.
    dtype: (m.dtype ?? (m.device === 'webgpu' ? 'uint8f16' : 'q8')) as 'q8',
    device: m.device ?? 'wasm',
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status === 'progress') post({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total })
    }
  })
}

self.onmessage = async (e: MessageEvent<{ type: string; [k: string]: unknown }>) => {
  const m = e.data
  if (m.type === 'load') {
    try {
      loading ??= load(m as unknown as Parameters<typeof load>[0])
      await loading
      post({ type: 'ready' })
    } catch (err) {
      loading = null
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
    return
  }
  try {
    if (!tts) throw new Error('The voice is not loaded yet.')
    const audio = await tts.generate(String(m.text), { voice: String(m.voice) as never, speed: Number(m.speed) || 1 })
    const samples = audio.audio as Float32Array
    // A broken graphics driver can return NaN samples, which play as silence:
    // report it so the reader falls back to the computer's voices.
    let bad = 0
    for (let i = 0; i < samples.length; i += 97) if (Number.isNaN(samples[i])) bad++
    if (bad > samples.length / 97 / 4) throw new Error('The natural voice produced no sound on this graphics chip.')
    post({ type: 'audio', id: m.id, samples, rate: audio.sampling_rate }, [samples.buffer])
  } catch (err) {
    post({ type: 'error', id: m.id, message: err instanceof Error ? err.message : String(err) })
  }
}
