import { useMemo, useState } from 'react'
import { diffLines, diffStats, collapseUnchanged } from '../lib/diff'

interface Props {
  title: string
  before: string
  after: string
  reviewDefault: boolean
  onCancel: () => void
  onApply: (rememberSkipReview: boolean) => void
}

/** Side-by-side-free unified diff used to approve AI changes before they land. */
export default function DiffDialog({ title, before, after, reviewDefault, onCancel, onApply }: Props): React.JSX.Element {
  const [showAll, setShowAll] = useState(false)
  const [skipReview, setSkipReview] = useState(!reviewDefault)

  const rows = useMemo(() => diffLines(before, after), [before, after])
  const stats = useMemo(() => diffStats(rows), [rows])
  const display = useMemo(() => (showAll ? rows : collapseUnchanged(rows)), [rows, showAll])

  return (
    <div className="modal-backdrop" data-mn-ignore onMouseDown={onCancel}>
      <div className="modal diff-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <div className="diff-summary">
          <span className="added-pill">+{stats.added}</span>
          <span className="removed-pill">−{stats.removed}</span>
          <span className="muted small">
            {stats.added === 0 && stats.removed === 0
              ? 'No changes were produced.'
              : `${stats.added} line${stats.added === 1 ? '' : 's'} added, ${stats.removed} removed`}
          </span>
          <span className="grow" />
          <button className="link" onClick={() => setShowAll((s) => !s)}>
            {showAll ? 'Show changes only' : 'Show whole document'}
          </button>
        </div>

        <div className="diff-body">
          {display.map((row, i) =>
            row.op === 'gap' ? (
              <div key={i} className="diff-gap">
                ⋯ {row.count} unchanged line{row.count === 1 ? '' : 's'}
              </div>
            ) : (
              <div key={i} className={`diff-row ${row.op}`}>
                <span className="diff-num">{row.op === 'add' ? row.newLine : row.oldLine}</span>
                <span className="diff-sign">{row.op === 'add' ? '+' : row.op === 'remove' ? '−' : ' '}</span>
                <span className="diff-text">{row.text || ' '}</span>
              </div>
            )
          )}
        </div>

        <label className="checkline">
          <input type="checkbox" checked={skipReview} onChange={(e) => setSkipReview(e.target.checked)} />
          <span className="small">Apply future AI changes without showing me this first</span>
        </label>
        <p className="muted small">You can always undo an applied change with Ctrl+Z.</p>

        <div className="modal-actions">
          <button onClick={onCancel}>Discard</button>
          <button
            className="primary"
            disabled={stats.added === 0 && stats.removed === 0}
            onClick={() => onApply(skipReview)}
          >
            Apply changes
          </button>
        </div>
      </div>
    </div>
  )
}
