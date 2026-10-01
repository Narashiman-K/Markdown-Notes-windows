/**
 * The original document's pages: their size, where each one ended, and for a
 * scanned page, the picture of it.
 *
 * Markdown is flowing text with no idea of a page. A converted PDF records
 * three things invisibly so the viewer can show it on sheets like the
 * original:
 *
 *   <!-- suprasuta:page-size width="595" height="842" -->
 *       once, after the title: the page size in points (1/72 inch), as the
 *       PDF gives it. A4 is 595 × 842.
 *   <!-- suprasuta:page-break -->
 *       where one original page ended and the next began.
 *   ![Original page 2](data:image/jpeg;base64,… "suprasuta:scan")
 *       a scanned page's own picture, kept when the user asks for it.
 *
 * All three are ordinary Markdown, so the file still opens anywhere: another
 * editor shows the comments as nothing and the picture as a picture. They are
 * comments rather than front matter because a merged document holds several
 * converted files, each with its own, and comments can sit anywhere.
 *
 * Rendering: the break becomes a thin divider on screen and a real page break
 * in print. In page view, the renderer wraps each original page in a sheet of
 * the recorded size, and a sheet with a scanned picture shows the picture and
 * its text side by side.
 *
 * Kept identical to the copy in the Windows app. Change one, copy it across.
 */
import type MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'
import { PAGE_BREAK, pageSizeLine as writeSize } from './convert/pageNotes'

export { PAGE_BREAK }
/** The title of a scanned page's own picture; never shown. */
export const SCAN_TITLE = 'suprasuta:scan'

const SIZE_LINE = /<!-- suprasuta:page-size width="(\d+(?:\.\d+)?)" height="(\d+(?:\.\d+)?)" -->/
const BREAK_LINE = /^<!-- suprasuta:page-break -->\s*$/
const SIZE_ONLY = /^<!-- suprasuta:page-size [^>]*-->\s*$/

export interface PageSize {
  /** Points: 1/72 inch. */
  width: number
  height: number
}

export function pageSizeLine(size: PageSize): string {
  return writeSize(size.width, size.height)
}

/** The page size recorded in a document, or null when it has none. */
export function readPageSize(markdown: string): PageSize | null {
  const m = SIZE_LINE.exec(markdown)
  if (!m) return null
  const width = Number(m[1])
  const height = Number(m[2])
  // A size outside what any printer takes is a damaged note, not a page.
  if (!(width >= 72 && width <= 14400 && height >= 72 && height <= 14400)) return null
  return { width, height }
}

const NAMED: Array<[string, number, number]> = [
  ['A3', 842, 1191],
  ['A4', 595, 842],
  ['A5', 420, 595],
  ['Letter', 612, 792],
  ['Legal', 612, 1008]
]

/** "A4", "Letter landscape", or "210 × 99 mm" for anything else. */
export function pageSizeName(size: PageSize): string {
  const near = (a: number, b: number): boolean => Math.abs(a - b) <= 3
  for (const [name, w, h] of NAMED) {
    if (near(size.width, w) && near(size.height, h)) return name
    if (near(size.width, h) && near(size.height, w)) return `${name} landscape`
  }
  const mm = (pt: number): number => Math.round((pt / 72) * 25.4)
  return `${mm(size.width)} × ${mm(size.height)} mm`
}

/** CSS lengths for a sheet, in em so that the viewer's zoom scales them. */
export function sheetStyle(size: PageSize | null): Record<string, string> {
  const s = size ?? { width: 595, height: 842 }
  // 1 pt = 96/72 px, and the document's base size is 16 px.
  return { '--mn-page-w': `${(s.width / 12).toFixed(2)}em`, '--mn-page-h': `${(s.height / 12).toFixed(2)}em` }
}

/* ------------------------------------------------------------- renderer */

function htmlBlock(state: { Token: typeof Token }, html: string): Token {
  const t = new state.Token('html_block', '', 0)
  t.content = html
  return t
}

/** A paragraph holding nothing but a scanned page's picture. */
function isScanParagraph(tokens: Token[], i: number): boolean {
  if (tokens[i]?.type !== 'paragraph_open' || tokens[i + 1]?.type !== 'inline' || tokens[i + 2]?.type !== 'paragraph_close') {
    return false
  }
  const kids = tokens[i + 1].children ?? []
  const images = kids.filter((k) => k.type === 'image')
  const others = kids.filter((k) => k.type !== 'image' && !(k.type === 'text' && !k.content.trim()) && k.type !== 'softbreak')
  return images.length === 1 && others.length === 0 && (images[0].attrGet('class') ?? '').includes('mn-scan')
}

export function pagesPlugin(md: MarkdownIt): void {
  md.core.ruler.push('suprasuta_pages', (state) => {
    const tokens = state.tokens

    // The notes themselves: the size draws nothing, a break draws a divider.
    for (const t of tokens) {
      if (t.type !== 'html_block') continue
      const text = t.content.trim()
      if (SIZE_ONLY.test(text)) t.content = ''
      else if (BREAK_LINE.test(text)) {
        t.content = '<div class="mn-page-break" aria-hidden="true"></div>\n'
        t.meta = { ...(t.meta ?? {}), pageBreak: true }
      }
    }

    // A scanned page's picture loses its marker title, which would otherwise
    // pop up as a tooltip, and gains a class the styles can find.
    for (const t of tokens) {
      if (t.type !== 'inline') continue
      for (const k of t.children ?? []) {
        if (k.type !== 'image' || k.attrGet('title') !== SCAN_TITLE) continue
        const attrs = (k.attrs ?? []).filter(([name]) => name !== 'title')
        k.attrs = attrs
        k.attrJoin('class', 'mn-scan')
      }
    }

    if (!(state.env as { pages?: boolean } | undefined)?.pages) return

    // Page view: each original page becomes a sheet.
    const sheets: Token[][] = [[]]
    for (const t of tokens) {
      if (t.meta?.pageBreak) sheets.push([])
      else sheets[sheets.length - 1].push(t)
    }
    const out: Token[] = []
    sheets.forEach((sheet, n) => {
      if (!sheet.length && n > 0) return
      const at = sheet.findIndex((_, i) => isScanParagraph(sheet, i))
      if (at < 0) {
        out.push(htmlBlock(state, `<section class="mn-sheet">\n`), ...sheet, htmlBlock(state, '</section>\n'))
        return
      }
      // The picture on the left, everything else on the page on the right.
      const scan = sheet.slice(at, at + 3)
      const rest = [...sheet.slice(0, at), ...sheet.slice(at + 3)]
      out.push(
        htmlBlock(state, `<section class="mn-sheet-pair">\n<div class="mn-sheet mn-sheet-original">\n`),
        ...scan,
        htmlBlock(state, `</div>\n<div class="mn-sheet mn-sheet-text">\n`),
        ...rest,
        htmlBlock(state, '</div>\n</section>\n')
      )
    })
    state.tokens = out
  })
}
