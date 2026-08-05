// shared-balances.js
//
// Single source of truth for ThreadControl's balance formulas. Built Jul 10
// 2026 to eliminate the exact class of bug found earlier this session (the
// "Sent to Dye never updates" bug): the same formula hand-written 3 times
// (core.js, worker.js calculateLotSummary, worker.js calculateSummaryFromData)
// and drifting apart because a fix applied to one copy doesn't reach the
// others. See .agents/AGENTS.md for the full incident history.
//
// Every function here is PURE — takes explicit arrays/values in, returns a
// value out, never reads a global (no `State`, no `DB`, no Firebase). This
// is what makes it safely importable from both the browser (core.js, a real
// ES module as of Stage 2) and the Cloudflare Worker (worker.js, always a
// real ES module) with zero circular-import risk — this file needs nothing
// from either of them.
//
// Being consolidated ONE FORMULA AT A TIME, each fully tested (behavioral
// diff + all 6 checker layers + real staging test) before the next. This
// slice: the primitive layer + RM Balance only. Soft/Dye/Wind/Pack/
// Dispatched balances are NOT yet consolidated — core.js and worker.js
// still have their own independent copies of those, exactly as before.

// ── Primitive quantity helpers ──────────────────────────────────────────
// Byte-identical to core.js's existing Q/Qadd/Qsub/Qmax0 — these were
// already pure (never touched State), just relocated here unchanged.
export const Q = (u, w) => ({ units: +(u || 0), weight: +(w || 0) });
export const Qadd = (a, b) => Q(a.units + b.units, a.weight + b.weight);
export const Qsub = (a, b) => Q(a.units - b.units, a.weight - b.weight);
export const Qmax0 = (a) => Q(Math.max(0, a.units), Math.max(0, a.weight));

// ── Status filters ───────────────────────────────────────────────────────
// Byte-identical to core.js's existing appr/seMatch — already pure.
export function appr(arr) {
  return (arr || []).filter(x => (x.status === 'Approved' || x.status === 'Edited-Approved') && !x.voided && x.status !== 'Voided');
}
export function seMatch(e, l) {
  return e.lotId === l.id && (e.grade === l.grade || (!e.grade && !l.grade)) && (e.vendor === l.vendor || (!e.vendor && !l.vendor));
}

// ── RM Balance and its direct dependencies ──────────────────────────────
// Parameterized versions of core.js's getLotByKey/getSoftIn/getRMReturnedOut/
// getRMBalance — same formulas, explicit data in instead of reading State.DB.

export function calcLotByKey(lots, lotId, grade, vendor) {
  return (lots || []).find(l => l.id === lotId && l.grade === grade && l.vendor === vendor) || {};
}

export function calcSoftIn(stageEntries, lots, lotId, grade, vendor) {
  const l = calcLotByKey(lots, lotId, grade, vendor);
  if (!l.id) return Q(0, 0);
  return appr(stageEntries).filter(e => seMatch(e, l) && e.stage === 'Soft')
    .reduce((a, e) => Qadd(a, Q(e.inUnits, e.inWeight)), Q(0, 0));
}

export function calcRMReturnedOut(rmReturnLog, lotId, grade, vendor) {
  return (rmReturnLog || []).filter(r => r.lotId === lotId && r.grade === grade && r.vendor === vendor && r.status !== 'Voided')
    .reduce((a, r) => Qadd(a, Q(r.units, r.weight)), Q(0, 0));
}

// The formula itself — matches core.js's getRMBalance and both worker.js
// copies' rmBalance computation exactly (verified byte-for-byte equivalent
// before this file was written, not assumed):
//   RM Balance = (lot's own weight/units) − (approved Soft-in) − (RM returned to vendor)
export function calcRMBalance(lots, stageEntries, rmReturnLog, lotId, grade, vendor) {
  const l = calcLotByKey(lots, lotId, grade, vendor);
  if (!l.id) return Q(0, 0);
  const afterSoft = Qsub(Q(l.units, l.weight), calcSoftIn(stageEntries, lots, lotId, grade, vendor));
  const returned = calcRMReturnedOut(rmReturnLog, lotId, grade, vendor);
  return Qmax0(Qsub(afterSoft, returned));
}

// Jul 17 2026 — real gap found and fixed: RM Return validated against
// Soft's Available balance, not RM's own, even though calcRMBalance is
// what it actually reduces (confirmed directly with Priyam — this was a
// genuine mismatch, not a naming quirk). Built as the WIP-claim-aware
// version of calcRMBalance, matching the same pattern every other
// Available formula uses (calcSoftConsumedByDyeWIP) — subtracts
// material already claimed by a Pending/InProgress Soft entry, since
// that material isn't really available to return even though it hasn't
// been formally approved into Soft yet.
export function calcSoftClaimedWIP(stageEntries, lotId, grade, vendor) {
  return (stageEntries || []).filter(e => e.stage === 'Soft' && (e.status === 'Pending' || e.status === 'InProgress'))
    .reduce((a, e) => {
      const match = e.lotId === lotId && (e.grade === grade || !e.grade || !grade) && (e.vendor === vendor || !e.vendor || !vendor);
      return match ? a + (e.inWeight || 0) : a;
    }, 0);
}
export function calcRMBalanceAvailable(lots, stageEntries, rmReturnLog, lotId, grade, vendor) {
  const base = calcRMBalance(lots, stageEntries, rmReturnLog, lotId, grade, vendor);
  const claimed = calcSoftClaimedWIP(stageEntries, lotId, grade, vendor);
  return Math.max(0, (base.weight || 0) - claimed);
}

