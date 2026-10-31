import { describe, it, expect } from 'vitest'
import { applyAnnotation, listAnnotations, removeAllAnnotations } from '../src/renderer/src/lib/annotations'
import {
  annotationSummary,
  exportAnnotations,
  importAnnotations,
  parseAnnotationsFile,
  type AnnotationsFile
} from '../src/renderer/src/lib/annotationTransfer'

const DOC = [
  '# Report',
  '',
  '## Revenue',
  '',
  'Revenue rose across every region this year, led by the north.',
  '',
  '## Risks',
  '',
  'Supply chain delays remain the largest open risk. Revenue rose again in March.',
  ''
].join('\n')

/** Annotates the first occurrence of `words` in `source`. */
function mark(source: string, words: string, input: Parameters<typeof applyAnnotation>[3]): string {
  const at = source.indexOf(words)
  return applyAnnotation(source, at, at + words.length, input).source
}

function annotated(): string {
  let s = DOC
  s = mark(s, 'led by the north', { type: 'highlight', color: 'yellow', note: 'Check the figures', author: 'NK', at: '2026-10-01T10:00:00.000Z' })
  s = mark(s, 'largest open risk', { type: 'underline', note: 'Discuss on Monday' })
  return s
}

/** Annotation kind and the words it marks, in order. */
const marks = (source: string): string[] => listAnnotations(source).map((a) => `${a.type}:${a.text}`)

describe('exporting annotations', () => {
  it('records each annotation with its words, context, section and details', () => {
    const file = exportAnnotations(annotated(), 'report.md')
    expect(file.format).toBe('suprasuta-annotations')
    expect(file.annotations).toHaveLength(2)
    const [first, second] = file.annotations
    expect(first).toMatchObject({ type: 'highlight', exact: 'led by the north', color: 'yellow', note: 'Check the figures', author: 'NK', section: 'Revenue' })
    expect(first.prefix.endsWith('this year, ')).toBe(true)
    expect(second).toMatchObject({ type: 'underline', exact: 'largest open risk', section: 'Risks' })
    expect(file.textLength).toBe(DOC.length)
  })

  it('writes a readable summary grouped by section', () => {
    const md = annotationSummary(exportAnnotations(annotated(), 'report.md'))
    expect(md).toContain('# Annotations: report.md')
    expect(md).toContain('## Revenue')
    expect(md).toContain('> led by the north')
    expect(md).toContain('**Note:** Check the figures')
    expect(md.indexOf('## Revenue')).toBeLessThan(md.indexOf('## Risks'))
  })
})

describe('re-importing annotations', () => {
  // One annotated source for the whole block: annotation ids and times are
  // generated, so a second call to annotated() would differ from the first.
  const SOURCE = annotated()
  const file = (): AnnotationsFile => parseAnnotationsFile(JSON.stringify(exportAnnotations(SOURCE, 'report.md')))

  it('puts them back exactly on a clean copy, keeping notes, authors and dates', () => {
    const r = importAnnotations(removeAllAnnotations(SOURCE), file())
    expect(r.placed).toBe(2)
    expect(r.notPlaced).toHaveLength(0)
    // The same text and the same tags: ids, notes, authors, dates.
    expect(r.source).toBe(SOURCE)
    expect(marks(r.source)).toEqual(marks(SOURCE))
    expect(r.source).toContain('data-mn-at="2026-10-01T10:00:00.000Z"')
    expect(removeAllAnnotations(r.source)).toBe(DOC)
  })

  it('finds them after the text has moved and its spacing changed', () => {
    const edited = [
      '# Report',
      '',
      'A new opening paragraph pushes everything down the page.',
      '',
      '## Risks',
      '',
      'Supply chain delays remain the largest\nopen risk. Revenue rose again in March.',
      '',
      '## Revenue',
      '',
      'Revenue rose across every region this year, led by the north.',
      ''
    ].join('\n')
    const r = importAnnotations(edited, file())
    expect(r.placed).toBe(2)
    // Over a line break the underline is two segments, listed as one.
    expect(marks(r.source)).toEqual(['underline:largest open risk', 'highlight:led by the north'])
    expect(removeAllAnnotations(r.source)).toBe(edited)
  })

  it('uses the closest match when the words were edited a little, and says so', () => {
    const edited = DOC.replace('led by the north', 'led by the far north')
    const r = importAnnotations(edited, file())
    expect(r.placed).toBe(2)
    expect(r.approximate).toBe(1)
    expect(removeAllAnnotations(r.source)).toBe(edited)
  })

  it('reports what it cannot place instead of dropping it silently', () => {
    const edited = DOC.replace('Supply chain delays remain the largest open risk.', 'Nothing to worry about.')
    const r = importAnnotations(edited, file())
    expect(r.placed).toBe(1)
    expect(r.notPlaced.map((a) => a.exact)).toEqual(['largest open risk'])
  })

  it('chooses between repeated words by their surroundings', () => {
    const doc = 'Revenue rose. Costs fell.\n\nLater, revenue rose. Revenue rose again.'
    const at = doc.indexOf('Revenue rose again') // the third occurrence of "Revenue rose" in any case
    const source = applyAnnotation(doc, at, at + 'Revenue rose'.length, { type: 'highlight' }).source
    const r = importAnnotations(doc, parseAnnotationsFile(JSON.stringify(exportAnnotations(source, 'd.md'))))
    expect(r.placed).toBe(1)
    expect(r.source).toBe(source.replace(/data-mn-at="[^"]*"/, (m) => m))
  })

  it('adds to existing annotations and skips the ones already there', () => {
    const r1 = importAnnotations(SOURCE, file())
    expect(r1.placed).toBe(0)
    expect(r1.duplicates).toBe(2)
    expect(r1.source).toBe(SOURCE)

    const partly = mark(DOC, 'led by the north', { type: 'highlight', color: 'yellow' })
    const r2 = importAnnotations(partly, file())
    expect(r2.placed).toBe(1)
    expect(r2.duplicates).toBe(1)
    expect(listAnnotations(r2.source)).toHaveLength(2)
  })

  it('nests a new annotation on the same words inside an existing one', () => {
    const underlined = mark(DOC, 'led by the north', { type: 'underline' })
    const r = importAnnotations(underlined, file())
    expect(r.placed).toBe(2)
    // The highlight goes inside the underline, not across its tags.
    expect(r.source).toMatch(/<u [^>]*><mark [^>]*>led by the north<\/mark><\/u>/)
  })

  it('rejects files that are not annotations files', () => {
    expect(() => parseAnnotationsFile('not json')).toThrow(/not valid JSON/)
    expect(() => parseAnnotationsFile('{"format":"other","annotations":[]}')).toThrow(/not a Suprasūtā annotations file/)
  })

  it('keeps hostile content inert: notes become attribute text, odd kinds become highlights', () => {
    const hostile = JSON.stringify({
      format: 'suprasuta-annotations',
      version: 1,
      document: 'x',
      exportedAt: '2026-10-01',
      textLength: DOC.length,
      annotations: [{ id: '"><script>x</script>', type: 'script', exact: 'led by the north', note: '"><img src=x onerror=alert(1)>', prefix: '', suffix: '', position: 0 }]
    })
    const r = importAnnotations(DOC, parseAnnotationsFile(hostile))
    expect(r.placed).toBe(1)
    expect(r.source).not.toContain('<script')
    expect(r.source).not.toContain('<img')
    expect(r.source).toContain('data-mn-type="highlight"')
  })
})
