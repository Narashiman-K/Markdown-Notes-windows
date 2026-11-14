/**
 * Mind map and flowchart of the document's headings, full window.
 *
 * Mind map: the document in the middle, its topics branching out to both
 * sides. Flowchart: the same tree, top to bottom. Each topic shows a short
 * summary: an instant offline one (lib/mindmap.ts), or one written by the AI
 * set up in the AI panel when asked. Without an AI connected the map still
 * works, and says why there are no AI summaries.
 *
 * Wheel zooms, dragging the background pans, the small round button on a
 * topic folds its branch, and clicking a topic jumps to it in the document.
 * Export as PNG or SVG, print, or insert the map into the document as a
 * Mermaid diagram.
 *
 * Drawn as plain SVG with every colour written on the element, so an exported
 * picture looks the same anywhere.
 *
 * Kept identical across the Windows app and the web app.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildTree, countNodes, plainText, toMermaidFlowchart, toMermaidMindmap, walk, type MapNode } from '../lib/mindmap'

type Mode = 'map' | 'flow'
/** Flowchart direction: top to bottom, or left to right. */
type Dir = 'down' | 'right'

interface Props {
  source: string
  name: string
  dark: boolean
  onClose: () => void
  onJump: (node: { slug: string; line: number }) => void
  onInsert: (mermaid: string) => void
  ai: {
    status: () => Promise<{ ready: boolean; detail: string }>
    ask: (system: string, user: string) => Promise<{ ok: boolean; text?: string; error?: string }>
  }
  saveImage: (name: string, data: Blob) => Promise<void>
  print: (html: string) => Promise<void>
}

const PALETTE = ['#4C9BE8', '#F28C38', '#4FB487', '#A77BE0', '#E2678C', '#36AFC0', '#C9A227', '#7F93AD']
const NODE_W = 236
const FONT = "system-ui, 'Segoe UI', sans-serif"

/** Wraps text into lines of about `chars` characters. */
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
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…'
  }
  return lines
}

interface Placed {
  n: MapNode
  depth: number
  x: number
  y: number
  w: number
  h: number
  title: string[]
  sum: string[]
  color: string
  side: 1 | -1
  kids: number
  folded: boolean
}

