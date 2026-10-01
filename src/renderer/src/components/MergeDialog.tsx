/**
 * Merge files: several documents in, one Markdown document out.
 *
 * The user picks the files and their order, and chooses each time how they
 * are joined (see lib/merge.ts). Anything that is not already text is
 * converted first through the same converters as Convert to Markdown, with
 * pictures and scanned pages read offline: nothing leaves the machine
 * unless the user chooses Cloud in the Convert dialog itself.
 *
 * The result opens as a new, unsaved document. None of the source files is
 * changed, and the open document is replaced only after the usual "save
 * your changes?" check, which the caller performs.
 *
 * Platform-neutral: the caller supplies how files are picked and read, which
 * is the only part that differs between the Windows app and the browser.
 *
 * Kept identical to the copy in the Windows app. Change one, copy it across.
 */
import { useState } from 'react'
import { convertToMarkdown, extensionOf, needsTranscription } from '../lib/convert'
import { mergeDocuments, type MergeMode } from '../lib/merge'
import Loader from './Loader'

/** A file the platform can hand over: its name, and its bytes on demand. */
export interface MergeSource {
  name: string
  read: () => Promise<Uint8Array>
}

interface Item {
  key: string
  name: string
  /** Already Markdown in memory (the open document), or a file to read. */
  markdown?: string
  source?: MergeSource
  status: 'waiting' | 'working' | 'done' | 'error'
  error?: string
}

interface Props {
  /** The open document, offered as the first item when it has any text. */
  current: { name: string; markdown: string } | null
  pickFiles: () => Promise<MergeSource[]>
  onClose: () => void
  onMerged: (markdown: string, title: string) => void
}

/** Text that needs no converting: read it as it is, so "unchanged" means unchanged. */
const AS_IS = ['md', 'markdown', 'mdown', 'mkd', 'mdx', 'txt', 'text']

let counter = 0
const key = (): string => `m${++counter}`

export default function MergeDialog(props: Props): JSX.Element {
  const [items, setItems] = useState<Item[]>(() =>
    props.current && props.current.markdown.trim()
      ? [{ key: key(), name: props.current.name, markdown: props.current.markdown, status: 'waiting' }]
      : []
  )
  const [mode, setMode] = useState<MergeMode>('sections')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')

  const add = async (): Promise<void> => {
    const picked = await props.pickFiles()
    if (!picked.length) return
    setItems((list) => [...list, ...picked.map((s) => ({ key: key(), name: s.name, source: s, status: 'waiting' as const }))])
  }

  const move = (i: number, by: -1 | 1): void =>
    setItems((list) => {
      const j = i + by
      if (j < 0 || j >= list.length) return list
      const next = [...list]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const remove = (i: number): void => setItems((list) => list.filter((_, n) => n !== i))

  const merge = async (): Promise<void> => {
    if (items.length < 2 || busy) return
    setBusy(true)
    const working: Item[] = items.map((it) => ({ ...it, status: 'waiting', error: undefined }))
    const parts: Array<{ name: string; markdown: string }> = []

    for (let i = 0; i < working.length; i++) {
      const it = working[i]
      working[i] = { ...it, status: 'working' }
      setItems([...working])
      setProgress(`Reading ${it.name} (${i + 1} of ${working.length})…`)
      try {
        let text = it.markdown
        if (text === undefined) {
          const ext = extensionOf(it.name)
          if (needsTranscription(it.name)) throw new Error('Audio cannot be merged directly. Convert it to Markdown first.')
          const bytes = await it.source!.read()
          if (AS_IS.includes(ext)) {
            text = new TextDecoder('utf-8').decode(bytes)
          } else {
            const r = await convertToMarkdown(bytes, it.name, {
              ocrMode: 'offline',
              onProgress: (m) => setProgress(`${it.name} (${i + 1} of ${working.length}): ${m}`)
            })
            if (!r.ok) throw new Error(r.error ?? 'Could not be converted.')
            text = r.markdown
          }
        }
        parts.push({ name: it.name, markdown: text })
        working[i] = { ...it, markdown: text, status: 'done' }
      } catch (err) {
        working[i] = { ...it, status: 'error', error: String((err as Error)?.message ?? err) }
        setItems([...working])
        setBusy(false)
        setProgress('')
        return
      }
      setItems([...working])
    }

    const merged = mergeDocuments(parts, mode)
    const first = parts[0].name.replace(/\.[^.]+$/, '')
    setBusy(false)
    setProgress('')
    props.onMerged(merged, `${first} + ${parts.length - 1} more (merged)`)
  }

  const failed = items.find((i) => i.status === 'error')

  return (
    <div className="modal-backdrop" data-mn-ignore onMouseDown={busy ? undefined : props.onClose}>
      <div className="modal convert-modal merge-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Merge files</h3>
        <p className="small muted">
          Combine documents into one, in the order below. Your files are not changed: the result opens as a new
          document for you to save. Documents that are not Markdown are converted first, on this device.
        </p>

        <div className="convert-list merge-list">
          {items.length === 0 && <div className="small muted merge-empty">No files yet. Add at least two.</div>}
          {items.map((it, i) => (
            <div key={it.key} className={`convert-row ${it.status}`}>
              <span className="merge-order small muted">{i + 1}</span>
              <span className="badge">{it.source ? extensionOf(it.name) || 'file' : 'open'}</span>
              <span className="cv-name" title={it.name}>
                {it.name}
                {!it.source && <span className="muted"> (the open document)</span>}
              </span>
              <span className="grow" />
              <span className="cv-status small">
                {it.status === 'working' && 'reading…'}
                {it.status === 'error' && (
                  <span className="warn" title={it.error}>
                    failed
                  </span>
                )}
              </span>
              {!busy && (
                <>
                  <button className="link" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                    ↑
                  </button>
                  <button className="link" title="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                    ↓
                  </button>
                  <button className="link" title="Remove from the merge" onClick={() => remove(i)}>
                    ✕
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
        <button className="link merge-add" disabled={busy} onClick={() => void add()}>
          + Add files…
        </button>

        {failed && <p className="warn small">{failed.name}: {failed.error}</p>}

        <div className="ocr-panel">
          <div className="small">
            <strong>How should they be joined?</strong>
          </div>
          <label className="checkline">
            <input type="radio" name="merge-mode" checked={mode === 'sections'} onChange={() => setMode('sections')} />
            <span className="small">
              <strong>Each file becomes its own section</strong> (recommended). Each file gets one top-level heading,
              its own title or else its file name, and the headings inside it move down a level, so the result reads as
              one document with one clean outline.
            </span>
          </label>
          <label className="checkline">
            <input type="radio" name="merge-mode" checked={mode === 'concat'} onChange={() => setMode('concat')} />
            <span className="small">
              <strong>Join them unchanged</strong>. The files follow one another, separated by a horizontal line.
              Nothing inside them is altered.
            </span>
          </label>
        </div>

        {busy && progress && (
          <p className="muted small progress-line">
            <Loader size={22} inline />
            {progress}
          </p>
        )}

        <div className="modal-actions">
          <button onClick={props.onClose} disabled={busy}>
            Cancel
          </button>
          <button className="primary" disabled={items.length < 2 || busy} onClick={() => void merge()}>
            {busy ? 'Merging…' : items.length < 2 ? 'Merge' : `Merge ${items.length} files`}
          </button>
        </div>
      </div>
    </div>
  )
}
