import { describe, it, expect } from 'vitest'
import {
  parseTable,
  serializeTable,
  tableRanges,
  replaceLines,
  linesOf,
  splitRow,
  newTable,
  addRow,
  deleteRow,
  moveRow,
  addColumn,
  deleteColumn,
  moveColumn,
  setAlign,
  sortBy,
  parseClipboardGrid,
  pasteGrid
} from '../src/renderer/src/lib/table'

const SRC = `# Doc

Intro.

| Name | Qty | Note |
|:-----|----:|:----:|
| Pen  | 10  | **blue** |
| Book | 2   | a \\| b |
| Cup  | 100 | \`x\\|y\` |

After.`

describe('table model', () => {
  it('finds tables and reads cells, alignment and escapes', () => {
    const [r] = tableRanges(SRC)
    expect(r).toEqual({ start: 4, end: 9 })
    const t = parseTable(linesOf(SRC, r))!
    expect(t.align).toEqual(['left', 'right', 'center'])
    expect(t.rows[1]).toEqual(['Pen', '10', '**blue**'])
    expect(t.rows[2][2]).toBe('a \\| b')
    expect(t.rows[3][2]).toBe('`x\\|y`')
    expect(t.header).toBe(true)
  })

  it('writes tidy, lined-up Markdown that reads back the same', () => {
    const t = parseTable(linesOf(SRC, tableRanges(SRC)[0]))!
    const out = serializeTable(t)
    const lines = out.split('\n')
    expect(new Set(lines.map((l) => l.length)).size).toBe(1)
    expect(lines[1]).toMatch(/^\| :-+ \| -+: \| :-+: \|$/)
    expect(parseTable(lines)).toEqual(t)
  })

  it('replaces only the table lines', () => {
    const r = tableRanges(SRC)[0]
    const next = replaceLines(SRC, r, serializeTable(newTable(1, 2)))
    expect(next.startsWith('# Doc\n\nIntro.\n\n| Column 1')).toBe(true)
    expect(next.endsWith('\n\nAfter.')).toBe(true)
  })

  it('adds, deletes and moves rows and columns', () => {
    let t = newTable(2, 2)
    t = addRow(t, 1)
    expect(t.rows.length).toBe(4)
    t = deleteRow(t, 1)
    expect(t.rows.length).toBe(3)
    t.rows[1][0] = 'a'
    t = moveRow(t, 1, 1)
    expect(t.rows[2][0]).toBe('a')
    t = addColumn(t, 0)
    expect(t.align.length).toBe(3)
    t = moveColumn(t, 0, 1)
    expect(t.rows[0][1]).toBe('Column 3')
    t = deleteColumn(t, 1)
    expect(t.align.length).toBe(2)
    t = setAlign(t, 0, 'right')
    expect(serializeTable(t).split('\n')[1]).toMatch(/^\| -+: \|/)
  })

  it('sorts numbers by value and text A–Z, empty cells last', () => {
    const t = parseTable(linesOf(SRC, tableRanges(SRC)[0]))!
    expect(sortBy(t, 1, 'asc').rows.slice(1).map((r) => r[0])).toEqual(['Book', 'Pen', 'Cup'])
    expect(sortBy(t, 0, 'desc').rows.slice(1).map((r) => r[0])).toEqual(['Pen', 'Cup', 'Book'])
  })

  it('pastes cells copied from Excel, growing the table', () => {
    const grid = parseClipboardGrid('A\tB\tC\r\n1\t"two\nlines"\t3\r\n')
    expect(grid).toEqual([
      ['A', 'B', 'C'],
      ['1', 'two\nlines', '3']
    ])
    const t = pasteGrid(newTable(1, 2), 1, 0, grid)
    expect(t.align.length).toBe(3)
    expect(t.rows.length).toBe(3)
    expect(serializeTable(t)).toContain('two<br>lines')
  })

  it('keeps a table without a header row headerless', () => {
    const t = parseTable(['|  |  |', '|--|--|', '| a | b |'])!
    expect(t.header).toBe(false)
    expect(serializeTable(t).split('\n')[0]).toMatch(/^\|\s+\|\s+\|$/)
  })

  it('splits rows with escaped pipes', () => {
    expect(splitRow('| a \\| b | c |')).toEqual(['a \\| b', 'c'])
  })
})
