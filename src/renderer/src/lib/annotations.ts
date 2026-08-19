import type { AnnotationMeta, AnnotationType } from '../../../shared/types'

const TAG_FOR: Record<AnnotationType, string> = {
  highlight: 'mark',
  underline: 'u',
  strike: 's',
  bold: 'strong',
  italic: 'em',
  comment: 'span'
}

export const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: '#ffe680',
  green: '#b8f2c1',
  blue: '#bcdcff',
  pink: '#ffc7e0',
  orange: '#ffd3a8'
}

export function newId(): string {
  return 'a' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4)
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, '&#10;')
}

export function unescapeAttr(value: string): string {
  return value
    .replace(/&#10;/g, '\n')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
}

export interface AnnotationInput {
  type: AnnotationType
  color?: string
  note?: string
  author?: string
  id?: string
}

export function openTag(input: AnnotationInput, id: string): string {
  const tag = TAG_FOR[input.type]
  const attrs = [
    `class="mn-a mn-${input.type}"`,
    `data-mn-id="${id}"`,
    `data-mn-type="${input.type}"`,
    input.color ? `data-mn-color="${escapeAttr(input.color)}"` : '',
    input.note ? `data-mn-note="${escapeAttr(input.note)}"` : '',
    input.author ? `data-mn-author="${escapeAttr(input.author)}"` : '',
    `data-mn-at="${new Date().toISOString()}"`
  ]
    .filter(Boolean)
    .join(' ')
  return `<${tag} ${attrs}>`
}

export function closeTag(type: AnnotationType): string {
  return `</${TAG_FOR[type]}>`
}

/* ------------------------------------------------------------ code regions */

/** Byte ranges that must never be annotated (fenced/indented/inline code). */
export function codeRegions(source: string): Array<[number, number]> {
  const regions: Array<[number, number]> = []
  const fence = /^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^\1\2[^\n]*$|$)/gm
  let m: RegExpExecArray | null
  while ((m = fence.exec(source))) regions.push([m.index, m.index + m[0].length])

  const inline = /(`+)(?:(?!\1)[\s\S])*?\1/g
  while ((m = inline.exec(source))) {
    if (!regions.some(([s, e]) => m!.index >= s && m!.index < e)) {
      regions.push([m.index, m.index + m[0].length])
    }
  }
  return regions.sort((a, b) => a[0] - b[0])
}

function overlapsCode(regions: Array<[number, number]>, s: number, e: number): boolean {
  return regions.some(([rs, re]) => s < re && e > rs)
}

/** True when `pos` sits inside an HTML tag (`<...>`) in the source. */
function insideTag(source: string, pos: number): boolean {
  const lt = source.lastIndexOf('<', pos - 1)
  if (lt === -1) return false
  const gt = source.indexOf('>', lt)
  return gt !== -1 && gt >= pos
}

function nudgeOut(source: string, pos: number, dir: 1 | -1): number {
  let p = pos
  let guard = 0
  while (insideTag(source, p) && guard++ < 2000) {
    if (dir === 1) {
      const gt = source.indexOf('>', p)
      p = gt === -1 ? source.length : gt + 1
    } else {
      const lt = source.lastIndexOf('<', p - 1)
      p = lt === -1 ? 0 : lt
    }
  }
  return p
}

/**
 * Splits a source range into per-line, code-free, tag-safe chunks so that the
 * inserted wrapper tags never straddle a block boundary or an existing tag.
 */
export function segmentRange(source: string, start: number, end: number): Array<[number, number]> {
  const regions = codeRegions(source)
  let s = Math.max(0, Math.min(start, source.length))
  let e = Math.max(0, Math.min(end, source.length))
  if (e <= s) return []
  s = nudgeOut(source, s, -1)
  e = nudgeOut(source, e, 1)

  const out: Array<[number, number]> = []
  let cursor = s
  while (cursor < e) {
    let nl = source.indexOf('\n', cursor)
    if (nl === -1 || nl > e) nl = e
    let a = cursor
    let b = nl
    while (a < b && /\s/.test(source[a])) a++
    while (b > a && /\s/.test(source[b - 1])) b--
    // Skip leading block markers so the wrapper stays inside the block content.
    const lineStart = source.lastIndexOf('\n', a - 1) + 1
    if (a === lineStart) {
      const marker = /^(\s*(?:[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|#{1,6}\s+|>\s?))/.exec(source.slice(a, b))
      if (marker) a += marker[1].length
    }
    if (b > a && !overlapsCode(regions, a, b)) out.push([a, b])
    cursor = nl + 1
  }
  return out
}

/** Wraps every segment of the range with an annotation tag. Returns new source. */
export function applyAnnotation(source: string, start: number, end: number, input: AnnotationInput): { source: string; id: string; applied: number } {
  const id = input.id ?? newId()
  const segments = segmentRange(source, start, end)
  if (!segments.length) return { source, id, applied: 0 }

  const open = openTag(input, id)
  const close = closeTag(input.type)
  let out = source
  for (let i = segments.length - 1; i >= 0; i--) {
    const [a, b] = segments[i]
    out = out.slice(0, a) + open + out.slice(a, b) + close + out.slice(b)
  }
  return { source: out, id, applied: segments.length }
}

/* -------------------------------------------------------------- removal */

const TAG_NAMES = ['mark', 'u', 's', 'strong', 'em', 'span']

function findMatchingClose(source: string, tagName: string, from: number): [number, number] | null {
  const re = new RegExp(`<(/?)${tagName}\\b[^>]*>`, 'gi')
  re.lastIndex = from
  let depth = 1
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) {
    if (m[1] === '/') {
      depth--
      if (depth === 0) return [m.index, m.index + m[0].length]
    } else {
      depth++
    }
  }
  return null
}

/** Removes one annotation (all of its segments) by id, keeping the inner text. */
export function removeAnnotation(source: string, id: string): string {
  let out = source
  let guard = 0
  for (;;) {
    if (guard++ > 500) break
    const re = new RegExp(`<(${TAG_NAMES.join('|')})\\b[^>]*data-mn-id="${id}"[^>]*>`, 'i')
    const m = re.exec(out)
    if (!m) break
    const tagName = m[1]
    const openStart = m.index
    const openEnd = m.index + m[0].length
    const close = findMatchingClose(out, tagName, openEnd)
    if (!close) {
      out = out.slice(0, openStart) + out.slice(openEnd)
      continue
    }
    out = out.slice(0, openStart) + out.slice(openEnd, close[0]) + out.slice(close[1])
  }
  return out
}

export function removeAllAnnotations(source: string): string {
  let out = source
  let guard = 0
  for (;;) {
    if (guard++ > 5000) break
    const m = /data-mn-id="([^"]+)"/.exec(out)
    if (!m) break
    const next = removeAnnotation(out, m[1])
    if (next === out) break
    out = next
  }
  return out
}

/* -------------------------------------------------------------- listing */

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`${name}="([^"]*)"`, 'i').exec(tag)
  return m ? unescapeAttr(m[1]) : undefined
}