// ── Soft Balance and its direct dependencies ────────────────────────────
// Parameterized versions of core.js's getSoftOut/getSoftConsumedByDye/
// getSoftResidualOut/getSoftBalanceWeight.

export function calcSoftOut(stageEntries, lots, scrapLog, lotId, grade, vendor) {
  const l = calcLotByKey(lots, lotId, grade, vendor);
  if (!l.id) return Q(0, 0);
  return appr(stageEntries).filter(e => seMatch(e, l) && e.stage === 'Soft' && e.endTime)
    .reduce((a, e) => {
      const taken = (scrapLog || []).filter(s => s.entryId === e.id && (s.type === 'soft' || s.type === 'residual'))
        .reduce((t, s) => t + (s.weight || 0), 0);
      return Qadd(a, Q(e.outUnits, Math.max(0, (e.outWeight || 0) - taken)));
    }, Q(0, 0));
}

export function calcSoftConsumedByDye(dyeLots, lotId, grade, vendor) {
  // Strict match on all three fields, always — lot+grade+vendor is the
  // complete identity, no exceptions (confirmed directly with Priyam,
  // Jul 13 2026, after a real production case: the old loose match here
  // let a dye lot source with a blank grade/vendor field incorrectly
  // count toward ANY lot sharing just the same lot ID, producing an
  // impossible sentToDye figure — higher than the lot's own Soft Out,
  // which can never happen physically). Matches calculateSummaryFromData's
  // already-correct strict matching (worker.js) — was the one place in
  // the codebase still using the looser version.
  return appr(dyeLots || []).reduce((acc, d) => {
    const src = (d.sources || []).find(s => s.lotId === lotId && s.grade === grade && s.vendor === vendor);
    return acc + (src ? (src.weight || 0) : 0);
  }, 0);
}

export function calcSoftResidualOut(residualLog, lotId, grade, vendor) {
  return (residualLog || []).filter(r => r.lotId === lotId && r.grade === grade && r.vendor === vendor && r.status !== 'Voided')
    .reduce((a, r) => a + (r.weight || 0), 0);
}

// Soft Balance = (approved Soft-out weight) − (approved Dye-consumed) − (Residual/Scrap out)
// Matches core.js's getSoftBalanceWeight exactly.
export function calcSoftBalanceWeight(stageEntries, lots, scrapLog, dyeLots, residualLog, lotId, grade, vendor) {
  const softOut = calcSoftOut(stageEntries, lots, scrapLog, lotId, grade, vendor);
  const dyeConsumed = calcSoftConsumedByDye(dyeLots, lotId, grade, vendor);
  const residualOut = calcSoftResidualOut(residualLog, lotId, grade, vendor);
  return Math.max(0, softOut.weight - dyeConsumed - residualOut);
}

// ── Dye/Wind/Pack Balance — dye-lot-anchored (Family A) ──────────────────
// This is the family actually used for LIVE validation: Wind Start's
// dropdown + submit, Pack's dropdown + submit, Dispatch's dropdown + submit.
// Getting this one right is the highest-stakes part of the whole
// consolidation, since a wrong "available" number here is what actually
// lets material get double-booked. Matches core.js's getDyeBal/getWindBal/
// getPackBal AND worker.js's calculateDyeLotSummary — verified both were
// already computing the same thing (inCones-with-outCones-fallback for
// wind-in, inCones for pack-in) before this file existed, with ONE real
// discrepancy found and fixed here: worker.js's packBalance.bags used a
// weight-ratio scaling estimate instead of a direct bags subtraction —
// physically wrong for a countable, whole-number quantity like bags (not
// user-visible, since the client never read that cached field — but it
// fed worker.js's own fullyDispatched/archival check, so still fixed).

export function calcDyeBal(dyeLots, windEntries, dyeLotId) {
  const lot = (dyeLots || []).find(d => d.id === dyeLotId);
  if (!lot || !(lot.status === 'Approved' || lot.status === 'Edited-Approved')) return Q(0, 0);
  const outCones = lot.outCones || 0;
  const outWeight = lot.outWeight || 0;
  const related = appr(windEntries || []).filter(e => e.dyeLotId === dyeLotId);
  const windInCones = related.reduce((a, e) => a + (e.inCones != null ? e.inCones : e.outCones || 0), 0);
  const windInWeight = related.reduce((a, e) => a + (e.inWeight || 0), 0);
  return Q(Math.max(0, outCones - windInCones), Math.max(0, outWeight - windInWeight));
}

