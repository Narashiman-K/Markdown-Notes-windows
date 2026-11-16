// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '../src/renderer/src/lib/markdown'
import { withDiagrams } from '../src/renderer/src/lib/mermaidView'

describe('mermaid blocks', () => {
  const src = '# T\n\n```mermaid\ngraph TD\n  A["a < b"] --> B\n```\n\n```js\nlet x = 1\n```\n'

  it('marks mermaid fences for the viewer and keeps the code readable', () => {
    const html = renderMarkdown(src)
    expect(html).toContain('class="mn-mermaid"')
    expect(html).toContain('graph TD')
    expect(html).toContain('a &lt; b')
    // Other code blocks are unchanged.
    expect(html.match(/mn-mermaid/g)?.length).toBe(1)
  })

  it('keeps the source line for scroll syncing', () => {
    expect(renderMarkdown(src, { sourceLines: true })).toMatch(/class="mn-mermaid" data-line="2"/)
  })

  it('leaves undrawn diagrams as code in exports', () => {
    const html = renderMarkdown(src)
    expect(withDiagrams(html)).toBe(html)
  })
})
