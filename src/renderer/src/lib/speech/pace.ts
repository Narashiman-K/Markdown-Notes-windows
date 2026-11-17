/**
 * Reading pace in words per minute, measured while reading aloud.
 *
 * Each time a sentence starts, the words read so far and the time are noted;
 * the pace is the words between the oldest and newest note in the last
 * minute, over the time between them. So it reflects the real voice (or
 * audiobook narrator) at the chosen speed, pauses between sentences included.
 * Pausing, stopping or changing the speed starts the measurement again.
 */

export const countWords = (text: string): number => (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length

/** Typical narration pace at 1× (audiobooks are usually 150–160 words a minute). */
export const BASE_WPM = 155

export class Pace {
  private before: number[] = [0]
  private notes: Array<{ t: number; w: number }> = []

  /** The sentences being read, in order. */
  setSentences(texts: string[]): void {
    this.before = [0]
    for (const t of texts) this.before.push(this.before[this.before.length - 1] + countWords(t))
    this.notes = []
  }

  reset(): void {
    this.notes = []
  }

  /** Sentence i has just started. */
  at(i: number, now = Date.now()): void {
    const w = this.before[Math.max(0, Math.min(i, this.before.length - 1))]
    const last = this.notes[this.notes.length - 1]
    // A jump backwards (or a big jump forwards) is not reading: start again.
    if (last && (w < last.w || w - last.w > 400)) this.notes = []
    this.notes.push({ t: now, w })
    while (this.notes.length > 2 && now - this.notes[0].t > 60_000) this.notes.shift()
  }

  /** Measured words per minute, or null until there is enough to go on (8 seconds). */
  wpm(): number | null {
    if (this.notes.length < 2) return null
    const a = this.notes[0]
    const b = this.notes[this.notes.length - 1]
    const ms = b.t - a.t
    if (ms < 8000 || b.w <= a.w) return null
    return Math.round(((b.w - a.w) / ms) * 60_000)
  }
}
