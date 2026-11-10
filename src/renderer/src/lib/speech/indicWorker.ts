/**
 * Indian-language speech recognition in a worker: AI4Bharat's IndicConformer
 * (one model per language, ~140 MB, int8), run with ONNX Runtime.
 *
 * Whisper's small models are weak on Indian languages: they drift into
 * English or another script, and miss words. IndicConformer is trained on
 * thousands of hours of Indian speech per language and is markedly better,
 * at a similar size. Whisper stays in charge of English and other languages.
 *
 * Messages in:  { type: 'load', language, wasmPaths }
 *               { type: 'transcribe', id, audio }
 * Messages out: { type: 'progress', file, loaded, total } · { type: 'ready', device }
 *               { type: 'result', id, text } · { type: 'error', message, id? }
 *
 * Kept identical across the Windows app and the web app.
 */
import * as ort from 'onnxruntime-web/webgpu'
import { logMel, ctcGreedy } from './melFeatures'

const REPO = (lang: string): string => `https://huggingface.co/OpenVoiceOS/ai4bharat-indicconformer-${lang}-onnx/resolve/main/`
const CACHE = 'indic-asr-cache'

let session: ort.InferenceSession | null = null
let vocab: string[] = []
let features = 80

const post = (m: unknown): void => (self as unknown as Worker).postMessage(m)

/** Fetches a model file once, keeping it in the browser cache with progress. */
async function cachedBytes(url: string, file: string): Promise<Uint8Array> {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(url)
  if (hit) return new Uint8Array(await hit.arrayBuffer())
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`Could not download the speech model (${res.status}).`)
  const total = Number(res.headers.get('content-length') ?? 0)
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    loaded += value.length
    post({ type: 'progress', file, loaded, total })
  }
  const bytes = new Uint8Array(loaded)
  let at = 0
  for (const p of parts) {
    bytes.set(p, at)
    at += p.length
  }
  await cache.put(url, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } }))
  return bytes
}

async function load(language: string, wasmPaths: string): Promise<string> {
  ort.env.wasm.wasmPaths = wasmPaths
  if (!(self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated) ort.env.wasm.numThreads = 1
  const base = REPO(language)
  const config = JSON.parse(new TextDecoder().decode(await cachedBytes(base + 'config.json', 'config.json'))) as { features_size?: number }
  features = config.features_size ?? 80
  // vocab.txt: "token id" per line; the CTC blank is the id after the last.
  const lines = new TextDecoder().decode(await cachedBytes(base + 'vocab.txt', 'vocab.txt')).split(/\r?\n/).filter(Boolean)
  vocab = []
  for (const line of lines) {
    const sp = line.lastIndexOf(' ')
    vocab[Number(line.slice(sp + 1))] = line.slice(0, sp)
  }
  const model = await cachedBytes(base + 'model.int8.onnx', 'model.int8.onnx')
  // int8 weights run best on the processor; WebGPU has no int8 kernels for
  // most of these operators.
  session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] })
  return 'wasm'
}

async function transcribe(audio: Float32Array): Promise<string> {
  if (!session) throw new Error('The speech model is not loaded yet.')
  const { data, frames } = logMel(audio, features)
  const inputs: Record<string, ort.Tensor> = {}
  const [sig, len] = session.inputNames
  inputs[sig] = new ort.Tensor('float32', data, [1, features, frames])
  inputs[len] = new ort.Tensor('int64', BigInt64Array.from([BigInt(frames)]), [1])
  const out = await session.run(inputs)
  const logits = out[session.outputNames[0]]
  const [, steps, size] = logits.dims as number[]
  // The blank is the last class, whether or not vocab.txt lists it.
  return ctcGreedy(logits.data as Float32Array, steps, size, vocab, size - 1)
}

let loading: Promise<string> | null = null

self.onmessage = async (e: MessageEvent<{ type: string; [k: string]: unknown }>) => {
  const m = e.data
  if (m.type === 'load') {
    try {
      loading ??= load(String(m.language), String(m.wasmPaths))
      post({ type: 'ready', device: await loading })
    } catch (err) {
      loading = null
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
    return
  }
  try {
    post({ type: 'result', id: m.id, text: await transcribe(m.audio as Float32Array) })
  } catch (err) {
    post({ type: 'error', id: m.id, message: err instanceof Error ? err.message : String(err) })
  }
}
