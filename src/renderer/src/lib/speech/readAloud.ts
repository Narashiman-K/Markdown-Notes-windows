/**
 * Read aloud: the rendered document, sentence by sentence, with the sentence
 * (and, where the voice reports it, the word) highlighted as it is spoken.
 *
 * Text comes from the rendered page, not the Markdown, so what is read is what
 * is seen: no asterisks, no link addresses, tables read row by row. Each
 * sentence keeps DOM Ranges for its text, and the highlight uses the CSS
 * Custom Highlight API, which marks text without touching the DOM, so
 * annotations and the source map are never disturbed.
 *
 * Voices: the ones already on the computer (speechSynthesis). Free, offline,
 * every language installed in Windows. Reading styles shape speed, pitch and
 * pauses; "emotion" and "sentiment" are approximations made the same way,
 * since none of these voices can act.
 *
 * Kept identical across the Windows app and the web app.
 */

export type ReadKind = 'heading' | 'para' | 'list' | 'quote' | 'code' | 'table' | 'caption'

export interface ReadSentence {
  /** The text as on the page. */
  text: string
  /** What is actually said (may announce a heading, summarise code…). */
  spoken: string
  /** Where `spoken` starts inside `text`'s mapping, for word highlighting. */
  spokenOffset: number
  kind: ReadKind
  level?: number
  /** Last sentence of its block: the longer paragraph pause follows. */
  blockEnd: boolean
  /** First sentence of its block (for skim reading). */
  blockStart: boolean
  /** Lies inside a highlight or other annotation. */
  annotated: boolean
  /** Text segments, to build Ranges for the sentence or a word in it. */
  segs: Array<{ node: Text; nodeStart: number; textStart: number; length: number }>
}

export type StyleId = 'natural' | 'story' | 'motivational' | 'technical' | 'news' | 'calm' | 'study' | 'kids' | 'poetry' | 'skim'

export interface ReadStyle {
  id: StyleId
  label: string
  rate: number
  pitch: number
  /** Pause after a sentence, and after a paragraph or heading, in ms. */
  pauseSentence: number
  pauseBlock: number
  headings: 'plain' | 'announce' | 'chapter'
  code: 'read' | 'summary' | 'skip'
  tables: 'rows' | 'skip'
  /** Headings and the first sentence of each paragraph only. */
  skim?: boolean
  /** Emphasis on bold text and key lines: more pause before them. */
  emphasis?: boolean
}

export const READ_STYLES: ReadStyle[] = [
  { id: 'natural', label: 'Natural', rate: 1, pitch: 1, pauseSentence: 200, pauseBlock: 450, headings: 'plain', code: 'summary', tables: 'rows' },
  { id: 'story', label: 'Storytelling', rate: 0.9, pitch: 1.05, pauseSentence: 380, pauseBlock: 800, headings: 'chapter', code: 'skip', tables: 'skip' },
  { id: 'motivational', label: 'Motivational speaker', rate: 1.08, pitch: 1.15, pauseSentence: 320, pauseBlock: 700, headings: 'chapter', code: 'skip', tables: 'skip', emphasis: true },
  { id: 'technical', label: 'Technical content', rate: 0.95, pitch: 1, pauseSentence: 250, pauseBlock: 550, headings: 'announce', code: 'read', tables: 'rows' },
  { id: 'news', label: 'News anchor', rate: 1.05, pitch: 1, pauseSentence: 180, pauseBlock: 380, headings: 'plain', code: 'summary', tables: 'rows' },
  { id: 'calm', label: 'Calm / bedtime', rate: 0.78, pitch: 0.92, pauseSentence: 480, pauseBlock: 950, headings: 'plain', code: 'skip', tables: 'skip' },
  { id: 'study', label: 'Study (slow, clear)', rate: 0.72, pitch: 1, pauseSentence: 550, pauseBlock: 1000, headings: 'announce', code: 'summary', tables: 'rows', emphasis: true },
  { id: 'kids', label: 'Kids', rate: 0.92, pitch: 1.25, pauseSentence: 320, pauseBlock: 650, headings: 'plain', code: 'skip', tables: 'skip' },
  { id: 'poetry', label: 'Poetry', rate: 0.85, pitch: 1, pauseSentence: 600, pauseBlock: 1100, headings: 'plain', code: 'skip', tables: 'skip' },
  { id: 'skim', label: 'Skim (headings and first lines)', rate: 1.4, pitch: 1, pauseSentence: 120, pauseBlock: 220, headings: 'plain', code: 'skip', tables: 'skip', skim: true }
]

