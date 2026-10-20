// worker-view.js — Worker View: the entire simplified, mobile-style
// interface factory workers use — forms for Pack, Wind, Dye, Dispatch,
// their own history view, and every real helper these forms need.
// Aug 26 2026 — Module split effort, planned with Priyam: extracted
// byte-for-byte from pages.js, same real, established pattern as
// every other extraction. Real, complete inventory: 32 functions, all
// genuinely part of the same Worker View domain.

import { SCOL, State, _hydrateDyeLot, _refreshAndRender, apiPost, _fetchTrueSoftAvailable, fmt, fmtHrs, fmtTS, getDeadStockBalance, getDyeBalAvailable, getGradePool, getLot, getLotByKey, getPackBal, getPackBalAvailable, getRCStatus,  getRecycleSteelAvail, getRecycleSoftenedAvail, getTotalPacked, getWindBalAvailable, hrsBetween, parseLotSelectValue, save, setAlert, showToast, stageBalance, today, eligibleWindLots, eligiblePackLots, eligibleDispatchLots, machinesForStage, workersSorted } from './core.js';
import { statusBadge } from './shared.js';
import { getDyeSrcOpts } from './dye.js';
import { wJumpStage, workerStageForm } from './soft.js';
import { getResidualBalance } from './stockregister.js';
import { currentFY, stageColor, _postWithDuplicateCheck } from './pages.js';

export function renderWorkerView(){const u=State.currentUser;document.getElementById('wv-av').textContent=u.name[0].toUpperCase();document.getElementById('wv-name').textContent=u.name;document.getElementById('wv-role').textContent=u.stage==='all'?'All Stages':u.stage+' Operator';const stages=u.stage==='all'?['Soft','Dye','Wind','Pack','Dispatch']:u.stage.split(',').map(s=>s.trim());const mOptsFor=stage=>machinesForStage(stage).map(v=>`<option value="${v}">${v}</option>`).join('');const wOpts=`<option value="${State.currentUser?.name||''}">${State.currentUser?.name||''}</option>`;const todayStr=today();const myStage=State.DB.stageEntries.filter(e=>e.startWorker===u.name&&(e.startTime||'').startsWith(todayStr));const myWind=(State.DB.windEntries||[]).filter(e=>e.startWorker===u.name&&(e.startTime||'').startsWith(todayStr));const myPack=(State.DB.packEntries||[]).filter(e=>e.worker===u.name&&(e.timestamp||'').startsWith(todayStr));const myDisp=(State.DB.dispatches||[]).filter(e=>e.by===u.name&&(e.timestamp||'').startsWith(todayStr));const todayEntries=myStage.length+myWind.length+myPack.length+myDisp.length;const todayKg=[...myStage,...myWind,...myPack].reduce((a,e)=>a+(e.outWeight||e.weight||0),0);let stageNav='';if(stages.length>1){stageNav=`<div style="display:flex;gap:6px;overflow-x:auto;padding:0 0 8px 0;-webkit-overflow-scrolling:touch;margin-bottom:4px">
      ${stages.map((s,i)=>`<button onclick="wJumpStage('${s}')"id="wjmp-${s}"style="flex-shrink:0;padding:6px 14px;border-radius:20px;border:1px solid var(--b2);background:${i===0?'var(--ac)':'var(--s2)'};color:${i===0?'#000':'var(--tx)'};font-size:0.72rem;font-weight:700;cursor:pointer">${s}</button>`).join('')}
    </div>`;}
let html=`
    <div style="background:var(--s2);border-radius:12px;padding:12px 16px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center"><div><div style="font-size:0.65rem;color:var(--mu);font-weight:700;text-transform:uppercase;letter-spacing:.08em">Today's Activity</div><div style="font-size:1.1rem;font-weight:800;color:var(--ac);font-family:monospace">${todayEntries} entries</div></div><div style="text-align:right"><div style="font-size:0.65rem;color:var(--mu);font-weight:700;text-transform:uppercase;letter-spacing:.08em">Output</div><div style="font-size:1.1rem;font-weight:800;color:var(--gr);font-family:monospace">${fmt(todayKg)}kg</div></div></div>
    ${stageNav}`;stages.forEach(s=>{if(s==='Soft')html+=workerStageForm(s,mOptsFor('Soft'),wOpts);else if(s==='Wind')html+=workerWindForm(mOptsFor('Wind'));else if(s==='Pack')html+=workerPackForm();else if(s==='Dye')html+=workerDyeForm(mOptsFor('Dye'),wOpts);else if(s==='Dispatch')html+=workerDispForm();});html+=workerMyHistory();document.getElementById('wv-body').innerHTML=html;document.querySelectorAll('.wv-body input[type=date]').forEach(el=>{if(!el.value)el.value=today();});if(stages.length>1)wJumpStage(stages[0]);}

export function workerPackForm(){const _wW=workersSorted();const wOpts=(State.currentUser?.role==='admin'||State.currentUser?.role==='manager'||State.currentUser?.role==='supervisor')?`<option value="">— Select Worker —</option>${_wW.map(w=>`<option value="${w}">${w}</option>`).join('')}`:`<option value="${State.currentUser?.name||''}"> ${State.currentUser?.name||''}</option>`;const availDyeLots=eligiblePackLots();const dyeLotOpts=availDyeLots.map(d=>{const _wb=getWindBalAvailable(d.id);return`<option value="${d.id}">${d.dyeLotNo} — ${d.shade} (${_wb.units||0}c / ${fmt(_wb.weight)}kg avail)</option>`;}).join('');return`<div class="wstage-card" style="border-color:var(--cp)20"><div class="wstage-title" style="color:var(--cp)">📦 Pack</div><div class="wfield"><label>Dye Lot</label><select class="wselect" id="w-pack-lot" onchange="wPackLotChange()"><option value="">Select dye lot...</option>${dyeLotOpts}</select></div><div id="w-pack-lot-info" style="font-size:0.72rem;color:var(--mu);padding:4px 0;"></div><div class="wfield"><label>Cones In *</label><input class="winp" type="number" id="w-pack-in-cones" placeholder="0 cones from winding"></div><div class="wfield"><label>In Weight (kg) *</label><input class="winp" type="number" id="w-pack-in-weight" step="0.01" placeholder="0.00"></div><div class="wfield"><label>Bags (new count)</label><input class="winp" type="number" id="w-pack-bags" placeholder="No. of bags"></div><div class="wfield"><label>Weight (kg)</label><input class="winp" type="number" id="w-pack-weight" step="0.01" placeholder="0.00"></div><div class="wfield"><label>Worker</label><select class="wselect" id="w-pack-worker"><option value="">Select...</option>${wOpts}</select></div><div class="wfield"><label>Notes</label><textarea class="winp" id="w-pack-notes" rows="2" placeholder="Optional..."></textarea></div><div id="w-pack-alert" class="walert"></div><button class="wbtn" id="w-pack-submit-btn" onclick="wSubmitPack()">📦 Save Pack Entry</button></div>`;}