export function calcTotalPackedApproved(packEntries, dyeLotId) {
  const entries = appr(packEntries || []).filter(e => e.dyeLotId === dyeLotId);
  return {
    weight: entries.reduce((a, e) => a + (e.weight || 0), 0),
    weightIn: entries.reduce((a, e) => a + (e.inWeight || 0), 0),
    bags: entries.reduce((a, e) => a + (e.bags || 0), 0),
    cones: entries.reduce((a, e) => a + (e.inCones || 0), 0),
  };
}

export function calcWindBal(windEntries, packEntries, dyeLotId) {
  const related = appr(windEntries || []).filter(e => e.dyeLotId === dyeLotId && e.endTime && e.status !== 'Voided');
  const windOutCones = related.reduce((a, e) => a + (e.outCones || 0), 0);
  const windOutWeight = related.reduce((a, e) => a + (e.outWeight || 0), 0);
  const packed = calcTotalPackedApproved(packEntries, dyeLotId);
  return Q(Math.max(0, windOutCones - (packed.cones || 0)), Math.max(0, windOutWeight - packed.weightIn));
}

// Jul 10 2026: takes an optional dyeLots array for a legacy fallback match
// (dispatches without a direct dyeLotId, matched via an old d.lotId cross-
// reference against the dye lot's sources). Verified via the actual
// dispatch-creation code that CURRENT dispatches always carry a direct
// dyeLotId — this fallback exists only for older/legacy records that might
// predate that being consistently set. Kept deliberately, even though new
// data never needs it: removing it risks silently losing dispatch
// attribution for old data this session has no way to inspect directly.
// dyeLots is optional — omit it and the fallback is simply skipped.
export function calcTotalDispatchedApproved(dispatches, dyeLotId, dyeLots) {
  const entries = appr(dispatches || []).filter(d =>
    d.dyeLotId === dyeLotId ||
    (d.dyeLotId === undefined && d.lotId && (dyeLots || []).some(dl => dl.id === dyeLotId && (dl.sources || []).some(s => s.lotId === d.lotId)))
  );
  return {
    weight: entries.reduce((a, d) => a + (d.weight || 0), 0),
    bags: entries.reduce((a, d) => a + (d.bags || d.units || 0), 0),
  };
}

// packBags uses a direct subtraction (packed bags − dispatched bags), not a
// weight-ratio scaling estimate — bags are a countable whole-number unit,
// scaling by weight ratio produces a physically wrong estimate. This is the
// one real discrepancy found between core.js and worker.js during this
// consolidation (worker.js previously used the scaling estimate).
export function calcPackBal(packEntries, dispatches, dyeLotId) {
  const packed = calcTotalPackedApproved(packEntries, dyeLotId);
  const disp = calcTotalDispatchedApproved(dispatches, dyeLotId);
  return { weight: Math.max(0, packed.weight - disp.weight), bags: Math.max(0, packed.bags - disp.bags) };
}

// ── Dispatched (dye-lot-anchored) ────────────────────────────────────────
// core.js's getTotalDispatched(dyeLotId) and worker.js's
// calculateDyeLotSummary each had a DIFFERENT fallback for matching
// dispatches without a direct dyeLotId match (core.js checked a legacy
// d.lotId cross-reference; worker.js checked a e.lots[] array) — verified
// against the actual dispatch-creation code (submitDispatch and every
// dispatch mutation site in pages.js) that dispatches always carry a
// direct, single dyeLotId field; neither fallback reflects real current
// data. Using the simple, confirmed-correct direct match only — this is
// exactly calcTotalDispatchedApproved (already built above for Pack
// Balance), reused directly rather than adding a near-duplicate function.

// ── RM-lot-anchored proportional family (Family B) — Jul 10 2026 ────────
// Used by the Lot Lifecycle / Vendor Tracker reports, and the underlying
// status-label / flow-progress-bar logic. Follows the "this stage's own
// OUTPUT minus the NEXT stage's INPUT" rule, verified as the correct
// pattern (confirmed against real business logic: what's genuinely still
// sitting at this stage = what came out of it, minus what's already moved
// into whatever comes next — never compared against a stage two steps
// away). worker.js's calculateLotSummary/calculateSummaryFromData
// previously skipped a step (Dye Balance compared against Wind's OUTPUT
// instead of Wind's INPUT; Wind Balance compared against Pack's OUTPUT
// instead of Pack's INPUT) — confirmed via real production data as a
// genuine, currently-existing discrepancy for 44+ real lots (Wind Balance
// specifically), even though the affected report screen for Wind/Pack was
// never fully built out, so it wasn't yet visibly reaching users.
//
// getVendorRatioForDyeLot: how much of a dye lot's total input belongs to
// this specific RM lot — the proportional split key used throughout.
export function calcVendorRatioForDyeLot(dyeLot, lotId, grade, vendor) {
  const src = (dyeLot.sources || []).find(s => s.lotId === lotId && (!grade || s.grade === grade || !s.grade) && (!vendor || s.vendor === vendor || !s.vendor));
  if (!src || !dyeLot.totalInWeight) return 0;
  return src.weight / dyeLot.totalInWeight;
}

