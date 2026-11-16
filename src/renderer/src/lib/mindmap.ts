/**
 * Mind maps for revision and fast recall.
 *
 * The document becomes a tree: the book, its chapters in reading order, the
 * topics inside each chapter, and, at the bottom, one card per paragraph.
 * Every card carries what is needed to bring the passage back to mind at a
 * glance (decided 14 Nov 2026):
 *
 *   key idea    one short line, the point of the passage;
 *   keywords    two to four trigger words;
 *   summary     two sentences.
 *
 * Cards are made offline and instantly (the passage's most telling sentences
 * and its most distinctive words), and can be rewritten by the AI set up in
 * the AI panel. The reader's own changes (cards moved, added, edited or
 * hidden, and AI cards) are kept in a MapState saved beside the document.
 *
 * Kept identical across the Windows app and the web app.
 */
import { extractHeadings } from './markdown'

export interface Card {
  idea: string
  keywords: string[]
  summary: string
}

export type NodeKind = 'doc' | 'heading' | 'point' | 'custom'

export interface MapNode {
  /** Stable across edits to other parts of the document (built from anchors). */
  id: string
  kind: NodeKind
  /** 0 for the root (the document), 1–6 for headings. */
  level: number
  title: string
  /** The heading's anchor, for jumping to it (empty for points and the root). */
  slug: string
  /** 0-based source lines of the passage: [line, end). -1 when there is none. */
  line: number
  end: number
  /** The passage's own text (a heading's text before its first sub-heading). */
  body: string
  card: Card
  /** Where the card's text came from. */
  source: 'offline' | 'ai' | 'you'
  /** The reader's own notes on the card, and a web link (Edit mind map). */
  notes?: string
  url?: string
  children: MapNode[]
}

/** A part of the document a card is linked to (Edit mind map → link). */
export interface DocLink {
  line: number
  end: number
  slug: string
  label: string
}

export type CardEdit = Partial<Card> & { title?: string; notes?: string; url?: string; link?: DocLink | null }

const plainTitle = (t: string): string =>
  t
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[*_`~]/g, '')
    .trim()

/** A passage as plain sentences: no code, tables, pictures, notes or page numbers. */
export function plainText(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .split('\n')
    .filter((l) => !/^\s*\|/.test(l) && !/^— \d+ —$/.test(l.trim()))
    .join('\n')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/[*_`~#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const STOP = new Set(
  'a an the and or but if then than so of to in on at by for with from as is are was were be been being it its this that these those there their they them you your we our he she his her i me my not no can will would should could may might must do does did have has had just also into out over under more most such very about which who whom what when where why how all any each other some only own same too up down again further once here both few nor off while because until get gets got make makes made way ways one two thing things lot lots even still much many like well really something someone people person use used using want know need'.split(
    ' '
  )
)

const sentencesOf = (text: string): string[] =>
  text.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g)?.map((s) => s.trim()).filter((s) => s.length > 3) ?? []

