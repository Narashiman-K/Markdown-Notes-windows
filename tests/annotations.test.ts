import { describe, it, expect } from 'vitest'
import {
  applyAnnotation,
  listAnnotations,
  removeAnnotation,
  removeAllAnnotations,
  segmentRange,
  updateNote,
  codeRegions,
  repairPictures
} from '../src/renderer/src/lib/annotations'
import { buildSourceMap, toSourceRange } from '../src/renderer/src/lib/align'

describe('buildSourceMap', () => {
  it('maps rendered text back onto markdown source', () => {
    const source = '# Title\n\nSome **bold** words here.\n'
    const rendered = 'TitleSome bold words here.'
    const map = buildSourceMap(source, rendered)
    const idx = rendered.indexOf('bold')
    const [s, e] = toSourceRange(map, idx, idx + 4)
    expect(source.slice(s, e)).toBe('bold')
  })

  it('handles list markers and headings', () => {
    const source = '- alpha\n- beta\n'
    const rendered = 'alphabeta'
    const map = buildSourceMap(source, rendered)
    const [s, e] = toSourceRange(map, 5, 9)
    expect(source.slice(s, e)).toBe('beta')
  })
})

describe('segmentRange', () => {
  it('splits a multi-line range into per-line chunks', () => {
    const source = 'one two\nthree four\n'
    const segs = segmentRange(source, 4, 13)
    expect(segs.length).toBe(2)
    expect(source.slice(segs[0][0], segs[0][1])).toBe('two')
    expect(source.slice(segs[1][0], segs[1][1])).toBe('three')
  })

  it('skips fenced code blocks', () => {
    const source = 'text\n```\ncode here\n```\n'
    const start = source.indexOf('code')
    expect(segmentRange(source, start, start + 4)).toEqual([])
  })

  it('drops leading block markers', () => {
    const source = '- item text\n'
    const segs = segmentRange(source, 0, 11)
    expect(source.slice(segs[0][0], segs[0][1])).toBe('item text')
  })
})

describe('codeRegions', () => {
  it('finds inline and fenced code', () => {
    const source = 'a `inline` b\n```\nblock\n```\n'
    const regions = codeRegions(source)
    expect(regions.length).toBeGreaterThanOrEqual(2)
  })
})

describe('annotation round-trip', () => {
  const source = 'Hello brave new world.\n'

  it('wraps a highlight and lists it', () => {
    const { source: next, id } = applyAnnotation(source, 6, 11, { type: 'highlight', color: 'yellow' })
    expect(next).toContain('<mark class="mn-a mn-highlight"')
    expect(next).toContain('>brave</mark>')
    const list = listAnnotations(next)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(id)
    expect(list[0].text).toBe('brave')
    expect(list[0].color).toBe('yellow')
  })

  it('removes an annotation and restores the original text', () => {
    const { source: next, id } = applyAnnotation(source, 6, 11, { type: 'underline' })
    expect(removeAnnotation(next, id)).toBe(source)
  })

  it('stores and updates a comment note', () => {
    const { source: next, id } = applyAnnotation(source, 0, 5, { type: 'comment', note: 'first note' })
    expect(listAnnotations(next)[0].note).toBe('first note')
    const edited = updateNote(next, id, 'second note')
    expect(listAnnotations(edited)[0].note).toBe('second note')
  })

  it('escapes quotes and newlines inside notes', () => {
    const { source: next } = applyAnnotation(source, 0, 5, { type: 'comment', note: 'he said "hi"\nbye' })
    const raw = /data-mn-note="([^"]*)"/.exec(next)![1]
    expect(raw).toBe('he said &quot;hi&quot;&#10;bye')
    expect(listAnnotations(next)[0].note).toBe('he said "hi"\nbye')
  })

  it('handles nested annotations of the same tag', () => {
    const first = applyAnnotation(source, 0, 21, { type: 'highlight', color: 'blue' })
    const inner = first.source.indexOf('brave')
    const second = applyAnnotation(first.source, inner, inner + 5, { type: 'highlight', color: 'pink' })
    expect(listAnnotations(second.source)).toHaveLength(2)
    const cleaned = removeAllAnnotations(second.source)
    expect(cleaned).toBe(source)
  })

  it('annotates across several lines as separate segments', () => {
    const multi = 'line one here\nline two here\n'
    const { source: next, applied } = applyAnnotation(multi, 5, 22, { type: 'highlight', color: 'green' })
    expect(applied).toBe(2)
    expect(listAnnotations(next)).toHaveLength(1)
    expect(removeAllAnnotations(next)).toBe(multi)
  })

  it('is a no-op when the selection is entirely inside code', () => {
    const withCode = 'before\n```\nsecret\n```\nafter\n'
    const at = withCode.indexOf('secret')
    const { source: next, applied } = applyAnnotation(withCode, at, at + 6, { type: 'highlight' })
    expect(applied).toBe(0)
    expect(next).toBe(withCode)
  })
})

