interface Props {
  mode: 'view' | 'edit'
  zoom: number
  dirty: boolean
  fileName: string
  sidebar: 'none' | 'outline' | 'comments'
  aiOpen: boolean
  onAction: (action: string) => void
}

export default function Toolbar(props: Props): React.JSX.Element {
  const { mode, zoom, dirty, fileName, sidebar, aiOpen, onAction } = props
  const btn = (action: string, label: string, title: string, extra = ''): React.JSX.Element => (
    <button className={`tb ${extra}`} title={title} onClick={() => onAction(action)}>
      {label}
    </button>
  )

  return (
    <div className="toolbar" data-mn-ignore>
      <div className="tb-group">
        {btn('file:new', '＋', 'New document (Ctrl+N)')}
        {btn('file:open', '📂', 'Open… (Ctrl+O)')}
        {btn('file:save', '💾', 'Save (Ctrl+S)', dirty ? 'accent' : '')}
        {btn('file:print', '🖨', 'Print… (Ctrl+P)')}
      </div>

      <div className="tb-group">
        <div className="segmented">
          <button className={mode === 'view' ? 'on' : ''} onClick={() => onAction('view:mode:view')} title="View mode (Ctrl+Shift+V)">
            View
          </button>
          <button className={mode === 'edit' ? 'on' : ''} onClick={() => onAction('view:mode:edit')} title="Edit mode (Ctrl+E)">
            Edit
          </button>
        </div>
      </div>

      <div className="tb-group">
        {btn('view:zoom:out', '−', 'Zoom out (Ctrl+-)')}
        <button className="tb zoom-label" title="Reset zoom (Ctrl+0)" onClick={() => onAction('view:zoom:reset')}>
          {Math.round(zoom * 100)}%
        </button>
        {btn('view:zoom:in', '＋', 'Zoom in (Ctrl++)')}
      </div>

      <div className="tb-group">
        {btn('view:sidebar:outline', '☰', 'Outline (Ctrl+Shift+O)', sidebar === 'outline' ? 'on' : '')}
        {btn('view:sidebar:comments', '💬', 'Annotations (Ctrl+Shift+C)', sidebar === 'comments' ? 'on' : '')}
        {btn('edit:find', '🔍', 'Find (Ctrl+F)')}
        {btn('ai:toggle', '✦', 'Ask your documents (Ctrl+Shift+A)', aiOpen ? 'on' : '')}
      </div>

      <div className="tb-title" title={fileName}>
        {dirty ? '• ' : ''}
        {fileName}
      </div>
    </div>
  )
}
