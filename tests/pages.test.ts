import { describe, it, expect } from 'vitest'
import { md, standaloneHtml } from '../src/renderer/src/lib/markdown'
import { PAGE_BREAK, pageSizeLine, pageSizeName, readPageSize, sheetStyle, hasScans, removeScans } from '../src/renderer/src/lib/pages'
import { mergeDocuments } from '../src/renderer/src/lib/merge'

/* Rendered without DOMPurify, which needs a window: the rule under test runs
   inside markdown-it, before sanitising. */
const render = (source: string, pages = false): string => md.render(source, { pages })

const scan = (n: number): string => `![Original page ${n}](data:image/jpeg;base64,AAAA "suprasuta:scan")`

const twoPages = [
  '# Report',
  pageSizeLine({ width: 595.3, height: 841.9 }),
  '## Page 1',
  'First page text.',
  PAGE_BREAK,
  '## Page 2',
  'Second page text.'
].join('\n\n')

describe('page size', () => {
  it('is read back as written', () => {
    expect(readPageSize(twoPages)).toEqual({ width: 595.3, height: 841.9 })
    expect(readPageSize('# No size here')).toBeNull()
  })

  it('refuses sizes no printer takes', () => {
    expect(readPageSize('<!-- suprasuta:page-size width="5" height="842" -->')).toBeNull()
  })

  it('names the common papers in either orientation', () => {
    expect(pageSizeName({ width: 595.3, height: 841.9 })).toBe('A4')
    expect(pageSizeName({ width: 792, height: 612 })).toBe('Letter landscape')
    expect(pageSizeName({ width: 595, height: 280 })).toBe('210 × 99 mm')
  })

  it('becomes sheet lengths in em, so zoom scales them, with A4 by default', () => {
    expect(sheetStyle({ width: 612, height: 792 })).toEqual({ '--mn-page-w': '51.00em', '--mn-page-h': '66.00em' })
    expect(sheetStyle(null)['--mn-page-w']).toBe('49.58em')
  })
})

describe('rendering the notes', () => {
  it('draws nothing for the size and a divider for a break', () => {
    const html = render(twoPages)
    expect(html).not.toContain('suprasuta:page-size')
    expect(html).not.toContain('suprasuta:page-break')
    expect(html.match(/class="mn-page-break"/g)).toHaveLength(1)
    expect(html).not.toContain('mn-sheet')
  })

  it('in page view, puts each original page on a sheet of its own', () => {
    const html = render(twoPages, true)
    const sheets = html.split('<section class="mn-sheet">').slice(1)
    expect(sheets).toHaveLength(2)
    expect(sheets[0]).toContain('First page text.')
    expect(sheets[0]).not.toContain('Second page text.')
    expect(sheets[1]).toContain('Second page text.')
    expect(html).not.toContain('mn-page-break')
  })

  it('treats a document with no breaks as one sheet', () => {
    const html = render('# Notes\n\nJust text.', true)
    expect(html.match(/<section class="mn-sheet">/g)).toHaveLength(1)
  })

  it('shows a scanned page beside its text, with no marker tooltip', () => {
    const source = ['# Scan', '## Page 1', scan(1), 'Read text one.', PAGE_BREAK, '## Page 2', scan(2), 'Read text two.'].join('\n\n')
    const plain = render(source)
    expect(plain).not.toContain('suprasuta:scan')
    expect(plain.match(/class="mn-scan"/g)).toHaveLength(2)

    const paged = render(source, true)
    const pairs = paged.split('<section class="mn-sheet-pair">').slice(1)
    expect(pairs).toHaveLength(2)
    const [original, text] = pairs[0].split('<div class="mn-sheet mn-sheet-text">')
    expect(original).toContain('mn-scan')
    expect(original).not.toContain('Read text one.')
    expect(text).toContain('Read text one.')
    expect(text).toContain('Page 1')
  })

  it('leaves an ordinary picture alone', () => {
    const html = render('![chart](data:image/png;base64,AAAA "A chart")', true)
    expect(html).toContain('title="A chart"')
    expect(html).not.toContain('mn-sheet-pair')
  })

  it('does not take a break written inside a code block', () => {
    const html = render(['# Doc', '```', PAGE_BREAK, '```'].join('\n\n'), true)
    expect(html.match(/<section class="mn-sheet">/g)).toHaveLength(1)
    expect(html).toContain('&lt;!-- suprasuta:page-break --&gt;')
  })
})

describe('merging documents with pages', () => {
  it('keeps each document titled and its page notes in place', () => {
    const out = mergeDocuments(
      [
        { name: 'a.pdf', markdown: twoPages },
        { name: 'b.md', markdown: '# B\n\nText.' }
      ],
      'sections'
    )
    expect(out.match(/^# /gm)).toHaveLength(2)
    expect(readPageSize(out)).toEqual({ width: 595.3, height: 841.9 })
    expect(out).toContain(PAGE_BREAK)
  })
})

describe('printing', () => {
  it('uses the original paper size when the document recorded one', () => {
    const size = readPageSize(twoPages)
    expect(standaloneHtml('r', '', '', true, size)).toContain('@page { size: 595.3pt 841.9pt; margin')
    expect(standaloneHtml('r', '', '', true, null)).toContain('@page { margin')
    // Exported HTML is not paper; it carries no page rule at all.
    expect(standaloneHtml('r', '', '', false, size)).not.toContain('@page')
  })
})

describe('original page pictures: hiding and removing', () => {
  const source = ['# Scan', '## Page 1', scan(1), 'Read text one.', PAGE_BREAK, '## Page 2', scan(2), 'Read text two.'].join('\n\n')

  it('knows whether a document keeps any', () => {
    expect(hasScans(source)).toBe(true)
    expect(hasScans('![chart](data:image/png;base64,AAAA "A chart")')).toBe(false)
  })

  it('hidden: only the text is drawn, on single sheets, and the file is untouched', () => {
    const html = md.render(source, { pages: true, hideScans: true })
    expect(html).not.toContain('<img')
    expect(html).not.toContain('mn-sheet-pair')
    expect(html.match(/<section class="mn-sheet">/g)).toHaveLength(2)
    expect(html).toContain('Read text two.')
  })

  it('removed: the pictures leave the file and the text stays', () => {
    const { markdown, removed } = removeScans(source)
    expect(removed).toBe(2)
    expect(hasScans(markdown)).toBe(false)
    expect(markdown).not.toMatch(/\n{3,}/)
    expect(markdown).toBe(['# Scan', '## Page 1', 'Read text one.', PAGE_BREAK, '## Page 2', 'Read text two.'].join('\n\n'))
  })

  it('removes nothing else, and reports when there was nothing', () => {
    const other = '# Doc\n\n![chart](data:image/png;base64,AAAA "A chart")'
    expect(removeScans(other)).toEqual({ markdown: other, removed: 0 })
  })
})
