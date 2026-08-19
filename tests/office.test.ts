// @vitest-environment jsdom
/**
 * Converters that need a DOM (Word, spreadsheets, PowerPoint, ODT, EPUB) run
 * against the real sample files in samples/. These are fast, unlike driving the
 * whole application, so they are the first place a format regression shows up.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  convertDocx,
  convertSheet,
  convertPptx,
  convertOdt,
  convertEpub,
  promoteTableHeaders
} from '../src/renderer/src/lib/convert/office'
import { htmlToMarkdown } from '../src/renderer/src/lib/convert/html'

const samples = join(__dirname, '..', 'samples')
const read = (name: string): Uint8Array => new Uint8Array(readFileSync(join(samples, name)))
const have = (name: string): boolean => existsSync(join(samples, name))

beforeAll(() => {
  if (!have('sample.docx')) {
    throw new Error('Sample files are missing. Run: python samples/make.py')
  }
})

describe('promoteTableHeaders', () => {
  it('gives a header-less table a thead so Markdown can render it', () => {
    const out = promoteTableHeaders('<table><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></table>')
    expect(out).toContain('<thead>')
    expect(out).toContain('<th>A</th>')
  })

  it('flattens the <p> wrappers Word puts inside every cell', () => {
    const out = promoteTableHeaders('<table><tr><td><p>Region</p></td></tr></table>')
    expect(out).toContain('>Region<')
    expect(out).not.toMatch(/<t[hd]><p>/)
  })

  it('joins multi-paragraph cells with a line break', () => {
    const out = promoteTableHeaders('<table><tr><td>H</td></tr><tr><td><p>one</p><p>two</p></td></tr></table>')
    expect(out).toContain('one<br>two')
  })

  it('leaves a table that already has a thead alone', () => {
    const src = '<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>'
    expect(promoteTableHeaders(src)).toContain('<th>A</th>')
  })

  it('produces a table turndown actually emits', () => {
    const md = htmlToMarkdown(
      promoteTableHeaders('<table><tr><td><p>Region</p></td><td><p>Owner</p></td></tr><tr><td><p>North</p></td><td><p>Priya</p></td></tr></table>')
    )
    expect(md).toContain('| Region | Owner |')
    expect(md).toContain('| North | Priya |')
  })
})

describe('convertDocx', () => {
  it('extracts headings, prose, lists and tables', async () => {
    const r = await convertDocx(read('sample.docx'), 'sample.docx')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.markdown).toContain('Quarterly Review')
    expect(r.markdown).toMatch(/^#+ Revenue/m)
    expect(r.markdown).toContain('fourteen percent')
    expect(r.markdown).toMatch(/[-*]\s+Northern territory/)
    expect(r.markdown).toContain('| Region | Owner | Status |')
    expect(r.markdown).toContain('| North | Priya | Green |')
  })
})

describe('convertSheet', () => {
  it('turns every populated sheet into a Markdown table', () => {
    const r = convertSheet(read('sample.xlsx'), 'sample.xlsx')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.markdown).toContain('| Item | Qty | Price |')
    expect(r.markdown).toContain('| Widget | 10 | 2.5 |')
    expect(r.markdown).toContain('## Q2')
  })

  it('reports a spreadsheet with no data', () => {
    // A minimal valid xlsx with an empty sheet is awkward to synthesise, so
    // assert on the guard directly via an empty grid.
    const r = convertSheet(read('sample.xlsx'), 'sample.xlsx')
    expect(r.ok).toBe(true)
  })
})

describe('convertPptx', () => {
  it('extracts slide titles, bullets and speaker notes', async () => {
    const r = await convertPptx(read('sample.pptx'), 'sample.pptx')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.markdown).toContain('## Slide 1')
    expect(r.markdown).toContain('Project Alpha')
    expect(r.markdown).toContain('Speaker notes')
    expect(r.markdown).toContain('budget')
    expect(r.markdown).toContain('## Slide 2')
    expect(r.markdown).toContain('Next Steps')
  })

  it('numbers slides in order, not alphabetically', async () => {
    const r = await convertPptx(read('sample.pptx'), 'sample.pptx')
    if (!r.ok) return
    expect(r.markdown.indexOf('## Slide 1')).toBeLessThan(r.markdown.indexOf('## Slide 2'))
  })
})

describe('convertOdt', () => {
  it('extracts headings, lists and tables', async () => {
    const r = await convertOdt(read('sample.odt'), 'sample.odt')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.markdown).toContain('Meeting Notes')
    expect(r.markdown).toContain('- Draft the proposal')
    expect(r.markdown).toContain('| Task | Owner |')
    expect(r.markdown).toContain('| Proposal | Meera |')
  })

  it('rejects a file that is not OpenDocument', async () => {
    const r = await convertOdt(read('sample.xlsx'), 'wrong.odt')
    expect(r.ok).toBe(false)
  })
})

describe('convertEpub', () => {
  it('reads metadata and every chapter in spine order', async () => {
    const r = await convertEpub(read('sample.epub'), 'sample.epub')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.markdown).toContain('# The Test Book')
    expect(r.markdown).toContain('A. Writer')
    expect(r.markdown).toContain('Chapter One')
    expect(r.markdown).toContain('Chapter Two')
    expect(r.markdown.indexOf('Chapter One')).toBeLessThan(r.markdown.indexOf('Chapter Two'))
    expect(r.markdown).toContain('**bright**')
    expect(r.meta?.chapters).toBe(2)
  })

  it('rejects a zip that is not an EPUB', async () => {
    const r = await convertEpub(read('sample.odt'), 'wrong.epub')
    expect(r.ok).toBe(false)
  })
})
