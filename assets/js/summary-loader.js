// summary-loader.js — Summary Loader (design reviewed and approved before this was written), Sep 25 2026.
// Strictly scoped, per direct discussion with Priyam: this file implements timestamp-based incremental sync for
// lotSummaries and dyeLotSummaries only — a dedicated loader, deliberately NOT reusing smart-loader.js's code,
// following the same principles (cursor-first, never trust an unverified sync, never delete on ambiguity) but
// built fresh for this different shape of data (flat keyed objects, not per-record identity-keyed collections in
// quite the same way, and no realtime listeners involved at all — this data changes far less often).
//
// NOT wired into core.js, core startup, or the live app in any way. Every function here is reached only by a
// deliberate call — from a test harness, or later, a separate, explicitly-approved integration step (System B).
// Nothing in the running app currently calls anything in this file.
//
// Explicitly excluded, per the approved design: no key-diff, anywhere, not even as a fallback. Party-based
// historical dispatch search remains out of scope and is not touched by anything here.

import { putRecord, getAllRecords, getTableMeta, setTableMeta, SUMMARY_TABLE_IDENTITY, SUMMARY_TABLES } from './idb-storage.js';

/** Compares two (timestamp, key) positions. Returns negative if a is earlier, positive if later, 0 if equal.
 * Timestamp compares first (ISO 8601 strings compare correctly lexicographically); ties break on the record's own
 * key, alphabetically — this is Firebase's own documented tie-break rule for orderByChild, applied here explicitly
 * in memory rather than assumed to already hold in whatever order the REST response happens to arrive in. */
function _comparePosition(tsA, keyA, tsB, keyB) {
  if (tsA !== tsB) return tsA < tsB ? -1 : 1;
  if (keyA === keyB) return 0;
  return keyA < keyB ? -1 : 1;
}

/** Attaches each record's real identity key and explicitly sorts by (_updatedAt, key) — the whole checkpoint
 * mechanism depends on this order being correct in memory, not on any assumption about how Firebase's REST
 * response or JavaScript's own object-key iteration happened to deliver the records. A record whose identity
 * function throws, or that has no usable key, is dropped here rather than sorted under a guessed position. */
function _sortByPosition(table, records) {
  const identityFn = SUMMARY_TABLE_IDENTITY[table];
  const withKeys = [];
  for (const r of records) {
    let key;
    try {
      key = identityFn(r);
    } catch (e) {
      continue;
    }
    if (!key || !r._updatedAt) continue;
    withKeys.push({ r, key, ts: r._updatedAt });
  }
  withKeys.sort((a, b) => _comparePosition(a.ts, a.key, b.ts, b.key));
  return withKeys;
}

/** Processes a position-sorted batch strictly in order, stopping immediately at the first write failure — later
 * records in the batch are never attempted once a failure occurs. Returns the highest position actually,
 * successfully written (or null if nothing succeeded), so the caller can checkpoint through exactly that point and
 * nothing further, and a flag indicating whether the batch was fully consumed or stopped early. */
async function _processSequentially(db, table, sortedWithKeys) {
  let lastGoodPosition = null;
  let processedCount = 0;
  for (const { r, key, ts } of sortedWithKeys) {
    try {
      await putRecord(db, table, r, key);
    } catch (e) {
      return { lastGoodPosition, processedCount, stoppedEarly: true, failedKey: key, error: e.message };
    }
    lastGoodPosition = { timestamp: ts, key };
    processedCount++;
  }
  return { lastGoodPosition, processedCount, stoppedEarly: false };
}

/**
 * Syncs one summary table (lotSummaries or dyeLotSummaries) against Firebase, following the approved design plus
 * the contiguous-checkpoint refinement:
 *   - no local cursor confirmed  -> full load
 *   - local cursor confirmed     -> incremental sync from that cursor's timestamp
 *   - fetched records are explicitly sorted by (_updatedAt, own key) before anything else touches them — this does
 *     not depend on Firebase's REST response or JS object iteration preserving that order on their own
 *   - for incremental sync, anything at or before the current checkpoint position is filtered out first (the
 *     query itself is inclusive of ties on purpose, since a compound startAt is not something this REST usage has
 *     confirmed support for; filtering the response in memory sidesteps that uncertainty entirely)
 *   - records are then written strictly in order; the FIRST write failure stops processing immediately — later
 *     records in this batch are never attempted
 *   - the checkpoint advances only through the last record actually, successfully written — a compound
 *     {timestamp, key} position, never a bare timestamp, since duplicate timestamps make a bare value unsafe
 *   - the post-sync freshness check only runs when the whole fetched batch was fully consumed with no early stop —
 *     a partial batch already means known, pending work remains, so there is nothing meaningful to freshness-check
 *
 * `api` shape: { fetchFull(), fetchIncremental(sinceTimestamp), fetchNewestTimestamp() }
 */
