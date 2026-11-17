/**
 * Studying with the mind map: question-and-answer cards, a quiz that
 * remembers what you knew, your highlights as cards, tags and search, and
 * export for Anki or a spreadsheet.
 *
 * Everything is kept in the mind map's saved state (Book.mindmap.json beside
 * the document; in the browser, the browser's storage), alongside moved and
 * edited cards. Nothing here changes the document itself.
 */
import { listAnnotations } from './annotations'
import { plainText, walk, type MapNode, type MapState } from './mindmap'

export interface QA {
  q: string
  a: string
}

export interface Recall {
  /** Last answer: knew it, or needs another look. */
  known: boolean
  /** How many times it has been asked. */
  seen: number
  at: number
}

/** Ready-made tags; the reader can type others. */
export const TAGS = ['⭐ Important', '❓ Unclear', '🔁 Revise', '✅ Know it'] as const

export interface StudyCard {
  id: string
  title: string
  /** The chapter it belongs to (top-level heading), for grouping. */
  chapter: string
  chapterId: string
  q: string
  a: string
  /** Made by you or the AI, rather than from the card's own text. */
  own: boolean
  tags: string[]
  recall?: Recall
  node: MapNode
}

const clean = (t: string): string => t.replace(/\s+/g, ' ').trim()

/**
 * Parts of a converted book that are not worth studying: the contents list,
 * copyright and promotion pages, page furniture.
 */
