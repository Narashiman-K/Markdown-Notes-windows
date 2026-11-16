import { useEffect, useRef, useState } from 'react'
import {
  Cancelled,
  crawlSite,
  distilBook,
  projectGuide,
  removeDuplicates,
  siteDocument,
  siteOverview,
  type Ask,
  type FetchPage,
  type ProjectFile
} from '../lib/aiTools'
import { htmlToMarkdown } from '../lib/convert/html'

export type AiTool = 'distil' | 'dedupe' | 'site' | 'project'

interface Props {
  tool: AiTool
  source: string
  fileName: string
  ai: { status: () => Promise<{ ready: boolean; detail: string }>; ask: Ask }
  /** Reads one web page (the Windows app reads any site; a browser only sites that allow it). */
  fetchPage: FetchPage
  /** Lets the reader choose a project folder and reads its text files. */
  pickProject: () => Promise<{ name: string; files: ProjectFile[]; skipped: number } | null>
  /** Desktop app: reads any website. Browser: only sites that allow it. */
  anySite: boolean
  onOpenNew: (text: string, name: string) => void
  onReview: (text: string, label: string) => void
  onClose: () => void
}

const INFO: Record<AiTool, { title: string; about: string; start: string }> = {
  distil: {
    title: 'Distil this book',
    about: 'For each chapter: the key points, one or two quotes in the book’s own words, and how to apply it. Opens as a new document; this one is not changed.',
    start: 'Distil'
  },
  dedupe: {
    title: 'Remove repeated content',
    about: 'Finds paragraphs that say the same thing twice, often after merging files. Exact repeats are removed; paragraphs that overlap but each add something are combined by the AI. You review every change before it is applied.',
    start: 'Find repeats'
  },
  site: {
    title: 'Website to documentation',
    about: 'Reads a website, from the address you give, through the pages it links to on the same site (up to 100), and makes one document with a contents list, each page a chapter. With an AI, an overview goes at the top.',
    start: 'Read the site'
  },
  project: {
    title: 'Project folder to documentation',
    about: 'Reads the code and text files in a folder (skipping node_modules, .git, builds and other generated files) and writes a project guide: overview, how it is organised, getting started, key parts, and a note on each file.',
    start: 'Write the guide'
  }
}

