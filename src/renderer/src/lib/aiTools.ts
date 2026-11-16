/**
 * Three AI tools: distil a book, remove repeated content, and turn a website
 * or a project folder into documentation.
 *
 * Each works with whichever AI is set up (Ollama on this computer, or the
 * reader's own free API key), one modest request at a time, so a small local
 * model copes and a free key's rate limit is respected. Nothing here touches
 * the document directly: results open as a new document, or as changes to
 * review and accept.
 */
import { plainText } from './mindmap'
import { TOC_END, TOC_START } from './toc'

/** An empty contents block; the app fills it in (refreshToc). */
const TOC = `${TOC_START}\n${TOC_END}`

export type Ask = (system: string, user: string) => Promise<{ ok: boolean; text?: string; error?: string }>
export type Progress = (done: number, total: number, note: string) => void

export class Cancelled extends Error {
  constructor() {
    super('Stopped.')
  }
}

function check(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Cancelled()
}

async function askOk(ask: Ask, system: string, user: string, signal?: AbortSignal): Promise<string> {
  check(signal)
  let last = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await ask(system, user)
    check(signal)
    if (r.ok && r.text?.trim()) return r.text.trim()
    last = r.error ?? 'The AI gave an empty answer.'
    // Free keys answer "too many requests" when hurried: wait and try again.
    if (!/rate.?limit|429|too many|busy|overloaded|temporar/i.test(last)) break
    await new Promise((res) => setTimeout(res, 4000 * (attempt + 1)))
  }
  throw new Error(last)
}

/** Strips a ```markdown fence some models wrap their whole answer in. */
export function unwrap(text: string): string {
  const m = text.trim().match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i)
  return (m ? m[1] : text).trim()
}

/* ------------------------------------------------------------ chapters */

export interface Chapter {
  title: string
  body: string
}

/**
 * Splits a book into chapters: at the most frequent heading level among
 * #, ## and ### (ignoring a single title heading), so both "# Chapter" and
 * "## Chapter" books work. A document without headings is one chapter.
 */
export function splitChapters(markdown: string, fallbackTitle = 'Document'): Chapter[] {
  const lines = markdown.split('\n')
  let fence = false
  const heads: Array<{ line: number; level: number; text: string }> = []
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence
    const m = !fence && l.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/)
    if (m) heads.push({ line: i, level: m[1].length, text: m[2].trim() })
  })
  const count = (lv: number): number => heads.filter((h) => h.level === lv).length
  const level = [1, 2, 3].find((lv) => count(lv) >= 2)
  if (!level) return [{ title: heads[0]?.text ?? fallbackTitle, body: markdown }]
  const at = heads.filter((h) => h.level === level)
  const out: Chapter[] = []
  const intro = lines.slice(0, at[0].line).join('\n')
  if (plainText(intro).split(' ').length > 60) out.push({ title: 'Introduction', body: intro })
  at.forEach((h, i) => {
    const body = lines.slice(h.line + 1, i + 1 < at.length ? at[i + 1].line : lines.length).join('\n')
    if (plainText(body).length > 40) out.push({ title: h.text, body })
  })
  return out.length ? out : [{ title: fallbackTitle, body: markdown }]
}

/** Keeps a request small enough for a local model: the start and end of a long text. */
export function clip(text: string, max = 12000): string {
  if (text.length <= max) return text
  const head = Math.floor(max * 0.75)
  return `${text.slice(0, head)}\n\n[…]\n\n${text.slice(text.length - (max - head))}`
}

/* ------------------------------------------------------------ distil */

const DISTIL_SYSTEM = `You distil one chapter of a book for a reader who wants to remember and use it.
Use ONLY the chapter text given. Never add outside knowledge.
Reply in Markdown with exactly these three parts and nothing else:

**Key points**
- 3 to 7 short bullet points, the chapter's main ideas, in the order they appear.

**Quotes**
- 1 or 2 short sentences copied word for word from the chapter, in quotation marks. If none stands out, write "- None."

**How to apply it**
- 2 or 3 practical actions the reader can take, based only on the chapter.

Do not write a heading for the chapter. Do not add a preamble or a closing remark.`

