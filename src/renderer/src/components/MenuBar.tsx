import { useEffect, useRef, useState } from 'react'
import { REPO_URL, STORE_URL, featureRequestUrl } from '../../../shared/brand'

/**
 * In-app menu bar for the desktop build.
 *
 * The native Windows menu is still registered, but its bar is hidden. That is
 * deliberate: every accelerator and every operating-system role — cut, paste,
 * full screen, developer tools, quit — stays bound exactly as before, so no
 * shortcut was lost in moving the menu into the window. What changed is only
 * what is drawn, which is the part that could not be styled and was too small
 * to read comfortably.
 *
 * Items that are pure application commands go through `onAction`, the same
 * channel the native menu used. The few that are operating-system operations
 * are handled here, because there is nothing for the application to do with
 * them.
 */

interface MenuItem {
  label: string
  action?: string
  accelerator?: string
  separator?: boolean
  href?: string
  /** Rendered with a tick, for the theme choices. */
  checked?: boolean
  /** A grey, unclickable caption introducing the items beneath it. */
  heading?: boolean
  /** Secondary line in grey. Used for the folder a recent file lives in. */
  hint?: string
}

interface Menu {
  label: string
  items: MenuItem[]
}

interface Props {
  onAction: (action: string, payload?: unknown) => void
  recentFiles: string[]
  theme: 'light' | 'dark' | 'system'
  /** Ticks View > Page view. */
  pageView?: boolean
  /** Ticks View > Original page pictures. */
  scansShown?: boolean
}

const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p
const dirname = (p: string): string => {
  const parts = p.split(/[\\/]/)
  parts.pop()
  return parts.join('\\') || p
}