export function workerWindForm(mOpts){const _wW=workersSorted();const _wCur=State.currentUser?.name||'';const wOpts=(State.currentUser?.role==='admin'||State.currentUser?.role==='manager'||State.currentUser?.role==='supervisor')?`<option value="">— Select Worker —</option>${_wW.map(w=>`<option value="${w}"${w===_wCur?' selected':''}>${w}</option>`).join('')}`:`<option value="${_wCur}">${_wCur}</option>`;const availDyeLots=eligibleWindLots();const dyeLotOpts=availDyeLots.map(d=>{const _db=getDyeBalAvailable(d.id);return`<option value="${d.id}">${d.dyeLotNo} — ${d.shade} (${_db.units||0}c / ${_db.weight}kg avail)</option>`;}).join('');const inProgWind=(State.DB.windEntries||[]).filter(e=>e.status==='InProgress');const ipOpts=inProgWind.map(e=>`<option value="${e.id}">${e.id} — ${e.dyeLotNo} — ${fmt(e.inWeight)}kg in</option>`).join('');return`<div class="wstage-card" style="border-color:var(--cw)20"><div class="wstage-title" style="color:var(--cw)">🌀 Wind</div><div class="wtab-bar"><button class="wtab active" onclick="wTab(this,'wwind-start','wwind-end')">▶ Start</button><button class="wtab" onclick="wTab(this,'wwind-end','wwind-start')">✓ End</button></div><div id="wwind-start"><div class="wfield"><label>Dye Lot</label><select class="wselect" id="w-wind-lot" onchange="wWindLotChange()"><option value="">Select dye lot...</option>${dyeLotOpts}</select></div><div id="w-wind-lot-info" style="font-size:0.72rem;color:var(--mu);padding:4px 0;"></div><div class="wfield"><label>Cones In *</label><input class="winp" type="number" id="w-wind-in-cones" placeholder="0 cones"></div><div class="wfield"><label>Input Weight (kg)</label><input class="winp" type="number" id="w-wind-in-weight" step="0.01" placeholder="0.00"></div><div class="wfield"><label>Machine</label><select class="wselect" id="w-wind-machine"><option value="">Select...</option>${mOpts}</select></div><div class="wfield"><label>Worker</label><select class="wselect" id="w-wind-worker"><option value="">Select...</option>${wOpts}</select></div><div class="wfield"><label>Notes (optional)</label><input class="winp" id="w-wind-start-note" placeholder="Optional notes..."></div><div id="w-wind-alert" class="walert"></div><button class="wbtn" id="w-wind-start-btn" onclick="wSubmitWindStart()">▶ Start Wind</button></div><div id="wwind-end" style="display:none">
      ${ipOpts?`<div class="wfield"><label>Select In-Progress Wind Entry</label><select class="wselect"id="w-wind-end-sel"><option value="">Select...</option>${ipOpts}</select></div><div class="wfield"><label>Cones Out*</label><input class="winp"type="number"id="w-wind-out-cones"placeholder="0 cones"></div><div class="wfield"><label>Output Weight(kg)</label><input class="winp"type="number"id="w-wind-out-weight"step="0.01"placeholder="0.00"></div><div class="wfield"><label>Worker</label><select class="wselect"id="w-wind-end-worker"><option value="">Select...</option>${wOpts}</select></div><div id="w-wind-end-alert"class="walert"></div><button class="wbtn" id="w-wind-end-btn" onclick="wSubmitWindEnd()">✓ End Wind</button>`
      :'<div style="padding:16px;text-align:center;color:var(--mu);font-size:0.8rem">No in-progress wind entries</div>'}
    </div></div>`;}

