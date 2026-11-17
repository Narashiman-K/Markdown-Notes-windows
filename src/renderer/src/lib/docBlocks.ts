/**
 * The Doc Editor's view of a document: Markdown cut into blocks.
 *
 * The Doc Editor lets the reader write as in a word processor while the file
 * stays Markdown. To make that safe it never rewrites the whole document:
 * the text is cut into blocks (a paragraph, a heading, a list, a quote…) and
 * only a block the reader actually changed is turned back into Markdown and
 * put in place of its own lines. Everything else stays byte for byte.
 *
 * Some blocks are "kept safe": shown but not typed into, because a slip would
 * break them. The contents list (it rebuilds itself), page numbers and page
 * breaks, diagrams and code (edited as text in a small window), tables (the
 * table editor), and raw HTML.
 */
import MarkdownIt from 'markdown-it'
import TurndownService from 'turndown'
// The GFM plugin ships without types.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { gfm } from 'turndown-plugin-gfm'

export type BlockKind = 'text' | 'heading' | 'list' | 'quote' | 'code' | 'mermaid' | 'table' | 'toc' | 'page' | 'rule' | 'html' | 'image'

export interface DocBlock {
  kind: BlockKind
  /** 0-based source lines [start, end). */
  start: number
  end: number
  /** The block's own Markdown. */
  text: string
}

const md = new MarkdownIt({ html: true })

/** Kinds the reader types into directly. */
export const EDITABLE: ReadonlySet<BlockKind> = new Set(['text', 'heading', 'list', 'quote'])

const PAGE_LINE = /^(— \d+ —|<!--\s*suprasuta:[\s\S]*?-->)\s*$/

export function splitBlocks(markdown: string): DocBlock[] {
  const lines = markdown.split('\n')
  const tokens = md.parse(markdown, {})
  const blocks: DocBlock[] = []
  let tocUntil = -1
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.level !== 0 || !t.map || t.nesting === -1) continue
    const [start, end] = t.map
    if (start < tocUntil) continue
    const text = lines.slice(start, end).join('\n')
    let kind: BlockKind
    switch (t.type) {
      case 'heading_open':
        kind = 'heading'
        break
      case 'paragraph_open':
        // A paragraph with a picture is kept as it is: its file address must not change.
        kind = PAGE_LINE.test(text.trim()) ? 'page' : /!\[[^\]]*\]\(/.test(text) || /<img\b/i.test(text) ? 'image' : 'text'
        break
      case 'bullet_list_open':
      case 'ordered_list_open':
        kind = 'list'
        break
      case 'blockquote_open':
        kind = 'quote'
        break
      case 'fence':
        kind = t.info.trim().split(/\s+/)[0].toLowerCase() === 'mermaid' ? 'mermaid' : 'code'
        break
      case 'code_block':
        kind = 'code'
        break
      case 'table_open':
        kind = 'table'
        break
      case 'hr':
        kind = 'rule'
        break
      case 'html_block': {
        if (text.trim().startsWith('<!-- toc -->')) {
          // The whole contents list, markers and all, is one block.
          const close = lines.findIndex((l, k) => k >= start && l.trim() === '<!-- /toc -->')
          const to = close >= 0 ? close + 1 : end
          blocks.push({ kind: 'toc', start, end: to, text: lines.slice(start, to).join('\n') })
          tocUntil = to
          continue
        }
        kind = PAGE_LINE.test(text.trim()) ? 'page' : 'html'
        break
      }
      default:
        continue
    }
    blocks.push({ kind, start, end, text })
  }
  return blocks
}

/* --------------------------------------------------- HTML → Markdown */

let service: TurndownService | null = null

function turndown(): TurndownService {
  if (service) return service
  const td = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined'
  })
  td.use(gfm)
  // Highlights, underlines and comments are the app's own HTML: kept exactly.
  td.keep((node) => (node as Element).classList?.contains('mn-a') === true)
  // Underline typed with Ctrl+U has no Markdown form: kept as HTML.
  td.keep(['u'])
  td.remove(['script', 'style'])
  // Strikethrough as ~~text~~ (the GFM plugin writes one ~, which this app's
  // Markdown does not read as strikethrough).
  td.addRule('strike', {
    filter: ['del', 's', 'strike'] as unknown as TurndownService.Filter,
    replacement: (content) => (content.trim() ? `~~${content}~~` : '')
  })
  // "- item", not Turndown's "-   item": the way people (and this app) write lists.
  td.addRule('listItem', {
    filter: 'li',
    replacement: (content, node, options) => {
      const parent = node.parentNode as HTMLElement | null
      let prefix = `${options.bulletListMarker} `
      if (parent?.nodeName === 'OL') {
        const start = Number(parent.getAttribute('start') ?? 1)
        prefix = `${start + Array.prototype.indexOf.call(parent.children, node)}. `
      }
      const body = content.replace(/^\n+/, '').replace(/\n+$/, '\n').replace(/\n/gm, `\n${' '.repeat(prefix.length)}`)
      return prefix + body + (node.nextSibling && !/\n$/.test(body) ? '\n' : '')
    }
  })
  service = td
  return td
}

