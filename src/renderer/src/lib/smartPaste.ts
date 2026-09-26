/**
 * Paste from Word, Outlook, a browser or a spreadsheet and keep the shape.
 *
 * All of those put an HTML flavour on the clipboard next to the plain text,
 * still carrying headings, emphasis, links and table structure. An editor that
 * reads only the plain-text flavour turns a copied table into a wall of
 * tab-separated text, which is what happened here until now.
 *
 * Conversion goes through the same `htmlToMarkdown` the document converters
 * use. Pasting a table and converting a document that contains one should not
 * produce two different flavours of Markdown in the same file.
 *
 * The behaviour follows Word rather than inventing something: the formatted
 * version is pasted, and a small chooser appears at the insertion point
 * offering plain text instead. Nobody has to know a modifier key exists, and
 * anyone who does can still use one.
 *
 * Kept identical to the copy in the Windows app. Change one, copy it across.
 */
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { htmlToMarkdown } from './convert/html'

/**
 * Clipboard HTML is rarely a tidy fragment.
 *
 * Word and Excel wrap their output in a whole document with mso styles and
 * conditional comments; browsers bracket the selected part with fragment
 * markers. Turndown copes with the former, but the markers matter: without
 * trimming to them a copy from a web page drags in surrounding navigation that
 * was never highlighted.
 */
function fragment(html: string): string {
  const open = html.indexOf('<!--StartFragment-->')
  const close = html.indexOf('<!--EndFragment-->')
  if (open !== -1 && close > open) return html.slice(open + 20, close)
  return html
}

/**
 * Gives heading-less tables a heading row, so spreadsheets survive.
 *
 * The GFM rules only recognise a table that already has a `<thead>`; anything
 * else is left as raw HTML and collapses into a paragraph of run-together
 * text. Excel and Google Sheets both emit plain `<tr><td>` with no heading
 * row, which made pasting a block of cells — the single most obvious reason to
 * want this feature — produce the worst result of any source.
 *
 * Promoting the first row is what a reader does anyway when looking at a
 * spreadsheet selection. It is wrong when someone copies cells from the middle
 * of a sheet, which costs them one row; leaving it alone cost them the entire
 * table, so this is the better failure.
 *
 * Done here rather than in the shared `html.ts` deliberately. That file is
 * kept byte-identical across five projects and decides how every converted
 * document looks; a paste-time convenience has no business changing what a
 * .docx turns into.
 */
export function promoteHeaderRows(html: string): string {
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(html, 'text/html')
  } catch {
    return html
  }

  for (const table of Array.from(doc.querySelectorAll('table'))) {
    if (table.querySelector('thead')) continue

    const first = table.querySelector('tr')
    if (!first || first.children.length === 0) continue

    const head = doc.createElement('thead')
    const row = doc.createElement('tr')
    for (const cell of Array.from(first.children)) {
      const th = doc.createElement('th')
      th.innerHTML = cell.innerHTML
      row.appendChild(th)
    }
    head.appendChild(row)

    first.remove()
    table.insertBefore(head, table.firstChild)
  }

  return doc.body.innerHTML
}

/** The chooser currently on screen, if any. There is only ever one. */
let open: { dismiss: () => void } | null = null

function dismiss(): void {
  open?.dismiss()
  open = null
}

/**
 * Shows the two-button chooser at the end of what was just pasted.
 *
 * It is a plain DOM element rather than a React component so that this module
 * stays framework-free and can be shared byte-for-byte with the desktop app,
 * which renders its editor the same way but owns the rest of its interface
 * separately.
 */
function offerChoice(view: EditorView, from: number, inserted: string, plain: string): void {
  dismiss()

  const anchor = view.coordsAtPos(from + inserted.length)
  if (!anchor) return

  const host = view.dom
  const box = host.getBoundingClientRect()

  const popup = document.createElement('div')
  popup.className = 'paste-choice'
  popup.style.left = `${Math.max(4, anchor.left - box.left)}px`
  popup.style.top = `${anchor.bottom - box.top + 6}px`

  const keep = document.createElement('button')
  keep.type = 'button'
  keep.className = 'paste-choice-btn is-active'
  keep.textContent = 'Keep formatting'

  const asText = document.createElement('button')
  asText.type = 'button'
  asText.className = 'paste-choice-btn'
  asText.textContent = 'Plain text'

  popup.append(keep, asText)
  host.appendChild(popup)

  keep.addEventListener('mousedown', (event) => {
    event.preventDefault()
    dismiss()
    view.focus()
  })

  asText.addEventListener('mousedown', (event) => {
    // mousedown, not click: clicking moves focus out of the editor first, and
    // the selection would be gone by the time the handler ran.
    event.preventDefault()
    view.dispatch({
      changes: { from, to: from + inserted.length, insert: plain },
      selection: { anchor: from + plain.length },
      userEvent: 'input.paste'
    })
    dismiss()
    view.focus()
  })

  /*
   * The chooser is transient by design. It disappears on the next thing the
   * user does, whatever that is, rather than sitting there needing dismissal —
   * the paste has already happened and doing nothing is a valid choice.
   */
  const away = (): void => dismiss()
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' || !event.metaKey) dismiss()
  }
  const timer = window.setTimeout(dismiss, 8000)

  view.scrollDOM.addEventListener('scroll', away, { once: true, passive: true })
  document.addEventListener('mousedown', away, { once: true })
  view.dom.addEventListener('keydown', onKey, { once: true })

  open = {
    dismiss: () => {
      window.clearTimeout(timer)
      view.scrollDOM.removeEventListener('scroll', away)
      document.removeEventListener('mousedown', away)
      view.dom.removeEventListener('keydown', onKey)
      popup.remove()
    }
  }
}

export function smartPaste(): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const data = event.clipboardData
      if (!data) return false

      const html = data.getData('text/html')
      if (!html) return false

      const plain = data.getData('text/plain')

      let markdown: string
      try {
        markdown = htmlToMarkdown(promoteHeaderRows(fragment(html))).trim()
      } catch {
        // A clipboard we cannot parse should paste normally, not raise an
        // error over something as routine as Ctrl+V.
        return false
      }

      /*
       * Nothing to offer when the conversion matches the plain text. Copying
       * a single unformatted word still carries an HTML flavour, and a chooser
       * that appears on every paste is worse than no chooser at all.
       */
      if (!markdown || markdown === plain.trim()) return false

      event.preventDefault()

      const range = view.state.selection.main
      view.dispatch({
        changes: { from: range.from, to: range.to, insert: markdown },
        selection: { anchor: range.from + markdown.length },
        scrollIntoView: true,
        userEvent: 'input.paste'
      })

      offerChoice(view, range.from, markdown, plain)
      return true
    },

    // Losing the editor entirely should not leave the chooser floating.
    blur() {
      dismiss()
      return false
    }
  })
}
