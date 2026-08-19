export interface TextEdit {
  text: string
  selectionStart: number
  selectionEnd: number
}

/** Wraps the selection with `before`/`after`, or toggles it off if present. */
export function wrapSelection(text: string, from: number, to: number, before: string, after = before): TextEdit {
  const sel = text.slice(from, to)
  const pre = text.slice(0, from)
  const post = text.slice(to)

  if (pre.endsWith(before) && post.startsWith(after)) {
    return {
      text: pre.slice(0, -before.length) + sel + post.slice(after.length),
      selectionStart: from - before.length,
      selectionEnd: to - before.length
    }
  }
  if (sel.startsWith(before) && sel.endsWith(after) && sel.length >= before.length + after.length) {
    const inner = sel.slice(before.length, sel.length - after.length)
    return { text: pre + inner + post, selectionStart: from, selectionEnd: from + inner.length }
  }
  return {
    text: pre + before + sel + after + post,
    selectionStart: from + before.length,
    selectionEnd: to + before.length
  }
}

/** Applies a line prefix (heading, quote, list) to every line in the selection. */
export function prefixLines(text: string, from: number, to: number, prefix: string, numbered = false): TextEdit {
  const lineStart = text.lastIndexOf('\n', from - 1) + 1
  let lineEnd = text.indexOf('\n', to)
  if (lineEnd === -1) lineEnd = text.length
  const block = text.slice(lineStart, lineEnd)
  const lines = block.split('\n')
  const stripped = lines.map((l) => l.replace(/^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/, ''))
  const already = lines.every((l, i) => l !== stripped[i]) && lines.some((l) => l.startsWith(prefix))
  const next = already ? stripped : stripped.map((l, i) => (numbered ? `${i + 1}. ${l}` : `${prefix}${l}`))
  const replaced = next.join('\n')
  return {
    text: text.slice(0, lineStart) + replaced + text.slice(lineEnd),
    selectionStart: lineStart,
    selectionEnd: lineStart + replaced.length
  }
}

export function insertBlock(text: string, from: number, to: number, block: string): TextEdit {
  const needsLeading = from > 0 && text[from - 1] !== '\n'
  const body = (needsLeading ? '\n\n' : '') + block + '\n'
  return {
    text: text.slice(0, from) + body + text.slice(to),
    selectionStart: from + body.length,
    selectionEnd: from + body.length
  }
}

export const TABLE_SNIPPET = `| Column A | Column B | Column C |
| --- | --- | --- |
|  |  |  |
|  |  |  |`

export function toFileUrl(p: string): string {
  const normalised = p.replace(/\\/g, '/')
  return encodeURI(normalised.startsWith('/') ? `file://${normalised}` : `file:///${normalised}`)
}
