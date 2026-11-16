import { useEffect, useMemo, useRef, useState } from 'react'
import type { MapNode, MapState } from '../lib/mindmap'
import {
  QA_SYSTEM,
  TAGS,
  answer,
  deck,
  highlightCards,
  parseQA,
  progressOf,
  qaPrompt,
  quizOrder,
  search,
  setQA,
  tagsInUse,
  toAnki,
  toCsv,
  toggleTag,
  type StudyCard
} from '../lib/study'

type Tab = 'cards' | 'quiz' | 'search' | 'export'

interface Props {
  /** The whole book, and the part being studied (a chapter's map, or the book). */
  tree: MapNode
  scope: MapNode
  source: string
  name: string
  state: MapState
  change: (fn: (s: MapState) => MapState) => void
  ai: {
    status: () => Promise<{ ready: boolean; detail: string }>
    ask: (system: string, user: string) => Promise<{ ok: boolean; text?: string; error?: string }>
  }
  saveText: (name: string, text: string, mime: string) => Promise<void>
  /** Shows a card: opens its chapter's map and its passage. */
  onOpen: (card: MapNode, chapterId: string) => void
  onClose: () => void
}

export default function StudyPanel(props: Props): React.JSX.Element {
  const { scope, state, change } = props
  const [tab, setTab] = useState<Tab>('quiz')
  const cards = useMemo(() => deck(scope, state), [scope, state])
  const prog = progressOf(cards)
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const job = useRef(0)
  useEffect(() => () => void job.current++, [])

  /* -------------------------------------------------- quiz */
  const [onlyTag, setOnlyTag] = useState('')
  const [queue, setQueue] = useState<string[]>([])
  const [shown, setShown] = useState(false)
  const [round, setRound] = useState({ asked: 0, known: 0 })
  const startQuiz = (): void => {
    setQueue(quizOrder(cards, onlyTag).map((c) => c.id))
    setShown(false)
    setRound({ asked: 0, known: 0 })
  }
  useEffect(startQuiz, [scope.id, onlyTag]) // eslint-disable-line react-hooks/exhaustive-deps
  const current = cards.find((c) => c.id === queue[0])
  const mark = (known: boolean): void => {
    if (!current) return
    change((s) => answer(s, current.id, known))
    setRound((r) => ({ asked: r.asked + 1, known: r.known + (known ? 1 : 0) }))
    // Not known: it comes back later in this round.
    setQueue((q) => (known ? q.slice(1) : [...q.slice(1, 4), q[0], ...q.slice(4)]))
    setShown(false)
  }
  useEffect(() => {
    if (tab !== 'quiz') return
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement)?.closest('input, textarea')) return
      if (e.key === ' ' && !shown) {
        e.preventDefault()
        setShown(true)
      } else if (shown && (e.key === '1' || e.key === 'ArrowLeft')) mark(false)
      else if (shown && (e.key === '2' || e.key === 'ArrowRight')) mark(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* -------------------------------------------------- cards */
  const [editing, setEditing] = useState<{ id: string; q: string; a: string } | null>(null)
  const [newTag, setNewTag] = useState('')

  const aiQA = async (): Promise<void> => {
    const id = ++job.current
    setNote('')
    setBusy('Checking the AI…')
    const s = await props.ai.status()
    if (job.current !== id) return
    if (!s.ready) {
      setBusy('')
      setNote(`No AI is connected (Ollama or an API key in the AI panel), so the questions stay as they are. ${s.detail}`)
      return
    }
    const todo = cards.filter((c) => !c.own)
    let made = 0
    let failed = false
    for (let i = 0; i < todo.length; i += 6) {
      setBusy(`Writing questions with AI: ${Math.min(i + 6, todo.length)} of ${todo.length}…`)
      const batch = todo.slice(i, i + 6)
      const r = await props.ai.ask(QA_SYSTEM, qaPrompt(batch))
      if (job.current !== id) return
      if (!r.ok) {
        setNote(`The AI stopped: ${r.error ?? 'no answer'}. ${made} question(s) made; the rest keep the simple ones.`)
        failed = true
        break
      }
      const got = parseQA(String(r.text ?? ''))
      const ids = Object.keys(got).filter((k) => batch.some((b) => b.id === k))
      if (ids.length) {
        made += ids.length
        change((st) => ids.reduce((acc, k) => setQA(acc, k, got[k]), st))
      }
    }
    if (job.current === id) {
      setBusy('')
      if (!failed) setNote(`${made} question(s) written by the AI. Edit any of them with ✎.`)
    }
  }

  const addHighlights = (): void => {
    const add = highlightCards(props.source, props.tree, state)
    if (!add.length) {
      setNote('No new highlights or comments to add. Highlight passages in View mode first (select text → a colour).')
      return
    }
    change((s) => ({ ...s, custom: [...s.custom, ...add] }))
    setNote(`${add.length} highlight(s) added as cards, each under the section it is in. They are marked with the keyword “highlight”.`)
  }

  /* -------------------------------------------------- search */
  const [query, setQuery] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const allCards = useMemo(() => deck(props.tree, state), [props.tree, state])
  const found = useMemo(() => {
    const base = query.trim() ? search(allCards, query) : tagFilter ? allCards : []
    return tagFilter ? base.filter((c) => c.tags.includes(tagFilter)) : base
  }, [allCards, query, tagFilter])
  const used = tagsInUse(state)

  /* -------------------------------------------------- export */
  const fileBase = props.name.replace(/\.[^.]+$/, '')
  const exportSet = (which: 'scope' | 'all'): StudyCard[] => (which === 'all' ? allCards : cards)
  const [exportWhich, setExportWhich] = useState<'scope' | 'all'>('all')

  const tagChips = (c: StudyCard): React.JSX.Element => (
    <span className="st-tags">
      {[...TAGS, ...used.filter((t) => !(TAGS as readonly string[]).includes(t))].map((t) => (
        <button key={t} className={`st-tag${c.tags.includes(t) ? ' on' : ''}`} onClick={() => change((s) => toggleTag(s, c.id, t))} title={c.tags.includes(t) ? `Remove “${t}”` : `Tag “${t}”`}>
          {t}
        </button>
      ))}
    </span>
  )

  return (
    <aside className="st-panel" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()} aria-label="Study">
      <div className="st-head">
        <strong>🎓 Study</strong>
        <span className="muted small" title={scope.title}>
          {scope.kind === 'doc' ? 'Whole book' : scope.title.length > 32 ? `${scope.title.slice(0, 30)}…` : scope.title} · {prog.known}/{prog.total} known
        </span>
        <button className="link" onClick={props.onClose} title="Close the study panel">
          ✕
        </button>
      </div>
      <div className="st-progress" title={`${prog.asked} of ${prog.total} asked, ${prog.known} known`}>
        <span style={{ width: `${(100 * prog.known) / Math.max(1, prog.total)}%` }} />
      </div>
      <div className="segmented st-tabs">
        {(['quiz', 'cards', 'search', 'export'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'quiz' ? 'Quiz' : t === 'cards' ? 'Q&A cards' : t === 'search' ? 'Tags & search' : 'Export'}
          </button>
        ))}
      </div>
      {busy && (
        <div className="st-busy" role="status">
          <span className="mm-spinner" aria-hidden="true" />
          <span>{busy}</span>
          <button className="link" onClick={() => (job.current++, setBusy(''))}>
            Stop
          </button>
        </div>
      )}
      {note && !busy && (
        <p className="st-note small">
          {note}{' '}
          <button className="link" onClick={() => setNote('')}>
            Dismiss
          </button>
        </p>
      )}

      {tab === 'quiz' && (
        <div className="st-body">
          {!cards.length ? (
            <p className="muted">No cards to study here yet.</p>
          ) : (
            <>
              <div className="st-row">
                <label className="small">
                  Only cards tagged{' '}
                  <select value={onlyTag} onChange={(e) => setOnlyTag(e.target.value)}>
                    <option value="">(all cards)</option>
                    {[...new Set([...TAGS, ...used])].map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="link small" onClick={startQuiz} title="Start again, with the cards you did not know first">
                  ↻ Restart
                </button>
              </div>
              {current ? (
                <div className="st-flash">
                  <div className="muted small">
                    {current.chapter} · {round.asked} asked this round, {round.known} known
                    {current.recall ? ` · last time: ${current.recall.known ? 'knew it' : 'not yet'}` : ' · new'}
                  </div>
                  <div className="st-q">{current.q}</div>
                  {shown ? (
                    <>
                      <div className="st-a">{current.a || <span className="muted">(no answer text: edit this card under Q&A cards)</span>}</div>
                      <div className="st-actions">
                        <button onClick={() => mark(false)} title="It comes back later in this round (1 or ←)">
                          🔁 Review again
                        </button>
                        <button className="primary" onClick={() => mark(true)} title="Mark as known (2 or →)">
                          ✓ I knew it
                        </button>
                      </div>
                      <button className="link small" onClick={() => props.onOpen(current.node, current.chapterId)}>
                        📄 Show this part of the map
                      </button>
                    </>
                  ) : (
                    <div className="st-actions">
                      <button className="primary" onClick={() => setShown(true)} title="Space">
                        Show answer
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="st-flash">
                  <div className="st-q">Round finished 🎉</div>
                  <p>
                    {round.known} of {round.asked} known this round. Overall: {prog.known} of {prog.total} cards known.
                  </p>
                  <button className="primary" onClick={startQuiz}>
                    Start another round
                  </button>
                </div>
              )}
              <p className="muted small">Space shows the answer; 1 or ← review again; 2 or → I knew it. Progress is saved with the mind map.</p>
            </>
          )}
        </div>
      )}

      {tab === 'cards' && (
        <div className="st-body">
          <div className="st-row">
            <button className="mm-ai" onClick={() => void aiQA()} disabled={!!busy} title="Have the AI write a real question and answer for each card in this part">
              ✨ AI questions
            </button>
            <button onClick={addHighlights} title="Turn your highlights and comments into cards on the map">
              🖍 Add my highlights as cards
            </button>
          </div>
          <p className="muted small">
            {cards.length} card(s) in {scope.kind === 'doc' ? 'the whole book' : 'this part'}. Simple questions come from each card's text; ✨ AI questions or ✎ make better ones.
          </p>
          <ul className="st-list">
            {cards.map((c) => (
              <li key={c.id}>
                {editing?.id === c.id ? (
                  <div className="st-edit">
                    <label className="small">
                      Question
                      <textarea value={editing.q} rows={2} onChange={(e) => setEditing({ ...editing, q: e.target.value })} />
                    </label>
                    <label className="small">
                      Answer
                      <textarea value={editing.a} rows={4} onChange={(e) => setEditing({ ...editing, a: e.target.value })} />
                    </label>
                    <div className="st-actions">
                      {c.own && (
                        <button className="link" onClick={() => (change((s) => setQA(s, c.id, null)), setEditing(null))}>
                          Use the simple question
                        </button>
                      )}
                      <button onClick={() => setEditing(null)}>Cancel</button>
                      <button className="primary" disabled={!editing.q.trim()} onClick={() => (change((s) => setQA(s, c.id, { q: editing.q.trim(), a: editing.a.trim() })), setEditing(null))}>
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="st-card-q">
                      <span>{c.q}</span>
                      <button className="link" onClick={() => setEditing({ id: c.id, q: c.q, a: c.a })} title="Edit the question and answer">
                        ✎
                      </button>
                    </div>
                    <div className="st-card-a muted small">{c.a.length > 220 ? `${c.a.slice(0, 218)}…` : c.a}</div>
                    {tagChips(c)}
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'search' && (
        <div className="st-body">
          <input type="search" placeholder="Search every card in the book…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          <div className="st-row st-wrap">
            <span className="small muted">Tags:</span>
            {[...new Set([...TAGS, ...used])].map((t) => (
              <button key={t} className={`st-tag${tagFilter === t ? ' on' : ''}`} onClick={() => setTagFilter(tagFilter === t ? '' : t)}>
                {t}
              </button>
            ))}
          </div>
          <div className="st-row">
            <input
              placeholder="New tag (e.g. exam, chapter quiz)"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newTag.trim() && found[0]) {
                  const t = newTag.trim()
                  change((s) => found.reduce((acc, c) => (c.tags.includes(t) ? acc : toggleTag(acc, c.id, t)), s))
                  setNewTag('')
                }
              }}
              title="Type a tag and press Enter to add it to every card found below"
            />
          </div>
          {query.trim() || tagFilter ? <p className="muted small">{found.length} card(s) found.</p> : <p className="muted small">Type to search titles, text, notes, questions and tags; or pick a tag.</p>}
          <ul className="st-list">
            {found.slice(0, 200).map((c) => (
              <li key={c.id}>
                <button className="st-found" onClick={() => props.onOpen(c.node, c.chapterId)} title="Show it on the map">
                  <strong>{c.title}</strong>
                  <span className="muted small">{c.chapter}</span>
                </button>
                {tagChips(c)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'export' && (
        <div className="st-body">
          <label className="small">
            Cards to export{' '}
            <select value={exportWhich} onChange={(e) => setExportWhich(e.target.value as 'scope' | 'all')}>
              <option value="all">The whole book ({allCards.length})</option>
              <option value="scope" disabled={scope.kind === 'doc'}>
                This part only ({cards.length})
              </option>
            </select>
          </label>
          <button onClick={() => void props.saveText(`${fileBase} - Anki.txt`, toAnki(exportSet(exportWhich), fileBase), 'text/plain')}>
            Anki flashcards (.txt)
          </button>
          <p className="muted small">In Anki: File → Import, choose this file. The deck, the columns (front, back) and the tags are set by the file itself.</p>
          <button onClick={() => void props.saveText(`${fileBase} - study cards.csv`, toCsv(exportSet(exportWhich)), 'text/csv')}>Spreadsheet (.csv)</button>
          <p className="muted small">Opens in Excel or Google Sheets: chapter, card, question, answer, tags and whether you knew it.</p>
        </div>
      )}
    </aside>
  )
}
