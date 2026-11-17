// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { blockToMarkdown, insertAfter, replaceBlock, splitBlocks } from '../src/renderer/src/lib/docBlocks'

const DOC = [
  '# Title',
  '',
  '<!-- toc -->',
  '- [One](#one)',
  '<!-- /toc -->',
  '',
  'First paragraph with <mark class="mn-a mn-highlight" data-mn-id="h1" data-mn-type="highlight">a highlight</mark>.',
  '',
  '— 3 —',
  '',
  '<!-- suprasuta:page-break page="4" -->',
  '',
  '## One',
  '',
  '- a',
  '- b',
  '',
  '```mermaid',
  'flowchart TD',
  '  A --> B',
  '```',
  '',
  '| x | y |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '![pic](file:///D:/a.png)',
  ''
].join('\n')

describe('Doc Editor blocks', () => {
  it('cuts the document into editable and kept-safe blocks', () => {
    expect(splitBlocks(DOC).map((b) => b.kind)).toEqual(['heading', 'toc', 'text', 'page', 'page', 'heading', 'list', 'mermaid', 'table', 'image'])
  })

  it('changes only the edited block, leaving every other line as it was', () => {
    const blocks = splitBlocks(DOC)
    const para = blocks[2]
    const next = replaceBlock(DOC, para, 'Changed paragraph.')
    const before = DOC.split('\n')
    const after = next.split('\n')
    expect(after.length).toBe(before.length)
    after.forEach((l, i) => i !== para.start && expect(l).toBe(before[i]))
  })

  it('keeps highlights exactly when a block is turned back into Markdown', () => {
    const html = '<p>First <strong>bold</strong> and <mark class="mn-a mn-highlight" data-mn-id="h1" data-mn-type="highlight">a highlight</mark>.</p>'
    const md = blockToMarkdown(html)
    expect(md).toContain('**bold**')
    expect(md).toContain('<mark class="mn-a mn-highlight" data-mn-id="h1" data-mn-type="highlight">a highlight</mark>')
  })

  it('writes lists, headings, links and quotes as Markdown', () => {
    expect(blockToMarkdown('<h2>Topic</h2>')).toBe('## Topic')
    expect(blockToMarkdown('<ul><li>a</li><li>b</li></ul>')).toBe('- a\n- b')
    expect(blockToMarkdown('<p>See <a href="https://suprasuta.in">site</a></p>')).toBe('See [site](https://suprasuta.in)')
    expect(blockToMarkdown('<blockquote><p>Quote</p></blockquote>')).toBe('> Quote')
  })

  it('removes an emptied block and inserts new ones after a block', () => {
    const blocks = splitBlocks(DOC)
    expect(replaceBlock(DOC, blocks[2], '')).not.toContain('First paragraph')
    const added = insertAfter(DOC, blocks[0], 'New text.')
    expect(added.startsWith('# Title\n\nNew text.\n\n<!-- toc -->')).toBe(true)
  })
})

describe('paragraph styles', () => {
  it('turns a paragraph into a list, quote or heading and back', async () => {
    const { restyle } = await import('../src/renderer/src/lib/docBlocks')
    expect(restyle('Hello world', 'ul')).toBe('- Hello world')
    expect(restyle('- Hello world', 'ul')).toBe('Hello world')
    expect(restyle('Hello', 'ol')).toBe('1. Hello')
    expect(restyle('Hello', 'quote')).toBe('> Hello')
    expect(restyle('> Hello', 'quote')).toBe('Hello')
    expect(restyle('- Hello', 'h2')).toBe('## Hello')
    expect(restyle('## Hello', 'p')).toBe('Hello')
  })
  it('indents the list item with the caret', async () => {
    const { restyle } = await import('../src/renderer/src/lib/docBlocks')
    expect(restyle('- a\n- b\n- c', 'indent', 1)).toBe('- a\n  - b\n- c')
    expect(restyle('- a\n  - b\n- c', 'outdent', 1)).toBe('- a\n- b\n- c')
  })
  it('writes strikethrough with two tildes', async () => {
    const { blockToMarkdown } = await import('../src/renderer/src/lib/docBlocks')
    expect(blockToMarkdown('<p><strike>Testing</strike> it</p>')).toBe('~~Testing~~ it')
  })
})
