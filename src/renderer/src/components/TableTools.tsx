/**
 * Table editing on a rendered page: hovering a table shows small buttons on
 * its corner (✎ Edit table, ＋ Row, ＋ Column), and double-clicking a cell
 * edits it right there (Enter saves, Shift+Enter new line, Tab next cell,
 * Esc cancels).
 *
 * Shared by the viewer (View mode) and the live preview beside the editor
 * (Edit mode). Tables are found by the source line they start on, which the
 * renderer stamps on each one (data-mn-table, lib/markdown.ts).
 *
 * Kept identical across the Windows app and the web app.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { addColumn, addRow, linesOf, parseTable, setCell, tableAtLine, type Table } from '../lib/table'

interface Props {
  /** The rendered document. */
  hostRef: RefObject<HTMLElement | null>
  /** The element that scrolls (overlays hide when it moves). */
  scrollerRef: RefObject<HTMLElement | null>
  source: string
  /** Changes whenever the rendered HTML does, so a moved cell can be found again. */
  html: string
  enabled: boolean
  onTableEdit?: (line: number) => void
  onTableChange?: (line: number, change: (t: Table) => Table, label: string) => void
}

interface CellEdit {
  line: number
  r: number
  c: number
  value: string
  rect: { left: number; top: number; width: number; height: number }
}

/** Row and column of a rendered table cell (row 0 is the header). */
function cellPosition(cell: HTMLTableCellElement): { r: number; c: number } {
  const tr = cell.parentElement as HTMLTableRowElement
  const inHead = tr.parentElement?.tagName === 'THEAD'
  const bodyRows = Array.from(tr.parentElement?.children ?? [])
  return { r: inHead ? 0 : bodyRows.indexOf(tr) + 1, c: cell.cellIndex }
}