// Dye's own output, proportionally allocated to this RM lot.
export function calcDyeAllocated(dyeLots, lotId, grade, vendor) {
  return appr(dyeLots || []).reduce((acc, d) => {
    const ratio = calcVendorRatioForDyeLot(d, lotId, grade, vendor);
    if (!ratio) return acc;
    return Qadd(acc, Q(Math.round((d.outCones || 0) * ratio), (d.outWeight || 0) * ratio));
  }, Q(0, 0));
}

// Wind's input, proportionally allocated to this RM lot (via its dye lots).
export function calcWindInAllocated(dyeLots, windEntries, lotId, grade, vendor) {
  const related = appr(dyeLots || []).filter(d => calcVendorRatioForDyeLot(d, lotId, grade, vendor) > 0);
  return related.reduce((acc, d) => {
    const ratio = calcVendorRatioForDyeLot(d, lotId, grade, vendor);
    const windIn = appr(windEntries || []).filter(e => e.dyeLotId === d.id).reduce((a, e) => Qadd(a, Q(e.inCones || 0, e.inWeight || 0)), Q(0, 0));
    return Qadd(acc, Q(Math.round(windIn.units * ratio), windIn.weight * ratio));
  }, Q(0, 0));
}

// Wind's own output, proportionally allocated.
export function calcWindOutAllocated(dyeLots, windEntries, lotId, grade, vendor) {
  const related = appr(dyeLots || []).filter(d => calcVendorRatioForDyeLot(d, lotId, grade, vendor) > 0);
  return related.reduce((acc, d) => {
    const ratio = calcVendorRatioForDyeLot(d, lotId, grade, vendor);
    const windOut = appr(windEntries || []).filter(e => e.dyeLotId === d.id && e.endTime).reduce((a, e) => Qadd(a, Q(e.outCones || 0, e.outWeight || 0)), Q(0, 0));
    return Qadd(acc, Q(Math.round(windOut.units * ratio), windOut.weight * ratio));
  }, Q(0, 0));
}

// Pack's input, proportionally allocated.
export function calcPackInAllocated(dyeLots, packEntries, lotId, grade, vendor) {
  const related = appr(dyeLots || []).filter(d => calcVendorRatioForDyeLot(d, lotId, grade, vendor) > 0);
  return related.reduce((acc, d) => {
    const ratio = calcVendorRatioForDyeLot(d, lotId, grade, vendor);
    const packIn = (packEntries || []).filter(e => e.dyeLotId === d.id && (e.status === 'Approved' || e.status === 'Edited-Approved')).reduce((a, e) => Qadd(a, Q(e.inCones || 0, e.inWeight || 0)), Q(0, 0));
    return Qadd(acc, Q(Math.round(packIn.units * ratio), packIn.weight * ratio));
  }, Q(0, 0));
}

// Jul 29 2026 — the missing piece Priyam identified: proportional
// tracking existed all the way from Dye through Pack, but never took
// the final step into Dispatch. This closes that gap, same exact
// pattern as calcPackInAllocated above — for every Dye batch this RM
// lot contributed to, find its real share, then apply that share to
// whatever was ACTUALLY dispatched for that batch (reusing
// calcTotalDispatchedApproved, the same real, already-proven dispatch
// total used everywhere else in the app). This correctly captures a
// Dye batch that got split across multiple different dispatches, to
// multiple different parties — each one gets this RM lot's true share
// applied individually, then all of them sum together correctly. Real
// waste and gain are automatically included too, since this always
// uses the actual dispatched weight, never a theoretical "if nothing
// changed" number.
export function calcDispatchAllocated(dyeLots, dispatches, lotId, grade, vendor) {
  const related = appr(dyeLots || []).filter(d => calcVendorRatioForDyeLot(d, lotId, grade, vendor) > 0);
  return related.reduce((acc, d) => {
    const ratio = calcVendorRatioForDyeLot(d, lotId, grade, vendor);
    const dispatched = calcTotalDispatchedApproved(dispatches, d.id, dyeLots);
    return Qadd(acc, Q(Math.round((dispatched.bags || 0) * ratio), (dispatched.weight || 0) * ratio));
  }, Q(0, 0));
}

// Dye Balance (RM-lot-anchored) = Dye's own output − Wind's input. This is
// the formula. The one-line fix for the found bug.
export function calcDyeBalanceByLot(dyeLots, windEntries, lotId, grade, vendor) {
  return Qmax0(Qsub(calcDyeAllocated(dyeLots, lotId, grade, vendor), calcWindInAllocated(dyeLots, windEntries, lotId, grade, vendor)));
}

// Wind Balance (RM-lot-anchored) = Wind's own output − Pack's input.
export function calcWindBalanceByLot(dyeLots, windEntries, packEntries, lotId, grade, vendor) {
  return Qmax0(Qsub(calcWindOutAllocated(dyeLots, windEntries, lotId, grade, vendor), calcPackInAllocated(dyeLots, packEntries, lotId, grade, vendor)));
}

