// pack.js — Pack page: entry table, modal, filters.
// Aug 6 2026 — Phase 1, Step 19 of the module-split plan. Extracted byte-
// for-byte from pages.js. Real inventory: 7 functions. renderApprovalPack
// correctly excluded (Approval page's own concern). rptPack/setPackFilter
// correctly excluded — genuinely belong to the Reports page (confirmed:
// use rpt-prefixed DOM elements), same pattern as rptWaste/rptFlow found
// during Soft/Dye. Same "Worker View" boundary confirmed a fourth time:
// wPackLotChange, wSubmitPack, workerPackForm correctly excluded.

import { State, _sortState, agingBadge, apiPost, fmt, fmtTS, mwCell, qtyCell, showToast, openModal, closeModal, getWindBalAvailable, getTotalDispatched, getTotalPacked, _tableFilters, wasteCell, wastePctCell, _refreshAndRender, eligiblePackLots, workersSorted } from './core.js';
import { _captureFilterFocus, _restoreFilterBtns, _restoreFilterFocus, buildColFilter, buildDyeLotSearch, entryRowClass, fitBevTableHeight, sortArr, sortTh, statusBadge, makeDyeLotSearch, renderBevPackReady, renderBevPackPending, renderBevPackFlagged } from './shared.js';

import { renderAll, _postWithDuplicateCheck, entryFlagPill } from './pages.js';
import { _updateClearBtn } from './shared.js';

// Aug 26 2026 — real bug found and fixed via a complete, systematic
// sweep for this exact same pattern, after finding the first, live
// instance directly in Priyam's own console log: declared in pages.js
// on a shared, multi-variable line, but never actually used there —
// only ever assigned and read here. Same fix as _pendingEditBody.
let _packLotSearch=null;

