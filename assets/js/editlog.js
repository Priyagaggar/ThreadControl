// editlog.js — Edit Log page (general edit/void/override log + RM Edit Log +
// Daily Check Report sub-features).
// Aug 6 2026 — Phase 1, Step 13 of the module-split plan. Extracted byte-
// for-byte from pages.js. Real inventory: 10 functions, found via both
// AST reachability and name-scan combined — flagged early this session
// as more complex than a first glance suggests, confirmed true. Includes
// setupRMEditLogTab, a genuine no-op stub ({}) still called twice by
// core.js's onLogin() via window.setupRMEditLogTab() — kept exactly as-is,
// not judged or "cleaned up", matching the byte-for-byte extraction rule.
// clearEditLogFilters is referenced as a STRING inside core.js's
// _filterTableMap config (dynamic window[clearFn]() dispatch), not a real
// import — confirms it needs its own window bridge, not a cross-file
// import. renderEditLog needs both a window bridge (static tab-switch
// buttons) AND a real import back into pages.js (renderAll's direct call).

import { State, WORKER_URL, _postHeaders, _sortState, _tableFilters, fmt, fmtRelTS, fmtTS, nowTS, today, _refreshAndRender, apiPost, _fetchTrueSoftAvailable, closeModal, getWindBal, openModal, save, setAlert, showToast, _verifyPasswordViaWorker, parseLotSelectValue, machinesForStage, workersSorted } from './core.js';
import { buildColFilter, sortArr, sortTh } from './shared.js';
import { _updateClearBtn } from './shared.js';
import { fmtN, renderAll, _markGuidedReassignFixed, currentFY } from './pages.js';

// Aug 26 2026 — real, genuine bug found and fixed via Priyam's real,
// live console log: this belongs here, since every function that
// actually reads and writes it lives in this file — the declaration
// was accidentally left behind in pages.js during today's earlier
// module-split, meaning clicking Save genuinely crashed with a real
// "not defined" error, doing nothing at all, every single time.
let _pendingEditBody = null;

export function switchEditLogTab(tab,el){['log','integrity'].forEach(t=>{const p=document.getElementById('elp-'+t);if(p)p.style.display=t===tab?'block':'none';});document.querySelectorAll('[id^="elt-"]').forEach(b=>b.classList.remove('active-appr-tab'));if(el)el.classList.add('active-appr-tab');if(tab==='log')renderEditLog();if(tab==='integrity')loadDailyCheckReport();}

let _dailyCheckSubTab = 'staleness';
let _lastDailyCheckReport = null;
export function _switchDailyCheckSubTab(tab, el) {
  _dailyCheckSubTab = tab;
  document.querySelectorAll('[id^="dc-subtab-"]').forEach(b => b.classList.remove('active-appr-tab'));
  if (el) el.classList.add('active-appr-tab');
  _renderDailyCheckReport(_lastDailyCheckReport);
}

// Aug 6 2026 — real restructuring: report now genuinely contains 3 kinds
// of rows (Staleness, Conservation, Plausibility — the Control tab moved
// here from Reports, rebuilt fresh, no more cache-first reads). Split
// into 2 real sub-tabs: Staleness on its own, and Conservation +
// Plausibility together under "Total In vs Out" — both genuinely
// different from Staleness (comparing real quantities against each
// other, not a saved cache against a fresh recompute), so they share a
// home. Distinguished purely by field prefix: 'conservation.' and
// 'plausibility.' route to the second tab; everything else (the
// Balance-type fields) stays in Staleness.
export function _renderDailyCheckReport(report, lastError, backupStatus, lastTiming){
  const el=document.getElementById('daily-check-results');
  if(!el)return;
  _lastDailyCheckReport = report;
  // Sep 8 2026 — real, direct fix built via direct discussion with
  // Priyam, from "manual run is failing" with no visible reason: a
  // crash in the actual check used to be completely invisible — the
  // button said "Started ✓" and the report just never updated again,
  // forever, with nothing shown to explain why. This surfaces the
  // real error clearly, right where the report itself is shown,
  // whenever the most recent run actually failed instead of quietly
  // producing an updated report.
  const errorBanner = (lastError && lastError.message) ? `<div class="alert-err" style="margin-bottom:14px"><b>⚠ The most recent check run failed and did not produce a new report:</b><br>${lastError.message}<br><span style="font-size:0.68rem;color:var(--mu)">at ${lastError.at ? new Date(lastError.at).toLocaleString('en-GB') : ''}</span></div>` : '';
  // Sep 8 2026 — real, direct fix built via direct discussion with
  // Priyam: the daily check runs INSIDE the same nightly job as the
  // backup, right after it — if the backup itself fails, the check
  // never even gets a chance to run, and backupStatus (already
  // written correctly server-side) was never shown anywhere at all.
  // lastTiming shows the real fetch-vs-check time split, actual
  // evidence from the real run instead of guessed numbers.
  const backupBanner = (backupStatus && backupStatus.status === 'failed') ? `<div class="alert-err" style="margin-bottom:14px"><b>⚠ Last night's backup itself failed (the daily check runs right after backup, so it never got a chance to run):</b><br>${backupStatus.error||''}<br><span style="font-size:0.68rem;color:var(--mu)">attempted at ${backupStatus.lastAttempt?new Date(backupStatus.lastAttempt).toLocaleString('en-GB'):''}</span></div>` : '';
  const timingBanner = lastTiming ? `<div style="margin-bottom:14px;padding:8px 12px;background:rgba(255,255,255,0.03);border-radius:6px;font-size:0.72rem;color:var(--mu)">Last run timing (${lastTiming.outcome||'unknown'}, ${lastTiming.at?new Date(lastTiming.at).toLocaleString('en-GB'):''}): ${lastTiming.fetchMs!=null?`fetching data took ${lastTiming.fetchMs}ms, `:''}${lastTiming.checkMs!=null?`the check itself took ${lastTiming.checkMs}ms`:lastTiming.failedAfterMs!=null?`failed after ${lastTiming.failedAfterMs}ms (during ${lastTiming.failedDuring||'unknown step'})`:''}</div>` : '';
  if(!report){el.innerHTML=errorBanner+backupBanner+timingBanner+'<div style="color:var(--mu)">No check has run yet. Click "Run Now" to check today, or wait for the automatic overnight run.</div>';return;}
  const fmtD=v=>v?new Date(v).toLocaleString('en-GB'):'';
  const allRows=report.rows||[];
  const isTotalInOut = r => r.field.startsWith('conservation.') || r.field.startsWith('plausibility.');
  const staleRows = allRows.filter(r => !isTotalInOut(r));
  const totalRows = allRows.filter(r => isTotalInOut(r));
  const rows = _dailyCheckSubTab === 'staleness' ? staleRows : totalRows;
  const tabsHtml = `<div style="margin-bottom:12px;display:flex;gap:8px">
    <button id="dc-subtab-staleness" class="btn btn-ghost btn-sm${_dailyCheckSubTab==='staleness'?' active-appr-tab':''}" onclick="_switchDailyCheckSubTab('staleness',this)">Staleness (${staleRows.length})</button>
    <button id="dc-subtab-totalinout" class="btn btn-ghost btn-sm${_dailyCheckSubTab==='totalinout'?' active-appr-tab':''}" onclick="_switchDailyCheckSubTab('totalinout',this)">Total In vs Out (${totalRows.length})</button>
  </div>`;
  if(!allRows.length){
    el.innerHTML=errorBanner+backupBanner+timingBanner+`<div style="color:var(--gr);font-weight:600;padding:16px 0">✓ Last checked ${fmtD(report.runAt)}. Everything matches — no issues found.</div>`;
    return;
  }
  if(!rows.length){
    el.innerHTML=errorBanner+backupBanner+timingBanner+tabsHtml+`<div style="color:var(--gr);font-weight:600;padding:16px 0">✓ Nothing flagged in this tab — last checked ${fmtD(report.runAt)}.</div>`;
    return;
  }
  // Aug 6 2026 — real, confirmed finding: check1 and check2 have always
  // been the exact same value, written twice — never two independent
  // calculations. Removed the fake second column, and with it, the
  // "disagreements" sort/highlight logic below, which checked for the
  // two checks disagreeing with each other — something that could never
  // actually happen given check1 and check2 were never genuinely
  // different in the first place. Dead logic checking for a scenario
  // that never existed, removed along with the column it depended on.
  //
  // "Live" is only genuinely accurate as a label for Staleness rows —
  // a real, current, displayed number being verified. For the Total In
  // vs Out tab, the same column holds a fixed historical total or a
  // real-vs-real comparison — never actually "live" in any meaningful
  // sense. Labeled per-tab instead of reusing one word for two
  // genuinely different things (real, direct feedback caught this).
  const col1Label = _dailyCheckSubTab === 'staleness' ? 'Live' : 'Value A';
  const col2Label = _dailyCheckSubTab === 'staleness' ? 'Check' : 'Value B';
  let html=errorBanner+backupBanner+timingBanner+tabsHtml+`<div style="margin-bottom:14px;font-weight:600">Last checked ${fmtD(report.runAt)}. Found <span style="color:var(--re)">${rows.length} issue(s)</span> in this tab — all flagged for your review, nothing changed automatically.</div>`;
  html+=`<table style="width:100%;border-collapse:collapse;font-size:0.72rem"><thead><tr style="color:var(--mu);text-align:left"><th style="padding:5px 8px">Stage</th><th style="padding:5px 8px">Lot No</th><th style="padding:5px 8px">Vendor</th><th style="padding:5px 8px">Grade</th><th style="padding:5px 8px">Shade</th><th style="padding:5px 8px">Field</th><th style="padding:5px 8px">${col1Label}</th><th style="padding:5px 8px">${col2Label}</th><th style="padding:5px 8px">What's Wrong</th></tr></thead><tbody>`;
  rows.forEach(r=>{
    html+=`<tr style="border-top:1px solid var(--b1)"><td style="padding:5px 8px">${r.stage}</td><td style="padding:5px 8px;color:var(--ac);font-weight:700">${r.lotNo}</td><td style="padding:5px 8px;color:var(--mu)">${r.vendor||'—'}</td><td style="padding:5px 8px;color:var(--mu)">${r.grade||'—'}</td><td style="padding:5px 8px;color:var(--mu)">${r.shade||'—'}</td><td style="padding:5px 8px;color:var(--mu)">${r.field}</td><td style="padding:5px 8px">${fmt(r.live)}</td><td style="padding:5px 8px">${fmt(r.check1)}</td><td style="padding:5px 8px;color:var(--ye);font-weight:600">${r.whatsWrong}</td></tr>`;
  });
  html+='</tbody></table>';
  el.innerHTML=html;
}

export async function loadDailyCheckReport(){
  const el=document.getElementById('daily-check-results');
  if(el)el.innerHTML='<div style="color:var(--mu)">Loading...</div>';
  try{
    const res=await fetch(WORKER_URL+'/api/daily-check/latest',{headers:_postHeaders()});
    const data=await res.json();
    _renderDailyCheckReport(data.report, data.lastError, data.backupStatus, data.lastTiming);
  }catch(e){
    if(el)el.innerHTML=`<div class="alert-err">Could not load — ${e.message}</div>`;
  }
}

// Aug 26 2026 — real, direct extension built via direct discussion with
// Priyam: undo, right from the Edit Log itself. Warns first if
// anything real happened since that depends on it, matching the exact
// same pattern already proven for the Dye split; only proceeds on an
// explicit second click.
// Sep 10 2026 — real, direct new feature built via direct discussion
// with Priyam, establishing one clear rule across the whole app: for
// Void and Undo, everyone enters a password — no exceptions. Since
// the existing ↶ button had no form around it at all, this opens a
// proper small modal to collect the password first, matching the
// exact same style as every other password field in the app, rather
// than a plain browser prompt.
export function openUndoPwdModal(editLogId){
  document.getElementById('undo-pwd-editlogid').value = editLogId;
  document.getElementById('undo-pwd').value = '';
  document.getElementById('undo-pwd-alert').innerHTML = '';
  openModal('undo-pwd-modal-overlay');
}

export async function submitUndoEditWithPwd(){
  const setAlert = msg => { document.getElementById('undo-pwd-alert').innerHTML = `<div class="alert-err" style="margin-bottom:8px">${msg}</div>`; };
  const editLogId = document.getElementById('undo-pwd-editlogid').value;
  const pwd = document.getElementById('undo-pwd').value;
  if (!pwd) { setAlert('Enter your password'); return; }
  closeModal('undo-pwd-modal-overlay');
  await submitUndoEdit(editLogId, false, pwd);
}

