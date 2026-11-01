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
 * The first (left) document is the open one by default, or any file or
 * document the user picks instead, so two files can be compared without
 * opening either. Left-side edits to the open document go into it as undoable
 * steps; a picked first document is saved with its own button, like the right. Right-side
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
  /** A first document picked here instead of the open one; null = the open document. */
  const [leftFile, setLeftFile] = useState<LoadedSide | null>(null)
  const [leftSaved, setLeftSaved] = useState('')
  /**
   * How the user wants to compare: the open document with one more file
   * ('open'), or two files loaded here ('two'); null = not chosen yet. With
   * nothing in the open document there is only the second way.
   */
  const [mode, setMode] = useState<'open' | 'two' | null>(props.leftText.trim() ? null : 'two')
  const [pending, setPending] = useState<{ first: LoadedSide | null; second: LoadedSide | null }>({ first: null, second: null })
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
  const isOpenDoc = leftFile === null
  const leftName = leftFile ? leftFile.name : props.leftName
  useEffect(() => {
    if (isOpenDoc && !wholeEdit && !editing) setLeftText(props.leftText)
  }, [props.leftText, wholeEdit, editing, isOpenDoc])

  useEffect(() => {
    props.listSources().then(setSources, (e) => setError(String(e?.message ?? e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const comparison = useMemo(() => (right ? compareTexts(leftText, rightText) : null), [right, leftText, rightText])
  const changes = comparison?.changes ?? []
  const names = { left: leftName, right: right?.name ?? '' }
  const rightDirty = right !== null && rightText !== rightSaved
  const leftDirty = leftFile !== null && leftText !== leftSaved

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

  /** Two-files mode: loads one of the two slots; Compare starts once both are in. */
  const loadSlot = async (slot: 'first' | 'second', source: CompareSource): Promise<void> => {
    setError(null)
    setLoading(source.label)
    try {
      const loaded = await source.load()
      if (loaded) setPending((p) => ({ ...p, [slot]: { ...loaded, text: normaliseNewlines(loaded.text) } }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(null)
    }
  }

  const startTwo = (): void => {
    const { first, second } = pending
    if (!first || !second) return
    setLeftFile(first)
    setLeftText(first.text)
    setLeftSaved(first.text)
    setRight(second)
    setRightText(second.text)
    setRightSaved(second.text)
    setCurrent(0)
    setExpanded(new Set())
    setAi(null)
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
    if (isOpenDoc) props.onLeftChange(text, label)
  }

  const take = (c: Change, into: Side): void => {
    if (!comparison) return
    if (into === 'left') setLeft(takeChange(comparison, c.index, 'left', leftText), 'Compare: took a change')
    else setRightText(takeChange(comparison, c.index, 'right', rightText))
    flash(into === 'left' ? `Change ${c.index + 1} taken into ${leftName}.${isOpenDoc ? ' Ctrl+Z to undo.' : ''}` : `Change ${c.index + 1} taken into ${names.right}.`)
  }

  const takeAll = async (into: Side): Promise<void> => {
    const target = into === 'left' ? leftName : names.right
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

  const saveSide = async (side: Side): Promise<boolean> => {
    const target = side === 'left' ? leftFile : right
    const text = side === 'left' ? leftText : rightText
    if (!target?.save) return false
    const err = await target.save(text)
    if (err) {
      setError(err)
      return false
    }
    if (side === 'left') setLeftSaved(text)
    else setRightSaved(text)
    flash(`Saved ${target.name}.`)
    return true
  }

  /** Before leaving: offer to save a side changed here; false = stay. */
  const settle = async (side: Side): Promise<boolean> => {
    const target = side === 'left' ? leftFile : right
    if (!target || !(side === 'left' ? leftDirty : rightDirty)) return true
    if (target.save) {
      if (await props.confirm(`Save ${target.name}?`, `${target.name} was changed here. Save it before closing?`)) return saveSide(side)
      return true
    }
    return props.confirm('Close the comparison?', `The changes made here to ${target.name} cannot be saved back to it and will be lost.`)
  }

  const close = async (): Promise<void> => {
    if (isOpenDoc && wholeEdit && leftText !== props.leftText) props.onLeftChange(leftText, 'Compare: edited')
    if (!(await settle('left')) || !(await settle('right'))) return
    props.onClose()
  }

  /** Back to the start, after offering to save what was changed here. */
  const restart = async (): Promise<void> => {
    if (!(await settle('left')) || !(await settle('right'))) return
    setRight(null)
    setEditing(null)
    setWholeEdit(false)
    setLeftFile(null)
    setLeftText(props.leftText)
    setPending({ first: null, second: null })
    setMode(props.leftText.trim() ? null : 'two')
  }

  const leaveWholeEdit = (): void => {
    if (isOpenDoc && leftText !== props.leftText) props.onLeftChange(leftText, 'Compare: edited')
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
    const base = `Comparison - ${leftName.replace(/\.[^.]+$/, '')} vs ${names.right.replace(/\.[^.]+$/, '')}`
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
    const fileSource = sources?.find((x) => x.id === 'file')
    // Other places a document can come from: another window or tab, My
    // documents, and (beside the open document only) its saved version.
    const others = (sources ?? []).filter((x) => x.id !== 'file' && (mode === 'open' || x.id !== 'saved'))
    const slot = (label: string, loaded: LoadedSide | null, pick: (src: CompareSource) => void): React.ReactNode => (
      <div className="cmp-slot">
        <div className="cmp-slot-row">
          <button className="primary" disabled={!fileSource || !!loading} onClick={() => fileSource && pick(fileSource)}>
            {label}
          </button>
          <span className={loaded ? 'cmp-slot-name' : 'muted small'}>{loaded ? `✓ ${loaded.name}` : 'No file loaded yet'}</span>
        </div>
        {others.length > 0 && (
          <details className="cmp-others">
            <summary className="small">Or take it from an open window, tab or saved document</summary>
            {others.map((x) => (
              <button
                key={x.id}
                className="compare-source"
                disabled={!!loading}
                onClick={(e) => {
                  ;(e.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open')
                  pick(x)
                }}
              >
                <span>{x.label}</span>
                {x.detail && <span className="muted small">{x.detail}</span>}
              </button>
            ))}
          </details>
        )}
      </div>
    )
    const hasOpen = props.leftText.trim() !== ''
    return (
      <div className="modal-backdrop" data-mn-ignore onMouseDown={props.onClose}>
        <div className="modal compare-choose" onMouseDown={(e) => e.stopPropagation()}>
          <h3>Compare documents</h3>
          {!sources && !error && <Loader label="Getting ready…" />}

          {sources && mode === null && (
            <div className="cmp-modes">
              <button className="cmp-mode" onClick={() => setMode('open')}>
                <b>Compare the open document with another file</b>
                <span className="muted small">{props.leftName} is the 1st file; you load the 2nd.</span>
              </button>
              <button className="cmp-mode" onClick={() => setMode('two')}>
                <b>Load two new files to compare</b>
                <span className="muted small">You load the 1st and the 2nd file. The open document is not touched.</span>
              </button>
            </div>
          )}

          {sources && mode === 'open' && (
            <>
              <div className="cmp-slot">
                <div className="cmp-slot-row">
                  <span className="cmp-slot-label">1st file</span>
                  <span className="cmp-slot-name">✓ {props.leftName} <span className="muted small">(open document)</span></span>
                </div>
              </div>
              <div className="cmp-slot-label">2nd file</div>
              {slot('Load the 2nd file', null, (x) => void choose(x))}
            </>
          )}

          {sources && mode === 'two' && (
            <>
              <div className="cmp-slot-label">1st file</div>
              {slot('Load the 1st file', pending.first, (x) => void loadSlot('first', x))}
              <div className="cmp-slot-label">2nd file</div>
              {slot('Load the 2nd file', pending.second, (x) => void loadSlot('second', x))}
            </>
          )}

          {loading && <Loader label={`Opening ${loading}…`} />}
          {error && <p className="error-text">{error}</p>}
          <div className="modal-actions">
            {mode !== null && hasOpen && <button onClick={() => { setMode(null); setError(null) }}>← Back</button>}
            <button onClick={props.onClose}>Cancel</button>
            {mode === 'two' && (
              <button className="primary" disabled={!pending.first || !pending.second} onClick={startTwo}>
                Compare
              </button>
            )}
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
      title={`Edit this on the ${side === 'left' ? leftName : names.right} side`}
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
          <b title={leftName}>{leftName}</b>
          <span className="muted">↔</span>
          <b title={names.right}>{names.right}</b>
          {(leftDirty || rightDirty) && <span className="muted small">(changed here, not saved)</span>}
        </div>
        <div className="cmp-stats">
          {stats.changes === 0 ? (
            <span className="muted">Identical</span>
          ) : (
            <>
              <span className="removed-pill" title={`Words only in ${leftName}`}>−{stats.wordsLeftOnly}</span>
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
          {leftFile?.save && (
            <button className={leftDirty ? 'primary' : ''} disabled={!leftDirty} onClick={() => void saveSide('left')}>
              {leftFile.saveLabel ? `${leftFile.saveLabel} (left)` : `Save ${leftName}`}
            </button>
          )}
          {right.save && (
            <button className={rightDirty ? 'primary' : ''} disabled={!rightDirty} onClick={() => void saveSide('right')}>
              {(right.saveLabel ?? `Save ${names.right}`) + (leftFile?.save ? ' (right)' : '')}
            </button>
          )}
          <button onClick={() => void restart()} title="Start again with other files">Other files…</button>
          <button onClick={() => void close()}>Close</button>
        </div>
      </div>

      {(note || error) && <div className={error ? 'cmp-note error-text' : 'cmp-note'} onClick={() => setError(null)}>{error ?? note}</div>}

      <div className="cmp-main">
        <div className="cmp-body" ref={bodyRef}>
          {wholeEdit ? (
            <div className="cmp-whole">
              <label>
                <span>{leftName}</span>
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
                <div className="cmp-cell">{leftName}{isOpenDoc ? ' (open document)' : ''}</div>
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
                      <button className="cmp-mini" title={`Use this change in ${leftName}`} onClick={() => take(block, 'left')}>←</button>
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
                      <button className="cmp-mini" title={`Keep ${leftName}'s version in ${names.right} too`} onClick={() => take(block, 'right')}>Keep left</button>
                      <button className="cmp-mini" title={`Use ${names.right}'s version in ${leftName}`} onClick={() => take(block, 'left')}>Use right</button>
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
              <button onClick={() => void takeAll('left')}>Make {leftName} match</button>
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
