/**
 * Log-mel features the way NeMo computes them, for the IndicConformer models
 * (AI4Bharat) that read Indian languages.
 *
 * 16 kHz audio → pre-emphasis 0.97 → 25 ms Hann windows every 10 ms
 * (n_fft 512) → power spectrum → 80 mel bands (Slaney scale and
 * normalisation, 0–8 kHz) → log(x + 2^-24) → each band normalised to zero
 * mean and unit variance over the utterance.
 *
 * Kept identical across the Windows app and the web app.
 */

const SR = 16000
const N_FFT = 512
const WIN = 400
const HOP = 160
const LOG_GUARD = 2 ** -24

function hzToMel(f: number): number {
  // Slaney: linear below 1 kHz, logarithmic above.
  const fSp = 200 / 3
  const minLogHz = 1000
  const minLogMel = minLogHz / fSp
  const logStep = Math.log(6.4) / 27
  return f < minLogHz ? f / fSp : minLogMel + Math.log(f / minLogHz) / logStep
}

function melToHz(m: number): number {
  const fSp = 200 / 3
  const minLogHz = 1000
  const minLogMel = minLogHz / fSp
  const logStep = Math.log(6.4) / 27
  return m < minLogMel ? m * fSp : minLogHz * Math.exp(logStep * (m - minLogMel))
}

let cachedBank: { bands: number; bank: Float32Array[] } | null = null

/** Triangular mel filters over the n_fft/2+1 frequency bins, Slaney-normalised. */
export function melFilterBank(bands: number): Float32Array[] {
  if (cachedBank?.bands === bands) return cachedBank.bank
  const bins = N_FFT / 2 + 1
  const fftFreqs = Array.from({ length: bins }, (_, i) => (i * SR) / N_FFT)
  const melMin = hzToMel(0)
  const melMax = hzToMel(SR / 2)
  const pts = Array.from({ length: bands + 2 }, (_, i) => melToHz(melMin + ((melMax - melMin) * i) / (bands + 1)))
  const bank: Float32Array[] = []
  for (let m = 0; m < bands; m++) {
    const [lo, mid, hi] = [pts[m], pts[m + 1], pts[m + 2]]
    const row = new Float32Array(bins)
    const norm = 2 / (hi - lo)
    for (let k = 0; k < bins; k++) {
      const f = fftFreqs[k]
      const w = Math.max(0, Math.min((f - lo) / (mid - lo), (hi - f) / (hi - mid)))
      row[k] = w * norm
    }
    bank.push(row)
  }
  cachedBank = { bands, bank }
  return bank
}

/** In-place radix-2 FFT of length N_FFT; returns the power spectrum (bins = N/2+1). */
function powerSpectrum(frame: Float32Array, re: Float64Array, im: Float64Array, out: Float32Array): void {
  const n = N_FFT
  re.fill(0)
  im.fill(0)
  for (let i = 0; i < frame.length; i++) re[i] = frame[i]
  // Bit reversal.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = a + len / 2
        const tr = re[b] * cr - im[b] * ci
        const ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
  for (let k = 0; k <= n / 2; k++) out[k] = re[k] * re[k] + im[k] * im[k]
}

/**
 * Features shaped [bands][frames] (row-major, bands first), plus the frame
 * count. NeMo centres frames (pads n_fft/2 on each side).
 */
export function logMel(audio: Float32Array, bands = 80): { data: Float32Array; frames: number } {
  // Pre-emphasis.
  const x = new Float32Array(audio.length)
  x[0] = audio[0] ?? 0
  for (let i = 1; i < audio.length; i++) x[i] = audio[i] - 0.97 * audio[i - 1]

  const pad = N_FFT / 2
  const padded = new Float32Array(x.length + 2 * pad)
  padded.set(x, pad)
  const frames = Math.max(1, Math.floor((padded.length - N_FFT) / HOP) + 1)

  const hann = new Float32Array(WIN)
  for (let i = 0; i < WIN; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WIN)
  const offset = (N_FFT - WIN) >> 1 // window centred in the FFT frame

  const bank = melFilterBank(bands)
  const bins = N_FFT / 2 + 1
  const re = new Float64Array(N_FFT)
  const im = new Float64Array(N_FFT)
  const frame = new Float32Array(N_FFT)
  const spec = new Float32Array(bins)
  const data = new Float32Array(bands * frames)

  for (let t = 0; t < frames; t++) {
    frame.fill(0)
    const start = t * HOP
    for (let i = 0; i < WIN; i++) frame[offset + i] = padded[start + offset + i] * hann[i]
    powerSpectrum(frame, re, im, spec)
    for (let m = 0; m < bands; m++) {
      const row = bank[m]
      let sum = 0
      for (let k = 0; k < bins; k++) sum += row[k] * spec[k]
      data[m * frames + t] = Math.log(sum + LOG_GUARD)
    }
  }

  // Per-band normalisation over time.
  for (let m = 0; m < bands; m++) {
    let mean = 0
    for (let t = 0; t < frames; t++) mean += data[m * frames + t]
    mean /= frames
    let v = 0
    for (let t = 0; t < frames; t++) v += (data[m * frames + t] - mean) ** 2
    const std = Math.sqrt(v / Math.max(1, frames - 1)) + 1e-5
    for (let t = 0; t < frames; t++) data[m * frames + t] = (data[m * frames + t] - mean) / std
  }
  return { data, frames }
}

/** CTC greedy decoding: best token per frame, repeats merged, blanks dropped. */
export function ctcGreedy(logits: Float32Array, frames: number, vocabSize: number, vocab: string[], blank: number): string {
  let out = ''
  let prev = -1
  for (let t = 0; t < frames; t++) {
    let best = 0
    let bestV = -Infinity
    const base = t * vocabSize
    for (let v = 0; v < vocabSize; v++) {
      const s = logits[base + v]
      if (s > bestV) {
        bestV = s
        best = v
      }
    }
    if (best !== prev && best !== blank) out += vocab[best] ?? ''
    prev = best
  }
  return out.replace(/▁/g, ' ').replace(/\s+/g, ' ').trim()
}
