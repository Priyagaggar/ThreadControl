// dye.js — Dye page: Lots table, Start/End modals, Split, filters.
// Aug 6 2026 — Phase 1, Step 17 of the module-split plan. Extracted byte-
// for-byte from pages.js. Real inventory: 20 functions. Correctly
// excluded: approveDyeLot/rejectDyeLot/clearDyeStockFilters (already in
// stock.js), addResidualToNewDye (already in stockregister.js),
// openDyeLifecycle/openPartyFromDyeLot (already exported), renderApprovalDye
// (Approval page's own concern), makeDyeLotSearch (Wind/Pack-shared
// widget, flagged early this session, still misplaced in pages.js,
// unrelated cleanup for later). Also correctly excluded, same "Worker
// View" boundary confirmed during Soft's extraction: workerDyeForm,
// wDyeAddSourceRow, wDyeCalcTotal, wOnDyeEndSerialInput, wShowDyeEndRef,
// wSubmitDyeEnd, wSubmitDyeStart, refreshWDyeLots, _refreshWDyeLotsImpl
// (the "W" here is Worker, not Wind — verified precisely by reading each
// one's actual trigger context, not assumed from the name alone).

import { State, _sortState, fmt, getDyeLotCurrentStage, pct, qtyCell, wasteCell, getSoftBalanceAvailable, _fetchTrueSoftAvailable, _tableFilters, _summaryKey, fmtHrs, fmtTS, parseLotSelectValue, getSoftBalanceWeightAvailable, openModal, showToast, apiPost, closeModal, _hydrateDyeLot, hrsBetween, getGradePool, dtCell, agingBadge, mwCell, wastePctCell, _refreshAndRender, sortDyeLotNo, machinesForStage, workersSorted, _isLotOnHold, _openSimpleVoidPreview } from './core.js';
import { _captureFilterFocus, _restoreFilterBtns, _restoreFilterFocus, buildColFilter, buildDyeLotSearch, entryRowClass, sortArr, sortTh, renderBevDyeReady, renderBevDyePending, renderBevDyeFlagged, fitBevTableHeight, statusBadge } from './shared.js';

import { currentFY, renderAll, dyeFlagPill } from './pages.js';
import { _updateClearBtn } from './shared.js';

