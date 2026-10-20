import {BACKUP_KEY, FLAG_COLORS, GSHEET_WEBHOOK_URL, MAX_BACKUPS, Qmax0, Qsub, SCOL, STAGE_CONFIG, State, WORKER_URL, _dispatchesForDropdown, _dyeLotsForDropdown, _fbAuthedFetch, _filterTableMap, _getDyeLotSummary, _getHeaders, _getLotSummary, _hydrateChallanFilter, _hydrateDyeLot, _hydrateLot, _inDayFn, _loadArchiveWithCache, _loadCatalog, _searchArchive, _fetchReportSummaries, _refreshAndRender, apiPost, calcMachineTotals, calcWorkerTotals, calcShadeTotals, calcDailyTotals, getSoftResidualOut, getRMReturnedOut, _fetchTrueSoftAvailable, _lotsForDropdown, _postHeaders, _sortState, _summaryKey, _tableFilters, _verifyPasswordViaWorker, _waitForDBThenLogin, agingBadge, appr, balCell, clearAlerts, closeModal, dateRange, dtCell, fmt, fmtDate, fmtDuration, fmtHrs, fmtQ, fmtQty, fmtRelTS, fmtTS, getDeadStockBalance, getDispatched, getDyeAllocated, getDyeBal, getDyeBalAvailable, getDyeBalance, getDyeConsumedFromLot, getDyeLotCurrentStage, getGradePool, getLot, getLotByKey, getPackBal, getPackBalAvailable, getPackBalance, getPackOut, getRCStatus, getRMBalance,  getSoftBalance, getSoftBalanceAvailable, getSoftBalanceWeight, getSoftBalanceWeightAvailable, getSoftConsumedByDye, getSoftIn, getSoftOut, getStageBalanceAvailable, getTotalDispatched, getTotalEntries, getTotalPacked, getVendorRatioForDyeLot, getWindBal, getWindBalAvailable, getWindBalance, getWindOut, hrsBetween, inRange, initFirebase, initTheme, isEntryLocked, lcExpanded, logout, lotsForStage, machinesForStage, workersSorted, eligibleDyeLifecycleLots, _flagKeyRM, _flagKeySafe, _isLotOnHold, mwCell, nav, nowTS, onLogin, openModal, parseLotSelectValue, pct, qtyCell, rptState, save, seMatch, setAlert, setupMobileNav, showLoginScreenSafe, showToast, stageBalance, today, triggerSummaryUpdate, updateMobileNavBadges, updateOnlineStatus, wasteCell, wastePctCell, wcls, _maybeStartDataLoad} from './core.js';
import { buildColFilter, sortTh, sortArr, _restoreFilterBtns, _showFilterClearBtn, _restoreFilterFocus, _captureFilterFocus, buildDyeLotSearch, statusBadge, entryRowClass, fitBevTableHeight, _bevRender, updateSidebarKPIs, _updateAllClearBtns, updateStageSummaryBars, renderAllBev, applyTableFilter, _getFilterPrefix, _updateClearBtn, clearSingleFilter, clearDispFilters, clearRMStockFilters, clearDeadStockFilters, clearSEFilters, clearRMFilters, clearRMReturnFilters, clearDyeStockFilters, clearRecycleFilters, applyAllTableFilters, toggleSort, filterLotOpts } from './shared.js';
import { renderUsers } from './users.js';
import { renderMasters, checkRMUidStatus } from './masters.js';
import { renderSearch } from './search.js';
import { renderChallan } from './challan.js';
import { renderWIP } from './wip.js';
import { renderDyeLifecycleSelect, renderDyeLifecycle } from './dyelifecycle.js';
import { renderPartyTracker, cancelPartyOrder, openPartyOrderModal, submitPartyOrder, openLinkOrder, submitLinkOrder, navToParty, populatePartySelect, openPartyFromDyeLot } from './party.js';
import { renderStock, renderDyeStock, renderRMStock } from './stock.js';
import { renderLifecycle } from './lifecycle.js';
import { renderVendorV2 } from './vendor.js';
import { renderEditLog, _renderDailyCheckReport, renderRMEditLog, switchEditLogTab, openEditEntryModal, _switchEditEntryTab } from './editlog.js';
import { showStockRegTab, getResidualBalance, renderDeadStock, renderRecycleStock, renderResidualLog } from './stockregister.js';
import { renderRMTable, renderRMReturnLog } from './rm.js';
import { renderStageTable, wJumpStage, workerStageForm, updateStageAvail } from './soft.js';
import { renderDyeTable, getDyeSrcOpts, loadDyeEntriesIfNeeded, openDyeStartModal } from './dye.js';
import { renderWindTable } from './wind.js';
import { renderRecyclePage, renderRecycleStockPools, renderRecycleSoftEntries } from './recyclesoft.js';
import { renderPackTable } from './pack.js';
import { renderDispatch } from './dispatch.js';
import { renderApproval } from './approval.js';
import { renderDispatchLotRows, updateDispatchTotal } from './dispatch.js';
import { renderDashboard, dashAlertNav, renderDashAlerts, setDashPeriod, _dashDateFilter, renderDashRcvVsDis, renderDashPartyDispatch, renderImbalanceWidget, detectImbalances } from './dashboard.js';
import { renderReports, rptFlow, rptMachine, rptWorker, rptDaily, rptShade, rptGrade, rptPack, rptWaste, setRptFilter, getRptRange, setPackFilter, clearMachFilter, clearWorkFilter, setWasteFilter, tblHTML, _rptTblSort, exportPDF } from './reports.js';
import { showAnTab, setAnDate, setCmpQuick, renderComparison, setTrendGroup, setMHPeriod, getPeriodBuckets, renderTrend, renderWorkerScorecard, renderMachineHealth, populateAnalyticsSelects, renderAnDailyLog } from './analytics.js';
import { renderWorkerView, workerPackForm, workerWindForm, workerDyeForm, workerDispForm, workerMyHistory, wTab, wPackLotChange, wSubmitPack, wSubmitWindEnd, wSubmitWindStart, wWindLotChange, wSwitchTab, wShowDyeEndRef, wShowEndRef, wUpdateAvail, wDispRowAvail, wDispAddLotRow, refreshWDyeLots, _refreshWDyeLotsImpl, wDyeCalcTotal, wSetAlert, wSubmitEnd, wDyeAddSourceRow, wSubmitDyeStart, wOnDyeEndSerialInput, wSubmitDyeEnd, wSubmitDisp, wSubmitStart, dyeQualifyingDeadStock, dyeQualifyingRecycleStock, dyeQualifyingResidualStock } from './worker-view.js';
import { manualBackup, exportFirebaseBackup, restoreFromBackup, deleteFirebaseBackup, exportBackupJSON, exportCurrentCSV, getBackupList, showBackupModal, runBackup, _writeBackup, exportToExcel, _doExportToExcel, exportCSV, showGSheetStatus } from './backup-export.js';
import { adminPasswordAction, confirmAdminPwd, _executePwdAction, openOverride, executeOverride, submitOverride, runDailyCheckNow, runStaleLotScan, runDuplicateLotScan, cleanupOrphanedLots, downloadLotIssuesReport, runLotAddressMismatchScan, downloadLotAddressMismatchReport } from './admin-tools.js';


function isInDemoState(){if(!State.DB.lots||!State.DB.lots.length)return false;if(State.firebaseLoaded&&State.fbDB)return false;const hasDemoLots=State.DB.lots.some(l=>l.id==='LOT-001'||l.id==='LOT-002');if(!hasDemoLots)return false;const onlyDefaultUsers=(State.DB.users||[]).every(u=>['admin','supervisor','ramesh','suresh','amit','priya'].includes(u.username));return onlyDefaultUsers;}
export function renderLoginDemoCards(forceHide){const section=document.getElementById('login-demo-section');const cards=document.getElementById('login-demo-cards');if(!section||!cards)return;if(forceHide||!isInDemoState()){section.style.display='none';return;}
const users=(State.DB.users||[]).filter(u=>u.active!==false);const roleClass={manager:'rm',supervisor:'rs',worker:'rw'};const roleLabel={manager:'Manager',supervisor:'Supervisor',worker:'Worker'};cards.innerHTML=users.map(u=>`
    <div class="demo-row" onclick="fillLogin('${u.username}','${u.password}')"><div><div class="dr-name">${u.name}</div><div class="dr-creds">${u.username} / ${u.password}${u.stage&&u.stage!=='all'?' — '+u.stage:''}</div></div><span class="rbadge ${roleClass[u.role]||'rw'}">${roleLabel[u.role]||u.role}</span></div>`).join('');section.style.display='block';}
function fillLogin(u,p){document.getElementById('li-u').value=u;document.getElementById('li-p').value=p;}

















export async function approveDyeLot(id){
  try{
    const {ok,data,error,networkError}=await apiPost('/api/approve-entry',{type:'dye',id,changedBy:State.currentUser.name});
  if(networkError)throw new Error(error);
  if(!ok){showToast(error||'Could not approve','err');return;}
    showToast('Dye Lot approved ✓');await _refreshAndRender(['dyeLots'],renderAll);
  }catch(e){showToast('Network error — not saved: '+e.message,'err');}
}







export function currentFY(){const now=new Date();const yr=now.getFullYear();const mo=now.getMonth();const fyStart=mo>=3?yr:yr-1;return String(fyStart).slice(2)+String(fyStart+1).slice(2);}

