/**
 * Spreadsheet clipboard HTML, which is the case smart paste exists for.
 *
 * The GFM rules only convert a table that already has a `<thead>`. Excel and
 * Google Sheets both emit bare `<tr><td>`, so without promoting a heading row
 * the table is left as raw HTML and collapses into a paragraph of
 * run-together text — the worst result of any paste source, from the source
 * most likely to be pasted.
 */
import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('')
;(globalThis as { window?: unknown }).window = dom.window
;(globalThis as { document?: unknown }).document = dom.window.document
;(globalThis as { DOMParser?: unknown }).DOMParser = dom.window.DOMParser

const { promoteHeaderRows, fragmentForTests } = await import('../src/renderer/src/lib/smartPaste')
const { htmlToMarkdown } = await import('../src/renderer/src/lib/convert/html')

/** The whole paste pipeline, in the order smartPaste runs it. */
const convert = (html: string): string =>
  htmlToMarkdown(promoteHeaderRows(fragmentForTests(html))).trim()

const SHEETS = `<meta charset="utf-8"><google-sheets-html-origin>
<style type="text/css"><!--td {border: 1px solid #ccc;}--></style>
<table xmlns="http://www.w3.org/1999/xhtml" cellspacing="0" cellpadding="0" dir="ltr" border="1">
<colgroup><col width="60"/><col width="180"/></colgroup><tbody>
<tr><td>S.No</td><td>Company</td></tr>
<tr><td>1</td><td>KKB Talent Network</td></tr>
<tr><td>2</td><td>Randstad India</td></tr>
</tbody></table>`

const EXCEL = `<html xmlns:o="urn:schemas-microsoft-com:office:office"><body>
<table border=0 cellpadding=0 cellspacing=0 style='border-collapse:collapse'>
<tr height=20><td>S.No</td><td>Company</td></tr>
<tr height=20><td>1</td><td>KKB</td></tr>
</table></body></html>`

describe('spreadsheet paste', () => {
  it('turns a Google Sheets selection into a Markdown table', () => {
    const md = convert(SHEETS)
    expect(md).toContain('| S.No | Company |')
    expect(md).toContain('| 1 | KKB Talent Network |')
    expect(md).toContain('| 2 | Randstad India |')
    // The giveaway that the old path was taken: raw markup in the output.
    expect(md).not.toContain('<table')
  })

  it('turns an Excel selection into a Markdown table', () => {
    const md = convert(EXCEL)
    expect(md).toContain('| S.No | Company |')
    expect(md).toContain('| 1 | KKB |')
    expect(md).not.toContain('<table')
  })

  it('leaves a table that already has a heading row alone', () => {
    const md = convert(
      '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>'
    )
    expect(md).toContain('| A | B |')
    expect(md).toContain('| 1 | 2 |')
    // Promotion must not steal a data row from a table that was already fine.
    expect(md).not.toContain('| 1 | 2 |\n| --- |')
  })

  it('survives Excel putting its fragment markers inside the table', () => {
    /*
     * The shape that actually broke this. Excel wraps the markers around the
     * rows rather than around the table, so trimming to them leaves bare
     * `<tr>` elements. A `<tr>` outside a table is invalid and the parser
     * discards it, keeping only the text and links — which looked like a
     * successful conversion while producing one run-on paragraph.
     */
    const md = convert(`Version:1.0
<html xmlns:o="urn:schemas-microsoft-com:office:office"><body>
<table border=0 cellpadding=0 cellspacing=0><col width=100><col width=100>
<!--StartFragment-->
<tr height=20><td>Date Found</td><td><a href="https://example.com">project44</a></td></tr>
<tr height=20><td>04-Sep-2026</td><td>Broadridge</td></tr>
<!--EndFragment-->
</table></body></html>`)

    expect(md).toContain('| Date Found | [project44](https://example.com) |')
    expect(md).toContain('| 04-Sep-2026 | Broadridge |')
  })

  it('picks the real header when the sheet opens with a merged title', () => {
    /*
     * The shape of an actual formatted spreadsheet: a merged title spanning
     * every column, a merged subtitle, a blank spacer row, then the headings.
     * Promoting the first row declared the table one column wide and every
     * row below was truncated to one.
     */
    const md = convert(`<table>
<tr><td colspan="3">Job Site Registration and Search Plan</td></tr>
<tr><td colspan="3">Register only where the target roles are likely to exist.</td></tr>
<tr><td></td><td></td><td></td></tr>
<tr><td>Priority</td><td>Site</td><td>Purpose</td></tr>
<tr><td>P1</td><td>LinkedIn</td><td>Discovery</td></tr>
<tr><td>P2</td><td>Indeed</td><td>Broad search</td></tr>
</table>`)

    expect(md).toContain('| Priority | Site | Purpose |')
    expect(md).toContain('| P1 | LinkedIn | Discovery |')
    expect(md).toContain('| P2 | Indeed | Broad search |')

    // The title and subtitle are kept, as text above the table.
    expect(md).toContain('Job Site Registration and Search Plan')
    expect(md).toContain('Register only where the target roles are likely to exist.')

    // The blank spacer row must not survive as a row of empty pipes.
    expect(md).not.toMatch(/\|\s*\|\s*\|\s*\|\s*\n\|\s*\|\s*\|\s*\|/)
  })

  it('still trims a web page copy to the selected part', () => {
    // The reason fragment trimming exists: browsers put the markers around
    // exactly what was highlighted, and without honouring them a copy drags
    // in the surrounding navigation.
    const md = convert(
      '<body><nav>Home About</nav><!--StartFragment--><p>Only <em>this</em>.</p><!--EndFragment--><footer>Legal</footer></body>'
    )
    expect(md).toBe('Only *this*.')
  })

  it('leaves prose untouched', () => {
    expect(convert('<p>Just a <strong>sentence</strong>.</p>')).toBe('Just a **sentence**.')
  })
})
