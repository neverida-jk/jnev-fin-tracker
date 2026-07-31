// Dexie (src/db.ts) expects a browser IndexedDB implementation. Tests run in
// plain Node, so install the in-memory fake globally before any test file
// imports '../db' (directly or transitively via backup.ts).
import 'fake-indexeddb/auto'