// ── "AVAILABLE" formulas — Jul 10 2026, added after being missed in the
// original consolidation pass. This is the layer that actually prevents
// double-booking: each one is a Balance (above) minus whatever is
// currently sitting in a Pending or InProgress entry one stage ahead —
// material that's not yet approved, but already claimed by someone else's
// in-flight work. Confirmed: worker.js has no independent copy of any of
// these 5 — they exist only client-side, so there was never a 3-copies-
// drift risk for this layer specifically. They're being centralized here
// anyway, for genuine single-source-of-truth consistency and so any future
// server-side need for these (e.g. a live validation move to the Worker)
// starts from one correct place instead of a fresh reimplementation.
//
// All 5 confirmed, by direct reading of the original code before this
// consolidation, to use an explicit status==='Pending'||status==='InProgress'
// whitelist for what counts as "claimed" — never a loose "not voided"
// style filter. Voided and Rejected entries are correctly never counted.

// Dye Available = Dye Balance (dye-lot-anchored) − Pending/InProgress Wind claims.
export function calcDyeBalAvailable(dyeLots, windEntries, dyeLotId) {
  const bal = calcDyeBal(dyeLots, windEntries, dyeLotId);
  const claimed = (windEntries || []).filter(e => e.dyeLotId === dyeLotId && (e.status === 'Pending' || e.status === 'InProgress'))
    .reduce((a, e) => Qadd(a, Q(e.inCones || 0, e.inWeight || 0)), Q(0, 0));
  return Qmax0(Qsub(bal, claimed));
}

// Wind Available = Wind Balance (dye-lot-anchored) − Pending/InProgress Pack claims.
export function calcWindBalAvailable(windEntries, packEntries, dyeLotId) {
  const bal = calcWindBal(windEntries, packEntries, dyeLotId);
  const claimed = (packEntries || []).filter(e => e.dyeLotId === dyeLotId && (e.status === 'Pending' || e.status === 'InProgress'))
    .reduce((a, e) => Qadd(a, Q(e.inCones || 0, e.inWeight || 0)), Q(0, 0));
  return Qmax0(Qsub(bal, claimed));
}

// Pack Available = Pack Balance (dye-lot-anchored) − Pending/InProgress Dispatch claims.
// Returns Q-shape {units,weight} — matches the ORIGINAL getPackBalAvailable
// exactly (it wrapped its result in Q(...), not the {weight,bags} shape
// calcPackBal itself uses). Caught by Layer 3 before shipping: an earlier
// version of this function returned {weight,bags} instead, which would
// have broken the Dispatch dropdown's filter (`.units>0`) for every single
// dye lot, silently showing zero available lots to dispatch.
export function calcPackBalAvailable(packEntries, dispatches, dyeLotId) {
  const bal = calcPackBal(packEntries, dispatches, dyeLotId);
  const claimed = (dispatches || []).filter(d => d.dyeLotId === dyeLotId && (d.status === 'Pending' || d.status === 'InProgress'))
    .reduce((a, d) => ({ bags: a.bags + (d.bags || 0), weight: a.weight + (d.weight || 0) }), { bags: 0, weight: 0 });
  return Q(Math.max(0, bal.bags - claimed.bags), Math.max(0, bal.weight - claimed.weight));
}

// RM Available (the 'Soft' branch of getStageBalanceAvailable — the only
// branch ever actually called with real data; the Wind/Pack/Dispatch
// branches of the original dispatcher were dead code, confirmed by
// checking every call site before writing this).
export function calcStageBalanceAvailable(lots, stageEntries, rmReturnLog, lotId, grade, vendor) {
  const bal = calcRMBalance(lots, stageEntries, rmReturnLog, lotId, grade, vendor);
  const claimed = (stageEntries || []).filter(e => e.lotId === lotId && (!grade || e.grade === grade) && (!vendor || e.vendor === vendor) && e.stage === 'Soft' && (e.status === 'Pending' || e.status === 'InProgress'))
    .reduce((a, e) => Qadd(a, Q(e.inUnits || 0, e.inWeight || 0)), Q(0, 0));
  return Qmax0(Qsub(bal, claimed));
}

// Soft Available (weight-only, matching calcSoftBalanceWeight's own shape).
export function calcSoftConsumedByDyeWIP(dyeLots, lotId, grade, vendor) {
  return (dyeLots || []).filter(d => d.status === 'Pending' || d.status === 'InProgress').reduce((acc, d) => {
    const src = (d.sources || []).find(s => s.lotId === lotId && (s.grade === grade || !s.grade || !grade) && (s.vendor === vendor || !s.vendor || !vendor));
    return acc + (src ? (src.weight || 0) : 0);
  }, 0);
}
export function calcSoftBalanceWeightAvailable(stageEntries, lots, scrapLog, dyeLots, residualLog, lotId, grade, vendor) {
  const approvedBal = calcSoftBalanceWeight(stageEntries, lots, scrapLog, dyeLots, residualLog, lotId, grade, vendor);
  const wipClaimed = calcSoftConsumedByDyeWIP(dyeLots, lotId, grade, vendor);
  return Math.max(0, approvedBal - wipClaimed);
}
// Soft Available, {units, weight} shape (matching core.js's getSoftBalanceAvailable).
export function calcSoftBalanceAvailable(stageEntries, lots, scrapLog, dyeLots, residualLog, softBalanceQ, lotId, grade, vendor) {
  const wipClaimedKg = calcSoftConsumedByDyeWIP(dyeLots, lotId, grade, vendor);
  const balKg = Math.max(0, (softBalanceQ.weight || 0) - wipClaimedKg);
  const balUnits = softBalanceQ.weight > 0 ? Math.round((softBalanceQ.units || 0) * (balKg / softBalanceQ.weight)) : 0;
  return Q(balUnits, balKg);
}

