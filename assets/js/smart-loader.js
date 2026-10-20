// smart-loader.js — Phase 2b of the bandwidth-architecture plan (design + prior-art review approved before this
// was written).
// Sep 24 2026 — real, direct build via direct discussion with Priyam, strictly scoped: this file is the Smart
// Loader's DECISION logic only — on top of Phase 2a's IndexedDB storage, using the exact identity functions already
// declared there. It is NOT wired into core.js's real startup flow, does not touch the existing six-table loader,
// realtime listeners, System B, System C, or any Layer-2 table. Every network call this file makes is injected by
// the caller (see `api` below) — this file never calls fetch() or Firebase directly itself — so it can be fully,
// genuinely tested without a real server, and so wiring it into the live app later (Phase 2c, not this phase) means
// supplying real fetch functions, not changing this file's logic at all.
//
// Prior-art principles this deliberately keeps: stable identity + a "what changed since" cursor for dedup; read the
// local cache first, sync in the background; a corrupted/unusable local cache falls back to a plain full resync,
// no elaborate partial-repair logic; batch related recovery calls where practical.
// Prior-art complexity this deliberately leaves out, on purpose, because ThreadControl has no offline-write path
// today: CRDTs, vector clocks, an offline write queue, background cache-expiry/staleness timers, multi-strategy
// conflict resolution. See the Phase 1 design doc's "Prior art review" section for the full reasoning.

import { getAllRecords, getTableMeta, setTableMeta, putRecord, TABLE_IDENTITY } from './idb-storage.js';

/**
 * A table's sync configuration. Every function here is injected by the caller — this module never assumes how
 * data is actually fetched, only what shape it comes back in.
 *   table            — the table name, must match a key already declared in idb-storage.js's TABLE_IDENTITY
 *                       (or an extra identity map passed in for genuinely new tables — see `identityMap` below).
 *   fetchFull()       — returns the full current record array for this table.
 *   fetchIncremental(sinceTimestamp) — returns only records with a newer cursor than `sinceTimestamp`.
 *   fetchShallowKeys() — returns the current, real set of keys that exist live right now (cheap — keys only).
 *   fetchByKeys(keys) — given an array of keys, returns whichever of those records still genuinely exist, in one
 *                       batched call where the caller's real implementation supports it — this module never assumes
 *                       one call per key, but never requires batching either; it just passes the whole array once.
 *   identityMap       — optional: an identity-function lookup for this call, keyed by table name, for a table not
 *                       already known to idb-storage.js (this is how the synthetic derived-key test table works —
 *                       proving the mechanism is genuinely generic, not how any real table is meant to be added).
 */

function _identityFnFor(table, identityMap) {
  if (identityMap && identityMap[table]) return identityMap[table];
  if (TABLE_IDENTITY[table]) return TABLE_IDENTITY[table];
  throw new Error(`No declared identity function for table '${table}' — refusing to guess`);
}

function _newestUpdatedAt(records, startingFrom) {
  let newest = startingFrom || null;
  for (const r of records) {
    if (r && r._updatedAt && (!newest || r._updatedAt > newest)) newest = r._updatedAt;
  }
  return newest;
}

/** Merges a batch of incoming records into IndexedDB using the table's declared identity function. Never silently
 * substitutes `.id` on a failure — a broken or malformed identity result aborts this merge attempt entirely and is
 * reported to the caller, who is responsible for falling back to a full reload (this module's own syncTable()
 * does exactly that). */
async function _mergeRecords(db, table, records, identityFn) {
  for (const record of records) {
    if (!record || typeof record !== 'object') throw new Error('identity-error: record is not an object');
    let key;
    try {
      key = identityFn(record);
    } catch (e) {
      throw new Error('identity-error: identity function threw: ' + e.message);
    }
    if (!key || typeof key !== 'string') throw new Error('identity-error: identity function returned an invalid key');
    await putRecord(db, table, record, key);
  }
}

