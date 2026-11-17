/**
 * Tables of contents.
 *
 * Insert → Table of contents writes a list of links to the document's
 * headings between two invisible markers:
 *
 *   <!-- toc -->
 *   - [Introduction](#introduction)
 *     - [Background](#background)
 *   <!-- /toc -->
 *
 * The markers let the app rebuild the list whenever the headings change (on
 * leaving Edit and on saving), and any other Markdown app still shows a
 * normal list of links.
 *
 * Also here: bringing older converted files up to date. Before 1.3 a converted
 * PDF had a big "## Page 3" heading at the top of every page; now the number
 * sits small and grey at the page's foot, like a footer, and contents links
 * work.
 *
 * Kept identical to the copy in the Windows app. Change one, copy it across.
 */
import { extractHeadings } from './markdown'
import { pageBreakLine, pageNumberLine } from './convert/pageNotes'
import { tidyContents } from './convert/contents'

export const TOC_START = '<!-- toc -->'
export const TOC_END = '<!-- /toc -->'
const TOC_BLOCK = /<!-- toc -->\n[\s\S]*?<!-- \/toc -->/

const plain = (t: string): string =>
  t
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .trim()

/** The list of links to the headings (without the document's title). */
export function tocList(markdown: string): string {
  // Headings inside an existing contents block are not part of it.
  const heads = extractHeadings(markdown.replace(TOC_BLOCK, ''))
  // The first top-level heading is the document's title, not a section.
  const all = heads[0]?.level === 1 && heads.filter((h) => h.level === 1).length === 1 ? heads.slice(1) : heads
  // The contents' own heading ("Table of Contents") is not an entry in it.
  const list = all.filter((h) => !CONTENTS_TITLE.test(plain(h.text)))
  if (!list.length) return '_No headings yet: add some (Insert → Heading) and this list fills itself in._'
  const top = Math.min(...list.map((h) => h.level))
  return list
    .filter((h) => h.level - top < 3)
    .map((h) => `${'  '.repeat(h.level - top)}- [${plain(h.text).replace(/([[\]\\])/g, '\\$1')}](#${h.slug})`)
    .join('\n')
}

/** A whole contents block, ready to insert. */
export function tocBlock(markdown: string): string {
  return `${TOC_START}\n${tocList(markdown)}\n${TOC_END}`
}

export function hasToc(markdown: string): boolean {
  return TOC_BLOCK.test(markdown)
}

/** The document with its contents block rebuilt from the current headings. */
export function refreshToc(markdown: string): string {
  if (!hasToc(markdown)) return markdown
  return markdown.replace(TOC_BLOCK, () => tocBlock(markdown))
}

/** A heading that names a contents list. */
const CONTENTS_TITLE = /^(table of contents|contents|index)$/i
/** Lines inside a contents section that are not part of the list: page notes and markers. */
const KEEP_IN_SECTION = /^(\s*|<!--[\s\S]*-->|— \d+ —)$/

/**
 * The book's own contents section: a "Table of Contents" (or "Contents")
 * heading and everything up to the next heading, when it holds at least two
 * list entries or links. A converted PDF has one like this.
 */
