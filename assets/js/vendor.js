// vendor.js — Vendor Tracker page.
// Aug 6 2026 — Phase 1, Step 12 of the module-split plan. Extracted byte-
// for-byte from pages.js. Real inventory: vtSelectVendor (the true entry
// point — reaches all 3 others, missed by the first reachability pass
// which started from renderVendorV2 instead), renderVendorV2,
// renderVtLotDetailV2, vtLotStatus. search.js already imported
// vtSelectVendor FROM pages.js (used by searchNavTo's 'vendor'
// destination) — needs updating to import from vendor.js directly, same
// fix as Party Tracker's Step 9. One cross-page reference
// (openDyeLifecycle, already exported) and one new one (vtToggleVoided)
// — imported below.

import { Qmax0, State, _loadCatalog, _lotsForDropdown, fmt, fmtDate, getDispatched, getLotByKey, getPackBal, getRMBalance, getSoftBalance, getSoftConsumedByDye, getSoftIn, getSoftOut, getTotalDispatched, getTotalPacked, getVendorRatioForDyeLot, getWindBal, fmtQty, fmtTS, getDyeBalance, getLot, getPackBalance, getWindBalance, getRMReturnedOut, workersSorted } from './core.js';
import { openDyeLifecycle, vtToggleVoided } from './pages.js';

export function vtSelectVendor(v){State.vtSelectedVendor=v;State.vtSelectedLot='';_loadCatalog('lots',()=>{renderVendorV2();});}

export function renderVendorV2(){const _wW=workersSorted();const _wCur=State.currentUser?.name||'';const wOpts=(State.currentUser?.role==='admin'||State.currentUser?.role==='manager'||State.currentUser?.role==='supervisor')?`<option value="">— Select Worker —</option>${_wW.map(w=>`<option value="${w}"${w===_wCur?' selected':''}>${w}</option>`).join('')}`:`<option value="${_wCur}">${_wCur}</option>`;const allLots=_lotsForDropdown();const vendors=[...new Set(allLots.map(l=>l.vendor))].sort();const selVendor=document.getElementById('vt-sel-vendor');const selLot=document.getElementById('vt-sel-lot');const selStatus=document.getElementById('vt-sel-status');const detail=document.getElementById('vt-detail');if(!selVendor||!selLot||!detail)return;if(!vendors.length){selVendor.innerHTML='<option value="">No vendors yet</option>';detail.innerHTML='<div class="vt-empty"><div class="vt-empty-icon">🏭</div><div class="vt-empty-text">No RM lots yet</div></div>';return;}
const curVendorOpts=selVendor.innerHTML;const newVendorOpts='<option value="">— Select Vendor —</option>'+vendors.map(v=>`<option value="${v}"${v===State.vtSelectedVendor?' selected':''}>${v}</option>`).join('');if(curVendorOpts!==newVendorOpts)selVendor.innerHTML=newVendorOpts;const statusFilter=selStatus?.value||'';if(State.vtSelectedVendor){let vendorLots=allLots.filter(l=>l.vendor===State.vtSelectedVendor);if(statusFilter){vendorLots=vendorLots.filter(l=>{const st=vtLotStatus(l.id+'||'+l.grade+'||'+l.vendor);return st===statusFilter;});}
selLot.disabled=false;const lotOpts='<option value="">— Select Lot —</option>'+vendorLots.map(l=>{const key=l.id+'||'+l.grade+'||'+l.vendor;const st=vtLotStatus(key);return`<option value="${key}"${key===State.vtSelectedLot?' selected':''}>${l.id} · ${l.grade} · ${st}</option>`;}).join('');selLot.innerHTML=lotOpts;}else{selLot.disabled=true;selLot.innerHTML='<option value="">— Select Vendor First —</option>';}
if(State.vtSelectedVendor&&State.vtSelectedLot){const parts=State.vtSelectedLot.split('||');const lot=getLotByKey(parts[0],parts[1],parts[2]);if(lot&&lot.id)renderVtLotDetailV2(lot);else detail.innerHTML='<div class="vt-empty"><div class="vt-empty-icon">🏭</div><div class="vt-empty-text">Lot not found</div></div>';}else{detail.innerHTML='<div class="vt-empty"><div class="vt-empty-icon">🏭</div><div class="vt-empty-text">Select vendor and lot above</div></div>';}}

