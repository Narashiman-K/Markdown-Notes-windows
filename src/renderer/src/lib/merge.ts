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
 * A merged document remembers its parts. Each one is preceded by an invisible
 * note (an HTML comment) giving the file it came from and what was done to it:
 * whether a title was added, and how far its headings were moved. Merging a
 * merged document again first takes it back apart into those original files,
 * then applies the mode chosen now to all of them. Without that, an earlier
 * merge could only be kept exactly as it was, so merging "unchanged" and then
 * merging again "as sections" left the earlier files unchanged: the choice
 * was ignored for everything merged before. Being in the text, the notes
 * survive saving and reopening.
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

/** The first line of every merged document; says how it was joined. */
const MERGED_HEAD = /^<!-- suprasuta:merged(?: mode="(sections|concat)")? -->/
/** Before each part: which file it came from and what was done to it. */
const PART_LINE = /^<!-- suprasuta:part ((?:[\w-]+="[^"]*"\s*)*)-->$/

export function isMerged(markdown: string): boolean {
  return MERGED_HEAD.test(markdown.replace(/\r\n?/g, '\n').trimStart())
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

/**
 * Moves every heading by `by` levels: down for a positive number (`#` → `##`),
 * up for a negative one. Levels stay between 1 and 6.
 */
export function demoteHeadings(source: string, by = 1): string {
  if (by === 0) return source
  const lines = source.split('\n')
  // Bottom up, so removing a setext underline never shifts a line still to be read.
  for (const h of headings(source).reverse()) {
    const next = Math.max(1, Math.min(6, h.level + by))
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

/** How far headings must move for the highest to sit at level two. */
function shiftFor(body: string): number {
  const levels = headings(body).map((h) => h.level)
  return levels.length ? Math.max(0, 2 - Math.min(...levels)) : 0
}

/* ------------------------------------------------------- parts and notes */

interface PartNote {
  name: string
  /** A `# title` line was added because the document had none. */
  titled: boolean
  /** Headings were moved down this many levels. */
  shift: number
  /** The move applied only after the document's own title. */
  afterTitle: boolean
}

function writeNote(n: PartNote, mode: MergeMode): string {
  const attrs = [`name="${encodeURIComponent(n.name)}"`]
  if (mode === 'sections') {
    if (n.titled) attrs.push('titled="1"')
    if (n.shift) attrs.push(`shift="${n.shift}"`)
    if (n.afterTitle) attrs.push('after-title="1"')
  }
  return `<!-- suprasuta:part ${attrs.join(' ')} -->`
}

function readNote(attrs: string): PartNote {
  const get = (k: string): string | undefined => new RegExp(`${k}="([^"]*)"`).exec(attrs)?.[1]
  let name = get('name') ?? 'Untitled'
  try {
    name = decodeURIComponent(name)
  } catch {
    /* keep it as written */
  }
  return { name, titled: get('titled') === '1', shift: Number(get('shift') ?? 0) || 0, afterTitle: get('after-title') === '1' }
}

/** Reverses what sections mode did to one part, giving back the original. */
function restore(body: string, n: PartNote): string {
  let text = body.trim()
  if (n.titled) {
    // Removed only if it is still the title that was added: the user may have
    // edited the merged document since.
    const added = `# ${titleOf(n.name)}`
    const lines = text.split('\n')
    if (lines[0].trim() === added) text = lines.slice(1).join('\n').trim()
  }
  if (n.shift) {
    const own = n.afterTitle ? splitTitle(text) : null
    text = own ? `${own.title}\n${demoteHeadings(own.rest, -n.shift)}`.trim() : demoteHeadings(text, -n.shift)
  }
  return text
}

/**
 * Takes a merged document back apart into the files it was made from. Any
 * other document comes back as itself, one part.
 */
function expand(part: MergePart): MergePart[] {
  const text = part.markdown.replace(/\r\n?/g, '\n').trim()
  const head = MERGED_HEAD.exec(text)
  if (!head) return [{ name: part.name, markdown: text }]

  const mode = (head[1] as MergeMode | undefined) ?? 'sections'
  const lines = text.slice(head[0].length).split('\n')
  const marks: Array<{ at: number; note: PartNote }> = []
  lines.forEach((l, at) => {
    const m = PART_LINE.exec(l.trim())
    if (m) marks.push({ at, note: readNote(m[1]) })
  })
  // An early merged document, from before parts were recorded: keep it whole.
  if (!marks.length) return [{ name: part.name, markdown: lines.join('\n').trim() }]

  const out: MergePart[] = []
  // Anything typed above the first part since the merge stays, as its own part.
  const before = lines.slice(0, marks[0].at).join('\n').trim()
  if (before) out.push({ name: part.name, markdown: before })
  marks.forEach((m, k) => {
    let body = lines.slice(m.at + 1, k + 1 < marks.length ? marks[k + 1].at : lines.length).join('\n').trim()
    // The rule between parts belongs to the join, not to the document. Only
    // the last line is stripped: a rule inside the document is its own, and so
    // is one that ends it (that one sits just above the join's).
    if (mode === 'concat' && k + 1 < marks.length) body = body.replace(/(?:^|\n+)-{3,}[ \t]*$/, '').trim()
    out.push({ name: m.note.name, markdown: mode === 'sections' ? restore(body, m.note) : body })
  })
  return out
}

/* -------------------------------------------------------- identifiers */

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

/* --------------------------------------------------------------- merge */

function asSection(name: string, text: string): { body: string; note: PartNote } {
  const own = splitTitle(text)
  if (own) {
    // The document's own title stays the section title; what follows moves
    // down only when it competes with it.
    const by = shiftFor(own.rest)
    return {
      body: by ? `${own.title}\n${demoteHeadings(own.rest, by)}` : text,
      note: { name, titled: false, shift: by, afterTitle: by > 0 }
    }
  }
  const by = shiftFor(text)
  const body = demoteHeadings(text, by)
  return {
    body: body ? `# ${titleOf(name)}\n\n${body}` : `# ${titleOf(name)}`,
    note: { name, titled: true, shift: by, afterTitle: false }
  }
}

export function mergeDocuments(parts: MergePart[], mode: MergeMode): string {
  const ids = new Set<string>()
  const footnotes = new Set<string>()
  const files = parts.flatMap(expand).filter((p) => p.markdown.length > 0)

  const blocks = files.map((file, i) => {
    let text = uniqueAnnotationIds(file.markdown, ids)
    text = uniqueFootnotes(text, footnotes, i)
    if (mode === 'concat') {
      return `${writeNote({ name: file.name, titled: false, shift: 0, afterTitle: false }, mode)}\n\n${text}`
    }
    const { body, note } = asSection(file.name, text)
    return `${writeNote(note, mode)}\n\n${body}`
  })

  // A blank line on both sides of the rule keeps `---` from being read as a
  // setext underline for the line above it.
  const joiner = mode === 'concat' ? '\n\n---\n\n' : '\n\n'
  return `<!-- suprasuta:merged mode="${mode}" -->\n\n${blocks.join(joiner)}\n`
}
