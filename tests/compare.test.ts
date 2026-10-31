import { describe, it, expect } from 'vitest'
import { compareTexts, diffWords, myers, takeChange, replaceChangeSide, unifiedDiff, markdownReport, htmlReport } from '../src/renderer/src/lib/compare'

const L = '# Report\n\nRevenue rose 5% this year.\nShared line\nOnly on the left\nEnd\n'
const R = '# Report\n\nRevenue rose 7% this year!\nShared line\nEnd\nNew closing line\n'

/** Rebuilds one side from the blocks: proves nothing is lost or invented. */
function rebuild(text: string, other: string, side: 'left' | 'right'): string {
  const c = compareTexts(side === 'left' ? text : other, side === 'left' ? other : text)
  return c.blocks.flatMap((b) => (b.kind === 'same' ? b.lines : side === 'left' ? b.left : b.right)).join('\n')
}

describe('compare documents', () => {
  it('finds each changed block and the changed words inside it', () => {
    const c = compareTexts(L, R)
    expect(c.stats.changes).toBe(3)
    expect(c.changes[0].words).toEqual([
      { op: 'same', text: 'Revenue rose ' },
      { op: 'left', text: '5' },
      { op: 'right', text: '7' },
      { op: 'same', text: '% this year' },
      { op: 'left', text: '.' },
      { op: 'right', text: '!' }
    ])
    expect(c.changes[1]).toMatchObject({ left: ['Only on the left'], right: [] })
    expect(c.changes[2]).toMatchObject({ left: [], right: ['New closing line'] })
  })

  it('ignores nothing: spacing, case and formatting marks are changes', () => {
    expect(compareTexts('a  b', 'a b').stats.changes).toBe(1)
    expect(compareTexts('Revenue', 'revenue').stats.changes).toBe(1)
    expect(compareTexts('**bold**', 'bold').stats.changes).toBe(1)
    expect(compareTexts('same\n', 'same\r\n').stats.changes).toBe(0)
  })

  it('marks words in any script', () => {
    const parts = diffWords('ನಮಸ್ಕಾರ ಜಗತ್ತು', 'ನಮಸ್ಕಾರ ಲೋಕ')
    expect(parts).toEqual([
      { op: 'same', text: 'ನಮಸ್ಕಾರ ' },
      { op: 'left', text: 'ಜಗತ್ತು' },
      { op: 'right', text: 'ಲೋಕ' }
    ])
  })

  it('takes a change across in either direction', () => {
    const c = compareTexts(L, R)
    expect(takeChange(c, 0, 'left', L)).toBe(L.replace('5% this year.', '7% this year!'))
    expect(takeChange(c, 1, 'right', R)).toBe(R.replace('Shared line\n', 'Shared line\nOnly on the left\n'))
    expect(replaceChangeSide(c, 2, 'right', 'Edited closing', R)).toBe(R.replace('New closing line', 'Edited closing'))
  })

  it('never loses or invents a line (random documents)', () => {
    let seed = 7
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    const doc = (): string => Array.from({ length: 30 }, () => 'abcde'[Math.floor(rnd() * 5)]).join('\n')
    for (let i = 0; i < 200; i++) {
      const a = doc()
      const b = doc()
      expect(rebuild(a, b, 'left')).toBe(a)
      expect(rebuild(b, a, 'left')).toBe(b)
    }
  })

  it('finds the shortest set of edits', () => {
    const a = [...'ABCABBA']
    const b = [...'CBABAC']
    const runs = myers(a, b)!
    const kept = runs.filter((r) => r[0] === '=').reduce((n, r) => n + r[1], 0)
    expect(kept).toBe(4)
  })

  it('handles a large document quickly', () => {
    const big = Array.from({ length: 20000 }, (_, i) => `line ${i}`).join('\n')
    const t = performance.now()
    const c = compareTexts(big, big.replace('line 500\n', 'changed\n').replace('line 15000\n', ''))
    expect(c.stats.changes).toBe(2)
    expect(performance.now() - t).toBeLessThan(2000)
  })

  it('writes reports that escape the text', () => {
    const c = compareTexts('<b>x</b>\n', '<script>y</script>\n')
    const names = { left: 'a.md', right: 'b.md' }
    expect(unifiedDiff(c, names)).toContain('- <b>x</b>')
    expect(markdownReport(c, names)).toContain('**1 change.**')
    const html = htmlReport(c, names)
    expect(html).not.toContain('<script>y')
    expect(html).toContain('&lt;<span class="ins">script</span>&gt;')
  })
})
