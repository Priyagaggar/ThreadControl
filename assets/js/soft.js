// soft.js — Soft (Stage) page: entry table, Start/End forms, Worker mobile
// form, Residual Transfer modal.
// Aug 6 2026 — Phase 1, Step 16 of the module-split plan. Extracted byte-
// for-byte from pages.js. Real inventory: 14 functions. workerStageForm's
// own cross-references (wSubmitStart, wSubmitEnd, wSwitchTab) belong to a
// genuinely separate, previously-unidentified "Worker View" mobile
// feature (confirmed: onLogin() has a real, separate renderWorkerView()
// entry point for the 'worker' role) — correctly left as legitimate
// external references to pages.js, not pulled into scope today.
// renderApprovalSoft correctly excluded (Approval page's own concern);
// toggleLCStage correctly excluded (already in lifecycle.js).

export function checkDuplicateInProgress(lotId,stage){const existing=State.DB.stageEntries.find(e=>e.lotId===lotId&&e.stage===stage&&e.status==='InProgress');if(!existing)return true;const elapsed=hrsBetween(existing.startTime,new Date().toISOString());const msg=`⚠ LOT-${lotId} already has a ${stage} entry IN PROGRESS\n`
+`Started: ${fmtTS(existing.startTime)} by ${existing.startWorker||'?'}\n`
+`Running for: ${fmtHrs(elapsed)}\n\n`
+`Start another run anyway? (only do this if machines are different)`;return confirm(msg);}

import { renderAll, populateSelects, _postWithDuplicateCheck, stageColor, stageIcon, entryFlagPill } from './pages.js';
import { rptWaste } from './reports.js';

export function specialMaterialSectionHTML(dsSelectId,fieldClass,labelClass,wrapOpen,wrapClose){
  // Sep 20 2026 — Recycle Phase 2 leftover removal: the old "Recycle Material (Wound)" picker is gone — there is no Recycle Wind
  // route any more (off yarn goes On Steel -> re-dye, or -> Recycle Soft -> Dye, or -> Scrap, never back through ordinary Soft).
  const dsPlastic=(State.DB.deadStock||[]).filter(d=>d.type==='Plastic'&&d.status==='Approved'&&getDeadStockBalance(d.id)>0);
  if(!dsPlastic.length) return '';
  return wrapOpen+'<div style="font-size:0.7rem;font-weight:700;color:var(--mu);margin-bottom:8px">SPECIAL MATERIAL (optional — only if softening Dead Stock)</div>'
    +`<div class="${fieldClass}" style="margin-bottom:8px"><label class="${labelClass}">📦 Dead Stock Plastic Cone</label><select class="${fieldClass==='fg'?'fs':'wselect'}" id="${dsSelectId}"><option value="">None</option>`+dsPlastic.map(d=>'<option value="'+d.id+'">'+d.id+' — '+d.grade+' ('+fmt(getDeadStockBalance(d.id))+'kg avail)</option>').join('')+'</select></div>'
    +'<div style="font-size:0.68rem;color:var(--mu);margin-top:4px">ℹ️ Select only if this soft entry processes special material. Leave blank for normal RM lot softening.</div>'+wrapClose;
}

import { State, _sortState, agingBadge, dtCell, mwCell, pct, qtyCell, wasteCell, wastePctCell, apiPost, closeModal, fmt, getRMBalance, lotsForStage, showToast, getLotByKey, getLot, stageBalance, openModal, getSoftOut, fmtHrs, fmtTS, getDeadStockBalance, getSoftBalanceWeightAvailable, hrsBetween, clearAlerts, setAlert, _refreshAndRender, machinesForStage, workersSorted } from './core.js';
import { _restoreFilterBtns, buildColFilter, entryRowClass, renderBevSoftPending, renderBevSoftReady, renderBevSoftFlagged, sortArr, sortTh, statusBadge, fitBevTableHeight } from './shared.js';