// ── Report aggregation formulas (Jul 12 2026) ──────────────────────────────
// Used identically by worker.js's recomputeReportSummaries (All Time, merged
// active+archive, no date filter) and pages.js's live rptFlow/rptMachine/
// rptWorker/rptShade (Week/Month, active only, date-range filtered). Callers
// do their own status/date filtering BEFORE calling these — these functions
// only aggregate whatever array they're handed. One formula, two callers,
// per the shared-balances.js consolidation principle (see file header).
function _hrsBetweenShared(start, end) {
  if (!start || !end) return 0;
  const h = (new Date(end) - new Date(start)) / 36e5;
  return isFinite(h) && h > 0 ? h : 0;
}

export function calcFlowTotals(stageEntries, dyeLots, windEntries, packEntries, dispatches) {
  const softE = (stageEntries || []).filter(e => e.stage === 'Soft' && e.endTime);
  const softIn = { bags: softE.reduce((a,e)=>a+(e.inUnits||0),0), kg: softE.reduce((a,e)=>a+(e.inWeight||0),0) };
  const softOut = { bags: softE.reduce((a,e)=>a+(e.outUnits||0),0), kg: softE.reduce((a,e)=>a+(e.outWeight||0),0) };
  const softWaste = { bags: softIn.bags-softOut.bags, kg: softIn.kg-softOut.kg };
  const softHrs = softE.reduce((a,e)=>a+_hrsBetweenShared(e.startTime,e.endTime),0);

  const dyeL = (dyeLots || []).filter(d => d.endTime);
  const dyeIn = { cones: dyeL.reduce((a,d)=>a+(d.totalInCones||0),0), kg: dyeL.reduce((a,d)=>a+(d.totalInWeight||0),0) };
  const dyeOut = { cones: dyeL.reduce((a,d)=>a+(d.outCones||0),0), kg: dyeL.reduce((a,d)=>a+Math.min(d.outWeight||0,d.totalInWeight||d.outWeight||0),0) };
  const dyeGain = dyeOut.kg - dyeIn.kg;
  const dyeHrs = dyeL.reduce((a,d)=>a+_hrsBetweenShared(d.startTime,d.endTime),0);

  const windE = (windEntries || []).filter(e => e.endTime);
  const windIn = { cones: windE.reduce((a,e)=>a+(e.inCones||0),0), kg: windE.reduce((a,e)=>a+(e.inWeight||0),0) };
  const windOut = { cones: windE.reduce((a,e)=>a+(e.outCones||0),0), kg: windE.reduce((a,e)=>a+(e.outWeight||0),0) };
  const windWaste = { cones: windIn.cones-windOut.cones, kg: windIn.kg-windOut.kg };
  const windHrs = windE.reduce((a,e)=>a+_hrsBetweenShared(e.startTime,e.endTime),0);

  const packIn = { cones: (packEntries||[]).reduce((a,e)=>a+(e.inCones||0),0) };
  const packOut = { bags: (packEntries||[]).reduce((a,e)=>a+(e.bags||0),0), kg: (packEntries||[]).reduce((a,e)=>a+(e.weight||0),0) };
  const dispOut = { bags: (dispatches||[]).reduce((a,d)=>a+(d.bags||0),0), kg: (dispatches||[]).reduce((a,d)=>a+(d.weight||0),0) };

  return { softIn, softOut, softWaste, softHrs, softEntriesCount: softE.length,
           dyeIn, dyeOut, dyeGain, dyeHrs, dyeLotsCount: dyeL.length,
           windIn, windOut, windWaste, windHrs, windEntriesCount: windE.length,
           packIn, packOut, packEntriesCount: (packEntries||[]).length,
           dispOut, dispatchesCount: (dispatches||[]).length };
}

