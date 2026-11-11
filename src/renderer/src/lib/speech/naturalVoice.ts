/**
 * Natural English voices (Kokoro) for read aloud: loads the model in a
 * worker, makes each sentence's audio ahead of time (the next two while one
 * plays, so there are no gaps), and plays it through Web Audio, which can
 * truly pause mid-sentence and change volume and pitch.
 *
 * Kept identical across the Windows app and the web app.
 */

export interface NaturalVoiceInfo {
  id: string
  name: string
  gender: 'Female' | 'Male'
  accent: 'American' | 'British'
  note: string
}

/** The few voices offered: the best-rated, two accents, both genders. */
export const NATURAL_VOICES: NaturalVoiceInfo[] = [
  { id: 'af_heart', name: 'Heart', gender: 'Female', accent: 'American', note: 'warm, studio quality' },
  { id: 'af_bella', name: 'Bella', gender: 'Female', accent: 'American', note: 'lively storyteller' },
  { id: 'af_nicole', name: 'Nicole', gender: 'Female', accent: 'American', note: 'calm, close' },
  { id: 'bf_emma', name: 'Emma', gender: 'Female', accent: 'British', note: 'clear, elegant' },
  { id: 'am_michael', name: 'Michael', gender: 'Male', accent: 'American', note: 'deep narrator' },
  { id: 'am_fenrir', name: 'Fenrir', gender: 'Male', accent: 'American', note: 'strong, energetic' },
  { id: 'bm_george', name: 'George', gender: 'Male', accent: 'British', note: 'scholarly' },
  { id: 'bm_fable', name: 'Fable', gender: 'Male', accent: 'British', note: 'warm storyteller' }
]

export const NATURAL_MODEL_MB = 114

export interface NaturalEvents {
  onProgress: (loadedMb: number, totalMb: number) => void
}

type Pending = { resolve: (a: { samples: Float32Array; rate: number }) => void; reject: (e: Error) => void }

export class NaturalVoice {
  private worker: Worker | null = null
  private ready: Promise<void> | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private files = new Map<string, { loaded: number; total: number }>()
  private ctx: AudioContext | null = null
  private source: AudioBufferSourceNode | null = null
  private gain: GainNode | null = null
  /** Sentence audio made ahead of time, by key. */
  private made = new Map<string, Promise<{ samples: Float32Array; rate: number }>>()

  constructor(private readonly events: NaturalEvents) {}

  /** Natural voices need a graphics chip (WebGPU); without one they are too slow. */
  static async supported(): Promise<boolean> {
    try {
      const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<{ features: Set<string> } | null> } }).gpu
      const adapter = gpu ? await gpu.requestAdapter() : null
      return !!adapter && adapter.features.has('shader-f16')
    } catch {
      return false
    }
  }

  load(): Promise<void> {
    if (this.ready) return this.ready
    this.worker = new Worker(new URL('./kokoroWorker.ts', import.meta.url), { type: 'module' })
    this.ready = new Promise<void>((resolve, reject) => {
      this.worker!.onmessage = (e: MessageEvent<{ type: string; [k: string]: unknown }>) => {
        const m = e.data
        if (m.type === 'progress') {
          this.files.set(String(m.file), { loaded: Number(m.loaded ?? 0), total: Number(m.total ?? 0) })
          let l = 0
          let t = 0
          for (const f of this.files.values()) {
            l += f.loaded
            t += f.total
          }
          this.events.onProgress(l / 1048576, t / 1048576)
        } else if (m.type === 'ready') resolve()
        else if (m.type === 'audio') {
          this.pending.get(Number(m.id))?.resolve({ samples: m.samples as Float32Array, rate: Number(m.rate) })
          this.pending.delete(Number(m.id))
        } else if (m.type === 'error') {
          const err = new Error(String(m.message))
          if (m.id === undefined) reject(err)
          else {
            this.pending.get(Number(m.id))?.reject(err)
            this.pending.delete(Number(m.id))
          }
        }
      }
      this.worker!.onerror = (e) => {
        e.preventDefault()
        reject(new Error(e.message || 'The natural voice could not start.'))
      }
      this.worker!.postMessage({ type: 'load', bundled: false, base: '', wasmPaths: new URL('ort/', location.origin + '/').href, voices: [], device: 'webgpu' })
    })
    this.ready.catch(() => {
      this.dispose()
    })
    return this.ready
  }

  /** Audio for a sentence; asking again with the same key reuses the first request. */
  make(key: string, text: string, voice: string, speed: number): Promise<{ samples: Float32Array; rate: number }> {
    const hit = this.made.get(key)
    if (hit) return hit
    const p = this.load().then(
      () =>
        new Promise<{ samples: Float32Array; rate: number }>((resolve, reject) => {
          const id = this.nextId++
          this.pending.set(id, { resolve, reject })
          this.worker!.postMessage({ type: 'speak', id, text, voice, speed })
        })
    )
    this.made.set(key, p)
    return p
  }

  /** Forget audio made ahead (the voice or speed changed). */
  forget(): void {
    this.made.clear()
  }

  /**
   * Call straight from the ▶ click: browsers only let sound start from a
   * user's press, and the first sentence is ready only seconds later.
   */
  unlock(): void {
    try {
      this.ctx ??= new AudioContext()
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      // A one-sample silent buffer marks the context as started by the user.
      const s = this.ctx.createBufferSource()
      s.buffer = this.ctx.createBuffer(1, 1, 22050)
      s.connect(this.ctx.destination)
      s.start()
    } catch {
      /* no audio device: playback will report it */
    }
  }

  /** Plays audio; resolves when it ends (or is stopped). */
  play(a: { samples: Float32Array; rate: number }, opts: { volume: number; detuneCents: number }, onStart: (durationS: number) => void): Promise<void> {
    this.ctx ??= new AudioContext()
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    this.gain ??= this.ctx.createGain()
    this.gain.connect(this.ctx.destination)
    this.gain.gain.value = opts.volume
    const buf = this.ctx.createBuffer(1, a.samples.length, a.rate)
    buf.copyToChannel(a.samples as Float32Array<ArrayBuffer>, 0)
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.detune.value = opts.detuneCents
    src.connect(this.gain)
    this.source = src
    return new Promise((resolve) => {
      src.onended = () => {
        if (this.source === src) this.source = null
        resolve()
      }
      src.start()
      onStart(buf.duration / Math.pow(2, opts.detuneCents / 1200))
    })
  }

  currentTime(): number {
    return this.ctx?.currentTime ?? 0
  }

  pause(): void {
    void this.ctx?.suspend()
  }

  resume(): void {
    void this.ctx?.resume()
  }

  stopPlayback(): void {
    const s = this.source
    this.source = null
    try {
      s?.stop()
    } catch {
      /* already stopped */
    }
    if (this.ctx?.state === 'suspended') void this.ctx.resume()
  }

  dispose(): void {
    this.stopPlayback()
    this.worker?.terminate()
    this.worker = null
    this.ready = null
    this.made.clear()
    for (const p of this.pending.values()) p.reject(new Error('Stopped.'))
    this.pending.clear()
  }
}
