import { describe, it, expect } from 'vitest'
import { Pace, countWords } from '../src/renderer/src/lib/speech/pace'

describe('reading pace', () => {
  it('counts words', () => {
    expect(countWords('Small talk — isn’t it awful? 3 times.')).toBe(7)
  })
  it('measures words per minute from sentence starts', () => {
    const p = new Pace()
    p.setSentences(Array(20).fill('one two three four five six seven eight nine ten'))
    for (let i = 0; i < 6; i++) p.at(i, i * 4000) // 10 words every 4 s
    expect(p.wpm()).toBe(150)
  })
  it('waits for enough reading, and starts again after a jump back', () => {
    const p = new Pace()
    p.setSentences(Array(20).fill('a b c d e'))
    p.at(5, 0)
    p.at(6, 3000)
    expect(p.wpm()).toBeNull()
    p.at(2, 4000)
    p.at(3, 13000)
    expect(p.wpm()).toBe(33)
  })
})
