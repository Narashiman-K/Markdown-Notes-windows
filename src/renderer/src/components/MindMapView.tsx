/**
 * Mind maps for revision and fast recall, inside the document area (the
 * menu and toolbar stay in place).
 *
 * Two levels:
 *   - the book overview: the book and its chapters, in reading order from the
 *     top left, each card showing the chapter's key idea, keywords and a
 *     two-sentence summary;
 *   - one detailed map per chapter: its topics and one card per paragraph,
 *     laid out from the top left in reading order.
 *
 * Clicking a card shows its passage in a popup on the same screen; from
 * there it can be opened in the document (with a way back to the map).
 * Cards can be dragged to new places (a card's branch moves with it), added,
 * edited and removed; all of that, and AI-written cards, is saved beside the
 * document (lib/mindmap.ts MapState) and never changes the document itself.
 *
 * Drawn as plain SVG with every colour on the element, so exported pictures
 * look the same anywhere.
 *
 * Kept identical across the Windows app and the web app.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import StudyPanel from './StudyPanel'
import {
  applyState,
  buildTree,
  findNode,
  plainText,
  readState,
  toMermaidMindmap,
  walk,
  EMPTY_STATE,
  type Card,
  type MapNode,
  type MapState,
  type DocLink
} from '../lib/mindmap'
import { renderMarkdown } from '../lib/markdown'
import { findProcesses, flowFromSteps, type FlowNode, type Process } from '../lib/flowchart'

interface Props {
  source: string
  name: string
  dark: boolean
  /** The chapter map to open, or null for the book overview. */
  focus: string | null
  onFocus: (id: string | null) => void
  onClose: () => void
  /** Show a passage in the document; the app offers the way back. */
  onShowInDocument: (node: { slug: string; line: number }) => void
  onInsert: (mermaid: string) => void
  ai: {
    status: () => Promise<{ ready: boolean; detail: string }>
    ask: (system: string, user: string) => Promise<{ ok: boolean; text?: string; error?: string }>
  }
  saveImage: (name: string, data: Blob) => Promise<void>
  /** Saves a text file the reader names (study cards for Anki or a spreadsheet). */
  saveText: (name: string, text: string, mime: string) => Promise<void>
  print: (html: string) => Promise<void>
  /** The reader's saved map for this document (JSON), or null. */
  loadState: () => Promise<string | null>
  /** Saves it; false when the document has no file yet. */
  saveState: (json: string) => Promise<boolean>
  /** Opens a card's web link in the browser. */
  openLink: (url: string) => void
  /**
   * While editing the map, Undo and Redo (menu, toolbar, Ctrl+Z / Ctrl+Y)
   * act on the map instead of the document. Returns false when there was
   * nothing to undo or redo.
   */
  registerUndo?: (fn: ((dir: 'undo' | 'redo') => boolean) | null) => void
}

const PALETTE = ['#4C9BE8', '#F28C38', '#4FB487', '#A77BE0', '#E2678C', '#36AFC0', '#C9A227', '#7F93AD']
const W = 268
const FONT = "system-ui, 'Segoe UI', sans-serif"

function wrap(text: string, chars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > chars && cur) {
      lines.push(cur)
      cur = w
      if (lines.length === maxLines) break
    } else cur = (cur + ' ' + w).trim()
  }
  if (lines.length < maxLines && cur) lines.push(cur)
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…'
  return lines
}

interface Placed {
  n: MapNode
  depth: number
  x: number
  y: number
  h: number
  title: string[]
  keys: string
  sum: string[]
  color: string
  badge?: string
  parent?: Placed
}

/** Card text laid out: title, keywords, summary. */
function measure(n: MapNode, showSum: boolean, isRoot: boolean): { title: string[]; keys: string; sum: string[]; h: number } {
  const title = wrap(n.kind === 'point' ? n.card.idea || n.title : n.title, isRoot ? 26 : 32, n.kind === 'point' ? 3 : 2)
  const keys = n.card.keywords.length ? n.card.keywords.slice(0, 4).map((k) => `#${k}`).join('  ') : ''
  const sum = showSum && n.card.summary ? wrap(n.card.summary, 40, 4) : []
  const h = 14 + title.length * (isRoot ? 20 : 17) + (keys ? 17 : 0) + (sum.length ? 5 + sum.length * 15 : 0) + 10
  return { title, keys, sum, h }
}

/** Book overview: the book first, then its chapters in rows, reading order. */
function overviewLayout(root: MapNode, showSum: boolean, cols: number): Placed[] {
  const out: Placed[] = []
  const rm = measure(root, showSum, true)
  const rp: Placed = { n: root, depth: 0, x: 0, y: 0, ...rm, color: '#888' }
  out.push(rp)
  let top = rm.h + 46
  const kids = root.children
  for (let i = 0; i < kids.length; i += cols) {
    const row = kids.slice(i, i + cols).map((k, j) => ({ k, m: measure(k, showSum, false), idx: i + j }))
    const rowH = Math.max(...row.map((r) => r.m.h))
    row.forEach(({ k, m, idx }, j) => {
      out.push({ n: k, depth: 1, x: j * (W + 34), y: top, ...m, color: PALETTE[idx % PALETTE.length], badge: String(idx + 1), parent: rp })
    })
    top += rowH + 30
  }
  return out
}

/** A topic's paragraph cards, drawn as one numbered group in a soft frame. */
interface Group {
  ids: string[]
  parent: string
  color: string
}

/**
 * Chapter map: a tree from the top left. Each topic's paragraph cards sit in
 * a numbered grid (reading order: left to right, top to bottom) inside a
 * frame; its sub-topics branch out below that.
 */
function treeLayout(root: MapNode, showSum: boolean, color: string): { placed: Placed[]; groups: Group[] } {
  const out: Placed[] = []
  const groups: Group[] = []
  const GX = 18
  const place = (n: MapNode, x: number, depth: number, top: number, col: string, parent?: Placed): number => {
    const m = measure(n, showSum, depth === 0)
    const p: Placed = { n, depth, x, y: top, ...m, color: col, parent }
    out.push(p)
    const leaves = n.children.filter((c) => (c.kind === 'point' || c.kind === 'custom') && !c.children.length)
    const branches = n.children.filter((c) => !leaves.includes(c))
    const childX = x + W + 64
    let y = top
    if (leaves.length) {
      const cols = leaves.length >= 7 ? 3 : leaves.length >= 3 ? 2 : 1
      for (let i = 0; i < leaves.length; i += cols) {
        const row = leaves.slice(i, i + cols).map((c) => ({ c, m: measure(c, showSum, false) }))
        const rowH = Math.max(...row.map((r) => r.m.h))
        row.forEach(({ c, m: cm }, j) => {
          out.push({ n: c, depth: depth + 1, x: childX + 12 + j * (W + GX), y: y + 12, ...cm, color: col, badge: String(i + j + 1), parent: p })
        })
        y += rowH + GX
      }
      y += 24
      groups.push({ ids: leaves.map((c) => c.id), parent: n.id, color: col })
    }
    branches.forEach((c, i) => {
      const cc = depth === 0 ? PALETTE[(i + 1) % PALETTE.length] : col
      y += place(c, childX, depth + 1, y, cc, p) + 18
    })
    return Math.max(m.h, y - top - 18)
  }
  place(root, 0, 0, 0, color)
  return { placed: out, groups }
}