export function renderStageTable(){const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';const isSup=State.currentUser?.role==='supervisor'||isAdmin;const _sefLot=document.getElementById('sef-lot')?.value||'';const _sefVendor=document.getElementById('sef-vendor')?.value||'';const _sefGrade=document.getElementById('sef-grade')?.value||'';const _sefStatus=document.getElementById('sef-status')?.value||'';const allSE=State.DB.stageEntries||[];const se_lots=[...new Set(allSE.filter(e=>(!_sefVendor||e.vendor===_sefVendor)&&(!_sefGrade||e.grade===_sefGrade)&&(!_sefStatus||e.status===_sefStatus)).map(e=>e.lotId).filter(Boolean))].sort();const se_vendors=[...new Set(allSE.filter(e=>(!_sefLot||e.lotId===_sefLot)&&(!_sefGrade||e.grade===_sefGrade)&&(!_sefStatus||e.status===_sefStatus)).map(e=>e.vendor).filter(Boolean))].sort();const se_grades=[...new Set(allSE.filter(e=>(!_sefLot||e.lotId===_sefLot)&&(!_sefVendor||e.vendor===_sefVendor)&&(!_sefStatus||e.status===_sefStatus)).map(e=>e.grade).filter(Boolean))].sort();const se_statuses=[...new Set(allSE.filter(e=>(!_sefLot||e.lotId===_sefLot)&&(!_sefVendor||e.vendor===_sefVendor)&&(!_sefGrade||e.grade===_sefGrade)).map(e=>e.status).filter(Boolean))].sort();const seThead=document.getElementById('se-thead');if(seThead){seThead.innerHTML=`
      <tr class="tbl-filter-row"><th>${buildColFilter(se_lots,'sef-lot','Lot')}</th><th>${buildColFilter(se_grades,'sef-grade','Grade')}</th><th>${buildColFilter(se_vendors,'sef-vendor','Vendor')}</th><th></th><th></th><th></th><th></th><th></th><th></th><th></th><th></th><th></th><th>${buildColFilter(se_statuses,'sef-status','Status')}</th><th></th></tr><tr>
        ${sortTh('se','lotId','Lot')}
        ${sortTh('se','grade','Grade')}
        ${sortTh('se','vendor','Vendor')}
        <th>In (b/kg)</th><th>Out (b/kg)</th><th>Waste (b/kg)</th><th>Waste%</th>
        ${sortTh('se','_daysActive','Days')}
        ${sortTh('se','machine','Machine')}
        ${sortTh('se','startWorker','Worker')}
        ${sortTh('se','startTime','Start Time')}
        ${sortTh('se','endTime','End Time')}
        ${sortTh('se','status','Status')}
        <th>Actions</th><th>Flag</th></tr>`;if(_sefLot)document.getElementById('sef-lot').value=_sefLot;if(_sefVendor)document.getElementById('sef-vendor').value=_sefVendor;if(_sefGrade)document.getElementById('sef-grade').value=_sefGrade;if(_sefStatus)document.getElementById('sef-status').value=_sefStatus;_restoreFilterBtns('sef-lot','sef-vendor','sef-grade','sef-status');}
const _seFiltered=[...State.DB.stageEntries].filter(e=>(!_sefLot||e.lotId===_sefLot)&&(!_sefVendor||e.vendor===_sefVendor)&&(!_sefGrade||e.grade===_sefGrade)&&(!_sefStatus||e.status===_sefStatus));const entries=_sortState.se.col?sortArr(_seFiltered,_sortState.se.col,_sortState.se.dir):_seFiltered.sort((a,b)=>(b.startTime||'').localeCompare(a.startTime||''));document.getElementById('se-tbody').innerHTML=entries.map(e=>{const wp=e.wasteWeight!=null&&e.inWeight>0?pct(e.wasteWeight,e.inWeight):'—';const dur=e.startTime&&e.endTime?((new Date(e.endTime)-new Date(e.startTime))/3600000).toFixed(1)+'h':'—';const canEdit=(State.currentUser?.role==='supervisor'||State.currentUser?.role==='manager'||State.currentUser?.role==='admin')&&e.status!=='Void';const canVoidReq=(State.currentUser?.role==='supervisor'||State.currentUser?.role==='manager'||State.currentUser?.role==='admin')&&e.status!=='Void';const canOverride=State.currentUser?.role==='admin'&&(e.status==='Approved'||e.status==='Rejected');const noteStyle='font-size:0.68rem;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';const _stVendor=e.vendor||(State.DB.lots.find(l=>l.id===e.lotId&&l.grade===e.grade)||State.DB.lots.find(l=>l.id===e.lotId)||{}).vendor||'';const _stVendorMatches=(State.DB.lots.filter(l=>l.id===e.lotId&&l.grade===e.grade)||[]).length;const _stVendorAmbig=!e.vendor&&_stVendorMatches>1;const _seDays=e.startTime?Math.floor((new Date()-new Date(e.startTime))/86400000):null;return`<tr class="${entryRowClass(e.status,e.voided)}"><td style="vertical-align:top;color:var(--ac);font-weight:700;cursor:pointer" class="mono" onclick="nav('lifecycle',document.getElementById('ni-lifecycle'));document.getElementById('lc-select').value='${e.lotId}';renderLifecycle()">${e.lotId}</td><td style="vertical-align:top"><span class="badge b-rm">${e.grade||''}</span></td><td style="vertical-align:top;font-size:0.72rem;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${_stVendorAmbig?'var(--re)':'var(--tx)'};" title="${_stVendorAmbig?'⚠ Vendor unknown — void and re-enter':_stVendor}">${_stVendorAmbig?'⚠ Unknown':_stVendor||'—'}</td><td style="vertical-align:top" class="mono">${qtyCell(e.inUnits,e.inWeight,'b')}</td><td style="vertical-align:top" class="mono">${qtyCell(e.outUnits,e.outWeight,'b')}</td>${wasteCell(e.wasteUnits,e.wasteWeight,wp,'b')}${wastePctCell(wp)}<td style="vertical-align:top">${agingBadge(_seDays)}</td>${mwCell(e.machine)}${mwCell(e.startWorker)}${dtCell(e.startTime)}${dtCell(e.endTime)}<td style="vertical-align:top">${statusBadge(e.voided?'Void':e.status)}</td><td style="vertical-align:top;white-space:nowrap;display:flex;gap:3px;">
        ${(e.status==='Pending'||e.status==='Edited-Pending')&&isSup?`<button class="btn btn-success btn-xs tc-tip" data-tip="Approve" onclick="approveEntry('${e.id}','stage')">✓</button><button class="btn btn-danger btn-xs tc-tip" data-tip="Reject" onclick="rejectEntry('${e.id}','stage')">✗</button>`:''}

        ${(e.status==='Approved'||e.status==='Edited-Approved')&&isAdmin?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Edit" onclick="openEditEntryModal('${e.id}','soft')">✏</button><button class="btn btn-ghost btn-xs tc-tip" data-tip="Void" style="color:var(--re)" onclick="openVoidModal('${e.id}','soft')">🗑</button>`:''}
        ${(e.status==='Rejected'||e.status==='Voided')&&isAdmin?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Override" onclick="openOverride('${e.id}','stage')">⚡</button><button class="btn btn-ghost btn-xs tc-tip" data-tip="Void" style="color:var(--re)" onclick="openVoidModal('${e.id}','soft')">🗑</button>`:''}
      </td><td style="vertical-align:top">${entryFlagPill(e.id)}</td></tr>`;}).join('')||'<tr><td colspan="24"><div class="empty"><div class="empty-icon">⚙</div><div class="empty-text">✕ No entries yet — select a lot and start a stage entry</div></div></td></tr>';renderBevSoftReady();renderBevSoftPending();renderBevSoftFlagged();setTimeout(fitBevTableHeight,0);}

export async function approveEntry(id,type){
  // Jul 16 2026 — was a third, independent, still fully client-side
  // approval implementation (mutated State.DB directly, no server
  // involvement, no nudge call) that the REAL Soft-stage button actually
  // called — found while building the browser smoke test, not caught by
  // the earlier isolated migration of approveStageEntry/approveDyeLot/
  // approveWindEntry/approvePackEntry/approveDispatch, which turned out
  // to not be wired to this specific button at all. Confirmed via
  // exhaustive search that this function is never called with any type
  // other than 'stage' anywhere in the app — the wind/pack/dispatch/dye
  // branches this used to have were dead code, removed. Now delegates to
  // the already-migrated, already-tested approveStageEntry.
  if(type==='stage'){await approveStageEntry(id);return;}
  showToast('Unsupported approve type','err');
}

export async function rejectEntry(id,type){
try{
  const {ok,error,networkError}=await apiPost('/api/reject',{type,id,changedBy:State.currentUser?.name,role:State.currentUser?.role});
  if(networkError)throw new Error(error);
  if(!ok){showToast(error||'Reject failed','err');return;}
  await _refreshAndRender(['stageEntries'],renderAll);
}catch(e){showToast('Network error — '+e.message,'err');}
}

export async function approveStageEntry(id){
  try{
    const {ok,data,error,networkError}=await apiPost('/api/approve-entry',{type:'soft',id,changedBy:State.currentUser.name});
  if(networkError)throw new Error(error);
  if(!ok){showToast(error||'Could not approve','err');return;}
    showToast('Approved ✓');await _refreshAndRender(['stageEntries'],renderAll);
  }catch(e){showToast('Network error — not saved: '+e.message,'err');}
}

export async function executeClearStage(){const key=document.getElementById('clear-stage-key').value;const confirmText=document.getElementById('clear-stage-confirm-text').value.trim();const pwd=document.getElementById('clear-stage-password').value;const alertEl=document.getElementById('clear-stage-alert');if(confirmText!=='CONFIRM'){alertEl.innerHTML='<div class="alert alert-err" style="margin-bottom:10px">Type CONFIRM exactly</div>';return;}
// Jul 29 2026 fix — real, serious, confirmed vulnerability: this used to
// verify the password against ANY admin account (not necessarily the
// actual logged-in person), then wipe the table directly in the browser
// and push it through the generic save() path — which itself had no
// real protection against a whole-table wipe for operational data. Now
// goes through the new, dedicated, properly-locked-down server endpoint
// — still a genuine, permanent delete, exactly as intended, just with
// real protection around it this time.
const {ok,data,error,networkError}=await apiPost('/api/admin/clear-stage',{table:key,confirmText,password:pwd});
if(networkError){alertEl.innerHTML='<div class="alert alert-err" style="margin-bottom:10px">Network error — not cleared</div>';return;}
if(!ok){alertEl.innerHTML='<div class="alert alert-err" style="margin-bottom:10px">'+(error||'Could not clear')+'</div>';return;}
State.DB[key]=Array.isArray(State.DB[key])?[]:{};
closeModal('clear-stage-modal');showToast('✓ '+key+' cleared');renderAll();}

export function openStageModal(action){State.stageAction=action;const resetFields=['sf-lot-search','sf-in-units','sf-in-weight','sf-start-note','sf-out-units','sf-out-weight','sf-end-note'];resetFields.forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});const lotSel=document.getElementById('sf-lot-stage');if(lotSel){lotSel.value='';lotSel.size=1;}
const avail=document.getElementById('sf-avail');if(avail)avail.textContent='—';const ref=document.getElementById('stage-end-ref');if(ref)ref.style.display='none';const cnt=document.getElementById('sf-lot-count');if(cnt)cnt.textContent='';populateSelects();const t=document.getElementById('stage-modal-title');const btn=document.getElementById('stage-submit-btn');if(t)t.textContent=action==='Start'?'▶ Start Stage Entry':'End Stage Entry';if(btn)btn.textContent=action==='Start'?'Record Start':'Record End';renderStageForm();document.getElementById('stage-modal').classList.add('open');}

export function renderStageForm(){const body=document.getElementById('stage-form-body');if(!body)return;
// Aug 26 2026 — real, direct extension built via direct discussion with
// Priyam: shows only Soft's own real machines, but an untagged machine
// (added before this feature existed) still shows everywhere until
// someone tags it — so nothing breaks during that real transition.
// Aug 26 2026 — real, direct rebuild built via direct discussion with
// Priyam: machines now genuinely live in their own, separate list per
// stage, matching exactly how Vendors already works — this reads
// directly from Soft's own real list, no filtering needed at all.
const M=machinesForStage('Soft');
const W=workersSorted();const _sfWorkerCur=State.currentUser?.name||'';const mOpts=`<option value="">Select</option>${M.map(v=>`<option value="${v}">${v}</option>`).join('')}`;const wOpts=`<option value="">Select</option>${W.map(v=>`<option value="${v}"${v===_sfWorkerCur?'selected':''}>${v}</option>`).join('')}`;if(State.stageAction==='Start'){const STAGES=['Soft','Wind','Pack'];let lotStageOpts='<optgroup label="Soft">';lotsForStage('Soft').forEach(l=>lotStageOpts+=`<option value="${l.id}||Soft||${l.grade}||${l.vendor}">${l.id} — ${l.grade} — ${l.vendor} (${fmt(getRMBalance(l.id,l.grade,l.vendor).units)} bags / ${fmt(getRMBalance(l.id,l.grade,l.vendor).weight)}kg avail)</option>`);body.innerHTML=`
      <div class="fg" style="grid-column:1/-1"><label class="fl">Lot + Stage *</label><input type="text" class="fs" id="sf-lot-search" placeholder="Search by Lot ID, Grade or Vendor..." oninput="filterLotOpts()" autocomplete="off"
          style="margin-bottom:4px;"><select class="fs" id="sf-lot-stage" onchange="updateStageAvail()" size="1" style="height:auto;"><option value="">— type above to search —</option>${lotStageOpts}</select><div style="font-size:0.68rem;color:var(--mu);margin-top:2px;" id="sf-lot-count"></div></div><div class="fg" style="grid-column:1/-1;background:var(--s2);border-radius:7px;padding:9px 12px;font-size:0.78rem;color:var(--tx);" id="sf-avail-banner"><span style="color:var(--mu)">Available from previous stage</span><span id="sf-avail" class="mono" style="color:var(--mu)"> — select lot</span></div><div class="fg"><label class="fl">In Bags *</label><input class="fi" id="sf-in-units" type="number" placeholder="0"></div><div class="fg"><label class="fl">In Weight (kg) *</label><input class="fi" id="sf-in-weight" type="number" placeholder="0"></div><div class="fg"><label class="fl">Machine</label><select class="fs" id="sf-machine">${mOpts}</select></div><div class="fg"><label class="fl">Your Name (Start Worker)</label><select class="fs" id="sf-worker">${wOpts}</select></div><div class="fg" style="grid-column:1/-1"><label class="fl">Note (optional)</label><input class="fi" id="sf-start-note" placeholder="e.g. Machine running slow, material condition, special instructions..."></div>
    ${specialMaterialSectionHTML('sf-ds-select','fg','fl','<div class="fg fg-full" style="grid-column:1/-1;border-top:1px solid var(--b1);padding-top:12px;margin-top:4px">','</div>')}
    `;}else{const inProg=State.DB.stageEntries.filter(e=>e.status==='InProgress');if(!inProg.length){body.innerHTML='<div class="alert alert-warn" style="grid-column:1/-1">No in-progress entries. Workers must Start a stage first.</div>';return;}
const ipOpts=inProg.map(e=>`<option value="${e.id}">${e.lotId} — ${e.stage} — ${fmt(e.inUnits)}b — started ${fmtTS(e.startTime)}</option>`).join('');const autoSelect=inProg.length===1?inProg[0].id:'';body.innerHTML=`
      <div class="fg" style="grid-column:1/-1"><label class="fl">In-Progress Entry to End *</label><select class="fs" id="sf-ip-id" onchange="showStageEndRef()"><option value="">Select</option>${ipOpts}</select></div><div id="stage-end-ref" style="grid-column:1/-1;display:none;background:var(--s2);border:1px solid var(--b2);border-radius:9px;padding:14px;margin-bottom:4px;"></div><div class="fg"><label class="fl">Out Bags *</label><input class="fi" id="sf-out-units" type="number" placeholder="0"></div><div class="fg"><label class="fl">Out Weight (kg) *</label><input class="fi" id="sf-out-weight" type="number" placeholder="0"></div><div class="fg" style="grid-column:1/-1"><label class="fl">Note (optional)</label><input class="fi" id="sf-end-note" placeholder="e.g. Output quality observation, issues noticed, wastage reason..."></div>`;if(autoSelect){setTimeout(()=>{const sel=document.getElementById('sf-ip-id');if(sel){sel.value=autoSelect;showStageEndRef();}},50);}}}

export function setWasteStage(val){window._wasteStage=val;rptWaste();}

export function showStageEndRef(){const id=document.getElementById('sf-ip-id')?.value;const ref=document.getElementById('stage-end-ref');const outEl=document.getElementById('sf-out-units');const outWEl=document.getElementById('sf-out-weight');if(!ref)return;if(!id){ref.style.display='none';return;}
const e=State.DB.stageEntries.find(x=>x.id===id);if(!e){ref.style.display='none';return;}
const elapsed=hrsBetween(e.startTime,new Date().toISOString());const SCOL={Soft:'var(--cs)',Dye:'var(--cd)',Wind:'var(--cw)',Pack:'var(--cp)'};const stageColor=SCOL[e.stage]||'var(--ac)';ref.style.display='block';ref.innerHTML=`
    <div style="font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:${stageColor};margin-bottom:10px;">
      📋 Start Reference — ${e.stage} Stage
    </div><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px;"><div><div style="font-size:.58rem;color:var(--mu);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">Lot / Grade</div><div style="font-size:.82rem;font-weight:700;color:#fff">${e.lotId}</div><div style="font-size:.65rem;color:var(--mu)">${e.grade||''}</div></div><div><div style="font-size:.58rem;color:var(--mu);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">Input Loaded</div><div style="font-size:.9rem;font-weight:700;color:var(--bl)">${fmt(e.inUnits)}b / ${fmt(e.inWeight)}kg</div></div><div><div style="font-size:.58rem;color:var(--mu);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">Running Time</div><div style="font-size:.9rem;font-weight:700;color:var(--cy)">${fmtHrs(elapsed)}</div><div style="font-size:.65rem;color:var(--mu)">since ${fmtTS(e.startTime)}</div></div></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;padding-top:8px;border-top:1px solid var(--b1);"><div><div style="font-size:.58rem;color:var(--mu);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">Machine</div><div style="font-size:.78rem;font-weight:600">${e.machine||'—'}</div></div><div><div style="font-size:.58rem;color:var(--mu);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">Started By</div><div style="font-size:.78rem;font-weight:600">${e.startWorker||'—'}</div></div></div><div style="margin-top:8px;padding:7px 10px;background:rgba(59,130,246,.08);border-radius:5px;font-size:.7rem;color:var(--bl);">
      ℹ Output cannot exceed <strong>${fmt(e.inUnits)}b / ${fmt(e.inWeight)}kg</strong></div>`;if(outEl){outEl.max=e.inUnits;outEl.placeholder=`0 – ${fmt(e.inUnits)}`;}
if(outWEl){outWEl.max=e.inWeight;outWEl.placeholder=`0 – ${fmt(e.inWeight)}`;}}

export async function submitStageEntry(){
  // Jul 14 2026 — Item I cutover (first of the remaining 5 flows). All
  // validation, WIP-claim math, atomic ID generation, and the write now
  // live in worker.js (POST /api/stage/start, /api/stage/end).
  clearAlerts();
  if(State.stageAction==='Start'){
    const v=document.getElementById('sf-lot-stage')?.value;if(!v){setAlert('stage-alert','Select Lot & Stage','alert-err');return;}
    const _svParts=v.split('||');const lotId=_svParts[0];const stage=_svParts[1];const _svGrade=_svParts[2]||'';const _svVendor=_svParts[3]||'';
    const inU=parseFloat(document.getElementById('sf-in-units')?.value)||0;const inW=parseFloat(document.getElementById('sf-in-weight')?.value)||0;
    const machine=document.getElementById('sf-machine')?.value;const worker=document.getElementById('sf-worker')?.value||State.currentUser?.name;const startNote=document.getElementById('sf-start-note')?.value.trim()||'';
    if(!inU){setAlert('stage-alert','Enter input units','alert-err');return;}
    if(!inW||inW<=0){setAlert('stage-alert','Enter input weight (kg)','alert-err');return;}
    if(!checkDuplicateInProgress(lotId,stage))return;
    const _sfBtn=document.getElementById('stage-submit-btn');if(_sfBtn)_sfBtn.disabled=true;
    const _ssL=getLotByKey(lotId,_svGrade,_svVendor)||getLot(lotId);
    const _dsId=document.getElementById('sf-ds-select')?.value||null;
    try{
      const {ok,data,error,networkError}=await _postWithDuplicateCheck('/api/stage/start',{lotId,grade:_ssL.grade||_svGrade,vendor:_ssL.vendor||_svVendor,inUnits:inU,inWeight:inW,machine,worker,startNote,deadStockId:_dsId,changedBy:State.currentUser.name,idempotencyKey:crypto.randomUUID()});
  if(networkError)throw new Error(error);
  if(!ok){if(error!=='__cancelled_by_user__')setAlert('stage-alert',error||'Failed to start entry','alert-err');if(_sfBtn)_sfBtn.disabled=false;return;}
      if(_sfBtn)_sfBtn.disabled=false;closeModal('stage-modal');showToast('Soft entry started \u2713');await _refreshAndRender(['stageEntries'],renderAll);
    }catch(e){setAlert('stage-alert','Network error \u2014 not saved: '+e.message,'alert-err');if(_sfBtn)_sfBtn.disabled=false;}
  }else{
    const ipId=document.getElementById('sf-ip-id')?.value;if(!ipId){setAlert('stage-alert','Select in-progress entry','alert-err');return;}
    const outU=parseFloat(document.getElementById('sf-out-units')?.value)||0;const outW=parseFloat(document.getElementById('sf-out-weight')?.value)||0;const endNote=document.getElementById('sf-end-note')?.value.trim()||'';
    if(!outU){setAlert('stage-alert','Enter output units','alert-err');return;}
    const _sfBtn2=document.getElementById('stage-submit-btn');if(_sfBtn2)_sfBtn2.disabled=true;
    try{
      const {ok,data,error,networkError}=await apiPost('/api/stage/end',{id:ipId,outUnits:outU,outWeight:outW,endNote,changedBy:State.currentUser.name,idempotencyKey:crypto.randomUUID()});
  if(networkError)throw new Error(error);
  if(!ok){setAlert('stage-alert',error||'Failed to end entry','alert-err');if(_sfBtn2)_sfBtn2.disabled=false;return;}
      if(_sfBtn2)_sfBtn2.disabled=false;closeModal('stage-modal');showToast('Soft entry completed \u2713');await _refreshAndRender(['stageEntries'],renderAll);
    }catch(e){setAlert('stage-alert','Network error \u2014 not saved: '+e.message,'alert-err');if(_sfBtn2)_sfBtn2.disabled=false;}
  }
}

export function updateStageAvail(){const v=document.getElementById('sf-lot-stage')?.value;
const banner=document.getElementById('sf-avail-banner');
if(!v){if(banner)banner.innerHTML='<span style="color:var(--mu)">Available from previous stage</span><span id="sf-avail" class="mono" style="color:var(--mu)">— select lot</span>';return;}
const parts=v.split('||');const lotId=parts[0];const stage=parts[1];const grade=parts[2]||'';const vendor=parts[3]||'';
const _saL=getLotByKey(lotId,grade,vendor)||getLot(lotId);
const bal=stageBalance(lotId,stage,_saL.grade,_saL.vendor);
const balColor=bal.units>0?'var(--gr)':'var(--re)';
if(banner)banner.innerHTML=`<strong>${lotId}</strong> — ${grade||_saL.grade||'—'} · ${vendor||_saL.vendor||'—'}<br><span style="color:var(--mu);font-size:0.72rem">Stage: ${stage}</span><br>Available: <strong style="color:${balColor}">${fmt(bal.units)} bags / ${fmt(bal.weight)}kg</strong>`;}

export function wJumpStage(stage){const card=document.querySelector(`#wv-body .wstage-card[data-stage="${stage}"]`);if(card)card.scrollIntoView({behavior:'smooth',block:'start'});document.querySelectorAll('[id^="wjmp-"]').forEach(btn=>{const isActive=btn.id===`wjmp-${stage}`;btn.style.background=isActive?'var(--ac)':'var(--s2)';btn.style.color=isActive?'#000':'var(--tx)';});}

export function workerStageForm(stage,mOpts,wOpts=''){const inProg=State.DB.stageEntries.filter(e=>e.stage===stage&&e.status==='InProgress');const eligible=lotsForStage(stage);const lotOpts=eligible.map(l=>{const bal=stageBalance(l.id,stage,l.grade,l.vendor);return`<option value="${l.id}||${l.grade}||${l.vendor}">${l.id} — ${l.grade} — ${l.vendor} (${fmt(bal.units)}b avail)</option>`;}).join('');const ipOpts=inProg.map(e=>`<option value="${e.id}">${e.lotId} — ${fmt(e.inUnits)}b started ${fmtTS(e.startTime)}</option>`).join('');return`<div class="wstage-card" data-stage="${stage}" style="border-color:${stageColor(stage)}20"><div class="wstage-hdr"><div class="wstage-icon">${stageIcon(stage)}</div><div><div class="wstage-name">${stage}</div><div class="wstage-sub">Start = input quantity | End = output quantity</div></div></div><div id="w-${stage}-alert"></div><div class="tabs" style="margin-bottom:12px;"><div class="tab active" onclick="wSwitchTab('${stage}','start',this)">▶ Start</div><div class="tab" onclick="wSwitchTab('${stage}','end',this)">End</div></div><div id="w-${stage}-start-tab"><div class="wavail"><span class="wavail-label">Select lot to see available</span></div><div class="wfield"><label>Lot *</label><select id="w-${stage}-lot-start" onchange="wUpdateAvail('${stage}')"><option value="">— ${eligible.length?'Select Lot':'No lots ready for '+stage} —</option>${lotOpts}
        </select></div><div id="w-${stage}-avail-start" class="wavail" style="display:none"><span class="wavail-label">Available</span><span class="wavail-val" style="color:var(--gr)">—</span></div><div class="w2col"><div class="wfield"><label>In Bags *</label><input id="w-${stage}-in-u" type="number" placeholder="0"></div><div class="wfield"><label>In Weight (kg)</label><input id="w-${stage}-in-w" type="number" placeholder="0"></div></div><div class="wfield"><label>Machine</label><select id="w-${stage}-mach-start">${mOpts}</select></div>
      ${wOpts?`<div class="wfield"><label>Worker*</label><select id="w-${stage}-worker-start">${wOpts}</select></div>`:''}
      ${stage==='Soft'?`<div class="wfield"><label>Note (optional)</label><input class="winp" id="w-${stage}-start-note" placeholder="e.g. Machine running slow, material condition..."></div>${specialMaterialSectionHTML(`w-${stage}-ds-select`,'wfield','',`<div style="border-top:1px solid var(--b1);padding-top:10px;margin-top:8px">`,'</div>')}`:''}
      <button class="wsubmit" id="w-start-btn-${stage}" onclick="wSubmitStart('${stage}')">▶ Record Start</button></div><div id="w-${stage}-end-tab" style="display:none;">
      ${inProg.length
        ? `<div class="wfield"><label>Select In-Progress Entry*</label><select id="w-${stage}-ip"onchange="wShowEndRef('${stage}')"><option value="">Select entry</option>${ipOpts}</select></div><div id="w-${stage}-ref"style="display:none;background:var(--s2);border:1px solid var(--b2);border-radius:9px;padding:12px;margin-bottom:10px;"></div>`
        : '<div class="walert info">No in-progress entries for this stage. Start one first.</div>'}
      <div class="w2col"><div class="wfield"><label>Out Bags *</label><input id="w-${stage}-out-u" type="number" placeholder="0"></div><div class="wfield"><label>Out Weight (kg)</label><input id="w-${stage}-out-w" type="number" placeholder="0"></div></div>
      ${stage==='Soft'?`<div class="wfield"><label>Note (optional)</label><input class="winp" id="w-${stage}-end-note" placeholder="e.g. Output quality observation, wastage reason..."></div>`:''}
      <button class="wsubmit" onclick="wSubmitEnd('${stage}')">Record End</button></div></div>`;}

export function openResidualTransferModal(){
  if(State.currentUser?.role!=='admin'&&State.currentUser?.role!=='manager'&&State.currentUser?.role!=='supervisor'){showToast('No permission','err');return;}
  const combos=[];
  const seen=new Set();
  (State.DB.lots||[]).forEach(l=>{
    const key=l.id+'||'+l.grade+'||'+l.vendor;
    if(seen.has(key))return;
    seen.add(key);
    const avail=getSoftBalanceWeightAvailable(l.id,l.grade,l.vendor);
    if(avail>0.01){
      const softOut=getSoftOut(l.id,l.grade,l.vendor);
      const bagsAvail=softOut.weight>0?Math.round((softOut.units||0)*(avail/softOut.weight)):0;
      combos.push({lotId:l.id,grade:l.grade,vendor:l.vendor,avail,bagsAvail});
    }
  });
  combos.sort((a,b)=>a.avail-b.avail);
  const sel=document.getElementById('rt-combo');
  if(!sel)return;
  if(!combos.length){
    sel.innerHTML='<option value="">No Soft balance available</option>';
  }else{
    sel.innerHTML='<option value="">Select lot + grade + vendor...</option>'+
      combos.map(c=>`<option value="${c.lotId}||${c.grade}||${c.vendor}" data-bags="${c.bagsAvail}">${c.lotId} — ${c.grade} — ${c.vendor} (${fmt(c.avail)}kg / ${c.bagsAvail}b avail)</option>`).join('');
  }
  document.getElementById('rt-weight').value='';
  document.getElementById('rt-weight').max='';
  document.getElementById('rt-reason').value='';
  document.getElementById('rt-type').value='residual';
  document.getElementById('rt-alert').innerHTML='';
  document.getElementById('rt-info').innerHTML='';
  openModal('residual-transfer-modal-overlay');
}

window.approveEntry = approveEntry;
window.rejectEntry = rejectEntry;
window.executeClearStage = executeClearStage;
window.openStageModal = openStageModal;
window.setWasteStage = setWasteStage;
window.showStageEndRef = showStageEndRef;
window.submitStageEntry = submitStageEntry;
window.updateStageAvail = updateStageAvail;
window.wJumpStage = wJumpStage;
window.openResidualTransferModal = openResidualTransferModal;
