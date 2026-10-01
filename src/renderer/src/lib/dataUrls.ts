/**
 * Folds embedded images in the source editor down to a small label.
 *
 * A browser cannot point a document at a file on the user's disk, so the web
 * build embeds an inserted image in the Markdown itself as a base64 data URL.
 * That is correct, and keeps the file self-contained, but a 40 KB picture is
 * 55,000 characters of noise in the editor, pushing the text it sits in off
 * the screen. The same happens in the Windows app with images that arrive by
 * paste or conversion.
 *
 * Only the display changes. The document keeps every byte, so saving,
 * exporting and the preview are untouched. The folded run is atomic: the
 * cursor steps over it in one move, and a selection that covers it copies all
 * of it, so it cannot be half-deleted by accident. Deleting the label deletes
 * the image data, which is what the label stands for.
 *
 * Kept identical to the copy in the Windows app. Change one, copy it across.
 */
import { RangeSetBuilder, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'

/** Short data URLs read fine inline; only fold ones that actually get in the way. */
const MIN_LENGTH = 120

/** `data:<type>;base64,<payload>`, stopping at whatever ends a Markdown or HTML URL. */
const DATA_URL = /data:([a-z]+\/[a-z0-9.+-]+);base64,[A-Za-z0-9+/=\s]+?(?=[)"'\s>]|$)/gi

function describe(mime: string, encodedLength: number): string {
  // Base64 carries 3 bytes in every 4 characters.
  const bytes = Math.round((encodedLength * 3) / 4)
  const size = bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
  const kind = mime.startsWith('image/') ? `embedded ${mime.slice(6).replace('svg+xml', 'svg').toUpperCase()} image` : `embedded ${mime} data`
  return `${kind} · ${size}`
}

class DataUrlLabel extends WidgetType {
  constructor(readonly text: string) {
    super()
  }
  eq(other: DataUrlLabel): boolean {
    return other.text === this.text
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-data-url'
    span.textContent = this.text
    span.title = 'The image itself is stored here in the document. It is folded to keep the text readable.'
    return span
  }
  ignoreEvent(): boolean {
    return false
  }
}

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const text = view.state.doc.toString()
  // Cheap early exit: nearly every document has no data URLs at all.
  if (!text.includes(';base64,')) return builder.finish()
  DATA_URL.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = DATA_URL.exec(text))) {
    if (m[0].length < MIN_LENGTH) continue
    const payload = m[0].length - m[0].indexOf(',') - 1
    builder.add(m.index, m.index + m[0].length, Decoration.replace({ widget: new DataUrlLabel(describe(m[1].toLowerCase(), payload)) }))
  }
  return builder.finish()
}

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = build(view)
    }
    update(u: ViewUpdate): void {
      if (u.docChanged) this.decorations = build(u.view)
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.decorations ?? Decoration.none)
  }
)

export function foldDataUrls(): Extension {
  return [
    plugin,
    EditorView.baseTheme({
      '.cm-data-url': {
        display: 'inline-block',
        padding: '0 6px',
        margin: '0 1px',
        borderRadius: '4px',
        fontSize: '0.85em',
        fontStyle: 'italic',
        background: 'rgba(127, 127, 127, 0.18)',
        color: 'inherit',
        opacity: '0.85',
        cursor: 'default'
      }
    })
  ]
}