export function calcMachineTotals(stageEntries, dyeLots, windEntries) {
  const d = {};
  const add = (key, base) => { if(!d[key]) d[key] = base; return d[key]; };
  (stageEntries||[]).filter(e=>e.stage==='Soft'&&e.endTime).forEach(e => { const k=(e.machine||'—')+'||Soft'; const r=add(k,{m:e.machine||'—',stage:'Soft',inKg:0,outKg:0,wasteKg:0,inBags:0,outBags:0,hrs:0,runs:0}); r.inBags+=(e.inUnits||0);r.outBags+=(e.outUnits||0);r.inKg+=(e.inWeight||0);r.outKg+=(e.outWeight||0);r.wasteKg+=(e.wasteWeight||0);r.hrs+=_hrsBetweenShared(e.startTime,e.endTime);r.runs++; });
  (dyeLots||[]).filter(d2=>d2.endTime).forEach(e => { const k=(e.machine||'—')+'||Dye'; const r=add(k,{m:e.machine||'—',stage:'Dye',inKg:0,outKg:0,wasteKg:0,inBags:0,outBags:0,hrs:0,runs:0}); r.inKg+=(e.totalInWeight||0);r.outKg+=(e.outWeight||0);r.wasteKg+=Math.max(0,(e.totalInWeight||0)-(e.outWeight||0));r.hrs+=_hrsBetweenShared(e.startTime,e.endTime);r.runs++; });
  (windEntries||[]).filter(e=>e.endTime).forEach(e => { const k=(e.machine||'—')+'||Wind'; const r=add(k,{m:e.machine||'—',stage:'Wind',inKg:0,outKg:0,wasteKg:0,inBags:0,outBags:0,hrs:0,runs:0}); r.inKg+=(e.inWeight||0);r.outKg+=(e.outWeight||0);r.wasteKg+=Math.max(0,(e.inWeight||0)-(e.outWeight||0));r.hrs+=_hrsBetweenShared(e.startTime,e.endTime);r.runs++; });
  return d;
}

export function calcWorkerTotals(stageEntries, dyeLots, windEntries, packEntries) {
  const d = {};
  const add = (key, base) => { if(!d[key]) d[key] = base; return d[key]; };
  (stageEntries||[]).filter(e=>e.stage==='Soft'&&e.endTime).forEach(e => { const w=e.endWorker||e.startWorker||'—'; const k=w+'||Soft'; const r=add(k,{w,stage:'Soft',inKg:0,outKg:0,wasteKg:0,outBags:0,hrs:0,runs:0}); r.inKg+=(e.inWeight||0);r.outKg+=(e.outWeight||0);r.outBags+=(e.outUnits||0);r.wasteKg+=(e.wasteWeight||0);r.hrs+=_hrsBetweenShared(e.startTime,e.endTime);r.runs++; });
  (dyeLots||[]).filter(d2=>d2.endTime).forEach(e => { const w=e.endWorker||e.startWorker||'—'; const k=w+'||Dye'; const r=add(k,{w,stage:'Dye',inKg:0,outKg:0,wasteKg:0,outBags:0,hrs:0,runs:0}); r.inKg+=(e.totalInWeight||0);r.outKg+=(e.outWeight||0);r.wasteKg+=Math.max(0,(e.totalInWeight||0)-(e.outWeight||0));r.hrs+=_hrsBetweenShared(e.startTime,e.endTime);r.runs++; });
  (windEntries||[]).filter(e=>e.endTime).forEach(e => { const w=e.startWorker||'—'; const k=w+'||Wind'; const r=add(k,{w,stage:'Wind',inKg:0,outKg:0,wasteKg:0,outBags:0,hrs:0,runs:0}); r.inKg+=(e.inWeight||0);r.outKg+=(e.outWeight||0);r.wasteKg+=Math.max(0,(e.inWeight||0)-(e.outWeight||0));r.hrs+=_hrsBetweenShared(e.startTime,e.endTime);r.runs++; });
  (packEntries||[]).forEach(e => { const w=e.worker||'—'; const k=w+'||Pack'; const r=add(k,{w,stage:'Pack',inKg:0,outKg:0,wasteKg:0,outBags:0,hrs:0,runs:0}); r.outKg+=(e.weight||0);r.outBags+=(e.bags||0);r.runs++; });
  return d;
}

// Category 2 (Jul 12 2026): per-day totals, mirrors rptDaily's addDay bucketing
// exactly. Callers pre-filter by status; this only buckets by date and sums.
export function calcDailyTotals(stageEntries, dyeLots, windEntries, packEntries, dispatches) {
  const d = {};
  const addDay = (ts, kg, type) => {
    if (!ts) return;
    const dt = (ts || '').split('T')[0];
    if (!dt) return;
    if (!d[dt]) d[dt] = { soft: 0, dye: 0, wind: 0, pack: 0, disp: 0, waste: 0 };
    d[dt][type] += kg;
  };
  (stageEntries || []).filter(e => e.endTime).forEach(e => { addDay(e.endTime, e.outWeight || 0, 'soft'); addDay(e.endTime, e.wasteWeight || 0, 'waste'); });
  (dyeLots || []).filter(l => l.endTime).forEach(l => addDay(l.endTime, l.outWeight || 0, 'dye'));
  (windEntries || []).filter(e => e.endTime).forEach(e => addDay(e.endTime, e.outWeight || 0, 'wind'));
  (packEntries || []).forEach(e => addDay(e.timestamp, e.weight || 0, 'pack'));
  (dispatches || []).forEach(e => addDay(e.timestamp, e.weight || 0, 'disp'));
  return d;
}

