/**
 * Compare two documents: which lines changed, and inside each changed block
 * which words.
 *
 * Nothing is ignored. Spacing, line breaks, case and formatting marks all
 * count: a change is a change, and the reader decides whether it matters.
 * Only Windows line endings (CRLF) are read as plain line breaks, because
 * they cannot be seen and would otherwise mark every line of a file.
 *
 * Myers' difference algorithm, first over lines and then over the words of
 * each changed block. It is fast when the documents are mostly alike (the
 * usual case) and is cut off on a pathological pair, which then shows as one
 * large change rather than freezing the app.
 *
 * Kept identical across the Windows app and the web app.
 */

export type Side = 'left' | 'right'

/** A run of lines the two documents share. */
export interface Same {
  kind: 'same'
  lines: string[]
  leftStart: number
  rightStart: number
}

/** A block where they differ; one side may be empty (a pure addition or removal). */
export interface Change {
  kind: 'change'
  /** 0-based number of this change, for "Change 3 of 12". */
  index: number
  left: string[]
  right: string[]
  leftStart: number
  rightStart: number
  /** Word by word: what is common, only on the left, only on the right. */
  words: WordPart[]
}

export type Block = Same | Change

export interface WordPart {
  op: 'same' | 'left' | 'right'
  text: string
}

export interface Comparison {
  blocks: Block[]
  changes: Change[]
  stats: { changes: number; wordsLeftOnly: number; wordsRightOnly: number; linesLeft: number; linesRight: number }
}

/** Beyond this many edits the trace would need too much memory (it grows with the square). */
const MAX_EDITS = 2000

export function normaliseNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/** Lines, without the empty one after a final newline. */
function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

type Op = ['=' | '-' | '+', number]

/**
 * Myers' O(ND) diff over two arrays. Returns runs of equal (=), left-only (-)
 * and right-only (+) items in order, or null when more than `maxEdits` edits
 * would be needed.
 */
export function myers<T>(a: readonly T[], b: readonly T[], maxEdits = MAX_EDITS): Op[] | null {
  const n = a.length
  const m = b.length
  const max = Math.min(n + m, maxEdits)
  const offset = max + 1
  let v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  let found = -1
  for (let d = 0; d <= max; d++) {
    // Only the diagonals step d can read: -d-1 .. d+1.
    trace.push(v.slice(offset - d - 1, offset + d + 2))
    const next = v
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      next[offset + k] = x
      if (x >= n && y >= m) {
        found = d
        break
      }
    }
    v = next
    if (found >= 0) break
  }
  if (found < 0) return null

  // Walk back through the trace to recover the path.
  const ops: Array<'=' | '-' | '+'> = []
  let x = n
  let y = m
  for (let d = found; d > 0; d--) {
    // trace[d] was copied before step d ran: the furthest points after d - 1 edits.
    const pv = trace[d]
    const at = (kk: number): number => pv[kk + d + 1]
    const k = x - y
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1
    const prevX = at(prevK)
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      ops.push('=')
      x--
      y--
    }
    if (x === prevX) {
      ops.push('+')
      y--
    } else {
      ops.push('-')
      x--
    }
  }
  while (x > 0 && y > 0) {
    ops.push('=')
    x--
    y--
  }
  ops.reverse()

  const runs: Op[] = []
  for (const op of ops) {
    const last = runs[runs.length - 1]
    if (last && last[0] === op) last[1]++
    else runs.push([op, 1])
  }
  return runs
}

/** Words, the spaces between them and punctuation, each its own token; any script. */
export function tokenize(text: string): string[] {
  return text.match(/\s+|[\p{L}\p{M}\p{N}_]+|[^\s\p{L}\p{M}\p{N}_]/gu) ?? []
}

export function diffWords(left: string, right: string): WordPart[] {
  const a = tokenize(left)
  const b = tokenize(right)
  const runs = myers(a, b)
  const parts: WordPart[] = []
  const push = (op: WordPart['op'], text: string): void => {
    if (!text) return
    const last = parts[parts.length - 1]
    if (last && last.op === op) last.text += text
    else parts.push({ op, text })
  }
  if (!runs) {
    push('left', left)
    push('right', right)
    return parts
  }
  let i = 0
  let j = 0
  for (const [op, count] of runs) {
    if (op === '=') {
      push('same', a.slice(i, i + count).join(''))
      i += count
      j += count
    } else if (op === '-') {
      push('left', a.slice(i, i + count).join(''))
      i += count
    } else {
      push('right', b.slice(j, j + count).join(''))
      j += count
    }
  }
  return parts
}

