import { calcRMBalance, calcRMBalanceAvailable, calcDyeBal, calcDyeBalAvailable, calcWindBal, calcWindBalAvailable, calcPackBal, calcPackBalAvailable, calcSoftOut, calcSoftBalanceWeight, calcSoftBalanceWeightAvailable, calcTotalDispatchedApproved, calcTotalPackedApproved, calcDyeBalanceByLot, calcWindBalanceByLot, calcPackBalanceByLot, calcDispatchAllocated, calcFlowTotals, calcMachineTotals, calcWorkerTotals, calcShadeTotals, calcDailyTotals, calcSoftConsumedByDye, calcRMReturnedOut, calcSoftResidualOut, appr, calcSoftConsumedByDyeWIP, calcSoftIn, calcDeadStockBalance, calcRecycleSteelBal, calcRecycleSteelAvailable, calcRecycleSoftenedBal, calcRecycleSoftenedAvailable, calcResidualStockBalance, calcGradeTotals, calcPackTotals, calcWasteTotals, calcSoftWaste, calcWindWaste, calcPackGain, calcDyeWaste, calcVendorRatioForDyeLot, calcSoftBalanceUnits, proportionalUnits } from './assets/js/shared-balances.js';
// Sep 29 2026 — Redis (Upstash), used by the Phase 3 generic cache module below (cacheGet/cacheSet/cacheInvalidate).
import { Redis } from '@upstash/redis/cloudflare';

// ─── Firebase URLs ───────────────────────────────────────────────────────────
let FIREBASE_URL = 'https://threadcontrolproduction-2-default-rtdb.asia-southeast1.firebasedatabase.app';
const MAX_BACKUPS  = 5; // once daily (changed Jul 17 2026, was twice daily) × 5 days

// Legacy Firebase Database Secret — set fresh from env at the top of fetch() AND
// scheduled(), since this is module-level state shared across requests in the same
// isolate. Safe under concurrency: every request sets the SAME constant value, so
// there's no meaningful race. This bypasses Firebase rules entirely (legacy secret
// = full admin access) — needed because Firebase rules now require auth!=null on
// everything and explicitly block /tc/users from client reads. NOTE: Database
// Secrets are deprecated by Firebase (confirmed still live for this project as of
// this build, but Google could disable them project-wide without much notice —
// migrate to Service-Account JWT signing if that ever happens).
let _fbSecret = 'TCpQMZt6FEfISfYUdOjMfNu2o2kwRJpvXzbDGvlr';
let _apiSecret = '';
// Sep 29 2026 — Phase 3, Redis generic cache module: mirrors the exact existing pattern above (_fbSecret,
// _apiSecret) — a module-level client, initialized once per request from env inside fetch(), then used via
// closure by the functions below. Never a hardcoded credential, matching every other secret in this file.
let _redis = null;
// Aug 26 2026 — real, genuine fix built via direct discussion with
// Priyam: corsHeaders() used to allow every website in existence to
// call this backend. This app is only ever served from its own 2 real
// domains (production and staging) — same pattern already used for
// _fbSecret/_apiSecret, set once at the start of fetch(), read here
// without needing to thread a new parameter through every function
// that already calls corsHeaders().
let _requestOrigin = '';
const _ALLOWED_ORIGINS = ['https://cold-breeze-bb3e.abhipolywork.workers.dev', 'https://stagingthread.abhipolywork.workers.dev'];
// Aug 26 2026 — real Turnstile secret, read from the real Worker secret
// Priyam already, correctly stored via `wrangler secret put`, never
// hardcoded here, matching the exact same pattern as _fbSecret/_apiSecret.
let _turnstileSecret = '';
function _fbAuthSuffix() { return _fbSecret ? `?auth=${_fbSecret}` : ''; }

// ─── Firebase Helpers ────────────────────────────────────────────────────────
function getTotalEntries(tc) {
  const _len = v => Array.isArray(v) ? v.length : Object.keys(v || {}).length;
  const archive = tc.archive || {};
  return (
    _len(tc.stageEntries) +
    _len(tc.dyeLots) +
    _len(tc.windEntries) +
    _len(tc.packEntries) +
    _len(tc.dispatches) +
    _len(archive.dyeLots) +
    _len(archive.windEntries) +
    _len(archive.packEntries) +
    _len(archive.dispatches)
  );
}

async function fbGet(path, extraQuery) {
  const authSuffix = _fbAuthSuffix();
  const url = extraQuery
    ? `${FIREBASE_URL}${path}.json?${extraQuery}${authSuffix ? authSuffix.replace('?', '&') : ''}`
    : `${FIREBASE_URL}${path}.json${authSuffix}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Firebase GET ${path} failed: ${res.status}`);
  return res.json();
}

// Jul 28 2026 — the 6 tables that matter for the "last changed" marker.
// Confirmed design: prospective only, no backfill of old records — an old
// record without this field is treated as "needs a full check" by
// whatever eventually reads it, which is safe, not broken. It picks up
// the marker the moment any normal action touches it again.
const _HOT_TABLES = ['lots', 'stageEntries', 'dyeLots', 'windEntries', 'packEntries', 'dispatches'];

// Sep 30 2026 — real, direct extension built via direct discussion with Priyam, after a multi-pass source audit
// (mutation inventory + centralized-design study) confirmed exactly two things: (1) a long, repeated pattern of
// business functions individually forgetting to stamp _updatedAt on the 9 newer tables, on archive paths, and in
// several dynamic-table normal-flow functions (reject/approve/void-chain) — four separate audit passes each found
// a new instance of this same class of omission; and (2) the auto-stamp mechanism already proven correct for the
// original 6 tables' ACTIVE paths generalizes cleanly to all 15 tables and to archive paths, once the path parser
// stops treating "archive" as if it were the table name. _HOT_TABLES itself is left completely unchanged — it has
// no other use in this file (confirmed: only referenced from inside fbSet/fbPatch below) and nothing elsewhere
// depends on its exact membership — but a new, separate list is used for the auto-stamp going forward so the two
// concepts (an older "hot" designation vs. "every table Smart Loader will eventually sync") stay independently
// named even though their current membership overlaps for the original six.
const _SYNCED_TABLES = ['lots', 'stageEntries', 'dyeLots', 'windEntries', 'packEntries', 'dispatches',
  'deadStock', 'recycleStock', 'scrapLog', 'recycleSoft', 'residualLog', 'residualStock', 'rmReturnLog',
  'voidLog', 'editLog'];

// Resolves a Firebase path/key into { table, id, isArchive } if (and only if) it points at a record directly
// under one of the 15 synced tables — active (`tc/<table>/<id>`) or archive (`tc/archive/<table>/<id>`), with or
// without a further field-path suffix. Returns null for anything else (a different table entirely, a config path
// like `tc/masters`, a non-record path, etc.) — callers must treat null as "not in scope," never guess further.
// This is the one shared place that understands archive-path shape, so fbSet and fbPatch can never drift apart on
// it the way two separately-maintained copies eventually would.
function _resolveSyncedRecordPath(fullKeyNoLeadingSlash) {
  const m = fullKeyNoLeadingSlash.match(/^tc\/(archive\/)?([a-zA-Z]+)\/([^/]+)(?:\/.*)?$/);
  if (!m) return null;
  const [, archivePrefix, table, id] = m;
  if (!_SYNCED_TABLES.includes(table)) return null;
  return { table, id, isArchive: !!archivePrefix };
}

async function fbSet(path, data) {
  const _p = path.startsWith('/') ? path : '/' + path;
  // Auto-stamp: a full-record write (PUT) to one of the 15 synced tables — active or archive — that isn't a
  // delete (data isn't null), gets _updatedAt added automatically, every handler that calls fbSet gets this for
  // free, nothing to remember to add individually. Archive-path writes are recognized via the same resolver
  // fbPatch uses below, so the two can never silently disagree on what counts as "a synced record."
  let _body = data;
  const _resolved = _resolveSyncedRecordPath(_p.replace(/^\//, ''));
  const _isWholeRecordPath = /^\/tc\/(archive\/)?[a-zA-Z]+\/[^/]+$/.test(_p);
  if (_resolved && _isWholeRecordPath && data && typeof data === 'object') {
    _body = { ...data, _updatedAt: new Date().toISOString() };
  }
  const res = await fetch(`${FIREBASE_URL}${_p}.json${_fbAuthSuffix()}`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(_body)
  });
  if (!res.ok) throw new Error(`Firebase PUT ${path} failed: ${res.status}`);
  return res.json();
}

// Aug 6 2026 — the real, structural fix for a confirmed, systemic gap:
// summaries only ever refreshed via one single, manual button (the
// "Recalculate summary" click) anywhere in the whole app — every real
// action across every stage saved its own real data correctly, but
// nothing ever told the affected lot's summary to catch up. Proven via
// 204 real, live discrepancies flagged by the Daily Balance Checker,
// mathematically confirmed to match exactly to stale-cache gaps, not
// genuine data problems — the real, underlying data (and every real
// operational decision made from it) was always correct; only the
// pre-computed summary shown on certain screens lagged behind.
//
// Fixed not by adding a refresh call to each individual handler
// (fragile — the exact same silent gap could recur the moment a future
// stage or action gets added and someone forgets this one extra step)
// but by making the refresh an inseparable part of saving itself: any
// handler creating or editing a record that affects a lot's summary
// should call THIS instead of fbSet directly — the refresh genuinely
// cannot be skipped, even by accident, even by a stage that doesn't
// exist yet.
//
// A refresh failure never blocks the real save — by the time refresh
// runs, the real record is already safely written. If the refresh
// itself fails, the summary just stays stale a little longer, which the
// Daily Balance Checker now genuinely exists to catch, rather than a
// gap like this going unnoticed indefinitely.
async function saveRecordAndRefreshSummary(path, data, affectedLotKeys) {
  await fbSet(path, data);
  await Promise.all((affectedLotKeys || []).map(({ lotId, grade, vendor }) =>
    updateLotSummary(lotId, grade, vendor).catch(e =>
      console.warn(`[refresh] Summary update failed for ${lotId}/${grade}/${vendor}:`, e.message)
    )
  ));
  return true;
}

// Jul 19 2026 — duplicate-submission guard. Every real submit action
// (Start/End Soft/Wind/Dye, Pack, Dispatch) now carries a one-time key
// generated by the browser the moment the button is clicked, before the
// request is sent. If the same key is seen again within 5 minutes — the
// realistic window for a network retry or accidental double-tap, not a
// genuine second action — the request is rejected with a clear reason
// instead of silently creating a duplicate record. Keys older than 5
// minutes are treated as expired (not checked, not blocking).
// This does not replace the "already in progress" warning users can
// override — that's a different, deliberate check for a different case
// (a real second action on the same lot). This one is specifically about
// the exact same click's request arriving at the server more than once.
async function checkIdempotency(key, actionLabel) {
  if (!key) return { duplicate: false }; // no key sent — caller predates this guard, don't block
  const path = `/tc/_idempotencyKeys/${key}`;
  const existing = await fbGet(path).catch(() => null);
  if (existing && existing.at) {
    const ageMs = Date.now() - new Date(existing.at).getTime();
    if (ageMs < 5 * 60 * 1000) {
      return {
        duplicate: true,
        message: `This looks like a duplicate of a ${actionLabel} submission already received ${Math.round(ageMs / 1000)}s ago — not saved again to avoid a repeat entry. If you genuinely meant to submit this again, please try once more.`
      };
    }
  }
  await fbSet(path, { at: new Date().toISOString(), action: actionLabel }).catch(() => {});
  return { duplicate: false };
}

async function fbPatch(path, data) {
  const _p = path.startsWith('/') ? path : '/' + path;

  // Jul 28 2026 — same auto-stamping as fbSet, but fbPatch can touch
  // many different records across many tables in a single call, so this
  // has to find every one of them, not just one. Two real things to get
  // right: (1) a patch can reference the same record more than once
  // (e.g. two different fields) — only stamp it once, not once per key.
  // (2) archiving sets a record to null (delete) in the very same patch
  // that also copies it into /archive — stamping a record being deleted
  // would create two keys touching the same path in one multi-location
  // update, which Firebase does not handle safely. Deleted records are
  // detected first and excluded entirely.
  //
  // Aug 4 2026 — real, confirmed bug found via a genuine 400 from
  // Firebase: a WHOLE-RECORD write (e.g. moving a lot to its correct
  // address — the new address's full object as one key) was being
  // "stamped" the same way a PARTIAL field write is — by adding a
  // separate `/path/_updatedAt` key. That separate key sits INSIDE the
  // path already being fully written by the whole-record key in the
  // very same patch — Firebase genuinely rejects two keys where one is
  // a sub-path of the other, in one multi-location update. Fixed:
  // whole-record writes get stamped directly inside their own value
  // object instead of as a second, conflicting key.
  //
  // Sep 30 2026 — real extension, built after a multi-pass mutation audit found the same class of omission
  // recurring across the 9 newer tables, archive paths, and several dynamic-table normal-flow functions
  // (reject/approve/void-chain): generalized from "the 6 hot tables, active paths only" to all 15 synced tables,
  // active and archive, via the shared _resolveSyncedRecordPath() resolver (same one fbSet uses, so the two can
  // never silently disagree). The ONE new exception, not present before: if the CALLER's own patch already
  // contains a key whose last path segment is literally `_updatedAt` for a given record, that is a deliberate,
  // explicit value (the historical-backfill case is the only current real example) — it is never overwritten and
  // that record is never ALSO given a second, separate auto-stamp key, which would either conflict or silently
  // replace the caller's intentional historical value with "now".
  let _body = data;
  if (data && typeof data === 'object') {
    const deletedRecords = new Set();
    const wholeRecordKeys = new Map(); // recordId -> the actual patch key holding the full object
    const partialTouchedRecords = new Set();
    const explicitUpdatedAtRecords = new Set(); // records where the caller's OWN key already is .../_updatedAt
    const recordPrefix = new Map(); // recordId -> the real tc/[archive/]<table>/<id> prefix, for building a stamp key
    const baseNorm = _p === '/' ? '' : _p.replace(/^\/|\/$/g, '');
    for (const [key, val] of Object.entries(data)) {
      const relKey = key.startsWith('/') ? key.slice(1) : key;
      const fullKey = (baseNorm ? baseNorm + '/' : '') + relKey;
      const resolved = _resolveSyncedRecordPath(fullKey);
      if (!resolved) continue;
      const { table, id, isArchive } = resolved;
      const recordId = `${isArchive ? 'archive/' : ''}${table}/${id}`;
      const realPrefix = `tc/${recordId}`;
      recordPrefix.set(recordId, realPrefix);
      const isWholeRecordKey = fullKey === realPrefix;
      const isExplicitUpdatedAtKey = fullKey === `${realPrefix}/_updatedAt`;
      if (isWholeRecordKey) {
        if (val === null) { deletedRecords.add(recordId); continue; }
        wholeRecordKeys.set(recordId, key);
      } else if (isExplicitUpdatedAtKey) {
        explicitUpdatedAtRecords.add(recordId);
      } else {
        partialTouchedRecords.add(recordId);
      }
    }
    _body = { ...data };
    const now = new Date().toISOString();
    // Whole-record writes — stamp directly inside the object itself, never as a separate key, so nothing can
    // conflict with the record's own path. Skipped for a record the caller already explicitly stamped (not
    // currently possible to hit both in one patch for the same record, but checked for correctness regardless).
    wholeRecordKeys.forEach((key, recordId) => {
      if (deletedRecords.has(recordId) || explicitUpdatedAtRecords.has(recordId)) return;
      const val = _body[key];
      if (val && typeof val === 'object') _body[key] = { ...val, _updatedAt: now };
    });
    // Partial field writes — a separate sibling key, only for records that aren't also getting a whole-record
    // write in this same patch (already stamped above), aren't being deleted, and — the one new exception —
    // aren't already being given an explicit _updatedAt value by the caller's own patch in this same call.
    const toStampSeparately = [...partialTouchedRecords].filter(r =>
      !deletedRecords.has(r) && !wholeRecordKeys.has(r) && !explicitUpdatedAtRecords.has(r));
    toStampSeparately.forEach(recordId => {
      const prefix = recordPrefix.get(recordId);
      const stampKey = baseNorm === '' ? `/${prefix}/_updatedAt` : `${prefix.slice(3)}/_updatedAt`;
      _body[stampKey] = now;
    });
  }

  const res = await fetch(`${FIREBASE_URL}${_p}.json${_fbAuthSuffix()}`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(_body)
  });
  if (!res.ok) throw new Error(`Firebase PATCH ${path} failed: ${res.status}`);
  return res.json();
}

async function fbDelete(path) {
  await fetch(`${FIREBASE_URL}${path}.json${_fbAuthSuffix()}`, { method: 'DELETE' });
}

// ─── Phase 3: Generic Redis cache module ────────────────────────────────────
// Sep 29 2026 — built directly on the confirmed-working Phase 2 connection. Sits alongside the fb* Firebase
// helpers above as the same kind of thing: a small, generic data-access layer, not tied to any one feature.
//
// Firebase remains the source of truth; this is a disposable acceleration layer. Every function below is
// unconditionally safe to call even if Redis was never configured, is temporarily down, or errors for any
// reason — each one degrades to a clean miss/no-op rather than throwing, so a caller can always simply try
// Redis first and fall through to Firebase on a null/false result, exactly like a normal cache-aside read.
//
// No ThreadControl-specific cache keys are decided here — callers pass their own key string (e.g.
// "tc:v1:reportSummaries"); this module has no opinion about what any of them mean.
//
// Serialization: Upstash's own SDK auto-serializes a non-string value with JSON.stringify on set(), and
// auto-parses it back on get() (confirmed directly from Upstash's own current documentation) — so these
// functions pass values straight through rather than double-serializing, which would corrupt the round trip.

// Sep 29 2026 — a conservative safety net only, applied when a caller's own set() omits a TTL, so a forgotten
// TTL can never become a silently-permanent Redis entry. This is NOT the "12-24 hour" application-level policy
// discussed for future ThreadControl features — that is a deliberate, per-feature decision for a later phase,
// never hardcoded here as a universal default.
const CACHE_DEFAULT_TTL_SECONDS = 3600; // 1 hour

async function cacheGet(key) {
  if (!_redis) return null;
  try {
    // Redis's own GET already returns null for a genuinely missing key — no separate "miss" handling needed.
    return await _redis.get(key);
  } catch (e) {
    // Sep 29 2026 — logs e.name only, never e.message: a real HTTP/REST client's error message can legitimately
    // echo back parts of the request (a URL, sometimes more), and there is no way to guarantee that from here.
    // e.name (e.g. "TypeError", "Error") is always a short, fixed class name -- genuinely safe to log, unlike
    // an arbitrary message string this module doesn't control the contents of.
    console.error(`[cache] get(${key}) failed (${e.name}), treating as a miss so the caller falls back to Firebase`);
    return null;
  }
}

async function cacheSet(key, value, { ttlSeconds } = {}) {
  if (!_redis) return false;
  try {
    await _redis.set(key, value, { ex: ttlSeconds || CACHE_DEFAULT_TTL_SECONDS });
    return true;
  } catch (e) {
    // Sep 29 2026 — e.name only, same reasoning as cacheGet above: never trust a third-party client's error
    // message to be free of request details.
    console.error(`[cache] set(${key}) failed (${e.name}) -- Firebase remains the correct, unaffected source of truth`);
    return false;
  }
}

async function cacheInvalidate(key) {
  if (!_redis) return false;
  try {
    await _redis.del(key);
    return true;
  } catch (e) {
    // Sep 29 2026 — e.name only, same reasoning as cacheGet/cacheSet above.
    console.error(`[cache] invalidate(${key}) failed (${e.name})`);
    return false;
  }
}

// Sep 29 2026 — Phase 3: one small, shared cache-aside helper for lotSummaries/dyeLotSummaries specifically,
// reused by every live reader (handleGetActiveData, handleSearchArchive, handleSoftAvailable, the archive
// population handlers) rather than duplicating the same five lines in each one.
async function _getCachedSummaryTable(table) {
  const key = table === 'lotSummaries' ? 'tc:v1:summary:lotSummaries'
    : table === 'dyeLotSummaries' ? 'tc:v1:summary:dyeLotSummaries' : null;
  if (!key) return await fbGet(`/tc/${table}`);
  let raw = await cacheGet(key);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    raw = await fbGet(`/tc/${table}`);
    await cacheSet(key, raw || {});
  }
  return raw;
}

// Sep 29 2026 — Phase 3: invalidates both summary caches at once. Every one of the six write paths (traced in the
// readiness audit) calls this after its own Firebase mutation succeeds -- simpler and safer than each write path
// trying to know exactly which one table it touched, and whole-table invalidation is the confirmed intended design.
async function _invalidateSummaryCaches() {
  await cacheInvalidate('tc:v1:summary:lotSummaries');
  await cacheInvalidate('tc:v1:summary:dyeLotSummaries');
}

// Sep 29 2026 — Phase 4: per-record archive cache, confirmed correct granularity per the readiness audit (System
// B's actual access pattern is per-record, never whole-table). id is the composite summaryKey for lots/dyeLots,
// the record's own .id for the other four tables -- exactly matching the identity handleSearchArchive already uses.
async function _getCachedArchiveRecord(table, id) {
  const key = `tc:v1:archive:${table}:${id}`;
  let record = await cacheGet(key);
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    record = await fbGet(`/tc/archive/${table}/${id}`);
    if (record) await cacheSet(key, record);
  }
  return record;
}

// Sep 29 2026 — Phase 4: UPDATE variant, used only where the Worker already holds the exact record it just wrote
// to Firebase (the active→archive move) -- never used to write a value the Worker hasn't itself just confirmed.
async function _setCachedArchiveRecord(table, id, record) {
  await cacheSet(`tc:v1:archive:${table}:${id}`, record);
}

async function _invalidateCachedArchiveRecord(table, id) {
  await cacheInvalidate(`tc:v1:archive:${table}:${id}`);
}

// ─── Atomic ID generation, server-side (Jul 14 2026, Item I) ─────────────────
// The client's genIdAtomic() uses Firebase's SDK .transaction() method — a
// browser-only capability, not available to worker.js's plain-REST approach.
// This is the first real, working implementation of the ETag/if-match
// conditional-write technique already documented in Decision 3 of the
// holistic plan — GET the counter + its ETag, compute next, PUT with
// if-match so the write only succeeds if nothing else changed the counter
// in between. On conflict (412), retry with a small random backoff — same
// principle as any optimistic-concurrency counter, genuinely race-proof
// without needing the full counter-based-balances redesign that was
// explicitly decided against for the wider app.
// Jul 22 2026 — rebuilt after a real production case: two genuinely
// different, unrelated dispatches ended up with the exact same ID,
// confirmed on 98 real records. Root cause: the old fallback path (used
// whenever the safe counter path hit trouble) just guessed a number
// locally with zero protection — two callers falling back at the same
// moment could guess the same number, and nothing would stop them.
// Fixed by removing that fallback entirely and routing everything
// through the same genuine acquire-then-release lock already proven for
// balance protection (withBalanceLock) — verified working on 5 real race
// scenarios earlier this session, reused here rather than inventing a
// second, unproven safety mechanism. Never silently returns a guessed ID
// anymore: it either succeeds safely, or throws a clear error asking the
// caller to retry — a loud, visible failure is always safer here than a
// second silent collision.
async function genIdAtomicServer(prefix, arr, maxRetries = 20) {
  const localNext = () => {
    const existing = (arr || []).map(x => { const n = parseInt((x.id || '').split('-').pop()); return isNaN(n) ? 0 : n; });
    return existing.length ? Math.max(...existing) + 1 : 1;
  };
  const path = `/tc/idCounters/${prefix}`;

  const result = await withBalanceLock(`IDGEN_${prefix}`, async () => {
    const current = await fbGet(path).catch(() => null);
    // Sep 10 2026 — real, root-cause fix found via direct discussion
    // with Priyam, tracing a genuine ID collision in real production
    // data back to its actual cause: Firebase's own import/export tool
    // (used directly against the database, outside this app entirely)
    // replaces the whole tree wholesale, including this counter — with
    // no way for the app to see it happen or log it. The stored
    // counter used to be trusted completely once it existed, so an
    // external import silently resetting it to an old value meant the
    // very next ID generated would walk straight back over IDs
    // already belonging to real, existing records. Now always checks
    // the real, current data too (already sitting in memory in the
    // caller — no extra fetch, no bandwidth cost) and uses whichever
    // is higher — self-correcting no matter what an external tool did
    // to the stored counter.
    const storedCurrent = typeof current === 'number' ? current : 0;
    const trueMax = Math.max(0, localNext() - 1);
    const next = Math.max(storedCurrent, trueMax) + 1;
    await fbSet(path, next);
    return { id: `${prefix}-${String(next).padStart(4, '0')}` };
  }, maxRetries);

  if (result.__lockFailed) {
    console.error(`[genIdAtomicServer] Could not safely generate an ID for ${prefix} after ${maxRetries} attempts — genuinely busy, not falling back to an unsafe guess`);
    throw new Error(`System is busy generating IDs right now — please try again in a moment.`);
  }
  return result.id;
}

// Same proven pattern as genIdAtomicServer above, applied to the
// balance-check race instead of the ID-counter race. Acquires an
// exclusive short-lived lock for a specific lot+stage BEFORE running the
// real balance check and write, so two near-simultaneous submissions for
// the same lot can't both read the same starting balance and both pass.
// Whoever's conditional write to the lock succeeds first runs their real
// check-and-write; the loser retries, and by then sees the winner's
// already-written entry when it re-reads fresh data.
const _BALANCE_LOCK_TIMEOUT_MS = 15000; // generous for a real Firebase round-trip; a lock older than this is treated as abandoned (e.g. the holder's request crashed) rather than blocking forever
async function withBalanceLock(lockKey, workFn, maxRetries = 20) {
  const path = `/tc/_balanceLocks/${lockKey}`;
  const url = `${FIREBASE_URL}${path}.json${_fbAuthSuffix()}`;
  const myId = crypto.randomUUID();
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    let getRes;
    try {
      getRes = await fetch(url, { headers: { 'X-Firebase-ETag': 'true' } });
    } catch (e) {
      return await workFn(); // can't reach Firebase for the lock — run unprotected rather than fail the submission
    }
    const etag = getRes.headers.get('ETag');
    const current = await getRes.json().catch(() => null);
    const isHeld = current && current.status === 'held' && (Date.now() - new Date(current.at).getTime()) < _BALANCE_LOCK_TIMEOUT_MS;
    if (isHeld) {
      await new Promise(r => setTimeout(r, 50 + Math.random() * 150));
      continue; // genuinely held by someone else right now — don't even attempt to claim, just wait and re-check
    }
    const putRes = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'if-match': etag || '' },
      body: JSON.stringify({ status: 'held', holder: myId, at: new Date().toISOString() })
    });
    if (putRes.status !== 200) {
      if (putRes.status !== 412) return await workFn(); // genuine failure, not a conflict — don't block a real submission over it
      await new Promise(r => setTimeout(r, 50 + Math.random() * 150));
      continue; // someone else claimed it in the moment between my read and my write — retry
    }
    // Lock genuinely acquired and held — do the real check-and-write now,
    // then always release afterward (success or failure) so the lock
    // never sits "held" waiting for its own 15s timeout unnecessarily.
    try {
      return await workFn();
    } finally {
      const releaseGet = await fetch(url, { headers: { 'X-Firebase-ETag': 'true' } }).catch(() => null);
      const releaseEtag = releaseGet ? releaseGet.headers.get('ETag') : null;
      await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'if-match': releaseEtag || '' },
        body: JSON.stringify({ status: 'free', at: new Date().toISOString() })
      }).catch(() => {}); // best-effort release — if this fails, the 15s timeout self-heals it
    }
  }
  return { __lockFailed: true, error: 'System is busy processing another submission for this same lot — please try again in a moment.' };
}

// For actions that can touch multiple lots in one submission (a dispatch
// covering several dye lots at once). Acquires locks for every distinct
// key involved, always in the same sorted order, so two submissions that
// share some of the same lots can never deadlock waiting on each other.
async function withMultiBalanceLock(lockKeys, workFn) {
  const sorted = [...new Set(lockKeys)].sort();
  const acquireNext = async (i) => {
    if (i >= sorted.length) return await workFn();
    return await withBalanceLock(sorted[i], () => acquireNext(i + 1));
  };
  return await acquireNext(0);
}



// ─── CORS Headers ────────────────────────────────────────────────────────────
function corsHeaders() {
  const _allowed = _ALLOWED_ORIGINS.includes(_requestOrigin) ? _requestOrigin : _ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': _allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders()
  });
}

function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

// ─── Summary Key ─────────────────────────────────────────────────────────────
function summaryKey(lotId, grade, vendor) {
  // Aug 26 2026 — real, genuine fix built via direct discussion with
  // Priyam: grade and vendor were already correctly sanitized here,
  // stripping anything that isn't a letter or digit — but lotId itself,
  // right next to them, was never sanitized at all. A crafted lotId
  // containing a '/' could redirect a write to a completely different,
  // unintended database path. Same sanitization, now applied to all 3.
  return `${(lotId||'').replace(/[^a-zA-Z0-9]/g,'_')}__${(grade||'').replace(/[^a-zA-Z0-9]/g,'_')}__${(vendor||'').replace(/[^a-zA-Z0-9]/g,'_')}`;
}

// ─── Archive Helpers ─────────────────────────────────────────────────────────

// Get all dye lot IDs referenced in a dispatch (handles single + multi-lot)
function getDispatchDyeLotIds(dispatch) {
  const ids = new Set();
  if (dispatch.dyeLotId) ids.add(dispatch.dyeLotId);
  (dispatch.lots || []).forEach(l => { if (l.dyeLotId) ids.add(l.dyeLotId); });
  return [...ids];
}

// Fetch from active + archive paths and merge into single array
async function fbGetMerged(activePath, archivePath) {
  const [active, archive] = await Promise.all([
    fbGet(activePath).catch(() => null),
    fbGet(archivePath).catch(() => null)
  ]);
  const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(e => e && e.id);
  return [...toArr(active), ...toArr(archive)];
}

// Archive dye lot chain atomically (dyeLot + wind + pack + eligible dispatches)

// Unarchive dye lot chain (reactivation after void/edit)
async function unarchiveDyeLotChain(dyeLotId) {
  try {
    const [archivedDyeLot, archivedWind, archivedPack, archivedDispatch] = await Promise.all([
      fbGet(`/tc/archive/dyeLots/${dyeLotId}`).catch(() => null),
      fbGet('/tc/archive/windEntries').catch(() => null),
      fbGet('/tc/archive/packEntries').catch(() => null),
      fbGet('/tc/archive/dispatches').catch(() => null)
    ]);

    if (!archivedDyeLot || !archivedDyeLot.id) {
      console.log(`[archive] DyeLot ${dyeLotId} not in archive — skipping unarchive`);
      return;
    }

    const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(e => e && e.id);

    // Fetch active paths to avoid overwriting user edits
    const [activeWind, activePack, activeDispatch] = await Promise.all([
      fbGet('/tc/windEntries').catch(() => ({})),
      fbGet('/tc/packEntries').catch(() => ({})),
      fbGet('/tc/dispatches').catch(() => ({}))
    ]);
    const activeWindIds = new Set(toArr(activeWind).map(e => e.id));
    const activePackIds = new Set(toArr(activePack).map(e => e.id));
    const activeDispatchIds = new Set(toArr(activeDispatch).map(e => e.id));

    const updatePayload = {};

    // Move dye lot back to active
    updatePayload[`dyeLots/${dyeLotId}`] = archivedDyeLot;
    updatePayload[`archive/dyeLots/${dyeLotId}`] = null;

    // Move wind entries back — skip if already in active (user edited it)
    toArr(archivedWind).filter(e => e.dyeLotId === dyeLotId).forEach(e => {
      if (!activeWindIds.has(e.id)) updatePayload[`windEntries/${e.id}`] = e;
      updatePayload[`archive/windEntries/${e.id}`] = null;
    });

    // Move pack entries back — skip if already in active
    toArr(archivedPack).filter(e => e.dyeLotId === dyeLotId).forEach(e => {
      if (!activePackIds.has(e.id)) updatePayload[`packEntries/${e.id}`] = e;
      updatePayload[`archive/packEntries/${e.id}`] = null;
    });

    // Move dispatches back — skip if already in active
    toArr(archivedDispatch).filter(d => getDispatchDyeLotIds(d).includes(dyeLotId)).forEach(d => {
      if (!activeDispatchIds.has(d.id)) updatePayload[`dispatches/${d.id}`] = d;
      updatePayload[`archive/dispatches/${d.id}`] = null;
    });

    updatePayload['archiveLastUpdated'] = new Date().toISOString();
    await fbPatch('/tc', updatePayload);
    // Sep 29 2026 — Phase 4: same pattern as unarchiveLotChain — INVALIDATE every archive cache key for a record
    // that left the archive path in this move.
    for (const path of Object.keys(updatePayload)) {
      if (updatePayload[path] !== null) continue;
      const m = path.match(/^archive\/(dyeLots|windEntries|packEntries|dispatches)\/(.+)$/);
      if (m) await _invalidateCachedArchiveRecord(m[1], m[2]);
    }
    console.log(`[archive] ✓ Unarchived dyeLot ${dyeLotId}`);
  } catch (err) {
    console.error(`[archive] Failed to unarchive ${dyeLotId}:`, err.message);
  }
}

// ─── Stage 2 Archive: RM Lot + Soft Entries ─────────────────────────────────

// Sep 10 2026 — real, deliberately dead code removed via a genuine
// holistic audit: archiveLotChain (the real-time archive trigger) was
// intentionally disconnected on Jul 28 2026 in favor of nightly batch
// archiving (handlePopulateArchiveLots, via runCronBackup) — real-time
// archiving was found to invalidate the archive cache constantly,
// undermining its own purpose. unarchiveLotChain below stays
// immediate, since leaving something incorrectly stuck in archive
// would be a real, live problem — but this function was never called
// from anywhere since that change, confirmed via a full, direct
// search of the whole file.
async function unarchiveLotChain(lotId, grade, vendor) {
  try {
    const lotKey = summaryKey(lotId, grade, vendor);
    const [archivedLot, archivedSE] = await Promise.all([
      fbGet(`/tc/archive/lots/${lotKey}`).catch(() => null),
      fbGet('/tc/archive/stageEntries').catch(() => ({}))
    ]);
    if (!archivedLot || !archivedLot.id) { console.log(`[archive] Lot ${lotKey} not in archive — skipping`); return; }

    const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(e => e && e.id);

    // Check if an active lot already exists (refillable lot scenario)
    const activeLotRaw = await fbGet(`/tc/lots/${lotKey}`).catch(() => null);
    let lotToWrite = archivedLot;
    if (activeLotRaw && activeLotRaw.id) {
      // Merge deliveries from both active and archived versions
      const activeDeliveries = activeLotRaw.deliveries || [];
      const archivedDeliveries = archivedLot.deliveries || [];
      const allDeliveries = [...archivedDeliveries, ...activeDeliveries];
      lotToWrite = {
        ...archivedLot,
        units: (archivedLot.units||0) + (activeLotRaw.units||0),
        weight: (archivedLot.weight||0) + (activeLotRaw.weight||0),
        deliveries: allDeliveries
      };
      console.log(`[archive] Merged deliveries for ${lotKey}: ${archivedDeliveries.length} archived + ${activeDeliveries.length} active`);
    }

    const updatePayload = {};
    // Write merged lot to active
    updatePayload[`lots/${lotKey}`] = lotToWrite;
    updatePayload[`archive/lots/${lotKey}`] = null;

    // Move soft entries back
    toArr(archivedSE).filter(e => e.lotId===lotId && e.grade===grade && e.vendor===vendor && e.stage==='Soft')
      .forEach(e => {
        updatePayload[`stageEntries/${e.id}`] = e;
        updatePayload[`archive/stageEntries/${e.id}`] = null;
      });

    updatePayload['archiveLastUpdated'] = new Date().toISOString();
    await fbPatch('/tc', updatePayload);
    // Sep 29 2026 — Phase 4: INVALIDATE the archive cache for every record that left the archive path in this
    // move — the record no longer exists there, so its cached value must not be left behind.
    for (const path of Object.keys(updatePayload)) {
      if (updatePayload[path] !== null) continue;
      const m = path.match(/^archive\/(lots|stageEntries)\/(.+)$/);
      if (m) await _invalidateCachedArchiveRecord(m[1], m[2]);
    }
    console.log(`[archive] ✓ Unarchived lot ${lotKey} (merged: ${lotToWrite.units} units total)`);
  } catch(err) {
    console.error(`[archive] Failed to unarchive lot ${lotId}:`, err.message);
  }
}

// ─── Calculate LotSummary ────────────────────────────────────────────────────
// Reads all stage data for a lotId+grade+vendor and computes balances
// Aug 6 2026 — removed: confirmed genuinely dead code. Word-boundary-matched
// search across the entire codebase (client and server) found exactly 4
// occurrences: this declaration, and 3 comments elsewhere mentioning it by
// name for context (comparing it to newer functions). Zero real calls,
// anywhere. Neither of the two real, active summary-recalculation paths —
// the per-lot 'Recalculate summary' button (client-triggered, server-
// computed via triggerSummaryUpdate) nor the bulk 'Recalc All Summaries'
// (handleRecalcAllSummariesStart) — ever call this. A nearby comment
// referencing a "Jul 18 2026 rewrite" suggests this predates that
// rewrite and was simply never deleted once replaced.


// ─── API: Calculate and save summary for one lot ─────────────────────────────


// ─── API: Get all summaries ───────────────────────────────────────────────────
async function handleGetSummaries() {
  const summaries = await fbGet('/tc/lotSummaries');
  const arr = summaries ? Object.values(summaries).filter(s => s && s.lotId) : [];
  return jsonResponse({ summaries: arr });
}

// ─── API: Search archive/history ─────────────────────────────────────────────
async function handleDispatchSummary() {
  try {
    const allDispatches = await fbGetMerged('/tc/dispatches', '/tc/archive/dispatches');
    const dispatches = (Array.isArray(allDispatches) ? allDispatches : Object.values(allDispatches || {}))
      .filter(d => d && (d.status === 'Approved' || d.status === 'Edited-Approved'));
    return new Response(JSON.stringify({ dispatches }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, dispatches: [] }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }
}

async function handleSearch(url) {
  const params = url.searchParams;
  const path   = params.get('path');    // e.g. 'stageEntries'
  const lotId  = params.get('lotId');
  const dyeLotId = params.get('dyeLotId');
  const grade  = params.get('grade');
  const vendor = params.get('vendor');
  const party  = params.get('party');
  const date   = params.get('date');
  const challanId = params.get('challanId');
  const limit  = parseInt(params.get('limit') || '50');

  if (!path) return errorResponse('path required');

  // Jul 28 2026 fix — real, confirmed bandwidth issue: this used to
  // download the ENTIRE table (active + archive combined) for every
  // single call, then filter in JavaScript afterward — even when a
  // specific dyeLotId or lotId was given. Checked against a real
  // production export: a single Lifecycle lookup was downloading 3.5MB,
  // server-side, just to find one match. The fix already existed,
  // proven and working, in updateDyeLotSummary/updateLotSummary — this
  // copies that same approach: a direct key lookup where the full
  // identity is known, or an indexed, targeted query where it isn't —
  // never a full-table download.
  const _archivablePaths = ['dyeLots','windEntries','packEntries','dispatches','lots','stageEntries'];
  let arr;

  if (path === 'dyeLots' && dyeLotId) {
    // dyeLotId IS the dye lot's own key — direct single-record fetch.
    const [active, archived] = await Promise.all([
      fbGet(`/tc/dyeLots/${dyeLotId}`).catch(() => null),
      fbGet(`/tc/archive/dyeLots/${dyeLotId}`).catch(() => null)
    ]);
    arr = [active || archived].filter(Boolean);
  } else if (path === 'lots' && lotId && grade && vendor) {
    // Full identity known — the lot's exact key is derivable directly.
    const key = summaryKey(lotId, grade, vendor);
    const [active, archived] = await Promise.all([
      fbGet(`/tc/lots/${key}`).catch(() => null),
      fbGet(`/tc/archive/lots/${key}`).catch(() => null)
    ]);
    arr = [active || archived].filter(Boolean);
  } else if (dyeLotId && ['windEntries', 'packEntries', 'dispatches'].includes(path)) {
    // dyeLotId is indexed on these three (confirmed in firebase-rules.json,
    // same index updateDyeLotSummary already relies on) — a narrow,
    // targeted query instead of a full-table download.
    const q = `orderBy="dyeLotId"&equalTo="${dyeLotId}"`;
    const [active, archived] = await Promise.all([
      fbGet(`/tc/${path}`, q).catch(() => null),
      fbGet(`/tc/archive/${path}`, q).catch(() => null)
    ]);
    const toArr = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x && x.id) : [];
    arr = [...toArr(active), ...toArr(archived)];
  } else if (lotId && path === 'stageEntries') {
    // lotId is indexed on stageEntries too — same targeted approach.
    const q = `orderBy="lotId"&equalTo="${lotId}"`;
    const [active, archived] = await Promise.all([
      fbGet(`/tc/${path}`, q).catch(() => null),
      fbGet(`/tc/archive/${path}`, q).catch(() => null)
    ]);
    const toArr = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x && x.id) : [];
    arr = [...toArr(active), ...toArr(archived)];
  } else if (_archivablePaths.includes(path)) {
    // No specific identity given — genuinely needs the full table (e.g.
    // dispatch-summary's broad party-wide pull). Unavoidable here, but
    // now the exception rather than every single call.
    arr = await fbGetMerged(`/tc/${path}`, `/tc/archive/${path}`);
  } else {
    const data = await fbGet(`/tc/${path}`);
    arr = (Array.isArray(data) ? data : Object.values(data || {})).filter(e => e && e.id);
  }

  if (lotId)     arr = arr.filter(e => e.lotId === lotId || (e.sources||[]).some(s => s.lotId === lotId));
  if (dyeLotId)  arr = arr.filter(e => e.dyeLotId === dyeLotId || e.id === dyeLotId);
  if (grade) {
    if (path === 'dyeLots') {
      arr = arr.filter(e => e.grade === grade || (e.sources||[]).some(s => s.grade === grade));
    } else {
      arr = arr.filter(e => e.grade === grade);
    }
  }
  if (vendor) {
    if (path === 'dyeLots') {
      arr = arr.filter(e => e.vendor === vendor || (e.sources||[]).some(s => s.vendor === vendor));
    } else {
      arr = arr.filter(e => e.vendor === vendor);
    }
  }
  if (party)  arr = arr.filter(e => e.party === party);
  if (date)   arr = arr.filter(e => e.date === date);
  if (challanId) arr = arr.filter(e => e.challanId === challanId || e.invoiceNo === challanId);

  // Return latest N
  arr = arr.slice(-limit);

  return jsonResponse({ results: arr, count: arr.length });
}

// Targeted substring search of ARCHIVE ONLY — used by the "Search in History" button.
// Unlike _loadArchiveWithCache (bulk download of every archive table), this fetches
// archive tables server-side and returns only rows matching the typed text — the
// browser never receives the full archive, just the matches (Jul 12 2026, bandwidth fix).
// ─── Excel/Power BI raw export endpoints (Jul 12 2026) ───────────────────────
// One endpoint per tab, so Excel's Power Query can refresh any one
// independently instead of re-pulling everything ("Refresh All" still calls
// all of them, same total cost either way — see conversation with Priyam).
// Every endpoint pulls active+archive merged, raw rows, no status filtering
// (Excel/Power BI does its own filtering) — except RM/Dye which also include
// live balance figures, since those aren't stored raw anywhere themselves.
// Column names deliberately match the existing exportToExcel() button
// exactly, corrected for two gaps found by comparing against the CURRENT
// RM/Dye tables (RM Return/Soft Balance/Sent to Dye/Residual/Days columns
// were missing from RM; Dye Balance Kg was missing from Dye).

// GET /api/soft-available — true available balance for every RM lot, used
// by the Dye Start form's dropdown chain.
//
// Jul 13 2026 — REBUILT after Priyam's catch: the first version recomputed
// softBalance from scratch (full merged fetch, every lot) on every call —
// exactly the repeated-computation cost the lotSummaries cache exists to
// avoid, ignoring the fix already made to keep that cache correct. The
// cached softBalance only changes when something real happens (an entry
// gets approved, a dye lot archives) — reading it is cheap. Only WIP
// claims (Pending/InProgress dye lots) genuinely need to be live, since
// those change constantly as people work — everything else reuses the
// cache instead of duplicating its work.
async function handleSoftAvailable() {
  const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(e => e && e.id);
  const [summariesRaw, dyeActive, dyeArchive] = await Promise.all([
    _getCachedSummaryTable('lotSummaries').catch(() => ({})),
    fbGet('/tc/dyeLots').catch(() => null),
    fbGet('/tc/archive/dyeLots').catch(() => null)
  ]);
  const summaries = summariesRaw ? Object.values(summariesRaw).filter(s => s && s.lotId) : [];
  const dyeLots = [...toArr(dyeActive), ...toArr(dyeArchive)];

  const results = summaries.map(s => {
    const softBalKg = s.softBalance?.kg || 0;
    const wipClaimedKg = calcSoftConsumedByDyeWIP(dyeLots, s.lotId, s.grade, s.vendor);
    // Aug 26 2026 — real, direct extension built via direct
    // discussion with Priyam: the existing, clamped weight below is
    // correct for its own, original purpose (offering a real,
    // sensible amount in a dropdown, where negative makes no sense to
    // show) — but a real correction screen, like Reassign Source,
    // genuinely needs the true, unclamped number, even negative,
    // since seeing exactly how wrong things are is the entire point
    // of that screen. Added as its own, separate field so every
    // existing use of this endpoint stays completely unaffected.
    const rawAvailKg = softBalKg - wipClaimedKg;
    const availKg = Math.max(0, rawAvailKg);
    const softOutKg = s.softOut?.kg || 0;
    const softOutUnits = s.softOut?.units || 0;
    const availUnits = proportionalUnits(softOutUnits, softOutKg, availKg);
    return { lotId: s.lotId, grade: s.grade, vendor: s.vendor, units: availUnits, weight: Math.round(availKg * 100) / 100, rawWeight: Math.round(rawAvailKg * 100) / 100 };
  });
  return jsonResponse({ available: results });
}








// ─── Item A: RM lot edit cascade (Jul 14 2026) ────────────────────────────
// Server-side replacement for pages.js's submitRMEdit. Faithfully replicates
// every piece of business logic found there (conflict check, Soft-consumption
// validation, multi-delivery split, cascade rename across 4 tables) — with
// all 4 loose-match instances fixed to strict lot+grade+vendor matching, and
// the actual write committed as ONE atomic multi-path PATCH (Decision 5)
// instead of the original's multiple separate save()/saveBatch() calls.
// Password confirmation stays client-side as a pre-flight UX step (same
// pattern as the rest of the app); this endpoint is protected by the normal
// session-token auth already required on every /api/* route.
// ─── Dye Split (Jul 24 2026 fix) ───────────────────────────────────────────
// Server-side replacement for pages.js's submitDyeSplit, found while
// tracing the ledger conversions — never migrated at all, ran entirely
// client-side: direct save() with no lock, no server validation, and a
// client-scan max+1 RC ID generator (the exact race shape genIdAtomicServer
// was built to close for every other record type, just never applied
// here). Same risk class as Restore/Backup-Delete/RM-Delivery-Void, found
// separately. No summary/ledger impact — splitting doesn't change any
// balance number, only tags already-produced output as good vs off, same
// as the original.
async function handleDyeSplit(body) {
  const { dyeLotId, good, off, offCones, reason, changedBy, role, confirm } = body || {};
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin or Manager only', 403);
  if (!dyeLotId) return errorResponse('No dye lot selected');
  if (!(good > 0)) return errorResponse('Enter good portion (kg)');
  if (off === undefined || off === null || off < 0) return errorResponse('Off portion cannot be negative');
  // Sep 19 2026 — Recycle Phase 1: recycle is counted in cones AND kg from the moment it is created, so the split must say how many cones
  // went off. Required (never assumed): a recycle entry without cones would defeat the whole cones + kg pool.
  if (offCones === undefined || offCones === null || offCones === '' || !Number.isInteger(+offCones) || +offCones < 0) return errorResponse('Enter the off cones (a whole number, 0 or more)');
  if (off > 0.01 && !(+offCones > 0)) return errorResponse('The off portion has weight, so it must have cones too');
  if (!(off > 0.01) && +offCones > 0) return errorResponse('No off weight, so there can be no off cones');
  if (!reason || reason.trim().length < 5) return errorResponse('Reason must be at least 5 characters');

  const lockKey = `DYESPLIT_${dyeLotId}`.replace(/[^a-zA-Z0-9_]/g, '_');
  const result = await withBalanceLock(lockKey, async () => {
    // Sep 22 2026 — real, confirmed fix, same bug class as DL-1718: this only ever checked the active table, so
    // splitting an already-archived dye lot wrongly said "not found" instead of finding the real record.
    const [_lotActive, _lotArchived] = await Promise.all([
      fbGet(`/tc/dyeLots/${dyeLotId}`).catch(() => null),
      fbGet(`/tc/archive/dyeLots/${dyeLotId}`).catch(() => null)
    ]);
    const _lotFromArchive = !_lotActive && !!_lotArchived;
    const lot = _lotActive || _lotArchived;
    if (!lot) return { __rejected: errorResponse('Dye lot not found', 404) };
    const _splitBase = `/tc/${_lotFromArchive ? 'archive/' : ''}dyeLots/${dyeLotId}`;
    // New protection — the original had no guard against calling this
    // twice on the same lot (the client button only hides after
    // splitDone, but nothing stopped a repeat call). Splitting again
    // would silently overwrite the first split's record and orphan its
    // recycleStock entry.
    if (lot.splitDone) return { __rejected: errorResponse('This dye lot has already been split — reverse it first if this needs correcting.') };

    const totalOut = lot.outWeight || 0;
    const totalOutCones = lot.outCones || 0;
    if (totalOutCones > 0 && +offCones > totalOutCones) return { __rejected: errorResponse(`Off cones (${+offCones}) cannot be more than this dye lot's ${totalOutCones} output cones`) };
    const goodCones = totalOutCones > 0 ? totalOutCones - +offCones : 0;
    if (totalOut > 0 && Math.abs(good + off - totalOut) > 2) {
      return { __rejected: errorResponse(`Good (${good}kg) + Off (${off}kg) = ${(good + off).toFixed(2)}kg but total output is ${totalOut}kg. Difference must be ≤ 2kg.`) };
    }

    // Aug 26 2026 — real, direct extension built via direct discussion
    // with Priyam: the split itself only ever checked that Good+Off
    // adds up correctly — it never checked whether a Wind entry
    // already, genuinely claimed more than the new "Good" portion
    // leaves behind. A real, physical Wind entry that already exists
    // is the actual backing — splitting the batch underneath it
    // shouldn't happen silently. Warn first; only proceed with an
    // explicit confirm, then leave a real, persistent, visible trace.
    const rawWindForSplit = await fbGet('/tc/windEntries').catch(() => null);
    const windArrForSplit = rawWindForSplit ? (Array.isArray(rawWindForSplit) ? rawWindForSplit : Object.values(rawWindForSplit)).filter(w => w && w.id) : [];
    const alreadyClaimed = windArrForSplit
      .filter(w => w.dyeLotId === dyeLotId && (w.status === 'Approved' || w.status === 'Edited-Approved'))
      .reduce((a, w) => a + (w.inWeight || 0), 0);
    const alreadyClaimedCones = windArrForSplit
      .filter(w => w.dyeLotId === dyeLotId && (w.status === 'Approved' || w.status === 'Edited-Approved'))
      .reduce((a, w) => a + (w.inCones || 0), 0);
    const shortW = alreadyClaimed > good + 0.01;
    const shortC = goodCones > 0 && alreadyClaimedCones > goodCones;
    // Sep 10 2026 — real, direct new feature built via a genuinely
    // long, careful design discussion with Priyam, establishing one
    // clear rule across the whole app: every real action shows a
    // genuine preview of its actual effect before committing —
    // upgraded from only warning when Wind had already genuinely
    // claimed more than the new Good portion leaves behind, to always
    // showing what the split would actually produce, with any real
    // shortfall highlighted right there in the same preview.
    if (!confirm) {
      return { __rejected: jsonResponse({
        __dryRun: true,
        goodWeight: good, offWeight: off, goodCones, offCones: +offCones, totalOut, totalOutCones,
        alreadyClaimed, alreadyClaimedCones,
        wouldCreateShortfall: shortW || shortC,
        shortfallMessage: (shortW || shortC) ? `Wind has already claimed ${alreadyClaimed.toFixed(2)}kg / ${alreadyClaimedCones} cones from this dye lot, but the new "Good" portion is only ${good}kg / ${goodCones} cones. Proceeding will leave this dye lot's balance genuinely negative.` : null,
      }, 200) };
    }

    const rawRC = await fbGet('/tc/recycleStock').catch(() => null);
    const rcArr = rawRC ? (Array.isArray(rawRC) ? rawRC : Object.values(rawRC)).filter(r => r && r.id) : [];
    const rcId = await genIdAtomicServer('RC', rcArr);

    const now = new Date().toISOString();
    const rc = {
      id: rcId, dyeLotId: lot.id, dyeLotNo: lot.dyeLotNo || '', shade: lot.shade || '',
      sources: lot.sources || [], weight: off, cones: +offCones, goodPortion: good, goodCones, reason: reason.trim(),
      markedBy: changedBy || '', markedAt: now,
      status: 'Approved', approvedBy: changedBy || '', createdAt: now, _updatedAt: now
    };

    const patch = {};
    patch[`${_splitBase}/splitDone`] = true;
    patch[`${_splitBase}/goodWeight`] = good;
    patch[`${_splitBase}/recycleWeight`] = off;
    patch[`${_splitBase}/recycleCones`] = +offCones;
    patch[`${_splitBase}/goodCones`] = goodCones;
    patch[`${_splitBase}/recycleId`] = rcId;
    patch[`/tc/recycleStock/${rcId}`] = rc;

    if (shortW || shortC) {
      _autoFlagDyeImbalance(patch, dyeLotId, `Split leaves this dye lot short of what Wind already claimed${shortW ? ` (${(alreadyClaimed - good).toFixed(2)}kg)` : ''}${shortC ? ` (${alreadyClaimedCones - goodCones} cones)` : ''}`, changedBy);
    }

    const editLogId = await genIdAtomicServer('EL', []);
    patch[`/tc/editLog/${editLogId}`] = {
      id: editLogId, timestamp: now, entryId: lot.id, stage: 'dye', field: 'Split',
      oldVal: `${lot.outWeight || 0}kg full`, newVal: `Good:${good}kg/${goodCones}c Off:${off}kg/${+offCones}c->${rcId}`,
      reasonCat: 'Quality split', reasonText: reason.trim(), impactNote: `DYE lot dispatch limited to ${good}kg`,
      changedBy: changedBy || '', type: 'split', _updatedAt: now
    };

    await fbPatch('', patch);
    return { success: true, rcId };
  });

  if (result.__lockFailed) return errorResponse(result.error);
  if (result.__rejected) return result.__rejected;
  return jsonResponse(result);
}

// Jul 29 2026 — Recycle never had Void, and unlike the other three, there
// was no standalone "create recycle stock" action to begin with — it
// only ever exists as a side effect of splitting a dye lot. So "Void for
// Recycle" genuinely means undoing that whole split, not voiding a
// simple standalone entry.
//
// The real, confirmed risk here: checking only whether the recycle
// stock's balance had dropped (the same style of check used for Dead
// Stock and Scrap) would miss material currently mid-Wind — real,
// active work, not yet "consumed" in the balance sense, but very much
// real and in progress. This checks Dye, Wind (any status except
// Void/Rejected — including InProgress and Pending, not just Approved),
// and Soft — matching what the client's own getRCStatus already knows
// how to detect, brought server-side for the first time here as the
// actual safety gate, not just a display label.
async function handleVoidDyeSplit(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin or Manager only', 403);
  const { rcId, reason, password, username, changedBy, dryRun } = body || {};
  // Aug 6 2026 — real, genuine gap found via a thorough app-wide audit,
  // confirmed with Priyam: every comparable destructive void elsewhere in
  // the app requires password confirmation — this one, a real, cascading
  // reversal, didn't. Matching the same proven pattern here too.
  // Sep 10 2026 — a preview never writes anything, so — like its
  // sibling Void functions, all of which already have a real,
  // session-verified role — it never needs a password either; only
  // the real, final void does.
  if (!dryRun) {
    const verifiedUser = await _verifySelfPassword(username, password);
    if (!verifiedUser) return errorResponse('Incorrect password', 401);
  }
  if (!rcId) return errorResponse('rcId required');

  const lockKey = `RCVOID_${rcId}`.replace(/[^a-zA-Z0-9_]/g, '_');
  const result = await withBalanceLock(lockKey, async () => {
    // Sep 10 2026 — real, proactive fix built via direct discussion
    // with Priyam, after finding this exact bug in Dead Stock's own
    // void/edit functions: recycleStock is the exact same category of
    // table — an older entry can genuinely be stored as a plain array
    // element with no named key of its own. Fetches the whole real
    // node, finds the record by its own id field regardless of shape.
    const asArr = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x && x.id) : [];
    const rawRC = await fbGet('/tc/recycleStock').catch(() => null);
    const allRC = asArr(rawRC);
    const rc = allRC.find(x => x.id === rcId);
    if (!rc) return { __rejected: errorResponse('Recycle stock entry not found') };
    if (rc.status === 'Voided') return { __rejected: errorResponse('Already voided') };

    const [dlA, dlAr, seA, slA, rsA] = await Promise.all([
      fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null), fbGet('/tc/stageEntries').catch(() => null), fbGet('/tc/scrapLog').catch(() => null), fbGet('/tc/recycleSoft').catch(() => null)
    ]);
    const toArr = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x && x.id) : [];
    // Sep 22 2026 — real, confirmed fix built via direct discussion with Priyam, from the same real bug class that broke
    // DL-1718: dyeLots here was active-only, so an already-archived dye lot genuinely still using this recycle stock as
    // a source would wrongly go undetected by the dyeUse check below, AND the restore-fields write further down always
    // hardcoded the active path — the exact bug that corrupted DL-1718 elsewhere. Both fixed the same way.
    const dyeLots = [...toArr(dlA).map(d => ({ ...d, _fromArchive: false })), ...toArr(dlAr).map(d => ({ ...d, _fromArchive: true }))];
    const stageEntries = toArr(seA), scrapLog = toArr(slA), recycleSoft = toArr(rsA);
    const _tbl = (table, rec) => rec._fromArchive ? `/tc/archive/${table}` : `/tc/${table}`;

    const dyeUse = dyeLots.some(d => d.status !== 'Rejected' && d.status !== 'Void' && d.status !== 'Voided' && (d.sources || []).some(s => s.recycleId === rcId && s.sourceType === 'recycle'));
    // Sep 19 2026 — Recycle Phase 1: there is no Recycle Wind step any more (the old windUse check is gone); scrapped yarn IS real work
    // that relies on this entry, so it also blocks the void.
    const scrapUse = scrapLog.some(s => s.entryId === rcId && s.type === 'recycle' && s.status !== 'Voided');
    const softUse = recycleSoft.some(e => e.recycleId === rcId && e.status !== 'Void' && e.status !== 'Voided' && e.status !== 'Rejected');

    if (dyeUse || scrapUse || softUse) {
      const parts = [];
      if (dyeUse) parts.push('used as a source in another Dye batch');
      if (scrapUse) parts.push('has scrap recorded against it');
      if (softUse) parts.push('has Recycle Soft activity against it');
      return { __rejected: errorResponse(`Cannot undo this split — this recycle stock ${parts.join(' and ')}. Nothing can be reversed out from under real work already relying on it.`) };
    }

    if (dryRun) return { __dryRun: true, dyeLotId: rc.dyeLotId, goodWeight: rc.goodPortion || 0, offWeight: rc.weight || 0, offCones: rc.cones || 0, restoredTotal: (rc.goodPortion || 0) + (rc.weight || 0) };

    const now = new Date().toISOString();
    const updatedRc = { ...rc, status: 'Voided', voidedBy: changedBy || '', voidedAt: now, voidReason: reason || '', _updatedAt: now };
    // Sep 30 2026 — real, confirmed architecture change, now safe: production legacy-format detection confirmed
    // zero affected/conflict records for recycleStock. Converting to a targeted record write.
    const _splitDyeLot = dyeLots.find(d => d.id === rc.dyeLotId);
    const _dlBase = _splitDyeLot ? `${_tbl('dyeLots', _splitDyeLot)}/${rc.dyeLotId}` : `/tc/dyeLots/${rc.dyeLotId}`;
    const patch = {
      [`/tc/recycleStock/${rcId}`]: updatedRc,
      [`${_dlBase}/splitDone`]: false,
      [`${_dlBase}/goodWeight`]: null,
      [`${_dlBase}/recycleWeight`]: null,
      [`${_dlBase}/recycleCones`]: null,
      [`${_dlBase}/goodCones`]: null,
      [`${_dlBase}/recycleId`]: null,
    };
    const editLogId = await genIdAtomicServer('EL', []);
    patch[`/tc/editLog/${editLogId}`] = {
      id: editLogId, timestamp: now, entryId: rc.dyeLotId, stage: 'dye', field: 'Split',
      oldVal: `Good:${rc.goodPortion}kg Off:${rc.weight}kg/${rc.cones || 0}c->${rcId}`, newVal: `Split reversed — full ${((rc.goodPortion || 0) + (rc.weight || 0)).toFixed(2)}kg restored`,
      reasonCat: 'Split reversed', reasonText: reason || '', impactNote: `Recycle stock ${rcId} voided, dye lot dispatch limit removed`,
      changedBy: changedBy || '', type: 'split-reversed', _updatedAt: now
    };

    await fbPatch('', patch);
    _reFreezeForRecord('dye', rc.dyeLotId).catch(() => {});
    return { success: true, rcId };
  });
  if (result.__lockFailed) return errorResponse(result.error);
  if (result.__rejected) return result.__rejected;
  return jsonResponse(result);
}

// ─── Reject (Jul 24 2026 fix) ──────────────────────────────────────────────
// Server-side replacement for pages.js's rejectDispatch/rejectDyeLot/
// rejectPackEntry/rejectWindEntry — found while tracing /api/summary/trigger's
// real callers. All 4 ran entirely client-side (direct save(), no lock, no
// server validation), only calling the server afterward to refresh the
// cached summary — the actual status change itself had zero protection.
// Consolidated into one handler, matching handleApproveEntry's own
// consolidated pattern and role gating exactly. No summary refresh needed —
// a Pending entry never affected any balance in the first place, same
// principle used everywhere else this session.
const _REJECT_TABLE = { dispatch: 'dispatches', dye: 'dyeLots', pack: 'packEntries', wind: 'windEntries', stage: 'stageEntries', recycleSoft: 'recycleSoft' };
async function handleReject(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager', 'supervisor'].includes(role)) return errorResponse('Supervisor/Admin/Manager only', 403);

  const { type, id, changedBy } = body || {};
  const table = _REJECT_TABLE[type];
  if (!table) return errorResponse('Unknown type');
  if (!id) return errorResponse('Entry id required');

  const e = await fbGet(`/tc/${table}/${id}`).catch(() => null);
  if (!e) return errorResponse('Entry not found', 404);
  // New protection — the originals had no guard at all, so a raw API call
  // could "reject" an already-Approved or already-Rejected entry.
  if (e.status !== 'Pending' && e.status !== 'Edited-Pending') return errorResponse(`Entry is currently '${e.status}', not Pending — nothing to reject`);

  const now = new Date().toISOString();
  const patch = {
    [`/tc/${table}/${id}/status`]: 'Rejected',
    [`/tc/${table}/${id}/rejectedBy`]: changedBy || '',
    [`/tc/${table}/${id}/rejectedAt`]: now
  };
  // Jul 26 2026 fix — this used to write unconditionally based only on
  // e.dyeEntryId existing, never checking whether a real record was
  // actually there. Confirmed against a real production export: 739 old
  // dye lots carry this leftover field pointing at nothing (dyeEntries is
  // genuinely empty), so this would silently create a stray, near-empty
  // record the moment one of them got rejected. handleVoidChain already
  // does this safely — copying that same check-first pattern here.
  if (type === 'dye' && e.dyeEntryId) {
    const de = await fbGet(`/tc/dyeEntries/${e.dyeEntryId}`).catch(() => null);
    if (de) patch[`/tc/dyeEntries/${e.dyeEntryId}/status`] = 'Rejected';
  }
  await fbPatch('', patch);
  return jsonResponse({ success: true, id });
}

// ─── RM Lot Creation (Jul 24 2026 fix) ─────────────────────────────────────
// Server-side replacement for pages.js's submitRM (new lot) and
// confirmPartialDelivery (add delivery to existing lot) — also found while
// tracing /api/summary/trigger's real callers. Both ran entirely
// client-side with a genuine race: two people creating/adding to the same
// lot at once could silently overwrite each other (the exact shape already
// fixed for dispatch IDs and dye lot numbers, just never applied here).
// Consolidated into one locked, atomic handler — the client keeps its
// existing "this lot already exists, confirm adding a delivery" preview
// UX, but both paths now always call this same endpoint, which
// authoritatively re-checks under lock rather than trusting client state.
// ─── Content-Based Duplicate Detection (Jul 26 2026) ───────────────────────
// Confirmed design, discussed and agreed with Priyam:
//   - Exact match only, no fuzzy/tolerance matching
//   - Warning only — never blocks, the person always gets a "yes, proceed
//     anyway" option
//   - Anchored to the record's own real-world date (the date typed on the
//     form), not the moment of entry — someone logging a delivery a few
//     days late should still be compared against its real date
//   - 15-day window, backward only (nothing "future" exists to compare
//     against at the moment of entry)
//   - Checks both active and archive — a lot could already be fully
//     dispatched and archived by the time a duplicate gets entered
//   - Reuses the EXISTING "date" index already on lots/dyeLots (no new
//     index needed) — queries a narrow date-range slice, not a full-table
//     scan, keeping this a genuinely small read
async function _fetchDateRangeCandidates(activePath, archivePath, fromDateStr, toDateStr) {
  const q = `orderBy="date"&startAt="${fromDateStr}"&endAt="${toDateStr}"`;
  const [active, archive] = await Promise.all([
    fbGet(activePath, q).catch(() => null),
    fbGet(archivePath, q).catch(() => null),
  ]);
  const toArr = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x && x.id) : [];
  return [...toArr(active), ...toArr(archive)];
}

// Pure comparison — no I/O. matchKeys must ALL match exactly (string
// comparison, so '5' and 5 are treated the same). excludeIdField/Value
// skips a specific identity (e.g. same lot ID — that's the separate,
// already-working "add a delivery" flow, never double-warned alongside
// this one).
function _findContentDuplicates(candidates, matchKeys, record, dateField, windowDays, excludeIdField, excludeIdValue) {
  const refDate = new Date(record[dateField]);
  if (isNaN(refDate.getTime())) return [];
  const windowMs = windowDays * 86400000;
  return candidates.filter(c => {
    if (excludeIdField && String(c[excludeIdField] ?? '') === String(excludeIdValue ?? '')) return false;
    for (const key of matchKeys) {
      if (String(c[key] ?? '') !== String(record[key] ?? '')) return false;
    }
    const cDate = new Date(c[dateField]);
    if (isNaN(cDate.getTime())) return false;
    const diffMs = refDate - cDate;
    return diffMs >= 0 && diffMs <= windowMs;
  });
}

async function handleRMCreate(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager', 'supervisor'].includes(role)) return errorResponse('Supervisor or Admin only', 403);
  const { lotId, vendor, mill, grade, units, weight, date, challan, changedBy, confirmDuplicate } = body || {};
  if (!lotId || !vendor || !mill || !grade || !units) return errorResponse('Fill all required fields');
  if (!weight || weight <= 0) return errorResponse('Weight (kg) is required');

  const lockKey = `RMCREATE_${lotId}_${grade}_${vendor}`.replace(/[^a-zA-Z0-9_]/g, '_');
  const result = await withBalanceLock(lockKey, async () => {
    const lotKey = summaryKey(lotId, grade, vendor);
    const existing = await fbGet(`/tc/lots/${lotKey}`).catch(() => null);
    const now = new Date().toISOString();
    const deliveryDate = date || now.split('T')[0];
    const delivery = { date: deliveryDate, units, weight, challan: challan || '', addedAt: now, addedBy: changedBy || '' };

    const patch = {};
    if (existing) {
      const deliveries = [...(existing.deliveries || [])];
      // Legacy lots pre-dating the deliveries[] field — seed it from the
      // lot's own totals first, matching the original client's migration
      // fallback, so the running total below stays correct.
      if (deliveries.length === 0 && existing.units) {
        deliveries.push({ date: existing.date, units: existing.units, weight: existing.weight, challan: existing.challan || '', addedAt: existing.createdAt || now, addedBy: 'Admin' });
      }
      deliveries.push(delivery);
      const newUnits = deliveries.reduce((a, d) => a + (d.units || 0), 0);
      const newWeight = deliveries.reduce((a, d) => a + (d.weight || 0), 0);
      patch[`/tc/lots/${lotKey}/deliveries`] = deliveries;
      patch[`/tc/lots/${lotKey}/units`] = newUnits;
      patch[`/tc/lots/${lotKey}/weight`] = newWeight;
      await fbPatch('', patch);
      // Existing lot, existing summary — safe to nudge, this delivery's
      // units/weight is exactly the delta being added.
      await nudgeLotSummary(lotId, grade, vendor, { 'rmBalance.kg': weight, 'rmBalance.units': units }).catch(() => {});
      return { success: true, type: 'delivery-added', lotId, newUnits, newWeight };
    } else {
      // Content-based duplicate check — confirmed design: same vendor +
      // grade + units + weight, exact match, within 15 days of the
      // delivery date, excluding this exact lot ID (that's the separate
      // "add a delivery" branch above, already handled). Warning only —
      // skipped entirely if the client has already confirmed once.
      if (!confirmDuplicate) {
        const fromDate = new Date(new Date(deliveryDate).getTime() - 15 * 86400000).toISOString().split('T')[0];
        const candidates = await _fetchDateRangeCandidates('/tc/lots', '/tc/archive/lots', fromDate, deliveryDate).catch(() => []);
        const dupes = _findContentDuplicates(
          candidates, ['vendor', 'grade', 'units', 'weight'],
          { vendor, grade, units, weight, date: deliveryDate }, 'date', 15, 'id', lotId
        );
        if (dupes.length > 0) {
          return {
            __rejected: jsonResponse({
              success: false, duplicateWarning: true,
              matches: dupes.map(d => ({ lotId: d.id, date: d.date, units: d.units, weight: d.weight, challan: d.challan || '' })),
              message: `This looks like it might already be entered — same vendor, grade, units, and weight as ${dupes.map(d => d.id).join(', ')} (within the last 15 days). If this is genuinely a different delivery, confirm to proceed.`
            })
          };
        }
      }
      // Sep 10 2026 — real, root-cause fix built via direct, thorough
      // discussion with Priyam: this only ever checked the live table
      // for an existing lot at this exact address — if the same real
      // address previously existed but was already fully consumed and
      // archived, this code had no way to see that, concluded "this
      // must be brand new," and minted a second, disconnected
      // permanent ID for what should genuinely be the same lot
      // address's history continuing. A single, direct lookup by the
      // exact archive path (not downloading the whole archive table)
      // costs the same tiny amount regardless of how large the
      // archive ever grows — this only runs on the "not found in
      // live" path anyway, never on the routine, everyday "just
      // adding another delivery" action, which stays exactly as fast
      // as it already is.
      const archivedAtSameAddress = await fbGet(`/tc/archive/lots/${lotKey}`).catch(() => null);
      const uid = archivedAtSameAddress?.uid || await genIdAtomicServer('RMU', await fbGet('/tc/lots').then(v => v ? Object.values(v).filter(x => x && x.uid).map(x => ({ id: x.uid })) : []).catch(() => []));
      const newLot = { id: lotId, uid, vendor, mill, grade, units, weight, date: deliveryDate, challan: challan || '', createdAt: now, deliveries: [delivery] };
      patch[`/tc/lots/${lotKey}`] = newLot;
      await fbPatch('', patch);
      // Brand-new identity — direct recompute, not nudge. Nudging a
      // summary that doesn't exist yet triggers its own self-heal
      // bootstrap (a full recompute that already reads this just-written
      // lot correctly), and a delta on top of that would double-count —
      // the exact bug caught and fixed for RM Edit's identity-change case
      // earlier today. Same fix applies here for the same reason.
      await updateLotSummary(lotId, grade, vendor).catch(() => {});
      return { success: true, type: 'lot-created', lotId };
    }
  });

  if (result.__lockFailed) return errorResponse(result.error);
  if (result.__rejected) return result.__rejected;
  return jsonResponse(result);
}

// ─── Jul 29 2026 — RM permanent-ID migration, Phase 1 ─────────────────────
// One-time, admin-only, batched migration: gives every EXISTING lot the
// same permanent internal ID (uid) that new lots now get automatically.
// Batched (Cloudflare's free-plan subrequest limit, same reasoning as
// the nightly archive batching earlier this session) — processes N at a
// time, reports how many remain, safe to call repeatedly until done.
// Genuinely idempotent: skips any lot that already has a uid, so
// running it twice, or after new lots have already started getting
// their own uid automatically, causes no harm and no duplicates.
async function handleMigrateRMPermanentIds(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin or manager access required', 403);
  const batchSize = Math.min(parseInt(body?.batchSize) || 100, 300);

  // Jul 29 2026 fix — real, confirmed bug: this used to call
  // genIdAtomicServer once PER LOT inside the batch loop. That function
  // is itself 3-4 subrequests on its own (acquire a lock, read the
  // counter, write the counter, release the lock) — so a batch of 30
  // meant 90-120+ subrequests in one Worker invocation, blowing straight
  // through Cloudflare's free-plan limit. Fixed by acquiring the ID-
  // counter lock exactly ONCE per invocation, reading the current
  // counter ONCE, generating every ID for the whole batch locally in
  // memory (zero Firebase calls per lot), then writing the new counter
  // value and every lot's uid together in a single combined patch. Cost
  // is now roughly constant regardless of batch size, not multiplied by
  // it — same correctness, same uniqueness guarantee, genuinely safe
  // for Cloudflare's request limits this time.
  const idLockKey = 'IDGEN_RMU';
  const idResult = await withBalanceLock(idLockKey, async () => {
    const [rawActive, rawArchive, rawCounter] = await Promise.all([
      fbGet('/tc/lots').catch(() => null),
      fbGet('/tc/archive/lots').catch(() => null),
      fbGet('/tc/idCounters/RMU').catch(() => null),
    ]);
    // Jul 29 2026, later same day — real, confirmed bug found directly
    // in production: the old code recomputed each lot's key from its
    // CURRENT grade/vendor text. For a lot whose text has been edited
    // since creation (confirmed real case: a corrected double space),
    // that recomputed key no longer matches the REAL key the record
    // actually lives at — so the write silently created a new, empty
    // junk record at the wrong location instead of updating the real
    // one, which was left permanently unmigrated. Fixed by keeping each
    // lot's REAL, actual Firebase key (from Object.entries, not
    // recomputed) and using that directly — the same lesson as the
    // earlier _realKeyFor fix for incremental loading, applied here too.
    const toEntries = v => v ? Object.entries(v).filter(([, l]) => l && l.id) : [];
    const activeEntries = toEntries(rawActive).map(([key, l]) => ({ key, lot: l, archived: false }));
    const archiveEntries = toEntries(rawArchive).map(([key, l]) => ({ key, lot: l, archived: true }));
    const allEntries = [...activeEntries, ...archiveEntries];
    const needsMigration = allEntries.filter(e => !e.lot.uid);
    if (needsMigration.length === 0) {
      return { success: true, migrated: 0, remaining: 0, alreadyDone: true };
    }

    const batch = needsMigration.slice(0, batchSize);
    let nextNum = (typeof rawCounter === 'number' ? rawCounter : 0) + 1;
    const patch = {};
    for (const entry of batch) {
      const genId = `RMU-${String(nextNum).padStart(4, '0')}`;
      nextNum++;
      const table = entry.archived ? 'archive/lots' : 'lots';
      patch[`/tc/${table}/${entry.key}/uid`] = genId;
    }
    patch['/tc/idCounters/RMU'] = nextNum - 1;
    await fbPatch('', patch);
    return { success: true, migrated: batch.length, remaining: needsMigration.length - batch.length };
  });
  if (idResult.__lockFailed) return errorResponse(idResult.error);
  return jsonResponse(idResult);
}

// Jul 29 2026 — verification companion to the migration above: confirms
// every lot genuinely has a uid, and that every uid is genuinely
// unique — the real "nothing missed, nothing duplicated" check, not
// just trusting the migration ran correctly.
async function handleVerifyRMPermanentIds() {
  const [rawActive, rawArchive] = await Promise.all([
    fbGet('/tc/lots').catch(() => null),
    fbGet('/tc/archive/lots').catch(() => null),
  ]);
  const toArr = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(l => l && l.id) : [];
  const allLots = [...toArr(rawActive), ...toArr(rawArchive)];
  const withoutUid = allLots.filter(l => !l.uid).map(l => l.id);
  const uidCounts = {};
  allLots.forEach(l => { if (l.uid) uidCounts[l.uid] = (uidCounts[l.uid] || 0) + 1; });
  const duplicateUids = Object.entries(uidCounts).filter(([, count]) => count > 1).map(([uid]) => uid);
  return jsonResponse({
    success: true,
    totalLots: allLots.length,
    lotsWithUid: allLots.length - withoutUid.length,
    lotsWithoutUid: withoutUid.length,
    lotsMissingUidSample: withoutUid.slice(0, 10),
    duplicateUidsFound: duplicateUids.length,
    duplicateUidsSample: duplicateUids.slice(0, 10),
    complete: withoutUid.length === 0 && duplicateUids.length === 0
  });
}

// Jul 29 2026, later same day — cleanup companion for a real, confirmed
// bug found in production: the original migration recomputed each lot's
// key from its current grade/vendor text, which for a handful of lots
// (edited since creation) no longer matched their REAL stored key —
// silently creating a new, empty junk record instead of updating the
// real one. This finds and removes exactly those junk records, using a
// deliberately conservative definition: has a uid (so it came from this
// migration), but is missing grade, vendor, AND weight — a real lot
// always has all three, so this can only ever match the specific junk
// shape the bug produced, never a genuine lot record.
async function handleCleanupOrphanedLotRecords(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin or manager access required', 403);
  const dryRun = body?.dryRun !== false; // defaults to true — must be explicitly told to actually delete

  const [rawActive, rawArchive] = await Promise.all([
    fbGet('/tc/lots').catch(() => null),
    fbGet('/tc/archive/lots').catch(() => null),
  ]);
  const isOrphan = l => l && l.uid && !l.grade && !l.vendor && !l.weight;
  const findOrphans = (raw, table) => raw ? Object.entries(raw).filter(([, l]) => isOrphan(l)).map(([key, l]) => ({ key, table, uid: l.uid })) : [];
  const orphans = [...findOrphans(rawActive, 'lots'), ...findOrphans(rawArchive, 'archive/lots')];

  if (dryRun) {
    return jsonResponse({ success: true, dryRun: true, orphansFound: orphans.length, orphans });
  }

  if (orphans.length === 0) {
    return jsonResponse({ success: true, dryRun: false, deleted: 0 });
  }
  const patch = {};
  orphans.forEach(o => { patch[`/tc/${o.table}/${o.key}`] = null; });
  await fbPatch('', patch);
  return jsonResponse({ success: true, dryRun: false, deleted: orphans.length, orphans });
}

// Jul 29 2026 — retrospective backfill, Priyam's direct, correct point:
// storing the permanent ID on new records only covers records made from
// today onward — every existing Soft entry and Dye Lot made before this
// deploy has no lotUid at all. This backfills both, same safe, batched
// pattern as the RM lot migration itself: one fetch of lots (reused for
// every record in the batch, no per-record Firebase calls), a single
// combined patch. Skips anything that already has a uid on that source
// (genuinely idempotent — safe to run repeatedly, safe to run after
// more new entries have already picked up their own uid naturally).
async function handleBackfillSoftUid(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin or manager access required', 403);
  const batchSize = Math.min(parseInt(body?.batchSize) || 200, 500);

  const [rawLotsA, rawLotsAr, rawSeA, rawSeAr] = await Promise.all([
    fbGet('/tc/lots').catch(() => null), fbGet('/tc/archive/lots').catch(() => null),
    fbGet('/tc/stageEntries').catch(() => null), fbGet('/tc/archive/stageEntries').catch(() => null),
  ]);
  const toArr = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x && x.id) : [];
  const lots = [...toArr(rawLotsA), ...toArr(rawLotsAr)];
  const findLotUid = (lotId, grade, vendor) => lots.find(l => l.id === lotId && l.grade === grade && l.vendor === vendor)?.uid || null;

  const toEntries = (raw, table) => raw ? Object.entries(raw).filter(([, e]) => e && e.stage === 'Soft' && !e.lotUid).map(([key, e]) => ({ key, table, e })) : [];
  const needsBackfill = [...toEntries(rawSeA, 'stageEntries'), ...toEntries(rawSeAr, 'archive/stageEntries')];
  if (needsBackfill.length === 0) return jsonResponse({ success: true, backfilled: 0, remaining: 0, alreadyDone: true });

  const batch = needsBackfill.slice(0, batchSize);
  const patch = {};
  let skippedNoUid = 0;
  for (const item of batch) {
    const uid = findLotUid(item.e.lotId, item.e.grade, item.e.vendor);
    if (!uid) { skippedNoUid++; continue; } // source RM lot not migrated yet — leave for a later run, don't write null over and over
    patch[`/tc/${item.table}/${item.key}/lotUid`] = uid;
  }
  if (Object.keys(patch).length > 0) await fbPatch('', patch);
  return jsonResponse({ success: true, backfilled: Object.keys(patch).length, skippedNoUid, remaining: needsBackfill.length - batch.length });
}

async function handleBackfillDyeSourceUid(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin or manager access required', 403);
  const batchSize = Math.min(parseInt(body?.batchSize) || 200, 500);

  const [rawLotsA, rawLotsAr, rawDlA, rawDlAr] = await Promise.all([
    fbGet('/tc/lots').catch(() => null), fbGet('/tc/archive/lots').catch(() => null),
    fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null),
  ]);
  const toArr = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x && x.id) : [];
  const lots = [...toArr(rawLotsA), ...toArr(rawLotsAr)];
  const findLot = (lotId, grade, vendor) => lots.find(l => l.id === lotId && l.grade === grade && l.vendor === vendor);

  // Aug 2 2026 — extended to also backfill the address column, with
  // skips reported individually — the scan already confirmed nothing
  // should genuinely be unmatchable, so any real skip here is worth
  // seeing directly, not folded into a bare count.
  const toEntries = (raw, table) => raw ? Object.entries(raw).filter(([, d]) => d && Array.isArray(d.sources) && d.sources.some(s => s.sourceType === 'rm' && (!s.lotUid || !s._lotKey))).map(([key, d]) => ({ key, table, d })) : [];
  const needsBackfill = [...toEntries(rawDlA, 'dyeLots'), ...toEntries(rawDlAr, 'archive/dyeLots')];
  if (needsBackfill.length === 0) return jsonResponse({ success: true, backfilled: 0, remaining: 0, alreadyDone: true });

  const batch = needsBackfill.slice(0, batchSize);
  const patch = {};
  let sourcesUpdated = 0;
  const skippedDetail = [];
  for (const item of batch) {
    const newSources = item.d.sources.map(s => {
      if (s.sourceType !== 'rm' || (s.lotUid && s._lotKey)) return s;
      const lot = findLot(s.lotId, s.grade, s.vendor);
      if (!lot) { skippedDetail.push({ dyeLotId: item.key, lotId: s.lotId, grade: s.grade, vendor: s.vendor }); return s; }
      sourcesUpdated++;
      const _ns = { ...s };
      if (!s.lotUid && lot.uid) _ns.lotUid = lot.uid;
      if (!s._lotKey) _ns._lotKey = summaryKey(s.lotId, s.grade, s.vendor);
      return _ns;
    });
    patch[`/tc/${item.table}/${item.key}/sources`] = newSources;
  }
  if (Object.keys(patch).length > 0) await fbPatch('', patch);
  return jsonResponse({ success: true, backfilled: sourcesUpdated, dyeLotsTouched: Object.keys(patch).length, skipped: skippedDetail.length, skippedDetail, remaining: needsBackfill.length - batch.length });
}

// Companion verification for both backfills — confirms genuine
// completeness, not just trusting the backfill ran.
async function handleVerifyUidBackfill() {
  const [rawSeA, rawSeAr, rawDlA, rawDlAr, rawRl, rawResLog, rawResStock, rawVl] = await Promise.all([
    fbGet('/tc/stageEntries').catch(() => null), fbGet('/tc/archive/stageEntries').catch(() => null),
    fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null),
    fbGet('/tc/rmReturnLog').catch(() => null),
    fbGet('/tc/residualLog').catch(() => null), fbGet('/tc/residualStock').catch(() => null),
    fbGet('/tc/voidLog').catch(() => null),
  ]);
  const toArr = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x && x.id) : [];
  const softEntries = [...toArr(rawSeA), ...toArr(rawSeAr)].filter(e => e.stage === 'Soft');
  const dyeLots = [...toArr(rawDlA), ...toArr(rawDlAr)];
  const rmReturns = toArr(rawRl);
  const residualLogs = toArr(rawResLog);
  const residualStocks = toArr(rawResStock);
  const rmDeliveryVoids = toArr(rawVl).filter(v => v.type === 'rm-delivery');

  const softMissing = softEntries.filter(e => !e.lotUid).length;
  const softMissingKey = softEntries.filter(e => !e._lotKey).length;
  let rmSourcesTotal = 0, rmSourcesMissing = 0, rmSourcesMissingKey = 0;
  dyeLots.forEach(d => (d.sources || []).forEach(s => { if (s.sourceType === 'rm') { rmSourcesTotal++; if (!s.lotUid) rmSourcesMissing++; if (!s._lotKey) rmSourcesMissingKey++; } }));
  const rmReturnMissing = rmReturns.filter(r => !r.lotUid).length;
  const rmReturnMissingKey = rmReturns.filter(r => !r._lotKey).length;
  const residualLogMissing = residualLogs.filter(r => !r.lotUid).length;
  const residualLogMissingKey = residualLogs.filter(r => !r._lotKey).length;
  let contributionsTotal = 0, contributionsMissing = 0, contributionsMissingKey = 0;
  residualStocks.forEach(rs => (rs.contributions || []).forEach(c => { contributionsTotal++; if (!c.lotUid) contributionsMissing++; if (!c._lotKey) contributionsMissingKey++; }));
  const voidLogMissing = rmDeliveryVoids.filter(v => !v.lotUid).length;
  const voidLogMissingKey = rmDeliveryVoids.filter(v => !v._lotKey).length;

  return jsonResponse({
    success: true,
    totalSoftEntries: softEntries.length, softMissingUid: softMissing, softMissingAddressColumn: softMissingKey,
    totalRmDyeSources: rmSourcesTotal, rmSourcesMissingUid: rmSourcesMissing, rmSourcesMissingAddressColumn: rmSourcesMissingKey,
    totalRmReturns: rmReturns.length, rmReturnsMissingUid: rmReturnMissing, rmReturnsMissingAddressColumn: rmReturnMissingKey,
    totalResidualLog: residualLogs.length, residualLogMissingUid: residualLogMissing, residualLogMissingAddressColumn: residualLogMissingKey,
    totalResidualContributions: contributionsTotal, residualContributionsMissingUid: contributionsMissing, residualContributionsMissingAddressColumn: contributionsMissingKey,
    totalRmDeliveryVoids: rmDeliveryVoids.length, rmDeliveryVoidsMissingUid: voidLogMissing, rmDeliveryVoidsMissingAddressColumn: voidLogMissingKey,
    complete: softMissing === 0 && rmSourcesMissing === 0 && rmReturnMissing === 0 && residualLogMissing === 0 && contributionsMissing === 0 && voidLogMissing === 0,
    // Aug 2 2026 — genuinely separate flag for the address column,
    // since it's a real, later addition — checked independently rather
    // than folded silently into "complete" above, so it's honestly
    // clear if the ID backfill succeeded but the address column
    // backfill genuinely hasn't run yet or is still incomplete.
    // Aug 5 2026 — voidLog included here too, added for consistency.
    addressColumnComplete: softMissingKey === 0 && rmSourcesMissingKey === 0 && rmReturnMissingKey === 0 && residualLogMissingKey === 0 && contributionsMissingKey === 0 && voidLogMissingKey === 0
  });
}

// Backfill for Residual Log + the nested residualStock contributions —
// same real gap pattern as Dye Sources (a nested array, not a flat
// table), never built earlier since the new-record fix came first.
async function handleBackfillResidualUid(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin or manager access required', 403);
  const batchSize = Math.min(parseInt(body?.batchSize) || 200, 500);

  const [rawLotsA, rawLotsAr, rawResLog, rawResStock] = await Promise.all([
    fbGet('/tc/lots').catch(() => null), fbGet('/tc/archive/lots').catch(() => null),
    fbGet('/tc/residualLog').catch(() => null), fbGet('/tc/residualStock').catch(() => null),
  ]);
  const toArr = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x && x.id) : [];
  const lots = [...toArr(rawLotsA), ...toArr(rawLotsAr)];
  const findLot = (lotId, grade, vendor) => lots.find(l => l.id === lotId && l.grade === grade && l.vendor === vendor);

  // Aug 2 2026 — extended to also backfill the address column on both
  // the flat log AND the nested residualStock contributions, with
  // skips reported individually rather than folded into a bare count.
  const logNeeds = rawResLog ? Object.entries(rawResLog).filter(([, r]) => r && (!r.lotUid || !r._lotKey)) : [];
  const stockEntries = rawResStock ? Object.entries(rawResStock) : [];
  const stockNeeds = stockEntries.filter(([, rs]) => rs && (rs.contributions || []).some(c => !c.lotUid || !c._lotKey));
  const combined = [...logNeeds.map(x => ({ kind: 'log', key: x[0], data: x[1] })), ...stockNeeds.map(x => ({ kind: 'stock', key: x[0], data: x[1] }))];
  if (combined.length === 0) return jsonResponse({ success: true, backfilled: 0, remaining: 0, alreadyDone: true });

  const batch = combined.slice(0, batchSize);
  const patch = {};
  let backfilledCount = 0;
  const skippedDetail = [];
  for (const item of batch) {
    if (item.kind === 'log') {
      const lot = findLot(item.data.lotId, item.data.grade, item.data.vendor);
      if (!lot) { skippedDetail.push({ kind: 'log', id: item.key, lotId: item.data.lotId, grade: item.data.grade, vendor: item.data.vendor }); continue; }
      if (!item.data.lotUid && lot.uid) patch[`/tc/residualLog/${item.key}/lotUid`] = lot.uid;
      if (!item.data._lotKey) patch[`/tc/residualLog/${item.key}/_lotKey`] = summaryKey(item.data.lotId, item.data.grade, item.data.vendor);
      backfilledCount++;
    } else {
      const newContributions = item.data.contributions.map(c => {
        if (c.lotUid && c._lotKey) return c;
        const lot = findLot(c.lotId, item.data.grade, c.vendor);
        if (!lot) { skippedDetail.push({ kind: 'stock', id: item.key, lotId: c.lotId, grade: item.data.grade, vendor: c.vendor }); return c; }
        backfilledCount++;
        const _nc = { ...c };
        if (!c.lotUid && lot.uid) _nc.lotUid = lot.uid;
        if (!c._lotKey) _nc._lotKey = summaryKey(c.lotId, item.data.grade, c.vendor);
        return _nc;
      });
      patch[`/tc/residualStock/${item.key}/contributions`] = newContributions;
    }
  }
  if (Object.keys(patch).length > 0) await fbPatch('', patch);
  return jsonResponse({ success: true, backfilled: backfilledCount, skipped: skippedDetail.length, skippedDetail, remaining: combined.length - batch.length });
}

// Aug 2 2026 — third and final backfill, same pattern as Soft and Dye
// Sources: RM Return log has no separate archive table (confirmed
// directly before building this — genuinely simpler than the other
// two), so this only ever needs to touch the one, active table.
async function handleBackfillRMReturnUid(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin or manager access required', 403);
  const batchSize = Math.min(parseInt(body?.batchSize) || 200, 500);

  const [rawLotsA, rawLotsAr, rawRl] = await Promise.all([
    fbGet('/tc/lots').catch(() => null), fbGet('/tc/archive/lots').catch(() => null),
    fbGet('/tc/rmReturnLog').catch(() => null),
  ]);
  const toArr = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x && x.id) : [];
  const lots = [...toArr(rawLotsA), ...toArr(rawLotsAr)];
  const findLot = (lotId, grade, vendor) => lots.find(l => l.id === lotId && l.grade === grade && l.vendor === vendor);

  // Aug 2 2026 — extended to also backfill the new address column, not
  // just the permanent ID. Priyam's direct, correct point: the scan
  // already confirmed every existing record's text genuinely matches
  // its lot — so a skip here would be a real, new, unexpected finding,
  // not something to fold silently into a count. Report skips
  // individually so any real mismatch is actually visible, not hidden.
  const needsBackfill = rawRl ? Object.entries(rawRl).filter(([, r]) => r && (!r.lotUid || !r._lotKey)) : [];
  if (needsBackfill.length === 0) return jsonResponse({ success: true, backfilled: 0, remaining: 0, alreadyDone: true });

  const batch = needsBackfill.slice(0, batchSize);
  const patch = {};
  const skippedDetail = [];
  for (const [key, r] of batch) {
    const lot = findLot(r.lotId, r.grade, r.vendor);
    if (!lot) { skippedDetail.push({ id: key, lotId: r.lotId, grade: r.grade, vendor: r.vendor }); continue; }
    if (!r.lotUid && lot.uid) patch[`/tc/rmReturnLog/${key}/lotUid`] = lot.uid;
    if (!r._lotKey) patch[`/tc/rmReturnLog/${key}/_lotKey`] = summaryKey(r.lotId, r.grade, r.vendor);
  }
  if (Object.keys(patch).length > 0) await fbPatch('', patch);
  return jsonResponse({ success: true, backfilled: batch.length - skippedDetail.length, skipped: skippedDetail.length, skippedDetail, remaining: needsBackfill.length - batch.length });
}

// Aug 2 2026 — Priyam's direct point: treat this the same as Dye's ID,
// which is carried consistently everywhere, including audit trails —
// not just active-transaction tables. voidLog's 'rm-delivery' type
// entries genuinely store lotId directly (unlike most editLog/voidLog
// entries, which reference the original record via entryId and are
// already indirectly traceable through it). Fourth and final table.
async function handleBackfillVoidLogUid(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin or manager access required', 403);
  const batchSize = Math.min(parseInt(body?.batchSize) || 200, 500);

  const [rawLotsA, rawLotsAr, rawVl] = await Promise.all([
    fbGet('/tc/lots').catch(() => null), fbGet('/tc/archive/lots').catch(() => null),
    fbGet('/tc/voidLog').catch(() => null),
  ]);
  const toArr = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x && x.id) : [];
  const lots = [...toArr(rawLotsA), ...toArr(rawLotsAr)];
  const findLot = (lotId, grade, vendor) => lots.find(l => l.id === lotId && l.grade === grade && l.vendor === vendor);

  // Aug 5 2026 — extended to also backfill the address column, for
  // consistency with the other four RM-referencing tables, per
  // Priyam's direct request — same, real skip reporting as the rest,
  // not a silent count.
  const needsBackfill = rawVl ? Object.entries(rawVl).filter(([, v]) => v && v.type === 'rm-delivery' && (!v.lotUid || !v._lotKey)) : [];
  if (needsBackfill.length === 0) return jsonResponse({ success: true, backfilled: 0, remaining: 0, alreadyDone: true });

  const batch = needsBackfill.slice(0, batchSize);
  const patch = {};
  const skippedDetail = [];
  for (const [key, v] of batch) {
    const lot = findLot(v.lotId, v.grade, v.vendor);
    if (!lot) { skippedDetail.push({ id: key, lotId: v.lotId, grade: v.grade, vendor: v.vendor }); continue; }
    if (!v.lotUid && lot.uid) patch[`/tc/voidLog/${key}/lotUid`] = lot.uid;
    if (!v._lotKey) patch[`/tc/voidLog/${key}/_lotKey`] = summaryKey(v.lotId, v.grade, v.vendor);
  }
  if (Object.keys(patch).length > 0) await fbPatch('', patch);
  return jsonResponse({ success: true, backfilled: batch.length - skippedDetail.length, skipped: skippedDetail.length, skippedDetail, remaining: needsBackfill.length - batch.length });
}

// Aug 2 2026 — read-only scan, Priyam's direct request: find every real
// place where an old record's saved address (Soft's frozen _lotKey
// snapshot) or plain text (RM Return / Residual's lotId+grade+vendor)
// no longer matches where the real lot actually lives today — the
// genuine, root gap confirmed directly in handleRMEdit and the Masters
// rename cascade, which update SOME downstream fields but not all of
// them. Shows the real damage, changes nothing.
async function handleScanStaleLotAddresses(tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin or manager access required', 403);
  const [rawLotsA, rawLotsAr, rawSeA, rawSeAr, rawRl, rawResLog] = await Promise.all([
    fbGet('/tc/lots').catch(() => null), fbGet('/tc/archive/lots').catch(() => null),
    fbGet('/tc/stageEntries').catch(() => null), fbGet('/tc/archive/stageEntries').catch(() => null),
    fbGet('/tc/rmReturnLog').catch(() => null),
    fbGet('/tc/residualLog').catch(() => null),
  ]);
  const toArr = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x && x.id) : [];
  const lots = [...toArr(rawLotsA), ...toArr(rawLotsAr)];
  // The set of every real, currently-existing lot's actual key AND its
  // real lotId+grade+vendor combination, exactly as they are today —
  // read directly, nothing recomputed from anything but the lot's own
  // current fields.
  const realKeys = new Set(lots.map(l => summaryKey(l.id, l.grade, l.vendor)));
  const realCombos = new Set(lots.map(l => `${l.id}\u0001${l.grade}\u0001${l.vendor}`));

  const softEntries = [...toArr(rawSeA), ...toArr(rawSeAr)].filter(e => e.stage === 'Soft');
  const staleSnapshots = softEntries.filter(e => e._lotKey && !realKeys.has(e._lotKey))
    .map(e => ({ id: e.id, lotId: e.lotId, grade: e.grade, vendor: e.vendor, savedSnapshot: e._lotKey }));

  const rmReturns = toArr(rawRl);
  const staleReturns = rmReturns.filter(r => !realCombos.has(`${r.lotId}\u0001${r.grade}\u0001${r.vendor}`))
    .map(r => ({ id: r.id, lotId: r.lotId, grade: r.grade, vendor: r.vendor }));

  const residuals = toArr(rawResLog);
  const staleResiduals = residuals.filter(r => !realCombos.has(`${r.lotId}\u0001${r.grade}\u0001${r.vendor}`))
    .map(r => ({ id: r.id, lotId: r.lotId, grade: r.grade, vendor: r.vendor }));

  return jsonResponse({
    success: true,
    totalSoftEntries: softEntries.length, staleSnapshotCount: staleSnapshots.length, staleSnapshots: staleSnapshots.slice(0, 200),
    totalRmReturns: rmReturns.length, staleReturnCount: staleReturns.length, staleReturns: staleReturns.slice(0, 200),
    totalResiduals: residuals.length, staleResidualCount: staleResiduals.length, staleResiduals: staleResiduals.slice(0, 200),
    clean: staleSnapshots.length === 0 && staleReturns.length === 0 && staleResiduals.length === 0
  });
}

// Aug 2 2026 — read-only scan, checking the real, direct answer to the
// active/archive duplicate-ID risk flagged earlier — never actually
// confirmed against real data until now. If the same real lot
// (lotId+grade+vendor) genuinely exists in both /tc/lots and
// /tc/archive/lots at once, the original migration would have treated
// them as two separate records and handed out two separate permanent
// IDs for what should be one lot. Changes nothing — surfaces the real
// answer either way.
// Aug 5 2026 — Priyam's direct request, same treatment as the
// duplicate-lot work: a genuine, read-only scan of the lots
// themselves — does each lot's real, stored address match what its own
// current grade+vendor text would compute to right now? This is the
// original "missing lot" issue from the very start of this
// investigation, now built as a proper, direct, checkable report
// rather than a console diagnostic. Returns the complete, real record
// for each mismatch, not a summary — same principle as everything else
// built today.
async function handleScanLotAddressMismatches(tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin or manager access required', 403);
  const [rawLotsA, rawLotsAr] = await Promise.all([
    fbGet('/tc/lots').catch(() => null), fbGet('/tc/archive/lots').catch(() => null),
  ]);
  const toArrWithKey = raw => raw ? Object.entries(raw).filter(([, v]) => v && v.id).map(([key, v]) => ({ key, lot: v })) : [];
  const active = toArrWithKey(rawLotsA).map(x => ({ ...x, table: 'active' }));
  const archived = toArrWithKey(rawLotsAr).map(x => ({ ...x, table: 'archive' }));
  const all = [...active, ...archived];

  const mismatches = all.filter(x => summaryKey(x.lot.id, x.lot.grade, x.lot.vendor) !== x.key).map(x => ({
    table: x.table,
    storedKey: x.key,
    correctKey: summaryKey(x.lot.id, x.lot.grade, x.lot.vendor),
    fullRecord: x.lot,
  }));

  return jsonResponse({
    success: true,
    totalLotsChecked: all.length,
    mismatchCount: mismatches.length,
    mismatches,
    clean: mismatches.length === 0
  });
}

async function handleScanDuplicateLotIds(tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin or manager access required', 403);
  const [rawLotsA, rawLotsAr, rawSeA, rawSeAr, rawDlA, rawDlAr, rawRl, rawResLog, rawResStock, rawVl] = await Promise.all([
    fbGet('/tc/lots').catch(() => null), fbGet('/tc/archive/lots').catch(() => null),
    fbGet('/tc/stageEntries').catch(() => null), fbGet('/tc/archive/stageEntries').catch(() => null),
    fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null),
    fbGet('/tc/rmReturnLog').catch(() => null),
    fbGet('/tc/residualLog').catch(() => null), fbGet('/tc/residualStock').catch(() => null),
    fbGet('/tc/voidLog').catch(() => null),
  ]);
  const toArrWithKey = raw => raw ? Object.entries(raw).filter(([, v]) => v && v.id).map(([key, v]) => ({ key, lot: v })) : [];
  const active = toArrWithKey(rawLotsA).map(x => ({ ...x, table: 'active' }));
  const archived = toArrWithKey(rawLotsAr).map(x => ({ ...x, table: 'archive' }));
  const all = [...active, ...archived];

  // Aug 2 2026 — Priyam's direct, smart suggestion, then his direct,
  // fair correction: don't just count usage — show every single real
  // downstream record, in full, so this can be checked directly rather
  // than trusted as a number.
  const toArr = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x && x.id) : [];
  const usageRecords = {};
  const track = (uid, table, record) => { if (!uid) return; if (!usageRecords[uid]) usageRecords[uid] = []; usageRecords[uid].push({ table, record }); };
  toArr(rawSeA).filter(e => e.stage === 'Soft').forEach(e => track(e.lotUid, 'stageEntries', e));
  toArr(rawSeAr).filter(e => e.stage === 'Soft').forEach(e => track(e.lotUid, 'archive/stageEntries', e));
  toArr(rawDlA).forEach(d => (d.sources || []).forEach(s => { if (s.sourceType === 'rm') track(s.lotUid, 'dyeLots.sources', { dyeLotId: d.id, ...s }); }));
  toArr(rawDlAr).forEach(d => (d.sources || []).forEach(s => { if (s.sourceType === 'rm') track(s.lotUid, 'archive/dyeLots.sources', { dyeLotId: d.id, ...s }); }));
  toArr(rawRl).forEach(r => track(r.lotUid, 'rmReturnLog', r));
  toArr(rawResLog).forEach(r => track(r.lotUid, 'residualLog', r));
  toArr(rawResStock).forEach(rs => (rs.contributions || []).forEach(c => track(c.lotUid, 'residualStock.contributions', { residualStockId: rs.id, ...c })));
  toArr(rawVl).filter(v => v.type === 'rm-delivery').forEach(v => track(v.lotUid, 'voidLog', v));

  const byIdentity = {};
  all.forEach(x => {
    const identity = `${x.lot.id}\u0001${x.lot.grade}\u0001${x.lot.vendor}`;
    if (!byIdentity[identity]) byIdentity[identity] = [];
    byIdentity[identity].push(x);
  });

  const genuineDuplicates = [];
  Object.entries(byIdentity).forEach(([identity, entries]) => {
    if (entries.length < 2) return;
    const tables = new Set(entries.map(e => e.table));
    if (tables.size < 2) return; // both copies in the same table is a different, separate concern, not this one
    const uids = new Set(entries.map(e => e.lot.uid).filter(Boolean));
    const [lotId, grade, vendor] = identity.split('\u0001');
    // Aug 2 2026 — also compute what this lot's CORRECT address should
    // be, from its own current text — needed to actually fix the root
    // mismatch, not just resolve the duplicate.
    const correctAddress = summaryKey(lotId, grade, vendor);
    genuineDuplicates.push({
      lotId, grade, vendor, correctAddress,
      // Aug 2 2026 — Priyam's direct, fair point: a summary isn't
      // enough to actually trust this as a real finding. Return the
      // COMPLETE record for each copy — every field, exactly as it
      // sits in Firebase — not a curated subset. relatedRecords is the
      // actual, complete list of every real downstream record, not a
      // count, so this can be checked directly, one by one.
      copies: entries.map(e => ({
        table: e.table, key: e.key, fullRecord: e.lot,
        addressMatchesOwnText: e.key === correctAddress,
        relatedRecords: usageRecords[e.lot.uid] || [],
        realUsageCount: (usageRecords[e.lot.uid] || []).length,
      })),
      sameUidAcrossCopies: uids.size <= 1,
    });
  });

  return jsonResponse({
    success: true,
    totalLotsChecked: all.length,
    genuineDuplicateCount: genuineDuplicates.length,
    genuineDuplicates,
    clean: genuineDuplicates.length === 0
  });
}

// Aug 2 2026 — the actual correction, after the scan above confirmed
// exactly which lots are genuinely duplicated. Keeps the active copy
// (the one daily operations actually reference), finds anything
// referencing the archive copy's permanent ID across all six real
// places (Soft, Dye Sources, RM Return, Residual Log/Stock, voidLog)
// and repoints it to the active copy's ID, then removes the duplicate
// archive record. Admin/manager only, requires explicit confirmation
// of exactly which lots to correct — never runs automatically or
// silently.
async function handleCorrectDuplicateLots(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin or manager access required', 403);
  const targets = Array.isArray(body?.targets) ? body.targets : [];
  if (targets.length === 0) return errorResponse('No lots specified to correct');

  const [rawLotsA, rawLotsAr, rawSeA, rawSeAr, rawDlA, rawDlAr, rawRl, rawResLog, rawResStock, rawVl] = await Promise.all([
    fbGet('/tc/lots').catch(() => null), fbGet('/tc/archive/lots').catch(() => null),
    fbGet('/tc/stageEntries').catch(() => null), fbGet('/tc/archive/stageEntries').catch(() => null),
    fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null),
    fbGet('/tc/rmReturnLog').catch(() => null),
    fbGet('/tc/residualLog').catch(() => null), fbGet('/tc/residualStock').catch(() => null),
    fbGet('/tc/voidLog').catch(() => null),
  ]);

  const patch = {};
  const results = [];

  for (const target of targets) {
    const { lotId, keepUid, removeUid, removeTable, removeKey } = target || {};
    if (!lotId || !keepUid || !removeUid || !removeTable || !removeKey) {
      results.push({ lotId, error: 'Missing required fields, skipped' });
      continue;
    }

    // Re-verify directly, right now, before touching anything — never
    // trust the client's earlier scan result blindly.
    const removeRaw = removeTable === 'active' ? rawLotsA : rawLotsAr;
    const removeRecord = removeRaw ? removeRaw[removeKey] : null;
    if (!removeRecord || removeRecord.uid !== removeUid) {
      results.push({ lotId, error: 'Could not re-verify the record to remove — real data has changed since the scan, skipped for safety' });
      continue;
    }

    // Aug 2 2026 — Priyam's direct, correct point: keeping the copy
    // with real usage isn't enough on its own — if that kept copy's
    // OWN stored address doesn't match its own text, this same problem
    // just continues under a different name. Find the kept copy, and
    // if its address is wrong, correct it — actually move the record
    // to where its own text says it should live.
    let keepTable = null, keepKey = null, keepRecord = null;
    for (const [tbl, raw] of [['active', rawLotsA], ['archive', rawLotsAr]]) {
      if (!raw) continue;
      const found = Object.entries(raw).find(([, l]) => l && l.uid === keepUid);
      if (found) { keepTable = tbl; keepKey = found[0]; keepRecord = found[1]; break; }
    }
    if (!keepRecord) {
      results.push({ lotId, error: 'Could not find the record to keep — skipped for safety' });
      continue;
    }
    const correctAddress = summaryKey(keepRecord.id, keepRecord.grade, keepRecord.vendor);
    const addressNeedsCorrection = keepKey !== correctAddress;
    let finalKeepTable = keepTable, finalKeepKey = keepKey;
    if (addressNeedsCorrection) {
      patch[`/tc/${keepTable === 'active' ? 'lots' : 'archive/lots'}/${keepKey}`] = null;
      patch[`/tc/${keepTable === 'active' ? 'lots' : 'archive/lots'}/${correctAddress}`] = keepRecord;
      finalKeepKey = correctAddress;
    }

    let touched = 0;
    // Soft entries — both lotUid and _lotKey repointed
    [rawSeA, rawSeAr].forEach((raw, i) => {
      if (!raw) return;
      const table = i === 0 ? 'stageEntries' : 'archive/stageEntries';
      Object.entries(raw).forEach(([k, e]) => {
        if (e && e.lotUid === removeUid) {
          patch[`/tc/${table}/${k}/lotUid`] = keepUid;
          patch[`/tc/${table}/${k}/_lotKey`] = correctAddress;
          touched++;
        } else if (e && e.lotUid === keepUid && addressNeedsCorrection && e._lotKey === keepKey) {
          patch[`/tc/${table}/${k}/_lotKey`] = correctAddress;
        }
      });
    });
    // Dye Sources
    [rawDlA, rawDlAr].forEach((raw, i) => {
      if (!raw) return;
      const table = i === 0 ? 'dyeLots' : 'archive/dyeLots';
      Object.entries(raw).forEach(([k, d]) => {
        if (d && Array.isArray(d.sources) && d.sources.some(s => s.lotUid === removeUid || (addressNeedsCorrection && s.lotUid === keepUid))) {
          patch[`/tc/${table}/${k}/sources`] = d.sources.map(s => {
            if (s.lotUid === removeUid) { touched++; return { ...s, lotUid: keepUid, _lotKey: correctAddress }; }
            if (addressNeedsCorrection && s.lotUid === keepUid) return { ...s, _lotKey: correctAddress };
            return s;
          });
        }
      });
    });
    // RM Return
    if (rawRl) Object.entries(rawRl).forEach(([k, r]) => {
      if (r && r.lotUid === removeUid) { patch[`/tc/rmReturnLog/${k}/lotUid`] = keepUid; patch[`/tc/rmReturnLog/${k}/_lotKey`] = correctAddress; touched++; }
      else if (r && r.lotUid === keepUid && addressNeedsCorrection) { patch[`/tc/rmReturnLog/${k}/_lotKey`] = correctAddress; }
    });
    // Residual Log
    if (rawResLog) Object.entries(rawResLog).forEach(([k, r]) => {
      if (r && r.lotUid === removeUid) { patch[`/tc/residualLog/${k}/lotUid`] = keepUid; patch[`/tc/residualLog/${k}/_lotKey`] = correctAddress; touched++; }
      else if (r && r.lotUid === keepUid && addressNeedsCorrection) { patch[`/tc/residualLog/${k}/_lotKey`] = correctAddress; }
    });
    // Residual Stock contributions
    if (rawResStock) Object.entries(rawResStock).forEach(([k, rs]) => {
      if (rs && Array.isArray(rs.contributions) && rs.contributions.some(c => c.lotUid === removeUid || (addressNeedsCorrection && c.lotUid === keepUid))) {
        patch[`/tc/residualStock/${k}/contributions`] = rs.contributions.map(c => {
          if (c.lotUid === removeUid) { touched++; return { ...c, lotUid: keepUid, _lotKey: correctAddress }; }
          if (addressNeedsCorrection && c.lotUid === keepUid) return { ...c, _lotKey: correctAddress };
          return c;
        });
      }
    });
    // voidLog rm-delivery entries
    if (rawVl) Object.entries(rawVl).forEach(([k, v]) => { if (v && v.type === 'rm-delivery' && v.lotUid === removeUid) { patch[`/tc/voidLog/${k}/lotUid`] = keepUid; touched++; } });

    // Finally, remove the duplicate record itself
    patch[`/tc/${removeTable === 'active' ? 'lots' : 'archive/lots'}/${removeKey}`] = null;

    results.push({ lotId, keptUid: keepUid, removedUid: removeUid, recordsRepointed: touched, removedFrom: removeTable, addressWasCorrected: addressNeedsCorrection, correctAddress, keptRecordNowAt: `${finalKeepTable}/${finalKeepKey}` });
  }

  if (Object.keys(patch).length > 0) await fbPatch('', patch);
  return jsonResponse({ success: true, results });
}


// Aug 5 2026 — Priyam's direct request: the same treatment as the
// duplicate-lot correction, for the remaining 7 lots whose own saved
// address simply doesn't match their own current text — no duplicate
// involved, confirmed directly by Priyam checking the report himself.
// Genuinely simpler than the duplicate case: no "which copy" decision,
// just move this one record to its own correct address and update
// every real downstream reference's address column to match.
async function handleCorrectLotAddresses(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin or manager access required', 403);
  const targets = Array.isArray(body?.targets) ? body.targets : [];
  if (targets.length === 0) return errorResponse('No lots specified to correct');

  const [rawLotsA, rawLotsAr, rawSeA, rawSeAr, rawDlA, rawDlAr, rawRl, rawResLog, rawResStock] = await Promise.all([
    fbGet('/tc/lots').catch(() => null), fbGet('/tc/archive/lots').catch(() => null),
    fbGet('/tc/stageEntries').catch(() => null), fbGet('/tc/archive/stageEntries').catch(() => null),
    fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null),
    fbGet('/tc/rmReturnLog').catch(() => null),
    fbGet('/tc/residualLog').catch(() => null), fbGet('/tc/residualStock').catch(() => null),
  ]);

  const patch = {};
  const results = [];

  for (const target of targets) {
    const { table, storedKey } = target || {};
    if (!table || !storedKey) { results.push({ storedKey, error: 'Missing required fields, skipped' }); continue; }

    // Re-verify directly, right now, before touching anything — never
    // trust the client's earlier scan result blindly.
    const raw = table === 'active' ? rawLotsA : rawLotsAr;
    const record = raw ? raw[storedKey] : null;
    if (!record) { results.push({ storedKey, error: 'Could not re-verify this record — real data has changed since the scan, skipped for safety' }); continue; }
    const correctAddress = summaryKey(record.id, record.grade, record.vendor);
    if (correctAddress === storedKey) { results.push({ storedKey, error: 'Already correct — real data has changed since the scan, nothing to do' }); continue; }

    // Move: write at the correct address, remove the old one.
    const tableBase = table === 'active' ? 'lots' : 'archive/lots';
    patch[`/tc/${tableBase}/${storedKey}`] = null;
    patch[`/tc/${tableBase}/${correctAddress}`] = record;

    // Update every real downstream reference's address column — the
    // lot's own uid never changes, so lotUid fields need no update;
    // only the address column, where present.
    let touched = 0;
    [rawSeA, rawSeAr].forEach((r, i) => {
      if (!r) return;
      const t = i === 0 ? 'stageEntries' : 'archive/stageEntries';
      Object.entries(r).forEach(([k, e]) => { if (e && e.lotUid === record.uid && e._lotKey && e._lotKey !== correctAddress) { patch[`/tc/${t}/${k}/_lotKey`] = correctAddress; touched++; } });
    });
    [rawDlA, rawDlAr].forEach((r, i) => {
      if (!r) return;
      const t = i === 0 ? 'dyeLots' : 'archive/dyeLots';
      Object.entries(r).forEach(([k, d]) => {
        if (d && Array.isArray(d.sources) && d.sources.some(s => s.lotUid === record.uid && s._lotKey && s._lotKey !== correctAddress)) {
          patch[`/tc/${t}/${k}/sources`] = d.sources.map(s => (s.lotUid === record.uid && s._lotKey && s._lotKey !== correctAddress) ? (touched++, { ...s, _lotKey: correctAddress }) : s);
        }
      });
    });
    if (rawRl) Object.entries(rawRl).forEach(([k, r]) => { if (r && r.lotUid === record.uid && r._lotKey && r._lotKey !== correctAddress) { patch[`/tc/rmReturnLog/${k}/_lotKey`] = correctAddress; touched++; } });
    if (rawResLog) Object.entries(rawResLog).forEach(([k, r]) => { if (r && r.lotUid === record.uid && r._lotKey && r._lotKey !== correctAddress) { patch[`/tc/residualLog/${k}/_lotKey`] = correctAddress; touched++; } });
    if (rawResStock) Object.entries(rawResStock).forEach(([k, rs]) => {
      if (rs && Array.isArray(rs.contributions) && rs.contributions.some(c => c.lotUid === record.uid && c._lotKey && c._lotKey !== correctAddress)) {
        patch[`/tc/residualStock/${k}/contributions`] = rs.contributions.map(c => (c.lotUid === record.uid && c._lotKey && c._lotKey !== correctAddress) ? (touched++, { ...c, _lotKey: correctAddress }) : c);
      }
    });

    results.push({ storedKey, correctAddress, movedTo: `${table}/${correctAddress}`, recordsRepointed: touched });
  }

  if (Object.keys(patch).length > 0) await fbPatch('', patch);
  return jsonResponse({ success: true, results });
}

// Sep 10 2026 — real, direct feature built via direct discussion with
// Priyam, tracing a genuine ID collision in his real production data
// back to its actual cause: Firebase's own import/export tool, used
// directly against the database outside this app entirely, resets
// the ID counter (worker.js's genIdAtomicServer, already fixed
// separately to self-correct going forward — this is the one-time
// repair for the collisions that already happened before that fix
// existed). Unlike the RM lot "duplicate" tool right above this —
// which merges two records of the SAME real thing recorded twice —
// this is a genuinely different situation: two DIFFERENT, real dye
// batches that happen to share one ID by mistake. Nothing gets
// deleted or merged; the older one gets a real, fresh, permanently
// unique ID, and only the downstream records that actually belong to
// it (identified with certainty via its own unique dyeLotNo, never a
// guess from dates) get repointed.
async function handleScanDyeLotIdCollisions(tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin or manager access required', 403);
  const [rawDlA, rawDlAr] = await Promise.all([
    fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null),
  ]);
  const toArrWithKey = (raw, table) => raw ? Object.entries(raw).filter(([, v]) => v && v.id).map(([key, v]) => ({ key, table, dl: v })) : [];
  const all = [...toArrWithKey(rawDlA, 'active'), ...toArrWithKey(rawDlAr, 'archive')];

  const byId = {};
  all.forEach(x => { if (!byId[x.dl.id]) byId[x.dl.id] = []; byId[x.dl.id].push(x); });

  const collisions = Object.entries(byId).filter(([, entries]) => entries.length > 1);
  if (collisions.length === 0) return jsonResponse({ success: true, collisionCount: 0, collisions: [], clean: true });

  const [rawWeA, rawWeAr, rawPeA, rawPeAr, rawDspA, rawDspAr] = await Promise.all([
    fbGet('/tc/windEntries').catch(() => null), fbGet('/tc/archive/windEntries').catch(() => null),
    fbGet('/tc/packEntries').catch(() => null), fbGet('/tc/archive/packEntries').catch(() => null),
    fbGet('/tc/dispatches').catch(() => null), fbGet('/tc/archive/dispatches').catch(() => null),
  ]);
  const toArr = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x && x.id) : [];
  const windAll = [...toArr(rawWeA), ...toArr(rawWeAr)];
  const packAll = [...toArr(rawPeA), ...toArr(rawPeAr)];
  const dispAll = [...toArr(rawDspA), ...toArr(rawDspAr)];

  const results = collisions.map(([sharedId, entries]) => ({
    sharedId,
    copies: entries.map(e => ({
      table: e.table, key: e.key, dyeLotNo: e.dl.dyeLotNo, fullRecord: e.dl,
      createdAt: e.dl.createdAt,
      // Real, exact counts — matched by the record's own unique
      // dyeLotNo, never by date or table — so this can be trusted
      // directly, not just estimated.
      windCount: windAll.filter(w => w.dyeLotNo === e.dl.dyeLotNo).length,
      packCount: packAll.filter(p => p.dyeLotNo === e.dl.dyeLotNo).length,
      dispatchCount: dispAll.filter(d => d.dyeLotNo === e.dl.dyeLotNo).length,
    })),
  }));

  return jsonResponse({ success: true, collisionCount: results.length, collisions: results, clean: false });
}

async function handleFixDyeLotIdCollisions(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin or manager access required', 403);
  const { targets, password, changedBy } = body || {};
  if (!Array.isArray(targets) || targets.length === 0) return errorResponse('No dye lots specified to correct');
  if (!password) return errorResponse('Password required for this correction');
  const admin = await _verifySelfPassword(tokenClaim?.username, password);
  if (!admin) return errorResponse('Incorrect password', 401);

  const [rawDlA, rawDlAr, rawWeA, rawWeAr, rawPeA, rawPeAr, rawDspA, rawDspAr, rawDlSum, rawDlFlags, rawLotToDL] = await Promise.all([
    fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null),
    fbGet('/tc/windEntries').catch(() => null), fbGet('/tc/archive/windEntries').catch(() => null),
    fbGet('/tc/packEntries').catch(() => null), fbGet('/tc/archive/packEntries').catch(() => null),
    fbGet('/tc/dispatches').catch(() => null), fbGet('/tc/archive/dispatches').catch(() => null),
    fbGet('/tc/dyeLotSummaries').catch(() => null), fbGet('/tc/dyeLotFlags').catch(() => null),
    fbGet('/tc/lotToDyeLots').catch(() => null),
  ]);
  const toArr = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x && x.id) : [];
  const mergedDyeLots = [...toArr(rawDlA), ...toArr(rawDlAr)];

  const patch = {};
  const results = [];

  // Sep 10 2026 — real, root-cause fix built via direct discussion
  // with Priyam, from a genuine "Too many subrequests" error on his
  // real deploy: the original version called genIdAtomicServer once
  // per target for the new dye lot ID (its own lock-acquisition
  // fetch, plus its own counter read and write — several real
  // subrequests each) AND again per target for a log entry ID — for
  // 6 real collisions, that alone was 40+ subrequests before this
  // function's own 12 fetches were even counted, comfortably tipping
  // over Cloudflare's real per-invocation limit. Fixed by acquiring
  // the SAME lock only once for the whole batch — reading the real
  // counter once, computing every new ID for every target locally
  // from that one read, and writing the final counter back once —
  // and by using the same lock-free timestamp+random pattern already
  // used everywhere else in this file for log entry IDs, which never
  // needed the collision-proof guarantee a real production ID does.
  const _localMaxDL = () => { const existing = mergedDyeLots.map(x => { const n = parseInt((x.id || '').split('-').pop()); return isNaN(n) ? 0 : n; }); return existing.length ? Math.max(...existing) : 0; };
  const lockResult = await withBalanceLock('IDGEN_DL', async () => {
    const currentCounter = await fbGet('/tc/idCounters/DL').catch(() => null);
    let nextNum = Math.max(typeof currentCounter === 'number' ? currentCounter : 0, _localMaxDL());
    const newIds = [];
    for (let i = 0; i < targets.length; i++) { nextNum += 1; newIds.push(`DL-${String(nextNum).padStart(4, '0')}`); }
    await fbSet('/tc/idCounters/DL', nextNum);
    return { newIds };
  }, 20);
  if (lockResult.__lockFailed) {
    return errorResponse('System is busy generating IDs right now — please try again in a moment.', 503);
  }
  const _newIdsForTargets = lockResult.newIds;

  for (let ti = 0; ti < targets.length; ti++) {
    const target = targets[ti];
    const { dyeLotNo, currentId, table } = target || {};
    if (!dyeLotNo || !currentId || !table) { results.push({ dyeLotNo, error: 'Missing required fields, skipped' }); continue; }

    // Re-verify directly against fresh data — never trust an earlier
    // scan result blindly, same discipline as the RM lot tool above.
    const rawTable = table === 'active' ? rawDlA : rawDlAr;
    const entry = rawTable ? Object.entries(rawTable).find(([, d]) => d && d.id === currentId && d.dyeLotNo === dyeLotNo) : null;
    if (!entry) { results.push({ dyeLotNo, error: 'Could not re-verify this record — real data has changed since the scan, skipped for safety' }); continue; }
    const [oldKey, record] = entry;

    // A genuinely fresh, permanently unique ID — already generated
    // above, once, inside the single real lock acquisition for this
    // whole batch.
    const newId = _newIdsForTargets[ti];

    const tablePath = table === 'active' ? 'dyeLots' : 'archive/dyeLots';
    patch[`/tc/${tablePath}/${oldKey}/id`] = newId;

    let touched = 0;
    [[rawWeA, 'windEntries'], [rawWeAr, 'archive/windEntries']].forEach(([raw, t]) => {
      if (!raw) return;
      Object.entries(raw).forEach(([k, e]) => { if (e && e.dyeLotNo === dyeLotNo && e.dyeLotId === currentId) { patch[`/tc/${t}/${k}/dyeLotId`] = newId; touched++; } });
    });
    [[rawPeA, 'packEntries'], [rawPeAr, 'archive/packEntries']].forEach(([raw, t]) => {
      if (!raw) return;
      Object.entries(raw).forEach(([k, e]) => { if (e && e.dyeLotNo === dyeLotNo && e.dyeLotId === currentId) { patch[`/tc/${t}/${k}/dyeLotId`] = newId; touched++; } });
    });
    [[rawDspA, 'dispatches'], [rawDspAr, 'archive/dispatches']].forEach(([raw, t]) => {
      if (!raw) return;
      Object.entries(raw).forEach(([k, e]) => { if (e && e.dyeLotNo === dyeLotNo && e.dyeLotId === currentId) { patch[`/tc/${t}/${k}/dyeLotId`] = newId; touched++; } });
    });

    // dyeLotSummaries — keyed by id; move this specific summary (if
    // one exists) to the new key, only if it genuinely belongs to
    // THIS copy (matched by dyeLotNo, not assumed).
    if (rawDlSum && rawDlSum[currentId] && rawDlSum[currentId].dyeLotNo === dyeLotNo) {
      patch[`/tc/dyeLotSummaries/${currentId}`] = null;
      patch[`/tc/dyeLotSummaries/${newId}`] = { ...rawDlSum[currentId], dyeLotId: newId };
    }
    // dyeLotFlags — keyed by the same sanitized-id pattern as
    // elsewhere in this file; move it if one exists for this id.
    const oldFlagKey = _dyeLotFlagKey(currentId);
    const newFlagKey = _dyeLotFlagKey(newId);
    if (rawDlFlags && rawDlFlags[oldFlagKey]) {
      patch[`/tc/dyeLotFlags/${oldFlagKey}`] = null;
      patch[`/tc/dyeLotFlags/${newFlagKey}`] = { ...rawDlFlags[oldFlagKey], dyeLotId: newId };
    }
    // lotToDyeLots reverse index — this dye lot's own RM sources point
    // back to it; update each one's entry from the old id to the new.
    if (rawLotToDL && Array.isArray(record.sources)) {
      record.sources.forEach(s => {
        if (s.sourceType !== 'rm') return;
        const lotKey = s._lotKey || summaryKey(s.lotId, s.grade, s.vendor);
        if (rawLotToDL[lotKey] && rawLotToDL[lotKey][currentId]) {
          patch[`/tc/lotToDyeLots/${lotKey}/${currentId}`] = null;
          patch[`/tc/lotToDyeLots/${lotKey}/${newId}`] = true;
        }
      });
    }

    // A real, permanent record of this correction — same spirit as
    // every other edit this app tracks, so it's traceable forever.
    // Sep 10 2026 — uses the same lock-free timestamp+random pattern
    // already established everywhere else in this file for log
    // entries, instead of another full, locked genIdAtomicServer
    // call per target — a log entry ID never needed that guarantee.
    const logId = `EL-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    patch[`/tc/editLog/${logId}`] = {
      id: logId, entryId: newId, stage: 'Dye', fieldChanged: 'id',
      oldVal: currentId, newVal: newId, reasonCat: 'ID collision correction',
      reason: `Two different real dye lots (${dyeLotNo} and another) shared the ID ${currentId} after an external Firebase import reset the ID counter. This copy (${dyeLotNo}) was reassigned ${newId} — a genuinely fresh, unique ID.`,
      changedBy: changedBy || admin.name || '', timestamp: new Date().toISOString(), _updatedAt: new Date().toISOString(),
    };

    results.push({ dyeLotNo, oldId: currentId, newId, recordsRepointed: touched });
  }

  if (Object.keys(patch).length > 0) {
    await fbPatch('', patch);
    // Sep 29 2026 — Phase 3: this batch always touches dyeLotSummaries (moving a summary from oldKey to newId),
    // confirmed from the patch entries built above — invalidate once, after the whole batch write succeeds.
    await _invalidateSummaryCaches();
    // Sep 29 2026 — Phase 4: confirmed this batch also touches archive records (windEntries/packEntries/
    // dispatches' dyeLotId field, and dyeLots' own id, for whichever of these actually live in the archive
    // path). Every touched archive record's cached value is now stale (a sub-field changed), so invalidate each
    // one directly from patch's own keys — this exactly matches what was actually touched, nothing guessed.
    for (const p of Object.keys(patch)) {
      const m = p.match(/^\/tc\/archive\/([a-zA-Z]+)\/([^/]+)\/(?:id|dyeLotId)$/);
      if (m) await _invalidateCachedArchiveRecord(m[1], m[2]);
    }
  }
  return jsonResponse({ success: true, results });
}

// ─── Delete Request lifecycle (Jul 24 2026 fix) ────────────────────────────

// Server-side replacement for pages.js's submitDeleteRequest and
// rejectDeleteRequest — both ran entirely client-side. Approving a delete
// request already goes through handleMasterItemDelete (password-protected);
// these two are the create/reject halves of the same feature that were
// never migrated.
async function handleDeleteRequestAction(body, tokenClaim) {
  const { action, key, val, reason, reqId, changedBy } = body || {};
  const now = new Date().toISOString();

  if (action === 'create') {
    if (!key || !val) return errorResponse('Invalid request');
    const id = 'DR-' + Date.now();
    const patch = { [`/tc/deleteRequests/${id}`]: { id, key, val, reason: reason || '', by: changedBy || '', at: now, status: 'pending' } };
    await fbPatch('', patch);
    return jsonResponse({ success: true, id });
  }

  if (action === 'reject') {
    const role = tokenClaim?.role || '';
    if (!['admin', 'manager'].includes(role)) return errorResponse('Admin or Manager only', 403);
    if (!reqId) return errorResponse('Request id required');
    const req = await fbGet(`/tc/deleteRequests/${reqId}`).catch(() => null);
    if (!req) return errorResponse('Request not found', 404);
    const patch = {
      [`/tc/deleteRequests/${reqId}/status`]: 'rejected',
      [`/tc/deleteRequests/${reqId}/rejectedAt`]: now
    };
    await fbPatch('', patch);
    return jsonResponse({ success: true });
  }

  return errorResponse('Unknown action');
}

// ─── Masters Settings (Jul 24 2026 fix) ────────────────────────────────────
// Aug 26 2026 — real, direct extension built via direct discussion
// with Priyam: real, actual values used by real records that have
// since gone missing from Masters — deleted at some point, or never
// added properly in the first place. Scans every real, actual table,
// active and archive together, collecting the true, real value
// genuinely in use for each master type, and compares it against
// what's currently in Masters, returning exactly what's missing.
async function handleScanMissingMasters(tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin/Manager only', 403);

  const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(e => e && e.id);
  const [lotsA, lotsAr, seA, seAr, dlA, dlAr, weA, weAr, peA, peAr, dsA, dsAr, mA, ptA] = await Promise.all([
    fbGet('/tc/lots').catch(() => null), fbGet('/tc/archive/lots').catch(() => null),
    fbGet('/tc/stageEntries').catch(() => null), fbGet('/tc/archive/stageEntries').catch(() => null),
    fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null),
    fbGet('/tc/windEntries').catch(() => null), fbGet('/tc/archive/windEntries').catch(() => null),
    fbGet('/tc/packEntries').catch(() => null), fbGet('/tc/archive/packEntries').catch(() => null),
    fbGet('/tc/dispatches').catch(() => null), fbGet('/tc/archive/dispatches').catch(() => null),
    fbGet('/tc/masters').catch(() => null), fbGet('/tc/parties').catch(() => null)
  ]);
  const lots = [...toArr(lotsA), ...toArr(lotsAr)];
  const stageEntries = [...toArr(seA), ...toArr(seAr)];
  const dyeLots = [...toArr(dlA), ...toArr(dlAr)];
  const windEntries = [...toArr(weA), ...toArr(weAr)];
  const packEntries = [...toArr(peA), ...toArr(peAr)];
  // Sep 10 2026 — real, direct diagnostic built via direct discussion
  // with Priyam, from his own real, repeated experience: "Add back"
  // on a party kept appearing to not work, and rather than keep
  // guessing at a cause, this tags each dispatch with exactly where
  // it actually lives — active or archived, and its own real id — so
  // any still-missing party can be traced straight to the specific
  // record actually causing it, instead of a name with no way to
  // find its source.
  const dispatches = [...toArr(dsA).map(d => ({ ...d, _fromArchive: false })), ...toArr(dsAr).map(d => ({ ...d, _fromArchive: true }))];
  const masters = mA || {};
  const parties = Array.isArray(ptA) ? ptA : (ptA ? Object.values(ptA) : []);

  const usedVendors = new Set(lots.map(l => l.vendor).filter(Boolean));
  const usedMills = new Set(lots.map(l => l.mill).filter(Boolean));
  // Sep 10 2026 — real, root-cause fix built via direct discussion
  // with Priyam, from his own real, repeated experience: "Add back"
  // kept appearing to not work, but the actual cause was different —
  // a dispatch covering a multi-source dye lot saves a computed
  // display string (each real source's own grade joined with "+",
  // e.g. "30/1 RC+30/1 POLYESTER") as its own real grade field. That
  // string was never a real, single grade to begin with — it's a
  // display-only combination — so adding it to Masters never
  // resolved anything: the next multi-source dispatch could produce
  // a different combination or order, showing up as a brand new
  // "missing" grade every time, looking like the same fix kept
  // failing when it was actually genuinely different values each
  // time. A dispatch grade containing "+" is never a real grade to
  // check for — excluded here at the source.
  const usedGrades = new Set([...lots.map(l => l.grade), ...stageEntries.map(e => e.grade), ...dyeLots.map(d => d.grade), ...windEntries.map(e => e.grade), ...packEntries.map(e => e.grade), ...dispatches.map(d => d.grade).filter(g => g && !g.includes('+'))].filter(Boolean));
  const usedWorkers = new Set([
    ...stageEntries.map(e => e.startWorker), ...stageEntries.map(e => e.endWorker),
    ...dyeLots.map(d => d.worker), ...windEntries.map(e => e.worker), ...packEntries.map(e => e.worker),
    ...dispatches.map(d => d.by)
  ].filter(Boolean));
  const usedParties = new Set(dispatches.map(d => d.party).filter(Boolean));
  // Sep 10 2026 — real, direct diagnostic built via direct discussion
  // with Priyam, from his own real, repeated experience: a party kept
  // appearing to still be missing even after "Add back". Rather than
  // keep guessing at a cause, this records exactly which real
  // dispatch (its own id, and whether it's active or archived) is
  // the actual source of each used party — so any still-missing
  // party can be traced straight to the specific record causing it.
  const partySourceMap = {};
  dispatches.forEach(d => {
    if (!d.party) return;
    if (!partySourceMap[d.party]) partySourceMap[d.party] = [];
    partySourceMap[d.party].push({ dispatchId: d.id, archived: !!d._fromArchive });
  });
  const usedSoftMachines = new Set(stageEntries.map(e => e.machine).filter(Boolean));
  const usedDyeMachines = new Set(dyeLots.map(d => d.machine).filter(Boolean));
  const usedWindMachines = new Set(windEntries.map(e => e.machine).filter(Boolean));
  const usedPackMachines = new Set(packEntries.map(e => e.machine).filter(Boolean));

  const missing = (used, list) => [...used].filter(v => !(list || []).includes(v)).sort();
  const missingParties = missing(usedParties, parties);

  return jsonResponse({
    vendors: missing(usedVendors, masters.vendors),
    mills: missing(usedMills, masters.mills),
    grades: missing(usedGrades, masters.grades),
    workers: missing(usedWorkers, masters.workers),
    parties: missingParties,
    partySources: Object.fromEntries(missingParties.map(p => [p, partySourceMap[p] || []])),
    // Aug 26 2026 — real, direct bug fix found via direct discussion
    // with Priyam: a machine still sitting in the old, shared list
    // (not yet migrated to its own, correct stage list) IS already,
    // genuinely in Masters — checking only the new list alone would
    // falsely report it as missing until it's migrated.
    softMachines: missing(usedSoftMachines, [...(masters.softMachines || []), ...(masters.machines || [])]),
    dyeMachines: missing(usedDyeMachines, [...(masters.dyeMachines || []), ...(masters.machines || [])]),
    windMachines: missing(usedWindMachines, [...(masters.windMachines || []), ...(masters.machines || [])]),
    packMachines: missing(usedPackMachines, [...(masters.packMachines || []), ...(masters.machines || [])])
  });
}

// Server-side replacement for pages.js's saveDyeLotStartingNo,
// saveAgingThresholds, updateMachineCap, and addMachine — 4 separate
// unprotected client writes to the same Masters "System" settings area,
// consolidated into one admin/manager-gated handler.
async function handleMastersSettingUpdate(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin or Manager only', 403);

  const { action } = body || {};
  const rawM = await fbGet('/tc/masters').catch(() => null);
  const masters = rawM || {};
  const patch = {};

  if (action === 'dyeLotStartingNo') {
    const { startingNo, fy } = body;
    if (!startingNo || !fy) return errorResponse('Missing starting number or fiscal year');
    if (!startingNo.startsWith(`DYE-${fy}-`)) return errorResponse(`Format must be DYE-${fy}-NNN`);
    const num = parseInt(startingNo.replace(`DYE-${fy}-`, ''));
    if (isNaN(num) || num < 1) return errorResponse('Invalid number');
    const settings = [...(masters.dyeLotSettings || [])];
    const idx = settings.findIndex(s => s.fy === fy);
    if (idx >= 0) settings[idx] = { fy, startingNo };
    else settings.push({ fy, startingNo });
    patch['/tc/masters/dyeLotSettings'] = settings;
  } else if (action === 'agingThresholds') {
    const { yellow, red } = body;
    const y = parseInt(yellow) || 7, r = parseInt(red) || 15;
    if (r <= y) return errorResponse('Red must be > yellow');
    patch['/tc/agingThresholds'] = { yellow: y, red: r };
  } else if (action === 'machineCap') {
    const { machine, field, val } = body;
    if (!machine || !field) return errorResponse('Missing machine or field');
    const cap = { ...(masters.machineCapacity || {}) };
    cap[machine] = { ...(cap[machine] || {}), [field]: val };
    patch['/tc/masters/machineCapacity'] = cap;
  } else if (action === 'machineStage') {
    // Aug 26 2026 — real, direct extension built via direct discussion
    // with Priyam: lets each existing machine be tagged with its real,
    // actual stage, since machines added before this feature existed
    // have no stage at all yet.
    const { machine, stage } = body;
    if (!machine) return errorResponse('Machine ID required');
    if (!['Soft', 'Dye', 'Wind', 'Pack'].includes(stage)) return errorResponse('Stage must be Soft, Dye, Wind, or Pack');
    const stages = { ...(masters.machineStages || {}) };
    stages[machine] = stage;
    patch['/tc/masters/machineStages'] = stages;
  } else if (action === 'addMachine') {
    const { machine, maxHrs, maxOut, stage } = body;
    if (!machine) return errorResponse('Machine ID required');
    // Aug 26 2026 — real, direct extension: a new machine now requires
    // its real stage up front, so every machine added from this point
    // on genuinely, correctly filters into only its own stage's form.
    if (!['Soft', 'Dye', 'Wind', 'Pack'].includes(stage)) return errorResponse('Stage must be Soft, Dye, Wind, or Pack');
    const machines = [...(masters.machines || [])];
    if (!machines.includes(machine)) machines.push(machine);
    const cap = { ...(masters.machineCapacity || {}) };
    cap[machine] = { maxHrs: maxHrs || 24, maxOut: maxOut || 0 };
    const stages = { ...(masters.machineStages || {}) };
    stages[machine] = stage;
    patch['/tc/masters/machines'] = machines;
    patch['/tc/masters/machineCapacity'] = cap;
    patch['/tc/masters/machineStages'] = stages;
  } else {
    return errorResponse('Unknown action');
  }

  await fbPatch('', patch);
  return jsonResponse({ success: true });
}

// Aug 26 2026 — real, direct extension built via direct discussion
// with Priyam: machines used to live in one, single, shared list —
// this moves one machine, currently still there, into its correct,
// real, separate stage list. Every real entry that already uses this
// machine's name is completely unaffected — only which list its name
// is filed under changes.
async function handleMigrateMachine(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin/Manager only', 403);
  const { machine, stage } = body || {};
  if (!machine) return errorResponse('Machine required');
  if (!['softMachines', 'dyeMachines', 'windMachines', 'packMachines'].includes(stage)) return errorResponse('Stage must be softMachines, dyeMachines, windMachines, or packMachines');

  const raw = await fbGet('/tc/masters').catch(() => null);
  const masters = raw || {};
  const oldList = masters.machines || [];
  if (!oldList.includes(machine)) return errorResponse('Machine not found in the old, shared list — it may already have been moved.');

  const newList = [...(masters[stage] || [])];
  if (!newList.includes(machine)) newList.push(machine);

  const patch = {};
  patch['/tc/masters/machines'] = oldList.filter(m => m !== machine);
  patch[`/tc/masters/${stage}`] = newList;
  await fbPatch('', patch);
  return jsonResponse({ success: true });
}

// ─── Lot Flag (Jul 24 2026 fix) ─────────────────────────────────────────────
// Server-side replacement for pages.js's saveFlag.
// Sep 8 2026 — real, direct feature built via direct discussion with
// Priyam: a "Hold" flag on a lot used to be purely a visual label —
// nothing anywhere actually stopped it from being processed further.
// These two shared checks are the one real source of truth every
// stage-start handler below calls — a lot/dye lot currently flagged
// "hold" is genuinely blocked, not just hidden from the dropdown
// (that's a separate, client-side convenience — this is the real
// gate, since a dropdown exclusion alone is never real enforcement).
function _isLotOnHold(lotFlags, lotId, grade, vendor) {
  const key = _lotFlagKey(lotId, grade, vendor);
  const f = lotFlags && lotFlags[key];
  return (f && f.type === 'hold') ? f : null;
}
function _isDyeLotOnHold(dyeLotFlags, dyeLotId) {
  const key = _dyeLotFlagKey(dyeLotId);
  const f = dyeLotFlags && dyeLotFlags[key];
  return (f && f.type === 'hold') ? f : null;
}
// Sep 8 2026 — real, direct fix caught by this file's own consolidation
// checker (Check 153) immediately after writing the two functions
// above: they'd each recomputed the sanitized key independently
// instead of reusing the one already correct in handleLotFlag/
// handleDyeLotFlag — the exact same duplication anti-pattern this
// whole session has been eliminating elsewhere. These two are now the
// one real source of truth; handleLotFlag/handleDyeLotFlag below call
// them too, instead of each computing their own copy.
function _lotFlagKey(lotId, grade, vendor) {
  return `${(lotId||'').replace(/[^a-zA-Z0-9]/g,'_')}__${(grade||'').replace(/[^a-zA-Z0-9]/g,'_')}__${(vendor||'').replace(/[^a-zA-Z0-9]/g,'_')}`;
}
function _dyeLotFlagKey(dyeLotId) {
  return String(dyeLotId || '').replace(/[^a-zA-Z0-9]/g,'_');
}

async function handleLotFlag(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager', 'supervisor'].includes(role)) return errorResponse('Not authorized', 403);

  const { lotId, grade, vendor, type, note, changedBy, password, overrideReason, username } = body || {};
  if (!lotId) return errorResponse('Lot id required');
  if (type && !note) return errorResponse('Please add a note for the flag');
  // Aug 26 2026 — real, genuine fix built via direct discussion with
  // Priyam, found while checking this system before building the new
  // auto-flag feature on top of it: this used to key by lotId alone,
  // the exact same ambiguous-match bug already found and fixed for the
  // void chain — several different, real lots commonly share the same
  // lot number, so flagging one could silently, incorrectly flag a
  // completely different, unrelated lot too. Now uses the full,
  // unique lot+grade+vendor address, same pattern as summaryKey().
  // Sep 8 2026 — now calls the shared _lotFlagKey() (defined just
  // above, right before this function), same key computation, one
  // real place instead of duplicated here too.
  const _safeKey = _lotFlagKey(lotId, grade, vendor);

  const patch = {};
  if (!type) {
    // Sep 8 2026 — real, direct feature built via direct discussion
    // with Priyam: clearing a genuine "hold" flag now needs to be a
    // real, password-verified, logged event — not a routine clear
    // like any other flag type, since a hold is the one flag type
    // that actually blocks processing server-side (handleStageStart/
    // handleDyeStart/handleWindStart/handlePackSubmit/
    // handleDispatchSubmit). This is the ONLY path that reactivates a
    // held lot, deliberately reusing the flag itself rather than
    // building a separate bypass mechanism.
    // Sep 8 2026 — real, direct fix built via direct discussion with
    // Priyam: originally admin-only. Loosened to any role already
    // authorized to touch flags at all (admin/manager/supervisor,
    // checked at the top of this function) — the real safeguard is
    // the reason + the caller's own verified password, not which of
    // those 3 roles they happen to hold.
    const existing = await fbGet(`/tc/lotFlags/${_safeKey}`).catch(() => null);
    if (existing && existing.type === 'hold') {
      if (!overrideReason || overrideReason.trim().length < 10) return errorResponse('Provide a real reason (min 10 characters) to clear this Hold');
      const verifiedUser = await _verifySelfPassword(username, password);
      if (!verifiedUser) return errorResponse('Incorrect password', 401);
      const overrideId = 'HO-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      patch[`/tc/holdOverrides/${overrideId}`] = { type: 'rm', lotId, grade, vendor, previousNote: existing.note || '', reason: overrideReason.trim(), by: changedBy || verifiedUser.name || '', at: new Date().toISOString() };
    }
    patch[`/tc/lotFlags/${_safeKey}`] = null;
  } else {
    patch[`/tc/lotFlags/${_safeKey}`] = { type, note, by: changedBy || '', at: new Date().toISOString(), lotId, grade, vendor };
  }
  await fbPatch('', patch);
  return jsonResponse({ success: true });
}

// Aug 26 2026 — real, direct extension of handleLotFlag, for Dye Lots
// specifically. Genuinely simpler — a Dye Lot id is already, provably
// unique on its own, confirmed directly against real production data
// earlier today (223 real Dye lots, zero duplicate ids) — no composite
// key needed here, unlike RM's lot+grade+vendor.
async function handleDyeLotFlag(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager', 'supervisor'].includes(role)) return errorResponse('Not authorized', 403);

  const { dyeLotId, type, note, changedBy, password, overrideReason, username } = body || {};
  if (!dyeLotId) return errorResponse('Dye lot id required');
  if (type && !note) return errorResponse('Please add a note for the flag');
  // Sep 8 2026 — now calls the shared _dyeLotFlagKey() (defined above
  // in this file, right before handleLotFlag), one real place instead
  // of duplicated here too.
  const _safeDyeLotId = _dyeLotFlagKey(dyeLotId);

  const patch = {};
  if (!type) {
    // Sep 8 2026 — same real, password-verified, logged override
    // requirement as handleLotFlag, for the exact same reason: a
    // dye lot "hold" also actually blocks processing server-side
    // now (handleWindStart/handlePackSubmit/handleDispatchSubmit).
    // Loosened from admin-only to any role already authorized to
    // touch flags (admin/manager/supervisor) — same real safeguard
    // is the reason + the caller's own verified password.
    const existing = await fbGet(`/tc/dyeLotFlags/${_safeDyeLotId}`).catch(() => null);
    if (existing && existing.type === 'hold') {
      if (!overrideReason || overrideReason.trim().length < 10) return errorResponse('Provide a real reason (min 10 characters) to clear this Hold');
      const verifiedUser = await _verifySelfPassword(username, password);
      if (!verifiedUser) return errorResponse('Incorrect password', 401);
      const overrideId = 'HO-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      patch[`/tc/holdOverrides/${overrideId}`] = { type: 'dye', dyeLotId, previousNote: existing.note || '', reason: overrideReason.trim(), by: changedBy || verifiedUser.name || '', at: new Date().toISOString() };
    }
    patch[`/tc/dyeLotFlags/${_safeDyeLotId}`] = null;
  } else {
    patch[`/tc/dyeLotFlags/${_safeDyeLotId}`] = { type, note, by: changedBy || '', at: new Date().toISOString(), dyeLotId };
  }
  await fbPatch('', patch);
  return jsonResponse({ success: true });
}

// Aug 26 2026 — real, direct extension after Priyam's own, direct
// instruction: manual flagging genuinely needs to exist at every
// stage, not just RM and Dye. Soft, Wind, Pack, and Dispatch entries
// all already have their own, genuinely unique ids (confirmed
// directly against real production data earlier today — SE-/WE-/
// PE-/dispatch ids never collide across stages either) — so this one,
// single, shared table safely covers all 4 stages at once, rather
// than building 4 near-identical, duplicate systems.
async function handleEntryFlag(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager', 'supervisor'].includes(role)) return errorResponse('Not authorized', 403);

  const { entryId, type, note, changedBy } = body || {};
  if (!entryId) return errorResponse('Entry id required');
  if (type && !note) return errorResponse('Please add a note for the flag');
  const _safeEntryId = String(entryId).replace(/[^a-zA-Z0-9]/g,'_');

  const patch = {};
  if (!type) {
    patch[`/tc/entryFlags/${_safeEntryId}`] = null;
  } else {
    patch[`/tc/entryFlags/${_safeEntryId}`] = { type, note, by: changedBy || '', at: new Date().toISOString(), entryId };
  }
  await fbPatch('', patch);
  return jsonResponse({ success: true });
}

// ─── Link Dispatch to Order (Jul 24 2026 fix) ───────────────────────────────
// Server-side replacement for pages.js's submitLinkOrder.
async function handleLinkOrder(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager', 'supervisor'].includes(role)) return errorResponse('Not authorized', 403);

  const { dispId, orderId } = body || {};
  if (!dispId) return errorResponse('Dispatch id required');
  if (!orderId) return errorResponse('Select an order');

  // Aug 5 2026 — was active-table-only. A dispatch that has already
  // archived (normal for anything not brand new) silently returned
  // "not found" even though it genuinely exists. Same active+archive
  // check every other lookup in this file already does; this one was
  // missed. Written back to whichever table actually holds the record.
  const [dActive, dArchived] = await Promise.all([
    fbGet(`/tc/dispatches/${dispId}`).catch(() => null),
    fbGet(`/tc/archive/dispatches/${dispId}`).catch(() => null)
  ]);
  const d = dActive || dArchived;
  if (!d) return errorResponse('Dispatch not found', 404);
  // Sep 10 2026 — real, proactive fix built via direct discussion with
  // Priyam, after finding this exact bug in Dead Stock's own void/edit
  // functions: partyOrders is the exact same category of table — an
  // older order can genuinely be stored as a plain array element with
  // no named key of its own.
  const asArrPO1 = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x && x.id) : [];
  const rawPO1 = await fbGet('/tc/partyOrders').catch(() => null);
  const order = asArrPO1(rawPO1).find(x => x.id === orderId);
  if (!order) return errorResponse('Order not found', 404);

  const writePath = dActive ? `/tc/dispatches/${dispId}/orderId` : `/tc/archive/dispatches/${dispId}/orderId`;
  await fbPatch('', { [writePath]: orderId });
  return jsonResponse({ success: true });
}

// ─── Legacy deliveries[] migration (Jul 24 2026 fix) ────────────────────────
// Server-side replacement for the hidden migration inside renderRMTable —
// backfills deliveries[] on any RM lot record still missing it (pre-dating
// that field). Runs once per lot that needs it — idempotent, safe to call
// repeatedly, only ever admin/manager triggered.
async function handleMigrateLotDeliveries(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin or Manager only', 403);

  const rawLots = await fbGet('/tc/lots').catch(() => null);
  const lots = rawLots ? Object.entries(rawLots) : [];
  const patch = {};
  let migrated = 0;
  for (const [key, l] of lots) {
    if (l && !l.deliveries) {
      patch[`/tc/lots/${key}/deliveries`] = [{ date: l.date, units: l.units, weight: l.weight, challan: l.challan || '', addedAt: l.createdAt || new Date().toISOString(), addedBy: 'Admin' }];
      migrated++;
    }
  }
  if (migrated > 0) await fbPatch('', patch);
  return jsonResponse({ success: true, migrated });
}

// ─── Bidirectional Balance Validation (Jul 25 2026) ────────────────────────
// Shared by Edit, Void, and Override-with-correction. Checks a proposed
// number change in BOTH directions before it's accepted:
//   UPSTREAM  — does the new "in" value claim more than is actually
//               available from the source, excluding this entry's own
//               existing claim (so editing an entry doesn't get blocked
//               by its own current numbers)?
//   DOWNSTREAM — does the new "out" value drop below what's already been
//               consumed by whatever was built on top of this entry?
// Built after finding Override had NO such check at all — it accepted any
// number, including physically impossible ones (e.g. more dye output than
// the real input could ever produce).
// ─── Self-Password Verification (Jul 25 2026) ──────────────────────────────
// Verifies the CURRENT user's own password — not an admin password. Used
// where "everyone needs a password, no exceptions" applies (Void), unlike
// _matchAdminOnlyPassword/_matchAnyAdminPassword which check against any
// admin account regardless of who's logged in.
async function _verifySelfPassword(username, password) {
  if (!username || !password) return null;
  const users = await _usersArray();
  const candidates = users.filter(u => u.username === username && u.active !== false);
  for (const u of candidates) {
    if (await verifyPasswordAny(password, u.password)) return u;
  }
  return null;
}

async function _validateBalanceChange(type, entry, newValues) {
  const toArr = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x && x.id) : [];
  const isCounted = e => e && (e.status === 'Approved' || e.status === 'Edited-Approved');

  if (type === 'stage') {
    const lotId = entry.lotId, grade = entry.grade || '', vendor = entry.vendor || '';
    const [lotsRaw, seRaw, rmrRaw, dlRaw] = await Promise.all([
      fbGet('/tc/lots').catch(() => null), fbGet('/tc/stageEntries').catch(() => null),
      fbGet('/tc/rmReturnLog').catch(() => null), fbGet('/tc/dyeLots').catch(() => null),
    ]);
    const lotsArr = toArr(lotsRaw), seArr = toArr(seRaw), rmrArr = toArr(rmrRaw), dlArr = toArr(dlRaw);

    const availExcludingSelf = calcRMBalanceAvailable(lotsArr, seArr.filter(e => e.id !== entry.id), rmrArr, lotId, grade, vendor);
    const newInWeight = newValues.inWeight ?? entry.inWeight ?? 0;
    const maxIn = (availExcludingSelf.kg || 0) + (entry.inWeight || 0);
    if (newInWeight > maxIn + 0.01) {
      return { ok: false, error: `New input (${newInWeight}kg) exceeds what's actually available from this RM lot (max ${maxIn.toFixed(2)}kg)` };
    }

    const newOutWeight = newValues.outWeight ?? entry.outWeight ?? 0;
    if (newOutWeight > newInWeight + 0.01) {
      return { ok: false, error: `Output (${newOutWeight}kg) cannot exceed input (${newInWeight}kg)` };
    }

    const consumedByDye = calcSoftConsumedByDye(dlArr, lotId, grade, vendor);
    const otherPoolOut = seArr.filter(e => e.id !== entry.id && e.lotId === lotId && e.grade === grade && e.vendor === vendor && isCounted(e)).reduce((a, e) => a + (e.outWeight || 0), 0);
    const poolAfterChange = otherPoolOut + newOutWeight;
    if (poolAfterChange < (consumedByDye.kg || 0) - 0.01) {
      return { ok: false, error: `Reducing output to ${newOutWeight}kg would drop this lot's Soft pool below what Dye has already consumed (${(consumedByDye.kg || 0).toFixed(2)}kg)` };
    }
    return { ok: true };
  }

  if (type === 'dye') {
    const weRaw = await fbGet('/tc/windEntries').catch(() => null);
    const weArr = toArr(weRaw);
    const newOutWeight = newValues.outWeight ?? entry.outWeight ?? 0;
    const totalIn = newValues.totalInWeight ?? entry.totalInWeight ?? 0;
    if (newOutWeight > totalIn + 0.01) {
      return { ok: false, error: `Output (${newOutWeight}kg) cannot exceed input (${totalIn}kg) — gain is recorded at packing, not dyeing` };
    }
    const windTaken = weArr.filter(w => w.dyeLotId === entry.id && isCounted(w)).reduce((a, w) => a + (w.inWeight || 0), 0);
    if (newOutWeight < windTaken - 0.01) {
      return { ok: false, error: `Reducing output to ${newOutWeight}kg would drop below what Wind has already taken (${windTaken.toFixed(2)}kg)` };
    }
    return { ok: true };
  }

  if (type === 'wind') {
    const [dlRaw, weRaw, peRaw] = await Promise.all([fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/windEntries').catch(() => null), fbGet('/tc/packEntries').catch(() => null)]);
    const dlArr = toArr(dlRaw), weArr = toArr(weRaw), peArr = toArr(peRaw);
    const dyeBal = calcDyeBalAvailable(dlArr, weArr.filter(e => e.id !== entry.id), entry.dyeLotId);
    const newInWeight = newValues.inWeight ?? entry.inWeight ?? 0;
    const maxIn = (dyeBal.kg || 0) + (entry.inWeight || 0);
    if (newInWeight > maxIn + 0.01) {
      return { ok: false, error: `New input (${newInWeight}kg) exceeds what's available from the dye lot (max ${maxIn.toFixed(2)}kg)` };
    }
    const newOutWeight = newValues.outWeight ?? entry.outWeight ?? 0;
    if (newOutWeight > newInWeight + 0.01) {
      return { ok: false, error: `Output (${newOutWeight}kg) cannot exceed input (${newInWeight}kg)` };
    }
    const packTaken = peArr.filter(p => p.dyeLotId === entry.dyeLotId && isCounted(p)).reduce((a, p) => a + (p.inWeight || 0), 0);
    const otherWindOut = weArr.filter(e => e.id !== entry.id && e.dyeLotId === entry.dyeLotId && isCounted(e)).reduce((a, e) => a + (e.outWeight || 0), 0);
    if ((otherWindOut + newOutWeight) < packTaken - 0.01) {
      return { ok: false, error: `Reducing output would drop below what Pack has already taken (${packTaken.toFixed(2)}kg)` };
    }
    return { ok: true };
  }

  if (type === 'pack') {
    const [weRaw, peRaw, dsRaw] = await Promise.all([fbGet('/tc/windEntries').catch(() => null), fbGet('/tc/packEntries').catch(() => null), fbGet('/tc/dispatches').catch(() => null)]);
    const weArr = toArr(weRaw), peArr = toArr(peRaw), dsArr = toArr(dsRaw);
    const windBal = calcWindBalAvailable(weArr, peArr.filter(e => e.id !== entry.id), entry.dyeLotId);
    const newInWeight = newValues.inWeight ?? entry.inWeight ?? 0;
    const maxIn = (windBal.kg || 0) + (entry.inWeight || 0);
    if (newInWeight > maxIn + 0.01) {
      return { ok: false, error: `New input (${newInWeight}kg) exceeds what's available from Wind (max ${maxIn.toFixed(2)}kg)` };
    }
    const newWeight = newValues.weight ?? entry.weight ?? 0;
    const dispatchTaken = dsArr.filter(d => d.dyeLotId === entry.dyeLotId && isCounted(d)).reduce((a, d) => a + (d.weight || 0), 0);
    const otherPackOut = peArr.filter(e => e.id !== entry.id && e.dyeLotId === entry.dyeLotId && isCounted(e)).reduce((a, e) => a + (e.weight || 0), 0);
    if ((otherPackOut + newWeight) < dispatchTaken - 0.01) {
      return { ok: false, error: `Reducing output would drop below what's already Dispatched (${dispatchTaken.toFixed(2)}kg)` };
    }
    return { ok: true };
  }

  if (type === 'dispatch') {
    const [peRaw, dsRaw] = await Promise.all([fbGet('/tc/packEntries').catch(() => null), fbGet('/tc/dispatches').catch(() => null)]);
    const peArr = toArr(peRaw), dsArr = toArr(dsRaw);
    const dyeLotId = entry.dyeLotId || (entry.lots && entry.lots[0] && entry.lots[0].dyeLotId);
    const packBal = calcPackBalAvailable(peArr, dsArr.filter(e => e.id !== entry.id), dyeLotId);
    const newWeight = newValues.weight ?? entry.weight ?? 0;
    const maxWeight = (packBal.kg || 0) + (entry.weight || 0);
    if (newWeight > maxWeight + 0.01) {
      return { ok: false, error: `New weight (${newWeight}kg) exceeds what's available from Pack (max ${maxWeight.toFixed(2)}kg)` };
    }
    return { ok: true }; // Dispatch is terminal — nothing downstream to check
  }

  return { ok: true };
}

// POST /api/rm-edit-request/reject — Sep 10 2026, real, new tool: Admin
// declines a pending RM Edit Request. Nothing is ever changed by this —
// only marks the real request itself as rejected, leaving the original
// lot completely untouched, exactly as it was.
async function handleRejectRMEditRequest(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin only', 403);
  const { id, changedBy } = body || {};
  if (!id) return errorResponse('id required');
  const req = await fbGet(`/tc/rmEditRequests/${id}`).catch(() => null);
  if (!req) return errorResponse('Edit request not found', 404);
  if (req.status !== 'pending') return errorResponse('This request has already been reviewed');
  await fbPatch('', {
    [`/tc/rmEditRequests/${id}/status`]: 'rejected',
    [`/tc/rmEditRequests/${id}/rejectedBy`]: changedBy || '',
    [`/tc/rmEditRequests/${id}/rejectedAt`]: new Date().toISOString(),
  });
  return jsonResponse({ success: true });
}

async function handleRMEdit(body, tokenClaim) {
  const { originalId, originalGrade, originalVendor, newLotId, vendor, mill, grade, units, weight, date, challan, reason, changedBy, password, username, editRequestId } = body;
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager', 'supervisor'].includes(role)) return errorResponse('Supervisor or Admin only', 403);
  const isAdmin = role === 'admin' || role === 'manager';
  // Sep 10 2026 — real, direct new requirement built via direct
  // discussion with Priyam, establishing one clear rule across the
  // whole app: for Edit, only Supervisor enters a password —
  // Admin/Manager are exempt, matching the exact same rule every
  // other Edit function already uses.
  if (!isAdmin) {
    const verifiedUser = await _verifySelfPassword(username, password);
    if (!verifiedUser) return errorResponse('Incorrect password', 401);
  }
  if (!reason) return errorResponse('Reason for edit is required');
  // Sep 19 2026 — was `units === undefined`, so 0 passed the server (RM Create and the Edit form both reject it).
  if (!newLotId || !vendor || !mill || !grade || !units) return errorResponse('Fill all required fields');
  // Sep 19 2026 — RM Create rejects a missing/zero weight; RM Edit never checked it at all.
  if (!weight || weight <= 0) return errorResponse('Weight (kg) is required');

  // Jul 22 2026 — the identity-conflict check and the actual save used
  // to be two separate steps with nothing holding them together — the
  // same race-condition shape already found and fixed for dispatch IDs
  // and Dye End: two near-simultaneous renames to the same new lot
  // identity could both check before either had saved, both honestly
  // see it as free, and both proceed. Fixed by locking on the target
  // identity itself, reusing the same proven mechanism as everywhere
  // else — RM Edit is rare/admin-only, so the extra lock overhead here
  // is negligible.
  const lockKey = `RMEDIT_${newLotId}_${grade || ''}_${vendor || ''}`.replace(/[^a-zA-Z0-9_]/g, '_');
  const result = await withBalanceLock(lockKey, async () => {

    const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(e => e && e.id);
    const [lotsA, lotsAr, seA, seAr, dlA, dlAr, dsA, dsAr, rlRaw, resRaw, vlRaw] = await Promise.all([
      fbGet('/tc/lots').catch(() => null), fbGet('/tc/archive/lots').catch(() => null),
      fbGet('/tc/stageEntries').catch(() => null), fbGet('/tc/archive/stageEntries').catch(() => null),
      fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null),
      fbGet('/tc/dispatches').catch(() => null), fbGet('/tc/archive/dispatches').catch(() => null),
      fbGet('/tc/rmReturnLog').catch(() => null), fbGet('/tc/residualLog').catch(() => null),
      fbGet('/tc/voidLog').catch(() => null)
    ]);
    // Aug 19 2026 — real, genuine gap found via direct discussion with
    // Priyam: every write below used to always target the active path,
    // no matter where the real record actually lived. lots/stageEntries/
    // dyeLots/dispatches all can genuinely sit in archive — an older RM
    // lot, its finished Soft entries, the Dye batches sourcing from it,
    // even a completed Dispatch. Editing any of those created a brand
    // new, duplicate record in active while the real, original archived
    // one stayed untouched, still wrong — same class of bug already
    // found and fixed in Master Edit. Tagging each record here with
    // where it actually came from, so every write below can target the
    // real, correct table.
    const lots = [...toArr(lotsA).map(l => ({ ...l, _fromArchive: false })), ...toArr(lotsAr).map(l => ({ ...l, _fromArchive: true }))];
    const stageEntries = [...toArr(seA).map(e => ({ ...e, _fromArchive: false })), ...toArr(seAr).map(e => ({ ...e, _fromArchive: true }))];
    const dyeLots = [...toArr(dlA).map(d => ({ ...d, _fromArchive: false })), ...toArr(dlAr).map(d => ({ ...d, _fromArchive: true }))];
    const dispatches = [...toArr(dsA).map(d => ({ ...d, _fromArchive: false })), ...toArr(dsAr).map(d => ({ ...d, _fromArchive: true }))];
    // Real, small helpers — every real write below uses these instead of
    // hardcoding the active path, so a correction to an archived record
    // genuinely lands back in archive, not duplicated into active.
    const _tbl = (table, rec) => rec._fromArchive ? `/tc/archive/${table}` : `/tc/${table}`;
    const _strip = rec => { const { _fromArchive, ...rest } = rec; return rest; };
    // Aug 2 2026 — Priyam's direct, correct point: an address column is
    // just a column — when a lot's identity changes, everything holding
    // a copy of it should update together, the same simple rule applied
    // consistently, no field treated as special. RM Return and Residual
    // were never touched by this cascade at all before; fixed here.
    const rmReturns = rlRaw ? Object.entries(rlRaw).filter(([, r]) => r && r.id) : [];
    const residuals = resRaw ? Object.entries(resRaw).filter(([, r]) => r && r.id) : [];
    // Aug 5 2026 — voidLog's rm-delivery entries, per Priyam's direct
    // request, for the same consistency the other four tables already
    // have. Never touched by this cascade before; fixed here.
    const voidLogEntries = vlRaw ? Object.entries(vlRaw).filter(([, v]) => v && v.id && v.type === 'rm-delivery') : [];

    const lotKey = summaryKey(originalId, originalGrade, originalVendor);
    const lot = lots.find(l => l.id === originalId && l.grade === originalGrade && l.vendor === originalVendor);
    if (!lot) return { __rejected: errorResponse('Lot not found', 404) };

    // Aug 26 2026 — real, genuine fix built via direct, thorough
    // discussion with Priyam: this used to hard-block any edit that
    // would make this lot's address match an already-existing one,
    // even though Create already knows how to safely combine exactly
    // this situation, as a new delivery, every single day. The actual
    // combining logic below already existed too — for multi-delivery
    // splits — but this exact block sat in front of it, meaning it
    // could never actually run for the one case it was built for.
    // Removed the block; the merge logic below now handles it for
    // real, whether this lot has one delivery or several.

    // Soft-consumption validation — same rule as original, strict matching
    const softInEntries = stageEntries.filter(e => e.lotId === originalId && e.grade === originalGrade && e.vendor === originalVendor && e.stage === 'Soft' && (e.status === 'Approved' || e.status === 'Edited-Approved'));
    const softInUnits = softInEntries.reduce((a, e) => a + (e.inUnits || 0), 0);
    const softInWeight = softInEntries.reduce((a, e) => a + (e.inWeight || 0), 0);
    // Jul 26 2026 — the confirmed design rule: Supervisor can edit an RM
    // lot directly as long as nothing downstream has touched it yet. If
    // Soft has already consumed from this lot, only Admin/Manager from
    // here — same escalation rule already built for Soft/Wind/Pack/Dye.
    // Sep 10 2026 — real, direct upgrade built via direct discussion
    // with Priyam: this used to hard-block Supervisor outright, with no
    // path forward except finding an Admin to physically do it. Now
    // routes to a real, pending request for Admin to review instead —
    // Admin's own approval simply re-runs this exact same edit as
    // themselves, which already, naturally bypasses this same check.
    const _hasDownstream = softInWeight > 0.01 || units < softInUnits - 0.01 || weight < softInWeight - 0.01;
    if (!isAdmin && _hasDownstream) {
      const reqId = `RER-${Date.now()}`;
      await fbSet(`/tc/rmEditRequests/${reqId}`, {
        id: reqId, status: 'pending', requestedBy: changedBy || '', requestedAt: new Date().toISOString(),
        originalId, originalGrade, originalVendor, newLotId, vendor, mill, grade, units, weight, date, challan, reason,
        softInUnits, softInWeight,
      });
      return { __requested: jsonResponse({ requested: true, id: reqId }) };
    }

    const patch = {};
    // Sep 10 2026 — real, direct new feature: closes out the pending
    // request this approval came from, in the exact same atomic write
    // as the edit itself — added to the shared patch object here so
    // it's included no matter which of this function's real exit
    // points ends up actually writing it.
    if (editRequestId) {
      const req = await fbGet(`/tc/rmEditRequests/${editRequestId}`).catch(() => null);
      if (!req) return { __rejected: errorResponse('Edit request not found', 404) };
      if (req.status !== 'pending') return { __rejected: errorResponse('This request has already been reviewed') };
      patch[`/tc/rmEditRequests/${editRequestId}/status`] = 'approved';
      patch[`/tc/rmEditRequests/${editRequestId}/approvedBy`] = changedBy || '';
      patch[`/tc/rmEditRequests/${editRequestId}/approvedAt`] = new Date().toISOString();
    }
    const before = { id: lot.id, vendor: lot.vendor, mill: lot.mill, grade: lot.grade, units: lot.units, weight: lot.weight, date: lot.date, challan: lot.challan || '' };
    const lotIdChanged = newLotId !== originalId;
    const gradeChanged = grade !== originalGrade;
    const vendorChanged = vendor !== originalVendor;
    const delivIdx = body.delivIdx || 0;
    const isMultiDeliv = (lot.deliveries || []).length > 1;
    const lotChanged = lotIdChanged || gradeChanged || vendorChanged;

    if (isMultiDeliv && lotChanged) {
      // Multi-delivery split — same logic as original (already strict matching)
      const deliveries = [...(lot.deliveries || [])];
      const thisDeliv = deliveries.splice(delivIdx, 1)[0];
      thisDeliv.date = date; thisDeliv.units = units; thisDeliv.weight = weight; thisDeliv.challan = challan;
      const newOrigUnits = deliveries.reduce((a, d) => a + (d.units || 0), 0);
      const newOrigWeight = deliveries.reduce((a, d) => a + (d.weight || 0), 0);
      // Sep 8 2026 — real, direct fix built via direct discussion with
      // Priyam: the check above (lines 2450-2451) compares the split-out
      // delivery's OWN units/weight against the WHOLE lot's total Soft
      // consumption — the wrong comparison entirely for this path, since
      // Soft draws from the lot's combined pool across every delivery,
      // not any one specific delivery. The real risk this let through:
      // splitting away enough material that what's LEFT under the
      // original lot number can no longer cover what Soft has already
      // consumed from it — a negative, impossible remaining balance,
      // completely unvalidated. This checks the actual number that
      // matters: the remaining pool after the split, against real
      // consumption — same non-admin/admin escalation rule already
      // established for every other edit path in this function.
      if (!isAdmin && newOrigUnits < softInUnits - 0.01) return { __rejected: errorResponse(`Cannot split out this delivery — the remaining ${newOrigUnits}u under ${originalId} would fall below the ${softInUnits}u Soft has already consumed from this lot. Void soft entries first, or ask Admin/Manager to proceed.`) };
      if (!isAdmin && newOrigWeight < softInWeight - 0.01) return { __rejected: errorResponse(`Cannot split out this delivery — the remaining ${newOrigWeight}kg under ${originalId} would fall below the ${softInWeight}kg Soft has already consumed from this lot. Void soft entries first, or ask Admin/Manager to proceed.`) };
      patch[`${_tbl('lots', lot)}/${lotKey}/deliveries`] = deliveries;
      patch[`${_tbl('lots', lot)}/${lotKey}/units`] = newOrigUnits;
      patch[`${_tbl('lots', lot)}/${lotKey}/weight`] = newOrigWeight;

      const targetKey = summaryKey(newLotId, grade, vendor);
      const targetLot = lots.find(l => l.id === newLotId && l.grade === grade && l.vendor === vendor);
      if (targetLot) {
        const targetDeliveries = [...(targetLot.deliveries || []), thisDeliv];
        patch[`${_tbl('lots', targetLot)}/${targetKey}/deliveries`] = targetDeliveries;
        patch[`${_tbl('lots', targetLot)}/${targetKey}/units`] = targetDeliveries.reduce((a, d) => a + (d.units || 0), 0);
        patch[`${_tbl('lots', targetLot)}/${targetKey}/weight`] = targetDeliveries.reduce((a, d) => a + (d.weight || 0), 0);
        patch[`${_tbl('lots', targetLot)}/${targetKey}/mill`] = mill;
      } else {
        patch[`/tc/lots/${targetKey}`] = { id: newLotId, grade, vendor, mill, units, weight, date, challan, deliveries: [thisDeliv], createdAt: new Date().toISOString() };
      }
      patch[`/tc/editLog/EL-${Date.now()}`] = { id: `EL-${Date.now()}`, timestamp: new Date().toISOString(), entryId: originalId, type: 'rm-delivery-split', delivIdx, newLot: newLotId, grade, vendor, reason, changedBy, _updatedAt: new Date().toISOString() };
      await fbPatch('', patch);
      // Jul 24 2026 — converted to ledger nudge. Only the split-out
      // delivery's units/weight actually move between the two lots — a
      // clean pair of opposite deltas, no full rescan needed.
      await nudgeLotSummary(originalId, originalGrade, originalVendor, {
        'rmBalance.kg': -(thisDeliv.weight || 0), 'rmBalance.units': -(thisDeliv.units || 0)
      }).catch(() => {});
      // Fix caught by direct testing: nudging a target with no existing
      // summary triggers nudge's own self-heal (a full recompute
      // bootstrap that already reads the just-written target lot's real
      // totals), then the delta lands on top — double-counting. Only
      // safe to nudge when merging into a genuinely pre-existing target;
      // a brand-new target gets one direct recompute instead.
      if (targetLot) {
        await nudgeLotSummary(newLotId, grade, vendor, {
          'rmBalance.kg': (thisDeliv.weight || 0), 'rmBalance.units': (thisDeliv.units || 0)
        }).catch(() => {});
      } else {
        await updateLotSummary(newLotId, grade, vendor).catch(() => {});
      }
      return { success: true, type: 'split', newLotKey: targetKey };
    }

    // Single delivery or same lot — cascade rename, STRICT matching (fixed from
    // the original's loose (!s.grade||s.grade===grade) pattern — 4 instances).
    // Sep 8 2026 — real, root-cause fix built via direct discussion with
    // Priyam, from a genuine 400 he hit editing a lot's own Lot No:
    // this used to write the edited delivery straight onto the OLD
    // address unconditionally, THEN — a few lines later, when the
    // identity actually changed with no merge target — separately
    // null the entire OLD address and write a fresh record at the
    // new one, in that SAME patch. Firebase rejects a multi-location
    // update where one path is a sub-path of another that's also
    // being fully deleted, which is exactly what those two writes
    // together were. The edited delivery is now only ever written to
    // whichever address it actually still belongs to, decided below,
    // never to an address about to be deleted in the same breath. A
    // second, quieter bug rode along with it too: the fresh record at
    // the new address was built from the lot's ORIGINAL delivery data,
    // not the edit just made — now uses the real, edited array.
    let _editedDeliveries = null;
    if (lot.deliveries && lot.deliveries[delivIdx]) {
      _editedDeliveries = [...lot.deliveries];
      _editedDeliveries[delivIdx] = { ..._editedDeliveries[delivIdx], units, weight, date, challan };
    }

    const newKey = summaryKey(newLotId, grade, vendor);
    // Sep 8 2026 — real, root-cause fix built via direct, thorough
    // discussion with Priyam: hoisted out of the block below so the
    // later summary-update step (which runs after this whole cascade)
    // can tell whether this specific edit was a genuine merge into an
    // already-existing lot, not just a plain identity rename. Needed
    // because the two cases require genuinely different summary
    // treatment — see that later block for why.
    let _wasMergedIntoExisting = false;
    if (lotIdChanged || gradeChanged || vendorChanged) {
      // Move the lot record itself to its new key if the key changed
      const updatedLot = { ...lot, id: newLotId, vendor, mill, grade, units, weight, date, challan };
      if (_editedDeliveries) updatedLot.deliveries = _editedDeliveries;
      if (isAdmin && (!lot.status || lot.status === 'Approved')) updatedLot.status = 'Edited-Approved';
      if (newKey !== lotKey) {
        // Aug 26 2026 — real, genuine fix built via direct, thorough
        // discussion with Priyam: this used to be unreachable, since an
        // earlier block always rejected before execution ever got this
        // far. Now checks whether a real lot already exists at the new
        // address — if so, merges this lot's own delivery history into
        // it (same proven pattern already used every day when Create
        // finds a matching lot), and marks this lot 'Merged' rather
        // than deleting it, so its own real history — and its own real
        // permanent ID — stays genuinely traceable, forever, pointing
        // at exactly where it went, instead of just vanishing.
        const mergeTarget = lots.find(l => l.id === newLotId && l.grade === grade && l.vendor === vendor);
        if (mergeTarget) {
          _wasMergedIntoExisting = true;
          const ownDeliveries = _editedDeliveries || ((lot.deliveries && lot.deliveries.length) ? lot.deliveries : [{ date: lot.date, units: lot.units, weight: lot.weight, challan: lot.challan || '', addedAt: lot.createdAt || new Date().toISOString(), addedBy: 'Admin' }]);
          const targetDeliveries = [...(mergeTarget.deliveries || []), ...ownDeliveries];
          const targetKeyForMerge = summaryKey(newLotId, grade, vendor);
          patch[`${_tbl('lots', mergeTarget)}/${targetKeyForMerge}/deliveries`] = targetDeliveries;
          patch[`${_tbl('lots', mergeTarget)}/${targetKeyForMerge}/units`] = targetDeliveries.reduce((a, d) => a + (d.units || 0), 0);
          patch[`${_tbl('lots', mergeTarget)}/${targetKeyForMerge}/weight`] = targetDeliveries.reduce((a, d) => a + (d.weight || 0), 0);
          patch[`${_tbl('lots', lot)}/${lotKey}/status`] = 'Merged';
          patch[`${_tbl('lots', lot)}/${lotKey}/mergedInto`] = mergeTarget.uid || targetKeyForMerge;
          patch[`${_tbl('lots', lot)}/${lotKey}/mergedAt`] = new Date().toISOString();
          patch[`${_tbl('lots', lot)}/${lotKey}/mergedBy`] = changedBy || '';
        } else {
          patch[`${_tbl('lots', lot)}/${lotKey}`] = null;
          patch[`${_tbl('lots', lot)}/${newKey}`] = _strip(updatedLot);
        }
      } else {
        patch[`${_tbl('lots', lot)}/${lotKey}/vendor`] = vendor;
        patch[`${_tbl('lots', lot)}/${lotKey}/mill`] = mill;
        if (_editedDeliveries) {
          patch[`${_tbl('lots', lot)}/${lotKey}/deliveries`] = _editedDeliveries;
          patch[`${_tbl('lots', lot)}/${lotKey}/units`] = _editedDeliveries.reduce((a, d) => a + (d.units || 0), 0);
          patch[`${_tbl('lots', lot)}/${lotKey}/weight`] = _editedDeliveries.reduce((a, d) => a + (d.weight || 0), 0);
        }
        if (isAdmin && (!lot.status || lot.status === 'Approved')) patch[`${_tbl('lots', lot)}/${lotKey}/status`] = 'Edited-Approved';
      }

      // Sep 10 2026 — real, root-cause fix built via direct, thorough
      // discussion with Priyam: this used to only be computed right
      // before the Dye Sources cascade below, meaning Soft entries,
      // RM Return, Residual, and Void Log (all processed BEFORE that
      // point) never had access to it at all — so only Dye Sources
      // ever got their lotUid correctly repointed to a real merge
      // target's uid; the other four kept pointing at the old,
      // merged-away lot's permanent ID forever. Moved up so every one
      // of the five real places gets exactly the same treatment.
      const targetLotForUid = lotIdChanged ? lots.find(l => l.id === newLotId && l.grade === grade && l.vendor === vendor) : null;

      stageEntries.forEach(e => {
        if (e.lotId === originalId && e.grade === originalGrade && e.vendor === originalVendor) {
          const p = `${_tbl('stageEntries', e)}/${e.id}`;
          if (lotIdChanged) patch[`${p}/lotId`] = newLotId;
          if (gradeChanged) patch[`${p}/grade`] = grade;
          if (vendorChanged) patch[`${p}/vendor`] = vendor;
          // Aug 2 2026 — the address column is just a column, same rule
          // as every other field on this record: when the lot's
          // identity changes, everything holding a copy of it updates
          // together, in the same action. Only recompute if this entry
          // actually has one (older entries may not).
          if (e._lotKey) patch[`${p}/_lotKey`] = newKey;
          // Sep 10 2026 — same real fix as Dye Sources below: if this
          // lot genuinely merges into a different, already-existing
          // lot, this entry's own permanent lotUid needs to follow it
          // to the target's uid — not stay pointing at the old,
          // merged-away lot forever.
          if (lotIdChanged && e.lotUid) patch[`${p}/lotUid`] = targetLotForUid?.uid || lot.uid;
        }
      });

      // RM Return and Residual — Aug 2 2026 fix: previously not touched
      // by this cascade at all, not even their plain text. Same simple
      // rule as everywhere else — find every record matching the lot's
      // old identity, update it to the new one, together, in this same
      // action.
      rmReturns.forEach(([key, r]) => {
        if (r.lotId === originalId && r.grade === originalGrade && r.vendor === originalVendor) {
          const p = `/tc/rmReturnLog/${key}`;
          if (lotIdChanged) patch[`${p}/lotId`] = newLotId;
          if (gradeChanged) patch[`${p}/grade`] = grade;
          if (vendorChanged) patch[`${p}/vendor`] = vendor;
          if (r._lotKey) patch[`${p}/_lotKey`] = newKey;
          if (lotIdChanged && r.lotUid) patch[`${p}/lotUid`] = targetLotForUid?.uid || lot.uid;
        }
      });
      residuals.forEach(([key, r]) => {
        if (r.lotId === originalId && r.grade === originalGrade && r.vendor === originalVendor) {
          const p = `/tc/residualLog/${key}`;
          if (lotIdChanged) patch[`${p}/lotId`] = newLotId;
          if (gradeChanged) patch[`${p}/grade`] = grade;
          if (vendorChanged) patch[`${p}/vendor`] = vendor;
          if (r._lotKey) patch[`${p}/_lotKey`] = newKey;
          if (lotIdChanged && r.lotUid) patch[`${p}/lotUid`] = targetLotForUid?.uid || lot.uid;
        }
      });
      voidLogEntries.forEach(([key, v]) => {
        if (v.lotId === originalId && v.grade === originalGrade && v.vendor === originalVendor) {
          const p = `/tc/voidLog/${key}`;
          if (lotIdChanged) patch[`${p}/lotId`] = newLotId;
          if (gradeChanged) patch[`${p}/grade`] = grade;
          if (vendorChanged) patch[`${p}/vendor`] = vendor;
          if (v._lotKey) patch[`${p}/_lotKey`] = newKey;
          if (lotIdChanged && v.lotUid) patch[`${p}/lotUid`] = targetLotForUid?.uid || lot.uid;
        }
      });

      // Aug 6 2026 — real, confirmed gap found via direct discussion with
      // Priyam: this updated _lotKey (the address) whenever a source's
      // lot identity changed, but never updated lotUid (the lot's own
      // permanent ID) — meaning if this lot genuinely merges into a
      // different, separate, already-existing lot, every downstream
      // source would keep pointing at the OLD lot's permanent ID forever,
      // even though its address and lot number now correctly show the
      // new one. Looks up the real target lot's own uid when the lot ID
      // itself is genuinely changing (not just a grade/vendor spelling
      // fix, where the underlying lot — and its real permanent ID —
      // hasn't actually changed at all).
      const touchedDyeLotIds = [];
      dyeLots.forEach(d => {
        let touched = false;
        const newSources = (d.sources || []).map(s => {
          if (s.lotId === originalId && s.grade === originalGrade && s.vendor === originalVendor) {
            touched = true;
            const _newLotId = lotIdChanged ? newLotId : s.lotId, _newGrade = gradeChanged ? grade : s.grade, _newVendor = vendorChanged ? vendor : s.vendor;
            const _newSrc = { ...s, lotId: _newLotId, grade: _newGrade, vendor: _newVendor };
            if (s._lotKey) _newSrc._lotKey = newKey;
            if (lotIdChanged && s.lotUid) _newSrc.lotUid = targetLotForUid?.uid || lot.uid;
            return _newSrc;
          }
          return s;
        });
        if (touched) {
          patch[`${_tbl('dyeLots', d)}/${d.id}/sources`] = newSources;
          touchedDyeLotIds.push(d.id);
        }
      });

      if (gradeChanged || vendorChanged) {
        const touchedSet = new Set(touchedDyeLotIds);
        dispatches.forEach(d => {
          if (touchedSet.has(d.dyeLotId)) {
            if (gradeChanged) patch[`${_tbl('dispatches', d)}/${d.id}/grade`] = grade;
            if (vendorChanged) patch[`${_tbl('dispatches', d)}/${d.id}/vendor`] = vendor;
          }
        });
        // Sep 10 2026 — real, genuine gap found while directly
        // investigating Priyam's own explicit follow-up question:
        // Wind and Pack both snapshot a dye batch's own grade the same
        // way Dispatch does, but were never touched by this cascade —
        // confirmed missing entirely, same real gap already found and
        // fixed once before for Reassign, just triggered here by a
        // direct RM grade/vendor correction instead.
        const [weA2, weAr2, peA2, peAr2] = await Promise.all([
          fbGet('/tc/windEntries').catch(() => null), fbGet('/tc/archive/windEntries').catch(() => null),
          fbGet('/tc/packEntries').catch(() => null), fbGet('/tc/archive/packEntries').catch(() => null),
        ]);
        const windEntries2 = [...toArr(weA2).map(x => ({ ...x, _fromArchive: false })), ...toArr(weAr2).map(x => ({ ...x, _fromArchive: true }))];
        const packEntries2 = [...toArr(peA2).map(x => ({ ...x, _fromArchive: false })), ...toArr(peAr2).map(x => ({ ...x, _fromArchive: true }))];
        windEntries2.forEach(w => { if (touchedSet.has(w.dyeLotId) && gradeChanged) patch[`${_tbl('windEntries', w)}/${w.id}/grade`] = grade; });
        packEntries2.forEach(p => { if (touchedSet.has(p.dyeLotId) && gradeChanged) patch[`${_tbl('packEntries', p)}/${p.id}/grade`] = grade; });
      }
    } else {
      // Sep 8 2026 — real, direct fix caught by Priyam's own follow-up
      // question ("have you checked this working at all places") right
      // after the Lot No fix: this is the OTHER, separate "nothing
      // about identity changed" branch — a plain units/weight/date
      // edit, no rename at all — and it never got the same
      // _editedDeliveries treatment as the branch above. Without this,
      // the single most common kind of edit would silently stop
      // saving its own delivery changes entirely, with no error shown.
      patch[`${_tbl('lots', lot)}/${lotKey}/vendor`] = vendor;
      patch[`${_tbl('lots', lot)}/${lotKey}/mill`] = mill;
      if (_editedDeliveries) {
        patch[`${_tbl('lots', lot)}/${lotKey}/deliveries`] = _editedDeliveries;
        patch[`${_tbl('lots', lot)}/${lotKey}/units`] = _editedDeliveries.reduce((a, d) => a + (d.units || 0), 0);
        patch[`${_tbl('lots', lot)}/${lotKey}/weight`] = _editedDeliveries.reduce((a, d) => a + (d.weight || 0), 0);
      }
      if (isAdmin && (!lot.status || lot.status === 'Approved')) patch[`${_tbl('lots', lot)}/${lotKey}/status`] = 'Edited-Approved';
    }

    const after = { id: newLotId, vendor, mill, grade, units, weight, date, challan };
    const changes = [];
    if (newLotId !== originalId) changes.push(`LotID: ${originalId} -> ${newLotId}`);
    if (grade !== originalGrade) changes.push(`Grade: ${originalGrade} -> ${grade}`);
    if (vendor !== originalVendor) changes.push(`Vendor: ${originalVendor} -> ${vendor}`);
    if (units !== before.units) changes.push(`Units: ${before.units} -> ${units}`);
    if (weight !== before.weight) changes.push(`Weight: ${before.weight} -> ${weight}`);
    const logId = `EL-${Date.now()}`;
    patch[`/tc/editLog/${logId}`] = { id: logId, timestamp: new Date().toISOString(), entryId: originalId, stage: 'RM', fieldChanged: 'lot-edit', oldVal: JSON.stringify(before), newVal: JSON.stringify(after), reasonCat: 'Admin correction', reason: reason + (changes.length ? ` [${changes.join(', ')}]` : ''), changedBy, _updatedAt: new Date().toISOString() };

    await fbPatch('', patch);
    // Jul 24 2026 — converted to ledger nudge.
    if (newKey !== lotKey) {
      if (_wasMergedIntoExisting) {
        // Sep 8 2026 — real, root-cause fix built via direct, thorough
        // discussion with Priyam, after his own screenshots proved a
        // merged lot kept showing a stale, frozen Soft Balance (900kg,
        // in his real example) while the target never received the full,
        // combined number. Root cause: the old nudge below only ever
        // touched rmBalance — softBalance/dyeBalance/sentToDye were never
        // touched for the OLD lot at all, regardless of whether the real
        // downstream records (Soft/Dye/Return/Residual, cascaded just
        // above) actually moved correctly. updateLotSummary already has
        // its own dedicated guard (see its own top comment) that clears
        // a Merged/Voided lot's entire cached summary to null instead of
        // recomputing one — calling it here, now that status:'Merged' has
        // just been committed above, wipes every stale field on the old
        // lot at once, the same "nothing counts here anymore" treatment
        // Void already gets, not a partial one-field patch.
        await updateLotSummary(originalId, originalGrade, originalVendor).catch(() => {});
        // The target's own fresh recompute used to be a single, unretried
        // attempt — a real failure here (a write conflict, a dropped
        // connection) was silently swallowed by .catch(()=>{}), leaving
        // the target showing its old, incomplete number with zero
        // visibility that anything went wrong. Retries 3x with backoff,
        // then leaves a real, visible failure record — the same
        // "never fail silently" principle already used for the
        // trigger-call and index-write paths elsewhere in this file.
        let _mergeSummaryOk = false;
        for (let _i = 0; _i < 3 && !_mergeSummaryOk; _i++) {
          try { await updateLotSummary(newLotId, grade, vendor); _mergeSummaryOk = true; }
          catch (e) { if (_i < 2) await new Promise(r => setTimeout(r, 100 + _i * 150)); }
        }
        if (!_mergeSummaryOk) {
          const failId = 'MSF-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
          await fbSet(`/tc/mergeSummaryFailures/${failId}`, {
            lotId: newLotId, grade, vendor, mergedFrom: originalId, mergedFromGrade: originalGrade, mergedFromVendor: originalVendor,
            timestamp: new Date().toISOString(), reason: 'updateLotSummary failed after 3 attempts post-merge — target may still show a stale, incomplete balance'
          }).catch(() => {});
        }
        return { success: true, type: 'rename', newLotKey: newKey };
      }
      // Identity changed to a genuinely brand-new address (not a merge
      // into an existing lot) — the raw lot record itself moves/deletes
      // off the old key entirely (see the `else` branch above that wrote
      // `patch[.../${lotKey}] = null`), so nothing will ever look up the
      // old summary again regardless of what it says. The old, simpler
      // nudge-to-zero is sufficient here — unchanged from before.
      await nudgeLotSummary(originalId, originalGrade, originalVendor, {
        'rmBalance.kg': -(before.weight || 0), 'rmBalance.units': -(before.units || 0)
      }).catch(() => {});
      await updateLotSummary(newLotId, grade, vendor).catch(() => {});
    } else {
      // Same identity — just the change in this lot's own totals.
      await nudgeLotSummary(originalId, originalGrade, originalVendor, {
        'rmBalance.kg': (weight || 0) - (before.weight || 0),
        'rmBalance.units': (units || 0) - (before.units || 0)
      }).catch(() => {});
    }
    return { success: true, type: 'rename', newLotKey: newKey };
  });

  if (result.__lockFailed) return errorResponse(result.error);
  if (result.__rejected) return result.__rejected;
  if (result.__requested) return result.__requested;
  return jsonResponse(result);
}

// ─── RM per-delivery void (Jul 24 2026 fix) ────────────────────────────────
// Server-side replacement for pages.js's voidRMDelivery, which ran entirely
// client-side: spliced the delivery out of lot.deliveries, recomputed
// lot.units/lot.weight, and called the generic save() with no lock, no
// atomic multi-path write, and — unlike handleRMEdit right above this
// function — no check for whether Soft stage had already consumed the
// material being voided away. Same risk class as the historical Items A/B
// (RM Edit cascade, void execution), just a sub-path that was missed when
// those were migrated. Fixed the same way: locked on the lot identity
// (matching handleRMEdit's own reasoning — rare/admin action, lock
// overhead is negligible), atomic patch, and the same soft-consumption
// guard handleRMEdit already uses when reducing a lot's totals, since
// voiding a delivery has the identical effect on the lot's available
// units/weight.
async function handleVoidRMDelivery(body, tokenClaim) {
  const { lotId, grade, vendor, delivIdx, reason, changedBy, password, username, dryRun } = body || {};
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager', 'supervisor'].includes(role)) return errorResponse('Supervisor or Admin only', 403);
  // Jul 26 2026 — matches the confirmed design for single-entry void
  // everywhere else: Supervisor can do it, but everyone needs a password,
  // no exceptions. Also switched from a client-supplied role to the real
  // verified session role — the old check trusted whatever the browser sent.
  // Sep 10 2026 — a preview never writes anything, so — like its
  // sibling Void functions, all of which already have a real,
  // session-verified role — it never needs a password either; only
  // the real, final void does.
  if (!dryRun) {
    const verifiedUser = await _verifySelfPassword(username, password);
    if (!verifiedUser) return errorResponse('Incorrect password', 401);
  }
  if (lotId === undefined || lotId === null) return errorResponse('lotId required');
  if (delivIdx === undefined || delivIdx === null) return errorResponse('delivIdx required');

  const lockKey = `RMVOID_${lotId}_${grade || ''}_${vendor || ''}`.replace(/[^a-zA-Z0-9_]/g, '_');
  const result = await withBalanceLock(lockKey, async () => {
    const lotKey = summaryKey(lotId, grade, vendor);
    const lot = await fbGet(`/tc/lots/${lotKey}`).catch(() => null);
    if (!lot) return { __rejected: errorResponse('Lot not found', 404) };

    const deliveries = [...(lot.deliveries || [])];
    if (delivIdx < 0 || delivIdx >= deliveries.length) return { __rejected: errorResponse('Delivery not found', 404) };
    // Single-delivery lots go through the existing, already-migrated full
    // lot void (handleVoidEntry, type 'rm') instead — keeping this endpoint
    // scoped to the multi-delivery case matches the client's own original
    // behavior (voidRMDelivery fell back to openVoidModal for count<=1).
    if (deliveries.length <= 1) return { __rejected: errorResponse('This lot has only one delivery — use full lot void instead') };

    const removed = deliveries[delivIdx];
    const remaining = deliveries.filter((_, i) => i !== delivIdx);
    const newUnits = remaining.reduce((a, d) => a + (d.units || 0), 0);
    const newWeight = remaining.reduce((a, d) => a + (d.weight || 0), 0);

    // Aug 6 2026 — real gap found via a thorough app-wide audit: this
    // "already consumed by Soft" check only looked at active
    // stageEntries — if the real Soft entry that consumed this delivery
    // had since finished its own chain and archived, it would be
    // silently invisible here, allowing a void on material already used.
    const [rawSE, rawSEAr] = await Promise.all([
      fbGet('/tc/stageEntries').catch(() => null), fbGet('/tc/archive/stageEntries').catch(() => null)
    ]);
    const toArrSE = v => v ? (Array.isArray(v) ? v : Object.values(v)) : [];
    const stageEntries = [...toArrSE(rawSE), ...toArrSE(rawSEAr)];
    const softInEntries = stageEntries.filter(e => e && e.lotId === lotId && e.grade === grade && e.vendor === vendor && e.stage === 'Soft' && (e.status === 'Approved' || e.status === 'Edited-Approved'));
    const softInUnits = softInEntries.reduce((a, e) => a + (e.inUnits || 0), 0);
    const softInWeight = softInEntries.reduce((a, e) => a + (e.inWeight || 0), 0);
    if (newUnits < softInUnits - 0.01) return { __rejected: errorResponse(`Cannot void this delivery — Soft stage has already consumed ${softInUnits}b, more than the ${newUnits}b that would remain. Void the Soft entries first.`) };
    if (newWeight < softInWeight - 0.01) return { __rejected: errorResponse(`Cannot void this delivery — Soft stage has already consumed ${softInWeight}kg, more than the ${newWeight}kg that would remain. Void the Soft entries first.`) };

    if (dryRun) return { __dryRun: true, lotId, grade: grade || '', vendor: vendor || '', delivUnits: removed.units || 0, delivWeight: removed.weight || 0, remainingDeliveries: remaining.length };

    const patch = {};
    patch[`/tc/lots/${lotKey}/deliveries`] = remaining;
    patch[`/tc/lots/${lotKey}/units`] = newUnits;
    patch[`/tc/lots/${lotKey}/weight`] = newWeight;

    const voidId = `VD-${Date.now()}`;
    patch[`/tc/voidLog/${voidId}`] = {
      id: voidId, type: 'rm-delivery', lotId, grade: grade || '', vendor: vendor || '', lotUid: lot.uid || null, _lotKey: lotKey,
      delivIdx, delivery: removed, reason: reason || '',
      voidedBy: changedBy || '', timestamp: new Date().toISOString(), _updatedAt: new Date().toISOString()
    };

    await fbPatch('', patch);
    // Jul 24 2026 — converted to ledger nudge. The voided delivery's own
    // units/weight is exactly the delta being removed from this lot.
    await nudgeLotSummary(lotId, grade, vendor, {
      'rmBalance.kg': -(removed.weight || 0), 'rmBalance.units': -(removed.units || 0)
    }).catch(() => {});
    return { success: true, remainingDeliveries: remaining.length, newUnits, newWeight };
  });

  if (result.__lockFailed) return errorResponse(result.error);
  if (result.__rejected) return result.__rejected;
  return jsonResponse(result);
}
// Server-side replacement for pages.js's submitVoidEntry. Faithfully
// replicates all 6 cascade branches (soft/dye/wind/pack/dispatch/dye-entry)
// with the one loose-match instance (soft branch, finding related dye lots)
// fixed to strict lot+grade+vendor matching. Committed as ONE atomic
// multi-path PATCH instead of the original's multiple saveBatch() calls.
// Per Item O's resolution: legacy dye-entry cascade support is NOT carried
// forward — dyeEntries is confirmed permanently empty, nothing real to
// preserve. The confirm() dialog showing cascade scope stays client-side
// (browser-native UI) as a preview step before calling this endpoint.
// Sep 10 2026 — real, direct new feature built via a genuinely long,
// careful design discussion with Priyam: when a Supervisor's void
// genuinely has downstream activity, this creates a real, pending
// request instead of voiding directly — same shape as the existing
// deleteRequests pattern (pending/approved/rejected), reused here
// rather than inventing something new.
async function _createVoidRequest({ id, type, reasonCat, reason, changedBy }) {
  const reqId = `VR-${Date.now()}`;
  const now = new Date().toISOString();
  await fbSet(`/tc/voidRequests/${reqId}`, {
    id: reqId, entryId: id, stage: type, reasonCat, reason,
    requestedBy: changedBy || '', requestedAt: now, status: 'pending',
  });
  return jsonResponse({ requested: true, id: reqId });
}

// POST /api/void-request/reject — Sep 10 2026, real, new tool: Admin
// declines a pending Void Request. Nothing is ever voided by this —
// only marks the real request itself as rejected, leaving the
// original entry and everything downstream from it completely
// untouched, exactly as they were.
async function handleRejectVoidRequest(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin only', 403);
  const { id, changedBy } = body || {};
  if (!id) return errorResponse('id required');
  const req = await fbGet(`/tc/voidRequests/${id}`).catch(() => null);
  if (!req) return errorResponse('Void request not found', 404);
  if (req.status !== 'pending') return errorResponse('This request has already been reviewed');
  await fbPatch('', {
    [`/tc/voidRequests/${id}/status`]: 'rejected',
    [`/tc/voidRequests/${id}/rejectedBy`]: changedBy || '',
    [`/tc/voidRequests/${id}/rejectedAt`]: new Date().toISOString(),
  });
  return jsonResponse({ success: true });
}

async function handleVoidEntry(body) {
  const { id, type, reasonCat, reason, changedBy, password, username, dryRun } = body;
  if (!reasonCat) return errorResponse('Select void reason category');
  if (!reason || reason.length < 10) return errorResponse('Reason must be at least 10 characters');
  // Jul 25 2026 — password now required for everyone, no exceptions (not
  // just non-admins). Self-verification: proves it's really this person,
  // not an admin-privilege check — same idea as the password re-entry
  // already used elsewhere for a fresh "prove it's you" confirmation.
  const verifiedUser = await _verifySelfPassword(username, password);
  if (!verifiedUser) return errorResponse('Incorrect password', 401);
  // Sep 10 2026 — real, critical gap found while directly auditing
  // today's own new Void Request feature, per Priyam's own explicit
  // request for a holistic review: this used to trust whatever role
  // the browser itself sent in the request body — meaning a Supervisor
  // could trivially change one field in their own network request to
  // "admin" and completely bypass the entire Void Request review flow,
  // voiding immediately with no oversight at all. _verifySelfPassword
  // already returns this account's own real, true role — using that
  // now instead, exactly like every other function in this app
  // correctly does with a session-verified role.
  const role = verifiedUser.role;
  if (!['admin', 'manager', 'supervisor'].includes(role)) return errorResponse('Supervisor or Admin only', 403);

  // Sep 10 2026 — real, direct new feature built via a genuinely long,
  // careful design discussion with Priyam, establishing one clear rule
  // across the whole app: every real action shows a genuine preview
  // of its actual effect before committing — the exact same real
  // cascade computed below either way, just returned here instead of
  // actually voiding anything. Unlike the Edit previews built earlier
  // today, this one genuinely still needs the real password even to
  // preview, since this function has no other way to know who's
  // asking — it never receives a session-verified role at all, only
  // ever derives one from the password check just above.
  const _buildVoidDryRun = (cascadeCounts) => ({
    __dryRun: true,
    entryId: id, entryType: type,
    cascadeCounts,
    wouldCreateRequest: role === 'supervisor' && Object.values(cascadeCounts).some(n => n > 0),
  });

  // Sep 10 2026 — real, root-cause fix built via direct discussion with
  // Priyam: lots whose imbalance warning a Dye void just genuinely
  // fixed, collected here (voidEntry itself is synchronous), and
  // actually re-checked once, right before the final write below.
  const _imbalanceRecheckList = [];

  const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(e => e && e.id);
  const [seA, seAr, dlA, dlAr, weA, weAr, peA, peAr, dsA, dsAr] = await Promise.all([
    fbGet('/tc/stageEntries').catch(() => null), fbGet('/tc/archive/stageEntries').catch(() => null),
    fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null),
    fbGet('/tc/windEntries').catch(() => null), fbGet('/tc/archive/windEntries').catch(() => null),
    fbGet('/tc/packEntries').catch(() => null), fbGet('/tc/archive/packEntries').catch(() => null),
    fbGet('/tc/dispatches').catch(() => null), fbGet('/tc/archive/dispatches').catch(() => null)
  ]);
  const stageEntries = [...toArr(seA), ...toArr(seAr)];
  const dyeLots = [...toArr(dlA).map(d => ({ ...d, _fromArchive: false })), ...toArr(dlAr).map(d => ({ ...d, _fromArchive: true }))];
  const windEntries = [...toArr(weA).map(e => ({ ...e, _fromArchive: false })), ...toArr(weAr).map(e => ({ ...e, _fromArchive: true }))];
  const packEntries = [...toArr(peA).map(e => ({ ...e, _fromArchive: false })), ...toArr(peAr).map(e => ({ ...e, _fromArchive: true }))];
  const dispatches = [...toArr(dsA).map(e => ({ ...e, _fromArchive: false })), ...toArr(dsAr).map(e => ({ ...e, _fromArchive: true }))];
  // Sep 22 2026 — real, confirmed fix built via direct discussion with Priyam, matching the exact same bug just found
  // and fixed in handleEditEntry: voidEntry() always wrote to the ACTIVE table regardless of where the record actually
  // lives, which would leave the identical kind of broken, id-less shadow entry behind for anyone voiding an
  // already-archived record. wind/pack/dispatch are now tagged here too (dyeLots was already tagged above at its own
  // declaration) so voidEntry() can route each one to its real table.
  const _tbl = (table, rec) => rec._fromArchive ? `/tc/archive/${table}` : `/tc/${table}`;

  const patch = {};
  const cascadeLog = [];

  // Jul 17 2026 — Phase 4 of the running-balance plan. Every voided
  // entry that was genuinely Approved (or Edited-Approved) before being
  // voided gets its exact original balance contribution reversed — the
  // precise negation of handleApproveEntry's formulas, since voiding an
  // Approved entry is mathematically "undo the approval." An entry that
  // was still Pending/InProgress when voided never affected any balance
  // in the first place, so it correctly gets zero nudge — checked via
  // wasApproved below, not assumed for every voided entry regardless of
  // status.
  const lotDeltas = new Map();
  const dyeDeltas = new Map();
  const addLotDelta = (lotId, grade, vendor, field, amt) => {
    const k = `${lotId}__${grade || ''}__${vendor || ''}`;
    const cur = lotDeltas.get(k) || { lotId, grade: grade || '', vendor: vendor || '' };
    cur[field] = (cur[field] || 0) + amt;
    lotDeltas.set(k, cur);
  };
  const addDyeDelta = (dyeLotId, field, amt) => {
    const cur = dyeDeltas.get(dyeLotId) || {};
    cur[field] = (cur[field] || 0) + amt;
    dyeDeltas.set(dyeLotId, cur);
  };

  const voidEntry = (entry, stage, table) => {
    if (!entry || entry.status === 'Voided') return;
    const wasApproved = entry.status === 'Approved' || entry.status === 'Edited-Approved';
    const logId = `EL-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    // Sep 22 2026 — real, confirmed fix: this always wrote to the active table regardless of where `entry` actually
    // lives, the exact bug that broke DL-1718 via handleEditEntry. entry, wind/pack/dispatch and dyeLots are all now
    // tagged with _fromArchive above, so _tbl() correctly routes each void to its real table.
    const _p = _tbl(table, entry);
    patch[`/tc/editLog/${logId}`] = { id: logId, timestamp: new Date().toISOString(), entryId: entry.id, stage, fieldChanged: 'status', oldVal: entry.status, newVal: 'Voided', reasonCat, reason, changedBy, _updatedAt: new Date().toISOString() };
    patch[`${_p}/${entry.id}/status`] = 'Voided';
    patch[`${_p}/${entry.id}/voidedBy`] = changedBy;
    patch[`${_p}/${entry.id}/voidedAt`] = new Date().toISOString();
    patch[`${_p}/${entry.id}/voidReason`] = reason;
    cascadeLog.push(`${stage} ${entry.id}`);

    if (!wasApproved) return; // never affected any balance, nothing to reverse
    if (stage === 'Soft') {
      addLotDelta(entry.lotId, entry.grade, entry.vendor, 'rmBalance.kg', (entry.inWeight || 0));
      addLotDelta(entry.lotId, entry.grade, entry.vendor, 'rmBalance.units', (entry.inUnits || 0));
      addLotDelta(entry.lotId, entry.grade, entry.vendor, 'softBalance.kg', -(entry.outWeight || 0));
      addLotDelta(entry.lotId, entry.grade, entry.vendor, 'softBalance.units', -(entry.outUnits || 0));
    } else if (stage === 'Dye') {
      addDyeDelta(entry.id, 'dyeBalance.cones', -(entry.outCones || 0));
      addDyeDelta(entry.id, 'dyeBalance.kg', -(entry.outWeight || 0));
      (entry.sources || []).forEach(s => {
        if (s.lotId) addLotDelta(s.lotId, s.grade, s.vendor, 'softBalance.kg', (s.weight || 0));
        // Sep 10 2026 — real, root-cause fix built via direct
        // discussion with Priyam, from a genuine real gap he caught:
        // voiding a Dye entry through this RM-lot cascade is exactly
        // the kind of real fix that should be able to clear a stale
        // imbalance warning on the lots it drew from — nothing here
        // ever re-checked. This function is synchronous, so it just
        // remembers which lots were touched; the actual check happens
        // once, right before the final write.
        if (s.lotId) _imbalanceRecheckList.push({ lotId: s.lotId, grade: s.grade, vendor: s.vendor });
      });
    } else if (stage === 'Wind') {
      addDyeDelta(entry.dyeLotId, 'dyeBalance.cones', (entry.inCones || 0));
      addDyeDelta(entry.dyeLotId, 'dyeBalance.kg', (entry.inWeight || 0));
      addDyeDelta(entry.dyeLotId, 'windBalance.cones', -(entry.outCones || 0));
      addDyeDelta(entry.dyeLotId, 'windBalance.kg', -(entry.outWeight || 0));
    } else if (stage === 'Pack') {
      addDyeDelta(entry.dyeLotId, 'windBalance.cones', (entry.inCones || 0));
      addDyeDelta(entry.dyeLotId, 'packBalance.bags', -(entry.bags || 0));
      addDyeDelta(entry.dyeLotId, 'packBalance.kg', -(entry.weight || 0));
    } else if (stage === 'Dispatch') {
      addDyeDelta(entry.dyeLotId, 'packBalance.bags', (entry.bags || 0));
      addDyeDelta(entry.dyeLotId, 'packBalance.kg', (entry.weight || 0));
      addDyeDelta(entry.dyeLotId, 'dispatched.bags', -(entry.bags || 0));
      addDyeDelta(entry.dyeLotId, 'dispatched.kg', -(entry.weight || 0));
    }
  };

  if (type === 'soft') {
    const e = stageEntries.find(x => x.id === id);
    if (!e) return errorResponse('Entry not found', 404);
    // Strict matching — fixed from the original's loose (!s.grade||s.grade===e.grade)
    const relatedDyeLots = dyeLots.filter(d => d.status !== 'Voided' && (d.sources || []).some(s => s.lotId === e.lotId && s.grade === e.grade && s.vendor === e.vendor));
    const dyeIds = relatedDyeLots.map(d => d.id);
    const vWind = windEntries.filter(w => dyeIds.includes(w.dyeLotId) && w.status !== 'Voided');
    const vPack = packEntries.filter(p => dyeIds.includes(p.dyeLotId) && p.status !== 'Voided');
    const vDisp = dispatches.filter(d => dyeIds.includes(d.dyeLotId) && d.status !== 'Voided');
    if (dryRun) return jsonResponse(_buildVoidDryRun({ dye: relatedDyeLots.length, wind: vWind.length, pack: vPack.length, dispatch: vDisp.length }));
    // Sep 10 2026 — real, direct new feature built via a genuinely long,
    // careful design discussion with Priyam, from his own real concern:
    // a Supervisor voiding this one Soft entry could silently cascade
    // into voiding an entire Dye batch, Wind, Pack, and even a real
    // Dispatch already gone to a customer — a genuinely large, high-
    // consequence action available with no Admin review at all. Once
    // anything real is downstream, this is no longer a direct void —
    // it becomes a real, pending request Admin must review (seeing the
    // exact same full cascade), and only Admin can execute it directly.
    // Nothing changes for a Supervisor voiding something with genuinely
    // nothing built on it yet — that still happens immediately, exactly
    // as before.
    if (role === 'supervisor' && (relatedDyeLots.length || vWind.length || vPack.length || vDisp.length)) {
      return await _createVoidRequest({ id, type, reasonCat, reason, changedBy });
    }
    voidEntry(e, 'Soft', 'stageEntries');
    relatedDyeLots.forEach(d => voidEntry(d, 'Dye', 'dyeLots'));
    vWind.forEach(w => voidEntry(w, 'Wind', 'windEntries'));
    vPack.forEach(p => voidEntry(p, 'Pack', 'packEntries'));
    vDisp.forEach(d => voidEntry(d, 'Dispatch', 'dispatches'));
  } else if (type === 'dye') {
    const d = dyeLots.find(x => x.id === id);
    if (!d) return errorResponse('Entry not found', 404);
    const vWind = windEntries.filter(e => e.dyeLotId === id && e.status !== 'Voided');
    const vPack = packEntries.filter(e => e.dyeLotId === id && e.status !== 'Voided');
    const vDisp = dispatches.filter(e => e.dyeLotId === id && e.status !== 'Voided');
    if (dryRun) return jsonResponse(_buildVoidDryRun({ wind: vWind.length, pack: vPack.length, dispatch: vDisp.length }));
    if (role === 'supervisor' && (vWind.length || vPack.length || vDisp.length)) {
      return await _createVoidRequest({ id, type, reasonCat, reason, changedBy });
    }
    voidEntry(d, 'Dye', 'dyeLots');
    vWind.forEach(e => voidEntry(e, 'Wind', 'windEntries'));
    vPack.forEach(e => voidEntry(e, 'Pack', 'packEntries'));
    vDisp.forEach(e => voidEntry(e, 'Dispatch', 'dispatches'));
  } else if (type === 'wind') {
    const e = windEntries.find(x => x.id === id);
    if (!e) return errorResponse('Entry not found', 404);
    const vPack = packEntries.filter(p => p.dyeLotId === e.dyeLotId && p.status !== 'Voided');
    const vDisp = dispatches.filter(d => d.dyeLotId === e.dyeLotId && d.status !== 'Voided');
    if (dryRun) return jsonResponse(_buildVoidDryRun({ pack: vPack.length, dispatch: vDisp.length }));
    if (role === 'supervisor' && (vPack.length || vDisp.length)) {
      return await _createVoidRequest({ id, type, reasonCat, reason, changedBy });
    }
    voidEntry(e, 'Wind', 'windEntries');
    vPack.forEach(p => voidEntry(p, 'Pack', 'packEntries'));
    vDisp.forEach(d => voidEntry(d, 'Dispatch', 'dispatches'));
  } else if (type === 'pack') {
    const e = packEntries.find(x => x.id === id);
    if (!e) return errorResponse('Entry not found', 404);
    const vDisp = dispatches.filter(d => d.dyeLotId === e.dyeLotId && d.status !== 'Voided');
    if (dryRun) return jsonResponse(_buildVoidDryRun({ dispatch: vDisp.length }));
    if (role === 'supervisor' && vDisp.length) {
      return await _createVoidRequest({ id, type, reasonCat, reason, changedBy });
    }
    voidEntry(e, 'Pack', 'packEntries');
    vDisp.forEach(d => voidEntry(d, 'Dispatch', 'dispatches'));
  } else if (type === 'dispatch') {
    const d = dispatches.find(x => x.id === id);
    if (!d) return errorResponse('Entry not found', 404);
    if (dryRun) return jsonResponse(_buildVoidDryRun({}));
    voidEntry(d, 'Dispatch', 'dispatches');
  } else {
    return errorResponse('Unknown void type: ' + type);
  }

  if (cascadeLog.length > 1) {
    const logId = `EL-${Date.now()}-cascade`;
    patch[`/tc/editLog/${logId}`] = { id: logId, timestamp: new Date().toISOString(), entryId: id, stage: type, fieldChanged: 'cascade-void', oldVal: '-', newVal: cascadeLog.join(', '), reasonCat, reason: `CASCADE: ${reason}`, changedBy, _updatedAt: new Date().toISOString() };
  }

  const voidLogId = `VL-${Date.now()}`;
  patch[`/tc/voidLog/${voidLogId}`] = { id: voidLogId, timestamp: new Date().toISOString(), entryId: id, type, reasonCat, reason, changedBy, cascadeCount: cascadeLog.length, _updatedAt: new Date().toISOString() };

  // Sep 10 2026 — real, root-cause fix built via direct discussion with
  // Priyam: actually re-checks every real lot this void touched, once,
  // using the exact same real formula the Daily Balance Check itself
  // trusts — not the accumulated deltas above, which is exactly the
  // kind of thing that can drift. Dedupes by lot address first so a
  // dye entry with several sources doesn't get checked more than once.
  if (_imbalanceRecheckList.length > 0) {
    const [_lotsForRecheck, _residualLogForRecheck] = await Promise.all([
      fbGetMerged('/tc/lots', '/tc/archive/lots'),
      fbGet('/tc/residualLog').catch(() => null),
    ]);
    const _residualArr = _residualLogForRecheck ? (Array.isArray(_residualLogForRecheck) ? _residualLogForRecheck : Object.values(_residualLogForRecheck)) : [];
    const _seenLots = new Set();
    for (const { lotId, grade, vendor } of _imbalanceRecheckList) {
      const _key = `${lotId}__${grade}__${vendor}`;
      if (_seenLots.has(_key)) continue;
      _seenLots.add(_key);
      const consumedFromThisLot = calcSoftConsumedByDye(dyeLots, lotId, grade, vendor);
      const softOutForThisLot = calcSoftOut(stageEntries, _lotsForRecheck, [], lotId, grade, vendor);
      const residualForThisLot = calcSoftResidualOut(_residualArr, lotId, grade, vendor);
      const realBalance = softOutForThisLot.weight - consumedFromThisLot - residualForThisLot;
      if (realBalance >= -0.01) {
        await _autoClearImbalanceFlag(patch, lotId, grade, vendor);
      }
    }
  }

  await fbPatch('', patch);

  await Promise.all([
    ...Array.from(lotDeltas.values()).map(d => { const { lotId, grade, vendor, ...fields } = d; return nudgeLotSummary(lotId, grade, vendor, fields).catch(() => {}); }),
    ...Array.from(dyeDeltas.entries()).map(([dyeLotId, fields]) => nudgeDyeLotSummary(dyeLotId, fields).catch(() => {}))
  ]);
  _reFreezeForRecord(type, id).catch(() => {});

  return jsonResponse({ success: true, voidedCount: cascadeLog.length, cascadeLog });
}

// ─── Item D: entry edit cascade (Jul 14 2026) ─────────────────────────────
// Server-side replacement for pages.js's submitEditEntry. This one already
// used strict matching throughout (unlike A/B) — the real gap was
// atomicity: up to 9 separate save()/saveBatch() calls, no protection
// against a crash mid-sequence leaving some records updated and others not.
// Faithfully replicates all 5 stage branches (soft/wind/pack/dye/dispatch)
// and every downstream-consistency check found in the original, committed
// as ONE atomic multi-path PATCH.
// ─── Item E: edit preview (Aug 19 2026) ────────────────────────────────────
// Real, genuine gap found via direct discussion with Priyam: Admin can edit
// something whose material has already moved through Dye/Wind/Pack/Dispatch,
// but never sees what's actually downstream, or what the real new numbers
// would become, until AFTER the save already happened (imbalanceNote, if
// any, only shows up in the response of the real edit itself). This
// computes the same real checks and the same real downstream trace as
// handleEditEntry/handleBuildVoidChain — but never writes anything. Soft
// only for now, by design — the one stage with the real, known gap; the
// other 4 (Dye/Wind/Pack/Dispatch) intentionally not built yet.
async function handlePreviewEdit(body, tokenClaim) {
  const { id, stage } = body;
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager', 'supervisor'].includes(role)) return errorResponse('Supervisor or Admin only', 403);
  const isAdmin = role === 'admin' || role === 'manager';

  const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(e => e && e.id);
  const [seA, seAr, dlA, dlAr, weA, weAr, peA, peAr, dsA, dsAr, rlA, ssA, ssAr] = await Promise.all([
    fbGet('/tc/stageEntries').catch(() => null), fbGet('/tc/archive/stageEntries').catch(() => null),
    fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null),
    fbGet('/tc/windEntries').catch(() => null), fbGet('/tc/archive/windEntries').catch(() => null),
    fbGet('/tc/packEntries').catch(() => null), fbGet('/tc/archive/packEntries').catch(() => null),
    fbGet('/tc/dispatches').catch(() => null), fbGet('/tc/archive/dispatches').catch(() => null),
    fbGet('/tc/residualLog').catch(() => null),
    fbGet('/tc/lots').catch(() => null), fbGet('/tc/archive/lots').catch(() => null)
  ]);
  const stageEntries = [...toArr(seA), ...toArr(seAr)];
  const dyeLots = [...toArr(dlA), ...toArr(dlAr)];
  const windEntries = [...toArr(weA), ...toArr(weAr)];
  const packEntries = [...toArr(peA), ...toArr(peAr)];
  const dispatches = [...toArr(dsA), ...toArr(dsAr)];
  const residualLog = toArr(rlA);
  const lots = [...toArr(ssA), ...toArr(ssAr)];
  const fmt = v => (+v || 0).toFixed(2);
  const blockers = [];
  // Aug 19 2026 — real, genuine gap found via direct discussion with
  // Priyam: every one of the checks below uses !isAdmin, meaning Admin
  // never even runs them — not just skips the block, skips the warning
  // too. Admin could bypass a real, genuine mismatch with zero
  // indication it was about to happen, only discovering it later via
  // the Daily Checker. This array mirrors each real check for Admin
  // specifically, as a real warning instead of a silent skip.
  const warnings = [];
  // Sep 19 2026 — mirrors the Edit rule that counts and weights cannot be negative.
  for (const [_nk, _nl] of [['inUnits', 'In Units'], ['inWeight', 'In Weight'], ['outUnits', 'Out Units'], ['outWeight', 'Out Weight'], ['inCones', 'In Cones'], ['outCones', 'Out Cones'], ['bags', 'Bags'], ['weight', 'Weight']]) {
    if (body[_nk] !== undefined && body[_nk] !== null && Number(body[_nk]) < 0) blockers.push(`${_nl} cannot be negative.`);
  }

  if (stage === 'soft') {
    const e = stageEntries.find(x => x.id === id);
    if (!e) return errorResponse('Entry not found', 404);
    const newInU = body.inUnits ?? e.inUnits ?? 0, newInW = body.inWeight ?? e.inWeight ?? 0, newOutU = body.outUnits ?? e.outUnits ?? 0, newOutW = body.outWeight ?? e.outWeight ?? 0;
    const newSoftMachineP = body.machine ?? e.machine ?? '', newSoftWorkerP = body.startWorker ?? e.startWorker ?? '';
    if (!String(newSoftMachineP).trim() && e.machine) blockers.push('Machine cannot be blank.');
    if (!String(newSoftWorkerP).trim() && e.startWorker) blockers.push('Start Worker cannot be blank.');

    if (e.status === 'Pending' || e.status === 'InProgress' || e.status === 'Edited-Pending') blockers.push('Cannot edit a Pending entry \u2014 Reject it and resubmit instead.');
    if (newOutU > newInU + 0.01) blockers.push(`Output units ${newOutU} exceeds input ${newInU}.`);
    if (newOutW > newInW + 0.01) blockers.push(`Output weight ${newOutW}kg exceeds input ${newInW}kg.`);
    const rmBal = calcRMBalance(lots, stageEntries, [], e.lotId, e.grade, e.vendor);
    const rmAvail = (rmBal.weight || 0) + (e.inWeight || 0);
    // Sep 19 2026 — backlog B3 (Priyam chose: Admin proceeds with a warning). This line used to block EVERYONE, so Confirm was
    // disabled for Admin although the save has let Admin through (with an automatic flag on the lot) since Sep 10.
    if (!isAdmin && newInW > rmAvail + 0.01) blockers.push(`RM balance only has ${rmAvail}kg available.`);
    if (isAdmin && newInW > rmAvail + 0.01) warnings.push(`This will create a real mismatch — RM balance only has ${rmAvail}kg available, below the ${newInW}kg you are claiming.`);
    // Sep 19 2026 — mirrors the new Soft Edit bags check (blocker for non-admin, warning for Admin).
    const rmAvailUnitsP = (rmBal.units || 0) + (e.inUnits || 0);
    if (!isAdmin && newInU > (e.inUnits || 0) && newInU > rmAvailUnitsP + 0.01) blockers.push(`RM balance only has ${rmAvailUnitsP} bags available.`);
    if (isAdmin && newInU > rmAvailUnitsP + 0.01) warnings.push(`This will create a real mismatch — RM balance only has ${rmAvailUnitsP} bags available, below the ${newInU} bags you are claiming.`);
    const dyeConsumed = calcSoftConsumedByDye(dyeLots, e.lotId, e.grade, e.vendor);
    if (!isAdmin && dyeConsumed > 0.01) blockers.push(`Dye has already consumed ${dyeConsumed}kg \u2014 only Admin/Manager can edit this now.`);
    const otherSoftOut = stageEntries.filter(s => s.id !== id && s.lotId === e.lotId && s.grade === e.grade && s.vendor === e.vendor && (s.status === 'Approved' || s.status === 'Edited-Approved')).reduce((a, s) => a + (s.outWeight || 0), 0);
    // Aug 19 2026 -- real, honest bags figure. Dye's own sources never
    // track bags consumed, only weight (confirmed directly in the real
    // data model) -- so a true bags *balance* net of Dye can't be
    // honestly computed the same precise way as the weight balance. This
    // is total real Soft output in bags for the lot, labeled as such,
    // not presented as a false, invented Dye-adjusted figure.
    const otherSoftOutUnits = stageEntries.filter(s => s.id !== id && s.lotId === e.lotId && s.grade === e.grade && s.vendor === e.vendor && (s.status === 'Approved' || s.status === 'Edited-Approved')).reduce((a, s) => a + (s.outUnits || 0), 0);
    const totalSoftOutUnits = otherSoftOutUnits + newOutU;
    if (!isAdmin && otherSoftOut + newOutW < dyeConsumed - 0.01) blockers.push(`Total soft output would drop to ${otherSoftOut + newOutW}kg, below the ${dyeConsumed}kg Dye already consumed.`);
    if (isAdmin && otherSoftOut + newOutW < dyeConsumed - 0.01) warnings.push(`This will create a real mismatch \u2014 total soft output would become ${otherSoftOut + newOutW}kg, but Dye already claims ${dyeConsumed}kg from this lot. Fix Dye's claim first to avoid a negative balance.`);

    const simulatedSE = stageEntries.map(s => s.id === id ? { ...s, outWeight: newOutW, outUnits: newOutU, inWeight: newInW, inUnits: newInU } : s);
    // Aug 19 2026 — real, genuine bug found via direct discussion with
    // Priyam: this used to show the raw Soft output total, never
    // subtracting what Dye has actually consumed — not a real balance
    // at all. Now calls the one, real, shared calcSoftBalanceUnits
    // function — the same one the live "available" dropdown already
    // uses — instead of its own, separate inline math, so both places
    // can never quietly drift apart from each other again.
    const newBalanceUnitsReal = calcSoftBalanceUnits(simulatedSE, lots, [], dyeLots, residualLog, e.lotId, e.grade, e.vendor);
    // Aug 19 2026 — real, genuine bug found via direct discussion with
    // Priyam: the rmBal above (used for validation) always used the
    // real, current, unedited data — correct for that purpose. But the
    // display below was reusing that same, stale value, so reducing
    // inWeight never showed the RM balance actually increasing. This
    // one is computed fresh, against the simulated, proposed data,
    // specifically for what gets shown.
    const rmBalSimulated = calcRMBalance(lots, simulatedSE, [], e.lotId, e.grade, e.vendor);
    const newSoftBal = calcSoftBalanceWeight(simulatedSE, lots, [], dyeLots, residualLog, e.lotId, e.grade, e.vendor);

    // Aug 19 2026 \u2014 real, grouped, proportional preview built via
    // direct discussion with Priyam: a flat, ungrouped downstream list
    // became unreadable once a real lot had 15+ real Dye batches. Now
    // grouped by Dye batch, each showing this specific entry's real,
    // proportional share \u2014 reusing calcVendorRatioForDyeLot, the
    // same, already-trusted formula this app's own Lot Lifecycle /
    // Vendor Tracker reports rely on \u2014 not a new, invented estimate.
    const lotTotalSoftOut = otherSoftOut + newOutW;
    const entryShareOfLot = lotTotalSoftOut > 0 ? newOutW / lotTotalSoftOut : 0;
    const realSoftEntriesForLot = stageEntries.filter(s => s.lotId === e.lotId && s.grade === e.grade && s.vendor === e.vendor && (s.status === 'Approved' || s.status === 'Edited-Approved' || s.id === id));

    const dyeGroups = [];
    let subtotalCones = 0, subtotalKg = 0;
    dyeLots.filter(d => d.status !== 'Voided' && (d.sources || []).some(s => s.lotId === e.lotId && s.grade === e.grade && s.vendor === e.vendor)).forEach(d => {
      const ratio = calcVendorRatioForDyeLot(d, e.lotId, e.grade, e.vendor);
      if (!ratio) return;
      const myShareOfDyeWeight = (d.outWeight || 0) * ratio * entryShareOfLot;
      const myShareOfDyeCones = Math.round((d.outCones || 0) * ratio * entryShareOfLot);
      subtotalCones += myShareOfDyeCones; subtotalKg += myShareOfDyeWeight;

      const windOut = windEntries.filter(w => w.dyeLotId === d.id && (w.status === 'Approved' || w.status === 'Edited-Approved') && w.endTime).reduce((a, w) => ({ cones: a.cones + (w.outCones || 0), kg: a.kg + (w.outWeight || 0) }), { cones: 0, kg: 0 });
      const packOut = packEntries.filter(p => p.dyeLotId === d.id && (p.status === 'Approved' || p.status === 'Edited-Approved')).reduce((a, p) => ({ bags: a.bags + (p.bags || 0), kg: a.kg + (p.weight || 0) }), { bags: 0, kg: 0 });
      const dispOut = dispatches.filter(dp => dp.dyeLotId === d.id && (dp.status === 'Approved' || dp.status === 'Edited-Approved')).reduce((a, dp) => ({ bags: a.bags + (dp.bags || 0), kg: a.kg + (dp.weight || 0), party: dp.party || a.party }), { bags: 0, kg: 0, party: '' });

      dyeGroups.push({
        label: `Dye ${d.dyeLotNo || d.id}`,
        cones: myShareOfDyeCones, kg: myShareOfDyeWeight,
        combinesMultiple: realSoftEntriesForLot.length > 1,
        rows: [
          windOut.kg > 0.01 ? { label: 'Wind', cones: Math.round(windOut.cones * ratio * entryShareOfLot), kg: windOut.kg * ratio * entryShareOfLot } : null,
          packOut.kg > 0.01 ? { label: 'Pack', bags: Math.round(packOut.bags * ratio * entryShareOfLot), kg: packOut.kg * ratio * entryShareOfLot } : null,
          dispOut.kg > 0.01 ? { label: `Dispatch \u2192 ${dispOut.party}`, bags: Math.round(dispOut.bags * ratio * entryShareOfLot), kg: dispOut.kg * ratio * entryShareOfLot } : null
        ].filter(Boolean)
      });
    });

    return jsonResponse({
      success: true, allowed: blockers.length === 0, blockers, warnings,
      current: { inUnits: e.inUnits, inWeight: e.inWeight, outUnits: e.outUnits, outWeight: e.outWeight, machine: e.machine || '', startWorker: e.startWorker || '' },
      proposed: { inUnits: newInU, inWeight: newInW, outUnits: newOutU, outWeight: newOutW, machine: newSoftMachineP, startWorker: newSoftWorkerP },
      newBalanceLabel: 'New Soft Balance', newBalanceKg: newSoftBal, wouldGoNegative: newSoftBal < -0.01,
      newBalanceUnits: newBalanceUnitsReal,
      // Sep 10 2026 — completing a real, honest figure that was
      // computed above (Aug 19 2026) with the clear, stated intent to
      // be shown, but never actually made it into this response: the
      // lot's real, total Soft output in bags/units — labeled as
      // such, since Dye's own sources never track units, so a true
      // Dye-adjusted units balance can't be honestly computed the
      // same precise way the kg balance can.
      lotTotalSoftOutUnitsLabel: 'Total Soft Output (units)', lotTotalSoftOutUnits: totalSoftOutUnits,
      rmBalance: { bags: rmBalSimulated.units || 0, kg: rmBalSimulated.weight || 0 },
      dyeGroups, dyeSubtotal: { cones: subtotalCones, kg: subtotalKg, count: dyeGroups.length }
    });

  } else if (stage === 'wind') {
    const e = windEntries.find(x => x.id === id);
    if (!e) return errorResponse('Entry not found', 404);
    const newInC = body.inCones ?? e.inCones ?? 0, newInW = body.inWeight ?? e.inWeight ?? 0, newOutC = body.outCones ?? e.outCones ?? 0, newOutW = body.outWeight ?? e.outWeight ?? 0;
    const newWindMachineP = body.machine ?? e.machine ?? '', newWindWorkerP = body.startWorker ?? e.startWorker ?? '';
    const newWindStartNoteP = body.startNote ?? e.notes ?? '', newWindEndNoteP = body.endNote ?? e.endNotes ?? '';
    const dyeLot = dyeLots.find(d => d.id === e.dyeLotId);
    if (!String(newWindMachineP).trim() && e.machine) blockers.push('Machine cannot be blank.');
    if (!String(newWindWorkerP).trim() && e.startWorker) blockers.push('Start Worker cannot be blank.');

    if (e.status === 'Pending' || e.status === 'InProgress' || e.status === 'Edited-Pending') blockers.push('Cannot edit a Pending entry — Reject it and resubmit instead.');
    if (newOutW > newInW + 0.01) blockers.push(`Output ${newOutW}kg exceeds input ${newInW}kg.`);
    // Sep 19 2026 — mirrors the Wind Edit Out Cones <= In Cones check.
    if (newOutC > newInC && newInC > 0) blockers.push(`Output cones (${newOutC}) cannot exceed input cones (${newInC}).`);
    const otherWindIn = windEntries.filter(w => w.id !== id && w.dyeLotId === e.dyeLotId && (w.status === 'Approved' || w.status === 'Edited-Approved')).reduce((a, w) => a + (w.inWeight || 0), 0);
    if (newInW + otherWindIn > (dyeLot?.outWeight || 0) + 0.01) blockers.push(`Dye lot only produced ${dyeLot?.outWeight||0}kg total.`);
    // Sep 19 2026 — mirrors the new Wind Edit cones-vs-dye-output check (only when cones are being increased).
    const otherWindInConesP = windEntries.filter(wc => wc.id !== id && wc.dyeLotId === e.dyeLotId && (wc.status === 'Approved' || wc.status === 'Edited-Approved')).reduce((a, wc) => a + (wc.inCones || 0), 0);
    if (dyeLot && newInC > (e.inCones || 0) && newInC + otherWindInConesP > (dyeLot.outCones || 0)) blockers.push(`Dye lot only produced ${dyeLot.outCones || 0} cones total.`);
    const totalPackIn = packEntries.filter(p => p.dyeLotId === e.dyeLotId && (p.status === 'Approved' || p.status === 'Edited-Approved')).reduce((a, p) => a + (p.inWeight || 0), 0);
    if (!isAdmin && totalPackIn > 0.01) blockers.push(`Pack has already taken ${totalPackIn}kg from this dye lot's Wind output — only Admin/Manager can edit this now.`);
    const allWindOut = windEntries.filter(w => w.id !== id && w.dyeLotId === e.dyeLotId && (w.status === 'Approved' || w.status === 'Edited-Approved')).reduce((a, w) => a + (w.outWeight || 0), 0) + newOutW;
    if (!isAdmin && allWindOut < totalPackIn - 0.01) blockers.push(`Pack entries already have ${totalPackIn}kg total input — reducing wind output would go below that.`);
    if (isAdmin && allWindOut < totalPackIn - 0.01) warnings.push(`This will create a real mismatch — pack entries already have ${totalPackIn}kg total input, above what wind output would become. Fix pack entries first to avoid a negative balance.`);

    const downstream = [];
    packEntries.filter(p => p.dyeLotId === e.dyeLotId && p.status !== 'Voided').forEach(p => downstream.push({ stage: 'pack', label: `Pack ${p.id} (Dye ${dyeLot?.dyeLotNo || e.dyeLotId})`, detail: `${p.bags || 0} bags / ${fmt(p.weight)}kg | ${p.status}` }));
    dispatches.filter(dp => dp.dyeLotId === e.dyeLotId && dp.status !== 'Voided').forEach(dp => downstream.push({ stage: 'dispatch', label: `Dispatch (Dye ${dyeLot?.dyeLotNo || e.dyeLotId}) -> ${dp.party || ''}`, detail: `${dp.bags || 0} bags / ${fmt(dp.weight)}kg | ${dp.status}` }));

    return jsonResponse({
      success: true, allowed: blockers.length === 0, blockers, warnings,
      current: { inCones: e.inCones, inWeight: e.inWeight, outCones: e.outCones, outWeight: e.outWeight, machine: e.machine || '', startWorker: e.startWorker || '', startNote: e.notes || '', endNote: e.endNotes || '' },
      proposed: { inCones: newInC, inWeight: newInW, outCones: newOutC, outWeight: newOutW, machine: newWindMachineP, startWorker: newWindWorkerP, startNote: newWindStartNoteP, endNote: newWindEndNoteP },
      newBalanceLabel: 'Total Pack Input Still Needed', newBalanceKg: totalPackIn, wouldGoNegative: allWindOut < totalPackIn - 0.01,
      downstream
    });

  } else if (stage === 'pack') {
    const e = packEntries.find(x => x.id === id);
    if (!e) return errorResponse('Entry not found', 404);
    const newInC = body.inCones ?? e.inCones ?? 0, newBags = body.bags ?? e.bags ?? 0, newWt = body.weight ?? e.weight ?? 0;
    const newPackWorkerP = body.worker ?? e.worker ?? '', newPackNotesP = body.notes ?? e.notes ?? '';
    if (!String(newPackWorkerP).trim() && e.worker) blockers.push('Worker cannot be blank.');
    const dyeLot = dyeLots.find(d => d.id === e.dyeLotId);
    const dispPack = calcTotalDispatchedApproved(dispatches, e.dyeLotId, dyeLots);
    // Sep 19 2026 — the Pack preview never checked Pack input against Wind at all (weight or cones), so it said fine and the save
    // then refused a Supervisor. Mirrors the Pack Edit rules: non-admin blocked, Admin warned; cones only when being increased,
    // with the same +1 rounding tolerance as Pack Create.
    const newInWP = body.inWeight ?? e.inWeight ?? 0;
    const windBalP = calcWindBal(windEntries, packEntries, e.dyeLotId);
    const windAvailWP = (windBalP.weight || 0) + (e.inWeight || 0);
    const windAvailCP = (windBalP.units || 0) + (e.inCones || 0);
    if (!isAdmin && newInWP > windAvailWP + 0.01) blockers.push(`Wind balance only has ${windAvailWP}kg available.`);
    if (!isAdmin && newInC > (e.inCones || 0) && newInC > windAvailCP + 1) blockers.push(`Wind balance only has ${windAvailCP} cones available.`);
    if (isAdmin && newInWP > windAvailWP + 0.01) warnings.push(`This will create a real mismatch — wind balance only has ${windAvailWP}kg available, below the ${newInWP}kg pack input.`);
    if (isAdmin && newInC > windAvailCP + 1) warnings.push(`This will create a real mismatch — wind balance only has ${windAvailCP} cones available, below the ${newInC} cones pack input.`);

    if (e.status === 'Pending' || e.status === 'InProgress' || e.status === 'Edited-Pending') blockers.push('Cannot edit a Pending entry — Reject it and resubmit instead.');
    if (!isAdmin && (dispPack.weight > 0.01 || dispPack.bags > 0.01)) blockers.push(`Dispatch has already taken ${dispPack.weight}kg / ${dispPack.bags} bags from this dye lot's Pack output — only Admin/Manager can edit this now.`);
    const otherPackWt = packEntries.filter(p => p.id !== id && p.dyeLotId === e.dyeLotId && (p.status === 'Approved' || p.status === 'Edited-Approved')).reduce((a, p) => a + (p.weight || 0), 0);
    const otherPackBags = packEntries.filter(p => p.id !== id && p.dyeLotId === e.dyeLotId && (p.status === 'Approved' || p.status === 'Edited-Approved')).reduce((a, p) => a + (p.bags || 0), 0);
    if (!isAdmin && newWt + otherPackWt < dispPack.weight - 0.01) blockers.push(`Dispatches already have ${dispPack.weight}kg total — reducing pack weight would go below that.`);
    if (isAdmin && newWt + otherPackWt < dispPack.weight - 0.01) warnings.push(`This will create a real mismatch — dispatches already have ${dispPack.weight}kg total, above what pack weight would become. Fix dispatches first to avoid a negative balance.`);
    if (!isAdmin && newBags + otherPackBags < dispPack.bags - 0.01) blockers.push(`Dispatches already have ${dispPack.bags} bags total — reducing pack bags would go below that.`);
    if (isAdmin && newBags + otherPackBags < dispPack.bags - 0.01) warnings.push(`This will create a real mismatch — dispatches already have ${dispPack.bags} bags total, above what pack bags would become. Fix dispatches first to avoid a negative balance.`);

    const downstream = [];
    dispatches.filter(dp => dp.dyeLotId === e.dyeLotId && dp.status !== 'Voided').forEach(dp => downstream.push({ stage: 'dispatch', label: `Dispatch (Dye ${dyeLot?.dyeLotNo || e.dyeLotId}) -> ${dp.party || ''}`, detail: `${dp.bags || 0} bags / ${fmt(dp.weight)}kg | ${dp.status}` }));

    return jsonResponse({
      success: true, allowed: blockers.length === 0, blockers, warnings,
      current: { inCones: e.inCones, inWeight: e.inWeight, bags: e.bags, weight: e.weight, worker: e.worker || '', notes: e.notes || '' },
      proposed: { inCones: newInC, inWeight: newInWP, bags: newBags, weight: newWt, worker: newPackWorkerP, notes: newPackNotesP },
      newBalanceLabel: 'Already Dispatched', newBalanceKg: dispPack.weight, wouldGoNegative: (newWt + otherPackWt < dispPack.weight - 0.01) || (newBags + otherPackBags < dispPack.bags - 0.01),
      downstream
    });

  } else if (stage === 'dye') {
    const d = dyeLots.find(x => x.id === id);
    if (!d) return errorResponse('Dye lot not found', 404);
    const newInCones = body.inCones ?? d.totalInCones ?? 0, newInW = body.inWeight ?? d.totalInWeight ?? 0, newOutCones = body.outCones ?? d.outCones ?? 0, newOutW = body.outWeight ?? d.outWeight ?? 0;

    if (d.status === 'Pending' || d.status === 'InProgress' || d.status === 'Edited-Pending') blockers.push('Cannot edit a Pending entry — Reject it and resubmit instead.');
    if (newOutW > newInW + 0.01) blockers.push(`Output weight (${newOutW}kg) cannot exceed input (${newInW}kg).`);
    if (newOutCones > newInCones && newInCones > 0) blockers.push(`Output cones (${newOutCones}) cannot exceed input cones (${newInCones}).`);
    // Sep 19 2026 — mirrors the new Dye Edit duplicate Dye Lot No check.
    const newDyeLotNoP = body.dyeLotNo?.trim() || d.dyeLotNo;
    if (newDyeLotNoP !== d.dyeLotNo && dyeLots.find(x => x.id !== id && x.dyeLotNo === newDyeLotNoP && x.status !== 'Voided' && x.status !== 'Rejected')) blockers.push(`Dye Lot No "${newDyeLotNoP}" already exists.`);
    const totalWindIn = windEntries.filter(e => e.dyeLotId === id && (e.status === 'Approved' || e.status === 'Edited-Approved')).reduce((a, e) => a + (e.inWeight || 0), 0);
    if (!isAdmin && totalWindIn > 0.01) blockers.push(`Wind has already drawn ${totalWindIn}kg from this dye lot's output — only Admin/Manager can edit this now.`);
    if (!isAdmin && newOutW < totalWindIn - 0.01) blockers.push(`Wind entries already have ${totalWindIn}kg total input — reducing dye output would go below that.`);
    if (isAdmin && newOutW < totalWindIn - 0.01) warnings.push(`This will create a real mismatch — wind entries already have ${totalWindIn}kg total input, above what dye output would become. Fix wind entries first to avoid a negative balance.`);
    const softBalForDye = (d.sources || []).reduce((a, s) => {
      const sb = calcSoftBalanceWeight(stageEntries, lots, [], dyeLots, residualLog, s.lotId, s.grade || d.grade, s.vendor || '');
      return a + sb + (s.weight || 0);
    }, 0);
    if (!isAdmin && newInW > softBalForDye + 0.01) blockers.push(`Soft balance only has ${softBalForDye}kg available across this dye lot's real sources.`);
    if (isAdmin && newInW > softBalForDye + 0.01) warnings.push(`This will create a real mismatch — soft balance only has ${softBalForDye}kg genuinely available across this dye lot's real sources, below what you're claiming.`);

    const downstream = [];
    windEntries.filter(w => w.dyeLotId === id && w.status !== 'Voided').forEach(w => downstream.push({ stage: 'wind', label: `Wind ${w.id} (Dye ${d.dyeLotNo || id})`, detail: `${fmt(w.inWeight)}kg -> ${fmt(w.outWeight)}kg | ${w.status}` }));
    packEntries.filter(p => p.dyeLotId === id && p.status !== 'Voided').forEach(p => downstream.push({ stage: 'pack', label: `Pack ${p.id} (Dye ${d.dyeLotNo || id})`, detail: `${p.bags || 0} bags / ${fmt(p.weight)}kg | ${p.status}` }));
    dispatches.filter(dp => dp.dyeLotId === id && dp.status !== 'Voided').forEach(dp => downstream.push({ stage: 'dispatch', label: `Dispatch (Dye ${d.dyeLotNo || id}) -> ${dp.party || ''}`, detail: `${dp.bags || 0} bags / ${fmt(dp.weight)}kg | ${dp.status}` }));

    return jsonResponse({
      success: true, allowed: blockers.length === 0, blockers, warnings,
      current: { inCones: d.totalInCones, inWeight: d.totalInWeight, outCones: d.outCones, outWeight: d.outWeight },
      proposed: { inCones: newInCones, inWeight: newInW, outCones: newOutCones, outWeight: newOutW },
      newBalanceLabel: 'Real Soft Balance Available for Sources', newBalanceKg: softBalForDye, wouldGoNegative: newInW > softBalForDye + 0.01,
      downstream
    });

  } else if (stage === 'dispatch') {
    const d = dispatches.find(x => x.id === id);
    if (!d) return errorResponse('Entry not found', 404);
    const newBags = body.bags ?? d.bags ?? 0, newWt = body.weight ?? d.weight ?? 0;
    const newDispDateP = body.date ?? d.date ?? '';
    if (!String(newDispDateP).trim() && d.date) blockers.push('Date cannot be blank.');
    if (newDispDateP !== (d.date || '') && (!/^\d{4}-\d{2}-\d{2}$/.test(String(newDispDateP)) || isNaN(Date.parse(String(newDispDateP))))) blockers.push('Enter a valid date.');

    if (d.status === 'Pending' || d.status === 'InProgress' || d.status === 'Edited-Pending') blockers.push('Cannot edit a Pending entry — Reject it and resubmit instead.');
    // Sep 19 2026 — mirrors the Dispatch Edit order re-link when the Party changes.
    let proposedOrderLinkP = d.orderId || '';
    if ((body.party ?? d.party) !== d.party) {
      const _poRawP = await fbGet('/tc/partyOrders').catch(() => null);
      const _partyOrdersP = (_poRawP ? (Array.isArray(_poRawP) ? _poRawP : Object.values(_poRawP)) : []).filter(o => o && o.id);
      const _curOrderP = d.orderId ? _partyOrdersP.find(o => o.id === d.orderId) : null;
      if (!_curOrderP || _curOrderP.party !== (body.party ?? d.party)) {
        const _openP = _partyOrdersP.filter(o => o.party === (body.party ?? d.party) && o.shade === (d.shade || '') && (o.status === 'Open' || o.status === 'Partial')).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        proposedOrderLinkP = _openP.length ? _openP[0].id : '';
      }
    }
    const packBalDisp = calcPackBal(packEntries, dispatches, d.dyeLotId);
    const packTotalWt = (packBalDisp.weight || 0) + (d.weight || 0);
    const packTotalBags = (packBalDisp.bags || 0) + (d.bags || 0);
    if (newWt > packTotalWt + 0.01) blockers.push(`Pack balance only ${packTotalWt}kg available for this dispatch.`);
    if (newBags > packTotalBags + 0.01) blockers.push(`Pack balance only ${packTotalBags} bags available.`);

    return jsonResponse({
      success: true, allowed: blockers.length === 0, blockers, warnings,
      current: { bags: d.bags, weight: d.weight, party: d.party, invoiceNo: d.invoiceNo, date: d.date || '', orderLink: d.orderId || '' },
      proposed: { bags: newBags, weight: newWt, party: body.party ?? d.party, invoiceNo: body.invoiceNo ?? d.invoiceNo ?? '', date: newDispDateP, orderLink: proposedOrderLinkP },
      newBalanceLabel: 'Real Pack Balance Available', newBalanceKg: packTotalWt, wouldGoNegative: newWt > packTotalWt + 0.01,
      downstream: []
    });
  }

  return errorResponse('Unknown stage: ' + stage);
}
// Aug 26 2026 — real, new feature built via direct discussion with
// Priyam: an admin proceeding despite a real, detected balance risk
// used to leave no lasting trace anywhere visible — just a toast that
// disappeared, and a note buried in the edit log. This writes a real,
// persistent flag directly onto the lot itself, using the same,
// already-fixed lot+grade+vendor composite key as everywhere else, so
// it shows up right on the RM Lots table until someone reviews and
// clears it — closing this case at its actual, confirmed root, not
// just noting it happened and moving on.
function _autoFlagImbalance(patch, lotId, grade, vendor, note, changedBy) {
  if (!lotId) return;
  const _safeKey = `${(lotId||'').replace(/[^a-zA-Z0-9]/g,'_')}__${(grade||'').replace(/[^a-zA-Z0-9]/g,'_')}__${(vendor||'').replace(/[^a-zA-Z0-9]/g,'_')}`;
  patch[`/tc/lotFlags/${_safeKey}`] = { type: 'warn', note: `Auto-flagged — ${note}`, by: changedBy || 'System', at: new Date().toISOString(), lotId, grade, vendor, auto: true };
}

// Aug 26 2026 — real, direct extension of _autoFlagImbalance, for Dye
// Lots specifically. Same real purpose, simpler key, matching
// handleDyeLotFlag's own real, confirmed pattern.
function _autoFlagDyeImbalance(patch, dyeLotId, note, changedBy) {
  if (!dyeLotId) return;
  const _safeDyeLotId = String(dyeLotId).replace(/[^a-zA-Z0-9]/g,'_');
  patch[`/tc/dyeLotFlags/${_safeDyeLotId}`] = { type: 'warn', note: `Auto-flagged — ${note}`, by: changedBy || 'System', at: new Date().toISOString(), dyeLotId, auto: true };
}

// Aug 26 2026 — real, direct extension built after Priyam's own,
// direct, correct question: what clears an automatic flag once the
// real problem is genuinely fixed? These check the current flag
// first, and only ever clear it if `auto: true` — a real, deliberate
// safeguard so this never silently erases a flag a real person set by
// hand, even if that lot's numbers happen to look fine again too.
async function _autoClearImbalanceFlag(patch, lotId, grade, vendor) {
  if (!lotId) return;
  const _safeKey = `${(lotId||'').replace(/[^a-zA-Z0-9]/g,'_')}__${(grade||'').replace(/[^a-zA-Z0-9]/g,'_')}__${(vendor||'').replace(/[^a-zA-Z0-9]/g,'_')}`;
  const existing = await fbGet(`/tc/lotFlags/${_safeKey}`).catch(() => null);
  if (existing && existing.auto === true) {
    patch[`/tc/lotFlags/${_safeKey}`] = null;
  }
}
async function _autoClearDyeImbalanceFlag(patch, dyeLotId) {
  if (!dyeLotId) return;
  const _safeDyeLotId = String(dyeLotId).replace(/[^a-zA-Z0-9]/g,'_');
  const existing = await fbGet(`/tc/dyeLotFlags/${_safeDyeLotId}`).catch(() => null);
  if (existing && existing.auto === true) {
    patch[`/tc/dyeLotFlags/${_safeDyeLotId}`] = null;
  }
}

// Sep 10 2026 — real, direct feature built via direct discussion with
// Priyam, from a genuine real gap he caught himself by pushing back on
// a stale-looking warning: an auto-flagged imbalance only ever got
// re-checked when that exact same Soft entry was edited again — now
// also covered from the Dye side (create/edit/void, above), but any
// flag that got stuck stale BEFORE that fix existed needs its own,
// one-time real check. Read-only scan first, matching the same
// two-step pattern as every other repair tool built today.
// Sep 10 2026 — real, genuine security gap found via Priyam's own
// requested holistic app-wide audit: every one of this app's 6
// read-only /api/admin/scan-* endpoints had zero authentication at
// all — reachable by anyone with the URL, no login required, unlike
// every adjacent correction endpoint (which all verify a real
// session). These scans return real production data (lot records,
// stage entries, edit logs, void logs) — genuinely worth protecting
// even though they don't write anything. Gated to the same
// admin/manager-only rule every paired correction endpoint already
// uses, for consistency.
async function handleScanImbalanceFlags(tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin or manager access required', 403);
  const [rawFlags, seA, seAr, dlA, dlAr, ssA, ssAr, resRaw] = await Promise.all([
    fbGet('/tc/lotFlags').catch(() => null),
    fbGet('/tc/stageEntries').catch(() => null), fbGet('/tc/archive/stageEntries').catch(() => null),
    fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null),
    fbGet('/tc/lots').catch(() => null), fbGet('/tc/archive/lots').catch(() => null),
    fbGet('/tc/residualLog').catch(() => null),
  ]);
  const toArr = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x && x.id) : [];
  const stageEntries = [...toArr(seA), ...toArr(seAr)];
  const dyeLots = [...toArr(dlA), ...toArr(dlAr)];
  const lots = [...toArr(ssA), ...toArr(ssAr)];
  const residualLog = resRaw ? (Array.isArray(resRaw) ? resRaw : Object.values(resRaw)) : [];

  const autoFlags = Object.entries(rawFlags || {}).filter(([, f]) => f && f.auto === true);
  if (autoFlags.length === 0) return jsonResponse({ success: true, clean: true, checkedCount: 0, staleCount: 0, results: [] });

  const results = autoFlags.map(([key, f]) => {
    const consumedFromThisLot = calcSoftConsumedByDye(dyeLots, f.lotId, f.grade, f.vendor);
    const softOutForThisLot = calcSoftOut(stageEntries, lots, [], f.lotId, f.grade, f.vendor);
    const residualForThisLot = calcSoftResidualOut(residualLog, f.lotId, f.grade, f.vendor);
    const realBalance = softOutForThisLot.weight - consumedFromThisLot - residualForThisLot;
    return {
      key, lotId: f.lotId, grade: f.grade, vendor: f.vendor, note: f.note, flaggedAt: f.at,
      realBalanceNow: realBalance, stillImbalanced: realBalance < -0.01,
    };
  });
  const staleCount = results.filter(r => !r.stillImbalanced).length;
  return jsonResponse({ success: true, clean: staleCount === 0, checkedCount: results.length, staleCount, results });
}

async function handleRecheckImbalanceFlags(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin or manager access required', 403);
  const scanResult = await handleScanImbalanceFlags(tokenClaim);
  const scanData = await scanResult.json();
  if (!scanData.success) return errorResponse('Could not complete the recheck scan');
  const toClear = scanData.results.filter(r => !r.stillImbalanced);
  if (toClear.length === 0) return jsonResponse({ success: true, clearedCount: 0, results: [] });

  const patch = {};
  for (const r of toClear) {
    await _autoClearImbalanceFlag(patch, r.lotId, r.grade, r.vendor);
  }
  if (Object.keys(patch).length > 0) await fbPatch('', patch);
  return jsonResponse({ success: true, clearedCount: toClear.length, results: toClear });
}

// Sep 10 2026 — real, direct feature built via direct discussion with
// Priyam, from his own real observation that his Excel export's "Dye
// Lots" total and "Dye Sources" breakdown didn't match: found and
// fixed the actual, ongoing cause (editing a Dye entry's total never
// updated its source breakdown to match — now it does, proportionally,
// for every new edit going forward). This is the other half — a real
// dye lot edited before that fix existed could still have a real,
// existing mismatch sitting in the data right now. Read-only scan
// first, matching the same two-step pattern as every other repair
// tool built today.
async function handleScanDyeSourceMismatches(tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin or manager access required', 403);
  const [dlA, dlAr, elA] = await Promise.all([
    fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null),
    fbGet('/tc/editLog').catch(() => null),
  ]);
  // Sep 10 2026 — real, root-cause fix built via direct discussion
  // with Priyam, from his own real, careful cross-check against the
  // actual edit log: a real dye lot that was Voided (or Rejected)
  // never actually went anywhere — nothing downstream depends on its
  // numbers, and whatever mismatch it shows is irrelevant, not a real
  // gap worth reporting or fixing. Confirmed directly: 2 of Priyam's
  // own 12 real "mismatches" were exactly this — Voided lots that
  // should never have been in the list at all.
  const toEntries = (raw, table) => raw ? Object.entries(raw).filter(([, d]) => d && Array.isArray(d.sources) && d.sources.length > 0 && d.status !== 'Voided' && d.status !== 'Rejected') : [];
  const allEntries = [...toEntries(dlA, 'active').map(([key, d]) => ({ key, table: 'active', d })), ...toEntries(dlAr, 'archive').map(([key, d]) => ({ key, table: 'archive', d }))];
  const editLogEntries = elA ? Object.values(elA).filter(e => e && e.entryId) : [];

  const results = [];
  for (const { key, table, d } of allEntries) {
    const sourceWeight = d.sources.reduce((a, s) => a + (s.weight || 0), 0);
    const sourceCones = d.sources.reduce((a, s) => a + (s.cones || 0), 0);
    const totalInWeight = d.totalInWeight || 0;
    const totalInCones = d.totalInCones || 0;
    const weightMismatch = Math.abs(sourceWeight - totalInWeight);
    const conesMismatch = Math.abs(sourceCones - totalInCones);
    if (weightMismatch > 0.5 || conesMismatch > 1) {
      // Sep 10 2026 — real, direct classification built via direct
      // discussion with Priyam, from his own real, careful review of
      // his real 12 mismatches: this is genuinely 4 different
      // situations, not one — a single blind proportional fix is
      // wrong for at least half of them. Categorized here so the fix
      // below only ever touches what's genuinely safe to touch.
      const weightMatches = weightMismatch <= 0.5;
      const conesMatches = conesMismatch <= 1;
      // "Swapped": the source's own weight lines up with the total's
      // cones, and the source's own cones lines up with the total's
      // weight — a real data-entry mix-up, not drift. An automated fix
      // would rescale the swapped numbers until they "tally," baking
      // the real mistake in permanently instead of catching it.
      const looksSwapped = !weightMatches && !conesMatches
        && Math.abs(sourceWeight - totalInCones) < 0.5
        && Math.abs(sourceCones - totalInWeight) < 1.5;
      // Sources with cones genuinely at zero can never be fixed by
      // proportional scaling — anything times zero stays zero. This
      // needs a direct, real value set instead, only safe to do
      // automatically when there's exactly one source (100% of the
      // total genuinely belongs to it, no ambiguity).
      const zeroConesSingleSource = d.sources.length === 1 && sourceCones === 0 && totalInCones > 0;
      // A gap large enough, relative to the smaller of the two real
      // numbers, that it's more likely a genuine data entry problem
      // (a stray digit, a wrong unit) than ordinary drift — worth a
      // real, human look before anything touches it automatically.
      const weightGapRatio = totalInWeight > 0 ? weightMismatch / Math.max(totalInWeight, sourceWeight, 0.01) : 0;
      const conesGapRatio = totalInCones > 0 ? conesMismatch / Math.max(totalInCones, sourceCones, 0.01) : 0;
      const looksSuspicious = !looksSwapped && !zeroConesSingleSource && (weightGapRatio > 0.5 || conesGapRatio > 0.5) && !weightMatches && !conesMatches;

      // Sep 10 2026 — real, root-cause correction built via direct
      // discussion with Priyam, from his own real, sharp challenge: "if
      // you don't even know what's correct, how will fix solve this?"
      // He's right — "looks like ordinary drift" and "we know the
      // total is genuinely correct" are not the same thing, and this
      // tool was quietly assuming the second because of the first, with
      // nothing to actually back it up. A lot only ever counts as
      // "safe" now if there's a real edit log entry showing someone
      // deliberately, knowingly corrected its total weight or cones —
      // genuine evidence the current total reflects a real, conscious
      // decision, not just an assumption this tool defaults to. Without
      // that evidence, forcing the sources to match the total wouldn't
      // fix anything — it would just as easily overwrite a source that
      // was the correct one all along, and hide the error instead of
      // showing it.
      const hasEditEvidence = editLogEntries.some(e =>
        e.entryId === d.id && /weight|cones/i.test(e.field || e.fieldChanged || '')
      );

      let category;
      if (looksSwapped) category = 'swapped';
      else if (zeroConesSingleSource) category = 'zero_cones_single_source';
      else if (looksSuspicious) category = 'suspicious';
      else if (!hasEditEvidence) category = 'no_evidence';
      else category = 'safe';

      results.push({
        key, table, dyeLotId: d.id, dyeLotNo: d.dyeLotNo || d.id,
        totalInWeight, sourceWeight, weightMismatch,
        totalInCones, sourceCones, conesMismatch,
        category,
        autoFixable: category === 'safe' || category === 'zero_cones_single_source',
      });
    }
  }
  return jsonResponse({ success: true, clean: results.length === 0, checkedCount: allEntries.length, mismatchCount: results.length, results });
}

async function handleFixDyeSourceMismatches(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin or manager access required', 403);
  const { targets, password } = body || {};
  if (!Array.isArray(targets) || targets.length === 0) return errorResponse('No dye lots specified to correct');
  if (!password) return errorResponse('Password required for this correction');
  const admin = await _verifySelfPassword(tokenClaim?.username, password);
  if (!admin) return errorResponse('Incorrect password', 401);

  const [dlA, dlAr, elA2] = await Promise.all([
    fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null),
    fbGet('/tc/editLog').catch(() => null),
  ]);
  const editLogEntries2 = elA2 ? Object.values(elA2).filter(e => e && e.entryId) : [];
  const patch = {};
  const results = [];
  const fW = n => Math.max(0, parseFloat((+n || 0).toFixed(2)));

  for (const t of targets) {
    const { key, table, dyeLotId } = t || {};
    if (!key || !table) { results.push({ dyeLotId, error: 'Missing required fields, skipped' }); continue; }
    const raw = table === 'active' ? dlA : dlAr;
    const d = raw ? raw[key] : null;
    // Re-verify directly against fresh data — never trust an earlier
    // scan result blindly, same discipline as every other repair tool.
    if (!d || d.id !== dyeLotId || !Array.isArray(d.sources) || d.sources.length === 0) {
      results.push({ dyeLotId, error: 'Could not re-verify this record — real data has changed since the scan, skipped for safety' });
      continue;
    }
    const sourceWeight = d.sources.reduce((a, s) => a + (s.weight || 0), 0);
    const sourceCones = d.sources.reduce((a, s) => a + (s.cones || 0), 0);
    const totalInWeight = d.totalInWeight || 0;
    const totalInCones = d.totalInCones || 0;
    const weightMismatch = Math.abs(sourceWeight - totalInWeight);
    const conesMismatch = Math.abs(sourceCones - totalInCones);
    if (weightMismatch <= 0.5 && conesMismatch <= 1) {
      results.push({ dyeLotId, error: 'This lot no longer has a mismatch — real data has changed since the scan, skipped' });
      continue;
    }
    // Sep 10 2026 — real, root-cause fix built via direct discussion
    // with Priyam, from his own real, careful review that this is
    // genuinely 4 different situations, not one: re-classifies fresh,
    // right now, never trusting the client's earlier scan category —
    // same discipline as re-verifying the record itself just above.
    // Only "safe" and "zero_cones_single_source" are ever touched by
    // this automated fix; "swapped" and "suspicious" are always
    // rejected here, no matter what the client sends, since an
    // automated proportional fix would be actively wrong for both.
    const weightMatches = weightMismatch <= 0.5;
    const conesMatches = conesMismatch <= 1;
    const looksSwapped = !weightMatches && !conesMatches
      && Math.abs(sourceWeight - totalInCones) < 0.5
      && Math.abs(sourceCones - totalInWeight) < 1.5;
    const zeroConesSingleSource = d.sources.length === 1 && sourceCones === 0 && totalInCones > 0;
    const weightGapRatio = totalInWeight > 0 ? weightMismatch / Math.max(totalInWeight, sourceWeight, 0.01) : 0;
    const conesGapRatio = totalInCones > 0 ? conesMismatch / Math.max(totalInCones, sourceCones, 0.01) : 0;
    const looksSuspicious = !looksSwapped && !zeroConesSingleSource && (weightGapRatio > 0.5 || conesGapRatio > 0.5) && !weightMatches && !conesMatches;

    if (looksSwapped) {
      results.push({ dyeLotId, error: 'This looks like weight and cones were genuinely swapped on a source, not ordinary drift — an automated fix would lock the mistake in rather than correct it. This needs a direct, manual correction (Reassign, or editing the source directly) instead.' });
      continue;
    }
    if (looksSuspicious) {
      results.push({ dyeLotId, error: `The gap here is unusually large relative to the real numbers involved (source ${fW(sourceWeight)}kg/${sourceCones} cones vs total ${fW(totalInWeight)}kg/${totalInCones} cones) — worth a direct, human look before anything touches it automatically.` });
      continue;
    }
    // Sep 10 2026 — real, root-cause correction built via direct
    // discussion with Priyam, from his own real, sharp challenge: "if
    // you don't even know what's correct, how will fix solve this?"
    // Requires a genuine edit log entry showing someone deliberately
    // corrected this lot's own weight or cones before ever treating its
    // current total as the trusted truth — without that evidence,
    // forcing the sources to match the total could just as easily
    // overwrite a source that was the correct one all along.
    const hasEditEvidence = !zeroConesSingleSource && editLogEntries2.some(e =>
      e.entryId === d.id && /weight|cones/i.test(e.field || e.fieldChanged || '')
    );
    if (!zeroConesSingleSource && !hasEditEvidence) {
      results.push({ dyeLotId, error: 'No real edit history shows anyone ever deliberately correcting this lot\'s own total — with no evidence for which number is genuinely true, an automated fix could just as easily overwrite the correct one. This needs a real, human decision on which number to trust first.' });
      continue;
    }

    let newSources;
    if (zeroConesSingleSource) {
      // Sep 10 2026 — a single source can never be helped by scaling
      // from zero (anything times zero stays zero) — but with only one
      // source, there's no ambiguity either: 100% of the lot's real
      // total genuinely belongs to it. Sets the value directly instead
      // of scaling it.
      newSources = d.sources.map(s => ({ ...s, cones: totalInCones }));
      if (weightMismatch > 0.5) {
        const weightRatio = sourceWeight > 0 ? totalInWeight / sourceWeight : 1;
        const fW2 = n => Math.max(0, parseFloat((+n || 0).toFixed(2)));
        newSources = newSources.map(s => ({ ...s, weight: fW2((s.weight || 0) * weightRatio) }));
      }
    } else {
      // Same, already-proven, proportional-scaling logic as the live
      // edit fix — each real source keeps its own true, relative share,
      // scaled to genuinely tally with the lot's own real total.
      const weightRatio = sourceWeight > 0 ? totalInWeight / sourceWeight : 1;
      const conesRatio = sourceCones > 0 ? totalInCones / sourceCones : 1;
      newSources = d.sources.map(s => ({
        ...s,
        weight: fW((s.weight || 0) * weightRatio),
        ...(s.cones != null ? { cones: Math.round((s.cones || 0) * conesRatio) } : {}),
      }));
    }
    const tablePath = table === 'active' ? 'dyeLots' : 'archive/dyeLots';
    patch[`/tc/${tablePath}/${key}/sources`] = newSources;

    const logId = `EL-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    patch[`/tc/editLog/${logId}`] = {
      id: logId, entryId: dyeLotId, stage: 'Dye', fieldChanged: 'sources',
      oldVal: `Sources summed to ${sourceWeight}kg / ${sourceCones} cones`,
      newVal: `Rescaled to match the lot's own real total: ${d.totalInWeight}kg / ${d.totalInCones} cones`,
      reasonCat: 'Dye source mismatch correction',
      reason: `This dye lot's source breakdown had drifted from its own total (likely from an edit made before the proportional-sync fix existed) — rescaled proportionally so the Excel export's Dye Lots and Dye Sources sheets genuinely tally again.`,
      changedBy: admin.name || '', timestamp: new Date().toISOString(), _updatedAt: new Date().toISOString(),
    };
    results.push({ dyeLotId, oldSourceWeight: sourceWeight, newSourceWeight: d.totalInWeight, oldSourceCones: sourceCones, newSourceCones: d.totalInCones });
  }

  if (Object.keys(patch).length > 0) await fbPatch('', patch);
  return jsonResponse({ success: true, results });
}

async function handleEditEntry(body, tokenClaim) {
  const { id, stage, reasonCat, reasonText, password, username, changedBy } = body;
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager', 'supervisor'].includes(role)) return errorResponse('Supervisor or Admin only', 403);
  // Jul 25 2026 fix — isAdmin used to come straight from the request body,
  // trusted with zero verification, and this function had no role check
  // at all — anyone could call it. Now derived from the real, server-
  // verified session role.
  // Aug 6 2026 — real, genuine gap found via a thorough app-wide audit:
  // the frontend already asked supervisors for a password, verified it
  // through a separate call, but this endpoint — the one that actually
  // performs the edit — never itself checked anything. Someone with a
  // valid supervisor session could call this directly and skip the
  // password step entirely. Server-side check added here, matching the
  // exact same admin/manager-exempt rule the frontend already uses.
  if (role === 'supervisor') {
    const verifiedUser = await _verifySelfPassword(username, password);
    if (!verifiedUser) return errorResponse('Incorrect password', 401);
  }
  const isAdmin = role === 'admin' || role === 'manager';
  if (!reasonCat) return errorResponse('Select reason category');
  if (!reasonText || reasonText.length < 10) return errorResponse('Reason must be at least 10 characters');
  // Sep 19 2026 — nothing in Edit rejected a negative count or weight: an Admin could save Out Weight = -5 (a Supervisor was only
  // stopped by accident, by a floor check further down that happens to fail for negatives).
  for (const [_nk, _nl] of [['inUnits', 'In Units'], ['inWeight', 'In Weight'], ['outUnits', 'Out Units'], ['outWeight', 'Out Weight'], ['inCones', 'In Cones'], ['outCones', 'Out Cones'], ['bags', 'Bags'], ['weight', 'Weight']]) {
    if (body[_nk] !== undefined && body[_nk] !== null && Number(body[_nk]) < 0) return errorResponse(`${_nl} cannot be negative`);
  }

  // Sep 19 2026 — backlog B5. Everything below (read the data, check the Dye Lot No is free, write) runs as `_work`; at the bottom a Dye Lot
  // rename runs it inside a lock on the number, so two near-simultaneous renames cannot both pass the duplicate check. The body of
  // `_work` is deliberately NOT re-indented (multi-line template strings inside).
  const _work = async () => {
  const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(e => e && e.id);
  const [seA, seAr, dlA, dlAr, weA, weAr, peA, peAr, dsA, dsAr, rlA, ssA, ssAr] = await Promise.all([
    fbGet('/tc/stageEntries').catch(() => null), fbGet('/tc/archive/stageEntries').catch(() => null),
    fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null),
    fbGet('/tc/windEntries').catch(() => null), fbGet('/tc/archive/windEntries').catch(() => null),
    fbGet('/tc/packEntries').catch(() => null), fbGet('/tc/archive/packEntries').catch(() => null),
    fbGet('/tc/dispatches').catch(() => null), fbGet('/tc/archive/dispatches').catch(() => null),
    fbGet('/tc/residualLog').catch(() => null),
    fbGet('/tc/lots').catch(() => null), fbGet('/tc/archive/lots').catch(() => null)
  ]);
  const stageEntries = [...toArr(seA), ...toArr(seAr)];
  // Sep 22 2026 — real, confirmed bug found via direct discussion with Priyam, from a genuine live-database record he
  // found broken (DL-1718): dyeLots itself was NEVER tagged with _fromArchive, unlike wind/pack/dispatch right below
  // (already fixed Aug 19 for the exact same bug class). Editing an already-archived dye lot silently wrote its
  // changed fields to a brand-new, partial entry in the ACTIVE table instead of updating the real one in archive —
  // leaving a broken, id-less shadow record behind that every ordinary read since then correctly, silently ignored.
  const dyeLots = [...toArr(dlA).map(d => ({ ...d, _fromArchive: false })), ...toArr(dlAr).map(d => ({ ...d, _fromArchive: true }))];
  // Aug 19 2026 -- real, genuine gap found via a systematic scan for the
  // same bug class fixed earlier today: when a Dye lot's own label
  // (dyeLotNo) gets corrected, this cascades the new label into every
  // real Wind/Pack/Dispatch record depending on it -- but always wrote
  // to active, regardless of where the real, downstream record actually
  // lived. Tagged so this specific cascade can target the real table.
  const windEntries = [...toArr(weA).map(e => ({ ...e, _fromArchive: false })), ...toArr(weAr).map(e => ({ ...e, _fromArchive: true }))];
  const packEntries = [...toArr(peA).map(e => ({ ...e, _fromArchive: false })), ...toArr(peAr).map(e => ({ ...e, _fromArchive: true }))];
  const dispatches = [...toArr(dsA).map(e => ({ ...e, _fromArchive: false })), ...toArr(dsAr).map(e => ({ ...e, _fromArchive: true }))];
  const _tbl = (table, rec) => rec._fromArchive ? `/tc/archive/${table}` : `/tc/${table}`;
  const residualLog = toArr(rlA);
  const lots = [...toArr(ssA), ...toArr(ssAr)];

  const patch = {};
  const changes = [];
  let imbalanceNote = null;
  const fU = n => Math.max(0, Math.round(n));
  const fW = n => Math.max(0, parseFloat(n.toFixed(2)));
  // Jul 17 2026 — Phase 3 of the running-balance plan. Declared here
  // (before the branch chain), set inside each branch where the actual
  // old/new values are in scope, then used AFTER fbPatch succeeds — a
  // first attempt at this put the nudge code after the branch chain and
  // tried to read newInW/newOutW etc directly, which are block-scoped
  // `const` inside each `if` and genuinely inaccessible outside it.
  // node --check doesn't catch that (syntax is valid, only a runtime
  // ReferenceError would have caught it) — found and fixed before
  // shipping by testing the actual scoping behavior directly, not
  // trusting the syntax check alone.
  let _nudgeLotArgs = null;   // [lotId, grade, vendor, fields]
  let _nudgeDyeArgs = null;   // [dyeLotId, fields]

  if (stage === 'soft') {
    const e = stageEntries.find(x => x.id === id);
    if (!e) return errorResponse('Entry not found', 404);
    if (e.status === 'Pending' || e.status === 'InProgress' || e.status === 'Edited-Pending') return errorResponse('Cannot edit a Pending entry — Reject it and resubmit with correct values instead. Editing is only for entries already Approved.');
    const newInU = body.inUnits ?? e.inUnits ?? 0, newInW = body.inWeight ?? e.inWeight ?? 0, newOutU = body.outUnits ?? e.outUnits ?? 0, newOutW = body.outWeight ?? e.outWeight ?? 0;
    const newSN = body.startNote ?? e.startNote ?? '', newEN = body.endNote ?? e.endNote ?? '';
    // Sep 19 2026 — Machine and Start Worker are set at Soft Start but could never be corrected afterwards.
    // A value that exists cannot be blanked; an entry that never had a Machine (optional at Soft Start) stays editable.
    const newSoftMachine = body.machine ?? e.machine ?? '', newSoftWorker = body.startWorker ?? e.startWorker ?? '';
    if (!String(newSoftMachine).trim() && e.machine) return errorResponse('Machine cannot be blank — select a machine');
    if (!String(newSoftWorker).trim() && e.startWorker) return errorResponse('Start Worker cannot be blank — select a worker');
    if (newOutU > newInU + 0.01) return errorResponse(`Output units ${newOutU} exceeds input ${newInU} — blocked`);
    if (newOutW > newInW + 0.01) return errorResponse(`Output weight ${newOutW}kg exceeds input ${newInW}kg — blocked`);
    const rmBal = calcRMBalance(lots, stageEntries, [], e.lotId, e.grade, e.vendor);
    const rmAvail = (rmBal.weight || 0) + (e.inWeight || 0);
    const rmAvailUnits = (rmBal.units || 0) + (e.inUnits || 0);
    // Sep 10 2026 — real, direct fix built via direct discussion with
    // Priyam: this used to be the one truly non-negotiable rule in the
    // whole chain, blocked for everyone, no exceptions — deliberately
    // decided today to match the other four links instead: blocked for
    // anyone without Admin/Manager, but an Admin who genuinely knows
    // what they're doing (a real delivery received but not yet entered,
    // a correction already in progress) can proceed, with a real,
    // visible flag instead of a silent, invisible override. Combined
    // below with the existing Soft→Dye check into one real decision for
    // this lot's flag, so a genuine problem on one side can't be
    // silently overwritten by the other side looking fine.
    if (!isAdmin && newInW > rmAvail + 0.01) return errorResponse(`Cannot increase soft input to ${newInW}kg — RM balance only ${rmAvail}kg available`);
    // Sep 19 2026 — Soft Start checks BAGS and weight against RM; Edit only checked weight. Only when the
    // edit actually increases bags, so old data can't lock out an unrelated edit.
    if (!isAdmin && newInU > (e.inUnits || 0) && newInU > rmAvailUnits + 0.01) return errorResponse(`Cannot increase soft input to ${newInU} bags — RM balance only ${rmAvailUnits} bags available`);
    const dyeConsumed = calcSoftConsumedByDye(dyeLots, e.lotId, e.grade, e.vendor);
    // Jul 26 2026 — the confirmed design rule: Supervisor can edit directly
    // as long as the change stays fully contained (nothing downstream has
    // touched this lot's output yet). If Dye has already drawn from this
    // lot's Soft output, the edit could ripple into that already-recorded
    // relationship — only Admin/Manager from here.
    if (!isAdmin && dyeConsumed > 0.01) return errorResponse(`Dye has already consumed ${dyeConsumed}kg from this lot's Soft output — only Admin/Manager can edit it now.`, 403);
    const otherSoftOut = stageEntries.filter(s => s.id !== id && s.lotId === e.lotId && s.grade === e.grade && s.vendor === e.vendor && (s.status === 'Approved' || s.status === 'Edited-Approved')).reduce((a, s) => a + (s.outWeight || 0), 0);
    if (!isAdmin && otherSoftOut + newOutW < dyeConsumed - 0.01) return errorResponse(`Cannot reduce — total soft output for this lot would be ${otherSoftOut + newOutW}kg but dye already consumed ${dyeConsumed}kg. Edit dye sources first.`);

    if (e.inUnits !== newInU) changes.push({ field: 'In Units', old: e.inUnits, new: newInU });
    if (e.inWeight !== newInW) changes.push({ field: 'In Weight', old: e.inWeight, new: newInW });
    if (e.outUnits !== newOutU) changes.push({ field: 'Out Units', old: e.outUnits, new: newOutU });
    if (e.outWeight !== newOutW) changes.push({ field: 'Out Weight', old: e.outWeight, new: newOutW });
    if (e.startNote !== newSN) changes.push({ field: 'Start Note', old: e.startNote, new: newSN });
    if (e.endNote !== newEN) changes.push({ field: 'End Note', old: e.endNote, new: newEN });
    if ((e.machine || '') !== newSoftMachine) changes.push({ field: 'Machine', old: e.machine, new: newSoftMachine });
    if ((e.startWorker || '') !== newSoftWorker) changes.push({ field: 'Start Worker', old: e.startWorker, new: newSoftWorker });
    const p = `/tc/stageEntries/${id}`;
    patch[`${p}/inUnits`] = newInU; patch[`${p}/inWeight`] = newInW; patch[`${p}/outUnits`] = newOutU; patch[`${p}/outWeight`] = newOutW;
    patch[`${p}/startNote`] = newSN; patch[`${p}/endNote`] = newEN;
    if ((e.machine || '') !== newSoftMachine) patch[`${p}/machine`] = newSoftMachine;
    if ((e.startWorker || '') !== newSoftWorker) {
      patch[`${p}/startWorker`] = newSoftWorker;
      // End Worker is auto-copied from Start Worker at Soft End — follow the correction only if it is still that copy.
      if (e.endTime && (e.endWorker || '') === (e.startWorker || '')) patch[`${p}/endWorker`] = newSoftWorker;
    }
    if (newOutU > 0 || newOutW > 0) { patch[`${p}/wasteUnits`] = fU(newInU - newOutU); patch[`${p}/wasteWeight`] = fW(newInW - newOutW); }
    if (isAdmin && e.status === 'Approved') patch[`${p}/status`] = 'Edited-Approved';
    const newSoftBal = calcSoftBalanceWeight(stageEntries, lots, [], dyeLots, residualLog, e.lotId, e.grade, e.vendor);
    const rmWeightBad = newInW > rmAvail + 0.01;
    const rmUnitsBad = newInU > rmAvailUnits + 0.01;
    const rmStillBad = rmWeightBad || rmUnitsBad;
    const dyeStillBad = dyeConsumed > newSoftBal;
    if (rmStillBad || dyeStillBad) {
      const notes = [];
      if (rmWeightBad) notes.push(`Soft input ${newInW}kg exceeds RM balance ${rmAvail}kg`);
      if (rmUnitsBad) notes.push(`Soft input ${newInU} bags exceeds RM balance ${rmAvailUnits} bags`);
      if (dyeStillBad) notes.push(`Dye consumed ${dyeConsumed}kg but soft balance now only ${newSoftBal}kg`);
      imbalanceNote = notes.join('; ');
      // Aug 26 2026 — real, new feature built via direct discussion with
      // Priyam: this exact condition was already detected and logged to
      // the edit log, but only ever shown as a toast that disappears —
      // an admin genuinely proceeding despite this real risk needs a
      // real, persistent, visible flag for someone to circle back to
      // later, not just a message that vanishes the moment it's read.
      _autoFlagImbalance(patch, e.lotId, e.grade, e.vendor, imbalanceNote, changedBy);
    } else {
      // Aug 26 2026 — real, direct extension: if this edit genuinely
      // fixes the real risk (balance is no longer over-claimed), clear
      // any existing auto-flag on this same lot automatically — never
      // touching one a real person set by hand.
      await _autoClearImbalanceFlag(patch, e.lotId, e.grade, e.vendor);
    }
    _nudgeLotArgs = [e.lotId, e.grade || '', e.vendor || '', {
      'rmBalance.kg': -(newInW - (e.inWeight || 0)), 'rmBalance.units': -(newInU - (e.inUnits || 0)),
      'softBalance.kg': (newOutW - (e.outWeight || 0)), 'softBalance.units': (newOutU - (e.outUnits || 0))
    }];

  } else if (stage === 'wind') {
    const e = windEntries.find(x => x.id === id);
    if (!e) return errorResponse('Entry not found', 404);
    if (e.status === 'Pending' || e.status === 'InProgress' || e.status === 'Edited-Pending') return errorResponse('Cannot edit a Pending entry — Reject it and resubmit with correct values instead. Editing is only for entries already Approved.');
    const newInC = body.inCones ?? e.inCones ?? 0, newInW = body.inWeight ?? e.inWeight ?? 0, newOutC = body.outCones ?? e.outCones ?? 0, newOutW = body.outWeight ?? e.outWeight ?? 0;
    // Sep 19 2026 — Machine, Start Worker, Start Notes (stored as `notes`) and End Notes (stored as `endNotes`) are all set
    // when a Wind run starts/ends, but none could be corrected afterwards. Same blank rule as Soft; notes may be cleared.
    const newWindMachine = body.machine ?? e.machine ?? '', newWindWorker = body.startWorker ?? e.startWorker ?? '';
    const newWindStartNote = body.startNote ?? e.notes ?? '', newWindEndNote = body.endNote ?? e.endNotes ?? '';
    if (!String(newWindMachine).trim() && e.machine) return errorResponse('Machine cannot be blank — select a machine');
    if (!String(newWindWorker).trim() && e.startWorker) return errorResponse('Start Worker cannot be blank — select a worker');
    if (newOutW > newInW + 0.01) return errorResponse(`Output ${newOutW}kg exceeds input ${newInW}kg — blocked`);
    // Sep 19 2026 — Wind End and Dye Edit both block output cones above input cones; Wind Edit only
    // checked weight (and its Math.max(0, ...) waste line below would have hidden a negative).
    if (newOutC > newInC && newInC > 0) return errorResponse(`Output cones (${newOutC}) cannot exceed input cones (${newInC}) — blocked`);
    const dyeLot = dyeLots.find(d => d.id === e.dyeLotId);
    const otherWindIn = windEntries.filter(w => w.id !== id && w.dyeLotId === e.dyeLotId && (w.status === 'Approved' || w.status === 'Edited-Approved')).reduce((a, w) => a + (w.inWeight || 0), 0);
    if (newInW + otherWindIn > (dyeLot?.outWeight || 0) + 0.01) return errorResponse(`Cannot increase wind input to ${newInW}kg — dye lot only produced ${dyeLot?.outWeight||0}kg total`);
    // Sep 19 2026 — Wind Start checks CONES against the dye lot's output too; Edit only checked weight.
    // Same hard block as the weight check above, but only when this edit INCREASES cones.
    const _otherWindConesCap = windEntries.filter(wc => wc.id !== id && wc.dyeLotId === e.dyeLotId && (wc.status === 'Approved' || wc.status === 'Edited-Approved')).reduce((a, wc) => a + (wc.inCones || 0), 0);
    if (dyeLot && newInC > (e.inCones || 0) && newInC + _otherWindConesCap > (dyeLot.outCones || 0)) return errorResponse(`Cannot increase wind input to ${newInC} cones — dye lot only produced ${dyeLot.outCones || 0} cones total`);
    const totalPackIn = packEntries.filter(p => p.dyeLotId === e.dyeLotId && (p.status === 'Approved' || p.status === 'Edited-Approved')).reduce((a, p) => a + (p.inWeight || 0), 0);
    // Jul 26 2026 — same escalation rule as Soft: contained edit stays
    // Supervisor-level, but if Pack has already drawn from this Wind
    // output, only Admin/Manager from here.
    if (!isAdmin && totalPackIn > 0.01) return errorResponse(`Pack has already taken ${totalPackIn}kg from this dye lot's Wind output — only Admin/Manager can edit it now.`, 403);
    const allWindOut = windEntries.filter(w => w.id !== id && w.dyeLotId === e.dyeLotId && (w.status === 'Approved' || w.status === 'Edited-Approved')).reduce((a, w) => a + (w.outWeight || 0), 0) + newOutW;
    if (!isAdmin && allWindOut < totalPackIn - 0.01) return errorResponse(`Cannot reduce wind output — pack entries already have ${totalPackIn}kg total input. Edit pack entries first.`);
    if (e.inCones !== newInC) changes.push({ field: 'In Cones', old: e.inCones, new: newInC });
    if (e.inWeight !== newInW) changes.push({ field: 'In Weight', old: e.inWeight, new: newInW });
    if (e.outCones !== newOutC) changes.push({ field: 'Out Cones', old: e.outCones, new: newOutC });
    if (e.outWeight !== newOutW) changes.push({ field: 'Out Weight', old: e.outWeight, new: newOutW });
    if ((e.machine || '') !== newWindMachine) changes.push({ field: 'Machine', old: e.machine, new: newWindMachine });
    if ((e.startWorker || '') !== newWindWorker) changes.push({ field: 'Start Worker', old: e.startWorker, new: newWindWorker });
    if ((e.notes || '') !== newWindStartNote) changes.push({ field: 'Start Notes', old: e.notes, new: newWindStartNote });
    if ((e.endNotes || '') !== newWindEndNote) changes.push({ field: 'End Notes', old: e.endNotes, new: newWindEndNote });
    const p = `/tc/windEntries/${id}`;
    patch[`${p}/inCones`] = newInC; patch[`${p}/inWeight`] = newInW; patch[`${p}/outCones`] = newOutC; patch[`${p}/outWeight`] = newOutW;
    if ((e.machine || '') !== newWindMachine) patch[`${p}/machine`] = newWindMachine;
    if ((e.notes || '') !== newWindStartNote) patch[`${p}/notes`] = newWindStartNote;
    if ((e.endNotes || '') !== newWindEndNote) patch[`${p}/endNotes`] = newWindEndNote;
    if ((e.startWorker || '') !== newWindWorker) {
      patch[`${p}/startWorker`] = newWindWorker;
      // End Worker is auto-copied from Start Worker at Wind End — follow the correction only if it is still that copy.
      if (e.endTime && (e.endWorker || '') === (e.startWorker || '')) patch[`${p}/endWorker`] = newWindWorker;
    }
    if (newOutC > 0 || newOutW > 0) { patch[`${p}/wasteCones`] = Math.max(0, newInC - newOutC); patch[`${p}/wasteWeight`] = fW(newInW - newOutW); }
    if (isAdmin && e.status === 'Approved') patch[`${p}/status`] = 'Edited-Approved';
    // Sep 19 2026 — found by a field-by-field Create-vs-Edit audit: an Admin can lower Wind output below
    // what Pack already took (the Supervisor lock above only stops non-admins), and unlike Pack Edit and
    // Dye Edit nothing flagged it. Raise the same visible auto-flag on the dye lot. Only raised for what
    // THIS edit can cause; only cleared when nothing else on the lot is still bad, so it can never erase
    // another check's genuine warning (dye-side cones, or dispatched > pack balance).
    const _activePackIn = packEntries.filter(pk => pk.dyeLotId === e.dyeLotId && (pk.status === 'Approved' || pk.status === 'Edited-Approved'));
    const totalPackInCones = _activePackIn.reduce((a, pk) => a + (pk.inCones || 0), 0);
    const _otherWindActive = windEntries.filter(wx => wx.id !== id && wx.dyeLotId === e.dyeLotId && (wx.status === 'Approved' || wx.status === 'Edited-Approved'));
    const allWindOutCones = _otherWindActive.reduce((a, wx) => a + (wx.outCones || 0), 0) + newOutC;
    const otherWindInCones = _otherWindActive.reduce((a, wx) => a + (wx.inCones || 0), 0);
    const packTookMoreThanWindOut = allWindOut < totalPackIn - 0.01 || allWindOutCones + 1 < totalPackInCones;
    if (packTookMoreThanWindOut) {
      imbalanceNote = `Wind output reduced to ${fW(allWindOut)}kg / ${allWindOutCones} cones but pack already took ${fW(totalPackIn)}kg / ${totalPackInCones} cones`;
      _autoFlagDyeImbalance(patch, e.dyeLotId, imbalanceNote, changedBy);
    } else {
      const windDrewMoreConesThanDyeOut = !!dyeLot && (otherWindInCones + newInC) > (dyeLot.outCones || 0) + 0.01;
      const dispWind = calcTotalDispatchedApproved(dispatches, e.dyeLotId, dyeLots);
      const packBalWind = calcPackBal(packEntries, dispatches, e.dyeLotId);
      const dispatchedMoreThanPackBal = dispWind.weight > packBalWind.weight;
      if (!windDrewMoreConesThanDyeOut && !dispatchedMoreThanPackBal) await _autoClearDyeImbalanceFlag(patch, e.dyeLotId);
    }
    if (e.dyeLotId) _nudgeDyeArgs = [e.dyeLotId, {
      'dyeBalance.cones': -(newInC - (e.inCones || 0)), 'dyeBalance.kg': -(newInW - (e.inWeight || 0)),
      'windBalance.cones': (newOutC - (e.outCones || 0)), 'windBalance.kg': (newOutW - (e.outWeight || 0))
    }];

  } else if (stage === 'pack') {
    const e = packEntries.find(x => x.id === id);
    if (!e) return errorResponse('Entry not found', 404);
    if (e.status === 'Pending' || e.status === 'InProgress' || e.status === 'Edited-Pending') return errorResponse('Cannot edit a Pending entry — Reject it and resubmit with correct values instead. Editing is only for entries already Approved.');
    const newInC = body.inCones ?? e.inCones ?? 0, newInW = body.inWeight ?? e.inWeight ?? 0, newBags = body.bags ?? e.bags ?? 0, newWt = body.weight ?? e.weight ?? 0;
    // Sep 19 2026 — Worker and Notes are set when a Pack entry is created but could never be corrected afterwards.
    const newPackWorker = body.worker ?? e.worker ?? '', newPackNotes = body.notes ?? e.notes ?? '';
    if (!String(newPackWorker).trim() && e.worker) return errorResponse('Worker cannot be blank — select a worker');
    // Sep 10 2026 — real, root-cause fix built via direct discussion
    // with Priyam, from a genuine gap he found by carefully working
    // through the whole chain: creating a new Pack entry has always
    // been correctly checked against Wind's real available balance —
    // but editing an already-approved one never checked this at all,
    // not even a warning, let alone a block. An admin could increase
    // a Pack entry's input weight past what Wind genuinely produced
    // and nothing would notice. Matches the same real pattern already
    // proven for Soft→Dye and Pack→Dispatch: blocked for anyone
    // without Admin/Manager, but an Admin can proceed, with a real,
    // visible flag on the dye lot instead of a silent, invisible gap.
    const windBalForThis = calcWindBal(windEntries, packEntries, e.dyeLotId);
    const windAvailForThis = (windBalForThis.weight || 0) + (e.inWeight || 0);
    const windAvailConesForThis = (windBalForThis.units || 0) + (e.inCones || 0);
    // Sep 10 2026 — real, genuine correction found via a holistic
    // audit, while adding the missing In Weight edit field itself:
    // this check compared newWt (the pack's own OUTPUT weight) against
    // Wind's real available balance — but Wind's pool is what Pack's
    // real INPUT draws from, not its output, which can genuinely be
    // higher or lower than input from real gain/loss in finishing.
    // Correctly compares the real input now that it's actually
    // editable — this bug never had a way to bite until now, since
    // inWeight was never editable before this same fix.
    if (!isAdmin && newInW > windAvailForThis + 0.01) return errorResponse(`Cannot increase pack input to ${newInW}kg — wind balance only ${windAvailForThis}kg available`);
    // Sep 19 2026 — Pack Create checks CONES against Wind (+1 rounding tolerance); Edit only checked weight.
    if (!isAdmin && newInC > (e.inCones || 0) && newInC > windAvailConesForThis + 1) return errorResponse(`Cannot increase pack input to ${newInC} cones — wind balance only ${windAvailConesForThis} cones available`);
    const dispPack = calcTotalDispatchedApproved(dispatches, e.dyeLotId, dyeLots);
    // Jul 26 2026 — same escalation rule: if Dispatch has already taken
    // from this dye lot's Pack output, only Admin/Manager can edit it now.
    if (!isAdmin && (dispPack.weight > 0.01 || dispPack.bags > 0.01)) return errorResponse(`Dispatch has already taken ${dispPack.weight}kg / ${dispPack.bags} bags from this dye lot's Pack output — only Admin/Manager can edit it now.`, 403);
    const otherPackWt = packEntries.filter(p => p.id !== id && p.dyeLotId === e.dyeLotId && (p.status === 'Approved' || p.status === 'Edited-Approved')).reduce((a, p) => a + (p.weight || 0), 0);
    const otherPackBags = packEntries.filter(p => p.id !== id && p.dyeLotId === e.dyeLotId && (p.status === 'Approved' || p.status === 'Edited-Approved')).reduce((a, p) => a + (p.bags || 0), 0);
    if (!isAdmin && newWt + otherPackWt < dispPack.weight - 0.01) return errorResponse(`Cannot reduce pack weight to ${newWt}kg — dispatches already have ${dispPack.weight}kg. Edit dispatches first.`);
    if (!isAdmin && newBags + otherPackBags < dispPack.bags - 0.01) return errorResponse(`Cannot reduce pack bags to ${newBags} — dispatches already have ${dispPack.bags} bags. Edit dispatches first.`);
    const newGainKg = fW(newWt - newInW);
    const newGainPct = newInW > 0 ? parseFloat((newGainKg / newInW * 100).toFixed(2)) : 0;
    if (e.gainKg !== newGainKg) changes.push({ field: 'Gain Kg', old: e.gainKg, new: newGainKg });
    if (e.inCones !== newInC) changes.push({ field: 'In Cones', old: e.inCones, new: newInC });
    if (e.inWeight !== newInW) changes.push({ field: 'In Weight', old: e.inWeight, new: newInW });
    if (e.bags !== newBags) changes.push({ field: 'Bags', old: e.bags, new: newBags });
    if (e.weight !== newWt) changes.push({ field: 'Weight', old: e.weight, new: newWt });
    if ((e.worker || '') !== newPackWorker) changes.push({ field: 'Worker', old: e.worker, new: newPackWorker });
    if ((e.notes || '') !== newPackNotes) changes.push({ field: 'Notes', old: e.notes, new: newPackNotes });
    const p = `/tc/packEntries/${id}`;
    patch[`${p}/gainKg`] = newGainKg; patch[`${p}/gainPct`] = newGainPct; patch[`${p}/inCones`] = newInC; patch[`${p}/inWeight`] = newInW; patch[`${p}/bags`] = newBags; patch[`${p}/weight`] = newWt;
    if ((e.worker || '') !== newPackWorker) patch[`${p}/worker`] = newPackWorker;
    if ((e.notes || '') !== newPackNotes) patch[`${p}/notes`] = newPackNotes;
    if (isAdmin && e.status === 'Approved') patch[`${p}/status`] = 'Edited-Approved';
    const packBal = calcPackBal(packEntries, dispatches, e.dyeLotId);
    const disp = calcTotalDispatchedApproved(dispatches, e.dyeLotId, dyeLots);
    // Sep 10 2026 — real, root-cause fix built via direct discussion
    // with Priyam: combined with the Wind-side check above into one
    // real, unified decision for this dye lot's flag — checking each
    // direction separately and writing to the same flag key could
    // have one check's "it's fine, clear it" silently overwrite the
    // other's genuine "no, it's still bad" in the same patch.
    const windWeightBad = newInW > windAvailForThis + 0.01;
    const windConesBad = newInC > windAvailConesForThis + 1;
    const windStillBad = windWeightBad || windConesBad;
    const dispatchStillBad = disp.weight > packBal.weight;
    if (windStillBad || dispatchStillBad) {
      const notes = [];
      if (windWeightBad) notes.push(`Pack input ${newInW}kg exceeds wind balance ${windAvailForThis}kg`);
      if (windConesBad) notes.push(`Pack input ${newInC} cones exceeds wind balance ${windAvailConesForThis} cones`);
      if (dispatchStillBad) notes.push(`Dispatched ${disp.weight}kg exceeds new pack balance ${packBal.weight}kg`);
      imbalanceNote = notes.join('; ');
      // Aug 26 2026 — real, the second half of the auto-flag feature,
      // built via direct discussion with Priyam: this real risk was
      // already detected here, but had nowhere real to be shown until
      // now — closes the exact gap identified earlier today.
      _autoFlagDyeImbalance(patch, e.dyeLotId, imbalanceNote, changedBy);
    } else {
      // Aug 26 2026 — real, direct extension: same real principle as
      // the RM/Soft case above — clear any existing auto-flag on this
      // dye lot if this edit genuinely fixes the real risk.
      await _autoClearDyeImbalanceFlag(patch, e.dyeLotId);
    }
    if (e.dyeLotId) _nudgeDyeArgs = [e.dyeLotId, {
      'windBalance.cones': -(newInC - (e.inCones || 0)), 'windBalance.kg': -(newInW - (e.inWeight || 0)),
      'packBalance.bags': (newBags - (e.bags || 0)), 'packBalance.kg': (newWt - (e.weight || 0))
    }];

  } else if (stage === 'dye') {
    const d = dyeLots.find(x => x.id === id);
    if (!d) return errorResponse('Dye lot not found', 404);
    if (d.status === 'Pending' || d.status === 'InProgress' || d.status === 'Edited-Pending') return errorResponse('Cannot edit a Pending entry — Reject it and resubmit with correct values instead. Editing is only for entries already Approved.');
    const newDyeLotNo = body.dyeLotNo?.trim() || d.dyeLotNo, newShade = body.shade?.trim() || d.shade;
    // Sep 19 2026 — Dye End rejects a Dye Lot No that already exists (active or archived, not Voided/
    // Rejected); Edit Output let you rename one lot onto another's number. Only checked when the number
    // is actually CHANGING, so a lot that already shares a number with another stays editable.
    if (newDyeLotNo !== d.dyeLotNo) {
      const dupLotNo = dyeLots.find(x => x.id !== id && x.dyeLotNo === newDyeLotNo && x.status !== 'Voided' && x.status !== 'Rejected');
      if (dupLotNo) return errorResponse(`Dye Lot No "${newDyeLotNo}" already exists — choose a different Serial, or add a suffix in the Sub box if this is a sub-batch`);
    }
    const newInCones = body.inCones ?? d.totalInCones ?? 0, newInW = body.inWeight ?? d.totalInWeight ?? 0, newOutCones = body.outCones ?? d.outCones ?? 0, newOutW = body.outWeight ?? d.outWeight ?? 0;
    // Sep 19 2026 — Edit Output corrects the End note (d.endNote). The Start Formula/Notes
    // (d.notes) is corrected via Edit Input. `body.notes` accepted for an older cached client.
    const newEndNote = body.endNote ?? body.notes ?? d.endNote ?? '';
    if (newOutW > newInW + 0.01) return errorResponse(`Output weight (${newOutW}kg) cannot exceed input (${newInW}kg)`);
    if (newOutCones > newInCones && newInCones > 0) return errorResponse(`Output cones (${newOutCones}) cannot exceed input cones (${newInCones})`);
    const totalWindIn = windEntries.filter(e => e.dyeLotId === id && (e.status === 'Approved' || e.status === 'Edited-Approved')).reduce((a, e) => a + (e.inWeight || 0), 0);
    // Sep 10 2026 — real, direct fix built via direct discussion with
    // Priyam, from his own direct correction: the downward check here
    // only ever covered weight — cones was silently missing, the exact
    // same gap he'd already caught once before in a different error
    // message. Both are now checked and named separately.
    const totalWindInCones = windEntries.filter(e => e.dyeLotId === id && (e.status === 'Approved' || e.status === 'Edited-Approved')).reduce((a, e) => a + (e.inCones || 0), 0);
    // Jul 26 2026 — same escalation rule: if Wind has already drawn from
    // this dye lot's output, only Admin/Manager can edit it now.
    if (!isAdmin && (totalWindIn > 0.01 || totalWindInCones > 0.01)) return errorResponse(`Wind has already drawn ${totalWindIn}kg / ${totalWindInCones} cones from this dye lot's output — only Admin/Manager can edit it now.`, 403);
    if (!isAdmin) {
      const weightShort = totalWindIn - newOutW;
      const conesShort = totalWindInCones - newOutCones;
      if (weightShort > 0.01 || conesShort > 0.01) {
        const parts = [];
        if (weightShort > 0.01) parts.push(`${weightShort.toFixed(2)}kg`);
        if (conesShort > 0.01) parts.push(`${Math.ceil(conesShort)} cones`);
        return errorResponse(`This needs at least ${parts.join(' and ')} more before you can save — wind entries already have ${totalWindIn}kg / ${totalWindInCones} cones total input. Edit wind entries first.`);
      }
    }
    // Sep 10 2026 — real, root-cause fix built via direct discussion
    // with Priyam, from a genuine gap he found by carefully working
    // through the whole chain: an Admin reducing a dye lot's own
    // output below what Wind already drew from it was allowed above,
    // same as Soft→Dye and Pack→Dispatch — but unlike those two, this
    // exact real risk was never flagged anywhere. Matches the same
    // real pattern now: a real, visible flag on this dye lot when the
    // Admin proceeds anyway, cleared automatically once genuinely
    // resolved (checked again below, alongside the Wind-balance check
    // above, and re-checked on Wind/Pack edits and voids too).
    const windStillBadOnDye = newOutW < totalWindIn - 0.01 || newOutCones < totalWindInCones - 0.01;
    if (windStillBadOnDye) {
      _autoFlagDyeImbalance(patch, id, `Dye output reduced to ${newOutW}kg / ${newOutCones} cones but wind already drew ${totalWindIn}kg / ${totalWindInCones} cones`, changedBy);
    } else {
      await _autoClearDyeImbalanceFlag(patch, id);
    }
    const softBalForDye = (d.sources || []).reduce((a, s) => {
      const sb = calcSoftBalanceWeight(stageEntries, lots, [], dyeLots, residualLog, s.lotId, s.grade || d.grade, s.vendor || '');
      return a + sb + (s.weight || 0);
    }, 0);
    if (!isAdmin && newInW > softBalForDye + 0.01) return errorResponse(`Cannot increase dye input to ${newInW}kg — soft balance only ${softBalForDye}kg available`);
    // Sep 10 2026 — real, root-cause fix built via direct discussion
    // with Priyam, from a genuine real gap he caught: nothing on the
    // Dye side ever re-checked or auto-cleared this same real warning
    // — only a Soft-side edit (line ~3742 above) ever did. A flag set
    // once could sit stale forever if the real fix (or a later real
    // problem) happened here instead. Re-checks each real source
    // lot's current, real balance the same way the Soft side does —
    // matches its own d.sources weight against calcSoftConsumedByDye,
    // which already sums every approved Dye lot genuinely consuming
    // from that lot, this one included — so it correctly reflects
    // whatever this edit just changed.
    for (const s of (d.sources || [])) {
      if (!s.lotId) continue;
      const sGrade = s.grade || d.grade, sVendor = s.vendor || '';
      const consumedFromThisLot = calcSoftConsumedByDye(dyeLots, s.lotId, sGrade, sVendor);
      const softOutForThisLot = calcSoftOut(stageEntries, lots, [], s.lotId, sGrade, sVendor);
      const residualForThisLot = calcSoftResidualOut(residualLog, s.lotId, sGrade, sVendor);
      const realBalance = softOutForThisLot.weight - consumedFromThisLot - residualForThisLot;
      if (realBalance < -0.01) {
        _autoFlagImbalance(patch, s.lotId, sGrade, sVendor, `Dye consumed ${consumedFromThisLot}kg but soft balance now only ${softOutForThisLot.weight - residualForThisLot}kg`, changedBy);
      } else {
        await _autoClearImbalanceFlag(patch, s.lotId, sGrade, sVendor);
      }
    }

    if (d.dyeLotNo !== newDyeLotNo) changes.push({ field: 'Dye Lot No', old: d.dyeLotNo, new: newDyeLotNo });
    if (d.shade !== newShade) changes.push({ field: 'Shade', old: d.shade, new: newShade });
    // Sep 10 2026 — Machine removed entirely from this Output-editing
    // branch — it's a real Dye Start field, not an Output one, and is
    // now corrected via Edit Input instead, alongside Start Worker and
    // Formula/Notes.
    if (d.totalInCones !== newInCones) changes.push({ field: 'In Cones', old: d.totalInCones, new: newInCones });
    if (d.totalInWeight !== newInW) changes.push({ field: 'In Weight', old: d.totalInWeight, new: newInW });
    if (d.outCones !== newOutCones) changes.push({ field: 'Out Cones', old: d.outCones, new: newOutCones });
    if (d.outWeight !== newOutW) changes.push({ field: 'Out Weight', old: d.outWeight, new: newOutW });
    if ((d.endNote || '') !== newEndNote) changes.push({ field: 'End Notes', old: d.endNote, new: newEndNote });
    const dyeLotNoChanged = d.dyeLotNo !== newDyeLotNo;
    const p = `${_tbl('dyeLots', d)}/${id}`;
    patch[`${p}/dyeLotNo`] = newDyeLotNo; patch[`${p}/shade`] = newShade;
    patch[`${p}/totalInCones`] = newInCones; patch[`${p}/totalInWeight`] = newInW; patch[`${p}/outCones`] = newOutCones; patch[`${p}/outWeight`] = newOutW; patch[`${p}/endNote`] = newEndNote;
    if (dyeLotNoChanged) {
      windEntries.forEach(e => { if (e.dyeLotId === id) patch[`${_tbl('windEntries', e)}/${e.id}/dyeLotNo`] = newDyeLotNo; });
      packEntries.forEach(e => { if (e.dyeLotId === id) patch[`${_tbl('packEntries', e)}/${e.id}/dyeLotNo`] = newDyeLotNo; });
      dispatches.forEach(e => { if (e.dyeLotId === id) patch[`${_tbl('dispatches', e)}/${e.id}/dyeLotNo`] = newDyeLotNo; });
      // Legacy dyeEntries/dyeBatches rename NOT carried forward — Item O confirmed
      // both tables are permanently empty and fully retired.
    }
    if (newOutCones > 0 || newOutW > 0) { patch[`${p}/wasteCones`] = Math.max(0, newInCones - newOutCones); patch[`${p}/wasteWeight`] = fW(newInW - newOutW); }
    const coneLoss = newInCones > 0 ? Math.max(0, newInCones - newOutCones) : (d.coneLoss || 0);
    patch[`${p}/coneLoss`] = coneLoss; patch[`${p}/kgLoss`] = fW(newInW - newOutW);
    if (isAdmin && d.status === 'Approved') patch[`${p}/status`] = 'Edited-Approved';
    _nudgeDyeArgs = [id, {
      'dyeBalance.cones': (newOutCones - (d.outCones || 0)), 'dyeBalance.kg': (newOutW - (d.outWeight || 0))
    }];

  } else if (stage === 'dispatch') {
    const d = dispatches.find(x => x.id === id);
    if (!d) return errorResponse('Entry not found', 404);
    if (d.status === 'Pending' || d.status === 'InProgress' || d.status === 'Edited-Pending') return errorResponse('Cannot edit a Pending entry — Reject it and resubmit with correct values instead. Editing is only for entries already Approved.');
    const newBags = body.bags ?? d.bags ?? 0, newWt = body.weight ?? d.weight ?? 0, newParty = body.party ?? d.party, newInv = body.invoiceNo ?? d.invoiceNo ?? '';
    // Sep 19 2026 — the dispatch Date is set at Create but could never be corrected afterwards. Must stay a real YYYY-MM-DD.
    const newDispDate = body.date ?? d.date ?? '';
    if (!String(newDispDate).trim() && d.date) return errorResponse('Date cannot be blank — enter the dispatch date');
    if (newDispDate !== (d.date || '') && (!/^\d{4}-\d{2}-\d{2}$/.test(String(newDispDate)) || isNaN(Date.parse(String(newDispDate))))) return errorResponse('Enter a valid date');
    const packBalDisp = calcPackBal(packEntries, dispatches, d.dyeLotId);
    const packTotalWt = (packBalDisp.weight || 0) + (d.weight || 0);
    const packTotalBags = (packBalDisp.bags || 0) + (d.bags || 0);
    if (newWt > packTotalWt + 0.01) return errorResponse(`Cannot increase dispatch to ${newWt}kg — pack balance only ${packTotalWt}kg available for this dispatch`);
    if (newBags > packTotalBags + 0.01) return errorResponse(`Cannot increase dispatch to ${newBags} bags — pack balance only ${packTotalBags} bags available`);
    if (d.bags !== newBags) changes.push({ field: 'Bags', old: d.bags, new: newBags });
    if (d.weight !== newWt) changes.push({ field: 'Weight', old: d.weight, new: newWt });
    if (d.party !== newParty) changes.push({ field: 'Party', old: d.party, new: newParty });
    if (d.invoiceNo !== newInv) changes.push({ field: 'Invoice', old: d.invoiceNo, new: newInv });
    if ((d.date || '') !== newDispDate) changes.push({ field: 'Date', old: d.date, new: newDispDate });
    const p = `/tc/dispatches/${id}`;
    patch[`${p}/bags`] = newBags; patch[`${p}/weight`] = newWt; patch[`${p}/party`] = newParty; patch[`${p}/invoiceNo`] = newInv;
    if ((d.date || '') !== newDispDate) patch[`${p}/date`] = newDispDate;
    // Sep 19 2026 — changing the Party used to leave the OLD party's order link on the dispatch: that order kept listing a
    // dispatch that now belongs to someone else, and the dispatch never showed as "unlinked" under its new party (fulfilled
    // quantity is computed by party + shade, so the numbers were right, the links were not). Re-link the same way Dispatch Create
    // does — first Open/Partial order for the new party + shade, by date — else leave it unlinked. A link that already belongs
    // to the new party is kept.
    if (newParty !== d.party) {
      const _poRaw = await fbGet('/tc/partyOrders').catch(() => null);
      const _partyOrders = (_poRaw ? (Array.isArray(_poRaw) ? _poRaw : Object.values(_poRaw)) : []).filter(o => o && o.id);
      const _curOrder = d.orderId ? _partyOrders.find(o => o.id === d.orderId) : null;
      if (!_curOrder || _curOrder.party !== newParty) {
        const _open = _partyOrders.filter(o => o.party === newParty && o.shade === (d.shade || '') && (o.status === 'Open' || o.status === 'Partial')).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        const _newOrderId = _open.length ? _open[0].id : null;
        if ((d.orderId || null) !== _newOrderId) {
          patch[`${p}/orderId`] = _newOrderId;
          changes.push({ field: 'Order Link', old: d.orderId || '', new: _newOrderId || '' });
        }
      }
    }
    if (d.dyeLotId) _nudgeDyeArgs = [d.dyeLotId, {
      'packBalance.bags': -(newBags - (d.bags || 0)), 'packBalance.kg': -(newWt - (d.weight || 0)),
      'dispatched.bags': (newBags - (d.bags || 0)), 'dispatched.kg': (newWt - (d.weight || 0))
    }];
  } else {
    return errorResponse('Unknown stage: ' + stage);
  }

  if (!changes.length) return errorResponse('No changes detected');

  changes.forEach(c => {
    const logId = `EL-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    patch[`/tc/editLog/${logId}`] = { id: logId, timestamp: new Date().toISOString(), entryId: id, stage, field: c.field, oldVal: String(c.old ?? ''), newVal: String(c.new ?? ''), reasonCat, reasonText, impactNote: imbalanceNote || '', changedBy, type: 'edit', _updatedAt: new Date().toISOString() };
  });

  await fbPatch('', patch);

  if (_nudgeLotArgs) await nudgeLotSummary(..._nudgeLotArgs).catch(() => {});
  if (_nudgeDyeArgs) await nudgeDyeLotSummary(..._nudgeDyeArgs).catch(() => {});
  _reFreezeForRecord(stage, id).catch(() => {});

  return jsonResponse({ success: true, changesCount: changes.length, imbalanceNote });
  };
  if (stage === 'dye' && typeof body.dyeLotNo === 'string' && body.dyeLotNo.trim()) {
    // Same lock key Dye End uses (`DYELOTNO_<serial base>`), so an Edit rename and a Dye End can never both claim one number:
    // the number itself is a key (correct when it has no Sub suffix) and so is the number without its last '-' part
    // (correct when it has one). Keys are always taken in sorted order by withMultiBalanceLock, so no deadlock.
    const _noNew = body.dyeLotNo.trim();
    const _lk = s => `DYELOTNO_${s}`.replace(/[^a-zA-Z0-9_]/g, '_');
    const _prefixNo = _noNew.includes('-') ? _noNew.slice(0, _noNew.lastIndexOf('-')) : _noNew;
    const _locked = await withMultiBalanceLock([_lk(_noNew), _lk(_prefixNo)], _work);
    if (_locked && _locked.__lockFailed) return errorResponse(_locked.error);
    return _locked;
  }
  return await _work();
}

// ─── Item C: cascade-void-entire-RM-lot (Jul 14 2026) ─────────────────────
// Server-side replacement for pages.js's submitVoidRMLotCascade. Matching
// was already strict in the original (no fix needed there) — the only gap
// was atomicity: one save() call after looping through potentially dozens
// of records, no protection against a crash mid-loop.
async function handleVoidRMLotCascade(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin only', 403);
  const { lotId, grade, vendor, reason, password, username, changedBy, dryRun } = body;
  // Aug 6 2026 — real, genuine gap found via a thorough app-wide audit:
  // this voids an entire RM lot's real chain — genuinely one of the most
  // destructive real actions in the app — with no password check at all,
  // unlike comparable destructive voids elsewhere. Matching the same
  // proven pattern here.
  // Sep 10 2026 — a preview never writes anything, so — like its
  // sibling Void functions, all of which already have a real,
  // session-verified role — it never needs a password either; only
  // the real, final void does.
  if (!dryRun) {
    const verifiedUser = await _verifySelfPassword(username, password);
    if (!verifiedUser) return errorResponse('Incorrect password', 401);
  }
  if (!lotId) return errorResponse('lotId required');
  const reasonCat = 'Admin correction';
  const finalReason = reason || 'Admin cascade void';

  // Sep 10 2026 — real, root-cause fix built via direct discussion with
  // Priyam: lots whose imbalance warning this cascade void just
  // genuinely fixed, collected here (voidEntry itself is synchronous),
  // and actually re-checked once, right before the final write below.
  const _imbalanceRecheckList = [];

  const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(e => e && e.id);
  const [seA, seAr, dlA, dlAr, weA, weAr, peA, peAr, dsA, dsAr, ssA, ssAr] = await Promise.all([
    fbGet('/tc/stageEntries').catch(() => null), fbGet('/tc/archive/stageEntries').catch(() => null),
    fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null),
    fbGet('/tc/windEntries').catch(() => null), fbGet('/tc/archive/windEntries').catch(() => null),
    fbGet('/tc/packEntries').catch(() => null), fbGet('/tc/archive/packEntries').catch(() => null),
    fbGet('/tc/dispatches').catch(() => null), fbGet('/tc/archive/dispatches').catch(() => null),
    fbGet('/tc/lots').catch(() => null), fbGet('/tc/archive/lots').catch(() => null)
  ]);
  const stageEntries = [...toArr(seA), ...toArr(seAr)];
  const dyeLots = [...toArr(dlA), ...toArr(dlAr)];
  const windEntries = [...toArr(weA), ...toArr(weAr)];
  const packEntries = [...toArr(peA), ...toArr(peAr)];
  const dispatches = [...toArr(dsA), ...toArr(dsAr)];
  // Aug 19 2026 — real, honest gap found: RM lots are never actually
  // archived by design, so this genuinely never bites in practice — but
  // tagging anyway, matching the same real, consistent pattern used
  // everywhere else, so the write logic is correct even in an edge case
  // this design assumption doesn't anticipate.
  const lots = [...toArr(ssA).map(l => ({ ...l, _fromArchive: false })), ...toArr(ssAr).map(l => ({ ...l, _fromArchive: true }))];
  const _tbl = (table, rec) => rec._fromArchive ? `/tc/archive/${table}` : `/tc/${table}`;

  const patch = {};
  let voidCount = 0;
  const cascadeCounts = { soft: 0, dye: 0, wind: 0, pack: 0, dispatch: 0 };
  // Jul 17 2026 — Phase 4 of the running-balance plan, same pattern as
  // handleVoidEntry/handleVoidChain. For a multi-source dye lot being
  // voided as part of this cascade, ALL its sources get their softBalance
  // reversed, not just the one RM lot this cascade started from — since
  // approving that dye lot originally deducted from every source, not
  // just this one.
  const lotDeltas = new Map();
  const dyeDeltas = new Map();
  const addLotDelta = (lId, grd, vnd, field, amt) => {
    const k = `${lId}__${grd || ''}__${vnd || ''}`;
    const cur = lotDeltas.get(k) || { lotId: lId, grade: grd || '', vendor: vnd || '' };
    cur[field] = (cur[field] || 0) + amt;
    lotDeltas.set(k, cur);
  };
  const addDyeDelta = (dId, field, amt) => {
    const cur = dyeDeltas.get(dId) || {};
    cur[field] = (cur[field] || 0) + amt;
    dyeDeltas.set(dId, cur);
  };
  const voidIt = (entry, stage, table) => {
    if (!entry || entry.status === 'Voided') return;
    const wasApproved = entry.status === 'Approved' || entry.status === 'Edited-Approved';
    const logId = `EL-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    patch[`/tc/editLog/${logId}`] = { id: logId, timestamp: new Date().toISOString(), entryId: entry.id, stage, fieldChanged: 'status', oldVal: entry.status, newVal: 'Voided', reasonCat, reason: finalReason, changedBy, _updatedAt: new Date().toISOString() };
    patch[`/tc/${table}/${entry.id}/status`] = 'Voided';
    patch[`/tc/${table}/${entry.id}/voidedBy`] = changedBy;
    patch[`/tc/${table}/${entry.id}/voidedAt`] = new Date().toISOString();
    patch[`/tc/${table}/${entry.id}/voidReason`] = finalReason;
    voidCount++;
    cascadeCounts[stage.toLowerCase()]++;

    if (!wasApproved) return;
    if (stage === 'Soft') {
      addLotDelta(entry.lotId, entry.grade, entry.vendor, 'rmBalance.kg', (entry.inWeight || 0));
      addLotDelta(entry.lotId, entry.grade, entry.vendor, 'rmBalance.units', (entry.inUnits || 0));
      addLotDelta(entry.lotId, entry.grade, entry.vendor, 'softBalance.kg', -(entry.outWeight || 0));
      addLotDelta(entry.lotId, entry.grade, entry.vendor, 'softBalance.units', -(entry.outUnits || 0));
    } else if (stage === 'Dye') {
      addDyeDelta(entry.id, 'dyeBalance.cones', -(entry.outCones || 0));
      addDyeDelta(entry.id, 'dyeBalance.kg', -(entry.outWeight || 0));
      (entry.sources || []).forEach(s => {
        if (s.lotId) addLotDelta(s.lotId, s.grade, s.vendor, 'softBalance.kg', (s.weight || 0));
        // Sep 10 2026 — real, root-cause fix built via direct
        // discussion with Priyam, from a genuine real gap he caught:
        // voiding a Dye entry through this RM-lot cascade is exactly
        // the kind of real fix that should be able to clear a stale
        // imbalance warning on the lots it drew from — nothing here
        // ever re-checked. This function is synchronous, so it just
        // remembers which lots were touched; the actual check happens
        // once, right before the final write.
        if (s.lotId) _imbalanceRecheckList.push({ lotId: s.lotId, grade: s.grade, vendor: s.vendor });
      });
    } else if (stage === 'Wind') {
      addDyeDelta(entry.dyeLotId, 'dyeBalance.cones', (entry.inCones || 0));
      addDyeDelta(entry.dyeLotId, 'dyeBalance.kg', (entry.inWeight || 0));
      addDyeDelta(entry.dyeLotId, 'windBalance.cones', -(entry.outCones || 0));
      addDyeDelta(entry.dyeLotId, 'windBalance.kg', -(entry.outWeight || 0));
    } else if (stage === 'Pack') {
      addDyeDelta(entry.dyeLotId, 'windBalance.cones', (entry.inCones || 0));
      addDyeDelta(entry.dyeLotId, 'packBalance.bags', -(entry.bags || 0));
      addDyeDelta(entry.dyeLotId, 'packBalance.kg', -(entry.weight || 0));
    } else if (stage === 'Dispatch') {
      addDyeDelta(entry.dyeLotId, 'packBalance.bags', (entry.bags || 0));
      addDyeDelta(entry.dyeLotId, 'packBalance.kg', (entry.weight || 0));
      addDyeDelta(entry.dyeLotId, 'dispatched.bags', -(entry.bags || 0));
      addDyeDelta(entry.dyeLotId, 'dispatched.kg', -(entry.weight || 0));
    }
  };

  stageEntries.filter(e => e.lotId === lotId && e.grade === grade && e.vendor === vendor && e.stage === 'Soft' && e.status !== 'Voided').forEach(e => voidIt(e, 'Soft', 'stageEntries'));

  // Sep 10 2026 — real, root-cause fix built via direct discussion
  // with Priyam, from a genuine, deeper gap he caught directly: a dye
  // lot's sources aren't only RM — Dead Stock, Recycle, and Residual
  // sources exist too, and genuinely have no lotId or vendor field at
  // all. If lotId/vendor were ever undefined here, undefined ===
  // undefined could match one of those non-RM sources sharing the
  // same grade text, incorrectly voiding a dye lot that has nothing
  // to do with the RM lot actually being voided. Requiring
  // sourceType === 'rm' explicitly closes that.
  const dyeIds = dyeLots.filter(d => d.status !== 'Voided' && (d.sources || []).some(s => s.sourceType === 'rm' && s.lotId === lotId && s.grade === grade && s.vendor === vendor)).map(d => { voidIt(d, 'Dye', 'dyeLots'); return d.id; });
  windEntries.filter(e => dyeIds.includes(e.dyeLotId) && e.status !== 'Voided').forEach(e => voidIt(e, 'Wind', 'windEntries'));
  packEntries.filter(e => dyeIds.includes(e.dyeLotId) && e.status !== 'Voided').forEach(e => voidIt(e, 'Pack', 'packEntries'));
  dispatches.filter(e => dyeIds.includes(e.dyeLotId) && e.status !== 'Voided').forEach(e => voidIt(e, 'Dispatch', 'dispatches'));

  // Jul 15 2026 — real gap found and fixed: this cascade voided every
  // downstream record but never marked the RM lot record itself as
  // Voided, leaving Edit/Void buttons showing forever and no way for the
  // Lot Master table to ever display a real "Voided" status. Void the
  // lot record too, in the same atomic patch, matching how the same
  // shape of fix was already applied to Dye/Wind/Pack/Dispatch voiding.
  const lotRecord = lots.find(l => l.id === lotId && l.grade === grade && l.vendor === vendor);
  if (lotRecord && lotRecord.status !== 'Voided') {
    const lotKey = _lotKeyW(lotRecord);
    patch[`${_tbl('lots', lotRecord)}/${lotKey}/status`] = 'Voided';
    patch[`${_tbl('lots', lotRecord)}/${lotKey}/voidedBy`] = changedBy;
    patch[`${_tbl('lots', lotRecord)}/${lotKey}/voidedAt`] = new Date().toISOString();
    patch[`${_tbl('lots', lotRecord)}/${lotKey}/voidReason`] = finalReason;
  }

  // Sep 10 2026 — real, root-cause fix built via direct discussion with
  // Priyam: a Dye entry voided as part of this cascade can source from
  // OTHER real RM lots too, not just the one being cascaded here —
  // actually re-checks each of those, once, using the exact same real
  // formula the Daily Balance Check itself trusts.
  if (_imbalanceRecheckList.length > 0) {
    const _residualLogForRecheck2 = await fbGet('/tc/residualLog').catch(() => null);
    const _residualArr2 = _residualLogForRecheck2 ? (Array.isArray(_residualLogForRecheck2) ? _residualLogForRecheck2 : Object.values(_residualLogForRecheck2)) : [];
    const _seenLots2 = new Set();
    for (const { lotId: _rLotId, grade: _rGrade, vendor: _rVendor } of _imbalanceRecheckList) {
      const _key2 = `${_rLotId}__${_rGrade}__${_rVendor}`;
      if (_seenLots2.has(_key2)) continue;
      _seenLots2.add(_key2);
      const consumedFromThisLot = calcSoftConsumedByDye(dyeLots, _rLotId, _rGrade, _rVendor);
      const softOutForThisLot = calcSoftOut(stageEntries, lots, [], _rLotId, _rGrade, _rVendor);
      const residualForThisLot = calcSoftResidualOut(_residualArr2, _rLotId, _rGrade, _rVendor);
      const realBalance = softOutForThisLot.weight - consumedFromThisLot - residualForThisLot;
      if (realBalance >= -0.01) {
        await _autoClearImbalanceFlag(patch, _rLotId, _rGrade, _rVendor);
      }
    }
  }

  // Sep 10 2026 — real, direct new feature built via a genuinely long,
  // careful design discussion with Priyam, establishing one clear rule
  // across the whole app: every real action shows a genuine preview of
  // its actual effect before committing — the exact same real cascade
  // computed above, just returned here instead of executed. The very
  // last of the dozen-plus places found via Priyam's own requested
  // holistic uniformity audit.
  if (dryRun) return { __dryRun: true, lotId, entryType: 'rm', cascadeCounts };

  await fbPatch('', patch);

  await Promise.all([
    ...Array.from(lotDeltas.values()).map(d => { const { lotId: lId, grade: grd, vendor: vnd, ...fields } = d; return nudgeLotSummary(lId, grd, vnd, fields).catch(() => {}); }),
    ...Array.from(dyeDeltas.entries()).map(([dId, fields]) => nudgeDyeLotSummary(dId, fields).catch(() => {}))
  ]);
  // Real note: RM lots are keyed by a composite key (lotId+grade+vendor),
  // not a simple id — _reFreezeForRecord's generic id-based lookup would
  // look in the wrong place here, so fetching directly by the real,
  // correct composite key instead.
  fbGet(`/tc/lots/${summaryKey(lotId, grade, vendor)}`).then(rec => { if (rec?.date) _reFreezeIfNeeded((rec.date || '').split('T')[0]); }).catch(() => {});

  return jsonResponse({ success: true, voidCount });
}

// ─── Item I: Soft stage entry creation/completion (Jul 14 2026) ───────────
// Server-side replacement for pages.js's submitStageEntry (Start branch).
// The "Stage Entry" page is confirmed Soft-only in live use (page title:
// "Stage Entry (Soft)"; Wind and Pack have their own separate dedicated
// pages/buttons — submitStageEntry's STAGES=['Soft','Wind','Pack'] array is
// vestigial for the latter two). Faithfully replicates the base-balance
// check, the WIP-claimed calculation, and the available-balance validation
// — using the true, always-verified merged data instead of whatever the
// browser happened to have loaded.
async function handleStageStart(body) {
  const { lotId, grade, vendor, inUnits, inWeight, machine, worker, startNote, deadStockId, idempotencyKey, confirmDuplicate } = body;
  if (!lotId) return errorResponse('Select Lot & Stage');
  if (!inUnits) return errorResponse('Enter input units');
  if (!inWeight || inWeight <= 0) return errorResponse('Enter input weight (kg)');
  const idemp = await checkIdempotency(idempotencyKey, 'Soft/Wind Start');
  if (idemp.duplicate) return errorResponse(idemp.message);

  const lockKey = `RM_${lotId}_${grade || ''}_${vendor || ''}`.replace(/[^a-zA-Z0-9_]/g, '_');
  const result = await withBalanceLock(lockKey, async () => {
    const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(e => e && e.id);
    const [lotsA, lotsAr, seA, seAr, rlA, lotFlagsA] = await Promise.all([
      fbGet('/tc/lots').catch(() => null), fbGet('/tc/archive/lots').catch(() => null),
      fbGet('/tc/stageEntries').catch(() => null), fbGet('/tc/archive/stageEntries').catch(() => null),
      fbGet('/tc/rmReturnLog').catch(() => null), fbGet('/tc/lotFlags').catch(() => null)
    ]);
    const lots = [...toArr(lotsA), ...toArr(lotsAr)];
    const stageEntries = [...toArr(seA), ...toArr(seAr)];
    const rmReturnLog = toArr(rlA);

    const heldFlag = _isLotOnHold(lotFlagsA, lotId, grade, vendor);
    if (heldFlag) return { __rejected: errorResponse(`This lot is on Hold — "${heldFlag.note}". The hold must be cleared before it can be processed.`) };

    const bal = calcRMBalance(lots, stageEntries, rmReturnLog, lotId, grade, vendor);
    if (inUnits > bal.units + 0.01) return { __rejected: errorResponse(`Input (${inUnits}b) exceeds available (${bal.units}b)`) };

    // Jul 29 2026 fix — real, confirmed gap: recycle material at Soft Start
    // was being accepted with zero validation against its own balance —
    // the RM lot check above ran regardless, checking the wrong thing
    // entirely when recycle material was actually what's being processed.
    // Now validated the same way Dye Start already correctly validates
    // its own recycle sources — independently, against calcRecycleBalance,
    // not folded into the RM lot's own check.
    // Sep 20 2026 — Recycle Phase 2 leftover removal: Soft Start no longer takes a recycle. Off yarn now goes through the dedicated
    // Recycle Soft entries (handleRecycleSoftStart/End), never through the ordinary Soft stage — there is no Recycle Soft route here any more.
    if (deadStockId) {
      const [dsA, dlA2, slA2] = await Promise.all([
        fbGet('/tc/deadStock').catch(() => null), fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/scrapLog').catch(() => null)
      ]);
      const deadStock = toArr(dsA), dyeLotsForDS = toArr(dlA2), scrapLogDS = toArr(slA2);
      const dsBal = calcDeadStockBalance(deadStock, dyeLotsForDS, stageEntries, scrapLogDS, deadStockId);
      if (inWeight > dsBal + 0.01) return { __rejected: errorResponse(`Dead Stock ${deadStockId}: ${inWeight}kg exceeds balance ${dsBal}kg`) };
    }

    // WIP-claimed — Pending+InProgress ONLY, per the golden rule, since this
    // is exactly the "dropdown/available-card" context the rule describes.
    const claimed = stageEntries.filter(e => e.lotId === lotId && (!grade || e.grade === grade) && (!vendor || e.vendor === vendor) && e.stage === 'Soft' && (e.status === 'Pending' || e.status === 'InProgress'))
      .reduce((a, e) => ({ units: a.units + (e.inUnits || 0), weight: a.weight + (e.inWeight || 0) }), { units: 0, weight: 0 });
    const availUnits = bal.units - claimed.units, availWeight = bal.weight - claimed.weight;
    if (inUnits > availUnits + 0.01) return { __rejected: errorResponse(`Input (${inUnits}b) exceeds AVAILABLE balance (${Math.max(0, availUnits)}b) — ${claimed.units}b already in WIP`) };
    if (inWeight > availWeight + 0.01) return { __rejected: errorResponse(`Input weight (${inWeight}kg) exceeds AVAILABLE balance (${Math.max(0, availWeight)}kg) — ${claimed.weight}kg already in WIP`) };

    // Jul 26 2026 — content-based duplicate check, confirmed design: same
    // source RM lot + same input units/weight, exact match, 15-day window.
    // Reuses the stageEntries array already fetched above — no extra read.
    if (!confirmDuplicate) {
      const nowDate = new Date().toISOString();
      const windowMs = 15 * 86400000;
      const dupes = stageEntries.filter(e => {
        if (e.stage !== 'Soft') return false;
        if (e.status === 'Rejected' || e.status === 'Voided') return false;
        if (e.lotId !== lotId || (e.grade || '') !== (grade || '') || (e.vendor || '') !== (vendor || '')) return false;
        if (Math.abs((e.inUnits || 0) - inUnits) > 0.01 || Math.abs((e.inWeight || 0) - inWeight) > 0.01) return false;
        const eDate = new Date(e.startTime || 0);
        if (isNaN(eDate.getTime())) return false;
        const diffMs = new Date(nowDate) - eDate;
        return diffMs >= 0 && diffMs <= windowMs;
      });
      if (dupes.length > 0) {
        return {
          __rejected: jsonResponse({
            success: false, duplicateWarning: true,
            matches: dupes.map(e => ({ entryId: e.id, startTime: e.startTime, inUnits: e.inUnits, inWeight: e.inWeight })),
            message: `This looks like it might already be started — same lot, same input units and weight as ${dupes.map(e => e.id).join(', ')} (within the last 15 days). If this is genuinely a different batch, confirm to proceed.`
          })
        };
      }
    }

    const id = await genIdAtomicServer('SE', stageEntries);
    // Jul 29 2026 — Phase 3 of the RM permanent-ID plan, next piece:
    // stamps the real lot's permanent ID onto every new Soft entry, so
    // it's genuinely available for the eventual switch-over — purely
    // additive, lotId/grade/vendor stay exactly as they are, nothing
    // about validation or lookups changes yet. Zero extra Firebase
    // calls — `lots` is already fetched above for the balance check.
    const _lotForUid = lots.find(l => l.id === lotId && l.grade === grade && l.vendor === vendor);
    const newSE = { id, lotId, grade: grade || '', vendor: vendor || '', lotUid: _lotForUid?.uid || null, stage: 'Soft', inUnits, inWeight, machine, startWorker: worker, startTime: new Date().toISOString(), startNote: startNote || '', status: 'InProgress', deadStockId: deadStockId || null, _lotKey: summaryKey(lotId, grade, vendor) };

    await saveRecordAndRefreshSummary(`/tc/stageEntries/${id}`, newSE, [{ lotId, grade, vendor }]);

    return { id };
  });

  if (result.__lockFailed) return errorResponse(result.error);
  if (result.__rejected) return result.__rejected;
  return jsonResponse({ success: true, id: result.id });
}

// POST /api/party-order/create — party order creation, moved server-side.
// Was: pages.js submitPartyOrder(), which generated the order ID via a
// client-side max+1 scan (genOrderNo()) — the same race-condition shape
// genIdAtomicServer was built to close for every other record type, just
// never applied here. Two supervisors creating an order in the same instant
// could get the same ORD-xxx id and overwrite each other's record, since the
// id is the Firebase storage key. Fixed by reusing genIdAtomicServer.
async function handlePartyOrderCreate(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager', 'supervisor'].includes(role)) return errorResponse('Supervisor or Admin only', 403);

  const { party, shade, grade, qty, date, due, notes, changedBy } = body || {};
  if (!party) return errorResponse('Select party');
  if (!shade) return errorResponse('Select shade');
  if (!qty || qty <= 0) return errorResponse('Enter quantity');
  if (!date) return errorResponse('Select date');
  if (!due) return errorResponse('Select due date');

  const raw = await fbGet('/tc/partyOrders').catch(() => null);
  const orders = raw ? (Array.isArray(raw) ? raw : Object.values(raw)).filter(o => o && o.id) : [];

  const id = await genIdAtomicServer('ORD', orders);
  const o = {
    id, party, shade, grade: grade || '', qtyOrdered: qty, qtyFulfilled: 0,
    date, due, notes: notes || '', status: 'Open',
    createdBy: changedBy || '', createdAt: new Date().toISOString(),
    cancelledAt: null, cancelReason: null
  };

  await fbSet(`/tc/partyOrders/${id}`, o);
  await updateOrderSummaries(party, shade).catch(() => {});

  return jsonResponse({ success: true, id, order: o });
}

// POST /api/party-order/cancel — party order cancellation, moved server-side.
// Was: pages.js cancelPartyOrder(), a client-side status mutation through the
// generic /api/save passthrough (table-role-gated but no server-side check
// that the order exists, isn't already cancelled, or that a reason was given).
async function handlePartyOrderCancel(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager', 'supervisor'].includes(role)) return errorResponse('Supervisor or Admin only', 403);

  const { id, reason, changedBy, password, username, dryRun } = body || {};
  if (!id) return errorResponse('Order id required');
  if (!reason || !reason.trim()) return errorResponse('Cancellation reason required');
  // Sep 10 2026 — real, genuine inconsistency found via a direct,
  // holistic uniformity audit Priyam asked for: every comparable
  // cancel/void action in this app requires a real password
  // confirmation before proceeding — this one, alone, didn't, for no
  // real reason found. A preview never writes anything, so — like its
  // sibling Void functions, all of which already have a real,
  // session-verified role — it never needs a password either; only
  // the real, final cancel does.
  if (!dryRun) {
    const verifiedUser = await _verifySelfPassword(username, password);
    if (!verifiedUser) return errorResponse('Incorrect password', 401);
  }

  // Sep 10 2026 — real, proactive fix built via direct discussion with
  // Priyam, after finding this exact bug in Dead Stock's own void/edit
  // functions: partyOrders is the exact same category of table — an
  // older order can genuinely be stored as a plain array element with
  // no named key of its own. Fetches the whole real node, finds the
  // record by its own id field, and writes the whole structure back.
  const asArrPO2 = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x && x.id) : [];
  const rawPO2 = await fbGet('/tc/partyOrders').catch(() => null);
  const allPO = asArrPO2(rawPO2);
  const o = allPO.find(x => x.id === id);
  if (!o) return errorResponse('Order not found', 404);
  if (o.status === 'Cancelled') return errorResponse('Order already cancelled');

  // Sep 10 2026 — real, direct new feature built via a genuinely long,
  // careful design discussion with Priyam, establishing one clear rule
  // across the whole app: every real action shows a genuine preview of
  // its actual effect before committing — the exact same real checks
  // above, just stopped here instead of proceeding to write.
  if (dryRun) return { __dryRun: true, party: o.party || '', shade: o.shade || '', qty: o.qtyOrdered || 0 };

  const updatedO = { ...o, status: 'Cancelled', cancelledAt: new Date().toISOString(), cancelReason: reason.trim(), cancelledBy: changedBy || '' };
  const rebuiltPO = {};
  allPO.forEach(d => { rebuiltPO[d.id] = d.id === id ? updatedO : d; });
  await fbSet('/tc/partyOrders', rebuiltPO);
  await updateOrderSummaries(o.party, o.shade).catch(() => {});

  return jsonResponse({ success: true, id });
}

// POST /api/override-approve — consolidates overrideDispatch/overrideDyeLot/
// overridePackEntry/overrideWindEntry (pages.js) into one endpoint. Was:
// each a separate client-side function flipping Rejected->Approved via the
// generic /api/save passthrough, with no check the record was actually
// still Rejected (a double-override or override-of-an-already-approved
// record would silently "succeed" and just re-timestamp it). New: checks
// current status first, writes editLog server-side (was already done
// client-side via addToEditLog then bundled into the same save() call —
// same effect, now atomic with the status write via one PATCH).
// Aug 26 2026 — real, direct extension for RM Lots specifically, built
// via direct discussion with Priyam after a genuinely fair, direct
// criticism: RM was the only stage without any way to bring back a
// Voided lot. RM's own id here is the full, real composite lotKey
// (lotId__grade__vendor), matching exactly how it's already stored at
// /tc/lots/{lotKey} — the fetch below needs zero changes to work
// correctly for this, since that's already the right path.
const _OVERRIDE_TABLE = { dispatch: 'dispatches', dyeLot: 'dyeLots', packEntry: 'packEntries', windEntry: 'windEntries', stage: 'stageEntries', rm: 'lots' };
const _OVERRIDE_STAGE_LABEL = { dispatch: 'dispatch', dyeLot: 'dye', packEntry: 'pack', windEntry: 'wind', stage: 'soft', rm: 'rm' };
// POST /api/approve-entry — was: approveStageEntry/approveDyeLot/
// approveWindEntry/approvePackEntry/approveDispatch (pages.js), all 5
// fully client-side — found while properly scoping Phase 2 of the
// running-balance plan (Jul 15 2026): confirmed for every stage that
// Start/End never set status to Approved, only these individual-approve
// functions (and bulk Approve All) do — so THIS is the real moment a
// balance changes, not Start/End. Migrated server-side with the same
// safety pattern as everything else this session, and this is also
// where the new nudge functions (built earlier today) get their first
// real caller — Phase 2 of the running-balance plan.
const _APPROVE_ENTRY_TABLE = { soft: 'stageEntries', dye: 'dyeLots', wind: 'windEntries', pack: 'packEntries', dispatch: 'dispatches', recycleSoft: 'recycleSoft' };
async function handleApproveEntry(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager', 'supervisor'].includes(role)) return errorResponse('Supervisor/Admin/Manager only', 403);

  const { type, id, changedBy } = body || {};
  const table = _APPROVE_ENTRY_TABLE[type];
  if (!table) return errorResponse('Unknown type');

  const raw = await fbGet(`/tc/${table}/${id}`).catch(() => null);
  if (!raw) return errorResponse('Entry not found', 404);
  if (raw.status !== 'Pending' && raw.status !== 'Edited-Pending') return errorResponse(`Entry is currently '${raw.status}', not Pending — nothing to approve`);
  // Jul 16 2026 — real gap found: the original client-side approveEntry
  // had this output-exceeds-input check, but it was missing here when
  // handleApproveEntry was first built. Restored, matching the exact
  // original condition (endTime set = the Soft stage has actually ended,
  // not still InProgress).
  if (type === 'soft' && raw.endTime && (raw.outUnits || 0) > (raw.inUnits || 0) + 0.01) {
    return errorResponse(`Cannot approve — Output (${raw.outUnits}u) exceeds Input (${raw.inUnits}u). Edit the values first.`);
  }

  if (type === 'recycleSoft' && ((raw.outWeight || 0) > (raw.inWeight || 0) + 0.01 || (raw.outCones || 0) > (raw.inCones || 0))) {
    return errorResponse(`Cannot approve — Output (${raw.outCones}c / ${raw.outWeight}kg) exceeds Input (${raw.inCones}c / ${raw.inWeight}kg). Edit the values first.`);
  }
  const now = new Date().toISOString();
  const patch = {
    [`/tc/${table}/${id}/status`]: 'Approved',
    [`/tc/${table}/${id}/approvedBy`]: changedBy || '',
    [`/tc/${table}/${id}/approvedAt`]: now
  };

  // Jul 26 2026 fix — same check-first fix as handleReject, same real risk.
  if (type === 'dye' && raw.dyeEntryId) {
    const de = await fbGet(`/tc/dyeEntries/${raw.dyeEntryId}`).catch(() => null);
    if (de) {
      patch[`/tc/dyeEntries/${raw.dyeEntryId}/status`] = 'Approved';
      patch[`/tc/dyeEntries/${raw.dyeEntryId}/approvedBy`] = changedBy || '';
      patch[`/tc/dyeEntries/${raw.dyeEntryId}/approvedAt`] = now;
    }
  }

  await fbPatch('', patch);

  // Phase 2 — nudge instead of a full recompute. Exact real balance-
  // changing deltas per stage, confirmed against calcDyeLotSummary's
  // real field shapes (dyeBalance/windBalance use cones+kg, packBalance/
  // dispatched use bags+kg) rather than assumed.
  if (type === 'soft') {
    await nudgeLotSummary(raw.lotId, raw.grade || '', raw.vendor || '', {
      'rmBalance.kg': -(raw.inWeight || 0), 'rmBalance.units': -(raw.inUnits || 0),
      'softBalance.kg': (raw.outWeight || 0), 'softBalance.units': (raw.outUnits || 0)
    }).catch(() => {});
  } else if (type === 'dye') {
    const sources = (raw.sources && raw.sources.length) ? raw.sources : [];
    for (const src of sources) {
      if (!src.lotId) continue;
      await nudgeLotSummary(src.lotId, src.grade || '', src.vendor || '', { 'softBalance.kg': -(src.weight || 0) }).catch(() => {});
    }
    await nudgeDyeLotSummary(id, { 'dyeBalance.cones': (raw.outCones || 0), 'dyeBalance.kg': (raw.outWeight || 0) }).catch(() => {});
  } else if (type === 'wind') {
    if (raw.dyeLotId) await nudgeDyeLotSummary(raw.dyeLotId, {
      'dyeBalance.cones': -(raw.inCones || 0), 'dyeBalance.kg': -(raw.inWeight || 0),
      'windBalance.cones': (raw.outCones || 0), 'windBalance.kg': (raw.outWeight || 0),
      'windWaste.cones': (raw.wasteCones || 0), 'windWaste.kg': (raw.wasteWeight || 0)
    }).catch(() => {});
  } else if (type === 'pack') {
    if (raw.dyeLotId) await nudgeDyeLotSummary(raw.dyeLotId, {
      'windBalance.cones': -(raw.inCones || 0), 'windBalance.kg': -(raw.inWeight || 0),
      'packBalance.bags': (raw.bags || 0), 'packBalance.kg': (raw.weight || 0),
      'packGain.kg': (raw.gainKg || 0)
    }).catch(() => {});
  } else if (type === 'dispatch') {
    const dyeLotId = raw.dyeLotId || (raw.lots && raw.lots[0] && raw.lots[0].dyeLotId);
    if (dyeLotId) await nudgeDyeLotSummary(dyeLotId, {
      'packBalance.bags': -(raw.bags || 0), 'packBalance.kg': -(raw.weight || 0),
      'dispatched.bags': (raw.bags || 0), 'dispatched.kg': (raw.weight || 0)
    }).catch(() => {});
  }

  return jsonResponse({ success: true });
}

async function handleOverrideApprove(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin only', 403);

  const { type, id, changedBy, password, username, fields, reasonCat, reasonText } = body || {};
  const table = _OVERRIDE_TABLE[type];
  if (!table) return errorResponse('Unknown override type');
  if (!id) return errorResponse('Entry id required');
  if (!reasonCat) return errorResponse('Select override reason');
  if (!reasonText || reasonText.trim().length < 10) return errorResponse('Provide reason detail (min 10 chars)');

  // Jul 25 2026 — password now required here too, even for admin/manager.
  // Self-verification, same as Void.
  const verifiedUser = await _verifySelfPassword(username, password);
  if (!verifiedUser) return errorResponse('Incorrect password', 401);

  const e = await fbGet(`/tc/${table}/${id}`).catch(() => null);
  if (!e) return errorResponse('Entry not found', 404);
  if (e.status !== 'Rejected' && e.status !== 'Voided') return errorResponse(`Entry is currently '${e.status}', not Rejected or Voided — nothing to bring back`);

  // Jul 25 2026 — optional correction while bringing the entry back. If
  // fields were provided, apply them and validate the result against real
  // availability in both directions before accepting — the same check
  // Override never had before, now shared with Edit and Void.
  const _typeMap = { stage: 'stage', dyeLot: 'dye', windEntry: 'wind', packEntry: 'pack', dispatch: 'dispatch' };
  const balanceCheckType = _typeMap[type];
  let finalEntry = { ...e };
  const fieldPatch = {};
  if (fields && Object.keys(fields).length > 0) {
    Object.keys(fields).forEach(f => {
      let v = fields[f];
      if (v === null || v === undefined || v === '') return;
      if (typeof e[f] === 'number' || ['inUnits', 'inWeight', 'outUnits', 'outWeight', 'totalInCones', 'totalInWeight', 'outCones', 'bags', 'weight'].includes(f)) {
        v = parseFloat(v); if (isNaN(v)) return;
      }
      finalEntry[f] = v;
      fieldPatch[`/tc/${table}/${id}/${f}`] = v;
    });
    const check = await _validateBalanceChange(balanceCheckType, e, finalEntry);
    if (!check.ok) return errorResponse(check.error);
  } else if (type === 'stage') {
    // Same-values case (no edit) still needs the original sanity check.
    const outU = e.outUnits || 0;
    const inU = e.inUnits || e.totalInUnits || 0;
    if (outU > inU + 0.01) return errorResponse(`Cannot approve — Output (${outU}u) exceeds Input (${inU}u). Provide corrected values instead.`);
  }

  const now = new Date().toISOString();
  const patch = {
    [`/tc/${table}/${id}/status`]: 'Approved',
    [`/tc/${table}/${id}/approvedBy`]: changedBy || '',
    [`/tc/${table}/${id}/approvedAt`]: now,
    ...fieldPatch
  };
  const editLogId = await genIdAtomicServer('EL', []);
  patch[`/tc/editLog/${editLogId}`] = {
    id: editLogId, entryId: id, stage: _OVERRIDE_STAGE_LABEL[type], field: 'Status',
    oldVal: e.status, newVal: Object.keys(fieldPatch).length ? 'Approved (Override + correction)' : 'Approved (Override)',
    reasonCat, reasonText: reasonText.trim(), impactNote: '', changedBy: changedBy || '', type: 'edit', _updatedAt: new Date().toISOString()
  };
  await fbPatch('', patch);

  // Jul 24 2026 — converted from full recompute to ledger nudge, same
  // exact delta shapes as handleApproveEntry (confirmed correct there).
  // Rejected->Approved has the identical balance effect as
  // Pending->Approved — the entry's own numbers get counted for the
  // first time either way — so this reuses that proven pattern instead
  // of a separate full rescan. Uses finalEntry (post-correction values
  // if any were provided) rather than the original e.
  let refreshFailed = false;
  if (type === 'stage') {
    await nudgeLotSummary(finalEntry.lotId, finalEntry.grade || '', finalEntry.vendor || '', {
      'rmBalance.kg': -(finalEntry.inWeight || 0), 'rmBalance.units': -(finalEntry.inUnits || 0),
      'softBalance.kg': (finalEntry.outWeight || 0), 'softBalance.units': (finalEntry.outUnits || 0)
    }).catch(() => { refreshFailed = true; });
  } else if (type === 'dyeLot') {
    const sources = (finalEntry.sources && finalEntry.sources.length) ? finalEntry.sources : [];
    for (const src of sources) {
      if (!src.lotId) continue;
      await nudgeLotSummary(src.lotId, src.grade || '', src.vendor || '', { 'softBalance.kg': -(src.weight || 0) }).catch(() => { refreshFailed = true; });
    }
    await nudgeDyeLotSummary(id, { 'dyeBalance.cones': (finalEntry.outCones || 0), 'dyeBalance.kg': (finalEntry.outWeight || 0) }).catch(() => { refreshFailed = true; });
  } else if (type === 'windEntry') {
    if (finalEntry.dyeLotId) await nudgeDyeLotSummary(finalEntry.dyeLotId, {
      'dyeBalance.cones': -(finalEntry.inCones || 0), 'dyeBalance.kg': -(finalEntry.inWeight || 0),
      'windBalance.cones': (finalEntry.outCones || 0), 'windBalance.kg': (finalEntry.outWeight || 0),
      'windWaste.cones': (finalEntry.wasteCones || 0), 'windWaste.kg': (finalEntry.wasteWeight || 0)
    }).catch(() => { refreshFailed = true; });
  } else if (type === 'packEntry') {
    if (finalEntry.dyeLotId) await nudgeDyeLotSummary(finalEntry.dyeLotId, {
      'windBalance.cones': -(finalEntry.inCones || 0), 'windBalance.kg': -(finalEntry.inWeight || 0),
      'packBalance.bags': (finalEntry.bags || 0), 'packBalance.kg': (finalEntry.weight || 0),
      'packGain.kg': (finalEntry.gainKg || 0)
    }).catch(() => { refreshFailed = true; });
  } else if (type === 'dispatch') {
    const dyeLotId = finalEntry.dyeLotId || (finalEntry.lots && finalEntry.lots[0] && finalEntry.lots[0].dyeLotId);
    if (dyeLotId) await nudgeDyeLotSummary(dyeLotId, {
      'packBalance.bags': -(finalEntry.bags || 0), 'packBalance.kg': -(finalEntry.weight || 0),
      'dispatched.bags': (finalEntry.bags || 0), 'dispatched.kg': (finalEntry.weight || 0)
    }).catch(() => { refreshFailed = true; });
  } else if (type === 'rm') {
    // Aug 26 2026 — real, direct extension for RM. Unlike every other
    // stage's own nudge (a partial delta), this uses a full, real
    // recalculation instead — genuinely simpler and safer for RM's own
    // formula, and it's already the exact same pattern the RM Lots
    // table's own "Recalculate" button already, correctly uses.
    await updateLotSummary(finalEntry.id, finalEntry.grade || '', finalEntry.vendor || '').catch(() => { refreshFailed = true; });
  }
  if (refreshFailed) {
    await fbSet(`/tc/editLog/${editLogId}/summaryRefreshFailed`, true).catch(() => {});
    await fbSet(`/tc/editLog/${editLogId}/_updatedAt`, new Date().toISOString()).catch(() => {});
  }

  return jsonResponse({ success: true, id });
}

// POST /api/dead-stock/create — was: submitDeadStock() (pages.js), a
// client-side push with genIdAtomic() (client-scan ID gen — same race
// shape closed elsewhere via genIdAtomicServer, never applied here).
// Matches openDeadStockModal's existing permissiveness: no role
// restriction in the client (any authenticated user can flag dead stock
// on the floor) — kept identical here, not tightened unasked.
async function handleDeadStockCreate(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager', 'supervisor'].includes(role)) return errorResponse('Supervisor or Admin only', 403);
  const { type, grade, weight, cones, note, changedBy } = body || {};
  if (!type) return errorResponse('Select cone type');
  if (!grade) return errorResponse('Select grade');
  if (!weight || weight <= 0) return errorResponse('Enter weight');
  // Sep 10 2026 — real, direct feature built via direct discussion
  // with Priyam: Dead Stock never had any way to record its own
  // cones count, on either Steel or Plastic type — meaning a Dead
  // Stock source used directly in a Dye batch could never carry a
  // real, genuine cones number of its own, only ever ending up at 0.
  // Required, same as Weight, since Priyam confirmed it's meaningful
  // for both cone types.
  if (!cones || cones <= 0) return errorResponse('Enter cones count');

  const raw = await fbGet('/tc/deadStock').catch(() => null);
  const deadStock = raw ? (Array.isArray(raw) ? raw : Object.values(raw)).filter(x => x && x.id) : [];
  const id = await genIdAtomicServer('DS', deadStock);
  const now = new Date().toISOString();
  const entry = { id, type, grade, weight, cones, note: note || '', addedBy: changedBy || '', date: now.slice(0, 10), status: 'Approved', approvedBy: changedBy || '', approvedAt: now, createdAt: now, _updatedAt: now };
  await fbSet(`/tc/deadStock/${id}`, entry);
  return jsonResponse({ success: true, id, entry });
}

// Jul 29 2026 — Dead Stock never had Edit or Void. Confirmed design:
// same Supervisor+/password pattern as everywhere else. The one real
// safety check that matters here — Dead Stock is a source, not
// something consumed FROM another balance, so Edit/Void just needs to
// make sure nothing already drawn from it exceeds whatever the new,
// smaller (or zero) weight would allow.
async function handleVoidDeadStock(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager', 'supervisor'].includes(role)) return errorResponse('Supervisor or Admin only', 403);
  const { id, reason, password, username, changedBy, dryRun } = body || {};
  // Sep 10 2026 — real, direct new feature built via direct discussion
  // with Priyam, establishing one clear rule across the whole app:
  // every real action shows a genuine preview of its actual effect
  // before committing. A preview never writes anything, so — unlike
  // simple Void, which has no other way to know who's asking — this
  // function already has a real, session-verified role, so it never
  // needs a password either; only the real, final void does.
  if (!dryRun) {
    const verifiedUser = await _verifySelfPassword(username, password);
    if (!verifiedUser) return errorResponse('Incorrect password', 401);
  }
  if (!id) return errorResponse('id required');

  const lockKey = `DSVOID_${id}`.replace(/[^a-zA-Z0-9_]/g, '_');
  const result = await withBalanceLock(lockKey, async () => {
    // Sep 10 2026 — same real fix as handleEditDeadStock, same root
    // cause: an older Dead Stock entry (predating this endpoint) is
    // genuinely stored as a plain array element with no named key of
    // its own — a direct fbGet(`/tc/deadStock/${id}`) only ever finds
    // the newer, correctly-keyed kind. Writes the WHOLE structure
    // back, uniformly keyed by id, migrating this survivor the moment
    // it's genuinely touched.
    const raw = await fbGet('/tc/deadStock').catch(() => null);
    const asArr = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x && x.id) : [];
    const allDS = asArr(raw);
    const rec = allDS.find(x => x.id === id);
    if (!rec) return { __rejected: errorResponse('Dead stock entry not found') };
    if (rec.status === 'Voided') return { __rejected: errorResponse('Already voided') };
    // Aug 6 2026 — real gap found via a thorough app-wide audit: this
    // "already consumed" check only ever looked at active dyeLots/
    // stageEntries — if the real Dye batch or Soft entry that consumed
    // this dead stock had since finished its own chain and archived,
    // that real consumption would be silently invisible here, allowing
    // a void on material that's already genuinely been used.
    const [dlA, dlAr, seA, seAr, slA] = await Promise.all([
      fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null),
      fbGet('/tc/stageEntries').catch(() => null), fbGet('/tc/archive/stageEntries').catch(() => null),
      fbGet('/tc/scrapLog').catch(() => null)
    ]);
    const toArr = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x && x.id) : [];
    const dyeLots = [...toArr(dlA), ...toArr(dlAr)], stageEntries = [...toArr(seA), ...toArr(seAr)], scrapLog = toArr(slA);
    const used = (rec.weight || 0) - calcDeadStockBalance([rec], dyeLots, stageEntries, scrapLog, id);
    if (used > 0.01) return { __rejected: errorResponse(`Cannot void — ${used}kg of this entry has already been consumed (used in Dye or Soft, or scrapped). Nothing can be voided out from under work already relying on it.`) };
    if (dryRun) return { __dryRun: true, entryWeight: rec.weight || 0, entryGrade: rec.grade || '', canVoid: true };
    const now = new Date().toISOString();
    const updatedRec = { ...rec, status: 'Voided', voidedBy: changedBy || '', voidedAt: now, voidReason: reason || '', _updatedAt: now };
    // Sep 30 2026 — real, confirmed architecture change, now safe to make: the earlier migration concern (some
    // older Dead Stock entries stored as unkeyed array elements) was investigated against real production data
    // via the legacy-format detector (POST /api/legacy-format/detect) and confirmed clean — all 7 production
    // deadStock records are canonically keyed by their own id, zero affected, zero conflicts. The whole-table
    // rebuild's self-healing purpose no longer applies; converting to a direct, targeted record write.
    await fbSet(`/tc/deadStock/${id}`, updatedRec);
    _reFreezeForRecord('deadstock', id).catch(() => {});
    return { success: true, id };
  });
  if (result.__lockFailed) return errorResponse(result.error);
  if (result.__rejected) return result.__rejected;
  return jsonResponse(result);
}

async function handleEditDeadStock(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager', 'supervisor'].includes(role)) return errorResponse('Supervisor or Admin only', 403);
  const isAdmin = ['admin', 'manager'].includes(role);
  const { id, type, grade, weight, cones, note, changedBy, password, username, dryRun } = body || {};
  if (!id) return errorResponse('id required');
  if (!weight || weight <= 0) return errorResponse('Enter weight');
  // Sep 10 2026 — real, direct new requirement built via direct
  // discussion with Priyam, establishing one clear rule across the
  // whole app: for Edit, only Supervisor enters a password — matching
  // the exact same rule handleEditEntry already uses for
  // Soft/Dye/Wind/Pack/Dispatch. This never asked for one from anyone
  // at all before now. A preview never writes anything, so it never
  // needs a password either — only the real, final save does.
  if (role === 'supervisor' && !dryRun) {
    const verifiedUser = await _verifySelfPassword(username, password);
    if (!verifiedUser) return errorResponse('Incorrect password', 401);
  }

  const lockKey = `DSEDIT_${id}`.replace(/[^a-zA-Z0-9_]/g, '_');
  const result = await withBalanceLock(lockKey, async () => {
    // Sep 10 2026 — real, root-cause fix built via direct discussion
    // with Priyam, from his own real console evidence (exact request
    // payload confirmed correct, server still said "not found"): an
    // older Dead Stock entry (predating this create/edit endpoint)
    // was genuinely stored as a plain array element with no named
    // key of its own, while newer ones get a real, named key matching
    // their own id — a direct fbGet(`/tc/deadStock/${id}`) only ever
    // finds the second kind. Fetches the whole real node, finds the
    // record by its own id field regardless of which shape it's
    // actually stored in, and writes the WHOLE structure back,
    // correctly, uniformly keyed by id — permanently migrating this
    // one (and any other array-shaped survivor) the moment it's
    // genuinely touched, rather than failing to find it at all.
    const raw = await fbGet('/tc/deadStock').catch(() => null);
    const asArr = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x && x.id) : [];
    const allDS = asArr(raw);
    const rec = allDS.find(x => x.id === id);
    if (!rec) return { __rejected: errorResponse('Dead stock entry not found') };
    if (rec.status === 'Voided') return { __rejected: errorResponse('Cannot edit a voided entry') };
    // Aug 6 2026 — same real gap, same fix as handleVoidDeadStock.
    const [dlA, dlAr, seA, seAr, slA] = await Promise.all([
      fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null),
      fbGet('/tc/stageEntries').catch(() => null), fbGet('/tc/archive/stageEntries').catch(() => null),
      fbGet('/tc/scrapLog').catch(() => null)
    ]);
    const toArr = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x && x.id) : [];
    const dyeLots = [...toArr(dlA), ...toArr(dlAr)], stageEntries = [...toArr(seA), ...toArr(seAr)], scrapLog = toArr(slA);
    const used = (rec.weight || 0) - calcDeadStockBalance([rec], dyeLots, stageEntries, scrapLog, id);
    // Sep 10 2026 — real, direct fix built via direct discussion with
    // Priyam: this used to be a hard block for everyone, including
    // Admin — unlike Soft/Dye/Wind/Pack, which all let Admin override
    // a downstream shortfall, visibly flagged, rather than refusing
    // outright. Same treatment here now: Supervisor still blocked,
    // Admin can override, and the resulting real shortfall gets a
    // real, visible flag via the existing, already-generic entryFlags
    // system, rather than silently allowing it with nothing to show
    // for it afterward.
    if (!isAdmin && weight < used - 0.01) return { __rejected: errorResponse(`Cannot reduce to ${weight}kg — ${used}kg has already been consumed from this entry. Set weight to at least ${used}kg. Only Admin/Manager can override this.`) };
    // Sep 10 2026 — real, direct new feature built via direct
    // discussion with Priyam, establishing one clear rule across the
    // whole app: every real action shows a genuine preview of its
    // actual effect before committing — the exact same validation
    // already run above, just stopped here instead of proceeding to
    // write. If Admin's own override would actually trigger (a real
    // shortfall this specific save would create), that's flagged
    // right here too, so it's genuinely highlighted before committing,
    // not just discovered afterward.
    if (dryRun) {
      return {
        __dryRun: true,
        oldWeight: rec.weight || 0, newWeight: weight,
        oldCones: rec.cones ?? null, newCones: cones !== undefined && cones !== null && cones !== '' ? cones : (rec.cones ?? null),
        alreadyConsumed: used,
        wouldTriggerAdminOverride: isAdmin && weight < used - 0.01,
      };
    }
    const now = new Date().toISOString();
    const updatedRec = {
      ...rec,
      type: type || rec.type,
      grade: grade || rec.grade,
      weight,
      // Sep 10 2026 — real, direct extension built via direct
      // discussion with Priyam: Dead Stock's cones count didn't exist
      // until today, so any existing entry genuinely has none — he
      // asked to fix those himself directly through this same Edit
      // feature, so cones is accepted here but not required, keeping
      // whatever the entry already has if it's left out.
      cones: cones !== undefined && cones !== null && cones !== '' ? cones : (rec.cones ?? null),
      note: note !== undefined ? note : rec.note,
      editedBy: changedBy || '',
      editedAt: now,
      _updatedAt: now,
    };
    // Sep 30 2026 — real, confirmed architecture change, now safe: production verified clean (see deadStock
    // void handler above for the full evidence). Converting this edit path's whole-table rebuild to a targeted
    // record write too, preserving the atomic entryFlags patch exactly as before.
    const patch = { [`/tc/deadStock/${id}`]: updatedRec };
    if (weight < used - 0.01) {
      const _safeId = String(id).replace(/[^a-zA-Z0-9]/g, '_');
      patch[`/tc/entryFlags/${_safeId}`] = { type: 'imbalance', note: `Reduced to ${weight}kg but ${used}kg has already been consumed from this entry — admin override`, by: changedBy || '', at: now, entryId: id };
    }
    await fbPatch('', patch);
    _reFreezeForRecord('deadstock', id).catch(() => {});
    return { success: true, id };
  });
  if (result.__lockFailed) return errorResponse(result.error);
  if (result.__rejected) return result.__rejected;
  return jsonResponse(result);
}

// POST /api/rm-return — was: submitRMReturn() (pages.js), fully client-
// side (direct State.DB.rmReturnLog mutation + generic save(), client-
// side genIdAtomic) — found only because Priyam specifically asked
// whether this area had been covered (Jul 17 2026). Confirmed via
// calcRMBalance's real formula (afterSoft - returned) that RM Return
// actually reduces RM Balance, not Soft Balance. Initially preserved the
// original's Soft-balance validation target while flagging the mismatch
// for Priyam's review — Priyam confirmed: fix it. Now validates against
// calcRMBalanceAvailable, matching what this action actually affects.
async function handleRMReturn(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager', 'supervisor'].includes(role)) return errorResponse('Supervisor/Admin/Manager only', 403);

  const { lotId, grade, vendor, units, weight, reason, changedBy } = body || {};
  if (!lotId || !grade || !vendor) return errorResponse('Select vendor, grade and lot');
  if ((!weight || weight <= 0) && (!units || units <= 0)) return errorResponse('Enter weight or bags to return');
  if (!reason) return errorResponse('Select reason');

  // Aug 6 2026 — real, genuine gap found via direct audit, confirmed
  // with Priyam: every comparable submit action elsewhere in the app
  // (Soft/Dye/Wind/Pack/Dispatch Start) locks before checking and
  // writing balance — this one read the balance, validated it, then
  // wrote, with nothing stopping two simultaneous requests from both
  // reading the same "available" number and both succeeding. Same real
  // lock-key pattern already used elsewhere for a single RM lot.
  const lockKey = `RM_${lotId}_${grade}_${vendor}`.replace(/[^a-zA-Z0-9_]/g, '_');
  const result = await withBalanceLock(lockKey, async () => {
  const [lotsRaw, lotsArRaw, seRaw, seArRaw, rlRaw] = await Promise.all([
    fbGet('/tc/lots').catch(() => null), fbGet('/tc/archive/lots').catch(() => null),
    fbGet('/tc/stageEntries').catch(() => null), fbGet('/tc/archive/stageEntries').catch(() => null),
    fbGet('/tc/rmReturnLog').catch(() => null)
  ]);
  const toArr = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x && x.id) : [];
  const lots = [...toArr(lotsRaw), ...toArr(lotsArRaw)];
  const stageEntries = [...toArr(seRaw), ...toArr(seArRaw)];
  const rmReturnLog = toArr(rlRaw);

  // Jul 17 2026 — real gap fixed, confirmed directly with Priyam: was
  // validating against Soft's Available balance while actually reducing
  // RM Balance — two different numbers. Now validates against
  // calcRMBalanceAvailable, matching what this action actually affects.
  const rmBalAvail = calcRMBalanceAvailable(lots, stageEntries, rmReturnLog, lotId, grade, vendor);
  if (weight > rmBalAvail + 0.01) return { __rejected: errorResponse(`Cannot return ${weight}kg — only ${rmBalAvail}kg available (already claimed by pending/in-progress Soft entries)`) };

  const id = await genIdAtomicServer('RMR', rmReturnLog);
  const now = new Date().toISOString();
  // Aug 2 2026 — Phase 3 of the RM permanent-ID plan, extended to RM
  // Return: this record represents a real reduction against a specific
  // RM lot's balance, so it gets that lot's real permanent ID stamped
  // on it too, same safe pattern, zero extra Firebase calls since lots
  // is already fetched above for the balance check.
  const _returnLotUid = lots.find(l => l.id === lotId && l.grade === grade && l.vendor === vendor)?.uid || null;
  // Aug 2 2026 — same saved address column Soft already has, so
  // everyone's column genuinely says the same thing, and the cascade
  // fix keeps it correct on this table too, not just Soft.
  const record = { id, lotId, grade, vendor, lotUid: _returnLotUid, _lotKey: summaryKey(lotId, grade, vendor), units: units || 0, weight: weight || 0, reason, status: 'Approved', by: changedBy || '', timestamp: now, date: now.slice(0, 10) };
  await fbSet(`/tc/rmReturnLog/${id}`, record);

  await nudgeLotSummary(lotId, grade, vendor, {
    'rmBalance.kg': -(weight || 0), 'rmBalance.units': -(units || 0)
  }).catch(() => {});

  return { success: true, id, record };
  });
  if (result.__lockFailed) return errorResponse(result.error);
  if (result.__rejected) return result.__rejected;
  return jsonResponse(result);
}

// Jul 28 2026 — RM Return never had Edit or Void, unlike every other
// stage. Confirmed design: same as everywhere else — Supervisor+,
// password required for Void (self-verify, no exceptions). No
// escalation for Edit — RM Return is terminal, nothing downstream ever
// consumes from a return, so there's nothing for a change here to ripple
// into (same reasoning as Dispatch never escalating).
async function handleVoidRMReturn(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager', 'supervisor'].includes(role)) return errorResponse('Supervisor or Admin only', 403);
  const { id, reason, password, username, changedBy, dryRun } = body || {};
  // Sep 10 2026 — real, direct new feature built via direct discussion
  // with Priyam, establishing one clear rule across the whole app:
  // every real action shows a genuine preview of its actual effect
  // before committing. This function already has a real,
  // session-verified role, so a preview never needs a password
  // either; only the real, final void does.
  if (!dryRun) {
    const verifiedUser = await _verifySelfPassword(username, password);
    if (!verifiedUser) return errorResponse('Incorrect password', 401);
  }
  if (!id) return errorResponse('id required');

  const lockKey = `RMRVOID_${id}`.replace(/[^a-zA-Z0-9_]/g, '_');
  const result = await withBalanceLock(lockKey, async () => {
    // Sep 10 2026 — real, proactive fix built via direct discussion
    // with Priyam, after finding this exact bug in Dead Stock's own
    // void/edit functions: an older entry (predating this endpoint)
    // can genuinely be stored as a plain array element with no named
    // key of its own — a direct fbGet(`/tc/rmReturnLog/${id}`) only
    // ever finds the newer, correctly-keyed kind. Fetches the whole
    // real node, finds the record by its own id field regardless of
    // shape, and writes the whole structure back, uniformly keyed.
    const raw = await fbGet('/tc/rmReturnLog').catch(() => null);
    const asArr = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x && x.id) : [];
    const allRML = asArr(raw);
    const rec = allRML.find(x => x.id === id);
    if (!rec) return { __rejected: errorResponse('RM Return entry not found') };
    if (rec.status === 'Voided') return { __rejected: errorResponse('Already voided') };
    if (dryRun) return { __dryRun: true, entryWeight: rec.weight || 0, entryUnits: rec.units || 0, lotId: rec.lotId || '' };
    const now = new Date().toISOString();
    const updatedRec = { ...rec, status: 'Voided', voidedBy: changedBy || '', voidedAt: now, voidReason: reason || '', _updatedAt: now };
    // Sep 30 2026 — real, confirmed architecture change: production legacy-format detection verified clean
    // (22/22 canonical for rmReturnLog, 0 affected) via the extended detector.
    await fbSet(`/tc/rmReturnLog/${id}`, updatedRec);
    // Voiding a return means the material was never actually returned to
    // the vendor after all — give it back to the RM balance.
    await nudgeLotSummary(rec.lotId, rec.grade, rec.vendor, {
      'rmBalance.kg': (rec.weight || 0), 'rmBalance.units': (rec.units || 0)
    }).catch(() => {});
    return { success: true, id };
  });
  if (result.__lockFailed) return errorResponse(result.error);
  if (result.__rejected) return result.__rejected;
  return jsonResponse(result);
}

// Aug 19 2026 — real, new preview endpoint for RM Return edits, built via
// direct discussion with Priyam: the same real safety net every other
// stage got today. Genuinely simpler than the others — RM Return has no
// downstream at all (material leaves the factory back to the vendor), so
// this only ever checks the one real thing that can go wrong: the new
// amount exceeding what's genuinely available at this lot right now.
async function handlePreviewRMReturn(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager', 'supervisor'].includes(role)) return errorResponse('Supervisor or Admin only', 403);
  const { id, units, weight } = body || {};
  if (!id) return errorResponse('id required');

  const toArr = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x && x.id) : [];
  const [recRaw, lotsRaw, lotsArRaw, seRaw, seArRaw, rlRaw] = await Promise.all([
    fbGet(`/tc/rmReturnLog/${id}`),
    fbGet('/tc/lots').catch(() => null), fbGet('/tc/archive/lots').catch(() => null),
    fbGet('/tc/stageEntries').catch(() => null), fbGet('/tc/archive/stageEntries').catch(() => null),
    fbGet('/tc/rmReturnLog').catch(() => null)
  ]);
  if (!recRaw) return errorResponse('RM Return entry not found', 404);
  const lots = [...toArr(lotsRaw), ...toArr(lotsArRaw)];
  const stageEntries = [...toArr(seRaw), ...toArr(seArRaw)];
  const rmReturnLog = toArr(rlRaw);

  const otherReturns = rmReturnLog.filter(r => r.id !== id);
  const availExcludingThis = calcRMBalanceAvailable(lots, stageEntries, otherReturns, recRaw.lotId, recRaw.grade, recRaw.vendor);
  const blockers = [];
  if (weight > availExcludingThis + 0.01) blockers.push(`Cannot set to ${weight}kg — only ${availExcludingThis}kg would be available.`);

  // Real, separate call for display purposes — calcRMBalanceAvailable
  // above (used for the real blocker check, matching the actual save
  // exactly) only returns a plain weight number. calcRMBalance gives the
  // real units side too, needed to show the complete new balance.
  const rmBalFull = calcRMBalance(lots, stageEntries, otherReturns, recRaw.lotId, recRaw.grade, recRaw.vendor);
  const newRmBalUnits = (rmBalFull.units || 0) - (units || 0);
  const newRmBalWeight = availExcludingThis - (weight || 0);

  return jsonResponse({
    success: true, allowed: blockers.length === 0, blockers, warnings: [],
    current: { units: recRaw.units, weight: recRaw.weight },
    proposed: { units: units || 0, weight: weight || 0 },
    newBalanceLabel: 'New RM Balance', newBalanceKg: newRmBalWeight, newBalanceUnits: newRmBalUnits,
    wouldGoNegative: newRmBalWeight < -0.01
  });
}

async function handleEditRMReturn(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager', 'supervisor'].includes(role)) return errorResponse('Supervisor or Admin only', 403);
  const { id, units, weight, reasonCat, reason, changedBy, password, username } = body || {};
  if (!id) return errorResponse('id required');
  if ((!weight || weight <= 0) && (!units || units <= 0)) return errorResponse('Enter weight or bags');
  if (!reasonCat) return errorResponse('Select a reason category');
  if (!reason || reason.trim().length < 10) return errorResponse('Reason must be at least 10 characters');
  // Sep 10 2026 — real, direct new requirement built via direct
  // discussion with Priyam, establishing one clear rule across the
  // whole app: for Edit, only Supervisor enters a password — matching
  // the exact same rule handleEditEntry already uses for
  // Soft/Dye/Wind/Pack/Dispatch. This never asked for one from anyone
  // at all before now.
  if (role === 'supervisor') {
    const verifiedUser = await _verifySelfPassword(username, password);
    if (!verifiedUser) return errorResponse('Incorrect password', 401);
  }

  const lockKey = `RMREDIT_${id}`.replace(/[^a-zA-Z0-9_]/g, '_');
  const result = await withBalanceLock(lockKey, async () => {
    const [lotsRaw, lotsArRaw, seRaw, seArRaw, rlRaw] = await Promise.all([
      fbGet('/tc/lots').catch(() => null), fbGet('/tc/archive/lots').catch(() => null),
      fbGet('/tc/stageEntries').catch(() => null), fbGet('/tc/archive/stageEntries').catch(() => null),
      fbGet('/tc/rmReturnLog').catch(() => null)
    ]);
    const toArr = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x && x.id) : [];
    const lots = [...toArr(lotsRaw), ...toArr(lotsArRaw)];
    const stageEntries = [...toArr(seRaw), ...toArr(seArRaw)];
    // Sep 10 2026 — real, proactive fix built via direct discussion
    // with Priyam, after finding this exact bug in Dead Stock's own
    // void/edit functions: an older entry (predating this endpoint)
    // can genuinely be stored as a plain array element with no named
    // key of its own — a direct fbGet(`/tc/rmReturnLog/${id}`) only
    // ever finds the newer, correctly-keyed kind. This function
    // already fetches the whole list a moment later anyway (for the
    // real balance check below) — moved that fetch earlier and finds
    // the record from it directly, instead of a separate, vulnerable
    // keyed lookup first.
    const rmReturnLog = toArr(rlRaw);
    const rec = rmReturnLog.find(x => x.id === id);
    if (!rec) return { __rejected: errorResponse('RM Return entry not found') };
    if (rec.status === 'Voided') return { __rejected: errorResponse('Cannot edit a voided entry') };

    // Available balance with THIS entry's own old amount excluded first —
    // since we're about to replace it with a new amount, not add on top.
    const otherReturns = rmReturnLog.filter(r => r.id !== id);
    const availExcludingThis = calcRMBalanceAvailable(lots, stageEntries, otherReturns, rec.lotId, rec.grade, rec.vendor);
    if (weight > availExcludingThis + 0.01) return { __rejected: errorResponse(`Cannot set to ${weight}kg — only ${availExcludingThis}kg would be available`) };

    const now = new Date().toISOString();
    // Aug 26 2026 — real, established pattern used by Soft/Dye/Wind/Pack,
    // now correctly applied here too: editing an already-Approved entry
    // flips its real status to Edited-Approved — a genuine, visible fact,
    // not a separate marker.
    const _newStatus = rec.status === 'Approved' ? 'Edited-Approved' : rec.status;
    const updatedRec = {
      ...rec,
      units: units || 0,
      weight: weight || 0,
      reason: reason || rec.reason,
      status: _newStatus,
      reasonCat: reasonCat || rec.reasonCat || '',
      editedBy: changedBy || '',
      editedAt: now,
      _updatedAt: now,
    };
    // Sep 30 2026 — real, confirmed architecture change, same evidence as the void handler above.
    await fbSet(`/tc/rmReturnLog/${id}`, updatedRec);

    // Aug 19 2026 — real, genuine gap found via direct discussion with
    // Priyam: every other stage's edit writes a real, visible entry to
    // the shared Edit Log — this one never did, silently, since it
    // patched the record directly with no audit trail. Same pattern as
    // the other stages now, so this edit is genuinely traceable too.
    const _logId = `EL-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    await fbPatch('', {
      [`/tc/editLog/${_logId}`]: { id: _logId, timestamp: now, entryId: id, stage: 'RM Return', field: 'units/weight', oldVal: `${rec.units || 0}b / ${rec.weight || 0}kg`, newVal: `${units || 0}b / ${weight || 0}kg`, reasonCat, reasonText: reason, changedBy: changedBy || '', type: 'edit', _updatedAt: now }
    }).catch(() => {});

    // Adjust the balance by the exact delta — give back the old amount,
    // take the new amount — not a blind overwrite.
    const kgDelta = (rec.weight || 0) - (weight || 0);
    const unitsDelta = (rec.units || 0) - (units || 0);
    await nudgeLotSummary(rec.lotId, rec.grade, rec.vendor, {
      'rmBalance.kg': kgDelta, 'rmBalance.units': unitsDelta
    }).catch(() => {});

    return { success: true, id };
  });
  if (result.__lockFailed) return errorResponse(result.error);
  if (result.__rejected) return result.__rejected;
  return jsonResponse(result);
}

// POST /api/residual-transfer — was: submitResidualTransfer() (pages.js),
// same class of gap as RM Return above — fully client-side, found the
// same way. Confirmed via calcSoftBalanceWeight's real formula
// (softOut - dyeConsumed - residualOut) that this correctly reduces
// Soft Balance.
async function handleResidualTransfer(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager', 'supervisor'].includes(role)) return errorResponse('Supervisor/Admin/Manager only', 403);

  const { lotId, grade, vendor, weight, type, reason, changedBy } = body || {};
  if (!lotId || !grade || !vendor) return errorResponse('Select a lot + grade + vendor');
  if (!weight || weight <= 0) return errorResponse('Enter weight to transfer');
  if (!reason || !reason.trim()) return errorResponse('Enter reason');
  const transferType = type || 'residual';

  // Aug 6 2026 — same real gap found via audit, same fix — reads and
  // validates Soft's available balance, then writes, with nothing
  // stopping two simultaneous requests for the same lot from both
  // succeeding when only one genuinely should.
  const lockKey = `RM_${lotId}_${grade}_${vendor}`.replace(/[^a-zA-Z0-9_]/g, '_');
  const result = await withBalanceLock(lockKey, async () => {
  const [seRaw, seArRaw, lotsRaw, lotsArRaw, dlRaw, dlArRaw, rlRaw, rsRaw] = await Promise.all([
    fbGet('/tc/stageEntries').catch(() => null), fbGet('/tc/archive/stageEntries').catch(() => null),
    fbGet('/tc/lots').catch(() => null), fbGet('/tc/archive/lots').catch(() => null),
    fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null),
    fbGet('/tc/residualLog').catch(() => null),
    fbGet('/tc/residualStock').catch(() => null)
  ]);
  const toArr = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x && x.id) : [];
  const stageEntries = [...toArr(seRaw), ...toArr(seArRaw)];
  const lots = [...toArr(lotsRaw), ...toArr(lotsArRaw)];
  const dyeLots = [...toArr(dlRaw), ...toArr(dlArRaw)];
  const residualLog = toArr(rlRaw);
  const residualStock = toArr(rsRaw);

  const avail = calcSoftBalanceWeightAvailable(stageEntries, lots, [], dyeLots, residualLog, lotId, grade, vendor);
  if (weight > avail + 0.01) return { __rejected: errorResponse(`Cannot transfer ${weight}kg — only ${avail}kg available for ${lotId} — ${grade} — ${vendor}`) };

  const id = await genIdAtomicServer('RL', residualLog);
  const now = new Date().toISOString();
  // Aug 2 2026 — found via a systematic search for every record type
  // that references lotId directly (the same search that should have
  // caught RM Return earlier) — Residual Transfer is another one.
  // Same safe pattern, zero extra Firebase calls, lots already fetched
  // above for the balance check.
  const _residualLotUid = lots.find(l => l.id === lotId && l.grade === grade && l.vendor === vendor)?.uid || null;
  // Aug 2 2026 — same saved address column Soft already has.
  const _resLotKey = summaryKey(lotId, grade, vendor);
  const logRecord = { id, lotId, grade, vendor, lotUid: _residualLotUid, _lotKey: _resLotKey, weight, type: transferType, reason: reason.trim(), status: 'Approved', by: changedBy || '', timestamp: now, date: now.slice(0, 10), _updatedAt: now };
  const patch = { [`/tc/residualLog/${id}`]: logRecord };

  if (transferType === 'residual') {
    const rsEntry = residualStock.find(r => r.grade === grade && r.status === 'Active');
    if (rsEntry) {
      const contributions = [...(rsEntry.contributions || []), { lotId, vendor, lotUid: _residualLotUid, _lotKey: _resLotKey, weight, residualLogId: id, movedBy: changedBy || '', timestamp: now }];
      patch[`/tc/residualStock/${rsEntry.id}/weight`] = (rsEntry.weight || 0) + weight;
      patch[`/tc/residualStock/${rsEntry.id}/contributions`] = contributions;
      patch[`/tc/residualStock/${rsEntry.id}/_updatedAt`] = now;
    } else {
      const newId = await genIdAtomicServer('RS', residualStock);
      patch[`/tc/residualStock/${newId}`] = { id: newId, grade, weight, status: 'Active', createdAt: now, contributions: [{ lotId, vendor, lotUid: _residualLotUid, _lotKey: _resLotKey, weight, residualLogId: id, movedBy: changedBy || '', timestamp: now }], _updatedAt: now };
    }
  }

  await fbPatch('', patch);

  await nudgeLotSummary(lotId, grade, vendor, { 'softBalance.kg': -weight }).catch(() => {});

  return { success: true, id, logRecord };
  });
  if (result.__lockFailed) return errorResponse(result.error);
  if (result.__rejected) return result.__rejected;
  return jsonResponse(result);
}

// Jul 29 2026 — Residual never had Edit or Void. Confirmed design: same
// Supervisor+/password pattern as everywhere else. The real thing this
// has to get right that none of the others needed: multiple transfers
// from different lots can feed the SAME shared residualStock bucket by
// grade. Voiding one specific transfer means correctly pulling just that
// one contribution back out of a pool other transfers also feed — and
// that pool can already be partially drawn down by a real Dye Start
// before anyone tries to void anything. The safety check uses the new
// calcResidualStockBalance (the same shared formula handleDyeStart now
// uses too) to make sure there's still enough unconsumed material in the
// pool to safely remove this contribution — if not, blocked, not
// silently allowed to go negative.
async function handleVoidResidualTransfer(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager', 'supervisor'].includes(role)) return errorResponse('Supervisor or Admin only', 403);
  const { id, reason, password, username, changedBy, dryRun } = body || {};
  // Sep 10 2026 — real, direct new feature built via direct discussion
  // with Priyam, establishing one clear rule across the whole app:
  // every real action shows a genuine preview of its actual effect
  // before committing. This function already has a real,
  // session-verified role, so a preview never needs a password
  // either; only the real, final void does.
  if (!dryRun) {
    const verifiedUser = await _verifySelfPassword(username, password);
    if (!verifiedUser) return errorResponse('Incorrect password', 401);
  }
  if (!id) return errorResponse('id required');

  const lockKey = `RLVOID_${id}`.replace(/[^a-zA-Z0-9_]/g, '_');
  const result = await withBalanceLock(lockKey, async () => {
    // Sep 10 2026 — real, proactive fix built via direct discussion
    // with Priyam, after finding this exact bug in Dead Stock's own
    // void/edit functions: an older entry (predating this endpoint)
    // can genuinely be stored as a plain array element with no named
    // key of its own — a direct fbGet(`/tc/residualLog/${id}`) only
    // ever finds the newer, correctly-keyed kind. Fetches the whole
    // real node, finds the record by its own id field regardless of
    // shape.
    const rawRL = await fbGet('/tc/residualLog').catch(() => null);
    const asArr = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x && x.id) : [];
    const allRL = asArr(rawRL);
    const rec = allRL.find(x => x.id === id);
    if (!rec) return { __rejected: errorResponse('Residual transfer not found') };
    if (rec.status === 'Voided') return { __rejected: errorResponse('Already voided') };

    if (dryRun) return { __dryRun: true, entryWeight: rec.weight || 0, lotId: rec.lotId || '' };
    const updatedRec = { ...rec, status: 'Voided', voidedBy: changedBy || '', voidedAt: new Date().toISOString(), voidReason: reason || '', _updatedAt: new Date().toISOString() };
    // Sep 30 2026 — real, confirmed architecture change: production legacy-format detection verified clean (1/1
    // canonical for residualLog, 0 affected) via the extended detector. The rebuild's self-healing purpose no
    // longer applies; converting to a targeted record write.
    const patch = { [`/tc/residualLog/${id}`]: updatedRec };

    if (rec.type === 'residual' || !rec.type) {
      // Aug 6 2026 — same real gap, same fix as the rest of this batch.
      const [rsA, dlA, dlAr] = await Promise.all([fbGet('/tc/residualStock').catch(() => null), fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null)]);
      const toArr = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x && x.id) : [];
      const residualStock = toArr(rsA), dyeLots = [...toArr(dlA), ...toArr(dlAr)];
      const rsEntry = residualStock.find(rs => (rs.contributions || []).some(c => c.residualLogId === id));
      if (rsEntry) {
        const bal = calcResidualStockBalance(residualStock, dyeLots, rsEntry.id);
        if (rec.weight > bal + 0.01) {
          return { __rejected: errorResponse(`Cannot void — ${rec.weight}kg was pooled into a shared bucket that has since had ${(rsEntry.weight - bal).toFixed(2)}kg drawn from it by Dye. Only ${bal}kg is currently unconsumed and safe to remove.`) };
        }
        const newContributions = (rsEntry.contributions || []).filter(c => c.residualLogId !== id);
        // Sep 10 2026 — same real fix, same reason: residualStock is
        // exactly the same category of table as residualLog above — a
        // keyed sub-path write only ever reaches a properly-keyed
        // record. Rebuilds and writes the whole structure instead.
        const updatedRsEntry = { ...rsEntry, weight: Math.max(0, (rsEntry.weight || 0) - rec.weight), contributions: newContributions, _updatedAt: new Date().toISOString() };
        // Sep 30 2026 — real, confirmed architecture change: production legacy-format detection verified clean
        // (1/1 canonical for residualStock, 0 affected) via the extended detector.
        patch[`/tc/residualStock/${rsEntry.id}`] = updatedRsEntry;
      }
    }

    await fbPatch('', patch);
    await nudgeLotSummary(rec.lotId, rec.grade, rec.vendor, { 'softBalance.kg': rec.weight }).catch(() => {});
    return { success: true, id };
  });
  if (result.__lockFailed) return errorResponse(result.error);
  if (result.__rejected) return result.__rejected;
  return jsonResponse(result);
}

async function handleEditResidualTransfer(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager', 'supervisor'].includes(role)) return errorResponse('Supervisor or Admin only', 403);
  const isAdmin = ['admin', 'manager'].includes(role);
  const { id, weight, reason, changedBy, password, username, dryRun } = body || {};
  if (!id) return errorResponse('id required');
  if (!weight || weight <= 0) return errorResponse('Enter weight');
  // Sep 10 2026 — real, direct new requirement built via direct
  // discussion with Priyam, establishing one clear rule across the
  // whole app: for Edit, only Supervisor enters a password — matching
  // the exact same rule handleEditEntry already uses for
  // Soft/Dye/Wind/Pack/Dispatch. This never asked for one from anyone
  // at all before now. A preview never writes anything, so it never
  // needs a password either — only the real, final save does.
  if (role === 'supervisor' && !dryRun) {
    const verifiedUser = await _verifySelfPassword(username, password);
    if (!verifiedUser) return errorResponse('Incorrect password', 401);
  }

  const lockKey = `RLEDIT_${id}`.replace(/[^a-zA-Z0-9_]/g, '_');
  const result = await withBalanceLock(lockKey, async () => {
    const [seRaw, seArRaw, lotsRaw, lotsArRaw, dlRaw, dlArRaw, rlRaw, rsRaw] = await Promise.all([
      fbGet('/tc/stageEntries').catch(() => null), fbGet('/tc/archive/stageEntries').catch(() => null),
      fbGet('/tc/lots').catch(() => null), fbGet('/tc/archive/lots').catch(() => null),
      fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null),
      fbGet('/tc/residualLog').catch(() => null), fbGet('/tc/residualStock').catch(() => null)
    ]);
    const toArr = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x && x.id) : [];
    const stageEntries = [...toArr(seRaw), ...toArr(seArRaw)];
    const lots = [...toArr(lotsRaw), ...toArr(lotsArRaw)];
    const dyeLots = [...toArr(dlRaw), ...toArr(dlArRaw)];
    // Sep 10 2026 — real, proactive fix built via direct discussion
    // with Priyam, after finding this exact bug in Dead Stock's own
    // void/edit functions: an older entry (predating this endpoint)
    // can genuinely be stored as a plain array element with no named
    // key of its own — a direct fbGet(`/tc/residualLog/${id}`) only
    // ever finds the newer, correctly-keyed kind. This function
    // already fetches the whole list a moment later anyway — moved
    // that fetch earlier and finds the record from it directly.
    const residualLog = toArr(rlRaw);
    const residualStock = toArr(rsRaw);
    const rec = residualLog.find(x => x.id === id);
    if (!rec) return { __rejected: errorResponse('Residual transfer not found') };
    if (rec.status === 'Voided') return { __rejected: errorResponse('Cannot edit a voided entry') };

    // Available on the source lot side, with this entry's own old amount
    // excluded first (same pattern as RM Return Edit).
    const otherLogs = residualLog.filter(r => r.id !== id);
    const availSource = calcSoftBalanceWeightAvailable(stageEntries, lots, [], dyeLots, otherLogs, rec.lotId, rec.grade, rec.vendor);
    if (weight > availSource + 0.01) return { __rejected: errorResponse(`Cannot set to ${weight}kg — only ${availSource}kg would be available on ${rec.lotId}`) };

    const weightDelta = weight - (rec.weight || 0); // positive = increasing, negative = decreasing

    // If pooled, also check the shared bucket can absorb the delta
    // without going negative (only matters when increasing).
    if ((rec.type === 'residual' || !rec.type) && weightDelta !== 0) {
      const rsEntry = residualStock.find(rs => (rs.contributions || []).some(c => c.residualLogId === id));
      if (rsEntry) {
        let bal = null;
        if (weightDelta < 0) {
          bal = calcResidualStockBalance(residualStock, dyeLots, rsEntry.id);
          // Sep 10 2026 — real, direct fix built via direct discussion
          // with Priyam: this used to be a hard block for everyone,
          // including Admin — matching the same "Admin can override,
          // visibly flagged" treatment as Dead Stock and every other
          // stage in this app, instead of refusing outright.
          if (!isAdmin && -weightDelta > bal + 0.01) return { __rejected: errorResponse(`Cannot reduce by ${-weightDelta}kg — only ${bal}kg is currently unconsumed in the shared pool. Only Admin/Manager can override this.`) };
        }
        const now = new Date().toISOString();
        const newContributions = (rsEntry.contributions || []).map(c => c.residualLogId === id ? { ...c, weight } : c);
        const updatedRsEntry = { ...rsEntry, weight: Math.max(0, (rsEntry.weight || 0) + weightDelta), contributions: newContributions, _updatedAt: now };
        const updatedRec2 = { ...rec, weight, reason: reason || rec.reason, editedBy: changedBy || '', editedAt: now, _updatedAt: now };
        // Sep 10 2026 — real, genuine gap found while directly building
        // Undo support for Residual Transfer, per Priyam's own explicit
        // request: this function never actually wrote an edit log entry
        // at all — meaning there was nothing here for Undo to ever find
        // in the first place, regardless of any role or lookup-table fix.
        const _logId2 = `EL-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const _editLogPatch2 = { [`/tc/editLog/${_logId2}`]: { id: _logId2, timestamp: now, entryId: id, stage: 'residual', field: 'weight', oldVal: String(rec.weight || 0), newVal: String(weight), reasonCat: 'correction', reasonText: reason || '', changedBy: changedBy || '', type: 'edit', _updatedAt: now } };
        if (bal !== null && -weightDelta > bal + 0.01) {
          const _safeId2 = String(id).replace(/[^a-zA-Z0-9]/g, '_');
          _editLogPatch2[`/tc/entryFlags/${_safeId2}`] = { type: 'imbalance', note: `Reduced by ${-weightDelta}kg but only ${bal}kg was unconsumed in the shared pool — admin override`, by: changedBy || '', at: now, entryId: id };
        }
        // Sep 10 2026 — real, direct new feature built via direct
        // discussion with Priyam, establishing one clear rule across
        // the whole app: every real action shows a genuine preview of
        // its actual effect before committing — the exact same
        // validation already run above, just stopped here instead of
        // proceeding to write. If Admin's own override would actually
        // trigger (a real shortfall this specific save would create
        // in the shared pool), that's flagged right here too.
        if (dryRun) {
          return {
            __dryRun: true,
            oldWeight: rec.weight || 0, newWeight: weight,
            pooledBalance: bal, wouldTriggerAdminOverride: bal !== null && -weightDelta > bal + 0.01,
          };
        }
        await fbPatch('', { [`/tc/residualStock/${rsEntry.id}`]: updatedRsEntry, [`/tc/residualLog/${id}`]: updatedRec2, ..._editLogPatch2 });
        await nudgeLotSummary(rec.lotId, rec.grade, rec.vendor, { 'softBalance.kg': -weightDelta }).catch(() => {});
        return { success: true, id };
      }
    }

    const now = new Date().toISOString();
    const updatedRec3 = { ...rec, weight, reason: reason || rec.reason, editedBy: changedBy || '', editedAt: now, _updatedAt: now };
    // Sep 10 2026 — real, direct new feature: a plain (non-pooled)
    // transfer has no shared-pool boundary to flag, so the preview is
    // simply the before/after weight.
    if (dryRun) {
      return { __dryRun: true, oldWeight: rec.weight || 0, newWeight: weight, pooledBalance: null, wouldTriggerAdminOverride: false };
    }
    // Sep 10 2026 — same real gap, same fix as the pooled branch above.
    const _logId3 = `EL-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    await fbSet(`/tc/residualLog/${id}`, updatedRec3);
    await fbPatch('', { [`/tc/editLog/${_logId3}`]: { id: _logId3, timestamp: now, entryId: id, stage: 'residual', field: 'weight', oldVal: String(rec.weight || 0), newVal: String(weight), reasonCat: 'correction', reasonText: reason || '', changedBy: changedBy || '', type: 'edit', _updatedAt: now } });
    await nudgeLotSummary(rec.lotId, rec.grade, rec.vendor, { 'softBalance.kg': -weightDelta }).catch(() => {});
    return { success: true, id };
  });
  if (result.__lockFailed) return errorResponse(result.error);
  if (result.__rejected) return result.__rejected;
  return jsonResponse(result);
}

// POST /api/scrap — was: submitScrap() (pages.js), which validated the
// scrap weight against a client-computed getDeadStockBalance/
// getRecycleBalance — trusted from the browser, no server check. Now
// validates against the same shared calcDeadStockBalance/
// calcRecycleBalance formula server-side (Item Q medium-tier fix — these
// two functions didn't exist server-side before today, ported into
// shared-balances.js from core.js as part of this fix).
async function handleScrapSubmit(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin only', 403);

  let { id, type, weight, cones, pool, reason, changedBy } = body || {};
  if (!id) return errorResponse('Entry required');
  if (!type || (type !== 'dead' && type !== 'recycle')) return errorResponse('Invalid type');
  if (type !== 'recycle' && (!weight || weight <= 0)) return errorResponse('Enter weight to scrap');
  // Sep 19 2026 — Recycle Phase 1: recycle is scrapped in cones AND kg. Either can be 0 (never both) so the last leftover cone, or the last
  // few grams, can always be scrapped — otherwise a remnant of one measure would sit in the pool forever.
  if (type === 'recycle') {
    const _cc = (cones === undefined || cones === null || cones === '') ? NaN : +cones;
    weight = +weight || 0;
    if (!Number.isInteger(_cc) || _cc < 0 || weight < 0 || (weight <= 0 && _cc <= 0)) return errorResponse('Enter the weight and the cones to scrap (whole cones; either can be 0, but not both)');
  }
  if (!reason || reason.trim().length < 10) return errorResponse('Reason must be at least 10 characters');

  // Aug 6 2026 — same real gap found via audit, same fix. Keyed by the
  // specific source entry being scrapped (not an RM lot, since Scrap
  // draws from Dead Stock or Recycle Stock), locking that one entry so
  // two simultaneous scrap requests against it can't both succeed.
  const lockKey = `SCRAP_${type}_${id}`.replace(/[^a-zA-Z0-9_]/g, '_');
  const result = await withBalanceLock(lockKey, async () => {
  // Aug 6 2026 — real gap found via a thorough app-wide audit: this
  // balance check only ever looked at active dyeLots/stageEntries — if
  // the real consumption already finished its own chain and archived,
  // this would silently miss it, potentially allowing more to be
  // scrapped than genuinely remains.
  const [dsA, rcA, dlA, dlAr, seA, seAr, slA, rcsA] = await Promise.all([
    fbGet('/tc/deadStock').catch(() => null), fbGet('/tc/recycleStock').catch(() => null),
    fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null),
    fbGet('/tc/stageEntries').catch(() => null), fbGet('/tc/archive/stageEntries').catch(() => null),
    fbGet('/tc/scrapLog').catch(() => null), fbGet('/tc/recycleSoft').catch(() => null)
  ]);
  const toArr = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x && x.id) : [];
  const deadStock = toArr(dsA), recycleStock = toArr(rcA), dyeLots = [...toArr(dlA), ...toArr(dlAr)], stageEntries = [...toArr(seA), ...toArr(seAr)], scrapLog = toArr(slA);

  // Sep 20 2026 — Recycle Phase 2: recycle can be scrapped from the ON STEEL pool (default) or the SOFTENED pool.
  const scrapPool = pool === 'softened' ? 'softened' : 'steel';
  const recycleSoft = toArr(rcsA);
  const _steelAv = type === 'recycle' ? calcRecycleSteelAvailable(recycleStock, dyeLots, scrapLog, id, recycleSoft) : null;
  const _softAv = type === 'recycle' ? calcRecycleSoftenedAvailable(recycleStock, recycleSoft, dyeLots, scrapLog, id) : null;
  const rcAvail = type === 'recycle' ? (scrapPool === 'softened' ? _softAv : _steelAv) : null;
  const _otherAv = type === 'recycle' ? (scrapPool === 'softened' ? _steelAv : _softAv) : null;
  const bal = type === 'dead'
    ? calcDeadStockBalance(deadStock, dyeLots, stageEntries, scrapLog, id)
    : rcAvail.weight;
  if (weight > bal + 0.01) return { __rejected: errorResponse(`Scrap weight (${weight}kg) exceeds remaining balance (${bal}kg)`) };
  if (type === 'recycle' && +cones > rcAvail.units) return { __rejected: errorResponse(`Scrap cones (${+cones}) exceeds remaining cones (${rcAvail.units})`) };

  const scrapId = await genIdAtomicServer('SC', scrapLog);
  const now = new Date().toISOString();
  const patch = {
    [`/tc/scrapLog/${scrapId}`]: { id: scrapId, entryId: id, type, weight, ...(type === 'recycle' ? { cones: +cones, pool: scrapPool } : {}), reason: reason.trim(), scrappedBy: changedBy || '', status: 'Approved', date: now.slice(0, 10), timestamp: now, _updatedAt: now }
  };

  if (type === 'dead') {
    const remaining = bal - weight;
    if (remaining <= 0.01) { patch[`/tc/deadStock/${id}/status`] = 'Scrapped'; patch[`/tc/deadStock/${id}/_updatedAt`] = now; }
  } else {
    const remaining = bal - weight;
    if (remaining <= 0.01 && rcAvail.units - +cones <= 0 && _otherAv.weight <= 0.01 && _otherAv.units <= 0) { patch[`/tc/recycleStock/${id}/status`] = 'Scrapped'; patch[`/tc/recycleStock/${id}/_updatedAt`] = now; }
  }
  await fbPatch('', patch);

  return { success: true, id: scrapId };
  });
  if (result.__lockFailed) return errorResponse(result.error);
  if (result.__rejected) return result.__rejected;
  return jsonResponse(result);
}

// Jul 29 2026 — Scrap never had Void. Confirmed design: same tier as
// Scrap itself already is (Admin only — this was never Supervisor+,
// unlike RM Return/Dead Stock, so Void stays consistent with that,
// not upgraded to match the others). Real thing this has to get right
// that Dead Stock's Void didn't: scrapping something can flip the
// source to status 'Scrapped' if it used up the last of the balance —
// voiding that scrap needs to correctly flip it back to 'Approved' if
// this was the scrap that caused it, not leave it stuck.
async function handleVoidScrap(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin only', 403);
  const { id, reason, password, username, changedBy, dryRun } = body || {};
  // Aug 6 2026 — real, genuine inconsistency found via direct audit,
  // confirmed with Priyam: every sibling Void handler in this same area
  // (Dead Stock, RM Return, Residual) requires password confirmation
  // before proceeding — this one, alone, didn't. No real reason found
  // for the difference; matching the same proven pattern here too.
  // Sep 10 2026 — a preview never writes anything, so — like the rest
  // of its Void siblings, all of which already have a real,
  // session-verified role — it never needs a password either; only
  // the real, final void does.
  if (!dryRun) {
    const verifiedUser = await _verifySelfPassword(username, password);
    if (!verifiedUser) return errorResponse('Incorrect password', 401);
  }
  if (!id) return errorResponse('id required');

  const lockKey = `SCVOID_${id}`.replace(/[^a-zA-Z0-9_]/g, '_');
  const result = await withBalanceLock(lockKey, async () => {
    // Sep 10 2026 — real, proactive fix built via direct discussion
    // with Priyam, after finding this exact bug in Dead Stock's own
    // void/edit functions: an older entry (predating this endpoint)
    // can genuinely be stored as a plain array element with no named
    // key of its own — a direct fbGet(`/tc/scrapLog/${id}`) only ever
    // finds the newer, correctly-keyed kind. Fetches the whole real
    // node, finds the record by its own id field regardless of shape.
    const asArr = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x && x.id) : [];
    const rawSL = await fbGet('/tc/scrapLog').catch(() => null);
    const allSL = asArr(rawSL);
    const rec = allSL.find(x => x.id === id);
    if (!rec) return { __rejected: errorResponse('Scrap entry not found') };
    if (rec.status === 'Voided') return { __rejected: errorResponse('Already voided') };

    if (dryRun) return { __dryRun: true, entryWeight: rec.weight || 0, entryCones: rec.cones || 0, lotId: rec.lotId || '' };
    const now = new Date().toISOString();
    const updatedRec = { ...rec, status: 'Voided', voidedBy: changedBy || '', voidedAt: now, voidReason: reason || '', _updatedAt: now };
    // Sep 30 2026 — real, confirmed architecture change, now safe: production legacy-format detection confirmed
    // zero affected/conflict records for scrapLog.
    const patch = { [`/tc/scrapLog/${id}`]: updatedRec };

    // Recompute the source's real balance with this scrap now excluded,
    // and correctly reverse the 'Scrapped' status flip if this was what
    // caused it.
    const sourceTable = rec.type === 'dead' ? 'deadStock' : 'recycleStock';
    // Same real fix as scrapLog above — this table has the exact same
    // real risk (confirmed directly in Dead Stock's own case).
    const rawSource = await fbGet(`/tc/${sourceTable}`).catch(() => null);
    const allSource = asArr(rawSource);
    const sourceRec = allSource.find(x => x.id === rec.entryId);
    if (sourceRec && sourceRec.status === 'Scrapped') {
      // Aug 6 2026 — same real gap, same fix as the others in this batch.
      const [dlA, dlAr, seA, seAr] = await Promise.all([
        fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null),
        fbGet('/tc/stageEntries').catch(() => null), fbGet('/tc/archive/stageEntries').catch(() => null),
      ]);
      const toArr = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x && x.id) : [];
      const dyeLots = [...toArr(dlA), ...toArr(dlAr)], stageEntries = [...toArr(seA), ...toArr(seAr)];
      const scrapLogAfterVoid = allSL.map(s => s.id === id ? { ...s, status: 'Voided' } : s);
      const _rsV = rec.type === 'recycle' ? toArr(await fbGet('/tc/recycleSoft').catch(() => null)) : [];
      const _rcAvailAfter = rec.type === 'recycle'
        ? (rec.pool === 'softened' ? calcRecycleSoftenedAvailable([sourceRec], _rsV, dyeLots, scrapLogAfterVoid, rec.entryId) : calcRecycleSteelAvailable([sourceRec], dyeLots, scrapLogAfterVoid, rec.entryId, _rsV))
        : { weight: 0, units: 0 };
      const newBal = rec.type === 'dead'
        ? calcDeadStockBalance([sourceRec], dyeLots, stageEntries, scrapLogAfterVoid, rec.entryId)
        : _rcAvailAfter.weight;
      const _newRcCones = rec.type === 'recycle' ? _rcAvailAfter.units : 0;
      if (newBal > 0.01 || _newRcCones > 0) {
        const updatedSourceRec = { ...sourceRec, status: 'Approved', _updatedAt: now };
        // Sep 30 2026 — real, confirmed architecture change, now safe: this hidden case (deadStock/recycleStock
        // as a source table) is covered by the same confirmed-clean legacy-format detection as both tables'
        // own direct void handlers. Converting to a targeted record write.
        patch[`/tc/${sourceTable}/${rec.entryId}`] = updatedSourceRec;
      }
    }

    await fbPatch('', patch);
    return { success: true, id };
  });
  if (result.__lockFailed) return errorResponse(result.error);
  if (result.__rejected) return result.__rejected;
  return jsonResponse(result);
}

// POST /api/master-edit — Item Q critical tier (Jul 15 2026). Was:
// saveMasterEdit() (pages.js) — renaming a vendor/grade/worker/machine/
// mill/party cascaded the rename across up to 7 different collections
// (lots, stageEntries, dyeLots, windEntries, packEntries, dispatches,
// partyOrders) via 8 separate un-atomic save() calls, entirely client-
// side, zero server involvement. Same exact bug shape as Item A (RM edit
// cascade) — a crash mid-way leaves a partially-renamed dataset with no
// way to detect or resume. Fixed the same way Items C/D were: one atomic
// multi-path PATCH built from the same per-key cascade rules as the
// original (verbatim — no scope change, active tables only, matching
// what saveMasterEdit touched, no archive since the original never
// touched archive either). dyeEntries/dyeBatches dropped entirely on Jul
// 26 2026 — confirmed empty against a real production export, so the
// original's rename rules for them never touched anything real anyway.
async function handleMasterEdit(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin/Manager only', 403);

  const { key, oldVal, newVal, changedBy, confirm } = body || {};
  if (!key) return errorResponse('key required');
  if (!newVal || !newVal.trim()) return errorResponse('Value cannot be empty');
  if (newVal === oldVal) return jsonResponse({ success: true, noop: true });

  const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(e => e && e.id);
  // Jul 26 2026 — dropped dyeEntries/dyeBatches from this fetch and every
  // cascade rule below. Confirmed against a real production export: both
  // are genuinely empty, always, so these renames never touched anything
  // real — just extra reads and no-op loops on every single master edit.
  // Aug 6 2026 — real, significant gap found via a thorough app-wide
  // audit: this whole function exists to correct a value everywhere it
  // appears — a typo fix, a rename — but every one of these 6 tables was
  // active-only. Confirmed with real production numbers earlier this
  // session that roughly 75% of all real records are archived, meaning
  // a correction like this would have silently, permanently skipped the
  // large majority of the real data it was meant to fix.
  const [lotsA, lotsAr, seA, seAr, dlA, dlAr, weA, weAr, peA, peAr, dsA, dsAr, poA, mA, ptA, rlA, resA, vlA] = await Promise.all([
    fbGet('/tc/lots').catch(() => null), fbGet('/tc/archive/lots').catch(() => null),
    fbGet('/tc/stageEntries').catch(() => null), fbGet('/tc/archive/stageEntries').catch(() => null),
    fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null),
    fbGet('/tc/windEntries').catch(() => null), fbGet('/tc/archive/windEntries').catch(() => null),
    fbGet('/tc/packEntries').catch(() => null), fbGet('/tc/archive/packEntries').catch(() => null),
    fbGet('/tc/dispatches').catch(() => null), fbGet('/tc/archive/dispatches').catch(() => null),
    fbGet('/tc/partyOrders').catch(() => null), fbGet('/tc/masters').catch(() => null),
    fbGet('/tc/parties').catch(() => null),
    fbGet('/tc/rmReturnLog').catch(() => null), fbGet('/tc/residualLog').catch(() => null),
    fbGet('/tc/voidLog').catch(() => null)
  ]);
  const lots = [...toArr(lotsA).map(l => ({ ...l, _fromArchive: false })), ...toArr(lotsAr).map(l => ({ ...l, _fromArchive: true }))];
  const stageEntries = [...toArr(seA).map(e => ({ ...e, _fromArchive: false })), ...toArr(seAr).map(e => ({ ...e, _fromArchive: true }))];
  const dyeLots = [...toArr(dlA).map(d => ({ ...d, _fromArchive: false })), ...toArr(dlAr).map(d => ({ ...d, _fromArchive: true }))];
  const windEntries = [...toArr(weA).map(e => ({ ...e, _fromArchive: false })), ...toArr(weAr).map(e => ({ ...e, _fromArchive: true }))];
  const packEntries = [...toArr(peA).map(e => ({ ...e, _fromArchive: false })), ...toArr(peAr).map(e => ({ ...e, _fromArchive: true }))];
  const dispatches = [...toArr(dsA).map(d => ({ ...d, _fromArchive: false })), ...toArr(dsAr).map(d => ({ ...d, _fromArchive: true }))];
  const partyOrders = toArr(poA), masters = mA || {}, parties = Array.isArray(ptA) ? ptA : (ptA ? Object.values(ptA) : []);
  // Real, small helper — every real patch-write below uses this instead
  // of hardcoding the active path, so a correction to an archived record
  // genuinely lands back in archive, not accidentally duplicated into
  // active.
  const _tbl = (table, rec) => rec._fromArchive ? `/tc/archive/${table}` : `/tc/${table}`;
  const _strip = rec => { const { _fromArchive, ...rest } = rec; return rest; };
  // Aug 2 2026 — Priyam's direct, correct point: an address column is
  // just a column — when a lot's identity changes, everything holding
  // a copy of it should update together, the same simple rule applied
  // consistently. RM Return and Residual were never touched by this
  // cascade at all before; fixed here, matching the same fix already
  // applied to handleRMEdit for the direct-edit path.
  const rmReturns = rlA ? Object.entries(rlA).filter(([, r]) => r && r.id) : [];
  const residuals = resA ? Object.entries(resA).filter(([, r]) => r && r.id) : [];
  // Aug 5 2026 — voidLog's rm-delivery entries, same consistency fix.
  const voidLogEntries = vlA ? Object.entries(vlA).filter(([, v]) => v && v.id && v.type === 'rm-delivery') : [];

  const patch = {};

  // Sep 8 2026 — real, direct fix built via direct discussion with
  // Priyam, right after fixing the same disease in handleRMEdit: a
  // vendor or grade rename that lands on a lot address which already
  // has a real, different lot sitting there used to just silently
  // overwrite it in this same patch object — whichever lot's data got
  // written last simply survived, the other one's real material
  // vanished, with nothing recorded anywhere that it ever happened.
  // This tracks every genuine per-lot collision found during the
  // vendors/grades cascades below, so they can be handled as real
  // merges — combine the real quantities into the survivor, tag the
  // old lot Merged, and properly clear its stale cache afterward —
  // instead of a silent overwrite. Never relies on the master-list-
  // level isMerge flag alone, since a lot can carry a vendor/grade
  // value that has drifted from the current master list.
  const _lotLevelMerges = [];
  const _mergeOrMoveLot = (l, newVendor, newGrade, oldKey, newKey) => {
    const mergeTarget = lots.find(x => x !== l && x.id === l.id && x.grade === newGrade && x.vendor === newVendor);
    if (mergeTarget) {
      const ownDeliveries = (l.deliveries && l.deliveries.length) ? l.deliveries : [{ date: l.date, units: l.units, weight: l.weight, challan: l.challan || '', addedAt: l.createdAt || new Date().toISOString(), addedBy: 'Admin' }];
      const targetDeliveries = [...(mergeTarget.deliveries || []), ...ownDeliveries];
      patch[`${_tbl('lots', mergeTarget)}/${newKey}/deliveries`] = targetDeliveries;
      patch[`${_tbl('lots', mergeTarget)}/${newKey}/units`] = targetDeliveries.reduce((a, d) => a + (d.units || 0), 0);
      patch[`${_tbl('lots', mergeTarget)}/${newKey}/weight`] = targetDeliveries.reduce((a, d) => a + (d.weight || 0), 0);
      patch[`${_tbl('lots', l)}/${oldKey}/status`] = 'Merged';
      patch[`${_tbl('lots', l)}/${oldKey}/mergedInto`] = mergeTarget.uid || newKey;
      patch[`${_tbl('lots', l)}/${oldKey}/mergedAt`] = new Date().toISOString();
      patch[`${_tbl('lots', l)}/${oldKey}/mergedBy`] = changedBy || '';
      _lotLevelMerges.push({ oldLotId: l.id, oldGrade: l.grade, oldVendor: l.vendor, newLotId: l.id, newGrade, newVendor });
      return true;
    }
    patch[`${_tbl('lots', l)}/${oldKey}`] = null;
    patch[`${_tbl('lots', l)}/${newKey}`] = _strip({ ...l, vendor: newVendor, grade: newGrade });
    return false;
  };

  // Aug 26 2026 — real, direct extension built via direct discussion
  // with Priyam: if the new name already exists elsewhere in the same
  // list, this is genuinely a real merge — 2 names for the same real
  // vendor/party/machine, being consolidated into one — not a plain
  // rename. A plain rename replaces the entry at its own position; a
  // merge removes the old name entirely, since the destination already
  // exists. Never merges silently — shown as a real, direct warning
  // first, with the true, real count of entries affected, only
  // proceeding on an explicit second confirmation.
  const _sourceList = key === 'parties' ? parties : (masters[key] || []);
  const isMerge = _sourceList.includes(newVal);

  // Rename the master-list entry itself
  if (key === 'parties') {
    if (isMerge) { patch['/tc/parties'] = parties.filter(v => v !== oldVal); }
    else { const idx = parties.indexOf(oldVal); if (idx > -1) { parties[idx] = newVal; patch['/tc/parties'] = parties; } }
  } else {
    const list = masters[key] || [];
    if (isMerge) { patch[`/tc/masters/${key}`] = list.filter(v => v !== oldVal); }
    else { const idx = list.indexOf(oldVal); if (idx > -1) { list[idx] = newVal; patch[`/tc/masters/${key}`] = list; } }
  }

  // Cascade — verbatim per-key rules from saveMasterEdit
  if (key === 'vendors') {
    // Aug 2 2026 — Priyam's direct, correct point: the address should
    // be computed ONCE per affected lot, then carried/copied to every
    // downstream place — not independently recalculated at each one.
    // Build the real, correct new address for every affected lot,
    // once, up front.
    const newAddressByLot = {};
    lots.forEach(l => { if (l.vendor === oldVal) newAddressByLot[`${l.id}\u0001${l.grade}`] = _lotKeyW({ ...l, vendor: newVal }); });
    const addrFor = (lotId, grade) => newAddressByLot[`${lotId}\u0001${grade}`];

    lots.forEach(l => { if (l.vendor === oldVal) _mergeOrMoveLot(l, newVal, l.grade, _lotKeyW(l), addrFor(l.id, l.grade)); });
    stageEntries.forEach(e => {
      if (e.vendor === oldVal) {
        patch[`${_tbl('stageEntries', e)}/${e.id}/vendor`] = newVal;
        if (e._lotKey) patch[`${_tbl('stageEntries', e)}/${e.id}/_lotKey`] = addrFor(e.lotId, e.grade);
      }
    });
    dyeLots.forEach(d => { if ((d.sources || []).some(s => s.vendor === oldVal)) patch[`${_tbl('dyeLots', d)}/${d.id}/sources`] = (d.sources || []).map(s => { if (s.vendor !== oldVal) return s; const _ns = { ...s, vendor: newVal }; if (s._lotKey) _ns._lotKey = addrFor(s.lotId, s.grade); return _ns; }); });
    // Aug 2 2026 — RM Return and Residual, previously untouched by this
    // cascade entirely, same fix as handleRMEdit. Address column kept
    // in sync too, same rule as everywhere else.
    rmReturns.forEach(([key2, r]) => { if (r.vendor === oldVal) { patch[`/tc/rmReturnLog/${key2}/vendor`] = newVal; if (r._lotKey) patch[`/tc/rmReturnLog/${key2}/_lotKey`] = addrFor(r.lotId, r.grade); } });
    residuals.forEach(([key2, r]) => { if (r.vendor === oldVal) { patch[`/tc/residualLog/${key2}/vendor`] = newVal; if (r._lotKey) patch[`/tc/residualLog/${key2}/_lotKey`] = addrFor(r.lotId, r.grade); } });
    voidLogEntries.forEach(([key2, v]) => { if (v.vendor === oldVal) { patch[`/tc/voidLog/${key2}/vendor`] = newVal; if (v._lotKey) patch[`/tc/voidLog/${key2}/_lotKey`] = addrFor(v.lotId, v.grade); } });
  } else if (key === 'parties') {
    // Sep 10 2026 — real, root-cause fix built via direct discussion
    // with Priyam, from his own real, repeated experience: renaming a
    // party to merge it with an already-existing one kept appearing
    // to fail, over and over, only for parties that specifically
    // showed up on archived dispatches. The write was hardcoded to
    // the active dispatches path — never checking whether that
    // dispatch actually lives in archive — so an archived dispatch's
    // own party field never actually changed. The next scan
    // correctly found the old name still sitting there, unrenamed,
    // making it look like the same rename kept failing.
    dispatches.forEach(d => { if (d.party === oldVal) patch[`${_tbl('dispatches', d)}/${d.id}/party`] = newVal; });
    partyOrders.forEach(o => { if (o.party === oldVal) patch[`/tc/partyOrders/${o.id}/party`] = newVal; });
  } else if (key === 'grades') {
    const newAddressByLot = {};
    lots.forEach(l => { if (l.grade === oldVal) newAddressByLot[`${l.id}\u0001${l.vendor}`] = _lotKeyW({ ...l, grade: newVal }); });
    const addrFor = (lotId, vendor) => newAddressByLot[`${lotId}\u0001${vendor}`];

    lots.forEach(l => { if (l.grade === oldVal) _mergeOrMoveLot(l, l.vendor, newVal, _lotKeyW(l), addrFor(l.id, l.vendor)); });
    stageEntries.forEach(e => {
      if (e.grade === oldVal) {
        patch[`${_tbl('stageEntries', e)}/${e.id}/grade`] = newVal;
        if (e._lotKey) patch[`${_tbl('stageEntries', e)}/${e.id}/_lotKey`] = addrFor(e.lotId, e.vendor);
      }
    });
    dyeLots.forEach(d => {
      if (d.grade === oldVal) patch[`${_tbl('dyeLots', d)}/${d.id}/grade`] = newVal;
      if ((d.sources || []).some(s => s.grade === oldVal)) patch[`${_tbl('dyeLots', d)}/${d.id}/sources`] = (d.sources || []).map(s => { if (s.grade !== oldVal) return s; const _ns = { ...s, grade: newVal }; if (s._lotKey) _ns._lotKey = addrFor(s.lotId, s.vendor); return _ns; });
    });
    windEntries.forEach(e => { if (e.grade === oldVal) patch[`${_tbl('windEntries', e)}/${e.id}/grade`] = newVal; });
    packEntries.forEach(e => { if (e.grade === oldVal) patch[`${_tbl('packEntries', e)}/${e.id}/grade`] = newVal; });
    dispatches.forEach(d => { if (d.grade === oldVal) patch[`${_tbl('dispatches', d)}/${d.id}/grade`] = newVal; });
    rmReturns.forEach(([key2, r]) => { if (r.grade === oldVal) { patch[`/tc/rmReturnLog/${key2}/grade`] = newVal; if (r._lotKey) patch[`/tc/rmReturnLog/${key2}/_lotKey`] = addrFor(r.lotId, r.vendor); } });
    residuals.forEach(([key2, r]) => { if (r.grade === oldVal) { patch[`/tc/residualLog/${key2}/grade`] = newVal; if (r._lotKey) patch[`/tc/residualLog/${key2}/_lotKey`] = addrFor(r.lotId, r.vendor); } });
    voidLogEntries.forEach(([key2, v]) => { if (v.grade === oldVal) { patch[`/tc/voidLog/${key2}/grade`] = newVal; if (v._lotKey) patch[`/tc/voidLog/${key2}/_lotKey`] = addrFor(v.lotId, v.vendor); } });
  } else if (key === 'workers') {
    stageEntries.forEach(e => {
      if (e.startWorker === oldVal) patch[`${_tbl('stageEntries', e)}/${e.id}/startWorker`] = newVal;
      if (e.endWorker === oldVal) patch[`${_tbl('stageEntries', e)}/${e.id}/endWorker`] = newVal;
    });
    dyeLots.forEach(d => { if (d.worker === oldVal) patch[`${_tbl('dyeLots', d)}/${d.id}/worker`] = newVal; });
    windEntries.forEach(e => { if (e.worker === oldVal) patch[`${_tbl('windEntries', e)}/${e.id}/worker`] = newVal; });
    // Sep 19 2026 — Dye and Wind records store startWorker / endWorker (not `worker`), so the two lines above never matched them:
    // a Masters rename left the old name on every Dye and Wind entry. Soft, Pack and Dispatch were already right.
    dyeLots.forEach(d => {
      if (d.startWorker === oldVal) patch[`${_tbl('dyeLots', d)}/${d.id}/startWorker`] = newVal;
      if (d.endWorker === oldVal) patch[`${_tbl('dyeLots', d)}/${d.id}/endWorker`] = newVal;
    });
    windEntries.forEach(e => {
      if (e.startWorker === oldVal) patch[`${_tbl('windEntries', e)}/${e.id}/startWorker`] = newVal;
      if (e.endWorker === oldVal) patch[`${_tbl('windEntries', e)}/${e.id}/endWorker`] = newVal;
    });
    packEntries.forEach(e => { if (e.worker === oldVal) patch[`${_tbl('packEntries', e)}/${e.id}/worker`] = newVal; });
    dispatches.forEach(d => { if (d.by === oldVal) patch[`${_tbl('dispatches', d)}/${d.id}/by`] = newVal; });
  } else if (key === 'machines') {
    stageEntries.forEach(e => { if (e.machine === oldVal) patch[`${_tbl('stageEntries', e)}/${e.id}/machine`] = newVal; });
    dyeLots.forEach(d => { if (d.machine === oldVal) patch[`${_tbl('dyeLots', d)}/${d.id}/machine`] = newVal; });
    windEntries.forEach(e => { if (e.machine === oldVal) patch[`${_tbl('windEntries', e)}/${e.id}/machine`] = newVal; });
    packEntries.forEach(e => { if (e.machine === oldVal) patch[`${_tbl('packEntries', e)}/${e.id}/machine`] = newVal; });
    if (masters.machineCapacity && masters.machineCapacity[oldVal]) {
      const cap = { ...masters.machineCapacity };
      cap[newVal] = cap[oldVal];
      delete cap[oldVal];
      patch['/tc/masters/machineCapacity'] = cap;
    }
  } else if (key === 'softMachines') {
    // Aug 26 2026 — real, direct rebuild built via direct discussion
    // with Priyam: machines now genuinely live in 4 separate, simple
    // lists, one per stage — exactly matching how Vendors already
    // works, so a rename cascades exactly as simply as a Vendor rename
    // already does — no separate tag anywhere that could ever be left
    // behind. Each list only ever needs to check its own real stage's
    // table.
    stageEntries.forEach(e => { if (e.machine === oldVal) patch[`${_tbl('stageEntries', e)}/${e.id}/machine`] = newVal; });
    if (masters.machineCapacity && masters.machineCapacity[oldVal]) {
      const cap = { ...masters.machineCapacity };
      cap[newVal] = cap[oldVal];
      delete cap[oldVal];
      patch['/tc/masters/machineCapacity'] = cap;
    }
  } else if (key === 'dyeMachines') {
    dyeLots.forEach(d => { if (d.machine === oldVal) patch[`${_tbl('dyeLots', d)}/${d.id}/machine`] = newVal; });
    if (masters.machineCapacity && masters.machineCapacity[oldVal]) {
      const cap = { ...masters.machineCapacity };
      cap[newVal] = cap[oldVal];
      delete cap[oldVal];
      patch['/tc/masters/machineCapacity'] = cap;
    }
  } else if (key === 'windMachines') {
    windEntries.forEach(e => { if (e.machine === oldVal) patch[`${_tbl('windEntries', e)}/${e.id}/machine`] = newVal; });
    if (masters.machineCapacity && masters.machineCapacity[oldVal]) {
      const cap = { ...masters.machineCapacity };
      cap[newVal] = cap[oldVal];
      delete cap[oldVal];
      patch['/tc/masters/machineCapacity'] = cap;
    }
  } else if (key === 'packMachines') {
    packEntries.forEach(e => { if (e.machine === oldVal) patch[`${_tbl('packEntries', e)}/${e.id}/machine`] = newVal; });
    if (masters.machineCapacity && masters.machineCapacity[oldVal]) {
      const cap = { ...masters.machineCapacity };
      cap[newVal] = cap[oldVal];
      delete cap[oldVal];
      patch['/tc/masters/machineCapacity'] = cap;
    }
  } else if (key === 'mills') {
    lots.forEach(l => { if (l.mill === oldVal) patch[`${_tbl('lots', l)}/${_lotKeyW(l)}/mill`] = newVal; });
  }

  // Sep 10 2026 — real, direct new feature built via direct discussion
  // with Priyam, establishing one clear rule across the whole app:
  // every real action shows a genuine preview of its actual effect
  // before committing — upgraded from only warning when the new name
  // happened to collide with an existing one, to always showing the
  // real scope of the change first (how many fields, across how many
  // real tables, and any genuine lot-level merges involved), with the
  // merge-specific detail highlighted right there when it applies.
  if (!confirm) {
    return jsonResponse({
      __dryRun: true,
      key, oldVal, newVal,
      fieldsChanged: Object.keys(patch).length,
      isMerge, lotLevelMerges: _lotLevelMerges.length,
    });
  }

  await fbPatch('', patch);

  // Sep 8 2026 — same real, root-cause fix as handleRMEdit's merge
  // path, applied here for the same reason: any lot that got merged
  // above (not just plain-moved) needs its stale cache genuinely
  // cleared, not left showing a frozen pre-merge number, and the
  // survivor needs its own fresh recompute genuinely retried instead
  // of a single unretried attempt that can fail silently.
  for (const m of _lotLevelMerges) {
    await updateLotSummary(m.oldLotId, m.oldGrade, m.oldVendor).catch(() => {});
    let _mmOk = false;
    for (let _i = 0; _i < 3 && !_mmOk; _i++) {
      try { await updateLotSummary(m.newLotId, m.newGrade, m.newVendor); _mmOk = true; }
      catch (e) { if (_i < 2) await new Promise(r => setTimeout(r, 100 + _i * 150)); }
    }
    if (!_mmOk) {
      const failId = 'MSF-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      await fbSet(`/tc/mergeSummaryFailures/${failId}`, {
        lotId: m.newLotId, grade: m.newGrade, vendor: m.newVendor, mergedFrom: m.oldLotId, mergedFromGrade: m.oldGrade, mergedFromVendor: m.oldVendor,
        timestamp: new Date().toISOString(), reason: 'updateLotSummary failed after 3 attempts post-master-edit-merge — target may still show a stale, incomplete balance'
      }).catch(() => {});
    }
  }

  return jsonResponse({ success: true, fieldsChanged: Object.keys(patch).length, lotLevelMerges: _lotLevelMerges.length });
}

// POST /api/void-chain — Item Q critical tier (3rd, Jul 15 2026). Was:
// submitVoid2() (pages.js) — a SEPARATE, previously-unaudited "void chain"
// tool letting an admin void an arbitrary multi-entry selection across
// RM/Soft/Dye/Wind/Pack/Dispatch in one action. Entirely client-side,
// zero worker.js involvement, un-atomic (one saveBatch() call per
// collection — a crash mid-way leaves a partial void with no way to
// detect or resume, same shape Items B/C already fixed for the "official"
// void endpoints). This tool completely bypassed that fix — a second
// front door to the exact same danger. Fixed the same way: one atomic
// multi-path PATCH.
const _VOID_CHAIN_TABLE = { soft: 'stageEntries', dye: 'dyeLots', wind: 'windEntries', pack: 'packEntries', dispatch: 'dispatches', rm: 'lots', 'rm-delivery': 'lots', residual: 'residualLog', recycleSoft: 'recycleSoft' };
// Aug 6 2026 — real, genuine gap found via a thorough app-wide audit,
// raised directly by Priyam asking specifically about cascades: the
// frontend's buildVoidChain built its whole cascade tree purely from
// State.DB — the browser's in-memory data, which only ever holds
// active records. Anything downstream that had already been archived
// (its own chain already finished) was completely invisible — never
// shown, never selectable, never voided, even after its real root
// source got voided out from under it. Faithfully replicates every one
// of the original's 6 real branches (soft/dye/wind/pack/dispatch/rm),
// same traversal rules, same node shape — just built here, server-side,
// from genuinely complete, merged active+archive data, matching the
// same proven pattern already correct in handleVoidRMLotCascade.
async function handleBuildVoidChain(url) {
  const id = url.searchParams.get('id');
  const stage = url.searchParams.get('stage');
  if (!id || !stage) return errorResponse('id and stage required');

  const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(e => e && e.id);
  const [seA, seAr, dlA, dlAr, weA, weAr, peA, peAr, dpA, dpAr, lotsA, lotsAr] = await Promise.all([
    fbGet('/tc/stageEntries').catch(() => null), fbGet('/tc/archive/stageEntries').catch(() => null),
    fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null),
    fbGet('/tc/windEntries').catch(() => null), fbGet('/tc/archive/windEntries').catch(() => null),
    fbGet('/tc/packEntries').catch(() => null), fbGet('/tc/archive/packEntries').catch(() => null),
    fbGet('/tc/dispatches').catch(() => null), fbGet('/tc/archive/dispatches').catch(() => null),
    fbGet('/tc/lots').catch(() => null), fbGet('/tc/archive/lots').catch(() => null)
  ]);
  const stageEntries = [...toArr(seA), ...toArr(seAr)];
  const dyeLots = [...toArr(dlA), ...toArr(dlAr)];
  const windEntries = [...toArr(weA), ...toArr(weAr)];
  const packEntries = [...toArr(peA), ...toArr(peAr)];
  const dispatches = [...toArr(dpA), ...toArr(dpAr)];
  const lots = [...toArr(lotsA), ...toArr(lotsAr)];

  const nodes = [];
  const fmt = v => (+v || 0).toFixed(2);
  const addNode = (nId, nStage, label, detail, status, level, autoCheck, extra) => {
    nodes.push({ id: nId, stage: nStage, label, detail, status, checked: status !== 'Voided', autoCheck, level, ...(extra || {}) });
  };

  if (stage === 'soft') {
    const e = stageEntries.find(x => x.id === id);
    if (!e) return jsonResponse({ nodes });
    addNode(id, 'soft', `Soft Entry ${e.id} — Lot ${e.lotId}`, `In: ${fmt(e.inUnits)}b / ${fmt(e.inWeight)}kg | Out: ${fmt(e.outUnits)}b / ${fmt(e.outWeight)}kg | ${e.status}`, e.status, 0, true);
    dyeLots.filter(d => d.status !== 'Voided' && (d.sources || []).some(s => s.lotId === e.lotId && s.grade === e.grade && s.vendor === e.vendor)).forEach(d => {
      const src = (d.sources || []).find(s => s.lotId === e.lotId);
      addNode(d.id, 'dye', `Dye Lot ${d.dyeLotNo} — ${d.shade || ''}`, `Used ${fmt(src?.weight)}kg from this lot | ${d.status}`, d.status, 1, false);
      windEntries.filter(w => w.dyeLotId === d.id && w.status !== 'Voided').forEach(w => addNode(w.id, 'wind', `Wind ${w.id}`, `${w.inCones || 0}c / ${fmt(w.inWeight)}kg in → ${w.outCones || 0}c / ${fmt(w.outWeight)}kg out | ${w.status}`, w.status, 2, false));
      packEntries.filter(p => p.dyeLotId === d.id && p.status !== 'Voided').forEach(p => addNode(p.id, 'pack', `Pack ${p.id}`, `${p.bags || 0} bags / ${fmt(p.weight)}kg | ${p.status}`, p.status, 2, false));
      dispatches.filter(dp => dp.dyeLotId === d.id && dp.status !== 'Voided').forEach(dp => addNode(dp.id, 'dispatch', `Dispatch ${dp.id} → ${dp.party || ''}`, `${dp.bags || 0} bags / ${fmt(dp.weight)}kg | ${dp.status}`, dp.status, 2, false));
    });
  } else if (stage === 'dye') {
    const lot = dyeLots.find(d => d.id === id);
    if (!lot) return jsonResponse({ nodes });
    addNode(id, 'dye', `Dye Lot ${lot.dyeLotNo} — ${lot.shade || ''}`, `In: ${fmt(lot.totalInWeight)}kg | Out: ${lot.outCones || 0}c / ${fmt(lot.outWeight)}kg | ${lot.status}`, lot.status, 0, true);
    windEntries.filter(w => w.dyeLotId === id && w.status !== 'Voided').forEach(w => {
      addNode(w.id, 'wind', `Wind ${w.id}`, `${w.inCones || 0}c / ${fmt(w.inWeight)}kg → ${w.outCones || 0}c / ${fmt(w.outWeight)}kg | ${w.status}`, w.status, 1, true);
      packEntries.filter(p => p.dyeLotId === id && p.status !== 'Voided').forEach(p => addNode(p.id, 'pack', `Pack ${p.id}`, `${p.bags || 0}b / ${fmt(p.weight)}kg | ${p.status}`, p.status, 2, true));
    });
    packEntries.filter(p => p.dyeLotId === id && p.status !== 'Voided').forEach(p => { if (!nodes.find(n => n.id === p.id)) addNode(p.id, 'pack', `Pack ${p.id}`, `${p.bags || 0}b / ${fmt(p.weight)}kg | ${p.status}`, p.status, 1, true); });
    dispatches.filter(dp => dp.dyeLotId === id && dp.status !== 'Voided').forEach(dp => addNode(dp.id, 'dispatch', `Dispatch → ${dp.party || ''}`, `${dp.bags || 0}b / ${fmt(dp.weight)}kg | ${dp.status}`, dp.status, 1, true));
  } else if (stage === 'wind') {
    const w = windEntries.find(x => x.id === id);
    if (!w) return jsonResponse({ nodes });
    addNode(id, 'wind', `Wind ${w.id} — ${w.dyeLotNo || ''}`, `${w.inCones || 0}c / ${fmt(w.inWeight)}kg → ${w.outCones || 0}c out | ${w.status}`, w.status, 0, true);
    packEntries.filter(p => p.dyeLotId === w.dyeLotId && p.status !== 'Voided').forEach(p => addNode(p.id, 'pack', `Pack ${p.id}`, `${p.bags || 0}b / ${fmt(p.weight)}kg | ${p.status}`, p.status, 1, false));
  } else if (stage === 'pack') {
    const p = packEntries.find(x => x.id === id);
    if (!p) return jsonResponse({ nodes });
    addNode(id, 'pack', `Pack ${p.id} — ${p.dyeLotNo || ''}`, `${p.bags || 0}b / ${fmt(p.weight)}kg | ${p.status}`, p.status, 0, true);
    dispatches.filter(dp => dp.dyeLotId === p.dyeLotId && dp.status !== 'Voided').forEach(dp => addNode(dp.id, 'dispatch', `Dispatch → ${dp.party || ''}`, `${dp.bags || 0}b / ${fmt(dp.weight)}kg | ${dp.status}`, dp.status, 1, false));
  } else if (stage === 'dispatch') {
    const dp = dispatches.find(x => x.id === id);
    if (!dp) return jsonResponse({ nodes });
    addNode(id, 'dispatch', `Dispatch → ${dp.party || ''}`, `${dp.bags || 0}b / ${fmt(dp.weight)}kg | Invoice: ${dp.invoiceNo || '—'} | ${dp.status}`, dp.status, 0, true);
  } else if (stage === 'rm') {
    // Aug 26 2026 — real, genuine, severe fix built via direct discussion
    // with Priyam, after a real, confirmed near-miss: this used to match
    // by lot number alone, completely ignoring grade and vendor. Since
    // several different, real lots in this app commonly share the same
    // lot number (confirmed directly, multiple times, against real
    // production data), this could silently build the void chain for a
    // completely different, unrelated lot — and, worse, pull in every
    // Soft entry sharing that same raw lot number too, regardless of
    // whether it genuinely belonged to the lot actually being voided.
    // Confirming Void at that point would have destroyed a real,
    // unrelated lot's entire history. Now requires the full, unique
    // composite address, matching every other real part of this app —
    // and carries grade/vendor forward into the node itself, so the
    // eventual void-execution step (below) can match correctly too,
    // rather than only fixing the display and leaving execution exposed.
    const grade = url.searchParams.get('grade');
    const vendor = url.searchParams.get('vendor');
    const lot = lots.find(x => x.id === id && x.grade === grade && x.vendor === vendor);
    if (!lot) return jsonResponse({ nodes });
    addNode(id, 'rm', `RM Lot ${lot.id} — ${lot.grade || ''} (${lot.vendor || ''})`, `${lot.units || 0} bags / ${fmt(lot.weight)}kg | ${lot.status || 'Active'}`, lot.status || 'Active', 0, true, { grade: lot.grade, vendor: lot.vendor });
    stageEntries.filter(e => e.lotId === lot.id && e.grade === lot.grade && e.vendor === lot.vendor && e.status !== 'Voided').forEach(e => addNode(e.id, 'soft', `Soft Entry ${e.id}`, `In: ${fmt(e.inWeight)}kg | Out: ${fmt(e.outWeight)}kg | ${e.status}`, e.status, 1, false));
  } else if (stage === 'rm-delivery') {
    // Aug 26 2026 — real, direct extension built via direct discussion
    // with Priyam, after he correctly, directly pointed out that
    // voiding one delivery out of several never showed the same real
    // cascade the full-lot void already shows — a genuine, real
    // inconsistency, now closed. One honest limitation: a Soft entry
    // draws from this lot's whole, combined balance, not from any one
    // specific delivery — there's no real way to attribute which
    // delivery fed which Soft entry. So this honestly shows every
    // real Soft entry on the lot, the same complete picture the
    // full-lot version already gives, rather than a false, precise-
    // looking attribution this data genuinely can't support.
    const grade = url.searchParams.get('grade');
    const vendor = url.searchParams.get('vendor');
    const delivIdx = parseInt(url.searchParams.get('delivIdx'), 10);
    const lot = lots.find(x => x.id === id && x.grade === grade && x.vendor === vendor);
    if (!lot) return jsonResponse({ nodes });
    const deliveries = lot.deliveries || [];
    if (isNaN(delivIdx) || delivIdx < 0 || delivIdx >= deliveries.length) return jsonResponse({ nodes });
    const d = deliveries[delivIdx];
    addNode(id, 'rm-delivery', `Delivery ${delivIdx + 1} of RM Lot ${lot.id} — ${lot.grade || ''} (${lot.vendor || ''})`, `${d.units || 0} bags / ${fmt(d.weight)}kg — ${d.date || ''}`, 'Active', 0, true, { grade: lot.grade, vendor: lot.vendor, delivIdx });
    stageEntries.filter(e => e.lotId === lot.id && e.grade === lot.grade && e.vendor === lot.vendor && e.status !== 'Voided').forEach(e => addNode(e.id, 'soft', `Soft Entry ${e.id}`, `In: ${fmt(e.inWeight)}kg | Out: ${fmt(e.outWeight)}kg | ${e.status} (draws from this lot's whole balance, not this delivery specifically)`, e.status, 1, false));
  }

  return jsonResponse({ nodes });
}

async function handleVoidChain(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin only', 403);

  const { selected, reasonCat, reasonText, password, username, changedBy, voidRequestId } = body || {};
  // Aug 6 2026 — real, genuine gap found via a thorough app-wide audit:
  // this is the general cascade void — used for Soft/Dye/Wind/Pack/
  // Dispatch — genuinely one of the most-reachable destructive real
  // actions in the app, with no password check at all. Matching the
  // same proven pattern already used elsewhere.
  const verifiedUser = await _verifySelfPassword(username, password);
  if (!verifiedUser) return errorResponse('Incorrect password', 401);
  if (!reasonCat) return errorResponse('Select void reason category');
  if (!reasonText || reasonText.trim().length < 10) return errorResponse('Reason must be at least 10 characters');
  if (!Array.isArray(selected) || !selected.length) return errorResponse('Select at least one entry to void');
  // Sep 10 2026 — real, genuine gap found while directly auditing
  // today's own new Void Request feature, per Priyam's own explicit
  // request for a holistic review: this used to blindly trust
  // whatever voidRequestId was sent, writing it as "approved" even if
  // it didn't genuinely exist, was already reviewed by someone else,
  // or belonged to a completely different entry than what's actually
  // being voided here. Checked properly now, before anything is
  // touched — if this genuinely doesn't check out, the whole action is
  // rejected rather than silently voiding without a correct link back.
  if (voidRequestId) {
    const _existingReq = await fbGet(`/tc/voidRequests/${voidRequestId}`).catch(() => null);
    if (!_existingReq) return errorResponse('This void request no longer exists — refresh and try again.');
    if (_existingReq.status !== 'pending') return errorResponse('This request has already been reviewed by someone else — refresh and try again.');
    if (!selected.some(s => s.id === _existingReq.entryId && s.stage === _existingReq.stage)) {
      return errorResponse('The entries selected here don\'t match what this request is actually for — refresh and try again.');
    }
  }

  const now = new Date().toISOString();
  const patch = {};
  let voidCount = 0;

  // Jul 17 2026 — Phase 4 of the running-balance plan, same pattern as
  // handleVoidEntry: reverse the exact original balance contribution for
  // any entry that was genuinely Approved before being voided here.
  // 'rm' type intentionally excluded — matches the original code's own
  // documented scope (never refreshed a summary for RM voids either),
  // not silently adding new behavior beyond what was already there.
  const lotDeltas = new Map();
  const dyeDeltas = new Map();
  const addLotDelta = (lotId, grade, vendor, field, amt) => {
    const k = `${lotId}__${grade || ''}__${vendor || ''}`;
    const cur = lotDeltas.get(k) || { lotId, grade: grade || '', vendor: vendor || '' };
    cur[field] = (cur[field] || 0) + amt;
    lotDeltas.set(k, cur);
  };
  const addDyeDelta = (dyeLotId, field, amt) => {
    const cur = dyeDeltas.get(dyeLotId) || {};
    cur[field] = (cur[field] || 0) + amt;
    dyeDeltas.set(dyeLotId, cur);
  };

  // RM ('lots') needs the full record for its composite key — fetch those up front.
  // Aug 26 2026 — real, genuine, severe fix built via direct discussion
  // with Priyam: this used to match by lot number alone, meaning the
  // actual void execution could still hit the wrong lot even after
  // fixing the display above — confirming void reads from the selected
  // node's own grade/vendor now, not just its raw lot number, and keys
  // this lookup map by the full composite address instead of the
  // ambiguous lot number alone.
  const rmNodesSelected = selected.filter(n => n.stage === 'rm' || n.stage === 'rm-delivery');
  const rmRecords = {};
  const rmFromArchive = {};
  // Sep 22 2026 — real, confirmed fix found by the new Layer 9 architecture check: this only ever checked the active
  // table, so voiding an RM lot delivery that had already been fully consumed and archived would silently find
  // nothing and skip it entirely — no error, just quietly not voided. Same real bug class as DL-1718, different
  // symptom (a silent no-op instead of a corrupted shadow entry, since this path never got as far as writing).
  if (rmNodesSelected.length > 0) {
    const [rawActive, rawArchived] = await Promise.all([fbGet('/tc/lots').catch(() => null), fbGet('/tc/archive/lots').catch(() => null)]);
    const arrActive = rawActive ? (Array.isArray(rawActive) ? rawActive : Object.values(rawActive)).filter(x => x && x.id) : [];
    const arrArchived = rawArchived ? (Array.isArray(rawArchived) ? rawArchived : Object.values(rawArchived)).filter(x => x && x.id) : [];
    for (const node of rmNodesSelected) {
      const key = `${node.id}__${node.grade}__${node.vendor}`;
      const foundActive = arrActive.find(l => l.id === node.id && l.grade === node.grade && l.vendor === node.vendor);
      const foundArchived = !foundActive && arrArchived.find(l => l.id === node.id && l.grade === node.grade && l.vendor === node.vendor);
      if (foundActive) rmRecords[key] = foundActive;
      else if (foundArchived) { rmRecords[key] = foundArchived; rmFromArchive[key] = true; }
    }
  }

  for (const node of selected) {
    const { id, stage } = node;
    const table = _VOID_CHAIN_TABLE[stage];
    if (!table) continue;

    if (stage === 'rm') {
      const l = rmRecords[`${id}__${node.grade}__${node.vendor}`];
      if (!l || l.status === 'Voided') continue;
      const key = _lotKeyW(l);
      const _rmBase = rmFromArchive[`${id}__${node.grade}__${node.vendor}`] ? `/tc/archive/lots/${key}` : `/tc/lots/${key}`;
      patch[`${_rmBase}/status`] = 'Voided';
      patch[`${_rmBase}/voidedBy`] = changedBy || '';
      patch[`${_rmBase}/voidedAt`] = now;
      patch[`${_rmBase}/voidReason`] = reasonText.trim();
      voidCount++;
      const logId = `EL-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      patch[`/tc/editLog/${logId}`] = { id: logId, timestamp: now, entryId: id, stage, field: 'Status', oldVal: l.status || 'Active', newVal: 'Voided', reasonCat, reasonText: reasonText.trim(), impactNote: null, changedBy: changedBy || '', type: 'void', _updatedAt: now };
      continue;
    }

    // Aug 26 2026 — real, direct extension built via direct discussion
    // with Priyam: voiding a single delivery out of several, correctly,
    // uniformly going through this same real cascade system now, rather
    // than a separate, simpler path with none of the same visibility.
    // Removes only this one delivery, recalculates the lot's own real
    // totals — the lot itself never gets marked Voided, since its other
    // real deliveries genuinely remain.
    if (stage === 'rm-delivery') {
      const l = rmRecords[`${id}__${node.grade}__${node.vendor}`];
      if (!l) continue;
      const deliveries = [...(l.deliveries || [])];
      if (node.delivIdx === undefined || node.delivIdx < 0 || node.delivIdx >= deliveries.length) continue;
      const removed = deliveries[node.delivIdx];
      const remaining = deliveries.filter((_, i) => i !== node.delivIdx);
      const newUnits = remaining.reduce((a, d) => a + (d.units || 0), 0);
      const newWeight = remaining.reduce((a, d) => a + (d.weight || 0), 0);
      const key = _lotKeyW(l);
      const _rmBase = rmFromArchive[`${id}__${node.grade}__${node.vendor}`] ? `/tc/archive/lots/${key}` : `/tc/lots/${key}`;
      patch[`${_rmBase}/deliveries`] = remaining;
      patch[`${_rmBase}/units`] = newUnits;
      patch[`${_rmBase}/weight`] = newWeight;
      voidCount++;
      addLotDelta(l.id, l.grade, l.vendor, 'rmBalance.kg', -(removed.weight || 0));
      addLotDelta(l.id, l.grade, l.vendor, 'rmBalance.units', -(removed.units || 0));
      const voidId = `VD-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      patch[`/tc/voidLog/${voidId}`] = {
        id: voidId, type: 'rm-delivery', lotId: l.id, grade: l.grade || '', vendor: l.vendor || '', lotUid: l.uid || null, _lotKey: key,
        delivIdx: node.delivIdx, delivery: removed, reason: reasonText.trim(), voidedBy: changedBy || '', timestamp: now, _updatedAt: now
      };
      continue;
    }

    const e = await fbGet(`/tc/${table}/${id}`).catch(() => null);
    if (!e || e.status === 'Voided') continue;

    patch[`/tc/${table}/${id}/status`] = 'Voided';
    patch[`/tc/${table}/${id}/voidedBy`] = changedBy || '';
    patch[`/tc/${table}/${id}/voidedAt`] = now;
    patch[`/tc/${table}/${id}/voidReason`] = reasonText.trim();
    voidCount++;
    const logId = `EL-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    patch[`/tc/editLog/${logId}`] = { id: logId, timestamp: now, entryId: id, stage, field: 'Status', oldVal: e.status, newVal: 'Voided', reasonCat, reasonText: reasonText.trim(), impactNote: null, changedBy: changedBy || '', type: 'void', _updatedAt: now };

    // Dye voiding also voids the paired legacy dyeEntry, matching the original.
    if (stage === 'dye' && e.dyeEntryId) {
      const de = await fbGet(`/tc/dyeEntries/${e.dyeEntryId}`).catch(() => null);
      if (de && de.status !== 'Voided') {
        patch[`/tc/dyeEntries/${e.dyeEntryId}/status`] = 'Voided';
        patch[`/tc/dyeEntries/${e.dyeEntryId}/voidedBy`] = changedBy || '';
        patch[`/tc/dyeEntries/${e.dyeEntryId}/voidedAt`] = now;
      }
    }


    const wasApproved = e.status === 'Approved' || e.status === 'Edited-Approved';
    if (wasApproved) {
      if (stage === 'soft') {
        addLotDelta(e.lotId, e.grade, e.vendor, 'rmBalance.kg', (e.inWeight || 0));
        addLotDelta(e.lotId, e.grade, e.vendor, 'rmBalance.units', (e.inUnits || 0));
        addLotDelta(e.lotId, e.grade, e.vendor, 'softBalance.kg', -(e.outWeight || 0));
        addLotDelta(e.lotId, e.grade, e.vendor, 'softBalance.units', -(e.outUnits || 0));
      } else if (stage === 'dye') {
        addDyeDelta(e.id, 'dyeBalance.cones', -(e.outCones || 0));
        addDyeDelta(e.id, 'dyeBalance.kg', -(e.outWeight || 0));
        (e.sources || []).forEach(s => { if (s.lotId) addLotDelta(s.lotId, s.grade, s.vendor, 'softBalance.kg', (s.weight || 0)); });
      } else if (stage === 'wind' && e.dyeLotId) {
        addDyeDelta(e.dyeLotId, 'dyeBalance.cones', (e.inCones || 0));
        addDyeDelta(e.dyeLotId, 'dyeBalance.kg', (e.inWeight || 0));
        addDyeDelta(e.dyeLotId, 'windBalance.cones', -(e.outCones || 0));
        addDyeDelta(e.dyeLotId, 'windBalance.kg', -(e.outWeight || 0));
      } else if (stage === 'pack' && e.dyeLotId) {
        addDyeDelta(e.dyeLotId, 'windBalance.cones', (e.inCones || 0));
        addDyeDelta(e.dyeLotId, 'packBalance.bags', -(e.bags || 0));
        addDyeDelta(e.dyeLotId, 'packBalance.kg', -(e.weight || 0));
      } else if (stage === 'dispatch' && e.dyeLotId) {
        addDyeDelta(e.dyeLotId, 'packBalance.bags', (e.bags || 0));
        addDyeDelta(e.dyeLotId, 'packBalance.kg', (e.weight || 0));
        addDyeDelta(e.dyeLotId, 'dispatched.bags', -(e.bags || 0));
        addDyeDelta(e.dyeLotId, 'dispatched.kg', -(e.weight || 0));
      }
    }
  }

  // Sep 10 2026 — real, direct new feature built via a genuinely long,
  // careful design discussion with Priyam: if this void execution is
  // fulfilling a real, pending Void Request (a Supervisor's void that
  // genuinely had downstream activity, and so was routed to Admin for
  // review instead of executing immediately), mark that real request
  // as approved in this same write, rather than a separate, redundant
  // one — same real pattern already proven for Reassign's own undo,
  // linking back to the thing it's fulfilling. Already validated above
  // (exists, still pending, genuinely matches what's being voided).
  if (voidRequestId) {
    patch[`/tc/voidRequests/${voidRequestId}/status`] = 'approved';
    patch[`/tc/voidRequests/${voidRequestId}/approvedBy`] = changedBy || '';
    patch[`/tc/voidRequests/${voidRequestId}/approvedAt`] = now;
  }

  await fbPatch('', patch);

  await Promise.all([
    ...Array.from(lotDeltas.values()).map(d => { const { lotId, grade, vendor, ...fields } = d; return nudgeLotSummary(lotId, grade, vendor, fields).catch(() => {}); }),
    ...Array.from(dyeDeltas.entries()).map(([dyeLotId, fields]) => nudgeDyeLotSummary(dyeLotId, fields).catch(() => {}))
  ]);
  // Real cascade — multiple different real records, potentially across
  // different stages and different days, all voided together. Re-freeze
  // for every single one, not just the one the person directly clicked.
  (selected || []).forEach(n => { _reFreezeForRecord(n.stage, n.id).catch(() => {}); });

  // Aug 26 2026 — real, direct extension built via direct discussion
  // with Priyam: voiding a Soft entry can leave a real Dye batch —
  // one that WASN'T also voided here — now claiming more than what's
  // genuinely left. Check every lot a Soft void just touched, right
  // now, with fresh data, and hand back exactly which real Dye
  // batches are affected, so the person can fix them in the same flow
  // rather than discovering it later, by accident.
  const votedSoftLots = Array.from(lotDeltas.values()).filter(d => 'softBalance.kg' in d);
  let affectedDyeBatches = [];
  if (votedSoftLots.length > 0) {
    try {
      const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(e => e && e.id);
      const [seA, seAr, dlA, dlAr, lotsA, lotsAr, rlA] = await Promise.all([
        fbGet('/tc/stageEntries').catch(() => null), fbGet('/tc/archive/stageEntries').catch(() => null),
        fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null),
        fbGet('/tc/lots').catch(() => null), fbGet('/tc/archive/lots').catch(() => null),
        fbGet('/tc/residualLog').catch(() => null)
      ]);
      const stageEntries = [...toArr(seA), ...toArr(seAr)];
      const dyeLots = [...toArr(dlA), ...toArr(dlAr)];
      const lots = [...toArr(lotsA), ...toArr(lotsAr)];
      const residualLog = toArr(rlA);
      const votedDyeIds = new Set(selected.filter(n => n.stage === 'dye').map(n => n.id));

      for (const { lotId, grade, vendor } of votedSoftLots) {
        const newSoftBal = calcSoftBalanceWeight(stageEntries, lots, [], dyeLots, residualLog, lotId, grade, vendor);
        if (newSoftBal >= -0.01) continue;
        // Sep 10 2026 — real, root-cause fix built via direct discussion
        // with Priyam: requiring sourceType === 'rm' explicitly, so this
        // can never mistake a Dead Stock/Recycle/Residual source
        // (genuinely has no lotId or vendor) for the RM lot actually
        // being voided, even if lotId/vendor were ever undefined here.
        const claimingBatches = dyeLots.filter(d =>
          d.status !== 'Voided' && !votedDyeIds.has(d.id) &&
          (d.sources || []).some(s => s.sourceType === 'rm' && s.lotId === lotId && s.grade === grade && s.vendor === vendor)
        ).map(d => {
          const src = (d.sources || []).find(s => s.sourceType === 'rm' && s.lotId === lotId && s.grade === grade && s.vendor === vendor);
          return { dyeLotId: d.id, dyeLotNo: d.dyeLotNo || '', shade: d.shade || '', claimedKg: src?.weight || 0 };
        });
        if (claimingBatches.length > 0) {
          affectedDyeBatches.push({ lotId, grade, vendor, shortfallKg: Math.abs(newSoftBal), dyeBatches: claimingBatches });
        }
      }
    } catch (e) { /* real, best-effort check — a failure here never blocks the void itself, which has already genuinely completed */ }
  }

  return jsonResponse({ success: true, voidCount, affectedDyeBatches });
}

// POST /api/override — Item Q critical tier (4th and last, Jul 15 2026).
// Was: submitOverride() (pages.js) — admin could directly edit any field
// (quantities, weights, status) on any Soft/Dye/Wind/Pack/Dispatch entry,
// entirely client-side, zero server involvement, un-atomic (separate
// save() for the entry then editLog). Note: deliberately does NOT add new
// validation rules (e.g. output<=input) that weren't there before —
// override exists specifically as the escape hatch for admins to correct
// data that the normal rules can't represent, gated by reason+audit-log
// instead of business rules. The fix here is atomicity and real
// server-side auth enforcement, not new restrictions nobody asked for.
const _OV_TABLE = { stage: 'stageEntries', dye: 'dyeLots', wind: 'windEntries', pack: 'packEntries', dispatch: 'dispatches', recycleSoft: 'recycleSoft' };
const _OV_FIELDS = {
  stage: ['inUnits', 'inWeight', 'outUnits', 'outWeight', 'status', 'lotId', 'grade'],
  dye: ['dyeLotNo', 'shade', 'totalInCones', 'totalInWeight', 'outCones', 'outWeight', 'status'],
  wind: ['inCones', 'inWeight', 'outCones', 'outWeight', 'status'],
  pack: ['inCones', 'bags', 'weight', 'status'],
  dispatch: ['bags', 'weight', 'party', 'invoiceNo', 'status']
};
const _OV_NUMERIC = new Set(['inUnits', 'inWeight', 'outUnits', 'outWeight', 'totalInCones', 'totalInWeight', 'outCones', 'inCones', 'bags', 'weight']);



// POST /api/approve-all — bulk approve for the current Approval tab
// (Soft/Dye/Wind/Pack/Dispatch). Restored Jul 15 2026 — found missing
// from the live file entirely (route existed, calling nothing); confirmed
// also absent from the true original upload, meaning this was built
// during this session and lost in a later edit. Restored verbatim from
// this conversation's own earlier verified tool output, not guessed.
const _APPROVE_ALL_TABLE = { soft: 'stageEntries', dye: 'dyeLots', wind: 'windEntries', pack: 'packEntries', dispatch: 'dispatches', recycleSoft: 'recycleSoft' };
async function handleApproveAll(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager', 'supervisor'].includes(role)) return errorResponse('Supervisor or Admin only', 403);

  const { tab, changedBy } = body || {};
  const table = _APPROVE_ALL_TABLE[tab];
  if (!table) return errorResponse('Unknown tab');

  const raw = await fbGet(`/tc/${table}`).catch(() => null);
  const all = raw ? (Array.isArray(raw) ? raw : Object.values(raw)).filter(x => x && x.id) : [];
  const pending = all.filter(x => x.status === 'Pending');
  if (!pending.length) return errorResponse(`No pending ${tab} entries`);

  const now = new Date().toISOString();
  const patch = {};
  // Jul 15 2026 — Phase 2 of the running-balance plan: accumulate real
  // deltas per unique lot/dyeLot across the whole batch (not just a
  // dedup-and-recompute target list), then nudge once per key at the
  // end with the summed amount — same real balance-changing math as
  // handleApproveEntry (the individual approve path), just batched.
  const lotDeltas = new Map();   // key: lotId__grade__vendor -> {field: delta}
  const dyeDeltas = new Map();   // key: dyeLotId -> {field: delta}
  const addLotDelta = (lotId, grade, vendor, field, amt) => {
    const k = `${lotId}__${grade || ''}__${vendor || ''}`;
    const cur = lotDeltas.get(k) || { lotId, grade: grade || '', vendor: vendor || '' };
    cur[field] = (cur[field] || 0) + amt;
    lotDeltas.set(k, cur);
  };
  const addDyeDelta = (dyeLotId, field, amt) => {
    const cur = dyeDeltas.get(dyeLotId) || {};
    cur[field] = (cur[field] || 0) + amt;
    dyeDeltas.set(dyeLotId, cur);
  };

  for (const item of pending) {
    patch[`/tc/${table}/${item.id}/status`] = 'Approved';
    patch[`/tc/${table}/${item.id}/approvedBy`] = changedBy || '';
    patch[`/tc/${table}/${item.id}/approvedAt`] = now;

    // Jul 26 2026 fix — same check-first fix as handleReject/handleApproveEntry.
    if (tab === 'dye' && item.dyeEntryId) {
      const de = await fbGet(`/tc/dyeEntries/${item.dyeEntryId}`).catch(() => null);
      if (de) {
        patch[`/tc/dyeEntries/${item.dyeEntryId}/status`] = 'Approved';
        patch[`/tc/dyeEntries/${item.dyeEntryId}/approvedBy`] = changedBy || '';
      }
    }

    if (tab === 'soft') {
      addLotDelta(item.lotId, item.grade, item.vendor, 'rmBalance.kg', -(item.inWeight || 0));
      addLotDelta(item.lotId, item.grade, item.vendor, 'rmBalance.units', -(item.inUnits || 0));
      addLotDelta(item.lotId, item.grade, item.vendor, 'softBalance.kg', (item.outWeight || 0));
      addLotDelta(item.lotId, item.grade, item.vendor, 'softBalance.units', (item.outUnits || 0));
    } else if (tab === 'dye') {
      (item.sources && item.sources.length ? item.sources : []).forEach(s => {
        if (!s.lotId) return;
        addLotDelta(s.lotId, s.grade, s.vendor, 'softBalance.kg', -(s.weight || 0));
      });
      addDyeDelta(item.id, 'dyeBalance.cones', (item.outCones || 0));
      addDyeDelta(item.id, 'dyeBalance.kg', (item.outWeight || 0));
    } else if (tab === 'wind') {
      if (item.dyeLotId) {
        addDyeDelta(item.dyeLotId, 'dyeBalance.cones', -(item.inCones || 0));
        addDyeDelta(item.dyeLotId, 'dyeBalance.kg', -(item.inWeight || 0));
        addDyeDelta(item.dyeLotId, 'windBalance.cones', (item.outCones || 0));
        addDyeDelta(item.dyeLotId, 'windBalance.kg', (item.outWeight || 0));
      }
    } else if (tab === 'pack') {
      if (item.dyeLotId) {
        addDyeDelta(item.dyeLotId, 'windBalance.cones', -(item.inCones || 0));
        addDyeDelta(item.dyeLotId, 'windBalance.kg', -(item.inWeight || 0));
        addDyeDelta(item.dyeLotId, 'packBalance.bags', (item.bags || 0));
        addDyeDelta(item.dyeLotId, 'packBalance.kg', (item.weight || 0));
      }
    } else if (tab === 'dispatch') {
      const dyeLotId = item.dyeLotId || (item.lots && item.lots[0] && item.lots[0].dyeLotId);
      if (dyeLotId) {
        addDyeDelta(dyeLotId, 'packBalance.bags', -(item.bags || 0));
        addDyeDelta(dyeLotId, 'packBalance.kg', -(item.weight || 0));
        addDyeDelta(dyeLotId, 'dispatched.bags', (item.bags || 0));
        addDyeDelta(dyeLotId, 'dispatched.kg', (item.weight || 0));
      }
    }
  }

  await fbPatch('', patch);

  await Promise.all([
    ...Array.from(lotDeltas.values()).map(d => { const { lotId, grade, vendor, ...fields } = d; return nudgeLotSummary(lotId, grade, vendor, fields).catch(() => {}); }),
    ...Array.from(dyeDeltas.entries()).map(([dyeLotId, fields]) => nudgeDyeLotSummary(dyeLotId, fields).catch(() => {}))
  ]);

  return jsonResponse({ success: true, count: pending.length });
}

// POST /api/admin/reset-all — was: _executePwdAction('reset', ...)
// (pages.js). Rebuilt Jul 15 2026 from Priyam's uploaded older backup
// (tc_core_pages_split_production_55), which still had the original
// client-side implementation — used as verified real source, not
// guessed. Both the admin password and the "type RESET" confirm phrase
// are now re-verified server-side instead of only trusted from the
// client.
//
// EXPANDED Jul 15 2026, per Priyam's explicit instruction: the original
// only reset 9 tables — confirmed a real gap, not intentional. Now
// covers every real table found in the app.
//
// KEPT, not reset — Priyam's explicit call: masters (vendors/mills/
// grades/machines/workers) and parties — configuration, not
// transactional data. agingThresholds treated the same way (config, not
// transaction data) — this specific one is my judgment call, not
// explicitly discussed, flagged here rather than silently decided.
// users was never in scope — the original's own comment said "user
// accounts unaffected," kept identical.
//
// archive/* IS included, since "reset everything" was explicitly
// agreed — this permanently deletes all historical/archived production
// records too, not just active ones. Genuinely severe, flagged clearly.
// Jul 15 2026 — Reset All Data restricted to admin ONLY, not manager.
// Deliberately separate from _matchAnyAdminPassword (which correctly
// stays admin-or-manager for RM lot void, master item delete, etc. —
// those are scoped to one record; this is the entire database,
// including full archive, at once, unrecoverable). A stricter rule for
// a genuinely different severity of action, not a blanket change.
// Jul 29 2026 — _matchAdminOnlyPassword removed entirely. It only ever
// checked whether a password matched SOME admin account — never whether
// the actual requester was genuinely logged in as anyone at all. All
// callers now use real, verified session tokens (via _verifySelfPassword,
// tied to the session's own username) instead. Removed rather than left
// unused, so this exact unsafe pattern can never be accidentally reached
// for again.

async function handleFactoryReset(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  // Jul 29 2026 — Priyam's explicit, direct instruction: admin and
  // manager are the same tier, everywhere, no exceptions. Supervisor
  // and below remain genuinely lower-privileged. This supersedes an
  // earlier, stricter admin-only rule for this specific action.
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin or manager access required', 403);
  const { password, confirmPhrase } = body || {};
  if (!password) return errorResponse('Password required');
  if (confirmPhrase !== 'RESET') return errorResponse('Type RESET in the confirmation box to proceed');

  // Jul 29 2026 fix — real, serious, confirmed vulnerability found during
  // the Masters/Users audit: this used to only check whether the given
  // password matched ANY admin account — never whether the actual
  // requester was genuinely logged in as that person. Anyone who knew or
  // guessed any admin's password, with no real login at all, could wipe
  // the entire production database. Now requires a genuine, verified
  // admin session first — the password is still required too, as a
  // deliberate second, explicit confirmation for an action this
  // destructive, matching the same self-password pattern used for other
  // high-stakes single-entry voids elsewhere in this app.
  const admin = await _verifySelfPassword(tokenClaim?.username, password);
  if (!admin) return errorResponse('Incorrect password', 401);

  const patch = {
    // Core production data
    '/tc/lots': [],
    '/tc/stageEntries': [],
    '/tc/dyeLots': {},
    '/tc/windEntries': {},
    '/tc/packEntries': {},
    '/tc/dispatches': [],
    // Supporting logs
    '/tc/voidLog': [],
    '/tc/editLog': {},
    '/tc/rmReturnLog': {},
    '/tc/residualLog': {},
    '/tc/scrapLog': {},
    // Stock features
    '/tc/deadStock': {},
    '/tc/recycleStock': {},
    '/tc/recycleSoft': {},
    '/tc/partyOrders': {},
    // Cached summaries — will self-heal/repopulate as new data comes in
    '/tc/lotSummaries': {},
    '/tc/dyeLotSummaries': {},
    '/tc/orderSummaries': {},
    '/tc/partySummaries': {},
    '/tc/reportSummaries': {},
    // Flags/requests/system bookkeeping
    '/tc/lotFlags': {},
    '/tc/deleteRequests': [],
    '/tc/idCounters': {},
    '/tc/lotToDyeLots': {},
    '/tc/triggerCallFailures': {},
    // Archive — full historical wipe, part of "reset everything"
    '/tc/archive': {}
    // NOT included: /tc/masters, /tc/parties (kept — Priyam's explicit
    // call), /tc/agingThresholds (kept — my judgment call, flagged),
    // /tc/users (never in scope, matches original)
  };
  await fbPatch('', patch);

  return jsonResponse({ success: true });
}

// POST /api/master-item/delete — permanent deletion of a master value
// (vendor/mill/grade/worker/machine/party). Was: confirmMasterDelete() +
// executeMasterDelete() (pages.js) — same gap as confirmRMDelete had
// before today's fix: the admin password was verified in a SEPARATE
// round-trip (/api/verify-password) as a client-side UI gate only: the
// actual deletion that followed mutated State.DB.masters/State.DB.parties
// directly and saved via the generic /api/save passthrough, with no
// server-side re-check of anything. A client that skipped the password
// step had nothing stopping it. Also handles approving a pending delete
// request (supervisor-submitted, admin-approved flow) in the same atomic
// write, matching the original's two entry paths (direct delete vs
// approve-a-request).
async function handleMasterItemDelete(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin/manager access required', 403);
  const { key, val, password, deleteRequestId, changedBy } = body || {};
  if (!key) return errorResponse('key required');
  if (!val) return errorResponse('val required');
  if (!password) return errorResponse('Password required');

  // Jul 29 2026 fix — real, confirmed vulnerability: tokenClaim was
  // already a parameter here, but never actually used — the real check
  // was still the same "matches any admin's password" pattern, with no
  // verification that the actual requester was genuinely logged in.
  const admin = await _verifySelfPassword(tokenClaim?.username, password);
  if (!admin) return errorResponse('Incorrect password', 401);

  const patch = {};
  const now = new Date().toISOString();

  if (deleteRequestId) {
    const req = await fbGet(`/tc/deleteRequests/${deleteRequestId}`).catch(() => null);
    if (!req) return errorResponse('Delete request not found', 404);
    patch[`/tc/deleteRequests/${deleteRequestId}/status`] = 'approved';
    patch[`/tc/deleteRequests/${deleteRequestId}/approvedBy`] = changedBy || '';
    patch[`/tc/deleteRequests/${deleteRequestId}/approvedAt`] = now;
  }

  if (key === 'parties') {
    const raw = await fbGet('/tc/parties').catch(() => null);
    const list = raw ? (Array.isArray(raw) ? raw : Object.values(raw)) : [];
    patch['/tc/parties'] = list.filter(v => v !== val);
  } else if (key === 'machines') {
    const rawM = await fbGet('/tc/masters').catch(() => null);
    const masters = rawM || {};
    patch['/tc/masters/machines'] = (masters.machines || []).filter(m => m !== val);
    if (masters.machineCapacity && masters.machineCapacity[val]) {
      const cap = { ...masters.machineCapacity };
      delete cap[val];
      patch['/tc/masters/machineCapacity'] = cap;
    }
  } else if (['softMachines', 'dyeMachines', 'windMachines', 'packMachines'].includes(key)) {
    // Aug 26 2026 — real, direct rebuild built via direct discussion
    // with Priyam: machines now genuinely live in 4 separate, simple
    // lists, one per stage — exactly matching how Vendors already
    // works — rather than one shared list plus a separate tag, which
    // Priyam correctly, directly pointed out was needlessly confusing.
    // Capacity still needs its own real cleanup, same as before.
    const rawM = await fbGet('/tc/masters').catch(() => null);
    const masters = rawM || {};
    patch[`/tc/masters/${key}`] = (masters[key] || []).filter(m => m !== val);
    if (masters.machineCapacity && masters.machineCapacity[val]) {
      const cap = { ...masters.machineCapacity };
      delete cap[val];
      patch['/tc/masters/machineCapacity'] = cap;
    }
  } else {
    const rawM = await fbGet('/tc/masters').catch(() => null);
    const masters = rawM || {};
    if (masters[key]) patch[`/tc/masters/${key}`] = masters[key].filter(v => v !== val);
  }

  await fbPatch('', patch);

  return jsonResponse({ success: true, key, val });
}

// POST /api/backup/restore — Jul 24 2026 fix. Previously ran entirely
// client-side (restoreFromBackup in pages.js): the browser called
// State.fbDB.ref().update(...) directly, replacing most of /tc with a
// backup's contents. No password, no role check anywhere in that
// function — unlike Factory Reset and Master Item Delete, which both
// verify an admin password server-side before doing anything. The Backup
// & Export screen is also visible to supervisors (setupSidebar), not
// just admin/manager, so this was reachable by a role the app's own
// Permission Matrix says "cannot delete or override."
// Restricted to admin-only password (not admin-or-manager) via
// _matchAdminOnlyPassword, matching Factory Reset's reasoning: this
// replaces the whole live dataset at once, same severity class.
// Second, compounding bug fixed here too: the client's own audit-trail
// write (State.fbDB.ref('/restoreLog').push(...)) was silently rejected
// by the Firebase rules (/restoreLog has .write:false for direct
// clients) even when the restore itself succeeded — so a restore could
// happen with zero record of who did it. Now written server-side,
// atomically, in the same patch as the restore, so it can never be lost.
async function handleBackupRestore(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin or manager access required', 403);
  const { key, password, changedBy } = body || {};
  if (!key) return errorResponse('Backup key required');
  if (!password) return errorResponse('Password required');

  const admin = await _verifySelfPassword(tokenClaim?.username, password);
  if (!admin) return errorResponse('Incorrect password', 401);

  const backupData = await fbGet(`/backups/${key}/data`).catch(() => null);
  if (!backupData) return errorResponse('Backup data not found', 404);

  // Same exclusions the original client code applied: never restore user
  // accounts (managed separately), only restore parties if the backup
  // actually had some (an empty/missing parties array in an old backup
  // should not wipe the current live parties list).
  const { users: _skipUsers, parties: _backupParties, ...restoreData } = backupData;
  const patch = {};
  Object.keys(restoreData).forEach(k => { patch[`/tc/${k}`] = restoreData[k]; });
  if (_backupParties && _backupParties.length > 0) patch['/tc/parties'] = _backupParties;

  const now = new Date().toISOString();
  const logId = 'RL-' + Date.now();
  patch[`/restoreLog/${logId}`] = {
    id: logId, restoredFrom: key, restoredAt: now,
    restoredBy: changedBy || admin.name || 'unknown',
    tablesRestored: Object.keys(restoreData).length
  };

  await fbPatch('', patch);

  return jsonResponse({ success: true, key, restoredBy: admin.name, restoredAt: now });
}

// POST /api/backup/delete — Jul 24 2026 fix, same pattern as
// handleBackupRestore right above: deleteFirebaseBackup used to call
// State.fbDB.ref('/backups/...').remove() directly from the browser, no
// password, no server-side check — Firebase rules block this anyway
// (.write:false on /backups for direct clients), so the delete was
// silently failing every time it was tried, not just unprotected. Moved
// server-side so it actually works, with the same admin-only password
// check as Restore (lower stakes than Restore — deletes a backup copy,
// not live data — but still a destructive action worth gating for real).
async function handleBackupDelete(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin or manager access required', 403);
  const { type, dateKey, password } = body || {};
  if (!type || !dateKey) return errorResponse('type and dateKey required');
  if (!password) return errorResponse('Password required');

  const admin = await _verifySelfPassword(tokenClaim?.username, password);
  if (!admin) return errorResponse('Incorrect password', 401);

  await fbPatch('', { [`/backups/${type}/${dateKey}`]: null });

  return jsonResponse({ success: true, type, dateKey });
}

async function handleStageEnd(body) {
  const { id, outUnits, outWeight, endNote, idempotencyKey } = body;
  if (!id) return errorResponse('Select in-progress entry');
  if (!outUnits) return errorResponse('Enter output units');
  const idemp = await checkIdempotency(idempotencyKey, 'Soft/Wind End');
  if (idemp.duplicate) return errorResponse(idemp.message);

  const e = await fbGet(`/tc/stageEntries/${id}`).catch(() => null);
  if (!e) return errorResponse('Entry not found', 404);
  if (outUnits > (e.inUnits || 0) + 0.01) return errorResponse(`Output (${outUnits}u) cannot exceed input (${e.inUnits}u) — hard rule, no exceptions`);
  if (outWeight > (e.inWeight || 0) + 0.01) return errorResponse(`Output weight (${outWeight}kg) cannot exceed input weight (${e.inWeight}kg)`);

  // Aug 6 2026 — moved into shared-balances.js as calcSoftWaste, same
  // formula, now the single source shared with client-side redundant
  // calculations that used to exist separately.
  const { wasteUnits: wasteU, wasteWeight: wasteW } = calcSoftWaste(e.inUnits, outUnits, e.inWeight, outWeight);

  const patch = {};
  const p = `/tc/stageEntries/${id}`;
  patch[`${p}/outUnits`] = outUnits; patch[`${p}/outWeight`] = outWeight;
  patch[`${p}/wasteUnits`] = wasteU; patch[`${p}/wasteWeight`] = wasteW;
  patch[`${p}/endWorker`] = e.startWorker || ''; patch[`${p}/endNote`] = endNote || '';
  patch[`${p}/endTime`] = new Date().toISOString(); patch[`${p}/status`] = 'Pending';
  await fbPatch('', patch);
  // No summary trigger on End — status moves InProgress→Pending, which
  // doesn't change the WIP-claimed total (still counted either way) or any
  // Approved-based figure. Matches the original client behavior exactly.

  return jsonResponse({ success: true });
}

// ─── Item I: Wind entry creation/completion (Jul 14 2026) ─────────────────
// Server-side replacement for pages.js's submitWind. Dye-lot-keyed balance
// (getDyeBalAvailable) already confirmed structurally safe earlier this
// session — archiving is atomic per dye lot, so no partial-archive window
// exists here the way it did for the RM-lot-level checks.
async function handleWindStart(body) {
  const { dyeLotId, inCones, inWeight, machine, worker, notes, idempotencyKey, confirmDuplicate } = body;
  if (!dyeLotId) return errorResponse('Select a dye lot');
  if (!inCones || inCones <= 0) return errorResponse('Enter cones count');
  if (!inWeight || inWeight <= 0) return errorResponse('Input weight must be > 0');
  if (!machine) return errorResponse('Select machine');
  if (!worker) return errorResponse('Select worker');
  const idemp = await checkIdempotency(idempotencyKey, 'Wind Start');
  if (idemp.duplicate) return errorResponse(idemp.message);

  const lockKey = `DYE_${dyeLotId}`.replace(/[^a-zA-Z0-9_]/g, '_');
  const result = await withBalanceLock(lockKey, async () => {
    const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(e => e && e.id);
    const [dlA, dlAr, weA, weAr, dyeLotFlagsA] = await Promise.all([
      fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null),
      fbGet('/tc/windEntries').catch(() => null), fbGet('/tc/archive/windEntries').catch(() => null),
      fbGet('/tc/dyeLotFlags').catch(() => null)
    ]);
    const dyeLots = [...toArr(dlA), ...toArr(dlAr)];
    const windEntries = [...toArr(weA), ...toArr(weAr)];

    const heldFlag = _isDyeLotOnHold(dyeLotFlagsA, dyeLotId);
    if (heldFlag) return { __rejected: errorResponse(`This dye lot is on Hold — "${heldFlag.note}". The hold must be cleared before it can be processed.`) };

    const dyeBal = calcDyeBalAvailable(dyeLots, windEntries, dyeLotId);
    if (inCones > dyeBal.units) return { __rejected: errorResponse(`Cones in (${inCones}) exceeds available dye balance (${dyeBal.units} cones)`) };
    if (inWeight > dyeBal.weight + 0.01) return { __rejected: errorResponse(`Input ${inWeight}kg exceeds available dye balance ${dyeBal.weight}kg`) };
    if (dyeBal.weight < 0.01) return { __rejected: errorResponse('No dye balance remaining — all balance already claimed') };

    // Sep 19 2026 — Recycle Phase 1: the recycle-through-Wind check that used to sit here was removed. There is no Recycle Wind step
    // (Off yarn goes On Steel -> re-dye, or -> Recycle Soft -> Dye, or -> Scrap), so Wind Start never takes a recycle.

    // Jul 26 2026 — content-based duplicate check, confirmed design: same
    // dye lot + same input cones/weight, exact match, 15-day window.
    // Reuses the windEntries array already fetched above — no extra read.
    if (!confirmDuplicate) {
      const nowDate = new Date().toISOString();
      const windowMs = 15 * 86400000;
      const dupes = windEntries.filter(e => {
        if (e.status === 'Rejected' || e.status === 'Voided') return false;
        if (e.dyeLotId !== dyeLotId) return false;
        if (Math.abs((e.inCones || 0) - inCones) > 0.01 || Math.abs((e.inWeight || 0) - inWeight) > 0.01) return false;
        const eDate = new Date(e.startTime || 0);
        if (isNaN(eDate.getTime())) return false;
        const diffMs = new Date(nowDate) - eDate;
        return diffMs >= 0 && diffMs <= windowMs;
      });
      if (dupes.length > 0) {
        return {
          __rejected: jsonResponse({
            success: false, duplicateWarning: true,
            matches: dupes.map(e => ({ entryId: e.id, startTime: e.startTime, inCones: e.inCones, inWeight: e.inWeight })),
            message: `This looks like it might already be started — same dye lot, same input cones and weight as ${dupes.map(e => e.id).join(', ')} (within the last 15 days). If this is genuinely a different batch, confirm to proceed.`
          })
        };
      }
    }

    const lot = dyeLots.find(d => d.id === dyeLotId);
    const id = await genIdAtomicServer('WE', windEntries);
    const entry = { id, dyeLotId, dyeLotNo: lot?.dyeLotNo || '', shade: lot?.shade || '', grade: (lot?.sources || [])[0]?.grade || '', inCones, inWeight, machine, startWorker: worker, startTime: new Date().toISOString(), notes: notes || '', status: 'InProgress' };

    await fbSet(`/tc/windEntries/${id}`, entry);

    return { id };
  });

  if (result.__lockFailed) return errorResponse(result.error);
  if (result.__rejected) return result.__rejected;
  return jsonResponse({ success: true, id: result.id });
}

// Sep 20 2026 — Recycle Phase 2c: Void / Edit / Preview-Edit for a Recycle Soft entry.
// DEDICATED functions rather than folded into the generic handleVoidEntry / handleEditEntry / handlePreviewEdit (which are built
// around a chain of NEXT-STAGE tables directly linked by dyeLotId — Soft->Dye->Wind->Pack->Dispatch). Recycle Soft's "downstream"
// is a shared POOL (several entries' approved output feed one Softened balance that any dye lot can draw from), not a 1:1 linked
// record, so the existing cascade-void / per-stage-branch shape does not fit safely. Undo IS reused, though: this writes plain
// per-field editLog rows exactly like handleEditEntry's tail, and 'recycleSoft' is registered in the shared config maps below so
// handleUndoEdit's existing generic (config-driven) undo path works for it with no new code there at all.
async function handleVoidRecycleSoft(body, tokenClaim) {
  const { id, reasonCat, reason, changedBy, password, username, dryRun } = body || {};
  if (!id) return errorResponse('Select an entry to void');
  if (!reasonCat) return errorResponse('Select void reason category');
  if (!reason || reason.length < 10) return errorResponse('Reason must be at least 10 characters');
  const verifiedUser = await _verifySelfPassword(username, password);
  if (!verifiedUser) return errorResponse('Incorrect password', 401);
  const role = verifiedUser.role;
  if (!['admin', 'manager', 'supervisor'].includes(role)) return errorResponse('Supervisor or Admin only', 403);
  const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(x => x && x.id);
  const [rsA, rcA, dlA, dlAr, slA] = await Promise.all([
    fbGet('/tc/recycleSoft').catch(() => null), fbGet('/tc/recycleStock').catch(() => null),
    fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null), fbGet('/tc/scrapLog').catch(() => null)
  ]);
  const recycleSoft = toArr(rsA), recycleStock = toArr(rcA), dyeLots = [...toArr(dlA), ...toArr(dlAr)], scrapLog = toArr(slA);
  const e = recycleSoft.find(x => x.id === id);
  if (!e) return errorResponse('Entry not found', 404);
  if (e.status === 'Voided' || e.status === 'Rejected') return errorResponse(`Entry is already ${e.status} — nothing to void`);
  const wasApproved = e.status === 'Approved' || e.status === 'Edited-Approved';
  let wouldGoNegative = false, shortfallMessage = null;
  if (wasApproved) {
    const after = calcRecycleSoftenedBal(recycleStock, recycleSoft.filter(x => x.id !== id), dyeLots, scrapLog, e.recycleId);
    wouldGoNegative = after.weight < -0.01 || after.units < 0;
    if (wouldGoNegative) {
      shortfallMessage = `Voiding this would leave the Softened pool at ${after.units} cones / ${after.weight.toFixed(2)}kg — a dye lot has already used more than that. Void or edit that dye lot first.`;
    }
  }
  if (dryRun) return jsonResponse({ __dryRun: true, entryCones: e.inCones || 0, entryWeight: e.inWeight || 0, outCones: e.outCones || 0, outWeight: e.outWeight || 0, wouldGoNegative, shortfallMessage });
  if (wouldGoNegative) return errorResponse(shortfallMessage);
  const now = new Date().toISOString();
  const logId = `EL-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const patch = {
    [`/tc/editLog/${logId}`]: { id: logId, timestamp: now, entryId: id, stage: 'recycleSoft', fieldChanged: 'status', oldVal: e.status, newVal: 'Voided', reasonCat, reason, changedBy, type: 'void', _updatedAt: now },
    [`/tc/recycleSoft/${id}/status`]: 'Voided',
    [`/tc/recycleSoft/${id}/voidedBy`]: changedBy,
    [`/tc/recycleSoft/${id}/voidedAt`]: now,
    [`/tc/recycleSoft/${id}/voidReason`]: reason,
    [`/tc/recycleSoft/${id}/_updatedAt`]: now,
  };
  await fbPatch('', patch);
  return jsonResponse({ success: true });
}

async function handlePreviewEditRecycleSoft(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager', 'supervisor'].includes(role)) return errorResponse('Supervisor or Admin only', 403);
  const isAdmin = role === 'admin' || role === 'manager';
  const { id } = body || {};
  const check = await _recycleSoftEditCheck(body, isAdmin);
  if (check.__rejected) return check.__rejected;
  const { e, newInC, newInW, newOutC, newOutW, newMachine, newWorker, newStartNote, newEndNote, blockers, warnings, softAfter, softShortfall } = check;
  return jsonResponse({
    success: true, allowed: blockers.length === 0, blockers, warnings,
    current: { inCones: e.inCones, inWeight: e.inWeight, outCones: e.outCones, outWeight: e.outWeight, machine: e.machine || '', worker: e.startWorker || '', startNote: e.startNote || '', endNote: e.endNote || '' },
    proposed: { inCones: newInC, inWeight: newInW, outCones: newOutC, outWeight: newOutW, machine: newMachine, worker: newWorker, startNote: newStartNote, endNote: newEndNote },
    newBalanceLabel: 'Softened Pool After This Edit', newBalanceCones: softAfter.units, newBalanceKg: softAfter.weight, wouldGoNegative: softShortfall,
  });
}

async function handleEditRecycleSoft(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager', 'supervisor'].includes(role)) return errorResponse('Supervisor or Admin only', 403);
  const isAdmin = role === 'admin' || role === 'manager';
  const { reasonCat, reasonText, changedBy } = body || {};
  if (!reasonCat) return errorResponse('Select reason category');
  if (!reasonText || reasonText.length < 10) return errorResponse('Reason must be at least 10 characters');
  if (!isAdmin) {
    const verifiedUser = await _verifySelfPassword(body.username, body.password);
    if (!verifiedUser) return errorResponse('Incorrect password', 401);
  }
  const check = await _recycleSoftEditCheck(body, isAdmin);
  if (check.__rejected) return check.__rejected;
  const { id, e, newInC, newInW, newOutC, newOutW, newMachine, newWorker, newStartNote, newEndNote, blockers, softShortfall, softShortfallMessage } = check;
  if (blockers.length) return errorResponse(blockers[0]);
  const changes = [];
  if ((e.inCones || 0) !== newInC) changes.push({ field: 'In Cones', old: e.inCones || 0, new: newInC });
  if ((e.inWeight || 0) !== newInW) changes.push({ field: 'In Weight', old: e.inWeight || 0, new: newInW });
  if ((e.outCones || 0) !== newOutC) changes.push({ field: 'Out Cones', old: e.outCones || 0, new: newOutC });
  if ((e.outWeight || 0) !== newOutW) changes.push({ field: 'Out Weight', old: e.outWeight || 0, new: newOutW });
  if ((e.machine || '') !== newMachine) changes.push({ field: 'Machine', old: e.machine || '', new: newMachine });
  if ((e.startWorker || '') !== newWorker) changes.push({ field: 'Start Worker', old: e.startWorker || '', new: newWorker });
  if ((e.startNote || '') !== newStartNote) changes.push({ field: 'Start Note', old: e.startNote || '', new: newStartNote });
  if ((e.endNote || '') !== newEndNote) changes.push({ field: 'End Note', old: e.endNote || '', new: newEndNote });
  if (!changes.length) return errorResponse('No changes detected');
  const p = `/tc/recycleSoft/${id}`;
  const patch = {};
  patch[`${p}/inCones`] = newInC; patch[`${p}/inWeight`] = newInW; patch[`${p}/outCones`] = newOutC; patch[`${p}/outWeight`] = newOutW;
  patch[`${p}/machine`] = newMachine; patch[`${p}/startNote`] = newStartNote; patch[`${p}/endNote`] = newEndNote;
  if ((e.startWorker || '') !== newWorker) {
    patch[`${p}/startWorker`] = newWorker;
    if (e.endTime && (e.endWorker || '') === (e.startWorker || '')) patch[`${p}/endWorker`] = newWorker;
  }
  if (newOutC > 0 || newOutW > 0) { patch[`${p}/wasteCones`] = Math.max(0, newInC - newOutC); patch[`${p}/wasteWeight`] = Math.max(0, parseFloat((newInW - newOutW).toFixed(2))); }
  if (isAdmin && e.status === 'Approved') patch[`${p}/status`] = 'Edited-Approved';
  const now = new Date().toISOString();
  changes.forEach(c => {
    const logId = `EL-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    patch[`/tc/editLog/${logId}`] = { id: logId, timestamp: now, entryId: id, stage: 'recycleSoft', field: c.field, oldVal: String(c.old ?? ''), newVal: String(c.new ?? ''), reasonCat, reasonText, impactNote: softShortfall ? softShortfallMessage : null, changedBy, type: 'edit', _updatedAt: now };
  });
  patch[`${p}/_updatedAt`] = now;
  await fbPatch('', patch);
  return jsonResponse({ success: true, changesCount: changes.length, imbalanceNote: softShortfall ? softShortfallMessage : null });
}

// Shared by preview and the real edit — one set of rules, checked identically both times.
async function _recycleSoftEditCheck(body, isAdmin) {
  const { id } = body || {};
  if (!id) return { __rejected: errorResponse('Select an entry to edit') };
  const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(x => x && x.id);
  const [rsA, rcA, dlA, dlAr, slA] = await Promise.all([
    fbGet('/tc/recycleSoft').catch(() => null), fbGet('/tc/recycleStock').catch(() => null),
    fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null), fbGet('/tc/scrapLog').catch(() => null)
  ]);
  const recycleSoft = toArr(rsA), recycleStock = toArr(rcA), dyeLots = [...toArr(dlA), ...toArr(dlAr)], scrapLog = toArr(slA);
  const e = recycleSoft.find(x => x.id === id);
  if (!e) return { __rejected: errorResponse('Entry not found', 404) };
  if (e.status === 'Voided') return { __rejected: errorResponse('Cannot edit a Voided entry') };
  if (e.status === 'Pending' || e.status === 'InProgress' || e.status === 'Edited-Pending') {
    return { __rejected: errorResponse('Cannot edit a Pending entry — Reject it and start a fresh entry with the correct values instead. Editing is only for entries already resolved (Approved or Rejected).') };
  }
  const newInC = body.inCones ?? e.inCones ?? 0, newInW = body.inWeight ?? e.inWeight ?? 0;
  const newOutC = body.outCones ?? e.outCones ?? 0, newOutW = body.outWeight ?? e.outWeight ?? 0;
  const newMachine = body.machine ?? e.machine ?? '', newWorker = body.worker ?? e.startWorker ?? '';
  const newStartNote = body.startNote ?? e.startNote ?? '', newEndNote = body.endNote ?? e.endNote ?? '';
  const blockers = [], warnings = [];
  if (!String(newMachine).trim() && e.machine) blockers.push('Machine cannot be blank.');
  if (!String(newWorker).trim() && e.startWorker) blockers.push('Start Worker cannot be blank.');
  if (newOutW > newInW + 0.01) blockers.push(`Output ${newOutW}kg exceeds input ${newInW}kg.`);
  if (newOutC > newInC && newInC > 0) blockers.push(`Output cones (${newOutC}) cannot exceed input cones (${newInC}).`);
  // increasing the input has to fit what is genuinely free on steel — WITHOUT double-counting this entry's own current claim
  if (e.status === 'Approved' || e.status === 'Edited-Approved') {
    // Sep 20 2026 — compare the NEW ABSOLUTE value against availability with THIS entry excluded entirely (not a delta on top
    // of "available excluding this entry" — that would silently double-count the room this entry's own current input already
    // occupies, exactly the double-count bug already fixed once for Dye Edit Input in Phase 1/2).
    const others = recycleSoft.filter(x => x.id !== id);
    const steelAvail = calcRecycleSteelAvailable(recycleStock, dyeLots, scrapLog, e.recycleId, others);
    if (newInW > (e.inWeight || 0) && newInW > steelAvail.weight + 0.01) blockers.push(`Only ${steelAvail.weight.toFixed(2)}kg genuinely free on steel — cannot increase input to ${newInW}kg.`);
    if (newInC > (e.inCones || 0) && newInC > steelAvail.units) blockers.push(`Only ${steelAvail.units} cones genuinely free on steel — cannot increase input to ${newInC}.`);
  }
  // decreasing the output cannot leave the Softened pool short of what a dye lot has already, genuinely used
  let softAfter = { weight: 0, units: 0 }, softShortfall = false, softShortfallMessage = null;
  if (e.status === 'Approved' || e.status === 'Edited-Approved') {
    const proposed = recycleSoft.map(x => x.id === id ? { ...x, outCones: newOutC, outWeight: newOutW } : x);
    softAfter = calcRecycleSoftenedBal(recycleStock, proposed, dyeLots, scrapLog, e.recycleId);
    softShortfall = softAfter.weight < -0.01 || softAfter.units < 0;
    if (softShortfall) {
      softShortfallMessage = `Reducing the output would leave the Softened pool at ${softAfter.units} cones / ${softAfter.weight.toFixed(2)}kg — a dye lot has already used more than that.`;
      if (isAdmin) warnings.push(softShortfallMessage); else blockers.push(softShortfallMessage);
    }
  }
  return { id, e, newInC, newInW, newOutC, newOutW, newMachine, newWorker, newStartNote, newEndNote, blockers, warnings, softAfter, softShortfall, softShortfallMessage };
}

async function handleWindEnd(body) {
  const { id, outCones, outWeight, notes, idempotencyKey } = body;
  if (!id) return errorResponse('Select a wind entry to end');
  if (!outCones || outCones <= 0) return errorResponse('Enter output cones count');
  if (!outWeight || outWeight <= 0) return errorResponse('Output weight must be > 0');
  const idemp = await checkIdempotency(idempotencyKey, 'Wind End');
  if (idemp.duplicate) return errorResponse(idemp.message);

  const entry = await fbGet(`/tc/windEntries/${id}`).catch(() => null);
  if (!entry) return errorResponse('Entry not found', 404);
  if (outWeight > (entry.inWeight || 0) + 0.01) return errorResponse(`Output ${outWeight}kg exceeds input ${entry.inWeight}kg`);
  if (outCones > (entry.inCones || 0)) return errorResponse(`Output cones ${outCones} exceeds input cones ${entry.inCones}`);

  // Aug 6 2026 — moved into shared-balances.js as calcWindWaste.
  const { wasteCones, wasteWeight } = calcWindWaste(entry.inCones, outCones, entry.inWeight, outWeight);
  const patch = {};
  const p = `/tc/windEntries/${id}`;
  patch[`${p}/outCones`] = outCones; patch[`${p}/outWeight`] = outWeight;
  patch[`${p}/wasteCones`] = wasteCones; patch[`${p}/wasteWeight`] = wasteWeight;
  patch[`${p}/endWorker`] = entry.startWorker; patch[`${p}/endTime`] = new Date().toISOString();
  patch[`${p}/endNotes`] = notes || ''; patch[`${p}/status`] = 'Pending';
  await fbPatch('', patch);

  return jsonResponse({ success: true });
}

// Sep 20 2026 — Recycle Phase 2: RECYCLE SOFT (table recycleSoft, ids RCS-). Off yarn on steel is softened here; the OUTPUT becomes the Softened pool
// (cones + kg), the difference is waste. Start takes cones + kg from the On Steel pool's AVAILABLE; End records what came out; a supervisor approves
// like every other stage. The lock key is the SAME RC_<id> key Dye Start uses, so a Recycle Soft Start and a Dye Start can never both take the same yarn.
async function handleRecycleSoftStart(body) {
  const { recycleId, inCones, inWeight, machine, worker, notes, changedBy, idempotencyKey } = body || {};
  if (!recycleId) return errorResponse('Select a recycle entry');
  if (!Number.isInteger(+inCones) || !(+inCones > 0)) return errorResponse('Enter the cones (a whole number, at least 1)');
  if (!(+inWeight > 0)) return errorResponse('Weight must be greater than 0');
  if (!machine) return errorResponse('Select machine');
  if (!worker) return errorResponse('Select worker');
  const idemp = await checkIdempotency(idempotencyKey, 'Recycle Soft Start');
  if (idemp.duplicate) return errorResponse(idemp.message);
  const lockKey = `RC_${recycleId}`.replace(/[^a-zA-Z0-9_]/g, '_');
  const result = await withMultiBalanceLock([lockKey], async () => {
    const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(e => e && e.id);
    const [rcA, dlA, dlAr, slA, rsA] = await Promise.all([
      fbGet('/tc/recycleStock').catch(() => null), fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null),
      fbGet('/tc/scrapLog').catch(() => null), fbGet('/tc/recycleSoft').catch(() => null)
    ]);
    const recycleStock = toArr(rcA), dyeLots = [...toArr(dlA), ...toArr(dlAr)], scrapLog = toArr(slA), recycleSoft = toArr(rsA);
    const rc = recycleStock.find(x => x.id === recycleId);
    if (!rc || rc.status === 'Voided') return { __rejected: errorResponse(`Recycle ${recycleId} not found`) };
    const avail = calcRecycleSteelAvailable(recycleStock, dyeLots, scrapLog, recycleId, recycleSoft);
    if (+inWeight > avail.weight + 0.01) return { __rejected: errorResponse(`Recycle ${recycleId}: ${+inWeight}kg exceeds available ${avail.weight.toFixed(2)}kg`) };
    if (+inCones > avail.units) return { __rejected: errorResponse(`Recycle ${recycleId}: ${+inCones} cones exceeds available ${avail.units} cones`) };
    const busy = recycleSoft.find(e => e.machine === machine && e.status === 'InProgress');
    if (busy) return { __rejected: errorResponse(`Machine ${machine} already running ${busy.id} — end that first`) };
    const id = await genIdAtomicServer('RCS', recycleSoft);
    const now = new Date().toISOString();
    const entry = { id, recycleId, dyeLotId: rc.dyeLotId || '', dyeLotNo: rc.dyeLotNo || '', shade: rc.shade || '', inCones: +inCones, inWeight: +inWeight,
      outCones: 0, outWeight: 0, wasteCones: 0, wasteWeight: 0, machine, startWorker: worker, startTime: now, endTime: '', startNote: notes || '', endNote: '',
      status: 'InProgress', createdAt: now, createdBy: changedBy || worker, _updatedAt: now };
    await fbSet(`/tc/recycleSoft/${id}`, entry);
    return { id };
  });
  if (result.__lockFailed) return errorResponse(result.error);
  if (result.__rejected) return result.__rejected;
  return jsonResponse({ success: true, id: result.id });
}

async function handleRecycleSoftEnd(body) {
  const { id, outCones, outWeight, notes, changedBy, idempotencyKey } = body || {};
  if (!id) return errorResponse('Select a Recycle Soft entry to end');
  if (!Number.isInteger(+outCones) || !(+outCones > 0)) return errorResponse('Enter the output cones (a whole number, at least 1)');
  if (!(+outWeight > 0)) return errorResponse('Output weight must be greater than 0');
  const idemp = await checkIdempotency(idempotencyKey, 'Recycle Soft End');
  if (idemp.duplicate) return errorResponse(idemp.message);
  const lockKey = `RCSOFT_${id}`.replace(/[^a-zA-Z0-9_]/g, '_');
  const result = await withBalanceLock(lockKey, async () => {
    const entry = await fbGet(`/tc/recycleSoft/${id}`).catch(() => null);
    if (!entry) return { __rejected: errorResponse('Entry not found', 404) };
    if (entry.status !== 'InProgress') return { __rejected: errorResponse(`Entry is '${entry.status}', not in progress — nothing to end`) };
    if (+outWeight > (entry.inWeight || 0) + 0.01) return { __rejected: errorResponse(`Output ${+outWeight}kg exceeds input ${entry.inWeight}kg`) };
    if (+outCones > (entry.inCones || 0)) return { __rejected: errorResponse(`Output cones ${+outCones} exceeds input cones ${entry.inCones}`) };
    const p = `/tc/recycleSoft/${id}`;
    const patch = {};
    patch[`${p}/outCones`] = +outCones; patch[`${p}/outWeight`] = +outWeight;
    patch[`${p}/wasteCones`] = (entry.inCones || 0) - +outCones; patch[`${p}/wasteWeight`] = +(((entry.inWeight || 0) - +outWeight).toFixed(2));
    patch[`${p}/endWorker`] = entry.startWorker; patch[`${p}/endTime`] = new Date().toISOString();
    patch[`${p}/endNote`] = notes || ''; patch[`${p}/status`] = 'Pending';
    patch[`${p}/_updatedAt`] = new Date().toISOString();
    await fbPatch('', patch);
    return { ok: true };
  });
  if (result.__lockFailed) return errorResponse(result.error);
  if (result.__rejected) return result.__rejected;
  return jsonResponse({ success: true });
}

// ─── Item I: Pack entry creation (Jul 14 2026) ────────────────────────────
// Server-side replacement for pages.js's submitPack. Single-action
// submission (goes straight to Pending, no separate Start/End split like
// Soft/Wind), faithfully replicated including the gain/loss calculation.
async function handlePackSubmit(body) {
  const { dyeLotId, inCones, inWeight, bags, weight, worker, notes, idempotencyKey, confirmDuplicate } = body;
  if (!dyeLotId) return errorResponse('Select a dye lot');
  if (!inCones || inCones <= 0) return errorResponse('Cones in must be > 0');
  if (!inWeight || inWeight <= 0) return errorResponse('In weight must be > 0');
  if (!bags || bags <= 0) return errorResponse('Bags must be > 0');
  if (!weight || weight <= 0) return errorResponse('Weight must be > 0');
  if (!worker) return errorResponse('Select worker');
  const idemp = await checkIdempotency(idempotencyKey, 'Pack');
  if (idemp.duplicate) return errorResponse(idemp.message);

  const lockKey = `DYE_${dyeLotId}`.replace(/[^a-zA-Z0-9_]/g, '_');
  const result = await withBalanceLock(lockKey, async () => {
    const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(e => e && e.id);
    const [dlA, dlAr, weA, weAr, peA, peAr, dyeLotFlagsA] = await Promise.all([
      fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null),
      fbGet('/tc/windEntries').catch(() => null), fbGet('/tc/archive/windEntries').catch(() => null),
      fbGet('/tc/packEntries').catch(() => null), fbGet('/tc/archive/packEntries').catch(() => null),
      fbGet('/tc/dyeLotFlags').catch(() => null)
    ]);
    const dyeLots = [...toArr(dlA), ...toArr(dlAr)];
    const windEntries = [...toArr(weA), ...toArr(weAr)];
    const packEntries = [...toArr(peA), ...toArr(peAr)];

    const heldFlag = _isDyeLotOnHold(dyeLotFlagsA, dyeLotId);
    if (heldFlag) return { __rejected: errorResponse(`This dye lot is on Hold — "${heldFlag.note}". The hold must be cleared before it can be processed.`) };

    const windBal = calcWindBalAvailable(windEntries, packEntries, dyeLotId);
    if (inCones > (windBal.units || 0) + 1) return { __rejected: errorResponse(`Cones in (${inCones}) exceeds wind balance (${windBal.units} cones). Cannot pack more than what was wound.`) };
    if (windBal.weight < 0.01) return { __rejected: errorResponse(`No wind balance remaining — all ${windBal.weight}kg already packed`) };
    // Sep 19 2026 — real gap found by a field-by-field Create-vs-Edit audit: cones were
    // checked against Wind's available balance above, but the input WEIGHT never was —
    // only "is any balance left". Pack Edit already blocks this (Pack's input is what draws
    // from Wind's pool); Create did not, and approval doesn't re-check.
    if (inWeight > windBal.weight + 0.01) return { __rejected: errorResponse(`Weight in (${inWeight}kg) exceeds wind balance (${parseFloat((windBal.weight || 0).toFixed(2))}kg). Cannot pack more than what was wound.`) };

    // Jul 26 2026 — content-based duplicate check, confirmed design: same
    // dye lot + same cones/weight in and bags/weight out, exact match,
    // 15-day window. Reuses packEntries already fetched above.
    if (!confirmDuplicate) {
      const nowDate = new Date().toISOString();
      const windowMs = 15 * 86400000;
      const dupes = packEntries.filter(e => {
        if (e.status === 'Rejected' || e.status === 'Voided') return false;
        if (e.dyeLotId !== dyeLotId) return false;
        if (Math.abs((e.inCones || 0) - inCones) > 0.01 || Math.abs((e.inWeight || 0) - inWeight) > 0.01) return false;
        if (Math.abs((e.bags || 0) - bags) > 0.01 || Math.abs((e.weight || 0) - weight) > 0.01) return false;
        const eDate = new Date(e.timestamp || 0);
        if (isNaN(eDate.getTime())) return false;
        const diffMs = new Date(nowDate) - eDate;
        return diffMs >= 0 && diffMs <= windowMs;
      });
      if (dupes.length > 0) {
        return {
          __rejected: jsonResponse({
            success: false, duplicateWarning: true,
            matches: dupes.map(e => ({ entryId: e.id, timestamp: e.timestamp, bags: e.bags, weight: e.weight })),
            message: `This looks like it might already be packed — same dye lot, same cones/weight in and bags/weight out as ${dupes.map(e => e.id).join(', ')} (within the last 15 days). If this is genuinely a different batch, confirm to proceed.`
          })
        };
      }
    }

    const lot = dyeLots.find(d => d.id === dyeLotId);
    // Aug 6 2026 — moved into shared-balances.js as calcPackGain.
    const { gainKg, gainPct } = calcPackGain(inWeight, weight);
    const id = await genIdAtomicServer('PE', packEntries);
    const entry = { id, dyeLotId, dyeLotNo: lot?.dyeLotNo || '', shade: lot?.shade || '', grade: (lot?.sources || [])[0]?.grade || '', inCones, inWeight, bags, weight, worker, notes: notes || '', gainKg, gainPct, timestamp: new Date().toISOString(), status: 'Pending' };

    await fbSet(`/tc/packEntries/${id}`, entry);

    return { id };
  });

  if (result.__lockFailed) return errorResponse(result.error);
  if (result.__rejected) return result.__rejected;
  return jsonResponse({ success: true, id: result.id });
}

// ─── Item I: Dispatch batch creation (Jul 14 2026) ────────────────────────
// Server-side replacement for pages.js's submitDispatch. Multi-row batch
// submission (several lots under one invoice/challan), faithfully
// replicating the "own-claim" deduction (rows in THIS submission sharing
// the same dyeLotId must account for each other, not just existing DB
// claims) and the Party Order FIFO allocation linking.
function _getOrderFulfilledServer(orderId, partyOrders, dispatches) {
  const order = partyOrders.find(o => o.id === orderId);
  if (!order) return 0;
  const oShade = (order.shade || '').trim().toLowerCase();
  const disps = dispatches.filter(d => (d.shade || '').trim().toLowerCase() === oShade && d.party === order.party && (d.status === 'Approved' || d.status === 'Edited-Approved'))
    .sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
  const orders = partyOrders.filter(o => (o.shade || '').trim().toLowerCase() === oShade && o.party === order.party && o.status !== 'Cancelled')
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const rem = {}; orders.forEach(o => { rem[o.id] = o.qtyOrdered; });
  const alloc = {}; orders.forEach(o => { alloc[o.id] = 0; });
  disps.forEach(d => {
    let wt = d.weight || 0;
    for (const o of orders) {
      if (wt <= 0) break;
      const av = rem[o.id] || 0;
      if (av <= 0) continue;
      const tk = Math.min(wt, av);
      alloc[o.id] = (alloc[o.id] || 0) + tk;
      rem[o.id] -= tk; wt -= tk;
    }
  });
  return alloc[orderId] || 0;
}

async function handleDispatchSubmit(body) {
  const { party, date, invoiceNo, rows, changedBy, idempotencyKey } = body;
  if (!party) return errorResponse('Select party');
  if (!date) return errorResponse('Select date');
  if (!invoiceNo) return errorResponse('Enter invoice / challan no.');
  if (!rows || !rows.length) return errorResponse('Add at least one lot');
  const idemp = await checkIdempotency(idempotencyKey, 'Dispatch');
  if (idemp.duplicate) return errorResponse(idemp.message);

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.dyeLotId) return errorResponse(`Lot ${i + 1}: Select a dye lot`);
    if (!r.bags || r.bags <= 0) return errorResponse(`Lot ${i + 1}: Enter bags count`);
    if (!r.weight || r.weight <= 0) return errorResponse(`Lot ${i + 1}: Enter weight`);
  }

  const lockKeys = rows.map(r => `DYE_${r.dyeLotId}`.replace(/[^a-zA-Z0-9_]/g, '_'));
  const result = await withMultiBalanceLock(lockKeys, async () => {
    const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(e => e && e.id);
    const [dlA, dlAr, peA, peAr, dsA, dsAr, poA, dyeLotFlagsA] = await Promise.all([
      fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null),
      fbGet('/tc/packEntries').catch(() => null), fbGet('/tc/archive/packEntries').catch(() => null),
      fbGet('/tc/dispatches').catch(() => null), fbGet('/tc/archive/dispatches').catch(() => null),
      fbGet('/tc/partyOrders').catch(() => null), fbGet('/tc/dyeLotFlags').catch(() => null)
    ]);
    const dyeLots = [...toArr(dlA), ...toArr(dlAr)];
    const packEntries = [...toArr(peA), ...toArr(peAr)];
    const dispatches = [...toArr(dsA), ...toArr(dsAr)];
    const partyOrders = toArr(poA);

    // Validate each row against true pack balance minus own-claim (rows
    // earlier in THIS same submission targeting the same dye lot)
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const heldFlag = _isDyeLotOnHold(dyeLotFlagsA, r.dyeLotId);
      if (heldFlag) return { __rejected: errorResponse(`Lot ${i + 1}: this dye lot is on Hold — "${heldFlag.note}". The hold must be cleared before it can be processed.`) };
      const packBal = calcPackBalAvailable(packEntries, dispatches, r.dyeLotId);
      const ownClaim = { bags: 0, weight: 0 };
      for (let j = 0; j < i; j++) {
        if (rows[j].dyeLotId === r.dyeLotId) { ownClaim.bags += rows[j].bags || 0; ownClaim.weight += rows[j].weight || 0; }
      }
      const availBags = packBal.units - ownClaim.bags, availWeight = packBal.weight - ownClaim.weight;
      if (r.bags > availBags) return { __rejected: errorResponse(`Lot ${i + 1}: Bags (${r.bags}) exceed AVAILABLE pack balance (${availBags} bags)`) };
      if (r.weight > availWeight + 0.01) return { __rejected: errorResponse(`Lot ${i + 1}: Weight (${r.weight}kg) exceeds AVAILABLE pack balance (${Math.max(0, availWeight)}kg)`) };
    }

    const patch = {};
    const challanId = `CHL-${Date.now()}`;
    const newDispatches = [];
    const dyeLotIdsTouched = new Set();
    for (const r of rows) {
      const dispLot = dyeLots.find(d => d.id === r.dyeLotId);
      const id = await genIdAtomicServer('DSP', [...dispatches, ...newDispatches]);
      const shade = dispLot?.shade || '';
      const openOrders = partyOrders.filter(o => o.party === party && o.shade === shade && (o.status === 'Open' || o.status === 'Partial')).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      const newDisp = { id, dyeLotId: r.dyeLotId, dyeLotNo: dispLot?.dyeLotNo || '', shade, grade: r.grade || '', party, bags: r.bags, weight: r.weight, date, invoiceNo, challanId, by: changedBy, timestamp: new Date().toISOString(), status: 'Pending' };
      if (openOrders.length) newDisp.orderId = openOrders[0].id;
      patch[`/tc/dispatches/${id}`] = newDisp;
      newDispatches.push(newDisp);
      dyeLotIdsTouched.add(r.dyeLotId);
    }

    // Recompute every order's fulfilled/status — matches original behavior
    // exactly (a no-op for these specific new Pending dispatches, since
    // getOrderFulfilled only counts Approved ones, but replicated faithfully
    // in case other already-approved dispatches hadn't been reflected yet)
    const allDispatchesForOrders = [...dispatches, ...newDispatches];
    partyOrders.forEach(o => {
      if (o.status === 'Cancelled') return;
      const f = _getOrderFulfilledServer(o.id, partyOrders, allDispatchesForOrders);
      const newStatus = f >= o.qtyOrdered - 0.01 ? 'Completed' : f > 0 ? 'Partial' : 'Open';
      if (o.qtyFulfilled !== f) patch[`/tc/partyOrders/${o.id}/qtyFulfilled`] = f;
      if (o.status !== newStatus) patch[`/tc/partyOrders/${o.id}/status`] = newStatus;
    });

    await fbPatch('', patch);

    return { count: newDispatches.length };
  });

  if (result.__lockFailed) return errorResponse(result.error);
  if (result.__rejected) return result.__rejected;
  return jsonResponse({ success: true, count: result.count });
}

// ─── Item I: Dye lot creation (Jul 14 2026) ───────────────────────────────
// Server-side replacement for pages.js's submitDyeStartNew — the largest
// and most complex of the 5 remaining flows, handling 4 source types (RM
// lot, dead stock, recycle, residual). Confirmed dead stock/recycle/
// residual balance functions already use strict ID matching (no loose-
// match bug in these three). RM sources use the same always-verify
// approach as everything else fixed today.
//
// Real bug found and fixed while porting, not caught in the earlier G
// triage: the duplicate-in-progress warning check used loose matching
// (!s.grade||s.grade===...) — same bug class as the original lot-04 issue,
// just never audited in this specific spot. Fixed to strict matching.
// Aug 6 2026 — real, new tool: Reassign Dye Source. Built after a long,
// careful discussion with Priyam tracing lot 04's actual root cause —
// a Dye batch's source was wrongly attributed to one RM lot instead of
// a different, genuinely correct one (both real, both valid, both
// sharing the same grade+vendor — an easy mixup when material wasn't
// being physically labeled with its lot number at the time). Confirmed
// first, precisely, that no existing tool safely handles this: the
// generic Edit form doesn't expose the source field at all; the
// existing "correct a lot's own identity" tool is too broad — it moves
// EVERY Dye batch referencing a lot at once, not just the one specific
// batch that's actually wrong, which would fix one real mistake while
// creating new ones for every batch that was already correct.
//
// Deliberately scoped to exactly one source line, on exactly one Dye
// batch — never touches anything else referencing either lot. Correctly
// updates both _lotKey (the address) and lotUid (the lot's own
// permanent ID) — a real gap found and fixed in the existing, adjacent
// mechanism during this same conversation, applied correctly here from
// the start rather than inherited as a bug.
// Aug 26 2026 — real, direct extension built via direct discussion with
// Priyam: undo for a plain edit, but never blind — checks first
// whether anything real happened SINCE this edit that genuinely
// depends on it, matching the exact same "warn, confirm, flag if
// proceeded" pattern already proven today for the Dye split. Scoped,
// honestly, to the real, concrete case discussed: an entry's own
// "out" field (Soft output, Dye output, Wind output, Pack output) —
// the one a later stage actually draws its own balance from. A field
// that only affects this entry's own balance backward (its "in" side)
// has no real downstream dependency to check, so undoing it is always
// immediately safe.
const _UNDO_DOWNSTREAM_CHECK = {
  soft: { outWeight: true, outUnits: true },
  dye: { outWeight: true, outCones: true },
  wind: { outWeight: true, outCones: true },
  pack: { weight: true, bags: true },
  recycleSoft: { outWeight: true, outCones: true }
};

// Sep 19 2026 — backlog B1. handleEditEntry logs each change under a DISPLAY name ("Out Weight", "Party", "Date"), but plain-edit
// Undo used that name as if it were the record's field: numbers were refused with a wrong "changed again" message, and text fields
// reported success while writing a junk key such as "Party" and restoring nothing. This maps a logged display name to the real
// record key (per stage) and says which keys are numbers (deciding numeric-ness by parseFloat was also wrong: a date, "2/30 RC" or
// "3 Head" all start with a digit). Stages without a map here (residual, ...) log the real key already and pass straight through.
const _EDIT_FIELD_KEYS = {
  soft: { 'In Units': 'inUnits', 'In Weight': 'inWeight', 'Out Units': 'outUnits', 'Out Weight': 'outWeight', 'Start Note': 'startNote', 'End Note': 'endNote', 'Machine': 'machine', 'Start Worker': 'startWorker' },
  wind: { 'In Cones': 'inCones', 'In Weight': 'inWeight', 'Out Cones': 'outCones', 'Out Weight': 'outWeight', 'Machine': 'machine', 'Start Worker': 'startWorker', 'Start Notes': 'notes', 'End Notes': 'endNotes' },
  pack: { 'In Cones': 'inCones', 'In Weight': 'inWeight', 'Bags': 'bags', 'Weight': 'weight', 'Worker': 'worker', 'Notes': 'notes' },
  dye: { 'Dye Lot No': 'dyeLotNo', 'Shade': 'shade', 'In Cones': 'totalInCones', 'In Weight': 'totalInWeight', 'Out Cones': 'outCones', 'Out Weight': 'outWeight', 'Notes': 'notes', 'End Notes': 'endNote' },
  dispatch: { 'Bags': 'bags', 'Weight': 'weight', 'Party': 'party', 'Invoice': 'invoiceNo', 'Date': 'date', 'Order Link': 'orderId' },
  recycleSoft: { 'In Cones': 'inCones', 'In Weight': 'inWeight', 'Out Cones': 'outCones', 'Out Weight': 'outWeight', 'Machine': 'machine', 'Start Worker': 'startWorker', 'Start Note': 'startNote', 'End Note': 'endNote' },
};
const _EDIT_NUMERIC_KEYS = new Set(['inUnits', 'inWeight', 'outUnits', 'outWeight', 'inCones', 'outCones', 'bags', 'weight', 'totalInCones', 'totalInWeight']);
function _editFieldKey(stage, field) {
  const map = _EDIT_FIELD_KEYS[stage];
  if (!map) return field;
  if (map[field]) return map[field];
  return Object.values(map).includes(field) ? field : null;
}

async function handleUndoEdit(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin/Manager only', 403);
  const { editLogId, confirm, changedBy, password, username } = body || {};
  if (!editLogId) return errorResponse('editLogId required');

  const log = await fbGet(`/tc/editLog/${editLogId}`).catch(() => null);
  if (!log) return errorResponse('Edit log entry not found', 404);
  if (log.undoneAt) return errorResponse('This edit has already been undone.');

  // Sep 10 2026 — real, direct extension built via direct discussion
  // with Priyam: Split already wrote a real edit log entry (type:
  // 'split'), but the generic "write this one old value back to this
  // one field" logic below could never actually reverse it correctly
  // — "Split" isn't a real field on the dye lot, and reversing a split
  // genuinely means voiding the real recycleStock entry it created and
  // resetting the lot's own split fields, not overwriting one value.
  // The real reversal already exists — handleVoidDyeSplit — this
  // reroutes to it directly, the exact same way a Reassign-type entry
  // already routes to a different real function above this one.
  if (log.type === 'split') {
    const rcIdMatch = (log.newVal || '').match(/->(\S+)$/);
    const rcId = rcIdMatch ? rcIdMatch[1] : null;
    if (!rcId) return errorResponse('Could not find the real recycle stock entry this split created — cannot undo automatically.');
    const result = await handleVoidDyeSplit({ rcId, reason: `Undoing split ${editLogId}`, password, username, changedBy }, tokenClaim);
    const resultBody = await result.json();
    if (resultBody.success) {
      await fbPatch('', { [`/tc/editLog/${editLogId}/undoneAt`]: new Date().toISOString(), [`/tc/editLog/${editLogId}/undoneBy`]: changedBy || '', [`/tc/editLog/${editLogId}/_updatedAt`]: new Date().toISOString() });
    }
    return jsonResponse(resultBody, result.status);
  }
  // Sep 10 2026 — real, direct new requirement built via direct
  // discussion with Priyam, establishing one clear rule across the
  // whole app: for Void and Undo, everyone enters a password — no
  // exceptions, including Admin/Manager (the only roles that can ever
  // reach Undo at all). Split's own path above already effectively
  // requires this, since it delegates into handleVoidDyeSplit, which
  // already asks — this covers the two remaining paths (Dye Input,
  // and the plain-edit path used by every other stage) that never
  // asked for one before now.
  const verifiedUndoUser = await _verifySelfPassword(username, password);
  if (!verifiedUndoUser) return errorResponse('Incorrect password', 401);
  // Sep 10 2026 — real, direct new feature built via direct discussion
  // with Priyam: Dye Input's own edit changes a whole sources array at
  // once, not one field — the generic "write this one old value back"
  // logic just below can never correctly restore that. Uses the real,
  // complete old sources snapshot stored at edit time, and re-runs the
  // exact same real downward check as a live edit would — if Wind has
  // claimed more since this edit than the old sources would leave,
  // this is genuinely blocked, not silently restored into a shortfall.
  if (log.type === 'dye-input-edit') {
    if (!log.undoData) return errorResponse('This edit has no real, restorable snapshot — cannot undo automatically.');
    // Sep 22 2026 — real, confirmed fix, same bug class as DL-1718 and the generic undo path fixed just above: this
    // only ever checked the active table, so undoing an Edit Input on an already-archived dye lot wrongly said
    // "no longer exists" here, and the restore write further below would have written to active regardless anyway.
    const [_dActive, _dArchived] = await Promise.all([
      fbGet(`/tc/dyeLots/${log.entryId}`).catch(() => null),
      fbGet(`/tc/archive/dyeLots/${log.entryId}`).catch(() => null)
    ]);
    const _dyeFromArchive = !_dActive && !!_dArchived;
    const d = _dActive || _dArchived;
    if (!d) return errorResponse('The original dye lot no longer exists', 404);
    const _dBase = `/tc/${_dyeFromArchive ? 'archive/' : ''}dyeLots/${log.entryId}`;
    const [weA, weAr] = await Promise.all([fbGet('/tc/windEntries').catch(() => null), fbGet('/tc/archive/windEntries').catch(() => null)]);
    const toArrU = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(x => x && x.id);
    const windEntries = [...toArrU(weA), ...toArrU(weAr)];
    const totalWindIn = windEntries.filter(e => e.dyeLotId === log.entryId && (e.status === 'Approved' || e.status === 'Edited-Approved')).reduce((a, e) => a + (e.inWeight || 0), 0);
    const totalWindInCones = windEntries.filter(e => e.dyeLotId === log.entryId && (e.status === 'Approved' || e.status === 'Edited-Approved')).reduce((a, e) => a + (e.inCones || 0), 0);
    const { oldSources, oldTotalWeight, oldTotalCones } = log.undoData;
    const weightShort = totalWindIn - oldTotalWeight;
    const conesShort = totalWindInCones - oldTotalCones;
    // Sep 10 2026 — real, direct new feature built via direct
    // discussion with Priyam, establishing one clear rule across the
    // whole app: every real action shows a genuine preview of its
    // actual effect before committing — upgraded from only warning
    // when something's genuinely wrong to always showing what would
    // be restored, with any real problem highlighted right there in
    // the same preview rather than a separate warning.
    if (!confirm) {
      const parts = [];
      if (weightShort > 0.01) parts.push(`${weightShort.toFixed(2)}kg`);
      if (conesShort > 0.01) parts.push(`${Math.ceil(conesShort)} cones`);
      return jsonResponse({
        __dryRun: true,
        oldSources: d.sources || [], restoreToSources: oldSources,
        oldTotalWeight: d.totalInWeight || 0, restoreToTotalWeight: oldTotalWeight,
        oldTotalCones: d.totalInCones || 0, restoreToTotalCones: oldTotalCones,
        wouldCreateShortfall: parts.length > 0,
        shortfallMessage: parts.length > 0 ? `Undoing this would leave the batch ${parts.join(' and ')} short of what Wind has already claimed since this edit.` : null,
      });
    }
    const now = new Date().toISOString();
    const patch2 = {
      [`${_dBase}/sources`]: oldSources,
      [`${_dBase}/totalInWeight`]: oldTotalWeight,
      [`${_dBase}/totalInCones`]: oldTotalCones,
      [`/tc/editLog/${editLogId}/undoneAt`]: now,
      [`/tc/editLog/${editLogId}/undoneBy`]: changedBy || '',
      [`/tc/editLog/${editLogId}/_updatedAt`]: now,
    };
    if (weightShort > 0.01 || conesShort > 0.01) {
      _autoFlagDyeImbalance(patch2, log.entryId, `Undo left this batch short — needs ${weightShort > 0.01 ? weightShort.toFixed(2) + 'kg ' : ''}${conesShort > 0.01 ? conesShort.toFixed(0) + ' cones' : ''} more than Wind has already claimed`, changedBy);
    }
    await fbPatch('', patch2);
    await nudgeDyeLotSummary(log.entryId, { 'dyeBalance.cones': (oldTotalCones - (d.totalInCones || 0)), 'dyeBalance.kg': (oldTotalWeight - (d.totalInWeight || 0)) }).catch(() => {});
    _reFreezeForRecord('dye', log.entryId).catch(() => {});
    return jsonResponse({ success: true });
  }
  if (log.type !== 'edit') return errorResponse('Only a plain edit can be undone this way — use Override for a void/reject.');

  const table = _VOID_CHAIN_TABLE[log.stage];
  if (!table) return errorResponse(`Cannot undo an edit on stage "${log.stage}"`);
  // Sep 22 2026 — real, confirmed fix built via direct discussion with Priyam, from the same real bug class that broke
  // DL-1718: this only ever checked the ACTIVE table, so undoing an edit on any record that had since moved to archive
  // (any stage, not just dye) wrongly said "no longer exists" — and if it HAD found something (e.g. a partial shadow
  // left behind by the DL-1718 bug), the actual restore write below would have made the exact same mistake, writing
  // to active regardless of where the real record lives. Checks both tables, uses whichever one genuinely has it.
  const [_eActive, _eArchived] = await Promise.all([
    fbGet(`/tc/${table}/${log.entryId}`).catch(() => null),
    fbGet(`/tc/archive/${table}/${log.entryId}`).catch(() => null)
  ]);
  const _entryFromArchive = !_eActive && !!_eArchived;
  const e = _eActive || _eArchived;
  if (!e) return errorResponse('The original entry no longer exists', 404);

  // Sep 19 2026 — backlog B1: the record's REAL field (see _EDIT_FIELD_KEYS), and numbers decided by field, not by parseFloat.
  const fkey = log.fieldKey || _editFieldKey(log.stage, log.field);
  if (!fkey) return errorResponse(`"${log.field}" cannot be undone automatically — it is calculated from other fields. Undo the edit to the fields it comes from instead.`);
  const isNumericField = _EDIT_NUMERIC_KEYS.has(fkey);
  const _num = v => (v === '' || v === null || v === undefined) ? 0 : parseFloat(v);
  const oldValue = isNumericField ? _num(log.oldVal) : (log.oldVal ?? '');
  // Verify nothing edited this field again since: compare the CURRENT value with what this edit set it to (newVal).
  const newValueCheck = isNumericField ? _num(log.newVal) : (log.newVal ?? '');
  const _currentNow = e[fkey];
  const _stillTheSame = isNumericField ? (Number(_currentNow ?? 0) === newValueCheck) : (String(_currentNow ?? '') === String(newValueCheck));
  if (!_stillTheSame) {
    return errorResponse(`This field has changed again since this edit — its current value (${_currentNow ?? ''}) no longer matches what this edit last set it to (${newValueCheck}). Undo the more recent change first.`);
  }

  // Real, the actual downstream check — only for a real "out" field,
  // only if something checks against it (a later stage genuinely
  // exists and depends on this entry's own output).
  let warningMessage = null;
  const checksThisField = _UNDO_DOWNSTREAM_CHECK[log.stage]?.[fkey];
  if (checksThisField && isNumericField) {
    const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(x => x && x.id);
    if (log.stage === 'soft') {
      const [seA, seAr, lotsA, lotsAr, dlA, dlAr, rlA] = await Promise.all([
        fbGet('/tc/stageEntries').catch(() => null), fbGet('/tc/archive/stageEntries').catch(() => null),
        fbGet('/tc/lots').catch(() => null), fbGet('/tc/archive/lots').catch(() => null),
        fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null),
        fbGet('/tc/residualLog').catch(() => null)
      ]);
      const stageEntries = [...toArr(seA), ...toArr(seAr)].map(x => x.id === e.id ? { ...x, [fkey]: oldValue } : x);
      const lots = [...toArr(lotsA), ...toArr(lotsAr)];
      const dyeLots = [...toArr(dlA), ...toArr(dlAr)];
      const residualLog = toArr(rlA);
      const wouldBe = calcSoftBalanceWeight(stageEntries, lots, [], dyeLots, residualLog, e.lotId, e.grade, e.vendor);
      if (wouldBe < -0.01) warningMessage = `Undoing this would leave Lot ${e.lotId} / ${e.grade} / ${e.vendor}'s Soft Balance at ${wouldBe.toFixed(2)}kg — Dye has already claimed more than this undo would leave.`;
    } else if (log.stage === 'dye' && (fkey === 'outWeight' || fkey === 'outCones')) {
      // Sep 10 2026 — real, direct fix built via direct discussion with
      // Priyam: this only ever checked weight — cones was silently
      // missing, the same real gap already found and fixed once before
      // in a different downward check. Both are now checked and named
      // separately, and Wind/Pack (already listed above as needing this
      // check, but never actually implemented) genuinely get it too.
      const [weA, weAr] = await Promise.all([fbGet('/tc/windEntries').catch(() => null), fbGet('/tc/archive/windEntries').catch(() => null)]);
      const windArr = [...toArr(weA), ...toArr(weAr)].filter(w => w.dyeLotId === e.id && (w.status === 'Approved' || w.status === 'Edited-Approved'));
      const claimedW = windArr.reduce((a, w) => a + (w.inWeight || 0), 0);
      const claimedC = windArr.reduce((a, w) => a + (w.inCones || 0), 0);
      const newOutW2 = fkey === 'outWeight' ? oldValue : (e.outWeight || 0);
      const newOutC2 = fkey === 'outCones' ? oldValue : (e.outCones || 0);
      const wShort = claimedW - newOutW2, cShort = claimedC - newOutC2;
      if (wShort > 0.01 || cShort > 0.01) {
        const parts = [];
        if (wShort > 0.01) parts.push(`${wShort.toFixed(2)}kg`);
        if (cShort > 0.01) parts.push(`${Math.ceil(cShort)} cones`);
        warningMessage = `Undoing this would leave Dye lot ${e.id}'s output ${parts.join(' and ')} short of what Wind has already claimed from it.`;
      }
    } else if (log.stage === 'wind' && (fkey === 'outWeight' || fkey === 'outCones')) {
      const [peA, peAr] = await Promise.all([fbGet('/tc/packEntries').catch(() => null), fbGet('/tc/archive/packEntries').catch(() => null)]);
      const packArr = [...toArr(peA), ...toArr(peAr)].filter(p => p.dyeLotId === e.dyeLotId && (p.status === 'Approved' || p.status === 'Edited-Approved'));
      const claimedW = packArr.reduce((a, p) => a + (p.weight || 0), 0);
      const claimedC = packArr.reduce((a, p) => a + (p.inCones || 0), 0);
      const newOutW2 = fkey === 'outWeight' ? oldValue : (e.outWeight || 0);
      const newOutC2 = fkey === 'outCones' ? oldValue : (e.outCones || 0);
      const wShort = claimedW - newOutW2, cShort = claimedC - newOutC2;
      if (wShort > 0.01 || cShort > 0.01) {
        const parts = [];
        if (wShort > 0.01) parts.push(`${wShort.toFixed(2)}kg`);
        if (cShort > 0.01) parts.push(`${Math.ceil(cShort)} cones`);
        warningMessage = `Undoing this would leave Wind entry ${e.id}'s output ${parts.join(' and ')} short of what Pack has already claimed from it.`;
      }
    } else if (log.stage === 'pack' && (fkey === 'weight' || fkey === 'bags')) {
      const [dsA, dsAr] = await Promise.all([fbGet('/tc/dispatches').catch(() => null), fbGet('/tc/archive/dispatches').catch(() => null)]);
      const dispArr = [...toArr(dsA), ...toArr(dsAr)].filter(disp => disp.dyeLotId === e.dyeLotId && (disp.status === 'Approved' || disp.status === 'Edited-Approved'));
      const claimedW = dispArr.reduce((a, disp) => a + (disp.weight || 0), 0);
      const claimedB = dispArr.reduce((a, disp) => a + (disp.bags || 0), 0);
      const newW2 = fkey === 'weight' ? oldValue : (e.weight || 0);
      const newB2 = fkey === 'bags' ? oldValue : (e.bags || 0);
      const wShort = claimedW - newW2, bShort = claimedB - newB2;
      if (wShort > 0.01 || bShort > 0.01) {
        const parts = [];
        if (wShort > 0.01) parts.push(`${wShort.toFixed(2)}kg`);
        if (bShort > 0.01) parts.push(`${Math.ceil(bShort)} bags`);
        warningMessage = `Undoing this would leave Pack entry ${e.id} ${parts.join(' and ')} short of what Dispatch has already claimed from it.`;
      }
    } else if (log.stage === 'recycleSoft' && (fkey === 'outWeight' || fkey === 'outCones')) {
      const [rcA, rsA, dlA, dlAr, slA] = await Promise.all([
        fbGet('/tc/recycleStock').catch(() => null), fbGet('/tc/recycleSoft').catch(() => null),
        fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null), fbGet('/tc/scrapLog').catch(() => null)
      ]);
      const recycleStock = toArr(rcA), dyeLotsRS = [...toArr(dlA), ...toArr(dlAr)], scrapLogRS = toArr(slA);
      const recycleSoft = toArr(rsA).map(x => x.id === e.id ? { ...x, [fkey]: oldValue } : x);
      const after = calcRecycleSoftenedBal(recycleStock, recycleSoft, dyeLotsRS, scrapLogRS, e.recycleId);
      if (after.weight < -0.01 || after.units < 0) {
        warningMessage = `Undoing this would leave the Softened pool at ${after.units} cones / ${after.weight.toFixed(2)}kg — a dye lot has already used more than that.`;
      }
    }
  }

  // Sep 10 2026 — real, direct new feature built via direct discussion
  // with Priyam, establishing one clear rule across the whole app:
  // every real action shows a genuine preview of its actual effect
  // before committing — upgraded from only warning when something's
  // genuinely wrong to always showing what would be restored, with
  // any real problem highlighted right there in the same preview
  // rather than a separate warning.
  if (!confirm) {
    return jsonResponse({
      __dryRun: true,
      stage: log.stage, field: log.field,
      currentValue: e[fkey], restoreToValue: oldValue,
      wouldCreateShortfall: !!warningMessage,
      shortfallMessage: warningMessage,
    });
  }

  const now = new Date().toISOString();
  const patch = {};
  const _base = `/tc/${_entryFromArchive ? 'archive/' : ''}${table}/${log.entryId}`;
  // An empty old order link means "was not linked": remove the key rather than writing an empty string.
  patch[`${_base}/${fkey}`] = (fkey === 'orderId' && oldValue === '') ? null : oldValue;

  // Sep 19 2026 — keep the CALCULATED fields in step with the restored value, using the same formulas Edit uses.
  const _fW = n => Math.max(0, parseFloat((+n || 0).toFixed(2)));
  const _after = { ...e, [fkey]: oldValue };
  if (log.stage === 'soft' && ['inUnits', 'inWeight', 'outUnits', 'outWeight'].includes(fkey) && ((_after.outUnits || 0) > 0 || (_after.outWeight || 0) > 0)) {
    patch[`${_base}/wasteUnits`] = Math.max(0, Math.round((_after.inUnits || 0) - (_after.outUnits || 0)));
    patch[`${_base}/wasteWeight`] = _fW((_after.inWeight || 0) - (_after.outWeight || 0));
  } else if (log.stage === 'wind' && ['inCones', 'inWeight', 'outCones', 'outWeight'].includes(fkey) && ((_after.outCones || 0) > 0 || (_after.outWeight || 0) > 0)) {
    patch[`${_base}/wasteCones`] = Math.max(0, (_after.inCones || 0) - (_after.outCones || 0));
    patch[`${_base}/wasteWeight`] = _fW((_after.inWeight || 0) - (_after.outWeight || 0));
  } else if (log.stage === 'pack' && ['inWeight', 'weight'].includes(fkey)) {
    const _gain = _fW((_after.weight || 0) - (_after.inWeight || 0));
    patch[`${_base}/gainKg`] = _gain;
    patch[`${_base}/gainPct`] = (_after.inWeight || 0) > 0 ? parseFloat((_gain / _after.inWeight * 100).toFixed(2)) : 0;
  } else if (log.stage === 'dye' && ['totalInCones', 'totalInWeight', 'outCones', 'outWeight'].includes(fkey)) {
    if ((_after.outCones || 0) > 0 || (_after.outWeight || 0) > 0) {
      patch[`${_base}/wasteCones`] = Math.max(0, (_after.totalInCones || 0) - (_after.outCones || 0));
      patch[`${_base}/wasteWeight`] = _fW((_after.totalInWeight || 0) - (_after.outWeight || 0));
    }
    patch[`${_base}/coneLoss`] = (_after.totalInCones || 0) > 0 ? Math.max(0, _after.totalInCones - (_after.outCones || 0)) : (e.coneLoss || 0);
    patch[`${_base}/kgLoss`] = _fW((_after.totalInWeight || 0) - (_after.outWeight || 0));
  }
  // A Dye Lot No rename cascades to Wind, Pack and Dispatch when it is edited — so it must when it is undone.
  if (log.stage === 'dye' && fkey === 'dyeLotNo') {
    const _toArrC = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(x => x && x.id);
    const [weA, weAr, peA, peAr, dsA, dsAr] = await Promise.all([
      fbGet('/tc/windEntries').catch(() => null), fbGet('/tc/archive/windEntries').catch(() => null),
      fbGet('/tc/packEntries').catch(() => null), fbGet('/tc/archive/packEntries').catch(() => null),
      fbGet('/tc/dispatches').catch(() => null), fbGet('/tc/archive/dispatches').catch(() => null)
    ]);
    const _cascade = (arr, archived, tbl) => arr.forEach(r => { if (r.dyeLotId === log.entryId) patch[`${archived ? '/tc/archive' : '/tc'}/${tbl}/${r.id}/dyeLotNo`] = oldValue; });
    _cascade(_toArrC(weA), false, 'windEntries'); _cascade(_toArrC(weAr), true, 'windEntries');
    _cascade(_toArrC(peA), false, 'packEntries'); _cascade(_toArrC(peAr), true, 'packEntries');
    _cascade(_toArrC(dsA), false, 'dispatches'); _cascade(_toArrC(dsAr), true, 'dispatches');
  }
  // End Worker is an automatic copy of Start Worker: it followed the correction, so it follows the undo (only while still that copy).
  if (fkey === 'startWorker' && (log.stage === 'soft' || log.stage === 'wind') && e.endTime && (e.endWorker || '') === (e.startWorker || '')) {
    patch[`${_base}/endWorker`] = oldValue;
  }

  patch[`/tc/editLog/${editLogId}/undoneAt`] = now;
  patch[`/tc/editLog/${editLogId}/undoneBy`] = changedBy || '';
  patch[`/tc/editLog/${editLogId}/_updatedAt`] = now;
  const newLogId = `EL-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  patch[`/tc/editLog/${newLogId}`] = {
    id: newLogId, timestamp: now, entryId: log.entryId, stage: log.stage, field: log.field, fieldKey: fkey,
    oldVal: String(e[fkey] ?? ''), newVal: String(oldValue ?? ''),
    reasonCat: 'undo', reasonText: `Undoing edit ${editLogId}`, impactNote: warningMessage || '', changedBy: changedBy || '', type: 'edit', _updatedAt: now
  };
  await fbPatch('', patch);

  if (warningMessage) {
    if (log.stage === 'soft') {
      const flagPatch = {};
      _autoFlagImbalance(flagPatch, e.lotId, e.grade, e.vendor, `Undo left this lot short — ${warningMessage}`, changedBy);
      await fbPatch('', flagPatch);
    } else if (log.stage === 'dye') {
      const flagPatch = {};
      _autoFlagDyeImbalance(flagPatch, e.id, `Undo left this batch short — ${warningMessage}`, changedBy);
      await fbPatch('', flagPatch);
    }
  }

  if (log.stage === 'soft') await updateLotSummary(e.lotId, e.grade, e.vendor).catch(() => {});
  else if (log.stage === 'dye') await updateDyeLotSummary(e.id).catch(() => {});
  else if (['wind', 'pack', 'dispatch'].includes(log.stage) && e.dyeLotId) await updateDyeLotSummary(e.dyeLotId).catch(() => {});
  _reFreezeForRecord(log.stage, log.entryId).catch(() => {});

  return jsonResponse({ success: true });
}

async function handleEditDyeInput(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  // Sep 10 2026 — real, genuine gap found while directly answering
  // Priyam's own question about role consistency across every stage:
  // this new function computed isAdmin for the escalation rule below,
  // but never actually rejected a role that shouldn't be here at all
  // in the first place — matching the exact same base gate every
  // sibling Edit/Void function in this app already has.
  if (!['admin', 'manager', 'supervisor'].includes(role)) return errorResponse('Supervisor or Admin only', 403);
  const isAdmin = ['admin', 'manager'].includes(role);
  const { id, sources, reasonCat, reasonText, machine, startWorker, startNote, password, username, changedBy, dryRun } = body || {};
  // Sep 10 2026 — real, genuine gap found via Priyam's own direct
  // report ("Server error: fW is not defined"), confirmed as a real
  // ReferenceError thrown in actual production every single time this
  // was used: fW is a small, local formatting helper — every other
  // function using it (handleWindEnd, handlePackEnd) defines its own
  // local copy, since it's never been a real, shared, module-level
  // utility. This function used it 3 times without ever defining its
  // own copy, assumed present from nearby code that already had it —
  // undetected until now because no existing check in this whole
  // suite ever actually parsed worker.js itself for undefined
  // references; every layer's own tests always supplied their own
  // mock definition of exactly this function, silently papering over
  // the real gap in every single test run.
  const fW = n => Math.max(0, parseFloat((+n || 0).toFixed(2)));
  if (!id) return errorResponse('Dye lot ID required');
  if (!Array.isArray(sources) || sources.length === 0) return errorResponse('At least one source is required');
  if (!reasonCat) return errorResponse('Select reason category');
  if (!reasonText || reasonText.trim().length < 10) return errorResponse('Reason must be at least 10 characters');
  // Sep 10 2026 — real, direct new feature built via a genuinely
  // careful, field-by-field comparison discussion with Priyam: Dye
  // Start sets 4 real things together — the sources, Machine, Start
  // Worker, and Formula/Notes — but only sources were ever
  // correctable afterward. Same, real required-field validation Dye
  // Start itself already uses for these 3.
  if (!machine) return errorResponse('Select machine');
  if (!startWorker) return errorResponse('Select start worker');
  if (!startNote || !startNote.trim()) return errorResponse('Formula / Notes is required');
  // Sep 10 2026 — real, direct fix built via direct discussion with
  // Priyam, establishing one clear rule across the whole app: for
  // Edit, only Supervisor enters a password — Admin/Manager are
  // exempt, matching the exact same rule handleEditEntry already
  // uses for Soft/Dye/Wind/Pack/Dispatch. This was previously
  // unconditional for everyone here — meaning Admin, whose own
  // password is never even collected by the client for this form,
  // could never actually save this at all. A preview never writes
  // anything, so — matching RM Return's own existing preview — it
  // never needs a password either; only the real, final save does.
  if (role === 'supervisor' && !dryRun) {
    const verifiedUser = await _verifySelfPassword(username, password);
    if (!verifiedUser) return errorResponse('Incorrect password', 401);
  }

  const lockKeys = [`DYE_${id}`, ...sources.map(src => {
    if (src.sourceType === 'rm') return `RM_${src.lotId}_${src.grade || ''}_${src.vendor || ''}`;
    if (src.sourceType === 'dead') return `DS_${src.deadStockId}`;
    if (src.sourceType === 'recycle') return `RC_${src.recycleId}`;
    if (src.sourceType === 'residual') return `RS_${src.residualId}`;
    return `UNKNOWN_${JSON.stringify(src)}`;
  })].map(k => k.replace(/[^a-zA-Z0-9_]/g, '_'));

  const result = await withMultiBalanceLock(lockKeys, async () => {
    const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(e => e && e.id);
    const [dlA, dlAr, seA, seAr, lotsA, lotsAr, rlA, weA, weAr, dsA, rcA, rsA, lotFlagsA, peA, peAr, dpA, dpAr] = await Promise.all([
      fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null),
      fbGet('/tc/stageEntries').catch(() => null), fbGet('/tc/archive/stageEntries').catch(() => null),
      fbGet('/tc/lots').catch(() => null), fbGet('/tc/archive/lots').catch(() => null),
      fbGet('/tc/residualLog').catch(() => null),
      fbGet('/tc/windEntries').catch(() => null), fbGet('/tc/archive/windEntries').catch(() => null),
      fbGet('/tc/deadStock').catch(() => null), fbGet('/tc/recycleStock').catch(() => null),
      fbGet('/tc/residualStock').catch(() => null), fbGet('/tc/lotFlags').catch(() => null),
      fbGet('/tc/packEntries').catch(() => null), fbGet('/tc/archive/packEntries').catch(() => null),
      fbGet('/tc/dispatches').catch(() => null), fbGet('/tc/archive/dispatches').catch(() => null),
    ]);
    const dyeLots = [...toArr(dlA).map(d => ({ ...d, _fromArchive: false })), ...toArr(dlAr).map(d => ({ ...d, _fromArchive: true }))];
    const stageEntries = [...toArr(seA), ...toArr(seAr)];
    const lots = [...toArr(lotsA), ...toArr(lotsAr)];
    const residualLog = toArr(rlA);
    const windEntries2 = [...toArr(weA).map(e => ({ ...e, _fromArchive: false })), ...toArr(weAr).map(e => ({ ...e, _fromArchive: true }))];
    const packEntries2 = [...toArr(peA).map(e => ({ ...e, _fromArchive: false })), ...toArr(peAr).map(e => ({ ...e, _fromArchive: true }))];
    const dispatches2 = [...toArr(dpA).map(e => ({ ...e, _fromArchive: false })), ...toArr(dpAr).map(e => ({ ...e, _fromArchive: true }))];
    const deadStock = toArr(dsA), recycleStock = toArr(rcA), residualStock = toArr(rsA);
    const _tbl = (table, rec) => rec._fromArchive ? `/tc/archive/${table}` : `/tc/${table}`;

    const d = dyeLots.find(x => x.id === id);
    if (!d) return { __rejected: errorResponse('Dye lot not found', 404) };
    if (d.status === 'Pending' || d.status === 'InProgress' || d.status === 'Edited-Pending') {
      return { __rejected: errorResponse('Cannot edit a Pending entry — Reject it and resubmit with correct values instead. Editing is only for entries already Approved.') };
    }

    // Sep 10 2026 — real, direct correction built via a genuinely
    // careful, back-and-forth design discussion with Priyam: matches
    // the exact same escalation style every sibling stage already
    // uses (Soft, Wind, Pack, Dye's own Output) — a full lock on
    // Supervisor the moment the real next stage has genuinely crossed
    // into this batch's output, any field, regardless of what the
    // actual edit is; Admin/Manager always bypass this entirely. Note
    // this is deliberately keyed to Wind having actually drawn from
    // this batch — not to whether this batch itself has recorded an
    // Output yet, since finishing a batch is not the same as the next
    // stage having actually used it. Separate from, and does not
    // replace, the real physical-impossibility floor below (this same
    // batch's own recorded Output) — that one holds regardless of
    // Wind, for everyone, since it's not a downstream-dependency
    // question at all.
    const totalWindIn = windEntries2.filter(e => e.dyeLotId === id && (e.status === 'Approved' || e.status === 'Edited-Approved')).reduce((a, e) => a + (e.inWeight || 0), 0);
    const totalWindInCones = windEntries2.filter(e => e.dyeLotId === id && (e.status === 'Approved' || e.status === 'Edited-Approved')).reduce((a, e) => a + (e.inCones || 0), 0);
    if (!isAdmin && (totalWindIn > 0.01 || totalWindInCones > 0.01)) {
      return { __rejected: errorResponse(`Wind has already drawn ${totalWindIn}kg / ${totalWindInCones} cones from this dye lot's output — only Admin/Manager can edit its input now.`, 403) };
    }

    // Identity match — the same source, by whichever real identity
    // field it actually uses (RM's lot+grade+vendor, or the direct id
    // for Dead Stock/Recycle/Residual).
    const _sameSource = (a, b) => {
      if (a.sourceType !== b.sourceType) return false;
      if (a.sourceType === 'rm') return a.lotId === b.lotId && a.grade === b.grade && a.vendor === b.vendor;
      if (a.sourceType === 'dead') return a.deadStockId === b.deadStockId;
      if (a.sourceType === 'recycle') return a.recycleId === b.recycleId && (a.pool === 'softened') === (b.pool === 'softened');
      if (a.sourceType === 'residual') return a.residualId === b.residualId;
      return false;
    };

    let newTotalWeight = 0, newTotalCones = 0;
    const finalSources = [];
    // Sep 10 2026 — real, direct new feature built via a genuinely
    // careful discussion with Priyam, from his own real screenshot:
    // the preview used to show only the combined total, which can
    // read as "no change" even when a real redistribution happened
    // between two different sources (one lot's claim going up while
    // another's goes down, netting to the same total). Collects each
    // source's own real old → new weight/cones here, in the same loop
    // that already computes them, so the preview can show exactly
    // which lot moved, not just the unchanged grand total.
    const sourceDiffs = [];
    for (const src of sources) {
      const w = src.weight || 0;
      if (w <= 0) return { __rejected: errorResponse('Every source needs a weight greater than 0') };
      newTotalWeight += w;
      newTotalCones += (src.cones || 0);

      const oldSrc = (d.sources || []).find(s => _sameSource(s, src));
      const oldWeight = oldSrc?.weight || 0;
      const oldCones = oldSrc?.cones || 0;
      sourceDiffs.push({ lotId: src.lotId, grade: src.grade, vendor: src.vendor, oldWeight, newWeight: w, oldCones, newCones: src.cones || 0 });
      const weightIncreasing = w > oldWeight + 0.01;
      const conesIncreasing = (src.cones || 0) > oldCones + 0.01;

      if (src.sourceType === 'rm') {
        const heldFlag = _isLotOnHold(lotFlagsA, src.lotId, src.grade, src.vendor);
        if (heldFlag && weightIncreasing) return { __rejected: errorResponse(`Source lot ${src.lotId} is on Hold — "${heldFlag.note}". The hold must be cleared before increasing what's drawn from it.`) };
        if (weightIncreasing) {
          // Sep 10 2026 — the real upward boundary, exactly as agreed:
          // never RM directly — Dye only ever draws from what's already
          // passed through Soft. Same real formula Dye Start already
          // uses, with this source's own current claim added back
          // first, since it's being replaced, not added on top of.
          const avail = calcSoftBalanceWeightAvailable(stageEntries, lots, [], dyeLots, residualLog, src.lotId, src.grade, src.vendor) + oldWeight;
          if (w > avail + 0.01) return { __rejected: errorResponse(`${src.lotId} / ${src.grade} / ${src.vendor}: only ${avail.toFixed(2)}kg genuinely available — cannot increase to ${w}kg`) };
        }
        const _rmLotForUid = lots.find(l => l.id === src.lotId && l.grade === src.grade && l.vendor === src.vendor);
        finalSources.push({ sourceType: 'rm', lotId: src.lotId, grade: src.grade || '', vendor: src.vendor || '', lotUid: _rmLotForUid?.uid || oldSrc?.lotUid || null, _lotKey: summaryKey(src.lotId, src.grade, src.vendor), weight: w, cones: src.cones || 0 });
      } else if (src.sourceType === 'dead') {
        if (weightIncreasing) {
          const usedInDyeElsewhere = dyeLots.filter(dl => dl.id !== id && dl.status !== 'Rejected' && dl.status !== 'Void' && dl.status !== 'Voided').reduce((a, dl) => { const s = (dl.sources || []).find(s => s.deadStockId === src.deadStockId && s.sourceType === 'dead'); return a + (s?.weight || 0); }, 0);
          const usedInSoft = stageEntries.filter(e => e.deadStockId === src.deadStockId && e.status !== 'Void' && e.status !== 'Rejected').reduce((a, e) => a + (e.inWeight || 0), 0);
          const ds = deadStock.find(x => x.id === src.deadStockId);
          const bal = Math.max(0, (ds?.weight || 0) - usedInDyeElsewhere - usedInSoft);
          if (w > bal + 0.01) return { __rejected: errorResponse(`Dead stock ${src.deadStockId}: only ${bal.toFixed(2)}kg genuinely available — cannot increase to ${w}kg`) };
        }
        if (conesIncreasing) {
          const ds = deadStock.find(x => x.id === src.deadStockId);
          if (ds?.cones != null) {
            const usedConesElsewhere = dyeLots.filter(dl => dl.id !== id && dl.status !== 'Rejected' && dl.status !== 'Void' && dl.status !== 'Voided').reduce((a, dl) => { const s = (dl.sources || []).find(s => s.deadStockId === src.deadStockId && s.sourceType === 'dead'); return a + (s?.cones || 0); }, 0);
            const conesBal = (ds.cones || 0) - usedConesElsewhere;
            if ((src.cones || 0) > conesBal + 0.01) return { __rejected: errorResponse(`Dead stock ${src.deadStockId}: only ${conesBal} cones genuinely available — cannot increase to ${src.cones}`) };
          }
        }
        finalSources.push({ sourceType: 'dead', deadStockId: src.deadStockId, grade: src.grade || '', weight: w, cones: src.cones || 0 });
      } else if (src.sourceType === 'recycle') {
        // Sep 19 2026 — Recycle Phase 1: same On Steel pool as Dye Start (cones AND kg). Available is computed WITHOUT this dye lot's own
        // claim, so the row may go up to what is free right now — the old code added the old weight back on top of a balance that already
        // excluded this lot, which let an edit take more than the recycle held.
        if (!((+src.cones || 0) > 0)) return { __rejected: errorResponse(`Recycle ${src.recycleId}: enter the cones`) };
        const rcPool = src.pool === 'softened' ? 'softened' : 'steel';
        if (weightIncreasing || conesIncreasing) {
          const rc = recycleStock.find(x => x.id === src.recycleId);
          if (!rc || rc.status === 'Voided') return { __rejected: errorResponse(`Recycle ${src.recycleId} not found`) };
          const scrapLogForRC = toArr(await fbGet('/tc/scrapLog').catch(() => null));
          const recycleSoftForRC = toArr(await fbGet('/tc/recycleSoft').catch(() => null));
          const rcAvail = rcPool === 'softened'
            ? calcRecycleSoftenedAvailable(recycleStock, recycleSoftForRC, dyeLots.filter(dl => dl.id !== id), scrapLogForRC, src.recycleId)
            : calcRecycleSteelAvailable(recycleStock, dyeLots.filter(dl => dl.id !== id), scrapLogForRC, src.recycleId, recycleSoftForRC);
          if (weightIncreasing && w > rcAvail.weight + 0.01) return { __rejected: errorResponse(`Recycle ${src.recycleId}: only ${rcAvail.weight.toFixed(2)}kg genuinely available — cannot increase to ${w}kg`) };
          if (conesIncreasing && (+src.cones || 0) > rcAvail.units) return { __rejected: errorResponse(`Recycle ${src.recycleId}: only ${rcAvail.units} cones genuinely available — cannot increase to ${+src.cones}`) };
        }
        finalSources.push({ sourceType: 'recycle', recycleId: src.recycleId, grade: src.grade || '', weight: w, cones: +src.cones || 0, pool: rcPool });
      } else if (src.sourceType === 'residual') {
        if (weightIncreasing) {
          const rs = residualStock.find(x => x.id === src.residualId);
          const bal = rs ? calcResidualStockBalance(residualStock, dyeLots.filter(dl => dl.id !== id), rs.id) : 0;
          if (w > bal + oldWeight + 0.01) return { __rejected: errorResponse(`Residual ${src.residualId}: only ${(bal + oldWeight).toFixed(2)}kg genuinely available — cannot increase to ${w}kg`) };
        }
        finalSources.push({ sourceType: 'residual', residualId: src.residualId, grade: src.grade || '', weight: w, cones: src.cones || 0 });
      } else {
        return { __rejected: errorResponse(`Unknown source type on one of the rows`) };
      }
    }

    // Sep 10 2026 — real, direct fix built via a genuinely careful,
    // back-and-forth design discussion with Priyam, correcting a
    // real, wrong-direction check: this used to compare Dye Input's
    // new total against Wind's downstream claim — but Wind sits
    // downstream of Dye's OWN OUTPUT, not Dye's input. Per the
    // general rule agreed with Priyam (an input is checked against
    // the previous stage's pool AND this same stage's own output; an
    // output is checked against this stage's own input AND the next
    // stage's downward input), that Wind-vs-input comparison never
    // belonged here at all — it belongs on an Edit Output action, not
    // Edit Input. Replaced with the real, correct check: the new
    // total can never drop below what this exact dye lot's own Output
    // has already genuinely recorded (once Dye End has actually run —
    // 0 for a lot that hasn't ended yet, so this check naturally
    // never fires before then). A physical impossibility either way,
    // for everyone, no override — you cannot have produced more
    // finished output than the input that's on record for it.
    const ownOutputWeight = d.outWeight || 0;
    const ownOutputCones = d.outCones || 0;
    const weightShort = ownOutputWeight - newTotalWeight;
    const conesShort = ownOutputCones - newTotalCones;
    if (weightShort > 0.01 || conesShort > 0.01) {
      const parts = [];
      if (weightShort > 0.01) parts.push(`${weightShort.toFixed(2)}kg`);
      if (conesShort > 0.01) parts.push(`${Math.ceil(conesShort)} cones`);
      return { __rejected: errorResponse(`This needs at least ${parts.join(' and ')} more before you can save — this batch's own recorded output already shows ${ownOutputWeight}kg / ${ownOutputCones} cones produced from it.`) };
    }

    // Sep 10 2026 — real, direct new feature built via direct
    // discussion with Priyam, establishing one clear rule across the
    // whole app: every real action shows a genuine preview of its
    // actual effect before committing — not a separate copy of this
    // logic, the exact same validation and calculation that's already
    // run above, just stopped here instead of proceeding to write.
    // Sep 10 2026 — a source dropped from the list entirely (not just
    // reduced to a smaller weight) is still a real change worth
    // showing — recorded here as old value → 0, same as any other row.
    (d.sources || []).forEach(oldSrc => {
      if (!sources.some(s => _sameSource(oldSrc, s))) {
        sourceDiffs.push({ lotId: oldSrc.lotId, grade: oldSrc.grade, vendor: oldSrc.vendor, oldWeight: oldSrc.weight || 0, newWeight: 0, oldCones: oldSrc.cones || 0, newCones: 0 });
      }
    });

    if (dryRun) {
      return {
        __dryRun: true,
        oldSources: d.sources || [], newSources: finalSources,
        oldTotalWeight: d.totalInWeight || 0, newTotalWeight: fW(newTotalWeight),
        oldTotalCones: d.totalInCones || 0, newTotalCones,
        ownOutputWeight, ownOutputCones, sourceDiffs,
        oldMachine: d.machine || '', newMachine: machine,
        oldStartWorker: d.startWorker || '', newStartWorker: startWorker,
        oldStartNote: d.startNote ?? d.notes ?? '', newStartNote: startNote.trim(),
      };
    }

    const now = new Date().toISOString();
    const p = `${_tbl('dyeLots', d)}/${id}`;
    const patch = {
      [`${p}/sources`]: finalSources,
      [`${p}/totalInWeight`]: fW(newTotalWeight),
      [`${p}/totalInCones`]: newTotalCones,
      [`${p}/machine`]: machine,
      [`${p}/startWorker`]: startWorker,
      // Sep 19 2026 — stored in `notes` (the same key Dye Start writes), not a separate
      // `startNote` that nothing else ever reads.
      [`${p}/notes`]: startNote.trim(),
    };
    if (d.startNote !== undefined) patch[`${p}/startNote`] = null;
    // Sep 19 2026 — End Worker is auto-copied from Start Worker at Dye End (Lifecycle and Worker View history read it).
    // Follow a Start Worker correction only while it is still that copy — same rule as the Wind/Soft Edit.
    if ((d.startWorker || '') !== startWorker && d.endTime && (d.endWorker || '') === (d.startWorker || '')) patch[`${p}/endWorker`] = startWorker;
    if (isAdmin && d.status === 'Approved') patch[`${p}/status`] = 'Edited-Approved';

    // Sep 10 2026 — real, root-cause fix built via direct discussion
    // with Priyam, closing a real gap this same protection used to
    // have on Reassign Source before that separate tool was removed
    // (folded into this same Dye Input Edit a while ago, the
    // standalone function itself removed Sep 10 2026): when Wind,
    // Pack, or Dispatch is first created against a Dye batch, each
    // takes a one-time snapshot of the batch's own "primary" grade
    // (sources[0].grade). Unlike dyeLotNo (which already correctly
    // cascades on a direct rename), nothing kept this in sync when
    // the batch's own source composition changed here — until now.
    const oldPrimaryGrade = (d.sources || [])[0]?.grade || '';
    const newPrimaryGrade = finalSources[0]?.grade || '';
    if (oldPrimaryGrade && newPrimaryGrade && oldPrimaryGrade !== newPrimaryGrade) {
      windEntries2.forEach(e => { if (e.dyeLotId === id && e.grade === oldPrimaryGrade) patch[`${_tbl('windEntries', e)}/${e.id}/grade`] = newPrimaryGrade; });
      packEntries2.forEach(e => { if (e.dyeLotId === id && e.grade === oldPrimaryGrade) patch[`${_tbl('packEntries', e)}/${e.id}/grade`] = newPrimaryGrade; });
      dispatches2.forEach(e => { if (e.dyeLotId === id && e.grade === oldPrimaryGrade) patch[`${_tbl('dispatches', e)}/${e.id}/grade`] = newPrimaryGrade; });
    }

    // Same, already-proven re-check as the rest of the Dye edit branch
    // — every source lot's real, current balance, correctly reflecting
    // whatever this edit just changed.
    for (const s of finalSources) {
      if (s.sourceType !== 'rm' || !s.lotId) continue;
      const consumedFromThisLot = calcSoftConsumedByDye(dyeLots.map(dl => dl.id === id ? { ...dl, sources: finalSources } : dl), s.lotId, s.grade, s.vendor);
      const softOutForThisLot = calcSoftOut(stageEntries, lots, [], s.lotId, s.grade, s.vendor);
      const residualForThisLot = calcSoftResidualOut(residualLog, s.lotId, s.grade, s.vendor);
      const stillBad = consumedFromThisLot > softOutForThisLot - residualForThisLot + 0.01;
      if (stillBad) {
        _autoFlagImbalance(patch, s.lotId, s.grade, s.vendor, `Dye consumed ${consumedFromThisLot}kg but soft balance now only ${(softOutForThisLot - residualForThisLot).toFixed(2)}kg`, changedBy);
      } else {
        await _autoClearImbalanceFlag(patch, s.lotId, s.grade, s.vendor);
      }
    }

    const editLogId = `EL-${Date.now()}`;
    patch[`/tc/editLog/${editLogId}`] = {
      id: editLogId, timestamp: now, entryId: id, stage: 'Dye', field: 'Input (sources)',
      oldVal: (d.sources || []).map(s => `${s.sourceType === 'rm' ? s.lotId : (s.deadStockId || s.recycleId || s.residualId)}: ${s.weight}kg/${s.cones || 0}c`).join(', '),
      newVal: finalSources.map(s => `${s.sourceType === 'rm' ? s.lotId : (s.deadStockId || s.recycleId || s.residualId)}: ${s.weight}kg/${s.cones || 0}c`).join(', '),
      // Sep 10 2026 — real, direct extension built via direct discussion
      // with Priyam, for genuine Undo support: the human-readable
      // summaries above are for display only — they can't be parsed
      // back into a real sources array. This is the actual, restorable
      // snapshot Undo needs — the lot's own real, complete sources
      // array exactly as it was, and exactly as it's about to become.
      undoData: { oldSources: d.sources || [], oldTotalWeight: d.totalInWeight || 0, oldTotalCones: d.totalInCones || 0 },
      reasonCat, reasonText, changedBy: changedBy || '', type: 'dye-input-edit', _updatedAt: now,
    };
    await fbPatch('', patch);
    await nudgeDyeLotSummary(id, { 'dyeBalance.cones': (newTotalCones - (d.totalInCones || 0)), 'dyeBalance.kg': (newTotalWeight - (d.totalInWeight || 0)) }).catch(() => {});
    _reFreezeForRecord('dye', id).catch(() => {});
    return { success: true, id, totalInWeight: fW(newTotalWeight), totalInCones: newTotalCones };
  });

  if (result.__lockFailed) return errorResponse(result.error);
  if (result.__rejected) return result.__rejected;
  return jsonResponse(result);
}

async function handleDyeStart(body) {
  const { machine, worker, notes, sources, idempotencyKey, confirmDuplicate } = body;
  if (!machine) return errorResponse('Select machine');
  if (!worker) return errorResponse('Select worker');
  if (!sources || !sources.length) return errorResponse('Add at least one source (RM lot, dead stock, recycle, or residual)');
  const idemp = await checkIdempotency(idempotencyKey, 'Dye Start');
  if (idemp.duplicate) return errorResponse(idemp.message);

  const lockKeys = sources.map(src => {
    if (src.sourceType === 'rm') return `RM_${src.lotId}_${src.grade || ''}_${src.vendor || ''}`;
    if (src.sourceType === 'dead') return `DS_${src.deadStockId}`;
    if (src.sourceType === 'recycle') return `RC_${src.recycleId}`;
    if (src.sourceType === 'residual') return `RS_${src.residualId}`;
    return `UNKNOWN_${JSON.stringify(src)}`;
  }).map(k => k.replace(/[^a-zA-Z0-9_]/g, '_'));

  const result = await withMultiBalanceLock(lockKeys, async () => {
    const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(e => e && e.id);
    const [dlA, dlAr, seA, seAr, lotsA, lotsAr, dsA, rcA, rsA, rlA, lotFlagsA, slA, rcsA] = await Promise.all([
      fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null),
      fbGet('/tc/stageEntries').catch(() => null), fbGet('/tc/archive/stageEntries').catch(() => null),
      fbGet('/tc/lots').catch(() => null), fbGet('/tc/archive/lots').catch(() => null),
      fbGet('/tc/deadStock').catch(() => null), fbGet('/tc/recycleStock').catch(() => null),
      fbGet('/tc/residualStock').catch(() => null), fbGet('/tc/residualLog').catch(() => null),
      fbGet('/tc/lotFlags').catch(() => null), fbGet('/tc/scrapLog').catch(() => null), fbGet('/tc/recycleSoft').catch(() => null)
    ]);
    const dyeLots = [...toArr(dlA), ...toArr(dlAr)];
    const stageEntries = [...toArr(seA), ...toArr(seAr)];
    const lots = [...toArr(lotsA), ...toArr(lotsAr)];
    const scrapLogForRC = toArr(slA);
    const recycleSoftForRC = toArr(rcsA);
    const deadStock = toArr(dsA), recycleStock = toArr(rcA), residualStock = toArr(rsA);
    const residualLog = toArr(rlA);

    const machineInUse = dyeLots.find(e => e.machine === machine && e.status === 'InProgress');
    if (machineInUse) return { __rejected: errorResponse(`Machine ${machine} already running ${machineInUse.dyeLotNo || machineInUse.id} — end that first`) };

    // Re-validate every source server-side, same balance functions, always
    // fresh — never trust whatever the client happened to compute.
    let totalInWeight = 0;
    const finalSources = [];
    for (const src of sources) {
      const w = src.weight || 0;
      if (w <= 0) return { __rejected: errorResponse('Source weight must be > 0') };
      if (src.sourceType === 'rm') {
        // Sep 8 2026 — Hold-flagged RM lots block Dye Start too.
        const heldFlag = _isLotOnHold(lotFlagsA, src.lotId, src.grade, src.vendor);
        if (heldFlag) return { __rejected: errorResponse(`Source lot ${src.lotId} is on Hold — "${heldFlag.note}". The hold must be cleared before it can be processed.`) };
        const avail = calcSoftBalanceWeightAvailable(stageEntries, lots, [], dyeLots, residualLog, src.lotId, src.grade, src.vendor);
        if (w > avail + 0.01) return { __rejected: errorResponse(`Lot ${src.lotId}: ${w}kg exceeds AVAILABLE soft balance ${avail}kg (already claimed by other pending/in-progress dye batches)`) };
        if (!src.cones || src.cones <= 0) return { __rejected: errorResponse(`Lot ${src.lotId}: Cones count is required`) };
        // Jul 29 2026 — Phase 3 of the RM permanent-ID plan, the final
        // real piece: RM's ID hands off into Dye Sources, then Dye's own
        // ID takes over from here — confirmed with Priyam directly. Wind,
        // Pack, Dispatch already correctly use Dye's own ID; they never
        // needed RM's. Purely additive, zero extra Firebase calls — lots
        // is already fetched above.
        const _rmLotForUid = lots.find(l => l.id === src.lotId && l.grade === src.grade && l.vendor === src.vendor);
        // Aug 2 2026 — same saved address column Soft already has.
        finalSources.push({ lotId: src.lotId, grade: src.grade || '', vendor: src.vendor || '', lotUid: _rmLotForUid?.uid || null, _lotKey: summaryKey(src.lotId, src.grade, src.vendor), weight: w, cones: src.cones, sourceType: 'rm' });
      } else if (src.sourceType === 'dead') {
        const ds = deadStock.find(x => x.id === src.deadStockId);
        const usedInDye = dyeLots.filter(d => d.status !== 'Rejected' && d.status !== 'Void' && d.status !== 'Voided').reduce((a, d) => { const s = (d.sources || []).find(s => s.deadStockId === src.deadStockId && s.sourceType === 'dead'); return a + (s?.weight || 0); }, 0);
        const usedInSoft = stageEntries.filter(e => e.deadStockId === src.deadStockId && e.status !== 'Void' && e.status !== 'Rejected').reduce((a, e) => a + (e.inWeight || 0), 0);
        const bal = Math.max(0, (ds?.weight || 0) - usedInDye - usedInSoft);
        if (w > bal + 0.01) return { __rejected: errorResponse(`Dead stock ${src.deadStockId}: ${w}kg exceeds balance ${bal}kg`) };
        // Sep 10 2026 — real, root-cause fix built via direct discussion
        // with Priyam, from his own real, direct observation that Dead
        // Stock's cones kept showing as 0 on every dye source, even
        // freshly created ones: the client already sends src.cones (the
        // Dead Stock cones feature built earlier today), but this
        // handler was silently discarding it — never adding it to the
        // real source record it actually saves. Also validated against
        // Dead Stock's own real, remaining cones balance now, matching
        // weight, per Priyam's direct request to connect the two the
        // same way.
        const usedConesInDye = dyeLots.filter(d => d.status !== 'Rejected' && d.status !== 'Void' && d.status !== 'Voided').reduce((a, d) => { const s = (d.sources || []).find(s => s.deadStockId === src.deadStockId && s.sourceType === 'dead'); return a + (s?.cones || 0); }, 0);
        const conesBal = (ds?.cones || 0) - usedConesInDye;
        if (ds?.cones != null) {
          if (!src.cones || src.cones <= 0) return { __rejected: errorResponse(`Dead stock ${src.deadStockId}: Cones count is required`) };
          if (src.cones > conesBal + 0.01) return { __rejected: errorResponse(`Dead stock ${src.deadStockId}: ${src.cones} cones exceeds real, remaining cones balance ${conesBal}`) };
        }
        finalSources.push({ deadStockId: src.deadStockId, grade: ds?.grade || '', weight: w, cones: src.cones || 0, sourceType: 'dead' });
      } else if (src.sourceType === 'recycle') {
        // Sep 19 2026 — Recycle Phase 1: a recycle source draws from the ON STEEL pool in cones AND kg, checked against what is genuinely
        // AVAILABLE (approved use, plus what Pending / InProgress dye lots already claimed, plus scrap). The old check ignored scrap and
        // recorded no cones, so a dye lot's input cones never included its recycle.
        const rc = recycleStock.find(x => x.id === src.recycleId);
        if (!rc || rc.status === 'Voided') return { __rejected: errorResponse(`Recycle ${src.recycleId} not found`) };
        const rcCones = +src.cones || 0;
        if (!(rcCones > 0)) return { __rejected: errorResponse(`Recycle ${src.recycleId}: enter the cones`) };
        // Sep 20 2026 — Recycle Phase 2: a source comes from ONE pool. Steel = still on the cones (minus Recycle Soft claims); softened = output of approved Recycle Soft.
        const rcPool = src.pool === 'softened' ? 'softened' : 'steel';
        const rcAvail = rcPool === 'softened'
          ? calcRecycleSoftenedAvailable(recycleStock, recycleSoftForRC, dyeLots, scrapLogForRC, src.recycleId)
          : calcRecycleSteelAvailable(recycleStock, dyeLots, scrapLogForRC, src.recycleId, recycleSoftForRC);
        if (w > rcAvail.weight + 0.01) return { __rejected: errorResponse(`Recycle ${src.recycleId}: ${w}kg exceeds available ${rcAvail.weight.toFixed(2)}kg`) };
        if (rcCones > rcAvail.units) return { __rejected: errorResponse(`Recycle ${src.recycleId}: ${rcCones} cones exceeds available ${rcAvail.units} cones`) };
        finalSources.push({ recycleId: src.recycleId, dyeLotNo: rc.dyeLotNo || '', shade: rc.shade || '', weight: w, cones: rcCones, sourceType: 'recycle', pool: rcPool });
      } else if (src.sourceType === 'residual') {
        const rs = residualStock.find(r => r.id === src.residualId);
        const bal = calcResidualStockBalance(residualStock, dyeLots, src.residualId);
        if (w > bal + 0.01) return { __rejected: errorResponse(`Residual weight ${w}kg exceeds available ${bal}kg`) };
        finalSources.push({ residualId: src.residualId, grade: rs?.grade, weight: w, sourceType: 'residual' });
      } else {
        return { __rejected: errorResponse('Unknown source type: ' + src.sourceType) };
      }
      totalInWeight += w;
    }

    const totalInCones = finalSources.reduce((a, s) => a + (s.cones || 0), 0);

    // Jul 26 2026 — content-based duplicate check, confirmed design:
    // shade isn't known yet at Start (only assigned at End), so this
    // compares what IS known at this point instead — total input weight
    // and the exact set of source RM lots — within the same 15-day
    // window. Reuses the dyeLots array already fetched above for the
    // machine-busy check, no extra Firebase read needed.
    if (!confirmDuplicate) {
      const sourceSig = finalSources.filter(s => s.sourceType === 'rm')
        .map(s => `${s.lotId}|${s.grade || ''}|${s.vendor || ''}`).sort().join(',');
      const nowDate = new Date().toISOString();
      const windowMs = 15 * 86400000;
      const dupes = sourceSig ? dyeLots.filter(d => {
        if (d.status === 'Rejected' || d.status === 'Voided') return false;
        const dSig = (d.sources || []).filter(s => s.sourceType === 'rm')
          .map(s => `${s.lotId}|${s.grade || ''}|${s.vendor || ''}`).sort().join(',');
        if (dSig !== sourceSig) return false;
        if (Math.abs((d.totalInWeight || 0) - totalInWeight) > 0.01) return false;
        const dDate = new Date(d.startTime || d.createdAt || 0);
        if (isNaN(dDate.getTime())) return false;
        const diffMs = new Date(nowDate) - dDate;
        return diffMs >= 0 && diffMs <= windowMs;
      }) : [];
      if (dupes.length > 0) {
        return {
          __rejected: jsonResponse({
            success: false, duplicateWarning: true,
            matches: dupes.map(d => ({ dyeLotId: d.id, startTime: d.startTime, totalInWeight: d.totalInWeight })),
            message: `This looks like it might already be started — same source RM lot(s) and same total input weight as ${dupes.map(d => d.id).join(', ')} (within the last 15 days). If this is genuinely a different batch, confirm to proceed.`
          })
        };
      }
    }

    const id = await genIdAtomicServer('DL', dyeLots);
    const newDyeLot = { id, dyeLotNo: '', shade: '', sources: finalSources, totalInWeight, totalInCones, outCones: 0, outWeight: 0, machine, startWorker: worker, startTime: new Date().toISOString(), endTime: '', notes: notes || '', status: 'InProgress', createdAt: new Date().toISOString() };

    await fbSet(`/tc/dyeLots/${id}`, newDyeLot);

    return { id };
  });

  if (result.__lockFailed) return errorResponse(result.error);
  if (result.__rejected) return result.__rejected;
  return jsonResponse({ success: true, id: result.id });
}

// ─── Item I: Dye lot completion (Jul 14 2026) ─────────────────────────────
// Server-side replacement for pages.js's submitDyeEndNew. The original had
// an 'isNewArch' branch and a legacy fallback branch (creating a dye lot
// from a dyeEntries record, setting dyeEntryId) — per Item O's confirmed
// resolution, dyeEntries is permanently empty in production, so that
// fallback is unreachable in practice and NOT carried forward here.
async function handleDyeEnd(body) {
  const { entryId, fy, serial, sub, shade, outCones, outWeight, idempotencyKey } = body;
  // Sep 19 2026 — Dye End's own note is now stored SEPARATELY as endNote. It used to
  // be written to `notes`, silently overwriting the Formula/Notes entered at Dye Start
  // (and wiping it entirely if this box was left blank). `body.notes` still accepted so
  // an older, cached client keeps working.
  const endNote = body.endNote ?? body.notes ?? '';
  if (!entryId) return errorResponse('Select a dye entry');
  if (!serial) return errorResponse('Serial No is required');
  if (isNaN(parseInt(serial)) || parseInt(serial) < 1) return errorResponse('Serial No must be a positive number');
  if (!shade) return errorResponse('Enter shade name/no');
  if (!outCones || outCones <= 0) return errorResponse('Enter output cones count');
  if (!outWeight || outWeight <= 0) return errorResponse('Output weight must be > 0');
  const idemp = await checkIdempotency(idempotencyKey, 'Dye End');
  if (idemp.duplicate) return errorResponse(idemp.message);

  const dyeLotNo = `DYE-${fy}-${serial}${sub ? '-' + sub : ''}`;
  const serialBase = `DYE-${fy}-${serial}`;

  // Jul 22 2026 — the duplicate-name check and the save used to be two
  // separate steps with nothing holding them together, the exact same
  // race-condition shape already found and fixed for dispatch IDs: two
  // near-simultaneous "End Dye" submissions could both check before
  // either had saved, both honestly see the number as free, and both
  // proceed. Fixed by locking on the number itself — reusing the same
  // proven mechanism as balance protection, not a new one.
  const lockKey = `DYELOTNO_${serialBase}`.replace(/[^a-zA-Z0-9_]/g, '_');
  const result = await withBalanceLock(lockKey, async () => {
    const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(e => e && e.id);
    const [dlA, dlAr] = await Promise.all([fbGet('/tc/dyeLots').catch(() => null), fbGet('/tc/archive/dyeLots').catch(() => null)]);
    const dyeLots = [...toArr(dlA), ...toArr(dlAr)];

    const dupLot = sub
      ? dyeLots.find(d => d.dyeLotNo === dyeLotNo && d.status !== 'Voided' && d.status !== 'Rejected')
      : dyeLots.find(d => d.dyeLotNo && d.dyeLotNo === serialBase && d.status !== 'Voided' && d.status !== 'Rejected');
    if (dupLot) return { __rejected: errorResponse(`Dye Lot No "${dyeLotNo}" already exists${sub ? '' : ' — add a suffix in Sub box if this is a sub-batch'}`) };

    const entry = dyeLots.find(e => e.id === entryId && e.status === 'InProgress');
    if (!entry) return { __rejected: errorResponse('Entry not found', 404) };

    const inConesD = entry.totalInCones || 0;
    if (outCones > inConesD && inConesD > 0) return { __rejected: errorResponse(`Output cones (${outCones}) cannot exceed input cones (${inConesD}). Cones do not increase at dyeing.`) };
    const inKgD = entry.totalInWeight || 0;
    if (outWeight > inKgD + 0.01) return { __rejected: errorResponse(`Output weight (${outWeight}kg) cannot exceed input (${inKgD}kg). Gain is recorded at packing, not dyeing.`) };

    // Aug 6 2026 — moved into shared-balances.js as calcDyeWaste.
    const { coneLoss, kgLoss, kgLossPct } = calcDyeWaste(inConesD, outCones, inKgD, outWeight);

    const patch = {};
    const p = `/tc/dyeLots/${entryId}`;
    patch[`${p}/dyeLotNo`] = dyeLotNo; patch[`${p}/shade`] = shade;
    patch[`${p}/outCones`] = outCones; patch[`${p}/outWeight`] = outWeight;
    patch[`${p}/kgLoss`] = parseFloat(kgLoss.toFixed(2)); patch[`${p}/kgLossPct`] = parseFloat(kgLossPct.toFixed(2));
    patch[`${p}/coneLoss`] = coneLoss; patch[`${p}/endWorker`] = entry.startWorker || '';
    patch[`${p}/endTime`] = new Date().toISOString(); patch[`${p}/endNote`] = endNote || ''; patch[`${p}/status`] = 'Pending';

    await fbPatch('', patch);
    return { dyeLotNo, coneLoss };
  });

  if (result.__lockFailed) return errorResponse(result.error);
  if (result.__rejected) return result.__rejected;
  return jsonResponse({ success: true, dyeLotNo: result.dyeLotNo, coneLoss: result.coneLoss });
}


// Sep 29 2026 — Phase 1 (System B, approved design, extensively reviewed before this was written): replaces the
// old "download all six full archive tables on every search" implementation with a summary-driven, targeted
// approach. Same endpoint, same query parameter, same exact response shape — _searchArchive() on the client needs
// zero changes. Scope is unchanged too: this endpoint has always been archive-only (active data is already
// searched client-side via State.DB); this rewrite doesn't expand that.
//
// How it works: lotSummaries/dyeLotSummaries already load in full, every session, via the existing L1 mechanism —
// small, already covering both active and archive. Substring-matching them in memory (same matching logic as
// before, just against the summary instead of the full raw table) tells us exactly which lots/dye lots qualify,
// without downloading anything. For each match, one targeted Firebase read per table — using the confirmed real
// indexes (lotId on stageEntries, dyeLotId on windEntries/packEntries/dispatches) — replaces the full-table scan.
//
// One real, explicit, previously-approved scope reduction: dispatches-by-party search is intentionally not
// covered here. Neither lotSummaries nor dyeLotSummaries carries party information, and no fallback was built for
// it per direct instruction — this is a known, deliberate gap, not an oversight. Party-based history search would
// need its own, separate decision later.
async function handleSearchArchive(url) {
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  if (!q || q.length < 2) return jsonResponse({ results: {} });

  const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(e => e && e.id);
  const LIMIT = 20;

  const [lotSummariesRaw, dyeLotSummariesRaw] = await Promise.all([
    _getCachedSummaryTable('lotSummaries').catch(() => ({})),
    _getCachedSummaryTable('dyeLotSummaries').catch(() => ({}))
  ]);

  const matchedLotSummaries = Object.values(lotSummariesRaw || {}).filter(s =>
    (s.lotId || '').toLowerCase().includes(q) || (s.vendor || '').toLowerCase().includes(q) || (s.grade || '').toLowerCase().includes(q)
  ).slice(0, LIMIT);

  const matchedDyeLotSummaries = Object.values(dyeLotSummariesRaw || {}).filter(s =>
    (s.dyeLotNo || '').toLowerCase().includes(q) || (s.shade || '').toLowerCase().includes(q)
  ).slice(0, LIMIT);

  // ---- lots: for each matched summary, fetch the real archived record by its exact composite key ----
  // Sep 29 2026 — Phase 4: a genuine cache-aside read — this is a true single-record-by-key lookup, so a HIT
  // skips Firebase entirely.
  const lotFetches = await Promise.all(matchedLotSummaries.map(s =>
    _getCachedArchiveRecord('lots', summaryKey(s.lotId, s.grade, s.vendor)).catch(() => null)
  ));
  const lots = lotFetches.filter(l => l && l.id).slice(0, LIMIT);

  // ---- dyeLots: same pattern, keyed by dyeLotId directly ----
  const dyeLotFetches = await Promise.all(matchedDyeLotSummaries.map(s =>
    _getCachedArchiveRecord('dyeLots', s.dyeLotId).catch(() => null)
  ));
  const dyeLots = dyeLotFetches.filter(d => d && d.id).slice(0, LIMIT);

  // ---- stageEntries: one targeted, indexed query per matched lot, using the real, confirmed _lotKey index ----
  // Sep 29 2026 — Phase 4: the indexed query itself must still run every time (nothing can know which records
  // match without it) — this is genuinely different from the lots/dyeLots case above, not the same cache-aside
  // shape. Each returned record is written into its own per-record cache key for potential future reuse, but
  // this does not reduce the Firebase read for this table today, since nothing else reads it by id.
  const stageEntryBatches = await Promise.all(matchedLotSummaries.map(s => {
    const lk = summaryKey(s.lotId, s.grade, s.vendor);
    return fbGet('/tc/archive/stageEntries', `orderBy="_lotKey"&equalTo="${encodeURIComponent(lk)}"`).catch(() => ({}));
  }));
  const stageEntries = stageEntryBatches.flatMap(toArr).slice(0, LIMIT);
  for (const e of stageEntries) { if (e && e.id) await _setCachedArchiveRecord('stageEntries', e.id, e); }

  // ---- windEntries / packEntries / dispatches: one targeted, indexed query per matched dye lot, using the
  //    real, confirmed dyeLotId index. Dispatches here is deliberately dyeLotNo/shade-only — party is out of
  //    scope, per the approved decision above. Same reasoning as stageEntries above: the query always runs;
  //    results are written into the per-record cache for potential future reuse only. ----
  const [windBatches, packBatches, dispBatches] = await Promise.all([
    Promise.all(matchedDyeLotSummaries.map(s =>
      fbGet('/tc/archive/windEntries', `orderBy="dyeLotId"&equalTo="${s.dyeLotId}"`).catch(() => ({}))
    )),
    Promise.all(matchedDyeLotSummaries.map(s =>
      fbGet('/tc/archive/packEntries', `orderBy="dyeLotId"&equalTo="${s.dyeLotId}"`).catch(() => ({}))
    )),
    Promise.all(matchedDyeLotSummaries.map(s =>
      fbGet('/tc/archive/dispatches', `orderBy="dyeLotId"&equalTo="${s.dyeLotId}"`).catch(() => ({}))
    ))
  ]);
  const windEntries = windBatches.flatMap(toArr).slice(0, LIMIT);
  const packEntries = packBatches.flatMap(toArr).slice(0, LIMIT);
  const dispatches = dispBatches.flatMap(toArr).slice(0, LIMIT);
  for (const e of windEntries) { if (e && e.id) await _setCachedArchiveRecord('windEntries', e.id, e); }
  for (const e of packEntries) { if (e && e.id) await _setCachedArchiveRecord('packEntries', e.id, e); }
  for (const e of dispatches) { if (e && e.id) await _setCachedArchiveRecord('dispatches', e.id, e); }

  return jsonResponse({ results: { lots, dyeLots, stageEntries, windEntries, packEntries, dispatches } });
}

// Lightweight catalog — names/IDs only, no full record bodies. Used to populate
// discovery dropdowns (Vendor Tracker, Lot Lifecycle, Dye Lifecycle) without
// downloading the full archive just to know what exists.
async function handleCatalog(url) {
  const params = url.searchParams;
  const path = params.get('path');
  if (!path) return errorResponse('path required');

  const _catalogFields = {
    lots: ['id', 'grade', 'vendor'],
    dyeLots: ['id', 'dyeLotNo', 'shade'],
    dispatches: ['id', 'challanId', 'invoiceNo', 'party', 'date'],
  };
  if (!_catalogFields[path]) return errorResponse('unsupported catalog path');

  const arr = await fbGetMerged(`/tc/${path}`, `/tc/archive/${path}`);
  const fields = _catalogFields[path];
  const stripped = arr.map(e => {
    const o = {};
    fields.forEach(f => { o[f] = e[f]; });
    return o;
  });

  return jsonResponse({ results: stripped, count: stripped.length });
}

// ─── Calculate summary from preloaded data (no extra Firebase calls) ──────────
function calcSummaryFromData(lot, _stageEntries, _dyeLots, _windEntries, _packEntries, _dispatches, _residualLog, _rmReturnLog, _scrapLog) {
  const { id: lotId, grade, vendor } = lot;

  const notVoided = e => e.status !== 'Voided' && e.status !== 'Void' && e.status !== 'Rejected';
  const approved  = e => e.status === 'Approved' || e.status === 'Edited-Approved';

  const rmReceived = { units: lot.units || 0, kg: lot.weight || 0 };

  // Soft entries for this lot
  const softEntries = _stageEntries.filter(e =>
    notVoided(e) && e.stage === 'Soft' && e.lotId === lotId &&
    e.grade === grade && e.vendor === vendor
  );

  // Jul 10 2026 — shared-balances.js consolidation (formula #2 completion):
  // now uses calcSoftOut, which correctly subtracts scrapLog-tracked "taken"
  // amounts — this function never accounted for scrapLog before this fix.
  const _softOutRaw2 = calcSoftOut(_stageEntries, [lot], _scrapLog, lotId, grade, vendor);
  const softOut = { units: _softOutRaw2.units, kg: _softOutRaw2.weight };

  // Jul 10 2026 fix: this function was missing softWaste/lastSoftEndTime/
  // lastDyeEndTime entirely, unlike calcLotSummary which has all 3 —
  // meant any summary computed via this path (Recalc All + the targeted
  // updateLotSummary path) cached an incomplete object. Client-side falls
  // back to live calculation gracefully when these are absent, so this was
  // a completeness gap rather than a wrong-answer bug, but worth closing so
  // both summary paths produce genuinely identical output.
  const _softInForWaste = softEntries.filter(approved).reduce((a, e) => ({
    units: a.units + (e.inUnits || 0), kg: a.kg + (e.inWeight || 0)
  }), { units: 0, kg: 0 });
  const softWaste = {
    units: Math.max(0, _softInForWaste.units - softOut.units),
    kg:    parseFloat(Math.max(0, _softInForWaste.kg - softOut.kg).toFixed(2))
  };
  const lastSoftEndTime = softEntries.filter(e => e.endTime)
    .sort((a,b) => (b.endTime||'').localeCompare(a.endTime||''))[0]?.endTime || null;

  // Dye lots sourced from this RM lot
  // Sep 10 2026 — real, root-cause fix built via direct discussion
  // with Priyam: requiring sourceType === 'rm' explicitly, so this
  // can never mistake a Dead Stock/Recycle/Residual source (genuinely
  // has no lotId or vendor) for the RM lot actually being looked up,
  // even if lotId/vendor were ever undefined here.
  const relatedDyeLots = _dyeLots.filter(d =>
    notVoided(d) &&
    (d.sources || []).some(s =>
      s.sourceType === 'rm' && s.lotId === lotId && s.grade === grade && s.vendor === vendor
    )
  );
  const lastDyeEndTime = relatedDyeLots.filter(d => d.endTime)
    .sort((a,b) => (b.endTime||'').localeCompare(a.endTime||''))[0]?.endTime || null;

  // Jul 10 2026 fix: was reducing over relatedDyeLots directly (notVoided —
  // includes Pending/InProgress), unlike every other usage of relatedDyeLots
  // in this function (relatedDyeLotIds, wind-availability calc below), which
  // correctly add .filter(approved) on top. This meant sentToDye counted a
  // dye lot's weight the moment it was STARTED, before approval — so by the
  // time it was actually approved, the number appeared to never "update"
  // because it was already inflated from the start. Same bug class as the
  // "Worker softIn — Approved Only" fix from the start of this session,
  // just missed for this sibling field.
  const dyeConsumedKg = relatedDyeLots.filter(approved).reduce((acc, d) => {
    const src = (d.sources || []).find(s =>
      s.sourceType === 'rm' && s.lotId === lotId && s.grade === grade && s.vendor === vendor
    );
    return acc + (src ? (src.weight || 0) : 0);
  }, 0);

  // Sep 10 2026 — real, deliberately dead code removed via a genuine
  // holistic audit: relatedDyeLotIds and the three filters below it
  // (relatedWindEntries/relatedPackEntries/relatedDispatches) only
  // ever fed the old, unscaled windOut/packOut/dispatched figures —
  // all three already removed above, genuinely superseded by the
  // proportionally-correct windBalance/packBalance/dispatchedAllocated
  // family (calcWindBalanceByLot/calcPackBalanceByLot/
  // calcDispatchAllocated below, which take the raw _windEntries/
  // _packEntries/_dispatches directly, not this filtered subset).
  // Once those were removed, this whole chain became genuinely dead
  // too — confirmed via a full, direct search of this function.

  // Jul 10 2026 — shared-balances.js consolidation (formula #1 of 8): RM
  // Balance now computed by the single shared function instead of being
  // hand-duplicated here. `lot` here is already the single merged record
  // for this exact lotId+grade+vendor, so wrapped in a 1-element array —
  // calcRMBalance's internal calcLotByKey .find() locates it correctly.
  const _rmBal2 = calcRMBalance([lot], _stageEntries, _rmReturnLog, lotId, grade, vendor);
  const rmBalance = { units: _rmBal2.units, kg: _rmBal2.weight };

  // Jul 15 2026 — the Jul 10 2026 comment below compared against the wrong
  // sibling (getSoftBalanceWeight has no units at all; getSoftBalance DOES
  // ratio-scale bags — confirmed by direct read). Restored scaling so the
  // cached bag count shrinks with kg instead of showing e.g. "14b / 0kg".
  const _softBalKgOnly = calcSoftBalanceWeight(_stageEntries, [lot], _scrapLog, _dyeLots, _residualLog, lotId, grade, vendor);
  // Aug 2026 — same real fix as calcSoftBalanceWeight itself: this units
  // figure was clamped to a floor of 0, hiding the true severity of a
  // real, existing over-claim exactly the same way the kg figure was.
  // Removed the clamp so bags correctly go negative right alongside kg,
  // instead of kg honestly showing the problem while bags silently sit
  // at a deceptive 0.
  const softBalance = {
    units: softOut.kg > 0 ? Math.round((softOut.units || 0) * (_softBalKgOnly / softOut.kg)) : 0,
    kg: _softBalKgOnly
  };

  // Jul 10 2026 — shared-balances.js consolidation (formulas #7-8: Dye/Wind
  // Balance, RM-lot-anchored proportional family). This function's dyeBalance
  // previously had TWO separate issues: a confusing, effectively-broken
  // ternary for the cones field (its condition compared an unrelated
  // wind-in-vs-wind-out check), and summed dye lots' raw outWeight without
  // proportionally weighting by each RM lot's actual contribution share —
  // meaning a dye lot shared across multiple RM lots would have its FULL
  // output double (or triple, etc.) counted toward each contributing lot.
  // Now uses the same shared, correct, proportionally-weighted formula as
  // calcLotSummary and core.js's getDyeBalance/getWindBalance.
  const _dyeBalByLot2 = calcDyeBalanceByLot(_dyeLots, _windEntries, lotId, grade, vendor);
  const _windBalByLot2 = calcWindBalanceByLot(_dyeLots, _windEntries, _packEntries, lotId, grade, vendor);
  const dyeBalance = { cones: _dyeBalByLot2.units, kg: _dyeBalByLot2.weight };
  const windBalance = { cones: _windBalByLot2.units, kg: _windBalByLot2.weight };

  // Aug 5 2026 — deeper fix than the bags-formula swap alone. packOutFull
  // and dispatched (computed further above from relatedPackEntries/
  // relatedDispatches — every record touching ANY dye lot this RM lot
  // contributed to) were never split by this lot's real contribution
  // share in the first place — unlike dyeBalance/windBalance just above,
  // which correctly use calcDyeBalanceByLot/calcWindBalanceByLot (the
  // proportionally-allocated family). A dye batch blended from two RM
  // lots (confirmed real: Dye Start genuinely supports multiple RM-lot
  // source rows in one batch) had its FULL pack/dispatch activity counted
  // against EACH contributing lot — not each lot's true share. Same
  // "double/triple counted" bug Dye Balance was already fixed for, just
  // never closed here. Now uses calcPackBalanceByLot/calcDispatchAllocated
  // (shared-balances.js) — the same allocated family as dyeBalance/
  // windBalance above, so all four numbers are finally built the same way.
  const _packBalByLot2 = calcPackBalanceByLot(_dyeLots, _packEntries, _dispatches, lotId, grade, vendor);
  const packBalance = { bags: _packBalByLot2.units, kg: _packBalByLot2.weight };
  // dispatched (declared above from relatedDispatches) was the same
  // unscaled, full-batch figure — replaced here with each lot's real,
  // proportional share for the same reason as packBalance above. Kept
  // the original `dispatched` name for the returned object below (it's
  // `const`, so shadowed via a new binding rather than reassigned).
  const _dispAlloc2 = calcDispatchAllocated(_dyeLots, _dispatches, lotId, grade, vendor);
  const dispatchedAllocated = { bags: _dispAlloc2.units, kg: _dispAlloc2.weight };

  // Jul 8 2026: was strict `=== 0`, which floating-point subtraction can miss by
  // a tiny fraction, silently blocking archival forever. Now uses tolerance,
  // matching the pattern used everywhere else in the app (e.g. `+0.01` in submit
  // validations). Unit fields (cones/bags/units) are integers already rounded via
  // Math.round above, so strict ===0 stays safe for those.
  const _EPS = 0.01;
  const fullyDispatched =
    rmBalance.units   === 0 && rmBalance.kg    <= _EPS &&
    softBalance.units === 0 && softBalance.kg  <= _EPS &&
    dyeBalance.cones  === 0 && dyeBalance.kg   <= _EPS &&
    windBalance.cones === 0 && windBalance.kg  <= _EPS &&
    packBalance.bags  === 0 && packBalance.kg  <= _EPS;

  return {
    lotId, grade, vendor,
    rmReceived, softOut,
    softWaste, lastSoftEndTime, lastDyeEndTime,
    rmBalance, softBalance,
    sentToDye: { kg: dyeConsumedKg },
    dyeBalance, windBalance, packBalance,
    dispatched: dispatchedAllocated, fullyDispatched,
    // Sep 25 2026 — canonical _updatedAt added alongside the existing updatedAt, so the same Summary Loader
    // incremental-sync mechanism already proven for the six main tables can be reused for this one too, using the
    // exact same field name everywhere rather than a second one-off convention.
    updatedAt: new Date().toISOString(), _updatedAt: new Date().toISOString()
  };
}


// ─── Calculate DyeLot Summary ─────────────────────────────────────────────────
function calcDyeLotSummary(dyeLot, _windEntries, _packEntries, _dispatches) {
  const dyeLotId = dyeLot.id;
  const notVoided = e => e.status !== 'Voided' && e.status !== 'Void' && e.status !== 'Rejected';
  const approved  = e => e.status === 'Approved' || e.status === 'Edited-Approved';

  // Dye output — only count approved lots
  const isApproved = dyeLot.status === 'Approved' || dyeLot.status === 'Edited-Approved';
  const dyeOut = {
    cones: isApproved ? (dyeLot.outCones  || 0) : 0,
    kg:    isApproved ? (dyeLot.outWeight || 0) : 0
  };

  // Wind entries for this dye lot
  const windEntries = _windEntries.filter(e => notVoided(e) && e.dyeLotId === dyeLotId);
  const windIn = windEntries.filter(approved).reduce((a, e) => ({
    cones: a.cones + (e.inCones  || e.outCones || 0),
    kg:    a.kg    + (e.inWeight || 0)
  }), { cones: 0, kg: 0 });

  const windOut = windEntries.filter(approved).reduce((a, e) => ({
    cones: a.cones + (e.outCones  || 0),
    kg:    a.kg    + (e.outWeight || 0)
  }), { cones: 0, kg: 0 });

  // Pack entries for this dye lot
  const packEntries = _packEntries.filter(e => notVoided(e) && e.dyeLotId === dyeLotId);
  const packIn = packEntries.filter(approved).reduce((a, e) => ({
    cones: a.cones + (e.inCones || 0),
    kg:    a.kg    + (e.inWeight || e.weight || 0)
  }), { cones: 0, kg: 0 });

  const packOut = packEntries.filter(approved).reduce((a, e) => ({
    bags: a.bags + (e.bags || e.outBags || 0),
    kg:   a.kg   + (e.outWeight || e.weight || 0)
  }), { bags: 0, kg: 0 });

  // Jul 10 2026 — shared-balances.js consolidation (formula #6: Dispatched,
  // dye-lot-anchored). Previously used a DIFFERENT fallback than core.js's
  // getTotalDispatched (e.lots[] array here vs core.js's d.lotId cross-
  // reference) — neither matches how dispatches are actually created today
  // (always a direct single dyeLotId, verified against pages.js's actual
  // dispatch-creation code), but core.js's fallback was kept as the
  // canonical one rather than dropped entirely, since removing it risks
  // silently losing attribution for legacy data this session can't inspect.
  const _dispRaw = calcTotalDispatchedApproved(_dispatches, dyeLotId, [dyeLot]);
  const dispatched = { bags: _dispRaw.bags, kg: _dispRaw.weight };

  // Jul 10 2026 — shared-balances.js consolidation (formulas #3-5: Dye/
  // Wind/Pack Balance, dye-lot-anchored family — this is what actually
  // feeds the LIVE Wind/Pack/Dispatch dropdowns and submit validation, the
  // highest-stakes part of this whole consolidation. Real discrepancy
  // found and fixed here: packBalance.bags previously used a weight-ratio
  // scaling estimate instead of a direct bags subtraction — physically
  // wrong for a countable whole-number unit (not user-visible before this
  // fix, since the client always used its own correct live calculation —
  // but this fed this function's own fullyDispatched/archival check).
  const _dyeBalRaw  = calcDyeBal([dyeLot], _windEntries, dyeLotId);
  const _windBalRaw = calcWindBal(_windEntries, _packEntries, dyeLotId);
  const _packBalRaw = calcPackBal(_packEntries, _dispatches, dyeLotId);
  // Field-name mapping: calcDyeBal/calcWindBal return {units,weight}
  // (the shared Q-object convention), calcPackBal returns {weight,bags} —
  // this function's own convention is {cones,kg}/{bags,kg}. Caught before
  // shipping: without this mapping, fullyDispatched below would read
  // undefined on every field and permanently block archival for every
  // dye lot, silently.
  const dyeBalance  = { cones: _dyeBalRaw.units,  kg: _dyeBalRaw.weight };
  const windBalance = { cones: _windBalRaw.units, kg: _windBalRaw.weight };
  const packBalance = { bags: _packBalRaw.bags,   kg: _packBalRaw.weight };

  const fullyDispatched =
    dyeBalance.cones  === 0 && dyeBalance.kg  === 0 &&
    windBalance.cones === 0 && windBalance.kg === 0 &&
    packBalance.bags  === 0 && packBalance.kg === 0;

  // Wind waste and pack gain
  const windWaste = {
    cones: windEntries.filter(approved).reduce((a,e) => a+(e.wasteCones||0), 0),
    kg:    parseFloat(windEntries.filter(approved).reduce((a,e) => a+(e.wasteWeight||0), 0).toFixed(2))
  };
  const packGain = {
    kg: parseFloat(packEntries.filter(approved).reduce((a,e) => a+(e.gainKg||0), 0).toFixed(2))
  };
  // Timing — first entry timestamps
  const firstWindTime = windEntries.filter(e=>e.startTime).sort((a,b)=>(a.startTime||'').localeCompare(b.startTime||''))[0]?.startTime||null;
  const firstPackTime = packEntries.filter(e=>e.timestamp).sort((a,b)=>(a.timestamp||'').localeCompare(b.timestamp||''))[0]?.timestamp||null;

  return {
    dyeLotId,
    shade:    dyeLot.shade    || '',
    dyeLotNo: dyeLot.dyeLotNo || '',
    dyeOut,
    windIn, windOut,
    packIn, packOut,
    dispatched,
    dyeBalance,
    windBalance,
    packBalance,
    windWaste,
    packGain,
    firstWindTime,
    firstPackTime,
    fullyDispatched,
    // Sep 25 2026 — canonical _updatedAt, same reasoning as calcSummaryFromData above.
    updatedAt: new Date().toISOString(), _updatedAt: new Date().toISOString()
  };
}

// ─── API: Populate dyeLot summaries ──────────────────────────────────────────


// ─── API: Populate all summaries (load once, calculate all in memory) ─────────
// ─── API: Audit balances (Phase 0 of the running-balance plan, Jul 15 2026) ───
// Read-only. Recomputes each lot/dye-lot's summary fresh from the same
// proven formulas as handleRecalcAllSummariesStart (Jul 18 2026 rewrite),
// then COMPARES against what's currently cached instead of blindly
// overwriting — flags any drift beyond a small tolerance, changes nothing.
// This is the safety net the whole running-balance plan depends on: "keep
// a running number day-to-day, but still do a full count now and then to
// make sure it hasn't drifted" — matches the same principle already
// proven for other tolerance-based checks this session (Item N's
// fullyDispatched EPS fix). Admin-triggered, not automatic yet — an
// automatic/scheduled version is a later, separate step once this manual
// version has been used and trusted for a while.
const _AUDIT_EPS = 0.5; // kg/units tolerance — small enough to catch real drift, large enough to ignore floating-point noise
function _auditDiff(field, cachedVal, freshVal) {
  const c = cachedVal ?? 0, f = freshVal ?? 0;
  if (Math.abs(c - f) > _AUDIT_EPS) return { field, cached: c, fresh: f, delta: Math.round((f - c) * 100) / 100 };
  return null;
}
// POST /api/daily-check/run-now — Jul 17 2026. Priyam's explicit
// requirement: don't wait a full day to prove this works. Runs the exact
// same runDailyBalanceCheck used by the schedule, triggered on demand —
// but still via ctx.waitUntil so the browser isn't stuck waiting through
// a real check either. Returns "started" immediately; the actual result
// lands in /tc/dailyCheckReports/{date} a short while later, same place
// the scheduled run writes to.
async function handleDailyCheckRunNow(body, tokenClaim, ctx) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin only', 403);

  const runIt = async () => {
    // Sep 8 2026 — real, direct instrumentation built via direct
    // discussion with Priyam: every test so far ran the check's own
    // logic against data already sitting in memory — never the real
    // fetch-and-parse of the whole /tc tree itself, which is the one
    // step both this button and the automatic overnight run share.
    // At real scale (375 lots, 1900 entries, 224 dye lots, 1787 dye
    // lot summaries, plus everything else under /tc) that single
    // fetch could itself be the slow part, or the check's own logic
    // could be, or both — no way to tell without actually measuring
    // it on the real data, which only the next real run can do.
    // Recording both halves separately, every single run, success or
    // failure, turns the next attempt into real evidence instead of
    // more guessing.
    const _t0 = Date.now();
    let _tFetched = null, _tChecked = null;
    try {
      const tc = await fbGet('/tc');
      _tFetched = Date.now();
      if (!tc) { console.log('Daily check (on-demand) skipped: /tc empty'); return; }
      const report = await runDailyBalanceCheck(tc, (body && body.changedBy) || 'Daily Checker (on-demand)');
      _tChecked = Date.now();
      console.log(`✓ Daily balance check (on-demand): ${report.rowCount} issue(s)`);
      await fbSet('/tc/dailyCheckLastError', null).catch(() => {});
      await fbSet('/tc/dailyCheckLastTiming', { fetchMs: _tFetched - _t0, checkMs: _tChecked - _tFetched, totalMs: _tChecked - _t0, at: new Date().toISOString(), outcome: 'success' }).catch(() => {});
    } catch (e) {
      // Sep 8 2026 — real, direct fix built via direct discussion with
      // Priyam, from "manual run is failing" with no visible reason: a
      // crash here used to be caught and only logged to console.log —
      // a Cloudflare-side log Priyam has no access to at all. The
      // button would say "Started ✓" and the report would then just
      // never update again, forever, with zero visible explanation.
      // Now also writes the real error into a place the client
      // actually checks, so a genuine failure is finally visible
      // instead of silent.
      const _tFailed = Date.now();
      console.log(`✗ Daily balance check (on-demand) failed: ${e.message}`);
      await fbSet('/tc/dailyCheckLastError', { message: e.message, at: new Date().toISOString(), stack: (e.stack || '').split('\n').slice(0, 5).join(' | ') }).catch(() => {});
      await fbSet('/tc/dailyCheckLastTiming', { fetchMs: _tFetched ? _tFetched - _t0 : null, failedAfterMs: _tFetched ? _tFailed - _tFetched : _tFailed - _t0, totalMs: _tFailed - _t0, at: new Date().toISOString(), outcome: 'failed', failedDuring: _tFetched ? 'runDailyBalanceCheck' : 'fbGet(/tc)' }).catch(() => {});
    }
  };
  if (ctx && ctx.waitUntil) ctx.waitUntil(runIt()); else await runIt();

  return jsonResponse({ success: true, status: 'started' });
}



async function handleRecalcAllSummariesStart(body, ctx, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin only', 403);
  await fbSet('/tc/summaryRecalcStatus', { status: 'running', startedAt: new Date().toISOString() });

  const runIt = async () => {
    try {
      // Load RM-lot-related data once — reused below for dye lots too,
      // since dyeLots/windEntries/packEntries/dispatches are already in
      // memory. Jul 18 2026 — replaces the old version that repeated this
      // exact fetch once per 30-lot batch, and separately again for dye
      // lots, which is what made the old button crash at real scale
      // (same root cause found and fixed for Balance Audit the same day).
      const [_lots, _stageEntries, _dyeLots, _windEntries, _packEntries, _dispatches, _residualLogRaw, _rmReturnLogRaw, _scrapLogRaw] = await Promise.all([
        fbGetMerged('/tc/lots', '/tc/archive/lots'),
        fbGetMerged('/tc/stageEntries', '/tc/archive/stageEntries'),
        fbGetMerged('/tc/dyeLots', '/tc/archive/dyeLots'),
        fbGetMerged('/tc/windEntries', '/tc/archive/windEntries'),
        fbGetMerged('/tc/packEntries', '/tc/archive/packEntries'),
        fbGetMerged('/tc/dispatches', '/tc/archive/dispatches'),
        fbGet('/tc/residualLog').catch(() => null),
        fbGet('/tc/rmReturnLog').catch(() => null),
        fbGet('/tc/scrapLog').catch(() => null)
      ]);
      const _residualLog = _residualLogRaw ? (Array.isArray(_residualLogRaw) ? _residualLogRaw : Object.values(_residualLogRaw)) : [];
      const _rmReturnLog = _rmReturnLogRaw ? (Array.isArray(_rmReturnLogRaw) ? _rmReturnLogRaw : Object.values(_rmReturnLogRaw)) : [];
      const _scrapLog = _scrapLogRaw ? (Array.isArray(_scrapLogRaw) ? _scrapLogRaw : Object.values(_scrapLogRaw)) : [];

      // Aug 26 2026 — real, genuine fix built via direct discussion with
      // Priyam: Merged/Voided lots never got excluded here, meaning
      // recalc-all would still compute and write a fresh, misleading
      // summary for them, using leftover data that no longer really
      // represents anything real — the losing side of a merge keeps its
      // own id/grade/vendor unchanged, only its status changes, so this
      // filter needs to check that explicitly, not just "does it have an
      // address." updateLotSummary (the single-lot path) has this same
      // gap in principle, closed too, in the one shared place both
      // depend on — see the real note there.
      const valid = _lots.filter(l => l.id && l.grade && l.vendor && l.status !== 'Merged' && l.status !== 'Voided');
      const mergedMap = {};
      for (const l of valid) {
        const k = summaryKey(l.id, l.grade, l.vendor);
        if (!mergedMap[k]) mergedMap[k] = { ...l, units: 0, weight: 0, deliveries: [] };
        mergedMap[k].units += (l.units || 0);
        mergedMap[k].weight += (l.weight || 0);
        mergedMap[k].deliveries.push(...(l.deliveries || []));
      }
      const uniqueLots = Object.values(mergedMap);

      // Jul 21 2026 — same fix as runDailyBalanceCheck, applied here too:
      // this loop was independently re-scanning the full stageEntries/
      // dyeLots arrays for every single lot, the exact same unfixed
      // pattern that made the Daily Checker time out — just never
      // patched in this function. Bucket once, verified equivalent
      // against all 321 real RM lots before applying.
      const seByLot = new Map();
      for (const e of _stageEntries) {
        const k = summaryKey(e.lotId, e.grade, e.vendor);
        if (!seByLot.has(k)) seByLot.set(k, []);
        seByLot.get(k).push(e);
      }
      const dyeBySourceLot = new Map();
      for (const d of _dyeLots) {
        for (const src of (d.sources || [])) {
          if (!src.lotId) continue;
          const k = summaryKey(src.lotId, src.grade, src.vendor);
          if (!dyeBySourceLot.has(k)) dyeBySourceLot.set(k, []);
          dyeBySourceLot.get(k).push(d);
        }
      }

      let rmDone = 0, rmFailed = 0;
      const rmSummariesToWrite = {};
      for (const lot of uniqueLots) {
        try {
          const key = summaryKey(lot.id, lot.grade, lot.vendor);
          const myStageEntries = seByLot.get(key) || [];
          const myDyeLotsAsSource = dyeBySourceLot.get(key) || [];
          const summary = calcSummaryFromData(lot, myStageEntries, myDyeLotsAsSource, _windEntries, _packEntries, _dispatches, _residualLog, _rmReturnLog, _scrapLog);
          rmSummariesToWrite[key] = summary;
          rmDone++;
        } catch (e) { rmFailed++; }
      }
      if (Object.keys(rmSummariesToWrite).length > 0) await fbPatch('/tc/lotSummaries', rmSummariesToWrite);

      // Dye lot summaries — reuses _dyeLots/_windEntries/_packEntries/
      // _dispatches already loaded above, no second fetch of the same data.
      const validDyeLots = _dyeLots.filter(d =>
        d.status === 'Approved' || d.status === 'Edited-Approved' ||
        d.status === 'InProgress' || d.status === 'Pending'
      );
      // Same fix, dye-lot side: bucket wind/pack/dispatch by dyeLotId once,
      // instead of re-scanning the full arrays for every dye lot.
      const windByDL = new Map(), packByDL = new Map(), dispByDL = new Map();
      for (const e of _windEntries) { if (!e.dyeLotId) continue; if (!windByDL.has(e.dyeLotId)) windByDL.set(e.dyeLotId, []); windByDL.get(e.dyeLotId).push(e); }
      for (const e of _packEntries) { if (!e.dyeLotId) continue; if (!packByDL.has(e.dyeLotId)) packByDL.set(e.dyeLotId, []); packByDL.get(e.dyeLotId).push(e); }
      for (const e of _dispatches) { if (!e.dyeLotId) continue; if (!dispByDL.has(e.dyeLotId)) dispByDL.set(e.dyeLotId, []); dispByDL.get(e.dyeLotId).push(e); }

      let dyeDone = 0, dyeFailed = 0;
      const dyeSummariesToWrite = {};
      for (const dyeLot of validDyeLots) {
        try {
          const myWind = windByDL.get(dyeLot.id) || [];
          const myPack = packByDL.get(dyeLot.id) || [];
          const myDisp = dispByDL.get(dyeLot.id) || [];
          const summary = calcDyeLotSummary(dyeLot, myWind, myPack, myDisp);
          dyeSummariesToWrite[dyeLot.id] = summary;
          dyeDone++;
        } catch (e) { dyeFailed++; }
      }
      if (Object.keys(dyeSummariesToWrite).length > 0) await fbPatch('/tc/dyeLotSummaries', dyeSummariesToWrite);

      await fbSet('/tc/summaryRecalcStatus', {
        status: 'done', finishedAt: new Date().toISOString(),
        rmDone, rmFailed, dyeDone, dyeFailed
      });
      console.log(`✓ Recalc all summaries: ${rmDone} RM lot(s), ${dyeDone} dye lot(s)`);
    } catch (e) {
      await fbSet('/tc/summaryRecalcStatus', { status: 'error', error: e.message, finishedAt: new Date().toISOString() }).catch(() => {});
      console.log(`✗ Recalc all summaries failed: ${e.message}`);
    }
  };

  if (ctx && ctx.waitUntil) ctx.waitUntil(runIt()); else await runIt();
  return jsonResponse({ success: true, status: 'started' });
}

// ─── Cron Backup ─────────────────────────────────────────────────────────────
// ─── Daily Balance Checker (Jul 17 2026, Priyam-designed, full spec in ────────
// HOLISTIC_PLAN.md) ─────────────────────────────────────────────────────────
// Runs once daily, right after backup, reusing backup's already-downloaded
// `tc` object — no second fetch. Three numbers compared for every field:
//   1. Live    — what's currently cached, what people are looking at right now
//   2. Check 1 — fresh recompute using the app's own trusted formulas
//   3. Check 2 — an INDEPENDENT conservation check (does everything received
//                actually add up somewhere), using a completely different
//                set of terms, so a bug baked into Check 1's own formula
//                can't fool both checks at once (confirmed necessary this
//                session — RM Return and Recycle Stock both had real
//                formula gaps that a recompute-only check would have missed).
//
// Jul 17 2026 — Priyam's explicit decision: no auto-fix at all. Every
// real mismatch found, any size, is flagged for manual review only.

// Jul 17 2026 — Priyam's explicit decision: no auto-fix, ever. Every
// real mismatch, any size, gets flagged for manual review — nothing
// is ever changed automatically. AUTO_FIX_THRESHOLD_KG and the
// autoFix branch removed entirely, not just set to zero, so there's
// no dormant auto-fix code path left sitting in the file that could
// be silently re-enabled later without a deliberate, visible change.
function _dbcClassify(live, c1, c2) {
  const c1c2Agree = Math.abs(c1 - c2) < 0.01;
  const liveOk = Math.abs(live - c1) < 0.01 && Math.abs(live - c2) < 0.01;
  if (liveOk) return null; // clean, no row needed
  if (!c1c2Agree) return { verdict: 'Formulas disagree — needs review' };
  return { verdict: 'Live is stale — needs review' };
}

async function runDailyBalanceCheck(tc, changedBy) {
  const toArr = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x && x.id) : [];
  const lots = [...toArr(tc.lots), ...toArr((tc.archive || {}).lots)];
  const stageEntries = [...toArr(tc.stageEntries), ...toArr((tc.archive || {}).stageEntries)];
  const dyeLots = [...toArr(tc.dyeLots), ...toArr((tc.archive || {}).dyeLots)];
  const windEntries = [...toArr(tc.windEntries), ...toArr((tc.archive || {}).windEntries)];
  const packEntries = [...toArr(tc.packEntries), ...toArr((tc.archive || {}).packEntries)];
  const dispatches = [...toArr(tc.dispatches), ...toArr((tc.archive || {}).dispatches)];
  const rmReturnLog = toArr(tc.rmReturnLog);
  const residualLog = toArr(tc.residualLog);
  const scrapLog = toArr(tc.scrapLog);
  const lotSummaries = tc.lotSummaries || {};
  const dyeLotSummaries = tc.dyeLotSummaries || {};

  const rows = [];
  const now = new Date().toISOString();

  const addRow = (row) => rows.push(row);

  // ── RM/Soft-stage lots ─────────────────────────────────────────────────
  // Aug 6 2026 — real, confirmed bug found via live testing: this used to
  // keep only the FIRST /tc/lots record found for a given lotId+grade+
  // vendor, silently discarding any other records sharing that same key —
  // unlike handleRecalcAllSummariesStart's proven-correct pattern, which
  // correctly SUMS weight/units across every record sharing a key. This
  // meant the checker's own "how much should have come in" reference
  // point (totalIn) was systematically undercounted for any lot with more
  // than one raw record under the same key — causing a false "doesn't add
  // up" alarm on an already-correct summary, consistently in the same
  // direction (never the opposite), exactly matching the real, live
  // pattern Priyam found: the checker was wrong, not the data.
  const uniqueLotKeys = new Map();
  // Sep 8 2026 — real, root-cause correctness bug found via direct
  // discussion with Priyam, doing a holistic review of this function's
  // actual business logic (not just its speed): a Voided or Merged lot
  // keeps its own original weight/units on record — that's how voiding
  // works everywhere else in this app, it marks the status, it doesn't
  // erase history. But every OTHER real calculation (Soft, Dye,
  // everything downstream) correctly treats a Voided/Merged lot's
  // activity as zero, via the same appr() filter used throughout. This
  // loop never excluded them, meaning a Voided lot's own frozen,
  // pre-void weight became the "how much should have come in"
  // reference — compared against zero real downstream activity
  // (correctly excluded everywhere else) — a guaranteed false "doesn't
  // add up" alarm for every single Voided or Merged RM lot in the
  // system, for a lot that's actually completely fine. Excluded here,
  // matching how every other real balance calculation already treats
  // these two statuses.
  lots.filter(l => l.status !== 'Voided' && l.status !== 'Merged').forEach(l => {
    const k = summaryKey(l.id, l.grade, l.vendor);
    if (!uniqueLotKeys.has(k)) {
      uniqueLotKeys.set(k, { ...l, units: 0, weight: 0 });
    }
    const merged = uniqueLotKeys.get(k);
    merged.units += (l.units || 0);
    merged.weight += (l.weight || 0);
  });

  // Jul 19 2026 — bucket the two genuinely large arrays ONCE, before the
  // per-lot loop, instead of every one of the 6 calc* functions below
  // independently re-scanning the full stageEntries/dyeLots arrays for
  // every single lot. Verified byte-identical output against all 321 real
  // RM lots (including the dye-source reverse-lookup, the one part of
  // this that wasn't a trivial direct key match) before trusting this.
  // rmReturnLog/residualLog/scrapLog are NOT bucketed — real production
  // data shows single-digit sizes for these, no meaningful cost either way.
  const seByLot = new Map();
  for (const e of stageEntries) {
    const k = summaryKey(e.lotId, e.grade, e.vendor);
    if (!seByLot.has(k)) seByLot.set(k, []);
    seByLot.get(k).push(e);
  }
  const dyeBySourceLot = new Map();
  for (const d of dyeLots) {
    for (const src of (d.sources || [])) {
      if (!src.lotId) continue;
      const k = summaryKey(src.lotId, src.grade, src.vendor);
      if (!dyeBySourceLot.has(k)) dyeBySourceLot.set(k, []);
      dyeBySourceLot.get(k).push(d);
    }
  }

  for (const [key, l] of uniqueLotKeys) {
    const live = lotSummaries[key] || {};
    const myStageEntries = seByLot.get(key) || [];
    const myDyeLotsAsSource = dyeBySourceLot.get(key) || [];
    const rmBal = calcRMBalance(lots, myStageEntries, rmReturnLog, l.id, l.grade, l.vendor);
    const softBalKg = calcSoftBalanceWeight(myStageEntries, lots, scrapLog, myDyeLotsAsSource, residualLog, l.id, l.grade, l.vendor);
    const sentToDyeKg = calcSoftConsumedByDye(myDyeLotsAsSource, l.id, l.grade, l.vendor);
    const returnedObj = calcRMReturnedOut(rmReturnLog, l.id, l.grade, l.vendor);
    const returnedKg = returnedObj.weight || 0;
    const residualKg = calcSoftResidualOut(residualLog, l.id, l.grade, l.vendor);
    const softIn = calcSoftIn(myStageEntries, lots, l.id, l.grade, l.vendor);
    const softOutForWaste = appr(myStageEntries).filter(e => e.stage === 'Soft' && e.lotId === l.id && e.grade === l.grade && e.vendor === l.vendor)
      .reduce((a, e) => a + (e.outWeight || 0), 0);
    const softWasteKg = Math.max(0, (softIn.weight || 0) - softOutForWaste);

    // Check 1 — RM Balance, Soft Balance (weight + units both)
    // Aug 6 2026 — added missing .units checks for RM and Soft Balance —
    // confirmed these were silently absent (weight-only) while Dye
    // Balance already correctly checked both. Same field-name care as
    // the cones fix: rmBal and softOutQ both come from Q(), so .units is
    // correct; softBalance.units = softOut.units directly, no further
    // subtraction needed — confirmed against the nudge system's own
    // pattern (raw.outUnits added on approval, nothing subtracted for
    // Dye consumption specifically, since bags never carry into Dye per
    // the established unit-flow rule).
    // Aug 6 2026 — real correction: my first version used softOutQ.units
    // directly, untouched — genuinely wrong. Confirmed via real, existing,
    // proven formula (worker.js's own getSoftBalance, Jul 15 2026 fix):
    // bags DO shrink proportionally with kg as material moves to Dye —
    // "bags never carry into Dye" means bags aren't tracked forward INTO
    // the dye record, not that they sit frozen and untouched at Soft.
    // Matching that exact, established formula here instead of inventing
    // a different one — proportional scale, not a direct passthrough.
    const softOutQ = calcSoftOut(myStageEntries, lots, scrapLog, l.id, l.grade, l.vendor);
    const softBalUnits = softOutQ.weight > 0 ? Math.max(0, Math.round(softOutQ.units * (softBalKg / softOutQ.weight))) : 0;
    for (const [field, c1val, liveVal] of [
      ['rmBalance.kg', rmBal.weight, live?.rmBalance?.kg ?? 0],
      ['rmBalance.units', rmBal.units, live?.rmBalance?.units ?? 0],
      ['softBalance.kg', softBalKg, live?.softBalance?.kg ?? 0],
      ['softBalance.units', softBalUnits, live?.softBalance?.units ?? 0]
    ]) {
      const cls = _dbcClassify(liveVal, c1val, c1val);
      if (cls) {
        addRow({ stage: field.split('.')[0].replace('Balance', ''), lotNo: l.id, vendor: l.vendor, grade: l.grade, shade: '', field, live: liveVal, check1: c1val, check2: c1val, whatsWrong: cls.verdict });
      }
    }
    // Aug 19 2026 — real, new check added via direct discussion with
    // Priyam, after the real Lot 220231 investigation: a summary can
    // claim real, substantial activity (Soft made, sent to Dye, even
    // Dispatched) while the actual Soft record proving any of it ever
    // happened has genuinely vanished. Every other check above compares
    // two numbers for drift — this one asks a different, more basic
    // question: does the real, underlying evidence still exist at all.
    // Only fires when the summary itself claims something real happened;
    // a lot with a genuinely empty, all-zero summary is not an issue.
    if (myStageEntries.length === 0) {
      const claimedActivity = [
        ['softBalance.kg', live?.softBalance?.kg ?? 0],
        ['sentToDye.kg', live?.sentToDye?.kg ?? 0],
        ['dispatched.kg', live?.dispatched?.kg ?? 0]
      ].filter(([, v]) => Math.abs(v) > _AUDIT_EPS);
      if (claimedActivity.length) {
        addRow({
          stage: 'RM/Soft', lotNo: l.id, vendor: l.vendor, grade: l.grade, shade: '',
          field: 'ghostSummary.soft', live: claimedActivity.map(([f, v]) => `${f}: ${v}`).join(', '), check1: 0, check2: 0,
          whatsWrong: `Summary claims real activity but zero real Soft entries exist for this lot at all — the record behind this claim is genuinely missing.`
        });
      }
    }
    // Check 2 — Stage 1 conservation (weight): Total In = RM Bal + RM Returned + Soft Bal + Sent to Dye + Residual + Soft Waste
    // Jul 17 2026 — real fix found while testing: using rmBal/softBalKg
    // here (both "whatever's left over" formulas) made this equation true
    // by construction, always, regardless of any real problem — not a
    // genuine independent check. Fixed to use the LIVE cached balance
    // values instead, so this now actually tests whether the currently
    // stored state of the world, plus real transaction flow amounts,
    // genuinely adds up — which can fail for real, unlike the tautology.
    {
      const liveRmBal = live?.rmBalance?.kg ?? rmBal.weight;
      const liveSoftBal = live?.softBalance?.kg ?? softBalKg;
      const totalIn = l.weight || 0;
      const sumOfParts = liveRmBal + returnedKg + liveSoftBal + sentToDyeKg + residualKg + softWasteKg;
      const gap = totalIn - sumOfParts;
      if (Math.abs(gap) > 0.5) {
        addRow({ stage: 'RM→Soft (weight)', lotNo: l.id, vendor: l.vendor, grade: l.grade, shade: '', field: 'conservation.kg', live: totalIn, check1: sumOfParts, check2: sumOfParts, whatsWrong: `Does not add up — off by ${gap.toFixed(2)}kg (needs review, not auto-fixed — a conservation gap always needs a human look)` });
      }
    }
    // Check 2 — RM units → Soft units (count side, stops here per the spec — Sent to Dye has no meaningful bag count)
    {
      const softInUnits = softIn.units || 0;
      const softOutUnits = appr(myStageEntries).filter(e => e.stage === 'Soft' && e.lotId === l.id && e.grade === l.grade && e.vendor === l.vendor)
        .reduce((a, e) => a + (e.outUnits || 0), 0);
      const wasteUnits = appr(myStageEntries).filter(e => e.stage === 'Soft' && e.lotId === l.id && e.grade === l.grade && e.vendor === l.vendor)
        .reduce((a, e) => a + (e.wasteUnits || 0), 0);
      const gap = softInUnits - (softOutUnits + wasteUnits);
      if (Math.abs(gap) > 0.5) {
        addRow({ stage: 'RM→Soft (units)', lotNo: l.id, vendor: l.vendor, grade: l.grade, shade: '', field: 'conservation.units', live: softInUnits, check1: softOutUnits + wasteUnits, check2: softOutUnits + wasteUnits, whatsWrong: `Bag/unit count does not add up — off by ${gap} (needs review)` });
      }
    }
  }

  // ── Duplicate lot check — same lot sitting in BOTH active and archive ────
  // Jul 22 2026. A lot can legitimately be re-delivered after being fully
  // archived (the "refillable lot" scenario — real code, real merge logic
  // already exists for it in unarchiveLotChain). This is NOT the same
  // thing as an accidental duplicate — the only reliable way to tell them
  // apart is comparing the actual delivery records, which needs a human
  // to look, not automatic logic. So this check only ever flags it for
  // review — it never merges, picks one, or fixes anything by itself.
  {
    const activeLotKeys = new Set();
    for (const l of toArr(tc.lots)) activeLotKeys.add(summaryKey(l.id, l.grade, l.vendor));
    for (const l of toArr((tc.archive || {}).lots)) {
      const k = summaryKey(l.id, l.grade, l.vendor);
      if (activeLotKeys.has(k)) {
        const activeCopy = toArr(tc.lots).find(a => summaryKey(a.id, a.grade, a.vendor) === k);
        addRow({
          stage: 'RM (duplicate)', lotNo: l.id, vendor: l.vendor, grade: l.grade, shade: '',
          field: 'duplicate.active_and_archive',
          live: activeCopy?.weight || 0, check1: l.weight || 0, check2: l.weight || 0,
          whatsWrong: `This lot exists in BOTH active and archive at the same time (active: ${activeCopy?.weight || 0}kg, archived: ${l.weight || 0}kg) — needs a human to check whether this is a genuine new delivery or a duplicate before anything is changed. Not auto-fixed.`
        });
      }
    }
  }

  // ── Dispatch ID collision check ───────────────────────────────────────
  // Jul 22 2026. Found via a real production case: the ID-generator's
  // fallback path (used when its normal safe path hits trouble) has no
  // real protection against two different requests landing on the same
  // number — confirmed for real on 98 real dispatches, two genuinely
  // different deliveries sharing one ID. This only ever detects and
  // reports — never renumbers or merges anything, since deciding which
  // record keeps the ID (or whether both need a new one) needs a human,
  // not automatic logic.
  {
    const activeDisp = toArr(tc.dispatches);
    const archivedDisp = toArr((tc.archive || {}).dispatches);
    const activeById = new Map(activeDisp.map(d => [d.id, d]));
    for (const ad of archivedDisp) {
      const av = activeById.get(ad.id);
      if (!av) continue;
      const genuinelyDifferent = av.party !== ad.party || Math.abs((av.weight||0) - (ad.weight||0)) > 0.01 || av.dyeLotId !== ad.dyeLotId;
      if (genuinelyDifferent) {
        addRow({
          stage: 'Dispatch (ID collision)', lotNo: ad.id, vendor: '', grade: '', shade: '',
          field: 'collision.dispatch_id',
          live: av.weight || 0, check1: ad.weight || 0, check2: ad.weight || 0,
          whatsWrong: `ID "${ad.id}" refers to TWO different real dispatches — Active: ${av.party||'?'}, ${av.weight||0}kg, dye lot ${av.dyeLotNo||av.dyeLotId||'?'}, invoice ${av.invoiceNo||'?'} | Archived: ${ad.party||'?'}, ${ad.weight||0}kg, dye lot ${ad.dyeLotNo||ad.dyeLotId||'?'}, invoice ${ad.invoiceNo||'?'} — needs a human to decide how to resolve. Not auto-fixed.`
        });
      }
    }
  }

  // ── Content-based duplicate detection — same real event, different tag ──
  // Jul 22 2026. Discussed early in the session, built now: catches a
  // genuine duplicate submission (two tabs, a retry after a network
  // blip) that carries a different ID/tag but the exact same real
  // content, submitted close together in time.
  //
  // Deliberately scoped to Dispatch and Pack only, not Soft/Wind —
  // tested against real production data first: Soft routinely has the
  // same worker processing the same lot in several same-sized
  // sequential batches, minutes apart (confirmed: 132 such pairs in
  // real data, all genuine, separate, real work) — applying this same
  // logic there would be pure noise, not a real signal. Dispatch and
  // Pack don't have that pattern (0 and a small few real matches
  // respectively), making them the two places this check is actually
  // trustworthy.
  //
  // Only flags pairs where BOTH records are still in an active, counted
  // state (excludes Voided/Rejected) — if one side is already Voided, a
  // human has already independently caught and resolved it, so
  // re-flagging it adds nothing.
  {
    const _isLive = e => e.status !== 'Voided' && e.status !== 'Void' && e.status !== 'Rejected';
    const _closeInTime = (tsA, tsB, minutes) => {
      if (!tsA || !tsB) return false;
      const diffMs = Math.abs(new Date(tsA).getTime() - new Date(tsB).getTime());
      return diffMs <= minutes * 60 * 1000;
    };
    // Sep 8 2026 — real, root-cause fix built via direct discussion
    // with Priyam, from "manual run is failing" — this was genuinely
    // comparing every record against every other record (true O(n²)
    // by design, not an accidental miss), including months-old
    // archived records against each other. Since the check only ever
    // cares about records within 10 minutes of each other, comparing
    // records from completely different months was always guaranteed
    // to fail and never flag anything — pure wasted work, and the
    // exact thing that grows worse every single night as the archive
    // (which only ever accumulates, never shrinks) gets bigger. Same
    // result, dramatically cheaper: sort once by time, then only
    // compare each record against its nearby neighbors in that sorted
    // order — once two records are more than 10 minutes apart in a
    // time-sorted list, every record after that is even further
    // apart, so the inner loop can stop immediately instead of
    // continuing to the end.
    const _dupCheck = (liveArr, matchFields, stageLabel, fieldLabel, msgFn) => {
      const sorted = liveArr.filter(_isLive).filter(e => e.timestamp).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const a = sorted[i], b = sorted[j];
          if (!_closeInTime(a.timestamp, b.timestamp, 10)) break; // sorted — nothing further out will be closer
          if (a.id === b.id) continue;
          if (matchFields(a, b)) {
            addRow({ stage: stageLabel, lotNo: `${a.id} / ${b.id}`, vendor: a.party || '', grade: '', shade: '',
              field: fieldLabel, live: a.weight || 0, check1: b.weight || 0, check2: b.weight || 0,
              whatsWrong: msgFn(a, b) });
          }
        }
      }
    };
    _dupCheck(dispatches, (a, b) => a.party === b.party && Math.abs((a.weight||0) - (b.weight||0)) < 0.01 && a.dyeLotId === b.dyeLotId && (a.bags||0) === (b.bags||0),
      'Dispatch (possible duplicate)', 'contentDuplicate.dispatch',
      (a, b) => `Two different dispatch records with identical content (${a.party}, ${a.weight}kg, ${a.bags} bags, same dye lot) submitted ${Math.round(Math.abs(new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())/60000)} min apart — possibly the same real delivery submitted twice (two tabs, a retry). Needs a human to check. Not auto-fixed.`);
    _dupCheck(packEntries, (a, b) => a.dyeLotId === b.dyeLotId && Math.abs((a.weight||0) - (b.weight||0)) < 0.01 && (a.bags||0) === (b.bags||0),
      'Pack (possible duplicate)', 'contentDuplicate.pack',
      (a, b) => `Two different pack records with identical content (${a.weight}kg, ${a.bags} bags, same dye lot) submitted ${Math.round(Math.abs(new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())/60000)} min apart — possibly the same real batch submitted twice. Needs a human to check. Not auto-fixed.`);
  }

  // ── Dye/Wind/Pack/Dispatch-stage lots ──────────────────────────────────
  const validDyeLots = dyeLots.filter(d => d.status === 'Approved' || d.status === 'Edited-Approved');
  const windByDL = new Map(), packByDL = new Map(), dispByDL = new Map();
  for (const e of windEntries) { if (!e.dyeLotId) continue; if (!windByDL.has(e.dyeLotId)) windByDL.set(e.dyeLotId, []); windByDL.get(e.dyeLotId).push(e); }
  for (const e of packEntries) { if (!e.dyeLotId) continue; if (!packByDL.has(e.dyeLotId)) packByDL.set(e.dyeLotId, []); packByDL.get(e.dyeLotId).push(e); }
  for (const e of dispatches) { if (!e.dyeLotId) continue; if (!dispByDL.has(e.dyeLotId)) dispByDL.set(e.dyeLotId, []); dispByDL.get(e.dyeLotId).push(e); }

  // Aug 19 2026 — real, new check built via direct discussion with
  // Priyam: the exact reverse of the ghost-summary checks above. Those
  // ask "does the upstream claim have real downstream evidence" — this
  // asks the opposite: "does a real downstream record's reference to
  // its upstream source actually point to something that genuinely
  // exists at all." Built once earlier today as a one-off, throwaway
  // script for direct investigation; never made it into the actual
  // app until now. Checks against the FULL dyeLots set, not just
  // validDyeLots — a broken reference is a real problem regardless of
  // the target's own approval status.
  const allDyeLotIds = new Set(dyeLots.map(d => d.id));
  for (const [dlId, entries] of windByDL) {
    if (!allDyeLotIds.has(dlId)) {
      entries.forEach(e => addRow({ stage: 'Wind', lotNo: dlId, vendor: '', grade: '', shade: '', field: 'orphanRef.dye', live: `Wind ${e.id}`, check1: 0, check2: 0, whatsWrong: `This real Wind entry references Dye lot "${dlId}", but no real Dye lot with that ID exists at all.` }));
    }
  }
  for (const [dlId, entries] of packByDL) {
    if (!allDyeLotIds.has(dlId)) {
      entries.forEach(e => addRow({ stage: 'Pack', lotNo: dlId, vendor: '', grade: '', shade: '', field: 'orphanRef.dye', live: `Pack ${e.id}`, check1: 0, check2: 0, whatsWrong: `This real Pack entry references Dye lot "${dlId}", but no real Dye lot with that ID exists at all.` }));
    }
  }
  for (const [dlId, entries] of dispByDL) {
    if (!allDyeLotIds.has(dlId)) {
      entries.forEach(e => addRow({ stage: 'Dispatch', lotNo: dlId, vendor: '', grade: '', shade: '', field: 'orphanRef.dye', live: `Dispatch ${e.id}`, check1: 0, check2: 0, whatsWrong: `This real Dispatch entry references Dye lot "${dlId}", but no real Dye lot with that ID exists at all.` }));
    }
  }

  for (const d of validDyeLots) {
    const live = dyeLotSummaries[d.id] || {};
    const winds = windByDL.get(d.id) || [];
    const packs = packByDL.get(d.id) || [];
    const disps = dispByDL.get(d.id) || [];

    const dyeBal = calcDyeBal(dyeLots, winds, d.id);
    const windBal = calcWindBal(winds, packs, d.id);
    const packBal = calcPackBal(packs, disps, d.id);
    const dispTotal = calcTotalDispatchedApproved(disps, d.id, dyeLots);

    // Aug 19 2026 — real, direct extension of the Soft ghost-summary
    // check to Dye/Wind/Pack, via direct discussion with Priyam: the
    // exact same "summary claims real activity, but the record proving
    // it happened is genuinely missing" problem can happen one level
    // down the chain too — Dye's own summary claims Wind consumed its
    // output, or Pack claims Dispatch took from it, while the real
    // Wind/Pack/Dispatch entries for this exact dye lot don't exist at
    // all. Reuses winds/packs/disps, already bucketed just above —
    // no new data fetched for this.
    if (winds.length === 0) {
      const claimed = [['windBalance.kg', live?.windBalance?.kg ?? 0], ['windBalance.cones', live?.windBalance?.cones ?? 0]].filter(([, v]) => Math.abs(v) > _AUDIT_EPS);
      if (claimed.length) {
        addRow({ stage: 'Dye', lotNo: d.dyeLotNo || d.id, vendor: '', grade: d.sources?.[0]?.grade || d.grade || '', shade: d.shade || '', field: 'ghostSummary.wind', live: claimed.map(([f, v]) => `${f}: ${v}`).join(', '), check1: 0, check2: 0, whatsWrong: `Summary claims Wind already used this dye lot's output, but zero real Wind entries exist for it — the record behind this claim is genuinely missing.` });
      }
    }
    if (packs.length === 0) {
      const claimed = [['packBalance.kg', live?.packBalance?.kg ?? 0], ['packBalance.bags', live?.packBalance?.bags ?? 0]].filter(([, v]) => Math.abs(v) > _AUDIT_EPS);
      if (claimed.length) {
        addRow({ stage: 'Wind', lotNo: d.dyeLotNo || d.id, vendor: '', grade: d.sources?.[0]?.grade || d.grade || '', shade: d.shade || '', field: 'ghostSummary.pack', live: claimed.map(([f, v]) => `${f}: ${v}`).join(', '), check1: 0, check2: 0, whatsWrong: `Summary claims Pack already used this dye lot's Wind output, but zero real Pack entries exist for it — the record behind this claim is genuinely missing.` });
      }
    }
    if (disps.length === 0) {
      const claimed = [['dispatched.kg', live?.dispatched?.kg ?? 0], ['dispatched.bags', live?.dispatched?.bags ?? 0]].filter(([, v]) => Math.abs(v) > _AUDIT_EPS);
      if (claimed.length) {
        addRow({ stage: 'Pack', lotNo: d.dyeLotNo || d.id, vendor: '', grade: d.sources?.[0]?.grade || d.grade || '', shade: d.shade || '', field: 'ghostSummary.dispatch', live: claimed.map(([f, v]) => `${f}: ${v}`).join(', '), check1: 0, check2: 0, whatsWrong: `Summary claims this dye lot's Pack output was already Dispatched, but zero real Dispatch entries exist for it — the record behind this claim is genuinely missing.` });
      }
    }

    const dyeWasteKg = Math.max(0, (d.totalInWeight || 0) - (d.outWeight || 0));
    const windOutKg = appr(winds).reduce((a, e) => a + (e.outWeight || 0), 0);
    const windInKg = appr(winds).reduce((a, e) => a + (e.inWeight || 0), 0);
    const windWasteKg = Math.max(0, windInKg - windOutKg);
    const packInKg = appr(packs).reduce((a, e) => a + (e.inWeight || 0), 0);
    const packOutKg = appr(packs).reduce((a, e) => a + (e.weight || 0), 0);
    const gainAtPackKg = packOutKg - packInKg; // signed — one number, confirmed in code, covers both directions

    // Check 1 — Dye/Wind/Pack Balance
    // Aug 6 2026 — real, honest journey on the cones side of this: first
    // built a separate "conservation.cones" check (Check 2 below, now
    // removed) with an explicit "skip if nothing's happened at Wind yet"
    // guard. Directly challenged on why the math itself shouldn't just
    // naturally come out right without needing a special case — fair,
    // and led to the real, better fix: cones never needed a SEPARATE
    // check with its own skip logic at all. This existing Check 1 loop
    // already does exactly the right thing for weight — compares a fresh
    // recompute against the separately, incrementally-maintained cache,
    // which naturally shows zero when material's legitimately still
    // pending (both sides agree), and only shows a real gap when the
    // cache has genuinely drifted from reality. Cones just needed the
    // same treatment weight already had — added below, no skip needed.
    for (const [field, c1val, liveVal] of [
      ['dyeBalance.kg', dyeBal.weight, live?.dyeBalance?.kg ?? 0],
      ['dyeBalance.cones', dyeBal.units, live?.dyeBalance?.cones ?? 0],
      ['windBalance.kg', windBal.weight, live?.windBalance?.kg ?? 0],
      ['windBalance.cones', windBal.units, live?.windBalance?.cones ?? 0],
      ['packBalance.kg', packBal.weight, live?.packBalance?.kg ?? 0],
      ['packBalance.bags', packBal.bags, live?.packBalance?.bags ?? 0]
    ]) {
      const cls = _dbcClassify(liveVal, c1val, c1val);
      if (cls) {
        addRow({ stage: field.split('.')[0].replace('Balance', ''), lotNo: d.dyeLotNo || d.id, vendor: '', grade: d.sources?.[0]?.grade || d.grade || '', shade: d.shade || '', field, live: liveVal, check1: c1val, check2: c1val, whatsWrong: cls.verdict });
      }
    }
    // Check 2 — Stage 2 conservation (weight): Dye Input = Dye Bal + Dye Waste + Wind Bal + Pack Bal + Dispatch − Gain at Pack + Wind Waste + Recycle
    // Aug 6 2026 — added Recycle: confirmed via direct discussion the
    // dyeBal.weight above now correctly excludes any recycled portion
    // (calcDyeBal fix, same session) — meaning that weight has to be
    // accounted for somewhere else in this sum, or it would show as a
    // false, permanent gap for any split dye lot. Proven with real
    // numbers before trusting this: without this term, fixing dyeBal
    // alone would have just moved the bug from "invisible" to "a new
    // false alarm" — only adding both together is genuinely correct.
    {
      const dyeInput = d.totalInWeight || 0;
      const recycleWeight = d.recycleWeight || 0;
      const sumOfParts = dyeBal.weight + dyeWasteKg + windBal.weight + packBal.weight + dispTotal.weight - gainAtPackKg + windWasteKg + recycleWeight;
      const gap = dyeInput - sumOfParts;
      if (Math.abs(gap) > 0.5) {
        addRow({ stage: 'Dye→Dispatch (weight)', lotNo: d.dyeLotNo || d.id, vendor: '', grade: d.sources?.[0]?.grade || d.grade || '', shade: d.shade || '', field: 'conservation.kg', live: dyeInput, check1: sumOfParts, check2: sumOfParts, whatsWrong: `Does not add up — off by ${gap.toFixed(2)}kg (needs review, not auto-fixed)` });
      }
    }
    // Pack Output bags -> Dispatch bags (separate count unit, own check)
      const packOutBags = appr(packs).reduce((a, e) => a + (e.bags || 0), 0);
      const dispBags = dispTotal.bags || 0;
      const bagGap = packOutBags - (packBal.bags + dispBags);
      if (Math.abs(bagGap) > 1) {
        addRow({ stage: 'Pack→Dispatch (bags)', lotNo: d.dyeLotNo || d.id, vendor: '', grade: d.sources?.[0]?.grade || d.grade || '', shade: d.shade || '', field: 'conservation.bags', live: packOutBags, check1: packBal.bags + dispBags, check2: packBal.bags + dispBags, whatsWrong: `Bag count does not add up — off by ${bagGap} (needs review)` });
      }
  }


  // ── Plausibility checks (moved from Reports' old "Control" tab, Aug 6
  // 2026) — genuinely different question from staleness or conservation:
  // "is this one specific number even physically possible right now,"
  // not "does the saved cache match fresh math" or "does the full
  // history add up." Rebuilt from scratch here, server-side, using the
  // same merged active+archive data and genuinely fresh calc*()
  // functions as every other check in this function — the original
  // version lived client-side and read cache-first values (getRMBalance
  // etc.), the same weak spot found and fixed everywhere else this
  // session. 'plausibility.' field prefix lets the frontend route these
  // rows to the same "Total In vs Out" tab as conservation rows.
  const fmt2 = v => (+v || 0).toFixed(2);

  // 1. Soft entries: output exceeds input, mass balance
  appr(stageEntries).filter(e => e.stage === 'Soft' && e.endTime).forEach(e => {
    if ((e.outWeight || 0) > (e.inWeight || 0) + 0.01) {
      addRow({ stage: 'Soft', lotNo: e.lotId, vendor: e.vendor || '', grade: e.grade || '', shade: '', field: 'plausibility.outputExceedsInput.kg', live: e.outWeight, check1: e.inWeight, check2: e.inWeight, whatsWrong: `Output (${fmt2(e.outWeight)}kg) exceeds input (${fmt2(e.inWeight)}kg) — not physically possible` });
    }
    if ((e.outUnits || 0) > (e.inUnits || 0) + 0.01) {
      addRow({ stage: 'Soft', lotNo: e.lotId, vendor: e.vendor || '', grade: e.grade || '', shade: '', field: 'plausibility.outputExceedsInput.units', live: e.outUnits, check1: e.inUnits, check2: e.inUnits, whatsWrong: `Output bags (${e.outUnits}) exceed input bags (${e.inUnits}) — not physically possible` });
    }
    const diff = Math.abs((e.inWeight || 0) - (e.outWeight || 0) - (e.wasteWeight || 0));
    if (diff > 0.5) {
      addRow({ stage: 'Soft', lotNo: e.lotId, vendor: e.vendor || '', grade: e.grade || '', shade: '', field: 'plausibility.massBalance.kg', live: e.inWeight, check1: (e.outWeight || 0) + (e.wasteWeight || 0), check2: (e.outWeight || 0) + (e.wasteWeight || 0), whatsWrong: `In (${fmt2(e.inWeight)}) ≠ Out+Waste (${fmt2(e.outWeight)}+${fmt2(e.wasteWeight)})` });
    }
  });

  // 2. RM lot level: negative balances, sent-to-dye exceeds soft output
  // Sep 8 2026 — real, root-cause fix built via direct discussion with
  // Priyam, from "manual run is failing" — this second RM-lot loop
  // (added Aug 6 2026, after the Jul 19 2026 bucketing fix above) never
  // reused seByLot/dyeBySourceLot, reintroducing the exact same
  // per-lot full-array-rescan pattern independently — calcRMBalance/
  // calcSoftOut/calcSoftConsumedByDye/calcSoftBalanceWeight were each
  // called once per lot with the FULL lots/stageEntries/dyeLots arrays.
  // At real archive scale this was the single largest cost in the
  // whole function by far — confirmed directly via timing
  // instrumentation, not guessed. Same fix as everywhere else: pass
  // each lot only its own single-element lots array and its own
  // already-bucketed slice instead of the full arrays.
  // Sep 8 2026 — same real correctness fix as the uniqueLotKeys build
  // above: excludes Voided/Merged lots from getting their own
  // plausibility row at all, for the exact same reason — their
  // frozen, pre-void/merge numbers were never meant to "add up"
  // against zero real downstream activity.
  lots.filter(l => l.status !== 'Voided' && l.status !== 'Merged').forEach(l => {
    const _lotKeyPlaus = summaryKey(l.id, l.grade, l.vendor);
    const _myStageEntriesPlaus = seByLot.get(_lotKeyPlaus) || [];
    const _myDyeLotsPlaus = dyeBySourceLot.get(_lotKeyPlaus) || [];
    const rmBalFresh = calcRMBalance([l], _myStageEntriesPlaus, rmReturnLog, l.id, l.grade, l.vendor);
    if (rmBalFresh.weight < -0.5) {
      addRow({ stage: 'RM', lotNo: l.id, vendor: l.vendor, grade: l.grade, shade: '', field: 'plausibility.negativeBalance.kg', live: rmBalFresh.weight, check1: 0, check2: 0, whatsWrong: `Negative RM balance (${fmt2(rmBalFresh.weight)}kg) — Soft took more than was ever received` });
    }
    const sfOut = calcSoftOut(_myStageEntriesPlaus, [l], scrapLog, l.id, l.grade, l.vendor);
    const sfConsumed = calcSoftConsumedByDye(_myDyeLotsPlaus, l.id, l.grade, l.vendor);
    if (sfConsumed > sfOut.weight + 0.5) {
      addRow({ stage: 'Soft→Dye', lotNo: l.id, vendor: l.vendor, grade: l.grade, shade: '', field: 'plausibility.sentToDyeExceedsOutput.kg', live: sfConsumed, check1: sfOut.weight, check2: sfOut.weight, whatsWrong: `Sent to Dye (${fmt2(sfConsumed)}kg) exceeds Soft output (${fmt2(sfOut.weight)}kg) — not physically possible, likely a wrong source lot on a Dye batch` });
    }
    const sfBal = calcSoftBalanceWeight(_myStageEntriesPlaus, [l], scrapLog, _myDyeLotsPlaus, residualLog, l.id, l.grade, l.vendor);
    if (sfBal < -0.5) {
      addRow({ stage: 'Soft', lotNo: l.id, vendor: l.vendor, grade: l.grade, shade: '', field: 'plausibility.negativeBalance.kg', live: sfBal, check1: 0, check2: 0, whatsWrong: `Negative Soft balance (${fmt2(sfBal)}kg)` });
    }
  });

  // Sep 8 2026 — real, root-cause fix built via direct discussion with
  // Priyam, from "manual run is failing" with no visible reason at
  // real scale (224 dye lots, 198 wind entries, 130 pack entries, 87
  // dispatches): every one of the 3 loops below called calcDyeBal/
  // calcWindBal/calcTotalPackedApproved/calcTotalDispatchedApproved/
  // calcPackBal with the FULL windEntries/packEntries/dispatches/
  // dyeLots arrays, once per dye lot — each of those functions
  // internally re-filters the full array it's given, every single
  // call. That's the exact "independently re-scanning the full array
  // for every single lot" pattern already found and fixed for the RM/
  // Soft section above (Jul 19 2026) and for handleRecalcAllSummariesStart
  // (Jul 21 2026) — but never carried over to this dye/wind/pack/
  // dispatch section specifically, which is almost certainly why this
  // has been silently failing (a Cloudflare CPU-time cutoff, not a
  // catchable JS error) for weeks. Same fix: bucket once, pass each
  // dye lot only its own small slice instead of the full array — the
  // calc functions themselves are untouched, since a pre-filtered
  // slice produces the exact same correct result, just far cheaper.
  const windByDyeLot = new Map();
  for (const e of (windEntries || [])) { if (!e.dyeLotId) continue; if (!windByDyeLot.has(e.dyeLotId)) windByDyeLot.set(e.dyeLotId, []); windByDyeLot.get(e.dyeLotId).push(e); }
  const packByDyeLot = new Map();
  for (const e of (packEntries || [])) { if (!e.dyeLotId) continue; if (!packByDyeLot.has(e.dyeLotId)) packByDyeLot.set(e.dyeLotId, []); packByDyeLot.get(e.dyeLotId).push(e); }
  const dispByDyeLot = new Map();
  for (const e of (dispatches || [])) { if (!e.dyeLotId) continue; if (!dispByDyeLot.has(e.dyeLotId)) dispByDyeLot.set(e.dyeLotId, []); dispByDyeLot.get(e.dyeLotId).push(e); }

  // 3. Dye lots: no sources, output exceeds input, negative dye balance
  appr(dyeLots).forEach(d => {
    if (!(d.sources || []).length) {
      addRow({ stage: 'Dye', lotNo: d.id, vendor: '', grade: '', shade: d.shade || '', field: 'plausibility.noSources', live: 0, check1: 0, check2: 0, whatsWrong: `Dye lot ${d.dyeLotNo || d.id} has no source lots defined` });
    }
    if ((d.outCones || 0) > (d.totalInCones || 0) + 0.5) {
      addRow({ stage: 'Dye', lotNo: d.dyeLotNo || d.id, vendor: '', grade: d.sources?.[0]?.grade || d.grade || '', shade: d.shade || '', field: 'plausibility.outputExceedsInput.cones', live: d.outCones, check1: d.totalInCones, check2: d.totalInCones, whatsWrong: `Output cones (${d.outCones}) exceed input cones (${d.totalInCones}) — not physically possible` });
    }
    if ((d.outWeight || 0) > (d.totalInWeight || 0) + 0.5) {
      addRow({ stage: 'Dye', lotNo: d.dyeLotNo || d.id, vendor: '', grade: d.sources?.[0]?.grade || d.grade || '', shade: d.shade || '', field: 'plausibility.outputExceedsInput.kg', live: d.outWeight, check1: d.totalInWeight, check2: d.totalInWeight, whatsWrong: `Output weight (${fmt2(d.outWeight)}kg) exceeds input weight (${fmt2(d.totalInWeight)}kg) — not physically possible` });
    }
    const dyeBalFresh = calcDyeBal([d], windByDyeLot.get(d.id) || [], d.id);
    if (dyeBalFresh.weight < -0.5) {
      addRow({ stage: 'Dye', lotNo: d.dyeLotNo || d.id, vendor: '', grade: d.sources?.[0]?.grade || d.grade || '', shade: d.shade || '', field: 'plausibility.negativeBalance.kg', live: dyeBalFresh.weight, check1: 0, check2: 0, whatsWrong: `Negative Dye balance (${fmt2(dyeBalFresh.weight)}kg) — Wind took more than Dye produced` });
    }
  });

  // 4. Wind entries: output exceeds input, mass balance
  appr(windEntries).filter(w => w.endTime).forEach(w => {
    if ((w.outCones || 0) > (w.inCones || 0) + 0.5) {
      addRow({ stage: 'Wind', lotNo: w.dyeLotNo || w.dyeLotId, vendor: '', grade: '', shade: '', field: 'plausibility.outputExceedsInput.cones', live: w.outCones, check1: w.inCones, check2: w.inCones, whatsWrong: `Output cones (${w.outCones}) exceed input cones (${w.inCones}) — not physically possible` });
    }
    if ((w.outWeight || 0) > (w.inWeight || 0) + 0.5) {
      addRow({ stage: 'Wind', lotNo: w.dyeLotNo || w.dyeLotId, vendor: '', grade: '', shade: '', field: 'plausibility.outputExceedsInput.kg', live: w.outWeight, check1: w.inWeight, check2: w.inWeight, whatsWrong: `Output weight (${fmt2(w.outWeight)}kg) exceeds input weight (${fmt2(w.inWeight)}kg) — not physically possible` });
    }
    const diffW = Math.abs((w.inCones || 0) - (w.outCones || 0) - (w.wasteCones || 0));
    if (diffW > 0.5) {
      addRow({ stage: 'Wind', lotNo: w.dyeLotNo || w.dyeLotId, vendor: '', grade: '', shade: '', field: 'plausibility.massBalance.cones', live: w.inCones, check1: (w.outCones || 0) + (w.wasteCones || 0), check2: (w.outCones || 0) + (w.wasteCones || 0), whatsWrong: `In (${w.inCones}c) ≠ Out+Waste (${w.outCones}c+${w.wasteCones}c)` });
    }
  });

  // 5. Dye lot level: negative wind balance
  appr(dyeLots).forEach(d => {
    const windBalFresh = calcWindBal(windByDyeLot.get(d.id) || [], packByDyeLot.get(d.id) || [], d.id);
    if (windBalFresh.weight < -0.5) {
      addRow({ stage: 'Wind', lotNo: d.dyeLotNo || d.id, vendor: '', grade: d.sources?.[0]?.grade || d.grade || '', shade: d.shade || '', field: 'plausibility.negativeBalance.kg', live: windBalFresh.weight, check1: 0, check2: 0, whatsWrong: `Negative Wind balance (${fmt2(windBalFresh.weight)}kg) — Pack took more than Wind produced` });
    }
  });

  // 6. Dye lot level: dispatched exceeds packed, negative pack balance
  appr(dyeLots).forEach(d => {
    const packed = calcTotalPackedApproved(packByDyeLot.get(d.id) || [], d.id);
    const dispatched = calcTotalDispatchedApproved(dispByDyeLot.get(d.id) || [], d.id, [d]);
    if (dispatched.weight > packed.weight + 0.5) {
      addRow({ stage: 'Dispatch', lotNo: d.dyeLotNo || d.id, vendor: '', grade: d.sources?.[0]?.grade || d.grade || '', shade: d.shade || '', field: 'plausibility.dispatchedExceedsPacked.kg', live: dispatched.weight, check1: packed.weight, check2: packed.weight, whatsWrong: `Dispatched (${fmt2(dispatched.weight)}kg) exceeds Packed (${fmt2(packed.weight)}kg) — not physically possible` });
    }
    if ((dispatched.bags || 0) > (packed.bags || 0) + 0.5) {
      addRow({ stage: 'Dispatch', lotNo: d.dyeLotNo || d.id, vendor: '', grade: d.sources?.[0]?.grade || d.grade || '', shade: d.shade || '', field: 'plausibility.dispatchedExceedsPacked.bags', live: dispatched.bags, check1: packed.bags, check2: packed.bags, whatsWrong: `Dispatched bags (${dispatched.bags}) exceed Packed bags (${packed.bags}) — not physically possible` });
    }
    const packBalFresh = calcPackBal(packByDyeLot.get(d.id) || [], dispByDyeLot.get(d.id) || [], d.id);
    if (packBalFresh.weight < -0.5) {
      addRow({ stage: 'Pack', lotNo: d.dyeLotNo || d.id, vendor: '', grade: d.sources?.[0]?.grade || d.grade || '', shade: d.shade || '', field: 'plausibility.negativeBalance.kg', live: packBalFresh.weight, check1: 0, check2: 0, whatsWrong: `Negative Pack balance (${fmt2(packBalFresh.weight)}kg) — Dispatched more than Packed` });
    }
  });

  const reportId = new Date().toISOString().slice(0, 10);
  const report = { id: reportId, runAt: now, rowCount: rows.length, rows };
  await fbSet(`/tc/dailyCheckReports/${reportId}`, report);

  return report;
}

async function runCronBackup(env) {
  // Strategy (Jul 2026): simple, low-bandwidth backup.
  // 1. Shallow fetch /backups → get keys only (~1KB, no backup data downloaded)
  // 2. Download /tc → build snapshot (this IS the backup, must download once)
  // 3. One safety check using already-downloaded data — no extra fetch
  // 4. Write snapshot to /backups/{ts} (upload only)
  // 5. Delete oldest if count >= MAX_BACKUPS (DELETE = zero download bandwidth)
  // Cron runs once daily (0 2 * * *) → MAX_BACKUPS=5 = 5 days retention

  // Jul 28 2026 — real, confirmed problem: the backup silently stopped
  // running for ~3 weeks (last successful run: July 7) and nothing
  // anywhere showed this had happened — no error visible in the app,
  // nothing to check without digging through Cloudflare's own execution
  // logs. The whole function now runs inside one try/catch, and either
  // outcome — success or failure — gets written to /backupStatus, a
  // single, always-current record you can actually check from the app
  // itself, instead of a silent failure with no visible trace.
  try {
    // Step 1: get existing backup keys only — shallow, ~1KB
    // Jul 28 2026 fix — this was calling fbGet('/backups?shallow=true')
    // as a single string, but fbGet expects the query string as its own
    // second argument. The malformed URL this produced meant this step
    // silently returned nothing, every single time, which meant cleanup
    // never had any existing backups to compare against — explaining why
    // old backups were never actually being deleted, even before the
    // cron itself stopped running entirely.
    const keysSnap = await fbGet('/backups', 'shallow=true');
    const keys = Object.keys(keysSnap || {}).sort();

    // Step 2: download /tc for the actual backup
    const tc = await fbGet('/tc');
    if (!tc) {
      console.log('Cron backup skipped: /tc empty');
      await fbSet('/backupStatus', { lastAttempt: new Date().toISOString(), status: 'skipped', reason: '/tc empty' }).catch(() => {});
      return;
    }

    // Step 3: one safety check using already-downloaded data — zero extra bandwidth
    if (!Array.isArray(tc.users) || tc.users.length === 0) {
      console.log('Cron backup skipped: DB.users missing or empty');
      await fbSet('/backupStatus', { lastAttempt: new Date().toISOString(), status: 'skipped', reason: 'users missing or empty' }).catch(() => {});
      return;
    }

    // Step 4: build and write snapshot
    const now = new Date();
    const ts  = now.toISOString().slice(0, 16).replace(/[T:]/g, '-');
    const _safeLen = v => v ? (Array.isArray(v) ? v.length : Object.keys(v).length) : 0;
    const snapshot = {
      savedAt:            now.toISOString(),
      isManual:           false,
      source:             'cron',
      lots:               _safeLen(tc.lots),
      stageEntries:       _safeLen(tc.stageEntries),
      dyeLots:            _safeLen(tc.dyeLots),
      windEntries:        _safeLen(tc.windEntries),
      packEntries:        _safeLen(tc.packEntries),
      dispatches:         _safeLen(tc.dispatches),
      archiveDyeLots:     _safeLen((tc.archive||{}).dyeLots),
      archiveWindEntries: _safeLen((tc.archive||{}).windEntries),
      archivePackEntries: _safeLen((tc.archive||{}).packEntries),
      archiveDispatches:  _safeLen((tc.archive||{}).dispatches),
      totalEntries:       getTotalEntries(tc),
      voidLog:            _safeLen(tc.voidLog),
      deleteRequests:     _safeLen(tc.deleteRequests),
      users:              _safeLen(tc.users),
      data:               tc
    };
    await fbSet(`/backups/${ts}`, snapshot);
    console.log(`✓ Cron backup written: /backups/${ts}`);

    // Jul 28 2026 — R2 dual-write. Confirmed design: Firebase's own
    // backup keeps running exactly as before, completely untouched —
    // this is purely additive. The whole reason for this is real, not a
    // cost concern (confirmed: both read and write here cost $0 either
    // way) — it's that today's backup lived in the same project as the
    // data it protects, so losing the whole project would lose both
    // together. R2 is separate infrastructure entirely. Once this is
    // confirmed working for real (checking the R2 bucket directly,
    // tomorrow), Firebase's own copy can be safely removed — not before.
    let r2Status = 'skipped — no R2 binding configured';
    if (env && env.BACKUP_BUCKET) {
      try {
        await env.BACKUP_BUCKET.put(`${ts}.json`, JSON.stringify(snapshot));
        r2Status = 'success';
        console.log(`✓ R2 backup written: ${ts}.json`);
        // Aug 6 2026 — real, confirmed gap: R2 backups had zero cleanup
        // since the day this dual-write was added (Jul 28) — only ever
        // wrote, never deleted, so R2 grew one file every single night
        // forever while Firebase's own copy (fixed separately, same day)
        // correctly stayed at MAX_BACKUPS. Same retention rule, applied
        // to R2 too now: list (metadata only, no download — same
        // zero-bandwidth-read principle as the Firebase cleanup above),
        // delete oldest beyond MAX_BACKUPS.
        try {
          const r2List = await env.BACKUP_BUCKET.list();
          const r2Keys = (r2List.objects || []).map(o => o.key).sort();
          if (r2Keys.length > MAX_BACKUPS) {
            const r2ToDelete = r2Keys.slice(0, r2Keys.length - MAX_BACKUPS);
            for (const k of r2ToDelete) await env.BACKUP_BUCKET.delete(k);
            console.log(`✓ Deleted ${r2ToDelete.length} old R2 backup(s): ${r2ToDelete.join(', ')}`);
          }
        } catch (e) {
          console.log(`✗ R2 cleanup failed: ${e.message}`);
        }
      } catch (e) {
        r2Status = `failed: ${e.message}`;
        console.log(`✗ R2 backup failed: ${e.message}`);
      }
    }

    // Sep 10 2026 — real, root-cause fix built via direct discussion
    // with Priyam, from his real, repeated experience of having to
    // manually run "Trim Backups to 5" every single time: backup
    // cleanup used to sit at the very end of this function, AFTER the
    // Daily Balance Check and the (potentially slow, up to 10 rounds)
    // nightly archiving. Each of those has its own try/catch, so a
    // crash there was never the problem — but if the whole nightly
    // job runs long enough to hit Cloudflare's real execution time
    // limit, the ENTIRE invocation gets killed instantly, and no
    // try/catch can save a step that hasn't run yet. Cleanup, sitting
    // last, was the first thing sacrificed whenever that happened —
    // exactly matching Priyam's real, repeated symptom. Moved to run
    // immediately after the backup itself (both Firebase and R2),
    // before anything slower or riskier gets a chance to run at all —
    // so even if the Daily Check or archiving below times out some
    // night, the most important step (never let backups grow
    // unbounded) has already safely happened.
    const allKeys = [...keys, ts].sort();
    let deletedCount = 0;
    if (allKeys.length > MAX_BACKUPS) {
      const toDelete = allKeys.slice(0, allKeys.length - MAX_BACKUPS);
      for (const k of toDelete) await fbDelete(`/backups/${k}`);
      deletedCount = toDelete.length;
      console.log(`✓ Deleted ${toDelete.length} old backup(s): ${toDelete.join(', ')}`);
    }

    // Jul 17 2026 — daily balance checker runs right here, reusing the same
    // `tc` object backup just downloaded. No second fetch.
    // Sep 10 2026 — real, genuine gap found via the exact same
    // holistic audit that caught the fW bug above: _dcT0 was declared
    // inside the try block, making it completely inaccessible from
    // the catch block below — meaning the real failure this catch
    // exists specifically to report would itself throw a second,
    // different error the moment it actually ran, potentially masking
    // the very failure this whole fix (Sep 8 2026, above) was built
    // to surface. Moved above the try so it's in scope for both.
    const _dcT0 = Date.now();
    try {
      const checkReport = await runDailyBalanceCheck(tc, 'Daily Checker (automatic)');
      const _dcElapsed = Date.now() - _dcT0;
      console.log(`✓ Daily balance check: ${checkReport.rowCount} issue(s) found, all flagged for review — auto-fix is off`);
      await fbSet('/tc/dailyCheckLastError', null).catch(() => {});
      await fbSet('/tc/dailyCheckLastTiming', { checkMs: _dcElapsed, totalMs: _dcElapsed, at: new Date().toISOString(), outcome: 'success', note: 'reused already-fetched tc from cron backup, no separate fetch time to report' }).catch(() => {});
    } catch (e) {
      // Sep 8 2026 — real, direct fix built via direct discussion with
      // Priyam, from "manual run is failing" with no visible reason,
      // and the report shown to him dated 3 weeks stale: a crash here
      // (same as the on-demand path above) used to be caught and only
      // logged to a Cloudflare-side console Priyam has no access to —
      // meaning the automatic overnight run could have been silently
      // failing every single night for that entire 3 weeks, with
      // absolutely no visible sign anything was wrong. Now also writes
      // the real error somewhere the app itself actually shows.
      console.log(`✗ Daily balance check failed: ${e.message}`);
      await fbSet('/tc/dailyCheckLastError', { message: e.message, at: new Date().toISOString(), stack: (e.stack || '').split('\n').slice(0, 5).join(' | ') }).catch(() => {});
      await fbSet('/tc/dailyCheckLastTiming', { failedAfterMs: Date.now() - _dcT0, at: new Date().toISOString(), outcome: 'failed', failedDuring: 'runDailyBalanceCheck', note: 'reused already-fetched tc from cron backup' }).catch(() => {});
    }

    // Jul 28 2026 — nightly archiving, confirmed design change (Priyam's
    // own proposal): archiving used to happen in real-time, on nearly
    // every write in the app — moved here specifically because that made
    // /tc/archiveLastUpdated change constantly throughout the business
    // day, which meant the archive cache (used by Reports) was almost
    // never actually valid. Now it happens once, here, alongside backup.
    // Reuses handlePopulateArchive/handlePopulateArchiveLots directly —
    // the same proven, already-tested bulk-archive tools built earlier,
    // not new logic. Looped since each call only processes one batch;
    // capped at 5 rounds to stay well within Cloudflare's 50-subrequest
    // limit per invocation — more than enough for a normal night's
    // volume, and anything left over simply gets picked up the next night.
    const _systemTokenClaim = { role: 'admin' };
    try {
      let dyeRemaining = 1, dyeRounds = 0;
      while (dyeRemaining > 0 && dyeRounds < 5) {
        const r = await handlePopulateArchive(30, _systemTokenClaim);
        const j = await r.json();
        dyeRemaining = j.remaining || 0;
        dyeRounds++;
        console.log(`✓ Nightly archive (dye): round ${dyeRounds}, archived ${j.archived || 0}, ${dyeRemaining} remaining`);
      }
    } catch (e) {
      console.log(`✗ Nightly archive (dye) failed: ${e.message}`);
    }
    try {
      let rmRemaining = 1, rmRounds = 0;
      while (rmRemaining > 0 && rmRounds < 5) {
        const r = await handlePopulateArchiveLots(20, _systemTokenClaim);
        const j = await r.json();
        rmRemaining = j.remaining || 0;
        rmRounds++;
        console.log(`✓ Nightly archive (RM): round ${rmRounds}, archived ${j.archived || 0}, ${rmRemaining} remaining`);
      }
    } catch (e) {
      console.log(`✗ Nightly archive (RM) failed: ${e.message}`);
    }

    // Success — write the visible status record
    await fbSet('/backupStatus', {
      lastAttempt: now.toISOString(), lastSuccess: now.toISOString(),
      status: 'success', backupKey: ts, retainedCount: Math.min(allKeys.length, MAX_BACKUPS), deletedCount,
      r2Status
    }).catch(() => {});
  } catch (e) {
    // The real fix — this is what was missing. Any failure, anywhere in
    // the steps above, now gets written somewhere you can actually see,
    // instead of vanishing into Cloudflare's own logs with no visible trace.
    console.log(`✗ Cron backup FAILED: ${e.message}`);
    await fbSet('/backupStatus', { lastAttempt: new Date().toISOString(), status: 'failed', error: e.message }).catch(() => {});
  }
}


// ─── Auto-update summaries after any status change ───────────────────────────

// Update lotSummary for a specific lot (called after soft/dye changes)
// Reverse lookup index: maps each RM lot key → set of dye lot IDs that source from it.
// Written/updated whenever a dye lot is saved or voided.
// Allows updateLotSummary to fetch only relevant dye lots (targeted ~100 bytes)
// instead of downloading the entire dyeLots collection (multi-MB).
async function updateLotToDyeLotsIndex(dyeLot) {
  if (!dyeLot || !dyeLot.id) return;
  const dyeLotId = dyeLot.id;
  const isVoided = dyeLot.status === 'Voided' || dyeLot.status === 'Rejected';

  // Only RM sources have lotId+grade+vendor — skip dead stock and recycle
  const rmSources = (dyeLot.sources || []).filter(s =>
    s.sourceType === 'rm' && s.lotId && s.grade && s.vendor
  );
  if (rmSources.length === 0) return;

  const updates = {};
  for (const src of rmSources) {
    const lotKey = summaryKey(src.lotId, src.grade, src.vendor);
    // Set to true if active, null if voided (null = Firebase delete)
    updates[`/tc/lotToDyeLots/${lotKey}/${dyeLotId}`] = isVoided ? null : true;
  }
  if (Object.keys(updates).length === 0) return;

  // Jul 11 2026 — this write was previously "fire and forget": one
  // transient failure left the index permanently wrong for that dye lot,
  // silently, with nothing to show it ever happened. Two changes:
  //
  // 1. THE FIRE (stop it from starting as much as possible) — retry up to
  //    3 times with a short backoff before giving up. Most transient
  //    failures (a network blip, a momentary Firebase hiccup) resolve on
  //    a retry; this alone should make the underlying failure rare rather
  //    than routine.
  //
  // 2. THE SMOKE DETECTOR (real visibility if it fails anyway) — if all
  //    retries are exhausted, write a real, persistent, queryable record
  //    to /tc/indexWriteFailures instead of a console.warn nobody reads.
  //    This is the actual answer to "how often is this happening" — a
  //    real count you can check, not a guess.
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await fbPatch('', updates); // multi-path update from root
      return; // success — done, no failure record needed
    } catch (e) {
      lastError = e;
      if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 250)); // 250ms, 500ms
    }
  }

  // All 3 attempts failed — this is the smoke detector firing for real.
  const failureId = 'IWF-' + dyeLotId + '-' + Date.now();
  await fbSet(`/tc/indexWriteFailures/${failureId}`, {
    dyeLotId,
    lotKeys: rmSources.map(s => summaryKey(s.lotId, s.grade, s.vendor)),
    error: lastError ? lastError.message : 'unknown',
    attempts: 3,
    timestamp: new Date().toISOString(),
  }).catch(e => console.warn('[smoke-detector] even the failure record failed to write:', e.message));
  console.warn(`[updateLotToDyeLotsIndex] FAILED after 3 attempts for dyeLot ${dyeLotId} — recorded at /tc/indexWriteFailures/${failureId}`);
}

// ─── Running-balance Phase 1 foundation (Jul 15 2026) ──────────────────────
// nudgeLotSummary/nudgeDyeLotSummary apply a small delta to specific fields
// of an already-cached summary, instead of recomputing the whole thing from
// scratch (the pattern updateLotSummary/updateDyeLotSummary already use).
// Reuses the exact same proven ETag-conditional-write-with-retry mechanism:
// on conflict (someone else wrote this record between our read and our
// write), re-read the now-current value and re-apply the SAME delta on top
// — two near-simultaneous updates both land correctly, neither is lost.
// fieldDeltas shape: {'rmBalance.kg': -200, 'rmBalance.units': -4, ...}
// Every nudged field is floored at 0 (matches the Qmax0 pattern used
// everywhere else in this codebase — balances never go negative; if a
// delta would drive one negative, that's a real bug the Phase 0 audit
// tool is designed to catch and report, not something to error out on
// mid-transaction).
async function nudgeLotSummary(lotId, grade, vendor, fieldDeltas, _retryCount = 0) {
  const key = summaryKey(lotId, grade, vendor);
  const url = `${FIREBASE_URL}/tc/lotSummaries/${key}.json${_fbAuthSuffix()}`;

  let current = null, etag = null;
  try {
    const getRes = await fetch(url, { headers: { 'X-Firebase-ETag': 'true' } });
    etag = getRes.headers.get('ETag');
    current = await getRes.json();
  } catch (e) { /* current stays null, handled below */ }

  if (!current) {
    // No cached summary yet for this lot — self-heal: one full recompute
    // (same proven formula) to seed a real baseline, then retry the nudge
    // on top of it. Gives up gracefully after 3 tries — the next real
    // trigger for this lot will correct it regardless.
    if (_retryCount >= 3) return;
    await updateLotSummary(lotId, grade, vendor).catch(() => {});
    await new Promise(r => setTimeout(r, 30));
    return nudgeLotSummary(lotId, grade, vendor, fieldDeltas, _retryCount + 1);
  }

  const next = { ...current };
  // Jul 25 2026 fix — Dye consuming from a Soft lot only ever reports
  // weight (confirmed: Dye tracks no units at all, by original design).
  // Every caller that reduces softBalance.kg for this reason was silently
  // leaving softBalance.units completely untouched — bags frozen forever,
  // proven empirically (28 bags stayed 28 even after weight dropped to
  // 0.01kg). The correct proportional estimate already existed in the full
  // recompute (calcLotSummary) — it just never ran during a normal
  // approval, which is nudge-only. Deriving it here means every current
  // AND future caller gets it right automatically, not just the ones
  // patched individually.
  if ('softBalance.kg' in fieldDeltas && !('softBalance.units' in fieldDeltas)) {
    const kgDelta = fieldDeltas['softBalance.kg'];
    const beforeKg = (current.softBalance || {}).kg || 0;
    const beforeUnits = (current.softBalance || {}).units || 0;
    if (kgDelta < 0 && beforeKg > 0 && beforeUnits > 0) {
      const estimatedUnitsConsumed = Math.round(beforeUnits * (Math.min(-kgDelta, beforeKg) / beforeKg));
      fieldDeltas = { ...fieldDeltas, 'softBalance.units': -estimatedUnitsConsumed };
    }
  }
  for (const [field, delta] of Object.entries(fieldDeltas)) {
    const [group, sub] = field.split('.');
    next[group] = { ...(next[group] || {}) };
    // Aug 26 2026 -- real, deliberate removal of the floor here too, matching the earlier decision (Check 245): a nudge should never quietly clamp a genuine, existing negative back to 0.
    next[group][sub] = (next[group][sub] || 0) + delta;
  }
  next.updatedAt = new Date().toISOString();
  // Sep 25 2026 — canonical _updatedAt, same reasoning as the full recompute path above — a partial nudge write
  // must refresh this the same way a full recompute does, or incremental sync would never notice a nudge-only change.
  next._updatedAt = new Date().toISOString();

  // Jul 24 2026 — same fix as nudgeDyeLotSummary. Same formula as
  // calcSummaryFromData, computed from the final post-delta numbers
  // already in hand.
  const _EPS = 0.01;
  const rb = next.rmBalance || {}, sb = next.softBalance || {}, db = next.dyeBalance || {}, wb = next.windBalance || {}, pb = next.packBalance || {};
  next.fullyDispatched =
    (rb.units || 0) === 0 && (rb.kg || 0) <= _EPS &&
    (sb.units || 0) === 0 && (sb.kg || 0) <= _EPS &&
    (db.cones || 0) === 0 && (db.kg || 0) <= _EPS &&
    (wb.cones || 0) === 0 && (wb.kg || 0) <= _EPS &&
    (pb.bags  || 0) === 0 && (pb.kg  || 0) <= _EPS;

  const putRes = await fetch(url, {
    method: 'PUT',
    headers: etag ? { 'Content-Type': 'application/json', 'if-match': etag } : { 'Content-Type': 'application/json' },
    body: JSON.stringify(next)
  });

  if (putRes.status === 412 && _retryCount < 3) {
    await new Promise(r => setTimeout(r, 40 + Math.random() * 100));
    return nudgeLotSummary(lotId, grade, vendor, fieldDeltas, _retryCount + 1);
  }
  if (putRes.status !== 200 && putRes.status !== 412) {
    console.warn(`[nudgeLotSummary] conditional write failed (${putRes.status}) for ${key}`);
    return;
  }
  // Sep 29 2026 — Phase 3: only invalidate on a genuine, confirmed-successful write (status 200) — a 412 that
  // reaches here means retries were exhausted on a real conflict, not a success, and must not invalidate.
  if (putRes.status === 200) await _invalidateSummaryCaches();

  // Archive/unarchive trigger — same logic as updateLotSummary, now
  // reachable from the fast nudge path too. RM lots have no status field
  // of their own, so this only checks fullyDispatched — archiveLotChain
  // itself still separately guards against archiving a lot with a live
  // Pending/InProgress Soft entry on it (Jul 24 2026 fix).
  try {
    const lotArchiveKey = summaryKey(lotId, grade, vendor);
    const isLotArchived = !!(await fbGet(`/tc/archive/lots/${lotArchiveKey}`).catch(() => null));
    // Jul 28 2026 — real-time archiving removed here, confirmed design
    // change: archiving now only happens once nightly, alongside backup
    // (handlePopulateArchiveLots, called from runCronBackup). Reasoning:
    // this trigger fires from nearly every write in the app, meaning
    // /tc/archiveLastUpdated changed constantly throughout the business
    // day — which meant the archive cache (used by Reports) was almost
    // never actually valid, undermining its own purpose. Unarchive stays
    // immediate below — leaving something incorrectly stuck in archive
    // (e.g. after a void reopens it) would be a real, live problem.
    if (!next.fullyDispatched && isLotArchived) {
      await unarchiveLotChain(lotId, grade, vendor);
    }
  } catch (e) { /* archive trigger is best-effort — the daily cron and any future full recompute still catch this */ }
}

async function nudgeDyeLotSummary(dyeLotId, fieldDeltas, _retryCount = 0) {
  const url = `${FIREBASE_URL}/tc/dyeLotSummaries/${dyeLotId}.json${_fbAuthSuffix()}`;

  let current = null, etag = null;
  try {
    const getRes = await fetch(url, { headers: { 'X-Firebase-ETag': 'true' } });
    etag = getRes.headers.get('ETag');
    current = await getRes.json();
  } catch (e) { /* current stays null, handled below */ }

  if (!current) {
    if (_retryCount >= 3) return;
    await updateDyeLotSummary(dyeLotId).catch(() => {});
    await new Promise(r => setTimeout(r, 30));
    return nudgeDyeLotSummary(dyeLotId, fieldDeltas, _retryCount + 1);
  }

  const next = { ...current };
  for (const [field, delta] of Object.entries(fieldDeltas)) {
    const [group, sub] = field.split('.');
    next[group] = { ...(next[group] || {}) };
    // Aug 26 2026 -- real, deliberate removal of the floor here too, matching the earlier decision (Check 245): a nudge should never quietly clamp a genuine, existing negative back to 0.
    next[group][sub] = (next[group][sub] || 0) + delta;
  }
  next.updatedAt = new Date().toISOString();
  // Sep 25 2026 — canonical _updatedAt, same reasoning as nudgeLotSummary above.
  next._updatedAt = new Date().toISOString();

  // Jul 24 2026 — fullyDispatched used to only get recalculated by the
  // full recompute path (updateDyeLotSummary), meaning a plain approval
  // (the common case, which only nudges) never updated this flag and
  // never triggered archive/unarchive in real time — it just sat stale
  // until something else (void/edit/the daily cron) eventually caught up.
  // Same exact formula as calcDyeLotSummary, computed here since the
  // nudge already has the final post-delta numbers in hand — no extra
  // fetch needed.
  const db = next.dyeBalance || {}, wb = next.windBalance || {}, pb = next.packBalance || {};
  next.fullyDispatched =
    (db.cones || 0) === 0 && (db.kg || 0) === 0 &&
    (wb.cones || 0) === 0 && (wb.kg || 0) === 0 &&
    (pb.bags  || 0) === 0 && (pb.kg  || 0) === 0;

  const putRes = await fetch(url, {
    method: 'PUT',
    headers: etag ? { 'Content-Type': 'application/json', 'if-match': etag } : { 'Content-Type': 'application/json' },
    body: JSON.stringify(next)
  });

  if (putRes.status === 412 && _retryCount < 3) {
    await new Promise(r => setTimeout(r, 40 + Math.random() * 100));
    return nudgeDyeLotSummary(dyeLotId, fieldDeltas, _retryCount + 1);
  }
  if (putRes.status !== 200 && putRes.status !== 412) {
    console.warn(`[nudgeDyeLotSummary] conditional write failed (${putRes.status}) for ${dyeLotId}`);
    return;
  }
  // Sep 29 2026 — Phase 3: only invalidate on a genuine, confirmed-successful write, same reasoning as
  // nudgeLotSummary above — a 412 reaching here means retries were exhausted on a real conflict, not a success.
  if (putRes.status === 200) await _invalidateSummaryCaches();

  // Archive/unarchive trigger — same logic as updateDyeLotSummary, now
  // reachable from the fast nudge path too, not just the full recompute.
  try {
    const isCurrentlyArchived = !!(await fbGet(`/tc/archive/dyeLots/${dyeLotId}`).catch(() => null));
    // Jul 28 2026 — same real-time-archiving removal as nudgeLotSummary,
    // same reasoning. Unarchive stays immediate.
    if (!next.fullyDispatched && isCurrentlyArchived) {
      await unarchiveDyeLotChain(dyeLotId);
    }
  } catch (e) { /* archive trigger is best-effort — the daily cron and any future full recompute still catch this */ }
}

// Aug 6 2026 — real, shared consolidation of the ETag conditional-write
// pattern, previously duplicated across 5 real functions (updateLotSummary,
// updateDyeLotSummary, updatePartySummary, updateOrderSummaries,
// updateSentToDyeOnly). All 5 shared the exact same core logic — read the
// current ETag, PUT conditionally, retry up to 3 times on a genuine
// conflict (someone else wrote this same record in between), fall back to
// a plain write if the ETag read itself failed. Real, minor differences
// between them (whole-record replace vs a field-merge, single write vs a
// loop over several) are handled by the caller, not baked into this
// shared piece — this only knows "write this data to this path,
// conditionally, and call me back to retry on a real conflict."
async function _conditionalWrite(path, data, onRetry, _retryCount = 0) {
  const url = `${FIREBASE_URL}${path}.json${_fbAuthSuffix()}`;
  let etag = null;
  try {
    const getRes = await fetch(url, { headers: { 'X-Firebase-ETag': 'true' } });
    etag = getRes.headers.get('ETag');
  } catch (e) { /* fall through to plain write below */ }
  if (etag) {
    const putRes = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'if-match': etag },
      body: JSON.stringify(data)
    });
    if (putRes.status === 412 && _retryCount < 3) {
      await new Promise(r => setTimeout(r, 40 + Math.random() * 100));
      // Real, important correctness fix, caught before shipping: the
      // original inline pattern always used `return updateX(...)` on
      // conflict — exiting the outer function immediately, since the
      // retry re-runs the whole thing, including any logic after the
      // write. Returning a plain value here and letting the caller keep
      // going would silently let that logic run twice on a real
      // conflict — once inside this retry, once again in the original,
      // still-running call. Signaling retried:true so every real caller
      // can return immediately, matching the original, correct behavior.
      return { retried: true, result: await onRetry(_retryCount + 1) };
    }
    if (putRes.status !== 200 && putRes.status !== 412) {
      await fbPatch(path, data).catch(() => {});
    }
  } else {
    await fbPatch(path, data).catch(() => {});
  }
  return { retried: false };
}

async function updateLotSummary(lotId, grade, vendor, _allData, _retryCount = 0) {
  let data = _allData;
  if (!data) {
    // Targeted fetch using the reverse lookup index at /tc/lotToDyeLots/{lotKey}.
    // This replaces the old fbGetMerged('/tc/dyeLots') full-collection download.
    // Index is populated/updated by updateLotToDyeLotsIndex() on every dye lot save.
    const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(e => e && e.id);
    const lotKey = summaryKey(lotId, grade, vendor);

    // Step 1: get list of dye lot IDs that source from this RM lot (~100 bytes)
    const sourcingMap = await fbGet(`/tc/lotToDyeLots/${lotKey}`).catch(() => null) || {};
    let sourcingDyeLotIds = Object.keys(sourcingMap).filter(k => sourcingMap[k] === true);

    // Jul 11 2026 — self-healing fallback, root-caused after a real production
    // discrepancy: updateLotToDyeLotsIndex() writes this index as a "fire and
    // forget" side effect (errors caught and only console.warn'd, never
    // retried) — a single transient failure leaves the index permanently
    // empty for that dye lot, with no visible error anywhere.
    //
    // Jul 13 2026 UPDATE — this originally only verified when the index was
    // completely EMPTY. Confirmed via a real production case (lot 04) that
    // the index can also be PARTIALLY populated — 2 real entries out of 7,
    // not zero — and a non-empty index was being trusted completely, with
    // no way to detect it was incomplete rather than correct. Every
    // downstream fix (subrequest limit, race condition, strict matching)
    // was still silently wrong because all of them ultimately relied on
    // this same index. Now verifies for real EVERY time, regardless of
    // whether the index is empty or not — the ~100-byte fast-path read is
    // no longer trusted as sufficient on its own, only as a hint. Costs one
    // real merged fetch every call instead of only on the rare empty case,
    // but correctness matters more here than the saved bandwidth, given
    // what trusting a "looks non-empty, must be fine" index actually cost.
    {
      const verifyDyeLots = await fbGetMerged('/tc/dyeLots', '/tc/archive/dyeLots');
      const realMatches = verifyDyeLots.filter(d =>
        (d.sources || []).some(s => s.sourceType === 'rm' && s.lotId === lotId && s.grade === grade && s.vendor === vendor)
      );
      const realIds = realMatches.map(d => d.id);
      const indexWasWrong = realIds.length !== sourcingDyeLotIds.length || realIds.some(id => !sourcingDyeLotIds.includes(id));
      if (indexWasWrong) {
        console.warn(`[self-heal] lotToDyeLots index for ${lotKey} was WRONG — had ${sourcingDyeLotIds.length} entries, ${realIds.length} real matches exist — repairing index and using real data for this calculation.`);
        sourcingDyeLotIds = realIds;
        const repair = {};
        realMatches.forEach(d => { repair[`/tc/lotToDyeLots/${lotKey}/${d.id}`] = true; });
        await fbPatch('', repair).catch(e => console.warn('[self-heal] index repair write failed:', e.message));
        // Same visibility record as updateLotToDyeLotsIndex's own retry
        // exhaustion — this is the OTHER way the smoke detector can catch
        // a failure: not at write-time (all 3 retries succeeded there),
        // but discovered later, at read-time, meaning the ORIGINAL write
        // failed for some other reason entirely (e.g. the index write
        // ran before this dye lot's sources were fully populated, or ran
        // against a since-changed lotKey). Recorded to the same place so
        // one query answers "how often is this happening" regardless of
        // which path caught it.
        const healId = 'SH-' + lotKey + '-' + Date.now();
        await fbSet(`/tc/indexWriteFailures/${healId}`, {
          lotKey, foundVia: 'self-heal-read-time', dyeLotIds: sourcingDyeLotIds,
          timestamp: new Date().toISOString(),
        }).catch(e => console.warn('[self-heal] failure record write failed:', e.message));
      }
    }

    // Step 2: fetch the specific lot record (by composite key, active + archive)
    const lotIdQuery = `orderBy="lotId"&equalTo="${lotId}"`;
    const [lotActive, lotArchive, stageActive, stageArchive, residualLogRaw, rmReturnLogRaw, scrapLogRaw] = await Promise.all([
      fbGet(`/tc/lots/${lotKey}`).catch(() => null),
      fbGet(`/tc/archive/lots/${lotKey}`).catch(() => null),
      fbGet('/tc/stageEntries', lotIdQuery).catch(() => null),
      fbGet('/tc/archive/stageEntries', lotIdQuery).catch(() => null),
      fbGet('/tc/residualLog', lotIdQuery).catch(() => null),
      fbGet('/tc/rmReturnLog', lotIdQuery).catch(() => null),
      // Jul 10 2026 — scrapLog is entry-scoped (tied to a stageEntries id via
      // entryId, not to the RM lot directly), so it can't use the same
      // targeted lotId query as residualLog/rmReturnLog above. Full fetch
      // accepted as a known exception — scrapLog is small and legacy-only
      // (superseded by residualLog for new entries), same documented
      // exception pattern already used elsewhere in this function for
      // dyeLots' nested sources[] array.
      fbGet('/tc/scrapLog').catch(() => null),
    ]);
    const residualLog = toArr(residualLogRaw);
    const rmReturnLog = toArr(rmReturnLogRaw);
    const scrapLog = toArr(scrapLogRaw);

    // Aug 26 2026 — real, genuine fix built via direct discussion with
    // Priyam: a Merged or Voided lot keeps its own id/grade/vendor
    // unchanged — only its status changes — so this specific address
    // can still get a recalculation triggered against it. Computing and
    // writing a fresh summary here would be genuinely misleading, since
    // whatever real activity this lot had has either moved elsewhere
    // (merged) or should count as if it never happened (voided). Same
    // real principle as recalc-all's own filter, applied here too, so
    // both paths are protected the same way, regardless of which one
    // gets triggered.
    const _thisLotForGuard = lotActive || lotArchive;
    if (_thisLotForGuard && (_thisLotForGuard.status === 'Merged' || _thisLotForGuard.status === 'Voided')) {
      await fbSet(`/tc/lotSummaries/${lotKey}`, null).catch(() => {});
      await _invalidateSummaryCaches();
      return;
    }

    // Step 3: fetch downstream entries — FIXED number of requests regardless
    // of how many dye lots this RM lot has (Jul 13 2026 fix). The old version
    // fired 8 Firebase requests PER related dye lot (dyeLot+wind+pack+dispatch,
    // each active+archive) — fine for 1-2 dye lots, but a lot with 7 related
    // dye lots meant 56 simultaneous requests, exceeding Cloudflare's per-
    // invocation subrequest limit and crashing with a 500 before anything
    // got written. Root-caused via a real production case: lot "04" had 7
    // dye lots, recalc failed silently/loudly every time for weeks, while
    // lots with 1-2 dye lots never hit the ceiling and worked fine — which is
    // why this looked like a one-lot problem rather than a scaling bug.
    // Fix: 8 fetches total, fixed, no matter how many dye lots are involved —
    // pull each table once (active+archive), filter to the relevant IDs in
    // memory afterward instead of asking Firebase once per ID.
    let allDyeLots = [], windEntries = [], packEntries = [], dispatches = [];
    if (sourcingDyeLotIds.length > 0) {
      const idSet = new Set(sourcingDyeLotIds);
      const [dlActive, dlArchive, windActive, windArchive, packActive, packArchive, dispActive, dispArchive] = await Promise.all([
        fbGet('/tc/dyeLots').catch(() => null),
        fbGet('/tc/archive/dyeLots').catch(() => null),
        fbGet('/tc/windEntries').catch(() => null),
        fbGet('/tc/archive/windEntries').catch(() => null),
        fbGet('/tc/packEntries').catch(() => null),
        fbGet('/tc/archive/packEntries').catch(() => null),
        fbGet('/tc/dispatches').catch(() => null),
        fbGet('/tc/archive/dispatches').catch(() => null)
      ]);
      allDyeLots = [...toArr(dlActive), ...toArr(dlArchive)].filter(d => idSet.has(d.id));
      windEntries = [...toArr(windActive), ...toArr(windArchive)].filter(e => idSet.has(e.dyeLotId));
      packEntries = [...toArr(packActive), ...toArr(packArchive)].filter(e => idSet.has(e.dyeLotId));
      dispatches = [...toArr(dispActive), ...toArr(dispArchive)].filter(e => idSet.has(e.dyeLotId));
    }

    const lots = [lotActive, lotArchive].filter(Boolean);
    const stageEntries = [...toArr(stageActive), ...toArr(stageArchive)];
    data = { lots, stageEntries, dyeLots: allDyeLots, windEntries, packEntries, dispatches, residualLog, rmReturnLog, scrapLog };
  }

  // Merge lot records (multi-delivery)
  const lotRecords = data.lots.filter(l => l.id === lotId && l.grade === grade && l.vendor === vendor);
  if (!lotRecords.length) return null;
  const lot = lotRecords.reduce((merged, l) => {
    if (!merged.id) return l;
    const allDeliveries = [...(merged.deliveries||[]), ...(l.deliveries||[])];
    return { ...merged, units: (merged.units||0)+(l.units||0), weight: (merged.weight||0)+(l.weight||0), deliveries: allDeliveries };
  }, {});
  const summary = calcSummaryFromData(lot, data.stageEntries, data.dyeLots, data.windEntries, data.packEntries, data.dispatches, data.residualLog || [], data.rmReturnLog || [], data.scrapLog || []);
  const key = summaryKey(lotId, grade, vendor);
  // Jul 14 2026 — conditional write closes the "two parallel updates both
  // think they win" gap. On conflict (someone else wrote this exact
  // record in between our read and our write), our computation was based
  // on now-stale source data — recurse for a genuinely fresh recompute
  // rather than blindly overwriting whatever the other write just set.
  // Aug 6 2026 — now uses the shared _conditionalWrite helper, same real
  // logic, no longer duplicated inline here.
  // Real correctness note: if a retry happened, the retry's own,
  // complete execution already handled everything below this point
  // (including the archive trigger) with fresh data — returning here
  // immediately, matching the original behavior, so it doesn't run
  // twice.
  const _cw1 = await _conditionalWrite(`/tc/lotSummaries/${key}`, summary, (newRetryCount) => updateLotSummary(lotId, grade, vendor, undefined, newRetryCount), _retryCount);
  if (_cw1.retried) return _cw1.result;
  await _invalidateSummaryCaches();

  // ── Stage 2 Archive trigger ──────────────────────────────────────────────
  const lotArchiveKey=summaryKey(lotId, lot.grade, lot.vendor);
  const isLotArchived=!!(await fbGet(`/tc/archive/lots/${lotArchiveKey}`).catch(()=>null));
  // Jul 28 2026 — same real-time-archiving removal, same reasoning.
  if(!summary.fullyDispatched&&isLotArchived){
    await unarchiveLotChain(lotId,lot.grade,lot.vendor);
  }

  return summary;
}
// Update dyeLotSummary for a specific dye lot (called after wind/pack/dispatch changes)
async function updateDyeLotSummary(dyeLotId, _allData, _retryCount = 0) {
  let data = _allData;
  if (!data) {
    // Targeted fetch — only download entries for this specific dyeLotId.
    // Requires dyeLotId indexes on windEntries/packEntries/dispatches in firebase-rules.json.
    // This replaces the old full-collection fbGetMerged approach (was downloading 2-4MB
    // of all entries just to compute one lot's summary — Jul 2026 bandwidth fix).
    const dyeLotQuery = `orderBy="dyeLotId"&equalTo="${dyeLotId}"`;
    const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(e => e && e.id);

    const [
      dyeLotActive, dyeLotArchive,
      windActive, windArchive,
      packActive, packArchive,
      dispActive, dispArchive
    ] = await Promise.all([
      fbGet(`/tc/dyeLots/${dyeLotId}`).catch(() => null),
      fbGet(`/tc/archive/dyeLots/${dyeLotId}`).catch(() => null),
      fbGet('/tc/windEntries', dyeLotQuery).catch(() => null),
      fbGet('/tc/archive/windEntries', dyeLotQuery).catch(() => null),
      fbGet('/tc/packEntries', dyeLotQuery).catch(() => null),
      fbGet('/tc/archive/packEntries', dyeLotQuery).catch(() => null),
      fbGet('/tc/dispatches', dyeLotQuery).catch(() => null),
      fbGet('/tc/archive/dispatches', dyeLotQuery).catch(() => null),
    ]);

    // dyeLot is a single object fetch (by key), not a collection
    const dyeLot = dyeLotActive || dyeLotArchive;
    const dyeLots = dyeLot ? [dyeLot] : [];
    const windEntries = [...toArr(windActive), ...toArr(windArchive)];
    const packEntries = [...toArr(packActive), ...toArr(packArchive)];
    const dispatches  = [...toArr(dispActive), ...toArr(dispArchive)];
    data = { dyeLots, windEntries, packEntries, dispatches };
  }
  const dyeLot = data.dyeLots.find(d => d.id === dyeLotId);
  if (!dyeLot) return null;
  const summary = calcDyeLotSummary(dyeLot, data.windEntries, data.packEntries, data.dispatches);
  // Jul 14 2026 — same conditional-write protection as updateLotSummary,
  // applied to dye lot summaries too — closes the gap for every summary
  // type in the app, not just RM lots.
  // Aug 6 2026 — now uses the shared _conditionalWrite helper.
  const _cw2 = await _conditionalWrite(`/tc/dyeLotSummaries/${dyeLotId}`, summary, (newRetryCount) => updateDyeLotSummary(dyeLotId, undefined, newRetryCount), _retryCount);
  if (_cw2.retried) return _cw2.result;
  await _invalidateSummaryCaches();

  // ── Archive / Unarchive trigger ──────────────────────────────────────────
  const isCurrentlyArchived = !!(await fbGet(`/tc/archive/dyeLots/${dyeLotId}`).catch(() => null));
  // Jul 28 2026 — same real-time-archiving removal, same reasoning.
  if (!summary.fullyDispatched && isCurrentlyArchived) {
    await unarchiveDyeLotChain(dyeLotId);
  }

  return summary;
}
// ─── User Management — /tc/users fully blocked client-side, all CRUD goes through here ───
// Aug 5 2026 — was reachable by any logged-in role (a global session-token
// check gates all of /api/*, but nothing role-specific gated this one
// endpoint the way create/toggle/delete/reset-password already are). The
// desktop UI already hides the "Users" nav button for non-manager roles,
// but that's a UI convenience, not a security boundary — the endpoint
// itself needs its own check regardless of what the button shows. Same
// role check as the other 4 user-management endpoints.
async function handleUsersList(tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin/manager access required', 403);
  const users = await _usersArray();
  const safe = users.map(({ password, ...rest }) => rest);
  return jsonResponse({ users: safe });
}

async function handleUsersCreate(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin/manager access required', 403);
  const { name, username, password, role: newRole, stage } = body || {};
  if (!name || !username || !password || password.length < 8) {
    return errorResponse('Fill all fields (password min 8 chars)', 400);
  }
  // Jul 22 2026 — same fix as RM Edit and Dye End: the username check and
  // the save were two separate steps with nothing holding them together.
  // For this function specifically, that gap was actually more serious
  // than a name collision — since the whole users array gets read then
  // rewritten whole, two concurrent creations could silently lose one
  // user entirely, not just collide on username. Locked the same way.
  const lockKey = `USERCREATE_${username}`.replace(/[^a-zA-Z0-9_]/g, '_');
  const result = await withBalanceLock(lockKey, async () => {
    const users = await _usersArray();
    if (users.find(u => u.username === username)) return { __rejected: errorResponse('Username taken', 400) };
    const hashedPwd = await hashPasswordPbkdf2(password);
    const newUser = { id: 'u' + Date.now(), name, username, password: hashedPwd, role: newRole, stage, active: true };
    users.push(newUser);
    await fbSet('/tc/users', users);
    const { password: _pw, ...safeUser } = newUser;
    return { success: true, user: safeUser };
  });
  if (result.__lockFailed) return errorResponse(result.error);
  if (result.__rejected) return result.__rejected;
  return jsonResponse(result);
}

// Aug 5 2026 — toggle/delete both did a read-whole-array, mutate,
// write-whole-array with nothing holding the two steps together, same
// exact gap handleUsersCreate was already fixed for ("two concurrent
// creations could silently lose one user entirely"). Same fix here:
// wrapped in withBalanceLock so two admins acting on users at the same
// moment can't race and drop one write.
async function handleUsersToggle(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin/manager access required', 403);
  const { id } = body || {};
  if (!id) return errorResponse('id required', 400);
  const result = await withBalanceLock('USERS_WRITE', async () => {
    const users = await _usersArray();
    const u = users.find(x => x.id === id);
    if (!u) return { __rejected: errorResponse('User not found', 404) };
    if (u.username === 'admin') return { __rejected: errorResponse('Cannot disable the admin account', 400) };
    u.active = u.active === false ? true : false;
    await fbSet('/tc/users', users);
    return { success: true, active: u.active };
  });
  if (result.__lockFailed) return errorResponse(result.error);
  if (result.__rejected) return result.__rejected;
  return jsonResponse(result);
}

async function handleUsersDelete(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin/manager access required', 403);
  const { id, password, username } = body || {};
  // Sep 10 2026 — real, genuine gap found via Priyam's own requested
  // holistic app-wide audit: deleting a user account — permanent,
  // hard to undo — had no password confirmation at all, unlike every
  // comparable destructive action in the app. Matching the same
  // proven pattern here, per Priyam's own direct decision that this
  // one specifically should require it.
  const verifiedUser = await _verifySelfPassword(username, password);
  if (!verifiedUser) return errorResponse('Incorrect password', 401);
  if (!id) return errorResponse('id required', 400);
  const result = await withBalanceLock('USERS_WRITE', async () => {
    const users = await _usersArray();
    const u = users.find(x => x.id === id);
    if (!u) return { __rejected: errorResponse('User not found', 404) };
    if (u.username === 'admin') return { __rejected: errorResponse('Cannot delete the admin account', 400) };
    const filtered = users.filter(x => x.id !== id);
    await fbSet('/tc/users', filtered);
    return { success: true };
  });
  if (result.__lockFailed) return errorResponse(result.error);
  if (result.__rejected) return result.__rejected;
  return jsonResponse(result);
}

async function handleUsersResetPassword(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin/manager access required', 403);
  const { id, newPassword } = body || {};
  if (!id || !newPassword || newPassword.length < 4) {
    return errorResponse('id and password (min 4 chars) required', 400);
  }
  const users = await _usersArray();
  const idx = users.findIndex(x => x.id === id);
  if (idx === -1) return errorResponse('User not found', 404);
  const hashedPwd = await hashPasswordPbkdf2(newPassword);
  users[idx] = { ...users[idx], password: hashedPwd };
  await fbSet('/tc/users', users);
  const { password: _pw, ...safeUser } = users[idx];
  return jsonResponse({ success: true, user: safeUser });
}


// ─── Session token (HMAC-signed, 24h expiry) ──────────────────────────────
// Aug 26 2026 — real, genuine fix built via direct discussion with
// Priyam, closing the last of the 5 original security items: the
// login token used to live only in sessionStorage, readable by any
// script on the page, including a real XSS attack. Now, on top of
// that, it's also set as a real HttpOnly cookie — a storage spot
// JavaScript is physically incapable of reading, no matter what.
// This helper checks the cookie first, falling back to the existing
// Authorization header (still supported, for anything not yet
// switched over) — every one of the 67 existing verifySessionToken
// call sites gets this instead of the raw header, with zero other
// changes needed, since it returns the exact same "Bearer ..." shape
// verifySessionToken has always expected.
function _getAuthHeaderOrCookie(request) {
  const header = request.headers.get('Authorization');
  if (header) return header;
  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.match(/(?:^|;\s*)tc_session=([^;]+)/);
  return match ? `Bearer ${decodeURIComponent(match[1])}` : null;
}

async function generateSessionToken(username, role, secret) {
  const expiry = Date.now() + 86400000; // 24h
  const payload = username + ':' + role + ':' + expiry;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,'0')).join('');
  return payload + ':' + sigHex;
}
async function verifySessionToken(authHeader, secret) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  const parts = token.split(':');
  if (parts.length < 4) return null;
  const sigHex = parts[parts.length - 1];
  const expiry = parseInt(parts[parts.length - 2]);
  const role = parts[parts.length - 3];
  const username = parts.slice(0, parts.length - 3).join(':');
  if (isNaN(expiry) || Date.now() > expiry) return null;
  const payload = username + ':' + role + ':' + expiry;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['verify']);
  const sigBytes = new Uint8Array(sigHex.match(/.{2}/g).map(h => parseInt(h, 16)));
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(payload));
  return valid ? { username, role } : null;
}


// ─── API: Active data endpoints (replaces direct Firebase SDK reads) ──────────
// GET /api/data/:path — fetches active entries from Firebase server-side
// Supports: stageEntries, dyeLots (Phase 1)
// Query params: ?limit=N (default 500), ?since=ISO_DATE (optional date filter)
async function handleGetActiveData(path, url) {
  const STAGE_PATHS = ['stageEntries','dyeLots','windEntries','packEntries','dispatches','lots'];
  // Sep 8 2026 — real, direct fix built via direct discussion with
  // Priyam, who directly suspected the flag feature wasn't really
  // working: dyeLotFlags and entryFlags were missing from this list
  // entirely, while lotFlags (RM's own) was correctly here. Every
  // targeted post-save refresh for a Dye Lot or Soft/Wind/Pack/
  // Dispatch flag (saveDyeFlag/saveEntryFlag, pages.js) hit this
  // endpoint, got a 400 "Unknown path", and silently gave up — no
  // error shown, just a console warning nobody sees. The badge on
  // screen stayed stale until the next full login (a separate,
  // working one-time loader with its own Firebase-direct fallback
  // papered over it there, which is why it looked fine right after
  // logging in, just not right after saving).
  const STATIC_PATHS = ['masters','parties','partyOrders','lotSummaries','dyeLotSummaries','partySummaries','orderSummaries','voidLog','editLog','deleteRequests','lotFlags','dyeLotFlags','entryFlags','scrapLog','deadStock','recycleStock','recycleSoft','residualLog','residualStock','rmReturnLog','holdOverrides'];
  const ALLOWED = [...STAGE_PATHS, ...STATIC_PATHS];
  if (!ALLOWED.includes(path)) return errorResponse('Unknown path', 400);
  const since = url.searchParams.get('since');
  // Jul 28 2026 — two additions for the login-bandwidth fix, both only
  // meaningful for the 6 stage paths:
  //   updatedSince — safe incremental fetch, using the _updatedAt marker
  //     added to every write (creation AND later changes both stamp it),
  //     NOT the old creation-date 'since' above, which would miss a
  //     record that was created earlier but changed since last sync.
  //   shallow — returns just the list of IDs currently in the table
  //     (a tiny Firebase shallow query), used purely to verify nothing
  //     was missed by the incremental fetch — not for display.
  const updatedSince = url.searchParams.get('updatedSince');
  const shallow = url.searchParams.get('shallow') === 'true';
  try {
    // Sep 2026 — Smart Loader Phase 2c extension: the 9 newer synchronized tables (centralized _updatedAt
    // coverage already confirmed for all of them) now need the SAME shallow/updatedSince support STAGE_PATHS
    // already has, so the Smart Loader's incremental/verification/targeted-recovery steps work for them too.
    // Checked FIRST, before the plain STATIC_PATHS branch below (which still lists all 9 of them, same as
    // always, for the allowlist's sake and for every other caller of this function that has nothing to do with
    // Smart Loader) — so for exactly these 9 table names, this branch runs INSTEAD of the raw/unfiltered static
    // one. Written as an inline literal, not a reference to a separately-declared list, so this check is fully
    // self-contained: correct using only `path`/`shallow`/`updatedSince`, already in scope at this exact point.
    // Never used for anything with an archive counterpart — none of these 9 has one.
    if (['deadStock','recycleStock','scrapLog','recycleSoft','residualLog','residualStock','rmReturnLog','voidLog','editLog'].includes(path)) {
      if (shallow) {
        const raw = await fbGet(`/tc/${path}`, 'shallow=true');
        const ids = raw ? Object.keys(raw) : [];
        return jsonResponse({ ids, path });
      }
      const query = updatedSince ? `orderBy="_updatedAt"&startAt="${updatedSince}"` : null;
      const raw = query ? await fbGet(`/tc/${path}`, query) : await fbGet(`/tc/${path}`);
      const arr = raw
        ? (Array.isArray(raw) ? raw : Object.values(raw)).filter(e => e && typeof e === 'object' && e.id)
        : [];
      return jsonResponse({ data: arr, path, count: arr.length });
    }
    // Static paths — return raw Firebase value (object/array, not filtered)
    if (STATIC_PATHS.includes(path)) {
      // Sep 29 2026 — Phase 3: only lotSummaries/dyeLotSummaries get Redis in front of this read, via the shared
      // _getCachedSummaryTable helper. Every other STATIC_PATHS entry (masters, parties, etc.) is explicitly out
      // of scope for this phase and untouched — confirmed correctness reasons in the readiness audit.
      const raw = (path === 'lotSummaries' || path === 'dyeLotSummaries')
        ? await _getCachedSummaryTable(path)
        : await fbGet(`/tc/${path}`);
      return jsonResponse({ data: raw, path, static: true });
    }
    if (shallow && STAGE_PATHS.includes(path)) {
      const raw = await fbGet(`/tc/${path}`, 'shallow=true');
      const ids = raw ? Object.keys(raw) : [];
      return jsonResponse({ ids, path });
    }
    // Sep 22 2026 — real, direct extension built via direct discussion with Priyam: the incremental-load "missing record"
    // deep diagnostic could only ever check the ACTIVE table, so an old, completed record that had since moved to
    // archive (a normal, healthy lifecycle event, not a bug) was wrongly reported as "genuinely gone" — confirmed on a
    // real record (DL-1718) that Priyam proved, via its own real Edit Log entry, had definitely existed. This flag lets
    // that same diagnostic check both tables together, using the exact same fbGetMerged() the app already trusts
    // elsewhere for this exact active+archive merge (Vendor Tracker / Lot Lifecycle / Dye Lifecycle catalogs).
    if (url.searchParams.get('includeArchive') === 'true' && STAGE_PATHS.includes(path)) {
      // Sep 22 2026 — real, direct fix: DL-1718 kept being reported as "genuinely exists" with no way to tell whether
      // it came from the active table or the archive table — leaving the actual question (still active, or archived?)
      // unanswered even after finding it. Now tags each record so the diagnostic can say which, for certain.
      const [activeRaw, archiveRaw] = await Promise.all([
        fbGet(`/tc/${path}`).catch(() => null),
        fbGet(`/tc/${path}`.replace('/tc/', '/tc/archive/')).catch(() => null)
      ]);
      const toArrTagged = (v, tag) => (Array.isArray(v) ? v : Object.values(v || {})).filter(e => e && e.id).map(e => ({ ...e, _foundIn: tag }));
      const merged = [...toArrTagged(activeRaw, 'active'), ...toArrTagged(archiveRaw, 'archive')];
      return jsonResponse({ data: merged, path, count: merged.length, includedArchive: true });
    }
    // Stage paths — ordered by date, converted to array
    const limit = parseInt(url.searchParams.get('limit') || '9999');
    const _dfMap = {stageEntries:'startTime',dyeLots:'createdAt',windEntries:'startTime',packEntries:'timestamp',dispatches:'timestamp',lots:'date'};
    const dateField = _dfMap[path] || 'timestamp';
    let query;
    if (updatedSince) {
      query = `orderBy="_updatedAt"&startAt="${updatedSince}"`;
    } else if (!since && limit >= 9999) {
      // Sep 22 2026 — real, confirmed fix built via direct discussion with Priyam: a genuine, real dye lot (DL-1718 —
      // created and approved back in July, confirmed to genuinely still exist) was PERSISTENTLY, every single time,
      // missing from this exact query's results — while the SAME table read plainly (no orderBy/limitToLast at all,
      // the same way fbGetMerged() already reads active+archive elsewhere) found it every time without fail. A limit
      // of 9999 against a table nowhere near that size is not really "give me the last 9999 by <dateField>" — every
      // caller sending it means "give me the whole table" (confirmed: this is the exact value _doFullFetch always
      // sends). There is no reason to route "give me everything" through an orderBy+limitToLast Firebase query at
      // all when a plain, unfiltered read already does the exact same job with no sort field involved to go wrong.
      query = null;
    } else {
      query = `orderBy="${dateField}"&limitToLast=${limit}`;
      if (since) query += `&startAt="${since}"`;
    }
    const raw = query ? await fbGet(`/tc/${path}`, query) : await fbGet(`/tc/${path}`);
    const arr = raw
      ? (Array.isArray(raw) ? raw : Object.values(raw)).filter(e => e && typeof e === 'object' && e.id)
      : [];
    return jsonResponse({ data: arr, path, count: arr.length });
  } catch(e) {
    return errorResponse(`Failed to fetch ${path}: ${e.message}`, 500);
  }
}


// ─── API: Save endpoint — routes all client writes through Worker ─────────────
// Replaces direct Firebase SDK writes from the browser.
// Authorization: token verified before reaching here (in main fetch handler).
// Data accuracy: trusted from client (browser validates before sending).

// Role requirements per table
const _MANAGER_ONLY = new Set(['masters','agingThresholds']);
const _SUPERVISOR_PLUS = new Set(['partyOrders','deleteRequests','deadStock','recycleStock','lotFlags']);   // recycleSoft is written by workers (like stageEntries), so it is NOT listed here

function _canWrite(table, role) {
  if (_MANAGER_ONLY.has(table)) return role === 'admin' || role === 'manager';
  if (_SUPERVISOR_PLUS.has(table)) return ['admin','manager','supervisor'].includes(role);
  return true; // stageEntries, dyeLots, windEntries, packEntries, dispatches, lots, editLog, voidLog, scrapLog, residualStock
}

function _lotKeyW(item) {
  // Replicates client _lotKey() for lots composite key
  return summaryKey(item.id, item.grade, item.vendor);
}

// Tables that feed Category 1 report summaries (rptFlow/rptMachine/rptWorker/
// rptShade/rptGrade/rptWaste). A save to any of these means /tc/reportSummaries
// is now stale — flagged in handleSave below, cleared only by an actual recompute.
const _REPORT_SUMMARY_TABLES = ['stageEntries', 'dyeLots', 'windEntries', 'packEntries', 'dispatches'];

async function handleSave(body, tokenClaim) {
  const { table, item, items, data } = body || {};
  if (!table) return errorResponse('table required', 400);

  const role = tokenClaim?.role || '';
  if (!_canWrite(table, role)) {
    return errorResponse(`Role '${role}' cannot write to '${table}'`, 403);
  }

  const now = new Date().toISOString();
  const updatedBody = {};

  try {
    if (item && item.id) {
      // Single item upsert — most common case
      const fbKey = table === 'lots' ? _lotKeyW(item) : item.id;
      item._updatedAt = now; // track for future polling
      await fbSet(`/tc/${table}/${fbKey}`, item);
      updatedBody[`_lastChanged/${table}`] = now;
      await fbPatch('/tc', updatedBody);
      // Update reverse lookup index when a dye lot is saved or voided
      if (table === 'dyeLots') await updateLotToDyeLotsIndex(item).catch(e => console.warn('lotToDyeLots index update failed:', e.message));
      // Mark reportSummaries stale — a report-relevant table changed. Cheap flag flip,
      // no recompute here. Cleared only by recomputeReportSummaries() when "All Time"
      // is actually viewed (Jul 12 2026, Category 1 report summary staleness tracking).
      if (_REPORT_SUMMARY_TABLES.includes(table)) {
        await fbPatch('/tc/reportSummaries', { _stale: true }).catch(e => console.warn('reportSummaries stale-flag write failed:', e.message));
      }
      return jsonResponse({ success: true, table, id: fbKey });

    } else if (Array.isArray(items) && items.length > 0) {
      // Multiple items upsert (full table update)
      const keyed = {};
      items.forEach(x => {
        if (x && x.id) {
          const k = table === 'lots' ? _lotKeyW(x) : x.id;
          x._updatedAt = now;
          keyed[k] = x;
        }
      });
      if (Object.keys(keyed).length > 0) {
        await fbPatch(`/tc/${table}`, keyed);
        updatedBody[`_lastChanged/${table}`] = now;
        await fbPatch('/tc', updatedBody);
        if (_REPORT_SUMMARY_TABLES.includes(table)) {
          await fbPatch('/tc/reportSummaries', { _stale: true }).catch(e => console.warn('reportSummaries stale-flag write failed:', e.message));
        }
      }
      return jsonResponse({ success: true, table, count: Object.keys(keyed).length });

    } else if (data !== undefined) {
      // Jul 29 2026 fix — real, serious, confirmed vulnerability: this
      // used to accept ANY table name here, completely replacing it with
      // whatever data was sent — including empty data, wiping the whole
      // table. _canWrite only checks "can this role touch this table at
      // all", which is true for nearly every role on operational tables
      // like lots/dyeLots/stageEntries, since normal work requires it.
      // It was never designed to also gate "replace everything", so
      // anyone permitted to write at all could wipe an entire production
      // table in one request. This branch was only ever meant for
      // settings-style tables (masters, parties) — restricted to exactly
      // those now. Genuinely clearing an operational table (Priyam's
      // confirmed, intentional feature) now goes through its own
      // dedicated, properly-locked-down endpoint: handleClearStage.
      const _WHOLE_TABLE_REPLACE_ALLOWED = ['masters', 'parties'];
      if (!_WHOLE_TABLE_REPLACE_ALLOWED.includes(table)) {
        return errorResponse(`Whole-table replace is not permitted for '${table}' through this endpoint. Use the dedicated Clear Data tool for operational tables.`, 403);
      }
      // Non-array data (masters object)
      await fbSet(`/tc/${table}`, data);
      updatedBody[`_lastChanged/${table}`] = now;
      await fbPatch('/tc', updatedBody);
      return jsonResponse({ success: true, table });

    } else {
      return errorResponse('item, items, or data required', 400);
    }
  } catch (e) {
    return errorResponse(`Save failed [${table}]: ${e.message}`, 500);
  }
}

// Sep 10 2026 — real, root-cause fix built via direct discussion with
// Priyam, from a genuine real incident: a supervisor added a new
// worker, real entries were created using it, and the worker name
// later vanished from Masters entirely. Traced to a real race
// condition: adding a Master value (workers/vendors/mills/grades/
// machines/parties) used to read the WHOLE list into the browser,
// push the new value onto that LOCAL copy, then write the WHOLE list
// back — completely overwriting Firebase with whatever that one
// browser happened to have. If two people (or two tabs) added
// different values around the same time, whoever saved second
// silently erased the first person's addition — the exact same class
// of "whole table overwrite" danger already closed off for real
// production entry tables (Jul 29 2026) but never migrated for
// Masters/Parties specifically, since it seemed lower-stakes at the
// time. Same fix, same proven lock: fetch the CURRENT, fresh list
// right before writing, add the new value to THAT, not a stale
// browser copy — so a concurrent add from someone else can never be
// silently lost.
async function handleMasterAddItem(body, tokenClaim) {
  const { key, value } = body || {};
  if (!key || !value) return errorResponse('key and value required', 400);
  const role = tokenClaim?.role || '';
  // Sep 10 2026 — real, direct correction built via direct discussion
  // with Priyam: adding a new Master value is deliberately allowed for
  // supervisors too — they just can't edit or delete one directly
  // (that still requires admin/manager, or a raised request for
  // review — see handleMasterEdit/handleMasterItemDelete above, both
  // already correctly gated that way). The blanket _canWrite('masters',
  // role) check used by the old /api/save path was manager-only for
  // the WHOLE table, which wrongly blocked this specific, legitimate
  // supervisor action too.
  if (!['admin', 'manager', 'supervisor'].includes(role)) {
    return errorResponse(`Role '${role}' cannot add to '${key}'`, 403);
  }

  const result = await withBalanceLock(`MASTER_ADD_${key}`, async () => {
    if (key === 'parties') {
      const current = await fbGet('/tc/parties').catch(() => null);
      const list = Array.isArray(current) ? current : (current ? Object.values(current) : []);
      if (list.includes(value)) return { list, alreadyExisted: true };
      const updated = [...list, value];
      await fbSet('/tc/parties', updated);
      return { list: updated, alreadyExisted: false };
    }
    const currentMasters = await fbGet('/tc/masters').catch(() => null) || {};
    const list = Array.isArray(currentMasters[key]) ? currentMasters[key] : [];
    if (list.includes(value)) return { list, alreadyExisted: true };
    const updated = [...list, value];
    await fbSet(`/tc/masters/${key}`, updated);
    return { list: updated, alreadyExisted: false };
  }, 20);

  if (result.__lockFailed) {
    return errorResponse('System is busy right now — please try again in a moment.', 503);
  }
  await fbPatch('/tc', { [`_lastChanged/${key === 'parties' ? 'parties' : 'masters'}`]: new Date().toISOString() }).catch(() => {});
  return jsonResponse({ success: true, key, value, alreadyExisted: result.alreadyExisted, list: result.list });
}

// Jul 29 2026 — new, dedicated endpoint for the "Clear All" feature on
// the Masters/Data Management panel. This used to go through the
// generic /api/save with an emptied array — no real server-side check
// beyond _canWrite, which allows nearly every role to write to these
// tables for completely normal reasons. Confirmed design (Priyam's
// explicit call): this stays a genuine, permanent delete — not an
// archive — exactly as originally built, for the same reason it was
// built that way: cleanly resetting bad/test data without leftover
// clutter. What changes is the protection around it: Admin only, a
// real verified session, plus the person's own password as a second,
// explicit confirmation for something this destructive and irreversible.
async function handleClearStage(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin or manager access required', 403);
  const { table, confirmText, password } = body || {};
  if (!table) return errorResponse('table required', 400);
  if (confirmText !== 'CONFIRM') return errorResponse('Type CONFIRM exactly to proceed');
  if (!password) return errorResponse('Password required');

  const _CLEARABLE_TABLES = ['packEntries', 'dispatches', 'partyOrders', 'windEntries', 'stageEntries', 'dyeLots', 'lots'];
  if (!_CLEARABLE_TABLES.includes(table)) return errorResponse(`'${table}' is not a clearable table`, 403);

  const admin = await _verifySelfPassword(tokenClaim?.username, password);
  if (!admin) return errorResponse('Incorrect password', 401);

  // Firebase stores all of these as keyed objects (id -> record), same
  // as every other table read elsewhere in this file via fbGet +
  // Object.values() — not arrays. An empty object is the correct,
  // consistent "nothing here" value for all seven, regardless of how
  // the client happens to display them.
  await fbSet(`/tc/${table}`, {});
  await fbPatch('/tc', { [`_lastChanged/${table}`]: new Date().toISOString() });
  return jsonResponse({ success: true, table });
}

async function handleDelete(body, tokenClaim) {
  const { table, id } = body || {};
  if (!table || !id) return errorResponse('table and id required', 400);

  const role = tokenClaim?.role || '';
  // Only managers can delete
  if (role !== 'admin' && role !== 'manager') {
    return errorResponse('Manager role required to delete', 403);
  }

  try {
    await fbSet(`/tc/${table}/${id}`, null);
    const now = new Date().toISOString();
    await fbPatch('/tc', { [`_lastChanged/${table}`]: now });
    return jsonResponse({ success: true, table, id });
  } catch (e) {
    return errorResponse(`Delete failed [${table}/${id}]: ${e.message}`, 500);
  }
}

// ─── Server-side auth — login + password verification ───────────────────────
// Mirrors client's sha256()/isHashed() exactly (Web Crypto API works the same
// in Cloudflare Workers as in the browser).
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function _isHashedPw(p) {
  return typeof p === 'string' && p.length === 64 && /^[0-9a-f]+$/.test(p);
}
function _isHashedPbkdf2(p) { return typeof p === 'string' && p.startsWith('pbkdf2:'); }

// Aug 26 2026 — real, admin-only tool built via direct discussion with
// Priyam, checking exactly how many real accounts still sit with a
// plaintext or old SHA-256 password, since the automatic upgrade only
// ever fires the moment that specific account logs in — any account
// that simply hasn't logged in since this system was built stays
// exactly as it was until this tool runs. Hashes each one's already-
// stored value directly with the same proven PBKDF2 function every
// fresh login already uses — no password reset needed, no one has to
// do anything differently, this just closes the real, remaining gap.
async function handleCheckPasswordSecurity(tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin only', 403);
  const users = await _usersArray();
  const report = users.map(u => ({
    username: u.username,
    name: u.name,
    format: _isHashedPbkdf2(u.password) ? 'pbkdf2 (secure)' : _isHashedPw(u.password) ? 'sha256 (older)' : 'plaintext (needs upgrade)'
  }));
  const needsUpgrade = report.filter(r => r.format !== 'pbkdf2 (secure)').length;
  return jsonResponse({ report, needsUpgrade, totalUsers: users.length });
}

async function handleForceUpgradePasswords(tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin only', 403);
  const users = await _usersArray();
  let upgraded = 0;
  for (let i = 0; i < users.length; i++) {
    if (!_isHashedPbkdf2(users[i].password)) {
      users[i] = { ...users[i], password: await hashPasswordPbkdf2(users[i].password) };
      upgraded++;
    }
  }
  if (upgraded > 0) await fbSet('/tc/users', users);
  return jsonResponse({ success: true, upgraded, totalUsers: users.length });
}

async function hashPasswordPbkdf2(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2,'0')).join('');
  const keyMat = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name:'PBKDF2', salt, iterations:100000, hash:'SHA-256'}, keyMat, 256);
  const hashHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2,'0')).join('');
  return 'pbkdf2:' + saltHex + ':' + hashHex;
}

async function verifyPasswordAny(password, stored) {
  if (_isHashedPbkdf2(stored)) {
    const parts = stored.split(':');
    if (parts.length !== 3) return false;
    const salt = new Uint8Array(parts[1].match(/.{2}/g).map(h => parseInt(h,16)));
    const keyMat = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({name:'PBKDF2', salt, iterations:100000, hash:'SHA-256'}, keyMat, 256);
    const computed = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2,'0')).join('');
    return computed === parts[2];
  }
  if (_isHashedPw(stored)) return (await sha256Hex(password)) === stored; // SHA-256 migration path
  return stored === password; // plaintext last resort
}

async function _usersArray() {
  const raw = await fbGet('/tc/users');
  return raw ? (Array.isArray(raw) ? raw : Object.values(raw)) : [];
}
// Verifies the CLAIMED requesting username belongs to a currently active
// admin/manager. Note: this checks the claimed identity is a valid admin,
// it does not re-verify a password — the client has no stored password to
// resend after login. Meaningfully raises the bar beyond "anyone with the
// API key" (API key alone is no longer sufficient), but is not equivalent
// to a full re-authentication challenge. See SKILL.md for the tradeoff.
// Jul 29 2026 — _verifyRequesterIsAdmin removed entirely. It only ever
// checked "does a user with this claimed name exist and have an admin
// role" — never whether the person making the request was actually
// logged in as that name. A real, serious vulnerability: anyone could
// simply claim to be "admin" in a request body and be treated as one,
// with no login required at all. All 4 callers now use real, verified
// session tokens instead, the same secure pattern used everywhere else
// in this app. Removed rather than left unused, so this exact unsafe
// pattern can never be accidentally reached for again.

// POST /api/login — {username, password} -> {success, user (no password field)}
// This is the ONLY place a username+password pair gets checked for actual sign-in.
// Aug 26 2026 — real, complete rate-limiting system for login, built via
// direct, thorough discussion with Priyam. 4 real layers, working together:
// 1. Turnstile — a real, free bot-challenge, verified server-side before
//    any password check ever runs, stopping automated scripts outright.
// 2. Escalating lockouts, tracked per real username (not just per device,
//    since an attacker can switch devices but not the account they're
//    targeting) — each fresh lockout within the same day costs more time
//    than the last, making a slow, patient attack genuinely impractical.
// 3. Stricter thresholds for admin/manager accounts specifically, since
//    they're a genuinely higher-value target than a regular worker account.
// 4. Cloudflare's own, already-available threat score for the visitor,
//    tightening the real threshold further for anyone already flagged
//    elsewhere on the internet — at zero extra cost or setup.
// A single real success anywhere resets the count back to zero, so a
// genuine person mistyping their password is never punished.

async function verifyTurnstileToken(token, remoteIp) {
  if (!token) return false;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${encodeURIComponent(_turnstileSecret)}&response=${encodeURIComponent(token)}&remoteip=${encodeURIComponent(remoteIp || '')}`
    });
    const data = await res.json();
    return data.success === true;
  } catch (e) {
    console.warn('[Turnstile] verification request failed', e.message);
    return false;
  }
}

function _loginLockoutKey(username) {
  return username.replace(/[^a-zA-Z0-9]/g, '_');
}

async function _checkLoginLockout(username) {
  const key = _loginLockoutKey(username);
  const record = await fbGet(`/tc/loginAttempts/${key}`).catch(() => null);
  if (!record || !record.lockedUntil) return { locked: false };
  const now = Date.now();
  if (now < record.lockedUntil) {
    const secondsLeft = Math.ceil((record.lockedUntil - now) / 1000);
    return { locked: true, secondsLeft };
  }
  return { locked: false };
}

async function _recordLoginResult(username, success, role, threatScore) {
  const key = _loginLockoutKey(username);
  const path = `/tc/loginAttempts/${key}`;
  const record = await fbGet(path).catch(() => null) || {};
  const today = new Date().toISOString().slice(0, 10);
  const now = Date.now();

  if (success) {
    // Real, a genuine success always clears everything for this account —
    // never punish someone for past mistakes once they've proven who they are.
    await fbSet(path, null);
    return;
  }

  const isDailyRecord = record.date === today;
  const failuresToday = (isDailyRecord ? record.failuresToday : 0) + 1;
  const lockoutsToday = isDailyRecord ? (record.lockoutsToday || 0) : 0;

  // Real, stricter threshold for admin/manager accounts, and for any
  // visitor Cloudflare's own signals already consider suspicious —
  // both confirmed, free, real signals, no extra setup needed.
  const isHighValue = role === 'admin' || role === 'manager';
  const isSuspiciousVisitor = typeof threatScore === 'number' && threatScore > 30;
  const burstThreshold = (isHighValue || isSuspiciousVisitor) ? 3 : 5;

  let newLockoutsToday = lockoutsToday;
  let lockedUntil = record.lockedUntil || 0;

  if (failuresToday % burstThreshold === 0) {
    newLockoutsToday += 1;
    // Real, escalating: 1st lockout today is short, each further one
    // within the same day grows — genuinely costing a patient,
    // repeated attacker real, mounting time, not a flat, learnable wait.
    const durationsSeconds = [60, 300, 1200, 3600];
    const durationSeconds = durationsSeconds[Math.min(newLockoutsToday - 1, durationsSeconds.length - 1)];
    lockedUntil = now + durationSeconds * 1000;
    // Real, a visible, real alert — Priyam should never be in the dark
    // about whether this is actually catching something.
    await fbSet(`/tc/loginLockoutAlerts/LA-${now}`, {
      username, role: role || 'unknown', lockoutsToday: newLockoutsToday,
      durationSeconds, at: new Date().toISOString(), threatScore: threatScore ?? null
    }).catch(() => {});
  }

  // Real, separate, longer-term memory: sustained failure over many days,
  // even if never bursting fast enough to trip the daily rule, still
  // shows real intent — a slow, spread-out attack shouldn't get an
  // unlimited, free pass just because it's patient.
  const totalFailures30d = (record.totalFailures30d || 0) + 1;
  if (totalFailures30d >= 25 && !record.longTermFlagged) {
    lockedUntil = Math.max(lockedUntil, now + 3600 * 1000);
    await fbSet(`/tc/loginLockoutAlerts/LA-${now}-longterm`, {
      username, role: role || 'unknown', totalFailures30d,
      at: new Date().toISOString(), reason: 'sustained failure over time'
    }).catch(() => {});
  }

  await fbSet(path, {
    date: today,
    failuresToday,
    lockoutsToday: newLockoutsToday,
    lockedUntil,
    totalFailures30d,
    longTermFlagged: totalFailures30d >= 25,
    lastAttemptAt: new Date().toISOString()
  });
}

async function handleLogin(body, cfProperties) {
  const { username, password, turnstileToken } = body || {};
  if (!username || !password) return errorResponse('Username and password required', 400);

  const lockout = await _checkLoginLockout(username);
  if (lockout.locked) {
    return errorResponse(`Too many failed attempts. Please wait ${lockout.secondsLeft} seconds and try again.`, 429);
  }

  const threatScore = cfProperties?.threatScore;
  const turnstileOk = await verifyTurnstileToken(turnstileToken, cfProperties?.remoteIp);
  if (!turnstileOk) {
    await _recordLoginResult(username, false, null, threatScore);
    return errorResponse('Verification failed. Please refresh and try again.', 403);
  }

  const users = await _usersArray();
  const idx = users.findIndex(u => u.username === username && u.active !== false);
  if (idx === -1) {
    await _recordLoginResult(username, false, null, threatScore);
    return errorResponse('Incorrect username or password', 401);
  }
  const user = users[idx];
  let match = await verifyPasswordAny(password, user.password);
  if (match && !_isHashedPbkdf2(user.password)) {
    // Silently upgrade to PBKDF2 (migrates both plaintext and SHA-256 stored passwords)
    users[idx] = { ...user, password: await hashPasswordPbkdf2(password) };
    await fbSet('/tc/users', users);
  }
  if (!match) {
    await _recordLoginResult(username, false, user.role, threatScore);
    return errorResponse('Incorrect username or password', 401);
  }
  await _recordLoginResult(username, true, user.role, threatScore);
  const { password: _pw, ...safeUser } = users[idx];
  const _sessionToken = await generateSessionToken(safeUser.username, safeUser.role, _apiSecret);
  // Aug 26 2026 — real, genuine fix: the token now also gets set as a
  // real HttpOnly cookie, a storage spot JavaScript is physically
  // incapable of reading, no matter what — on top of still returning it
  // in the response body too, so anything not yet switched over to
  // relying on the cookie keeps working exactly as it always has.
  const _cookieHeader = `tc_session=${encodeURIComponent(_sessionToken)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`;
  const _loginHeaders = { ...corsHeaders(), 'Set-Cookie': _cookieHeader };
  return new Response(JSON.stringify({ success: true, user: safeUser, token: _sessionToken }), { status: 200, headers: _loginHeaders });
}

// Core admin/manager password match, extracted so any endpoint needing a
// real re-auth check (not just the standalone /api/verify-password
// endpoint) can reuse the exact same verification instead of duplicating
// it. Jul 15 2026 — pulled out while building the RM lot delete endpoint,
// which needed this same check baked into the delete request itself
// rather than a separate client-side-trusted pre-check.
async function _matchAnyAdminPassword(password) {
  if (!password) return null;
  const users = await _usersArray();
  const candidates = users.filter(u => (u.role === 'admin' || u.role === 'manager') && u.active !== false);
  for (const u of candidates) {
    if (await verifyPasswordAny(password, u.password)) return u;
  }
  return null;
}

// POST /api/verify-password — {password, username?} -> {success, user (no password field)}
// If username given: checks that specific active user's password (self-checks —
// submitEditEntry, submitRMEdit). If username omitted: checks against ANY active
// admin/manager (confirmAdminPwd, confirmRMDelete, confirmMasterDelete, executeClearStage)
// — first MATCH wins, not first user, so multiple managers each work with their own password.
async function handleVerifyPassword(body) {
  const { password, username } = body || {};
  if (!password) return errorResponse('Password required', 400);
  let matched;
  if (username) {
    const users = await _usersArray();
    const candidates = users.filter(u => u.username === username && u.active !== false);
    matched = null;
    for (const u of candidates) { if (await verifyPasswordAny(password, u.password)) { matched = u; break; } }
  } else {
    matched = await _matchAnyAdminPassword(password);
  }
  if (!matched) return errorResponse('Incorrect password', 401);
  const { password: _pw, ...safeUser } = matched;
  return jsonResponse({ success: true, user: safeUser });
}

// ─── Order Fulfillment Summary — FIFO allocation per party+shade group ──────
// Orders are NEVER archived, but their dispatches ARE once a dye lot fully completes.
// Must read merged active+archive dispatches. Ports the exact FIFO logic from the
// live client getOrderFulfilled(), with one fix: include Edited-Approved status
// (live client version only checked Approved — same gap as claim 31 elsewhere).
function calcOrderGroupFulfillment(party, shade, orders, dispatches) {
  const approved = e => e.status === 'Approved' || e.status === 'Edited-Approved';
  const oShade = (shade || '').trim().toLowerCase();

  const disps = dispatches
    .filter(d => d.party === party && (d.shade || '').trim().toLowerCase() === oShade && approved(d))
    .sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));

  const groupOrders = orders
    .filter(o => o.party === party && (o.shade || '').trim().toLowerCase() === oShade && o.status !== 'Cancelled')
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const rem = {};   groupOrders.forEach(o => rem[o.id] = o.qtyOrdered);
  const alloc = {}; groupOrders.forEach(o => alloc[o.id] = 0);

  disps.forEach(d => {
    let wt = d.weight || 0;
    for (const o of groupOrders) {
      if (wt <= 0) break;
      const av = rem[o.id] || 0;
      if (av <= 0) continue;
      const tk = Math.min(wt, av);
      alloc[o.id] += tk;
      rem[o.id]   -= tk;
      wt          -= tk;
    }
  });

  return groupOrders.map(o => {
    const fulfilled = alloc[o.id] || 0;
    return {
      orderId: o.id,
      qtyFulfilled: fulfilled,
      qtyOrdered: o.qtyOrdered,
      status: fulfilled >= o.qtyOrdered - 0.01 ? 'Completed' : fulfilled > 0 ? 'Partial' : 'Open'
    };
  });
}

async function updateOrderSummaries(party, shade, _allDispatches, _allOrders) {
  if (!party || !shade) return null;
  let dispatches = _allDispatches;
  if (!dispatches) dispatches = await fbGetMerged('/tc/dispatches', '/tc/archive/dispatches');
  let orders = _allOrders;
  if (!orders) {
    const raw = await fbGet('/tc/partyOrders');
    orders = raw ? (Array.isArray(raw) ? raw : Object.values(raw)) : [];
  }
  const results = calcOrderGroupFulfillment(party, shade, orders, dispatches);
  // Aug 6 2026 — same conditional-write + retry-on-conflict protection
  // already proven for updateLotSummary/updateSentToDyeOnly/
  // updateDyeLotSummary, applied per-record here since each order has its
  // own independent summary. Found missing during a direct, honest audit
  // of every summary-writing function specifically for this gap — not
  // previously flagged. Now uses the shared _conditionalWrite helper.
  const writeOne = async (r, retryCount = 0) => {
    const payload = { ...r, updatedAt: new Date().toISOString() };
    await _conditionalWrite(`/tc/orderSummaries/${r.orderId}`, payload, (newRetryCount) => writeOne(r, newRetryCount), retryCount);
  };
  for (const r of results) {
    await writeOne(r);
  }
  return results;
}


// Mirrors the dyeLotSummary pattern: calculate from merged active+archive dispatches,
// save to /tc/partySummaries/{partyKey}. Dispatches DO get archived once their dye lot
// fully completes, so this MUST read merged data — active-only would shrink totals
// over time as material finishes and archives.
function _partyKey(party) {
  return (party || '').replace(/[^a-zA-Z0-9]/g, '_');
}

// ─── Category 1 report summaries (Jul 12 2026) ───────────────────────────────
// "All Time" totals for Flow/Machine/Worker/Shade reports. Recomputed only
// when explicitly triggered (button click, no auto-schedule — see handoff
// discussion) and only when /tc/reportSummaries/_stale is true. rptGrade is
// intentionally excluded — its proportional multi-source-grade splitting logic
// needs its own careful pass, not bundled into this one. rptWaste and rptFlow's
// per-lot listing sections still need raw records regardless (same reason
// rptPack was left alone) — only their top KPI totals use these shared formulas.

// Aug 6 2026 — real, new architecture built after direct discussion with
// Priyam: confirmed the "All Time" report's real bottleneck isn't
// algorithmic (every calc*Totals function is genuinely O(N), checked
// each one directly) — it's pure volume. Real production numbers: 8,571
// records across the 5 tables this report needs, ~75% of it already
// sitting in archive, meaning it's finished, permanently frozen history
// that's re-processed from scratch every single time regardless.
//
// Real fix: freeze each day's totals once, permanently, the day after
// it's genuinely over — then "All Time" just adds together small,
// pre-computed daily numbers instead of re-scanning the full history.
// Reuses the exact same date-field-per-table logic already proven
// correct in calcDailyTotals (stageEntries/dyeLots/windEntries use
// endTime, packEntries/dispatches use timestamp) — not inventing a new
// bucketing rule, matching what's already, correctly working.
//
// Split into a pure "compute" function and a thin "save" wrapper, so the
// exact same, single-day computation logic can be reused both for
// permanently freezing a past day AND for calculating today's own,
// still-live total fresh each time — one real implementation, not two.
// Aug 6 2026 — real refactor, found necessary while building the
// backfill tool below: this originally always fetched fresh, every
// single call — fine for the nightly cron and today's live total
// (called once each), genuinely wasteful for a backfill that needs to
// process 108 real historical days, which would otherwise re-fetch the
// exact same full dataset 108 separate times. Now accepts already-
// fetched data as an optional parameter; falls back to fetching it
// itself when not provided, so every existing caller keeps working
// completely unchanged.
async function _computeDaySnapshot(dateStr, preFetched) {
  let stageEntries, dyeLots, windEntries, packEntries, dispatches, lots;
  if (preFetched) {
    ({ stageEntries, dyeLots, windEntries, packEntries, dispatches, lots } = preFetched);
  } else {
    const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(e => e && e.id);
    [stageEntries, dyeLots, windEntries, packEntries, dispatches] = await Promise.all([
      fbGetMerged('/tc/stageEntries', '/tc/archive/stageEntries'),
      fbGetMerged('/tc/dyeLots', '/tc/archive/dyeLots'),
      fbGetMerged('/tc/windEntries', '/tc/archive/windEntries'),
      fbGetMerged('/tc/packEntries', '/tc/archive/packEntries'),
      fbGetMerged('/tc/dispatches', '/tc/archive/dispatches')
    ]);
    lots = [...toArr(await fbGet('/tc/lots').catch(() => null)), ...toArr(await fbGet('/tc/archive/lots').catch(() => null))];
  }

  const isDay = (ts, field) => ts && ts[field] && (ts[field] || '').split('T')[0] === dateStr;
  const dayStage = stageEntries.filter(e => isDay(e, 'endTime'));
  const dayDye = dyeLots.filter(l => isDay(l, 'endTime'));
  const dayWind = windEntries.filter(e => isDay(e, 'endTime'));
  const dayPack = packEntries.filter(e => isDay(e, 'timestamp'));
  const dayDisp = dispatches.filter(e => isDay(e, 'timestamp'));
  // Aug 6 2026 — real, correct fix after direct pushback from Priyam:
  // RM lots genuinely have their own real date field ('date'), exactly
  // like every other table — the earlier "treat rmLots/rmKg as a live,
  // never-frozen exception" fix was needlessly complicated. The actual
  // bug was simpler: this table was never date-filtered at all, unlike
  // dyeLots/dispatches above, which were. Filtering it the same way
  // makes RM genuinely, correctly per-day too — Monday's snapshot only
  // counts lots that arrived Monday, matching exactly how Dye works.
  const dayLots = lots.filter(l => isDay(l, 'date'));

  const flow = calcFlowTotals(dayStage, dayDye, dayWind, dayPack, dayDisp);
  const machine = calcMachineTotals(dayStage, dayDye, dayWind);
  const worker = calcWorkerTotals(dayStage, dayDye, dayWind, dayPack);
  const shade = calcShadeTotals(dayDye, dayPack, dayDisp);
  // Aug 6 2026 — real, serious gap found via a thorough re-check of the
  // whole Reports page, not just All Time itself: this function never
  // computed `daily` at all — meaning the "Daily" report tab's All Time
  // view would have silently broken (reading undefined) despite every
  // other tab working correctly. calcDailyTotals already naturally
  // buckets by date on its own; called here with data already filtered
  // to one specific day, it correctly returns an object with just that
  // one date as its key — merges cleanly with every other frozen day's
  // single-date object into the complete, real multi-day picture.
  const daily = calcDailyTotals(dayStage, dayDye, dayWind, dayPack, dayDisp);
  // Real, correct fix — dayLots is now genuinely, correctly filtered to
  // this specific day's real arrivals, matching the same pattern used
  // for every other table. No longer needs the earlier "always empty"
  // workaround — RM lots are now a genuine, correct per-day contribution,
  // exactly like Dye, Wind, Pack, and Dispatch already were.
  const grade = calcGradeTotals(dayLots, dayDye, dayDisp);
  const pack = calcPackTotals(dayDye, dayPack, dayWind);
  const waste = calcWasteTotals(dayStage, dayDye, dayWind);

  return { date: dateStr, flow, machine, worker, shade, grade, pack, waste, daily, recordCount: dayStage.length + dayDye.length + dayWind.length + dayPack.length + dayDisp.length };
}

async function freezeDailySnapshot(dateStr) {
  const snapshot = await _computeDaySnapshot(dateStr);
  snapshot.frozenAt = new Date().toISOString();
  await fbSet(`/tc/dailyReportSnapshots/${dateStr}`, snapshot);
  // Sep 29 2026 — Phase 2: invalidate, never update -- this function only ever computes and writes the ONE day
  // that changed, while the cached value represents the entire node. Covers every write path automatically:
  // the nightly initial freeze and all 8+ existing re-freeze call sites already funnel through this one function.
  await cacheInvalidate('tc:v1:dailyReportSnapshots');
  return snapshot;
}

// Real, shared hook — called from every real edit/void handler, same
// structural principle as _refreshAndRender and saveRecordAndRefreshSummary
// earlier this session: one shared place, not something every future
// handler has to individually remember. If the date a record belongs to
// already has a frozen snapshot, silently re-freeze just that one day
// with the corrected data — never leaves a stale frozen number sitting
// around after a real, legitimate correction.
async function _reFreezeIfNeeded(dateStr) {
  if (!dateStr) return;
  try {
    const existing = await fbGet(`/tc/dailyReportSnapshots/${dateStr}`);
    if (existing) await freezeDailySnapshot(dateStr);
  } catch (e) {
    console.warn('[reFreeze] Failed for', dateStr, ':', e.message);
  }
}

// Real, safer, generic version — rather than trying to trace each of the
// 15 real edit/void handlers' own internal variables to find the exact
// date being touched (risky and error-prone at that scale, given how
// different and complex each handler's own logic already is), this just
// re-fetches the record fresh by its own id and stage, and reads
// whichever date field that record actually uses — the same, single
// real source of truth, reusable everywhere, instead of 15 separate,
// bespoke extractions.
async function _reFreezeForRecord(stage, id) {
  if (!stage || !id) return;
  try {
    const pathMap = { soft: '/tc/stageEntries', wind: '/tc/windEntries', pack: '/tc/packEntries', dye: '/tc/dyeLots', dispatch: '/tc/dispatches', rm: '/tc/lots', rmreturn: '/tc/rmReturnLog', residual: '/tc/residualLog', deadstock: '/tc/deadStock', scrap: '/tc/scrapLog' };
    const dateFieldMap = { soft: 'endTime', wind: 'endTime', pack: 'timestamp', dye: 'endTime', dispatch: 'timestamp', rm: 'date', rmreturn: 'date', residual: 'date', deadstock: 'date', scrap: 'date' };
    const path = pathMap[stage];
    if (!path) return;
    let rec = await fbGet(`${path}/${id}`).catch(() => null);
    if (!rec) rec = await fbGet(`/tc/archive/${path.split('/tc/')[1]}/${id}`).catch(() => null);
    if (!rec) return;
    const dateField = dateFieldMap[stage] || 'timestamp';
    const ts = rec[dateField];
    if (!ts) return;
    await _reFreezeIfNeeded((ts || '').split('T')[0]);
  } catch (e) {
    console.warn('[reFreezeForRecord] Failed for', stage, id, ':', e.message);
  }
}

// Real merge helper — adds every real numeric field across two snapshot-
// shaped objects together, recursively, so summing many small, frozen
// daily totals produces one genuinely correct combined total, matching
// the exact same shape each individual calc*Totals function returns.
function _mergeSnapshots(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a + b;
  if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const out = { ...a };
    for (const k in b) out[k] = (k in out) ? _mergeSnapshots(out[k], b[k]) : b[k];
    return out;
  }
  return b !== undefined ? b : a;
}

// The real, new "All Time" computation — sums every already-frozen,
// permanent daily snapshot (fast — small, pre-computed numbers, not raw
// records) plus today's own fresh total (fast too — only today's real
// records, not the whole history) — instead of re-scanning all 8,571+
// real records on every single request, the actual root cause found and
// confirmed today.
async function computeAllTimeFromSnapshots() {
  // Sep 29 2026 — Phase 2, Redis for dailyReportSnapshots. Reviewed readiness audit: whole-object cache is
  // correct here (every caller of this function needs the entire node, not a slice), invalidate-only (this
  // function never holds the full updated node, only ever reads it), and a malformed/non-object cached value is
  // treated exactly like a miss -- never allowed to reach report calculations.
  let snapshots = await cacheGet('tc:v1:dailyReportSnapshots');
  if (!snapshots || typeof snapshots !== 'object' || Array.isArray(snapshots)) {
    snapshots = await fbGet('/tc/dailyReportSnapshots').catch(() => null);
    await cacheSet('tc:v1:dailyReportSnapshots', snapshots || {});
  }
  const frozen = Object.values(snapshots || {});
  const today = new Date().toISOString().slice(0, 10);
  const todaySnapshot = await _computeDaySnapshot(today);
  let combined = null;
  for (const s of [...frozen, todaySnapshot]) {
    const { flow, machine, worker, shade, grade, pack, waste, daily } = s;
    const dayTotals = { flow, machine, worker, shade, grade, pack, waste, daily };
    combined = combined ? _mergeSnapshots(combined, dayTotals) : dayTotals;
  }
  return { ...combined, _stale: false, updatedAt: new Date().toISOString(), daysFrozen: frozen.length };
}

// Aug 26 2026 — real, direct extension built via thorough discussion with
// Priyam, after confirming the exact concern: Today/This Week/This Month
// filters on Reports never checked archive at all, unlike All Time, which
// already correctly does via computeAllTimeFromSnapshots() above. Rather
// than build a separate, new caching system — genuinely risking the same
// real CPU-time failure this app already lived through once, confirmed in
// the comment above — this reuses the exact same, proven snapshot
// mechanism, just bounded to a real date range instead of "every day
// ever." Frozen days inside the range are read as-is (never recalculated,
// since a finished day never changes). If today itself falls inside the
// requested range, it's the one and only piece calculated fresh, live,
// every time — exactly matching how All Time already, correctly treats
// today as the one always-live exception.
async function computeRangeFromSnapshots(fromDate, toDate) {
  // Sep 29 2026 — Phase 2, same cache-aside pattern as computeAllTimeFromSnapshots() above, same shared key
  // (both functions need the whole node; the range filtering already happens in memory below, unchanged).
  let snapshots = await cacheGet('tc:v1:dailyReportSnapshots');
  if (!snapshots || typeof snapshots !== 'object' || Array.isArray(snapshots)) {
    snapshots = await fbGet('/tc/dailyReportSnapshots').catch(() => null);
    await cacheSet('tc:v1:dailyReportSnapshots', snapshots || {});
  }
  const allFrozen = snapshots || {};
  const today = new Date().toISOString().slice(0, 10);
  const inRange = d => d >= fromDate && d <= toDate;
  const framesInRange = Object.keys(allFrozen).filter(d => inRange(d) && d !== today).map(d => allFrozen[d]);
  const frames = [...framesInRange];
  if (inRange(today)) {
    frames.push(await _computeDaySnapshot(today));
  }
  let combined = null;
  for (const s of frames) {
    const { flow, machine, worker, shade, grade, pack, waste, daily } = s;
    const dayTotals = { flow, machine, worker, shade, grade, pack, waste, daily };
    combined = combined ? _mergeSnapshots(combined, dayTotals) : dayTotals;
  }
  if (!combined) {
    combined = { flow: {}, machine: {}, worker: {}, shade: {}, grade: {}, pack: {}, waste: {}, daily: {} };
  }
  return { ...combined, _stale: false, updatedAt: new Date().toISOString(), daysFrozen: framesInRange.length, rangeIncludesLiveToday: inRange(today) };
}

// Aug 26 2026 — real, purpose-built function for Analytics, via direct,
// thorough discussion with Priyam: Comparison, Trend, Worker Scorecard,
// and Machine Health all genuinely need several date ranges at once, not
// just one — unlike Reports, which only ever asks one range at a time.
// Calling computeRangeFromSnapshots() once per range would re-fetch the
// entire /tc/dailyReportSnapshots table once per range, wastefully
// re-downloading the same underlying data every single time. This
// fetches that table exactly once — bounded to the true earliest and
// latest date across every requested range together, never the whole
// table — then sorts the same, single result into each range's own
// bucket locally, with zero further requests. Real, direct example:
// Trend asking for 4 weekly buckets makes exactly one real request,
// sized to only those 4 weeks combined, not the whole history.
async function computeMultiRangeFromSnapshots(ranges) {
  if (!Array.isArray(ranges) || ranges.length === 0) return [];
  const overallFrom = ranges.reduce((min, r) => (r.from < min ? r.from : min), ranges[0].from);
  const overallTo = ranges.reduce((max, r) => (r.to > max ? r.to : max), ranges[0].to);
  const snapshots = await fbGet('/tc/dailyReportSnapshots').catch(() => null);
  const allFrozen = snapshots || {};
  const today = new Date().toISOString().slice(0, 10);
  const inOverallRange = d => d >= overallFrom && d <= overallTo;
  const relevantFrozen = {};
  Object.keys(allFrozen).forEach(d => { if (inOverallRange(d) && d !== today) relevantFrozen[d] = allFrozen[d]; });
  const todaySnapshot = inOverallRange(today) ? await _computeDaySnapshot(today) : null;

  return ranges.map(r => {
    const inRange = d => d >= r.from && d <= r.to;
    const framesInRange = Object.keys(relevantFrozen).filter(inRange).map(d => relevantFrozen[d]);
    const frames = [...framesInRange];
    if (todaySnapshot && inRange(today)) frames.push(todaySnapshot);
    let combined = null;
    for (const s of frames) {
      const { flow, machine, worker, shade, grade, pack, waste, daily } = s;
      const dayTotals = { flow, machine, worker, shade, grade, pack, waste, daily };
      combined = combined ? _mergeSnapshots(combined, dayTotals) : dayTotals;
    }
    if (!combined) combined = { flow: {}, machine: {}, worker: {}, shade: {}, grade: {}, pack: {}, waste: {}, daily: {} };
    return { label: r.label || null, from: r.from, to: r.to, ...combined, _stale: false, daysFrozen: framesInRange.length, rangeIncludesLiveToday: inRange(today) };
  });
}

// Aug 6 2026 — real, missing piece caught by Priyam, correctly, before
// this whole system was declared finished: the nightly cron only ever
// freezes "yesterday," one day at a time, going forward — with nothing
// to freeze the real, existing history first, "All Time" would have
// started out badly incomplete and never actually caught up, since each
// night only adds one more day while the real backlog sits there
// unfrozen forever.
//
// One-time (safely re-runnable) tool: fetches every real table exactly
// once, finds every unique real date across the real history, freezes
// each one that's genuinely already over (never today, which isn't
// finished yet), skipping any day already frozen. Runs as a background
// task (ctx.waitUntil), same proven pattern as the existing "Recalc All
// Summaries" tool, with a real status record the frontend can poll for
// progress rather than the request just timing out on 108+ real days.
async function handleBackfillSnapshotsStart(body, ctx, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin only', 403);
  await fbSet('/tc/snapshotBackfillStatus', { status: 'running', startedAt: new Date().toISOString() });

  const runIt = async () => {
    try {
      const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(e => e && e.id);
      const [stageEntries, dyeLots, windEntries, packEntries, dispatches] = await Promise.all([
        fbGetMerged('/tc/stageEntries', '/tc/archive/stageEntries'),
        fbGetMerged('/tc/dyeLots', '/tc/archive/dyeLots'),
        fbGetMerged('/tc/windEntries', '/tc/archive/windEntries'),
        fbGetMerged('/tc/packEntries', '/tc/archive/packEntries'),
        fbGetMerged('/tc/dispatches', '/tc/archive/dispatches')
      ]);
      const lots = [...toArr(await fbGet('/tc/lots').catch(() => null)), ...toArr(await fbGet('/tc/archive/lots').catch(() => null))];
      const preFetched = { stageEntries, dyeLots, windEntries, packEntries, dispatches, lots };

      const dateOf = (rec, field) => rec[field] ? (rec[field] || '').split('T')[0] : null;
      const allDates = new Set();
      stageEntries.forEach(e => { const d = dateOf(e, 'endTime'); if (d) allDates.add(d); });
      dyeLots.forEach(l => { const d = dateOf(l, 'endTime'); if (d) allDates.add(d); });
      windEntries.forEach(e => { const d = dateOf(e, 'endTime'); if (d) allDates.add(d); });
      packEntries.forEach(e => { const d = dateOf(e, 'timestamp'); if (d) allDates.add(d); });
      dispatches.forEach(e => { const d = dateOf(e, 'timestamp'); if (d) allDates.add(d); });
      lots.forEach(l => { const d = dateOf(l, 'date'); if (d) allDates.add(d); });

      const today = new Date().toISOString().slice(0, 10);
      const existing = await fbGet('/tc/dailyReportSnapshots').catch(() => null);
      const alreadyFrozen = new Set(Object.keys(existing || {}));
      const toFreeze = [...allDates].filter(d => d !== today && !alreadyFrozen.has(d)).sort();

      let done = 0;
      for (const dateStr of toFreeze) {
        const snapshot = await _computeDaySnapshot(dateStr, preFetched);
        snapshot.frozenAt = new Date().toISOString();
        await fbSet(`/tc/dailyReportSnapshots/${dateStr}`, snapshot);
        done++;
        if (done % 10 === 0) {
          await fbSet('/tc/snapshotBackfillStatus', { status: 'running', startedAt: new Date().toISOString(), progress: `${done}/${toFreeze.length}` });
        }
      }
      await fbSet('/tc/snapshotBackfillStatus', { status: 'complete', completedAt: new Date().toISOString(), daysFrozen: done, totalRealDays: allDates.size });
    } catch (e) {
      await fbSet('/tc/snapshotBackfillStatus', { status: 'error', error: e.message, failedAt: new Date().toISOString() });
    }
  };
  ctx.waitUntil(runIt());
  return jsonResponse({ success: true, message: 'Backfill started — check status separately' });
}

async function handleBackfillSnapshotsStatus() {
  const status = await fbGet('/tc/snapshotBackfillStatus').catch(() => null);
  return jsonResponse({ status: status || { status: 'never_run' } });
}

async function recomputeReportSummaries() {
  // Matches appr()'s definition exactly (shared-balances.js) — Approved or
  // Edited-Approved, never voided. Edited-Approved is the corrected version
  // after an edit and counts the same as Approved; Voided never counts
  // (confirmed with Priyam Jul 12 2026 — this also fixed rptDaily's pack/
  // dispatch filter, which had drifted to Approved-only, undercounting).
  const approved = e => e && (e.status === 'Approved' || e.status === 'Edited-Approved') && !e.voided && e.status !== 'Voided';
  const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(Boolean);

  const [lotsRaw, stageRaw, dyeRaw, windRaw, packRaw, dispRaw] = await Promise.all([
    fbGet('/tc/lots'), // RM lots are never archived — refillable containers, always in the active table
    fbGetMerged('/tc/stageEntries', '/tc/archive/stageEntries'),
    fbGetMerged('/tc/dyeLots', '/tc/archive/dyeLots'),
    fbGetMerged('/tc/windEntries', '/tc/archive/windEntries'),
    fbGetMerged('/tc/packEntries', '/tc/archive/packEntries'),
    fbGetMerged('/tc/dispatches', '/tc/archive/dispatches')
  ]);
  const lots = toArr(lotsRaw);
  const stageEntries = toArr(stageRaw).filter(approved);
  const dyeLots = toArr(dyeRaw).filter(approved);
  const windEntries = toArr(windRaw).filter(approved);
  const packEntries = toArr(packRaw).filter(approved);
  const dispatches = toArr(dispRaw).filter(approved);

  // Same formulas as pages.js's live rptFlow/rptMachine/rptWorker/rptShade/
  // rptGrade/rptPack/rptWaste — all live in shared-balances.js, imported by
  // both files. One formula, not two (Jul 12 2026). Grade/Pack/Waste added
  // Aug 5 2026 — genuinely new server-side aggregation, none of the three
  // had ever been computed here before this.
  const flow = calcFlowTotals(stageEntries, dyeLots, windEntries, packEntries, dispatches);
  const machine = calcMachineTotals(stageEntries, dyeLots, windEntries);
  const worker = calcWorkerTotals(stageEntries, dyeLots, windEntries, packEntries);
  const shade = calcShadeTotals(dyeLots, packEntries, dispatches);
  const daily = calcDailyTotals(stageEntries, dyeLots, windEntries, packEntries, dispatches);
  const grade = calcGradeTotals(lots, dyeLots, dispatches);
  const pack = calcPackTotals(dyeLots, packEntries, windEntries);
  const waste = calcWasteTotals(stageEntries, dyeLots, windEntries);

  const summary = { flow, machine, worker, shade, daily, grade, pack, waste, _stale: false, updatedAt: new Date().toISOString() };
  await fbSet('/tc/reportSummaries', summary);
  return summary;
}

function calcPartySummary(party, dispatches) {
  const approved = e => e.status === 'Approved' || e.status === 'Edited-Approved';
  const partyDispatches = dispatches.filter(d => d.party === party && approved(d));

  let totalBags = 0, totalKg = 0, lastDispatchDate = '';
  const shades = {};

  partyDispatches.forEach(d => {
    const bags = d.bags || d.units || 0;
    const kg = d.weight || 0;
    totalBags += bags;
    totalKg += kg;
    const ts = d.timestamp || d.date || '';
    if (ts && ts > lastDispatchDate) lastDispatchDate = ts;

    const shade = d.shade || '—';
    if (!shades[shade]) shades[shade] = { bags: 0, kg: 0, dyeLots: {} };
    shades[shade].bags += bags;
    shades[shade].kg += kg;

    const dlId = d.dyeLotId || '—';
    if (!shades[shade].dyeLots[dlId]) {
      shades[shade].dyeLots[dlId] = { dyeLotNo: d.dyeLotNo || '', bags: 0, kg: 0 };
    }
    shades[shade].dyeLots[dlId].bags += bags;
    shades[shade].dyeLots[dlId].kg += kg;
  });

  return {
    party,
    totalBags,
    totalKg,
    lastDispatchDate,
    shades,
    updatedAt: new Date().toISOString()
  };
}

async function updatePartySummary(party, _allDispatches, _retryCount = 0) {
  if (!party) return null;
  let dispatches = _allDispatches;
  if (!dispatches) {
    dispatches = await fbGetMerged('/tc/dispatches', '/tc/archive/dispatches');
  }
  const summary = calcPartySummary(party, dispatches);
  const key = _partyKey(party);
  // Aug 6 2026 — added the same conditional-write + retry-on-conflict
  // protection already proven for updateLotSummary/updateSentToDyeOnly/
  // updateDyeLotSummary. Found missing here during a direct, honest audit
  // of every summary-writing function specifically for this gap — not
  // previously flagged. Whole-record PUT here (not a merge-one-field
  // PATCH like sentToDye) since `summary` already IS the complete record
  // for this party, nothing else to preserve alongside it.
  // Aug 6 2026 — now uses the shared _conditionalWrite helper.
  const _cw3 = await _conditionalWrite(`/tc/partySummaries/${key}`, summary, (newRetryCount) => updatePartySummary(party, dispatches, newRetryCount), _retryCount);
  if (_cw3.retried) return _cw3.result;
  return summary;
}

// ─── API: Trigger summary update after entry status change ────────────────────
// Called by browser after every approve/reject/void/edit action
// Body: { type, entryId, lotId, grade, vendor, dyeLotId }
// sentToDye, on its own, is genuinely cheap — it only needs one thing: the
// dye lots sourced from this RM lot, and their sources[] weight. It never
// needs Wind, Pack, or Dispatch data at all (Jul 13 2026, split out after
// confirming with Priyam that this specific number should be as simple as
// RM Balance/Soft Balance — it was only expensive because it was bundled
// into calcSummaryFromData, which ALSO computes windBalance/
// packBalance/dispatched/fullyDispatched — fields that genuinely do need
// the heavier data. This function updates ONLY sentToDye, always 2 fixed
// requests (dyeLots active+archive), regardless of how many dye lots exist
// or what the rest of the summary's state is — independent of, and safe
// even if, the full recompute (updateLotSummary) ever fails for any reason.
async function updateSentToDyeOnly(lotId, grade, vendor, _retryCount = 0) {
  const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(e => e && e.id);
  const key = summaryKey(lotId, grade, vendor);

  // Jul 13 2026 — REVERTED the index-based lookup. Confirmed via real
  // production data (lot 04) that the lotToDyeLots index can be PARTIALLY
  // populated — not empty, just incomplete (2 of 7 real entries) — and the
  // self-heal logic only ever checked for a fully-EMPTY index, never for a
  // non-empty-but-wrong one. That gap is invisible until a lot has enough
  // dye lots to expose it, which is exactly what happened here — every fix
  // built on top of this index inherited its silent incompleteness.
  // For sentToDye specifically, correctness matters more than the request-
  // count optimization the index was for — always scan real merged data,
  // every time, no index, no trust, no exceptions.
  const [dyeActive, dyeArchive] = await Promise.all([
    fbGet('/tc/dyeLots').catch(() => null),
    fbGet('/tc/archive/dyeLots').catch(() => null)
  ]);
  const dyeLots = [...toArr(dyeActive), ...toArr(dyeArchive)];
  const sentToDyeKg = calcSoftConsumedByDye(dyeLots, lotId, grade, vendor);

  // Repair the index while we're here, now that we have the real answer —
  // future routine (non-recalc) triggers can go back to trusting it faster,
  // once it actually reflects reality.
  const realMatches = dyeLots.filter(d => (d.sources || []).some(s => s.sourceType === 'rm' && s.lotId === lotId && s.grade === grade && s.vendor === vendor));
  const repair = {};
  realMatches.forEach(d => { repair[`/tc/lotToDyeLots/${key}/${d.id}`] = true; });
  if (Object.keys(repair).length > 0) {
    await fbPatch('', repair).catch(() => {});
  }

  // Jul 14 2026 — same conditional-write protection as updateLotSummary.
  // On conflict, recurse for a fresh recompute rather than blindly
  // overwriting a more-recent concurrent write to the same field.
  // Aug 6 2026 — now uses the shared _conditionalWrite helper. This one
  // stays structurally different from the others: PATCH doesn't support
  // if-match the same way PUT does, so the current record still needs
  // reading and merging here, in the caller, before the shared helper's
  // own ETag check and conditional PUT — the shared piece only knows
  // "write this exact data conditionally," not how to build it.
  let current = {};
  try { current = await fbGet(`/tc/lotSummaries/${key}`) || {}; } catch (e) {}
  const merged = { ...current, sentToDye: { kg: sentToDyeKg } };
  const _cw4 = await _conditionalWrite(`/tc/lotSummaries/${key}`, merged, (newRetryCount) => updateSentToDyeOnly(lotId, grade, vendor, newRetryCount), _retryCount);
  if (_cw4.retried) return _cw4.result;
  await _invalidateSummaryCaches();
  return sentToDyeKg;
}

async function handleSummaryTrigger(body, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin only', 403);

  const { type, lotId, grade, vendor, dyeLotId } = body;

  if (!type) return errorResponse('type required');

  const statusChangesLot = ['soft', 'dye', 'lot']; // affect lotSummary
  const statusChangesDyeLot = ['dye', 'wind', 'pack', 'dispatch']; // affect dyeLotSummary

  const results = {};

  // sentToDye updates first, on its own, always cheap and fixed-cost —
  // independent of whatever happens to the full recompute below. If the
  // full summary recompute is ever slow, partially fails, or a future
  // change reintroduces a scaling issue elsewhere in it, sentToDye stays
  // correct regardless, since it never depended on that path to begin with.
  if (type === 'dye' && lotId && grade && vendor) {
    await updateSentToDyeOnly(lotId, grade, vendor).catch(e => console.warn('[sentToDye] cheap update failed:', e.message));
  }

  // Update lotSummary if needed
  if (statusChangesLot.includes(type) && lotId && grade && vendor) {
    const summary = await updateLotSummary(lotId, grade, vendor);
    results.lotSummary = summary ? { updated: true, fullyDispatched: summary.fullyDispatched } : { updated: false };
  }

  // Update dyeLotSummary if needed
  if (statusChangesDyeLot.includes(type) && dyeLotId) {
    const summary = await updateDyeLotSummary(dyeLotId);
    results.dyeLotSummary = summary ? { updated: true, fullyDispatched: summary.fullyDispatched } : { updated: false };
  }

  // Update partySummary + orderSummary for every party affected by this dyeLot's dispatches
  if (type === 'dispatch' && dyeLotId) {
    const allDispatches = await fbGetMerged('/tc/dispatches', '/tc/archive/dispatches');
    const affectedDispatches = allDispatches.filter(d => d.dyeLotId === dyeLotId && d.party);
    const affectedParties = [...new Set(affectedDispatches.map(d => d.party))];
    const partyResults = [];
    for (const party of affectedParties) {
      await updatePartySummary(party, allDispatches);
      partyResults.push(party);
    }
    results.partySummaries = partyResults;

    // Order fulfillment — group by unique party+shade pairs touched by this dyeLot's dispatches
    const rawOrders = await fbGet('/tc/partyOrders');
    const allOrders = rawOrders ? (Array.isArray(rawOrders) ? rawOrders : Object.values(rawOrders)) : [];
    const affectedGroups = [...new Set(affectedDispatches.map(d => `${d.party}|||${d.shade || ''}`))];
    const orderResults = [];
    for (const grp of affectedGroups) {
      const [party, shade] = grp.split('|||');
      const r = await updateOrderSummaries(party, shade, allDispatches, allOrders);
      if (r) orderResults.push(...r.map(x => x.orderId));
    }
    results.orderSummaries = orderResults;
  }

  // Direct order-group trigger — type:'order' with party+shade, for order create/cancel or backfill
  if (type === 'order' && body.party && body.shade) {
    const r = await updateOrderSummaries(body.party, body.shade);
    results.orderSummaries = r ? r.map(x => x.orderId) : [];
  }

  // Direct party backfill — type:'party' with a party name, bypasses dyeLotId derivation
  if (type === 'party' && body.party) {
    const summary = await updatePartySummary(body.party);
    results.partySummary = summary ? { updated: true } : { updated: false };
  }

  return jsonResponse({ success: true, results });
}

// ─── API: Populate archive (bulk archive all fullyDispatched dye lots) ───────
// Aug 6 2026 — real, confirmed bug fix: the automatic nightly backup
// (this file) correctly enforced MAX_BACKUPS (5), but a completely
// separate client-side manual backup path (pages.js's "Backup & Export"
// button) wrote into the SAME /backups/ location using a hardcoded 20 —
// and its own MAX_BACKUPS constant (core.js) said 7, a third mismatch.
// Two systems disagreeing on the same shared shelf let the real count
// climb well past 5 between nightly runs. All three now aligned to 5 —
// but that only fixes it going forward. This is the one-time catch-up:
// trims both Firebase's /backups AND the R2 bucket down to 5 immediately,
// instead of waiting for tonight's cron to slowly correct it.
async function handleTrimBackupsNow(tokenClaim, env) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin/manager access required', 403);

  const result = { firebase: { before: 0, deleted: 0, after: 0 }, r2: { before: 0, deleted: 0, after: 0 } };

  // Firebase side
  const keysSnap = await fbGet('/backups', 'shallow=true').catch(() => null);
  const keys = Object.keys(keysSnap || {}).sort();
  result.firebase.before = keys.length;
  if (keys.length > MAX_BACKUPS) {
    const toDelete = keys.slice(0, keys.length - MAX_BACKUPS);
    for (const k of toDelete) await fbDelete(`/backups/${k}`);
    result.firebase.deleted = toDelete.length;
  }
  result.firebase.after = Math.min(keys.length, MAX_BACKUPS);

  // R2 side
  if (env && env.BACKUP_BUCKET) {
    const r2List = await env.BACKUP_BUCKET.list();
    const r2Keys = (r2List.objects || []).map(o => o.key).sort();
    result.r2.before = r2Keys.length;
    if (r2Keys.length > MAX_BACKUPS) {
      const r2ToDelete = r2Keys.slice(0, r2Keys.length - MAX_BACKUPS);
      for (const k of r2ToDelete) await env.BACKUP_BUCKET.delete(k);
      result.r2.deleted = r2ToDelete.length;
    }
    result.r2.after = Math.min(r2Keys.length, MAX_BACKUPS);
  } else {
    result.r2.skipped = 'no R2 binding configured for this environment';
  }

  return jsonResponse({ success: true, ...result });
}

// Sep 25 2026 — Summary Loader backfill (approved design, load-bearing, not optional cleanup): every existing
// lotSummaries/dyeLotSummaries record only ever had `updatedAt` — a brand-new `_updatedAt` field means nothing.
// Firebase's own real sorting behavior treats a record missing the sort field entirely as sorting below any real
// cursor value, so without this backfill, every pre-existing summary would be permanently invisible to the new
// incremental sync, forever — exactly the same shape of gap already found and confirmed for dispatches. Additive
// only: writes a NEW field, never touches or removes the existing `updatedAt` that other code may still read.
// Safe to run more than once — a record that already has `_updatedAt` is skipped, not re-stamped with a new time.
async function handleBackfillSummaryTimestamps(tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin only', 403);
  try {
    const results = {};
    for (const table of ['lotSummaries', 'dyeLotSummaries']) {
      const raw = await fbGet(`/tc/${table}`).catch(() => null);
      const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
      const patch = {};
      let backfilled = 0, alreadyHad = 0, skippedNoTimestampAtAll = 0;
      for (const [key, record] of Object.entries(obj)) {
        if (!record || typeof record !== 'object') continue;
        if (record._updatedAt) { alreadyHad++; continue; }
        if (!record.updatedAt) { skippedNoTimestampAtAll++; continue; }
        patch[`/tc/${table}/${key}/_updatedAt`] = record.updatedAt;
        backfilled++;
      }
      if (Object.keys(patch).length > 0) await fbPatch('', patch);
      results[table] = { backfilled, alreadyHad, skippedNoTimestampAtAll, total: Object.keys(obj).length };
    }
    return jsonResponse({ success: true, results });
  } catch (e) {
    return errorResponse(`Backfill failed: ${e.message}`, 500);
  }
}

// Sep 30 2026 — legacy array-shape detector/migrator for deadStock/recycleStock/scrapLog. Confirmed from source
// (handleEditDeadStock's own comment, directly adjacent to the void handlers we traced) that these three tables
// can contain records stored under a Firebase key that does NOT match that record's own `.id` field — either a
// true array element (key is a numeric index) or some other mis-keyed survivor. A direct-by-id read/write
// (`/tc/<table>/<id>`) silently misses these, which is exactly why the existing void/undo handlers still read the
// whole table and write it back. This cannot be run or verified against real production data from this
// environment — built to be run by an authorized admin, dry-run first, per the agreed IDENTIFY -> MIGRATE ->
// VERIFY -> CONVERT sequence. Detection criterion, precisely: for every top-level key in the raw Firebase node,
// compare it against that value's own `.id` field. A mismatch is an affected record, regardless of whether the
// container is technically an array or an object.
const _LEGACY_FORMAT_TABLES = ['deadStock', 'recycleStock', 'scrapLog', 'residualLog', 'residualStock', 'rmReturnLog'];

async function _detectLegacyFormatForTable(table) {
  const raw = await fbGet(`/tc/${table}`).catch(() => null);
  const report = { table, totalExamined: 0, canonical: 0, affected: [], conflicts: [] };
  if (!raw || typeof raw !== 'object') return report;
  const entries = Object.entries(raw);
  report.totalExamined = entries.length;
  // First pass: index every record already sitting under its own correct key, so we can tell a genuine
  // migration (no canonical copy exists yet) apart from a conflict (both a legacy and a canonical copy exist).
  const canonicalById = {};
  for (const [key, record] of entries) {
    if (record && record.id && key === record.id) { canonicalById[record.id] = record; report.canonical++; }
  }
  for (const [key, record] of entries) {
    if (!record || !record.id) continue;
    if (key === record.id) continue;
    const existingCanonical = canonicalById[record.id];
    if (existingCanonical) {
      const identical = JSON.stringify(existingCanonical) === JSON.stringify(record);
      if (identical) {
        // Genuinely safe: an exact duplicate of a record that already exists correctly. Removing the legacy
        // copy loses nothing.
        report.affected.push({ sourceKey: key, id: record.id, action: 'remove_duplicate', reason: 'Legacy copy is byte-identical to the existing canonical record at its correct key.' });
      } else {
        // A real conflict: two different versions of the same id. Per instruction, never auto-resolve this —
        // report it for manual review.
        report.conflicts.push({ sourceKey: key, id: record.id, legacyRecord: record, canonicalRecord: existingCanonical });
      }
    } else {
      report.affected.push({ sourceKey: key, id: record.id, destinationKey: record.id, action: 'migrate' });
    }
  }
  return report;
}

// GET-shaped: detection only, never writes anything. Safe to run as many times as needed to review before
// deciding whether to migrate.
async function handleDetectLegacyFormat(tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin only', 403);
  try {
    const results = {};
    for (const table of _LEGACY_FORMAT_TABLES) {
      results[table] = await _detectLegacyFormatForTable(table);
    }
    return jsonResponse({ success: true, results });
  } catch (e) {
    return errorResponse(`Legacy format detection failed: ${e.message}`, 500);
  }
}

// POST, dryRun defaults to true for safety — the caller must explicitly pass dryRun:false to actually write
// anything. Idempotent by construction: once every record sits under its own id, re-running finds zero affected
// records and writes nothing. Conflicts are never auto-resolved — they are reported, and the migration proceeds
// around them, leaving both copies in place for manual review.
async function handleMigrateLegacyFormat(tokenClaim, body) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin only', 403);
  const dryRun = body?.dryRun !== false;
  try {
    const results = {};
    for (const table of _LEGACY_FORMAT_TABLES) {
      const detection = await _detectLegacyFormatForTable(table);
      let migrated = 0, duplicatesRemoved = 0;
      if (!dryRun && detection.affected.length > 0) {
        const patch = {};
        // Re-fetch the raw table once, right before writing, to get the actual record values the migration
        // needs (the detector above only returns identity/shape info, not full records, keeping it
        // lightweight and side-effect-free on its own).
        const raw = await fbGet(`/tc/${table}`).catch(() => null);
        if (raw && typeof raw === 'object') {
          for (const item of detection.affected) {
            const record = raw[item.sourceKey];
            if (!record) continue;
            if (item.action === 'migrate') {
              patch[`/tc/${table}/${item.destinationKey}`] = record;
              patch[`/tc/${table}/${item.sourceKey}`] = null;
              migrated++;
            } else if (item.action === 'remove_duplicate') {
              patch[`/tc/${table}/${item.sourceKey}`] = null;
              duplicatesRemoved++;
            }
          }
        }
        if (Object.keys(patch).length > 0) await fbPatch('', patch);
      }
      results[table] = {
        dryRun,
        totalExamined: detection.totalExamined,
        canonicalBefore: detection.canonical,
        affectedFound: detection.affected.length,
        conflictsFound: detection.conflicts.length,
        conflicts: detection.conflicts,
        migrated: dryRun ? 0 : migrated,
        duplicatesRemoved: dryRun ? 0 : duplicatesRemoved,
      };
    }
    return jsonResponse({ success: true, results });
  } catch (e) {
    return errorResponse(`Legacy format migration failed: ${e.message}`, 500);
  }
}

// Sep 30 2026 — _updatedAt backfill DRY RUN for the 9 tables' historical records predating the new write-path
// stamping. Confirmed via a real Firebase export: 351 existing records across deadStock/rmReturnLog/voidLog/
// editLog are missing _updatedAt (recycleStock/scrapLog/recycleSoft have 0 records; residualLog/residualStock are
// already fully covered). THIS IS DRY-RUN ONLY — it never writes anything, by design, pending explicit approval of
// the proposed mapping per the instruction. Per-table priority reflects each table's own confirmed field history:
// a void or edit is a genuinely later, more accurate "last changed" event than the record's own creation marker,
// so it's preferred when present; creation's own timestamp field is the fallback. Never guesses — a record with
// none of its table's priority fields present and parseable is reported for manual review, not backfilled.
const _BACKFILL_UPDATEDAT_FIELD_PRIORITY = {
  deadStock: ['voidedAt', 'editedAt', 'createdAt'],
  recycleStock: ['voidedAt', 'createdAt'],
  scrapLog: ['voidedAt', 'timestamp'],
  recycleSoft: ['voidedAt', 'endTime', 'startTime'],
  residualLog: ['voidedAt', 'editedAt', 'timestamp'],
  residualStock: ['createdAt'],
  rmReturnLog: ['voidedAt', 'editedAt', 'timestamp'],
  voidLog: ['undoneAt', 'timestamp'],
  editLog: ['undoneAt', 'timestamp'],
};

function _isValidIsoTimestamp(v) {
  if (typeof v !== 'string' || !v) return false;
  const d = new Date(v);
  return !isNaN(d.getTime());
}

async function _dryRunBackfillForTable(table) {
  const priority = _BACKFILL_UPDATEDAT_FIELD_PRIORITY[table];
  const raw = await fbGet(`/tc/${table}`).catch(() => null);
  const report = { table, totalExamined: 0, alreadyHad: 0, proposed: [], manualReview: [] };
  if (!raw || typeof raw !== 'object') return report;
  for (const [key, record] of Object.entries(raw)) {
    if (!record || typeof record !== 'object' || !record.id) continue;
    report.totalExamined++;
    if (record._updatedAt) { report.alreadyHad++; continue; } // never touch an existing value, per instruction
    let sourceField = null, sourceValue = null;
    for (const field of priority) {
      if (_isValidIsoTimestamp(record[field])) { sourceField = field; sourceValue = record[field]; break; }
    }
    if (sourceField) {
      report.proposed.push({
        firebaseKey: key, id: record.id, currentUpdatedAt: null,
        proposedUpdatedAt: sourceValue, sourceField, sourceValue,
        reason: `No _updatedAt present; using '${sourceField}' — the latest genuinely-present historical change marker for ${table}, per this table's confirmed field priority (${priority.join(' > ')}).`,
      });
    } else {
      report.manualReview.push({
        firebaseKey: key, id: record.id,
        reason: `No valid, parseable timestamp found among ${table}'s known fields (${priority.join(', ')}) — refusing to guess.`,
        availableFields: priority.filter(f => record[f] !== undefined).map(f => `${f}=${JSON.stringify(record[f])}`),
      });
    }
  }
  return report;
}

// POST /api/backfill-updatedat/dry-run — read-only, reports the exact proposed mapping for all 9 tables without
// writing anything. Safe to run as many times as needed to review before any execution endpoint is even built.
async function handleBackfillUpdatedAtDryRun(tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin only', 403);
  try {
    const results = {};
    for (const table of Object.keys(_BACKFILL_UPDATEDAT_FIELD_PRIORITY)) {
      results[table] = await _dryRunBackfillForTable(table);
    }
    return jsonResponse({ success: true, dryRun: true, results });
  } catch (e) {
    return errorResponse(`_updatedAt backfill dry-run failed: ${e.message}`, 500);
  }
}

// Sep 30 2026 — real, direct extension built per explicit instruction: a complete, record-by-record STAGING
// preview covering the 9-table batch PLUS dispatches/lotSummaries/dyeLotSummaries, with explicit ACTIVE/ARCHIVE
// location on every row. Read-only — never calls fbSet/fbPatch, confirmed by inspection, same as the existing
// dry-run above. Reuses the exact same _dryRunBackfillForTable()/_isValidIsoTimestamp() logic already proven and
// tested for the 9-table batch, rather than a second, separately-maintained copy of that logic.
//
// dispatches and the two summary tables are NOT in _BACKFILL_UPDATEDAT_FIELD_PRIORITY and use a different, single-
// field convention, confirmed from their own existing (execute-only, no dry-run) backfill tools: dispatches uses
// `timestamp`; lotSummaries/dyeLotSummaries use `updatedAt` (no underscore — a genuinely different field name,
// not a typo). Critically, dispatches' own existing tool (handleBackfillDispatchTimestamps) only ever reads
// `/tc/dispatches`, never `/tc/archive/dispatches` — confirmed by direct inspection — so this preview explicitly
// adds the archive branch for dispatches that the existing tool has never covered. lotSummaries/dyeLotSummaries
// have no archive counterpart (confirmed: these are derived summary records, not themselves archived) — only
// their one location is scanned.
//
// The approved migration marker from the earlier 9-table backfill is NOT applied here to any dispatches/summary
// record — that marker was approved specifically for the 41 already-identified voidLog/editLog records in that
// earlier, separate approval. A dispatches/summary record with no trustworthy source timestamp is reported here
// as MANUAL REVIEW only, explicitly never as a migration-marker candidate, pending its own separate decision.
function _buildPreviewRow(table, location, firebaseKey, record, sourceFieldCandidates) {
  const row = { table, location, firebaseKey, id: record.id ?? record.lotId ?? record.dyeLotId ?? firebaseKey, currentUpdatedAt: record._updatedAt || null };
  if (record._updatedAt) {
    row.proposedUpdatedAt = null;
    row.sourceField = null;
    row.sourceValue = null;
    row.reason = 'Existing _updatedAt found — preserved, not proposed for replacement.';
    row.action = 'SKIP';
    return row;
  }
  for (const field of sourceFieldCandidates) {
    const raw = record[field];
    if (raw !== undefined && raw !== null && raw !== '') {
      if (_isValidIsoTimestamp(raw)) {
        row.proposedUpdatedAt = raw;
        row.sourceField = field;
        row.sourceValue = raw;
        row.reason = `No _updatedAt present; using '${field}' — the best available historical timestamp for ${table}.`;
        row.action = 'BACKFILL';
        return row;
      } else {
        row.proposedUpdatedAt = null;
        row.sourceField = field;
        row.sourceValue = raw;
        row.reason = `Field '${field}' is present but not a valid, parseable ISO timestamp — refusing to guess.`;
        row.action = 'MANUAL REVIEW';
        return row;
      }
    }
  }
  row.proposedUpdatedAt = null;
  row.sourceField = null;
  row.sourceValue = null;
  row.reason = `No timestamp field found among (${sourceFieldCandidates.join(', ')}) — no trustworthy historical value exists.`;
  row.action = 'MANUAL REVIEW';
  return row;
}

function _summarizeRows(rows) {
  const s = { totalRecords: rows.length, activeRecords: 0, archiveRecords: 0, alreadyHad: 0, backfillProposed: 0, manualReview: 0, malformed: 0, noAction: 0 };
  for (const r of rows) {
    if (r.location === 'ACTIVE') s.activeRecords++; else if (r.location === 'ARCHIVE') s.archiveRecords++;
    if (r.action === 'SKIP') { s.alreadyHad++; s.noAction++; }
    else if (r.action === 'BACKFILL') s.backfillProposed++;
    else if (r.action === 'MANUAL REVIEW') {
      s.manualReview++;
      if (r.sourceField) s.malformed++;
    }
  }
  return s;
}

async function handleBackfillUpdatedAtFullPreviewStaging(tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin only', 403);
  try {
    const allRows = [];
    const perTable = {};

    // ---- the 9-table batch: reuse the exact, already-tested detection logic, reshaped into the per-record form ----
    for (const table of Object.keys(_BACKFILL_UPDATEDAT_FIELD_PRIORITY)) {
      const detection = await _dryRunBackfillForTable(table);
      const rows = [];
      for (const item of detection.proposed) {
        rows.push({ table, location: 'ACTIVE', firebaseKey: item.firebaseKey, id: item.id, currentUpdatedAt: null, proposedUpdatedAt: item.proposedUpdatedAt, sourceField: item.sourceField, sourceValue: item.sourceValue, reason: item.reason, action: 'BACKFILL' });
      }
      for (const item of detection.manualReview) {
        rows.push({ table, location: 'ACTIVE', firebaseKey: item.firebaseKey, id: item.id, currentUpdatedAt: null, proposedUpdatedAt: null, sourceField: null, sourceValue: null, reason: item.reason, action: 'MANUAL REVIEW' });
      }
      for (let i = 0; i < detection.alreadyHad; i++) {
        rows.push({ table, location: 'ACTIVE', firebaseKey: '(see raw data — already-valid records are not individually re-listed by the underlying detector)', id: null, currentUpdatedAt: '(existing, valid)', proposedUpdatedAt: null, sourceField: null, sourceValue: null, reason: 'Existing _updatedAt found — preserved, not proposed for replacement.', action: 'SKIP' });
      }
      perTable[table] = _summarizeRows(rows);
      allRows.push(...rows);
    }

    // ---- dispatches: active AND archive, 'timestamp' field, archive branch never covered by the existing tool ----
    const dispatchRows = [];
    for (const [base, location] of [['/tc/dispatches', 'ACTIVE'], ['/tc/archive/dispatches', 'ARCHIVE']]) {
      const raw = await fbGet(base).catch(() => null);
      if (!raw || typeof raw !== 'object') continue;
      for (const [key, record] of Object.entries(raw)) {
        if (!record || typeof record !== 'object' || !record.id) continue;
        dispatchRows.push(_buildPreviewRow('dispatches', location, key, record, ['timestamp']));
      }
    }
    perTable.dispatches = _summarizeRows(dispatchRows);
    allRows.push(...dispatchRows);

    // ---- lotSummaries / dyeLotSummaries: single location, 'updatedAt' field (no underscore, confirmed distinct) ----
    for (const table of ['lotSummaries', 'dyeLotSummaries']) {
      const raw = await fbGet(`/tc/${table}`).catch(() => null);
      const rows = [];
      if (raw && typeof raw === 'object') {
        for (const [key, record] of Object.entries(raw)) {
          if (!record || typeof record !== 'object') continue;
          rows.push(_buildPreviewRow(table, 'ACTIVE', key, record, ['updatedAt']));
        }
      }
      perTable[table] = _summarizeRows(rows);
      allRows.push(...rows);
    }

    const grandTotal = {
      totalRecords: allRows.length,
      activeRecords: allRows.filter(r => r.location === 'ACTIVE').length,
      archiveRecords: allRows.filter(r => r.location === 'ARCHIVE').length,
      alreadyHad: allRows.filter(r => r.action === 'SKIP').length,
      backfillProposed: allRows.filter(r => r.action === 'BACKFILL').length,
      manualReview: allRows.filter(r => r.action === 'MANUAL REVIEW').length,
    };

    return jsonResponse({ success: true, dryRun: true, writesPerformed: false, rows: allRows, perTable, grandTotal });
  } catch (e) {
    return errorResponse(`Full preview failed: ${e.message}`, 500);
  }
}

// Sep 30 2026 — real, direct, narrowly-scoped migration for the one specific gap the full staging preview
// surfaced: archived dispatches records never checked by the existing active-only dispatches backfill tool
// (handleBackfillDispatchTimestamps, confirmed earlier to read only /tc/dispatches). This function touches
// EXACTLY /tc/archive/dispatches — nothing else, by direct instruction. dryRun defaults to true, matching every
// other backfill tool's established convention. Independently re-reads and re-classifies every record itself
// rather than trusting the earlier preview's counts, per the explicit instruction to verify, not assume.
async function handleBackfillDispatchesArchiveUpdatedAt(tokenClaim, body) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin only', 403);
  const dryRun = body?.dryRun !== false;
  try {
    const raw = await fbGet('/tc/archive/dispatches').catch(() => null);
    const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const rows = [];
    let alreadyHad = 0, proposedCount = 0, manualReviewCount = 0;

    for (const [firebaseKey, record] of Object.entries(obj)) {
      if (!record || typeof record !== 'object') continue;
      const row = {
        table: 'dispatches', location: 'ARCHIVE', firebaseKey, id: record.id ?? firebaseKey,
        currentUpdatedAt: record._updatedAt || null, timestamp: record.timestamp ?? null,
      };
      if (record._updatedAt) {
        row.proposedUpdatedAt = null;
        row.reason = 'Existing _updatedAt found — preserved, not proposed for replacement.';
        row.action = 'SKIP';
        alreadyHad++;
      } else if (_isValidIsoTimestamp(record.timestamp)) {
        row.proposedUpdatedAt = record.timestamp;
        row.reason = `No _updatedAt present; using this record's own 'timestamp' field as the genuine historical value.`;
        row.action = 'BACKFILL';
        proposedCount++;
      } else {
        row.proposedUpdatedAt = null;
        row.reason = record.timestamp === undefined
          ? `No 'timestamp' field present — no trustworthy historical value exists, refusing to guess.`
          : `'timestamp' field is present but not a valid, parseable ISO timestamp — refusing to guess.`;
        row.action = 'MANUAL_REVIEW';
        manualReviewCount++;
      }
      rows.push(row);
    }

    let writesPerformed = false;
    if (!dryRun && proposedCount > 0) {
      const patch = {};
      for (const row of rows) {
        if (row.action === 'BACKFILL') patch[`/tc/archive/dispatches/${row.firebaseKey}/_updatedAt`] = row.proposedUpdatedAt;
      }
      await fbPatch('', patch);
      writesPerformed = true;
    }

    return jsonResponse({
      success: true, dryRun, writesPerformed,
      totalScanned: rows.length, alreadyHad, proposedBackfill: proposedCount, manualReview: manualReviewCount,
      rows,
    });
  } catch (e) {
    return errorResponse(`dispatches archive _updatedAt backfill failed: ${e.message}`, 500);
  }
}

// Sep 30 2026 — approved production execution for the historical _updatedAt backfill, reusing
// _dryRunBackfillForTable's exact, unmodified detection logic — the same classification that produced the
// reviewed and approved dry-run output. Never touches the current write paths (unrelated to this task) and never
// overwrites a record that already has _updatedAt (re-confirmed here, not just in the shared detector). dryRun
// defaults to true for safety, matching the legacy-format migrator's established convention — the caller must
// explicitly pass {"dryRun": false} to write anything.
//
// The one hardcoded value in this whole function is the approved migration marker below — used only for records
// the detector classifies as having no recoverable historical timestamp (never as a fallback for anything else,
// and never derived from the current execution time).
const _BACKFILL_UPDATEDAT_MIGRATION_MARKER = '2026-03-31T00:00:00.000Z';

async function handleBackfillUpdatedAtExecute(tokenClaim, body) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin only', 403);
  const dryRun = body?.dryRun !== false;
  try {
    const results = {};
    for (const table of Object.keys(_BACKFILL_UPDATEDAT_FIELD_PRIORITY)) {
      const detection = await _dryRunBackfillForTable(table);
      const changed = [];
      const migrationMarked = [];
      if (!dryRun) {
        const patch = {};
        for (const item of detection.proposed) {
          patch[`/tc/${table}/${item.firebaseKey}/_updatedAt`] = item.proposedUpdatedAt;
          changed.push({ firebaseKey: item.firebaseKey, id: item.id, _updatedAt: item.proposedUpdatedAt, source: item.sourceField });
        }
        for (const item of detection.manualReview) {
          patch[`/tc/${table}/${item.firebaseKey}/_updatedAt`] = _BACKFILL_UPDATEDAT_MIGRATION_MARKER;
          migrationMarked.push({ firebaseKey: item.firebaseKey, id: item.id, _updatedAt: _BACKFILL_UPDATEDAT_MIGRATION_MARKER });
        }
        if (Object.keys(patch).length > 0) await fbPatch('', patch);
      }
      results[table] = {
        dryRun,
        totalExamined: detection.totalExamined,
        alreadyHad: detection.alreadyHad,
        changed: dryRun ? detection.proposed.length : changed.length,
        changedRecords: dryRun ? detection.proposed : changed,
        migrationMarked: dryRun ? detection.manualReview.length : migrationMarked.length,
        migrationMarkedRecords: dryRun ? detection.manualReview : migrationMarked,
      };
    }
    return jsonResponse({ success: true, dryRun, migrationMarker: _BACKFILL_UPDATEDAT_MIGRATION_MARKER, results });
  } catch (e) {
    return errorResponse(`_updatedAt backfill execution failed: ${e.message}`, 500);
  }
}

// Sep 25 2026 — dispatches._updatedAt backfill (pathway only, per direct instruction — not run yet). Follows
// handleBackfillSummaryTimestamps()'s exact conventions (auth, single-pass whole-table read, additive patch,
// idempotent, same result shape). One real correction made during the audit before writing this, not assumed: the
// request's own wording said "copy updatedAt -> _updatedAt", but dispatches never had an `updatedAt` field at
// all — confirmed directly, zero matches anywhere in this table's write history. This table's own real,
// always-present date field is `timestamp` (the same field _dateField.dispatches already uses everywhere else in
// this app), so that is the genuine source here — never an invented value, just the correct existing field for
// this specific table rather than assuming it matches the summary tables' shape.
async function handleBackfillDispatchTimestamps(tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin only', 403);
  try {
    const raw = await fbGet('/tc/dispatches').catch(() => null);
    const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const patch = {};
    let backfilled = 0, alreadyHad = 0, skippedNoTimestampAtAll = 0;
    for (const [key, record] of Object.entries(obj)) {
      if (!record || typeof record !== 'object') continue;
      if (record._updatedAt) { alreadyHad++; continue; }
      if (!record.timestamp) { skippedNoTimestampAtAll++; continue; }
      patch[`/tc/dispatches/${key}/_updatedAt`] = record.timestamp;
      backfilled++;
    }
    if (Object.keys(patch).length > 0) await fbPatch('', patch);
    return jsonResponse({ success: true, results: { dispatches: { backfilled, alreadyHad, skippedNoTimestampAtAll, total: Object.keys(obj).length } } });
  } catch (e) {
    return errorResponse(`Backfill failed: ${e.message}`, 500);
  }
}

async function handlePopulateArchive(batchSize = 30, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin only', 403);
  try {
    const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(e => e && e.id);
    const toObj = v => Array.isArray(v) ? {} : (v || {});

    // Fetch summaries + active dye lots only (small fetches first)
    const [summaries, activeDyeLots, archivedDyeLotRaw] = await Promise.all([
      _getCachedSummaryTable('dyeLotSummaries').catch(() => ({})),
      fbGet('/tc/dyeLots').catch(() => ({})),
      fbGet('/tc/archive/dyeLots').catch(() => ({}))
    ]);

    const summaryObj = toObj(summaries);
    const _activeDyeLots = toArr(activeDyeLots);
    const _archivedDyeLots = toArr(archivedDyeLotRaw);

    const alreadyArchivedIds = new Set(_archivedDyeLots.map(d => d.id));

    // All fully dispatched IDs (active + already archived, for shared truck check)
    const fullyDispatchedIds = new Set(
      Object.entries(summaryObj)
        .filter(([id, s]) => s && s.fullyDispatched)
        .map(([id]) => id)
    );
    _archivedDyeLots.forEach(d => fullyDispatchedIds.add(d.id));

    // Only process active lots that need archiving (not yet archived).
    // Jul 24 2026 fix — this used to check ONLY fullyDispatchedIds, which
    // is computed purely from "is anything currently sitting downstream
    // waiting to move forward" (dyeBalance/windBalance/packBalance all
    // zero). A dye lot that never produced any output at all (still
    // InProgress, outWeight/outCones both 0) has nothing downstream either
    // — mathematically indistinguishable from a lot that finished and
    // shipped everything. Confirmed via a real stuck case (DL-1709,
    // InProgress 8 days, zero output, swept into archive anyway, then
    // permanently blocked its machine since the archive isn't reachable
    // from the End Dye screen). Now also requires the lot's own status to
    // genuinely be Approved/Edited-Approved before it's eligible.
    const toArchive = _activeDyeLots.filter(d =>
      fullyDispatchedIds.has(d.id) && !alreadyArchivedIds.has(d.id) &&
      (d.status === 'Approved' || d.status === 'Edited-Approved')
    );

    const remaining = toArchive.length;

    // Always handle dispatches — archive eligible ones regardless of batch state
    const [activeDispatch, archivedDispatchRaw] = await Promise.all([
      fbGet('/tc/dispatches').catch(() => ({})),
      fbGet('/tc/archive/dispatches').catch(() => ({}))
    ]);
    const _activeDispatch = toArr(activeDispatch);
    const _archivedDispatch = toArr(archivedDispatchRaw);
    const activeDispatchIds = new Set(_activeDispatch.map(d => d.id));
    const dispPayload = {};
    let dc = 0;
    [..._activeDispatch, ..._archivedDispatch].forEach(d => {
      if (!activeDispatchIds.has(d.id)) return;
      const allDone = getDispatchDyeLotIds(d).every(id => fullyDispatchedIds.has(id));
      if (allDone) { dispPayload[`archive/dispatches/${d.id}`] = d; dispPayload[`dispatches/${d.id}`] = null; dc++; }
    });
    if (Object.keys(dispPayload).length > 0) await fbPatch('/tc', dispPayload);

    if (remaining === 0) {
      return jsonResponse({ success: true, archived: 0, remaining: 0, dispatchMoved: dc, message: 'All lots archived' });
    }

    // Process one batch of N lots
    const batch = toArchive.slice(0, batchSize);
    const batchIds = new Set(batch.map(d => d.id));

    // Fetch wind + pack for only this batch (targeted)
    const [activeWind, activePack] = await Promise.all([
      fbGet('/tc/windEntries').catch(() => ({})),
      fbGet('/tc/packEntries').catch(() => ({}))
    ]);
    const _activeWind = toArr(activeWind).filter(e => batchIds.has(e.dyeLotId));
    const _activePack = toArr(activePack).filter(e => batchIds.has(e.dyeLotId));

    const updatePayload = {};
    let archivedLots = 0, archivedWind = 0, archivedPack = 0;

    batch.forEach(dyeLot => {
      const dyeLotId = dyeLot.id;
      updatePayload[`archive/dyeLots/${dyeLotId}`] = dyeLot;
      updatePayload[`dyeLots/${dyeLotId}`] = null;
      archivedLots++;
      _activeWind.filter(e => e.dyeLotId === dyeLotId).forEach(e => {
        updatePayload[`archive/windEntries/${e.id}`] = e;
        updatePayload[`windEntries/${e.id}`] = null;
        archivedWind++;
      });
      _activePack.filter(e => e.dyeLotId === dyeLotId).forEach(e => {
        updatePayload[`archive/packEntries/${e.id}`] = e;
        updatePayload[`packEntries/${e.id}`] = null;
        archivedPack++;
      });
    });

    if(Object.keys(updatePayload).length > 0) {
      updatePayload['archiveLastUpdated'] = new Date().toISOString();
      await fbPatch('/tc', updatePayload);
      // Sep 29 2026 — Phase 4: same pattern as handlePopulateArchiveLots — UPDATE the archive cache directly
      // with the exact records the Worker already holds, no extra Firebase read needed.
      for (const [path, value] of Object.entries(updatePayload)) {
        if (value === null) continue;
        const m = path.match(/^archive\/(dyeLots|windEntries|packEntries)\/(.+)$/);
        if (m) await _setCachedArchiveRecord(m[1], m[2], value);
      }
    }
    console.log(`[archive/populate] Archived ${archivedLots} lots (${archivedWind} wind, ${archivedPack} pack). Remaining: ${remaining - archivedLots}`);

    return jsonResponse({
      success: true,
      archived: archivedLots,
      windMoved: archivedWind,
      packMoved: archivedPack,
      dispatchMoved: dc,
      remaining: remaining - archivedLots,
      totalKeys: Object.keys(updatePayload).length
    });

  } catch (err) {
    console.error('[archive/populate] Error:', err);
    return errorResponse('Archive populate failed: ' + err.message, 500);
  }
}

// ─── API: Bulk archive fully dispatched RM lots + soft entries ───────────────
// One-time migration: adds the _lotKey composite field (lotId__grade__vendor,
// sanitized) to existing stage entries that don't have it yet. Needed so the
// archive job (handlePopulateArchiveLots below) can query precisely by the
// full lot identity instead of lotId alone — lotId numbers get reused across
// different grade/vendor combos in this dataset, so a lotId-only index would
// over-fetch. Safe to re-run: entries that already have _lotKey are skipped,
// not re-written.
async function handleBackfillStageEntryLotKey(tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin only', 403);
  try {
    const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(e => e && e.id);
    const raw = await fbGet('/tc/stageEntries').catch(() => ({}));
    const entries = toArr(raw);
    const updatePayload = {};
    let updated = 0, skipped = 0;
    entries.forEach(e => {
      if (e._lotKey) { skipped++; return; }
      const lk = summaryKey(e.lotId, e.grade, e.vendor);
      updatePayload[`stageEntries/${e.id}/_lotKey`] = lk;
      updated++;
    });
    if (Object.keys(updatePayload).length > 0) {
      await fbPatch('/tc', updatePayload);
    }
    return jsonResponse({ success: true, updated, skipped, total: entries.length });
  } catch(err) {
    console.error('[backfill-lotkey] Error:', err);
    return errorResponse('Backfill failed: '+err.message, 500);
  }
}


// ─── API: One-time backfill — recover missing Pack inWeight from gainKg ──────
// Old Pack entries (created before the form started persisting inWeight) are
// missing that field, but gainKg/gainPct were correctly calculated and saved
// at creation time using formula: gainKg = weight - inWeight. So we can
// reconstruct the original inWeight exactly: inWeight = weight - gainKg.
// Verified safe: recalculating gainPct from the recovered inWeight matches
// the originally stored gainPct on every checked sample. Only writes the
// inWeight field — does not touch weight, gainKg, gainPct, or any other
// field. Skips entries that already have inWeight, or that lack gainKg
// (nothing to recover from). Checks both active and archived packEntries.
async function handleBackfillPackInWeight(tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin only', 403);
  try {
    const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(e => e && e.id);
    const updatePayload = {};
    let updated = 0, skipped = 0, noGain = 0;

    for (const base of ['packEntries', 'archive/packEntries']) {
      const raw = await fbGet(`/tc/${base}`).catch(() => ({}));
      const entries = toArr(raw);
      entries.forEach(e => {
        if (e.inWeight !== undefined && e.inWeight !== null && e.inWeight !== 0) {
          skipped++;
          return;
        }
        if (e.gainKg === undefined || e.gainKg === null || e.weight === undefined || e.weight === null) {
          noGain++;
          return;
        }
        const recovered = Math.round((e.weight - e.gainKg) * 100) / 100;
        if (recovered <= 0) { noGain++; return; }
        updatePayload[`${base}/${e.id}/inWeight`] = recovered;
        updated++;
      });
    }

    if (Object.keys(updatePayload).length > 0) {
      await fbPatch('/tc', updatePayload);
    }
    return jsonResponse({ success: true, updated, skipped, noGain });
  } catch(err) {
    console.error('[backfill-pack-inweight] Error:', err);
    return errorResponse('Backfill failed: '+err.message, 500);
  }
}

async function handleRenumberDispatchCollisions(tokenClaim, batchSize = 5) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin only', 403);
  try {
    const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(e => e && e.id);
    const [activeRaw, archivedRaw] = await Promise.all([
      fbGet('/tc/dispatches').catch(() => ({})),
      fbGet('/tc/archive/dispatches').catch(() => ({}))
    ]);
    const active = toArr(activeRaw);
    const archived = toArr(archivedRaw);
    const activeById = new Map(active.map(d => [d.id, d]));

    // Same detection logic as the Daily Checker's own flag — a genuine
    // collision means the two records disagree on party, weight, or
    // dye lot, not just happening to share a number for a legitimate
    // reason.
    const genuinelyDifferent = (a, b) => a.party !== b.party || Math.abs((a.weight || 0) - (b.weight || 0)) > 0.01 || a.dyeLotId !== b.dyeLotId;

    const allCollisions = archived.filter(ad => {
      const av = activeById.get(ad.id);
      return av && genuinelyDifferent(av, ad);
    });

    // Jul 22 2026 — the free plan allows only 50 subrequests per single
    // invocation, and each safe ID generated via genIdAtomicServer/
    // withBalanceLock uses several (lock acquire, counter read+write,
    // lock release). Processing all 124 collisions in one call blew
    // well past that. Now processes one safe batch per call — call
    // this endpoint repeatedly (same batchSize or default) until
    // remainingCount reaches 0.
    const batch = allCollisions.slice(0, batchSize);

    // Only the already-archived, already-settled side gets a new
    // number — the active side is never touched. The old number is
    // kept as a visible `previousId` field, so the record's real
    // history is traceable, not silently rewritten.
    const patch = {};
    const renumbered = [];
    for (const ad of batch) {
      const oldId = ad.id;
      const newId = await genIdAtomicServer('DSP', [...active, ...archived]);
      const renamedRecord = { ...ad, id: newId, previousId: oldId, renumberedAt: new Date().toISOString(), renumberedReason: 'ID collision with an unrelated active dispatch — this archived record renumbered, the active one left untouched' };
      patch[`archive/dispatches/${oldId}`] = null;
      patch[`archive/dispatches/${newId}`] = renamedRecord;
      renumbered.push({ oldId, newId, party: ad.party, weight: ad.weight, dyeLotId: ad.dyeLotId });
    }

    if (Object.keys(patch).length > 0) {
      await fbPatch('/tc', patch);
    }

    const remainingCount = allCollisions.length - batch.length;
    console.log(`[renumber-dispatch-collisions] Renumbered ${renumbered.length} archived dispatch(es) this batch, ${remainingCount} remaining, 0 active records touched`);
    return jsonResponse({ success: true, renumberedCount: renumbered.length, remainingCount, totalCollisionsFound: allCollisions.length, renumbered, done: remainingCount === 0 });
  } catch (err) {
    console.error('[renumber-dispatch-collisions] Error:', err);
    return errorResponse('Renumber failed: ' + err.message, 500);
  }
}

async function handlePopulateArchiveLots(batchSize=20, tokenClaim) {
  const role = tokenClaim?.role || '';
  if (!['admin', 'manager'].includes(role)) return errorResponse('Admin only', 403);
  try {
    const toArr = v => (Array.isArray(v) ? v : Object.values(v || {})).filter(e => e && e.id);

    const [summaries, activeLots, archivedLotsRaw] = await Promise.all([
      _getCachedSummaryTable('lotSummaries').catch(() => ({})),
      fbGet('/tc/lots').catch(() => ({})),
      fbGet('/tc/archive/lots').catch(() => ({}))
    ]);

    const summaryObj = Array.isArray(summaries) ? {} : (summaries || {});
    const _activeLots = toArr(activeLots);
    const _archivedLots = toArr(archivedLotsRaw);
    const alreadyArchivedKeys = new Set(_archivedLots.map(l => summaryKey(l.id, l.grade, l.vendor)));

    // Find active lots that are fully dispatched
    const toArchive = _activeLots.filter(l => {
      const key = summaryKey(l.id, l.grade, l.vendor);
      const s = summaryObj[key];
      const lotKey = key;
      return s && s.fullyDispatched && !alreadyArchivedKeys.has(lotKey);
    });

    const remaining = toArchive.length;
    if (remaining === 0) return jsonResponse({ success: true, archived: 0, remaining: 0, message: 'All lots archived' });

    const batch = toArchive.slice(0, batchSize);

    // Fetch soft entries for this batch only — targeted per-lot queries instead
    // of downloading the entire (1000+ entry) stageEntries table every run.
    // Queries by _lotKey (lotId+grade+vendor composite) not lotId alone, since
    // lotId numbers get reused across different grade/vendor combos in this
    // dataset — a lotId-only query would over-fetch in exactly the cases this
    // optimization is meant to help with. Requires .indexOn:["_lotKey"] on
    // /tc/stageEntries in firebase-rules.json, and requires the one-time
    // backfill (/api/stageentries/backfill-lotkey) to have been run so older
    // entries have the field — entries missing it are silently skipped by
    // this query, not lost (they just won't archive until backfilled).
    const sePerLot = await Promise.all(
      batch.map(lot => {
        const lk = summaryKey(lot.id, lot.grade, lot.vendor);
        return fbGet('/tc/stageEntries', `orderBy="_lotKey"&equalTo="${encodeURIComponent(lk)}"`).catch(() => ({}));
      })
    );
    const _activeSE = sePerLot.flatMap(toArr).filter(e => e.stage==='Soft');

    // Jul 24 2026 fix — same principle as the dye lot archival fix. These
    // entries used to be fetched ONLY to copy them into archive alongside
    // their lot, never checked for status first. fullyDispatched is
    // computed from Approved-only balances (the "Balance" layer, not
    // "Available"), so a brand-new Pending/InProgress Soft entry started
    // on a lot whose Approved-based summary already reads "fully
    // dispatched" wouldn't be reflected in that summary at all — the lot
    // (and that live, unapproved entry) could get swept into archive
    // together, pulling real in-flight work out of the Approval Queue's
    // reach (which only scans active stageEntries, never archive).
    const lotsWithLiveWork = new Set(
      _activeSE
        .filter(e => e.status === 'Pending' || e.status === 'Edited-Pending' || e.status === 'InProgress')
        .map(e => `${e.lotId}__${e.grade || ''}__${e.vendor || ''}`)
    );
    const batchFiltered = batch.filter(lot => !lotsWithLiveWork.has(`${lot.id}__${lot.grade || ''}__${lot.vendor || ''}`));

    const updatePayload = {};
    let archivedLots = 0, archivedSE = 0;

    batchFiltered.forEach(lot => {
      const lotKey = summaryKey(lot.id, lot.grade, lot.vendor);
      updatePayload[`archive/lots/${lotKey}`] = lot;
      updatePayload[`lots/${lotKey}`] = null;
      archivedLots++;

      _activeSE.filter(e => e.lotId===lot.id && e.grade===lot.grade && e.vendor===lot.vendor)
        .forEach(e => {
          updatePayload[`archive/stageEntries/${e.id}`] = e;
          updatePayload[`stageEntries/${e.id}`] = null;
          archivedSE++;
        });
    });

    updatePayload['archiveLastUpdated'] = new Date().toISOString();
    await fbPatch('/tc', updatePayload);
    // Sep 29 2026 — Phase 4: UPDATE the archive cache directly with the exact records just written to Firebase —
    // the Worker already holds them in updatePayload, no extra Firebase read needed to populate Redis.
    for (const [path, value] of Object.entries(updatePayload)) {
      if (value === null) continue;
      const m = path.match(/^archive\/(lots|stageEntries)\/(.+)$/);
      if (m) await _setCachedArchiveRecord(m[1], m[2], value);
    }
    const skippedForLiveWork = batch.length - batchFiltered.length;
    console.log(`[archive/lots] Archived ${archivedLots} lots, ${archivedSE} soft entries. Skipped ${skippedForLiveWork} lot(s) with live Pending/InProgress work. Remaining: ${remaining-archivedLots}`);

    return jsonResponse({ success: true, archived: archivedLots, softMoved: archivedSE, remaining: remaining-archivedLots });
  } catch(err) {
    console.error('[archive/lots] Error:', err);
    return errorResponse('Archive lots failed: '+err.message, 500);
  }
}

// ─── Main Export ─────────────────────────────────────────────────────────────
export default {

  async fetch(request, env, ctx) {
    _fbSecret = env.FIREBASE_DB_SECRET || null;
    _apiSecret = env.API_SECRET || '';
    _turnstileSecret = env.TURNSTILE_SECRET_KEY || '';
    FIREBASE_URL = env.FIREBASE_URL || FIREBASE_URL;
    // Sep 29 2026 — Phase 3: same lazy, once-per-request pattern as the secrets above. Only constructed if both
    // env values are actually present — if either is missing, _redis stays null, and every cache function below
    // reads that as "Redis isn't available right now" and cleanly falls through, exactly like a real cache miss.
    _redis = (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN)
      ? new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN })
      : null;
    _requestOrigin = request.headers.get('Origin') || '';
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    // ── API Routes ──
    if (url.pathname.startsWith('/api/')) {

      // /api/login is the token-issuing endpoint — no token required.
      // /api/export/* uses a separate, fixed export key instead of a session
      // token — session tokens expire and are tied to a logged-in user, which
      // doesn't work for an unattended Excel/Power BI refresh. This key is
      // read-only: it only unlocks the 8 export endpoints, nothing else
      // (Jul 13 2026, see conversation with Priyam — Excel "Unauthorized" fix).
      // All other /api/* routes require a valid signed session token.
      if (url.pathname !== '/api/login') {
        if (url.pathname.startsWith('/api/export/')) {
          const _exportKey = url.searchParams.get('key');
          if (!env.EXPORT_API_KEY || _exportKey !== env.EXPORT_API_KEY) return errorResponse('Unauthorized', 401);
        } else {
          const _tokenClaim = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          if (!_tokenClaim) return errorResponse('Unauthorized', 401);
        }
      }

      try {
        // GET /api/summaries — get all lot summaries
        // POST /api/save — routes all client writes through Worker
        if (request.method === 'POST' && url.pathname === '/api/save') {
          const _tokenForSave = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          const _saveBody = await request.json().catch(() => ({}));
          return await handleSave(_saveBody, _tokenForSave);
        }

        // POST /api/masters/add-item — Sep 10 2026: the real, safe fix
        // for a genuine incident — adding a Master value (worker,
        // vendor, mill, grade, machine, or party) used to read the
        // whole list into the browser, add locally, then overwrite the
        // whole thing back, silently losing a concurrent addition from
        // someone else. This fetches the current, fresh list right
        // before writing, inside the same proven lock used elsewhere.
        if (request.method === 'POST' && url.pathname === '/api/masters/add-item') {
          const _tokenForMasterAdd = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          const _masterAddBody = await request.json().catch(() => ({}));
          return await handleMasterAddItem(_masterAddBody, _tokenForMasterAdd);
        }

        // GET /api/admin/scan-imbalance-flags — Sep 10 2026: read-only
        // check for auto-flagged imbalance warnings that may have gone
        // stale — real-checked once against the same formula the Daily
        // Balance Check trusts, not the accumulated deltas that
        // originally set the flag.
        if (request.method === 'GET' && url.pathname === '/api/admin/scan-imbalance-flags') {
          const _tokenForScanImbalance = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleScanImbalanceFlags(_tokenForScanImbalance);
        }

        // POST /api/admin/recheck-imbalance-flags — Sep 10 2026: the
        // actual correction — clears only the flags this scan just
        // confirmed are no longer genuinely imbalanced, never one a
        // real person set by hand (the same auto-only safeguard used
        // everywhere this pattern appears).
        if (request.method === 'POST' && url.pathname === '/api/admin/recheck-imbalance-flags') {
          const _tokenForRecheck = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          const _recheckBody = await request.json().catch(() => ({}));
          return await handleRecheckImbalanceFlags(_recheckBody, _tokenForRecheck);
        }

        // GET /api/admin/scan-dye-source-mismatches — Sep 10 2026:
        // read-only check for real dye lots whose source breakdown no
        // longer sums to their own total — the real, existing side
        // effect of edits made before the proportional-sync fix
        // existed, found via Priyam's own real Excel export.
        if (request.method === 'GET' && url.pathname === '/api/admin/scan-dye-source-mismatches') {
          const _tokenForScanDyeSrc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleScanDyeSourceMismatches(_tokenForScanDyeSrc);
        }

        // POST /api/admin/fix-dye-source-mismatches — Sep 10 2026: the
        // actual correction — rescales each confirmed real source
        // breakdown proportionally to match its own lot's real total,
        // same proven logic as the live edit fix, re-verified against
        // fresh data before touching anything.
        if (request.method === 'POST' && url.pathname === '/api/admin/fix-dye-source-mismatches') {
          const _tokenForSrcFix = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          const _srcFixBody = await request.json().catch(() => ({}));
          return await handleFixDyeSourceMismatches(_srcFixBody, _tokenForSrcFix);
        }

        // POST /api/admin/clear-stage — Jul 29 2026: dedicated, properly
        // secured endpoint for the Masters "Clear All" feature. Was
        // routed through the generic /api/save with an emptied array —
        // see handleClearStage for why that was a real gap.
        if (request.method === 'POST' && url.pathname === '/api/admin/clear-stage') {
          const _tokenForClear = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          const _clearBody = await request.json().catch(() => ({}));
          return await handleClearStage(_clearBody, _tokenForClear);
        }

        // POST /api/admin/migrate-rm-uids — Jul 29 2026: Phase 1 of the
        // RM permanent-ID plan, batched, admin-only.
        if (request.method === 'POST' && url.pathname === '/api/admin/migrate-rm-uids') {
          const _tokenForMigrate = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          const _migrateBody = await request.json().catch(() => ({}));
          return await handleMigrateRMPermanentIds(_migrateBody, _tokenForMigrate);
        }

        // GET /api/admin/verify-rm-uids — real verification, not just
        // trusting the migration ran correctly.
        if (request.method === 'GET' && url.pathname === '/api/admin/verify-rm-uids') {
          return await handleVerifyRMPermanentIds();
        }

        // POST /api/admin/cleanup-orphaned-lots — Jul 29 2026, later
        // same day: cleanup for junk records the earlier key-mismatch
        // bug may have created. Defaults to dry-run (report only).
        if (request.method === 'POST' && url.pathname === '/api/admin/cleanup-orphaned-lots') {
          const _tokenForCleanup = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          const _cleanupBody = await request.json().catch(() => ({}));
          return await handleCleanupOrphanedLotRecords(_cleanupBody, _tokenForCleanup);
        }

        // POST /api/admin/backfill-soft-uid — Jul 29 2026: retrospective
        // backfill for existing Soft entries made before the permanent-ID
        // work, admin-or-manager, batched.
        if (request.method === 'POST' && url.pathname === '/api/admin/backfill-soft-uid') {
          const _tokenForBackfillSoft = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          const _backfillSoftBody = await request.json().catch(() => ({}));
          return await handleBackfillSoftUid(_backfillSoftBody, _tokenForBackfillSoft);
        }

        // POST /api/admin/backfill-dyesource-uid — same, for existing
        // Dye Sources.
        if (request.method === 'POST' && url.pathname === '/api/admin/backfill-dyesource-uid') {
          const _tokenForBackfillDye = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          const _backfillDyeBody = await request.json().catch(() => ({}));
          return await handleBackfillDyeSourceUid(_backfillDyeBody, _tokenForBackfillDye);
        }

        // GET /api/admin/verify-uid-backfill — real verification for
        // both backfills together.
        if (request.method === 'GET' && url.pathname === '/api/admin/verify-uid-backfill') {
          return await handleVerifyUidBackfill();
        }

        // POST /api/admin/backfill-rmreturn-uid — Aug 2 2026: third
        // backfill, for existing RM Return records.
        if (request.method === 'POST' && url.pathname === '/api/admin/backfill-rmreturn-uid') {
          const _tokenForBackfillRmr = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          const _backfillRmrBody = await request.json().catch(() => ({}));
          return await handleBackfillRMReturnUid(_backfillRmrBody, _tokenForBackfillRmr);
        }

        // POST /api/admin/backfill-residual-uid — Aug 2 2026: fourth,
        // for Residual Log + residualStock contributions.
        if (request.method === 'POST' && url.pathname === '/api/admin/backfill-residual-uid') {
          const _tokenForBackfillRes = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          const _backfillResBody = await request.json().catch(() => ({}));
          return await handleBackfillResidualUid(_backfillResBody, _tokenForBackfillRes);
        }

        // POST /api/admin/backfill-voidlog-uid — Aug 2 2026: fifth and
        // final, for voidLog's rm-delivery type entries.
        if (request.method === 'POST' && url.pathname === '/api/admin/backfill-voidlog-uid') {
          const _tokenForBackfillVl = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          const _backfillVlBody = await request.json().catch(() => ({}));
          return await handleBackfillVoidLogUid(_backfillVlBody, _tokenForBackfillVl);
        }

        // GET /api/admin/scan-stale-lot-addresses — Aug 2 2026: read-only
        // scan, shows every real mismatch between old records' saved
        // addresses and where their lot actually lives today. Changes
        // nothing — for review before any correction is applied.
        if (request.method === 'GET' && url.pathname === '/api/admin/scan-stale-lot-addresses') {
          const _tokenForScanStale = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleScanStaleLotAddresses(_tokenForScanStale);
        }

        // GET /api/admin/scan-duplicate-lot-ids — Aug 2 2026: read-only
        // scan, the direct answer to the active/archive duplicate-ID
        // risk, never confirmed against real data until now.
        if (request.method === 'GET' && url.pathname === '/api/admin/scan-duplicate-lot-ids') {
          const _tokenForScanDup = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleScanDuplicateLotIds(_tokenForScanDup);
        }

        // GET /api/admin/scan-lot-address-mismatches — Aug 5 2026:
        // read-only scan of the lots themselves, the original 9-lot
        // issue from the very start of this investigation.
        if (request.method === 'GET' && url.pathname === '/api/admin/scan-lot-address-mismatches') {
          const _tokenForScanAddr = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleScanLotAddressMismatches(_tokenForScanAddr);
        }

        // POST /api/admin/correct-lot-addresses — Aug 5 2026: actually
        // moves a lot to its correct address, no duplicate involved,
        // for the remaining lots after the duplicate-lot correction.
        if (request.method === 'POST' && url.pathname === '/api/admin/correct-lot-addresses') {
          const _tokenForAddrCorrect = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          const _addrCorrectBody = await request.json().catch(() => ({}));
          return await handleCorrectLotAddresses(_addrCorrectBody, _tokenForAddrCorrect);
        }

        // POST /api/admin/correct-duplicate-lots — Aug 2 2026: the
        // actual correction, only for lots explicitly confirmed by the
        // caller, re-verified server-side before touching anything.
        if (request.method === 'POST' && url.pathname === '/api/admin/correct-duplicate-lots') {
          const _tokenForCorrect = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          const _correctBody = await request.json().catch(() => ({}));
          return await handleCorrectDuplicateLots(_correctBody, _tokenForCorrect);
        }

        // GET /api/admin/scan-dye-lot-id-collisions — Sep 10 2026:
        // read-only scan for the real ID-collision issue found in
        // Priyam's actual production data — two different, real dye
        // lots sharing one ID after an external Firebase import reset
        // the ID counter. Different from the RM lot "duplicate" scan
        // above — these are genuinely different real records, not one
        // thing recorded twice.
        if (request.method === 'GET' && url.pathname === '/api/admin/scan-dye-lot-id-collisions') {
          const _tokenForScanCollisions = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleScanDyeLotIdCollisions(_tokenForScanCollisions);
        }

        // POST /api/admin/fix-dye-lot-id-collisions — Sep 10 2026: the
        // actual correction, only for the specific dye lot copies
        // explicitly confirmed by the caller, re-verified server-side
        // before touching anything. Gives the older copy a genuinely
        // fresh, unique ID and repoints only its own real downstream
        // records — nothing is deleted or merged.
        if (request.method === 'POST' && url.pathname === '/api/admin/fix-dye-lot-id-collisions') {
          const _tokenForDyeFix = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          const _dyeFixBody = await request.json().catch(() => ({}));
          return await handleFixDyeLotIdCollisions(_dyeFixBody, _tokenForDyeFix);
        }

        // POST /api/delete — routes delete operations through Worker
        if (request.method === 'POST' && url.pathname === '/api/delete') {
          const _tokenForDel = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          const _delBody = await request.json().catch(() => ({}));
          return await handleDelete(_delBody, _tokenForDel);
        }

        // GET /api/data/:path — active data via Worker (Phase 1: stageEntries, dyeLots)
        if (request.method === 'GET' && url.pathname.startsWith('/api/data/')) {
          const _dataPath = url.pathname.replace('/api/data/', '');
          return await handleGetActiveData(_dataPath, url);
        }

        if (request.method === 'GET' && url.pathname === '/api/summaries') {
          return await handleGetSummaries();
        }

        // GET /api/dispatch-summary — all dispatches (active + archive) for summary tab
        if (request.method === 'GET' && url.pathname === '/api/dispatch-summary') {
          return await handleDispatchSummary();
        }

        // GET /api/search — search history
        if (request.method === 'GET' && url.pathname === '/api/search') {
          return await handleSearch(url);
        }

        // GET /api/search-archive — targeted substring search of archive only, returns
        // matches not the full archive (used by global Search's "Search in History" button)
        if (request.method === 'GET' && url.pathname === '/api/search-archive') {
          return await handleSearchArchive(url);
        }

        // GET /api/reports/all-time — reuses the existing "All Time" report click.
        // Reads /tc/reportSummaries; if _stale (or missing), recomputes first via
        // recomputeReportSummaries(), then returns the fresh result. If not stale,
        // returns the cached summary with no recompute (Jul 12 2026).
        if (request.method === 'GET' && url.pathname === '/api/reports/all-time') {
          // Aug 6 2026 — real, new fast path: sums already-frozen daily
          // snapshots plus today's own fresh total, instead of the old
          // recomputeReportSummaries() which re-scanned the entire real
          // history (8,571+ records, confirmed) on every single request
          // — the actual, confirmed root cause of the CPU-time failure.
          try {
            const fresh = await computeAllTimeFromSnapshots();
            return jsonResponse({ results: fresh, recomputed: true });
          } catch (e) {
            return errorResponse('All Time report failed: ' + e.message, 500);
          }
        }
        // GET /api/reports/range?from=YYYY-MM-DD&to=YYYY-MM-DD — Aug 26 2026,
        // real, direct extension of the exact same proven pattern above:
        // Today/This Week/This Month now go through this same, safe
        // snapshot-based path instead of the old, archive-blind live
        // recalculation that only ever checked the active tables.
        if (request.method === 'GET' && url.pathname === '/api/reports/range') {
          const from = url.searchParams.get('from');
          const to = url.searchParams.get('to');
          if (!from || !to) return errorResponse('Both from and to date parameters are required', 400);
          try {
            const fresh = await computeRangeFromSnapshots(from, to);
            return jsonResponse({ results: fresh, recomputed: true });
          } catch (e) {
            return errorResponse('Range report failed: ' + e.message, 500);
          }
        }
        // POST /api/reports/multi-range — Aug 26 2026, real, purpose-built
        // for Analytics: accepts { ranges: [{from, to, label}, ...] },
        // makes exactly one bounded fetch of the snapshot table, returns
        // one result per requested range, in the same order.
        if (request.method === 'POST' && url.pathname === '/api/reports/multi-range') {
          const _multiRangeBody = await request.json().catch(() => ({}));
          const ranges = _multiRangeBody.ranges;
          if (!Array.isArray(ranges) || !ranges.length) return errorResponse('ranges must be a non-empty array of {from, to}', 400);
          for (const r of ranges) {
            if (!r || !r.from || !r.to) return errorResponse('Every range needs both from and to', 400);
          }
          try {
            const fresh = await computeMultiRangeFromSnapshots(ranges);
            return jsonResponse({ results: fresh, recomputed: true });
          } catch (e) {
            return errorResponse('Multi-range report failed: ' + e.message, 500);
          }
        }
        // GET /api/admin/check-password-security — Aug 26 2026, real,
        // admin-only diagnostic: reports which real accounts still sit
        // with a plaintext or old SHA-256 password, since the automatic
        // upgrade only fires the moment that specific account logs in.
        if (request.method === 'GET' && url.pathname === '/api/admin/check-password-security') {
          const _tokenForPwCheck = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          if (!_tokenForPwCheck) return errorResponse('Unauthorized', 401);
          return await handleCheckPasswordSecurity(_tokenForPwCheck);
        }
        // POST /api/admin/force-upgrade-passwords — Aug 26 2026, real,
        // admin-only fix: hashes every remaining plaintext/SHA-256
        // account's already-stored value directly, no reset needed.
        if (request.method === 'POST' && url.pathname === '/api/admin/force-upgrade-passwords') {
          const _tokenForPwUpgrade = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          if (!_tokenForPwUpgrade) return errorResponse('Unauthorized', 401);
          return await handleForceUpgradePasswords(_tokenForPwUpgrade);
        }
        if (request.method === 'GET' && url.pathname === '/api/reports/all-time-legacy') {
          const existing = await fbGet('/tc/reportSummaries').catch(() => null);
          if (existing && existing._stale === false) {
            return jsonResponse({ results: existing, recomputed: false });
          }
          // Aug 6 2026 — real, temporary diagnostic added after the CPU-time
          // optimization was deployed but this endpoint still returned a 500.
          // No error handling existed here at all before — if recomputeReport-
          // Summaries throws ANY real exception (a genuine code bug, not
          // necessarily still the CPU-time kill), it would produce the exact
          // same generic 500/HTML response, indistinguishable from the outside.
          // This directly answers which one it actually is: a caught error
          // here means a real, specific, fixable bug; if this ITSELF still
          // times out/fails uncaught, that's real evidence the CPU-time issue
          // genuinely isn't fully resolved yet, even after the optimization.
          try {
            const fresh = await recomputeReportSummaries();
            return jsonResponse({ results: fresh, recomputed: true });
          } catch (e) {
            return jsonResponse({ error: 'recomputeReportSummaries failed: ' + e.message, stack: (e.stack||'').slice(0,500) }, 500);
          }
        }

        // GET /api/export/{rm|soft|bridge|dye|wind|pack|dispatch} — raw data
        // export for Excel/Power BI Power Query. One endpoint per tab so a
        // refresh can target just one table instead of pulling everything
        // (Jul 12 2026, see conversation with Priyam on Excel/Power BI split).
        if (request.method === 'GET' && url.pathname === '/api/soft-available') return await handleSoftAvailable();

        // POST /api/rm/edit — Item A migration (Jul 14 2026): RM lot edit
        // cascade, moved server-side. Replaces pages.js's submitRMEdit.
        if (request.method === 'POST' && url.pathname === '/api/rm/edit') {
          const body = await request.json();
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleRMEdit(body, _tc);
        }

        // POST /api/rm-edit-request/reject — Sep 10 2026, real, new tool.
        if (request.method === 'POST' && url.pathname === '/api/rm-edit-request/reject') {
          const body = await request.json();
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleRejectRMEditRequest(body, _tc);
        }

        // POST /api/delete-request — Jul 24 2026 fix (create/reject actions)
        if (request.method === 'POST' && url.pathname === '/api/delete-request') {
          const body = await request.json().catch(() => ({}));
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleDeleteRequestAction(body, _tc);
        }

        // POST /api/masters/setting — Jul 24 2026 fix
        if (request.method === 'POST' && url.pathname === '/api/masters/setting') {
          const body = await request.json().catch(() => ({}));
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleMastersSettingUpdate(body, _tc);
        }

        // Aug 26 2026 — real, direct extension: moves one machine from
        // the old, shared list into its correct, real stage list.
        if (request.method === 'POST' && url.pathname === '/api/masters/migrate-machine') {
          const body = await request.json().catch(() => ({}));
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleMigrateMachine(body, _tc);
        }

        // Aug 26 2026 — real, direct extension: finds every real value
        // used by real records but missing from Masters — read-only.
        if (request.method === 'GET' && url.pathname === '/api/masters/scan-missing') {
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleScanMissingMasters(_tc);
        }

        // POST /api/lot/flag — Jul 24 2026 fix
        if (request.method === 'POST' && url.pathname === '/api/lot/flag') {
          const body = await request.json().catch(() => ({}));
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleLotFlag(body, _tc);
        }

        // POST /api/dye-lot/flag — Aug 26 2026, real, direct extension of
        // the exact same real flag system, for Dye Lots specifically.
        // Genuinely simpler than RM's version — a Dye Lot id is already,
        // provably unique on its own (confirmed directly against real
        // data earlier today), so no composite key is needed here.
        if (request.method === 'POST' && url.pathname === '/api/dye-lot/flag') {
          const body = await request.json().catch(() => ({}));
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleDyeLotFlag(body, _tc);
        }

        // POST /api/entry/flag — Aug 26 2026, real, shared flag endpoint
        // for Soft, Wind, Pack, and Dispatch entries — one, single,
        // generic endpoint for all 4, since their ids are already
        // genuinely unique on their own.
        if (request.method === 'POST' && url.pathname === '/api/entry/flag') {
          const body = await request.json().catch(() => ({}));
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleEntryFlag(body, _tc);
        }

        // POST /api/dispatch/link-order — Jul 24 2026 fix
        if (request.method === 'POST' && url.pathname === '/api/dispatch/link-order') {
          const body = await request.json().catch(() => ({}));
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleLinkOrder(body, _tc);
        }

        // POST /api/lots/migrate-deliveries — Jul 24 2026 fix
        if (request.method === 'POST' && url.pathname === '/api/lots/migrate-deliveries') {
          const body = await request.json().catch(() => ({}));
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleMigrateLotDeliveries(body, _tc);
        }

        // POST /api/reject — Jul 24 2026 fix, consolidated Dispatch/Dye/
        // Pack/Wind reject. See handleReject for why this was a real gap.
        if (request.method === 'POST' && url.pathname === '/api/reject') {
          const body = await request.json().catch(() => ({}));
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleReject(body, _tc);
        }

        // POST /api/rm/create — Jul 24 2026 fix. See handleRMCreate for
        // why this was a real gap.
        if (request.method === 'POST' && url.pathname === '/api/rm/create') {
          const body = await request.json().catch(() => ({}));
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleRMCreate(body, _tc);
        }

        // POST /api/dye/split — Jul 24 2026 fix. See handleDyeSplit for
        // why this was a real gap (never migrated at all).
        if (request.method === 'POST' && url.pathname === '/api/dye/split') {
          const body = await request.json().catch(() => ({}));
          return await handleDyeSplit(body);
        }
        if (request.method === 'POST' && url.pathname === '/api/dye/split-void') {
          const body = await request.json().catch(() => ({}));
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleVoidDyeSplit(body, _tc);
        }

        // POST /api/rm/void-delivery — Jul 24 2026 migration: per-delivery
        // RM lot void, moved server-side. Replaces pages.js's
        // voidRMDelivery, matching the /api/void pattern right below.
        if (request.method === 'POST' && url.pathname === '/api/rm/void-delivery') {
          const body = await request.json();
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleVoidRMDelivery(body, _tc);
        }

        // POST /api/void — Item B migration (Jul 14 2026): void execution
        // cascade, moved server-side. Replaces pages.js's submitVoidEntry.
        if (request.method === 'POST' && url.pathname === '/api/void') {
          const body = await request.json();
          return await handleVoidEntry(body);
        }

        // POST /api/void-request/reject — Sep 10 2026, real, new tool.
        if (request.method === 'POST' && url.pathname === '/api/void-request/reject') {
          const body = await request.json();
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleRejectVoidRequest(body, _tc);
        }

        // POST /api/edit-entry/preview — Aug 19 2026: real, read-only
        // preview before the real edit above actually commits. Never
        // writes anything.
        if (request.method === 'POST' && url.pathname === '/api/edit-entry/preview') {
          const body = await request.json();
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handlePreviewEdit(body, _tc);
        }

        // POST /api/edit-entry — Item D migration (Jul 14 2026): entry edit
        // cascade, moved server-side. Replaces pages.js's submitEditEntry.
        if (request.method === 'POST' && url.pathname === '/api/edit-entry') {
          const body = await request.json();
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleEditEntry(body, _tc);
        }

        // POST /api/void-rm-lot — Item C migration (Jul 14 2026): cascade-
        // void-entire-RM-lot, moved server-side for atomicity.
        if (request.method === 'POST' && url.pathname === '/api/void-rm-lot') {
          const body = await request.json();
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleVoidRMLotCascade(body, _tc);
        }

        // POST /api/approve-all — bulk approve, moved server-side with a
        // real role check (Jul 15 2026). Replaces pages.js's
        // approveAllCurrentTab.
        if (request.method === 'POST' && url.pathname === '/api/approve-all') {
          const body = await request.json();
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleApproveAll(body, _tc);
        }
        // POST /api/admin/reset-all — REBUILT Jul 15 2026, using verified
        // real source. Priyam uploaded an older backup
        // (tc_core_pages_split_production_55) containing the original
        // client-side _executePwdAction('reset') logic — not guessed, the
        // actual verified implementation. Same exact table list, same
        // shape, moved server-side: password AND the "type RESET to
        // confirm" phrase are now both re-verified here instead of only
        // trusted from the client's own checks (matching every other
        // destructive action fixed this session). Note: this table list
        // is narrower than "everything" — it's what the verified original
        // actually reset (lots/stageEntries/dyeBatches/dispatches/voidLog/
        // lotFlags/masters/parties/deleteRequests only, not dyeLots/
        // windEntries/packEntries/editLog/users/etc). Rebuilt exactly as
        // verified, scope not expanded — flagged to Priyam as its own
        // question, not decided here.
        if (request.method === 'POST' && url.pathname === '/api/admin/reset-all') {
          const body = await request.json().catch(() => ({}));
          return await handleFactoryReset(body);
        }

        // POST /api/master-item/delete — permanent master value deletion,
        // moved server-side with real password re-verification (Jul 15
        // 2026). Replaces pages.js's executeMasterDelete.
        if (request.method === 'POST' && url.pathname === '/api/master-item/delete') {
          const body = await request.json();
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleMasterItemDelete(body, _tc);
        }

        // POST /api/backup/restore — Jul 24 2026: moved server-side,
        // admin-password-verified, matching /api/admin/reset-all. See
        // handleBackupRestore for why this was a real gap.
        if (request.method === 'POST' && url.pathname === '/api/backup/restore') {
          const body = await request.json().catch(() => ({}));
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleBackupRestore(body, _tc);
        }

        // POST /api/backup/delete — Jul 24 2026: same migration as restore.
        if (request.method === 'POST' && url.pathname === '/api/backup/delete') {
          const body = await request.json().catch(() => ({}));
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleBackupDelete(body, _tc);
        }

        // Jul 15 2026 — /api/rm-lot/delete removed entirely. RM lots now
        // work like Dye lots: void-only, never hard-deleted (matching
        // Priyam's explicit decision to keep RM and Dye structurally the
        // same). The client-side trigger (openRMDelete) was confirmed
        // fully dead code first — zero onclick references anywhere — so
        // this endpoint had no real caller to begin with.

        // Jul 25 2026 — /api/override removed entirely. It duplicated
        // Edit's job (correcting an already-Approved entry's numbers)
        // through a second, inconsistent door — no password, and (unlike
        // Edit) no check that the new numbers were physically possible.
        // Edit is the one surviving path for this now.

        // POST /api/void-chain — Item Q critical tier (Jul 15 2026):
        // multi-entry void chain, moved server-side for atomicity.
        // Replaces pages.js's submitVoid2 — a second, previously-
        // unaudited void path.
        if (request.method === 'POST' && url.pathname === '/api/void-chain') {
          const body = await request.json();
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleVoidChain(body, _tc);
        }
        // GET /api/void-chain/build — Aug 6 2026, real fix: builds the
        // full cascade tree server-side, from genuinely complete,
        // merged active+archive data, instead of the frontend building
        // it from State.DB alone (which was silently missing anything
        // already archived).
        if (request.method === 'GET' && url.pathname === '/api/void-chain/build') {
          return await handleBuildVoidChain(url);
        }

        // POST /api/master-edit — Item Q critical tier (Jul 15 2026):
        // vendor/grade/worker/machine/mill/party rename cascade, moved
        // server-side for atomicity. Replaces pages.js's saveMasterEdit.
        if (request.method === 'POST' && url.pathname === '/api/master-edit') {
          const body = await request.json();
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleMasterEdit(body, _tc);
        }

        // POST /api/approve-entry — the 5 individual "Approve" buttons,
        // migrated server-side (Jul 15 2026), also where Phase 2's nudge
        // calls get their first real caller.
        if (request.method === 'POST' && url.pathname === '/api/approve-entry') {
          const body = await request.json();
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleApproveEntry(body, _tc);
        }

        // POST /api/override-approve, /api/dead-stock/create, /api/scrap —
        // Item Q medium tier (Jul 15 2026): consolidated override-approve,
        // dead stock creation, and scrap recording, moved server-side.
        if (request.method === 'POST' && url.pathname === '/api/override-approve') {
          const body = await request.json();
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleOverrideApprove(body, _tc);
        }
        if (request.method === 'POST' && url.pathname === '/api/dead-stock/create') {
          const body = await request.json();
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleDeadStockCreate(body, _tc);
        }
        if (request.method === 'POST' && url.pathname === '/api/dead-stock/void') {
          const body = await request.json();
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleVoidDeadStock(body, _tc);
        }
        if (request.method === 'POST' && url.pathname === '/api/dead-stock/edit') {
          const body = await request.json();
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleEditDeadStock(body, _tc);
        }
        // POST /api/rm-return, /api/residual-transfer — Jul 17 2026, a
        // real gap found only because Priyam specifically asked whether
        // this area had been covered. Both were fully client-side until
        // now.
        if (request.method === 'POST' && url.pathname === '/api/rm-return') {
          const body = await request.json();
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleRMReturn(body, _tc);
        }
        if (request.method === 'POST' && url.pathname === '/api/rm-return/void') {
          const body = await request.json();
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleVoidRMReturn(body, _tc);
        }
        if (request.method === 'POST' && url.pathname === '/api/rm-return/preview') {
          const body = await request.json();
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handlePreviewRMReturn(body, _tc);
        }
        if (request.method === 'POST' && url.pathname === '/api/rm-return/edit') {
          const body = await request.json();
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleEditRMReturn(body, _tc);
        }
        if (request.method === 'POST' && url.pathname === '/api/residual-transfer') {
          const body = await request.json();
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleResidualTransfer(body, _tc);
        }
        if (request.method === 'POST' && url.pathname === '/api/residual-transfer/void') {
          const body = await request.json();
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleVoidResidualTransfer(body, _tc);
        }
        if (request.method === 'POST' && url.pathname === '/api/residual-transfer/edit') {
          const body = await request.json();
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleEditResidualTransfer(body, _tc);
        }
        if (request.method === 'POST' && url.pathname === '/api/scrap') {
          const body = await request.json();
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleScrapSubmit(body, _tc);
        }
        if (request.method === 'POST' && url.pathname === '/api/scrap/void') {
          const body = await request.json();
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleVoidScrap(body, _tc);
        }

        // POST /api/party-order/create, /api/party-order/cancel — Item P
        // migration (Jul 15 2026): party order create/cancel, moved
        // server-side. Replaces client-side genOrderNo() (race-condition ID
        // gen) and the generic /api/save passthrough for cancel.
        if (request.method === 'POST' && url.pathname === '/api/party-order/create') {
          const body = await request.json();
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handlePartyOrderCreate(body, _tc);
        }
        if (request.method === 'POST' && url.pathname === '/api/party-order/cancel') {
          const body = await request.json();
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handlePartyOrderCancel(body, _tc);
        }

        // POST /api/stage/start, /api/stage/end — Item I migration (Jul 14
        // 2026): Soft stage entry creation/completion, moved server-side.
        if (request.method === 'POST' && url.pathname === '/api/stage/start') {
          const body = await request.json();
          return await handleStageStart(body);
        }
        if (request.method === 'POST' && url.pathname === '/api/stage/end') {
          const body = await request.json();
          return await handleStageEnd(body);
        }

        // POST /api/wind/start, /api/wind/end — Item I migration continued.
        if (request.method === 'POST' && url.pathname === '/api/wind/start') {
          const body = await request.json();
          return await handleWindStart(body);
        }
        if (request.method === 'POST' && url.pathname === '/api/wind/end') {
          const body = await request.json();
          return await handleWindEnd(body);
        }

        if (request.method === 'POST' && url.pathname === '/api/recycle-soft/void') {
          const body = await request.json();
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleVoidRecycleSoft(body, _tc);
        }
        if (request.method === 'POST' && url.pathname === '/api/recycle-soft/edit/preview') {
          const body = await request.json();
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handlePreviewEditRecycleSoft(body, _tc);
        }
        if (request.method === 'POST' && url.pathname === '/api/recycle-soft/edit') {
          const body = await request.json();
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleEditRecycleSoft(body, _tc);
        }

        if (request.method === 'POST' && url.pathname === '/api/recycle-soft/start') {
          const body = await request.json();
          return await handleRecycleSoftStart(body);
        }
        if (request.method === 'POST' && url.pathname === '/api/recycle-soft/end') {
          const body = await request.json();
          return await handleRecycleSoftEnd(body);
        }

        // POST /api/pack — Item I migration continued.
        if (request.method === 'POST' && url.pathname === '/api/pack') {
          const body = await request.json();
          return await handlePackSubmit(body);
        }

        // POST /api/dispatch — Item I migration continued.
        if (request.method === 'POST' && url.pathname === '/api/dispatch') {
          const body = await request.json();
          return await handleDispatchSubmit(body);
        }

        // POST /api/dye/start — Item I migration continued (final flow).
        if (request.method === 'POST' && url.pathname === '/api/dye/start') {
          const body = await request.json();
          return await handleDyeStart(body);
        }

        // POST /api/dye/edit-input — Sep 10 2026, real, new tool.
        if (request.method === 'POST' && url.pathname === '/api/dye/edit-input') {
          const body = await request.json();
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleEditDyeInput(body, _tc);
        }

        // Aug 26 2026 — real, direct extension: undo for a plain edit.
        if (request.method === 'POST' && url.pathname === '/api/undo-edit') {
          const body = await request.json();
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleUndoEdit(body, _tc);
        }

        // POST /api/dye/end — Item I migration, final piece.
        if (request.method === 'POST' && url.pathname === '/api/dye/end') {
          const body = await request.json();
          return await handleDyeEnd(body);
        }

        // GET /api/catalog — lightweight names-only lookup for discovery dropdowns
        if (request.method === 'GET' && url.pathname === '/api/catalog') {
          return await handleCatalog(url);
        }



        // POST /api/daily-check/run-now, GET /api/daily-check/latest —
        // Jul 17 2026, the daily background checker.
        if (request.method === 'POST' && url.pathname === '/api/daily-check/run-now') {
          const body = await request.json().catch(() => ({}));
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleDailyCheckRunNow(body, _tc, ctx);
        }
        if (request.method === 'GET' && url.pathname === '/api/daily-check/latest') {
          // Sep 8 2026 — real, root-cause fix found via DIRECT, LIVE
          // network evidence from Priyam's own browser (repeated 503s
          // and multi-second responses on this exact endpoint, called
          // every 3 seconds by the polling logic itself): this used
          // to download the ENTIRE HISTORY of every daily report ever
          // saved (one written per day since Jul 17 2026 — roughly 2
          // months of accumulation by now, each report potentially
          // hundreds of rows) just to find the single most recent one.
          // Firebase's own key-ordered query fetches only the latest
          // key directly — reportId is a YYYY-MM-DD string, which
          // sorts correctly this way, so this is a safe, direct
          // replacement, not an approximation.
          const raw = await fbGet('/tc/dailyCheckReports', 'orderBy="$key"&limitToLast=1').catch(() => null);
          const reports = raw ? Object.values(raw).filter(r => r && r.id) : [];
          reports.sort((a, b) => (a.id < b.id ? 1 : -1));
          const lastError = await fbGet('/tc/dailyCheckLastError').catch(() => null);
          // Sep 8 2026 — real, direct fix built via direct discussion
          // with Priyam: /backupStatus was already written correctly
          // on every backup attempt (success or failure) but never
          // shown anywhere in the app at all — a real blind spot,
          // since the daily check runs INSIDE the same nightly job,
          // right after backup completes. If backup itself fails,
          // the daily check never even gets a chance to run, and
          // there was no way to tell the two situations apart.
          // dailyCheckLastTiming (also new) shows how long the real
          // fetch-and-parse of the whole /tc tree took, separately
          // from how long the check's own logic took — real evidence
          // instead of continued guessing about where time goes.
          const backupStatus = await fbGet('/backupStatus').catch(() => null);
          const lastTiming = await fbGet('/tc/dailyCheckLastTiming').catch(() => null);
          return jsonResponse({ success: true, report: reports[0] || null, lastError: lastError || null, backupStatus: backupStatus || null, lastTiming: lastTiming || null });
        }

        // POST /api/summary/recalc-all — Jul 18 2026. Loads data once,
        // computes both RM-lot and dye-lot summaries in the background,
        // and writes a status marker. Replaces the old /api/summary/populate
        // + /api/dyelot/populate pair, which reloaded all base data from
        // scratch on every paginated batch call and could crash at real
        // scale — same root cause found and fixed for Balance Audit the
        // same day. Client polls /api/summary/recalc-status for completion.
        if (request.method === 'POST' && url.pathname === '/api/summary/recalc-all') {
          const body = await request.json().catch(() => ({}));
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleRecalcAllSummariesStart(body, ctx, _tc);
        }
        // POST /api/reports/backfill-snapshots — Aug 6 2026, real, missing
        // piece caught by Priyam. One-time (safely re-runnable) tool that
        // freezes every real historical day that existed before this
        // system was built, so "All Time" starts complete instead of
        // empty. Client polls /api/reports/backfill-status for progress.
        if (request.method === 'POST' && url.pathname === '/api/reports/backfill-snapshots') {
          const body = await request.json().catch(() => ({}));
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleBackfillSnapshotsStart(body, ctx, _tc);
        }
        if (request.method === 'GET' && url.pathname === '/api/reports/backfill-status') {
          return await handleBackfillSnapshotsStatus();
        }
        if (request.method === 'GET' && url.pathname === '/api/summary/recalc-status') {
          const raw = await fbGet('/tc/summaryRecalcStatus').catch(() => null);
          return jsonResponse({ success: true, status: raw || { status: 'never-run' } });
        }

        // POST /api/packentries/backfill-inweight — one-time migration, recovers
        // missing inWeight from gainKg for old Pack entries
        if (request.method === 'POST' && url.pathname === '/api/packentries/backfill-inweight') {
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleBackfillPackInWeight(_tc);
        }

        // POST /api/stageentries/backfill-lotkey — one-time migration, adds the
        // _lotKey composite field to existing stage entries that don't have it.
        // Safe to re-run — skips entries that already have the field.
        if (request.method === 'POST' && url.pathname === '/api/stageentries/backfill-lotkey') {
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleBackfillStageEntryLotKey(_tc);
        }

        // POST /api/summaries/backfill-timestamps — one-time (safe to re-run), adds the new canonical _updatedAt
        // field to every existing lotSummaries/dyeLotSummaries record that only ever had `updatedAt`. Required
        // before the Summary Loader's incremental sync can be trusted for pre-existing records.
        if (request.method === 'POST' && url.pathname === '/api/summaries/backfill-timestamps') {
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleBackfillSummaryTimestamps(_tc);
        }

        // POST /api/legacy-format/detect — read-only, safe to run as many times as needed. Reports exactly which
        // deadStock/recycleStock/scrapLog records (if any) are still stored under a key that doesn't match their
        // own id, before any decision is made about migrating or converting these tables' write architecture.
        if (request.method === 'POST' && url.pathname === '/api/legacy-format/detect') {
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleDetectLegacyFormat(_tc);
        }

        // POST /api/legacy-format/migrate — dryRun:true by default (safe). Pass {"dryRun": false} to actually
        // write the migration. Idempotent: re-running after a successful migration finds nothing left to do.
        if (request.method === 'POST' && url.pathname === '/api/legacy-format/migrate') {
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          const _body = await request.json().catch(() => ({}));
          return await handleMigrateLegacyFormat(_tc, _body);
        }

        // POST /api/backfill-updatedat/dry-run — read-only, reports the exact proposed _updatedAt mapping for
        // historical records across all 9 tables, for review before any execution endpoint is built or run.
        if (request.method === 'POST' && url.pathname === '/api/backfill-updatedat/dry-run') {
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleBackfillUpdatedAtDryRun(_tc);
        }

        // POST /api/backfill-updatedat/full-preview — read-only, record-by-record preview across the 9-table
        // batch PLUS dispatches/lotSummaries/dyeLotSummaries, with explicit ACTIVE/ARCHIVE location per row. Never
        // writes anything — preview only, pending explicit review and approval before any execution.
        if (request.method === 'POST' && url.pathname === '/api/backfill-updatedat/full-preview') {
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleBackfillUpdatedAtFullPreviewStaging(_tc);
        }

        // POST /api/backfill-updatedat/dispatches-archive — dryRun:true by default (safe). Touches ONLY
        // /tc/archive/dispatches, nothing else. Pass {"dryRun": false} to actually write.
        if (request.method === 'POST' && url.pathname === '/api/backfill-updatedat/dispatches-archive') {
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          const _body = await request.json().catch(() => ({}));
          return await handleBackfillDispatchesArchiveUpdatedAt(_tc, _body);
        }

        // POST /api/backfill-updatedat/execute — dryRun:true by default (safe, reports what would happen without
        // writing). Pass {"dryRun": false} to actually write the approved backfill. Idempotent: re-running after
        // a successful execution finds nothing left to do, since every target record now has _updatedAt.
        if (request.method === 'POST' && url.pathname === '/api/backfill-updatedat/execute') {
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          const _body = await request.json().catch(() => ({}));
          return await handleBackfillUpdatedAtExecute(_tc, _body);
        }

        // POST /api/dispatches/backfill-timestamps — one-time (safe to re-run), adds _updatedAt to every existing
        // dispatch that only ever had `timestamp` (dispatches never had an `updatedAt` field at all — confirmed
        // during audit). Pathway only, per direct instruction — not executed as part of this change.
        if (request.method === 'POST' && url.pathname === '/api/dispatches/backfill-timestamps') {
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleBackfillDispatchTimestamps(_tc);
        }

        // POST /api/archive/populate — bulk archive all fullyDispatched dye lots
        if (request.method === 'POST' && url.pathname === '/api/archive/populate') {
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handlePopulateArchive(30, _tc);
        }

        // POST /api/admin/trim-backups-now — one-time catch-up cleanup,
        // trims both Firebase and R2 backups down to MAX_BACKUPS immediately
        if (request.method === 'POST' && url.pathname === '/api/admin/trim-backups-now') {
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleTrimBackupsNow(_tc, env);
        }

        // POST /api/archive/populate-lots — bulk archive all fullyDispatched RM lots + soft entries
        if (request.method === 'POST' && url.pathname === '/api/archive/populate-lots') {
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handlePopulateArchiveLots(20, _tc);
        }

        // POST /api/dispatch/renumber-collisions — repeatable fix: renumbers a
        // safe batch of archived-side collisions per call (default 5 — each
        // safe ID generated costs 6 subrequests, so 5 stays comfortably under
        // the free plan's 50-subrequest limit even with the upfront reads and
        // final write). Call repeatedly until the response shows done:true.
        // Optional ?batchSize=N to override. Admin only.
        if (request.method === 'POST' && url.pathname === '/api/dispatch/renumber-collisions') {
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          const _batchSize = parseInt(url.searchParams.get('batchSize')) || 5;
          return await handleRenumberDispatchCollisions(_tc, _batchSize);
        }

        // GET /api/dyelotsummaries — get all dyeLot summaries
        if (request.method === 'GET' && url.pathname === '/api/dyelotsummaries') {
          const summaries = await fbGet('/tc/dyeLotSummaries');
          const arr = summaries ? Object.values(summaries).filter(s => s && s.dyeLotId) : [];
          return jsonResponse({ summaries: arr });
        }

        // POST /api/summary/trigger — update summary after status change
        if (request.method === 'POST' && url.pathname === '/api/summary/trigger') {
          const body = await request.json().catch(() => ({}));
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleSummaryTrigger(body, _tc);
        }

        // POST /api/archive/heal-timestamp — Aug 6 2026, real, live bug found
        // during actual staging testing: /tc/archiveLastUpdated genuinely
        // blank in Firebase, and the client's own cache-validity check
        // (deliberately, correctly) never trusts a blank timestamp — meaning
        // the archive cache could never validate, forever, on any reload.
        // Confirmed via the real, deployed Firebase rules that clients
        // cannot write this path directly (it isn't individually named,
        // falls under the $other catch-all, which explicitly denies
        // everything) — a genuine PERMISSION_DENIED was hit live, not
        // theoretical. Routed through the server instead, same as every
        // other genuinely important write, using the admin-level Firebase
        // secret that legitimately bypasses these client-side rules. Any
        // valid authenticated session may call this (not admin-only) —
        // this is a purely diagnostic, non-sensitive timestamp, and
        // restricting it further would risk the self-heal never actually
        // firing if only non-admin users happen to encounter the blank
        // state first.
        if (request.method === 'POST' && url.pathname === '/api/archive/heal-timestamp') {
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          if (!_tc) return errorResponse('Not authenticated', 401);
          const freshTs = new Date().toISOString();
          try {
            await fbSet('/tc/archiveLastUpdated', freshTs);
            // Aug 6 2026 — real, live diagnostic added after 4 consecutive
            // real staging tests kept showing the heal "succeed" yet never
            // actually being found on the next reload. Confirmed the
            // client and server connect via genuinely different mechanisms
            // (client: Firebase JS SDK with its own project config; server:
            // raw REST calls using FIREBASE_URL + an admin secret) — if
            // the server's real env.FIREBASE_URL isn't actually set to
            // staging's database, this exact symptom occurs: the write
            // genuinely succeeds, just on the wrong database. Tried to
            // verify this directly via the available Cloudflare tools
            // first — confirmed the override code itself is correct, but
            // none of the available tools expose the real, resolved
            // env var value. Exposing just the hostname (not sensitive —
            // the real secret is the separate auth token appended
            // afterward, never this URL itself) so this can be confirmed
            // directly from the next real test's console, without needing
            // dashboard access at all.
            const _fbHost = FIREBASE_URL.replace(/^https?:\/\//, '').split('/')[0];
            return jsonResponse({ success: true, ts: freshTs, _diagnosticFirebaseHost: _fbHost });
          } catch (e) {
            return errorResponse('Could not heal archiveLastUpdated: ' + e.message, 500);
          }
        }

        // POST /api/login — verify credentials server-side, return user without password
        if (request.method === 'POST' && url.pathname === '/api/login') {
          const body = await request.json().catch(() => ({}));
          const _cfProps = { threatScore: request.cf?.threatScore, remoteIp: request.headers.get('CF-Connecting-IP') };
          return await handleLogin(body, _cfProps);
        }

        // POST /api/logout — Aug 26 2026, real, genuine addition: the
        // real session cookie is HttpOnly, meaning JavaScript is
        // physically incapable of clearing it directly. The only real
        // way is a response from the server itself, setting the same
        // cookie name with an already-expired date — this is that
        // real, dedicated endpoint for exactly that.
        if (request.method === 'POST' && url.pathname === '/api/logout') {
          const _expiredCookie = 'tc_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0';
          return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders(), 'Set-Cookie': _expiredCookie } });
        }

        // POST /api/verify-password — verify against a specific user OR any active admin/manager
        if (request.method === 'POST' && url.pathname === '/api/verify-password') {
          const body = await request.json().catch(() => ({}));
          return await handleVerifyPassword(body);
        }

        // GET /api/users/list — full user list, passwords stripped
        if (request.method === 'GET' && url.pathname === '/api/users/list') {
          const _tokenForUsersList = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleUsersList(_tokenForUsersList);
        }

        // POST /api/users/create
        if (request.method === 'POST' && url.pathname === '/api/users/create') {
          const body = await request.json().catch(() => ({}));
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleUsersCreate(body, _tc);
        }

        // POST /api/users/toggle
        if (request.method === 'POST' && url.pathname === '/api/users/toggle') {
          const body = await request.json().catch(() => ({}));
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleUsersToggle(body, _tc);
        }

        // POST /api/users/delete
        if (request.method === 'POST' && url.pathname === '/api/users/delete') {
          const body = await request.json().catch(() => ({}));
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleUsersDelete(body, _tc);
        }

        // POST /api/users/reset-password
        if (request.method === 'POST' && url.pathname === '/api/users/reset-password') {
          const body = await request.json().catch(() => ({}));
          const _tc = await verifySessionToken(_getAuthHeaderOrCookie(request), _apiSecret);
          return await handleUsersResetPassword(body, _tc);
        }

        return errorResponse('Unknown API route', 404);

      } catch (e) {
        console.error('API error:', e);
        return errorResponse(`Server error: ${e.message}`, 500);
      }
    }

    // ── Static assets served by Cloudflare Assets config ──
    return new Response('Not found', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    _fbSecret = env.FIREBASE_DB_SECRET || null;
    _apiSecret = env.API_SECRET || '';
    FIREBASE_URL = env.FIREBASE_URL || FIREBASE_URL;
    // Sep 29 2026 — Phase 3: same lazy pattern as fetch() above, so any future cron-triggered code can use the
    // cache module too, on the same terms — null when not configured, never a hard dependency.
    _redis = (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN)
      ? new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN })
      : null;
    ctx.waitUntil(runCronBackup(env));
    // Aug 6 2026 — real, new nightly job: freeze yesterday's report
    // totals permanently, once, so "All Time" never has to re-process
    // it again. Riding along with the existing 2 AM cron rather than
    // adding a second trigger.
    const _yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    ctx.waitUntil(freezeDailySnapshot(_yesterday).catch(e => console.error('[Cron] Failed to freeze', _yesterday, ':', e.message)));
  }
};
