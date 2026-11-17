/**
 * Doc Editor: write as in a word processor; the file stays Markdown.
 *
 * The document is shown formatted, block by block (lib/docBlocks.ts). Text
 * blocks (paragraphs, headings, lists, quotes) are typed into directly; when
 * you leave one, only that block is turned back into Markdown and put in
 * place of its own lines, so nothing else in the file moves. Blocks a slip
 * could break are "kept safe": the contents list and page numbers update by
 * themselves; code and diagrams open in a small window to edit; tables open
 * the table editor; pictures and raw HTML are shown as they are.
 *
 * Formatting comes from the bar at the top (Word-style) or the usual keys
 * (Ctrl+B, Ctrl+I, Ctrl+U, Ctrl+K), and Markdown shortcuts work as you type
 * ("# " at the start of a line makes a heading, "- " a list, "> " a quote).
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { renderMarkdown } from '../lib/markdown'
import { drawMermaid } from '../lib/mermaidView'
import { normaliseUrl } from '../lib/links'
import { EDITABLE, TEMPLATES, blockToMarkdown, insertAfter, replaceBlock, splitBlocks, type DocBlock } from '../lib/docBlocks'
import DiagramDialog from './DiagramDialog'

export interface DocEditorHandle {
  /** The line new things go after: the end of the block being edited, or the document's end. */
  insertLine: () => number | null
  /** Saves the block being typed in now (before saving the file, say). */
  commit: () => void
  /** Typing not yet saved into the document. */
  pending: () => boolean
}

