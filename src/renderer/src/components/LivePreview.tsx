/**
 * The rendered pane beside the editor, with formatting you can apply from it.
 *
 * The point is locating the change rather than making it: in a converted
 * document the source is one enormous line per paragraph, so finding the words
 * you want to embolden means reading a wall of unwrapped text. They are
 * obvious in the rendered version. Select there, press Bold, and only the
 * matching source range is rewritten.
 *
 * Note this is deliberately *not* the annotation toolbar from the reading
 * view. That one records review marks by wrapping text in tagged HTML; these
 * buttons change the Markdown itself. Keeping them in separate modes avoids
 * two buttons labelled B that do different things.
 *
 * The edit is surgical. Only the selected range is touched, so a document full
 * of tables, reference links and footnotes is not re-serialised wholesale just
 * because somebody emboldened a word.
 *
 * Kept identical to the copy in the Windows app. Change one, copy it across.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { renderMarkdown } from '../lib/markdown'
import {
  buildSourceMap,
  indexTextNodes,
  domToOffset,
  toSourceRange,
  type TextNodeIndexEntry
} from '../lib/align'

export type PreviewFormat = 'bold' | 'italic' | 'heading' | 'link' | 'code'

interface Props {
  source: string
  zoom: number
  /** Applies `action` to the given source character range. */
  onFormat: (action: PreviewFormat, range: [number, number]) => void
  /**
   * Reports the two elements scroll syncing needs, and reports null when they
   * go away.
   *
   * A callback rather than refs handed down. A ref object never changes
   * identity, so a parent effect holding one has no way to know the elements
   * inside it were swapped — which happens on every remount and on every hot
   * reload, leaving the listeners attached to detached nodes and scroll
   * syncing silently dead. Telling the parent means it can re-link.
   */
  onElements: (elements: { scroller: HTMLDivElement; body: HTMLElement } | null) => void
}

const BUTTONS: Array<{ action: PreviewFormat; label: string; title: string }> = [
  { action: 'bold', label: 'B', title: 'Bold' },
  { action: 'italic', label: 'I', title: 'Italic' },
  { action: 'heading', label: 'H', title: 'Make this a heading' },
  { action: 'code', label: '</>', title: 'Inline code' },
  { action: 'link', label: '🔗', title: 'Make this a link' }
]

export default function LivePreview({
  source,
  zoom,
  onFormat,
  onElements
}: Props): React.JSX.Element {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLElement>(null)
  const indexRef = useRef<{ text: string; entries: TextNodeIndexEntry[] } | null>(null)
  const mapRef = useRef<Int32Array | null>(null)
  const [bar, setBar] = useState<{ x: number; y: number; flip: boolean } | null>(null)

  const html = useMemo(() => renderMarkdown(source, { sourceLines: true }), [source])

  // Announce the elements once they exist, and withdraw them on unmount so no
  // listener is left attached to a node that is no longer on the page.
  useEffect(() => {
    const scroller = scrollerRef.current
    const body = bodyRef.current
    if (scroller && body) onElements({ scroller, body })
    return () => onElements(null)
  }, [onElements])

  /*
   * Re-index whenever the rendered output changes.
   *
   * Every keystroke in the editor re-renders this pane, and the character
   * offsets of every text node move with it. A stale index maps a selection to
   * the wrong part of the document, which would corrupt the file rather than
   * merely misbehave — worth rebuilding eagerly.
   */
  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    indexRef.current = indexTextNodes(body)
    mapRef.current = buildSourceMap(source, indexRef.current.text)
    setBar(null)
  }, [html, source, bodyRef])

  const rangeFromSelection = useCallback((): [number, number] | null => {
    const selection = window.getSelection()
    const body = bodyRef.current
    const index = indexRef.current
    const map = mapRef.current
    if (!selection || selection.isCollapsed || !body || !index || !map) return null

    const range = selection.getRangeAt(0)
    if (!body.contains(range.commonAncestorContainer)) return null

    const start = domToOffset(index.entries, range.startContainer, range.startOffset)
    const end = domToOffset(index.entries, range.endContainer, range.endOffset)
    if (start === null || end === null || end <= start) return null

    return toSourceRange(map, start, end)
  }, [bodyRef])

  // Show the bar above the selection, or below it when there is no room.
  useEffect(() => {
    function onSelectionChange(): void {
      const selection = window.getSelection()
      const body = bodyRef.current
      const scroller = scrollerRef.current
      if (!selection || selection.isCollapsed || !body || !scroller) {
        setBar(null)
        return
      }

      const range = selection.getRangeAt(0)
      if (!body.contains(range.commonAncestorContainer)) {
        setBar(null)
        return
      }

      const rect = range.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) {
        setBar(null)
        return
      }

      const host = scroller.getBoundingClientRect()
      const flip = rect.top - host.top < 46
      setBar({
        x: Math.max(8, Math.min(rect.left + rect.width / 2 - host.left, host.width - 8)),
        y: flip ? rect.bottom - host.top + 8 : rect.top - host.top - 8,
        flip
      })
    }

    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [bodyRef, scrollerRef])

  const apply = (action: PreviewFormat): void => {
    const range = rangeFromSelection()
    if (!range) return
    onFormat(action, range)
    window.getSelection()?.removeAllRanges()
    setBar(null)
  }

  return (
    <div className="live-preview" ref={scrollerRef}>
      <article
        ref={bodyRef as React.Ref<HTMLElement>}
        className="markdown-body"
        style={{ fontSize: `${zoom * 15}px` }}
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {bar && (
        <div
          className={`sel-toolbar${bar.flip ? ' flip' : ''}`}
          data-mn-ignore
          style={{ left: bar.x, top: bar.y }}
          // Without this the selection is gone before the click lands.
          onMouseDown={(e) => e.preventDefault()}
        >
          {BUTTONS.map((b) => (
            <button key={b.action} title={b.title} onClick={() => apply(b.action)}>
              {b.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