let _pendingUndo = null;

export async function submitUndoEdit(editLogId, force, password){
  const log = (State.DB.editLog||[]).find(l => l.id === editLogId);
  if(!log){ showToast('Edit log entry not found', 'err'); return; }
  const {ok, data, error, networkError} = await apiPost('/api/undo-edit', {
    editLogId, confirm: !!force, changedBy: State.currentUser?.name, role: State.currentUser?.role,
    password: password || '', username: State.currentUser?.username,
  });
  if(networkError){ showToast('Network error — '+error, 'err'); return; }
  if(!ok){ showToast(error||'Undo failed', 'err'); return; }
  // Sep 10 2026 — real, direct new feature built via direct discussion
  // with Priyam, establishing one clear rule across the whole app:
  // every real action shows a genuine preview of its actual effect
  // before committing — upgraded from only warning when something's
  // genuinely wrong to always showing a real preview screen, with any
  // real shortfall highlighted right there instead of a separate
  // browser confirm() dialog.
  if(data.__dryRun){
    _pendingUndo = { editLogId, password };
    const isDyeInput = data.oldTotalWeight !== undefined;
    const body = isDyeInput
      ? `<div style="font-size:.82rem;margin-bottom:8px;">Total Weight: <span style="color:var(--mu)">${fmt(data.oldTotalWeight)}kg</span> → <strong>${fmt(data.restoreToTotalWeight)}kg</strong><br>Total Cones: <span style="color:var(--mu)">${data.oldTotalCones}</span> → <strong>${data.restoreToTotalCones}</strong></div>`
      : `<div style="font-size:.82rem;margin-bottom:8px;">${data.field}: <span style="color:var(--mu)">${data.currentValue}</span> → <strong>${data.restoreToValue}</strong></div>`;
    const warningHtml = data.wouldCreateShortfall ? `<div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:8px 10px;font-size:.72rem;color:var(--re);font-weight:700">⚠ ${data.shortfallMessage}</div>` : '';
    document.getElementById('undo-preview-body').innerHTML = body + warningHtml;
    document.getElementById('undo-preview-alert').innerHTML = '';
    openModal('undo-preview-modal-overlay');
    return;
  }
  showToast('Undone ✓', 'success');
  await _refreshAndRender(['editLog','stageEntries','dyeLots','windEntries','lotFlags','dyeLotFlags'], renderAll);
}

export async function _doUndoConfirm(){
  const setAlert = msg => { document.getElementById('undo-preview-alert').innerHTML = `<div class="alert-err" style="margin-bottom:8px">${msg}</div>`; };
  const pending = _pendingUndo;
  if(!pending) return;
  const _btn = document.getElementById('undo-preview-confirm-btn');
  if(_btn) _btn.disabled = true;
  const {ok, error, networkError} = await apiPost('/api/undo-edit', {
    editLogId: pending.editLogId, confirm: true, changedBy: State.currentUser?.name, role: State.currentUser?.role,
    password: pending.password || '', username: State.currentUser?.username,
  });
  if(networkError){ setAlert('Network error — '+error); if(_btn) _btn.disabled = false; return; }
  if(!ok){ setAlert(error||'Undo failed'); if(_btn) _btn.disabled = false; return; }
  closeModal('undo-preview-modal-overlay');
  showToast('Undone ✓', 'success');
  _pendingUndo = null;
  await _refreshAndRender(['editLog','stageEntries','dyeLots','windEntries','lotFlags','dyeLotFlags'], renderAll);
}

// Sep 10 2026 — real, direct new feature built via a genuinely long,
// careful design discussion with Priyam, from his own real concern: a
// Supervisor voiding one entry could silently cascade into voiding an
// entire Dye batch, Wind, Pack, and even a real Dispatch already gone
// to a customer. Once anything real is downstream, that Supervisor's
// void now creates a real, pending request here instead — same shape
// as the existing deleteRequests pattern, Admin/Manager only, "Review"
// opens the exact same full cascade checkbox tool already proven for
// a direct Admin void, pre-linked to this specific request so
// approving it correctly marks the request approved in the same
// action.
function _renderVoidRequestsPanel(){
  const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';
  const reqPanel=document.getElementById('void-requests-panel');
  const reqList=document.getElementById('void-requests-list');
  const reqBadge=document.getElementById('void-req-badge');
  if(!reqPanel)return;
  const pending=(State.DB.voidRequests||[]).filter(r=>r.status==='pending');
  if(isAdmin&&pending.length>0){
    reqPanel.style.display='block';
    if(reqBadge){reqBadge.textContent=pending.length+' pending';reqBadge.style.display='';}
    reqList.innerHTML=pending.map(r=>`
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(239,68,68,0.15);"><div><div style="font-size:.82rem;font-weight:700;color:var(--re)">${r.stage} — ${r.entryId}</div><div style="font-size:.65rem;color:var(--mu)">Requested by ${r.requestedBy} · ${fmtTS(r.requestedAt)}</div>
          ${r.reason?`<div style="font-size:.65rem;color:var(--mu);font-style:italic">"${r.reason}"</div>`:''}
        </div><div style="display:flex;gap:6px;flex-shrink:0;margin-left:12px;"><button class="btn bs bxs" onclick="openVoidModal('${r.entryId}','${r.stage}',undefined,undefined,undefined,'${r.id}')">🔍 Review</button><button class="btn bg bxs" onclick="rejectVoidRequest('${r.id}')">✕ Reject</button></div></div>`).join('');
  }else{
    reqPanel.style.display='none';
    if(reqBadge)reqBadge.style.display='none';
  }
}

export async function rejectVoidRequest(id){
  if(!confirm('Reject this void request? Nothing will be voided — the original entry stays exactly as it is.'))return;
  const {ok,error,networkError}=await apiPost('/api/void-request/reject',{id,changedBy:State.currentUser?.name});
  if(networkError){showToast('Network error — '+error,'err');return;}
  if(!ok){showToast(error||'Could not reject','err');return;}
  showToast('Void request rejected');
  await _refreshAndRender(['voidRequests'],renderAll);
}

