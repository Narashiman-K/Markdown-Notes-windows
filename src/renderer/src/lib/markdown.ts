import MarkdownIt from 'markdown-it'
// The "common" bundle registers ~40 widely used languages instead of all 190+,
// which cuts several megabytes from the renderer bundle. Unknown languages
// still render as plain code blocks.
import hljs from 'highlight.js/lib/common'
import DOMPurify from 'dompurify'
import taskLists from 'markdown-it-task-lists'
import footnote from 'markdown-it-footnote'
import deflist from 'markdown-it-deflist'
import { pagesPlugin, type PageSize } from './pages'

/**
 * IMPORTANT: typographer / linkify / smartquotes stay OFF so that the rendered
 * text remains a character-for-character subsequence of the source. The
 * annotation source-mapper depends on that property.
 */
export const md: MarkdownIt = new MarkdownIt({
  html: true,
  xhtmlOut: false,
  breaks: false,
  linkify: false,
  typographer: false,
  highlight(str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`
      } catch {
        /* fall through */
      }
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`
  }
})
  .use(taskLists, { enabled: true, label: true })
  .use(footnote)
  .use(deflist)
  .use(pagesPlugin)

/*
 * Stamps each block element with the source line it came from.
 *
 * This is what lets the preview and the editor scroll together: given a line
 * the editor is showing, the preview can find the element that came from it,
 * and the reverse. markdown-it already tracks `token.map` for block tokens, so
 * nothing has to be inferred.
 *
 * Opt-in through the render environment rather than always on, because the
 * same renderer produces exported and printed HTML, and line numbers from a
 * document the reader never sees have no business being in the output.
 *
 * Only top-level tokens are walked. Inline content lives inside `inline`
 * tokens and has no map of its own, and line-level precision is all scroll
 * syncing can use anyway.
 */
md.core.ruler.push('suprasuta_source_lines', (state) => {
  if (!(state.env as { sourceLines?: boolean } | undefined)?.sourceLines) return
  for (const token of state.tokens) {
    // nesting 1 is an opening tag, 0 is self-closing; -1 is a closing tag and
    // carries no attributes of its own.
    if (token.map && token.nesting >= 0) token.attrSet('data-line', String(token.map[0]))
  }
})

/*
 * Fences need the attribute putting back by hand.
 *
 * When the `highlight` option returns a string that already starts with
 * `<pre`, markdown-it uses it verbatim and never calls renderAttrs — so the
 * data-line set above is silently dropped for exactly the tallest element on
 * the page. A code block with no anchor is the worst case for scroll syncing,
 * because the panes can be a whole screen apart before the next anchor
 * appears. Indented code blocks are unaffected; their renderer does call
 * renderAttrs.
 */
const defaultFence = md.renderer.rules.fence
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const html = defaultFence
    ? defaultFence(tokens, idx, options, env, self)
    : self.renderToken(tokens, idx, options)
  const line = tokens[idx].attrGet('data-line')
  return line ? html.replace(/^<pre/, `<pre data-line="${line}"`) : html
}

export interface Heading {
  level: number
  text: string
  slug: string
}

export function slugify(text: string, used: Set<string>): string {
  const base =
    text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-') || 'section'
  let slug = base
  let i = 2
  while (used.has(slug)) slug = `${base}-${i++}`
  used.add(slug)
  return slug
}

/** Adds stable ids to headings so the outline panel can scroll to them. */
md.core.ruler.push('mn_heading_ids', (state) => {
  const used = new Set<string>()
  const tokens = state.tokens
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'heading_open') continue
    const inline = tokens[i + 1]
    const text = inline && inline.type === 'inline' ? inline.content.replace(/<[^>]+>/g, '') : ''
    tokens[i].attrSet('id', slugify(text, used))
  }
  return true
})

/*
 * `file:` URLs, so that a local image actually appears.
 *
 * Insert > Image writes the picture's real path, which on Windows comes out as
 * `![alt](file:///C:/Users/...)`. That was showing up in the viewer as literal
 * text, because two independent gates rejected it:
 *
 *   1. markdown-it's default `validateLink` blocks `file:` alongside
 *      `javascript:` and `vbscript:`. A rejected link is not an error — the
 *      image token is simply never created and the source falls through as
 *      plain text, which is exactly what was on screen.
 *   2. DOMPurify's default `ALLOWED_URI_REGEXP` admits only http(s), ftp(s),
 *      mailto, tel, callto, sms, cid and xmpp, so even once markdown-it
 *      emitted an `<img>`, the sanitiser stripped its src.
 *
 * Both had to open. The scheme list below is DOMPurify's own default with
 * `file` added and nothing removed, so every other protocol is judged exactly
 * as before.
 *
 * The web build cannot load `file:` at all — a page served over http has no
 * access to the disk, and the browser blocks it whatever this says — so both
 * builds keep the identical rule rather than diverging over something with no
 * effect in one of them.
 *
 * Images only. A `file:` *link* is a different proposition: a click would hand
 * an arbitrary local path to the shell, and a document can come from anywhere.
 * The hook below drops `href` from anchors pointing at one, which also covers
 * `file:` anchors written as raw HTML rather than as markdown.
 */