function dyeSplitCalc(){const lot=(State.DB.dyeLots||[]).find(d=>d.id===document.getElementById('dyesplit-lot-id').value);if(!lot)return;const good=parseFloat(document.getElementById('dyesplit-good').value)||0;const off=Math.max(0,(lot.outWeight||0)-good);document.getElementById('dyesplit-off').value=off.toFixed(2);}
// Sep 19 2026 - Recycle Phase 1: shows how many GOOD cones the entered off cones leave (the lot's output cones minus the off cones).
function dyeSplitCones(){const lot=(State.DB.dyeLots||[]).find(d=>d.id===document.getElementById('dyesplit-lot-id').value);const el=document.getElementById('dyesplit-cones-note');if(!lot||!el)return;const raw=document.getElementById('dyesplit-off-cones').value;const offC=parseInt(raw);const outC=lot.outCones||0;el.textContent=(raw===''||isNaN(offC)||outC<=0)?'':'Good cones: '+Math.max(0,outC-offC)+' of '+outC;}



// Aug 26 2026 — real bug found and fixed via a complete, systematic
// sweep for the same pattern that broke Soft's Save button: both of
// these were declared here, on this shared line, but genuinely never
// used anywhere in this file — only in wind.js and pack.js
// respectively, where each now has its own, correct declaration.
 // returns serial number only — prefix added by form







export function openRMLifecycle(lotId){nav('lifecycle',document.getElementById('ni-lifecycle'));setTimeout(()=>{const sel=document.getElementById('lc-select');if(sel){sel.value=lotId;renderLifecycle();}},100);}

export function openDyeLifecycle(dyeLotId,fromRmLotId){nav('dyelifecycle',document.getElementById('ni-dyelifecycle'));const shadeFilter=document.getElementById('dlc-shade-select');if(shadeFilter)shadeFilter.value='';_loadCatalog('dyeLots',()=>{const sel=document.getElementById('dye-lifecycle-select');if(sel){const lots=eligibleDyeLifecycleLots('');
  // Sep 8 2026 — safety net: openDyeLifecycle is a direct jump to one
  // specific lot (e.g. clicked from Dashboard/Vendor Tracker/Party
  // Tracker) — if that exact lot got excluded by the shared eligibility
  // rule (genuinely still InProgress), it still needs to be selectable
  // here, since the user explicitly navigated to see this one.
  const targetMissing=dyeLotId&&!lots.some(d=>d.id===dyeLotId);
  const targetLot=targetMissing?_dyeLotsForDropdown().find(d=>d.id===dyeLotId):null;
  const optsFor=targetLot?[targetLot,...lots]:lots;
  sel.innerHTML='<option value="">Select Dye Lot...</option>'+optsFor.map(d=>`<option value="${d.id}">${d.dyeLotNo} — ${d.shade}</option>`).join('');if(dyeLotId)sel.value=dyeLotId;}
if(shadeFilter){const allLots=_dyeLotsForDropdown();const shades=[...new Set(allLots.map(d=>d.shade).filter(Boolean))].sort();shadeFilter.innerHTML='<option value="">All Shades</option>'+shades.map(s=>{const cnt=allLots.filter(d=>d.shade===s).length;return`<option value="${s}">${s} (${cnt} lot${cnt>1?'s':''})</option>`;}).join('');}
if(fromRmLotId){const backBtn=document.getElementById('dye-lifecycle-back-btn');if(backBtn){backBtn.style.display='';backBtn.onclick=()=>{nav('lifecycle',document.getElementById('ni-lifecycle'));};}}
renderDyeLifecycle();});}





export async function rejectDyeLot(id){try{const {ok,error,networkError}=await apiPost('/api/reject',{type:'dye',id,changedBy:State.currentUser?.name,role:State.currentUser?.role});if(networkError)throw new Error(error);if(!ok){showToast(error||'Reject failed','err');return;}showToast('Dye Lot rejected','err');await _refreshAndRender(['dyeLots'],renderAll);}catch(e){showToast('Network error — '+e.message,'err');}}














// ══════════════════════════════════════
// RM RETURN (to vendor) — lot+grade+vendor pool-scoped, cascading Vendor→Grade→Lot
// picker (same pattern as addDyeSourceRow). Qualitative reasons only — RM return
// is not quantity-driven, it's vendor/quality driven (Jul 8 2026).
// ══════════════════════════════════════










// Replaces old entry-scoped openSoftScrapModal/openMoveToResidualModal.
// Writes to DB.residualLog keyed by {lotId,grade,vendor} — NOT tied to any one
// stageEntries row. getSoftBalanceWeight/getSoftResidualOut (core.js) subtract
// this pool-wide, same pattern already used for getSoftConsumedByDye.
// ══════════════════════════════════════




// ══════════════════════════════════════
// RESIDUAL STOCK PAGE
// ══════════════════════════════════════





























function recalcAllSummaries(btn){
  if(!confirm('Recalculate ALL lot summaries from live Firebase data? This runs in the background and may take a little while for a large dataset.'))return;
  if(btn){btn.disabled=true;btn.textContent='⟳ Starting...';}
  apiPost('/api/summary/recalc-all',{}).then(({ok,error})=>{
    if(!ok){
      showToast(error||'Recalc failed to start','err');
      if(btn){btn.disabled=false;btn.textContent='⟳ Recalc All Summaries';}
      return;
    }
    if(btn)btn.textContent='⟳ Running in background...';
    let attempts=0;
    const poll=setInterval(async()=>{
      attempts++;
      try{
        const r=await fetch(WORKER_URL+'/api/summary/recalc-status',{headers:_postHeaders()});
        const d=await r.json();
        const st=d.status||{};
        if(st.status==='done'||st.status==='error'||attempts>=40){
          clearInterval(poll);
          if(st.status==='done'){
            // Fetch fresh summaries into State.DB
            Promise.all([
              fetch(WORKER_URL+'/api/summaries',{headers:_postHeaders()}).then(r=>r.json()).then(d=>{
                if(d.summaries){State.DB.lotSummaries={};d.summaries.forEach(s=>{if(s.lotId)State.DB.lotSummaries[_summaryKey(s.lotId,s.grade,s.vendor)]=s;});}
              }),
              fetch(WORKER_URL+'/api/dyelotsummaries',{headers:_postHeaders()}).then(r=>r.json()).then(d=>{
                if(d.summaries){State.DB.dyeLotSummaries={};d.summaries.forEach(s=>{if(s.dyeLotId)State.DB.dyeLotSummaries[s.dyeLotId]=s;});}
              })
            ]).then(()=>{
              showToast(`All summaries recalculated ✓ — ${st.rmDone||0} lot(s), ${st.dyeDone||0} dye lot(s)`);
              if(btn){btn.disabled=false;btn.textContent='⟳ Recalc All Summaries';}
              renderAll();
            }).catch(()=>{
              showToast('Recalc done — refresh if needed');
              if(btn){btn.disabled=false;btn.textContent='⟳ Recalc All Summaries';}
              renderAll();
            });
          }else if(st.status==='error'){
            showToast('Recalc failed: '+(st.error||'unknown error'),'err');
            if(btn){btn.disabled=false;btn.textContent='⟳ Recalc All Summaries';}
          }else{
            showToast('Recalc still running — check back shortly','err');
            if(btn){btn.disabled=false;btn.textContent='⟳ Recalc All Summaries';}
          }
        }
      }catch(e){
        clearInterval(poll);
        showToast('Network error: '+e.message,'err');
        if(btn){btn.disabled=false;btn.textContent='⟳ Recalc All Summaries';}
      }
    },3000);
  }).catch(e=>{
    showToast('Recalc failed: '+e.message,'err');
    if(btn){btn.disabled=false;btn.textContent='⟳ Recalc All Summaries';}
  });
}

// Aug 6 2026 — real, missing piece caught by Priyam before the "All
// Time" report fix was declared finished: without this, the report
// would start out badly incomplete, since the nightly job only ever
// freezes "yesterday," one day at a time, with nothing to catch up the
// real, existing history first. Same exact polling pattern as Recalc
// All Summaries above — one-time, admin-triggered, safely re-runnable.
function backfillSnapshots(btn){
  if(!confirm('Freeze every real historical day for the "All Time" report? This runs in the background — real production data showed about 108 real days, safe to re-run if needed.'))return;
  if(btn){btn.disabled=true;btn.textContent='⟳ Starting...';}
  apiPost('/api/reports/backfill-snapshots',{}).then(({ok,error})=>{
    if(!ok){
      showToast(error||'Backfill failed to start','err');
      if(btn){btn.disabled=false;btn.textContent='⟳ Backfill Report History';}
      return;
    }
    if(btn)btn.textContent='⟳ Running in background...';
    let attempts=0;
    const poll=setInterval(async()=>{
      attempts++;
      try{
        const r=await fetch(WORKER_URL+'/api/reports/backfill-status',{headers:_postHeaders()});
        const d=await r.json();
        const st=d.status||{};
        if(st.status==='complete'||st.status==='error'||attempts>=60){
          clearInterval(poll);
          if(st.status==='complete'){
            showToast(`Backfill complete ✓ — ${st.daysFrozen||0} of ${st.totalRealDays||0} real days frozen`);
          }else if(st.status==='error'){
            showToast('Backfill failed: '+(st.error||'unknown error'),'err');
          }else{
            showToast(`Still running (${st.progress||'starting'}) — check back shortly`,'err');
          }
          if(btn){btn.disabled=false;btn.textContent='⟳ Backfill Report History';}
        }else if(btn&&st.progress){
          btn.textContent='⟳ '+st.progress;
        }
      }catch(e){
        clearInterval(poll);
        showToast('Network error: '+e.message,'err');
        if(btn){btn.disabled=false;btn.textContent='⟳ Backfill Report History';}
      }
    },3000);
  }).catch(e=>{
    showToast('Backfill failed: '+e.message,'err');
    if(btn){btn.disabled=false;btn.textContent='⟳ Backfill Report History';}
  });
}















