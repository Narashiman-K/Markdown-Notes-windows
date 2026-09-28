/**
 * The floating control bar shown while reading.
 *
 * Deliberately faint until pointed at. These are occasional adjustments, and
 * a solid bar hovering over the text would be exactly the chrome that reader
 * mode exists to remove.
 *
 * Kept identical to the copy in the Windows app. Change one, copy it across.
 */
import {
  PALETTE_LABELS,
  step,
  type ReaderSettings,
  type ReaderPalette
} from '../lib/reader'

interface Props {
  settings: ReaderSettings
  onChange: (next: ReaderSettings) => void
  onExit: () => void
}

export default function ReaderControls({ settings, onChange, onExit }: Props): React.JSX.Element {
  const stepper = (
    key: 'width' | 'size' | 'spacing',
    title: string,
    less: string,
    more: string
  ): React.JSX.Element => {
    const atMin = step(settings, key, -1)[key] === settings[key]
    const atMax = step(settings, key, 1)[key] === settings[key]
    return (
      <div className="group" title={title}>
        <button onClick={() => onChange(step(settings, key, -1))} disabled={atMin} aria-label={`${title}: less`}>
          {less}
        </button>
        <span className="label">{settings[key]}</span>
        <button onClick={() => onChange(step(settings, key, 1))} disabled={atMax} aria-label={`${title}: more`}>
          {more}
        </button>
      </div>
    )
  }

  return (
    <div className="reader-bar" data-mn-ignore role="toolbar" aria-label="Reading controls">
      {stepper('size', 'Text size', 'A−', 'A+')}
      <span className="sep" />
      {stepper('width', 'Line width', '→←', '←→')}
      <span className="sep" />
      {stepper('spacing', 'Line spacing', '≡', '☰')}
      <span className="sep" />

      {PALETTE_LABELS.map((p) => (
        <button
          key={p.value}
          className={settings.palette === p.value ? 'on' : ''}
          title={`${p.label} — ${p.hint}`}
          onClick={() => onChange({ ...settings, palette: p.value as ReaderPalette })}
        >
          {p.label}
        </button>
      ))}

      <span className="sep" />
      <button onClick={onExit} title="Leave reader mode (Esc)">
        Done
      </button>
    </div>
  )
}
