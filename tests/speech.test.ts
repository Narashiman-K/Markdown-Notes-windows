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
describe('Indian-language engine', () => {
  it('chooses IndicConformer for Indian languages, Whisper otherwise', async () => {
    const { engineFor, DEFAULT_DICTATION: D } = await import('../src/renderer/src/lib/speech/dictation')
    expect(engineFor({ ...D, language: 'kn' })).toEqual({ kind: 'indic', language: 'kn', large: false })
    expect(engineFor({ ...D, language: 'kn', model: 'small' })).toEqual({ kind: 'indic', language: 'kn', large: true })
    // Translation of an Indian language is done by the AI afterwards, not by Whisper.
    expect(engineFor({ ...D, language: 'kn', translate: true }).kind).toBe('indic')
    expect(engineFor({ ...D, language: 'auto' }).kind).toBe('whisper')
    expect(engineFor({ ...D, language: 'fr' }).kind).toBe('whisper')
  })

  it('computes normalised 80-band log-mel features, 100 frames a second', async () => {
    const { logMel } = await import('../src/renderer/src/lib/speech/melFeatures')
    const audio = new Float32Array(16000)
    for (let i = 0; i < audio.length; i++) audio[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / 16000) + 0.01 * Math.sin(i)
    const { data, frames } = logMel(audio)
    expect(frames).toBe(101)
    expect(data.length).toBe(80 * frames)
    let mean = 0
    for (let t = 0; t < frames; t++) mean += data[10 * frames + t]
    expect(Math.abs(mean / frames)).toBeLessThan(1e-3)
    expect(data.every((v) => Number.isFinite(v))).toBe(true)
  })

  it('decodes CTC output: repeats merged, blanks dropped, word marks to spaces', async () => {
    const { ctcGreedy } = await import('../src/renderer/src/lib/speech/melFeatures')
    const vocab = ['▁नम', 'स्ते', '▁आज']
    const blank = 3
    const steps = [0, 0, blank, 1, 1, blank, 2, blank]
    const logits = new Float32Array(steps.length * 4).fill(-10)
    steps.forEach((id, t) => (logits[t * 4 + id] = 0))
    expect(ctcGreedy(logits, steps.length, 4, vocab, blank)).toBe('नमस्ते आज')
  })
})
describe('commands in Indian languages', () => {
  it('turns spoken Hindi, Kannada and Tamil punctuation into marks', () => {
    expect(toActions('आज बैठक है पूर्ण विराम नई पंक्ति कृपया आइए')).toEqual([{ kind: 'text', text: 'आज बैठक है.\nकृपया आइए' }])
    expect(toActions('ನಮಸ್ಕಾರ ಅಲ್ಪ ವಿರಾಮ ಹೇಗಿದ್ದೀರಿ ಪ್ರಶ್ನೆ ಚಿಹ್ನೆ')).toEqual([{ kind: 'text', text: 'ನಮಸ್ಕಾರ, ಹೇಗಿದ್ದೀರಿ?' }])
    expect(toActions('வணக்கம் முற்றுப்புள்ளி')).toEqual([{ kind: 'text', text: 'வணக்கம்.' }])
  })
})