// Aug 19 2026 — real, genuine gap found via direct discussion with
// Priyam: Admin could push an edit through even when it affects real,
// already-existing Dye/Wind/Pack/Dispatch work downstream, with zero
// visibility into what that impact actually is until after save. Split
// into two: submitEditEntry now gathers the form and, for Soft only,
// shows a real preview first — same numbers the server would actually
// compute — before anything saves. Other stages unchanged, by design;
// preview intentionally Soft-only for now.
// Aug 26 2026 — real, genuine bug found and fixed via Priyam's real,
// live console log: _pendingEditBody's declaration was accidentally
// left behind here during today's earlier module-split, while every
// real function that actually uses it moved to editlog.js — meaning
// clicking Save genuinely crashed instantly with "not defined", doing
// nothing at all. Moved to editlog.js, where it's actually used.



export function fmtN(v){ return (+v||0).toFixed(2); }






// Jul 26 2026 — shared helper for the content-based duplicate-warning
// flow (confirmed design: exact match, 15-day window, warn never block).
// Used by every Start/Submit call site across Soft, Wind, and Pack so the
// confirm-and-resubmit logic stays identical everywhere rather than
// copy-pasted six times with six chances to drift apart.
export async function _postWithDuplicateCheck(endpoint, payload){
  const r1=await apiPost(endpoint,payload);
  if(r1.networkError||r1.ok)return r1;
  if(r1.data&&r1.data.duplicateWarning){
    if(confirm(r1.data.message+'\n\nClick OK to proceed anyway. Click Cancel to go back and check.')){
      // Jul 29 2026 fix — real, confirmed bug: this used to resubmit with
      // the exact same idempotencyKey as the first attempt. That key had
      // already been recorded as "seen" during the first request (before
      // the content-duplicate check even ran), so the resubmission — even
      // with the user's genuine, deliberate confirmation — was getting
      // blocked by a completely separate mechanism (the accidental-
      // double-click guard), which has no awareness of what was just
      // confirmed. A fresh key here means the confirmed resubmission is
      // correctly treated as the new, deliberate action it actually is.
      return await apiPost(endpoint,{...payload,confirmDuplicate:true,idempotencyKey:crypto.randomUUID()});
    }
    return {ok:false,data:r1.data,error:'__cancelled_by_user__',networkError:false};
  }
  return r1;
}



async function submitVoid2(){const setAlert=msg=>{document.getElementById('void2-alert').innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;};const reasonCat=document.getElementById('void2-reason-cat').value;const reasonText=document.getElementById('void2-reason-text').value.trim();if(!reasonCat){setAlert('Select void reason category');return;}
if(reasonText.length<10){setAlert('Reason must be at least 10 characters');return;}
const pwd=document.getElementById('void2-pwd').value;if(!pwd){setAlert('Password required');return;}
const chainEl=document.getElementById('void2-chain');const nodes=chainEl?._voidNodes||[];const selected=nodes.filter((n,idx)=>{const cb=document.getElementById('vchain-'+idx);return cb&&cb.checked&&!cb.disabled;});if(!selected.length){setAlert('Select at least one entry to void');return;}
const allNonVoided=nodes.filter(n=>n.status!=='Voided');const unselected=allNonVoided.filter((n,idx)=>{const cb=document.getElementById('vchain-'+idx);return cb&&!cb.checked&&!cb.disabled;});if(unselected.length>0){const msg=`You are voiding ${selected.length} entries but leaving ${unselected.length} downstream entries active:\n`
+unselected.map(n=>`  • ${n.label}`).join('\n')
+`\n\nThose entries will keep their current data but balances may be inconsistent.\nProceed anyway?`;if(!confirm(msg))return;}
try{
  const _voidRequestId=document.getElementById('void2-void-request-id')?.value||undefined;
  const {ok,data,error,networkError}=await apiPost('/api/void-chain',{selected:selected.map(n=>({id:n.id,stage:n.stage,grade:n.grade,vendor:n.vendor,delivIdx:n.delivIdx})),reasonCat,reasonText,password:pwd,username:State.currentUser?.username,changedBy:State.currentUser.name,voidRequestId:_voidRequestId});
  if(networkError)throw new Error(error);
  if(!ok){setAlert(error||'Could not void entries');return;}
  closeModal('void2-modal-overlay');showToast(`${data.voidCount} ${data.voidCount===1?'entry':'entries'} voided ✓`,'warn');
  // Aug 26 2026 — real, confirmed bug found via direct discussion with
  // Priyam, who reported voiding an RM entry "did not work at all". The
  // void genuinely succeeded on the backend — this refresh call simply
  // never included 'lots', so the RM Lots table never re-fetched and
  // kept showing the exact same, unchanged row, looking like nothing
  // happened even though it did. This same modal handles voiding RM,
  // Soft, Dye, Wind, Pack, or Dispatch entries, so 'lots' needs to be
  // included alongside the others every time, not just for RM.
  await _refreshAndRender(['lots','stageEntries','dyeLots','windEntries','packEntries','dispatches','voidRequests'],renderAll);
  // Aug 26 2026 — real, direct extension built via direct discussion
  // with Priyam: if this void left any real Dye batch now claiming
  // more than what's genuinely left, show exactly which ones, right
  // here, in the same flow — rather than someone discovering this
  // later, by accident, with no clear trail back to what caused it.
  if(data.affectedDyeBatches&&data.affectedDyeBatches.length>0){
    openGuidedReassignDialog(data.affectedDyeBatches);
  }
}catch(e){setAlert('Network error — not saved: '+e.message);}
}
























function switchStgTab(page,tab){State._stgTabs[page]=tab;const _tabs=(page==='dispatch')?['entries','ready','summary','flagged']:['entries','ready','pending','flagged'];_tabs.forEach(t=>{const btn=document.getElementById('stg-btn-'+page+'-'+t);const panel=document.getElementById('stg-panel-'+page+'-'+t);if(btn)btn.classList.toggle('active',t===tab);if(panel)panel.classList.toggle('active',t===tab);});const key=page+'-'+tab;if(key==='dispatch-summary')renderDispSummary();else _bevRender(key);}

function bevSortToggle(tabKey,colIdx){const s=State._bevSort[tabKey]=State._bevSort[tabKey]||{col:-1,dir:1};if(s.col===colIdx){s.dir*=-1;}else{s.col=colIdx;s.dir=1;}
_bevRender(tabKey);}






// Dynamically size .bev-dyn-h containers to use all remaining viewport space below them —
// replaces the old fixed "calc(100vh - 320px)" guess which left blank page space on
// screens where the header/tabs/filter row above the table take up a different amount
// of space than 320px assumed.

window.addEventListener('resize',()=>{clearTimeout(window._bevFitTimer);window._bevFitTimer=setTimeout(fitBevTableHeight,150);});








