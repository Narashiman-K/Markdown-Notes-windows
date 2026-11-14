import { describe, it, expect } from 'vitest'
import {
  buildTree,
  offlineCard,
  offlineSummary,
  plainText,
  toMermaidMindmap,
  countNodes,
  applyState,
  readState,
  findNode,
  paragraphsOf,
  EMPTY_STATE
} from '../src/renderer/src/lib/mindmap'

const DOC = `# Garden Guide

Growing food at home is simple and rewarding.

## Soil

Good soil holds water and feeds roots. Compost improves soil structure. Test the soil pH every spring, because most vegetables prefer slightly acidic soil.

Earthworms are a sign of healthy soil, and they keep it loose so that roots can breathe and water can drain away.

### Compost

Mix green and brown waste.

## Water

\`\`\`
# not a heading
\`\`\`

Water early in the morning.

| a | b |
|---|---|
| 1 | 2 |

— 3 —
`

describe('mind map tree', () => {
  it('builds the heading tree, with the single title as the root', () => {
    const t = buildTree(DOC, 'garden.md', false)
    expect(t.title).toBe('Garden Guide')
    expect(t.children.map((c) => c.title)).toEqual(['Soil', 'Water'])
    expect(t.children[0].children[0].title).toBe('Compost')
    expect(t.children[0].id).toBe('s:soil')
    expect(countNodes(t)).toBe(4)
  })

  it('knows where each passage ends', () => {
    const t = buildTree(DOC, 'garden.md', false)
    const soil = t.children[0]
    const water = t.children[1]
    expect(soil.end).toBe(water.line)
    expect(DOC.split('\n').slice(soil.line, soil.end).join('\n')).toContain('Mix green and brown waste.')
  })

  it('adds one point card per paragraph, before the sub-topics', () => {
    const t = buildTree(DOC, 'garden.md')
    const soil = t.children[0]
    expect(soil.children.map((c) => c.kind)).toEqual(['point', 'point', 'heading'])
    expect(soil.children[0].id).toBe('s:soil#0')
    expect(soil.children[1].card.idea).toMatch(/Earthworms/)
  })

  it('uses the file name as the root when there are several top headings', () => {
    const t = buildTree('# A\n\ntext\n\n# B\n\nmore', 'notes.md', false)
    expect(t.title).toBe('notes')
    expect(t.children.map((c) => c.title)).toEqual(['A', 'B'])
  })

  it('files the points of a flat book under their chapters', () => {
    const heads = ['Contents', 'Introduction', 'Why it works', 'Chapter 1: Basics', 'Senses', 'Signals', 'Chapter 2: Work', 'Meetings', 'Sales', 'Bosses', 'Conclusion', 'Last words']
    const t = buildTree(`# Book\n\n${heads.map((h) => `### ${h}\n\ntext`).join('\n\n')}`, 'b.md', false)
    expect(t.children.map((c) => c.title)).toEqual(['Contents', 'Introduction', 'Chapter 1: Basics', 'Chapter 2: Work', 'Conclusion'])
    expect(t.children[2].children.map((c) => c.title)).toEqual(['Senses', 'Signals'])
  })
})

describe('cards', () => {
  it('summarises offline without code, tables or page numbers', () => {
    expect(plainText('— 3 —\n| a |\n```\nx\n```\nHi **there**')).toBe('Hi there')
    const t = buildTree(DOC, 'garden.md', false)
    expect(t.children[1].card.summary).toBe('Water early in the morning.')
    expect(offlineSummary('One. Two. Three. Four.', 999, 2).split('. ').length).toBeLessThanOrEqual(2)
  })

  it('gives each card a key idea, keywords and a two-sentence summary', () => {
    const c = offlineCard(
      'Compost feeds the soil life. Kitchen scraps and dry leaves turn into compost within months. Turn the compost heap every week so air reaches the middle. A warm heap breaks down faster than a cold one.'
    )
    expect(c.idea.split(' ').length).toBeLessThanOrEqual(16)
    expect(c.keywords.length).toBeGreaterThanOrEqual(2)
    expect(c.keywords).toContain('compost')
    expect(c.summary.match(/[.!?](\s|$)/g)?.length ?? 0).toBeLessThanOrEqual(2)
  })

  it('splits paragraphs and drops short scraps', () => {
    expect(paragraphsOf('Short.\n\nThis paragraph is long enough to count as a real paragraph of text here.').length).toBe(1)
  })
})

describe('the reader’s changes', () => {
  it('applies AI cards, edits, added and hidden cards', () => {
    const t = buildTree(DOC, 'garden.md')
    const state = {
      ...EMPTY_STATE,
      ai: { 's:water': { idea: 'Water in the morning', keywords: ['morning'], summary: 'Water early. Less evaporation.' } },
      edits: { 's:soil': { title: 'Healthy soil' } },
      custom: [{ id: 'c1', parent: 's:water', title: 'My note', idea: 'Use a can', keywords: [], summary: '' }],
      hidden: ['s:compost']
    }
    const m = applyState(t, state)
    expect(findNode(m, 's:water')!.card.idea).toBe('Water in the morning')
    expect(findNode(m, 's:soil')!.title).toBe('Healthy soil')
    expect(findNode(m, 'c1')!.kind).toBe('custom')
    expect(findNode(m, 's:compost')).toBeNull()
    // The original tree is untouched.
    expect(findNode(t, 's:compost')).not.toBeNull()
  })

  it('reads a saved state safely', () => {
    expect(readState('not json')).toEqual(EMPTY_STATE)
    expect(readState('{"v":1,"hidden":["x",3]}').hidden).toEqual(['x'])
  })

  it('writes Mermaid', () => {
    const t = buildTree(DOC, 'garden.md', false)
    expect(toMermaidMindmap(t)).toBe('mindmap\n  root((Garden Guide))\n    Soil\n      Compost\n    Water')
  })
})
