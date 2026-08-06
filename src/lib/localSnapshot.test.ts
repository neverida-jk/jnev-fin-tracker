import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import db from '../db'
import {
  MAX_SNAPSHOT_GENERATIONS,
  listLocalSnapshots,
  markSnapshotTakenToday,
  restoreLocalSnapshot,
  shouldTakeSnapshotToday,
  takeLocalSnapshot,
} from './localSnapshot'

async function clearAllTables() {
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      await table.clear()
    }
  })
}

// Mirrors the localStorage mock aiEngine.test.ts installs for the equivalent
// isLocalModelEnabled/setLocalModelEnabled pattern — the test suite runs
// under `environment: 'node'` (vitest.config.ts), so localStorage doesn't
// exist unless explicitly installed on globalThis.
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

beforeEach(async () => {
  await clearAllTables()
  installLocalStorageMock()
})

afterEach(async () => {
  await clearAllTables()
  delete (globalThis as Record<string, unknown>).localStorage
  vi.useRealTimers()
})

describe('shouldTakeSnapshotToday / markSnapshotTakenToday', () => {
  it('defaults to true (attempt a snapshot) before anything has been recorded', () => {
    expect(shouldTakeSnapshotToday()).toBe(true)
  })

  it('returns false for the rest of the day once marked taken', () => {
    markSnapshotTakenToday()
    expect(shouldTakeSnapshotToday()).toBe(false)
  })

  it('returns true again once the calendar date advances', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'))
    markSnapshotTakenToday()
    expect(shouldTakeSnapshotToday()).toBe(false)

    vi.setSystemTime(new Date('2026-01-02T00:00:01.000Z'))
    expect(shouldTakeSnapshotToday()).toBe(true)
  })

  it('defaults to true and does not throw when localStorage is unavailable', () => {
    delete (globalThis as Record<string, unknown>).localStorage
    expect(() => markSnapshotTakenToday()).not.toThrow()
    expect(shouldTakeSnapshotToday()).toBe(true)
  })
})

describe('takeLocalSnapshot', () => {
  it('writes a new row containing an export of the current data', async () => {
    await db.accounts.add({
      id: undefined as unknown as number,
      name: 'GCash',
      type: 'checking',
      startingBalance: 500,
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    await takeLocalSnapshot()

    const rows = await db.localSnapshots.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0].schemaVersion).toBe(1)
    const accountsInSnapshot = rows[0].tables.accounts as { name: string }[]
    expect(accountsInSnapshot).toHaveLength(1)
    expect(accountsInSnapshot[0].name).toBe('GCash')
  })

  it('marks the snapshot as taken today as a side effect', async () => {
    expect(shouldTakeSnapshotToday()).toBe(true)
    await takeLocalSnapshot()
    expect(shouldTakeSnapshotToday()).toBe(false)
  })

  it('takes a snapshot even if shouldTakeSnapshotToday() would already report false (gating is the caller\'s job)', async () => {
    markSnapshotTakenToday()
    expect(shouldTakeSnapshotToday()).toBe(false)

    await takeLocalSnapshot()

    expect(await db.localSnapshots.count()).toBe(1)
  })

  it('prunes down to MAX_SNAPSHOT_GENERATIONS, keeping only the newest generations', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const totalTaken = MAX_SNAPSHOT_GENERATIONS + 2

    for (let day = 1; day <= totalTaken; day++) {
      vi.setSystemTime(new Date(Date.UTC(2026, 0, day)))
      await takeLocalSnapshot()
    }

    const rows = await db.localSnapshots.orderBy('createdAt').toArray()
    expect(rows).toHaveLength(MAX_SNAPSHOT_GENERATIONS)

    // Only the newest MAX_SNAPSHOT_GENERATIONS survive — i.e. the last N days
    // taken, in ascending order.
    const survivingDays = rows.map((row) => new Date(row.createdAt).getUTCDate())
    const expectedDays = Array.from(
      { length: MAX_SNAPSHOT_GENERATIONS },
      (_, i) => totalTaken - MAX_SNAPSHOT_GENERATIONS + 1 + i,
    )
    expect(survivingDays).toEqual(expectedDays)
  })
})

describe('listLocalSnapshots', () => {
  it('returns an empty list when no snapshot has ever been taken', async () => {
    expect(await listLocalSnapshots()).toEqual([])
  })

  it('returns snapshots newest first', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 1)))
    await takeLocalSnapshot()
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 2)))
    await takeLocalSnapshot()
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 3)))
    await takeLocalSnapshot()

    const list = await listLocalSnapshots()
    expect(list).toHaveLength(3)
    expect(list.map((s) => new Date(s.createdAt).getUTCDate())).toEqual([3, 2, 1])
  })
})

describe('restoreLocalSnapshot', () => {
  it('restores data captured in a snapshot, replacing whatever the db holds now', async () => {
    const originalAccountId = await db.accounts.add({
      id: undefined as unknown as number,
      name: 'Original',
      type: 'checking',
      startingBalance: 100,
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    await takeLocalSnapshot()
    const [{ id: snapshotId }] = await listLocalSnapshots()

    // Mutate the live db after the snapshot was taken.
    await db.accounts.delete(originalAccountId)
    await db.accounts.add({
      id: undefined as unknown as number,
      name: 'Mutated',
      type: 'cash',
      startingBalance: 999,
      createdAt: '2026-02-01T00:00:00.000Z',
    })

    await restoreLocalSnapshot(snapshotId)

    const accounts = await db.accounts.toArray()
    expect(accounts.map((a) => a.name)).toEqual(['Original'])
  })

  it('throws a clear error for a nonexistent snapshot id', async () => {
    await expect(restoreLocalSnapshot(9999)).rejects.toThrow('Local snapshot 9999 not found.')
  })

  it('does not wipe the local snapshot history table itself while restoring', async () => {
    await takeLocalSnapshot()
    const [{ id: snapshotId }] = await listLocalSnapshots()

    await restoreLocalSnapshot(snapshotId)

    expect(await db.localSnapshots.count()).toBe(1)
  })
})