const wordsOf = (s: string): string[] =>
  s.toLowerCase().match(/[a-zÀ-ɏऀ-෿][a-zÀ-ɏऀ-෿'-]{2,}/g)?.filter((w) => !STOP.has(w)) ?? []

/** The passage's most telling sentences, in their original order, about `max` characters. */
export function offlineSummary(body: string, max = 170, most = 99): string {
  const text = plainText(body)
  if (!text) return ''
  const sentences = sentencesOf(text)
  if (!sentences.length) return ''
  if (text.length <= max && sentences.length <= most) return text
  const freq = new Map<string, number>()
  for (const w of wordsOf(text)) freq.set(w, (freq.get(w) ?? 0) + 1)
  const scored = sentences.map((s, i) => {
    const ws = wordsOf(s)
    const score = ws.reduce((t, w) => t + (freq.get(w) ?? 0), 0) / Math.max(4, ws.length) + (i === 0 ? 1.5 : 0)
    return { s, i, score }
  })
  const picked: typeof scored = []
  let len = 0
  for (const c of [...scored].sort((a, b) => b.score - a.score)) {
    if (picked.length >= most) break
    if (len + c.s.length > max && picked.length) continue
    picked.push(c)
    len += c.s.length + 1
    if (len >= max * 0.7) break
  }
  const out = picked
    .sort((a, b) => a.i - b.i)
    .map((p) => p.s)
    .join(' ')
  return out.length > max + 40 ? `${out.slice(0, max).replace(/\s+\S*$/, '')}…` : out
}

/**
 * A card made offline: the key idea is the passage's most central sentence,
 * cut to about 15 words; keywords are its most distinctive words (frequent
 * here, rarer elsewhere in the document); the summary is two sentences.
 */
export function offlineCard(body: string, docFreq?: Map<string, number>, docCount = 1): Card {
  const text = plainText(body)
  if (!text) return { idea: '', keywords: [], summary: '' }
  const sentences = sentencesOf(text)
  const freq = new Map<string, number>()
  for (const w of wordsOf(text)) freq.set(w, (freq.get(w) ?? 0) + 1)
  const weight = (w: string): number => (freq.get(w) ?? 0) * Math.log(1 + docCount / (docFreq?.get(w) ?? 1))
  let best = sentences[0] ?? text
  let bestScore = -1
  sentences.forEach((s, i) => {
    const ws = wordsOf(s)
    const score = ws.reduce((t, w) => t + weight(w), 0) / Math.max(5, ws.length) + (i === 0 ? 0.6 : 0)
    if (score > bestScore) {
      bestScore = score
      best = s
    }
  })
  const words = best.replace(/[.!?]+$/, '').split(/\s+/)
  const idea = words.length > 16 ? `${words.slice(0, 15).join(' ')}…` : words.join(' ')
  const keywords = [...freq.keys()]
    .sort((a, b) => weight(b) - weight(a))
    .filter((w, i, all) => !all.slice(0, i).some((x) => x.startsWith(w) || w.startsWith(x)))
    .slice(0, 4)
  return { idea, keywords, summary: offlineSummary(body, 230, 2) }
}

/** A passage split into paragraphs (as written), leaving out short scraps. */
export function paragraphsOf(body: string): Array<{ text: string; offset: number }> {
  const out: Array<{ text: string; offset: number }> = []
  const lines = body.split('\n')
  let start = -1
  let fence = false
  const push = (from: number, to: number): void => {
    const text = lines.slice(from, to).join('\n').trim()
    if (plainText(text).length >= 60) out.push({ text, offset: from })
  }
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence
    const blank = !l.trim() && !fence
    if (blank) {
      if (start >= 0) push(start, i)
      start = -1
    } else if (start < 0) start = i
  })
  if (start >= 0) push(start, lines.length)
  return out
}

/**
 * The tree. A single top-level heading becomes the root; otherwise the root
 * is the document's name. Each heading gets one point card per paragraph of
 * its own text.
 */
export function buildTree(markdown: string, name: string, withPoints = true): MapNode {
  const lines = markdown.split('\n')
  const heads: Array<{ level: number; text: string; line: number }> = []
  let fence = false
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence
    if (fence) return
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l)
    if (m) heads.push({ level: m[1].length, text: m[2], line: i })
  })
  // The anchors the viewer gives the same headings, in the same order.
  const slugs = extractHeadings(markdown).map((h) => h.slug)

  const bodyOf = (i: number): string => lines.slice(heads[i].line + 1, i + 1 < heads.length ? heads[i + 1].line : lines.length).join('\n')
  const bodies = heads.map((_, i) => bodyOf(i))

  // How many passages each word appears in, for distinctive keywords.
  const docFreq = new Map<string, number>()
  for (const b of bodies) for (const w of new Set(wordsOf(plainText(b)))) docFreq.set(w, (docFreq.get(w) ?? 0) + 1)
  const docCount = Math.max(1, bodies.length)

  const nodes: MapNode[] = heads.map((h, i) => ({
    id: `s:${slugs[i] ?? i}`,
    kind: 'heading',
    level: h.level,
    title: plainTitle(h.text) || 'Untitled',
    slug: slugs[i] ?? '',
    line: h.line,
    end: lines.length,
    body: bodies[i],
    card: offlineCard(bodies[i], docFreq, docCount),
    source: 'offline',
    children: []
  }))

  const h1s = nodes.filter((n) => n.level === 1)
  const singleTitle = h1s.length === 1 && nodes[0]?.level === 1
  const intro = heads.length ? lines.slice(0, heads[0].line).join('\n') : markdown
  const root: MapNode = singleTitle
    ? { ...nodes[0], kind: 'doc', level: 0 }
    : {
        id: 'doc',
        kind: 'doc',
        level: 0,
        title: name.replace(/\.[^.]+$/, '') || 'Document',
        slug: '',
        line: 0,
        end: lines.length,
        body: intro,
        card: offlineCard(intro, docFreq, docCount),
        source: 'offline',
        children: []
      }
  const rest = singleTitle ? nodes.slice(1) : nodes

  const stack: MapNode[] = [root]
  for (const n of rest) {
    while (stack.length > 1 && stack[stack.length - 1].level >= n.level) stack.pop()
    stack[stack.length - 1].children.push(n)
    stack.push(n)
  }
  groupChapters(root)

  // Where each heading's passage ends: where the next part not inside it begins.
  const order: MapNode[] = []
  walk(root, (n) => order.push(n))
  const size = new Map<MapNode, number>()
  const count = (n: MapNode): number => {
    const s = 1 + n.children.reduce((t, c) => t + count(c), 0)
    size.set(n, s)
    return s
  }
  count(root)
  order.forEach((n, i) => (n.end = order[i + (size.get(n) ?? 1)]?.line ?? lines.length))

  if (withPoints) {
    walk(root, (n) => {
      if (n.kind === 'point') return
      const paras = paragraphsOf(n.body)
      // A passage of a single paragraph is already the card itself.
      if (paras.length < 2 && n.children.length === 0) return
      const points: MapNode[] = paras.map((p, i) => ({
        id: `${n.id}#${i}`,
        kind: 'point',
        level: n.level + 1,
        title: '',
        slug: n.slug,
        line: n.line + 1 + p.offset,
        end: n.line + 1 + p.offset + p.text.split('\n').length,
        body: p.text,
        card: offlineCard(p.text, docFreq, docCount),
        source: 'offline',
        children: []
      }))
      for (const p of points) p.title = p.card.idea
      n.children = [...points, ...n.children]
    })
  }
  return root
}

