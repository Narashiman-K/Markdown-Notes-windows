import { useEffect, useState } from 'react'
import { KEEP, deleteVersions, listVersions, versionText, type Version } from '../lib/versions'

interface Props {
  /** The document's history key (its path, or its id in the browser). */
  docKey: string | null
  fileName: string
  current: string
  onClose: () => void
  /** Opens the review of changes from the current text to this version. */
  onRestore: (text: string, when: string) => void
}

function when(at: number): string {
  const d = new Date(at)
  const today = new Date()
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === today.toDateString()) return `Today, ${time}`
  const y = new Date(today)
  y.setDate(today.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return `Yesterday, ${time}`
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })}, ${time}`
}

export default function VersionsDialog({ docKey, fileName, current, onClose, onRestore }: Props): React.JSX.Element {
  const [list, setList] = useState<Version[] | null>(null)
  const [pick, setPick] = useState<number | null>(null)
  const [text, setText] = useState<string>('')

  useEffect(() => {
    if (!docKey) return setList([])
    void listVersions(docKey).then((v) => {
      setList(v)
      setPick(v[0]?.id ?? null)
    })
  }, [docKey])

  useEffect(() => {
    if (pick === null) return setText('')
    void versionText(pick).then((t) => setText(t ?? ''))
  }, [pick])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const chosen = list?.find((v) => v.id === pick)
  const same = chosen && text === current
  const currentWords = (current.match(/\S+/g) ?? []).length

  return (
    <div className="modal-backdrop" data-mn-ignore onMouseDown={onClose}>
      <div className="modal versions-modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Version history">
        <h2>Version history · {fileName}</h2>
        {!docKey ? (
          <p className="muted">Save the document once and its versions start here.</p>
        ) : list === null ? (
          <p className="muted">Loading…</p>
        ) : list.length === 0 ? (
          <p className="muted">No versions yet. A version is kept each time you save.</p>
        ) : (
          <div className="versions-body">
            <ul className="versions-list">
              {list.map((v) => (
                <li key={v.id}>
                  <button className={v.id === pick ? 'active' : ''} onClick={() => setPick(v.id)}>
                    <span>{when(v.at)}</span>
                    <span className="muted small">
                      {v.words.toLocaleString()} words
                      {v.auto ? ' · autosave' : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="versions-preview">
              <div className="muted small versions-note">
                {chosen
                  ? same
                    ? 'Same as the document now.'
                    : `${(chosen.words - currentWords >= 0 ? '+' : '') + (chosen.words - currentWords).toLocaleString()} words compared with now`
                  : ''}
              </div>
              <pre>{text.length > 20000 ? text.slice(0, 20000) + '\n…' : text}</pre>
            </div>
          </div>
        )}
        <p className="muted small">
          The last {KEEP} saved versions of each document are kept on this computer only, never beside the file.
        </p>
        <div className="modal-actions">
          {list && list.length > 0 && (
            <button
              className="danger"
              onClick={() => {
                if (!docKey || !window.confirm('Delete every saved version of this document? The document itself stays.')) return
                void deleteVersions(docKey).then(() => {
                  setList([])
                  setPick(null)
                })
              }}
            >
              Delete history
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button onClick={onClose}>Close</button>
          <button className="primary" disabled={!chosen || !!same} onClick={() => chosen && onRestore(text, when(chosen.at))}>
            Compare and restore…
          </button>
        </div>
      </div>
    </div>
  )
}