function menus(recentFiles: string[], theme: Props['theme'], pageView: boolean, scansShown: boolean): Menu[] {
  /*
   * Recent files are listed inline rather than in a submenu. The native menu
   * nested them, but one level of nesting for a list this short buys nothing
   * and a submenu is the fiddliest thing to hit with a mouse.
   */
  const recent: MenuItem[] = [
    { label: 'Recent files', heading: true },
    ...(recentFiles.length
      ? [
          ...recentFiles.slice(0, 8).map((p) => ({
            label: basename(p),
            // The folder, so two files of the same name are tellable apart.
            hint: dirname(p),
            action: `file:openPath:${p}`
          })),
          { separator: true, label: '' },
          { label: 'Clear recent', action: 'file:clearRecent' }
        ]
      : [{ label: 'Nothing opened yet', heading: true }])
  ]

  return [
    {
      label: 'File',
      items: [
        { label: 'New', action: 'file:new', accelerator: 'Ctrl+N' },
        { label: 'Open…', action: 'file:open', accelerator: 'Ctrl+O' },
        { separator: true, label: '' },
        ...recent,
        { separator: true, label: '' },
        { label: 'Save', action: 'file:save', accelerator: 'Ctrl+S' },
        { label: 'Save as…', action: 'file:saveAs', accelerator: 'Ctrl+Shift+S' },
        { separator: true, label: '' },
        { label: 'Export as HTML…', action: 'file:export:html' },
        { label: 'Export as PDF…', action: 'file:export:pdf' },
        { label: 'Export without annotations…', action: 'file:export:clean' },
        { separator: true, label: '' },
        { label: 'Convert to Markdown…', action: 'convert:open', accelerator: 'Ctrl+Shift+M' },
        { label: 'Merge files…', action: 'file:merge' },
        { label: 'Converter settings…', action: 'convert:settings' },
        { separator: true, label: '' },
        { label: 'Print…', action: 'file:print', accelerator: 'Ctrl+P' },
        { separator: true, label: '' },
        { label: 'Exit', action: 'os:quit', accelerator: 'Alt+F4' }
      ]
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', action: 'edit:undo', accelerator: 'Ctrl+Z' },
        { label: 'Redo', action: 'edit:redo', accelerator: 'Ctrl+Y' },
        { separator: true, label: '' },
        { label: 'Cut', action: 'os:cut', accelerator: 'Ctrl+X' },
        { label: 'Copy', action: 'os:copy', accelerator: 'Ctrl+C' },
        { label: 'Paste', action: 'os:paste', accelerator: 'Ctrl+V' },
        /*
         * Select all goes through the application, not webContents. The
         * webContents command selects whatever is focused at the document
         * level, which is the reading pane even when the editor is the thing
         * being worked in.
         */
        { label: 'Select all', action: 'edit:selectAll', accelerator: 'Ctrl+A' },
        { separator: true, label: '' },
        { label: 'Find…', action: 'edit:find', accelerator: 'Ctrl+F' },
        { separator: true, label: '' },
        { label: 'Remove original page pictures', action: 'edit:removeScans' }
      ]
    },
    {
      label: 'View',
      items: [
        { label: 'View mode', action: 'view:mode:view', accelerator: 'Ctrl+Shift+V' },
        { label: 'Edit mode', action: 'view:mode:edit', accelerator: 'Ctrl+E' },
        { label: 'Reader mode', action: 'view:reader', accelerator: 'F9' },
        { label: 'Page view', action: 'view:pages', checked: pageView },
        { label: 'Original page pictures', action: 'view:scans', checked: scansShown },
        { separator: true, label: '' },
        { label: 'Zoom in', action: 'view:zoom:in', accelerator: 'Ctrl++' },
        { label: 'Zoom out', action: 'view:zoom:out', accelerator: 'Ctrl+-' },
        { label: 'Reset zoom', action: 'view:zoom:reset', accelerator: 'Ctrl+0' },
        { separator: true, label: '' },
        { label: 'Outline panel', action: 'view:sidebar:outline', accelerator: 'Ctrl+Shift+O' },
        { label: 'Annotations panel', action: 'view:sidebar:comments', accelerator: 'Ctrl+Shift+C' },
        { separator: true, label: '' },
        { label: 'Light theme', action: 'view:theme:light', checked: theme === 'light' },
        { label: 'Dark theme', action: 'view:theme:dark', checked: theme === 'dark' },
        { label: 'Follow system', action: 'view:theme:system', checked: theme === 'system' },
        { separator: true, label: '' },
        { label: 'Full screen', action: 'os:fullscreen', accelerator: 'F11' },
        { label: 'Developer tools', action: 'os:devtools', accelerator: 'Ctrl+Shift+I' }
      ]
    },
    {
      label: 'Insert',
      items: [
        { label: 'Bold', action: 'insert:bold', accelerator: 'Ctrl+B' },
        { label: 'Italic', action: 'insert:italic', accelerator: 'Ctrl+I' },
        { label: 'Inline code', action: 'insert:code', accelerator: 'Ctrl+`' },
        { separator: true, label: '' },
        { label: 'Heading 1', action: 'insert:h1', accelerator: 'Ctrl+1' },
        { label: 'Heading 2', action: 'insert:h2', accelerator: 'Ctrl+2' },
        { label: 'Heading 3', action: 'insert:h3', accelerator: 'Ctrl+3' },
        { separator: true, label: '' },
        { label: 'Bullet list', action: 'insert:ul' },
        { label: 'Numbered list', action: 'insert:ol' },
        { label: 'Task list item', action: 'insert:task' },
        { label: 'Block quote', action: 'insert:quote' },
        { separator: true, label: '' },
        { label: 'Link…', action: 'insert:link', accelerator: 'Ctrl+K' },
        { label: 'Image…', action: 'insert:image' },
        { label: 'Table', action: 'insert:table' },
        { label: 'Code block', action: 'insert:codeblock' },
        { label: 'Horizontal rule', action: 'insert:hr' }
      ]
    },
    {
      label: 'Annotate',
      items: [
        { label: 'Highlight yellow', action: 'annot:highlight:yellow', accelerator: 'Ctrl+Alt+1' },
        { label: 'Highlight green', action: 'annot:highlight:green', accelerator: 'Ctrl+Alt+2' },
        { label: 'Highlight blue', action: 'annot:highlight:blue', accelerator: 'Ctrl+Alt+3' },
        { label: 'Highlight pink', action: 'annot:highlight:pink', accelerator: 'Ctrl+Alt+4' },
        { separator: true, label: '' },
        { label: 'Underline', action: 'annot:underline', accelerator: 'Ctrl+U' },
        { label: 'Strikethrough', action: 'annot:strike', accelerator: 'Ctrl+Shift+X' },
        { label: 'Bold emphasis', action: 'annot:bold', accelerator: 'Ctrl+Alt+B' },
        { separator: true, label: '' },
        { label: 'Add comment…', action: 'annot:comment', accelerator: 'Ctrl+Alt+M' },
        { separator: true, label: '' },
        { label: 'Remove selected annotation', action: 'annot:remove' },
        { label: 'Remove all annotations…', action: 'annot:clearAll' }
      ]
    },
    {
      label: 'AI',
      items: [
        { label: 'Ask your documents', action: 'ai:toggle', accelerator: 'Ctrl+Shift+A' },
        { separator: true, label: '' },
        /*
         * The quick actions, which are also chips inside the panel.
         *
         * The native menu listed these against actions nothing handled, so
         * they were removed rather than left dead. They are back now that
         * `ai:quick:*` opens the panel and runs the matching action.
         */
        { label: 'Summarise', action: 'ai:quick:summarise' },
        { label: 'Compare documents', action: 'ai:quick:compare' },
        { label: 'Explain selection', action: 'ai:quick:explain' },
        { label: 'Suggest annotations', action: 'ai:quick:annotate' }
      ]
    },
    {
      label: 'Help',
      items: [
        { label: 'Keyboard shortcuts', action: 'help:shortcuts', accelerator: 'F1' },
        { separator: true, label: '' },
        { label: 'Request a feature', action: 'help:featureVote' },
        { label: 'Source on GitHub', href: REPO_URL },
        { label: 'Privacy policy', href: `${REPO_URL}/blob/main/docs/privacy.md` },
        { label: 'Rate it in the Store', href: STORE_URL },
        { separator: true, label: '' },
        { label: 'About', action: 'help:about' }
      ]
    }
  ]
}

