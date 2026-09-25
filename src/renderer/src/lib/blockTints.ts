/**
 * Background tints marking where each Markdown block starts and ends.
 *
 * Converted documents produce long stretches with no visual structure — a
 * spreadsheet becomes a two hundred line table that looks exactly like the
 * prose above it. Syntax highlighting colours the *markers*, which does not
 * help when the markers are off screen, and that is precisely when you need to
 * know whether you are still inside the block.
 *
 * Ranges come from the Lezer tree the Markdown language mode already maintains,
 * not from a second parse or from regular expressions. That matters twice over:
 * a regex for a fence has to guess about fences nested in blockquotes and stray
 * backticks in prose, and Lezer's tree is incremental, so typing inside a large
 * document reuses the parse instead of redoing it.
 *
 * Kept identical to the copy in the Windows app. Change one, copy it across.
 */
import { syntaxTree } from '@codemirror/language'
import { RangeSetBuilder, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'

export type BlockKind = 'codeBlock' | 'blockquote' | 'table' | 'heading'

export const BLOCK_KINDS: readonly BlockKind[] = ['codeBlock', 'blockquote', 'table', 'heading']

export const DEFAULT_BLOCK_TINTS: readonly BlockKind[] = ['codeBlock', 'blockquote']

/**
 * Lezer node names per kind.
 *
 * `CodeBlock` is the indented form and `FencedCode` the ``` form; both read as
 * "code" to anyone looking at the screen, so both get the same tint.
 */
const NODES: Record<BlockKind, readonly string[]> = {
  codeBlock: ['FencedCode', 'CodeBlock'],
  blockquote: ['Blockquote'],
  table: ['Table'],
  heading: [
    'ATXHeading1',
    'ATXHeading2',
    'ATXHeading3',
    'ATXHeading4',
    'ATXHeading5',
    'ATXHeading6',
    'SetextHeading1',
    'SetextHeading2'
  ]
}

/**
 * Light and dark values per kind.
 *
 * Alpha rather than solid colour throughout, so the tint sits under the
 * selection highlight, the active-line highlight and the search match highlight
 * without any of them having to know about it. Deliberately weak: this is meant
 * to be noticed peripherally while scrolling, not read.
 */
const COLOURS: Record<BlockKind, { light: string; dark: string }> = {
  codeBlock: { light: 'rgba(0,0,0,0.045)', dark: 'rgba(255,255,255,0.055)' },
  blockquote: { light: 'rgba(0,102,204,0.06)', dark: 'rgba(124,183,255,0.08)' },
  table: { light: 'rgba(107,63,212,0.06)', dark: 'rgba(157,124,255,0.08)' },
  heading: { light: 'rgba(176,114,0,0.06)', dark: 'rgba(255,201,124,0.08)' }
}

function lineDecorations(kinds: readonly BlockKind[], dark: boolean): Record<string, Decoration> {
  const byNode: Record<string, Decoration> = {}
  for (const kind of kinds) {
    const colour = COLOURS[kind][dark ? 'dark' : 'light']
    const decoration = Decoration.line({ attributes: { style: `background-color:${colour}` } })
    for (const node of NODES[kind]) byNode[node] = decoration
  }
  return byNode
}

/**
 * The editor extension.
 *
 * Wrap it in a Compartment at the call site so the setting can be changed
 * without rebuilding the editor — recreating the view would throw away the
 * undo history, which is a poor trade for a colour change.
 */
export function blockTints(kinds: readonly BlockKind[], dark: boolean): Extension {
  if (kinds.length === 0) return []

  const byNode = lineDecorations(kinds, dark)

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = this.build(view)
      }

      update(update: ViewUpdate): void {
        // Viewport changes matter as much as document changes: only the visible
        // range is decorated, so scrolling has to rebuild.
        if (update.docChanged || update.viewportChanged) {
          this.decorations = this.build(update.view)
        }
      }

      build(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>()
        const tree = syntaxTree(view.state)

        /*
         * Only the visible ranges are walked. A converted EPUB runs to tens of
         * thousands of lines, and decorating all of them would cost on every
         * keystroke for the sake of lines nobody is looking at.
         *
         * Line decorations must be added in document order or RangeSetBuilder
         * throws, hence collecting first and sorting — a blockquote containing
         * a fence yields the inner node before the enclosing one finishes.
         */
        const lines: Array<{ from: number; decoration: Decoration }> = []

        for (const { from, to } of view.visibleRanges) {
          tree.iterate({
            from,
            to,
            enter: (node) => {
              const decoration = byNode[node.name]
              if (!decoration) return
              const first = view.state.doc.lineAt(Math.max(node.from, 0))
              const last = view.state.doc.lineAt(Math.min(node.to, view.state.doc.length))
              for (let n = first.number; n <= last.number; n++) {
                lines.push({ from: view.state.doc.line(n).from, decoration })
              }
            }
          })
        }

        lines.sort((a, b) => a.from - b.from)

        // A line inside both a blockquote and a fence would otherwise be added
        // twice, and the second add is a no-op that still costs a comparison.
        let previous = -1
        for (const line of lines) {
          if (line.from === previous) continue
          builder.add(line.from, line.from, line.decoration)
          previous = line.from
        }

        return builder.finish()
      }
    },
    { decorations: (plugin) => plugin.decorations }
  )
}