export function renderEditLog(){
  if(!State.DB.editLog)State.DB.editLog=[];
  _renderVoidRequestsPanel();

  // Helper: get reference, grade, shade from entryId + stage
  function _elLookup(entryId, stage){
    const s=(stage||'').toLowerCase();
    let ref='—', grade='—', shade='—';
    if(s==='soft'||s==='stage'){
      const e=(State.DB.stageEntries||[]).find(x=>x.id===entryId);
      if(e){
        ref=e.lotId||'—';
        const lot=(State.DB.lots||[]).find(l=>l.id===e.lotId&&(!e.grade||l.grade===e.grade));
        if(lot) grade=lot.grade||'—';
      }
    } else if(s==='dye'){
      const d=(State.DB.dyeLots||[]).find(x=>x.id===entryId||x.dyeLotNo===entryId);
      if(d){ ref=d.dyeLotNo||'—'; shade=d.shade||'—'; }
    } else if(s==='wind'){
      const w=(State.DB.windEntries||[]).find(x=>x.id===entryId);
      if(w){
        const d=(State.DB.dyeLots||[]).find(x=>x.id===w.dyeLotId);
        if(d){ ref=d.dyeLotNo||'—'; shade=d.shade||'—'; }
      }
    } else if(s==='pack'){
      const p=(State.DB.packEntries||[]).find(x=>x.id===entryId);
      if(p){
        const d=(State.DB.dyeLots||[]).find(x=>x.id===p.dyeLotId);
        if(d){ ref=d.dyeLotNo||'—'; shade=d.shade||'—'; }
      }
    } else if(s==='dispatch'){
      const ds=(State.DB.dispatches||[]).find(x=>x.id===entryId);
      if(ds){
        const d=(State.DB.dyeLots||[]).find(x=>x.id===ds.dyeLotId);
        if(d){ ref=d.dyeLotNo||'—'; shade=d.shade||'—'; }
      }
    }
    return {ref, grade, shade};
  }

  // Split into edits vs voids vs overrides
  const _editRows = (State.DB.editLog||[]).filter(l=>{
    const f=(l.fieldChanged||l.field||'').toLowerCase();
    return f!=='status' && f!=='voided' && l.newVal!=='Voided';
  });
  // Jul 25 2026 fix — Override (bringing a Rejected/Voided entry back to
  // Approved) writes field:'Status' same as an actual Void does, so it
  // was silently landing in the Void Log tab even though it's the
  // opposite action. Pulled out into its own bucket, matched by newVal
  // containing "Override" rather than being "Voided".
  const _overrideRows = (State.DB.editLog||[]).filter(l=>{
    const f=(l.fieldChanged||l.field||'').toLowerCase();
    return f==='status' && (l.newVal||'').includes('Override');
  }).map(l=>({...l, _src:'edit'}));
  const _voidRows = [
    ...(State.DB.editLog||[]).filter(l=>{
      const f=(l.fieldChanged||l.field||'').toLowerCase();
      return (f==='status'||l.newVal==='Voided') && !(l.newVal||'').includes('Override');
    }).map(l=>({...l, _src:'edit'})),
    ...(State.DB.voidLog||[]).filter(v=>v.type==='rm-delivery').map(v=>({
      id:v.id, timestamp:v.timestamp||v.at||'',
      entryId:v.lotId||'', stage:'RM Delivery',
      fieldChanged:'Delivery Void', oldVal:v.delivery?JSON.stringify(v.delivery):'—',
      newVal:'Voided', reasonCat:'Void', reason:'—',
      changedBy:v.voidedBy||'—', _src:'voidlog'
    }))
  ];

  // Sep 8 2026 — real, direct feature built via direct discussion with
  // Priyam: clearing an active Hold now writes a real, permanent
  // record (worker.js, handleLotFlag/handleDyeLotFlag) — but nothing
  // ever displayed it. Deliberately its own tab, not folded into the
  // existing Override Log above (that one is for a completely
  // different, pre-existing thing — bringing a Rejected/Voided entry
  // back — mixing the two would conflate two unrelated systems).
  // Reuses the exact same table/columns as the other 3 tabs by
  // mapping onto the same row shape, rather than building a second,
  // separate table-rendering path.
  const _holdOverrideRows = (State.DB.holdOverrides||[]).map(h=>({
    id: h.id, timestamp: h.at||'',
    entryId: h.type==='dye' ? (h.dyeLotId||'') : (h.lotId||''),
    stage: h.type==='dye' ? 'Dye Lot' : 'RM',
    _ref: h.type==='dye' ? (h.dyeLotId||'—') : (h.lotId||'—'),
    _grade: h.grade||'—', _shade:'—',
    fieldChanged: 'Hold Cleared', oldVal: h.previousNote||'—', newVal: 'Cleared',
    reasonCat: 'Hold Override', reason: h.reason||'—',
    changedBy: h.by||'—', _src:'holdoverride'
  }));

  // Current tab
  const _curTab = window._elTab||'edits';

  const baseRows = _curTab==='edits' ? _editRows : _curTab==='overrides' ? _overrideRows : _curTab==='holdOverrides' ? _holdOverrideRows : _voidRows;
  // Sep 10 2026 — real, direct extension built via direct discussion
  // with Priyam: Reference/Grade/Shade were only ever computed at row
  // render time, per row, with no way to filter by them at all — only
  // Stage and By had a real filter. Computed once, upfront, for every
  // real row in this tab (not just the ones currently visible), so
  // both the filter dropdowns and the actual filtering below use the
  // exact same real values, and row rendering reuses them directly
  // instead of calling _elLookup a second time.
  const _enrichedRows = baseRows.map(l=>{
    const {ref,grade,shade} = l._src==='holdoverride' ? {ref:l._ref, grade:l._grade, shade:l._shade} : _elLookup(l.entryId, l.stage);
    return {...l, _ref2:ref, _grade2:grade, _shade2:shade, _field2:l.field||l.fieldChanged||'—', _reasonCat2:l.reasonCat||'—'};
  });

  // Filters
  const _fStage = document.getElementById('elf-stage')?.value||'';
  const _fBy    = document.getElementById('elf-by')?.value||'';
  const _fRef   = document.getElementById('elf-ref')?.value||'';
  const _fGrade = document.getElementById('elf-grade')?.value||'';
  const _fShade = document.getElementById('elf-shade')?.value||'';
  const _fField = document.getElementById('elf-field')?.value||'';
  const _fReasonCat = document.getElementById('elf-reasoncat')?.value||'';

  const filtered = _enrichedRows.filter(l=>
    (!_fStage||l.stage===_fStage)&&(!_fBy||(l.changedBy||l.by||'')===_fBy)&&
    (!_fRef||l._ref2===_fRef)&&(!_fGrade||l._grade2===_fGrade)&&(!_fShade||l._shade2===_fShade)&&
    (!_fField||l._field2===_fField)&&(!_fReasonCat||l._reasonCat2===_fReasonCat)
  );
  const stages   = [...new Set(baseRows.map(l=>l.stage).filter(Boolean))].sort();
  const users    = [...new Set(baseRows.map(l=>l.changedBy||l.by||'').filter(Boolean))].sort();
  const refs     = [...new Set(_enrichedRows.map(l=>l._ref2).filter(v=>v&&v!=='—'))].sort();
  const grades   = [...new Set(_enrichedRows.map(l=>l._grade2).filter(v=>v&&v!=='—'))].sort();
  const shades   = [...new Set(_enrichedRows.map(l=>l._shade2).filter(v=>v&&v!=='—'))].sort();
  const fields   = [...new Set(_enrichedRows.map(l=>l._field2).filter(v=>v&&v!=='—'))].sort();
  const reasonCats = [...new Set(_enrichedRows.map(l=>l._reasonCat2).filter(v=>v&&v!=='—'))].sort();

  // Build thead
  const _elTh = document.getElementById('editlog-thead');
  if(_elTh){
    _elTh.innerHTML=`
      <tr class="tbl-filter-row">
        <th></th>
        <th>${buildColFilter(stages,'elf-stage','Stage')}</th>
        <th>${buildColFilter(refs,'elf-ref','Reference')}</th>
        <th>${buildColFilter(grades,'elf-grade','Grade')}</th>
        <th>${buildColFilter(shades,'elf-shade','Shade')}</th>
        <th>${buildColFilter(fields,'elf-field','Field')}</th>
        <th></th><th></th>
        <th>${buildColFilter(reasonCats,'elf-reasoncat','Reason Cat.')}</th>
        <th></th>
        <th>${buildColFilter(users,'elf-by','By')}</th>
        <th></th>
        <th></th>
      </tr>
      <tr>
        ${sortTh('el','entryId','Entry ID')}
        <th>Stage</th>
        <th>Reference</th>
        <th>Grade</th>
        <th>Shade</th>
        ${sortTh('el','fieldChanged','Field')}
        ${sortTh('el','oldVal','Old')}
        <th>New</th>
        <th>Reason Cat.</th>
        <th>Reason Text</th>
        ${sortTh('el','changedBy','By')}
        ${sortTh('el','timestamp','Time')}
        <th>Actions</th>
      </tr>`;
    if(_fStage)document.getElementById('elf-stage').value=_fStage;
    if(_fBy)document.getElementById('elf-by').value=_fBy;
    if(_fRef)document.getElementById('elf-ref').value=_fRef;
    if(_fGrade)document.getElementById('elf-grade').value=_fGrade;
    if(_fShade)document.getElementById('elf-shade').value=_fShade;
    if(_fField)document.getElementById('elf-field').value=_fField;
    if(_fReasonCat)document.getElementById('elf-reasoncat').value=_fReasonCat;
  }

  // Sort
  const logs = _sortState.el?.col
    ? sortArr(filtered, _sortState.el.col, _sortState.el.dir)
    : [...filtered].sort((a,b)=>(b.timestamp||'').localeCompare(a.timestamp||''));

  // Render rows
  const tbody = document.getElementById('editlog-tbody');
  if(!tbody) return;
  tbody.innerHTML = logs.map(l=>{
    const ref=l._ref2, grade=l._grade2, shade=l._shade2;
    const field = l._field2;
    const by = l.changedBy||l.by||'—';
    const reasonCat = l._reasonCat2;
    const reasonText = l.reasonText||l.reason||'—';
    const stageColor = {soft:'var(--cs)',dye:'var(--cd)',wind:'var(--cw)',pack:'var(--cp)',dispatch:'var(--gr)'}[(l.stage||'').toLowerCase()]||'var(--mu)';
    return `<tr>
      <td class="mono" style="font-size:0.72rem;color:var(--ac);font-weight:700">${l.entryId||'—'}</td>
      <td><span class="badge" style="background:${stageColor}20;color:${stageColor};font-size:0.6rem;padding:2px 6px;border-radius:4px">${l.stage||'—'}</span></td>
      <td class="mono" style="font-size:0.72rem;color:var(--ac)">${ref}</td>
      <td style="font-size:0.72rem;color:var(--mu)">${grade}</td>
      <td style="font-size:0.72rem;color:var(--cd)">${shade}</td>
      <td style="font-size:0.72rem;font-weight:600">${field}</td>
      <td class="mono" style="font-size:0.68rem;color:var(--re)">${l.oldVal||'—'}</td>
      <td class="mono" style="font-size:0.68rem;color:var(--gr)">${l.newVal||'—'}</td>
      <td style="font-size:0.68rem;color:var(--mu)">${reasonCat}</td>
      <td style="font-size:0.68rem;max-width:160px;word-break:break-word">${reasonText==='—'?'—':reasonText}</td>
      <td style="font-size:0.72rem;font-weight:600">${by}</td>
      <td style="font-size:0.68rem;color:var(--mu);white-space:nowrap">${fmtRelTS(l.timestamp)}</td>
      <td>${_curTab==='edits'&&!l.undoneAt&&l.reasonCat!=='undo'&&(State.currentUser?.role==='admin'||State.currentUser?.role==='manager')?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Undo" onclick="openUndoPwdModal('${l.id}')">↶</button>`:l.undoneAt?`<span style="font-size:0.65rem;color:var(--mu)">Undone</span>`:''}</td>
    </tr>`;
  }).join('')||`<tr><td colspan="13"><div class="empty"><div class="empty-icon">📝</div><div class="empty-text">No ${_curTab==='edits'?'edits':_curTab==='overrides'?'overrides':_curTab==='holdOverrides'?'hold overrides':'voids'} on record</div></div></td></tr>`;
}

export function addEditLog(entryId,stage,fieldChanged,oldVal,newVal,reasonCat,reason,changedBy,impactNote=''){if(!State.DB.editLog)State.DB.editLog=[];State.DB.editLog.push({id:'EL-'+Date.now(),timestamp:nowTS(),entryId,stage,fieldChanged,oldVal:String(oldVal),newVal:String(newVal),reasonCat,reason,changedBy,impactNote});}

export function addToEditLog(entryId,stage,field,oldVal,newVal,reasonCat,reasonText,impactNote,type='edit'){if(!State.DB.editLog)State.DB.editLog=[];State.DB.editLog.push({id:'EL-'+Date.now(),timestamp:nowTS(),entryId,stage,field,oldVal:String(oldVal||''),newVal:String(newVal||''),reasonCat,reasonText,impactNote:impactNote||'',changedBy:State.currentUser.name,type});}

export function clearEditLogFilters(){['elf-stage','elf-type','elf-by'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';_tableFilters[id]='';});renderEditLog();setTimeout(()=>_updateClearBtn('elf-'),0);}

export function exportEditLog(){
  const allLogs=(State.DB.editLog||[]).sort((a,b)=>(b.timestamp||'').localeCompare(a.timestamp||''));
  const rows=[['Entry ID','Stage','Reference','Grade','Shade','Field','Old Value','New Value','Reason Category','Reason Text','By','Time']];
  allLogs.forEach(l=>{
    // Handle both schemas: addEditLog uses fieldChanged/reason, addToEditLog uses field/reasonText
    const field=l.field||l.fieldChanged||'—';
    const reasonText=l.reasonText||l.reason||'—';
    const by=l.changedBy||l.by||'—';
    // Lookup reference, grade, shade
    const s=(l.stage||'').toLowerCase();
    let ref='—',grade='—',shade='—';
    if(s==='soft'||s==='stage'){
      const e=(State.DB.stageEntries||[]).find(x=>x.id===l.entryId);
      if(e){ref=e.lotId||'—';const lot=(State.DB.lots||[]).find(x=>x.id===e.lotId);if(lot)grade=lot.grade||'—';}
    }else if(s==='dye'){
      const d=(State.DB.dyeLots||[]).find(x=>x.id===l.entryId||x.dyeLotNo===l.entryId);
      if(d){ref=d.dyeLotNo||'—';shade=d.shade||'—';}
    }else if(s==='wind'){
      const w=(State.DB.windEntries||[]).find(x=>x.id===l.entryId);
      if(w){const d=(State.DB.dyeLots||[]).find(x=>x.id===w.dyeLotId);if(d){ref=d.dyeLotNo||'—';shade=d.shade||'—';}}
    }else if(s==='pack'){
      const p=(State.DB.packEntries||[]).find(x=>x.id===l.entryId);
      if(p){const d=(State.DB.dyeLots||[]).find(x=>x.id===p.dyeLotId);if(d){ref=d.dyeLotNo||'—';shade=d.shade||'—';}}
    }else if(s==='dispatch'){
      const ds=(State.DB.dispatches||[]).find(x=>x.id===l.entryId);
      if(ds){const d=(State.DB.dyeLots||[]).find(x=>x.id===ds.dyeLotId);if(d){ref=d.dyeLotNo||'—';shade=d.shade||'—';}}
    }
    rows.push([l.entryId,l.stage,ref,grade,shade,field,l.oldVal,l.newVal,l.reasonCat,reasonText,by,fmtTS(l.timestamp)]);
  });
  const csv=rows.map(r=>r.map(v=>'"'+(String(v||'').replace(/"/g,'""'))+'"').join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download='ThreadControl_EditLog_'+today()+'.csv';a.click();
}

export function renderRMEditLog(){const log=[...(State.DB.editLog||[]).filter(e=>e.entryType==='rm'||e.originalLotId)].reverse();const el=document.getElementById('rm-editlog-content');if(!el)return;if(!log.length){el.innerHTML='<div class="empty empty-text" style="padding:20px">✓ No edits on record — all entries are original</div>';return;}
el.innerHTML=`<div class="tbl"><table><thead><tr><th>Time</th><th>Lot</th><th>Changed By</th><th>Reason</th><th>What Changed</th></tr></thead><tbody>${log.map(e=>{
      const changes=[];
      Object.keys(e.after||{}).forEach(k=>{
        if(String(e.before[k])!==String(e.after[k])){
          changes.push(`<span style="color:var(--mu)">${k}:</span><span style="color:var(--re);text-decoration:line-through">${e.before[k]||'—'}</span>→<span style="color:var(--gr)">${e.after[k]||'—'}</span>`);
        }
      });
      return `<tr><td class="mono"style="font-size:0.65rem;white-space:nowrap">${fmtTS(e.at)}</td><td class="mono">${e.originalLotId}${e.currentLotId!==e.originalLotId?` → ${e.currentLotId}`:''}</td><td style="font-size:0.72rem">${e.by}<span style="color:var(--mu)">(${e.role})</span></td><td style="font-size:0.72rem;color:var(--mu);font-style:italic;max-width:180px">"${e.reason}"</td><td style="font-size:0.72rem;line-height:1.8">${changes.join('<br>')||'—'}</td></tr>`;
    }).join('')}</tbody></table></div>`;}

export function setupRMEditLogTab(){}

window.switchEditLogTab = switchEditLogTab;
window.renderEditLog = renderEditLog;
window.exportEditLog = exportEditLog;
window.clearEditLogFilters = clearEditLogFilters;
window.setupRMEditLogTab = setupRMEditLogTab;
window.loadDailyCheckReport = loadDailyCheckReport;
window._switchDailyCheckSubTab = _switchDailyCheckSubTab;

// Aug 26 2026 — Module split effort, folded here rather than into a
// new file: the shared Edit and Void systems used across Soft/Dye/
// Wind/Pack/Dispatch genuinely belong alongside Edit Log's own
// history-viewing code — this file becomes the complete, real home
// for everything about editing and voiding, both doing it and
// reviewing it. fmtN deliberately stays in pages.js and is imported
// from there, confirmed genuinely shared elsewhere too.
// Extracted byte-for-byte from pages.js.

// Sep 19 2026 — option list for the Machine / Worker dropdowns in the Edit form. The record's CURRENT value is always
// present (even if it has since been removed from Masters) so opening Edit never silently blanks it.
function _efOpts(list,current){const arr=(list||[]).slice();if(current&&!arr.includes(current))arr.unshift(current);return '<option value="">Select...</option>'+arr.map(v=>`<option value="${v}"${v===current?' selected':''}>${v}</option>`).join('');}

export function openEditEntryModal(id,stage){const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';const isSup=State.currentUser?.role==='supervisor'||isAdmin;if(!isAdmin&&!isSup){showToast('No permission','err');return;}
document.getElementById('edit-entry-id').value=id;document.getElementById('edit-entry-stage').value=stage;document.getElementById('edit-entry-alert').innerHTML='';document.getElementById('edit-reason-cat').value='';document.getElementById('edit-reason-text').value='';document.getElementById('edit-pwd').value='';document.getElementById('edit-pwd-row').style.display=isAdmin?'none':'';
// Aug 6 2026 — real, new tool: Reassign Source, only genuinely meaningful
// for Dye entries (RM lots don't have a "sources" concept the same way).
// Tab bar only shown for stage==='dye'; always resets to the Edit tab by
// default when the modal opens, regardless of which tab was last open.
const tabbar=document.getElementById('edit-entry-tabbar');
tabbar.style.display=stage==='dye'?'flex':'none';
_switchEditEntryTab('output');
const fields=document.getElementById('edit-entry-fields');fields.innerHTML='';if(stage==='soft'){const e=State.DB.stageEntries.find(x=>x.id===id);if(!e)return;fields.innerHTML=`
      <div class="fg"><label class="fl">In Bags</label><input class="fi" type="number" id="ef-in-units" value="${e.inUnits||0}"></div><div class="fg"><label class="fl">In Weight (kg)</label><input class="fi" type="number" step="0.01" id="ef-in-weight-soft" value="${e.inWeight||0}"></div><div class="fg"><label class="fl">Machine</label><select class="fs" id="ef-start-machine">${_efOpts(machinesForStage('Soft'),e.machine||'')}</select></div><div class="fg"><label class="fl">Start Worker</label><select class="fs" id="ef-start-worker">${_efOpts(workersSorted(),e.startWorker||'')}</select></div><div class="fg"><label class="fl">Start Note</label><input class="fi" id="ef-start-note" value="${e.startNote||''}"></div><div class="fg"><label class="fl">Out Bags</label><input class="fi" type="number" id="ef-out-units" value="${e.outUnits||0}"></div><div class="fg"><label class="fl">Out Weight (kg)</label><input class="fi" type="number" step="0.01" id="ef-out-weight" value="${e.outWeight||0}"></div><div class="fg"><label class="fl">End Note</label><input class="fi" id="ef-end-note" value="${e.endNote||''}"></div>`;}else if(stage==='wind'){const e=(State.DB.windEntries||[]).find(x=>x.id===id);if(!e)return;fields.innerHTML=`
      <div class="fg"><label class="fl">In Cones</label><input class="fi" type="number" id="ef-in-cones-wind" value="${e.inCones||0}"></div><div class="fg"><label class="fl">In Weight (kg)</label><input class="fi" type="number" step="0.01" id="ef-in-weight" value="${e.inWeight||0}"></div><div class="fg"><label class="fl">Machine</label><select class="fs" id="ef-start-machine">${_efOpts(machinesForStage('Wind'),e.machine||'')}</select></div><div class="fg"><label class="fl">Start Worker</label><select class="fs" id="ef-start-worker">${_efOpts(workersSorted(),e.startWorker||'')}</select></div><div class="fg"><label class="fl">Start Notes</label><input class="fi" id="ef-wind-start-note" value="${e.notes||''}"></div><div class="fg"><label class="fl">Out Cones</label><input class="fi" type="number" id="ef-out-cones-wind" value="${e.outCones||0}"></div><div class="fg"><label class="fl">Out Weight (kg)</label><input class="fi" type="number" step="0.01" id="ef-out-weight" value="${e.outWeight||0}"></div><div class="fg"><label class="fl">End Notes</label><input class="fi" id="ef-wind-end-note" value="${e.endNotes||''}"></div>`;}else if(stage==='pack'){const e=(State.DB.packEntries||[]).find(x=>x.id===id);if(!e)return;fields.innerHTML=`
      <div class="fg"><label class="fl">In Cones</label><input class="fi" type="number" id="ef-in-cones-pack" value="${e.inCones||0}"></div><div class="fg"><label class="fl">In Weight (kg)</label><input class="fi" type="number" step="0.01" id="ef-in-weight-pack" value="${e.inWeight||0}"></div><div class="fg"><label class="fl">Bags Out</label><input class="fi" type="number" id="ef-bags" value="${e.bags||0}"></div><div class="fg"><label class="fl">Weight (kg)</label><input class="fi" type="number" step="0.01" id="ef-weight" value="${e.weight||0}"></div><div class="fg"><label class="fl">Worker</label><select class="fs" id="ef-pack-worker">${_efOpts(workersSorted(),e.worker||'')}</select></div><div class="fg"><label class="fl">Notes</label><input class="fi" id="ef-pack-notes" value="${e.notes||''}"></div>`;}else if(stage==='dye'){const d=(State.DB.dyeLots||[]).find(x=>x.id===id);if(!d)return;
    const _m=/^DYE-(\d+)-(\d+)(?:-(.+))?$/.exec(d.dyeLotNo||'');
    const _fy=_m?_m[1]:'',_serial=_m?_m[2]:'',_sub=_m?(_m[3]||''):'';
    const _curFY=currentFY();const _prevFY=String(parseInt(_curFY.slice(0,2))-1)+String(parseInt(_curFY.slice(2))-1);
    const _fyOpts=[...new Set([_fy,_curFY,_prevFY].filter(Boolean))].map(f=>`<option value="${f}"${f===_fy?' selected':''}>${f.slice(0,2)}-${f.slice(2)}</option>`).join('');
    fields.innerHTML=`
      <div class="fg fg-full"><label class="fl">Shade</label><input class="fi" type="text" id="ef-shade" value="${d.shade||''}"></div>
      <div class="fg-full" style="display:grid;grid-template-columns:130px 1fr 100px;gap:8px;"><div><label class="fl">FY</label><select class="fs" id="ef-dye-fy" style="color:var(--ac);font-weight:700;">${_fyOpts}</select></div><div><label class="fl">Serial No</label><input class="fi" type="number" min="1" id="ef-dye-serial" value="${_serial}" style="color:var(--ac);font-weight:700;"></div><div><label class="fl">Sub (opt)</label><input class="fi" id="ef-dye-sub" value="${_sub}"></div></div>
      <div class="fg"><label class="fl" style="color:var(--mu)">Input (kg/cones) — read-only, see Edit Input tab</label><input class="fi" type="text" value="${fmt(d.totalInWeight||0)}kg / ${d.totalInCones||0}c" disabled></div><div class="fg"><label class="fl">Out Cones</label><input class="fi" type="number" id="ef-out-cones" value="${d.outCones||0}"></div><div class="fg"><label class="fl">Out Weight (kg)</label><input class="fi" type="number" step="0.01" id="ef-out-weight" value="${d.outWeight||0}"></div><div class="fg"><label class="fl">End Notes</label><input class="fi" type="text" id="ef-notes" value="${d.endNote||''}"></div>`;}else if(stage==='recycleSoft'){const e=(State.DB.recycleSoft||[]).find(x=>x.id===id);if(!e)return;fields.innerHTML=`
      <div class="fg"><label class="fl">In Cones</label><input class="fi" type="number" id="ef-rcs-in-cones" value="${e.inCones||0}"></div><div class="fg"><label class="fl">In Weight (kg)</label><input class="fi" type="number" step="0.01" id="ef-rcs-in-weight" value="${e.inWeight||0}"></div><div class="fg"><label class="fl">Machine</label><select class="fs" id="ef-rcs-machine">${_efOpts(machinesForStage('Soft'),e.machine||'')}</select></div><div class="fg"><label class="fl">Start Worker</label><select class="fs" id="ef-rcs-worker">${_efOpts(workersSorted(),e.startWorker||'')}</select></div><div class="fg"><label class="fl">Start Note</label><input class="fi" id="ef-rcs-start-note" value="${e.startNote||''}"></div><div class="fg"><label class="fl">Out Cones</label><input class="fi" type="number" id="ef-rcs-out-cones" value="${e.outCones||0}"></div><div class="fg"><label class="fl">Out Weight (kg)</label><input class="fi" type="number" step="0.01" id="ef-rcs-out-weight" value="${e.outWeight||0}"></div><div class="fg"><label class="fl">End Note</label><input class="fi" id="ef-rcs-end-note" value="${e.endNote||''}"></div>`;}else if(stage==='dispatch'){const d=(State.DB.dispatches||[]).find(x=>x.id===id);if(!d)return;const partyOpts=(State.DB.parties||[]).map(p=>`<option value="${p}" ${p===d.party?'selected':''}>${p}</option>`).join('');fields.innerHTML=`
      <div class="fg"><label class="fl">Bags</label><input class="fi" type="number" id="ef-bags" value="${d.bags||0}"></div><div class="fg"><label class="fl">Weight (kg)</label><input class="fi" type="number" step="0.01" id="ef-weight" value="${d.weight||0}"></div><div class="fg"><label class="fl">Party</label><select class="fs" id="ef-party"><option value="">Select...</option>${partyOpts}</select></div><div class="fg"><label class="fl">Date</label><input class="fi" type="date" id="ef-date" value="${d.date||''}"></div><div class="fg"><label class="fl">Invoice No</label><input class="fi" id="ef-invoice" value="${d.invoiceNo||''}"></div>`;}
openModal('edit-entry-modal-overlay');}

export function _switchEditEntryTab(tab) {
  document.getElementById('eet-output').classList.toggle('active', tab === 'output');
  document.getElementById('eet-input').classList.toggle('active', tab === 'input');
  document.getElementById('edit-tab-content').style.display = tab === 'output' ? '' : 'none';
  document.getElementById('input-tab-content').style.display = tab === 'input' ? '' : 'none';
  if (tab === 'input') {
    _populateEditInputSources();
    _populateEditInputStartDetails();
    _fetchTrueSoftAvailable(() => {});
    // Sep 10 2026 — real, direct fix built via direct discussion with
    // Priyam, establishing one clear rule across the whole app: for
    // Edit, only Supervisor enters a password. This row was always
    // shown regardless of role — matching the same pattern already
    // used for the Edit Output tab's own password row.
    const isAdmin = State.currentUser?.role === 'admin' || State.currentUser?.role === 'manager';
    document.getElementById('edit-input-pwd-row').style.display = isAdmin ? 'none' : '';
  }
}

// Sep 10 2026 — real, direct new feature built via a genuinely long,
// careful design discussion with Priyam, from his own root-cause
// diagnosis: editing a Dye entry only ever let someone overwrite the
// aggregate total directly — never the real sources underneath it,
// even though that total is only ever calculated by summing them.
// Shows each real, existing source as its own editable row — weight
// and cones directly correctable, or removable entirely if the source
// itself was wrong — with a "Remove" option, alongside the existing,
// already-proven "Add Source" section for adding a corrected
// replacement (matching what a full or partial Reassign already did,
// now just one shape of this same, more general capability).
// Sep 10 2026 — real, direct new feature built via a genuinely
// careful, field-by-field comparison discussion with Priyam: Dye
// Start sets 4 real things together — the sources, Machine, Start
// Worker, and Formula/Notes — but only sources were ever correctable
// afterward. Populates the same real Machine/Worker options Dye
// Start itself uses, pre-filled with this exact dye lot's own real,
// existing values.
function _populateEditInputStartDetails() {
  const dyeLotId = document.getElementById('edit-entry-id').value;
  const d = (State.DB.dyeLots || []).find(x => x.id === dyeLotId);
  if (!d) return;
  const opts = (arr, empty = 'Select...') => `<option value="">${empty}</option>${arr.map(v => `<option value="${v}">${v}</option>`).join('')}`;
  const machineSel = document.getElementById('edit-input-machine');
  const workerSel = document.getElementById('edit-input-worker');
  machineSel.innerHTML = opts(machinesForStage('Dye'));
  workerSel.innerHTML = opts(workersSorted());
  machineSel.value = d.machine || '';
  workerSel.value = d.startWorker || '';
  document.getElementById('edit-input-notes').value = d.startNote ?? d.notes ?? '';
}

function _populateEditInputSources() {
  const dyeLotId = document.getElementById('edit-entry-id').value;
  const d = (State.DB.dyeLots || []).find(x => x.id === dyeLotId);
  const container = document.getElementById('edit-input-existing-sources');
  if (!d || !container) return;
  document.getElementById('dye-sources-list').innerHTML = '';
  document.getElementById('edit-input-alert').innerHTML = '';
  const label = s => s.sourceType === 'dead' ? `Dead Stock ${s.deadStockId} — ${s.grade || ''}`
    : s.sourceType === 'recycle' ? `Recycle ${s.recycleId} (${s.pool === 'softened' ? 'Softened' : 'On Steel'}) — ${s.grade || ''}`
    : s.sourceType === 'residual' ? `Residual ${s.residualId} — ${s.grade || ''}`
    : `${s.lotId} — ${s.grade || ''} — ${s.vendor || ''}`;
  container.innerHTML = (d.sources || []).map((s, i) => `
    <div class="existing-src-row" data-idx="${i}" data-src='${JSON.stringify(s).replace(/'/g, "&apos;")}' style="background:var(--s2);border:1px solid var(--b1);border-radius:8px;padding:10px;margin-bottom:8px;">
      <div style="font-size:0.75rem;color:var(--ac);font-weight:700;margin-bottom:6px;">${label(s)}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:6px;align-items:end;">
        <div><label class="fl" style="font-size:0.6rem;">Cones</label><input class="fi" type="number" step="1" value="${s.cones || 0}" data-field="cones"></div>
        <div><label class="fl" style="font-size:0.6rem;">Weight (kg)</label><input class="fi" type="number" step="0.01" value="${s.weight || 0}" data-field="weight"></div>
        <button class="btn btn-ghost btn-xs" style="color:var(--re)" onclick="this.closest('.existing-src-row').remove()">✕ Remove</button>
      </div>
    </div>
  `).join('');
}

export async function submitEditDyeInput(btnEl) {
  const setAlert = msg => { document.getElementById('edit-input-alert').innerHTML = `<div class="alert-err" style="margin-bottom:8px">${msg}</div>`; };
  const id = document.getElementById('edit-entry-id').value;
  const reasonCat = document.getElementById('edit-input-reason-cat').value;
  const reasonText = document.getElementById('edit-input-reason-text').value.trim();
  if (!reasonCat) { setAlert('Select reason category'); return; }
  if (reasonText.length < 10) { setAlert('Reason must be at least 10 characters'); return; }
  // Sep 10 2026 — real, direct new feature: the same 3 start-time
  // fields Dye Start itself requires, now correctable here too.
  const machine = document.getElementById('edit-input-machine').value;
  const startWorker = document.getElementById('edit-input-worker').value;
  const startNote = document.getElementById('edit-input-notes').value.trim();
  if (!machine) { setAlert('Select machine'); return; }
  if (!startWorker) { setAlert('Select start worker'); return; }
  if (!startNote) { setAlert('Formula / Notes is required'); return; }

  const sources = [];
  document.querySelectorAll('#edit-input-existing-sources .existing-src-row').forEach(row => {
    const s = JSON.parse(row.dataset.src.replace(/&apos;/g, "'"));
    const weight = parseFloat(row.querySelector('[data-field="weight"]').value) || 0;
    const cones = parseFloat(row.querySelector('[data-field="cones"]').value) || 0;
    if (weight > 0) sources.push({ ...s, weight, cones });
  });
  document.querySelectorAll('#dye-sources-list > div').forEach(row => {
    const lotSel = row.querySelector('[id$="-lot"]');
    const weightInput = row.querySelector('[data-field="weight"]');
    const conesInput = row.querySelector('[data-field="cones"]');
    if (!lotSel || !lotSel.value || !weightInput?.value) return;
    const parsed = parseLotSelectValue(lotSel.value);
    sources.push({ sourceType: 'rm', lotId: parsed.lotId, grade: parsed.grade, vendor: parsed.vendor, weight: parseFloat(weightInput.value) || 0, cones: parseFloat(conesInput?.value) || 0 });
  });
  if (sources.length === 0) { setAlert('At least one source is required — a row with 0 weight is treated as removed'); return; }

  // Sep 10 2026 — real, genuine bug found while directly auditing this,
  // per Priyam's own real report ("editing the dye it did not
  // submitted"): this relied on the bare, non-standard, implicit
  // global `event` — a legacy browser feature that doesn't exist at
  // all in some real browsers (Firefox, in particular), and even where
  // it does exist, isn't guaranteed to still be valid by this exact
  // point. Since this line ran BEFORE the try/catch below even starts,
  // the resulting ReferenceError was never caught — a fully silent
  // failure, with no error ever shown, exactly matching what was
  // reported. Fixed by passing the real button element in directly
  // from the actual onclick handler, instead of relying on an
  // implicit, unreliable global.
  const btn = btnEl;
  if (btn) { btn.disabled = true; btn.textContent = 'Checking...'; }
  // Sep 10 2026 — real, direct new feature built via direct discussion
  // with Priyam, establishing one clear rule across the whole app:
  // every real action shows a genuine preview of its actual effect
  // before committing. This first call is read-only (dryRun) — the
  // real save only happens if Confirm is clicked on the preview shown
  // next, reusing the exact same real validation either way.
  try {
    const res = await fetch(WORKER_URL + '/api/dye/edit-input', {
      method: 'POST', headers: _postHeaders(),
      body: JSON.stringify({ id, sources, reasonCat, reasonText, machine, startWorker, startNote, dryRun: true }),
    });
    const data = await res.json();
    if (btn) { btn.disabled = false; btn.textContent = '🔍 Preview Changes'; }
    if (!res.ok || data.error) { setAlert(data.error || 'Could not preview'); return; }
    _pendingDyeInputEditBody = { id, sources, reasonCat, reasonText, machine, startWorker, startNote };
    _renderDyeInputPreview(data);
    closeModal('edit-entry-modal-overlay');
    const isAdmin = State.currentUser?.role === 'admin' || State.currentUser?.role === 'manager';
    document.getElementById('dyeinput-preview-pwd-row').style.display = isAdmin ? 'none' : '';
    document.getElementById('dyeinput-preview-pwd').value = '';
    document.getElementById('dyeinput-preview-alert').innerHTML = '';
    openModal('dyeinput-preview-modal-overlay');
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '🔍 Preview Changes'; }
    setAlert('Network error: ' + e.message);
  }
}

let _pendingDyeInputEditBody = null;

function _renderDyeInputPreview(data) {
  const box = document.getElementById('dyeinput-preview-body');
  const weightChanged = Math.abs(data.newTotalWeight - data.oldTotalWeight) > 0.01;
  const conesChanged = data.newTotalCones !== data.oldTotalCones;
  // Sep 10 2026 — real, direct new feature built via a genuinely
  // careful discussion with Priyam, from his own real screenshot: the
  // combined total alone can read as "no change" even when a real
  // redistribution happened between two different sources (one lot's
  // claim going up while another's goes down, netting to the same
  // total). Shows each source that actually moved as its own row,
  // above the total, so a shift like that is genuinely visible —
  // skips any source whose weight and cones both stayed the same,
  // so an untouched source isn't shown as if something changed.
  const changedSources = (data.sourceDiffs || []).filter(s => Math.abs(s.newWeight - s.oldWeight) > 0.01 || s.newCones !== s.oldCones);
  const sourceRowsHtml = changedSources.map(s => {
    const wUp = s.newWeight > s.oldWeight + 0.01, wDown = s.newWeight < s.oldWeight - 0.01;
    const wColor = wUp ? 'var(--gr)' : wDown ? 'var(--re)' : '';
    const cUp = s.newCones > s.oldCones, cDown = s.newCones < s.oldCones;
    const cColor = cUp ? 'var(--gr)' : cDown ? 'var(--re)' : '';
    return `
      <div style="padding:8px 0;border-bottom:1px solid var(--bd)">
        <div style="font-size:.75rem;color:var(--mu);margin-bottom:3px">${s.lotId} – ${s.grade} – ${s.vendor}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div style="font-size:.9rem"><span style="color:var(--mu)">${fmt(s.oldWeight)}kg</span> → <span style="font-weight:800;${wColor ? `color:${wColor}` : ''}">${fmt(s.newWeight)}kg</span></div>
          <div style="font-size:.9rem"><span style="color:var(--mu)">${s.oldCones}</span> → <span style="font-weight:800;${cColor ? `color:${cColor}` : ''}">${s.newCones}</span></div>
        </div>
      </div>`;
  }).join('');
  const startDetailsChanged = data.oldMachine !== data.newMachine || data.oldStartWorker !== data.newStartWorker || data.oldStartNote !== data.newStartNote;
  const startDetailsRows = [];
  if (data.oldMachine !== data.newMachine) startDetailsRows.push(`<div style="font-size:.82rem"><span style="color:var(--mu)">Machine: ${data.oldMachine || '—'}</span> → <span style="font-weight:800">${data.newMachine}</span></div>`);
  if (data.oldStartWorker !== data.newStartWorker) startDetailsRows.push(`<div style="font-size:.82rem"><span style="color:var(--mu)">Start Worker: ${data.oldStartWorker || '—'}</span> → <span style="font-weight:800">${data.newStartWorker}</span></div>`);
  if (data.oldStartNote !== data.newStartNote) startDetailsRows.push(`<div style="font-size:.82rem"><span style="color:var(--mu)">Formula/Notes changed</span></div>`);
  box.innerHTML = `
    ${sourceRowsHtml}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:10px 0;${sourceRowsHtml ? 'padding-top:2px' : ''}">
      <div><div style="font-size:.6rem;color:var(--mu);text-transform:uppercase;letter-spacing:.08em">Total Weight</div><div style="font-size:.95rem"><span style="color:var(--mu)">${fmt(data.oldTotalWeight)}kg</span> → <span style="font-weight:800;${weightChanged ? 'color:var(--ac)' : ''}">${fmt(data.newTotalWeight)}kg</span></div></div>
      <div><div style="font-size:.6rem;color:var(--mu);text-transform:uppercase;letter-spacing:.08em">Total Cones</div><div style="font-size:.95rem"><span style="color:var(--mu)">${data.oldTotalCones}</span> → <span style="font-weight:800;${conesChanged ? 'color:var(--ac)' : ''}">${data.newTotalCones}</span></div></div>
    </div>
    ${startDetailsChanged ? `<div style="border-top:1px solid var(--bd);padding-top:8px;margin-bottom:10px;">${startDetailsRows.join('')}</div>` : ''}
    ${(data.ownOutputWeight > 0.01 || data.ownOutputCones > 0.01) ? `<div style="background:var(--s2);border-radius:8px;padding:8px 10px;font-size:.7rem;color:var(--mu)">This batch's own recorded output already shows ${fmt(data.ownOutputWeight)}kg / ${data.ownOutputCones} cones produced from it — total input can't drop below this.</div>` : ''}
  `;
}

export async function _doDyeInputEditSave() {
  const setAlert = msg => { document.getElementById('dyeinput-preview-alert').innerHTML = `<div class="alert-err" style="margin-bottom:8px">${msg}</div>`; };
  const body = _pendingDyeInputEditBody;
  if (!body) return;
  const isAdmin = State.currentUser?.role === 'admin' || State.currentUser?.role === 'manager';
  let pwd = '', username = State.currentUser?.username || '';
  if (!isAdmin) { pwd = document.getElementById('dyeinput-preview-pwd').value; if (!pwd) { setAlert('Enter your password'); return; } }
  const _pbtn = document.getElementById('dyeinput-preview-confirm-btn');
  if (_pbtn) { _pbtn.disabled = true; }
  try {
    const res = await fetch(WORKER_URL + '/api/dye/edit-input', {
      method: 'POST', headers: _postHeaders(),
      body: JSON.stringify({ ...body, password: pwd, username, changedBy: State.currentUser?.name || username }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) { setAlert(data.error || 'Could not save'); if (_pbtn) _pbtn.disabled = false; return; }
    closeModal('dyeinput-preview-modal-overlay');
    showToast('Dye input updated', 'success');
    _pendingDyeInputEditBody = null;
    // Sep 10 2026 — real, direct fix built alongside
    // _openReassignFromGuided's own broken tab reference: if this
    // edit was opened from the Guided Reassign dialog (after a Soft
    // void left this batch short), mark it fixed now that the real
    // source correction genuinely succeeded. Safely does nothing
    // otherwise.
    _markGuidedReassignFixed(body.id);
    await _refreshAndRender(['dyeLots', 'editLog', 'lotFlags', 'dyeLotFlags'], renderAll);
  } catch (e) {
    setAlert('Error: ' + e.message);
    if (_pbtn) _pbtn.disabled = false;
  }
}

export async function submitEditEntry(){
  const setAlert=msg=>{document.getElementById('edit-entry-alert').innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;};
  const id=document.getElementById('edit-entry-id').value;const stage=document.getElementById('edit-entry-stage').value;const reasonCat=document.getElementById('edit-reason-cat').value;const reasonText=document.getElementById('edit-reason-text').value.trim();const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';
  if(!reasonCat){setAlert('Select reason category');return;}
  if(reasonText.length<10){setAlert('Reason must be at least 10 characters');return;}
  let pwd='';
  if(!isAdmin){pwd=document.getElementById('edit-pwd').value;const matched=await _verifyPasswordViaWorker(pwd,State.currentUser.username);
    if(!matched){setAlert('Incorrect password');return;}}
  const body={id,stage,reasonCat,reasonText,isAdmin,password:pwd,username:State.currentUser?.username,changedBy:State.currentUser.name};
  if(stage==='soft'){
    body.inUnits=parseFloat(document.getElementById('ef-in-units')?.value)||undefined;
    body.inWeight=parseFloat(document.getElementById('ef-in-weight-soft')?.value)||undefined;
    body.outUnits=parseFloat(document.getElementById('ef-out-units')?.value)||0;
    body.outWeight=parseFloat(document.getElementById('ef-out-weight')?.value)||0;
    body.startNote=document.getElementById('ef-start-note')?.value||'';
    body.endNote=document.getElementById('ef-end-note')?.value||'';
    body.machine=document.getElementById('ef-start-machine')?.value;
    body.startWorker=document.getElementById('ef-start-worker')?.value;
  }else if(stage==='wind'){
    body.inCones=parseInt(document.getElementById('ef-in-cones-wind')?.value)||undefined;
    body.inWeight=parseFloat(document.getElementById('ef-in-weight')?.value)||0;
    body.outCones=parseInt(document.getElementById('ef-out-cones-wind')?.value)||undefined;
    body.outWeight=parseFloat(document.getElementById('ef-out-weight')?.value)||0;
    body.machine=document.getElementById('ef-start-machine')?.value;
    body.startWorker=document.getElementById('ef-start-worker')?.value;
    body.startNote=document.getElementById('ef-wind-start-note')?.value||'';
    body.endNote=document.getElementById('ef-wind-end-note')?.value||'';
  }else if(stage==='pack'){
    body.inCones=parseInt(document.getElementById('ef-in-cones-pack')?.value)||undefined;
    body.inWeight=parseFloat(document.getElementById('ef-in-weight-pack')?.value)||undefined;
    body.bags=parseInt(document.getElementById('ef-bags')?.value)||0;
    body.weight=parseFloat(document.getElementById('ef-weight')?.value)||0;
    body.worker=document.getElementById('ef-pack-worker')?.value;
    body.notes=document.getElementById('ef-pack-notes')?.value||'';
  }else if(stage==='dye'){
    // Sep 10 2026 — real, direct fix: Dye Lot No now constructed the
    // exact same way Dye End itself builds it, from the same 3 real
    // blocks — no more risk of a careless edit to a part you never
    // meant to touch. Machine removed entirely — it's a real Dye
    // Start field, not an Output one, corrected via Edit Input now.
    const _fy=document.getElementById('ef-dye-fy')?.value||'';
    const _serial=(document.getElementById('ef-dye-serial')?.value||'').trim();
    const _sub=(document.getElementById('ef-dye-sub')?.value||'').trim();
    body.dyeLotNo=_fy&&_serial?`DYE-${_fy}-${_serial}${_sub?'-'+_sub:''}`:undefined;
    body.shade=document.getElementById('ef-shade')?.value.trim();
    body.outCones=parseInt(document.getElementById('ef-out-cones')?.value)||undefined;
    body.outWeight=parseFloat(document.getElementById('ef-out-weight')?.value)||undefined;
    body.endNote=document.getElementById('ef-notes')?.value||'';
  }else if(stage==='dispatch'){
    body.bags=parseInt(document.getElementById('ef-bags')?.value)||0;
    body.weight=parseFloat(document.getElementById('ef-weight')?.value)||0;
    body.party=document.getElementById('ef-party')?.value;
    body.invoiceNo=document.getElementById('ef-invoice')?.value||'';
    body.date=document.getElementById('ef-date')?.value;
  }else if(stage==='recycleSoft'){
    body.inCones=parseInt(document.getElementById('ef-rcs-in-cones')?.value)||0;
    body.inWeight=parseFloat(document.getElementById('ef-rcs-in-weight')?.value)||0;
    body.outCones=parseInt(document.getElementById('ef-rcs-out-cones')?.value)||0;
    body.outWeight=parseFloat(document.getElementById('ef-rcs-out-weight')?.value)||0;
    body.machine=document.getElementById('ef-rcs-machine')?.value;
    body.worker=document.getElementById('ef-rcs-worker')?.value;
    body.startNote=document.getElementById('ef-rcs-start-note')?.value||'';
    body.endNote=document.getElementById('ef-rcs-end-note')?.value||'';
  }
  _pendingEditBody = body;
  const _btn=document.getElementById('edit-entry-submit-btn');if(_btn)_btn.disabled=true;
  try{
    const _previewUrl=stage==='recycleSoft'?'/api/recycle-soft/edit/preview':'/api/edit-entry/preview';
    const {ok,data,error,networkError}=await apiPost(_previewUrl,body);
    if(_btn)_btn.disabled=false;
    if(networkError||!ok){ setAlert(error||'Preview failed — could not check impact before saving.'); return; }
    _renderEditPreview(data);
    closeModal('edit-entry-modal-overlay');
    openModal('edit-preview-modal-overlay');
  }catch(e){ if(_btn)_btn.disabled=false; setAlert('Network error — could not preview: '+e.message); }
}

export function _renderEditPreview(data){
  const box=document.getElementById('edit-preview-body');
  let html='';
  if(data.blockers && data.blockers.length){
    html+=`<div class="alert-err" style="margin-bottom:10px"><b>This save would be blocked:</b><ul style="margin:6px 0 0 18px">${data.blockers.map(b=>`<li>${b}</li>`).join('')}</ul></div>`;
    const cbtn=document.getElementById('edit-preview-confirm-btn'); if(cbtn) cbtn.disabled=true;
  } else {
    const cbtn=document.getElementById('edit-preview-confirm-btn'); if(cbtn) cbtn.disabled=false;
  }
  if(data.warnings && data.warnings.length){
    html+=`<div class="alert-warn" style="margin-bottom:10px;background:#3a2f00;border:1px solid #856404;padding:8px 12px;border-radius:6px"><b>\u26a0 This will bypass a normal Supervisor block:</b><ul style="margin:6px 0 0 18px">${data.warnings.map(w=>`<li>${w}</li>`).join('')}</ul></div>`;
  }
  const _fields=Object.keys(data.current||{});
  html+=`<table style="width:100%;font-size:13px;margin-bottom:10px"><tr><td></td><td><b>Current</b></td><td><b>New</b></td></tr>${_fields.map(f=>`<tr><td>${f}</td><td>${data.current[f]}</td><td>${data.proposed[f]}</td></tr>`).join('')}</table>`;

  // Aug 19 2026 \u2014 real, grouped, proportional display, built via
  // direct discussion with Priyam: a flat, ungrouped list became
  // unreadable once a real lot had 15+ real Dye batches. Only the
  // Soft branch sends dyeGroups (the only stage where downstream can
  // span multiple, different Dye batches) \u2014 Wind/Pack/Dye/Dispatch
  // stay on the older, still-correct flat `downstream` list below,
  // since their own downstream is already naturally one Dye batch's
  // own chain, not many.
  if(data.rmBalance){
    html+=`<div style="background:var(--surface-1,#1a1a1a);border-radius:6px;padding:8px 10px;margin-bottom:8px;font-size:12px;display:flex;justify-content:space-between"><span>RM balance</span><b>${data.rmBalance.bags} bags \u00b7 ${fmtN(data.rmBalance.kg)}kg</b></div>`;
  }
  const _bagsPrefix = data.newBalanceUnits!=null ? `${Math.round(data.newBalanceUnits)} bags \u00b7 ` : '';
  html+=`<div style="margin-bottom:10px;font-size:13px">${data.newBalanceLabel||'New Balance'}: <b${data.wouldGoNegative?' style="color:#c00"':''}>${_bagsPrefix}${fmtN(data.newBalanceKg)}kg</b>${data.wouldGoNegative?' \u26a0 check this' : ''}</div>`;

  if(data.dyeGroups){
    if(data.dyeSubtotal && data.dyeSubtotal.count>0){
      html+=`<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600;padding:2px 4px;margin-bottom:6px"><span>Dyeing total \u2014 this entry's real share (${data.dyeSubtotal.count} batches)</span><span>${data.dyeSubtotal.cones} cones \u00b7 ${fmtN(data.dyeSubtotal.kg)}kg</span></div>`;
    }
    if(data.dyeGroups.length){
      html+=`<div style="max-height:220px;overflow:auto;display:flex;flex-direction:column;gap:8px">`;
      data.dyeGroups.forEach(g=>{
        html+=`<div style="background:var(--surface-1,#1a1a1a);border-radius:6px;padding:8px 10px">`;
        html+=`<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600"><span>${g.label}</span><span>${g.cones} cones \u00b7 ${fmtN(g.kg)}kg</span></div>`;
        if(g.combinesMultiple){
          html+=`<div style="margin-top:4px;padding:5px 7px;background:rgba(60,120,255,0.12);border-radius:4px;font-size:11px">Combines multiple soft entries for this lot \u2014 figures above are this entry's real, proportional share only.</div>`;
        }
        if(g.rows && g.rows.length){
          html+=`<div style="margin-top:6px;padding-left:10px;border-left:1px solid #444;display:flex;flex-direction:column;gap:3px">`;
          g.rows.forEach(r=>{
            const countLabel = r.cones!=null ? `${r.cones} cones` : `${r.bags} bags`;
            html+=`<div style="display:flex;justify-content:space-between;font-size:12px;color:#999"><span>${r.label}</span><span>${countLabel} \u00b7 ${fmtN(r.kg)}kg</span></div>`;
          });
          html+=`</div>`;
        }
        html+=`</div>`;
      });
      html+=`</div>`;
    } else {
      html+=`<div style="color:#666;font-size:13px">Nothing downstream depends on this yet.</div>`;
    }
  } else if(data.downstream && data.downstream.length){
    html+=`<div><b>Real, downstream records already relying on this:</b><ul style="margin:6px 0 0 18px;max-height:180px;overflow:auto">${data.downstream.map(d=>`<li>${d.label} \u2014 ${d.detail}</li>`).join('')}</ul></div>`;
  } else if(data.downstream){
    html+=`<div style="color:#666">Nothing downstream depends on this yet.</div>`;
  }
  box.innerHTML=html;
}

