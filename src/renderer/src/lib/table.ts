/**
 * Markdown tables as data, for the table editor.
 *
 * A table is read out of the source into rows of cells (each cell its own
 * Markdown: bold, links and highlights survive), changed, and written back
 * tidily: columns padded so they line up as plain text too, and each column's
 * alignment kept in the divider line (:--- left, :---: centre, ---: right),
 * which every Markdown app understands.
 *
 * Kept identical across the Windows app and the web app.
 */
import { md } from './markdown'

export type Align = 'left' | 'center' | 'right' | null

export interface Table {
  /** Row 0 is the header row. Every row has the same number of cells. */
  rows: string[][]
  align: Align[]
  /** False: the header row is left empty and hidden (Markdown always has one). */
  header: boolean
}

export interface TableRange {
  /** First and last line (0-based, end exclusive) of the table in the source. */
  start: number
  end: number
}

/* ------------------------------------------------------------------ read */

/**
 * Splits one table line into cells, keeping escaped pipes. As in every
 * Markdown renderer, a bare pipe splits cells even inside `code`, so a pipe
 * in a cell is always written escaped.
 */
export function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\' && s[i + 1] === '|') {
      cur += '\\|'
      i++
      continue
    }
    if (c === '|') {
      cells.push(cur.trim())
      cur = ''
      continue
    }
    cur += c
  }
  cells.push(cur.trim())
  return cells
}

const DIVIDER_CELL = /^:?-{1,}:?$/

function alignOf(cell: string): Align {
  const c = cell.replace(/\s/g, '')
  const l = c.startsWith(':')
  const r = c.endsWith(':')
  return l && r ? 'center' : r ? 'right' : l ? 'left' : null
}

/** Reads a table from its source lines, or null if they are not one. */
export function parseTable(lines: string[]): Table | null {
  if (lines.length < 2) return null
  const head = splitRow(lines[0])
  const div = splitRow(lines[1])
  if (!div.every((c) => DIVIDER_CELL.test(c.replace(/\s/g, '')))) return null
  const width = Math.max(head.length, div.length)
  const pad = (r: string[]): string[] => [...r, ...Array(Math.max(0, width - r.length)).fill('')].slice(0, width)
  const rows = [pad(head), ...lines.slice(2).filter((l) => l.trim()).map((l) => pad(splitRow(l)))]
  return {
    rows,
    align: pad(div).map(alignOf),
    header: head.some((c) => c.trim() !== '')
  }
}

/** Where each table starts and ends in the source, in document order. */
export function tableRanges(source: string): TableRange[] {
  const out: TableRange[] = []
  for (const t of md.parse(source, {})) {
    // Only tables at the top level: one inside a list or quote has a prefix
    // on every line, which the editor does not rewrite.
    if (t.type === 'table_open' && t.map && t.level === 0) out.push({ start: t.map[0], end: t.map[1] })
  }
  return out
}

/** The table that covers a source line, if any. */
export function tableAtLine(source: string, line: number): TableRange | null {
  return tableRanges(source).find((r) => line >= r.start && line < r.end) ?? null
}

/** The lines of a range. */
export function linesOf(source: string, r: TableRange): string[] {
  return source.split('\n').slice(r.start, r.end)
}

/* ----------------------------------------------------------------- write */

/** A cell's text made safe for one table cell: no bare pipes or line breaks. */
export function cellText(text: string): string {
  return text
    .replace(/\r?\n/g, '<br>')
    .replace(/(^|[^\\])\|/g, '$1\\|')
    .trim()
}

/** Writes a table back as tidy Markdown, columns lined up. */
export function serializeTable(t: Table): string {
  const cols = t.align.length
  const rows = t.rows.map((r, i) => (i === 0 && !t.header ? Array(cols).fill('') : r.map(cellText)))
  const widths = Array.from({ length: cols }, (_, c) => Math.max(3, ...rows.map((r) => [...(r[c] ?? '')].length)))
  const pad = (s: string, w: number, a: Align): string => {
    const gap = w - [...s].length
    if (a === 'right') return ' '.repeat(gap) + s
    if (a === 'center') return ' '.repeat(Math.floor(gap / 2)) + s + ' '.repeat(Math.ceil(gap / 2))
    return s + ' '.repeat(gap)
  }
  const line = (r: string[]): string => `| ${r.map((c, i) => pad(c ?? '', widths[i], t.align[i])).join(' | ')} |`
  const divider = `| ${t.align
    .map((a, i) => {
      const w = widths[i]
      if (a === 'center') return `:${'-'.repeat(w - 2)}:`
      if (a === 'right') return `${'-'.repeat(w - 1)}:`
      if (a === 'left') return `:${'-'.repeat(w - 1)}`
      return '-'.repeat(w)
    })
    .join(' | ')} |`
  return [line(rows[0]), divider, ...rows.slice(1).map(line)].join('\n')
}

