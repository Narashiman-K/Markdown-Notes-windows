/**
 * The table editor: a spreadsheet-like grid in a popup. Type in the cells;
 * add, delete and move rows and columns; set each column's alignment; sort by
 * a column; paste a block straight from Excel or Google Sheets. Apply writes
 * tidy Markdown back (lib/table.ts), so the table still reads well as plain
 * text and opens in any Markdown app.
 *
 * Also here: the size picker that Insert → Table shows first, like Word's.
 *
 * Kept identical across the Windows app and the web app.
 */
import { useEffect, useRef, useState } from 'react'
import { undoScope } from '../lib/undoScope'
import {
  addColumn,
  addRow,
  deleteColumn,
  deleteRow,
  moveColumn,
  moveRow,
  parseClipboardGrid,
  pasteGrid,
  serializeTable,
  setAlign,
  setCell,
  sortBy,
  type Align,
  type Table
} from '../lib/table'

interface Props {
  initial: Table
  isNew: boolean
  onApply: (table: Table) => void
  onCancel: () => void
}

const ALIGNS: Array<[Align, string, string]> = [
  [null, '≡', 'No alignment (the app decides)'],
  ['left', '⇤', 'Align left'],
  ['center', '↔', 'Centre'],
  ['right', '⇥', 'Align right']
]

