// lifecycle.js — Lot Lifecycle page (RM -> Soft -> Dye progress detail view).
// Aug 6 2026 — Phase 1, Step 11 of the module-split plan. Extracted byte-for-
// byte from pages.js. Real inventory: renderLifecycle, _renderLifecycleCore.
// Two cross-page references (openDyeLifecycle, already exported from the
// Challan step; toggleLCStage, newly exported) — imported below. Real
// external caller too: stock.js's renderRMStock builds an onclick string
// calling renderLifecycle() when a lot row is clicked — this is why
// renderLifecycle needs its own window bridge here, not just the plain
// import pages.js needs for renderAll's real code call.

import { Qsub, State, _hydrateLot, _loadCatalog, _lotsForDropdown, appr, fmt, fmtDuration, fmtHrs, fmtTS, getDyeAllocated, getLotByKey, getRMBalance, getSoftIn, getSoftOut, hrsBetween, lcExpanded, pct, wcls, getDyeConsumedFromLot, fmtQ, Qmax0, getSoftBalance, getDyeBalance, getRMReturnedOut } from './core.js';
import { statusBadge } from './shared.js';
import { openDyeLifecycle, toggleLCStage } from './pages.js';

export function renderLifecycle(){
  _loadCatalog('lots',()=>{
    const selVal=document.getElementById('lc-select')?.value;
    if(selVal){
      const[lotId,grade,vendor]=selVal.split('||');
      _hydrateLot(lotId,grade,vendor,()=>{_renderLifecycleCore();});
    }else{
      _renderLifecycleCore();
    }
  });
}