export function renderDyeTable(){const _focusCap=_captureFilterFocus('dyef-');const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';const isSup=State.currentUser?.role==='supervisor'||isAdmin;const fln=document.getElementById('dyef-lotno')?.value||'';const fsl=document.getElementById('dyef-srclot')?.value||'';const fsv_dye=document.getElementById('dyef-srcvendor')?.value||'';const fgd=document.getElementById('dyef-grade-col')?.value||'';const fg=document.getElementById('dyef-grade')?.value||'';const fs=document.getElementById('dyef-status')?.value||'';const allLots=State.DB.dyeLots||[];const dyeLotNos=[...new Set(allLots.filter(d=>(!fsl||(d.sources||[]).some(s=>s.lotId===fsl))&&(!fg||d.shade===fg)&&(!fs||d.status===fs)).map(d=>d.dyeLotNo).filter(Boolean))].sort(sortDyeLotNo);const srcLots=[...new Set(allLots.filter(d=>(!fln||(d.dyeLotNo||'').includes(fln))&&(!fg||d.shade===fg)&&(!fs||d.status===fs)).flatMap(d=>(d.sources||[]).map(s=>s.lotId)).filter(Boolean))].sort();const srcVendors=[...new Set(allLots.filter(d=>(!fln||(d.dyeLotNo||'').includes(fln))&&(!fg||d.shade===fg)&&(!fs||d.status===fs)).flatMap(d=>(d.sources||[]).map(s=>s.vendor)).filter(Boolean))].sort();const grades_d=[...new Set(allLots.filter(d=>(!fln||(d.dyeLotNo||'').includes(fln))&&(!fsl||(d.sources||[]).some(s=>s.lotId===fsl))&&(!fs||d.status===fs)).flatMap(d=>(d.sources||[]).map(s=>s.grade)).filter(Boolean))].sort();const shades=[...new Set(allLots.filter(d=>(!fln||(d.dyeLotNo||'').includes(fln))&&(!fsl||(d.sources||[]).some(s=>s.lotId===fsl))&&(!fs||d.status===fs)).map(d=>d.shade).filter(Boolean))].sort();const statuses=[...new Set(allLots.filter(d=>(!fln||(d.dyeLotNo||'').includes(fln))&&(!fsl||(d.sources||[]).some(s=>s.lotId===fsl))&&(!fg||d.shade===fg)).map(d=>d.status).filter(Boolean))].sort();let lots=allLots.filter(d=>(!fln||(d.dyeLotNo||'').includes(fln))&&(!fsl||(d.sources||[]).some(s=>s.lotId===fsl))&&(!fsv_dye||(d.sources||[]).some(s=>s.vendor===fsv_dye))&&(!fgd||(d.sources||[]).some(s=>s.grade===fgd))&&(!fg||(d.shade||'')===fg)&&(!fs||d.status===fs)).sort((a,b)=>(b.startTime||'').localeCompare(a.startTime||''));const dye_thead=document.getElementById('dye-thead');if(dye_thead){dye_thead.innerHTML=`
      <tr class="tbl-filter-row"><th>${buildDyeLotSearch('dyef-lotno','dyef-lotno-xbtn','dyef')}</th><th>${buildColFilter(shades,'dyef-grade','Shade')}</th><th>${buildColFilter(srcLots,'dyef-srclot','RM Lot')}</th><th>${buildColFilter(srcVendors,'dyef-srcvendor','Vendor')}</th><th>${buildColFilter(grades_d,'dyef-grade-col','Grade')}</th><th></th><th></th><th></th><th></th><th></th><th></th><th></th><th></th><th></th><th>${buildColFilter(statuses,'dyef-status','Status')}</th><th></th><th></th><th></th></tr><tr>
        ${sortTh('dye','dyeLotNo','Dye Lot')}
        ${sortTh('dye','shade','Shade')}<th>RM Lot</th><th>Vendor</th>
        <th>Grade</th>
        <th>In (c/kg)</th><th>Out (c/kg)</th><th>Waste (c/kg)</th><th>Waste%</th><th>Days</th>
        ${sortTh('dye','machine','Machine')}
        ${sortTh('dye','startWorker','Worker')}
        ${sortTh('dye','startTime','Start')}
        ${sortTh('dye','endTime','End')}
        ${sortTh('dye','status','Status')}
        <th style="font-size:0.65rem;color:var(--mu);letter-spacing:0.08em">SPLIT</th><th>Actions</th><th>Flag</th></tr>`;if(fln)document.getElementById('dyef-lotno').value=fln;if(fgd)document.getElementById('dyef-grade-col').value=fgd;if(fg)document.getElementById('dyef-grade').value=fg;if(fsl)document.getElementById('dyef-srclot').value=fsl;if(fsv_dye)document.getElementById('dyef-srcvendor').value=fsv_dye;if(fs)document.getElementById('dyef-status').value=fs;_restoreFilterBtns('dyef-lotno','dyef-grade-col','dyef-grade','dyef-srclot','dyef-srcvendor','dyef-status');_restoreFilterFocus(_focusCap);}const fln2=document.getElementById('dyef-lotno')?.value||'';const fsl2=document.getElementById('dyef-srclot')?.value||'';const fsv_dye2=document.getElementById('dyef-srcvendor')?.value||'';const fgd2=document.getElementById('dyef-grade-col')?.value||'';const fg2=document.getElementById('dyef-grade')?.value||'';const fs2=document.getElementById('dyef-status')?.value||'';lots=allLots.filter(d=>(!fln2||(d.dyeLotNo||'').includes(fln2))&&(!fsl2||(d.sources||[]).some(s=>s.lotId===fsl2))&&(!fsv_dye2||(d.sources||[]).some(s=>s.vendor===fsv_dye2))&&(!fgd2||(d.sources||[]).some(s=>s.grade===fgd2))&&(!fg2||(d.shade||'')===fg2)&&(!fs2||d.status===fs2)).sort((a,b)=>(b.startTime||'').localeCompare(a.startTime||''));
const tbody=document.getElementById('dye-tbody');if(!tbody)return;const sorted=_sortState.dye?.col?sortArr(lots,_sortState.dye.col,_sortState.dye.dir):lots;if(!sorted.length){tbody.innerHTML='<tr><td colspan="11"><div class="empty"><div class="empty-icon">&#x1F3A8;</div><div class="empty-text">✕ No dye lots match filters — try clearing</div></div></td></tr>';return;}
tbody.innerHTML=sorted.map(d=>{const stage=getDyeLotCurrentStage(d.id);const stC={'At Dye':'var(--cd)','At Wind':'var(--cw)','At Pack':'var(--cp)','Completed':'var(--gr)'}[stage]||'var(--mu)';const sC={Pending:'var(--ye)',Approved:'var(--gr)',Rejected:'var(--re)',Voided:'var(--re)',Void:'var(--re)'}[d.status]||'var(--mu)';const src_total_bags=(d.sources||[]).reduce((a,s)=>a+(s.units||0),0);const _srcs=d.sources||[];const _s0=_srcs[0]||{};const _lot0=_s0.recycleId?'♻'+(_s0.dyeLotNo||_s0.recycleId||'RC'):_s0.deadStockId?'DS'+(_s0.lotId||'—'):(_s0.lotId||'—');const _vendor0=_s0.recycleId?'Recycle':_s0.deadStockId?'Dead Stock':(_s0.vendor||'—');const _grade0=_s0.grade||'—';const _multi=_srcs.length>1;const _rowId='dr-'+d.id;const srcLotTd=_lot0+(_multi?' <span onclick="toggleSourceRows(this,\''+_rowId+'\')" data-exp="0" style="border:1px solid rgba(240,165,0,0.3);border-radius:10px;padding:2px 8px;font-size:0.65rem;font-weight:700;display:inline-flex;align-items:center;gap:4px;cursor:pointer;color:var(--ac)">📦 '+(_srcs.length-1)+' more ▼</span>':'');const srcVendorTd=_vendor0;const _dyeSplitBtn=(d.status==='Approved'||d.status==='Edited-Approved')&&!d.splitDone&&isAdmin?'<button class="btn btn-ghost btn-xs" style="font-size:0.62rem;color:var(--pu);padding:3px 8px" onclick="openDyeSplitModal(\''+d.id+'\')\">Split</button>':'<span style="color:var(--mu);font-size:0.65rem">—</span>';let act='';if(d.status==='Pending'&&isSup)act+='<button class="btn btn-success btn-xs tc-tip" data-tip="Approve" onclick="approveDyeLot(\''+d.id+'\')">&#x2713;</button> <button class="btn btn-ghost btn-xs tc-tip" data-tip="Reject" onclick="rejectDyeLot(\''+d.id+'\')">&#x2717;</button> ';if((d.status==='Rejected'||d.status==='Voided')&&isAdmin)act+='<button class="btn btn-ghost btn-xs tc-tip" data-tip="Override" onclick="openOverride(\''+d.id+'\',\'dye\')" >⚡</button>';if(isSup||isAdmin)act+='<button class="btn btn-ghost btn-xs tc-tip" data-tip="Edit" onclick="openEditEntryModal(\''+d.id+'\',\'dye\')">✏</button>';if(isSup||isAdmin)act+='<button class="btn btn-ghost btn-xs tc-tip" data-tip="Void" style="color:var(--re)" onclick="openVoidEntry(\''+d.id+'\',\'dye\')">🗑</button>';const _coneLossWarn=d.coneLoss<0?'<div style="font-size:0.6rem;color:var(--re)">△ '+Math.abs(d.coneLoss)+' cones lost</span>':'';const _dRowCls=entryRowClass(d.status);const _dyeWasteC=d.outCones!=null?(d.coneLoss??((d.outCones||0)-(d.totalInCones||0))):null;const _dyeWasteKg=d.outWeight!=null?(d.kgLoss??((d.outWeight||0)-(d.totalInWeight||0))):null;const _dyeWastePct=_dyeWasteKg!=null&&d.totalInWeight>0?pct(_dyeWasteKg,d.totalInWeight):'—';const _dyeDays=d.startTime?Math.floor((new Date()-new Date(d.startTime))/86400000):null;const _dyeGrade=_grade0||'—';
return`<tr class="${_dRowCls}">
<td class="mono" style="color:var(--ac);font-weight:700;cursor:pointer;vertical-align:top" onclick="openDyeLifecycle('${d.id}')">${d.dyeLotNo||d.id}</td>
<td style="vertical-align:top">${d.shade||'&#x2014;'}</td><td style="font-size:0.72rem;color:var(--ac);vertical-align:top">${srcLotTd}</td><td style="font-size:0.72rem;vertical-align:top">${srcVendorTd}</td><td style="vertical-align:top">${_dyeGrade&&_dyeGrade!=="—"?`<span class="badge b-rm">${_dyeGrade}</span>`:"—"}</td>
<td style="vertical-align:top" class="mono">${qtyCell(d.totalInCones,d.totalInWeight,'c')}</td>
<td style="vertical-align:top" class="mono">${qtyCell(d.outCones,d.outWeight,'c')}</td>
${wasteCell(_dyeWasteC,_dyeWasteKg,_dyeWastePct,'c')}${wastePctCell(_dyeWastePct)}
<td style="vertical-align:top">${agingBadge(_dyeDays)}</td>
${mwCell(d.machine)}
${mwCell(d.startWorker)}
${dtCell(d.startTime)}
${dtCell(d.endTime)}
<td style="vertical-align:top">${statusBadge(d.status)}${d.status==='Approved'?`<div style="font-size:0.6rem;color:${stC}">${stage}</div>`:''}</td>
<td style="vertical-align:top;white-space:nowrap">${_dyeSplitBtn}</td><td style="vertical-align:top;white-space:nowrap;display:flex;gap:3px;">${act}</td><td style="vertical-align:top">${dyeFlagPill(d.id)}</td></tr>`+(_multi?_srcs.slice(1).map((s,si)=>{const _sl=s.recycleId?'♻'+(s.dyeLotNo||s.recycleId||'RC'):s.deadStockId?'DS'+(s.lotId||'—'):(s.lotId||'—');const _sv=s.recycleId?'Recycle':s.deadStockId?'Dead Stock':(s.vendor||'—');const _sg=s.grade||'—';return'<tr class="src-sub-'+_rowId+'" style="display:none;background:rgba(240,165,0,0.04)">'+'<td></td><td></td>'+'<td style="padding-left:24px;color:var(--mu);font-size:0.72rem">↳ '+_sl+'</td>'+'<td style="color:var(--mu);font-size:0.72rem">'+_sv+'</td>'+'<td style="color:var(--mu);font-size:0.72rem">'+_sg+'</td>'+'<td colspan="12"></td></tr>';}).join(''):'')}).join('');renderBevDyeReady();renderBevDyePending();renderBevDyeFlagged();setTimeout(fitBevTableHeight,0);}

export {sortDyeLotNo};

export function _addDyeSourceRowImpl(){const list=document.getElementById('dye-sources-list');const rowId='dsr-'+Date.now();const lotsWithBal=State.DB.lots.filter(l=>{if(l.status==='Voided'||l.status==='Merged'||_isLotOnHold(l.id,l.grade,l.vendor))return false;const tKey=_summaryKey(l.id,l.grade,l.vendor);const t=State._trueSoftAvail?.[tKey];return t?t.units>0:getSoftBalanceAvailable(l.id,l.grade,l.vendor).units>0;});const vendors=[...new Set(lotsWithBal.map(l=>l.vendor))].sort();const vendorOpts='<option value="">Select vendor...</option>'+
vendors.map(v=>`<option value="${v}">${v}</option>`).join('');const row=document.createElement('div');row.id=rowId;row.style.cssText='background:var(--s2);border:1px solid var(--b1);border-radius:8px;padding:10px;margin-bottom:8px;';row.innerHTML=`
    <div style="display:grid;grid-template-columns:1fr 1fr 2fr;gap:6px;margin-bottom:6px;"><div><div style="font-size:0.6rem;color:var(--mu);margin-bottom:3px;text-transform:uppercase;letter-spacing:.08em">Vendor</div><select class="fs" onchange="onDsrVendorChange('${rowId}')"><option value="">Select vendor...</option>${vendorOpts.replace('<option value="">Select vendor...</option>','')}</select></div><div><div style="font-size:0.6rem;color:var(--mu);margin-bottom:3px;text-transform:uppercase;letter-spacing:.08em">Grade</div><select class="fs" id="${rowId}-grade" onchange="onDsrGradeChange('${rowId}')" disabled><option value="">Select grade...</option></select></div><div><div style="font-size:0.6rem;color:var(--mu);margin-bottom:3px;text-transform:uppercase;letter-spacing:.08em">Lot</div><select class="fs" id="${rowId}-lot" onchange="onDyeSourceLotChange(this)" disabled><option value="">Select lot...</option></select></div></div><div style="display:grid;grid-template-columns:1fr 1fr auto;gap:6px;align-items:center;"><input class="fi" type="number" step="1" placeholder="Cones counted" data-field="cones" title="Cones counted at dye start"><input class="fi" type="number" step="0.01" placeholder="Weight (kg)" data-field="weight" title="Weight from soft going to dye"><button class="btn btn-ghost btn-xs" style="color:var(--re)" onclick="document.getElementById('${rowId}').remove()">✕</button></div>`;list.appendChild(row);}

export function addDyeSourceRow(){
  // Jul 13 2026: fetch the true (active+archive, always-verified) available
  // balance once per form session instead of trusting whatever's already
  // loaded in the browser — this is the fix for lot 04-style over-commitment,
  // applied where the person actually looks (the dropdown), not just at
  // final submit.
  if(!State._trueSoftAvail){_fetchTrueSoftAvailable(()=>_addDyeSourceRowImpl());return;}
  _addDyeSourceRowImpl();
}

export function clearDyeFilters(){['dyef-lotno','dyef-srclot','dyef-srcvendor','dyef-grade-col','dyef-grade','dyef-status'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';_tableFilters[id]='';});renderDyeTable();setTimeout(()=>_updateClearBtn('dyef-'),0);}

export function genDyeLotNo(){const fy=currentFY();const prefix='DYE-'+fy+'-';const fySettings=(State.DB.masters.dyeLotSettings||[]).find(s=>s.fy===fy);const startingFull=fySettings?.startingNo||'';let startingNum=1;if(startingFull&&startingFull.startsWith(prefix)){startingNum=parseInt(startingFull.replace(prefix,''))||1;}
const existing=(State.DB.dyeLots||[]).filter(d=>d.dyeLotNo&&d.dyeLotNo.startsWith(prefix)).map(d=>parseInt(d.dyeLotNo.replace(prefix,''))||0);const maxExisting=existing.length>0?Math.max(...existing)+1:0;const next=Math.max(startingNum,maxExisting);return next;}

export function getDyeSrcOpts(grade){const trueBal=l=>{const tKey=_summaryKey(l.id,l.grade,l.vendor);return State._trueSoftAvail?.[tKey]||getSoftBalanceAvailable(l.id,l.grade,l.vendor);};const eligible=State.DB.lots.filter(l=>l.status!=='Voided'&&l.status!=='Merged'&&!_isLotOnHold(l.id,l.grade,l.vendor)&&(grade?l.grade===grade:true)&&trueBal(l).units>0).sort((a,b)=>(a.id||'').localeCompare(b.id||''));if(!eligible.length)return'<option value="" disabled>No lots with Soft balance'+(grade?' for grade '+grade:'')+'</option>';return eligible.map(l=>{const bal=trueBal(l);return`<option value="${l.id}||${l.grade}||${l.vendor}">${l.id} — ${l.grade} — ${l.vendor} (${fmt(bal.units)}u avail)</option>`;}).join('');}

export function loadDyeEntriesIfNeeded(callback){if(State._dyeEntriesLoaded||State.DB.dyeEntries.length>0){if(callback)callback();return;}
if(!State.firebaseLoaded||!State.fbDB){if(callback)callback();return;}
State.fbDB.ref('/tc/dyeEntries').once('value',snap=>{State.DB.dyeEntries=snap.val()||[];State._dyeEntriesLoaded=true;console.log('[Lazy] dyeEntries loaded:',State.DB.dyeEntries.length,'entries');if(callback)callback();});}

export function onDyeEndEntrySelect(){const entryId=document.getElementById('dye-end-entry-select').value;if(!entryId){document.getElementById('dye-end-summary').style.display='none';return;}
const entry=(State.DB.dyeLots||[]).find(e=>e.id===entryId&&e.status==='InProgress');if(!entry)return;const sum=document.getElementById('dye-end-summary');sum.style.display='block';
const _elapsed=hrsBetween(entry.startTime,new Date().toISOString());
const _srcs=entry.sources||[];
const _maxShow=2;
const _lotIds=_srcs.map(s=>s.lotId);
const _grades=_srcs.map(s=>s.grade).filter(Boolean);
const _uGrades=[...new Set(_grades)];
const _lotStr=_lotIds.length<=_maxShow?_lotIds.join(', '):(_lotIds.slice(0,_maxShow).join(', ')+' +'+(_lotIds.length-_maxShow)+' more');
const _gradeStr=_uGrades.length<=_maxShow?_uGrades.join(', '):(_uGrades.slice(0,_maxShow).join(', ')+' +'+(_uGrades.length-_maxShow)+' more');
const _allSrcStr=_srcs.map(s=>`${s.lotId} (${s.grade||'—'}) ${fmt(s.weight)}kg`).join('<br>');
const _srcExpId='dye-src-expand-'+entry.id;
sum.innerHTML=`<div style="font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--cd);margin-bottom:10px;">📋 Start Reference — Dye Stage</div>
<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px;">
  <div>
    <div style="font-size:.58rem;color:var(--mu);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">Source Lots</div>
    <div style="font-size:.82rem;font-weight:700;color:#fff">${_srcs.length===1?_lotIds[0]:_lotStr}</div>
    <div style="font-size:.65rem;color:var(--mu)">${_srcs.length===1?_gradeStr:_gradeStr}</div>
    ${_srcs.length>1?`<div style="font-size:.6rem;color:var(--ac);cursor:pointer;margin-top:3px" onclick="const el=document.getElementById('${_srcExpId}');el.style.display=el.style.display==='none'?'block':'none';this.textContent=el.style.display==='none'?'▼ show all':'▲ hide'">▼ show all</div><div id="${_srcExpId}" style="display:none;font-size:.65rem;color:var(--mu);margin-top:4px;line-height:1.6">${_allSrcStr}</div>`:''}
  </div>
  <div>
    <div style="font-size:.58rem;color:var(--mu);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">Input Loaded</div>
    <div style="font-size:.9rem;font-weight:700;color:var(--bl)">${entry.totalInCones||0}c / ${fmt(entry.totalInWeight||0)}kg</div>
  </div>
  <div>
    <div style="font-size:.58rem;color:var(--mu);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">Running Time</div>
    <div style="font-size:.9rem;font-weight:700;color:var(--cy)">${fmtHrs(_elapsed)}</div>
    <div style="font-size:.65rem;color:var(--mu)">since ${fmtTS(entry.startTime)}</div>
  </div>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;padding-top:8px;border-top:1px solid var(--b1);margin-bottom:8px;">
  <div>
    <div style="font-size:.58rem;color:var(--mu);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">Machine</div>
    <div style="font-size:.78rem;font-weight:600">${entry.machine||'—'}</div>
  </div>
  <div>
    <div style="font-size:.58rem;color:var(--mu);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">Started By</div>
    <div style="font-size:.78rem;font-weight:600">${entry.startWorker||'—'}</div>
  </div>
</div>
<div style="padding:7px 10px;background:rgba(59,130,246,.08);border-radius:5px;font-size:.7rem;color:var(--bl);margin-bottom:8px;">ℹ Output cannot exceed <strong>${entry.totalInCones||0}c / ${fmt(entry.totalInWeight||0)}kg</strong></div>
<div id="dye-end-io-check" style="padding:8px;border-radius:6px;background:var(--s2);font-size:0.75rem">Enter output values to see IO control</div>`;
document.getElementById('dye-end-entry-select')._entry=entry;}

export function onDyeEndSerialInput(){const _fy=document.getElementById('dye-end-fy')?.value||currentFY();const _serial=(document.getElementById('dye-end-serial')?.value||'').trim();const _sub=(document.getElementById('dye-end-sub')?.value||'').trim();if(!_serial)return;const _base='DYE-'+_fy+'-'+_serial;const _full=_base+(_sub?'-'+_sub:'');const _dup=_sub?(State.DB.dyeLots||[]).find(d=>d.dyeLotNo===_full&&d.status!=='Voided'):(State.DB.dyeLots||[]).find(d=>d.dyeLotNo===_base&&d.status!=='Voided');const alert=document.getElementById('dye-end-alert');if(_dup){alert.innerHTML='<div class="alert-err" style="margin-bottom:8px">⚠ '+_full+' already exists. Add a suffix in Sub box if this is a sub-batch.</div>';}else{alert.innerHTML='';}}

export function onDyeSourceLotChange(sel){if(!sel.value)return;const{lotId,grade,vendor}=parseLotSelectValue(sel.value);const bal=getSoftBalanceWeightAvailable(lotId,grade,vendor);sel.title=`Available: ${fmt(bal)}kg`;}

export function openDyeEndModal(){document.getElementById('dye-end-alert').innerHTML='';document.getElementById('dye-end-shade').value='';document.getElementById('dye-end-out-weight').value='';document.getElementById('dye-end-notes').value='';document.getElementById('dye-end-summary').style.display='none';const W=workersSorted();const opts=arr=>`<option value="">Select...</option>${arr.map(v=>`<option value="${v}">${v}</option>`).join('')}`;const allInProgress=(State.DB.dyeLots||[]).filter(e=>e.status==='InProgress').sort(sortDyeLotNo);const sel=document.getElementById('dye-end-entry-select');sel.innerHTML=`<option value="">Select dye entry...</option>`+
allInProgress.map(e=>{
  const srcs=e.sources||[];
  const maxShow=2;
  const lotIds=srcs.map(s=>s.lotId);
  const grades=srcs.map(s=>s.grade).filter(Boolean);
  const uniqueGrades=[...new Set(grades)];
  const lotStr=lotIds.length<=maxShow?lotIds.join(', '):(lotIds.slice(0,maxShow).join(', ')+' +'+(lotIds.length-maxShow));
  const gradeStr=uniqueGrades.length<=maxShow?uniqueGrades.join(', '):(uniqueGrades.slice(0,maxShow).join(', ')+' +'+(uniqueGrades.length-maxShow));
  const label=srcs.length===1
    ?`${e.id} · ${lotIds[0]} · ${gradeStr} · ${fmt(e.totalInWeight||0)}kg`
    :`${e.id} · ${lotStr} · ${gradeStr} · ${fmt(e.totalInWeight||0)}kg`;
  return`<option value="${e.id}">${label}</option>`;
}).join('');const _fyEl=document.getElementById('dye-end-fy');if(_fyEl){const _fy=currentFY();const _prevFY=String(parseInt(_fy.slice(0,2))-1)+String(parseInt(_fy.slice(2))-1);_fyEl.innerHTML=[_fy,_prevFY].map(f=>`<option value="${f}"${f===_fy?'selected':''}>${f.slice(0,2)}-${f.slice(2)}</option>`).join('');}
const _suggestedSerial=genDyeLotNo();const _serialEl=document.getElementById('dye-end-serial');if(_serialEl){_serialEl.value=_suggestedSerial;_serialEl.select();}
const _subEl=document.getElementById('dye-end-sub');if(_subEl)_subEl.value='';
openModal('dye-end-modal-overlay');}

export function openDyeSplitModal(dyeLotId){const lot=(State.DB.dyeLots||[]).find(d=>d.id===dyeLotId);if(!lot){showToast('Dye lot not found','err');return;}
if(lot.status!=='Approved'&&lot.status!=='Edited-Approved'){showToast('Approve dye lot first','err');return;}
document.getElementById('dyesplit-lot-id').value=dyeLotId;document.getElementById('dyesplit-alert').innerHTML='';document.getElementById('dyesplit-good').value='';document.getElementById('dyesplit-off').value='';const _oc=document.getElementById('dyesplit-off-cones');if(_oc)_oc.value='';const _cn=document.getElementById('dyesplit-cones-note');if(_cn)_cn.textContent='';document.getElementById('dyesplit-reason').value='';document.getElementById('dyesplit-lot-info').innerHTML=`<strong>${lot.dyeLotNo}</strong> — ${lot.shade}<br>Total output: <strong>${fmt(lot.outWeight||0)}kg</strong> / <strong>${lot.outCones||0} cones</strong><br>Already split: ${lot.splitDone?'Yes':'No'}`;openModal('dyesplit-modal-overlay');}

export function openDyeStartModal(){document.getElementById('dye-start-alert').innerHTML='';document.getElementById('dye-start-notes').value='';
// Aug 26 2026 — real, direct extension: shows only Dye's own real
// machines, but an untagged machine still shows everywhere until
// someone tags it, so nothing breaks during that real transition.
const M=machinesForStage('Dye');
const W=workersSorted();const opts=(arr,empty='Select...')=>`<option value="">${empty}</option>${arr.map(v=>`<option value="${v}">${v}</option>`).join('')}`;document.getElementById('dye-start-machine').innerHTML=opts(M);document.getElementById('dye-start-worker').innerHTML=opts(W);document.getElementById('dye-sources-list').innerHTML='';document.getElementById('dye-dead-list').innerHTML='';document.getElementById('dye-recycle-list').innerHTML='';addDyeSourceRow();openModal('dye-start-modal-overlay');}

export async function submitDyeEndNew(){
  // Jul 14 2026 — Item I cutover (Dye End, completing the flow). All
  // validation and the write now live in worker.js (POST /api/dye/end).
  // The legacy dyeEntries fallback branch (isNewArch=false in the original)
  // is NOT carried forward — Item O confirmed dyeEntries is permanently
  // empty in production, nothing real to preserve.
  const setAlert=(msg)=>{document.getElementById('dye-end-alert').innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;};
  const entryId=document.getElementById('dye-end-entry-select').value;
  const _fy=document.getElementById('dye-end-fy')?.value||currentFY();
  const _serial=(document.getElementById('dye-end-serial')?.value||'').trim();
  const _sub=(document.getElementById('dye-end-sub')?.value||'').trim();
  if(!_serial){setAlert('Serial No is required');return;}
  if(isNaN(parseInt(_serial))||parseInt(_serial)<1){setAlert('Serial No must be a positive number');return;}
  const shade=document.getElementById('dye-end-shade').value.trim();const outCones=parseInt(document.getElementById('dye-end-out-cones')?.value)||0;const outWeight=parseFloat(document.getElementById('dye-end-out-weight').value)||0;const notes=document.getElementById('dye-end-notes').value.trim();
  if(!entryId){setAlert('Select a dye entry');return;}
  if(!shade){setAlert('Enter shade name/no');return;}
  if(outCones<=0){setAlert('Enter output cones count');return;}
  if(outWeight<=0){setAlert('Output weight must be > 0');return;}
  const _btn=document.getElementById('dye-end-submit-btn');if(_btn)_btn.disabled=true;
  try{
    const {ok,data,error,networkError}=await apiPost('/api/dye/end',{entryId,fy:_fy,serial:_serial,sub:_sub,shade,outCones,outWeight,endNote:notes,changedBy:State.currentUser.name,idempotencyKey:crypto.randomUUID()});
  if(networkError)throw new Error(error);
  if(!ok){setAlert(error||'Failed to end dye batch');if(_btn)_btn.disabled=false;return;}
    if(_btn)_btn.disabled=false;closeModal('dye-end-modal-overlay');showToast('Dye Lot '+data.dyeLotNo+' created \u2014 pending approval \u2713');if(data.coneLoss<0)showToast('\u2139 Cone loss: '+Math.abs(data.coneLoss)+' cones','info');
    // Jul 28 2026 fix — real, confirmed bug: dyeLots is only ever loaded
    // once, at session start. Nothing after that ever adds a brand-new
    // dye lot into the local list — renderAll() alone was rendering from
    // that same stale, session-start snapshot, so a just-completed dye
    // lot would never actually appear until a full page reload, even
    // though the write itself (and the material consumption) had already
    // genuinely succeeded on the server. _hydrateDyeLot already exists
    // for exactly this — fetches the one real record and adds it to the
    // local list — just was never called here.
    _hydrateDyeLot(entryId,()=>{renderAll();});
  }catch(e){setAlert('Network error \u2014 not saved: '+e.message);if(_btn)_btn.disabled=false;}
}

export async function submitDyeSplit(force){
const setAlert=msg=>{document.getElementById('dyesplit-alert').innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;};
const dyeLotId=document.getElementById('dyesplit-lot-id')?.value;
const good=parseFloat(document.getElementById('dyesplit-good')?.value)||0;
const off=parseFloat(document.getElementById('dyesplit-off')?.value)||0;
const _ocRaw=document.getElementById('dyesplit-off-cones')?.value;const offCones=(_ocRaw===''||_ocRaw==null)?undefined:Number(_ocRaw);
const reason=document.getElementById('dyesplit-reason')?.value.trim()||'';
if(offCones===undefined||!Number.isInteger(offCones)||offCones<0){setAlert('Enter the off cones (a whole number, 0 or more)');return;}
if(!dyeLotId){setAlert('No dye lot selected — close and reopen');return;}
try{
  const {ok,data,error,networkError}=await apiPost('/api/dye/split',{dyeLotId,good,off,offCones,reason,confirm:!!force,changedBy:State.currentUser?.name,role:State.currentUser?.role});
  if(networkError)throw new Error(error);
  // Sep 10 2026 — real, direct new feature built via direct discussion
  // with Priyam, establishing one clear rule across the whole app:
  // every real action shows a genuine preview of its actual effect
  // before committing — upgraded from only warning when Wind had
  // already genuinely claimed more than the new Good portion leaves
  // behind, to always showing what the split would actually produce,
  // with any real shortfall highlighted right there in the same
  // preview instead of a separate warning.
  if(ok&&data?.__dryRun){
    const warningHtml=data.wouldCreateShortfall?`<div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:8px 10px;font-size:.72rem;color:var(--re);font-weight:700;margin-bottom:8px">⚠ ${data.shortfallMessage}</div>`:'';
    document.getElementById('dyesplit-alert').innerHTML=`<div style="margin-bottom:8px">
      <div style="font-size:.82rem;margin-bottom:8px;">Good: <strong>${fmt(data.goodWeight)}kg / ${data.goodCones||0} cones</strong> · Off: <strong>${fmt(data.offWeight)}kg / ${data.offCones||0} cones</strong> (of ${fmt(data.totalOut)}kg total)</div>
      ${warningHtml}
      <button class="btn btn-primary btn-xs" onclick="submitDyeSplit(true)">🔍 Confirm Split</button>
    </div>`;
    return;
  }
  if(!ok){setAlert(error||'Split failed');return;}
  closeModal('dyesplit-modal-overlay');
  showToast(data.rcId+' created — '+fmt(off)+'kg / '+offCones+' cones off material tracked ✓');
  // Aug 26 2026 — real, direct, genuine bug found via direct
  // discussion with Priyam: the exact same real bug found on Reassign
  // Source — _refreshAndRender genuinely, completely overwrites
  // dyeLots with only the active list, silently wiping out an older,
  // already-archived batch that had been split. A split can genuinely
  // happen on a batch well after it was created, long enough to have
  // moved to archive by then. Patches just this one, real Dye lot's
  // own split fields directly in memory instead, never touching or
  // re-fetching the rest of the already-merged list.
  const _splitDye = (State.DB.dyeLots || []).find(x => x.id === dyeLotId);
  if (_splitDye) { _splitDye.splitDone = true; _splitDye.goodWeight = good; _splitDye.recycleWeight = off; _splitDye.recycleCones = offCones; _splitDye.goodCones = (_splitDye.outCones || 0) > 0 ? (_splitDye.outCones - offCones) : 0; _splitDye.recycleId = data.rcId; }
  await _refreshAndRender(['recycleStock','dyeLotFlags'],renderAll);
}catch(e){setAlert('Network error — '+e.message);}
}

