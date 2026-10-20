// idb-storage.js — Phase 2a of the bandwidth-architecture plan (design reviewed and approved before this was written).
// Sep 24 2026 — real, direct build via direct discussion with Priyam, strictly scoped per his own explicit instruction:
// this file builds the STORAGE FOUNDATION only — the IndexedDB structure and the one-time migration of the existing
// localStorage cache into it. It does NOT implement the Smart Table Loader's actual sync logic (that's Phase 2b), and
// it is NOT wired into the app's real startup flow, the existing 6-table loader, realtime listeners, or anything else
// that currently runs. Nothing in the app calls anything in this file automatically. Every function here is reached
// only by deliberately calling it — via the window.* functions at the bottom, meant for manual testing in a real
// browser — so if something in here is wrong, it cannot affect the live app at all until a later, separate phase
// deliberately wires it in.
//
// Table scope for this phase: the 6 real record-collection tables already in today's localStorage cache (confirmed
// directly — the cache save happens before Layer 2 even starts loading, so it only ever contains these six plus
// masters/parties/summaries, which are a different category — config documents and flat lists, not identity-keyed
// record collections — and are deliberately out of scope for this phase's object stores).

import { _lotKey } from './core.js';

export const IDB_NAME_PREFIX = 'tc_idb'; // Sep 25 2026 — per-user isolation (approved design): the base prefix
// only. The actual database name is always computed per-user via getIdbNameForUser() below — nothing opens a bare,
// unscoped 'tc_idb' anymore.
export const IDB_VERSION = 3; // Sep 2026 — bumped again for the 9 newer synchronized tables' object stores below
// (deadStock, recycleStock, scrapLog, recycleSoft, residualLog, residualStock, rmReturnLog, voidLog, editLog) —
// additive only, same as the version-2 bump: onupgradeneeded only CREATES stores that don't exist yet, so every
// existing store (the original 6 + the 2 summary stores) and all of its data is left byte-for-byte untouched.

/** Computes a specific user's IndexedDB database name from their stable, permanent, server-generated id — never
 * from username, which has no character restrictions and is not guaranteed to map uniquely (confirmed during
 * audit: no validation on username content at account creation). userId must be a real, non-empty user id; this
 * throws rather than silently falling back to a shared/guessed name, since opening the wrong database — or a
 * shared one — is exactly the failure mode this whole change exists to prevent. */
export function getIdbNameForUser(userId) {
  if (!userId) throw new Error('getIdbNameForUser: a real, logged-in user id is required — refusing to open an unscoped database');
  return `${IDB_NAME_PREFIX}_${userId}`;
}

// The original 6 tables, each with its real, verified identity function. `lots` reuses the app's own real
// _lotKey() — the same formula already used everywhere else — rather than a second, separately-maintained copy that
// could quietly drift out of sync with it. Every other table's identity is its own record id, confirmed against
// each table's real creation code during this session's identity audit.
//
// Sep 2026 — widened in place to cover all 15 synchronized tables (the original 6 above, plus the 9 newer ones
// below), rather than introducing a second, parallel map/list that smart-loader.js, openTCDatabase, and putRecord
// would all have to be taught about separately. TABLE_IDENTITY/RECORD_TABLES stay the single source of truth for
// "every synced table and its identity function" everywhere in this file and in smart-loader.js — unchanged by
// name, just larger. The 9 newer tables' identity, verified directly against worker.js's real creation code for
// each one (not assumed): every one of them is written with its own generated record id as the LITERAL Firebase
// key — the same pattern already confirmed for dispatches/editLog during the _updatedAt backfill work — so `r.id`
// is both the correct local identity and the real Firebase key. None of the 9 has an archive counterpart
// (confirmed: no `/tc/archive/<table>` path is ever written for any of them) — NEWER_RECORD_TABLES below exists
// so a caller that genuinely needs the has-archive/no-archive distinction (e.g. an adapter choosing whether to
// pass includeArchive) can get it without re-deriving it from a hardcoded list of its own.
export const TABLE_IDENTITY = {
  lots: (r) => _lotKey(r),
  stageEntries: (r) => r.id,
  dyeLots: (r) => r.id,
  windEntries: (r) => r.id,
  packEntries: (r) => r.id,
  dispatches: (r) => r.id,
  deadStock: (r) => r.id,
  recycleStock: (r) => r.id,
  scrapLog: (r) => r.id,
  recycleSoft: (r) => r.id,
  residualLog: (r) => r.id,
  residualStock: (r) => r.id,
  rmReturnLog: (r) => r.id,
  voidLog: (r) => r.id,
  editLog: (r) => r.id,
};
export const RECORD_TABLES = Object.keys(TABLE_IDENTITY);

