/**
 * The dictation panel: a microphone button, what is happening, and the
 * choices that matter (model, language, translate, voice commands).
 *
 * Text goes in at the editor's cursor through `onActions`, which the caller
 * applies; this component never touches the document itself.
 *
 * Kept identical across the Windows app and the web app.
 */
import { useEffect, useRef, useState } from 'react'
import {
  Dictation,
  MODEL_SIZES_MB,
  type DictationHost,
  type DictationSettings,
  type DictationState
} from '../lib/speech/dictation'
import { DICTATION_LANGUAGES, type DictationAction } from '../lib/speech/commands'

interface Props {
  settings: DictationSettings
  host: DictationHost
  /** Whether this model has been downloaded before (null = unknown). */
  modelCached: (model: DictationSettings['model']) => Promise<boolean | null>
  onSettings: (next: DictationSettings) => void
  onActions: (actions: DictationAction[]) => void
  onClose: () => void
  /** Bumped by the app's shortcut (Ctrl+Shift+D) to start or stop listening. */
  toggleSignal: number
}

const STATE_TEXT: Record<DictationState, string> = {
  idle: 'Press the microphone and start speaking.',
  loading: 'Getting the speech model ready…',
  listening: 'Listening…',
  transcribing: 'Writing…',
  error: 'Something went wrong.'
}

export default function DictationPanel(props: Props): React.JSX.Element {
  const { settings } = props
  const [state, setState] = useState<DictationState>('idle')
  const [detail, setDetail] = useState('')
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null)
  const [level, setLevel] = useState(0)
  const [heard, setHeard] = useState('')
  const [cached, setCached] = useState<boolean | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [showOptions, setShowOptions] = useState(false)
  const dictation = useRef<Dictation | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props

  if (!dictation.current) {
    dictation.current = new Dictation(settings, props.host, {
      onState: (s, d) => {
        setState(s)
        setDetail(d ?? '')
        if (s !== 'loading') setProgress(null)
      },
      onProgress: (loaded, total) => setProgress({ loaded, total }),
      onLevel: setLevel,
      onActions: (actions, text) => {
        setHeard(text)
        if (actions.some((a) => a.kind === 'stop')) dictation.current?.stop()
        propsRef.current.onActions(actions)
      }
    })
  }

  useEffect(() => {
    dictation.current?.update(settings)
    void props.modelCached(settings.model).then(setCached)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings])

  useEffect(() => () => dictation.current?.dispose(), [])

  const listening = state === 'listening' || state === 'transcribing'
  const toggle = async (): Promise<void> => {
    const d = dictation.current!
    if (d.listening) {
      d.stop()
      return
    }
    try {
      await d.start()
      setCached(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setState('error')
      setDetail(
        /Permission|NotAllowed|denied/i.test(msg)
          ? 'The microphone is blocked. Allow it for this app (Windows: Settings → Privacy & security → Microphone), then try again.'
          : /NotFound|no.*device/i.test(msg)
            ? 'No microphone was found.'
            : msg
      )
    }
  }

  // The shortcut that opened the panel starts and stops listening.
  const firstSignal = useRef(props.toggleSignal)
  useEffect(() => {
    if (props.toggleSignal !== firstSignal.current) void toggle()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.toggleSignal])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !listening) props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const set = (patch: Partial<DictationSettings>): void => props.onSettings({ ...settings, ...patch })
  const size = MODEL_SIZES_MB[settings.model]

  const langName = DICTATION_LANGUAGES.find(([c]) => c === settings.language)?.[1] ?? settings.language
  const summary = `${settings.model === 'small' ? 'Accurate' : 'Fast'} · ${langName}${settings.translate ? ' → English' : ''}${settings.commands ? ' · commands on' : ''}`

  // A slim bar docked above the status bar: it takes its own row, so the
  // document shrinks to make room instead of being covered.
  return (
    <div className="dictation-panel" data-mn-ignore role="region" aria-label="Dictation">
      <div className="dict-row">
        <button
          className={`dict-mic${listening ? ' on' : ''}`}
          onClick={() => void toggle()}
          disabled={state === 'loading'}
          title={listening ? 'Stop (Ctrl+Shift+D)' : 'Start dictation (Ctrl+Shift+D)'}
          aria-pressed={listening}
        >
          <span className="dict-mic-icon">🎙</span>
          <span className="dict-level" style={{ transform: `scale(${1 + level * 0.9})` }} />
        </button>
        <div className="dict-status">
          <span className="dict-state">{state === 'error' ? detail || STATE_TEXT.error : STATE_TEXT[state]}</span>
          {progress && progress.total > 0 ? (
            <span className="dict-progress" title="One-time download">
              <span className="dict-progress-fill" style={{ width: `${Math.min(100, (progress.loaded / progress.total) * 100)}%` }} />
              <span className="dict-progress-text">
                {progress.loaded.toFixed(0)} / {progress.total.toFixed(0)} MB
              </span>
            </span>
          ) : heard && state !== 'error' ? (
            <span className="dict-heard" title={`Last thing heard: ${heard}`}>
              “{heard}”
            </span>
          ) : cached === false && state === 'idle' ? (
            <span className="dict-note" title="Your voice never leaves this device.">
              First use downloads the speech model once (about {size.cpu}–{size.gpu} MB), then works offline.
            </span>
          ) : null}
        </div>
        <button className="dict-summary" onClick={() => setShowOptions((v) => !v)} title="Model, language and voice commands">
          {summary} {showOptions ? '▾' : '▸'}
        </button>
        <button className="dict-close" onClick={props.onClose} title="Close (Esc)" aria-label="Close">
          ✕
        </button>
      </div>

      {showOptions && (
        <div className="dict-options">
          <label title="Accurate copes better with accents and noise; Fast suits older PCs">
            <span>Model</span>
            <select value={settings.model} onChange={(e) => set({ model: e.target.value as DictationSettings['model'] })} disabled={listening}>
              <option value="base">Fast</option>
              <option value="small">Accurate</option>
            </select>
          </label>
          <label>
            <span>Language</span>
            <select value={settings.language} onChange={(e) => set({ language: e.target.value })}>
              {DICTATION_LANGUAGES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="dict-check" title="Speak any language, get English text">
            <input type="checkbox" checked={settings.translate} onChange={(e) => set({ translate: e.target.checked })} />
            <span>Translate to English</span>
          </label>
          <label className="dict-check">
            <input type="checkbox" checked={settings.commands} onChange={(e) => set({ commands: e.target.checked })} />
            <span>Voice commands</span>
          </label>
          <button className="link" onClick={() => setShowHelp((v) => !v)}>
            {showHelp ? 'Hide commands' : 'Commands…'}
          </button>
          {showHelp && (
            <div className="dict-help">
              Say: <b>new line</b>, <b>new paragraph</b>, <b>full stop</b>, <b>comma</b>, <b>question mark</b>,{' '}
              <b>exclamation mark</b>, <b>colon</b>, <b>bullet point</b>, <b>numbered point</b>, <b>heading</b>,{' '}
              <b>open / close bracket</b>, <b>open / close quote</b>, <b>undo that</b>, <b>stop dictation</b>.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
