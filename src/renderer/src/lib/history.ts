/**
 * Document-level undo/redo.
 *
 * CodeMirror keeps its own history, but that only covers typing inside the
 * source editor. Annotations applied in view mode and edits made by the AI
 * happen outside it, so they need a history of their own. This stack sits above
 * the whole document and can revert anything that changed the text.
 */

export interface HistoryEntry {
  content: string
  label: string
  at: number
}

export interface HistoryState {
  past: HistoryEntry[]
  future: HistoryEntry[]
}

export const EMPTY_HISTORY: HistoryState = { past: [], future: [] }

const LIMIT = 120

/** Records the state *before* a change, discarding any redo branch. */
export function record(state: HistoryState, previous: string, label: string): HistoryState {
  const past = [...state.past, { content: previous, label, at: Date.now() }]
  return { past: past.slice(-LIMIT), future: [] }
}

export function canUndo(state: HistoryState): boolean {
  return state.past.length > 0
}

export function canRedo(state: HistoryState): boolean {
  return state.future.length > 0
}

export function undoLabel(state: HistoryState): string {
  return state.past[state.past.length - 1]?.label ?? ''
}

export function redoLabel(state: HistoryState): string {
  return state.future[state.future.length - 1]?.label ?? ''
}

export function undo(
  state: HistoryState,
  current: string
): { state: HistoryState; content: string; label: string } | null {
  const entry = state.past[state.past.length - 1]
  if (!entry) return null
  return {
    state: {
      past: state.past.slice(0, -1),
      future: [...state.future, { content: current, label: entry.label, at: Date.now() }].slice(-LIMIT)
    },
    content: entry.content,
    label: entry.label
  }
}

export function redo(
  state: HistoryState,
  current: string
): { state: HistoryState; content: string; label: string } | null {
  const entry = state.future[state.future.length - 1]
  if (!entry) return null
  return {
    state: {
      past: [...state.past, { content: current, label: entry.label, at: Date.now() }].slice(-LIMIT),
      future: state.future.slice(0, -1)
    },
    content: entry.content,
    label: entry.label
  }
}
