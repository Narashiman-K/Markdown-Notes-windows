/**
 * Merging several Markdown documents into one.
 *
 * Two ways, and the user chooses each time:
 *
 *   sections — each document becomes one section of a single outline. A
 *              document that opens with a `#` heading keeps it as its title,
 *              and any later `#` headings move down a level beneath it. A
 *              document with no title of its own gets its file name as one.
 *              Headings move down only as far as needed for the highest to
 *              sit at level two, so the result has one clean outline with no
 *              competing top-level headings and no skipped levels.
 *   concat   — the documents are placed one after another, separated by a
 *              horizontal rule, with their text untouched.
 *
 * Either way, two things that would silently break in a naive join are put
 * right, because they are identifiers rather than text:
 *
 *   - annotation ids: a document merged with a copy of itself carries the
 *     same `data-mn-id` twice, and removing one annotation would then remove
 *     both. Later duplicates get fresh ids.
 *   - footnote labels: two documents each with a `[^1]` would point both
 *     references at whichever definition comes first. Later duplicates are
 *     renamed `[^1-2]` and so on.
 *
 * Headings are found with markdown-it's own parser rather than by pattern,
 * so `#` lines inside code blocks and setext headings (underlined with `===`
 * or `---`) are handled the way the renderer handles them.
 *
 * Kept identical to the copy in the Windows app. Change one, copy it across.
 */
import { md } from './markdown'
import { newId } from './annotations'

export type MergeMode = 'sections' | 'concat'

export interface MergePart {
  /** File name, used as the section title when the document has none. */
  name: string
  markdown: string
}

function titleOf(name: string): string {
  return name.replace(/\.[^./\\]+$/, '').replace(/[_]+/g, ' ').trim() || 'Untitled'
}

interface HeadingAt {
  level: number
  /** Zero-based line of the heading text. */
  line: number
  /** Last line of the heading (the underline, for setext). */
  end: number
  setext: boolean
}

function headings(source: string): HeadingAt[] {
  const out: HeadingAt[] = []
  for (const t of md.parse(source, {})) {
    if (t.type !== 'heading_open' || !t.map) continue
    out.push({
      level: Number(t.tag.slice(1)),
      line: t.map[0],
      end: t.map[1] - 1,
      setext: t.markup === '=' || t.markup === '-'
    })
  }
  return out
}

/** Moves every heading down `by` levels (`#` → `##` for 1); nothing goes past `######`. */
export function demoteHeadings(source: string, by = 1): string {
  if (by <= 0) return source
  const lines = source.split('\n')
  // Bottom up, so removing a setext underline never shifts a line still to be read.
  for (const h of headings(source).reverse()) {
    const next = Math.min(6, h.level + by)
    if (h.setext) {
      const text = lines.slice(h.line, h.end).join(' ').trim()
      lines.splice(h.line, h.end - h.line + 1, `${'#'.repeat(next)} ${text}`)
    } else {
      lines[h.line] = lines[h.line].replace(/^(\s{0,3})#{1,6}/, `$1${'#'.repeat(next)}`)
    }
  }
  return lines.join('\n')
}

/**
 * When the document opens with a `#` heading, that heading is its title.
 *
 * Returns the title's lines and the rest, or null when the document starts with
 * anything else. Converted Word files are the common case for the rest also
 * holding `#` headings: a Title paragraph and Heading 1 sections both come out
 * at level one.
 */
function splitTitle(source: string): { title: string; rest: string } | null {
  const first = headings(source)[0]
  if (!first || first.level !== 1) return null
  const lines = source.split('\n')
  if (lines.slice(0, first.line).join('\n').trim() !== '') return null
  return { title: lines.slice(0, first.end + 1).join('\n'), rest: lines.slice(first.end + 1).join('\n') }
}

/** Gives annotations fresh ids when an earlier document already used theirs. */
function uniqueAnnotationIds(source: string, seen: Set<string>): string {
  const ids = new Set<string>()
  for (const m of source.matchAll(/data-mn-id="([^"]+)"/g)) ids.add(m[1])
  let out = source
  for (const id of ids) {
    if (seen.has(id)) {
      const fresh = newId()
      out = out.split(`data-mn-id="${id}"`).join(`data-mn-id="${fresh}"`)
      seen.add(fresh)
    } else {
      seen.add(id)
    }
  }
  return out
}

/** Renames footnote labels an earlier document already used. */
function uniqueFootnotes(source: string, seen: Set<string>, index: number): string {
  const labels = new Set<string>()
  for (const m of source.matchAll(/\[\^([^\]\s]+)\]/g)) labels.add(m[1])
  let out = source
  for (const label of labels) {
    if (seen.has(label)) {
      let fresh = `${label}-${index + 1}`
      let n = 2
      while (seen.has(fresh) || labels.has(fresh)) fresh = `${label}-${index + 1}-${n++}`
      out = out.split(`[^${label}]`).join(`[^${fresh}]`)
      seen.add(fresh)
    } else {
      seen.add(label)
    }
  }
  return out
}

export function mergeDocuments(parts: MergePart[], mode: MergeMode): string {
  const ids = new Set<string>()
  const footnotes = new Set<string>()

  const bodies = parts.map((part, i) => {
    let text = part.markdown.replace(/\r\n?/g, '\n').trim()
    text = uniqueAnnotationIds(text, ids)
    text = uniqueFootnotes(text, footnotes, i)
    if (mode === 'concat') return text
    // Headings move down only as far as needed for the highest of them to sit
    // directly under the section title, at level two. Moving every heading by
    // one regardless left a gap (title, then straight to level three) in any
    // document whose headings already started at level two.
    const shiftFor = (body: string): number => {
      const levels = headings(body).map((h) => h.level)
      return levels.length ? Math.max(0, 2 - Math.min(...levels)) : 0
    }
    const own = splitTitle(text)
    if (own) {
      // The document's own title stays the section title.
      const by = shiftFor(own.rest)
      return by ? `${own.title}\n${demoteHeadings(own.rest, by)}` : text
    }
    const body = demoteHeadings(text, shiftFor(text))
    return body ? `# ${titleOf(part.name)}\n\n${body}` : `# ${titleOf(part.name)}`
  })

  // A blank line on both sides of the rule keeps `---` from being read as a
  // setext underline for the line above it.
  const joiner = mode === 'concat' ? '\n\n---\n\n' : '\n\n'
  return bodies.filter((b) => b.length > 0).join(joiner) + '\n'
}
