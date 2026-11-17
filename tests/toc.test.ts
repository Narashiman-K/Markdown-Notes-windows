// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { tocBlock, refreshToc, hasOldPageHeadings, upgradeOldPages } from '../src/renderer/src/lib/toc'
import { tidyContents } from '../src/renderer/src/lib/convert/contents'
import { renderMarkdown } from '../src/renderer/src/lib/markdown'

const OLD = [
  '# Subliminal Psychology 101',
  '<!-- suprasuta:page-size width="432" height="648" -->',
  '## Page 1',
  'Cover text.',
  '<!-- suprasuta:page-break -->',
  '## Page 3',
  '### Table of Contents',
  'Introduction Chapter 1: The Secrets of Subliminal Psychology Chapter 2: How to Use Subliminal Psychology Conclusion',
  '<!-- suprasuta:page-break -->',
  '## Page 4',
  '### Introduction',
  'Body.',
  '### Chapter 1: The Secrets of Subliminal Psychology',
  'More.'
].join('\n\n')

describe('older converted files', () => {
  it('notices the old page headings', () => {
    expect(hasOldPageHeadings(OLD)).toBe(true)
    expect(hasOldPageHeadings('# A\n\n## Page 1\n\ntext')).toBe(false)
  })

  it('turns them into footers and numbered breaks', () => {
    const out = upgradeOldPages(OLD)
    expect(out).not.toMatch(/^## Page/m)
    expect(out).toMatch(/Cover text\.\n\n— 1 —\n\n<!-- suprasuta:page-break page="3" -->/)
    expect(out).toMatch(/— 3 —\n\n<!-- suprasuta:page-break page="4" -->/)
    expect(out.trimEnd().endsWith('— 4 —')).toBe(true)
  })

  it('splits the run-on contents and links entries to their chapters', () => {
    const out = upgradeOldPages(OLD)
    expect(out).toContain('- [Introduction](#introduction)')
    expect(out).toContain('- [Chapter 1: The Secrets of Subliminal Psychology](#chapter-1-the-secrets-of-subliminal-psychology)')
    // No chapter of that name: kept as a plain entry.
    expect(out).toContain('- Chapter 2: How to Use Subliminal Psychology')
    expect(out).toContain('- Conclusion')
  })
})

describe('contents', () => {
  it('leaves a document without a contents heading alone', () => {
    const md = '# T\n\nChapter 1 x Chapter 2 y Chapter 3 z'
    expect(tidyContents(md)).toBe(md)
  })

  it('builds and refreshes a table of contents from the headings', () => {
    const md = `# Title\n\n${tocBlock('# Title\n\n## One\n\n### Sub')}\n\n## One\n\n### Sub\n\n## Two`
    const fresh = refreshToc(md)
    expect(fresh).toContain('- [One](#one)\n  - [Sub](#sub)\n- [Two](#two)')
    expect(fresh).not.toContain('[Title]')
  })
})

describe('rendering page notes', () => {
  it('shows page numbers as a small footer, with anchors for links', () => {
    const html = renderMarkdown('# T\n\nA\n\n— 1 —\n\n<!-- suprasuta:page-break page="2" -->\n\nB\n\n— 2 —')
    expect(html).toContain('class="mn-page-num"')
    expect(html).toContain('Page 1 of 2')
    expect(html).toContain('Page 2 of 2')
    expect(html).toContain('id="page-1"')
    expect(html).toContain('id="page-2"')
    expect(html).not.toContain('— 1 —')
  })

  it('gives each sheet its page anchor in page view', () => {
    const html = renderMarkdown('A\n\n— 1 —\n\n<!-- suprasuta:page-break page="2" -->\n\nB\n\n— 2 —', { pages: true })
    expect(html).toMatch(/<section class="mn-sheet" id="page-2">/)
  })
})

describe('placing a table of contents', () => {
  it('goes before the first chapter, after the title and front matter', async () => {
    const { placeToc } = await import('../src/renderer/src/lib/toc')
    const r = placeToc('# Book\n\nBy someone. Copyright.\n\n## One\n\nA.\n\n## Two\n\nB.\n')
    expect(r.where).toBe('new')
    expect(r.text.indexOf('<!-- toc -->')).toBeGreaterThan(r.text.indexOf('Copyright'))
    expect(r.text.indexOf('<!-- toc -->')).toBeLessThan(r.text.indexOf('## One'))
    expect(placeToc(r.text).where).toBe('block')
  })
  it('updates the book own contents section in place, keeping page notes, and never duplicates', async () => {
    const { placeToc } = await import('../src/renderer/src/lib/toc')
    const book = ['# Book', '', '<!-- toc -->', '- old', '<!-- /toc -->', '', 'Title page.', '', '### Table of Contents', '', '- [Chapter 1](#page-9)', '- Chapter 2', 'run on text', '', '— 6 —', '', '<!-- suprasuta:page-break page="7" -->', '', '- [Chapter 3](#page-20)', '', '### Chapter 1', '', 'A.', '', '### Chapter 2', '', 'B.', ''].join('\n')
    const r = placeToc(book)
    expect(r.where).toBe('section')
    expect(r.text.match(/<!-- toc -->/g)?.length).toBe(1)
    const at = r.text.indexOf('<!-- toc -->')
    expect(at).toBeGreaterThan(r.text.indexOf('### Table of Contents'))
    expect(r.text).toContain('- [Chapter 1](#chapter-1)')
    expect(r.text).not.toContain('run on text')
    expect(r.text).toContain('— 6 —')
    expect(r.text).toContain('page-break page="7"')
    // The contents heading itself is not listed.
    expect(r.text).not.toContain('[Table of Contents]')
    expect(placeToc(r.text).text).toBe(r.text)
  })
})