/** A heading that starts a chapter of a book. */
const CHAPTER =
  /^(?:chapter|part|book|section|lesson|unit|module|appendix)\s+(?:\d+|[ivxlc]+|one|two|three|four|five|six|seven|eight|nine|ten)\b|^(?:introduction|conclusion|preface|prologue|epilogue|foreword|afterword)\b/i

/**
 * Converted books often give chapters and the points inside them the same
 * heading level, which would make one long flat list. Where a long list of
 * topics holds chapter headings, the topics after each chapter go under it.
 */
export function groupChapters(node: MapNode): void {
  const kids = node.children
  if (kids.length > 10 && kids.filter((k) => CHAPTER.test(k.title)).length >= 2) {
    const out: MapNode[] = []
    let chapter: MapNode | null = null
    for (const k of kids) {
      if (CHAPTER.test(k.title)) {
        chapter = k
        out.push(k)
      } else if (chapter) chapter.children.push(k)
      else out.push(k)
    }
    node.children = out
  }
  for (const k of node.children) groupChapters(k)
}

export function countNodes(n: MapNode): number {
  return 1 + n.children.reduce((t, c) => t + countNodes(c), 0)
}

export function walk(n: MapNode, fn: (n: MapNode, depth: number) => void, depth = 0): void {
  fn(n, depth)
  for (const c of n.children) walk(c, fn, depth + 1)
}

export function findNode(root: MapNode, id: string): MapNode | null {
  let hit: MapNode | null = null
  walk(root, (n) => {
    if (!hit && n.id === id) hit = n
  })
  return hit
}

/* ------------------------------------------------------- the reader's map */

/** Everything the reader changed, saved beside the document (Book.mindmap.json). */
export interface MapState {
  v: 1
  /** Card moved by hand: offset from where the layout puts it (moves its branch too). */
  moved: Record<string, { dx: number; dy: number }>
  /** Card text changed by the reader, with notes, a web link and a document link. */
  edits: Record<string, CardEdit>
  /** Lines the reader drew between two cards. */
  links: Array<{ from: string; to: string }>
  /** Cards the reader added. */
  custom: Array<{ id: string; parent: string; title: string } & Card>
  /** Cards the reader removed from the map (the document is untouched). */
  hidden: string[]
  /** Cards written by the AI. */
  ai: Record<string, Card>
  /** Study (lib/study.ts): your or the AI's question and answer for a card. */
  qa?: Record<string, { q: string; a: string }>
  /** Study: the quiz's memory of each card. */
  quiz?: Record<string, { known: boolean; seen: number; at: number }>
  /** Study: tags on cards. */
  tags?: Record<string, string[]>
}

