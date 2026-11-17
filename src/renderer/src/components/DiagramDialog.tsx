import { useEffect, useRef, useState } from 'react'
import { drawMermaid } from '../lib/mermaidView'

/**
 * Insert → Diagram. A diagram written as a few lines of plain text (Mermaid),
 * which the app draws as a picture. Each kind has a short example, explained,
 * with a live preview, so it is clear what it is for before inserting it.
 */

interface Kind {
  id: string
  label: string
  use: string
  code: string
}

const KINDS: Kind[] = [
  {
    id: 'flow',
    label: 'Steps and decisions (flowchart)',
    use: 'A procedure or a decision you want to see at a glance: how to do something, what to do if…',
    code: 'flowchart TD\n  A[Meet someone new] --> B{Do they seem open?}\n  B -- Yes --> C[Ask an open question]\n  B -- No --> D[Smile and comment on the setting]\n  C --> E[Listen and ask one more question]\n  D --> E'
  },
  {
    id: 'mind',
    label: 'Ideas around a topic (mind map)',
    use: 'Notes for revision: one topic in the middle and its key ideas around it.',
    code: 'mindmap\n  root((Small talk))\n    Mindset\n      Curiosity\n      Warm up first\n    Openers\n      Comment on the setting\n      Ask for a story\n    Going deeper\n      Listen more\n      Better questions'
  },
  {
    id: 'time',
    label: 'Events in order (timeline)',
    use: 'A history, a plan or a story laid out by date or stage.',
    code: 'timeline\n  title My reading plan\n  Week 1 : Chapters 1-2\n  Week 2 : Chapters 3-4\n  Week 3 : Chapters 5-6 : Revise with the mind map'
  },
  {
    id: 'seq',
    label: 'Who says what to whom (sequence)',
    use: 'A conversation, a process between people or systems, step by step.',
    code: 'sequenceDiagram\n  participant You\n  participant Stranger\n  You->>Stranger: Hi, how do you know the host?\n  Stranger-->>You: We work together.\n  You->>Stranger: What do you do there?'
  },
  {
    id: 'pie',
    label: 'Parts of a whole (pie chart)',
    use: 'How something divides up: time, money, survey answers.',
    code: 'pie title How I spend reading time\n  "Reading" : 50\n  "Notes" : 25\n  "Revision" : 25'
  }
]

interface Props {
  editMode: boolean
  onInsert: (block: string) => void
  onClose: () => void
}

export default function DiagramDialog({ editMode, onInsert, onClose }: Props): React.JSX.Element {
  const [kind, setKind] = useState(KINDS[0])
  const [code, setCode] = useState(KINDS[0].code)
  const preview = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = preview.current
    if (!host) return
    const t = window.setTimeout(() => {
      host.innerHTML = ''
      const block = document.createElement('div')
      block.className = 'mn-mermaid'
      const pre = document.createElement('pre')
      const c = document.createElement('code')
      c.textContent = code
      pre.appendChild(c)
      block.appendChild(pre)
      host.appendChild(block)
      void drawMermaid(host)
    }, 250)
    return () => window.clearTimeout(t)
  }, [code])

  return (
    <div className="modal-backdrop" data-mn-ignore onMouseDown={onClose}>
      <div className="modal diagram-modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Insert a diagram">
        <h2>Insert a diagram</h2>
        <p className="muted small">
          A diagram here is a few lines of plain text that the app draws as a picture, so you can change it by editing the words. Pick a kind, change the example to
          your own, and insert it. It stays readable as text in any other Markdown app.
        </p>
        <div className="diagram-body">
          <ul className="diagram-kinds">
            {KINDS.map((k) => (
              <li key={k.id}>
                <button
                  className={k.id === kind.id ? 'active' : ''}
                  onClick={() => {
                    setKind(k)
                    setCode(k.code)
                  }}
                >
                  <strong>{k.label}</strong>
                  <span className="muted small">{k.use}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="diagram-edit">
            <label className="small">
              The diagram as text (edit it):
              <textarea value={code} onChange={(e) => setCode(e.target.value)} rows={8} spellCheck={false} />
            </label>
            <div className="diagram-preview markdown-body" ref={preview} />
          </div>
        </div>
        <div className="modal-actions">
          <span className="muted small" style={{ flex: 1 }}>
            {editMode ? 'Goes where the cursor is.' : 'Goes at the end of the document (in Edit mode it goes where the cursor is).'}
          </span>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!code.trim()} onClick={() => onInsert('```mermaid\n' + code.trim() + '\n```')}>
            Insert diagram
          </button>
        </div>
      </div>
    </div>
  )
}
