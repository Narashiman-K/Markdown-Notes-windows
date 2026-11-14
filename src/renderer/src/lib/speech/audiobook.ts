/**
 * Read aloud with the reader's own audiobook (a `.m4b` or `.mp3`, for example
 * one made by Book2Audio), with the text highlighted as it plays.
 *
 * Book2Audio writes "<book>.b2a.json" beside its `.m4b`:
 *   timeline   paragraph id → [start, end] seconds in the audiobook;
 *   sentences  paragraph id → the [start, end] of each of its sentences;
 *   texts      paragraph id → the paragraph's opening words (newer builds);
 *   chapters   title, start and end of each chapter.
 *
 * The paragraphs are matched to the document's own blocks by their opening
 * words, in order, so the highlighting is exact even though the document and
 * the audiobook were made separately. An older timing file without the
 * opening words is matched by chapter title and paragraph order instead, and
 * an audiobook with no timing file still plays, just without highlighting.
 *
 * Kept identical across the Windows app and the web app.
 */
import { rangeOf, type ReadSentence } from './readAloud'

export interface Sidecar {
  chapters: Array<{ index?: number | string; title: string; start: number; end: number }>
  timeline: Record<string, [number, number]>
  sentences?: Record<string, Array<[number, number]>>
  texts?: Record<string, string>
  duration?: number
}

/** Reads a Book2Audio timing file, or null when it is not one. */
export function parseSidecar(json: string | null | undefined): Sidecar | null {
  try {
    const d = JSON.parse(json ?? '') as Partial<Sidecar>
    if (!d || typeof d.timeline !== 'object' || !d.timeline) return null
    const num = (v: unknown): number => Number(v) || 0
    return {
      chapters: Array.isArray(d.chapters) ? d.chapters.map((c) => ({ index: c.index, title: String(c.title ?? ''), start: num(c.start), end: num(c.end) })) : [],
      timeline: d.timeline,
      sentences: typeof d.sentences === 'object' && d.sentences ? d.sentences : undefined,
      texts: typeof d.texts === 'object' && d.texts ? d.texts : undefined,
      duration: num(d.duration)
    }
  } catch {
    return null
  }
}

/** Lower-case letters and digits only, for comparing two copies of the same text. */
export const normText = (t: string): string =>
  t
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ऀ-෿]+/g, ' ')
    .trim()

export interface Cue {
  id: string
  start: number
  end: number
  sentences?: Array<[number, number]>
  /** The document block it was matched to, or -1. */
  block: number
}

export interface Block {
  /** Index of its first and last sentence in the document's sentence list. */
  first: number
  last: number
  norm: string
}

/** The document's sentences grouped into blocks (paragraphs, headings, list items…). */
export function blocksOf(sentences: ReadSentence[]): Block[] {
  const out: Block[] = []
  sentences.forEach((s, i) => {
    if (s.blockStart || !out.length) out.push({ first: i, last: i, norm: '' })
    const b = out[out.length - 1]
    b.last = i
    b.norm = `${b.norm} ${normText(s.text)}`.trim()
  })
  return out
}

/**
 * Matches the audiobook's paragraphs to the document's blocks, in reading
 * order. Returns the cues sorted by time, each with its block (or -1).
 */