export default function TableEditor({ initial, isNew, onApply, onCancel }: Props): React.JSX.Element {
  const [t, setTable] = useState<Table>(initial)
  /*
   * Undo and redo inside the table editor (Ctrl+Z, Ctrl+Y, and the ↶ ↷
   * buttons). Typing in a cell is one step per pause, not per letter.
   */
  const tRef = useRef(t)
  tRef.current = t
  const past = useRef<Table[]>([])
  const future = useRef<Table[]>([])
  const lastAt = useRef(0)
  const [, setSteps] = useState(0)
  const setT = (next: Table): void => {
    const cur = tRef.current
    if (next === cur) return
    const now = Date.now()
    if (now - lastAt.current > 700) past.current = [...past.current.slice(-199), cur]
    lastAt.current = now
    future.current = []
    tRef.current = next
    setTable(next)
    setSteps((s) => s + 1)
  }
  const undoRedo = (dir: 'undo' | 'redo'): boolean => {
    const from = dir === 'undo' ? past : future
    const to = dir === 'undo' ? future : past
    const prev = from.current[from.current.length - 1]
    if (!prev) return false
    from.current = from.current.slice(0, -1)
    to.current = [...to.current, tRef.current]
    tRef.current = prev
    lastAt.current = 0
    setTable(prev)
    setSteps((s) => s + 1)
    return true
  }
  // The app's Undo and Redo (menu, toolbar, Ctrl+Z on Windows) act here while it is open.
  const undoRef = useRef(undoRedo)
  undoRef.current = undoRedo
  useEffect(() => {
    undoScope.current = (dir) => undoRef.current(dir)
    return () => {
      undoScope.current = null
    }
  }, [])
  const onUndoKeys = (e: React.KeyboardEvent): void => {
    if (!(e.ctrlKey || e.metaKey)) return
    const k = e.key.toLowerCase()
    if (k === 'z' && !e.shiftKey) {
      e.preventDefault()
      e.stopPropagation()
      undoRedo('undo')
    } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
      e.preventDefault()
      e.stopPropagation()
      undoRedo('redo')
    }
  }
  const [at, setAt] = useState<{ r: number; c: number }>({ r: initial.rows.length > 1 ? 1 : 0, c: 0 })
  const [showSource, setShowSource] = useState(false)
  const grid = useRef<HTMLDivElement>(null)

  // Focus follows the chosen cell, including after a row or column moves.
  useEffect(() => {
    const el = grid.current?.querySelector<HTMLTextAreaElement>(`[data-r="${at.r}"][data-c="${at.c}"]`)
    if (el && document.activeElement !== el) el.focus()
  }, [at, t])

  const rows = t.rows.length
  const cols = t.align.length
  const go = (r: number, c: number): void => setAt({ r: Math.max(0, Math.min(r, rows - 1)), c: Math.max(0, Math.min(c, cols - 1)) })

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>, r: number, c: number): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      onApply(t)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      if (e.shiftKey) {
        if (c > 0) go(r, c - 1)
        else if (r > 0) go(r - 1, cols - 1)
      } else if (c < cols - 1) go(r, c + 1)
      else if (r < rows - 1) go(r + 1, 0)
      else {
        // Tab from the last cell adds a row, as in Word.
        setT(addRow(t, rows))
        setAt({ r: rows, c: 0 })
      }
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (r < rows - 1) go(r + 1, c)
      else {
        setT(addRow(t, rows))
        setAt({ r: rows, c })
      }
    } else if (e.key === 'ArrowUp' && e.altKey) {
      e.preventDefault()
      go(r - 1, c)
    } else if (e.key === 'ArrowDown' && e.altKey) {
      e.preventDefault()
      go(r + 1, c)
    }
  }

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>, r: number, c: number): void => {
    const text = e.clipboardData.getData('text/plain')
    // A single value pastes as text; a block of cells fills the grid.
    if (!/[\t\n]/.test(text.replace(/\r?\n$/, ''))) return
    e.preventDefault()
    const block = parseClipboardGrid(text)
    setT(pasteGrid(t, r, c, block))
  }

  const btn = (label: string, title: string, fn: () => void, disabled = false): React.JSX.Element => (
    <button className="tbl-btn" title={title} aria-label={title} onClick={fn} disabled={disabled}>
      {label}
    </button>
  )
  const { r, c } = at

  return (
    <div className="modal-backdrop" data-mn-ignore onMouseDown={onCancel}>
      <div className="modal table-editor" onMouseDown={(e) => e.stopPropagation()} onKeyDownCapture={onUndoKeys} role="dialog" aria-label="Table editor">
        <h3>{isNew ? 'New table' : 'Edit table'}</h3>

        <div className="tbl-tools" role="toolbar">
          <span className="tbl-group" aria-label="Undo">
            {btn('↶', `Undo (Ctrl+Z)${past.current.length ? '' : ': nothing to undo'}`, () => void undoRedo('undo'), !past.current.length)}
            {btn('↷', `Redo (Ctrl+Y)${future.current.length ? '' : ': nothing to redo'}`, () => void undoRedo('redo'), !future.current.length)}
          </span>
          <span className="tbl-group" aria-label="Rows">
            <span className="tbl-label">Row</span>
            {btn('＋↑', 'Add a row above', () => (setT(addRow(t, Math.max(1, r))), setAt({ r: Math.max(1, r), c })))}
            {btn('＋↓', 'Add a row below', () => (setT(addRow(t, r + 1)), setAt({ r: r + 1, c })))}
            {btn('↑', 'Move this row up', () => (setT(moveRow(t, r, -1)), setAt({ r: r - 1, c })), r <= 1)}
            {btn('↓', 'Move this row down', () => (setT(moveRow(t, r, 1)), setAt({ r: r + 1, c })), r < 1 || r >= rows - 1)}
            {btn('✕', 'Delete this row', () => (setT(deleteRow(t, r)), setAt({ r: Math.min(r, rows - 2), c })), r < 1 || rows <= 2)}
          </span>
          <span className="tbl-group" aria-label="Columns">
            <span className="tbl-label">Column</span>
            {btn('＋←', 'Add a column to the left', () => (setT(addColumn(t, c)), setAt({ r, c })))}
            {btn('＋→', 'Add a column to the right', () => (setT(addColumn(t, c + 1)), setAt({ r, c: c + 1 })))}
            {btn('←', 'Move this column left', () => (setT(moveColumn(t, c, -1)), setAt({ r, c: c - 1 })), c <= 0)}
            {btn('→', 'Move this column right', () => (setT(moveColumn(t, c, 1)), setAt({ r, c: c + 1 })), c >= cols - 1)}
            {btn('✕', 'Delete this column', () => (setT(deleteColumn(t, c)), setAt({ r, c: Math.min(c, cols - 2) })), cols <= 1)}
          </span>
          <span className="tbl-group" aria-label="Alignment">
            <span className="tbl-label">Align</span>
            {ALIGNS.map(([a, label, title]) => (
              <button
                key={String(a)}
                className={`tbl-btn${t.align[c] === a ? ' on' : ''}`}
                title={title}
                aria-label={title}
                aria-pressed={t.align[c] === a}
                onClick={() => setT(setAlign(t, c, a))}
              >
                {label}
              </button>
            ))}
          </span>
          <span className="tbl-group" aria-label="Sort">
            <span className="tbl-label">Sort</span>
            {btn('A→Z', 'Sort the rows by this column, smallest first', () => setT(sortBy(t, c, 'asc')), rows < 3)}
            {btn('Z→A', 'Sort the rows by this column, largest first', () => setT(sortBy(t, c, 'desc')), rows < 3)}
          </span>
          <label className="tbl-check" title="Markdown tables always have a header row; turned off, it is left empty and hidden">
            <input type="checkbox" checked={t.header} onChange={(e) => setT({ ...t, header: e.target.checked })} />
            Header row
          </label>
        </div>

        <div className="tbl-grid-wrap">
          {/* Quick handles: a new column at the right edge, a new row along the bottom. */}
          <button
            className="tbl-add tbl-add-col"
            title="Add a column at the end"
            aria-label="Add a column at the end"
            onClick={() => (setT(addColumn(t, cols)), setAt({ r, c: cols }))}
          >
            ＋
          </button>
          <button
            className="tbl-add tbl-add-row"
            title="Add a row at the end"
            aria-label="Add a row at the end"
            onClick={() => (setT(addRow(t, rows)), setAt({ r: rows, c }))}
          >
            ＋ Row
          </button>
          <div className="tbl-grid" ref={grid} style={{ gridTemplateColumns: `repeat(${cols}, minmax(110px, 1fr))` }}>
            {t.rows.map((row, ri) =>
              row.map((cell, ci) => (
                <textarea
                  key={`${ri}-${ci}`}
                  data-r={ri}
                  data-c={ci}
                  rows={1}
                  className={`tbl-cell${ri === 0 ? ' head' : ''}${ri === 0 && !t.header ? ' off' : ''}${ri === r && ci === c ? ' at' : ''}`}
                  style={{ textAlign: t.align[ci] ?? 'left' }}
                  value={cell}
                  disabled={ri === 0 && !t.header}
                  placeholder={ri === 0 ? 'Heading' : ''}
                  onFocus={() => (ri !== r || ci !== c) && setAt({ r: ri, c: ci })}
                  onMouseDown={() => (ri !== r || ci !== c) && setAt({ r: ri, c: ci })}
                  onChange={(e) => setT(setCell(t, ri, ci, e.target.value))}
                  onKeyDown={(e) => onKey(e, ri, ci)}
                  onPaste={(e) => onPaste(e, ri, ci)}
                  aria-label={`Row ${ri === 0 ? 'header' : ri}, column ${ci + 1}`}
                />
              ))
            )}
          </div>
        </div>

        {showSource && <pre className="tbl-source">{serializeTable(t)}</pre>}

        <div className="modal-actions">
          <button className="link tbl-src-toggle" onClick={() => setShowSource((v) => !v)}>
            {showSource ? 'Hide Markdown' : 'Show Markdown'}
          </button>
          <span className="grow" />
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={() => onApply(t)}>
            {isNew ? 'Insert table' : 'Apply'}
          </button>
        </div>
        <p className="muted small">
          Tab / Shift+Tab move between cells (Tab on the last cell adds a row) · Enter goes down · Paste cells from Excel or Sheets ·
          Ctrl+Enter applies · Esc cancels
        </p>
      </div>
    </div>
  )
}