export function renderPackTable(){const _focusCap=_captureFilterFocus('packf-');const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';const isSup=State.currentUser?.role==='supervisor'||isAdmin;const _fLot=document.getElementById('packf-lot')?.value||'';const _fGradeP=document.getElementById('packf-grade')?.value||'';const _fStatus=document.getElementById('packf-status')?.value||'';const _fShade=document.getElementById('packf-shade')?.value||'';const allPack=State.DB.packEntries||[];const lots=[...new Set(allPack.filter(e=>(!_fShade||e.shade===_fShade)&&(!_fStatus||e.status===_fStatus)).map(e=>e.dyeLotNo).filter(Boolean))].sort((a,b)=>b.localeCompare(a));const grades_p=[...new Set(allPack.filter(e=>(!_fLot||(e.dyeLotNo||'').includes(_fLot))&&(!_fStatus||e.status===_fStatus)).map(e=>e.grade).filter(Boolean))].sort();const shades_p=[...new Set(allPack.filter(e=>(!_fLot||(e.dyeLotNo||'').includes(_fLot))&&(!_fStatus||e.status===_fStatus)).map(e=>e.shade).filter(Boolean))].sort();const statuses=[...new Set(allPack.filter(e=>(!_fLot||(e.dyeLotNo||'').includes(_fLot))&&(!_fShade||e.shade===_fShade)).map(e=>e.status).filter(Boolean))].sort();const _pTh=document.getElementById('pack-thead');if(_pTh){_pTh.innerHTML=`
      <tr class="tbl-filter-row"><th>${buildDyeLotSearch('packf-lot','packf-lot-xbtn','packf')}</th><th>${buildColFilter(grades_p,'packf-grade','Grade')}</th><th>${buildColFilter(shades_p,'packf-shade','Shade')}</th><th></th><th></th><th></th><th></th><th></th><th></th><th></th><th>${buildColFilter(statuses,'packf-status','Status')}</th><th></th></tr><tr>
        ${sortTh('pack','dyeLotNo','Dye Lot')}
        ${sortTh('pack','grade','Grade')}
        ${sortTh('pack','shade','Shade')}
        <th>In (c/kg)</th><th>Out (b/kg)</th><th>Gain (kg)</th><th>Gain%</th>
        ${sortTh('pack','_daysActive','Days')}
        ${sortTh('pack','worker','Worker')}
        ${sortTh('pack','timestamp','Date/Time')}
        ${sortTh('pack','status','Status')}
        <th>Actions</th><th>Flag</th></tr>`;if(_fLot)document.getElementById('packf-lot').value=_fLot;if(_fGradeP)document.getElementById('packf-grade').value=_fGradeP;if(_fShade)document.getElementById('packf-shade').value=_fShade;if(_fStatus)document.getElementById('packf-status').value=_fStatus;_restoreFilterBtns('packf-lot','packf-grade','packf-shade','packf-status');_restoreFilterFocus(_focusCap);}
const _packF=(State.DB.packEntries||[]).filter(e=>(!_fLot||(e.dyeLotNo||'').includes(_fLot))&&(!_fGradeP||(e.grade||'')===_fGradeP)&&(!_fShade||(e.shade||'')===_fShade)&&(!_fStatus||e.status===_fStatus));const _packFc=_packF.map(e=>({...e,_daysActive:e.timestamp?Math.floor((new Date()-new Date(e.timestamp))/86400000):999}));const entries=_sortState.pack?.col?sortArr(_packFc,_sortState.pack.col,_sortState.pack.dir):[..._packFc].sort((a,b)=>(b.timestamp||'').localeCompare(a.timestamp||''));const canAct=State.currentUser?.role==='admin'||State.currentUser?.role==='manager'||State.currentUser?.role==='supervisor';document.getElementById('pack-tbody').innerHTML=entries.map(e=>{const _packDays=e.status==='Approved'&&e.approvedAt?Math.floor((new Date()-new Date(e.approvedAt))/86400000):e.timestamp?Math.floor((new Date()-new Date(e.timestamp))/86400000):null;const _packDispatched=(State.DB.dispatches||[]).some(d=>d.dyeLotId===e.dyeLotId&&(d.status==='Approved'||d.status==='Edited-Approved'));const _packBadge=statusBadge(e.status)+(e.status==='Approved'&&_packDispatched?'<div style="font-size:0.6rem;color:var(--gr);margin-top:2px">Dispatched</div>':'');return`<tr class="${entryRowClass(e.status)}"><td class="mono" style="vertical-align:top;color:var(--ac);font-weight:700;cursor:pointer" onclick="openDyeLifecycle('${e.dyeLotId||''}')"><span>${e.dyeLotNo||'—'}</span></td><td style="vertical-align:top">${e.grade?'<span class="badge b-rm">'+e.grade+'</span>':'—'}</td><td style="vertical-align:top;font-size:0.75rem;font-weight:600">${e.shade||'—'}</td><td style="vertical-align:top" class="mono">${qtyCell(e.inCones,e.inWeight,'c')}</td><td style="vertical-align:top" class="mono">${fmt(e.bags)}b / ${fmt(e.weight)}kg</td>${wasteCell(null,e.gainKg,e.gainPct,'')}${wastePctCell(e.gainPct!=null?e.gainPct.toFixed(1)+'%':'—')}<td style="vertical-align:top">${agingBadge(_packDays)}</td>${mwCell(e.worker)}<td style="vertical-align:top;font-size:0.68rem;color:var(--mu)">${fmtTS(e.timestamp)}</td><td style="vertical-align:top">${_packBadge}</td><td style="vertical-align:top;white-space:nowrap">
        ${(e.status==='Pending'||e.status==='Edited-Pending')&&isSup?`<button class="btn btn-success btn-xs tc-tip" data-tip="Approve" onclick="approvePackEntry('${e.id}')">✓</button><button class="btn btn-danger btn-xs tc-tip" data-tip="Reject" onclick="rejectPackEntry('${e.id}')">✗</button>`:''}
        ${(e.status==='Approved'||e.status==='Edited-Approved')&&isAdmin?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Edit" onclick="openEditEntryModal('${e.id}','pack')">✏</button><button class="btn btn-ghost btn-xs tc-tip" data-tip="Void" style="color:var(--re)" onclick="openVoidModal('${e.id}','pack')">🗑</button>`:''}
        ${(e.status==='Rejected'||e.status==='Voided')&&isAdmin?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Override" onclick="openOverride('${e.id}','pack')">⚡</button><button class="btn btn-ghost btn-xs tc-tip" data-tip="Void" style="color:var(--re)" onclick="openVoidModal('${e.id}','pack')">🗑</button>`:''}
      </td><td style="vertical-align:top">${entryFlagPill(e.id)}</td></tr>`;}).join('')||'<tr><td colspan="11"><div class="empty"><div class="empty-icon">📦</div><div class="empty-text">✕ No pack entries yet — select a dye lot to begin</div></div></td></tr>';renderBevPackReady();renderBevPackPending();renderBevPackFlagged();setTimeout(fitBevTableHeight,0);}

export async function approvePackEntry(id){
  try{
    const {ok,data,error,networkError}=await apiPost('/api/approve-entry',{type:'pack',id,changedBy:State.currentUser.name});
  if(networkError)throw new Error(error);
  if(!ok){showToast(error||'Could not approve','err');return;}
    showToast('Pack entry approved ✓');await _refreshAndRender(['packEntries'],renderAll);
  }catch(e){showToast('Network error — not saved: '+e.message,'err');}
}

export function clearPackFilters(){['packf-lot','packf-grade','packf-shade','packf-status'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';_tableFilters[id]='';});renderPackTable();setTimeout(()=>_updateClearBtn('packf-'),0);}

export function onPackDyeLotSelect(){const gainEl=document.getElementById('pack-gain-display');if(gainEl)gainEl.style.display='none';const id=document.getElementById('pack-dye-lot-select').value;const infoEl=document.getElementById('pack-lot-info');if(!id){infoEl.style.display='none';return;}
const lot=(State.DB.dyeLots||[]).find(d=>d.id===id);if(!lot){infoEl.style.display='none';return;}
const packed=getTotalPacked(id);const disp=getTotalDispatched(id);const _pGrades=(lot.sources||[]).map(s=>s.grade).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(' + ');
const _wBal2=getWindBalAvailable(id);
infoEl.style.display='block';
infoEl.innerHTML=`<div style="background:var(--s2);border-radius:7px;padding:9px 12px;font-size:0.78rem;color:var(--tx);"><strong>${lot.dyeLotNo}</strong> — ${lot.shade||'—'}<br><span style="color:var(--mu);font-size:0.72rem">Grade: ${_pGrades||'—'}</span><br>Available: <strong>${_wBal2.units||0}c / ${fmt(_wBal2.weight)}kg</strong></div>`;}

export function openPackModal(){document.getElementById('pack-alert').innerHTML='';document.getElementById('pack-bags').value='';document.getElementById('pack-weight').value='';if(document.getElementById('pack-in-weight'))document.getElementById('pack-in-weight').value='';document.getElementById('pack-notes').value='';document.getElementById('pack-lot-info').style.display='none';const W=workersSorted();const _packWorkerCur=State.currentUser?.name||'';document.getElementById('pack-worker').innerHTML=`<option value="">Select...</option>${W.map(v=>`<option value="${v}"${v===_packWorkerCur?'selected':''}>${v}</option>`).join('')}`;const availLots=eligiblePackLots();// Searchable dropdown for Pack lot selection
const _packOpts=availLots.map(d=>{const _wb=getWindBalAvailable(d.id);return{id:d.id,label:d.dyeLotNo+' — '+d.shade+' | '+(_wb.units||0)+' cones, '+fmt(_wb.weight)+'kg avail'};});
// Jul 10 2026 fix — same class of bug as Wind, see comment there.
const _packSelEl=document.getElementById('pack-dye-lot-select');
if(_packSelEl)_packSelEl.innerHTML='<option value="">Select Dye Lot...</option>'+_packOpts.map(o=>`<option value="${o.id}">${o.label}</option>`).join('');
const _packSearchEl=document.getElementById('pack-dye-lot-search');
if(_packSearchEl){_packLotSearch=makeDyeLotSearch('pack-dye-lot-search',_packOpts,id=>{document.getElementById('pack-dye-lot-select').value=id;onPackDyeLotSelect();});}openModal('pack-modal-overlay');}

export async function rejectPackEntry(id){try{const {ok,error,networkError}=await apiPost('/api/reject',{type:'pack',id,changedBy:State.currentUser?.name,role:State.currentUser?.role});if(networkError)throw new Error(error);if(!ok){showToast(error||'Reject failed','err');return;}showToast('Pack entry rejected','err');await _refreshAndRender(['packEntries'],renderAll);}catch(e){showToast('Network error — '+e.message,'err');}}

export async function submitPack(){
  // Jul 14 2026 — Item I cutover (Pack). All validation and the write now
  // live in worker.js (POST /api/pack).
  const setAlert=msg=>{document.getElementById('pack-alert').innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;};
  const dyeLotId=document.getElementById('pack-dye-lot-select').value;const inCones=parseInt(document.getElementById('pack-in-cones')?.value)||0;const inWeight=parseFloat(document.getElementById('pack-in-weight')?.value)||0;const bags=parseInt(document.getElementById('pack-bags').value)||0;const weight=parseFloat(document.getElementById('pack-weight').value)||0;const worker=document.getElementById('pack-worker').value;const notes=document.getElementById('pack-notes').value.trim();
  if(!dyeLotId){setAlert('Select a dye lot');return;}
  if(inCones<=0){setAlert('Cones in must be > 0');return;}
  if(inWeight<=0){setAlert('In weight must be > 0');return;}
  if(bags<=0){setAlert('Bags must be > 0');return;}
  if(weight<=0){setAlert('Weight must be > 0');return;}
  if(!worker){setAlert('Select worker');return;}
  const _packDup=(State.DB.packEntries||[]).find(e=>e.dyeLotId===dyeLotId&&e.status==='Pending');
  if(_packDup){if(!confirm(`\u26a0 ${dyeLotId} already has a Pack entry PENDING approval\nSubmitted: ${fmtTS(_packDup.timestamp)} by ${_packDup.worker||'?'}\n\nAdd another pack entry anyway?`))return;}
  const _pkBtn=document.getElementById('pack-submit-btn');if(_pkBtn)_pkBtn.disabled=true;
  try{
    const {ok,data,error,networkError}=await _postWithDuplicateCheck('/api/pack',{dyeLotId,inCones,inWeight,bags,weight,worker,notes,changedBy:State.currentUser.name,idempotencyKey:crypto.randomUUID()});
  if(networkError)throw new Error(error);
  if(!ok){if(error!=='__cancelled_by_user__')setAlert(error||'Failed to save pack entry');if(_pkBtn)_pkBtn.disabled=false;return;}
    if(_pkBtn)_pkBtn.disabled=false;closeModal('pack-modal-overlay');showToast('Pack entry saved \u2713 \u2014 pending approval');renderAll();
  }catch(e){setAlert('Network error \u2014 not saved: '+e.message);if(_pkBtn)_pkBtn.disabled=false;}
}

window.approvePackEntry = approvePackEntry;
window.openPackModal = openPackModal;
window.rejectPackEntry = rejectPackEntry;
window.submitPack = submitPack;