export interface ReadOptions {
  /** Natural voices (Kokoro, English) or the voices installed on the computer. */
  engine: 'natural' | 'system'
  naturalVoice: string
  style: StyleId
  /** User multipliers on top of the style. */
  rate: number
  pitch: number
  volume: number
  /** -1 calm … 0 … +1 energetic. */
  emotion: number
  /** Shape each sentence by its sentiment (small offline word list). */
  sentiment: boolean
  voiceURI: string | null
  /** Switch to an installed voice for Hindi/Tamil/… text automatically. */
  autoLanguage: boolean
  skipCode: boolean
  skipTables: boolean
  highlightsOnly: boolean
}

export const DEFAULT_READ: ReadOptions = {
  engine: 'natural',
  naturalVoice: 'af_heart',
  style: 'natural',
  rate: 1,
  pitch: 1,
  volume: 1,
  emotion: 0,
  sentiment: false,
  voiceURI: null,
  autoLanguage: true,
  skipCode: false,
  skipTables: false,
  highlightsOnly: false
}

export const styleOf = (id: StyleId): ReadStyle => READ_STYLES.find((s) => s.id === id) ?? READ_STYLES[0]

/* ---------------------------------------------------------------- collect */

const BLOCKS = 'h1,h2,h3,h4,h5,h6,p,li,pre,tr,blockquote,dt,dd,figcaption,caption'

function kindOf(block: Element): { kind: ReadKind; level?: number } {
  const tag = block.tagName.toLowerCase()
  if (/^h[1-6]$/.test(tag)) return { kind: 'heading', level: Number(tag[1]) }
  if (tag === 'pre') return { kind: 'code' }
  if (tag === 'tr') return { kind: 'table' }
  if (tag === 'li') return { kind: 'list' }
  if (tag === 'figcaption' || tag === 'caption') return { kind: 'caption' }
  if (block.closest('blockquote')) return { kind: 'quote' }
  return { kind: 'para' }
}

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'sentence' }) : null

function splitSentences(text: string): Array<[number, number]> {
  if (!segmenter) return [[0, text.length]]
  const out: Array<[number, number]> = []
  for (const s of segmenter.segment(text)) {
    const start = s.index
    const end = s.index + s.segment.length
    if (s.segment.trim()) out.push([start, end])
  }
  return out
}

/**
 * Every sentence of the rendered document, in reading order. Elements marked
 * `data-mn-ignore` (toolbars, notes) are left out.
 */
