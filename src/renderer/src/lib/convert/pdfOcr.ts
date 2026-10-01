/**
 * Reading a scanned PDF: draw each page, then OCR the picture.
 *
 * A scanned PDF is a stack of photographs with no text layer, so pdf.ts finds
 * nothing to extract and reports SCANNED_PDF. Until now that report went
 * straight to the user as an error. Instead, each page is rendered to a canvas
 * at roughly 300 dpi — the resolution Tesseract is trained for — and read the
 * same way an image file is, through one engine loaded once for the whole
 * document.
 *
 * Browser-only, deliberately: rendering a page needs a canvas, which Node does
 * not have without a native module, and this project has none. `canOcrPdf`
 * says whether this environment can do it; where it cannot (the MCP server, the
 * VS Code extension) the SCANNED_PDF report stands as before.
 *
 * The engine follows the user's OCR choice: Gemini when cloud OCR is chosen
 * and a key is present, otherwise offline Tesseract, so a missing key degrades
 * to reading locally rather than to an error.
 */
import * as pdfjs from 'pdfjs-dist'
import type { ConvertResult, ConvertOptions } from './types'
import { titleFrom, tidy } from './normalise'
import { openOfflineReader, type OfflineReader } from './ocr'

/** Pixels across an A4 page at 300 dpi, the width pages are scaled towards. */
const TARGET_WIDTH = 2480

export function canOcrPdf(): boolean {
  return typeof document !== 'undefined'
}

async function renderPage(page: pdfjs.PDFPageProxy): Promise<Blob> {
  const natural = page.getViewport({ scale: 1 })
  // Small pages are scaled up towards 300 dpi; no page is drawn larger than
  // 4x, which bounds memory on an unusually large sheet.
  const scale = Math.min(4, Math.max(2, TARGET_WIDTH / natural.width))
  const viewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This system could not create a drawing surface for the page.')
  // Scans with transparency would otherwise read as black-on-black.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)

  try {
    /*
     * 'print' intent: pdf.js paces on-screen rendering with
     * requestAnimationFrame, which the browser suspends in a background tab.
     * Switching tabs during a long scan would freeze the OCR mid-page until the
     * tab was shown again. Print rendering draws the same page without waiting
     * for frames.
     */
    await page.render({ canvasContext: context, viewport, intent: 'print' }).promise
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not capture the page image.'))), 'image/png')
    )
  } finally {
    // A rendered A4 page is ~35 MB of pixels; let it go before the next one.
    canvas.width = 0
    canvas.height = 0
  }
}

export async function ocrScannedPdf(
  bytes: Uint8Array,
  fileName: string,
  options: ConvertOptions = {}
): Promise<ConvertResult> {
  const { onProgress } = options
  const useCloud = options.ocrMode === 'cloud' && !!options.cloudOcr
  const engine = useCloud ? 'gemini' : 'tesseract'

  const doc = await pdfjs.getDocument({ data: bytes, useWorkerFetch: false }).promise
  const pages = doc.numPages
  let reader: OfflineReader | null = null

  try {
    if (!useCloud) reader = await openOfflineReader(onProgress)

    const texts: string[] = []
    const confidences: number[] = []

    for (let n = 1; n <= pages; n++) {
      const at = (f: number): number => (n - 1 + f) / pages
      onProgress?.(`Scanned PDF — reading page ${n} of ${pages}…`, at(0))

      const page = await doc.getPage(n)
      const image = await renderPage(page)
      page.cleanup()

      if (reader) {
        const { text, confidence } = await reader.read(image, (f) =>
          onProgress?.(`Scanned PDF — reading page ${n} of ${pages}…`, at(f))
        )
        texts.push(text)
        if (text) confidences.push(confidence)
      } else {
        const raw = await options.cloudOcr!(new Uint8Array(await image.arrayBuffer()), 'image/png')
        texts.push(raw.trim().replace(/^```(?:markdown)?\s*\n?/i, '').replace(/\n?```\s*$/i, ''))
      }
    }

    if (!texts.some((t) => t.length > 0)) {
      return {
        ok: false,
        code: 'NO_TEXT',
        error:
          'This is a scanned PDF, and no text could be read from any of its pages. ' +
          (useCloud ? 'The pages may be blank or unreadable.' : 'Offline OCR works best on clear, printed text — cloud OCR may do better.')
      }
    }

    const parts: string[] = [`# ${titleFrom(fileName)}`]
    texts.forEach((text, i) => {
      if (pages > 1) parts.push(`## Page ${i + 1}`)
      parts.push(text || '_No text could be read from this page._')
    })

    const confidence = confidences.length
      ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length)
      : undefined
    const note =
      `\n\n> Read from a scanned PDF by ${useCloud ? 'cloud' : 'offline'} OCR. Check names and figures against the original.` +
      (confidence !== undefined && confidence < 70
        ? ' Offline OCR reported low confidence; cloud OCR would likely read it more accurately.'
        : '')

    return {
      ok: true,
      markdown: tidy(parts) + note,
      meta: { engine, pages, scanned: true, ...(confidence !== undefined ? { confidence } : {}) }
    }
  } finally {
    await reader?.close()
    await doc.destroy()
  }
}
