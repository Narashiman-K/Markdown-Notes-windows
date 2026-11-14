/**
 * In the editor: while the cursor is inside a Markdown table, a small
 * "✎ Edit table" button sits at the end of the table's first line, right next
 * to the table, and scrolls with it. Pressing it opens the table editor.
 *
 * Kept identical across the Windows app and the web app.
 */
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { StateField, type EditorState, type Extension } from '@codemirror/state'

const isRow = (text: string): boolean => /^\s{0,3}\|/.test(text)

class ChipWidget extends WidgetType {
  constructor(private readonly open: () => void) {
    super()
  }
  eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const b = document.createElement('button')
    b.className = 'cm-table-chip'
    b.type = 'button'
    b.textContent = '✎ Edit table'
    b.title = 'Open the table editor for this table'
    // Keep the cursor in the table: the editor finds the table from it.
    b.addEventListener('mousedown', (e) => e.preventDefault())
    b.addEventListener('click', (e) => {
      e.preventDefault()
      this.open()
    })
    return b
  }
  ignoreEvent(): boolean {
    return true
  }
}

function build(state: EditorState, open: () => void): DecorationSet {
  const sel = state.selection.main
  const doc = state.doc
  let line = doc.lineAt(sel.head)
  if (!isRow(line.text)) return Decoration.none
  // Walk up to the table's first line.
  while (line.number > 1 && isRow(doc.line(line.number - 1).text)) line = doc.line(line.number - 1)
  // A table needs its divider line under the first one.
  const divider = line.number < doc.lines ? doc.line(line.number + 1).text : ''
  if (!/^\s{0,3}\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(divider)) return Decoration.none
  return Decoration.set([Decoration.widget({ widget: new ChipWidget(open), side: 1 }).range(line.to)])
}

export function tableChip(open: () => void): Extension {
  return StateField.define<DecorationSet>({
    create: (state) => build(state, open),
    update: (deco, tr) => (tr.docChanged || tr.selection ? build(tr.state, open) : deco),
    provide: (f) => EditorView.decorations.from(f)
  })
}