export async function _doEditEntrySave(){
  const body=_pendingEditBody;
  if(!body){return;}
  const setAlert=msg=>{document.getElementById('edit-entry-alert').innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;};
  const _btn=document.getElementById('edit-entry-submit-btn');if(_btn)_btn.disabled=true;
  const _pbtn=document.getElementById('edit-preview-confirm-btn');if(_pbtn)_pbtn.disabled=true;
  try{
    const _saveUrl=body.stage==='recycleSoft'?'/api/recycle-soft/edit':'/api/edit-entry';
    const {ok,data,error,networkError}=await apiPost(_saveUrl,body);
  if(networkError)throw new Error(error);
  if(!ok){setAlert(error||'Edit failed');if(_btn)_btn.disabled=false;if(_pbtn)_pbtn.disabled=false;closeModal('edit-preview-modal-overlay');openModal('edit-entry-modal-overlay');return;}
    closeModal('edit-entry-modal-overlay');closeModal('edit-preview-modal-overlay');showToast('Entry updated \u2713 — edit logged');if(data.imbalanceNote)showToast('\u26a0 '+data.imbalanceNote,'err');
    const _stageTable={soft:'stageEntries',wind:'windEntries',pack:'packEntries',dye:'dyeLots',dispatch:'dispatches',recycleSoft:'recycleSoft'}[body.stage];
    await _refreshAndRender(_stageTable?[_stageTable]:[],renderAll);
    _pendingEditBody=null;
  }catch(e){setAlert('Network error \u2014 edit not saved: '+e.message);if(_btn)_btn.disabled=false;if(_pbtn)_pbtn.disabled=false;}
}

