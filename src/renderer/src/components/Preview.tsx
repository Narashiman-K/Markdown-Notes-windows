import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { renderMarkdown } from '../lib/markdown'
import { buildSourceMap, indexTextNodes, domToOffset, toSourceRange, type TextNodeIndexEntry } from '../lib/align'
import { HIGHLIGHT_COLORS } from '../lib/annotations'
import type { AnnotationType } from '../../../shared/types'

export interface PreviewHandle {
  getSelectionRange: () => [number, number] | null
  getHtml: () => string
  scrollToSlug: (slug: string) => void
  scrollToAnnotation: (id: string) => void
  scrollToText: (text: string) => boolean
  clearSelection: () => void
}

interface Props {
  source: string
  zoom: number
  activeAnnotation: string | null
  onAnnotate: (type: AnnotationType, color?: string) => void
  onComment: () => void
  onRemoveAnnotation: (id: string) => void
  onSelectAnnotation: (id: string | null) => void
  onEditAnnotationNote: (id: string) => void
  onScrollRatio?: (ratio: number) => void
}

interface ToolbarState {
  x: number
  y: number
  visible: boolean
  flip: boolean
}

const Preview = forwardRef<PreviewHandle, Props>(function Preview(props, ref) {
  const { source, zoom, activeAnnotation } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const indexRef = useRef<{ text: string; entries: TextNodeIndexEntry[] } | null>(null)
  const mapRef = useRef<Int32Array | null>(null)
  const [toolbar, setToolbar] = useState<ToolbarState>({ x: 0, y: 0, visible: false, flip: false })
  const [hoverNote, setHoverNote] = useState<{ x: number; y: number; text: string; id: string } | null>(null)

  const html = useMemo(() => renderMarkdown(source), [source])

  // Re-index the rendered DOM whenever the document changes.
  useEffect(() => {
    if (!hostRef.current) return
    indexRef.current = indexTextNodes(hostRef.current)
    mapRef.current = buildSourceMap(source, indexRef.current.text)
    setToolbar((t) => ({ ...t, visible: false }))
  }, [html, source])

  const getSelectionRange = useCallback((): [number, number] | null => {
    const sel = window.getSelection()
    const host = hostRef.current
    const index = indexRef.current
    const map = mapRef.current
    if (!sel || sel.isCollapsed || !host || !index || !map) return null
    const range = sel.getRangeAt(0)
    if (!host.contains(range.commonAncestorContainer)) return null

    const start = domToOffset(index.entries, range.startContainer, range.startOffset)
    const end = domToOffset(index.entries, range.endContainer, range.endOffset)
    if (start === null || end === null || end <= start) return null
    return toSourceRange(map, start, end)
  }, [])

  useImperativeHandle(ref, () => ({
    getSelectionRange,
    getHtml: () => hostRef.current?.innerHTML ?? '',
    scrollToSlug: (slug: string) => {
      hostRef.current?.querySelector(`#${CSS.escape(slug)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
    scrollToAnnotation: (id: string) => {
      const el = hostRef.current?.querySelector(`[data-mn-id="${CSS.escape(id)}"]`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    },
    /** Finds a passage in the rendered text and scrolls to it with a flash. */
    scrollToText: (text: string) => {
      const host = hostRef.current
      const index = indexRef.current
      if (!host || !index) return false

      const needle = text.replace(/\s+/g, ' ').trim().slice(0, 60).toLowerCase()
      if (needle.length < 4) return false
      const hay = index.text.replace(/\s+/g, ' ').toLowerCase()
      const at = hay.indexOf(needle)
      if (at === -1) return false

      // Map the normalised hit back to a text node and scroll its element.
      let scanned = 0
      for (const entry of index.entries) {
        const normalisedLength = (entry.node.nodeValue ?? '').replace(/\s+/g, ' ').length
        if (scanned + normalisedLength >= at) {
          const el = entry.node.parentElement
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' })
            el.classList.add('mn-flash')
            window.setTimeout(() => el.classList.remove('mn-flash'), 1600)
            return true
          }
        }
        scanned += normalisedLength
      }
      return false
    },
    clearSelection: () => {
      window.getSelection()?.removeAllRanges()
      setToolbar((t) => ({ ...t, visible: false }))
    }
  }))

  // Floating selection toolbar
  useEffect(() => {
    function onSelectionChange(): void {
      const sel = window.getSelection()
      const host = hostRef.current
      if (!sel || sel.isCollapsed || !host || sel.rangeCount === 0) {
        setToolbar((t) => (t.visible ? { ...t, visible: false } : t))
        return
      }
      const range = sel.getRangeAt(0)
      if (!host.contains(range.commonAncestorContainer)) {
        setToolbar((t) => (t.visible ? { ...t, visible: false } : t))
        return
      }
      const rect = range.getBoundingClientRect()
      if (!rect.width && !rect.height) return
      // Keep the bar inside the window: flip below when the selection is near
      // the top, and clamp horizontally so it never runs off an edge.
      const flip = rect.top < 130
      const half = 130
      setToolbar({
        x: Math.max(half, Math.min(rect.left + rect.width / 2, window.innerWidth - half)),
        y: flip ? rect.bottom + 10 : rect.top - 8,
        visible: true,
        flip
      })
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [])

  // Click / hover on existing annotations
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    function onClick(e: MouseEvent): void {
      const target = (e.target as HTMLElement).closest('[data-mn-id]') as HTMLElement | null
      props.onSelectAnnotation(target?.dataset.mnId ?? null)
      const anchor = (e.target as HTMLElement).closest('a') as HTMLAnchorElement | null
      if (anchor?.href && /^https?:/i.test(anchor.href)) {
        e.preventDefault()
        window.open(anchor.href, '_blank')
      }
    }

    function onOver(e: MouseEvent): void {
      const target = (e.target as HTMLElement).closest('[data-mn-note]') as HTMLElement | null
      if (!target) {
        setHoverNote(null)
        return
      }
      const rect = target.getBoundingClientRect()
      setHoverNote({
        x: rect.left,
        y: rect.bottom + 6,
        text: target.dataset.mnNote ?? '',
        id: target.dataset.mnId ?? ''
      })
    }

    host.addEventListener('click', onClick)
    host.addEventListener('mouseover', onOver)
    return () => {
      host.removeEventListener('click', onClick)
      host.removeEventListener('mouseover', onOver)
    }
  }, [props])

  // Highlight the active annotation
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    host.querySelectorAll('.mn-active').forEach((el) => el.classList.remove('mn-active'))
    if (activeAnnotation) {
      host.querySelectorAll(`[data-mn-id="${CSS.escape(activeAnnotation)}"]`).forEach((el) => el.classList.add('mn-active'))
    }
  }, [activeAnnotation, html])

  const selectedAnnotationId = (): string | null => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return null
    const node = sel.getRangeAt(0).commonAncestorContainer
    const el = (node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement))?.closest('[data-mn-id]')
    return (el as HTMLElement | null)?.dataset.mnId ?? null
  }

  return (
    <div className="preview-host">
      <div
        className="preview-scroll"
        onScroll={(e) => {
          const el = e.currentTarget
          props.onScrollRatio?.(el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight))
        }}
      >
        <article
          ref={hostRef}
          className="markdown-body"
          style={{ fontSize: `${zoom * 16}px` }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>

      {toolbar.visible && (
        <div
          className={`sel-toolbar${toolbar.flip ? ' flip' : ''}`}
          data-mn-ignore
          style={{ left: toolbar.x, top: toolbar.y }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {Object.entries(HIGHLIGHT_COLORS).map(([name, hex]) => (
            <button
              key={name}
              className="swatch"
              title={`Highlight ${name}`}
              style={{ background: hex }}
              onClick={() => props.onAnnotate('highlight', name)}
            />
          ))}
          <span className="sep" />
          <button title="Underline (Ctrl+U)" onClick={() => props.onAnnotate('underline')}>
            <u>U</u>
          </button>
          <button title="Strikethrough" onClick={() => props.onAnnotate('strike')}>
            <s>S</s>
          </button>
          <button title="Bold emphasis" onClick={() => props.onAnnotate('bold')}>
            <b>B</b>
          </button>
          <span className="sep" />
          <button title="Add comment" onClick={props.onComment}>
            💬
          </button>
          <button
            title="Remove annotation"
            onClick={() => {
              const id = selectedAnnotationId()
              if (id) props.onRemoveAnnotation(id)
            }}
          >
            ⌫
          </button>
        </div>
      )}

      {hoverNote && (
        <div className="note-tip" data-mn-ignore style={{ left: hoverNote.x, top: hoverNote.y }}>
          <div className="note-tip-text">{hoverNote.text}</div>
          <button className="link" onClick={() => props.onEditAnnotationNote(hoverNote.id)}>
            Edit
          </button>
        </div>
      )}
    </div>
  )
})

export default Preview