function renderDispSummary(){
  const el=document.getElementById('disp-summary-wrap');
  if(!el)return;
  // Show loading state
  el.innerHTML='<div class="card"><div style="color:var(--mu);font-size:0.8rem;padding:20px;text-align:center">Loading dispatch data...</div></div>';
  // Fetch all dispatches (active + archive) from Worker
  fetch(WORKER_URL+'/api/dispatch-summary',{headers:_getHeaders()})
    .then(r=>r.json())
    .then(data=>{window._dsAllDispatches=data.dispatches||[];_renderDispSummaryData(el,window._dsAllDispatches);})
    .catch(err=>{el.innerHTML='<div class="card"><div style="color:var(--re);font-size:0.8rem;padding:20px;text-align:center">Failed to load: '+err.message+'</div></div>';});
}
function _renderDispSummaryData(el, allDispatches){
  const _period=window._dsSummaryPeriod||'all';
  const _dim=window._dsSummaryDim||'shade';
  const _search=(window._dsSummarySearch||'').toLowerCase().trim();
  const _showAll=window._dsSummaryShowAll||false;
  const LIMIT=15;
  const now=new Date();
  const _inPeriod=(ts)=>{
    if(!ts)return false;
    const d=new Date(ts);
    if(_period==='week'){const w=new Date(now);w.setDate(w.getDate()-7);return d>=w;}
    if(_period==='month'){const m=new Date(now);m.setDate(m.getDate()-30);return d>=m;}
    return true;
  };
  const dispatches=allDispatches.filter(d=>_inPeriod(d.timestamp));

  const groups={};
  dispatches.forEach(d=>{
    let key='—';
    if(_dim==='shade')key=d.shade||'Unknown';
    else if(_dim==='grade')key=d.grade||'Unknown';
    else if(_dim==='party')key=d.party||'Unknown';
    if(!groups[key])groups[key]={key,bags:0,weight:0,count:0,parties:new Set(),shades:new Set()};
    groups[key].bags+=(d.bags||0);
    groups[key].weight+=(d.weight||0);
    groups[key].count++;
    if(d.party)groups[key].parties.add(d.party);
    if(d.shade)groups[key].shades.add(d.shade);
  });

  const allRows=Object.values(groups).sort((a,b)=>b.weight-a.weight);
  const totalKg=allRows.reduce((a,r)=>a+r.weight,0);
  const totalBags=allRows.reduce((a,r)=>a+r.bags,0);
  const maxKg=totalKg||1; // bar = share of total dispatched

  // Apply search filter
  const filtered=_search?allRows.filter(r=>r.key.toLowerCase().includes(_search)):allRows;
  const visible=_showAll||_search?filtered:filtered.slice(0,LIMIT);
  const hiddenCount=filtered.length-visible.length;

  const periodBtns=['week','month','all'].map(p=>`<button class="btn btn-sm ${_period===p?'btn-primary':'btn-ghost'}" onclick="window._dsSummaryPeriod='${p}';window._dsSummaryShowAll=false;_renderDispSummaryData(document.getElementById('disp-summary-wrap'),window._dsAllDispatches||[])">${p==='week'?'Week':p==='month'?'Month':'All Time'}</button>`).join('');
  const dimBtns=[['shade','By Shade'],['grade','By Grade'],['party','By Party']].map(([d,l])=>`<button class="btn btn-sm ${_dim===d?'btn-primary':'btn-ghost'}" onclick="window._dsSummaryDim='${d}';window._dsSummaryShowAll=false;window._dsSummarySearch='';_renderDispSummaryData(document.getElementById('disp-summary-wrap'),window._dsAllDispatches||[])">${l}</button>`).join('');
  const colLabel=_dim==='shade'?'Shade':_dim==='grade'?'Grade':'Party';
  const subLabel=_dim==='party'?'Shades':'Parties';
  const placeholder=_dim==='shade'?'Search shades...':_dim==='grade'?'Search grades...':'Search parties...';

  const rowsHtml=visible.map((r,i)=>{
    const globalRank=allRows.indexOf(r);
    const barPct=(r.weight/maxKg*100).toFixed(1);
    const barColor=globalRank===0?'var(--gr)':globalRank===1?'var(--ac)':globalRank<5?'var(--ye)':'var(--mu)';
    const subCount=_dim==='party'?r.shades.size:r.parties.size;
    return`<tr>
      <td style="padding:10px 12px;width:32px;color:var(--mu);font-size:0.65rem;text-align:right">#${globalRank+1}</td>
      <td style="padding:10px 12px;">
        <div style="font-size:0.8rem;font-weight:700;color:var(--tx)">${r.key}</div>
        <div style="font-size:0.65rem;color:var(--mu);margin-top:2px">${subCount} ${subLabel} · ${r.count} dispatch${r.count!==1?'es':''}</div>
      </td>
      <td style="padding:10px 12px;min-width:120px;">
        <div style="background:var(--s3);border-radius:4px;height:8px;overflow:hidden;">
          <div style="width:${barPct}%;height:100%;background:${barColor};border-radius:4px"></div>
        </div>
        <div style="font-size:0.62rem;color:var(--mu);margin-top:3px">${barPct}% of total</div>
      </td>
      <td style="padding:10px 12px;text-align:right;white-space:nowrap;">
        <div style="font-family:monospace;font-size:0.82rem;font-weight:700;color:${barColor}">${fmt(r.bags)}b / ${fmt(r.weight)}kg</div>

      </td>
    </tr>`;
  }).join('');

  const showAllBtn=hiddenCount>0&&!_search?`<tr><td colspan="4" style="padding:12px;text-align:center;border-top:1px solid var(--b1)"><button class="btn btn-ghost btn-sm" onclick="window._dsSummaryShowAll=true;_renderDispSummaryData(document.getElementById('disp-summary-wrap'),window._dsAllDispatches||[])">Show all ${filtered.length} ${colLabel.toLowerCase()}s</button></td></tr>`:'';

  el.innerHTML=`<div class="card" style="padding:0;overflow:hidden;">
    <div style="padding:16px 16px 12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;border-bottom:1px solid var(--b1)">
      <div>
        <div class="card-title" style="margin:0">Dispatch Summary</div>
        ${allRows.length?`<div style="font-size:0.7rem;color:var(--mu);margin-top:3px">${allRows.length} ${colLabel.toLowerCase()}s · ${fmt(totalBags)}b · ${fmt(totalKg)}kg total</div>`:''}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
        <div style="display:flex;gap:4px;">${periodBtns}</div>
        <div style="width:1px;background:var(--b1);margin:0 2px;align-self:stretch"></div>
        <div style="display:flex;gap:4px;">${dimBtns}</div>
      </div>
    </div>
    ${allRows.length?`
    <div style="padding:10px 16px;border-bottom:1px solid var(--b1);">
      <input class="fi" placeholder="${placeholder}" value="${(window._dsSummarySearch||'').replace(/"/g,'&quot;')}"
        oninput="window._dsSummarySearch=this.value;window._dsSummaryShowAll=false;_renderDispSummaryData(document.getElementById('disp-summary-wrap'),window._dsAllDispatches||[])"
        style="width:100%;max-width:320px;font-size:0.78rem;">
      ${_search&&filtered.length===0?'<span style="font-size:0.72rem;color:var(--mu);margin-left:8px">No results</span>':''}
      ${_search?`<span style="font-size:0.72rem;color:var(--mu);margin-left:8px">${filtered.length} result${filtered.length!==1?'s':''}</span>`:''}
    </div>
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:0.78rem;">
        <thead>
          <tr style="background:var(--s2);position:sticky;top:0;z-index:2;">
            <th style="padding:8px 12px;text-align:right;font-size:0.6rem;font-weight:700;text-transform:uppercase;color:var(--mu);white-space:nowrap">#</th>
            <th style="padding:8px 12px;text-align:left;font-size:0.6rem;font-weight:700;text-transform:uppercase;color:var(--mu)">${colLabel}</th>
            <th style="padding:8px 12px;text-align:left;font-size:0.6rem;font-weight:700;text-transform:uppercase;color:var(--mu);min-width:160px">Volume</th>
            <th style="padding:8px 12px;text-align:right;font-size:0.6rem;font-weight:700;text-transform:uppercase;color:var(--mu);white-space:nowrap">Bags / Kg</th>
          </tr>
        </thead>
        <tbody style="border-top:1px solid var(--b1)">
          ${rowsHtml}
          ${showAllBtn}
        </tbody>
      </table>
    </div>`:'<div style="padding:24px;text-align:center;color:var(--mu);font-size:0.8rem;">No dispatches in this period</div>'}
  </div>`;
}









export function renderAll(specificPage){const active=document.querySelector('.page.active');const id=specificPage||(active?active.id.replace('page-',''):State.currentPage);if(!specificPage){updateSidebarKPIs();updateMobileNavBadges();}
if(!id)return;setTimeout(()=>_updateAllClearBtns(),50);setTimeout(()=>updateStageSummaryBars(),100);if(id==='dashboard'){renderDashboard();}
else if(id==='rm')renderRMTable();else if(id==='stage')renderStageTable();else if(id==='dye')renderDyeTable();else if(id==='approval')renderApproval();else if(id==='dispatch'){renderDispatch();if(State._stgTabs['dispatch']==='summary')renderDispSummary();}
else if(id==='stock')renderStock();else if(id==='wind')renderWindTable();else if(id==='recycle'){renderRecyclePage();}else if(id==='pack')renderPackTable();else if(id==='stockregister'){showStockRegTab(window._stockRegTab||'dead',null);}else if(id==='editlog'){const _elIntegrityVisible=document.getElementById('elp-integrity')?.style.display!=='none';switchEditLogTab(_elIntegrityVisible?'integrity':'log',document.getElementById(_elIntegrityVisible?'elt-integrity':'elt-log'));}
else if(id==='party')renderPartyTracker();else if(id==='challan')renderChallan();else if(id==='dyelifecycle')renderDyeLifecycleSelect();else if(id==='lifecycle')renderLifecycle();else if(id==='wip')renderWIP();else if(id==='vendor')renderVendorV2();else if(id==='analytics'){loadDyeEntriesIfNeeded(function(){populateAnalyticsSelects();const at=document.querySelector('[id^="an-"].tab-panel.active');if(at)showAnTab(at.id.replace('an-',''),null);});}
else if(id==='reports'){loadDyeEntriesIfNeeded(renderReports);}
else if(id==='search'){renderSearch();}else if(id==='masters')renderMasters();else if(id==='users')renderUsers();renderAllBev();}








































export function toggleLCStage(key){lcExpanded[key]=!lcExpanded[key];renderLifecycle();}
// Sep 8 2026 — real, direct fix built via direct discussion with
// Priyam: this used to duplicate the exact same lot-filtering and
// sorting logic already in lifecycle.js's own _renderLifecycleCore
// (which renderLifecycle() calls) — genuinely redundant, since that
// function already reads the current vendor filter itself and
// rebuilds everything correctly. They happened to agree today, but
// it's the same real drift risk as the Dye Lifecycle case — two
// separately-written copies of one filter. Delegates directly now,
// so there's only ever one real implementation.
function updateLCLotDropdown(){renderLifecycle();}
function updateDLCDropdown(){_loadCatalog('dyeLots',()=>{const shade=document.getElementById('dlc-shade-select')?.value||'';const sel=document.getElementById('dye-lifecycle-select');if(!sel)return;const prev=sel.value;const lots=eligibleDyeLifecycleLots(shade);sel.innerHTML='<option value="">Select Dye Lot...</option>'+lots.map(d=>`<option value="${d.id}">${d.dyeLotNo} — ${d.shade}</option>`).join('');if(prev)sel.value=prev;renderDyeLifecycle();});}


