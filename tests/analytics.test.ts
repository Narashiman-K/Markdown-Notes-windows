// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { analyticsAvailable, analyticsOn, commandName, flush, setAnalytics, track } from '../src/renderer/src/lib/analytics'

describe('anonymous usage statistics', () => {
  it('sends only command names, never arguments or odd strings', () => {
    expect(commandName('file:save')).toBe('file:save')
    expect(commandName('annot:highlight:yellow')).toBe('annot:highlight:yellow')
    expect(commandName('C:\\Users\\me\\Book.md')).toBeNull()
    expect(commandName('file:openPath D:/x.md')).toBeNull()
    expect(commandName('hello world')).toBeNull()
  })

  it('remembers the off switch', () => {
    expect(analyticsOn()).toBe(true)
    setAnalytics(false)
    expect(analyticsOn()).toBe(false)
    setAnalytics(true)
    expect(analyticsOn()).toBe(true)
  })

  it('sends nothing without a project key or in tests', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(analyticsAvailable()).toBe(false)
    track('command', { name: 'file:save' })
    await flush()
    expect(f).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
