import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { convertToMarkdown, FORMAT_GROUPS, extensionOf, needsOcr, needsTranscription } from '../lib/convert'

interface QueueItem {
  input: string
  name: string
  ext: string
  isImage: boolean
  isAudio: boolean
  status: 'pending' | 'working' | 'done' | 'error' | 'skipped'
  output?: string
  error?: string
  detail?: string
}

interface Props {
  initialFiles?: string[]
  onClose: () => void
  onOpenFile: (path: string) => void
  onToast: (msg: string) => void
}

const GEMINI_HELP = {
  url: 'https://aistudio.google.com/apikey',
  steps: [
    'Open Google AI Studio and sign in with a Google account.',
    'Click “Create API key”, then pick or create a project.',
    'Copy the key and paste it below.'
  ]
}

const ASSEMBLY_HELP = {
  url: 'https://www.assemblyai.com/dashboard/signup',
  pricing: 'https://www.assemblyai.com/pricing',
  steps: [
    'Create an AssemblyAI account — no credit card is required to start.',
    'Open your dashboard home page.',
    'Copy the key shown under “Your API key” and paste it below.'
  ]
}

/** Shared key-entry panel, used for both Gemini and AssemblyAI. */
function KeyPanel({
  title,
  help,
  draft,
  onDraft,
  onCancel,
  onSave
}: {
  title: string
  help: { url: string; steps: string[] }
  draft: string
  onDraft: (v: string) => void
  onCancel: () => void
  onSave: () => void
}): React.JSX.Element {
  return (
    <div className="key-panel">
      <div className="small"><strong>{title}</strong></div>
      <ol className="muted small">
        {help.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <button className="link" onClick={() => window.open(help.url, '_blank')}>
        Open the sign-up page ↗
      </button>
      <input
        type="password"
        autoFocus
        value={draft}
        placeholder="Paste your API key"
        onChange={(e) => onDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onSave()}
      />
      <p className="small muted">Stored encrypted on this computer only, and sent only to that provider.</p>
      <div className="modal-actions">
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={!draft.trim()} onClick={onSave}>
          Save key
        </button>
      </div>
    </div>
  )
}

export default function ConvertDialog(props: Props): React.JSX.Element {
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [dir, setDir] = useState('')
  const [rememberDir, setRememberDir] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [finished, setFinished] = useState(false)
  const [openAfter, setOpenAfter] = useState<'ask' | 'always' | 'never'>('ask')
  const [ocrMode, setOcrMode] = useState<'cloud' | 'offline'>('cloud')
  const [geminiSaved, setGeminiSaved] = useState(false)
  const [assemblySaved, setAssemblySaved] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [showKeyPanel, setShowKeyPanel] = useState(false)
  const [keyTarget, setKeyTarget] = useState<'gemini' | 'assemblyai'>('gemini')
  const [audioAccepted, setAudioAccepted] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const seeded = useRef(false)

  const hasImages = useMemo(() => queue.some((q) => q.isImage), [queue])
  const hasAudio = useMemo(() => queue.some((q) => q.isAudio), [queue])
  const doneItems = useMemo(() => queue.filter((q) => q.status === 'done'), [queue])

  /* ------------------------------------------------------------- bootstrap */

  const refreshKey = useCallback(async () => {
    const state = await window.api.aiKeyState()
    setGeminiSaved(!!state?.gemini?.saved)
    setAssemblySaved(!!state?.assemblyai?.saved)
  }, [])

  useEffect(() => {
    window.api.getSettings().then((s) => setOpenAfter(s?.convertOpenAfter ?? 'ask'))
    window.api.convertSuggestDir({}).then(setDir)
    void refreshKey()
    // Transcription can take minutes; surface its progress as it arrives.
    return window.api.onTranscribeProgress(({ message }) => setProgress(message))
  }, [refreshKey])

  const addFiles = useCallback(
    async (paths: string[]) => {
      const clean = paths.filter(Boolean)
      if (!clean.length) return
      const items: QueueItem[] = []
      for (const input of clean) {
        const name = await window.api.basename(input)
        const ext = extensionOf(name)
        items.push({
          input,
          name,
          ext,
          isImage: needsOcr(name),
          isAudio: needsTranscription(name),
          status: 'pending'
        })
      }
      setQueue((q) => [...q, ...items.filter((i) => !q.some((e) => e.input === i.input))])
      setFinished(false)
      if (!dir) window.api.convertSuggestDir({ input: clean[0] }).then(setDir)
    },
    [dir]
  )

  useEffect(() => {
    if (seeded.current) return
    seeded.current = true
    if (props.initialFiles?.length) void addFiles(props.initialFiles)
  }, [props.initialFiles, addFiles])

  /* ------------------------------------------------------------ interaction */

  const browse = async (): Promise<void> => {
    const r = await window.api.convertPickInput()
    if (r.ok && r.filePaths) await addFiles(r.filePaths)
  }

  const changeFolder = async (): Promise<void> => {
    const r = await window.api.convertPickFolder()
    if (r.ok && r.dir) {
      setDir(r.dir)
      if (rememberDir) await window.api.setSettings({ convertDir: r.dir })
    }
  }

  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDragging(false)
    await addFiles(Array.from(e.dataTransfer.files).map((f) => window.api.pathForFile(f)))
  }

  const saveKey = async (): Promise<void> => {
    if (!keyDraft.trim()) return
    await window.api.aiSetKey({ provider: keyTarget, key: keyDraft.trim() })
    setKeyDraft('')
    setShowKeyPanel(false)
    await refreshKey()
    props.onToast(
      `${keyTarget === 'gemini' ? 'Gemini' : 'AssemblyAI'} key saved and encrypted on this computer.`
    )
  }

  const openKeyPanel = (target: 'gemini' | 'assemblyai'): void => {
    setKeyTarget(target)
    setKeyDraft('')
    setShowKeyPanel(true)
  }

  /* -------------------------------------------------------------- converting */

  const convertAll = async (): Promise<void> => {
    if (!queue.length || busy) return

    // Cloud OCR without a key cannot work; ask before starting rather than
    // failing halfway through the queue.
    if (hasImages && ocrMode === 'cloud' && !geminiSaved) {
      openKeyPanel('gemini')
      props.onToast('Add a Gemini key, or switch to offline OCR.')
      return
    }
    if (hasAudio && !assemblySaved) {
      openKeyPanel('assemblyai')
      props.onToast('Audio needs an AssemblyAI key — it is the one format that cannot run offline.')
      return
    }
    if (hasAudio && !audioAccepted) {
      props.onToast('Tick the box to confirm you understand audio is sent to AssemblyAI.')
      return
    }
    if (rememberDir && dir) await window.api.setSettings({ convertDir: dir })

    setBusy(true)
    const working = [...queue]

    for (let i = 0; i < working.length; i++) {
      const item = working[i]
      if (item.status === 'done') continue

      working[i] = { ...item, status: 'working' }
      setQueue([...working])
      setProgress(`Reading ${item.name}…`)

      const read = await window.api.readBytes(item.input)
      if (!read.ok || !read.bytes) {
        working[i] = { ...item, status: 'error', error: read.error ?? 'Could not read the file.' }
        setQueue([...working])
        continue
      }

      const job = `job-${Date.now()}-${i}`
      if (item.isAudio) setJobId(job)

      const result = await convertToMarkdown(new Uint8Array(read.bytes), item.name, {
        ocrMode,
        onProgress: (message) => setProgress(`${item.name}: ${message}`),
        cloudOcr: async (bytes, mimeType) => {
          const r = await window.api.cloudOcr({ bytes, mimeType })
          if (!r.ok) throw new Error(r.error ?? 'Cloud OCR failed.')
          return r.text ?? ''
        },
        transcribe: async (bytes) => {
          const r = await window.api.transcribeAudio({ bytes, jobId: job })
          if (!r.ok) throw new Error(r.error ?? 'Transcription failed.')
          return r.text ?? ''
        }
      })
      setJobId(null)

      if (!result.ok) {
        working[i] = { ...item, status: 'error', error: result.error }
        setQueue([...working])
        continue
      }

      const output = `${dir.replace(/[\\/]+$/, '')}\\${item.name.replace(/\.[^.]+$/, '')}.md`
      setProgress(`Saving ${item.name}…`)
      const written = await window.api.writeText({ filePath: output, text: result.markdown })

      working[i] = written.ok
        ? {
            ...item,
            status: 'done',
            output,
            detail: Object.entries(result.meta ?? {})
              .map(([k, v]) => `${k}: ${v}`)
              .join(', ')
          }
        : { ...item, status: 'error', error: written.error ?? 'Could not save the file.' }
      setQueue([...working])
    }

    setBusy(false)
    setProgress('')
    setFinished(true)

    const done = working.filter((w) => w.status === 'done')
    if (done.length === 1 && openAfter === 'always' && done[0].output) props.onOpenFile(done[0].output)
  }

  const canConvert = queue.some((q) => q.status === 'pending' || q.status === 'error') && !!dir

  /* ----------------------------------------------------------------- render */

  return (
    <div className="modal-backdrop" data-mn-ignore onMouseDown={busy ? undefined : props.onClose}>
      <div className="modal convert-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Convert to Markdown</h3>

        <div className="status-strip good">
          <span className="dot-status" />
          <span>Runs entirely on this computer — no Python, no setup</span>
        </div>

        {/* Drop zone */}
        <div
          className={`dropzone ${dragging ? 'over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={browse}
          role="button"
          tabIndex={0}
        >
          <div className="dz-icon">⤓</div>
          <div>
            <strong>Drop files here</strong> or click to browse
          </div>
          <div className="muted small dz-formats">
            <span>Documents: {FORMAT_GROUPS.documents.join(', ')}</span>
            <span>Text &amp; data: {FORMAT_GROUPS.text.slice(0, 14).join(', ')}…</span>
            <span>Images: {FORMAT_GROUPS.images.join(', ')}</span>
            <span>Audio (cloud only): {FORMAT_GROUPS.audio.join(', ')}</span>
          </div>
        </div>

        {/* OCR choice, shown only when it is relevant */}
        {hasImages && (
          <div className="ocr-panel">
            <div className="small"><strong>Images detected — how should text be read from them?</strong></div>
            <label className="checkline">
              <input
                type="radio"
                name="ocr"
                checked={ocrMode === 'cloud'}
                onChange={() => setOcrMode('cloud')}
              />
              <span className="small">
                <strong>Cloud (Google Gemini)</strong> — more accurate, and describes charts and diagrams.
                Sends the image to Google. {geminiSaved ? <span className="ok-text">Key saved.</span> : <span className="warn">Needs your API key.</span>}
              </span>
            </label>
            <label className="checkline">
              <input
                type="radio"
                name="ocr"
                checked={ocrMode === 'offline'}
                onChange={() => setOcrMode('offline')}
              />
              <span className="small">
                <strong>Offline (on this PC)</strong> — no key, nothing leaves your computer. Good on clear
                printed text, weaker on anything else, and cannot describe images.
              </span>
            </label>

            {ocrMode === 'cloud' && !geminiSaved && !showKeyPanel && (
              <button className="link" onClick={() => setShowKeyPanel(true)}>
                Add a Gemini API key
              </button>
            )}

            {showKeyPanel && keyTarget === 'gemini' && (
              <KeyPanel
                title="Google Gemini API key"
                help={GEMINI_HELP}
                draft={keyDraft}
                onDraft={setKeyDraft}
                onCancel={() => setShowKeyPanel(false)}
                onSave={saveKey}
              />
            )}
          </div>
        )}

        {/* Audio: the one format with no offline option */}
        {hasAudio && (
          <div className="ocr-panel audio-panel">
            <div className="small">
              <strong className="cloud-flag">⚠ Audio transcription is a CLOUD SERVICE ONLY.</strong>
            </div>
            <p className="small muted">
              Every other format in this app is converted entirely on your computer. Audio is the
              exception: usable speech recognition needs either a cloud service or a multi-gigabyte
              local model. Your audio file is <strong>uploaded to AssemblyAI</strong> for processing.
            </p>
            <p className="small muted">
              AssemblyAI offers a <strong>free tier</strong> with no credit card required. The exact
              allowance changes from time to time, so check their pricing page for the current
              figures before transcribing anything long.
            </p>
            <p className="small muted">
              <strong>Limitations:</strong> needs an internet connection; long files take several
              minutes; accuracy drops with background noise, heavy accents or overlapping speakers;
              speaker names are not identified.
            </p>
            <button className="link" onClick={() => window.open(ASSEMBLY_HELP.pricing, '_blank')}>
              See AssemblyAI's current pricing and free tier ↗
            </button>

            <div className="ai-field-row">
              <span className="small">
                AssemblyAI key:{' '}
                {assemblySaved ? <strong className="ok-text">saved</strong> : <span className="warn">not set</span>}
              </span>
              {!assemblySaved && !showKeyPanel && (
                <button className="link" onClick={() => openKeyPanel('assemblyai')}>
                  Add key
                </button>
              )}
            </div>

            {showKeyPanel && keyTarget === 'assemblyai' && (
              <KeyPanel
                title="AssemblyAI API key"
                help={ASSEMBLY_HELP}
                draft={keyDraft}
                onDraft={setKeyDraft}
                onCancel={() => setShowKeyPanel(false)}
                onSave={saveKey}
              />
            )}

            <label className="checkline">
              <input
                type="checkbox"
                checked={audioAccepted}
                onChange={(e) => setAudioAccepted(e.target.checked)}
              />
              <span className="small">
                I understand my audio will be uploaded to AssemblyAI for transcription.
              </span>
            </label>
          </div>
        )}

        {/* Queue */}
        {queue.length > 0 && (
          <div className="convert-list">
            {queue.map((q) => (
              <div key={q.input} className={`convert-row ${q.status}`}>
                <span className="badge">{q.ext}</span>
                <span className="cv-name" title={q.input}>
                  {q.name}
                </span>
                <span className="grow" />
                <span className="cv-status small">
                  {q.status === 'working' && 'converting…'}
                  {q.status === 'done' && <span title={q.detail}>done</span>}
                  {q.status === 'error' && (
                    <span className="warn" title={q.error}>
                      failed
                    </span>
                  )}
                </span>
                {!busy && (
                  <button className="link" onClick={() => setQueue((l) => l.filter((x) => x.input !== q.input))}>
                    ✕
                  </button>
                )}
              </div>
            ))}
            {queue.some((q) => q.status === 'error') && (
              <p className="warn small">{queue.find((q) => q.status === 'error')?.error}</p>
            )}
          </div>
        )}

        {busy && progress && (
          <p className="muted small progress-line">
            {progress}
            {jobId && (
              <button
                className="link danger"
                onClick={() => {
                  void window.api.cancelTranscription(jobId)
                  props.onToast('Cancelling transcription…')
                }}
              >
                Cancel
              </button>
            )}
          </p>
        )}

        {/* Destination */}
        <div className="dest-row">
          <span className="muted small">Save to</span>
          <span className="dest-path" title={dir}>
            {dir || '(choose a folder)'}
          </span>
          <button className="link" onClick={changeFolder}>
            Change…
          </button>
        </div>
        <label className="checkline">
          <input type="checkbox" checked={rememberDir} onChange={(e) => setRememberDir(e.target.checked)} />
          <span className="small">Use this folder as the default for converted files</span>
        </label>

        {/* Results */}
        {finished && doneItems.length > 0 && (
          <div className="result-panel">
            <p>
              Converted {doneItems.length} file{doneItems.length > 1 ? 's' : ''}.
            </p>
            <div className="modal-actions">
              <button onClick={() => setFinished(false)}>Not now</button>
              <button
                className="primary"
                onClick={() => {
                  const target = doneItems[doneItems.length - 1].output
                  if (target) props.onOpenFile(target)
                }}
              >
                Open {doneItems.length > 1 ? 'the last one' : 'it'}
              </button>
            </div>
            <label className="checkline">
              <input
                type="checkbox"
                checked={openAfter === 'always'}
                onChange={(e) => {
                  const v = e.target.checked ? 'always' : 'ask'
                  setOpenAfter(v)
                  void window.api.setSettings({ convertOpenAfter: v })
                }}
              />
              <span className="small">Always open converted files automatically</span>
            </label>
          </div>
        )}

        <div className="modal-actions">
          <button onClick={props.onClose} disabled={busy}>
            Close
          </button>
          <button className="primary" disabled={!canConvert || busy} onClick={convertAll}>
            {busy ? 'Converting…' : `Convert ${queue.length || ''}`.trim()}
          </button>
        </div>
      </div>
    </div>
  )
}
