import { describe, it, expect } from 'vitest'
import {
  chunkDocument,
  buildContext,
  rankChunks,
  extractCitations,
  estimateTokens,
  formatContext
} from '../src/renderer/src/lib/retrieval'
import { parseAnnotations, parseRevision, findQuoteRange, systemPrompt, REFUSAL } from '../src/renderer/src/lib/aiPrompts'
import { diffLines, diffStats, collapseUnchanged } from '../src/renderer/src/lib/diff'
import { EMPTY_HISTORY, record, undo, redo, canUndo, canRedo } from '../src/renderer/src/lib/history'

const DOC = `# Annual Report

## Revenue

Revenue grew fourteen percent across every region this year.

## Staffing

Headcount stayed flat at 240 people.

## Risks

Supply chain delays remain the largest open risk.
`

describe('chunkDocument', () => {
  it('splits on headings and keeps source offsets', () => {
    const chunks = chunkDocument({ id: 'd', name: 'report.md', content: DOC })
    expect(chunks.length).toBeGreaterThanOrEqual(3)
    const revenue = chunks.find((c) => c.heading === 'Revenue')!
    expect(revenue.text).toContain('fourteen percent')
    expect(DOC.slice(revenue.start, revenue.end)).toContain('fourteen percent')
  })

  it('strips annotation markup so the model reads prose', () => {
    const annotated = 'Text with <mark class="mn-a" data-mn-id="a1">a highlight</mark> inside.\n'
    const chunks = chunkDocument({ id: 'd', name: 'n.md', content: annotated })
    expect(chunks[0].text).toBe('Text with a highlight inside.')
  })
})

describe('rankChunks', () => {
  it('puts the relevant passage first', () => {
    const chunks = chunkDocument({ id: 'd', name: 'report.md', content: DOC })
    const ranked = rankChunks(chunks, 'how many people do we employ')
    expect(ranked[0].chunk.heading).toBe('Staffing')
  })

  it('scores zero when nothing matches', () => {
    const chunks = chunkDocument({ id: 'd', name: 'report.md', content: DOC })
    const ranked = rankChunks(chunks, 'zzzz qqqq')
    expect(ranked.every((r) => r.score === 0)).toBe(true)
  })
})

describe('buildContext', () => {
  it('sends everything when the documents are small', () => {
    const ctx = buildContext([{ id: 'd', name: 'r.md', content: DOC }], 'revenue')
    expect(ctx.truncated).toBe(false)
    expect(ctx.chunks.every((c, i) => c.ref === i + 1)).toBe(true)
  })

  it('trims to the budget on large documents and keeps the relevant part', () => {
    const filler = Array.from({ length: 400 }, (_, i) => `## Section ${i}\n\nUnrelated filler text number ${i}.\n`).join('\n')
    const big = DOC + '\n' + filler
    const ctx = buildContext([{ id: 'd', name: 'big.md', content: big }], 'supply chain risk', 1000)
    expect(ctx.truncated).toBe(true)
    expect(ctx.chunks.length).toBeLessThan(ctx.totalChunks)
    expect(ctx.chunks.some((c) => c.text.includes('Supply chain'))).toBe(true)
  })

  it('keeps chunks from several documents apart', () => {
    const ctx = buildContext(
      [
        { id: 'a', name: 'a.md', content: '# A\n\nAlpha content here.\n' },
        { id: 'b', name: 'b.md', content: '# B\n\nBravo content here.\n' }
      ],
      'content'
    )
    expect(new Set(ctx.chunks.map((c) => c.docId)).size).toBe(2)
  })
})

