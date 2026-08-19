import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Toolbar from './components/Toolbar'
import Preview, { type PreviewHandle } from './components/Preview'
import Editor, { type EditorHandle } from './components/Editor'
import Sidebar from './components/Sidebar'
import FindBar from './components/FindBar'
import NoteDialog from './components/NoteDialog'
import AboutDialog from './components/AboutDialog'
import ConvertDialog from './components/ConvertDialog'
import AiPanel from './components/AiPanel'
import DiffDialog from './components/DiffDialog'
import { installSignature, signatureComment } from './lib/signature'
import { findQuoteRange } from './lib/aiPrompts'
import { featureRequestUrl } from '../../shared/brand'
import type { Chunk, SourceDoc } from './lib/retrieval'
import {
  EMPTY_HISTORY,
  canRedo,
  canUndo,
  record,
  redo as redoHistory,
  undo as undoHistory,
  type HistoryState
} from './lib/history'
import { extractHeadings, documentStats, renderMarkdown, standaloneHtml } from './lib/markdown'
import {
  applyAnnotation,
  listAnnotations,
  removeAnnotation,
  removeAllAnnotations,
  updateNote
} from './lib/annotations'
import { wrapSelection, prefixLines, insertBlock, TABLE_SNIPPET, toFileUrl } from './lib/editing'
import { ZOOM_LEVELS, type AnnotationType } from '../../shared/types'
import markdownCss from './styles/markdown.css?inline'
import hljsCss from 'highlight.js/styles/github.css?inline'

const WELCOME = `# Welcome to Suprasūtā Markdown Notes

A fast Markdown **viewer**, **editor** and **annotator** for Windows 11.

## Quick start

1. Press **Ctrl+O** to open an existing \`.md\` file.
2. Select any text in view mode to highlight, underline or comment on it.
3. Press **Ctrl+E** to edit the source, then **Ctrl+S** to save and return to view mode.

> Annotations are written straight into the Markdown file as standard HTML
> tags, so the file stays a valid \`.md\` you can open anywhere.

| Shortcut | Action |
| --- | --- |
| Ctrl+O | Open |
| Ctrl+S | Save |
| Ctrl+E | Edit mode |
| Ctrl+P | Print |
| Ctrl+F | Find |
| F1 | All shortcuts |
`

type Mode = 'view' | 'edit'
type SidebarMode = 'none' | 'outline' | 'comments'
type Theme = 'light' | 'dark' | 'system'