export function dyeEndIOCheck(){const entryId=document.getElementById('dye-end-entry-select').value;
// Jul 26 2026 — the dyeEntries fallback (kept until today "for
// consistency" with a sibling function) removed entirely. Confirmed
// against a real production export: dyeEntries is genuinely empty, so
// dyeLots alone is the complete, correct source here.
const entry=(State.DB.dyeLots||[]).find(e=>e.id===entryId&&e.status==='InProgress');if(!entry)return;const outCones=parseInt(document.getElementById('dye-end-out-cones')?.value)||0;const outWeight=parseFloat(document.getElementById('dye-end-out-weight')?.value)||0;const ioEl=document.getElementById('dye-end-io-check');if(!ioEl)return;const inCones=entry.totalInCones||0;const inKg=entry.totalInWeight||0;let html='<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">';if(outCones>0&&inCones>0){const coneDiff=inCones-outCones;if(outCones>inCones){html+='<div style="color:var(--re);font-weight:700">❌ Cones: '+outCones+' > '+inCones+' input — BLOCKED</div>';}else if(coneDiff>0){html+='<div style="color:var(--re)">⚠ Cone loss: '+coneDiff+' cones ('+inCones+'→'+outCones+')</div>';}else{html+='<div style="color:var(--gr)">✅ Cones: '+outCones+' = '+inCones+' (no loss)</div>';}}
if(outWeight>0&&inKg>0){const diff=outWeight-inKg;if(diff>0.01){html+='<div style="color:var(--re);font-weight:700">❌ Weight: '+fmt(outWeight)+'kg > '+fmt(inKg)+'kg input — BLOCKED</div>';}else{const loss=inKg-outWeight;const lossPct=(loss/inKg*100);html+='<div style="color:var(--gr)">✅ Weight OK: '+fmt(outWeight)+'kg out (loss: -'+fmt(loss)+'kg / -'+lossPct.toFixed(1)+'%)</div>';}}
html+='</div>';ioEl.innerHTML=html||'Enter output values to see IO check';ioEl.style.background='var(--s2)';}

