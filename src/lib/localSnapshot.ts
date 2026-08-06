import db from '../db'
import { exportBackup, importBackup } from './backup'

// localStorage key backing the "have we already taken a snapshot today"
// gate, mirroring the localStorage pattern used for isLocalModelEnabled /
// setLocalModelEnabled in aiEngine.ts. Stores a plain yyyy-MM-dd string
// (the local calendar date the last snapshot was taken on), not a full
// timestamp — the gate only ever needs day granularity.
const LAST_SNAPSHOT_DATE_STORAGE_KEY = 'last-local-snapshot-date'

// Small rolling window: enough generations to recover from "the bad edit
// happened a couple of days ago and I didn't notice immediately", without
// letting snapshot history (each a full copy of every table) grow without
// bound in IndexedDB storage.
export const MAX_SNAPSHOT_GENERATIONS = 3

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10) // yyyy-MM-dd
}

/**
 * Whether an automatic local snapshot has NOT yet been taken today. Wrapped
 * in try/catch since localStorage can throw in some contexts (e.g. private
 * browsing with storage disabled) — if we can't tell, we default to true so
 * a snapshot is attempted rather than silently skipped forever.
 */
export function shouldTakeSnapshotToday(): boolean {
  try {
    return localStorage.getItem(LAST_SNAPSHOT_DATE_STORAGE_KEY) !== todayDateString()
  } catch {
    return true
  }
}

/** Records that a snapshot was taken today, so shouldTakeSnapshotToday() returns false for the rest of the day. */
export function markSnapshotTakenToday(): void {
  try {
    localStorage.setItem(LAST_SNAPSHOT_DATE_STORAGE_KEY, todayDateString())
  } catch {
    // localStorage unavailable — the gate just won't persist across
    // reloads today, so at worst we take an extra snapshot.
  }
}

/**
 * Takes one automatic, same-device rolling snapshot right now and prunes
 * older generations beyond MAX_SNAPSHOT_GENERATIONS.
 *
 * This is a pure "take one now" primitive: it does NOT check
 * shouldTakeSnapshotToday() itself — gating snapshots to once per day is the
 * caller's responsibility, so this function stays independently testable.
 * It does call markSnapshotTakenToday() once it succeeds, so a caller that
 * *does* check the gate first sees it reflect the snapshot just taken.
 */
export async function takeLocalSnapshot(): Promise<void> {
  const backup = await exportBackup()

  await db.localSnapshots.add({
    id: undefined as unknown as number,
    createdAt: new Date().toISOString(),
    schemaVersion: backup.schemaVersion,
    tables: backup.tables,
  })

  const all = await db.localSnapshots.orderBy('createdAt').toArray()
  const excessCount = all.length - MAX_SNAPSHOT_GENERATIONS
  if (excessCount > 0) {
    const oldestIds = all.slice(0, excessCount).map((snapshot) => snapshot.id)
    await db.localSnapshots.bulkDelete(oldestIds)
  }

  markSnapshotTakenToday()
}

/** Lists all local snapshots, newest first, for a Settings UI list. */
export async function listLocalSnapshots(): Promise<{ id: number; createdAt: string }[]> {
  const all = await db.localSnapshots.orderBy('createdAt').reverse().toArray()
  return all.map((snapshot) => ({ id: snapshot.id, createdAt: snapshot.createdAt }))
}

/**
 * Restores the database from a previously taken local snapshot.
 *
 * This is destructive — it replaces all current data, the same as
 * importBackup(). Callers MUST have already confirmed this with the user;
 * this function does not prompt, matching importBackup()'s documented
 * contract.
 */
export async function restoreLocalSnapshot(id: number): Promise<void> {
  const snapshot = await db.localSnapshots.get(id)
  if (!snapshot) {
    throw new Error(`Local snapshot ${id} not found.`)
  }

  await importBackup({
    schemaVersion: snapshot.schemaVersion,
    exportedAt: snapshot.createdAt,
    tables: snapshot.tables,
  })
}
