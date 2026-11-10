/**
 * Cuts a live microphone stream into utterances at the pauses.
 *
 * Whisper reads a whole stretch of audio at once, so dictation sends it one
 * utterance at a time: from when speech starts until the speaker pauses. A
 * pause is found by loudness against a noise floor that adapts to the room
 * (a fan, traffic), not by a fixed threshold. No model, no download.
 *
 *   - a little audio before speech starts is kept (pre-roll), so the first
 *     consonant is not clipped;
 *   - an utterance ends after `silenceMs` of quiet, or is cut at `maxMs` so a
 *     speaker who never pauses still sees text appear;
 *   - anything shorter than `minMs` (a cough, a click) is dropped.
 *
 * Kept identical across the Windows app and the web app.
 */

export interface VadOptions {
  sampleRate?: number
  frameMs?: number
  /** Quiet needed to end an utterance. */
  silenceMs?: number
  /** Longest utterance before it is cut anyway. */
  maxMs?: number
  /** Utterances shorter than this are dropped. */
  minMs?: number
  /** Audio kept from before speech was detected. */
  preRollMs?: number
}

const DEFAULTS: Required<VadOptions> = {
  sampleRate: 16000,
  frameMs: 30,
  silenceMs: 700,
  maxMs: 15000,
  minMs: 350,
  preRollMs: 300
}

/** Root-mean-square loudness of a frame, 0..1. */
export function rms(frame: Float32Array): number {
  let sum = 0
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
  return Math.sqrt(sum / Math.max(1, frame.length))
}

export class VadSegmenter {
  private readonly o: Required<VadOptions>
  private readonly frameLen: number
  private pending = new Float32Array(0)
  private preRoll: Float32Array[] = []
  private speech: Float32Array[] = []
  private speechFrames = 0
  private silentFrames = 0
  private loudRun = 0
  private inSpeech = false
  private floor = 0.004
  /** Smoothed level for a meter in the UI, 0..1. */
  level = 0

  constructor(
    private readonly onSegment: (audio: Float32Array) => void,
    options: VadOptions = {}
  ) {
    this.o = { ...DEFAULTS, ...options }
    this.frameLen = Math.round((this.o.sampleRate * this.o.frameMs) / 1000)
  }

  /** Feed any number of samples. */
  push(samples: Float32Array): void {
    const joined = new Float32Array(this.pending.length + samples.length)
    joined.set(this.pending)
    joined.set(samples, this.pending.length)
    let at = 0
    while (at + this.frameLen <= joined.length) {
      this.frame(joined.slice(at, at + this.frameLen))
      at += this.frameLen
    }
    this.pending = joined.slice(at)
  }

  /** End of input: hand over whatever utterance is in progress. */
  flush(): void {
    if (this.inSpeech) this.emit()
    this.reset()
  }

  private reset(): void {
    this.pending = new Float32Array(0)
    this.preRoll = []
    this.speech = []
    this.speechFrames = 0
    this.silentFrames = 0
    this.loudRun = 0
    this.inSpeech = false
  }

  private frame(f: Float32Array): void {
    const level = rms(f)
    this.level = this.level * 0.7 + Math.min(1, level * 8) * 0.3
    const threshold = Math.max(this.floor * 3, 0.008)
    const loud = level > threshold

    // The noise floor follows quiet frames quickly downwards and slowly
    // upwards, so a steady fan raises it but speech does not.
    if (!loud) this.floor = level < this.floor ? this.floor * 0.9 + level * 0.1 : this.floor * 0.995 + level * 0.005

    const preRollFrames = Math.ceil(this.o.preRollMs / this.o.frameMs)
    if (!this.inSpeech) {
      this.preRoll.push(f)
      if (this.preRoll.length > preRollFrames) this.preRoll.shift()
      this.loudRun = loud ? this.loudRun + 1 : 0
      // Two loud frames in a row start an utterance; one is often a click.
      if (this.loudRun >= 2) {
        this.inSpeech = true
        this.speech = [...this.preRoll]
        this.speechFrames = this.loudRun
        this.silentFrames = 0
        this.preRoll = []
      }
      return
    }

    this.speech.push(f)
    if (loud) {
      this.speechFrames++
      this.silentFrames = 0
    } else {
      this.silentFrames++
    }
    const lengthMs = this.speech.length * this.o.frameMs
    if (this.silentFrames * this.o.frameMs >= this.o.silenceMs || lengthMs >= this.o.maxMs) {
      this.emit()
      this.inSpeech = false
      this.speech = []
      this.loudRun = 0
    }
  }

  private emit(): void {
    if (this.speechFrames * this.o.frameMs < this.o.minMs) return
    // Drop the trailing silence, keeping a short tail.
    const keepTail = Math.min(this.silentFrames, Math.ceil(200 / this.o.frameMs))
    const frames = this.speech.slice(0, this.speech.length - this.silentFrames + keepTail)
    const out = new Float32Array(frames.length * this.frameLen)
    frames.forEach((fr, i) => out.set(fr, i * this.frameLen))
    this.onSegment(out)
  }
}