export function _renderLifecycleCore(){const _dropdownLots=_lotsForDropdown();const vSel=document.getElementById('lc-vendor-select');if(vSel){const curV=vSel.value;const vendors=[...new Set(_dropdownLots.map(l=>l.vendor).filter(Boolean))].sort();vSel.innerHTML='<option value="">All Vendors</option>'+vendors.map(v=>`<option value="${v}" ${v===curV?'selected':''}>${v}</option>`).join('');}
const lcClearBtn=document.getElementById('lc-clear-btn');if(lcClearBtn)lcClearBtn.style.display=(vSel?.value||document.getElementById('lc-select')?.value)?'':'none';const sel=document.getElementById('lc-select');if(!sel)return;const prev=sel.value;const vendor=vSel?.value||'';const filteredLots=[..._dropdownLots].filter(l=>!vendor||l.vendor===vendor).sort((a,b)=>(a.id||'').localeCompare(b.id||''));sel.innerHTML='<option value="">— Select Lot —</option>'+filteredLots.map(l=>`<option value="${l.id}||${l.grade}||${l.vendor}">${l.id} — ${l.grade} — ${l.vendor}</option>`).join('');if(prev)sel.value=prev;const _lcVal=sel.value;if(!_lcVal){document.getElementById('lc-content').innerHTML='<div class="empty"><div class="empty-icon">🔍</div><div class="empty-text">ℹ Select a lot above to view its full production journey</div></div>';return;}
const[lotId,_lcGrade,_lcVendor]=_lcVal.split('||');const lot=getLotByKey(lotId,_lcGrade,_lcVendor);const rmBal=getRMBalance(lotId,lot.grade,lot.vendor);const lcStage=(key,color,icon,title,summaryRight,summaryRows,runs)=>{const exp=lcExpanded[key];return`<div class="lc-stage" style="--lc-c:${color}"><div class="lc-stage-hdr" onclick="toggleLCStage('${key}')"><div class="lc-stage-title" style="margin-bottom:0;">${icon} ${title}</div><div style="display:flex;align-items:center;gap:8px;"><span style="font-family:'IBM Plex Mono',monospace;font-size:0.75rem;color:${color}">${summaryRight}</span><span class="lc-expand-btn">${exp?'▲ Collapse':'▼ Expand'}</span></div></div>
      ${summaryRows.map(r=>`<div class="lc-row"><span class="lc-label">${r.l}</span><span class="lc-val ${r.c||''}">${r.v}</span></div>`).join('')}
      ${exp&&runs.length?`<div class="lc-stage-body">${runs.map(r=>r).join('')}</div>`:''}
      ${exp&&!runs.length?`<div class="lc-stage-body"><div style="font-size:0.72rem;color:var(--mu);padding:6px 0">No completed runs yet</div></div>`:''}
    </div>`;};const runCard=(e,stage)=>{const hrs=hrsBetween(e.startTime,e.endTime);const wp=e.wasteWeight!=null&&e.inWeight>0?pct(e.wasteWeight,e.inWeight):'—';const SBADGE={Soft:'b-soft',Wind:'b-wind',Pack:'b-pack'};return`<div class="lc-run"><div class="lc-run-title"><span>${e.id} <span class="badge ${SBADGE[stage]||'b-rm'}">${stage}</span></span>${statusBadge(e.voided?'Void':e.status)}</div><div class="lc-run-grid"><div class="lc-run-item"><div class="lc-run-label">Start</div><div class="lc-run-val">${fmtTS(e.startTime)}</div></div><div class="lc-run-item"><div class="lc-run-label">End</div><div class="lc-run-val">${fmtTS(e.endTime)||'In Progress'}</div></div><div class="lc-run-item"><div class="lc-run-label">Duration</div><div class="lc-run-val">${hrs>0?fmtHrs(hrs):'—'}</div></div><div class="lc-run-item"><div class="lc-run-label">Machine</div><div class="lc-run-val">${e.machine||'—'}</div></div><div class="lc-run-item"><div class="lc-run-label">Start Worker</div><div class="lc-run-val">${e.startWorker||'—'}</div></div><div class="lc-run-item"><div class="lc-run-label">End Worker</div><div class="lc-run-val">${e.endWorker||'—'}</div></div><div class="lc-run-item"><div class="lc-run-label">Input</div><div class="lc-run-val">${fmt(e.inUnits)}u / ${fmt(e.inWeight)}kg</div></div><div class="lc-run-item"><div class="lc-run-label">Output</div><div class="lc-run-val" style="color:var(--gr)">${fmt(e.outUnits)}u / ${fmt(e.outWeight)}kg</div></div><div class="lc-run-item"><div class="lc-run-label">Wastage</div><div class="lc-run-val ${wcls(parseFloat(wp))}">${fmt(e.wasteUnits)}u (${wp})</div></div><div class="lc-run-item"><div class="lc-run-label">Approved by</div><div class="lc-run-val">${e.approvedBy||'—'}</div></div></div>
      ${e.startNote?`<div style="margin-top:7px;padding:6px 9px;background:rgba(59,130,246,.07);border-radius:5px;border-left:2px solid var(--bl);font-size:0.7rem;"><span style="color:var(--bl);font-weight:700;font-size:0.58rem;text-transform:uppercase;letter-spacing:.08em;">Start Note</span><div style="color:var(--tx);margin-top:2px">${e.startNote}</div></div>`:''}
      ${e.endNote?`<div style="margin-top:5px;padding:6px 9px;background:rgba(240,165,0,.07);border-radius:5px;border-left:2px solid var(--ac);font-size:0.7rem;"><span style="color:var(--ac);font-weight:700;font-size:0.58rem;text-transform:uppercase;letter-spacing:.08em;">End Note</span><div style="color:var(--tx);margin-top:2px">${e.endNote}</div></div>`:''}
    </div>`;};const dyeRunCard=(d)=>{const hrs=hrsBetween(d.startTime,d.endTime);const src=(d.sources||[]).find(s=>s.lotId===lotId&&s.grade===lot.grade&&s.vendor===lot.vendor);const batchWasteKg=d.outWeight!=null?(d.kgLoss??((d.outWeight||0)-(d.totalInWeight||0))):null;const wp=batchWasteKg!=null&&d.totalInWeight>0?pct(batchWasteKg,d.totalInWeight):'—';return`<div class="lc-run"><div class="lc-run-title"><span style="color:var(--ac);font-weight:800;cursor:pointer;text-decoration:underline" onclick="openDyeLifecycle('${d.id}')" title="Open Dye Lifecycle">${d.dyeLotNo||d.id} ↗</span><span class="badge b-dye">Dye</span>${d.shade?`<span style="font-size:0.7rem;color:var(--mu);margin-left:6px">${d.shade}</span>`:''}${statusBadge(d.voided?'Void':d.status)}</div>
      ${(d.startNote??d.notes)?`<div style="font-size:0.7rem;color:var(--mu);margin-bottom:6px;background:var(--s2);padding:6px 8px;border-radius:4px;">📋 ${(d.startNote??d.notes)}</div>`:''}${d.endNote?`<div style="font-size:0.7rem;color:var(--mu);margin-bottom:6px;background:var(--s2);padding:6px 8px;border-radius:4px;">🏁 End: ${d.endNote}</div>`:''}
      <div class="lc-run-grid"><div class="lc-run-item"><div class="lc-run-label">Start</div><div class="lc-run-val">${fmtTS(d.startTime)}</div></div><div class="lc-run-item"><div class="lc-run-label">End</div><div class="lc-run-val">${fmtTS(d.endTime)||'In Progress'}</div></div><div class="lc-run-item"><div class="lc-run-label">Duration</div><div class="lc-run-val">${hrs>0?fmtHrs(hrs):'—'}</div></div><div class="lc-run-item"><div class="lc-run-label">Machine</div><div class="lc-run-val">${d.machine||'—'}</div></div><div class="lc-run-item"><div class="lc-run-label">Dye Master</div><div class="lc-run-val">${d.startWorker||'—'}</div></div><div class="lc-run-item"><div class="lc-run-label">This lot's input</div><div class="lc-run-val">${fmt(src?.cones||0)}c / ${fmt(src?.weight||0)}kg</div></div><div class="lc-run-item"><div class="lc-run-label">Total batch in</div><div class="lc-run-val">${fmt(d.totalInCones)}c / ${fmt(d.totalInWeight)}kg</div></div><div class="lc-run-item"><div class="lc-run-label">Batch output</div><div class="lc-run-val" style="color:var(--gr)">${fmt(d.outCones)}c / ${fmt(d.outWeight)}kg</div></div><div class="lc-run-item"><div class="lc-run-label">Batch wastage</div><div class="lc-run-val ${wcls(parseFloat(wp))}">${batchWasteKg!=null?fmt(batchWasteKg)+'kg':'—'} (${wp})</div></div><div class="lc-run-item"><div class="lc-run-label">Lot share</div><div class="lc-run-val">${(d.totalInWeight>0&&src)?((src.weight||0)/d.totalInWeight*100).toFixed(1)+'%':'—'}</div></div>${d.recycleId?`<div class=\"lc-run-item\"><div class=\"lc-run-label\">Off / Recycle</div><div class=\"lc-run-val\" style=\"color:var(--ye)\">${fmt(d.recycleCones||0)}c / ${fmt(d.recycleWeight||0)}kg → ${d.recycleId}</div></div>`:''}</div></div>`;};const idleBlock=(prevEndTS,nextStartTS,label)=>{if(!prevEndTS||!nextStartTS)return'';const hrs=hrsBetween(prevEndTS,nextStartTS);if(hrs<0.1)return'';return`<div class="lc-idle">⏳ <strong>${fmtDuration(prevEndTS,nextStartTS)}</strong> idle — ${label}</div>`;};const softEntries=appr(State.DB.stageEntries).filter(e=>e.lotId===lotId&&e.stage==='Soft'&&e.endTime);const dyeBatches=appr(State.DB.dyeLots||[]).filter(d=>(d.sources||[]).some(s=>s.lotId===lotId&&s.grade===lot.grade&&s.vendor===lot.vendor));const sIn=getSoftIn(lotId,lot.grade,lot.vendor);const sOut=getSoftOut(lotId,lot.grade,lot.vendor);const sWaste=Qsub(sOut,sIn);const dyeAlloc=getDyeAllocated(lotId,lot.grade,lot.vendor);const dyeConsumed=getDyeConsumedFromLot(lotId,lot.grade,lot.vendor);const lastSoftEnd=softEntries.length?softEntries[softEntries.length-1].endTime:null;const firstDyeStart=dyeBatches.length?dyeBatches[0].startTime:null;let html=`<div class="card gap-b" style="border-color:rgba(240,165,0,0.2)"><div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;"><div><div style="font-size:1.1rem;font-weight:800;color:#fff">${lot.id}</div><div style="font-size:0.78rem;color:var(--mu)">${lot.vendor} · ${lot.mill} · <span style="color:var(--ac)">${lot.grade}</span></div></div><div class="mono" style="font-size:0.75rem;color:var(--mu);text-align:right">Registered ${lot.date}<br>Total factory time: ${fmtDuration(lot.date+'T00:00:00',new Date().toISOString())}</div></div>

    ${lcStage(`${lotId}-rm`,'var(--cr)','📦','Raw Material',`${fmt(lot.units)}b/${fmt(lot.weight)}kg`,[
      {l:'Registered',v:`${fmt(lot.units)}b/${fmt(lot.weight)}kg`},
      {l:'Sent to Soft',v:fmtQ(sIn,'b')},
      {l:'Returned to Vendor',v:fmtQ(getRMReturnedOut(lotId,lot.grade,lot.vendor),'b')},
      {l:'Remaining in RM',v:fmtQ(Qmax0(rmBal),'b'),c:'wc-low'},
    ],[])}

    ${softEntries.length?lcStage(`${lotId}-soft`,'var(--cs)','💧','Softening',`${fmt(sOut.units)}b/${fmt(sOut.weight)}kg out · ${pct(sWaste.units,sIn.units)}waste`,[
      {l:'Total Input',v:fmtQ(sIn,'b')},
      {l:'Total Output',v:fmtQ(sOut,'b')},
      {l:'Wastage',v:`${fmtQ(sWaste,'b')}(${pct(sWaste.units,sIn.units)})`,c:wcls(parseFloat(pct(sWaste.units,sIn.units)))},
      {l:'Soft Balance',v:fmtQ(Qmax0(getSoftBalance(lotId,lot.grade,lot.vendor)),'b'),c:'wc-low'},
    ],softEntries.map(e=>runCard(e,'Soft'))):''}




    ${dyeBatches.length?lcStage(`${lotId}-dye`,'var(--cd)','🎨','Dyeing',`${fmt(dyeAlloc.units)}c/${fmt(dyeAlloc.weight)}kg allocated back`,[
      {l:`Sent to Dye(${dyeBatches.length}batch${dyeBatches.length>1?'es':''})`,v:`${fmt(dyeConsumed.units)}b / ${fmt(dyeConsumed.weight)}kg`},
      {l:'Input in Dye',v:`${fmt(dyeBatches.reduce((a,d)=>{const src=(d.sources||[]).find(s=>s.lotId===lotId&&s.grade===lot.grade&&s.vendor===lot.vendor);return a+(src?.cones||0);},0))}c / ${fmt(dyeConsumed.weight)}kg`},
      {l:'Output allocated back',v:`${fmt(dyeAlloc.units)}c / ${fmt(dyeAlloc.weight)}kg`},
      {l:'Dye Balance',v:fmtQ(Qmax0(getDyeBalance(lotId,lot.grade,lot.vendor)),'c'),c:'wc-low'},
    ],dyeBatches.map(b=>dyeRunCard(b))):''}

  </div>`;document.getElementById('lc-content').innerHTML=html;}

window.renderLifecycle = renderLifecycle;