export async function distilBook(
  markdown: string,
  name: string,
  ask: Ask,
  progress: Progress,
  signal?: AbortSignal
): Promise<string> {
  const chapters = splitChapters(markdown, name)
  const parts: string[] = []
  for (let i = 0; i < chapters.length; i++) {
    const c = chapters[i]
    progress(i, chapters.length, c.title)
    const body = clip(plainText(c.body), 8000)
    let text: string
    try {
      text = unwrap(await askOk(ask, DISTIL_SYSTEM, `Chapter: ${c.title}\n\n${body}`, signal))
    } catch (e) {
      if (e instanceof Cancelled) throw e
      text = `_Could not distil this chapter: ${(e as Error).message}_`
    }
    // Some models add their own heading anyway; ours is the one that counts.
    text = text.replace(/^#{1,6}\s.*\n+/, '')
    parts.push(`## ${c.title}\n\n${text}`)
  }
  progress(chapters.length, chapters.length, 'Done')
  const title = name.replace(/\.[^.]+$/, '')
  return `# ${title}: distilled\n\n_Key points, quotes and how to apply each chapter, made with AI from “${name}”. Check anything important against the book._\n\n${TOC}\n\n${parts.join('\n\n')}\n`
}

/* ------------------------------------------------------------ duplicates */

const words = (t: string): string[] => plainText(t).toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []

function shingles(t: string): Set<string> {
  const w = words(t)
  const s = new Set<string>()
  if (w.length < 3) {
    if (w.length) s.add(w.join(' '))
    return s
  }
  for (let i = 0; i + 2 < w.length; i++) s.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`)
  return s
}

export function similarity(a: string, b: string): number {
  const A = shingles(a)
  const B = shingles(b)
  if (!A.size || !B.size) return 0
  let common = 0
  for (const x of A) if (B.has(x)) common++
  return common / Math.min(A.size, B.size)
}

/** Paragraph-sized blocks, keeping code, tables and lists whole. */
export function blocks(markdown: string): string[] {
  const out: string[] = []
  let cur: string[] = []
  let fence = false
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    if (!fence && line.trim() === '') {
      if (cur.length) out.push(cur.join('\n'))
      cur = []
    } else cur.push(line)
  }
  if (cur.length) out.push(cur.join('\n'))
  return out
}

const isHeading = (b: string): boolean => /^#{1,6}\s/.test(b.trim())

export interface DedupeResult {
  text: string
  removed: number
  merged: number
}

const MERGE_SYSTEM = `Two paragraphs from the same document say largely the same thing. Combine them into ONE paragraph that keeps every distinct fact, name, number and example from both, and drops the repetition.
Use only their wording and facts; add nothing. Keep any Markdown formatting. Reply with the combined paragraph only.`

/**
 * Removes repeated content. A paragraph that repeats an earlier one (at
 * least `exact` similar) is dropped. Two that overlap a lot but each add
 * something (between `near` and `exact`) are combined by the AI into one,
 * when an AI is available. Headings, and paragraphs under ~12 words, are
 * never touched.
 */
export async function removeDuplicates(
  markdown: string,
  ask: Ask | null,
  progress: Progress,
  signal?: AbortSignal,
  opts: { exact?: number; near?: number } = {}
): Promise<DedupeResult> {
  const exact = opts.exact ?? 0.9
  const near = opts.near ?? 0.6
  const list = blocks(markdown)
  const keep: Array<string | null> = [...list]
  let removed = 0
  let merged = 0
  const sizable = list.map((b) => !isHeading(b) && words(b).length >= 12 && !/^\s*(```|\|)/.test(b))
  const pairs: Array<[number, number]> = []
  for (let j = 0; j < list.length; j++) {
    if (!sizable[j]) continue
    for (let i = 0; i < j; i++) {
      if (!sizable[i] || keep[i] === null) continue
      const s = similarity(list[i], list[j])
      if (s >= exact) {
        // Keep the longer of the two, where the first one was.
        if (words(list[j]).length > words(keep[i] ?? '').length) keep[i] = list[j]
        keep[j] = null
        removed++
        break
      }
      if (s >= near && ask) {
        pairs.push([i, j])
        break
      }
    }
  }
  for (let k = 0; k < pairs.length; k++) {
    const [i, j] = pairs[k]
    if (keep[i] === null || keep[j] === null) continue
    progress(k, pairs.length, 'Combining overlapping paragraphs')
    try {
      const combined = unwrap(await askOk(ask!, MERGE_SYSTEM, `Paragraph 1:\n${keep[i]}\n\nParagraph 2:\n${keep[j]}`, signal))
      // A sanity check: the answer must still be about the same thing.
      if (similarity(combined, `${keep[i]}\n${keep[j]}`) > 0.3) {
        keep[i] = combined
        keep[j] = null
        merged++
      }
    } catch (e) {
      if (e instanceof Cancelled) throw e
    }
  }
  progress(pairs.length, pairs.length, 'Done')
  return { text: keep.filter((b): b is string => b !== null).join('\n\n') + (markdown.endsWith('\n') ? '\n' : ''), removed, merged }
}

