import { describe, it, expect } from 'vitest'
import { isGpuLost } from '../src/renderer/src/lib/speech/naturalVoice'

describe('natural voice recovery', () => {
  it('recognises a lost graphics connection', () => {
    expect(
      isGpuLost(
        new Error(
          "Failed to call OrtRun(). ERROR_CODE: 1, ERROR_MESSAGE: webgpu::BufferManager::Download Failed to download data from buffer. wgpu::MapAsyncStatus value: 4, message: Failed to execute 'mapAsync' on 'GPUBuffer': [Device] is lost."
        )
      )
    ).toBe(true)
    expect(isGpuLost(new Error('Failed to fetch'))).toBe(false)
    expect(isGpuLost('Skipped.')).toBe(false)
  })
})
