interface Props {
  x: number
  y: number
  /** True when there was no room above the selection, so the bar sits below it. */
  flip?: boolean
  onAction: (action: string) => void
}

interface Item {
  action: string
  label: string
  title: string
  className?: string
}

const GROUPS: Item[][] = [
  [
    { action: 'insert:bold', label: 'B', title: 'Bold (Ctrl+B)', className: 'ft-bold' },
    { action: 'insert:italic', label: 'I', title: 'Italic (Ctrl+I)', className: 'ft-italic' },
    { action: 'insert:strike', label: 'S', title: 'Strikethrough', className: 'ft-strike' },
    { action: 'insert:code', label: '</>', title: 'Inline code (Ctrl+`)', className: 'ft-code' }
  ],
  [
    { action: 'insert:h1', label: 'H1', title: 'Heading 1 (Ctrl+1)' },
    { action: 'insert:h2', label: 'H2', title: 'Heading 2 (Ctrl+2)' },
    { action: 'insert:h3', label: 'H3', title: 'Heading 3 (Ctrl+3)' }
  ],
  [
    { action: 'insert:ul', label: '•', title: 'Bullet list' },
    { action: 'insert:ol', label: '1.', title: 'Numbered list' },
    { action: 'insert:task', label: '☑', title: 'Task list item' },
    { action: 'insert:quote', label: '❝', title: 'Block quote' }
  ],
  [
    { action: 'insert:link', label: '🔗', title: 'Insert link (Ctrl+K)' },
    { action: 'insert:image', label: '🖼', title: 'Insert image' },
    { action: 'insert:table', label: '▦', title: 'Insert table' },
    { action: 'insert:codeblock', label: '{ }', title: 'Fenced code block' },
    { action: 'insert:hr', label: '―', title: 'Horizontal rule' }
  ]
]

/** Floating formatting bar shown when text is selected in the source editor. */
export default function FormatToolbar({ x, y, flip, onAction }: Props): React.JSX.Element {
  return (
    <div
      className={`sel-toolbar format-toolbar${flip ? ' flip' : ''}`}
      data-mn-ignore
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {GROUPS.map((group, i) => (
        <span key={i} className="ft-group">
          {i > 0 && <span className="sep" />}
          {group.map((item) => (
            <button
              key={item.action}
              className={item.className}
              title={item.title}
              onClick={() => onAction(item.action)}
            >
              {item.label}
            </button>
          ))}
        </span>
      ))}
    </div>
  )
}
