/**
 * The reading controls: a vertical panel pinned to the left edge.
 *
 * It began as a horizontal bar along the bottom, which was wrong twice over.
 * It sat across the text on a short document, and the way out was a button
 * labelled "Done" that gave no clue whether it applied to the settings or to
 * reading itself. Down the left there is empty margin beside a centred column
 * of text, so the controls occupy space the page was not using.
 *
 * Leaving is the first thing in the panel and says what it does, because the
 * commonest question about any mode is how to get out of it.
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
      <div className="reader-row">
        <span className="reader-caption">{title}</span>
        <div className="reader-step">
          <button
            onClick={() => onChange(step(settings, key, -1))}
            disabled={atMin}
            aria-label={`${title}: less`}
          >
            {less}
          </button>
          <span className="reader-value">{settings[key]}</span>
          <button
            onClick={() => onChange(step(settings, key, 1))}
            disabled={atMax}
            aria-label={`${title}: more`}
          >
            {more}
          </button>
        </div>
      </div>
    )
  }

  return (
    <aside className="reader-panel" data-mn-ignore aria-label="Reading settings">
      <button className="reader-exit" onClick={onExit} title="Leave reader mode (F9 or Esc)">
        ← Exit reader
      </button>

      <div className="reader-divider" />

      {stepper('size', 'Text size', 'A−', 'A+')}
      {stepper('width', 'Line width', '→←', '←→')}
      {stepper('spacing', 'Spacing', '≡', '☰')}

      <div className="reader-divider" />

      <span className="reader-caption">Page</span>
      {PALETTE_LABELS.map((p) => (
        <button
          key={p.value}
          className={`reader-palette${settings.palette === p.value ? ' on' : ''}`}
          title={p.hint}
          onClick={() => onChange({ ...settings, palette: p.value as ReaderPalette })}
        >
          {p.label}
        </button>
      ))}
    </aside>
  )
}
