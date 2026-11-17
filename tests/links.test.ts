// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { linkTarget, markdownLink, normaliseUrl } from '../src/renderer/src/lib/links'
import { renderMarkdown } from '../src/renderer/src/lib/markdown'

describe('links', () => {
  it('completes web addresses typed without https://', () => {
    expect(normaliseUrl('astrology.suprasuta.in')).toBe('https://astrology.suprasuta.in')
    expect(normaliseUrl('www.example.com/page?x=1')).toBe('https://www.example.com/page?x=1')
    expect(normaliseUrl(' https://a.b/c ')).toBe('https://a.b/c')
    expect(normaliseUrl('me@example.com')).toBe('mailto:me@example.com')
  })
  it('leaves files and places in the document alone', () => {
    expect(normaliseUrl('readme.md')).toBe('readme.md')
    expect(normaliseUrl('chapter2.xhtml')).toBe('chapter2.xhtml')
    expect(normaliseUrl('#chapter-1')).toBe('#chapter-1')
    expect(linkTarget('chapter2.xhtml').kind).toBe('none')
  })
  it('opens older links written without https://', () => {
    expect(linkTarget('astrology.suprasuta.in')).toEqual({ kind: 'external', url: 'https://astrology.suprasuta.in' })
    expect(linkTarget('#intro')).toEqual({ kind: 'anchor', id: 'intro' })
  })
  it('writes safe Markdown links', () => {
    expect(markdownLink('Astrology', 'https://astrology.suprasuta.in')).toBe('[Astrology](https://astrology.suprasuta.in)')
    expect(markdownLink('', 'https://a.b/')).toBe('[a.b](https://a.b/)')
    expect(markdownLink('x', 'https://a.b/my page')).toBe('[x](<https://a.b/my page>)')
  })
  it('turns full addresses in plain text into links, but not file names', () => {
    const html = renderMarkdown('See https://suprasuta.in and readme.md')
    expect(html).toContain('href="https://suprasuta.in"')
    expect(html).not.toContain('href="http://readme.md"')
  })
})
