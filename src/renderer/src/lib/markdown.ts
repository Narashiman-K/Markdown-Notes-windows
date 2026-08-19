import MarkdownIt from 'markdown-it'
// The "common" bundle registers ~40 widely used languages instead of all 190+,
// which cuts several megabytes from the renderer bundle. Unknown languages
// still render as plain code blocks.
import hljs from 'highlight.js/lib/common'
import DOMPurify from 'dompurify'
import taskLists from 'markdown-it-task-lists'
import footnote from 'markdown-it-footnote'
import deflist from 'markdown-it-deflist'

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

const PURIFY_CONFIG = {
  ADD_TAGS: ['mark', 'ins', 'del', 'kbd', 'abbr', 'sub', 'sup', 'details', 'summary'],
  ADD_ATTR: ['target', 'rel', 'align', 'colspan', 'rowspan', 'id', 'class', 'start', 'checked', 'disabled', 'type'],
  ALLOW_DATA_ATTR: true
}

export function renderMarkdown(source: string): string {
  return DOMPurify.sanitize(md.render(source), PURIFY_CONFIG) as unknown as string
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

/** Wraps rendered HTML into a standalone document used for print / export. */
export function standaloneHtml(title: string, bodyHtml: string, css: string, forPrint: boolean): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>${title.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</title>
<style>${css}</style>
${forPrint ? '<style>@page { margin: 18mm 16mm; } body { background: #fff; }</style>' : ''}
</head>
<body class="mn-standalone"><article class="markdown-body">${bodyHtml}</article></body></html>`
}