export function compareTexts(leftText: string, rightText: string): Comparison {
  const a = splitLines(normaliseNewlines(leftText))
  const b = splitLines(normaliseNewlines(rightText))

  // Same head and tail first: most comparisons differ in a few places.
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  const midA = a.slice(head, a.length - tail)
  const midB = b.slice(head, b.length - tail)
  const runs = myers(midA, midB) ?? ([['-', midA.length], ['+', midB.length]] as Op[])

  const blocks: Block[] = []
  const changes: Change[] = []
  const same = (lines: string[], leftStart: number, rightStart: number): void => {
    if (lines.length) blocks.push({ kind: 'same', lines, leftStart, rightStart })
  }
  same(a.slice(0, head), 0, 0)

  let i = head
  let j = head
  let pendingLeft: string[] = []
  let pendingRight: string[] = []
  let pendingAt: [number, number] = [i, j]
  const flush = (): void => {
    if (!pendingLeft.length && !pendingRight.length) return
    const change: Change = {
      kind: 'change',
      index: changes.length,
      left: pendingLeft,
      right: pendingRight,
      leftStart: pendingAt[0],
      rightStart: pendingAt[1],
      words: diffWords(pendingLeft.join('\n'), pendingRight.join('\n'))
    }
    changes.push(change)
    blocks.push(change)
    pendingLeft = []
    pendingRight = []
  }
  for (const [op, count] of runs) {
    if (count === 0) continue
    if (op === '=') {
      flush()
      same(a.slice(i, i + count), i, j)
      i += count
      j += count
      pendingAt = [i, j]
    } else if (op === '-') {
      pendingLeft.push(...a.slice(i, i + count))
      i += count
    } else {
      pendingRight.push(...b.slice(j, j + count))
      j += count
    }
  }
  flush()
  same(a.slice(a.length - tail), a.length - tail, b.length - tail)

  let wordsLeftOnly = 0
  let wordsRightOnly = 0
  const countWords = (s: string): number => (s.match(/[\p{L}\p{M}\p{N}_]+/gu) ?? []).length || (s.trim() ? 1 : 0)
  for (const c of changes) {
    for (const w of c.words) {
      if (w.op === 'left') wordsLeftOnly += countWords(w.text)
      else if (w.op === 'right') wordsRightOnly += countWords(w.text)
    }
  }
  return {
    blocks,
    changes,
    stats: { changes: changes.length, wordsLeftOnly, wordsRightOnly, linesLeft: a.length, linesRight: b.length }
  }
}

/**
 * One side's text with one change taken from the other side. `into` is the
 * side that changes; the change's lines from the other side replace its own.
 * The result keeps the side's final newline, if it had one.
 */
export function takeChange(comparison: Comparison, changeIndex: number, into: Side, current: string): string {
  const lines: string[] = []
  for (const block of comparison.blocks) {
    if (block.kind === 'same') lines.push(...block.lines)
    else if (block.index === changeIndex) lines.push(...(into === 'left' ? block.right : block.left))
    else lines.push(...(into === 'left' ? block.left : block.right))
  }
  return joinLike(lines, current)
}

/** One side's text with one change's lines on that side replaced by `edited`. */
export function replaceChangeSide(comparison: Comparison, changeIndex: number, side: Side, edited: string, current: string): string {
  const lines: string[] = []
  for (const block of comparison.blocks) {
    if (block.kind === 'same') lines.push(...block.lines)
    else if (block.index === changeIndex) lines.push(...(edited === '' ? [] : normaliseNewlines(edited).split('\n')))
    else lines.push(...(side === 'left' ? block.left : block.right))
  }
  return joinLike(lines, current)
}

function joinLike(lines: string[], current: string): string {
  const text = lines.join('\n')
  return text && /\n$/.test(current) ? `${text}\n` : text
}

/* ------------------------------------------------------------- reports */

export interface ReportNames {
  left: string
  right: string
}

function describeAt(c: Change): string {
  const where = (start: number, count: number): string =>
    count === 0 ? `after line ${start}` : count === 1 ? `line ${start + 1}` : `lines ${start + 1}–${start + count}`
  return `${where(c.leftStart, c.left.length)} ↔ ${where(c.rightStart, c.right.length)}`
}