/** A flowchart laid out: nodes in rows, the main path down the middle, a "No" path beside it. */
function flowLayout(steps: string[]) {
  const { nodes, edges } = flowFromSteps(steps)
  const FW = 300
  const sized = nodes.map((n) => {
    const lines = n.kind === 'start' || n.kind === 'end' ? [n.text] : wrap(n.text, n.kind === 'decision' ? 24 : 38, 5)
    const h = n.kind === 'decision' ? 70 + lines.length * 16 : n.kind === 'step' ? 22 + lines.length * 17 : 40
    const w = n.kind === 'decision' ? 300 : n.kind === 'step' ? FW : 150
    return { ...n, lines, w, h }
  })
  const rows = Math.max(...sized.map((n) => n.row)) + 1
  const rowTop: number[] = []
  let y = 0
  for (let r = 0; r < rows; r++) {
    rowTop[r] = y
    y += Math.max(40, ...sized.filter((n) => n.row === r).map((n) => n.h)) + 46
  }
  const laid = sized.map((n) => ({ ...n, cx: n.col === 0 ? 0 : 400, cy: rowTop[n.row] + n.h / 2 }))
  return { nodes: laid, edges }
}
type FlowLaid = ReturnType<typeof flowLayout>['nodes'][number]

export default function MindMapView(props: Props): React.JSX.Element {
  const { dark } = props
  const base = useMemo(() => buildTree(props.source, props.name), [props.source, props.name])
  const [state, setState] = useState<MapState>(EMPTY_STATE)
  const [loaded, setLoaded] = useState(false)
  const tree = useMemo(() => applyState(base, state), [base, state])
  const focusNode = props.focus ? findNode(tree, props.focus) : null
  const [showSum, setShowSum] = useState(true)
  const [kind, setKind] = useState<'map' | 'flow'>('map')
  const [flowAt, setFlowAt] = useState(0)
  const [aiFlow, setAiFlow] = useState<Record<string, Process>>({})
  const [view, setView] = useState({ x: 30, y: 30, k: 1 })
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [peek, setPeek] = useState<MapNode | null>(null)
  type Draft = { title: string; notes: string; url: string; link: DocLink | null } & Card
  const [editing, setEditing] = useState<{ node: MapNode | null; parent?: string; draft: Draft } | null>(null)
  // Moving, adding, editing and linking cards only in Edit mind map mode.
  const [editMode, setEditMode] = useState(false)
  // Linking two cards: the first card picked, waiting for the second.
  const [linking, setLinking] = useState<string | null>(null)
  const hoverTimer = useRef<number | null>(null)
  const [banner, setBanner] = useState('')
  const [progress, setProgress] = useState('')
  const [unsaved, setUnsaved] = useState(false)
  // The study panel: quiz, Q&A cards, tags and search, export.
  const [study, setStudy] = useState(false)
  const hostRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const alive = useRef(true)
  /* The running AI job. Starting another, going to another map, switching
   * between mind map and flowchart, or Stop ends it: its answer is ignored. */
  const job = useRef(0)
  const cancelAi = (): void => {
    job.current++
    setProgress('')
  }
  // Set on every mount: in development React mounts twice, and a flag left
  // false made the map ignore its saved state and every AI answer.
  useEffect(() => {
    alive.current = true
    return () => void (alive.current = false)
  }, [])

  const colors = dark
    ? { bg: '#1b1d22', card: '#262a31', text: '#e8e8e8', muted: '#a9b0ba', root: '#2f6fb0', key: '#f2a65a' }
    : { bg: '#f6f7f9', card: '#ffffff', text: '#1f2328', muted: '#5f6670', root: '#0f6cbd', key: '#c25e00' }

  /* ------------------------------------------------------------ saving */
  useEffect(() => {
    // Whatever happens reading it, the map works (and saves) from here on.
    void props
      .loadState()
      .then(
        (json) => alive.current && setState(readState(json)),
        () => undefined
      )
      .finally(() => alive.current && setLoaded(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!loaded) return
    const t = window.setTimeout(() => {
      void props.saveState(JSON.stringify(state)).then((ok) => alive.current && setUnsaved(!ok))
    }, 500)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, loaded])
  // Undo and redo for map edits: up to 50 steps back.
  const stateRef = useRef(state)
  stateRef.current = state
  const past = useRef<MapState[]>([])
  const future = useRef<MapState[]>([])
  const [, setHist] = useState(0)
  const change = (fn: (s: MapState) => MapState): void => {
    const cur = stateRef.current
    const next = fn(cur)
    if (next === cur) return
    past.current = [...past.current.slice(-49), cur]
    future.current = []
    stateRef.current = next
    setState(next)
    setHist((h) => h + 1)
  }
  const undoRedo = (dir: 'undo' | 'redo'): boolean => {
    const from = dir === 'undo' ? past : future
    const to = dir === 'undo' ? future : past
    const prev = from.current[from.current.length - 1]
    if (!prev) return false
    from.current = from.current.slice(0, -1)
    to.current = [...to.current, stateRef.current]
    stateRef.current = prev
    setState(prev)
    setHist((h) => h + 1)
    return true
  }
  useEffect(() => {
    props.registerUndo?.(editMode ? undoRedo : null)
    return () => props.registerUndo?.(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode])

  /* ------------------------------------------------------------ layout */
  const host = hostRef.current
  const cols = Math.max(2, Math.min(4, Math.floor(((host?.clientWidth ?? 1100) - 60) / (W + 34))))
  const laidOut = useMemo(() => {
    const laid = focusNode
      ? treeLayout(focusNode, showSum, PALETTE[Math.max(0, tree.children.findIndex((c) => c.id === focusNode.id)) % PALETTE.length])
      : { placed: overviewLayout(tree, showSum, cols), groups: [] as Group[] }
    const raw = laid.placed
    // Cards moved by hand: the offset applies to the card and its branch.
    const off = new Map<Placed, { dx: number; dy: number }>()
    for (const p of raw) {
      const own = state.moved[p.n.id] ?? { dx: 0, dy: 0 }
      const live = drag && drag.id === p.n.id ? { dx: drag.dx, dy: drag.dy } : { dx: 0, dy: 0 }
      const up = p.parent && focusNode ? (off.get(p.parent) ?? { dx: 0, dy: 0 }) : { dx: 0, dy: 0 }
      const o = { dx: up.dx + own.dx + live.dx, dy: up.dy + own.dy + live.dy }
      off.set(p, o)
    }
    const moved = raw.map((p) => ({ ...p, x: p.x + off.get(p)!.dx, y: p.y + off.get(p)!.dy }))
    const at = new Map(moved.map((p) => [p.n.id, p]))
    for (const p of moved) if (p.parent) p.parent = at.get(p.parent.n.id)
    // Each group's frame wraps its cards wherever they have been moved to.
    const frames = laid.groups
      .map((g) => {
        const ps = g.ids.map((id) => at.get(id)).filter((p): p is Placed => !!p)
        if (!ps.length) return null
        const x0 = Math.min(...ps.map((p) => p.x)) - 12
        const y0 = Math.min(...ps.map((p) => p.y)) - 12
        const x1 = Math.max(...ps.map((p) => p.x + W)) + 12
        const y1 = Math.max(...ps.map((p) => p.y + p.h)) + 12
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, color: g.color, parent: at.get(g.parent), ids: new Set(g.ids) }
      })
      .filter((f): f is NonNullable<typeof f> => !!f)
    return { cards: moved, frames }
  }, [tree, focusNode, showSum, cols, state.moved, drag])
  const placed = laidOut.cards
  const frames = laidOut.frames

  const scopeId = focusNode?.id ?? 'doc'
  // Going elsewhere (Back, Book, another chapter, map ↔ flowchart) stops a running AI job.
  useEffect(() => {
    cancelAi()
    setBanner('')
  }, [scopeId, kind])
  const processes = useMemo(() => {
    const found = findProcesses(props.source, focusNode ? focusNode.line : 0, focusNode ? focusNode.end : undefined)
    return aiFlow[scopeId] ? [aiFlow[scopeId], ...found] : found
  }, [props.source, focusNode, aiFlow, scopeId])
  const flow = useMemo(() => (kind === 'flow' && processes[flowAt] ? flowLayout(processes[flowAt].steps) : null), [kind, processes, flowAt])
  useEffect(() => setFlowAt(0), [scopeId])

  const bounds = useMemo(() => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    if (flow) {
      for (const n of flow.nodes) {
        x0 = Math.min(x0, n.cx - n.w / 2)
        x1 = Math.max(x1, n.cx + n.w / 2)
        y0 = Math.min(y0, n.cy - n.h / 2)
        y1 = Math.max(y1, n.cy + n.h / 2)
      }
      return { x: x0 - 50, y: y0 - 30, w: x1 - x0 + 100, h: y1 - y0 + 60 }
    }
    for (const p of [...placed, ...frames.map((f) => ({ x: f.x, y: f.y, h: f.h, w: f.w }))] as Array<{ x: number; y: number; h: number; w?: number }>) {
      x0 = Math.min(x0, p.x)
      y0 = Math.min(y0, p.y)
      x1 = Math.max(x1, p.x + (p.w ?? W))
      y1 = Math.max(y1, p.y + p.h)
    }
    const pad = 30
    return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad }
  }, [placed, frames, flow])

  // A new map opens at its top left, at a readable size.
  useEffect(() => setView({ x: 30, y: 24, k: 1 }), [props.focus])
  const fit = (): void => {
    const h = hostRef.current
    if (!h) return
    const k = Math.min(1.2, Math.max(0.15, Math.min(h.clientWidth / bounds.w, h.clientHeight / bounds.h)))
    setView({ k, x: -bounds.x * k + (h.clientWidth - bounds.w * k) / 2, y: -bounds.y * k + 10 })
  }

  /* ---------------------------------------------------- AI connection */
  useEffect(() => {
    void props.ai.status().then((s) => {
      if (alive.current && !s.ready) {
        setBanner('No AI is connected (local Ollama or an API key), so AI cards were not made. Each card shows a quick offline summary. Connect one in the AI panel for AI cards.')
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const passage = (n: MapNode): string => (n.line >= 0 ? props.source.split('\n').slice(n.line, n.end).join('\n') : '')

  const aiCards = async (): Promise<void> => {
    const id = ++job.current
    const live = (): boolean => alive.current && job.current === id
    setBanner('')
    setProgress('Checking the AI…')
    const s = await props.ai.status()
    if (!live()) return
    if (!s.ready) {
      setProgress('')
      setBanner(`No AI is connected (local Ollama or an API key), so AI cards were not made${s.detail ? ` (${s.detail})` : ''}. The offline cards stay. Connect one in the AI panel, then try again.`)
      return
    }
    setBanner('')
    const scope = focusNode ?? tree
    const todo: MapNode[] = []
    walk(scope, (n, d) => {
      if (!focusNode && d > 1) return
      if (n.kind !== 'custom' && n.source === 'offline' && plainText(passage(n)).length > 40) todo.push(n)
    })
    const ai: Record<string, Card> = {}
    for (let i = 0; i < todo.length && live(); i += 6) {
      const batch = todo.slice(i, i + 6)
      setProgress(`Writing AI cards: ${Math.min(i + 6, todo.length)} of ${todo.length}…`)
      const user = batch.map((n) => `### ${n.id}\nTitle: ${n.kind === 'point' ? '(a paragraph)' : n.title}\n${plainText(passage(n)).slice(0, 2400)}`).join('\n\n')
      const r = await props.ai.ask(
        'You turn passages of a document into revision cards for a mind map, so a reader can glance at a card and recall the whole passage. For each passage write: "idea": the single key idea, at most 15 words; "keywords": 2 to 4 short trigger words or phrases from the passage; "summary": exactly two plain sentences with the essential points (facts, steps, reasons, examples), no filler. Write in the passage\'s own language. Reply with JSON only, keyed by passage id: {"<id>": {"idea": "…", "keywords": ["…"], "summary": "…"}}.',
        user
      )
      if (!live()) return
      if (!r.ok) {
        setBanner(`The AI could not make cards (${r.error ?? 'no answer'}). The offline cards stay.`)
        break
      }
      try {
        const json = JSON.parse(String(r.text ?? '').replace(/^[\s\S]*?(\{[\s\S]*\})[\s\S]*$/, '$1')) as Record<string, Partial<Card>>
        for (const n of batch) {
          const c = json[n.id]
          if (c && typeof c.idea === 'string') ai[n.id] = { idea: c.idea.trim(), keywords: Array.isArray(c.keywords) ? c.keywords.map(String).slice(0, 4) : n.card.keywords, summary: String(c.summary ?? n.card.summary).trim() }
        }
        if (live()) change((st) => ({ ...st, ai: { ...st.ai, ...ai } }))
      } catch {
        /* not JSON: those cards keep their offline text */
      }
    }
    if (live()) setProgress('')
  }

  /** Asks the AI to turn this part's main process into numbered steps. */
  const aiSteps = async (): Promise<void> => {
    const id = ++job.current
    const live = (): boolean => alive.current && job.current === id
    setBanner('')
    setProgress('Checking the AI…')
    const s = await props.ai.status()
    if (!live()) return
    if (!s.ready) {
      setProgress('')
      setBanner('No AI is connected (local Ollama or an API key), so a flowchart could not be made from the text. Flowcharts are still made from any numbered steps in the document.')
      return
    }
    setProgress('Building the flowchart with AI… A local model can take a minute or two.')
    // Kept short: a local model on a laptop takes minutes over a long text.
    const text = plainText(focusNode ? passage(focusNode) : props.source).slice(0, 6000)
    const r = await props.ai.ask(
      'You turn the main process or method described in a passage into a flowchart. Reply with numbered steps only, one per line ("1. …"), each a short instruction of at most 15 words. Write a decision as a yes/no question ending in "?", and put its "no" path as the very next step starting with "Otherwise". Use 4 to 14 steps. No other text.',
      text
    )
    if (!live()) return
    setProgress('')
    const p = r.ok ? findProcesses(String(r.text ?? ''))[0] : undefined
    if (!p) {
      setBanner(r.ok ? 'The AI could not make steps from this text.' : /time|abort/i.test(r.error ?? '') ? `The AI took too long (${r.error}). A local model is slow on long text: open one chapter first (click it on the mind map), then try again, or use a free API key in the AI panel.` : `The AI could not make steps from this text (${r.error ?? 'no answer'}).`)
      return
    }
    setAiFlow((a) => ({ ...a, [scopeId]: { ...p, title: `${focusNode?.title ?? 'This document'} (steps by AI)`, line: focusNode?.line ?? 0 } }))
    setFlowAt(0)
  }

  /* ------------------------------------------------------ pan, zoom, drag */
  const pan = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)
  const press = useRef<{ id: string; x: number; y: number; moved: boolean; dx: number; dy: number } | null>(null)
  const onWheel = (e: React.WheelEvent): void => {
    const r = hostRef.current!.getBoundingClientRect()
    const px = e.clientX - r.left
    const py = e.clientY - r.top
    const k2 = Math.min(3, Math.max(0.12, view.k * Math.exp(-e.deltaY * 0.0015)))
    setView({ k: k2, x: px - ((px - view.x) / view.k) * k2, y: py - ((py - view.y) / view.k) * k2 })
  }
  const zoomBy = (f: number): void => {
    const h = hostRef.current!
    const px = h.clientWidth / 2
    const py = h.clientHeight / 2
    const k2 = Math.min(3, Math.max(0.12, view.k * f))
    setView({ k: k2, x: px - ((px - view.x) / view.k) * k2, y: py - ((py - view.y) / view.k) * k2 })
  }
  const onCardDown = (e: React.PointerEvent, n: MapNode): void => {
    e.stopPropagation()
    press.current = { id: n.id, x: e.clientX, y: e.clientY, moved: false, dx: 0, dy: 0 }
    try {
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    } catch {
      /* no live pointer (a synthetic event): dragging still works without capture */
    }
  }
  const onCardMove = (e: React.PointerEvent): void => {
    const p = press.current
    if (!p || !editMode) return
    const dx = (e.clientX - p.x) / view.k
    const dy = (e.clientY - p.y) / view.k
    if (!p.moved && Math.hypot(dx, dy) * view.k < 5) return
    p.moved = true
    p.dx = dx
    p.dy = dy
    setDrag({ id: p.id, dx, dy })
  }
  const onCardUp = (n: MapNode): void => {
    const p = press.current
    press.current = null
    if (p?.moved) {
      change((s) => {
        const prev = s.moved[n.id] ?? { dx: 0, dy: 0 }
        return { ...s, moved: { ...s.moved, [n.id]: { dx: prev.dx + p.dx, dy: prev.dy + p.dy } } }
      })
      setDrag(null)
      return
    }
    setDrag(null)
    clickCard(n)
  }

  /** The heading a card belongs to (for going back up one level). */
  const parentOf = (id: string): MapNode | null => {
    let hit: MapNode | null = null
    walk(tree, (n) => {
      if (!hit && n.children.some((c) => c.id === id)) hit = n
    })
    return hit
  }
  /** The way down from the book to a card, for the breadcrumb trail. */
  const pathTo = (id: string): MapNode[] => {
    const out: MapNode[] = []
    let n = findNode(tree, id)
    while (n && n.kind !== 'doc') {
      out.unshift(n)
      n = parentOf(n.id)
    }
    return out
  }

  /**
   * A click goes deeper: a chapter or topic opens its own map; a paragraph
   * (or a card with nothing under it) shows its text. While linking, the
   * click picks the second card.
   */
  const clickCard = (n: MapNode): void => {
    if (linking) {
      if (linking !== n.id) change((s) => ({ ...s, links: [...s.links.filter((l) => !(l.from === linking && l.to === n.id)), { from: linking, to: n.id }] }))
      setLinking(null)
      return
    }
    const isCurrentRoot = focusNode ? n.id === focusNode.id : n.kind === 'doc'
    if (!isCurrentRoot && n.children.length && n.kind !== 'point') openMap(n)
    else setPeek(n)
  }

  /* ---------------------------------------------------------- editing */
  const openEdit = (node: MapNode | null, parent?: string): void =>
    setEditing({
      node,
      parent,
      draft: node
        ? {
            title: node.title,
            ...node.card,
            keywords: [...node.card.keywords],
            notes: node.notes ?? '',
            url: node.url ?? '',
            link: state.edits[node.id]?.link ?? null
          }
        : { title: '', idea: '', keywords: [], summary: '', notes: '', url: '', link: null }
    })
  const saveEdit = (): void => {
    if (!editing) return
    const { node, parent, draft } = editing
    const card = { idea: draft.idea.trim(), keywords: draft.keywords.map((k) => k.trim()).filter(Boolean).slice(0, 6), summary: draft.summary.trim() }
    const url = draft.url.trim() && !/^[a-z][a-z0-9+.-]*:/i.test(draft.url.trim()) ? `https://${draft.url.trim()}` : draft.url.trim()
    const extra = { notes: draft.notes.trim(), url, link: draft.link }
    if (!node && parent) {
      const id = `c${Date.now().toString(36)}`
      change((s) => ({
        ...s,
        custom: [...s.custom, { id, parent, title: draft.title.trim() || card.idea || 'My card', ...card }],
        edits: { ...s.edits, [id]: extra }
      }))
    } else if (node?.kind === 'custom') {
      change((s) => ({
        ...s,
        custom: s.custom.map((c) => (c.id === node.id ? { ...c, title: draft.title.trim() || c.title, ...card } : c)),
        edits: { ...s.edits, [node.id]: extra }
      }))
    } else if (node) {
      const before = node.card
      const textSame = before.idea === card.idea && before.summary === card.summary && before.keywords.join() === card.keywords.join() && (node.kind === 'point' || node.title === draft.title.trim())
      change((s) => ({
        ...s,
        edits: {
          ...s.edits,
          [node.id]: { ...(textSame ? {} : { ...(node.kind === 'point' ? {} : { title: draft.title.trim() || node.title }), ...card }), ...extra }
        }
      }))
    }
    setEditing(null)
  }
  const remove = (n: MapNode): void => {
    if (n.kind === 'custom') change((s) => ({ ...s, custom: s.custom.filter((c) => c.id !== n.id && c.parent !== n.id) }))
    else change((s) => ({ ...s, hidden: [...s.hidden, n.id] }))
  }

  /** Parts of the document a card can be linked to: every heading. */
  const docParts = useMemo(() => {
    const out: DocLink[] = []
    walk(base, (n, d) => {
      if (n.kind === 'heading') out.push({ line: n.line, end: n.end, slug: n.slug, label: `${'  '.repeat(Math.max(0, d - 1))}${n.title}` })
    })
    return out
  }, [base])

  /* ------------------------------------------------------------ export */
  const svgText = (): string => {
    const svg = svgRef.current!.cloneNode(true) as SVGSVGElement
    ;(svg.querySelector('g[data-root]') as SVGGElement).setAttribute('transform', `translate(${-bounds.x} ${-bounds.y})`)
    svg.setAttribute('viewBox', `0 0 ${bounds.w} ${bounds.h}`)
    svg.setAttribute('width', String(Math.round(bounds.w)))
    svg.setAttribute('height', String(Math.round(bounds.h)))
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    svg.querySelectorAll('[data-ui]').forEach((e) => e.remove())
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    bg.setAttribute('width', '100%')
    bg.setAttribute('height', '100%')
    bg.setAttribute('fill', colors.bg)
    svg.insertBefore(bg, svg.firstChild)
    return new XMLSerializer().serializeToString(svg)
  }
  const fileBase = `${props.name.replace(/\.[^.]+$/, '') || 'document'}${focusNode ? ` - ${focusNode.title.replace(/[\\/:*?"<>|]/g, '').slice(0, 60)}` : ''} mind map`
  const exportSvg = async (): Promise<void> => props.saveImage(`${fileBase}.svg`, new Blob([svgText()], { type: 'image/svg+xml' }))
  const exportPng = async (): Promise<void> => {
    const url = URL.createObjectURL(new Blob([svgText()], { type: 'image/svg+xml' }))
    try {
      const img = new Image()
      await new Promise<void>((res, rej) => {
        img.onload = () => res()
        img.onerror = () => rej(new Error('The picture could not be drawn.'))
        img.src = url
      })
      const scale = Math.min(2, 14000 / Math.max(bounds.w, bounds.h))
      const c = document.createElement('canvas')
      c.width = Math.round(bounds.w * scale)
      c.height = Math.round(bounds.h * scale)
      const ctx = c.getContext('2d')!
      ctx.scale(scale, scale)
      ctx.drawImage(img, 0, 0)
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'))
      if (blob) await props.saveImage(`${fileBase}.png`, blob)
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  const doPrint = async (): Promise<void> =>
    props.print(
      `<!doctype html><html><head><meta charset="utf-8"><title>${fileBase}</title><style>@page { size: ${bounds.w > bounds.h ? 'landscape' : 'portrait'}; margin: 10mm; } html,body{margin:0;background:#fff} svg{width:100%;height:auto}</style></head><body>${svgText()}</body></html>`
    )

  /* -------------------------------------------------------------- keys */
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (linking) setLinking(null)
      else if (editing) setEditing(null)
      else if (peek) setPeek(null)
      else if (focusNode) {
        const up = parentOf(focusNode.id)
        props.onFocus(up && up.kind !== 'doc' ? up.id : null)
      }
      else props.onClose()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [editing, peek, props, linking])

  /* -------------------------------------------------------- navigation */
  const chapters = tree.children
  const at = focusNode ? chapters.findIndex((c) => c.id === focusNode.id) : -1
  const openMap = (n: MapNode): void => {
    setPeek(null)
    props.onFocus(n.id)
  }

  /* -------------------------------------------------------------- draw */
  const edge = (a: Placed, b: Placed): string => {
    const x1 = a.x + W
    const y1 = a.y + Math.min(24, a.h / 2)
    const x2 = b.x
    const y2 = b.y + Math.min(24, b.h / 2)
    const mx = (x1 + x2) / 2
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`
  }
  const peekHtml = useMemo(() => (peek && peek.line >= 0 && peek.kind !== 'doc' ? renderMarkdown(passage(peek), { screen: true }) : ''), [peek]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mindmap-view" data-mn-ignore role="region" aria-label="Mind map">
      <div className="mm-bar">
        <span className="mm-crumbs">
          {focusNode && (
            <button
              className="mm-back-btn"
              onClick={() => {
                const up = parentOf(focusNode.id)
                props.onFocus(up && up.kind !== 'doc' ? up.id : null)
              }}
              title="Back up one level (Esc)"
            >
              ← Back
            </button>
          )}
          <button className={!focusNode ? 'on' : ''} onClick={() => props.onFocus(null)} title="The first page: the whole book and its chapters">
            ⌂ Book
          </button>
          {focusNode &&
            pathTo(focusNode.id).map((n) => (
              <span key={n.id} className="mm-trail">
                <span className="mm-sep">›</span>
                {n.id === focusNode.id ? (
                  <span className="mm-here" title={n.title}>
                    {n.title}
                  </span>
                ) : (
                  <button className="link" onClick={() => props.onFocus(n.id)} title={n.title}>
                    {n.title.length > 28 ? `${n.title.slice(0, 26)}…` : n.title}
                  </button>
                )}
              </span>
            ))}
          {focusNode && at >= 0 && (
            <>
              <button onClick={() => at > 0 && props.onFocus(chapters[at - 1].id)} disabled={at <= 0} title="Previous chapter">
                ‹
              </button>
              <button onClick={() => at < chapters.length - 1 && props.onFocus(chapters[at + 1].id)} disabled={at >= chapters.length - 1} title="Next chapter">
                ›
              </button>
            </>
          )}
        </span>
        <span className="segmented mm-kinds">
          <button className={kind === 'map' ? 'on' : ''} onClick={() => setKind('map')} title="Mind map: the ideas and how they connect">
            🧠 Mind map
          </button>
          <button className={kind === 'flow' ? 'on' : ''} onClick={() => (setKind('flow'), setView({ x: 430, y: 24, k: 1 }))} title="Flowchart: a process, step by step, with its decisions">
            ⇢ Flowchart
          </button>
        </span>
        <span className="mm-group">
          <button onClick={() => zoomBy(1 / 1.25)} title="Zoom out">
            −
          </button>
          <button onClick={() => zoomBy(1.25)} title="Zoom in">
            ＋
          </button>
          <button onClick={fit} title="Fit the whole map in the window">
            Fit
          </button>
        </span>
        {kind === 'map' && (
          <>
        <label className="mm-check" title="Show each card's two-sentence summary">
          <input type="checkbox" checked={showSum} onChange={(e) => setShowSum(e.target.checked)} /> Summaries
        </label>
        <button
          className={`mm-editmode${editMode ? ' on' : ''}`}
          onClick={() => {
            setEditMode((v) => !v)
            setLinking(null)
          }}
          title={editMode ? 'Finish editing (changes are already saved)' : 'Edit the mind map: move, add, edit and link cards'}
        >
          {editMode ? '✓ Done editing' : '✎ Edit mind map'}
        </button>
        {editMode && (
          <span className="mm-group">
            <button onClick={() => undoRedo('undo')} disabled={!past.current.length} title={`Undo (Ctrl+Z) · ${past.current.length} step(s)`}>
              ↶ Undo
            </button>
            <button onClick={() => undoRedo('redo')} disabled={!future.current.length} title={`Redo (Ctrl+Y) · ${future.current.length} step(s)`}>
              ↷ Redo
            </button>
          </span>
        )}
        <button className="mm-ai" onClick={() => void aiCards()} disabled={!!progress} title="Rewrite the cards on this map with the AI set up in the AI panel">
          ✨ AI cards
        </button>
        <button className={`mm-study${study ? ' on' : ''}`} onClick={() => setStudy((v) => !v)} title="Study: quiz yourself, question-and-answer cards, tags and search, export to Anki or a spreadsheet">
          🎓 Study
        </button>
        {editMode && (state.hidden.length > 0 || Object.keys(state.moved).length > 0) && (
          <button
            onClick={() => change((s) => ({ ...s, hidden: [], moved: {} }))}
            title="Bring back removed cards and put moved cards back in place (your own cards and edits stay)"
          >
            Reset layout
          </button>
        )}
          </>
        )}
        <span className="grow" />
        <span className="mm-group">
          <button onClick={() => void exportPng()} title="Save this map as a PNG picture">
            🖼 PNG
          </button>
          <button onClick={() => void exportSvg()} title="Save this map as an SVG picture (sharp at any size)">
            SVG
          </button>
          <button onClick={() => void doPrint()} title="Print this map">
            🖨 Print
          </button>
          <button onClick={() => props.onInsert(toMermaidMindmap(focusNode ?? tree))} title="Insert this map into the document as a Mermaid diagram">
            Insert into document
          </button>
        </span>
        <button className="mm-close" onClick={props.onClose} title="Close the mind map (Esc or Alt+M)">
          ✕ Close
        </button>
      </div>
      {kind === 'map' && (editMode || linking) && (
        <div className="mm-banner busy">
          <span>
            {linking
              ? 'Linking: click the card to link to (Esc to cancel).'
              : 'Editing the mind map: drag cards to move them; hover a card for ＋ add, ✎ edit (text, notes, web link, document part), 🔗 link to another card, ✕ remove. Click a link line to remove it. Saved as you go; Undo and Redo go back up to 50 steps.'}
          </span>
        </div>
      )}
      {(banner || progress || unsaved) && (
        <div className={`mm-banner${progress ? ' busy' : ''}`}>
          <span>{progress || banner || 'Your changes to this map are kept until you close the app. Save the document to keep them with it.'}</span>
          {banner && !progress && (
            <button className="link" onClick={() => setBanner('')}>
              Dismiss
            </button>
          )}
          {progress && (
            <button className="link" onClick={cancelAi}>
              Stop
            </button>
          )}
        </div>
      )}
      <div
        className="mm-canvas"
        ref={hostRef}
        onWheel={onWheel}
        onPointerDown={(e) => {
          pan.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
          try {
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          } catch {
            /* no live pointer */
          }
        }}
        onPointerMove={(e) => {
          if (press.current) return onCardMove(e)
          const d = pan.current
          if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }))
        }}
        onPointerUp={() => (pan.current = null)}
        style={{ background: colors.bg }}
      >
        <svg ref={svgRef} width="100%" height="100%" fontFamily={FONT}>
          <defs>
            <marker id="mm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={colors.muted} />
            </marker>
          </defs>
          <g data-root transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {flow && <FlowDrawing flow={flow} colors={colors} />}
            {kind === 'map' && frames.map((f, i) => (
              <g key={`f-${i}`}>
                {f.parent && <path d={edge(f.parent, { x: f.x, y: f.y, h: 48 } as Placed)} fill="none" stroke={f.color} strokeOpacity={0.75} strokeWidth={2} />}
                <rect x={f.x} y={f.y} width={f.w} height={f.h} rx={14} fill={f.color} fillOpacity={0.06} stroke={f.color} strokeOpacity={0.45} strokeDasharray="6 4" pointerEvents="none" />
              </g>
            ))}
            {kind === 'map' && focusNode &&
              placed.map((p) =>
                p.parent && !frames.some((f) => f.ids.has(p.n.id)) ? (
                  <path key={`e-${p.n.id}`} d={edge(p.parent, p)} fill="none" stroke={p.color} strokeOpacity={0.75} strokeWidth={Math.max(1.3, 3.2 - p.depth * 0.6)} />
                ) : null
              )}
            {kind === 'map' &&
              state.links.map((l, i) => {
                const a = placed.find((p) => p.n.id === l.from)
                const b = placed.find((p) => p.n.id === l.to)
                if (!a || !b) return null
                const ax = a.x + W / 2
                const ay = a.y + a.h / 2
                const bx = b.x + W / 2
                const by = b.y + b.h / 2
                const bend = Math.max(60, Math.abs(bx - ax) / 3)
                const d = `M${ax},${ay} C${ax + bend},${ay - bend / 2} ${bx - bend},${by - bend / 2} ${bx},${by}`
                return (
                  <g key={`l-${i}`}>
                    <path d={d} fill="none" stroke="#F28C38" strokeWidth={2} strokeDasharray="7 5" strokeOpacity={0.85} pointerEvents="none" />
                    {editMode && (
                      <path
                        data-ui
                        d={d}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={14}
                        style={{ cursor: 'pointer' }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => change((st) => ({ ...st, links: st.links.filter((_, j) => j !== i) }))}
                      >
                        <title>Click to remove this link</title>
                      </path>
                    )}
                  </g>
                )
              })}
            {kind === 'map' && placed.map((p) => {
              const isRoot = p.depth === 0
              const lineH = isRoot ? 20 : 17
              const point = p.n.kind === 'point'
              const fill = isRoot ? colors.root : colors.card
              const tColor = isRoot ? '#ffffff' : colors.text
              const sColor = isRoot ? 'rgba(255,255,255,0.86)' : colors.muted
              const yKeys = p.y + 12 + p.title.length * lineH + 13
              const ySum = p.y + 12 + p.title.length * lineH + (p.keys ? 17 : 0) + 5
              const showTools = hover === p.n.id && !drag
              return (
                <g
                  key={p.n.id}
                  className="mm-node"
                  onPointerEnter={() => {
                    if (hoverTimer.current) window.clearTimeout(hoverTimer.current)
                    setHover(p.n.id)
                  }}
                  onPointerLeave={() => {
                    // A moment's grace, so the buttons can be reached.
                    if (hoverTimer.current) window.clearTimeout(hoverTimer.current)
                    const id = p.n.id
                    hoverTimer.current = window.setTimeout(() => setHover((h) => (h === id ? null : h)), 600)
                  }}
                >
                  <rect
                    x={p.x}
                    y={p.y}
                    width={W}
                    height={p.h}
                    rx={point ? 8 : 11}
                    fill={fill}
                    stroke={isRoot ? colors.root : p.color}
                    strokeWidth={isRoot ? 0 : point ? 1 : 1.7}
                    strokeDasharray={p.n.kind === 'custom' ? '5 3' : undefined}
                    style={{ cursor: drag?.id === p.n.id ? 'grabbing' : 'pointer' }}
                    onPointerDown={(e) => onCardDown(e, p.n)}
                    onPointerMove={onCardMove}
                    onPointerUp={() => onCardUp(p.n)}
                  >
                    <title>
                      {linking
                        ? 'Click to link this card'
                        : (p.n.children.length && p.n.kind !== 'point' && p.depth !== 0 ? 'Click to open its mind map' : 'Click to read this passage') + (editMode ? ' · drag to move' : '')}
                    </title>
                  </rect>
                  {!isRoot && <rect x={p.x} y={p.y + 8} width={4} height={p.h - 16} rx={2} fill={p.color} pointerEvents="none" />}
                  {p.badge && (
                    <g pointerEvents="none">
                      <circle cx={p.x + W - 16} cy={p.y + 16} r={10} fill={p.color} />
                      <text x={p.x + W - 16} y={p.y + 20} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">
                        {p.badge}
                      </text>
                    </g>
                  )}
                  <text x={p.x + 14} y={p.y + 12 + lineH * 0.8} fontSize={isRoot ? 16 : point ? 13 : 14} fontWeight={point ? 600 : 700} fill={tColor} pointerEvents="none">
                    {p.title.map((l, i) => (
                      <tspan key={i} x={p.x + 14} dy={i ? lineH : 0}>
                        {l}
                      </tspan>
                    ))}
                  </text>
                  {p.keys && (
                    <text x={p.x + 14} y={yKeys} fontSize={11} fontWeight={600} fill={isRoot ? '#ffe2c4' : colors.key} pointerEvents="none">
                      {p.keys}
                    </text>
                  )}
                  {p.sum.length > 0 && (
                    <text x={p.x + 14} y={ySum + 11} fontSize={11.5} fill={sColor} pointerEvents="none">
                      {p.sum.map((l, i) => (
                        <tspan key={i} x={p.x + 14} dy={i ? 15 : 0}>
                          {l}
                        </tspan>
                      ))}
                    </text>
                  )}
                  {/* Hover tools: open its map (overview), add a card, edit, remove. */}
                  {showTools && !linking && (
                    <g data-ui transform={`translate(${p.x + W - (p.badge ? 34 : 10)} ${p.y + p.h - 16})`}>
                      {[
                        ...(p.n.line >= 0 ? [{ k: 'show', label: '📄', tip: 'Show in document (in a popup)', fn: () => setPeek(p.n) }] : []),
                        ...(editMode
                          ? [
                              { k: 'add', label: '＋', tip: 'Add your own card under this one', fn: () => openEdit(null, p.n.id) },
                              { k: 'edit', label: '✎', tip: 'Edit this card: text, notes, web link, linked part of the document', fn: () => openEdit(p.n) },
                              { k: 'link', label: '🔗', tip: 'Link this card to another card (then click the other card)', fn: () => setLinking(p.n.id) },
                              ...(!isRoot ? [{ k: 'del', label: '✕', tip: p.n.kind === 'custom' ? 'Delete your card' : 'Remove this card from the map (the document is not changed)', fn: () => remove(p.n) }] : [])
                            ]
                          : [])
                      ]
                        .reverse()
                        .map((b, i) => (
                          <g key={b.k} transform={`translate(${-i * 26 - 12} 0)`} style={{ cursor: 'pointer' }} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={(e) => (e.stopPropagation(), b.fn())}>
                            <circle r={11} cx={0} cy={0} fill={colors.card} stroke={p.color} strokeWidth={1.4} />
                            <text textAnchor="middle" dy={4} fontSize={12} fill={colors.text}>
                              {b.label}
                            </text>
                            <title>{b.tip}</title>
                          </g>
                        ))}
                    </g>
                  )}
                </g>
              )
            })}
          </g>
        </svg>
        {kind === 'flow' && (
          <div className="mm-flow-list" onPointerDown={(e) => e.stopPropagation()}>
            <div className="mm-flow-head">Processes {focusNode ? 'in this chapter' : 'in this document'}</div>
            {processes.map((p, i) => (
              <button key={`${p.line}-${i}`} className={i === flowAt ? 'on' : ''} onClick={() => setFlowAt(i)} title={p.steps.join(' → ')}>
                {p.title} <span className="muted">· {p.steps.length} steps</span>
              </button>
            ))}
            {!processes.length && <p className="muted">No step-by-step process (numbered steps) here. Flowcharts show processes; the ideas of this part are in the mind map.</p>}
            <button className="mm-ai" onClick={() => void aiSteps()} disabled={!!progress} title="Have the AI write this part's main process as steps">
              ✨ Make one with AI
            </button>
          </div>
        )}
        {progress && (
          <div className="mm-working" onPointerDown={(e) => e.stopPropagation()} role="status" aria-live="polite">
            <span className="mm-spinner" aria-hidden="true" />
            <span>{progress}</span>
            <span className="muted small">You can keep using the map; Back, Book or Stop cancels it.</span>
            <button onClick={cancelAi}>Stop</button>
          </div>
        )}
        {kind === 'map' && study && (
          <StudyPanel
            tree={tree}
            scope={focusNode ?? tree}
            source={props.source}
            name={props.name}
            state={state}
            change={change}
            ai={props.ai}
            saveText={props.saveText}
            onOpen={(node, chapterId) => {
              props.onFocus(chapterId === tree.id ? null : chapterId)
              if (node.line >= 0 && node.kind !== 'doc') setPeek(node)
            }}
            onClose={() => setStudy(false)}
          />
        )}
        {kind === 'map' && placed.length <= 1 && <div className="mm-empty">This document has no headings yet. Add some (Insert → Heading) and they become the cards of the map.</div>}
      </div>
      <div className="mm-foot">
        {kind === 'flow'
          ? 'Flowchart: Start → steps → End; diamonds are decisions (Yes continues down, No goes to the side) · wheel to zoom · drag to move'
          : focusNode
          ? 'Click a topic to open its map, a paragraph card to read it · 📄 on a card shows it in the document · ← Back or Esc goes up a level · ✎ Edit mind map to move, add, edit and link cards'
          : 'Chapters in reading order · click a chapter to open its mind map · 📄 on a card shows it in the document · Alt+M or Esc closes'}
      </div>

      {peek && (
        <div className="modal-backdrop" onMouseDown={() => setPeek(null)}>
          <div className="modal mm-peek" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={peek.title}>
            <h3>{peek.kind === 'point' ? peek.card.idea : peek.title}</h3>
            <div className="mm-peek-card">
              {peek.card.keywords.length > 0 && <div className="mm-peek-keys">{peek.card.keywords.map((k) => `#${k}`).join('  ')}</div>}
              {peek.kind !== 'point' && peek.card.idea && <div className="mm-peek-idea">{peek.card.idea}</div>}
              {peek.card.summary && <div className="mm-peek-sum">{peek.card.summary}</div>}
              <div className="mm-peek-src">{peek.source === 'ai' ? 'Card written by AI' : peek.source === 'you' ? 'Your card' : 'Quick offline card'}</div>
            </div>
            {peek.notes && <div className="mm-peek-notes">{peek.notes}</div>}
            {(peek.url || state.links.some((l) => l.from === peek.id || l.to === peek.id)) && (
              <div className="mm-peek-links">
                {peek.url && (
                  <button className="link" onClick={() => props.openLink(peek.url!)} title={peek.url}>
                    🌐 Open web link
                  </button>
                )}
                {state.links
                  .filter((l) => l.from === peek.id || l.to === peek.id)
                  .map((l) => {
                    const other = findNode(tree, l.from === peek.id ? l.to : l.from)
                    return other ? (
                      <button key={other.id} className="link" onClick={() => setPeek(other)} title="Linked card">
                        🔗 {other.kind === 'point' ? other.card.idea : other.title}
                      </button>
                    ) : null
                  })}
              </div>
            )}
            {peekHtml ? <div className="markdown-body mm-peek-text" dangerouslySetInnerHTML={{ __html: peekHtml }} /> : <p className="muted">This is your own card; it has no passage in the document.</p>}
            <div className="modal-actions">
              {!focusNode && peek.kind !== 'doc' && peek.children.length > 0 && (
                <button onClick={() => openMap(peek)}>⤢ Open its mind map</button>
              )}
              {focusNode && peek.kind === 'heading' && peek.id !== focusNode.id && peek.children.some((c) => c.kind !== 'point') && (
                <button onClick={() => openMap(peek)}>⤢ Map of this topic</button>
              )}
              {editMode && (
                <button
                  onClick={() => {
                    const n = peek
                    setPeek(null)
                    openEdit(n)
                  }}
                >
                  ✎ Edit card
                </button>
              )}
              {peek.line >= 0 && (
                <button
                  onClick={() => {
                    const n = peek
                    setPeek(null)
                    props.onShowInDocument({ slug: n.slug, line: n.line })
                  }}
                >
                  Open in full document
                </button>
              )}
              <button className="primary" onClick={() => setPeek(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className="modal-backdrop" onMouseDown={() => setEditing(null)}>
          <div className="modal mm-edit" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Edit card">
            <h3>{editing.node ? 'Edit card' : 'New card'}</h3>
            {(!editing.node || editing.node.kind !== 'point') && (
              <label>
                <span>Title</span>
                <input autoFocus value={editing.draft.title} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, title: e.target.value } })} />
              </label>
            )}
            <label>
              <span>Key idea (one short line)</span>
              <input
                autoFocus={editing.node?.kind === 'point'}
                value={editing.draft.idea}
                onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, idea: e.target.value } })}
              />
            </label>
            <label>
              <span>Keywords (separated by commas)</span>
              <input
                value={editing.draft.keywords.join(', ')}
                onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, keywords: e.target.value.split(',') } })}
              />
            </label>
            <label>
              <span>Summary (about two sentences)</span>
              <textarea rows={3} value={editing.draft.summary} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, summary: e.target.value } })} />
            </label>
            <label>
              <span>Your notes (shown when the card is opened)</span>
              <textarea rows={3} value={editing.draft.notes} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, notes: e.target.value } })} />
            </label>
            <label>
              <span>Web link</span>
              <input placeholder="https://…" value={editing.draft.url} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, url: e.target.value } })} />
            </label>
            <label>
              <span>Linked part of the document (shown by “Show in document”)</span>
              <select
                value={editing.draft.link ? String(editing.draft.link.line) : ''}
                onChange={(e) => {
                  const part = docParts.find((d) => String(d.line) === e.target.value) ?? null
                  setEditing({ ...editing, draft: { ...editing.draft, link: part ? { ...part, label: part.label.trim() } : null } })
                }}
              >
                <option value="">{editing.node && editing.node.kind !== 'custom' ? 'Its own place in the document' : 'None'}</option>
                {docParts.map((d) => (
                  <option key={d.line} value={String(d.line)}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="modal-actions">
              {editing.node && state.edits[editing.node.id] && (
                <button
                  onClick={() => {
                    const id = editing.node!.id
                    change((s) => {
                      const edits = { ...s.edits }
                      delete edits[id]
                      return { ...s, edits }
                    })
                    setEditing(null)
                  }}
                >
                  Restore original
                </button>
              )}
              <span className="grow" />
              <button onClick={() => setEditing(null)}>Cancel</button>
              <button className="primary" onClick={saveEdit}>
                {editing.node ? 'Save' : 'Add card'}
              </button>
            </div>
            <p className="muted small">Changes are kept with the map, beside the document; the document itself is not changed.</p>
          </div>
        </div>
      )}
    </div>
  )
}

