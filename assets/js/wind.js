// wind.js — Wind page: entry table, Start/End modal, filters.
// Aug 6 2026 — Phase 1, Step 18 of the module-split plan. Extracted byte-
// for-byte from pages.js. Real inventory: 8 functions. renderApprovalWind
// correctly excluded (Approval page's own concern). Same "Worker View"
// boundary confirmed a third time: wSubmitWindEnd, wSubmitWindStart,
// wWindLotChange, workerWindForm correctly excluded — verified precisely
// by reading workerWindForm's own onclick/onchange triggers, not assumed
// from the "w" prefix alone.

import { State, _sortState, agingBadge, fmt, getDyeLotCurrentStage, mwCell, pct, qtyCell, wasteCell, wastePctCell, fmtHrs, fmtTS, hrsBetween, apiPost, _tableFilters, closeModal, getDyeBalAvailable, openModal, showToast, _refreshAndRender, eligibleWindLots, machinesForStage, workersSorted } from './core.js';
import { _captureFilterFocus, _restoreFilterBtns, _restoreFilterFocus, buildColFilter, buildDyeLotSearch, entryRowClass, sortArr, sortTh, statusBadge, fitBevTableHeight, makeDyeLotSearch, renderBevWindReady, renderBevWindPending, renderBevWindFlagged } from './shared.js';
import { _postWithDuplicateCheck, renderAll, entryFlagPill } from './pages.js';
import { _updateClearBtn } from './shared.js';

// Aug 26 2026 — real bug found and fixed via a complete, systematic
// sweep for this exact same pattern, after finding the first, live
// instance directly in Priyam's own console log: declared in pages.js
// on a shared, multi-variable line, but never actually used there —
// only ever assigned and read here. Same fix as _pendingEditBody.
let _windLotSearch=null;

