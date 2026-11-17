/**
 * Esc closes the popup in front, whatever it is.
 *
 * Every popup sits on a `.modal-backdrop`, and clicking the backdrop closes
 * it (or does nothing while it is busy, as with an AI job). So Esc does what
 * a click outside would: on the front-most backdrop. A popup with no backdrop
 * click falls back to its own Cancel or Close button. Esc that reaches no
 * popup carries on as before (leaving reader mode, closing the find bar…).
 */
export function installEscapeClose(): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || e.defaultPrevented) return
    const backdrops = Array.from(document.querySelectorAll<HTMLElement>('.modal-backdrop'))
    const top = backdrops[backdrops.length - 1]
    if (!top) return
    e.preventDefault()
    e.stopPropagation()
    const before = document.querySelectorAll('.modal-backdrop').length
    top.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    // No backdrop click on this one: its own Cancel or Close button.
    window.setTimeout(() => {
      if (!top.isConnected || document.querySelectorAll('.modal-backdrop').length < before) return
      const button = Array.from(top.querySelectorAll<HTMLButtonElement>('button')).find((b) => /^(cancel|close|discard|not now|no)\b/i.test(b.textContent?.trim() ?? '') && !b.disabled)
      button?.click()
    }, 0)
  }
  window.addEventListener('keydown', onKey, true)
  return () => window.removeEventListener('keydown', onKey, true)
}
