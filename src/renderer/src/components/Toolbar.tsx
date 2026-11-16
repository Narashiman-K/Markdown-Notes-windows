interface Props {
  mode: 'view' | 'edit'
  /** Reading is a third mode as far as anyone using this is concerned. */
  readerOn: boolean
  zoom: number
  dirty: boolean
  fileName: string
  sidebar: 'none' | 'outline' | 'comments'
  aiOpen: boolean
  /** The dictation bar is open (the button shows as pressed). */
  dictationOpen?: boolean
  /** The read-aloud bar is open. */
  readOpen?: boolean
  /** The mind map is open. */
  mindOpen?: boolean
  /**
   * Scanned pages' own pictures: 'none' when the document keeps none, and the
   * button is not shown; otherwise whether they are showing.
   */
  scans?: 'none' | 'shown' | 'hidden'
  onAction: (action: string) => void
}

export default function Toolbar(props: Props): React.JSX.Element {
  const { mode, readerOn, zoom, dirty, sidebar, aiOpen, onAction } = props
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

      {/* Labelled rather than an icon alone: merging is new, and a word says
          what it does where a symbol would have to be learned. */}
      <div className="tb-group">
        {btn('file:merge', '⧉ Merge docs', 'Merge files: combine several documents into one', 'tb-text')}
        {btn('file:compare', '⇆ Compare', 'Compare documents: see every difference side by side', 'tb-text')}
        {btn('edit:dictateBar', '🎙 Dictate', props.dictationOpen ? 'Close the dictation bar' : 'Dictation: type with your voice (open the bar, then press the microphone or Ctrl+Shift+D)', `tb-text tb-dictate${props.dictationOpen ? ' on' : ''}`)}
        {btn('view:readAloud', '🔊 Read aloud', props.readOpen ? 'Close the read-aloud bar' : 'Read the document aloud, with each sentence highlighted (Ctrl+Shift+Space plays and pauses)', `tb-text tb-read${props.readOpen ? ' on' : ''}`)}
        {props.scans && props.scans !== 'none' &&
          btn(
            'view:scans',
            '🖼 Originals',
            props.scans === 'shown'
              ? 'Hide the original page pictures and show only the converted text'
              : 'Show the original page pictures beside the converted text, to compare',
            `tb-text${props.scans === 'shown' ? ' on' : ''}`
          )}
      </div>

      <div className="tb-group">
        <div className="segmented">
          <button
            className={mode === 'view' && !readerOn ? 'on' : ''}
            onClick={() => onAction('view:mode:view')}
            title="View mode (Ctrl+Shift+V)"
          >
            View
          </button>
          <button
            className={mode === 'edit' && !readerOn ? 'on' : ''}
            onClick={() => onAction('view:mode:edit')}
            title="Edit mode (Ctrl+E)"
          >
            Edit
          </button>
          {/* Reading sits beside the other two because that is how it is
              thought about. Entering it hides the toolbar, so the way back
              out lives at the top of the reading panel instead. */}
          <button
            className={readerOn ? 'on' : ''}
            onClick={() => onAction('view:reader')}
            title="Reader mode (F9)"
          >
            Read
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
        {btn('insert:toc', '📑', 'Table of contents: create one at the top of the document, or update it')}
        {btn('view:sidebar:outline', '☰', 'Outline (Ctrl+Shift+O)', sidebar === 'outline' ? 'on' : '')}
        {btn('view:sidebar:comments', '💬', 'Annotations (Ctrl+Shift+C)', sidebar === 'comments' ? 'on' : '')}
        {btn('edit:find', '🔍', 'Find (Ctrl+F)')}
        {btn('view:mindmap', '🧠', props.mindOpen ? 'Close the mind map (Alt+M)' : 'Mind map of this document, for revision (Alt+M)', props.mindOpen ? 'on' : '')}
        {btn('ai:toggle', '✦', 'Ask your documents (Ctrl+Shift+A)', aiOpen ? 'on' : '')}
      </div>

      {/* The file name is in the window's title bar, so it is not repeated here. */}
    </div>
  )
}