export function workerDyeForm(mOpts,wOpts=''){const gradeOpts=[...new Set(State.DB.lots.map(l=>l.grade))].map(g=>`<option value="${g}">${g} — Pool: ${fmt(getGradePool(g).units)}u</option>`).join('');const inProg=(State.DB.dyeLots||[]).filter(b=>b.status==='InProgress');const ipOpts=inProg.map(b=>`<option value="${b.id}">${b.id} — ${b.machine} — ${fmt(b.totalInWeight)}kg — ${fmtTS(b.startTime)}</option>`).join('');const _wdyFY=currentFY();const _wdyPrevFY=String(parseInt(_wdyFY.slice(0,2))-1)+String(parseInt(_wdyFY.slice(2))-1);const _wdyFYOpts=[_wdyFY,_wdyPrevFY].map(f=>`<option value="${f}"${f===_wdyFY?' selected':''}>${f.slice(0,2)}-${f.slice(2)}</option>`).join('');return`<div class="wstage-card" style="border-color:${stageColor('Dye')}20"><div class="wstage-hdr"><div class="wstage-icon">🎨</div><div><div class="wstage-name">Dye Batch</div><div class="wstage-sub">Start = input lots + formula | End = output quantity</div></div></div><div id="w-Dye-alert"></div><div class="tabs" style="margin-bottom:12px;"><div class="tab active" onclick="wSwitchTab('Dye','start',this)">▶ Start</div><div class="tab" onclick="wSwitchTab('Dye','end',this)">End</div></div><div id="w-Dye-start-tab"><div class="wfield"><label>Grade *</label><select id="w-dye-grade" onchange="refreshWDyeLots()">${gradeOpts}</select></div><div id="w-dye-src-1"><div class="wfield"><label>Source Lot 1</label><select id="w-dye-lot1" onchange="wDyeCalcTotal()"><option value="">— Select grade first —</option></select></div><div class="w2col"><div class="wfield"><label>Units</label><input id="w-dye-u1" type="number" placeholder="0" oninput="wDyeCalcTotal()"></div><div class="wfield"><label>Weight (kg)</label><input id="w-dye-w1" type="number" placeholder="0"></div></div></div><div id="w-dye-src-2" style="display:none"><div class="wfield"><label>Source Lot 2 (optional)</label><select id="w-dye-lot2"><option value="">None</option></select></div><div class="w2col"><div class="wfield"><label>Units</label><input id="w-dye-u2" type="number" placeholder="0" oninput="wDyeCalcTotal()"></div><div class="wfield"><label>Weight (kg)</label><input id="w-dye-w2" type="number" placeholder="0"></div></div></div><button class="btn btn-ghost btn-sm" style="margin-bottom:12px;width:100%" onclick="document.getElementById('w-dye-src-2').style.display='block'">+ Add 2nd Lot</button><div class="wavail"><span class="wavail-label">Total input</span><span class="wavail-val" id="w-dye-total" style="color:var(--ac)">0u</span></div>
      ${(()=>{const ds=dyeQualifyingDeadStock();const rc=dyeQualifyingRecycleStock();const rs=dyeQualifyingResidualStock();if(!ds.length&&!rc.length&&!rs.length)return'';
        const dsOpts=ds.map(d=>`<option value="${d.id}">${d.id} — ${d.grade} (${fmt(getDeadStockBalance(d.id))}kg avail)</option>`).join('');
        const rcOpts=rc.map(r=>`<option value="${r.id}">${r.id} — ${r.dyeLotNo} — ${r.shade} (steel ${getRecycleSteelAvail(r.id).units}c/${fmt(getRecycleSteelAvail(r.id).weight)}kg, softened ${getRecycleSoftenedAvail(r.id).units}c/${fmt(getRecycleSoftenedAvail(r.id).weight)}kg)</option>`).join('');
        const rsOpts=rs.map(r=>`<option value="${r.id}">${r.grade} (${fmt(getResidualBalance(r.id))}kg avail)</option>`).join('');
        return'<div style="border-top:1px solid var(--b1);padding-top:10px;margin-top:8px"><div style="font-size:0.68rem;font-weight:700;color:var(--mu);margin-bottom:8px">OTHER SOURCES (optional)</div>'
          +(ds.length?`<div id="w-dye-ds-list" data-opts="${encodeURIComponent(dsOpts)}"></div><button class="btn btn-ghost btn-xs" style="margin-bottom:8px" onclick="wDyeAddSourceRow('ds','📦 Dead Stock')">+ Add Dead Stock</button>`:'')
          +(rc.length?`<div id="w-dye-rc-list" data-opts="${encodeURIComponent(rcOpts)}"></div><button class="btn btn-ghost btn-xs" style="margin-bottom:8px" onclick="wDyeAddSourceRow('rc','♻ Recycle')">+ Add Recycle</button>`:'')
          +(rs.length?`<div id="w-dye-rs-list" data-opts="${encodeURIComponent(rsOpts)}"></div><button class="btn btn-ghost btn-xs" style="margin-bottom:8px" onclick="wDyeAddSourceRow('rs','Residual')">+ Add Residual</button>`:'')
          +'</div>';
      })()}
      <div class="wfield"><label>Machine</label><select id="w-dye-mach">${mOpts}</select></div><div class="wfield"><label>Worker (Dye Master) *</label><select id="w-dye-worker">${wOpts}</select></div><div class="wfield"><label>Formula / Notes (Dye Master)</label><textarea id="w-dye-notes" placeholder="Dye formula, chemicals, shade, pH..."></textarea></div><button class="wsubmit" onclick="wSubmitDyeStart()">▶ Record Dye Start</button></div><div id="w-Dye-end-tab" style="display:none;">
      ${inProg.length
        ? `<div class="wfield"><label>In-Progress Dye Batch*</label><select id="w-dye-ip"onchange="wShowDyeEndRef()"><option value="">Select batch</option>${ipOpts}</select></div><div id="w-dye-end-ref"style="display:none;background:var(--s2);border:1px solid var(--b2);border-radius:9px;padding:12px;margin-bottom:10px;"></div><div class="wfield"><label>Shade Name / No *</label><input class="winp" id="w-dye-end-shade" placeholder="e.g. Navy Blue 300, Red 45..."></div><div class="w2col"><div class="wfield"><label>FY *</label><select class="wselect" id="w-dye-end-fy">${_wdyFYOpts}</select></div><div class="wfield"><label>Serial No *</label><input class="winp" type="number" min="1" id="w-dye-end-serial" placeholder="e.g. 101" oninput="wOnDyeEndSerialInput()"></div></div><div class="wfield"><label>Sub (optional)</label><input class="winp" id="w-dye-end-sub" placeholder="e.g. A"></div>`
        : '<div class="walert info">No in-progress dye batches. Start one first.</div>'}
      <div class="w2col"><div class="wfield"><label>Out Bags *</label><input id="w-dye-out-u" type="number" placeholder="0"></div><div class="wfield"><label>Output Weight (kg)</label><input id="w-dye-out-w" type="number" placeholder="0"></div></div><div class="wfield"><label>Formula / Notes (End) *</label><textarea id="w-dye-end-notes" rows="3" placeholder="Confirm formula used or describe what changed — required" style="width:100%;background:var(--s2);border:1px solid rgba(168,85,247,0.3);color:var(--tx);padding:12px;font-family:'Manrope',sans-serif;font-size:0.9rem;border-radius:9px;outline:none;resize:vertical;"></textarea><div style="font-size:0.62rem;color:var(--mu);margin-top:3px;">Required — confirm dye formula or note any changes from start</div></div><button class="wsubmit" id="w-dye-end-submit-btn" onclick="wSubmitDyeEnd()">Record Dye End</button></div></div>`;}

export function workerDispForm(){const eligibleDyeLots=eligibleDispatchLots();
// Searchable dispatch lot dropdown built per row in renderDispatchLotRows
const lotOpts=eligibleDyeLots.map(d=>{const pb=getPackBalAvailable(d.id);const grades=(d.sources||[]).map(s=>s.grade).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join('+');return`<option value="${d.id}">${d.dyeLotNo}${grades?' ('+grades+')':''} — ${pb.units}b ${fmt(pb.weight)}kg avail</option>`;}).join('');return`<div class="wstage-card" style="border-color:${stageColor('Dispatch')}20"><div class="wstage-hdr"><div class="wstage-icon">🚚</div><div><div class="wstage-name">Dispatch</div><div class="wstage-sub">Send to party</div></div></div><div id="w-Dispatch-alert"></div><div class="wfield"><label>Party *</label><select id="w-disp-party"><option value="">Select Party</option>${(State.DB.parties||[]).map(v=>`<option value="${v}">${v}</option>`).join('')}</select></div><div class="wfield"><label>Invoice / Challan No *</label><input id="w-disp-invoice" placeholder="e.g. INV-2627-045"></div><div id="w-disp-lots"><div class="w-disp-row"><div class="wfield"><label>Dye Lot *</label><select class="w-disp-lot-sel" onchange="wDispRowAvail(this)"><option value="">Select</option>${lotOpts}</select></div><div class="wavail"><span class="wavail-label">Pack balance</span><span class="wavail-val w-disp-row-avail" style="color:var(--mu)">—</span></div><div class="w2col"><div class="wfield"><label>Bags *</label><input class="w-disp-row-units" type="number" placeholder="0"></div><div class="wfield"><label>Weight (kg)</label><input class="w-disp-row-weight" type="number" placeholder="0"></div></div></div></div><button class="btn btn-ghost btn-sm" style="margin:8px 0;width:100%" onclick="wDispAddLotRow()">+ Add Another Lot</button><button class="wsubmit" id="w-disp-submit-btn" onclick="wSubmitDisp()">Confirm Dispatch →</button></div>`;}

