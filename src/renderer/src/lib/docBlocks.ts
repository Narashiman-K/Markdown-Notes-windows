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

export const TEMPLATES = {
  code: '```\ncode\n```',
  table: '| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |',
  rule: '---',
  paragraph: 'New paragraph.'
} as const