export function collectSentences(root: HTMLElement, opts: ReadOptions): ReadSentence[] {
  const style = styleOf(opts.style)
  const out: ReadSentence[] = []
  const blocks = [...root.querySelectorAll(BLOCKS)].filter((b) => {
    if (b.closest('[data-mn-ignore]')) return false
    // Leaf blocks only: a list item holding a paragraph is read via the paragraph.
    if (b.tagName === 'BLOCKQUOTE' && b.querySelector('p')) return false
    if (b.tagName === 'LI' && b.querySelector(':scope > p')) return false
    return true
  })
  let headerCells: string[] = []

  for (const block of blocks) {
    const { kind, level } = kindOf(block)
    if (kind === 'code' && (opts.skipCode || style.code === 'skip')) continue
    if (kind === 'table' && (opts.skipTables || style.tables === 'skip')) continue

    // Text nodes of this block, excluding those that belong to a nested block.
    const segs: ReadSentence['segs'] = []
    let text = ''
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        const el = n.parentElement
        if (!el || el.closest('[data-mn-ignore]')) return NodeFilter.FILTER_REJECT
        const owner = el.closest(BLOCKS)
        return owner === block ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
      }
    })
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      let v = n.nodeValue ?? ''
      // Table cells run together otherwise.
      if (kind === 'table' && n.parentElement?.closest('td,th') && text && !/\s$/.test(text)) {
        segs.push({ node: n, nodeStart: 0, textStart: text.length, length: 0 })
        text += ' | '
      }
      if (!v) continue
      segs.push({ node: n, nodeStart: 0, textStart: text.length, length: v.length })
      text += v
      v = ''
    }
    if (!text.trim()) continue
    const annotated = !!block.querySelector('mark,[data-mn-id]') || !!block.closest('mark,[data-mn-id]')

    if (kind === 'code') {
      const lines = text.replace(/\n$/, '').split('\n').length
      const summary = `Code block, ${lines} line${lines === 1 ? '' : 's'}.`
      const read = style.code === 'read'
      out.push(sentence(text, read ? text : summary, 0, kind, undefined, true, true, annotated, segs))
      continue
    }
    if (kind === 'table') {
      const cells = [...block.querySelectorAll('th,td')].map((c) => (c.textContent ?? '').trim())
      if (block.querySelector('th')) {
        headerCells = cells
        out.push(sentence(text, `Table with columns: ${cells.join(', ')}.`, 0, kind, undefined, true, true, annotated, segs))
      } else {
        const spoken = cells.map((c, i) => (headerCells[i] && style.headings === 'announce' ? `${headerCells[i]}: ${c}` : c)).join(', ') + '.'
        out.push(sentence(text, spoken, 0, kind, undefined, true, true, annotated, segs))
      }
      continue
    }

    const parts = kind === 'heading' ? [[0, text.length] as [number, number]] : splitSentences(text)
    parts.forEach(([a, b], i) => {
      const t = text.slice(a, b)
      const trimmed = t.trim()
      const lead = t.length - t.trimStart().length
      let spoken = trimmed
      if (kind === 'heading') {
        if (style.headings === 'announce') spoken = `${level && level <= 2 ? 'Section' : 'Subsection'}: ${trimmed}.`
        else if (style.headings === 'chapter') spoken = `${trimmed}.`
      }
      const sub = segs
        .map((s) => {
          const from = Math.max(s.textStart, a + lead)
          const to = Math.min(s.textStart + s.length, a + lead + trimmed.length)
          return to > from || (s.length === 0 && s.textStart >= a && s.textStart <= b)
            ? { node: s.node, nodeStart: s.nodeStart + (from - s.textStart), textStart: from - (a + lead), length: Math.max(0, to - from) }
            : null
        })
        .filter((s): s is NonNullable<typeof s> => !!s)
      out.push(
        sentence(trimmed, spoken, spoken.indexOf(trimmed) >= 0 ? spoken.indexOf(trimmed) : 0, kind, level, i === parts.length - 1, i === 0, annotated, sub)
      )
    })
  }

  let result = out
  if (style.skim) result = result.filter((s) => s.kind === 'heading' || s.blockStart)
  if (opts.highlightsOnly) result = result.filter((s) => s.annotated)
  return result
}

function sentence(
  text: string,
  spoken: string,
  spokenOffset: number,
  kind: ReadKind,
  level: number | undefined,
  blockEnd: boolean,
  blockStart: boolean,
  annotated: boolean,
  segs: ReadSentence['segs']
): ReadSentence {
  return { text, spoken, spokenOffset, kind, level, blockEnd, blockStart, annotated, segs }
}