export const EMPTY_STATE: MapState = { v: 1, moved: {}, edits: {}, links: [], custom: [], hidden: [], ai: {} }

/** Reads a saved state, ignoring anything malformed. */
export function readState(json: string | null | undefined): MapState {
  try {
    const s = JSON.parse(json ?? '') as Partial<MapState>
    if (!s || s.v !== 1) return { ...EMPTY_STATE }
    return {
      v: 1,
      moved: typeof s.moved === 'object' && s.moved ? s.moved : {},
      edits: typeof s.edits === 'object' && s.edits ? s.edits : {},
      links: Array.isArray(s.links) ? s.links.filter((l) => l && typeof l.from === 'string' && typeof l.to === 'string') : [],
      custom: Array.isArray(s.custom) ? s.custom.filter((c) => c && typeof c.id === 'string' && typeof c.parent === 'string') : [],
      hidden: Array.isArray(s.hidden) ? s.hidden.filter((h) => typeof h === 'string') : [],
      ai: typeof s.ai === 'object' && s.ai ? s.ai : {},
      qa: typeof s.qa === 'object' && s.qa ? s.qa : {},
      quiz: typeof s.quiz === 'object' && s.quiz ? s.quiz : {},
      tags: typeof s.tags === 'object' && s.tags ? s.tags : {}
    }
  } catch {
    return { ...EMPTY_STATE }
  }
}

/** The tree with the reader's changes applied: AI cards, edits, added and hidden cards. */
export function applyState(root: MapNode, state: MapState): MapNode {
  const clone = (n: MapNode): MapNode => ({ ...n, card: { ...n.card, keywords: [...n.card.keywords] }, children: n.children.map(clone) })
  const tree = clone(root)
  const hidden = new Set(state.hidden)
  walk(tree, (n) => {
    n.children = n.children.filter((c) => !hidden.has(c.id))
    const ai = state.ai[n.id]
    if (ai) {
      n.card = { idea: ai.idea ?? n.card.idea, keywords: ai.keywords ?? n.card.keywords, summary: ai.summary ?? n.card.summary }
      n.source = 'ai'
      if (n.kind === 'point') n.title = n.card.idea
    }
  })
  for (const c of state.custom) {
    const parent = findNode(tree, c.parent)
    if (!parent || hidden.has(c.id)) continue
    parent.children.push({
      id: c.id,
      kind: 'custom',
      level: parent.level + 1,
      title: c.title,
      slug: '',
      line: -1,
      end: -1,
      body: '',
      card: { idea: c.idea, keywords: c.keywords ?? [], summary: c.summary },
      source: 'you',
      children: []
    })
  }
  walk(tree, (n) => {
    const e = state.edits[n.id]
    if (!e) return
    const textChanged = e.idea !== undefined || e.keywords !== undefined || e.summary !== undefined || e.title !== undefined
    n.card = { idea: e.idea ?? n.card.idea, keywords: e.keywords ?? n.card.keywords, summary: e.summary ?? n.card.summary }
    if (e.title !== undefined) n.title = e.title
    else if (n.kind === 'point') n.title = n.card.idea
    if (textChanged) n.source = 'you'
    if (e.notes) n.notes = e.notes
    if (e.url) n.url = e.url
    // A card linked to a part of the document shows that part.
    if (e.link) {
      n.line = e.link.line
      n.end = e.link.end
      if (n.kind === 'custom') n.slug = e.link.slug
    }
  })
  return tree
}

/* ---------------------------------------------------------------- Mermaid */

const mmText = (t: string): string => t.replace(/["`]/g, "'").replace(/[()[\]{}<>]/g, ' ').replace(/\s+/g, ' ').trim()

/** The tree as a Mermaid mind map (renders on GitHub, in Obsidian and elsewhere). */
export function toMermaidMindmap(root: MapNode, maxDepth = 4): string {
  const out = ['mindmap', `  root((${mmText(root.title)}))`]
  const add = (n: MapNode, depth: number): void => {
    if (depth > maxDepth) return
    out.push(`${'  '.repeat(depth + 1)}${mmText(n.kind === 'point' ? n.card.idea : n.title)}`)
    n.children.forEach((c) => add(c, depth + 1))
  }
  root.children.forEach((c) => add(c, 1))
  return out.join('\n')
}