export function packGainCheck(){const id=document.getElementById('pack-dye-lot-select')?.value;const inKgPack=parseFloat(document.getElementById('pack-in-weight')?.value)||0;const outKg=parseFloat(document.getElementById('pack-weight')?.value)||0;const el=document.getElementById('pack-gain-display');if(!el)return;if(!id||!outKg){el.style.display='none';return;}
const _wBal=getWindBal(id);const inKg=_wBal.weight||0;if(!inKg){el.style.display='none';return;}
const gainKg=parseFloat((outKg-inKgPack).toFixed(2));const gainPct=inKgPack>0?(gainKg/inKgPack*100):0;el.style.display='block';if(gainKg>0.01){el.style.background='rgba(74,222,128,0.08)';el.innerHTML=`<span style="color:var(--gr);font-weight:700">📈 Gain: +${fmt(gainKg)}kg / +${gainPct.toFixed(1)}%</span> <span style="color:var(--mu);font-size:0.7rem">(Wind: ${fmt(inKg)}kg → Pack: ${fmt(outKg)}kg)</span>`;}else if(gainKg<-0.01){el.style.background='rgba(248,113,113,0.08)';el.innerHTML=`<span style="color:var(--re);font-weight:700">📉 Loss: ${fmt(gainKg)}kg / ${gainPct.toFixed(1)}%</span> <span style="color:var(--mu);font-size:0.7rem">(Wind: ${fmt(inKg)}kg → Pack: ${fmt(outKg)}kg)</span>`;}else{el.style.background='';el.innerHTML=`<span style="color:var(--gr)">✅ No gain/loss (${fmt(outKg)}kg)</span>`;}}

