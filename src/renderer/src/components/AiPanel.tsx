import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildContext, extractCitations, type Chunk, type SourceDoc } from '../lib/retrieval'
import { systemPrompt, parseAnnotations, parseRevision, QUICK_ACTIONS, type AiMode } from '../lib/aiPrompts'
import { renderMarkdown } from '../lib/markdown'

type ProviderId = 'ollama' | 'anthropic' | 'openai' | 'gemini'

interface Turn {
  role: 'user' | 'assistant'
  content: string
  citations?: number[]
  chunks?: Chunk[]
  mode?: AiMode
  error?: boolean
}

interface KeyState {
  encryption: boolean
  anthropic: { saved: boolean; hint: string }
  openai: { saved: boolean; hint: string }
  gemini: { saved: boolean; hint: string }
}

export interface AiPanelProps {
  docName: string
  docContent: string
  extraDocs: SourceDoc[]
  selection: string
  onClose: () => void
  onAddDocuments: () => void
  onRemoveDocument: (id: string) => void
  onJumpToChunk: (chunk: Chunk) => void
  onApplyRevision: (nextDocument: string, label: string) => void
  onApplyAnnotations: (items: Array<{ quote: string; type: string; color?: string; note?: string }>) => void
  onToast: (msg: string) => void
}

const PROVIDERS: Array<{ id: ProviderId; label: string; blurb: string }> = [
  { id: 'ollama', label: 'Ollama (on this PC)', blurb: 'Runs locally. Nothing leaves your computer.' },
  { id: 'anthropic', label: 'Claude (Anthropic)', blurb: 'Needs an Anthropic API key.' },
  { id: 'openai', label: 'ChatGPT (OpenAI)', blurb: 'Needs an OpenAI API key.' },
  { id: 'gemini', label: 'Gemini (Google)', blurb: 'Needs a Google AI Studio key.' }
]

const KEY_HELP: Record<string, { label: string; url: string; steps: string[] }> = {
  anthropic: {
    label: 'Anthropic',
    url: 'https://console.anthropic.com/settings/keys',
    steps: ['Sign in to the Anthropic Console.', 'Open Settings → API keys → Create key.', 'Copy it and paste it below.']
  },
  openai: {
    label: 'OpenAI',
    url: 'https://platform.openai.com/api-keys',
    steps: ['Sign in to the OpenAI platform.', 'Open API keys → Create new secret key.', 'Copy it and paste it below.']
  },
  gemini: {
    label: 'Google Gemini',
    url: 'https://aistudio.google.com/apikey',
    steps: ['Open Google AI Studio and sign in.', 'Click Create API key.', 'Copy it and paste it below.']
  }
}

