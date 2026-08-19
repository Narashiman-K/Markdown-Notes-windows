/**
 * Authorship constants. `SIGNATURE` is also stamped invisibly into the running
 * DOM, into exported HTML/PDF output and into the packaged image assets, so
 * provenance travels with the app and with anything it produces.
 */
import { APP_DISPLAY_NAME, AUTHOR as BRAND_AUTHOR, LICENCE_NOTE as BRAND_LICENCE, LINKEDIN_URL as BRAND_URL } from '../../../shared/brand'

export const AUTHOR = BRAND_AUTHOR
export const LINKEDIN_URL = BRAND_URL
export const LICENCE_NOTE = BRAND_LICENCE
export const SIGNATURE = AUTHOR
export { APP_DISPLAY_NAME }

/** Hidden marker embedded in exported documents. */
export function signatureComment(): string {
  return `<!--\n  Produced with ${APP_DISPLAY_NAME} — ${LICENCE_NOTE}\n  Author: ${AUTHOR}\n  ${LINKEDIN_URL}\n  mn-signature: ${SIGNATURE}\n-->`
}

/** Plants the signature in the live DOM without showing anything on screen. */
export function installSignature(): void {
  if (typeof document === 'undefined') return

  document.documentElement.setAttribute('data-author', AUTHOR)

  const meta = document.createElement('meta')
  meta.name = 'author'
  meta.content = AUTHOR
  document.head.appendChild(meta)

  const marker = document.createElement('span')
  marker.id = 'mn-signature'
  marker.setAttribute('aria-hidden', 'true')
  marker.dataset.mnIgnore = ''
  marker.dataset.signature = SIGNATURE
  marker.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none'
  marker.textContent = SIGNATURE
  document.body.appendChild(marker)

  document.body.appendChild(document.createComment(` ${APP_DISPLAY_NAME} · ${AUTHOR} · ${LINKEDIN_URL} `))
}
