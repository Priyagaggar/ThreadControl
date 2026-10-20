// dispatch.js — Dispatch page: entry table, modal, filters.
// Aug 6 2026 — Phase 1, Step 20 of the module-split plan. Extracted byte-
// for-byte from pages.js. Real inventory: 10 functions. renderApprovalDispatch
// correctly excluded (Approval page's own concern). renderDashPartyDispatch
// correctly excluded — genuinely a Dashboard widget (targets
// #dash-party-dispatch), not Dispatch's own page. Confirmed: Dispatch has
// no Worker View mobile form (0 matches for workerDispatchForm-style
// functions) — unlike RM/Soft/Dye/Wind/Pack, this stage is approval/admin
// only, no floor-worker mobile entry.

export function buildDispRefPanel(dyeLotId){
  const dLot=(State.DB.dyeLots||[]).find(d=>d.id===dyeLotId);
  if(!dLot)return'';
  const grades=(dLot.sources||[]).map(s=>s.grade).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join('+');
  const pb=getPackBalAvailable(dyeLotId);
  const disp=getTotalDispatched(dyeLotId);
  const packed=getTotalPacked(dyeLotId);
  const avColor=pb.units>0?'var(--gr)':'var(--re)';
  return`<div style="background:var(--s2);border-radius:7px;padding:9px 12px;font-size:0.78rem;color:var(--tx);">
    <strong>${dLot.dyeLotNo}</strong> — ${dLot.shade||'—'}<br>
    <span style="color:var(--mu);font-size:0.72rem">Grade: ${grades||'—'}</span><br>
    <div style="display:flex;gap:16px;margin-top:6px;flex-wrap:wrap;">
      <span style="font-size:0.72rem;color:var(--mu)">Packed: <strong style="color:var(--tx)">${packed.bags}b / ${fmt(packed.weight)}kg</strong></span>
      <span style="font-size:0.72rem;color:var(--mu)">Dispatched: <strong style="color:var(--ye)">${disp.bags}b / ${fmt(disp.weight)}kg</strong></span>
      <span style="font-size:0.72rem;color:var(--mu)">Available: <strong style="color:${avColor}">${pb.units}b / ${fmt(pb.weight)}kg</strong></span>
    </div>
  </div>`;
}

import { State, _sortState, apiPost, fmt, fmtTS, showToast, openModal, getPackBalAvailable, setAlert, closeModal, getTotalDispatched, getTotalPacked, today, _refreshAndRender, eligibleDispatchLots } from './core.js';
import { _restoreFilterBtns, buildColFilter, buildDyeLotSearch, entryRowClass, fitBevTableHeight, sortArr, sortTh, statusBadge, renderBevDispReady, renderBevDispFlagged } from './shared.js';
import { renderAll, entryFlagPill } from './pages.js';
import { populatePartySelect } from './party.js';
import { updateOrderStatuses } from './party.js';