describe('annotations next to an embedded picture', () => {
  // A picture as converted from an EPUB, Word or PDF: a long data URL full of
  // letters, which the mapping used to match against the visible text after it.
  const data = 'data:image/jpeg;base64,' + 'TGFzdCBwYXJhZ3JhcGggb2YgY2hhcHRlcg'.repeat(400)
  const source = `A note follows.\n\n![Sales chart](${data})\n\nLast paragraph of chapter one.\n`
  const rendered = 'A note follows.\n\nLast paragraph of chapter one.'

  it('maps text after the picture to the text, not into the picture data', () => {
    const map = buildSourceMap(source, rendered)
    const at = rendered.indexOf('Last')
    const [s, e] = toSourceRange(map, at, at + 'Last paragraph'.length)
    expect(source.slice(s, e)).toBe('Last paragraph')
  })

  it('never puts a tag inside a picture: a range that touches one takes it whole', () => {
    const inside = source.indexOf('base64,') + 10
    const segs = segmentRange(source, source.indexOf('note'), inside)
    for (const [a, b] of segs) {
      const pic = source.indexOf('![')
      const end = source.indexOf(')', pic) + 1
      expect(a <= pic || a >= end).toBe(true)
      expect(b <= pic || b >= end).toBe(true)
    }
    const out = applyAnnotation(source, source.indexOf('Last') - 3, source.indexOf('Last') + 4, { type: 'highlight' }).source
    expect(out).toContain(`(${data})`)
  })

  it('does not put a tag inside a link address', () => {
    const src = 'See [the terms](https://example.com/terms) today.'
    const segs = segmentRange(src, src.indexOf('terms)') , src.indexOf('today') + 5)
    expect(applyAnnotation(src, segs[0][0], segs[0][1], { type: 'underline' }).source).toContain('(https://example.com/terms)')
  })
})
describe('repairing a picture damaged by an earlier highlight', () => {
  const data = 'data:image/jpeg;base64,' + 'QUJD'.repeat(50)
  const good = `Text before.\n\n![Chart](${data})\n\nLast paragraph.\n`

  it('takes the tags out of the picture data and drops the broken annotation', () => {
    const cut = data.length - 40
    const broken = good.replace(data, `${data.slice(0, cut)}<mark data-mn-id="x1" data-mn-type="highlight">${data.slice(cut)}`).replace('Last paragraph', 'Last</mark> paragraph')
    const r = repairPictures(broken)
    expect(r.repaired).toBe(1)
    expect(r.source).toBe(good)
  })

  it('also when the close tag landed in the data', () => {
    const cut = 30
    const broken = good.replace('before.', '<mark data-mn-id="x2" data-mn-type="highlight">before.').replace(data, `${data.slice(0, cut)}</mark>${data.slice(cut)}`)
    expect(repairPictures(broken).source).toBe(good)
  })

  it('leaves a healthy document alone', () => {
    const ok = applyAnnotation(good, good.indexOf('Last'), good.indexOf('Last') + 4, { type: 'highlight' }).source
    expect(repairPictures(ok)).toEqual({ source: ok, repaired: 0 })
  })
})
