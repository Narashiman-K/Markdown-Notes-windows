/**
 * Compare documents: the open document (left) against another (right).
 *
 * The other one is a file (converted first when it is not text), the open
 * document as last saved, or a document open in another window or tab. The
 * caller lists those; this view does the rest:
 *
 *   - side by side, or one column marked like tracked changes;
 *   - changed words marked inside each changed block, nothing ignored;
 *   - Next / Previous change (Alt+Down / Alt+Up);
 *   - take a change across in either direction, edit either side of a change
 *     in place, or edit either whole text and see the marks follow;
 *   - ask the AI to explain the differences;
 *   - export the comparison as a page (HTML) or Markdown.
 *
 * Left-side edits go into the open document as undoable steps. Right-side
 * edits are kept here until saved with the button the source provides (or
 * offered when closing); a source with no way to save is view-only.
 *
 * Platform-neutral, kept identical in the Windows app and the web app.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  compareTexts,
  htmlReport,
  markdownReport,
  normaliseNewlines,
  replaceChangeSide,
  takeChange,
  unifiedDiff,
  type Change,
  type Side
} from '../lib/compare'
import { renderMarkdown } from '../lib/markdown'
import Loader from './Loader'

export interface LoadedSide {
  name: string
  text: string
  /** Writes the right side back; resolves to an error message, or null when saved. */
  save?: (text: string) => Promise<string | null>
  /** What the save button says, e.g. "Save to report.md" or "Update window 2". */
  saveLabel?: string
}

export interface CompareSource {
  id: string
  label: string
  detail?: string
  load: () => Promise<LoadedSide | null>
}

interface Props {
  leftName: string
  leftText: string
  /** Puts new text into the open document (undoable). */
  onLeftChange: (text: string, label: string) => void
  /** Where the right side can come from; asked each time the chooser shows. */
  listSources: () => Promise<CompareSource[]>
  ask: (system: string, user: string) => Promise<{ ok: boolean; text?: string; error?: string }>
  exportReport: (fileName: string, data: string, kind: 'html' | 'md') => Promise<void>
  confirm: (title: string, message: string) => Promise<boolean>
  onClose: () => void
}

const AI_SYSTEM = [
  'You explain the differences between two versions of a document to a non-technical reader.',
  'You are given a unified diff: lines starting "- " are only in the first document, "+ " only in the second, two spaces are shared context.',
  'Write in plain language. Start with a two-sentence overview of how the documents differ.',
  'Then list the changes that matter most, grouped by topic or section, quoting the exact old and new words briefly.',
  'Call out any change to numbers, dates, names, amounts, obligations or negations (e.g. "must" to "may", "not" added or removed).',
  'Then mention, in one line, the purely cosmetic changes (spacing, punctuation, formatting), without listing each.',
  'Do not invent changes that are not in the diff. Keep it under 300 words.'
].join(' ')

type View = 'side' | 'inline'