/** A DOM Range over characters [from, to) of a sentence's text. */
export function rangeOf(s: ReadSentence, from = 0, to = s.text.length): Range | null {
  const segs = s.segs.filter((g) => g.length > 0)
  if (!segs.length) return null
  const find = (pos: number, end: boolean): [Text, number] => {
    for (const g of segs) {
      if (pos < g.textStart + g.length || (end && pos === g.textStart + g.length)) {
        return [g.node, g.nodeStart + Math.max(0, Math.min(g.length, pos - g.textStart))]
      }
    }
    const last = segs[segs.length - 1]
    return [last.node, last.nodeStart + last.length]
  }
  try {
    const r = document.createRange()
    const [sn, so] = find(Math.max(0, from), false)
    const [en, eo] = find(Math.min(to, s.text.length), true)
    r.setStart(sn, Math.min(so, sn.length))
    r.setEnd(en, Math.min(eo, en.length))
    return r
  } catch {
    return null
  }
}

/* -------------------------------------------------------------- prosody */

const POSITIVE = new Set(
  'achieve achieved amazing best better bright celebrate confident delight easy enjoy excellent exciting gain glad good grateful great grow growth happy hope improve improved incredible joy love lucky opportunity perfect positive progress proud rise rose strong success successful thank thanks thrive win wonderful yes'.split(
    ' '
  )
)
const NEGATIVE = new Set(
  'afraid angry bad crisis damage danger death decline delay difficult disappoint fail failed failure fall fear fell hard hate hurt ill loss lost miss mistake no not pain poor problem risk sad sorry struggle terrible threat trouble unfortunately worry worse worst wrong'.split(
    ' '
  )
)

