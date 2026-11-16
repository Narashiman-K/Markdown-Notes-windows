// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { crawlSite, distilBook, projectGuide, rankFiles, removeDuplicates, robotsRules, siteDocument, siteLinks, splitChapters, type Ask } from '../src/renderer/src/lib/aiTools'

const P = 'Small talk opens the door to friendship, and most people find it awkward at first but improve quickly with practice.'
const noop = (): void => {}

describe('chapters', () => {
  it('splits at the repeated heading level, under a single title', () => {
    const md = `# Book\n\n## One\n\n${P}\n\n## Two\n\n${P} More.\n`
    expect(splitChapters(md).map((c) => c.title)).toEqual(['One', 'Two'])
  })
  it('treats a document without chapters as one', () => {
    expect(splitChapters(P, 'Notes').length).toBe(1)
  })
})

describe('distil', () => {
  it('asks once per chapter and builds one document', async () => {
    const seen: string[] = []
    const ask: Ask = async (_s, u) => {
      seen.push(u.split('\n')[0])
      return { ok: true, text: '**Key points**\n- A' }
    }
    const out = await distilBook(`# B\n\n## One\n\n${P}\n\n## Two\n\n${P}`, 'B.md', ask, noop)
    expect(seen).toEqual(['Chapter: One', 'Chapter: Two'])
    expect(out).toContain('## One')
    expect(out).toContain('<!-- toc -->')
  })
})

describe('remove duplicates', () => {
  it('drops a repeated paragraph without any AI and keeps headings', async () => {
    const md = `# A\n\n${P}\n\n## B\n\n${P}\n\nSomething else entirely that is long enough to count as a paragraph here.\n`
    const r = await removeDuplicates(md, null, noop)
    expect(r.removed).toBe(1)
    expect(r.text.split(P).length - 1).toBe(1)
    expect(r.text).toContain('## B')
  })
  it('asks the AI to combine overlapping paragraphs', async () => {
    const a = `${P} It also builds trust between strangers over time.`
    const b = `${P} Asking one more question helps a great deal.`
    const ask: Ask = async () => ({ ok: true, text: `${P} It builds trust, and asking one more question helps.` })
    const r = await removeDuplicates(`${a}\n\n${b}\n`, ask, noop, undefined, { exact: 0.95, near: 0.5 })
    expect(r.merged).toBe(1)
    expect(r.text).toContain('asking one more question helps')
  })
})

describe('website', () => {
  it('reads robots rules for every crawler only', () => {
    expect(robotsRules('User-agent: bad\nDisallow: /\n\nUser-agent: *\nDisallow: /private\n')).toEqual(['/private'])
  })
  it('keeps links inside the site and folder', () => {
    const html = '<a href="b.html">b</a><a href="/other/x">x</a><a href="https://elsewhere.com/">e</a><a href="c.pdf">c</a><a href="#top">t</a>'
    expect(siteLinks(html, 'https://s.com/docs/a.html', 'https://s.com/docs/')).toEqual(['https://s.com/docs/b.html', 'https://s.com/docs/a.html'])
  })
  it('crawls breadth first, obeying robots.txt, into one document', async () => {
    const site: Record<string, string> = {
      'https://s.com/robots.txt': 'User-agent: *\nDisallow: /docs/secret',
      'https://s.com/docs/': `<main><h1>Home</h1><p>${P}</p><a href="a">A</a><a href="secret">S</a></main>`,
      'https://s.com/docs/a': `<main><h1>Page A</h1><p>${P}</p></main>`,
      'https://s.com/docs/secret': `<main><h1>Secret</h1><p>${P}</p></main>`
    }
    const fetchPage = async (u: string) => (site[u] ? { ok: true, html: site[u], url: u, type: u.endsWith('.txt') ? 'text/plain' : 'text/html' } : { ok: false, error: '404' })
    const pages = await crawlSite('https://s.com/docs/', fetchPage, (h) => h.replace(/<[^>]+>/g, '\n').trim(), noop, undefined, 100, 0)
    expect(pages.map((p) => p.title)).toEqual(['Home', 'Page A'])
    const doc = siteDocument('https://s.com/docs/', pages)
    expect(doc).toContain('## Page A')
    expect(doc).toContain('_Source: <https://s.com/docs/a>_')
  })
})

describe('project guide', () => {
  it('reads manifests and docs first', () => {
    const r = rankFiles([
      { path: 'src/x.ts', text: 'x' },
      { path: 'README.md', text: 'r' },
      { path: 'notes.txt', text: 'n' }
    ])
    expect(r.map((f) => f.path)).toEqual(['README.md', 'notes.txt', 'src/x.ts'])
  })
  it('describes files, then writes the guide', async () => {
    let calls = 0
    const ask: Ask = async (system) => {
      calls++
      return { ok: true, text: system.includes('project guide') ? '## Overview\nA tool.' : '### README.md\nThe readme.' }
    }
    const out = await projectGuide('demo', [{ path: 'README.md', text: '# Demo' }, { path: 'src/a.ts', text: 'export const a = 1' }], ask, noop)
    expect(calls).toBe(2)
    expect(out).toContain('# demo: project guide')
    expect(out).toContain('## File by file')
  })
})
