// dyelifecycle.js — Dye Lifecycle page (lot selector + full lifecycle detail view).
// Aug 6 2026 — Phase 1, Step 8 of the module-split plan. Extracted byte-for-
// byte from pages.js. Real inventory: renderDyeLifecycleSelect,
// renderDyeLifecycle, _renderDyeLifecycleCore — the last two were missed
// in the first reachability pass (only renderDyeLifecycleSelect was found
// initially) since renderDyeLifecycle is triggered by the same onclick
// string as renderDyeLifecycleSelect, not called from it in real code —
// caught by checking the static HTML trigger button before extracting,
// not after. One cross-page reference (openPartyFromDyeLot, still in
// pages.js) — imported below.

import { _loadCatalog, _dyeLotsForDropdown, _hydrateDyeLot, State, getDyeBal, getWindBal, getPackBal, getTotalPacked, getTotalDispatched, fmt, fmtTS, eligibleDyeLifecycleLots, getRecycleSteelBal, getRecycleSoftenedBal, getRCStatus } from './core.js';
import { openPartyFromDyeLot } from './party.js';

export function renderDyeLifecycleSelect(){_loadCatalog('dyeLots',()=>{const sel=document.getElementById('dye-lifecycle-select');if(!sel)return;const shadeSel=document.getElementById('dlc-shade-select');if(shadeSel){const curShade=shadeSel.value;const allLots=_dyeLotsForDropdown();const shades=[...new Set(allLots.map(d=>d.shade).filter(Boolean))].sort();shadeSel.innerHTML='<option value="">All Shades</option>'+shades.map(s=>{const cnt=allLots.filter(d=>d.shade===s).length;return`<option value="${s}" ${s===curShade?'selected':''}>${s} (${cnt} lot${cnt>1?'s':''})</option>`;}).join('');}
const shade=shadeSel?.value||'';const lots=eligibleDyeLifecycleLots(shade);const prev=sel.value;sel.innerHTML='<option value="">Select Dye Lot...</option>'+lots.map(d=>`<option value="${d.id}">${d.dyeLotNo} — ${d.shade}</option>`).join('');if(prev)sel.value=prev;const dlcClearBtn=document.getElementById('dlc-clear-btn');if(dlcClearBtn)dlcClearBtn.style.display=(shadeSel?.value||sel?.value)?'':'none';});}

export function renderDyeLifecycle(){
  const dyeLotId=document.getElementById('dye-lifecycle-select')?.value;
  if(dyeLotId){
    _hydrateDyeLot(dyeLotId,()=>{_renderDyeLifecycleCore();});
  }else{
    _renderDyeLifecycleCore();
  }
}

