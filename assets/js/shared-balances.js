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

// Jul 29 2026 — Phase 2 of the RM permanent-ID plan. The new, stable
// way to find a lot — by its permanent uid, not by rebuilding an
// identity from lot+grade+vendor text (the exact fragility that caused
// real problems earlier this session). Sits alongside calcLotByKey,
// nothing switched over to use this yet — that's Phase 3, one place
// at a time, each one fully tested against real data before moving to
// the next.
export function calcLotByUid(lots, uid) {
  if (!uid) return {};
  return (lots || []).find(l => l.uid === uid) || {};
}

export function calcSoftIn(stageEntries, lots, lotId, grade, vendor) {
  const l = calcLotByKey(lots, lotId, grade, vendor);
  if (!l.id) return Q(0, 0);
  return appr(stageEntries).filter(e => seMatch(e, l) && e.stage === 'Soft')
    .reduce((a, e) => Qadd(a, Q(e.inUnits, e.inWeight)), Q(0, 0));
}

export function calcRMReturnedOut(rmReturnLog, lotId, grade, vendor) {
  // Aug 26 2026 — real, live bug found via direct discussion with
  // Priyam: a real-time Firebase update can momentarily deliver
  // rmReturnLog as its raw, keyed-by-ID object shape instead of an
  // array, breaking every caller with "filter is not a function".
  // Same defensive conversion already used throughout this file for
  // exactly this reason — genuinely safe regardless of which shape
  // arrives.
  const arr = Array.isArray(rmReturnLog) ? rmReturnLog : (rmReturnLog ? Object.values(rmReturnLog) : []);
  return arr.filter(r => r && r.lotId === lotId && r.grade === grade && r.vendor === vendor && r.status !== 'Voided')
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
  // Aug 26 2026 — real, deliberate change, matching the exact same
  // real principle already established for calcSoftBalanceWeight,
  // after Priyam directly, correctly insisted on it here too: no
  // floor, anywhere, no exceptions — a real, existing problem lot
  // should show its true, honest negative number, not a deceptively
  // normal-looking 0.
  return Qsub(afterSoft, returned);
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
  // Aug 26 2026 — real, deliberate removal of the floor, per Priyam's
  // explicit instruction: no exceptions, anywhere.
  return (base.weight || 0) - claimed;
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
  // Sep 10 2026 — real, deeper gap Priyam caught directly: a dye lot's
  // sources aren't only RM — Dead Stock, Recycle, and Residual sources
  // exist too, and genuinely have no lotId or vendor field at all
  // (confirmed against real data). If lotId/vendor are ever undefined
  // here (a bug elsewhere, or an incomplete call), undefined ===
  // undefined would still match one of those non-RM sources sharing
  // the same grade text. Requiring sourceType === 'rm' explicitly
  // means this can only ever match a genuine RM source.
  return appr(dyeLots || []).reduce((acc, d) => {
    const src = (d.sources || []).find(s => s.sourceType === 'rm' && s.lotId === lotId && s.grade === grade && s.vendor === vendor);
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
  // Aug 2026 — real, deliberate change after direct, correct pushback from
  // Priyam: this was clamped to a floor of 0, same as every other
  // "Available" function — but this one isn't an "available to claim"
  // number, it's a display/reporting one. Clamping it hid the true
  // severity of a real, existing problem — a lot with more claimed
  // against it than it ever genuinely produced showed as a deceptively
  // normal-looking 0 instead of the honest, true negative number.
  // calcSoftBalanceWeightAvailable (below) already has its own,
  // independent floor at 0 for the cases that genuinely need one —
  // removing it here doesn't touch that.
  return softOut.weight - dyeConsumed - residualOut;
}

// Aug 19 2026 — real, shared bags-balance function, built via direct
// discussion with Priyam: bags math was being written separately, by
// hand, in 2 different places (the live "available" dropdown, and the
// edit preview), risking exactly the kind of quiet drift this whole
// file exists to prevent. One real function now, matching the same
// real proportional rule already established for weight (kg AND bags
// deducted proportionally from Soft balance) — reused everywhere.
// Real, honest limit: neither Dye's sources nor the residual log track
// bags directly, only weight — so both are converted using the same,
// single, real ratio, not two different assumptions.
// Aug 19 2026 — real, tiny, shared piece of math, built via direct
// discussion with Priyam: the same proportional rule (bags moved
// proportionally to weight) was being written by hand in 2 places —
// the live "available" dropdown (reads cached summary data, many lots
// at once) and the edit preview (computes fresh, one lot at a time).
// They can't share the same outer function, since their inputs
// genuinely differ — but the actual core formula is now this one,
// single, real piece, used by both, so it can never quietly diverge.
export function proportionalUnits(totalUnits, totalWeight, targetWeight) {
  if (!totalWeight) return 0;
  return Math.round(totalUnits * (targetWeight / totalWeight));
}

export function calcSoftBalanceUnits(stageEntries, lots, scrapLog, dyeLots, residualLog, lotId, grade, vendor) {
  const softOut = calcSoftOut(stageEntries, lots, scrapLog, lotId, grade, vendor);
  if (!softOut.weight || !softOut.units) return softOut.units || 0;
  const dyeConsumed = calcSoftConsumedByDye(dyeLots, lotId, grade, vendor);
  const residualOut = calcSoftResidualOut(residualLog, lotId, grade, vendor);
  const consumedWeight = dyeConsumed + residualOut;
  const consumedUnits = proportionalUnits(softOut.units, softOut.weight, consumedWeight);
  return softOut.units - consumedUnits;
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
  // Sep 19 2026 — Recycle Phase 1: Dye Split now records the OFF cones (recycleCones) as well as the off kg, so the good side loses both.
  // Without this Wind would see too many cones for the good part. recycleCones is undefined/0 on every lot that was never split.
  const outCones = (lot.outCones || 0) - (lot.recycleCones || 0);
  // Aug 6 2026 — real, confirmed gap found via discussion with Priyam:
  // when a dye lot's output gets split (good vs recycle), recycleWeight
  // gets recorded on the lot itself, but this formula never subtracted
  // it — meaning Dye Balance (and calcDyeBalAvailable, which is built
  // directly on top of this function) overstated what was genuinely
  // still available for Wind by exactly the recycled amount. Recycle is
  // weight-only (confirmed: no cones field ever recorded for it), so
  // only the weight side needs this subtraction. recycleWeight is
  // undefined/0 for the vast majority of dye lots that were never split,
  // so this is safe and backward-compatible everywhere else.
  // Aug 26 2026 — real, deliberate, complete removal of every floor in
  // this function, per Priyam's own, explicit instruction: no
  // exceptions, anywhere. A genuinely over-claimed dye lot should show
  // its true, honest negative number here too.
  const outWeight = (lot.outWeight || 0) - (lot.recycleWeight || 0);
  const related = appr(windEntries || []).filter(e => e.dyeLotId === dyeLotId);
  const windInCones = related.reduce((a, e) => a + (e.inCones != null ? e.inCones : e.outCones || 0), 0);
  const windInWeight = related.reduce((a, e) => a + (e.inWeight || 0), 0);
  return Q(outCones - windInCones, outWeight - windInWeight);
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
  // Aug 26 2026 — real, deliberate removal of the floor here too, per
  // Priyam's explicit instruction: no exceptions, anywhere.
  return Q(windOutCones - (packed.cones || 0), windOutWeight - packed.weightIn);
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
export function calcTotalDispatchedApproved(dispatches, dyeLotId, dyeLots, _prebuiltLookup) {
  // Aug 6 2026 — optional 4th param added for the CPU-time optimization.
  // When provided (only by calcGradeTotals/calcShadeTotals so far), skips
  // the full re-scan below entirely and does an O(1) lookup instead. Every
  // other real caller (6 confirmed elsewhere in the app) omits this
  // parameter and gets the exact original behavior, completely unchanged.
  if (_prebuiltLookup) {
    const entries = _prebuiltLookup.get(dyeLotId) || [];
    return {
      weight: entries.reduce((a, d) => a + (d.weight || 0), 0),
      bags: entries.reduce((a, d) => a + (d.bags || d.units || 0), 0),
    };
  }
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
  // Aug 26 2026 — real, deliberate removal of the floor here too, per
  // Priyam's explicit instruction: no exceptions, anywhere.
  return { weight: packed.weight - disp.weight, bags: packed.bags - disp.bags };
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
  // Sep 10 2026 — real, root-cause fix built via direct discussion
  // with Priyam, from his own real observation that an edit preview
  // looked unrelated to the lot he'd actually selected: the exact
  // same loose-match bug already found and fixed in
  // calcSoftConsumedByDye back in July was still here, missed at the
  // time — a dye source with a blank grade or vendor field would
  // incorrectly count toward ANY lot sharing just the same lot
  // number, even a completely different vendor's lot.
  // Sep 10 2026 — second, deeper gap Priyam caught directly: a dye
  // lot's sources aren't only RM — Dead Stock, Recycle, and Residual
  // sources exist too, and a real Dead Stock source genuinely has no
  // lotId or vendor field at all (confirmed directly against real
  // data: only deadStockId, grade, sourceType, weight). If this ever
  // gets called with lotId/vendor undefined (a bug elsewhere, or an
  // incomplete call), undefined === undefined would still match a
  // Dead Stock source sharing the same grade text — the exact real
  // problem Priyam already ran into. Requiring sourceType === 'rm'
  // explicitly means this can never match anything but a genuine RM
  // source, no matter what's missing or coincidentally undefined.
  const src = (dyeLot.sources || []).find(s => s.sourceType === 'rm' && s.lotId === lotId && s.grade === grade && s.vendor === vendor);
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
  // Aug 26 2026 — real, deliberate removal of the floor, per Priyam's
  // explicit instruction: no exceptions, anywhere.
  return Qsub(calcDyeAllocated(dyeLots, lotId, grade, vendor), calcWindInAllocated(dyeLots, windEntries, lotId, grade, vendor));
}

// Wind Balance (RM-lot-anchored) = Wind's own output − Pack's input.
export function calcWindBalanceByLot(dyeLots, windEntries, packEntries, lotId, grade, vendor) {
  return Qsub(calcWindOutAllocated(dyeLots, windEntries, lotId, grade, vendor), calcPackInAllocated(dyeLots, packEntries, lotId, grade, vendor));
}

// Aug 5 2026 — the missing piece of this family, found while fixing the
// packBalance.bags formula in worker.js's calcSummaryFromData. Dye and
// Wind Balance both correctly split a shared dye batch's activity by each
// RM lot's real contribution (calcVendorRatioForDyeLot) — but Pack
// Balance and Dispatched, for this same RM-lot-anchored family, never
// got that split. A dye batch blended from two vendors (confirmed real —
// the Dye Start form genuinely supports multiple RM-lot source rows in
// one batch) would have its FULL pack/dispatch activity counted against
// EACH contributing RM lot, not each lot's true share — the exact
// "double/triple counted" bug already fixed for Dye Balance, just never
// closed for Pack. calcDispatchAllocated (below, pre-existing) already
// did this correctly for Dispatched; Pack's own output never had an
// allocated version until now.

// Pack's own output, proportionally allocated — same pattern as
// calcWindOutAllocated. Bags use Math.round(bags*ratio) — same "bags is
// a countable unit" convention as calcDispatchAllocated.
export function calcPackOutAllocated(dyeLots, packEntries, lotId, grade, vendor) {
  const related = appr(dyeLots || []).filter(d => calcVendorRatioForDyeLot(d, lotId, grade, vendor) > 0);
  return related.reduce((acc, d) => {
    const ratio = calcVendorRatioForDyeLot(d, lotId, grade, vendor);
    const packOut = appr(packEntries || []).filter(e => e.dyeLotId === d.id).reduce((a, e) => Qadd(a, Q(e.bags || e.outBags || 0, e.outWeight || e.weight || 0)), Q(0, 0));
    return Qadd(acc, Q(Math.round(packOut.units * ratio), packOut.weight * ratio));
  }, Q(0, 0));
}

// Pack Balance (RM-lot-anchored) = Pack's own output − Dispatched.
// Same "this stage's own output minus what's actually left it" rule as
// Dye/Wind Balance above. Bags: direct subtraction on the already-
// allocated (proportional) figures — no further ratio-estimating needed,
// since both sides are already this lot's true share.
export function calcPackBalanceByLot(dyeLots, packEntries, dispatches, lotId, grade, vendor) {
  // Aug 26 2026 — real, deliberate removal of the floor, per Priyam's
  // explicit instruction: no exceptions, anywhere.
  return Qsub(calcPackOutAllocated(dyeLots, packEntries, lotId, grade, vendor), calcDispatchAllocated(dyeLots, dispatches, lotId, grade, vendor));
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
  // Aug 26 2026 — real, deliberate removal of the floor, per Priyam's
  // explicit instruction: no exceptions, anywhere.
  return Qsub(bal, claimed);
}

// Wind Available = Wind Balance (dye-lot-anchored) − Pending/InProgress Pack claims.
export function calcWindBalAvailable(windEntries, packEntries, dyeLotId) {
  const bal = calcWindBal(windEntries, packEntries, dyeLotId);
  const claimed = (packEntries || []).filter(e => e.dyeLotId === dyeLotId && (e.status === 'Pending' || e.status === 'InProgress'))
    .reduce((a, e) => Qadd(a, Q(e.inCones || 0, e.inWeight || 0)), Q(0, 0));
  return Qsub(bal, claimed);
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
  // Aug 26 2026 — real, deliberate removal of the floor, per Priyam's
  // explicit instruction: no exceptions, anywhere.
  return Q(bal.bags - claimed.bags, bal.weight - claimed.weight);
}

// RM Available (the 'Soft' branch of getStageBalanceAvailable — the only
// branch ever actually called with real data; the Wind/Pack/Dispatch
// branches of the original dispatcher were dead code, confirmed by
// checking every call site before writing this).
export function calcStageBalanceAvailable(lots, stageEntries, rmReturnLog, lotId, grade, vendor) {
  const bal = calcRMBalance(lots, stageEntries, rmReturnLog, lotId, grade, vendor);
  const claimed = (stageEntries || []).filter(e => e.lotId === lotId && (!grade || e.grade === grade) && (!vendor || e.vendor === vendor) && e.stage === 'Soft' && (e.status === 'Pending' || e.status === 'InProgress'))
    .reduce((a, e) => Qadd(a, Q(e.inUnits || 0, e.inWeight || 0)), Q(0, 0));
  // Aug 26 2026 — real, deliberate removal of the floor, per Priyam's
  // explicit instruction: no exceptions, anywhere.
  return Qsub(bal, claimed);
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
  // Aug 26 2026 — real, deliberate removal of the floor, per Priyam's
  // explicit instruction: no exceptions, anywhere.
  return approvedBal - wipClaimed;
}
// Soft Available, {units, weight} shape (matching core.js's getSoftBalanceAvailable).
export function calcSoftBalanceAvailable(stageEntries, lots, scrapLog, dyeLots, residualLog, softBalanceQ, lotId, grade, vendor) {
  const wipClaimedKg = calcSoftConsumedByDyeWIP(dyeLots, lotId, grade, vendor);
  const balKg = (softBalanceQ.weight || 0) - wipClaimedKg;
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

// Aug 5 2026 — the missing pieces for Reports "All Time" archive-awareness.
// Grade/Pack/Waste never had a server-side equivalent at all (unlike
// flow/machine/worker/shade/daily above) — Priyam asked for these built
// properly, not just wired to something that didn't exist. Each mirrors
// its live pages.js counterpart's logic exactly (same grouping, same
// proportional-split rules, same rounding), just fed merged active+
// archive data instead of State.DB's active-only arrays.

// Grade Performance — grade is an RM-level attribute (exists before
// dyeing), so RM totals come straight from lots. Dyed/Dispatched are
// traced through dye lots' sources[] — a dye lot can blend more than one
// grade, so its output/dispatched gets split proportionally by each
// grade's share of the batch's total source weight (same rule already
// established for the RM-lot-anchored balance family elsewhere in this
// file — a blended batch's downstream activity must be attributed by
// real contribution, never copied in full to every contributor).
export function calcGradeTotals(lots, dyeLots, dispatches) {
  const gradeMap = {};
  (lots || []).forEach(l => {
    const g = l.grade || 'Unknown';
    if (!gradeMap[g]) gradeMap[g] = { grade: g, rmLots: 0, rmKg: 0, dyedKg: 0, dispatchedKg: 0, dispatchedBags: 0 };
    gradeMap[g].rmLots++;
    gradeMap[g].rmKg += l.weight || 0;
  });
  // Aug 6 2026 — real CPU-time optimization: build the dispatch lookup
  // once here, instead of calcTotalDispatchedApproved re-scanning the
  // full dispatches array on every one of the dye-lot iterations below.
  const _dispLookup = _buildDispatchLookupByDyeLot(dispatches, dyeLots);
  appr(dyeLots || []).filter(d => d.endTime).forEach(d => {
    const sources = d.sources || [];
    const totalSrcW = sources.reduce((a, s) => a + (s.weight || 0), 0);
    if (totalSrcW <= 0) return;
    const td = calcTotalDispatchedApproved(dispatches, d.id, dyeLots, _dispLookup);
    const shareByGrade = {};
    sources.forEach(s => { const g = s.grade || 'Unknown'; shareByGrade[g] = (shareByGrade[g] || 0) + (s.weight || 0); });
    Object.entries(shareByGrade).forEach(([g, srcW]) => {
      const share = srcW / totalSrcW;
      if (!gradeMap[g]) gradeMap[g] = { grade: g, rmLots: 0, rmKg: 0, dyedKg: 0, dispatchedKg: 0, dispatchedBags: 0 };
      gradeMap[g].dyedKg += (d.outWeight || 0) * share;
      gradeMap[g].dispatchedKg += (td.weight || 0) * share;
      gradeMap[g].dispatchedBags += (td.bags || 0) * share;
    });
  });
  return gradeMap;
}

// Pack Gain/Loss by dye lot — one row per completed dye lot (has real
// pack entries AND wind is fully consumed into pack, packBal<=1kg — same
// "essentially done" threshold the live version uses). Row shape and
// rounding match rptPack exactly.
export function calcPackTotals(dyeLots, packEntries, windEntries) {
  const lots = appr(dyeLots || []).filter(d => d.status === 'Approved' || d.status === 'Edited-Approved');
  // Aug 6 2026 — real CPU-time optimization: pre-group packEntries and
  // windEntries by dyeLotId ONCE, instead of re-filtering the full arrays
  // on every one of the dye-lot iterations below. appr() is applied here,
  // upfront, exactly matching the original per-iteration appr()+filter
  // order — the grouped result is identical to what each iteration used
  // to compute independently, just computed once instead of N times.
  const packByDyeLot = new Map();
  appr(packEntries || []).forEach(e => {
    if (!packByDyeLot.has(e.dyeLotId)) packByDyeLot.set(e.dyeLotId, []);
    packByDyeLot.get(e.dyeLotId).push(e);
  });
  const windByDyeLot = new Map();
  appr(windEntries || []).filter(e => e.endTime).forEach(e => {
    if (!windByDyeLot.has(e.dyeLotId)) windByDyeLot.set(e.dyeLotId, []);
    windByDyeLot.get(e.dyeLotId).push(e);
  });
  return lots.map(d => {
    const packE = packByDyeLot.get(d.id) || [];
    if (!packE.length) return null;
    const windE = windByDyeLot.get(d.id) || [];
    const windOutKg = windE.reduce((a, e) => a + (e.outWeight || 0), 0);
    if (!windOutKg) return null;
    const packKg = packE.reduce((a, e) => a + (e.weight || 0), 0);
    const packBags = packE.reduce((a, e) => a + (e.bags || 0), 0);
    const packBal = windOutKg - packKg;
    if (packBal > 1) return null;
    const gainLoss = packKg - windOutKg;
    const pct = windOutKg > 0 ? Math.round((gainLoss / windOutKg) * 1000) / 10 : 0;
    return { id: d.id, dyeLotNo: d.dyeLotNo, shade: d.shade, grade: (d.sources || [])[0]?.grade || '—', windKg: windOutKg, packKg, packBags, gainLoss, pct };
  }).filter(Boolean);
}

// Waste & Gain — 3-row stage summary (Soft/Dye/Wind, in/out/diff/entries)
// plus a per-lot drill-down list, sorted by |diff| descending — same
// structure and rounding as rptWaste.
export function calcWasteTotals(stageEntries, dyeLots, windEntries) {
  const softE = appr(stageEntries || []).filter(e => e.stage === 'Soft' && e.endTime);
  const softIn = softE.reduce((a, e) => a + (e.inWeight || 0), 0);
  const softOut = softE.reduce((a, e) => a + (e.outWeight || 0), 0);
  const dyeL = appr(dyeLots || []).filter(d => d.endTime);
  const dyeIn = dyeL.reduce((a, d) => a + (d.totalInWeight || 0), 0);
  const dyeOut = dyeL.reduce((a, d) => a + (d.outWeight || 0), 0);
  const windE = appr(windEntries || []).filter(e => e.endTime);
  const windIn = windE.reduce((a, e) => a + (e.inWeight || 0), 0);
  const windOut = windE.reduce((a, e) => a + (e.outWeight || 0), 0);
  const stages = [
    { name: '🧵 Soft', col: 'var(--cs)', inKg: softIn, outKg: softOut, entries: softE.length },
    { name: '🎨 Dye', col: 'var(--cd)', inKg: dyeIn, outKg: dyeOut, entries: dyeL.length },
    { name: '🌀 Wind', col: 'var(--cw)', inKg: windIn, outKg: windOut, entries: windE.length },
  ];
  const lotRows = [];
  const softByLot = {};
  softE.forEach(e => { if (!softByLot[e.lotId]) softByLot[e.lotId] = { inKg: 0, outKg: 0 }; softByLot[e.lotId].inKg += e.inWeight || 0; softByLot[e.lotId].outKg += e.outWeight || 0; });
  Object.entries(softByLot).forEach(([lotId, v]) => {
    const diff = v.outKg - v.inKg;
    const pct = v.inKg > 0 ? Math.round((Math.abs(diff) / v.inKg) * 1000) / 10 : 0;
    lotRows.push({ label: lotId, shade: '—', stage: 'Soft', inKg: v.inKg, outKg: v.outKg, diff, pct, id: null, type: 'rm' });
  });
  dyeL.forEach(d => {
    const diff = (d.outWeight || 0) - (d.totalInWeight || 0);
    const pct = d.totalInWeight > 0 ? Math.round((Math.abs(diff) / d.totalInWeight) * 1000) / 10 : 0;
    lotRows.push({ label: d.dyeLotNo, shade: d.shade || '', stage: 'Dye', inKg: d.totalInWeight || 0, outKg: d.outWeight || 0, diff, pct, id: d.id, type: 'dye' });
  });
  const windByDL = {};
  windE.forEach(e => { if (!windByDL[e.dyeLotId]) windByDL[e.dyeLotId] = { dyeLotNo: e.dyeLotNo, shade: e.shade, id: e.dyeLotId, inKg: 0, outKg: 0 }; windByDL[e.dyeLotId].inKg += e.inWeight || 0; windByDL[e.dyeLotId].outKg += e.outWeight || 0; });
  Object.values(windByDL).forEach(v => {
    const diff = v.outKg - v.inKg;
    const pct = v.inKg > 0 ? Math.round((Math.abs(diff) / v.inKg) * 1000) / 10 : 0;
    lotRows.push({ label: v.dyeLotNo, shade: v.shade || '', stage: 'Wind', inKg: v.inKg, outKg: v.outKg, diff, pct, id: v.id, type: 'dye' });
  });
  lotRows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  return { stages, lotRows };
}

export function calcShadeTotals(dyeLots, packEntries, dispatches) {
  const shade = {};
  // Aug 6 2026 — real CPU-time optimization: three separate pre-groupings,
  // each matching a genuinely distinct original filter condition exactly
  // — reusing one for all three would silently change which records get
  // counted where. packGainByDyeLot mirrors the original's dyeLotId+
  // non-Voided condition; dispatchesByDyeLotDirect mirrors the original's
  // plain direct-match-only condition (deliberately NOT the same as
  // _buildDispatchLookupByDyeLot below, which also resolves the lotId
  // fallback — that broader lookup is only correct for the
  // calcTotalDispatchedApproved call, not for this parties list).
  const packGainByDyeLot = new Map();
  (packEntries || []).filter(p => p.status !== 'Voided').forEach(p => {
    if (!packGainByDyeLot.has(p.dyeLotId)) packGainByDyeLot.set(p.dyeLotId, 0);
    packGainByDyeLot.set(p.dyeLotId, packGainByDyeLot.get(p.dyeLotId) + (p.gainKg || 0));
  });
  const dispatchesByDyeLotDirect = new Map();
  appr(dispatches || []).forEach(x => {
    if (!dispatchesByDyeLotDirect.has(x.dyeLotId)) dispatchesByDyeLotDirect.set(x.dyeLotId, []);
    dispatchesByDyeLotDirect.get(x.dyeLotId).push(x);
  });
  const _dispLookup = _buildDispatchLookupByDyeLot(dispatches, dyeLots);
  (dyeLots||[]).filter(d=>d.endTime).forEach(d => {
    const s = d.shade || 'Unknown';
    if(!shade[s]) shade[s] = { shade:s, lots:0, inKg:0, outKg:0, dispatched:0, dispBags:0, pending:0, parties:[] };
    const r = shade[s];
    r.lots++; r.inKg += d.totalInWeight||0; r.outKg += d.outWeight||0;
    // Reuses calcTotalDispatchedApproved (already handles Approved-status filtering
    // and the dyeLotId-missing/lotId-via-sources[] fallback match) instead of
    // re-filtering dispatches by hand here — avoids a second copy drifting from
    // the proven formula (Jul 12 2026 fix, caught before this shipped to pages.js).
    const td = calcTotalDispatchedApproved(dispatches, d.id, dyeLots, _dispLookup);
    r.dispatched += td.weight||0; r.dispBags += td.bags||0;
    const gainKg = packGainByDyeLot.get(d.id) || 0;
    r.pending += Math.max(0,(d.outWeight||0)+gainKg-(td.weight||0));
    (dispatchesByDyeLotDirect.get(d.id) || []).forEach(x=>{ if(x.party && !r.parties.includes(x.party)) r.parties.push(x.party); });
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
  // Aug 26 2026 — real, deliberate removal of the floor, per Priyam's
  // explicit instruction: no exceptions, anywhere.
  return (ds.weight || 0) - usedInDye - usedInSoft - scrapped;
}

// Sep 10 2026 — real, direct feature built via direct discussion with
// Priyam, from his own real, direct point: cones was added onto Dead
// Stock as a standalone number, but never actually connected the way
// weight already is — using material from a source should genuinely
// reduce that source's own real remaining balance, cones included, not
// just weight. Simple, direct mirror of calcDeadStockBalance's own,
// already-proven formula — subtracts only what's genuinely already
// recorded (a real dye source's own cones field) from the Dead Stock
// entry's own total, deliberately nothing clever or proportional per
// Priyam's own explicit instruction. Soft and Scrap are correctly
// excluded — neither ever records a cones field for Dead Stock, so
// there's genuinely nothing there to subtract.
export function calcDeadStockConesBalance(deadStock, dyeLots, id) {
  const ds = (deadStock || []).find(x => x.id === id);
  if (!ds) return 0;
  const usedInDye = (dyeLots || []).filter(d => d.status !== 'Rejected' && d.status !== 'Void' && d.status !== 'Voided')
    .reduce((a, d) => { const src = (d.sources || []).find(s => s.deadStockId === id && s.sourceType === 'dead'); return a + (src?.cones || 0); }, 0);
  return (ds.cones || 0) - usedInDye;
}

// Jul 15 2026 — Priyam confirmed: recycle scrap should deduct from
// balance the same way dead stock scrap already does. Was previously
// flagged as an inconsistency, not fixed unasked; now built to match
// calcDeadStockBalance's pattern exactly. Also added the missing
// usedInSoft deduction (recycle material can be consumed directly via
// Soft, same as dead stock — handleStageStart accepts recycleId — this
// was the one remaining gap between the two formulas, confirmed real in
// the code path though never yet exercised in production data).
// Sep 19 2026 — Recycle Phase 1. The recycle "On Steel" pool is counted in CONES + KG (Q(cones, weight): `units` = cones here, like
// calcDyeBal). Same two-number rule as every stage: BALANCE = approved only, AVAILABLE = balance minus what Pending / InProgress dye lots
// have already claimed. Scrap needs no approval, so it counts in both. A voided recycle entry has nothing.
const _rcPool = (x) => (x && x.pool === 'softened' ? 'softened' : 'steel');
const _rcRow = (d, rcId, pool) => (d.sources || []).filter(s => s.recycleId === rcId && s.sourceType === 'recycle' && _rcPool(s) === pool);
const _rcSum = (dyeLots, rcId, pick, pool) => (dyeLots || []).filter(pick).reduce((acc, d) => _rcRow(d, rcId, pool).reduce((a, s) => Qadd(a, Q(s.cones || 0, s.weight || 0)), acc), Q(0, 0));
const _rcScrap = (scrapLog, rcId, pool) => (scrapLog || []).filter(s => s.entryId === rcId && s.type === 'recycle' && s.status !== 'Voided' && _rcPool(s) === pool)
  .reduce((a, s) => Qadd(a, Q(s.cones || 0, s.weight || 0)), Q(0, 0));
// Sep 20 2026 — Recycle Phase 2: Recycle Soft entries (table recycleSoft). Their INPUT comes off the On Steel pool, their OUTPUT is the Softened pool.
const _rcsOk = (e) => e.status !== 'Rejected' && e.status !== 'Void' && e.status !== 'Voided';
const _rcsApproved = (e) => e.status === 'Approved' || e.status === 'Edited-Approved';
const _rcsIn = (recycleSoft, rcId, pick) => (recycleSoft || []).filter(e => e.recycleId === rcId && pick(e)).reduce((a, e) => Qadd(a, Q(e.inCones || 0, e.inWeight || 0)), Q(0, 0));
const _rcsOut = (recycleSoft, rcId, pick) => (recycleSoft || []).filter(e => e.recycleId === rcId && pick(e)).reduce((a, e) => Qadd(a, Q(e.outCones || 0, e.outWeight || 0)), Q(0, 0));
const _dyeApproved = d => d.status === 'Approved' || d.status === 'Edited-Approved';
const _dyeClaims = d => d.status !== 'Rejected' && d.status !== 'Void' && d.status !== 'Voided' && !_dyeApproved(d);
export function calcRecycleSteelBal(recycleStock, dyeLots, scrapLog, rcId, recycleSoft) {
  const rc = (recycleStock || []).find(r => r.id === rcId);
  if (!rc || rc.status === 'Voided') return Q(0, 0);
  const used = _rcSum(dyeLots, rcId, _dyeApproved, 'steel');
  const softened = _rcsIn(recycleSoft, rcId, _rcsApproved);
  return Qsub(Qsub(Qsub(Q(rc.cones || 0, rc.weight || 0), used), softened), _rcScrap(scrapLog, rcId, 'steel'));
}
export function calcRecycleSteelAvailable(recycleStock, dyeLots, scrapLog, rcId, recycleSoft) {
  const claimed = _rcSum(dyeLots, rcId, _dyeClaims, 'steel');
  const softClaim = _rcsIn(recycleSoft, rcId, e => _rcsOk(e) && !_rcsApproved(e));
  return Qsub(Qsub(calcRecycleSteelBal(recycleStock, dyeLots, scrapLog, rcId, recycleSoft), claimed), softClaim);
}
// SOFTENED pool: what approved Recycle Soft entries produced, minus dye sources taken from it (pool 'softened') and scrap of softened yarn.
export function calcRecycleSoftenedBal(recycleStock, recycleSoft, dyeLots, scrapLog, rcId) {
  const rc = (recycleStock || []).find(r => r.id === rcId);
  if (!rc || rc.status === 'Voided') return Q(0, 0);
  const made = _rcsOut(recycleSoft, rcId, _rcsApproved);
  return Qsub(Qsub(made, _rcSum(dyeLots, rcId, _dyeApproved, 'softened')), _rcScrap(scrapLog, rcId, 'softened'));
}
export function calcRecycleSoftenedAvailable(recycleStock, recycleSoft, dyeLots, scrapLog, rcId) {
  return Qsub(calcRecycleSoftenedBal(recycleStock, recycleSoft, dyeLots, scrapLog, rcId), _rcSum(dyeLots, rcId, _dyeClaims, 'softened'));
}
// Sep 20 2026 — Recycle Phase 2 leftover removal: calcRecycleBalance (the old kg-only wrapper kept for the Soft path) is deleted.
// Soft Start no longer takes a recycle at all (see worker.js), so the wrapper had no real caller left anywhere in the app.

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
  return (rs.weight || 0) - used;
}

// Aug 6 2026 — consolidation of 4 waste/gain formulas that had each been
// hand-written independently: Soft's inside handleStageEnd (worker.js),
// Wind's inside handleWindEnd (worker.js), Pack's inside handlePackSubmit
// (worker.js), and Dye's inside its own End handler (worker.js) — plus
// Dye specifically had 3 MORE independent client-side re-derivations on
// top of that (dye.js's own recalcDyeWaste, dye.js's live table-render
// calculation, and pages.js's Excel export). Found while investigating a
// direct question about why shared-balances.js — already proven working
// as the single source of truth for RM/Dye/Wind/Pack *balances* — wasn't
// also covering these 4 waste/gain *outcomes* the same way.
//
// Deliberately 4 separate, precisely-named functions here, NOT one
// generic function with a mode parameter — each stage's real, current
// behavior genuinely differs (confirmed by reading every formula exactly
// as it exists today, not assumed): Soft rounds units to a whole number
// AND floors weight at 0; Wind floors cones+weight at 0 but doesn't round
// units; Pack allows a genuine negative result (real loss, not just
// "waste") and rounds to 2 decimals; Dye has no explicit floor or
// rounding at all (relies on its own pre-validation to prevent negative
// results instead). Collapsing these into one shared function with
// hidden per-stage branching would risk quietly changing behavior for at
// least one of them — these 4 functions instead preserve each stage's
// exact existing formula byte-for-byte, just in one place instead of
// scattered across 4 (Soft/Wind/Pack) to 7 (Dye) separate locations.

// Aug 6 2026 (later same session) — sign convention changed per Priyam's
// explicit, direct instruction: negative = waste (red), positive = gain
// (green) — the same real number everywhere, no more per-stage "always
// positive, floored at zero" assumption. Uses output-input (matching
// calcPackGain's own, already-correct convention below) so the sign is
// mathematically consistent: less output than input is a genuine loss
// (negative), more output than input than expected is a genuine,
// visible anomaly (positive) — for Soft/Wind/Dye this should essentially
// never happen in a correctly-running process, and that is exactly the
// point: if it ever does, it must be visible, not silently absorbed by
// a floor that used to hide it. Field names kept exactly as before
// (wasteUnits/wasteWeight/etc.) — only the VALUE'S sign and range
// changed, not the schema, so this stays a value fix, not a rename.
export function calcSoftWaste(inUnits, outUnits, inWeight, outWeight) {
  const wasteUnits = Math.round((outUnits || 0) - (inUnits || 0));
  const wasteWeight = parseFloat(((outWeight || 0) - (inWeight || 0)).toFixed(2));
  return { wasteUnits, wasteWeight };
}

export function calcWindWaste(inCones, outCones, inWeight, outWeight) {
  const wasteCones = (outCones || 0) - (inCones || 0);
  const wasteWeight = parseFloat(((outWeight || 0) - (inWeight || 0)).toFixed(2));
  return { wasteCones, wasteWeight };
}

export function calcPackGain(inWeight, outWeight) {
  const gainKg = parseFloat((outWeight - inWeight).toFixed(2));
  const gainPct = inWeight > 0 ? parseFloat((gainKg / inWeight * 100).toFixed(2)) : 0;
  return { gainKg, gainPct };
}

export function calcDyeWaste(inCones, outCones, inWeight, outWeight) {
  const coneLoss = (outCones || 0) - (inCones || 0);
  const kgLoss = (outWeight || 0) - (inWeight || 0);
  const kgLossPct = inWeight > 0 ? (kgLoss / inWeight * 100) : 0;
  return { coneLoss, kgLoss, kgLossPct };
}

// Aug 6 2026 — real CPU-time optimization, built after live testing on
// staging confirmed Reports' "All Time" endpoint genuinely, reproducibly
// hits Cloudflare's Worker CPU-time ceiling (10ms free / 50ms paid) and
// gets killed mid-computation. Traced the real bottleneck by actually
// reading every function recomputeReportSummaries calls, not guessed:
// calcGradeTotals and calcShadeTotals each call calcTotalDispatchedApproved
// once PER dye lot, and that function re-scans the ENTIRE dispatches array
// (and, for any dispatch missing a direct dyeLotId, ALSO the entire
// dyeLots array and each one's sources[]) every single call — genuinely
// O(dyeLots × dispatches × avgSources) in the worst case, with real
// staging volumes of 222 dye lots and 84 dispatches.
//
// Fixed via an OPTIONAL pre-built lookup, not by changing
// calcTotalDispatchedApproved's core behavior — confirmed 8 real callers
// of that function exist across the whole app (4 in this file, 4 in
// worker.js); only calcGradeTotals and calcShadeTotals get upgraded to
// pass this lookup, every other real caller is completely untouched,
// unaffected, calling it exactly as before.
//
// This helper does the equivalent grouping work ONCE, resolving the same
// fallback lotId-matching logic upfront for every dispatch, converting
// what used to be a per-dye-lot re-scan into a single O(dispatches +
// dyeLots) pass followed by O(1) lookups.
export function _buildDispatchLookupByDyeLot(dispatches, dyeLots) {
  const lookup = new Map();
  const add = (key, d) => {
    if (!lookup.has(key)) lookup.set(key, []);
    lookup.get(key).push(d);
  };
  const approvedDispatches = appr(dispatches || []);
  // Build a lotId -> dyeLotIds index once, for the fallback match, instead
  // of scanning every dye lot's sources[] again for every dispatch.
  const lotIdToDyeLotIds = new Map();
  (dyeLots || []).forEach(dl => {
    (dl.sources || []).forEach(s => {
      if (!s.lotId) return;
      if (!lotIdToDyeLotIds.has(s.lotId)) lotIdToDyeLotIds.set(s.lotId, []);
      lotIdToDyeLotIds.get(s.lotId).push(dl.id);
    });
  });
  approvedDispatches.forEach(d => {
    if (d.dyeLotId !== undefined) {
      add(d.dyeLotId, d);
    } else if (d.lotId) {
      const matches = lotIdToDyeLotIds.get(d.lotId) || [];
      matches.forEach(dyeLotId => add(dyeLotId, d));
    }
  });
  return lookup;
}