/* ------------------------------------------------------------ website */

export interface Page {
  url: string
  title: string
  markdown: string
}

export type FetchPage = (url: string) => Promise<{ ok: boolean; html?: string; url?: string; type?: string; error?: string }>

const SKIP = /\.(png|jpe?g|gif|webp|svg|ico|pdf|zip|gz|tar|mp[34]|mov|avi|woff2?|ttf|css|js|json|xml|rss|exe|dmg|msi)(\?|#|$)/i

/** Links on a page that stay inside the start address's site and folder. */
export function siteLinks(html: string, base: string, scope: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const out = new Set<string>()
  for (const a of doc.querySelectorAll('a[href]')) {
    try {
      const u = new URL(a.getAttribute('href') ?? '', base)
      u.hash = ''
      if (!/^https?:$/.test(u.protocol) || SKIP.test(u.pathname)) continue
      const s = u.toString()
      if (s.startsWith(scope)) out.add(s)
    } catch {
      /* not a link */
    }
  }
  return [...out]
}

/** The readable part of a page: <main> or <article> when there is one, without menus and footers. */
export function readable(html: string): { title: string; html: string } {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  // The page's own title first: a page's first <h1> is sometimes an example in its text.
  const title = (doc.title?.trim() || doc.querySelector('h1')?.textContent || '').trim().replace(/\s+/g, ' ')
  doc.querySelectorAll('script, style, noscript, nav, header, footer, aside, form, iframe, svg, [role="navigation"], [aria-hidden="true"], .sidebar, .toc, .breadcrumb, .breadcrumbs').forEach((n) => n.remove())
  const main = doc.querySelector('main, article, [role="main"], #content, .content, .markdown-body') ?? doc.body
  return { title, html: main?.innerHTML ?? '' }
}

/** robots.txt "Disallow" rules for every crawler (User-agent: *). */
export function robotsRules(text: string): string[] {
  const rules: string[] = []
  let applies = false
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*/, '').trim()
    const m = line.match(/^([\w-]+)\s*:\s*(.*)$/)
    if (!m) continue
    const [, key, value] = m
    if (/^user-agent$/i.test(key)) applies = value.trim() === '*'
    else if (applies && /^disallow$/i.test(key) && value.trim()) rules.push(value.trim())
  }
  return rules
}

/**
 * Reads a website into pages: the start page, then the pages it links to on
 * the same site and under the same folder, breadth first, up to `limit`
 * pages. Polite: obeys robots.txt and waits between requests.
 */
