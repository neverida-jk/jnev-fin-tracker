import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  detectNativeAi,
  generateNarrative,
  generateWithLocalModel,
  isLocalModelEnabled,
  setLocalModelEnabled,
} from './aiEngine'

// aiEngine.ts reads `localStorage` and the native-AI globals (`LanguageModel`
// / `window.ai` / `self.ai`) straight off `globalThis`, and lazily
// dynamic-imports '@xenova/transformers' inside generateWithLocalModel. The
// vitest config runs these tests under `environment: 'node'`
// (vitest.config.ts), so none of those exist by default — every test below
// explicitly installs/removes exactly the shape it needs so runs stay
// deterministic and hermetic. `@xenova/transformers` is mocked unconditionally
// for the whole file (via vi.hoisted + vi.mock, below) so no test — even one
// that mistakenly enables the local-model tier — can ever trigger the real
// package, a real model download, or any network access.

const { pipelineMock } = vi.hoisted(() => ({ pipelineMock: vi.fn() }))
vi.mock('@xenova/transformers', () => ({ pipeline: pipelineMock }))

function installLocalStorageMock(): Map<string, string> {
  const store = new Map<string, string>()
  const mock = {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size
    },
  }
  ;(globalThis as Record<string, unknown>).localStorage = mock
  return store
}

function installLanguageModel(shape: Record<string, unknown>) {
  (globalThis as Record<string, unknown>).LanguageModel = shape
}

function installLegacyAi(namespace: 'languageModel' | 'assistant', shape: Record<string, unknown>) {
  (globalThis as Record<string, unknown>).ai = { [namespace]: shape }
}

let localStorageStore: Map<string, string>

beforeEach(() => {
  localStorageStore = installLocalStorageMock()
  pipelineMock.mockReset()
  pipelineMock.mockRejectedValue(new Error('pipeline should not be called unless a test explicitly configures it'))
})

afterEach(() => {
  delete (globalThis as Record<string, unknown>).localStorage
  delete (globalThis as Record<string, unknown>).LanguageModel
  delete (globalThis as Record<string, unknown>).ai
  vi.restoreAllMocks()
})

describe('isLocalModelEnabled / setLocalModelEnabled', () => {
  it('defaults to disabled before anything has been set', () => {
    expect(isLocalModelEnabled()).toBe(false)
  })

  it('round-trips true through localStorage', () => {
    setLocalModelEnabled(true)
    expect(isLocalModelEnabled()).toBe(true)
    expect(Array.from(localStorageStore.values())).toContain('true')
  })

  it('round-trips back to false after being enabled', () => {
    setLocalModelEnabled(true)
    setLocalModelEnabled(false)
    expect(isLocalModelEnabled()).toBe(false)
    expect(Array.from(localStorageStore.values())).toContain('false')
  })

  it('reads live from localStorage rather than caching an in-memory flag', () => {
    setLocalModelEnabled(true)
    expect(isLocalModelEnabled()).toBe(true)

    // Mutate the underlying storage directly (bypassing setLocalModelEnabled)
    // — if isLocalModelEnabled() were backed by a cached module-level
    // variable instead of a real localStorage read, this would still report
    // true and the assertion below would fail.
    const [key] = localStorageStore.keys()
    expect(key).toBeDefined()
    localStorageStore.set(key as string, 'false')
    expect(isLocalModelEnabled()).toBe(false)
  })

  it('safely defaults to false and does not throw when localStorage is unavailable', () => {
    delete (globalThis as Record<string, unknown>).localStorage
    expect(() => setLocalModelEnabled(true)).not.toThrow()
    expect(isLocalModelEnabled()).toBe(false)
  })
})

describe('detectNativeAi', () => {
  it('returns false when no native AI global exists', async () => {
    await expect(detectNativeAi()).resolves.toBe(false)
  })

  it('returns true when the LanguageModel.availability() reports "available"', async () => {
    installLanguageModel({ availability: () => Promise.resolve('available') })
    await expect(detectNativeAi()).resolves.toBe(true)
  })

  it('returns true when LanguageModel.availability() reports "downloadable"', async () => {
    installLanguageModel({ availability: () => Promise.resolve('downloadable') })
    await expect(detectNativeAi()).resolves.toBe(true)
  })

  it('returns false when LanguageModel.availability() reports "unavailable"', async () => {
    installLanguageModel({ availability: () => Promise.resolve('unavailable') })
    await expect(detectNativeAi()).resolves.toBe(false)
  })

  it('falls back to checking for LanguageModel.create() when availability() is missing', async () => {
    installLanguageModel({ create: () => Promise.resolve({ prompt: async () => 'hi' }) })
    await expect(detectNativeAi()).resolves.toBe(true)
  })

  it('returns false without crashing when LanguageModel.availability() rejects', async () => {
    installLanguageModel({ availability: () => Promise.reject(new Error('flag disabled')) })
    await expect(detectNativeAi()).resolves.toBe(false)
  })

  it('detects the legacy ai.languageModel.capabilities() shape', async () => {
    installLegacyAi('languageModel', { capabilities: () => Promise.resolve({ available: 'readily' }) })
    await expect(detectNativeAi()).resolves.toBe(true)
  })

  it('detects the legacy ai.assistant.capabilities() shape reporting "after-download"', async () => {
    installLegacyAi('assistant', { capabilities: () => Promise.resolve({ available: 'after-download' }) })
    await expect(detectNativeAi()).resolves.toBe(true)
  })

  it('returns false for the legacy shape when capabilities() reports "no"', async () => {
    installLegacyAi('assistant', { capabilities: () => Promise.resolve({ available: 'no' }) })
    await expect(detectNativeAi()).resolves.toBe(false)
  })
})