function showTab(prefix,id,el){document.querySelectorAll(`[id^="${prefix}-"].tab-panel`).forEach(p=>{p.classList.remove('active');p.style.display='none';});if(el)el.parentNode.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));const panel=document.getElementById(`${prefix}-${id}`);if(panel){panel.classList.add('active');panel.style.display='';}
if(el)el.classList.add('active');renderReports();}








// Aug 6 2026 — removed: moved to Edit Log & Integrity's Daily Balance
// Checker as its real, permanent home, under the new "Total In vs Out"
// sub-tab alongside Conservation. Rebuilt server-side there, using
// genuinely fresh calc*() functions instead of this client-side
// version's cache-first reads (getRMBalance etc.) — the same weak spot
// found and fixed everywhere else this session. All 17 real checks
// confirmed ported 1-to-1 before this was removed.















async function confirmPartialDelivery(){if(!State._pendingDelivery)return;const{lot,vendor,mill,grade,units,weight,date,challan}=State._pendingDelivery;try{
  const {ok,data,error,networkError}=await apiPost('/api/rm/create',{lotId:lot,vendor,mill,grade,units,weight,date,challan,changedBy:State.currentUser?.name});
  if(networkError)throw new Error(error);
  if(!ok){showToast(error||'Could not add delivery','err');State._pendingDelivery=null;cancelPartialDelivery();return;}
  State._pendingDelivery=null;cancelPartialDelivery();closeModal('rm-modal');showToast('Delivery added to '+lot+' ✓');await _refreshAndRender(['lots'],renderAll);
}catch(e){showToast('Network error — '+e.message,'err');State._pendingDelivery=null;cancelPartialDelivery();}
}
function cancelPartialDelivery(){State._pendingDelivery=null;document.getElementById('rm-partial-panel').style.display='none';document.getElementById('rm-form-body').style.opacity='1';document.getElementById('rm-modal-foot').style.display='flex';}











export function stageIcon(s){return STAGE_CONFIG[s]?.icon||'⚙';}
export function stageColor(s){return STAGE_CONFIG[s]?.color||'var(--ac)';}

























window.wOnDyeEndSerialInput=wOnDyeEndSerialInput;










function showMobileMenu(){openModal('mobile-menu-overlay');}
function navFromMenu(id){closeModal('mobile-menu-overlay');nav(id,document.getElementById('ni-'+id));}








function vtSelectLot(key){State.vtSelectedLot=key;const[_vlId,_vlGrade,_vlVendor]=key.split('||');_hydrateLot(_vlId,_vlGrade,_vlVendor,()=>{renderVendorV2();});}




export function vtToggleVoided(key){State._vtShowVoided[key]=!(State._vtShowVoided[key]||false);renderVendorV2();}



export function toggleSourceRows(btn,rowId){const rows=document.querySelectorAll('.src-sub-'+rowId);const exp=btn.getAttribute('data-exp')==='1';rows.forEach(r=>r.style.display=exp?'none':'');btn.textContent=exp?'▼':'▲';btn.setAttribute('data-exp',exp?'0':'1');}
// Jul 22 2026 — the Dye/Wind/Pack filter bars get fully rebuilt (innerHTML
// replaced) on every keystroke, which silently destroys and recreates the
// input you're typing into. The value gets restored after, but focus
// doesn't — so every character requires clicking back into the box first.
// These two helpers capture focus + cursor position immediately before a
// rebuild, and restore both immediately after — used by renderDyeTable,
// renderWindTable, and renderPackTable, all of which share this exact
// structure.






function onAdsVendorChange(rowId){const div=document.getElementById(rowId);const vendor=div.querySelector('select').value;const gradeEl=document.getElementById(rowId+'-grade');const lotEl=document.getElementById(rowId+'-lot');gradeEl.innerHTML='<option value="">Select grade...</option>';lotEl.innerHTML='<option value="">Select lot...</option>';gradeEl.disabled=true;lotEl.disabled=true;if(!vendor)return;const grades=[...new Set(State.DB.lots.filter(l=>l.vendor===vendor&&getSoftBalance(l.id,l.grade,l.vendor).units>0).map(l=>l.grade))].sort();gradeEl.innerHTML='<option value="">Select grade...</option>'+grades.map(g=>`<option value="${g}">${g}</option>`).join('');gradeEl.disabled=false;}
function onAdsGradeChange(rowId){const div=document.getElementById(rowId);const vendor=div.querySelector('select').value;const grade=document.getElementById(rowId+'-grade').value;const lotEl=document.getElementById(rowId+'-lot');lotEl.innerHTML='<option value="">Select lot...</option>';lotEl.disabled=true;if(!vendor||!grade)return;const lots=State.DB.lots.filter(l=>l.vendor===vendor&&l.grade===grade&&getSoftBalance(l.id,l.grade,l.vendor).units>0);lotEl.innerHTML='<option value="">Select lot...</option>'+lots.map(l=>{const bal=getSoftBalance(l.id,l.grade,l.vendor);return`<option value="${l.id}||${l.grade}||${l.vendor}">${l.id} (${fmt(bal.units)}u / ${fmt(bal.weight)}kg avail)</option>`;}).join('');lotEl.disabled=false;}
function updateLotAvailHint(sel){const rawV=sel.value;if(!rawV)return;const parts=rawV.split('||');const lotId=parts[0];const grade=parts[1]||'';const vendor=parts[2]||'';const _ulaL=getLotByKey(lotId,grade,vendor)||getLot(lotId);const bal=getSoftBalance(lotId,_ulaL.grade,_ulaL.vendor);const row=sel.closest('div[id^="ads-"]');if(row){const unitInput=row.querySelector('input[data-field="units"]');const wtInput=row.querySelector('input[data-field="weight"]');const coneInput=row.querySelector('input[data-field="cones"]');if(unitInput&&!unitInput.value)unitInput.placeholder=`max ${fmt(bal.units)}u`;if(wtInput&&!wtInput.value)wtInput.placeholder=`max ${fmt(bal.weight)}kg`;}}
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();State.deferredPrompt=e;});
window.addEventListener('appinstalled',()=>{State.deferredPrompt=null;const banner=document.getElementById('install-banner-removed');if(banner)banner.classList.remove('show');console.log('PWA installed successfully');});