export async function submitDyeStartNew(){
  // Jul 14 2026 — Item I cutover (Dye Start, final flow). All 4 source-type
  // validations, the machine-in-use check, and the write now live in
  // worker.js (POST /api/dye/start). Client keeps only: reading the form,
  // the light client-side pre-checks that avoid an unnecessary round trip
  // (empty fields), and the duplicate-in-progress PREVIEW dialog — now
  // fixed to strict matching (was loose, same bug class as the original
  // lot-04 issue, found while porting this function, not caught in the
  // earlier audit pass).
  const setAlert=(msg)=>{document.getElementById('dye-start-alert').innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;};
  const machine=document.getElementById('dye-start-machine').value;const worker=document.getElementById('dye-start-worker').value;const notes=document.getElementById('dye-start-notes').value.trim();
  if(!machine){setAlert('Select machine');return;}
  if(!worker){setAlert('Select worker');return;}
  const sources=[];let vFail=false;
  document.querySelectorAll('#dye-sources-list > div[id^="dsr-"]').forEach(row=>{const lotSel=row.querySelector('select[id$="-lot"]');const wIn=row.querySelector('input[data-field="weight"]');if(!lotSel?.value||!wIn?.value)return;const[lotId,grade,vendor]=lotSel.value.split('||');const w=parseFloat(wIn.value)||0;if(w<=0){setAlert('RM weight must be > 0');vFail=true;return;}
    const cIn=parseInt(row.querySelector('[data-field="cones"]')?.value)||0;if(cIn<=0){setAlert(`Lot ${lotId}: Cones count is required`);vFail=true;return;}
    sources.push({lotId,grade,vendor,weight:w,cones:cIn,sourceType:'rm'});});
  document.querySelectorAll('#dye-dead-list > div').forEach(row=>{const dsSel=row.querySelector('select');const wIn=row.querySelector('input[data-field="weight"]');if(!dsSel?.value||!wIn?.value)return;const dsRaw=dsSel.value;const dsId=dsRaw.split('|')[0];const w=parseFloat(wIn.value)||0;if(w<=0){setAlert('Dead stock weight must be > 0');vFail=true;return;}
    // Sep 10 2026 — real, direct extension built via direct discussion
    // with Priyam: Dead Stock never had a way to record cones for the
    // amount actually used in a Dye batch — typed in manually here,
    // same as an RM source's own cones input, never auto-calculated.
    const cIn=parseInt(row.querySelector('[data-field="cones"]')?.value)||0;if(cIn<=0){setAlert('Dead stock: Cones count is required');vFail=true;return;}
    sources.push({deadStockId:dsId,weight:w,cones:cIn,sourceType:'dead'});});
  document.querySelectorAll('#dye-recycle-list > div').forEach(row=>{const rcSel=row.querySelector('select[data-field="rc"]');const wIn=row.querySelector('input[data-field="weight"]');if(!rcSel?.value||!wIn?.value)return;const rcId=rcSel.value;const w=parseFloat(wIn.value)||0;if(w<=0){setAlert('Recycle weight must be > 0');vFail=true;return;}
    const rcCones=parseInt(row.querySelector('[data-field="cones"]')?.value)||0;if(rcCones<=0){setAlert('Recycle '+rcId+': Cones count is required');vFail=true;return;}
    const rcPool=row.querySelector('select[data-field="pool"]')?.value==='softened'?'softened':'steel';
    sources.push({recycleId:rcId,weight:w,cones:rcCones,pool:rcPool,sourceType:'recycle'});});
  document.querySelectorAll('#dye-residual-list > div').forEach(row=>{const rsSel=row.querySelector('select');const wtEl=row.querySelector('input[type="number"]');if(!rsSel?.value||!wtEl?.value)return;const rsId=rsSel.value;const w=parseFloat(wtEl.value)||0;if(w<=0){setAlert('Residual weight must be > 0');vFail=true;return;}
    sources.push({residualId:rsId,weight:w,sourceType:'residual'});});
  if(vFail)return;
  if(sources.length===0){setAlert('Add at least one source (RM lot, dead stock, recycle, or residual)');return;}
  for(const _src of sources){
    if(_src.sourceType!=='rm')continue;
    // Strict matching fix — was (!s.grade||s.grade===_src.grade), same bug
    // class found and fixed everywhere else this session.
    const _dyeDup=(State.DB.dyeLots||[]).find(e=>e.status==='InProgress'&&(e.sources||[]).some(s=>s.lotId===_src.lotId&&s.grade===_src.grade&&s.vendor===_src.vendor));
    if(_dyeDup){const _elapsed=hrsBetween(_dyeDup.startTime,new Date().toISOString());if(!confirm(`\u26a0 Lot ${_src.lotId} already used in another Dye batch IN PROGRESS\nDye Lot: ${_dyeDup.id}\nStarted: ${fmtTS(_dyeDup.startTime)} by ${_dyeDup.startWorker||'?'}\nRunning for: ${fmtHrs(_elapsed)}\n\nStart another batch with this lot anyway? (only do this if it\'s a genuine separate split)`))return;}
  }
  const _btn=document.getElementById('dye-start-submit-btn');if(_btn)_btn.disabled=true;
  const _doSubmit=async(confirmDup)=>{
    try{
      const {ok,data,error,networkError}=await apiPost('/api/dye/start',{machine,worker,notes,sources,changedBy:State.currentUser.name,idempotencyKey:crypto.randomUUID(),confirmDuplicate:confirmDup||undefined});
      if(networkError)throw new Error(error);
      if(!ok){
        // Jul 26 2026 — content-based duplicate warning (confirmed design:
        // same source RM lot(s) + same total input weight, since shade
        // isn't known yet at Start — that's only assigned at End).
        if(data&&data.duplicateWarning){
          if(_btn)_btn.disabled=false;
          if(confirm(data.message+'\n\nClick OK to start this as a new, separate batch anyway. Click Cancel to go back and check.')){
            if(_btn)_btn.disabled=true;
            await _doSubmit(true);
          }
          return;
        }
        setAlert(error||'Failed to start dye batch');if(_btn)_btn.disabled=false;return;
      }
      if(_btn)_btn.disabled=false;closeModal('dye-start-modal-overlay');showToast('Dye started ✓ — End dye to complete Dye Lot');await _refreshAndRender(['dyeLots'],renderAll);
    }catch(e){setAlert('Network error — not saved: '+e.message);if(_btn)_btn.disabled=false;}
  };
  await _doSubmit(false);
}