export default function CompareView(props: Props): React.JSX.Element {
  const [sources, setSources] = useState<CompareSource[] | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [right, setRight] = useState<LoadedSide | null>(null)
  const [rightText, setRightText] = useState('')
  const [rightSaved, setRightSaved] = useState('')
  const [leftText, setLeftText] = useState(props.leftText)
  const [view, setView] = useState<View>('side')
  const [wholeEdit, setWholeEdit] = useState(false)
  const [current, setCurrent] = useState(0)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [editing, setEditing] = useState<{ index: number; side: Side; draft: string } | null>(null)
  const [ai, setAi] = useState<{ busy: boolean; text?: string; error?: string } | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  // The open document can change underneath (autosave reload, another edit):
  // follow it while nothing here is being typed.
  useEffect(() => {
    if (!wholeEdit && !editing) setLeftText(props.leftText)
  }, [props.leftText, wholeEdit, editing])

  useEffect(() => {
    props.listSources().then(setSources, (e) => setError(String(e?.message ?? e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const comparison = useMemo(() => (right ? compareTexts(leftText, rightText) : null), [right, leftText, rightText])
  const changes = comparison?.changes ?? []
  const names = { left: props.leftName, right: right?.name ?? '' }
  const rightDirty = right !== null && rightText !== rightSaved

  useEffect(() => {
    if (current >= changes.length) setCurrent(Math.max(0, changes.length - 1))
  }, [changes.length, current])

  const flash = (msg: string): void => {
    setNote(msg)
    window.setTimeout(() => setNote((n) => (n === msg ? null : n)), 2600)
  }

  const choose = async (source: CompareSource): Promise<void> => {
    setError(null)
    setLoading(source.label)
    try {
      const loaded = await source.load()
      if (!loaded) return
      const text = normaliseNewlines(loaded.text)
      setRight(loaded)
      setRightText(text)
      setRightSaved(text)
      setCurrent(0)
      setExpanded(new Set())
      setAi(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(null)
    }
  }

  const goTo = useCallback(
    (i: number) => {
      if (!changes.length) return
      const n = (i + changes.length) % changes.length
      setCurrent(n)
      requestAnimationFrame(() => {
        const el = bodyRef.current?.querySelector(`[data-change="${n}"]`) as HTMLElement | null
        if (!el) return
        el.scrollIntoView({ block: 'center' })
        el.classList.remove('cmp-flash')
        void el.offsetWidth
        el.classList.add('cmp-flash')
      })
    },
    [changes.length]
  )

  const setLeft = (text: string, label: string): void => {
    setLeftText(text)
    props.onLeftChange(text, label)
  }

  const take = (c: Change, into: Side): void => {
    if (!comparison) return
    if (into === 'left') setLeft(takeChange(comparison, c.index, 'left', leftText), 'Compare: took a change')
    else setRightText(takeChange(comparison, c.index, 'right', rightText))
    flash(into === 'left' ? `Change ${c.index + 1} taken into ${props.leftName}. Ctrl+Z to undo.` : `Change ${c.index + 1} taken into ${names.right}.`)
  }

  const takeAll = async (into: Side): Promise<void> => {
    const target = into === 'left' ? props.leftName : names.right
    if (!(await props.confirm('Take every change?', `Make ${target} the same as the other document? ${changes.length} change(s).`))) return
    if (into === 'left') setLeft(rightText, 'Compare: took every change')
    else setRightText(leftText)
  }

  const saveEdit = (): void => {
    if (!editing || !comparison) return
    if (editing.side === 'left') setLeft(replaceChangeSide(comparison, editing.index, 'left', editing.draft, leftText), 'Compare: edited')
    else setRightText(replaceChangeSide(comparison, editing.index, 'right', editing.draft, rightText))
    setEditing(null)
  }

  const saveRight = async (): Promise<boolean> => {
    if (!right?.save) return false
    const err = await right.save(rightText)
    if (err) {
      setError(err)
      return false
    }
    setRightSaved(rightText)
    flash(`Saved ${names.right}.`)
    return true
  }

  const close = async (): Promise<void> => {
    if (wholeEdit && leftText !== props.leftText) props.onLeftChange(leftText, 'Compare: edited')
    if (rightDirty) {
      if (right?.save) {
        if (await props.confirm('Save the other document?', `${names.right} was changed here. Save it before closing?`)) {
          if (!(await saveRight())) return
        }
      } else if (!(await props.confirm('Close the comparison?', `The changes made here to ${names.right} cannot be saved back to it and will be lost.`))) {
        return
      }
    }
    props.onClose()
  }

  const leaveWholeEdit = (): void => {
    if (leftText !== props.leftText) props.onLeftChange(leftText, 'Compare: edited')
    setWholeEdit(false)
  }

  const explain = async (): Promise<void> => {
    if (!comparison) return
    if (!changes.length) {
      setAi({ busy: false, text: 'The two documents are the same.' })
      return
    }
    setAi({ busy: true })
    const diff = unifiedDiff(comparison, names, 2, 24_000)
    const r = await props.ask(AI_SYSTEM, `First document: ${names.left}\nSecond document: ${names.right}\n\n${diff}`)
    setAi(r.ok ? { busy: false, text: r.text ?? '' } : { busy: false, error: r.error ?? 'The AI request failed.' })
  }

  const exportAs = async (kind: 'html' | 'md'): Promise<void> => {
    if (!comparison) return
    const base = `Comparison - ${props.leftName.replace(/\.[^.]+$/, '')} vs ${names.right.replace(/\.[^.]+$/, '')}`
    await props.exportReport(
      `${base}.${kind}`,
      kind === 'html' ? htmlReport(comparison, names) : markdownReport(comparison, names),
      kind
    )
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !editing) {
        e.preventDefault()
        void close()
      } else if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault()
        goTo(current + 1)
      } else if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault()
        goTo(current - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* ------------------------------------------------------------- choose */

  if (!right) {
    return (
      <div className="modal-backdrop" data-mn-ignore onMouseDown={props.onClose}>
        <div className="modal compare-choose" onMouseDown={(e) => e.stopPropagation()}>
          <h3>Compare {props.leftName} with…</h3>
          {!sources && !error && <Loader label="Looking for documents…" />}
          {loading && <Loader label={`Opening ${loading}…`} />}
          {sources && !loading && (
            <div className="compare-sources">
              {sources.map((s) => (
                <button key={s.id} className="compare-source" onClick={() => void choose(s)}>
                  <span>{s.label}</span>
                  {s.detail && <span className="muted small">{s.detail}</span>}
                </button>
              ))}
            </div>
          )}
          {error && <p className="error-text">{error}</p>}
          <div className="modal-actions">
            <button onClick={props.onClose}>Cancel</button>
          </div>
        </div>
      </div>
    )
  }

  /* --------------------------------------------------------------- view */

  const stats = comparison!.stats
  const sideWords = (c: Change, side: Side): React.ReactNode =>
    c.words
      .filter((w) => w.op === 'same' || w.op === side)
      .map((w, i) => (w.op === 'same' ? <span key={i}>{w.text}</span> : <span key={i} className={side === 'left' ? 'cmp-del' : 'cmp-ins'}>{w.text}</span>))
  const inlineWords = (c: Change): React.ReactNode =>
    c.words.map((w, i) =>
      w.op === 'same' ? <span key={i}>{w.text}</span> : <span key={i} className={w.op === 'left' ? 'cmp-del' : 'cmp-ins'}>{w.text}</span>
    )

  const editor = (c: Change, side: Side): React.ReactNode =>
    editing && editing.index === c.index && editing.side === side ? (
      <div className="cmp-edit">
        <textarea
          autoFocus
          value={editing.draft}
          rows={Math.min(14, Math.max(2, editing.draft.split('\n').length + 1))}
          onChange={(e) => setEditing({ ...editing, draft: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              setEditing(null)
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveEdit()
          }}
        />
        <div className="cmp-edit-actions">
          <button className="primary" onClick={saveEdit}>Done</button>
          <button onClick={() => setEditing(null)}>Cancel</button>
        </div>
      </div>
    ) : null

  const editButton = (c: Change, side: Side): React.ReactNode => (
    <button
      className="cmp-mini"
      title={`Edit this on the ${side === 'left' ? props.leftName : names.right} side`}
      onClick={() => setEditing({ index: c.index, side, draft: (side === 'left' ? c.left : c.right).join('\n') })}
    >
      ✎
    </button>
  )

  const sameRows = (lines: string[], b: number, inline: boolean): React.ReactNode => {
    const long = lines.length > 8 && !expanded.has(b)
    const shown: Array<string | null> = long ? [...lines.slice(0, 3), null, ...lines.slice(-3)] : lines
    return shown.map((l, i) =>
      l === null ? (
        <div key={`g${i}`} className="cmp-gap" onClick={() => setExpanded(new Set(expanded).add(b))} role="button">
          ⋯ {lines.length - 6} unchanged lines (show)
        </div>
      ) : inline ? (
        <div key={i} className="cmp-line">{l || ' '}</div>
      ) : (
        <div key={i} className="cmp-row">
          <div className="cmp-cell">{l || ' '}</div>
          <div className="cmp-mid" />
          <div className="cmp-cell">{l || ' '}</div>
        </div>
      )
    )
  }

  return (
    <div className="compare-view" data-mn-ignore>
      <div className="cmp-bar">
        <div className="cmp-title">
          <b title={props.leftName}>{props.leftName}</b>
          <span className="muted">↔</span>
          <b title={names.right}>{names.right}</b>
          {rightDirty && <span className="muted small">(changed)</span>}
        </div>
        <div className="cmp-stats">
          {stats.changes === 0 ? (
            <span className="muted">Identical</span>
          ) : (
            <>
              <span className="removed-pill" title={`Words only in ${props.leftName}`}>−{stats.wordsLeftOnly}</span>
              <span className="added-pill" title={`Words only in ${names.right}`}>+{stats.wordsRightOnly}</span>
              <button className="cmp-mini" title="Previous change (Alt+Up)" onClick={() => goTo(current - 1)}>▲</button>
              <span className="small">Change {Math.min(current + 1, stats.changes)} of {stats.changes}</span>
              <button className="cmp-mini" title="Next change (Alt+Down)" onClick={() => goTo(current + 1)}>▼</button>
            </>
          )}
        </div>
        <div className="cmp-actions">
          <div className="segmented">
            <button className={view === 'side' ? 'on' : ''} onClick={() => setView('side')} disabled={wholeEdit}>Side by side</button>
            <button className={view === 'inline' ? 'on' : ''} onClick={() => setView('inline')} disabled={wholeEdit}>Inline</button>
          </div>
          <button className={wholeEdit ? 'on' : ''} onClick={() => (wholeEdit ? leaveWholeEdit() : setWholeEdit(true))} title="Edit either whole document">
            {wholeEdit ? 'Done editing' : '✎ Edit texts'}
          </button>
          <button onClick={() => void explain()} disabled={ai?.busy}>✨ Explain</button>
          <button onClick={() => void exportAs('html')} title="Save the comparison as a page">Export HTML</button>
          <button onClick={() => void exportAs('md')} title="Save the comparison as Markdown">Export MD</button>
          {right.save && (
            <button className={rightDirty ? 'primary' : ''} disabled={!rightDirty} onClick={() => void saveRight()}>
              {right.saveLabel ?? `Save ${names.right}`}
            </button>
          )}
          <button onClick={() => { setRight(null); setEditing(null); setWholeEdit(false) }} title="Compare with a different document">Change…</button>
          <button onClick={() => void close()}>Close</button>
        </div>
      </div>

      {(note || error) && <div className={error ? 'cmp-note error-text' : 'cmp-note'} onClick={() => setError(null)}>{error ?? note}</div>}

      <div className="cmp-main">
        <div className="cmp-body" ref={bodyRef}>
          {wholeEdit ? (
            <div className="cmp-whole">
              <label>
                <span>{props.leftName}</span>
                <textarea value={leftText} onChange={(e) => setLeftText(e.target.value)} spellCheck={false} />
              </label>
              <label>
                <span>{names.right}{!right.save && ' (view only: cannot be saved back)'}</span>
                <textarea value={rightText} onChange={(e) => setRightText(e.target.value)} spellCheck={false} />
              </label>
              <p className="muted small">{stats.changes} change(s) now. Choose “Done editing” to see them marked.</p>
            </div>
          ) : view === 'side' ? (
            <>
              <div className="cmp-row cmp-head">
                <div className="cmp-cell">{props.leftName} (this window)</div>
                <div className="cmp-mid" />
                <div className="cmp-cell">{names.right}</div>
              </div>
              {comparison!.blocks.map((block, b) =>
                block.kind === 'same' ? (
                  <div key={b}>{sameRows(block.lines, b, false)}</div>
                ) : (
                  <div key={b} className={`cmp-row cmp-change${block.index === current ? ' current' : ''}`} data-change={block.index} onClick={() => setCurrent(block.index)}>
                    <div className={`cmp-cell${block.left.length ? '' : ' empty'}`}>
                      {editor(block, 'left') ?? (
                        <>
                          {editButton(block, 'left')}
                          {block.left.length ? sideWords(block, 'left') : <span className="muted small">(nothing here)</span>}
                        </>
                      )}
                    </div>
                    <div className="cmp-mid">
                      <button className="cmp-mini" title={`Use this change in ${names.right}`} onClick={() => take(block, 'right')}>→</button>
                      <button className="cmp-mini" title={`Use this change in ${props.leftName}`} onClick={() => take(block, 'left')}>←</button>
                    </div>
                    <div className={`cmp-cell${block.right.length ? '' : ' empty'}`}>
                      {editor(block, 'right') ?? (
                        <>
                          {editButton(block, 'right')}
                          {block.right.length ? sideWords(block, 'right') : <span className="muted small">(nothing here)</span>}
                        </>
                      )}
                    </div>
                  </div>
                )
              )}
            </>
          ) : (
            <div className="cmp-inline">
              {comparison!.blocks.map((block, b) =>
                block.kind === 'same' ? (
                  <div key={b}>{sameRows(block.lines, b, true)}</div>
                ) : (
                  <div key={b} className={`cmp-change cmp-inline-change${block.index === current ? ' current' : ''}`} data-change={block.index} onClick={() => setCurrent(block.index)}>
                    <div className="cmp-inline-tools">
                      <button className="cmp-mini" title={`Keep ${props.leftName}'s version in ${names.right} too`} onClick={() => take(block, 'right')}>Keep left</button>
                      <button className="cmp-mini" title={`Use ${names.right}'s version in ${props.leftName}`} onClick={() => take(block, 'left')}>Use right</button>
                      {editButton(block, 'left')}
                    </div>
                    {editor(block, 'left') ?? <div className="cmp-line">{inlineWords(block)}</div>}
                  </div>
                )
              )}
            </div>
          )}
          {!wholeEdit && stats.changes > 1 && (
            <div className="cmp-footer">
              <button onClick={() => void takeAll('left')}>Make {props.leftName} match</button>
              <button onClick={() => void takeAll('right')}>Make {names.right} match</button>
            </div>
          )}
        </div>

        {ai && (
          <aside className="cmp-ai">
            <div className="cmp-ai-head">
              <b>AI explanation</b>
              <button className="cmp-mini" onClick={() => setAi(null)} title="Close">✕</button>
            </div>
            {ai.busy && <Loader label="Reading the differences…" />}
            {ai.error && <p className="error-text">{ai.error}</p>}
            {ai.text && <div className="markdown-body cmp-ai-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(ai.text) }} />}
            {ai.text && <p className="muted small">AI can be wrong: check against the marked changes.</p>}
          </aside>
        )}
      </div>
    </div>
  )
}
