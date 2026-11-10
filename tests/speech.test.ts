import { describe, it, expect } from 'vitest'
import { VadSegmenter } from '../src/renderer/src/lib/speech/vad'
import { cleanTranscript, toActions, joinText } from '../src/renderer/src/lib/speech/commands'

const SR = 16000
const tone = (ms: number, amp = 0.2): Float32Array => {
  const n = Math.round((SR * ms) / 1000)
  const a = new Float32Array(n)
  for (let i = 0; i < n; i++) a[i] = amp * Math.sin((2 * Math.PI * 220 * i) / SR)
  return a
}
const quiet = (ms: number): Float32Array => tone(ms, 0.0005)

describe('voice activity segmenter', () => {
  it('cuts two utterances at the pause between them, and ignores silence', () => {
    const got: Float32Array[] = []
    const vad = new VadSegmenter((a) => got.push(a))
    vad.push(quiet(1000))
    vad.push(tone(1200))
    vad.push(quiet(1000))
    vad.push(tone(800))
    vad.push(quiet(1000))
    vad.flush()
    expect(got).toHaveLength(2)
    expect(got[0].length / SR).toBeGreaterThan(1.1)
    expect(got[0].length / SR).toBeLessThan(1.9)
  })

  it('drops a click, and cuts a speaker who never pauses', () => {
    const got: Float32Array[] = []
    const vad = new VadSegmenter((a) => got.push(a), { maxMs: 5000 })
    vad.push(quiet(500))
    vad.push(tone(90))
    vad.push(quiet(1000))
    expect(got).toHaveLength(0)
    vad.push(tone(12000))
    vad.flush()
    expect(got.length).toBeGreaterThanOrEqual(2)
  })
})

describe('dictation commands', () => {
  it('drops what Whisper invents on silence', () => {
    expect(cleanTranscript(' Thank you. ')).toBe('')
    expect(cleanTranscript('[BLANK_AUDIO]')).toBe('')
    expect(cleanTranscript('Hello (music) there')).toBe('Hello there')
  })

  it('turns spoken punctuation and layout into text, whatever Whisper put around it', () => {
    expect(toActions('Dear team, comma, the meeting is on Monday. Full stop. New paragraph. Thanks.')).toEqual([
      { kind: 'text', text: 'Dear team, the meeting is on Monday.\n\nThanks.' }
    ])
    expect(toActions('Shopping list new line bullet point milk bullet point eggs')).toEqual([
      { kind: 'text', text: 'Shopping list\n\n- Milk\n- Eggs' }
    ])
    expect(toActions('Is it ready question mark')).toEqual([{ kind: 'text', text: 'Is it ready?' }])
    // Whisper's own full stop survives a layout command (a real transcript).
    expect(
      toActions(cleanTranscript(' The report shows revenue grew by 14%. New paragraph. Supply delays remain the largest risk. Question mark.'))
    ).toEqual([{ kind: 'text', text: 'The report shows revenue grew by 14%.\n\nSupply delays remain the largest risk?' }])
  })

  it('recognises undo and stop, and leaves commands alone when they are off', () => {
    expect(toActions('Undo that.')).toEqual([{ kind: 'undo' }])
    expect(toActions('Stop dictation.')).toEqual([{ kind: 'stop' }])
    expect(toActions('new line', false)).toEqual([{ kind: 'text', text: 'new line' }])
    // "period" stays a word.
    expect(toActions('A period of time.')).toEqual([{ kind: 'text', text: 'A period of time.' }])
  })

  it('joins each utterance to the text before it', () => {
    expect(joinText('', 'Hello there.')).toBe('Hello there.')
    expect(joinText('The plan is', 'Ready by Friday.')).toBe(' ready by Friday.')
    expect(joinText('Done.', 'Next step.')).toBe(' Next step.')
    expect(joinText('Done.\n', 'next step.')).toBe('Next step.')
    expect(joinText('As agreed', ', we start Monday.')).toBe(', we start Monday.')
    expect(joinText('Yes and', 'I agree.')).toBe(' I agree.')
    expect(joinText('हिंदी में', 'लिखना')).toBe(' लिखना')
  })
})