export function workerMyHistory(){const name=State.currentUser?.name||'';const all=[...State.DB.stageEntries.filter(e=>e.startWorker===name||e.endWorker===name).map(e=>({...e,_type:e.stage||'Soft',_label:e.lotId,_ts:e.startTime})),...(State.DB.windEntries||[]).filter(e=>e.startWorker===name).map(e=>({...e,_type:'Wind',_label:e.dyeLotNo||e.dyeLotId,_ts:e.startTime})),...(State.DB.packEntries||[]).filter(e=>e.worker===name).map(e=>({...e,_type:'Pack',_label:e.dyeLotNo||e.dyeLotId,_ts:e.timestamp})),...(State.DB.dispatches||[]).filter(e=>e.by===name).map(e=>({...e,_type:'Dispatch',_label:(e.dyeLotNo||'')+'→'+e.party,_ts:e.timestamp})),].sort((a,b)=>(b._ts||'').localeCompare(a._ts||'')).slice(0,8);if(!all.length)return'<div style="padding:14px;text-align:center;color:var(--mu);font-size:0.78rem">No entries yet today</div>';const stageCol={Soft:'var(--cs)',Dye:'var(--cd)',Wind:'var(--cw)',Pack:'var(--cp)',Dispatch:'var(--gr)'};return`<div class="w-history"><div class="w-hist-title">My Recent Entries</div>
    ${all.map(e=>`<div class="w-hist-row"style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--b1)"><div><span style="font-size:0.65rem;font-weight:700;color:${stageCol[e._type]||'var(--ac)'};background:${stageCol[e._type]||'var(--ac)'}15;padding:2px 6px;border-radius:4px;margin-right:6px">${e._type}</span><span style="font-size:0.75rem;color:var(--tx)">${e._label||'—'}</span></div><div style="display:flex;align-items:center;gap:6px"><span style="font-size:0.65rem;color:var(--mu)">${(e._ts||'').slice(0,10)}</span>${statusBadge(e.status)}</div></div>`).join('')}
  </div>`;}

export function wTab(el,showId,hideId){const card=el.closest('.wstage-card')||el.closest('.wv-body')||document.body;card.querySelectorAll('.wtab').forEach(t=>t.classList.remove('active'));el.classList.add('active');const showEl=document.getElementById(showId);const hideEl=document.getElementById(hideId);if(showEl)showEl.style.display='';if(hideEl)hideEl.style.display='none';}

export function wPackLotChange(){const id=document.getElementById('w-pack-lot')?.value;const info=document.getElementById('w-pack-lot-info');if(!id||!info){if(info)info.textContent='';return;}
const lot=(State.DB.dyeLots||[]).find(d=>d.id===id);if(!lot){info.textContent='';return;}
const packed=getTotalPacked(id);const _wbi=getWindBalAvailable(id);info.textContent=`${lot.dyeLotNo} — Wind bal: ${_wbi.units||0}c / ${fmt(_wbi.weight)}kg — Packed so far: ${fmt(packed.bags)}b / ${fmt(packed.weight)}kg`;}

export async function wSubmitPack(){const setAlert=msg=>{const el=document.getElementById('w-pack-alert');if(el)el.textContent=msg;};const dyeLotId=document.getElementById('w-pack-lot')?.value;const bags=parseInt(document.getElementById('w-pack-bags')?.value)||0;const weight=parseFloat(document.getElementById('w-pack-weight')?.value)||0;const worker=document.getElementById('w-pack-worker')?.value;const notes=document.getElementById('w-pack-notes')?.value||'';if(!dyeLotId){setAlert('Select dye lot');return;}
if(bags<=0){setAlert('Enter bag count');return;}
if(weight<=0){setAlert('Enter weight');return;}
if(!worker){setAlert('Select worker');return;}
const inCones=parseInt(document.getElementById('w-pack-in-cones')?.value)||0;const inW=parseFloat(document.getElementById('w-pack-in-weight')?.value)||0;if(inW<=0){setAlert('Enter input weight');return;}
const _packDup=(State.DB.packEntries||[]).find(e=>e.dyeLotId===dyeLotId&&e.status==='Pending');if(_packDup){if(!confirm(`⚠ ${dyeLotId} already has a Pack entry PENDING approval\nSubmitted: ${fmtTS(_packDup.timestamp)} by ${_packDup.worker||'?'}\n\nAdd another pack entry anyway?`))return;}
const _btn=document.getElementById('w-pack-submit-btn');if(_btn)_btn.disabled=true;
setAlert('');
try{
  const {ok,data,error,networkError}=await _postWithDuplicateCheck('/api/pack',{dyeLotId,inCones,inWeight:inW,bags,weight,worker,notes,changedBy:State.currentUser.name,idempotencyKey:crypto.randomUUID()});
  if(networkError)throw new Error(error);
  if(!ok){if(error!=='__cancelled_by_user__')setAlert(error||'Failed to save pack entry');if(_btn)_btn.disabled=false;return;}
  if(_btn)_btn.disabled=false;wSetAlert('Pack','✓ Pack entry saved — pending approval','ok');await _refreshAndRender(['packEntries'],renderWorkerView);
}catch(e){setAlert('Network error — not saved: '+e.message);if(_btn)_btn.disabled=false;}}

export async function wSubmitWindEnd(){const setAlert=msg=>{const el=document.getElementById('w-wind-end-alert');if(el)el.textContent=msg;};const entryId=document.getElementById('w-wind-end-sel')?.value;const outW=parseFloat(document.getElementById('w-wind-out-weight')?.value)||0;const worker=document.getElementById('w-wind-end-worker')?.value;if(!entryId){setAlert('Select entry');return;}
if(outW<=0){setAlert('Enter output weight');return;}
if(!worker){setAlert('Select worker');return;}
const outCones=parseInt(document.getElementById('w-wind-out-cones')?.value)||0;
const _btn=document.getElementById('w-wind-end-btn')||document.querySelector('#wwind-end .wbtn');if(_btn)_btn.disabled=true;
try{
  const {ok,data,error,networkError}=await apiPost('/api/wind/end',{id:entryId,outCones,outWeight:outW,notes:'',idempotencyKey:crypto.randomUUID()});
  if(networkError)throw new Error(error);
  if(!ok){setAlert(error||'Failed to end wind entry');if(_btn)_btn.disabled=false;return;}
  if(_btn)_btn.disabled=false;wSetAlert('Wind','✓ Wind ended — pending approval','ok');await _refreshAndRender(['windEntries'],renderWorkerView);
}catch(e){setAlert('Network error — not saved: '+e.message);if(_btn)_btn.disabled=false;}}

export async function wSubmitWindStart(){const setAlert=msg=>{const el=document.getElementById('w-wind-alert');if(el)el.textContent=msg;};const dyeLotId=document.getElementById('w-wind-lot')?.value;const inW=parseFloat(document.getElementById('w-wind-in-weight')?.value)||0;const machine=document.getElementById('w-wind-machine')?.value;const worker=document.getElementById('w-wind-worker')?.value;const notes=document.getElementById('w-wind-start-note')?.value.trim()||'';if(!dyeLotId){setAlert('Select dye lot');return;}
if(inW<=0){setAlert('Enter input weight');return;}
if(!machine){setAlert('Select machine');return;}
if(!worker){setAlert('Select worker');return;}
const inCones=parseInt(document.getElementById('w-wind-in-cones')?.value)||0;
const _windDup=(State.DB.windEntries||[]).find(e=>e.dyeLotId===dyeLotId&&e.status==='InProgress');if(_windDup){const _elapsed=hrsBetween(_windDup.startTime,new Date().toISOString());if(!confirm(`⚠ ${dyeLotId} already has a Wind entry IN PROGRESS\nStarted: ${fmtTS(_windDup.startTime)} by ${_windDup.startWorker||'?'}\nRunning for: ${fmtHrs(_elapsed)}\n\nStart another run anyway? (only do this if machines are different)`))return;}
const _btn=document.getElementById('w-wind-start-btn');if(_btn)_btn.disabled=true;
setAlert('');
try{
  const {ok,data,error,networkError}=await _postWithDuplicateCheck('/api/wind/start',{dyeLotId,inCones,inWeight:inW,machine,worker,notes,changedBy:State.currentUser.name,idempotencyKey:crypto.randomUUID()});
  if(networkError)throw new Error(error);
  if(!ok){if(error!=='__cancelled_by_user__')setAlert(error||'Failed to start wind entry');if(_btn)_btn.disabled=false;return;}
  if(_btn)_btn.disabled=false;wSetAlert('Wind','✓ Wind started');renderWorkerView();
}catch(e){setAlert('Network error — not saved: '+e.message);if(_btn)_btn.disabled=false;}}

export function wWindLotChange(){const id=document.getElementById('w-wind-lot')?.value;const info=document.getElementById('w-wind-lot-info');if(!id||!info){if(info)info.textContent='';return;}
const lot=(State.DB.dyeLots||[]).find(d=>d.id===id);if(!lot){info.textContent='';return;}
const _wb=getDyeBalAvailable(id);info.textContent=`${lot.dyeLotNo} — ${lot.shade} — Available: ${_wb.units||0} cones / ${fmt(_wb.weight)}kg`;}

export function wSwitchTab(stage,tab,el){document.getElementById(`w-${stage}-start-tab`).style.display=tab==='start'?'':'none';document.getElementById(`w-${stage}-end-tab`).style.display=tab==='end'?'':'none';el.parentNode.querySelectorAll('.wtab').forEach(t=>t.classList.remove('active'));el.classList.add('active');if(tab==='end'){if(stage==='Dye'){const sel=document.getElementById('w-dye-ip');if(sel){const opts=[...sel.options].filter(o=>o.value);if(opts.length===1){sel.value=opts[0].value;wShowDyeEndRef();}}}else{const sel=document.getElementById(`w-${stage}-ip`);if(sel){const opts=[...sel.options].filter(o=>o.value);if(opts.length===1){sel.value=opts[0].value;wShowEndRef(stage);}}}}}

export function wShowDyeEndRef(){const sel=document.getElementById('w-dye-ip');const ref=document.getElementById('w-dye-end-ref');const outU=document.getElementById('w-dye-out-u');const outW=document.getElementById('w-dye-out-w');if(!sel||!ref)return;const id=sel.value;if(!id){ref.style.display='none';return;}
const b=(State.DB.dyeLots||[]).find(x=>x.id===id);if(!b){ref.style.display='none';return;}
const elapsed=hrsBetween(b.startTime,new Date().toISOString());const _refGrades=[...new Set((b.sources||[]).map(s=>s.grade).filter(Boolean))].join(' / ')||'—';const sourcesText=(b.sources||[]).map(s=>`${s.lotId}(${fmt(s.cones||0)}c)`).join(' + ')||'—';ref.style.display='block';ref.innerHTML=`
    <div style="font-size:.58rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--cd);margin-bottom:8px;">📋 Batch Reference</div><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px;"><div><div style="font-size:.6rem;color:var(--mu)">Grade</div><div style="font-size:.85rem;font-weight:700;color:var(--ac)">${_refGrades}</div></div><div><div style="font-size:.6rem;color:var(--mu)">Total Input</div><div style="font-size:.85rem;font-weight:700;color:var(--bl)">${fmt(b.totalInCones)}c</div><div style="font-size:.62rem;color:var(--mu)">${fmt(b.totalInWeight)}kg</div></div><div><div style="font-size:.6rem;color:var(--mu)">Running Time</div><div style="font-size:.78rem;font-weight:700;color:var(--cy)">${fmtHrs(elapsed)}</div><div style="font-size:.6rem;color:var(--mu)">by ${b.startWorker||'—'}</div></div><div><div style="font-size:.6rem;color:var(--mu)">RM Lot</div><div style="font-size:.7rem;font-weight:600;color:var(--ac)">${(b.sources||[]).filter(s=>s.lotId&&s.sourceType!=='recycle'&&!s.recycleId).map(s=>s.lotId).join(' / ')||'—'}</div></div><div style="grid-column:span 2"><div style="font-size:.6rem;color:var(--mu)">Vendor</div><div style="font-size:.7rem;font-weight:600">${(b.sources||[]).filter(s=>s.vendor&&s.sourceType!=='recycle'&&!s.recycleId).map(s=>s.vendor).join(' / ')||'—'}</div></div></div>
    ${(b.startNote??b.notes)?`<div style="padding:6px 9px;background:rgba(168,85,247,.08);border-radius:5px;font-size:.68rem;color:var(--cd);border-left:2px solid var(--cd)">📋 Formula:${(b.startNote??b.notes)}</div>`:''}
    <div style="margin-top:8px;padding:6px 9px;background:rgba(59,130,246,.08);border-radius:5px;font-size:.68rem;color:var(--bl);">
      Max output: <strong>${fmt(b.totalInCones)}c / ${fmt(b.totalInWeight)}kg</strong></div>`;if(outU){outU.max=b.totalInCones;outU.placeholder=`0 – ${fmt(b.totalInCones)}`;}
if(outW){outW.max=b.totalInWeight;outW.placeholder=`0 – ${fmt(b.totalInWeight)}`;}}

export function wShowEndRef(stage){const sel=document.getElementById(`w-${stage}-ip`);const ref=document.getElementById(`w-${stage}-ref`);const outU=document.getElementById(`w-${stage}-out-u`);const outW=document.getElementById(`w-${stage}-out-w`);if(!sel||!ref)return;const id=sel.value;if(!id){ref.style.display='none';return;}
const e=State.DB.stageEntries.find(x=>x.id===id);if(!e){ref.style.display='none';return;}
const elapsed=hrsBetween(e.startTime,new Date().toISOString());const SCOL={Soft:'var(--cs)',Wind:'var(--cw)',Pack:'var(--cp)'};const c=SCOL[stage]||'var(--ac)';ref.style.display='block';ref.innerHTML=`
    <div style="font-size:.58rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:${c};margin-bottom:8px;">📋 Start Reference</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;"><div><div style="font-size:.6rem;color:var(--mu)">Lot / Grade</div><div style="font-size:.85rem;font-weight:700;color:#fff">${e.lotId}</div><div style="font-size:.62rem;color:var(--mu)">${e.grade||''}</div></div><div><div style="font-size:.6rem;color:var(--mu)">Input Loaded</div><div style="font-size:.95rem;font-weight:700;color:var(--bl)">${fmt(e.inUnits)}u</div><div style="font-size:.62rem;color:var(--mu)">${fmt(e.inWeight)}kg</div></div><div><div style="font-size:.6rem;color:var(--mu)">Machine</div><div style="font-size:.78rem;font-weight:600">${e.machine||'—'}</div></div><div><div style="font-size:.6rem;color:var(--mu)">Running Time</div><div style="font-size:.78rem;font-weight:700;color:var(--cy)">${fmtHrs(elapsed)}</div><div style="font-size:.6rem;color:var(--mu)">Started by ${e.startWorker||'—'}</div></div></div><div style="margin-top:8px;padding:6px 9px;background:rgba(59,130,246,.08);border-radius:5px;font-size:.68rem;color:var(--bl);">
      Max output: <strong>${fmt(e.inUnits)}u / ${fmt(e.inWeight)}kg</strong></div>`;if(outU){outU.max=e.inUnits;outU.placeholder=`0 – ${fmt(e.inUnits)}`;}
if(outW){outW.max=e.inWeight;outW.placeholder=`0 – ${fmt(e.inWeight)}`;}}

export function wUpdateAvail(stage){const _wuaRaw=document.getElementById(`w-${stage}-lot-start`)?.value||'';const{lotId,grade:_wuaGrade,vendor:_wuaVendor}=parseLotSelectValue(_wuaRaw);if(!lotId){document.getElementById(`w-${stage}-avail-start`).style.display='none';return;}
const _wssL=getLotByKey(lotId,_wuaGrade,_wuaVendor)||getLot(lotId);const bal=stageBalance(lotId,stage,_wssL.grade,_wssL.vendor);const el=document.getElementById(`w-${stage}-avail-start`);if(el){el.style.display='flex';el.querySelector('.wavail-val').textContent=`${fmt(bal.units)}b / ${fmt(bal.weight)}kg`;el.querySelector('.wavail-val').style.color=bal.units>0?'var(--gr)':'var(--re)';}}

export function wDispRowAvail(sel){const row=sel.closest('.w-disp-row');if(!row)return;const dyeLotId=sel.value||'';const pb=dyeLotId?getPackBal(dyeLotId):{bags:0,weight:0};const el=row.querySelector('.w-disp-row-avail');if(el){el.textContent=dyeLotId?`${pb.units}b / ${fmt(pb.weight)}kg avail`:'—';el.style.color=pb.weight>0?'var(--gr)':'var(--re)';}}

export function wDispAddLotRow(){const list=document.getElementById('w-disp-lots');if(!list)return;const first=list.querySelector('.w-disp-row');if(!first)return;const clone=first.cloneNode(true);clone.querySelectorAll('input').forEach(i=>i.value='');clone.querySelectorAll('select').forEach(s=>s.value='');const av=clone.querySelector('.w-disp-row-avail');if(av){av.textContent='—';av.style.color='var(--mu)';}
const rmBtn=document.createElement('button');rmBtn.className='btn btn-ghost btn-xs';rmBtn.style.cssText='color:var(--re);margin-top:4px';rmBtn.textContent='✕ Remove this lot';rmBtn.onclick=()=>clone.remove();clone.appendChild(rmBtn);list.appendChild(clone);}

export function refreshWDyeLots(){
  if(!State._trueSoftAvail){_fetchTrueSoftAvailable(()=>_refreshWDyeLotsImpl());return;}
  _refreshWDyeLotsImpl();
}

export function _refreshWDyeLotsImpl(){const grade=document.getElementById('w-dye-grade')?.value;const opts=getDyeSrcOpts(grade);const s1=document.getElementById('w-dye-lot1');const s2=document.getElementById('w-dye-lot2');if(s1)s1.innerHTML='<option value="">Select Lot</option>'+opts;if(s2)s2.innerHTML='<option value="">None</option>'+opts;}

export function wDyeCalcTotal(){const u1=parseFloat(document.getElementById('w-dye-u1')?.value)||0;const u2=parseFloat(document.getElementById('w-dye-u2')?.value)||0;const el=document.getElementById('w-dye-total');if(el)el.textContent=`${fmt(u1+u2)}u`;}

export function wSetAlert(stage,msg,cls){setAlert(`w-${stage}-alert`,msg,cls,{classPrefix:'walert',autoClear:cls==='ok'});}

export async function wSubmitEnd(stage){const ipId=document.getElementById(`w-${stage}-ip`)?.value;const outU=parseFloat(document.getElementById(`w-${stage}-out-u`)?.value)||0;const outW=parseFloat(document.getElementById(`w-${stage}-out-w`)?.value)||0;const endNote=document.getElementById(`w-${stage}-end-note`)?.value.trim()||'';if(!ipId||!outU){wSetAlert(stage,'Select entry and enter output units','err');return;}
const _weBtn=document.querySelector(`#w-${stage}-end-tab .wsubmit`);if(_weBtn)_weBtn.disabled=true;
try{
  const {ok,data,error,networkError}=await apiPost('/api/stage/end',{id:ipId,outUnits:outU,outWeight:outW,endNote,changedBy:State.currentUser.name,idempotencyKey:crypto.randomUUID()});
  if(networkError)throw new Error(error);
  if(!ok){wSetAlert(stage,error||'Failed to end entry','err');if(_weBtn)_weBtn.disabled=false;return;}
  if(_weBtn)_weBtn.disabled=false;showToast();wSetAlert(stage,'✓ End recorded — sent for approval','ok');await _refreshAndRender(['stageEntries'],renderWorkerView);
}catch(e){wSetAlert(stage,'Network error — not saved: '+e.message,'err');if(_weBtn)_weBtn.disabled=false;}}