export function renderDispatch(){const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';const isSup=State.currentUser?.role==='supervisor'||isAdmin;const fl=document.getElementById('dispf-lot')?.value||'';const fp=document.getElementById('dispf-party')?.value||'';const fs=document.getElementById('dispf-shade')?.value||'';const fg=document.getElementById('dispf-grade')?.value||'';const fi=document.getElementById('dispf-invoice')?.value||'';const allDisp=State.DB.dispatches||[];const allDye=State.DB.dyeLots||[];const getEff=d=>{const rdl=allDye.find(dl=>dl.id===d.dyeLotId);return{lot:d.dyeLotNo||rdl?.dyeLotNo||'',shade:d.shade||rdl?.shade||'',grade:d.grade||'',party:d.party||''};};const dlots=[...new Set(allDisp.filter(d=>{const eff=getEff(d);return(!fp||eff.party===fp)&&(!fs||eff.shade===fs)&&(!fg||eff.grade===fg)&&(!fi||(d.invoiceNo||'')===fi);}).map(d=>getEff(d).lot).filter(Boolean))].sort((a,b)=>b.localeCompare(a));const dparties=[...new Set(allDisp.filter(d=>{const eff=getEff(d);return(!fl||eff.lot===fl)&&(!fs||eff.shade===fs)&&(!fg||eff.grade===fg)&&(!fi||(d.invoiceNo||'')===fi);}).map(d=>getEff(d).party).filter(Boolean))].sort();const dshades=[...new Set(allDisp.filter(d=>{const eff=getEff(d);return(!fl||eff.lot===fl)&&(!fp||eff.party===fp)&&(!fg||eff.grade===fg)&&(!fi||(d.invoiceNo||'')===fi);}).map(d=>getEff(d).shade).filter(Boolean))].sort();const dgrades=[...new Set(allDisp.filter(d=>{const eff=getEff(d);return(!fl||eff.lot===fl)&&(!fp||eff.party===fp)&&(!fs||eff.shade===fs)&&(!fi||(d.invoiceNo||'')===fi);}).map(d=>getEff(d).grade).filter(Boolean))].sort();const dinvoices=[...new Set(allDisp.filter(d=>{const eff=getEff(d);return(!fl||eff.lot===fl)&&(!fp||eff.party===fp)&&(!fs||eff.shade===fs)&&(!fg||eff.grade===fg);}).map(d=>d.invoiceNo||'').filter(Boolean))].sort();const dstatuses=[...new Set(allDisp.map(d=>d.status).filter(Boolean))].sort();const _th=document.getElementById('disp-thead');if(_th){_th.innerHTML=`
      <tr class="tbl-filter-row"><th>${buildColFilter(dparties,'dispf-party','Party')}</th><th>${buildDyeLotSearch('dispf-lot','dispf-lot-xbtn','dispf')}</th><th>${buildColFilter(dshades,'dispf-shade','Shade')}</th><th>${buildColFilter(dgrades,'dispf-grade','Grade')}</th><th></th><th></th><th>${buildColFilter(dinvoices,'dispf-invoice','Invoice')}</th><th></th><th></th><th>${buildColFilter(dstatuses,'dispf-status','Status')}</th><th></th></tr><tr>
        ${sortTh('disp','party','Party')}
        ${sortTh('disp','dyeLotNo','Dye Lot')}
        ${sortTh('disp','shade','Shade')}
        ${sortTh('disp','grade','Grade')}
        ${sortTh('disp','bags','Bags')}
        ${sortTh('disp','weight','Weight')}
        ${sortTh('disp','invoiceNo','Invoice')}
        ${sortTh('disp','timestamp','Date/Time')}
        ${sortTh('disp','by','By')}
        ${sortTh('disp','status','Status')}
        <th>Actions</th><th>Flag</th></tr>`;if(fl)document.getElementById('dispf-lot').value=fl;if(fp)document.getElementById('dispf-party').value=fp;if(fs)document.getElementById('dispf-shade').value=fs;if(fg)document.getElementById('dispf-grade').value=fg;if(fi)document.getElementById('dispf-invoice').value=fi;_restoreFilterBtns('dispf-lot','dispf-party','dispf-shade','dispf-grade','dispf-invoice','dispf-status');}
let filtered=(State.DB.dispatches||[]).filter(d=>{const _rDl=(State.DB.dyeLots||[]).find(dl=>dl.id===d.dyeLotId);const _rNo=d.dyeLotNo||_rDl?.dyeLotNo||'';const _rSh=d.shade||_rDl?.shade||'';return(!fl||_rNo===fl)&&(!fp||d.party===fp)&&(!fs||_rSh===fs)&&(!fg||d.grade===fg)&&(!fi||(d.invoiceNo||'')===fi);});const sorted=_sortState.disp?.col?sortArr(filtered,_sortState.disp.col,_sortState.disp.dir):[...filtered].sort((a,b)=>(b.timestamp||'').localeCompare(a.timestamp||''));const tbody=document.getElementById('disp-tbody');if(!tbody)return;if(!sorted.length){tbody.innerHTML='<tr><td colspan="13"><div class="empty"><div class="empty-icon">&#x1F69A;</div><div class="empty-text">✕ No dispatches yet — pack a lot first</div></div></td></tr>';return;}
tbody.innerHTML=sorted.map(d=>{const _dlRef=(State.DB.dyeLots||[]).find(dl=>dl.id===d.dyeLotId);const dyeLotNo=d.dyeLotNo||_dlRef?.dyeLotNo||'&#x2014;';const shade=d.shade||_dlRef?.shade||'';const bags=d.bags||d.units||0;const sC={Approved:'var(--gr)',Pending:'var(--ye)',Rejected:'var(--re)'}[d.status]||'var(--mu)';const _dsc=entryRowClass(d.status);return`<tr class="${_dsc}">
<td style="vertical-align:top;font-weight:600;cursor:pointer;color:var(--ac)" onclick="navToParty(this)" data-party="${(d.party||'').replace(/"/g,'&quot;')}">${d.party||'&#x2014;'}</td>
<td class="mono" style="vertical-align:top;color:var(--ac);font-weight:700;cursor:pointer" onclick="openDyeLifecycle('${d.dyeLotId||''}')">${dyeLotNo}</td>
<td style="vertical-align:top;font-size:0.75rem;font-weight:600">${shade||'&#x2014;'}</td>
<td style="vertical-align:top">${d.grade&&d.grade!=='—'?'<span class="badge b-rm">'+d.grade+'</span>':'&#x2014;'}</td>
<td class="mono" style="vertical-align:top;color:var(--ac);font-weight:700">${fmt(bags)}b</td>
<td class="mono" style="vertical-align:top;font-weight:700">${fmt(d.weight)}kg</td>
<td class="mono" style="vertical-align:top;font-size:0.7rem;color:${d.invoiceNo?'var(--ac)':'var(--mu)'}">${d.invoiceNo||'&#x2014;'}</td>
<td class="mono" style="vertical-align:top;font-size:0.65rem">${fmtTS(d.timestamp)}</td>
<td style="vertical-align:top;font-size:0.72rem">${d.by||'&#x2014;'}</td>
<td style="vertical-align:top">${statusBadge(d.status)}</td>
<td style="vertical-align:top;display:flex;gap:4px;">
${(d.status==='Pending'||d.status==='Edited-Pending')&&(isSup||isAdmin)?`<button class="btn btn-success btn-xs tc-tip" data-tip="Approve" onclick="approveDispatch('${d.id}')">✓</button><button class="btn btn-danger btn-xs tc-tip" data-tip="Reject" onclick="rejectDispatch('${d.id}')">✗</button>`:''}
${(d.status==='Approved'||d.status==='Edited-Approved')&&isAdmin?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Edit" onclick="openEditEntryModal('${d.id}','dispatch')">✏</button><button class="btn btn-ghost btn-xs tc-tip" data-tip="Void" style="color:var(--re)" onclick="openVoidEntry('${d.id}','dispatch')">🗑</button>`:''}
${(d.status==='Rejected'||d.status==='Voided')&&isAdmin?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Override" onclick="openOverride('${d.id}','dispatch')">⚡</button><button class="btn btn-ghost btn-xs tc-tip" data-tip="Void" style="color:var(--re)" onclick="openVoidEntry('${d.id}','dispatch')">🗑</button>`:''}
${(isSup||isAdmin)&&!d.orderId?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Link to Order" style="color:var(--re)" onclick="openLinkOrder('${d.id}')">🔗</button>`:''}
</td>
<td style="vertical-align:top">${entryFlagPill(d.id)}</td>
</tr>`;
}).join('');renderBevDispReady();renderBevDispFlagged();setTimeout(fitBevTableHeight,0);}

export function addDispatchLotRow(){if(!window._dispLotRows)window._dispLotRows=[];window._dispLotRows.push({dyeLotId:'',grade:'',bags:'',weight:''});renderDispatchLotRows();}

export async function approveDispatch(id){
  try{
    const {ok,data,error,networkError}=await apiPost('/api/approve-entry',{type:'dispatch',id,changedBy:State.currentUser.name});
  if(networkError)throw new Error(error);
  if(!ok){showToast(error||'Could not approve','err');return;}
    updateOrderStatuses();showToast('Dispatch approved ✓');await _refreshAndRender(['dispatches'],renderAll);
  }catch(e){showToast('Network error — not saved: '+e.message,'err');}
}

export function checkDispatchApproved(entry,stage){if(stage==='pack'||stage==='wind'){const dyeLotId=entry.dyeLotId;return(State.DB.dispatches||[]).some(d=>d.dyeLotId===dyeLotId&&(d.status==='Approved'||d.status==='Edited-Approved'));}
return false;}

export function openDispatchModal(){document.getElementById('disp-alert').innerHTML='';const dateEl=document.getElementById('m-disp-date');const invoiceEl=document.getElementById('m-disp-invoice');if(dateEl)dateEl.value=today();if(invoiceEl)invoiceEl.value='';populatePartySelect();window._dispLotRows=[];renderDispatchLotRows();addDispatchLotRow();openModal('dispatch-modal');}

export async function rejectDispatch(id){try{const {ok,error,networkError}=await apiPost('/api/reject',{type:'dispatch',id,changedBy:State.currentUser?.name,role:State.currentUser?.role});if(networkError)throw new Error(error);if(!ok){showToast(error||'Reject failed','err');return;}showToast('Dispatch rejected','err');await _refreshAndRender(['dispatches'],renderAll);}catch(e){showToast('Network error — '+e.message,'err');}}

export function removeDispatchLotRow(i){if(!window._dispLotRows)return;window._dispLotRows.splice(i,1);renderDispatchLotRows();}

export function renderDispatchLotRows(){const container=document.getElementById('disp-lots-container');if(!container)return;const rows=window._dispLotRows||[];if(!rows.length){container.innerHTML='';updateDispatchTotal();return;}
const availLots=eligibleDispatchLots();const lotOpts=`<option value="">Select Dye Lot...</option>`+availLots.map(d=>{const grades=(d.sources||[]).map(s=>s.grade).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join('+');const pb=getPackBalAvailable(d.id);return`<option value="${d.id}">${d.dyeLotNo} — ${d.shade} [${grades}] (${pb.units}b / ${fmt(pb.weight)}kg avail)</option>`;}).join('');container.innerHTML=rows.map((row,i)=>`
    <div style="background:var(--s2);border-radius:9px;padding:12px;margin-bottom:8px;" id="disp-row-${i}"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><span style="font-size:0.7rem;font-weight:700;color:var(--mu);text-transform:uppercase;">Lot ${i+1}</span>
        ${rows.length>1?`<button class="btn btn-ghost btn-xs"style="color:var(--re)"onclick="removeDispatchLotRow(${i})">✕ Remove</button>`:''}
      </div><div class="fgrid"><div class="fg"><label class="fl">Dye Lot *</label>
            <input class="fi" placeholder="Type to search lot..." style="margin-bottom:4px"
              oninput="(function(q){const sel=document.querySelector('#disp-row-${i} select');if(!sel)return;Array.from(sel.options).forEach(o=>{o.style.display=(!q||o.text.toLowerCase().includes(q.toLowerCase()))?'':'none'});sel.size=q?Math.min(5,sel.options.length):1})(this.value)">
            <select class="fs" size="1" onchange="onDispLotChange(${i},this.value)">
            ${lotOpts.replace(`value="${row.dyeLotId}"`,`value="${row.dyeLotId}"selected`)}
          </select></div><div class="fg"><label class="fl">Grade (auto)</label><input class="fi" readonly value="${row.grade||''}"></div></div>
      ${row.dyeLotId ? `<div style="background:var(--s1);border:1px solid var(--b2);border-radius:7px;padding:12px;margin:8px 0;"id="disp-ref-${i}">${buildDispRefPanel(row.dyeLotId)}</div>` : ''}
      <div class="fgrid"><div class="fg"><label class="fl">Bags *</label><input class="fi" type="number" placeholder="0" value="${row.bags||''}" oninput="onDispRowInput(${i},'bags',this.value)"></div><div class="fg"><label class="fl">Weight (kg) *</label><input class="fi" type="number" placeholder="${row.dyeLotId?'0 – '+fmt(getPackBalAvailable(row.dyeLotId).weight):'0'}" value="${row.weight||''}" oninput="onDispRowInput(${i},'weight',this.value)"></div></div></div>`).join('');updateDispatchTotal();}

export async function submitDispatch(){
  // Jul 14 2026 — Item I cutover (Dispatch). All validation, the own-claim
  // per-row deduction, Party Order allocation, and the write now live in
  // worker.js (POST /api/dispatch).
  const party=document.getElementById('m-disp-party').value;const date=document.getElementById('m-disp-date').value;const invoiceNo=(document.getElementById('m-disp-invoice')?.value||'').trim();const rows=window._dispLotRows||[];
  if(!party){setAlert('disp-alert','Select party','alert-err');return;}
  if(!date){setAlert('disp-alert','Select date','alert-err');return;}
  if(!invoiceNo){setAlert('disp-alert','Enter invoice / challan no.','alert-err');return;}
  if(!rows.length){setAlert('disp-alert','Add at least one lot','alert-err');return;}
  for(let i=0;i<rows.length;i++){const r=rows[i];if(!r.dyeLotId){setAlert('disp-alert',`Lot ${i+1}: Select a dye lot`,'alert-err');return;}
    const bags=parseInt(r.bags)||0;const weight=parseFloat(r.weight)||0;if(bags<=0){setAlert('disp-alert',`Lot ${i+1}: Enter bags count`,'alert-err');return;}
    if(weight<=0){setAlert('disp-alert',`Lot ${i+1}: Enter weight`,'alert-err');return;}}
  const _dispDupLots=Array.from(new Set(rows.map(r=>r.dyeLotId)));
  for(const _dlId of _dispDupLots){const _dDup=(State.DB.dispatches||[]).find(d=>d.dyeLotId===_dlId&&d.status==='Pending');if(_dDup){if(!confirm(`\u26a0 ${_dlId} already has a Dispatch entry PENDING approval\nSubmitted: ${fmtTS(_dDup.timestamp)} by ${_dDup.by||'?'}\n\nAdd another dispatch for this lot anyway?`))return;}}
  const _dpBtn=document.getElementById('dispatch-submit-btn');if(_dpBtn)_dpBtn.disabled=true;
  const cleanRows=rows.map(r=>({dyeLotId:r.dyeLotId,bags:parseInt(r.bags)||0,weight:parseFloat(r.weight)||0,grade:r.grade||''}));
  try{
    const {ok,data,error,networkError}=await apiPost('/api/dispatch',{party,date,invoiceNo,rows:cleanRows,changedBy:State.currentUser.name,idempotencyKey:crypto.randomUUID()});
  if(networkError)throw new Error(error);
  if(!ok){setAlert('disp-alert',error||'Failed to save dispatch','alert-err');if(_dpBtn)_dpBtn.disabled=false;return;}
    if(_dpBtn)_dpBtn.disabled=false;closeModal('dispatch-modal');showToast(`${data.count} dispatch${data.count>1?'es':''} saved \u2713 \u2014 pending approval`);await _refreshAndRender(['dispatches'],renderAll);
  }catch(e){setAlert('disp-alert','Network error \u2014 not saved: '+e.message,'alert-err');if(_dpBtn)_dpBtn.disabled=false;}
}

export function updateDispatchTotal(){const rows=window._dispLotRows||[];const totB=rows.reduce((a,r)=>a+(parseInt(r.bags)||0),0);const totW=rows.reduce((a,r)=>a+(parseFloat(r.weight)||0),0);const bar=document.getElementById('disp-total-bar');const disp=document.getElementById('disp-total-display');if(bar)bar.style.display=rows.length>1?'flex':'none';if(disp)disp.textContent=`${totB}b / ${fmt(totW)}kg`;}

window.addDispatchLotRow = addDispatchLotRow;
window.approveDispatch = approveDispatch;
window.openDispatchModal = openDispatchModal;
window.rejectDispatch = rejectDispatch;
window.removeDispatchLotRow = removeDispatchLotRow;
window.submitDispatch = submitDispatch;