function layout(root: MapNode, mode: Mode, dir: Dir, folded: Set<string>, summaries: (n: MapNode) => string, showSum: boolean) {
  // Laid out sideways (topics stacked down the page): the mind map, and the
  // flowchart drawn left to right.
  const across = mode === 'map' || dir === 'right'
  const box = (n: MapNode, depth: number): { title: string[]; sum: string[]; w: number; h: number } => {
    const title = wrap(n.title, depth === 0 ? 24 : 30, depth === 0 ? 3 : 2)
    const s = showSum ? summaries(n) : ''
    const sum = s ? wrap(s, 36, depth === 0 ? 3 : 4) : []
    const lineH = depth === 0 ? 20 : 17
    return { title, sum, w: NODE_W, h: 18 + title.length * lineH + (sum.length ? 6 + sum.length * 15 : 0) }
  }
  const placed: Placed[] = []
  const edges: Array<{ a: Placed; b: Placed }> = []
  const GAP = across ? 14 : 26
  const STEP = across ? NODE_W + 80 : 0

  // Breadth of a subtree: heights stacked (mind map) or widths side by side (flowchart).
  const sizeOf = new Map<string, number>()
  const measure = (n: MapNode, depth: number): number => {
    const b = box(n, depth)
    const own = across ? b.h : b.w
    const kids = folded.has(n.id) ? [] : n.children
    const sum = kids.reduce((t, c) => t + measure(c, depth + 1), 0) + Math.max(0, kids.length - 1) * GAP
    const s = Math.max(own, sum)
    sizeOf.set(n.id, s)
    return s
  }

  // Flowchart rows: each depth as tall as its tallest topic.
  const rowH: number[] = []
  if (!across) walk(root, (n, d) => (rowH[d] = Math.max(rowH[d] ?? 0, box(n, d).h)))
  const rowY = (d: number): number => rowH.slice(0, d).reduce((t, h) => t + h + 70, 0)

  const place = (n: MapNode, depth: number, start: number, side: 1 | -1, color: string, parent: Placed | null): void => {
    const b = box(n, depth)
    const size = sizeOf.get(n.id) ?? 0
    const mid = start + size / 2
    const p: Placed = {
      n,
      depth,
      x: across ? side * depth * STEP : mid,
      y: across ? mid : rowY(depth) + b.h / 2,
      w: b.w,
      h: b.h,
      title: b.title,
      sum: b.sum,
      color,
      side,
      kids: n.children.length,
      folded: folded.has(n.id)
    }
    placed.push(p)
    if (parent) edges.push({ a: parent, b: p })
    if (p.folded) return
    const kids = n.children
    const total = kids.reduce((t, c) => t + (sizeOf.get(c.id) ?? 0), 0) + Math.max(0, kids.length - 1) * GAP
    let at = mid - total / 2
    kids.forEach((c, i) => {
      const col = depth === 0 ? PALETTE[i % PALETTE.length] : color
      place(c, depth + 1, at, side, col, p)
      at += (sizeOf.get(c.id) ?? 0) + GAP
    })
  }

  if (mode === 'flow') {
    measure(root, 0)
    place(root, 0, 0, 1, '#888', null)
  } else {
    // Topics split between the two sides, balancing their height.
    const rb = box(root, 0)
    const rootP: Placed = { n: root, depth: 0, x: 0, y: 0, w: rb.w, h: rb.h, title: rb.title, sum: rb.sum, color: '#888', side: 1, kids: root.children.length, folded: folded.has(root.id) }
    placed.push(rootP)
    if (!rootP.folded) {
      const kids = root.children.map((c, i) => ({ c, i, s: measure(c, 1) }))
      const total = kids.reduce((t, k) => t + k.s, 0)
      let acc = 0
      const right = kids.filter((k) => (acc += k.s) <= total / 2 + k.s / 2 || k.i === 0)
      const left = kids.filter((k) => !right.includes(k))
      for (const [group, side] of [
        [right, 1],
        [left, -1]
      ] as const) {
        const height = group.reduce((t, k) => t + k.s, 0) + Math.max(0, group.length - 1) * GAP
        let at = -height / 2
        for (const k of group) {
          place(k.c, 1, at, side, PALETTE[k.i % PALETTE.length], rootP)
          at += k.s + GAP
        }
      }
    }
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of placed) {
    minX = Math.min(minX, p.x - p.w / 2)
    maxX = Math.max(maxX, p.x + p.w / 2)
    minY = Math.min(minY, p.y - p.h / 2)
    maxY = Math.max(maxY, p.y + p.h / 2)
  }
  const pad = 40
  return { placed, edges, bounds: { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad } }
}

