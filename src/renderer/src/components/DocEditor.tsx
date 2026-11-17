/**
 * Doc Editor: write as in a word processor; the file stays Markdown.
 *
 * The document is shown formatted, block by block (lib/docBlocks.ts). Text
 * blocks (paragraphs, headings, lists, quotes) are typed into directly, and
 * what is typed is saved into that block's own lines half a second later, so
 * nothing else in the file moves. Blocks a slip could break are "kept safe":
 * the contents list and page numbers update by themselves; code and diagrams
 * open in a small window to edit; tables open the table editor; pictures and
 * raw HTML are shown as they are.
 *
 * Formatting: the bar at the top (Word-style), the right-click menu, the usual
 * keys (Ctrl+B, Ctrl+I, Ctrl+U, Ctrl+K), and Markdown shortcuts as you type
 * ("# " at the start of a line makes a heading, "- " a list, "> " a quote).
 *
 * Paragraph styles (headings, lists, quote, indent) are applied to the
 * Markdown of the paragraph the caret is in, not through the browser's own
 * editing commands, which produced half-made lists that only worked on a
 * second try. Words (bold, italic, underline, strikethrough, code, link)
 * are formatted in place.
 */
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { renderMarkdown } from '../lib/markdown'
import { drawMermaid } from '../lib/mermaidView'
import { normaliseUrl } from '../lib/links'
import { EDITABLE, TEMPLATES, blockToMarkdown, insertAfter, replaceBlock, restyle, splitBlocks, type DocBlock, type Style } from '../lib/docBlocks'
import DiagramDialog from './DiagramDialog'
import TableTools from './TableTools'
import type { Table } from '../lib/table'

export interface DocEditorHandle {
  /** The line new things go after: the end of the block being edited, or the document's end. */
  insertLine: () => number | null
  /** Saves the block being typed in now (before saving the file, say). */
  commit: () => void
  /** Typing not yet saved into the document. */
  pending: () => boolean
  /** Stops writing in the paragraph, so the page redraws from the document (undo, redo). */
  release: () => void
  /** The app's Insert menu (insert:h1, insert:table…) in the Doc Editor; false when not handled here. */
  run: (action: string) => boolean
  /** Types text where the caret is (dictation); false when no paragraph has the caret. */
  insertText: (text: string) => boolean
}

interface Props {
  source: string
  zoom: number
  onChange: (next: string, label: string) => void
  /** Opens the table editor on the table starting at this line. */
  onTableEdit: (line: number) => void
  /** Inserts a picture after the block being edited (the app's own picker). */
  onInsertImage: () => void
  /** Changes a table in place (the hover buttons and cell editing). */
  onTableChange?: (line: number, change: (t: Table) => Table, label: string) => void
  /** Brings the table of contents up to date. */
  onUpdateToc?: () => void
}

const LOCK_HINT: Partial<Record<DocBlock['kind'], string>> = {
  toc: 'Table of contents: kept safe, it updates itself from the headings (📑 on the toolbar updates it now).',
  page: 'Page number or page break from the original: kept safe so the pages stay right.',
  html: 'Special formatting (HTML): kept safe and shown as it is. Edit it in Edit mode.',
  code: 'Code block: double-click to edit its text.',
  mermaid: 'Diagram: double-click to edit it.',
  table: 'Table: double-click to edit it in the table editor.',
  rule: 'A dividing line.',
  image: 'Picture: kept as it is. Edit mode changes its file or text.'
}

const KIND_NAME: Record<DocBlock['kind'], string> = {
  text: 'paragraph',
  heading: 'heading',
  list: 'list',
  quote: 'quote',
  code: 'code block',
  mermaid: 'diagram',
  table: 'table',
  toc: 'table of contents',
  page: 'page note',
  rule: 'dividing line',
  html: 'block',
  image: 'picture'
}

type MenuItem ={ label: string; keys?: string; run: () => void } | 'sep'

