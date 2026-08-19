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