export async function syncSummaryTable(db, { table, api }) {
  if (!SUMMARY_TABLE_IDENTITY[table]) {
    return { outcome: 'configError', reason: 'unknownSummaryTable' };
  }

  const meta = await getTableMeta(db, table).catch(() => null);
  const hasConfirmedCursor = !!(meta && meta.cursorConfirmed === true && meta.cursor && meta.cursor.timestamp);

  if (!hasConfirmedCursor) {
    // ---- Full load (first-ever sync for this table, or a previous sync that never reached confirmation) ----
    let all;
    try {
      all = await api.fetchFull();
    } catch (e) {
      return { outcome: 'fullLoadFailed', error: e.message };
    }

    const sorted = _sortByPosition(table, all);
    const { lastGoodPosition, processedCount, stoppedEarly, failedKey, error } = await _processSequentially(db, table, sorted);

    if (!lastGoodPosition) {
      // Nothing succeeded at all — cursor stays exactly as it was (unset/unconfirmed).
      return { outcome: 'fullLoadWriteFailed', error: error || 'no records processed' };
    }

    if (stoppedEarly) {
      // A partial full load: checkpoint through the last record that genuinely succeeded, confirmed for that
      // portion, but explicitly not treated as "fully caught up" — more work is known to remain.
      await setTableMeta(db, table, { cursor: lastGoodPosition, cursorConfirmed: true, hasMoreToProcess: true });
      return { outcome: 'fullLoadPartial', processed: processedCount, failedKey, error };
    }

    // Whole batch written successfully — now verify nothing newer arrived during the load.
    let newestInFirebase;
    try {
      newestInFirebase = await api.fetchNewestTimestamp();
    } catch (e) {
      await setTableMeta(db, table, { cursor: lastGoodPosition, cursorConfirmed: false, hasMoreToProcess: false });
      return { outcome: 'fullLoadUnconfirmed', reason: 'freshnessCheckFailed', processed: processedCount };
    }

    if (newestInFirebase && newestInFirebase > lastGoodPosition.timestamp) {
      await setTableMeta(db, table, { cursor: lastGoodPosition, cursorConfirmed: false, hasMoreToProcess: false });
      return { outcome: 'fullLoadUnconfirmed', reason: 'raceDetected', processed: processedCount, newestInFirebase };
    }

    await setTableMeta(db, table, { cursor: lastGoodPosition, cursorConfirmed: true, hasMoreToProcess: false });
    return { outcome: 'fullLoad', processed: processedCount };
  }

  // ---- Incremental sync from the last confirmed checkpoint ----
  let changed;
  try {
    changed = await api.fetchIncremental(meta.cursor.timestamp);
  } catch (e) {
    // Step 1 failed — cursor untouched entirely.
    return { outcome: 'incrementalFailed', error: e.message };
  }

  const sortedAll = _sortByPosition(table, changed);
  // Filter out anything at or before the current checkpoint — the query itself is inclusive of ties on purpose,
  // so this in-memory filter is what actually enforces "only what's genuinely new" once duplicates are involved.
  const toProcess = sortedAll.filter(
    ({ ts, key }) => _comparePosition(ts, key, meta.cursor.timestamp, meta.cursor.key) > 0
  );

  const { lastGoodPosition, processedCount, stoppedEarly, failedKey, error } = await _processSequentially(db, table, toProcess);

  if (!lastGoodPosition) {
    // Nothing new to apply, or the very first new record failed — cursor stays exactly where it was either way.
    if (stoppedEarly) return { outcome: 'incrementalWriteFailed', error };
    return { outcome: 'incrementalSuccess', processed: 0 }; // genuinely nothing new, not a failure
  }

  if (stoppedEarly) {
    // Contiguous checkpoint: advance through exactly what succeeded, stop there — the next sync resumes from
    // precisely this point and retries the record that failed, plus anything after it, in order.
    await setTableMeta(db, table, { cursor: lastGoodPosition, cursorConfirmed: true, hasMoreToProcess: true });
    return { outcome: 'incrementalPartial', processed: processedCount, failedKey, error };
  }

  let newestInFirebase;
  try {
    newestInFirebase = await api.fetchNewestTimestamp();
  } catch (e) {
    return { outcome: 'incrementalUnconfirmed', reason: 'freshnessCheckFailed', processed: processedCount };
  }

  if (newestInFirebase && newestInFirebase > lastGoodPosition.timestamp) {
    // A write landed in Firebase during this exact sync window. Cursor stays at its last CONFIRMED value (not the
    // new candidate) so the next sync naturally re-covers the gap incrementally.
    return { outcome: 'incrementalUnconfirmed', reason: 'raceDetected', processed: processedCount, newestInFirebase };
  }

  await setTableMeta(db, table, { cursor: lastGoodPosition, cursorConfirmed: true, hasMoreToProcess: false });
  return { outcome: 'incrementalSuccess', processed: processedCount };
}

