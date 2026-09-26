/**
 * Maps offsets in the *rendered* plain text of a Markdown document back to
 * offsets in the original Markdown *source*.
 *
 * The rendered text of a Markdown document is, for all practical purposes, an
 * ordered subsequence of the source: emphasis markers, list bullets, heading
 * hashes, table pipes and HTML tags are dropped, but the visible characters
 * appear in the same order. A forward two-pointer walk therefore aligns them.
 *
 * Characters that cannot be located in the source (entities, generated text)
 * are mapped to the current source cursor and do not advance it.
 */
export function buildSourceMap(source: string, rendered: string, lookahead = 6000): Int32Array {
  const map = new Int32Array(rendered.length + 1)
  let si = 0

  for (let ri = 0; ri < rendered.length; ri++) {
    const ch = rendered[ri]

    /*
     * Whitespace is recorded but never searched for, and never advances the
     * cursor.
     *
     * Matching it was what broke this. The renderer puts a newline between
     * two table cells whose source reads `| Site | Purpose |`, so searching
     * forward for that newline jumped the cursor to the end of the line,
     * past `Purpose` — which then could not be found at all, because the
     * walk only ever moves forward. From the first table or code block
     * onward every offset was wrong, and by the end of a document the cursor
     * had run so far ahead that selections mapped to nothing.
     *
     * The visible characters are what anchor the alignment; the spacing
     * between them differs by construction, since stripping markup is most
     * of what rendering does.
     */
    if (/\s/.test(ch)) {
      map[ri] = si
      continue
    }

    const limit = Math.min(source.length, si + lookahead)
    let found = -1
    for (let k = si; k < limit; k++) {
      if (source[k] === ch) {
        found = k
        break
      }
    }
    if (found === -1) {
      map[ri] = si
    } else {
      map[ri] = found
      si = found + 1
    }
  }
  map[rendered.length] = si
  return map
}

/**
 * Shrinks a range so it holds no leading or trailing whitespace.
 *
 * Double-clicking a word selects the word *and its trailing space* in every
 * browser, so a perfectly correct mapping still hands back "Press " rather
 * than "Press". Wrapping that gives `**Press **`, and emphasis with a space
 * against the marker is not emphasis at all — CommonMark requires the closing
 * delimiter to follow a non-space character. The result renders as literal
 * asterisks, and butted against the next markers it produced `****`.
 *
 * Returns null when nothing but whitespace is left, since there is no
 * sensible way to embolden a space.
 */
export function trimRange(source: string, from: number, to: number): [number, number] | null {
  let start = from
  let end = to
  while (start < end && /\s/.test(source[start])) start++
  while (end > start && /\s/.test(source[end - 1])) end--
  return end > start ? [start, end] : null
}

/** Inclusive-start / exclusive-end source range for a rendered range. */
export function toSourceRange(map: Int32Array, start: number, end: number): [number, number] {
  const n = map.length - 1
  const s = map[Math.max(0, Math.min(start, n))]
  const e = end <= 0 ? s : map[Math.max(0, Math.min(end - 1, n))] + 1
  return [Math.min(s, e), Math.max(s, e)]
}

export interface TextNodeIndexEntry {
  node: Text
  start: number
  end: number
}

/** Walks a container and returns its text nodes with cumulative offsets. */
export function indexTextNodes(root: HTMLElement): { text: string; entries: TextNodeIndexEntry[] } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      // Ignore anything the app itself injected for chrome/UI purposes.
      if (parent.closest('[data-mn-ignore]')) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    }
  })

  const entries: TextNodeIndexEntry[] = []
  let text = ''
  let node = walker.nextNode() as Text | null
  while (node) {
    const value = node.nodeValue ?? ''
    if (value.length) {
      entries.push({ node, start: text.length, end: text.length + value.length })
      text += value
    }
    node = walker.nextNode() as Text | null
  }
  return { text, entries }
}

/**
 * Converts a DOM Range into start and end offsets within `root`'s text.
 *
 * Measured by asking the browser how much text lies before each boundary,
 * rather than by looking the boundary's node up in an index. That matters
 * because a Range boundary is frequently an *element* with a child index
 * rather than a position inside a text node — which is what you get selecting
 * to the end of a paragraph, double-clicking a word, or selecting anything
 * inside a table cell or a highlighted code block.
 *
 * Resolving an element boundary by finding the nearest text node is right for
 * a start and wrong for an end: the end sits *after* the preceding node, not
 * at the start of the following one. That put closing markers several
 * characters early, so emboldening a phrase produced `**Select **any text`,
 * and in deeply nested markup it missed badly enough to land at the end of
 * the document.
 *
 * The offsets are into the concatenation of every text node under `root`,
 * which is `root.textContent` — so build the source map from that same string
 * and the two are guaranteed to agree.
 */
export function rangeToOffsets(root: HTMLElement, range: Range): [number, number] | null {
  if (!root.contains(range.commonAncestorContainer)) return null

  const probe = root.ownerDocument.createRange()
  probe.selectNodeContents(root)

  try {
    probe.setEnd(range.startContainer, range.startOffset)
    const start = probe.toString().length
    probe.setEnd(range.endContainer, range.endOffset)
    const end = probe.toString().length
    return end > start ? [start, end] : null
  } catch {
    // setEnd throws if the boundary is not inside root after all.
    return null
  }
}

/** Converts a DOM position into a global offset within the indexed text. */
export function domToOffset(entries: TextNodeIndexEntry[], node: Node, offset: number): number | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const hit = entries.find((e) => e.node === node)
    return hit ? hit.start + offset : null
  }
  // Element container: resolve to the first text node at/after the child index.
  const el = node as Element
  const child = el.childNodes[Math.min(offset, el.childNodes.length - 1)]
  if (!child) return null
  const hit = entries.find((e) => child.contains(e.node) || e.node === child)
  return hit ? hit.start : null
}
