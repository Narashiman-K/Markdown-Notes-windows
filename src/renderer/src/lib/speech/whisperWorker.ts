/**
 * Whisper speech recognition in a worker, so the page never freezes while a
 * sentence is being read.
 *
 * transformers.js runs the model with WebGPU when the PC has a usable
 * graphics chip, and on the processor (WebAssembly) otherwise. The model is
 * downloaded once and cached: in the browser by the browser's own cache, in
 * the Windows app by the main process (see `remoteHost`), so after the first
 * use dictation works with no connection at all.
 *
 * Messages in:  { type: 'load', model, remoteHost?, useBrowserCache, wasmPaths }
 *               { type: 'transcribe', id, audio, language, translate }
 * Messages out: { type: 'progress', file, loaded, total }
 *               { type: 'ready', device }
 *               { type: 'result', id, text }
 *               { type: 'error', message, id? }
 *
 * Kept identical across the Windows app and the web app.
 */
import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'

interface LoadMessage {
  type: 'load'
  model: string
  remoteHost?: string
  useBrowserCache: boolean
  wasmPaths: string
}
interface TranscribeMessage {
  type: 'transcribe'
  id: number
  audio: Float32Array
  language: string
  translate: boolean
}

let asr: AutomaticSpeechRecognitionPipeline | null = null
let loading: Promise<void> | null = null

const post = (m: unknown): void => (self as unknown as Worker).postMessage(m)

async function hasWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu
    return !!gpu && !!(await gpu.requestAdapter())
  } catch {
    return false
  }
}

async function load(m: LoadMessage): Promise<void> {
  env.allowLocalModels = false
  env.allowRemoteModels = true
  env.useBrowserCache = m.useBrowserCache
  if (m.remoteHost) env.remoteHost = m.remoteHost
  const onnx = env.backends.onnx as unknown as { wasm: { wasmPaths: string; numThreads?: number } }
  onnx.wasm.wasmPaths = m.wasmPaths
  // Threads need cross-origin isolation, which neither host has; one thread
  // is what would be used anyway.
  if (!(self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated) onnx.wasm.numThreads = 1

  const gpu = await hasWebGpu()
  const make = (device: 'webgpu' | 'wasm') =>
    pipeline('automatic-speech-recognition', m.model, {
      device,
      // On the graphics chip the encoder stays full precision (it is where
      // accuracy is decided) and the decoder is 4-bit; on the processor both
      // are 8-bit, which is what makes it fast enough.
      dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : { encoder_model: 'q8', decoder_model_merged: 'q8' },
      progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status === 'progress') post({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total })
      }
    }) as Promise<AutomaticSpeechRecognitionPipeline>

  let device: 'webgpu' | 'wasm' = gpu ? 'webgpu' : 'wasm'
  try {
    asr = await make(device)
  } catch (err) {
    if (device !== 'webgpu') throw err
    device = 'wasm'
    asr = await make(device)
  }
  // A first, tiny run compiles the GPU shaders now rather than on the first
  // sentence the user speaks.
  await asr(new Float32Array(16000), { language: 'en' })
  post({ type: 'ready', device })
}

self.onmessage = async (e: MessageEvent<LoadMessage | TranscribeMessage>) => {
  const m = e.data
  if (m.type === 'load') {
    try {
      loading ??= load(m)
      await loading
    } catch (err) {
      loading = null
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
    return
  }
  try {
    if (!asr) throw new Error('The speech model is not loaded yet.')
    const out = (await asr(m.audio, {
      ...(m.language === 'auto' ? {} : { language: m.language }),
      task: m.translate ? 'translate' : 'transcribe'
    })) as { text: string } | Array<{ text: string }>
    const text = Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text
    post({ type: 'result', id: m.id, text })
  } catch (err) {
    post({ type: 'error', id: m.id, message: err instanceof Error ? err.message : String(err) })
  }
}
