/**
 * Reading text out of images.
 *
 * Two engines, chosen by the user per conversion:
 *
 *   cloud   — Google Gemini via an injected callback. Better accuracy, and it
 *             can describe charts and diagrams, not just transcribe text.
 *             Needs the user's own API key; the image is sent to Google.
 *   offline — Tesseract.js, bundled. No key, no network, nothing leaves the
 *             machine. Good on clean printed text, weak on anything else, and
 *             it cannot describe visual structure at all.
 *
 * Tesseract is imported lazily so its several megabytes of WASM only load if
 * the user actually chooses offline OCR.
 */
import type { ConvertResult, ConvertOptions } from './types'
import { extensionOf } from './types'
import { titleFrom, tidy } from './normalise'

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff'
}

export function mimeFor(fileName: string): string {
  return MIME[extensionOf(fileName)] ?? 'application/octet-stream'
}

/** Tesseract cannot read every format; convert awkward ones via a canvas. */
async function toPngIfNeeded(bytes: Uint8Array, fileName: string): Promise<Blob> {
  const ext = extensionOf(fileName)
  const blob = new Blob([bytes as unknown as BlobPart], { type: mimeFor(fileName) })
  if (!['tif', 'tiff', 'bmp'].includes(ext)) return blob

  const bitmap = await createImageBitmap(blob).catch(() => null)
  if (!bitmap) return blob
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
  bitmap.close()
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? blob), 'image/png'))
}

async function offlineOcr(
  bytes: Uint8Array,
  fileName: string,
  onProgress?: ConvertOptions['onProgress']
): Promise<ConvertResult> {
  onProgress?.('Loading the offline OCR engine…', 0.1)
  const { createWorker } = await import('tesseract.js')

  const worker = await createWorker('eng', 1, {
    logger: (m: { status?: string; progress?: number }) => {
      if (m.status === 'recognizing text') onProgress?.('Reading text from the image…', 0.3 + (m.progress ?? 0) * 0.7)
    }
  })

  try {
    const image = await toPngIfNeeded(bytes, fileName)
    const { data } = await worker.recognize(image)
    const text = (data.text ?? '').replace(/\n{3,}/g, '\n\n').trim()

    if (!text) {
      return {
        ok: false,
        code: 'NO_TEXT',
        error:
          'No text could be read from this image. Offline OCR works best on clear, printed text — cloud OCR may do better.'
      }
    }

    const confidence = Math.round(data.confidence ?? 0)
    const warning =
      confidence < 70
        ? '\n\n> **Note:** offline OCR reported low confidence on this image. Cloud OCR would likely read it more accurately.'
        : ''

    return {
      ok: true,
      markdown: tidy([`# ${titleFrom(fileName)}`, text]) + warning,
      meta: { engine: 'tesseract', confidence }
    }
  } finally {
    await worker.terminate()
  }
}

export async function convertImage(
  bytes: Uint8Array,
  fileName: string,
  options: ConvertOptions = {}
): Promise<ConvertResult> {
  const mode = options.ocrMode ?? 'cloud'

  if (mode === 'offline') {
    return offlineOcr(bytes, fileName, options.onProgress)
  }

  if (!options.cloudOcr) {
    return {
      ok: false,
      code: 'NO_CLOUD_OCR',
      error: 'Cloud OCR needs a Google Gemini API key, or switch to offline OCR.'
    }
  }

  options.onProgress?.('Sending the image for text extraction…', 0.3)
  try {
    const text = (await options.cloudOcr(bytes, mimeFor(fileName))).trim()
    if (!text) {
      return { ok: false, code: 'NO_TEXT', error: 'The service returned no text for this image.' }
    }
    // Models often wrap the whole answer in a fence; unwrap it.
    const unwrapped = text.replace(/^```(?:markdown)?\s*\n?/i, '').replace(/\n?```\s*$/i, '')
    const hasHeading = /^#\s/.test(unwrapped)
    return {
      ok: true,
      markdown: hasHeading ? unwrapped : tidy([`# ${titleFrom(fileName)}`, unwrapped]),
      meta: { engine: 'gemini' }
    }
  } catch (err) {
    return { ok: false, code: 'CLOUD_FAILED', error: String((err as Error)?.message ?? err) }
  }
}
