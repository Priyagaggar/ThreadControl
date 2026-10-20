// rm.js — RM (Raw Material) page: Lots tab, Return tab, Add/Edit/Void modals.
// Aug 6 2026 — Phase 1, Step 15 of the module-split plan. Extracted byte-
// for-byte from pages.js. Real, complete inventory: 22 functions — the
// largest page extracted so far. renderRMEditLog (already in editlog.js),
// clearRMStockFilters (already in stock.js), and openRMLifecycle (already
// exported from stockregister.js) confirmed correctly NOT part of this
// file — genuinely separate, already-split concerns, not RM's own.

import { Qmax0, State, _getLotSummary, _sortState, agingBadge, apiPost, balCell, fmt, fmtDate, fmtTS, getRMBalance, getRMReturnedOut, getSoftBalance, getSoftBalanceWeight, getSoftConsumedByDye, getSoftResidualOut, qtyCell, _refreshAndRender, _tableFilters, _flagKeyRM, _isLotOnHold, WORKER_URL, _getHeaders } from './core.js';
import { buildColFilter, sortArr } from './shared.js';

import { getLotByKey, openModal, showToast, today, triggerSummaryUpdate, closeModal, setAlert, _verifyPasswordViaWorker, _openSimpleVoidPreview } from './core.js';
import { _restoreFilterBtns, fitBevTableHeight, sortTh, bevFilterBar, bevTable, bevRowClass, _flagTypeBadge } from './shared.js';
import { renderAll, populateSelects, flagPill } from './pages.js';
import { openVoidModal } from './editlog.js';
import { renderRMEditLog } from './editlog.js';
export function lotDomKey(l){return(l.id+'__'+l.grade+'__'+l.vendor).replace(/[^a-zA-Z0-9_\-]/g,'_');}

