/**
 * Flowcharts, which are not mind maps: a flowchart shows a process, the
 * steps in order with the decisions that change the path. They are made from
 * the parts of a document that really describe a process:
 *
 *   - a numbered list of three or more steps ("1. Open the lid …");
 *   - lines starting "Step 1", "Step 2" …
 *
 * A step that asks a question ("If the soil is dry?", "Is it raining?") is a
 * decision. When the next step starts "Otherwise" (or "If not", "Else"), that
 * is the "No" path; both paths then join at the step after.
 *
 * Kept identical across the Windows app and the web app.
 */

export interface Process {
  /** The heading or lead-in line it sits under. */
  title: string
  /** 0-based source line of the first step. */
  line: number
  steps: string[]
}

const clean = (t: string): string =>
  t
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** The processes (numbered steps) in a stretch of the document. */
export function findProcesses(markdown: string, from = 0, to?: number): Process[] {
  const lines = markdown.split('\n')
  const end = Math.min(to ?? lines.length, lines.length)
  const out: Process[] = []
  let heading = ''
  let lead = ''
  let cur: Process | null = null
  let fence = false
  const close = (): void => {
    if (cur && cur.steps.length >= 3) out.push(cur)
    cur = null
  }
  for (let i = from; i < end; i++) {
    const l = lines[i]
    if (/^\s*(```|~~~)/.test(l)) fence = !fence
    if (fence) continue
    const h = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(l)
    if (h) {
      close()
      heading = clean(h[1])
      lead = ''
      continue
    }
    const step = /^\s{0,3}(\d{1,3})[.)]\s+(.+)$/.exec(l) ?? /^\s{0,3}(?:\*\*)?step\s+(\d{1,3})(?:\*\*)?\s*[:.–-]\s*(.+)$/i.exec(l)
    if (step) {
      if (!cur) cur = { title: lead || heading || 'Steps', line: i, steps: [] }
      cur.steps.push(clean(step[2]))
      continue
    }
    // A wrapped line of the same step, or a blank line inside the list.
    if (cur && (/^\s{2,}\S/.test(l) || !l.trim())) {
      if (l.trim() && cur.steps.length) cur.steps[cur.steps.length - 1] += ' ' + clean(l)
      continue
    }
    close()
    if (l.trim()) lead = /:\s*$/.test(l.trim()) ? clean(l).replace(/:$/, '') : ''
  }
  close()
  return out
}

/** A step that is a yes/no question. */
export const isDecision = (s: string): boolean =>
  /\?\s*$/.test(s) || /^(?:if|whether|check (?:if|whether)|decide (?:if|whether))\b/i.test(s)

/** A step that is the "No" path of the decision before it. */
const isOtherwise = (s: string): boolean => /^(?:otherwise|else|if not|if no)\b[\s,:]*/i.test(s)

export type FlowKind = 'start' | 'end' | 'step' | 'decision'

export interface FlowNode {
  id: string
  kind: FlowKind
  text: string
  /** Column: 0 the main path, 1 the "No" path beside it. */
  col: 0 | 1
  row: number
}

export interface FlowEdge {
  from: string
  to: string
  label?: 'Yes' | 'No'
}

/** The steps as nodes and arrows, from Start to End. */
export function flowFromSteps(steps: string[]): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = [{ id: 'start', kind: 'start', text: 'Start', col: 0, row: 0 }]
  const edges: FlowEdge[] = []
  let row = 1
  // Ends still waiting to be joined to the next main step.
  let open: Array<{ id: string; label?: 'Yes' | 'No' }> = [{ id: 'start' }]
  for (let i = 0; i < steps.length; i++) {
    const text = steps[i]
    const id = `s${i}`
    const kind: FlowKind = isDecision(text) ? 'decision' : 'step'
    nodes.push({ id, kind, text, col: 0, row: row++ })
    for (const o of open) edges.push({ from: o.id, to: id, label: o.label })
    open = [{ id }]
    if (kind === 'decision') {
      const next = steps[i + 1]
      if (next && isOtherwise(next)) {
        // Yes: carry on down the main path; No: the "otherwise" step beside the
        // question, which then rejoins the main path below.
        const alt = `s${i + 1}`
        nodes.push({ id: alt, kind: isDecision(next) ? 'decision' : 'step', text: next.replace(/^(?:otherwise|else|if not|if no)\b[\s,:]*/i, '').replace(/^\w/, (c) => c.toUpperCase()), col: 1, row: row - 1 })
        edges.push({ from: id, to: alt, label: 'No' })
        open = [{ id, label: 'Yes' }, { id: alt }]
        i++
      } else {
        open = [{ id, label: 'Yes' }]
      }
    }
  }
  nodes.push({ id: 'end', kind: 'end', text: 'End', col: 0, row: row })
  for (const o of open) edges.push({ from: o.id, to: 'end', label: o.label })
  return { nodes, edges }
}
