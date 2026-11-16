import 'fake-indexeddb/auto'
import { describe, it, expect } from 'vitest'
import { KEEP, deleteVersions, listVersions, pathKey, snapshot, versionText } from '../src/renderer/src/lib/versions'

describe('version history', () => {
  it('keeps a snapshot per save, skipping identical ones', async () => {
    const doc = 'test:a'
    expect(await snapshot(doc, '# One', false, 1000)).toBe(true)
    expect(await snapshot(doc, '# One', false, 2000)).toBe(false)
    expect(await snapshot(doc, '# One two', false, 3000)).toBe(true)
    const list = await listVersions(doc)
    expect(list.map((v) => v.words)).toEqual([3, 2])
    expect(await versionText(list[1].id)).toBe('# One')
  })

  it('adds autosaves at most every 10 minutes', async () => {
    const doc = 'test:auto'
    await snapshot(doc, 'a', false, 0)
    expect(await snapshot(doc, 'b', true, 60_000)).toBe(false)
    expect(await snapshot(doc, 'c', true, 11 * 60_000)).toBe(true)
  })

  it(`keeps the newest ${KEEP}`, async () => {
    const doc = 'test:many'
    for (let i = 0; i < KEEP + 5; i++) await snapshot(doc, `v${i}`, false, i * 1000)
    const list = await listVersions(doc)
    expect(list.length).toBe(KEEP)
    expect(await versionText(list[0].id)).toBe(`v${KEEP + 4}`)
    await deleteVersions(doc)
    await new Promise((r) => setTimeout(r, 20))
    expect(await listVersions(doc)).toEqual([])
  })

  it('treats Windows paths case-insensitively', () => {
    expect(pathKey('D:/Notes/Book.md')).toBe(pathKey('d:\\notes\\book.md'))
  })
})