export function wDyeAddSourceRow(type,label){const list=document.getElementById(`w-dye-${type}-list`);if(!list)return;const opts=decodeURIComponent(list.dataset.opts||'');const rowId=`w-dye-${type}-row-${Date.now()}`;const row=document.createElement('div');row.className=`w-dye-${type}-row`;row.id=rowId;row.style.cssText='margin-bottom:8px';row.innerHTML=`<div class="wfield"><label>${label}</label><select class="wselect w-dye-${type}-sel"><option value="">None</option>${opts}</select></div>${type==='rc'?'<div class="wfield"><label>Pool</label><select class="wselect w-dye-rc-pool"><option value="steel">On Steel</option><option value="softened">Softened</option></select></div><div class="wfield"><label>Cones</label><input class="winp w-dye-rc-cones" type="number" step="1" placeholder="0"></div>':''}<div class="w2col"><div class="wfield"><label>Weight (kg)</label><input class="winp w-dye-${type}-wt" type="number" placeholder="0"></div><div class="wfield" style="align-self:flex-end"><button class="btn btn-ghost btn-xs" style="color:var(--re)" onclick="document.getElementById('${rowId}').remove()">✕ Remove</button></div></div>`;list.appendChild(row);}

export async function wSubmitDyeStart(){const grade=document.getElementById('w-dye-grade')?.value||'';const machine=document.getElementById('w-dye-mach')?.value;const notes=document.getElementById('w-dye-notes')?.value;const _wdyWorker=document.getElementById('w-dye-worker')?.value||State.currentUser?.name;if(!_wdyWorker){wSetAlert('Dye','Select worker','err');return;}
const sources=[];let vFail=false;[[1],[2]].forEach(([n])=>{const lot=document.getElementById(`w-dye-lot${n}`)?.value;const u=parseFloat(document.getElementById(`w-dye-u${n}`)?.value)||0;const w=parseFloat(document.getElementById(`w-dye-w${n}`)?.value)||0;if(!lot||!u)return;const _wdyParts=lot.split('||');const _wdyLotId=_wdyParts[0];const _wdyGrade=_wdyParts[1]||grade;const _wdyVendor=_wdyParts[2]||'';
sources.push({lotId:_wdyLotId,grade:_wdyGrade,vendor:_wdyVendor,weight:w,cones:u,sourceType:'rm'});});
for(const _src of sources){const _dyeDup=(State.DB.dyeLots||[]).find(e=>e.status==='InProgress'&&(e.sources||[]).some(s=>s.lotId===_src.lotId&&s.grade===_src.grade&&s.vendor===_src.vendor));if(_dyeDup){const _elapsed=hrsBetween(_dyeDup.startTime,new Date().toISOString());if(!confirm(`⚠ Lot ${_src.lotId} already used in another Dye batch IN PROGRESS\nDye Lot: ${_dyeDup.id}\nStarted: ${fmtTS(_dyeDup.startTime)} by ${_dyeDup.startWorker||'?'}\nRunning for: ${fmtHrs(_elapsed)}\n\nStart another batch with this lot anyway? (only do this if it's a genuine separate split)`))return;}}
document.querySelectorAll('.w-dye-ds-row').forEach(row=>{const id=row.querySelector('.w-dye-ds-sel')?.value;const wt=parseFloat(row.querySelector('.w-dye-ds-wt')?.value)||0;if(id&&wt>0)sources.push({deadStockId:id,weight:wt,sourceType:'dead'});});
document.querySelectorAll('.w-dye-rc-row').forEach(row=>{const id=row.querySelector('.w-dye-rc-sel')?.value;const wt=parseFloat(row.querySelector('.w-dye-rc-wt')?.value)||0;if(id&&wt>0){const cn=parseInt(row.querySelector('.w-dye-rc-cones')?.value)||0;if(cn<=0){wSetAlert('Dye','Recycle '+id+': enter the cones','err');vFail=true;return;}const pl=row.querySelector('.w-dye-rc-pool')?.value==='softened'?'softened':'steel';sources.push({recycleId:id,weight:wt,cones:cn,pool:pl,sourceType:'recycle'});}});
document.querySelectorAll('.w-dye-rs-row').forEach(row=>{const id=row.querySelector('.w-dye-rs-sel')?.value;const wt=parseFloat(row.querySelector('.w-dye-rs-wt')?.value)||0;if(id&&wt>0)sources.push({residualId:id,weight:wt,sourceType:'residual'});});
if(vFail)return;
if(!sources.length){wSetAlert('Dye','Add at least one source (RM lot, dead stock, recycle, or residual)','err');return;}
const _wdyBtn=document.querySelector('#w-Dye-start-tab .wsubmit');if(_wdyBtn)_wdyBtn.disabled=true;
try{
  // Jul 29 2026 fix — mobile was using a bare apiPost() call here, with
  // no way to see or respond to a duplicate warning at all — a real
  // gap against the standing rule that mobile matches desktop exactly,
  // resolution aside. Desktop already used the shared, tested
  // _postWithDuplicateCheck for this; mobile just never got switched
  // over to it. Same function, same fix already proven for it today.
  const {ok,data,error,networkError}=await _postWithDuplicateCheck('/api/dye/start',{machine,worker:_wdyWorker,notes,sources,changedBy:State.currentUser.name,idempotencyKey:crypto.randomUUID()});
  if(networkError)throw new Error(error);
  if(!ok){if(error!=='__cancelled_by_user__')wSetAlert('Dye',error||'Failed to start dye batch','err');if(_wdyBtn)_wdyBtn.disabled=false;return;}
  if(_wdyBtn)_wdyBtn.disabled=false;showToast();wSetAlert('Dye','✓ Dye Start recorded. Come back to End when done.','ok');await _refreshAndRender(['dyeLots'],renderWorkerView);
}catch(e){wSetAlert('Dye','Network error — not saved: '+e.message,'err');if(_wdyBtn)_wdyBtn.disabled=false;}}

