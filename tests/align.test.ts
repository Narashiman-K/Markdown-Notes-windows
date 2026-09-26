/**
 * Mapping a selection in the rendered pane back to the Markdown source.
 *
 * Every failure here is silent and destructive: the offsets come out slightly
 * wrong, the edit is applied somewhere else in the document, and nothing
 * throws. So the cases below are the shapes that actually misbehaved rather
 * than a tidy sample — selections whose boundaries are elements rather than
 * text nodes, which is what you get selecting to the end of a paragraph, or
 * anywhere inside a table cell or a highlighted code block.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body><article id="a"></article></body></html>')
;(globalThis as { window?: unknown }).window = dom.window
;(globalThis as { document?: unknown }).document = dom.window.document
;(globalThis as { DOMParser?: unknown }).DOMParser = dom.window.DOMParser
;(globalThis as { Node?: unknown }).Node = dom.window.Node
;(globalThis as { NodeFilter?: unknown }).NodeFilter = dom.window.NodeFilter

const { renderMarkdown } = await import('../src/renderer/src/lib/markdown')
const { buildSourceMap, rangeToOffsets, toSourceRange, trimRange } = await import(
  '../src/renderer/src/lib/align'
)

const SOURCE = `## About the role

Select any text in the preview and it should map back correctly.

- A bullet with some words
- Another bullet

| Site | Purpose |
| --- | --- |
| LinkedIn | Discovery and networking |
| Naukri | India recruiter database |

\`\`\`js
const greeting = 'hello world'
\`\`\`

Closing paragraph.
`

let article: HTMLElement

beforeAll(() => {
  article = dom.window.document.getElementById('a') as unknown as HTMLElement
  article.innerHTML = renderMarkdown(SOURCE, { sourceLines: true })
})

/** Selects `needle` in the rendered text and returns the source it maps to. */
function mapWords(needle: string): string {
  const rendered = article.textContent ?? ''
  const at = rendered.indexOf(needle)
  expect(at, `"${needle}" is not in the rendered text`).toBeGreaterThanOrEqual(0)

  // Walk to the text nodes holding each boundary, the way a real selection
  // would land, then hand the range over exactly as the component does.
  const walker = dom.window.document.createTreeWalker(article, dom.window.NodeFilter.SHOW_TEXT)
  let seen = 0
  let startNode: Text | null = null
  let startOffset = 0
  let endNode: Text | null = null
  let endOffset = 0

  let node = walker.nextNode() as Text | null
  while (node) {
    const length = (node.nodeValue ?? '').length
    if (!startNode && seen + length > at) {
      startNode = node
      startOffset = at - seen
    }
    if (!endNode && seen + length >= at + needle.length) {
      endNode = node
      endOffset = at + needle.length - seen
    }
    seen += length
    node = walker.nextNode() as Text | null
  }

  const range = dom.window.document.createRange()
  range.setStart(startNode!, startOffset)
  range.setEnd(endNode!, endOffset)

  const offsets = rangeToOffsets(article, range)
  expect(offsets, 'range did not resolve').not.toBeNull()

  const [s, e] = toSourceRange(buildSourceMap(SOURCE, rendered), offsets![0], offsets![1])
  return SOURCE.slice(s, e)
}

describe('rendered selection to source range', () => {
  it('maps a phrase in a paragraph', () => {
    expect(mapWords('Select any text')).toBe('Select any text')
  })

  it('maps a phrase inside a bullet', () => {
    expect(mapWords('some words')).toBe('some words')
  })

  it('maps a phrase inside a table cell', () => {
    // Table cells sit several elements deep, which is where boundary
    // resolution used to fall apart completely.
    expect(mapWords('Discovery and networking')).toBe('Discovery and networking')
  })

  it('maps a phrase inside a highlighted code block', () => {
    // highlight.js wraps tokens in spans, so even one word spans elements.
    expect(mapWords('greeting')).toBe('greeting')
  })

  it('maps a heading', () => {
    expect(mapWords('About the role')).toBe('About the role')
  })

  it('maps the last words of the document', () => {
    // The end of the document is where every wrong mapping ended up, so a
    // correct mapping there is worth asserting explicitly.
    expect(mapWords('Closing paragraph')).toBe('Closing paragraph')
  })

  it('drops the trailing space a double-click includes', () => {
    /*
     * Every browser extends a double-click to the space after the word. The
     * mapping is right, but wrapping "Press " gives `**Press **`, and
     * CommonMark requires the closing delimiter to follow a non-space
     * character, so it renders as literal asterisks. Butted against the
     * emphasis that follows it produced `****Ctrl+O**`.
     */
    const line = 'Press Ctrl+O to open'
    expect(trimRange(line, 0, 6)).toEqual([0, 5])
    expect(line.slice(0, 5)).toBe('Press')
  })

  it('trims whitespace at both ends and refuses an empty result', () => {
    expect(trimRange('a  word  b', 1, 9)).toEqual([3, 7])
    expect(trimRange('a     b', 1, 6)).toBeNull()
  })

  it('refuses a range outside the pane', () => {
    const outside = dom.window.document.createElement('div')
    outside.textContent = 'elsewhere'
    dom.window.document.body.appendChild(outside)

    const range = dom.window.document.createRange()
    range.selectNodeContents(outside)

    expect(rangeToOffsets(article, range)).toBeNull()
  })
})