/** The changes as a unified diff, with a little context: for AI and for export. */
export function unifiedDiff(comparison: Comparison, names: ReportNames, context = 2, limit = Infinity): string {
  const out: string[] = [`--- ${names.left}`, `+++ ${names.right}`]
  const blocks = comparison.blocks
  for (let b = 0; b < blocks.length; b++) {
    const block = blocks[b]
    if (block.kind !== 'change') continue
    out.push(`@@ Change ${block.index + 1}: ${describeAt(block)} @@`)
    const before = blocks[b - 1]
    if (before?.kind === 'same') for (const l of before.lines.slice(-context)) out.push(`  ${l}`)
    for (const l of block.left) out.push(`- ${l}`)
    for (const l of block.right) out.push(`+ ${l}`)
    const after = blocks[b + 1]
    if (after?.kind === 'same') for (const l of after.lines.slice(0, context)) out.push(`  ${l}`)
    if (out.join('\n').length > limit) {
      out.push(`… (${comparison.changes.length - block.index - 1} more changes not shown)`)
      break
    }
  }
  return out.join('\n')
}

export function markdownReport(comparison: Comparison, names: ReportNames, when = new Date()): string {
  const s = comparison.stats
  const fence = '```'
  return [
    `# Comparison: ${names.left} ↔ ${names.right}`,
    '',
    `*${when.toLocaleString()}*`,
    '',
    `| | ${names.left} | ${names.right} |`,
    '|---|---|---|',
    `| Lines | ${s.linesLeft} | ${s.linesRight} |`,
    `| Words only here | ${s.wordsLeftOnly} | ${s.wordsRightOnly} |`,
    '',
    `**${s.changes} change${s.changes === 1 ? '' : 's'}.** Lines starting with \`-\` are only in ${names.left}; with \`+\`, only in ${names.right}.`,
    '',
    `${fence}diff`,
    unifiedDiff(comparison, names),
    fence,
    ''
  ].join('\n')
}

const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A self-contained page: the side-by-side view as it looks in the app. */
export function htmlReport(comparison: Comparison, names: ReportNames, when = new Date()): string {
  const s = comparison.stats
  const sideHtml = (c: Change, side: Side): string =>
    c.words
      .filter((w) => w.op === 'same' || w.op === side)
      .map((w) => (w.op === 'same' ? esc(w.text) : `<span class="${side === 'left' ? 'del' : 'ins'}">${esc(w.text)}</span>`))
      .join('')
  const rows: string[] = []
  for (const block of comparison.blocks) {
    if (block.kind === 'same') {
      const shown = block.lines.length > 8 ? [...block.lines.slice(0, 3), null, ...block.lines.slice(-3)] : block.lines
      for (const l of shown) {
        rows.push(
          l === null
            ? `<tr class="gap"><td colspan="2">… ${block.lines.length - 6} unchanged lines …</td></tr>`
            : `<tr><td>${esc(l)}</td><td>${esc(l)}</td></tr>`
        )
      }
    } else {
      rows.push(
        `<tr class="chg"><td><div class="n">Change ${block.index + 1}</div>${sideHtml(block, 'left')}</td><td><div class="n">&nbsp;</div>${sideHtml(block, 'right')}</td></tr>`
      )
    }
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>Comparison: ${esc(names.left)} ↔ ${esc(names.right)}</title>
<style>
body{font:14px/1.5 system-ui,'Segoe UI',sans-serif;margin:24px;color:#1f2328}
h1{font-size:20px} table{width:100%;border-collapse:collapse;table-layout:fixed}
th,td{border:1px solid #d0d7de;padding:4px 8px;vertical-align:top;white-space:pre-wrap;word-wrap:break-word}
th{background:#f6f8fa;text-align:left} tr.chg td{background:#fffbe6}
.del{background:#ffd7d5;text-decoration:line-through;color:#82071e}.ins{background:#ccffd8;color:#055d20}
.gap td{color:#6e7781;text-align:center;font-style:italic;background:#f6f8fa}.n{font-size:11px;color:#6e7781}
</style></head><body>
<h1>Comparison</h1>
<p>${esc(when.toLocaleString())} · <b>${s.changes}</b> change${s.changes === 1 ? '' : 's'} · ${s.wordsLeftOnly} words only on the left, ${s.wordsRightOnly} only on the right</p>
<table><thead><tr><th>${esc(names.left)}</th><th>${esc(names.right)}</th></tr></thead><tbody>
${rows.join('\n')}
</tbody></table></body></html>`
}