export function renderWindTable(){const _focusCap=_captureFilterFocus('windf-');const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';const isSup=State.currentUser?.role==='supervisor'||isAdmin;const _fLot=document.getElementById('windf-lot')?.value||'';const _fGrade=document.getElementById('windf-grade')?.value||'';const _fShade=document.getElementById('windf-shade')?.value||'';const _fStatus=document.getElementById('windf-status')?.value||'';const allWind=State.DB.windEntries||[];const lots=[...new Set(allWind.filter(e=>(!_fShade||e.shade===_fShade)&&(!_fStatus||e.status===_fStatus)).map(e=>e.dyeLotNo).filter(Boolean))].sort((a,b)=>b.localeCompare(a));const grades_w=[...new Set(allWind.filter(e=>(!_fLot||(e.dyeLotNo||'').includes(_fLot))&&(!_fStatus||e.status===_fStatus)).map(e=>e.grade).filter(Boolean))].sort();const shades_w=[...new Set(allWind.filter(e=>(!_fLot||(e.dyeLotNo||'').includes(_fLot))&&(!_fStatus||e.status===_fStatus)).map(e=>e.shade).filter(Boolean))].sort();const statuses=[...new Set(allWind.filter(e=>(!_fLot||(e.dyeLotNo||'').includes(_fLot))&&(!_fShade||e.shade===_fShade)).map(e=>e.status).filter(Boolean))].sort();const _wTh=document.getElementById('wind-thead');if(_wTh){_wTh.innerHTML=`
      <tr class="tbl-filter-row"><th>${buildDyeLotSearch('windf-lot','windf-lot-xbtn','windf')}</th><th>${buildColFilter(grades_w,'windf-grade','Grade')}</th><th>${buildColFilter(shades_w,'windf-shade','Shade')}</th><th></th><th></th><th></th><th></th><th></th><th></th><th></th><th></th><th></th><th>${buildColFilter(statuses,'windf-status','Status')}</th><th></th></tr><tr>
        ${sortTh('wind','dyeLotNo','Dye Lot')}
        ${sortTh('wind','grade','Grade')}
        ${sortTh('wind','shade','Shade')}
        <th>In (c/kg)</th><th>Out (c/kg)</th><th>Waste (c/kg)</th><th>Waste%</th><th>Days</th>
        ${sortTh('wind','machine','Machine')}
        ${sortTh('wind','startWorker','Worker')}
        ${sortTh('wind','startTime','Start')}
        ${sortTh('wind','endTime','End')}
        ${sortTh('wind','status','Status')}
        <th>Actions</th><th>Flag</th></tr>`;if(_fLot)document.getElementById('windf-lot').value=_fLot;if(_fGrade)document.getElementById('windf-grade').value=_fGrade;if(_fShade)document.getElementById('windf-shade').value=_fShade;if(_fStatus)document.getElementById('windf-status').value=_fStatus;_restoreFilterBtns('windf-lot','windf-grade','windf-shade','windf-status');_restoreFilterFocus(_focusCap);}
setTimeout(()=>_updateClearBtn('windf-'),0);const _windBase=(State.DB.windEntries||[]).filter(e=>(!_fLot||(e.dyeLotNo||'').includes(_fLot))&&(!_fGrade||e.grade===_fGrade)&&(!_fStatus||e.status===_fStatus)&&(!_fShade||e.shade===_fShade)).map(e=>({...e,_daysActive:e.startTime?Math.floor((new Date()-new Date(e.startTime))/86400000):999}));const entries=_sortState.wind?.col?sortArr(_windBase,_sortState.wind.col,_sortState.wind.dir):[..._windBase].sort((a,b)=>(b.startTime||'').localeCompare(a.startTime||''));const canAct=State.currentUser?.role==='admin'||State.currentUser?.role==='manager'||State.currentUser?.role==='supervisor';document.getElementById('wind-tbody').innerHTML=entries.map(e=>{const waste=e.outWeight!=null?(e.outWeight-e.inWeight):null;const _windDays=e.status==='Approved'&&e.approvedAt?Math.floor((new Date()-new Date(e.approvedAt))/86400000):null;const _windDyeStage=getDyeLotCurrentStage(e.dyeLotId);const _windStageC={'At Dye':'var(--cd)','At Wind':'var(--cw)','At Pack':'var(--cp)','Completed':'var(--gr)'}[_windDyeStage]||'var(--mu)';const _windWastePct=e.outWeight!=null&&e.inWeight>0?parseFloat(pct((e.outWeight||0)-(e.inWeight||0),e.inWeight)):0;
const _windBadge=statusBadge(e.status)+(e.status==='Approved'?`<div style="font-size:0.6rem;color:${_windStageC};margin-top:2px">${_windDyeStage}</div>`:'');return`<tr class="${entryRowClass(e.status)}"><td class="mono" style="vertical-align:top;color:var(--ac);font-weight:700;cursor:pointer" onclick="openDyeLifecycle('${e.dyeLotId||''}')"><span>${e.dyeLotNo||'—'}</span></td><td style="vertical-align:top">${e.grade?'<span class="badge b-rm">'+e.grade+'</span>':'—'}</td><td style="vertical-align:top;font-size:0.75rem;font-weight:600">${e.shade||'—'}</td><td style="vertical-align:top" class="mono">${qtyCell(e.inCones,e.inWeight,'c')}</td><td style="vertical-align:top" class="mono">${e.outCones||e.outWeight?(e.outCones||'—')+'c'+(e.outWeight?' / '+fmt(e.outWeight)+'kg':''):'—'}</td>${wasteCell(e.wasteCones,e.wasteWeight!=null?e.wasteWeight:waste,_windWastePct,'c')}${wastePctCell(e.inWeight>0&&(e.wasteCones!=null||waste!=null)?pct((e.outWeight||0)-(e.inWeight||0),e.inWeight||1):'—')}<td style="vertical-align:top">${agingBadge(_windDays)}</td>${mwCell(e.machine)}${mwCell(e.startWorker)}<td style="vertical-align:top;font-size:0.68rem;color:var(--mu)">${fmtTS(e.startTime)}</td><td style="vertical-align:top;font-size:0.68rem;color:var(--mu)">${e.endTime?fmtTS(e.endTime):'—'}</td><td style="vertical-align:top">${_windBadge}</td><td style="vertical-align:top;white-space:nowrap">
        ${(e.status==='Pending'||e.status==='Edited-Pending')&&isSup?`<button class="btn btn-success btn-xs tc-tip" data-tip="Approve" onclick="approveWindEntry('${e.id}')">✓</button><button class="btn btn-danger btn-xs tc-tip" data-tip="Reject" onclick="rejectWindEntry('${e.id}')">✗</button>`:''}
        ${(e.status==='Approved'||e.status==='Edited-Approved')&&isAdmin?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Edit" onclick="openEditEntryModal('${e.id}','wind')">✏</button><button class="btn btn-ghost btn-xs tc-tip" data-tip="Void" style="color:var(--re)" onclick="openVoidModal('${e.id}','wind')">🗑</button>`:''}
        ${(e.status==='Rejected'||e.status==='Voided')&&isAdmin?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Override" onclick="openOverride('${e.id}','wind')">⚡</button><button class="btn btn-ghost btn-xs tc-tip" data-tip="Void" style="color:var(--re)" onclick="openVoidModal('${e.id}','wind')">🗑</button>`:''}
      </td><td style="vertical-align:top">${entryFlagPill(e.id)}</td></tr>`;}).join('')||'<tr><td colspan="18"><div class="empty"><div class="empty-icon">🌀</div><div class="empty-text">✕ No wind entries yet — select a dye lot to begin</div></div></td></tr>';renderBevWindReady();renderBevWindPending();renderBevWindFlagged();setTimeout(fitBevTableHeight,0);}

export async function approveWindEntry(id){
  try{
    const {ok,data,error,networkError}=await apiPost('/api/approve-entry',{type:'wind',id,changedBy:State.currentUser.name});
  if(networkError)throw new Error(error);
  if(!ok){showToast(error||'Could not approve','err');return;}
    showToast('Wind entry approved ✓');await _refreshAndRender(['windEntries'],renderAll);
  }catch(e){showToast('Network error — not saved: '+e.message,'err');}
}

export function clearWindFilters(){['windf-lot','windf-grade','windf-shade','windf-status'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';_tableFilters[id]='';});renderWindTable();setTimeout(()=>_updateClearBtn('windf-'),0);}

export function onWindDyeLotSelect(){const id=document.getElementById('wind-dye-lot-select').value;const infoEl=document.getElementById('wind-lot-info');const infoRow=document.getElementById('wind-dye-lot-info-row');if(!id){infoRow.style.display='none';return;}
const lot=(State.DB.dyeLots||[]).find(d=>d.id===id);if(!lot){infoRow.style.display='none';return;}
infoRow.style.display='';const _wGrades=(lot.sources||[]).map(s=>s.grade).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(' + ');const _wBal=getDyeBalAvailable(id);infoEl.innerHTML=`<strong>${lot.dyeLotNo}</strong> — ${lot.shade}<br><span style="color:var(--mu);font-size:0.72rem">Grade: ${_wGrades||'—'}</span><br>Available: <strong>${_wBal.units||0}c / ${fmt(_wBal.weight)}kg</strong>`;}

export function openWindModal(mode){State._windMode=mode;document.getElementById('wind-modal-title').textContent=mode==='Start'?'▶ Start Wind':'✓ End Wind';document.getElementById('wind-alert').innerHTML='';document.getElementById('wind-notes').value='';const M=machinesForStage('Wind'),W=workersSorted();const opts=arr=>'<option value="">Select...</option>'+arr.map(v=>'<option value="'+v+'">'+v+'</option>').join('');const _windWorkerCur=State.currentUser?.name||'';const optsW=arr=>'<option value="">Select...</option>'+arr.map(v=>'<option value="'+v+'" '+(v===_windWorkerCur?'selected':'')+'>'+v+'</option>').join('');const mSel=document.getElementById('wind-machine-select');if(mSel)mSel.innerHTML=opts(M);const wSel=document.getElementById('wind-worker-select');if(wSel)wSel.innerHTML=optsW(W);const show=(id,v)=>{const el=document.getElementById(id);if(el)el.style.display=v?'':'none';};if(mode==='Start'){show('wind-dye-lot-row',true);show('wind-in-cones-row',true);show('wind-in-weight-fg',true);show('wind-machine-row',true);show('wind-worker-row',true);show('wind-entry-select-row',false);show('wind-out-weight-row',false);show('wind-out-cones-row',false);document.getElementById('wind-in-weight').value='';if(document.getElementById('wind-in-cones'))document.getElementById('wind-in-cones').value='';const availLots=eligibleWindLots();// Searchable dropdown for Wind lot selection
const _windOpts=availLots.map(d=>{const b=getDyeBalAvailable(d.id);return{id:d.id,label:d.dyeLotNo+' — '+d.shade+' | '+(b.units||0)+' cones, '+fmt(b.weight)+'kg avail'};});
// Jul 10 2026 fix: the hidden select must actually contain a matching <option>
// for each real dye lot, or assigning .value=id from the search widget's
// onSelect callback silently fails (browsers ignore assigning a <select>'s
// value to anything without a matching <option> — selectedIndex stays -1,
// value reads back as ''). This broke both the available-balance info box
// AND actual Wind submission for every lot, not just some.
const _windSelEl=document.getElementById('wind-dye-lot-select');
if(_windSelEl)_windSelEl.innerHTML='<option value="">Select dye lot...</option>'+_windOpts.map(o=>`<option value="${o.id}">${o.label}</option>`).join('');
const _windSearchEl=document.getElementById('wind-dye-lot-search');
if(_windSearchEl){_windLotSearch=makeDyeLotSearch('wind-dye-lot-search',_windOpts,id=>{document.getElementById('wind-dye-lot-select').value=id;onWindDyeLotSelect();});}const submitBtn=document.getElementById('wind-submit-btn');if(submitBtn)submitBtn.textContent='▶ Start Wind';}else{show('wind-dye-lot-row',false);show('wind-in-cones-row',false);show('wind-in-weight-fg',false);show('wind-machine-row',false);show('wind-worker-row',false);show('wind-entry-select-row',true);show('wind-out-weight-row',true);show('wind-out-cones-row',true);if(document.getElementById('wind-out-weight'))document.getElementById('wind-out-weight').value='';if(document.getElementById('wind-out-cones'))document.getElementById('wind-out-cones').value='';const inProg=(State.DB.windEntries||[]).filter(e=>e.status==='InProgress');const entSel=document.getElementById('wind-entry-select');if(entSel)entSel.innerHTML='<option value="">Select entry to end...</option>'+
inProg.map(e=>'<option value="'+e.id+'">'+e.id+' — '+(e.dyeLotNo||'')+' '+(e.shade||'')+' | '+(e.inCones||0)+' cones, '+fmt(e.inWeight)+'kg in</option>').join('');const submitBtn=document.getElementById('wind-submit-btn');if(submitBtn)submitBtn.textContent='✓ End Wind';}
openModal('wind-modal-overlay');}

export async function rejectWindEntry(id){try{const {ok,error,networkError}=await apiPost('/api/reject',{type:'wind',id,changedBy:State.currentUser?.name,role:State.currentUser?.role});if(networkError)throw new Error(error);if(!ok){showToast(error||'Reject failed','err');return;}showToast('Wind entry rejected','err');await _refreshAndRender(['windEntries'],renderAll);}catch(e){showToast('Network error — '+e.message,'err');}}

export function showWindEndRef(){const entryId=document.getElementById('wind-entry-select')?.value;const ref=document.getElementById('wind-end-ref');if(!entryId){if(ref)ref.style.display='none';return;}
const e=(State.DB.windEntries||[]).find(x=>x.id===entryId);if(!e||!ref){if(ref)ref.style.display='none';return;}
ref.style.display='block';const elapsed=hrsBetween(e.startTime,new Date().toISOString());ref.innerHTML='<div style="font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--cw);margin-bottom:10px;">📋 Start Reference — Wind Stage</div>'
+'<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px;">'
+'<div><div style="font-size:.58rem;color:var(--mu);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">Dye Lot / Shade</div><div style="font-size:.82rem;font-weight:700;color:#fff">'+(e.dyeLotNo||'—')+'</div><div style="font-size:.65rem;color:var(--mu)">'+(e.shade||'')+'</div></div>'
+'<div><div style="font-size:.58rem;color:var(--mu);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">Input Loaded</div><div style="font-size:.9rem;font-weight:700;color:var(--bl)">'+(e.inCones||0)+'c / '+fmt(e.inWeight)+'kg</div></div>'
+'<div><div style="font-size:.58rem;color:var(--mu);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">Running Time</div><div style="font-size:.9rem;font-weight:700;color:var(--cy)">'+fmtHrs(elapsed)+'</div><div style="font-size:.65rem;color:var(--mu)">since '+fmtTS(e.startTime)+'</div></div></div>'
+'<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;padding-top:8px;border-top:1px solid var(--b1);">'
+'<div><div style="font-size:.58rem;color:var(--mu);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">Machine</div><div style="font-size:.78rem;font-weight:600">'+(e.machine||'—')+'</div></div>'
+'<div><div style="font-size:.58rem;color:var(--mu);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">Started By</div><div style="font-size:.78rem;font-weight:600">'+(e.startWorker||'—')+'</div></div></div>'
+'<div style="margin-top:8px;padding:7px 10px;background:rgba(59,130,246,.08);border-radius:5px;font-size:.7rem;color:var(--bl);">ℹ Output cannot exceed <strong>'+(e.inCones)+'c / '+fmt(e.inWeight)+'kg</strong></div>';const outCones=document.getElementById('wind-out-cones');const outWt=document.getElementById('wind-out-weight');if(outCones){outCones.max=e.inCones;outCones.placeholder='0–'+e.inCones;}
if(outWt){outWt.max=e.inWeight;outWt.placeholder='0–'+fmt(e.inWeight);}}

export async function submitWind(){
  // Jul 14 2026 — Item I cutover (Wind). All validation and the write now
  // live in worker.js (POST /api/wind/start, /api/wind/end).
  const setAlert=msg=>{document.getElementById('wind-alert').innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;};
  if(State._windMode==='Start'){
    const dyeLotId=document.getElementById('wind-dye-lot-select').value;const inCones=parseInt(document.getElementById('wind-in-cones')?.value)||0;const inWeight=parseFloat(document.getElementById('wind-in-weight').value)||0;const machine=document.getElementById('wind-machine-select')?.value||'';const worker=document.getElementById('wind-worker-select')?.value||'';const notes=document.getElementById('wind-notes').value.trim();
    if(!dyeLotId){setAlert('Select a dye lot');return;}
    if(inCones<=0){setAlert('Enter cones count');return;}
    if(inWeight<=0){setAlert('Input weight must be > 0');return;}
    if(!machine){setAlert('Select machine');return;}
    if(!worker){setAlert('Select worker');return;}
    const _windDup=(State.DB.windEntries||[]).find(e=>e.dyeLotId===dyeLotId&&e.status==='InProgress');
    if(_windDup){const _elapsed=hrsBetween(_windDup.startTime,new Date().toISOString());if(!confirm(`\u26a0 ${dyeLotId} already has a Wind entry IN PROGRESS\nStarted: ${fmtTS(_windDup.startTime)} by ${_windDup.startWorker||'?'}\nRunning for: ${fmtHrs(_elapsed)}\n\nStart another run anyway? (only do this if machines are different)`))return;}
    const _btn=document.getElementById('wind-submit-btn');if(_btn)_btn.disabled=true;
    try{
      const {ok,data,error,networkError}=await _postWithDuplicateCheck('/api/wind/start',{dyeLotId,inCones,inWeight,machine,worker,notes,changedBy:State.currentUser.name,idempotencyKey:crypto.randomUUID()});
  if(networkError)throw new Error(error);
  if(!ok){if(error!=='__cancelled_by_user__')setAlert(error||'Failed to start wind entry');if(_btn)_btn.disabled=false;return;}
      if(_btn)_btn.disabled=false;closeModal('wind-modal-overlay');showToast('Wind started \u2713');await _refreshAndRender(['windEntries'],renderAll);
    }catch(e){setAlert('Network error \u2014 not saved: '+e.message);if(_btn)_btn.disabled=false;}
  }else{
    const entryId=document.getElementById('wind-entry-select').value;const outCones=parseInt(document.getElementById('wind-out-cones')?.value)||0;const outWeight=parseFloat(document.getElementById('wind-out-weight').value)||0;const notes=document.getElementById('wind-notes').value.trim();
    if(!entryId){setAlert('Select a wind entry to end');return;}
    if(outCones<=0){setAlert('Enter output cones count');return;}
    if(outWeight<=0){setAlert('Output weight must be > 0');return;}
    const _btn2=document.getElementById('wind-submit-btn');if(_btn2)_btn2.disabled=true;
    try{
      const {ok,data,error,networkError}=await apiPost('/api/wind/end',{id:entryId,outCones,outWeight,notes,idempotencyKey:crypto.randomUUID()});
  if(networkError)throw new Error(error);
  if(!ok){setAlert(error||'Failed to end wind entry');if(_btn2)_btn2.disabled=false;return;}
      if(_btn2)_btn2.disabled=false;closeModal('wind-modal-overlay');showToast('Wind ended \u2713 \u2014 pending approval');await _refreshAndRender(['windEntries'],renderAll);
    }catch(e){setAlert('Network error \u2014 not saved: '+e.message);if(_btn2)_btn2.disabled=false;}
  }
}

window.approveWindEntry = approveWindEntry;
window.onWindDyeLotSelect = onWindDyeLotSelect;
window.openWindModal = openWindModal;
window.rejectWindEntry = rejectWindEntry;
window.showWindEndRef = showWindEndRef;
window.submitWind = submitWind;