const defaultValidateLink = md.validateLink.bind(md)
md.validateLink = (url: string): boolean =>
  /^file:\/\//i.test(url.trim()) || defaultValidateLink(url)

const URI_ALLOWED =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|file):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i

/*
 * Installed on first render, not at module load.
 *
 * DOMPurify only has its full API when a window exists. Under plain Node — the
 * unit tests that import this file for its parsing helpers, without ever
 * rendering — the default export is a stub with no `addHook`, and calling it at
 * module scope threw on import and took the whole test file down with it.
 * Nothing that renders can reach `sanitize` without passing through here first,
 * so deferring the hook loses no coverage.
 */
let fileLinkHookInstalled = false
function installFileLinkHook(): void {
  if (fileLinkHookInstalled) return
  fileLinkHookInstalled = true
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    const el = node as unknown as Element
    if (el.tagName !== 'A') return
    if (/^\s*file:/i.test(el.getAttribute('href') ?? '')) el.removeAttribute('href')
  })
}

const PURIFY_CONFIG = {
  ADD_TAGS: ['mark', 'ins', 'del', 'kbd', 'abbr', 'sub', 'sup', 'details', 'summary'],
  ADD_ATTR: ['target', 'rel', 'align', 'colspan', 'rowspan', 'id', 'class', 'start', 'checked', 'disabled', 'type'],
  ALLOW_DATA_ATTR: true,
  ALLOWED_URI_REGEXP: URI_ALLOWED
}

/*
 * How a local image is loaded when the document is shown on screen.
 *
 * A `file:` image can only load into a page that is itself on `file:`.
 * Chromium refuses it from an `http:` page whatever the CSP says, and the
 * desktop app's development build serves its window from Vite over http. So
 * Insert > Image showed a broken picture in the viewer while print preview,
 * rendered from a temporary file, showed it correctly. The installed app only
 * worked because it happens to load from `file:` — a privilege the planned
 * Electron hardening removes.
 *
 * The desktop build therefore registers a resolver that rewrites such sources
 * to its own `mn-local:` scheme, served by the main process and limited to
 * image files. It applies only to on-screen rendering (`screen: true`):
 * exported and printed HTML keep the real `file:` path, which is correct for
 * a file opened from disk. The web build registers nothing, so there it is a
 * no-op.
 */
let localImageResolver: ((fileUrl: string) => string) | null = null

export function setLocalImageResolver(resolver: ((fileUrl: string) => string) | null): void {
  localImageResolver = resolver
}

export function renderMarkdown(
  source: string,
  options?: { sourceLines?: boolean; screen?: boolean; pages?: boolean }
): string {
  // `pages`: each original page in a sheet of its own (see lib/pages.ts).
  const html = md.render(source, { sourceLines: options?.sourceLines === true, pages: options?.pages === true })
  installFileLinkHook()
  const clean = DOMPurify.sanitize(html, PURIFY_CONFIG) as unknown as string
  const resolve = options?.screen ? localImageResolver : null
  if (!resolve) return clean
  // DOMPurify serialises every attribute double-quoted, so this pattern sees
  // all of them. The replacement is URL-encoded by the resolver, so it can
  // never close the attribute early.
  return clean.replace(/(<img\b[^>]*?\ssrc=")(file:[^"]*)(")/gi, (_m, head: string, url: string, tail: string) =>
    `${head}${resolve(url.replace(/&amp;/g, '&'))}${tail}`
  )
}

export function extractHeadings(source: string): Heading[] {
  const used = new Set<string>()
  const out: Heading[] = []
  const lines = source.split('\n')
  let inFence = false
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (!m) continue
    const text = m[2].replace(/<[^>]+>/g, '').trim()
    out.push({ level: m[1].length, text, slug: slugify(text, used) })
  }
  return out
}

export function documentStats(source: string): { words: number; chars: number; lines: number; readMin: number } {
  const plain = source
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_`~\-|]/g, ' ')
  const words = plain.split(/\s+/).filter(Boolean).length
  return {
    words,
    chars: source.length,
    lines: source.split('\n').length,
    readMin: Math.max(1, Math.round(words / 220))
  }
}

/**
 * Wraps rendered HTML into a standalone document used for print / export.
 *
 * `pageSize`, when the document recorded its original one, makes printing use
 * that paper size; the original's page breaks print as breaks either way.
 */
export function standaloneHtml(title: string, bodyHtml: string, css: string, forPrint: boolean, pageSize?: PageSize | null): string {
  const size = pageSize ? ` size: ${pageSize.width}pt ${pageSize.height}pt;` : ''
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>${title.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</title>
<style>${css}</style>
${forPrint ? `<style>@page {${size} margin: 18mm 16mm; } body { background: #fff; }</style>` : ''}
</head>
<body class="mn-standalone"><article class="markdown-body">${bodyHtml}</article></body></html>`
}