export default function MenuBar({ onAction, recentFiles, theme, pageView = false, scansShown = false }: Props): React.JSX.Element {
  const [open, setOpen] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null)
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(null)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const run = (item: MenuItem): void => {
    setOpen(null)
    if (!item.action && !item.href) return

    if (item.href) {
      // Main intercepts window-open and hands it to the system browser.
      window.open(item.href, '_blank')
      return
    }

    const action = item.action as string

    /*
     * Operating-system operations are done here. There is nothing for the
     * application layer to do with a clipboard command, and routing them
     * through it would mean inventing handlers that only forward.
     */
    if (action.startsWith('os:')) {
      const which = action.slice(3)
      /*
       * All of these go to the main process, clipboard included. Chromium
       * refuses document.execCommand('paste'), so the menu item silently did
       * nothing while the accelerator worked.
       */
      void window.api.appCommand(which as Parameters<typeof window.api.appCommand>[0])
      return
    }

    // Opening a recent file carries the path in the action itself.
    if (action.startsWith('file:openPath:')) {
      onAction('file:openPath', action.slice('file:openPath:'.length))
      return
    }

    if (action === 'help:featureVote') {
      window.open(featureRequestUrl(), '_blank')
      return
    }

    onAction(action)
  }

  const all = menus(recentFiles, theme, pageView, scansShown)

  return (
    <div className="menubar" ref={ref}>
      {all.map((menu) => (
        <div className="menu-root" key={menu.label}>
          <button
            className={`menu-title${open === menu.label ? ' on' : ''}`}
            /*
             * Never take focus.
             *
             * Cut, paste and select all act on whatever is focused. Clicking a
             * menu button moves focus to the button, so by the time the
             * handler ran the editor had lost it: paste went nowhere and
             * select all fell back to the document body, which is the reading
             * pane. Refusing focus leaves the caret where the user left it.
             */
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setOpen(open === menu.label ? null : menu.label)}
            // Sliding along an open menu bar should open each menu in turn,
            // which is what every native menu does.
            onMouseEnter={() => open && setOpen(menu.label)}
          >
            {menu.label}
          </button>

          {open === menu.label && (
            <div className="menu-dropdown" role="menu">
              {menu.items.map((item, i) =>
                item.separator ? (
                  <div key={i} className="menu-sep" />
                ) : item.heading ? (
                  <div key={i} className="menu-group-label">
                    {item.label}
                  </div>
                ) : (
                  <button
                    key={i}
                    className="menu-item"
                    role="menuitem"
                    disabled={!item.action && !item.href}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => run(item)}
                  >
                    <span className="menu-item-text">
                      <span>
                        {item.checked ? '✓ ' : ''}
                        {item.label}
                      </span>
                      {item.hint && <span className="menu-item-hint">{item.hint}</span>}
                    </span>
                    {item.accelerator && <span className="menu-accel">{item.accelerator}</span>}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
