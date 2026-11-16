/**
 * Version history: a snapshot of a document each time it is saved.
 *
 * Kept on this computer only, in the app's own storage (IndexedDB: in the
 * Windows app that lives in the app's data folder, in the web app in the
 * browser). Never beside the document, so folders stay clean and a shared or
 * cloud folder never receives old versions.
 *
 * - A save identical to the last snapshot adds nothing.
 * - Autosaves add a snapshot at most every 10 minutes, so a long session of
 *   autosaving does not push out the versions you saved yourself.
 * - The newest 50 per document are kept.
 * - Text is stored gzip-compressed where the browser can (Chromium can), so a
 *   long book costs a fraction of its size.
 */

export interface Version {
  id: number
  doc: string
  at: number
  /** Characters, before compression. */
  size: number
  words: number
  auto: boolean
}

interface Row extends Omit<Version, 'id'> {
  id?: number
  data: Blob | string
}

export const KEEP = 50

/** Windows app: the file's path, case-insensitive as Windows paths are. */
export const pathKey = (p: string): string => `path:${p.replace(/\//g, '\\').toLowerCase()}`

/** Web app: a document in My documents by its id, a file from disk by its name. */
export const versionKey = (d: { id: string | null; name: string }): string => (d.id ? `lib:${d.id}` : `file:${d.name}`)
const AUTO_GAP = 10 * 60_000
const DB = 'mn-versions'
const STORE = 'snaps'

let opening: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => {
      const s = r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
      s.createIndex('doc', 'doc')
    }
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => {
      opening = null
      reject(r.error)
    }
  })
  return opening
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}

async function pack(text: string): Promise<Blob | string> {
  if (typeof CompressionStream === 'undefined') return text
  try {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
    return await new Response(stream).blob()
  } catch {
    return text
  }
}

async function unpack(data: Blob | string): Promise<string> {
  if (typeof data === 'string') return data
  const stream = data.stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

const wordCount = (t: string): number => (t.match(/\S+/g) ?? []).length

async function rows(doc: string): Promise<Row[]> {
  const d = await db()
  const all = (await req(d.transaction(STORE).objectStore(STORE).index('doc').getAll(doc))) as Row[]
  return all.sort((a, b) => b.at - a.at)
}

/** Newest first, without the text. */
export async function listVersions(doc: string): Promise<Version[]> {
  try {
    return (await rows(doc)).map(({ data: _d, ...v }) => v as Version)
  } catch {
    return []
  }
}

export async function versionText(id: number): Promise<string | null> {
  try {
    const d = await db()
    const row = (await req(d.transaction(STORE).objectStore(STORE).get(id))) as Row | undefined
    return row ? unpack(row.data) : null
  } catch {
    return null
  }
}

/** Records a snapshot after a save. Never throws: history is a safety net, not a gate. */
export async function snapshot(doc: string, text: string, auto = false, now = Date.now()): Promise<boolean> {
  if (!doc) return false
  try {
    const list = await rows(doc)
    const last = list[0]
    if (last) {
      if (auto && now - last.at < AUTO_GAP) return false
      if (last.size === text.length && (await unpack(last.data)) === text) return false
    }
    // Everything awaited first: a transaction closes at the first await.
    const data = await pack(text)
    const d = await db()
    const t = d.transaction(STORE, 'readwrite')
    const s = t.objectStore(STORE)
    s.add({ doc, at: now, size: text.length, words: wordCount(text), auto, data } satisfies Row)
    for (const old of list.slice(KEEP - 1)) if (old.id !== undefined) s.delete(old.id)
    await new Promise<void>((res, rej) => {
      t.oncomplete = () => res()
      t.onerror = () => rej(t.error)
    })
    return true
  } catch {
    return false
  }
}

/** After Save as: the history follows the document to its new name. */
export async function moveVersions(from: string, to: string): Promise<void> {
  if (!from || !to || from === to) return
  try {
    const list = await rows(from)
    const d = await db()
    const t = d.transaction(STORE, 'readwrite')
    for (const r of list) t.objectStore(STORE).put({ ...r, doc: to })
    await new Promise<void>((res) => (t.oncomplete = () => res()))
  } catch {
    /* the old name keeps them */
  }
}

export async function deleteVersions(doc: string): Promise<void> {
  try {
    const list = await rows(doc)
    const d = await db()
    const t = d.transaction(STORE, 'readwrite')
    for (const r of list) if (r.id !== undefined) t.objectStore(STORE).delete(r.id)
  } catch {
    /* nothing to delete */
  }
}