window.addEventListener('online',updateOnlineStatus);
window.addEventListener('offline',updateOnlineStatus);
document.addEventListener('touchstart',e=>{State.touchStartY=e.touches[0].clientY;},{passive:true});
document.addEventListener('touchend',e=>{const diff=e.changedTouches[0].clientY-State.touchStartY;if(diff>80){const openOverlay=document.querySelector('.overlay.open');if(openOverlay)closeModal(openOverlay.id);}},{passive:true});
function openMobDrawer(){document.getElementById('mob-drawer')?.classList.add('open');document.getElementById('mob-drawer-overlay')?.classList.add('open');if(State.currentUser){const av=document.getElementById('mob-drawer-av');const nm=document.getElementById('mob-drawer-name');const rl=document.getElementById('mob-drawer-role');if(av)av.textContent=State.currentUser.name?.[0]?.toUpperCase()||'A';if(nm)nm.textContent=State.currentUser.name||'Admin';if(rl)rl.textContent=State.currentUser.role==='manager'?'Manager':State.currentUser.role==='supervisor'?'Supervisor':'Worker';}
const setupSec=document.getElementById('mob-setup-sec');if(setupSec)setupSec.style.display=(State.currentUser?.role==='manager')?'':'none';const isWorker=State.currentUser?.role==='worker';document.querySelectorAll('.mob-drawer-item').forEach(el=>{const onclick=el.getAttribute('onclick')||'';if(isWorker&&(onclick.includes("'rm'")||onclick.includes("'masters'")||onclick.includes("'users'")||onclick.includes("'analytics'")||onclick.includes("'reports'"))){el.style.display='none';}else{el.style.display='';}});const activePage=document.querySelector('.page.active');if(activePage){const activeId=activePage.id.replace('page-','');document.querySelectorAll('.mob-drawer-item').forEach(el=>{const onclick=el.getAttribute('onclick')||'';el.classList.toggle('active',onclick.includes("'"+activeId+"'"));});}}
function closeMobDrawer(){document.getElementById('mob-drawer')?.classList.remove('open');document.getElementById('mob-drawer-overlay')?.classList.remove('open');}
function mobNav(id){closeMobDrawer();nav(id,document.getElementById('ni-'+id));const titles={dashboard:'Dashboard',rm:'RM Entry',stage:'Stage Entry',dye:'Dye Lots',wind:'Wind',pack:'Pack',dispatch:'Dispatch',wip:'WIP',approval:'Approval',stock:'Live Stock',lifecycle:'Lot Lifecycle',dyelifecycle:'Dye Lifecycle',vendor:'Vendor Tracker',partytracker:'Party Tracker',deadstock:'Dead Stock',recycle:'Recycle Stock',analytics:'Analytics',reports:'Reports',masters:'Masters',users:'Users'};const titleEl=document.getElementById('mob-page-title');if(titleEl)titleEl.textContent=titles[id]||id;document.querySelectorAll('.mob-drawer-item').forEach(el=>el.classList.remove('active'));}
updateOnlineStatus();
function openFlagModal(lotId,grade,vendor){const canFlag=State.currentUser?.role==='manager'||State.currentUser?.role==='supervisor'||State.currentUser?.role==='admin';if(!canFlag){alert('Only supervisors and admins can add flags');return;}
// Aug 26 2026 — real, genuine fix built via direct discussion with
// Priyam, found while checking this system before building the new
// auto-flag feature on top of it: this used to key by lotId alone,
// the exact same ambiguous-match bug already found and fixed for the
// void chain — several different, real lots commonly share the same
// lot number. Now uses the full lot+grade+vendor address throughout.
const _flagKey=_flagKeyRM(lotId,grade,vendor);
document.getElementById('flag-lot-id').value=lotId;document.getElementById('flag-lot-grade').value=grade||'';document.getElementById('flag-lot-vendor').value=vendor||'';document.getElementById('flag-modal-title').textContent='🏷 Flag — '+lotId;const existing=(State.DB.lotFlags||{})[_flagKey];document.getElementById('flag-type').value=existing?.type||'';document.getElementById('flag-note').value=existing?.note||'';document.getElementById('flag-prev-type').value=existing?.type||'';document.getElementById('flag-override-reason').value='';document.getElementById('flag-override-pwd').value='';document.getElementById('flag-alert').innerHTML='';_toggleFlagOverrideFields('flag');openModal('flag-modal');}
// Sep 8 2026 — real, direct feature built via direct discussion with
// Priyam: shows the override reason/password fields only when the
// EXISTING flag type is 'hold' AND the user is now selecting "clear"
// — since only clearing an actual Hold needs this, not setting a new
// flag or clearing anything else.
function _toggleFlagOverrideFields(prefix){const prevType=document.getElementById(prefix+'-prev-type')?.value||'';const curType=document.getElementById(prefix+'-type')?.value||'';const box=document.getElementById(prefix+'-override-fields');if(box)box.style.display=(prevType==='hold'&&!curType)?'':'none';}
async function saveFlag(){const lotId=document.getElementById('flag-lot-id').value;const grade=document.getElementById('flag-lot-grade').value;const vendor=document.getElementById('flag-lot-vendor').value;const type=document.getElementById('flag-type').value;const note=document.getElementById('flag-note').value.trim();const prevType=document.getElementById('flag-prev-type').value;if(type&&!note){setAlert('flag-alert','Please add a note for the flag','alert-err');return;}
const body={lotId,grade,vendor,type,note,changedBy:State.currentUser?.name,role:State.currentUser?.role};
if(!type&&prevType==='hold'){const overrideReason=document.getElementById('flag-override-reason').value.trim();const password=document.getElementById('flag-override-pwd').value;if(overrideReason.length<10){setAlert('flag-alert','Provide a real reason (min 10 characters) to clear this Hold','alert-err');return;}
if(!password){setAlert('flag-alert','Enter your password to confirm','alert-err');return;}
body.overrideReason=overrideReason;body.password=password;body.username=State.currentUser?.username;}
try{const {ok,error,networkError}=await apiPost('/api/lot/flag',body);if(networkError)throw new Error(error);if(!ok){setAlert('flag-alert',error||'Could not save flag','alert-err');return;}closeModal('flag-modal');await _refreshAndRender(['lotFlags'],renderAll);}catch(e){setAlert('flag-alert','Network error — '+e.message,'alert-err');}}
export function flagPill(lotId,grade,vendor){const _flagKey=_flagKeyRM(lotId,grade,vendor);const f=(State.DB.lotFlags||{})[_flagKey];if(!f)return`<button class="btn bg bxs" onclick="openFlagModal('${lotId}','${grade}','${vendor}')">＋ Flag</button>`;const fc=FLAG_COLORS[f.type]||FLAG_COLORS.info;const canFlag=State.currentUser?.role==='manager'||State.currentUser?.role==='supervisor'||State.currentUser?.role==='admin';return`<span title="${f.note} (${f.by})" onclick="${canFlag?`openFlagModal('${lotId}','${grade}','${vendor}')`:''}"
    style="cursor:${canFlag?'pointer':'default'};display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:4px;
    font-size:0.65rem;font-weight:700;background:${fc.bg};color:${fc.color};border:1px solid ${fc.border}">
    ${fc.emoji} ${fc.label}
  </span>`;}

// Aug 26 2026 — real, direct extension of the exact same real flag
// system, for Dye Lots specifically. Closes the honest gap flagged
// earlier today — the Pack/Dispatch imbalance risk was already
// detected and now auto-flagged server-side, but had nowhere real to
// actually show until this. Genuinely simpler than RM's own version,
// since a Dye Lot id is already, provably unique on its own.
function openDyeFlagModal(dyeLotId){const canFlag=State.currentUser?.role==='manager'||State.currentUser?.role==='supervisor'||State.currentUser?.role==='admin';if(!canFlag){alert('Only supervisors and admins can add flags');return;}
document.getElementById('dye-flag-lot-id').value=dyeLotId;document.getElementById('dye-flag-modal-title').textContent='🏷 Flag — '+dyeLotId;const existing=(State.DB.dyeLotFlags||{})[_flagKeySafe(dyeLotId)];document.getElementById('dye-flag-type').value=existing?.type||'';document.getElementById('dye-flag-note').value=existing?.note||'';document.getElementById('dye-flag-prev-type').value=existing?.type||'';document.getElementById('dye-flag-override-reason').value='';document.getElementById('dye-flag-override-pwd').value='';document.getElementById('dye-flag-alert').innerHTML='';_toggleFlagOverrideFields('dye-flag');openModal('dye-flag-modal');}
async function saveDyeFlag(){const dyeLotId=document.getElementById('dye-flag-lot-id').value;const type=document.getElementById('dye-flag-type').value;const note=document.getElementById('dye-flag-note').value.trim();const prevType=document.getElementById('dye-flag-prev-type').value;if(type&&!note){setAlert('dye-flag-alert','Please add a note for the flag','alert-err');return;}
const body={dyeLotId,type,note,changedBy:State.currentUser?.name,role:State.currentUser?.role};
if(!type&&prevType==='hold'){const overrideReason=document.getElementById('dye-flag-override-reason').value.trim();const password=document.getElementById('dye-flag-override-pwd').value;if(overrideReason.length<10){setAlert('dye-flag-alert','Provide a real reason (min 10 characters) to clear this Hold','alert-err');return;}
if(!password){setAlert('dye-flag-alert','Enter your password to confirm','alert-err');return;}
body.overrideReason=overrideReason;body.password=password;body.username=State.currentUser?.username;}
try{const {ok,error,networkError}=await apiPost('/api/dye-lot/flag',body);if(networkError)throw new Error(error);if(!ok){setAlert('dye-flag-alert',error||'Could not save flag','alert-err');return;}closeModal('dye-flag-modal');await _refreshAndRender(['dyeLotFlags'],renderAll);}catch(e){setAlert('dye-flag-alert','Network error — '+e.message,'alert-err');}}
export function dyeFlagPill(dyeLotId){const f=(State.DB.dyeLotFlags||{})[_flagKeySafe(dyeLotId)];if(!f)return`<button class="btn bg bxs" onclick="openDyeFlagModal('${dyeLotId}')">＋ Flag</button>`;const fc=FLAG_COLORS[f.type]||FLAG_COLORS.info;const canFlag=State.currentUser?.role==='manager'||State.currentUser?.role==='supervisor'||State.currentUser?.role==='admin';return`<span title="${f.note} (${f.by})" onclick="${canFlag?`openDyeFlagModal('${dyeLotId}')`:''}"
    style="cursor:${canFlag?'pointer':'default'};display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:4px;
    font-size:0.65rem;font-weight:700;background:${fc.bg};color:${fc.color};border:1px solid ${fc.border}">
    ${fc.emoji} ${fc.label}
  </span>`;}

// Aug 26 2026 — real, shared extension after Priyam's own, direct
// instruction: manual flagging genuinely needs to exist at every
// stage, not just RM and Dye. Soft, Wind, Pack, and Dispatch entries
// all already have their own, genuinely unique ids, confirmed
// directly against real production data earlier today — one, single,
// shared system safely covers all 4 stages, rather than building 4
// near-identical, duplicate systems.
function openEntryFlagModal(entryId){const canFlag=State.currentUser?.role==='manager'||State.currentUser?.role==='supervisor'||State.currentUser?.role==='admin';if(!canFlag){alert('Only supervisors and admins can add flags');return;}
document.getElementById('entry-flag-id').value=entryId;document.getElementById('entry-flag-modal-title').textContent='🏷 Flag — '+entryId;const existing=(State.DB.entryFlags||{})[_flagKeySafe(entryId)];document.getElementById('entry-flag-type').value=existing?.type||'';document.getElementById('entry-flag-note').value=existing?.note||'';document.getElementById('entry-flag-alert').innerHTML='';openModal('entry-flag-modal');}
async function saveEntryFlag(){const entryId=document.getElementById('entry-flag-id').value;const type=document.getElementById('entry-flag-type').value;const note=document.getElementById('entry-flag-note').value.trim();if(type&&!note){setAlert('entry-flag-alert','Please add a note for the flag','alert-err');return;}
try{const {ok,error,networkError}=await apiPost('/api/entry/flag',{entryId,type,note,changedBy:State.currentUser?.name,role:State.currentUser?.role});if(networkError)throw new Error(error);if(!ok){setAlert('entry-flag-alert',error||'Could not save flag','alert-err');return;}closeModal('entry-flag-modal');await _refreshAndRender(['entryFlags'],renderAll);}catch(e){setAlert('entry-flag-alert','Network error — '+e.message,'alert-err');}}
export function entryFlagPill(entryId){const f=(State.DB.entryFlags||{})[_flagKeySafe(entryId)];if(!f)return`<button class="btn bg bxs" onclick="openEntryFlagModal('${entryId}')">＋ Flag</button>`;const fc=FLAG_COLORS[f.type]||FLAG_COLORS.info;const canFlag=State.currentUser?.role==='manager'||State.currentUser?.role==='supervisor'||State.currentUser?.role==='admin';return`<span title="${f.note} (${f.by})" onclick="${canFlag?`openEntryFlagModal('${entryId}')`:''}"
    style="cursor:${canFlag?'pointer':'default'};display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:4px;
    font-size:0.65rem;font-weight:700;background:${fc.bg};color:${fc.color};border:1px solid ${fc.border}">
    ${fc.emoji} ${fc.label}
  </span>`;}

















