describe('generateWithLocalModel', () => {
  it('throws immediately, without calling the pipeline, when the local model is not enabled', async () => {
    await expect(generateWithLocalModel('hello')).rejects.toThrow(/not enabled/i)
    expect(pipelineMock).not.toHaveBeenCalled()
  })

  it('returns the generated text when enabled and the pipeline resolves an array result', async () => {
    setLocalModelEnabled(true)
    const generator = vi.fn().mockResolvedValue([{ generated_text: 'a rephrased recap' }])
    pipelineMock.mockResolvedValue(generator)

    await expect(generateWithLocalModel('summarize this')).resolves.toBe('a rephrased recap')
    expect(generator).toHaveBeenCalledWith('summarize this', { max_new_tokens: 120 })
  })

  it('also accepts a single (non-array) pipeline result', async () => {
    setLocalModelEnabled(true)
    const generator = vi.fn().mockResolvedValue({ generated_text: '  trimmed text  ' })
    pipelineMock.mockResolvedValue(generator)

    await expect(generateWithLocalModel('prompt')).resolves.toBe('trimmed text')
  })

  it('throws when the pipeline returns no usable text', async () => {
    setLocalModelEnabled(true)
    const generator = vi.fn().mockResolvedValue([{ generated_text: '   ' }])
    pipelineMock.mockResolvedValue(generator)

    await expect(generateWithLocalModel('prompt')).rejects.toThrow(/no usable text/i)
  })
})

describe('generateNarrative', () => {
  it('falls back to the supplied fallbackText with tier "template" when native AI is not detected and the local model is not enabled', async () => {
    const result = await generateNarrative('some prompt', 'the deterministic fallback text')
    expect(result).toEqual({ text: 'the deterministic fallback text', tier: 'template' })
    expect(pipelineMock).not.toHaveBeenCalled()
  })

  it('uses the native tier when native AI is available and responds', async () => {
    installLanguageModel({
      availability: () => Promise.resolve('available'),
      create: () => Promise.resolve({ prompt: async (p: string) => `native reply to: ${p}` }),
    })
    const result = await generateNarrative('some prompt', 'fallback text')
    expect(result).toEqual({ text: 'native reply to: some prompt', tier: 'native' })
  })

  it('falls back to template when native AI is detected but session creation throws', async () => {
    installLanguageModel({
      availability: () => Promise.resolve('available'),
      create: () => {
        throw new Error('user declined the on-device download prompt')
      },
    })
    const result = await generateNarrative('some prompt', 'fallback text')
    expect(result).toEqual({ text: 'fallback text', tier: 'template' })
  })

  it('falls back to template when the native session returns only blank text', async () => {
    installLanguageModel({
      availability: () => Promise.resolve('available'),
      create: () => Promise.resolve({ prompt: async () => '   ' }),
    })
    const result = await generateNarrative('some prompt', 'fallback text')
    expect(result).toEqual({ text: 'fallback text', tier: 'template' })
  })

  it('uses the local-model tier when native AI is unavailable but the local model is enabled and succeeds', async () => {
    setLocalModelEnabled(true)
    const generator = vi.fn().mockResolvedValue([{ generated_text: 'local model recap' }])
    pipelineMock.mockResolvedValue(generator)

    const result = await generateNarrative('some prompt', 'fallback text')
    expect(result).toEqual({ text: 'local model recap', tier: 'local-model' })
  })

  it('falls back to template when the local model is enabled but the pipeline fails', async () => {
    setLocalModelEnabled(true)
    pipelineMock.mockRejectedValue(new Error('model failed to load'))

    const result = await generateNarrative('some prompt', 'fallback text')
    expect(result).toEqual({ text: 'fallback text', tier: 'template' })
  })

  it('prefers the native tier over the local-model tier when both are available', async () => {
    installLanguageModel({
      availability: () => Promise.resolve('available'),
      create: () => Promise.resolve({ prompt: async () => 'native wins' }),
    })
    setLocalModelEnabled(true)
    const generator = vi.fn().mockResolvedValue([{ generated_text: 'local model recap' }])
    pipelineMock.mockResolvedValue(generator)

    const result = await generateNarrative('some prompt', 'fallback text')
    expect(result).toEqual({ text: 'native wins', tier: 'native' })
    expect(pipelineMock).not.toHaveBeenCalled()
  })
})