interface Props {
  source: string
  zoom: number
  onChange: (next: string, label: string) => void
  /** Opens the table editor on the table starting at this line. */
  onTableEdit: (line: number) => void
  /** Inserts a picture after the block being edited (the app's own picker). */
  onInsertImage: () => void
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

const DocEditor = forwardRef<DocEditorHandle, Props>(function DocEditor(props, ref) {
  const { source, onChange } = props
  /** The block being typed in (its element: its index can change as the document does). */
  const current = useRef<HTMLElement | null>(null)
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
  const dirty = useRef(false)
  const saved = useRef<Range | null>(null)
  const [focused, setFocused] = useState<number | null>(null)
  const [linkBox, setLinkBox] = useState<string | null>(null)
  const [codeEdit, setCodeEdit] = useState<{ block: DocBlock; lang: string; code: string } | null>(null)
  const [diagram, setDiagram] = useState(false)
  const sourceRef = useRef(source)
  sourceRef.current = source
  const blocksRef = useRef(blocks)
  blocksRef.current = blocks

  const html = useMemo(() => blocks.map((b) => renderMarkdown(b.text, { screen: true })), [blocks])
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

  /** Puts the block being typed in back into the document, if it changed. */
  const commit = (leaving = true): void => {
    if (typing.current) window.clearTimeout(typing.current)
    typing.current = null
    const el = current.current
    if (!el || !dirty.current) return
    dirty.current = false
    const i = Number(el.dataset.block)
    const list = blocksRef.current
    const b = list[i]
    if (!b) return
    const next = blockToMarkdown(el.innerHTML)
    if (next === b.text.trim()) return
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
    typing.current = window.setTimeout(() => commit(false), 500)
  }

  useImperativeHandle(ref, () => ({
    insertLine: () => {
      const b = currentBlock()
      return b ? b.end : null
    },
    commit: () => commit(false),
    pending: () => dirty.current
  }))

  const currentBlock = (): DocBlock | null => {
    const el = current.current
    if (el?.dataset.block) return blocksRef.current[Number(el.dataset.block)] ?? null
    return focused !== null ? (blocksRef.current[focused] ?? null) : null
  }

  /** Keeps the selection while a toolbar button is pressed. */
  const remember = (): void => {
    const sel = window.getSelection()
    if (sel && sel.rangeCount && host.current?.contains(sel.anchorNode)) saved.current = sel.getRangeAt(0).cloneRange()
  }
  const restore = (): boolean => {
    const r = saved.current
    if (!r) return false
    const el = (r.startContainer.nodeType === 1 ? (r.startContainer as Element) : r.startContainer.parentElement)?.closest<HTMLElement>('[data-block]')
    if (!el) return false
    el.focus()
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(r)
    return true
  }

  /** A formatting command on the text being edited. */
  const exec = (cmd: string, value?: string): void => {
    if (!restore()) return
    document.execCommand(cmd, false, value)
    typed()
    remember()
  }

  const inlineCode = (): void => {
    if (!restore()) return
    const text = window.getSelection()?.toString() || 'code'
    const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    document.execCommand('insertHTML', false, `<code>${esc}</code>`)
    typed()
  }

  /** New Markdown after the block being edited (or at the end). */
  const insert = (block: string, label: string): void => {
    commit()
    const b = currentBlock()
    onChange(insertAfter(sourceRef.current, b, block), label)
  }

  /** Markdown shortcuts at the start of a line: "# ", "## ", "- ", "1. ", "> ". */
  const onInput = (e: React.FormEvent<HTMLDivElement>): void => {
    typed()
    const sel = window.getSelection()
    const node = sel?.anchorNode
    if (!sel || !node || node.nodeType !== 3) return
    const line = (node.textContent ?? '').slice(0, sel.anchorOffset)
    const m = line.match(/^(#{1,3}|[-*]|1\.|>) ?\s$/)
    if (!m || (node.textContent ?? '').length > line.length + 200) return
    const marker = m[1]
    // Remove the typed marker, then apply the format.
    const r = document.createRange()
    r.setStart(node, 0)
    r.setEnd(node, line.length)
    sel.removeAllRanges()
    sel.addRange(r)
    document.execCommand('delete')
    if (marker.startsWith('#')) document.execCommand('formatBlock', false, `h${marker.length}`)
    else if (marker === '-' || marker === '*') document.execCommand('insertUnorderedList')
    else if (marker === '1.') document.execCommand('insertOrderedList')
    else document.execCommand('formatBlock', false, 'blockquote')
    void e
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      remember()
      setLinkBox('')
    } else if (mod && e.key.toLowerCase() === 'u') {
      e.preventDefault()
      document.execCommand('underline')
      typed()
    }
  }

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

  const editingLocked = focused === null

  return (
    <div className="doc-editor">
      <div className="doc-bar" role="toolbar" aria-label="Formatting">
        <span className="doc-group">
          {tool('¶', 'Normal text', () => exec('formatBlock', 'p'))}
          {tool('H1', 'Heading 1 (or type "# ")', () => exec('formatBlock', 'h1'), 'doc-h')}
          {tool('H2', 'Heading 2 (or type "## ")', () => exec('formatBlock', 'h2'), 'doc-h')}
          {tool('H3', 'Heading 3 (or type "### ")', () => exec('formatBlock', 'h3'), 'doc-h')}
        </span>
        <span className="doc-group">
          {tool('B', 'Bold (Ctrl+B)', () => exec('bold'), 'doc-b')}
          {tool('I', 'Italic (Ctrl+I)', () => exec('italic'), 'doc-i')}
          {tool('U', 'Underline (Ctrl+U)', () => exec('underline'), 'doc-u')}
          {tool('S', 'Strikethrough', () => exec('strikeThrough'), 'doc-s')}
          {tool('</>', 'Code in the line', inlineCode)}
          {tool('🔗', 'Link (Ctrl+K)', () => setLinkBox(''))}
        </span>
        <span className="doc-group">
          {tool('• List', 'Bullet list (or type "- ")', () => exec('insertUnorderedList'))}
          {tool('1. List', 'Numbered list (or type "1. ")', () => exec('insertOrderedList'))}
          {tool('❝', 'Quote (or type "> ")', () => exec('formatBlock', 'blockquote'))}
          {tool('⇤', 'Less indent', () => exec('outdent'))}
          {tool('⇥', 'More indent', () => exec('indent'))}
        </span>
        <span className="doc-group">
          {tool('{ } Code', 'Code block: after this paragraph', () => {
            const b = currentBlock()
            commit()
            setCodeEdit({ block: { kind: 'code', start: b ? b.end : -1, end: b ? b.end : -1, text: '' }, lang: '', code: '' })
          })}
          {tool('▦ Table', 'Table: after this paragraph (then edit it in the table editor)', () => {
            const b = currentBlock()
            insert(TEMPLATES.table, 'Insert table')
            const at = b ? b.end + 1 : null
            if (at !== null) window.setTimeout(() => props.onTableEdit(at), 60)
          })}
          {tool('◇ Diagram', 'Diagram: after this paragraph', () => setDiagram(true))}
          {tool('🖼', 'Picture: after this paragraph', () => {
            commit()
            props.onInsertImage()
          })}
          {tool('―', 'Dividing line', () => insert(TEMPLATES.rule, 'Insert line'))}
        </span>
        <span className="doc-hint muted small">{editingLocked ? 'Click in the text to write.' : 'Writing · saved into the Markdown when you click elsewhere'}</span>
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
              if (e.key === 'Escape') setLinkBox(null)
              if (e.key === 'Enter') {
                const url = normaliseUrl(linkBox)
                setLinkBox(null)
                if (!url || !restore()) return
                const sel = window.getSelection()
                if (sel && sel.isCollapsed) document.execCommand('insertHTML', false, `<a href="${url.replace(/"/g, '%22')}">${url.replace(/^(https?:\/\/|mailto:)/, '')}</a>`)
                else document.execCommand('createLink', false, url)
                typed()
              }
            }}
          />
          <span className="muted small">Enter to add · Esc to cancel · https:// is added if you leave it out</span>
        </div>
      )}

