/**
 * Mermaid diagrams in the viewer.
 *
 * The renderer turns a ```` ```mermaid ```` fence into a `.mn-mermaid` block
 * that still holds the source as ordinary code, so a diagram that cannot be
 * drawn simply shows its code. The viewer then draws each block here.
 *
 * Mermaid is large, so it is loaded only when a document has a diagram. It
 * runs with `securityLevel: 'strict'`: no clicks, no scripts, labels cleaned
 * by its own sanitiser. Drawings are cached by source and theme, so typing in
 * the editor does not redraw every diagram on each key press, and printing and
 * exporting can reuse what the viewer already drew.
 */

type Mermaid = typeof import('mermaid').default

let loading: Promise<Mermaid> | null = null
let theme: 'dark' | 'default' | null = null
const cache = new Map<string, string>()
let seq = 0

function load(): Promise<Mermaid> {
  loading ??= import('mermaid').then((m) => m.default)
  return loading
}

const key = (src: string, t: string): string => `${t}\u0000${src}`

/** True when the page shows the dark theme. */
function isDark(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark'
}

/** Draws every `.mn-mermaid` block inside `host` that is not drawn yet. */
export async function drawMermaid(host: HTMLElement): Promise<void> {
  const blocks = [...host.querySelectorAll<HTMLElement>('.mn-mermaid:not([data-drawn])')]
  if (!blocks.length) return
  const t = isDark() ? 'dark' : 'default'
  let mermaid: Mermaid
  try {
    mermaid = await load()
  } catch {
    return
  }
  if (theme !== t) {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: t, fontFamily: 'inherit' })
    theme = t
  }
  for (const block of blocks) {
    if (!block.isConnected || block.dataset.drawn) continue
    const src = block.querySelector('code')?.textContent ?? ''
    if (!src.trim()) continue
    let svg = cache.get(key(src, t))
    if (!svg) {
      try {
        const out = await mermaid.render(`mn-mermaid-${++seq}`, src)
        svg = out.svg
        cache.set(key(src, t), svg)
        if (cache.size > 200) cache.delete(cache.keys().next().value as string)
      } catch (e) {
        block.dataset.drawn = 'error'
        block.title = `This diagram could not be drawn: ${(e as Error)?.message ?? e}`.slice(0, 300)
        // Mermaid leaves its error drawing in the page body; tidy it away.
        document.getElementById(`dmn-mermaid-${seq}`)?.remove()
        continue
      }
    }
    if (!block.isConnected) continue
    const fig = document.createElement('div')
    fig.className = 'mn-mermaid-svg'
    fig.setAttribute('aria-hidden', 'true')
    fig.innerHTML = svg
    block.prepend(fig)
    block.dataset.drawn = 'yes'
  }
}

/**
 * Puts the diagrams the viewer has drawn into exported or printed HTML, which
 * is rendered afresh from the source. Prefers the light drawing for paper.
 * A diagram never drawn stays as its code.
 */
export function withDiagrams(html: string): string {
  if (!cache.size || !html.includes('mn-mermaid')) return html
  return html.replace(
    /<div class="mn-mermaid"([^>]*)><pre class="hljs"><code>([\s\S]*?)<\/code><\/pre><\/div>/g,
    (whole, attrs: string, code: string) => {
      const src = code.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
      const svg = cache.get(key(src, 'default')) ?? cache.get(key(src, 'dark'))
      return svg ? `<div class="mn-mermaid"${attrs} data-drawn="yes"><div class="mn-mermaid-svg">${svg}</div></div>` : whole
    }
  )
}