export function alignCues(side: Sidecar, blocks: Block[]): Cue[] {
  const cues: Cue[] = Object.entries(side.timeline)
    .map(([id, [start, end]]) => ({ id, start: Number(start), end: Number(end), sentences: side.sentences?.[id], block: -1 }))
    .filter((c) => Number.isFinite(c.start) && c.end > c.start)
    .sort((a, b) => a.start - b.start)

  if (side.texts && Object.keys(side.texts).length) {
    // Exact: each paragraph's opening words, found in order.
    let at = 0
    for (const c of cues) {
      const words = normText(side.texts[c.id] ?? '').split(' ').filter(Boolean)
      if (words.length < 2) continue
      const key = words.slice(0, 8).join(' ')
      const from = Math.max(0, at - 1)
      for (let j = from; j < Math.min(blocks.length, from + 400); j++) {
        const b = blocks[j].norm
        if (!b) continue
        let hit = b.startsWith(key) || (key.length > 25 && b.includes(key))
        // A heading on its own line: the audiobook reads it straight into
        // the paragraph after it, so that paragraph must carry on with the
        // same words. A line of a table of contents, which repeats the
        // chapter titles, is followed by another title and never matches.
        if (!hit && key.startsWith(b) && b.split(' ').length >= 2) {
          const rest = key.slice(b.length).trim().split(' ').slice(0, 3).join(' ')
          const next = blocks[j + 1]?.norm ?? ''
          hit = !rest || next.startsWith(rest)
        }
        if (hit) {
          c.block = j
          at = j + 1
          break
        }
      }
    }
    return cues
  }

  // Older timing files: find each chapter's heading, then take its
  // paragraphs in order from there.
  let at = 0
  const byChapter = new Map<string, Cue[]>()
  for (const c of cues) {
    const ch = /^c(\d+)-/.exec(c.id)?.[1] ?? ''
    byChapter.set(ch, [...(byChapter.get(ch) ?? []), c])
  }
  side.chapters.forEach((ch, k) => {
    const title = normText(ch.title)
    let head = -1
    for (let j = at; j < blocks.length && title; j++) {
      if (blocks[j].norm.startsWith(title.slice(0, 40)) || (blocks[j].norm.length > 6 && title.startsWith(blocks[j].norm.slice(0, 40)))) {
        head = j
        break
      }
    }
    if (head < 0) return
    const list = byChapter.get(String(ch.index ?? k + 1).padStart(2, '0')) ?? []
    // Only the chapter's start is known for sure; timeBlocks spreads the rest.
    if (list[0]) list[0].block = head
    at = head + 1
  })
  return cues
}

/** Seconds of pause after a sentence, and after a heading, in Book2Audio's narration. */
const PAUSE_SENTENCE = 0.45
const PAUSE_HEADING = 1.1
/** How long an unconfirmed sentence start waits for its pause to be heard. */
const HOLD = 0.6
/** How far (seconds) an estimated sentence start may move to a real one. */
const SNAP = 2.5

/** A block of the page with the time of each of its sentences in the audiobook. */
export interface Timed {
  block: number
  start: number
  end: number
  /** [start, end] of each sentence of the block, in order. */
  sents: Array<[number, number]>
}

/**
 * The time of every sentence on the page that the audiobook covers.
 *
 * The audiobook's paragraphs and the page's blocks need not be the same: a
 * converted PDF often splits one paragraph into several. So each matched
 * paragraph (or, for older timing files, each chapter) covers the page's
 * blocks up to the next match, and its time is shared among their sentences:
 * exactly, by Book2Audio's own sentence times, when the sentence counts agree;
 * otherwise in proportion to the length of each sentence.
 */
