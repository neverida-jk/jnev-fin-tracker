import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { disableLock, isCryptoSupported, isLockEnabled, setPin, verifyPin } from './appLock'

// Mirrors aiEngine.test.ts / notifications.test.ts: localStorage and crypto
// don't exist by default under vitest's node environment, so each test
// installs exactly the shape it needs.

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

let localStorageStore: Map<string, string>

beforeEach(() => {
  localStorageStore = installLocalStorageMock()
})

afterEach(() => {
  delete (globalThis as Record<string, unknown>).localStorage
})

describe('isCryptoSupported', () => {
  it('is true under Node/vitest, which provides Web Crypto', () => {
    expect(isCryptoSupported()).toBe(true)
  })
})

describe('isLockEnabled', () => {
  it('is false before any PIN has been set', () => {
    expect(isLockEnabled()).toBe(false)
  })

  it('is true once a PIN has been set', async () => {
    await setPin('1234')
    expect(isLockEnabled()).toBe(true)
  })
})

describe('setPin', () => {
  it('rejects a PIN shorter than 4 digits', async () => {
    await expect(setPin('123')).rejects.toThrow('Use exactly 4 digits.')
    expect(isLockEnabled()).toBe(false)
  })

  it('rejects a PIN longer than 4 digits', async () => {
    await expect(setPin('123456')).rejects.toThrow('Use exactly 4 digits.')
  })

  it('rejects a non-numeric PIN', async () => {
    await expect(setPin('12ab')).rejects.toThrow('Use exactly 4 digits.')
  })

  it('accepts a 4-digit numeric PIN', async () => {
    await expect(setPin('4242')).resolves.toBeUndefined()
    expect(isLockEnabled()).toBe(true)
  })
})

describe('verifyPin', () => {
  it('returns true when no lock is set — nothing to fail against', async () => {
    expect(await verifyPin('0000')).toBe(true)
  })

  it('returns true for the correct PIN and false for a wrong one', async () => {
    await setPin('1357')
    expect(await verifyPin('1357')).toBe(true)
    expect(await verifyPin('7531')).toBe(false)
  })

  it('never stores the PIN itself in localStorage, only a hash', async () => {
    await setPin('9999')
    expect(Array.from(localStorageStore.values())).not.toContain('9999')
  })
})

describe('disableLock', () => {
  it('turns the lock off without needing the PIN', async () => {
    await setPin('2468')
    disableLock()
    expect(isLockEnabled()).toBe(false)
    expect(await verifyPin('anything')).toBe(true)
  })
})
