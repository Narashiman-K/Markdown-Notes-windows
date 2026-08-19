import { describe, it, expect } from 'vitest'
import { convertAudio } from '../src/renderer/src/lib/convert/audio'

const bytes = new Uint8Array([1, 2, 3, 4])

describe('convertAudio', () => {
  it('refuses politely when no transcriber is supplied', async () => {
    const r = await convertAudio(bytes, 'interview.mp3')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('NO_TRANSCRIBER')
    // The message must make the cloud-only limitation explicit.
    expect(r.error).toMatch(/offline/i)
  })

  it('builds a transcript with a title', async () => {
    const r = await convertAudio(bytes, 'team-standup.mp3', {
      transcribe: async () => 'Good morning everyone. Lets begin the update.'
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.markdown).toMatch(/^# team standup — transcript/)
    expect(r.markdown).toContain('Good morning everyone')
    expect(r.meta?.engine).toBe('assemblyai')
  })

  it('breaks a long transcript into readable paragraphs', async () => {
    const sentences = Array.from({ length: 12 }, (_, i) => `This is sentence number ${i}.`).join(' ')
    const r = await convertAudio(bytes, 'long.mp3', { transcribe: async () => sentences })
    if (!r.ok) return
    // 12 sentences at 4 per paragraph => 3 paragraphs, plus the title.
    const paragraphs = r.markdown.split('\n\n').filter((p) => p.startsWith('This is'))
    expect(paragraphs.length).toBe(3)
  })

  it('includes the audio length when known', async () => {
    const r = await convertAudio(bytes, 'call.mp3', {
      transcribe: async () => 'Hello.',
      durationSeconds: 125
    })
    if (!r.ok) return
    expect(r.markdown).toContain('2 min 5 sec')
  })

  it('reports an empty transcript rather than writing a blank file', async () => {
    const r = await convertAudio(bytes, 'silence.mp3', { transcribe: async () => '   ' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('EMPTY')
  })

  it('surfaces a provider failure as a readable message', async () => {
    const r = await convertAudio(bytes, 'bad.mp3', {
      transcribe: async () => {
        throw new Error('That AssemblyAI key was rejected.')
      }
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('rejected')
  })
})
