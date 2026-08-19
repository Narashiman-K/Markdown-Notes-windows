/**
 * Document chunking and retrieval.
 *
 * Everything here runs locally. When the loaded documents are small enough they
 * are sent whole; when they are not, BM25 keyword ranking picks the passages
 * most likely to answer the question. BM25 needs no model, no embeddings and no
 * network, which keeps the offline promise intact.
 */

export interface SourceDoc {
  id: string
  name: string
  content: string
}

export interface Chunk {
  ref: number
  docId: string
  docName: string
  heading: string
  text: string
  start: number
  end: number
}

/** Rough token estimate: English averages a little under 4 characters/token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.7)
}

const STOP = new Set(
  ('a an and are as at be by for from has have he in is it its of on or that the to was were will with what which who whom whose ' +
    'this these those there their them they i you your we our us do does did not no yes but if then than so such can could would ' +
    'should may might must about into over under again further once here when where why how all any both each few more most other ' +
    'some only own same too very').split(' ')
)

export function tokenise(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) ?? []).filter((w) => w.length > 1 && !STOP.has(w))
}

/**
 * Splits a document on headings, then on blank lines, keeping each chunk under
 * `maxChars`. Offsets point back into the original source so citations can
 * scroll to the exact passage.
 */
export function chunkDocument(doc: SourceDoc, maxChars = 1400): Chunk[] {
  const lines = doc.content.split('\n')
  const chunks: Chunk[] = []

  let heading = doc.name
  let buffer: string[] = []
  let bufferStart = 0
  let offset = 0
  let inFence = false

  const flush = (end: number): void => {
    const text = buffer.join('\n').trim()
    buffer = []
    if (!text) return
    chunks.push({
      ref: 0,
      docId: doc.id,
      docName: doc.name,
      heading,
      text,
      start: bufferStart,
      end
    })
  }

  for (const line of lines) {
    const lineStart = offset
    offset += line.length + 1

    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence

    const headingMatch = !inFence && /^(#{1,6})\s+(.+)$/.exec(line)
    if (headingMatch) {
      flush(lineStart)
      heading = headingMatch[2].replace(/<[^>]+>/g, '').trim()
      bufferStart = lineStart
      buffer.push(line)
      continue
    }

    if (!buffer.length) bufferStart = lineStart
    buffer.push(line)

    const size = buffer.join('\n').length
    if (!inFence && size >= maxChars && line.trim() === '') flush(offset)
  }
  flush(offset)

  // Strip annotation markup so the model reads the prose, not our HTML.
  return chunks.map((c) => ({ ...c, text: c.text.replace(/<\/?(?:mark|u|s|strong|em|span)\b[^>]*>/gi, '') }))
}

/** Classic BM25 over the chunk set. */
export function rankChunks(chunks: Chunk[], query: string, k1 = 1.5, b = 0.75): Array<{ chunk: Chunk; score: number }> {
  const queryTerms = tokenise(query)
  if (!queryTerms.length) return chunks.map((chunk) => ({ chunk, score: 0 }))

  const docTerms = chunks.map((c) => tokenise(c.text + ' ' + c.heading))
  const avgLen = docTerms.reduce((sum, t) => sum + t.length, 0) / Math.max(1, docTerms.length)

  const df = new Map<string, number>()
  for (const terms of docTerms) {
    for (const term of new Set(terms)) df.set(term, (df.get(term) ?? 0) + 1)
  }

  const N = chunks.length
  return chunks
    .map((chunk, i) => {
      const terms = docTerms[i]
      const freq = new Map<string, number>()
      for (const t of terms) freq.set(t, (freq.get(t) ?? 0) + 1)

      let score = 0
      for (const term of queryTerms) {
        const f = freq.get(term)
        if (!f) continue
        const n = df.get(term) ?? 0
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5))
        score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * terms.length) / Math.max(1, avgLen))))
      }
      return { chunk, score }
    })
    .sort((a, b2) => b2.score - a.score)
}

export interface ContextResult {
  chunks: Chunk[]
  truncated: boolean
  totalChunks: number
}

/**
 * Builds the context to send. Small document sets go in whole and in order;
 * larger ones are ranked, trimmed to the budget, then restored to document
 * order so the model reads them coherently.
 */
export function buildContext(docs: SourceDoc[], query: string, tokenBudget = 12000): ContextResult {
  const all = docs.flatMap((d) => chunkDocument(d))
  all.forEach((c, i) => (c.ref = i + 1))

  const totalTokens = all.reduce((sum, c) => sum + estimateTokens(c.text), 0)
  if (totalTokens <= tokenBudget) {
    return { chunks: all, truncated: false, totalChunks: all.length }
  }

  const ranked = rankChunks(all, query)
  const picked: Chunk[] = []
  let used = 0
  for (const { chunk } of ranked) {
    const cost = estimateTokens(chunk.text)
    if (used + cost > tokenBudget) continue
    picked.push(chunk)
    used += cost
    if (used > tokenBudget * 0.95) break
  }

  picked.sort((a, b) => (a.docId === b.docId ? a.start - b.start : a.docId.localeCompare(b.docId)))
  return { chunks: picked, truncated: true, totalChunks: all.length }
}

/** Formats chunks for the prompt with stable [n] reference markers. */
export function formatContext(chunks: Chunk[]): string {
  return chunks
    .map((c) => `[${c.ref}] (${c.docName} › ${c.heading})\n${c.text}`)
    .join('\n\n---\n\n')
}

/** Pulls [1], [2, 5] style citations out of an answer. */
export function extractCitations(answer: string): number[] {
  const found = new Set<number>()
  for (const m of answer.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
    for (const part of m[1].split(',')) {
      const n = Number(part.trim())
      if (Number.isFinite(n)) found.add(n)
    }
  }
  return [...found].sort((a, b) => a - b)
}
