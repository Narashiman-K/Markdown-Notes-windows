/**
 * Minimal line diff for the AI change-review dialog.
 *
 * Longest common subsequence over lines, then a walk to produce add/remove/keep
 * rows. Documents here are human-sized, so an O(n·m) table is fine and avoids
 * pulling in a diff dependency.
 */

export type DiffOp = 'keep' | 'add' | 'remove'

export interface DiffRow {
  op: DiffOp
  text: string
  oldLine?: number
  newLine?: number
}

export function diffLines(before: string, after: string): DiffRow[] {
  const a = before.split('\n')
  const b = after.split('\n')

  // Trim identical head and tail first; most edits are local.
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++

  const midA = a.slice(head, a.length - tail)
  const midB = b.slice(head, b.length - tail)

  const rows: DiffRow[] = []
  for (let i = 0; i < head; i++) rows.push({ op: 'keep', text: a[i], oldLine: i + 1, newLine: i + 1 })

  // LCS table over the differing middles.
  const n = midA.length
  const m = midB.length
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = midA[i] === midB[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }

  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      rows.push({ op: 'keep', text: midA[i], oldLine: head + i + 1, newLine: head + j + 1 })
      i++
      j++
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      rows.push({ op: 'remove', text: midA[i], oldLine: head + i + 1 })
      i++
    } else {
      rows.push({ op: 'add', text: midB[j], newLine: head + j + 1 })
      j++
    }
  }
  while (i < n) rows.push({ op: 'remove', text: midA[i], oldLine: head + i++ + 1 })
  while (j < m) rows.push({ op: 'add', text: midB[j], newLine: head + j++ + 1 })

  for (let k = 0; k < tail; k++) {
    const idx = a.length - tail + k
    rows.push({ op: 'keep', text: a[idx], oldLine: idx + 1, newLine: b.length - tail + k + 1 })
  }
  return rows
}

export interface DiffStats {
  added: number
  removed: number
}

export function diffStats(rows: DiffRow[]): DiffStats {
  return {
    added: rows.filter((r) => r.op === 'add').length,
    removed: rows.filter((r) => r.op === 'remove').length
  }
}

/** Drops long runs of unchanged lines, keeping `pad` lines around each change. */
export function collapseUnchanged(rows: DiffRow[], pad = 3): Array<DiffRow | { op: 'gap'; count: number }> {
  const changed = new Set<number>()
  rows.forEach((r, i) => {
    if (r.op !== 'keep') {
      for (let k = Math.max(0, i - pad); k <= Math.min(rows.length - 1, i + pad); k++) changed.add(k)
    }
  })

  const out: Array<DiffRow | { op: 'gap'; count: number }> = []
  let gap = 0
  rows.forEach((r, i) => {
    if (changed.has(i)) {
      if (gap) {
        out.push({ op: 'gap', count: gap })
        gap = 0
      }
      out.push(r)
    } else {
      gap++
    }
  })
  if (gap) out.push({ op: 'gap', count: gap })
  return out
}