export default function TableTools(props: Props): React.JSX.Element | null {
  const { hostRef, scrollerRef, source, html, enabled } = props
  const [hover, setHover] = useState<{ line: number; x: number; y: number } | null>(null)
  const [cellEdit, setCellEdit] = useState<CellEdit | null>(null)
  const hideTimer = useRef<number | null>(null)
  const nextCell = useRef<{ line: number; r: number; c: number } | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props

  const keepHover = (): void => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    hideTimer.current = null
  }
  const dropHover = (): void => {
    keepHover()
    hideTimer.current = window.setTimeout(() => setHover(null), 450)
  }

  const tableOf = useCallback(
    (line: number): Table | null => {
      const range = tableAtLine(source, line)
      return range ? parseTable(linesOf(source, range)) : null
    },
    [source]
  )

  const openCell = useCallback(
    (cell: HTMLTableCellElement): void => {
      const table = cell.closest('table[data-mn-table]') as HTMLElement | null
      if (!table) return
      const line = Number(table.dataset.mnTable)
      const { r, c } = cellPosition(cell)
      const value = tableOf(line)?.rows[r]?.[c]
      if (value === undefined) return
      const b = cell.getBoundingClientRect()
      window.getSelection()?.removeAllRanges()
      setHover(null)
      setCellEdit({
        line,
        r,
        c,
        value: value.replace(/<br\s*\/?>/gi, '\n'),
        rect: { left: b.left, top: b.top, width: Math.max(b.width, 160), height: Math.max(b.height, 34) }
      })
    },
    [tableOf]
  )

  useEffect(() => {
    const host = hostRef.current
    if (!host || !enabled) return
    const onMove = (e: MouseEvent): void => {
      const table = (e.target as HTMLElement).closest('table[data-mn-table]') as HTMLElement | null
      if (!table) return dropHover()
      keepHover()
      const b = table.getBoundingClientRect()
      const line = Number(table.dataset.mnTable)
      setHover((h) => (h && h.line === line && Math.abs(h.y - b.top) < 1 && Math.abs(h.x - b.right) < 1 ? h : { line, x: b.right, y: b.top }))
    }
    const onDbl = (e: MouseEvent): void => {
      const cell = (e.target as HTMLElement).closest('td, th') as HTMLTableCellElement | null
      if (!cell || !cell.closest('table[data-mn-table]')) return
      e.preventDefault()
      openCell(cell)
    }
    const scroller = scrollerRef.current
    const onScroll = (): void => {
      setHover(null)
      setCellEdit(null)
    }
    host.addEventListener('mousemove', onMove)
    host.addEventListener('mouseleave', dropHover)
    host.addEventListener('dblclick', onDbl)
    scroller?.addEventListener('scroll', onScroll)
    return () => {
      host.removeEventListener('mousemove', onMove)
      host.removeEventListener('mouseleave', dropHover)
      host.removeEventListener('dblclick', onDbl)
      scroller?.removeEventListener('scroll', onScroll)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, openCell, hostRef, scrollerRef])

  const findCell = (want: { line: number; r: number; c: number }): HTMLTableCellElement | null => {
    const table = hostRef.current?.querySelector(`table[data-mn-table="${want.line}"]`) as HTMLTableElement | null
    const rows = table ? Array.from(table.rows) : []
    return rows[want.r]?.cells[want.c] ?? null
  }

  // After Tab, the next cell opens once the table has re-rendered.
  useEffect(() => {
    const want = nextCell.current
    if (!want) return
    nextCell.current = null
    const cell = findCell(want)
    if (cell) openCell(cell)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, openCell])

  const commitCell = (move: 'none' | 'next' | 'prev' | 'down'): void => {
    const ed = cellEdit
    if (!ed) return
    setCellEdit(null)
    const t = tableOf(ed.line)
    if (!t) return
    const before = t.rows[ed.r]?.[ed.c]
    const value = ed.value.replace(/\n/g, '<br>')
    if (move !== 'none') {
      const cols = t.align.length
      let { r, c } = ed
      if (move === 'next') {
        c = c + 1 >= cols ? 0 : c + 1
        if (c === 0) r++
      } else if (move === 'prev') {
        c = c - 1 < 0 ? cols - 1 : c - 1
        if (c === cols - 1) r--
      } else r++
      if (r >= 0 && r < t.rows.length) nextCell.current = { line: ed.line, r, c }
    }
    if (before !== value) propsRef.current.onTableChange?.(ed.line, (x) => setCell(x, ed.r, ed.c, value), 'Edit table cell')
    else if (nextCell.current) {
      // Nothing changed, so no re-render will come: open the next cell now.
      const cell = findCell(nextCell.current)
      nextCell.current = null
      if (cell) openCell(cell)
    }
  }

  if (!enabled) return null
  return (
    <>
      {hover && !cellEdit && (
        <div
          className="table-hover-tools"
          data-mn-ignore
          style={{ left: hover.x, top: hover.y }}
          onMouseEnter={keepHover}
          onMouseLeave={dropHover}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button title="Open the table editor" onClick={() => props.onTableEdit?.(hover.line)}>
            ✎ Edit table
          </button>
          <button title="Add a row at the end" onClick={() => props.onTableChange?.(hover.line, (t) => addRow(t, t.rows.length), 'Add table row')}>
            ＋ Row
          </button>
          <button
            title="Add a column at the end"
            onClick={() => props.onTableChange?.(hover.line, (t) => addColumn(t, t.align.length), 'Add table column')}
          >
            ＋ Column
          </button>
          <span className="table-hover-hint">or double-click a cell</span>
        </div>
      )}

      {cellEdit && (
        <textarea
          className="cell-edit"
          data-mn-ignore
          autoFocus
          style={{ left: cellEdit.rect.left, top: cellEdit.rect.top, width: cellEdit.rect.width, minHeight: cellEdit.rect.height }}
          value={cellEdit.value}
          onChange={(e) => setCellEdit({ ...cellEdit, value: e.target.value })}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => commitCell('none')}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              setCellEdit(null)
            } else if (e.key === 'Tab') {
              e.preventDefault()
              commitCell(e.shiftKey ? 'prev' : 'next')
            } else if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              commitCell('down')
            }
          }}
          aria-label="Edit cell (Enter to save, Shift+Enter for a new line, Tab for the next cell, Esc to cancel)"
          title="Enter saves · Shift+Enter new line · Tab next cell · Esc cancels"
        />
      )}
    </>
  )
}
