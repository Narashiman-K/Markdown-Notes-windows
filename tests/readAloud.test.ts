// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { collectSentences, prosodyFor, sentimentOf, scriptLanguage, rangeOf, DEFAULT_READ, styleOf } from '../src/renderer/src/lib/speech/readAloud'

function doc(html: string): HTMLElement {
  const root = document.createElement('div')
  root.className = 'markdown-body'
  root.innerHTML = html
  document.body.appendChild(root)
  return root
}

describe('read aloud: what is read', () => {
  it('reads the rendered text sentence by sentence, with ranges over the page', () => {
    const root = doc('<h1>Report</h1><p>Revenue grew <strong>14 per cent</strong>. Costs fell.</p><ul><li>First point</li></ul>')
    const s = collectSentences(root, DEFAULT_READ)
    expect(s.map((x) => x.text)).toEqual(['Report', 'Revenue grew 14 per cent.', 'Costs fell.', 'First point'])
    expect(s[1].kind).toBe('para')
    expect(s[1].blockEnd).toBe(false)
    expect(s[2].blockEnd).toBe(true)
    expect(rangeOf(s[1])?.toString()).toBe('Revenue grew 14 per cent.')
    // A word inside the bold part, as the voice reports it.
    expect(rangeOf(s[1], 13, 15)?.toString()).toBe('14')
  })

  it('summarises code, reads tables row by row, and skips what is asked', () => {
    const root = doc('<pre><code>a = 1\nb = 2\n</code></pre><table><tr><th>Item</th><th>Cost</th></tr><tr><td>Tea</td><td>5</td></tr></table>')
    const s = collectSentences(root, DEFAULT_READ)
    expect(s.map((x) => x.spoken)).toEqual(['Code block, 2 lines.', 'Table with columns: Item, Cost.', 'Tea, 5.'])
    expect(collectSentences(root, { ...DEFAULT_READ, skipCode: true, skipTables: true })).toHaveLength(0)
    const tech = collectSentences(root, { ...DEFAULT_READ, style: 'technical' })
    expect(tech[2].spoken).toBe('Item: Tea, Cost: 5.')
  })

  it('announces headings in the technical style, and skims', () => {
    const root = doc('<h2>Risks</h2><p>One. Two. Three.</p><p>Four. Five.</p>')
    expect(collectSentences(root, { ...DEFAULT_READ, style: 'technical' })[0].spoken).toBe('Section: Risks.')
    expect(collectSentences(root, { ...DEFAULT_READ, style: 'skim' }).map((x) => x.text)).toEqual(['Risks', 'One.', 'Four.'])
  })

  it('reads only highlights when asked, and leaves app furniture out', () => {
    const root = doc('<p>Plain.</p><p>A <mark data-mn-id="x">marked</mark> line.</p><div data-mn-ignore><p>Toolbar</p></div>')
    expect(collectSentences(root, { ...DEFAULT_READ, highlightsOnly: true }).map((x) => x.text)).toEqual(['A marked line.'])
    expect(collectSentences(root, DEFAULT_READ).map((x) => x.text)).not.toContain('Toolbar')
  })
})

describe('read aloud: how it is read', () => {
  const sent = (text: string, blockEnd = false) => ({ text, spoken: text, spokenOffset: 0, kind: 'para' as const, blockEnd, blockStart: true, annotated: false, segs: [] })

  it('styles change speed, pitch and pauses; emotion shifts them together', () => {
    const calm = prosodyFor(sent('Hello.'), { ...DEFAULT_READ, style: 'calm' })
    const kids = prosodyFor(sent('Hello.'), { ...DEFAULT_READ, style: 'kids' })
    expect(calm.rate).toBeLessThan(kids.rate)
    expect(kids.pitch).toBeGreaterThan(calm.pitch)
    const energetic = prosodyFor(sent('Hello.', true), { ...DEFAULT_READ, emotion: 1 })
    const relaxed = prosodyFor(sent('Hello.', true), { ...DEFAULT_READ, emotion: -1 })
    expect(energetic.rate).toBeGreaterThan(relaxed.rate)
    expect(energetic.pauseAfter).toBeLessThan(relaxed.pauseAfter)
    expect(relaxed.pauseAfter).toBeGreaterThan(styleOf('natural').pauseBlock)
  })

  it('follows sentiment and punctuation when asked, within what voices accept', () => {
    expect(sentimentOf('A wonderful success, we are so happy')).toBeGreaterThan(0)
    expect(sentimentOf('Sadly the project failed and we lost money')).toBeLessThan(0)
    const up = prosodyFor(sent('A wonderful success!'), { ...DEFAULT_READ, sentiment: true })
    const down = prosodyFor(sent('It failed badly, a terrible loss.'), { ...DEFAULT_READ, sentiment: true })
    expect(up.pitch).toBeGreaterThan(down.pitch)
    const extreme = prosodyFor(sent('x'), { ...DEFAULT_READ, rate: 9, pitch: 9 })
    expect(extreme.rate).toBeLessThanOrEqual(3)
    expect(extreme.pitch).toBeLessThanOrEqual(2)
  })

  it('knows which language a script is, for switching voice', () => {
    expect(scriptLanguage('नमस्ते')).toBe('hi')
    expect(scriptLanguage('வணக்கம்')).toBe('ta')
    expect(scriptLanguage('ನಮಸ್ಕಾರ')).toBe('kn')
    expect(scriptLanguage('Hello')).toBeNull()
  })
})
