/**
 * Exporting annotations from a document, and putting them back.
 *
 * Annotations live inside the Markdown as tags around the words they mark.
 * Exported, each one becomes a record of what it is (type, colour, note,
 * author, date) and where it was: its exact words in the document without
 * annotations, the words just before and after them, and its position. That
 * is enough to find the same place again in another copy of the document,
 * including a clean export, or a version edited since:
 *
 *   1. the exact words, choosing between repeats by the words around them and
 *      the expected position;
 *   2. the same words with different spacing or line breaks;
 *   3. the closest similar passage near the expected position (the words were
 *      edited a little).
 *
 * Anything still not found is reported, never silently dropped. Annotations
 * already on the document stay, and an imported one identical to an existing
 * one (same kind, same words) is skipped.
 *
 * Kept identical to the copy in the Windows app. Change one, copy it across.
 */
import {
  TAG_NAMES,
  applyAnnotation,
  findMatchingClose,
  newId,
  removeAllAnnotations,
  removeAnnotation,
  unescapeAttr,
  type AnnotationInput
} from './annotations'

export const ANNOTATIONS_FORMAT = 'suprasuta-annotations'
type Kind = AnnotationInput['type']
const KINDS: readonly Kind[] = ['highlight', 'underline', 'strike', 'bold', 'italic', 'comment']
const CONTEXT = 40

export interface ExportedAnnotation {
  id: string
  type: Kind
  color?: string
  note?: string
  author?: string
  at?: string
  /** The marked words, as they read without annotations. */
  exact: string
  prefix: string
  suffix: string
  /** Where they start in the document without annotations. */
  position: number
  /** The heading of the section it is in, for the summary. */
  section?: string
}

export interface AnnotationsFile {
  format: typeof ANNOTATIONS_FORMAT
  version: 1
  document: string
  exportedAt: string
  /** Length of the document without annotations, to scale positions. */
  textLength: number
  annotations: ExportedAnnotation[]
}

/* ---------------------------------------------------------------- spans */

interface Span {
  id: string
  tag: string
  /** Raw source range from its first opening tag to its last closing tag. */
  rawStart: number
  rawEnd: number
  /** Every tag belonging to annotations: [start, end) in the raw source. */
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`${name}="([^"]*)"`, 'i').exec(tag)
  return m ? unescapeAttr(m[1]) : undefined
}

/** Each annotation's extent, and every annotation tag's position. */
function scan(source: string): { spans: Span[]; tags: Array<[number, number]> } {
  const re = new RegExp(`<(${TAG_NAMES.join('|')})\\b[^>]*data-mn-id="[^"]+"[^>]*>`, 'gi')
  const byId = new Map<string, Span>()
  const tags: Array<[number, number]> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) {
    const id = attr(m[0], 'data-mn-id')!
    const openEnd = m.index + m[0].length
    const close = findMatchingClose(source, m[1], openEnd)
    tags.push([m.index, openEnd])
    if (close) tags.push(close)
    const end = close ? close[1] : openEnd
    const span = byId.get(id)
    if (span) span.rawEnd = Math.max(span.rawEnd, end)
    else byId.set(id, { id, tag: m[0], rawStart: m.index, rawEnd: end })
  }
  return { spans: [...byId.values()], tags: tags.sort((a, b) => a[0] - b[0]) }
}

/** Position in the raw source -> position in the text without annotation tags. */
function toClean(tags: Array<[number, number]>, raw: number): number {
  let removed = 0
  for (const [s, e] of tags) {
    if (s >= raw) break
    removed += Math.min(e, raw) - s
  }
  return raw - removed
}

/**
 * Position in the text without annotation tags -> raw source. A start goes
 * after any tags at that point and an end before them, so a new annotation
 * over the same words as an existing one nests inside it instead of crossing
 * its tags.
 */
function toRaw(tags: Array<[number, number]>, clean: number, edge: 'start' | 'end'): number {
  let raw = clean
  for (const [s, e] of tags) {
    if (edge === 'start' ? s > raw : s >= raw) break
    raw += e - s
  }
  return raw
}

function sectionAt(clean: string, position: number): string | undefined {
  const before = clean.slice(0, position)
  const headings = [...before.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)]
  return headings.length ? headings[headings.length - 1][1].trim() : undefined
}