export function renderVtLotDetailV2(l){const detail=document.getElementById('vt-detail');if(!detail)return;const now=new Date();const daysSince=ts=>ts?Math.floor((now-new Date(ts))/86400000):null;const rmBal=getRMBalance(l.id,l.grade,l.vendor);const sIn=getSoftIn(l.id,l.grade,l.vendor);const sOut=getSoftOut(l.id,l.grade,l.vendor);const softWasteKg=Math.max(0,sIn.weight-sOut.weight);const softBal=Qmax0(getSoftBalance(l.id,l.grade,l.vendor));const linkedDyeLots=(State.DB.dyeLots||[]).filter(d=>d.status!=='Voided'&&d.status!=='Void'&&(d.sources||[]).some(s=>s.lotId===l.id&&s.grade===l.grade&&s.vendor===l.vendor));const sentToDyeKg=getSoftConsumedByDye(l.id,l.grade,l.vendor);const totDisp=getDispatched(l.id,l.grade,l.vendor);const daysInFactory=daysSince(l.date);const dyeWasteKg=linkedDyeLots.reduce((a,d)=>a+Math.max(0,(d.totalInWeight||0)-(d.outWeight||0)),0);const windWasteKg=linkedDyeLots.reduce((a,d)=>{return a+(State.DB.windEntries||[]).filter(e=>e.dyeLotId===d.id&&e.status!=='Void'&&e.status!=='Voided'&&e.endTime).reduce((b,e)=>b+Math.max(0,(e.inWeight||0)-(e.outWeight||0)),0);},0);const totalWasteKg=softWasteKg+dyeWasteKg+windWasteKg;const totalInKg=sIn.weight||l.weight;const wasteOverall=totalInKg>0?(totalWasteKg/totalInKg*100).toFixed(1):'0';const status=vtLotStatus(l.id+'||'+l.grade+'||'+l.vendor);const statusC={'Running':'var(--bl)','Dispatched':'var(--gr)','Ready':'var(--ac)','At Dye':'var(--cd)','At Wind':'var(--cw)','At Pack':'var(--cp)'}[status]||'var(--mu)';const shadeGroups={};linkedDyeLots.forEach(d=>{const shade=d.shade||'—';if(!shadeGroups[shade])shadeGroups[shade]=[];shadeGroups[shade].push(d);});const shadeCount=Object.keys(shadeGroups).length;const activeDyeLots=linkedDyeLots.filter(d=>d.status!=='Voided'&&d.status!=='Void');const voidedCount=linkedDyeLots.length-activeDyeLots.length;const heroHTML=`
  <div style="background:var(--s1);border:1px solid var(--b1);border-radius:12px;padding:16px 20px;margin-bottom:12px;"><div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;margin-bottom:12px;"><div><div style="font-size:1.7rem;font-weight:900;color:#fff;letter-spacing:-0.03em;line-height:1">${l.id}</div><div style="font-size:0.7rem;color:var(--mu);margin-top:4px">${l.vendor} · <span style="color:var(--ac);font-weight:700">${l.grade}</span> · ${fmtDate(l.date)}</div><div style="margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><span style="font-size:0.68rem;font-weight:800;padding:3px 10px;border-radius:5px;background:${statusC}18;color:${statusC}">${status}</span>
          ${rmBal.units>0?`<span style="font-size:0.65rem;color:var(--mu)">RM left:<strong style="color:var(--tx)">${rmBal.units}b</strong></span>`:''}
          ${(()=>{const _ret=getRMReturnedOut(l.id,l.grade,l.vendor);return _ret.units>0?`<span style="font-size:0.65rem;color:var(--mu)">Returned:<strong style="color:var(--tx)">${_ret.units}b</strong></span>`:'';})()}
        </div></div><div style="display:flex;gap:20px;flex-wrap:wrap;text-align:center;"><div><div style="font-size:1.8rem;font-weight:900;color:var(--bl);line-height:1">${fmt(l.units)}b<span style="font-size:0.9rem"> / ${fmt(l.weight)}kg</span></div><div style="font-size:0.58rem;color:var(--mu);text-transform:uppercase;letter-spacing:.08em;margin-top:3px">Received</div></div><div><div style="font-size:1.8rem;font-weight:900;color:var(--cd);line-height:1">${shadeCount}</div><div style="font-size:0.58rem;color:var(--mu);text-transform:uppercase;letter-spacing:.08em;margin-top:3px">Shades</div></div><div><div style="font-size:1.8rem;font-weight:900;color:var(--gr);line-height:1">${fmt(totDisp.units)}b<span style="font-size:0.9rem"> / ${fmt(totDisp.weight)}kg</span></div><div style="font-size:0.58rem;color:var(--mu);text-transform:uppercase;letter-spacing:.08em;margin-top:3px">Dispatched</div></div><div><div style="font-size:1.8rem;font-weight:900;color:var(--mu);line-height:1">${daysInFactory}<span style="font-size:0.9rem">d</span></div><div style="font-size:0.58rem;color:var(--mu);text-transform:uppercase;letter-spacing:.08em;margin-top:3px">In Factory</div></div></div></div></div>`;const _apprDyeLots=linkedDyeLots.filter(d=>d.status==='Approved'||d.status==='Edited-Approved');const _dyeProp=(d,val)=>{const r=getVendorRatioForDyeLot(d,l.id,l.grade,l.vendor);return val*r;};const _dyeOutProp=_apprDyeLots.reduce((a,d)=>a+_dyeProp(d,d.outWeight||0),0);const _fStages=[{label:'RM',col:'var(--cr)',val:l.weight,done:Math.max(0,l.weight-(rmBal.weight||0)),waste:0,gain:0},{label:'Soft',col:'var(--cs)',val:l.weight,done:sOut.weight,waste:Math.max(0,sIn.weight-sOut.weight),gain:0},{label:'Dye',col:'var(--cd)',val:l.weight,done:_apprDyeLots.reduce((a,d)=>a+_dyeProp(d,Math.min(d.outWeight||0,d.totalInWeight||d.outWeight||0)),0),waste:0,gain:0},{label:'Wind',col:'var(--cw)',val:l.weight,done:(()=>{return _apprDyeLots.reduce((a,d)=>{const r=getVendorRatioForDyeLot(d,l.id,l.grade,l.vendor);const we=(State.DB.windEntries||[]).filter(e=>e.dyeLotId===d.id&&e.status==='Approved'&&e.endTime);return a+we.reduce((s,e)=>s+(e.outWeight||0),0)*r;},0);})(),waste:0,gain:0},{label:'Pack',col:'var(--cp)',val:l.weight,done:(()=>{const _packed=_apprDyeLots.reduce((a,d)=>a+_dyeProp(d,getTotalPacked(d.id).weight),0);return _packed;})(),waste:0,gain:(()=>{const _packed=_apprDyeLots.reduce((a,d)=>a+_dyeProp(d,getTotalPacked(d.id).weight),0);return Math.max(0,_packed-_dyeOutProp);})()},{label:'Dispatch',col:'var(--gr)',val:l.weight,done:_apprDyeLots.reduce((a,d)=>{const r=getVendorRatioForDyeLot(d,l.id,l.grade,l.vendor);return a+(State.DB.dispatches||[]).filter(x=>x.dyeLotId===d.id&&x.status==='Approved').reduce((s,x)=>s+(x.weight||0),0)*r;},0),waste:0,gain:0},].filter(s=>s.val>0);const stageBarHTML=_fStages.length?('<div style="background:var(--s1);border:1px solid var(--b1);border-radius:10px;padding:12px 16px;margin-bottom:8px;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;"><span style="font-size:0.6rem;font-weight:800;text-transform:uppercase;letter-spacing:0.12em;color:var(--mu)">Flow Progress</span><span style="font-size:0.58rem;color:var(--mu);font-style:italic">Output figures proportionally estimated based on input contribution</span></div><div style="display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap;">'+_fStages.map((s,i)=>{const pct=Math.min(100,s.val>0?Math.round(s.done/s.val*100):0);const _wNote=s.waste>0.01?'<div style="font-size:0.58rem;color:var(--re);margin-top:2px">↓ '+fmt(s.waste)+'kg waste</div>':'';const _gNote=s.gain>0.01?'<div style="font-size:0.58rem;color:var(--gr);margin-top:2px">↑ '+fmt(s.gain)+'kg gain</div>':'';return(i>0?'<span style="color:var(--mu2);font-size:0.8rem;padding-bottom:20px">→</span>':'')
+'<div style="flex:1;min-width:55px;">'
+'<div style="display:flex;justify-content:space-between;margin-bottom:4px;align-items:baseline;">'
+'<span style="font-size:0.68rem;font-weight:800;color:'+s.col+'">'+s.label+'</span>'
+'<span style="font-size:0.68rem;font-weight:700;color:'+(pct>=100?s.col:'var(--mu)')+'">'+pct+'%</span>'
+'</div>'
+'<div style="height:8px;background:var(--b2);border-radius:4px;overflow:hidden;">'
+'<div style="height:100%;width:'+pct+'%;background:'+s.col+';border-radius:4px;transition:width 0.4s;"></div>'
+'</div>'
+'<div style="font-size:0.6rem;color:var(--mu);margin-top:3px">'+fmt(s.done)+'kg / '+fmt(s.val)+'kg</div>'
+_wNote+_gNote
+'</div>';}).join('')+'</div></div>'):'';const softHTML=sIn.units>0?`
  <div style="background:var(--s1);border:1px solid var(--b1);border-left:3px solid var(--cs);border-radius:10px;padding:10px 16px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;"><span style="font-size:0.65rem;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:var(--cs)">💧 Soft</span><div style="display:flex;gap:14px;font-size:0.72rem;flex-wrap:wrap;"><span>In: <strong>${sIn.units}b / ${fmt(sIn.weight)}kg</strong></span><span>Out: <strong style="color:var(--cs)">${sOut.units}b / ${fmt(sOut.weight)}kg</strong></span>
      ${softWasteKg>0.01?`<span style="color:var(--re)">Waste:${fmt(softWasteKg)}kg</span>`:''}
      ${sentToDyeKg>0?`<span style="color:var(--cd)">→ Dye:${fmt(sentToDyeKg)}kg</span>`:''}
      ${softBal.weight>0.01?`<span style="color:var(--ac)">Bal:${fmt(softBal.weight)}kg</span>`:''}
    </div></div>`:'';const dyeSectionHTML=shadeCount>0?`
  <div style="background:var(--s1);border:1px solid var(--b1);border-radius:12px;padding:14px 18px;margin-bottom:8px;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><span style="font-size:0.65rem;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:var(--cd)">🎨 Dye Lots</span><div style="display:flex;gap:10px;font-size:0.68rem;color:var(--mu);"><span>${activeDyeLots.length} active${voidedCount>0?' · '+voidedCount+' voided':''}</span><span>${fmt(sentToDyeKg)}kg sent</span></div></div>
    ${Object.entries(shadeGroups).map(([shade,lots])=>{
      const shadeKey=l.id+'_'+shade.replace(/[^a-zA-Z0-9]/g,'_');
      const activeLots=lots.filter(d=>d.status!=='Voided'&&d.status!=='Void');
      const voidedLots=lots.filter(d=>d.status==='Voided'||d.status==='Void');
      const showVoided=State._vtShowVoided[shadeKey+'_void']||false;
      const expanded=State._vtShowVoided[shadeKey+'_exp']||false;
      const displayLots=showVoided?lots:activeLots;
      const totalInKgShade=activeLots.reduce((a,d)=>{const src=(d.sources||[]).find(s=>s.lotId===l.id&&s.grade===l.grade&&s.vendor===l.vendor);return a+(src?src.weight:0);},0);
      const totalOutKgShade=activeLots.reduce((a,d)=>a+_dyeProp(d,d.outWeight||0),0);
      const totalOutCones=activeLots.reduce((a,d)=>a+Math.round(_dyeProp(d,d.outCones||0)),0);
      const shadePackBal=activeLots.reduce((a,d)=>a+getPackBal(d.id).bags,0);
      const shadeWindBal=activeLots.reduce((a,d)=>a+getWindBal(d.id).weight,0);
      const shadeDisp=activeLots.reduce((a,d)=>a+getTotalDispatched(d.id).bags,0);
      // Status indicator for shade
      const shadeStatus=shadeDisp>0&&shadePackBal===0&&shadeWindBal===0?'Dispatched':shadePackBal>0?'At Pack':shadeWindBal>0?'At Wind':'At Dye';
      const shadeStC={'Dispatched':'var(--gr)','At Pack':'var(--cp)','At Wind':'var(--cw)','At Dye':'var(--cd)'}[shadeStatus];
      return `<div style="border:1px solid var(--b1);border-radius:8px;margin-bottom:6px;overflow:hidden;"><div onclick="vtToggleVoided('${shadeKey}_exp');"
style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;background:var(--s2);transition:background 0.12s;"
onmouseover="this.style.background='var(--s3)'"onmouseout="this.style.background='var(--s2)'"><span style="font-size:0.75rem;font-weight:800;color:var(--ac);min-width:60px">${shade}</span><span style="font-size:0.6rem;font-weight:700;padding:2px 7px;border-radius:4px;background:${shadeStC}18;color:${shadeStC}">${shadeStatus}</span><span style="font-size:0.65rem;color:var(--mu)">${activeLots.length}lot${activeLots.length!==1?'s':''}</span><div style="margin-left:auto;display:flex;gap:10px;align-items:center;font-size:0.68rem;"><span style="color:var(--mu)">In:<strong style="color:var(--tx)">${fmt(totalInKgShade)}kg</strong></span><span style="color:var(--mu)">Out:<strong style="color:var(--cd)">${totalOutCones}c/${fmt(totalOutKgShade)}kg</strong></span>${shadePackBal>0?`<span style="color:var(--cp)">📦 ${shadePackBal}b</span>`:''}
${shadeDisp>0?`<span style="color:var(--gr)">✓ ${shadeDisp}b</span>`:''}<span style="color:var(--mu);font-size:0.7rem">${expanded?'▲':'▼'}</span></div></div>${expanded?`
        <div style="padding:8px 14px;">
          ${voidedLots.length?`<div style="margin-bottom:6px;"><button onclick="event.stopPropagation();vtToggleVoided('${shadeKey}_void');"
style="font-size:0.58rem;padding:2px 8px;border-radius:4px;border:1px solid var(--b2);background:var(--s2);color:var(--mu);cursor:pointer;">${showVoided?'Hide':'Show'}${voidedLots.length}voided</button></div>`:''}
          ${displayLots.map(d=>{
            const pb=getPackBal(d.id);
            const wb=getWindBal(d.id);
            const dp=getTotalDispatched(d.id);
            const src=(d.sources||[]).find(s=>s.lotId===l.id&&s.grade===l.grade&&s.vendor===l.vendor);
            const inKg=src?src.weight:d.totalInWeight||0;
            const isVoided=d.status==='Voided'||d.status==='Void';
            const isEdited=d.status==='Edited-Approved';
            const stC={Pending:'var(--ye)',Approved:'var(--gr)','Edited-Approved':'var(--bl)',Rejected:'var(--re)',Voided:'var(--mu)',Void:'var(--mu)'}[d.status]||'var(--mu)';
            return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;margin-bottom:3px;background:var(--s2);${isVoided?'opacity:0.4;':''}font-size:0.7rem;flex-wrap:wrap;"><span style="font-weight:700;color:var(--ac);min-width:100px;cursor:pointer"onclick="openDyeLifecycle('${d.id}')">${d.dyeLotNo}</span><span style="color:var(--mu);font-size:0.62rem">${fmtTS(d.startTime).split(' ')[0]||'—'}</span><span>In:<strong>${(()=>{const _ic=d.totalInWeight>0?Math.round((d.totalInCones||0)*(inKg/d.totalInWeight)):0;return(_ic>0?_ic+'c / ':'')+fmt(inKg)+'kg';})()}</strong></span><span>Out:<strong style="color:var(--cd)">${(()=>{const _r=d.totalInWeight>0?(inKg/d.totalInWeight):1;const _oc=Math.round((d.outCones||0)*_r);const _ow=(d.outWeight||0)*_r;return(_oc>0?_oc+'c / ':'')+(_ow>0?fmt(_ow)+'kg':'—');})()}</strong></span>${wb.weight>0?`<span style="color:var(--cw)">⟳ ${fmtQty(wb.units,wb.weight,'c')}</span>`:''}
${pb.bags>0?`<span style="color:var(--cp)">📦 ${fmtQty(pb.bags,pb.weight,'b')}</span>`:''}
${dp.bags>0?`<span style="color:var(--gr)">✓ ${fmtQty(dp.bags,dp.weight,'b')}</span>`:''}<span style="margin-left:auto;font-size:0.58rem;padding:1px 6px;border-radius:3px;background:${stC}18;color:${stC}">${isEdited?'Edited':d.status}</span></div>`;
          }).join('')}
        </div>`:''}</div>`;
    }).join('')}
  </div>`:'';const allDisps=(State.DB.dispatches||[]).filter(d=>linkedDyeLots.some(dl=>dl.id===d.dyeLotId)&&d.status==='Approved').sort((a,b)=>(b.timestamp||'').localeCompare(a.timestamp||''));const dispHTML=allDisps.length?`
  <div style="background:var(--s1);border:1px solid var(--b1);border-left:3px solid var(--gr);border-radius:10px;padding:12px 16px;margin-bottom:8px;"><div style="font-size:0.65rem;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:var(--gr);margin-bottom:8px">🚚 Dispatched — ${fmt(totDisp.units)}b / ${fmt(totDisp.weight)}kg</div>
    ${(window._vtDispExpanded?allDisps:allDisps.slice(0,8)).map(d=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--b1);font-size:0.7rem;"><div><span style="font-weight:700">${d.party}</span><span style="color:var(--mu);margin-left:8px;font-size:0.62rem">${fmtTS(d.timestamp).split(' ')[0]}${d.invoiceNo?' · '+d.invoiceNo:''}</span></div><span style="color:var(--gr);font-weight:700">${(()=>{const _dl=linkedDyeLots.find(dl=>dl.id===d.dyeLotId);const _r=_dl?getVendorRatioForDyeLot(_dl,l.id,l.grade,l.vendor):1;return Math.round((d.bags||0)*_r)+'b / '+fmt((d.weight||0)*_r)+'kg';})()}</span></div>`).join('')}
    ${allDisps.length>8?`<div onclick="window._vtDispExpanded=!window._vtDispExpanded;renderVendorV2();"style="font-size:0.62rem;color:var(--ac);margin-top:6px;text-align:center;cursor:pointer;font-weight:700">${window._vtDispExpanded?'▲ Show less':'▼ +'+(allDisps.length-8)+' more dispatches'}</div>`:''}
  </div>`:'';detail.innerHTML=heroHTML+stageBarHTML+softHTML+dyeSectionHTML+dispHTML;}

export function vtLotStatus(lotId){const[_lid,_lg,_lv]=lotId.split('||');if(State.DB.stageEntries.some(e=>e.lotId===_lid&&e.status==='InProgress'))return'Running';const _linkedDL=(State.DB.dyeLots||[]).filter(d=>(d.sources||[]).some(s=>s.lotId===_lid&&s.grade===_lg&&s.vendor===_lv));if(_linkedDL.some(d=>d.status==='InProgress'))return'Running';if((State.DB.windEntries||[]).some(w=>_linkedDL.some(dl=>dl.id===w.dyeLotId)&&w.status==='InProgress'))return'Running';if((State.DB.packEntries||[]).some(p=>_linkedDL.some(dl=>dl.id===p.dyeLotId)&&p.status==='InProgress'))return'Running';const lot=getLotByKey(_lid,_lg,_lv)||getLot(_lid||lotId);const g=lot.grade||_lg||'';const v=lot.vendor||_lv||'';
// Jul 29 2026 fix — real, confirmed inconsistency: this used a 95%
// threshold (disp.units>=lot.units*0.95) to decide "Dispatched", while
// the actual, canonical fullyDispatched definition used everywhere else
// in the app (archiving, balance math) requires essentially exact
// completion. A lot at 95% would show "Dispatched" here while every
// other part of the system still correctly treated it as unfinished.
// Now uses the same cached summary's own fullyDispatched flag when
// available — the single source of truth, not a separate approximation.
const _summaryKeyStr=(_lid||'')+'__'+(g||'').replace(/[^a-zA-Z0-9]/g,'_')+'__'+(v||'').replace(/[^a-zA-Z0-9]/g,'_');
const _cachedSummary=State.DB.lotSummaries&&State.DB.lotSummaries[_summaryKeyStr];
if(_cachedSummary&&_cachedSummary.fullyDispatched)return'Dispatched';
if(_cachedSummary&&!_cachedSummary.fullyDispatched){
  if(getPackBalance(_lid,g,v).units>0)return'Ready';
  if(getWindBalance(_lid,g,v).units>0)return'At Pack';
  if(getDyeBalance(_lid,g,v).units>0)return'At Wind';
  if(getSoftBalance(_lid,g,v).units>0)return'At Dye';
  if(getSoftOut(_lid,g,v).units>0)return'Soft done';
  return'RM';
}
// No cached summary yet — fall back to the same live checks, exact
// match only (not an approximation), matching the canonical definition.
const disp=getDispatched(_lid,g,v);
if(disp.units>=lot.units-0.01&&disp.weight>=lot.weight-0.01)return'Dispatched';if(getPackBalance(_lid,g,v).units>0)return'Ready';if(getWindBalance(_lid,g,v).units>0)return'At Pack';if(getDyeBalance(_lid,g,v).units>0)return'At Wind';if(getSoftBalance(_lid,g,v).units>0)return'At Dye';if(getSoftOut(_lid,g,v).units>0)return'Soft done';return'RM';}

window.renderVendorV2 = renderVendorV2;
