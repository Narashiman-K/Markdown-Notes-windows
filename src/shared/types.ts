export type AnnotationType = 'highlight' | 'underline' | 'strike' | 'comment' | 'bold' | 'italic'

export interface AnnotationMeta {
  id: string
  type: AnnotationType
  color?: string
  note?: string
  author?: string
  at?: string
  text: string
}

export interface DocState {
  filePath: string | null
  content: string
  dirty: boolean
}

export interface OpenResult {
  ok: boolean
  filePath?: string
  content?: string
  error?: string
  canceled?: boolean
}

export interface SaveResult {
  ok: boolean
  filePath?: string
  error?: string
  canceled?: boolean
}

export type MenuAction =
  | 'file:new'
  | 'file:open'
  | 'file:save'
  | 'file:saveAs'
  | 'file:export:html'
  | 'file:export:pdf'
  | 'file:print'
  | 'edit:find'
  | 'view:mode:view'
  | 'view:mode:edit'
  | 'view:mode:toggle'
  | 'view:zoom:in'
  | 'view:zoom:out'
  | 'view:zoom:reset'
  | 'view:sidebar:comments'
  | 'view:sidebar:outline'
  | 'view:theme:light'
  | 'view:theme:dark'
  | 'view:theme:system'
  | 'annot:highlight:yellow'
  | 'annot:highlight:green'
  | 'annot:highlight:blue'
  | 'annot:highlight:pink'
  | 'annot:underline'
  | 'annot:strike'
  | 'annot:bold'
  | 'annot:comment'
  | 'annot:remove'
  | 'annot:clearAll'
  | 'insert:bold'
  | 'insert:italic'
  | 'insert:code'
  | 'insert:link'
  | 'insert:image'
  | 'insert:table'
  | 'insert:hr'
  | 'insert:h1'
  | 'insert:h2'
  | 'insert:h3'
  | 'insert:ul'
  | 'insert:ol'
  | 'insert:task'
  | 'insert:quote'
  | 'help:about'
  | 'help:shortcuts'

export const ZOOM_LEVELS = [0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]