export function wOnDyeEndSerialInput(){const _fy=document.getElementById('w-dye-end-fy')?.value||currentFY();const _serial=(document.getElementById('w-dye-end-serial')?.value||'').trim();const _sub=(document.getElementById('w-dye-end-sub')?.value||'').trim();if(!_serial)return;const _base='DYE-'+_fy+'-'+_serial;const _full=_base+(_sub?'-'+_sub:'');const _dup=_sub?(State.DB.dyeLots||[]).find(d=>d.dyeLotNo===_full&&d.status!=='Voided'):(State.DB.dyeLots||[]).find(d=>d.dyeLotNo===_base&&d.status!=='Voided');const el=document.getElementById('w-Dye-alert');if(el)el.innerHTML=_dup?`<div class="walert err">⚠ ${_full} already exists. Add a Sub suffix if this is a sub-batch.</div>`:'';}

export async function wSubmitDyeEnd(){const id=document.getElementById('w-dye-ip')?.value;const outU=parseFloat(document.getElementById('w-dye-out-u')?.value)||0;const outW=parseFloat(document.getElementById('w-dye-out-w')?.value)||0;const endNotes=document.getElementById('w-dye-end-notes')?.value.trim()||'';const shade=(document.getElementById('w-dye-end-shade')?.value||'').trim();const fy=document.getElementById('w-dye-end-fy')?.value||currentFY();const serial=(document.getElementById('w-dye-end-serial')?.value||'').trim();const sub=(document.getElementById('w-dye-end-sub')?.value||'').trim();if(!id||!outU){wSetAlert('Dye','Select batch and enter output units','err');return;}
if(!endNotes){wSetAlert('Dye','Formula / Notes (End) is required — confirm formula or describe what changed','err');document.getElementById('w-dye-end-notes')?.focus();return;}
if(!shade){wSetAlert('Dye','Enter shade name/no','err');return;}
if(!serial||isNaN(parseInt(serial))||parseInt(serial)<1){wSetAlert('Dye','Serial No must be a positive number','err');return;}
if(outW<=0){wSetAlert('Dye','Output weight must be > 0','err');return;}
const _deBtn=document.getElementById('w-dye-end-submit-btn');if(_deBtn)_deBtn.disabled=true;
try{
  const {ok,data,error,networkError}=await apiPost('/api/dye/end',{entryId:id,fy,serial,sub,shade,outCones:outU,outWeight:outW,endNote:endNotes,changedBy:State.currentUser.name,idempotencyKey:crypto.randomUUID()});
  if(networkError)throw new Error(error);
  if(!ok){wSetAlert('Dye',error||'Failed to end dye batch','err');if(_deBtn)_deBtn.disabled=false;return;}
  if(_deBtn)_deBtn.disabled=false;showToast();wSetAlert('Dye','✓ Dye Lot '+data.dyeLotNo+' created — pending approval','ok');
  // Jul 28 2026 fix — same real bug as the desktop version: dyeLots is
  // only ever loaded once at session start, so a newly-completed dye
  // lot never actually appeared until a full page reload.
  _hydrateDyeLot(id,()=>{renderWorkerView();});
}catch(e){wSetAlert('Dye','Network error — not saved: '+e.message,'err');if(_deBtn)_deBtn.disabled=false;}}