describe('formatContext + citations', () => {
  it('numbers passages and parses citations back out', () => {
    const ctx = buildContext([{ id: 'd', name: 'r.md', content: DOC }], 'revenue')
    expect(formatContext(ctx.chunks)).toMatch(/^\[1\] \(r\.md › /)
    expect(extractCitations('Revenue rose [2]. Staff flat [3, 4].')).toEqual([2, 3, 4])
    expect(extractCitations('No citations here.')).toEqual([])
  })
})

describe('estimateTokens', () => {
  it('scales with length', () => {
    expect(estimateTokens('a'.repeat(370))).toBeGreaterThan(90)
  })
})

describe('systemPrompt', () => {
  it('always states the grounding rule and embeds the context', () => {
    const ctx = buildContext([{ id: 'd', name: 'r.md', content: DOC }], 'revenue')
    const prompt = systemPrompt('ask', ctx.chunks, false)
    expect(prompt).toContain(REFUSAL)
    expect(prompt).toContain('=== CONTEXT ===')
    expect(prompt).toContain('fourteen percent')
  })

  it('puts the refusal sentence alone on its line so models do not run it on', () => {
    const ctx = buildContext([{ id: 'd', name: 'r.md', content: DOC }], 'revenue')
    const line = systemPrompt('ask', ctx.chunks, false)
      .split('\n')
      .find((l) => l.includes(REFUSAL))
    expect(line?.trim()).toBe(REFUSAL)
  })

  it('warns the model when context was truncated', () => {
    const ctx = buildContext([{ id: 'd', name: 'r.md', content: DOC }], 'revenue')
    expect(systemPrompt('ask', ctx.chunks, true)).toContain('too large to include in full')
  })
})

describe('parseAnnotations', () => {
  it('reads a fenced JSON block', () => {
    const reply = 'Here you go:\n```json\n{"annotations":[{"quote":"Revenue grew","type":"highlight","color":"green","note":"key metric"}]}\n```'
    const parsed = parseAnnotations(reply)
    expect(parsed.ok).toBe(true)
    expect(parsed.annotations[0]).toMatchObject({ quote: 'Revenue grew', type: 'highlight', color: 'green' })
  })

  it('falls back to a bare JSON object', () => {
    expect(parseAnnotations('{"annotations":[{"quote":"abcd","type":"underline"}]}').ok).toBe(true)
  })

  it('rejects an unusable reply', () => {
    expect(parseAnnotations('I could not find anything.').ok).toBe(false)
    expect(parseAnnotations('```json\n{"annotations":[]}\n```').ok).toBe(false)
  })

  it('defaults an unknown type to highlight', () => {
    const parsed = parseAnnotations('{"annotations":[{"quote":"abcd","type":"sparkle"}]}')
    expect(parsed.annotations[0].type).toBe('highlight')
  })
})

describe('parseRevision', () => {
  it('extracts a fenced markdown document', () => {
    const parsed = parseRevision('```markdown\n# Title\n\nRevised body text goes here.\n```')
    expect(parsed.ok).toBe(true)
    expect(parsed.document).toContain('Revised body text')
  })

  it('rejects prose without a document', () => {
    expect(parseRevision('I would suggest changing the title.').ok).toBe(false)
  })
})

describe('findQuoteRange', () => {
  it('matches verbatim text', () => {
    const [s, e] = findQuoteRange(DOC, 'fourteen percent')!
    expect(DOC.slice(s, e)).toBe('fourteen percent')
  })

  it('matches despite reflowed whitespace and case', () => {
    const range = findQuoteRange(DOC, 'Revenue   grew\n  FOURTEEN percent')
    expect(range).not.toBeNull()
    expect(DOC.slice(range![0], range![1]).replace(/\s+/g, ' ')).toBe('Revenue grew fourteen percent')
  })

  it('returns null when the quote was invented', () => {
    expect(findQuoteRange(DOC, 'profits tripled overnight')).toBeNull()
  })
})

describe('diffLines', () => {
  it('reports added and removed lines', () => {
    const rows = diffLines('one\ntwo\nthree', 'one\ntwo point five\nthree')
    const stats = diffStats(rows)
    expect(stats.added).toBe(1)
    expect(stats.removed).toBe(1)
    expect(rows.filter((r) => r.op === 'keep')).toHaveLength(2)
  })

  it('handles pure insertion', () => {
    expect(diffStats(diffLines('a\nb', 'a\nnew\nb'))).toEqual({ added: 1, removed: 0 })
  })

  it('reports nothing for identical input', () => {
    expect(diffStats(diffLines('same\ntext', 'same\ntext'))).toEqual({ added: 0, removed: 0 })
  })

  it('collapses long unchanged runs', () => {
    const before = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n')
    const after = before.replace('line 30', 'line thirty')
    const collapsed = collapseUnchanged(diffLines(before, after))
    expect(collapsed.some((r) => r.op === 'gap')).toBe(true)
    expect(collapsed.length).toBeLessThan(30)
  })
})

describe('history', () => {
  it('undoes and redoes document states', () => {
    let h = EMPTY_HISTORY
    expect(canUndo(h)).toBe(false)

    h = record(h, 'v1', 'Add highlight')
    expect(canUndo(h)).toBe(true)

    const undone = undo(h, 'v2')!
    expect(undone.content).toBe('v1')
    expect(undone.label).toBe('Add highlight')
    expect(canRedo(undone.state)).toBe(true)

    const redone = redo(undone.state, 'v1')!
    expect(redone.content).toBe('v2')
  })

  it('drops the redo branch after a new change', () => {
    let h = record(EMPTY_HISTORY, 'v1', 'first')
    const undone = undo(h, 'v2')!
    h = record(undone.state, 'v1', 'second')
    expect(canRedo(h)).toBe(false)
  })

  it('returns null when there is nothing to undo', () => {
    expect(undo(EMPTY_HISTORY, 'v1')).toBeNull()
    expect(redo(EMPTY_HISTORY, 'v1')).toBeNull()
  })
})