// The 9 newer tables' names alone — the subset of RECORD_TABLES with no archive counterpart. Derived as a fixed
// list (not auto-detected) since "has an archive counterpart" isn't something this module's own data can answer;
// it's a fact about worker.js's real paths, confirmed once during the identity audit above.
export const NEWER_RECORD_TABLES = ['deadStock', 'recycleStock', 'scrapLog', 'recycleSoft', 'residualLog', 'residualStock', 'rmReturnLog', 'voidLog', 'editLog'];
const META_STORE = '_meta';

// Sep 25 2026 — Summary Loader (approved design, separate from the six-table Smart Loader above — deliberately its
// own identity/table list, not merged into RECORD_TABLES, so the two systems stay cleanly independent as agreed).
// Neither summary record carries an `.id` field — lotSummaries has `lotId` (+ grade/vendor), dyeLotSummaries has
// `dyeLotId` — so each identity function adapts the real field names to the app's own existing _lotKey() formula
// (for lots) rather than assuming the same shape as the six main tables.
export const SUMMARY_TABLE_IDENTITY = {
  lotSummaries: (r) => _lotKey({ id: r.lotId, grade: r.grade, vendor: r.vendor }),
  dyeLotSummaries: (r) => r.dyeLotId,
};
export const SUMMARY_TABLES = Object.keys(SUMMARY_TABLE_IDENTITY);

/** Opens (creating if needed) the given user's own IndexedDB database — one object store per record table plus
 * the shared _meta store. Safe to call repeatedly — IndexedDB itself handles "already exists" cleanly via
 * onupgradeneeded only firing when the version actually changes. userId is required; see getIdbNameForUser(). */
