/**
 * The read-aloud bar, docked above the status bar like the dictation bar:
 * play/pause, stop, previous/next sentence, the reading style, speed and a
 * fold-out of finer controls (pitch, volume, emotion, sentiment, voice,
 * skipping code or tables, reading only highlights, a sleep timer).
 *
 * Reads the rendered document in `.preview-host .markdown-body`, from the
 * selection if there is one, otherwise from the first line on screen.
 *
 * Kept identical across the Windows app and the web app.
 */
import { useEffect, useRef, useState } from 'react'
import {
  ReadAloud,
  READ_STYLES,
  collectSentences,
  firstVisible,
  rangeOf,
  type ReadOptions,
  type ReadState,
  type StyleId
} from '../lib/speech/readAloud'
import { NaturalVoice, NATURAL_VOICES, NATURAL_MODEL_MB, NATURAL_VOICES_READY } from '../lib/speech/naturalVoice'
import { AudiobookPlayer, parseSidecar } from '../lib/speech/audiobook'

interface Props {
  options: ReadOptions
  onOptions: (next: ReadOptions) => void
  onClose: () => void
  /** Bumped by the app's shortcut to play or pause. */
  toggleSignal: number
  /** The reader's own audiobook for this document (beside it, or linked), if any. */
  audiobook?: { name: string; url: string; sidecar: string | null; linked: boolean } | null
  onLinkAudiobook?: () => void
  onUnlinkAudiobook?: () => void
}

const SLEEP_CHOICES: Array<[number, string]> = [
  [0, 'Off'],
  [10, '10 min'],
  [20, '20 min'],
  [30, '30 min'],
  [60, '1 hour']
]

/**
 * The computer's voices that sound natural (Windows "Natural"/neural and
 * online voices). The classic voices (David, Zira, Heera…) sound robotic and
 * are not offered.
 */
function naturalSystemVoices(): SpeechSynthesisVoice[] {
  return speechSynthesis.getVoices().filter((v) => /natural|neural/i.test(v.name))
}

function documentRoot(): { root: HTMLElement | null; scroller: HTMLElement | null } {
  const root = document.querySelector('.preview-host .markdown-body') as HTMLElement | null
  return { root, scroller: (root?.closest('.preview-scroll') as HTMLElement | null) ?? null }
}