const DocEditor = forwardRef<DocEditorHandle, Props>(function DocEditor(props, ref) {
  const { source, onChange } = props
  /** The block being typed in (its element: its index can change as the document does). */
  const current = useRef<HTMLElement | null>(null)
  /** The last paragraph that had the caret, for the bar, the menu and dictation. */
  const last = useRef<HTMLElement | null>(null)
  /*
   * What is on screen. While a block is being written in, the view is frozen:
   * typing is saved into the Markdown every half second, but the page is not
   * redrawn under the caret. Leaving the block redraws it from the document.
   */
  const [blocks, setBlocks] = useState<DocBlock[]>(() => splitBlocks(source))
  useEffect(() => {
    if (!current.current) setBlocks(splitBlocks(source))
  }, [source])
  const typing = useRef<number | null>(null)
  useEffect(() => () => void (typing.current && window.clearTimeout(typing.current)), [])
  const host = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLElement>(null)
  const dirty = useRef(false)
  const saved = useRef<Range | null>(null)
  const refocus = useRef<number | null>(null)
  const [focused, setFocused] = useState<number | null>(null)
  const [linkBox, setLinkBox] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [codeEdit, setCodeEdit] = useState<{ block: DocBlock; lang: string; code: string; after?: DocBlock | null } | null>(null)
  const [diagram, setDiagram] = useState(false)
  const sourceRef = useRef(source)
  sourceRef.current = source
  const blocksRef = useRef(blocks)
  blocksRef.current = blocks

  // Each block on its own; a table keeps the line it starts on in the whole
  // document, so the table tools (hover buttons, cell editing) find it.
  const html = useMemo(
    () =>
      blocks.map((b) => {
        const out = renderMarkdown(b.text, { screen: true })
        return b.kind === 'table' ? out.replace(/data-mn-table="(\d+)"/g, (_m, n: string) => `data-mn-table="${Number(n) + b.start}"`) : out
      }),
    [blocks]
  )
  const allHtml = useMemo(() => html.join(''), [html])
  /** The link right-clicked (for Edit link and Remove link). */
  const linkEl = useRef<HTMLAnchorElement | null>(null)
  // Keys from the text, so a block keeps its place (and the caret) when lines above it change.
  const keys = useMemo(() => {
    const seen = new Map<string, number>()
    return blocks.map((b) => {
      const k = `${b.kind}:${b.text}`.slice(0, 400)
      const n = seen.get(k) ?? 0
      seen.set(k, n + 1)
      return `${k}#${n}`
    })
  }, [blocks])

  // Diagrams are drawn after rendering.
  useEffect(() => {
    if (host.current && source.includes('```mermaid')) void drawMermaid(host.current)
  }, [blocks, source])

  // After a paragraph style is applied, the caret goes back to the end of that paragraph.
  useLayoutEffect(() => {
    const i = refocus.current
    if (i === null) return
    refocus.current = null
    const el = host.current?.querySelector<HTMLElement>(`[data-block="${i}"]`)
    if (!el) return
    el.focus()
    const r = document.createRange()
    r.selectNodeContents(el)
    r.collapse(false)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(r)
    saved.current = r.cloneRange()
  })

  /** Puts the block being typed in back into the document, if it changed. */
  const commit = (leaving = true): void => {
    if (typing.current) window.clearTimeout(typing.current)
    typing.current = null
    const el = current.current ?? last.current
    if (!el || !dirty.current || !el.isConnected) return
    dirty.current = false
    const i = Number(el.dataset.block)
    const list = blocksRef.current
    const b = list[i]
    if (!b) return
    const next = blockToMarkdown(el.innerHTML)
    if (next === b.text.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')) return
    // While typing, an emptied block stays (as one empty line) until it is left.
    if (!next && !leaving) return
    const updated = replaceBlock(sourceRef.current, b, next)
    // The frozen view follows: this block's lines, and every block below moves.
    const delta = (next ? next.split('\n').length : 0) - (b.end - b.start)
    b.text = next
    b.end += delta
    for (let k = i + 1; k < list.length; k++) {
      list[k].start += delta
      list[k].end += delta
    }
    sourceRef.current = updated
    onChange(updated, 'Edit text')
  }
  /** Saved into the Markdown half a second after the typing stops. */
  const typed = (): void => {
    dirty.current = true
    if (typing.current) window.clearTimeout(typing.current)
    typing.current = window.setTimeout(() => {
      const el = current.current
      commit(false)
      // Changed from a menu while nobody is typing in it: redraw from the document.
      if (el && !el.contains(document.activeElement)) {
        current.current = null
        setBlocks(splitBlocks(sourceRef.current))
      }
    }, 500)
  }

  const blockOf = (el: HTMLElement | null): DocBlock | null => (el?.dataset.block ? (blocksRef.current[Number(el.dataset.block)] ?? null) : null)
  const currentBlock = (): DocBlock | null => blockOf(current.current) ?? blockOf(last.current) ?? (focused !== null ? (blocksRef.current[focused] ?? null) : null)

  /** Keeps the selection while a button or menu item is pressed. */
  const remember = (): void => {
    const sel = window.getSelection()
    if (sel && sel.rangeCount && host.current?.contains(sel.anchorNode)) saved.current = sel.getRangeAt(0).cloneRange()
  }
  const restore = (): HTMLElement | null => {
    const r = saved.current
    if (!r) return null
    const node = r.startContainer.nodeType === 1 ? (r.startContainer as Element) : r.startContainer.parentElement
    const el = node?.closest<HTMLElement>('[data-block]') ?? null
    if (!el || !el.isConnected) return null
    if (document.activeElement !== el) el.focus()
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(r)
    return el
  }

  useImperativeHandle(ref, () => ({
    insertLine: () => currentBlock()?.end ?? null,
    commit: () => commit(false),
    pending: () => dirty.current,
    run: (action: string) => {
      const map: Record<string, () => void> = {
        'insert:bold': () => exec('bold'),
        'insert:italic': () => exec('italic'),
        'insert:code': inlineCode,
        'insert:link': () => (remember(), setLinkBox('')),
        'insert:h1': () => blockStyle('h1'),
        'insert:h2': () => blockStyle('h2'),
        'insert:h3': () => blockStyle('h3'),
        'insert:ul': () => blockStyle('ul'),
        'insert:ol': () => blockStyle('ol'),
        'insert:quote': () => blockStyle('quote'),
        'insert:task': () => blockStyle('ul'),
        'insert:codeblock': newCode,
        'insert:table': newTable,
        'insert:hr': () => insert(TEMPLATES.rule, 'Insert line')
      }
      const fn = map[action]
      if (!fn) return false
      fn()
      return true
    },
    release: () => {
      commit()
      current.current = null
      setFocused(null)
      const active = document.activeElement as HTMLElement | null
      if (active?.closest('.doc-page')) active.blur()
      setBlocks(splitBlocks(sourceRef.current))
    },
    insertText: (text: string) => {
      const el = restore() ?? (last.current?.isConnected ? last.current : null)
      if (!el) return false
      if (document.activeElement !== el) {
        el.focus()
        const r = document.createRange()
        r.selectNodeContents(el)
        r.collapse(false)
        window.getSelection()?.removeAllRanges()
        window.getSelection()?.addRange(r)
      }
      // A space before the words when they follow other words.
      const sel = window.getSelection()
      const before = sel?.anchorNode?.textContent?.slice(0, sel.anchorOffset) ?? ''
      document.execCommand('insertText', false, (before && !/\s$/.test(before) ? ' ' : '') + text)
      remember()
      typed()
      return true
    }
  }))

  /**
   * With nothing selected, formatting applies to the word the caret is in
   * (as in a word processor), not to an invisible empty spot.
   */
  const wordAtCaret = (): void => {
    const sel = window.getSelection() as (Selection & { modify?: (a: string, d: string, g: string) => void }) | null
    if (!sel || !sel.isCollapsed || !sel.modify) return
    const node = sel.anchorNode
    const text = node?.textContent ?? ''
    const at = sel.anchorOffset
    // Only inside a word: letters on at least one side of the caret.
    if (!/[\p{L}\p{N}]/u.test(text[at - 1] ?? '') && !/[\p{L}\p{N}]/u.test(text[at] ?? '')) return
    if (/[\p{L}\p{N}]/u.test(text[at - 1] ?? '')) sel.modify('move', 'backward', 'word')
    sel.modify('extend', 'forward', 'word')
    // Leave out the space a forward word-step takes with it.
    const r = sel.getRangeAt(0)
    const s = r.toString()
    const trail = s.length - s.trimEnd().length
    if (trail && r.endContainer.nodeType === 3) r.setEnd(r.endContainer, r.endOffset - trail)
  }

  /** Bold, italic, underline, strikethrough: on the selected words. */
  const exec = (cmd: string): void => {
    if (!restore()) return
    wordAtCaret()
    document.execCommand(cmd)
    typed()
    remember()
  }

  const inlineCode = (): void => {
    if (!restore()) return
    wordAtCaret()
    const text = window.getSelection()?.toString() || 'code'
    const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    document.execCommand('insertHTML', false, `<code>${esc}</code>`)
    typed()
  }

  /** A paragraph style on the paragraph with the caret, applied to its Markdown. */
  const blockStyle = (style: Style): void => {
    const el = restore() ?? last.current
    const b = blockOf(el)
    if (!el || !b) return
    commit(false)
    // Which list item the caret is in, for indent and outdent.
    let item = 0
    const sel = window.getSelection()
    const li = (sel?.anchorNode?.nodeType === 1 ? (sel.anchorNode as Element) : sel?.anchorNode?.parentElement)?.closest('li')
    if (li) item = [...el.querySelectorAll('li')].indexOf(li)
    const next = restyle(b.text, style, Math.max(0, item))
    if (next === b.text) return
    const updated = replaceBlock(sourceRef.current, b, next)
    const i = Number(el.dataset.block)
    sourceRef.current = updated
    current.current = null
    refocus.current = i
    setBlocks(splitBlocks(updated))
    onChange(updated, 'Paragraph style')
  }

  /** A link on the selected words (or the address itself where nothing is selected). */
  const addLink = (typedUrl: string): void => {
    const url = normaliseUrl(typedUrl)
    setLinkBox(null)
    // Changing a link that is already there (right-click → Edit link).
    const existing = linkEl.current
    linkEl.current = null
    if (existing?.isConnected) {
      if (!url) return
      existing.setAttribute('href', url)
      current.current = existing.closest<HTMLElement>('[data-block]')
      last.current = current.current
      typed()
      return
    }
    const el = restore()
    if (!url || !el) return
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return
    const range = sel.getRangeAt(0)
    const a = document.createElement('a')
    a.href = url
    if (range.collapsed) a.textContent = url.replace(/^(https?:\/\/|mailto:)/, '').replace(/\/$/, '')
    else a.appendChild(range.extractContents())
    range.insertNode(a)
    // The caret goes after the link.
    const after = document.createRange()
    after.setStartAfter(a)
    after.collapse(true)
    sel.removeAllRanges()
    sel.addRange(after)
    saved.current = after.cloneRange()
    typed()
  }

  /** A whole-document change made here (insert, delete, code): shown at once. */
  const applyDoc = (updated: string, label: string): void => {
    current.current = null
    sourceRef.current = updated
    setBlocks(splitBlocks(updated))
    onChange(updated, label)
  }

  /** New Markdown after the block being edited (or at the end). */
  const insert = (block: string, label: string): void => {
    commit()
    const b = currentBlock()
    applyDoc(insertAfter(sourceRef.current, b, block), label)
  }
  const newCode = (): void => {
    const b = currentBlock()
    commit()
    setCodeEdit({ block: { kind: 'code', start: -1, end: -1, text: '' }, lang: '', code: '', after: b })
  }
  const newTable = (): void => {
    const b = currentBlock()
    insert(TEMPLATES.table, 'Insert table')
    const at = b ? b.end + 1 : null
    if (at !== null) window.setTimeout(() => props.onTableEdit(at), 60)
  }

  /** Markdown shortcuts at the start of a line: "# ", "## ", "- ", "1. ", "> ". */
  const onInput = (): void => {
    typed()
    const sel = window.getSelection()
    const node = sel?.anchorNode
    if (!sel || !node || node.nodeType !== 3) return
    const line = (node.textContent ?? '').slice(0, sel.anchorOffset)
    const m = line.match(/^(#{1,3}|[-*]|1\.|>)[\s ]$/)
    const el = (node.parentElement as HTMLElement | null)?.closest<HTMLElement>('[data-block]')
    if (!m || !el || node !== firstText(el)) return
    // Remove the typed marker, then apply the style to the paragraph.
    const r = document.createRange()
    r.setStart(node, 0)
    r.setEnd(node, line.length)
    r.deleteContents()
    const marker = m[1]
    remember()
    blockStyle(marker.startsWith('#') ? (`h${marker.length}` as Style) : marker === '1.' ? 'ol' : marker === '>' ? 'quote' : 'ul')
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const mod = e.ctrlKey || e.metaKey
    const k = e.key.toLowerCase()
    if (mod && k === 'k') {
      e.preventDefault()
      remember()
      setLinkBox('')
    } else if (mod && k === 'u') {
      e.preventDefault()
      document.execCommand('underline')
      typed()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      const sel = window.getSelection()
      const inItem = (sel?.anchorNode?.nodeType === 1 ? (sel.anchorNode as Element) : sel?.anchorNode?.parentElement)?.closest('li')
      if (inItem || e.shiftKey) {
        // In a list, Tab moves the item in a level and Shift+Tab out.
        remember()
        blockStyle(e.shiftKey ? 'outdent' : 'indent')
      } else {
        // In a paragraph, Tab leaves a space like a word processor's tab.
        document.execCommand('insertText', false, '  ')
        typed()
      }
    }
  }

  // The link box and the right-click menu close with Esc or a click elsewhere.
  useEffect(() => {
    if (linkBox === null && !menu) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setLinkBox(null)
        setMenu(null)
      }
    }
    const onDown = (e: MouseEvent): void => {
      const t = e.target as HTMLElement
      if (!t.closest('.doc-linkbox')) setLinkBox(null)
      if (!t.closest('.doc-menu')) setMenu(null)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onDown, true)
    }
  }, [linkBox, menu])

  const tool = (label: string, title: string, fn: () => void, extra = ''): React.JSX.Element => (
    <button
      className={`doc-tool ${extra}`}
      title={title}
      aria-label={title}
      onMouseDown={(e) => {
        // Keep the text selected while clicking.
        e.preventDefault()
        remember()
      }}
      onClick={fn}
    >
      {label}
    </button>
  )

  /** Opens a code block or diagram in the small editing window. */
  const openCode = (b: DocBlock): void => {
    const m = b.text.match(/^(\s*)(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)\n\s*\2\s*$/)
    setCodeEdit({ block: b, lang: m ? m[3].trim() : '', code: m ? m[4] : b.text })
  }

  /** Deletes a whole block (a table, diagram, code, picture, line…) from the document. */
  const removeBlock = (b: DocBlock, what: string): void => {
    commit()
    applyDoc(replaceBlock(sourceRef.current, b, ''), `Delete ${what}`)
  }

  const linkItems: MenuItem[] = linkEl.current
    ? [
        { label: 'Open link', keys: 'Ctrl+click', run: () => window.open(normaliseUrl(linkEl.current?.getAttribute('href') ?? ''), '_blank', 'noopener') },
        { label: 'Edit link…', run: () => setLinkBox(linkEl.current?.getAttribute('href') ?? '') },
        {
          label: 'Remove link (keep the words)',
          run: () => {
            const a = linkEl.current
            linkEl.current = null
            if (!a?.isConnected) return
            const block = a.closest<HTMLElement>('[data-block]')
            a.replaceWith(...Array.from(a.childNodes))
            current.current = block
            last.current = block
            typed()
          }
        },
        'sep'
      ]
    : []

  const menuItems: MenuItem[] = [
    ...linkItems,
    { label: 'Cut', keys: 'Ctrl+X', run: () => (restore(), document.execCommand('cut'), typed()) },
    { label: 'Copy', keys: 'Ctrl+C', run: () => (restore(), document.execCommand('copy')) },
    {
      label: 'Paste',
      keys: 'Ctrl+V',
      run: () => {
        const el = restore()
        if (!el) return
        void navigator.clipboard?.readText?.().then(
          (t) => {
            if (t) {
              restore()
              document.execCommand('insertText', false, t)
              typed()
            }
          },
          () => undefined
        )
      }
    },
    'sep',
    { label: 'Bold', keys: 'Ctrl+B', run: () => exec('bold') },
    { label: 'Italic', keys: 'Ctrl+I', run: () => exec('italic') },
    { label: 'Underline', keys: 'Ctrl+U', run: () => exec('underline') },
    { label: 'Strikethrough', run: () => exec('strikeThrough') },
    { label: 'Code in the line', run: inlineCode },
    { label: 'Link…', keys: 'Ctrl+K', run: () => setLinkBox('') },
    'sep',
    { label: 'Normal text', run: () => blockStyle('p') },
    { label: 'Heading 1', keys: '# ', run: () => blockStyle('h1') },
    { label: 'Heading 2', keys: '## ', run: () => blockStyle('h2') },
    { label: 'Heading 3', keys: '### ', run: () => blockStyle('h3') },
    { label: 'Bullet list', keys: '- ', run: () => blockStyle('ul') },
    { label: 'Numbered list', keys: '1. ', run: () => blockStyle('ol') },
    { label: 'Quote', keys: '> ', run: () => blockStyle('quote') },
    { label: 'More indent', keys: 'Tab', run: () => blockStyle('indent') },
    { label: 'Less indent', keys: 'Shift+Tab', run: () => blockStyle('outdent') },
    'sep',
    { label: 'Insert code block', run: newCode },
    { label: 'Insert table', run: newTable },
    { label: 'Insert diagram', run: () => setDiagram(true) },
    { label: 'Insert picture', run: () => (commit(), props.onInsertImage()) },
    { label: 'Insert dividing line', run: () => insert(TEMPLATES.rule, 'Insert line') }
  ]

  return (
    <div className="doc-editor">
      <div className="doc-bar" role="toolbar" aria-label="Formatting">
        <span className="doc-group">
          {tool('¶', 'Normal text', () => blockStyle('p'))}
          {tool('H1', 'Heading 1 (or type "# ")', () => blockStyle('h1'), 'doc-h')}
          {tool('H2', 'Heading 2 (or type "## ")', () => blockStyle('h2'), 'doc-h')}
          {tool('H3', 'Heading 3 (or type "### ")', () => blockStyle('h3'), 'doc-h')}
        </span>
        <span className="doc-group">
          {tool('B', 'Bold (Ctrl+B)', () => exec('bold'), 'doc-b')}
          {tool('I', 'Italic (Ctrl+I)', () => exec('italic'), 'doc-i')}
          {tool('U', 'Underline (Ctrl+U)', () => exec('underline'), 'doc-u')}
          {tool('S', 'Strikethrough', () => exec('strikeThrough'), 'doc-s')}
          {tool('</>', 'Code in the line', inlineCode)}
          {tool('🔗', 'Link (Ctrl+K)', () => setLinkBox((v) => (v === null ? '' : null)), linkBox !== null ? 'on' : '')}
        </span>
        <span className="doc-group">
          {tool('• List', 'Bullet list, on or off (or type "- ")', () => blockStyle('ul'))}
          {tool('1. List', 'Numbered list, on or off (or type "1. ")', () => blockStyle('ol'))}
          {tool('❝', 'Quote, on or off (or type "> ")', () => blockStyle('quote'))}
          {tool('⇤', 'Less indent (Shift+Tab in a list)', () => blockStyle('outdent'))}
          {tool('⇥', 'More indent (Tab in a list)', () => blockStyle('indent'))}
        </span>
        <span className="doc-group">
          {tool('{ } Code', 'Code block: after this paragraph', newCode)}
          {tool('▦ Table', 'Table: after this paragraph (then edit it in the table editor)', newTable)}
          {tool('◇ Diagram', 'Diagram: after this paragraph', () => setDiagram(true))}
          {tool('🖼', 'Picture: after this paragraph', () => (commit(), props.onInsertImage()))}
          {tool('―', 'Dividing line', () => insert(TEMPLATES.rule, 'Insert line'))}
        </span>
        <span className="doc-hint muted small">{focused === null ? 'Click in the text to write · right-click for all tools' : 'Writing · saved as you type · right-click for all tools'}</span>
      </div>

      {linkBox !== null && (
        <div className="doc-linkbox">
          <span className="small">Link to:</span>
          <input
            autoFocus
            value={linkBox}
            placeholder="astrology.suprasuta.in  or  https://…  or  name@example.com"
            onChange={(e) => setLinkBox(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addLink(linkBox)
              }
            }}
          />
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => addLink(linkBox)} disabled={!linkBox.trim()}>
            Add link
          </button>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => setLinkBox(null)}>
            Cancel
          </button>
          <span className="muted small">https:// is added if you leave it out</span>
        </div>
      )}

      <div
        className="doc-page"
        ref={host}
        style={{ fontSize: `${props.zoom * 16}px` }}
        onContextMenu={(e) => {
          if (!(e.target as HTMLElement).closest('.doc-block')) return
          e.preventDefault()
          linkEl.current = (e.target as HTMLElement).closest('a')
          remember()
          setMenu({ x: Math.min(e.clientX, window.innerWidth - 250), y: Math.min(e.clientY, window.innerHeight - 560) })
        }}
      >
        <article className="markdown-body doc-body" ref={bodyRef}>
          {blocks.map((b, i) => (
            <div key={keys[i]} className={`doc-row doc-row-${b.kind}`}>
              {EDITABLE.has(b.kind) ? (
                <div
                  data-block={i}
                  className={`doc-block${focused === i ? ' on' : ''}`}
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck
                  dangerouslySetInnerHTML={{ __html: html[i] }}
                  onFocus={(e) => {
                    if (current.current && current.current !== e.currentTarget) commit()
                    current.current = e.currentTarget
                    last.current = e.currentTarget
                    setFocused(i)
                  }}
                  onBlur={(e) => {
                    // Clicking the bar, the link box or the menu keeps the paragraph open.
                    const to = e.relatedTarget as HTMLElement | null
                    if (to?.closest('.doc-bar, .doc-linkbox, .doc-menu, .dict-panel, .dictation-bar, .read-panel')) return
                    commit()
                    current.current = null
                    setFocused(null)
                    // Redraw from the document now that nobody is typing in it.
                    setBlocks(splitBlocks(sourceRef.current))
                  }}
                  onKeyUp={remember}
                  onMouseUp={remember}
                  onInput={onInput}
                  onKeyDown={onKeyDown}
                  onClick={(e) => {
                    // Ctrl+click opens a link, as in Word.
                    const a = (e.target as HTMLElement).closest('a')
                    if (a && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault()
                      window.open(normaliseUrl(a.getAttribute('href') ?? ''), '_blank', 'noopener')
                    }
                  }}
                />
              ) : (
                <div
                  className={`doc-locked doc-${b.kind}`}
                  title={LOCK_HINT[b.kind]}
                  onDoubleClick={(e) => {
                    // Tables: double-click a cell edits it (the table tools); elsewhere opens the editor.
                    if (b.kind === 'table' && (e.target as HTMLElement).closest('td, th')) return
                    if (b.kind === 'table') props.onTableEdit(b.start)
                    else if (b.kind === 'code' || b.kind === 'mermaid') openCode(b)
                  }}
                >
                  <div dangerouslySetInnerHTML={{ __html: html[i] }} />
                </div>
              )}
              {/* Corner buttons: change or delete the whole block. Page numbers stay. */}
              {b.kind !== 'page' && (
                <span className="doc-actions" onMouseDown={(e) => e.preventDefault()}>
                  {b.kind === 'table' && (
                    <button onClick={() => props.onTableEdit(b.start)} title="Edit this table in the table editor">
                      ✎ Edit table
                    </button>
                  )}
                  {(b.kind === 'code' || b.kind === 'mermaid') && (
                    <button onClick={() => openCode(b)} title={b.kind === 'mermaid' ? 'Edit this diagram' : 'Edit this code'}>
                      ✎ Edit
                    </button>
                  )}
                  {b.kind === 'toc' && (
                    <button onClick={() => props.onUpdateToc?.()} title="Bring the table of contents up to date">
                      ↻ Update
                    </button>
                  )}
                  <button className="doc-del" onClick={() => removeBlock(b, KIND_NAME[b.kind])} title={`Delete this ${KIND_NAME[b.kind]} (Ctrl+Z brings it back)`}>
                    🗑
                  </button>
                </span>
              )}
            </div>
          ))}
          <div
            className="doc-block doc-new"
            contentEditable
            suppressContentEditableWarning
            data-placeholder={blocks.length ? 'Click here to add more at the end…' : 'Start writing…'}
            onBlur={(e) => {
              const text = blockToMarkdown(e.currentTarget.innerHTML)
              e.currentTarget.innerHTML = ''
              if (text) onChange(insertAfter(sourceRef.current, null, text), 'Add text')
            }}
          />
        </article>
      </div>

      <TableTools
        hostRef={bodyRef}
        scrollerRef={host}
        source={source}
        html={allHtml}
        enabled={!!props.onTableChange}
        onTableEdit={props.onTableEdit}
        onTableChange={props.onTableChange}
      />

      {menu && (
        <div className="doc-menu" role="menu" style={{ left: menu.x, top: Math.max(8, menu.y) }} onMouseDown={(e) => e.preventDefault()}>
          {menuItems.map((m, k) =>
            m === 'sep' ? (
              <div key={k} className="menu-sep" />
            ) : (
              <button
                key={k}
                role="menuitem"
                onClick={() => {
                  setMenu(null)
                  m.run()
                }}
              >
                <span>{m.label}</span>
                {m.keys && <span className="menu-accel">{m.keys}</span>}
              </button>
            )
          )}
        </div>
      )}

      {codeEdit && (
        <div className="modal-backdrop" data-mn-ignore onMouseDown={() => setCodeEdit(null)}>
          <div className="modal doc-code-modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Edit code">
            <h2>{codeEdit.block.kind === 'mermaid' || codeEdit.lang === 'mermaid' ? 'Edit diagram' : codeEdit.block.text ? 'Edit code' : 'New code block'}</h2>
            <label className="small">
              Language (optional, for colours: js, python, sql…){' '}
              <input value={codeEdit.lang} onChange={(e) => setCodeEdit({ ...codeEdit, lang: e.target.value })} style={{ width: 140 }} />
            </label>
            <textarea className="doc-code-text" value={codeEdit.code} onChange={(e) => setCodeEdit({ ...codeEdit, code: e.target.value })} rows={14} spellCheck={false} autoFocus />
            <div className="modal-actions">
              <button onClick={() => setCodeEdit(null)}>Cancel</button>
              <button
                className="primary"
                onClick={() => {
                  const { block, lang, code, after } = codeEdit
                  setCodeEdit(null)
                  const fence = code.includes('```') ? '````' : '```'
                  const md = `${fence}${lang.trim()}\n${code.replace(/\s+$/, '')}\n${fence}`
                  commit()
                  if (block.text) applyDoc(replaceBlock(sourceRef.current, block, md), 'Edit code')
                  else applyDoc(insertAfter(sourceRef.current, after ?? null, md), 'Insert code block')
                }}
              >
                {codeEdit.block.text ? 'Save' : 'Insert'}
              </button>
            </div>
          </div>
        </div>
      )}

      {diagram && (
        <DiagramDialog
          editMode
          onClose={() => setDiagram(false)}
          onInsert={(block) => {
            setDiagram(false)
            insert(block, 'Insert diagram')
          }}
        />
      )}
    </div>
  )
})

/** The first text in a block (where a typed "# " counts as a shortcut). */
function firstText(el: HTMLElement): Node | null {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => ((n.textContent ?? '').trim() || n.textContent === ' ' || n.textContent === ' ' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) })
  return w.nextNode()
}

export default DocEditor