/**
 * Lot invalidation — a Voided or Merged lot's lotSummaries entry should be treated as invalid locally, since the
 * server itself already nulls it out (confirmed: updateLotSummary's own guard), but a client relying purely on
 * timestamp sync would never see a deletion (a deleted record has no future timestamp to match). This reuses the
 * app's own real _lotKey() — no new identity mechanism — applied to whatever the six-table Smart Loader already
 * knows about each lot's real, current status.
 */
export function findInvalidLotSummaryKeys(lots, lotKeyFn) {
  return lots
    .filter((l) => l && (l.status === 'Voided' || l.status === 'Merged'))
    .map((l) => lotKeyFn(l));
}

/**
 * Dye-lot invalidation — honest asymmetry, confirmed directly against the real server code: unlike lots,
 * updateDyeLotSummary() has no Voided/Rejected cleanup at all today. There is no existing server-side precedent to
 * mirror here. This applies the exact same principle the lot side already gets — checking the dye lot's own,
 * already-trusted `status` field — consistently, even though the server doesn't proactively clean this one up.
 * No new field or mechanism: just the dye lot's own real status, already present via Smart Loader.
 */
export function findInvalidDyeLotSummaryIds(dyeLots) {
  return dyeLots
    .filter((d) => d && (d.status === 'Voided' || d.status === 'Rejected'))
    .map((d) => d.dyeLotId || d.id);
}

/** Removes the given, already-identified-as-invalid keys from a summary table's local cache. Called with the
 * output of findInvalidLotSummaryKeys / findInvalidDyeLotSummaryIds — never a guess, always a specific, known key
 * derived from data already trusted. This is deletion of a LOCAL cache entry only, mirroring what the real server
 * has already done (or, for dye lots, should be treated as if it had) — not a new destructive mechanism. */
async function _removeSummaryRecords(db, table, keys) {
  if (!keys || keys.length === 0) return 0;
  const tx = db.transaction([table], 'readwrite');
  const store = tx.objectStore(table);
  for (const k of keys) store.delete(k);
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
  return keys.length;
}

/** Applies invalidation for both summary tables, given the current, already-trusted lots/dyeLots arrays (from the
 * six-table Smart Loader's own State.DB, or IndexedDB directly). Safe to call after every summary sync, or on its
 * own — reads only, plus a targeted delete of specifically-identified keys, never a broad or guessed removal. */
export async function applySummaryInvalidation(db, { lots, dyeLots, lotKeyFn }) {
  const invalidLotKeys = findInvalidLotSummaryKeys(lots || [], lotKeyFn);
  const invalidDyeLotIds = findInvalidDyeLotSummaryIds(dyeLots || []);
  const lotRemoved = await _removeSummaryRecords(db, 'lotSummaries', invalidLotKeys);
  const dyeLotRemoved = await _removeSummaryRecords(db, 'dyeLotSummaries', invalidDyeLotIds);
  return { lotRemoved, dyeLotRemoved };
}

// ─── Manual testing entry points, mirroring smart-loader.js's own pattern. Not called by anything in the live app. ───
if (typeof window !== 'undefined') {
  window.summaryLoaderSyncTable = syncSummaryTable;
  window.summaryLoaderApplyInvalidation = applySummaryInvalidation;
}
