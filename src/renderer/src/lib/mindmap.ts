/**
 * The document's headings as a tree, for the mind map and flowchart view,
 * with a short summary of each topic.
 *
 * Summaries come in two kinds:
 *   - offline, instant: the section's most telling sentences, picked by how
 *     many of the section's key words each one carries (no AI, no internet);
 *   - from the AI set up in the AI panel, on request (see MindMapView).
 *
 * Also writes the tree as a Mermaid diagram for inserting into the document.
 *
 * Kept identical across the Windows app and the web app.
 */
import { extractHeadings } from './markdown'

export interface MapNode {
  id: string
  /** 0 for the root (the document), 1–6 for headings. */
  level: number
  title: string
  /** The heading's anchor, for jumping to it (empty for the root). */
  slug: string
  /** 0-based source line of the heading (-1 for the root). */
  line: number
  /** The section's own text, up to the next heading. */
  body: string
  summary: string
  children: MapNode[]
}

const plainTitle = (t: string): string =>
  t
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[*_`~]/g, '')
    .trim()

/** A section's text as plain sentences: no code, tables, pictures, notes or page numbers. */
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
  'a an the and or but if then than so of to in on at by for with from as is are was were be been being it its this that these those there their they them you your we our he she his her i me my not no can will would should could may might must do does did have has had just also into out over under more most such very about which who whom what when where why how all any each other some only own same too up down again further once here both few nor off while because until'.split(
    ' '
  )
)

/** The section's most telling sentences, in their original order, about `max` characters. */
export function offlineSummary(body: string, max = 170): string {
  const text = plainText(body)
  if (!text) return ''
  const sentences = text.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g)?.map((s) => s.trim()).filter((s) => s.length > 3) ?? []
  if (!sentences.length) return ''
  if (text.length <= max) return text
  const words = (s: string): string[] => s.toLowerCase().match(/[a-zÀ-ɏऀ-෿]{3,}/g)?.filter((w) => !STOP.has(w)) ?? []
  const freq = new Map<string, number>()
  for (const w of words(text)) freq.set(w, (freq.get(w) ?? 0) + 1)
  const scored = sentences.map((s, i) => {
    const ws = words(s)
    const score = ws.reduce((t, w) => t + (freq.get(w) ?? 0), 0) / Math.max(4, ws.length) + (i === 0 ? 1.5 : 0)
    return { s, i, score }
  })
  const picked: typeof scored = []
  let len = 0
  for (const c of [...scored].sort((a, b) => b.score - a.score)) {
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
 * The heading tree. A single top-level heading becomes the root; otherwise
 * the root is the document's name.
 */
export function buildTree(markdown: string, name: string): MapNode {
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

  const bodyOf = (i: number): string => {
    const from = heads[i].line + 1
    const to = i + 1 < heads.length ? heads[i + 1].line : lines.length
    return lines.slice(from, to).join('\n')
  }
  const nodes: MapNode[] = heads.map((h, i) => {
    const body = bodyOf(i)
    return { id: `h${i}`, level: h.level, title: plainTitle(h.text) || 'Untitled', slug: slugs[i] ?? '', line: h.line, body, summary: offlineSummary(body), children: [] }
  })

  const h1s = nodes.filter((n) => n.level === 1)
  const singleTitle = h1s.length === 1 && nodes[0]?.level === 1
  const intro = heads.length ? lines.slice(0, heads[0].line).join('\n') : markdown
  const root: MapNode = singleTitle
    ? { ...nodes[0], level: 0 }
    : { id: 'root', level: 0, title: name.replace(/\.[^.]+$/, '') || 'Document', slug: '', line: -1, body: intro, summary: offlineSummary(intro), children: [] }
  const rest = singleTitle ? nodes.slice(1) : nodes

  const stack: MapNode[] = [root]
  for (const n of rest) {
    while (stack.length > 1 && stack[stack.length - 1].level >= n.level) stack.pop()
    stack[stack.length - 1].children.push(n)
    stack.push(n)
  }
  groupChapters(root)
  return root
}

/** A heading that starts a chapter of a book. */
const CHAPTER =
  /^(?:chapter|part|book|section|lesson|unit|module|appendix)\s+(?:\d+|[ivxlc]+|one|two|three|four|five|six|seven|eight|nine|ten)\b|^(?:introduction|conclusion|preface|prologue|epilogue|foreword|afterword)\b/i

/**
 * Converted books often give chapters and the points inside them the same
 * heading level, which would make one long flat fan. Where a long list of
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

/* ---------------------------------------------------------------- Mermaid */

const mmText = (t: string): string => t.replace(/["`]/g, "'").replace(/[()[\]{}<>]/g, ' ').replace(/\s+/g, ' ').trim()

/** The tree as a Mermaid mind map (renders on GitHub, in Obsidian and elsewhere). */
export function toMermaidMindmap(root: MapNode, maxDepth = 4): string {
  const out = ['mindmap', `  root((${mmText(root.title)}))`]
  const add = (n: MapNode, depth: number): void => {
    if (depth > maxDepth) return
    out.push(`${'  '.repeat(depth + 1)}${mmText(n.title)}`)
    n.children.forEach((c) => add(c, depth + 1))
  }
  root.children.forEach((c) => add(c, 1))
  return out.join('\n')
}

/** The tree as a Mermaid flowchart, top to bottom. */
export function toMermaidFlowchart(root: MapNode, maxDepth = 4): string {
  const out = ['flowchart TD']
  const label = (n: MapNode): string => `${n.id}["${mmText(n.title)}"]`
  const add = (parent: MapNode, depth: number): void => {
    if (depth > maxDepth) return
    for (const c of parent.children) {
      out.push(`  ${label(parent)} --> ${label(c)}`)
      add(c, depth + 1)
    }
  }
  if (!root.children.length) out.push(`  ${label(root)}`)
  add(root, 1)
  return out.join('\n')
}