/** Draws a laid-out flowchart: pills for Start and End, boxes for steps, diamonds for decisions. */
function FlowDrawing({ flow, colors }: { flow: ReturnType<typeof flowLayout>; colors: { card: string; text: string; muted: string; root: string } }): React.JSX.Element {
  const by = new Map(flow.nodes.map((n) => [n.id, n]))
  const ACC = '#4C9BE8'
  const DEC = '#F28C38'
  const edgePath = (a: FlowLaid, b: FlowLaid): string => {
    if (a.col === b.col) return `M${a.cx},${a.cy + a.h / 2} L${b.cx},${b.cy - b.h / 2}`
    // The "No" path: out of the diamond's side, then back into the main path below.
    if (b.col > a.col) return `M${a.cx + a.w / 2},${a.cy} H${b.cx - b.w / 2}`
    return `M${a.cx},${a.cy + a.h / 2} V${b.cy} H${b.cx + b.w / 2}`
  }
  return (
    <g>
      {flow.edges.map((e, i) => {
        const a = by.get(e.from)!
        const b = by.get(e.to)!
        const lx = e.label === 'No' ? a.cx + a.w / 2 + 14 : a.cx + 10
        const ly = e.label === 'No' ? a.cy - 6 : a.cy + a.h / 2 + 16
        return (
          <g key={i}>
            <path d={edgePath(a, b)} fill="none" stroke={colors.muted} strokeWidth={1.6} markerEnd="url(#mm-arrow)" />
            {e.label && (
              <text x={lx} y={ly} fontSize={12} fontWeight={700} fill={e.label === 'Yes' ? '#4FB487' : '#E2678C'}>
                {e.label}
              </text>
            )}
          </g>
        )
      })}
      {flow.nodes.map((n: FlowNode & { lines: string[]; w: number; h: number; cx: number; cy: number }) => {
        const left = n.cx - n.w / 2
        const top = n.cy - n.h / 2
        const shape =
          n.kind === 'decision' ? (
            <polygon points={`${n.cx},${top} ${n.cx + n.w / 2},${n.cy} ${n.cx},${top + n.h} ${left},${n.cy}`} fill={colors.card} stroke={DEC} strokeWidth={2} />
          ) : n.kind === 'step' ? (
            <rect x={left} y={top} width={n.w} height={n.h} rx={8} fill={colors.card} stroke={ACC} strokeWidth={1.8} />
          ) : (
            <rect x={left} y={top} width={n.w} height={n.h} rx={n.h / 2} fill={colors.root} />
          )
        const lineH = n.kind === 'decision' ? 16 : 17
        const y0 = n.cy - ((n.lines.length - 1) * lineH) / 2 + 4
        return (
          <g key={n.id}>
            {shape}
            <text textAnchor="middle" fontSize={n.kind === 'decision' ? 12.5 : 13.5} fontWeight={n.kind === 'step' ? 500 : 700} fill={n.kind === 'start' || n.kind === 'end' ? '#fff' : colors.text}>
              {n.lines.map((l, i) => (
                <tspan key={i} x={n.cx} y={y0 + i * lineH}>
                  {l}
                </tspan>
              ))}
            </text>
          </g>
        )
      })}
    </g>
  )
}