export default function AiToolsDialog(props: Props): React.JSX.Element {
  const { tool, source, fileName, ai } = props
  const info = INFO[tool]
  const [aiState, setAiState] = useState<{ ready: boolean; detail: string } | null>(null)
  const [url, setUrl] = useState('https://')
  const [project, setProject] = useState<{ name: string; files: ProjectFile[]; skipped: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [prog, setProg] = useState<{ done: number; total: number; note: string } | null>(null)
  const [error, setError] = useState('')
  const stop = useRef<AbortController | null>(null)

  useEffect(() => {
    void ai.status().then(setAiState, () => setAiState({ ready: false, detail: 'No AI is set up.' }))
  }, [ai])

  useEffect(() => () => stop.current?.abort(), [])

  const needsAi = tool !== 'dedupe' && tool !== 'site'
  const canStart =
    !busy &&
    (!needsAi || aiState?.ready === true) &&
    (tool !== 'site' || props.anySite) &&
    (tool !== 'site' || /^https?:\/\/[^/\s]+\.[^\s]+$/i.test(url.trim())) &&
    (tool !== 'project' || !!project?.files.length)

  async function run(): Promise<void> {
    setBusy(true)
    setError('')
    setProg({ done: 0, total: 1, note: 'Starting…' })
    const ctl = new AbortController()
    stop.current = ctl
    const progress = (done: number, total: number, note: string): void => setProg({ done, total, note })
    const ask = aiState?.ready ? ai.ask : null
    try {
      if (tool === 'distil') {
        const out = await distilBook(source, fileName, ai.ask, progress, ctl.signal)
        props.onOpenNew(out, `${fileName.replace(/\.[^.]+$/, '')} - distilled.md`)
      } else if (tool === 'dedupe') {
        const r = await removeDuplicates(source, ask, progress, ctl.signal)
        if (!r.removed && !r.merged) {
          setError('No repeated paragraphs found.')
          setBusy(false)
          return
        }
        const parts = [r.removed ? `${r.removed} removed` : '', r.merged ? `${r.merged} combined` : ''].filter(Boolean).join(', ')
        props.onReview(r.text, `Repeat removal (${parts})`)
      } else if (tool === 'site') {
        const start = url.trim()
        const pages = await crawlSite(start, props.fetchPage, (h) => htmlToMarkdown(h), progress, ctl.signal)
        if (!pages.length) throw new Error('No readable pages were found at that address.')
        let overview = ''
        if (ask) {
          setProg({ done: pages.length, total: pages.length, note: 'Writing the overview' })
          overview = await siteOverview(pages, ask, ctl.signal).catch((e: Error) => {
            if (e instanceof Cancelled) throw e
            return ''
          })
        }
        props.onOpenNew(siteDocument(start, pages, overview), `${new URL(start).host} - documentation.md`)
      } else if (project) {
        const out = await projectGuide(project.name, project.files, ai.ask, progress, ctl.signal)
        props.onOpenNew(out, `${project.name} - project guide.md`)
      }
      setBusy(false)
    } catch (e) {
      setBusy(false)
      if (e instanceof Cancelled) {
        setProg(null)
        return
      }
      const msg = (e as Error).message || String(e)
      setError(
        tool === 'site' && !props.anySite && /fetch|network|cors|failed/i.test(msg)
          ? 'This site does not allow other websites to read it, so the web app cannot. The Windows app can read any site.'
          : msg
      )
    }
  }

  const pct = prog ? Math.round((100 * prog.done) / Math.max(1, prog.total)) : 0

  return (
    <div className="modal-backdrop" data-mn-ignore onMouseDown={busy ? undefined : props.onClose}>
      <div className="modal aitools-modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={info.title}>
        <h2>✨ {info.title}</h2>
        <p className="muted">{info.about}</p>

        {tool === 'site' && (
          <label className="aitools-field">
            Website address
            <input
              type="url"
              value={url}
              disabled={busy}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && canStart && void run()}
              placeholder="https://docs.example.com/guide/"
              autoFocus
            />
            <span className="muted small">
              Pages under the same folder as this address are read. Be fair to small sites: the app waits between pages and
              obeys robots.txt.
              {!props.anySite && (
                <strong> Browsers do not let a web page read other websites, so this needs the Windows app.</strong>
              )}
            </span>
          </label>
        )}

        {tool === 'project' && (
          <div className="aitools-field">
            <button
              disabled={busy}
              onClick={async () => {
                setError('')
                try {
                  const p = await props.pickProject()
                  if (p) setProject(p)
                } catch (e) {
                  setError((e as Error).message)
                }
              }}
            >
              {project ? 'Choose another folder…' : 'Choose the project folder…'}
            </button>
            {project && (
              <span className="muted small">
                {project.name}: {project.files.length} text file{project.files.length === 1 ? '' : 's'} to read
                {project.skipped ? `, ${project.skipped} skipped (too large, too many, or not text)` : ''}.
              </span>
            )}
          </div>
        )}

        <p className={`small ${aiState?.ready ? 'muted' : 'aitools-warn'}`}>
          {aiState === null
            ? 'Checking the AI…'
            : aiState.ready
              ? `AI: ${aiState.detail}`
              : needsAi
                ? `This needs an AI: set one up in the AI panel (Ollama on this computer, or a free API key). ${aiState.detail}`
                : tool === 'dedupe'
                  ? 'No AI set up: exact repeats will still be removed; overlapping paragraphs need an AI to combine.'
                  : 'No AI set up: the pages are still collected, without an overview.'}
        </p>

        {prog && (
          <div className="aitools-progress">
            <div className="aitools-bar">
              <span style={{ width: `${pct}%` }} />
            </div>
            <span className="muted small">
              {prog.total > 1 ? `${prog.done} of ${prog.total} · ` : ''}
              {prog.note}
            </span>
          </div>
        )}
        {error && <p className="aitools-warn small">{error}</p>}

        <div className="modal-actions">
          {busy ? (
            <button onClick={() => stop.current?.abort()}>Stop</button>
          ) : (
            <button onClick={props.onClose}>Close</button>
          )}
          <button className="primary" disabled={!canStart} onClick={() => void run()}>
            {busy ? 'Working…' : info.start}
          </button>
        </div>
      </div>
    </div>
  )
}
