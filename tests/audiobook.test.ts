import { describe, it, expect } from 'vitest'
import { alignCues, blocksOf, cueAt, parseSidecar, timeBlocks } from '../src/renderer/src/lib/speech/audiobook'
import type { ReadSentence } from '../src/renderer/src/lib/speech/readAloud'

/** Sentences as read aloud would collect them: blocks of one or more sentences. */
function doc(blocks: string[][]): ReadSentence[] {
  const out: ReadSentence[] = []
  for (const b of blocks)
    b.forEach((text, i) =>
      out.push({ text, spoken: text, spokenOffset: 0, kind: 'para', blockStart: i === 0, blockEnd: i === b.length - 1, annotated: false, segs: [] } as unknown as ReadSentence)
    )
  return out
}

const PAGE = doc([
  ['Chapter 1: Ugh, Small Talk'],
  ['Small talk is the doorway to friendship.', 'Most people hate it.'],
  // The page splits what the audiobook reads as one paragraph.
  ['The trick is curiosity.'],
  ['Ask one more question than feels natural.'],
  ['Chapter 2: First Impressions'],
  ['People decide in seconds.']
])

const NEW = {
  chapters: [],
  timeline: { 'c01-p000': [1, 3], 'c01-p001': [3.5, 9], 'c01-p002': [9.5, 14], 'c02-p000': [15, 17], 'c02-p001': [17.5, 20] },
  sentences: { 'c01-p001': [[3.5, 6.5], [6.6, 9]], 'c01-p002': [[9.5, 11], [11.2, 14]] },
  texts: {
    'c01-p000': 'Chapter 1: Ugh, Small Talk',
    'c01-p001': 'Small talk is the doorway to friendship. Most people',
    'c01-p002': 'The trick is curiosity. Ask one more question than',
    'c02-p000': 'Chapter 2: First Impressions',
    'c02-p001': 'People decide in seconds.'
  }
}

describe('audiobook timing', () => {
  it('matches paragraphs by their opening words', () => {
    const cues = alignCues(parseSidecar(JSON.stringify(NEW))!, blocksOf(PAGE))
    expect(cues.map((c) => c.block)).toEqual([0, 1, 2, 4, 5])
  })

  it('times every sentence, using Book2Audio’s own sentence times across split paragraphs', () => {
    const t = timeBlocks(parseSidecar(JSON.stringify(NEW))!, blocksOf(PAGE), PAGE)
    expect(t.map((x) => x.block)).toEqual([0, 1, 2, 3, 4, 5])
    expect(t[1].sents).toEqual([
      [3.5, 6.5],
      [6.6, 9]
    ])
    // One audiobook paragraph, two page paragraphs: its two sentence times.
    expect(t[2].sents).toEqual([[9.5, 11]])
    expect(t[3].sents).toEqual([[11.2, 14]])
    expect(cueAt(t, 12)).toBe(3)
    expect(cueAt(t, 0.5)).toBe(-1)
  })

  it('spreads a chapter’s time over its text for older timing files', () => {
    const side = parseSidecar(
      JSON.stringify({
        chapters: [
          { index: 1, title: 'Chapter 1: Ugh, Small Talk', start: 0, end: 14.5 },
          { index: 2, title: 'Chapter 2: First Impressions', start: 14.5, end: 21 }
        ],
        timeline: { 'c01-p000': [1, 3], 'c01-p001': [3.5, 14], 'c02-p000': [15, 17], 'c02-p001': [17.5, 20] }
      })
    )!
    const t = timeBlocks(side, blocksOf(PAGE), PAGE)
    expect(t.map((x) => x.block)).toEqual([0, 1, 2, 3, 4, 5])
    expect(t[0].start).toBe(1)
    // Ends where the narrator's pause begins, just before the chapter's end.
    expect(t[3].end).toBeGreaterThan(13.3)
    expect(t[3].end).toBeLessThanOrEqual(14)
    expect(t[4].start).toBe(15)
    // In order, without overlaps.
    for (let i = 1; i < t.length; i++) expect(t[i].start).toBeGreaterThanOrEqual(t[i - 1].end - 1e-9)
  })

  it('is not fooled by a table of contents that repeats the chapter titles', () => {
    const page = doc([
      ['Table of Contents'],
      ['Chapter 1: Ugh, Small Talk'],
      ['Chapter 2: First Impressions'],
      ['Chapter 1: Ugh, Small Talk'],
      ['Humans are a social species.', 'Connection matters.'],
      ['Chapter 2: First Impressions'],
      ['People decide in seconds.']
    ])
    const side = parseSidecar(
      JSON.stringify({
        chapters: [],
        timeline: { 'c01-p000': [1, 8], 'c02-p000': [9, 14] },
        texts: { 'c01-p000': 'Chapter 1: Ugh, Small Talk Humans are a social species.', 'c02-p000': 'Chapter 2: First Impressions People decide in seconds.' }
      })
    )!
    const cues = alignCues(side, blocksOf(page))
    // The real chapter headings (blocks 3 and 5), not the contents lines (1 and 2).
    expect(cues.map((c) => c.block)).toEqual([3, 5])
  })

  it('rejects a file that is not a timing file', () => {
    expect(parseSidecar('{"hello":1}')).toBeNull()
    expect(parseSidecar('nope')).toBeNull()
  })
})
