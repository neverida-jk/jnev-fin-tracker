import db from '../db'

// Bump this if the shape of the exported backup object ever changes in a way
// that requires migration logic on import (e.g. renaming a table).
export const BACKUP_SCHEMA_VERSION = 1

export interface BackupData {
  schemaVersion: number
  exportedAt: string // ISO timestamp
  tables: Record<string, unknown[]>
}

/**
 * Serializes every Dexie table into one JSON-serializable snapshot.
 */
export async function exportBackup(): Promise<BackupData> {
  const entries = await Promise.all(
    db.tables.map(async (table) => [table.name, await table.toArray()] as const),
  )

  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    tables: Object.fromEntries(entries),
  }
}

function isBackupData(data: unknown): data is BackupData {
  if (!data || typeof data !== 'object') return false
  const candidate = data as Record<string, unknown>
  if (typeof candidate.schemaVersion !== 'number') return false
  if (typeof candidate.exportedAt !== 'string') return false
  if (!candidate.tables || typeof candidate.tables !== 'object') return false
  return Object.values(candidate.tables as Record<string, unknown>).every((rows) => Array.isArray(rows))
}

/**
 * Restores a backup produced by exportBackup(), replacing all current data.
 *
 * This is destructive: every table is cleared before the backup's rows are
 * written back. Callers MUST have already confirmed this with the user —
 * this function does not prompt.
 */
export async function importBackup(data: object): Promise<void> {
  if (!isBackupData(data)) {
    throw new Error('This file is not a valid finance-tracker backup.')
  }

  const knownTableNames = new Set(db.tables.map((table) => table.name))
  const unknownTables = Object.keys(data.tables).filter((name) => !knownTableNames.has(name))
  if (unknownTables.length > 0) {
    throw new Error(`Backup references unknown table(s): ${unknownTables.join(', ')}`)
  }

  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      const rows = data.tables[table.name]
      await table.clear()
      if (rows && rows.length > 0) {
        await table.bulkPut(rows)
      }
    }
  })
}
