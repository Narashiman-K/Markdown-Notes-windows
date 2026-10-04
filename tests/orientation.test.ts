import { describe, it, expect } from 'vitest'
import { describeTurns } from '../src/renderer/src/lib/convert/orientation'

describe('describeTurns', () => {
  it('names pages turned the same way together', () => {
    expect(describeTurns([{ page: 1, turn: 180 }])).toBe('Page 1 was upside down')
    expect(describeTurns([{ page: 2, turn: 180 }, { page: 5, turn: 180 }])).toBe('Pages 2 and 5 were upside down')
  })
  it('keeps upside down and sideways apart', () => {
    expect(describeTurns([{ page: 1, turn: 180 }, { page: 2, turn: 90 }, { page: 3, turn: 270 }])).toBe(
      'Page 1 was upside down; Pages 2 and 3 were on their side'
    )
  })
})