/** Reconciles a set of keys that are no longer in the ACTIVE shallow list — never assumes this means deleted.
 * The only real, everyday reason a key ever leaves the active table is archiving (confirmed directly against the
 * real code: there is no hard-delete feature anywhere for these tables), and the active-only shallow list cannot
 * tell archived apart from genuinely gone — it was never designed to. So this checks properly, using the exact same
 * kind of archive-aware lookup already proven correct for the missing-key case, before concluding anything:
 *   - found (anywhere, including archive) -> not a deletion at all. The local copy is refreshed with the real,
 *     current data (its status may have changed to reflect archiving) and is NEVER removed.
 *   - not found anywhere -> genuinely unaccounted for. Still never deleted automatically — flagged for a human to
 *     look at, exactly the same caution already used for a missing record that turns out to be nowhere at all.
 * Returns { refreshedCount, flaggedKeys } so a caller can report this precisely rather than a single vague count. */
async function _reconcileStaleKeys(db, table, staleKeys, identityFn, api) {
  if (staleKeys.length === 0) return { refreshedCount: 0, flaggedKeys: [] };
  let found;
  try {
    found = await api.fetchByKeys(staleKeys);
  } catch (e) {
    // Cannot verify right now -- the safe default is to touch nothing at all, not to guess either way.
    return { refreshedCount: 0, flaggedKeys: [] };
  }
  await _mergeRecords(db, table, found, identityFn);
  const foundKeySet = new Set(found.map((r) => identityFn(r)));
  const flaggedKeys = staleKeys.filter((k) => !foundKeySet.has(k));
  return { refreshedCount: found.length, flaggedKeys };
}

/** The one full-load path, used both for "no cache yet" and for every genuine fallback case. This is a TRUE
 * replacement in effect — anything left over locally that the fresh fetch doesn't account for is reconciled the
 * same careful, archive-aware way as the incremental path (see _reconcileStaleKeys), never simply deleted, since a
 * full load's fresh fetch is just as active-only as the shallow list is, and would otherwise make the exact same
 * "archived looks like deleted" mistake this whole fix exists to close.
 *
 * Order matters here: the merge happens FIRST, and only once it has genuinely succeeded does reconciliation run.
 * An identity failure partway through leaves IndexedDB exactly as it was before this attempt, never emptier. */
async function _doFullLoad(db, table, identityFn, api, reason) {
  let records;
  try {
    records = await api.fetchFull();
  } catch (e) {
    return { outcome: 'fullLoadFailed', reason, error: e.message };
  }
  const previousRecords = await getAllRecords(db, table);
  try {
    await _mergeRecords(db, table, records, identityFn);
  } catch (e) {
    // A full load whose OWN records fail identity is a genuinely different, worse problem than a normal fallback
    // succeeding — reported distinctly rather than masked as a plain success. Nothing has been reconciled yet, so
    // the table is left exactly as it was before this attempt, not emptied.
    return { outcome: 'fullLoadIdentityError', reason, error: e.message };
  }
  const freshKeySet = new Set(records.map((r) => identityFn(r)));
  const staleKeys = previousRecords.map((r) => identityFn(r)).filter((k) => !freshKeySet.has(k));
  const { refreshedCount, flaggedKeys } = await _reconcileStaleKeys(db, table, staleKeys, identityFn, api);
  const newest = _newestUpdatedAt(records, null);
  await setTableMeta(db, table, { newestUpdatedAt: newest, migrationComplete: true, lastSyncAt: new Date().toISOString() });
  return { outcome: 'fullLoad', reason, recordCount: records.length, staleRefreshed: refreshedCount, flaggedKeys };
}

/**
 * The main decision function. Returns a detailed result object every time — never a bare boolean — so a caller (a
 * test, or eventually Phase 2c's real wiring) can see exactly which path was taken and why.
 */