/** Markdown for an edited block's HTML. */
export function blockToMarkdown(html: string): string {
  const out = turndown()
    .turndown(html)
    // A browser adds a lone <br> to an emptied line.
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return out
}

/**
 * The document with one block replaced. An emptied block disappears; one that
 * became several paragraphs keeps a blank line between them and its
 * neighbours.
 */
export function replaceBlock(markdown: string, b: DocBlock, next: string): string {
  const lines = markdown.split('\n')
  const before = lines.slice(0, b.start)
  const after = lines.slice(b.end)
  if (!next.trim()) {
    // Remove the block and one of the blank lines around it.
    if (after.length && !after[0].trim() && (!before.length || !before[before.length - 1].trim())) after.shift()
    return [...before, ...after].join('\n')
  }
  return [...before, ...next.split('\n'), ...after].join('\n')
}

/** The document with new Markdown blocks after a block (or at the end). */
export function insertAfter(markdown: string, b: DocBlock | null, block: string): string {
  const lines = markdown.split('\n')
  const at = b ? b.end : lines.length
  const before = lines.slice(0, at).join('\n').replace(/\s+$/, '')
  const after = lines.slice(at).join('\n').replace(/^\s+/, '')
  return `${before}${before ? '\n\n' : ''}${block}\n${after ? `\n${after}` : ''}`
}

/* --------------------------------------------------- paragraph styles */

export type Style = 'p' | 'h1' | 'h2' | 'h3' | 'ul' | 'ol' | 'quote' | 'indent' | 'outdent'

const HEAD = /^#{1,6}\s+/
const QUOTE = /^>\s?/
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+/

/** A line's words without its heading, quote or list marker. */
const bare = (l: string): string => l.replace(QUOTE, '').replace(HEAD, '').replace(ITEM, '').replace(/^\[[ xX]\]\s+/, '').trim()

/**
 * A block in another paragraph style, written as Markdown directly (the way
 * a word processor applies a style to the paragraph the caret is in).
 * Bullets, numbers and quote toggle off when the block already has them.
 * Indent and outdent move the list item `item` (0-based) and what belongs to it.
 */
export function restyle(text: string, style: Style, item = 0): string {
  const lines = text.split('\n')
  const content = lines.map(bare).filter(Boolean)
  const isList = (re: RegExp): boolean => lines.filter((l) => l.trim()).every((l) => re.test(l) || /^\s+\S/.test(l))
  switch (style) {
    case 'p':
      return content.join('\n\n')
    case 'h1':
    case 'h2':
    case 'h3':
      return `${'#'.repeat(Number(style[1]))} ${content.join(' ')}`
    case 'ul':
      if (isList(/^\s*[-*+]\s/)) return content.join('\n\n')
      return content.map((c) => `- ${c}`).join('\n')
    case 'ol':
      if (isList(/^\s*\d+[.)]\s/)) return content.join('\n\n')
      return content.map((c, i) => `${i + 1}. ${c}`).join('\n')
    case 'quote':
      if (lines.filter((l) => l.trim()).every((l) => QUOTE.test(l))) return lines.map((l) => l.replace(QUOTE, '')).join('\n')
      return lines.map((l) => (l.trim() ? `> ${l}` : '>')).join('\n')
    case 'indent':
    case 'outdent': {
      // Only lists indent; the k-th item and its own lines below it.
      const starts = lines.map((l, i) => (ITEM.test(l) ? i : -1)).filter((i) => i >= 0)
      if (!starts.length) return text
      const from = starts[Math.min(item, starts.length - 1)]
      let to = from + 1
      const own = (lines[from].match(/^\s*/) ?? [''])[0].length
      while (to < lines.length && lines[to].trim() && (lines[to].match(/^\s*/) ?? [''])[0].length > own) to++
      return lines
        .map((l, i) => {
          if (i < from || i >= to) return l
          if (style === 'indent') return `  ${l}`
          return l.replace(/^ {1,2}/, '')
        })
        .join('\n')
    }
  }
}

export const TEMPLATES = {
  code: '```\ncode\n```',
  table: '| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |',
  rule: '---',
  paragraph: 'New paragraph.'
} as const
