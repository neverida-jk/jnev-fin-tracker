import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import db from '../db'
import { BACKUP_SCHEMA_VERSION, exportBackup, importBackup } from './backup'

async function clearAllTables() {
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      await table.clear()
    }
  })
}

beforeEach(async () => {
  await clearAllTables()
})

afterEach(async () => {
  await clearAllTables()
})

describe('exportBackup / importBackup round trip', () => {
  it('reproduces the same rows across every table after export → clear → import', async () => {
    const accountId = await db.accounts.add({
      id: undefined as unknown as number,
      name: 'GCash',
      type: 'checking',
      startingBalance: 500,
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    const categoryId = await db.categories.add({
      id: undefined as unknown as number,
      name: 'Groceries',
      kind: 'expense',
      color: '#f97316',
    })
    await db.transactions.add({
      id: undefined as unknown as number,
      accountId,
      categoryId,
      amount: 250,
      date: '2026-07-01',
      note: 'weekly shopping',
      createdAt: '2026-07-01T00:00:00.000Z',
    })

    const backup = await exportBackup()
    expect(backup.schemaVersion).toBe(BACKUP_SCHEMA_VERSION)

    const beforeAccounts = await db.accounts.toArray()
    const beforeCategories = await db.categories.toArray()
    const beforeTransactions = await db.transactions.toArray()

    await clearAllTables()
    expect(await db.accounts.count()).toBe(0)

    await importBackup(backup)

    expect(await db.accounts.toArray()).toEqual(beforeAccounts)
    expect(await db.categories.toArray()).toEqual(beforeCategories)
    expect(await db.transactions.toArray()).toEqual(beforeTransactions)
  })

  it('replaces existing data rather than merging with it', async () => {
    await db.accounts.add({
      id: undefined as unknown as number,
      name: 'Stale',
      type: 'cash',
      startingBalance: 1,
      createdAt: '',
    })
    const backup = await exportBackup() // captures "Stale"

    // Now mutate the live DB so it diverges from the captured backup.
    await clearAllTables()
    await db.accounts.add({
      id: undefined as unknown as number,
      name: 'ShouldBeWipedOut',
      type: 'cash',
      startingBalance: 999,
      createdAt: '',
    })

    await importBackup(backup)

    const accounts = await db.accounts.toArray()
    expect(accounts.map((a) => a.name)).toEqual(['Stale'])
  })

  it('rejects a file missing the required backup shape', async () => {
    await expect(importBackup({})).rejects.toThrow('not a valid finance-tracker backup')
    await expect(importBackup({ schemaVersion: 1 })).rejects.toThrow('not a valid finance-tracker backup')
    await expect(importBackup({ schemaVersion: 1, exportedAt: 'x', tables: { accounts: 'not-an-array' } })).rejects.toThrow(
      'not a valid finance-tracker backup',
    )
  })

  it('rejects a backup that references an unknown table', async () => {
    await expect(
      importBackup({ schemaVersion: 1, exportedAt: new Date().toISOString(), tables: { bogusTable: [] } }),
    ).rejects.toThrow('unknown table')
  })

  it('does not partially apply a rejected import', async () => {
    await db.accounts.add({
      id: undefined as unknown as number,
      name: 'Untouched',
      type: 'cash',
      startingBalance: 1,
      createdAt: '',
    })
    await expect(
      importBackup({ schemaVersion: 1, exportedAt: new Date().toISOString(), tables: { accounts: [], bogusTable: [] } }),
    ).rejects.toThrow()
    const accounts = await db.accounts.toArray()
    expect(accounts.map((a) => a.name)).toEqual(['Untouched'])
  })
})

describe('exportBackup / importBackup exclude the local-snapshots table', () => {
  it('exportBackup omits localSnapshots entirely, even when history exists', async () => {
    await db.localSnapshots.add({
      id: undefined as unknown as number,
      createdAt: '2026-01-01T00:00:00.000Z',
      schemaVersion: 1,
      tables: { accounts: [] },
    })

    const backup = await exportBackup()

    expect(Object.keys(backup.tables)).not.toContain('localSnapshots')
  })

  it('importBackup does not flag a backup file for omitting localSnapshots as an unknown table', async () => {
    // A real exported backup never has a localSnapshots key (see test
    // above), so this shape is exactly what importBackup is normally fed.
    await expect(
      importBackup({ schemaVersion: 1, exportedAt: new Date().toISOString(), tables: { accounts: [] } }),
    ).resolves.not.toThrow()
  })

  it('importBackup leaves existing local snapshot history completely untouched', async () => {
    const snapshotId = await db.localSnapshots.add({
      id: undefined as unknown as number,
      createdAt: '2026-01-01T00:00:00.000Z',
      schemaVersion: 1,
      tables: { accounts: [] },
    })

    await importBackup({
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      tables: { accounts: [] },
    })

    expect(await db.localSnapshots.get(snapshotId)).toMatchObject({
      createdAt: '2026-01-01T00:00:00.000Z',
      schemaVersion: 1,
      tables: { accounts: [] },
    })
    expect(await db.localSnapshots.count()).toBe(1)
  })
})
