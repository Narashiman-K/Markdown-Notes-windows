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

// The only lines that differ from the web app's copy: the renderer sources
// live a couple of directories deeper here.
const { promoteHeaderRows } = await import('../src/renderer/src/lib/smartPaste')
const { htmlToMarkdown } = await import('../src/renderer/src/lib/convert/html')

const convert = (html: string): string => htmlToMarkdown(promoteHeaderRows(html)).trim()

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

  it('leaves prose untouched', () => {
    expect(convert('<p>Just a <strong>sentence</strong>.</p>')).toBe('Just a **sentence**.')
  })
})
