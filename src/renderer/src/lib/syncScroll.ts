/**
 * Keeps the editor and the live preview showing the same part of the document.
 *
 * Both sides are described by the same small interface, so neither knows the
 * other exists — the editor side is implemented over CodeMirror, the preview
 * side over the `data-line` attributes the renderer stamps on block elements,
 * and `linkScrollers` just joins any two of them. That symmetry is the point:
 * scroll syncing goes wrong when one side is treated as the master, because
 * whichever pane you are not touching starts fighting you.
 *
 * Kept identical to the copy in the Windows app. Change one, copy it across.
 */

export interface ScrollSyncTarget {
  /** The element that actually scrolls. */
  readonly scroller: HTMLElement
  /** Zero-based source line currently at the top of the viewport. Fractional. */
  topLine(): number
  /** Put `line` at the top of the viewport. Must not move the caret or focus. */
  scrollToLine(line: number): void
  /**
   * True when this pane has just been rewritten and its scroll events are
   * artefacts rather than the user moving.
   */
  settling?(): boolean
}

/**
 * Builds a sync target over rendered HTML carrying `data-line` attributes.
 *
 * `scroller` is the element with the scrollbar; `content` is the element the
 * rendered Markdown lives in. They are usually different — the scrollbar
 * belongs to a padded container and the offsets have to be measured against
 * whichever one actually moves.
 */
export function previewScrollTarget(scroller: HTMLElement, content: HTMLElement): ScrollSyncTarget {
  /** line → offset from the top of the scroller's content box. */
  let anchors: Array<{ line: number; top: number }> = []
  let stale = true

  const rebuild = (): void => {
    const base = scroller.getBoundingClientRect().top - scroller.scrollTop
    const next: Array<{ line: number; top: number }> = []

    for (const el of Array.from(content.querySelectorAll<HTMLElement>('[data-line]'))) {
      const line = Number(el.dataset.line)
      if (!Number.isFinite(line)) continue
      next.push({ line, top: el.getBoundingClientRect().top - base })
    }

    // A document with no headings or paragraphs above the fold still needs a
    // starting point, or the first screenful has nothing to interpolate from.
    if (next.length === 0 || next[0].line > 0) next.unshift({ line: 0, top: 0 })

    next.sort((a, b) => a.top - b.top)
    anchors = next
    stale = false
  }

  /*
   * Measuring is invalidated by anything that changes layout: the document
   * being edited, an image finishing loading, the pane being resized. Marking
   * stale is cheap; rebuilding happens at most once per scroll.
   */
  const observers: Array<MutationObserver | ResizeObserver> = []
  let rewrittenAt = 0
  const invalidate = (): void => {
    stale = true
    rewrittenAt = performance.now()
  }

  const mutation = new MutationObserver(invalidate)
  mutation.observe(content, { childList: true, subtree: true, attributes: true })
  observers.push(mutation)

  if (typeof ResizeObserver !== 'undefined') {
    const resize = new ResizeObserver(invalidate)
    resize.observe(content)
    resize.observe(scroller)
    observers.push(resize)
  }

  /** Linear interpolation between the two anchors bracketing `value`. */
  const interpolate = (
    value: number,
    from: 'top' | 'line',
    to: 'top' | 'line'
  ): number => {
    if (stale) rebuild()
    if (anchors.length === 0) return 0

    // Anchors are sorted by top; they are sorted by line too, because the
    // renderer emits blocks in source order.
    let low = 0
    let high = anchors.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (anchors[mid][from] <= value) low = mid
      else high = mid - 1
    }

    const a = anchors[low]
    const b = anchors[low + 1]
    if (!b) return a[to]

    const span = b[from] - a[from]
    if (span <= 0) return a[to]

    const ratio = Math.min(1, Math.max(0, (value - a[from]) / span))
    return a[to] + (b[to] - a[to]) * ratio
  }

  return {
    scroller,
    topLine: () => interpolate(scroller.scrollTop, 'top', 'line'),
    scrollToLine: (line) => {
      scroller.scrollTop = interpolate(line, 'line', 'top')
    },
    /*
     * The preview is re-rendered by replacing its inner HTML on every
     * keystroke. While the new content is being laid out the container is
     * briefly shorter than its own scroll position, so the browser clamps
     * scrollTop towards zero and fires a scroll event. Following that event
     * dragged the editor to the top of the document every time a formatting
     * button was pressed, because that rewrites the whole preview at once.
     *
     * The window only has to outlast layout, not the typing.
     */
    settling: () => performance.now() - rewrittenAt < 150,
    // Exposed for teardown without widening the interface everyone else uses.
    ...({ dispose: () => observers.forEach((o) => o.disconnect()) } as object)
  } as ScrollSyncTarget & { dispose?: () => void }
}

/**
 * Makes two panes follow each other, and returns the teardown function.
 *
 * The guard is the whole trick. Scrolling A programmatically fires A's own
 * scroll event, which would scroll B, which would scroll A — a loop that shows
 * up as juddering and as the panes slowly drifting apart. Rather than a timer,
 * the flag is cleared on the next animation frame, which is exactly when the
 * browser has finished dispatching the scroll it caused.
 */
export function linkScrollers(a: ScrollSyncTarget, b: ScrollSyncTarget): () => void {
  let echo = false

  const follow = (from: ScrollSyncTarget, to: ScrollSyncTarget) => (): void => {
    if (echo || from.settling?.()) return
    echo = true
    to.scrollToLine(from.topLine())
    requestAnimationFrame(() => {
      echo = false
    })
  }

  const onA = follow(a, b)
  const onB = follow(b, a)

  a.scroller.addEventListener('scroll', onA, { passive: true })
  b.scroller.addEventListener('scroll', onB, { passive: true })

  return () => {
    a.scroller.removeEventListener('scroll', onA)
    b.scroller.removeEventListener('scroll', onB)
    for (const target of [a, b]) {
      ;(target as { dispose?: () => void }).dispose?.()
    }
  }
}