function contentsSection(lines: string[]): { head: number; end: number } | null {
  let fence = false
  let inBlock = false
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (/^\s*(```|~~~)/.test(l)) fence = !fence
    if (l.trim() === TOC_START) inBlock = true
    if (l.trim() === TOC_END) inBlock = false
    if (fence || inBlock) continue
    const m = l.match(/^#{1,6}\s+(.+?)\s*#*\s*$/)
    if (!m || !CONTENTS_TITLE.test(plain(m[1]))) continue
    let end = i + 1
    while (end < lines.length && !/^#{1,6}\s/.test(lines[end])) end++
    const entries = lines.slice(i + 1, end).filter((x) => /^\s*([-*+]|\d+\.)\s|\]\(#/.test(x)).length
    if (entries >= 2) return { head: i, end }
  }
  return null
}

/**
 * Creates or updates the table of contents, never adding a second one:
 *
 *  1. The book already has a contents section ("Table of Contents" heading):
 *     its list is replaced by the live one, in the same place. Page numbers
 *     and page breaks inside it stay. A contents block put elsewhere earlier
 *     is removed, so there is only ever one.
 *  2. Otherwise a contents block that already exists is updated where it is.
 *  3. Otherwise a new one goes just before the first chapter or introduction:
 *     the first heading after the title (front matter such as a title page
 *     stays above it).
 */
export function placeToc(markdown: string): { text: string; updated: boolean; where: 'section' | 'block' | 'new' } {
  const section = contentsSection(markdown.split('\n'))
  if (section) {
    // Take out a contents block that sits outside the book's own section.
    let lines = markdown.split('\n')
    const s = lines.findIndex((l) => l.trim() === TOC_START)
    const e = lines.findIndex((l, i) => i > s && l.trim() === TOC_END)
    if (s >= 0 && e > s && (s < section.head || s > section.end)) {
      lines = [...lines.slice(0, s), ...lines.slice(e + 1)]
      while (s > 0 && s < lines.length && !lines[s - 1].trim() && !lines[s].trim()) lines.splice(s, 1)
    }
    const sec = contentsSection(lines)!
    // The page notes inside the old list (page numbers, page breaks) stay, in order.
    const notes = lines
      .slice(sec.head + 1, sec.end)
      .map((l) => l.trim())
      .filter((l) => l && KEEP_IN_SECTION.test(l) && l !== TOC_START && l !== TOC_END)
    const block = tocBlock(lines.join('\n'))
    const middle = [block, ...notes].join('\n\n')
    const before = lines.slice(0, sec.head + 1).join('\n')
    const after = lines.slice(sec.end).join('\n')
    return { text: `${before}\n\n${middle}\n\n${after}`.replace(/\n{3,}/g, '\n\n'), updated: true, where: 'section' }
  }
  if (hasToc(markdown)) return { text: refreshToc(markdown), updated: true, where: 'block' }

  const lines = markdown.split('\n')
  let fence = false
  const heads: number[] = []
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence
    if (!fence && /^#{1,6}\s/.test(l)) heads.push(i)
  })
  const titleIsFirst = heads.length && /^#\s/.test(lines[heads[0]])
  let at = titleIsFirst ? (heads[1] ?? heads[0] + 1) : (heads[0] ?? 0)
  if (heads.length === 0) at = 0
  const block = tocBlock(markdown)
  const before = lines.slice(0, at).join('\n').replace(/\s+$/, '')
  const after = lines.slice(at).join('\n').replace(/^\s+/, '')
  return { text: `${before ? `${before}\n\n` : ''}${block}\n\n${after}`, updated: false, where: 'new' }
}

/* ------------------------------------------------- older converted files */

const OLD_PAGE_HEADING = /^## Page (\d{1,5})\s*$/
const BREAK = /^<!-- suprasuta:page-break(?: page="\d+")? -->\s*$/

/** Whether a file still has the old big "## Page N" headings from conversion. */
export function hasOldPageHeadings(markdown: string): boolean {
  return (markdown.match(/^## Page \d{1,5}\s*$/gm) ?? []).length >= 2
}

/**
 * Turns the old "## Page N" headings into the new page notes: the number at
 * the foot of each page, and breaks that know which page follows, so contents
 * links can open it. A run-on contents paragraph is also split into entries
 * linked to their chapters.
 */
export function upgradeOldPages(markdown: string): string {
  const lines = markdown.split('\n')
  const out: string[] = []
  let current: number | null = null
  let fence = false
  const footer = (): void => {
    if (current === null) return
    while (out.length && !out[out.length - 1].trim()) out.pop()
    // The footer goes before the break that ended this page.
    let at = out.length
    if (at && BREAK.test(out[at - 1])) {
      at--
      while (at && !out[at - 1].trim()) at--
    }
    out.splice(at, 0, '', pageNumberLine(current), '')
  }
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    const m = fence ? null : OLD_PAGE_HEADING.exec(line)
    if (!m) {
      out.push(line)
      continue
    }
    const n = Number(m[1])
    footer()
    // Give the break before this page its number.
    for (let i = out.length - 1; i >= 0 && i >= out.length - 6; i--) {
      if (BREAK.test(out[i])) {
        out[i] = pageBreakLine(n)
        break
      }
    }
    current = n
  }
  footer()
  return tidyContents(out.join('\n').replace(/\n{3,}/g, '\n\n'))
}
