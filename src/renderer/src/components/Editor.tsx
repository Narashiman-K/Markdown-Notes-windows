import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import FormatToolbar from './FormatToolbar'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  rectangularSelection,
  crosshairCursor,
  highlightSpecialChars
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab, undo as cmUndo, redo as cmRedo } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches, search, openSearchPanel } from '@codemirror/search'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, HighlightStyle } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import type { TextEdit } from '../lib/editing'
import { blockTints, DEFAULT_BLOCK_TINTS, type BlockKind } from '../lib/blockTints'
import type { ScrollSyncTarget } from '../lib/syncScroll'
import { smartPaste } from '../lib/smartPaste'

export interface EditorHandle {
  getSelection: () => { from: number; to: number }
  applyEdit: (edit: TextEdit) => void
  getValue: () => string
  focus: () => void
  gotoLine: (line: number) => void
  /** Returns false when the editor's own history had nothing to reverse. */
  undo: () => boolean
  redo: () => boolean
  /** Scroll-sync handle, or null before the view exists. */
  scrollTarget: () => ScrollSyncTarget | null
  /** Opens CodeMirror's find-and-replace panel. */
  openSearch: () => void
}

interface Props {
  value: string
  dark: boolean
  zoom: number
  onChange: (value: string) => void
  onCursor?: (line: number, col: number) => void
  /** Fires when a button on the floating selection toolbar is pressed. */
  onFormat?: (action: string) => void
  /** Which block kinds get a background tint. Omit for the default pair. */
  blockTintKinds?: readonly BlockKind[]
  /**
   * Reports the scroll-sync handle each time the underlying view is built,
   * and null when it goes away.
   *
   * Pulling the handle through a ref does not work: the ref never changes
   * identity, so anything depending on it cannot tell that the CodeMirror
   * instance behind it was replaced. The view is rebuilt whenever the theme
   * or the zoom changes, and on every hot reload, and each time that happened
   * scroll syncing stayed bound to the discarded instance and silently died.
   */
  onScrollTarget?: (target: ScrollSyncTarget | null) => void
}

/*
 * Held in a compartment so the tint setting can be changed on a live editor.
 * The alternative — adding it to the dependency list that rebuilds the view —
 * would discard the undo history every time someone toggled a colour.
 */
const tintCompartment = new Compartment()

/**
 * The scroll-sync view of a CodeMirror instance.
 *
 * Lines are reported zero-based to match `data-line` in the rendered HTML;
 * CodeMirror counts from one, hence the adjustments. Line blocks are used
 * rather than multiplying by a line height, because wrapped lines and the
 * tinted blocks make rows different heights, and a uniform-height assumption
 * drifts badly in exactly the long documents this exists for.
 *
 * The coordinate conversion is the part that has to be right. CodeMirror's
 * block `top` values are measured from the top of the *document*, while
 * `scrollDOM.scrollTop` is measured from the top of the *scroller* — and the
 * two differ by the scroller's padding, 12px at the top and 40vh at the
 * bottom here. Treating them as the same number offsets every lookup by that
 * padding and the panes never line up. `view.documentTop` is the document's
 * current screen position, so going through screen coordinates keeps the two
 * spaces honest without hard-coding anything about the padding.
 */
function makeScrollTarget(view: EditorView): ScrollSyncTarget {
  /** Height within the document that currently sits at the scroller's top edge. */
  const heightAtTop = (): number => view.scrollDOM.getBoundingClientRect().top - view.documentTop

  return {
    scroller: view.scrollDOM,
    topLine: () => {
      const height = heightAtTop()
      const block = view.lineBlockAtHeight(height)
      const line = view.state.doc.lineAt(block.from)
      // Interpolate within the block so a half-scrolled paragraph maps to a
      // fractional line rather than snapping to its first.
      const within = block.height > 0 ? (height - block.top) / block.height : 0
      return line.number - 1 + Math.min(1, Math.max(0, within))
    },
    scrollToLine: (line: number) => {
      const clamped = Math.max(1, Math.min(Math.floor(line) + 1, view.state.doc.lines))
      const block = view.lineBlockAt(view.state.doc.line(clamped).from)
      const wanted = block.top + (line - Math.floor(line)) * block.height
      view.scrollDOM.scrollTop += wanted - heightAtTop()
    }
  }
}

const mdHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.5em', fontWeight: '700' },
  { tag: t.heading2, fontSize: '1.3em', fontWeight: '700' },
  { tag: t.heading3, fontSize: '1.15em', fontWeight: '700' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '700' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: '#0b6bcb', textDecoration: 'underline' },
  { tag: t.url, color: '#0b6bcb' },
  { tag: t.monospace, fontFamily: 'Consolas, "Cascadia Mono", monospace' },
  { tag: t.quote, fontStyle: 'italic', opacity: 0.85 },
  { tag: t.processingInstruction, opacity: 0.55 }
])

const Editor = forwardRef<EditorHandle, Props>(function Editor(
  {
    value,
    dark,
    zoom,
    onChange,
    onCursor,
    onFormat,
    blockTintKinds = DEFAULT_BLOCK_TINTS,
    onScrollTarget
  },
  ref
) {
  const tintKindsRef = useRef(blockTintKinds)
  tintKindsRef.current = blockTintKinds
  // Held in a ref so changing the callback cannot rebuild the editor.
  const onScrollTargetRef = useRef(onScrollTarget)
  onScrollTargetRef.current = onScrollTarget
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onCursorRef = useRef(onCursor)
  onChangeRef.current = onChange
  onCursorRef.current = onCursor
  const [selBar, setSelBar] = useState<{ x: number; y: number; flip: boolean } | null>(null)

  useEffect(() => {
    if (!hostRef.current) return

    const theme = EditorView.theme(
      {
        '&': { height: '100%', fontSize: `${Math.round(zoom * 14)}px` },
        '.cm-scroller': {
          fontFamily: 'Consolas, "Cascadia Mono", "Segoe UI Mono", monospace',
          lineHeight: '1.65',
          padding: '12px 8px 40vh 8px'
        },
        '.cm-content': { caretColor: dark ? '#e6e6e6' : '#111' },
        '.cm-gutters': {
          backgroundColor: 'transparent',
          border: 'none',
          color: dark ? '#7a7a7a' : '#9a9a9a'
        },
        '.cm-activeLine': { backgroundColor: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' },
        '.cm-activeLineGutter': { backgroundColor: 'transparent' }
      },
      { dark }
    )

    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      EditorState.allowMultipleSelections.of(true),
      bracketMatching(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      search({ top: true }),
      tintCompartment.of(blockTints(tintKindsRef.current, dark)),
      smartPaste(),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: true }),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      syntaxHighlighting(mdHighlight),
      EditorView.lineWrapping,
      theme,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) onChangeRef.current(u.state.doc.toString())
        if (u.selectionSet || u.docChanged) {
          const head = u.state.selection.main.head
          const line = u.state.doc.lineAt(head)
          onCursorRef.current?.(line.number, head - line.from + 1)
        }
        // Floating format bar: show it whenever a non-empty range is selected.
        if (u.selectionSet || u.docChanged || u.geometryChanged) {
          const range = u.state.selection.main
          if (range.empty) {
            setSelBar(null)
          } else {
            const from = u.view.coordsAtPos(range.from)
            const to = u.view.coordsAtPos(range.head)
            if (!from || !to) {
              setSelBar(null)
            } else {
              const top = Math.min(from.top, to.top)
              const bottom = Math.max(from.bottom, to.bottom)
              // No room above (selection near the top of the editor)? Sit below it.
              const flip = top < 130
              const half = 290
              const x = Math.max(half, Math.min((from.left + to.left) / 2, window.innerWidth - half))
              setSelBar({ x, y: flip ? bottom + 10 : top - 8, flip })
            }
          }
        }
      }),
      EditorView.domEventHandlers({
        blur: () => {
          // Keep the bar alive long enough for its own click to register.
          window.setTimeout(() => {
            const view = viewRef.current
            if (view && view.state.selection.main.empty) setSelBar(null)
          }, 180)
          return false
        }
      })
    ]

    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: hostRef.current
    })
    viewRef.current = view
    view.focus()

    // Announce the new instance, and withdraw it before it is destroyed, so
    // nothing is left holding a handle to a view that no longer exists.
    onScrollTargetRef.current?.(makeScrollTarget(view))

    return () => {
      onScrollTargetRef.current?.(null)
      view.destroy()
      viewRef.current = null
    }
    // Recreate only when the theme or zoom changes; content is synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark, zoom])

  // Reconfigure the tints in place. `dark` is in the list because the colours
  // differ per theme, but a theme change rebuilds the view anyway — this only
  // has to catch the setting changing on its own.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: tintCompartment.reconfigure(blockTints(blockTintKinds, dark))
    })
  }, [blockTintKinds, dark])

  // Keep the editor in sync when the document is replaced from outside.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      selection: { anchor: Math.min(view.state.selection.main.anchor, value.length) }
    })
  }, [value])

  useImperativeHandle(ref, () => ({
    getSelection: () => {
      const view = viewRef.current
      if (!view) return { from: 0, to: 0 }
      const r = view.state.selection.main
      return { from: r.from, to: r.to }
    },
    /*
     * Applies a formatting edit as the smallest change that produces it.
     *
     * The edit helpers in lib/editing return the whole new document, and this
     * used to hand that straight to CodeMirror as "replace everything". Doing
     * that throws away every position in the document, so the editor scrolled
     * back to the top after each use of the selection toolbar, undo collapsed
     * the formatting and whatever preceded it into one step, and the block
     * tints were rebuilt from scratch on every click.
     *
     * Trimming the common prefix and suffix recovers the actual edit. Wrapping
     * a word in asterisks then dispatches as two tiny insertions instead of a
     * few hundred kilobytes, and CodeMirror maps the scroll position and the
     * selection across it the way it does for ordinary typing.
     */
    applyEdit: (edit: TextEdit) => {
      const view = viewRef.current
      if (!view) return

      const current = view.state.doc.toString()
      const next = edit.text

      let start = 0
      const shortest = Math.min(current.length, next.length)
      while (start < shortest && current[start] === next[start]) start++

      let endCurrent = current.length
      let endNext = next.length
      while (endCurrent > start && endNext > start && current[endCurrent - 1] === next[endNext - 1]) {
        endCurrent--
        endNext--
      }

      view.dispatch({
        // An unchanged document still needs the selection applying: some
        // actions only move the caret.
        changes:
          current === next
            ? undefined
            : { from: start, to: endCurrent, insert: next.slice(start, endNext) },
        selection: { anchor: edit.selectionStart, head: edit.selectionEnd }
        // No scrollIntoView. The text being formatted is on screen by
        // definition, and asking to scroll to it is what moves the view.
      })
      view.focus()
    },
    getValue: () => viewRef.current?.state.doc.toString() ?? '',
    focus: () => viewRef.current?.focus(),
    undo: () => (viewRef.current ? cmUndo(viewRef.current) : false),
    redo: () => (viewRef.current ? cmRedo(viewRef.current) : false),

    /*
     * The scroll-sync view of this editor.
     *
     * Lines are reported zero-based to match `data-line` in the rendered HTML;
     * CodeMirror counts from one, hence the adjustments. Line blocks are used
     * rather than multiplying by a line height, because wrapped lines and the
     * tinted blocks make rows different heights, and a uniform-height
     * assumption drifts badly in exactly the long documents this exists for.
     *
     * The coordinate conversion is the part that has to be right. CodeMirror's
     * block `top` values are measured from the top of the *document*, while
     * `scrollDOM.scrollTop` is measured from the top of the *scroller* — and
     * the two differ by the scroller's padding, which here is 12px at the top
     * and 40vh at the bottom. Treating them as the same number, as the first
     * version did, offsets every lookup by that padding and the panes never
     * line up. `view.documentTop` is the document's current screen position,
     * so going through screen coordinates keeps the two spaces honest without
     * hard-coding anything about the padding.
     */
    scrollTarget: (): ScrollSyncTarget | null =>
      viewRef.current ? makeScrollTarget(viewRef.current) : null,

    /**
     * Opens CodeMirror's find-and-replace panel.
     *
     * Ctrl+F always worked because CodeMirror's own keymap handles it inside
     * the editor. The Edit menu had no way to reach it and merely focused the
     * editor, so the menu item looked broken while the shortcut worked.
     */
    openSearch: () => {
      const view = viewRef.current
      if (!view) return
      view.focus()
      openSearchPanel(view)
    },
    gotoLine: (line: number) => {
      const view = viewRef.current
      if (!view) return
      const l = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)))
      view.dispatch({ selection: { anchor: l.from }, scrollIntoView: true })
      view.focus()
    }
  }))

  return (
    <>
      <div className="editor-host" ref={hostRef} />
      {selBar && onFormat && (
        <FormatToolbar
          x={selBar.x}
          y={selBar.y}
          flip={selBar.flip}
          onAction={(action) => {
            onFormat(action)
            viewRef.current?.focus()
          }}
        />
      )}
    </>
  )
})

export default Editor