export default function MindMapView(props: Props): React.JSX.Element {
  const { dark } = props
  const tree = useMemo(() => buildTree(props.source, props.name), [props.source, props.name])
  const total = useMemo(() => countNodes(tree), [tree])
  const [mode, setMode] = useState<Mode>('map')
  // A wide top level reads better left to right.
  const [dir, setDir] = useState<Dir>(() => (tree.children.length > 6 ? 'right' : 'down'))
  const [showSum, setShowSum] = useState(true)
  const [folded, setFolded] = useState<Set<string>>(() => {
    // A big document starts with only its main topics open.
    const f = new Set<string>()
    if (total > 45) walk(tree, (n, d) => d >= 1 && n.children.length && f.add(n.id))
    return f
  })
  const [aiSum, setAiSum] = useState<Map<string, string>>(new Map())
  const [aiState, setAiState] = useState<{ ready: boolean | null; detail: string }>({ ready: null, detail: '' })
  const [progress, setProgress] = useState<string>('')
  const [banner, setBanner] = useState<string>('')
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const hostRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const alive = useRef(true)
  useEffect(() => () => void (alive.current = false), [])

  const summaryOf = useCallback((n: MapNode) => aiSum.get(n.id) ?? n.summary, [aiSum])
  const { placed, edges, bounds } = useMemo(() => layout(tree, mode, dir, folded, summaryOf, showSum), [tree, mode, dir, folded, summaryOf, showSum])

  const colors = dark
    ? { bg: '#1b1d22', card: '#262a31', text: '#e8e8e8', muted: '#a9b0ba', rootText: '#ffffff', root: '#2f6fb0' }
    : { bg: '#fbfbfc', card: '#ffffff', text: '#1f2328', muted: '#5f6670', rootText: '#ffffff', root: '#0f6cbd' }

  // Fit the whole map in the window.
  const fit = useCallback(() => {
    const host = hostRef.current
    if (!host) return
    const k = Math.min(1.2, Math.max(0.15, Math.min(host.clientWidth / bounds.w, host.clientHeight / bounds.h)))
    setView({ k, x: (host.clientWidth - bounds.w * k) / 2 - bounds.x * k, y: (host.clientHeight - bounds.h * k) / 2 - bounds.y * k })
  }, [bounds])
  const fitKey = `${mode}-${dir}`
  useEffect(() => fit(), [fitKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Is an AI connected? Without one the map still works; it just says so.
  useEffect(() => {
    void props.ai.status().then((s) => {
      if (!alive.current) return
      setAiState(s)
      if (!s.ready) {
        setBanner(
          'No AI is connected (local Ollama or an API key), so AI summaries were not generated. Each topic shows a quick offline summary instead. Connect one in the AI panel for AI summaries.'
        )
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [props])

  /* --------------------------------------------------------- AI summaries */
  const aiSummaries = async (): Promise<void> => {
    const s = await props.ai.status()
    setAiState(s)
    if (!s.ready) {
      setBanner(
        `No AI is connected (local Ollama or an API key), so AI summaries were not generated${s.detail ? ` (${s.detail})` : ''}. The quick offline summaries stay. Connect one in the AI panel, then try again.`
      )
      return
    }
    setBanner('')
    const todo: MapNode[] = []
    walk(tree, (n) => plainText(n.body).length > 40 && !aiSum.has(n.id) && todo.push(n))
    const next = new Map(aiSum)
    for (let i = 0; i < todo.length && alive.current; i += 8) {
      const batch = todo.slice(i, i + 8)
      setProgress(`Writing AI summaries: ${Math.min(i + 8, todo.length)} of ${todo.length}…`)
      const user = batch.map((n) => `### ${n.id}: ${n.title}\n${plainText(n.body).slice(0, 1400)}`).join('\n\n')
      const r = await props.ai.ask(
        'You summarise sections of a document for a mind map. For each section below, write one or two plain sentences, at most 30 words, saying what it covers. Reply with JSON only, mapping each section id to its summary, like {"h3": "…", "h4": "…"}. No other text.',
        user
      )
      if (!r.ok) {
        setBanner(`The AI could not write summaries (${r.error ?? 'no answer'}). The quick offline summaries stay.`)
        break
      }
      try {
        const json = JSON.parse(String(r.text ?? '').replace(/^[\s\S]*?(\{[\s\S]*\})[\s\S]*$/, '$1')) as Record<string, string>
        for (const n of batch) if (typeof json[n.id] === 'string' && json[n.id].trim()) next.set(n.id, json[n.id].trim())
        if (alive.current) setAiSum(new Map(next))
      } catch {
        /* an answer that is not JSON: those topics keep their offline summary */
      }
    }
    if (alive.current) setProgress('')
  }

  /* -------------------------------------------------------------- export */
  const svgText = (): string => {
    const svg = svgRef.current!.cloneNode(true) as SVGSVGElement
    const g = svg.querySelector('g[data-root]') as SVGGElement
    g.setAttribute('transform', `translate(${-bounds.x} ${-bounds.y})`)
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
  const base = props.name.replace(/\.[^.]+$/, '') || 'document'
  const exportSvg = async (): Promise<void> => {
    await props.saveImage(`${base} ${mode === 'map' ? 'mind map' : 'flowchart'}.svg`, new Blob([svgText()], { type: 'image/svg+xml' }))
  }
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
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(bounds.w * scale)
      canvas.height = Math.round(bounds.h * scale)
      const ctx = canvas.getContext('2d')!
      ctx.scale(scale, scale)
      ctx.drawImage(img, 0, 0)
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
      if (blob) await props.saveImage(`${base} ${mode === 'map' ? 'mind map' : 'flowchart'}.png`, blob)
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  const doPrint = async (): Promise<void> => {
    const landscape = bounds.w > bounds.h
    await props.print(
      `<!doctype html><html><head><meta charset="utf-8"><title>${base}</title><style>@page { size: ${landscape ? 'landscape' : 'portrait'}; margin: 10mm; } html,body{margin:0;background:#fff} svg{width:100%;height:auto;max-height:100vh}</style></head><body>${svgText()}</body></html>`
    )
  }

  /* --------------------------------------------------------- pan and zoom */
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)
  const onWheel = (e: React.WheelEvent): void => {
    const host = hostRef.current!.getBoundingClientRect()
    const px = e.clientX - host.left
    const py = e.clientY - host.top
    const k2 = Math.min(3, Math.max(0.1, view.k * Math.exp(-e.deltaY * 0.0015)))
    setView({ k: k2, x: px - ((px - view.x) / view.k) * k2, y: py - ((py - view.y) / view.k) * k2 })
  }
  const zoomBy = (f: number): void => {
    const host = hostRef.current!
    const px = host.clientWidth / 2
    const py = host.clientHeight / 2
    const k2 = Math.min(3, Math.max(0.1, view.k * f))
    setView({ k: k2, x: px - ((px - view.x) / view.k) * k2, y: py - ((py - view.y) / view.k) * k2 })
  }

  const toggle = (id: string): void =>
    setFolded((f) => {
      const n = new Set(f)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  /* --------------------------------------------------------------- draw */
  const edgePath = (a: Placed, b: Placed): string => {
    if (mode === 'flow' && dir === 'right') {
      const x1 = a.x + a.w / 2
      const x2 = b.x - b.w / 2
      const mx = x1 + 30
      return `M${x1},${a.y} H${mx} V${b.y} H${x2}`
    }
    if (mode === 'flow') {
      const y1 = a.y + a.h / 2
      const y2 = b.y - b.h / 2
      const my = (y1 + y2) / 2
      return `M${a.x},${y1} V${my} H${b.x} V${y2}`
    }
    const x1 = a.x + (b.side * a.w) / 2
    const x2 = b.x - (b.side * b.w) / 2
    const mx = (x1 + x2) / 2
    return `M${x1},${a.y} C${mx},${a.y} ${mx},${b.y} ${x2},${b.y}`
  }

  return (
    <div className="mindmap-view" data-mn-ignore role="dialog" aria-label="Mind map">
      <div className="mm-bar">
        <span className="segmented mm-modes">
          <button className={mode === 'map' ? 'on' : ''} onClick={() => setMode('map')}>
            Mind map
          </button>
          <button className={mode === 'flow' ? 'on' : ''} onClick={() => setMode('flow')}>
            Flowchart
          </button>
        </span>
        {mode === 'flow' && (
          <span className="segmented mm-modes" title="Which way the flowchart runs">
            <button className={dir === 'down' ? 'on' : ''} onClick={() => setDir('down')} title="Top to bottom">
              ↓
            </button>
            <button className={dir === 'right' ? 'on' : ''} onClick={() => setDir('right')} title="Left to right">
              →
            </button>
          </span>
        )}
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
          <button onClick={() => setFolded(new Set())} title="Open every branch">
            Expand all
          </button>
          <button
            onClick={() => {
              const f = new Set<string>()
              walk(tree, (n, d) => d >= 1 && n.children.length && f.add(n.id))
              setFolded(f)
            }}
            title="Show only the main topics"
          >
            Collapse
          </button>
        </span>
        <label className="mm-check">
          <input type="checkbox" checked={showSum} onChange={(e) => setShowSum(e.target.checked)} /> Summaries
        </label>
        <button className="mm-ai" onClick={() => void aiSummaries()} disabled={!!progress} title={aiState.ready === false ? aiState.detail : 'Summaries written by the AI set up in the AI panel'}>
          ✨ AI summaries
        </button>
        <span className="grow" />
        <span className="mm-group">
          <button onClick={() => void exportPng()} title="Save the map as a PNG picture">
            PNG
          </button>
          <button onClick={() => void exportSvg()} title="Save the map as an SVG picture (sharp at any size)">
            SVG
          </button>
          <button onClick={() => void doPrint()} title="Print the map">
            Print
          </button>
          <button onClick={() => props.onInsert(mode === 'map' ? toMermaidMindmap(tree) : toMermaidFlowchart(tree))} title="Insert this map into the document as a Mermaid diagram">
            Insert into document
          </button>
        </span>
        <button className="mm-close" onClick={props.onClose} title="Close (Esc)" aria-label="Close">
          ✕
        </button>
      </div>
      {(banner || progress) && (
        <div className={`mm-banner${progress ? ' busy' : ''}`}>
          {progress || banner}
          {banner && !progress && (
            <button className="link" onClick={() => setBanner('')}>
              Dismiss
            </button>
          )}
        </div>
      )}
      <div
        className="mm-canvas"
        ref={hostRef}
        onWheel={onWheel}
        onPointerDown={(e) => {
          if ((e.target as Element).closest('[data-node]')) return
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }))
        }}
        onPointerUp={() => (drag.current = null)}
        style={{ background: colors.bg }}
      >
        <svg ref={svgRef} width="100%" height="100%" fontFamily={FONT}>
          <defs>
            <marker id="mm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={colors.muted} />
            </marker>
          </defs>
          <g data-root transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {edges.map(({ a, b }) => (
              <path
                key={`${a.n.id}-${b.n.id}`}
                d={edgePath(a, b)}
                fill="none"
                stroke={mode === 'flow' ? colors.muted : b.color}
                strokeOpacity={mode === 'flow' ? 0.8 : 0.85}
                strokeWidth={mode === 'flow' ? 1.4 : Math.max(1.4, 4 - b.depth)}
                markerEnd={mode === 'flow' ? 'url(#mm-arrow)' : undefined}
              />
            ))}
            {placed.map((p) => {
              const isRoot = p.depth === 0
              const left = p.x - p.w / 2
              const top = p.y - p.h / 2
              const lineH = isRoot ? 20 : 17
              const tColor = isRoot ? colors.rootText : colors.text
              const sColor = isRoot ? 'rgba(255,255,255,0.85)' : colors.muted
              return (
                <g key={p.n.id} data-node className="mm-node">
                  <rect
                    x={left}
                    y={top}
                    width={p.w}
                    height={p.h}
                    rx={10}
                    fill={isRoot ? colors.root : colors.card}
                    stroke={isRoot ? colors.root : p.color}
                    strokeWidth={isRoot ? 0 : 1.6}
                    style={{ cursor: p.n.slug || p.n.line >= 0 ? 'pointer' : 'default' }}
                    onClick={() => (p.n.slug || p.n.line >= 0) && props.onJump({ slug: p.n.slug, line: p.n.line })}
                  >
                    <title>{p.n.line >= 0 ? 'Go to this part of the document' : p.n.title}</title>
                  </rect>
                  {!isRoot && <rect x={left} y={top + 8} width={4} height={p.h - 16} rx={2} fill={p.color} pointerEvents="none" />}
                  <text x={left + 14} y={top + 9 + lineH * 0.8} fontSize={isRoot ? 16 : 13.5} fontWeight={700} fill={tColor} pointerEvents="none">
                    {p.title.map((l, i) => (
                      <tspan key={i} x={left + 14} dy={i ? lineH : 0}>
                        {l}
                      </tspan>
                    ))}
                  </text>
                  {p.sum.length > 0 && (
                    <text x={left + 14} y={top + 9 + p.title.length * lineH + 6 + 11} fontSize={11.5} fill={sColor} pointerEvents="none">
                      {p.sum.map((l, i) => (
                        <tspan key={i} x={left + 14} dy={i ? 15 : 0}>
                          {l}
                        </tspan>
                      ))}
                    </text>
                  )}
                  {p.kids > 0 && (
                    <g
                      data-ui
                      style={{ cursor: 'pointer' }}
                      onClick={() => toggle(p.n.id)}
                      transform={
                        mode === 'flow' && dir === 'down'
                          ? `translate(${p.x} ${p.y + p.h / 2})`
                          : `translate(${isRoot ? p.x + p.w / 2 : p.x + (p.side * p.w) / 2} ${p.y})`
                      }
                    >
                      <circle r={9} fill={colors.card} stroke={isRoot ? colors.root : p.color} strokeWidth={1.5} />
                      <text textAnchor="middle" dy={4} fontSize={p.folded ? 10 : 13} fill={colors.text}>
                        {p.folded ? p.kids : '−'}
                      </text>
                      <title>{p.folded ? `Show ${p.kids} sub-topic${p.kids === 1 ? '' : 's'}` : 'Fold this branch'}</title>
                    </g>
                  )}
                </g>
              )
            })}
          </g>
        </svg>
        {total <= 1 && <div className="mm-empty">This document has no headings yet. Add some (Insert → Heading) and they become the topics of the map.</div>}
      </div>
      <div className="mm-foot">
        {total - 1} topic{total === 2 ? '' : 's'} · Wheel to zoom · Drag to move · Click a topic to go to it · Esc to close
      </div>
    </div>
  )
}