function onDispLotChange(i,dyeLotId){if(!window._dispLotRows)return;const dLot=(State.DB.dyeLots||[]).find(d=>d.id===dyeLotId);const grade=dLot?(dLot.sources||[]).map(s=>s.grade).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join('+'):'';window._dispLotRows[i].dyeLotId=dyeLotId;window._dispLotRows[i].grade=grade;window._dispLotRows[i].bags='';window._dispLotRows[i].weight='';renderDispatchLotRows();}
function onDispRowInput(i,field,val){if(!window._dispLotRows)return;window._dispLotRows[i][field]=val;updateDispatchTotal();}































async function submitDeleteRequest(){const key=document.getElementById('del-req-key').value;const val=document.getElementById('del-req-val').value;const reason=document.getElementById('del-req-reason').value.trim();if(!key||!val){setAlert('del-req-alert','Invalid request','alert-err');return;}
try{const {ok,error,networkError}=await apiPost('/api/delete-request',{action:'create',key,val,reason,changedBy:State.currentUser?.name});if(networkError)throw new Error(error);if(!ok){setAlert('del-req-alert',error||'Could not send request','alert-err');return;}closeModal('del-req-modal');showToast('Delete request sent to admin ✓');await _refreshAndRender(['deleteRequests'],renderMasters);}catch(e){setAlert('del-req-alert','Network error — '+e.message,'alert-err');}}




export function populateSelects(){const V=[...(State.DB.masters.vendors||[])].sort();const ML=[...(State.DB.masters.mills||[])].sort();const G=[...(State.DB.masters.grades||[])].sort();const M=machinesForStage('Dye');const W=workersSorted();const opts=(arr,empty='Select...')=>`<option value="">${empty}</option>${arr.map(v=>`<option value="${v}">${v}</option>`).join('')}`;const setEl=(id,h)=>{const el=document.getElementById(id);if(el)el.innerHTML=h;};setEl('m-rm-vendor',opts(V));setEl('m-rm-mill',opts(ML));setEl('m-rm-grade',opts(G));setEl('m-dye-grade',`<option value="">Select Grade</option>${[...new Set(State.DB.lots.map(l=>l.grade))].sort().map(g=>`<option value="${g}">${g}</option>`).join('')}`);setEl('m-dye-machine',opts(M));setEl('m-dye-worker',opts(W));populatePartySelect();['m-rm-date','m-dye-date','m-disp-date'].forEach(id=>{const el=document.getElementById(id);if(el&&!el.value)el.value=today();});}












// Aug 5 2026 — Priyam's direct suggestion: the 3 separate scans (stale
// addresses, duplicate lot IDs, lot address mismatches) all check
// different real things, but there's no reason to run and read them
// one at a time anymore, now that the one-time setup work is done.
// Runs all 3 in parallel, shows one combined, honest status.















document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();nav('search',document.getElementById('ni-search'));setTimeout(()=>document.getElementById('global-search-input')?.focus(),100);}});












// ─── Daily Balance Checker — client side (Jul 17 2026) ─────────────────────
// Renders the table exactly as finalized: Stage / Lot No / Vendor / Grade /
// Shade / Field / Live / Check 1 / Check 2 / What's Wrong. One row per real
// mismatch — clean fields never show a row. Jul 18 2026 — the separate
// Balance Audit tool this was originally built alongside has been removed;
// this checker does the same recompute check plus an independent
// conservation check, and doesn't have the reload-crash problem the old
// tool had. This is now the only balance-integrity check in the app.





window.runDailyCheckNow=runDailyCheckNow;

















window.addEventListener('resize',setupMobileNav);
initTheme();
try{try{initFirebase();}catch(e){console.warn('Firebase init error:',e);}
const _sess=sessionStorage.getItem('tcv2_session');if(_sess){try{const _sd=JSON.parse(_sess);if(_sd&&_sd.username){State.currentUser=_sd;window.currentUser=State.currentUser;console.log('[Auth] Session restored:',State.currentUser.name,'/',State.currentUser.role);_maybeStartDataLoad();if(State.firebaseLoaded){onLogin();}else{_waitForDBThenLogin();}}else{showLoginScreenSafe();}}catch(e){showLoginScreenSafe();}}else{showLoginScreenSafe();}}catch(e){console.error('Init error:',e);try{document.getElementById('login-screen').classList.remove('hidden');}catch(e2){}}
window.onerror=function(msg,src,line,col,err){console.error("🔥 JS ERROR:",msg,"at",line+":"+col);};
document.addEventListener('DOMContentLoaded',function(){const navItems=document.querySelectorAll('.nav-item, .mbn-item, .mob-drawer-item');const pages=document.querySelectorAll('.page');function switchPage(target){if(!target)return;pages.forEach(p=>p.classList.remove('active'));let page=document.getElementById(target)||document.getElementById(target+'-page');if(page){page.classList.add('active');}else{console.error('❌ Page not found:',target);}}
navItems.forEach(item=>{item.addEventListener('click',function(){const target=this.getAttribute('data-page');navItems.forEach(i=>i.classList.remove('active'));this.classList.add('active');switchPage(target);});});const first=document.querySelector('.nav-item.active');if(first){switchPage(first.getAttribute('data-page'));}else if(navItems.length){navItems[0].classList.add('active');switchPage(navItems[0].getAttribute('data-page'));}});





function vtOnVendorChange(v){State.vtSelectedVendor=v;State.vtSelectedLot='';_loadCatalog('lots',()=>{renderVendorV2();});}
function vtOnStatusFilter(v){State.vtSelectedLot='';renderVendorV2();} 

// Same as core.js — inline HTML handlers need explicit window bindings
// under ES modules.
window.adminPasswordAction = adminPasswordAction;
window.cancelPartialDelivery = cancelPartialDelivery;
window.closeMobDrawer = closeMobDrawer;
window.confirmAdminPwd = confirmAdminPwd;
window.confirmPartialDelivery = confirmPartialDelivery;
window.dyeSplitCalc = dyeSplitCalc;
window.dyeSplitCones = dyeSplitCones;
window.exportCSV = exportCSV;
window.exportPDF = exportPDF;
window.exportToExcel = exportToExcel;
window.mobNav = mobNav;
window.navFromMenu = navFromMenu;
window.openMobDrawer = openMobDrawer;
window.openPartyOrderModal = openPartyOrderModal;
window.recalcAllSummaries = recalcAllSummaries;
window.backfillSnapshots = backfillSnapshots;
window.renderAnDailyLog = renderAnDailyLog;
window.renderComparison = renderComparison;
window.renderDyeLifecycle = renderDyeLifecycle;
window.renderDyeLifecycleSelect = renderDyeLifecycleSelect;
window.renderEditLog = renderEditLog;
window.renderLifecycle = renderLifecycle;
window.renderMachineHealth = renderMachineHealth;
window.renderTrend = renderTrend;
window.renderVendorV2 = renderVendorV2;
window.renderWorkerScorecard = renderWorkerScorecard;
window.rptDaily = rptDaily;
window.rptFlow = rptFlow;
window.rptGrade = rptGrade;
window.rptMachine = rptMachine;
window.rptPack = rptPack;
window.rptShade = rptShade;
window.rptWaste = rptWaste;
window.rptWorker = rptWorker;
window.saveFlag = saveFlag;
window._toggleFlagOverrideFields = _toggleFlagOverrideFields;
window.saveDyeFlag = saveDyeFlag;
window.saveEntryFlag = saveEntryFlag;
window.setAnDate = setAnDate;
window.setCmpQuick = setCmpQuick;
window.setDashPeriod = setDashPeriod;
window.setMHPeriod = setMHPeriod;
window.setRptFilter = setRptFilter;
window.setTrendGroup = setTrendGroup;
window.showAnTab = showAnTab;
window.showBackupModal = showBackupModal;
window.showMobileMenu = showMobileMenu;
window.showStockRegTab = showStockRegTab;
window.showTab = showTab;
// Aug 26 2026 — real, direct extension built via direct discussion with
// Priyam: guided reassign, shown right after a Soft void, in the same
// flow, for every real Dye batch left claiming more than what's
// genuinely available. Anything left unfixed when this closes gets a
// real, persistent, automatic flag — the exact same system already
// built today — never silently lost.
let _guidedReassignState = null;

function openGuidedReassignDialog(affectedDyeBatches){
  _guidedReassignState = { batches: [], fixed: new Set() };
  affectedDyeBatches.forEach(lot => {
    lot.dyeBatches.forEach(db => {
      _guidedReassignState.batches.push({ ...db, lotId: lot.lotId, grade: lot.grade, vendor: lot.vendor, shortfallKg: lot.shortfallKg });
    });
  });
  _renderGuidedReassignDialog();
  openModal('guided-reassign-overlay');
}