export async function openVoidModal(id,stage,grade,vendor,delivIdx,voidRequestId){if(State.currentUser?.role!=='admin'&&State.currentUser?.role!=='manager'){showToast('Admin only','err');return;}
document.getElementById('void2-entry-id').value=id;document.getElementById('void2-entry-stage').value=stage;document.getElementById('void2-alert').innerHTML='';document.getElementById('void2-reason-cat').value='';document.getElementById('void2-reason-text').value='';document.getElementById('void2-pwd').value='';
// Sep 10 2026 — real, direct new feature built via a genuinely long,
// careful design discussion with Priyam: when this modal is opened to
// review a real, pending Void Request (rather than a direct Admin
// void), this remembers which real request it's fulfilling, so
// submitVoid2 can correctly mark that request approved in the same
// action, instead of leaving it silently orphaned as still "pending"
// even after the actual void already happened.
document.getElementById('void2-void-request-id').value=voidRequestId||'';
openModal('void2-modal-overlay');
document.getElementById('void2-chain').innerHTML='<div style="padding:16px;text-align:center;color:var(--mu)">Loading full chain…</div>';
// Aug 6 2026 — real fix: this cascade tree now comes from the server,
// built from genuinely complete, merged active+archive data — the
// previous client-side buildVoidChain only ever saw State.DB, silently
// missing anything already archived.
// Aug 26 2026 — real, genuine, severe fix built via direct discussion
// with Priyam, after a real, confirmed near-miss voiding the wrong lot
// entirely: RM void needs grade/vendor too, since several different,
// real lots commonly share the same raw lot number — matching by id
// alone is genuinely ambiguous and, for 'rm' specifically, dangerous.
// Aug 26 2026 — real, direct extension: voiding a single delivery out
// of several now goes through this exact same cascade, uniformly,
// rather than a separate path with none of the same real visibility —
// delivIdx tells the server exactly which delivery, alongside the
// same, required grade/vendor address.
try{
  let url=WORKER_URL+'/api/void-chain/build?id='+encodeURIComponent(id)+'&stage='+encodeURIComponent(stage);
  if((stage==='rm'||stage==='rm-delivery')&&grade&&vendor)url+='&grade='+encodeURIComponent(grade)+'&vendor='+encodeURIComponent(vendor);
  if(stage==='rm-delivery'&&delivIdx!==undefined)url+='&delivIdx='+encodeURIComponent(delivIdx);
  const res=await fetch(url,{headers:_postHeaders()});
  const data=await res.json();
  renderVoidChain(data.nodes||[]);
}catch(e){
  document.getElementById('void2-chain').innerHTML='<div style="padding:16px;text-align:center;color:var(--re)">Failed to load chain: '+e.message+'</div>';
}
}

export function renderVoidChain(nodes){const el=document.getElementById('void2-chain');if(!el)return;const stageClr={soft:'var(--cs)',dye:'var(--cd)',wind:'var(--cw)',pack:'var(--cp)',dispatch:'var(--gr)',rm:'var(--cr)'};const stageIc={soft:'💧',dye:'🎨',wind:'🌀',pack:'📦',dispatch:'🚚',rm:'📦'};const stageLbl={soft:'Soft Entries',dye:'Dye Lots',wind:'Wind Entries',pack:'Pack Entries',dispatch:'Dispatches'};
// Aug 26 2026 — real, genuine change built via direct discussion with
// Priyam: every downstream entry used to render flat, one row per
// entry, which could mean scrolling through dozens of rows just to
// find one checkbox. Now grouped by stage, collapsed by default, with
// a stage-level select-all — click a stage header to expand and see
// or adjust individual entries within it, same real checkboxes
// underneath, same real ids, nothing about submitVoid2 needs to
// change at all, since it reads by the exact same vchain-{idx} ids
// regardless of how they're visually grouped on screen.
const renderRow=(n,idx,indent)=>{const clr=stageClr[n.stage]||'var(--ac)';const ic=stageIc[n.stage]||'•';const alreadyVoided=n.status==='Voided';return `<div style="display:flex;align-items:flex-start;gap:8px;padding:7px 10px;margin-left:${indent}px;
    border-left:3px solid ${n.level===0?clr:'var(--b2)'};
    background:${alreadyVoided?'rgba(100,100,100,0.05)':n.level===0?'rgba(239,68,68,0.05)':'var(--s2)'};
    border-radius:6px;margin-bottom:4px;opacity:${alreadyVoided?'0.5':'1'}"><input type="checkbox" id="vchain-${idx}" value="${idx}" class="vchain-cb" data-stage="${n.stage}" ${n.checked&&!alreadyVoided?'checked':''} ${alreadyVoided?'disabled':''}
      style="margin-top:3px;accent-color:var(--re);width:14px;height:14px;flex-shrink:0"><div style="flex:1;min-width:0"><div style="font-size:0.75rem;font-weight:700;color:${alreadyVoided?'var(--mu)':clr}">
        ${ic} ${n.label}
        ${alreadyVoided?'<span style="font-size:0.62rem;color:var(--mu);margin-left:6px">Already voided</span>':''}
      </div><div style="font-size:0.65rem;color:var(--mu);margin-top:2px">${n.detail}</div></div></div>`;};
let html=`<div style="font-size:0.72rem;color:var(--mu);margin-bottom:8px;font-weight:700;text-transform:uppercase;letter-spacing:.06em">Select entries to void:</div>`;
const primary=nodes.map((n,idx)=>({n,idx})).filter(x=>x.n.level===0);
primary.forEach(({n,idx})=>{html+=renderRow(n,idx,0);});
const downstream=nodes.map((n,idx)=>({n,idx})).filter(x=>x.n.level>0);
const byStage={};
downstream.forEach(x=>{(byStage[x.n.stage]=byStage[x.n.stage]||[]).push(x);});
Object.keys(byStage).forEach((stage,gi)=>{
  const group=byStage[stage];const groupId=`vchain-grp-${gi}`;
  const activeCount=group.filter(x=>x.n.status!=='Voided').length;
  const clr=stageClr[stage]||'var(--ac)';const ic=stageIc[stage]||'•';const lbl=stageLbl[stage]||stage;
  html+=`<div style="margin-top:6px;margin-bottom:4px">
    <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--s2);border-radius:6px;cursor:pointer;border-left:3px solid ${clr}" onclick="toggleVoidChainGroup('${groupId}')">
      <input type="checkbox" onclick="event.stopPropagation();toggleVoidChainGroupAll('${groupId}',this.checked)" ${group.every(x=>x.n.checked||x.n.status==='Voided')?'checked':''} style="accent-color:var(--re);width:14px;height:14px;flex-shrink:0">
      <span style="font-size:0.75rem;font-weight:700;color:${clr};flex:1">${ic} ${lbl} <span style="color:var(--mu);font-weight:400">(${activeCount} of ${group.length})</span></span>
      <span id="${groupId}-arrow" style="color:var(--mu);font-size:0.7rem">▼</span>
    </div>
    <div id="${groupId}" style="display:none;margin-top:4px">
      ${group.map(x=>renderRow(x.n,x.idx,20)).join('')}
    </div>
  </div>`;
});
if(downstream.length>0){html+=`<div style="margin-top:8px;padding:6px 10px;background:rgba(239,68,68,0.06);border-radius:6px;font-size:0.68rem;color:var(--re);">
    ⚠ Unchecked downstream entries will NOT be voided but their balances may be affected. Review carefully.
  </div>`;}
el.innerHTML=html;el._voidNodes=nodes;}

export function toggleVoidChainGroup(groupId){const g=document.getElementById(groupId);const arrow=document.getElementById(groupId+'-arrow');if(!g)return;const hidden=g.style.display==='none';g.style.display=hidden?'block':'none';if(arrow)arrow.textContent=hidden?'▲':'▼';}
export function toggleVoidChainGroupAll(groupId,checked){const g=document.getElementById(groupId);if(!g)return;g.querySelectorAll('input.vchain-cb:not(:disabled)').forEach(cb=>cb.checked=checked);}
window.toggleVoidChainGroup=toggleVoidChainGroup;
window.toggleVoidChainGroupAll=toggleVoidChainGroupAll;