export async function wSubmitDisp(){const party=document.getElementById('w-disp-party')?.value;const invoiceNo=(document.getElementById('w-disp-invoice')?.value||'').trim();if(!party){wSetAlert('Dispatch','Select party','err');return;}
if(!invoiceNo){wSetAlert('Dispatch','Enter invoice / challan no.','err');return;}
const rowEls=document.querySelectorAll('#w-disp-lots .w-disp-row');const rows=[];let totalBags=0,totalWeight=0;
for(const row of rowEls){const dyeLotId=row.querySelector('.w-disp-lot-sel')?.value||'';const bags=parseFloat(row.querySelector('.w-disp-row-units')?.value)||0;const weight=parseFloat(row.querySelector('.w-disp-row-weight')?.value)||0;if(!dyeLotId&&!bags&&!weight)continue;
  if(!dyeLotId){wSetAlert('Dispatch','Select a dye lot for every row','err');return;}
  if(bags<=0){wSetAlert('Dispatch','Enter bags count for every row','err');return;}
  if(weight<=0){wSetAlert('Dispatch','Enter weight for every row','err');return;}
  rows.push({dyeLotId,bags,weight,grade:''});totalBags+=bags;totalWeight+=weight;}
if(!rows.length){wSetAlert('Dispatch','Add at least one lot','err');return;}
const _dpBtn=document.getElementById('w-disp-submit-btn');if(_dpBtn)_dpBtn.disabled=true;
try{
  const {ok,data,error,networkError}=await apiPost('/api/dispatch',{party,date:today(),invoiceNo,rows,changedBy:State.currentUser.name,idempotencyKey:crypto.randomUUID()});
  if(networkError)throw new Error(error);
  if(!ok){wSetAlert('Dispatch',error||'Failed to save dispatch','err');if(_dpBtn)_dpBtn.disabled=false;return;}
  if(_dpBtn)_dpBtn.disabled=false;showToast();wSetAlert('Dispatch',`✓ Dispatched ${fmt(totalBags)}b / ${fmt(totalWeight)}kg to ${party}`,'ok');await _refreshAndRender(['dispatches'],renderWorkerView);
}catch(e){wSetAlert('Dispatch','Network error — not saved: '+e.message,'err');if(_dpBtn)_dpBtn.disabled=false;}}