export function isFiller(n: MapNode): boolean {
  const text = clean(`${n.title} ${n.card.idea} ${n.card.summary}`)
  if (/\b(table of contents|copyright|all rights reserved|click here|free (copy|gift|bonus|download)|isbn|about the author)\b/i.test(text)) return true
  if (/www\.|https?:\/\//i.test(text)) return true
  if ((text.match(/\bchapter \d+/gi) ?? []).length >= 3) return true
  return clean(`${n.card.idea} ${n.card.summary}`).length < 40
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A question and answer from a card's own text, without any AI.
 *
 * Paragraph cards become "fill the gap" questions: the card's key sentence
 * with its most telling keyword blanked out. It is always about this book,
 * and recalling the missing word recalls the point. Chapters and sections
 * ask for their main points.
 */
export function offlineQA(n: MapNode, chapter = ''): QA {
  const idea = clean(n.card.idea)
  const sum = clean(n.card.summary)
  const where = chapter && chapter !== n.title ? ` (${clean(chapter)})` : ''
  if (n.kind === 'heading') {
    return { q: `What are the main points of “${clean(n.title)}”${where}?`, a: sum || idea }
  }
  const answerText = [idea, sum && sum !== idea && !idea.includes(sum) ? sum : ''].filter(Boolean).join('\n\n')
  for (const k of n.card.keywords.map((x) => x.replace(/^#/, '').trim()).filter((x) => x.length > 3)) {
    const re = new RegExp(`\\b${esc(k)}\\b`, 'i')
    const m = idea.match(re)
    if (m) return { q: `Fill the gap${where}: “${idea.replace(re, '_____')}”`, a: `${m[0]}\n\n${answerText}` }
  }
  const key = n.card.keywords[0]?.replace(/^#/, '')
  if (key) return { q: `What does the book say about “${key}”${where}?`, a: answerText }
  return { q: `Recall the point${where} that begins: “${idea.split(/\s+/).slice(0, 6).join(' ')}…”`, a: answerText }
}

/** The cards of a map (or of one chapter's map), in reading order, ready to study. */
export function deck(scope: MapNode, state: MapState): StudyCard[] {
  const out: StudyCard[] = []
  const chapterOf = new Map<string, MapNode>()
  const visit = (n: MapNode, chapter: MapNode | null): void => {
    for (const c of n.children) {
      const ch = chapter ?? (scope.kind === 'doc' ? c : scope)
      chapterOf.set(c.id, ch)
      visit(c, ch)
    }
  }
  visit(scope, scope.kind === 'doc' ? null : scope)
  walk(scope, (n) => {
    if (n === scope && scope.kind === 'doc') return
    const own = state.qa?.[n.id]
    // Your own cards and your own questions always count; filler pages never.
    if (!own && n.kind !== 'custom' && isFiller(n)) return
    const ch = chapterOf.get(n.id) ?? scope
    if (!own && ch !== n && isFiller(ch)) return
    const qa = own ?? offlineQA(n, ch.title)
    out.push({
      id: n.id,
      title: n.title,
      chapter: ch.title,
      chapterId: ch.id,
      q: qa.q,
      a: qa.a,
      own: !!own,
      tags: state.tags?.[n.id] ?? [],
      recall: state.quiz?.[n.id],
      node: n
    })
  })
  return out
}

/** Progress for a set of cards: how many asked, and how many known. */
export function progressOf(cards: StudyCard[]): { total: number; asked: number; known: number } {
  let asked = 0
  let known = 0
  for (const c of cards) {
    if (c.recall) {
      asked++
      if (c.recall.known) known++
    }
  }
  return { total: cards.length, asked, known }
}

/**
 * The order to ask in: never asked first, then the ones you did not know,
 * then the rest, oldest first. Within each group, reading order.
 */
export function quizOrder(cards: StudyCard[], onlyTag = ''): StudyCard[] {
  const pool = onlyTag ? cards.filter((c) => c.tags.includes(onlyTag)) : cards
  const rank = (c: StudyCard): number => (!c.recall ? 0 : c.recall.known ? 2 : 1)
  return pool
    .map((c, i) => ({ c, i }))
    .sort((x, y) => rank(x.c) - rank(y.c) || (x.c.recall?.at ?? 0) - (y.c.recall?.at ?? 0) || x.i - y.i)
    .map((x) => x.c)
}

export function answer(state: MapState, id: string, known: boolean, now = Date.now()): MapState {
  const prev = state.quiz?.[id]
  return { ...state, quiz: { ...(state.quiz ?? {}), [id]: { known, seen: (prev?.seen ?? 0) + 1, at: now } } }
}

export function setQA(state: MapState, id: string, qa: QA | null): MapState {
  const next = { ...(state.qa ?? {}) }
  if (qa) next[id] = qa
  else delete next[id]
  return { ...state, qa: next }
}

export function toggleTag(state: MapState, id: string, tag: string): MapState {
  const now = state.tags?.[id] ?? []
  const list = now.includes(tag) ? now.filter((t) => t !== tag) : [...now, tag]
  const next = { ...(state.tags ?? {}) }
  if (list.length) next[id] = list
  else delete next[id]
  return { ...state, tags: next }
}

/** Every tag in use, ready-made ones first. */
export function tagsInUse(state: MapState): string[] {
  const used = new Set(Object.values(state.tags ?? {}).flat())
  return [...TAGS.filter((t) => used.has(t)), ...[...used].filter((t) => !(TAGS as readonly string[]).includes(t)).sort()]
}

/** Cards whose title, text, notes, question, answer or tags contain every word searched for. */
export function search(cards: StudyCard[], query: string): StudyCard[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  return cards.filter((c) => {
    const hay = `${c.title} ${c.node.card.idea} ${c.node.card.summary} ${c.node.card.keywords.join(' ')} ${c.node.notes ?? ''} ${c.q} ${c.a} ${c.tags.join(' ')}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

/* --------------------------------------------------------- highlights */

/** The deepest heading card whose passage holds a given source line. */
function holder(root: MapNode, line: number): MapNode {
  let best = root
  walk(root, (n) => {
    if ((n.kind === 'heading' || n.kind === 'doc') && n.line >= 0 && n.line <= line && line < n.end && n.level >= best.level) best = n
  })
  return best
}

/**
 * Your highlights and comments, as cards under the chapter or section they
 * are in. Ones already added are skipped, so this can be run again after
 * more reading.
 */
export function highlightCards(source: string, root: MapNode, state: MapState): MapState['custom'] {
  const have = new Set(state.custom.map((c) => c.id))
  const out: MapState['custom'] = []
  for (const a of listAnnotations(source)) {
    const id = `hl-${a.id}`
    if (have.has(id) || !a.text.trim()) continue
    const at = source.indexOf(`data-mn-id="${a.id}"`)
    const line = at < 0 ? 0 : source.slice(0, at).split('\n').length - 1
    const parent = holder(root, line)
    const text = clean(plainText(a.text))
    out.push({
      id,
      parent: parent.id,
      title: text.length > 70 ? `${text.slice(0, 68)}…` : text,
      idea: text,
      keywords: ['highlight'],
      summary: a.note ? clean(a.note) : ''
    })
  }
  return out
}

/* --------------------------------------------------------- export */

const csvCell = (t: string): string => (/[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t)

/** A spreadsheet: Chapter, Card, Question, Answer, Tags, Known. */
export function toCsv(cards: StudyCard[]): string {
  const rows = [['Chapter', 'Card', 'Question', 'Answer', 'Tags', 'Known']]
  for (const c of cards) rows.push([c.chapter, c.title, c.q, c.a, c.tags.join('; '), c.recall ? (c.recall.known ? 'yes' : 'not yet') : ''])
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

/**
 * Anki's text import: front, back and tags, with header lines so Anki sets
 * the columns itself (File → Import in Anki 2.1.55 or later). Tags become
 * Anki tags: the chapter, plus your own tags without their emoji.
 */
export function toAnki(cards: StudyCard[], deckName: string): string {
  const tag = (t: string): string =>
    t
      .replace(/[^\p{L}\p{N}]+/gu, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40)
  const lines = ['#separator:Tab', '#html:true', `#deck:${deckName.replace(/[\t\n]/g, ' ')}`, '#columns:Front\tBack\tTags', '#tags column:3']
  const html = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\t/g, ' ').replace(/\r?\n/g, '<br>')
  for (const c of cards) {
    const tags = [tag(c.chapter), ...c.tags.map(tag)].filter(Boolean)
    lines.push(`${html(c.q)}\t${html(c.a)}\t${[...new Set(tags)].join(' ')}`)
  }
  return lines.join('\n') + '\n'
}

/** A readable study sheet: questions under their chapters, each answer beneath. */
export function toStudySheet(cards: StudyCard[], title: string): string {
  const out = [`# ${title}: study questions`, '', `_${cards.length} questions. Cover the answers and test yourself._`, '']
  let chapter = ''
  let n = 0
  for (const c of cards) {
    if (c.chapter !== chapter) {
      chapter = c.chapter
      out.push(`## ${chapter}`, '')
    }
    n++
    out.push(`**${n}. ${c.q}**`, '')
    out.push(...c.a.split(/\n+/).map((l) => `> ${l}`), '')
    if (c.tags.length) out.push(`_Tags: ${c.tags.join(', ')}_`, '')
  }
  return out.join('\n')
}

/* --------------------------------------------------------- AI */

export const QA_SYSTEM = `You write flashcards so a reader can test their recall of a book. For each passage write ONE question whose answer is the passage's key point, and a short answer (1 to 3 sentences) using only the passage. Prefer "why" and "how" questions over yes/no. Write in the passage's own language.
Reply with JSON only, keyed by passage id: {"<id>": {"q": "…", "a": "…"}}.`

export function qaPrompt(cards: StudyCard[]): string {
  return cards.map((c) => `### ${c.id}\nTitle: ${c.title}\n${clean(`${c.node.card.idea}. ${c.node.card.summary} ${plainText(c.node.body).slice(0, 1600)}`)}`).join('\n\n')
}

export function parseQA(text: string): Record<string, QA> {
  try {
    const json = JSON.parse(text.replace(/^[\s\S]*?(\{[\s\S]*\})[\s\S]*$/, '$1')) as Record<string, Partial<QA>>
    const out: Record<string, QA> = {}
    for (const [id, v] of Object.entries(json)) if (v && typeof v.q === 'string' && typeof v.a === 'string' && v.q.trim()) out[id] = { q: v.q.trim(), a: v.a.trim() }
    return out
  } catch {
    return {}
  }
}