export function calcShadeTotals(dyeLots, packEntries, dispatches) {
  const shade = {};
  (dyeLots||[]).filter(d=>d.endTime).forEach(d => {
    const s = d.shade || 'Unknown';
    if(!shade[s]) shade[s] = { shade:s, lots:0, inKg:0, outKg:0, dispatched:0, dispBags:0, pending:0, parties:[] };
    const r = shade[s];
    r.lots++; r.inKg += d.totalInWeight||0; r.outKg += d.outWeight||0;
    // Reuses calcTotalDispatchedApproved (already handles Approved-status filtering
    // and the dyeLotId-missing/lotId-via-sources[] fallback match) instead of
    // re-filtering dispatches by hand here — avoids a second copy drifting from
    // the proven formula (Jul 12 2026 fix, caught before this shipped to pages.js).
    const td = calcTotalDispatchedApproved(dispatches, d.id, dyeLots);
    r.dispatched += td.weight||0; r.dispBags += td.bags||0;
    const gainKg = (packEntries||[]).filter(p=>p.dyeLotId===d.id&&p.status!=='Voided').reduce((a,p)=>a+(p.gainKg||0),0);
    r.pending += Math.max(0,(d.outWeight||0)+gainKg-(td.weight||0));
    appr(dispatches||[]).filter(x=>x.dyeLotId===d.id).forEach(x=>{ if(x.party && !r.parties.includes(x.party)) r.parties.push(x.party); });
  });
  return shade;
}

// Jul 15 2026 — Item Q (medium tier). Extracted verbatim from core.js's
// getDeadStockBalance/getRecycleBalance so worker.js's new scrap-submit
// endpoint (POST /api/scrap) can validate against the exact same formula
// the client displays, instead of trusting the client-computed balance
// submitScrap() used to send.
export function calcDeadStockBalance(deadStock, dyeLots, stageEntries, scrapLog, id) {
  const ds = (deadStock || []).find(x => x.id === id);
  if (!ds) return 0;
  const usedInDye = (dyeLots || []).filter(d => d.status !== 'Rejected' && d.status !== 'Void' && d.status !== 'Voided')
    .reduce((a, d) => { const src = (d.sources || []).find(s => s.deadStockId === id && s.sourceType === 'dead'); return a + (src?.weight || 0); }, 0);
  const usedInSoft = (stageEntries || []).filter(e => e.deadStockId === id && e.status !== 'Void' && e.status !== 'Rejected')
    .reduce((a, e) => a + (e.inWeight || 0), 0);
  const scrapped = (scrapLog || []).filter(s => s.entryId === id && s.type === 'dead' && s.status !== 'Voided').reduce((a, s) => a + (s.weight || 0), 0);
  return Math.max(0, (ds.weight || 0) - usedInDye - usedInSoft - scrapped);
}

// Jul 15 2026 — Priyam confirmed: recycle scrap should deduct from
// balance the same way dead stock scrap already does. Was previously
// flagged as an inconsistency, not fixed unasked; now built to match
// calcDeadStockBalance's pattern exactly. Also added the missing
// usedInSoft deduction (recycle material can be consumed directly via
// Soft, same as dead stock — handleStageStart accepts recycleId — this
// was the one remaining gap between the two formulas, confirmed real in
// the code path though never yet exercised in production data).
export function calcRecycleBalance(recycleStock, dyeLots, stageEntries, scrapLog, rcId) {
  const rc = (recycleStock || []).find(r => r.id === rcId);
  if (!rc) return 0;
  const consumed = (dyeLots || []).filter(d => d.status !== 'Rejected' && d.status !== 'Void' && d.status !== 'Voided')
    .reduce((acc, d) => { const src = (d.sources || []).find(s => s.recycleId === rcId && s.sourceType === 'recycle'); return acc + (src ? src.weight : 0); }, 0);
  const usedInSoft = (stageEntries || []).filter(e => e.recycleId === rcId && e.status !== 'Void' && e.status !== 'Rejected')
    .reduce((a, e) => a + (e.inWeight || 0), 0);
  const scrapped = (scrapLog || []).filter(s => s.entryId === rcId && s.type === 'recycle' && s.status !== 'Voided').reduce((a, s) => a + (s.weight || 0), 0);
  return Math.max(0, (rc.weight || 0) - consumed - usedInSoft - scrapped);
}

// Jul 29 2026 — extracted from the calculation that used to live only
// inline inside handleDyeStart (worker.js), never a proper shared
// function. Built for handleVoidResidualTransfer's real safety check:
// residualStock is a pooled bucket (multiple transfers from different
// lots can feed the same grade's bucket), and that bucket can already be
// partially consumed by a real Dye Start before anyone tries to void one
// specific contribution — this is the single source of truth both
// places now use, not two separate copies of the same formula.
export function calcResidualStockBalance(residualStock, dyeLots, rsId) {
  const rs = (residualStock || []).find(r => r.id === rsId);
  if (!rs) return 0;
  const used = (dyeLots || []).filter(d => d.status !== 'Rejected' && d.status !== 'Void' && d.status !== 'Voided')
    .reduce((a, d) => { const s = (d.sources || []).find(s => s.residualId === rsId); return a + (s?.weight || 0); }, 0);
  return Math.max(0, (rs.weight || 0) - used);
}

