import { useEffect, useRef, useState } from 'react'

interface Props {
  title: string
  initial: string
  placeholder?: string
  onCancel: () => void
  onSave: (value: string) => void
}

export default function NoteDialog({ title, initial, placeholder, onCancel, onSave }: Props): React.JSX.Element {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  return (
    <div className="modal-backdrop" data-mn-ignore onMouseDown={onCancel}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <textarea
          ref={ref}
          rows={5}
          value={value}
          placeholder={placeholder ?? 'Type your comment…'}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel()
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onSave(value.trim())
          }}
        />
        <div className="modal-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={() => onSave(value.trim())}>
            Save comment
          </button>
        </div>
        <p className="muted small">Ctrl+Enter to save · Esc to cancel</p>
      </div>
    </div>
  )
}