export default function ReadAloudPanel(props: Props): React.JSX.Element {
  const { options } = props
  const [state, setState] = useState<ReadState>('idle')
  const [pos, setPos] = useState<{ i: number; n: number }>({ i: 0, n: 0 })
  const [more, setMore] = useState(false)
  const [info, setInfo] = useState(false)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [sleep, setSleep] = useState(0)
  const [note, setNote] = useState('')
  const [preparing, setPreparing] = useState(false)
  const [download, setDownload] = useState<{ l: number; t: number } | null>(null)
  const [gpuOk, setGpuOk] = useState<boolean | null>(null)
  /** Natural voices are off (not ready yet, or no usable graphics chip). */
  const naturalOff = !NATURAL_VOICES_READY || gpuOk === false
  const player = useRef<ReadAloud | null>(null)
  const natural = useRef<NaturalVoice | null>(null)
  const sleepTimer = useRef<number | null>(null)

  if (!player.current) {
    natural.current = new NaturalVoice({
      onProgress: (l, t) => setDownload(t > 0 && l < t ? { l, t } : null)
    })
    player.current = new ReadAloud(
      options,
      {
        onState: setState,
        onSentence: (i, n) => setPos({ i, n }),
        onNote: setNote,
        onPreparing: setPreparing
      },
      natural.current
    )
  }

  useEffect(() => {
    void NaturalVoice.supported().then(setGpuOk)
    return () => natural.current?.dispose()
  }, [])

  useEffect(() => {
    // Without a usable graphics chip, natural voices are too slow to read
    // live; the computer's voices are used instead.
    // A saved choice of a hidden (robotic) voice falls back to a natural one.
    const known = !options.voiceURI || voices.some((v) => v.voiceURI === options.voiceURI)
    const o = known ? options : { ...options, voiceURI: null }
    player.current?.setOptions(naturalOff ? { ...o, engine: 'system' } : !voices.length ? { ...o, engine: 'natural' } : o)
  }, [options, naturalOff, voices])

  useEffect(() => {
    const load = (): void => setVoices(naturalSystemVoices())
    load()
    speechSynthesis.addEventListener('voiceschanged', load)
    return () => {
      speechSynthesis.removeEventListener('voiceschanged', load)
      player.current?.stop()
      if (sleepTimer.current) window.clearTimeout(sleepTimer.current)
    }
  }, [])

  const set = (patch: Partial<ReadOptions>): void => props.onOptions({ ...options, ...patch })

  /*
   * The reader's own audiobook (Book2Audio's .m4b, or any .m4b / .mp3):
   * offered first when there is one, since it is their own recording.
   */
  const book = useRef<AudiobookPlayer | null>(null)
  const [bookChosen, setBookChosen] = useState(true)
  const audiobook = props.audiobook ?? null
  const useBook = !!audiobook && bookChosen
  useEffect(() => {
    book.current?.dispose()
    book.current = audiobook?.url
      ? new AudiobookPlayer(audiobook.url, parseSidecar(audiobook.sidecar), {
          onState: setState,
          onSentence: (i, n) => setPos({ i, n }),
          onNote: setNote
        })
      : null
    return () => {
      book.current?.dispose()
      book.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audiobook?.url, audiobook?.sidecar])
  useEffect(() => {
    book.current?.setRate(options.rate)
    book.current?.setVolume(options.volume)
  }, [options.rate, options.volume, audiobook?.url])

  /** Starts the audiobook at a sentence of the page (matching it to the timing first). */
  const startBook = (sentences: ReturnType<typeof collectSentences>, from: number, scroller: HTMLElement | null): void => {
    const b = book.current
    if (!b) return
    player.current?.stop()
    const { matched, total } = b.setDocument(sentences, scroller)
    if (!audiobook?.sidecar) setNote(`Playing ${audiobook?.name}: no Book2Audio timing file (.b2a.json) beside it, so the text is not highlighted.`)
    else if (!matched) setNote('The audiobook’s timing file does not match this document’s text, so the text is not highlighted.')
    else if (matched < total * 0.8) setNote(`Highlighting matched ${matched} of ${total} paragraphs of the audiobook.`)
    else setNote('')
    void b.play(b.hasTiming ? from : undefined).catch(() => setNote('The audiobook could not be played.'))
  }

  /** Gathers the document's sentences and starts from the selection or the screen. */
  const start = (): void => {
    const { root, scroller } = documentRoot()
    if (!root) {
      setNote('Nothing to read here.')
      return
    }
    let sentences = collectSentences(root, options)
    const sel = window.getSelection()
    let from = 0
    if (sel && !sel.isCollapsed && sel.rangeCount && root.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0)
      const chosen = sentences.filter((s) => {
        const r = rangeOf(s)
        return !!r && r.compareBoundaryPoints(Range.END_TO_START, range) < 0 && r.compareBoundaryPoints(Range.START_TO_END, range) > 0
      })
      if (chosen.length) sentences = chosen
      setNote(chosen.length ? `Reading the selection (${chosen.length} sentence${chosen.length === 1 ? '' : 's'}).` : '')
    } else {
      from = firstVisible(sentences, scroller)
      setNote(options.highlightsOnly ? 'Reading your highlights and notes only.' : '')
    }
    if (!sentences.length) {
      setNote(options.highlightsOnly ? 'This document has no highlights to read.' : 'Nothing to read here.')
      return
    }
    if (sleepTimer.current) window.clearTimeout(sleepTimer.current)
    if (sleep > 0) sleepTimer.current = window.setTimeout(() => (player.current?.stop(), book.current?.stop()), sleep * 60_000)
    if (useBook) {
      // The audiobook is the whole book: start where the selection or screen is.
      const all = collectSentences(root, options)
      const at = all.findIndex((x) => x.segs[0]?.node === sentences[from]?.segs[0]?.node && x.text === sentences[from]?.text)
      startBook(all, Math.max(0, at), scroller)
      return
    }
    player.current!.load(sentences, from, scroller)
    player.current!.play()
  }

  // Double-click any sentence in the document to read from there on.
  useEffect(() => {
    const onDbl = (e: MouseEvent): void => {
      const { root, scroller } = documentRoot()
      if (!root || !(e.target instanceof Node) || !root.contains(e.target)) return
      const caret = document.caretRangeFromPoint?.(e.clientX, e.clientY)
      if (!caret) return
      const sentences = collectSentences(root, options)
      const at = sentences.findIndex((s) => {
        const r = rangeOf(s)
        try {
          return !!r && r.isPointInRange(caret.startContainer, caret.startOffset)
        } catch {
          return false
        }
      })
      if (at < 0) return
      e.preventDefault()
      e.stopPropagation()
      window.getSelection()?.removeAllRanges()
      natural.current?.unlock()
      setNote('')
      if (useBook) return startBook(sentences, at, scroller)
      player.current!.load(sentences, at, scroller)
      player.current!.play()
    }
    document.addEventListener('dblclick', onDbl, true)
    return () => document.removeEventListener('dblclick', onDbl, true)
  }, [options, useBook])

  const playPause = (): void => {
    const p = player.current!
    // A remembered audiobook the browser needs permission for again: the
    // press is what lets it ask.
    if (useBook && !audiobook?.url) return props.onLinkAudiobook?.()
    if (useBook && book.current) {
      const a = book.current.audio
      if (state === 'playing') book.current.pause()
      else if (state === 'paused') void a.play()
      else start()
      return
    }
    // Sound may only start from a press, so wake the audio now, not when the
    // first sentence is ready a few seconds later.
    if (state !== 'playing') natural.current?.unlock()
    if (state === 'playing') p.pause()
    else if (state === 'paused') p.resume()
    else start()
  }

  const first = useRef(props.toggleSignal)
  useEffect(() => {
    if (props.toggleSignal !== first.current) playPause()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.toggleSignal])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && state !== 'playing') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const style = READ_STYLES.find((s) => s.id === options.style) ?? READ_STYLES[0]
  // Only natural-sounding voices are offered; the older robotic Windows
  // voices are hidden (see naturalSystemVoices).
  const english = voices.filter((v) => /^en/i.test(v.lang))
  const others = voices.filter((v) => !/^en/i.test(v.lang))

  return (
    <div className="read-panel" data-mn-ignore role="region" aria-label="Read aloud">
      <div className="dict-row">
        <div className="read-transport">
          <button className="read-btn" onClick={() => (useBook ? book.current?.step(-1) : player.current?.prev())} disabled={state === 'idle'} title="Previous sentence">
            ⏮
          </button>
          <button className={`read-play${state === 'playing' ? ' on' : ''}`} onClick={playPause} title={state === 'playing' ? 'Pause' : 'Read aloud'}>
            {state === 'playing' ? '⏸' : '▶'}
          </button>
          <button className="read-btn" onClick={() => (useBook ? book.current?.step(1) : player.current?.next())} disabled={state === 'idle'} title="Next sentence">
            ⏭
          </button>
          <button className="read-btn" onClick={() => (useBook ? book.current?.stop() : player.current?.stop())} disabled={state === 'idle'} title="Stop">
            ⏹
          </button>
        </div>
        <div className="dict-status">
          <span className="dict-state">
            {download
              ? `Downloading the natural voice once: ${download.l.toFixed(0)} / ${download.t.toFixed(0)} MB`
              : preparing
                ? 'Preparing the voice…'
                : state === 'idle'
                  ? 'Press ▶'
                  : `${state === 'paused' ? 'Paused · ' : ''}Sentence ${pos.i + 1} of ${pos.n}`}
          </span>
          {note && (
            <span className="dict-note" title={note}>
              {note}
            </span>
          )}
        </div>
        <label className="read-inline" title={options.engine === 'natural' ? 'Natural voice (English)' : 'Voice'}>
          <select
            value={useBook ? '__book' : (options.engine === 'natural' || !voices.length) && !naturalOff ? options.naturalVoice : 'system'}
            onChange={(e) => {
              const v = e.target.value
              if (v === '__link') return props.onLinkAudiobook?.()
              if (v === '__unlink') return props.onUnlinkAudiobook?.()
              if (state !== 'idle') (useBook ? book.current?.stop() : player.current?.stop())
              if (v === '__book') return setBookChosen(true)
              setBookChosen(false)
              if (v === 'system') set({ engine: 'system' })
              else set({ engine: 'natural', naturalVoice: v })
            }}
          >
            {audiobook && (
              <optgroup label="Your audiobook">
                <option value="__book">
                  🎧 {audiobook.name}
                  {audiobook.url ? '' : ' (press ▶ to allow)'}
                </option>
              </optgroup>
            )}
            {!naturalOff && (
              <>
                <optgroup label="Natural voices (English)">
                  {NATURAL_VOICES.filter((v) => v.gender === 'Female').map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} · {v.accent} female · {v.note}
                    </option>
                  ))}
                </optgroup>
                <optgroup label=" ">
                  {NATURAL_VOICES.filter((v) => v.gender === 'Male').map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} · {v.accent} male · {v.note}
                    </option>
                  ))}
                </optgroup>
              </>
            )}
            {voices.length > 0 && <option value="system">Windows natural voices</option>}
            {naturalOff && !voices.length && (
              <option value="system" disabled>
                Natural voices are not available on this computer
              </option>
            )}
            {props.onLinkAudiobook && (
              <optgroup label="Audiobook">
                <option value="__link">{audiobook ? 'Link a different audiobook…' : '🎧 Link an audiobook (.m4b / .mp3)…'}</option>
                {audiobook?.linked && <option value="__unlink">Unlink this audiobook</option>}
              </optgroup>
            )}
          </select>
        </label>
        <label className="read-inline" title="Reading style">
          <select value={options.style} onChange={(e) => set({ style: e.target.value as StyleId })}>
            {READ_STYLES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="read-inline read-speed" title="Speed (double-click a sentence to start there)">
          <span>Speed</span>
          <span className="read-speed-box">
            <span className="read-speed-value">{(useBook ? options.rate : options.rate * style.rate).toFixed(2)}×</span>
            <input type="range" min={0.5} max={2.5} step={0.05} value={options.rate} onChange={(e) => set({ rate: Number(e.target.value) })} />
          </span>
        </label>
        <button className="dict-summary" onClick={() => setMore((v) => !v)} title="Pitch, emotion, voice and more">
          More {more ? '▾' : '▸'}
        </button>
        <button
          className={`read-info${info ? ' on' : ''}`}
          onClick={() => setInfo((v) => !v)}
          title="About the voices"
          aria-label="About the voices"
          aria-expanded={info}
        >
          i
        </button>
        <button className="dict-close" onClick={props.onClose} title="Close (Esc)" aria-label="Close">
          ✕
        </button>
      </div>

      {more && (
        <div className="dict-options">
          {voices.length > 0 && <label title="Higher or lower voice (Windows voices only: Kokoro voices keep their own pitch so they stay human)">
            <span>Pitch</span>
            <input type="range" min={0.6} max={1.6} step={0.05} value={options.pitch} onChange={(e) => set({ pitch: Number(e.target.value) })} />
          </label>}
          <label>
            <span>Volume</span>
            <input type="range" min={0} max={1} step={0.05} value={options.volume} onChange={(e) => set({ volume: Number(e.target.value) })} />
          </label>
          <label title="Calm reads slower and lower with longer pauses; energetic reads brighter and quicker. The voices cannot act, so this shapes the delivery.">
            <span>Calm</span>
            <input type="range" min={-1} max={1} step={0.1} value={options.emotion} onChange={(e) => set({ emotion: Number(e.target.value) })} />
            <span>Energetic</span>
          </label>
          <label className="dict-check" title="Lifts happy sentences a little and slows sad ones, from a small offline word list">
            <input type="checkbox" checked={options.sentiment} onChange={(e) => set({ sentiment: e.target.checked })} />
            <span>Follow the mood of each sentence</span>
          </label>
          {voices.length > 0 && (
          <>
          <label title="Windows natural voices, used for other languages and when “Windows natural voices” is chosen">
            <span>Windows voice</span>
            <select value={options.voiceURI ?? voices[0].voiceURI} onChange={(e) => set({ voiceURI: e.target.value || null })}>
              <optgroup label="English">
                {english.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name}
                  </option>
                ))}
              </optgroup>
              {others.length > 0 && (
                <optgroup label="Other languages">
                  {others.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>
                      {v.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <label className="dict-check" title="Hindi, Tamil and other scripts are read by a voice for that language when Windows has one">
            <input type="checkbox" checked={options.autoLanguage} onChange={(e) => set({ autoLanguage: e.target.checked })} />
            <span>Switch voice for other languages</span>
          </label>
          </>
          )}
          <label className="dict-check">
            <input type="checkbox" checked={options.skipCode} onChange={(e) => set({ skipCode: e.target.checked })} />
            <span>Skip code</span>
          </label>
          <label className="dict-check">
            <input type="checkbox" checked={options.skipTables} onChange={(e) => set({ skipTables: e.target.checked })} />
            <span>Skip tables</span>
          </label>
          <label className="dict-check" title="Read only the passages you have highlighted, underlined or commented">
            <input type="checkbox" checked={options.highlightsOnly} onChange={(e) => set({ highlightsOnly: e.target.checked })} />
            <span>My highlights only</span>
          </label>
          <label>
            <span>Sleep timer</span>
            <select value={sleep} onChange={(e) => setSleep(Number(e.target.value))}>
              {SLEEP_CHOICES.map(([m, l]) => (
                <option key={m} value={m}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {info && (
        <div className="read-info-pop" role="note">
          {!NATURAL_VOICES_READY
            ? 'Reading uses this computer’s voices. More natural voices are coming in an update.'
            : gpuOk === false
            ?'Natural voices need a graphics chip that this computer does not offer; the computer’s own voices are used.'
            : `Natural voices: Kokoro, free and offline after a one-time ${NATURAL_MODEL_MB} MB download; English for now, more languages coming.`}{' '}
          Double-click any sentence to read from there. Changes apply from the next sentence.
        </div>
      )}
    </div>
  )
}
