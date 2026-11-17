/**
 * Links typed by the reader.
 *
 * "astrology.suprasuta.in" written as a link had no scheme, so the browser
 * read it as a page of the app itself (localhost:5180/astrology.suprasuta.in)
 * and nothing opened. A web address without its https:// is the common case,
 * so it is completed here, both when a link is inserted and when an older one
 * is clicked.
 */

const SCHEME = /^[a-z][a-z0-9+.-]*:/i
const EMAIL = /^[^\s@/]+@[^\s@/]+\.[a-z]{2,}$/i
/** Looks like a web address: www.…, or a host name with a dot and a top-level domain. */
const HOSTISH = /^(www\.)?([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?([/?#].*)?$/i
/** File names that look like host names and must stay files: readme.md, notes.txt… */
const FILE_EXT = /\.(md|markdown|txt|pdf|docx?|xlsx?|pptx?|odt|ods|epub|png|jpe?g|gif|svg|webp|x?html?|xml|json|csv|tsv|zip|js|ts|css|py|mp3|m4b|mp4)$/i

/** The address to store for what the reader typed. */
export function normaliseUrl(input: string): string {
  const s = input.trim()
  if (!s) return ''
  if (SCHEME.test(s) || s.startsWith('#') || s.startsWith('/') || s.startsWith('./') || s.startsWith('../')) return s
  if (EMAIL.test(s)) return `mailto:${s}`
  if (HOSTISH.test(s) && (s.startsWith('www.') || !FILE_EXT.test(s.split(/[?#]/)[0]))) return `https://${s}`
  return s
}

/** Where a clicked link should go: an outside address to open in the browser, a place in the document, or nothing. */
export function linkTarget(written: string): { kind: 'external'; url: string } | { kind: 'anchor'; id: string } | { kind: 'none' } {
  const href = written.trim()
  if (href.startsWith('#')) return { kind: 'anchor', id: decodeURIComponent(href.slice(1)) }
  const url = normaliseUrl(href)
  if (/^(https?:|mailto:|tel:)/i.test(url)) return { kind: 'external', url }
  return { kind: 'none' }
}

/** Markdown for a link; addresses with spaces or brackets are wrapped in <…> so they stay one link. */
export function markdownLink(label: string, url: string): string {
  const text = (label.trim() || url.replace(/^(https?:\/\/|mailto:)/i, '').replace(/\/$/, '')).replace(/([[\]])/g, '\\$1')
  const target = /[\s()<>]/.test(url) ? `<${url.replace(/[<>]/g, encodeURIComponent)}>` : url
  return `[${text}](${target})`
}
