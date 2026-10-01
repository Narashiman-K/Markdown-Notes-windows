import { describe, it, expect } from 'vitest'
import { mergeDocuments, demoteHeadings, isMerged } from '../src/renderer/src/lib/merge'

/** What a reader sees: the invisible part notes removed. */
const visible = (md: string): string =>
  md
    .split('\n')
    .filter((l) => !/^<!-- suprasuta:(merged|part)\b.*-->$/.test(l.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

const h1s = (md: string): string[] => md.match(/^# .*/gm) ?? []

describe('mergeDocuments — each file a section', () => {
  it('keeps a document that already has its own title, and titles one that has none', () => {
    const out = mergeDocuments(
      [
        { name: 'Report.pdf', markdown: '# Annual Report\n\n## Revenue\n\nUp 14%.' },
        { name: 'meeting_notes.md', markdown: '## Agenda\n\n- budget\n\n### Detail\n\ntext' }
      ],
      'sections'
    )
    expect(visible(out)).toContain('# Annual Report\n\n## Revenue')
    // No title of its own: the file name becomes the title. Its headings
    // already start at level two, so they stay put rather than skip a level.
    expect(visible(out)).toContain('# meeting notes\n\n## Agenda')
    expect(visible(out)).toContain('### Detail')
    expect(h1s(out)).toHaveLength(2)
  })

  it('keeps an opening title and moves later top-level headings beneath it', () => {
    // A converted Word file: a Title and Heading 1 sections, all at level one.
    const out = mergeDocuments(
      [{ name: 'Quarterly review.docx', markdown: '# Quarterly Review\n\n# Revenue\n\nUp.\n\n## Detail\n\n# Risks' }],
      'sections'
    )
    expect(visible(out)).toBe('# Quarterly Review\n\n## Revenue\n\nUp.\n\n### Detail\n\n## Risks')
  })

  it('titles a document that starts with something other than a heading', () => {
    const out = mergeDocuments([{ name: 'two.md', markdown: 'Intro.\n\n# One\n\n# Two' }], 'sections')
    expect(visible(out)).toBe('# two\n\nIntro.\n\n## One\n\n## Two')
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
    expect(visible(mergeDocuments([{ name: 'a.md', markdown: a }, { name: 'b.md', markdown: b }], 'concat'))).toBe(
      `${a}\n\n---\n\n${b}`
    )
  })
})

describe('mergeDocuments — merging a merged document again', () => {
  const A = { name: 'a.md', markdown: '# Alpha\n\nfirst' }
  const B = { name: 'notes.md', markdown: '## Agenda\n\n- budget' }
  const C = { name: 'c.md', markdown: 'Plain, no heading.' }

  it('sections, then sections again: every file stays a top-level section', () => {
    const first = mergeDocuments([A, B], 'sections')
    const again = mergeDocuments([{ name: 'merged.md', markdown: first }, C], 'sections')
    expect(h1s(again)).toEqual(['# Alpha', '# notes', '# c'])
    expect(again.match(/suprasuta:merged/g)).toHaveLength(1)
  })

  it('unchanged, then sections: the earlier files become sections too (the reported bug)', () => {
    const first = mergeDocuments([A, B], 'concat')
    const again = mergeDocuments([{ name: 'merged.md', markdown: first }, C], 'sections')
    expect(h1s(again)).toEqual(['# Alpha', '# notes', '# c'])
    expect(visible(again)).not.toMatch(/^---$/m)
  })

  it('sections, then unchanged: the original files come back exactly, joined by rules', () => {
    const first = mergeDocuments([A, B], 'sections')
    const again = mergeDocuments([{ name: 'merged.md', markdown: first }, C], 'concat')
    expect(visible(again)).toBe(`${A.markdown}\n\n---\n\n${B.markdown}\n\n---\n\n${C.markdown}`)
  })

  it('keeps a horizontal rule that belongs to a document joined unchanged', () => {
    const withRule = { name: 'r.md', markdown: 'above\n\n---\n\nbelow' }
    const first = mergeDocuments([withRule, A], 'concat')
    const again = mergeDocuments([{ name: 'merged.md', markdown: first }], 'concat')
    expect(visible(again)).toBe(`above\n\n---\n\nbelow\n\n---\n\n${A.markdown}`)
  })

  it('survives saving with Windows line endings and reopening', () => {
    const saved = mergeDocuments([A, B], 'sections').replace(/\n/g, '\r\n')
    expect(isMerged(saved)).toBe(true)
    expect(h1s(mergeDocuments([{ name: 'saved.md', markdown: saved }, C], 'sections'))).toEqual(['# Alpha', '# notes', '# c'])
  })

  it('does not remove a title the user has since changed', () => {
    const first = mergeDocuments([B], 'sections').replace('# notes', '# My meeting')
    const again = mergeDocuments([{ name: 'merged.md', markdown: first }], 'concat')
    expect(visible(again)).toContain('# My meeting')
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
