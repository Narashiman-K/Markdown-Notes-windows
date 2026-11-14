import { describe, it, expect } from 'vitest'
import { buildTree, offlineSummary, plainText, toMermaidMindmap, toMermaidFlowchart, countNodes } from '../src/renderer/src/lib/mindmap'

const DOC = `# Garden Guide

Growing food at home is simple and rewarding.

## Soil

Good soil holds water and feeds roots. Compost improves soil structure. Test the soil pH every spring, because most vegetables prefer slightly acidic soil. Earthworms are a sign of healthy soil.

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

describe('mind map', () => {
  it('builds the heading tree, with the single title as the root', () => {
    const t = buildTree(DOC, 'garden.md')
    expect(t.title).toBe('Garden Guide')
    expect(t.children.map((c) => c.title)).toEqual(['Soil', 'Water'])
    expect(t.children[0].children[0].title).toBe('Compost')
    expect(t.children[0].slug).toBe('soil')
    expect(countNodes(t)).toBe(4)
  })

  it('uses the file name as the root when there are several top headings', () => {
    const t = buildTree('# A\n\ntext\n\n# B\n\nmore', 'notes.md')
    expect(t.title).toBe('notes')
    expect(t.children.map((c) => c.title)).toEqual(['A', 'B'])
  })

  it('summarises offline without code, tables or page numbers', () => {
    const t = buildTree(DOC, 'garden.md')
    expect(t.children[1].summary).toBe('Water early in the morning.')
    expect(plainText('— 3 —\n| a |\n```\nx\n```\nHi **there**')).toBe('Hi there')
    const s = offlineSummary(t.children[0].body, 120)
    expect(s.length).toBeLessThanOrEqual(170)
    expect(s).toMatch(/soil/i)
  })

  it('files the points of a flat book under their chapters', () => {
    const heads = ['Contents', 'Introduction', 'Why it works', 'Chapter 1: Basics', 'Senses', 'Signals', 'Chapter 2: Work', 'Meetings', 'Sales', 'Bosses', 'Conclusion', 'Last words']
    const t = buildTree(`# Book\n\n${heads.map((h) => `### ${h}\n\ntext`).join('\n\n')}`, 'b.md')
    expect(t.children.map((c) => c.title)).toEqual(['Contents', 'Introduction', 'Chapter 1: Basics', 'Chapter 2: Work', 'Conclusion'])
    expect(t.children[2].children.map((c) => c.title)).toEqual(['Senses', 'Signals'])
    expect(t.children[4].children.map((c) => c.title)).toEqual(['Last words'])
  })

  it('writes Mermaid', () => {
    const t = buildTree(DOC, 'garden.md')
    expect(toMermaidMindmap(t)).toBe('mindmap\n  root((Garden Guide))\n    Soil\n      Compost\n    Water')
    expect(toMermaidFlowchart(t)).toContain('h0["Garden Guide"] --> h1["Soil"]')
  })
})