export async function crawlSite(
  start: string,
  fetchPage: FetchPage,
  toMarkdown: (html: string) => string,
  progress: Progress,
  signal?: AbortSignal,
  limit = 100,
  pause = 400
): Promise<Page[]> {
  const first = new URL(start)
  first.hash = ''
  const folder = first.pathname.endsWith('/') ? first.pathname : first.pathname.replace(/[^/]*$/, '')
  const scope = `${first.origin}${folder}`
  let disallow: string[] = []
  try {
    const r = await fetchPage(`${first.origin}/robots.txt`)
    if (r.ok && r.html) disallow = robotsRules(r.html)
  } catch {
    /* no robots.txt */
  }
  const allowed = (u: string): boolean => !disallow.some((d) => new URL(u).pathname.startsWith(d))
  const queue = [first.toString()]
  const seen = new Set(queue)
  const pages: Page[] = []
  while (queue.length && pages.length < limit) {
    check(signal)
    const url = queue.shift()!
    if (!allowed(url)) continue
    progress(pages.length, Math.min(limit, pages.length + queue.length + 1), url)
    const r = await fetchPage(url).catch((e: Error) => ({ ok: false as const, error: e.message }))
    if (!r.ok || !r.html || (r.type && !/html/i.test(r.type))) {
      if (!pages.length && queue.length === 0) throw new Error(r.error ?? 'The page could not be read.')
      continue
    }
    const { title, html } = readable(r.html)
    const md = toMarkdown(html).trim()
    if (md.length > 80) pages.push({ url: r.url ?? url, title: title || url, markdown: md })
    for (const link of siteLinks(r.html, r.url ?? url, scope)) {
      if (!seen.has(link)) {
        seen.add(link)
        queue.push(link)
      }
    }
    if (queue.length) await new Promise((res) => setTimeout(res, pause))
  }
  progress(pages.length, pages.length, 'Done')
  return pages
}