export default function AiPanel(props: AiPanelProps): React.JSX.Element {
  const [provider, setProvider] = useState<ProviderId>('ollama')
  const [model, setModel] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [status, setStatus] = useState<{ ready: boolean; detail: string }>({ ready: false, detail: 'Checking…' })
  const [keyState, setKeyState] = useState<KeyState | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [keyTarget, setKeyTarget] = useState<'anthropic' | 'openai' | 'gemini'>('anthropic')
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const docs: SourceDoc[] = useMemo(
    () => [{ id: 'current', name: props.docName, content: props.docContent }, ...props.extraDocs],
    [props.docName, props.docContent, props.extraDocs]
  )

  /* ------------------------------------------------------------- provider */

  const refreshStatus = useCallback(async (p: ProviderId) => {
    setStatus({ ready: false, detail: 'Checking…' })
    const s = await window.api.aiStatus(p)
    setStatus(s)
    if (s.ready) {
      const m = await window.api.aiModels(p)
      const list: string[] = m.models ?? []
      setModels(list)
      setModel((current) => (current && list.includes(current) ? current : list[0] ?? ''))
      if (!m.ok && m.error) setStatus({ ready: false, detail: m.error })
    } else {
      setModels([])
    }
  }, [])

  useEffect(() => {
    window.api.getSettings().then((s) => {
      const p = (s?.aiProvider ?? 'ollama') as ProviderId
      setProvider(p)
      if (s?.aiModel) setModel(s.aiModel)
      void refreshStatus(p)
    })
    window.api.aiKeyState().then(setKeyState)
  }, [refreshStatus])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, busy])

  const changeProvider = async (p: ProviderId): Promise<void> => {
    setProvider(p)
    await window.api.setSettings({ aiProvider: p })
    await refreshStatus(p)
  }

  const changeModel = async (m: string): Promise<void> => {
    setModel(m)
    await window.api.setSettings({ aiModel: m })
  }

  const saveKey = async (): Promise<void> => {
    if (!keyDraft.trim()) return
    await window.api.aiSetKey({ provider: keyTarget, key: keyDraft.trim() })
    setKeyDraft('')
    setKeyState(await window.api.aiKeyState())
    props.onToast(`${KEY_HELP[keyTarget].label} key saved and encrypted on this computer.`)
    if (provider === keyTarget) await refreshStatus(provider)
  }

  const clearKey = async (target: 'anthropic' | 'openai' | 'gemini'): Promise<void> => {
    await window.api.aiSetKey({ provider: target, key: '' })
    setKeyState(await window.api.aiKeyState())
    if (provider === target) await refreshStatus(provider)
  }

  /* ------------------------------------------------------------------ ask */

  const send = async (mode: AiMode, question: string): Promise<void> => {
    if (busy || !question.trim()) return
    if (!status.ready) {
      props.onToast(status.detail)
      setShowSettings(true)
      return
    }
    if (!model) {
      props.onToast('Choose a model first.')
      return
    }

    const userTurn: Turn = { role: 'user', content: question }
    setTurns((t) => [...t, userTurn])
    setInput('')
    setBusy(true)

    const retrievalQuery = mode === 'explain' && props.selection ? props.selection : question
    const { chunks, truncated } = buildContext(docs, retrievalQuery)

    const history = turns
      .filter((t) => !t.error)
      .slice(-6)
      .map((t) => ({ role: t.role, content: t.content }))

    const userContent =
      mode === 'explain' && props.selection
        ? `The user selected this passage:\n\n"""${props.selection}"""\n\n${question}`
        : question

    const res = await window.api.aiChat({
      provider,
      model,
      system: systemPrompt(mode, chunks, truncated),
      messages: [...history, { role: 'user', content: userContent }],
      temperature: mode === 'ask' || mode === 'explain' ? 0.2 : 0.3,
      maxTokens: mode === 'edit' || mode === 'format' ? 8192 : 2048
    })

    setBusy(false)

    if (!res.ok) {
      setTurns((t) => [...t, { role: 'assistant', content: res.error ?? 'The request failed.', error: true }])
      if (res.code === 'NO_KEY' || res.code === 'BAD_KEY') setShowSettings(true)
      return
    }

    const answer = res.text ?? ''
    setTurns((t) => [
      ...t,
      { role: 'assistant', content: answer, citations: extractCitations(answer), chunks, mode }
    ])
  }

  const runQuickAction = async (action: (typeof QUICK_ACTIONS)[number]): Promise<void> => {
    if (action.needsSelection && !props.selection) {
      props.onToast('Select a passage in the document first.')
      return
    }
    await send(action.id, action.prompt)
  }

  /* ------------------------------------------- applying results to the doc */

  const applyAnnotationsFrom = (turn: Turn): void => {
    const parsed = parseAnnotations(turn.content)
    if (!parsed.ok) {
      props.onToast(parsed.error ?? 'Could not read the suggested annotations.')
      return
    }
    props.onApplyAnnotations(parsed.annotations)
  }

  const applyRevisionFrom = (turn: Turn): void => {
    const parsed = parseRevision(turn.content)
    if (!parsed.ok || !parsed.document) {
      props.onToast(parsed.error ?? 'The reply did not contain a revised document.')
      return
    }
    props.onApplyRevision(parsed.document, turn.mode === 'format' ? 'AI formatting' : 'AI edit')
  }

  const askForEdit = async (): Promise<void> => {
    if (!input.trim()) {
      props.onToast('Describe the change you want first.')
      return
    }
    await send('edit', input)
  }

  /* --------------------------------------------------------------- render */

  const needsKey = provider !== 'ollama' && !keyState?.[provider]?.saved

  return (
    <aside className="ai-panel" data-mn-ignore>
      <header className="sidebar-head">
        <span>Ask your documents</span>
        <span className="grow" />
        <button className="icon" title="AI settings" onClick={() => setShowSettings((s) => !s)}>
          ⚙
        </button>
        <button className="icon" title="Close panel" onClick={props.onClose}>
          ✕
        </button>
      </header>

      <div className={`status-strip ${status.ready ? 'good' : 'bad'} ai-status`}>
        <span className="dot-status" />
        <span title={status.detail}>{status.detail}</span>
        <span className="grow" />
        <button className="link" onClick={() => refreshStatus(provider)}>
          Re-check
        </button>
      </div>

      {showSettings && (
        <div className="ai-settings">
          <label className="ai-field">
            <span className="small muted">Provider</span>
            <select value={provider} onChange={(e) => void changeProvider(e.target.value as ProviderId)}>
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <p className="small muted">{PROVIDERS.find((p) => p.id === provider)?.blurb}</p>

          <label className="ai-field">
            <span className="small muted">Model</span>
            <select value={model} onChange={(e) => void changeModel(e.target.value)} disabled={!models.length}>
              {!models.length && <option value="">(none available)</option>}
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          {provider === 'ollama' ? (
            <p className="small muted">
              Ollama runs models on this computer. Your documents never leave the machine. If the status above says it
              is not running, start Ollama and pull a model, for example <code>ollama pull llama3.1</code>.
            </p>
          ) : (
            <div className="key-block">
              <div className="ai-field-row">
                <span className="small">
                  {KEY_HELP[provider].label} key:{' '}
                  {keyState?.[provider]?.saved ? (
                    <strong>saved {keyState[provider].hint}</strong>
                  ) : (
                    <span className="warn">not set</span>
                  )}
                </span>
                {keyState?.[provider]?.saved && (
                  <button className="link danger" onClick={() => void clearKey(provider)}>
                    Remove
                  </button>
                )}
              </div>
              <ol className="small muted">
                {KEY_HELP[provider].steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              <button className="link" onClick={() => window.open(KEY_HELP[provider].url, '_blank')}>
                Open {KEY_HELP[provider].label} key page ↗
              </button>
              <input
                type="password"
                value={keyDraft}
                placeholder={`Paste your ${KEY_HELP[provider].label} API key`}
                onFocus={() => setKeyTarget(provider)}
                onChange={(e) => setKeyDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void saveKey()}
              />
              <button className="primary small-btn" disabled={!keyDraft.trim()} onClick={saveKey}>
                Save key
              </button>
              <p className="small muted">
                {keyState?.encryption
                  ? 'Keys are encrypted with Windows DPAPI and readable only by your Windows account on this PC.'
                  : 'Windows encryption is unavailable, so the key will be stored as plain text in your settings file.'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Documents in context */}
      <div className="ai-context">
        <div className="ai-context-head">
          <span className="small muted">Context ({docs.length})</span>
          <button className="link" onClick={props.onAddDocuments}>
            + Add document
          </button>
        </div>
        <div className="ai-doc-chips">
          {docs.map((d) => (
            <span key={d.id} className="doc-chip" title={d.name}>
              {d.name}
              {d.id !== 'current' && (
                <button className="chip-x" title="Remove from context" onClick={() => props.onRemoveDocument(d.id)}>
                  ✕
                </button>
              )}
            </span>
          ))}
        </div>
      </div>

      {/* Conversation */}
      <div className="ai-scroll" ref={scrollRef}>
        {turns.length === 0 && (
          <div className="ai-empty">
            <p className="muted small">
              Answers come only from the documents listed above. If something isn&apos;t in them, you&apos;ll be told
              so rather than given a guess.
            </p>
            <div className="ai-quick">
              {QUICK_ACTIONS.map((a) => (
                <button key={a.id} className="chip-btn" onClick={() => void runQuickAction(a)}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, i) => (
          <div key={i} className={`ai-turn ${turn.role}${turn.error ? ' error' : ''}`}>
            {turn.role === 'assistant' ? (
              <>
                <div
                  className="markdown-body ai-answer"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(turn.content) }}
                />
                {!!turn.citations?.length && turn.chunks && (
                  <div className="ai-cites">
                    <span className="small muted">Sources:</span>
                    {turn.citations.map((ref) => {
                      const chunk = turn.chunks?.find((c) => c.ref === ref)
                      return (
                        <button
                          key={ref}
                          className="cite-chip"
                          title={chunk ? `${chunk.docName} › ${chunk.heading}` : `Passage ${ref}`}
                          onClick={() => chunk && props.onJumpToChunk(chunk)}
                        >
                          [{ref}]
                        </button>
                      )
                    })}
                  </div>
                )}
                {turn.mode === 'annotate' && (
                  <button className="chip-btn apply" onClick={() => applyAnnotationsFrom(turn)}>
                    Apply these annotations
                  </button>
                )}
                {(turn.mode === 'edit' || turn.mode === 'format') && (
                  <button className="chip-btn apply" onClick={() => applyRevisionFrom(turn)}>
                    Review these changes
                  </button>
                )}
              </>
            ) : (
              <div className="ai-user-text">{turn.content}</div>
            )}
          </div>
        ))}

        {busy && (
          <div className="ai-turn assistant">
            <span className="thinking">
              Reading your documents<span className="dots">…</span>
            </span>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="ai-composer">
        {turns.length > 0 && (
          <div className="ai-quick compact">
            {QUICK_ACTIONS.map((a) => (
              <button key={a.id} className="chip-btn" disabled={busy} onClick={() => void runQuickAction(a)}>
                {a.label}
              </button>
            ))}
          </div>
        )}
        <textarea
          rows={3}
          value={input}
          disabled={busy}
          placeholder={needsKey ? 'Add an API key in settings to begin…' : 'Ask something about these documents…'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send('ask', input)
            }
          }}
        />
        <div className="ai-send-row">
          <button className="link" disabled={busy} title="Ask the AI to rewrite the document" onClick={askForEdit}>
            Suggest edit
          </button>
          <span className="grow" />
          <span className="small muted">Enter to send</span>
          <button className="primary small-btn" disabled={busy || !input.trim()} onClick={() => void send('ask', input)}>
            Ask
          </button>
        </div>
      </div>
    </aside>
  )
}
