/**
 * Model files for the speech workers: downloaded once, with progress, and
 * kept in the browser cache inside the app's own profile, so a language that
 * has been used before loads from disk with no download.
 *
 * Kept identical across the Windows app and the web app.
 */

export const INDIC_CACHE = 'indic-asr-cache'

export async function cachedBytes(
  url: string,
  file: string,
  onProgress: (file: string, loaded: number, total: number) => void
): Promise<Uint8Array> {
  const cache = await caches.open(INDIC_CACHE)
  const hit = await cache.match(url)
  if (hit) return new Uint8Array(await hit.arrayBuffer())
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`Could not download the speech model (${res.status}).`)
  const total = Number(res.headers.get('content-length') ?? 0)
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    loaded += value.length
    onProgress(file, loaded, total)
  }
  const bytes = new Uint8Array(loaded)
  let at = 0
  for (const p of parts) {
    bytes.set(p, at)
    at += p.length
  }
  await cache.put(url, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(loaded) } }))
  return bytes
}

export async function cachedText(url: string, file: string, onProgress: (file: string, loaded: number, total: number) => void): Promise<string> {
  return new TextDecoder().decode(await cachedBytes(url, file, onProgress))
}