/** One document from the pages, each its own chapter, with its address. */
export function siteDocument(start: string, pages: Page[], overview = ''): string {
  const host = new URL(start).host
  const shift = (md: string): string =>
    md
      .split('\n')
      .map((l) => (/^#{1,5}\s/.test(l) ? `#${l}` : l))
      .join('\n')
  const body = pages
    .map((p) => {
      const md = p.markdown.replace(/^#\s+.*\n+/, '')
      return `## ${p.title}\n\n_Source: <${p.url}>_\n\n${shift(md)}`
    })
    .join('\n\n')
  return `# ${host}: documentation\n\n_${pages.length} page${pages.length === 1 ? '' : 's'} from <${start}>, read on ${new Date().toLocaleDateString()}._\n\n${overview ? `${overview}\n\n` : ''}${TOC}\n\n${body}\n`
}

const OVERVIEW_SYSTEM = `You write the overview at the top of documentation compiled from a website.
Use ONLY the page summaries given. Reply in Markdown, under 250 words: a short paragraph on what the site covers, then "**Where to find things**" with one bullet per main topic naming the page title it is on. No preamble.`

export async function siteOverview(pages: Page[], ask: Ask, signal?: AbortSignal): Promise<string> {
  const list = pages.map((p, i) => `${i + 1}. ${p.title}: ${plainText(p.markdown).slice(0, 300)}`).join('\n')
  return `## Overview\n\n${unwrap(await askOk(ask, OVERVIEW_SYSTEM, clip(list, 14000), signal))}`
}

/* ------------------------------------------------------------ project folder */

export interface ProjectFile {
  path: string
  text: string
}

const FILE_SYSTEM = `You document source files for a project guide. For EACH file given, write:
### <its path>
then 1 to 3 sentences on what it does and the main things it exports or defines.
Use only the code shown. Be factual and brief. No preamble.`

const GUIDE_SYSTEM = `You write a project guide (README-style documentation) from notes on each file of a project.
Use ONLY the notes and the file list given; never invent commands, settings or features that are not in them.
Reply in Markdown with these sections:
## Overview (what the project is and does)
## How it is organised (the main folders and what lives in each)
## Getting started (how to install, build and run it, only if the notes show how; otherwise say it is not documented)
## Key parts (the most important files or modules and how they fit together)
No preamble.`

/** Files most worth reading first: docs and manifests, then source, smaller first. */
export function rankFiles(files: ProjectFile[]): ProjectFile[] {
  const score = (p: string): number =>
    /(^|\/)(readme|package\.json|pyproject\.toml|cargo\.toml|go\.mod|pom\.xml|requirements\.txt|makefile|dockerfile)/i.test(p)
      ? 0
      : /\.(md|txt)$/i.test(p)
        ? 1
        : /(^|\/)(src|lib|app)\//.test(p)
          ? 2
          : 3
  return [...files].sort((a, b) => score(a.path) - score(b.path) || a.text.length - b.text.length)
}

export async function projectGuide(
  name: string,
  files: ProjectFile[],
  ask: Ask,
  progress: Progress,
  signal?: AbortSignal,
  maxFiles = 80
): Promise<string> {
  const chosen = rankFiles(files).slice(0, maxFiles)
  // Several small files per request; large ones clipped.
  const batches: ProjectFile[][] = []
  let cur: ProjectFile[] = []
  let size = 0
  for (const f of chosen) {
    const t = clip(f.text, 6000)
    if (cur.length && size + t.length > 10000) {
      batches.push(cur)
      cur = []
      size = 0
    }
    cur.push({ path: f.path, text: t })
    size += t.length
  }
  if (cur.length) batches.push(cur)
  const notes: string[] = []
  for (let i = 0; i < batches.length; i++) {
    progress(i, batches.length + 1, batches[i].map((f) => f.path).join(', ').slice(0, 90))
    const user = batches[i].map((f) => `FILE ${f.path}\n\`\`\`\n${f.text}\n\`\`\``).join('\n\n')
    try {
      notes.push(unwrap(await askOk(ask, FILE_SYSTEM, user, signal)))
    } catch (e) {
      if (e instanceof Cancelled) throw e
      notes.push(batches[i].map((f) => `### ${f.path}\n_Not described: ${(e as Error).message}_`).join('\n\n'))
    }
  }
  progress(batches.length, batches.length + 1, 'Writing the guide')
  const tree = files.map((f) => f.path).sort().slice(0, 400).join('\n')
  const guide = unwrap(await askOk(ask, GUIDE_SYSTEM, clip(`PROJECT: ${name}\n\nFILES:\n${tree}\n\nNOTES:\n${notes.join('\n\n')}`, 24000), signal))
  progress(batches.length + 1, batches.length + 1, 'Done')
  const skipped = files.length - chosen.length
  return `# ${name}: project guide\n\n_Made with AI from ${chosen.length} file${chosen.length === 1 ? '' : 's'}${skipped > 0 ? ` (${skipped} more not read)` : ''} on ${new Date().toLocaleDateString()}. Check commands before relying on them._\n\n${TOC}\n\n${guide}\n\n## File by file\n\n${notes.join('\n\n')}\n`
}

/** Which files in a folder are worth reading as text. */
export const PROJECT_SKIP_DIRS = /(^|\/)(node_modules|\.git|\.hg|\.svn|dist|build|out|target|bin|obj|\.next|\.nuxt|\.venv|venv|__pycache__|\.idea|\.vscode|coverage|vendor|release|\.cache)(\/|$)/i
export const PROJECT_TEXT_FILES = /\.(md|txt|rst|json|ya?ml|toml|ini|cfg|xml|html?|css|scss|less|js|jsx|mjs|cjs|ts|tsx|vue|svelte|py|rb|php|java|kt|kts|scala|go|rs|c|h|cc|cpp|hpp|cs|fs|swift|m|mm|sh|ps1|bat|cmd|sql|graphql|proto|gradle|r|lua|dart|ex|exs|erl|clj|hs|ml|pl|tf|dockerfile|makefile)$|(^|\/)(dockerfile|makefile|license|readme)$/i
export const PROJECT_LIMITS = { files: 400, fileBytes: 200_000, totalBytes: 4_000_000 }
