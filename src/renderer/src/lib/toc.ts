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
  const list = heads[0]?.level === 1 && heads.filter((h) => h.level === 1).length === 1 ? heads.slice(1) : heads
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

/**
 * Adds a contents block at the top of the document, or brings an existing
 * one up to date. "The top" is just under the title (the first # heading)
 * when the document opens with one, otherwise the very start. It never goes
 * where the cursor happens to be: a contents list belongs at the front.
 */
export function placeToc(markdown: string): { text: string; updated: boolean; moved?: boolean } {
  if (hasToc(markdown)) {
    // One put lower down earlier (where the cursor was) moves to the top.
    const at = markdown.search(TOC_BLOCK)
    const before = markdown
      .slice(0, at)
      .replace(/^---\n[\s\S]*?\n---\n/, '')
      .replace(/^\s*#\s[^\n]*\n/, '')
      .trim()
    if (!before) return { text: refreshToc(markdown), updated: true }
    const without = markdown.replace(/\n*<!-- toc -->\n[\s\S]*?<!-- \/toc -->\n*/, '\n\n')
    return { ...placeToc(without), updated: true, moved: true }
  }
  const lines = markdown.split('\n')
  let at = 0
  // Skip YAML front matter.
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
    if (end > 0) at = end + 1
  }
  while (at < lines.length && !lines[at].trim()) at++
  if (/^#\s/.test(lines[at] ?? '')) at++
  const block = tocBlock(markdown)
  const before = lines.slice(0, at).join('\n').replace(/\s+$/, '')
  const after = lines.slice(at).join('\n').replace(/^\s+/, '')
  return { text: `${before ? `${before}\n\n` : ''}${block}\n\n${after}`, updated: false }
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
