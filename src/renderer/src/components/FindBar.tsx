import { useEffect, useRef, useState } from 'react'

interface Props {
  onClose: () => void
}

export default function FindBar({ onClose }: Props): React.JSX.Element {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    return () => {
      window.api.findStop()
    }
  }, [])

  const run = (forward: boolean, next: boolean): void => {
    if (!text) return
    window.api.findStart({ text, forward, findNext: next })
  }

  return (
    <div className="findbar" data-mn-ignore>
      <input
        ref={inputRef}
        value={text}
        placeholder="Find in document"
        onChange={(e) => {
          setText(e.target.value)
          if (e.target.value) window.api.findStart({ text: e.target.value, forward: true, findNext: false })
          else window.api.findStop()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') run(!e.shiftKey, true)
          if (e.key === 'Escape') onClose()
        }}
      />
      <button title="Previous (Shift+Enter)" onClick={() => run(false, true)}>
        ↑
      </button>
      <button title="Next (Enter)" onClick={() => run(true, true)}>
        ↓
      </button>
      <button title="Close (Esc)" onClick={onClose}>
        ✕
      </button>
    </div>
  )
}