export function listAnnotations(source: string): AnnotationMeta[] {
  const re = new RegExp(`<(${TAG_NAMES.join('|')})\\b[^>]*data-mn-id="[^"]+"[^>]*>`, 'gi')
  const seen = new Set<string>()
  const out: AnnotationMeta[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) {
    const tag = m[0]
    const id = attr(tag, 'data-mn-id')!
    const close = findMatchingClose(source, m[1], m.index + tag.length)
    const inner = close ? source.slice(m.index + tag.length, close[0]) : ''
    const text = inner.replace(/<[^>]+>/g, '').trim()
    if (seen.has(id)) {
      const existing = out.find((a) => a.id === id)
      if (existing) existing.text = `${existing.text} ${text}`.trim()
      continue
    }
    seen.add(id)
    out.push({
      id,
      type: (attr(tag, 'data-mn-type') as AnnotationMeta['type']) ?? 'highlight',
      color: attr(tag, 'data-mn-color'),
      note: attr(tag, 'data-mn-note'),
      author: attr(tag, 'data-mn-author'),
      at: attr(tag, 'data-mn-at'),
      text
    })
  }
  return out
}

export function updateNote(source: string, id: string, note: string): string {
  const re = new RegExp(`(<(?:${TAG_NAMES.join('|')})\\b[^>]*data-mn-id="${id}")([^>]*)(>)`, 'gi')
  return source.replace(re, (_full, head: string, rest: string, tail: string) => {
    const cleaned = rest.replace(/\s*data-mn-note="[^"]*"/i, '')
    const added = note ? ` data-mn-note="${escapeAttr(note)}"` : ''
    return `${head}${cleaned}${added}${tail}`
  })
}
