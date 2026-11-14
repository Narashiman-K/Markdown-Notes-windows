import { describe, it, expect } from 'vitest'
import { findProcesses, flowFromSteps, isDecision } from '../src/renderer/src/lib/flowchart'

const DOC = `# Guide

## Watering

How to water a pot plant:

1. Push a finger into the soil.
2. Is the soil dry?
3. Otherwise, wait a day and check again.
4. Pour water slowly until it drains.

Some text.

## Notes

1. Only two
2. items here
`

describe('flowcharts', () => {
  it('finds numbered steps with their lead-in line as title', () => {
    const p = findProcesses(DOC)
    expect(p.length).toBe(1)
    expect(p[0].title).toBe('How to water a pot plant')
    expect(p[0].steps[1]).toBe('Is the soil dry?')
  })

  it('makes a decision with Yes and No paths that join again', () => {
    const { nodes, edges } = flowFromSteps(findProcesses(DOC)[0].steps)
    expect(nodes.map((n) => n.kind)).toEqual(['start', 'step', 'decision', 'step', 'step', 'end'])
    expect(nodes.find((n) => n.id === 's2')!.col).toBe(1)
    expect(nodes.find((n) => n.id === 's2')!.text).toBe('Wait a day and check again.')
    expect(edges).toContainEqual({ from: 's1', to: 's2', label: 'No' })
    expect(edges).toContainEqual({ from: 's1', to: 's3', label: 'Yes' })
    expect(edges).toContainEqual({ from: 's2', to: 's3', label: undefined })
  })

  it('knows a decision', () => {
    expect(isDecision('If the light is red')).toBe(true)
    expect(isDecision('Open the lid.')).toBe(false)
  })
})