/** The source with lines [start, end) replaced by `text`. */
export function replaceLines(source: string, r: TableRange, text: string): string {
  const lines = source.split('\n')
  lines.splice(r.start, r.end - r.start, ...text.split('\n'))
  return lines.join('\n')
}

/** A new empty table: `rows` body rows under a header of `cols` columns. */
export function newTable(rows: number, cols: number): Table {
  return {
    rows: [Array.from({ length: cols }, (_, i) => `Column ${i + 1}`), ...Array.from({ length: rows }, () => Array(cols).fill(''))],
    align: Array(cols).fill(null),
    header: true
  }
}

/* -------------------------------------------------------------- changes */

const copy = (t: Table): Table => ({ rows: t.rows.map((r) => [...r]), align: [...t.align], header: t.header })

/** Adds an empty row at `at` (1 = first body row). */
export function addRow(t: Table, at: number): Table {
  const n = copy(t)
  n.rows.splice(Math.max(1, Math.min(at, n.rows.length)), 0, Array(n.align.length).fill(''))
  return n
}

export function deleteRow(t: Table, at: number): Table {
  if (at < 1 || t.rows.length <= 2) return t
  const n = copy(t)
  n.rows.splice(at, 1)
  return n
}

/** Moves a body row up (-1) or down (+1). */
export function moveRow(t: Table, at: number, by: -1 | 1): Table {
  const to = at + by
  if (at < 1 || to < 1 || to >= t.rows.length) return t
  const n = copy(t)
  ;[n.rows[at], n.rows[to]] = [n.rows[to], n.rows[at]]
  return n
}

export function addColumn(t: Table, at: number): Table {
  const n = copy(t)
  const i = Math.max(0, Math.min(at, n.align.length))
  n.rows.forEach((r, ri) => r.splice(i, 0, ri === 0 ? `Column ${n.align.length + 1}` : ''))
  n.align.splice(i, 0, null)
  return n
}

export function deleteColumn(t: Table, at: number): Table {
  if (t.align.length <= 1) return t
  const n = copy(t)
  n.rows.forEach((r) => r.splice(at, 1))
  n.align.splice(at, 1)
  return n
}

export function moveColumn(t: Table, at: number, by: -1 | 1): Table {
  const to = at + by
  if (to < 0 || to >= t.align.length) return t
  const n = copy(t)
  for (const r of n.rows) [r[at], r[to]] = [r[to], r[at]]
  ;[n.align[at], n.align[to]] = [n.align[to], n.align[at]]
  return n
}

export function setAlign(t: Table, col: number, a: Align): Table {
  const n = copy(t)
  n.align[col] = a
  return n
}

export function setCell(t: Table, row: number, col: number, text: string): Table {
  const n = copy(t)
  n.rows[row][col] = text
  return n
}

/** The text a cell sorts by: no Markdown marks, numbers as numbers. */
function sortKey(cell: string): { num: number | null; text: string } {
  const text = cell
    .replace(/<[^>]+>/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .trim()
  const n = text.replace(/[,\s₹$€£%]/g, '')
  return { num: /^-?\d+(\.\d+)?$/.test(n) ? Number(n) : null, text: text.toLowerCase() }
}

/** Sorts the body rows by a column; numbers by value, the rest A–Z. Empty cells last. */
export function sortBy(t: Table, col: number, dir: 'asc' | 'desc'): Table {
  const n = copy(t)
  const body = n.rows.slice(1)
  const sign = dir === 'asc' ? 1 : -1
  body.sort((a, b) => {
    const x = sortKey(a[col] ?? '')
    const y = sortKey(b[col] ?? '')
    if (!x.text && y.text) return 1
    if (x.text && !y.text) return -1
    if (x.num !== null && y.num !== null) return (x.num - y.num) * sign
    return x.text.localeCompare(y.text, undefined, { numeric: true }) * sign
  })
  n.rows = [n.rows[0], ...body]
  return n
}

/**
 * Cells copied from Excel, Google Sheets or Word arrive as tab-separated
 * lines (quoted when a cell holds a line break or a tab).
 */
export function parseClipboardGrid(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const s = text.replace(/\r\n?/g, '\n').replace(/\n$/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
      continue
    }
    if (c === '"' && cell === '') quoted = true
    else if (c === '\t') {
      row.push(cell)
      cell = ''
    } else if (c === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  row.push(cell)
  rows.push(row)
  return rows.map((r) => r.map((x) => x.trim()))
}

/** Pastes a block of cells with its top-left at (row, col), growing the table to fit. */
export function pasteGrid(t: Table, row: number, col: number, grid: string[][]): Table {
  let n = copy(t)
  const needCols = col + Math.max(...grid.map((r) => r.length))
  while (n.align.length < needCols) n = addColumn(n, n.align.length)
  while (n.rows.length < row + grid.length) n = addRow(n, n.rows.length)
  grid.forEach((r, ri) => r.forEach((v, ci) => (n.rows[row + ri][col + ci] = v)))
  return n
}