/** -1 … +1 from a small offline word list; 0 when nothing matches. */
export function sentimentOf(text: string): number {
  let score = 0
  for (const w of text.toLowerCase().match(/[a-z']+/g) ?? []) {
    if (POSITIVE.has(w)) score++
    else if (NEGATIVE.has(w)) score--
  }
  return Math.max(-1, Math.min(1, score / 2))
}

export interface Prosody {
  rate: number
  pitch: number
  volume: number
  pauseAfter: number
}

/**
 * Speed, pitch and pause for one sentence: the style, the user's sliders,
 * the emotion setting, and (optionally) the sentence's own sentiment and
 * punctuation. Kept inside what the voices accept.
 */
export function prosodyFor(s: ReadSentence, opts: ReadOptions): Prosody {
  const st = styleOf(opts.style)
  const e = Math.max(-1, Math.min(1, opts.emotion))
  let rate = st.rate * opts.rate * (1 + 0.15 * e)
  let pitch = st.pitch * opts.pitch * (1 + 0.1 * e)
  let pause = (s.blockEnd || s.kind === 'heading' ? st.pauseBlock : st.pauseSentence) * (1 - 0.3 * e)
  if (opts.sentiment) {
    const v = sentimentOf(s.text)
    pitch *= 1 + 0.06 * v
    rate *= 1 + 0.04 * v
  }
  if (/!\s*$/.test(s.text)) pitch *= 1.06
  if (/\?\s*$/.test(s.text)) pitch *= 1.04
  if (st.emphasis && s.kind === 'heading') pause += 250
  if (s.kind === 'heading' && st.headings === 'chapter') rate *= 0.92
  return {
    rate: Math.max(0.5, Math.min(3, rate)),
    pitch: Math.max(0.5, Math.min(2, pitch)),
    volume: Math.max(0, Math.min(1, opts.volume)),
    pauseAfter: Math.max(0, Math.round(pause))
  }
}

/** The language a sentence's script suggests, for automatic voice switching. */
export function scriptLanguage(text: string): string | null {
  if (/[ऀ-ॿ]/.test(text)) return 'hi'
  if (/[஀-௿]/.test(text)) return 'ta'
  if (/[ಀ-೿]/.test(text)) return 'kn'
  if (/[ఀ-౿]/.test(text)) return 'te'
  if (/[ഀ-ൿ]/.test(text)) return 'ml'
  if (/[ঀ-৿]/.test(text)) return 'bn'
  if (/[઀-૿]/.test(text)) return 'gu'
  if (/[਀-੿]/.test(text)) return 'pa'
  if (/[؀-ۿ]/.test(text)) return 'ur'
  return null
}

/* ---------------------------------------------------------------- player */

export type ReadState = 'idle' | 'playing' | 'paused'

export interface ReadEvents {
  onState: (state: ReadState) => void
  onSentence: (index: number, total: number) => void
  /** A message for the bar, e.g. that natural voices fell back. */
  onNote?: (note: string) => void
  /** The natural voice is getting ready (true) or ready (false). */
  onPreparing?: (preparing: boolean) => void
}

/** What read aloud needs from the natural-voice engine (see naturalVoice.ts). */
export interface NaturalEngine {
  make(key: string, text: string, voice: string, speed: number): Promise<{ samples: Float32Array; rate: number }>
  play(a: { samples: Float32Array; rate: number }, opts: { volume: number; detuneCents: number }, onStart: (durationS: number) => void): Promise<void>
  pause(): void
  resume(): void
  stopPlayback(): void
  forget(): void
  currentTime(): number
}

const SENTENCE_HL = 'mn-read-sentence'
const WORD_HL = 'mn-read-word'

interface HighlightRegistry {
  set: (name: string, h: unknown) => void
  delete: (name: string) => void
}
const highlights = (): HighlightRegistry | null =>
  (globalThis as unknown as { CSS?: { highlights?: HighlightRegistry } }).CSS?.highlights ?? null
const HighlightCtor = (): (new (...r: Range[]) => unknown) | null =>
  (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight ?? null

export class ReadAloud {
  private sentences: ReadSentence[] = []
  private index = 0
  private state: ReadState = 'idle'
  private timer: number | null = null
  private token = 0
  private scroller: HTMLElement | null = null
  /** The sentence now playing is natural-voice audio (pause can hold it). */
  private naturalPlaying = false
  private wordLoop: number | null = null
  private naturalFailed = false

  constructor(
    private opts: ReadOptions,
    private readonly events: ReadEvents,
    private readonly natural: NaturalEngine | null = null
  ) {}

  setOptions(opts: ReadOptions): void {
    const voiceChanged = opts.naturalVoice !== this.opts.naturalVoice || opts.engine !== this.opts.engine
    this.opts = opts
    if (voiceChanged) {
      this.natural?.forget()
      this.naturalFailed = false
    }
  }

  get current(): number {
    return this.index
  }

  get total(): number {
    return this.sentences.length
  }

  /** Loads the document's sentences; `from` picks where to begin. */
  load(sentences: ReadSentence[], from = 0, scroller: HTMLElement | null = null): void {
    this.stop()
    this.sentences = sentences
    this.index = Math.max(0, Math.min(from, sentences.length - 1))
    this.scroller = scroller
    this.events.onSentence(this.index, sentences.length)
  }

  play(): void {
    if (!this.sentences.length) return
    this.state = 'playing'
    this.events.onState('playing')
    this.speak()
  }

  pause(): void {
    if (this.state !== 'playing') return
    if (this.naturalPlaying && this.natural) {
      // Natural audio really pauses, mid-word, and carries on from there.
      this.natural.pause()
      this.state = 'paused'
      this.events.onState('paused')
      return
    }
    // Cancel and replay the sentence on resume: pause() on Chromium's speech
    // engine is unreliable and can stall for good.
    this.token++
    this.clearTimer()
    speechSynthesis.cancel()
    this.state = 'paused'
    this.events.onState('paused')
  }

  resume(): void {
    if (this.state !== 'paused') return
    if (this.naturalPlaying && this.natural) {
      this.natural.resume()
      this.state = 'playing'
      this.events.onState('playing')
      return
    }
    this.play()
  }

  stop(): void {
    this.token++
    this.clearTimer()
    this.stopNatural()
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
    this.state = 'idle'
    this.clearHighlights()
    this.events.onState('idle')
  }

  next(): void {
    this.jump(this.index + 1)
  }

  prev(): void {
    this.jump(this.index - 1)
  }

  jump(i: number): void {
    if (!this.sentences.length) return
    this.index = Math.max(0, Math.min(i, this.sentences.length - 1))
    this.events.onSentence(this.index, this.sentences.length)
    if (this.state === 'playing' || this.state === 'paused') {
      this.token++
      this.clearTimer()
      this.stopNatural()
      speechSynthesis.cancel()
      this.state = 'playing'
      this.events.onState('playing')
      this.speak()
    } else this.mark(this.sentences[this.index], null)
  }

  private stopNatural(): void {
    if (this.wordLoop !== null) cancelAnimationFrame(this.wordLoop)
    this.wordLoop = null
    if (this.naturalPlaying) this.natural?.stopPlayback()
    this.naturalPlaying = false
  }

  /** Speed and pitch for natural audio: pitch is a detune, which also speeds
   * playback, so the voice is asked to speak slower by the same factor. */
  private naturalParams(s: ReadSentence): { speed: number; cents: number; key: string; p: Prosody } {
    const p = prosodyFor(s, this.opts)
    const cents = Math.round(1200 * Math.log2(p.pitch))
    const speed = Math.max(0.5, Math.min(2, p.rate / p.pitch))
    return { speed, cents, p, key: `${s.spoken}|${this.opts.naturalVoice}|${speed.toFixed(2)}` }
  }

  private useNatural(s: ReadSentence): boolean {
    return this.opts.engine === 'natural' && !!this.natural && !this.naturalFailed && !scriptLanguage(s.text)
  }

  private speakNatural(s: ReadSentence, token: number): void {
    const n = this.natural!
    const { speed, cents, p, key } = this.naturalParams(s)
    this.mark(s, null)
    this.scrollTo(s)
    this.events.onSentence(this.index, this.sentences.length)
    const audio = n.make(key, s.spoken, this.opts.naturalVoice, speed)
    // Make the next two sentences while this one plays, so there is no gap.
    for (let k = 1; k <= 2; k++) {
      const nx = this.sentences[this.index + k]
      if (nx && this.useNatural(nx)) {
        const q = this.naturalParams(nx)
        void n.make(q.key, nx.spoken, this.opts.naturalVoice, q.speed).catch(() => undefined)
      }
    }
    let waiting = true
    const slow = window.setTimeout(() => {
      if (waiting && token === this.token) this.events.onPreparing?.(true)
    }, 400)
    audio
      .then((a) => {
        waiting = false
        window.clearTimeout(slow)
        this.events.onPreparing?.(false)
        if (token !== this.token) return
        this.naturalPlaying = true
        const words = [...s.text.matchAll(/\S+/g)].map((m) => ({ start: m.index!, end: m.index! + m[0].length }))
        const totalChars = words.reduce((t, w) => t + (w.end - w.start) + 1, 0) || 1
        return n
          .play(a, { volume: p.volume, detuneCents: cents }, (duration) => {
            // Words lit in step with the audio, by their share of the
            // sentence's letters; the clock stops while paused.
            const t0 = n.currentTime()
            let last = -1
            const tick = (): void => {
              if (token !== this.token) return
              const f = Math.max(0, (n.currentTime() - t0) / Math.max(0.1, duration))
              let acc = 0
              let wi = words.length - 1
              for (let i = 0; i < words.length; i++) {
                acc += (words[i].end - words[i].start + 1) / totalChars
                if (f <= acc) {
                  wi = i
                  break
                }
              }
              if (wi !== last && words[wi]) {
                last = wi
                this.mark(s, rangeOf(s, words[wi].start, words[wi].end))
              }
              this.wordLoop = requestAnimationFrame(tick)
            }
            this.wordLoop = requestAnimationFrame(tick)
          })
          .then(() => {
            if (this.wordLoop !== null) cancelAnimationFrame(this.wordLoop)
            this.wordLoop = null
            this.naturalPlaying = false
            if (token !== this.token || this.state !== 'playing') return
            this.timer = window.setTimeout(() => {
              if (token !== this.token) return
              if (this.index >= this.sentences.length - 1) {
                this.stop()
                return
              }
              this.index++
              this.speak()
            }, p.pauseAfter)
          })
      })
      .catch((err) => {
        window.clearTimeout(slow)
        this.events.onPreparing?.(false)
        if (token !== this.token) return
        // No usable graphics chip, or the model could not load: carry on with
        // the computer's own voices rather than stopping.
        this.naturalFailed = true
        this.naturalPlaying = false
        this.events.onNote?.(`Natural voice unavailable (${err instanceof Error ? err.message : String(err)}). Using this computer's voices instead.`)
        this.speak()
      })
  }

  private clearTimer(): void {
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = null
  }

  private clearHighlights(): void {
    const h = highlights()
    h?.delete(SENTENCE_HL)
    h?.delete(WORD_HL)
  }

  private mark(s: ReadSentence, word: Range | null): void {
    const h = highlights()
    const H = HighlightCtor()
    if (!h || !H) return
    const r = rangeOf(s)
    if (r) h.set(SENTENCE_HL, new H(r))
    if (word) h.set(WORD_HL, new H(word))
    else h.delete(WORD_HL)
  }

  private scrollTo(s: ReadSentence): void {
    const r = rangeOf(s)
    const box = r?.getBoundingClientRect()
    const sc = this.scroller
    if (!box || !sc) return
    const view = sc.getBoundingClientRect()
    if (box.top < view.top + 60 || box.bottom > view.bottom - 80) {
      sc.scrollTo({ top: sc.scrollTop + box.top - view.top - view.height / 3, behavior: 'smooth' })
    }
  }

  private pickVoice(s: ReadSentence): SpeechSynthesisVoice | null {
    const voices = speechSynthesis.getVoices()
    if (this.opts.autoLanguage) {
      const lang = scriptLanguage(s.text)
      if (lang) {
        const v = voices.find((x) => x.lang.toLowerCase().startsWith(lang))
        if (v) return v
      }
    }
    return voices.find((v) => v.voiceURI === this.opts.voiceURI) ?? null
  }

  private speak(): void {
    const s = this.sentences[this.index]
    if (!s) {
      this.stop()
      return
    }
    const token = ++this.token
    if (this.useNatural(s)) {
      this.speakNatural(s, token)
      return
    }
    const p = prosodyFor(s, this.opts)
    const u = new SpeechSynthesisUtterance(s.spoken)
    const voice = this.pickVoice(s)
    if (voice) {
      u.voice = voice
      u.lang = voice.lang
    }
    u.rate = p.rate
    u.pitch = p.pitch
    u.volume = p.volume
    this.mark(s, null)
    this.scrollTo(s)
    this.events.onSentence(this.index, this.sentences.length)

    u.onboundary = (e) => {
      if (token !== this.token || e.name !== 'word') return
      const start = e.charIndex - s.spokenOffset
      if (start < 0 || start >= s.text.length) return
      const len = e.charLength || (/^[^\s.,;:!?]+/.exec(s.text.slice(start))?.[0].length ?? 0)
      this.mark(s, rangeOf(s, start, start + len))
    }
    const advance = (): void => {
      if (token !== this.token || this.state !== 'playing') return
      this.timer = window.setTimeout(() => {
        if (token !== this.token) return
        if (this.index >= this.sentences.length - 1) {
          this.stop()
          return
        }
        this.index++
        this.speak()
      }, p.pauseAfter)
    }
    u.onend = advance
    u.onerror = (e) => {
      // 'interrupted'/'canceled' come from our own cancel(); anything else is
      // skipped past rather than stopping the reading.
      if (e.error === 'interrupted' || e.error === 'canceled') return
      advance()
    }
    speechSynthesis.speak(u)
  }
}

/** The index of the first sentence at or below the top of the visible area. */
export function firstVisible(sentences: ReadSentence[], scroller: HTMLElement | null): number {
  if (!scroller) return 0
  const top = scroller.getBoundingClientRect().top
  for (let i = 0; i < sentences.length; i++) {
    const r = rangeOf(sentences[i])?.getBoundingClientRect()
    if (r && r.bottom > top + 4) return i
  }
  return 0
}
