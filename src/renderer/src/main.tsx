import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/app.css'
import './styles/markdown.css'
import 'highlight.js/styles/github.css'
import { setLocalImageResolver } from './lib/markdown'

// Local images are loaded through the main process's `mn-local:` scheme on
// screen. See setLocalImageResolver in lib/markdown.ts for why, and
// registerLocalImageProtocol in the main process for what it will serve.
setLocalImageResolver((fileUrl) => `mn-local://image/?src=${encodeURIComponent(fileUrl)}`)

// Expose the converters to the smoke harness so it can run real files through
// the real code path. Gated on an environment variable set only by the test
// script, so this never attaches in a user's session.
if (window.api?.smokeMode) {
  void import('./lib/convert').then((m) => {
    ;(window as unknown as Record<string, unknown>).__convert = m
  })
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

/*
 * Retire the start-up splash from index.html once the interface is on screen.
 * Two animation frames: the first lets React commit, the second lets the
 * browser paint it, so the fade never reveals an empty window. The timeout
 * covers a system with animations turned off, where transitionend never fires.
 */
function retireSplash(): void {
  const splash = document.getElementById('boot-splash')
  if (!splash || splash.classList.contains('gone')) return
  splash.classList.add('gone')
  splash.addEventListener('transitionend', () => splash.remove(), { once: true })
  window.setTimeout(() => splash.remove(), 600)
}
requestAnimationFrame(() => requestAnimationFrame(retireSplash))
// A page opened in a background tab gets no animation frames until it is
// shown, so without this the splash would sit there until then.
window.setTimeout(retireSplash, 1500)
