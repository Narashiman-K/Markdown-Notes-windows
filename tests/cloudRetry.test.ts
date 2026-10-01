import { describe, it, expect } from 'vitest'
import { CloudCaller, isTransient } from '../src/renderer/src/lib/convert/cloudRetry'

/** A fake clock: sleeping advances it instantly, and every sleep is recorded. */
function clock() {
  let t = 0
  const slept: number[] = []
  return {
    slept,
    now: () => t,
    sleep: async (ms: number) => {
      slept.push(ms)
      t += ms
    }
  }
}

/** A service that answers `failures` errors with `message`, then succeeds. */
function flaky(failures: number, message: string) {
  let calls = 0
  return {
    get calls() {
      return calls
    },
    call: async () => {
      calls++
      if (calls <= failures) throw new Error(message)
      return `text from call ${calls}`
    }
  }
}

describe('isTransient', () => {
  it('recognises the busy and rate-limit answers providers actually send', () => {
    for (const m of [
      // Verbatim from Gemini, reported from an eight-page scan on 1 Oct 2026.
      'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.',
      'The model is overloaded. Please try again later.',
      'Resource has been exhausted (e.g. check quota).',
      'You exceeded your current quota, please check your plan and billing details.',
      'HTTP 503',
      '429 Too Many Requests',
      'The service is currently unavailable.',
      'Request timed out'
    ]) {
      expect(isTransient(new Error(m)), m).toBe(true)
    }
  })

  it('does not retry what retrying cannot fix', () => {
    for (const m of ['API key not valid. Please pass a valid API key.', 'No Google Gemini API key saved.', 'Invalid image']) {
      expect(isTransient(new Error(m)), m).toBe(false)
    }
  })
})

describe('CloudCaller', () => {
  it('retries a busy service with growing waits, and reports each wait', async () => {
    const c = clock()
    const waits: number[] = []
    const caller = new CloudCaller({ sleep: c.sleep, now: c.now, minGap: 0, onWait: (s) => waits.push(s) })
    const svc = flaky(2, 'The model is overloaded. Please try again later.')
    await expect(caller.run(svc.call)).resolves.toBe('text from call 3')
    expect(svc.calls).toBe(3)
    expect(waits).toEqual([3, 8])
  })

  it('gives up at once on an error retrying cannot fix', async () => {
    const c = clock()
    const caller = new CloudCaller({ sleep: c.sleep, now: c.now, minGap: 0 })
    const svc = flaky(5, 'API key not valid.')
    await expect(caller.run(svc.call)).rejects.toThrow('API key not valid.')
    expect(svc.calls).toBe(1)
    expect(c.slept).toEqual([])
  })

  it('gives up after the last retry, so the caller can fall back to offline', async () => {
    const c = clock()
    const caller = new CloudCaller({ sleep: c.sleep, now: c.now, minGap: 0 })
    const svc = flaky(99, 'HTTP 503')
    await expect(caller.run(svc.call)).rejects.toThrow('HTTP 503')
    expect(svc.calls).toBe(5) // the first try and four retries
    expect(c.slept).toEqual([3_000, 8_000, 20_000, 45_000])
  })

  it('paces back-to-back pages instead of sending a burst', async () => {
    const c = clock()
    const caller = new CloudCaller({ sleep: c.sleep, now: c.now, minGap: 1_500 })
    const svc = flaky(0, '')
    await caller.run(svc.call)
    await caller.run(svc.call)
    await caller.run(svc.call)
    expect(c.slept).toEqual([1_500, 1_500])
  })
})