/* --------------------------------------------------------------- export */

export function exportAnnotations(source: string, documentName: string): AnnotationsFile {
  const clean = removeAllAnnotations(source)
  const { spans, tags } = scan(source)
  const annotations: ExportedAnnotation[] = spans.map((s) => {
    const start = toClean(tags, s.rawStart)
    const end = Math.max(start, toClean(tags, s.rawEnd))
    const type = attr(s.tag, 'data-mn-type') as Kind
    return {
      id: s.id,
      type: KINDS.includes(type) ? type : 'highlight',
      color: attr(s.tag, 'data-mn-color'),
      note: attr(s.tag, 'data-mn-note'),
      author: attr(s.tag, 'data-mn-author'),
      at: attr(s.tag, 'data-mn-at'),
      exact: clean.slice(start, end),
      prefix: clean.slice(Math.max(0, start - CONTEXT), start),
      suffix: clean.slice(end, end + CONTEXT),
      position: start,
      section: sectionAt(clean, start)
    }
  })
  return {
    format: ANNOTATIONS_FORMAT,
    version: 1,
    document: documentName,
    exportedAt: new Date().toISOString(),
    textLength: clean.length,
    annotations: annotations.sort((a, b) => a.position - b.position)
  }
}

/** A readable list: each passage with its comment, by section. */
export function annotationSummary(file: AnnotationsFile): string {
  const lines = [
    `# Annotations: ${file.document}`,
    '',
    `${file.annotations.length} annotation${file.annotations.length === 1 ? '' : 's'}, exported ${new Date(file.exportedAt).toLocaleString()}.`
  ]
  let section: string | undefined = '\u0000'
  let n = 0
  for (const a of file.annotations) {
    if (a.section !== section) {
      section = a.section
      lines.push('', `## ${section ?? 'Before the first heading'}`, '')
      n = 0
    }
    n++
    const quote = a.exact.replace(/\s+/g, ' ').trim()
    const shown = quote.length > 400 ? `${quote.slice(0, 400)}…` : quote
    const facts = [
      a.type === 'comment' ? 'Comment' : a.type[0].toUpperCase() + a.type.slice(1),
      a.color,
      a.author ? `by ${a.author}` : undefined,
      a.at ? new Date(a.at).toLocaleDateString() : undefined
    ].filter(Boolean)
    lines.push(`${n}. ${facts.join(' · ')}`, `   > ${shown || '(no text)'}`)
    if (a.note) lines.push(`   - **Note:** ${a.note.replace(/\s*\n\s*/g, ' ')}`)
    lines.push('')
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

/* --------------------------------------------------------------- import */

/** Reads an annotations file, rejecting anything that is not one. */
export function parseAnnotationsFile(text: string): AnnotationsFile {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('This is not an annotations file: it is not valid JSON.')
  }
  const f = data as Partial<AnnotationsFile>
  if (!f || f.format !== ANNOTATIONS_FORMAT || !Array.isArray(f.annotations)) {
    throw new Error('This is not a Suprasūtā annotations file.')
  }
  const str = (v: unknown, max: number): string | undefined =>
    typeof v === 'string' && v.length ? v.slice(0, max) : undefined
  const annotations: ExportedAnnotation[] = []
  for (const raw of f.annotations.slice(0, 5000)) {
    const a = raw as Partial<ExportedAnnotation>
    const exact = typeof a.exact === 'string' ? a.exact.slice(0, 20000) : ''
    if (!exact.trim()) continue
    annotations.push({
      id: str(a.id, 64)?.replace(/[^\w-]/g, '') || newId(),
      type: KINDS.includes(a.type as Kind) ? (a.type as Kind) : 'highlight',
      color: str(a.color, 32),
      note: str(a.note, 10000),
      author: str(a.author, 200),
      at: str(a.at, 40),
      exact,
      prefix: typeof a.prefix === 'string' ? a.prefix.slice(-CONTEXT) : '',
      suffix: typeof a.suffix === 'string' ? a.suffix.slice(0, CONTEXT) : '',
      position: typeof a.position === 'number' && a.position >= 0 ? a.position : 0,
      section: str(a.section, 300)
    })
  }
  return {
    format: ANNOTATIONS_FORMAT,
    version: 1,
    document: str(f.document, 300) ?? 'document',
    exportedAt: str(f.exportedAt, 40) ?? new Date().toISOString(),
    textLength: typeof f.textLength === 'number' && f.textLength > 0 ? f.textLength : 1,
    annotations
  }
}

/** Bigram similarity, 0..1. */
function similarity(a: string, b: string): number {
  const grams = (s: string): Map<string, number> => {
    const m = new Map<string, number>()
    const t = s.toLowerCase().replace(/\s+/g, ' ')
    for (let i = 0; i < t.length - 1; i++) {
      const g = t.slice(i, i + 2)
      m.set(g, (m.get(g) ?? 0) + 1)
    }
    return m
  }
  const ga = grams(a)
  const gb = grams(b)
  let both = 0
  let total = 0
  for (const [g, n] of ga) {
    both += Math.min(n, gb.get(g) ?? 0)
    total += n
  }
  for (const n of gb.values()) total += n
  return total ? (2 * both) / total : a === b ? 1 : 0
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Where an exported annotation belongs in `clean`, or null. */
function locate(clean: string, a: ExportedAnnotation, expected: number): { start: number; end: number; how: 'exact' | 'spacing' | 'similar' } | null {
  const score = (start: number, end: number): number => {
    const before = clean.slice(Math.max(0, start - a.prefix.length), start)
    const after = clean.slice(end, end + a.suffix.length)
    const context = (a.prefix ? similarity(before, a.prefix) : 1) + (a.suffix ? similarity(after, a.suffix) : 1)
    const distance = Math.abs(start - expected) / Math.max(1, clean.length)
    return context - distance
  }

  // 1. The exact words; between repeats, the best context and position.
  const hits: number[] = []
  for (let i = clean.indexOf(a.exact); i !== -1 && hits.length < 500; i = clean.indexOf(a.exact, i + 1)) hits.push(i)
  if (hits.length) {
    const best = hits.reduce((x, y) => (score(y, y + a.exact.length) > score(x, x + a.exact.length) ? y : x))
    return { start: best, end: best + a.exact.length, how: 'exact' }
  }

  // 2. The same words, spacing and line breaks aside.
  const words = a.exact.trim().split(/\s+/).map(escapeRe)
  if (words.length && words.join('').length >= 3) {
    const re = new RegExp(words.join('\\s+'), 'g')
    const found: Array<[number, number]> = []
    let m: RegExpExecArray | null
    while ((m = re.exec(clean)) && found.length < 500) found.push([m.index, m.index + m[0].length])
    if (found.length) {
      const [s, e] = found.reduce((x, y) => (score(y[0], y[1]) > score(x[0], x[1]) ? y : x))
      return { start: s, end: e, how: 'spacing' }
    }
  }

  // 3. The closest similar passage near where it was: same length, starting
  //    at a word boundary, within a few thousand characters either side.
  const len = a.exact.length
  if (len < 4 || len > 5000) return null
  const from = Math.max(0, expected - 3000)
  const to = Math.min(clean.length - Math.floor(len * 0.6), expected + 3000)
  let best: { start: number; end: number; sim: number } | null = null
  for (let s = from; s <= to; s++) {
    if (s > 0 && !/\s/.test(clean[s - 1])) continue
    for (const l of [len, Math.round(len * 0.9), Math.round(len * 1.1)]) {
      const e = Math.min(clean.length, s + l)
      const sim = similarity(clean.slice(s, e), a.exact)
      if (!best || sim > best.sim) best = { start: s, end: e, sim }
    }
  }
  return best && best.sim >= 0.75 ? { start: best.start, end: best.end, how: 'similar' } : null
}

export interface ImportResult {
  source: string
  placed: number
  /** Annotations that were on the document but not in the file, removed (replace mode). */
  removed: number
  /** Of those placed, how many needed a close match rather than the exact words. */
  approximate: number
  duplicates: number
  notPlaced: ExportedAnnotation[]
}

/** Where each annotation in the file belongs in `clean`, by kind and place. */
function fileKeys(clean: string, file: AnnotationsFile): Set<string> {
  const scale = clean.length / Math.max(1, file.textLength)
  const keys = new Set<string>()
  for (const a of file.annotations) {
    const where = locate(clean, a, Math.round(a.position * scale))
    if (where) keys.add(`${a.type}:${where.start}:${where.end}`)
  }
  return keys
}

/**
 * Annotations on the document that the file does not have: what "make the
 * document match the file" would remove. Their ids and words, for asking.
 */
export function annotationsNotInFile(source: string, file: AnnotationsFile): Array<{ id: string; text: string }> {
  const clean = removeAllAnnotations(source)
  const keys = fileKeys(clean, file)
  const { spans, tags } = scan(source)
  return spans
    .filter((s) => !keys.has(`${attr(s.tag, 'data-mn-type')}:${toClean(tags, s.rawStart)}:${toClean(tags, s.rawEnd)}`))
    .map((s) => ({ id: s.id, text: clean.slice(toClean(tags, s.rawStart), toClean(tags, s.rawEnd)) }))
}

/**
 * Puts exported annotations onto `source`, which may have annotations of its
 * own. Those are kept (duplicates skipped) unless `replace` is set: then the
 * ones the file does not have are removed first, and the document ends up
 * with exactly the file's annotations.
 */
export function importAnnotations(source: string, file: AnnotationsFile, opts: { replace?: boolean } = {}): ImportResult {
  let removed = 0
  if (opts.replace) {
    for (const extra of annotationsNotInFile(source, file)) {
      source = removeAnnotation(source, extra.id)
      removed++
    }
  }
  const clean = removeAllAnnotations(source)
  const scale = clean.length / Math.max(1, file.textLength)

  // What is already there, by kind and place, so nothing is added twice.
  const existingIds = new Set<string>()
  const existing = new Set<string>()
  {
    const { spans, tags } = scan(source)
    for (const s of spans) {
      existingIds.add(s.id)
      existing.add(`${attr(s.tag, 'data-mn-type')}:${toClean(tags, s.rawStart)}:${toClean(tags, s.rawEnd)}`)
    }
  }

  let out = source
  let placed = 0
  let approximate = 0
  let duplicates = 0
  const notPlaced: ExportedAnnotation[] = []

  for (const a of file.annotations) {
    const where = locate(clean, a, Math.round(a.position * scale))
    if (!where) {
      notPlaced.push(a)
      continue
    }
    const key = `${a.type}:${where.start}:${where.end}`
    if (existing.has(key)) {
      duplicates++
      continue
    }
    // Annotation tags never change the text, so `clean` stays valid; only
    // the raw positions move as tags are added.
    const { tags } = scan(out)
    const id = existingIds.has(a.id) ? newId() : a.id
    const r = applyAnnotation(out, toRaw(tags, where.start, 'start'), toRaw(tags, where.end, 'end'), {
      type: a.type,
      color: a.color,
      note: a.note,
      author: a.author,
      at: a.at,
      id
    })
    if (!r.applied) {
      notPlaced.push(a)
      continue
    }
    out = r.source
    existing.add(key)
    existingIds.add(id)
    placed++
    if (where.how === 'similar') approximate++
  }
  return { source: out, placed, removed, approximate, duplicates, notPlaced }
}

/** What an import did, for a message: a summary line and the details. */
export function describeImport(r: ImportResult, fileName: string): { summary: string; detail: string } {
  const parts = [`${r.placed} annotation${r.placed === 1 ? '' : 's'} placed from ${fileName}`]
  if (r.removed) parts.push(`${r.removed} not in the file removed`)
  if (r.duplicates) parts.push(`${r.duplicates} already here, skipped`)
  if (r.notPlaced.length) parts.push(`${r.notPlaced.length} could not be placed`)
  const lines: string[] = []
  if (r.approximate) {
    lines.push(
      `${r.approximate} ${r.approximate === 1 ? 'was' : 'were'} placed on the closest matching words, because the text has changed: worth a look.`
    )
  }
  if (r.notPlaced.length) {
    lines.push('', 'Not placed (their words are no longer in this document):')
    for (const a of r.notPlaced.slice(0, 12)) {
      const words = a.exact.replace(/\s+/g, ' ').trim()
      lines.push(`• “${words.length > 80 ? `${words.slice(0, 80)}…` : words}”${a.note ? ` (note: ${a.note.slice(0, 60)})` : ''}`)
    }
    if (r.notPlaced.length > 12) lines.push(`…and ${r.notPlaced.length - 12} more.`)
  }
  return { summary: `${parts.join('; ')}.`, detail: lines.join('\n').trim() }
}
