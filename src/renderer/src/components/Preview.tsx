import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { renderMarkdown } from '../lib/markdown'
import { readPageSize, sheetStyle } from '../lib/pages'
import { buildSourceMap, indexTextNodes, domToOffset, toSourceRange, type TextNodeIndexEntry } from '../lib/align'
import { HIGHLIGHT_COLORS } from '../lib/annotations'
import { addColumn, addRow, linesOf, parseTable, setCell, tableAtLine, type Table } from '../lib/table'
import type { AnnotationType } from '../../../shared/types'

export interface PreviewHandle {
  getSelectionRange: () => [number, number] | null
  getHtml: () => string
  scrollToSlug: (slug: string) => void
  scrollToAnnotation: (id: string) => void
  scrollToText: (text: string) => boolean
  clearSelection: () => void
}

interface Props {
  source: string
  zoom: number
  activeAnnotation: string | null
  onAnnotate: (type: AnnotationType, color?: string) => void
  onComment: () => void
  onRemoveAnnotation: (id: string) => void
  onSelectAnnotation: (id: string | null) => void
  /**
   * While reading, the size comes from the reading settings instead of the
   * zoom. An inline style beats every stylesheet rule, so leaving it on made
   * the reader's own text-size control do nothing at all.
   */
  readerMode?: boolean
  onEditAnnotationNote: (id: string) => void
  onScrollRatio?: (ratio: number) => void
  /**
   * Show the document on sheets of its original page size, one per original
   * page (lib/pages.ts). A4 for a document that recorded no size.
   */
  pageView?: boolean
  /** Leave out scanned pages' own pictures, showing only their text. */
  hideScans?: boolean
  /** Open the table editor on the table starting at this source line. */
  onTableEdit?: (line: number) => void
  /** Change the table starting at this source line (undoable). */
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

interface ToolbarState {
  x: number
  y: number
  visible: boolean
  flip: boolean
}

const Preview = forwardRef<PreviewHandle, Props>(function Preview(props, ref) {
  const { source, zoom, activeAnnotation } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const indexRef = useRef<{ text: string; entries: TextNodeIndexEntry[] } | null>(null)
  const mapRef = useRef<Int32Array | null>(null)
  const [toolbar, setToolbar] = useState<ToolbarState>({ x: 0, y: 0, visible: false, flip: false })
  const [hoverNote, setHoverNote] = useState<{ x: number; y: number; text: string; id: string } | null>(null)

  // Never while reading: the reader sets its own width and size.
  const pages = props.pageView === true && !props.readerMode
  const hideScans = props.hideScans === true
  const html = useMemo(() => renderMarkdown(source, { screen: true, pages, hideScans }), [source, pages, hideScans])
  const sheet = useMemo(() => (pages ? sheetStyle(readPageSize(source)) : null), [source, pages])

  // Re-index the rendered DOM whenever the document changes.
  useEffect(() => {
    if (!hostRef.current) return
    indexRef.current = indexTextNodes(hostRef.current)
    mapRef.current = buildSourceMap(source, indexRef.current.text)
    setToolbar((t) => ({ ...t, visible: false }))
  }, [html, source])

  const getSelectionRange = useCallback((): [number, number] | null => {
    const sel = window.getSelection()
    const host = hostRef.current
    const index = indexRef.current
    const map = mapRef.current
    if (!sel || sel.isCollapsed || !host || !index || !map) return null
    const range = sel.getRangeAt(0)
    if (!host.contains(range.commonAncestorContainer)) return null

    const start = domToOffset(index.entries, range.startContainer, range.startOffset)
    const end = domToOffset(index.entries, range.endContainer, range.endOffset)
    if (start === null || end === null || end <= start) return null
    return toSourceRange(map, start, end)
  }, [])

  useImperativeHandle(ref, () => ({
    getSelectionRange,
    getHtml: () => hostRef.current?.innerHTML ?? '',
    scrollToSlug: (slug: string) => {
      hostRef.current?.querySelector(`#${CSS.escape(slug)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
    scrollToAnnotation: (id: string) => {
      const el = hostRef.current?.querySelector(`[data-mn-id="${CSS.escape(id)}"]`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    },
    /** Finds a passage in the rendered text and scrolls to it with a flash. */
    scrollToText: (text: string) => {
      const host = hostRef.current
      const index = indexRef.current
      if (!host || !index) return false

      const needle = text.replace(/\s+/g, ' ').trim().slice(0, 60).toLowerCase()
      if (needle.length < 4) return false
      const hay = index.text.replace(/\s+/g, ' ').toLowerCase()
      const at = hay.indexOf(needle)
      if (at === -1) return false

      // Map the normalised hit back to a text node and scroll its element.
      let scanned = 0
      for (const entry of index.entries) {
        const normalisedLength = (entry.node.nodeValue ?? '').replace(/\s+/g, ' ').length
        if (scanned + normalisedLength >= at) {
          const el = entry.node.parentElement
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' })
            el.classList.add('mn-flash')
            window.setTimeout(() => el.classList.remove('mn-flash'), 1600)
            return true
          }
        }
        scanned += normalisedLength
      }
      return false
    },
    clearSelection: () => {
      window.getSelection()?.removeAllRanges()
      setToolbar((t) => ({ ...t, visible: false }))
    }
  }))

  // Floating selection toolbar
  useEffect(() => {
    function onSelectionChange(): void {
      const sel = window.getSelection()
      const host = hostRef.current
      if (!sel || sel.isCollapsed || !host || sel.rangeCount === 0) {
        setToolbar((t) => (t.visible ? { ...t, visible: false } : t))
        return
      }
      const range = sel.getRangeAt(0)
      if (!host.contains(range.commonAncestorContainer)) {
        setToolbar((t) => (t.visible ? { ...t, visible: false } : t))
        return
      }
      const rect = range.getBoundingClientRect()
      if (!rect.width && !rect.height) return
      // Keep the bar inside the window: flip below when the selection is near
      // the top, and clamp horizontally so it never runs off an edge.
      const flip = rect.top < 130
      const half = 130
      setToolbar({
        x: Math.max(half, Math.min(rect.left + rect.width / 2, window.innerWidth - half)),
        y: flip ? rect.bottom + 10 : rect.top - 8,
        visible: true,
        flip
      })
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [])

  // Click / hover on existing annotations
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    function onClick(e: MouseEvent): void {
      const target = (e.target as HTMLElement).closest('[data-mn-id]') as HTMLElement | null
      props.onSelectAnnotation(target?.dataset.mnId ?? null)
      /*
       * Links. The written href decides, not the resolved one: a relative
       * link such as "chapter2.xhtml" (from a converted EPUB) resolves to an
       * http address of the app itself, and was being opened as a web page,
       * which came up blank.
       *   #target   scrolls to it within the document;
       *   http(s):  and mailto: open outside the app;
       *   anything else (a file that is not here) does nothing.
       */
      const anchor = (e.target as HTMLElement).closest('a') as HTMLAnchorElement | null
      const written = anchor?.getAttribute('href') ?? ''
      if (anchor && written) {
        e.preventDefault()
        if (written.startsWith('#')) {
          const id = decodeURIComponent(written.slice(1))
          hostRef.current?.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'start' })
        } else if (/^(https?:|mailto:)/i.test(written)) {
          window.open(anchor.href, '_blank')
        }
      }
    }

    function onOver(e: MouseEvent): void {
      const target = (e.target as HTMLElement).closest('[data-mn-note]') as HTMLElement | null
      if (!target) {
        setHoverNote(null)
        return
      }
      const rect = target.getBoundingClientRect()
      setHoverNote({
        x: rect.left,
        y: rect.bottom + 6,
        text: target.dataset.mnNote ?? '',
        id: target.dataset.mnId ?? ''
      })
    }

    host.addEventListener('click', onClick)
    host.addEventListener('mouseover', onOver)
    return () => {
      host.removeEventListener('click', onClick)
      host.removeEventListener('mouseover', onOver)
    }
  }, [props])

  /* --------------------------------------------------------------- tables
   * Hovering a table shows small buttons on its corner (edit, + row,
   * + column); double-clicking a cell edits it right there.
   */
  const [tableHover, setTableHover] = useState<{ line: number; x: number; y: number } | null>(null)
  const [cellEdit, setCellEdit] = useState<CellEdit | null>(null)
  const hideTimer = useRef<number | null>(null)
  const nextCell = useRef<{ line: number; r: number; c: number } | null>(null)
  const tablesEditable = !!props.onTableChange && !props.readerMode

  const keepHover = (): void => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    hideTimer.current = null
  }
  const dropHover = (): void => {
    keepHover()
    hideTimer.current = window.setTimeout(() => setTableHover(null), 450)
  }

  const cellSource = useCallback(
    (line: number, r: number, c: number): string | null => {
      const range = tableAtLine(source, line)
      const t = range ? parseTable(linesOf(source, range)) : null
      return t?.rows[r]?.[c] ?? null
    },
    [source]
  )

  const openCell = useCallback(
    (cell: HTMLTableCellElement): void => {
      const table = cell.closest('table[data-mn-table]') as HTMLElement | null
      if (!table) return
      const line = Number(table.dataset.mnTable)
      const { r, c } = cellPosition(cell)
      const value = cellSource(line, r, c)
      if (value === null) return
      const b = cell.getBoundingClientRect()
      window.getSelection()?.removeAllRanges()
      setTableHover(null)
      setCellEdit({ line, r, c, value: value.replace(/<br\s*\/?>/gi, '\n'), rect: { left: b.left, top: b.top, width: Math.max(b.width, 160), height: Math.max(b.height, 34) } })
    },
    [cellSource]
  )

  useEffect(() => {
    const host = hostRef.current
    if (!host || !tablesEditable) return
    const onMove = (e: MouseEvent): void => {
      const table = (e.target as HTMLElement).closest('table[data-mn-table]') as HTMLElement | null
      if (!table) return dropHover()
      keepHover()
      const b = table.getBoundingClientRect()
      const line = Number(table.dataset.mnTable)
      setTableHover((h) => (h && h.line === line && Math.abs(h.y - b.top) < 1 ? h : { line, x: b.right, y: b.top }))
    }
    const onDbl = (e: MouseEvent): void => {
      const cell = (e.target as HTMLElement).closest('td, th') as HTMLTableCellElement | null
      if (!cell || !cell.closest('table[data-mn-table]')) return
      e.preventDefault()
      openCell(cell)
    }
    const scroller = host.parentElement
    const onScroll = (): void => {
      setTableHover(null)
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
  }, [tablesEditable, openCell])

  // After Tab, the next cell opens once the table has re-rendered.
  useEffect(() => {
    const want = nextCell.current
    if (!want) return
    nextCell.current = null
    const table = hostRef.current?.querySelector(`table[data-mn-table="${want.line}"]`) as HTMLTableElement | null
    const rows = table ? Array.from(table.rows) : []
    const cell = rows[want.r]?.cells[want.c] ?? rows[want.r + 1]?.cells[0]
    if (cell) openCell(cell)
  }, [html, openCell])

  const commitCell = (move: 'none' | 'next' | 'prev' | 'down'): void => {
    const ed = cellEdit
    if (!ed) return
    setCellEdit(null)
    const before = cellSource(ed.line, ed.r, ed.c)
    const value = ed.value.replace(/\n/g, '<br>')
    if (move !== 'none') {
      const t = (() => {
        const range = tableAtLine(source, ed.line)
        return range ? parseTable(linesOf(source, range)) : null
      })()
      const cols = t?.align.length ?? 1
      const rows = t?.rows.length ?? 1
      let { r, c } = ed
      if (move === 'next') (c = c + 1 >= cols ? 0 : c + 1), (r = c === 0 ? r + 1 : r)
      if (move === 'prev') (c = c - 1 < 0 ? cols - 1 : c - 1), (r = c === cols - 1 ? r - 1 : r)
      if (move === 'down') r = r + 1
      if (r >= 0 && r < rows) nextCell.current = { line: ed.line, r, c }
    }
    if (before !== value) props.onTableChange?.(ed.line, (t) => setCell(t, ed.r, ed.c, value), 'Edit table cell')
    else if (nextCell.current) {
      // Nothing changed, so no re-render will come: open the next cell now.
      const want = nextCell.current
      nextCell.current = null
      const table = hostRef.current?.querySelector(`table[data-mn-table="${want.line}"]`) as HTMLTableElement | null
      const cell = table ? Array.from(table.rows)[want.r]?.cells[want.c] : null
      if (cell) openCell(cell)
    }
  }

  // Highlight the active annotation
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    host.querySelectorAll('.mn-active').forEach((el) => el.classList.remove('mn-active'))
    if (activeAnnotation) {
      host.querySelectorAll(`[data-mn-id="${CSS.escape(activeAnnotation)}"]`).forEach((el) => el.classList.add('mn-active'))
    }
  }, [activeAnnotation, html])

  const selectedAnnotationId = (): string | null => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return null
    const node = sel.getRangeAt(0).commonAncestorContainer
    const el = (node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement))?.closest('[data-mn-id]')
    return (el as HTMLElement | null)?.dataset.mnId ?? null
  }

  return (
    <div className="preview-host">
      <div
        className={`preview-scroll${pages ? ' page-view' : ''}`}
        onScroll={(e) => {
          const el = e.currentTarget
          props.onScrollRatio?.(el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight))
        }}
      >
        <article
          ref={hostRef}
          className={`markdown-body${pages ? ' mn-page-view' : ''}`}
          style={props.readerMode ? undefined : ({ fontSize: `${zoom * 16}px`, ...sheet } as React.CSSProperties)}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>

      {toolbar.visible && (
        <div
          className={`sel-toolbar${toolbar.flip ? ' flip' : ''}`}
          data-mn-ignore
          style={{ left: toolbar.x, top: toolbar.y }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {Object.entries(HIGHLIGHT_COLORS).map(([name, hex]) => (
            <button
              key={name}
              className="swatch"
              title={`Highlight ${name}`}
              style={{ background: hex }}
              onClick={() => props.onAnnotate('highlight', name)}
            />
          ))}
          <span className="sep" />
          <button title="Underline (Ctrl+U)" onClick={() => props.onAnnotate('underline')}>
            <u>U</u>
          </button>
          <button title="Strikethrough" onClick={() => props.onAnnotate('strike')}>
            <s>S</s>
          </button>
          <button title="Bold emphasis" onClick={() => props.onAnnotate('bold')}>
            <b>B</b>
          </button>
          <span className="sep" />
          <button title="Add comment" onClick={props.onComment}>
            💬
          </button>
          <button
            title="Remove annotation"
            onClick={() => {
              const id = selectedAnnotationId()
              if (id) props.onRemoveAnnotation(id)
            }}
          >
            ⌫
          </button>
        </div>
      )}

      {tableHover && !cellEdit && (
        <div
          className="table-hover-tools"
          data-mn-ignore
          style={{ left: tableHover.x, top: tableHover.y }}
          onMouseEnter={keepHover}
          onMouseLeave={dropHover}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button title="Open the table editor" onClick={() => props.onTableEdit?.(tableHover.line)}>
            ✎ Edit table
          </button>
          <button title="Add a row at the end" onClick={() => props.onTableChange?.(tableHover.line, (t) => addRow(t, t.rows.length), 'Add table row')}>
            ＋ Row
          </button>
          <button title="Add a column at the end" onClick={() => props.onTableChange?.(tableHover.line, (t) => addColumn(t, t.align.length), 'Add table column')}>
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

      {hoverNote && (
        <div className="note-tip" data-mn-ignore style={{ left: hoverNote.x, top: hoverNote.y }}>
          <div className="note-tip-text">{hoverNote.text}</div>
          <button className="link" onClick={() => props.onEditAnnotationNote(hoverNote.id)}>
            Edit
          </button>
        </div>
      )}
    </div>
  )
})

export default Preview