export function openVoidEntry(id,type){const isAdmin=State.currentUser?.role==='admin';const isSup=State.currentUser?.role==='supervisor'||State.currentUser?.role==='manager';if(!isAdmin&&!isSup){showToast('Supervisor or Admin only','err');return;}
State._voidEntryId=id;State._voidEntryType=type;document.getElementById('void-entry-alert').innerHTML='';document.getElementById('void-reason-cat').value='';document.getElementById('void-reason-text').value='';document.getElementById('void-entry-pwd').value='';let entry,infoHtml='',cascadeHtml='';if(type==='soft'){entry=(State.DB.stageEntries||[]).find(e=>e.id===id);infoHtml=`Soft Entry <strong>${id}</strong> — Lot ${entry?.lotId} ${entry?.grade}`;}else if(type==='dye'){entry=(State.DB.dyeLots||[]).find(d=>d.id===id);infoHtml=`Dye Lot <strong>${entry?.dyeLotNo}</strong> — ${entry?.shade}`;const windCount=(State.DB.windEntries||[]).filter(e=>e.dyeLotId===id&&e.status!=='Voided').length;const packCount=(State.DB.packEntries||[]).filter(e=>e.dyeLotId===id&&e.status!=='Voided').length;const dispCount=(State.DB.dispatches||[]).filter(d=>d.dyeLotId===id&&d.status!=='Voided').length;if(windCount||packCount||dispCount){cascadeHtml=`<strong>⚠ This will also void:</strong><br>${windCount} wind entries, ${packCount} pack entries, ${dispCount} dispatches`;}}else if(type==='wind'){entry=(State.DB.windEntries||[]).find(e=>e.id===id);infoHtml=`Wind Entry <strong>${id}</strong> — ${entry?.dyeLotNo}`;const packCount=(State.DB.packEntries||[]).filter(e=>e.dyeLotId===entry?.dyeLotId&&e.status!=='Voided').length;const dispCount=(State.DB.dispatches||[]).filter(d=>d.dyeLotId===entry?.dyeLotId&&d.status!=='Voided').length;if(packCount||dispCount)cascadeHtml=`<strong>⚠ This will also void:</strong><br>${packCount} pack entries, ${dispCount} dispatches`;}else if(type==='pack'){entry=(State.DB.packEntries||[]).find(e=>e.id===id);infoHtml=`Pack Entry <strong>${id}</strong> — ${entry?.dyeLotNo}`;const dispCount=(State.DB.dispatches||[]).filter(d=>d.dyeLotId===entry?.dyeLotId&&d.status!=='Voided').length;if(dispCount)cascadeHtml=`<strong>⚠ This will also void:</strong><br>${dispCount} dispatches for this dye lot`;}else if(type==='dispatch'){entry=(State.DB.dispatches||[]).find(d=>d.id===id);infoHtml=`Dispatch <strong>${id}</strong> — ${entry?.dyeLotNo} → ${entry?.party}`;}
document.getElementById('void-entry-info').innerHTML=infoHtml;const cw=document.getElementById('void-cascade-warning');if(cascadeHtml){cw.style.display='';cw.innerHTML=cascadeHtml;}
else cw.style.display='none';openModal('void-entry-modal-overlay');}

export function submitVoidEntry(){
  // Sep 10 2026 — real, direct new feature built via a genuinely long,
  // careful design discussion with Priyam, establishing one clear
  // rule across the whole app: every real action shows a genuine
  // preview of its actual effect before committing. This replaces the
  // old, locally-computed confirm() dialog (built from whatever's
  // already loaded in the browser) with a real, server-computed
  // preview — the exact same cascade logic the actual void already
  // uses, just returned here instead of executed.
  const setAlert=msg=>{document.getElementById('void-entry-alert').innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;};
  if(!State.currentUser||(State.currentUser.role!=='admin'&&State.currentUser.role!=='manager'&&State.currentUser.role!=='supervisor')){setAlert('Supervisor or Admin only');return;}
  const reasonCat=document.getElementById('void-reason-cat').value;const reason=document.getElementById('void-reason-text').value.trim();
  const pwd=document.getElementById('void-entry-pwd').value;
  if(!reasonCat){setAlert('Select void reason category');return;}
  if(reason.length<10){setAlert('Reason must be at least 10 characters');return;}
  if(!pwd){setAlert('Enter your password to confirm');return;}
  const id=State._voidEntryId,type=State._voidEntryType;
  _previewVoidOnServer(id,type,reasonCat,reason,pwd);
}

async function _previewVoidOnServer(id,type,reasonCat,reason,pwd){
  const setAlert=msg=>{document.getElementById('void-entry-alert').innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;};
  const _btn=document.getElementById('void-entry-submit-btn');if(_btn)_btn.disabled=true;
  try{
    const {ok,data,error,networkError}=await apiPost('/api/void',{id,type,reasonCat,reason,password:pwd,username:State.currentUser.username,dryRun:true});
    if(_btn)_btn.disabled=false;
    if(networkError){setAlert('Network error: '+error);return;}
    if(!ok||data.error){setAlert(data.error||error||'Could not preview');return;}
    _pendingVoidBody={id,type,reasonCat,reason,pwd};
    _renderVoidPreview(data);
    closeModal('void-entry-modal-overlay');
    document.getElementById('void-preview-alert').innerHTML='';
    openModal('void-preview-modal-overlay');
  }catch(e){setAlert('Network error: '+e.message);if(_btn)_btn.disabled=false;}
}

let _pendingVoidBody=null;

function _renderVoidPreview(data){
  const box=document.getElementById('void-preview-body');
  const labels={dye:'Dye lots',wind:'Wind entries',pack:'Pack entries',dispatch:'Dispatches'};
  const rows=Object.entries(data.cascadeCounts||{}).filter(([,n])=>n>0).map(([k,n])=>`<div>${n} ${labels[k]||k}</div>`).join('');
  box.innerHTML=`
    <div style="font-size:.8rem;margin-bottom:10px;">Voiding <strong>${data.entryType} ${data.entryId}</strong>${rows?' will also void:':' — nothing else depends on this yet.'}</div>
    ${rows?`<div style="background:var(--s2);border-radius:8px;padding:8px 10px;font-size:.75rem;margin-bottom:10px;">${rows}</div>`:''}
    ${data.wouldCreateRequest?`<div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:8px 10px;font-size:.72rem;color:var(--re);font-weight:700">⚠ This has real downstream activity — this will be sent to Admin for review instead of voiding directly.</div>`:''}
  `;
  const _cbtn=document.getElementById('void-preview-confirm-btn');
  if(_cbtn)_cbtn.textContent=data.wouldCreateRequest?'📤 Send for Review':'🗑 Confirm Void';
}

export async function _doVoidConfirm(){
  const setAlert=msg=>{document.getElementById('void-preview-alert').innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;};
  const body=_pendingVoidBody;
  if(!body)return;
  const _pbtn=document.getElementById('void-preview-confirm-btn');
  if(_pbtn)_pbtn.disabled=true;
  await _executeVoidOnServer(body.id,body.type,body.reasonCat,body.reason,body.pwd,true);
  if(_pbtn)_pbtn.disabled=false;
}

export async function _executeVoidOnServer(id,type,reasonCat,reason,pwd,fromPreview){
  const setAlert=msg=>{
    const target=fromPreview?document.getElementById('void-preview-alert'):document.getElementById('void-entry-alert');
    target.innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;
  };
  const _btn=fromPreview?null:document.getElementById('void-entry-submit-btn');if(_btn)_btn.disabled=true;
  try{
    const {ok,data,error,networkError}=await apiPost('/api/void',{id,type,reasonCat,reason,password:pwd,username:State.currentUser.username,changedBy:State.currentUser.name,role:State.currentUser.role});
  if(networkError)throw new Error(error);
  if(!ok){setAlert(error||'Void failed');if(_btn)_btn.disabled=false;return;}
    closeModal(fromPreview?'void-preview-modal-overlay':'void-entry-modal-overlay');
    // Sep 10 2026 — real, direct new feature: the server now returns
    // {requested:true} instead of actually voiding, once this genuinely
    // had downstream activity and the current user is a Supervisor —
    // shown here as its own, real, correctly different message rather
    // than silently reusing the "voided" toast for something that
    // never actually voided anything yet.
    if(data.requested){
      showToast('Sent to Admin for review — nothing voided yet ⏳');
    }else{
      showToast(`Entry voided \u2713${data.voidedCount>1?' ('+data.voidedCount+' records, cascade)':''}`);
    }
    const _voidTable={soft:'stageEntries',wind:'windEntries',pack:'packEntries',dye:'dyeLots',dispatch:'dispatches',rm:'lots'}[type];
    await _refreshAndRender(data.requested?['voidRequests']:(_voidTable?[_voidTable]:['stageEntries','dyeLots','windEntries','packEntries','dispatches']),renderAll);
  }catch(e){setAlert('Network error \u2014 void not saved: '+e.message);if(_btn)_btn.disabled=false;}
}

window.openEditEntryModal = openEditEntryModal;
window._switchEditEntryTab = _switchEditEntryTab;
window.submitEditEntry = submitEditEntry;
window.submitEditDyeInput = submitEditDyeInput;
window._doDyeInputEditSave = _doDyeInputEditSave;
window._doEditEntrySave = _doEditEntrySave;
window.dyeEndIOCheck = dyeEndIOCheck;
window.packGainCheck = packGainCheck;
window.openVoidModal = openVoidModal;
window.rejectVoidRequest = rejectVoidRequest;
window.openVoidEntry = openVoidEntry;
window.submitVoidEntry = submitVoidEntry;
window._doVoidConfirm = _doVoidConfirm;
window.submitUndoEdit = submitUndoEdit;
window.openUndoPwdModal = openUndoPwdModal;
window.submitUndoEditWithPwd = submitUndoEditWithPwd;
window._doUndoConfirm = _doUndoConfirm;

// Sep 20 2026 — Recycle Phase 2c: a dedicated, simpler Void for Recycle Soft. It reuses none of the generic /api/void cascade
// machinery (that system voids a whole downstream CHAIN of directly-linked records; Recycle Soft's only real risk is a shared
// POOL going negative, which handleVoidRecycleSoft already checks and blocks outright — there is nothing to preview or cascade).
export function openVoidRecycleSoftModal(id){
  if(State.currentUser?.role!=='admin'&&State.currentUser?.role!=='manager'){showToast('Admin only','err');return;}
  const e=(State.DB.recycleSoft||[]).find(x=>x.id===id);if(!e)return;
  document.getElementById('rcsvoid-entry-id').value=id;
  document.getElementById('rcsvoid-info').innerHTML=`Recycle Soft <strong>${id}</strong> — ${e.dyeLotNo||''} — In ${e.inCones||0}c/${fmt(e.inWeight)}kg, Out ${e.outCones||0}c/${fmt(e.outWeight)}kg`;
  document.getElementById('rcsvoid-alert').innerHTML='';
  document.getElementById('rcsvoid-reason-cat').value='';
  document.getElementById('rcsvoid-reason-text').value='';
  document.getElementById('rcsvoid-pwd').value='';
  openModal('rcsvoid-modal-overlay');
}
export async function submitVoidRecycleSoft(){
  const setAlert=msg=>{document.getElementById('rcsvoid-alert').innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;};
  const id=document.getElementById('rcsvoid-entry-id').value;
  const reasonCat=document.getElementById('rcsvoid-reason-cat').value;
  const reason=document.getElementById('rcsvoid-reason-text').value.trim();
  const password=document.getElementById('rcsvoid-pwd').value;
  if(!reasonCat){setAlert('Select void reason category');return;}
  if(reason.length<10){setAlert('Reason must be at least 10 characters');return;}
  if(!password){setAlert('Enter your password to confirm');return;}
  const _btn=document.getElementById('rcsvoid-submit-btn');if(_btn)_btn.disabled=true;
  try{
    const {ok,data,error,networkError}=await apiPost('/api/recycle-soft/void',{id,reasonCat,reason,password,username:State.currentUser.username,changedBy:State.currentUser.name});
    if(_btn)_btn.disabled=false;
    if(networkError){setAlert('Network error: '+error);return;}
    if(!ok){setAlert(error||'Could not void');return;}
    closeModal('rcsvoid-modal-overlay');showToast('Recycle Soft entry voided');
    await _refreshAndRender(['recycleSoft'],renderAll);
  }catch(e){setAlert('Network error: '+e.message);if(_btn)_btn.disabled=false;}
}
window.openVoidRecycleSoftModal=openVoidRecycleSoftModal;
window.submitVoidRecycleSoft=submitVoidRecycleSoft;

