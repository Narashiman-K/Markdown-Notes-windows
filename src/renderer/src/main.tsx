import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/app.css'
import './styles/markdown.css'
import 'highlight.js/styles/github.css'

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
