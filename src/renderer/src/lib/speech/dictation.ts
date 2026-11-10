/**
 * Dictation: microphone → utterances → Whisper → text at the cursor.
 *
 * Platform-neutral. The caller says where models come from (`remoteHost`:
 * the Windows app routes downloads through its main process, which keeps a
 * copy on disk) and receives actions to apply to the editor.
 *
 * Audio is captured at 16 kHz mono (what Whisper expects), with the browser's
 * echo cancellation and noise suppression on, cut at pauses by `VadSegmenter`
 * and transcribed one utterance at a time, in order. Nothing is recorded or
 * kept: each utterance is dropped once it has been read.
 *
 * Kept identical across the Windows app and the web app.
 */
import { VadSegmenter } from './vad'
import { cleanTranscript, toActions, type DictationAction } from './commands'

export type DictationModel = 'base' | 'small'
export type DictationState = 'idle' | 'loading' | 'listening' | 'transcribing' | 'error'

export const MODEL_IDS: Record<DictationModel, string> = {
  base: 'onnx-community/whisper-base',
  small: 'onnx-community/whisper-small'
}

/** Approximate one-time download, for the user to decide before starting. */
export const MODEL_SIZES_MB: Record<DictationModel, { gpu: number; cpu: number }> = {
  base: { gpu: 125, cpu: 80 },
  small: { gpu: 590, cpu: 250 }
}

export interface DictationSettings {
  model: DictationModel
  language: string
  translate: boolean
  commands: boolean
}

export const DEFAULT_DICTATION: DictationSettings = { model: 'base', language: 'auto', translate: false, commands: true }

/**
 * Indian languages read by AI4Bharat's IndicConformer instead of Whisper.
 * Whisper's small models drift into English or the wrong script on these
 * and miss words; IndicConformer, trained on Indian speech, gets far more
 * right at a similar size (~140 MB per language).
 */
export const INDIC_LANGUAGES = new Set(['hi', 'kn', 'ta', 'te', 'ml', 'mr', 'bn', 'gu', 'pa', 'ur', 'or', 'as', 'ne', 'sa'])
export const INDIC_SIZE_MB = 140

/**
 * Which engine reads this setting. Translation to English, automatic
 * language detection and non-Indian languages stay with Whisper.
 */
export function engineFor(s: DictationSettings): { kind: 'indic'; language: string } | { kind: 'whisper'; model: DictationModel } {
  return INDIC_LANGUAGES.has(s.language) && !s.translate ? { kind: 'indic', language: s.language } : { kind: 'whisper', model: s.model }
}

/** Whether the model this setting needs has been downloaded already (null = unknown). */
export async function modelCachedFor(s: DictationSettings): Promise<boolean | null> {
  try {
    const e = engineFor(s)
    const [cacheName, needle] =
      e.kind === 'indic' ? ['indic-asr-cache', `indicconformer-${e.language}-onnx/resolve/main/model.int8.onnx`] : ['transformers-cache', MODEL_IDS[e.model]]
    const keys = await (await caches.open(cacheName)).keys()
    return keys.some((r) => r.url.includes(needle) && r.url.includes('.onnx'))
  } catch {
    return null
  }
}

const engineKey = (s: DictationSettings): string => {
  const e = engineFor(s)
  return e.kind === 'indic' ? `indic:${e.language}` : `whisper:${e.model}`
}

export interface DictationHost {
  /** Base URL models are fetched from; omitted = Hugging Face directly. */
  remoteHost?: string
  /** Let transformers.js keep its own copy in the browser cache. */
  useBrowserCache: boolean
}

export interface DictationEvents {
  onState: (state: DictationState, detail?: string) => void
  onProgress: (loadedMb: number, totalMb: number) => void
  onActions: (actions: DictationAction[], heard: string) => void
  onLevel: (level: number) => void
}

export class Dictation {
  private worker: Worker | null = null
  private ready = false
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private node: ScriptProcessorNode | null = null
  private vad: VadSegmenter | null = null
  private queue: Float32Array[] = []
  private busy = false
  private nextId = 1
  private levelTimer: number | null = null
  private files = new Map<string, { loaded: number; total: number }>()
  device: 'webgpu' | 'wasm' | null = null

  constructor(
    private settings: DictationSettings,
    private readonly host: DictationHost,
    private readonly events: DictationEvents
  ) {}

  update(settings: DictationSettings): void {
    const engineChanged = engineKey(settings) !== engineKey(this.settings)
    this.settings = settings
    // A different engine or language model: stop and load the new one on the
    // next start (or straight away if listening).
    if (engineChanged) {
      const wasListening = this.listening
      this.dispose()
      if (wasListening) void this.start().catch((err) => this.events.onState('error', String(err?.message ?? err)))
    }
  }

  get listening(): boolean {
    return this.stream !== null
  }

