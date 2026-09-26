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
import { buildSourceMap, rangeToOffsets, toSourceRange } from '../lib/align'

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
   * The index and the source map are built at the moment they are used, not
   * cached and refreshed.
   *
   * Caching them looked obviously right: the pane re-renders on every
   * keystroke, so rebuilding eagerly in an effect seemed like the careful
   * option. It is the dangerous one. Every text node is replaced when React
   * rewrites the pane's HTML, so a cached index holds references to detached
   * nodes and offsets into text that is no longer there. Offsets past the end
   * of the stale text clamp to the end of the document, which produced a
   * one-character range there — formatting applied to the last character of
   * the file rather than to what was selected, silently and destructively.
   *
   * There is no cheap way to be certain a cache is current, and no way at all
   * to notice when it is not. Building it on demand costs a walk of the
   * rendered text once per formatting action, which is nothing, and cannot be
   * stale by construction.
   */
  const rangeFromSelection = useCallback((): [number, number] | null => {
    const selection = window.getSelection()
    const body = bodyRef.current
    if (!selection || selection.isCollapsed || !body) return null

    const offsets = rangeToOffsets(body, selection.getRangeAt(0))
    if (!offsets) return null

    const [start, end] = offsets

    /*
     * The map is built from the same string the offsets were measured
     * against. Using `textContent` on both sides is the whole point: any
     * other definition of "the rendered text" would drift from what the
     * browser counted, and a drift of a few characters is what put closing
     * markers in the middle of words.
     */
    const rendered = body.textContent ?? ''
    if (end > rendered.length) return null

    return toSourceRange(buildSourceMap(source, rendered), start, end)
  }, [source])

  // Dismiss the bar whenever the rendered content changes underneath it.
  useEffect(() => {
    setBar(null)
  }, [html])

  /*
   * Show the bar above the selection, or below it when there is no room.
   *
   * These are viewport coordinates, not offsets within the pane. `.sel-toolbar`
   * is position:fixed with translate(-50%, -100%), so x is the *centre* of the
   * bar in page space. Measuring relative to the scrolling container instead
   * put the bar exactly one pane-width to the left, which landed it on top of
   * the editor and, near the window edge, mostly off screen.
   *
   * The clamp is what keeps it on screen at all: half the bar's width at each
   * side, matching the reading view's toolbar so the two behave the same.
   */
  useEffect(() => {
    function onSelectionChange(): void {
      const selection = window.getSelection()
      const body = bodyRef.current
      if (!selection || selection.isCollapsed || !body) {
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

      // Below the selection when it is close to the top, where the application
      // chrome would otherwise cover the bar.
      const flip = rect.top < 130
      const half = 110

      setBar({
        x: Math.max(half, Math.min(rect.left + rect.width / 2, window.innerWidth - half)),
        y: flip ? rect.bottom + 10 : rect.top - 8,
        flip
      })
    }

    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [bodyRef])

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