export function updateDyeTotal(){let tu=0,tw=0;document.querySelectorAll('#dye-sources>div[id^="ads-"]').forEach(row=>{tu+=parseFloat(row.querySelector('input[data-field="units"]')?.value)||0;tw+=parseFloat(row.querySelector('input[data-field="weight"]')?.value)||0;});const displayEl=document.getElementById('dye-total-display');if(displayEl)displayEl.textContent=`${fmt(tu)} units / ${fmt(tw)} kg`;const grade=document.getElementById('m-dye-grade')?.value;const poolEl=document.getElementById('dye-pool-live');if(poolEl&&grade){const pool=getGradePool(grade);const remaining=pool.units-tu;poolEl.innerHTML=`<div style="display:flex;justify-content:space-between;font-size:0.72rem;"><span style="color:var(--mu)">Grade ${grade} pool available</span><span class="mono" style="color:var(--gr)">${fmt(pool.units)}b total</span></div><div style="display:flex;justify-content:space-between;font-size:0.72rem;margin-top:3px;"><span style="color:var(--mu)">This batch using</span><span class="mono" style="color:var(--ac)">${fmt(tu)}u</span></div><div style="display:flex;justify-content:space-between;font-size:0.72rem;margin-top:3px;padding-top:4px;border-top:1px solid var(--b1);"><span style="color:var(--mu)">Remaining after batch</span><span class="mono" style="color:${remaining<0?'var(--re)':remaining<50?'var(--ye)':'var(--gr)'}">${fmt(remaining)}u</span></div>
    ${remaining<0?`<div class="alert alert-err"style="margin-top:6px;padding:6px 10px;font-size:0.7rem;">⚠ Over-assigned by ${fmt(Math.abs(remaining))}u — reduce quantities</div>`:''}`;}}