export function openTCDatabase(userId) {
  const dbName = getIdbNameForUser(userId);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, IDB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      // RECORD_TABLES now covers all 15 (see its declaration above) — still purely additive, contains()-guarded
      // exactly like before, so a user upgrading from version 2 keeps every existing store and its data
      // untouched, and only gains the 9 new, empty stores.
      RECORD_TABLES.forEach((table) => {
        if (!db.objectStoreNames.contains(table)) db.createObjectStore(table);
      });
      SUMMARY_TABLES.forEach((table) => {
        if (!db.objectStoreNames.contains(table)) db.createObjectStore(table);
      });
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function _txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

/** Writes one record into a table's object store, keyed by the given key if one is supplied, or by that table's own
 * declared identity function otherwise. The explicit-key form exists so a caller that already computed a key (or
 * is using an identity function this module doesn't itself know about — see smart-loader.js's identityMap) never
 * needs a second, parallel key-computation path. Never a bare `.id` assumed safe either way. */
export async function putRecord(db, table, record, explicitKey) {
  let key = explicitKey;
  if (key === undefined) {
    if (!TABLE_IDENTITY[table]) throw new Error(`putRecord: '${table}' is not a known record table in this phase`);
    key = TABLE_IDENTITY[table](record);
  }
  if (!key) throw new Error(`putRecord: no usable key for '${table}' record ${JSON.stringify(record).slice(0, 200)}`);
  const tx = db.transaction([table], 'readwrite');
  tx.objectStore(table).put(record, key);
  await _txDone(tx);
  return key;
}

/** Reads every record currently in a table's object store, as a plain array — matching the shape State.DB[path]
 * already uses today, so nothing downstream needs to change how it consumes this. */
export function getAllRecords(db, table) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([table], 'readonly');
    const req = tx.objectStore(table).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/** Removes one record from a table's object store by its key. Used for genuine stale-record cleanup — a record
 * whose key no longer exists in the live Firebase data at all (a hard delete), never for an ordinary void (a
 * voided record still exists and must stay in local storage). */
export async function deleteRecord(db, table, key) {
  const tx = db.transaction([table], 'readwrite');
  tx.objectStore(table).delete(key);
  await _txDone(tx);
}

/** Removes every record from a table's object store. Used to give a full load true replacement semantics — the
 * exact same guarantee the existing hand-written loader already has via its own `State.DB[path] = arr` reassignment
 * (anything not in the fresh fetch is gone), which a plain put-only full load would not otherwise provide. */
export async function clearTable(db, table) {
  const tx = db.transaction([table], 'readwrite');
  tx.objectStore(table).clear();
  await _txDone(tx);
}

/** Reads a table's small metadata entry — its newest known _updatedAt cursor and whether migration has completed
 * for it. Returns null if nothing has been recorded yet for this table (the honest "no cursor exists" case, not an
 * error). */
export function getTableMeta(db, table) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([META_STORE], 'readonly');
    const req = tx.objectStore(META_STORE).get(table);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function setTableMeta(db, table, meta) {
  const tx = db.transaction([META_STORE], 'readwrite');
  tx.objectStore(META_STORE).put(meta, table);
  await _txDone(tx);
}

/** The one-time migration: reads the existing localStorage cache, splits it by table using each table's real
 * identity function, and records the newest _updatedAt cursor per table — all with zero network activity, since
 * this data is already sitting in the browser. Every failure mode is handled explicitly, never silently:
 *   - no old cache at all -> this is the ordinary "first ever load" case, not an error
 *   - old cache present but fails to parse -> abandoned cleanly, IndexedDB is never touched
 *   - a specific table's data is missing/malformed within an otherwise-parseable cache -> that ONE table is
 *     skipped and reported, every other table still migrates correctly
 *   - the old localStorage key is NEVER deleted here, by design — kept as a safety net for one release cycle,
 *     per the agreed plan; removing it is a separate, later, deliberate decision
 * Returns a detailed per-table result so a caller (a human testing this manually, for now) can see exactly what
 * happened, rather than a bare true/false. */
export async function migrateFromLocalStorage(db, localStorageImpl) {
  const ls = localStorageImpl || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!ls) return { ran: false, reason: 'no-localStorage-available' };

  let raw;
  try {
    raw = ls.getItem('tc_db_cache');
  } catch (e) {
    return { ran: false, reason: 'localStorage-read-error', error: e.message };
  }
  if (!raw) return { ran: false, reason: 'no-old-cache' };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ran: false, reason: 'corrupted-old-cache', error: e.message };
  }
  if (!parsed || typeof parsed !== 'object') return { ran: false, reason: 'corrupted-old-cache' };

  const perTable = {};
  for (const table of RECORD_TABLES) {
    const arr = Array.isArray(parsed[table]) ? parsed[table] : null;
    if (!arr) { perTable[table] = { migrated: false, reason: 'not-present-in-old-cache' }; continue; }

    let migratedCount = 0, skippedCount = 0, newestUpdatedAt = null;
    const skippedRecords = [];
    for (const record of arr) {
      try {
        if (!record || typeof record !== 'object') throw new Error('record is not an object');
        await putRecord(db, table, record);
        migratedCount++;
        if (record._updatedAt && (!newestUpdatedAt || record._updatedAt > newestUpdatedAt)) newestUpdatedAt = record._updatedAt;
      } catch (e) {
        // One bad record must never abort the rest of this table's migration, and must never be silently dropped
        // without a trace — it is reported, and this table is correctly NOT marked fully complete.
        skippedCount++;
        skippedRecords.push({ error: e.message, record: JSON.stringify(record).slice(0, 200) });
      }
    }

    const fullyMigrated = skippedCount === 0 && arr.length > 0;
    if (fullyMigrated) {
      await setTableMeta(db, table, { newestUpdatedAt, migratedAt: new Date().toISOString(), migrationComplete: true });
    }
    // A table with skipped records is deliberately left WITHOUT a migrationComplete meta entry — so a later real
    // load correctly treats it as "no usable cache yet" for that table and does a safe full fetch, rather than
    // silently trusting a partially-migrated set as if it were the whole table.
    perTable[table] = { migrated: fullyMigrated, migratedCount, skippedCount, newestUpdatedAt, skippedRecords: skippedRecords.length ? skippedRecords : undefined };
  }

  return { ran: true, perTable };
}

// ─── Manual testing entry points only — nothing below is called by the app automatically ───────────────────────
if (typeof window !== 'undefined') {
  window.testIDBMigration = async () => {
    const db = await openTCDatabase();
    const result = await migrateFromLocalStorage(db);
    console.log('[Phase 2a] Migration result:', result);
    return result;
  };
  window.inspectIDB = async () => {
    const db = await openTCDatabase();
    const out = {};
    for (const table of RECORD_TABLES) {
      out[table] = { count: (await getAllRecords(db, table)).length, meta: await getTableMeta(db, table) };
    }
    console.log('[Phase 2a] Current IndexedDB contents:', out);
    return out;
  };
}
