import { describe, it, expect } from 'vitest'
import { mergeDocuments, demoteHeadings } from '../src/renderer/src/lib/merge'

describe('mergeDocuments — each file a section', () => {
  it('keeps a document that already has its own title, and titles one that has none', () => {
    const out = mergeDocuments(
      [
        { name: 'Report.pdf', markdown: '# Annual Report\n\n## Revenue\n\nUp 14%.' },
        { name: 'meeting_notes.md', markdown: '## Agenda\n\n- budget\n\n### Detail\n\ntext' }
      ],
      'sections'
    )
    expect(out).toContain('# Annual Report\n\n## Revenue')
    // No title of its own: the file name becomes the title. Its headings
    // already start at level two, so they stay put rather than skip a level.
    expect(out).toContain('# meeting notes\n\n## Agenda')
    expect(out).toContain('### Detail')
    expect(out.match(/^# /gm)).toHaveLength(2)
  })

  it('keeps an opening title and moves later top-level headings beneath it', () => {
    // The shape a converted Word file has: a Title paragraph and Heading 1
    // sections, all at level one. Found in testing, where the file name was
    // stacked on top of the document's real title.
    const out = mergeDocuments(
      [{ name: 'Quarterly review.docx', markdown: '# Quarterly Review\n\n# Revenue\n\nUp.\n\n## Detail\n\n# Risks' }],
      'sections'
    )
    expect(out).toBe('# Quarterly Review\n\n## Revenue\n\nUp.\n\n### Detail\n\n## Risks\n')
  })

  it('titles a document that starts with something other than a heading', () => {
    const out = mergeDocuments([{ name: 'two.md', markdown: 'Intro.\n\n# One\n\n# Two' }], 'sections')
    expect(out).toBe('# two\n\nIntro.\n\n## One\n\n## Two\n')
  })

  it('never touches # lines inside code blocks', () => {
    const src = '## Setup\n\n```bash\n# install it\nnpm i\n```\n'
    expect(demoteHeadings(src)).toBe('### Setup\n\n```bash\n# install it\nnpm i\n```\n')
  })

  it('demotes underlined (setext) headings too', () => {
    expect(demoteHeadings('Title\n=====\n\nSub\n---\n\nbody')).toBe('## Title\n\n### Sub\n\nbody')
  })

  it('leaves level-6 headings at level 6', () => {
    expect(demoteHeadings('###### Deepest')).toBe('###### Deepest')
  })
})

describe('mergeDocuments — joined unchanged', () => {
  it('places documents one after another with a rule, text untouched', () => {
    const a = '# A\n\n## Part\n\nalpha'
    const b = 'Plain text\nsecond line'
    expect(mergeDocuments([{ name: 'a.md', markdown: a }, { name: 'b.md', markdown: b }], 'concat')).toBe(
      `${a}\n\n---\n\n${b}\n`
    )
  })
})

describe('mergeDocuments — identifiers that must stay unique', () => {
  const annotated = 'Some <mark class="mn-a mn-highlight" data-mn-id="a1" data-mn-type="highlight">key</mark> text.'

  it('gives a repeated annotation id a fresh one, leaving the first alone', () => {
    const out = mergeDocuments([{ name: 'x.md', markdown: annotated }, { name: 'copy.md', markdown: annotated }], 'concat')
    const ids = [...out.matchAll(/data-mn-id="([^"]+)"/g)].map((m) => m[1])
    expect(ids).toHaveLength(2)
    expect(ids[0]).toBe('a1')
    expect(ids[1]).not.toBe('a1')
  })

  it('renames a repeated footnote label so each reference finds its own note', () => {
    const doc = (n: string): string => `Claim[^1].\n\n[^1]: Source ${n}.`
    const out = mergeDocuments([{ name: 'a.md', markdown: doc('A') }, { name: 'b.md', markdown: doc('B') }], 'concat')
    expect(out).toContain('Claim[^1].\n\n[^1]: Source A.')
    expect(out).toContain('Claim[^1-2].\n\n[^1-2]: Source B.')
  })
})