export function timeBlocks(side: Sidecar, blocks: Block[], sentences: ReadSentence[]): Timed[] {
  const cues = alignCues(side, blocks)
  const groups: Array<{ from: number; to: number; cues: Cue[] }> = []
  if (side.texts && Object.keys(side.texts).length) {
    let cur: { from: number; to: number; cues: Cue[] } | null = null
    for (const c of cues) {
      if (c.block >= 0 && (!cur || c.block > cur.from)) {
        cur = { from: c.block, to: c.block, cues: [c] }
        groups.push(cur)
      } else if (cur) cur.cues.push(c)
    }
    groups.forEach((g, i) => (g.to = Math.min((groups[i + 1]?.from ?? blocks.length) - 1, g.from + 60)))
  } else {
    // Older timing files: whole chapters, found by their headings.
    const heads: Array<{ block: number; cues: Cue[] }> = []
    for (const c of cues) {
      if (c.block < 0) continue
      const ch = /^c(\d+)-/.exec(c.id)?.[1] ?? ''
      const all = cues.filter((x) => (/^c(\d+)-/.exec(x.id)?.[1] ?? '') === ch)
      if (!heads.some((h) => h.cues[0] === all[0])) heads.push({ block: c.block, cues: all })
    }
    heads.sort((a, b) => a.block - b.block)
    heads.forEach((h, i) => groups.push({ from: h.block, to: (heads[i + 1]?.block ?? blocks.length) - 1, cues: h.cues }))
  }

  const out: Timed[] = []
  for (const g of groups) {
    if (g.to < g.from || !g.cues.length) continue
    const sentIdx: number[] = []
    for (let b = g.from; b <= g.to; b++) for (let k = blocks[b].first; k <= blocks[b].last; k++) sentIdx.push(k)
    const spans = g.cues.map((c) => [c.start, c.end] as [number, number])
    const exact = g.cues.every((c) => c.sentences?.length) ? g.cues.flatMap((c) => c.sentences!.map(([s, e]) => [Number(s), Number(e)] as [number, number])) : []
    let times: Array<[number, number]>
    if (exact.length === sentIdx.length) times = exact
    else {
      // Spread over the spoken time (gaps between paragraphs left out) by
      // length, allowing for the narrator's pause after each sentence
      // (longer after a heading). Ignoring the pauses put the highlight a
      // second or two ahead of the voice in long paragraphs.
      const total = spans.reduce((t, [s, e]) => t + (e - s), 0)
      const lens = sentIdx.map((k) => Math.max(1, sentences[k].text.length))
      const chars = lens.reduce((a, b) => a + b, 0)
      const pauseOf = (k: number): number => (sentences[k].kind === 'heading' ? PAUSE_HEADING : PAUSE_SENTENCE)
      let pauses = sentIdx.reduce((t, k) => t + pauseOf(k), 0)
      // Never let the pauses take more than a third of the time.
      const squeeze = pauses > total / 3 ? total / 3 / pauses : 1
      pauses *= squeeze
      const perChar = Math.max(0, total - pauses) / chars
      const weights = sentIdx.map((k, i) => lens[i] * perChar + pauseOf(k) * squeeze)
      const sum = weights.reduce((a, b) => a + b, 0) || 1
      const at = (f: number): number => {
        let need = f * total
        for (const [s, e] of spans) {
          if (need <= e - s) return s + need
          need -= e - s
        }
        return spans[spans.length - 1][1]
      }
      let acc = 0
      times = weights.map((w, i) => {
        const a = at(acc / sum)
        acc += w
        // The sentence is spoken until its pause begins.
        const end = at((acc - pauseOf(sentIdx[i]) * squeeze) / sum)
        return [a, Math.max(a + 0.05, end)] as [number, number]
      })
      // Book2Audio's own sentence times, when there are some but the page
      // splits sentences differently: each estimated start moves to the
      // nearest real sentence start close by.
      if (exact.length) {
        const starts = exact.map(([s0]) => s0)
        let floor = -Infinity
        times = times.map(([a, e], i) => {
          if (i === 0) return [a, e] as [number, number]
          let best = a
          let gap = SNAP
          for (const b of starts) if (b > floor && Math.abs(b - a) < gap) (gap = Math.abs(b - a)), (best = b)
          floor = best
          return [best, e] as [number, number]
        })
        for (let i = 0; i < times.length - 1; i++) times[i][1] = Math.min(times[i][1], times[i + 1][0])
      }
    }
    // Ordinary narration is about 12–20 letters a second. A stretch that
    // would need far more is a mismatch: better unhighlighted than racing.
    const spoken = spans.reduce((t, [s, e]) => t + (e - s), 0)
    const letters = sentIdx.reduce((t, k) => t + sentences[k].text.length, 0)
    if (spoken > 0 && letters / spoken > 45) continue
    let n = 0
    for (let b = g.from; b <= g.to; b++) {
      const count = blocks[b].last - blocks[b].first + 1
      const sents = times.slice(n, n + count)
      n += count
      if (sents.length) out.push({ block: b, start: sents[0][0], end: sents[sents.length - 1][1], sents })
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

/** The timed block playing at time t (the last one starting at or before it). */
export function cueAt(items: Array<{ start: number }>, t: number): number {
  let lo = 0
  let hi = items.length - 1
  let hit = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (items[mid].start <= t) {
      hit = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return hit
}

type HLRegistry = { set(name: string, h: unknown): void; delete(name: string): void }
const registry = (): HLRegistry | null => (globalThis as unknown as { CSS?: { highlights?: HLRegistry } }).CSS?.highlights ?? null
const HighlightCtor = (): (new (...r: Range[]) => unknown) | null => (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight ?? null

export interface AudiobookEvents {
  onState: (s: 'idle' | 'playing' | 'paused') => void
  onSentence: (i: number, n: number) => void
  onNote?: (text: string) => void
}

/** Plays an audiobook and highlights the sentence (and word) being spoken. */
export class AudiobookPlayer {
  readonly audio: HTMLAudioElement
  private timed: Timed[] = []
  private blocks: Block[] = []
  private sentences: ReadSentence[] = []
  private scroller: HTMLElement | null = null
  private raf: number | null = null
  private lastKey = ''
  /*
   * Live pause detection: the narrator pauses before every sentence. Each
   * time sound resumes after a pause, the sentence start estimated nearest to
   * that moment is moved to it, so the highlight follows the real voice at
   * any speed, even where the timing file only knows whole paragraphs.
   */
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private buf: Float32Array<ArrayBuffer> | null = null
  private quietSince: number | null = null
  /** Sentence starts confirmed by a heard pause: sentence index → media time. */
  private heard = new Map<number, number>()

  constructor(
    url: string,
    private readonly side: Sidecar | null,
    private readonly events: AudiobookEvents
  ) {
    this.audio = new Audio()
    // Needed to listen to the sound for pauses (the app's own audiobook files).
    this.audio.crossOrigin = 'anonymous'
    this.audio.src = url
    this.audio.preload = 'auto'
    // Development builds only: lets the player be inspected from the console.
    if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) (globalThis as unknown as { __mnBook?: AudiobookPlayer }).__mnBook = this
    this.audio.addEventListener('play', () => {
      this.events.onState('playing')
      this.loop()
    })
    this.audio.addEventListener('pause', () => this.events.onState(this.audio.ended || this.audio.currentTime === 0 ? 'idle' : 'paused'))
    this.audio.addEventListener('ended', () => {
      this.clear()
      this.events.onState('idle')
    })
    this.audio.addEventListener('error', () => this.events.onNote?.('The audiobook could not be played. Is the file still there, and is it an .m4b, .m4a or .mp3?'))
  }

  /** The document as it is on screen now. Returns how many paragraphs were matched. */
  setDocument(sentences: ReadSentence[], scroller: HTMLElement | null): { matched: number; total: number } {
    this.sentences = sentences
    this.scroller = scroller
    this.blocks = blocksOf(sentences)
    this.timed = this.side ? timeBlocks(this.side, this.blocks, sentences) : []
    const covered = new Set(this.timed.map((t) => t.block))
    const paras = this.blocks.length
    return { matched: covered.size, total: paras }
  }

  get hasTiming(): boolean {
    return this.timed.length > 0
  }

  /** The time a sentence starts at, or null when it is not in the audiobook. */
  timeOf(sentence: number): number | null {
    const b = this.blocks.findIndex((x) => sentence >= x.first && sentence <= x.last)
    if (b < 0) return null
    const t = this.timed.find((x) => x.block === b)
    if (!t) {
      // Not in the audiobook itself: carry on from the nearest part before it.
      const before = [...this.timed].reverse().find((x) => x.block < b)
      return before ? before.end : null
    }
    return t.sents[sentence - this.blocks[b].first]?.[0] ?? t.start
  }

  /** Starts listening for pauses (must follow a click, like all sound). */
  private listen(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return
    }
    try {
      this.ctx = new AudioContext()
      const src = this.ctx.createMediaElementSource(this.audio)
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 1024
      this.buf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4))
      src.connect(this.analyser)
      this.analyser.connect(this.ctx.destination)
    } catch {
      this.ctx = null
      this.analyser = null
    }
  }

  /** Watches the sound: when it comes back after a pause, a sentence starts there. */
  private detectPause(t: number): void {
    const a = this.analyser
    const buf = this.buf
    if (!a || !buf) return
    a.getFloatTimeDomainData(buf)
    let sum = 0
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
    const rms = Math.sqrt(sum / buf.length)
    if (rms < 0.012) {
      if (this.quietSince === null) this.quietSince = t
      return
    }
    const since = this.quietSince
    this.quietSince = null
    if (since === null || t - since < 0.22) return
    // Sound is back after a real pause: the nearest estimated sentence start.
    const c = this.timed[cueAt(this.timed, t + 1.5)]
    if (!c) return
    const near = (x: Timed): number[] => x.sents.map(([st], i) => this.blocks[x.block].first + i).filter((k) => {
      const st = this.startOf(k)
      return st !== null && Math.abs(st - t) < 1.6
    })
    const k = c ? near(c).concat(near(this.timed[cueAt(this.timed, t - 1.5)] ?? c)) : []
    if (!k.length) return
    const best = k.reduce((x, y) => (Math.abs((this.startOf(x) ?? 1e9) - t) <= Math.abs((this.startOf(y) ?? 1e9) - t) ? x : y))
    this.heard.set(best, t)
  }

  /** A sentence's start: as heard, or as estimated. */
  private startOf(k: number): number | null {
    const h = this.heard.get(k)
    if (h !== undefined) return h
    const b = this.blocks.findIndex((x) => k >= x.first && k <= x.last)
    const c = b >= 0 ? this.timed.find((x) => x.block === b) : undefined
    return c ? c.sents[k - this.blocks[b].first][0] : null
  }

  async play(fromSentence?: number): Promise<void> {
    this.listen()
    this.heard.clear()
    if (fromSentence !== undefined) {
      const t = this.timeOf(fromSentence)
      if (t !== null) this.audio.currentTime = Math.max(0, t - 0.05)
    }
    await this.audio.play()
  }

  pause(): void {
    this.audio.pause()
  }

  stop(): void {
    this.audio.pause()
    this.audio.currentTime = 0
    this.clear()
    this.events.onState('idle')
  }

  /** Moves to the sentence before or after the one being read. */
  step(by: -1 | 1): void {
    const now = this.currentSentence()
    const target = Math.max(0, Math.min(this.sentences.length - 1, (now < 0 ? 0 : now) + by))
    const t = this.timeOf(target)
    if (t !== null) this.audio.currentTime = Math.max(0, t - 0.05)
  }

  setRate(r: number): void {
    this.audio.playbackRate = Math.max(0.5, Math.min(3, r))
  }

  setVolume(v: number): void {
    this.audio.volume = Math.max(0, Math.min(1, v))
  }

  dispose(): void {
    void this.ctx?.close()
    this.ctx = null
    this.analyser = null
    this.audio.pause()
    this.audio.removeAttribute('src')
    this.audio.load()
    if (this.raf !== null) cancelAnimationFrame(this.raf)
    this.clear()
  }

  private currentSentence(): number {
    const c = this.timed[cueAt(this.timed, this.audio.currentTime)]
    if (!c) return -1
    let i = c.sents.findIndex(([, e]) => this.audio.currentTime < e)
    if (i < 0) i = c.sents.length - 1
    return this.blocks[c.block].first + i
  }

  private loop(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf)
    const tick = (): void => {
      this.raf = null
      if (this.audio.paused) return
      this.highlight()
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  private highlight(): void {
    const t = this.audio.currentTime
    this.detectPause(t)
    const c = this.timed[cueAt(this.timed, t)]
    if (!c || t > c.end + 1.5) return
    const b = this.blocks[c.block]
    const times = c.sents
    // Each sentence starts where its pause was heard; one not heard yet
    // waits a moment past its estimate for the pause to confirm it, so the
    // highlight never runs ahead of the voice.
    const listening = !!this.analyser
    const starts = times.map(([s0], k) => this.heard.get(b.first + k) ?? (listening && k > 0 ? s0 + HOLD : s0))
    if (starts[0] > t && listening) return
    let i = 0
    for (let k = 0; k < starts.length; k++) if (starts[k] <= t) i = k
    const s = this.sentences[b.first + i]
    const st = starts[i]
    const en = i + 1 < starts.length ? Math.max(st + 0.2, starts[i + 1] - PAUSE_SENTENCE) : times[i][1]
    // The word: by its share of the sentence's letters.
    const words = [...s.text.matchAll(/\S+/g)]
    const total = words.reduce((n, m) => n + m[0].length + 1, 0) || 1
    const f = Math.max(0, Math.min(0.999, (t - st) / Math.max(0.05, en - st)))
    let acc = 0
    let w = words.length - 1
    for (let x = 0; x < words.length; x++) {
      acc += words[x][0].length + 1
      if (acc / total > f) {
        w = x
        break
      }
    }
    const key = `${b.first + i}:${w}`
    if (key === this.lastKey) return
    const newSentence = !this.lastKey.startsWith(`${b.first + i}:`)
    this.lastKey = key
    const h = registry()
    const H = HighlightCtor()
    if (!h || !H) return
    const sr = rangeOf(s)
    if (sr) h.set('mn-read-sentence', new H(sr))
    const m = words[w]
    const wr = m ? rangeOf(s, m.index!, m.index! + m[0].length) : null
    if (wr) h.set('mn-read-word', new H(wr))
    if (newSentence) {
      this.events.onSentence(b.first + i, this.sentences.length)
      this.scrollTo(sr)
    }
  }

  private scrollTo(r: Range | null): void {
    const box = r?.getBoundingClientRect()
    const sc = this.scroller
    if (!box || !sc) return
    const view = sc.getBoundingClientRect()
    if (box.top < view.top + 60 || box.bottom > view.bottom - 80) {
      sc.scrollTo({ top: sc.scrollTop + box.top - view.top - view.height / 3, behavior: 'smooth' })
    }
  }

  private clear(): void {
    this.lastKey = ''
    const h = registry()
    h?.delete('mn-read-sentence')
    h?.delete('mn-read-word')
  }
}