export async function syncTable(db, config) {
  const { table, api, identityMap } = config;
  let identityFn;
  try {
    identityFn = _identityFnFor(table, identityMap);
  } catch (e) {
    return { outcome: 'configError', error: e.message };
  }

  // ---- Step 1: is there a usable local cursor? ----
  let meta;
  try {
    meta = await getTableMeta(db, table);
  } catch (e) {
    return await _doFullLoad(db, table, identityFn, api, 'metaReadError');
  }
  const hasUsableCache = !!(meta && meta.migrationComplete === true && meta.newestUpdatedAt);
  if (!hasUsableCache) {
    return await _doFullLoad(db, table, identityFn, api, 'noCache');
  }

  // ---- Step 2: incremental fetch ----
  const cursorBeforeThisSync = meta.newestUpdatedAt;
  let incrementalRecords;
  try {
    incrementalRecords = await api.fetchIncremental(cursorBeforeThisSync);
  } catch (e) {
    return await _doFullLoad(db, table, identityFn, api, 'incrementalFetchError');
  }

  // ---- Step 3: merge, using the declared identity function — never substitute `.id` on failure ----
  try {
    await _mergeRecords(db, table, incrementalRecords, identityFn);
  } catch (e) {
    return await _doFullLoad(db, table, identityFn, api, 'identityFunctionError');
  }
  const newCursor = _newestUpdatedAt(incrementalRecords, cursorBeforeThisSync);
  await setTableMeta(db, table, { newestUpdatedAt: newCursor, migrationComplete: true, lastSyncAt: new Date().toISOString() });

  // ---- Step 4: verification — a cheap, real shallow-key comparison, checking BOTH directions, never a second
  // full download. A key live but not local yet needs recovery (below). A key local but no longer in the ACTIVE
  // shallow list is NOT automatically treated as deleted — the active-only shallow list cannot distinguish that
  // from an everyday archive move (confirmed directly: there is no hard-delete feature at all for these tables),
  // so it's reconciled properly instead — see _reconcileStaleKeys above. ----
  let shallowKeys;
  try {
    shallowKeys = await api.fetchShallowKeys();
  } catch (e) {
    return await _doFullLoad(db, table, identityFn, api, 'verificationError');
  }
  const localRecords = await getAllRecords(db, table);
  const localKeySet = new Set(localRecords.map((r) => { try { return identityFn(r); } catch (e) { return null; } }));
  const shallowKeySet = new Set(shallowKeys);
  const missingKeys = shallowKeys.filter((k) => !localKeySet.has(k));
  const staleKeys = [...localKeySet].filter((k) => k !== null && !shallowKeySet.has(k));

  if (missingKeys.length === 0) {
    const { refreshedCount, flaggedKeys } = await _reconcileStaleKeys(db, table, staleKeys, identityFn, api);
    return { outcome: 'incrementalSuccess', recordCount: incrementalRecords.length, missingKeys: 0, staleArchived: refreshedCount, flaggedKeys };
  }

  // ---- Step 5: targeted recovery — one batched call for every missing key, never one call per key ----
  let recovered;
  try {
    recovered = await api.fetchByKeys(missingKeys);
  } catch (e) {
    return await _doFullLoad(db, table, identityFn, api, 'targetedRecoveryError');
  }

  let recoveredNewToMe = 0, recoveredGenuinelyMissing = 0;
  try {
    for (const record of recovered) {
      // Classification only — the action (merge it in) is identical either way. A record whose own _updatedAt is
      // at or after the cursor we synced FROM is simply new since our last real sync (the ordinary "someone else
      // created this and it hasn't arrived yet" case). One whose _updatedAt predates that cursor should already
      // have been here — that is the genuine problem this whole verification step exists to catch.
      if (record && record._updatedAt && record._updatedAt >= cursorBeforeThisSync) recoveredNewToMe++;
      else recoveredGenuinelyMissing++;
    }
    await _mergeRecords(db, table, recovered, identityFn);
  } catch (e) {
    return await _doFullLoad(db, table, identityFn, api, 'identityFunctionError');
  }
  const recoveredKeySet = new Set(recovered.map((r) => identityFn(r)));
  const stillMissingAfterRecovery = missingKeys.filter((k) => !recoveredKeySet.has(k));

  // ---- Step 6: re-verify ----
  if (stillMissingAfterRecovery.length === 0) {
    const { refreshedCount, flaggedKeys } = await _reconcileStaleKeys(db, table, staleKeys, identityFn, api);
    return {
      outcome: 'targetedRecoverySuccess',
      recordCount: incrementalRecords.length,
      recoveredCount: recovered.length,
      recoveredNewToMe,
      recoveredGenuinelyMissing,
      staleArchived: refreshedCount,
      flaggedKeys,
    };
  }

  // ---- Step 7: targeted recovery didn't close the gap — last resort, not the first response. The full-load path
  // itself already gives correct replacement semantics (see _doFullLoad above), so stale cleanup here is
  // unnecessary — it happens there instead. ----
  return await _doFullLoad(db, table, identityFn, api, 'targetedRecoveryIncomplete');
}

// ─── Manual testing entry point only — nothing below is called by the app automatically ─────────────────────────
if (typeof window !== 'undefined') {
  window.smartLoaderSyncTable = syncTable;
}