export function renderRMTable(){const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';const isSup=State.currentUser?.role==='supervisor'||isAdmin;_renderRMEditRequestsPanel();
// Jul 24 2026 fix — this used to write directly (State.DB.lots.forEach
// mutation + save('lots')) on every render that found a legacy record.
// Now a one-time-per-session, admin/manager-gated server call instead —
// guarded so it only ever fires once, not on every re-render.
if(isAdmin&&!State._deliveriesMigrationChecked&&(State.DB.lots||[]).some(l=>!l.deliveries)){
  State._deliveriesMigrationChecked=true;
  apiPost('/api/lots/migrate-deliveries',{role:State.currentUser?.role}).then(({ok,data})=>{
    if(ok&&data&&data.migrated>0){console.log('[RM] Migrated '+data.migrated+' legacy lot(s) to deliveries[] format');}
  }).catch(()=>{});
}
const vLot=document.getElementById('rmf-lot')?.value||'';const vVendor=document.getElementById('rmf-vendor')?.value||'';const vGrade=document.getElementById('rmf-grade')?.value||'';const vStatus=document.getElementById('rmf-status')?.value||'';const allLots=State.DB.lots||[];const lots_f=[...new Set(allLots.filter(l=>(!vVendor||l.vendor===vVendor)&&(!vGrade||l.grade===vGrade)).map(l=>l.id).filter(Boolean))].sort();const vendors_f=[...new Set(allLots.filter(l=>(!vLot||l.id===vLot)&&(!vGrade||l.grade===vGrade)).map(l=>l.vendor).filter(Boolean))].sort();const grades_f=[...new Set(allLots.filter(l=>(!vLot||l.id===vLot)&&(!vVendor||l.vendor===vVendor)).map(l=>l.grade).filter(Boolean))].sort();const _statuses_f=[...new Set(allLots.map(l=>l.status==='Voided'?'Voided':l.status==='Merged'?'Merged':l.status==='Edited-Approved'?'Edited-Approved':'Approved'))].sort();const filteredLots=allLots.filter(l=>(!vLot||l.id===vLot)&&(!vVendor||l.vendor===vVendor)&&(!vGrade||l.grade===vGrade)&&(!vStatus||(l.status==='Voided'?'Voided':l.status==='Merged'?'Merged':l.status==='Edited-Approved'?'Edited-Approved':'Approved')===vStatus));const _rmWithComputed=filteredLots.map(l=>{const _lotSumRM=_getLotSummary(l.id,l.grade,l.vendor);const _rmBal=_lotSumRM?.rmBalance?{units:_lotSumRM.rmBalance.units,weight:_lotSumRM.rmBalance.kg}:getRMBalance(l.id,l.grade,l.vendor);const _sfWt=_lotSumRM?.softBalance?.kg??getSoftBalanceWeight(l.id,l.grade,l.vendor);const _sentDye=_lotSumRM?.sentToDye?.kg??getSoftConsumedByDye(l.id,l.grade,l.vendor);const _lotDt=l.date?new Date(l.date):null;const _today2=new Date();const _dRM=_lotDt?Math.floor((_today2-_lotDt)/86400000):null;const _sfEntries2=(State.DB.stageEntries||[]).filter(e=>e.lotId===l.id&&e.status==='Approved'&&e.endTime);const _lastSf2=_sfEntries2.length?new Date(_sfEntries2[_sfEntries2.length-1].endTime):null;const _dSf=_lastSf2&&_sfWt>0?Math.floor((_today2-_lastSf2)/86400000):null;const _linked2=(State.DB.dyeLots||[]).filter(d=>d.status==='Approved'&&(d.sources||[]).some(s=>s.lotId===l.id&&s.grade===l.grade&&s.vendor===l.vendor));const _lotSt=_linked2.length>0&&_sfWt===0&&_rmBal.units===0?'Completed':_sentDye>0?'At Dye':_sfWt>0?'At Soft':'At RM';return{...l,_rmBalU:_rmBal.units,_sfWt,_sentDye,_dRM:_dRM||999,_dSf:_dSf||999,_lotSt};});const _rmSorted=sortArr(_rmWithComputed,_sortState.rm.col,_sortState.rm.dir);const rows=_rmSorted.map(l=>{const delivCount=(l.deliveries||[]).length;const delivBadge=delivCount>1?`<span title="Click to see ${delivCount} deliveries" style="cursor:pointer;background:rgba(240,165,0,0.15);color:var(--ac);border:1px solid rgba(240,165,0,0.3);border-radius:10px;padding:3px 10px;font-size:0.65rem;font-weight:700;display:inline-flex;align-items:center;gap:4px;" onclick="toggleDeliveries('${lotDomKey(l)}')">📦 ${delivCount} ▼</span>`:`<span style="color:var(--mu);font-size:0.72rem">1 delivery</span>`;const dk=lotDomKey(l);const _lotSumRM2=_getLotSummary(l.id,l.grade,l.vendor);const _rmBal=_lotSumRM2?.rmBalance?{units:_lotSumRM2.rmBalance.units,weight:_lotSumRM2.rmBalance.kg}:getRMBalance(l.id,l.grade,l.vendor);const _rmB=Qmax0(_rmBal);const _rmReturn=getRMReturnedOut(l.id,l.grade,l.vendor);const _residual=getSoftResidualOut(l.id,l.grade,l.vendor);const _sfWt=_lotSumRM2?.softBalance?.kg??getSoftBalanceWeight(l.id,l.grade,l.vendor);const _sfBal=_lotSumRM2?.softBalance?{units:_lotSumRM2.softBalance.units,weight:_lotSumRM2.softBalance.kg}:getSoftBalance(l.id,l.grade,l.vendor);const _sentDye=_lotSumRM2?.sentToDye?.kg??getSoftConsumedByDye(l.id,l.grade,l.vendor);const _today=new Date();const _lotDt=l.date?new Date(l.date):null;const _dRM=_lotDt?Math.floor((_today-_lotDt)/86400000):null;const _sfEntries=(State.DB.stageEntries||[]).filter(function(e){return e.lotId===l.id&&e.status==='Approved'&&e.endTime;});const _lastSf=_sfEntries.length?new Date(_sfEntries[_sfEntries.length-1].endTime):null;const _dSf=_lastSf&&_sfWt>0?Math.floor((_today-_lastSf)/86400000):null;const _linked=(State.DB.dyeLots||[]).filter(function(d){return d.status==='Approved'&&(d.sources||[]).some(function(s){return s.lotId===l.id&&s.grade===l.grade&&s.vendor===l.vendor;});});const _lotSt=l.status==='Voided'?'Voided':l.status==='Merged'?'Merged':_linked.length>0&&_sfWt===0&&_rmB.units===0?'Completed':_sentDye>0?'At Dye':_sfWt>0?'At Soft':'At RM';const _rawSt=l.status==='Voided'?'Voided':l.status==='Merged'?'Merged':l.status==='Edited-Approved'?'Edited-Approved':'Approved';const _rawStC={'Approved':'var(--gr)','Edited-Approved':'var(--ac)','Voided':'var(--re)','Merged':'var(--re)'}[_rawSt];const _stC={'At RM':'var(--mu)','At Soft':'var(--cs)','At Dye':'var(--cd)','Completed':'var(--gr)','Voided':'var(--re)','Merged':'var(--re)'}[_lotSt];const mainRow=`<tr id="rm-row-${dk}" class="${_stC==='var(--gr)'?'row-approved':_stC==='var(--re)'?'row-rejected':_stC==='var(--ye)'?'row-pending':''}"><td class="mono" style="cursor:pointer;color:var(--ac)" onclick="nav('lifecycle',document.getElementById('ni-lifecycle'));document.getElementById('lc-select').value='${l.id}';renderLifecycle()">
        ${l.id}<div style="font-size:0.6rem;color:var(--mu)">${fmtDate(l.date)}</div></td><td style="font-size:0.78rem">${l.vendor}</td><td><span class="badge b-rm">${l.grade}</span></td><td class="mono" style="font-size:0.75rem">${qtyCell(l.units,l.weight,'b')}
        ${delivCount>1?delivBadge:''}
      </td><td class="mono" style="color:${_rmReturn.weight>0?'var(--re)':'var(--mu)'}">${_rmReturn.weight>0?_rmReturn.units+'b / '+fmt(_rmReturn.weight)+'kg':'—'}</td>${balCell(_rmB.units,_rmB.weight,'b','var(--bl)')}<td class="mono" style="color:${_sfWt>0?'var(--tx)':'var(--mu)'}">${_sfBal?_sfBal.units+'b / '+fmt(_sfBal.weight)+'kg':fmt(_sfWt)+'kg'}</td><td class="mono" style="color:${_sentDye>0?'var(--ac)':'var(--mu)'}">${_sentDye>0?fmt(_sentDye)+'kg':'—'}</td><td class="mono" style="color:${_residual>0?'var(--ye)':'var(--mu)'}">${_residual>0?fmt(_residual)+'kg':'—'}</td><td>${agingBadge(_dRM)}</td><td>${_dSf!==null?agingBadge(_dSf):'<span style="color:var(--mu)">—</span>'}</td><td>${_lotSt==='Voided'?'<span class="badge b-void">Voided</span>':_lotSt==='Merged'?'<span class="badge b-void">Merged</span>':`<span style="font-size:0.72rem;font-weight:700;color:${_stC}">${_lotSt}</span>`}</td><td><span style="font-size:0.72rem;font-weight:700;color:${_rawStC}">${_rawSt}</span></td><td style="white-space:nowrap">
        ${delivCount===1?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Edit lot" onclick="openRMEdit('${l.id}','${l.grade}','${l.vendor}',0)">✏</button>${isSup?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Void delivery" style="color:var(--re)" onclick="voidRMDelivery('${l.id}','${l.grade}','${l.vendor}',0)">🗑</button>`:''}${isAdmin?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Recalculate summary" style="color:var(--ye)" onclick="recalcLotSummary('${l.id}','${l.grade}','${l.vendor}',this)">⟳</button>`:''}${isAdmin&&l.status==='Voided'?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Override" onclick="openOverride('${l.id}','rm','${l.grade}','${l.vendor}')">⚡</button>`:''}</td><td style="vertical-align:top">${flagPill(l.id,l.grade,l.vendor)}`:`<span style="font-size:0.65rem;color:var(--mu)">↓ per delivery</span>${isAdmin?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Recalculate summary" style="color:var(--ye)" onclick="recalcLotSummary('${l.id}','${l.grade}','${l.vendor}',this)">⟳</button>`:''}${isAdmin&&l.status==='Voided'?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Override" onclick="openOverride('${l.id}','rm','${l.grade}','${l.vendor}')">⚡</button>`:''}</td><td style="vertical-align:top">${flagPill(l.id,l.grade,l.vendor)}`}
      </td></tr>`;const delivRows=(l.deliveries||[]).map((d,i)=>`
      <tr style="background:rgba(240,165,0,0.04);font-size:0.72rem;"><td colspan="2" style="padding-left:28px;color:var(--mu)">↳ Delivery ${i+1}</td><td colspan="2" style="color:var(--mu)">${fmtDate(d.date)}</td><td class="mono" style="color:var(--gr)">${fmt(d.units)}b</td><td class="mono" style="color:var(--gr)">${fmt(d.weight)}kg</td><td colspan="2" style="color:var(--mu);font-size:0.68rem">${d.challan?'Challan: '+d.challan:'—'}</td><td style="color:var(--mu2);font-size:0.65rem">by ${d.addedBy||'Admin'} · ${fmtTS(d.addedAt)}</td><td style="white-space:nowrap"><button class="btn btn-ghost btn-xs tc-tip" data-tip="Edit delivery" onclick="openRMEdit('${l.id}','${l.grade}','${l.vendor}',${i})">✏</button>${isAdmin?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Void delivery" style="color:var(--re)" onclick="openVoidModal('${l.id}','rm-delivery','${l.grade}','${l.vendor}',${i})">🗑</button>`:''}</td></tr>`).join('');const addDelivBtn=`<tr id="rm-deliv-add-${dk}" style="display:none;background:rgba(240,165,0,0.04);"><td colspan="20" style="padding:6px 28px;"><button class="btn bg bsm" onclick="openAddDelivery('${l.id}','${l.grade}','${l.vendor}')" style="font-size:0.7rem;">+ Add Another Delivery</button></td></tr>`;const expandRow=`<tr id="rm-deliv-${dk}" style="display:none;"><td colspan="20" style="padding:0;"><table style="width:100%;border-collapse:collapse;">${delivRows}</table></td></tr>`;return mainRow+expandRow+addDelivBtn;}).join('');document.getElementById('rm-tbody').innerHTML=rows||'<tr><td colspan="20"><div class="empty"><div class="empty-icon">📦</div><div class="empty-text">✕ No RM lots match filters — try clearing</div></div></td></tr>';const rmThead=document.getElementById('rm-thead');if(rmThead){rmThead.innerHTML=`
      <tr class="tbl-filter-row"><th>${buildColFilter(lots_f,'rmf-lot','Lot')}</th><th>${buildColFilter(vendors_f,'rmf-vendor','Vendor')}</th><th>${buildColFilter(grades_f,'rmf-grade','Grade')}</th><th colspan="9"></th><th>${buildColFilter(_statuses_f,'rmf-status','Status')}</th><th></th></tr><tr>
        ${sortTh('rm','id','Lot No')}
        ${sortTh('rm','vendor','Vendor')}
        ${sortTh('rm','grade','Grade')}
        <th>Total In</th>
        <th>RM Return</th>
        ${sortTh('rm','_rmBalU','RM Balance')}
        ${sortTh('rm','_sfWt','Soft Balance')}
        ${sortTh('rm','_sentDye','Sent to Dye')}
        <th>Residual</th>
        ${sortTh('rm','_dRM','Days@RM')}
        ${sortTh('rm','_dSf','Days@Soft')}
        ${sortTh('rm','_lotSt','Stage')}
        <th>Status</th>
        <th>Actions</th><th>Flag</th></tr>`;if(vLot)document.getElementById('rmf-lot').value=vLot;if(vVendor)document.getElementById('rmf-vendor').value=vVendor;if(vGrade)document.getElementById('rmf-grade').value=vGrade;if(vStatus)document.getElementById('rmf-status').value=vStatus;_restoreFilterBtns('rmf-lot','rmf-vendor','rmf-grade','rmf-status');}renderRMFlagged();setTimeout(fitBevTableHeight,0);}

export function renderRMReturnLog(){
  const tbody=document.getElementById('rmr-tbody');if(!tbody)return;
  const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';
  const isSup=State.currentUser?.role==='supervisor'||isAdmin;
  // Aug 19 2026 — real, genuine consistency gap found via direct
  // discussion with Priyam: every other real table in this app has a
  // column-filter row, this one never did. Same real pattern as
  // renderRMTable's own filter row, reusing the same, shared
  // buildColFilter helper and _tableFilters storage.
  // Aug 26 2026 — real, live bug found via direct discussion with
  // Priyam: a real-time Firebase update can momentarily deliver
  // rmReturnLog as its raw, keyed-by-ID object shape instead of an
  // array, breaking .slice() with a real, visible crash. Same
  // defensive conversion pattern used throughout this app for exactly
  // this reason.
  const _rawLog = State.DB.rmReturnLog;
  const allLogs=(Array.isArray(_rawLog) ? _rawLog : (_rawLog ? Object.values(_rawLog) : [])).slice();
  const lots_f=[...new Set(allLogs.map(r=>r.lotId))].filter(Boolean).sort();
  const vendors_f=[...new Set(allLogs.map(r=>r.vendor))].filter(Boolean).sort();
  const grades_f=[...new Set(allLogs.map(r=>r.grade))].filter(Boolean).sort();
  const statuses_f=[...new Set(allLogs.map(r=>r.status))].filter(Boolean).sort();
  const rmrThead=document.getElementById('rmr-thead');
  if(rmrThead){
    rmrThead.innerHTML=`<tr class="tbl-filter-row"><th></th><th>${buildColFilter(lots_f,'rmrf-lot','Lot')}</th><th></th><th>${buildColFilter(grades_f,'rmrf-grade','Grade')}</th><th>${buildColFilter(vendors_f,'rmrf-vendor','Vendor')}</th><th colspan="3"></th><th>${buildColFilter(statuses_f,'rmrf-status','Status')}</th><th></th></tr><tr><th>Date</th><th>Lot</th><th>Permanent ID</th><th>Grade</th><th>Vendor</th><th>Bags/Weight</th><th>Reason</th><th>By</th><th>Status</th><th>Actions</th></tr>`;
    // Aug 26 2026 — real, genuine bug found via direct discussion with
    // Priyam, confirmed by a real, direct trace after his redeploy
    // still didn't show it: the earlier fix called _restoreFilterBtns,
    // but that only restores each button's *visibility*, never the
    // dropdown's own selected *value* — since rebuilding innerHTML
    // always resets every select back to "All". The main RM Lot table
    // explicitly writes the real, current value back onto each
    // dropdown before restoring buttons; this screen never did, so the
    // ✕ button's own check (does the dropdown have a value) always,
    // genuinely saw nothing selected.
    if(_tableFilters['rmrf-lot'])document.getElementById('rmrf-lot').value=_tableFilters['rmrf-lot'];
    if(_tableFilters['rmrf-grade'])document.getElementById('rmrf-grade').value=_tableFilters['rmrf-grade'];
    if(_tableFilters['rmrf-vendor'])document.getElementById('rmrf-vendor').value=_tableFilters['rmrf-vendor'];
    if(_tableFilters['rmrf-status'])document.getElementById('rmrf-status').value=_tableFilters['rmrf-status'];
    _restoreFilterBtns('rmrf-lot','rmrf-vendor','rmrf-grade','rmrf-status');
  }
  const fLot=_tableFilters['rmrf-lot']||'', fGrade=_tableFilters['rmrf-grade']||'', fVendor=_tableFilters['rmrf-vendor']||'', fStatus=_tableFilters['rmrf-status']||'';
  const logs=allLogs.filter(r=>(!fLot||r.lotId===fLot)&&(!fGrade||r.grade===fGrade)&&(!fVendor||r.vendor===fVendor)&&(!fStatus||r.status===fStatus)).sort((a,b)=>(b.timestamp||'').localeCompare(a.timestamp||''));
  if(!logs.length){tbody.innerHTML=`<tr><td colspan="10"><div class="empty"><div class="empty-icon">↩</div><div class="empty-text">${allLogs.length?'✕ No RM returns match filters — try clearing':'No RM returns yet'}</div></div></td></tr>`;return;}
  tbody.innerHTML=logs.map(r=>{
    // Jul 29 2026 — Phase 3, second display-only piece. Looks up the
    // real lot's permanent ID the same safe way the rest of the app
    // already does (getLotByKey) — purely additive, nothing about how
    // RM Return itself works or validates changes here.
    const _rmrLot=getLotByKey(r.lotId,r.grade,r.vendor);
    return `<tr${r.status==='Voided'?' style="opacity:0.5"':''}>
    <td style="font-size:0.72rem;color:var(--mu)">${r.timestamp?fmtTS(r.timestamp):(r.date||'—')}</td>
    <td class="mono" style="color:var(--ac);font-weight:700">${r.lotId||'—'}</td>
    <td class="mono" style="font-size:0.68rem;color:var(--mu)">${_rmrLot.uid||'—'}</td>
    <td><span class="badge b-rm">${r.grade||'—'}</span></td>
    <td style="font-size:0.72rem">${r.vendor||'—'}</td>
    <td class="mono">${fmt(r.units)}b / ${fmt(r.weight)}kg</td>
    <td style="font-size:0.72rem;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.reason||''}">${r.reason||'—'}</td>
    <td style="font-size:0.72rem;color:var(--mu)">${r.by||'—'}</td>
    <td>${r.status==='Voided'?'<span class="badge b-void">Voided</span>':r.status==='Edited-Approved'?'<span style="font-size:0.72rem;font-weight:700;color:var(--ac)">Edited-Approved</span>':'<span style="font-size:0.72rem;font-weight:700;color:var(--gr)">Approved</span>'}</td>
    <td style="white-space:nowrap">${r.status==='Voided'?'—':`${isSup?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Edit" onclick="openEditRMReturn('${r.id}')">✏</button><button class="btn btn-ghost btn-xs tc-tip" data-tip="Void" style="color:var(--re)" onclick="voidRMReturn('${r.id}','${r.lotId}',${fmt(r.weight)},${fmt(r.units)})">🗑</button>`:''}`}</td>
  </tr>`;}).join('');
}

export function showRMTab(tab,el){document.getElementById('rm-tab-lots').style.display=tab==='lots'?'':'none';const retPanel=document.getElementById('rm-tab-return');if(retPanel)retPanel.style.display=tab==='return'?'':'none';const flagPanel=document.getElementById('rm-tab-flagged');if(flagPanel)flagPanel.style.display=tab==='flagged'?'':'none';document.querySelectorAll('#page-rm .tab').forEach(t=>t.classList.remove('active'));if(el)el.classList.add('active');if(tab==='editlog')renderRMEditLog();if(tab==='return')renderRMReturnLog();if(tab==='flagged')renderRMFlagged();}

// Sep 8 2026 — real, direct feature built via direct discussion with
// Priyam, completing the same "Flagged" tab pattern already built for
// Soft/Dye/Wind/Pack/Dispatch, adapted here since RM Lots uses its
// own older, simpler tab switcher (showRMTab), not the stg-tabs/
// _bevRender machinery the other 5 pages share — deliberately not
// migrating Lots/RM Return onto that machinery, only adding this one
// new tab with its own live count, per Priyam's explicit scope.
// Sep 10 2026 — real, direct feature built via direct discussion with
// Priyam, from a genuine gap he caught himself by pushing back on a
// stale-looking warning: an auto-flagged imbalance only ever got
// re-checked when that exact same Soft entry was edited again — now
// also covered from the Dye side going forward, but any flag stuck
// stale before that fix existed needs its own one-time real check.
// Uses apiPost's GET-equivalent isn't available, so this calls the
// scan endpoint directly via fetch for the read, then apiPost for the
// actual clear — matching the same two-step, read-then-act pattern
// every other repair tool built today follows.
export async function runRecheckImbalanceFlags(){
  const el=document.getElementById('recheck-imbalance-status');if(!el)return;
  el.textContent='Checking...';
  try{
    const res=await fetch(WORKER_URL+'/api/admin/scan-imbalance-flags',{headers:_getHeaders()});
    const data=await res.json();
    if(!res.ok||!data.success){el.innerHTML='<span style="color:var(--re)">Could not run the check</span>';return;}
    if(data.checkedCount===0){el.innerHTML='<span style="color:var(--mu)">No auto-flagged warnings to check</span>';return;}
    if(data.staleCount===0){el.innerHTML=`<span style="color:var(--gr)">✓ Checked ${data.checkedCount} flag(s) — all still genuinely reflect a real imbalance, nothing to clear</span>`;return;}

    const staleList=data.results.filter(r=>!r.stillImbalanced);
    let confirmMsg=`Found ${staleList.length} flag(s) that no longer reflect a real imbalance:\n\n`;
    staleList.forEach(r=>{confirmMsg+=`${r.lotId} (${r.grade}, ${r.vendor}) — real balance now ${r.realBalanceNow.toFixed(2)}kg\n`;});
    confirmMsg+='\nClear these flags?';
    if(!confirm(confirmMsg)){el.innerHTML='<span style="color:var(--mu)">Cancelled — nothing changed</span>';return;}

    el.textContent='Clearing...';
    const {ok,data:clearData,error}=await apiPost('/api/admin/recheck-imbalance-flags',{});
    if(!ok){el.innerHTML='<span style="color:var(--re)">Could not clear — '+(error||'unknown error')+'</span>';return;}
    el.innerHTML=`<span style="color:var(--gr)">✓ Cleared ${clearData.clearedCount} stale flag(s)</span>`;
    showToast('Imbalance flags rechecked ✓');
    await _refreshAndRender(['lotFlags'],renderAll);
  }catch(e){el.innerHTML='<span style="color:var(--re)">Error: '+e.message+'</span>';}
}

export function renderRMFlagged(){const today=new Date();const flags=State.DB.lotFlags||{};const rows=(State.DB.lots||[]).map(l=>{const f=flags[_flagKeyRM(l.id,l.grade,l.vendor)];if(!f)return null;const flaggedAt=f.at?new Date(f.at):null;const days=flaggedAt?Math.floor((today-flaggedAt)/86400000):null;return{_cls:bevRowClass(days),_days:days??999,_lot:l.id,_grade:l.grade,_vendor:l.vendor,_sortVals:[l.id,l.grade,l.vendor,f.type,days??9999],_cells:['<span class="mono" style="color:var(--ac);font-weight:700;cursor:pointer;text-decoration:underline" onclick="openFlagModal(\''+l.id+'\',\''+l.grade+'\',\''+l.vendor+'\')" title="Edit or clear flag">'+l.id+'</span>',l.grade||'—',l.vendor||'—',_flagTypeBadge(f),f.note||'—',f.by||'—',days!==null?agingBadge(days):'—']};}).filter(Boolean).sort((a,b)=>b._days-a._days);const el=document.getElementById('bev-rm-flagged');if(el){el.innerHTML='';el.appendChild(bevFilterBar('rm-flagged',rows));el.insertAdjacentHTML('beforeend','<div id="bev-tbl-rm-flagged"></div>');const tbl=document.getElementById('bev-tbl-rm-flagged');if(tbl)tbl.innerHTML=bevTable(['Lot','Grade','Vendor','Type','Note','Flagged By','Days'],rows,'rm-flagged');setTimeout(fitBevTableHeight,0);}
const cnt=document.getElementById('rm-flagged-count');if(cnt){cnt.textContent=rows.length;cnt.className='stg-tab-count'+(rows.length?'':' zero');}}

export function openAddDelivery(lotId,grade,vendor){const lot=(grade&&vendor)?getLotByKey(lotId,grade,vendor):State.DB.lots.find(l=>l.id===lotId);if(!lot||!lot.id)return;populateSelects();document.getElementById('rm-modal-title').textContent='📦 Add Delivery to '+lotId;document.getElementById('m-rm-lot').value=lot.id;document.getElementById('m-rm-lot').readOnly=true;document.getElementById('m-rm-vendor').value=lot.vendor;document.getElementById('m-rm-grade').value=lot.grade;document.getElementById('m-rm-mill').value=lot.mill;document.getElementById('m-rm-units').value='';document.getElementById('m-rm-weight').value='';document.getElementById('m-rm-challan').value='';document.getElementById('m-rm-date').value=today();document.getElementById('rm-alert').innerHTML='';document.getElementById('rm-partial-panel').style.display='none';document.getElementById('rm-form-body').style.opacity='1';document.getElementById('rm-modal-foot').style.display='flex';openModal('rm-modal');}

export function openRMEdit(lotId,grade,vendor,delivIdx=0){const lot=(grade&&vendor)?getLotByKey(lotId,grade,vendor):State.DB.lots.find(l=>l.id===lotId);if(!lot||!lot.id){alert('Lot not found');return;}
const _d=(lot.deliveries||[])[delivIdx]||{units:lot.units,weight:lot.weight,date:lot.date,challan:lot.challan||''};
document.getElementById('rm-edit-original-id').value=lot.id+'||'+lot.grade+'||'+lot.vendor;
document.getElementById('rm-edit-deliv-idx').value=delivIdx;const V=State.DB.masters.vendors||[];const ML=State.DB.masters.mills||[];const G=State.DB.masters.grades||[];const mkOpts=(arr,val)=>`<option value="">Select...</option>`+arr.map(v=>`<option value="${v}"${v===val?' selected':''}>${v}</option>`).join('');document.getElementById('rm-edit-vendor').innerHTML=mkOpts(V,lot.vendor);document.getElementById('rm-edit-mill').innerHTML=mkOpts(ML,lot.mill||'');document.getElementById('rm-edit-grade').innerHTML=mkOpts(G,lot.grade);document.getElementById('rm-edit-lot').value=lot.id;document.getElementById('rm-edit-units').value=_d.units||lot.units;document.getElementById('rm-edit-weight').value=_d.weight||lot.weight;document.getElementById('rm-edit-date').value=_d.date||lot.date||'';document.getElementById('rm-edit-challan').value=_d.challan||lot.challan||'';document.getElementById('rm-edit-reason').value='';document.getElementById('rm-edit-pwd').value='';document.getElementById('rm-edit-alert').innerHTML='';if(document.getElementById('rm-edit-request-id'))document.getElementById('rm-edit-request-id').value='';openModal('rm-edit-modal');}

export function recalcLotSummary(lotId,grade,vendor,btn){
  if(btn){btn.disabled=true;btn.textContent='...';}
  const key=lotId+'__'+(grade||'').replace(/[^a-zA-Z0-9]/g,'_')+'__'+(vendor||'').replace(/[^a-zA-Z0-9]/g,'_');
  // Jul 24 2026 fix — this used to delete the cached summary directly via
  // State.fbDB.ref(...).remove() before triggering a fresh recompute. That
  // direct delete was unprotected AND unnecessary: the trigger calls below
  // already fully overwrite the summary (a real PUT, not a merge), so
  // there was never anything to gain by deleting it first — just an
  // unguarded write for no benefit. Removed; goes straight to the
  // (already server-side, already protected) recompute triggers.
  const dyeLots=(State.DB.dyeLots||[]).filter(d=>(d.sources||[]).some(s=>s.lotId===lotId&&s.grade===grade&&s.vendor===vendor));
  const triggers=[triggerSummaryUpdate('soft',{lotId,grade,vendor})];
  dyeLots.forEach(d=>{
    (d.sources||[]).forEach(src=>{
      if(!src.lotId)return;
      triggers.push(triggerSummaryUpdate('dye',{dyeLotId:d.id,lotId:src.lotId,grade:src.grade||'',vendor:src.vendor||''}));
    });
  });
  Promise.all(triggers).then(()=>{
    // Jul 13 2026 fix: the triggers above fire once PER dye lot, in
    // parallel — each one independently recomputes and overwrites the
    // WHOLE lot summary. Whichever finishes writing last wins, and
    // that's effectively random, causing the number to flicker to a
    // correct value then revert to a stale one. Fix: after all the
    // per-dye-lot repair triggers have settled, fire exactly ONE more
    // final recompute — this is the write that actually sticks.
    return triggerSummaryUpdate('lot',{lotId,grade,vendor});
  }).then(()=>{
    if(State.fbDB&&State.firebaseLoaded){
      State.fbDB.ref('/tc/lotSummaries/'+key).once('value',s=>{
        const val=s.val();
        if(val){State.DB.lotSummaries=State.DB.lotSummaries||{};State.DB.lotSummaries[key]=val;}
        if(btn){btn.disabled=false;btn.textContent='⟳';}
        showToast('Summary recalculated ✓');
        renderAll();
      });
    }else{
      if(btn){btn.disabled=false;btn.textContent='⟳';}
      showToast('Summary recalculated ✓');
      renderAll();
    }
  }).catch(()=>{if(btn){btn.disabled=false;btn.textContent='⟳';}showToast('Recalc failed','err');});
}

export function toggleDeliveries(domKey){const row=document.getElementById('rm-deliv-'+domKey);const addRow=document.getElementById('rm-deliv-add-'+domKey);if(!row)return;const isOpen=row.style.display!=='none';row.style.display=isOpen?'none':'';if(addRow)addRow.style.display=isOpen?'none':'';const mainRow=document.getElementById('rm-row-'+domKey);if(mainRow){const badge=mainRow.querySelector('span[onclick*="toggleDeliveries"]');if(badge){const lotId=domKey.split('__')[0];const lot=State.DB.lots.find(l=>lotDomKey(l)===domKey)||State.DB.lots.find(l=>l.id===lotId);const count=(lot?.deliveries||[]).length;badge.textContent=isOpen?count+' ▼':count+' ▲';}}}

// Aug 26 2026 — real, complete rebuild via direct discussion with
// Priyam, who asked for every real edit and void to look and feel
// consistent: this used raw confirm()+prompt()+prompt() popups, the
// only void flow in the app not matching the same modal style Void
// Entry Chain already uses everywhere else. Same visual pattern now —
// reason category, reason details, password — calling this stage's
// own, already-working, simpler backend endpoint underneath (no
// downstream chain to check for a single delivery, so the full
// void-chain system isn't the right fit here, just the same look).
export async function voidRMDelivery(lotId,grade,vendor,delivIdx){
  const lot=getLotByKey(lotId,grade,vendor)||State.DB.lots.find(l=>l.id===lotId&&l.grade===grade&&l.vendor===vendor);
  if(!lot){showToast('Lot not found','err');return;}
  const delivs=lot.deliveries||[];
  if(delivs.length<=1){
    // Only 1 delivery — void the whole lot
    // Aug 26 2026 — real, genuine, severe fix: grade/vendor are already
    // available right here, on this exact function's own parameters —
    // passing them through closes the real, confirmed near-miss where
    // this could otherwise build the void chain for a completely
    // different, unrelated lot sharing the same raw lot number.
    openVoidModal(lotId,'rm',grade,vendor);return;
  }
  document.getElementById('void-rm-delivery-lotid').value=lotId;
  document.getElementById('void-rm-delivery-grade').value=grade;
  document.getElementById('void-rm-delivery-vendor').value=vendor;
  document.getElementById('void-rm-delivery-idx').value=delivIdx;
  document.getElementById('void-rm-delivery-info').innerHTML=`Delivery ${delivIdx+1} — ${fmt(delivs[delivIdx]?.units||0)}b / ${fmt(delivs[delivIdx]?.weight||0)}kg from <strong style="color:var(--ac)">${lotId}</strong>`;
  document.getElementById('void-rm-delivery-alert').innerHTML='';
  document.getElementById('void-rm-delivery-reason-cat').value='';
  document.getElementById('void-rm-delivery-reason-text').value='';
  document.getElementById('void-rm-delivery-pwd').value='';
  openModal('void-rm-delivery-modal-overlay');
}

export async function submitVoidRMDeliveryV2(){
  const setAlert=msg=>{document.getElementById('void-rm-delivery-alert').innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;};
  const lotId=document.getElementById('void-rm-delivery-lotid').value;
  const grade=document.getElementById('void-rm-delivery-grade').value;
  const vendor=document.getElementById('void-rm-delivery-vendor').value;
  const delivIdx=parseInt(document.getElementById('void-rm-delivery-idx').value)||0;
  const reasonCat=document.getElementById('void-rm-delivery-reason-cat').value;
  const reasonText=document.getElementById('void-rm-delivery-reason-text').value.trim();
  const pwd=document.getElementById('void-rm-delivery-pwd').value;
  if(!reasonCat){setAlert('Select void reason category');return;}
  if(reasonText.length<10){setAlert('Reason must be at least 10 characters');return;}
  if(!pwd){setAlert('Enter your password to confirm');return;}
  closeModal('void-rm-delivery-modal-overlay');
  await _openSimpleVoidPreview({
    endpoint:'/api/rm/void-delivery',
    body:{lotId,grade,vendor,delivIdx,reason:`${reasonCat}: ${reasonText}`,password:pwd,username:State.currentUser?.username,changedBy:State.currentUser?.name},
    label:(data)=>`Voiding delivery ${delivIdx+1} — ${fmt(data.delivUnits)}b / ${fmt(data.delivWeight)}kg from <strong>${data.lotId}</strong>. ${data.remainingDeliveries} deliver${data.remainingDeliveries===1?'y':'ies'} will remain.`,
    refreshKeys:['lots'],
    successMsg:`Delivery ${delivIdx+1} voided ✓`,
  });
}

// Aug 19 2026 -- real, complete rebuild via direct discussion with
// Priyam: this used 3 separate raw browser prompt() popups -- the only
// edit flow in the whole app not using a real, styled modal. Now
// matches the same proper-form-then-preview pattern every other stage
// already has.
let _pendingRMReturnEditBody = null;

export function openEditRMReturn(id){
  const r=(State.DB.rmReturnLog||[]).find(x=>x.id===id);if(!r)return;
  document.getElementById('rm-return-edit-id').value=id;
  document.getElementById('rm-return-edit-units').value=r.units||'';
  document.getElementById('rm-return-edit-weight').value=r.weight||'';
  document.getElementById('rm-return-edit-reason-cat').value=r.reasonCat||'';
  document.getElementById('rm-return-edit-reason-text').value=r.reason||'';
  document.getElementById('rm-return-edit-alert').innerHTML='';
  openModal('rm-return-edit-modal');
}

export async function submitEditRMReturnV2(){
  const setAlert=msg=>{document.getElementById('rm-return-edit-alert').innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;};
  const id=document.getElementById('rm-return-edit-id').value;
  const units=parseFloat(document.getElementById('rm-return-edit-units').value)||0;
  const weight=parseFloat(document.getElementById('rm-return-edit-weight').value)||0;
  const reasonCat=document.getElementById('rm-return-edit-reason-cat').value;
  const reasonText=document.getElementById('rm-return-edit-reason-text').value.trim();
  if(!reasonCat){setAlert('Select reason category');return;}
  if(reasonText.length<10){setAlert('Reason must be at least 10 characters');return;}
  const body={id,units,weight,reasonCat,reason:reasonText,changedBy:State.currentUser?.name};
  _pendingRMReturnEditBody=body;

  const _btn=document.getElementById('rm-return-edit-submit-btn');if(_btn)_btn.disabled=true;
  try{
    const {ok,data,error,networkError}=await apiPost('/api/rm-return/preview',body);
    if(_btn)_btn.disabled=false;
    if(networkError||!ok){setAlert(error||'Preview failed \u2014 could not check impact before saving.');return;}
    _renderRMReturnPreview(data);
    closeModal('rm-return-edit-modal');
    // Sep 10 2026 — real, direct new requirement built via direct
    // discussion with Priyam, establishing one clear rule across the
    // whole app: for Edit, only Supervisor enters a password.
    const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';
    document.getElementById('rm-return-preview-pwd-row').style.display=isAdmin?'none':'';
    document.getElementById('rm-return-preview-pwd').value='';
    openModal('rm-return-preview-modal-overlay');
  }catch(e){if(_btn)_btn.disabled=false;setAlert('Network error \u2014 could not preview: '+e.message);}
}

function _renderRMReturnPreview(data){
  const box=document.getElementById('rm-return-preview-body');
  let html='';
  if(data.blockers&&data.blockers.length){
    html+=`<div class="alert-err" style="margin-bottom:10px"><b>This save would be blocked:</b><ul style="margin:6px 0 0 18px">${data.blockers.map(b=>`<li>${b}</li>`).join('')}</ul></div>`;
    const cbtn=document.getElementById('rm-return-preview-confirm-btn');if(cbtn)cbtn.disabled=true;
  }else{
    const cbtn=document.getElementById('rm-return-preview-confirm-btn');if(cbtn)cbtn.disabled=false;
  }
  html+=`<table style="width:100%;font-size:13px;margin-bottom:10px"><tr><td></td><td><b>Current</b></td><td><b>New</b></td></tr><tr><td>Bags</td><td>${data.current.units}</td><td>${data.proposed.units}</td></tr><tr><td>Weight</td><td>${fmt(data.current.weight)}kg</td><td>${fmt(data.proposed.weight)}kg</td></tr></table>`;
  html+=`<div style="background:var(--s2);border-radius:6px;padding:8px 10px;font-size:13px;display:flex;justify-content:space-between"><span>${data.newBalanceLabel||'New Balance'}</span><b${data.wouldGoNegative?' style="color:#c00"':''}>${data.newBalanceUnits!=null?Math.round(data.newBalanceUnits)+'b \u00b7 ':''}${fmt(data.newBalanceKg)}kg</b></div>`;
  box.innerHTML=html;
}

export async function _doEditRMReturnSave(){
  const body=_pendingRMReturnEditBody;if(!body)return;
  const setAlert=msg=>{document.getElementById('rm-return-edit-alert').innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;};
  const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';
  if(!isAdmin){
    const pwd=document.getElementById('rm-return-preview-pwd').value;
    if(!pwd){setAlert('Enter your password');openModal('rm-return-preview-modal-overlay');return;}
    body.password=pwd;
  }
  body.username=State.currentUser?.username;
  const _pbtn=document.getElementById('rm-return-preview-confirm-btn');if(_pbtn)_pbtn.disabled=true;
  try{
    const {ok,error,networkError}=await apiPost('/api/rm-return/edit',body);
    if(networkError)throw new Error(error);
    if(!ok){setAlert(error||'Could not edit return');if(_pbtn)_pbtn.disabled=false;closeModal('rm-return-preview-modal-overlay');openModal('rm-return-edit-modal');return;}
    closeModal('rm-return-preview-modal-overlay');
    showToast('RM Return updated \u2713');
    // Aug 26 2026 — real, confirmed bug found via direct discussion with
    // Priyam: renderAll() always redraws the "Lots" tab for the RM page,
    // never "Return" — so an edit saved correctly on the backend, but
    // the actual screen being looked at never refreshed. Same real fix
    // pattern already used correctly by submitRMReturn (the create
    // flow) — explicitly render both, regardless of which tab is active.
    await _refreshAndRender(['rmReturnLog'],[renderRMReturnLog,renderAll]);
    _pendingRMReturnEditBody=null;
  }catch(e){setAlert('Network error \u2014 not saved: '+e.message);if(_pbtn)_pbtn.disabled=false;}
}

// Aug 26 2026 — real, complete rebuild via direct discussion with
// Priyam, who asked for every real edit and void to look and feel
// consistent: this used raw confirm()+prompt()+prompt() popups too,
// same as delivery void above. Same visual pattern now, same
// already-working backend underneath.
export function voidRMReturn(id,lotId,weight,units){
  document.getElementById('void-rm-return-id').value=id;
  document.getElementById('void-rm-return-info').innerHTML=`${lotId} — ${fmt(units)}b / ${fmt(weight)}kg. This gives the material back to RM balance.`;
  document.getElementById('void-rm-return-alert').innerHTML='';
  document.getElementById('void-rm-return-reason-cat').value='';
  document.getElementById('void-rm-return-reason-text').value='';
  document.getElementById('void-rm-return-pwd').value='';
  openModal('void-rm-return-modal-overlay');
}

export async function submitVoidRMReturnV2(){
  const setAlert=msg=>{document.getElementById('void-rm-return-alert').innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;};
  const id=document.getElementById('void-rm-return-id').value;
  const reasonCat=document.getElementById('void-rm-return-reason-cat').value;
  const reasonText=document.getElementById('void-rm-return-reason-text').value.trim();
  const pwd=document.getElementById('void-rm-return-pwd').value;
  if(!reasonCat){setAlert('Select void reason category');return;}
  if(reasonText.length<10){setAlert('Reason must be at least 10 characters');return;}
  if(!pwd){setAlert('Enter your password to confirm');return;}
  closeModal('void-rm-return-modal-overlay');
  await _openSimpleVoidPreview({
    endpoint:'/api/rm-return/void',
    body:{id,reason:`${reasonCat}: ${reasonText}`,password:pwd,username:State.currentUser?.username,changedBy:State.currentUser?.name},
    label:(data)=>`Voiding RM Return <strong>${id}</strong> — ${data.lotId}, ${fmt(data.entryUnits)}b / ${fmt(data.entryWeight)}kg. This gives the material back to RM balance.`,
    refreshKeys:['rmReturnLog','lots'],
    successMsg:'RM Return voided ✓ — material returned to balance',
    extraRenderFn:renderRMReturnLog,
  });
}

export function openRMReturnModal(){
  if(State.currentUser?.role!=='admin'&&State.currentUser?.role!=='manager'&&State.currentUser?.role!=='supervisor'){showToast('No permission','err');return;}
  const lotsWithBal=State.DB.lots.filter(l=>l.status!=='Voided'&&l.status!=='Merged'&&!_isLotOnHold(l.id,l.grade,l.vendor)&&getRMBalance(l.id,l.grade,l.vendor).weight>0.01);
  const vendors=[...new Set(lotsWithBal.map(l=>l.vendor))].sort();
  const vSel=document.getElementById('rmr-vendor');
  if(!vSel)return;
  vSel.innerHTML='<option value="">Select vendor...</option>'+vendors.map(v=>`<option value="${v}">${v}</option>`).join('');
  const gSel=document.getElementById('rmr-grade');gSel.innerHTML='<option value="">Select grade...</option>';gSel.disabled=true;
  const lSel=document.getElementById('rmr-lot');lSel.innerHTML='<option value="">Select lot...</option>';lSel.disabled=true;
  document.getElementById('rmr-info').innerHTML='';
  document.getElementById('rmr-units').value='';document.getElementById('rmr-units').max='';
  document.getElementById('rmr-weight').value='';document.getElementById('rmr-weight').max='';
  document.getElementById('rmr-reason').value='';
  document.getElementById('rmr-alert').innerHTML='';
  openModal('rm-return-modal-overlay');
}

export async function submitRMReturn(){
  const setAlert=msg=>{document.getElementById('rmr-alert').innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;};
  const vendor=document.getElementById('rmr-vendor').value;
  const grade=document.getElementById('rmr-grade').value;
  const lotId=document.getElementById('rmr-lot').value;
  const units=parseFloat(document.getElementById('rmr-units').value)||0;
  const weight=parseFloat(document.getElementById('rmr-weight').value)||0;
  const reason=document.getElementById('rmr-reason').value;
  if(!lotId){setAlert('Select vendor, grade and lot');return;}
  if(weight<=0&&units<=0){setAlert('Enter weight or bags to return');return;}
  if(!reason){setAlert('Select reason');return;}
  try{
    const {ok,data,error,networkError}=await apiPost('/api/rm-return',{lotId,grade,vendor,units,weight,reason,changedBy:State.currentUser.name});
  if(networkError)throw new Error(error);
  if(!ok){setAlert(error||'Could not process return');return;}
    closeModal('rm-return-modal-overlay');
    showToast(`Returned ${fmt(units)}b / ${fmt(weight)}kg to ${vendor} ✓`);
    await _refreshAndRender(['rmReturnLog','lots'],[renderRMReturnLog,renderAll]);
  }catch(e){setAlert('Network error — not saved: '+e.message);}
}

export async function submitEditRMReturn(id,units,weight,reason){
  try{
    const {ok,error,networkError}=await apiPost('/api/rm-return/edit',{id,units,weight,reason,changedBy:State.currentUser?.name});
    if(networkError)throw new Error(error);
    if(!ok){showToast(error||'Could not edit return','err');return;}
    showToast('RM Return updated ✓');await _refreshAndRender(['rmReturnLog'],[renderRMReturnLog,renderAll]);
  }catch(e){showToast('Network error — not saved: '+e.message,'err');}
}

export function openRMModal(){populateSelects();document.getElementById('rm-modal-title').textContent='📦 New Raw Material Lot';document.getElementById('m-rm-lot').readOnly=false;document.getElementById('m-rm-lot').value='';document.getElementById('m-rm-units').value='';document.getElementById('m-rm-weight').value='';document.getElementById('m-rm-challan').value='';document.getElementById('m-rm-date').value=today();document.getElementById('rm-alert').innerHTML='';document.getElementById('rm-partial-panel').style.display='none';document.getElementById('rm-form-body').style.opacity='1';document.getElementById('rm-modal-foot').style.display='flex';document.getElementById('rm-modal').classList.add('open');}

export function checkRMLotDuplicate(){const lot=document.getElementById('m-rm-lot').value.trim();const vendor=document.getElementById('m-rm-vendor').value;const grade=document.getElementById('m-rm-grade').value;if(!lot||!vendor||!grade)return;const existing=State.DB.lots.find(l=>l.id===lot&&l.vendor===vendor&&l.grade===grade);if(existing){setAlert('rm-alert',`ℹ ${lot} (${vendor} / ${grade}) already exists with ${fmt(existing.units)}b. Submitting will add a new delivery to this lot.`,'alert-warn');}else{document.getElementById('rm-alert').innerHTML='';}}

export async function submitRM(){const lot=document.getElementById('m-rm-lot').value.trim();const vendor=document.getElementById('m-rm-vendor').value;const mill=document.getElementById('m-rm-mill').value;const grade=document.getElementById('m-rm-grade').value;const units=parseFloat(document.getElementById('m-rm-units').value)||0;const weight=parseFloat(document.getElementById('m-rm-weight').value)||0;const date=document.getElementById('m-rm-date').value||today();const challan=document.getElementById('m-rm-challan').value.trim();if(!lot||!vendor||!mill||!grade||!units){setAlert('rm-alert','Fill all required fields','alert-err');return;}
if(!weight||weight<=0){setAlert('rm-alert','Weight (kg) is required','alert-err');return;}
const existing=State.DB.lots.find(l=>l.id===lot&&l.vendor===vendor&&l.grade===grade);if(existing){State._pendingDelivery={lot,vendor,mill,grade,units,weight,date,challan};const newTotal=existing.units+units;const newWeight=existing.weight+weight;const deliveryCount=(existing.deliveries||[]).length+1;document.getElementById('rm-partial-info').innerHTML=`<strong style="color:var(--ac)">${lot}</strong> — ${vendor} / ${grade}<br>
      Current total: <strong>${fmt(existing.units)}b / ${fmt(existing.weight)}kg</strong> (${(existing.deliveries||[]).length||1} delivery so far)<br>
      Adding: <strong style="color:var(--gr)">${fmt(units)}u / ${fmt(weight)}kg</strong>${challan?' — Challan: '+challan:''}<br>
      New total will be: <strong style="color:var(--gr)">${fmt(newTotal)}u / ${fmt(newWeight)}kg</strong> (${deliveryCount} deliveries)`;document.getElementById('rm-partial-panel').style.display='block';document.getElementById('rm-form-body').style.opacity='0.4';document.getElementById('rm-modal-foot').style.display='none';document.getElementById('rm-alert').innerHTML='';return;}
// Jul 24 2026 fix — this used to push directly into State.DB.lots and
// save() with no lock, no server check. Now a single locked, atomic
// server call, matching the pattern used everywhere else this session.
try{
  const {ok,data,error,networkError}=await apiPost('/api/rm/create',{lotId:lot,vendor,mill,grade,units,weight,date,challan,changedBy:State.currentUser?.name});
  if(networkError)throw new Error(error);
  if(!ok){
    // Jul 26 2026 — content-based duplicate warning (confirmed design:
    // same vendor/grade/units/weight, exact match, 15-day window). Never
    // blocks — just asks for one explicit confirmation before proceeding.
    if(data&&data.duplicateWarning){
      if(confirm(data.message+'\n\nClick OK to save this as a new, separate lot anyway. Click Cancel to go back and check.')){
        try{
          const r2=await apiPost('/api/rm/create',{lotId:lot,vendor,mill,grade,units,weight,date,challan,changedBy:State.currentUser?.name,confirmDuplicate:true});
          if(r2.networkError)throw new Error(r2.error);
          if(!r2.ok){setAlert('rm-alert',r2.error||'Could not add lot','alert-err');return;}
          closeModal('rm-modal');await _refreshAndRender(['lots'],renderAll);showToast('Lot '+lot+' added ✓');
        }catch(e){setAlert('rm-alert','Network error — '+e.message,'alert-err');}
      }
      return;
    }
    setAlert('rm-alert',error||'Could not add lot','alert-err');return;
  }
  closeModal('rm-modal');await _refreshAndRender(['lots'],renderAll);showToast('Lot '+lot+' added ✓');
}catch(e){setAlert('rm-alert','Network error — '+e.message,'alert-err');}
}

export async function submitRMEdit(){
  // Jul 14 2026 — Item A cutover. This used to run the entire edit cascade
  // client-side (conflict check, Soft-consumption validation, cascade rename
  // across 4 tables with loose matching). All of that now lives in worker.js
  // (POST /api/rm/edit), strict-matched and committed atomically. This
  // function is now just: read the form, do a quick client-side pre-flight
  // (required fields, password), call the server, show the result.
  const _origKey=document.getElementById('rm-edit-original-id').value;const _origParts=_origKey.split('||');const originalId=_origParts[0];const originalGrade=_origParts[1]||'';const originalVendor=_origParts[2]||'';
  const newLotId=document.getElementById('rm-edit-lot').value.trim();const vendor=document.getElementById('rm-edit-vendor').value;const mill=document.getElementById('rm-edit-mill').value;const grade=document.getElementById('rm-edit-grade').value;const units=parseFloat(document.getElementById('rm-edit-units').value)||0;const weight=parseFloat(document.getElementById('rm-edit-weight').value)||0;const date=document.getElementById('rm-edit-date').value;const challan=document.getElementById('rm-edit-challan').value.trim();const reason=document.getElementById('rm-edit-reason').value.trim();const pwd=document.getElementById('rm-edit-pwd').value;
  if(!reason){setAlert('rm-edit-alert','Reason for edit is required','alert-err');return;}
  const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';
  // Sep 10 2026 — real, direct new requirement built via direct
  // discussion with Priyam, establishing one clear rule across the
  // whole app: for Edit, only Supervisor enters a password —
  // Admin/Manager are exempt, matching every other Edit function.
  if(!isAdmin){
    if(!pwd){setAlert('rm-edit-alert','Password is required','alert-err');return;}
    const matched=await _verifyPasswordViaWorker(pwd,State.currentUser?.username);
    if(!matched){setAlert('rm-edit-alert','Incorrect password','alert-err');document.getElementById('rm-edit-pwd').value='';return;}
  }
  if(!newLotId||!vendor||!mill||!grade||!units){setAlert('rm-edit-alert','Fill all required fields','alert-err');return;}
 if(weight<=0){setAlert('rm-edit-alert','Weight (kg) is required','alert-err');return;}
  const _delivIdx=parseInt(document.getElementById('rm-edit-deliv-idx').value)||0;
  const _editRequestId=document.getElementById('rm-edit-request-id')?.value||undefined;
  const _btn=document.getElementById('rm-edit-submit-btn');if(_btn)_btn.disabled=true;
  try{
    const {ok,data,error,networkError}=await apiPost('/api/rm/edit',{originalId,originalGrade,originalVendor,newLotId,vendor,mill,grade,units,weight,date,challan,reason,delivIdx:_delivIdx,changedBy:State.currentUser.name,password:pwd,username:State.currentUser?.username,editRequestId:_editRequestId});
  if(networkError)throw new Error(error);
  if(!ok){setAlert('rm-edit-alert',error||'Edit failed','alert-err');if(_btn)_btn.disabled=false;return;}
    closeModal('rm-edit-modal');
    // Sep 10 2026 — real, direct upgrade built via direct discussion
    // with Priyam: this used to hard-block Supervisor whenever Soft
    // had already consumed from the lot — now routes to a real,
    // pending request for Admin to review instead, shown here as its
    // own, real, correctly different message.
    if(data.requested){
      showToast('Sent to Admin for review — nothing changed yet','ok');
      await _refreshAndRender(['rmEditRequests'],renderAll);
      return;
    }
    showToast(data.type==='split'?'Delivery split to '+newLotId+' \u2713':'Lot updated \u2713');await _refreshAndRender(['lots','dyeLots','rmEditRequests'],renderAll);
  }catch(e){setAlert('rm-edit-alert','Network error \u2014 edit not saved: '+e.message,'alert-err');if(_btn)_btn.disabled=false;}
}

// Sep 10 2026 — real, direct new feature: mirrors editlog.js's own,
// already-proven Void Request panel exactly — a Supervisor's RM Edit
// that hit real downstream activity now shows up here for Admin to
// review, rather than just being hard-blocked with no path forward.
function _renderRMEditRequestsPanel(){
  const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';
  const reqPanel=document.getElementById('rm-edit-requests-panel');
  const reqList=document.getElementById('rm-edit-requests-list');
  const reqBadge=document.getElementById('rm-edit-req-badge');
  if(!reqPanel)return;
  const pending=(State.DB.rmEditRequests||[]).filter(r=>r.status==='pending');
  if(isAdmin&&pending.length>0){
    reqPanel.style.display='block';
    if(reqBadge){reqBadge.textContent=pending.length+' pending';reqBadge.style.display='';}
    reqList.innerHTML=pending.map(r=>`
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(239,68,68,0.15);"><div><div style="font-size:.82rem;font-weight:700;color:var(--re)">RM Lot — ${r.originalId}</div><div style="font-size:.65rem;color:var(--mu)">Requested by ${r.requestedBy} · ${fmtTS(r.requestedAt)}</div>
          ${r.reason?`<div style="font-size:.65rem;color:var(--mu);font-style:italic">"${r.reason}"</div>`:''}
        </div><div style="display:flex;gap:6px;flex-shrink:0;margin-left:12px;"><button class="btn bs bxs" onclick="openRMEditReview('${r.id}')">🔍 Review</button><button class="btn bg bxs" onclick="rejectRMEditRequest('${r.id}')">✕ Reject</button></div></div>`).join('');
  }else{
    reqPanel.style.display='none';
    if(reqBadge)reqBadge.style.display='none';
  }
}

export async function rejectRMEditRequest(id){
  if(!confirm('Reject this edit request? Nothing will change — the original lot stays exactly as it is.'))return;
  const {ok,error,networkError}=await apiPost('/api/rm-edit-request/reject',{id,changedBy:State.currentUser?.name});
  if(networkError){showToast('Network error — '+error,'err');return;}
  if(!ok){showToast(error||'Could not reject','err');return;}
  showToast('Edit request rejected');
  await _refreshAndRender(['rmEditRequests'],renderAll);
}

export function openRMEditReview(reqId){
  const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';if(!isAdmin){showToast('Admin/Manager only','err');return;}
  const req=(State.DB.rmEditRequests||[]).find(r=>r.id===reqId);if(!req){showToast('Request not found','err');return;}
  openRMEdit(req.originalId,req.originalGrade,req.originalVendor,0);
  // Sep 10 2026 — pre-fill with the real, actual proposed values from
  // the request, so Admin reviews exactly what was asked for, then
  // stash the request id so the eventual save closes it out too.
  document.getElementById('rm-edit-lot').value=req.newLotId;
  document.getElementById('rm-edit-vendor').value=req.vendor;
  document.getElementById('rm-edit-mill').value=req.mill;
  document.getElementById('rm-edit-grade').value=req.grade;
  document.getElementById('rm-edit-units').value=req.units;
  document.getElementById('rm-edit-weight').value=req.weight;
  document.getElementById('rm-edit-date').value=req.date||'';
  document.getElementById('rm-edit-challan').value=req.challan||'';
  document.getElementById('rm-edit-reason').value=req.reason||'';
  const _reqField=document.getElementById('rm-edit-request-id');
  if(_reqField)_reqField.value=reqId;
}

export function onRMRGradeChange(){
  const vendor=document.getElementById('rmr-vendor').value;
  const grade=document.getElementById('rmr-grade').value;
  const lSel=document.getElementById('rmr-lot');
  lSel.innerHTML='<option value="">Select lot...</option>';
  document.getElementById('rmr-info').innerHTML='';
  if(!vendor||!grade){lSel.disabled=true;return;}
  const lots=State.DB.lots.filter(l=>l.status!=='Voided'&&l.status!=='Merged'&&!_isLotOnHold(l.id,l.grade,l.vendor)&&l.vendor===vendor&&l.grade===grade&&getRMBalance(l.id,l.grade,l.vendor).weight>0.01).sort((a,b)=>(a.id||'').localeCompare(b.id||''));
  if(!lots.length){lSel.innerHTML='<option value="">No lots available</option>';lSel.disabled=true;return;}
  lSel.innerHTML='<option value="">Select lot...</option>'+lots.map(l=>{const bal=getRMBalance(l.id,l.grade,l.vendor);return`<option value="${l.id}">${l.id} (${fmt(bal.units)}b / ${fmt(bal.weight)}kg avail)</option>`;}).join('');
  lSel.disabled=false;
}

export function onRMRLotChange(){
  const vendor=document.getElementById('rmr-vendor').value;
  const grade=document.getElementById('rmr-grade').value;
  const lotId=document.getElementById('rmr-lot').value;
  const infoEl=document.getElementById('rmr-info');
  const uEl=document.getElementById('rmr-units');const wEl=document.getElementById('rmr-weight');
  if(!lotId){infoEl.innerHTML='';uEl.max='';wEl.max='';return;}
  const bal=getRMBalance(lotId,grade,vendor);
  infoEl.innerHTML=`Available to return: <strong style="color:var(--ye)">${fmt(bal.units)}b / ${fmt(bal.weight)}kg</strong>`;
  uEl.max=bal.units;wEl.max=bal.weight;
}

export function onRMRVendorChange(){
  const vendor=document.getElementById('rmr-vendor').value;
  const gSel=document.getElementById('rmr-grade');const lSel=document.getElementById('rmr-lot');
  gSel.innerHTML='<option value="">Select grade...</option>';lSel.innerHTML='<option value="">Select lot...</option>';lSel.disabled=true;
  document.getElementById('rmr-info').innerHTML='';
  if(!vendor){gSel.disabled=true;return;}
  const grades=[...new Set(State.DB.lots.filter(l=>l.status!=='Voided'&&l.status!=='Merged'&&!_isLotOnHold(l.id,l.grade,l.vendor)&&l.vendor===vendor&&getRMBalance(l.id,l.grade,l.vendor).weight>0.01).map(l=>l.grade))].sort();
  if(!grades.length){gSel.innerHTML='<option value="">No grades available</option>';gSel.disabled=true;return;}
  gSel.innerHTML='<option value="">Select grade...</option>'+grades.map(g=>`<option value="${g}">${g}</option>`).join('');
  gSel.disabled=false;
}

export function openVoidRMLotCascade(lotId,grade,vendor){if(!State.currentUser||(State.currentUser.role!=='admin'&&State.currentUser.role!=='manager')){showToast('Admin/Manager only','err');return;}
const lot=getLotByKey(lotId,grade,vendor);if(!lot||!lot.id){showToast('Lot not found','err');return;}
// Sep 10 2026 — real, direct new feature built via a genuinely long,
// careful design discussion with Priyam, establishing one clear rule
// across the whole app: every real action shows a genuine preview of
// its actual effect before committing — this replaces the old,
// locally-computed confirm() dialog (built from whatever's already
// loaded in the browser) with a real, server-computed preview — the
// exact same cascade logic the actual void already uses, just
// returned here instead of executed. The very last of the dozen-plus
// places found via Priyam's own requested holistic uniformity audit.
const reason=prompt('Enter void reason (min 10 chars):');if(!reason||reason.trim().length<10){showToast('Reason too short','err');return;}
const pwd=prompt('Enter your password to confirm:');if(!pwd){showToast('Cancelled — password required','err');return;}
_previewVoidRMLotCascade(lotId,grade,vendor,reason.trim(),pwd);}

async function _previewVoidRMLotCascade(lotId,grade,vendor,reason,pwd){
  try{
    const {ok,data,error,networkError}=await apiPost('/api/void-rm-lot',{lotId,grade,vendor,reason,password:pwd,username:State.currentUser?.username,dryRun:true});
    if(networkError){showToast('Network error: '+error,'err');return;}
    if(!ok||data.error){showToast(data.error||error||'Could not preview','err');return;}
    _pendingRMCascadeVoid={lotId,grade,vendor,reason,pwd};
    const labels={soft:'Soft entries',dye:'Dye lots',wind:'Wind entries',pack:'Pack entries',dispatch:'Dispatches'};
    const rows=Object.entries(data.cascadeCounts||{}).filter(([,n])=>n>0).map(([k,n])=>`<div>${n} ${labels[k]||k}</div>`).join('');
    document.getElementById('rm-cascade-preview-body').innerHTML=`
      <div style="font-size:.8rem;margin-bottom:10px;">Voiding RM Lot <strong>${lotId}</strong> — ${grade}, ${vendor}${rows?' will also void:':' — nothing else depends on this yet.'}</div>
      ${rows?`<div style="background:var(--s2);border-radius:8px;padding:8px 10px;font-size:.75rem;margin-bottom:10px;">${rows}</div>`:''}
      <div style="font-size:.72rem;color:var(--re);font-weight:700">⚠ This cannot be undone.</div>
    `;
    document.getElementById('rm-cascade-preview-alert').innerHTML='';
    openModal('rm-cascade-preview-modal-overlay');
  }catch(e){showToast('Network error: '+e.message,'err');}
}

let _pendingRMCascadeVoid=null;

export async function _doRMCascadeConfirm(){
  const setAlert=msg=>{document.getElementById('rm-cascade-preview-alert').innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;};
  const pending=_pendingRMCascadeVoid;
  if(!pending)return;
  const _btn=document.getElementById('rm-cascade-preview-confirm-btn');
  if(_btn)_btn.disabled=true;
  try{
    const {ok,data,error,networkError}=await apiPost('/api/void-rm-lot',{lotId:pending.lotId,grade:pending.grade,vendor:pending.vendor,reason:pending.reason,password:pending.pwd,username:State.currentUser?.username,changedBy:State.currentUser.name});
    if(networkError)throw new Error(error);
    if(!ok){setAlert(error||'Cascade void failed');if(_btn)_btn.disabled=false;return;}
    closeModal('rm-cascade-preview-modal-overlay');
    showToast(`Cascade void complete ✓${data.voidCount?' ('+data.voidCount+' records)':''}`,'ok');
    _pendingRMCascadeVoid=null;
    await _refreshAndRender(['lots','stageEntries','dyeLots','rmReturnLog','residualLog'],renderAll);
  }catch(e){setAlert('Network error — cascade void not saved: '+e.message);if(_btn)_btn.disabled=false;}
}

window.showRMTab = showRMTab;
window.openAddDelivery = openAddDelivery;
window.openRMEdit = openRMEdit;
window.recalcLotSummary = recalcLotSummary;
window.toggleDeliveries = toggleDeliveries;
window.voidRMDelivery = voidRMDelivery;
window.openEditRMReturn = openEditRMReturn;window.voidRMReturn = voidRMReturn;
window.submitVoidRMReturnV2 = submitVoidRMReturnV2;
window.submitVoidRMDeliveryV2 = submitVoidRMDeliveryV2;
window.openRMReturnModal = openRMReturnModal;
window.submitRMReturn = submitRMReturn;
window.submitEditRMReturn = submitEditRMReturn;
window.submitEditRMReturnV2 = submitEditRMReturnV2;
window._doEditRMReturnSave = _doEditRMReturnSave;
window.openRMModal = openRMModal;
window.checkRMLotDuplicate = checkRMLotDuplicate;
window.submitRM = submitRM;
window.submitRMEdit = submitRMEdit;
window.rejectRMEditRequest = rejectRMEditRequest;
window.openRMEditReview = openRMEditReview;
window.onRMRGradeChange = onRMRGradeChange;
window.onRMRLotChange = onRMRLotChange;
window.onRMRVendorChange = onRMRVendorChange;
window.openVoidRMLotCascade = openVoidRMLotCascade;
window._doRMCascadeConfirm = _doRMCascadeConfirm;
window.runRecheckImbalanceFlags = runRecheckImbalanceFlags;