export async function wSubmitStart(stage){const _wsRaw=document.getElementById(`w-${stage}-lot-start`)?.value||'';const{lotId,grade:_wsGrade,vendor:_wsVendor}=parseLotSelectValue(_wsRaw);const inU=parseFloat(document.getElementById(`w-${stage}-in-u`)?.value)||0;const inW=parseFloat(document.getElementById(`w-${stage}-in-w`)?.value)||0;const machine=document.getElementById(`w-${stage}-mach-start`)?.value;const startNote=document.getElementById(`w-${stage}-start-note`)?.value.trim()||'';const _wsDsId=document.getElementById(`w-${stage}-ds-select`)?.value||null;if(!lotId||!inU){wSetAlert(stage,'Select lot and enter units','err');return;}
if(!inW||inW<=0){wSetAlert(stage,'Enter input weight (kg)','err');return;}
const _wsL=getLotByKey(lotId,_wsGrade,_wsVendor)||getLot(lotId);
const dup=State.DB.stageEntries.find(e=>e.lotId===lotId&&e.stage===stage&&e.status==='InProgress');if(dup){const elapsed=hrsBetween(dup.startTime,new Date().toISOString());if(!confirm(`${lotId} already has ${stage} running (${fmtHrs(elapsed)}). Start another?`))return;}
const _wsBtn=document.getElementById(`w-start-btn-${stage}`);if(_wsBtn)_wsBtn.disabled=true;
const _wsWorker=document.getElementById(`w-${stage}-worker-start`)?.value||State.currentUser?.name;
try{
  const {ok,data,error,networkError}=await _postWithDuplicateCheck('/api/stage/start',{lotId,grade:_wsL.grade||_wsGrade,vendor:_wsL.vendor||_wsVendor,inUnits:inU,inWeight:inW,machine,worker:_wsWorker,startNote,deadStockId:_wsDsId,changedBy:State.currentUser.name,idempotencyKey:crypto.randomUUID()});
  if(networkError)throw new Error(error);
  if(!ok){if(error!=='__cancelled_by_user__')wSetAlert(stage,error||'Failed to start entry','err');if(_wsBtn)_wsBtn.disabled=false;return;}
  if(_wsBtn)_wsBtn.disabled=false;showToast();wSetAlert(stage,'✓ Start recorded — come back to End when finished','ok');document.getElementById(`w-${stage}-in-u`).value='';document.getElementById(`w-${stage}-in-w`).value='';const _wsNoteEl=document.getElementById(`w-${stage}-start-note`);if(_wsNoteEl)_wsNoteEl.value='';await _refreshAndRender(['stageEntries'],renderWorkerView);
}catch(e){wSetAlert(stage,'Network error — not saved: '+e.message,'err');if(_wsBtn)_wsBtn.disabled=false;}}

export function dyeQualifyingDeadStock(){
  const steelDS=(State.DB.deadStock||[]).filter(d=>d.status==='Approved'&&d.type==='Steel'&&getDeadStockBalance(d.id)>0);
  const plasticDSSoftened=(State.DB.deadStock||[]).filter(d=>{if(d.status!=='Approved'||d.type!=='Plastic')return false;const softDone=(State.DB.stageEntries||[]).some(e=>e.deadStockId===d.id&&e.stage==='Soft'&&(e.status==='Approved'||e.status==='Edited-Approved')&&e.outWeight>0);return softDone&&getDeadStockBalance(d.id)>0;});
  return[...steelDS,...plasticDSSoftened];
}

export function dyeQualifyingRecycleStock(){
  return(State.DB.recycleStock||[]).filter(r=>getRCStatus(r.id).available);
}

export function dyeQualifyingResidualStock(){
  return(State.DB.residualStock||[]).filter(r=>getResidualBalance(r.id)>0);
}

window.refreshWDyeLots = refreshWDyeLots;
window.wDispAddLotRow = wDispAddLotRow;
window.wDispRowAvail = wDispRowAvail;
window.wDyeAddSourceRow = wDyeAddSourceRow;
window.wDyeCalcTotal = wDyeCalcTotal;
window.wPackLotChange = wPackLotChange;
window.wShowDyeEndRef = wShowDyeEndRef;
window.wSubmitDisp = wSubmitDisp;
window.wSubmitDyeEnd = wSubmitDyeEnd;
window.wSubmitDyeStart = wSubmitDyeStart;
window.wSubmitPack = wSubmitPack;
window.wSubmitWindEnd = wSubmitWindEnd;
window.wSubmitWindStart = wSubmitWindStart;
window.wSwitchTab = wSwitchTab;
window.wTab = wTab;
window.wWindLotChange = wWindLotChange;
window.wOnDyeEndSerialInput = wOnDyeEndSerialInput;