export default function App(): React.JSX.Element {
  const [content, setContent] = useState(WELCOME)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [fileName, setFileName] = useState('Untitled')
  const [dirty, setDirty] = useState(false)
  const [mode, setMode] = useState<Mode>('view')
  const [zoom, setZoom] = useState(1)
  const [theme, setTheme] = useState<Theme>('system')
  const [systemDark, setSystemDark] = useState(false)
  const [sidebar, setSidebar] = useState<SidebarMode>('none')
  const [findOpen, setFindOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [cursor, setCursor] = useState({ line: 1, col: 1 })
  const [toast, setToast] = useState<string | null>(null)
  const [showAbout, setShowAbout] = useState(false)
  const [convertSeed, setConvertSeed] = useState<string[] | null>(null)
  const [appDragging, setAppDragging] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [extraDocs, setExtraDocs] = useState<SourceDoc[]>([])
  const [selectionText, setSelectionText] = useState('')
  const [history, setHistory] = useState<HistoryState>(EMPTY_HISTORY)
  const [reviewChanges, setReviewChanges] = useState(true)
  const [pendingDiff, setPendingDiff] = useState<{ next: string; label: string } | null>(null)
  const [dialog, setDialog] = useState<
    | { kind: 'newComment'; range: [number, number] }
    | { kind: 'editNote'; id: string; initial: string }
    | { kind: 'link'; from: number; to: number }
    | null
  >(null)

  const previewRef = useRef<PreviewHandle>(null)
  const editorRef = useRef<EditorHandle>(null)

  const dark = theme === 'dark' || (theme === 'system' && systemDark)
  const headings = useMemo(() => extractHeadings(content), [content])
  const annotations = useMemo(() => listAnnotations(content), [content])
  const stats = useMemo(() => documentStats(content), [content])

  /* ------------------------------------------------------------- helpers */

  const flash = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2600)
  }, [])

  const updateContent = useCallback((next: string, markDirty = true) => {
    setContent(next)
    if (markDirty) setDirty(true)
  }, [])

  /**
   * Applies a change that should be undoable at document level. Typing in the
   * source editor deliberately does NOT go through here — CodeMirror keeps its
   * own fine-grained history for that. This covers annotations and AI edits,
   * which happen outside the editor and would otherwise be irreversible.
   */
  const commitContent = useCallback(
    (next: string, label: string) => {
      setContent((current) => {
        if (current === next) return current
        setHistory((h) => record(h, current, label))
        return next
      })
      setDirty(true)
    },
    []
  )

  const doUndo = useCallback(() => {
    // In edit mode the source editor owns undo, so keystroke-level history
    // still works; fall through to document history when it has nothing left.
    if (mode === 'edit' && editorRef.current?.undo()) return
    setContent((current) => {
      const result = undoHistory(history, current)
      if (!result) {
        flash('Nothing left to undo.')
        return current
      }
      setHistory(result.state)
      setDirty(true)
      flash(`Undid: ${result.label}`)
      return result.content
    })
  }, [flash, history, mode])

  const doRedo = useCallback(() => {
    if (mode === 'edit' && editorRef.current?.redo()) return
    setContent((current) => {
      const result = redoHistory(history, current)
      if (!result) {
        flash('Nothing to redo.')
        return current
      }
      setHistory(result.state)
      setDirty(true)
      flash(`Redid: ${result.label}`)
      return result.content
    })
  }, [flash, history, mode])

  const loadDocument = useCallback((path: string | null, text: string) => {
    setContent(text)
    setFilePath(path)
    setDirty(false)
    setMode('view')
    setActiveId(null)
    setHistory(EMPTY_HISTORY)
    if (path) window.api.basename(path).then(setFileName)
    else setFileName('Untitled')
  }, [])

  /* ------------------------------------------------------------ file ops */

  /**
   * Handles the three outcomes of opening a path: plain read, "this format
   * must be converted first", and "this opens but would read better
   * converted" (indented .txt, whose indentation Markdown treats as code).
   */
  const handleOpenResult = useCallback(
    async (r: {
      ok?: boolean
      filePath?: string
      content?: string
      needsConversion?: boolean
      offerConversion?: boolean
      ext?: string
      error?: string
      canceled?: boolean
    }) => {
      if (r.canceled) return
      if (!r.ok) {
        if (r.error) flash(r.error)
        return
      }
      if (r.needsConversion && r.filePath) {
        setConvertSeed([r.filePath])
        return
      }
      if (typeof r.content !== 'string' || !r.filePath) return

      loadDocument(r.filePath, r.content)

      if (r.offerConversion) {
        const yes = await window.api.confirm({
          title: 'Convert to Markdown?',
          message: `Convert this .${r.ext} file to Markdown first?`,
          detail:
            'This file contains indented lines. Markdown reads indented text as a code block, ' +
            'which stops highlights and comments from showing up. Converting cleans that up.'
        })
        if (yes) setConvertSeed([r.filePath])
      }
    },
    [flash, loadDocument]
  )

  const doOpen = useCallback(async () => {
    await handleOpenResult(await window.api.openDialog())
  }, [handleOpenResult])

  const doSave = useCallback(
    async (saveAs = false): Promise<boolean> => {
      const r = await window.api.saveFile({ filePath, content, saveAs })
      if (r.ok && r.filePath) {
        setFilePath(r.filePath)
        setDirty(false)
        const base = await window.api.basename(r.filePath)
        setFileName(base)
        setMode('view')
        flash(`Saved ${base}`)
        return true
      }
      if (r.error) flash(`Could not save: ${r.error}`)
      return false
    },
    [content, filePath, flash]
  )

  const guardUnsaved = useCallback(async (): Promise<boolean> => {
    if (!dirty) return true
    const choice = await window.api.confirmUnsaved(fileName)
    if (choice === 'cancel') return false
    if (choice === 'save') return doSave(false)
    return true
  }, [dirty, doSave, fileName])

  const doNew = useCallback(async () => {
    if (!(await guardUnsaved())) return
    loadDocument(null, '# Untitled\n\n')
    setMode('edit')
  }, [guardUnsaved, loadDocument])

  const buildStandalone = useCallback(
    (forPrint: boolean) =>
      signatureComment() +
      '\n' +
      standaloneHtml(fileName, renderMarkdown(content), `${markdownCss}\n${hljsCss}`, forPrint),
    [content, fileName]
  )

  /* ----------------------------------------------------------- annotate */

  const annotate = useCallback(
    (type: AnnotationType, color?: string, note?: string, range?: [number, number]) => {
      const r = range ?? previewRef.current?.getSelectionRange()
      if (!r) {
        flash('Select some text in view mode first.')
        return
      }
      const author = undefined
      const result = applyAnnotation(content, r[0], r[1], { type, color, note, author })
      if (result.applied === 0) {
        flash('That selection cannot be annotated (code blocks are skipped).')
        return
      }
      commitContent(result.source, `Add ${type}`)
      setActiveId(result.id)
      previewRef.current?.clearSelection()
    },
    [commitContent, content, flash]
  )

  const doRemove = useCallback(
    (id: string) => {
      commitContent(removeAnnotation(content, id), 'Remove annotation')
      setActiveId(null)
    },
    [commitContent, content]
  )

  /* ----------------------------------------------------------------- AI */

  /** Places AI-suggested annotations by locating each quote in the source. */
  const applyAiAnnotations = useCallback(
    (items: Array<{ quote: string; type: string; color?: string; note?: string }>) => {
      let next = content
      let placed = 0
      const missed: string[] = []

      // Apply from the end of the document backwards so earlier offsets stay valid.
      const located = items
        .map((item) => ({ item, range: findQuoteRange(next, item.quote) }))
        .filter((entry): entry is { item: typeof entry.item; range: [number, number] } => {
          if (!entry.range) missed.push(entry.item.quote.slice(0, 40))
          return entry.range !== null
        })
        .sort((a, b) => b.range[0] - a.range[0])

      for (const { item, range } of located) {
        const result = applyAnnotation(next, range[0], range[1], {
          type: item.type as AnnotationType,
          color: item.color,
          note: item.note,
          author: 'AI'
        })
        if (result.applied > 0) {
          next = result.source
          placed++
        } else {
          missed.push(item.quote.slice(0, 40))
        }
      }

      if (!placed) {
        flash('None of the suggested passages could be matched in the document.')
        return
      }
      commitContent(next, `AI annotations (${placed})`)
      setSidebar('comments')
      flash(
        missed.length
          ? `Added ${placed} annotation${placed === 1 ? '' : 's'}; ${missed.length} could not be matched.`
          : `Added ${placed} annotation${placed === 1 ? '' : 's'}.`
      )
    },
    [commitContent, content, flash]
  )

  const applyAiRevision = useCallback(
    (next: string, label: string) => {
      if (next.trim() === content.trim()) {
        flash('The AI returned the document unchanged.')
        return
      }
      if (reviewChanges) setPendingDiff({ next, label })
      else {
        commitContent(next, label)
        flash(`${label} applied. Ctrl+Z to undo.`)
      }
    },
    [commitContent, content, flash, reviewChanges]
  )

  const addContextDocuments = useCallback(async () => {
    const r = await window.api.convertPickInput()
    if (!r.ok || !r.filePaths) return
    const added: SourceDoc[] = []
    for (const path of r.filePaths) {
      const read = await window.api.readFile(path)
      if (read.ok && typeof read.content === 'string') {
        added.push({ id: path, name: await window.api.basename(path), content: read.content })
      } else if (read.needsConversion) {
        flash(`${await window.api.basename(path)} must be converted to Markdown first (Ctrl+Shift+M).`)
      }
    }
    if (added.length) {
      setExtraDocs((docs) => [...docs, ...added.filter((a) => !docs.some((d) => d.id === a.id))])
      flash(`Added ${added.length} document${added.length === 1 ? '' : 's'} to the AI context.`)
    }
  }, [flash])

  const jumpToChunk = useCallback((chunk: Chunk) => {
    setMode('view')
    window.setTimeout(() => {
      const found = previewRef.current?.scrollToText(chunk.text)
      if (!found) previewRef.current?.scrollToSlug(chunk.heading.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-'))
    }, 60)
  }, [])

  /* ----------------------------------------------------- source editing */

  const editorEdit = useCallback(
    (fn: (text: string, from: number, to: number) => ReturnType<typeof wrapSelection>) => {
      if (mode !== 'edit' || !editorRef.current) {
        flash('Switch to Edit mode (Ctrl+E) to use this.')
        return
      }
      const { from, to } = editorRef.current.getSelection()
      editorRef.current.applyEdit(fn(editorRef.current.getValue(), from, to))
    },
    [flash, mode]
  )

  /* ------------------------------------------------------- menu actions */

  const handleAction = useCallback(
    async (action: string, payload?: unknown) => {
      switch (action) {
        case 'file:new':
          return doNew()
        case 'file:open':
          if (await guardUnsaved()) return doOpen()
          return
        case 'file:openPath': {
          if (!(await guardUnsaved())) return
          await handleOpenResult(await window.api.readFile(String(payload)))
          return
        }
        case 'convert:open':
          setConvertSeed([])
          return
        case 'ai:toggle':
          setAiOpen((v) => !v)
          return
        case 'edit:undo':
          doUndo()
          return
        case 'edit:redo':
          doRedo()
          return
        case 'convert:settings':
          setConvertSeed((s) => s ?? [])
          return
        case 'file:save':
          await doSave(false)
          return
        case 'file:saveAs':
          await doSave(true)
          return
        case 'file:export:html': {
          const r = await window.api.exportHtml({ html: buildStandalone(false), suggestedName: fileName })
          if (r.ok) flash('HTML exported.')
          return
        }
        case 'file:export:pdf': {
          const r = await window.api.exportPdf({ html: buildStandalone(true), suggestedName: fileName })
          if (r.ok) flash('PDF exported.')
          else if (r.error) flash(`Export failed: ${r.error}`)
          return
        }
        case 'file:export:clean': {
          const r = await window.api.exportMarkdown({
            text: removeAllAnnotations(content),
            suggestedName: fileName
          })
          if (r.ok) flash('Clean Markdown exported.')
          return
        }
        case 'file:print': {
          const r = await window.api.print({ html: buildStandalone(true) })
          if (!r.ok && r.error && !/cancel/i.test(r.error)) flash(`Print failed: ${r.error}`)
          return
        }
        case 'edit:find':
          if (mode === 'view') setFindOpen(true)
          else editorRef.current?.focus()
          return

        case 'view:mode:view':
          setMode('view')
          return
        case 'view:mode:edit':
          setMode('edit')
          return
        case 'view:zoom:in':
          setZoom((z) => ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, ZOOM_LEVELS.findIndex((v) => v >= z) + 1)] ?? z)
          return
        case 'view:zoom:out':
          setZoom((z) => {
            const i = ZOOM_LEVELS.findIndex((v) => v >= z)
            return ZOOM_LEVELS[Math.max(0, (i === -1 ? ZOOM_LEVELS.length - 1 : i) - 1)]
          })
          return
        case 'view:zoom:reset':
          setZoom(1)
          return
        case 'view:sidebar:outline':
          setSidebar((s) => (s === 'outline' ? 'none' : 'outline'))
          return
        case 'view:sidebar:comments':
          setSidebar((s) => (s === 'comments' ? 'none' : 'comments'))
          return
        case 'view:theme:light':
          setTheme('light')
          return
        case 'view:theme:dark':
          setTheme('dark')
          return
        case 'view:theme:system':
          setTheme('system')
          return

        case 'annot:highlight:yellow':
          return annotate('highlight', 'yellow')
        case 'annot:highlight:green':
          return annotate('highlight', 'green')
        case 'annot:highlight:blue':
          return annotate('highlight', 'blue')
        case 'annot:highlight:pink':
          return annotate('highlight', 'pink')
        case 'annot:underline':
          return annotate('underline')
        case 'annot:strike':
          return annotate('strike')
        case 'annot:bold':
          return annotate('bold')
        case 'annot:comment': {
          const r = previewRef.current?.getSelectionRange()
          if (!r) {
            flash('Select some text in view mode first.')
            return
          }
          setDialog({ kind: 'newComment', range: r })
          return
        }
        case 'annot:remove':
          if (activeId) doRemove(activeId)
          else flash('Click an annotation first, then remove it.')
          return
        case 'annot:clearAll': {
          const ok = await window.api.confirm({
            title: 'Remove all annotations',
            message: `Remove all ${annotations.length} annotations from this document?`,
            detail: 'The underlying text is kept. This can be undone with Ctrl+Z in edit mode only after saving.'
          })
          if (ok) {
            commitContent(removeAllAnnotations(content), 'Remove all annotations')
            setActiveId(null)
            flash('All annotations removed.')
          }
          return
        }

        case 'insert:bold':
          return editorEdit((t, f, to) => wrapSelection(t, f, to, '**'))
        case 'insert:italic':
          return editorEdit((t, f, to) => wrapSelection(t, f, to, '*'))
        case 'insert:code':
          return editorEdit((t, f, to) => wrapSelection(t, f, to, '`'))
        case 'insert:strike':
          return editorEdit((t, f, to) => wrapSelection(t, f, to, '~~'))
        case 'insert:codeblock':
          return editorEdit((t, f, to) => {
            const sel = t.slice(f, to)
            const block = '```\n' + (sel || 'code here') + '\n```'
            const needsLead = f > 0 && t[f - 1] !== '\n'
            const body = (needsLead ? '\n\n' : '') + block + '\n'
            return { text: t.slice(0, f) + body + t.slice(to), selectionStart: f, selectionEnd: f + body.length }
          })
        case 'insert:h1':
          return editorEdit((t, f, to) => prefixLines(t, f, to, '# '))
        case 'insert:h2':
          return editorEdit((t, f, to) => prefixLines(t, f, to, '## '))
        case 'insert:h3':
          return editorEdit((t, f, to) => prefixLines(t, f, to, '### '))
        case 'insert:ul':
          return editorEdit((t, f, to) => prefixLines(t, f, to, '- '))
        case 'insert:ol':
          return editorEdit((t, f, to) => prefixLines(t, f, to, '1. ', true))
        case 'insert:task':
          return editorEdit((t, f, to) => prefixLines(t, f, to, '- [ ] '))
        case 'insert:quote':
          return editorEdit((t, f, to) => prefixLines(t, f, to, '> '))
        case 'insert:hr':
          return editorEdit((t, f, to) => insertBlock(t, f, to, '---'))
        case 'insert:table':
          return editorEdit((t, f, to) => insertBlock(t, f, to, TABLE_SNIPPET))
        case 'insert:link': {
          if (mode !== 'edit') {
            flash('Switch to Edit mode (Ctrl+E) to insert a link.')
            return
          }
          const sel = editorRef.current!.getSelection()
          setDialog({ kind: 'link', from: sel.from, to: sel.to })
          return
        }
        case 'insert:image': {
          if (mode !== 'edit') {
            flash('Switch to Edit mode (Ctrl+E) to insert an image.')
            return
          }
          const r = await window.api.pickImage()
          if (!r.ok || !r.filePath) return
          const base = await window.api.basename(r.filePath)
          editorEdit((t, f, to) => ({
            text: t.slice(0, f) + `![${base}](${toFileUrl(r.filePath!)})` + t.slice(to),
            selectionStart: f,
            selectionEnd: f + base.length + toFileUrl(r.filePath!).length + 5
          }))
          return
        }

        case 'help:about':
          setShowAbout(true)
          return
        case 'help:featureVote':
          window.open(featureRequestUrl(), '_blank')
          flash('Opening GitHub — your vote helps decide what gets built next.')
          return
        case 'help:shortcuts':
          await window.api.message({
            title: 'Keyboard shortcuts',
            message: 'Suprasūtā Markdown Notes shortcuts',
            detail: [
              'Ctrl+N  New          Ctrl+O  Open',
              'Ctrl+S  Save         Ctrl+Shift+S  Save As',
              'Ctrl+P  Print        Ctrl+F  Find',
              'Ctrl+E  Edit mode    Ctrl+Shift+V  View mode',
              'Ctrl +/-/0  Zoom     Ctrl+Shift+O  Outline',
              'Ctrl+Shift+C  Annotations panel',
              '',
              'Annotate (view mode, with text selected):',
              'Ctrl+Alt+1..4  Highlight yellow/green/blue/pink',
              'Ctrl+U  Underline    Ctrl+Shift+X  Strikethrough',
              'Ctrl+Alt+M  Add comment',
              'Ctrl+Alt+Backspace  Remove selected annotation'
            ].join('\n')
          })
          return
      }
    },
    [
      activeId,
      annotate,
      annotations.length,
      buildStandalone,
      commitContent,
      content,
      doNew,
      doOpen,
      doRedo,
      doRemove,
      doSave,
      doUndo,
      editorEdit,
      fileName,
      flash,
      guardUnsaved,
      handleOpenResult,
      mode,
      updateContent
    ]
  )

  const actionRef = useRef(handleAction)
  actionRef.current = handleAction

  /* ------------------------------------------------------------- effects */

  useEffect(() => {
    const offMenu = window.api.onMenuAction(({ action, payload }) => void actionRef.current(action, payload))
    const offOpened = window.api.onFileOpened(({ filePath: p, content: c }) => {
      void (async () => {
        loadDocument(p, c)
      })()
    })
    const offTheme = window.api.onSystemThemeChanged((isDark) => setSystemDark(isDark))
    const offClose = window.api.onBeforeClose(() => {
      void (async () => {
        if (await guardUnsavedRef.current()) window.api.forceClose()
      })()
    })
    const offDisk = window.api.onFileChangedOnDisk(({ filePath: p }) => {
      void (async () => {
        if (dirtyRef.current) return
        const r = await window.api.readFile(p)
        if (r.ok && typeof r.content === 'string') {
          setContent(r.content)
          flash('Reloaded — file changed on disk.')
        }
      })()
    })

    window.api.getSettings().then((s) => {
      if (s?.theme) setTheme(s.theme)
      if (s?.zoom) setZoom(s.zoom)
      if (typeof s?.aiReviewChanges === 'boolean') setReviewChanges(s.aiReviewChanges)
    })

    // Track the current selection so the AI panel can explain it.
    const onSel = (): void => {
      const text = window.getSelection()?.toString() ?? ''
      setSelectionText(text.trim().length > 2 ? text.trim() : '')
    }
    document.addEventListener('selectionchange', onSel)
    setSystemDark(window.matchMedia('(prefers-color-scheme: dark)').matches)

    return () => {
      offMenu()
      offOpened()
      offTheme()
      offClose()
      offDisk()
      document.removeEventListener('selectionchange', onSel)
    }
  }, [flash, loadDocument])

  const guardUnsavedRef = useRef(guardUnsaved)
  guardUnsavedRef.current = guardUnsaved
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  useEffect(() => {
    installSignature()
  }, [])

  // Drag a file anywhere onto the window: Markdown opens, anything else is
  // handed to the converter.
  useEffect(() => {
    const stop = (e: DragEvent): void => {
      e.preventDefault()
      e.stopPropagation()
    }
    const onOver = (e: DragEvent): void => {
      stop(e)
      if (e.dataTransfer?.types?.includes('Files')) setAppDragging(true)
    }
    const onLeave = (e: DragEvent): void => {
      stop(e)
      if (e.relatedTarget === null) setAppDragging(false)
    }
    const onDrop = (e: DragEvent): void => {
      stop(e)
      setAppDragging(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      const paths = files.map((f) => window.api.pathForFile(f)).filter(Boolean)
      if (!paths.length) return
      const isMd = /\.(md|markdown|mdown|mkd|mdx)$/i.test(paths[0])
      if (paths.length === 1 && isMd) void actionRef.current('file:openPath', paths[0])
      else setConvertSeed(paths)
    }
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [dark])

  useEffect(() => {
    window.api.setTitle({ filePath, dirty })
  }, [filePath, dirty])

  useEffect(() => {
    window.api.setSettings({ zoom, theme })
  }, [zoom, theme])

  // Ctrl + mouse wheel zoom
  useEffect(() => {
    function onWheel(e: WheelEvent): void {
      if (!e.ctrlKey) return
      e.preventDefault()
      void actionRef.current(e.deltaY < 0 ? 'view:zoom:in' : 'view:zoom:out')
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        if (dialog) setDialog(null)
        else if (findOpen) setFindOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog, findOpen])

  /* --------------------------------------------------------------- render */

  return (
    <div className={`app ${dark ? 'dark' : 'light'}`}>
      <Toolbar
        mode={mode}
        zoom={zoom}
        dirty={dirty}
        fileName={fileName}
        sidebar={sidebar}
        aiOpen={aiOpen}
        onAction={(a) => void actionRef.current(a)}
      />

      {findOpen && mode === 'view' && <FindBar onClose={() => setFindOpen(false)} />}

      <main className="workspace">
        {sidebar !== 'none' && (
          <Sidebar
            mode={sidebar}
            headings={headings}
            annotations={annotations}
            activeId={activeId}
            onClose={() => setSidebar('none')}
            onPickHeading={(slug) => {
              setMode('view')
              window.setTimeout(() => previewRef.current?.scrollToSlug(slug), 30)
            }}
            onPickAnnotation={(id) => {
              setActiveId(id)
              setMode('view')
              window.setTimeout(() => previewRef.current?.scrollToAnnotation(id), 30)
            }}
            onEditNote={(id) => {
              const a = annotations.find((x) => x.id === id)
              setDialog({ kind: 'editNote', id, initial: a?.note ?? '' })
            }}
            onRemove={doRemove}
          />
        )}

        <section className="stage">
          {mode === 'view' ? (
            <Preview
              ref={previewRef}
              source={content}
              zoom={zoom}
              activeAnnotation={activeId}
              onAnnotate={(type, color) => annotate(type, color)}
              onComment={() => void actionRef.current('annot:comment')}
              onRemoveAnnotation={doRemove}
              onSelectAnnotation={setActiveId}
              onEditAnnotationNote={(id) => {
                const a = annotations.find((x) => x.id === id)
                setDialog({ kind: 'editNote', id, initial: a?.note ?? '' })
              }}
            />
          ) : (
            <div className="edit-split">
              <Editor
                ref={editorRef}
                value={content}
                dark={dark}
                zoom={zoom}
                onChange={(v) => updateContent(v)}
                onCursor={(line, col) => setCursor({ line, col })}
                onFormat={(action) => void actionRef.current(action)}
              />
              <div className="live-preview">
                <article
                  className="markdown-body"
                  style={{ fontSize: `${zoom * 15}px` }}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
                />
              </div>
            </div>
          )}
        </section>

        {aiOpen && (
          <AiPanel
            docName={fileName}
            docContent={content}
            extraDocs={extraDocs}
            selection={selectionText}
            onClose={() => setAiOpen(false)}
            onAddDocuments={addContextDocuments}
            onRemoveDocument={(id) => setExtraDocs((docs) => docs.filter((d) => d.id !== id))}
            onJumpToChunk={jumpToChunk}
            onApplyRevision={applyAiRevision}
            onApplyAnnotations={applyAiAnnotations}
            onToast={flash}
          />
        )}
      </main>

      <footer className="statusbar" data-mn-ignore>
        <span>{mode === 'view' ? 'View mode' : `Edit mode · Ln ${cursor.line}, Col ${cursor.col}`}</span>
        <span>{stats.words} words</span>
        <span>{stats.chars} chars</span>
        <span>{annotations.length} annotations</span>
        <span>~{stats.readMin} min read</span>
        <span className="grow" />
        <span>{dirty ? 'Unsaved changes' : 'Saved'}</span>
        <span>{Math.round(zoom * 100)}%</span>
      </footer>

      {toast && (
        <div className="toast" data-mn-ignore>
          {toast}
        </div>
      )}

      {appDragging && (
        <div className="drop-overlay" data-mn-ignore>
          <div className="drop-card">
            <div className="dz-icon">⤓</div>
            <strong>Drop to open or convert</strong>
            <span className="muted small">Markdown opens directly · other formats go to the converter</span>
          </div>
        </div>
      )}

      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}

      {pendingDiff && (
        <DiffDialog
          title={`Review ${pendingDiff.label.toLowerCase()}`}
          before={content}
          after={pendingDiff.next}
          reviewDefault={reviewChanges}
          onCancel={() => setPendingDiff(null)}
          onApply={(skipReview) => {
            commitContent(pendingDiff.next, pendingDiff.label)
            if (skipReview) {
              setReviewChanges(false)
              void window.api.setSettings({ aiReviewChanges: false })
            }
            setPendingDiff(null)
            flash(`${pendingDiff.label} applied. Ctrl+Z to undo.`)
          }}
        />
      )}

      {convertSeed !== null && (
        <ConvertDialog
          initialFiles={convertSeed}
          onClose={() => setConvertSeed(null)}
          onToast={flash}
          onOpenFile={(path) => {
            setConvertSeed(null)
            void actionRef.current('file:openPath', path)
          }}
        />
      )}

      {dialog?.kind === 'newComment' && (
        <NoteDialog
          title="Add comment"
          initial=""
          onCancel={() => setDialog(null)}
          onSave={(value) => {
            setDialog(null)
            if (value) annotate('comment', undefined, value, dialog.range)
          }}
        />
      )}

      {dialog?.kind === 'editNote' && (
        <NoteDialog
          title="Edit comment"
          initial={dialog.initial}
          onCancel={() => setDialog(null)}
          onSave={(value) => {
            updateContent(updateNote(content, dialog.id, value))
            setDialog(null)
          }}
        />
      )}

      {dialog?.kind === 'link' && (
        <NoteDialog
          title="Insert link"
          initial=""
          placeholder="https://example.com"
          onCancel={() => setDialog(null)}
          onSave={(url) => {
            const { from, to } = dialog
            setDialog(null)
            if (!url) return
            editorEdit((t, f, tt) => {
              const label = t.slice(f, tt) || 'link'
              const inserted = `[${label}](${url})`
              return { text: t.slice(0, f) + inserted + t.slice(tt), selectionStart: f, selectionEnd: f + inserted.length }
            })
            void from
            void to
          }}
        />
      )}
    </div>
  )
}