/** Insert → Table: pick the size on a grid, like Word. Rows here are body rows. */
export function TableSizePicker({ onPick, onCancel }: { onPick: (rows: number, cols: number) => void; onCancel: () => void }): React.JSX.Element {
  const [hover, setHover] = useState({ r: 3, c: 3 })
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onPick(hover.r, hover.c)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [hover, onCancel, onPick])
  return (
    <div className="modal-backdrop" data-mn-ignore onMouseDown={onCancel}>
      <div className="modal table-size" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Table size">
        <h3>Insert table</h3>
        <div className="tbl-size-grid" onMouseLeave={() => undefined}>
          {Array.from({ length: 8 }, (_, ri) =>
            Array.from({ length: 10 }, (_, ci) => (
              <button
                key={`${ri}-${ci}`}
                className={`tbl-size-cell${ri < hover.r && ci < hover.c ? ' on' : ''}`}
                onMouseEnter={() => setHover({ r: ri + 1, c: ci + 1 })}
                onFocus={() => setHover({ r: ri + 1, c: ci + 1 })}
                onClick={() => onPick(ri + 1, ci + 1)}
                aria-label={`${ri + 1} rows by ${ci + 1} columns`}
              />
            ))
          )}
        </div>
        <p className="tbl-size-label">
          {hover.c} column{hover.c === 1 ? '' : 's'} × {hover.r} row{hover.r === 1 ? '' : 's'} <span className="muted">(plus a header row)</span>
        </p>
        <div className="modal-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={() => onPick(hover.r, hover.c)}>
            Next: fill it in
          </button>
        </div>
      </div>
    </div>
  )
}
