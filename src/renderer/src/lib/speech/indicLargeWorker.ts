/**
 * The larger Indian-language model: AI4Bharat's IndicConformer 600M,
 * multilingual (22 languages in one ~700 MB download), decoded with its
 * RNN-T head, which is more accurate than the CTC head the per-language
 * models use. Slower, so it is the "Accurate" choice for Indian languages.
 *
 * Pipeline (as in AI4Bharat's own model_onnx.py):
 *   log-mel (80) → encoder → joint_enc
 *   for each encoder frame: prediction network (rnnt_decoder) → joint_pred,
 *   added to the frame → joint_pre_net → joint_post_net_<language> →
 *   best token; repeat on the frame until blank (at most 10 symbols).
 *
 * Messages are the same as indicWorker.ts.
 *
 * Kept identical across the Windows app and the web app.
 */
import * as ort from 'onnxruntime-web/webgpu'
import { logMel } from './melFeatures'
import { cachedBytes, cachedText } from './modelCache'

const BASE = 'https://huggingface.co/yashwork-byte/indic-conformer-600m-int8-onnx/resolve/main/'
const BLANK = 256
const SOS = 256
const MAX_SYMBOLS = 10
const PRED_LAYERS = 2
const PRED_HIDDEN = 640

const post = (m: unknown): void => (self as unknown as Worker).postMessage(m)
const progress = (file: string, loaded: number, total: number): void => post({ type: 'progress', file, loaded, total })

let lang = 'hi'
let vocab: string[] = []
const s: Record<string, ort.InferenceSession> = {}

async function session(name: string): Promise<ort.InferenceSession> {
  if (!s[name]) s[name] = await ort.InferenceSession.create(await cachedBytes(`${BASE}assets/${name}.onnx`, `${name}.onnx`, progress), { executionProviders: ['wasm'] })
  return s[name]
}

async function load(language: string, wasmPaths: string): Promise<void> {
  ort.env.wasm.wasmPaths = wasmPaths
  const isolated = (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated
  ort.env.wasm.numThreads = isolated ? Math.min(8, navigator.hardwareConcurrency || 4) : 1
  lang = language
  const all = JSON.parse(await cachedText(`${BASE}assets/vocab.json`, 'vocab.json', progress)) as Record<string, string[]>
  vocab = all[language] ?? []
  if (!vocab.length) throw new Error(`This model has no ${language} vocabulary.`)
  // Small parts first, so a slow connection shows the big one last.
  for (const n of ['joint_enc', 'joint_pred', 'joint_pre_net', `joint_post_net_${language}`, 'rnnt_decoder', 'encoder']) await session(n)
}

const t = (type: 'float32' | 'int32' | 'int64', data: Float32Array | Int32Array | BigInt64Array, dims: number[]): ort.Tensor =>
  new ort.Tensor(type, data as Float32Array<ArrayBuffer>, dims)

/** [1, A, B] → [1, B, A] */
function transpose12(x: Float32Array, a: number, b: number): Float32Array {
  const out = new Float32Array(a * b)
  for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) out[j * a + i] = x[i * b + j]
  return out
}

async function transcribe(audio: Float32Array): Promise<string> {
  const { data, frames } = logMel(audio, 80)
  const enc = await (await session('encoder')).run({ audio_signal: t('float32', data, [1, 80, frames]), length: t('int64', BigInt64Array.from([BigInt(frames)]), [1]) })
  const outputs = enc['outputs']
  const [, D, T] = outputs.dims as number[]
  const je = await (await session('joint_enc')).run({ input: t('float32', transpose12(outputs.data as Float32Array, D, T), [1, T, D]) })
  const jointEnc = je['output']
  const H = (jointEnc.dims as number[])[2]
  const jed = jointEnc.data as Float32Array

  const dec = await session('rnnt_decoder')
  const jp = await session('joint_pred')
  const pre = await session('joint_pre_net')
  const postNet = await session(`joint_post_net_${lang}`)

  const hyp: number[] = [SOS]
  let st0: Float32Array = new Float32Array(PRED_LAYERS * PRED_HIDDEN)
  let st1: Float32Array = new Float32Array(PRED_LAYERS * PRED_HIDDEN)
  // The prediction network depends only on the last token, so its output is
  // reused across frames until a token is emitted.
  let gCache: { token: number; g: Float32Array; s0: Float32Array; s1: Float32Array } | null = null

  for (let f = 0; f < T; f++) {
    const frame = jed.subarray(f * H, (f + 1) * H)
    for (let added = 0; added < MAX_SYMBOLS; added++) {
      const last = hyp[hyp.length - 1]
      if (!gCache || gCache.token !== last) {
        const r: ort.InferenceSession.OnnxValueMapType = await dec.run({
          targets: t('int32', Int32Array.from([last]), [1, 1]),
          target_length: t('int32', Int32Array.from([1]), [1]),
          'states.1': t('float32', st0, [PRED_LAYERS, 1, PRED_HIDDEN]),
          'onnx::Slice_3': t('float32', st1, [PRED_LAYERS, 1, PRED_HIDDEN])
        })
        const g: ort.Tensor = r['outputs'] as ort.Tensor
        const [, gH, gT] = g.dims as number[]
        const gp: ort.InferenceSession.OnnxValueMapType = await jp.run({ input: t('float32', transpose12(g.data as Float32Array, gH, gT), [1, gT, gH]) })
        gCache = {
          token: last,
          g: (gp['output'] as ort.Tensor).data as Float32Array,
          s0: (r['states'] as ort.Tensor).data as Float32Array,
          s1: (r['162'] as ort.Tensor).data as Float32Array
        }
      }
      const joint = new Float32Array(H)
      for (let i = 0; i < H; i++) joint[i] = frame[i] + gCache.g[i]
      const p = await pre.run({ input: t('float32', joint, [1, 1, H]) })
      const logits = (await postNet.run({ input: p['output'] }))['output'].data as Float32Array
      let best = 0
      for (let i = 1; i < logits.length; i++) if (logits[i] > logits[best]) best = i
      if (best === BLANK) break
      hyp.push(best)
      st0 = gCache.s0
      st1 = gCache.s1
    }
  }
  return hyp
    .slice(1)
    .map((i) => vocab[i] ?? '')
    .join('')
    .replace(/▁/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

let loading: Promise<void> | null = null

self.onmessage = async (e: MessageEvent<{ type: string; [k: string]: unknown }>) => {
  const m = e.data
  if (m.type === 'load') {
    try {
      loading ??= load(String(m.language), String(m.wasmPaths))
      await loading
      post({ type: 'ready', device: 'wasm' })
    } catch (err) {
      loading = null
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
    return
  }
  try {
    post({ type: 'result', id: m.id, text: await transcribe(m.audio as Float32Array) })
  } catch (err) {
    post({ type: 'error', id: m.id, message: err instanceof Error ? err.message : String(err) })
  }
}