  private ensureWorker(): Promise<void> {
    if (this.worker && this.ready) return Promise.resolve()
    if (!this.worker) {
      this.worker =
        engineFor(this.settings).kind === 'indic'
          ? new Worker(new URL('./indicWorker.ts', import.meta.url), { type: 'module' })
          : new Worker(new URL('./whisperWorker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (e) => this.onWorker(e.data)
      // A worker that fails to start at all (its script could not load) never
      // answers; without this the panel would wait for ever.
      this.worker.onerror = (e) => {
        e.preventDefault()
        this.onWorker({ type: 'error', message: e.message || 'The speech engine could not start.' })
      }
    }
    return new Promise((resolve, reject) => {
      this.readyWaiters.push({ resolve, reject })
      this.events.onState('loading')
      const engine = engineFor(this.settings)
      this.worker!.postMessage({
        type: 'load',
        language: engine.kind === 'indic' ? engine.language : undefined,
        model: engine.kind === 'whisper' ? MODEL_IDS[engine.model] : undefined,
        remoteHost: this.host.remoteHost,
        useBrowserCache: this.host.useBrowserCache,
        wasmPaths: new URL('ort/', location.origin + '/').href
      })
    })
  }

  private readyWaiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = []

  private onWorker(m: { type: string; [k: string]: unknown }): void {
    if (m.type === 'progress') {
      const file = String(m.file ?? '')
      this.files.set(file, { loaded: Number(m.loaded ?? 0), total: Number(m.total ?? 0) })
      let loaded = 0
      let total = 0
      for (const f of this.files.values()) {
        loaded += f.loaded
        total += f.total
      }
      this.events.onProgress(loaded / 1048576, total / 1048576)
    } else if (m.type === 'ready') {
      this.ready = true
      this.device = m.device as 'webgpu' | 'wasm'
      this.readyWaiters.splice(0).forEach((w) => w.resolve())
    } else if (m.type === 'result') {
      this.busy = false
      const heard = cleanTranscript(String(m.text ?? ''))
      if (heard) this.events.onActions(toActions(heard, this.settings.commands), heard)
      this.pump()
    } else if (m.type === 'error') {
      const message = String(m.message ?? 'Speech recognition failed.')
      if (m.id === undefined) {
        this.readyWaiters.splice(0).forEach((w) => w.reject(new Error(message)))
        this.dispose()
      } else {
        this.busy = false
        this.pump()
      }
      this.events.onState('error', message)
    }
  }

  async start(): Promise<void> {
    if (this.stream) return
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    })
    // Listening starts at once, even while the model is still loading: what
    // is said meanwhile is queued and written as soon as the model is ready.
    this.ctx = new AudioContext({ sampleRate: 16000 })
    const source = this.ctx.createMediaStreamSource(this.stream)
    this.vad = new VadSegmenter((audio) => {
      this.queue.push(audio)
      this.pump()
    })
    // ScriptProcessor is old but needs no separate module file, and 4096
    // samples (a quarter second) is far below what an utterance takes.
    this.node = this.ctx.createScriptProcessor(4096, 1, 1)
    this.node.onaudioprocess = (e) => this.vad?.push(new Float32Array(e.inputBuffer.getChannelData(0)))
    source.connect(this.node)
    this.node.connect(this.ctx.destination)
    this.levelTimer = window.setInterval(() => this.events.onLevel(this.vad?.level ?? 0), 100)
    try {
      await this.ensureWorker()
    } catch (err) {
      this.stopCapture()
      throw err
    }
    if (this.stream) this.events.onState('listening')
    this.pump()
  }

  /** Stops listening; what was already said is still written. */
  stop(): void {
    this.vad?.flush()
    this.stopCapture()
    if (!this.busy && !this.queue.length) this.events.onState('idle')
  }

  private stopCapture(): void {
    if (this.levelTimer !== null) window.clearInterval(this.levelTimer)
    this.levelTimer = null
    this.node?.disconnect()
    this.node = null
    void this.ctx?.close()
    this.ctx = null
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.vad = null
    this.events.onLevel(0)
  }

  private pump(): void {
    if (this.busy || !this.worker || !this.ready) return
    const audio = this.queue.shift()
    if (!audio) {
      this.events.onState(this.stream ? 'listening' : 'idle')
      return
    }
    this.busy = true
    this.events.onState('transcribing')
    this.worker.postMessage(
      { type: 'transcribe', id: this.nextId++, audio, language: this.settings.language, translate: this.settings.translate },
      [audio.buffer]
    )
  }

  /** Stops everything and frees the model's memory. */
  dispose(): void {
    this.stopCapture()
    this.queue = []
    this.busy = false
    this.worker?.terminate()
    this.worker = null
    this.ready = false
    this.files.clear()
  }
}
