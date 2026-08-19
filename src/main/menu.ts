import { app, Menu, shell, BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { basename } from 'node:path'
import { getSettings, clearRecent, setSettings } from './store'

type Send = (action: string, payload?: unknown) => void

export function buildMenu(win: BrowserWindow, send: Send): void {
  const s = getSettings()

  const recent: MenuItemConstructorOptions[] = s.recentFiles.length
    ? [
        ...s.recentFiles.map((p) => ({
          label: basename(p),
          sublabel: p,
          click: () => send('file:openPath', p)
        })),
        { type: 'separator' as const },
        {
          label: 'Clear Recent',
          click: () => {
            clearRecent()
            buildMenu(win, send)
          }
        }
      ]
    : [{ label: '(empty)', enabled: false }]

  const template: MenuItemConstructorOptions[] = [
    {
      label: '&File',
      submenu: [
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => send('file:new') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => send('file:open') },
        { label: 'Open Recent', submenu: recent },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('file:save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('file:saveAs') },
        {
          label: 'Export',
          submenu: [
            { label: 'HTML…', click: () => send('file:export:html') },
            { label: 'PDF…', click: () => send('file:export:pdf') },
            { label: 'Markdown without annotations…', click: () => send('file:export:clean') }
          ]
        },
        { type: 'separator' },
        {
          label: 'Convert to Markdown…',
          accelerator: 'CmdOrCtrl+Shift+M',
          click: () => send('convert:open')
        },
        { label: 'Converter Settings…', click: () => send('convert:settings') },
        { type: 'separator' },
        { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => send('file:print') },
        { type: 'separator' },
        { label: 'Exit', accelerator: 'Alt+F4', role: 'quit' }
      ]
    },
    {
      label: '&Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('edit:undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Y', click: () => send('edit:redo') },
        { label: 'Redo ', accelerator: 'CmdOrCtrl+Shift+Z', visible: false, click: () => send('edit:redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle', label: 'Paste as Plain Text' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: () => send('edit:find') }
      ]
    },
    {
      label: '&View',
      submenu: [
        { label: 'View Mode', accelerator: 'CmdOrCtrl+Shift+V', click: () => send('view:mode:view') },
        { label: 'Edit Mode', accelerator: 'CmdOrCtrl+E', click: () => send('view:mode:edit') },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => send('view:zoom:in') },
        { label: 'Zoom In ', accelerator: 'CmdOrCtrl+=', visible: false, click: () => send('view:zoom:in') },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => send('view:zoom:out') },
        { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', click: () => send('view:zoom:reset') },
        { type: 'separator' },
        { label: 'Outline Panel', accelerator: 'CmdOrCtrl+Shift+O', click: () => send('view:sidebar:outline') },
        { label: 'Comments Panel', accelerator: 'CmdOrCtrl+Shift+C', click: () => send('view:sidebar:comments') },
        { type: 'separator' },
        {
          label: 'Theme',
          submenu: [
            {
              label: 'Light',
              type: 'radio',
              checked: s.theme === 'light',
              click: () => {
                setSettings({ theme: 'light' })
                send('view:theme:light')
              }
            },
            {
              label: 'Dark',
              type: 'radio',
              checked: s.theme === 'dark',
              click: () => {
                setSettings({ theme: 'dark' })
                send('view:theme:dark')
              }
            },
            {
              label: 'Use System Setting',
              type: 'radio',
              checked: s.theme === 'system',
              click: () => {
                setSettings({ theme: 'system' })
                send('view:theme:system')
              }
            }
          ]
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools', accelerator: 'CmdOrCtrl+Shift+I' }
      ]
    },
    {
      label: '&Insert',
      submenu: [
        { label: 'Bold', accelerator: 'CmdOrCtrl+B', click: () => send('insert:bold') },
        { label: 'Italic', accelerator: 'CmdOrCtrl+I', click: () => send('insert:italic') },
        { label: 'Inline Code', accelerator: 'CmdOrCtrl+`', click: () => send('insert:code') },
        { type: 'separator' },
        { label: 'Heading 1', accelerator: 'CmdOrCtrl+1', click: () => send('insert:h1') },
        { label: 'Heading 2', accelerator: 'CmdOrCtrl+2', click: () => send('insert:h2') },
        { label: 'Heading 3', accelerator: 'CmdOrCtrl+3', click: () => send('insert:h3') },
        { type: 'separator' },
        { label: 'Bullet List', click: () => send('insert:ul') },
        { label: 'Numbered List', click: () => send('insert:ol') },
        { label: 'Task List Item', click: () => send('insert:task') },
        { label: 'Block Quote', click: () => send('insert:quote') },
        { type: 'separator' },
        { label: 'Link…', accelerator: 'CmdOrCtrl+K', click: () => send('insert:link') },
        { label: 'Image…', click: () => send('insert:image') },
        { label: 'Table', click: () => send('insert:table') },
        { label: 'Horizontal Rule', click: () => send('insert:hr') }
      ]
    },
    {
      label: '&Annotate',
      submenu: [
        {
          label: 'Highlight',
          submenu: [
            { label: 'Yellow', accelerator: 'CmdOrCtrl+Alt+1', click: () => send('annot:highlight:yellow') },
            { label: 'Green', accelerator: 'CmdOrCtrl+Alt+2', click: () => send('annot:highlight:green') },
            { label: 'Blue', accelerator: 'CmdOrCtrl+Alt+3', click: () => send('annot:highlight:blue') },
            { label: 'Pink', accelerator: 'CmdOrCtrl+Alt+4', click: () => send('annot:highlight:pink') }
          ]
        },
        { label: 'Underline', accelerator: 'CmdOrCtrl+U', click: () => send('annot:underline') },
        { label: 'Strikethrough', accelerator: 'CmdOrCtrl+Shift+X', click: () => send('annot:strike') },
        { label: 'Bold Emphasis', accelerator: 'CmdOrCtrl+Alt+B', click: () => send('annot:bold') },
        { type: 'separator' },
        { label: 'Add Comment…', accelerator: 'CmdOrCtrl+Alt+M', click: () => send('annot:comment') },
        { type: 'separator' },
        { label: 'Remove Annotation at Selection', accelerator: 'CmdOrCtrl+Alt+Backspace', click: () => send('annot:remove') },
        { label: 'Remove All Annotations…', click: () => send('annot:clearAll') }
      ]
    },
    {
      label: 'A&I',
      submenu: [
        { label: 'Ask Your Documents', accelerator: 'CmdOrCtrl+Shift+A', click: () => send('ai:toggle') },
        { type: 'separator' },
        { label: 'Summarise Document', click: () => send('ai:quick:summarise') },
        { label: 'Explain Selection', click: () => send('ai:quick:explain') },
        { label: 'Suggest Annotations', click: () => send('ai:quick:annotate') },
        { type: 'separator' },
        {
          label: 'Coming soon: documentation from a code project…',
          click: () => send('help:featureVote')
        }
      ]
    },
    {
      label: '&Help',
      submenu: [
        { label: 'Keyboard Shortcuts', accelerator: 'F1', click: () => send('help:shortcuts') },
        { label: 'Markdown Guide (web)', click: () => shell.openExternal('https://commonmark.org/help/') },
        { type: 'separator' },
        { label: 'Request a Feature or Report a Problem', click: () => send('help:featureVote') },
        { label: 'Project on GitHub', click: () => shell.openExternal('https://github.com/Narashiman-K/Markdown-Notes-windows') },
        { type: 'separator' },
        { label: `About ${app.getName()}`, click: () => send('help:about') }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

