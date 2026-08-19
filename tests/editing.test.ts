import { describe, it, expect } from 'vitest'
import { wrapSelection, prefixLines, insertBlock } from '../src/renderer/src/lib/editing'
import { extractHeadings, documentStats } from '../src/renderer/src/lib/markdown'

describe('wrapSelection', () => {
  it('adds markers around the selection', () => {
    const r = wrapSelection('hello world', 6, 11, '**')
    expect(r.text).toBe('hello **world**')
    expect(r.selectionStart).toBe(8)
  })

  it('toggles markers off when already applied outside the selection', () => {
    const r = wrapSelection('hello **world**', 8, 13, '**')
    expect(r.text).toBe('hello world')
  })

  it('toggles markers off when they are inside the selection', () => {
    const r = wrapSelection('hello **world**', 6, 15, '**')
    expect(r.text).toBe('hello world')
  })
})

describe('prefixLines', () => {
  it('applies a heading prefix to each selected line', () => {
    const r = prefixLines('a\nb', 0, 3, '## ')
    expect(r.text).toBe('## a\n## b')
  })

  it('renumbers ordered lists', () => {
    const r = prefixLines('a\nb\nc', 0, 5, '1. ', true)
    expect(r.text).toBe('1. a\n2. b\n3. c')
  })
})

describe('insertBlock', () => {
  it('adds blank-line padding when mid-document', () => {
    const r = insertBlock('text', 4, 4, '---')
    expect(r.text).toBe('text\n\n---\n')
  })
})

describe('markdown helpers', () => {
  it('extracts headings and ignores fenced code', () => {
    const src = '# One\n\n```\n# NotAHeading\n```\n\n## Two\n'
    const h = extractHeadings(src)
    expect(h.map((x) => x.text)).toEqual(['One', 'Two'])
    expect(h[0].slug).toBe('one')
  })

  it('deduplicates slugs', () => {
    const h = extractHeadings('# Dup\n\n# Dup\n')
    expect(h[1].slug).toBe('dup-2')
  })

  it('counts words', () => {
    expect(documentStats('one two three').words).toBe(3)
  })
})