      <div className="doc-page" ref={host} style={{ fontSize: `${props.zoom * 16}px` }}>
        <article className="markdown-body doc-body">
          {blocks.map((b, i) =>
            EDITABLE.has(b.kind) ? (
              <div
                key={keys[i]}
                data-block={i}
                className={`doc-block${focused === i ? ' on' : ''}`}
                contentEditable
                suppressContentEditableWarning
                spellCheck
                dangerouslySetInnerHTML={{ __html: html[i] }}
                onFocus={(e) => {
                  if (current.current && current.current !== e.currentTarget) commit()
                  current.current = e.currentTarget
                  dirty.current = false
                  setFocused(i)
                }}
                onBlur={(e) => {
                  // Clicking the bar or the link box keeps the block open.
                  const to = e.relatedTarget as HTMLElement | null
                  if (to?.closest('.doc-bar, .doc-linkbox')) return
                  commit()
                  current.current = null
                  setFocused(null)
                  // Redraw from the document now that nobody is typing in it.
                  setBlocks(splitBlocks(sourceRef.current))
                }}
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
                key={keys[i]}
                className={`doc-locked doc-${b.kind}`}
                title={LOCK_HINT[b.kind]}
                onDoubleClick={() => {
                  if (b.kind === 'table') props.onTableEdit(b.start)
                  else if (b.kind === 'code' || b.kind === 'mermaid') {
                    const m = b.text.match(/^(\s*)(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)\n\s*\2\s*$/)
                    setCodeEdit({ block: b, lang: m ? m[3].trim() : '', code: m ? m[4] : b.text })
                  }
                }}
              >
                <div dangerouslySetInnerHTML={{ __html: html[i] }} />
              </div>
            )
          )}
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
            onInput={onInput}
            onKeyDown={onKeyDown}
          />
        </article>
      </div>

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
                  const { block, lang, code } = codeEdit
                  setCodeEdit(null)
                  const fence = code.includes('```') ? '````' : '```'
                  const md = `${fence}${lang.trim()}\n${code.replace(/\s+$/, '')}\n${fence}`
                  if (block.text) onChange(replaceBlock(sourceRef.current, block, md), 'Edit code')
                  else {
                    const after = blocksRef.current.find((x) => x.end === block.start) ?? null
                    onChange(insertAfter(sourceRef.current, block.start >= 0 ? after : null, md), 'Insert code block')
                  }
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

export default DocEditor
