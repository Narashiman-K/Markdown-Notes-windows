import type { AnnotationMeta } from '../../../shared/types'
import type { Heading } from '../lib/markdown'
import { HIGHLIGHT_COLORS } from '../lib/annotations'

interface Props {
  mode: 'outline' | 'comments'
  headings: Heading[]
  annotations: AnnotationMeta[]
  activeId: string | null
  onClose: () => void
  onPickHeading: (slug: string) => void
  onPickAnnotation: (id: string) => void
  onEditNote: (id: string) => void
  onRemove: (id: string) => void
}

const TYPE_LABEL: Record<string, string> = {
  highlight: 'Highlight',
  underline: 'Underline',
  strike: 'Strikethrough',
  bold: 'Emphasis',
  italic: 'Italic',
  comment: 'Comment'
}

export default function Sidebar(props: Props): React.JSX.Element {
  const { mode, headings, annotations, activeId } = props

  return (
    <aside className="sidebar">
      <header className="sidebar-head">
        <span>{mode === 'outline' ? 'Outline' : `Annotations (${annotations.length})`}</span>
        <button className="icon" title="Close panel" onClick={props.onClose}>
          ✕
        </button>
      </header>

      {mode === 'outline' && (
        <div className="sidebar-body">
          {headings.length === 0 && <p className="muted">No headings in this document.</p>}
          {headings.map((h) => (
            <button
              key={h.slug}
              className="outline-item"
              style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
              onClick={() => props.onPickHeading(h.slug)}
              title={h.text}
            >
              {h.text}
            </button>
          ))}
        </div>
      )}

      {mode === 'comments' && (
        <div className="sidebar-body">
          {annotations.length === 0 && <p className="muted">No annotations yet. Select text in view mode to add one.</p>}
          {annotations.map((a) => (
            <div
              key={a.id}
              className={'annot-card' + (a.id === activeId ? ' active' : '')}
              onClick={() => props.onPickAnnotation(a.id)}
            >
              <div className="annot-head">
                <span
                  className="dot"
                  style={{ background: a.color ? (HIGHLIGHT_COLORS[a.color] ?? a.color) : 'var(--accent)' }}
                />
                <span className="annot-type">{TYPE_LABEL[a.type] ?? a.type}</span>
                {a.at && <span className="annot-date">{new Date(a.at).toLocaleDateString()}</span>}
              </div>
              <div className="annot-quote">{a.text.slice(0, 180) || '(empty)'}</div>
              {a.note && <div className="annot-note">{a.note}</div>}
              <div className="annot-actions">
                <button
                  className="link"
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onEditNote(a.id)
                  }}
                >
                  {a.note ? 'Edit note' : 'Add note'}
                </button>
                <button
                  className="link danger"
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onRemove(a.id)
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </aside>
  )
}
