/**
 * From what Whisper heard to what goes into the document.
 *
 *   - drops what Whisper invents on near-silence ("Thank you.", "[BLANK_AUDIO]",
 *     "(music)") and other bracketed sound tags;
 *   - turns spoken commands into punctuation and layout: "new line",
 *     "new paragraph", "full stop", "comma", "question mark", "bullet point",
 *     "heading" …, and recognises "undo that" and "stop dictation";
 *   - joins each piece to the text before the cursor with the right space and
 *     capital letter, since Whisper starts every utterance as a new sentence.
 *
 * "Period" is deliberately not a command: "a period of time" is far more
 * common in dictated prose than the punctuation mark.
 *
 * Kept identical across the Windows app and the web app.
 */

export type DictationAction = { kind: 'text'; text: string } | { kind: 'undo' } | { kind: 'stop' }

/** Phrases Whisper is known to produce from silence or noise. */
const HALLUCINATIONS = [
  /^\s*(thank you|thanks|thank you for watching|thanks for watching|you|bye|okay|so)[.!]?\s*$/i,
  /^\s*please subscribe.*$/i,
  /^\s*(subtitles|captions) (by|from).*$/i
]

export function cleanTranscript(raw: string): string {
  let text = raw
    // [BLANK_AUDIO], [Music], (laughs), *coughs*
    .replace(/\[[^\]]*\]|\([^)]*(music|laugh|applause|silence|noise|cough|inaudible)[^)]*\)|\*[^*]*\*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (HALLUCINATIONS.some((re) => re.test(text))) text = ''
  return text
}

/** Spoken command → what it inserts. Order matters: longer phrases first. */
const COMMANDS: Array<[RegExp, string]> = [
  [/new paragraph/, '\n\n'],
  [/(new|next) line/, '\n'],
  [/bullet( point)?/, '\n- '],
  [/(numbered|number) (point|item)/, '\n1. '],
  [/heading( two)?/, '\n## '],
  [/full stop/, '.'],
  [/question mark/, '?'],
  [/exclamation (mark|point)/, '!'],
  [/semi ?colon/, ';'],
  [/colon/, ':'],
  [/comma/, ','],
  [/(open|left) (bracket|parenthesis)/, ' ('],
  [/(close|right) (bracket|parenthesis)/, ')'],
  [/(open|start) quote/, ' “'],
  [/(close|end) quote/, '”'],
  [/hyphen|dash/, ' – ']
]

const UNDO = /^(undo that|delete that|scratch that)$/i
const STOP = /^(stop dictation|stop listening)$/i

/**
 * Splits a cleaned transcript into actions. A command is recognised with the
 * punctuation Whisper tends to put around it ("Hello, comma, world.").
 */
export function toActions(text: string, commands = true): DictationAction[] {
  const bare = text.replace(/[.,!?;:]+$/, '').trim()
  if (commands && UNDO.test(bare)) return [{ kind: 'undo' }]
  if (commands && STOP.test(bare)) return [{ kind: 'stop' }]
  if (!commands) return text ? [{ kind: 'text', text }] : []

  const alternatives = COMMANDS.map(([re]) => `(${re.source})`).join('|')
  const finder = new RegExp(`[\\s,.;:!?]*\\b(?:${alternatives})\\b[\\s,.;:!?]*`, 'gi')
  let out = ''
  let last = 0
  for (const m of text.matchAll(finder)) {
    const spoken = m[0].replace(/[\s,.;:!?]+/g, ' ').trim().toLowerCase()
    const hit = COMMANDS.find(([re]) => new RegExp(`^(?:${re.source})$`).test(spoken))
    if (!hit) continue
    // A sentence Whisper already ended stays ended when the command only
    // changes layout ("…grew by 14%. New paragraph."); before punctuation
    // commands, Whisper's own punctuation is the misheard command and goes.
    const ended = /^\n/.test(hit[1]) && /^[\s,;:]*[.!?]/.test(m[0]) ? m[0].match(/[.!?]/)![0] : ''
    out += text.slice(last, m.index) + ended + hit[1]
    last = m.index! + m[0].length
    // A word after inserted punctuation needs its space back.
    if (/[.,;:!?)”–]$/.test(hit[1]) && last < text.length) out += ' '
  }
  out += text.slice(last)
  out = out.replace(/ +\n/g, '\n').replace(/\n +/g, '\n').replace(/ {2,}/g, ' ')
  out = capitaliseSentences(out)
  return out.trim() || /\n/.test(out) ? [{ kind: 'text', text: out.replace(/^ +| +$/g, '') }] : []
}

function capitaliseSentences(s: string): string {
  return s.replace(/([.!?]\s+|\n(?:- |1\. |## )?)([a-zà-ÿ])/g, (_m, lead: string, ch: string) => lead + ch.toUpperCase())
}

/**
 * The text to insert after `before` (what precedes the cursor): a space when
 * the previous character is part of a word, and a lower-case start when the
 * previous text does not end a sentence. Whisper capitalises every utterance.
 */
export function joinText(before: string, text: string): string {
  if (!text) return text
  const prev = before.slice(-1)
  const startsSentence = before.trim() === '' || /[.!?]\s*$|\n\s*$|^#{1,6} $|[-*] $|\d+\. $/.test(before.slice(-8))
  let t = text
  if (!startsSentence && /^[A-Z][a-z]/.test(t) && !/^I\b/.test(t)) t = t[0].toLowerCase() + t.slice(1)
  if (startsSentence && /^[a-z]/.test(t)) t = t[0].toUpperCase() + t.slice(1)
  const needsSpace = prev !== '' && !/\s/.test(prev) && !/^[\s.,;:!?)”\n]/.test(t)
  return needsSpace ? ` ${t}` : t
}

/** Whisper language codes offered in the picker, in display order. */
export const DICTATION_LANGUAGES: Array<[string, string]> = [
  ['auto', 'Detect automatically'],
  ['en', 'English'],
  ['hi', 'Hindi'],
  ['kn', 'Kannada'],
  ['ta', 'Tamil'],
  ['te', 'Telugu'],
  ['ml', 'Malayalam'],
  ['mr', 'Marathi'],
  ['bn', 'Bengali'],
  ['gu', 'Gujarati'],
  ['pa', 'Punjabi'],
  ['ur', 'Urdu'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['pt', 'Portuguese'],
  ['it', 'Italian'],
  ['ar', 'Arabic'],
  ['ru', 'Russian'],
  ['zh', 'Chinese'],
  ['ja', 'Japanese'],
  ['ko', 'Korean']
]