export function _renderDyeLifecycleCore(){const dyeLotId=document.getElementById('dye-lifecycle-select')?.value;const content=document.getElementById('dye-lifecycle-content');if(!dyeLotId||!content){if(content)content.innerHTML='';return;}
const lot=(State.DB.dyeLots||[]).find(d=>d.id===dyeLotId);if(!lot){content.innerHTML='<div class="alert-err">Dye lot not found</div>';return;}
const dyeBal=getDyeBal(dyeLotId);const windBal=getWindBal(dyeLotId);const packBal=getPackBal(dyeLotId);const packed=getTotalPacked(dyeLotId);const disp=getTotalDispatched(dyeLotId);const qc=(c,kg)=>`<strong style="font-size:0.88rem;color:var(--tx)">${c||0}c</strong><span style="color:var(--mu);font-size:0.75rem"> / ${fmt(kg)}kg</span>`;const qb=(b,kg)=>`<strong style="font-size:0.88rem;color:var(--tx)">${b||0}b</strong><span style="color:var(--mu);font-size:0.75rem"> / ${fmt(kg)}kg</span>`;const qkg=(kg,col)=>`<strong style="font-size:0.85rem;color:${col||'var(--tx)'};">${fmt(Math.abs(kg))}kg</strong>`;const row=(label,val,col)=>`
    <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--b1);"><span style="font-size:0.72rem;color:var(--mu);text-transform:uppercase;letter-spacing:0.05em;">${label}</span><span class="mono" style="color:${col||'var(--tx)'};">${val}</span></div>`;const wgRow=(diff)=>{if(Math.abs(diff)<0.01)return row('Waste / Gain','<span style="color:var(--mu)">0kg</span>');const col=diff>0?'var(--gr)':'var(--re)';const sign=diff>0?'+':'-';return row('Waste / Gain',`<strong style="font-size:0.85rem;color:${col}">${sign}${fmt(Math.abs(diff))}kg</strong>`);};const windEntries=(State.DB.windEntries||[]).filter(e=>e.dyeLotId===dyeLotId);const packEntries=(State.DB.packEntries||[]).filter(e=>e.dyeLotId===dyeLotId);const dispatches=(State.DB.dispatches||[]).filter(d=>d.dyeLotId===dyeLotId);const dyeWaste=(lot.outWeight||0)-(lot.totalInWeight||0);const _apprW=e=>e.status==='Approved'||e.status==='Edited-Approved';const windTotalInC=windEntries.filter(_apprW).reduce((a,e)=>a+(e.inCones||0),0);const windTotalInKg=windEntries.filter(_apprW).reduce((a,e)=>a+(e.inWeight||0),0);const windTotalOutC=windEntries.filter(_apprW).reduce((a,e)=>a+(e.outCones||0),0);const windTotalOutKg=windEntries.filter(_apprW).reduce((a,e)=>a+(e.outWeight||0),0);const packTotalIn=packEntries.filter(_apprW).reduce((a,e)=>a+(e.inWeight||0),0);const packTotalOut=packEntries.filter(_apprW).reduce((a,e)=>a+(e.weight||0),0);const windTotalOut=windTotalOutKg;const packBase=packTotalIn>0?packTotalIn:windTotalOut;const packDiff=packTotalOut-packBase;content.innerHTML=`
    
    <div class="card gap-b"><div style="display:flex;justify-content:space-between;align-items:center;"><div><div style="font-size:1.1rem;font-weight:800;color:var(--ac)">${lot.dyeLotNo}</div><div style="font-size:0.82rem;color:var(--mu)">${lot.shade} · ${(lot.sources||[]).map(s=>s.grade).filter((v,i,a)=>a.indexOf(v)===i).join(' + ')}</div></div></div></div><div class="card gap-b"><div class="card-title">📥 Source Lots</div>
      ${(lot.sources||[]).map(s=>s.sourceType==='recycle'?`<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--b1);"><span style="font-size:0.78rem;">♻ Recycle <strong>${s.recycleId||''}</strong><span style="color:var(--mu)">${s.pool==='softened'?'Softened':'On Steel'}</span></span><span class="mono">${qc(s.cones||0,s.weight||0)}</span></div>`:`<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--b1);"><span style="font-size:0.78rem;">Lot<strong>${s.lotId}</strong><span style="color:var(--mu)">${s.grade||''}· ${s.vendor||''}</span></span><span class="mono">${qc(s.cones||s.units||0,s.weight||0)}</span></div>`).join('')}
      ${row('Total Input', qc(lot.totalInCones||0, lot.totalInWeight||0))}
    </div><div class="card gap-b"><div class="card-title">🎨 Dye Output</div>
      ${row('In', qc(lot.totalInCones||0, lot.totalInWeight||0))}
      ${row('Out', qc(lot.outCones||0, lot.outWeight||0), 'var(--ac)')}
      ${wgRow(dyeWaste)}
      ${row('Balance', qc(dyeBal.units||0, dyeBal.weight||0), 'var(--ye)')}
      <div style="font-size:0.7rem;color:var(--mu);margin-top:6px;">By ${lot.endWorker||'—'} on ${fmtTS(lot.endTime)}</div></div>${lot.recycleId?`<div class="card gap-b"><div class="card-title">♻ Recycle / Off Yarn</div>${row('Off (split out)', qc(lot.recycleCones||0, lot.recycleWeight||0), 'var(--ye)')}${row('Good (kept for this lot)', qc(lot.goodCones||lot.outCones||0, (lot.outWeight||0)))}<div style=\"font-size:0.7rem;color:var(--mu);margin-top:8px;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em;\">Current state of that off yarn (${lot.recycleId})</div>${row('On Steel', qc(getRecycleSteelBal(lot.recycleId).units, getRecycleSteelBal(lot.recycleId).weight))}${row('Softened', qc(getRecycleSoftenedBal(lot.recycleId).units, getRecycleSoftenedBal(lot.recycleId).weight))}${row('Status', getRCStatus(lot.recycleId).status)}${(State.DB.recycleSoft||[]).filter(rs=>rs.recycleId===lot.recycleId).length?`<div style=\"font-size:0.7rem;color:var(--mu);margin-top:8px;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em;\">Recycle Soft entries from this off yarn</div>${(State.DB.recycleSoft||[]).filter(rs=>rs.recycleId===lot.recycleId).map(rs=>row(rs.id+' ('+rs.status+')', qc(rs.outCones||rs.inCones||0, rs.outWeight||rs.inWeight||0))).join('')}`:''}</div>`:''}<div class="card gap-b"><div class="card-title">🌀 Wind Entries</div>
      ${windEntries.length ? windEntries.map(e=>{
        const eWaste = (e.outWeight||0) - (e.inWeight||0);
        return `<div style="padding:8px 0;border-bottom:1px solid var(--b1);margin-bottom:4px;"><div style="font-size:0.78rem;font-weight:700;margin-bottom:6px;">${e.id}<span style="color:var(--mu);font-weight:400">— ${e.machine||'—'}</span></div>${row('In',qc(e.inCones||0,e.inWeight||0))}
${row('Out',e.outCones||e.outWeight?qc(e.outCones||0,e.outWeight||0):'—','var(--ac)')}
${wgRow(eWaste)}</div>`}).join('') : '<div style="color:var(--mu);font-size:0.75rem;padding:8px 0">No wind entries yet</div>'}
      ${row('Balance', qc(windBal.units||0, windBal.weight||0), 'var(--ye)')}
    </div><div class="card gap-b"><div class="card-title">📦 Pack Entries</div>
      ${packEntries.length ? packEntries.map(e=>{
        const _wOut = windEntries.filter(x=>x.status==='Approved'||x.status==='Edited-Approved').reduce((a,x)=>a+(x.outWeight||0),0);
        const _wCones = windEntries.filter(x=>x.status==='Approved'||x.status==='Edited-Approved').reduce((a,x)=>a+(x.outCones||0),0);
        const _kgPerCone = _wCones>0 ? _wOut/_wCones : 0;
        const _inKg = e.inWeight>0 ? e.inWeight : parseFloat(((e.inCones||0)*_kgPerCone).toFixed(2));
        const eDiff = (e.weight||0) - _inKg;
        return `<div style="padding:8px 0;border-bottom:1px solid var(--b1);margin-bottom:4px;"><div style="font-size:0.78rem;font-weight:700;margin-bottom:6px;">${e.id}<span style="color:var(--mu);font-weight:400">by ${e.worker||'—'}· ${fmtTS(e.timestamp)}</span></div>${row('In',qc(e.inCones||0,_inKg))}
${row('Out',qb(e.bags||0,e.weight||0),'var(--ac)')}
${wgRow(eDiff)}</div>`}).join('') : '<div style="color:var(--mu);font-size:0.75rem;padding:8px 0">No pack entries yet</div>'}
      ${row('Balance', qb(packBal.bags||0, packBal.weight||0), packBal.bags>0?'var(--ye)':'var(--mu)')}
    </div><div class="card"><div class="card-title">🚚 Dispatches</div>
      ${dispatches.length ? dispatches.map(d=>`<div style="padding:8px 0;border-bottom:1px solid var(--b1);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;"><strong style="font-size:0.78rem;cursor:pointer;color:var(--ac)"onclick="openPartyFromDyeLot('${d.party}','${d.dyeLotNo||''}')">${d.party}↗</strong><span class="mono"style="color:var(--gr)">${qb(d.bags||0,d.weight||0)}</span></div><div style="font-size:0.7rem;color:var(--mu)">${fmtTS(d.timestamp)}${d.invoiceNo?' · '+d.invoiceNo:''}</div></div>`).join('') : '<div style="color:var(--mu);font-size:0.75rem;padding:8px 0">No dispatches yet</div>'}
      ${row('Total Dispatched', qb(disp.bags||0, disp.weight||0), 'var(--gr)')}
      ${packBal.bags>0 ? row('Remaining in Pack', qb(packBal.bags||0, packBal.weight||0), 'var(--ye)') : ''}
    </div>`;}

window.renderDyeLifecycleSelect = renderDyeLifecycleSelect;
window.renderDyeLifecycle = renderDyeLifecycle;
