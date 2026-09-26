/**
 * Source-line stamping, which is what scroll syncing rides on.
 *
 * Worth testing rather than eyeballing, because every way this breaks is
 * silent: the attributes vanish and the panes simply stop following each
 * other, with no error anywhere. Two of the three failures below were real at
 * some point — the sanitiser stripping data attributes, and the opt-in flag
 * leaking line numbers into exported HTML.
 */
import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'

/*
 * DOMPurify decides at import time whether it has a DOM to work with, and
 * without one its default export is a factory rather than the sanitiser. So
 * the globals go in first and the module is pulled in afterwards.
 *
 * Deliberately not `// @vitest-environment jsdom`: that directive is what made
 * office.test.ts fail on Windows, because it makes Vite externalise the node
 * builtins the converters rely on.
 */
const dom = new JSDOM('')
;(globalThis as { window?: unknown }).window = dom.window
;(globalThis as { document?: unknown }).document = dom.window.document

// The only line that differs from the web app's copy of this test: the
// renderer lives a couple of directories deeper here.
const { renderMarkdown } = await import('../src/renderer/src/lib/markdown')

const SOURCE = `# Title

A paragraph.

\`\`\`js
const x = 1
\`\`\`

> quoted

| a | b |
| --- | --- |
| 1 | 2 |
`

describe('renderMarkdown source lines', () => {
  it('stamps nothing unless asked', () => {
    expect(renderMarkdown(SOURCE)).not.toContain('data-line')
  })

  it('stamps block elements with their source line', () => {
    const html = renderMarkdown(SOURCE, { sourceLines: true })
    // The heading is line 0, the paragraph line 2 — zero-based, matching what
    // the sync code expects from CodeMirror.
    expect(html).toContain('<h1 data-line="0"')
    expect(html).toContain('<p data-line="2"')
  })

  it('survives sanitising', () => {
    // DOMPurify drops unknown attributes by default. If ALLOW_DATA_ATTR were
    // ever turned off, every data-line would disappear and scroll syncing
    // would quietly do nothing at all.
    const html = renderMarkdown(SOURCE, { sourceLines: true })
    const count = (html.match(/data-line=/g) ?? []).length
    expect(count).toBeGreaterThanOrEqual(5)
  })

  it('stamps lines in increasing order, so anchors sort correctly', () => {
    const html = renderMarkdown(SOURCE, { sourceLines: true })
    const lines = [...html.matchAll(/data-line="(\d+)"/g)].map((m) => Number(m[1]))
    expect(lines).toEqual([...lines].sort((a, b) => a - b))
  })

  it('covers fences, quotes and tables, not just paragraphs', () => {
    // These are the blocks a reader scrolls past and the ones most likely to
    // be tall, so an anchor inside each is what keeps the panes aligned.
    const html = renderMarkdown(SOURCE, { sourceLines: true })
    expect(html).toMatch(/<pre[^>]*data-line=|<pre><code[^>]*data-line=/)
    expect(html).toMatch(/<blockquote data-line=/)
    expect(html).toMatch(/<table data-line=/)
  })
})