function _renderGuidedReassignDialog(){
  const st = _guidedReassignState;
  const body = document.getElementById('guided-reassign-body');
  if(!st || !body) return;
  body.innerHTML = st.batches.map((b, i) => {
    const isFixed = st.fixed.has(i);
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px;margin-bottom:8px;border-radius:6px;background:${isFixed?'rgba(34,197,94,0.08)':'rgba(239,68,68,0.06)'};border:1px solid ${isFixed?'rgba(34,197,94,0.3)':'rgba(239,68,68,0.3)'}">
      <div>
        <div style="font-size:0.8rem;font-weight:700;${isFixed?'text-decoration:line-through;color:var(--mu)':''}">${b.dyeLotNo||b.dyeLotId} — ${b.shade||''}</div>
        <div style="font-size:0.68rem;color:var(--mu)">Claims ${b.claimedKg}kg from ${b.lotId} / ${b.grade} / ${b.vendor} — now short by up to ${b.shortfallKg.toFixed(2)}kg</div>
      </div>
      ${isFixed?'<span style="color:var(--gr);font-size:0.78rem;font-weight:700">✓ Fixed</span>':`<button class="btn btn-primary btn-xs" onclick="_openReassignFromGuided(${i})">Reassign</button>`}
    </div>`;
  }).join('');
}

function _openReassignFromGuided(idx){
  const b = _guidedReassignState.batches[idx];
  _guidedReassignState._lastOpenedIdx = idx;
  // Sep 10 2026 — real, genuine bug found via direct discussion with
  // Priyam, while investigating a separate cleanup: this used to open
  // a 'reassign' tab and look for a 'reassign-old-source' dropdown,
  // neither of which have existed since Reassign was folded into Dye
  // Input Edit — so this button has been silently broken since then.
  // Dye Input Edit's own Input tab already shows every real source as
  // its own editable row (including the one that needs correcting)
  // the moment it opens, so no separate pre-select step is needed.
  openEditEntryModal(b.dyeLotId, 'dye');
  setTimeout(() => { _switchEditEntryTab('input'); }, 50);
}

function closeGuidedReassignDialog(){
  const st = _guidedReassignState;
  if(st){
    const unfixed = st.batches.filter((b, i) => !st.fixed.has(i));
    unfixed.forEach(b => {
      apiPost('/api/dye-lot/flag', {
        dyeLotId: b.dyeLotId, type: 'warn',
        note: `Auto-flagged — still claims from ${b.lotId}/${b.grade}/${b.vendor}, which was voided and now short by ${b.shortfallKg.toFixed(2)}kg`,
        changedBy: State.currentUser?.name, role: State.currentUser?.role
      }).catch(()=>{});
    });
    if(unfixed.length>0) showToast(`${unfixed.length} batch${unfixed.length===1?'':'es'} left flagged for later`, 'warn');
  }
  _guidedReassignState = null;
  closeModal('guided-reassign-overlay');
  _refreshAndRender(['dyeLotFlags'], renderAll);
}

// Sep 10 2026 — real, genuine bug found and fixed alongside
// _openReassignFromGuided's own broken tab reference, from the same
// direct discussion with Priyam: nothing ever actually marked a batch
// "fixed" once corrected — so every batch always looked open, and the
// dialog's own auto-flag-on-close logic always treated every batch as
// still unfixed, regardless of what was actually corrected. Called
// from editlog.js's own Dye Input Edit save, after it genuinely
// succeeds, passing the real dyeLotId that was actually edited —
// checked against the batch at _lastOpenedIdx so an unrelated edit,
// made while this dialog happens to still be open in the background,
// can never mark the wrong batch fixed. Safely does nothing if the
// guided dialog isn't the one that's actually open right now.
export function _markGuidedReassignFixed(editedDyeLotId){
  const st = _guidedReassignState;
  if(!st || st._lastOpenedIdx === undefined) return;
  const b = st.batches[st._lastOpenedIdx];
  if(!b || b.dyeLotId !== editedDyeLotId) return;
  st.fixed.add(st._lastOpenedIdx);
  _renderGuidedReassignDialog();
}

window.openGuidedReassignDialog = openGuidedReassignDialog;
window._openReassignFromGuided = _openReassignFromGuided;
window.closeGuidedReassignDialog = closeGuidedReassignDialog;
window.submitDeleteRequest = submitDeleteRequest;
window.submitLinkOrder = submitLinkOrder;
window.submitPartyOrder = submitPartyOrder;
window.submitVoid2 = submitVoid2;
window.switchStgTab = switchStgTab;
window.updateDLCDropdown = updateDLCDropdown;
window.updateLCLotDropdown = updateLCLotDropdown;
window.vtOnStatusFilter = vtOnStatusFilter;
window.vtOnVendorChange = vtOnVendorChange;
window.vtSelectLot = vtSelectLot;

// Circular-import fix (Jul 10 2026): core.js calls these 6 pages.js
// functions via window.x() instead of `import`, breaking a circular
// dependency that caused a real TDZ crash in staging — core.js's own
// import {...} from './pages.js' forced pages.js's top-level code
// (window.addEventListener registrations) to run before core.js finished
// initializing its own State/isOnline, throwing "Cannot access before
// initialization" and aborting the rest of the script. See AGENTS.md.
window.populateSelects = populateSelects;
window.renderAll = renderAll;
window.renderLoginDemoCards = renderLoginDemoCards;
window.renderWorkerView = renderWorkerView;

// Round 2 (Jul 10 2026) — see core.js for explanation.
window._renderDispSummaryData = _renderDispSummaryData;
window._rptTblSort = _rptTblSort;
window._showFilterClearBtn = _showFilterClearBtn;
window.applyTableFilter = applyTableFilter;
window.approveDyeLot = approveDyeLot;
window.bevSortToggle = bevSortToggle;
window.cancelPartyOrder = cancelPartyOrder;
window.clearMachFilter = clearMachFilter;
window.clearSingleFilter = clearSingleFilter;
window.clearWorkFilter = clearWorkFilter;
window.dashAlertNav = dashAlertNav;
window.deleteFirebaseBackup = deleteFirebaseBackup;
window.executeOverride = executeOverride;
window.exportBackupJSON = exportBackupJSON;
window.exportCurrentCSV = exportCurrentCSV;
window.exportFirebaseBackup = exportFirebaseBackup;
window.fillLogin = fillLogin;
window.filterLotOpts = filterLotOpts;
window.manualBackup = manualBackup;
window.navToParty = navToParty;
window.onAdsGradeChange = onAdsGradeChange;
window.onAdsVendorChange = onAdsVendorChange;
window.onDispLotChange = onDispLotChange;
window.onDispRowInput = onDispRowInput;
window.openDyeLifecycle = openDyeLifecycle;
window.openFlagModal = openFlagModal;
window.openDyeFlagModal = openDyeFlagModal;
window.openEntryFlagModal = openEntryFlagModal;
window.openLinkOrder = openLinkOrder;
window.openOverride = openOverride;
window.openPartyFromDyeLot = openPartyFromDyeLot;
window.openRMLifecycle = openRMLifecycle;
window.refreshWDyeLots = refreshWDyeLots;
window.rejectDyeLot = rejectDyeLot;
window.renderPartyTracker = renderPartyTracker;
window.setPackFilter = setPackFilter;
window.setWasteFilter = setWasteFilter;
window.submitOverride = submitOverride;
window.toggleLCStage = toggleLCStage;
window.toggleSort = toggleSort;
window.toggleSourceRows = toggleSourceRows;
window.updateLotAvailHint = updateLotAvailHint;
window.runStaleLotScan = runStaleLotScan;
window.runDuplicateLotScan = runDuplicateLotScan;
window.downloadLotIssuesReport = downloadLotIssuesReport;
window.runLotAddressMismatchScan = runLotAddressMismatchScan;
window.downloadLotAddressMismatchReport = downloadLotAddressMismatchReport;

// Aug 6 2026 — one-time catch-up cleanup after fixing the retention
// mismatch between the automatic nightly backup (correctly used 5) and
// the manual "Backup & Export" button (used a hardcoded 20, and its own
// MAX_BACKUPS constant said 7 — a second, separate mismatch). Both now
// aligned to 5, but that only prevents future drift — this trims the
// already-existing backlog on both Firebase and R2 down to 5 right now.

window.cleanupOrphanedLots = cleanupOrphanedLots;
window.wDispRowAvail = wDispRowAvail;
window.wDispAddLotRow = wDispAddLotRow;
window.wDyeAddSourceRow = wDyeAddSourceRow;
window.wDyeCalcTotal = wDyeCalcTotal;
window.wPackLotChange = wPackLotChange;
window.wShowDyeEndRef = wShowDyeEndRef;
window.wShowEndRef = wShowEndRef;
window.wSubmitDisp = wSubmitDisp;
window.wSubmitDyeEnd = wSubmitDyeEnd;
window.wSubmitDyeStart = wSubmitDyeStart;
window.wSubmitEnd = wSubmitEnd;
window.wSubmitPack = wSubmitPack;
window.wSubmitStart = wSubmitStart;
window.wSubmitWindEnd = wSubmitWindEnd;
window.wSubmitWindStart = wSubmitWindStart;
window.wSwitchTab = wSwitchTab;
window.wTab = wTab;
window.wUpdateAvail = wUpdateAvail;
window.wWindLotChange = wWindLotChange;

// Round 3 (Jul 10 2026, found by Antigravity's review): these were also
// missed in the first two window-binding passes.
window.vtToggleVoided = vtToggleVoided;
window.renderDashPartyDispatch = renderDashPartyDispatch;