export async function voidDyeSplit(rcId){
  const rec=(State.DB.recycleStock||[]).find(x=>x.id===rcId);if(!rec)return;
  const reason=prompt('Reason for undoing this split (required):');
  if(!reason||!reason.trim()){showToast('A reason is required','err');return;}
  const pwd=prompt('Enter your password to confirm:');
  if(!pwd){showToast('Cancelled — password required','err');return;}
  await _openSimpleVoidPreview({
    endpoint:'/api/dye/split-void',
    body:{rcId,reason:reason.trim(),password:pwd,username:State.currentUser?.username,changedBy:State.currentUser?.name},
    label:(data)=>`Undoing the split for <strong>${data.dyeLotId}</strong> — restores the full ${fmt(data.goodWeight+data.offWeight)}kg to the dye lot and removes this recycle stock entry. This cannot be undone.`,
    refreshKeys:['recycleStock'],
    successMsg:'Split undone ✓ — dye lot restored',
    // Aug 26 2026 — real, direct, genuine bug found via direct
    // discussion with Priyam: the exact same real bug found on
    // Reassign Source and the Split submission — never re-fetches or
    // overwrites the whole, already-merged dyeLots list, patches only
    // this one, real Dye lot's own split fields back directly.
    extraRenderFn:()=>{
      const _undoneDye = (State.DB.dyeLots || []).find(x => x.id === rec.dyeLotId);
      if (_undoneDye) { _undoneDye.splitDone = false; delete _undoneDye.goodWeight; delete _undoneDye.recycleWeight; delete _undoneDye.recycleCones; delete _undoneDye.goodCones; delete _undoneDye.recycleId; }
    },
  });
}

window.addDyeSourceRow = addDyeSourceRow;
window.onDyeEndEntrySelect = onDyeEndEntrySelect;
window.onDyeEndSerialInput = onDyeEndSerialInput;
window.onDyeSourceLotChange = onDyeSourceLotChange;
window.openDyeEndModal = openDyeEndModal;
window.openDyeSplitModal = openDyeSplitModal;
window.openDyeStartModal = openDyeStartModal;
window.submitDyeEndNew = submitDyeEndNew;
window.submitDyeSplit = submitDyeSplit;
window.submitDyeStartNew = submitDyeStartNew;
window.updateDyeTotal = updateDyeTotal;
window.voidDyeSplit = voidDyeSplit;
