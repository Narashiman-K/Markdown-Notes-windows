import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import FormatToolbar from './FormatToolbar'
import { EditorState, type Extension } from '@codemirror/state'
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
import { searchKeymap, highlightSelectionMatches, search } from '@codemirror/search'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, HighlightStyle } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import type { TextEdit } from '../lib/editing'

export interface EditorHandle {
  getSelection: () => { from: number; to: number }
  applyEdit: (edit: TextEdit) => void
  getValue: () => string
  focus: () => void
  gotoLine: (line: number) => void
  /** Returns false when the editor's own history had nothing to reverse. */
  undo: () => boolean
  redo: () => boolean
}

interface Props {
  value: string
  dark: boolean
  zoom: number
  onChange: (value: string) => void
  onCursor?: (line: number, col: number) => void
  /** Fires when a button on the floating selection toolbar is pressed. */
  onFormat?: (action: string) => void
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
  { value, dark, zoom, onChange, onCursor, onFormat },
  ref
) {
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

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // Recreate only when the theme or zoom changes; content is synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark, zoom])

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
    applyEdit: (edit: TextEdit) => {
      const view = viewRef.current
      if (!view) return
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: edit.text },
        selection: { anchor: edit.selectionStart, head: edit.selectionEnd }
      })
      view.focus()
    },
    getValue: () => viewRef.current?.state.doc.toString() ?? '',
    focus: () => viewRef.current?.focus(),
    undo: () => (viewRef.current ? cmUndo(viewRef.current) : false),
    redo: () => (viewRef.current ? cmRedo(viewRef.current) : false),
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
