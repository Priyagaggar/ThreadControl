import {BACKUP_KEY, FLAG_COLORS, GSHEET_WEBHOOK_URL, MAX_BACKUPS, Q, Qmax0, Qsub, SCOL, STAGE_CONFIG, State, WORKER_URL, _dispatchesForDropdown, _dyeLotsForDropdown, _fbAuthedFetch, _filterTableMap, _getDyeLotSummary, _getHeaders, _getLotSummary, _hydrateChallanFilter, _hydrateDyeLot, _hydrateLot, _inDayFn, _loadArchiveWithCache, _loadCatalog, _lotKey, _searchArchive, _fetchReportSummaries, apiPost, calcMachineTotals, calcWorkerTotals, calcShadeTotals, calcDailyTotals, getSoftResidualOut, getRMReturnedOut, _fetchTrueSoftAvailable, _lotsForDropdown, _postHeaders, _sortState, _summaryKey, _tableFilters, _verifyPasswordViaWorker, _waitForDBThenLogin, agingBadge, appr, balCell, clearAlerts, closeModal, dateRange, dtCell, fU, fW, fmt, fmtDate, fmtDuration, fmtHrs, fmtQ, fmtQty, fmtRelTS, fmtTS, genId, getDeadStockBalance, getDispatched, getDyeAllocated, getDyeBal, getDyeBalAvailable, getDyeBalance, getDyeConsumedFromLot, getDyeLotCurrentStage, getGradePool, getLot, getLotByKey, getPackBal, getPackBalAvailable, getPackBalance, getPackIn, getPackOut, getRCStatus, getRMBalance, getRecycleBalance, getSoftBalance, getSoftBalanceAvailable, getSoftBalanceWeight, getSoftBalanceWeightAvailable, getSoftConsumedByDye, getSoftIn, getSoftOut, getStageBalanceAvailable, getTotalDispatched, getTotalEntries, getTotalPacked, getVendorRatioForDyeLot, getWindBal, getWindBalAvailable, getWindBalance, getWindIn, getWindOut, getWindOutput, hrsBetween, inRange, initFirebase, initTheme, isEntryLocked, lcExpanded, logout, lotsForStage, mwCell, nav, nowTS, onLogin, openModal, parseLotSelectValue, pct, qtyCell, rptState, save, seMatch, setAlert, setupMobileNav, showLoginScreenSafe, showToast, stageBalance, today, triggerSummaryUpdate, updateMobileNavBadges, updateOnlineStatus, wasteCell, wastePctCell, wcls} from './core.js';

function onDyeEndSerialInput(){const _fy=document.getElementById('dye-end-fy')?.value||currentFY();const _serial=(document.getElementById('dye-end-serial')?.value||'').trim();const _sub=(document.getElementById('dye-end-sub')?.value||'').trim();if(!_serial)return;const _base='DYE-'+_fy+'-'+_serial;const _full=_base+(_sub?'-'+_sub:'');const _dup=_sub?(State.DB.dyeLots||[]).find(d=>d.dyeLotNo===_full&&d.status!=='Voided'):(State.DB.dyeLots||[]).find(d=>d.dyeLotNo===_base&&d.status!=='Voided');const alert=document.getElementById('dye-end-alert');if(_dup){alert.innerHTML='<div class="alert-err" style="margin-bottom:8px">⚠ '+_full+' already exists. Add a suffix in Sub box if this is a sub-batch.</div>';}else{alert.innerHTML='';}}
function isInDemoState(){if(!State.DB.lots||!State.DB.lots.length)return false;if(State.firebaseLoaded&&State.fbDB)return false;const hasDemoLots=State.DB.lots.some(l=>l.id==='LOT-001'||l.id==='LOT-002');if(!hasDemoLots)return false;const onlyDefaultUsers=(State.DB.users||[]).every(u=>['admin','supervisor','ramesh','suresh','amit','priya'].includes(u.username));return onlyDefaultUsers;}
export function renderLoginDemoCards(forceHide){const section=document.getElementById('login-demo-section');const cards=document.getElementById('login-demo-cards');if(!section||!cards)return;if(forceHide||!isInDemoState()){section.style.display='none';return;}
const users=(State.DB.users||[]).filter(u=>u.active!==false);const roleClass={manager:'rm',supervisor:'rs',worker:'rw'};const roleLabel={manager:'Manager',supervisor:'Supervisor',worker:'Worker'};cards.innerHTML=users.map(u=>`
    <div class="demo-row" onclick="fillLogin('${u.username}','${u.password}')"><div><div class="dr-name">${u.name}</div><div class="dr-creds">${u.username} / ${u.password}${u.stage&&u.stage!=='all'?' — '+u.stage:''}</div></div><span class="rbadge ${roleClass[u.role]||'rw'}">${roleLabel[u.role]||u.role}</span></div>`).join('');section.style.display='block';}
function fillLogin(u,p){document.getElementById('li-u').value=u;document.getElementById('li-p').value=p;}
function addDeadStockRow(){const list=document.getElementById('dye-dead-list');if(!list)return;const steelDS=(State.DB.deadStock||[]).filter(d=>d.status==='Approved'&&d.type==='Steel'&&getDeadStockBalance(d.id)>0);const plasticDSSoftened=(State.DB.deadStock||[]).filter(d=>{if(d.status!=='Approved'||d.type!=='Plastic')return false;const softDone=(State.DB.stageEntries||[]).some(e=>e.deadStockId===d.id&&e.stage==='Soft'&&(e.status==='Approved'||e.status==='Edited-Approved')&&e.outWeight>0);return softDone&&getDeadStockBalance(d.id)>0;});const allAvail=[...steelDS,...plasticDSSoftened];if(!allAvail.length){showToast('No dead stock available for dye (steel cone or softened plastic)','err');return;}
const rowId='dds-'+Date.now();const div=document.createElement('div');div.id=rowId;div.style.cssText='display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap;';div.innerHTML=`
    <select class="fs" style="flex:1;min-width:180px" onchange="onDSRowSelect('${rowId}')"><option value="">Select Dead Stock...</option><optgroup label="Steel Cone (direct to dye)">
        ${steelDS.map(d=>`<option value="${d.id}|steel">${d.id}— ${d.grade}— Steel(${fmt(getDeadStockBalance(d.id))}kg)</option>`).join('')}
      </optgroup>
      ${plasticDSSoftened.length?`<optgroup label="Plastic → Softened (ready for dye)">${plasticDSSoftened.map(d=>{const softEntry=(State.DB.stageEntries||[]).find(e=>e.deadStockId===d.id&&e.stage==='Soft'&&(e.status==='Approved'||e.status==='Edited-Approved'));const softOut=softEntry?.outWeight||0;return`<option value="${d.id}|plastic">${d.id} — ${d.grade} — Plastic/Softened (${fmt(softOut)}kg out)</option>`;}).join('')}</optgroup>`:''}
    </select><input class="fi" type="number" id="${rowId}-wt" data-field="weight" placeholder="Weight (kg)" step="0.01" style="width:130px" min="0.01"><span id="${rowId}-info" style="font-size:0.68rem;color:var(--mu)"></span><button class="btn btn-ghost btn-xs" style="color:var(--re)" onclick="document.getElementById('${rowId}').remove()">✕</button>`;list.appendChild(div);}
function onDSRowSelect(rowId){const sel=document.querySelector('#'+rowId+' select');const infoEl=document.getElementById(rowId+'-info');const wtEl=document.getElementById(rowId+'-wt');if(!sel||!infoEl)return;const val=sel.value;if(!val){infoEl.textContent='';return;}
const[dsId,coneType]=val.split('|');const ds=(State.DB.deadStock||[]).find(d=>d.id===dsId);if(!ds){return;}
if(coneType==='plastic'){const softEntry=(State.DB.stageEntries||[]).find(e=>e.deadStockId===dsId&&e.stage==='Soft'&&(e.status==='Approved'||e.status==='Edited-Approved'));const softOut=softEntry?.outWeight||0;infoEl.textContent=`Soft output: ${fmt(softOut)}kg available`;if(wtEl)wtEl.max=softOut;}else{const bal=getDeadStockBalance(dsId);infoEl.textContent=`Available: ${fmt(bal)}kg`;if(wtEl)wtEl.max=bal;}}
function addDyeSourceRow(){
  // Jul 13 2026: fetch the true (active+archive, always-verified) available
  // balance once per form session instead of trusting whatever's already
  // loaded in the browser — this is the fix for lot 04-style over-commitment,
  // applied where the person actually looks (the dropdown), not just at
  // final submit.
  if(!State._trueSoftAvail){_fetchTrueSoftAvailable(()=>_addDyeSourceRowImpl());return;}
  _addDyeSourceRowImpl();
}
function _addDyeSourceRowImpl(){const list=document.getElementById('dye-sources-list');const rowId='dsr-'+Date.now();const lotsWithBal=State.DB.lots.filter(l=>{const tKey=_summaryKey(l.id,l.grade,l.vendor);const t=State._trueSoftAvail?.[tKey];return t?t.units>0:getSoftBalanceAvailable(l.id,l.grade,l.vendor).units>0;});const vendors=[...new Set(lotsWithBal.map(l=>l.vendor))].sort();const vendorOpts='<option value="">Select vendor...</option>'+
vendors.map(v=>`<option value="${v}">${v}</option>`).join('');const row=document.createElement('div');row.id=rowId;row.style.cssText='background:var(--s2);border:1px solid var(--b1);border-radius:8px;padding:10px;margin-bottom:8px;';row.innerHTML=`
    <div style="display:grid;grid-template-columns:1fr 1fr 2fr;gap:6px;margin-bottom:6px;"><div><div style="font-size:0.6rem;color:var(--mu);margin-bottom:3px;text-transform:uppercase;letter-spacing:.08em">Vendor</div><select class="fs" onchange="onDsrVendorChange('${rowId}')"><option value="">Select vendor...</option>${vendorOpts.replace('<option value="">Select vendor...</option>','')}</select></div><div><div style="font-size:0.6rem;color:var(--mu);margin-bottom:3px;text-transform:uppercase;letter-spacing:.08em">Grade</div><select class="fs" id="${rowId}-grade" onchange="onDsrGradeChange('${rowId}')" disabled><option value="">Select grade...</option></select></div><div><div style="font-size:0.6rem;color:var(--mu);margin-bottom:3px;text-transform:uppercase;letter-spacing:.08em">Lot</div><select class="fs" id="${rowId}-lot" onchange="onDyeSourceLotChange(this)" disabled><option value="">Select lot...</option></select></div></div><div style="display:grid;grid-template-columns:1fr 1fr auto;gap:6px;align-items:center;"><input class="fi" type="number" step="0.01" placeholder="Weight (kg)" data-field="weight" title="Weight from soft going to dye"><input class="fi" type="number" step="1" placeholder="Cones counted" data-field="cones" title="Cones counted at dye start"><button class="btn btn-ghost btn-xs" style="color:var(--re)" onclick="document.getElementById('${rowId}').remove()">✕</button></div>`;list.appendChild(row);}
function onDsrVendorChange(rowId){const row=document.getElementById(rowId);const vendor=row.querySelector('select').value;const gradeEl=document.getElementById(rowId+'-grade');const lotEl=document.getElementById(rowId+'-lot');gradeEl.innerHTML='<option value="">Select grade...</option>';lotEl.innerHTML='<option value="">Select lot...</option>';gradeEl.disabled=true;lotEl.disabled=true;if(!vendor)return;const hasAvail=l=>{const tKey=_summaryKey(l.id,l.grade,l.vendor);const t=State._trueSoftAvail?.[tKey];return t?t.units>0:getSoftBalanceAvailable(l.id,l.grade,l.vendor).units>0;};const grades=[...new Set(State.DB.lots.filter(l=>l.vendor===vendor&&hasAvail(l)).map(l=>l.grade))].sort();if(!grades.length){gradeEl.innerHTML='<option value="">No grades available</option>';return;}
gradeEl.innerHTML='<option value="">Select grade...</option>'+grades.map(g=>`<option value="${g}">${g}</option>`).join('');gradeEl.disabled=false;}
function onDsrGradeChange(rowId){const row=document.getElementById(rowId);const vendor=row.querySelector('select').value;const grade=document.getElementById(rowId+'-grade').value;const lotEl=document.getElementById(rowId+'-lot');lotEl.innerHTML='<option value="">Select lot...</option>';lotEl.disabled=true;if(!vendor||!grade)return;const trueBal=l=>{const tKey=_summaryKey(l.id,l.grade,l.vendor);return State._trueSoftAvail?.[tKey]||getSoftBalanceAvailable(l.id,l.grade,l.vendor);};const lots=State.DB.lots.filter(l=>l.vendor===vendor&&l.grade===grade&&trueBal(l).units>0);if(!lots.length){lotEl.innerHTML='<option value="">No lots available</option>';return;}
lotEl.innerHTML='<option value="">Select lot...</option>'+lots.map(l=>{const bal=trueBal(l);return`<option value="${l.id}||${l.grade}||${l.vendor}">${l.id} (${fmt(bal.units)}b / ${fmt(bal.weight)}kg avail)</option>`;}).join('');lotEl.disabled=false;}
function addEditLog(entryId,stage,fieldChanged,oldVal,newVal,reasonCat,reason,changedBy,impactNote=''){if(!State.DB.editLog)State.DB.editLog=[];State.DB.editLog.push({id:'EL-'+Date.now(),timestamp:nowTS(),entryId,stage,fieldChanged,oldVal:String(oldVal),newVal:String(newVal),reasonCat,reason,changedBy,impactNote});}
function addRecycleRow(){const list=document.getElementById('dye-recycle-list');if(!list)return;const available=(State.DB.recycleStock||[]).filter(r=>{const st=getRCStatus(r.id);const bal=getRecycleBalance(r.id);return st.available&&bal>0;});if(!available.length){list.innerHTML='<div style="color:var(--mu);font-size:0.75rem;padding:8px">No recycle stock available for dye (either at wind/soft stage or fully consumed)</div>';return;}
const rowId='drc-'+Date.now();const div=document.createElement('div');div.id=rowId;div.style.cssText='display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap;';div.innerHTML=`
    <select class="fs" style="flex:1;min-width:160px" onchange="onRecycleLotSelect('${rowId}')"><option value="">Select RC entry...</option>
      ${available.map(r=>`<option value="${r.id}">${r.id}— ${r.dyeLotNo}— ${r.shade}(${fmt(getRecycleBalance(r.id))}kg avail)</option>`).join('')}
    </select><input class="fi" type="number" id="${rowId}-wt" placeholder="Weight (kg)" step="0.01" style="width:130px" min="0.01"><span id="${rowId}-bal" style="font-size:0.7rem;color:var(--mu);white-space:nowrap"></span><button class="btn btn-ghost btn-xs" style="color:var(--re)" onclick="document.getElementById('${rowId}').remove()">✕</button>`;list.appendChild(div);}
function addResidualRow(presetId,presetGrade){
  const list=document.getElementById('dye-residual-list');if(!list)return;
  const available=(State.DB.residualStock||[]).filter(r=>getResidualBalance(r.id)>0);
  if(!available.length){list.innerHTML='<div style="color:var(--mu);font-size:0.75rem;padding:8px">No residual stock available</div>';return;}
  const rowId='drs-'+Date.now();
  const div=document.createElement('div');
  div.id=rowId;div.style.cssText='display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap;';
  const opts=available.map(r=>`<option value="${r.id}" ${r.id===presetId?'selected':''}>${r.grade} — ${fmt(getResidualBalance(r.id))}kg avail</option>`).join('');
  div.innerHTML=`<select class="fs" style="flex:2;min-width:200px;font-size:0.75rem" onchange="onResidualRowChange(this,'${rowId}')">
    <option value="">Select residual grade...</option>${opts}</select>
  <input type="number" class="fi" placeholder="Weight (kg)" step="0.01" style="width:100px" id="${rowId}-wt">
  <button class="btn btn-ghost btn-xs" style="color:var(--re)" onclick="document.getElementById('${rowId}').remove()">✕</button>`;
  list.appendChild(div);
  if(presetId)setTimeout(()=>onResidualRowChange(list.querySelector('select'),rowId),100);
}
function onResidualRowChange(sel,rowId){
  const rsId=sel.value;
  const rs=(State.DB.residualStock||[]).find(r=>r.id===rsId);
  const bal=rs?getResidualBalance(rsId):0;
  const wtEl=document.getElementById(rowId+'-wt');
  if(wtEl){wtEl.max=bal;wtEl.placeholder=`0 – ${fmt(bal)}kg`;}
}

function onRecycleLotSelect(rowId){const sel=document.querySelector('#'+rowId+' select');const balEl=document.getElementById(rowId+'-bal');if(!sel||!balEl)return;const rcId=sel.value;if(!rcId){balEl.textContent='';return;}
const bal=getRecycleBalance(rcId);const st=getRCStatus(rcId);balEl.textContent=`Avail: ${fmt(bal)}kg | ${st.status}`;document.getElementById(rowId+'-wt').max=bal;}
function addToEditLog(entryId,stage,field,oldVal,newVal,reasonCat,reasonText,impactNote,type='edit'){if(!State.DB.editLog)State.DB.editLog=[];State.DB.editLog.push({id:'EL-'+Date.now(),timestamp:nowTS(),entryId,stage,field,oldVal:String(oldVal||''),newVal:String(newVal||''),reasonCat,reasonText,impactNote:impactNote||'',changedBy:State.currentUser.name,type});}
function apprEntryCard(entry,stage,fields,approveF,rejectF,editF,voidF,overrideF=''){const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';const isSupervisor=State.currentUser?.role==='supervisor'||isAdmin;const isPending=entry.status==='Pending'||entry.status==='Edited-Pending';const isApproved=entry.status==='Approved'||entry.status==='Edited-Approved';const isVoided=entry.status==='Voided';const hasImbalance=entry._imbalance;const isLocked=isApproved&&!isAdmin;const dispatchApproved=checkDispatchApproved(entry,stage);let cardClass='appr-card';if(hasImbalance)cardClass+=' imbalance';if(entry.status?.includes('Edited'))cardClass+=' edited';const statusBadge=isVoided?'<span class="badge b-void">Voided</span>':isPending?'<span class="badge b-pend">Pending</span>':isApproved?`<span class="badge b-appr">${entry.status}</span>`:'<span class="badge">—</span>';const actionBtns=isVoided?'':`
    ${isPending&&isSupervisor ? `<button class="btn btn-success btn-xs"onclick="${approveF}">✓ Approve</button>` : ''}
    ${isPending&&isSupervisor ? `<button class="btn btn-danger btn-xs"onclick="${rejectF}">✗ Reject</button>` : ''}
    ${isPending&&isSupervisor&&editF ? `<button class="btn btn-ghost btn-xs"onclick="${editF}">✏ Edit</button>` : ''}
    ${isApproved&&isAdmin&&editF&&!dispatchApproved ? `<button class="btn btn-ghost btn-xs"onclick="${editF}">✏ Edit</button>` : ''}
    ${isAdmin&&!dispatchApproved ? `<button class="btn btn-danger btn-xs"onclick="${voidF}">⊘ Void</button>` : ''}
    ${isAdmin ? `<button class="btn btn-danger btn-xs"onclick="${overrideF}">⚡ Override</button>` : ''}
    ${isLocked&&!isAdmin ? '<span style="font-size:0.65rem;color:var(--mu)">🔒 Admin only</span>' : ''}
  `;return`<div class="${cardClass}"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;"><div style="flex:1;">
        ${hasImbalance ? `<div style="color:var(--re);font-size:0.72rem;font-weight:700;margin-bottom:6px;">⚠ IMBALANCE — ${entry._imbalanceNote||'Check balance'}</div>` : ''}
        ${fields}
        <div style="font-size:0.65rem;color:var(--mu);margin-top:6px;">
          ${entry.approvedBy?`Approved by:<strong>${entry.approvedBy}</strong>·`:''}
          ${entry.status?.includes('Edited')?`<span style="color:var(--ye)">✏ Edited</span>·`:''}
          ${entry.startTime?`Started:${fmtTS(entry.startTime)}`:''}
        </div></div><div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
        ${statusBadge}
        <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;">${actionBtns}</div></div></div></div>`;}
async function approveAllCurrentTab(){if(!['admin','manager','supervisor'].includes(State.currentUser?.role)){showToast('Supervisor or Admin only','err');return;}
const tab=State._apprTab||'soft';
try{
  const {ok,data,error,networkError}=await apiPost('/api/approve-all',{tab,changedBy:State.currentUser.name});
  if(networkError)throw new Error(error);
  if(!ok){showToast(error||'Could not approve','err');return;}
  showToast(`Approved ${data.count} ${tab} ${data.count===1?'entry':'entries'} ✓`);renderApproval();renderAll();
}catch(e){showToast('Network error — not saved: '+e.message,'err');}
}

async function approveDispatch(id){
  try{
    const {ok,data,error,networkError}=await apiPost('/api/approve-entry',{type:'dispatch',id,changedBy:State.currentUser.name});
  if(networkError)throw new Error(error);
  if(!ok){showToast(error||'Could not approve','err');return;}
    updateOrderStatuses();showToast('Dispatch approved ✓');renderAll();
  }catch(e){showToast('Network error — not saved: '+e.message,'err');}
}
async function approveDyeLot(id){
  try{
    const {ok,data,error,networkError}=await apiPost('/api/approve-entry',{type:'dye',id,changedBy:State.currentUser.name});
  if(networkError)throw new Error(error);
  if(!ok){showToast(error||'Could not approve','err');return;}
    showToast('Dye Lot approved ✓');renderAll();
  }catch(e){showToast('Network error — not saved: '+e.message,'err');}
}
async function approvePackEntry(id){
  try{
    const {ok,data,error,networkError}=await apiPost('/api/approve-entry',{type:'pack',id,changedBy:State.currentUser.name});
  if(networkError)throw new Error(error);
  if(!ok){showToast(error||'Could not approve','err');return;}
    showToast('Pack entry approved ✓');renderAll();
  }catch(e){showToast('Network error — not saved: '+e.message,'err');}
}
async function approveStageEntry(id){
  try{
    const {ok,data,error,networkError}=await apiPost('/api/approve-entry',{type:'soft',id,changedBy:State.currentUser.name});
  if(networkError)throw new Error(error);
  if(!ok){showToast(error||'Could not approve','err');return;}
    showToast('Approved ✓');renderAll();
  }catch(e){showToast('Network error — not saved: '+e.message,'err');}
}
async function approveWindEntry(id){
  try{
    const {ok,data,error,networkError}=await apiPost('/api/approve-entry',{type:'wind',id,changedBy:State.currentUser.name});
  if(networkError)throw new Error(error);
  if(!ok){showToast(error||'Could not approve','err');return;}
    showToast('Wind entry approved ✓');renderAll();
  }catch(e){showToast('Network error — not saved: '+e.message,'err');}
}
function checkDispatchApproved(entry,stage){if(stage==='pack'||stage==='wind'){const dyeLotId=entry.dyeLotId;return(State.DB.dispatches||[]).some(d=>d.dyeLotId===dyeLotId&&(d.status==='Approved'||d.status==='Edited-Approved'));}
return false;}
function checkImbalance(e){if(!e||!e.lotId)return null;const l=getLotByKey(e.lotId,e.grade,e.vendor);if(!l.id)return null;if(e.stage==='Soft'&&e.status!=='Voided'){const rmBal=getRMBalance(e.lotId,e.grade,e.vendor);if(rmBal.units<0)return`RM balance negative by ${fmt(Math.abs(rmBal.units))}u`;}
return null;}
function checkImbalances(){let count=0;(State.DB.stageEntries||[]).filter(e=>e.stage==='Soft'&&e.status!=='Voided').forEach(e=>{const rmBal=getRMBalance(e.lotId,e.grade,e.vendor);if((e.inUnits||0)>rmBal.units+0.01){e._imbalance=true;e._imbalanceNote=`Input ${fmt(e.inUnits)}b exceeds RM balance ${fmt(rmBal.units)}b`;count++;}else{delete e._imbalance;delete e._imbalanceNote;}});(State.DB.windEntries||[]).filter(e=>e.status!=='Voided').forEach(e=>{const dyeBal=getDyeBal(e.dyeLotId);if((e.inWeight||0)>dyeBal.weight+0.01){e._imbalance=true;e._imbalanceNote=`Wind input exceeds dye balance`;count++;}else{delete e._imbalance;delete e._imbalanceNote;}});updateImbalanceWidget(count);}
function clearDSFilters(){['dsf-grade','dsf-type','dsf-status'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});renderDeadStock();}
function currentFY(){const now=new Date();const yr=now.getFullYear();const mo=now.getMonth();const fyStart=mo>=3?yr:yr-1;return String(fyStart).slice(2)+String(fyStart+1).slice(2);}
function detectImbalances(){const issues=[];(State.DB.stageEntries||[]).filter(e=>e.status!=='Voided'&&e.stage==='Soft'&&e.endTime).forEach(e=>{if((e.outWeight||0)>(e.inWeight||0)+0.01)
issues.push({id:e.id,stage:'Soft',msg:`Output ${fmt(e.outWeight)}kg exceeds input ${fmt(e.inWeight)}kg`});});State.DB.lots.forEach(l=>{const softBal=getSoftBalanceWeight(l.id,l.grade,l.vendor);if(softBal<-0.01)
issues.push({id:l.id,stage:'Soft',msg:`Lot ${l.id} soft balance negative: ${fmt(softBal)}kg`});});(State.DB.windEntries||[]).filter(e=>e.status!=='Voided'&&e.outWeight).forEach(e=>{if((e.outWeight||0)>(e.inWeight||0)+0.01)
issues.push({id:e.id,stage:'Wind',msg:`Output ${fmt(e.outWeight)}kg exceeds input ${fmt(e.inWeight)}kg`});});(State.DB.dyeLots||[]).filter(d=>d.status==='Approved'||d.status==='Edited-Approved').forEach(d=>{const packBal=getPackBal(d.id);if(packBal.weight<-0.01)
issues.push({id:d.dyeLotNo,stage:'Pack',msg:`${d.dyeLotNo} pack balance negative: ${fmt(packBal.weight)}kg`});});return issues;}
function dyeSplitCalc(){const lot=(State.DB.dyeLots||[]).find(d=>d.id===document.getElementById('dyesplit-lot-id').value);if(!lot)return;const good=parseFloat(document.getElementById('dyesplit-good').value)||0;const off=Math.max(0,(lot.outWeight||0)-good);document.getElementById('dyesplit-off').value=off.toFixed(2);}
function exportEditLog(){
  const allLogs=(State.DB.editLog||[]).sort((a,b)=>(b.timestamp||'').localeCompare(a.timestamp||''));
  const rows=[['Entry ID','Stage','Reference','Grade','Shade','Field','Old Value','New Value','Reason Category','Reason Text','By','Time']];
  allLogs.forEach(l=>{
    // Handle both schemas: addEditLog uses fieldChanged/reason, addToEditLog uses field/reasonText
    const field=l.field||l.fieldChanged||'—';
    const reasonText=l.reasonText||l.reason||'—';
    const by=l.changedBy||l.by||'—';
    // Lookup reference, grade, shade
    const s=(l.stage||'').toLowerCase();
    let ref='—',grade='—',shade='—';
    if(s==='soft'||s==='stage'){
      const e=(State.DB.stageEntries||[]).find(x=>x.id===l.entryId);
      if(e){ref=e.lotId||'—';const lot=(State.DB.lots||[]).find(x=>x.id===e.lotId);if(lot)grade=lot.grade||'—';}
    }else if(s==='dye'){
      const d=(State.DB.dyeLots||[]).find(x=>x.id===l.entryId||x.dyeLotNo===l.entryId);
      if(d){ref=d.dyeLotNo||'—';shade=d.shade||'—';}
    }else if(s==='wind'){
      const w=(State.DB.windEntries||[]).find(x=>x.id===l.entryId);
      if(w){const d=(State.DB.dyeLots||[]).find(x=>x.id===w.dyeLotId);if(d){ref=d.dyeLotNo||'—';shade=d.shade||'—';}}
    }else if(s==='pack'){
      const p=(State.DB.packEntries||[]).find(x=>x.id===l.entryId);
      if(p){const d=(State.DB.dyeLots||[]).find(x=>x.id===p.dyeLotId);if(d){ref=d.dyeLotNo||'—';shade=d.shade||'—';}}
    }else if(s==='dispatch'){
      const ds=(State.DB.dispatches||[]).find(x=>x.id===l.entryId);
      if(ds){const d=(State.DB.dyeLots||[]).find(x=>x.id===ds.dyeLotId);if(d){ref=d.dyeLotNo||'—';shade=d.shade||'—';}}
    }
    rows.push([l.entryId,l.stage,ref,grade,shade,field,l.oldVal,l.newVal,l.reasonCat,reasonText,by,fmtTS(l.timestamp)]);
  });
  const csv=rows.map(r=>r.map(v=>'"'+(String(v||'').replace(/"/g,'""'))+'"').join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download='ThreadControl_EditLog_'+today()+'.csv';a.click();
}
function sortDyeLotNo(a,b){const serial=s=>{if(!s||typeof s!=='string')return 0;const parts=s.split('-');return parseInt(parts[2])||0;};return serial(b)-serial(a);}
function makeDyeLotSearch(containerId,opts,onSelect){const container=document.getElementById(containerId);if(!container)return;container.innerHTML='';container.style.position='relative';const input=document.createElement('input');input.className='fi';input.placeholder='Type lot no to search...';input.autocomplete='off';input.style.cssText='width:100%;box-sizing:border-box;';const dropdown=document.createElement('div');dropdown.style.cssText='position:absolute;top:100%;left:0;right:0;background:var(--s2);border:1px solid var(--b2);border-radius:6px;max-height:220px;overflow-y:auto;z-index:999;display:none;box-shadow:0 4px 12px rgba(0,0,0,0.3);';let selected=null;function render(filter){const q=(filter||'').toLowerCase().trim();const filtered=q?opts.filter(o=>{const parts=(o.label||'').split('-');const serial=parts[2]||'';return serial.startsWith(q)||o.label.toLowerCase().includes(q);}):opts;dropdown.innerHTML=filtered.length?filtered.map(o=>`<div class="dls-opt" data-id="${o.id}" style="padding:8px 12px;cursor:pointer;font-size:0.8rem;border-bottom:1px solid var(--b1);color:var(--tx)" onmousedown="event.preventDefault()">${o.label}</div>`).join(''):'<div style="padding:10px 12px;color:var(--mu);font-size:0.78rem;">No lots found</div>';dropdown.style.display='block';}input.addEventListener('focus',()=>render(input.value));input.addEventListener('input',()=>{selected=null;render(input.value);});input.addEventListener('blur',()=>setTimeout(()=>{dropdown.style.display='none';},150));dropdown.addEventListener('click',e=>{const opt=e.target.closest('.dls-opt');if(!opt)return;selected=opt.dataset.id;input.value=opts.find(o=>o.id===selected)?.label?.split(' |')[0]||opt.dataset.id;dropdown.style.display='none';onSelect(selected);});container.appendChild(input);container.appendChild(dropdown);return{getValue:()=>selected,setValue:(id)=>{selected=id;input.value=id?(opts.find(o=>o.id===id)?.label?.split(' |')[0]||id):'';},clear:()=>{selected=null;input.value='';}};}
let _windLotSearch=null,_packLotSearch=null;
function genDyeLotNo(){const fy=currentFY();const prefix='DYE-'+fy+'-';const fySettings=(State.DB.masters.dyeLotSettings||[]).find(s=>s.fy===fy);const startingFull=fySettings?.startingNo||'';let startingNum=1;if(startingFull&&startingFull.startsWith(prefix)){startingNum=parseInt(startingFull.replace(prefix,''))||1;}
const existing=(State.DB.dyeLots||[]).filter(d=>d.dyeLotNo&&d.dyeLotNo.startsWith(prefix)).map(d=>parseInt(d.dyeLotNo.replace(prefix,''))||0);const maxExisting=existing.length>0?Math.max(...existing)+1:0;const next=Math.max(startingNum,maxExisting);return next;} // returns serial number only — prefix added by form
function onDyeEndEntrySelect(){const entryId=document.getElementById('dye-end-entry-select').value;if(!entryId){document.getElementById('dye-end-summary').style.display='none';return;}
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
function onDyeSourceLotChange(sel){if(!sel.value)return;const{lotId,grade,vendor}=parseLotSelectValue(sel.value);const bal=getSoftBalanceWeightAvailable(lotId,grade,vendor);sel.title=`Available: ${fmt(bal)}kg`;}
function onPackDyeLotSelect(){const gainEl=document.getElementById('pack-gain-display');if(gainEl)gainEl.style.display='none';const id=document.getElementById('pack-dye-lot-select').value;const infoEl=document.getElementById('pack-lot-info');if(!id){infoEl.style.display='none';return;}
const lot=(State.DB.dyeLots||[]).find(d=>d.id===id);if(!lot){infoEl.style.display='none';return;}
const packed=getTotalPacked(id);const disp=getTotalDispatched(id);const _pGrades=(lot.sources||[]).map(s=>s.grade).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(' + ');
const _wBal2=getWindBalAvailable(id);
infoEl.style.display='block';
infoEl.innerHTML=`<div style="background:var(--s2);border-radius:7px;padding:9px 12px;font-size:0.78rem;color:var(--tx);"><strong>${lot.dyeLotNo}</strong> — ${lot.shade||'—'}<br><span style="color:var(--mu);font-size:0.72rem">Grade: ${_pGrades||'—'}</span><br>Available: <strong>${_wBal2.units||0}c / ${fmt(_wBal2.weight)}kg</strong></div>`;}
export function onWindDyeLotSelect(){const id=document.getElementById('wind-dye-lot-select').value;const infoEl=document.getElementById('wind-lot-info');const infoRow=document.getElementById('wind-dye-lot-info-row');if(!id){infoRow.style.display='none';return;}
const lot=(State.DB.dyeLots||[]).find(d=>d.id===id);if(!lot){infoRow.style.display='none';return;}
infoRow.style.display='';const _wGrades=(lot.sources||[]).map(s=>s.grade).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(' + ');const _wBal=getDyeBalAvailable(id);infoEl.innerHTML=`<strong>${lot.dyeLotNo}</strong> — ${lot.shade}<br><span style="color:var(--mu);font-size:0.72rem">Grade: ${_wGrades||'—'}</span><br>Available: <strong>${_wBal.units||0}c / ${fmt(_wBal.weight)}kg</strong>`;}
function openDeadStockModal(){document.getElementById('ds-alert').innerHTML='';document.getElementById('ds-type').value='';document.getElementById('ds-weight').value='';document.getElementById('ds-note').value='';const G=State.DB.masters.grades||[];document.getElementById('ds-grade').innerHTML=`<option value="">Select grade...</option>`+G.map(g=>`<option value="${g}">${g}</option>`).join('');openModal('deadstock-modal-overlay');}
function openDispatchModal(){document.getElementById('disp-alert').innerHTML='';const dateEl=document.getElementById('m-disp-date');const invoiceEl=document.getElementById('m-disp-invoice');if(dateEl)dateEl.value=today();if(invoiceEl)invoiceEl.value='';populatePartySelect();window._dispLotRows=[];renderDispatchLotRows();addDispatchLotRow();openModal('dispatch-modal');}
function openDyeEndModal(){document.getElementById('dye-end-alert').innerHTML='';document.getElementById('dye-end-shade').value='';document.getElementById('dye-end-out-weight').value='';document.getElementById('dye-end-notes').value='';document.getElementById('dye-end-summary').style.display='none';const W=State.DB.masters.workers||[];const opts=arr=>`<option value="">Select...</option>${arr.map(v=>`<option value="${v}">${v}</option>`).join('')}`;const allInProgress=(State.DB.dyeLots||[]).filter(e=>e.status==='InProgress').sort((a,b)=>(b.dyeLotNo||b.id||'').localeCompare(a.dyeLotNo||a.id||''));const sel=document.getElementById('dye-end-entry-select');sel.innerHTML=`<option value="">Select dye entry...</option>`+
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
function openRMLifecycle(lotId){nav('lifecycle',document.getElementById('ni-lifecycle'));setTimeout(()=>{const sel=document.getElementById('lc-select');if(sel){sel.value=lotId;renderLifecycle();}},100);}
function openPartyFromDyeLot(party,dyeLotNo){nav('party',document.getElementById('ni-party'));setTimeout(function(){const partyFilter=document.getElementById('pt-party-filter');if(partyFilter){partyFilter.value=party;}
const dyeLotFilter=document.getElementById('pt-dylot-filter');if(dyeLotFilter&&dyeLotNo){dyeLotFilter.value=dyeLotNo;}
renderPartyTracker();},150);}
function openDyeLifecycle(dyeLotId,fromRmLotId){nav('dyelifecycle',document.getElementById('ni-dyelifecycle'));const shadeFilter=document.getElementById('dlc-shade-select');if(shadeFilter)shadeFilter.value='';_loadCatalog('dyeLots',()=>{const sel=document.getElementById('dye-lifecycle-select');if(sel){const lots=_dyeLotsForDropdown().sort((a,b)=>(a.dyeLotNo||'').localeCompare(b.dyeLotNo||''));sel.innerHTML='<option value="">Select Dye Lot...</option>'+lots.map(d=>`<option value="${d.id}">${d.dyeLotNo} — ${d.shade}</option>`).join('');if(dyeLotId)sel.value=dyeLotId;}
if(shadeFilter){const allLots=_dyeLotsForDropdown();const shades=[...new Set(allLots.map(d=>d.shade).filter(Boolean))].sort();shadeFilter.innerHTML='<option value="">All Shades</option>'+shades.map(s=>{const cnt=allLots.filter(d=>d.shade===s).length;return`<option value="${s}">${s} (${cnt} lot${cnt>1?'s':''})</option>`;}).join('');}
if(fromRmLotId){const backBtn=document.getElementById('dye-lifecycle-back-btn');if(backBtn){backBtn.style.display='';backBtn.onclick=()=>{nav('lifecycle',document.getElementById('ni-lifecycle'));};}}
renderDyeLifecycle();});}
function openDyeSplitModal(dyeLotId){const lot=(State.DB.dyeLots||[]).find(d=>d.id===dyeLotId);if(!lot){showToast('Dye lot not found','err');return;}
if(lot.status!=='Approved'&&lot.status!=='Edited-Approved'){showToast('Approve dye lot first','err');return;}
document.getElementById('dyesplit-lot-id').value=dyeLotId;document.getElementById('dyesplit-alert').innerHTML='';document.getElementById('dyesplit-good').value='';document.getElementById('dyesplit-off').value='';document.getElementById('dyesplit-reason').value='';document.getElementById('dyesplit-lot-info').innerHTML=`<strong>${lot.dyeLotNo}</strong> — ${lot.shade}<br>Total output: <strong>${fmt(lot.outWeight||0)}kg</strong><br>Already split: ${lot.splitDone?'Yes':'No'}`;openModal('dyesplit-modal-overlay');}
function openDyeStartModal(){document.getElementById('dye-start-alert').innerHTML='';document.getElementById('dye-start-notes').value='';const M=State.DB.masters.machines||[];const W=State.DB.masters.workers||[];const opts=(arr,empty='Select...')=>`<option value="">${empty}</option>${arr.map(v=>`<option value="${v}">${v}</option>`).join('')}`;document.getElementById('dye-start-machine').innerHTML=opts(M);document.getElementById('dye-start-worker').innerHTML=opts(W);document.getElementById('dye-sources-list').innerHTML='';document.getElementById('dye-dead-list').innerHTML='';document.getElementById('dye-recycle-list').innerHTML='';addDyeSourceRow();openModal('dye-start-modal-overlay');}
function openEditEntry(id,type){State._editEntryId=id;State._editEntryType=type;document.getElementById('edit-entry-alert').innerHTML='';document.getElementById('edit-reason-cat').value='';document.getElementById('edit-reason-text').value='';document.getElementById('edit-pwd').value='';const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';document.getElementById('edit-pwd-row').style.display=isAdmin?'none':'';let entry,infoHtml='',fieldsHtml='';if(type==='soft'){entry=(State.DB.stageEntries||[]).find(e=>e.id===id);if(!entry)return;infoHtml=`<strong>${entry.lotId}</strong> — ${entry.grade} — ${entry.stage}`;fieldsHtml=`
      <div class="fg"><label class="fl">In Units</label><input class="fi" type="number" id="ef-inUnits" value="${entry.inUnits||0}"></div><div class="fg"><label class="fl">In Weight (kg)</label><input class="fi" type="number" step="0.01" id="ef-inWeight" value="${entry.inWeight||0}"></div><div class="fg"><label class="fl">Out Units</label><input class="fi" type="number" id="ef-outUnits" value="${entry.outUnits||0}"></div><div class="fg"><label class="fl">Out Weight (kg)</label><input class="fi" type="number" step="0.01" id="ef-outWeight" value="${entry.outWeight||0}"></div>`;}else if(type==='dye'){entry=(State.DB.dyeLots||[]).find(d=>d.id===id);if(!entry)return;infoHtml=`<strong>${entry.dyeLotNo}</strong> — ${entry.shade}`;fieldsHtml=`
      <div class="fg"><label class="fl">Shade</label><input class="fi" id="ef-shade" value="${entry.shade||''}"></div><div class="fg"><label class="fl">Output Weight (kg)</label><input class="fi" type="number" step="0.01" id="ef-outWeight" value="${entry.outWeight||0}"></div>`;}else if(type==='wind'){entry=(State.DB.windEntries||[]).find(e=>e.id===id);if(!entry)return;infoHtml=`<strong>${entry.dyeLotNo}</strong> — ${entry.shade}`;fieldsHtml=`
      <div class="fg"><label class="fl">In Weight (kg)</label><input class="fi" type="number" step="0.01" id="ef-inWeight" value="${entry.inWeight||0}"></div><div class="fg"><label class="fl">Out Weight (kg)</label><input class="fi" type="number" step="0.01" id="ef-outWeight" value="${entry.outWeight||0}"></div>`;}else if(type==='pack'){entry=(State.DB.packEntries||[]).find(e=>e.id===id);if(!entry)return;infoHtml=`<strong>${entry.dyeLotNo}</strong> — ${entry.shade}`;fieldsHtml=`
      <div class="fg"><label class="fl">Bags</label><input class="fi" type="number" id="ef-bags" value="${entry.bags||0}"></div><div class="fg"><label class="fl">Weight (kg)</label><input class="fi" type="number" step="0.01" id="ef-weight" value="${entry.weight||0}"></div>`;}else if(type==='dispatch'){entry=(State.DB.dispatches||[]).find(d=>d.id===id);if(!entry)return;infoHtml=`<strong>${entry.dyeLotNo}</strong> → ${entry.party}`;fieldsHtml=`
      <div class="fg"><label class="fl">Bags</label><input class="fi" type="number" id="ef-bags" value="${entry.bags||0}"></div><div class="fg"><label class="fl">Weight (kg)</label><input class="fi" type="number" step="0.01" id="ef-weight" value="${entry.weight||0}"></div><div class="fg"><label class="fl">Party</label><input class="fi" id="ef-party" value="${entry.party||''}"></div><div class="fg"><label class="fl">Invoice No</label><input class="fi" id="ef-invoice" value="${entry.invoiceNo||''}"></div>`;}
document.getElementById('edit-entry-info').innerHTML=infoHtml;document.getElementById('edit-entry-fields').innerHTML=fieldsHtml;openModal('edit-entry-modal-overlay');}
function openEditEntryModal(id,stage){const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';const isSup=State.currentUser?.role==='supervisor'||isAdmin;if(!isAdmin&&!isSup){showToast('No permission','err');return;}
document.getElementById('edit-entry-id').value=id;document.getElementById('edit-entry-stage').value=stage;document.getElementById('edit-entry-alert').innerHTML='';document.getElementById('edit-reason-cat').value='';document.getElementById('edit-reason-text').value='';document.getElementById('edit-pwd').value='';document.getElementById('edit-pwd-row').style.display=isAdmin?'none':'';const fields=document.getElementById('edit-entry-fields');fields.innerHTML='';if(stage==='soft'){const e=State.DB.stageEntries.find(x=>x.id===id);if(!e)return;fields.innerHTML=`
      <div class="fg"><label class="fl">In Units</label><input class="fi" type="number" id="ef-in-units" value="${e.inUnits||0}"></div><div class="fg"><label class="fl">In Weight (kg)</label><input class="fi" type="number" step="0.01" id="ef-in-weight-soft" value="${e.inWeight||0}"></div><div class="fg"><label class="fl">Out Units</label><input class="fi" type="number" id="ef-out-units" value="${e.outUnits||0}"></div><div class="fg"><label class="fl">Out Weight (kg)</label><input class="fi" type="number" step="0.01" id="ef-out-weight" value="${e.outWeight||0}"></div><div class="fg"><label class="fl">Start Note</label><input class="fi" id="ef-start-note" value="${e.startNote||''}"></div><div class="fg"><label class="fl">End Note</label><input class="fi" id="ef-end-note" value="${e.endNote||''}"></div>`;}else if(stage==='wind'){const e=(State.DB.windEntries||[]).find(x=>x.id===id);if(!e)return;fields.innerHTML=`
      <div class="fg"><label class="fl">In Cones</label><input class="fi" type="number" id="ef-in-cones-wind" value="${e.inCones||0}"></div><div class="fg"><label class="fl">In Weight (kg)</label><input class="fi" type="number" step="0.01" id="ef-in-weight" value="${e.inWeight||0}"></div><div class="fg"><label class="fl">Out Cones</label><input class="fi" type="number" id="ef-out-cones-wind" value="${e.outCones||0}"></div><div class="fg"><label class="fl">Out Weight (kg)</label><input class="fi" type="number" step="0.01" id="ef-out-weight" value="${e.outWeight||0}"></div>`;}else if(stage==='pack'){const e=(State.DB.packEntries||[]).find(x=>x.id===id);if(!e)return;fields.innerHTML=`
      <div class="fg"><label class="fl">In Cones</label><input class="fi" type="number" id="ef-in-cones-pack" value="${e.inCones||0}"></div><div class="fg"><label class="fl">Bags Out</label><input class="fi" type="number" id="ef-bags" value="${e.bags||0}"></div><div class="fg"><label class="fl">Weight (kg)</label><input class="fi" type="number" step="0.01" id="ef-weight" value="${e.weight||0}"></div>`;}else if(stage==='dye'){const d=(State.DB.dyeLots||[]).find(x=>x.id===id);if(!d)return;fields.innerHTML=`
      <div class="fg"><label class="fl">Dye Lot No</label><input class="fi" type="text" id="ef-dye-lot-no" value="${d.dyeLotNo||''}"></div><div class="fg"><label class="fl">Shade</label><input class="fi" type="text" id="ef-shade" value="${d.shade||''}"></div><div class="fg"><label class="fl">Machine</label><input class="fi" type="text" id="ef-machine" value="${d.machine||''}"></div><div class="fg"><label class="fl">In Cones</label><input class="fi" type="number" id="ef-in-cones" value="${d.totalInCones||0}"></div><div class="fg"><label class="fl">In Weight (kg)</label><input class="fi" type="number" step="0.01" id="ef-in-weight" value="${d.totalInWeight||0}"></div><div class="fg"><label class="fl">Out Cones</label><input class="fi" type="number" id="ef-out-cones" value="${d.outCones||0}"></div><div class="fg"><label class="fl">Out Weight (kg)</label><input class="fi" type="number" step="0.01" id="ef-out-weight" value="${d.outWeight||0}"></div><div class="fg"><label class="fl">Notes</label><input class="fi" type="text" id="ef-notes" value="${d.notes||''}"></div>`;}else if(stage==='dispatch'){const d=(State.DB.dispatches||[]).find(x=>x.id===id);if(!d)return;const partyOpts=(State.DB.parties||[]).map(p=>`<option value="${p}" ${p===d.party?'selected':''}>${p}</option>`).join('');fields.innerHTML=`
      <div class="fg"><label class="fl">Bags</label><input class="fi" type="number" id="ef-bags" value="${d.bags||0}"></div><div class="fg"><label class="fl">Weight (kg)</label><input class="fi" type="number" step="0.01" id="ef-weight" value="${d.weight||0}"></div><div class="fg"><label class="fl">Party</label><select class="fs" id="ef-party"><option value="">Select...</option>${partyOpts}</select></div><div class="fg"><label class="fl">Invoice No</label><input class="fi" id="ef-invoice" value="${d.invoiceNo||''}"></div>`;}
openModal('edit-entry-modal-overlay');}
function openPackModal(){document.getElementById('pack-alert').innerHTML='';document.getElementById('pack-bags').value='';document.getElementById('pack-weight').value='';if(document.getElementById('pack-in-weight'))document.getElementById('pack-in-weight').value='';document.getElementById('pack-notes').value='';document.getElementById('pack-lot-info').style.display='none';const W=State.DB.masters.workers||[];const _packWorkerCur=State.currentUser?.name||'';document.getElementById('pack-worker').innerHTML=`<option value="">Select...</option>${W.map(v=>`<option value="${v}"${v===_packWorkerCur?'selected':''}>${v}</option>`).join('')}`;const availLots=(State.DB.dyeLots||[]).filter(d=>(d.status==='Approved'||d.status==='Edited-Approved')&&getWindBalAvailable(d.id).weight>0).sort((a,b)=>(b.dyeLotNo||'').localeCompare(a.dyeLotNo||''));// Searchable dropdown for Pack lot selection
const _packOpts=availLots.map(d=>{const _wb=getWindBalAvailable(d.id);return{id:d.id,label:d.dyeLotNo+' — '+d.shade+' | '+(_wb.units||0)+' cones, '+fmt(_wb.weight)+'kg avail'};});
// Jul 10 2026 fix — same class of bug as Wind, see comment there.
const _packSelEl=document.getElementById('pack-dye-lot-select');
if(_packSelEl)_packSelEl.innerHTML='<option value="">Select Dye Lot...</option>'+_packOpts.map(o=>`<option value="${o.id}">${o.label}</option>`).join('');
const _packSearchEl=document.getElementById('pack-dye-lot-search');
if(_packSearchEl){_packLotSearch=makeDyeLotSearch('pack-dye-lot-search',_packOpts,id=>{document.getElementById('pack-dye-lot-select').value=id;onPackDyeLotSelect();});}openModal('pack-modal-overlay');}
function openScrapModal(id,type){if(State.currentUser?.role!=='admin'&&State.currentUser?.role!=='manager'){showToast('Admin only','err');return;}
document.getElementById('scrap-entry-id').value=id;document.getElementById('scrap-entry-type').value=type;document.getElementById('scrap-alert').innerHTML='';document.getElementById('scrap-weight').value='';document.getElementById('scrap-reason').value='';const info=document.getElementById('scrap-info');if(type==='dead'){const ds=(State.DB.deadStock||[]).find(x=>x.id===id);const bal=getDeadStockBalance(id);info.innerHTML=`Dead Stock ${id} — ${ds?.grade} — ${ds?.type}<br>Remaining balance: <strong>${fmt(bal)}kg</strong>`;}else{const rc=(State.DB.recycleStock||[]).find(x=>x.id===id);const bal=getRecycleBalance(id);info.innerHTML=`Recycle ${id} — ${rc?.dyeLotNo} — ${rc?.shade}<br>Remaining balance: <strong>${fmt(bal)}kg</strong>`;}
openModal('scrap-modal-overlay');}
function openVoidEntry(id,type){const isAdmin=State.currentUser?.role==='admin';const isSup=State.currentUser?.role==='supervisor'||State.currentUser?.role==='manager';if(!isAdmin&&!isSup){showToast('Supervisor or Admin only','err');return;}
State._voidEntryId=id;State._voidEntryType=type;document.getElementById('void-entry-alert').innerHTML='';document.getElementById('void-reason-cat').value='';document.getElementById('void-reason-text').value='';document.getElementById('void-entry-pwd').value='';let entry,infoHtml='',cascadeHtml='';if(type==='soft'){entry=(State.DB.stageEntries||[]).find(e=>e.id===id);infoHtml=`Soft Entry <strong>${id}</strong> — Lot ${entry?.lotId} ${entry?.grade}`;}else if(type==='dye'){entry=(State.DB.dyeLots||[]).find(d=>d.id===id);infoHtml=`Dye Lot <strong>${entry?.dyeLotNo}</strong> — ${entry?.shade}`;const windCount=(State.DB.windEntries||[]).filter(e=>e.dyeLotId===id&&e.status!=='Voided').length;const packCount=(State.DB.packEntries||[]).filter(e=>e.dyeLotId===id&&e.status!=='Voided').length;const dispCount=(State.DB.dispatches||[]).filter(d=>d.dyeLotId===id&&d.status!=='Voided').length;if(windCount||packCount||dispCount){cascadeHtml=`<strong>⚠ This will also void:</strong><br>${windCount} wind entries, ${packCount} pack entries, ${dispCount} dispatches`;}}else if(type==='wind'){entry=(State.DB.windEntries||[]).find(e=>e.id===id);infoHtml=`Wind Entry <strong>${id}</strong> — ${entry?.dyeLotNo}`;const packCount=(State.DB.packEntries||[]).filter(e=>e.dyeLotId===entry?.dyeLotId&&e.status!=='Voided').length;const dispCount=(State.DB.dispatches||[]).filter(d=>d.dyeLotId===entry?.dyeLotId&&d.status!=='Voided').length;if(packCount||dispCount)cascadeHtml=`<strong>⚠ This will also void:</strong><br>${packCount} pack entries, ${dispCount} dispatches`;}else if(type==='pack'){entry=(State.DB.packEntries||[]).find(e=>e.id===id);infoHtml=`Pack Entry <strong>${id}</strong> — ${entry?.dyeLotNo}`;const dispCount=(State.DB.dispatches||[]).filter(d=>d.dyeLotId===entry?.dyeLotId&&d.status!=='Voided').length;if(dispCount)cascadeHtml=`<strong>⚠ This will also void:</strong><br>${dispCount} dispatches for this dye lot`;}else if(type==='dispatch'){entry=(State.DB.dispatches||[]).find(d=>d.id===id);infoHtml=`Dispatch <strong>${id}</strong> — ${entry?.dyeLotNo} → ${entry?.party}`;}
document.getElementById('void-entry-info').innerHTML=infoHtml;const cw=document.getElementById('void-cascade-warning');if(cascadeHtml){cw.style.display='';cw.innerHTML=cascadeHtml;}
else cw.style.display='none';openModal('void-entry-modal-overlay');}
function openVoidModal(id,stage){if(State.currentUser?.role!=='admin'&&State.currentUser?.role!=='manager'){showToast('Admin only','err');return;}
document.getElementById('void2-entry-id').value=id;document.getElementById('void2-entry-stage').value=stage;document.getElementById('void2-alert').innerHTML='';document.getElementById('void2-reason-cat').value='';document.getElementById('void2-reason-text').value='';const chain=buildVoidChain(id,stage);renderVoidChain(chain);openModal('void2-modal-overlay');}
function buildVoidChain(id,stage){const nodes=[];const stageColor={soft:'var(--cs)',dye:'var(--cd)',wind:'var(--cw)',pack:'var(--cp)',dispatch:'var(--gr)',rm:'var(--cr)'};const stageIcon={soft:'💧',dye:'🎨',wind:'🌀',pack:'📦',dispatch:'🚚',rm:'📦'};const addNode=(nId,nStage,label,detail,status,level,autoCheck)=>{nodes.push({id:nId,stage:nStage,label,detail,status,checked:status!=='Voided',autoCheck,level});};if(stage==='soft'){const e=State.DB.stageEntries.find(x=>x.id===id);if(!e)return nodes;addNode(id,'soft',`Soft Entry ${e.id} — Lot ${e.lotId}`,`In: ${fmt(e.inUnits||0)}b / ${fmt(e.inWeight||0)}kg | Out: ${fmt(e.outUnits||0)}b / ${fmt(e.outWeight||0)}kg | ${e.status}`,e.status,0,true);(State.DB.dyeLots||[]).filter(d=>d.status!=='Voided'&&(d.sources||[]).some(s=>s.lotId===e.lotId&&s.grade===e.grade&&s.vendor===e.vendor)).forEach(d=>{const src=(d.sources||[]).find(s=>s.lotId===e.lotId);addNode(d.id,'dye',`Dye Lot ${d.dyeLotNo} — ${d.shade||''}`,`Used ${fmt(src?.weight||0)}kg from this lot | ${d.status}`,d.status,1,false);(State.DB.windEntries||[]).filter(e=>e.dyeLotId===d.id&&e.status!=='Voided').forEach(w=>{addNode(w.id,'wind',`Wind ${w.id}`,`${w.inCones||0}c / ${fmt(w.inWeight||0)}kg in → ${w.outCones||0}c / ${fmt(w.outWeight||0)}kg out | ${w.status}`,w.status,2,false);});(State.DB.packEntries||[]).filter(e=>e.dyeLotId===d.id&&e.status!=='Voided').forEach(p=>{addNode(p.id,'pack',`Pack ${p.id}`,`${p.bags||0} bags / ${fmt(p.weight||0)}kg | ${p.status}`,p.status,2,false);});(State.DB.dispatches||[]).filter(e=>e.dyeLotId===d.id&&e.status!=='Voided').forEach(dp=>{addNode(dp.id,'dispatch',`Dispatch ${dp.id} → ${dp.party||''}`,`${dp.bags||0} bags / ${fmt(dp.weight||0)}kg | ${dp.status}`,dp.status,2,false);});});}else if(stage==='dye'){const lot=(State.DB.dyeLots||[]).find(d=>d.id===id);if(!lot)return nodes;addNode(id,'dye',`Dye Lot ${lot.dyeLotNo} — ${lot.shade||''}`,`In: ${fmt(lot.totalInWeight||0)}kg | Out: ${lot.outCones||0}c / ${fmt(lot.outWeight||0)}kg | ${lot.status}`,lot.status,0,true);(State.DB.windEntries||[]).filter(e=>e.dyeLotId===id&&e.status!=='Voided').forEach(w=>{addNode(w.id,'wind',`Wind ${w.id}`,`${w.inCones||0}c / ${fmt(w.inWeight||0)}kg → ${w.outCones||0}c / ${fmt(w.outWeight||0)}kg | ${w.status}`,w.status,1,true);(State.DB.packEntries||[]).filter(p=>p.dyeLotId===id&&p.status!=='Voided').forEach(p=>{addNode(p.id,'pack',`Pack ${p.id}`,`${p.bags||0}b / ${fmt(p.weight||0)}kg | ${p.status}`,p.status,2,true);});});(State.DB.packEntries||[]).filter(e=>e.dyeLotId===id&&e.status!=='Voided').forEach(p=>{if(!nodes.find(n=>n.id===p.id))
addNode(p.id,'pack',`Pack ${p.id}`,`${p.bags||0}b / ${fmt(p.weight||0)}kg | ${p.status}`,p.status,1,true);});(State.DB.dispatches||[]).filter(e=>e.dyeLotId===id&&e.status!=='Voided').forEach(dp=>{addNode(dp.id,'dispatch',`Dispatch → ${dp.party||''}`,`${dp.bags||0}b / ${fmt(dp.weight||0)}kg | ${dp.status}`,dp.status,1,true);});}else if(stage==='wind'){const w=(State.DB.windEntries||[]).find(x=>x.id===id);if(!w)return nodes;addNode(id,'wind',`Wind ${w.id} — ${w.dyeLotNo||''}`,`${w.inCones||0}c / ${fmt(w.inWeight||0)}kg → ${w.outCones||0}c out | ${w.status}`,w.status,0,true);(State.DB.packEntries||[]).filter(p=>p.dyeLotId===w.dyeLotId&&p.status!=='Voided').forEach(p=>{addNode(p.id,'pack',`Pack ${p.id}`,`${p.bags||0}b / ${fmt(p.weight||0)}kg | ${p.status}`,p.status,1,false);});}else if(stage==='pack'){const p=(State.DB.packEntries||[]).find(x=>x.id===id);if(!p)return nodes;addNode(id,'pack',`Pack ${p.id} — ${p.dyeLotNo||''}`,`${p.bags||0}b / ${fmt(p.weight||0)}kg | ${p.status}`,p.status,0,true);(State.DB.dispatches||[]).filter(d=>d.dyeLotId===p.dyeLotId&&d.status!=='Voided').forEach(dp=>{addNode(dp.id,'dispatch',`Dispatch → ${dp.party||''}`,`${dp.bags||0}b / ${fmt(dp.weight||0)}kg | ${dp.status}`,dp.status,1,false);});}else if(stage==='dispatch'){const dp=(State.DB.dispatches||[]).find(x=>x.id===id);if(!dp)return nodes;addNode(id,'dispatch',`Dispatch → ${dp.party||''}`,`${dp.bags||0}b / ${fmt(dp.weight||0)}kg | Invoice: ${dp.invoiceNo||'—'} | ${dp.status}`,dp.status,0,true);}else if(stage==='rm'){const lot=(State.DB.lots||[]).find(x=>x.id===id);if(!lot)return nodes;addNode(id,'rm',`RM Lot ${lot.id} — ${lot.grade||''} (${lot.vendor||''})`,`${lot.units||0} bags / ${fmt(lot.weight||0)}kg | ${lot.status||'Active'}`,lot.status||'Active',0,true);(State.DB.stageEntries||[]).filter(e=>e.lotId===lot.id&&e.status!=='Voided').forEach(e=>{addNode(e.id,'soft',`Soft Entry ${e.id}`,`In: ${fmt(e.inWeight||0)}kg | Out: ${fmt(e.outWeight||0)}kg | ${e.status}`,e.status,1,false);});}
return nodes;}
function renderVoidChain(nodes){const el=document.getElementById('void2-chain');if(!el)return;const stageClr={soft:'var(--cs)',dye:'var(--cd)',wind:'var(--cw)',pack:'var(--cp)',dispatch:'var(--gr)',rm:'var(--cr)'};const stageIc={soft:'💧',dye:'🎨',wind:'🌀',pack:'📦',dispatch:'🚚',rm:'📦'};const primary=nodes.filter(n=>n.level===0);const downstream=nodes.filter(n=>n.level>0);let html=`<div style="font-size:0.72rem;color:var(--mu);margin-bottom:8px;font-weight:700;text-transform:uppercase;letter-spacing:.06em">Select entries to void:</div>`;nodes.forEach((n,idx)=>{const indent=n.level*20;const connector=n.level>0?`<span style="color:var(--mu);margin-right:4px">${n.level===1?'├──':'└──'}</span>`:'';const clr=stageClr[n.stage]||'var(--ac)';const ic=stageIc[n.stage]||'•';const alreadyVoided=n.status==='Voided';html+=`<div style="display:flex;align-items:flex-start;gap:8px;padding:7px 10px;margin-left:${indent}px;
      border-left:3px solid ${n.level===0?clr:'var(--b2)'};
      background:${alreadyVoided?'rgba(100,100,100,0.05)':n.level===0?'rgba(239,68,68,0.05)':'var(--s2)'};
      border-radius:6px;margin-bottom:4px;opacity:${alreadyVoided?'0.5':'1'}"><input type="checkbox" id="vchain-${idx}" value="${idx}" ${n.checked&&!alreadyVoided?'checked':''} ${alreadyVoided?'disabled':''} 
        style="margin-top:3px;accent-color:var(--re);width:14px;height:14px;flex-shrink:0"><div style="flex:1;min-width:0"><div style="font-size:0.75rem;font-weight:700;color:${alreadyVoided?'var(--mu)':clr}">
          ${connector}${ic} ${n.label}
          ${alreadyVoided?'<span style="font-size:0.62rem;color:var(--mu);margin-left:6px">Already voided</span>':''}
        </div><div style="font-size:0.65rem;color:var(--mu);margin-top:2px">${n.detail}</div></div></div>`;});if(downstream.length>0){html+=`<div style="margin-top:8px;padding:6px 10px;background:rgba(239,68,68,0.06);border-radius:6px;font-size:0.68rem;color:var(--re);">
      ⚠ Unchecked downstream entries will NOT be voided but their balances may be affected. Review carefully.
    </div>`;}
el.innerHTML=html;el._voidNodes=nodes;}
function openWindModal(mode){State._windMode=mode;document.getElementById('wind-modal-title').textContent=mode==='Start'?'▶ Start Wind':'✓ End Wind';document.getElementById('wind-alert').innerHTML='';document.getElementById('wind-notes').value='';const M=(State.DB.masters||{}).machines||[],W=(State.DB.masters||{}).workers||[];const opts=arr=>'<option value="">Select...</option>'+arr.map(v=>'<option value="'+v+'">'+v+'</option>').join('');const _windWorkerCur=State.currentUser?.name||'';const optsW=arr=>'<option value="">Select...</option>'+arr.map(v=>'<option value="'+v+'" '+(v===_windWorkerCur?'selected':'')+'>'+v+'</option>').join('');const mSel=document.getElementById('wind-machine-select');if(mSel)mSel.innerHTML=opts(M);const wSel=document.getElementById('wind-worker-select');if(wSel)wSel.innerHTML=optsW(W);const show=(id,v)=>{const el=document.getElementById(id);if(el)el.style.display=v?'':'none';};if(mode==='Start'){show('wind-dye-lot-row',true);show('wind-rc-row',false);show('wind-in-cones-row',true);show('wind-in-weight-fg',true);show('wind-machine-row',true);show('wind-worker-row',true);show('wind-entry-select-row',false);show('wind-out-weight-row',false);show('wind-out-cones-row',false);document.getElementById('wind-in-weight').value='';if(document.getElementById('wind-in-cones'))document.getElementById('wind-in-cones').value='';const availLots=(State.DB.dyeLots||[]).filter(d=>(d.status==='Approved'||d.status==='Edited-Approved')&&getDyeBalAvailable(d.id).weight>0).sort((a,b)=>(b.dyeLotNo||'').localeCompare(a.dyeLotNo||''));// Searchable dropdown for Wind lot selection
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
async function rejectDispatch(id){try{const {ok,error,networkError}=await apiPost('/api/reject',{type:'dispatch',id,changedBy:State.currentUser?.name,role:State.currentUser?.role});if(networkError)throw new Error(error);if(!ok){showToast(error||'Reject failed','err');return;}showToast('Dispatch rejected','err');renderAll();}catch(e){showToast('Network error — '+e.message,'err');}}
async function rejectDyeLot(id){try{const {ok,error,networkError}=await apiPost('/api/reject',{type:'dye',id,changedBy:State.currentUser?.name,role:State.currentUser?.role});if(networkError)throw new Error(error);if(!ok){showToast(error||'Reject failed','err');return;}showToast('Dye Lot rejected','err');renderAll();}catch(e){showToast('Network error — '+e.message,'err');}}
async function rejectPackEntry(id){try{const {ok,error,networkError}=await apiPost('/api/reject',{type:'pack',id,changedBy:State.currentUser?.name,role:State.currentUser?.role});if(networkError)throw new Error(error);if(!ok){showToast(error||'Reject failed','err');return;}showToast('Pack entry rejected','err');renderAll();}catch(e){showToast('Network error — '+e.message,'err');}}
async function rejectWindEntry(id){try{const {ok,error,networkError}=await apiPost('/api/reject',{type:'wind',id,changedBy:State.currentUser?.name,role:State.currentUser?.role});if(networkError)throw new Error(error);if(!ok){showToast(error||'Reject failed','err');return;}showToast('Wind entry rejected','err');renderAll();}catch(e){showToast('Network error — '+e.message,'err');}}
function renderApprDispatch(){}
function renderApprDye(){}
function renderApprPack(){}
function renderApprSoft(){}
function renderApprWind(){}
function renderApprovalDispatch(){const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';const isSup=State.currentUser?.role==='supervisor'||isAdmin;const pending=(State.DB.dispatches||[]).filter(d=>d.status==='Pending');const approved=(State.DB.dispatches||[]).filter(d=>d.status==='Approved').sort((a,b)=>(b.approvedAt||'').localeCompare(a.approvedAt||'')).slice(0,8);const rejected=(State.DB.dispatches||[]).filter(d=>d.status==='Rejected'||d.status==='Voided').slice(0,5);const countEl=document.getElementById('appr-dispatch-count');if(countEl)countEl.textContent=pending.length?`(${pending.length} pending)`:'(none)';const card=(d,showActions)=>`<div style="padding:12px;border:1px solid var(--b1);border-radius:8px;margin-bottom:8px;"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;"><div><span class="mono" style="font-size:0.7rem;color:var(--mu)">${d.id}</span><span class="mono" style="color:var(--ac);margin-left:8px">${d.dyeLotNo||'—'}</span><span style="font-size:0.75rem;font-weight:600;margin-left:8px">${d.party||'—'}</span>
        ${d.status==='Voided'?'<span style="color:var(--re);font-size:0.68rem;margin-left:8px">🗑 Voided</span>':''}
      </div><div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${showActions&&isSup&&d.status==='Pending'?`<button class="btn btn-success btn-xs tc-tip" data-tip="Approve" onclick="approveDispatch('${d.id}')">✓</button><button class="btn btn-danger btn-xs tc-tip" data-tip="Reject" onclick="rejectDispatch('${d.id}')">✗</button>`:''}
        ${showActions&&isAdmin&&d.status==='Approved'?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Edit" onclick="openEditEntryModal('${d.id}','dispatch')">✏</button><button class="btn btn-ghost btn-xs tc-tip" data-tip="Void" style="color:var(--re)" onclick="openVoidModal('${d.id}','dispatch')">🗑</button>`:''}
        ${showActions&&isAdmin&&d.status==='Rejected'?`<button class="btn btn-success btn-xs"onclick="openOverride('${d.id}','dispatch')">↩ Override</button><button class="btn btn-ghost btn-xs tc-tip" data-tip="Void" style="color:var(--re)" onclick="openVoidModal('${d.id}','dispatch')">🗑</button>`:''}
      </div></div><div style="display:flex;gap:16px;margin-top:8px;font-size:0.72rem;color:var(--mu);flex-wrap:wrap;"><span>Bags: <strong style="color:var(--tx)">${fmt(d.bags)}</strong></span><span>Weight: <strong style="color:var(--tx)">${fmt(d.weight)}kg</strong></span><span>${d.shade||''}</span>
      ${d.approvedBy?`<span style="color:var(--gr)">✓ ${d.approvedBy}</span>`:''} ${d.rejectedBy?`<span style="color:var(--re)">✗ ${d.rejectedBy}${d.rejectReason?' — '+d.rejectReason:''}</span>`:''} ${d.status==='Voided'&&d.voidedBy?`<span style="color:var(--re)">🗑 ${d.voidedBy}</span>`:''}
      ${d.invoiceNo?`<span>Invoice:${d.invoiceNo}</span>`:''}
    </div>
    ${d.notes?`<div style="margin-top:6px;padding:5px 8px;background:var(--s2);border-radius:5px;font-size:0.68rem;color:var(--mu);">📝<span style="color:var(--tx)">${d.notes}</span></div>`:''}
  </div>`;document.getElementById('appr-dispatch-pending').innerHTML=pending.length?pending.map(d=>card(d,true)).join(''):'<div style="color:var(--mu);font-size:0.75rem;padding:8px">No pending dispatches</div>';document.getElementById('appr-dispatch-approved').innerHTML=approved.map(d=>card(d,true)).join('')||'<div style="color:var(--mu);font-size:0.75rem;padding:8px">None</div>';document.getElementById('appr-dispatch-rejected').innerHTML=rejected.map(d=>card(d,isAdmin)).join('')||'<div style="color:var(--mu);font-size:0.75rem;padding:8px">None</div>';}
function renderApprovalDye(){const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';const isSup=State.currentUser?.role==='supervisor'||isAdmin;const pending=(State.DB.dyeLots||[]).filter(d=>d.status==='Pending');const approved=(State.DB.dyeLots||[]).filter(d=>d.status==='Approved'||d.status==='Edited-Approved').sort((a,b)=>(b.approvedAt||'').localeCompare(a.approvedAt||'')).slice(0,8);const rejected=(State.DB.dyeLots||[]).filter(d=>d.status==='Rejected'||d.status==='Voided').slice(0,5);const countEl=document.getElementById('appr-dye-count');if(countEl)countEl.textContent=pending.length?`(${pending.length} pending)`:'(none)';const lotCard=(d,showActions)=>`<div style="padding:12px;border:1px solid var(--b1);border-radius:8px;margin-bottom:8px;"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;"><div><span class="mono" style="font-size:0.78rem;font-weight:700;color:var(--ac)">${d.dyeLotNo||d.id}</span><span style="font-size:0.75rem;margin-left:8px;color:var(--mu)">${d.shade||'—'}</span>
        ${d.status==='Edited-Approved'?'<span style="color:var(--ye);font-size:0.68rem;margin-left:8px">✏ Edited</span>':''}
        ${d.status==='Voided'?'<span style="color:var(--re);font-size:0.68rem;margin-left:8px">🗑 Voided</span>':''}
      </div><div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${showActions&&isSup&&d.status==='Pending'?`<button class="btn btn-success btn-xs"onclick="approveDyeLot('${d.id}')">✓ Approve</button><button class="btn btn-danger btn-xs"onclick="rejectDyeLot('${d.id}')">✗ Reject</button>`:''}
        ${showActions&&isAdmin&&(d.status==='Approved'||d.status==='Edited-Approved')?`<button class="btn btn-ghost btn-xs"style="color:var(--re)"onclick="openVoidModal('${d.id}','dye')">🗑 Void</button>`:''}
        ${showActions&&isAdmin&&d.status==='Rejected'?`<button class="btn btn-success btn-xs"onclick="openOverride('${d.id}','dye')">↩ Override</button><button class="btn btn-ghost btn-xs"style="color:var(--re)"onclick="openVoidModal('${d.id}','dye')">🗑 Void</button>`:''}
      </div></div><div style="display:flex;gap:16px;margin-top:8px;font-size:0.72rem;color:var(--mu);flex-wrap:wrap;"><span>In: <strong style="color:var(--tx)">${d.totalInCones||'?'}c / ${fmt(d.totalInWeight)}kg</strong></span><span>Out: <strong style="color:var(--tx)">${d.outCones?d.outCones+'c / ':''} ${fmt(d.outWeight||0)}kg${d.gain>0?' <span style="color:var(--gr)">▲'+fmt(d.gain)+'kg</span>':''}</strong></span><span>Sources: ${(d.sources||[]).map(s=>s.lotId).join(', ')}</span>
      ${d.approvedBy?`<span style="color:var(--gr)">✓ ${d.approvedBy}</span>`:''}
      ${d.rejectedBy?`<span style="color:var(--re)">✗ ${d.rejectedBy}${d.rejectReason?' — '+d.rejectReason:''}</span>`:''}
      ${d.status==='Voided'&&d.voidedBy?`<span style="color:var(--re)">🗑 ${d.voidedBy}</span>`:''}
    </div>
    ${d.notes?`<div style="margin-top:6px;padding:5px 8px;background:var(--s2);border-radius:5px;font-size:0.68rem;color:var(--mu);">📝<span style="color:var(--tx)">${d.notes}</span></div>`:''}
  </div>`;document.getElementById('appr-dye-pending').innerHTML=pending.length?pending.map(d=>lotCard(d,true)).join(''):'<div style="color:var(--mu);font-size:0.75rem;padding:8px">No pending dye lots</div>';document.getElementById('appr-dye-approved').innerHTML=approved.map(d=>lotCard(d,true)).join('')||'<div style="color:var(--mu);font-size:0.75rem;padding:8px">None</div>';document.getElementById('appr-dye-rejected').innerHTML=rejected.map(d=>lotCard(d,isAdmin)).join('')||'<div style="color:var(--mu);font-size:0.75rem;padding:8px">None</div>';}
function renderApprovalPack(){const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';const isSup=State.currentUser?.role==='supervisor'||isAdmin;const pending=(State.DB.packEntries||[]).filter(e=>e.status==='Pending');const approved=(State.DB.packEntries||[]).filter(e=>e.status==='Approved').sort((a,b)=>(b.approvedAt||'').localeCompare(a.approvedAt||'')).slice(0,8);const rejected=(State.DB.packEntries||[]).filter(e=>e.status==='Rejected'||e.status==='Voided').slice(0,5);const countEl=document.getElementById('appr-pack-count');if(countEl)countEl.textContent=pending.length?`(${pending.length} pending)`:'(none)';const card=(e,showActions)=>`<div style="padding:12px;border:1px solid var(--b1);border-radius:8px;margin-bottom:8px;"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;"><div><span class="mono" style="font-size:0.7rem;color:var(--mu)">${e.id}</span><span class="mono" style="color:var(--ac);margin-left:8px">${e.dyeLotNo||'—'}</span><span style="font-size:0.72rem;color:var(--mu);margin-left:6px">${e.shade||''}</span>
        ${e.status==='Voided'?'<span style="color:var(--re);font-size:0.68rem;margin-left:8px">🗑 Voided</span>':''}
      </div><div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${showActions&&isSup&&e.status==='Pending'?`<button class="btn btn-success btn-xs tc-tip" data-tip="Approve" onclick="approvePackEntry('${e.id}')">✓</button><button class="btn btn-danger btn-xs tc-tip" data-tip="Reject" onclick="rejectPackEntry('${e.id}')">✗</button>`:''}
        ${showActions&&isAdmin&&e.status==='Approved'?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Edit" onclick="openEditEntryModal('${e.id}','pack')">✏</button><button class="btn btn-ghost btn-xs tc-tip" data-tip="Void" style="color:var(--re)" onclick="openVoidModal('${e.id}','pack')">🗑</button>`:''}
        ${showActions&&isAdmin&&e.status==='Rejected'?`<button class="btn btn-success btn-xs"onclick="openOverride('${e.id}','pack')">↩ Override</button><button class="btn btn-ghost btn-xs tc-tip" data-tip="Void" style="color:var(--re)" onclick="openVoidModal('${e.id}','pack')">🗑</button>`:''}
      </div></div><div style="display:flex;gap:16px;margin-top:8px;font-size:0.72rem;color:var(--mu);flex-wrap:wrap;"><span>Bags: <strong style="color:var(--tx)">${fmt(e.bags)}</strong></span><span>Weight: <strong style="color:var(--tx)">${fmt(e.weight)}kg</strong></span><span>By: ${e.worker||'—'}</span><span>${fmtTS(e.timestamp)}</span>
      ${e.approvedBy?`<span style="color:var(--gr)">✓ ${e.approvedBy}</span>`:''} ${e.rejectedBy?`<span style="color:var(--re)">✗ ${e.rejectedBy}${e.rejectReason?' — '+e.rejectReason:''}</span>`:''} ${e.status==='Voided'&&e.voidedBy?`<span style="color:var(--re)">🗑 ${e.voidedBy}</span>`:''} ${e.rejectedBy?`<span style="color:var(--re)">✗ ${e.rejectedBy}${e.rejectReason?' — '+e.rejectReason:''}</span>`:''} ${e.status==='Voided'&&e.voidedBy?`<span style="color:var(--re)">🗑 ${e.voidedBy}</span>`:''} ${e.rejectedBy?`<span style="color:var(--re)">✗ ${e.rejectedBy}${e.rejectReason?' — '+e.rejectReason:''}</span>`:''} ${e.status==='Voided'&&e.voidedBy?`<span style="color:var(--re)">🗑 ${e.voidedBy}</span>`:''}
    </div>
    ${e.notes?`<div style="margin-top:6px;padding:5px 8px;background:var(--s2);border-radius:5px;font-size:0.68rem;color:var(--mu);">📝<span style="color:var(--tx)">${e.notes}</span></div>`:''}
  </div>`;document.getElementById('appr-pack-pending').innerHTML=pending.length?pending.map(e=>card(e,true)).join(''):'<div style="color:var(--mu);font-size:0.75rem;padding:8px">No pending pack entries</div>';document.getElementById('appr-pack-approved').innerHTML=approved.map(e=>card(e,true)).join('')||'<div style="color:var(--mu);font-size:0.75rem;padding:8px">None</div>';document.getElementById('appr-pack-rejected').innerHTML=rejected.map(e=>card(e,isAdmin)).join('')||'<div style="color:var(--mu);font-size:0.75rem;padding:8px">None</div>';}
function renderApprovalSoft(){const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';const isSupervisor=State.currentUser?.role==='supervisor'||isAdmin;const pending=State.DB.stageEntries.filter(e=>e.status==='Pending'||e.status==='Edited-Pending');const approved=State.DB.stageEntries.filter(e=>e.status==='Approved'||e.status==='Edited-Approved').sort((a,b)=>(b.approvedAt||'').localeCompare(a.approvedAt||'')).slice(0,10);const rejected=State.DB.stageEntries.filter(e=>e.status==='Rejected'||e.status==='Voided').sort((a,b)=>(b.startTime||'').localeCompare(a.startTime||'')).slice(0,5);const countEl=document.getElementById('appr-soft-count');if(countEl)countEl.textContent=pending.length?`(${pending.length} pending)`:'(none)';const entryCard=(e,showActions)=>{const isDispatched=isEntryLocked(e.id,'soft');const imbalance=checkImbalance(e);const isPending=e.status==='Pending'||e.status==='Edited-Pending';const isApproved=e.status==='Approved'||e.status==='Edited-Approved';const isRejected=e.status==='Rejected';const isVoided=e.status==='Voided';return`<div style="padding:12px;border:1px solid var(--b1);border-radius:8px;margin-bottom:8px;${imbalance?'border-color:rgba(239,68,68,0.4);background:rgba(239,68,68,0.04)':''}${isVoided?';opacity:0.6':''}"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;"><div><span class="mono" style="font-size:0.7rem;color:var(--mu)">${e.id}</span><span class="badge b-rm" style="margin-left:8px">${e.stage}</span><span style="font-size:0.78rem;font-weight:600;margin-left:8px">${e.lotId}</span><span style="font-size:0.72rem;color:var(--mu);margin-left:4px">${e.grade||''} · ${e.vendor||''}</span>
          ${e.deadStockId?`<span class="badge"style="margin-left:6px;background:rgba(255,165,0,0.15);color:var(--ye)">📦 DS:${e.deadStockId}</span>`:''}
          ${e.recycleId?`<span class="badge"style="margin-left:6px;background:rgba(100,200,100,0.15);color:var(--gr)">♻ RC:${e.recycleId}</span>`:''}
          ${imbalance?`<span style="color:var(--re);font-size:0.68rem;margin-left:8px">⚠ ${imbalance}</span>`:''}
          ${isDispatched?'<span style="margin-left:8px" title="Locked — dispatched">🔒</span>':''}
          ${isVoided?'<span style="color:var(--re);font-size:0.68rem;margin-left:8px">🗑 Voided</span>':''}
          ${isRejected?'<span style="color:var(--re);font-size:0.68rem;margin-left:8px">✗ Rejected</span>':''}
          ${e.status==='Edited-Approved'||e.status==='Edited-Pending'?'<span style="color:var(--ye);font-size:0.68rem;margin-left:8px">✏ Edited</span>':''}
        </div><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          ${showActions&&isSupervisor&&isPending&&!isDispatched?`<button class="btn btn-success btn-xs tc-tip" data-tip="Approve" onclick="approveEntry('${e.id}','stage')">✓ Approve</button><button class="btn btn-danger btn-xs tc-tip" data-tip="Reject" onclick="rejectEntry('${e.id}','stage')">✗ Reject</button>${isAdmin?`<button class="btn btn-ghost btn-xs" style="color:var(--re)" onclick="openVoidModal('${e.id}','soft')">🗑 Void</button>`:''}`:''}
          ${showActions&&isAdmin&&isApproved&&!isDispatched?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Edit" onclick="openEditEntryModal('${e.id}','soft')">✏ Edit</button><button class="btn btn-ghost btn-xs tc-tip" data-tip="Void" style="color:var(--re)" onclick="openVoidModal('${e.id}','soft')">🗑 Void</button>`:''}
          ${showActions&&isAdmin&&isRejected?`<button class="btn btn-success btn-xs"onclick="executeOverride('${e.id}','stage')">↩ Override</button><button class="btn btn-ghost btn-xs tc-tip" data-tip="Void" style="color:var(--re)" onclick="openVoidModal('${e.id}','soft')">🗑 Void</button>`:''}
        </div></div><div style="display:flex;gap:16px;margin-top:8px;font-size:0.72rem;color:var(--mu);flex-wrap:wrap;"><span>In: <strong style="color:var(--tx)">${fmt(e.inUnits)}b / ${fmt(e.inWeight)}kg</strong></span><span>Out: <strong style="color:var(--tx)">${e.outUnits?fmt(e.outUnits)+'b / '+fmt(e.outWeight)+'kg':'—'}</strong></span><span>By: ${e.startWorker||'—'}</span><span>At: ${fmtTS(e.startTime)}</span>
        ${e.approvedBy?`<span style="color:var(--gr)">✓ ${e.approvedBy}</span>`:''}
      </div>
      ${(e.startNote||e.endNote)?`<div style="margin-top:6px;padding:5px 8px;background:var(--s2);border-radius:5px;font-size:0.68rem;color:var(--mu);">${e.startNote?`📝 Start: <span style="color:var(--tx)">${e.startNote}</span>`:''}
${e.startNote&&e.endNote?' · ':''}
${e.endNote?`📝 End: <span style="color:var(--tx)">${e.endNote}</span>`:''}</div>`:''}
    </div>`;};document.getElementById('appr-soft-pending').innerHTML=pending.length?pending.map(e=>entryCard(e,true)).join(''):'<div style="color:var(--mu);font-size:0.75rem;padding:8px">No pending entries</div>';document.getElementById('appr-soft-approved').innerHTML=approved.map(e=>entryCard(e,true)).join('')||'<div style="color:var(--mu);font-size:0.75rem;padding:8px">None</div>';document.getElementById('appr-soft-rejected').innerHTML=rejected.map(e=>entryCard(e,isAdmin)).join('')||'<div style="color:var(--mu);font-size:0.75rem;padding:8px">None</div>';}
function renderApprovalTab(tab){if(tab==='soft')renderApprovalSoft();else if(tab==='dye')renderApprovalDye();else if(tab==='wind')renderApprovalWind();else if(tab==='pack')renderApprovalPack();else if(tab==='dispatch')renderApprovalDispatch();}
function renderApprovalWind(){const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';const isSup=State.currentUser?.role==='supervisor'||isAdmin;const pending=(State.DB.windEntries||[]).filter(e=>e.status==='Pending');const approved=(State.DB.windEntries||[]).filter(e=>e.status==='Approved').sort((a,b)=>(b.approvedAt||'').localeCompare(a.approvedAt||'')).slice(0,8);const rejected=(State.DB.windEntries||[]).filter(e=>e.status==='Rejected'||e.status==='Voided').slice(0,5);const countEl=document.getElementById('appr-wind-count');if(countEl)countEl.textContent=pending.length?`(${pending.length} pending)`:'(none)';const card=(e,showActions)=>`<div style="padding:12px;border:1px solid var(--b1);border-radius:8px;margin-bottom:8px;"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;"><div><span class="mono" style="font-size:0.7rem;color:var(--mu)">${e.id}</span><span class="mono" style="color:var(--ac);margin-left:8px;font-size:0.78rem">${e.dyeLotNo||'—'}</span><span style="font-size:0.72rem;color:var(--mu);margin-left:6px">${e.shade||''}</span>
        ${e.recycleId?`<span class="badge"style="margin-left:6px;background:rgba(100,200,100,0.15);color:var(--gr)">♻ RC:${e.recycleId}</span>`:''}
        ${e.status==='Voided'?'<span style="color:var(--re);font-size:0.68rem;margin-left:8px">🗑 Voided</span>':''}
      </div><div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${showActions&&isSup&&e.status==='Pending'?`<button class="btn btn-success btn-xs tc-tip" data-tip="Approve" onclick="approveWindEntry('${e.id}')">✓</button><button class="btn btn-danger btn-xs tc-tip" data-tip="Reject" onclick="rejectWindEntry('${e.id}')">✗</button>`:''}
        ${showActions&&isAdmin&&e.status==='Approved'?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Edit" onclick="openEditEntryModal('${e.id}','wind')">✏</button><button class="btn btn-ghost btn-xs tc-tip" data-tip="Void" style="color:var(--re)" onclick="openVoidModal('${e.id}','wind')">🗑</button>`:''}
        ${showActions&&isAdmin&&e.status==='Rejected'?`<button class="btn btn-success btn-xs"onclick="openOverride('${e.id}','wind')">↩ Override</button><button class="btn btn-ghost btn-xs tc-tip" data-tip="Void" style="color:var(--re)" onclick="openVoidModal('${e.id}','wind')">🗑</button>`:''}
      </div></div><div style="display:flex;gap:16px;margin-top:8px;font-size:0.72rem;color:var(--mu);flex-wrap:wrap;"><span>In: <strong style="color:var(--tx)">${e.inCones||'?'}c / ${fmt(e.inWeight)}kg</strong></span><span>Out: <strong style="color:var(--tx)">${e.outCones?(e.outCones+'c / '+fmt(e.outWeight)+'kg'):(e.outWeight?fmt(e.outWeight)+'kg':'—')}</strong></span><span>By: ${e.startWorker||'—'}</span>
      ${e.approvedBy?`<span style="color:var(--gr)">✓ ${e.approvedBy}</span>`:''}
    </div>
    ${e.notes?`<div style="margin-top:6px;padding:5px 8px;background:var(--s2);border-radius:5px;font-size:0.68rem;color:var(--mu);">📝<span style="color:var(--tx)">${e.notes}</span></div>`:''}
  </div>`;document.getElementById('appr-wind-pending').innerHTML=pending.length?pending.map(e=>card(e,true)).join(''):'<div style="color:var(--mu);font-size:0.75rem;padding:8px">No pending wind entries</div>';document.getElementById('appr-wind-approved').innerHTML=approved.map(e=>card(e,true)).join('')||'<div style="color:var(--mu);font-size:0.75rem;padding:8px">None</div>';document.getElementById('appr-wind-rejected').innerHTML=rejected.map(e=>card(e,isAdmin)).join('')||'<div style="color:var(--mu);font-size:0.75rem;padding:8px">None</div>';}

// ══════════════════════════════════════
// RM RETURN (to vendor) — lot+grade+vendor pool-scoped, cascading Vendor→Grade→Lot
// picker (same pattern as addDyeSourceRow). Qualitative reasons only — RM return
// is not quantity-driven, it's vendor/quality driven (Jul 8 2026).
// ══════════════════════════════════════
function openRMReturnModal(){
  if(State.currentUser?.role!=='admin'&&State.currentUser?.role!=='manager'&&State.currentUser?.role!=='supervisor'){showToast('No permission','err');return;}
  const lotsWithBal=State.DB.lots.filter(l=>getRMBalance(l.id,l.grade,l.vendor).weight>0.01);
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
function onRMRVendorChange(){
  const vendor=document.getElementById('rmr-vendor').value;
  const gSel=document.getElementById('rmr-grade');const lSel=document.getElementById('rmr-lot');
  gSel.innerHTML='<option value="">Select grade...</option>';lSel.innerHTML='<option value="">Select lot...</option>';lSel.disabled=true;
  document.getElementById('rmr-info').innerHTML='';
  if(!vendor){gSel.disabled=true;return;}
  const grades=[...new Set(State.DB.lots.filter(l=>l.vendor===vendor&&getRMBalance(l.id,l.grade,l.vendor).weight>0.01).map(l=>l.grade))].sort();
  if(!grades.length){gSel.innerHTML='<option value="">No grades available</option>';gSel.disabled=true;return;}
  gSel.innerHTML='<option value="">Select grade...</option>'+grades.map(g=>`<option value="${g}">${g}</option>`).join('');
  gSel.disabled=false;
}
function onRMRGradeChange(){
  const vendor=document.getElementById('rmr-vendor').value;
  const grade=document.getElementById('rmr-grade').value;
  const lSel=document.getElementById('rmr-lot');
  lSel.innerHTML='<option value="">Select lot...</option>';
  document.getElementById('rmr-info').innerHTML='';
  if(!vendor||!grade){lSel.disabled=true;return;}
  const lots=State.DB.lots.filter(l=>l.vendor===vendor&&l.grade===grade&&getRMBalance(l.id,l.grade,l.vendor).weight>0.01);
  if(!lots.length){lSel.innerHTML='<option value="">No lots available</option>';lSel.disabled=true;return;}
  lSel.innerHTML='<option value="">Select lot...</option>'+lots.map(l=>{const bal=getRMBalance(l.id,l.grade,l.vendor);return`<option value="${l.id}">${l.id} (${fmt(bal.units)}b / ${fmt(bal.weight)}kg avail)</option>`;}).join('');
  lSel.disabled=false;
}
function onRMRLotChange(){
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
async function submitRMReturn(){
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
    renderRMReturnLog();renderAll();
  }catch(e){setAlert('Network error — not saved: '+e.message);}
}
function renderRMReturnLog(){
  const tbody=document.getElementById('rmr-tbody');if(!tbody)return;
  const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';
  const isSup=State.currentUser?.role==='supervisor'||isAdmin;
  const logs=(State.DB.rmReturnLog||[]).slice().sort((a,b)=>(b.timestamp||'').localeCompare(a.timestamp||''));
  if(!logs.length){tbody.innerHTML=`<tr><td colspan="9"><div class="empty"><div class="empty-icon">↩</div><div class="empty-text">No RM returns yet</div></div></td></tr>`;return;}
  tbody.innerHTML=logs.map(r=>`<tr${r.status==='Voided'?' style="opacity:0.5"':''}>
    <td style="font-size:0.72rem;color:var(--mu)">${r.timestamp?fmtTS(r.timestamp):(r.date||'—')}</td>
    <td class="mono" style="color:var(--ac);font-weight:700">${r.lotId||'—'}</td>
    <td><span class="badge b-rm">${r.grade||'—'}</span></td>
    <td style="font-size:0.72rem">${r.vendor||'—'}</td>
    <td class="mono">${fmt(r.units)}b / ${fmt(r.weight)}kg</td>
    <td style="font-size:0.72rem;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.reason||''}">${r.reason||'—'}</td>
    <td style="font-size:0.72rem;color:var(--mu)">${r.by||'—'}</td>
    <td>${r.status==='Voided'?'<span class="badge b-void">Voided</span>':'<span style="font-size:0.72rem;font-weight:700;color:var(--gr)">Approved</span>'}</td>
    <td style="white-space:nowrap">${r.status==='Voided'?'—':`${isSup?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Edit" onclick="openEditRMReturn('${r.id}')">✏</button><button class="btn btn-ghost btn-xs tc-tip" data-tip="Void" style="color:var(--re)" onclick="voidRMReturn('${r.id}','${r.lotId}',${fmt(r.weight)},${fmt(r.units)})">🗑</button>`:''}`}</td>
  </tr>`).join('');
}
async function voidRMReturn(id,lotId,weight,units){
  if(!confirm(`Void this RM Return — ${lotId}, ${units}b / ${weight}kg? This gives the material back to RM balance. Cannot be undone.`))return;
  const reason=prompt('Reason for voiding this return (optional but recommended):')||'';
  const pwd=prompt('Enter your password to confirm:');
  if(!pwd){showToast('Void cancelled — password required','err');return;}
  try{
    const {ok,error,networkError}=await apiPost('/api/rm-return/void',{id,reason,password:pwd,username:State.currentUser?.username,changedBy:State.currentUser?.name});
    if(networkError)throw new Error(error);
    if(!ok){showToast(error||'Could not void return','err');return;}
    showToast('RM Return voided ✓ — material returned to balance');renderAll();
  }catch(e){showToast('Network error — not voided: '+e.message,'err');}
}
function openEditRMReturn(id){
  const r=(State.DB.rmReturnLog||[]).find(x=>x.id===id);if(!r)return;
  const newUnits=prompt('Bags returned:',r.units);if(newUnits===null)return;
  const newWeight=prompt('Weight returned (kg):',r.weight);if(newWeight===null)return;
  const newReason=prompt('Reason:',r.reason||'');if(newReason===null)return;
  submitEditRMReturn(id,parseFloat(newUnits)||0,parseFloat(newWeight)||0,newReason);
}
async function submitEditRMReturn(id,units,weight,reason){
  try{
    const {ok,error,networkError}=await apiPost('/api/rm-return/edit',{id,units,weight,reason,changedBy:State.currentUser?.name});
    if(networkError)throw new Error(error);
    if(!ok){showToast(error||'Could not edit return','err');return;}
    showToast('RM Return updated ✓');renderAll();
  }catch(e){showToast('Network error — not saved: '+e.message,'err');}
}

// Replaces old entry-scoped openSoftScrapModal/openMoveToResidualModal.
// Writes to DB.residualLog keyed by {lotId,grade,vendor} — NOT tied to any one
// stageEntries row. getSoftBalanceWeight/getSoftResidualOut (core.js) subtract
// this pool-wide, same pattern already used for getSoftConsumedByDye.
// ══════════════════════════════════════
function openResidualTransferModal(){
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
function onResidualTransferComboChange(){
  const sel=document.getElementById('rt-combo');
  const val=sel?.value;
  const infoEl=document.getElementById('rt-info');
  const wtEl=document.getElementById('rt-weight');
  if(!val){infoEl.innerHTML='';wtEl.max='';return;}
  const[lotId,grade,vendor]=val.split('||');
  const avail=getSoftBalanceWeightAvailable(lotId,grade,vendor);
  const bagsAvail=sel.selectedOptions[0]?.dataset.bags||0;
  infoEl.innerHTML=`Available to transfer: <strong style="color:var(--ye)">${fmt(avail)}kg / ${bagsAvail}b</strong>`;
  wtEl.max=avail;
}
async function submitResidualTransfer(){
  const setAlert=msg=>{document.getElementById('rt-alert').innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;};
  const combo=document.getElementById('rt-combo')?.value;
  const weight=parseFloat(document.getElementById('rt-weight')?.value)||0;
  const type=document.getElementById('rt-type')?.value||'residual';
  const reason=document.getElementById('rt-reason')?.value.trim();
  if(!combo){setAlert('Select a lot + grade + vendor');return;}
  const[lotId,grade,vendor]=combo.split('||');
  if(weight<=0){setAlert('Enter weight to transfer');return;}
  if(!reason){setAlert('Enter reason');return;}
  try{
    const {ok,data,error,networkError}=await apiPost('/api/residual-transfer',{lotId,grade,vendor,weight,type,reason,changedBy:State.currentUser.name});
  if(networkError)throw new Error(error);
  if(!ok){setAlert(error||'Could not process transfer');return;}
    closeModal('residual-transfer-modal-overlay');
    showToast(type==='residual'?`Moved ${fmt(weight)}kg to Residual Stock (${grade}) ✓`:`Scrapped ${fmt(weight)}kg ✓`);
    renderResidualLog();renderAll();
  }catch(e){setAlert('Network error — not saved: '+e.message);}
}

// ══════════════════════════════════════
// RESIDUAL STOCK PAGE
// ══════════════════════════════════════
function getResidualBalance(rsId){
  const rs=(State.DB.residualStock||[]).find(x=>x.id===rsId);
  if(!rs)return 0;
  // Subtract what's been used in dye lots as residual source — excludes Void/Rejected
  // dye lots (Jul 8 2026 fix: was previously counting voided/rejected dye lots as
  // "used", permanently understating balance — matches getDeadStockBalance/getRecycleBalance)
  const used=(State.DB.dyeLots||[]).filter(d=>d.status!=='Rejected'&&d.status!=='Void'&&d.status!=='Voided').reduce((a,d)=>{
    const s=(d.sources||[]).find(s=>s.residualId===rsId);
    return a+(s?.weight||0);
  },0);
  // Jul 15 2026 — matches calcDeadStockBalance/calcRecycleBalance's scrap
  // deduction. Currently unreachable through the UI (no Scrap button is
  // wired to residual stock — openScrapModal is only ever called with
  // 'dead'/'recycle'), but the formula itself had the same gap recycle
  // balance did before today's fix. Closed for consistency across all 3
  // material types, not because it's actively being hit right now.
  const scrapped=(State.DB.scrapLog||[]).filter(s=>s.entryId===rsId&&s.type==='residual').reduce((a,s)=>a+(s.weight||0),0);
  return Math.max(0,(rs.weight||0)-used-scrapped);
}
function renderResidualStock(){
  const el=document.getElementById('rs-tbody');if(!el)return;
  const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';
  const all=State.DB.residualStock||[];
  // Summary
  const sumEl=document.getElementById('rs-summary');
  if(sumEl){
    const totalWt=all.reduce((a,r)=>a+getResidualBalance(r.id),0);
    const grades=new Set(all.filter(r=>getResidualBalance(r.id)>0).map(r=>r.grade));
    sumEl.innerHTML=`<div style="display:flex;gap:14px;flex-wrap:wrap;font-size:0.78rem;margin-bottom:16px;">
      <div style="padding:8px 14px;background:var(--s2);border-radius:8px;border-left:3px solid var(--ye)">
        <div style="font-size:1.1rem;font-weight:800;color:var(--ye)">${fmt(totalWt)}kg</div>
        <div style="color:var(--mu)">Total available</div>
      </div>
      <div style="padding:8px 14px;background:var(--s2);border-radius:8px;border-left:3px solid var(--ac)">
        <div style="font-size:1.1rem;font-weight:800;color:var(--ac)">${grades.size}</div>
        <div style="color:var(--mu)">Active grades</div>
      </div>
    </div>`;
  }
  // Header
  const thead=document.getElementById('rs-thead');
  if(thead)thead.innerHTML=`<tr><th>Grade</th><th>Total Added</th><th>Remaining</th><th>Contributions</th><th>Used In</th><th>Consumed On</th><th>Actions</th></tr>`;
  if(!all.length){el.innerHTML=`<tr><td colspan="5"><div class="empty"><div class="empty-icon">🔄</div><div class="empty-text">No residual stock yet — move soft entry remnants here</div></div></td></tr>`;return;}
  el.innerHTML=all.sort((a,b)=>b.weight-a.weight).map(r=>{
    const bal=getResidualBalance(r.id);
    const contribs=(r.contributions||[]);
    const contribHtml=contribs.map(c=>`<div style="font-size:0.65rem;color:var(--mu);padding:2px 0">→ ${c.lotId||'—'} · ${c.vendor||'—'} · <strong>${fmt(c.weight)}kg</strong> · ${c.movedBy||'—'} · ${c.timestamp?fmtTS(c.timestamp):'—'}</div>`).join('');
    const _rsDyeUses=(State.DB.dyeLots||[]).filter(dl=>(dl.sources||[]).some(s=>s.residualId===r.id));
    const _rsUsedInHTML=_rsDyeUses.length
      ?_rsDyeUses.map(dl=>{
          const src=(dl.sources||[]).find(s=>s.residualId===r.id);
          return`<div><span style="color:var(--ac);cursor:pointer;font-weight:700;font-size:0.72rem" onclick="openDyeLifecycle('${dl.id}')">${dl.dyeLotNo||dl.id}</span> <span style="color:var(--mu);font-size:0.65rem">(${fmt(src?.weight||0)}kg)</span></div>`;
        }).join('')
      :'<span style="color:var(--gr);font-size:0.72rem">→ Ready for Dye</span>';
    const _rsDates=_rsDyeUses.map(dl=>dl.startTime||'').filter(Boolean).sort();
    const _rsConsumedOn=_rsDates.length?`<span style="font-size:0.72rem">${fmtTS(_rsDates[_rsDates.length-1])}</span>`:'<span style="color:var(--mu)">—</span>';
    return`<tr>
      <td><span class="badge b-rm">${r.grade}</span></td>
      <td class="mono">${fmt(r.weight)}kg</td>
      <td class="mono" style="color:${bal>0?'var(--gr)':'var(--mu)'}">
        ${fmt(bal)}kg
      </td>
      <td>
        <details><summary style="cursor:pointer;font-size:0.7rem;color:var(--mu)">${contribs.length} contribution${contribs.length!==1?'s':''}</summary>
        <div style="padding:4px 0">${contribHtml}</div></details>
      </td>
      <td>${_rsUsedInHTML}</td>
      <td>${_rsConsumedOn}</td>
      <td style="white-space:nowrap">
        ${bal>0?`<button class="btn btn-primary btn-xs" onclick="addResidualToNewDye('${r.id}','${r.grade}')">+ Add to Dye</button>`:''}
      </td>
    </tr>`;
  }).join('');
}
function addResidualToNewDye(rsId,grade){
  // Navigate to dye start and pre-fill residual source
  nav('dye',document.getElementById('ni-dye'));
  setTimeout(()=>{openDyeStartModal();setTimeout(()=>{addResidualRow(rsId,grade);},200);},300);
}
function renderResidualLog(){
  const tbody=document.getElementById('rl-tbody');if(!tbody)return;
  const isSup=State.currentUser?.role==='supervisor'||State.currentUser?.role==='admin'||State.currentUser?.role==='manager';
  const logs=(State.DB.residualLog||[]).slice().sort((a,b)=>(b.timestamp||'').localeCompare(a.timestamp||''));
  if(!logs.length){tbody.innerHTML=`<tr><td colspan="10"><div class="empty"><div class="empty-icon">📋</div><div class="empty-text">No residual/scrap transfers yet</div></div></td></tr>`;return;}
  tbody.innerHTML=logs.map(r=>{
    const typeColor=r.type==='residual'?'var(--ye)':'var(--re)';
    const typeLabel=r.type==='residual'?'→ Residual':'🗑 Scrap';
    return`<tr${r.status==='Voided'?' style="opacity:0.5"':''}>
      <td style="font-size:0.72rem;color:var(--mu)">${r.timestamp?fmtTS(r.timestamp):(r.date||'—')}</td>
      <td class="mono" style="color:var(--ac);font-weight:700">${r.lotId||'—'}</td>
      <td><span class="badge b-rm">${r.grade||'—'}</span></td>
      <td style="font-size:0.72rem">${r.vendor||'—'}</td>
      <td class="mono">${fmt(r.weight)}kg</td>
      <td><span style="color:${typeColor};font-size:0.72rem;font-weight:700">${typeLabel}</span></td>
      <td style="font-size:0.72rem;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.reason||''}">${r.reason||'—'}</td>
      <td style="font-size:0.72rem;color:var(--mu)">${r.by||'—'}</td>
      <td>${r.status==='Voided'?'<span class="badge b-void">Voided</span>':'<span style="font-size:0.72rem;font-weight:700;color:var(--gr)">Approved</span>'}</td>
      <td style="white-space:nowrap">${r.status==='Voided'?'—':`${isSup?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Edit" onclick="openEditResidualTransfer('${r.id}')">✏</button><button class="btn btn-ghost btn-xs tc-tip" data-tip="Void" style="color:var(--re)" onclick="voidResidualTransfer('${r.id}')">🗑</button>`:''}`}</td>
    </tr>`;
  }).join('');
}
async function voidResidualTransfer(id){
  const rec=(State.DB.residualLog||[]).find(x=>x.id===id);if(!rec)return;
  if(!confirm(`Void this ${rec.type==='residual'?'Residual':'Scrap'} transfer — ${rec.lotId}, ${fmt(rec.weight)}kg? This cannot be undone.`))return;
  const reason=prompt('Reason for voiding (optional but recommended):')||'';
  const pwd=prompt('Enter your password to confirm:');
  if(!pwd){showToast('Void cancelled — password required','err');return;}
  try{
    const {ok,error,networkError}=await apiPost('/api/residual-transfer/void',{id,reason,password:pwd,username:State.currentUser?.username,changedBy:State.currentUser?.name});
    if(networkError)throw new Error(error);
    if(!ok){showToast(error||'Could not void transfer','err');return;}
    showToast('Transfer voided ✓');renderAll();
  }catch(e){showToast('Network error — not voided: '+e.message,'err');}
}
function openEditResidualTransfer(id){
  const rec=(State.DB.residualLog||[]).find(x=>x.id===id);if(!rec)return;
  const newWeight=prompt('Weight (kg):',rec.weight);if(newWeight===null)return;
  const newReason=prompt('Reason:',rec.reason||'');if(newReason===null)return;
  submitEditResidualTransfer(id,parseFloat(newWeight)||0,newReason);
}
async function submitEditResidualTransfer(id,weight,reason){
  try{
    const {ok,error,networkError}=await apiPost('/api/residual-transfer/edit',{id,weight,reason,changedBy:State.currentUser?.name});
    if(networkError)throw new Error(error);
    if(!ok){showToast(error||'Could not edit transfer','err');return;}
    showToast('Transfer updated ✓');renderAll();
  }catch(e){showToast('Network error — not saved: '+e.message,'err');}
}


function showStockRegTab(tab, el){
  const tabs=['dead','recycle','residual','scraplog'];
  tabs.forEach(t=>{
    const panel=document.getElementById('sr-panel-'+t);
    const btn=document.getElementById('sr-tab-'+t);
    if(panel)panel.style.display=t===tab?'':'none';
    if(btn)btn.classList.toggle('active',t===tab);
  });
  // Update add button
  const addBtn=document.getElementById('sr-add-btn');
  if(addBtn){
    if(tab==='dead')addBtn.innerHTML='<button class="btn btn-primary btn-sm" onclick="openDeadStockModal()">+ Add Dead Stock</button>';
    else addBtn.innerHTML='';
  }
  // Render appropriate content
  if(tab==='dead')renderDeadStock();
  else if(tab==='recycle')renderRecycleStock();
  else if(tab==='residual'){renderResidualStock();renderResidualLog();}
  else if(tab==='scraplog')renderScrapLog();
  window._stockRegTab=tab;
}
function renderScrapLog(){
  const el=document.getElementById('scrap-log-content');
  if(!el)return;
  const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';
  const logs=(State.DB.scrapLog||[]).sort((a,b)=>(b.timestamp||'').localeCompare(a.timestamp||''));
  if(!logs.length){el.innerHTML='<div style="color:var(--mu);font-size:0.78rem;padding:16px;text-align:center">No scrap entries yet</div>';return;}
  el.innerHTML='<div class="tbl"><table><thead><tr><th>ID</th><th>Type</th><th>Source</th><th>Grade</th><th>Weight</th><th>Reason</th><th>By</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead><tbody>'+
  logs.map(s=>`<tr${s.status==='Voided'?' style="opacity:0.5"':''}>
    <td class="mono" style="font-size:0.7rem;color:var(--mu)">${s.id||'—'}</td>
    <td><span class="badge" style="background:${s.type==='soft'?'rgba(239,68,68,0.15)':'rgba(250,204,21,0.15)'};color:${s.type==='soft'?'var(--re)':'var(--ye)'}">${s.type||'—'}</span></td>
    <td class="mono" style="font-size:0.72rem">${s.entryId||s.rsId||'—'}</td>
    <td>${s.grade||'—'}</td>
    <td class="mono" style="color:var(--re)">${fmt(s.weight||0)}kg</td>
    <td style="font-size:0.72rem;color:var(--mu)">${s.reason||'—'}</td>
    <td style="font-size:0.72rem">${s.scrappedBy||'—'}</td>
    <td style="font-size:0.72rem;color:var(--mu)">${s.date||'—'}</td>
    <td>${s.status==='Voided'?'<span class="badge b-void">Voided</span>':'<span style="font-size:0.72rem;font-weight:700;color:var(--gr)">Approved</span>'}</td>
    <td>${s.status==='Voided'||!isAdmin?'':`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Void" style="color:var(--re)" onclick="voidScrap('${s.id}')">🗑</button>`}</td>
  </tr>`).join('')+'</tbody></table></div>';
}
async function voidScrap(id){
  const rec=(State.DB.scrapLog||[]).find(x=>x.id===id);if(!rec)return;
  if(!confirm(`Void this Scrap entry — ${rec.grade||''}, ${fmt(rec.weight)}kg? This gives the weight back to the source and cannot be undone.`))return;
  const reason=prompt('Reason for voiding (optional but recommended):')||'';
  try{
    const {ok,error,networkError}=await apiPost('/api/scrap/void',{id,reason,changedBy:State.currentUser?.name});
    if(networkError)throw new Error(error);
    if(!ok){showToast(error||'Could not void scrap entry','err');return;}
    showToast('Scrap entry voided ✓');renderAll();
  }catch(e){showToast('Network error — not voided: '+e.message,'err');}
}
async function voidDeadStock(id){
  const rec=(State.DB.deadStock||[]).find(x=>x.id===id);if(!rec)return;
  if(!confirm(`Void this Dead Stock entry — ${rec.type}, ${rec.grade}, ${fmt(rec.weight)}kg? This cannot be undone.`))return;
  const reason=prompt('Reason for voiding (optional but recommended):')||'';
  const pwd=prompt('Enter your password to confirm:');
  if(!pwd){showToast('Void cancelled — password required','err');return;}
  try{
    const {ok,error,networkError}=await apiPost('/api/dead-stock/void',{id,reason,password:pwd,username:State.currentUser?.username,changedBy:State.currentUser?.name});
    if(networkError)throw new Error(error);
    if(!ok){showToast(error||'Could not void entry','err');return;}
    showToast('Dead stock entry voided ✓');renderAll();
  }catch(e){showToast('Network error — not voided: '+e.message,'err');}
}
function openEditDeadStock(id){
  const rec=(State.DB.deadStock||[]).find(x=>x.id===id);if(!rec)return;
  const newWeight=prompt('Weight (kg):',rec.weight);if(newWeight===null)return;
  const newNote=prompt('Note:',rec.note||'');if(newNote===null)return;
  submitEditDeadStock(id,rec.type,rec.grade,parseFloat(newWeight)||0,newNote);
}
async function submitEditDeadStock(id,type,grade,weight,note){
  try{
    const {ok,error,networkError}=await apiPost('/api/dead-stock/edit',{id,type,grade,weight,note,changedBy:State.currentUser?.name});
    if(networkError)throw new Error(error);
    if(!ok){showToast(error||'Could not edit entry','err');return;}
    showToast('Dead stock entry updated ✓');renderAll();
  }catch(e){showToast('Network error — not saved: '+e.message,'err');}
}
function renderDeadStock(){

  const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';
  const isSup=State.currentUser?.role==='supervisor'||isAdmin;
  const sumEl=document.getElementById('ds-summary');
  if(sumEl){
    const total=(State.DB.deadStock||[]).length;
    const availWt=(State.DB.deadStock||[]).filter(d=>d.status==='Approved').reduce((a,d)=>a+getDeadStockBalance(d.id),0);
    const consumed=(State.DB.deadStock||[]).filter(d=>getDeadStockBalance(d.id)<=0&&d.status==='Approved').length;
    sumEl.innerHTML=`<div style="display:flex;gap:14px;flex-wrap:wrap;font-size:0.78rem;">
      <div style="padding:8px 14px;background:var(--s2);border-radius:8px;border-left:3px solid var(--ac)"><div style="font-size:1.1rem;font-weight:800;color:var(--ac)">${total}</div><div style="color:var(--mu)">Total entries</div></div>
      <div style="padding:8px 14px;background:var(--s2);border-radius:8px;border-left:3px solid var(--gr)"><div style="font-size:1.1rem;font-weight:800;color:var(--gr)">${fmt(availWt)}kg</div><div style="color:var(--mu)">Available</div></div>
      <div style="padding:8px 14px;background:var(--s2);border-radius:8px;border-left:3px solid var(--mu)"><div style="font-size:1.1rem;font-weight:800;color:var(--mu)">${consumed}</div><div style="color:var(--mu)">Fully consumed</div></div>
    </div>`;
    const steelEl=document.getElementById('ds-steel-summary');
    const plasticEl=document.getElementById('ds-plastic-summary');
    const byGrade=(type)=>{
      const entries=(State.DB.deadStock||[]).filter(d=>d.type===type);
      const grades={};
      entries.forEach(d=>{const bal=getDeadStockBalance(d.id);if(bal>0){grades[d.grade]=(grades[d.grade]||0)+bal;}});
      const keys=Object.keys(grades);
      if(!keys.length)return'<div style="color:var(--mu);font-size:0.75rem;padding:8px 0">None available</div>';
      return keys.sort().map(g=>`<div style="display:flex;justify-content:space-between;padding:5px 0;font-size:0.78rem;border-bottom:1px solid var(--b1)"><span class="badge b-rm">${g}</span><span class="mono" style="color:var(--gr)">${fmt(grades[g])}kg</span></div>`).join('');
    };
    if(steelEl)steelEl.innerHTML=byGrade('Steel');
    if(plasticEl)plasticEl.innerHTML=byGrade('Plastic');
  }
  const tbody=document.getElementById('ds-tbody');if(!tbody)return;
  const _ft=document.getElementById('dsf-type')?.value||'';
  const _fg=document.getElementById('dsf-grade')?.value||'';
  const allDS=State.DB.deadStock||[];
  const dsTypes=[...new Set(allDS.filter(d=>(!_fg||(d.grade||'')===_fg)).map(d=>d.type).filter(Boolean))].sort();
  const dsGrades=[...new Set(allDS.filter(d=>(!_ft||d.type===_ft)).map(d=>d.grade).filter(Boolean))].sort();
  const ds_thead=document.getElementById('ds-thead');
  if(ds_thead){ds_thead.innerHTML=`
    <tr class="tbl-filter-row">
      <th></th>
      <th>${buildColFilter(dsTypes,'dsf-type','Type')}</th>
      <th>${buildColFilter(dsGrades,'dsf-grade','Grade')}</th>
      <th></th><th></th><th></th><th></th><th></th>
    </tr>
    <tr>
      <th>ID</th><th>Type</th><th>Grade</th>
      <th>Weight (kg)</th><th>Remaining</th>
      <th>Used In</th><th>Consumed On</th><th>Date Added</th><th>Actions</th>
    </tr>`;
    if(_ft)document.getElementById('dsf-type').value=_ft;
    if(_fg)document.getElementById('dsf-grade').value=_fg;
  }
  const entries=allDS.filter(d=>(!_ft||d.type===_ft)&&(!_fg||(d.grade||'')===_fg))
    .sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
  if(!entries.length){tbody.innerHTML=`<tr><td colspan="8"><div class="empty"><div class="empty-icon">📦</div><div class="empty-text">✕ No dead stock entries yet</div></div></td></tr>`;return;}
  const isSteel=d=>d.type==='Steel';
  tbody.innerHTML=entries.map(d=>{
    const bal=getDeadStockBalance(d.id);
    const consumed=bal<=0;
    let usedInHTML='<span style="color:var(--mu)">—</span>';
    let consumedOnHTML='<span style="color:var(--mu)">—</span>';
    if(isSteel(d)){
      const dyeUses=(State.DB.dyeLots||[]).filter(dl=>(dl.sources||[]).some(s=>s.deadStockId===d.id));
      if(dyeUses.length){
        usedInHTML=dyeUses.map(dl=>{
          const src=(dl.sources||[]).find(s=>s.deadStockId===d.id);
          return`<div><span style="color:var(--ac);cursor:pointer;font-weight:700;font-size:0.72rem" onclick="openDyeLifecycle('${dl.id}')">${dl.dyeLotNo||dl.id}</span> <span style="color:var(--mu);font-size:0.65rem">(${fmt(src?.weight||0)}kg)</span></div>`;
        }).join('');
        const dates=dyeUses.map(dl=>dl.startTime||'').filter(Boolean).sort();
        if(dates.length)consumedOnHTML=`<span style="font-size:0.72rem">${fmtTS(dates[dates.length-1])}</span>`;
      }else{usedInHTML='<span style="color:var(--gr);font-size:0.72rem">→ Ready for Dye</span>';}
    }else{
      const softUses=(State.DB.stageEntries||[]).filter(e=>e.deadStockId===d.id&&e.stage==='Soft'&&e.status!=='Void');
      if(softUses.length){
        usedInHTML=softUses.map(e=>`<div><span style="color:var(--ac);cursor:pointer;font-weight:700;font-size:0.72rem" onclick="openRMLifecycle('${e.lotId}')">${e.lotId}</span> <span style="color:var(--mu);font-size:0.65rem">(${e.status})</span></div>`).join('');
        const dates=softUses.map(e=>e.startTime||'').filter(Boolean).sort();
        if(dates.length)consumedOnHTML=`<span style="font-size:0.72rem">${fmtTS(dates[dates.length-1])}</span>`;
      }else{usedInHTML='<span style="color:var(--gr);font-size:0.72rem">→ Ready for Soft</span>';}
    }
    return`<tr style="${consumed||d.status==='Voided'?'opacity:0.5':''}">
      <td class="mono" style="color:var(--mu);font-size:0.72rem">${d.id}</td>
      <td><span class="badge" style="background:${isSteel(d)?'rgba(100,150,255,0.15)':'rgba(255,165,0,0.15)'};color:${isSteel(d)?'var(--ac)':'var(--ye)'}">${d.type}</span></td>
      <td><span class="badge b-rm">${d.grade}</span></td>
      <td class="mono">${fmt(d.weight)}kg</td>
      <td class="mono" style="color:${bal>0?'var(--tx)':'var(--mu)'}">
        ${d.status==='Voided'?'<span class="badge b-void">Voided</span>':fmt(bal)+'kg'}
      </td>
      <td>${usedInHTML}</td>
      <td>${consumedOnHTML}</td>
      <td style="font-size:0.72rem;color:var(--mu)">${fmtDate(d.date)}<br>
        <span style="font-size:0.65rem">${d.addedBy||'—'}</span>
      </td>
      <td style="white-space:nowrap">
        ${d.status==='Voided'?'':`${isAdmin&&bal>0?`<button class="btn btn-danger btn-xs" onclick="openScrapModal('${d.id}','dead')">Scrap</button>`:''}
        ${isSup?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Edit" onclick="openEditDeadStock('${d.id}')">✏</button><button class="btn btn-ghost btn-xs tc-tip" data-tip="Void" style="color:var(--re)" onclick="voidDeadStock('${d.id}')">🗑</button>`:''}
        ${!isAdmin&&!isSup?'':bal<=0?'<span style="font-size:0.68rem;color:var(--mu)">Consumed</span>':''}`}
      </td>
    </tr>`;
  }).join('');
}

function renderDyeLifecycle(){
  const dyeLotId=document.getElementById('dye-lifecycle-select')?.value;
  if(dyeLotId){
    _hydrateDyeLot(dyeLotId,()=>{_renderDyeLifecycleCore();});
  }else{
    _renderDyeLifecycleCore();
  }
}
function _renderDyeLifecycleCore(){const dyeLotId=document.getElementById('dye-lifecycle-select')?.value;const content=document.getElementById('dye-lifecycle-content');if(!dyeLotId||!content){if(content)content.innerHTML='';return;}
const lot=(State.DB.dyeLots||[]).find(d=>d.id===dyeLotId);if(!lot){content.innerHTML='<div class="alert-err">Dye lot not found</div>';return;}
const dyeBal=getDyeBal(dyeLotId);const windBal=getWindBal(dyeLotId);const packBal=getPackBal(dyeLotId);const packed=getTotalPacked(dyeLotId);const disp=getTotalDispatched(dyeLotId);const qc=(c,kg)=>`<strong style="font-size:0.88rem;color:var(--tx)">${c||0}c</strong><span style="color:var(--mu);font-size:0.75rem"> / ${fmt(kg)}kg</span>`;const qb=(b,kg)=>`<strong style="font-size:0.88rem;color:var(--tx)">${b||0}b</strong><span style="color:var(--mu);font-size:0.75rem"> / ${fmt(kg)}kg</span>`;const qkg=(kg,col)=>`<strong style="font-size:0.85rem;color:${col||'var(--tx)'};">${fmt(Math.abs(kg))}kg</strong>`;const row=(label,val,col)=>`
    <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--b1);"><span style="font-size:0.72rem;color:var(--mu);text-transform:uppercase;letter-spacing:0.05em;">${label}</span><span class="mono" style="color:${col||'var(--tx)'};">${val}</span></div>`;const wgRow=(diff)=>{if(Math.abs(diff)<0.01)return row('Waste / Gain','<span style="color:var(--mu)">0kg</span>');const col=diff>0?'var(--gr)':'var(--re)';const sign=diff>0?'+':'-';return row('Waste / Gain',`<strong style="font-size:0.85rem;color:${col}">${sign}${fmt(Math.abs(diff))}kg</strong>`);};const windEntries=(State.DB.windEntries||[]).filter(e=>e.dyeLotId===dyeLotId);const packEntries=(State.DB.packEntries||[]).filter(e=>e.dyeLotId===dyeLotId);const dispatches=(State.DB.dispatches||[]).filter(d=>d.dyeLotId===dyeLotId);const dyeWaste=(lot.outWeight||0)-(lot.totalInWeight||0);const _apprW=e=>e.status==='Approved'||e.status==='Edited-Approved';const windTotalInC=windEntries.filter(_apprW).reduce((a,e)=>a+(e.inCones||0),0);const windTotalInKg=windEntries.filter(_apprW).reduce((a,e)=>a+(e.inWeight||0),0);const windTotalOutC=windEntries.filter(_apprW).reduce((a,e)=>a+(e.outCones||0),0);const windTotalOutKg=windEntries.filter(_apprW).reduce((a,e)=>a+(e.outWeight||0),0);const packTotalIn=packEntries.filter(_apprW).reduce((a,e)=>a+(e.inWeight||0),0);const packTotalOut=packEntries.filter(_apprW).reduce((a,e)=>a+(e.weight||0),0);const windTotalOut=windTotalOutKg;const packBase=packTotalIn>0?packTotalIn:windTotalOut;const packDiff=packTotalOut-packBase;content.innerHTML=`
    
    <div class="card gap-b"><div style="display:flex;justify-content:space-between;align-items:center;"><div><div style="font-size:1.1rem;font-weight:800;color:var(--ac)">${lot.dyeLotNo}</div><div style="font-size:0.82rem;color:var(--mu)">${lot.shade} · ${(lot.sources||[]).map(s=>s.grade).filter((v,i,a)=>a.indexOf(v)===i).join(' + ')}</div></div></div></div><div class="card gap-b"><div class="card-title">📥 Source Lots</div>
      ${(lot.sources||[]).map(s=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--b1);"><span style="font-size:0.78rem;">Lot<strong>${s.lotId}</strong><span style="color:var(--mu)">${s.grade||''}· ${s.vendor||''}</span></span><span class="mono">${qc(s.cones||s.units||0,s.weight||0)}</span></div>`).join('')}
      ${row('Total Input', qc(lot.totalInCones||0, lot.totalInWeight||0))}
    </div><div class="card gap-b"><div class="card-title">🎨 Dye Output</div>
      ${row('In', qc(lot.totalInCones||0, lot.totalInWeight||0))}
      ${row('Out', qc(lot.outCones||0, lot.outWeight||0), 'var(--ac)')}
      ${wgRow(dyeWaste)}
      ${row('Balance', qc(dyeBal.units||0, dyeBal.weight||0), 'var(--ye)')}
      <div style="font-size:0.7rem;color:var(--mu);margin-top:6px;">By ${lot.endWorker||'—'} on ${fmtTS(lot.endTime)}</div></div><div class="card gap-b"><div class="card-title">🌀 Wind Entries</div>
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
function renderDyeLifecycleSelect(){_loadCatalog('dyeLots',()=>{const sel=document.getElementById('dye-lifecycle-select');if(!sel)return;const shadeSel=document.getElementById('dlc-shade-select');if(shadeSel){const curShade=shadeSel.value;const allLots=_dyeLotsForDropdown();const shades=[...new Set(allLots.map(d=>d.shade).filter(Boolean))].sort();shadeSel.innerHTML='<option value="">All Shades</option>'+shades.map(s=>{const cnt=allLots.filter(d=>d.shade===s).length;return`<option value="${s}" ${s===curShade?'selected':''}>${s} (${cnt} lot${cnt>1?'s':''})</option>`;}).join('');}
const shade=shadeSel?.value||'';const lots=_dyeLotsForDropdown().filter(d=>d.status!=='InProgress'&&(!shade||(d.shade||'').toLowerCase()===shade.toLowerCase())).sort((a,b)=>(a.dyeLotNo||'').localeCompare(b.dyeLotNo||''));const prev=sel.value;sel.innerHTML='<option value="">Select Dye Lot...</option>'+lots.map(d=>`<option value="${d.id}">${d.dyeLotNo} — ${d.shade}</option>`).join('');if(prev)sel.value=prev;const dlcClearBtn=document.getElementById('dlc-clear-btn');if(dlcClearBtn)dlcClearBtn.style.display=(shadeSel?.value||sel?.value)?'':'none';});}
function renderDyeStock(){const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';const isSup=State.currentUser?.role==='supervisor'||isAdmin;const fl=document.getElementById('st-dsf-l')?.value||'';const fs=document.getElementById('st-dsf-shade')?.value||'';const fst=document.getElementById('st-dsf-status')?.value||'';const dyeLots=(State.DB.dyeLots||[]).filter(d=>d.status==='Approved'||d.status==='Edited-Approved');const fsl=document.getElementById('st-dsf-sl')?.value||'';const fsv_ds=document.getElementById('st-dsf-sv')?.value||'';const fp_dye=document.getElementById('st-dsf-pending')?.value||'';const lotNos=[...new Set(dyeLots.filter(d=>(!fs||(d.shade||'')===fs)&&(!fst||getDyeLotCurrentStage(d.id)===fst)).map(d=>d.dyeLotNo).filter(Boolean))].sort((a,b)=>b.localeCompare(a));const shades=[...new Set(dyeLots.filter(d=>(!fl||(d.dyeLotNo||'')===fl)&&(!fst||getDyeLotCurrentStage(d.id)===fst)).map(d=>d.shade).filter(Boolean))].sort();const statuses=[...new Set(dyeLots.filter(d=>(!fl||(d.dyeLotNo||'')===fl)&&(!fs||(d.shade||'')===fs)).map(d=>getDyeLotCurrentStage(d.id)).filter(Boolean))].sort();const sourceLots=[...new Set(dyeLots.flatMap(d=>(d.sources||[]).map(s=>s.lotId).filter(Boolean)))].sort();const sourceVendors=[...new Set(dyeLots.flatMap(d=>(d.sources||[]).map(s=>s.vendor).filter(Boolean)))].sort();const fsv=document.getElementById('st-dsf-sv')?.value||'';const _stTh=document.getElementById('st-dye-thead');if(_stTh){_stTh.innerHTML=`
      <tr class="tbl-filter-row"><th>${buildColFilter(lotNos,'st-dsf-l','Lot')}</th><th>${buildColFilter(shades,'st-dsf-shade','Shade')}</th><th>${buildColFilter(sourceLots,'st-dsf-sl','RM Lot')}</th><th>${buildColFilter(sourceVendors,'st-dsf-sv','Vendor')}</th><th></th><th><select class="col-filter" id="st-dsf-pending" onchange="renderDyeStock();_showFilterClearBtn('st-dsf-pending')" style="min-width:90px"><option value="">Pending At</option><option value="dye">Dye</option><option value="wind">Wind</option><option value="pack">Pack</option></select></th><th></th><th></th><th></th><th></th><th></th><th></th><th></th><th></th><th>${buildColFilter(statuses,'st-dsf-status','Stage')}</th><th></th><th></th><th></th><th></th></tr><tr>
        ${sortTh('dyestock','dyeLotNo','Dye Lot')}
        ${sortTh('dyestock','shade','Shade')}
        <th>RM Lot</th><th>Vendor</th><th>Grade</th>
        ${sortTh('dyestock','totalInWeight','In Weight')}
        <th style="text-align:right">Dye Bal</th><th style="text-align:right">Dye Waste</th><th style="text-align:right">Wind Bal</th><th style="text-align:right">Wind Waste</th><th style="text-align:right">Pack Bal</th>
        ${sortTh('dyestock','packGainKg','Gain/Loss (kg)')}
        <th style="text-align:right">Gain/Loss (%)</th><th style="text-align:right">Dispatch Bal</th>
        ${sortTh('dyestock','stage','Stage')}
        ${sortTh('dyestock','daysAtDye','Days@Dye')}
        ${sortTh('dyestock','daysAtWind','Days@Wind')}
        ${sortTh('dyestock','daysAtPack','Days@Pack')}
        <th></th></tr>`;if(fl)document.getElementById('st-dsf-l').value=fl;if(fs)document.getElementById('st-dsf-shade').value=fs;if(fst)document.getElementById('st-dsf-status').value=fst;if(fsl)document.getElementById('st-dsf-sl').value=fsl;if(fsv)document.getElementById('st-dsf-sv').value=fsv;const _dp=document.getElementById('st-dsf-pending');if(_dp)_dp.value=fp_dye;_restoreFilterBtns('st-dsf-l','st-dsf-shade','st-dsf-sl','st-dsf-sv','st-dsf-status');}
const today=new Date();let _dsLots=dyeLots.filter(d=>{if(fl&&(d.dyeLotNo||'')!==fl)return false;if(fs&&(d.shade||'')!==fs)return false;if(fst&&getDyeLotCurrentStage(d.id)!==fst)return false;if(fsl&&!(d.sources||[]).some(s=>s.lotId===fsl))return false;if(fsv_ds&&!(d.sources||[]).some(s=>s.vendor===fsv_ds))return false;if(fp_dye==='dye'){const b=getDyeBal(d.id);if(!b||(b.units<=0&&b.weight<=0))return false;}
else if(fp_dye==='wind'){const b=getWindBal(d.id);if(!b||(b.units<=0&&b.weight<=0))return false;}
else if(fp_dye==='pack'){const b=getPackBal(d.id);if(!b||(b.bags<=0&&b.weight<=0))return false;}
return true;});_dsLots=_dsLots.map(d=>{const _stage=getDyeLotCurrentStage(d.id);const _packGainKg=(State.DB.packEntries||[]).filter(e=>e.dyeLotId===d.id&&e.status!=='Void'&&e.status!=='Voided').reduce((a,e)=>a+(e.gainKg||0),0);const _today2=new Date();const _dyeAppr=d.approvedAt?new Date(d.approvedAt):null;const _firstWind=(State.DB.windEntries||[]).filter(e=>e.dyeLotId===d.id&&e.status!=='Void').sort((a,b)=>(a.startTime||'').localeCompare(b.startTime||''))[0];const _firstPack=(State.DB.packEntries||[]).filter(e=>e.dyeLotId===d.id&&e.status!=='Void').sort((a,b)=>(a.timestamp||'').localeCompare(b.timestamp||''))[0];const _dyeBal=getDyeBal(d.id);const _windBal=getWindBal(d.id);const _packBal=getPackBal(d.id);const daysAtDye=_dyeAppr&&_firstWind?Math.floor((new Date(_firstWind.startTime)-_dyeAppr)/86400000):_dyeAppr&&_dyeBal.weight>0?Math.floor((_today2-_dyeAppr)/86400000):null;const daysAtWind=_firstWind&&_firstPack?Math.floor((new Date(_firstPack.timestamp)-new Date(_firstWind.startTime))/86400000):_firstWind&&_windBal.weight>0?Math.floor((_today2-new Date(_firstWind.startTime))/86400000):null;const daysAtPack=_firstPack&&_packBal.bags>0?Math.floor((_today2-new Date(_firstPack.timestamp))/86400000):null;return{...d,stage:_stage,packGainKg:_packGainKg,daysAtDye:daysAtDye??999,daysAtWind:daysAtWind??999,daysAtPack:daysAtPack??999};});let lots=_sortState.dyestock?.col?sortArr(_dsLots,_sortState.dyestock.col,_sortState.dyestock.dir):_dsLots.sort((a,b)=>(b.startTime||'').localeCompare(a.startTime||''));const tbody=document.getElementById('st-dye-tbody');if(!tbody)return;if(!lots.length){tbody.innerHTML='<tr><td colspan="15"><div class="empty"><div class="empty-icon">&#x1F3A8;</div><div class="empty-text">✕ No dye lots yet — create one from the Dye page</div></div></td></tr>';return;}
tbody.innerHTML=lots.map(d=>{const totalInCones=d.totalInCones||0;const totalInKg=d.totalInWeight||0;const totalOutCones=d.outCones||0;const totalOutKg=d.outWeight||0;
const dyeWasteC=d.coneLoss||0;const dyeWasteKg=d.kgLoss||0;const _windAppr=(State.DB.windEntries||[]).filter(e=>e.dyeLotId===d.id&&e.status!=='Rejected'&&e.status!=='Void'&&e.status!=='Voided'&&e.endTime);const _dls=_getDyeLotSummary(d.id);
const windWasteC=_dls?.windWaste?.cones??_windAppr.reduce((a,e)=>a+(e.wasteCones||0),0);const windWasteKg=_dls?.windWaste?.kg??parseFloat(_windAppr.reduce((a,e)=>a+(e.wasteWeight||0),0).toFixed(2));const packGainKg=_dls?.packGain?.kg??parseFloat((State.DB.packEntries||[]).filter(e=>e.dyeLotId===d.id&&e.status!=='Rejected'&&e.status!=='Void'&&e.status!=='Voided').reduce((a,e)=>a+(e.gainKg||0),0).toFixed(2));const dyeBal=getDyeBal(d.id);const windBal=getWindBal(d.id);const packBal=getPackBal(d.id);
const _dispLive=getTotalDispatched(d.id);
const _packTotalKg=(State.DB.packEntries||[]).filter(e=>e.dyeLotId===d.id&&e.status!=='Void'&&e.status!=='Voided').reduce((a,e)=>a+(e.weight||0),0);
const _packTotalBags=(State.DB.packEntries||[]).filter(e=>e.dyeLotId===d.id&&e.status!=='Void'&&e.status!=='Voided').reduce((a,e)=>a+(e.bags||0),0);
const disp={bags:Math.max(_dispLive.bags,Math.max(0,_packTotalBags-packBal.bags)),weight:Math.max(_dispLive.weight,Math.max(0,_packTotalKg-packBal.weight))};const grade=(d.sources||[]).map(s=>s.grade).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join('+');const dyeApproved=d.approvedAt?new Date(d.approvedAt):null;const _fwRaw=(State.DB.windEntries||[]).filter(e=>e.dyeLotId===d.id&&e.status!=='Void').sort((a,b)=>(a.startTime||'').localeCompare(b.startTime||''))[0];
const firstWind=_dls?.firstWindTime?{startTime:_dls.firstWindTime}:_fwRaw;const _fpRaw=(State.DB.packEntries||[]).filter(e=>e.dyeLotId===d.id&&e.status!=='Void').sort((a,b)=>(a.timestamp||'').localeCompare(b.timestamp||''))[0];
const firstPack=_dls?.firstPackTime?{timestamp:_dls.firstPackTime}:_fpRaw;const daysAtDye=dyeApproved&&firstWind?Math.floor((new Date(firstWind.startTime)-dyeApproved)/86400000):dyeApproved&&dyeBal.weight>0?Math.floor((today-dyeApproved)/86400000):null;const daysAtWind=firstWind&&firstPack?Math.floor((new Date(firstPack.timestamp)-new Date(firstWind.startTime))/86400000):firstWind&&windBal.weight>0?Math.floor((today-new Date(firstWind.startTime))/86400000):null;const daysAtPack=firstPack&&packBal.bags>0?Math.floor((today-new Date(firstPack.timestamp))/86400000):null;const stage=getDyeLotCurrentStage(d.id);const stC={'At Dye':'var(--cd)','At Wind':'var(--cw)','At Pack':'var(--cp)','Completed':'var(--gr)'}[stage]||'var(--mu)';const isComplete=stage==='Completed';
return`<tr style="${isComplete?'opacity:0.7':''}"><td class="mono" style="color:var(--ac);font-weight:700;cursor:pointer;vertical-align:top" onclick="openDyeLifecycle('${d.id}')">${d.dyeLotNo}</td><td style="font-size:0.78rem;font-weight:700;vertical-align:top">${d.shade||'—'}</td>${(()=>{const _s=d.sources||[];const _s0=_s[0]||{};const _rowId2='ds-'+d.id;const _l0=_s0.recycleId?'♻'+(_s0.dyeLotNo||'RC'):_s0.deadStockId?'DS'+(_s0.lotId||'—'):(_s0.lotId||'—');const _v0=_s0.recycleId?'Recycle':_s0.deadStockId?'Dead Stock':(_s0.vendor||'—');const _g0=_s0.grade||'—';const _m=_s.length>1;return '<td style="vertical-align:top;font-size:0.78rem;color:var(--ac)">'+_l0+(_m?' <span onclick="toggleSourceRows(this,\''+_rowId2+'\')" data-exp="0" style="border:1px solid rgba(240,165,0,0.3);border-radius:10px;padding:2px 8px;font-size:0.65rem;font-weight:700;display:inline-flex;align-items:center;gap:4px;cursor:pointer;color:var(--ac)">📦 '+(_s.length-1)+' more ▼</span>':'')+'</td>'+'<td style="vertical-align:top;font-size:0.78rem">'+_v0+'</td>'+'<td style="vertical-align:top">'+(_g0!=='—'?'<span class="badge b-rm">'+_g0+'</span>':'—')+'</td>';})()}<td class="mono" style="vertical-align:top;text-align:right">${fmt(totalInKg)}kg</td><td class="mono" style="vertical-align:top;text-align:right;color:${(dyeBal.units>0||dyeBal.weight>0)?'var(--cd)':'var(--mu)'}"> ${(()=>{if(!(dyeBal.units>0||dyeBal.weight>0))return'<span style="color:var(--mu)">—</span>';   const _dyeAvail=getDyeBalAvailable(d.id);   const _hasWip=Math.abs(_dyeAvail.weight-dyeBal.weight)>0.01;   return'<span>'+dyeBal.units+'c / '+fmt(dyeBal.weight)+'kg</span>'   +(_hasWip?'<div style="font-size:0.62rem;color:var(--ye)">Avail: '+_dyeAvail.units+'c / '+fmt(_dyeAvail.weight)+'kg</div>':''); })()}</td><td class="mono" style="vertical-align:top;text-align:right;color:${(dyeWasteC>0||dyeWasteKg>0)?'var(--re)':'var(--mu)'}"> ${dyeWasteC>0?'<span>-'+dyeWasteC+'c / -'+fmt(dyeWasteKg)+'kg</span>':'<span style="color:var(--mu)">—</span>'}</td><td class="mono" style="vertical-align:top;text-align:right;color:${(windBal.units>0||windBal.weight>0)?'var(--cw)':'var(--mu)'}"> ${(()=>{if(!(windBal.units>0||windBal.weight>0))return'<span style="color:var(--mu)">—</span>';   const _windAvail=getWindBalAvailable(d.id);   const _hasWip=Math.abs(_windAvail.weight-windBal.weight)>0.01;   return'<span>'+windBal.units+'c / '+fmt(windBal.weight)+'kg</span>'   +(_hasWip?'<div style="font-size:0.62rem;color:var(--ye)">Avail: '+_windAvail.units+'c / '+fmt(_windAvail.weight)+'kg</div>':''); })()}</td><td class="mono" style="vertical-align:top;text-align:right;color:${(windWasteC>0||windWasteKg>0)?'var(--re)':'var(--mu)'}"> ${(windWasteC>0||windWasteKg>0)?('<span>-'+windWasteC+'c / -'+fmt(windWasteKg)+'kg</span>'):'<span style="color:var(--mu)">—</span>'}</td><td class="mono" style="vertical-align:top;text-align:right;color:${packBal.bags>0?'var(--cp)':'var(--mu)'}"> ${(()=>{if(!packBal.bags>0)return'<span style="color:var(--mu)">—</span>';   const _packAvail=getPackBalAvailable(d.id);   const _hasWip=Math.abs(_packAvail.weight-packBal.weight)>0.01;   return'<span>'+packBal.bags+'b / '+fmt(packBal.weight)+'kg</span>'   +(_hasWip?'<div style="font-size:0.62rem;color:var(--ye)">Avail: '+_packAvail.units+'b / '+fmt(_packAvail.weight)+'kg</div>':''); })()}</td><td class="mono" style="vertical-align:top;color:${packGainKg>0.01?'var(--gr)':packGainKg<-0.01?'var(--re)':'var(--mu)'};text-align:right"> ${packGainKg>0.01?'+'+fmt(packGainKg)+'kg':packGainKg<-0.01?fmt(packGainKg)+'kg':'—'}</td><td class="mono" style="vertical-align:top;color:${packGainKg>0.01?'var(--gr)':packGainKg<-0.01?'var(--re)':'var(--mu)'};text-align:right">${(()=>{const _packInKg=(State.DB.packEntries||[]).filter(e=>e.dyeLotId===d.id&&e.status!=='Void'&&e.status!=='Voided').reduce((a,e)=>a+(e.inWeight||0),0);const base=_packInKg>0?parseFloat(((packGainKg/_packInKg)*100).toFixed(1)):null;return base!==null?(base>0?'+':'')+base+'%':'—';})()}</td><td class="mono" style="vertical-align:top;color:${disp.bags>0?'var(--gr)':'var(--mu)'};text-align:right"> ${disp.bags>0?fmtQty(disp.bags,disp.weight,'b'):'—'}</td><td style="vertical-align:top"><span style="font-size:0.72rem;font-weight:700;color:${stC}">${stage}</span> ${!d.splitDone&&(d.status==='Approved'||d.status==='Edited-Approved')&&isSup?`<button class="btn btn-warning btn-xs"style="margin-top:3px;display:block"onclick="openDyeSplitModal('${d.id}')">⚠ Split</button>`:''} ${d.splitDone?'<div style="font-size:0.6rem;color:var(--ye);margin-top:2px">Split✓</div>':''}</td><td style="vertical-align:top">${daysAtDye!==null?agingBadge(daysAtDye):'<span style="color:var(--mu)">—</span>'}</td><td style="vertical-align:top">${daysAtWind!==null?agingBadge(daysAtWind):'<span style="color:var(--mu)">—</span>'}</td><td style="vertical-align:top">${daysAtPack!==null?agingBadge(daysAtPack):'<span style="color:var(--mu)">—</span>'}</td><td style="vertical-align:top;white-space:nowrap"> ${(d.status==='Pending'||d.status==='Edited-Pending')&&isSup?`<button class="btn btn-success btn-xs"onclick="approveDyeLot('${d.id}')">✓</button><button class="btn btn-danger btn-xs"onclick="rejectDyeLot('${d.id}')">✗</button>`:''}  ${(d.status==='Approved'||d.status==='Edited-Approved')&&isAdmin?`<button class="btn btn-ghost btn-xs"onclick="openEditEntryModal('${d.id}','dye')">✏</button><button class="btn btn-ghost btn-xs"style="color:var(--re)"onclick="openVoidModal('${d.id}','dye')">🗑</button>`:''} ${(d.status==='Rejected'||d.status==='Voided')&&isAdmin?`<button class="btn btn-ghost btn-xs"onclick="openOverride('${d.id}','dye')">⚡</button><button class="btn btn-ghost btn-xs"style="color:var(--re)"onclick="openVoidModal('${d.id}','dye')">🗑</button>`:''} ${isSup||isAdmin?`<button class="btn btn-ghost btn-xs"onclick="openDyeLifecycle('${d.id}')">🔍</button>`:''}</td></tr>`+(((d.sources||[]).length>1)?(d.sources||[]).slice(1).map(s=>{const _rl=s.recycleId?'♻'+(s.dyeLotNo||'RC'):s.deadStockId?'DS'+(s.lotId||'—'):(s.lotId||'—');const _rv=s.recycleId?'Recycle':s.deadStockId?'Dead Stock':(s.vendor||'—');const _rg=s.grade||'—';const _rid='ds-'+d.id;return'<tr class="src-sub-'+_rid+'" style="display:none;background:rgba(240,165,0,0.04)">'+'<td></td><td></td>'+'<td style="padding-left:24px;color:var(--mu);font-size:0.72rem">↳ '+_rl+'</td>'+'<td style="color:var(--mu);font-size:0.72rem">'+_rv+'</td>'+'<td style="color:var(--mu);font-size:0.72rem">'+_rg+'</td>'+'<td colspan="12"></td></tr>';}).join(''):'');;}).join('');}
function renderDyePanels(lots){const panel=document.getElementById('dye-panels');if(!panel)return;const today=new Date();const readyForDye=(State.DB.lots||[]).filter(l=>getSoftBalance(l.id,l.grade,l.vendor).units>0||getSoftBalance(l.id,l.grade,l.vendor).weight>0);const readyForWind=(lots||[]).filter(d=>{if(d.status!=='Approved')return false;return getDyeBal(d.id).weight>0;});const card1=`<div style="flex:1;min-width:280px;background:var(--s2);border-radius:10px;padding:14px;border-left:3px solid var(--cs)"><div style="font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:var(--cs);margin-bottom:10px">
      📥 Soft Done — Ready for Dye (${readyForDye.length})
    </div>
    ${readyForDye.length?readyForDye.map(l=>{
      const sfBal=getSoftBalanceWeight(l.id,l.grade,l.vendor);
      const softEntries=(State.DB.stageEntries||[]).filter(e=>e.lotId===l.id&&e.stage==='Soft'&&(e.status==='Approved'||e.status==='Edited-Approved'));
      const lastSoftEnd=softEntries.length?softEntries.reduce((a,e)=>e.endTime>a?e.endTime:a,''):null;
      const days=lastSoftEnd?Math.floor((today-new Date(lastSoftEnd))/86400000):null;
      return `<div style="padding:8px 0;border-bottom:1px solid var(--b1)"><div style="display:flex;justify-content:space-between;align-items:center"><div><span class="mono"style="color:var(--ac);font-weight:700">${l.id}</span><span class="badge b-rm"style="margin-left:6px;font-size:0.62rem">${l.grade}</span></div><div style="text-align:right"><div style="font-size:0.78rem;font-weight:700;color:var(--cs)">${fmt(sfBal)}kg softened</div>${days!==null?agingBadge(days):''}</div></div><div style="font-size:0.68rem;color:var(--mu)">${l.vendor}</div></div>`;
    }).join(''):'<div style="color:var(--mu);font-size:0.75rem;padding:8">Nothing waiting ✓</div>'}
  </div>`;const card2=`<div style="flex:1;min-width:280px;background:var(--s2);border-radius:10px;padding:14px;border-left:3px solid var(--cw)"><div style="font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:var(--cw);margin-bottom:10px">
      📤 Dye Done — Ready for Wind (${readyForWind.length})
    </div>
    ${readyForWind.length?readyForWind.map(d=>{
      const dyeApproved=d.approvedAt?new Date(d.approvedAt):null;
      const days=dyeApproved?Math.floor((today-dyeApproved)/86400000):null;
      const bal=getDyeBal(d.id);
      return `<div style="padding:8px 0;border-bottom:1px solid var(--b1)"><div style="display:flex;justify-content:space-between;align-items:center"><div><span class="mono"style="color:var(--ac);font-weight:700">${d.dyeLotNo}</span></div><div style="text-align:right"><div style="font-size:0.78rem;font-weight:700;color:var(--cw)">${fmt(bal)}kg available</div>${days!==null?agingBadge(days):''}</div></div><div style="font-size:0.68rem;color:var(--mu)">${d.shade||'—'}</div></div>`;
    }).join(''):'<div style="color:var(--mu);font-size:0.75rem;padding:8">Nothing waiting ✓</div>'}
  </div>`;panel.innerHTML=`<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:20px">${card1}${card2}</div>`;}
function elRef(l){let s=(l.stage||'').toLowerCase();let q=String.fromCharCode(39);if(s==='dye'||s==='wind'||s==='pack'||s==='dispatch'){let dl=(State.DB.dyeLots||[]).find(function(d){return d.id===l.entryId||d.dyeLotNo===l.entryId;});if(dl)return'<span style="color:var(--cd);font-weight:700;cursor:pointer;text-decoration:underline" onclick="openDyeLifecycle('+q+dl.id+q+')">'+dl.dyeLotNo+' — '+dl.shade+'</span>';}
let lot=(State.DB.lots||[]).find(function(l2){return l2.id===l.entryId;});if(lot)return'<span style="color:var(--ac);font-weight:700;cursor:pointer;text-decoration:underline" onclick="nav('+q+'lifecycle'+q+',document.getElementById('+q+'ni-lifecycle'+q+'));setTimeout(function(){let sel=document.getElementById('+q+'lc-select'+q+');if(sel){sel.value='+q+lot.id+'||'+lot.grade+'||'+lot.vendor+q+';renderLifecycle();}},100)">'+lot.id+' — '+lot.grade+'</span>';return'<span style="color:var(--mu)">—</span>';}
function renderEditLog(){
  if(!State.DB.editLog)State.DB.editLog=[];

  // Helper: get reference, grade, shade from entryId + stage
  function _elLookup(entryId, stage){
    const s=(stage||'').toLowerCase();
    let ref='—', grade='—', shade='—';
    if(s==='soft'||s==='stage'){
      const e=(State.DB.stageEntries||[]).find(x=>x.id===entryId);
      if(e){
        ref=e.lotId||'—';
        const lot=(State.DB.lots||[]).find(l=>l.id===e.lotId&&(!e.grade||l.grade===e.grade));
        if(lot) grade=lot.grade||'—';
      }
    } else if(s==='dye'){
      const d=(State.DB.dyeLots||[]).find(x=>x.id===entryId||x.dyeLotNo===entryId);
      if(d){ ref=d.dyeLotNo||'—'; shade=d.shade||'—'; }
    } else if(s==='wind'){
      const w=(State.DB.windEntries||[]).find(x=>x.id===entryId);
      if(w){
        const d=(State.DB.dyeLots||[]).find(x=>x.id===w.dyeLotId);
        if(d){ ref=d.dyeLotNo||'—'; shade=d.shade||'—'; }
      }
    } else if(s==='pack'){
      const p=(State.DB.packEntries||[]).find(x=>x.id===entryId);
      if(p){
        const d=(State.DB.dyeLots||[]).find(x=>x.id===p.dyeLotId);
        if(d){ ref=d.dyeLotNo||'—'; shade=d.shade||'—'; }
      }
    } else if(s==='dispatch'){
      const ds=(State.DB.dispatches||[]).find(x=>x.id===entryId);
      if(ds){
        const d=(State.DB.dyeLots||[]).find(x=>x.id===ds.dyeLotId);
        if(d){ ref=d.dyeLotNo||'—'; shade=d.shade||'—'; }
      }
    }
    return {ref, grade, shade};
  }

  // Split into edits vs voids vs overrides
  const _editRows = (State.DB.editLog||[]).filter(l=>{
    const f=(l.fieldChanged||l.field||'').toLowerCase();
    return f!=='status' && f!=='voided' && l.newVal!=='Voided';
  });
  // Jul 25 2026 fix — Override (bringing a Rejected/Voided entry back to
  // Approved) writes field:'Status' same as an actual Void does, so it
  // was silently landing in the Void Log tab even though it's the
  // opposite action. Pulled out into its own bucket, matched by newVal
  // containing "Override" rather than being "Voided".
  const _overrideRows = (State.DB.editLog||[]).filter(l=>{
    const f=(l.fieldChanged||l.field||'').toLowerCase();
    return f==='status' && (l.newVal||'').includes('Override');
  }).map(l=>({...l, _src:'edit'}));
  const _voidRows = [
    ...(State.DB.editLog||[]).filter(l=>{
      const f=(l.fieldChanged||l.field||'').toLowerCase();
      return (f==='status'||l.newVal==='Voided') && !(l.newVal||'').includes('Override');
    }).map(l=>({...l, _src:'edit'})),
    ...(State.DB.voidLog||[]).filter(v=>v.type==='rm-delivery').map(v=>({
      id:v.id, timestamp:v.timestamp||v.at||'',
      entryId:v.lotId||'', stage:'RM Delivery',
      fieldChanged:'Delivery Void', oldVal:v.delivery?JSON.stringify(v.delivery):'—',
      newVal:'Voided', reasonCat:'Void', reason:'—',
      changedBy:v.voidedBy||'—', _src:'voidlog'
    }))
  ];

  // Current tab
  const _curTab = window._elTab||'edits';

  // Filters
  const _fStage = document.getElementById('elf-stage')?.value||'';
  const _fBy    = document.getElementById('elf-by')?.value||'';

  const baseRows = _curTab==='edits' ? _editRows : _curTab==='overrides' ? _overrideRows : _voidRows;
  const filtered = baseRows.filter(l=>(!_fStage||l.stage===_fStage)&&(!_fBy||(l.changedBy||l.by||'')===_fBy));
  const stages   = [...new Set(baseRows.map(l=>l.stage).filter(Boolean))].sort();
  const users    = [...new Set(baseRows.map(l=>l.changedBy||l.by||'').filter(Boolean))].sort();

  // Build thead
  const _elTh = document.getElementById('editlog-thead');
  if(_elTh){
    _elTh.innerHTML=`
      <tr class="tbl-filter-row">
        <th></th>
        <th>${buildColFilter(stages,'elf-stage','Stage')}</th>
        <th></th><th></th><th></th>
        <th></th><th></th><th></th><th></th>
        <th>${buildColFilter(users,'elf-by','By')}</th>
        <th></th>
      </tr>
      <tr>
        ${sortTh('el','entryId','Entry ID')}
        <th>Stage</th>
        <th>Reference</th>
        <th>Grade</th>
        <th>Shade</th>
        ${sortTh('el','fieldChanged','Field')}
        ${sortTh('el','oldVal','Old')}
        <th>New</th>
        <th>Reason Cat.</th>
        <th>Reason Text</th>
        ${sortTh('el','changedBy','By')}
        ${sortTh('el','timestamp','Time')}
      </tr>`;
    if(_fStage)document.getElementById('elf-stage').value=_fStage;
    if(_fBy)document.getElementById('elf-by').value=_fBy;
  }

  // Sort
  const logs = _sortState.el?.col
    ? sortArr(filtered, _sortState.el.col, _sortState.el.dir)
    : [...filtered].sort((a,b)=>(b.timestamp||'').localeCompare(a.timestamp||''));

  // Render rows
  const tbody = document.getElementById('editlog-tbody');
  if(!tbody) return;
  tbody.innerHTML = logs.map(l=>{
    const {ref,grade,shade} = _elLookup(l.entryId, l.stage);
    const field = l.field||l.fieldChanged||'—';
    const by = l.changedBy||l.by||'—';
    const reasonCat = l.reasonCat||'—';
    const reasonText = l.reasonText||l.reason||'—';
    const stageColor = {soft:'var(--cs)',dye:'var(--cd)',wind:'var(--cw)',pack:'var(--cp)',dispatch:'var(--gr)'}[(l.stage||'').toLowerCase()]||'var(--mu)';
    return `<tr>
      <td class="mono" style="font-size:0.72rem;color:var(--ac);font-weight:700">${l.entryId||'—'}</td>
      <td><span class="badge" style="background:${stageColor}20;color:${stageColor};font-size:0.6rem;padding:2px 6px;border-radius:4px">${l.stage||'—'}</span></td>
      <td class="mono" style="font-size:0.72rem;color:var(--ac)">${ref}</td>
      <td style="font-size:0.72rem;color:var(--mu)">${grade}</td>
      <td style="font-size:0.72rem;color:var(--cd)">${shade}</td>
      <td style="font-size:0.72rem;font-weight:600">${field}</td>
      <td class="mono" style="font-size:0.68rem;color:var(--re)">${l.oldVal||'—'}</td>
      <td class="mono" style="font-size:0.68rem;color:var(--gr)">${l.newVal||'—'}</td>
      <td style="font-size:0.68rem;color:var(--mu)">${reasonCat}</td>
      <td style="font-size:0.68rem;max-width:160px;word-break:break-word">${reasonText==='—'?'—':reasonText}</td>
      <td style="font-size:0.72rem;font-weight:600">${by}</td>
      <td style="font-size:0.68rem;color:var(--mu);white-space:nowrap">${fmtRelTS(l.timestamp)}</td>
    </tr>`;
  }).join('')||`<tr><td colspan="12"><div class="empty"><div class="empty-icon">📝</div><div class="empty-text">No ${_curTab==='edits'?'edits':'voids'} on record</div></div></td></tr>`;
}
function renderImbalanceWidget(){const el=document.getElementById('dashboard-imbalance-widget');if(!el)return;const issues=detectImbalances();if(!issues.length){el.style.display='none';return;}
el.style.display='';el.innerHTML=`<div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);border-radius:10px;padding:12px 16px;margin-bottom:16px;"><div style="font-size:0.78rem;font-weight:700;color:var(--re);margin-bottom:8px;">⚠ ${issues.length} ${issues.length===1?'entry needs':'entries need'} attention</div>
    ${issues.slice(0,3).map(i=>`<div style="font-size:0.72rem;color:var(--mu);padding:3px 0;"><span class="badge b-void"style="font-size:0.58rem;margin-right:6px">${i.stage}</span>${i.id}— ${i.msg}</div>`).join('')}
    ${issues.length>3?`<div style="font-size:0.68rem;color:var(--re);margin-top:4px;">+${issues.length-3}more —<span onclick="nav('editlog',document.getElementById('ni-editlog'))"style="cursor:pointer;text-decoration:underline">view edit log</span></div>`:''}
  </div>`;}
function renderPackTable(){const _focusCap=_captureFilterFocus('packf-');const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';const isSup=State.currentUser?.role==='supervisor'||isAdmin;const _fLot=document.getElementById('packf-lot')?.value||'';const _fGradeP=document.getElementById('packf-grade')?.value||'';const _fStatus=document.getElementById('packf-status')?.value||'';const _fShade=document.getElementById('packf-shade')?.value||'';const allPack=State.DB.packEntries||[];const lots=[...new Set(allPack.filter(e=>(!_fShade||e.shade===_fShade)&&(!_fStatus||e.status===_fStatus)).map(e=>e.dyeLotNo).filter(Boolean))].sort((a,b)=>b.localeCompare(a));const grades_p=[...new Set(allPack.filter(e=>(!_fLot||(e.dyeLotNo||'').includes(_fLot))&&(!_fStatus||e.status===_fStatus)).map(e=>e.grade).filter(Boolean))].sort();const shades_p=[...new Set(allPack.filter(e=>(!_fLot||(e.dyeLotNo||'').includes(_fLot))&&(!_fStatus||e.status===_fStatus)).map(e=>e.shade).filter(Boolean))].sort();const statuses=[...new Set(allPack.filter(e=>(!_fLot||(e.dyeLotNo||'').includes(_fLot))&&(!_fShade||e.shade===_fShade)).map(e=>e.status).filter(Boolean))].sort();const _pTh=document.getElementById('pack-thead');if(_pTh){_pTh.innerHTML=`
      <tr class="tbl-filter-row"><th>${buildDyeLotSearch('packf-lot','packf-lot-xbtn','packf')}</th><th>${buildColFilter(grades_p,'packf-grade','Grade')}</th><th>${buildColFilter(shades_p,'packf-shade','Shade')}</th><th></th><th></th><th></th><th></th><th></th><th></th><th></th><th>${buildColFilter(statuses,'packf-status','Status')}</th><th></th></tr><tr>
        ${sortTh('pack','dyeLotNo','Dye Lot')}
        ${sortTh('pack','grade','Grade')}
        ${sortTh('pack','shade','Shade')}
        <th>In (c/kg)</th><th>Out (b/kg)</th><th>Gain (kg)</th><th>Gain%</th>
        ${sortTh('pack','_daysActive','Days')}
        ${sortTh('pack','worker','Worker')}
        ${sortTh('pack','timestamp','Date/Time')}
        ${sortTh('pack','status','Status')}
        <th>Actions</th></tr>`;if(_fLot)document.getElementById('packf-lot').value=_fLot;if(_fGradeP)document.getElementById('packf-grade').value=_fGradeP;if(_fShade)document.getElementById('packf-shade').value=_fShade;if(_fStatus)document.getElementById('packf-status').value=_fStatus;_restoreFilterBtns('packf-lot','packf-grade','packf-shade','packf-status');_restoreFilterFocus(_focusCap);}
const _packF=(State.DB.packEntries||[]).filter(e=>(!_fLot||(e.dyeLotNo||'').includes(_fLot))&&(!_fGradeP||(e.grade||'')===_fGradeP)&&(!_fShade||(e.shade||'')===_fShade)&&(!_fStatus||e.status===_fStatus));const _packFc=_packF.map(e=>({...e,_daysActive:e.timestamp?Math.floor((new Date()-new Date(e.timestamp))/86400000):999}));const entries=_sortState.pack?.col?sortArr(_packFc,_sortState.pack.col,_sortState.pack.dir):[..._packFc].sort((a,b)=>(b.timestamp||'').localeCompare(a.timestamp||''));const canAct=State.currentUser?.role==='admin'||State.currentUser?.role==='manager'||State.currentUser?.role==='supervisor';document.getElementById('pack-tbody').innerHTML=entries.map(e=>{const _packDays=e.status==='Approved'&&e.approvedAt?Math.floor((new Date()-new Date(e.approvedAt))/86400000):e.timestamp?Math.floor((new Date()-new Date(e.timestamp))/86400000):null;const _packDispatched=(State.DB.dispatches||[]).some(d=>d.dyeLotId===e.dyeLotId&&(d.status==='Approved'||d.status==='Edited-Approved'));const _packBadge=statusBadge(e.status)+(e.status==='Approved'&&_packDispatched?'<div style="font-size:0.6rem;color:var(--gr);margin-top:2px">Dispatched</div>':'');return`<tr class="${entryRowClass(e.status)}"><td class="mono" style="vertical-align:top;color:var(--ac);font-weight:700;cursor:pointer" onclick="openDyeLifecycle('${e.dyeLotId||''}')"><span>${e.dyeLotNo||'—'}</span></td><td style="vertical-align:top">${e.grade?'<span class="badge b-rm">'+e.grade+'</span>':'—'}</td><td style="vertical-align:top;font-size:0.75rem;font-weight:600">${e.shade||'—'}</td><td style="vertical-align:top" class="mono">${qtyCell(e.inCones,e.inWeight,'c')}</td><td style="vertical-align:top" class="mono">${fmt(e.bags)}b / ${fmt(e.weight)}kg</td><td class="mono" style="vertical-align:top;color:${(e.gainKg||0)>0?'var(--gr)':(e.gainKg||0)<-0.01?'var(--re)':'var(--mu)'}">${e.gainKg!=null?(e.gainKg>0?'+':'')+fmt(e.gainKg)+'kg':'—'}</td><td class="mono" style="vertical-align:top;color:${(e.gainPct||0)>0?'var(--gr)':(e.gainPct||0)<-0.1?'var(--re)':'var(--mu)'}">${e.gainPct!=null?(e.gainPct>0?'+':'')+e.gainPct.toFixed(1)+'%':'—'}</td><td style="vertical-align:top">${agingBadge(_packDays)}</td>${mwCell(e.worker)}<td style="vertical-align:top;font-size:0.68rem;color:var(--mu)">${fmtTS(e.timestamp)}</td><td style="vertical-align:top">${_packBadge}</td><td style="vertical-align:top;white-space:nowrap">
        ${(e.status==='Pending'||e.status==='Edited-Pending')&&isSup?`<button class="btn btn-success btn-xs tc-tip" data-tip="Approve" onclick="approvePackEntry('${e.id}')">✓</button><button class="btn btn-danger btn-xs tc-tip" data-tip="Reject" onclick="rejectPackEntry('${e.id}')">✗</button>`:''}
        ${(e.status==='Approved'||e.status==='Edited-Approved')&&isAdmin?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Edit" onclick="openEditEntryModal('${e.id}','pack')">✏</button><button class="btn btn-ghost btn-xs tc-tip" data-tip="Void" style="color:var(--re)" onclick="openVoidModal('${e.id}','pack')">🗑</button>`:''}
        ${(e.status==='Rejected'||e.status==='Voided')&&isAdmin?`<button class="btn btn-success btn-xs"onclick="openOverride('${e.id}','pack')">↩ Override</button><button class="btn btn-ghost btn-xs tc-tip" data-tip="Void" style="color:var(--re)" onclick="openVoidModal('${e.id}','pack')">🗑</button>`:''}
      </td></tr>`;}).join('')||'<tr><td colspan="10"><div class="empty"><div class="empty-icon">📦</div><div class="empty-text">✕ No pack entries yet — select a dye lot to begin</div></div></td></tr>';setTimeout(fitBevTableHeight,0);}
function renderPartyTracker(){
  const selDyeLot=document.getElementById('pt-dylot-filter')?.value||'';
  if(selDyeLot){
    const existing=(State.DB.dyeLots||[]).find(d=>d.dyeLotNo===selDyeLot&&d.sources);
    if(!existing){
      const stub=_dyeLotsForDropdown().find(d=>d.dyeLotNo===selDyeLot);
      if(stub)return _hydrateDyeLot(stub.id,()=>{_renderPartyTrackerCore();});
    }
  }
  _renderPartyTrackerCore();
}
function _renderPartyTrackerCore(){
updateOrderStatuses();
const container=document.getElementById('pt-container');
if(!container)return;
const parties=[...(State.DB.parties||[])].sort((a,b)=>a.localeCompare(b));
if(!parties.length){container.innerHTML='<div class="empty"><div class="empty-icon">🏢</div><div class="empty-text">No parties in Masters yet</div></div>';return;}
const filterBar=document.getElementById('pt-filter-bar');
const selectedParty=document.getElementById('pt-party-filter')?.value||'';
const selectedDyeLot=document.getElementById('pt-dylot-filter')?.value||'';
const selectedStatus=document.getElementById('pt-status-filter')?.value||'';
const selectedDue=document.getElementById('pt-due-filter')?.value||'';
const selectedDaysOpen=document.getElementById('pt-daysopen-filter')?.value||'';
const _ptDisps=(State.DB.dispatches||[]).filter(d=>d.status==='Approved'&&(!selectedParty||d.party===selectedParty));
const _ptDyeLots=[...new Set([..._ptDisps.map(d=>d.dyeLotNo),..._dyeLotsForDropdown().map(d=>d.dyeLotNo)].filter(Boolean))].sort();
if(filterBar){filterBar.innerHTML=`<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 0 14px 0;border-bottom:1px solid var(--b1);margin-bottom:16px;"><select id="pt-party-filter" class="fs" style="flex:1;min-width:150px;max-width:240px" onchange="renderPartyTracker()"><option value="">— Select Party —</option>${parties.map(p=>`<option value="${p}"${p===selectedParty?' selected':''}>${p}</option>`).join('')}</select><select id="pt-dylot-filter" class="fs" style="min-width:110px;max-width:160px" onchange="renderPartyTracker()"><option value="">All Lots</option>${_ptDyeLots.map(l=>`<option value="${l}"${l===selectedDyeLot?' selected':''}>${l}</option>`).join('')}</select><select id="pt-status-filter" class="fs" style="min-width:100px;max-width:140px" onchange="renderPartyTracker()"><option value="">All Status</option><option value="Open" ${selectedStatus==='Open'?'selected':''}>Open</option><option value="Partial" ${selectedStatus==='Partial'?'selected':''}>Partial</option><option value="Completed" ${selectedStatus==='Completed'?'selected':''}>Completed</option><option value="Cancelled" ${selectedStatus==='Cancelled'?'selected':''}>Cancelled</option><option value="Unlinked" ${selectedStatus==='Unlinked'?'selected':''}>Unlinked</option></select><select id="pt-due-filter" class="fs" style="min-width:100px;max-width:130px" onchange="renderPartyTracker()"><option value="">Any Due</option><option value="overdue" ${selectedDue==='overdue'?'selected':''}>Overdue</option><option value="1" ${selectedDue==='1'?'selected':''}>Due Today</option><option value="2" ${selectedDue==='2'?'selected':''}>Due in 1d</option><option value="3" ${selectedDue==='3'?'selected':''}>Due in 2d</option><option value="4" ${selectedDue==='4'?'selected':''}>Due in 3d</option></select><select id="pt-daysopen-filter" class="fs" style="min-width:110px;max-width:140px" onchange="renderPartyTracker()"><option value="">Any Duration</option><option value="7" ${selectedDaysOpen==='7'?'selected':''}>7+ days</option><option value="15" ${selectedDaysOpen==='15'?'selected':''}>15+ days</option><option value="30" ${selectedDaysOpen==='30'?'selected':''}>30+ days</option><option value="60" ${selectedDaysOpen==='60'?'selected':''}>60+ days</option></select>${selectedParty||selectedDyeLot||selectedStatus||selectedDue||selectedDaysOpen?`<button class="btn btn-ghost btn-sm" onclick="['pt-party-filter','pt-dylot-filter','pt-status-filter','pt-due-filter','pt-daysopen-filter'].forEach(function(id){let el=document.getElementById(id);if(el)el.value='';});renderPartyTracker()">✕ Clear</button>`:''}</div>`;}
if(!selectedParty&&!selectedStatus&&!selectedDue&&!selectedDaysOpen&&!selectedDyeLot){const _se=document.getElementById('pt-summary');if(_se)_se.innerHTML='';container.innerHTML='<div class="empty"><div class="empty-icon">🏢</div><div class="empty-text">Select a party or use filters to view orders</div></div>';return;}
const now_pt=new Date();
const filteredParties=(selectedParty?parties.filter(p=>p===selectedParty):parties).filter(party=>{
const pOrders=(State.DB.partyOrders||[]).filter(o=>o.party===party);
const pDisps=(State.DB.dispatches||[]).filter(d=>d.party===party&&d.status==='Approved');
if(selectedDyeLot&&!pDisps.some(d=>d.dyeLotNo===selectedDyeLot))return false;
if(selectedStatus==='Unlinked')return pDisps.some(d=>!d.orderId);
if(selectedStatus&&!pOrders.some(o=>o.status===selectedStatus))return false;
if(selectedDue){const activeOrds=pOrders.filter(o=>o.status!=='Completed'&&o.status!=='Cancelled'&&o.due);if(selectedDue==='overdue'){if(!activeOrds.some(o=>new Date(o.due)<now_pt))return false;}else{const days=parseInt(selectedDue);if(!activeOrds.some(o=>{const d=Math.ceil((new Date(o.due)-now_pt)/(1000*60*60*24));return d>=0&&d<days;}))return false;}}
if(selectedDaysOpen){const minDays=parseInt(selectedDaysOpen);const activeOrds=pOrders.filter(o=>o.status!=='Completed'&&o.status!=='Cancelled'&&o.date);if(!activeOrds.some(o=>Math.floor((now_pt-new Date(o.date))/(1000*60*60*24))>=minDays))return false;}
return true;});
const _allOrders=(State.DB.partyOrders||[]).filter(o=>filteredParties.includes(o.party));
if(!window._ptTimelineOpen)window._ptTimelineOpen={};
if(selectedDyeLot){filteredParties.forEach(party=>{const matchingDisps=(State.DB.dispatches||[]).filter(d=>d.party===party&&d.dyeLotNo===selectedDyeLot&&d.status==='Approved');if(matchingDisps.length){matchingDisps.forEach(d=>{if(d.orderId){window._ptTimelineOpen[`pt-ord-disp-${d.orderId}`]=true;}});}});}
const _allDisps=(State.DB.dispatches||[]).filter(d=>d.status==='Approved'&&filteredParties.includes(d.party)&&(!selectedDyeLot||d.dyeLotNo===selectedDyeLot));
const _filtOrders=_allOrders.filter(o=>o.status!=='Cancelled'&&(!selectedStatus||o.status===selectedStatus));
const _totOrd=selectedDyeLot?null:_filtOrders.reduce((a,o)=>a+(o.qtyOrdered||0),0);
const _totFulfilled=selectedDyeLot?null:_filtOrders.reduce((a,o)=>a+(o.qtyFulfilled||0),0);
const _totDisp=_allDisps.reduce((a,d)=>a+(d.weight||0),0);
const _totBags=_allDisps.reduce((a,d)=>a+(d.bags||0),0);
const _totBal=_totOrd!==null?Math.max(0,_totOrd-(_totFulfilled||0)):null;
const _totOver=selectedDyeLot?null:_allOrders.filter(o=>o.due&&o.status!=='Completed'&&o.status!=='Cancelled'&&new Date(o.due)<new Date()).length;
const summaryEl=document.getElementById('pt-summary');
if(summaryEl)summaryEl.innerHTML=`<div style="display:flex;gap:20px;flex-wrap:wrap;padding:12px 16px;background:var(--s2);border-radius:8px;margin-bottom:16px;font-size:0.78rem;">${_totOrd!==null?`<div><span style="color:var(--mu)">Total Ordered</span><br><strong style="font-size:1rem">${fmt(_totOrd)}kg</strong></div>`:''}<div><span style="color:var(--mu)">Total Dispatched</span><br><strong style="font-size:1rem;color:var(--gr)">${_totFulfilled!==null?fmt(_totFulfilled)+' kg':fmt(_totBags)+'b / '+fmt(_totDisp)+' kg'}</strong></div>${_totBal!==null?`<div><span style="color:var(--mu)">Balance Pending</span><br><strong style="font-size:1rem;color:var(--ye)">${fmt(_totBal)}kg</strong></div>`:''} ${_totOver>0?`<div><span style="color:var(--mu)">Overdue Orders</span><br><strong style="font-size:1rem;color:var(--re)">⚠ ${_totOver}</strong></div>`:''}</div>`;
container.innerHTML=filteredParties.map(party=>{
const _statusForOrders=selectedStatus==='Unlinked'?'':selectedStatus;
const orders=(State.DB.partyOrders||[]).filter(o=>o.party===party&&(!_statusForOrders||o.status===_statusForOrders)).sort((a,b)=>b.date.localeCompare(a.date));
const _ordShades=(_statusForOrders)?new Set(orders.map(o=>(o.shade||'').toLowerCase())):null;
const allDisps=(State.DB.dispatches||[]).filter(d=>d.party===party&&d.status==='Approved'&&!d.orderId&&(!selectedDyeLot||d.dyeLotNo===selectedDyeLot)&&(!_ordShades||_ordShades.has((d.shade||'').toLowerCase()))).sort((a,b)=>(b.timestamp||'').localeCompare(a.timestamp||''));
const _allPartyDisps=(State.DB.dispatches||[]).filter(d=>d.party===party&&d.status==='Approved');
const totalWt=_allPartyDisps.reduce((a,d)=>a+(d.weight||0),0);
const totalBg=_allPartyDisps.reduce((a,d)=>a+(d.bags||0),0);
const lastDisp=[..._allPartyDisps].sort((a,b)=>(b.timestamp||'').localeCompare(a.timestamp||''))[0];
const pendingQty=orders.filter(o=>o.status==='Open'||o.status==='Partial').reduce((a,o)=>a+(o.qtyOrdered-o.qtyFulfilled),0);
const overdueOrders=orders.filter(o=>o.due&&o.status!=='Completed'&&o.status!=='Cancelled'&&new Date(o.due)<new Date());
const activeOrders=orders.filter(o=>o.status==='Open'||o.status==='Partial'||overdueOrders.find(od=>od.id===o.id));
const doneOrders=orders.filter(o=>o.status==='Completed'||o.status==='Cancelled');
const renderOrderRow=o=>{const pct=o.qtyOrdered>0?Math.min(100,(o.qtyFulfilled/o.qtyOrdered*100)):0;const stC=o.status==='Completed'?'var(--gr)':o.status==='Partial'?'var(--ye)':o.status==='Cancelled'?'var(--re)':'var(--mu)';const stLabel=o.status==='Completed'?'✓ Done':o.status==='Partial'?'Partial':o.status==='Cancelled'?'Cancelled':'Open';const now=new Date();const isOverdue=o.due&&o.status!=='Completed'&&o.status!=='Cancelled'&&new Date(o.due)<now;const daysUntilDue=o.due&&o.status!=='Completed'&&o.status!=='Cancelled'?Math.ceil((new Date(o.due)-now)/(1000*60*60*24)):null;const daysSinceCreated=o.date?Math.floor((now-new Date(o.date))/(1000*60*60*24)):null;const dueWarning=()=>{if(!o.due||o.status==='Completed'||o.status==='Cancelled')return'';if(isOverdue)return`<div style="font-size:0.65rem;color:var(--re);font-weight:700;margin-top:3px;">⚠ OVERDUE by ${Math.abs(daysUntilDue)}d</div>`;if(daysUntilDue<=1)return`<div style="font-size:0.65rem;color:#f97316;font-weight:700;margin-top:3px;">⚡ Due tomorrow</div>`;if(daysUntilDue<=3)return`<div style="font-size:0.65rem;color:var(--ye);font-weight:700;margin-top:3px;">⏰ Due in ${daysUntilDue}d</div>`;return`<div style="font-size:0.62rem;color:var(--mu);margin-top:3px;">Due: ${o.due}</div>`;};const ordDisps=(State.DB.dispatches||[]).filter(d=>d.orderId===o.id&&d.status==='Approved');const dispKey=`pt-ord-disp-${o.id}`;const dispOpen=window._ptTimelineOpen&&window._ptTimelineOpen[dispKey];const dispHTML=ordDisps.length?`<div style="margin-top:10px;border-top:1px solid var(--b1);padding-top:8px;"><div onclick="event.stopPropagation();window._ptTimelineOpen=window._ptTimelineOpen||{};window._ptTimelineOpen['${dispKey}']=!window._ptTimelineOpen['${dispKey}'];renderPartyTracker();" style="font-size:0.68rem;font-weight:700;color:var(--ac);cursor:pointer;display:flex;align-items:center;gap:5px;"><span>${dispOpen?'▼':'▶'}</span><span>Dispatches (${ordDisps.length}) · ${ordDisps.reduce((a,d)=>a+(d.bags||0),0)}b / ${fmt(ordDisps.reduce((a,d)=>a+(d.weight||0),0))}kg</span></div>${dispOpen?`<div style="margin-top:8px;background:var(--s1);border-radius:6px;padding:6px 8px;"><div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:4px;font-size:0.6rem;font-weight:700;color:var(--mu);text-transform:uppercase;padding:3px 0;border-bottom:1px solid var(--b1);margin-bottom:4px;"><span>Dye Lot</span><span>Bags</span><span>Weight</span><span>Challan</span></div>${ordDisps.map(d=>`<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:4px;font-size:0.7rem;padding:4px 0;border-bottom:1px solid var(--b1);"><span style="color:var(--ac);font-weight:700;cursor:pointer;text-decoration:underline" onclick="openDyeLifecycle('${d.dyeLotId||''}')">${d.dyeLotNo||'—'}</span><span>${d.bags||0}b</span><span>${fmt(d.weight||0)}kg</span><span style="color:var(--mu)">${d.invoiceNo||'—'}</span></div>`).join('')}</div>`:''}` + `</div>`:(o.qtyFulfilled>0?`<div style="margin-top:8px;font-size:0.65rem;color:var(--mu);border-top:1px solid var(--b1);padding-top:6px;">No dispatches linked to this order</div>`:'');if(o.status==='Completed'||o.status==='Cancelled'){const bdrC=o.status==='Completed'?'var(--gr)':'var(--re)';return`<div style="padding:10px 12px;background:var(--s2);border-radius:10px;border-left:3px solid ${bdrC};"><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;"><span style="font-weight:700;font-size:0.8rem;color:var(--ac)">${o.id}</span>${o.shade?`<span style="font-size:0.75rem;color:var(--tx)">${o.shade}</span>`:''} ${o.grade?`<span style="font-size:0.65rem;color:var(--mu)">${o.grade}</span>`:''}<span style="font-size:0.65rem;font-weight:700;color:${stC}">${stLabel}</span></div><div style="font-size:0.68rem;color:var(--mu);margin-top:3px;">${o.status==='Completed'?`✓ ${fmt(o.qtyFulfilled)}kg fulfilled`:`✕ Cancelled${o.cancelReason?' — '+o.cancelReason:''}`}</div>${dispHTML}</div>`;}const bdrColor=isOverdue?'var(--re)':pct>0?'var(--ye)':'var(--b1)';return`<div style="padding:12px;background:var(--s2);border-radius:10px;border-left:3px solid ${bdrColor};display:flex;flex-direction:column;gap:0;"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;"><div style="flex:1;min-width:0;"><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;"><span style="font-weight:700;font-size:0.82rem;color:var(--ac)">${o.id}</span>${o.shade?`<span style="font-size:0.78rem;color:var(--tx);font-weight:600">${o.shade}</span>`:''} ${o.grade?`<span style="font-size:0.65rem;color:var(--mu)">${o.grade}</span>`:''}<span style="font-size:0.62rem;font-weight:700;padding:1px 6px;border-radius:4px;background:${isOverdue?'rgba(239,68,68,0.12)':pct>0?'rgba(234,179,8,0.12)':'var(--s3)'};color:${stC}">${stLabel}</span></div>${dueWarning()}${daysSinceCreated!==null?`<div style="font-size:0.62rem;color:var(--mu);margin-top:2px;">Open for ${daysSinceCreated}d</div>`:''}</div>${o.status!=='Completed'&&o.status!=='Cancelled'?`<button class="btn btn-ghost btn-xs" style="color:var(--re);flex-shrink:0" onclick="event.stopPropagation();cancelPartyOrder('${o.id}')">✕</button>`:''}</div><div style="margin-top:10px;"><div style="display:flex;justify-content:space-between;font-size:0.68rem;margin-bottom:5px;"><span style="color:var(--mu)">${fmt(o.qtyFulfilled)}kg done</span><span style="font-weight:700;color:var(--tx)">${fmt(o.qtyOrdered)}kg ordered</span><span style="color:var(--ye)">${fmt(Math.max(0,o.qtyOrdered-o.qtyFulfilled))}kg left</span></div><div style="height:6px;background:var(--s3);border-radius:3px;overflow:hidden;"><div style="height:100%;width:${pct.toFixed(1)}%;background:${pct>=100?'var(--gr)':pct>0?'var(--ye)':'var(--s3)'};border-radius:3px;transition:width 0.3s;"></div></div></div>${dispHTML}</div>`;};
const doneKey=`pt-done-${party.replace(/\s/g,'_')}`;
const doneOpen=window._ptTimelineOpen&&window._ptTimelineOpen[doneKey];
const tlKey=`pt-tl-${party.replace(/\s/g,'_')}`;
const tlOpen=window._ptTimelineOpen&&window._ptTimelineOpen[tlKey];
const dispToShow=tlOpen?allDisps:allDisps.slice(0,2);
const timelineHTML=allDisps.length?`<div style="margin-top:8px;"><div onclick="window._ptTimelineOpen=window._ptTimelineOpen||{};window._ptTimelineOpen['${tlKey}']=!window._ptTimelineOpen['${tlKey}'];renderPartyTracker();" style="font-size:0.68rem;font-weight:700;text-transform:uppercase;color:var(--mu);cursor:pointer;display:flex;align-items:center;gap:6px;margin-bottom:${tlOpen?8:0}px;"><span>${tlOpen?'▼':'▶'}</span><span>Unlinked Dispatches (${allDisps.length})</span>${!tlOpen&&allDisps.length>2?`<span style="font-size:0.62rem;color:var(--mu)">${allDisps.length-2} more hidden</span>`:''}</div>${tlOpen?`<div style="border-left:2px solid var(--b1);padding-left:14px;">${dispToShow.map(d=>`<div style="position:relative;padding:8px 0;border-bottom:1px solid var(--b1);"><div style="position:absolute;left:-19px;top:12px;width:8px;height:8px;border-radius:50%;background:var(--ac)"></div><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;"><div><span class="mono" style="font-size:0.78rem;font-weight:700;color:var(--ac)">${d.dyeLotNo||'—'}</span><span style="font-size:0.72rem;margin-left:8px">${d.shade||'—'}</span>${d.invoiceNo?`<span style="font-size:0.68rem;color:var(--mu);margin-left:8px">${d.invoiceNo}</span>`:''} ${!d.orderId?`<span style="font-size:0.6rem;background:rgba(239,68,68,0.15);color:var(--re);padding:1px 5px;border-radius:3px;margin-left:6px;font-weight:700">NO ORDER</span><span onclick="openLinkOrder('${d.id}')" style="font-size:0.6rem;color:var(--ac);margin-left:4px;cursor:pointer;font-weight:700">🔗 Link</span>`:''}</div><div style="text-align:right;"><div style="font-size:0.78rem;font-weight:700;">${fmt(d.bags)}b/${fmt(d.weight)}kg</div><div style="font-size:0.65rem;color:var(--mu)">${fmtTS(d.timestamp)}</div></div></div></div>`).join('')}</div>`:''}` + `</div>`:'<div style="color:var(--mu);font-size:0.75rem;padding:8px 0">✕ No dispatches yet — pack a lot first</div>';
const partyHeader=`<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--b1);"><div><div style="font-size:1.05rem;font-weight:800;color:var(--tx)">${party}</div><div style="font-size:0.72rem;color:var(--mu);margin-top:3px;">Total: <strong>${fmt(totalBg)}b / ${fmt(totalWt)}kg</strong>${lastDisp?' · Last: '+fmtTS(lastDisp.timestamp):''}</div></div><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">${overdueOrders.length?`<span style="font-size:0.62rem;background:rgba(239,68,68,0.15);color:var(--re);padding:2px 8px;border-radius:4px;font-weight:700;">⚠ ${overdueOrders.length} overdue</span>`:''}${pendingQty>0&&!overdueOrders.length?`<span style="font-size:0.65rem;color:var(--ye);font-weight:700">${fmt(pendingQty)}kg pending</span>`:''}<button class="btn btn-ghost btn-xs" onclick="openPartyOrderModal('${party}')">+ Order</button></div></div>`;
const activeSection=activeOrders.length?`<div style="font-size:0.65rem;font-weight:800;text-transform:uppercase;letter-spacing:0.07em;color:var(--mu);margin-bottom:8px;">Active Orders (${activeOrders.length}${overdueOrders.length?' · <span style="color:var(--re)">'+overdueOrders.length+' overdue</span>':''})</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px;margin-bottom:16px;">${activeOrders.map(renderOrderRow).join('')}</div>`:'';
const doneSection=doneOrders.length?`<div onclick="window._ptTimelineOpen=window._ptTimelineOpen||{};window._ptTimelineOpen['${doneKey}']=!window._ptTimelineOpen['${doneKey}'];renderPartyTracker();" style="font-size:0.65rem;font-weight:800;text-transform:uppercase;letter-spacing:0.07em;color:var(--mu);cursor:pointer;display:flex;align-items:center;gap:6px;margin-bottom:${doneOpen?8:0}px;"><span>${doneOpen?'▼':'▶'}</span><span>Completed / Cancelled (${doneOrders.length})</span></div>${doneOpen?`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px;margin-bottom:12px;">${doneOrders.map(renderOrderRow).join('')}</div>`:''}`:'' ;
return`<div style="margin-bottom:20px;">${partyHeader}${activeSection}${doneSection}${timelineHTML}</div>`;
}).join('');}

function recalcAllSummaries(btn){
  if(!confirm('Recalculate ALL lot summaries from live Firebase data? This runs in the background and may take a little while for a large dataset.'))return;
  if(btn){btn.disabled=true;btn.textContent='⟳ Starting...';}
  apiPost('/api/summary/recalc-all',{}).then(({ok,error})=>{
    if(!ok){
      showToast(error||'Recalc failed to start','err');
      if(btn){btn.disabled=false;btn.textContent='⟳ Recalc All Summaries';}
      return;
    }
    if(btn)btn.textContent='⟳ Running in background...';
    let attempts=0;
    const poll=setInterval(async()=>{
      attempts++;
      try{
        const r=await fetch(WORKER_URL+'/api/summary/recalc-status',{headers:_postHeaders()});
        const d=await r.json();
        const st=d.status||{};
        if(st.status==='done'||st.status==='error'||attempts>=40){
          clearInterval(poll);
          if(st.status==='done'){
            // Fetch fresh summaries into State.DB
            Promise.all([
              fetch(WORKER_URL+'/api/summaries',{headers:_postHeaders()}).then(r=>r.json()).then(d=>{
                if(d.summaries){State.DB.lotSummaries={};d.summaries.forEach(s=>{if(s.lotId)State.DB.lotSummaries[_summaryKey(s.lotId,s.grade,s.vendor)]=s;});}
              }),
              fetch(WORKER_URL+'/api/dyelotsummaries',{headers:_postHeaders()}).then(r=>r.json()).then(d=>{
                if(d.summaries){State.DB.dyeLotSummaries={};d.summaries.forEach(s=>{if(s.dyeLotId)State.DB.dyeLotSummaries[s.dyeLotId]=s;});}
              })
            ]).then(()=>{
              showToast(`All summaries recalculated ✓ — ${st.rmDone||0} lot(s), ${st.dyeDone||0} dye lot(s)`);
              if(btn){btn.disabled=false;btn.textContent='⟳ Recalc All Summaries';}
              renderAll();
            }).catch(()=>{
              showToast('Recalc done — refresh if needed');
              if(btn){btn.disabled=false;btn.textContent='⟳ Recalc All Summaries';}
              renderAll();
            });
          }else if(st.status==='error'){
            showToast('Recalc failed: '+(st.error||'unknown error'),'err');
            if(btn){btn.disabled=false;btn.textContent='⟳ Recalc All Summaries';}
          }else{
            showToast('Recalc still running — check back shortly','err');
            if(btn){btn.disabled=false;btn.textContent='⟳ Recalc All Summaries';}
          }
        }
      }catch(e){
        clearInterval(poll);
        showToast('Network error: '+e.message,'err');
        if(btn){btn.disabled=false;btn.textContent='⟳ Recalc All Summaries';}
      }
    },3000);
  }).catch(e=>{
    showToast('Recalc failed: '+e.message,'err');
    if(btn){btn.disabled=false;btn.textContent='⟳ Recalc All Summaries';}
  });
}
function recalcLotSummary(lotId,grade,vendor,btn){
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
function renderRMStock(){const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';const isSup=State.currentUser?.role==='supervisor'||isAdmin;const fl_rm=document.getElementById('st-rmf-l')?.value||'';const fv=document.getElementById('st-rmf-v')?.value||'';const fg=document.getElementById('st-rmf-g')?.value||'';const fs=document.getElementById('st-rmf-s')?.value||'';const fp_rm=document.getElementById('st-rmf-pending')?.value||'';const allLots=State.DB.lots||[];const getLSt=l=>{const rmB=getRMBalance(l.id,l.grade,l.vendor);const sfB=getSoftBalance(l.id,l.grade,l.vendor);const sdAppr=getSoftConsumedByDye(l.id,l.grade,l.vendor);const sdPending=(State.DB.dyeLots||[]).filter(d=>(d.status==='Pending'||d.status==='InProgress')&&(d.sources||[]).some(s=>s.lotId===l.id&&s.grade===l.grade&&s.vendor===l.vendor)).reduce((a,d)=>{const src=(d.sources||[]).find(s=>s.lotId===l.id);return a+(src?src.weight||0:0);},0);const sd=sdAppr+sdPending;return sfB.weight>0&&sd===0?'At Soft':sd>0?'At Dye':rmB.units>0?'At RM':'Completed';};const lotNos=[...new Set(allLots.filter(l=>(!fv||l.vendor===fv)&&(!fg||l.grade===fg)&&(!fs||getLSt(l)===fs)).map(l=>l.id).filter(Boolean))].sort();const vendors=[...new Set(allLots.filter(l=>(!fl_rm||l.id===fl_rm)&&(!fg||l.grade===fg)&&(!fs||getLSt(l)===fs)).map(l=>l.vendor).filter(Boolean))].sort();const grades=[...new Set(allLots.filter(l=>(!fl_rm||l.id===fl_rm)&&(!fv||l.vendor===fv)&&(!fs||getLSt(l)===fs)).map(l=>l.grade).filter(Boolean))].sort();const statuses=[...new Set(allLots.filter(l=>(!fl_rm||l.id===fl_rm)&&(!fv||l.vendor===fv)&&(!fg||l.grade===fg)).map(l=>getLSt(l)).filter(Boolean))].sort();const _th=document.getElementById('st-rm-thead');if(_th){_th.innerHTML=`
      <tr class="tbl-filter-row"><th>${buildColFilter(lotNos,'st-rmf-l','Lot')}</th><th>${buildColFilter(grades,'st-rmf-g','Grade')}</th><th>${buildColFilter(vendors,'st-rmf-v','Vendor')}</th><th><select class="col-filter" id="st-rmf-pending" onchange="renderRMStock();_showFilterClearBtn('st-rmf-pending')" style="min-width:90px"><option value="">Pending At</option><option value="rm">RM</option><option value="soft">Soft</option></select></th><th></th><th></th><th></th><th></th><th></th><th></th><th></th><th></th><th>${buildColFilter(statuses,'st-rmf-s','Status')}</th><th></th></tr><tr>
        ${sortTh('rmstock','id','Lot')}
        ${sortTh('rmstock','grade','Grade')}
        ${sortTh('rmstock','vendor','Vendor')}
        <th>Total In</th><th>RM Bal</th><th>Soft Out</th><th>Soft Waste</th><th>Soft Bal</th><th>Sent to Dye</th>
        ${sortTh('rmstock','daysRM','Days@RM')}
        ${sortTh('rmstock','daysSoft','Days@Soft')}
        <th>Days@Dye</th><th>Status</th><th></th></tr>`;const _rl=document.getElementById('st-rmf-l');if(_rl)_rl.value=fl_rm;const _rv=document.getElementById('st-rmf-v');if(_rv)_rv.value=fv;const _rg=document.getElementById('st-rmf-g');if(_rg)_rg.value=fg;const _rs=document.getElementById('st-rmf-s');if(_rs)_rs.value=fs;const _rp=document.getElementById('st-rmf-pending');if(_rp)_rp.value=fp_rm;_restoreFilterBtns('st-rmf-l','st-rmf-v','st-rmf-g','st-rmf-s');}
const _today2=new Date();(State.DB.lots||[]).forEach(l=>{const ld=l.date?new Date(l.date):null;l._dRM=ld?Math.floor((_today2-ld)/86400000):null;const sfE=appr(State.DB.stageEntries||[]).filter(e=>seMatch(e,l)&&e.stage==='Soft'&&e.endTime);const lastSoft=sfE.length?new Date(Math.max(...sfE.map(e=>new Date(e.endTime)))):null;l._dSoft=lastSoft?Math.floor((_today2-lastSoft)/86400000):null;});const lots=(State.DB.lots||[]).filter(l=>{if(fl_rm&&l.id!==fl_rm)return false;if(fv&&l.vendor!==fv)return false;if(fg&&l.grade!==fg)return false;if(fs&&getLSt(l)!==fs)return false;if(fp_rm==='rm'){const b=getRMBalance(l.id,l.grade,l.vendor);if(!b||(b.units<=0&&b.weight<=0))return false;}
else if(fp_rm==='soft'){const b=getSoftBalance(l.id,l.grade,l.vendor);if(!b||(b.units<=0&&b.weight<=0))return false;}
return true;}).sort((a,b)=>{const ss=_sortState.rmstock;if(!ss.col)return b.id.localeCompare(a.id);const av=ss.col==='daysRM'?(a._dRM??999):ss.col==='daysSoft'?(a._dSoft??999):(a[ss.col]||'');const bv=ss.col==='daysRM'?(b._dRM??999):ss.col==='daysSoft'?(b._dSoft??999):(b[ss.col]||'');return typeof av==='number'?(av-bv)*ss.dir:String(av).localeCompare(String(bv))*ss.dir;});const tbody=document.getElementById('st-rm-tbody');if(!tbody)return;if(!lots.length){tbody.innerHTML=`<tr><td colspan="13"><div class="empty"><div class="empty-icon">📦</div><div class="empty-text">No RM lots yet</div></div></td></tr>`;return;}
tbody.innerHTML=lots.map(l=>{const rmBal=getRMBalance(l.id,l.grade,l.vendor);const sfBal=getSoftBalance(l.id,l.grade,l.vendor);const sfWt=sfBal.weight;const _sentDyeLive=getSoftConsumedByDye(l.id,l.grade,l.vendor);const _sfOutKgRaw=(State.DB.stageEntries||[]).filter(e=>e.lotId===l.id&&(e.grade||'')===(l.grade||'')&&(e.vendor||'')===(l.vendor||'')&&e.stage==='Soft'&&(e.status==='Approved'||e.status==='Edited-Approved')&&e.endTime).reduce((a,e)=>a+(e.outWeight||0),0);const _lotSumEarly=_getLotSummary(l.id,l.grade,l.vendor);const sentDye=_lotSumEarly?.sentToDye?.kg??Math.max(_sentDyeLive,Math.max(0,_sfOutKgRaw-sfWt));const totalInU=(l.deliveries||[{units:l.units,weight:l.weight}]).reduce((a,d)=>a+(d.units||0),0);const totalInKg=(l.deliveries||[{units:l.units,weight:l.weight}]).reduce((a,d)=>a+(d.weight||0),0);const softEntries=(State.DB.stageEntries||[]).filter(e=>seMatch(e,l)&&e.stage==='Soft'&&e.status==='Approved');const _lotSum=_getLotSummary(l.id,l.grade,l.vendor);
const softOutKg=_lotSum?.softOut?.kg??softEntries.reduce((a,e)=>a+(e.outWeight||0),0);
const softOutU=_lotSum?.softOut?.units??softEntries.reduce((a,e)=>a+(e.outUnits||0),0);const today=new Date();const lotDate=l.date?new Date(l.date):null;const daysAtRM=lotDate?Math.floor((today-lotDate)/86400000):null;const lastSoftEnd=_lotSum?.lastSoftEndTime||(softEntries.length?softEntries.reduce((a,e)=>e.endTime>a?e.endTime:a,''):null);const daysAtSoft=lastSoftEnd&&sfWt>0?Math.floor((today-new Date(lastSoftEnd))/86400000):null;const linkedDye=(State.DB.dyeLots||[]).filter(d=>(d.status==='Approved'||d.status==='Edited-Approved')&&(d.sources||[]).some(s=>s.lotId===l.id&&s.grade===l.grade&&s.vendor===l.vendor));const lastDyeEnd=_lotSum?.lastDyeEndTime||(linkedDye.length?linkedDye.reduce((a,d)=>d.endTime>a?d.endTime:a,''):null);const daysAtDye=lastDyeEnd&&sentDye>0?Math.floor((today-new Date(lastDyeEnd))/86400000):null;const isComplete=linkedDye.length>0&&sfBal.units===0&&rmBal.units===0;const _sdPend2=(State.DB.dyeLots||[]).filter(d=>(d.status==='Pending'||d.status==='InProgress')&&(d.sources||[]).some(s=>s.lotId===l.id&&s.grade===l.grade&&s.vendor===l.vendor)).reduce((a,d)=>{const src=(d.sources||[]).find(s=>s.lotId===l.id);return a+(src?src.weight||0:0);},0);const _sdTotal=sentDye+_sdPend2;const lotSt=l.status==='Voided'?'Voided':isComplete?'Completed':_sdTotal>0&&sfBal.weight===0?'At Dye':sfBal.weight>0&&_sdTotal===0?'At Soft':sfBal.weight>0?'At Soft':'At RM';const stC={'At RM':'var(--mu)','At Soft':'var(--cs)','At Dye':'var(--cd)','Completed':'var(--gr)','Voided':'var(--re)'}[lotSt];if(fs&&lotSt!==fs)return'';return`<tr><td class="mono" style="color:var(--ac);font-weight:700;cursor:pointer" onclick="nav('lifecycle',document.getElementById('ni-lifecycle'));document.getElementById('lc-select').value='${l.id}';renderLifecycle()">${l.id}</td><td><span class="badge b-rm">${l.grade}</span></td><td style="font-size:0.78rem">${l.vendor}</td><td class="mono" style="color:var(--ac);font-weight:700">${totalInU}b / ${fmt(totalInKg)}kg</td><td class="mono">${rmBal.units}b / ${fmt(rmBal.weight)}kg${(()=>{const _rmAvail=getStageBalanceAvailable(l.id,'Soft',l.grade,l.vendor);const _hasWip=Math.abs(_rmAvail.weight-rmBal.weight)>0.01;return _hasWip&&rmBal.weight>0?'<div style="font-size:0.62rem;color:var(--ye)">Avail: '+_rmAvail.units+'b / '+fmt(_rmAvail.weight)+'kg</div>':'';})()}</td><td class="mono" style="color:${softOutU>totalInU?'var(--re)':softOutKg>0?'var(--cs)':'var(--mu)'}">${softOutU>totalInU?'⚠ ':' '}${softOutU}b / ${fmt(softOutKg)}kg</td><td class="mono" style="color:${(()=>{const si=getSoftIn(l.id,l.grade,l.vendor);const so=getSoftOut(l.id,l.grade,l.vendor);const wU=si.units-so.units;const wKg=si.weight-so.weight;if(wU<0||wKg<0) return 'var(--re)';return 'var(--ye)';})()}">${(()=>{const _sw=_lotSum?.softWaste||null;const wU=_sw?_sw.units:(getSoftIn(l.id,l.grade,l.vendor).units-getSoftOut(l.id,l.grade,l.vendor).units);const wKg=_sw?_sw.kg:(getSoftIn(l.id,l.grade,l.vendor).weight-getSoftOut(l.id,l.grade,l.vendor).weight);if(wU<0||wKg<0)return '⚠ +'+Math.abs(wU)+'b excess';return (wU>0||wKg>0)?'-'+wU+'b / -'+fmt(wKg)+'kg':'—';})()} </td><td class="mono" style="color:${sfWt>0?'var(--bl)':'var(--mu)'}">${(()=>{const _sfAvail=getSoftBalanceAvailable(l.id,l.grade,l.vendor);const _hasWip=Math.abs(_sfAvail.weight-sfWt)>0.01;return (sfBal.units>0?sfBal.units+'b / ':'')+fmt(sfWt)+'kg'+(_hasWip&&sfWt>0?'<div style="font-size:0.62rem;color:var(--ye)">Avail: '+_sfAvail.units+'b / '+fmt(_sfAvail.weight)+'kg</div>':'');})()}</td><td class="mono" style="color:${sentDye>0?'var(--cd)':'var(--mu)'}">${sentDye>0?fmt(sentDye)+'kg':'—'}</td><td>${agingBadge(daysAtRM)}</td><td>${daysAtSoft!==null?agingBadge(daysAtSoft):'<span style="color:var(--mu)">—</span>'}</td><td>${daysAtDye!==null?agingBadge(daysAtDye):'<span style="color:var(--mu)">—</span>'}</td><td><span style="font-size:0.72rem;font-weight:700;color:${stC}">${lotSt}</span></td><td style="white-space:nowrap">
        ${isSup&&l.status!=='Voided'?`<button class="btn btn-ghost btn-xs"onclick="openRMEdit('${l.id}','${l.grade}','${l.vendor}')">✏</button>`:''}${isAdmin&&l.status!=='Voided'?`<button class="btn btn-ghost btn-xs"style="color:var(--re)"onclick="openVoidRMLotCascade('${l.id}','${l.grade}','${l.vendor}')">🗑</button><button class="btn btn-ghost btn-xs"style="color:var(--ye)"title="Recalculate summary"onclick="recalcLotSummary('${l.id}','${l.grade}','${l.vendor}',this)">⟳</button>`:''}
      </td></tr>`;}).filter(Boolean).join('');}
function renderRMPanels(){const panel=document.getElementById('rm-panels');if(!panel)return;const readyForSoft=(State.DB.lots||[]).filter(l=>getRMBalance(l.id,l.grade,l.vendor).units>0);const readyForDye=(State.DB.lots||[]).filter(l=>{const sfBal=getSoftBalanceWeight(l.id,l.grade,l.vendor);return sfBal>0;});const today=new Date();const card1=`<div style="flex:1;min-width:280px;background:var(--s2);border-radius:10px;padding:14px;border-left:3px solid var(--cs)"><div style="font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:var(--cs);margin-bottom:10px">
      📥 Ready for Soft (${readyForSoft.length})
    </div>
    ${readyForSoft.length?readyForSoft.map(l=>{
      const lotDate=l.date?new Date(l.date):null;
      const days=lotDate?Math.floor((today-lotDate)/86400000):null;
      const rmBal=getRMBalance(l.id,l.grade,l.vendor);
      return `<div style="padding:8px 0;border-bottom:1px solid var(--b1)"><div style="display:flex;justify-content:space-between;align-items:center"><div><span class="mono"style="color:var(--ac);font-weight:700">${l.id}</span><span class="badge b-rm"style="margin-left:6px;font-size:0.62rem">${l.grade}</span></div><div style="text-align:right"><div style="font-size:0.78rem;font-weight:700">${rmBal.units}u/${fmt(rmBal.weight)}kg</div>${days!==null?agingBadge(days):''}</div></div><div style="font-size:0.68rem;color:var(--mu)">${l.vendor}</div></div>`;
    }).join(''):'<div style="color:var(--mu);font-size:0.75rem;padding:8px 0">All lots sent to soft ✓</div>'}
  </div>`;const card2=`<div style="flex:1;min-width:280px;background:var(--s2);border-radius:10px;padding:14px;border-left:3px solid var(--cd)"><div style="font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:var(--cd);margin-bottom:10px">
      📤 Soft Done — Waiting for Dye (${readyForDye.length})
    </div>
    ${readyForDye.length?readyForDye.map(l=>{
      const sfBal=getSoftBalanceWeight(l.id,l.grade,l.vendor);
      const softEntries=(State.DB.stageEntries||[]).filter(e=>e.lotId===l.id&&e.stage==='Soft'&&(e.status==='Approved'||e.status==='Edited-Approved'));
      const lastSoftEnd=softEntries.length?softEntries.reduce((a,e)=>e.endTime>a?e.endTime:a,''):null;
      const days=lastSoftEnd?Math.floor((today-new Date(lastSoftEnd))/86400000):null;
      return `<div style="padding:8px 0;border-bottom:1px solid var(--b1)"><div style="display:flex;justify-content:space-between;align-items:center"><div><span class="mono"style="color:var(--ac);font-weight:700">${l.id}</span><span class="badge b-rm"style="margin-left:6px;font-size:0.62rem">${l.grade}</span></div><div style="text-align:right"><div style="font-size:0.78rem;font-weight:700;color:var(--cs)">${fmt(sfBal)}kg ready</div>${days!==null?agingBadge(days):''}</div></div><div style="font-size:0.68rem;color:var(--mu)">${l.vendor}</div></div>`;
    }).join(''):'<div style="color:var(--mu);font-size:0.75rem;padding:8px 0">Nothing waiting for dye ✓</div>'}
  </div>`;panel.innerHTML=`<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:20px">${card1}${card2}</div>`;}
async function voidDyeSplit(rcId){
  const rec=(State.DB.recycleStock||[]).find(x=>x.id===rcId);if(!rec)return;
  if(!confirm(`Undo the split for ${rec.dyeLotNo||rec.dyeLotId} — this restores the full ${((rec.goodPortion||0)+(rec.weight||0)).toFixed(2)}kg to the dye lot and removes this recycle stock entry. This cannot be undone.`))return;
  const reason=prompt('Reason for undoing this split (required):');
  if(!reason||!reason.trim()){showToast('A reason is required','err');return;}
  try{
    const {ok,error,networkError}=await apiPost('/api/dye/split-void',{rcId,reason:reason.trim(),changedBy:State.currentUser?.name});
    if(networkError)throw new Error(error);
    if(!ok){showToast(error||'Could not undo split','err');return;}
    showToast('Split undone ✓ — dye lot restored');renderAll();
  }catch(e){showToast('Network error — not undone: '+e.message,'err');}
}
function renderRecycleStock(){const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';const isSup=State.currentUser?.role==='supervisor'||isAdmin;const _fRc=document.getElementById('rcf-rcno')?.value||'';const _fLot=document.getElementById('rcf-lot')?.value||'';const _fSh=document.getElementById('rcf-shade')?.value||'';const allRC=State.DB.recycleStock||[];const rcNos=[...new Set(allRC.filter(r=>(!_fLot||r.dyeLotNo===_fLot)&&(!_fSh||r.shade===_fSh)).map(r=>r.id).filter(Boolean))].sort();const dyeLots=[...new Set(allRC.filter(r=>(!_fRc||r.id===_fRc)&&(!_fSh||r.shade===_fSh)).map(r=>r.dyeLotNo).filter(Boolean))].sort();const shades_rc=[...new Set(allRC.filter(r=>(!_fRc||r.id===_fRc)&&(!_fLot||r.dyeLotNo===_fLot)).map(r=>r.shade).filter(Boolean))].sort();const _rcTh=document.getElementById('rc-thead');if(_rcTh){_rcTh.innerHTML=`
      <tr class="tbl-filter-row"><th>${buildColFilter(rcNos,'rcf-rcno','RC No')}</th><th>${buildColFilter(dyeLots,'rcf-lot','Dye Lot')}</th><th>${buildColFilter(shades_rc,'rcf-shade','Shade')}</th><th></th><th></th><th></th><th></th><th></th><th></th></tr><tr>
        ${sortTh('rcstock','id','ID')}
        ${sortTh('rcstock','dyeLotNo','Dye Lot')}
        ${sortTh('rcstock','shade','Shade')}
        <th>Source RM Lot</th>
        ${sortTh('rcstock','weight','Weight (kg)')}
        ${sortTh('rcstock','status','Status')}
        ${sortTh('rcstock','createdAt','Date')}
        <th>Added By</th><th>Actions</th></tr>`;if(_fRc)document.getElementById('rcf-rcno').value=_fRc;if(_fLot)document.getElementById('rcf-lot').value=_fLot;if(_fSh)document.getElementById('rcf-shade').value=_fSh;}
const _rcF=(State.DB.recycleStock||[]).filter(r=>(!_fRc||r.id===_fRc)&&(!_fLot||r.dyeLotNo===_fLot)&&(!_fSh||r.shade===_fSh));const entries=_sortState.rcstock?.col?sortArr(_rcF,_sortState.rcstock.col,_sortState.rcstock.dir):[..._rcF].sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));const tbody=document.getElementById('rc-tbody');if(!tbody)return;if(!entries.length){tbody.innerHTML=`<tr><td colspan="8"><div class="empty"><div class="empty-icon">♻</div><div class="empty-text">✕ No recycle stock yet — created automatically when dye lots are split</div></div></td></tr>`;return;}
tbody.innerHTML=entries.map(r=>{const bal=getRecycleBalance(r.id);const rcSt=getRCStatus(r.id);const stColor=rcSt.available?'var(--gr)':rcSt.status==='Consumed'?'var(--mu)':'var(--ye)';const consumed=bal<=0;return`<tr style="${consumed||r.status==='Voided'?'opacity:0.6':''}"><td class="mono" style="color:var(--ac);font-weight:700">${r.id}</td><td class="mono" style="color:var(--ac)">${r.dyeLotNo||'—'}</td><td style="font-size:0.78rem">${r.shade||'—'}</td><td class="mono">${fmt(r.weight)}kg total</td><td class="mono" style="color:${bal>0?'var(--tx)':'var(--mu);text-decoration:line-through'}">${r.status==='Voided'?'<span class="badge b-void">Voided</span>':fmt(bal)+'kg left'}</td><td><span style="font-size:0.7rem;font-weight:700;color:${stColor}">${r.status==='Voided'?'Split Undone':rcSt.status}</span></td><td style="font-size:0.68rem;color:var(--mu);max-width:140px;overflow:hidden;text-overflow:ellipsis">${r.reason||'—'}</td><td style="white-space:nowrap">
        ${r.markedAt?fmtTS(r.markedAt):'—'}</td><td style="font-size:0.7rem;color:var(--mu)">${r.markedBy||'—'}</td><td style="white-space:nowrap">${r.status==='Voided'?'':`${!consumed&&isAdmin?`<button class="btn btn-danger btn-xs"onclick="openScrapModal('${r.id}','recycle')">Scrap</button>`:''}
        ${isAdmin?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Undo Split" style="color:var(--re)" onclick="voidDyeSplit('${r.id}')">↩</button>`:''}
        ${consumed?'<span style="font-size:0.68rem;color:var(--mu)">Consumed</span>':''}`}
      </td></tr>`;}).join('');const sumEl=document.getElementById('rc-summary');if(sumEl){const total=(State.DB.recycleStock||[]).length;const available=(State.DB.recycleStock||[]).filter(r=>getRCStatus(r.id).available&&getRecycleBalance(r.id)>0).length;const atWind=(State.DB.recycleStock||[]).filter(r=>getRCStatus(r.id).status.includes('Wind')).length;const consumed=(State.DB.recycleStock||[]).filter(r=>getRecycleBalance(r.id)<=0).length;const totalOffWt=(State.DB.recycleStock||[]).reduce((a,r)=>a+r.weight,0);const availWt=(State.DB.recycleStock||[]).reduce((a,r)=>{const s=getRCStatus(r.id);return s.available?a+getRecycleBalance(r.id):a;},0);sumEl.innerHTML=`
      <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:0.78rem;"><div style="padding:8px 14px;background:var(--s2);border-radius:8px;border-left:3px solid var(--ac)"><div style="font-size:1.1rem;font-weight:800;color:var(--ac)">${total}</div><div style="color:var(--mu)">Total RC entries</div></div><div style="padding:8px 14px;background:var(--s2);border-radius:8px;border-left:3px solid var(--gr)"><div style="font-size:1.1rem;font-weight:800;color:var(--gr)">${available}</div><div style="color:var(--mu)">Available for Dye (${fmt(availWt)}kg)</div></div><div style="padding:8px 14px;background:var(--s2);border-radius:8px;border-left:3px solid var(--ye)"><div style="font-size:1.1rem;font-weight:800;color:var(--ye)">${atWind}</div><div style="color:var(--mu)">At Wind/Soft stage</div></div><div style="padding:8px 14px;background:var(--s2);border-radius:8px;border-left:3px solid var(--mu)"><div style="font-size:1.1rem;font-weight:800;color:var(--mu)">${consumed}</div><div style="color:var(--mu)">Consumed</div></div></div>`;}}
function renderWindTable(){const _focusCap=_captureFilterFocus('windf-');const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';const isSup=State.currentUser?.role==='supervisor'||isAdmin;const _fLot=document.getElementById('windf-lot')?.value||'';const _fGrade=document.getElementById('windf-grade')?.value||'';const _fShade=document.getElementById('windf-shade')?.value||'';const _fStatus=document.getElementById('windf-status')?.value||'';const allWind=State.DB.windEntries||[];const lots=[...new Set(allWind.filter(e=>(!_fShade||e.shade===_fShade)&&(!_fStatus||e.status===_fStatus)).map(e=>e.dyeLotNo).filter(Boolean))].sort((a,b)=>b.localeCompare(a));const grades_w=[...new Set(allWind.filter(e=>(!_fLot||(e.dyeLotNo||'').includes(_fLot))&&(!_fStatus||e.status===_fStatus)).map(e=>e.grade).filter(Boolean))].sort();const shades_w=[...new Set(allWind.filter(e=>(!_fLot||(e.dyeLotNo||'').includes(_fLot))&&(!_fStatus||e.status===_fStatus)).map(e=>e.shade).filter(Boolean))].sort();const statuses=[...new Set(allWind.filter(e=>(!_fLot||(e.dyeLotNo||'').includes(_fLot))&&(!_fShade||e.shade===_fShade)).map(e=>e.status).filter(Boolean))].sort();const _wTh=document.getElementById('wind-thead');if(_wTh){_wTh.innerHTML=`
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
        <th>Actions</th></tr>`;if(_fLot)document.getElementById('windf-lot').value=_fLot;if(_fGrade)document.getElementById('windf-grade').value=_fGrade;if(_fShade)document.getElementById('windf-shade').value=_fShade;if(_fStatus)document.getElementById('windf-status').value=_fStatus;_restoreFilterBtns('windf-lot','windf-grade','windf-shade','windf-status');_restoreFilterFocus(_focusCap);}
setTimeout(()=>_updateClearBtn('windf-'),0);const _windBase=(State.DB.windEntries||[]).filter(e=>(!_fLot||(e.dyeLotNo||'').includes(_fLot))&&(!_fGrade||e.grade===_fGrade)&&(!_fStatus||e.status===_fStatus)&&(!_fShade||e.shade===_fShade)).map(e=>({...e,_daysActive:e.startTime?Math.floor((new Date()-new Date(e.startTime))/86400000):999}));const entries=_sortState.wind?.col?sortArr(_windBase,_sortState.wind.col,_sortState.wind.dir):[..._windBase].sort((a,b)=>(b.startTime||'').localeCompare(a.startTime||''));const canAct=State.currentUser?.role==='admin'||State.currentUser?.role==='manager'||State.currentUser?.role==='supervisor';document.getElementById('wind-tbody').innerHTML=entries.map(e=>{const waste=e.outWeight!=null?Math.max(0,e.inWeight-e.outWeight):null;const _windDays=e.status==='Approved'&&e.approvedAt?Math.floor((new Date()-new Date(e.approvedAt))/86400000):null;const _windDyeStage=getDyeLotCurrentStage(e.dyeLotId);const _windStageC={'At Dye':'var(--cd)','At Wind':'var(--cw)','At Pack':'var(--cp)','Completed':'var(--gr)'}[_windDyeStage]||'var(--mu)';const _windWastePct=e.inWeight>0?parseFloat(pct(Math.max(0,(e.inWeight||0)-(e.outWeight||0)),e.inWeight)):0;
const _windBadge=statusBadge(e.status)+(e.status==='Approved'?`<div style="font-size:0.6rem;color:${_windStageC};margin-top:2px">${_windDyeStage}</div>`:'');return`<tr class="${entryRowClass(e.status)}"><td class="mono" style="vertical-align:top;color:var(--ac);font-weight:700;cursor:pointer" onclick="openDyeLifecycle('${e.dyeLotId||''}')"><span>${e.dyeLotNo||'—'}</span>${e.recycleId?`<div style="font-size:0.62rem;color:var(--gr);font-weight:400">♻ ${e.recycleId}</div>`:''}</td><td style="vertical-align:top">${e.grade?'<span class="badge b-rm">'+e.grade+'</span>':'—'}</td><td style="vertical-align:top;font-size:0.75rem;font-weight:600">${e.shade||'—'}</td><td style="vertical-align:top" class="mono">${qtyCell(e.inCones,e.inWeight,'c')}</td><td style="vertical-align:top" class="mono">${e.outCones||e.outWeight?(e.outCones||'—')+'c'+(e.outWeight?' / '+fmt(e.outWeight)+'kg':''):'—'}</td>${wasteCell(e.wasteCones,e.wasteWeight!=null?e.wasteWeight:waste,_windWastePct,'c')}${wastePctCell(e.inWeight>0&&(e.wasteCones!=null||waste!=null)?pct(Math.max(0,(e.inWeight||0)-(e.outWeight||0)),e.inWeight||1):'—')}<td style="vertical-align:top">${agingBadge(_windDays)}</td>${mwCell(e.machine)}${mwCell(e.startWorker)}<td style="vertical-align:top;font-size:0.68rem;color:var(--mu)">${fmtTS(e.startTime)}</td><td style="vertical-align:top;font-size:0.68rem;color:var(--mu)">${e.endTime?fmtTS(e.endTime):'—'}</td><td style="vertical-align:top">${_windBadge}</td><td style="vertical-align:top;white-space:nowrap">
        ${(e.status==='Pending'||e.status==='Edited-Pending')&&isSup?`<button class="btn btn-success btn-xs tc-tip" data-tip="Approve" onclick="approveWindEntry('${e.id}')">✓</button><button class="btn btn-danger btn-xs tc-tip" data-tip="Reject" onclick="rejectWindEntry('${e.id}')">✗</button>`:''}
        ${(e.status==='Approved'||e.status==='Edited-Approved')&&isAdmin?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Edit" onclick="openEditEntryModal('${e.id}','wind')">✏</button><button class="btn btn-ghost btn-xs tc-tip" data-tip="Void" style="color:var(--re)" onclick="openVoidModal('${e.id}','wind')">🗑</button>`:''}
        ${(e.status==='Rejected'||e.status==='Voided')&&isAdmin?`<button class="btn btn-success btn-xs"onclick="openOverride('${e.id}','wind')">↩ Override</button><button class="btn btn-ghost btn-xs tc-tip" data-tip="Void" style="color:var(--re)" onclick="openVoidModal('${e.id}','wind')">🗑</button>`:''}
      </td></tr>`;}).join('')||'<tr><td colspan="17"><div class="empty"><div class="empty-icon">🌀</div><div class="empty-text">✕ No wind entries yet — select a dye lot to begin</div></div></td></tr>';setTimeout(fitBevTableHeight,0);}
async function saveDyeLotStartingNo(){const val=document.getElementById('dye-lot-start-input')?.value.trim();if(!val){showToast('Enter a starting number','err');return;}
const fy=currentFY();try{const {ok,error,networkError}=await apiPost('/api/masters/setting',{action:'dyeLotStartingNo',startingNo:val,fy,role:State.currentUser?.role});if(networkError)throw new Error(error);if(!ok){showToast(error||'Could not save','err');return;}showToast(`Dye Lot starting number set to ${val} ✓`);renderMasters();}catch(e){showToast('Network error — '+e.message,'err');}}

async function submitDeadStock(){const setAlert=msg=>{document.getElementById('ds-alert').innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;};const type=document.getElementById('ds-type').value;const grade=document.getElementById('ds-grade').value;const weight=parseFloat(document.getElementById('ds-weight').value)||0;const note=document.getElementById('ds-note').value.trim();if(!type){setAlert('Select cone type');return;}
if(!grade){setAlert('Select grade');return;}
if(weight<=0){setAlert('Enter weight');return;}
try{
  const {ok,data,error,networkError}=await apiPost('/api/dead-stock/create',{type,grade,weight,note,changedBy:State.currentUser.name});
  if(networkError)throw new Error(error);
  if(!ok){setAlert(error||'Could not save');return;}
  closeModal('deadstock-modal-overlay');showToast('Dead stock entry added ✓');renderAll();
}catch(e){setAlert('Network error — not saved: '+e.message);}
}
function dyeEndIOCheck(){const entryId=document.getElementById('dye-end-entry-select').value;
// Jul 26 2026 — the dyeEntries fallback (kept until today "for
// consistency" with a sibling function) removed entirely. Confirmed
// against a real production export: dyeEntries is genuinely empty, so
// dyeLots alone is the complete, correct source here.
const entry=(State.DB.dyeLots||[]).find(e=>e.id===entryId&&e.status==='InProgress');if(!entry)return;const outCones=parseInt(document.getElementById('dye-end-out-cones')?.value)||0;const outWeight=parseFloat(document.getElementById('dye-end-out-weight')?.value)||0;const ioEl=document.getElementById('dye-end-io-check');if(!ioEl)return;const inCones=entry.totalInCones||0;const inKg=entry.totalInWeight||0;let html='<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">';if(outCones>0&&inCones>0){const coneDiff=inCones-outCones;if(outCones>inCones){html+='<div style="color:var(--re);font-weight:700">❌ Cones: '+outCones+' > '+inCones+' input — BLOCKED</div>';}else if(coneDiff>0){html+='<div style="color:var(--re)">⚠ Cone loss: '+coneDiff+' cones ('+inCones+'→'+outCones+')</div>';}else{html+='<div style="color:var(--gr)">✅ Cones: '+outCones+' = '+inCones+' (no loss)</div>';}}
if(outWeight>0&&inKg>0){const diff=outWeight-inKg;if(diff>0.01){html+='<div style="color:var(--re);font-weight:700">❌ Weight: '+fmt(outWeight)+'kg > '+fmt(inKg)+'kg input — BLOCKED</div>';}else{const loss=inKg-outWeight;const lossPct=(loss/inKg*100);html+='<div style="color:var(--gr)">✅ Weight OK: '+fmt(outWeight)+'kg out (loss: -'+fmt(loss)+'kg / -'+lossPct.toFixed(1)+'%)</div>';}}
html+='</div>';ioEl.innerHTML=html||'Enter output values to see IO check';ioEl.style.background='var(--s2)';}
async function submitDyeEndNew(){
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
    const {ok,data,error,networkError}=await apiPost('/api/dye/end',{entryId,fy:_fy,serial:_serial,sub:_sub,shade,outCones,outWeight,notes,changedBy:State.currentUser.name,idempotencyKey:crypto.randomUUID()});
  if(networkError)throw new Error(error);
  if(!ok){setAlert(error||'Failed to end dye batch');if(_btn)_btn.disabled=false;return;}
    if(_btn)_btn.disabled=false;closeModal('dye-end-modal-overlay');showToast('Dye Lot '+data.dyeLotNo+' created \u2014 pending approval \u2713');if(data.coneLoss>0)showToast('\u2139 Cone loss: '+data.coneLoss+' cones','info');
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

async function submitDyeSplit(){
const setAlert=msg=>{document.getElementById('dyesplit-alert').innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;};
const dyeLotId=document.getElementById('dyesplit-lot-id')?.value;
const good=parseFloat(document.getElementById('dyesplit-good')?.value)||0;
const off=parseFloat(document.getElementById('dyesplit-off')?.value)||0;
const reason=document.getElementById('dyesplit-reason')?.value.trim()||'';
if(!dyeLotId){setAlert('No dye lot selected — close and reopen');return;}
try{
  const {ok,data,error,networkError}=await apiPost('/api/dye/split',{dyeLotId,good,off,reason,changedBy:State.currentUser?.name,role:State.currentUser?.role});
  if(networkError)throw new Error(error);
  if(!ok){setAlert(error||'Split failed');return;}
  closeModal('dyesplit-modal-overlay');
  showToast(data.rcId+' created — '+fmt(off)+'kg off material tracked ✓');
  renderAll();
}catch(e){setAlert('Network error — '+e.message);}
}
async function submitDyeStartNew(){
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
    sources.push({deadStockId:dsId,weight:w,sourceType:'dead'});});
  document.querySelectorAll('#dye-recycle-list > div').forEach(row=>{const rcSel=row.querySelector('select');const wIn=row.querySelector('input[data-field="weight"]');if(!rcSel?.value||!wIn?.value)return;const rcId=rcSel.value;const w=parseFloat(wIn.value)||0;if(w<=0){setAlert('Recycle weight must be > 0');vFail=true;return;}
    sources.push({recycleId:rcId,weight:w,sourceType:'recycle'});});
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
      if(_btn)_btn.disabled=false;closeModal('dye-start-modal-overlay');showToast('Dye started ✓ — End dye to complete Dye Lot');renderAll();
    }catch(e){setAlert('Network error — not saved: '+e.message);if(_btn)_btn.disabled=false;}
  };
  await _doSubmit(false);
}

async function submitEditEntry(){
  // Jul 14 2026 — Item D cutover. All validation, downstream-consistency
  // checks, and the write now live in worker.js (POST /api/edit-entry),
  // committed atomically. This function just reads the form per stage and
  // sends the raw new values to the server.
  const setAlert=msg=>{document.getElementById('edit-entry-alert').innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;};
  const id=document.getElementById('edit-entry-id').value;const stage=document.getElementById('edit-entry-stage').value;const reasonCat=document.getElementById('edit-reason-cat').value;const reasonText=document.getElementById('edit-reason-text').value.trim();const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';
  if(!reasonCat){setAlert('Select reason category');return;}
  if(reasonText.length<10){setAlert('Reason must be at least 10 characters');return;}
  if(!isAdmin){const pwd=document.getElementById('edit-pwd').value;const matched=await _verifyPasswordViaWorker(pwd,State.currentUser.username);
    if(!matched){setAlert('Incorrect password');return;}}
  const body={id,stage,reasonCat,reasonText,isAdmin,changedBy:State.currentUser.name};
  if(stage==='soft'){
    body.inUnits=parseFloat(document.getElementById('ef-in-units')?.value)||undefined;
    body.inWeight=parseFloat(document.getElementById('ef-in-weight-soft')?.value)||undefined;
    body.outUnits=parseFloat(document.getElementById('ef-out-units')?.value)||0;
    body.outWeight=parseFloat(document.getElementById('ef-out-weight')?.value)||0;
    body.startNote=document.getElementById('ef-start-note')?.value||'';
    body.endNote=document.getElementById('ef-end-note')?.value||'';
  }else if(stage==='wind'){
    body.inCones=parseInt(document.getElementById('ef-in-cones-wind')?.value)||undefined;
    body.inWeight=parseFloat(document.getElementById('ef-in-weight')?.value)||0;
    body.outCones=parseInt(document.getElementById('ef-out-cones-wind')?.value)||undefined;
    body.outWeight=parseFloat(document.getElementById('ef-out-weight')?.value)||0;
  }else if(stage==='pack'){
    body.inCones=parseInt(document.getElementById('ef-in-cones-pack')?.value)||undefined;
    body.bags=parseInt(document.getElementById('ef-bags')?.value)||0;
    body.weight=parseFloat(document.getElementById('ef-weight')?.value)||0;
  }else if(stage==='dye'){
    body.dyeLotNo=document.getElementById('ef-dye-lot-no')?.value.trim();
    body.shade=document.getElementById('ef-shade')?.value.trim();
    body.machine=document.getElementById('ef-machine')?.value.trim();
    body.inCones=parseInt(document.getElementById('ef-in-cones')?.value)||undefined;
    body.inWeight=parseFloat(document.getElementById('ef-in-weight')?.value)||undefined;
    body.outCones=parseInt(document.getElementById('ef-out-cones')?.value)||undefined;
    body.outWeight=parseFloat(document.getElementById('ef-out-weight')?.value)||undefined;
    body.notes=document.getElementById('ef-notes')?.value||'';
  }else if(stage==='dispatch'){
    body.bags=parseInt(document.getElementById('ef-bags')?.value)||0;
    body.weight=parseFloat(document.getElementById('ef-weight')?.value)||0;
    body.party=document.getElementById('ef-party')?.value;
    body.invoiceNo=document.getElementById('ef-invoice')?.value||'';
  }
  const _btn=document.getElementById('edit-entry-submit-btn');if(_btn)_btn.disabled=true;
  try{
    const {ok,data,error,networkError}=await apiPost('/api/edit-entry',body);
  if(networkError)throw new Error(error);
  if(!ok){setAlert(error||'Edit failed');if(_btn)_btn.disabled=false;return;}
    closeModal('edit-entry-modal-overlay');showToast('Entry updated \u2713 — edit logged');if(data.imbalanceNote)showToast('\u26a0 '+data.imbalanceNote,'err');renderAll();
  }catch(e){setAlert('Network error \u2014 edit not saved: '+e.message);if(_btn)_btn.disabled=false;}
}

function showWindEndRef(){const entryId=document.getElementById('wind-entry-select')?.value;const ref=document.getElementById('wind-end-ref');if(!entryId){if(ref)ref.style.display='none';return;}
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
function packGainCheck(){const id=document.getElementById('pack-dye-lot-select')?.value;const inKgPack=parseFloat(document.getElementById('pack-in-weight')?.value)||0;const outKg=parseFloat(document.getElementById('pack-weight')?.value)||0;const el=document.getElementById('pack-gain-display');if(!el)return;if(!id||!outKg){el.style.display='none';return;}
const _wBal=getWindBal(id);const inKg=_wBal.weight||0;if(!inKg){el.style.display='none';return;}
const gainKg=parseFloat((outKg-inKgPack).toFixed(2));const gainPct=inKgPack>0?(gainKg/inKgPack*100):0;el.style.display='block';if(gainKg>0.01){el.style.background='rgba(74,222,128,0.08)';el.innerHTML=`<span style="color:var(--gr);font-weight:700">📈 Gain: +${fmt(gainKg)}kg / +${gainPct.toFixed(1)}%</span> <span style="color:var(--mu);font-size:0.7rem">(Wind: ${fmt(inKg)}kg → Pack: ${fmt(outKg)}kg)</span>`;}else if(gainKg<-0.01){el.style.background='rgba(248,113,113,0.08)';el.innerHTML=`<span style="color:var(--re);font-weight:700">📉 Loss: ${fmt(gainKg)}kg / ${gainPct.toFixed(1)}%</span> <span style="color:var(--mu);font-size:0.7rem">(Wind: ${fmt(inKg)}kg → Pack: ${fmt(outKg)}kg)</span>`;}else{el.style.background='';el.innerHTML=`<span style="color:var(--gr)">✅ No gain/loss (${fmt(outKg)}kg)</span>`;}}
// Jul 26 2026 — shared helper for the content-based duplicate-warning
// flow (confirmed design: exact match, 15-day window, warn never block).
// Used by every Start/Submit call site across Soft, Wind, and Pack so the
// confirm-and-resubmit logic stays identical everywhere rather than
// copy-pasted six times with six chances to drift apart.
async function _postWithDuplicateCheck(endpoint, payload){
  const r1=await apiPost(endpoint,payload);
  if(r1.networkError||r1.ok)return r1;
  if(r1.data&&r1.data.duplicateWarning){
    if(confirm(r1.data.message+'\n\nClick OK to proceed anyway. Click Cancel to go back and check.')){
      // Jul 29 2026 fix — real, confirmed bug: this used to resubmit with
      // the exact same idempotencyKey as the first attempt. That key had
      // already been recorded as "seen" during the first request (before
      // the content-duplicate check even ran), so the resubmission — even
      // with the user's genuine, deliberate confirmation — was getting
      // blocked by a completely separate mechanism (the accidental-
      // double-click guard), which has no awareness of what was just
      // confirmed. A fresh key here means the confirmed resubmission is
      // correctly treated as the new, deliberate action it actually is.
      return await apiPost(endpoint,{...payload,confirmDuplicate:true,idempotencyKey:crypto.randomUUID()});
    }
    return {ok:false,data:r1.data,error:'__cancelled_by_user__',networkError:false};
  }
  return r1;
}
async function submitPack(){
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

async function submitScrap(){const setAlert=msg=>{document.getElementById('scrap-alert').innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;};const id=document.getElementById('scrap-entry-id').value;const type=document.getElementById('scrap-entry-type').value;const weight=parseFloat(document.getElementById('scrap-weight').value)||0;const reason=document.getElementById('scrap-reason').value.trim();if(weight<=0){setAlert('Enter weight to scrap');return;}
if(reason.length<10){setAlert('Reason must be at least 10 characters');return;}
try{
  const {ok,data,error,networkError}=await apiPost('/api/scrap',{id,type,weight,reason,changedBy:State.currentUser.name});
  if(networkError)throw new Error(error);
  if(!ok){setAlert(error||'Could not record scrap');return;}
  closeModal('scrap-modal-overlay');showToast('Scrap recorded ✓');renderAll();
}catch(e){setAlert('Network error — not saved: '+e.message);}
}
async function submitVoid2(){const setAlert=msg=>{document.getElementById('void2-alert').innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;};const reasonCat=document.getElementById('void2-reason-cat').value;const reasonText=document.getElementById('void2-reason-text').value.trim();if(!reasonCat){setAlert('Select void reason category');return;}
if(reasonText.length<10){setAlert('Reason must be at least 10 characters');return;}
const chainEl=document.getElementById('void2-chain');const nodes=chainEl?._voidNodes||[];const selected=nodes.filter((n,idx)=>{const cb=document.getElementById('vchain-'+idx);return cb&&cb.checked&&!cb.disabled;});if(!selected.length){setAlert('Select at least one entry to void');return;}
const allNonVoided=nodes.filter(n=>n.status!=='Voided');const unselected=allNonVoided.filter((n,idx)=>{const cb=document.getElementById('vchain-'+idx);return cb&&!cb.checked&&!cb.disabled;});if(unselected.length>0){const msg=`You are voiding ${selected.length} entries but leaving ${unselected.length} downstream entries active:\n`
+unselected.map(n=>`  • ${n.label}`).join('\n')
+`\n\nThose entries will keep their current data but balances may be inconsistent.\nProceed anyway?`;if(!confirm(msg))return;}
try{
  const {ok,data,error,networkError}=await apiPost('/api/void-chain',{selected:selected.map(n=>({id:n.id,stage:n.stage})),reasonCat,reasonText,changedBy:State.currentUser.name});
  if(networkError)throw new Error(error);
  if(!ok){setAlert(error||'Could not void entries');return;}
  closeModal('void2-modal-overlay');showToast(`${data.voidCount} ${data.voidCount===1?'entry':'entries'} voided ✓`,'warn');renderAll();
}catch(e){setAlert('Network error — not saved: '+e.message);}
}
function submitVoidEntry(){
  // Jul 14 2026 — Item B cutover. The cascade-scoping logic (which dye
  // lots/wind/pack/dispatch entries get voided) and the actual write now
  // live in worker.js (POST /api/void), strict-matched and committed
  // atomically. This function keeps the preview confirm() dialogs (still
  // useful, read-only, local data is fine for a preview) but the actual
  // execution is a single server call, not a client-side cascade.
  const setAlert=msg=>{document.getElementById('void-entry-alert').innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;};
  if(!State.currentUser||(State.currentUser.role!=='admin'&&State.currentUser.role!=='manager'&&State.currentUser.role!=='supervisor')){setAlert('Supervisor or Admin only');return;}
  const reasonCat=document.getElementById('void-reason-cat').value;const reason=document.getElementById('void-reason-text').value.trim();
  const pwd=document.getElementById('void-entry-pwd').value;
  if(!reasonCat){setAlert('Select void reason category');return;}
  if(reason.length<10){setAlert('Reason must be at least 10 characters');return;}
  if(!pwd){setAlert('Enter your password to confirm');return;}
  const id=State._voidEntryId,type=State._voidEntryType;
  // Preview only — local data, strict matching, matches what the server will
  // actually do. Purely informational; the server re-derives this fresh.
  if(type==='soft'){
    const e=(State.DB.stageEntries||[]).find(x=>x.id===id);if(!e)return;
    const _dyeLots=(State.DB.dyeLots||[]).filter(d=>d.status!=='Voided'&&(d.sources||[]).some(s=>s.lotId===e.lotId&&s.grade===e.grade&&s.vendor===e.vendor));
    const _dyeIds=_dyeLots.map(d=>d.id);
    const _vWind=(State.DB.windEntries||[]).filter(w=>_dyeIds.includes(w.dyeLotId)&&w.status!=='Voided');
    const _vPack=(State.DB.packEntries||[]).filter(p=>_dyeIds.includes(p.dyeLotId)&&p.status!=='Voided');
    const _vDisp=(State.DB.dispatches||[]).filter(d=>_dyeIds.includes(d.dyeLotId)&&d.status!=='Voided');
    if(_dyeLots.length||_vWind.length||_vPack.length||_vDisp.length){
      const _sm='Voiding Soft entry '+e.id+' will cascade:\n'
        +(_dyeLots.length?'  '+_dyeLots.length+' Dye lots: '+_dyeLots.map(d=>d.dyeLotNo).join(', ')+'\n':'')
        +(_vWind.length?'  '+_vWind.length+' Wind entries\n':'')
        +(_vPack.length?'  '+_vPack.length+' Pack entries\n':'')
        +(_vDisp.length?'  '+_vDisp.length+' Dispatches (already sent!)\n':'')
        +'Proceed?';
      if(!confirm(_sm)){closeModal('void-entry-modal-overlay');return;}
    }
  }else if(type==='dye'){
    const d=(State.DB.dyeLots||[]).find(x=>x.id===id);
    const _vWind=(State.DB.windEntries||[]).filter(e=>e.dyeLotId===id&&e.status!=='Voided');
    const _vPack=(State.DB.packEntries||[]).filter(e=>e.dyeLotId===id&&e.status!=='Voided');
    const _vDisp=(State.DB.dispatches||[]).filter(e=>e.dyeLotId===id&&e.status!=='Voided');
    if(_vWind.length||_vPack.length||_vDisp.length){
      const _vm='Voiding dye lot '+(d?d.dyeLotNo:id)+' will cascade:\n'
        +(_vWind.length?'  '+_vWind.length+' Wind entries\n':'')
        +(_vPack.length?'  '+_vPack.length+' Pack entries\n':'')
        +(_vDisp.length?'  '+_vDisp.length+' Dispatches (already sent!)\n':'')
        +'Proceed?';
      if(!confirm(_vm)){closeModal('void-entry-modal-overlay');return;}
    }
  }else if(type==='wind'){
    const e=(State.DB.windEntries||[]).find(x=>x.id===id);if(!e)return;
    const _vPack=(State.DB.packEntries||[]).filter(p=>p.dyeLotId===e.dyeLotId&&p.status!=='Voided');
    const _vDisp=(State.DB.dispatches||[]).filter(d=>d.dyeLotId===e.dyeLotId&&d.status!=='Voided');
    if(_vPack.length||_vDisp.length){
      const _wm='Voiding Wind entry '+id+' will cascade:\n'
        +(_vPack.length?'  '+_vPack.length+' Pack entries\n':'')
        +(_vDisp.length?'  '+_vDisp.length+' Dispatches (already sent!)\n':'')
        +'Proceed?';
      if(!confirm(_wm)){closeModal('void-entry-modal-overlay');return;}
    }
  }else if(type==='pack'){
    const e=(State.DB.packEntries||[]).find(x=>x.id===id);if(!e)return;
    const _vDisp=(State.DB.dispatches||[]).filter(d=>d.dyeLotId===e.dyeLotId&&d.status!=='Voided');
    if(_vDisp.length){if(!confirm('Voiding Pack entry '+id+' will also void '+_vDisp.length+' Dispatch(es). Proceed?')){closeModal('void-entry-modal-overlay');return;}}
  }
  _executeVoidOnServer(id,type,reasonCat,reason,pwd);
}
async function _executeVoidOnServer(id,type,reasonCat,reason,pwd){
  const setAlert=msg=>{document.getElementById('void-entry-alert').innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;};
  const _btn=document.getElementById('void-entry-submit-btn');if(_btn)_btn.disabled=true;
  try{
    const {ok,data,error,networkError}=await apiPost('/api/void',{id,type,reasonCat,reason,password:pwd,username:State.currentUser.username,changedBy:State.currentUser.name,role:State.currentUser.role});
  if(networkError)throw new Error(error);
  if(!ok){setAlert(error||'Void failed');if(_btn)_btn.disabled=false;return;}
    closeModal('void-entry-modal-overlay');showToast(`Entry voided \u2713${data.voidedCount>1?' ('+data.voidedCount+' records, cascade)':''}`);renderAll();
  }catch(e){setAlert('Network error \u2014 void not saved: '+e.message);if(_btn)_btn.disabled=false;}
}
async function submitWind(){
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
      const {ok,data,error,networkError}=await _postWithDuplicateCheck('/api/wind/start',{dyeLotId,inCones,inWeight,machine,worker,notes,recycleId:document.getElementById('wind-rc-select')?.value||null,changedBy:State.currentUser.name,idempotencyKey:crypto.randomUUID()});
  if(networkError)throw new Error(error);
  if(!ok){if(error!=='__cancelled_by_user__')setAlert(error||'Failed to start wind entry');if(_btn)_btn.disabled=false;return;}
      if(_btn)_btn.disabled=false;closeModal('wind-modal-overlay');showToast('Wind started \u2713');renderAll();
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
      if(_btn2)_btn2.disabled=false;closeModal('wind-modal-overlay');showToast('Wind ended \u2713 \u2014 pending approval');renderAll();
    }catch(e){setAlert('Network error \u2014 not saved: '+e.message);if(_btn2)_btn2.disabled=false;}
  }
}

function switchApprTab(tab){State._apprTab=tab;['soft','dye','wind','pack','dispatch'].forEach(t=>{const panel=document.getElementById('appr-panel-'+t);if(panel){panel.style.display=t===tab?'':'none';panel.style.height=t===tab?'':'0';panel.style.overflow=t===tab?'':'hidden';}
const btn=document.getElementById('appr-tab-'+t);if(btn){btn.classList.toggle('active-appr-tab',t===tab);}});renderApprovalTab(tab);}
function switchStockTab(tab){State._stockTab=tab;const rmPanel=document.getElementById('stock-rm-panel')||document.getElementById('stock-panel-rm');const dyePanel=document.getElementById('stock-dye-panel')||document.getElementById('stock-panel-dye');if(rmPanel)rmPanel.style.display=tab==='rm'?'':'none';if(dyePanel)dyePanel.style.display=tab==='dye'?'':'none';const rmBtn=document.getElementById('stock-tab-rm');const dyeBtn=document.getElementById('stock-tab-dye');if(rmBtn){rmBtn.classList.toggle('active',tab==='rm');}
if(dyeBtn){dyeBtn.classList.toggle('active',tab==='dye');}
if(tab==='rm')renderRMStock();else renderDyeStock();}
function switchWipTab(tab){State._wipTab=tab;['soft','dye','wind'].forEach(function(t){let panel=document.getElementById('wip-'+t+'-panel');if(panel)panel.style.display=t===tab?'':'none';let btn=document.getElementById('wip-tab-'+t);if(btn)btn.classList.toggle('appr-tab-active',t===tab);});if(tab==='soft')renderWIPSoft();else if(tab==='dye')renderWIPDye();else if(tab==='wind')renderWIPWind();}
function updateSidebarKPIs(){const counts={rm:State.DB.lots.length,dye:(State.DB.dyeLots||[]).filter(d=>d.status==='Pending').length,wind:(State.DB.windEntries||[]).filter(e=>e.status==='Pending').length,pack:(State.DB.packEntries||[]).filter(e=>e.status==='Pending').length,disp:(State.DB.dispatches||[]).filter(d=>d.status==='Pending').length,appr:(State.DB.stageEntries||[]).filter(e=>e.status==='Pending').length};const setBadge=(id,count)=>{const el=document.getElementById(id);if(!el)return;el.textContent=count>0?count:'';el.style.display=count>0?'inline-flex':'none';};setBadge('kpi-rm',counts.rm);setBadge('kpi-dye',counts.dye);setBadge('kpi-wind',counts.wind);setBadge('kpi-pack',counts.pack);setBadge('kpi-disp',counts.disp);setBadge('kpi-appr',counts.appr);}
function updateImbalanceWidget(count){const widget=document.getElementById('imbalance-widget');if(!widget)return;if(count>0){widget.style.display='';widget.innerHTML=`<div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;"><span style="font-size:0.78rem;font-weight:700;color:var(--re)">⚠ ${count} ${count===1?'entry needs':'entries need'} attention</span><button class="btn btn-ghost btn-xs" onclick="nav('approval',document.getElementById('ni-approval'))">Review →</button></div>`;}else{widget.style.display='none';}}

function wPackLotChange(){const id=document.getElementById('w-pack-lot')?.value;const info=document.getElementById('w-pack-lot-info');if(!id||!info){if(info)info.textContent='';return;}
const lot=(State.DB.dyeLots||[]).find(d=>d.id===id);if(!lot){info.textContent='';return;}
const packed=getTotalPacked(id);const _wbi=getWindBalAvailable(id);info.textContent=`${lot.dyeLotNo} — Wind bal: ${_wbi.units||0}c / ${fmt(_wbi.weight)}kg — Packed so far: ${fmt(packed.bags)}b / ${fmt(packed.weight)}kg`;}
async function wSubmitPack(){const setAlert=msg=>{const el=document.getElementById('w-pack-alert');if(el)el.textContent=msg;};const dyeLotId=document.getElementById('w-pack-lot')?.value;const bags=parseInt(document.getElementById('w-pack-bags')?.value)||0;const weight=parseFloat(document.getElementById('w-pack-weight')?.value)||0;const worker=document.getElementById('w-pack-worker')?.value;const notes=document.getElementById('w-pack-notes')?.value||'';if(!dyeLotId){setAlert('Select dye lot');return;}
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
  if(_btn)_btn.disabled=false;wSetAlert('Pack','✓ Pack entry saved — pending approval','ok');renderWorkerView();
}catch(e){setAlert('Network error — not saved: '+e.message);if(_btn)_btn.disabled=false;}}
async function wSubmitWindEnd(){const setAlert=msg=>{const el=document.getElementById('w-wind-end-alert');if(el)el.textContent=msg;};const entryId=document.getElementById('w-wind-end-sel')?.value;const outW=parseFloat(document.getElementById('w-wind-out-weight')?.value)||0;const worker=document.getElementById('w-wind-end-worker')?.value;if(!entryId){setAlert('Select entry');return;}
if(outW<=0){setAlert('Enter output weight');return;}
if(!worker){setAlert('Select worker');return;}
const outCones=parseInt(document.getElementById('w-wind-out-cones')?.value)||0;
const _btn=document.getElementById('w-wind-end-btn')||document.querySelector('#wwind-end .wbtn');if(_btn)_btn.disabled=true;
try{
  const {ok,data,error,networkError}=await apiPost('/api/wind/end',{id:entryId,outCones,outWeight:outW,notes:'',idempotencyKey:crypto.randomUUID()});
  if(networkError)throw new Error(error);
  if(!ok){setAlert(error||'Failed to end wind entry');if(_btn)_btn.disabled=false;return;}
  if(_btn)_btn.disabled=false;wSetAlert('Wind','✓ Wind ended — pending approval','ok');renderWorkerView();
}catch(e){setAlert('Network error — not saved: '+e.message);if(_btn)_btn.disabled=false;}}
async function wSubmitWindStart(){const setAlert=msg=>{const el=document.getElementById('w-wind-alert');if(el)el.textContent=msg;};const dyeLotId=document.getElementById('w-wind-lot')?.value;const inW=parseFloat(document.getElementById('w-wind-in-weight')?.value)||0;const machine=document.getElementById('w-wind-machine')?.value;const worker=document.getElementById('w-wind-worker')?.value;const notes=document.getElementById('w-wind-start-note')?.value.trim()||'';if(!dyeLotId){setAlert('Select dye lot');return;}
if(inW<=0){setAlert('Enter input weight');return;}
if(!machine){setAlert('Select machine');return;}
if(!worker){setAlert('Select worker');return;}
const inCones=parseInt(document.getElementById('w-wind-in-cones')?.value)||0;
const _windDup=(State.DB.windEntries||[]).find(e=>e.dyeLotId===dyeLotId&&e.status==='InProgress');if(_windDup){const _elapsed=hrsBetween(_windDup.startTime,new Date().toISOString());if(!confirm(`⚠ ${dyeLotId} already has a Wind entry IN PROGRESS\nStarted: ${fmtTS(_windDup.startTime)} by ${_windDup.startWorker||'?'}\nRunning for: ${fmtHrs(_elapsed)}\n\nStart another run anyway? (only do this if machines are different)`))return;}
const _btn=document.getElementById('w-wind-start-btn');if(_btn)_btn.disabled=true;
setAlert('');
try{
  const {ok,data,error,networkError}=await _postWithDuplicateCheck('/api/wind/start',{dyeLotId,inCones,inWeight:inW,machine,worker,notes,recycleId:null,changedBy:State.currentUser.name,idempotencyKey:crypto.randomUUID()});
  if(networkError)throw new Error(error);
  if(!ok){if(error!=='__cancelled_by_user__')setAlert(error||'Failed to start wind entry');if(_btn)_btn.disabled=false;return;}
  if(_btn)_btn.disabled=false;wSetAlert('Wind','✓ Wind started');renderWorkerView();
}catch(e){setAlert('Network error — not saved: '+e.message);if(_btn)_btn.disabled=false;}}
function wTab(el,showId,hideId){const card=el.closest('.wstage-card')||el.closest('.wv-body')||document.body;card.querySelectorAll('.wtab').forEach(t=>t.classList.remove('active'));el.classList.add('active');const showEl=document.getElementById(showId);const hideEl=document.getElementById(hideId);if(showEl)showEl.style.display='';if(hideEl)hideEl.style.display='none';}
function wWindLotChange(){const id=document.getElementById('w-wind-lot')?.value;const info=document.getElementById('w-wind-lot-info');if(!id||!info){if(info)info.textContent='';return;}
const lot=(State.DB.dyeLots||[]).find(d=>d.id===id);if(!lot){info.textContent='';return;}
const _wb=getDyeBalAvailable(id);info.textContent=`${lot.dyeLotNo} — ${lot.shade} — Available: ${_wb.units||0} cones / ${fmt(_wb.weight)}kg`;}
function workerPackForm(){const _wW=State.DB.masters.workers||[];const wOpts=(State.currentUser?.role==='admin'||State.currentUser?.role==='manager'||State.currentUser?.role==='supervisor')?`<option value="">— Select Worker —</option>${_wW.map(w=>`<option value="${w}">${w}</option>`).join('')}`:`<option value="${State.currentUser?.name||''}"> ${State.currentUser?.name||''}</option>`;const availDyeLots=(State.DB.dyeLots||[]).filter(d=>(d.status==='Approved'||d.status==='Edited-Approved')&&getWindBalAvailable(d.id).weight>0).sort((a,b)=>(b.dyeLotNo||'').localeCompare(a.dyeLotNo||''));const dyeLotOpts=availDyeLots.map(d=>{const _wb=getWindBalAvailable(d.id);return`<option value="${d.id}">${d.dyeLotNo} — ${d.shade} (${_wb.units||0}c / ${fmt(_wb.weight)}kg avail)</option>`;}).join('');return`<div class="wstage-card" style="border-color:var(--cp)20"><div class="wstage-title" style="color:var(--cp)">📦 Pack</div><div class="wfield"><label>Dye Lot</label><select class="wselect" id="w-pack-lot" onchange="wPackLotChange()"><option value="">Select dye lot...</option>${dyeLotOpts}</select></div><div id="w-pack-lot-info" style="font-size:0.72rem;color:var(--mu);padding:4px 0;"></div><div class="wfield"><label>Cones In *</label><input class="winp" type="number" id="w-pack-in-cones" placeholder="0 cones from winding"></div><div class="wfield"><label>In Weight (kg) *</label><input class="winp" type="number" id="w-pack-in-weight" step="0.01" placeholder="0.00"></div><div class="wfield"><label>Bags (new count)</label><input class="winp" type="number" id="w-pack-bags" placeholder="No. of bags"></div><div class="wfield"><label>Weight (kg)</label><input class="winp" type="number" id="w-pack-weight" step="0.01" placeholder="0.00"></div><div class="wfield"><label>Worker</label><select class="wselect" id="w-pack-worker"><option value="">Select...</option>${wOpts}</select></div><div class="wfield"><label>Notes</label><textarea class="winp" id="w-pack-notes" rows="2" placeholder="Optional..."></textarea></div><div id="w-pack-alert" class="walert"></div><button class="wbtn" id="w-pack-submit-btn" onclick="wSubmitPack()">📦 Save Pack Entry</button></div>`;}
function workerWindForm(mOpts){const _wW=State.DB.masters.workers||[];const _wCur=State.currentUser?.name||'';const wOpts=(State.currentUser?.role==='admin'||State.currentUser?.role==='manager'||State.currentUser?.role==='supervisor')?`<option value="">— Select Worker —</option>${_wW.map(w=>`<option value="${w}"${w===_wCur?' selected':''}>${w}</option>`).join('')}`:`<option value="${_wCur}">${_wCur}</option>`;const availDyeLots=(State.DB.dyeLots||[]).filter(d=>(d.status==='Approved'||d.status==='Edited-Approved')&&getDyeBalAvailable(d.id).weight>0).sort((a,b)=>(b.dyeLotNo||'').localeCompare(a.dyeLotNo||''));const dyeLotOpts=availDyeLots.map(d=>{const _db=getDyeBalAvailable(d.id);return`<option value="${d.id}">${d.dyeLotNo} — ${d.shade} (${_db.units||0}c / ${_db.weight}kg avail)</option>`;}).join('');const inProgWind=(State.DB.windEntries||[]).filter(e=>e.status==='InProgress');const ipOpts=inProgWind.map(e=>`<option value="${e.id}">${e.id} — ${e.dyeLotNo} — ${fmt(e.inWeight)}kg in</option>`).join('');return`<div class="wstage-card" style="border-color:var(--cw)20"><div class="wstage-title" style="color:var(--cw)">🌀 Wind</div><div class="wtab-bar"><button class="wtab active" onclick="wTab(this,'wwind-start','wwind-end')">▶ Start</button><button class="wtab" onclick="wTab(this,'wwind-end','wwind-start')">✓ End</button></div><div id="wwind-start"><div class="wfield"><label>Dye Lot</label><select class="wselect" id="w-wind-lot" onchange="wWindLotChange()"><option value="">Select dye lot...</option>${dyeLotOpts}</select></div><div id="w-wind-lot-info" style="font-size:0.72rem;color:var(--mu);padding:4px 0;"></div><div class="wfield"><label>Cones In *</label><input class="winp" type="number" id="w-wind-in-cones" placeholder="0 cones"></div><div class="wfield"><label>Input Weight (kg)</label><input class="winp" type="number" id="w-wind-in-weight" step="0.01" placeholder="0.00"></div><div class="wfield"><label>Machine</label><select class="wselect" id="w-wind-machine"><option value="">Select...</option>${mOpts}</select></div><div class="wfield"><label>Worker</label><select class="wselect" id="w-wind-worker"><option value="">Select...</option>${wOpts}</select></div><div class="wfield"><label>Notes (optional)</label><input class="winp" id="w-wind-start-note" placeholder="Optional notes..."></div><div id="w-wind-alert" class="walert"></div><button class="wbtn" id="w-wind-start-btn" onclick="wSubmitWindStart()">▶ Start Wind</button></div><div id="wwind-end" style="display:none">
      ${ipOpts?`<div class="wfield"><label>Select In-Progress Wind Entry</label><select class="wselect"id="w-wind-end-sel"><option value="">Select...</option>${ipOpts}</select></div><div class="wfield"><label>Cones Out*</label><input class="winp"type="number"id="w-wind-out-cones"placeholder="0 cones"></div><div class="wfield"><label>Output Weight(kg)</label><input class="winp"type="number"id="w-wind-out-weight"step="0.01"placeholder="0.00"></div><div class="wfield"><label>Worker</label><select class="wselect"id="w-wind-end-worker"><option value="">Select...</option>${wOpts}</select></div><div id="w-wind-end-alert"class="walert"></div><button class="wbtn" id="w-wind-end-btn" onclick="wSubmitWindEnd()">✓ End Wind</button>`
      :'<div style="padding:16px;text-align:center;color:var(--mu);font-size:0.8rem">No in-progress wind entries</div>'}
    </div></div>`;}
async function saveAgingThresholds(){let y=parseInt(document.getElementById('aging-yellow')?.value)||7;let r=parseInt(document.getElementById('aging-red')?.value)||15;try{const {ok,error,networkError}=await apiPost('/api/masters/setting',{action:'agingThresholds',yellow:y,red:r,role:State.currentUser?.role});if(networkError)throw new Error(error);if(!ok){showToast(error||'Could not save','err');return;}showToast('Saved ✓');}catch(e){showToast('Network error — '+e.message,'err');}}
function getOrderFulfilled(orderId){let order=(State.DB.partyOrders||[]).find(function(o){return o.id===orderId;});if(!order)return 0;
const _os=(State.DB.orderSummaries||{})[orderId];if(_os)return _os.qtyFulfilled||0;
const oShade=(order.shade||'').trim().toLowerCase();let disps=(State.DB.dispatches||[]).filter(function(d){const dShade=(d.shade||'').trim().toLowerCase();return d.party===order.party&&dShade===oShade&&(d.status==='Approved'||d.status==='Edited-Approved');}).sort(function(a,b){return(a.timestamp||'').localeCompare(b.timestamp||'');});let orders=(State.DB.partyOrders||[]).filter(function(o){const s=(o.shade||'').trim().toLowerCase();return o.party===order.party&&s===oShade&&o.status!=='Cancelled';}).sort(function(a,b){return(a.date||'').localeCompare(b.date||'');});let rem={};orders.forEach(function(o){rem[o.id]=o.qtyOrdered;});let alloc={};orders.forEach(function(o){alloc[o.id]=0;});disps.forEach(function(d){let wt=d.weight||0;for(let i=0;i<orders.length;i++){if(wt<=0)break;let o=orders[i];let av=rem[o.id]||0;if(av<=0)continue;let tk=Math.min(wt,av);alloc[o.id]=(alloc[o.id]||0)+tk;rem[o.id]-=tk;wt-=tk;}});return alloc[orderId]||0;}
function updateOrderStatuses(){(State.DB.partyOrders||[]).forEach(function(o){if(o.status==='Cancelled')return;let f=getOrderFulfilled(o.id);o.qtyFulfilled=f;if(f>=o.qtyOrdered-0.01)o.status='Completed';else if(f>0)o.status='Partial';else o.status='Open';});}
async function cancelPartyOrder(id){
  // Jul 15 2026 — Item P migration. Was: client mutates status directly then
  // save() through the generic /api/save passthrough — no server check that
  // the order exists or isn't already cancelled. Now: worker.js POST
  // /api/party-order/cancel does both checks server-side.
  if(State.currentUser&&State.currentUser.role!=='admin'&&State.currentUser.role!=='manager'&&State.currentUser.role!=='supervisor'){showToast('No permission','err');return;}
  let reason=prompt('Cancellation reason:');if(!reason||!reason.trim()){showToast('Reason required','err');return;}
  try{
    const {ok,data,error,networkError}=await apiPost('/api/party-order/cancel',{id,reason:reason.trim(),changedBy:State.currentUser.name});
  if(networkError)throw new Error(error);
  if(!ok){showToast(error||'Could not cancel order','err');return;}
    showToast('Order cancelled');renderPartyTracker();
  }catch(e){showToast('Network error — not saved: '+e.message,'err');}
}
function openPartyOrderModal(preParty){let isSup=State.currentUser&&(State.currentUser.role==='supervisor'||State.currentUser.role==='admin'||State.currentUser.role==='manager');if(!isSup){showToast('Supervisor/Admin only','err');return;}
document.getElementById('po-alert').innerHTML='';document.getElementById('po-qty').value='';document.getElementById('po-shade').value='';document.getElementById('po-notes').value='';document.getElementById('po-date').value=today();document.getElementById('po-due').value='';let parties=State.DB.parties||[];document.getElementById('po-party').innerHTML='<option value="">Select party...</option>'+parties.map(function(p){return'<option value="'+p+'">'+p+'</option>';}).join('');if(preParty)document.getElementById('po-party').value=preParty;let grades=(State.DB.masters||{}).grades||[];document.getElementById('po-grade').innerHTML='<option value="">Any grade</option>'+grades.map(function(g){return'<option value="'+g+'">'+g+'</option>';}).join('');openModal('party-order-modal-overlay');}
async function submitPartyOrder(){
  // Jul 15 2026 — Item P migration. Was: client-generated order ID via
  // genOrderNo() (max+1 scan — race condition risk if two orders are
  // created at the same instant) plus a direct save() with no server
  // validation. Now: worker.js POST /api/party-order/create does the
  // atomic ID gen (genIdAtomicServer) and validation.
  let sa=function(m){document.getElementById('po-alert').innerHTML='<div class="alert-err">'+m+'</div>';};
  let party=document.getElementById('po-party').value;let shade=document.getElementById('po-shade').value;let grade=document.getElementById('po-grade').value;let qty=parseFloat(document.getElementById('po-qty').value)||0;let date=document.getElementById('po-date').value;let due=document.getElementById('po-due').value;let notes=document.getElementById('po-notes').value.trim();
  if(!party){sa('Select party');return;}if(!shade){sa('Select shade');return;}if(qty<=0){sa('Enter quantity');return;}if(!date){sa('Select date');return;}if(!due){sa('Select due date');return;}
  let _poBtn=document.querySelector('#party-order-modal-overlay .btn-primary');if(_poBtn)_poBtn.disabled=true;
  try{
    const {ok,data,error,networkError}=await apiPost('/api/party-order/create',{party,shade,grade,qty,date,due,notes,changedBy:State.currentUser.name});
  if(networkError)throw new Error(error);
  if(!ok){sa(error||'Could not create order');if(_poBtn)_poBtn.disabled=false;return;}
    if(_poBtn)_poBtn.disabled=false;closeModal('party-order-modal-overlay');showToast('Order '+data.id+' created ✓');renderAll();
  }catch(e){sa('Network error — not saved: '+e.message);if(_poBtn)_poBtn.disabled=false;}
}
function switchStgTab(page,tab){State._stgTabs[page]=tab;const _tabs=(page==='dispatch')?['entries','ready','summary']:['entries','ready','pending'];_tabs.forEach(t=>{const btn=document.getElementById('stg-btn-'+page+'-'+t);const panel=document.getElementById('stg-panel-'+page+'-'+t);if(btn)btn.classList.toggle('active',t===tab);if(panel)panel.classList.toggle('active',t===tab);});const bevMap={'stage-ready':renderBevSoftReady,'stage-pending':renderBevSoftPending,'dye-ready':renderBevDyeReady,'dye-pending':renderBevDyePending,'wind-ready':renderBevWindReady,'wind-pending':renderBevWindPending,'pack-ready':renderBevPackReady,'pack-pending':renderBevPackPending,'dispatch-ready':renderBevDispReady,'dispatch-summary':renderDispSummary,};const key=page+'-'+tab;if(bevMap[key])bevMap[key]();}
function bevRowClass(days){if(days===null||days===undefined)return'';if(days<=3)return'bev-row-ok';if(days<=7)return'bev-row-warn';return'bev-row-aged';}
function bevSortToggle(tabKey,colIdx){const s=State._bevSort[tabKey]=State._bevSort[tabKey]||{col:-1,dir:1};if(s.col===colIdx){s.dir*=-1;}else{s.col=colIdx;s.dir=1;}
const bevMap={'stage-ready':renderBevSoftReady,'stage-pending':renderBevSoftPending,'dye-ready':renderBevDyeReady,'dye-pending':renderBevDyePending,'wind-ready':renderBevWindReady,'wind-pending':renderBevWindPending,'pack-ready':renderBevPackReady,'pack-pending':renderBevPackPending,'dispatch-ready':renderBevDispReady,};if(bevMap[tabKey])bevMap[tabKey]();}
function bevFilterChange(tabKey){const f=State._bevFilter[tabKey]=State._bevFilter[tabKey]||{};f.lot=document.getElementById('bevf-lot-'+tabKey)?.value||'';f.grade=document.getElementById('bevf-grade-'+tabKey)?.value||'';f.vendor=document.getElementById('bevf-vendor-'+tabKey)?.value||'';const dayVal=document.getElementById('bevf-days-'+tabKey)?.value||'';f.minDays=dayVal?parseInt(dayVal):0;const bevMap={'stage-ready':renderBevSoftReady,'stage-pending':renderBevSoftPending,'dye-ready':renderBevDyeReady,'dye-pending':renderBevDyePending,'wind-ready':renderBevWindReady,'wind-pending':renderBevWindPending,'pack-ready':renderBevPackReady,'pack-pending':renderBevPackPending,'dispatch-ready':renderBevDispReady,};if(bevMap[tabKey])bevMap[tabKey]();}
function applyBevFilters(tabKey,rows){const f=State._bevFilter[tabKey]||{};return rows.filter(r=>{if(f.lot&&r._lot!==f.lot)return false;if(f.grade&&r._grade!==f.grade)return false;if(f.vendor&&r._vendor!==f.vendor)return false;if(f.minDays&&(r._days??0)<f.minDays)return false;return true;});}
function applyBevSort(tabKey,rows){const s=State._bevSort[tabKey];if(!s||s.col<0)return rows;return[...rows].sort((a,b)=>{const av=a._sortVals?.[s.col]??0;const bv=b._sortVals?.[s.col]??0;if(typeof av==='number')return(av-bv)*s.dir;return String(av).localeCompare(String(bv))*s.dir;});}
function bevFilterBar(tabKey,rows){const lots=[...new Set(rows.map(r=>r._lot).filter(Boolean))].sort();const grades=[...new Set(rows.map(r=>r._grade).filter(Boolean))].sort();const vendors=[...new Set(rows.map(r=>r._vendor).filter(Boolean))].sort();const dayRanges=['1+','3+','7+','14+','30+'];const mkOpts=(vals)=>'<option value="">All</option>'+vals.map(v=>'<option value="'+v+'">'+v+'</option>').join('');const mkDayOpts=()=>'<option value="">All</option>'+dayRanges.map(v=>'<option value="'+v+'">'+v+' days</option>').join('');const selStyle='class="col-filter"';const wrap=document.createElement('div');wrap.style.cssText='display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center;';const lbl=document.createElement('span');lbl.style.cssText='font-size:0.65rem;color:var(--mu);font-weight:700;text-transform:uppercase;';lbl.textContent='Filter:';wrap.appendChild(lbl);const mkSel=(id,opts)=>{const sel=document.createElement('select');sel.className='col-filter';sel.id=id;sel.innerHTML=opts;sel.addEventListener('change',()=>bevFilterChange(tabKey));return sel;};wrap.appendChild(mkSel('bevf-lot-'+tabKey,mkOpts(lots)));wrap.appendChild(mkSel('bevf-grade-'+tabKey,mkOpts(grades)));wrap.appendChild(mkSel('bevf-vendor-'+tabKey,mkOpts(vendors)));wrap.appendChild(mkSel('bevf-days-'+tabKey,mkDayOpts()));const clr=document.createElement('button');clr.className='btn btn-ghost btn-xs';clr.textContent='✕ Clear';clr.addEventListener('click',()=>clearBevFilter(tabKey));wrap.appendChild(clr);return wrap;}
function clearBevFilter(tabKey){State._bevFilter[tabKey]={};['bevf-lot-','bevf-grade-','bevf-vendor-','bevf-days-'].forEach(p=>{const el=document.getElementById(p+tabKey);if(el)el.value='';});bevFilterChange(tabKey);}
function bevTable(cols,rows,tabKey){const filtered=tabKey?applyBevFilters(tabKey,rows):rows;const sorted=tabKey?applyBevSort(tabKey,filtered):filtered;const s=State._bevSort[tabKey]||{col:-1,dir:1};if(!sorted.length)return'<div style="color:var(--mu);font-size:0.75rem;padding:16px 0;text-align:center;">Nothing here — all clear ✓</div>';const thead='<thead><tr>'+cols.map((col,i)=>{const sortArrow=s.col===i?(s.dir===1?' ↑':' ↓'):' ⇅';const onclick='bevSortToggle(&quot;'+tabKey+'&quot;,'+i+')';return'<th onclick="'+onclick+'" style="cursor:pointer;user-select:none;">'+col+'<span style="color:var(--mu);font-size:0.6rem">'+sortArrow+'</span></th>';}).join('')+'</tr></thead>';const tbody='<tbody>'+sorted.map(r=>'<tr class="'+(r._cls||'')+'">'+r._cells.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+'</tbody>';return'<div class="tbl-wrap bev-dyn-h" style="overflow-y:auto;"><table class="bev-tbl">'+thead+tbody+'</table></div>';}
// Dynamically size .bev-dyn-h containers to use all remaining viewport space below them —
// replaces the old fixed "calc(100vh - 320px)" guess which left blank page space on
// screens where the header/tabs/filter row above the table take up a different amount
// of space than 320px assumed.
function fitBevTableHeight(){
  document.querySelectorAll('.bev-dyn-h').forEach(el=>{
    const top=el.getBoundingClientRect().top;
    const h=window.innerHeight-top-16; // 16px bottom breathing room
    el.style.maxHeight=Math.max(200,h)+'px';
  });
}
window.addEventListener('resize',()=>{clearTimeout(window._bevFitTimer);window._bevFitTimer=setTimeout(fitBevTableHeight,150);});
function renderBevSoftReady(){const today=new Date();const rows=(State.DB.lots||[]).filter(l=>getSoftBalanceAvailable(l.id,l.grade,l.vendor).weight>0).map(l=>{const sfBalQ=getSoftBalanceAvailable(l.id,l.grade,l.vendor);const sfBal=sfBalQ.weight;const sfB=getSoftBalance(l.id,l.grade,l.vendor);const sfE=(State.DB.stageEntries||[]).filter(e=>e.lotId===l.id&&e.stage==='Soft'&&(e.status==='Approved'||e.status==='Edited-Approved'));const lastEnd=sfE.length?sfE.reduce((a,e)=>e.endTime>a?e.endTime:a,''):null;const days=lastEnd?Math.floor((today-new Date(lastEnd))/86400000):null;return{_cls:bevRowClass(days),_days:days??999,_lot:l.id,_grade:l.grade,_vendor:l.vendor,_sortVals:[l.id,l.grade,l.vendor,sfB.units,sfBal,days??9999],_cells:['<span class="mono" style="color:var(--ac);font-weight:700;cursor:pointer;text-decoration:underline" onclick="openRMLifecycle(\''+l.id+'\')" title="Open Lot Lifecycle">'+l.id+'</span>',l.grade,l.vendor,sfB.units+'b','<strong>'+fmtQty(sfBalQ.units||0,sfBal,'b')+'</strong>',days!==null?agingBadge(days):'—']};}).sort((a,b)=>b._days-a._days);const el=document.getElementById('bev-soft-ready');if(el){el.innerHTML='';el.appendChild(bevFilterBar('stage-ready',rows));el.insertAdjacentHTML('beforeend','<div id="bev-tbl-stage-ready"></div>');const tbl=document.getElementById('bev-tbl-stage-ready');if(tbl)tbl.innerHTML=bevTable(['Lot','Grade','Vendor','Bags','Kg Ready','Days Waiting'],rows,'stage-ready');setTimeout(fitBevTableHeight,0);const f=State._bevFilter['stage-ready']||{};if(f.lot){const e=document.getElementById('bevf-lot-stage-ready');if(e)e.value=f.lot;}
if(f.grade){const e=document.getElementById('bevf-grade-stage-ready');if(e)e.value=f.grade;}
if(f.vendor){const e=document.getElementById('bevf-vendor-stage-ready');if(e)e.value=f.vendor;}
if(f.minDays){const e=document.getElementById('bevf-days-stage-ready');if(e)e.value=f.minDays+'+';}}
const btn=document.getElementById('stg-btn-stage-ready');if(btn){const cnt=btn.querySelector('.stg-tab-count');if(cnt){cnt.textContent=rows.length;cnt.className='stg-tab-count'+(rows.length?'':' zero');}}}
function renderBevSoftPending(){const today=new Date();const rows=(State.DB.lots||[]).filter(l=>getRMBalance(l.id,l.grade,l.vendor).units>0).map(l=>{const b=getRMBalance(l.id,l.grade,l.vendor);const days=l.date?Math.floor((today-new Date(l.date))/86400000):null;return{_cls:bevRowClass(days),_days:days??999,_lot:l.id,_grade:l.grade,_vendor:l.vendor,_sortVals:[l.id,l.grade,l.vendor,b.units,b.weight,days??9999],_cells:['<span class="mono" style="color:var(--ac);font-weight:700;cursor:pointer;text-decoration:underline" onclick="openRMLifecycle(\''+l.id+'\')" title="Open Lot Lifecycle">'+l.id+'</span>',l.grade,l.vendor,b.units+'b',fmt(b.weight)+'kg',days!==null?agingBadge(days):'—']};}).sort((a,b)=>b._days-a._days);const el=document.getElementById('bev-soft-pending');if(el){el.innerHTML='';el.appendChild(bevFilterBar('stage-pending',rows));el.insertAdjacentHTML('beforeend','<div id="bev-tbl-stage-pending"></div>');const tbl=document.getElementById('bev-tbl-stage-pending');if(tbl)tbl.innerHTML=bevTable(['Lot','Grade','Vendor','Bags','Kg','Days Waiting'],rows,'stage-pending');setTimeout(fitBevTableHeight,0);}
const btn=document.getElementById('stg-btn-stage-pending');if(btn){const cnt=btn.querySelector('.stg-tab-count');if(cnt){cnt.textContent=rows.length;cnt.className='stg-tab-count'+(rows.length?'':' zero');}}}
function renderBevDyeReady(){const today=new Date();const rows=(State.DB.dyeLots||[]).filter(d=>(d.status==='Approved'||d.status==='Edited-Approved')&&getDyeBalAvailable(d.id).weight>0).map(d=>{const bal=getDyeBalAvailable(d.id);const days=d.approvedAt?Math.floor((today-new Date(d.approvedAt))/86400000):null;return{_cls:bevRowClass(days),_days:days??999,_lot:d.dyeLotNo,_grade:d.shade||'',_vendor:'',_sortVals:[d.dyeLotNo,d.shade||'',bal.units,bal.weight,days??9999],_cells:['<span class="mono" style="color:var(--ac);font-weight:700;cursor:pointer;text-decoration:underline" onclick="openDyeLifecycle(\''+d.id+'\')" title="Open Dye Lifecycle">'+d.dyeLotNo+'</span>',d.shade||'—',bal.units+'c','<strong>'+fmt(bal.weight)+'kg</strong>',days!==null?agingBadge(days):'—']};}).sort((a,b)=>b._days-a._days);const el=document.getElementById('bev-dye-ready');if(el){el.innerHTML='';el.appendChild(bevFilterBar('dye-ready',rows));el.insertAdjacentHTML('beforeend','<div id="bev-tbl-dye-ready"></div>');const tbl=document.getElementById('bev-tbl-dye-ready');if(tbl)tbl.innerHTML=bevTable(['Dye Lot','Shade','Cones','Kg Ready','Days Waiting'],rows,'dye-ready');setTimeout(fitBevTableHeight,0);}
const btn=document.getElementById('stg-btn-dye-ready');if(btn){const cnt=btn.querySelector('.stg-tab-count');if(cnt){cnt.textContent=rows.length;cnt.className='stg-tab-count'+(rows.length?'':' zero');}}}
function renderBevDyePending(){const today=new Date();const rows=(State.DB.lots||[]).filter(l=>{const sb=getSoftBalanceAvailable(l.id,l.grade,l.vendor);return sb.weight>0;}).map(l=>{const sfBalQ=getSoftBalanceAvailable(l.id,l.grade,l.vendor);const sfBal=sfBalQ.weight;const sfE=(State.DB.stageEntries||[]).filter(e=>e.lotId===l.id&&e.stage==='Soft'&&(e.status==='Approved'||e.status==='Edited-Approved'));const lastEnd=sfE.length?sfE.reduce((a,e)=>e.endTime>a?e.endTime:a,''):null;const days=lastEnd?Math.floor((today-new Date(lastEnd))/86400000):null;return{_cls:bevRowClass(days),_days:days??999,_lot:l.id,_grade:l.grade,_vendor:l.vendor,_sortVals:[l.id,l.grade,l.vendor,sfBal,days??9999],_cells:['<span class="mono" style="color:var(--ac);font-weight:700;cursor:pointer;text-decoration:underline" onclick="openRMLifecycle(\''+l.id+'\')" title="Open Lot Lifecycle">'+l.id+'</span>',l.grade,l.vendor,'<strong>'+fmt(sfBal)+'kg</strong>',days!==null?agingBadge(days):'—']};}).sort((a,b)=>b._days-a._days);const el=document.getElementById('bev-dye-pending');if(el){el.innerHTML='';el.appendChild(bevFilterBar('dye-pending',rows));el.insertAdjacentHTML('beforeend','<div id="bev-tbl-dye-pending"></div>');const tbl=document.getElementById('bev-tbl-dye-pending');if(tbl)tbl.innerHTML=bevTable(['Lot','Grade','Vendor','Kg at Soft','Days Waiting'],rows,'dye-pending');setTimeout(fitBevTableHeight,0);}
const btn=document.getElementById('stg-btn-dye-pending');if(btn){const cnt=btn.querySelector('.stg-tab-count');if(cnt){cnt.textContent=rows.length;cnt.className='stg-tab-count'+(rows.length?'':' zero');}}}
function renderBevWindReady(){const today=new Date();const rows=(State.DB.dyeLots||[]).filter(d=>{const wBal=getWindBalAvailable(d.id);return wBal.weight>0&&(State.DB.windEntries||[]).some(e=>e.dyeLotId===d.id&&(e.status==='Approved'||e.status==='Edited-Approved'));}).map(d=>{const bal=getWindBalAvailable(d.id);const lastW=(State.DB.windEntries||[]).filter(e=>e.dyeLotId===d.id&&e.status==='Approved').sort((a,b)=>(b.approvedAt||'').localeCompare(a.approvedAt||''))[0];const days=lastW?.approvedAt?Math.floor((today-new Date(lastW.approvedAt))/86400000):null;return{_cls:bevRowClass(days),_days:days??999,_lot:d.dyeLotNo,_grade:d.shade||'',_vendor:'',_sortVals:[d.dyeLotNo,d.shade||'',0,0,days??9999],_cells:['<span class="mono" style="color:var(--ac);font-weight:700;cursor:pointer;text-decoration:underline" onclick="openDyeLifecycle(\''+d.id+'\')" title="Open Dye Lifecycle">'+d.dyeLotNo+'</span>',d.shade||'—',bal.units+'c','<strong>'+fmt(bal.weight)+'kg</strong>',days!==null?agingBadge(days):'—']};}).sort((a,b)=>b._days-a._days);const el=document.getElementById('bev-wind-ready');if(el){el.innerHTML='';el.appendChild(bevFilterBar('wind-ready',rows));el.insertAdjacentHTML('beforeend','<div id="bev-tbl-wind-ready"></div>');const tbl=document.getElementById('bev-tbl-wind-ready');if(tbl)tbl.innerHTML=bevTable(['Dye Lot','Shade','Cones','Kg Ready','Days Waiting'],rows,'wind-ready');setTimeout(fitBevTableHeight,0);}
const btn=document.getElementById('stg-btn-wind-ready');if(btn){const cnt=btn.querySelector('.stg-tab-count');if(cnt){cnt.textContent=rows.length;cnt.className='stg-tab-count'+(rows.length?'':' zero');}}}
function renderBevWindPending(){const today=new Date();const rows=(State.DB.dyeLots||[]).filter(d=>(d.status==='Approved'||d.status==='Edited-Approved')&&getDyeBalAvailable(d.id).weight>0).map(d=>{const bal=getDyeBalAvailable(d.id);const days=d.approvedAt?Math.floor((today-new Date(d.approvedAt))/86400000):null;return{_cls:bevRowClass(days),_days:days??999,_lot:d.dyeLotNo,_grade:d.shade||'',_vendor:'',_sortVals:[d.dyeLotNo,d.shade||'',0,0,days??9999],_cells:['<span class="mono" style="color:var(--ac);font-weight:700;cursor:pointer;text-decoration:underline" onclick="openDyeLifecycle(\''+d.id+'\')" title="Open Dye Lifecycle">'+d.dyeLotNo+'</span>',d.shade||'—',bal.units+'c','<strong>'+fmt(bal.weight)+'kg</strong>',days!==null?agingBadge(days):'—']};}).sort((a,b)=>b._days-a._days);const el=document.getElementById('bev-wind-pending');if(el){el.innerHTML='';el.appendChild(bevFilterBar('wind-pending',rows));el.insertAdjacentHTML('beforeend','<div id="bev-tbl-wind-pending"></div>');const tbl=document.getElementById('bev-tbl-wind-pending');if(tbl)tbl.innerHTML=bevTable(['Dye Lot','Shade','Cones','Kg at Dye','Days Waiting'],rows,'wind-pending');setTimeout(fitBevTableHeight,0);}
const btn=document.getElementById('stg-btn-wind-pending');if(btn){const cnt=btn.querySelector('.stg-tab-count');if(cnt){cnt.textContent=rows.length;cnt.className='stg-tab-count'+(rows.length?'':' zero');}}}
function renderBevPackReady(){const today=new Date();const rows=(State.DB.dyeLots||[]).filter(d=>getPackBalAvailable(d.id).weight>0).map(d=>{const pb=getPackBalAvailable(d.id);const lastP=(State.DB.packEntries||[]).filter(e=>e.dyeLotId===d.id&&e.status==='Approved').sort((a,b)=>(b.approvedAt||b.timestamp||'').localeCompare(a.approvedAt||a.timestamp||''))[0];const days=lastP?.approvedAt?Math.floor((today-new Date(lastP.approvedAt))/86400000):null;return{_cls:bevRowClass(days),_days:days??999,_lot:d.dyeLotNo,_grade:d.shade||'',_vendor:'',_sortVals:[d.dyeLotNo,d.shade||'',0,0,days??9999],_cells:['<span class="mono" style="color:var(--ac);font-weight:700;cursor:pointer;text-decoration:underline" onclick="openDyeLifecycle(\''+d.id+'\')" title="Open Dye Lifecycle">'+d.dyeLotNo+'</span>',d.shade||'—',pb.units+'b','<strong>'+fmt(pb.weight)+'kg</strong>',days!==null?agingBadge(days):'—']};}).sort((a,b)=>b._days-a._days);const el=document.getElementById('bev-pack-ready');if(el){el.innerHTML='';el.appendChild(bevFilterBar('pack-ready',rows));el.insertAdjacentHTML('beforeend','<div id="bev-tbl-pack-ready"></div>');const tbl=document.getElementById('bev-tbl-pack-ready');if(tbl)tbl.innerHTML=bevTable(['Dye Lot','Shade','Bags','Kg Ready','Days Waiting'],rows,'pack-ready');setTimeout(fitBevTableHeight,0);}
const btn=document.getElementById('stg-btn-pack-ready');if(btn){const cnt=btn.querySelector('.stg-tab-count');if(cnt){cnt.textContent=rows.length;cnt.className='stg-tab-count'+(rows.length?'':' zero');}}}
function renderBevPackPending(){const today=new Date();const rows=(State.DB.dyeLots||[]).filter(d=>{const wBal=getWindBalAvailable(d.id);return wBal.weight>0&&(State.DB.windEntries||[]).some(e=>e.dyeLotId===d.id&&(e.status==='Approved'||e.status==='Edited-Approved'));}).map(d=>{const bal=getWindBalAvailable(d.id);const lastW=(State.DB.windEntries||[]).filter(e=>e.dyeLotId===d.id&&e.status==='Approved').sort((a,b)=>(b.approvedAt||'').localeCompare(a.approvedAt||''))[0];const days=lastW?.approvedAt?Math.floor((today-new Date(lastW.approvedAt))/86400000):null;return{_cls:bevRowClass(days),_days:days??999,_lot:d.dyeLotNo,_grade:d.shade||'',_vendor:'',_sortVals:[d.dyeLotNo,d.shade||'',0,0,days??9999],_cells:['<span class="mono" style="color:var(--ac);font-weight:700;cursor:pointer;text-decoration:underline" onclick="openDyeLifecycle(\''+d.id+'\')" title="Open Dye Lifecycle">'+d.dyeLotNo+'</span>',d.shade||'—',bal.units+'c','<strong>'+fmt(bal.weight)+'kg</strong>',days!==null?agingBadge(days):'—']};}).sort((a,b)=>b._days-a._days);const el=document.getElementById('bev-pack-pending');if(el){el.innerHTML='';el.appendChild(bevFilterBar('pack-pending',rows));el.insertAdjacentHTML('beforeend','<div id="bev-tbl-pack-pending"></div>');const tbl=document.getElementById('bev-tbl-pack-pending');if(tbl)tbl.innerHTML=bevTable(['Dye Lot','Shade','Cones','Kg at Wind','Days Waiting'],rows,'pack-pending');setTimeout(fitBevTableHeight,0);}
const btn=document.getElementById('stg-btn-pack-pending');if(btn){const cnt=btn.querySelector('.stg-tab-count');if(cnt){cnt.textContent=rows.length;cnt.className='stg-tab-count'+(rows.length?'':' zero');}}}
function renderDispSummary(){
  const el=document.getElementById('disp-summary-wrap');
  if(!el)return;
  // Show loading state
  el.innerHTML='<div class="card"><div style="color:var(--mu);font-size:0.8rem;padding:20px;text-align:center">Loading dispatch data...</div></div>';
  // Fetch all dispatches (active + archive) from Worker
  fetch(WORKER_URL+'/api/dispatch-summary',{headers:_getHeaders()})
    .then(r=>r.json())
    .then(data=>{window._dsAllDispatches=data.dispatches||[];_renderDispSummaryData(el,window._dsAllDispatches);})
    .catch(err=>{el.innerHTML='<div class="card"><div style="color:var(--re);font-size:0.8rem;padding:20px;text-align:center">Failed to load: '+err.message+'</div></div>';});
}
function _renderDispSummaryData(el, allDispatches){
  const _period=window._dsSummaryPeriod||'all';
  const _dim=window._dsSummaryDim||'shade';
  const _search=(window._dsSummarySearch||'').toLowerCase().trim();
  const _showAll=window._dsSummaryShowAll||false;
  const LIMIT=15;
  const now=new Date();
  const _inPeriod=(ts)=>{
    if(!ts)return false;
    const d=new Date(ts);
    if(_period==='week'){const w=new Date(now);w.setDate(w.getDate()-7);return d>=w;}
    if(_period==='month'){const m=new Date(now);m.setDate(m.getDate()-30);return d>=m;}
    return true;
  };
  const dispatches=allDispatches.filter(d=>_inPeriod(d.timestamp));

  const groups={};
  dispatches.forEach(d=>{
    let key='—';
    if(_dim==='shade')key=d.shade||'Unknown';
    else if(_dim==='grade')key=d.grade||'Unknown';
    else if(_dim==='party')key=d.party||'Unknown';
    if(!groups[key])groups[key]={key,bags:0,weight:0,count:0,parties:new Set(),shades:new Set()};
    groups[key].bags+=(d.bags||0);
    groups[key].weight+=(d.weight||0);
    groups[key].count++;
    if(d.party)groups[key].parties.add(d.party);
    if(d.shade)groups[key].shades.add(d.shade);
  });

  const allRows=Object.values(groups).sort((a,b)=>b.weight-a.weight);
  const totalKg=allRows.reduce((a,r)=>a+r.weight,0);
  const totalBags=allRows.reduce((a,r)=>a+r.bags,0);
  const maxKg=totalKg||1; // bar = share of total dispatched

  // Apply search filter
  const filtered=_search?allRows.filter(r=>r.key.toLowerCase().includes(_search)):allRows;
  const visible=_showAll||_search?filtered:filtered.slice(0,LIMIT);
  const hiddenCount=filtered.length-visible.length;

  const periodBtns=['week','month','all'].map(p=>`<button class="btn btn-sm ${_period===p?'btn-primary':'btn-ghost'}" onclick="window._dsSummaryPeriod='${p}';window._dsSummaryShowAll=false;_renderDispSummaryData(document.getElementById('disp-summary-wrap'),window._dsAllDispatches||[])">${p==='week'?'Week':p==='month'?'Month':'All Time'}</button>`).join('');
  const dimBtns=[['shade','By Shade'],['grade','By Grade'],['party','By Party']].map(([d,l])=>`<button class="btn btn-sm ${_dim===d?'btn-primary':'btn-ghost'}" onclick="window._dsSummaryDim='${d}';window._dsSummaryShowAll=false;window._dsSummarySearch='';_renderDispSummaryData(document.getElementById('disp-summary-wrap'),window._dsAllDispatches||[])">${l}</button>`).join('');
  const colLabel=_dim==='shade'?'Shade':_dim==='grade'?'Grade':'Party';
  const subLabel=_dim==='party'?'Shades':'Parties';
  const placeholder=_dim==='shade'?'Search shades...':_dim==='grade'?'Search grades...':'Search parties...';

  const rowsHtml=visible.map((r,i)=>{
    const globalRank=allRows.indexOf(r);
    const barPct=(r.weight/maxKg*100).toFixed(1);
    const barColor=globalRank===0?'var(--gr)':globalRank===1?'var(--ac)':globalRank<5?'var(--ye)':'var(--mu)';
    const subCount=_dim==='party'?r.shades.size:r.parties.size;
    return`<tr>
      <td style="padding:10px 12px;width:32px;color:var(--mu);font-size:0.65rem;text-align:right">#${globalRank+1}</td>
      <td style="padding:10px 12px;">
        <div style="font-size:0.8rem;font-weight:700;color:var(--tx)">${r.key}</div>
        <div style="font-size:0.65rem;color:var(--mu);margin-top:2px">${subCount} ${subLabel} · ${r.count} dispatch${r.count!==1?'es':''}</div>
      </td>
      <td style="padding:10px 12px;min-width:120px;">
        <div style="background:var(--s3);border-radius:4px;height:8px;overflow:hidden;">
          <div style="width:${barPct}%;height:100%;background:${barColor};border-radius:4px"></div>
        </div>
        <div style="font-size:0.62rem;color:var(--mu);margin-top:3px">${barPct}% of total</div>
      </td>
      <td style="padding:10px 12px;text-align:right;white-space:nowrap;">
        <div style="font-family:monospace;font-size:0.82rem;font-weight:700;color:${barColor}">${fmt(r.bags)}b / ${fmt(r.weight)}kg</div>

      </td>
    </tr>`;
  }).join('');

  const showAllBtn=hiddenCount>0&&!_search?`<tr><td colspan="4" style="padding:12px;text-align:center;border-top:1px solid var(--b1)"><button class="btn btn-ghost btn-sm" onclick="window._dsSummaryShowAll=true;_renderDispSummaryData(document.getElementById('disp-summary-wrap'),window._dsAllDispatches||[])">Show all ${filtered.length} ${colLabel.toLowerCase()}s</button></td></tr>`:'';

  el.innerHTML=`<div class="card" style="padding:0;overflow:hidden;">
    <div style="padding:16px 16px 12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;border-bottom:1px solid var(--b1)">
      <div>
        <div class="card-title" style="margin:0">Dispatch Summary</div>
        ${allRows.length?`<div style="font-size:0.7rem;color:var(--mu);margin-top:3px">${allRows.length} ${colLabel.toLowerCase()}s · ${fmt(totalBags)}b · ${fmt(totalKg)}kg total</div>`:''}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
        <div style="display:flex;gap:4px;">${periodBtns}</div>
        <div style="width:1px;background:var(--b1);margin:0 2px;align-self:stretch"></div>
        <div style="display:flex;gap:4px;">${dimBtns}</div>
      </div>
    </div>
    ${allRows.length?`
    <div style="padding:10px 16px;border-bottom:1px solid var(--b1);">
      <input class="fi" placeholder="${placeholder}" value="${(window._dsSummarySearch||'').replace(/"/g,'&quot;')}"
        oninput="window._dsSummarySearch=this.value;window._dsSummaryShowAll=false;_renderDispSummaryData(document.getElementById('disp-summary-wrap'),window._dsAllDispatches||[])"
        style="width:100%;max-width:320px;font-size:0.78rem;">
      ${_search&&filtered.length===0?'<span style="font-size:0.72rem;color:var(--mu);margin-left:8px">No results</span>':''}
      ${_search?`<span style="font-size:0.72rem;color:var(--mu);margin-left:8px">${filtered.length} result${filtered.length!==1?'s':''}</span>`:''}
    </div>
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:0.78rem;">
        <thead>
          <tr style="background:var(--s2);position:sticky;top:0;z-index:2;">
            <th style="padding:8px 12px;text-align:right;font-size:0.6rem;font-weight:700;text-transform:uppercase;color:var(--mu);white-space:nowrap">#</th>
            <th style="padding:8px 12px;text-align:left;font-size:0.6rem;font-weight:700;text-transform:uppercase;color:var(--mu)">${colLabel}</th>
            <th style="padding:8px 12px;text-align:left;font-size:0.6rem;font-weight:700;text-transform:uppercase;color:var(--mu);min-width:160px">Volume</th>
            <th style="padding:8px 12px;text-align:right;font-size:0.6rem;font-weight:700;text-transform:uppercase;color:var(--mu);white-space:nowrap">Bags / Kg</th>
          </tr>
        </thead>
        <tbody style="border-top:1px solid var(--b1)">
          ${rowsHtml}
          ${showAllBtn}
        </tbody>
      </table>
    </div>`:'<div style="padding:24px;text-align:center;color:var(--mu);font-size:0.8rem;">No dispatches in this period</div>'}
  </div>`;
}


function renderBevDispReady(){const today=new Date();const rows=(State.DB.dyeLots||[]).filter(d=>getPackBalAvailable(d.id).weight>0).map(d=>{const pb=getPackBalAvailable(d.id);const lastP=(State.DB.packEntries||[]).filter(e=>e.dyeLotId===d.id&&e.status==='Approved').sort((a,b)=>(b.approvedAt||b.timestamp||'').localeCompare(a.approvedAt||a.timestamp||''))[0];const days=lastP?.approvedAt?Math.floor((today-new Date(lastP.approvedAt))/86400000):null;return{_cls:bevRowClass(days),_days:days??999,_lot:d.dyeLotNo,_grade:d.shade||'',_vendor:'',_sortVals:[d.dyeLotNo,d.shade||'',0,0,days??9999],_cells:['<span class="mono" style="color:var(--ac);font-weight:700;cursor:pointer;text-decoration:underline" onclick="openDyeLifecycle(\''+d.id+'\')" title="Open Dye Lifecycle">'+d.dyeLotNo+'</span>',d.shade||'—',pb.units+'b','<strong>'+fmt(pb.weight)+'kg</strong>',days!==null?agingBadge(days):'—']};}).sort((a,b)=>b._days-a._days);const el=document.getElementById('bev-disp-ready');if(el){el.innerHTML='';el.appendChild(bevFilterBar('dispatch-ready',rows));el.insertAdjacentHTML('beforeend','<div id="bev-tbl-dispatch-ready"></div>');const tbl=document.getElementById('bev-tbl-dispatch-ready');if(tbl)tbl.innerHTML=bevTable(['Dye Lot','Shade','Bags','Kg Ready','Days Waiting'],rows,'dispatch-ready');setTimeout(fitBevTableHeight,0);}
const btn=document.getElementById('stg-btn-dispatch-ready');if(btn){const cnt=btn.querySelector('.stg-tab-count');if(cnt){cnt.textContent=rows.length;cnt.className='stg-tab-count'+(rows.length?'':' zero');}}}

function renderAllBev(){renderBevSoftReady();renderBevSoftPending();renderBevDyeReady();renderBevDyePending();renderBevWindReady();renderBevWindPending();renderBevPackReady();renderBevPackPending();renderBevDispReady();}
function renderSoftPanels(){const panel=document.getElementById('stage-panels');if(!panel)return;const today=new Date();const readyIn=(State.DB.lots||[]).filter(l=>getRMBalance(l.id,l.grade,l.vendor).units>0);const readyOut=(State.DB.lots||[]).filter(l=>getSoftBalanceWeight(l.id,l.grade,l.vendor)>0);const c1=`<div style="flex:1;min-width:260px;background:var(--s2);border-radius:10px;padding:14px;border-left:3px solid var(--ye)"><div style="font-size:0.68rem;font-weight:800;text-transform:uppercase;color:var(--ye);margin-bottom:10px">📥 Ready to come to Soft (${readyIn.length})</div>
    ${readyIn.map(l=>{const b=getRMBalance(l.id,l.grade,l.vendor);const d=l.date?Math.floor((today-new Date(l.date))/86400000):null;
    return `<div style="padding:6px 0;border-bottom:1px solid var(--b1);display:flex;justify-content:space-between;align-items:center"><div><span class="mono"style="color:var(--ac);font-size:0.8rem;font-weight:700">${l.id}</span><span style="font-size:0.65rem;color:var(--mu);margin-left:6px">${l.grade}</span></div><div style="text-align:right"><div style="font-size:0.75rem;font-weight:700">${b.units}u/${fmt(b.weight)}kg</div>${d!==null?agingBadge(d):''}</div></div>`;}).join('')||'<div style="color:var(--mu);font-size:0.73rem;padding:6px 0">Nothing at RM ✓</div>'}
  </div>`;const c2=`<div style="flex:1;min-width:260px;background:var(--s2);border-radius:10px;padding:14px;border-left:3px solid var(--cd)"><div style="font-size:0.68rem;font-weight:800;text-transform:uppercase;color:var(--cd);margin-bottom:10px">📤 Soft Done — Waiting for Dye (${readyOut.length})</div>
    ${readyOut.map(l=>{const sfBal=getSoftBalanceWeight(l.id,l.grade,l.vendor);
    const sfEntries=(State.DB.stageEntries||[]).filter(e=>e.lotId===l.id&&e.stage==='Soft'&&(e.status==='Approved'||e.status==='Edited-Approved'));
    const lastEnd=sfEntries.length?sfEntries.reduce((a,e)=>e.endTime>a?e.endTime:a,''):null;
    const d=lastEnd?Math.floor((today-new Date(lastEnd))/86400000):null;
    return `<div style="padding:6px 0;border-bottom:1px solid var(--b1);display:flex;justify-content:space-between;align-items:center"><div><span class="mono"style="color:var(--ac);font-size:0.8rem;font-weight:700">${l.id}</span><span style="font-size:0.65rem;color:var(--mu);margin-left:6px">${l.grade}</span></div><div style="text-align:right"><div style="font-size:0.75rem;font-weight:700;color:var(--cs)">${fmt(sfBal)}kg</div>${d!==null?agingBadge(d):''}</div></div>`;}).join('')||'<div style="color:var(--mu);font-size:0.73rem;padding:6px 0">Nothing waiting ✓</div>'}
  </div>`;panel.innerHTML=`<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:20px">${c1}${c2}</div>`;}
function renderWindPanels(){const panel=document.getElementById('wind-panels');if(!panel)return;const today=new Date();const readyIn=(State.DB.dyeLots||[]).filter(d=>(d.status==='Approved'||d.status==='Edited-Approved')&&getDyeBal(d.id).weight>0);const readyOut=(State.DB.dyeLots||[]).filter(d=>{const wBal=getWindBal(d.id);return wBal>0&&(State.DB.windEntries||[]).some(e=>e.dyeLotId===d.id&&e.status==='Approved');});const c1=`<div style="flex:1;min-width:260px;background:var(--s2);border-radius:10px;padding:14px;border-left:3px solid var(--cd)"><div style="font-size:0.68rem;font-weight:800;text-transform:uppercase;color:var(--cd);margin-bottom:10px">📥 Dye Done — Ready for Wind (${readyIn.length})</div>
    ${readyIn.map(d=>{const bal=getDyeBal(d.id);const days=d.approvedAt?Math.floor((today-new Date(d.approvedAt))/86400000):null;
    return `<div style="padding:6px 0;border-bottom:1px solid var(--b1);display:flex;justify-content:space-between;align-items:center"><div><span class="mono"style="color:var(--ac);font-size:0.8rem;font-weight:700">${d.dyeLotNo}</span><span style="font-size:0.65rem;color:var(--mu);margin-left:6px">${d.shade||''}</span></div><div style="text-align:right"><div style="font-size:0.75rem;font-weight:700;color:var(--cd)">${fmt(bal)}kg</div>${days!==null?agingBadge(days):''}</div></div>`;}).join('')||'<div style="color:var(--mu);font-size:0.73rem;padding:6px 0">Nothing at dye ✓</div>'}
  </div>`;const c2=`<div style="flex:1;min-width:260px;background:var(--s2);border-radius:10px;padding:14px;border-left:3px solid var(--cp)"><div style="font-size:0.68rem;font-weight:800;text-transform:uppercase;color:var(--cp);margin-bottom:10px">📤 Wind Done — Ready for Pack (${readyOut.length})</div>
    ${readyOut.map(d=>{const wBal=getWindBal(d.id);
    const lastWind=(State.DB.windEntries||[]).filter(e=>e.dyeLotId===d.id&&e.status==='Approved').sort((a,b)=>(b.approvedAt||'').localeCompare(a.approvedAt||''))[0];
    const days=lastWind?.approvedAt?Math.floor((today-new Date(lastWind.approvedAt))/86400000):null;
    return `<div style="padding:6px 0;border-bottom:1px solid var(--b1);display:flex;justify-content:space-between;align-items:center"><div><span class="mono"style="color:var(--ac);font-size:0.8rem;font-weight:700">${d.dyeLotNo}</span><span style="font-size:0.65rem;color:var(--mu);margin-left:6px">${d.shade||''}</span></div><div style="text-align:right"><div style="font-size:0.75rem;font-weight:700;color:var(--cw)">${fmt(wBal)}kg wound</div>${days!==null?agingBadge(days):''}</div></div>`;}).join('')||'<div style="color:var(--mu);font-size:0.73rem;padding:6px 0">Nothing waiting ✓</div>'}
  </div>`;panel.innerHTML=`<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:20px">${c1}${c2}</div>`;}
function renderPackPanels(){const panel=document.getElementById('pack-panels');if(!panel)return;const today=new Date();const readyIn=(State.DB.dyeLots||[]).filter(d=>{const wBal=getWindBal(d.id);return wBal>0&&(State.DB.windEntries||[]).some(e=>e.dyeLotId===d.id&&e.status==='Approved');});const readyOut=(State.DB.dyeLots||[]).filter(d=>getPackBal(d.id).weight>0);const c1=`<div style="flex:1;min-width:260px;background:var(--s2);border-radius:10px;padding:14px;border-left:3px solid var(--cw)"><div style="font-size:0.68rem;font-weight:800;text-transform:uppercase;color:var(--cw);margin-bottom:10px">📥 Wind Done — Ready for Pack (${readyIn.length})</div>
    ${readyIn.map(d=>{const wBal=getWindBal(d.id);
    const lastWind=(State.DB.windEntries||[]).filter(e=>e.dyeLotId===d.id&&e.status==='Approved').sort((a,b)=>(b.approvedAt||'').localeCompare(a.approvedAt||''))[0];
    const days=lastWind?.approvedAt?Math.floor((today-new Date(lastWind.approvedAt))/86400000):null;
    return `<div style="padding:6px 0;border-bottom:1px solid var(--b1);display:flex;justify-content:space-between;align-items:center"><div><span class="mono"style="color:var(--ac);font-size:0.8rem;font-weight:700">${d.dyeLotNo}</span><span style="font-size:0.65rem;color:var(--mu);margin-left:6px">${d.shade||''}</span></div><div style="text-align:right"><div style="font-size:0.75rem;font-weight:700;color:var(--cw)">${fmt(wBal)}kg</div>${days!==null?agingBadge(days):''}</div></div>`;}).join('')||'<div style="color:var(--mu);font-size:0.73rem;padding:6px 0">Nothing waiting ✓</div>'}
  </div>`;const c2=`<div style="flex:1;min-width:260px;background:var(--s2);border-radius:10px;padding:14px;border-left:3px solid var(--gr)"><div style="font-size:0.68rem;font-weight:800;text-transform:uppercase;color:var(--gr);margin-bottom:10px">📤 Packed — Ready for Dispatch (${readyOut.length})</div>
    ${readyOut.map(d=>{const pb=getPackBal(d.id);
    const lastPack=(State.DB.packEntries||[]).filter(e=>e.dyeLotId===d.id&&e.status==='Approved').sort((a,b)=>(b.approvedAt||b.timestamp||'').localeCompare(a.approvedAt||a.timestamp||''))[0];
    const days=lastPack?.approvedAt?Math.floor((today-new Date(lastPack.approvedAt))/86400000):null;
    return `<div style="padding:6px 0;border-bottom:1px solid var(--b1);display:flex;justify-content:space-between;align-items:center"><div><span class="mono"style="color:var(--ac);font-size:0.8rem;font-weight:700">${d.dyeLotNo}</span><span style="font-size:0.65rem;color:var(--mu);margin-left:6px">${d.shade||''}</span></div><div style="text-align:right"><div style="font-size:0.75rem;font-weight:700;color:var(--gr)">${pb.units}b/${fmt(pb.weight)}kg</div>${days!==null?agingBadge(days):''}</div></div>`;}).join('')||'<div style="color:var(--mu);font-size:0.73rem;padding:6px 0">Nothing waiting ✓</div>'}
  </div>`;panel.innerHTML=`<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:20px">${c1}${c2}</div>`;}
function renderDispatchPanels(){const panel=document.getElementById('dispatch-panels');if(!panel)return;const today=new Date();const readyIn=(State.DB.dyeLots||[]).filter(d=>getPackBalAvailable(d.id).weight>0);const recentOut=(State.DB.dispatches||[]).filter(d=>d.status==='Approved').sort((a,b)=>(b.timestamp||'').localeCompare(a.timestamp||'')).slice(0,8);const c1=`<div style="flex:1;min-width:260px;background:var(--s2);border-radius:10px;padding:14px;border-left:3px solid var(--cp)"><div style="font-size:0.68rem;font-weight:800;text-transform:uppercase;color:var(--cp);margin-bottom:10px">📥 Packed — Ready for Dispatch (${readyIn.length})</div>
    ${readyIn.map(d=>{const pb=getPackBal(d.id);
    const lastPack=(State.DB.packEntries||[]).filter(e=>e.dyeLotId===d.id&&e.status==='Approved').sort((a,b)=>(b.approvedAt||b.timestamp||'').localeCompare(a.approvedAt||a.timestamp||''))[0];
    const days=lastPack?.approvedAt?Math.floor((today-new Date(lastPack.approvedAt))/86400000):null;
    // Check any open orders for this shade
    const openOrds=(State.DB.partyOrders||[]).filter(o=>o.shade===d.shade&&(o.status==='Open'||o.status==='Partial'));
    return `<div style="padding:6px 0;border-bottom:1px solid var(--b1)"><div style="display:flex;justify-content:space-between;align-items:center"><div><span class="mono"style="color:var(--ac);font-size:0.8rem;font-weight:700">${d.dyeLotNo}</span><span style="font-size:0.65rem;color:var(--mu);margin-left:6px">${d.shade||''}</span></div><div style="text-align:right"><div style="font-size:0.75rem;font-weight:700;color:var(--cp)">${pb.units}b/${fmt(pb.weight)}kg</div>${days!==null?agingBadge(days):''}</div></div>${openOrds.length?`<div style="font-size:0.65rem;color:var(--ye);margin-top:2px">📋 ${openOrds.map(o=>o.party+': '+fmt(o.qtyOrdered-o.qtyFulfilled)+'kg pending').join(' | ')}</div>`:''}</div>`;}).join('')||'<div style="color:var(--mu);font-size:0.73rem;padding:6px 0">Nothing packed yet ✓</div>'}
  </div>`;const c2=`<div style="flex:1;min-width:260px;background:var(--s2);border-radius:10px;padding:14px;border-left:3px solid var(--gr)"><div style="font-size:0.68rem;font-weight:800;text-transform:uppercase;color:var(--gr);margin-bottom:10px">📤 Recently Dispatched</div>
    ${recentOut.map(d=>{
    const days=d.timestamp?Math.floor((today-new Date(d.timestamp))/86400000):null;
    return `<div style="padding:6px 0;border-bottom:1px solid var(--b1)"><div style="display:flex;justify-content:space-between;align-items:center"><div><span class="mono"style="color:var(--ac);font-size:0.78rem;font-weight:700">${d.dyeLotNo||'—'}</span><span style="font-size:0.65rem;color:var(--mu);margin-left:6px">${d.shade||''}</span></div><div style="text-align:right"><div style="font-size:0.75rem;font-weight:700">${d.bags}b/${fmt(d.weight)}kg</div>${days!==null?`<span style="font-size:0.65rem;color:var(--mu)">${days}d ago</span>`:''}</div></div><div style="font-size:0.65rem;color:var(--ye);margin-top:2px">→ ${d.party||'—'}${d.invoiceNo?' | '+d.invoiceNo:''}</div></div>`;}).join('')||'<div style="color:var(--mu);font-size:0.73rem;padding:6px 0">✕ No dispatches yet — pack a lot first</div>'}
  </div>`;panel.innerHTML=`<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:20px">${c1}${c2}</div>`;}
export function renderAll(specificPage){const active=document.querySelector('.page.active');const id=specificPage||(active?active.id.replace('page-',''):State.currentPage);if(!specificPage){updateSidebarKPIs();updateMobileNavBadges();}
if(!id)return;setTimeout(()=>_updateAllClearBtns(),50);setTimeout(()=>updateStageSummaryBars(),100);if(id==='dashboard'){renderDashboard();}
else if(id==='rm')renderRMTable();else if(id==='stage')renderStageTable();else if(id==='dye')renderDyeTable();else if(id==='approval')renderApproval();else if(id==='dispatch'){renderDispatch();if(State._stgTabs['dispatch']==='summary')renderDispSummary();}
else if(id==='stock')renderStock();else if(id==='wind')renderWindTable();else if(id==='pack')renderPackTable();else if(id==='stockregister'){showStockRegTab('dead',null);}else if(id==='editlog'){switchEditLogTab('log',document.getElementById('elt-log'));}
else if(id==='party')renderPartyTracker();else if(id==='challan')renderChallan();else if(id==='dyelifecycle')renderDyeLifecycleSelect();else if(id==='lifecycle')renderLifecycle();else if(id==='wip')renderWIP();else if(id==='vendor')renderVendorV2();else if(id==='analytics'){loadDyeEntriesIfNeeded(function(){populateAnalyticsSelects();const at=document.querySelector('[id^="an-"].tab-panel.active');if(at)showAnTab(at.id.replace('an-',''),null);});}
else if(id==='reports'){loadDyeEntriesIfNeeded(renderReports);}
else if(id==='search'){renderSearch();}else if(id==='masters')renderMasters();else if(id==='users')renderUsers();renderAllBev();}
async function updateMachineCap(m,field,val){try{const {ok,error,networkError}=await apiPost('/api/masters/setting',{action:'machineCap',machine:m,field,val,role:State.currentUser?.role});if(networkError)throw new Error(error);if(!ok){showToast(error||'Could not save','err');return;}}catch(e){showToast('Network error — '+e.message,'err');}}
function removeMachine(m){State.DB.masters.machines=State.DB.masters.machines.filter(x=>x!==m);if(State.DB.masters.machineCapacity)delete State.DB.masters.machineCapacity[m];save('masters');renderMasters();}
function spill(q){const v=q.units;const c=v>0?'sp-pos':v===0?'sp-zero':'sp-neg';return`<span class="sp ${c}">${fmtQ(q)}</span>`;}
function stageBadge(s){const c={Soft:'b-soft',Dye:'b-dye',Wind:'b-wind',Pack:'b-pack',RM:'b-rm'};return`<span class="badge ${c[s]||'b-rm'}">${s}</span>`;}
function statusBadge(s){if(s==='Approved'||s==='Edited-Approved')return`<span class="badge b-appr">${s}</span>`;if(s==='Pending'||s==='Edited-Pending')return`<span class="badge b-pend">${s}</span>`;if(s==='InProgress')return`<span class="badge" style="color:var(--ac)">In Progress</span>`;if(s==='Rejected')return`<span class="badge b-void">Rejected</span>`;if(s==='Voided'||s==='Void')return`<span class="badge b-void">Voided</span>`;return`<span class="badge">${s||'—'}</span>`;}
function entryRowClass(status,voided){if(voided||status==='Voided'||status==='Void')return'row-rejected';if(status==='Approved'||status==='Edited-Approved')return'row-approved';if(status==='Pending'||status==='Edited-Pending')return'row-pending';if(status==='InProgress')return'row-inprogress';if(status==='Rejected')return'row-rejected';return'';}
function renderDashboard(){const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';const _adminBtnGroup=document.getElementById('admin-btn-group');if(_adminBtnGroup)_adminBtnGroup.style.display=isAdmin?'flex':'none';const _resetBtn=document.getElementById('reset-all-btn');if(_resetBtn)_resetBtn.style.display=isAdmin?'':'none';renderImbalanceWidget();const allLots=State.DB.lots||[],allDyeLots=State.DB.dyeLots||[];const now=new Date(),dsfn=ts=>ts?Math.floor((now-new Date(ts))/86400000):null;const rmBalU=allLots.reduce((a,l)=>{const b=getRMBalance(l.id,l.grade,l.vendor);return a+(b.units||0);},0);const rmBalKg=allLots.reduce((a,l)=>{const b=getRMBalance(l.id,l.grade,l.vendor);return a+(b.weight||0);},0);
// ── Read from dyeLotSummaries (L1 loaded, all 974 lots, correct totals) ──────
const _dls=Object.values(State.DB.dyeLotSummaries||{});
const dyeKg=_dls.reduce((a,s)=>a+(s.dyeOut?.kg||0),0);
const dyeC=_dls.reduce((a,s)=>a+(s.dyeOut?.cones||0),0);
const dyeL_count=_dls.filter(s=>s.dyeOut&&s.dyeOut.kg>0).length;
const winKg=_dls.reduce((a,s)=>a+(s.windOut?.kg||0),0);
const winC=_dls.reduce((a,s)=>a+(s.windOut?.cones||0),0);
const pakKg=_dls.reduce((a,s)=>a+(s.packOut?.kg||0),0);
const pakB=_dls.reduce((a,s)=>a+(s.packOut?.bags||0),0);
const disKg=_dls.reduce((a,s)=>a+(s.dispatched?.kg||0),0);
const disB=_dls.reduce((a,s)=>a+(s.dispatched?.bags||0),0);
// ── sfKg from lotSummaries (all lots, correct soft totals) ───────────────────
const _ls=Object.values(State.DB.lotSummaries||{});
const rmU=_ls.reduce((a,s)=>a+(s.rmReceived?.units||0),0),rmKg=_ls.reduce((a,s)=>a+(s.rmReceived?.kg||0),0);
const sfKg=_ls.reduce((a,s)=>a+(s.softOut?.kg||0),0);
const sfU=_ls.reduce((a,s)=>a+(s.softOut?.units||0),0); // total soft output bags from summaries
const _isAppr=e=>e.status==='Approved'||e.status==='Edited-Approved';
const pend=(State.DB.stageEntries||[]).filter(e=>e.status==='Pending').length+allDyeLots.filter(d=>d.status==='Pending').length+(State.DB.windEntries||[]).filter(e=>e.status==='Pending').length+(State.DB.packEntries||[]).filter(e=>e.status==='Pending').length+(State.DB.dispatches||[]).filter(d=>d.status==='Pending').length;const scEl=document.getElementById('stat-cards');const _today=today();const _overdueOrders=(State.DB.partyOrders||[]).filter(o=>o.status!=='Completed'&&o.status!=='Cancelled'&&o.due&&o.due<_today).length;const _pendingDisp=Math.max(0,pakKg-disKg);if(scEl)scEl.innerHTML=[{label:'RM Balance',val:fmt(rmBalKg)+'kg',sub:fmt(rmBalU)+'b',c:'var(--cr)',icon:'&#x1F4E6;'},{label:'In Production',val:fmt(sfKg)+'kg',sub:'Soft → Pack pipeline',c:'var(--cs)',icon:'&#x2699;'},{label:'Dye Out',val:fmt(dyeKg)+'kg',sub:fmt(dyeC)+'c · '+dyeL_count+' lots approved',c:'var(--cd)',icon:'&#x1F3A8;'},{label:'Packed',val:fmt(pakKg)+'kg',sub:fmt(pakB)+'b · '+fmt(_pendingDisp)+'kg unshipped',c:_pendingDisp>0?'var(--ye)':'var(--gr)',icon:'&#x1F4E6;'},{label:'Dispatched',val:fmt(disKg)+'kg',sub:fmt(disB)+'b total',c:'var(--gr)',icon:'&#x1F69A;'},{label:'Overdue Orders',val:_overdueOrders,sub:_overdueOrders>0?'Past due date':'All on track',c:_overdueOrders>0?'var(--re)':'var(--gr)',icon:'&#x26A0;'}].map(s=>'<div class="sc" style="--sc-c:'+s.c+'"><div class="sc-icon">'+s.icon+'</div><div class="sc-val">'+s.val+'</div><div class="sc-label">'+s.label+'</div><div class="sc-sub">'+s.sub+'</div></div>').join('');const sfEl=document.getElementById('stage-flow');if(sfEl){const wg=dyeKg>sfKg&&sfKg>0;const bar=(pct,col,label,val)=>'<div class="flow-item"><div class="flow-label-row"><span class="flow-stage" style="color:'+col+'">'+label+'</span><span class="mono" style="font-size:0.7rem;color:var(--mu)">'+val+'</span></div><div class="flow-bar-wrap"><div class="flow-bar" style="width:'+Math.min(pct,120).toFixed(1)+'%;background:'+col+'">'+(pct>0?Math.round(Math.min(pct,120))+'%':'')+'</div></div></div>';sfEl.innerHTML=bar(100,'var(--cr)','RM Total',fmt(rmU)+'b / '+fmt(rmKg)+'kg')+bar(rmKg>0?sfKg/rmKg*100:0,'var(--cs)','Soft Done',fmt(sfU)+'b / '+fmt(sfKg)+'kg')+bar(sfKg>0?dyeKg/sfKg*100:0,'var(--cd)','Dye Out',fmt(dyeC)+'c / '+fmt(dyeKg)+'kg'+(wg?' &#x25b2;':''))+bar(dyeKg>0?winKg/dyeKg*100:0,'var(--cw)','Wind',fmt(winC)+'c / '+fmt(winKg)+'kg')+bar(winKg>0?pakKg/winKg*100:0,'var(--cp)','Pack',fmt(pakB)+'b / '+fmt(pakKg)+'kg')+bar(pakKg>0?disKg/pakKg*100:0,'var(--gr)','Dispatch',fmt(disB)+'b / '+fmt(disKg)+'kg');}
const wsEl=document.getElementById('waste-summary');if(wsEl)wsEl.style.display='none';renderDashRcvVsDis();renderDashPartyDispatch();renderDashAlerts();}
function dashAlertNav(dueVal){nav('party',document.getElementById('ni-party'));setTimeout(function(){let el=document.getElementById('pt-due-filter');if(el){el.value=dueVal;renderPartyTracker();}},200);}
function renderDashAlerts(){const el=document.getElementById('dash-order-alerts');if(!el)return;const _today=today();const _now=new Date();const activeOrders=(State.DB.partyOrders||[]).filter(o=>o.status!=='Completed'&&o.status!=='Cancelled'&&o.due);const overdue=activeOrders.filter(o=>o.due<_today);const dueToday=activeOrders.filter(o=>o.due===_today);const due3=activeOrders.filter(o=>{const days=Math.ceil((new Date(o.due)-_now)/(1000*60*60*24));return days>0&&days<=3;});if(!overdue.length&&!dueToday.length&&!due3.length){el.innerHTML='<div style="display:flex;align-items:center;gap:8px;padding:16px 0;">'+'<span style="font-size:1rem">✅</span>'+'<span style="font-size:0.78rem;color:var(--gr);font-weight:700">All orders on track</span>'+'</div>';return;}
const rows=[];if(overdue.length)rows.push('<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--b1)">'+'<span style="font-size:0.95rem">🔴</span>'+'<span style="font-size:0.78rem;font-weight:700;color:var(--re)">Overdue: '+overdue.length+' order'+(overdue.length>1?'s':'')+'</span>'+'<span style="font-size:0.7rem;color:var(--mu)">'+overdue.slice(0,3).map(o=>o.party).join(', ')+(overdue.length>3?'...':'')+'</span>'+'<button class="btn btn-ghost btn-xs" style="margin-left:auto" onclick="dashAlertNav(\"overdue\")">View →</button>'+'</div>');if(dueToday.length)rows.push('<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--b1)">'+'<span style="font-size:0.95rem">🟠</span>'+'<span style="font-size:0.78rem;font-weight:700;color:#f97316">Due Today: '+dueToday.length+' order'+(dueToday.length>1?'s':'')+'</span>'+'<span style="font-size:0.7rem;color:var(--mu)">'+dueToday.slice(0,3).map(o=>o.party).join(', ')+(dueToday.length>3?'...':'')+'</span>'+'<button class="btn btn-ghost btn-xs" style="margin-left:auto" onclick="dashAlertNav(\"1\")">View →</button>'+'</div>');if(due3.length)rows.push('<div style="display:flex;align-items:center;gap:10px;padding:6px 0">'+'<span style="font-size:0.95rem">🟡</span>'+'<span style="font-size:0.78rem;font-weight:700;color:var(--ye)">Due in 3 days: '+due3.length+' order'+(due3.length>1?'s':'')+'</span>'+'<span style="font-size:0.7rem;color:var(--mu)">'+due3.slice(0,3).map(o=>o.party).join(', ')+(due3.length>3?'...':'')+'</span>'+'<button class="btn btn-ghost btn-xs" style="margin-left:auto" onclick="dashAlertNav(\"4\")">View →</button>'+'</div>');el.innerHTML=rows.join('');}
function setDashPeriod(p,btn){
  State._dashPeriod=p;
  document.querySelectorAll('.dash-period-btn').forEach(b=>b.classList.remove('active-period'));
  if(btn)btn.classList.add('active-period');
  renderDashRcvVsDis();
  renderDashPartyDispatch();
}
function _dashDateFilter(ts){if(!ts)return false;const d=new Date(ts);const now=new Date();if(State._dashPeriod==='week'){const w=new Date(now);w.setDate(w.getDate()-7);return d>=w;}
if(State._dashPeriod==='month'){const m=new Date(now);m.setDate(m.getDate()-30);return d>=m;}
return true;}
function renderDashRcvVsDis(){const el=document.getElementById('dash-rcv-vs-dis');if(!el)return;const allLots=State.DB.lots||[];const allDisps=(State.DB.dispatches||[]).filter(d=>d.status==='Approved');const disFiltered=allDisps.filter(d=>_dashDateFilter(d.timestamp));
// For "All" period use lotSummaries for consistent total (same as Stage Flow)
// For month/week use DB.lots filtered by date
let rcvKg,rcvU;
if(State._dashPeriod==='all'){
  const _lsArr=Object.values(State.DB.lotSummaries||{});
  rcvKg=_lsArr.reduce((a,s)=>a+(s.rmReceived?.kg||0),0);
  rcvU=_lsArr.reduce((a,s)=>a+(s.rmReceived?.units||0),0);
} else {
  const rcvLots=allLots.filter(l=>_dashDateFilter(l.receivedAt||l.date+'T00:00:00'));
  rcvKg=rcvLots.reduce((a,l)=>a+(l.weight||0),0);
  rcvU=rcvLots.reduce((a,l)=>a+(l.units||0),0);
}let disKgF,disBF;
if(State._dashPeriod==='all'){
  const _lsArr2=Object.values(State.DB.lotSummaries||{});
  disKgF=_lsArr2.reduce((a,s)=>a+(s.dispatched?.kg||0),0);
  disBF=_lsArr2.reduce((a,s)=>a+(s.dispatched?.bags||0),0);
}else{
  disKgF=disFiltered.reduce((a,d)=>a+(d.weight||0),0);
  disBF=disFiltered.reduce((a,d)=>a+(d.bags||0),0);
}
const maxK=Math.max(rcvKg,disKgF,1);const pctR=Math.min(100,(rcvKg/maxK*100)).toFixed(1);const pctD=Math.min(100,(disKgF/maxK*100)).toFixed(1);el.innerHTML=`
    <div style="margin-bottom:16px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px"><span style="font-size:0.72rem;font-weight:700;color:var(--cr)">📦 Received</span><span style="font-family:monospace;font-size:0.82rem;font-weight:700;color:var(--cr)">${fmt(rcvU)}b / ${fmt(rcvKg)}kg</span></div><div style="background:var(--s3);border-radius:6px;height:10px;overflow:hidden"><div style="width:${pctR}%;height:100%;background:var(--cr);border-radius:6px;transition:width 0.4s"></div></div></div><div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px"><span style="font-size:0.72rem;font-weight:700;color:var(--gr)">🚚 Dispatched</span><span style="font-family:monospace;font-size:0.82rem;font-weight:700;color:var(--gr)">${fmt(disBF)}b / ${fmt(disKgF)}kg</span></div><div style="background:var(--s3);border-radius:6px;height:10px;overflow:hidden"><div style="width:${pctD}%;height:100%;background:var(--gr);border-radius:6px;transition:width 0.4s"></div></div></div><div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--b1);display:flex;justify-content:space-between;font-size:0.7rem;color:var(--mu)"><span>In pipeline: <strong style="color:var(--ye)">${fmt(rcvKg-disKgF)}kg</strong></span><span>Dispatched: <strong style="color:var(--gr)">${rcvKg>0?(disKgF/rcvKg*100).toFixed(1):0}% of received</strong></span></div>`;}
function renderDashPartyDispatch(){const el=document.getElementById('dash-party-dispatch');if(!el)return;
let parties;
if(State._dashPeriod==='all'){
  // All Time — read from pre-computed partySummaries, never touches archive directly
  const summaries=State.DB.partySummaries||{};
  const partyMap={};
  Object.values(summaries).forEach(s=>{
    if(!s.party)return;
    const lots={};
    Object.entries(s.shades||{}).forEach(([shade,sd])=>{
      Object.entries(sd.dyeLots||{}).forEach(([dyeLotId,dl])=>{
        lots[dyeLotId+'||'+shade]={dyeLotNo:dl.dyeLotNo||'?',dyeLotId,shade,kg:dl.kg||0,bags:dl.bags||0};
      });
    });
    partyMap[s.party]={totalKg:s.totalKg||0,totalBags:s.totalBags||0,lastTs:s.lastDispatchDate||'',lots};
  });
  parties=Object.entries(partyMap).sort((a,b)=>b[1].totalKg-a[1].totalKg).slice(0,6);
} else {
  // Week/Month — live scan of active dispatches (recent data is always active, so this stays free)
  const allDisps=(State.DB.dispatches||[]).filter(d=>d.status==='Approved'&&_dashDateFilter(d.timestamp));const partyMap={};allDisps.forEach(d=>{if(!d.party)return;if(!partyMap[d.party])partyMap[d.party]={totalKg:0,totalBags:0,lastTs:'',lots:{}};partyMap[d.party].totalKg+=(d.weight||0);partyMap[d.party].totalBags+=(d.bags||0);if((d.timestamp||'')>partyMap[d.party].lastTs)partyMap[d.party].lastTs=d.timestamp||'';const key=(d.dyeLotNo||'?')+'||'+(d.shade||'?');if(!partyMap[d.party].lots[key])partyMap[d.party].lots[key]={dyeLotNo:d.dyeLotNo||'?',dyeLotId:d.dyeLotId||'',shade:d.shade||'?',kg:0,bags:0,lastTs:''};partyMap[d.party].lots[key].kg+=(d.weight||0);partyMap[d.party].lots[key].bags+=(d.bags||0);if((d.timestamp||'')>partyMap[d.party].lots[key].lastTs)partyMap[d.party].lots[key].lastTs=d.timestamp||'';});
  parties=Object.entries(partyMap).sort((a,b)=>b[1].totalKg-a[1].totalKg).slice(0,6);
}
if(!parties.length){el.innerHTML='<div style="padding:14px;color:var(--mu);font-size:0.8rem">No dispatches in this period</div>';return;}
const expanded=window._dashPartyExp||{};el.innerHTML=parties.map(([party,data])=>{const lots=Object.values(data.lots).sort((a,b)=>b.kg-a.kg);const isExp=expanded[party];const lastDate=data.lastTs?new Date(data.lastTs).toLocaleDateString('en-GB'):'—';return`<div style="border-bottom:1px solid var(--b1)"><div onclick="window._dashPartyExp=window._dashPartyExp||{};window._dashPartyExp['${party}']=!window._dashPartyExp['${party}'];renderDashPartyDispatch();"
        style="display:flex;justify-content:space-between;align-items:center;padding:10px 4px;cursor:pointer"><div><span onclick="event.stopPropagation();nav('party',document.getElementById('ni-party'));setTimeout(()=>{const s=document.getElementById('pt-party-filter');if(s){s.value='${party}';renderPartyTracker();}},200);"
            style="font-size:0.8rem;font-weight:700;color:var(--tx);text-decoration:underline;cursor:pointer">${party}</span><span style="font-size:0.65rem;color:var(--mu);margin-left:8px">Last: ${lastDate}</span></div><div style="display:flex;align-items:center;gap:10px"><span style="font-family:monospace;font-size:0.8rem;font-weight:700;color:var(--gr)">${fmt(data.totalKg)}kg</span><span style="color:var(--mu);font-size:0.75rem">${isExp?'▲':'▼'}</span></div></div>
      ${isExp?`<div style="padding:0 4px 10px 12px">${lots.map(l=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:0.72rem;"><div><span onclick="openDyeLifecycle('${l.dyeLotId}')" style="color:var(--ac);font-weight:700;cursor:pointer;font-family:monospace">${l.dyeLotNo}</span><span style="color:var(--mu);margin-left:6px">${l.shade}</span></div><span style="color:var(--tx);font-family:monospace">${l.bags}b / ${fmt(l.kg)}kg</span></div>`).join('')}</div>`:''}
    </div>`;}).join('')+'<div style="padding:8px 4px;text-align:right"><span onclick="nav(&quot;party&quot;,document.getElementById(&quot;ni-party&quot;))" style="font-size:0.68rem;color:var(--ac);cursor:pointer;font-weight:700">View all &#x2192; Party Tracker</span></div>';}
function renderStageTable(){const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';const isSup=State.currentUser?.role==='supervisor'||isAdmin;const _sefLot=document.getElementById('sef-lot')?.value||'';const _sefVendor=document.getElementById('sef-vendor')?.value||'';const _sefGrade=document.getElementById('sef-grade')?.value||'';const _sefStatus=document.getElementById('sef-status')?.value||'';const allSE=State.DB.stageEntries||[];const se_lots=[...new Set(allSE.filter(e=>(!_sefVendor||e.vendor===_sefVendor)&&(!_sefGrade||e.grade===_sefGrade)&&(!_sefStatus||e.status===_sefStatus)).map(e=>e.lotId).filter(Boolean))].sort();const se_vendors=[...new Set(allSE.filter(e=>(!_sefLot||e.lotId===_sefLot)&&(!_sefGrade||e.grade===_sefGrade)&&(!_sefStatus||e.status===_sefStatus)).map(e=>e.vendor).filter(Boolean))].sort();const se_grades=[...new Set(allSE.filter(e=>(!_sefLot||e.lotId===_sefLot)&&(!_sefVendor||e.vendor===_sefVendor)&&(!_sefStatus||e.status===_sefStatus)).map(e=>e.grade).filter(Boolean))].sort();const se_statuses=[...new Set(allSE.filter(e=>(!_sefLot||e.lotId===_sefLot)&&(!_sefVendor||e.vendor===_sefVendor)&&(!_sefGrade||e.grade===_sefGrade)).map(e=>e.status).filter(Boolean))].sort();const seThead=document.getElementById('se-thead');if(seThead){seThead.innerHTML=`
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
        <th>Actions</th></tr>`;if(_sefLot)document.getElementById('sef-lot').value=_sefLot;if(_sefVendor)document.getElementById('sef-vendor').value=_sefVendor;if(_sefGrade)document.getElementById('sef-grade').value=_sefGrade;if(_sefStatus)document.getElementById('sef-status').value=_sefStatus;_restoreFilterBtns('sef-lot','sef-vendor','sef-grade','sef-status');}
const _seFiltered=[...State.DB.stageEntries].filter(e=>(!_sefLot||e.lotId===_sefLot)&&(!_sefVendor||e.vendor===_sefVendor)&&(!_sefGrade||e.grade===_sefGrade)&&(!_sefStatus||e.status===_sefStatus));const entries=_sortState.se.col?sortArr(_seFiltered,_sortState.se.col,_sortState.se.dir):_seFiltered.sort((a,b)=>(b.startTime||'').localeCompare(a.startTime||''));document.getElementById('se-tbody').innerHTML=entries.map(e=>{const wp=e.inWeight>0?pct(e.wasteWeight||0,e.inWeight):'—';const dur=e.startTime&&e.endTime?((new Date(e.endTime)-new Date(e.startTime))/3600000).toFixed(1)+'h':'—';const canEdit=(State.currentUser?.role==='supervisor'||State.currentUser?.role==='manager'||State.currentUser?.role==='admin')&&e.status!=='Void';const canVoidReq=(State.currentUser?.role==='supervisor'||State.currentUser?.role==='manager'||State.currentUser?.role==='admin')&&e.status!=='Void';const canOverride=State.currentUser?.role==='admin'&&(e.status==='Approved'||e.status==='Rejected');const noteStyle='font-size:0.68rem;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';const _stVendor=e.vendor||(State.DB.lots.find(l=>l.id===e.lotId&&l.grade===e.grade)||State.DB.lots.find(l=>l.id===e.lotId)||{}).vendor||'';const _stVendorMatches=(State.DB.lots.filter(l=>l.id===e.lotId&&l.grade===e.grade)||[]).length;const _stVendorAmbig=!e.vendor&&_stVendorMatches>1;const _seDays=e.startTime?Math.floor((new Date()-new Date(e.startTime))/86400000):null;return`<tr class="${entryRowClass(e.status,e.voided)}"><td style="vertical-align:top;color:var(--ac);font-weight:700;cursor:pointer" class="mono" onclick="nav('lifecycle',document.getElementById('ni-lifecycle'));document.getElementById('lc-select').value='${e.lotId}';renderLifecycle()">${e.lotId}</td><td style="vertical-align:top"><span class="badge b-rm">${e.grade||''}</span></td><td style="vertical-align:top;font-size:0.72rem;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${_stVendorAmbig?'var(--re)':'var(--tx)'};" title="${_stVendorAmbig?'⚠ Vendor unknown — void and re-enter':_stVendor}">${_stVendorAmbig?'⚠ Unknown':_stVendor||'—'}</td><td style="vertical-align:top" class="mono">${qtyCell(e.inUnits,e.inWeight,'b')}</td><td style="vertical-align:top" class="mono">${qtyCell(e.outUnits,e.outWeight,'b')}</td>${wasteCell(e.wasteUnits,e.wasteWeight,wp,'b')}${wastePctCell(wp)}<td style="vertical-align:top">${agingBadge(_seDays)}</td>${mwCell(e.machine)}${mwCell(e.startWorker)}${dtCell(e.startTime)}${dtCell(e.endTime)}<td style="vertical-align:top">${statusBadge(e.voided?'Void':e.status)}</td><td style="vertical-align:top;white-space:nowrap;display:flex;gap:3px;">
        ${(e.status==='Pending'||e.status==='Edited-Pending')&&isSup?`<button class="btn btn-success btn-xs tc-tip" data-tip="Approve" onclick="approveEntry('${e.id}','stage')">✓</button><button class="btn btn-danger btn-xs tc-tip" data-tip="Reject" onclick="rejectEntry('${e.id}','stage')">✗</button>`:''}

        ${(e.status==='Approved'||e.status==='Edited-Approved')&&isAdmin?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Edit" onclick="openEditEntryModal('${e.id}','soft')">✏</button><button class="btn btn-ghost btn-xs tc-tip" data-tip="Void" style="color:var(--re)" onclick="openVoidModal('${e.id}','soft')">🗑</button>`:''}
        ${(e.status==='Rejected'||e.status==='Voided')&&isAdmin?`<button class="btn btn-success btn-xs"onclick="openOverride('${e.id}','stage')">↩ Override</button><button class="btn btn-ghost btn-xs tc-tip" data-tip="Void" style="color:var(--re)" onclick="openVoidModal('${e.id}','soft')">🗑</button>`:''}
      </td></tr>`;}).join('')||'<tr><td colspan="23"><div class="empty"><div class="empty-icon">⚙</div><div class="empty-text">✕ No entries yet — select a lot and start a stage entry</div></div></td></tr>';renderBevSoftReady();renderBevSoftPending();setTimeout(fitBevTableHeight,0);}
function renderApproval(){switchApprTab(State._apprTab||'soft');}
function validateEntry(e){if(!e.endTime&&e.status==='InProgress')return{ok:true};const _veLot=State.DB.lots.find(l=>l.id===e.lotId&&(l.grade===e.grade||!e.grade))||getLot(e.lotId);if((e.outUnits||0)>(e.inUnits||0)+0.01)return{ok:false,msg:'Output exceeds Input'};if((e.outWeight||0)>(e.inWeight||0)+0.01)return{ok:false,msg:'Output weight exceeds Input weight'};return{ok:true};}
function validateDye(b){if((b.outUnits||0)>(b.totalInUnits||0)+0.01)return{ok:false,msg:'Output exceeds Input'};if((b.outWeight||0)>(b.totalInWeight||0)+0.01)return{ok:false,msg:'Output weight exceeds Input'};return{ok:true};}
function editEntry(id,type,field,val){if(type==='stage'){const e=State.DB.stageEntries.find(x=>x.id===id);if(e){if(field==='outUnits'&&val>e.inUnits+0.01){showAlert(`Output (${val}u) cannot exceed input (${fmt(e.inUnits)}u) — value not changed`,'Invalid Value');renderApproval();return;}
if(field==='outWeight'&&val>e.inWeight+0.01){showAlert(`Output weight (${val}kg) cannot exceed input (${fmt(e.inWeight)}kg) — value not changed`,'Invalid Value');renderApproval();return;}
e[field]=val;recalcWaste(e);save('stageEntries',e);}}else{const b=[...(State.DB.dyeBatches||[]),...(State.DB.dyeEntries||[])].find(x=>x.id===id);if(b){if(field==='outUnits'&&val>b.totalInUnits+0.01){alert(`Output (${val}u) cannot exceed input (${fmt(b.totalInUnits)}u) — value not changed`);renderApproval();return;}
b[field]=val;recalcDyeWaste(b);save('dyeLots',b);}}
renderAll();}
function recalcWaste(e){e.wasteUnits=fU((e.inUnits||0)-(e.outUnits||0));e.wasteWeight=fW((e.inWeight||0)-(e.outWeight||0));}
function recalcDyeWaste(b){b.wasteUnits=fU((b.totalInUnits||0)-(b.outUnits||0));b.wasteWeight=fW((b.totalInWeight||0)-(b.outWeight||0));}
async function approveEntry(id,type){
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
async function rejectEntry(id,type){
try{
  const {ok,error,networkError}=await apiPost('/api/reject',{type,id,changedBy:State.currentUser?.name,role:State.currentUser?.role});
  if(networkError)throw new Error(error);
  if(!ok){showToast(error||'Reject failed','err');return;}
  renderAll();
}catch(e){showToast('Network error — '+e.message,'err');}
}
function approveAll(){approveAllCurrentTab();}
function openOverride(id,type){if(State.currentUser?.role!=='admin'&&State.currentUser?.role!=='manager'){showToast('Admin only','err');return;}
const _ovColls={stage:State.DB.stageEntries,dye:State.DB.dyeLots,wind:State.DB.windEntries,pack:State.DB.packEntries,dispatch:State.DB.dispatches};const e=(_ovColls[type]||[]).find(x=>x.id===id);if(!e){showToast('Entry not found','err');return;}
if(e.status!=='Rejected'&&e.status!=='Voided'){showToast('Only Rejected or Voided entries can be brought back','err');return;}
document.getElementById('override-entry-id').value=id;document.getElementById('override-entry-type').value=type;document.getElementById('override-alert').innerHTML='';document.getElementById('override-reason-cat').value='';document.getElementById('override-reason-text').value='';document.getElementById('override-pwd').value='';const infoLines=[`<strong>${type.toUpperCase()} Entry</strong> — ID: ${id}`,`Status: <strong>${e.status}</strong>`];if(e.lotId)infoLines.push(`Lot: ${e.lotId} | Grade: ${e.grade||'—'}`);if(e.dyeLotNo)infoLines.push(`Dye Lot: ${e.dyeLotNo} | Shade: ${e.shade||'—'}`);document.getElementById('override-entry-info').innerHTML=infoLines.join('<br>');const fg=(label,fid,val,t='text')=>`<div class="fg"><label class="fl">${label}</label><input class="fi" type="${t}" id="${fid}" value="${val??''}"></div>`;let fields='';if(type==='stage')fields=fg('In Units','ov-inUnits',e.inUnits,'number')+fg('In Weight','ov-inWeight',e.inWeight,'number')+fg('Out Units','ov-outUnits',e.outUnits??'','number')+fg('Out Weight','ov-outWeight',e.outWeight??'','number');else if(type==='dye')fields=fg('Dye Lot No','ov-dyeLotNo',e.dyeLotNo)+fg('Shade','ov-shade',e.shade)+fg('In Cones','ov-totalInCones',e.totalInCones,'number')+fg('In Kg','ov-totalInWeight',e.totalInWeight,'number')+fg('Out Cones','ov-outCones',e.outCones,'number')+fg('Out Kg','ov-outWeight',e.outWeight,'number');else if(type==='wind')fields=fg('In Cones','ov-inCones',e.inCones,'number')+fg('In Kg','ov-inWeight',e.inWeight,'number')+fg('Out Cones','ov-outCones',e.outCones??'','number')+fg('Out Kg','ov-outWeight',e.outWeight??'','number');else if(type==='pack')fields=fg('In Cones','ov-inCones',e.inCones,'number')+fg('Bags Out','ov-bags',e.bags,'number')+fg('Weight (kg)','ov-weight',e.weight,'number');else if(type==='dispatch')fields=fg('Bags','ov-bags',e.bags,'number')+fg('Weight (kg)','ov-weight',e.weight,'number');document.getElementById('override-fields').innerHTML=fields;openModal('override-modal-overlay');}
async function submitOverride(){const setAlert=msg=>{document.getElementById('override-alert').innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;};const id=document.getElementById('override-entry-id').value;const type=document.getElementById('override-entry-type').value;const reasonCat=document.getElementById('override-reason-cat').value;const reasonText=document.getElementById('override-reason-text').value.trim();const pwd=document.getElementById('override-pwd').value;if(!reasonCat){setAlert('Select override reason');return;}
if(reasonText.length<10){setAlert('Provide reason detail (min 10 chars)');return;}
if(!pwd){setAlert('Enter your password to confirm');return;}
const gv=fid=>document.getElementById(fid)?.value??null;const fields={};
if(type==='stage'){fields.inUnits=gv('ov-inUnits');fields.inWeight=gv('ov-inWeight');fields.outUnits=gv('ov-outUnits');fields.outWeight=gv('ov-outWeight');}
else if(type==='dye'){fields.dyeLotNo=gv('ov-dyeLotNo');fields.shade=gv('ov-shade');fields.totalInCones=gv('ov-totalInCones');fields.totalInWeight=gv('ov-totalInWeight');fields.outCones=gv('ov-outCones');fields.outWeight=gv('ov-outWeight');}
else if(type==='wind'){fields.inCones=gv('ov-inCones');fields.inWeight=gv('ov-inWeight');fields.outCones=gv('ov-outCones');fields.outWeight=gv('ov-outWeight');}
else if(type==='pack'){fields.inCones=gv('ov-inCones');fields.bags=gv('ov-bags');fields.weight=gv('ov-weight');}
else if(type==='dispatch'){fields.bags=gv('ov-bags');fields.weight=gv('ov-weight');}
// Server's _OVERRIDE_TABLE keys differ slightly from the natural type
// names used in the UI (dyeLot/windEntry/packEntry, not dye/wind/pack).
const _serverType={stage:'stage',dye:'dyeLot',wind:'windEntry',pack:'packEntry',dispatch:'dispatch'}[type]||type;
try{
  const {ok,data,error,networkError}=await apiPost('/api/override-approve',{type:_serverType,id,fields,password:pwd,username:State.currentUser.username,reasonCat,reasonText,changedBy:State.currentUser.name});
  if(networkError)throw new Error(error);
  if(!ok){setAlert(error||'Could not bring back entry');return;}
  closeModal('override-modal-overlay');renderAll();showToast('Entry brought back ✓','warn');
}catch(e){setAlert('Network error — not saved: '+e.message);}
}
function setRptFilter(tab,preset,el){
  if(preset==='all'){
    _fetchReportSummaries(()=>{
      rptState[tab]={from:'2020-01-01',to:new Date().toISOString().slice(0,10),isAllTime:true};
      const fromEl=document.getElementById(`rpt-${tab}-from`);const toEl=document.getElementById(`rpt-${tab}-to`);
      if(fromEl)fromEl.value=rptState[tab].from;if(toEl)toEl.value=rptState[tab].to;
      if(el){el.closest('.dfb-quick').querySelectorAll('.dfb-qbtn').forEach(b=>b.classList.remove('active'));el.classList.add('active');}
      renderReports();
    });
    return;
  }
const r=dateRange(preset);rptState[tab]={from:r.from,to:r.to,isAllTime:false};const fromEl=document.getElementById(`rpt-${tab}-from`);const toEl=document.getElementById(`rpt-${tab}-to`);if(fromEl)fromEl.value=r.from;if(toEl)toEl.value=r.to;if(el){el.closest('.dfb-quick').querySelectorAll('.dfb-qbtn').forEach(b=>b.classList.remove('active'));el.classList.add('active');}
renderReports();}
function getRptRange(tab){const fromEl=document.getElementById(`rpt-${tab}-from`);const toEl=document.getElementById(`rpt-${tab}-to`);const from=fromEl?.value||rptState[tab]?.from||'';const to=toEl?.value||rptState[tab]?.to||'';return{from,to};}
function filterByRange(arr,tsField,from,to){return arr.filter(e=>inRange(e[tsField]||e.date,from,to));}
function showAnTab(id,el){document.querySelectorAll('[id^="an-"].tab-panel').forEach(p=>{p.style.display='none';p.classList.remove('active');});document.querySelectorAll('.an-tab').forEach(t=>t.classList.remove('active'));const panel=document.getElementById(`an-${id}`);if(panel){panel.style.display='';panel.classList.add('active');}
if(el)el.classList.add('active');if(id==='daily-log')renderAnDailyLog();else if(id==='comparison')renderComparison();else if(id==='trend')renderTrend();else if(id==='worker-sc')renderWorkerScorecard();else if(id==='machine-health')renderMachineHealth();}
function setAnDate(preset,el){const r=dateRange(preset);const inp=document.getElementById('an-daily-date');if(inp)inp.value=r.from;if(el){el.parentNode.querySelectorAll('.dfb-qbtn').forEach(b=>b.classList.remove('active'));el.classList.add('active');}
renderAnDailyLog();}
function setCmpQuick(preset){let aFrom,aTo,bFrom,bTo;if(preset==='this_vs_last_week'){const tw=dateRange('week');const lw=dateRange('last_week');aFrom=lw.from;aTo=lw.to;bFrom=tw.from;bTo=tw.to;}else{const tm=dateRange('month');const lm=dateRange('last_month');aFrom=lm.from;aTo=lm.to;bFrom=tm.from;bTo=tm.to;}
document.getElementById('cmp-a-from').value=aFrom;document.getElementById('cmp-a-to').value=aTo;document.getElementById('cmp-b-from').value=bFrom;document.getElementById('cmp-b-to').value=bTo;renderComparison();}
function renderComparison(){const el=document.getElementById('cmp-content');if(!el)return;const by=document.getElementById('cmp-by')?.value||'factory';const aFrom=document.getElementById('cmp-a-from')?.value;const aTo=document.getElementById('cmp-a-to')?.value;const bFrom=document.getElementById('cmp-b-from')?.value;const bTo=document.getElementById('cmp-b-to')?.value;if(!aFrom||!bFrom){el.innerHTML='<div class="empty"><div class="empty-icon">⚖</div><div class="empty-text">ℹ Select Period A and Period B above to compare performance</div></div>';return;}
const filter=(arr,tsF,f,t)=>arr.filter(e=>inRange(e[tsF]||e.date,f,t));const calcStats=(entries,dyes,f,t)=>{const se=filter(appr(entries).filter(e=>e.endTime),['endTime'],f,t);const dy=filter(appr(dyes),['endTime'],f,t);const allE=[...se,...dy];const inU=allE.reduce((a,e)=>a+(e.inUnits||e.totalInUnits||0),0);const outU=allE.reduce((a,e)=>a+(e.outUnits||0),0);const wasteU=allE.reduce((a,e)=>a+(e.wasteUnits||0),0);const hrs=allE.reduce((a,e)=>a+hrsBetween(e.startTime,e.endTime),0);const runs=allE.length;return{inU,outU,wasteU,hrs,runs,wasteP:inU>0?Math.max(0,wasteU)/inU*100:0};};const delta=(a,b,lowerBetter=false)=>{if(!a&&!b)return'<span class="cmp-delta delta-neu">—</span>';const d=b-a;const pct=a>0?((d/a)*100).toFixed(1):'—';const better=lowerBetter?d<0:d>0;const cls=d===0?'delta-neu':better?'delta-pos':'delta-neg';const sign=d>0?'+':'';return`<span class="cmp-delta ${cls}">${sign}${pct}%</span>`;};const renderMetrics=(statsA,statsB,labelA,labelB)=>`
    <div class="card gap-b"><div class="cmp-hdr"><span></span><span class="cmp-hdr-label" style="color:var(--bl)">${labelA}</span><span class="cmp-hdr-label" style="color:var(--ac)">${labelB}</span></div>
      ${[
        {m:'Output Units',a:fmt(statsA.outU)+'u',b:fmt(statsB.outU)+'u',d:delta(statsA.outU,statsB.outU)},
        {m:'Input Units',a:fmt(statsA.inU)+'u',b:fmt(statsB.inU)+'u',d:delta(statsA.inU,statsB.inU)},
        {m:'Wastage Units',a:fmt(statsA.wasteU)+'u',b:fmt(statsB.wasteU)+'u',d:delta(statsA.wasteU,statsB.wasteU,true)},
        {m:'Wastage %',a:statsA.wasteP.toFixed(1)+'%',b:statsB.wasteP.toFixed(1)+'%',d:delta(statsA.wasteP,statsB.wasteP,true)},
        {m:'Processing Hours',a:fmtHrs(statsA.hrs),b:fmtHrs(statsB.hrs),d:delta(statsA.hrs,statsB.hrs)},
        {m:'Runs Completed',a:statsA.runs,b:statsB.runs,d:delta(statsA.runs,statsB.runs)},
      ].map(r=>`<div class="cmp-row"><div class="cmp-metric">${r.m}</div><div class="cmp-a">${r.a}</div><div style="display:flex;align-items:center;gap:8px;"><div class="cmp-b">${r.b}</div>${r.d}</div></div>`).join('')}
    </div>`;const labelA=`${aFrom} → ${aTo}`;const labelB=`${bFrom} → ${bTo}`;const _dyeAsEntries=(State.DB.dyeLots||[]).map(dl=>({...dl,worker:dl.endWorker||dl.startWorker,outUnits:dl.outCones||0,inUnits:dl.totalInCones||0,totalInUnits:dl.totalInCones||0,wasteUnits:dl.coneLoss||0}));if(by==='factory'){const sA=calcStats(State.DB.stageEntries,_dyeAsEntries,aFrom,aTo);const sB=calcStats(State.DB.stageEntries,_dyeAsEntries,bFrom,bTo);el.innerHTML=renderMetrics(sA,sB,labelA,labelB);}else if(by==='stage'){const stages=['Soft','Dye','Wind','Pack'];el.innerHTML=stages.map(s=>{const seA=filter(appr(State.DB.stageEntries).filter(e=>e.stage===s&&e.endTime),['endTime'],aFrom,aTo);const seB=filter(appr(State.DB.stageEntries).filter(e=>e.stage===s&&e.endTime),['endTime'],bFrom,bTo);const dyA=s==='Dye'?filter(appr(_dyeAsEntries),['endTime'],aFrom,aTo):[];const dyB=s==='Dye'?filter(appr(_dyeAsEntries),['endTime'],bFrom,bTo):[];const mk=(se,dy)=>{const allE=[...se,...dy];return{outU:allE.reduce((a,e)=>a+(e.outUnits||0),0),inU:allE.reduce((a,e)=>a+(e.inUnits||e.totalInUnits||0),0),wasteU:allE.reduce((a,e)=>a+(e.wasteUnits||0),0),hrs:allE.reduce((a,e)=>a+hrsBetween(e.startTime,e.endTime),0),runs:allE.length,wasteP:0};};const sA=mk(seA,dyA);sA.wasteP=sA.inU>0?sA.wasteU/sA.inU*100:0;const sB=mk(seB,dyB);sB.wasteP=sB.inU>0?sB.wasteU/sB.inU*100:0;return`<div style="margin-bottom:6px;font-size:0.72rem;font-weight:700;color:${SCOL[s]};padding:4px 0;">${s}</div>`+renderMetrics(sA,sB,labelA,labelB);}).join('');}else if(by==='worker'){const workers=[...new Set([...appr(State.DB.stageEntries).map(e=>e.endWorker||e.startWorker),...appr(_dyeAsEntries).map(b=>b.worker)].filter(Boolean))];el.innerHTML=workers.map(w=>{const mk=(f,t)=>{const allE=[...filter(appr(State.DB.stageEntries).filter(e=>e.endTime&&(e.endWorker===w||e.startWorker===w)),['endTime'],f,t),...filter(appr(_dyeAsEntries).filter(b=>b.worker===w),['endTime'],f,t)];return{outU:allE.reduce((a,e)=>a+(e.outUnits||0),0),inU:allE.reduce((a,e)=>a+(e.inUnits||e.totalInUnits||0),0),wasteU:allE.reduce((a,e)=>a+(e.wasteUnits||0),0),hrs:allE.reduce((a,e)=>a+hrsBetween(e.startTime,e.endTime),0),runs:allE.length,wasteP:0};};const sA=mk(aFrom,aTo);sA.wasteP=sA.inU>0?sA.wasteU/sA.inU*100:0;const sB=mk(bFrom,bTo);sB.wasteP=sB.inU>0?sB.wasteU/sB.inU*100:0;return`<div style="margin-bottom:6px;font-size:0.72rem;font-weight:700;color:var(--pu);padding:4px 0;">👤 ${w}</div>`+renderMetrics(sA,sB,labelA,labelB);}).join('');}else if(by==='machine'){const machines=[...new Set([...appr(State.DB.stageEntries).map(e=>e.machine),...appr(_dyeAsEntries).map(b=>b.machine)].filter(Boolean))];el.innerHTML=machines.map(m=>{const mk=(f,t)=>{const allE=[...filter(appr(State.DB.stageEntries).filter(e=>e.endTime&&e.machine===m),['endTime'],f,t),...filter(appr(_dyeAsEntries).filter(b=>b.machine===m),['endTime'],f,t)];return{outU:allE.reduce((a,e)=>a+(e.outUnits||0),0),inU:allE.reduce((a,e)=>a+(e.inUnits||e.totalInUnits||0),0),wasteU:allE.reduce((a,e)=>a+(e.wasteUnits||0),0),hrs:allE.reduce((a,e)=>a+hrsBetween(e.startTime,e.endTime),0),runs:allE.length,wasteP:0};};const sA=mk(aFrom,aTo);sA.wasteP=sA.inU>0?sA.wasteU/sA.inU*100:0;const sB=mk(bFrom,bTo);sB.wasteP=sB.inU>0?sB.wasteU/sB.inU*100:0;return`<div style="margin-bottom:6px;font-size:0.72rem;font-weight:700;color:var(--cy);padding:4px 0;">⚙ ${m}</div>`+renderMetrics(sA,sB,labelA,labelB);}).join('');}}
function setTrendGroup(g,el){State.anTrendGroup=g;document.getElementById('trend-week-btn').classList.toggle('active',g==='week');document.getElementById('trend-month-btn').classList.toggle('active',g==='month');renderTrend();}
function setMHPeriod(p,el){State.anMHPeriod=p;document.getElementById('mh-4w-btn').classList.toggle('active',p==='4weeks');document.getElementById('mh-3m-btn').classList.toggle('active',p==='3months');renderMachineHealth();}
function getPeriodBuckets(){const buckets=[];const now=new Date();if(State.anTrendGroup==='week'){for(let i=7;i>=0;i--){const s=new Date(now);s.setDate(s.getDate()-s.getDay()+1-i*7);const e=new Date(s);e.setDate(e.getDate()+6);const pad=n=>String(n).padStart(2,'0');const f=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;buckets.push({label:`W${i===0?'(curr)':i+'w ago'}`,from:f(s),to:f(e)});}}else{for(let i=5;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);const end=new Date(d.getFullYear(),d.getMonth()+1,0);const pad=n=>String(n).padStart(2,'0');const f=dt=>`${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`;buckets.push({label:d.toLocaleString('en-IN',{month:'short'}),from:f(d),to:f(end)});}}
return buckets;}
function renderTrend(){const el=document.getElementById('trend-content');if(!el)return;const metric=document.getElementById('trend-metric')?.value||'output';const split=document.getElementById('trend-split')?.value||'stage';const buckets=getPeriodBuckets();
const _trendNormalize=(stage)=>{if(stage==='Soft')return appr(State.DB.stageEntries).filter(e=>e.stage==='Soft'&&e.endTime).map(e=>({outVal:e.outUnits||0,inVal:e.inUnits||0,wasteVal:e.wasteUnits||0,startTime:e.startTime,endTime:e.endTime,worker:e.endWorker||e.startWorker,machine:e.machine,unit:'bags'}));if(stage==='Dye')return appr(State.DB.dyeLots||[]).map(d=>({outVal:d.outCones||0,inVal:d.totalInCones||0,wasteVal:Math.max(0,(d.totalInCones||0)-(d.outCones||0)),startTime:d.startTime,endTime:d.endTime,worker:d.endWorker||d.startWorker,machine:d.machine,unit:'cones'}));if(stage==='Wind')return appr(State.DB.windEntries||[]).filter(w=>w.endTime).map(w=>({outVal:w.outCones||0,inVal:w.inCones||0,wasteVal:w.wasteCones||0,startTime:w.startTime,endTime:w.endTime,worker:w.endWorker||w.startWorker,machine:w.machine,unit:'cones'}));return[];};
const _unitOf=(recs)=>{const us=new Set(recs.map(r=>r.unit));return us.size===1?[...us][0]:'mixed';};
const getVal=(recs,from,to)=>{const filtered=recs.filter(r=>inRange(r.endTime||r.startTime,from,to));if(metric==='output')return filtered.reduce((a,r)=>a+(r.outVal||0),0);if(metric==='wastage'){const inTotal=filtered.reduce((a,r)=>a+(r.inVal||0),0);const wTotal=filtered.reduce((a,r)=>a+(r.wasteVal||0),0);return inTotal>0?wTotal/inTotal*100:0;}if(metric==='hours')return filtered.reduce((a,r)=>a+hrsBetween(r.startTime,r.endTime),0);return 0;};
let series=[];
if(split==='stage'){
  series=[
    {name:'Soft',color:'var(--cs)',unit:'bags',recs:_trendNormalize('Soft')},
    {name:'Dye',color:'var(--cd)',unit:'cones',recs:_trendNormalize('Dye')},
    {name:'Wind',color:'var(--cw)',unit:'cones',recs:_trendNormalize('Wind')},
  ];
}else if(split==='worker'){
  const allRecs=[..._trendNormalize('Soft'),..._trendNormalize('Dye'),..._trendNormalize('Wind')];
  const workers=[...new Set(allRecs.map(r=>r.worker).filter(Boolean))];
  const colors=['var(--bl)','var(--pu)','var(--gr)','var(--or)','var(--cy)','var(--ye)'];
  series=workers.map((w,i)=>{const recs=allRecs.filter(r=>r.worker===w);return{name:w,color:colors[i%colors.length],unit:_unitOf(recs),recs};});
}else{
  const allRecs=[..._trendNormalize('Soft'),..._trendNormalize('Dye'),..._trendNormalize('Wind')];
  const machines=[...new Set(allRecs.map(r=>r.machine).filter(Boolean))];
  const colors=['var(--cy)','var(--or)','var(--pu)','var(--gr)','var(--bl)','var(--ye)'];
  series=machines.map((m,i)=>{const recs=allRecs.filter(r=>r.machine===m);return{name:m,color:colors[i%colors.length],unit:_unitOf(recs),recs};});
}
const data=series.map(s=>({...s,vals:buckets.map(b=>getVal(s.recs,b.from,b.to))}));
const maxVal=Math.max(1,...data.flatMap(s=>s.vals));
const labelFor=(s)=>metric==='output'?(s.unit==='mixed'?'units':s.unit):(metric==='wastage'?'%':'hrs');
const mixedUnitsNote=(metric==='output'&&split==='stage')?`<div style="font-size:0.65rem;color:var(--mu);margin-top:4px">Soft in bags · Dye/Wind in cones — not directly comparable as raw counts</div>`:'';
el.innerHTML=`<div class="card"><div class="card-title">
      ${split==='stage'?'Stage':split==='worker'?'Worker':'Machine'} ${metric==='output'?'Output':metric==='wastage'?'Wastage%':'Hours'} — ${State.anTrendGroup==='week'?'Last 8 Weeks':'Last 6 Months'}
      ${mixedUnitsNote}
    </div><div class="trend-bar-wrap"><div style="display:flex;gap:4px;align-items:flex-end;">
        ${buckets.map((b,bi)=>`<div class="tb-col">${data.map(s=>{const v=s.vals[bi];const h=maxVal>0?v/maxVal*100:0;return`<div class="tb-bar" style="height:${Math.max(h,2)}%;background:${s.color};margin-bottom:1px;"></div>`;}).join('')}<div class="tb-label">${b.label}</div></div>`).join('')}
      </div></div><div class="trend-legend">${data.map(s=>`<div class="tl-item"><div class="tl-dot"style="background:${s.color}"></div><span>${s.name}${metric==='output'?` (${s.unit})`:''}</span></div>`).join('')}</div><div class="card-title" style="margin-top:18px;">Data Table</div><div class="tbl"><table><thead><tr><th>Series</th><th>Unit</th>${buckets.map(b=>`<th>${b.label}</th>`).join('')}</tr></thead><tbody>
    ${data.map(s=>`<tr><td style="font-weight:700;color:${s.color}">${s.name}</td><td style="font-size:0.68rem;color:var(--mu)">${labelFor(s)}</td>${s.vals.map(v=>`<td class="mono">${v.toFixed(1)}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div></div>`;}

function renderWorkerScorecard(){const el=document.getElementById('sc-content');if(!el)return;const worker=document.getElementById('sc-worker-sel')?.value;const month=document.getElementById('sc-month')?.value||today().substring(0,7);if(!worker){el.innerHTML='<div class="empty"><div class="empty-icon">👤</div><div class="empty-text">ℹ Select a worker above to see their performance</div></div>';return;}
const[y,m]=month.split('-').map(Number);const daysInMonth=new Date(y,m,0).getDate();const monthFrom=`${month}-01`;const monthTo=`${month}-${String(daysInMonth).padStart(2,'0')}`;const _dyeAsWorkerEntries=(State.DB.dyeLots||[]).map(dl=>({...dl,worker:dl.endWorker||dl.startWorker,outUnits:dl.outCones||0,inUnits:dl.totalInCones||0,totalInUnits:dl.totalInCones||0,wasteUnits:dl.coneLoss||0}));const entries=[...appr(State.DB.stageEntries).filter(e=>e.endTime&&(e.endWorker===worker||e.startWorker===worker)&&inRange(e.endTime,monthFrom,monthTo)),...appr(_dyeAsWorkerEntries).filter(b=>b.worker===worker&&inRange(b.endTime,monthFrom,monthTo))];const totalOut=entries.reduce((a,e)=>a+(e.outUnits||0),0);const totalIn=entries.reduce((a,e)=>a+(e.inUnits||e.totalInUnits||0),0);const totalWaste=entries.reduce((a,e)=>a+(e.wasteUnits||0),0);const totalHrs=entries.reduce((a,e)=>a+hrsBetween(e.startTime,e.endTime),0);const avgRunHrs=entries.length>0?totalHrs/entries.length:0;const runs=entries.map(e=>hrsBetween(e.startTime,e.endTime)).filter(h=>h>0);const fastRun=runs.length?Math.min(...runs):0;const slowRun=runs.length?Math.max(...runs):0;const dayMap={};entries.forEach(e=>{const d=(e.endTime||'').split('T')[0];if(!d)return;if(!dayMap[d])dayMap[d]={hrs:0,units:0,stages:new Set()};dayMap[d].hrs+=hrsBetween(e.startTime,e.endTime);dayMap[d].units+=e.outUnits||0;dayMap[d].stages.add(e.stage||'Dye');});const firstDay=new Date(y,m-1,1).getDay();const pad=n=>String(n).padStart(2,'0');let calHTML='<div class="cal-grid">';['Mo','Tu','We','Th','Fr','Sa','Su'].forEach(d=>calHTML+=`<div class="cal-dow">${d}</div>`);const startOffset=(firstDay+6)%7;for(let i=0;i<startOffset;i++)calHTML+='<div class="cal-day empty"></div>';for(let day=1;day<=daysInMonth;day++){const key=`${month}-${pad(day)}`;const data=dayMap[key];const cls=data?data.hrs>8?'worked':data.hrs>0?'worked low':'no-work':'no-work';calHTML+=`<div class="cal-day ${cls}" title="${key}"><div class="cal-dn">${day}</div>
      ${data?`<div class="cal-hrs">${fmtHrs(data.hrs)}</div><div class="cal-units">${fmt(data.units)}u</div><div class="cal-stage"style="background:${SCOL[[...data.stages][0]]||'var(--ac)'}22;color:${SCOL[[...data.stages][0]]||'var(--ac)'}">${[...data.stages][0]||''}</div>`:''}
    </div>`;}
calHTML+='</div>';el.innerHTML=`
    <div class="sc-summary-grid"><div class="sc-sum-card"><div class="sc-sum-val" style="color:var(--gr)">${fmt(totalOut)}u</div><div class="sc-sum-label">Output</div></div><div class="sc-sum-card"><div class="sc-sum-val ${wcls(parseFloat(pct(totalWaste,totalIn)))}">${pct(totalWaste,totalIn)}</div><div class="sc-sum-label">Wastage %</div></div><div class="sc-sum-card"><div class="sc-sum-val" style="color:var(--cy)">${fmtHrs(totalHrs)}</div><div class="sc-sum-label">Hours Worked</div></div><div class="sc-sum-card"><div class="sc-sum-val" style="color:var(--pu)">${entries.length}</div><div class="sc-sum-label">Runs Completed</div></div></div><div class="g2 gap-b"><div class="card"><div class="card-title">${worker} — ${new Date(y,m-1).toLocaleString('en-IN',{month:'long',year:'numeric'})}</div>
        ${calHTML}
        <div style="display:flex;gap:12px;margin-top:10px;flex-wrap:wrap;"><div style="display:flex;align-items:center;gap:5px;font-size:0.68rem;color:var(--mu)"><div style="width:12px;height:12px;border-radius:2px;background:rgba(34,197,94,0.15)"></div>Worked</div><div style="display:flex;align-items:center;gap:5px;font-size:0.68rem;color:var(--mu)"><div style="width:12px;height:12px;border-radius:2px;background:var(--s2)"></div>No work</div></div></div><div class="card"><div class="card-title">Run Analysis</div>
        ${[
          {l:'Total Hours',v:fmtHrs(totalHrs),c:'var(--cy)'},
          {l:'Avg Hours per Run',v:fmtHrs(avgRunHrs),c:'var(--mu)'},
          {l:'Fastest Run',v:fastRun>0?fmtHrs(fastRun):'—',c:'var(--gr)'},
          {l:'Slowest Run',v:slowRun>0?fmtHrs(slowRun):'—',c:'var(--re)'},
          {l:'Total Input',v:fmt(totalIn)+'u',c:'var(--bl)'},
          {l:'Total Output',v:fmt(totalOut)+'u',c:'var(--gr)'},
          {l:'Total Wastage',v:fmt(totalWaste)+'u',c:'var(--re)'},
          {l:'Wastage %',v:pct(totalWaste,totalIn),c:'var(--re)'},
        ].map(r=>`<div class="ddp-row"><div class="ddp-main">${r.l}</div><div class="ddp-val"style="color:${r.c}">${r.v}</div></div>`).join('')}
        <div class="card-title" style="margin-top:14px;">Recent Runs</div>
        ${entries.slice(-6).reverse().map(e=>`<div class="ddp-row"><div class="ddp-left"><div class="ddp-main">${e.lotId||e.id}— ${e.stage||'Dye'}</div><div class="ddp-sub">${fmtTS(e.startTime)}→ ${fmtTS(e.endTime)}</div></div><div class="ddp-val"><span class="time-pill">${fmtHrs(hrsBetween(e.startTime,e.endTime))}</span></div></div>`).join('')||'<div class="ddp-empty">No runs this month</div>'}
      </div></div>`;}
function renderMachineHealth(){const el=document.getElementById('mh-content');if(!el)return;const selMachine=document.getElementById('mh-machine-sel')?.value||'';const machines=selMachine?[selMachine]:State.DB.masters.machines;const getBuckets=()=>{const now=new Date();const buckets=[];const pad=n=>String(n).padStart(2,'0');const f=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;if(State.anMHPeriod==='4weeks'){for(let i=3;i>=0;i--){const s=new Date(now);s.setDate(s.getDate()-s.getDay()+1-i*7);const e=new Date(s);e.setDate(e.getDate()+6);buckets.push({label:`W-${i}`,from:f(s),to:f(e)});}}else{for(let i=2;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);const end=new Date(d.getFullYear(),d.getMonth()+1,0);buckets.push({label:d.toLocaleString('en-IN',{month:'short'}),from:f(d),to:f(end)});}}
return buckets;};const buckets=getBuckets();el.innerHTML=machines.map(m=>{const cap=State.DB.masters.machineCapacity?.[m]||{maxHrs:24,maxOut:0};const _dyeAsMachEntries=(State.DB.dyeLots||[]).map(dl=>({...dl,outUnits:dl.outCones||0,inUnits:dl.totalInCones||0,wasteUnits:dl.coneLoss||0}));const allEntries=[...appr(State.DB.stageEntries).filter(e=>e.machine===m&&e.endTime),...appr(_dyeAsMachEntries).filter(b=>b.machine===m&&b.outUnits>0)];const stats=buckets.map(b=>{const ents=allEntries.filter(e=>inRange(e.endTime,b.from,b.to));const hrs=ents.reduce((a,e)=>a+hrsBetween(e.startTime,e.endTime),0);const outU=ents.reduce((a,e)=>a+(e.outUnits||0),0);const inU=ents.reduce((a,e)=>a+(e.inUnits||e.totalInUnits||0),0);const wasteU=ents.reduce((a,e)=>a+(e.wasteUnits||0),0);const days=State.anMHPeriod==='4weeks'?7:30;return{label:b.label,hrs,outU,inU,wasteU,wasteP:inU>0?Math.max(0,wasteU)/inU*100:0,utilPct:hrs/(cap.maxHrs*days)*100,runs:ents.length};});const lastTwo=stats.slice(-2);const wTrend=lastTwo.length===2?lastTwo[1].wasteP-lastTwo[0].wasteP:0;const hTrend=lastTwo.length===2?lastTwo[1].hrs-lastTwo[0].hrs:0;const status=wTrend>2||stats[stats.length-1]?.wasteP>10?'bad':wTrend>0.5?'warn':'good';const statusLabel=status==='good'?'✓ Healthy':status==='warn'?'⚠ Watch':' Alert';return`<div class="mh-card"><div class="mh-header"><div><div class="mh-name">⚙ ${m}</div><div style="font-size:0.68rem;color:var(--mu);margin-top:2px;">Max ${cap.maxHrs}h/day · Max output ${cap.maxOut||'—'}u</div></div><span class="mh-status mh-${status}">${statusLabel}</span></div><div class="mh-metrics">
        ${stats.slice(-1).map(s=>[
          {l:'Run Hours',v:fmtHrs(s.hrs),c:'var(--cy)'},
          {l:'Output',v:fmt(s.outU)+'u',c:'var(--gr)'},
          {l:'Wastage%',v:s.wasteP.toFixed(1)+'%',c:s.wasteP>10?'var(--re)':s.wasteP>5?'var(--ye)':'var(--gr)'},
          {l:'Utilisation',v:s.utilPct.toFixed(0)+'%',c:'var(--bl)'},
        ].map(m=>`<div class="mh-m"><div class="mh-mv"style="color:${m.c}">${m.v}</div><div class="mh-ml">${m.l}</div></div>`).join('')).join('')}
      </div><div class="card-title" style="font-size:0.62rem;">Trend — ${State.anMHPeriod==='4weeks'?'4 Weeks':'3 Months'}</div><div class="tbl"><table><thead><tr><th>Period</th><th>Hours</th><th>Output</th><th>Wastage%</th><th>Utilisation</th><th>Runs</th></tr></thead><tbody>
      ${stats.map((s,i)=>{
        const prev=stats[i-1];
        const wArrow=prev?(s.wasteP>prev.wasteP?'<span class="mh-up">↑</span>':'<span class="mh-dn">↓</span>'):'';
        return `<tr><td>${s.label}</td><td class="mono">${fmtHrs(s.hrs)}</td><td class="mono">${fmt(s.outU)}u</td><td class="mono ${wcls(s.wasteP)}">${s.wasteP.toFixed(1)}%${wArrow}</td><td class="mono">${s.utilPct.toFixed(0)}%</td><td class="mono">${s.runs}</td></tr>`;
      }).join('')}
      </tbody></table></div><div class="mh-run-log"><div style="font-size:0.62rem;font-weight:700;text-transform:uppercase;color:var(--mu);margin-bottom:6px;">Recent Runs</div>
        ${allEntries.slice(-5).reverse().map(e=>`<div class="mh-run"><div><span class="mono"style="font-size:0.7rem">${e.id}</span><span style="font-size:0.68rem;color:var(--mu)">${e.lotId||''}· ${e.stage||'Dye'}</span></div><div style="display:flex;gap:8px;align-items:center;"><span class="time-pill">${fmtHrs(hrsBetween(e.startTime,e.endTime))}</span><span class="${wcls(parseFloat(pct(e.wasteUnits||0,e.inUnits||e.totalInUnits||1)))} mono"style="font-size:0.65rem">${pct(e.wasteUnits||0,e.inUnits||e.totalInUnits||1)}W</span></div></div>`).join('')||'<div class="ddp-empty">No runs yet</div>'}
      </div></div>`;}).join('');}
function populateAnalyticsSelects(){const wSel=document.getElementById('sc-worker-sel');if(wSel){const workers=[...new Set([...State.DB.masters.workers,...(State.DB.users||[]).filter(u=>u.role==='worker').map(u=>u.name)])];wSel.innerHTML='<option value="">Select Worker</option>'+workers.map(w=>`<option value="${w}">${w}</option>`).join('');}
const mSel=document.getElementById('mh-machine-sel');if(mSel)mSel.innerHTML='<option value="">All Machines</option>'+State.DB.masters.machines.map(m=>`<option value="${m}">${m}</option>`).join('');const scM=document.getElementById('sc-month');if(scM&&!scM.value)scM.value=today().substring(0,7);}
async function addMachine(){const id=document.getElementById('mi-machine').value.trim();const hrs=parseFloat(document.getElementById('mi-machine-hrs').value)||24;const out=parseFloat(document.getElementById('mi-machine-out').value)||0;if(!id)return;try{const {ok,error,networkError}=await apiPost('/api/masters/setting',{action:'addMachine',machine:id,maxHrs:hrs,maxOut:out,role:State.currentUser?.role});if(networkError)throw new Error(error);if(!ok){showToast(error||'Could not add machine','err');return;}document.getElementById('mi-machine').value='';document.getElementById('mi-machine-hrs').value='';document.getElementById('mi-machine-out').value='';renderMasters();}catch(e){showToast('Network error — '+e.message,'err');}}
function toggleLCStage(key){lcExpanded[key]=!lcExpanded[key];renderLifecycle();}
function updateLCLotDropdown(){_loadCatalog('lots',()=>{const vendor=document.getElementById('lc-vendor-select')?.value||'';const sel=document.getElementById('lc-select');if(!sel)return;const prev=sel.value;const lots=_lotsForDropdown().filter(l=>!vendor||l.vendor===vendor).sort((a,b)=>(a.id||'').localeCompare(b.id||''));sel.innerHTML='<option value="">— Select Lot —</option>'+lots.map(l=>`<option value="${l.id}||${l.grade}||${l.vendor}">${l.id} — ${l.grade} — ${l.vendor}</option>`).join('');if(prev)sel.value=prev;renderLifecycle();});}
function updateDLCDropdown(){_loadCatalog('dyeLots',()=>{const shade=document.getElementById('dlc-shade-select')?.value||'';const sel=document.getElementById('dye-lifecycle-select');if(!sel)return;const prev=sel.value;const lots=_dyeLotsForDropdown().filter(d=>(!shade||(d.shade||'').toLowerCase()===shade.toLowerCase())).sort((a,b)=>(a.dyeLotNo||'').localeCompare(b.dyeLotNo||''));sel.innerHTML='<option value="">Select Dye Lot...</option>'+lots.map(d=>`<option value="${d.id}">${d.dyeLotNo} — ${d.shade}</option>`).join('');if(prev)sel.value=prev;renderDyeLifecycle();});}
function renderLifecycle(){
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
function _renderLifecycleCore(){const _dropdownLots=_lotsForDropdown();const vSel=document.getElementById('lc-vendor-select');if(vSel){const curV=vSel.value;const vendors=[...new Set(_dropdownLots.map(l=>l.vendor).filter(Boolean))].sort();vSel.innerHTML='<option value="">All Vendors</option>'+vendors.map(v=>`<option value="${v}" ${v===curV?'selected':''}>${v}</option>`).join('');}
const lcClearBtn=document.getElementById('lc-clear-btn');if(lcClearBtn)lcClearBtn.style.display=(vSel?.value||document.getElementById('lc-select')?.value)?'':'none';const sel=document.getElementById('lc-select');if(!sel)return;const prev=sel.value;const vendor=vSel?.value||'';const filteredLots=[..._dropdownLots].filter(l=>!vendor||l.vendor===vendor).sort((a,b)=>(a.id||'').localeCompare(b.id||''));sel.innerHTML='<option value="">— Select Lot —</option>'+filteredLots.map(l=>`<option value="${l.id}||${l.grade}||${l.vendor}">${l.id} — ${l.grade} — ${l.vendor}</option>`).join('');if(prev)sel.value=prev;const _lcVal=sel.value;if(!_lcVal){document.getElementById('lc-content').innerHTML='<div class="empty"><div class="empty-icon">🔍</div><div class="empty-text">ℹ Select a lot above to view its full production journey</div></div>';return;}
const[lotId,_lcGrade,_lcVendor]=_lcVal.split('||');const lot=getLotByKey(lotId,_lcGrade,_lcVendor);const rmBal=getRMBalance(lotId,lot.grade,lot.vendor);const lcStage=(key,color,icon,title,summaryRight,summaryRows,runs)=>{const exp=lcExpanded[key];return`<div class="lc-stage" style="--lc-c:${color}"><div class="lc-stage-hdr" onclick="toggleLCStage('${key}')"><div class="lc-stage-title" style="margin-bottom:0;">${icon} ${title}</div><div style="display:flex;align-items:center;gap:8px;"><span style="font-family:'IBM Plex Mono',monospace;font-size:0.75rem;color:${color}">${summaryRight}</span><span class="lc-expand-btn">${exp?'▲ Collapse':'▼ Expand'}</span></div></div>
      ${summaryRows.map(r=>`<div class="lc-row"><span class="lc-label">${r.l}</span><span class="lc-val ${r.c||''}">${r.v}</span></div>`).join('')}
      ${exp&&runs.length?`<div class="lc-stage-body">${runs.map(r=>r).join('')}</div>`:''}
      ${exp&&!runs.length?`<div class="lc-stage-body"><div style="font-size:0.72rem;color:var(--mu);padding:6px 0">No completed runs yet</div></div>`:''}
    </div>`;};const runCard=(e,stage)=>{const hrs=hrsBetween(e.startTime,e.endTime);const wp=e.inWeight>0?pct(e.wasteWeight||0,e.inWeight):'—';const SBADGE={Soft:'b-soft',Wind:'b-wind',Pack:'b-pack'};return`<div class="lc-run"><div class="lc-run-title"><span>${e.id} <span class="badge ${SBADGE[stage]||'b-rm'}">${stage}</span></span>${statusBadge(e.voided?'Void':e.status)}</div><div class="lc-run-grid"><div class="lc-run-item"><div class="lc-run-label">Start</div><div class="lc-run-val">${fmtTS(e.startTime)}</div></div><div class="lc-run-item"><div class="lc-run-label">End</div><div class="lc-run-val">${fmtTS(e.endTime)||'In Progress'}</div></div><div class="lc-run-item"><div class="lc-run-label">Duration</div><div class="lc-run-val">${hrs>0?fmtHrs(hrs):'—'}</div></div><div class="lc-run-item"><div class="lc-run-label">Machine</div><div class="lc-run-val">${e.machine||'—'}</div></div><div class="lc-run-item"><div class="lc-run-label">Start Worker</div><div class="lc-run-val">${e.startWorker||'—'}</div></div><div class="lc-run-item"><div class="lc-run-label">End Worker</div><div class="lc-run-val">${e.endWorker||'—'}</div></div><div class="lc-run-item"><div class="lc-run-label">Input</div><div class="lc-run-val">${fmt(e.inUnits)}u / ${fmt(e.inWeight)}kg</div></div><div class="lc-run-item"><div class="lc-run-label">Output</div><div class="lc-run-val" style="color:var(--gr)">${fmt(e.outUnits)}u / ${fmt(e.outWeight)}kg</div></div><div class="lc-run-item"><div class="lc-run-label">Wastage</div><div class="lc-run-val ${wcls(parseFloat(wp))}">${fmt(e.wasteUnits)}u (${wp})</div></div><div class="lc-run-item"><div class="lc-run-label">Approved by</div><div class="lc-run-val">${e.approvedBy||'—'}</div></div></div>
      ${e.startNote?`<div style="margin-top:7px;padding:6px 9px;background:rgba(59,130,246,.07);border-radius:5px;border-left:2px solid var(--bl);font-size:0.7rem;"><span style="color:var(--bl);font-weight:700;font-size:0.58rem;text-transform:uppercase;letter-spacing:.08em;">Start Note</span><div style="color:var(--tx);margin-top:2px">${e.startNote}</div></div>`:''}
      ${e.endNote?`<div style="margin-top:5px;padding:6px 9px;background:rgba(240,165,0,.07);border-radius:5px;border-left:2px solid var(--ac);font-size:0.7rem;"><span style="color:var(--ac);font-weight:700;font-size:0.58rem;text-transform:uppercase;letter-spacing:.08em;">End Note</span><div style="color:var(--tx);margin-top:2px">${e.endNote}</div></div>`:''}
    </div>`;};const dyeRunCard=(d)=>{const hrs=hrsBetween(d.startTime,d.endTime);const src=(d.sources||[]).find(s=>s.lotId===lotId&&s.grade===lot.grade&&s.vendor===lot.vendor);const batchWasteKg=Math.max(0,(d.totalInWeight||0)-(d.outWeight||0));const wp=d.totalInWeight>0?pct(batchWasteKg,d.totalInWeight):'—';return`<div class="lc-run"><div class="lc-run-title"><span style="color:var(--ac);font-weight:800;cursor:pointer;text-decoration:underline" onclick="openDyeLifecycle('${d.id}')" title="Open Dye Lifecycle">${d.dyeLotNo||d.id} ↗</span><span class="badge b-dye">Dye</span>${d.shade?`<span style="font-size:0.7rem;color:var(--mu);margin-left:6px">${d.shade}</span>`:''}${statusBadge(d.voided?'Void':d.status)}</div>
      ${d.notes?`<div style="font-size:0.7rem;color:var(--mu);margin-bottom:6px;background:var(--s2);padding:6px 8px;border-radius:4px;">📋 ${d.notes}</div>`:''}
      <div class="lc-run-grid"><div class="lc-run-item"><div class="lc-run-label">Start</div><div class="lc-run-val">${fmtTS(d.startTime)}</div></div><div class="lc-run-item"><div class="lc-run-label">End</div><div class="lc-run-val">${fmtTS(d.endTime)||'In Progress'}</div></div><div class="lc-run-item"><div class="lc-run-label">Duration</div><div class="lc-run-val">${hrs>0?fmtHrs(hrs):'—'}</div></div><div class="lc-run-item"><div class="lc-run-label">Machine</div><div class="lc-run-val">${d.machine||'—'}</div></div><div class="lc-run-item"><div class="lc-run-label">Dye Master</div><div class="lc-run-val">${d.startWorker||'—'}</div></div><div class="lc-run-item"><div class="lc-run-label">This lot's input</div><div class="lc-run-val">${fmt(src?.cones||0)}c / ${fmt(src?.weight||0)}kg</div></div><div class="lc-run-item"><div class="lc-run-label">Total batch in</div><div class="lc-run-val">${fmt(d.totalInCones)}c / ${fmt(d.totalInWeight)}kg</div></div><div class="lc-run-item"><div class="lc-run-label">Batch output</div><div class="lc-run-val" style="color:var(--gr)">${fmt(d.outCones)}c / ${fmt(d.outWeight)}kg</div></div><div class="lc-run-item"><div class="lc-run-label">Batch wastage</div><div class="lc-run-val ${wcls(parseFloat(wp))}">${fmt(batchWasteKg)}kg (${wp})</div></div><div class="lc-run-item"><div class="lc-run-label">Lot share</div><div class="lc-run-val">${(d.totalInWeight>0&&src)?((src.weight||0)/d.totalInWeight*100).toFixed(1)+'%':'—'}</div></div></div></div>`;};const idleBlock=(prevEndTS,nextStartTS,label)=>{if(!prevEndTS||!nextStartTS)return'';const hrs=hrsBetween(prevEndTS,nextStartTS);if(hrs<0.1)return'';return`<div class="lc-idle">⏳ <strong>${fmtDuration(prevEndTS,nextStartTS)}</strong> idle — ${label}</div>`;};const softEntries=appr(State.DB.stageEntries).filter(e=>e.lotId===lotId&&e.stage==='Soft'&&e.endTime);const dyeBatches=appr(State.DB.dyeLots||[]).filter(d=>(d.sources||[]).some(s=>s.lotId===lotId&&s.grade===lot.grade&&s.vendor===lot.vendor));const sIn=getSoftIn(lotId,lot.grade,lot.vendor);const sOut=getSoftOut(lotId,lot.grade,lot.vendor);const sWaste=Qsub(sIn,sOut);const dyeAlloc=getDyeAllocated(lotId,lot.grade,lot.vendor);const dyeConsumed=getDyeConsumedFromLot(lotId,lot.grade,lot.vendor);const lastSoftEnd=softEntries.length?softEntries[softEntries.length-1].endTime:null;const firstDyeStart=dyeBatches.length?dyeBatches[0].startTime:null;let html=`<div class="card gap-b" style="border-color:rgba(240,165,0,0.2)"><div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;"><div><div style="font-size:1.1rem;font-weight:800;color:#fff">${lot.id}</div><div style="font-size:0.78rem;color:var(--mu)">${lot.vendor} · ${lot.mill} · <span style="color:var(--ac)">${lot.grade}</span></div></div><div class="mono" style="font-size:0.75rem;color:var(--mu);text-align:right">Registered ${lot.date}<br>Total factory time: ${fmtDuration(lot.date+'T00:00:00',new Date().toISOString())}</div></div>

    ${lcStage(`${lotId}-rm`,'var(--cr)','📦','Raw Material',`${fmt(lot.units)}b/${fmt(lot.weight)}kg`,[
      {l:'Registered',v:`${fmt(lot.units)}b/${fmt(lot.weight)}kg`},
      {l:'Sent to Soft',v:fmtQ(sIn)},
      {l:'Remaining in RM',v:fmtQ(Qmax0(rmBal)),c:'wc-low'},
    ],[])}

    ${softEntries.length?lcStage(`${lotId}-soft`,'var(--cs)','💧','Softening',`${fmt(sOut.units)}b/${fmt(sOut.weight)}kg out · ${pct(sWaste.units,sIn.units)}waste`,[
      {l:'Total Input',v:fmtQ(sIn)},
      {l:'Total Output',v:fmtQ(sOut)},
      {l:'Wastage',v:`${fmtQ(sWaste)}(${pct(sWaste.units,sIn.units)})`,c:wcls(parseFloat(pct(sWaste.units,sIn.units)))},
      {l:'Soft Balance',v:fmtQ(Qmax0(getSoftBalance(lotId,lot.grade,lot.vendor))),c:'wc-low'},
    ],softEntries.map(e=>runCard(e,'Soft'))):''}




    ${dyeBatches.length?lcStage(`${lotId}-dye`,'var(--cd)','🎨','Dyeing',`${fmt(dyeAlloc.units)}c/${fmt(dyeAlloc.weight)}kg allocated back`,[
      {l:`Sent to Dye(${dyeBatches.length}batch${dyeBatches.length>1?'es':''})`,v:`${fmt(dyeConsumed.units)}b / ${fmt(dyeConsumed.weight)}kg`},
      {l:'Input in Dye',v:`${fmt(dyeBatches.reduce((a,d)=>{const src=(d.sources||[]).find(s=>s.lotId===lotId&&s.grade===lot.grade&&s.vendor===lot.vendor);return a+(src?.cones||0);},0))}c / ${fmt(dyeConsumed.weight)}kg`},
      {l:'Output allocated back',v:`${fmt(dyeAlloc.units)}c / ${fmt(dyeAlloc.weight)}kg`},
      {l:'Dye Balance',v:fmtQ(Qmax0(getDyeBalance(lotId,lot.grade,lot.vendor))),c:'wc-low'},
    ],dyeBatches.map(b=>dyeRunCard(b))):''}

  </div>`;document.getElementById('lc-content').innerHTML=html;}
function showTab(prefix,id,el){document.querySelectorAll(`[id^="${prefix}-"].tab-panel`).forEach(p=>{p.classList.remove('active');p.style.display='none';});if(el)el.parentNode.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));const panel=document.getElementById(`${prefix}-${id}`);if(panel){panel.classList.add('active');panel.style.display='';}
if(el)el.classList.add('active');renderReports();}
function tblHTML(headers,rows){if(!rows.length)return'<div class="empty empty-text" style="padding:20px">✕ No data for this period — try a wider date range</div>';const ths=headers.map((h,i)=>`<th style="cursor:pointer;user-select:none;white-space:nowrap" onclick="_rptTblSort(this,${i})">${h} <span style="color:var(--mu);font-size:0.6rem">↕</span></th>`).join('');return`<div style="overflow-x:auto"><table class="tbl" data-rpt-sort=""><thead><tr>${ths}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td class="mono">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;}
function _rptTblSort(thEl,colIdx){const table=thEl.closest('table');if(!table)return;const tbody=table.querySelector('tbody');const trs=[...tbody.querySelectorAll('tr')];const cur=table.dataset.rptSort||'';const dir=(cur===`${colIdx}asc`)?'desc':'asc';table.dataset.rptSort=`${colIdx}${dir}`;trs.sort((a,b)=>{const av=a.cells[colIdx]?.textContent.trim()||'';const bv=b.cells[colIdx]?.textContent.trim()||'';const an=parseFloat(av.replace(/[^0-9.-]/g,'')),bn=parseFloat(bv.replace(/[^0-9.-]/g,''));const cmp=(!isNaN(an)&&!isNaN(bn))?(an-bn):av.localeCompare(bv);return dir==='asc'?cmp:-cmp;});trs.forEach(tr=>tbody.appendChild(tr));table.querySelectorAll('thead th span').forEach((s,i)=>{s.textContent=i===colIdx?(dir==='asc'?' ↑':' ↓'):' ↕';});}
function rptFlow(){const{from,to}=getRptRange('flow');const el=document.getElementById('rpt-flow-c');if(!el)return;const softE=appr(State.DB.stageEntries||[]).filter(e=>e.stage==='Soft'&&e.endTime&&inRange(e.endTime,from,to));const softIn={bags:softE.reduce((a,e)=>a+(e.inUnits||0),0),kg:softE.reduce((a,e)=>a+(e.inWeight||0),0)};const softOut={bags:softE.reduce((a,e)=>a+(e.outUnits||0),0),kg:softE.reduce((a,e)=>a+(e.outWeight||0),0)};const softWaste={bags:softIn.bags-softOut.bags,kg:softIn.kg-softOut.kg};const softHrs=softE.reduce((a,e)=>a+hrsBetween(e.startTime,e.endTime),0);const dyeL=appr(State.DB.dyeLots||[]).filter(d=>d.endTime&&inRange(d.endTime,from,to));const dyeIn={cones:dyeL.reduce((a,d)=>a+(d.totalInCones||0),0),kg:dyeL.reduce((a,d)=>a+(d.totalInWeight||0),0)};const dyeOut={cones:dyeL.reduce((a,d)=>a+(d.outCones||0),0),kg:dyeL.reduce((a,d)=>a+Math.min(d.outWeight||0,d.totalInWeight||d.outWeight||0),0)};const dyeLoss=dyeIn.kg-dyeOut.kg;const dyeHrs=dyeL.reduce((a,d)=>a+hrsBetween(d.startTime,d.endTime),0);const windE=appr(State.DB.windEntries||[]).filter(e=>e.endTime&&inRange(e.endTime,from,to));const windIn={cones:windE.reduce((a,e)=>a+(e.inCones||0),0),kg:windE.reduce((a,e)=>a+(e.inWeight||0),0)};const windOut={cones:windE.reduce((a,e)=>a+(e.outCones||0),0),kg:windE.reduce((a,e)=>a+(e.outWeight||0),0)};const windWaste={cones:windIn.cones-windOut.cones,kg:windIn.kg-windOut.kg};const windHrs=windE.reduce((a,e)=>a+hrsBetween(e.startTime,e.endTime),0);const packE=appr(State.DB.packEntries||[]).filter(e=>inRange(e.timestamp,from,to));const packIn={cones:packE.reduce((a,e)=>a+(e.inCones||0),0)};const packOut={bags:packE.reduce((a,e)=>a+(e.bags||0),0),kg:packE.reduce((a,e)=>a+(e.weight||0),0)};const dispE=appr(State.DB.dispatches||[]).filter(d=>inRange(d.timestamp,from,to));const dispOut={bags:dispE.reduce((a,d)=>a+(d.bags||0),0),kg:dispE.reduce((a,d)=>a+(d.weight||0),0)};const softWastePct=softIn.kg>0?((softWaste.kg/softIn.kg)*100).toFixed(1):0;const windWastePct=windIn.kg>0?((windWaste.kg/windIn.kg)*100).toFixed(1):0;const dyeLossPct=dyeIn.kg>0?((dyeLoss/dyeIn.kg)*100).toFixed(1):0;const kpiBar=(label,val,sub,col)=>`<div style="background:var(--s2);border-radius:10px;padding:12px 16px;flex:1;min-width:120px"><div style="font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--mu)">${label}</div><div style="font-family:monospace;font-size:1.1rem;font-weight:800;color:${col};margin:4px 0">${val}</div><div style="font-size:0.65rem;color:var(--mu)">${sub}</div></div>`;const wasteBar=(pct,col)=>`<div style="display:flex;align-items:center;gap:6px"><div style="flex:1;background:var(--s3);border-radius:3px;height:6px"><div style="width:${Math.min(pct,100)}%;height:100%;background:${col};border-radius:3px"></div></div><span style="font-size:0.68rem;font-weight:700;color:${col};min-width:36px">${pct}%</span></div>`;el.innerHTML=`
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
      ${kpiBar('Soft Output',fmt(softOut.kg)+'kg',softE.length+' entries','var(--cs)')}
      ${kpiBar('Dye Output',fmt(dyeOut.kg)+'kg',dyeL.length+' lots','var(--cd)')}
      ${kpiBar('Wind Output',fmt(windOut.kg)+'kg',windE.length+' entries','var(--cw)')}
      ${kpiBar('Packed',fmt(packOut.kg)+'kg',packOut.bags+'b','var(--cp)')}
      ${kpiBar('Dispatched',fmt(dispOut.kg)+'kg',dispOut.bags+'b','var(--gr)')}
    </div><div style="margin-bottom:16px"><div style="font-size:0.68rem;font-weight:700;color:var(--mu);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">Waste / Gain by Stage</div><div style="display:flex;flex-direction:column;gap:8px"><div style="display:flex;align-items:center;gap:10px"><span style="width:60px;font-size:0.72rem;color:var(--cs)">Soft</span>${wasteBar(softWastePct,'var(--re)')}<span style="font-size:0.68rem;color:var(--mu)">${fmt(softWaste.kg)}kg lost</span></div><div style="display:flex;align-items:center;gap:10px"><span style="width:60px;font-size:0.72rem;color:var(--cd)">Dye</span>${wasteBar(dyeLossPct,'var(--re)')}<span style="font-size:0.68rem;color:var(--mu)">${fmt(dyeLoss)}kg lost</span></div><div style="display:flex;align-items:center;gap:10px"><span style="width:60px;font-size:0.72rem;color:var(--cw)">Wind</span>${wasteBar(windWastePct,'var(--re)')}<span style="font-size:0.68rem;color:var(--mu)">${fmt(windWaste.kg)}kg lost</span></div></div></div>
  `+tblHTML(['Stage','In','Out','Waste / Gain','Proc Hrs','Entries'],[['🧵 Soft',softIn.bags+'b / '+fmt(softIn.kg)+'kg',softOut.bags+'b / '+fmt(softOut.kg)+'kg',softWastePct+'% waste',fmtHrs(softHrs),softE.length],['🎨 Dye',(dyeIn.cones||'?')+'c / '+fmt(dyeIn.kg)+'kg',(dyeOut.cones||'?')+'c / '+fmt(dyeOut.kg)+'kg',fmt(dyeLoss)+'kg lost',fmtHrs(dyeHrs),dyeL.length],['🌀 Wind',(windIn.cones||'?')+'c / '+fmt(windIn.kg)+'kg',(windOut.cones||'?')+'c / '+fmt(windOut.kg)+'kg',windWastePct+'% waste',fmtHrs(windHrs),windE.length],['📦 Pack',(packIn.cones||'?')+'c in',packOut.bags+'b / '+fmt(packOut.kg)+'kg','—','—',packE.length],['🚚 Dispatch','—',dispOut.bags+'b / '+fmt(dispOut.kg)+'kg','—','—',dispE.length],]);}
function rptDye(){const{from,to}=getRptRange('dye');const dyeL=appr(State.DB.dyeLots||[]).filter(d=>d.endTime&&inRange(d.endTime,from,to));
// Jul 24 2026 fix — this used to read d.gain, a field only the demo seed
// data ever populates. Real dye-end submissions (handleDyeEnd in
// worker.js) write kgLoss/kgLossPct, never gain — so on real production
// data every Gain/Loss number in this report was silently 0, even though
// the real loss figures were sitting right there in kgLoss the whole
// time. Gain is negative kgLoss (dye output can't exceed input by the
// app's own rule — "gain is recorded at packing, not dyeing" — so this
// will correctly show 0 or a loss for real lots, same business meaning,
// just reading the field that's actually populated).
const dyeGain=d=>d.kgLoss!==undefined?-(d.kgLoss||0):((d.outWeight||0)-(d.totalInWeight||0));
const mach={};dyeL.forEach(d=>{const k=d.machine||'Unknown';if(!mach[k])mach[k]={inKg:0,outKg:0,outCones:0,gain:0,lots:0,hrs:0};mach[k].inKg+=(d.totalInWeight||0);mach[k].outKg+=(d.outWeight||0);mach[k].outCones+=(d.outCones||0);mach[k].gain+=dyeGain(d);mach[k].lots++;mach[k].hrs+=hrsBetween(d.startTime,d.endTime);});const machEl=document.getElementById('rpt-dye-mach');if(machEl)machEl.innerHTML=tblHTML(['Machine','In (kg)','Out Cones','Out (kg)','Gain/Loss','Hrs','Lots'],Object.entries(mach).sort((a,b)=>b[1].outKg-a[1].outKg).map(([m,v])=>[m,fmt(v.inKg)+'kg',(v.outCones||'?')+'c',fmt(v.outKg)+'kg',(v.gain>=0?'▲':'')+fmt(Math.abs(v.gain))+'kg',fmtHrs(v.hrs),v.lots]));const work={};dyeL.forEach(d=>{const k=d.endWorker||d.startWorker||'Unknown';if(!work[k])work[k]={inKg:0,outKg:0,outCones:0,lots:0,hrs:0};work[k].inKg+=(d.totalInWeight||0);work[k].outKg+=(d.outWeight||0);work[k].outCones+=(d.outCones||0);work[k].lots++;work[k].hrs+=hrsBetween(d.startTime,d.endTime);});const workEl=document.getElementById('rpt-dye-work');if(workEl)workEl.innerHTML=tblHTML(['Worker','In (kg)','Out Cones','Out (kg)','Lots','Hrs'],Object.entries(work).sort((a,b)=>b[1].outKg-a[1].outKg).map(([w,v])=>[w,fmt(v.inKg)+'kg',(v.outCones||'?')+'c',fmt(v.outKg)+'kg',v.lots,fmtHrs(v.hrs)]));const batchEl=document.getElementById('rpt-dye-batches');if(batchEl)batchEl.innerHTML=tblHTML(['Dye Lot','Shade','Sources','In (kg)','Out Cones','Out (kg)','Gain/Loss','Gain/Loss %','Machine','Worker'],dyeL.map(d=>{const srcs=(d.sources||[]).map(s=>s.lotId+(s.grade?' '+s.grade:'')+' '+fmt(s.weight||0)+'kg').join(', ');const g=dyeGain(d);const gainPct=d.totalInWeight>0?(g/d.totalInWeight*100).toFixed(1)+'%':'—';return[d.dyeLotNo,d.shade||'—',srcs,fmt(d.totalInWeight||0)+'kg',(d.outCones||'?')+'c',fmt(d.outWeight||0)+'kg',(g>=0?'▲':'')+fmt(Math.abs(g))+'kg',gainPct,d.machine||'—',d.endWorker||d.startWorker||'—'];}));}
function rptMachine(){const{from,to}=getRptRange('machine');const el=document.getElementById('rpt-mach-c');if(!el)return;
let d;
if(rptState['machine']?.isAllTime&&State.DB.reportSummaries?.machine){
  d=State.DB.reportSummaries.machine;
}else{
  const se=appr(State.DB.stageEntries||[]).filter(e=>e.stage==='Soft'&&e.endTime&&inRange(e.endTime,from,to));
  const dl=appr(State.DB.dyeLots||[]).filter(d2=>d2.endTime&&inRange(d2.endTime,from,to));
  const we=appr(State.DB.windEntries||[]).filter(e=>e.endTime&&inRange(e.endTime,from,to));
  d=calcMachineTotals(se,dl,we);
}
const _mStage=window._machStageFilter||'all';const _mMach=window._machMachFilter||'all';const allRows=Object.values(d);const allMachines=[...new Set(allRows.map(r=>r.m))].sort();const stageOrder=['Soft','Dye','Wind','Pack'];const stageColors={'Soft':'var(--cs)','Dye':'var(--cd)','Wind':'var(--cw)','Pack':'var(--cp)'};let filtered=allRows;if(_mStage!=='all')filtered=filtered.filter(r=>r.stage===_mStage);if(_mMach!=='all')filtered=filtered.filter(r=>r.m===_mMach);const machFilterBar=`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;align-items:center"><select class="fs" style="max-width:130px" onchange="window._machStageFilter=this.value;rptMachine()"><option value="all" ${_mStage==='all'?'selected':''}>All Stages</option>
      ${stageOrder.map(s=>`<option value="${s}"${_mStage===s?'selected':''}>${s}</option>`).join('')}
    </select><select class="fs" style="max-width:140px" onchange="window._machMachFilter=this.value;rptMachine()"><option value="all" ${_mMach==='all'?'selected':''}>All Machines</option>
      ${allMachines.map(m=>`<option value="${m}"${_mMach===m?'selected':''}>${m}</option>`).join('')}
    </select>
    ${(_mStage!=='all'||_mMach!=='all')?'<button class="btn btn-ghost btn-sm" onclick="clearMachFilter()">Clear</button>':''}
    <span style="font-size:0.68rem;color:var(--mu);margin-left:auto">${filtered.length} entries</span></div>`;const machByStage={};filtered.forEach(r=>{if(!machByStage[r.stage])machByStage[r.stage]=[];machByStage[r.stage].push(r);});const bodyHtml=stageOrder.filter(s=>machByStage[s]?.length).map(stage=>{const rows=machByStage[stage].sort((a,b)=>b.outKg-a.outKg);return`<div style="margin-bottom:20px"><div style="font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:${stageColors[stage]};margin-bottom:8px;padding:6px 0;border-bottom:2px solid ${stageColors[stage]}">${stage} Stage</div>
      ${tblHTML(['Machine','In (kg)','Out (kg)','Waste (kg)','Waste%','Total Hrs','Avg Hrs/Run','Runs'],
        rows.map(r=>[r.m,fmt(r.inKg)+'kg',fmt(r.outKg)+'kg',fmt(r.wasteKg)+'kg',pct(r.wasteKg,r.inKg),fmtHrs(r.hrs),fmtHrs(r.runs>0?r.hrs/r.runs:0),r.runs])
      )}
    </div>`;}).join('')||'<div style="padding:20px;color:var(--mu);text-align:center">No data for selected filters</div>';el.innerHTML=machFilterBar+bodyHtml;}
function rptWorker(){const{from,to}=getRptRange('worker');const el=document.getElementById('rpt-work-c');if(!el)return;
let d;
if(rptState['worker']?.isAllTime&&State.DB.reportSummaries?.worker){
  d=State.DB.reportSummaries.worker;
}else{
  const se=appr(State.DB.stageEntries||[]).filter(e=>e.stage==='Soft'&&e.endTime&&inRange(e.endTime,from,to));
  const dl=appr(State.DB.dyeLots||[]).filter(d2=>d2.endTime&&inRange(d2.endTime,from,to));
  const we=appr(State.DB.windEntries||[]).filter(e=>e.endTime&&inRange(e.endTime,from,to));
  const pe=appr(State.DB.packEntries||[]).filter(e=>inRange(e.timestamp,from,to));
  d=calcWorkerTotals(se,dl,we,pe);
}
const _wkStage=window._workStageFilter||'all';const _wkWorker=window._workWorkerFilter||'all';const allWorkRows=Object.values(d);const allWorkers=[...new Set(allWorkRows.map(r=>r.w))].sort();const stageOrder=['Soft','Dye','Wind','Pack'];const wStageColors={'Soft':'var(--cs)','Dye':'var(--cd)','Wind':'var(--cw)','Pack':'var(--cp)'};let filteredWork=allWorkRows;if(_wkStage!=='all')filteredWork=filteredWork.filter(r=>r.stage===_wkStage);if(_wkWorker!=='all')filteredWork=filteredWork.filter(r=>r.w===_wkWorker);const workFilterBar=`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;align-items:center"><select class="fs" style="max-width:130px" onchange="window._workStageFilter=this.value;rptWorker()"><option value="all" ${_wkStage==='all'?'selected':''}>All Stages</option>
      ${stageOrder.map(s=>`<option value="${s}"${_wkStage===s?'selected':''}>${s}</option>`).join('')}
    </select><select class="fs" style="max-width:150px" onchange="window._workWorkerFilter=this.value;rptWorker()"><option value="all" ${_wkWorker==='all'?'selected':''}>All Workers</option>
      ${allWorkers.map(w=>`<option value="${w}"${_wkWorker===w?'selected':''}>${w}</option>`).join('')}
    </select>
    ${(_wkStage!=='all'||_wkWorker!=='all')?'<button class="btn btn-ghost btn-sm" onclick="clearWorkFilter()">Clear</button>':''}
    <span style="font-size:0.68rem;color:var(--mu);margin-left:auto">${filteredWork.length} entries</span></div>`;const workByStage={};filteredWork.forEach(r=>{if(!workByStage[r.stage])workByStage[r.stage]=[];workByStage[r.stage].push(r);});const workBodyHtml=stageOrder.filter(s=>workByStage[s]?.length).map(stage=>{const rows=workByStage[stage].sort((a,b)=>b.outKg-a.outKg);return`<div style="margin-bottom:20px"><div style="font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:${wStageColors[stage]};margin-bottom:8px;padding:6px 0;border-bottom:2px solid ${wStageColors[stage]}">${stage} Stage</div>
      ${tblHTML(['Worker','In (kg)','Out (kg)','Out Bags','Waste (kg)','Waste%','Total Hrs','Runs'],
        rows.map(r=>[r.w,r.inKg>0?fmt(r.inKg)+'kg':'—',fmt(r.outKg)+'kg',r.outBags>0?r.outBags+'b':'—',r.wasteKg>0?fmt(r.wasteKg)+'kg':'—',r.inKg>0?pct(r.wasteKg,r.inKg):'—',r.hrs>0?fmtHrs(r.hrs):'—',r.runs])
      )}
    </div>`;}).join('')||'<div style="padding:20px;color:var(--mu);text-align:center">No data for selected filters</div>';el.innerHTML=workFilterBar+workBodyHtml;}
function rptDaily(){const{from,to}=getRptRange('daily');
let d;
if(rptState['daily']?.isAllTime&&State.DB.reportSummaries?.daily){
  d=State.DB.reportSummaries.daily;
  // All-Time summary has no date bound built in — filter its date keys against
  // the selected range (defaults to 2020-01-01..today, i.e. everything).
  d=Object.fromEntries(Object.entries(d).filter(([dt])=>inRange(dt+'T00:00:00',from,to)));
}else{
  const se=appr(State.DB.stageEntries||[]).filter(e=>e.endTime&&inRange(e.endTime,from,to));
  const dl=appr(State.DB.dyeLots||[]).filter(l=>l.endTime&&inRange(l.endTime,from,to));
  const we=appr(State.DB.windEntries||[]).filter(e=>e.endTime&&inRange(e.endTime,from,to));
  // pack/dispatch now use appr() (Approved + Edited-Approved, never voided) —
  // matches rptFlow/rptMachine/rptWorker/rptShade; previously Approved-only
  // here, which undercounted edited-then-reapproved entries (fixed Jul 12 2026,
  // confirmed with Priyam: Edited-Approved is the corrected version and counts).
  const pe=appr(State.DB.packEntries||[]).filter(e=>inRange(e.timestamp,from,to));
  const de=appr(State.DB.dispatches||[]).filter(e=>inRange(e.timestamp,from,to));
  d=calcDailyTotals(se,dl,we,pe,de);
}
const days=Object.entries(d).sort((a,b)=>a[0].localeCompare(b[0]));const maxKg=Math.max(...days.map(([,v])=>Math.max(v.soft,v.dye,v.wind,v.pack,v.disp)),1);const el=document.getElementById('rpt-daily-c');if(!el)return;if(!days.length){el.innerHTML='<div style="padding:20px;color:var(--mu);text-align:center">No data in this period</div>';return;}
const DAILY_LIMIT=10;const daysDesc=days.slice().reverse();const visibleDays=window._rptDailyExpanded?daysDesc:daysDesc.slice(0,DAILY_LIMIT);const dayRows=visibleDays.map(([dt,v])=>{const bar=(kg,col)=>kg>0?`<div style="display:inline-block;width:${Math.round(kg/maxKg*80)}px;height:8px;background:${col};border-radius:2px;margin:1px"></div>`:'';return`<tr style="border-bottom:1px solid var(--b1)"><td style="padding:7px 8px;font-weight:700;color:var(--tx)">${dt}</td><td style="padding:7px 8px;text-align:right;color:var(--cs)">${v.soft>0?fmt(v.soft):'—'}</td><td style="padding:7px 8px;text-align:right;color:var(--cd)">${v.dye>0?fmt(v.dye):'—'}</td><td style="padding:7px 8px;text-align:right;color:var(--cw)">${v.wind>0?fmt(v.wind):'—'}</td><td style="padding:7px 8px;text-align:right;color:var(--cp)">${v.pack>0?fmt(v.pack):'—'}</td><td style="padding:7px 8px;text-align:right;color:var(--gr);font-weight:700">${v.disp>0?fmt(v.disp):'—'}</td><td style="padding:7px 8px;text-align:right;color:var(--re)">${v.waste>0?fmt(v.waste):'—'}</td><td style="padding:7px 8px">${bar(v.soft,'var(--cs)')}${bar(v.dye,'var(--cd)')}${bar(v.wind,'var(--cw)')}${bar(v.pack,'var(--cp)')}${bar(v.disp,'var(--gr)')}</td></tr>`;}).join('');const showMoreDays=daysDesc.length>DAILY_LIMIT?`<div style="text-align:center;padding:10px"><button class="btn btn-ghost btn-sm" onclick="window._rptDailyExpanded=!window._rptDailyExpanded;rptDaily()">${window._rptDailyExpanded?'▲ Show less':'▼ Show '+(daysDesc.length-DAILY_LIMIT)+' more dates'}</button></div>`:'';el.innerHTML='<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:0.73rem">'
+'<thead><tr style="background:var(--s2)"><th style="padding:8px;text-align:left">Date</th>'
+'<th style="padding:8px;text-align:right;color:var(--cs)">Soft kg</th>'
+'<th style="padding:8px;text-align:right;color:var(--cd)">Dye kg</th>'
+'<th style="padding:8px;text-align:right;color:var(--cw)">Wind kg</th>'
+'<th style="padding:8px;text-align:right;color:var(--cp)">Pack kg</th>'
+'<th style="padding:8px;text-align:right;color:var(--gr)">Dispatch kg</th>'
+'<th style="padding:8px;text-align:right;color:var(--re)">Waste kg</th>'
+'<th style="padding:8px">Activity</th></tr></thead><tbody>'
+dayRows+'</tbody></table></div>'+showMoreDays;}

function rptControl(){
  const issues=[];

  // ── 1. SOFT ENTRIES: output > input (universal rule) ──────────────────
  appr(State.DB.stageEntries).filter(e=>e.stage==='Soft'&&e.endTime).forEach(e=>{
    if((e.outWeight||0)>(e.inWeight||0)+0.01)
      issues.push([e.id,e.lotId,'Soft','Output exceeds Input',`Out ${fmt(e.outWeight)}kg > In ${fmt(e.inWeight)}kg`]);
    if((e.outUnits||0)>(e.inUnits||0)+0.01)
      issues.push([e.id,e.lotId,'Soft','Output bags exceed Input bags',`Out ${fmt(e.outUnits)}b > In ${fmt(e.inUnits)}b`]);
    const diff=Math.abs((e.inWeight||0)-(e.outWeight||0)-(e.wasteWeight||0));
    if(diff>0.5)
      issues.push([e.id,e.lotId,'Soft','Mass balance: in ≠ out+waste (kg)',`${fmt(e.inWeight)} ≠ ${fmt(e.outWeight)}+${fmt(e.wasteWeight)}`]);
  });

  // ── 2. RM LOT LEVEL: negative balances ────────────────────────────────
  (State.DB.lots||[]).forEach(l=>{
    const rmBal=getRMBalance(l.id,l.grade,l.vendor);
    if(rmBal.weight<-0.5)
      issues.push([l.id,l.grade,'RM','Negative RM balance — soft took more than received',`Balance: ${fmt(rmBal.weight)}kg`]);
    const sfOut=getSoftOut(l.id,l.grade,l.vendor);
    const sfConsumed=getSoftConsumedByDye(l.id,l.grade,l.vendor);
    if(sfConsumed>sfOut.weight+0.5)
      issues.push([l.id,l.grade,'Soft→Dye','Sent to dye exceeds soft output',`Dye consumed ${fmt(sfConsumed)}kg > Soft out ${fmt(sfOut.weight)}kg`]);
    const sfBal=getSoftBalance(l.id,l.grade,l.vendor);
    if(sfBal.weight<-0.5)
      issues.push([l.id,l.grade,'Soft','Negative soft balance',`Balance: ${fmt(sfBal.weight)}kg`]);
  });

  // ── 3. DYE LOTS: output vs input, no sources, negative dye balance ────
  appr(State.DB.dyeLots||[]).forEach(d=>{
    if(!(d.sources||[]).length)
      issues.push([d.id,d.dyeLotNo||'—','Dye','Dye lot has no source lots defined','—']);
    if((d.outCones||0)>(d.totalInCones||0)+0.5)
      issues.push([d.id,d.dyeLotNo||'—','Dye','Output cones exceed input cones',`${fmt(d.outCones)}c out > ${fmt(d.totalInCones)}c in`]);
    if((d.outWeight||0)>(d.totalInWeight||0)+0.5)
      issues.push([d.id,d.dyeLotNo||'—','Dye','Output weight exceeds input weight',`${fmt(d.outWeight)}kg out > ${fmt(d.totalInWeight)}kg in`]);
    const dyeBal=getDyeBal(d.id);
    if(dyeBal.weight<-0.5)
      issues.push([d.id,d.dyeLotNo||'—','Dye','Negative dye balance — wind took more than dye produced',`Balance: ${fmt(dyeBal.weight)}kg`]);
  });

  // ── 4. WIND ENTRIES: mass balance, output > input ─────────────────────
  appr(State.DB.windEntries||[]).filter(w=>w.endTime).forEach(w=>{
    if((w.outCones||0)>(w.inCones||0)+0.5)
      issues.push([w.id,w.dyeLotNo||w.dyeLotId,'Wind','Output cones exceed input cones',`Out ${fmt(w.outCones)}c > In ${fmt(w.inCones)}c`]);
    if((w.outWeight||0)>(w.inWeight||0)+0.5)
      issues.push([w.id,w.dyeLotNo||w.dyeLotId,'Wind','Output weight exceeds input weight',`Out ${fmt(w.outWeight)}kg > In ${fmt(w.inWeight)}kg`]);
    const diff=Math.abs((w.inCones||0)-(w.outCones||0)-(w.wasteCones||0));
    if(diff>0.5)
      issues.push([w.id,w.dyeLotNo||w.dyeLotId,'Wind','Mass balance: in ≠ out+waste (cones)',`${fmt(w.inCones)}c ≠ ${fmt(w.outCones)}c+${fmt(w.wasteCones)}c`]);
  });

  // ── 5. DYE LOT LEVEL: negative wind balance ───────────────────────────
  appr(State.DB.dyeLots||[]).forEach(d=>{
    const windBal=getWindBal(d.id);
    if(windBal.weight<-0.5)
      issues.push([d.id,d.dyeLotNo||'—','Wind','Negative wind balance — pack took more than wind produced',`Balance: ${fmt(windBal.weight)}kg`]);
  });

  // ── 6. (removed — Pack gain/loss tracking lives in rptPack(), which has
  //      real tiered bands: 0-2%/2-5%/5-10%/10+%. This section used to
  //      duplicate a simplified version of that using a separate,
  //      confusingly-Dye-mislabeled setting — removed entirely, Jul 17
  //      2026, Priyam's explicit decision after confirming rptPack() is
  //      the actual, correctly-attributed check already in use.)

  // ── 7. DYE LOT LEVEL: dispatched > packed, negative pack balance ──────
  appr(State.DB.dyeLots||[]).forEach(d=>{
    const packed=getTotalPacked(d.id);
    const dispatched=getTotalDispatched(d.id);
    if(dispatched.weight>packed.weight+0.5)
      issues.push([d.id,d.dyeLotNo||'—','Dispatch','Dispatched weight exceeds packed weight',`Dispatched ${fmt(dispatched.weight)}kg > Packed ${fmt(packed.weight)}kg`]);
    if(dispatched.bags>packed.bags+0.5)
      issues.push([d.id,d.dyeLotNo||'—','Dispatch','Dispatched bags exceed packed bags',`Dispatched ${dispatched.bags}b > Packed ${packed.bags}b`]);
    const packBal=getPackBal(d.id);
    if(packBal.weight<-0.5)
      issues.push([d.id,d.dyeLotNo||'—','Pack','Negative pack balance — dispatched more than packed',`Balance: ${fmt(packBal.weight)}kg`]);
  });

  // ── RENDER ─────────────────────────────────────────────────────────────
  const el=document.getElementById('rpt-ctrl-c');
  if(!el)return;
  if(!issues.length){
    el.innerHTML='<div class="alert alert-ok">✓ All checks passed — no violations found across '+
      (State.DB.lots||[]).length+' RM lots, '+
      (State.DB.dyeLots||[]).length+' dye lots, '+
      (State.DB.stageEntries||[]).length+' stage entries.</div>';
    return;
  }
  // Group by stage
  const groups={};
  issues.forEach(i=>{const s=i[2];if(!groups[s])groups[s]=[];groups[s].push(i);});
  el.innerHTML='<div style="color:var(--re);font-weight:700;margin-bottom:12px">⚠ '+issues.length+' issue(s) found</div>'+
    Object.entries(groups).map(([stage,rows])=>
      '<div style="margin-bottom:16px"><div style="font-size:0.7rem;font-weight:800;color:var(--mu);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px">'+stage+' ('+rows.length+')</div>'+
      tblHTML(['ID','Ref','Stage','Issue','Detail'],rows)+'</div>'
    ).join('');
}
function exportToExcel(){if(typeof XLSX==='undefined'){showToast('SheetJS not loaded','err');return;}
showToast('Preparing export — merging in archived data...');
_loadArchiveWithCache(()=>{_doExportToExcel();});
}
function _doExportToExcel(){
const wb=XLSX.utils.book_new();
// Jul 29 2026 fix — real, confirmed issue: dates were exported as
// locale-formatted text ("15/4/2026, 9:59:32 am"), which Excel treats
// as plain text, not a real date — blocking any date-based grouping,
// filtering, or pivoting. Now returns a genuine JS Date object (empty
// string if there's no value), written with cellDates:true below so
// SheetJS stores it as a real Excel date cell, not text. Verified
// directly against the actual library before this was written.
const fmtD=v=>v?new Date(v):'';
const fmtN=v=>parseFloat(v)||0;
const s=v=>v||'';

// ===== RAW DUMP — all stages, one row per record, all fields =====
const rawRows=[];

// RM Lots (one row per delivery)
(State.DB.lots||[]).forEach(l=>{
  const deliveries=(l.deliveries||[]);
  if(!deliveries.length){
    rawRows.push({stage:'RM',entryId:s(l.id),lotId:s(l.id),dyeLotId:'',dyeLotNo:'',shade:'',grade:s(l.grade),vendor:s(l.vendor),mill:s(l.mill),party:'',orderId:'',challanId:'',invoiceNo:'',machine:'',startWorker:'',endWorker:'',worker:'',startTime:'',endTime:'',timestamp:s(l.date),status:s(l.status)||'Active',approvedBy:'',approvedAt:'',inUnits_bags:fmtN(l.units),inWeight_kg:fmtN(l.weight),outUnits_bags:'',outWeight_kg:'',wasteUnits_bags:'',wasteWeight_kg:'',inCones:'',outCones:'',wasteCones:'',bags:'',weight_kg:'',gainKg:'',gainPct:'',kgLoss:'',kgLossPct:'',coneLoss:'',sourceLotId:'',sourceGrade:'',sourceVendor:'',sourceCones:'',sourceWeight_kg:'',deliveryDate:s(l.date),deliveryBags:fmtN(l.units),deliveryKg:fmtN(l.weight),addedBy:'',qtyOrdered_kg:'',qtyFulfilled_kg:'',dueDate:'',cancelReason:'',notes:'',createdAt:s(l.createdAt)});
  } else {
    deliveries.forEach(d=>{rawRows.push({stage:'RM',entryId:s(l.id),lotId:s(l.id),dyeLotId:'',dyeLotNo:'',shade:'',grade:s(l.grade),vendor:s(l.vendor),mill:s(l.mill),party:'',orderId:'',challanId:'',invoiceNo:'',machine:'',startWorker:'',endWorker:'',worker:'',startTime:'',endTime:'',timestamp:s(l.date),status:s(l.status)||'Active',approvedBy:'',approvedAt:'',inUnits_bags:fmtN(d.units),inWeight_kg:fmtN(d.weight),outUnits_bags:'',outWeight_kg:'',wasteUnits_bags:'',wasteWeight_kg:'',inCones:'',outCones:'',wasteCones:'',bags:'',weight_kg:'',gainKg:'',gainPct:'',kgLoss:'',kgLossPct:'',coneLoss:'',sourceLotId:'',sourceGrade:'',sourceVendor:'',sourceCones:'',sourceWeight_kg:'',deliveryDate:s(d.addedAt||d.date),deliveryBags:fmtN(d.units),deliveryKg:fmtN(d.weight),addedBy:s(d.addedBy),qtyOrdered_kg:'',qtyFulfilled_kg:'',dueDate:'',cancelReason:'',notes:'',createdAt:s(l.createdAt)});});
  }
});

// Soft entries
(State.DB.stageEntries||[]).filter(e=>e.stage==='Soft').forEach(e=>{
  rawRows.push({stage:'Soft',entryId:s(e.id),lotId:s(e.lotId),dyeLotId:'',dyeLotNo:'',shade:'',grade:s(e.grade),vendor:s(e.vendor),mill:'',party:'',orderId:'',challanId:'',invoiceNo:'',machine:s(e.machine),startWorker:s(e.startWorker),endWorker:s(e.endWorker),worker:'',startTime:fmtD(e.startTime),endTime:fmtD(e.endTime),timestamp:'',status:s(e.status),approvedBy:s(e.approvedBy),approvedAt:fmtD(e.approvedAt),inUnits_bags:fmtN(e.inUnits),inWeight_kg:fmtN(e.inWeight),outUnits_bags:fmtN(e.outUnits),outWeight_kg:fmtN(e.outWeight),wasteUnits_bags:fmtN(e.wasteUnits),wasteWeight_kg:fmtN(e.wasteWeight),inCones:'',outCones:'',wasteCones:'',bags:'',weight_kg:'',gainKg:'',gainPct:'',kgLoss:'',kgLossPct:'',coneLoss:'',sourceLotId:'',sourceGrade:'',sourceVendor:'',sourceCones:'',sourceWeight_kg:'',deliveryDate:'',deliveryBags:'',deliveryKg:'',addedBy:'',qtyOrdered_kg:'',qtyFulfilled_kg:'',dueDate:'',cancelReason:'',notes:s(e.notes),createdAt:''});
});

// Dye lots — one row per source lot
(State.DB.dyeLots||[]).forEach(d=>{
  const sources=(d.sources||[]);
  const baseRow={stage:'Dye',entryId:s(d.id),lotId:'',dyeLotId:s(d.id),dyeLotNo:s(d.dyeLotNo),shade:s(d.shade),grade:sources[0]?.grade||'',vendor:sources[0]?.vendor||'',mill:'',party:'',orderId:'',challanId:'',invoiceNo:'',machine:s(d.machine),startWorker:s(d.startWorker),endWorker:s(d.endWorker),worker:'',startTime:fmtD(d.startTime),endTime:fmtD(d.endTime),timestamp:'',status:s(d.status),approvedBy:s(d.approvedBy),approvedAt:fmtD(d.approvedAt),inUnits_bags:'',inWeight_kg:fmtN(d.totalInWeight),outUnits_bags:'',outWeight_kg:fmtN(d.outWeight),wasteUnits_bags:'',wasteWeight_kg:parseFloat((fmtN(d.totalInWeight)-fmtN(d.outWeight)).toFixed(2)),inCones:fmtN(d.totalInCones),outCones:fmtN(d.outCones),wasteCones:fmtN(d.coneLoss),bags:'',weight_kg:'',gainKg:'',gainPct:'',kgLoss:fmtN(d.kgLoss),kgLossPct:fmtN(d.kgLossPct),coneLoss:fmtN(d.coneLoss),deliveryDate:'',deliveryBags:'',deliveryKg:'',addedBy:'',qtyOrdered_kg:'',qtyFulfilled_kg:'',dueDate:'',cancelReason:'',notes:s(d.notes),createdAt:fmtD(d.createdAt)};
  if(!sources.length){rawRows.push({...baseRow,lotId:'',sourceLotId:'',sourceGrade:'',sourceVendor:'',sourceCones:'',sourceWeight_kg:''});}
  else{sources.forEach(src=>{rawRows.push({...baseRow,lotId:s(src.lotId),sourceLotId:s(src.lotId),sourceGrade:s(src.grade),sourceVendor:s(src.vendor),sourceCones:fmtN(src.cones),sourceWeight_kg:fmtN(src.weight)});});}
});

// Wind entries
(State.DB.windEntries||[]).forEach(e=>{
  rawRows.push({stage:'Wind',entryId:s(e.id),lotId:'',dyeLotId:s(e.dyeLotId),dyeLotNo:s(e.dyeLotNo),shade:s(e.shade),grade:s(e.grade),vendor:'',mill:'',party:'',orderId:'',challanId:'',invoiceNo:'',machine:s(e.machine),startWorker:s(e.startWorker),endWorker:s(e.endWorker),worker:'',startTime:fmtD(e.startTime),endTime:fmtD(e.endTime),timestamp:'',status:s(e.status),approvedBy:s(e.approvedBy),approvedAt:fmtD(e.approvedAt),inUnits_bags:'',inWeight_kg:fmtN(e.inWeight),outUnits_bags:'',outWeight_kg:fmtN(e.outWeight),wasteUnits_bags:'',wasteWeight_kg:fmtN(e.wasteWeight),inCones:fmtN(e.inCones),outCones:fmtN(e.outCones),wasteCones:fmtN(e.wasteCones),bags:'',weight_kg:'',gainKg:'',gainPct:'',kgLoss:'',kgLossPct:'',coneLoss:'',sourceLotId:'',sourceGrade:'',sourceVendor:'',sourceCones:'',sourceWeight_kg:'',deliveryDate:'',deliveryBags:'',deliveryKg:'',addedBy:'',qtyOrdered_kg:'',qtyFulfilled_kg:'',dueDate:'',cancelReason:'',notes:s(e.notes),createdAt:''});
});

// Pack entries
(State.DB.packEntries||[]).forEach(e=>{
  rawRows.push({stage:'Pack',entryId:s(e.id),lotId:'',dyeLotId:s(e.dyeLotId),dyeLotNo:s(e.dyeLotNo),shade:s(e.shade),grade:s(e.grade),vendor:'',mill:'',party:'',orderId:'',challanId:'',invoiceNo:'',machine:'',startWorker:'',endWorker:'',worker:s(e.worker),startTime:'',endTime:'',timestamp:fmtD(e.timestamp),status:s(e.status),approvedBy:s(e.approvedBy),approvedAt:fmtD(e.approvedAt),inUnits_bags:'',inWeight_kg:fmtN(e.inWeight),outUnits_bags:'',outWeight_kg:fmtN(e.weight),wasteUnits_bags:'',wasteWeight_kg:'',inCones:fmtN(e.inCones),outCones:'',wasteCones:'',bags:fmtN(e.bags),weight_kg:fmtN(e.weight),gainKg:fmtN(e.gainKg),gainPct:fmtN(e.gainPct),kgLoss:'',kgLossPct:'',coneLoss:'',sourceLotId:'',sourceGrade:'',sourceVendor:'',sourceCones:'',sourceWeight_kg:'',deliveryDate:'',deliveryBags:'',deliveryKg:'',addedBy:'',qtyOrdered_kg:'',qtyFulfilled_kg:'',dueDate:'',cancelReason:'',notes:s(e.notes),createdAt:''});
});

// Dispatches
(State.DB.dispatches||[]).forEach(d=>{
  rawRows.push({stage:'Dispatch',entryId:s(d.id),lotId:'',dyeLotId:s(d.dyeLotId),dyeLotNo:s(d.dyeLotNo),shade:s(d.shade),grade:s(d.grade),vendor:'',mill:'',party:s(d.party),orderId:s(d.orderId),challanId:s(d.challanId),invoiceNo:s(d.invoiceNo),machine:'',startWorker:'',endWorker:'',worker:s(d.by),startTime:'',endTime:'',timestamp:fmtD(d.timestamp),status:s(d.status),approvedBy:s(d.approvedBy),approvedAt:fmtD(d.approvedAt),inUnits_bags:'',inWeight_kg:'',outUnits_bags:'',outWeight_kg:'',wasteUnits_bags:'',wasteWeight_kg:'',inCones:'',outCones:'',wasteCones:'',bags:fmtN(d.bags),weight_kg:fmtN(d.weight),gainKg:'',gainPct:'',kgLoss:'',kgLossPct:'',coneLoss:'',sourceLotId:'',sourceGrade:'',sourceVendor:'',sourceCones:'',sourceWeight_kg:'',deliveryDate:s(d.date),deliveryBags:'',deliveryKg:'',addedBy:'',qtyOrdered_kg:'',qtyFulfilled_kg:'',dueDate:'',cancelReason:'',notes:s(d.notes),createdAt:''});
});

// Party Orders
(State.DB.partyOrders||[]).forEach(o=>{
  rawRows.push({stage:'PartyOrder',entryId:s(o.id),lotId:'',dyeLotId:'',dyeLotNo:'',shade:s(o.shade),grade:s(o.grade),vendor:'',mill:'',party:s(o.party),orderId:s(o.id),challanId:'',invoiceNo:'',machine:'',startWorker:'',endWorker:'',worker:s(o.createdBy),startTime:'',endTime:'',timestamp:'',status:s(o.status),approvedBy:'',approvedAt:'',inUnits_bags:'',inWeight_kg:'',outUnits_bags:'',outWeight_kg:'',wasteUnits_bags:'',wasteWeight_kg:'',inCones:'',outCones:'',wasteCones:'',bags:'',weight_kg:'',gainKg:'',gainPct:'',kgLoss:'',kgLossPct:'',coneLoss:'',sourceLotId:'',sourceGrade:'',sourceVendor:'',sourceCones:'',sourceWeight_kg:'',deliveryDate:s(o.date),deliveryBags:'',deliveryKg:'',addedBy:'',qtyOrdered_kg:fmtN(o.qtyOrdered),qtyFulfilled_kg:fmtN(o.qtyFulfilled),dueDate:s(o.due),cancelReason:s(o.cancelReason),notes:s(o.notes),createdAt:fmtD(o.createdAt)});
});

XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rawRows,{cellDates:true}),'RAW DUMP');

// ===== INDIVIDUAL STAGE SHEETS (corrected fields) =====

// RM Lots
const rmData=(State.DB.lots||[]).map(l=>({'Lot ID':s(l.id),'Vendor':s(l.vendor),'Mill':s(l.mill),'Grade':s(l.grade),'Units (bags)':fmtN(l.units),'Weight (kg)':fmtN(l.weight),'Date':s(l.date),'Status':s(l.status)||'Active','Deliveries Count':(l.deliveries||[]).length,'RM Balance Units':getRMBalance(l.id,l.grade,l.vendor).units,'RM Balance Kg':getRMBalance(l.id,l.grade,l.vendor).weight,'Created At':fmtD(l.createdAt)}));
XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rmData,{cellDates:true}),'RM Lots');

// Jul 29 2026 fix — real, confirmed gap: RM Lots showed lot-level
// totals only, with individual deliveries hidden inside an array that
// was never actually exported — a "Deliveries Count" number, but not
// the deliveries themselves. Priyam confirmed: leave the live app's Lot
// structure alone (it's genuinely correct, a Lot is a real ongoing
// relationship with a vendor, not a data-modeling mistake) — fix the
// export specifically, same pattern already used correctly for Dye
// Sources: one row per actual, individual delivery, the true raw entry.
const rmDeliveryData=[];
(State.DB.lots||[]).forEach(l=>{
  (l.deliveries||[]).forEach(d=>{
    rmDeliveryData.push({'Lot ID':s(l.id),'Vendor':s(l.vendor),'Mill':s(l.mill),'Grade':s(l.grade),'Delivery Date':fmtD(d.date),'Units (bags)':fmtN(d.units),'Weight (kg)':fmtN(d.weight),'Challan':s(d.challan),'Added By':s(d.addedBy),'Added At':fmtD(d.addedAt)});
  });
});
XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rmDeliveryData,{cellDates:true}),'RM Deliveries');

// Soft Entries
const softData=(State.DB.stageEntries||[]).filter(e=>e.stage==='Soft').map(e=>({'Entry ID':s(e.id),'Lot ID':s(e.lotId),'Grade':s(e.grade),'Vendor':s(e.vendor),'Dead Stock ID':s(e.deadStockId),'Recycle ID':s(e.recycleId),'Machine':s(e.machine),'Start Worker':s(e.startWorker),'End Worker':s(e.endWorker),'In Bags':fmtN(e.inUnits),'In Kg':fmtN(e.inWeight),'Out Bags':fmtN(e.outUnits),'Out Kg':fmtN(e.outWeight),'Waste Bags':fmtN(e.wasteUnits),'Waste Kg':fmtN(e.wasteWeight),'Waste %':fmtN(e.inWeight)>0?((fmtN(e.wasteWeight)/fmtN(e.inWeight))*100).toFixed(2):0,'Start Time':fmtD(e.startTime),'End Time':fmtD(e.endTime),'Status':s(e.status),'Approved By':s(e.approvedBy),'Approved At':fmtD(e.approvedAt),'Notes':s(e.notes)}));
XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(softData,{cellDates:true}),'Soft Entries');

// Dye Lots
const dyeLotData=(State.DB.dyeLots||[]).map(d=>({'Dye Lot ID':s(d.id),'Dye Lot No':s(d.dyeLotNo),'Shade':s(d.shade),'Grade':(d.sources||[])[0]?.grade||'','Source Lots':(d.sources||[]).map(s=>s.lotId).join(', '),'Source Vendors':(d.sources||[]).map(s=>s.vendor).join(', '),'Machine':s(d.machine),'Start Worker':s(d.startWorker),'End Worker':s(d.endWorker),'Total In Cones':fmtN(d.totalInCones),'Total In Kg':fmtN(d.totalInWeight),'Out Cones':fmtN(d.outCones),'Out Kg':fmtN(d.outWeight),'Kg Loss':fmtN(d.kgLoss),'Kg Loss %':fmtN(d.kgLossPct),'Cone Loss':fmtN(d.coneLoss),'Start Time':fmtD(d.startTime),'End Time':fmtD(d.endTime),'Status':s(d.status),'Approved By':s(d.approvedBy),'Notes':s(d.notes)}));
XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(dyeLotData,{cellDates:true}),'Dye Lots');

// Dye Sources (exploded)
const dyeSrcData=[];(State.DB.dyeLots||[]).forEach(d=>{(d.sources||[]).forEach(src=>{dyeSrcData.push({'Dye Lot ID':s(d.id),'Dye Lot No':s(d.dyeLotNo),'Shade':s(d.shade),'Source Type':s(src.sourceType)||'rm','Source Lot ID':s(src.lotId),'Dead Stock ID':s(src.deadStockId),'Recycle ID':s(src.recycleId),'Residual ID':s(src.residualId),'Source Grade':s(src.grade),'Source Vendor':s(src.vendor),'Source Cones':fmtN(src.cones),'Source Weight Kg':fmtN(src.weight)});});});
XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(dyeSrcData,{cellDates:true}),'Dye Sources');

// Wind Entries
const windData=(State.DB.windEntries||[]).map(e=>({'Entry ID':s(e.id),'Dye Lot ID':s(e.dyeLotId),'Dye Lot No':s(e.dyeLotNo),'Shade':s(e.shade),'Grade':s(e.grade),'Recycle ID':s(e.recycleId),'Machine':s(e.machine),'Start Worker':s(e.startWorker),'End Worker':s(e.endWorker),'In Cones':fmtN(e.inCones),'In Kg':fmtN(e.inWeight),'Out Cones':fmtN(e.outCones),'Out Kg':fmtN(e.outWeight),'Waste Cones':fmtN(e.wasteCones),'Waste Kg':fmtN(e.wasteWeight),'Waste %':fmtN(e.inWeight)>0?((fmtN(e.wasteWeight)/fmtN(e.inWeight))*100).toFixed(2):0,'Start Time':fmtD(e.startTime),'End Time':fmtD(e.endTime),'Status':s(e.status),'Approved By':s(e.approvedBy),'Notes':s(e.notes)}));
XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(windData,{cellDates:true}),'Wind Entries');

// Pack Entries
const packData=(State.DB.packEntries||[]).map(e=>({'Entry ID':s(e.id),'Dye Lot ID':s(e.dyeLotId),'Dye Lot No':s(e.dyeLotNo),'Shade':s(e.shade),'Grade':s(e.grade),'Worker':s(e.worker),'In Cones':fmtN(e.inCones),'In Kg':fmtN(e.inWeight),'Out Bags':fmtN(e.bags),'Out Kg':fmtN(e.weight),'Gain Kg':fmtN(e.gainKg),'Gain %':fmtN(e.gainPct),'Timestamp':fmtD(e.timestamp),'Status':s(e.status),'Approved By':s(e.approvedBy),'Notes':s(e.notes)}));
XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(packData,{cellDates:true}),'Pack Entries');

// Dispatches
const dispData=(State.DB.dispatches||[]).map(d=>({'Dispatch ID':s(d.id),'Dye Lot ID':s(d.dyeLotId),'Dye Lot No':s(d.dyeLotNo),'Shade':s(d.shade),'Grade':s(d.grade),'Party':s(d.party),'Bags':fmtN(d.bags),'Weight Kg':fmtN(d.weight),'Challan ID':s(d.challanId),'Invoice No':s(d.invoiceNo),'Date':s(d.date),'By':s(d.by),'Order ID':s(d.orderId),'Timestamp':fmtD(d.timestamp),'Status':s(d.status),'Notes':s(d.notes)}));
XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(dispData,{cellDates:true}),'Dispatches');

// Party Orders
const orderData=(State.DB.partyOrders||[]).map(o=>({'Order ID':s(o.id),'Party':s(o.party),'Shade':s(o.shade),'Grade':s(o.grade),'Ordered Kg':fmtN(o.qtyOrdered),'Order Date':s(o.date),'Due Date':s(o.due),'Status':s(o.status),'Created By':s(o.createdBy),'Created At':fmtD(o.createdAt),'Cancel Reason':s(o.cancelReason),'Notes':s(o.notes)}));
XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(orderData,{cellDates:true}),'Party Orders');

// Dead Stock
const dsData=(State.DB.deadStock||[]).map(d=>({'ID':s(d.id),'Type':s(d.type),'Grade':s(d.grade),'Weight Kg':fmtN(d.weight),'Note':s(d.note),'Date':s(d.date),'Status':s(d.status)}));
XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(dsData,{cellDates:true}),'Dead Stock');

// Recycle Stock
const rcData=(State.DB.recycleStock||[]).map(r=>({'ID':s(r.id),'Dye Lot ID':s(r.dyeLotId),'Dye Lot No':s(r.dyeLotNo),'Shade':s(r.shade),'Grade':(r.sources||[])[0]?.grade||'','Weight Kg':fmtN(r.weight),'Good Portion Kg':fmtN(r.goodPortion),'Reason':s(r.reason),'Status':s(r.status),'Marked By':s(r.markedBy),'Marked At':fmtD(r.markedAt),'Approved By':s(r.approvedBy),'Created At':fmtD(r.createdAt)}));
XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rcData,{cellDates:true}),'Recycle Stock');

// Monthly Summary
const monthMap={};
const addMonth=(ts,data)=>{if(!ts)return;const m=(ts||'').slice(0,7);if(!monthMap[m])monthMap[m]={Month:m,RM_Received_bags:0,RM_Received_kg:0,Soft_Out_bags:0,Soft_Out_kg:0,Soft_Waste_bags:0,Soft_Waste_kg:0,Dye_Out_cones:0,Dye_Out_kg:0,Wind_Out_cones:0,Wind_Out_kg:0,Wind_Waste_cones:0,Wind_Waste_kg:0,Pack_Out_bags:0,Pack_Out_kg:0,Pack_Gain_kg:0,Dispatched_bags:0,Dispatched_kg:0};Object.entries(data).forEach(([k,v])=>{if(monthMap[m][k]!==undefined)monthMap[m][k]+=v;});};
(State.DB.lots||[]).forEach(l=>(l.deliveries||[{units:l.units,weight:l.weight,addedAt:l.date+'T00:00:00'}]).forEach(d=>addMonth(d.addedAt||l.date,{RM_Received_bags:fmtN(d.units),RM_Received_kg:fmtN(d.weight)})));
(State.DB.stageEntries||[]).filter(e=>e.stage==='Soft'&&e.endTime).forEach(e=>addMonth(e.endTime,{Soft_Out_bags:fmtN(e.outUnits),Soft_Out_kg:fmtN(e.outWeight),Soft_Waste_bags:fmtN(e.wasteUnits),Soft_Waste_kg:fmtN(e.wasteWeight)}));
(State.DB.dyeLots||[]).filter(d=>d.endTime&&d.status==='Approved').forEach(d=>addMonth(d.endTime,{Dye_Out_cones:fmtN(d.outCones),Dye_Out_kg:fmtN(d.outWeight)}));
(State.DB.windEntries||[]).filter(e=>e.endTime&&e.status==='Approved').forEach(e=>addMonth(e.endTime,{Wind_Out_cones:fmtN(e.outCones),Wind_Out_kg:fmtN(e.outWeight),Wind_Waste_cones:fmtN(e.wasteCones),Wind_Waste_kg:fmtN(e.wasteWeight)}));
(State.DB.packEntries||[]).filter(e=>e.status==='Approved').forEach(e=>addMonth(e.timestamp,{Pack_Out_bags:fmtN(e.bags),Pack_Out_kg:fmtN(e.weight),Pack_Gain_kg:fmtN(e.gainKg)}));
(State.DB.dispatches||[]).filter(d=>d.status==='Approved').forEach(d=>addMonth(d.timestamp,{Dispatched_bags:fmtN(d.bags),Dispatched_kg:fmtN(d.weight)}));
const summaryData=Object.values(monthMap).sort((a,b)=>a.Month.localeCompare(b.Month));
XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(summaryData,{cellDates:true}),'Monthly Summary');

// Edit Log
const editData=(State.DB.editLog||[]).map(e=>({'Log ID':s(e.id),'Entry ID':s(e.entryId),'Entry Type':s(e.entryType),'Action':s(e.action),'Changed By':s(e.by),'At':fmtD(e.at),'Reason':s(e.reason),'Notes':s(e.notes)}));
XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(editData,{cellDates:true}),'Edit Log');

// Jul 29 2026 fix — real, confirmed gap: Residual and Scrap were both
// entirely missing from the export. Both are already flat, true raw
// entries in the app's own data (one row per real event) — no exploding
// needed, unlike RM's deliveries.
const residualData=(State.DB.residualLog||[]).map(r=>({'Log ID':s(r.id),'Lot ID':s(r.lotId),'Grade':s(r.grade),'Vendor':s(r.vendor),'Weight Kg':fmtN(r.weight),'Type':s(r.type),'Reason':s(r.reason),'Status':s(r.status)||'Approved','By':s(r.by),'Date':s(r.date),'Timestamp':fmtD(r.timestamp)}));
XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(residualData,{cellDates:true}),'Residual Log');

const scrapData=(State.DB.scrapLog||[]).map(sc=>({'Scrap ID':s(sc.id),'Entry ID':s(sc.entryId),'Type':s(sc.type),'Weight Kg':fmtN(sc.weight),'Reason':s(sc.reason),'Status':s(sc.status)||'Approved','Scrapped By':s(sc.scrappedBy),'Date':s(sc.date),'Timestamp':fmtD(sc.timestamp)}));
XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(scrapData,{cellDates:true}),'Scrap Log');

// Jul 29 2026 — the actual deliverable this whole conversation was
// building toward. One row per (RM lot, Dye batch) combination — the
// exact point where the many-to-one relationship (multiple RM lots can
// feed one Dye batch) gets established. From there, every stage's
// figure is the REAL, already-calculated proportional share — not raw
// ingredients for Power BI to recompute, the finished answer, reusing
// every proven function already built and tested (calcVendorRatioForDyeLot,
// calcWindInAllocated, calcWindOutAllocated, calcPackInAllocated,
// calcDispatchAllocated, calcTotalDispatchedApproved). Waste and gain
// are automatically correct throughout, since every figure uses the
// real, actual quantity at that stage, never a theoretical one.
const traceData=[];
(State.DB.lots||[]).forEach(l=>{
  const relatedDyeLots=(State.DB.dyeLots||[]).filter(d=>calcVendorRatioForDyeLot(d,l.id,l.grade,l.vendor)>0);
  const softOut=getSoftOut(l.id,l.grade,l.vendor);
  if(relatedDyeLots.length===0){
    // This RM lot hasn't reached Dye yet (or never will) — still a real,
    // valid row, just with the downstream stages correctly showing zero,
    // not silently omitted from the sheet.
    traceData.push({'RM Lot ID':s(l.id),'RM Grade':s(l.grade),'RM Vendor':s(l.vendor),'RM Total Weight Kg':fmtN(l.weight),'Soft Output Kg (total, all dye batches)':fmtN(softOut.weight),'Dye Lot ID':'','Dye Lot No':'','Shade':'','RM Share Of This Batch %':'','RM Share Of Dye Input Cones':'','RM Share Of Dye Input Kg':'','RM Share Of Wind In Cones':'','RM Share Of Wind In Kg':'','RM Share Of Wind Out Cones':'','RM Share Of Wind Out Kg':'','RM Share Of Pack In Cones':'','RM Share Of Pack In Kg':'','RM Share Dispatched Bags':0,'RM Share Dispatched Kg':0,'Difference (Input - Dispatched) Kg':''});
    return;
  }
  relatedDyeLots.forEach(d=>{
    const ratio=calcVendorRatioForDyeLot(d,l.id,l.grade,l.vendor);
    const src=(d.sources||[]).find(s=>s.lotId===l.id&&(!l.grade||s.grade===l.grade)&&(!l.vendor||s.vendor===l.vendor));
    // Jul 29 2026 — matching bags/cones added alongside each weight
    // figure, Priyam's request: weight is the one reliable, consistent
    // thread that exists unchanged at every stage, so it's what actually
    // determines each RM lot's true share (the ratio itself). That same
    // share then gets applied to whatever the real unit is at each
    // specific stage — cones through Dye/Wind/Pack, bags at Dispatch —
    // exactly the same pattern already proven in calcDispatchAllocated.
    const windAppr=appr(State.DB.windEntries||[]).filter(e=>e.dyeLotId===d.id);
    const windIn=windAppr.reduce((a,e)=>a+(e.inWeight||0),0);
    const windInCones=windAppr.reduce((a,e)=>a+(e.inCones||0),0);
    const windOutAppr=windAppr.filter(e=>e.endTime);
    const windOut=windOutAppr.reduce((a,e)=>a+(e.outWeight||0),0);
    const windOutCones=windOutAppr.reduce((a,e)=>a+(e.outCones||0),0);
    const packAppr=(State.DB.packEntries||[]).filter(e=>e.dyeLotId===d.id&&(e.status==='Approved'||e.status==='Edited-Approved'));
    const packIn=packAppr.reduce((a,e)=>a+(e.inWeight||0),0);
    const packInCones=packAppr.reduce((a,e)=>a+(e.inCones||0),0);
    const dispatchedThisLot=calcTotalDispatchedApproved(State.DB.dispatches,d.id,State.DB.dyeLots);
    const rmShareDispatched=(dispatchedThisLot.weight||0)*ratio;
    const rmShareDispatchedBags=Math.round((dispatchedThisLot.bags||0)*ratio);
    const rmShareOfInput=src?src.weight:0;
    traceData.push({
      'RM Lot ID':s(l.id),'RM Grade':s(l.grade),'RM Vendor':s(l.vendor),'RM Total Weight Kg':fmtN(l.weight),
      'Soft Output Kg (total, all dye batches)':fmtN(softOut.weight),
      'Dye Lot ID':s(d.id),'Dye Lot No':s(d.dyeLotNo),'Shade':s(d.shade),
      'RM Share Of This Batch %':fmtN((ratio*100).toFixed(2)),
      'RM Share Of Dye Input Cones':fmtN(Math.round((src?.cones||0))),
      'RM Share Of Dye Input Kg':fmtN(rmShareOfInput),
      'RM Share Of Wind In Cones':fmtN(Math.round(windInCones*ratio)),
      'RM Share Of Wind In Kg':fmtN(windIn*ratio),
      'RM Share Of Wind Out Cones':fmtN(Math.round(windOutCones*ratio)),
      'RM Share Of Wind Out Kg':fmtN(windOut*ratio),
      'RM Share Of Pack In Cones':fmtN(Math.round(packInCones*ratio)),
      'RM Share Of Pack In Kg':fmtN(packIn*ratio),
      'RM Share Dispatched Bags':fmtN(rmShareDispatchedBags),
      'RM Share Dispatched Kg':fmtN(rmShareDispatched),
      'Difference (Input - Dispatched) Kg':fmtN((rmShareOfInput-rmShareDispatched).toFixed(2)),
    });
  });
});
XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(traceData,{cellDates:true}),'RM-to-Dispatch Trace');

const date=new Date().toLocaleDateString('en-IN').replace(/\//g,'-');
XLSX.writeFile(wb,`ThreadControl_FullExport_${date}.xlsx`);
showToast('Excel exported ✓ — '+rawRows.length+' raw rows across all stages');}
function exportCSV(){
  const fmtD=v=>v?new Date(v).toLocaleString('en-GB'):'';
  const csvParts=[];
  csvParts.push('=== RM LOTS ===');
  csvParts.push('LotID,Vendor,Mill,Grade,TotalBags,TotalKg,Date,Status');
  (State.DB.lots||[]).forEach(l=>csvParts.push(`${l.id},${l.vendor},${l.mill||''},${l.grade},${l.units},${l.weight},${l.date},${l.status||'Active'}`));
  csvParts.push('\n=== SOFT ENTRIES ===');
  csvParts.push('ID,LotID,Grade,Vendor,Machine,StartWorker,EndWorker,InBags,InKg,OutBags,OutKg,WasteBags,WasteKg,StartTime,EndTime,Status');
  (State.DB.stageEntries||[]).filter(e=>e.stage==='Soft').forEach(e=>csvParts.push(`${e.id},${e.lotId},${e.grade||''},${e.vendor||''},${e.machine||''},${e.startWorker||''},${e.endWorker||''},${e.inUnits||0},${e.inWeight||0},${e.outUnits||0},${e.outWeight||0},${e.wasteUnits||0},${e.wasteWeight||0},${fmtD(e.startTime)},${fmtD(e.endTime)},${e.status}`));
  csvParts.push('\n=== DYE LOTS ===');
  csvParts.push('DyeLotID,DyeLotNo,Shade,SourceLots,Machine,StartWorker,EndWorker,InCones,InKg,OutCones,OutKg,KgLoss,KgLossPct,StartTime,EndTime,Status');
  (State.DB.dyeLots||[]).forEach(d=>csvParts.push(`${d.id},${d.dyeLotNo||''},${d.shade||''},"${(d.sources||[]).map(s=>s.lotId).join(', ')}",${d.machine||''},${d.startWorker||''},${d.endWorker||''},${d.totalInCones||0},${d.totalInWeight||0},${d.outCones||0},${d.outWeight||0},${d.kgLoss||0},${d.kgLossPct||0},${fmtD(d.startTime)},${fmtD(d.endTime)},${d.status}`));
  csvParts.push('\n=== WIND ENTRIES ===');
  csvParts.push('ID,DyeLotID,DyeLotNo,Shade,Grade,Machine,StartWorker,EndWorker,InCones,InKg,OutCones,OutKg,WasteCones,WasteKg,StartTime,EndTime,Status');
  (State.DB.windEntries||[]).forEach(e=>csvParts.push(`${e.id},${e.dyeLotId||''},${e.dyeLotNo||''},${e.shade||''},${e.grade||''},${e.machine||''},${e.startWorker||''},${e.endWorker||''},${e.inCones||0},${e.inWeight||0},${e.outCones||0},${e.outWeight||0},${e.wasteCones||0},${e.wasteWeight||0},${fmtD(e.startTime)},${fmtD(e.endTime)},${e.status}`));
  csvParts.push('\n=== PACK ENTRIES ===');
  csvParts.push('ID,DyeLotID,DyeLotNo,Shade,Grade,Worker,InCones,InKg,OutBags,OutKg,GainKg,GainPct,Timestamp,Status');
  (State.DB.packEntries||[]).forEach(e=>csvParts.push(`${e.id},${e.dyeLotId||''},${e.dyeLotNo||''},${e.shade||''},${e.grade||''},${e.worker||''},${e.inCones||0},${e.inWeight||0},${e.bags||0},${e.weight||0},${e.gainKg||0},${e.gainPct||0},${fmtD(e.timestamp)},${e.status}`));
  csvParts.push('\n=== DISPATCHES ===');
  csvParts.push('ID,DyeLotID,DyeLotNo,Shade,Grade,Party,Bags,WeightKg,ChallanID,InvoiceNo,Date,By,OrderID,Status');
  (State.DB.dispatches||[]).forEach(d=>csvParts.push(`${d.id},${d.dyeLotId||''},${d.dyeLotNo||''},${d.shade||''},${d.grade||''},${d.party||''},${d.bags||0},${d.weight||0},${d.challanId||''},${d.invoiceNo||''},${d.date||''},${d.by||''},${d.orderId||''},${d.status}`));
  csvParts.push('\n=== PARTY ORDERS ===');
  csvParts.push('ID,Party,Shade,Grade,OrderedKg,FulfilledKg,OrderDate,DueDate,Status');
  (State.DB.partyOrders||[]).forEach(o=>csvParts.push(`${o.id},${o.party||''},${o.shade||''},${o.grade||''},${o.qtyOrdered||0},${o.qtyFulfilled||0},${o.date||''},${o.due||''},${o.status}`));
  const blob=new Blob([csvParts.join('\n')],{type:'text/csv'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download=`ThreadControl_CSV_${today()}.csv`;a.click();
  showToast('CSV exported ✓');}
function showGSheetStatus(msg,type){const el=document.getElementById('gsheet-status-banner');if(!el)return;const c={ok:'background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);color:var(--gr)',err:'background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);color:var(--re)',warn:'background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);color:var(--ye)',info:'background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);color:var(--bl)'};el.style.cssText=(c[type]||c.info)+';display:block;padding:12px 16px;border-radius:8px;font-size:0.78rem;margin:12px 26px;';el.innerHTML=msg;}
async function testGSheetConnection(){const btn=document.getElementById('gsheet-test-btn');if(!GSHEET_WEBHOOK_URL||GSHEET_WEBHOOK_URL.length<10){showGSheetStatus('❌ <strong>URL not set.</strong> Open this HTML file in Notepad → find <code style="background:var(--s2);padding:1px 5px;border-radius:3px;">GSHEET_WEBHOOK_URL = ""</code> at the top → paste your Apps Script URL between the quotes → Save → Reload.','err');return;}
if(btn)btn.textContent='⏳ Testing...';showGSheetStatus('⏳ Pinging Apps Script...','info');try{await fetch(GSHEET_WEBHOOK_URL,{method:'GET',mode:'no-cors'});showGSheetStatus('✅ <strong>URL is reachable.</strong> Now click "Sync to Google Sheets". If the sheet still does not update, go to Apps Script → Deploy → Manage Deployments → make sure "Who has access" is set to <strong>Anyone</strong>.','ok');}catch(err){showGSheetStatus('❌ <strong>Cannot reach Apps Script URL.</strong> Error: '+err.message+'<br>Check the URL is correct and the script is deployed as a Web App.','err');}
if(btn)btn.textContent='🔗 Test Connection';}
async function syncToGSheets(){showToast('Google Sheets sync not configured — use Export CSV or Export Excel instead','err');}
function openStageModal(action){State.stageAction=action;const resetFields=['sf-lot-search','sf-in-units','sf-in-weight','sf-start-note','sf-out-units','sf-out-weight','sf-end-note'];resetFields.forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});const lotSel=document.getElementById('sf-lot-stage');if(lotSel){lotSel.value='';lotSel.size=1;}
const avail=document.getElementById('sf-avail');if(avail)avail.textContent='—';const ref=document.getElementById('stage-end-ref');if(ref)ref.style.display='none';const cnt=document.getElementById('sf-lot-count');if(cnt)cnt.textContent='';populateSelects();const t=document.getElementById('stage-modal-title');const btn=document.getElementById('stage-submit-btn');if(t)t.textContent=action==='Start'?'▶ Start Stage Entry':'End Stage Entry';if(btn)btn.textContent=action==='Start'?'Record Start':'Record End';renderStageForm();document.getElementById('stage-modal').classList.add('open');}
function specialMaterialSectionHTML(dsSelectId,rcSelectId,fieldClass,labelClass,wrapOpen,wrapClose){
  const dsPlastic=(State.DB.deadStock||[]).filter(d=>d.type==='Plastic'&&d.status==='Approved'&&getDeadStockBalance(d.id)>0);
  const rcWound=(State.DB.recycleStock||[]).filter(r=>{const st=getRCStatus(r.id);return st.status.includes('Wound')&&getRecycleBalance(r.id)>0;});
  if(!dsPlastic.length&&!rcWound.length) return '';
  return wrapOpen+'<div style="font-size:0.7rem;font-weight:700;color:var(--mu);margin-bottom:8px">SPECIAL MATERIAL (optional — only if softening DS or RC)</div>'
    +(dsPlastic.length?`<div class="${fieldClass}" style="margin-bottom:8px"><label class="${labelClass}">📦 Dead Stock Plastic Cone</label><select class="${fieldClass==='fg'?'fs':'wselect'}" id="${dsSelectId}"><option value="">None</option>`+dsPlastic.map(d=>'<option value="'+d.id+'">'+d.id+' — '+d.grade+' ('+fmt(getDeadStockBalance(d.id))+'kg avail)</option>').join('')+'</select></div>':'')
    +(rcWound.length?`<div class="${fieldClass}"><label class="${labelClass}">♻ Recycle Material (Wound)</label><select class="${fieldClass==='fg'?'fs':'wselect'}" id="${rcSelectId}"><option value="">None</option>`+rcWound.map(r=>'<option value="'+r.id+'">'+r.id+' — '+r.dyeLotNo+' — '+r.shade+' ('+fmt(getRecycleBalance(r.id))+'kg avail)</option>').join('')+'</select></div>':'')
    +'<div style="font-size:0.68rem;color:var(--mu);margin-top:4px">ℹ️ Select only if this soft entry processes special material. Leave blank for normal RM lot softening.</div>'+wrapClose;
}
function renderStageForm(){const body=document.getElementById('stage-form-body');if(!body)return;const M=State.DB.masters.machines;const W=State.DB.masters.workers;const _sfWorkerCur=State.currentUser?.name||'';const mOpts=`<option value="">Select</option>${M.map(v=>`<option value="${v}">${v}</option>`).join('')}`;const wOpts=`<option value="">Select</option>${W.map(v=>`<option value="${v}"${v===_sfWorkerCur?'selected':''}>${v}</option>`).join('')}`;if(State.stageAction==='Start'){const STAGES=['Soft','Wind','Pack'];let lotStageOpts='<optgroup label="Soft">';lotsForStage('Soft').forEach(l=>lotStageOpts+=`<option value="${l.id}||Soft||${l.grade}||${l.vendor}">${l.id} — ${l.grade} — ${l.vendor} (${fmt(getRMBalance(l.id,l.grade,l.vendor).units)} bags / ${fmt(getRMBalance(l.id,l.grade,l.vendor).weight)}kg avail)</option>`);body.innerHTML=`
      <div class="fg" style="grid-column:1/-1"><label class="fl">Lot + Stage *</label><input type="text" class="fs" id="sf-lot-search" placeholder="Search by Lot ID, Grade or Vendor..." oninput="filterLotOpts()" autocomplete="off"
          style="margin-bottom:4px;"><select class="fs" id="sf-lot-stage" onchange="updateStageAvail()" size="1" style="height:auto;"><option value="">— type above to search —</option>${lotStageOpts}</select><div style="font-size:0.68rem;color:var(--mu);margin-top:2px;" id="sf-lot-count"></div></div><div class="fg" style="grid-column:1/-1;background:var(--s2);border-radius:7px;padding:9px 12px;font-size:0.78rem;color:var(--tx);" id="sf-avail-banner"><span style="color:var(--mu)">Available from previous stage</span><span id="sf-avail" class="mono" style="color:var(--mu)"> — select lot</span></div><div class="fg"><label class="fl">In Bags *</label><input class="fi" id="sf-in-units" type="number" placeholder="0"></div><div class="fg"><label class="fl">In Weight (kg) *</label><input class="fi" id="sf-in-weight" type="number" placeholder="0"></div><div class="fg"><label class="fl">Machine</label><select class="fs" id="sf-machine">${mOpts}</select></div><div class="fg"><label class="fl">Your Name (Start Worker)</label><select class="fs" id="sf-worker">${wOpts}</select></div><div class="fg" style="grid-column:1/-1"><label class="fl">Note (optional)</label><input class="fi" id="sf-start-note" placeholder="e.g. Machine running slow, material condition, special instructions..."></div>
    ${specialMaterialSectionHTML('sf-ds-select','sf-rc-select','fg','fl','<div class="fg fg-full" style="grid-column:1/-1;border-top:1px solid var(--b1);padding-top:12px;margin-top:4px">','</div>')}
    `;}else{const inProg=State.DB.stageEntries.filter(e=>e.status==='InProgress');if(!inProg.length){body.innerHTML='<div class="alert alert-warn" style="grid-column:1/-1">No in-progress entries. Workers must Start a stage first.</div>';return;}
const ipOpts=inProg.map(e=>`<option value="${e.id}">${e.lotId} — ${e.stage} — ${fmt(e.inUnits)}b — started ${fmtTS(e.startTime)}</option>`).join('');const autoSelect=inProg.length===1?inProg[0].id:'';body.innerHTML=`
      <div class="fg" style="grid-column:1/-1"><label class="fl">In-Progress Entry to End *</label><select class="fs" id="sf-ip-id" onchange="showStageEndRef()"><option value="">Select</option>${ipOpts}</select></div><div id="stage-end-ref" style="grid-column:1/-1;display:none;background:var(--s2);border:1px solid var(--b2);border-radius:9px;padding:14px;margin-bottom:4px;"></div><div class="fg"><label class="fl">Out Bags *</label><input class="fi" id="sf-out-units" type="number" placeholder="0"></div><div class="fg"><label class="fl">Out Weight (kg) *</label><input class="fi" id="sf-out-weight" type="number" placeholder="0"></div><div class="fg" style="grid-column:1/-1"><label class="fl">Note (optional)</label><input class="fi" id="sf-end-note" placeholder="e.g. Output quality observation, issues noticed, wastage reason..."></div>`;if(autoSelect){setTimeout(()=>{const sel=document.getElementById('sf-ip-id');if(sel){sel.value=autoSelect;showStageEndRef();}},50);}}}
function showStageEndRef(){const id=document.getElementById('sf-ip-id')?.value;const ref=document.getElementById('stage-end-ref');const outEl=document.getElementById('sf-out-units');const outWEl=document.getElementById('sf-out-weight');if(!ref)return;if(!id){ref.style.display='none';return;}
const e=State.DB.stageEntries.find(x=>x.id===id);if(!e){ref.style.display='none';return;}
const elapsed=hrsBetween(e.startTime,new Date().toISOString());const SCOL={Soft:'var(--cs)',Dye:'var(--cd)',Wind:'var(--cw)',Pack:'var(--cp)'};const stageColor=SCOL[e.stage]||'var(--ac)';ref.style.display='block';ref.innerHTML=`
    <div style="font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:${stageColor};margin-bottom:10px;">
      📋 Start Reference — ${e.stage} Stage
    </div><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px;"><div><div style="font-size:.58rem;color:var(--mu);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">Lot / Grade</div><div style="font-size:.82rem;font-weight:700;color:#fff">${e.lotId}</div><div style="font-size:.65rem;color:var(--mu)">${e.grade||''}</div></div><div><div style="font-size:.58rem;color:var(--mu);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">Input Loaded</div><div style="font-size:.9rem;font-weight:700;color:var(--bl)">${fmt(e.inUnits)}b / ${fmt(e.inWeight)}kg</div></div><div><div style="font-size:.58rem;color:var(--mu);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">Running Time</div><div style="font-size:.9rem;font-weight:700;color:var(--cy)">${fmtHrs(elapsed)}</div><div style="font-size:.65rem;color:var(--mu)">since ${fmtTS(e.startTime)}</div></div></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;padding-top:8px;border-top:1px solid var(--b1);"><div><div style="font-size:.58rem;color:var(--mu);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">Machine</div><div style="font-size:.78rem;font-weight:600">${e.machine||'—'}</div></div><div><div style="font-size:.58rem;color:var(--mu);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">Started By</div><div style="font-size:.78rem;font-weight:600">${e.startWorker||'—'}</div></div></div><div style="margin-top:8px;padding:7px 10px;background:rgba(59,130,246,.08);border-radius:5px;font-size:.7rem;color:var(--bl);">
      ℹ Output cannot exceed <strong>${fmt(e.inUnits)}b / ${fmt(e.inWeight)}kg</strong></div>`;if(outEl){outEl.max=e.inUnits;outEl.placeholder=`0 – ${fmt(e.inUnits)}`;}
if(outWEl){outWEl.max=e.inWeight;outWEl.placeholder=`0 – ${fmt(e.inWeight)}`;}}
function updateDispAvail(){const dyeLotId=document.getElementById('m-disp-lot')?.value||'';const gradeEl=document.getElementById('m-disp-grade');const ref=document.getElementById('disp-ref-panel');const avEl=document.getElementById('disp-avail-display');const weightEl=document.getElementById('m-disp-weight');if(!dyeLotId||!ref){if(ref)ref.style.display='none';if(avEl){avEl.textContent='— select dye lot';avEl.style.color='var(--mu)';}
if(gradeEl)gradeEl.value='';return;}
const dLot=(State.DB.dyeLots||[]).find(d=>d.id===dyeLotId);if(!dLot){ref.style.display='none';if(avEl){avEl.textContent='— lot not found';avEl.style.color='var(--re)';}
return;}
const grades=(dLot.sources||[]).map(s=>s.grade).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join('+');if(gradeEl)gradeEl.value=grades;const pb=getPackBal(dyeLotId);const disp=getTotalDispatched(dyeLotId);const packed=getTotalPacked(dyeLotId);ref.style.display='block';ref.innerHTML=`
    <div style="font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--gr);margin-bottom:10px;">
      📋 Stock Reference — ${dLot.dyeLotNo}
    </div><div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:10px;"><div><div style="font-size:.58rem;color:var(--mu);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">Shade</div><div style="font-size:.82rem;font-weight:700;color:var(--ac)">${dLot.shade||'—'}</div><div style="font-size:.62rem;color:var(--mu)">${grades}</div></div><div><div style="font-size:.58rem;color:var(--mu);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">Total Packed</div><div style="font-size:.82rem;font-weight:700;color:#fff">${packed.bags}b</div><div style="font-size:.62rem;color:var(--mu)">${fmt(packed.weight)}kg</div></div><div><div style="font-size:.58rem;color:var(--mu);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">Already Dispatched</div><div style="font-size:.82rem;font-weight:700;color:var(--ye)">${disp.bags}b</div><div style="font-size:.62rem;color:var(--mu)">${fmt(disp.weight)}kg</div></div><div><div style="font-size:.58rem;color:var(--mu);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">Available Now</div><div style="font-size:.9rem;font-weight:800;color:${pb.units>0?'var(--gr)':'var(--re)'}">${pb.units}b</div><div style="font-size:.62rem;color:var(--mu)">${fmt(pb.weight)}kg</div></div></div><div style="padding:7px 10px;background:rgba(34,197,94,.07);border-radius:5px;font-size:.7rem;color:var(--gr);">
      ℹ Max dispatch: <strong>${pb.units}b / ${fmt(pb.weight)}kg</strong></div>`;if(avEl){avEl.textContent=`${pb.units}b / ${fmt(pb.weight)}kg`;avEl.style.color=pb.units>0?'var(--gr)':'var(--re)';}
if(weightEl){weightEl.max=pb.weight;weightEl.placeholder=`0 – ${fmt(pb.weight)}`;}}
function filterLotOpts(){const q=(document.getElementById('sf-lot-search')?.value||'').toLowerCase().trim();const sel=document.getElementById('sf-lot-stage');if(!sel)return;const opts=sel.querySelectorAll('option');let shown=0;opts.forEach(o=>{if(!o.value){o.style.display='';return;}
const match=!q||o.text.toLowerCase().includes(q);o.style.display=match?'':'none';if(match)shown++;});if(q&&shown>0){sel.size=Math.min(shown+1,6);sel.style.height='auto';sel.style.minHeight=(Math.min(shown+1,6)*32)+'px';}else{sel.size=1;sel.style.height='';sel.style.minHeight='';sel.value='';}
const cnt=document.getElementById('sf-lot-count');if(cnt)cnt.textContent=q?(shown+' lot'+(shown===1?'':'s')+' found'):'';if(shown===1){const visible=[...opts].find(o=>o.value&&o.style.display!=='none');if(visible){sel.value=visible.value;sel.size=1;updateStageAvail();}}}
function updateStageAvail(){const v=document.getElementById('sf-lot-stage')?.value;
const banner=document.getElementById('sf-avail-banner');
if(!v){if(banner)banner.innerHTML='<span style="color:var(--mu)">Available from previous stage</span><span id="sf-avail" class="mono" style="color:var(--mu)">— select lot</span>';return;}
const parts=v.split('||');const lotId=parts[0];const stage=parts[1];const grade=parts[2]||'';const vendor=parts[3]||'';
const _saL=getLotByKey(lotId,grade,vendor)||getLot(lotId);
const bal=stageBalance(lotId,stage,_saL.grade,_saL.vendor);
const balColor=bal.units>0?'var(--gr)':'var(--re)';
if(banner)banner.innerHTML=`<strong>${lotId}</strong> — ${grade||_saL.grade||'—'} · ${vendor||_saL.vendor||'—'}<br><span style="color:var(--mu);font-size:0.72rem">Stage: ${stage}</span><br>Available: <strong style="color:${balColor}">${fmt(bal.units)} bags / ${fmt(bal.weight)}kg</strong>`;}
function openRMModal(){populateSelects();document.getElementById('rm-modal-title').textContent='📦 New Raw Material Lot';document.getElementById('m-rm-lot').readOnly=false;document.getElementById('m-rm-lot').value='';document.getElementById('m-rm-units').value='';document.getElementById('m-rm-weight').value='';document.getElementById('m-rm-challan').value='';document.getElementById('m-rm-date').value=today();document.getElementById('rm-alert').innerHTML='';document.getElementById('rm-partial-panel').style.display='none';document.getElementById('rm-form-body').style.opacity='1';document.getElementById('rm-modal-foot').style.display='flex';document.getElementById('rm-modal').classList.add('open');}
function checkRMLotDuplicate(){const lot=document.getElementById('m-rm-lot').value.trim();const vendor=document.getElementById('m-rm-vendor').value;const grade=document.getElementById('m-rm-grade').value;if(!lot||!vendor||!grade)return;const existing=State.DB.lots.find(l=>l.id===lot&&l.vendor===vendor&&l.grade===grade);if(existing){setAlert('rm-alert',`ℹ ${lot} (${vendor} / ${grade}) already exists with ${fmt(existing.units)}b. Submitting will add a new delivery to this lot.`,'alert-warn');}else{document.getElementById('rm-alert').innerHTML='';}}
async function submitRM(){const lot=document.getElementById('m-rm-lot').value.trim();const vendor=document.getElementById('m-rm-vendor').value;const mill=document.getElementById('m-rm-mill').value;const grade=document.getElementById('m-rm-grade').value;const units=parseFloat(document.getElementById('m-rm-units').value)||0;const weight=parseFloat(document.getElementById('m-rm-weight').value)||0;const date=document.getElementById('m-rm-date').value||today();const challan=document.getElementById('m-rm-challan').value.trim();if(!lot||!vendor||!mill||!grade||!units){setAlert('rm-alert','Fill all required fields','alert-err');return;}
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
          closeModal('rm-modal');renderAll();showToast('Lot '+lot+' added ✓');
        }catch(e){setAlert('rm-alert','Network error — '+e.message,'alert-err');}
      }
      return;
    }
    setAlert('rm-alert',error||'Could not add lot','alert-err');return;
  }
  closeModal('rm-modal');renderAll();showToast('Lot '+lot+' added ✓');
}catch(e){setAlert('rm-alert','Network error — '+e.message,'alert-err');}
}
async function confirmPartialDelivery(){if(!State._pendingDelivery)return;const{lot,vendor,mill,grade,units,weight,date,challan}=State._pendingDelivery;try{
  const {ok,data,error,networkError}=await apiPost('/api/rm/create',{lotId:lot,vendor,mill,grade,units,weight,date,challan,changedBy:State.currentUser?.name});
  if(networkError)throw new Error(error);
  if(!ok){showToast(error||'Could not add delivery','err');State._pendingDelivery=null;cancelPartialDelivery();return;}
  State._pendingDelivery=null;cancelPartialDelivery();closeModal('rm-modal');renderAll();showToast('Delivery added to '+lot+' ✓');
}catch(e){showToast('Network error — '+e.message,'err');State._pendingDelivery=null;cancelPartialDelivery();}
}
function cancelPartialDelivery(){State._pendingDelivery=null;document.getElementById('rm-partial-panel').style.display='none';document.getElementById('rm-form-body').style.opacity='1';document.getElementById('rm-modal-foot').style.display='flex';}
function openAddDelivery(lotId,grade,vendor){const lot=(grade&&vendor)?getLotByKey(lotId,grade,vendor):State.DB.lots.find(l=>l.id===lotId);if(!lot||!lot.id)return;populateSelects();document.getElementById('rm-modal-title').textContent='📦 Add Delivery to '+lotId;document.getElementById('m-rm-lot').value=lot.id;document.getElementById('m-rm-lot').readOnly=true;document.getElementById('m-rm-vendor').value=lot.vendor;document.getElementById('m-rm-grade').value=lot.grade;document.getElementById('m-rm-mill').value=lot.mill;document.getElementById('m-rm-units').value='';document.getElementById('m-rm-weight').value='';document.getElementById('m-rm-challan').value='';document.getElementById('m-rm-date').value=today();document.getElementById('rm-alert').innerHTML='';document.getElementById('rm-partial-panel').style.display='none';document.getElementById('rm-form-body').style.opacity='1';document.getElementById('rm-modal-foot').style.display='flex';openModal('rm-modal');}



let _adminUsersCache=[];
async function renderUsers(){const isAdminRole=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';document.getElementById('users-tbody').innerHTML='<tr><td colspan="6" class="empty-text" style="padding:14px">Loading...</td></tr>';
try{const res=await fetch(WORKER_URL+'/api/users/list',{headers:_getHeaders()});const data=await res.json();_adminUsersCache=data.users||[];}catch(e){console.error('[Users] Failed to load:',e);document.getElementById('users-tbody').innerHTML='<tr><td colspan="6" class="empty-text" style="padding:14px">✕ Failed to load users</td></tr>';return;}
const usersToShow=_adminUsersCache;document.getElementById('users-tbody').innerHTML=usersToShow.map(u=>{return`<tr><td>${u.name}</td><td class="mono">${u.username}</td><td><span class="rbadge ${u.role==='manager'?'rm':u.role==='supervisor'?'rs':'rw'}">${u.role}</span></td><td style="font-size:0.75rem;color:var(--mu)">${u.role==='worker'?u.stage:'All'}</td><td><span class="badge ${u.active!==false?'b-approved':'b-rejected'}">${u.active!==false?'Active':'Disabled'}</span></td><td style="display:flex;gap:4px;flex-wrap:wrap;">
      ${isAdminRole?`<button class="btn bg bxs"onclick="openChangePwModal('${u.id}','${u.name}')">🔑</button>`:''}
      ${isAdminRole?`<button class="btn btn-ghost btn-xs" onclick="toggleUser('${u.id}')">${u.active!==false?'Disable':'Enable'}</button>`:''}
      ${isAdminRole&&u.username!=='admin'?`<button class="btn btn-danger btn-xs"onclick="deleteUser('${u.id}')">Delete</button>`:''}
    </td></tr>`;}).join('')||'<tr><td colspan="6" class="empty-text" style="padding:14px">✕ No users</td></tr>';}
async function addUser(){const name=document.getElementById('nu-name').value.trim();const username=document.getElementById('nu-user').value.trim().toLowerCase();const password=document.getElementById('nu-pass').value;const role=document.getElementById('nu-role').value;const stage=document.getElementById('nu-stage').value;if(!name||!username||password.length<8){await showAlert('Fill all fields. Password must be at least 8 characters.','Missing Fields');return;}
try{const {ok,data,error,networkError}=await apiPost('/api/users/create',{name,username,password,role,stage});
  if(networkError)throw new Error(error);
  if(!ok){await showAlert(error||'Could not create user','Create User Failed');return;}
['nu-name','nu-user','nu-pass'].forEach(id=>document.getElementById(id).value='');renderUsers();}catch(e){console.error('[Users] Create failed:',e);alert('Could not reach server');}}
async function toggleUser(id){try{const {ok,data,error,networkError}=await apiPost('/api/users/toggle',{id});
  if(networkError)throw new Error(error);
  if(!ok){showToast(error||'Could not update user','err');return;}
renderUsers();}catch(e){console.error('[Users] Toggle failed:',e);showToast('Could not reach server','err');}}
async function deleteUser(id){const u=_adminUsersCache.find(x=>x.id===id);if(!u)return;if(!await showConfirm(`Delete user ${u.name}? This cannot be undone.`,'Delete User','Delete',true))return;try{const {ok,data,error,networkError}=await apiPost('/api/users/delete',{id});
  if(networkError)throw new Error(error);
  if(!ok){showToast(error||'Could not delete user','err');return;}
renderUsers();}catch(e){console.error('[Users] Delete failed:',e);showToast('Could not reach server','err');}}
function toggleViewPassword(userId){const u=(State.DB.users||[]).find(x=>x.id===userId);if(!u)return;const cell=document.getElementById('pwd-cell-'+userId);if(!cell)return;if(cell.textContent==='••••••'){cell.textContent=u.password;cell.style.color='var(--ac)';setTimeout(()=>{if(cell.textContent===u.password){cell.textContent='••••••';cell.style.color='var(--mu)';}},5000);}else{cell.textContent='••••••';cell.style.color='var(--mu)';}}
export function renderWorkerView(){const u=State.currentUser;document.getElementById('wv-av').textContent=u.name[0].toUpperCase();document.getElementById('wv-name').textContent=u.name;document.getElementById('wv-role').textContent=u.stage==='all'?'All Stages':u.stage+' Operator';const stages=u.stage==='all'?['Soft','Dye','Wind','Pack','Dispatch']:u.stage.split(',').map(s=>s.trim());const mOpts=State.DB.masters.machines.map(v=>`<option value="${v}">${v}</option>`).join('');const _wW=State.DB.masters.workers||[];const wOpts=`<option value="${State.currentUser?.name||''}">${State.currentUser?.name||''}</option>`;const todayStr=today();const myStage=State.DB.stageEntries.filter(e=>e.startWorker===u.name&&(e.startTime||'').startsWith(todayStr));const myWind=(State.DB.windEntries||[]).filter(e=>e.startWorker===u.name&&(e.startTime||'').startsWith(todayStr));const myPack=(State.DB.packEntries||[]).filter(e=>e.worker===u.name&&(e.timestamp||'').startsWith(todayStr));const myDisp=(State.DB.dispatches||[]).filter(e=>e.by===u.name&&(e.timestamp||'').startsWith(todayStr));const todayEntries=myStage.length+myWind.length+myPack.length+myDisp.length;const todayKg=[...myStage,...myWind,...myPack].reduce((a,e)=>a+(e.outWeight||e.weight||0),0);let stageNav='';if(stages.length>1){stageNav=`<div style="display:flex;gap:6px;overflow-x:auto;padding:0 0 8px 0;-webkit-overflow-scrolling:touch;margin-bottom:4px">
      ${stages.map((s,i)=>`<button onclick="wJumpStage('${s}')"id="wjmp-${s}"style="flex-shrink:0;padding:6px 14px;border-radius:20px;border:1px solid var(--b2);background:${i===0?'var(--ac)':'var(--s2)'};color:${i===0?'#000':'var(--tx)'};font-size:0.72rem;font-weight:700;cursor:pointer">${s}</button>`).join('')}
    </div>`;}
let html=`
    <div style="background:var(--s2);border-radius:12px;padding:12px 16px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center"><div><div style="font-size:0.65rem;color:var(--mu);font-weight:700;text-transform:uppercase;letter-spacing:.08em">Today's Activity</div><div style="font-size:1.1rem;font-weight:800;color:var(--ac);font-family:monospace">${todayEntries} entries</div></div><div style="text-align:right"><div style="font-size:0.65rem;color:var(--mu);font-weight:700;text-transform:uppercase;letter-spacing:.08em">Output</div><div style="font-size:1.1rem;font-weight:800;color:var(--gr);font-family:monospace">${fmt(todayKg)}kg</div></div></div>
    ${stageNav}`;stages.forEach(s=>{if(s==='Soft')html+=workerStageForm(s,mOpts,wOpts);else if(s==='Wind')html+=workerWindForm(mOpts);else if(s==='Pack')html+=workerPackForm();else if(s==='Dye')html+=workerDyeForm(mOpts,wOpts);else if(s==='Dispatch')html+=workerDispForm();});html+=workerMyHistory();document.getElementById('wv-body').innerHTML=html;document.querySelectorAll('.wv-body input[type=date]').forEach(el=>{if(!el.value)el.value=today();});if(stages.length>1)wJumpStage(stages[0]);}
function stageIcon(s){return STAGE_CONFIG[s]?.icon||'⚙';}
function stageColor(s){return STAGE_CONFIG[s]?.color||'var(--ac)';}
function workerStageForm(stage,mOpts,wOpts=''){const inProg=State.DB.stageEntries.filter(e=>e.stage===stage&&e.status==='InProgress');const eligible=lotsForStage(stage);const lotOpts=eligible.map(l=>{const bal=stageBalance(l.id,stage,l.grade,l.vendor);return`<option value="${l.id}||${l.grade}||${l.vendor}">${l.id} — ${l.grade} — ${l.vendor} (${fmt(bal.units)}b avail)</option>`;}).join('');const ipOpts=inProg.map(e=>`<option value="${e.id}">${e.lotId} — ${fmt(e.inUnits)}b started ${fmtTS(e.startTime)}</option>`).join('');return`<div class="wstage-card" data-stage="${stage}" style="border-color:${stageColor(stage)}20"><div class="wstage-hdr"><div class="wstage-icon">${stageIcon(stage)}</div><div><div class="wstage-name">${stage}</div><div class="wstage-sub">Start = input quantity | End = output quantity</div></div></div><div id="w-${stage}-alert"></div><div class="tabs" style="margin-bottom:12px;"><div class="tab active" onclick="wSwitchTab('${stage}','start',this)">▶ Start</div><div class="tab" onclick="wSwitchTab('${stage}','end',this)">End</div></div><div id="w-${stage}-start-tab"><div class="wavail"><span class="wavail-label">Select lot to see available</span></div><div class="wfield"><label>Lot *</label><select id="w-${stage}-lot-start" onchange="wUpdateAvail('${stage}')"><option value="">— ${eligible.length?'Select Lot':'No lots ready for '+stage} —</option>${lotOpts}
        </select></div><div id="w-${stage}-avail-start" class="wavail" style="display:none"><span class="wavail-label">Available</span><span class="wavail-val" style="color:var(--gr)">—</span></div><div class="w2col"><div class="wfield"><label>In Bags *</label><input id="w-${stage}-in-u" type="number" placeholder="0"></div><div class="wfield"><label>Input Weight (kg)</label><input id="w-${stage}-in-w" type="number" placeholder="0"></div></div><div class="wfield"><label>Machine</label><select id="w-${stage}-mach-start">${mOpts}</select></div>
      ${wOpts?`<div class="wfield"><label>Worker*</label><select id="w-${stage}-worker-start">${wOpts}</select></div>`:''}
      ${stage==='Soft'?`<div class="wfield"><label>Note (optional)</label><input class="winp" id="w-${stage}-start-note" placeholder="e.g. Machine running slow, material condition..."></div>${specialMaterialSectionHTML(`w-${stage}-ds-select`,`w-${stage}-rc-select`,'wfield','',`<div style="border-top:1px solid var(--b1);padding-top:10px;margin-top:8px">`,'</div>')}`:''}
      <button class="wsubmit" id="w-start-btn-${stage}" onclick="wSubmitStart('${stage}')">▶ Record Start</button></div><div id="w-${stage}-end-tab" style="display:none;">
      ${inProg.length
        ? `<div class="wfield"><label>Select In-Progress Entry*</label><select id="w-${stage}-ip"onchange="wShowEndRef('${stage}')"><option value="">Select entry</option>${ipOpts}</select></div><div id="w-${stage}-ref"style="display:none;background:var(--s2);border:1px solid var(--b2);border-radius:9px;padding:12px;margin-bottom:10px;"></div>`
        : '<div class="walert info">No in-progress entries for this stage. Start one first.</div>'}
      <div class="w2col"><div class="wfield"><label>Out Bags *</label><input id="w-${stage}-out-u" type="number" placeholder="0"></div><div class="wfield"><label>Output Weight (kg)</label><input id="w-${stage}-out-w" type="number" placeholder="0"></div></div>
      ${stage==='Soft'?`<div class="wfield"><label>Note (optional)</label><input class="winp" id="w-${stage}-end-note" placeholder="e.g. Output quality observation, wastage reason..."></div>`:''}
      <button class="wsubmit" onclick="wSubmitEnd('${stage}')">Record End</button></div></div>`;}
function dyeQualifyingDeadStock(){
  const steelDS=(State.DB.deadStock||[]).filter(d=>d.status==='Approved'&&d.type==='Steel'&&getDeadStockBalance(d.id)>0);
  const plasticDSSoftened=(State.DB.deadStock||[]).filter(d=>{if(d.status!=='Approved'||d.type!=='Plastic')return false;const softDone=(State.DB.stageEntries||[]).some(e=>e.deadStockId===d.id&&e.stage==='Soft'&&(e.status==='Approved'||e.status==='Edited-Approved')&&e.outWeight>0);return softDone&&getDeadStockBalance(d.id)>0;});
  return[...steelDS,...plasticDSSoftened];
}
function dyeQualifyingRecycleStock(){
  return(State.DB.recycleStock||[]).filter(r=>{const st=getRCStatus(r.id);const bal=getRecycleBalance(r.id);return st.available&&bal>0;});
}
function dyeQualifyingResidualStock(){
  return(State.DB.residualStock||[]).filter(r=>getResidualBalance(r.id)>0);
}
function workerDyeForm(mOpts,wOpts=''){const gradeOpts=[...new Set(State.DB.lots.map(l=>l.grade))].map(g=>`<option value="${g}">${g} — Pool: ${fmt(getGradePool(g).units)}u</option>`).join('');const inProg=(State.DB.dyeLots||[]).filter(b=>b.status==='InProgress');const ipOpts=inProg.map(b=>`<option value="${b.id}">${b.id} — ${b.machine} — ${fmt(b.totalInWeight)}kg — ${fmtTS(b.startTime)}</option>`).join('');const _wdyFY=currentFY();const _wdyPrevFY=String(parseInt(_wdyFY.slice(0,2))-1)+String(parseInt(_wdyFY.slice(2))-1);const _wdyFYOpts=[_wdyFY,_wdyPrevFY].map(f=>`<option value="${f}"${f===_wdyFY?' selected':''}>${f.slice(0,2)}-${f.slice(2)}</option>`).join('');return`<div class="wstage-card" style="border-color:${stageColor('Dye')}20"><div class="wstage-hdr"><div class="wstage-icon">🎨</div><div><div class="wstage-name">Dye Batch</div><div class="wstage-sub">Start = input lots + formula | End = output quantity</div></div></div><div id="w-Dye-alert"></div><div class="tabs" style="margin-bottom:12px;"><div class="tab active" onclick="wSwitchTab('Dye','start',this)">▶ Start</div><div class="tab" onclick="wSwitchTab('Dye','end',this)">End</div></div><div id="w-Dye-start-tab"><div class="wfield"><label>Grade *</label><select id="w-dye-grade" onchange="refreshWDyeLots()">${gradeOpts}</select></div><div id="w-dye-src-1"><div class="wfield"><label>Source Lot 1</label><select id="w-dye-lot1" onchange="wDyeCalcTotal()"><option value="">— Select grade first —</option></select></div><div class="w2col"><div class="wfield"><label>Units</label><input id="w-dye-u1" type="number" placeholder="0" oninput="wDyeCalcTotal()"></div><div class="wfield"><label>Weight (kg)</label><input id="w-dye-w1" type="number" placeholder="0"></div></div></div><div id="w-dye-src-2" style="display:none"><div class="wfield"><label>Source Lot 2 (optional)</label><select id="w-dye-lot2"><option value="">None</option></select></div><div class="w2col"><div class="wfield"><label>Units</label><input id="w-dye-u2" type="number" placeholder="0" oninput="wDyeCalcTotal()"></div><div class="wfield"><label>Weight (kg)</label><input id="w-dye-w2" type="number" placeholder="0"></div></div></div><button class="btn btn-ghost btn-sm" style="margin-bottom:12px;width:100%" onclick="document.getElementById('w-dye-src-2').style.display='block'">+ Add 2nd Lot</button><div class="wavail"><span class="wavail-label">Total input</span><span class="wavail-val" id="w-dye-total" style="color:var(--ac)">0u</span></div>
      ${(()=>{const ds=dyeQualifyingDeadStock();const rc=dyeQualifyingRecycleStock();const rs=dyeQualifyingResidualStock();if(!ds.length&&!rc.length&&!rs.length)return'';
        const dsOpts=ds.map(d=>`<option value="${d.id}">${d.id} — ${d.grade} (${fmt(getDeadStockBalance(d.id))}kg avail)</option>`).join('');
        const rcOpts=rc.map(r=>`<option value="${r.id}">${r.id} — ${r.dyeLotNo} — ${r.shade} (${fmt(getRecycleBalance(r.id))}kg avail)</option>`).join('');
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
function getDyeSrcOpts(grade){const trueBal=l=>{const tKey=_summaryKey(l.id,l.grade,l.vendor);return State._trueSoftAvail?.[tKey]||getSoftBalanceAvailable(l.id,l.grade,l.vendor);};const eligible=State.DB.lots.filter(l=>(grade?l.grade===grade:true)&&trueBal(l).units>0);if(!eligible.length)return'<option value="" disabled>No lots with Soft balance'+(grade?' for grade '+grade:'')+'</option>';return eligible.map(l=>{const bal=trueBal(l);return`<option value="${l.id}||${l.grade}||${l.vendor}">${l.id} — ${l.grade} — ${l.vendor} (${fmt(bal.units)}u avail)</option>`;}).join('');}
function workerDispForm(){const eligibleDyeLots=(State.DB.dyeLots||[]).filter(d=>(d.status==='Approved'||d.status==='Edited-Approved')&&getPackBalAvailable(d.id).weight>0).sort(sortDyeLotNo);
// Searchable dispatch lot dropdown built per row in renderDispatchLotRows
const lotOpts=eligibleDyeLots.map(d=>{const pb=getPackBalAvailable(d.id);const grades=(d.sources||[]).map(s=>s.grade).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join('+');return`<option value="${d.id}">${d.dyeLotNo}${grades?' ('+grades+')':''} — ${pb.units}b ${fmt(pb.weight)}kg avail</option>`;}).join('');return`<div class="wstage-card" style="border-color:${stageColor('Dispatch')}20"><div class="wstage-hdr"><div class="wstage-icon">🚚</div><div><div class="wstage-name">Dispatch</div><div class="wstage-sub">Send to party</div></div></div><div id="w-Dispatch-alert"></div><div class="wfield"><label>Party *</label><select id="w-disp-party"><option value="">Select Party</option>${(State.DB.parties||[]).map(v=>`<option value="${v}">${v}</option>`).join('')}</select></div><div class="wfield"><label>Invoice / Challan No *</label><input id="w-disp-invoice" placeholder="e.g. INV-2627-045"></div><div id="w-disp-lots"><div class="w-disp-row"><div class="wfield"><label>Dye Lot *</label><select class="w-disp-lot-sel" onchange="wDispRowAvail(this)"><option value="">Select</option>${lotOpts}</select></div><div class="wavail"><span class="wavail-label">Pack balance</span><span class="wavail-val w-disp-row-avail" style="color:var(--mu)">—</span></div><div class="w2col"><div class="wfield"><label>Bags *</label><input class="w-disp-row-units" type="number" placeholder="0"></div><div class="wfield"><label>Weight (kg)</label><input class="w-disp-row-weight" type="number" placeholder="0"></div></div></div></div><button class="btn btn-ghost btn-sm" style="margin:8px 0;width:100%" onclick="wDispAddLotRow()">+ Add Another Lot</button><button class="wsubmit" id="w-disp-submit-btn" onclick="wSubmitDisp()">Confirm Dispatch →</button></div>`;}
function workerMyHistory(){const name=State.currentUser?.name||'';const all=[...State.DB.stageEntries.filter(e=>e.startWorker===name||e.endWorker===name).map(e=>({...e,_type:e.stage||'Soft',_label:e.lotId,_ts:e.startTime})),...(State.DB.windEntries||[]).filter(e=>e.startWorker===name).map(e=>({...e,_type:'Wind',_label:e.dyeLotNo||e.dyeLotId,_ts:e.startTime})),...(State.DB.packEntries||[]).filter(e=>e.worker===name).map(e=>({...e,_type:'Pack',_label:e.dyeLotNo||e.dyeLotId,_ts:e.timestamp})),...(State.DB.dispatches||[]).filter(e=>e.by===name).map(e=>({...e,_type:'Dispatch',_label:(e.dyeLotNo||'')+'→'+e.party,_ts:e.timestamp})),].sort((a,b)=>(b._ts||'').localeCompare(a._ts||'')).slice(0,8);if(!all.length)return'<div style="padding:14px;text-align:center;color:var(--mu);font-size:0.78rem">No entries yet today</div>';const stageCol={Soft:'var(--cs)',Dye:'var(--cd)',Wind:'var(--cw)',Pack:'var(--cp)',Dispatch:'var(--gr)'};return`<div class="w-history"><div class="w-hist-title">My Recent Entries</div>
    ${all.map(e=>`<div class="w-hist-row"style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--b1)"><div><span style="font-size:0.65rem;font-weight:700;color:${stageCol[e._type]||'var(--ac)'};background:${stageCol[e._type]||'var(--ac)'}15;padding:2px 6px;border-radius:4px;margin-right:6px">${e._type}</span><span style="font-size:0.75rem;color:var(--tx)">${e._label||'—'}</span></div><div style="display:flex;align-items:center;gap:6px"><span style="font-size:0.65rem;color:var(--mu)">${(e._ts||'').slice(0,10)}</span>${statusBadge(e.status)}</div></div>`).join('')}
  </div>`;}
function wJumpStage(stage){const card=document.querySelector(`#wv-body .wstage-card[data-stage="${stage}"]`);if(card)card.scrollIntoView({behavior:'smooth',block:'start'});document.querySelectorAll('[id^="wjmp-"]').forEach(btn=>{const isActive=btn.id===`wjmp-${stage}`;btn.style.background=isActive?'var(--ac)':'var(--s2)';btn.style.color=isActive?'#000':'var(--tx)';});}
function wSwitchTab(stage,tab,el){document.getElementById(`w-${stage}-start-tab`).style.display=tab==='start'?'':'none';document.getElementById(`w-${stage}-end-tab`).style.display=tab==='end'?'':'none';el.parentNode.querySelectorAll('.wtab').forEach(t=>t.classList.remove('active'));el.classList.add('active');if(tab==='end'){if(stage==='Dye'){const sel=document.getElementById('w-dye-ip');if(sel){const opts=[...sel.options].filter(o=>o.value);if(opts.length===1){sel.value=opts[0].value;wShowDyeEndRef();}}}else{const sel=document.getElementById(`w-${stage}-ip`);if(sel){const opts=[...sel.options].filter(o=>o.value);if(opts.length===1){sel.value=opts[0].value;wShowEndRef(stage);}}}}}
function wShowDyeEndRef(){const sel=document.getElementById('w-dye-ip');const ref=document.getElementById('w-dye-end-ref');const outU=document.getElementById('w-dye-out-u');const outW=document.getElementById('w-dye-out-w');if(!sel||!ref)return;const id=sel.value;if(!id){ref.style.display='none';return;}
const b=(State.DB.dyeLots||[]).find(x=>x.id===id);if(!b){ref.style.display='none';return;}
const elapsed=hrsBetween(b.startTime,new Date().toISOString());const _refGrades=[...new Set((b.sources||[]).map(s=>s.grade).filter(Boolean))].join(' / ')||'—';const sourcesText=(b.sources||[]).map(s=>`${s.lotId}(${fmt(s.cones||0)}c)`).join(' + ')||'—';ref.style.display='block';ref.innerHTML=`
    <div style="font-size:.58rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--cd);margin-bottom:8px;">📋 Batch Reference</div><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px;"><div><div style="font-size:.6rem;color:var(--mu)">Grade</div><div style="font-size:.85rem;font-weight:700;color:var(--ac)">${_refGrades}</div></div><div><div style="font-size:.6rem;color:var(--mu)">Total Input</div><div style="font-size:.85rem;font-weight:700;color:var(--bl)">${fmt(b.totalInCones)}c</div><div style="font-size:.62rem;color:var(--mu)">${fmt(b.totalInWeight)}kg</div></div><div><div style="font-size:.6rem;color:var(--mu)">Running Time</div><div style="font-size:.78rem;font-weight:700;color:var(--cy)">${fmtHrs(elapsed)}</div><div style="font-size:.6rem;color:var(--mu)">by ${b.startWorker||'—'}</div></div><div><div style="font-size:.6rem;color:var(--mu)">RM Lot</div><div style="font-size:.7rem;font-weight:600;color:var(--ac)">${(b.sources||[]).filter(s=>s.lotId&&s.sourceType!=='recycle'&&!s.recycleId).map(s=>s.lotId).join(' / ')||'—'}</div></div><div style="grid-column:span 2"><div style="font-size:.6rem;color:var(--mu)">Vendor</div><div style="font-size:.7rem;font-weight:600">${(b.sources||[]).filter(s=>s.vendor&&s.sourceType!=='recycle'&&!s.recycleId).map(s=>s.vendor).join(' / ')||'—'}</div></div></div>
    ${b.notes?`<div style="padding:6px 9px;background:rgba(168,85,247,.08);border-radius:5px;font-size:.68rem;color:var(--cd);border-left:2px solid var(--cd)">📋 Formula:${b.notes}</div>`:''}
    <div style="margin-top:8px;padding:6px 9px;background:rgba(59,130,246,.08);border-radius:5px;font-size:.68rem;color:var(--bl);">
      Max output: <strong>${fmt(b.totalInCones)}c / ${fmt(b.totalInWeight)}kg</strong></div>`;if(outU){outU.max=b.totalInCones;outU.placeholder=`0 – ${fmt(b.totalInCones)}`;}
if(outW){outW.max=b.totalInWeight;outW.placeholder=`0 – ${fmt(b.totalInWeight)}`;}}
function wShowEndRef(stage){const sel=document.getElementById(`w-${stage}-ip`);const ref=document.getElementById(`w-${stage}-ref`);const outU=document.getElementById(`w-${stage}-out-u`);const outW=document.getElementById(`w-${stage}-out-w`);if(!sel||!ref)return;const id=sel.value;if(!id){ref.style.display='none';return;}
const e=State.DB.stageEntries.find(x=>x.id===id);if(!e){ref.style.display='none';return;}
const elapsed=hrsBetween(e.startTime,new Date().toISOString());const SCOL={Soft:'var(--cs)',Wind:'var(--cw)',Pack:'var(--cp)'};const c=SCOL[stage]||'var(--ac)';ref.style.display='block';ref.innerHTML=`
    <div style="font-size:.58rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:${c};margin-bottom:8px;">📋 Start Reference</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;"><div><div style="font-size:.6rem;color:var(--mu)">Lot / Grade</div><div style="font-size:.85rem;font-weight:700;color:#fff">${e.lotId}</div><div style="font-size:.62rem;color:var(--mu)">${e.grade||''}</div></div><div><div style="font-size:.6rem;color:var(--mu)">Input Loaded</div><div style="font-size:.95rem;font-weight:700;color:var(--bl)">${fmt(e.inUnits)}u</div><div style="font-size:.62rem;color:var(--mu)">${fmt(e.inWeight)}kg</div></div><div><div style="font-size:.6rem;color:var(--mu)">Machine</div><div style="font-size:.78rem;font-weight:600">${e.machine||'—'}</div></div><div><div style="font-size:.6rem;color:var(--mu)">Running Time</div><div style="font-size:.78rem;font-weight:700;color:var(--cy)">${fmtHrs(elapsed)}</div><div style="font-size:.6rem;color:var(--mu)">Started by ${e.startWorker||'—'}</div></div></div><div style="margin-top:8px;padding:6px 9px;background:rgba(59,130,246,.08);border-radius:5px;font-size:.68rem;color:var(--bl);">
      Max output: <strong>${fmt(e.inUnits)}u / ${fmt(e.inWeight)}kg</strong></div>`;if(outU){outU.max=e.inUnits;outU.placeholder=`0 – ${fmt(e.inUnits)}`;}
if(outW){outW.max=e.inWeight;outW.placeholder=`0 – ${fmt(e.inWeight)}`;}}
function wUpdateAvail(stage){const _wuaRaw=document.getElementById(`w-${stage}-lot-start`)?.value||'';const{lotId,grade:_wuaGrade,vendor:_wuaVendor}=parseLotSelectValue(_wuaRaw);if(!lotId){document.getElementById(`w-${stage}-avail-start`).style.display='none';return;}
const _wssL=getLotByKey(lotId,_wuaGrade,_wuaVendor)||getLot(lotId);const bal=stageBalance(lotId,stage,_wssL.grade,_wssL.vendor);const el=document.getElementById(`w-${stage}-avail-start`);if(el){el.style.display='flex';el.querySelector('.wavail-val').textContent=`${fmt(bal.units)}b / ${fmt(bal.weight)}kg`;el.querySelector('.wavail-val').style.color=bal.units>0?'var(--gr)':'var(--re)';}}
function wDispRowAvail(sel){const row=sel.closest('.w-disp-row');if(!row)return;const dyeLotId=sel.value||'';const pb=dyeLotId?getPackBal(dyeLotId):{bags:0,weight:0};const el=row.querySelector('.w-disp-row-avail');if(el){el.textContent=dyeLotId?`${pb.units}b / ${fmt(pb.weight)}kg avail`:'—';el.style.color=pb.weight>0?'var(--gr)':'var(--re)';}}
function wDispAddLotRow(){const list=document.getElementById('w-disp-lots');if(!list)return;const first=list.querySelector('.w-disp-row');if(!first)return;const clone=first.cloneNode(true);clone.querySelectorAll('input').forEach(i=>i.value='');clone.querySelectorAll('select').forEach(s=>s.value='');const av=clone.querySelector('.w-disp-row-avail');if(av){av.textContent='—';av.style.color='var(--mu)';}
const rmBtn=document.createElement('button');rmBtn.className='btn btn-ghost btn-xs';rmBtn.style.cssText='color:var(--re);margin-top:4px';rmBtn.textContent='✕ Remove this lot';rmBtn.onclick=()=>clone.remove();clone.appendChild(rmBtn);list.appendChild(clone);}
function refreshWDyeLots(){
  if(!State._trueSoftAvail){_fetchTrueSoftAvailable(()=>_refreshWDyeLotsImpl());return;}
  _refreshWDyeLotsImpl();
}
function _refreshWDyeLotsImpl(){const grade=document.getElementById('w-dye-grade')?.value;const opts=getDyeSrcOpts(grade);const s1=document.getElementById('w-dye-lot1');const s2=document.getElementById('w-dye-lot2');if(s1)s1.innerHTML='<option value="">Select Lot</option>'+opts;if(s2)s2.innerHTML='<option value="">None</option>'+opts;}
function wDyeCalcTotal(){const u1=parseFloat(document.getElementById('w-dye-u1')?.value)||0;const u2=parseFloat(document.getElementById('w-dye-u2')?.value)||0;const el=document.getElementById('w-dye-total');if(el)el.textContent=`${fmt(u1+u2)}u`;}
function showConfirm(msg,title='Confirm',confirmLabel='Confirm',isDanger=true){return new Promise(resolve=>{let el=document.getElementById('_scm-overlay');if(!el){el=document.createElement('div');el.id='_scm-overlay';el.className='overlay';el.innerHTML='<div class="modal" style="max-width:460px"><div id="_scm-title" style="font-size:0.95rem;font-weight:800;color:#fff;margin-bottom:10px"></div><div id="_scm-msg" style="font-size:0.82rem;color:var(--mu);line-height:1.6;margin-bottom:20px;white-space:pre-wrap"></div><div class="modal-foot"><button class="btn btn-ghost btn-sm" id="_scm-cancel">Cancel</button><button class="btn btn-sm" id="_scm-ok" style="font-weight:700"></button></div></div>';document.body.appendChild(el);}document.getElementById('_scm-title').textContent=title;document.getElementById('_scm-msg').textContent=msg;const okBtn=document.getElementById('_scm-ok');okBtn.textContent=confirmLabel;okBtn.className='btn btn-sm '+(isDanger?'btn-danger':'btn-primary');el.classList.add('open');const close=val=>{el.classList.remove('open');okBtn.onclick=null;document.getElementById('_scm-cancel').onclick=null;resolve(val);};okBtn.onclick=()=>close(true);document.getElementById('_scm-cancel').onclick=()=>close(false);});}
function showAlert(msg,title='Notice'){return new Promise(resolve=>{let el=document.getElementById('_sam-overlay');if(!el){el=document.createElement('div');el.id='_sam-overlay';el.className='overlay';el.innerHTML='<div class="modal" style="max-width:440px"><div id="_sam-title" style="font-size:0.95rem;font-weight:800;color:#fff;margin-bottom:10px"></div><div id="_sam-msg" style="font-size:0.82rem;color:var(--mu);line-height:1.6;margin-bottom:20px;white-space:pre-wrap"></div><div class="modal-foot"><button class="btn btn-ghost btn-sm" id="_sam-ok">OK</button></div></div>';document.body.appendChild(el);}document.getElementById('_sam-title').textContent=title;document.getElementById('_sam-msg').textContent=msg;const okBtn=document.getElementById('_sam-ok');el.classList.add('open');const close=()=>{el.classList.remove('open');okBtn.onclick=null;resolve();};okBtn.onclick=close;});}
function wSetAlert(stage,msg,cls){setAlert(`w-${stage}-alert`,msg,cls,{classPrefix:'walert',autoClear:cls==='ok'});}
async function wSubmitEnd(stage){const ipId=document.getElementById(`w-${stage}-ip`)?.value;const outU=parseFloat(document.getElementById(`w-${stage}-out-u`)?.value)||0;const outW=parseFloat(document.getElementById(`w-${stage}-out-w`)?.value)||0;const endNote=document.getElementById(`w-${stage}-end-note`)?.value.trim()||'';if(!ipId||!outU){wSetAlert(stage,'Select entry and enter output units','err');return;}
const _weBtn=document.querySelector(`#w-${stage}-end-tab .wsubmit`);if(_weBtn)_weBtn.disabled=true;
try{
  const {ok,data,error,networkError}=await apiPost('/api/stage/end',{id:ipId,outUnits:outU,outWeight:outW,endNote,changedBy:State.currentUser.name,idempotencyKey:crypto.randomUUID()});
  if(networkError)throw new Error(error);
  if(!ok){wSetAlert(stage,error||'Failed to end entry','err');if(_weBtn)_weBtn.disabled=false;return;}
  if(_weBtn)_weBtn.disabled=false;showToast();wSetAlert(stage,'✓ End recorded — sent for approval','ok');renderWorkerView();
}catch(e){wSetAlert(stage,'Network error — not saved: '+e.message,'err');if(_weBtn)_weBtn.disabled=false;}}
function wDyeAddSourceRow(type,label){const list=document.getElementById(`w-dye-${type}-list`);if(!list)return;const opts=decodeURIComponent(list.dataset.opts||'');const rowId=`w-dye-${type}-row-${Date.now()}`;const row=document.createElement('div');row.className=`w-dye-${type}-row`;row.id=rowId;row.style.cssText='margin-bottom:8px';row.innerHTML=`<div class="wfield"><label>${label}</label><select class="wselect w-dye-${type}-sel"><option value="">None</option>${opts}</select></div><div class="w2col"><div class="wfield"><label>Weight (kg)</label><input class="winp w-dye-${type}-wt" type="number" placeholder="0"></div><div class="wfield" style="align-self:flex-end"><button class="btn btn-ghost btn-xs" style="color:var(--re)" onclick="document.getElementById('${rowId}').remove()">✕ Remove</button></div></div>`;list.appendChild(row);}
async function wSubmitDyeStart(){const grade=document.getElementById('w-dye-grade')?.value||'';const machine=document.getElementById('w-dye-mach')?.value;const notes=document.getElementById('w-dye-notes')?.value;const _wdyWorker=document.getElementById('w-dye-worker')?.value||State.currentUser?.name;if(!_wdyWorker){wSetAlert('Dye','Select worker','err');return;}
const sources=[];let vFail=false;[[1],[2]].forEach(([n])=>{const lot=document.getElementById(`w-dye-lot${n}`)?.value;const u=parseFloat(document.getElementById(`w-dye-u${n}`)?.value)||0;const w=parseFloat(document.getElementById(`w-dye-w${n}`)?.value)||0;if(!lot||!u)return;const _wdyParts=lot.split('||');const _wdyLotId=_wdyParts[0];const _wdyGrade=_wdyParts[1]||grade;const _wdyVendor=_wdyParts[2]||'';
sources.push({lotId:_wdyLotId,grade:_wdyGrade,vendor:_wdyVendor,weight:w,cones:u,sourceType:'rm'});});
for(const _src of sources){const _dyeDup=(State.DB.dyeLots||[]).find(e=>e.status==='InProgress'&&(e.sources||[]).some(s=>s.lotId===_src.lotId&&s.grade===_src.grade&&s.vendor===_src.vendor));if(_dyeDup){const _elapsed=hrsBetween(_dyeDup.startTime,new Date().toISOString());if(!confirm(`⚠ Lot ${_src.lotId} already used in another Dye batch IN PROGRESS\nDye Lot: ${_dyeDup.id}\nStarted: ${fmtTS(_dyeDup.startTime)} by ${_dyeDup.startWorker||'?'}\nRunning for: ${fmtHrs(_elapsed)}\n\nStart another batch with this lot anyway? (only do this if it's a genuine separate split)`))return;}}
document.querySelectorAll('.w-dye-ds-row').forEach(row=>{const id=row.querySelector('.w-dye-ds-sel')?.value;const wt=parseFloat(row.querySelector('.w-dye-ds-wt')?.value)||0;if(id&&wt>0)sources.push({deadStockId:id,weight:wt,sourceType:'dead'});});
document.querySelectorAll('.w-dye-rc-row').forEach(row=>{const id=row.querySelector('.w-dye-rc-sel')?.value;const wt=parseFloat(row.querySelector('.w-dye-rc-wt')?.value)||0;if(id&&wt>0)sources.push({recycleId:id,weight:wt,sourceType:'recycle'});});
document.querySelectorAll('.w-dye-rs-row').forEach(row=>{const id=row.querySelector('.w-dye-rs-sel')?.value;const wt=parseFloat(row.querySelector('.w-dye-rs-wt')?.value)||0;if(id&&wt>0)sources.push({residualId:id,weight:wt,sourceType:'residual'});});
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
  if(_wdyBtn)_wdyBtn.disabled=false;showToast();wSetAlert('Dye','✓ Dye Start recorded. Come back to End when done.','ok');renderWorkerView();
}catch(e){wSetAlert('Dye','Network error — not saved: '+e.message,'err');if(_wdyBtn)_wdyBtn.disabled=false;}}
function wOnDyeEndSerialInput(){const _fy=document.getElementById('w-dye-end-fy')?.value||currentFY();const _serial=(document.getElementById('w-dye-end-serial')?.value||'').trim();const _sub=(document.getElementById('w-dye-end-sub')?.value||'').trim();if(!_serial)return;const _base='DYE-'+_fy+'-'+_serial;const _full=_base+(_sub?'-'+_sub:'');const _dup=_sub?(State.DB.dyeLots||[]).find(d=>d.dyeLotNo===_full&&d.status!=='Voided'):(State.DB.dyeLots||[]).find(d=>d.dyeLotNo===_base&&d.status!=='Voided');const el=document.getElementById('w-Dye-alert');if(el)el.innerHTML=_dup?`<div class="walert err">⚠ ${_full} already exists. Add a Sub suffix if this is a sub-batch.</div>`:'';}
window.wOnDyeEndSerialInput=wOnDyeEndSerialInput;
async function wSubmitDyeEnd(){const id=document.getElementById('w-dye-ip')?.value;const outU=parseFloat(document.getElementById('w-dye-out-u')?.value)||0;const outW=parseFloat(document.getElementById('w-dye-out-w')?.value)||0;const endNotes=document.getElementById('w-dye-end-notes')?.value.trim()||'';const shade=(document.getElementById('w-dye-end-shade')?.value||'').trim();const fy=document.getElementById('w-dye-end-fy')?.value||currentFY();const serial=(document.getElementById('w-dye-end-serial')?.value||'').trim();const sub=(document.getElementById('w-dye-end-sub')?.value||'').trim();if(!id||!outU){wSetAlert('Dye','Select batch and enter output units','err');return;}
if(!endNotes){wSetAlert('Dye','Formula / Notes (End) is required — confirm formula or describe what changed','err');document.getElementById('w-dye-end-notes')?.focus();return;}
if(!shade){wSetAlert('Dye','Enter shade name/no','err');return;}
if(!serial||isNaN(parseInt(serial))||parseInt(serial)<1){wSetAlert('Dye','Serial No must be a positive number','err');return;}
if(outW<=0){wSetAlert('Dye','Output weight must be > 0','err');return;}
const _deBtn=document.getElementById('w-dye-end-submit-btn');if(_deBtn)_deBtn.disabled=true;
try{
  const {ok,data,error,networkError}=await apiPost('/api/dye/end',{entryId:id,fy,serial,sub,shade,outCones:outU,outWeight:outW,notes:endNotes,changedBy:State.currentUser.name,idempotencyKey:crypto.randomUUID()});
  if(networkError)throw new Error(error);
  if(!ok){wSetAlert('Dye',error||'Failed to end dye batch','err');if(_deBtn)_deBtn.disabled=false;return;}
  if(_deBtn)_deBtn.disabled=false;showToast();wSetAlert('Dye','✓ Dye Lot '+data.dyeLotNo+' created — pending approval','ok');
  // Jul 28 2026 fix — same real bug as the desktop version: dyeLots is
  // only ever loaded once at session start, so a newly-completed dye
  // lot never actually appeared until a full page reload.
  _hydrateDyeLot(id,()=>{renderWorkerView();});
}catch(e){wSetAlert('Dye','Network error — not saved: '+e.message,'err');if(_deBtn)_deBtn.disabled=false;}}
async function wSubmitDisp(){const party=document.getElementById('w-disp-party')?.value;const invoiceNo=(document.getElementById('w-disp-invoice')?.value||'').trim();if(!party){wSetAlert('Dispatch','Select party','err');return;}
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
  if(_dpBtn)_dpBtn.disabled=false;showToast();wSetAlert('Dispatch',`✓ Dispatched ${fmt(totalBags)}b / ${fmt(totalWeight)}kg to ${party}`,'ok');renderWorkerView();
}catch(e){wSetAlert('Dispatch','Network error — not saved: '+e.message,'err');if(_dpBtn)_dpBtn.disabled=false;}}
function _showToastCompat(){showToast();}
async function seedDemo(){if(!await showConfirm('This will replace ALL staging data with demo data. This cannot be undone.','Load Demo Data','Load Demo',true))return;const d=n=>{const dt=new Date();dt.setDate(dt.getDate()-n);return dt.toISOString().split('T')[0];};const ts=n=>{const dt=new Date();dt.setHours(dt.getHours()-n);return dt.toISOString();};const fy=currentFY();State.DB.masters={vendors:['Lalani Sulz','MD Creation','Abhilasha Polyester','Govindam Textile','Shree Yarn'],mills:['Local Mill','Mangalam Yarn','Visaka','Pratibha','Sunrise'],grades:['2/30 AIRJET','2/40 ACRYLIC','15/1 AIRJET','2/30 PV','20/2 COTTON'],machines:['SF-01','SF-02','DY-01','DY-02','WN-01','WN-02','PK-01'],workers:['Ramesh K','Suresh P','Amit V','Priya M','Nazar A','Deepak S','Ravi T'],shades:['Navy Blue 300','Red 45','Black 200','Green 150','White 010','Maroon 88','Sky Blue 22'],dyeLotSettings:[{fy:fy,startingNo:'DYE-'+fy+'-001'}]};State.DB.parties=['Rajesh Exports','Metro Fashion','Sunrise Textiles','Global Threads','Kumar Fabrics'];State.DB.lots=[{id:'4340',vendor:'Lalani Sulz',mill:'Local Mill',grade:'2/30 AIRJET',units:80,weight:5120,date:d(60),challan:'CH-001',createdAt:ts(1440),deliveries:[{units:80,weight:5120,date:d(60),challan:'CH-001'}]},{id:'5398',vendor:'MD Creation',mill:'Mangalam Yarn',grade:'2/40 ACRYLIC',units:60,weight:3600,date:d(55),challan:'CH-002',createdAt:ts(1320),deliveries:[{units:60,weight:3600,date:d(55),challan:'CH-002'}]},{id:'6210',vendor:'Abhilasha Polyester',mill:'Visaka',grade:'15/1 AIRJET',units:50,weight:3200,date:d(50),challan:'CH-003',createdAt:ts(1200),deliveries:[{units:50,weight:3200,date:d(50),challan:'CH-003'}]},{id:'7001',vendor:'Govindam Textile',mill:'Pratibha',grade:'2/30 PV',units:40,weight:2560,date:d(45),challan:'CH-004',createdAt:ts(1080),deliveries:[{units:40,weight:2560,date:d(45),challan:'CH-004'}]},{id:'7842',vendor:'Shree Yarn',mill:'Sunrise',grade:'20/2 COTTON',units:35,weight:2240,date:d(30),challan:'CH-005',createdAt:ts(720),deliveries:[{units:35,weight:2240,date:d(30),challan:'CH-005'}]},{id:'8100',vendor:'Lalani Sulz',mill:'Local Mill',grade:'2/30 AIRJET',units:45,weight:2880,date:d(20),challan:'CH-006',createdAt:ts(480),deliveries:[{units:45,weight:2880,date:d(20),challan:'CH-006'}]},{id:'8250',vendor:'MD Creation',mill:'Mangalam Yarn',grade:'2/40 ACRYLIC',units:30,weight:1800,date:d(10),challan:'CH-007',createdAt:ts(240),deliveries:[{units:30,weight:1800,date:d(10),challan:'CH-007'}]},];State.DB.stageEntries=[{id:'SE-0001',lotId:'4340',grade:'2/30 AIRJET',vendor:'Lalani Sulz',stage:'Soft',inUnits:40,inWeight:2560,outUnits:39,outWeight:2496,wasteUnits:1,wasteWeight:64,machine:'SF-01',startWorker:'Ramesh K',endWorker:'Suresh P',startTime:ts(1380),endTime:ts(1370),status:'Approved',approvedBy:'sup1',approvedAt:ts(1368),startNote:'Batch 1',endNote:'Good quality'},{id:'SE-0002',lotId:'4340',grade:'2/30 AIRJET',vendor:'Lalani Sulz',stage:'Soft',inUnits:40,inWeight:2560,outUnits:39,outWeight:2496,wasteUnits:1,wasteWeight:64,machine:'SF-02',startWorker:'Amit V',endWorker:'Amit V',startTime:ts(1350),endTime:ts(1340),status:'Approved',approvedBy:'sup1',approvedAt:ts(1338),startNote:'Batch 2',endNote:''},{id:'SE-0003',lotId:'5398',grade:'2/40 ACRYLIC',vendor:'MD Creation',stage:'Soft',inUnits:60,inWeight:3600,outUnits:58,outWeight:3480,wasteUnits:2,wasteWeight:120,machine:'SF-01',startWorker:'Priya M',endWorker:'Priya M',startTime:ts(1250),endTime:ts(1238),status:'Approved',approvedBy:'sup1',approvedAt:ts(1236),startNote:'',endNote:'Slight moisture variation'},{id:'SE-0004',lotId:'6210',grade:'15/1 AIRJET',vendor:'Abhilasha Polyester',stage:'Soft',inUnits:30,inWeight:1920,outUnits:29,outWeight:1856,wasteUnits:1,wasteWeight:64,machine:'SF-02',startWorker:'Ramesh K',endWorker:'Ramesh K',startTime:ts(1150),endTime:ts(1140),status:'Approved',approvedBy:'sup1',approvedAt:ts(1138),startNote:'',endNote:''},{id:'SE-0005',lotId:'6210',grade:'15/1 AIRJET',vendor:'Abhilasha Polyester',stage:'Soft',inUnits:20,inWeight:1280,outUnits:20,outWeight:1248,wasteUnits:0,wasteWeight:32,machine:'SF-01',startWorker:'Nazar A',endWorker:'Suresh P',startTime:ts(1100),endTime:ts(1090),status:'Approved',approvedBy:'sup1',approvedAt:ts(1088),startNote:'',endNote:'Clean'},{id:'SE-0006',lotId:'7001',grade:'2/30 PV',vendor:'Govindam Textile',stage:'Soft',inUnits:40,inWeight:2560,outUnits:39,outWeight:2496,wasteUnits:1,wasteWeight:64,machine:'SF-02',startWorker:'Deepak S',endWorker:'Deepak S',startTime:ts(1000),endTime:ts(990),status:'Approved',approvedBy:'sup1',approvedAt:ts(988),startNote:'',endNote:''},{id:'SE-0007',lotId:'7842',grade:'20/2 COTTON',vendor:'Shree Yarn',stage:'Soft',inUnits:35,inWeight:2240,outUnits:34,outWeight:2176,wasteUnits:1,wasteWeight:64,machine:'SF-01',startWorker:'Ravi T',endWorker:'Ravi T',startTime:ts(700),endTime:ts(690),status:'Approved',approvedBy:'sup1',approvedAt:ts(688),startNote:'',endNote:''},{id:'SE-0008',lotId:'8100',grade:'2/30 AIRJET',vendor:'Lalani Sulz',stage:'Soft',inUnits:45,inWeight:2880,outUnits:44,outWeight:2816,wasteUnits:1,wasteWeight:64,machine:'SF-02',startWorker:'Ramesh K',endWorker:'Amit V',startTime:ts(460),endTime:ts(450),status:'Approved',approvedBy:'sup1',approvedAt:ts(448),startNote:'',endNote:'Good'},{id:'SE-0009',lotId:'8250',grade:'2/40 ACRYLIC',vendor:'MD Creation',stage:'Soft',inUnits:30,inWeight:1800,outUnits:29,outWeight:1740,wasteUnits:1,wasteWeight:60,machine:'SF-01',startWorker:'Priya M',endWorker:'Priya M',startTime:ts(20),endTime:ts(10),status:'Pending',approvedBy:'',startNote:'',endNote:'Awaiting check'},{id:'SE-0010',lotId:'8250',grade:'2/40 ACRYLIC',vendor:'MD Creation',stage:'Soft',inUnits:0,inWeight:0,outUnits:0,outWeight:0,wasteUnits:0,wasteWeight:0,machine:'SF-02',startWorker:'Deepak S',endWorker:'',startTime:ts(2),endTime:'',status:'InProgress',startNote:'Starting second batch',endNote:''},];State.DB.dyeEntries=[{id:'DY-0001',sources:[{lotId:'4340',grade:'2/30 AIRJET',vendor:'Lalani Sulz',weight:2000,sourceType:'rm'},{lotId:'5398',grade:'2/40 ACRYLIC',vendor:'MD Creation',weight:1200,sourceType:'rm'}],totalInWeight:3200,machine:'DY-01',startWorker:'Suresh P',startTime:ts(1300),endTime:ts(1280),status:'Approved',dyeLotId:'DL-0001',approvedBy:'sup1',approvedAt:ts(1278),outWeight:3264,endWorker:'Suresh P',endNotes:'Excellent'},{id:'DY-0002',sources:[{lotId:'4340',grade:'2/30 AIRJET',vendor:'Lalani Sulz',weight:1500,sourceType:'rm'},{deadStockId:'DS-0001',grade:'2/30 AIRJET',weight:300,sourceType:'dead'}],totalInWeight:1800,machine:'DY-02',startWorker:'Amit V',startTime:ts(1100),endTime:ts(1082),status:'Approved',dyeLotId:'DL-0002',approvedBy:'sup1',approvedAt:ts(1080),outWeight:1836,endWorker:'Amit V',endNotes:'Red shade good'},{id:'DY-0003',sources:[{lotId:'6210',grade:'15/1 AIRJET',vendor:'Abhilasha Polyester',weight:1800,sourceType:'rm'},{lotId:'7001',grade:'2/30 PV',vendor:'Govindam Textile',weight:800,sourceType:'rm'}],totalInWeight:2600,machine:'DY-01',startWorker:'Priya M',startTime:ts(900),endTime:ts(882),status:'Approved',dyeLotId:'DL-0003',approvedBy:'sup1',approvedAt:ts(880),outWeight:2652,endWorker:'Priya M',endNotes:'Black deep'},{id:'DY-0004',sources:[{lotId:'7842',grade:'20/2 COTTON',vendor:'Shree Yarn',weight:2176,sourceType:'rm'}],totalInWeight:2176,machine:'DY-02',startWorker:'Deepak S',startTime:ts(650),endTime:ts(635),status:'Approved',dyeLotId:'DL-0004',approvedBy:'sup1',approvedAt:ts(633),outWeight:2220,endWorker:'Deepak S',endNotes:'Green match'},{id:'DY-0005',sources:[{lotId:'8100',grade:'2/30 AIRJET',vendor:'Lalani Sulz',weight:2816,sourceType:'rm'},{recycleId:'RC-0001',dyeLotNo:'DYE-'+fy+'-001',shade:'Navy Blue 300',weight:400,sourceType:'recycle'}],totalInWeight:3216,machine:'DY-01',startWorker:'Ramesh K',startTime:ts(400),endTime:ts(385),status:'Approved',dyeLotId:'DL-0005',approvedBy:'sup1',approvedAt:ts(383),outWeight:3280,endWorker:'Ramesh K',endNotes:'Navy rerun+recycle'},{id:'DY-0006',sources:[{lotId:'5398',grade:'2/40 ACRYLIC',vendor:'MD Creation',weight:1200,sourceType:'rm'}],totalInWeight:1200,machine:'DY-02',startWorker:'Nazar A',startTime:ts(3),endTime:'',status:'InProgress',dyeLotId:null,endWorker:'',endNotes:''},];State.DB.dyeLots=[{id:'DL-0001',dyeLotNo:'DYE-'+fy+'-001',shade:'Navy Blue 300',sources:[{lotId:'4340',grade:'2/30 AIRJET',vendor:'Lalani Sulz',weight:2000},{lotId:'5398',grade:'2/40 ACRYLIC',vendor:'MD Creation',weight:1200}],totalInWeight:3200,outWeight:3264,gain:64,dyeEntryId:'DY-0001',machine:'DY-01',startWorker:'Suresh P',endWorker:'Suresh P',startTime:ts(1300),endTime:ts(1280),status:'Approved',approvedBy:'sup1',approvedAt:ts(1278),notes:'Navy Blue 300',createdAt:ts(1280),splitDone:true,goodWeight:2864,recycleWeight:400,recycleId:'RC-0001'},{id:'DL-0002',dyeLotNo:'DYE-'+fy+'-002',shade:'Red 45',sources:[{lotId:'4340',grade:'2/30 AIRJET',vendor:'Lalani Sulz',weight:1500},{deadStockId:'DS-0001',grade:'2/30 AIRJET',weight:300,sourceType:'dead'}],totalInWeight:1800,outWeight:1836,gain:36,dyeEntryId:'DY-0002',machine:'DY-02',startWorker:'Amit V',endWorker:'Amit V',startTime:ts(1100),endTime:ts(1082),status:'Approved',approvedBy:'sup1',approvedAt:ts(1080),notes:'Red 45',createdAt:ts(1082)},{id:'DL-0003',dyeLotNo:'DYE-'+fy+'-003',shade:'Black 200',sources:[{lotId:'6210',grade:'15/1 AIRJET',vendor:'Abhilasha Polyester',weight:1800},{lotId:'7001',grade:'2/30 PV',vendor:'Govindam Textile',weight:800}],totalInWeight:2600,outWeight:2652,gain:52,dyeEntryId:'DY-0003',machine:'DY-01',startWorker:'Priya M',endWorker:'Priya M',startTime:ts(900),endTime:ts(882),status:'Approved',approvedBy:'sup1',approvedAt:ts(880),notes:'Black 200',createdAt:ts(882)},{id:'DL-0004',dyeLotNo:'DYE-'+fy+'-004',shade:'Green 150',sources:[{lotId:'7842',grade:'20/2 COTTON',vendor:'Shree Yarn',weight:2176}],totalInWeight:2176,outWeight:2220,gain:44,dyeEntryId:'DY-0004',machine:'DY-02',startWorker:'Deepak S',endWorker:'Deepak S',startTime:ts(650),endTime:ts(635),status:'Approved',approvedBy:'sup1',approvedAt:ts(633),notes:'Green 150',createdAt:ts(635)},{id:'DL-0005',dyeLotNo:'DYE-'+fy+'-005',shade:'Navy Blue 300',sources:[{lotId:'8100',grade:'2/30 AIRJET',vendor:'Lalani Sulz',weight:2816},{recycleId:'RC-0001',dyeLotNo:'DYE-'+fy+'-001',shade:'Navy Blue 300',weight:400,sourceType:'recycle'}],totalInWeight:3216,outWeight:3280,gain:64,dyeEntryId:'DY-0005',machine:'DY-01',startWorker:'Ramesh K',endWorker:'Ramesh K',startTime:ts(400),endTime:ts(385),status:'Approved',approvedBy:'sup1',approvedAt:ts(383),notes:'Navy rerun',createdAt:ts(385)},{id:'DL-0006',dyeLotNo:'DYE-'+fy+'-006',shade:'Maroon 88',sources:[{lotId:'6210',grade:'15/1 AIRJET',vendor:'Abhilasha Polyester',weight:1200}],totalInWeight:1200,outWeight:1224,gain:24,dyeEntryId:'',machine:'DY-02',startWorker:'Nazar A',endWorker:'Suresh P',startTime:ts(50),endTime:ts(40),status:'Pending',approvedBy:'',createdAt:ts(40),notes:'Maroon 88'},];State.DB.windEntries=[{id:'WE-0001',dyeLotId:'DL-0001',dyeLotNo:'DYE-'+fy+'-001',shade:'Navy Blue 300',inWeight:1500,outWeight:1485,machine:'WN-01',startWorker:'Priya M',endWorker:'Priya M',startTime:ts(1200),endTime:ts(1188),status:'Approved',approvedBy:'sup1',approvedAt:ts(1186)},{id:'WE-0002',dyeLotId:'DL-0001',dyeLotNo:'DYE-'+fy+'-001',shade:'Navy Blue 300',inWeight:1364,outWeight:1350,machine:'WN-02',startWorker:'Ravi T',endWorker:'Ravi T',startTime:ts(1180),endTime:ts(1168),status:'Approved',approvedBy:'sup1',approvedAt:ts(1166)},{id:'WE-0003',dyeLotId:'DL-0002',dyeLotNo:'DYE-'+fy+'-002',shade:'Red 45',inWeight:1836,outWeight:1818,machine:'WN-02',startWorker:'Amit V',endWorker:'Amit V',startTime:ts(1000),endTime:ts(988),status:'Approved',approvedBy:'sup1',approvedAt:ts(986)},{id:'WE-0004',dyeLotId:'DL-0003',dyeLotNo:'DYE-'+fy+'-003',shade:'Black 200',inWeight:1400,outWeight:1386,machine:'WN-01',startWorker:'Deepak S',endWorker:'Deepak S',startTime:ts(800),endTime:ts(788),status:'Approved',approvedBy:'sup1',approvedAt:ts(786)},{id:'WE-0005',dyeLotId:'DL-0003',dyeLotNo:'DYE-'+fy+'-003',shade:'Black 200',inWeight:1252,outWeight:1240,machine:'WN-02',startWorker:'Ramesh K',endWorker:'Ramesh K',startTime:ts(780),endTime:ts(768),status:'Approved',approvedBy:'sup1',approvedAt:ts(766)},{id:'WE-0006',dyeLotId:'DL-0004',dyeLotNo:'DYE-'+fy+'-004',shade:'Green 150',inWeight:2220,outWeight:2198,machine:'WN-01',startWorker:'Ravi T',endWorker:'Ravi T',startTime:ts(580),endTime:ts(568),status:'Approved',approvedBy:'sup1',approvedAt:ts(566)},{id:'WE-0007',dyeLotId:'DL-0005',dyeLotNo:'DYE-'+fy+'-005',shade:'Navy Blue 300',inWeight:1800,outWeight:0,machine:'WN-02',startWorker:'Nazar A',endWorker:'',startTime:ts(5),endTime:'',status:'InProgress',approvedBy:''},];State.DB.packEntries=[{id:'PE-0001',dyeLotId:'DL-0001',dyeLotNo:'DYE-'+fy+'-001',shade:'Navy Blue 300',bags:55,weight:1320,worker:'Priya M',timestamp:ts(1140),status:'Approved',approvedBy:'sup1',approvedAt:ts(1138),notes:'First run'},{id:'PE-0002',dyeLotId:'DL-0001',dyeLotNo:'DYE-'+fy+'-001',shade:'Navy Blue 300',bags:51,weight:1224,worker:'Ravi T',timestamp:ts(1120),status:'Approved',approvedBy:'sup1',approvedAt:ts(1118),notes:'Second run'},{id:'PE-0003',dyeLotId:'DL-0002',dyeLotNo:'DYE-'+fy+'-002',shade:'Red 45',bags:70,weight:1680,worker:'Amit V',timestamp:ts(960),status:'Approved',approvedBy:'sup1',approvedAt:ts(958),notes:''},{id:'PE-0004',dyeLotId:'DL-0003',dyeLotNo:'DYE-'+fy+'-003',shade:'Black 200',bags:52,weight:1248,worker:'Deepak S',timestamp:ts(750),status:'Approved',approvedBy:'sup1',approvedAt:ts(748),notes:''},{id:'PE-0005',dyeLotId:'DL-0003',dyeLotNo:'DYE-'+fy+'-003',shade:'Black 200',bags:48,weight:1152,worker:'Ramesh K',timestamp:ts(730),status:'Approved',approvedBy:'sup1',approvedAt:ts(728),notes:''},{id:'PE-0006',dyeLotId:'DL-0004',dyeLotNo:'DYE-'+fy+'-004',shade:'Green 150',bags:84,weight:2016,worker:'Ravi T',timestamp:ts(540),status:'Approved',approvedBy:'sup1',approvedAt:ts(538),notes:''},{id:'PE-0007',dyeLotId:'DL-0005',dyeLotNo:'DYE-'+fy+'-005',shade:'Navy Blue 300',bags:40,weight:960,worker:'Nazar A',timestamp:ts(1),status:'Pending',approvedBy:'',notes:'Awaiting approval'},];State.DB.dispatches=[{id:'DSP-0001',dyeLotId:'DL-0001',dyeLotNo:'DYE-'+fy+'-001',shade:'Navy Blue 300',party:'Rajesh Exports',bags:35,weight:840,date:d(25),timestamp:ts(1060),by:'Suresh P',invoiceNo:'INV-2627-001',status:'Approved',approvedBy:'sup1',approvedAt:ts(1058)},{id:'DSP-0002',dyeLotId:'DL-0001',dyeLotNo:'DYE-'+fy+'-001',shade:'Navy Blue 300',party:'Metro Fashion',bags:30,weight:720,date:d(20),timestamp:ts(1000),by:'Amit V',invoiceNo:'INV-2627-002',status:'Approved',approvedBy:'sup1',approvedAt:ts(998)},{id:'DSP-0003',dyeLotId:'DL-0001',dyeLotNo:'DYE-'+fy+'-001',shade:'Navy Blue 300',party:'Rajesh Exports',bags:20,weight:480,date:d(15),timestamp:ts(900),by:'Suresh P',invoiceNo:'INV-2627-003',status:'Approved',approvedBy:'sup1',approvedAt:ts(898)},{id:'DSP-0004',dyeLotId:'DL-0002',dyeLotNo:'DYE-'+fy+'-002',shade:'Red 45',party:'Sunrise Textiles',bags:45,weight:1080,date:d(18),timestamp:ts(900),by:'Priya M',invoiceNo:'INV-2627-004',status:'Approved',approvedBy:'sup1',approvedAt:ts(898)},{id:'DSP-0005',dyeLotId:'DL-0002',dyeLotNo:'DYE-'+fy+'-002',shade:'Red 45',party:'Kumar Fabrics',bags:25,weight:600,date:d(10),timestamp:ts(800),by:'Amit V',invoiceNo:'INV-2627-005',status:'Approved',approvedBy:'sup1',approvedAt:ts(798)},{id:'DSP-0006',dyeLotId:'DL-0003',dyeLotNo:'DYE-'+fy+'-003',shade:'Black 200',party:'Global Threads',bags:60,weight:1440,date:d(12),timestamp:ts(700),by:'Deepak S',invoiceNo:'INV-2627-006',status:'Approved',approvedBy:'sup1',approvedAt:ts(698)},{id:'DSP-0007',dyeLotId:'DL-0004',dyeLotNo:'DYE-'+fy+'-004',shade:'Green 150',party:'Rajesh Exports',bags:50,weight:1200,date:d(8),timestamp:ts(500),by:'Ravi T',invoiceNo:'INV-2627-007',status:'Approved',approvedBy:'sup1',approvedAt:ts(498)},{id:'DSP-0008',dyeLotId:'DL-0004',dyeLotNo:'DYE-'+fy+'-004',shade:'Green 150',party:'Global Threads',bags:34,weight:816,date:d(5),timestamp:ts(400),by:'Ravi T',invoiceNo:'INV-2627-008',status:'Approved',approvedBy:'sup1',approvedAt:ts(398)},{id:'DSP-0009',dyeLotId:'DL-0003',dyeLotNo:'DYE-'+fy+'-003',shade:'Black 200',party:'Kumar Fabrics',bags:40,weight:960,date:d(2),timestamp:ts(10),by:'Ramesh K',invoiceNo:'',status:'Pending',approvedBy:''},];State.DB.deadStock=[{id:'DS-0001',type:'Steel',grade:'2/30 AIRJET',weight:600,note:'Old season remnant — quality checked OK for direct dye',addedBy:'sup1',date:d(45),status:'Approved',approvedBy:'admin',approvedAt:ts(1070),createdAt:ts(1080)},{id:'DS-0002',type:'Plastic',grade:'2/40 ACRYLIC',weight:400,note:'Warehouse stock — needs softening before dye',addedBy:'sup1',date:d(35),status:'Approved',approvedBy:'admin',approvedAt:ts(820),createdAt:ts(840)},{id:'DS-0003',type:'Steel',grade:'15/1 AIRJET',weight:250,note:'Quality sorted — cleared for direct dye',addedBy:'sup1',date:d(15),status:'Approved',approvedBy:'admin',approvedAt:ts(355),createdAt:ts(360)},{id:'DS-0004',type:'Plastic',grade:'2/30 PV',weight:180,note:'Mixed batch from last year — needs verification',addedBy:'sup1',date:d(5),status:'Pending',approvedBy:'',createdAt:ts(120)},];State.DB.recycleStock=[{id:'RC-0001',dyeLotId:'DL-0001',dyeLotNo:'DYE-'+fy+'-001',shade:'Navy Blue 300',sources:[{lotId:'4340',grade:'2/30 AIRJET',vendor:'Lalani Sulz',weight:2000},{lotId:'5398',grade:'2/40 ACRYLIC',vendor:'MD Creation',weight:1200}],weight:400,goodPortion:2864,reason:'Shade came out 2 shades darker than spec — not acceptable for Rajesh Exports order',markedBy:'sup1',markedAt:ts(1270),status:'Approved',approvedBy:'admin',approvedAt:ts(1265),windDone:false,softDone:false,createdAt:ts(1270)},];State.DB.partyOrders=[{id:'ORD-001',party:'Rajesh Exports',shade:'Navy Blue 300',grade:'2/30 AIRJET',qtyOrdered:2000,qtyFulfilled:0,date:d(30),due:d(-15),notes:'Urgent export order',status:'Open',createdBy:'sup1',createdAt:ts(720),cancelledAt:null,cancelReason:null},{id:'ORD-002',party:'Metro Fashion',shade:'Red 45',grade:'',qtyOrdered:1200,qtyFulfilled:0,date:d(25),due:d(-5),notes:'',status:'Open',createdBy:'sup1',createdAt:ts(600),cancelledAt:null,cancelReason:null},{id:'ORD-003',party:'Rajesh Exports',shade:'Black 200',grade:'',qtyOrdered:800,qtyFulfilled:0,date:d(20),due:d(5),notes:'Second order',status:'Open',createdBy:'sup1',createdAt:ts(480),cancelledAt:null,cancelReason:null},{id:'ORD-004',party:'Global Threads',shade:'Green 150',grade:'20/2 COTTON',qtyOrdered:2000,qtyFulfilled:0,date:d(15),due:d(10),notes:'',status:'Open',createdBy:'sup1',createdAt:ts(360),cancelledAt:null,cancelReason:null},{id:'ORD-005',party:'Sunrise Textiles',shade:'Red 45',grade:'',qtyOrdered:500,qtyFulfilled:0,date:d(10),due:d(20),notes:'Trial order',status:'Open',createdBy:'sup1',createdAt:ts(240),cancelledAt:null,cancelReason:null},];State.DB.editLog=[{id:'EL-001',timestamp:ts(1050),entryId:'SE-0001',stage:'soft',field:'Out Weight',oldVal:'2480',newVal:'2496',reasonCat:'Measurement correction',reasonText:'Scale was miscalibrated, re-weighed on calibrated scale',impactNote:'',changedBy:'sup1',type:'edit'},{id:'EL-002',timestamp:ts(900),entryId:'DL-0001',stage:'dye',field:'Split',oldVal:'3264kg full',newVal:'Good:2864kg Off:400kg->RC-0001',reasonCat:'Quality split',reasonText:'Navy Blue came out darker than required for Rajesh Exports order',impactNote:'DL-0001 dispatch limited to 2864kg',changedBy:'sup1',type:'edit'},];State.DB.users=[{id:'USR-001',name:'Admin',username:'admin',password:'admin123',role:'admin',active:true},{id:'USR-002',name:'Supervisor One',username:'sup1',password:'sup123',role:'supervisor',active:true},{id:'USR-003',name:'Ramesh K',username:'ramesh',password:'worker123',role:'worker',stage:'Soft',active:true},{id:'USR-004',name:'Amit V',username:'amit',password:'worker123',role:'worker',stage:'Dye',active:true},{id:'USR-005',name:'Priya M',username:'priya',password:'worker123',role:'worker',stage:'Wind',active:true},];State.DB.dyeBatches=[];State.DB.voidLog=[];State.DB.lotFlags={};State.DB.deleteRequests=[];State.DB.scrapLog=[];State.DB.agingThresholds={yellow:7,red:15};if(State.fbDB&&State.firebaseLoaded){State.fbDB.ref('/tc').set(State.DB).then(function(){showToast('Demo data seeded to Firebase ✓');renderAll();}).catch(function(e){try{localStorage.setItem('tcv2',JSON.stringify(State.DB));}catch(le){}
showToast('Saved locally — '+e.message);renderAll();});}else{try{localStorage.setItem('tcv2',JSON.stringify(State.DB));}catch(le){}
showToast('Demo data seeded locally ✓');renderAll();}}
function adminPasswordAction(action,entryId='',entryType=''){document.getElementById('pwd-input').value='';document.getElementById('pwd-action').value=action;document.getElementById('pwd-entry-id').value=entryId;document.getElementById('pwd-entry-type').value=entryType;document.getElementById('pwd-alert').innerHTML='';const titles={reset:'⚠ Reset All Data'};const descs={reset:'⛔ DANGER: This will permanently erase ALL production data. Type RESET in the confirmation box and enter your password to continue. This CANNOT be undone.'};document.getElementById('pwd-modal-title').textContent=titles[action]||'Admin Confirmation';document.getElementById('pwd-modal-desc').textContent=descs[action]||'Enter admin password to continue.';const _cpRow=document.getElementById('pwd-confirm-row');const _cpField=document.getElementById('pwd-confirm-phrase');if(_cpRow){_cpRow.style.display=action==='reset'?'':'none';}
if(_cpField){_cpField.value='';}
openModal('pwd-modal');}
async function confirmAdminPwd(){const pwd=document.getElementById('pwd-input').value;const action=document.getElementById('pwd-action').value;const entryId=document.getElementById('pwd-entry-id').value;const entryType=document.getElementById('pwd-entry-type').value;let confirmPhrase='';if(action==='reset'){confirmPhrase=(document.getElementById('pwd-confirm-phrase')?.value||'').trim();if(confirmPhrase!=='RESET'){setAlert('pwd-alert','Type RESET in the confirmation box to proceed','alert-err');return;}
closeModal('pwd-modal');await _executePwdAction(action,null,null,pwd,confirmPhrase);return;}
const matched=await _verifyPasswordViaWorker(pwd);
if(!matched){setAlert('pwd-alert','Incorrect password','alert-err');document.getElementById('pwd-input').value='';return;}
closeModal('pwd-modal');_executePwdAction(action,matched,{...matched});}
async function _executePwdAction(action,admin,adminCopy,password,confirmPhrase){if(action==='reset'){const btn=document.querySelector('[onclick*="reset"]');if(btn)btn.textContent='Resetting...';
try{
  const {ok,data,error,networkError}=await apiPost('/api/admin/reset-all',{password,confirmPhrase});
  if(networkError)throw new Error(error);
  if(!ok){if(btn)btn.textContent='↺ Reset All Data';setAlert('pwd-alert',error||'Could not reset','alert-err');return;}
  const cleanDB={lots:[],stageEntries:[],dyeBatches:[],dispatches:[],voidLog:[],lotFlags:{},masters:{vendors:[],mills:[],grades:[],machines:[],workers:[]},parties:[],deleteRequests:[]};
  Object.assign(State.DB,cleanDB);localStorage.setItem('tcv2',JSON.stringify(State.DB));localStorage.setItem('tcv2_backup',JSON.stringify(State.DB));
  console.log('Reset complete — Firebase updated (user accounts unaffected)');logout();
}catch(e){if(btn)btn.textContent='↺ Reset All Data';setAlert('pwd-alert','Network error — not reset: '+e.message,'alert-err');}
}}

async function executeOverride(id,type){
  // Jul 15 2026 — found while reconciling the checker: a real, separate,
  // previously-unaudited override function. Only ever reachable for
  // type='stage', Rejected->Approved (the render condition only shows
  // this button for Rejected stage entries) — the 'dye' branch and the
  // Approved->Rejected direction in the old code were dead, never
  // reachable from any button. Extended the existing /api/override-approve
  // endpoint (built earlier today) to also support 'stage', instead of
  // building a near-duplicate endpoint.
  if(type!=='stage'){showToast('Unsupported override type','err');return;}
  try{
    const {ok,data,error,networkError}=await apiPost('/api/override-approve',{type:'stage',id,changedBy:State.currentUser.name});
  if(networkError)throw new Error(error);
  if(!ok){showToast(error||'Could not override','err');return;}
    renderAll();showToast('Override: Approved ✓ — Live Stock updated');
  }catch(e){showToast('Network error — not saved: '+e.message,'err');}
}


function showMobileMenu(){openModal('mobile-menu-overlay');}
function navFromMenu(id){closeModal('mobile-menu-overlay');nav(id,document.getElementById('ni-'+id));}
function renderWIP(){let softRun=(State.DB.stageEntries||[]).filter(function(e){return e.stage==='Soft'&&e.status==='InProgress';}).length;let dyeRun=(State.DB.dyeLots||[]).filter(function(e){return e.status==='InProgress';}).length;let windRun=(State.DB.windEntries||[]).filter(function(e){return e.status==='InProgress';}).length;let sumBar=document.getElementById('wip-summary-bar');if(sumBar)sumBar.innerHTML=[{label:'Soft Running',val:softRun,c:'var(--cs)',tab:'soft'},{label:'Dye Running',val:dyeRun,c:'var(--cd)',tab:'dye'},{label:'Wind Running',val:windRun,c:'var(--cw)',tab:'wind'},].map(function(s){return'<div onclick="switchWipTab(\''+s.tab+'\')" style="cursor:pointer;padding:8px 14px;background:var(--s2);border-radius:8px;border-left:3px solid '+s.c+'"><div style="font-size:1.1rem;font-weight:800;color:'+s.c+'">'+s.val+'</div><div style="font-size:0.65rem;color:var(--mu)">'+s.label+'</div></div>';}).join('');switchWipTab(State._wipTab||'soft');}
function renderWIPSoft(){let running=(State.DB.stageEntries||[]).filter(function(e){return e.stage==='Soft'&&e.status==='InProgress';});let el=document.getElementById('wip-soft-content');if(!el)return;let isSupAdmin=State.currentUser&&(State.currentUser.role==='admin'||State.currentUser.role==='manager'||State.currentUser.role==='supervisor');if(!running.length){el.innerHTML='<div style="color:var(--mu);font-size:0.8rem;padding:16px;text-align:center">No soft entries currently running</div>';return;}
el.innerHTML='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;">'+running.map(function(e){let elapsed=hrsBetween(e.startTime,new Date().toISOString());let elStr=elapsed<1?(Math.round(elapsed*60)+'m'):(Math.floor(elapsed)+'h '+(Math.round((elapsed%1)*60))+'m');let btns=isSupAdmin?'<button class="btn btn-ghost btn-xs" onclick="openEditEntryModal(\''+e.id+'\',\'soft\')">✏</button><button class="btn btn-ghost btn-xs" style="color:var(--re)" onclick="openVoidEntry(\''+e.id+'\',\'soft\')">🗑</button>':'';return'<div style="background:var(--s2);border-radius:12px;padding:14px;border-top:3px solid var(--cs);">'+'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">'+'<div style="display:flex;align-items:center;gap:8px;">'+'<div class="running-pulse"><div class="running-dot"></div></div>'+'<span style="font-size:0.7rem;font-weight:800;color:var(--cs);text-transform:uppercase;letter-spacing:0.08em">Live</span>'+'</div>'+'<span style="font-size:1rem;font-weight:800;color:var(--tx)">'+elStr+'</span>'+'</div>'+'<div style="font-size:0.72rem;font-weight:700;color:var(--mu);margin-bottom:2px">'+(e.machine||'—')+'</div>'+'<div style="font-size:0.88rem;font-weight:700;color:var(--tx);margin-bottom:2px">Lot '+e.lotId+' · '+(e.grade||'—')+'</div>'+'<div style="font-size:0.72rem;color:var(--mu);margin-bottom:10px">'+(e.vendor||'—')+'</div>'+'<div style="display:flex;justify-content:space-between;align-items:center;">'+'<div>'+'<div style="font-size:0.65rem;color:var(--mu)">IN</div>'+'<div style="font-size:0.82rem;font-weight:700">'+fmt(e.inUnits)+'b / '+fmt(e.inWeight)+'kg</div>'+'</div>'+'<div style="text-align:right">'+'<div style="font-size:0.65rem;color:var(--mu)">WORKER</div>'+'<div style="font-size:0.78rem;font-weight:700">'+(e.startWorker||'—')+'</div>'+'</div>'+'</div>'+
(btns?'<div style="display:flex;justify-content:flex-end;gap:6px;margin-top:10px;border-top:1px solid var(--b1);padding-top:8px;">'+btns+'</div>':'')+'</div>';}).join('')+'</div>';}
function renderWIPDye(){let running=(State.DB.dyeLots||[]).filter(function(e){return e.status==='InProgress';});let el=document.getElementById('wip-dye-content');if(!el)return;let isSupAdmin=State.currentUser&&(State.currentUser.role==='admin'||State.currentUser.role==='manager'||State.currentUser.role==='supervisor');if(!running.length){el.innerHTML='<div style="color:var(--mu);font-size:0.8rem;padding:16px;text-align:center">No dye lots currently running</div>';return;}
el.innerHTML='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;">'+running.map(function(e){let elapsed=hrsBetween(e.startTime,new Date().toISOString());let elStr=elapsed<1?(Math.round(elapsed*60)+'m'):(Math.floor(elapsed)+'h '+(Math.round((elapsed%1)*60))+'m');let srcStr=(e.sources||[]).map(function(s){return s.lotId+'('+fmt(s.weight||0)+'kg)';}).join(' + ');let btns=isSupAdmin?'<button class="btn btn-ghost btn-xs" style="color:var(--re)" onclick="openVoidEntry(\''+e.id+'\',\'dye-entry\')">🗑</button>':'';return'<div style="background:var(--s2);border-radius:12px;padding:14px;border-top:3px solid var(--cd);">'+'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">'+'<div style="display:flex;align-items:center;gap:8px;">'+'<div class="running-pulse"><div class="running-dot" style="background:var(--cd)"></div></div>'+'<span style="font-size:0.7rem;font-weight:800;color:var(--cd);text-transform:uppercase;letter-spacing:0.08em">Dyeing</span>'+'</div>'+'<span style="font-size:1rem;font-weight:800;color:var(--tx)">'+elStr+'</span>'+'</div>'+'<div style="font-size:0.72rem;font-weight:700;color:var(--mu);margin-bottom:2px">'+(e.machine||'—')+'</div>'+'<div style="font-size:0.88rem;font-weight:700;color:var(--tx);margin-bottom:2px">'+(e.totalInCones||'?')+'c / '+fmt(e.totalInWeight||0)+'kg</div>'+'<div style="font-size:0.72rem;color:var(--mu);margin-bottom:10px">'+srcStr+'</div>'+'<div style="display:flex;justify-content:space-between;align-items:center;">'+'<div>'+'<div style="font-size:0.65rem;color:var(--mu)">STARTED</div>'+'<div style="font-size:0.78rem;font-weight:700">'+fmtTS(e.startTime)+'</div>'+'</div>'+'<div style="text-align:right">'+'<div style="font-size:0.65rem;color:var(--mu)">WORKER</div>'+'<div style="font-size:0.78rem;font-weight:700">'+(e.startWorker||'—')+'</div>'+'</div>'+'</div>'+
(btns?'<div style="display:flex;justify-content:flex-end;gap:6px;margin-top:10px;border-top:1px solid var(--b1);padding-top:8px;">'+btns+'</div>':'')+'</div>';}).join('')+'</div>';}
function renderWIPWind(){let running=(State.DB.windEntries||[]).filter(function(e){return e.status==='InProgress';});let el=document.getElementById('wip-wind-content');if(!el)return;let isSupAdmin=State.currentUser&&(State.currentUser.role==='admin'||State.currentUser.role==='manager'||State.currentUser.role==='supervisor');if(!running.length){el.innerHTML='<div style="color:var(--mu);font-size:0.8rem;padding:16px;text-align:center">No wind entries currently running</div>';return;}
el.innerHTML='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;">'+running.map(function(e){let elapsed=hrsBetween(e.startTime,new Date().toISOString());let elStr=elapsed<1?(Math.round(elapsed*60)+'m'):(Math.floor(elapsed)+'h '+(Math.round((elapsed%1)*60))+'m');let btns=isSupAdmin?'<button class="btn btn-ghost btn-xs" onclick="openEditEntryModal(\''+e.id+'\',\'wind\')">✏</button><button class="btn btn-ghost btn-xs" style="color:var(--re)" onclick="openVoidEntry(\''+e.id+'\',\'wind\')">🗑</button>':'';return'<div style="background:var(--s2);border-radius:12px;padding:14px;border-top:3px solid var(--cw);">'+'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">'+'<div style="display:flex;align-items:center;gap:8px;">'+'<div class="running-pulse"><div class="running-dot" style="background:var(--cw)"></div></div>'+'<span style="font-size:0.7rem;font-weight:800;color:var(--cw);text-transform:uppercase;letter-spacing:0.08em">Winding</span>'+'</div>'+'<span style="font-size:1rem;font-weight:800;color:var(--tx)">'+elStr+'</span>'+'</div>'+'<div style="font-size:0.72rem;font-weight:700;color:var(--mu);margin-bottom:2px">'+(e.machine||'—')+'</div>'+'<div style="font-size:0.88rem;font-weight:700;color:var(--ac);margin-bottom:2px">'+(e.dyeLotNo||'—')+'</div>'+'<div style="font-size:0.78rem;color:var(--tx);margin-bottom:2px">'+(e.shade||'—')+' · '+(e.grade||'—')+'</div>'+'<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">'+'<div>'+'<div style="font-size:0.65rem;color:var(--mu)">IN</div>'+'<div style="font-size:0.82rem;font-weight:700">'+(e.inCones||'?')+'c / '+fmt(e.inWeight||0)+'kg</div>'+'</div>'+'<div style="text-align:right">'+'<div style="font-size:0.65rem;color:var(--mu)">WORKER</div>'+'<div style="font-size:0.78rem;font-weight:700">'+(e.startWorker||'—')+'</div>'+'</div>'+'</div>'+
(btns?'<div style="display:flex;justify-content:flex-end;gap:6px;margin-top:10px;border-top:1px solid var(--b1);padding-top:8px;">'+btns+'</div>':'')+'</div>';}).join('')+'</div>';}
function renderWIPPack(){let pending=(State.DB.packEntries||[]).filter(function(e){return e.status==='Pending';});let el=document.getElementById('wip-pack-content');if(!el)return;let isSupAdmin=State.currentUser&&(State.currentUser.role==='admin'||State.currentUser.role==='manager'||State.currentUser.role==='supervisor');el.innerHTML=pending.length?pending.map(function(e){let btns=isSupAdmin?'<button class="btn btn-ghost btn-xs" onclick="openEditEntryModal(\''+e.id+'\',\'pack\')">&#9998;</button><button class="btn btn-ghost btn-xs" style="color:var(--re)" onclick="openVoidEntry(\''+e.id+'\',\'pack\')">&#128465;</button>':'';return'<div style="padding:12px;background:var(--s2);border-radius:8px;margin-bottom:8px;border-left:3px solid var(--cp)"><div style="display:flex;justify-content:space-between;align-items:center"><span class="mono">'+e.id+'</span><div style="display:flex;gap:6px;align-items:center"><span class="badge b-pend">Pending</span>'+btns+'</div></div><div style="font-size:0.72rem;color:var(--mu);margin-top:4px">'+(e.dyeLotNo||'—')+' · '+(e.shade||'—')+' · '+fmt(e.bags)+'b / '+fmt(e.weight)+'kg</div></div>';}).join(''):'<div style="color:var(--mu);font-size:0.8rem;padding:8px">No pending pack entries</div>';}
function renderWIPDispatch(){let pending=(State.DB.dispatches||[]).filter(function(d){return d.status==='Pending';});let el=document.getElementById('wip-dispatch-content');if(!el)return;let isSupAdmin=State.currentUser&&(State.currentUser.role==='admin'||State.currentUser.role==='manager'||State.currentUser.role==='supervisor');el.innerHTML=pending.length?pending.map(function(d){let btns=isSupAdmin?'<button class="btn btn-ghost btn-xs" onclick="openEditEntryModal(\''+d.id+'\',\'dispatch\')">&#9998;</button><button class="btn btn-ghost btn-xs" style="color:var(--re)" onclick="openVoidEntry(\''+d.id+'\',\'dispatch\')">&#128465;</button>':'';return'<div style="padding:12px;background:var(--s2);border-radius:8px;margin-bottom:8px;border-left:3px solid var(--gr)"><div style="display:flex;justify-content:space-between;align-items:center"><span class="mono">'+d.id+'</span><div style="display:flex;gap:6px;align-items:center"><span class="badge b-pend">Pending</span>'+btns+'</div></div><div style="font-size:0.72rem;color:var(--mu);margin-top:4px">'+(d.dyeLotNo||'—')+' · '+(d.shade||'—')+' · '+(d.party||'—')+' · '+fmt(d.bags)+'b / '+fmt(d.weight)+'kg</div></div>';}).join(''):'<div style="color:var(--mu);font-size:0.8rem;padding:8px">No pending dispatches</div>';}

function vtSelectVendor(v){State.vtSelectedVendor=v;State.vtSelectedLot='';_loadCatalog('lots',()=>{renderVendorV2();});}
function vtSelectLot(key){State.vtSelectedLot=key;const[_vlId,_vlGrade,_vlVendor]=key.split('||');_hydrateLot(_vlId,_vlGrade,_vlVendor,()=>{renderVendorV2();});}
function vtLotStatus(lotId){const[_lid,_lg,_lv]=lotId.split('||');if(State.DB.stageEntries.some(e=>e.lotId===_lid&&e.status==='InProgress'))return'Running';const _linkedDL=(State.DB.dyeLots||[]).filter(d=>(d.sources||[]).some(s=>s.lotId===_lid&&s.grade===_lg&&s.vendor===_lv));if(_linkedDL.some(d=>d.status==='InProgress'))return'Running';if((State.DB.windEntries||[]).some(w=>_linkedDL.some(dl=>dl.id===w.dyeLotId)&&w.status==='InProgress'))return'Running';if((State.DB.packEntries||[]).some(p=>_linkedDL.some(dl=>dl.id===p.dyeLotId)&&p.status==='InProgress'))return'Running';const lot=getLotByKey(_lid,_lg,_lv)||getLot(_lid||lotId);const g=lot.grade||_lg||'';const v=lot.vendor||_lv||'';
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

function renderVendorV2(){const _wW=State.DB.masters.workers||[];const _wCur=State.currentUser?.name||'';const wOpts=(State.currentUser?.role==='admin'||State.currentUser?.role==='manager'||State.currentUser?.role==='supervisor')?`<option value="">— Select Worker —</option>${_wW.map(w=>`<option value="${w}"${w===_wCur?' selected':''}>${w}</option>`).join('')}`:`<option value="${_wCur}">${_wCur}</option>`;const allLots=_lotsForDropdown();const vendors=[...new Set(allLots.map(l=>l.vendor))].sort();const selVendor=document.getElementById('vt-sel-vendor');const selLot=document.getElementById('vt-sel-lot');const selStatus=document.getElementById('vt-sel-status');const detail=document.getElementById('vt-detail');if(!selVendor||!selLot||!detail)return;if(!vendors.length){selVendor.innerHTML='<option value="">No vendors yet</option>';detail.innerHTML='<div class="vt-empty"><div class="vt-empty-icon">🏭</div><div class="vt-empty-text">No RM lots yet</div></div>';return;}
const curVendorOpts=selVendor.innerHTML;const newVendorOpts='<option value="">— Select Vendor —</option>'+vendors.map(v=>`<option value="${v}"${v===State.vtSelectedVendor?' selected':''}>${v}</option>`).join('');if(curVendorOpts!==newVendorOpts)selVendor.innerHTML=newVendorOpts;const statusFilter=selStatus?.value||'';if(State.vtSelectedVendor){let vendorLots=allLots.filter(l=>l.vendor===State.vtSelectedVendor);if(statusFilter){vendorLots=vendorLots.filter(l=>{const st=vtLotStatus(l.id+'||'+l.grade+'||'+l.vendor);return st===statusFilter;});}
selLot.disabled=false;const lotOpts='<option value="">— Select Lot —</option>'+vendorLots.map(l=>{const key=l.id+'||'+l.grade+'||'+l.vendor;const st=vtLotStatus(key);return`<option value="${key}"${key===State.vtSelectedLot?' selected':''}>${l.id} · ${l.grade} · ${st}</option>`;}).join('');selLot.innerHTML=lotOpts;}else{selLot.disabled=true;selLot.innerHTML='<option value="">— Select Vendor First —</option>';}
if(State.vtSelectedVendor&&State.vtSelectedLot){const parts=State.vtSelectedLot.split('||');const lot=getLotByKey(parts[0],parts[1],parts[2]);if(lot&&lot.id)renderVtLotDetailV2(lot);else detail.innerHTML='<div class="vt-empty"><div class="vt-empty-icon">🏭</div><div class="vt-empty-text">Lot not found</div></div>';}else{detail.innerHTML='<div class="vt-empty"><div class="vt-empty-icon">🏭</div><div class="vt-empty-text">Select vendor and lot above</div></div>';}}
function renderVtLotDetailV2(l){const detail=document.getElementById('vt-detail');if(!detail)return;const now=new Date();const daysSince=ts=>ts?Math.floor((now-new Date(ts))/86400000):null;const rmBal=getRMBalance(l.id,l.grade,l.vendor);const sIn=getSoftIn(l.id,l.grade,l.vendor);const sOut=getSoftOut(l.id,l.grade,l.vendor);const softWasteKg=Math.max(0,sIn.weight-sOut.weight);const softBal=Qmax0(getSoftBalance(l.id,l.grade,l.vendor));const linkedDyeLots=(State.DB.dyeLots||[]).filter(d=>d.status!=='Voided'&&d.status!=='Void'&&(d.sources||[]).some(s=>s.lotId===l.id&&s.grade===l.grade&&s.vendor===l.vendor));const sentToDyeKg=getSoftConsumedByDye(l.id,l.grade,l.vendor);const totDisp=getDispatched(l.id,l.grade,l.vendor);const daysInFactory=daysSince(l.date);const dyeWasteKg=linkedDyeLots.reduce((a,d)=>a+Math.max(0,(d.totalInWeight||0)-(d.outWeight||0)),0);const windWasteKg=linkedDyeLots.reduce((a,d)=>{return a+(State.DB.windEntries||[]).filter(e=>e.dyeLotId===d.id&&e.status!=='Void'&&e.status!=='Voided'&&e.endTime).reduce((b,e)=>b+Math.max(0,(e.inWeight||0)-(e.outWeight||0)),0);},0);const totalWasteKg=softWasteKg+dyeWasteKg+windWasteKg;const totalInKg=sIn.weight||l.weight;const wasteOverall=totalInKg>0?(totalWasteKg/totalInKg*100).toFixed(1):'0';const status=vtLotStatus(l.id+'||'+l.grade+'||'+l.vendor);const statusC={'Running':'var(--bl)','Dispatched':'var(--gr)','Ready':'var(--ac)','At Dye':'var(--cd)','At Wind':'var(--cw)','At Pack':'var(--cp)'}[status]||'var(--mu)';const shadeGroups={};linkedDyeLots.forEach(d=>{const shade=d.shade||'—';if(!shadeGroups[shade])shadeGroups[shade]=[];shadeGroups[shade].push(d);});const shadeCount=Object.keys(shadeGroups).length;const activeDyeLots=linkedDyeLots.filter(d=>d.status!=='Voided'&&d.status!=='Void');const voidedCount=linkedDyeLots.length-activeDyeLots.length;const heroHTML=`
  <div style="background:var(--s1);border:1px solid var(--b1);border-radius:12px;padding:16px 20px;margin-bottom:12px;"><div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;margin-bottom:12px;"><div><div style="font-size:1.7rem;font-weight:900;color:#fff;letter-spacing:-0.03em;line-height:1">${l.id}</div><div style="font-size:0.7rem;color:var(--mu);margin-top:4px">${l.vendor} · <span style="color:var(--ac);font-weight:700">${l.grade}</span> · ${fmtDate(l.date)}</div><div style="margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><span style="font-size:0.68rem;font-weight:800;padding:3px 10px;border-radius:5px;background:${statusC}18;color:${statusC}">${status}</span>
          ${rmBal.units>0?`<span style="font-size:0.65rem;color:var(--mu)">RM left:<strong style="color:var(--tx)">${rmBal.units}u</strong></span>`:''}
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
function vtToggleVoided(key){State._vtShowVoided[key]=!(State._vtShowVoided[key]||false);renderVendorV2();}
function clearStockFilter(){const f=document.getElementById('stock-from');const t=document.getElementById('stock-to');if(f)f.value='';if(t)t.value='';renderStock();}
function renderStock(){renderRMStock();renderDyeStock();switchStockTab(State._stockTab||'rm');}

function toggleSourceRows(btn,rowId){const rows=document.querySelectorAll('.src-sub-'+rowId);const exp=btn.getAttribute('data-exp')==='1';rows.forEach(r=>r.style.display=exp?'none':'');btn.textContent=exp?'▼':'▲';btn.setAttribute('data-exp',exp?'0':'1');}
// Jul 22 2026 — the Dye/Wind/Pack filter bars get fully rebuilt (innerHTML
// replaced) on every keystroke, which silently destroys and recreates the
// input you're typing into. The value gets restored after, but focus
// doesn't — so every character requires clicking back into the box first.
// These two helpers capture focus + cursor position immediately before a
// rebuild, and restore both immediately after — used by renderDyeTable,
// renderWindTable, and renderPackTable, all of which share this exact
// structure.
function _captureFilterFocus(idPrefix) {
  const el = document.activeElement;
  if (!el || !el.id || !el.id.startsWith(idPrefix)) return null;
  return { id: el.id, selStart: el.selectionStart, selEnd: el.selectionEnd };
}
function _restoreFilterFocus(captured) {
  if (!captured) return;
  const el = document.getElementById(captured.id);
  if (!el) return;
  el.focus();
  if (typeof captured.selStart === 'number' && el.setSelectionRange) {
    try { el.setSelectionRange(captured.selStart, captured.selEnd); } catch (e) {}
  }
}

function renderDyeTable(){const _focusCap=_captureFilterFocus('dyef-');const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';const isSup=State.currentUser?.role==='supervisor'||isAdmin;const fln=document.getElementById('dyef-lotno')?.value||'';const fsl=document.getElementById('dyef-srclot')?.value||'';const fsv_dye=document.getElementById('dyef-srcvendor')?.value||'';const fgd=document.getElementById('dyef-grade-col')?.value||'';const fg=document.getElementById('dyef-grade')?.value||'';const fs=document.getElementById('dyef-status')?.value||'';const allLots=State.DB.dyeLots||[];const dyeLotNos=[...new Set(allLots.filter(d=>(!fsl||(d.sources||[]).some(s=>s.lotId===fsl))&&(!fg||d.shade===fg)&&(!fs||d.status===fs)).map(d=>d.dyeLotNo).filter(Boolean))].sort(sortDyeLotNo);const srcLots=[...new Set(allLots.filter(d=>(!fln||(d.dyeLotNo||'').includes(fln))&&(!fg||d.shade===fg)&&(!fs||d.status===fs)).flatMap(d=>(d.sources||[]).map(s=>s.lotId)).filter(Boolean))].sort();const srcVendors=[...new Set(allLots.filter(d=>(!fln||(d.dyeLotNo||'').includes(fln))&&(!fg||d.shade===fg)&&(!fs||d.status===fs)).flatMap(d=>(d.sources||[]).map(s=>s.vendor)).filter(Boolean))].sort();const grades_d=[...new Set(allLots.filter(d=>(!fln||(d.dyeLotNo||'').includes(fln))&&(!fsl||(d.sources||[]).some(s=>s.lotId===fsl))&&(!fs||d.status===fs)).flatMap(d=>(d.sources||[]).map(s=>s.grade)).filter(Boolean))].sort();const shades=[...new Set(allLots.filter(d=>(!fln||(d.dyeLotNo||'').includes(fln))&&(!fsl||(d.sources||[]).some(s=>s.lotId===fsl))&&(!fs||d.status===fs)).map(d=>d.shade).filter(Boolean))].sort();const statuses=[...new Set(allLots.filter(d=>(!fln||(d.dyeLotNo||'').includes(fln))&&(!fsl||(d.sources||[]).some(s=>s.lotId===fsl))&&(!fg||d.shade===fg)).map(d=>d.status).filter(Boolean))].sort();let lots=allLots.filter(d=>(!fln||(d.dyeLotNo||'').includes(fln))&&(!fsl||(d.sources||[]).some(s=>s.lotId===fsl))&&(!fsv_dye||(d.sources||[]).some(s=>s.vendor===fsv_dye))&&(!fgd||(d.sources||[]).some(s=>s.grade===fgd))&&(!fg||(d.shade||'')===fg)&&(!fs||d.status===fs)).sort((a,b)=>(b.startTime||'').localeCompare(a.startTime||''));const dye_thead=document.getElementById('dye-thead');if(dye_thead){dye_thead.innerHTML=`
      <tr class="tbl-filter-row"><th>${buildDyeLotSearch('dyef-lotno','dyef-lotno-xbtn','dyef')}</th><th>${buildColFilter(shades,'dyef-grade','Shade')}</th><th>${buildColFilter(srcLots,'dyef-srclot','RM Lot')}</th><th>${buildColFilter(srcVendors,'dyef-srcvendor','Vendor')}</th><th>${buildColFilter(grades_d,'dyef-grade-col','Grade')}</th><th></th><th></th><th></th><th></th><th></th><th></th><th></th><th></th><th></th><th>${buildColFilter(statuses,'dyef-status','Status')}</th><th></th><th></th></tr><tr>
        ${sortTh('dye','dyeLotNo','Dye Lot')}
        ${sortTh('dye','shade','Shade')}<th>RM Lot</th><th>Vendor</th>
        <th>Grade</th>
        <th>In (c/kg)</th><th>Out (c/kg)</th><th>Waste (c/kg)</th><th>Waste%</th><th>Days</th>
        ${sortTh('dye','machine','Machine')}
        ${sortTh('dye','startWorker','Worker')}
        ${sortTh('dye','startTime','Start')}
        ${sortTh('dye','endTime','End')}
        ${sortTh('dye','status','Status')}
        <th style="font-size:0.65rem;color:var(--mu);letter-spacing:0.08em">SPLIT</th><th>Actions</th></tr>`;if(fln)document.getElementById('dyef-lotno').value=fln;if(fgd)document.getElementById('dyef-grade-col').value=fgd;if(fg)document.getElementById('dyef-grade').value=fg;if(fsl)document.getElementById('dyef-srclot').value=fsl;if(fsv_dye)document.getElementById('dyef-srcvendor').value=fsv_dye;if(fs)document.getElementById('dyef-status').value=fs;_restoreFilterBtns('dyef-lotno','dyef-grade-col','dyef-grade','dyef-srclot','dyef-srcvendor','dyef-status');_restoreFilterFocus(_focusCap);}const fln2=document.getElementById('dyef-lotno')?.value||'';const fsl2=document.getElementById('dyef-srclot')?.value||'';const fsv_dye2=document.getElementById('dyef-srcvendor')?.value||'';const fgd2=document.getElementById('dyef-grade-col')?.value||'';const fg2=document.getElementById('dyef-grade')?.value||'';const fs2=document.getElementById('dyef-status')?.value||'';lots=allLots.filter(d=>(!fln2||(d.dyeLotNo||'').includes(fln2))&&(!fsl2||(d.sources||[]).some(s=>s.lotId===fsl2))&&(!fsv_dye2||(d.sources||[]).some(s=>s.vendor===fsv_dye2))&&(!fgd2||(d.sources||[]).some(s=>s.grade===fgd2))&&(!fg2||(d.shade||'')===fg2)&&(!fs2||d.status===fs2)).sort((a,b)=>(b.startTime||'').localeCompare(a.startTime||''));
const tbody=document.getElementById('dye-tbody');if(!tbody)return;const sorted=_sortState.dye?.col?sortArr(lots,_sortState.dye.col,_sortState.dye.dir):lots;if(!sorted.length){tbody.innerHTML='<tr><td colspan="10"><div class="empty"><div class="empty-icon">&#x1F3A8;</div><div class="empty-text">✕ No dye lots match filters — try clearing</div></div></td></tr>';return;}
tbody.innerHTML=sorted.map(d=>{const stage=getDyeLotCurrentStage(d.id);const stC={'At Dye':'var(--cd)','At Wind':'var(--cw)','At Pack':'var(--cp)','Completed':'var(--gr)'}[stage]||'var(--mu)';const sC={Pending:'var(--ye)',Approved:'var(--gr)',Rejected:'var(--re)',Voided:'var(--re)',Void:'var(--re)'}[d.status]||'var(--mu)';const src_total_bags=(d.sources||[]).reduce((a,s)=>a+(s.units||0),0);const _srcs=d.sources||[];const _s0=_srcs[0]||{};const _lot0=_s0.recycleId?'♻'+(_s0.dyeLotNo||_s0.recycleId||'RC'):_s0.deadStockId?'DS'+(_s0.lotId||'—'):(_s0.lotId||'—');const _vendor0=_s0.recycleId?'Recycle':_s0.deadStockId?'Dead Stock':(_s0.vendor||'—');const _grade0=_s0.grade||'—';const _multi=_srcs.length>1;const _rowId='dr-'+d.id;const srcLotTd=_lot0+(_multi?' <span onclick="toggleSourceRows(this,\''+_rowId+'\')" data-exp="0" style="border:1px solid rgba(240,165,0,0.3);border-radius:10px;padding:2px 8px;font-size:0.65rem;font-weight:700;display:inline-flex;align-items:center;gap:4px;cursor:pointer;color:var(--ac)">📦 '+(_srcs.length-1)+' more ▼</span>':'');const srcVendorTd=_vendor0;const gl=d.outWeight&&d.totalInWeight?(d.outWeight>d.totalInWeight?'<span style="color:var(--gr);font-size:0.65rem">&#x25b2;'+fmt(d.outWeight-d.totalInWeight)+'kg</span>':'<span style="color:var(--ye);font-size:0.65rem">&#x25bc;'+fmt(d.totalInWeight-d.outWeight)+'kg</span>'):'';const _dyeSplitBtn=(d.status==='Approved'||d.status==='Edited-Approved')&&!d.splitDone&&isAdmin?'<button class="btn btn-ghost btn-xs" style="font-size:0.62rem;color:var(--pu);padding:3px 8px" onclick="openDyeSplitModal(\''+d.id+'\')\">Split</button>':'<span style="color:var(--mu);font-size:0.65rem">—</span>';let act='';if(d.status==='Pending'&&isSup)act+='<button class="btn btn-success btn-xs tc-tip" data-tip="Approve" onclick="approveDyeLot(\''+d.id+'\')">&#x2713;</button> <button class="btn btn-ghost btn-xs tc-tip" data-tip="Reject" onclick="rejectDyeLot(\''+d.id+'\')">&#x2717;</button> ';if(d.status==='Rejected'&&isAdmin)act+='<button class="btn btn-ghost btn-xs tc-tip" data-tip="Override" onclick="openOverride(\''+d.id+'\',\'dye\')" >⚡</button>';if(isSup||isAdmin)act+='<button class="btn btn-ghost btn-xs tc-tip" data-tip="Edit" onclick="openEditEntryModal(\''+d.id+'\',\'dye\')">✏</button>';if(isSup||isAdmin)act+='<button class="btn btn-ghost btn-xs tc-tip" data-tip="Void" style="color:var(--re)" onclick="openVoidEntry(\''+d.id+'\',\'dye\')">🗑</button>';const _coneLossWarn=d.coneLoss>0?'<div style="font-size:0.6rem;color:var(--re)">△ '+d.coneLoss+' cones lost</span>':'';const _dRowCls=entryRowClass(d.status);const _dyeWasteC=d.coneLoss||Math.max(0,(d.totalInCones||0)-(d.outCones||0));const _dyeWasteKg=d.kgLoss||Math.max(0,(d.totalInWeight||0)-(d.outWeight||0));const _dyeWastePct=d.totalInWeight>0?pct(_dyeWasteKg,d.totalInWeight):'—';const _dyeDays=d.startTime?Math.floor((new Date()-new Date(d.startTime))/86400000):null;const _dyeGrade=_grade0||'—';
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
<td style="vertical-align:top;white-space:nowrap">${_dyeSplitBtn}</td><td style="vertical-align:top;white-space:nowrap;display:flex;gap:3px;">${act}</td></tr>`+(_multi?_srcs.slice(1).map((s,si)=>{const _sl=s.recycleId?'♻'+(s.dyeLotNo||s.recycleId||'RC'):s.deadStockId?'DS'+(s.lotId||'—'):(s.lotId||'—');const _sv=s.recycleId?'Recycle':s.deadStockId?'Dead Stock':(s.vendor||'—');const _sg=s.grade||'—';return'<tr class="src-sub-'+_rowId+'" style="display:none;background:rgba(240,165,0,0.04)">'+'<td></td><td></td>'+'<td style="padding-left:24px;color:var(--mu);font-size:0.72rem">↳ '+_sl+'</td>'+'<td style="color:var(--mu);font-size:0.72rem">'+_sv+'</td>'+'<td style="color:var(--mu);font-size:0.72rem">'+_sg+'</td>'+'<td colspan="11"></td></tr>';}).join(''):'')}).join('');renderBevDyeReady();renderBevDyePending();setTimeout(fitBevTableHeight,0);}


function onAdsVendorChange(rowId){const div=document.getElementById(rowId);const vendor=div.querySelector('select').value;const gradeEl=document.getElementById(rowId+'-grade');const lotEl=document.getElementById(rowId+'-lot');gradeEl.innerHTML='<option value="">Select grade...</option>';lotEl.innerHTML='<option value="">Select lot...</option>';gradeEl.disabled=true;lotEl.disabled=true;if(!vendor)return;const grades=[...new Set(State.DB.lots.filter(l=>l.vendor===vendor&&getSoftBalance(l.id,l.grade,l.vendor).units>0).map(l=>l.grade))].sort();gradeEl.innerHTML='<option value="">Select grade...</option>'+grades.map(g=>`<option value="${g}">${g}</option>`).join('');gradeEl.disabled=false;}
function onAdsGradeChange(rowId){const div=document.getElementById(rowId);const vendor=div.querySelector('select').value;const grade=document.getElementById(rowId+'-grade').value;const lotEl=document.getElementById(rowId+'-lot');lotEl.innerHTML='<option value="">Select lot...</option>';lotEl.disabled=true;if(!vendor||!grade)return;const lots=State.DB.lots.filter(l=>l.vendor===vendor&&l.grade===grade&&getSoftBalance(l.id,l.grade,l.vendor).units>0);lotEl.innerHTML='<option value="">Select lot...</option>'+lots.map(l=>{const bal=getSoftBalance(l.id,l.grade,l.vendor);return`<option value="${l.id}||${l.grade}||${l.vendor}">${l.id} (${fmt(bal.units)}u / ${fmt(bal.weight)}kg avail)</option>`;}).join('');lotEl.disabled=false;}
function updateLotAvailHint(sel){const rawV=sel.value;if(!rawV)return;const parts=rawV.split('||');const lotId=parts[0];const grade=parts[1]||'';const vendor=parts[2]||'';const _ulaL=getLotByKey(lotId,grade,vendor)||getLot(lotId);const bal=getSoftBalance(lotId,_ulaL.grade,_ulaL.vendor);const row=sel.closest('div[id^="ads-"]');if(row){const unitInput=row.querySelector('input[data-field="units"]');const wtInput=row.querySelector('input[data-field="weight"]');const coneInput=row.querySelector('input[data-field="cones"]');if(unitInput&&!unitInput.value)unitInput.placeholder=`max ${fmt(bal.units)}u`;if(wtInput&&!wtInput.value)wtInput.placeholder=`max ${fmt(bal.weight)}kg`;}}
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();State.deferredPrompt=e;});
window.addEventListener('appinstalled',()=>{State.deferredPrompt=null;const banner=document.getElementById('install-banner-removed');if(banner)banner.classList.remove('show');console.log('PWA installed successfully');});
function installPWA(){alert('To install:\niPhone: Tap Share → Add to Home Screen\nAndroid: Tap 3-dot menu → Install app');}
function dismissInstall(){}
window.addEventListener('online',updateOnlineStatus);
window.addEventListener('offline',updateOnlineStatus);
document.addEventListener('touchstart',e=>{State.touchStartY=e.touches[0].clientY;},{passive:true});
document.addEventListener('touchend',e=>{const diff=e.changedTouches[0].clientY-State.touchStartY;if(diff>80){const openOverlay=document.querySelector('.overlay.open');if(openOverlay)closeModal(openOverlay.id);}},{passive:true});
function openMobDrawer(){document.getElementById('mob-drawer')?.classList.add('open');document.getElementById('mob-drawer-overlay')?.classList.add('open');if(State.currentUser){const av=document.getElementById('mob-drawer-av');const nm=document.getElementById('mob-drawer-name');const rl=document.getElementById('mob-drawer-role');if(av)av.textContent=State.currentUser.name?.[0]?.toUpperCase()||'A';if(nm)nm.textContent=State.currentUser.name||'Admin';if(rl)rl.textContent=State.currentUser.role==='manager'?'Manager':State.currentUser.role==='supervisor'?'Supervisor':'Worker';}
const setupSec=document.getElementById('mob-setup-sec');if(setupSec)setupSec.style.display=(State.currentUser?.role==='manager')?'':'none';const isWorker=State.currentUser?.role==='worker';document.querySelectorAll('.mob-drawer-item').forEach(el=>{const onclick=el.getAttribute('onclick')||'';if(isWorker&&(onclick.includes("'rm'")||onclick.includes("'masters'")||onclick.includes("'users'")||onclick.includes("'analytics'")||onclick.includes("'reports'"))){el.style.display='none';}else{el.style.display='';}});const activePage=document.querySelector('.page.active');if(activePage){const activeId=activePage.id.replace('page-','');document.querySelectorAll('.mob-drawer-item').forEach(el=>{const onclick=el.getAttribute('onclick')||'';el.classList.toggle('active',onclick.includes("'"+activeId+"'"));});}}
function closeMobDrawer(){document.getElementById('mob-drawer')?.classList.remove('open');document.getElementById('mob-drawer-overlay')?.classList.remove('open');}
function mobNav(id){closeMobDrawer();nav(id,document.getElementById('ni-'+id));const titles={dashboard:'Dashboard',rm:'RM Entry',stage:'Stage Entry',dye:'Dye Lots',wind:'Wind',pack:'Pack',dispatch:'Dispatch',wip:'WIP',approval:'Approval',stock:'Live Stock',lifecycle:'Lot Lifecycle',dyelifecycle:'Dye Lifecycle',vendor:'Vendor Tracker',partytracker:'Party Tracker',deadstock:'Dead Stock',recycle:'Recycle Stock',analytics:'Analytics',reports:'Reports',masters:'Masters',users:'Users'};const titleEl=document.getElementById('mob-page-title');if(titleEl)titleEl.textContent=titles[id]||id;document.querySelectorAll('.mob-drawer-item').forEach(el=>el.classList.remove('active'));}
updateOnlineStatus();
function openFlagModal(lotId){const canFlag=State.currentUser?.role==='manager'||State.currentUser?.role==='supervisor';if(!canFlag){alert('Only supervisors and admins can add flags');return;}
document.getElementById('flag-lot-id').value=lotId;document.getElementById('flag-modal-title').textContent='🏷 Flag — '+lotId;const existing=(State.DB.lotFlags||{})[lotId];document.getElementById('flag-type').value=existing?.type||'';document.getElementById('flag-note').value=existing?.note||'';document.getElementById('flag-alert').innerHTML='';openModal('flag-modal');}
async function saveFlag(){const lotId=document.getElementById('flag-lot-id').value;const type=document.getElementById('flag-type').value;const note=document.getElementById('flag-note').value.trim();if(type&&!note){setAlert('flag-alert','Please add a note for the flag','alert-err');return;}
try{const {ok,error,networkError}=await apiPost('/api/lot/flag',{lotId,type,note,changedBy:State.currentUser?.name,role:State.currentUser?.role});if(networkError)throw new Error(error);if(!ok){setAlert('flag-alert',error||'Could not save flag','alert-err');return;}closeModal('flag-modal');renderAll();}catch(e){setAlert('flag-alert','Network error — '+e.message,'alert-err');}}
function flagPill(lotId){const f=(State.DB.lotFlags||{})[lotId];if(!f)return`<button class="btn bg bxs" onclick="openFlagModal('${lotId}')">＋ Flag</button>`;const fc=FLAG_COLORS[f.type]||FLAG_COLORS.info;const canFlag=State.currentUser?.role==='manager'||State.currentUser?.role==='supervisor';return`<span title="${f.note} (${f.by})" onclick="${canFlag?`openFlagModal('${lotId}')`:''}"
    style="cursor:${canFlag?'pointer':'default'};display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:4px;
    font-size:0.65rem;font-weight:700;background:${fc.bg};color:${fc.color};border:1px solid ${fc.border}">
    ${fc.emoji} ${fc.label}
  </span>`;}
function lotProgressBar(lotId,grade,vendor){const l=(grade&&vendor)?getLotByKey(lotId,grade,vendor):getLot(lotId);if(!grade)grade=l.grade||'';if(!vendor)vendor=l.vendor||'';const stages=[{name:'RM',done:l.units>0},{name:'Soft',done:getSoftOut(lotId,grade,vendor).units>0,color:'var(--cs)'},{name:'Dye',done:getDyeAllocated(lotId,grade,vendor).units>0,color:'var(--cd)'},{name:'Wind',done:getWindOut(lotId,grade,vendor).units>0,color:'var(--cw)'},{name:'Pack',done:getPackOut(lotId,grade,vendor).units>0,color:'var(--cp)'},{name:'Done',done:getDispatched(lotId,grade,vendor).units>=l.units*0.95,color:'var(--gr)'},];const completedIdx=stages.map((s,i)=>s.done?i:-1).filter(i=>i>=0);const last=completedIdx.length?Math.max(...completedIdx):-1;const dots=stages.map((s,i)=>{const c=i===0?'var(--cr)':s.color||'var(--mu)';const done=i<=last;return`<div title="${s.name}" style="width:10px;height:10px;border-radius:50%;background:${done?c:'var(--b2)'};
      border:1px solid ${done?c:'var(--b3)'};flex-shrink:0;"></div>`;}).join('<div style="flex:1;height:2px;background:var(--b2);margin:0 1px;align-self:center;"></div>');const pct=last<0?0:Math.round((last+1)/stages.length*100);return`<div style="display:flex;align-items:center;gap:1px;min-width:90px;" title="${pct}% complete">${dots}</div>`;}

function buildDyeLotSearch(inputId, xbtnId, prefix){
  return `<span style="display:inline-flex;align-items:center;gap:3px;white-space:nowrap">
    <input class="col-filter" id="${inputId}" placeholder="Search lot..."
      oninput="_tableFilters['${inputId}']=this.value;document.getElementById('${xbtnId}').style.display=this.value?'':'none';applyTableFilter('${inputId}')"
      style="width:90px;padding:2px 6px;font-size:0.75rem;border:1px solid var(--b2);border-radius:4px;background:var(--s2);color:var(--tx)">
    <button id="${xbtnId}" onclick="document.getElementById('${inputId}').value='';_tableFilters['${inputId}']='';document.getElementById('${xbtnId}').style.display='none';applyTableFilter('${inputId}')"
      style="display:none;padding:0 4px;height:18px;font-size:0.6rem;border:1px solid var(--re);color:var(--re);background:transparent;border-radius:3px;cursor:pointer;line-height:1;flex-shrink:0">✕</button>
  </span>`;
}

function buildColFilter(vals,id,placeholder){const unique=[...new Set(vals.filter(Boolean))];return`<span style="display:inline-flex;align-items:center;gap:3px;white-space:nowrap"><select class="col-filter" id="${id}" onchange="applyTableFilter('${id}');_showFilterClearBtn('${id}')"><option value="">All</option>
      ${unique.map(v=>`<option value="${v}">${v}</option>`).join('')}
    </select><button id="${id}-xbtn" onclick="clearSingleFilter('${id}')" style="display:none;padding:0 4px;height:18px;font-size:0.6rem;border:1px solid var(--re);color:var(--re);background:transparent;border-radius:3px;cursor:pointer;line-height:1;flex-shrink:0">✕</button></span>`;}
function _showFilterClearBtn(id){const sel=document.getElementById(id);const btn=document.getElementById(id+'-xbtn');if(!btn)return;btn.style.display=sel?.value?'inline-block':'none';}
function _restoreFilterBtns(...ids){ids.forEach(id=>_showFilterClearBtn(id));}
function clearSingleFilter(id){const el=document.getElementById(id);if(el)el.value='';_tableFilters[id]='';const btn=document.getElementById(id+'-xbtn');if(btn)btn.style.display='none';const prefix=_getFilterPrefix(id);if(id.startsWith('sef-')){clearTimeout(State._csf_t);State._csf_t=setTimeout(renderStageTable,0);}
else if(id.startsWith('dyef-')){clearTimeout(State._csf_t);State._csf_t=setTimeout(renderDyeTable,0);}
else if(id.startsWith('dispf-')){clearTimeout(State._csf_t);State._csf_t=setTimeout(renderDispatch,0);}
else if(id.startsWith('windf-')){clearTimeout(State._csf_t);State._csf_t=setTimeout(renderWindTable,0);}
else if(id.startsWith('packf-')){clearTimeout(State._csf_t);State._csf_t=setTimeout(renderPackTable,0);}
else if(id.startsWith('st-dsf-')){clearTimeout(State._csf_t);State._csf_t=setTimeout(renderDyeStock,0);}
else if(id.startsWith('dsf-')){clearTimeout(State._csf_t);State._csf_t=setTimeout(renderDeadStock,0);}
else if(id.startsWith('elf-')){clearTimeout(State._csf_t);State._csf_t=setTimeout(renderEditLog,0);}
else if(id.startsWith('rcf-')){clearTimeout(State._csf_t);State._csf_t=setTimeout(renderRecycleStock,0);}
else if(id.startsWith('st-rmf-')){clearTimeout(State._csf_t);State._csf_t=setTimeout(renderRMStock,0);}
else{clearTimeout(State._csf_t);State._csf_t=setTimeout(renderRMTable,0);}}
function _getFilterPrefix(filterId){const keys=['st-dsf-','st-rmf-','sef-','dyef-','dispf-','windf-','packf-','dsf-','elf-','rcf-','rmf-'];return keys.find(k=>filterId.startsWith(k))||'';}
function _updateAllClearBtns(){Object.keys(_filterTableMap).forEach(prefix=>_updateClearBtn(prefix));}
function _updateClearBtn(prefix){const map=_filterTableMap[prefix];if(!map)return;const btn=document.getElementById(map.btnId);if(!btn)return;const anyActive=map.ids.some(id=>{const el=document.getElementById(id);return el&&el.value&&el.value!=='';});btn.style.display=anyActive?'inline-flex':'none';}


function applyTableFilter(filterId){const val=document.getElementById(filterId)?.value||'';_tableFilters[filterId]=val;const prefix=_getFilterPrefix(filterId);if(filterId.startsWith('sef-'))renderStageTable();else if(filterId.startsWith('dyef-'))renderDyeTable();else if(filterId.startsWith('dispf-'))renderDispatch();else if(filterId.startsWith('windf-'))renderWindTable();else if(filterId.startsWith('packf-'))renderPackTable();else if(filterId.startsWith('st-dsf-'))renderDyeStock();else if(filterId.startsWith('dsf-'))renderDeadStock();else if(filterId.startsWith('elf-'))renderEditLog();else if(filterId.startsWith('rcf-'))renderRecycleStock();else if(filterId.startsWith('st-rmf-'))renderRMStock();else renderRMTable();setTimeout(()=>_updateClearBtn(prefix),0);}
function clearDispFilters(){['dispf-lot','dispf-party','dispf-shade','dispf-grade','dispf-invoice','dispf-status'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';_tableFilters[id]='';});renderDispatch();setTimeout(()=>_updateClearBtn('dispf-'),0);}
function clearRMStockFilters(){['st-rmf-l','st-rmf-v','st-rmf-g','st-rmf-s'].forEach(function(id){let el=document.getElementById(id);if(el)el.value='';_tableFilters[id]='';});renderRMStock();setTimeout(()=>_updateClearBtn('st-rmf-'),0);}
function clearDeadStockFilters(){['dsf-type','dsf-grade','dsf-status'].forEach(function(id){let el=document.getElementById(id);if(el)el.value='';_tableFilters[id]='';});renderDeadStock();setTimeout(()=>_updateClearBtn('dsf-'),0);}
function clearDyeFilters(){['dyef-lotno','dyef-srclot','dyef-srcvendor','dyef-grade-col','dyef-grade','dyef-status'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';_tableFilters[id]='';});renderDyeTable();setTimeout(()=>_updateClearBtn('dyef-'),0);}
function clearSEFilters(){['sef-lot','sef-vendor','sef-grade','sef-status'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';_tableFilters[id]='';});renderStageTable();setTimeout(()=>_updateClearBtn('sef-'),0);}
function clearStockFilters(){['stf-lot','stf-grade','stf-vendor','stf-stage'].forEach(id=>{const el=document.getElementById(id);if(el){el.value='';_tableFilters[id]='';}});applyAllTableFilters();}
function clearRMFilters(){['rmf-lot','rmf-vendor','rmf-grade'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';_tableFilters[id]='';});renderRMTable();setTimeout(()=>_updateClearBtn('rmf-'),0);}
function clearDyeStockFilters(){['st-dsf-l','st-dsf-shade','st-dsf-sl','st-dsf-sv','st-dsf-status'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';_tableFilters[id]='';});renderDyeStock();setTimeout(()=>_updateClearBtn('st-dsf-'),0);}
function clearEditLogFilters(){['elf-stage','elf-type','elf-by'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';_tableFilters[id]='';});renderEditLog();setTimeout(()=>_updateClearBtn('elf-'),0);}
function clearPackFilters(){['packf-lot','packf-grade','packf-shade','packf-status'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';_tableFilters[id]='';});renderPackTable();setTimeout(()=>_updateClearBtn('packf-'),0);}
function clearWindFilters(){['windf-lot','windf-grade','windf-shade','windf-status'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';_tableFilters[id]='';});renderWindTable();setTimeout(()=>_updateClearBtn('windf-'),0);}
function clearRecycleFilters(){['rcf-rcno','rcf-lot','rcf-shade','rcf-grade','rcf-status'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';_tableFilters[id]='';});renderRecycleStock();setTimeout(()=>_updateClearBtn('rcf-'),0);}
function applyAllTableFilters(){const rmRows=document.querySelectorAll('#rm-tbody tr[id^="rm-row-"]');rmRows.forEach(tr=>{const lotTxt=tr.children[0]?.textContent?.trim()||'';const vendor=tr.children[1]?.textContent?.trim()||'';const grade=tr.querySelector('.badge')?.textContent?.trim()||'';const matchLot=!_tableFilters['rmf-lot']||lotTxt.includes(_tableFilters['rmf-lot']);const matchVendor=!_tableFilters['rmf-vendor']||vendor===_tableFilters['rmf-vendor'];const matchGrade=!_tableFilters['rmf-grade']||grade===_tableFilters['rmf-grade'];const hide=!(matchLot&&matchVendor&&matchGrade);tr.style.display=hide?'none':'';const domKey=tr.id.replace('rm-row-','');const delivRow=document.getElementById('rm-deliv-'+domKey);const addRow=document.getElementById('rm-deliv-add-'+domKey);if(delivRow&&hide)delivRow.style.display='none';if(addRow&&hide)addRow.style.display='none';});const stRows=document.querySelectorAll('#stock-tbody tr');stRows.forEach(tr=>{const lot=tr.children[0]?.textContent?.trim()||'';const grade=tr.querySelector('.badge')?.textContent?.trim()||'';const vendor=tr.children[2]?.textContent?.trim()||'';const stageText=tr.children[18]?.textContent?.trim()||'';const matchLot=!_tableFilters['stf-lot']||lot.includes(_tableFilters['stf-lot']);const matchGrade=!_tableFilters['stf-grade']||grade===_tableFilters['stf-grade'];const matchVendor=!_tableFilters['stf-vendor']||vendor===_tableFilters['stf-vendor'];const matchStage=!_tableFilters['stf-stage']||stageText.includes(_tableFilters['stf-stage'].replace('At ',''));tr.style.display=(matchLot&&matchGrade&&matchVendor&&matchStage)?'':'none';});}
function lotDomKey(l){return(l.id+'__'+l.grade+'__'+l.vendor).replace(/[^a-zA-Z0-9_\-]/g,'_');}
function toggleSort(table,col){const s=_sortState[table];if(s.col===col){s.dir*=-1;}
else{s.col=col;s.dir=1;}
if(table==='rm')renderRMTable();else if(table==='stock')renderStock();else if(table==='se')renderStageTable();else if(table==='dye')renderDyeTable();else if(table==='disp')renderDispatch();else if(table==='wind')renderWindTable();else if(table==='pack')renderPackTable();else if(table==='el')renderEditLog();else if(table==='rcstock')renderRecycleStock();else if(table==='rmstock')renderRMStock();else if(table==='dyestock')renderDyeStock();}
function sortArr(arr,col,dir){if(!col)return arr;return[...arr].sort((a,b)=>{let av=a[col],bv=b[col];if(av==null)av='';if(bv==null)bv='';const an=parseFloat(av),bn=parseFloat(bv);if(!isNaN(an)&&!isNaN(bn))return(an-bn)*dir;return String(av).localeCompare(String(bv))*dir;});}
function sortIcon(table,col){const s=_sortState[table];if(s.col!==col)return'<span style="color:var(--mu);font-size:0.6rem;margin-left:3px;">↕</span>';return s.dir===1?'<span style="color:var(--ac);font-size:0.6rem;margin-left:3px;">↑</span>':'<span style="color:var(--ac);font-size:0.6rem;margin-left:3px;">↓</span>';}
function sortTh(table,col,label){return`<th style="cursor:pointer;user-select:none;" onclick="toggleSort('${table}','${col}')">${label}${sortIcon(table,col)}</th>`;}
function parseLotSelect(val){if(!val)return{lotId:'',grade:'',vendor:''};const parts=val.split('||');return{lotId:parts[0]||'',grade:parts[1]||'',vendor:parts[2]||''};}
function lotOption(l,bal){const balStr=bal?` — ${fmt(bal.units)}u / ${fmt(bal.weight)}kg`:'';return`<option value="${l.id}||${l.grade}||${l.vendor}">${l.id} (${l.grade}) — ${l.vendor}${balStr}</option>`;}
function renderRMTable(){const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';const isSup=State.currentUser?.role==='supervisor'||isAdmin;
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
const vLot=document.getElementById('rmf-lot')?.value||'';const vVendor=document.getElementById('rmf-vendor')?.value||'';const vGrade=document.getElementById('rmf-grade')?.value||'';const allLots=State.DB.lots||[];const lots_f=[...new Set(allLots.filter(l=>(!vVendor||l.vendor===vVendor)&&(!vGrade||l.grade===vGrade)).map(l=>l.id).filter(Boolean))].sort();const vendors_f=[...new Set(allLots.filter(l=>(!vLot||l.id===vLot)&&(!vGrade||l.grade===vGrade)).map(l=>l.vendor).filter(Boolean))].sort();const grades_f=[...new Set(allLots.filter(l=>(!vLot||l.id===vLot)&&(!vVendor||l.vendor===vVendor)).map(l=>l.grade).filter(Boolean))].sort();const filteredLots=allLots.filter(l=>(!vLot||l.id===vLot)&&(!vVendor||l.vendor===vVendor)&&(!vGrade||l.grade===vGrade));const _rmWithComputed=filteredLots.map(l=>{const _lotSumRM=_getLotSummary(l.id,l.grade,l.vendor);const _rmBal=_lotSumRM?.rmBalance?{units:_lotSumRM.rmBalance.units,weight:_lotSumRM.rmBalance.kg}:getRMBalance(l.id,l.grade,l.vendor);const _sfWt=_lotSumRM?.softBalance?.kg??getSoftBalanceWeight(l.id,l.grade,l.vendor);const _sentDye=_lotSumRM?.sentToDye?.kg??getSoftConsumedByDye(l.id,l.grade,l.vendor);const _lotDt=l.date?new Date(l.date):null;const _today2=new Date();const _dRM=_lotDt?Math.floor((_today2-_lotDt)/86400000):null;const _sfEntries2=(State.DB.stageEntries||[]).filter(e=>e.lotId===l.id&&e.status==='Approved'&&e.endTime);const _lastSf2=_sfEntries2.length?new Date(_sfEntries2[_sfEntries2.length-1].endTime):null;const _dSf=_lastSf2&&_sfWt>0?Math.floor((_today2-_lastSf2)/86400000):null;const _linked2=(State.DB.dyeLots||[]).filter(d=>d.status==='Approved'&&(d.sources||[]).some(s=>s.lotId===l.id&&s.grade===l.grade&&s.vendor===l.vendor));const _lotSt=_linked2.length>0&&_sfWt===0&&_rmBal.units===0?'Completed':_sentDye>0?'At Dye':_sfWt>0?'At Soft':'At RM';return{...l,_rmBalU:_rmBal.units,_sfWt,_sentDye,_dRM:_dRM||999,_dSf:_dSf||999,_lotSt};});const _rmSorted=sortArr(_rmWithComputed,_sortState.rm.col,_sortState.rm.dir);const rows=_rmSorted.map(l=>{const delivCount=(l.deliveries||[]).length;const delivBadge=delivCount>1?`<span title="Click to see ${delivCount} deliveries" style="cursor:pointer;background:rgba(240,165,0,0.15);color:var(--ac);border:1px solid rgba(240,165,0,0.3);border-radius:10px;padding:3px 10px;font-size:0.65rem;font-weight:700;display:inline-flex;align-items:center;gap:4px;" onclick="toggleDeliveries('${lotDomKey(l)}')">📦 ${delivCount} ▼</span>`:`<span style="color:var(--mu);font-size:0.72rem">1 delivery</span>`;const dk=lotDomKey(l);const _lotSumRM2=_getLotSummary(l.id,l.grade,l.vendor);const _rmBal=_lotSumRM2?.rmBalance?{units:_lotSumRM2.rmBalance.units,weight:_lotSumRM2.rmBalance.kg}:getRMBalance(l.id,l.grade,l.vendor);const _rmB=Qmax0(_rmBal);const _rmReturn=getRMReturnedOut(l.id,l.grade,l.vendor);const _residual=getSoftResidualOut(l.id,l.grade,l.vendor);const _sfWt=_lotSumRM2?.softBalance?.kg??getSoftBalanceWeight(l.id,l.grade,l.vendor);const _sfBal=_lotSumRM2?.softBalance?{units:_lotSumRM2.softBalance.units,weight:_lotSumRM2.softBalance.kg}:getSoftBalance(l.id,l.grade,l.vendor);const _sentDye=_lotSumRM2?.sentToDye?.kg??getSoftConsumedByDye(l.id,l.grade,l.vendor);const _today=new Date();const _lotDt=l.date?new Date(l.date):null;const _dRM=_lotDt?Math.floor((_today-_lotDt)/86400000):null;const _sfEntries=(State.DB.stageEntries||[]).filter(function(e){return e.lotId===l.id&&e.status==='Approved'&&e.endTime;});const _lastSf=_sfEntries.length?new Date(_sfEntries[_sfEntries.length-1].endTime):null;const _dSf=_lastSf&&_sfWt>0?Math.floor((_today-_lastSf)/86400000):null;const _linked=(State.DB.dyeLots||[]).filter(function(d){return d.status==='Approved'&&(d.sources||[]).some(function(s){return s.lotId===l.id&&s.grade===l.grade&&s.vendor===l.vendor;});});const _lotSt=l.status==='Voided'?'Voided':_linked.length>0&&_sfWt===0&&_rmB.units===0?'Completed':_sentDye>0?'At Dye':_sfWt>0?'At Soft':'At RM';const _stC={'At RM':'var(--mu)','At Soft':'var(--cs)','At Dye':'var(--cd)','Completed':'var(--gr)','Voided':'var(--re)'}[_lotSt];const mainRow=`<tr id="rm-row-${dk}" class="${_stC==='var(--gr)'?'row-approved':_stC==='var(--re)'?'row-rejected':_stC==='var(--ye)'?'row-pending':''}"><td class="mono" style="cursor:pointer;color:var(--ac)" onclick="nav('lifecycle',document.getElementById('ni-lifecycle'));document.getElementById('lc-select').value='${l.id}';renderLifecycle()">
        ${l.id}<div style="font-size:0.6rem;color:var(--mu)">${fmtDate(l.date)}</div></td><td style="font-size:0.78rem">${l.vendor}</td><td><span class="badge b-rm">${l.grade}</span></td><td class="mono" style="font-size:0.75rem">${qtyCell(l.units,l.weight,'b')}
        ${delivCount>1?delivBadge:''}
      </td><td class="mono" style="color:${_rmReturn.weight>0?'var(--re)':'var(--mu)'}">${_rmReturn.weight>0?_rmReturn.units+'b / '+fmt(_rmReturn.weight)+'kg':'—'}</td>${balCell(_rmB.units,_rmB.weight,'b','var(--bl)')}<td class="mono" style="color:${_sfWt>0?'var(--tx)':'var(--mu)'}">${_sfBal?_sfBal.units+'b / '+fmt(_sfBal.weight)+'kg':fmt(_sfWt)+'kg'}</td><td class="mono" style="color:${_sentDye>0?'var(--ac)':'var(--mu)'}">${_sentDye>0?fmt(_sentDye)+'kg':'—'}</td><td class="mono" style="color:${_residual>0?'var(--ye)':'var(--mu)'}">${_residual>0?fmt(_residual)+'kg':'—'}</td><td>${agingBadge(_dRM)}</td><td>${_dSf!==null?agingBadge(_dSf):'<span style="color:var(--mu)">—</span>'}</td><td>${_lotSt==='Voided'?'<span class="badge b-void">Voided</span>':`<span style="font-size:0.72rem;font-weight:700;color:${_stC}">${_lotSt}</span>`}</td><td style="white-space:nowrap">
        ${delivCount===1?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Edit lot" onclick="openRMEdit('${l.id}','${l.grade}','${l.vendor}',0)">✏</button>${isSup?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Void delivery" style="color:var(--re)" onclick="voidRMDelivery('${l.id}','${l.grade}','${l.vendor}',0)">🗑</button>`:''}${isAdmin?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Recalculate summary" style="color:var(--ye)" onclick="recalcLotSummary('${l.id}','${l.grade}','${l.vendor}',this)">⟳</button>`:''}`:`<span style="font-size:0.65rem;color:var(--mu)">↓ per delivery</span>${isAdmin?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Recalculate summary" style="color:var(--ye)" onclick="recalcLotSummary('${l.id}','${l.grade}','${l.vendor}',this)">⟳</button>`:''}`}
      </td></tr>`;const delivRows=(l.deliveries||[]).map((d,i)=>`
      <tr style="background:rgba(240,165,0,0.04);font-size:0.72rem;"><td colspan="2" style="padding-left:28px;color:var(--mu)">↳ Delivery ${i+1}</td><td colspan="2" style="color:var(--mu)">${fmtDate(d.date)}</td><td class="mono" style="color:var(--gr)">${fmt(d.units)}b</td><td class="mono" style="color:var(--gr)">${fmt(d.weight)}kg</td><td colspan="2" style="color:var(--mu);font-size:0.68rem">${d.challan?'Challan: '+d.challan:'—'}</td><td style="color:var(--mu2);font-size:0.65rem">by ${d.addedBy||'Admin'} · ${fmtTS(d.addedAt)}</td><td style="white-space:nowrap"><button class="btn btn-ghost btn-xs tc-tip" data-tip="Edit delivery" onclick="openRMEdit('${l.id}','${l.grade}','${l.vendor}',${i})">✏</button>${isSup?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Void delivery" style="color:var(--re)" onclick="voidRMDelivery('${l.id}','${l.grade}','${l.vendor}',${i})">🗑</button>`:''}</td></tr>`).join('');const addDelivBtn=`<tr id="rm-deliv-add-${dk}" style="display:none;background:rgba(240,165,0,0.04);"><td colspan="18" style="padding:6px 28px;"><button class="btn bg bsm" onclick="openAddDelivery('${l.id}','${l.grade}','${l.vendor}')" style="font-size:0.7rem;">+ Add Another Delivery</button></td></tr>`;const expandRow=`<tr id="rm-deliv-${dk}" style="display:none;"><td colspan="18" style="padding:0;"><table style="width:100%;border-collapse:collapse;">${delivRows}</table></td></tr>`;return mainRow+expandRow+addDelivBtn;}).join('');document.getElementById('rm-tbody').innerHTML=rows||'<tr><td colspan="18"><div class="empty"><div class="empty-icon">📦</div><div class="empty-text">✕ No RM lots match filters — try clearing</div></div></td></tr>';const rmThead=document.getElementById('rm-thead');if(rmThead){rmThead.innerHTML=`
      <tr class="tbl-filter-row"><th>${buildColFilter(lots_f,'rmf-lot','Lot')}</th><th>${buildColFilter(vendors_f,'rmf-vendor','Vendor')}</th><th>${buildColFilter(grades_f,'rmf-grade','Grade')}</th><th colspan="10"></th></tr><tr>
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
        ${sortTh('rm','_lotSt','Status')}
        <th>Actions</th></tr>`;if(vLot)document.getElementById('rmf-lot').value=vLot;if(vVendor)document.getElementById('rmf-vendor').value=vVendor;if(vGrade)document.getElementById('rmf-grade').value=vGrade;_restoreFilterBtns('rmf-lot','rmf-vendor','rmf-grade');}setTimeout(fitBevTableHeight,0);}
function toggleDeliveries(domKey){const row=document.getElementById('rm-deliv-'+domKey);const addRow=document.getElementById('rm-deliv-add-'+domKey);if(!row)return;const isOpen=row.style.display!=='none';row.style.display=isOpen?'none':'';if(addRow)addRow.style.display=isOpen?'none':'';const mainRow=document.getElementById('rm-row-'+domKey);if(mainRow){const badge=mainRow.querySelector('span[onclick*="toggleDeliveries"]');if(badge){const lotId=domKey.split('__')[0];const lot=State.DB.lots.find(l=>lotDomKey(l)===domKey)||State.DB.lots.find(l=>l.id===lotId);const count=(lot?.deliveries||[]).length;badge.textContent=isOpen?count+' ▼':count+' ▲';}}}
function checkDuplicateInProgress(lotId,stage){const existing=State.DB.stageEntries.find(e=>e.lotId===lotId&&e.stage===stage&&e.status==='InProgress');if(!existing)return true;const elapsed=hrsBetween(existing.startTime,new Date().toISOString());const msg=`⚠ LOT-${lotId} already has a ${stage} entry IN PROGRESS\n`
+`Started: ${fmtTS(existing.startTime)} by ${existing.startWorker||'?'}\n`
+`Running for: ${fmtHrs(elapsed)}\n\n`
+`Start another run anyway? (only do this if machines are different)`;return confirm(msg);}
async function submitStageEntry(){
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
    const _rcId=document.getElementById('sf-rc-select')?.value||null;const _dsId=document.getElementById('sf-ds-select')?.value||null;
    try{
      const {ok,data,error,networkError}=await _postWithDuplicateCheck('/api/stage/start',{lotId,grade:_ssL.grade||_svGrade,vendor:_ssL.vendor||_svVendor,inUnits:inU,inWeight:inW,machine,worker,startNote,recycleId:_rcId,deadStockId:_dsId,changedBy:State.currentUser.name,idempotencyKey:crypto.randomUUID()});
  if(networkError)throw new Error(error);
  if(!ok){if(error!=='__cancelled_by_user__')setAlert('stage-alert',error||'Failed to start entry','alert-err');if(_sfBtn)_sfBtn.disabled=false;return;}
      if(_sfBtn)_sfBtn.disabled=false;closeModal('stage-modal');showToast('Soft entry started \u2713');renderAll();
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
      if(_sfBtn2)_sfBtn2.disabled=false;closeModal('stage-modal');showToast('Soft entry completed \u2713');renderAll();
    }catch(e){setAlert('stage-alert','Network error \u2014 not saved: '+e.message,'alert-err');if(_sfBtn2)_sfBtn2.disabled=false;}
  }
}

async function wSubmitStart(stage){const _wsRaw=document.getElementById(`w-${stage}-lot-start`)?.value||'';const{lotId,grade:_wsGrade,vendor:_wsVendor}=parseLotSelectValue(_wsRaw);const inU=parseFloat(document.getElementById(`w-${stage}-in-u`)?.value)||0;const inW=parseFloat(document.getElementById(`w-${stage}-in-w`)?.value)||0;const machine=document.getElementById(`w-${stage}-mach-start`)?.value;const startNote=document.getElementById(`w-${stage}-start-note`)?.value.trim()||'';const _wsRcId=document.getElementById(`w-${stage}-rc-select`)?.value||null;const _wsDsId=document.getElementById(`w-${stage}-ds-select`)?.value||null;if(!lotId||!inU){wSetAlert(stage,'Select lot and enter units','err');return;}
if(!inW||inW<=0){wSetAlert(stage,'Enter input weight (kg)','err');return;}
const _wsL=getLotByKey(lotId,_wsGrade,_wsVendor)||getLot(lotId);
const dup=State.DB.stageEntries.find(e=>e.lotId===lotId&&e.stage===stage&&e.status==='InProgress');if(dup){const elapsed=hrsBetween(dup.startTime,new Date().toISOString());if(!confirm(`${lotId} already has ${stage} running (${fmtHrs(elapsed)}). Start another?`))return;}
const _wsBtn=document.getElementById(`w-start-btn-${stage}`);if(_wsBtn)_wsBtn.disabled=true;
const _wsWorker=document.getElementById(`w-${stage}-worker-start`)?.value||State.currentUser?.name;
try{
  const {ok,data,error,networkError}=await _postWithDuplicateCheck('/api/stage/start',{lotId,grade:_wsL.grade||_wsGrade,vendor:_wsL.vendor||_wsVendor,inUnits:inU,inWeight:inW,machine,worker:_wsWorker,startNote,recycleId:_wsRcId,deadStockId:_wsDsId,changedBy:State.currentUser.name,idempotencyKey:crypto.randomUUID()});
  if(networkError)throw new Error(error);
  if(!ok){if(error!=='__cancelled_by_user__')wSetAlert(stage,error||'Failed to start entry','err');if(_wsBtn)_wsBtn.disabled=false;return;}
  if(_wsBtn)_wsBtn.disabled=false;showToast();wSetAlert(stage,'✓ Start recorded — come back to End when finished','ok');document.getElementById(`w-${stage}-in-u`).value='';document.getElementById(`w-${stage}-in-w`).value='';const _wsNoteEl=document.getElementById(`w-${stage}-start-note`);if(_wsNoteEl)_wsNoteEl.value='';renderWorkerView();
}catch(e){wSetAlert(stage,'Network error — not saved: '+e.message,'err');if(_wsBtn)_wsBtn.disabled=false;}}



function updateDyeTotal(){let tu=0,tw=0;document.querySelectorAll('#dye-sources>div[id^="ads-"]').forEach(row=>{tu+=parseFloat(row.querySelector('input[data-field="units"]')?.value)||0;tw+=parseFloat(row.querySelector('input[data-field="weight"]')?.value)||0;});const displayEl=document.getElementById('dye-total-display');if(displayEl)displayEl.textContent=`${fmt(tu)} units / ${fmt(tw)} kg`;const grade=document.getElementById('m-dye-grade')?.value;const poolEl=document.getElementById('dye-pool-live');if(poolEl&&grade){const pool=getGradePool(grade);const remaining=pool.units-tu;poolEl.innerHTML=`<div style="display:flex;justify-content:space-between;font-size:0.72rem;"><span style="color:var(--mu)">Grade ${grade} pool available</span><span class="mono" style="color:var(--gr)">${fmt(pool.units)}b total</span></div><div style="display:flex;justify-content:space-between;font-size:0.72rem;margin-top:3px;"><span style="color:var(--mu)">This batch using</span><span class="mono" style="color:var(--ac)">${fmt(tu)}u</span></div><div style="display:flex;justify-content:space-between;font-size:0.72rem;margin-top:3px;padding-top:4px;border-top:1px solid var(--b1);"><span style="color:var(--mu)">Remaining after batch</span><span class="mono" style="color:${remaining<0?'var(--re)':remaining<50?'var(--ye)':'var(--gr)'}">${fmt(remaining)}u</span></div>
    ${remaining<0?`<div class="alert alert-err"style="margin-top:6px;padding:6px 10px;font-size:0.7rem;">⚠ Over-assigned by ${fmt(Math.abs(remaining))}u — reduce quantities</div>`:''}`;}}
function renderDispatchLotRows(){const container=document.getElementById('disp-lots-container');if(!container)return;const rows=window._dispLotRows||[];if(!rows.length){container.innerHTML='';updateDispatchTotal();return;}
const availLots=(State.DB.dyeLots||[]).filter(d=>(d.status==='Approved'||d.status==='Edited-Approved')&&getPackBalAvailable(d.id).units>0).sort(sortDyeLotNo);const lotOpts=`<option value="">Select Dye Lot...</option>`+availLots.map(d=>{const grades=(d.sources||[]).map(s=>s.grade).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join('+');const pb=getPackBalAvailable(d.id);return`<option value="${d.id}">${d.dyeLotNo} — ${d.shade} [${grades}] (${pb.units}b / ${fmt(pb.weight)}kg avail)</option>`;}).join('');container.innerHTML=rows.map((row,i)=>`
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
function buildDispRefPanel(dyeLotId){
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

function addDispatchLotRow(){if(!window._dispLotRows)window._dispLotRows=[];window._dispLotRows.push({dyeLotId:'',grade:'',bags:'',weight:''});renderDispatchLotRows();}
function removeDispatchLotRow(i){if(!window._dispLotRows)return;window._dispLotRows.splice(i,1);renderDispatchLotRows();}
function onDispLotChange(i,dyeLotId){if(!window._dispLotRows)return;const dLot=(State.DB.dyeLots||[]).find(d=>d.id===dyeLotId);const grade=dLot?(dLot.sources||[]).map(s=>s.grade).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join('+'):'';window._dispLotRows[i].dyeLotId=dyeLotId;window._dispLotRows[i].grade=grade;window._dispLotRows[i].bags='';window._dispLotRows[i].weight='';renderDispatchLotRows();}
function onDispRowInput(i,field,val){if(!window._dispLotRows)return;window._dispLotRows[i][field]=val;updateDispatchTotal();}
function updateDispatchTotal(){const rows=window._dispLotRows||[];const totB=rows.reduce((a,r)=>a+(parseInt(r.bags)||0),0);const totW=rows.reduce((a,r)=>a+(parseFloat(r.weight)||0),0);const bar=document.getElementById('disp-total-bar');const disp=document.getElementById('disp-total-display');if(bar)bar.style.display=rows.length>1?'flex':'none';if(disp)disp.textContent=`${totB}b / ${fmt(totW)}kg`;}
async function submitDispatch(){
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
    if(_dpBtn)_dpBtn.disabled=false;closeModal('dispatch-modal');showToast(`${data.count} dispatch${data.count>1?'es':''} saved \u2713 \u2014 pending approval`);renderAll();
  }catch(e){setAlert('disp-alert','Network error \u2014 not saved: '+e.message,'alert-err');if(_dpBtn)_dpBtn.disabled=false;}
}

function populatePartySelect(){const sel=document.getElementById('m-disp-party');if(!sel)return;const parties=State.DB.parties||[];sel.innerHTML='<option value="">Select Party</option>'
+parties.map(p=>`<option value="${p}">${p}</option>`).join('');}
function exportPDF(){const activeTab=document.querySelector('[id^="rpt-"].tp.active,[id^="rpt-"].tab-panel.active');if(!activeTab){alert('No report tab active');return;}
const tabTitle=document.querySelector('.tab.active')?.textContent?.trim()||'Report';const content=activeTab.innerHTML;const win=window.open('','_blank');win.document.write(`<!DOCTYPE html><html><head><title>ThreadControl — ${tabTitle}</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:#1a1a1a;padding:20px}h1{font-size:16px;font-weight:700;margin-bottom:4px;color:#0f1116}.meta{font-size:10px;color:#666;margin-bottom:16px;padding-bottom:8px;border-bottom:2px solid #f0a500}table{width:100%;border-collapse:collapse;margin-top:10px}th{background:#0f1116;color:#fff;padding:6px 8px;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.05em}td{padding:5px 8px;border-bottom:1px solid #e5e7eb;font-size:10px}tr:nth-child(even) td{background:#f9fafb}.badge{display:inline-block;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:700}.card{border:1px solid #e5e7eb;border-radius:6px;padding:12px;margin-bottom:12px}.card-title{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#666;margin-bottom:8px}@media print{body{padding:10px}button{display:none}}.wc-zero{color:#888;font-weight:400}.wc-low{color:#dc2626;font-weight:700}.wc-mid{color:#dc2626;font-weight:700}.wc-high{color:#dc2626;font-weight:700}</style></head><body><h1>ThreadControl — ${tabTitle}</h1><div class="meta">
      Generated: ${new Date().toLocaleString('en-GB')} &nbsp;|&nbsp; 
      By: ${State.currentUser?.name||'—'} &nbsp;|&nbsp;
      Total Lots: ${State.DB.lots.length} &nbsp;|&nbsp;
      Report Period: All approved data
    </div>
    ${content}
    <scr'+'ipt>window.onload=()=>{window.print();window.close();}</scr'+'ipt><div class="staging-banner">⚠ STAGING — NOT PRODUCTION</div><div class="modal-overlay hidden" id="override-modal-overlay"><div class="modal" style="max-width:560px"><h2>⚡ Admin Override</h2><div id="override-alert"></div><div style="background:var(--s2);border-radius:8px;padding:10px 14px;font-size:0.75rem;margin-bottom:14px;" id="override-entry-info"></div><div class="fgrid" id="override-fields"></div><div class="fgrid" style="margin-top:12px;"><div class="fg"><label class="fl">Override Reason *</label><select class="fs" id="override-reason-cat"><option value="">Select reason...</option><option>Admin correction</option><option>Data entry error</option><option>Wrong lot/grade selected</option><option>Quantity correction</option><option>Weight correction</option><option>Status correction</option><option>Other</option></select></div><div class="fg fg-full"><label class="fl">Reason detail *</label><textarea class="fi" id="override-reason-text" rows="2" placeholder="Explain why this override is needed..."></textarea></div></div><input type="hidden" id="override-entry-id"><input type="hidden" id="override-entry-type"><div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal('override-modal-overlay')">Cancel</button><button class="btn btn-danger" onclick="submitOverride()">⚡ Apply Override</button></div></div>
</div></body></html>`);win.document.close();}
function renderAnDailyLog(){const dateEl=document.getElementById('an-daily-date');const container=document.getElementById('an-daily-content');if(!container)return;const selDate=dateEl?.value||(new Date().toISOString().split('T')[0]);if(dateEl&&!dateEl.value){dateEl.value=selDate;window._dailyLogActive='';}
const softEntries=(State.DB.stageEntries||[]).filter(e=>e.stage==='Soft'&&(_inDayFn(e.startTime)||_inDayFn(e.endTime||'')));const dyeEntries=(State.DB.dyeLots||[]).filter(d=>_inDayFn(d.startTime||'')||_inDayFn(d.endTime||''));const windEntries=(State.DB.windEntries||[]).filter(e=>_inDayFn(e.startTime||'')||_inDayFn(e.endTime||''));const packEntries=(State.DB.packEntries||[]).filter(e=>_inDayFn(e.timestamp||''));const dispatches=(State.DB.dispatches||[]).filter(d=>_inDayFn(d.timestamp||''));const softInB=softEntries.reduce((a,e)=>a+(e.inUnits||0),0);const softOutB=softEntries.filter(e=>e.outUnits).reduce((a,e)=>a+(e.outUnits||0),0);const softInKg=softEntries.reduce((a,e)=>a+(e.inWeight||0),0);const softOutKg=softEntries.filter(e=>e.outWeight).reduce((a,e)=>a+(e.outWeight||0),0);const dyeInKg=dyeEntries.reduce((a,d)=>a+(d.totalInWeight||0),0);const dyeOutKg=dyeEntries.reduce((a,d)=>a+(d.outWeight||0),0);const dyeOutC=dyeEntries.reduce((a,d)=>a+(d.outCones||0),0);const windInC=windEntries.reduce((a,e)=>a+(e.inCones||0),0);const windInKg=windEntries.reduce((a,e)=>a+(e.inWeight||0),0);const windOutC=windEntries.reduce((a,e)=>a+(e.outCones||0),0);const windOutKg=windEntries.reduce((a,e)=>a+(e.outWeight||0),0);const packInC=packEntries.reduce((a,e)=>a+(e.inCones||0),0);const packB=packEntries.reduce((a,e)=>a+(e.bags||0),0);const packKg=packEntries.reduce((a,e)=>a+(e.weight||0),0);const dispB=dispatches.reduce((a,d)=>a+(d.bags||0),0);const dispKg=dispatches.reduce((a,d)=>a+(d.weight||0),0);const dispParties=[...new Set(dispatches.map(d=>d.party).filter(Boolean))];const noActivity=!softEntries.length&&!dyeEntries.length&&!windEntries.length&&!packEntries.length&&!dispatches.length;const tbl=(cols,rows)=>`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:0.73rem"><thead><tr style="background:var(--s3)">${cols.map(c=>`<th style="padding:7px 10px;text-align:${c.r?'right':'left'};font-size:0.6rem;font-weight:700;text-transform:uppercase;color:var(--mu);white-space:nowrap">${c.l}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr style="border-bottom:1px solid var(--b1)">${r.map((c,i)=>`<td style="padding:7px 10px;${cols[i].r?'text-align:right;font-family:monospace;':''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;const stageTables={soft:softEntries.length?tbl([{l:'Lot'},{l:'Grade'},{l:'Bags In',r:1},{l:'Bags Out',r:1},{l:'Kg In',r:1},{l:'Kg Out',r:1},{l:'Status'}],softEntries.map(e=>[e.lotId||'—',e.grade||'—',(e.inUnits||0)+'b',e.outUnits?(e.outUnits+'b'):'—',e.inWeight?fmt(e.inWeight)+'kg':'—',e.outWeight?fmt(e.outWeight)+'kg':'—',e.outUnits?'<span style="color:var(--gr)">Done</span>':'<span style="color:var(--ye)">Running</span>'])):'<div style="padding:12px;color:var(--mu);font-size:0.75rem;text-align:center">No soft activity</div>',dye:dyeEntries.length?tbl([{l:'Dye Lot'},{l:'Shade'},{l:'Cones In',r:1},{l:'Kg In',r:1},{l:'Cones Out',r:1},{l:'Kg Out',r:1},{l:'Status'}],dyeEntries.map(d=>[`<span style="color:var(--ac);font-weight:700">${d.dyeLotNo||'—'}</span>`,d.shade||'—',(d.sources||[]).reduce((a,s)=>a+(s.cones||0),0)+'c',fmt(d.totalInWeight||0)+'kg',d.outCones?(d.outCones+'c'):'—',d.outWeight?fmt(d.outWeight)+'kg':'—',d.endTime?'<span style="color:var(--gr)">Done</span>':'<span style="color:var(--ye)">Running</span>'])):'<div style="padding:12px;color:var(--mu);font-size:0.75rem;text-align:center">No dye activity</div>',wind:windEntries.length?tbl([{l:'Entry'},{l:'Dye Lot'},{l:'Shade'},{l:'Cones In',r:1},{l:'Kg In',r:1},{l:'Cones Out',r:1},{l:'Kg Out',r:1},{l:'Status'}],windEntries.map(e=>[e.id||'—',`<span style="color:var(--ac);font-weight:700">${e.dyeLotNo||'—'}</span>`,e.shade||'—',(e.inCones||0)+'c',fmt(e.inWeight||0)+'kg',e.outCones?(e.outCones+'c'):'—',e.outWeight?fmt(e.outWeight)+'kg':'—',e.outCones?'<span style="color:var(--gr)">Done</span>':'<span style="color:var(--ye)">Running</span>'])):'<div style="padding:12px;color:var(--mu);font-size:0.75rem;text-align:center">No wind activity</div>',pack:packEntries.length?tbl([{l:'Entry'},{l:'Dye Lot'},{l:'Shade'},{l:'Cones In',r:1},{l:'Bags Out',r:1},{l:'Kg Out',r:1}],packEntries.map(e=>[e.id||'—',`<span style="color:var(--ac);font-weight:700">${e.dyeLotNo||'—'}</span>`,e.shade||'—',(e.inCones||0)+'c',(e.bags||0)+'b',fmt(e.weight||0)+'kg'])):'<div style="padding:12px;color:var(--mu);font-size:0.75rem;text-align:center">No pack activity</div>',dispatch:dispatches.length?tbl([{l:'Dye Lot'},{l:'Shade'},{l:'Bags',r:1},{l:'Kg',r:1},{l:'Party'},{l:'Challan'}],dispatches.map(d=>[`<span style="color:var(--ac);font-weight:700">${d.dyeLotNo||'—'}</span>`,d.shade||'—',(d.bags||0)+'b',fmt(d.weight||0)+'kg',d.party||'—',d.invoiceNo||'—'])):'<div style="padding:12px;color:var(--mu);font-size:0.75rem;text-align:center">No dispatch activity</div>'};const stages=[{key:'soft',icon:'⚙',label:'Soft',c:'var(--cs)',summary:softEntries.length?`${softEntries.length} entries<br><span style="font-size:0.8rem">${softInB}b / ${fmt(softInKg)}kg in → ${softOutB}b / ${fmt(softOutKg)}kg out</span>`:'<span style="color:var(--mu)">No activity</span>'},{key:'dye',icon:'🎨',label:'Dye',c:'var(--cd)',summary:dyeEntries.length?`${dyeEntries.length} lot(s)<br><span style="font-size:0.8rem">${fmt(dyeInKg)}kg in → ${dyeOutC}c / ${fmt(dyeOutKg)}kg out</span>`:'<span style="color:var(--mu)">No activity</span>'},{key:'wind',icon:'🌀',label:'Wind',c:'var(--cw)',summary:windEntries.length?`${windEntries.length} entries<br><span style="font-size:0.8rem">${windInC}c / ${fmt(windInKg)}kg in → ${windOutC}c / ${fmt(windOutKg)}kg out</span>`:'<span style="color:var(--mu)">No activity</span>'},{key:'pack',icon:'📦',label:'Pack',c:'var(--cp)',summary:packEntries.length?`${packEntries.length} entries<br><span style="font-size:0.8rem">${packInC}c → ${packB}b / ${fmt(packKg)}kg</span>`:'<span style="color:var(--mu)">No activity</span>'},{key:'dispatch',icon:'🚚',label:'Dispatch',c:'var(--gr)',summary:dispatches.length?`${dispatches.length} entries<br><span style="font-size:0.8rem">${dispB}b / ${fmt(dispKg)}kg → ${dispParties.length} party(s)</span>`:'<span style="color:var(--mu)">No activity</span>'},];if(noActivity){container.innerHTML='<div class="empty"><div class="empty-icon">📭</div><div class="empty-text">No activity on '+selDate+'</div></div>';return;}
const activeStage=window._dailyLogActive||'';container.innerHTML=`
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin-bottom:16px">
      ${stages.map(s=>`<div onclick="window._dailyLogActive='${activeStage===s.key?'':s.key}';renderAnDailyLog();"
style="background:var(--s2);border-radius:10px;padding:14px;border-left:3px solid ${s.c};cursor:pointer;${activeStage===s.key?'box-shadow:0 0 0 2px '+s.c+';':''}transition:all 0.15s;"><div style="font-size:1.1rem">${s.icon}</div><div style="font-size:0.82rem;font-weight:800;color:${s.c};margin:6px 0 2px">${s.label}</div><div style="font-size:0.75rem;color:var(--tx);line-height:1.4">${s.summary}</div><div style="font-size:0.65rem;color:var(--mu);margin-top:6px">${activeStage===s.key?'▲ Hide detail':'▼ View detail'}</div></div>`).join('')}
    </div>
    ${activeStage ? `<div style="background:var(--s2);border-radius:10px;padding:14px;border-top:3px solid ${stages.find(s=>s.key===activeStage)?.c||'var(--ac)'}"><div style="font-size:0.7rem;font-weight:700;text-transform:uppercase;color:var(--mu);margin-bottom:10px">${stages.find(s=>s.key===activeStage)?.icon}${stages.find(s=>s.key===activeStage)?.label}— Detail — ${selDate}</div>${stageTables[activeStage]||''}</div>` : ''}`;}
function rptShade(){const{from,to}=getRptRange('shade');const el=document.getElementById('rpt-shade-c');if(!el)return;
let shadeMap;
if(rptState['shade']?.isAllTime&&State.DB.reportSummaries?.shade){
  shadeMap=State.DB.reportSummaries.shade;
}else{
  const lots=appr(State.DB.dyeLots||[]).filter(d=>d.endTime&&inRange(d.endTime,from,to));
  shadeMap=calcShadeTotals(lots,State.DB.packEntries,State.DB.dispatches);
}
const rows=Object.values(shadeMap).map(r=>({...r,parties:Array.isArray(r.parties)?new Set(r.parties):r.parties})).sort((a,b)=>b.dispatched-a.dispatched);if(!rows.length){el.innerHTML='<div style="padding:20px;color:var(--mu);text-align:center">No data in this period</div>';return;}
const maxDisp=Math.max(...rows.map(r=>r.dispatched),1);const SHADE_LIMIT=15;const renderShadeRows=(shadeRows)=>'<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:0.73rem">'
+'<thead><tr style="background:var(--s2)">'
+'<th style="padding:8px;text-align:left">Shade</th>'
+'<th style="padding:8px;text-align:right">Lots</th>'
+'<th style="padding:8px;text-align:right">In kg</th>'
+'<th style="padding:8px;text-align:right">Out kg</th>'
+'<th style="padding:8px;text-align:right;color:var(--gr)">Dispatched</th>'
+'<th style="padding:8px;text-align:right;color:var(--ye)">Pending kg</th>'
+'<th style="padding:8px">Volume</th>'
+'<th style="padding:8px;text-align:left">Top Parties</th>'
+'</tr></thead><tbody>'
+shadeRows.map(r=>{const sp=(r.dispatched/maxDisp*100).toFixed(0);const topParties=[...r.parties].slice(0,2).join(', ')+(r.parties.size>2?` +${r.parties.size-2}`:'');return`<tr style="border-bottom:1px solid var(--b1)"><td style="padding:8px;font-weight:700;color:var(--cd)">${r.shade}</td><td style="padding:8px;text-align:right">${r.lots}</td><td style="padding:8px;text-align:right;font-family:monospace">${fmt(r.inKg)}</td><td style="padding:8px;text-align:right;font-family:monospace">${fmt(r.outKg)}</td><td style="padding:8px;text-align:right;font-family:monospace;color:var(--gr);font-weight:700">${fmt(r.dispBags)}b / ${fmt(r.dispatched)}kg</td><td style="padding:8px;text-align:right;font-family:monospace;color:${r.pending>0?'var(--ye)':'var(--mu)'}">${r.pending>0?fmt(r.pending):'—'}</td><td style="padding:8px"><div style="background:var(--s3);border-radius:3px;height:8px"><div style="width:${sp}%;height:100%;background:var(--cd);border-radius:3px"></div></div></td><td style="padding:8px;font-size:0.68rem;color:var(--mu)">${topParties||'—'}</td></tr>`;}).join('')+'</tbody></table></div>';const visibleShades=window._rptShadeExpanded?rows:rows.slice(0,SHADE_LIMIT);const showMoreShade=rows.length>SHADE_LIMIT?`<div style="text-align:center;padding:10px"><button class="btn btn-ghost btn-sm" onclick="window._rptShadeExpanded=!window._rptShadeExpanded;rptShade()">${window._rptShadeExpanded?'▲ Show less':'▼ Show '+(rows.length-SHADE_LIMIT)+' more shades'}</button></div>`:'';el.innerHTML=renderShadeRows(visibleShades)+showMoreShade;}
function rptGrade(){
  const{from,to}=getRptRange('grade');const el=document.getElementById('rpt-grade-c');if(!el)return;
  const gradeMap={};
  // RM Received + RM Lots count — grade is an RM-level attribute, exists before
  // dyeing ever happens, so this pulls from DB.lots directly (unlike shade, which
  // only exists at dye-lot level). Windowed by each RM lot's own intake date.
  (State.DB.lots||[]).filter(l=>inRange(l.date,from,to)).forEach(l=>{
    const g=l.grade||'Unknown';
    if(!gradeMap[g])gradeMap[g]={grade:g,rmLots:0,rmKg:0,dyedKg:0,dispatchedKg:0,dispatchedBags:0};
    gradeMap[g].rmLots++;gradeMap[g].rmKg+=l.weight||0;
  });
  // Dyed + Dispatched — traced from dye lots' sources[], windowed by dye lot's
  // own endTime (consistent with how Shade Analysis windows its own numbers).
  // Mixing happens occasionally: a dye lot can source from more than one grade
  // in its sources[] rows. Split this dye lot's outWeight/dispatched proportionally
  // by each grade's share of the dye lot's total source weight, so a single-grade
  // dye lot (the common case) gets 100% share with no extra math, and a genuinely
  // mixed dye lot splits correctly across the grades it actually drew from.
  appr(State.DB.dyeLots||[]).filter(d=>d.endTime&&inRange(d.endTime,from,to)).forEach(d=>{
    const sources=d.sources||[];
    const totalSrcW=sources.reduce((a,s)=>a+(s.weight||0),0);
    if(totalSrcW<=0)return;
    const td=getTotalDispatched(d.id);
    const shareByGrade={};
    sources.forEach(s=>{const g=s.grade||'Unknown';shareByGrade[g]=(shareByGrade[g]||0)+(s.weight||0);});
    Object.entries(shareByGrade).forEach(([g,srcW])=>{
      const share=srcW/totalSrcW;
      if(!gradeMap[g])gradeMap[g]={grade:g,rmLots:0,rmKg:0,dyedKg:0,dispatchedKg:0,dispatchedBags:0};
      gradeMap[g].dyedKg+=(d.outWeight||0)*share;
      gradeMap[g].dispatchedKg+=(td.weight||0)*share;
      gradeMap[g].dispatchedBags+=(td.bags||0)*share;
    });
  });
  const rows=Object.values(gradeMap).map(r=>({...r,pending:Math.max(0,r.rmKg-r.dispatchedKg)})).sort((a,b)=>b.dispatchedKg-a.dispatchedKg);
  if(!rows.length){el.innerHTML='<div style="padding:20px;color:var(--mu);text-align:center">No data in this period</div>';return;}
  const maxDisp=Math.max(...rows.map(r=>r.dispatchedKg),1);const GRADE_LIMIT=15;
  const renderGradeRows=(gradeRows)=>'<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:0.73rem">'
  +'<thead><tr style="background:var(--s2)">'
  +'<th style="padding:8px;text-align:left">Grade</th>'
  +'<th style="padding:8px;text-align:right">RM Lots</th>'
  +'<th style="padding:8px;text-align:right">RM Received (kg)</th>'
  +'<th style="padding:8px;text-align:right">Dyed (kg)</th>'
  +'<th style="padding:8px;text-align:right;color:var(--gr)">Dispatched</th>'
  +'<th style="padding:8px;text-align:right;color:var(--ye)">Pending (kg)</th>'
  +'<th style="padding:8px">Volume</th>'
  +'</tr></thead><tbody>'
  +gradeRows.map(r=>{const sp=(r.dispatchedKg/maxDisp*100).toFixed(0);return`<tr style="border-bottom:1px solid var(--b1)"><td style="padding:8px;font-weight:700;color:var(--cd)">${r.grade}</td><td style="padding:8px;text-align:right">${r.rmLots}</td><td style="padding:8px;text-align:right;font-family:monospace">${fmt(r.rmKg)}</td><td style="padding:8px;text-align:right;font-family:monospace">${fmt(r.dyedKg)}</td><td style="padding:8px;text-align:right;font-family:monospace;color:var(--gr);font-weight:700">${fmt(r.dispatchedBags)}b / ${fmt(r.dispatchedKg)}kg</td><td style="padding:8px;text-align:right;font-family:monospace;color:${r.pending>0?'var(--ye)':'var(--mu)'}">${r.pending>0?fmt(r.pending):'—'}</td><td style="padding:8px"><div style="background:var(--s3);border-radius:3px;height:8px"><div style="width:${sp}%;height:100%;background:var(--cd);border-radius:3px"></div></div></td></tr>`;}).join('')+'</tbody></table></div>';
  const visibleGrades=window._rptGradeExpanded?rows:rows.slice(0,GRADE_LIMIT);
  const showMoreGrade=rows.length>GRADE_LIMIT?`<div style="text-align:center;padding:10px"><button class="btn btn-ghost btn-sm" onclick="window._rptGradeExpanded=!window._rptGradeExpanded;rptGrade()">${window._rptGradeExpanded?'▲ Show less':'▼ Show '+(rows.length-GRADE_LIMIT)+' more grades'}</button></div>`:'';
  el.innerHTML=renderGradeRows(visibleGrades)+showMoreGrade;
}
function rptPack(){const{from,to}=getRptRange('pack');const el=document.getElementById('rpt-pack-c');if(!el)return;const _packFilter=window._packFilter||'all';const _dyeLotFilter=window._packDyeLotFilter||'';const dlSel=document.getElementById('rpt-pack-dyelot');if(dlSel){const allLots=appr(State.DB.dyeLots||[]).filter(d=>d.status==='Approved'||d.status==='Edited-Approved').sort((a,b)=>(a.dyeLotNo||'').localeCompare(b.dyeLotNo||''));const current=dlSel.value;dlSel.innerHTML='<option value="">All Dye Lots</option>'+allLots.map(d=>`<option value="${d.id}">${d.dyeLotNo}${d.shade?' — '+d.shade:''}</option>`).join('');if(current)dlSel.value=current;}
const lots=appr(State.DB.dyeLots||[]).filter(d=>(d.status==='Approved'||d.status==='Edited-Approved')&&(!_dyeLotFilter||d.id===_dyeLotFilter));const rows=lots.map(d=>{const packE=appr(State.DB.packEntries||[]).filter(e=>e.dyeLotId===d.id&&inRange(e.timestamp,from,to));if(!packE.length)return null;const windEntries=appr(State.DB.windEntries||[]).filter(e=>e.dyeLotId===d.id&&e.endTime);const windOutKg=windEntries.reduce((a,e)=>a+(e.outWeight||0),0);if(!windOutKg)return null;const packKg=packE.reduce((a,e)=>a+(e.weight||0),0);const packBags=packE.reduce((a,e)=>a+(e.bags||0),0);const packBal=windOutKg-packKg;if(packBal>1)return null;const gainLoss=packKg-windOutKg;const pct=windOutKg>0?((gainLoss/windOutKg)*100).toFixed(1):0;return{id:d.id,dyeLotNo:d.dyeLotNo,shade:d.shade,grade:(d.sources||[])[0]?.grade||'—',windKg:windOutKg,packKg,packBags,gainLoss,pct:parseFloat(pct)};}).filter(Boolean);let filtered=rows;if(_packFilter==='gain')filtered=rows.filter(r=>r.gainLoss>0);else if(_packFilter==='loss')filtered=rows.filter(r=>r.gainLoss<0);else if(_packFilter==='0-2')filtered=rows.filter(r=>Math.abs(r.pct)>0&&Math.abs(r.pct)<=2);else if(_packFilter==='2-5')filtered=rows.filter(r=>Math.abs(r.pct)>2&&Math.abs(r.pct)<=5);else if(_packFilter==='5-10')filtered=rows.filter(r=>Math.abs(r.pct)>5&&Math.abs(r.pct)<=10);else if(_packFilter==='10+')filtered=rows.filter(r=>Math.abs(r.pct)>10);filtered.sort((a,b)=>b.pct-a.pct);const gains=rows.filter(r=>r.gainLoss>0).length;const losses=rows.filter(r=>r.gainLoss<0).length;el.innerHTML=`<div style="margin-bottom:14px"><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;align-items:center"><span style="font-size:0.68rem;color:var(--mu);font-weight:700">Type:</span><button class="btn btn-ghost btn-sm" style="${_packFilter==='all'?'background:var(--ac);color:#000':''}" onclick="setPackFilter('all')">All (${rows.length})</button><button class="btn btn-ghost btn-sm" style="${_packFilter==='gain'?'background:var(--gr);color:#fff':''}" onclick="setPackFilter('gain')">🟢 Gain (${gains})</button><button class="btn btn-ghost btn-sm" style="${_packFilter==='loss'?'background:var(--re);color:#fff':''}" onclick="setPackFilter('loss')">🔴 Loss (${losses})</button></div><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><span style="font-size:0.68rem;color:var(--mu);font-weight:700">Range:</span><button class="btn btn-ghost btn-sm" style="${_packFilter==='0-2'?'background:var(--ye);color:#000':''}" onclick="setPackFilter('0-2')">0–2%</button><button class="btn btn-ghost btn-sm" style="${_packFilter==='2-5'?'background:#f97316;color:#fff':''}" onclick="setPackFilter('2-5')">2–5%</button><button class="btn btn-ghost btn-sm" style="${_packFilter==='5-10'?'background:var(--re);color:#fff':''}" onclick="setPackFilter('5-10')">5–10%</button><button class="btn btn-ghost btn-sm" style="${_packFilter==='10+'?'background:var(--re);color:#fff':''}" onclick="setPackFilter('10+')">10%+</button><span style="font-size:0.68rem;color:var(--mu);margin-left:auto">${filtered.length} lots shown</span></div></div>`
+(filtered.length?(()=>{const getRangeLabel=(pct)=>{const abs=Math.abs(pct);if(abs<0.01)return{label:'⚪ Break Even',col:'var(--mu)',order:0};if(abs<=2)return pct>0?{label:'🟢 Gain 0-2%',col:'var(--gr)',order:1}:{label:'🔴 Loss 0-2%',col:'var(--re)',order:5};if(abs<=5)return pct>0?{label:'🟢 Gain 2-5%',col:'var(--gr)',order:2}:{label:'🟠 Loss 2-5%',col:'#f97316',order:6};if(abs<=10)return pct>0?{label:'🟢 Gain 5-10%',col:'var(--gr)',order:3}:{label:'🔴 Loss 5-10%',col:'var(--re)',order:7};return pct>0?{label:'🟢 Gain 10%+',col:'var(--gr)',order:4}:{label:'🔴 Loss 10%+',col:'var(--re)',order:8};};const groups={};filtered.forEach(r=>{const g=getRangeLabel(r.pct);if(!groups[g.label])groups[g.label]={...g,rows:[]};groups[g.label].rows.push(r);});return Object.values(groups).sort((a,b)=>a.order-b.order).map(g=>`
      <div style="margin-bottom:16px"><div style="font-size:0.72rem;font-weight:800;color:${g.col};padding:6px 0;border-bottom:2px solid ${g.col};margin-bottom:8px">${g.label} (${g.rows.length} lots)</div><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:0.73rem"><thead><tr style="background:var(--s2)"><th style="padding:8px;text-align:left">Dye Lot</th><th style="padding:8px">Shade</th><th style="padding:8px">Grade</th><th style="padding:8px;text-align:right">Wind Out (kg)</th><th style="padding:8px;text-align:right">Pack Out (kg)</th><th style="padding:8px;text-align:right">Bags</th><th style="padding:8px;text-align:right">Gain/Loss (kg)</th><th style="padding:8px;text-align:right">%</th></tr></thead><tbody>
          ${g.rows.map(r=>`<tr style="border-bottom:1px solid var(--b1)"><td style="padding:8px"><span onclick="openDyeLifecycle('${r.id}')"style="color:var(--ac);font-weight:700;cursor:pointer;font-family:monospace">${r.dyeLotNo}</span></td><td style="padding:8px;color:var(--cd)">${r.shade}</td><td style="padding:8px;color:var(--mu);font-size:0.72rem">${r.grade}</td><td style="padding:8px;text-align:right;font-family:monospace">${fmt(r.windKg)}</td><td style="padding:8px;text-align:right;font-family:monospace;font-weight:700">${fmt(r.packKg)}</td><td style="padding:8px;text-align:right">${r.packBags}</td><td style="padding:8px;text-align:right;font-family:monospace;font-weight:700;color:${r.gainLoss>=0?'var(--gr)':'var(--re)'}">${r.gainLoss>=0?'+':''}${fmt(r.gainLoss)}</td><td style="padding:8px;text-align:right;font-weight:700;color:${r.pct>=0?'var(--gr)':'var(--re)'}">${r.pct>=0?'+':''}${r.pct}%</td></tr>`).join('')}
          </tbody></table></div></div>`).join('');})():'<div style="padding:20px;color:var(--mu);text-align:center">No completed lots for selected filter</div>');}
function setPackFilter(val){window._packFilter=val;rptPack();}
function clearPackDyeLotFilter(){window._packDyeLotFilter='';const s=document.getElementById('rpt-pack-dyelot');if(s)s.value='';rptPack();}
function clearMachFilter(){window._machStageFilter='all';window._machMachFilter='all';rptMachine();}
function clearWorkFilter(){window._workStageFilter='all';window._workWorkerFilter='all';rptWorker();}
function setWasteFilter(val){window._wasteFilter=val;rptWaste();}
function setWasteStage(val){window._wasteStage=val;rptWaste();}
function rptWaste(){const{from,to}=getRptRange('waste');const sumEl=document.getElementById('rpt-waste-summary');const lotsEl=document.getElementById('rpt-waste-lots');if(!sumEl||!lotsEl)return;const softE=appr(State.DB.stageEntries||[]).filter(e=>e.stage==='Soft'&&e.endTime&&inRange(e.endTime,from,to));const softIn=softE.reduce((a,e)=>a+(e.inWeight||0),0);const softOut=softE.reduce((a,e)=>a+(e.outWeight||0),0);const dyeL=appr(State.DB.dyeLots||[]).filter(d=>d.endTime&&inRange(d.endTime,from,to));const dyeIn=dyeL.reduce((a,d)=>a+(d.totalInWeight||0),0);const dyeOut=dyeL.reduce((a,d)=>a+(d.outWeight||0),0);const windE=appr(State.DB.windEntries||[]).filter(e=>e.endTime&&inRange(e.endTime,from,to));const windIn=windE.reduce((a,e)=>a+(e.inWeight||0),0);const windOut=windE.reduce((a,e)=>a+(e.outWeight||0),0);const stages=[{name:'🧵 Soft',col:'var(--cs)',inKg:softIn,outKg:softOut,entries:softE.length},{name:'🎨 Dye',col:'var(--cd)',inKg:dyeIn,outKg:dyeOut,entries:dyeL.length},{name:'🌀 Wind',col:'var(--cw)',inKg:windIn,outKg:windOut,entries:windE.length},];sumEl.innerHTML='<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:0.73rem">'
+'<thead><tr style="background:var(--s2)"><th style="padding:8px;text-align:left">Stage</th>'
+'<th style="padding:8px;text-align:right">In kg</th><th style="padding:8px;text-align:right">Out kg</th>'
+'<th style="padding:8px;text-align:right">Diff kg</th><th style="padding:8px;text-align:right">%</th>'
+'<th style="padding:8px">Visual</th><th style="padding:8px;text-align:right">Entries</th>'
+'</tr></thead><tbody>'
+stages.map(s=>{const diff=s.outKg-s.inKg;const pct=s.inKg>0?((Math.abs(diff)/s.inKg)*100).toFixed(1):0;const isGain=diff>=0;const col=isGain?'var(--gr)':'var(--re)';return`<tr style="border-bottom:1px solid var(--b1)"><td style="padding:8px;font-weight:700;color:${s.col}">${s.name}</td><td style="padding:8px;text-align:right;font-family:monospace">${fmt(s.inKg)}</td><td style="padding:8px;text-align:right;font-family:monospace">${fmt(s.outKg)}</td><td style="padding:8px;text-align:right;font-family:monospace;font-weight:700;color:${col}">${isGain?'+':''}${fmt(diff)}</td><td style="padding:8px;text-align:right;font-weight:700;color:${col}">${isGain?'+':''}${pct}%</td><td style="padding:8px"><div style="background:var(--s3);border-radius:3px;height:8px;width:120px"><div style="width:${Math.min(pct,100)}%;height:100%;background:${col};border-radius:3px"></div></div></td><td style="padding:8px;text-align:right;color:var(--mu)">${s.entries}</td></tr>`;}).join('')+'</tbody></table></div>';const lotRows=[];const softByLot={};softE.forEach(e=>{if(!softByLot[e.lotId])softByLot[e.lotId]={inKg:0,outKg:0};softByLot[e.lotId].inKg+=e.inWeight||0;softByLot[e.lotId].outKg+=e.outWeight||0;});Object.entries(softByLot).forEach(([lotId,v])=>{const diff=v.outKg-v.inKg;const pct=v.inKg>0?((Math.abs(diff)/v.inKg)*100).toFixed(1):0;lotRows.push({label:lotId,shade:'—',stage:'Soft',inKg:v.inKg,outKg:v.outKg,diff,pct:parseFloat(pct),id:null,type:'rm'});});dyeL.forEach(d=>{const diff=(d.outWeight||0)-(d.totalInWeight||0);const pct=d.totalInWeight>0?((Math.abs(diff)/d.totalInWeight)*100).toFixed(1):0;lotRows.push({label:d.dyeLotNo,shade:d.shade||'',stage:'Dye',inKg:d.totalInWeight||0,outKg:d.outWeight||0,diff,pct:parseFloat(pct),id:d.id,type:'dye'});});const windByDL={};windE.forEach(e=>{if(!windByDL[e.dyeLotId])windByDL[e.dyeLotId]={dyeLotNo:e.dyeLotNo,shade:e.shade,id:e.dyeLotId,inKg:0,outKg:0};windByDL[e.dyeLotId].inKg+=e.inWeight||0;windByDL[e.dyeLotId].outKg+=e.outWeight||0;});Object.values(windByDL).forEach(v=>{const diff=v.outKg-v.inKg;const pct=v.inKg>0?((Math.abs(diff)/v.inKg)*100).toFixed(1):0;lotRows.push({label:v.dyeLotNo,shade:v.shade||'',stage:'Wind',inKg:v.inKg,outKg:v.outKg,diff,pct:parseFloat(pct),id:v.id,type:'dye'});});lotRows.sort((a,b)=>Math.abs(b.diff)-Math.abs(a.diff));const threshold=5;const _wFilter=window._wasteFilter||'issues';const _wStage=window._wasteStage||'all';let filteredLots=lotRows;if(_wFilter==='issues')filteredLots=filteredLots.filter(r=>Math.abs(r.diff)>0.01);else if(_wFilter==='loss')filteredLots=filteredLots.filter(r=>r.diff<-0.01);else if(_wFilter==='gain')filteredLots=filteredLots.filter(r=>r.diff>0.01);else if(_wFilter==='high')filteredLots=filteredLots.filter(r=>Math.abs(r.pct)>=threshold);if(_wStage!=='all')filteredLots=filteredLots.filter(r=>r.stage===_wStage);const filterBar=`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center"><span style="font-size:0.68rem;color:var(--mu);font-weight:700">Filter:</span><button class="btn btn-ghost btn-sm" style="${_wFilter==='issues'?'background:var(--ac);color:#000':''}" onclick="setWasteFilter('issues')">⚠ Issues</button><button class="btn btn-ghost btn-sm" style="${_wFilter==='loss'?'background:var(--re);color:#fff':''}" onclick="setWasteFilter('loss')">🔴 Loss only</button><button class="btn btn-ghost btn-sm" style="${_wFilter==='gain'?'background:var(--gr);color:#fff':''}" onclick="setWasteFilter('gain')">🟢 Gain only</button><button class="btn btn-ghost btn-sm" style="${_wFilter==='high'?'background:var(--ye);color:#000':''}" onclick="setWasteFilter('high')">⚠ High (≥${threshold}%)</button><select class="fs" style="max-width:120px" id="rpt-waste-stage" onchange="setWasteStage(this.value)"><option value="all" ${_wStage==='all'?'selected':''}>All Stages</option><option value="Soft" ${_wStage==='Soft'?'selected':''}>Soft</option><option value="Dye" ${_wStage==='Dye'?'selected':''}>Dye</option><option value="Wind" ${_wStage==='Wind'?'selected':''}>Wind</option></select><span style="font-size:0.68rem;color:var(--mu);margin-left:auto">${filteredLots.length} of ${lotRows.length} lots</span></div>`;lotsEl.innerHTML=filterBar+'<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:0.73rem">'
+'<thead><tr style="background:var(--s2)"><th style="padding:8px;text-align:left">Lot</th>'
+'<th style="padding:8px">Shade</th><th style="padding:8px">Stage</th>'
+'<th style="padding:8px;text-align:right">In kg</th><th style="padding:8px;text-align:right">Out kg</th>'
+'<th style="padding:8px;text-align:right">Diff kg</th><th style="padding:8px;text-align:right">%</th>'
+'</tr></thead><tbody>'
+filteredLots.map(r=>{const isGain=r.diff>=0;const isOutlier=Math.abs(r.pct)>=threshold;const col=isGain?'var(--gr)':'var(--re)';return`<tr style="border-bottom:1px solid var(--b1);${isOutlier?'background:rgba(239,68,68,0.04)':''}"><td style="padding:8px">${r.type==='dye'?`<span onclick="openDyeLifecycle('${r.id}')"style="color:var(--ac);font-weight:700;cursor:pointer;font-family:monospace">${r.label}</span>`:`<span style="font-family:monospace;font-weight:700">${r.label}</span>`}${isOutlier?' <span style="font-size:0.58rem;background:rgba(239,68,68,0.15);color:var(--re);padding:1px 4px;border-radius:3px">⚠ HIGH</span>':''}</td><td style="padding:8px;color:var(--mu);font-size:0.68rem">${r.shade}</td><td style="padding:8px;font-size:0.68rem;color:var(--mu)">${r.stage}</td><td style="padding:8px;text-align:right;font-family:monospace">${fmt(r.inKg)}</td><td style="padding:8px;text-align:right;font-family:monospace">${fmt(r.outKg)}</td><td style="padding:8px;text-align:right;font-family:monospace;font-weight:700;color:${col}">${isGain?'+':''}${fmt(r.diff)}</td><td style="padding:8px;text-align:right;font-weight:700;color:${col}">${isGain?'+':''}${r.pct}%</td></tr>`;}).join('')+'</tbody></table></div>';}
function renderReports(){const active=document.querySelector('[id^="rpt-"].tp.active,[id^="rpt-"].tab-panel.active');if(!active)return;const id=active.id;if(id==='rpt-flow')rptFlow();else if(id==='rpt-shade')rptShade();else if(id==='rpt-grade')rptGrade();else if(id==='rpt-pack')rptPack();else if(id==='rpt-waste')rptWaste();else if(id==='rpt-machine')rptMachine();else if(id==='rpt-worker')rptWorker();else if(id==='rpt-daily')rptDaily();else if(id==='rpt-control')rptControl();}


function renderMasters(){if(!State.DB.masters)State.DB.masters={vendors:[],mills:[],grades:[],machines:[],workers:[]};if(!State.DB.parties)State.DB.parties=[];renderMasterList('vendors','ms-vendor','m-vendors');renderMasterList('mills','ms-mill','m-mills');renderMasterList('grades','ms-grade','m-grades');renderMasterList('workers','ms-worker','m-workers');renderMasterList('parties','ms-party','m-parties');const _isAdminM=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';const sysBtn=document.getElementById('mt-system');if(sysBtn)sysBtn.style.display=_isAdminM?'':'none';const dmPanel=document.getElementById('data-mgmt-panel');if(dmPanel)dmPanel.style.display=_isAdminM?'':'none';const uidPanel=document.getElementById('rm-uid-panel');if(uidPanel)uidPanel.style.display=_isAdminM?'':'none';const agingWrap=document.getElementById('aging-inputs-wrap');if(agingWrap)agingWrap.style.pointerEvents=_isAdminM?'':'none',agingWrap.style.opacity=_isAdminM?'1':'0.4';const dmList=document.getElementById('data-mgmt-list');if(dmList&&_isAdminM){const _stages=[{key:'packEntries',label:'Pack Entries'},{key:'dispatches',label:'Dispatches'},{key:'partyOrders',label:'Party Orders'},{key:'windEntries',label:'Wind Entries'},{key:'stageEntries',label:'Stage Entries (Soft)'},{key:'dyeLots',label:'Dye Lots'},{key:'lots',label:'RM Lots'},];dmList.innerHTML=_stages.map(s=>`<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:var(--s2);border-radius:8px"><div><span style="font-size:0.78rem;font-weight:700">${s.label}</span><span style="font-size:0.65rem;color:var(--mu);margin-left:8px">${(State.DB[s.key]||[]).length} records</span></div><button class="btn btn-sm" style="background:rgba(239,68,68,0.12);color:var(--re);border:1px solid rgba(239,68,68,0.3)" onclick="openClearStage('${s.key}','${s.label}')">Clear All</button></div>`).join('');}
if(!State.DB.deleteRequests)State.DB.deleteRequests=[];const isAdmin=State.currentUser?.role==='manager';const reqPanel=document.getElementById('delete-requests-panel');const reqList=document.getElementById('delete-requests-list');const reqBadge=document.getElementById('delete-req-badge');const pending=(State.DB.deleteRequests||[]).filter(r=>r.status==='pending');if(reqPanel){if(isAdmin&&pending.length>0){reqPanel.style.display='block';if(reqBadge){reqBadge.textContent=pending.length+' pending';reqBadge.style.display='';}
reqList.innerHTML=pending.map(r=>`
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(239,68,68,0.15);"><div><div style="font-size:.82rem;font-weight:700;color:var(--re)">${r.val}</div><div style="font-size:.65rem;color:var(--mu)">${r.key} · Requested by ${r.by} · ${fmtTS(r.at)}</div>
            ${r.reason?`<div style="font-size:.65rem;color:var(--mu);font-style:italic">"${r.reason}"</div>`:''}
          </div><div style="display:flex;gap:6px;flex-shrink:0;margin-left:12px;"><button class="btn bs bxs" onclick="openAdminDelConfirm('${r.id}')">✓ Confirm</button><button class="btn bg bxs" onclick="rejectDeleteRequest('${r.id}')">✕ Reject</button></div></div>`).join('');}else{reqPanel.style.display='none';if(reqBadge)reqBadge.style.display='none';}}
['vendors','mills','grades','workers','parties'].forEach(k=>{const el=document.getElementById('m-'+k);if(!el)return;const list=k==='parties'?State.DB.parties:State.DB.masters[k];if(!list){el.innerHTML='<div style="color:var(--mu);font-size:.75rem;padding:5px 0">None added</div>';return;}
el.innerHTML=list.map(v=>{const hasPending=(State.DB.deleteRequests||[]).some(r=>r.key===k&&r.val===v&&r.status==='pending');const safeV=v.replace(/'/g,"\\'").replace(/"/g,'&quot;');const editBtn=isAdmin?`<button class="btn btn-ghost bxs" onclick="openMasterEdit('${k}','${safeV}')">✏</button>`:'';const delBtn=isAdmin?`<button class="btn bd bxs" onclick="openAdminDirectDelete('${k}','${safeV}')">✕</button>`:hasPending?`<span style="font-size:.6rem;color:var(--ye);padding:2px 7px;border-radius:3px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.2)">⏳</span>`:`<button class="btn bg bxs" style="color:var(--re);border-color:rgba(239,68,68,.3)" onclick="openDeleteRequest('${k}','${safeV}')">📤</button>`;return`<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--b1);"><span style="font-size:.82rem">${v}</span><div style="display:flex;gap:4px;align-items:center">${editBtn}${delBtn}</div></div>`;}).join('')||`<div style="color:var(--mu);font-size:.75rem;padding:5px 0">None added</div>`;});const mEl=document.getElementById('m-machines');if(mEl){mEl.innerHTML=State.DB.masters.machines.map(m=>{const cap=(State.DB.masters.machineCapacity||{})[m]||{maxHrs:'',maxOut:''};const hasPending=(State.DB.deleteRequests||[]).some(r=>r.key==='machines'&&r.val===m&&r.status==='pending');const delBtn=isAdmin?`<button class="btn bd bxs" onclick="openAdminDirectDelete('machines','${m}')">✕</button>`:hasPending?`<span style="font-size:.58rem;color:var(--ye)">⏳</span>`:`<button class="btn bg bxs" style="color:var(--re);border-color:rgba(239,68,68,.3);font-size:.6rem" onclick="openDeleteRequest('machines','${m}')">📤</button>`;return`<tr><td style="font-size:.8rem;font-weight:600">${m}</td><td><input class="fi" type="number" value="${cap.maxHrs||''}" placeholder="hrs" style="width:70px;padding:4px 7px;font-size:.75rem" onchange="updateMachineCap('${m}','maxHrs',+this.value)"></td><td><input class="fi" type="number" value="${cap.maxOut||''}" placeholder="units" style="width:80px;padding:4px 7px;font-size:.75rem" onchange="updateMachineCap('${m}','maxOut',+this.value)"></td><td>${delBtn}</td></tr>`;}).join('')||'<tr><td colspan="4" style="color:var(--mu);font-size:.75rem;padding:8px 0">No machines added</td></tr>';}
const dyeLotPanel=document.getElementById('masters-dye-lot-settings');if(dyeLotPanel){const fy=currentFY();const fySettings=(State.DB.masters.dyeLotSettings||[]).find(s=>s.fy===fy);const currentStart=fySettings?.startingNo||('DYE-'+fy+'-001');const isAdm2=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';dyeLotPanel.innerHTML=`
      <div style="font-size:0.78rem;color:var(--mu);margin-bottom:10px">
        Set the starting Dye Lot number for financial year <strong>${fy}</strong>. Admin only.
      </div><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><div style="font-size:0.9rem">Current: <strong style="color:var(--ac)">${currentStart}</strong></div>
        ${isAdm2?`<input type="text"id="dye-lot-start-input"value="${currentStart}"
style="width:160px;padding:6px 10px;border-radius:6px;border:1px solid var(--b2);background:var(--s2);color:var(--tx);font-size:0.85rem;font-family:monospace"><button class="btn btn-primary btn-sm"onclick="saveDyeLotStartingNo()">Save</button>`:'<span style="font-size:0.72rem;color:var(--mu)">(Admin only to change)</span>'}
      </div>`;}
const _ay=document.getElementById('aging-yellow');const _ar=document.getElementById('aging-red');if(_ay)_ay.value=(State.DB.agingThresholds?.yellow||7);if(_ar)_ar.value=(State.DB.agingThresholds?.red||15);}
function addMaster(key,inputId){const v=document.getElementById(inputId)?.value.trim();if(!v)return;if(key==='parties'){if(!State.DB.parties)State.DB.parties=[];if(!State.DB.parties.includes(v)){State.DB.parties.push(v);}}else{if(!State.DB.masters)State.DB.masters={vendors:[],mills:[],grades:[],machines:[],workers:[]};if(!State.DB.masters[key])State.DB.masters[key]=[];if(!State.DB.masters[key].includes(v))State.DB.masters[key].push(v);}
const inp=document.getElementById(inputId);if(inp)inp.value='';save(key==='parties'?'parties':'masters');renderMasters();showToast(v+' added ✓');}
function showRMTab(tab,el){document.getElementById('rm-tab-lots').style.display=tab==='lots'?'':'none';const retPanel=document.getElementById('rm-tab-return');if(retPanel)retPanel.style.display=tab==='return'?'':'none';document.querySelectorAll('#page-rm .tab').forEach(t=>t.classList.remove('active'));if(el)el.classList.add('active');if(tab==='editlog')renderRMEditLog();if(tab==='return')renderRMReturnLog();}
function openRMEdit(lotId,grade,vendor,delivIdx=0){const lot=(grade&&vendor)?getLotByKey(lotId,grade,vendor):State.DB.lots.find(l=>l.id===lotId);if(!lot||!lot.id){alert('Lot not found');return;}
const _d=(lot.deliveries||[])[delivIdx]||{units:lot.units,weight:lot.weight,date:lot.date,challan:lot.challan||''};
document.getElementById('rm-edit-original-id').value=lot.id+'||'+lot.grade+'||'+lot.vendor;
document.getElementById('rm-edit-deliv-idx').value=delivIdx;const V=State.DB.masters.vendors||[];const ML=State.DB.masters.mills||[];const G=State.DB.masters.grades||[];const mkOpts=(arr,val)=>`<option value="">Select...</option>`+arr.map(v=>`<option value="${v}"${v===val?' selected':''}>${v}</option>`).join('');document.getElementById('rm-edit-vendor').innerHTML=mkOpts(V,lot.vendor);document.getElementById('rm-edit-mill').innerHTML=mkOpts(ML,lot.mill||'');document.getElementById('rm-edit-grade').innerHTML=mkOpts(G,lot.grade);document.getElementById('rm-edit-lot').value=lot.id;document.getElementById('rm-edit-units').value=_d.units||lot.units;document.getElementById('rm-edit-weight').value=_d.weight||lot.weight;document.getElementById('rm-edit-date').value=_d.date||lot.date||'';document.getElementById('rm-edit-challan').value=_d.challan||lot.challan||'';document.getElementById('rm-edit-reason').value='';document.getElementById('rm-edit-pwd').value='';document.getElementById('rm-edit-alert').innerHTML='';openModal('rm-edit-modal');}
async function submitRMEdit(){
  // Jul 14 2026 — Item A cutover. This used to run the entire edit cascade
  // client-side (conflict check, Soft-consumption validation, cascade rename
  // across 4 tables with loose matching). All of that now lives in worker.js
  // (POST /api/rm/edit), strict-matched and committed atomically. This
  // function is now just: read the form, do a quick client-side pre-flight
  // (required fields, password), call the server, show the result.
  const _origKey=document.getElementById('rm-edit-original-id').value;const _origParts=_origKey.split('||');const originalId=_origParts[0];const originalGrade=_origParts[1]||'';const originalVendor=_origParts[2]||'';
  const newLotId=document.getElementById('rm-edit-lot').value.trim();const vendor=document.getElementById('rm-edit-vendor').value;const mill=document.getElementById('rm-edit-mill').value;const grade=document.getElementById('rm-edit-grade').value;const units=parseFloat(document.getElementById('rm-edit-units').value)||0;const weight=parseFloat(document.getElementById('rm-edit-weight').value)||0;const date=document.getElementById('rm-edit-date').value;const challan=document.getElementById('rm-edit-challan').value.trim();const reason=document.getElementById('rm-edit-reason').value.trim();const pwd=document.getElementById('rm-edit-pwd').value;
  if(!reason){setAlert('rm-edit-alert','Reason for edit is required','alert-err');return;}
  if(!pwd){setAlert('rm-edit-alert','Password is required','alert-err');return;}
  if(!newLotId||!vendor||!mill||!grade||!units){setAlert('rm-edit-alert','Fill all required fields','alert-err');return;}
  const matched=await _verifyPasswordViaWorker(pwd,State.currentUser?.username);
  if(!matched){setAlert('rm-edit-alert','Incorrect password','alert-err');document.getElementById('rm-edit-pwd').value='';return;}
  const _delivIdx=parseInt(document.getElementById('rm-edit-deliv-idx').value)||0;
  const _btn=document.getElementById('rm-edit-submit-btn');if(_btn)_btn.disabled=true;
  try{
    const {ok,data,error,networkError}=await apiPost('/api/rm/edit',{originalId,originalGrade,originalVendor,newLotId,vendor,mill,grade,units,weight,date,challan,reason,delivIdx:_delivIdx,changedBy:State.currentUser.name});
  if(networkError)throw new Error(error);
  if(!ok){setAlert('rm-edit-alert',error||'Edit failed','alert-err');if(_btn)_btn.disabled=false;return;}
    closeModal('rm-edit-modal');showToast(data.type==='split'?'Delivery split to '+newLotId+' \u2713':'Lot updated \u2713');renderAll();
  }catch(e){setAlert('rm-edit-alert','Network error \u2014 edit not saved: '+e.message,'alert-err');if(_btn)_btn.disabled=false;}
}

async function voidRMDelivery(lotId,grade,vendor,delivIdx){
  const lot=getLotByKey(lotId,grade,vendor)||State.DB.lots.find(l=>l.id===lotId&&l.grade===grade&&l.vendor===vendor);
  if(!lot){showToast('Lot not found','err');return;}
  const delivs=lot.deliveries||[];
  if(delivs.length<=1){
    // Only 1 delivery — void the whole lot
    openVoidModal(lotId,'rm');return;
  }
  if(!confirm(`Void Delivery ${delivIdx+1} (${fmt(delivs[delivIdx]?.weight||0)}kg) from ${lotId}? This cannot be undone.`))return;
  const reason=prompt('Reason for voiding this delivery (optional but recommended):')||'';
  const pwd=prompt('Enter your password to confirm:');
  if(!pwd){showToast('Void cancelled — password required','err');return;}
  // Jul 24 2026 fix — this used to splice the delivery out and recompute
  // lot.units/lot.weight entirely client-side, with no lock and no check
  // for whether Soft stage had already consumed the material. Now a single
  // server call: locked, atomic, and validated the same way handleRMEdit
  // already validates a total reduction.
  try{
    const {ok,data,error,networkError}=await apiPost('/api/rm/void-delivery',{lotId,grade,vendor,delivIdx,reason,password:pwd,username:State.currentUser?.username,changedBy:State.currentUser?.name});
    if(networkError)throw new Error(error);
    if(!ok){showToast(error||'Could not void delivery','err');return;}
    showToast(`Delivery ${delivIdx+1} voided ✓`);renderAll();
  }catch(e){showToast('Network error — not voided: '+e.message,'err');}
}


function renderRMEditLog(){const log=[...(State.DB.editLog||[]).filter(e=>e.entryType==='rm'||e.originalLotId)].reverse();const el=document.getElementById('rm-editlog-content');if(!el)return;if(!log.length){el.innerHTML='<div class="empty empty-text" style="padding:20px">✓ No edits on record — all entries are original</div>';return;}
el.innerHTML=`<div class="tbl"><table><thead><tr><th>Time</th><th>Lot</th><th>Changed By</th><th>Reason</th><th>What Changed</th></tr></thead><tbody>${log.map(e=>{
      const changes=[];
      Object.keys(e.after||{}).forEach(k=>{
        if(String(e.before[k])!==String(e.after[k])){
          changes.push(`<span style="color:var(--mu)">${k}:</span><span style="color:var(--re);text-decoration:line-through">${e.before[k]||'—'}</span>→<span style="color:var(--gr)">${e.after[k]||'—'}</span>`);
        }
      });
      return `<tr><td class="mono"style="font-size:0.65rem;white-space:nowrap">${fmtTS(e.at)}</td><td class="mono">${e.originalLotId}${e.currentLotId!==e.originalLotId?` → ${e.currentLotId}`:''}</td><td style="font-size:0.72rem">${e.by}<span style="color:var(--mu)">(${e.role})</span></td><td style="font-size:0.72rem;color:var(--mu);font-style:italic;max-width:180px">"${e.reason}"</td><td style="font-size:0.72rem;line-height:1.8">${changes.join('<br>')||'—'}</td></tr>`;
    }).join('')}</tbody></table></div>`;}
export function setupRMEditLogTab(){}
function openDeleteRequest(key,val){document.getElementById('del-req-key').value=key;document.getElementById('del-req-val').value=val;document.getElementById('del-req-item-name').textContent=val;document.getElementById('del-req-item-type').textContent=key.charAt(0).toUpperCase()+key.slice(1);document.getElementById('del-req-reason').value='';document.getElementById('del-req-alert').innerHTML='';openModal('del-req-modal');}
async function submitDeleteRequest(){const key=document.getElementById('del-req-key').value;const val=document.getElementById('del-req-val').value;const reason=document.getElementById('del-req-reason').value.trim();if(!key||!val){setAlert('del-req-alert','Invalid request','alert-err');return;}
try{const {ok,error,networkError}=await apiPost('/api/delete-request',{action:'create',key,val,reason,changedBy:State.currentUser?.name});if(networkError)throw new Error(error);if(!ok){setAlert('del-req-alert',error||'Could not send request','alert-err');return;}closeModal('del-req-modal');renderMasters();showToast('Delete request sent to admin ✓');}catch(e){setAlert('del-req-alert','Network error — '+e.message,'alert-err');}}
function openAdminDirectDelete(key,val){document.getElementById('admin-del-req-id').value='direct__'+key+'__'+val;document.getElementById('admin-del-by').textContent='Direct delete by admin';document.getElementById('admin-del-reason-show').textContent=key+': '+val;document.getElementById('admin-del-pwd').value='';document.getElementById('admin-del-alert').innerHTML='';openModal('admin-del-modal');}
function openAdminDelConfirm(reqId){const req=(State.DB.deleteRequests||[]).find(r=>r.id===reqId);if(!req)return;document.getElementById('admin-del-req-id').value=reqId;document.getElementById('admin-del-by').textContent=req.by+' · '+fmtTS(req.at);document.getElementById('admin-del-reason-show').textContent=req.key+': '+req.val+(req.reason?' — "'+req.reason+'"':'');document.getElementById('admin-del-pwd').value='';document.getElementById('admin-del-alert').innerHTML='';openModal('admin-del-modal');}
async function confirmMasterDelete(){const pwd=document.getElementById('admin-del-pwd').value;const reqId=document.getElementById('admin-del-req-id').value;
let key,val,deleteRequestId=null;
if(reqId.startsWith('direct__')){const parts=reqId.split('__');key=parts[1];val=parts[2];}
else{const req=(State.DB.deleteRequests||[]).find(r=>r.id===reqId);if(!req){setAlert('admin-del-alert','Request not found','alert-err');return;}
key=req.key;val=req.val;deleteRequestId=reqId;}
try{
  const {ok,data,error,networkError}=await apiPost('/api/master-item/delete',{key,val,password:pwd,deleteRequestId,changedBy:State.currentUser.name});
  if(networkError)throw new Error(error);
  if(!ok){setAlert('admin-del-alert',error||'Could not delete','alert-err');document.getElementById('admin-del-pwd').value='';return;}
  closeModal('admin-del-modal');showToast(val+' deleted ✓');renderMasters();
}catch(e){setAlert('admin-del-alert','Network error — not deleted: '+e.message,'alert-err');}
}
async function rejectDeleteRequest(reqId){if(!reqId){closeModal('admin-del-modal');return;}
try{const {ok,error,networkError}=await apiPost('/api/delete-request',{action:'reject',reqId,changedBy:State.currentUser?.name,role:State.currentUser?.role});if(networkError)throw new Error(error);if(!ok){showToast(error||'Could not reject','err');return;}closeModal('admin-del-modal');renderMasters();showToast('Request rejected');}catch(e){showToast('Network error — '+e.message,'err');}}
export function populateSelects(){const V=State.DB.masters.vendors;const ML=State.DB.masters.mills;const G=State.DB.masters.grades;const M=State.DB.masters.machines;const W=State.DB.masters.workers;const opts=(arr,empty='Select...')=>`<option value="">${empty}</option>${arr.map(v=>`<option value="${v}">${v}</option>`).join('')}`;const setEl=(id,h)=>{const el=document.getElementById(id);if(el)el.innerHTML=h;};setEl('m-rm-vendor',opts(V));setEl('m-rm-mill',opts(ML));setEl('m-rm-grade',opts(G));setEl('m-dye-grade',`<option value="">Select Grade</option>${[...new Set(State.DB.lots.map(l=>l.grade))].map(g=>`<option value="${g}">${g}</option>`).join('')}`);setEl('m-dye-machine',opts(M));setEl('m-dye-worker',opts(W));populatePartySelect();['m-rm-date','m-dye-date','m-disp-date'].forEach(id=>{const el=document.getElementById(id);if(el&&!el.value)el.value=today();});}
async function changeUserPasswordAdmin(uid,newPassword){if(!uid||!newPassword){showToast('Missing uid or password','err');return;}
if(newPassword.length<6){showToast('Password min 6 characters','err');return;}
try{const {ok,data,error,networkError}=await apiPost('/api/users/reset-password',{id:uid,newPassword});
  if(networkError)throw new Error(error);
  if(!ok){showToast(error||'Could not change password','err');return;}
if(State.currentUser&&State.currentUser.id===uid){State.currentUser=data.user;window.currentUser=State.currentUser;sessionStorage.setItem('tcv2_session',JSON.stringify(State.currentUser));}
showToast('Password changed ✓');closeModal('change-pw-modal');}catch(e){console.error('[Users] Password reset failed:',e);showToast('Could not reach server','err');}}
function openChangePwModal(uid,name){if(State.currentUser?.role!=='admin'&&State.currentUser?.role!=='manager'){showToast('Admin only','err');return;}
document.getElementById('cpw-uid').value=uid;document.getElementById('cpw-name').textContent=name;document.getElementById('cpw-input').value='';document.getElementById('cpw-alert').innerHTML='';openModal('change-pw-modal');}
async function checkRMUidStatus(){
  const el=document.getElementById('rm-uid-status');if(!el)return;
  el.textContent='Checking...';
  try{
    const res=await fetch(WORKER_URL+'/api/admin/verify-rm-uids',{headers:_getHeaders()});
    const data=await res.json();
    if(!res.ok||!data.success){el.innerHTML='<span style="color:var(--re)">Could not check status</span>';return;}
    if(data.complete){
      el.innerHTML=`<span style="color:var(--gr)">✓ Complete — all ${data.totalLots} lots have a permanent ID, no duplicates</span>`;
    }else{
      el.innerHTML=`<span style="color:var(--ye)">${data.lotsWithUid} of ${data.totalLots} lots done, ${data.lotsWithoutUid} still need migrating${data.duplicateUidsFound>0?` — ⚠ ${data.duplicateUidsFound} duplicate(s) found, needs attention`:''}</span>`;
    }
  }catch(e){el.innerHTML='<span style="color:var(--re)">Network error — '+e.message+'</span>';}
}
async function runRMUidMigration(){
  if(!confirm('Run the RM permanent-ID migration? This is safe and additive — it only adds a new internal ID to lots that don\'t have one yet. Nothing else changes. Safe to run more than once.'))return;
  const el=document.getElementById('rm-uid-status');if(!el)return;
  let totalMigrated=0,rounds=0;
  try{
    while(rounds<20){
      el.innerHTML=`Migrating... (${totalMigrated} done so far)`;
      const res=await fetch(WORKER_URL+'/api/admin/migrate-rm-uids',{method:'POST',headers:_postHeaders(),body:JSON.stringify({batchSize:100})});
      const data=await res.json();
      if(!res.ok||!data.success){el.innerHTML='<span style="color:var(--re)">Migration failed: '+(data.error||'unknown error')+'</span>';return;}
      totalMigrated+=data.migrated||0;
      rounds++;
      if(data.alreadyDone||data.remaining===0)break;
    }
    showToast('Migration complete ✓ — '+totalMigrated+' lot(s) migrated');
    await checkRMUidStatus();
  }catch(e){el.innerHTML='<span style="color:var(--re)">Network error — not completed: '+e.message+'</span>';}
}
async function checkOrphanedLots(){
  const section=document.getElementById('rm-uid-orphan-section');if(section)section.style.display='';
  const el=document.getElementById('rm-uid-orphan-status');if(!el)return;
  el.textContent='Checking...';
  try{
    const res=await fetch(WORKER_URL+'/api/admin/cleanup-orphaned-lots',{method:'POST',headers:_postHeaders(),body:JSON.stringify({dryRun:true})});
    const data=await res.json();
    if(!res.ok||!data.success){el.innerHTML='<span style="color:var(--re)">Could not check</span>';return;}
    if(data.orphansFound===0){
      el.innerHTML='<span style="color:var(--gr)">✓ None found — nothing to clean up</span>';
    }else{
      el.innerHTML=`<span style="color:var(--ye)">Found ${data.orphansFound} leftover record(s)</span> <button class="btn btn-danger btn-sm" style="margin-left:8px" onclick="cleanupOrphanedLots()">🗑 Remove ${data.orphansFound} Leftover Record(s)</button>`;
    }
  }catch(e){el.innerHTML='<span style="color:var(--re)">Network error — '+e.message+'</span>';}
}
async function cleanupOrphanedLots(){
  if(!confirm('Remove these leftover records? They contain no real lot data — only an internal ID from an earlier, since-fixed bug. Your real lots are never touched by this.'))return;
  const el=document.getElementById('rm-uid-orphan-status');if(!el)return;
  el.textContent='Removing...';
  try{
    const res=await fetch(WORKER_URL+'/api/admin/cleanup-orphaned-lots',{method:'POST',headers:_postHeaders(),body:JSON.stringify({dryRun:false})});
    const data=await res.json();
    if(!res.ok||!data.success){el.innerHTML='<span style="color:var(--re)">Cleanup failed: '+(data.error||'unknown error')+'</span>';return;}
    showToast('✓ Removed '+data.deleted+' leftover record(s)');
    el.innerHTML='<span style="color:var(--gr)">✓ Cleaned up '+data.deleted+' record(s)</span>';
    await checkRMUidStatus();
  }catch(e){el.innerHTML='<span style="color:var(--re)">Network error — not completed: '+e.message+'</span>';}
}
function openClearStage(key,label){if(State.currentUser?.role!=='admin'&&State.currentUser?.role!=='manager'){showToast('Admin only','err');return;}
document.getElementById('clear-stage-key').value=key;document.getElementById('clear-stage-label').textContent='Collection: '+label;document.getElementById('clear-stage-confirm-text').value='';document.getElementById('clear-stage-password').value='';document.getElementById('clear-stage-alert').innerHTML='';openModal('clear-stage-modal');}
async function executeClearStage(){const key=document.getElementById('clear-stage-key').value;const confirmText=document.getElementById('clear-stage-confirm-text').value.trim();const pwd=document.getElementById('clear-stage-password').value;const alertEl=document.getElementById('clear-stage-alert');if(confirmText!=='CONFIRM'){alertEl.innerHTML='<div class="alert alert-err" style="margin-bottom:10px">Type CONFIRM exactly</div>';return;}
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
function openLinkOrder(dispId){const d=(State.DB.dispatches||[]).find(x=>x.id===dispId);if(!d){showToast('Dispatch not found','err');return;}
document.getElementById('lo-disp-id').value=dispId;document.getElementById('lo-alert').innerHTML='';document.getElementById('lo-order-detail').textContent='';const shade=(d.shade||'').trim().toLowerCase();const openOrders=(State.DB.partyOrders||[]).filter(o=>o.party===d.party&&(o.shade||'').trim().toLowerCase()===shade&&o.status!=='Cancelled').sort((a,b)=>(a.date||'').localeCompare(b.date||''));const sel=document.getElementById('lo-order-select');sel.innerHTML='<option value="">Select order...</option>'+openOrders.map(o=>`<option value="${o.id}">${o.id} · ${o.shade} · ${fmt(o.qtyOrdered)}kg · ${o.date} [${o.status}]</option>`).join('');sel.onchange=function(){const o=openOrders.find(x=>x.id===sel.value);document.getElementById('lo-order-detail').textContent=o?`Ordered: ${fmt(o.qtyOrdered)}kg · Fulfilled: ${fmt(o.qtyFulfilled||0)}kg · Balance: ${fmt((o.qtyOrdered||0)-(o.qtyFulfilled||0))}kg`:''};if(!openOrders.length)sel.innerHTML=`<option value="">No orders found for ${d.party} + shade ${d.shade}. Create an order in Party Tracker first.</option>`;openModal('link-order-modal-overlay');}
async function submitLinkOrder(){const dispId=document.getElementById('lo-disp-id').value;const orderId=document.getElementById('lo-order-select').value;if(!orderId){setAlert('lo-alert','Select an order','alert-err');return;}
try{const {ok,error,networkError}=await apiPost('/api/dispatch/link-order',{dispId,orderId,role:State.currentUser?.role});if(networkError)throw new Error(error);if(!ok){setAlert('lo-alert',error||'Could not link order','alert-err');return;}closeModal('link-order-modal-overlay');showToast('Order linked ✓');renderAll();}catch(e){setAlert('lo-alert','Network error — '+e.message,'alert-err');}}
function renderDispatch(){const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';const isSup=State.currentUser?.role==='supervisor'||isAdmin;const fl=document.getElementById('dispf-lot')?.value||'';const fp=document.getElementById('dispf-party')?.value||'';const fs=document.getElementById('dispf-shade')?.value||'';const fg=document.getElementById('dispf-grade')?.value||'';const fi=document.getElementById('dispf-invoice')?.value||'';const allDisp=State.DB.dispatches||[];const allDye=State.DB.dyeLots||[];const getEff=d=>{const rdl=allDye.find(dl=>dl.id===d.dyeLotId);return{lot:d.dyeLotNo||rdl?.dyeLotNo||'',shade:d.shade||rdl?.shade||'',grade:d.grade||'',party:d.party||''};};const dlots=[...new Set(allDisp.filter(d=>{const eff=getEff(d);return(!fp||eff.party===fp)&&(!fs||eff.shade===fs)&&(!fg||eff.grade===fg)&&(!fi||(d.invoiceNo||'')===fi);}).map(d=>getEff(d).lot).filter(Boolean))].sort((a,b)=>b.localeCompare(a));const dparties=[...new Set(allDisp.filter(d=>{const eff=getEff(d);return(!fl||eff.lot===fl)&&(!fs||eff.shade===fs)&&(!fg||eff.grade===fg)&&(!fi||(d.invoiceNo||'')===fi);}).map(d=>getEff(d).party).filter(Boolean))].sort();const dshades=[...new Set(allDisp.filter(d=>{const eff=getEff(d);return(!fl||eff.lot===fl)&&(!fp||eff.party===fp)&&(!fg||eff.grade===fg)&&(!fi||(d.invoiceNo||'')===fi);}).map(d=>getEff(d).shade).filter(Boolean))].sort();const dgrades=[...new Set(allDisp.filter(d=>{const eff=getEff(d);return(!fl||eff.lot===fl)&&(!fp||eff.party===fp)&&(!fs||eff.shade===fs)&&(!fi||(d.invoiceNo||'')===fi);}).map(d=>getEff(d).grade).filter(Boolean))].sort();const dinvoices=[...new Set(allDisp.filter(d=>{const eff=getEff(d);return(!fl||eff.lot===fl)&&(!fp||eff.party===fp)&&(!fs||eff.shade===fs)&&(!fg||eff.grade===fg);}).map(d=>d.invoiceNo||'').filter(Boolean))].sort();const dstatuses=[...new Set(allDisp.map(d=>d.status).filter(Boolean))].sort();const _th=document.getElementById('disp-thead');if(_th){_th.innerHTML=`
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
        <th>Actions</th></tr>`;if(fl)document.getElementById('dispf-lot').value=fl;if(fp)document.getElementById('dispf-party').value=fp;if(fs)document.getElementById('dispf-shade').value=fs;if(fg)document.getElementById('dispf-grade').value=fg;if(fi)document.getElementById('dispf-invoice').value=fi;_restoreFilterBtns('dispf-lot','dispf-party','dispf-shade','dispf-grade','dispf-invoice','dispf-status');}
let filtered=(State.DB.dispatches||[]).filter(d=>{const _rDl=(State.DB.dyeLots||[]).find(dl=>dl.id===d.dyeLotId);const _rNo=d.dyeLotNo||_rDl?.dyeLotNo||'';const _rSh=d.shade||_rDl?.shade||'';return(!fl||_rNo===fl)&&(!fp||d.party===fp)&&(!fs||_rSh===fs)&&(!fg||d.grade===fg)&&(!fi||(d.invoiceNo||'')===fi);});const sorted=_sortState.disp?.col?sortArr(filtered,_sortState.disp.col,_sortState.disp.dir):[...filtered].sort((a,b)=>(b.timestamp||'').localeCompare(a.timestamp||''));const tbody=document.getElementById('disp-tbody');if(!tbody)return;if(!sorted.length){tbody.innerHTML='<tr><td colspan="12"><div class="empty"><div class="empty-icon">&#x1F69A;</div><div class="empty-text">✕ No dispatches yet — pack a lot first</div></div></td></tr>';return;}
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
${(d.status==='Rejected'||d.status==='Voided')&&isAdmin?`<button class="btn btn-success btn-xs"onclick="openOverride('${d.id}','dispatch')">↩ Override</button><button class="btn btn-ghost btn-xs tc-tip" data-tip="Void" style="color:var(--re)" onclick="openVoidEntry('${d.id}','dispatch')">🗑</button>`:''}
${(isSup||isAdmin)&&!d.orderId?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Link to Order" style="color:var(--re)" onclick="openLinkOrder('${d.id}')">🔗</button>`:''}
</td>
</tr>`;
}).join('');setTimeout(fitBevTableHeight,0);}
function showLoadingOverlay(){}
function hideLoadingOverlay(){const ld=document.getElementById("fb-loading");if(ld)ld.remove();}
function navToParty(el){const party=el.getAttribute('data-party');if(!party)return;nav('party',document.getElementById('ni-party'));setTimeout(()=>{const s=document.getElementById('pt-party-filter');if(s){s.value=party;renderPartyTracker();}},200);}
function searchNavTo(page,filters){nav(page,document.getElementById('ni-'+page));setTimeout(()=>{Object.entries(filters).forEach(([id,val])=>{const el=document.getElementById(id);if(el)el.value=val;_tableFilters[id]=val;});if(page==='stage')renderStageTable();else if(page==='dye')renderDyeTable();else if(page==='wind')renderWindTable();else if(page==='pack')renderPackTable();else if(page==='dispatch')renderDispatch();else if(page==='rm')renderRMTable();else if(page==='party')renderPartyTracker();else if(page==='vendor'){State.vtSelectedVendor=Object.values(filters)[0];vtSelectVendor();}},200);}
window.searchNavTo=searchNavTo;
function renderSearch(){const q=(document.getElementById('global-search-input')?.value||'').trim().toLowerCase();const el=document.getElementById('search-results');if(!el)return;if(!q||q.length<2){el.innerHTML='<div style="text-align:center;padding:60px 20px;color:var(--mu)"><div style="font-size:2rem;margin-bottom:12px">🔎</div><div style="font-size:0.85rem">Type at least 2 characters to search</div></div>';return;}
const results=[];const isLotSearch=/^[0-9]+$/.test(q)||q.startsWith('dye')||q.startsWith('se-');const isDyeLotSearch=q.startsWith('dye');(State.DB.lots||[]).forEach(l=>{if((l.id||'').toLowerCase().includes(q)||(l.vendor||'').toLowerCase().includes(q)||(l.grade||'').toLowerCase().includes(q)){const status=(()=>{const sfWt=getSoftBalanceWeight(l.id,l.grade,l.vendor);const rmBal=getRMBalance(l.id,l.grade,l.vendor);const sentDye=getSoftConsumedByDye(l.id,l.grade,l.vendor);return sentDye>0?'At Dye':sfWt>0?'At Soft':rmBal.units>0?'At RM':'Completed';})();const matchedByVendor=(l.vendor||'').toLowerCase().includes(q);results.push({type:'rm',label:'RM Lot',id:l.id,title:l.id,sub:l.vendor+' · '+l.grade,status,color:'var(--cr)',action:`searchNavTo('rm',{'rmf-lot':'${(l.id||'').replace(/'/g,"\\'")}'})`});}});(State.DB.dyeLots||[]).forEach(d=>{if((d.dyeLotNo||'').toLowerCase().includes(q)||(d.shade||'').toLowerCase().includes(q)){results.push({type:'dye',label:'Dye Lot',id:d.id,title:d.dyeLotNo,sub:(d.shade||'')+(d.grade?' · '+d.grade:''),status:d.status,color:'var(--cd)',action:`searchNavTo('dye',{'dyef-lotno':'${(d.dyeLotNo||'').replace(/'/g,"\'")}'})`});}});const vendors=[...new Set((State.DB.lots||[]).map(l=>l.vendor).filter(Boolean))];vendors.forEach(v=>{if(v.toLowerCase().includes(q)){const count=(State.DB.lots||[]).filter(l=>l.vendor===v).length;results.push({type:'vendor',label:'Vendor',id:'v-'+v,title:v,sub:count+' RM lots',status:'',color:'var(--mu)',action:`searchNavTo('rm',{'rmf-vendor':'${v.replace(/'/g,"\'")}'})`});}});const parties=[...new Set((State.DB.dispatches||[]).map(d=>d.party).filter(Boolean))];parties.forEach(p=>{if(p.toLowerCase().includes(q)){const kg=(State.DB.dispatches||[]).filter(d=>d.party===p&&(d.status==='Approved'||d.status==='Edited-Approved')).reduce((a,d)=>a+(d.weight||0),0);results.push({type:'party',label:'Party',id:'p-'+p,title:p,sub:fmt(kg)+'kg dispatched',status:'',color:'var(--gr)',action:`searchNavTo('party',{'pt-party-filter':'${p.replace(/'/g,"\'")}'})`});}});(State.DB.stageEntries||[]).filter(e=>(e.lotId||'').toLowerCase().includes(q)||(e.vendor||'').toLowerCase().includes(q)||(e.grade||'').toLowerCase().includes(q)).slice(0,8).forEach(e=>{const matchedByVendor=(e.vendor||'').toLowerCase().includes(q)&&!(e.lotId||'').toLowerCase().includes(q);const filterKey=matchedByVendor?'sef-vendor':'sef-lot';const filterVal=matchedByVendor?(e.vendor||''):e.lotId;results.push({type:'soft',label:'Soft Entry',id:e.id,title:'Lot '+e.lotId,sub:(e.vendor||'—')+' · '+e.grade+' · '+e.status,status:e.status,color:'var(--cs)',action:`searchNavTo('stage',{'${filterKey}':'${filterVal.replace(/'/g,"\'")}'})`});});(State.DB.windEntries||[]).filter(e=>(e.dyeLotNo||'').toLowerCase().includes(q)||(e.shade||'').toLowerCase().includes(q)).slice(0,5).forEach(e=>{results.push({type:'wind',label:'Wind Entry',id:e.id,title:e.dyeLotNo||'—',sub:(e.shade||'')+(e.inCones?' · '+e.inCones+'c in':''),status:e.status,color:'var(--cw)',action:`searchNavTo('wind',{'windf-lot':'${(e.dyeLotNo||'').replace(/'/g,"\'")}'})`});});(State.DB.packEntries||[]).filter(e=>(e.dyeLotNo||'').toLowerCase().includes(q)||(e.shade||'').toLowerCase().includes(q)||(e.party||'').toLowerCase().includes(q)).slice(0,5).forEach(e=>{const matchedByParty=(e.party||'').toLowerCase().includes(q)&&!(e.dyeLotNo||'').toLowerCase().includes(q);const filterKey=matchedByParty?'packf-party':'packf-lot';const filterVal=matchedByParty?(e.party||''):(e.dyeLotNo||'');results.push({type:'pack',label:'Pack Entry',id:e.id,title:e.dyeLotNo||'—',sub:(e.shade||'')+(e.bags?' · '+e.bags+'b':'')+' · '+e.status,status:e.status,color:'var(--cp)',action:`searchNavTo('pack',{'${filterKey}':'${filterVal.replace(/'/g,"\'")}'})`});});(State.DB.dispatches||[]).filter(d=>(d.party||'').toLowerCase().includes(q)||(d.dyeLotNo||'').toLowerCase().includes(q)||(d.shade||'').toLowerCase().includes(q)).slice(0,5).forEach(d=>{const matchedByParty=(d.party||'').toLowerCase().includes(q);const filterKey=matchedByParty?'dispf-party':'dispf-lot';const filterVal=matchedByParty?(d.party||''):(d.dyeLotNo||'');results.push({type:'dispatch',label:'Dispatch',id:d.id,title:d.party,sub:(d.dyeLotNo||'')+(d.shade?' · '+d.shade:'')+'  '+fmt(d.bags||0)+'b / '+fmt(d.weight||0)+'kg',status:d.status,color:'var(--gr)',action:`searchNavTo('dispatch',{'${filterKey}':'${filterVal.replace(/'/g,"\'")}'})`});});if(!results.length){
  const _archiveSearched=(State._archiveSearchedFor||{})[q];
  el.innerHTML='<div style="text-align:center;padding:60px 20px;color:var(--mu)"><div style="font-size:2rem;margin-bottom:12px">😶</div><div style="font-size:0.85rem">No results found for "'+q+'" in active data</div>'+
  (!_archiveSearched?'<div style="margin-top:16px"><button class="btn btn-ghost btn-sm" onclick="_searchArchive(\''+q.replace(/'/g,"\\'")+'\',()=>{renderSearch();})" style="font-size:0.8rem">🔍 Search in History (archived lots)</button></div>':'<div style="font-size:0.75rem;margin-top:8px;color:var(--mu)">History also searched — no results found</div>')+
  '</div>';
  return;
}
const groups={};const order=['rm','dye','vendor','party','soft','wind','pack','dispatch'];const groupLabels={rm:'RM Lots',dye:'Dye Lots',vendor:'Vendors',party:'Parties',soft:'Soft Entries',wind:'Wind Entries',pack:'Pack Entries',dispatch:'Dispatches'};results.forEach(r=>{if(!groups[r.type])groups[r.type]=[];groups[r.type].push(r);});el.innerHTML=order.filter(k=>groups[k]).map(k=>`
    <div style="margin-bottom:20px"><div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--mu);margin-bottom:8px;padding:0 4px">${groupLabels[k]} <span style="color:var(--ac)">(${groups[k].length})</span></div>
      ${groups[k].map(r=>`<div onclick="${r.action}"style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--s2);border-radius:8px;margin-bottom:6px;cursor:pointer;border:1px solid var(--b1);transition:all 0.15s"
onmouseover="this.style.borderColor='var(--ac)';this.style.background='var(--s3)'"
onmouseout="this.style.borderColor='var(--b1)';this.style.background='var(--s2)'"><div style="display:flex;align-items:center;gap:12px"><div style="width:6px;height:36px;border-radius:3px;background:${r.color};flex-shrink:0"></div><div><div style="font-weight:700;font-size:0.85rem">${r.title}</div><div style="font-size:0.72rem;color:var(--mu);margin-top:2px">${r.sub}</div></div></div><div style="text-align:right"><div style="font-size:0.62rem;color:var(--mu);background:var(--s1);padding:2px 8px;border-radius:10px">${r.label}</div>${r.status?`<div style="font-size:0.65rem;margin-top:4px;color:${r.status==='Approved'||r.status==='Edited-Approved'?'var(--gr)':r.status==='Pending'?'var(--ye)':r.status==='Void'?'var(--re)':'var(--mu)'}">${r.status}</div>`:''}</div></div>`).join('')}
    </div>
  `).join('');}
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();nav('search',document.getElementById('ni-search'));setTimeout(()=>document.getElementById('global-search-input')?.focus(),100);}});






function _applyIntegrityFix(iss){const dyeLotMap={};(State.DB.dyeLots||[]).forEach(d=>{dyeLotMap[d.id]=d;});const actual=dyeLotMap[iss.dyeLotId];if(!actual)return;if(iss.stage==='Wind'){const e=(State.DB.windEntries||[]).find(x=>x.id===iss.entryId);if(e)e.dyeLotNo=actual.dyeLotNo;}else if(iss.stage==='Pack'){const e=(State.DB.packEntries||[]).find(x=>x.id===iss.entryId);if(e)e.dyeLotNo=actual.dyeLotNo;}else if(iss.stage==='Dispatch'){const e=(State.DB.dispatches||[]).find(x=>x.id===iss.entryId);if(e)e.dyeLotNo=actual.dyeLotNo;}}
function switchMasterTab(tab,el){document.querySelectorAll('.master-panel').forEach(p=>p.style.display='none');document.querySelectorAll('[id^="mt-"]').forEach(b=>b.classList.remove('active-appr-tab'));const panel=document.getElementById('mp-'+tab);if(panel)panel.style.display='block';if(el)el.classList.add('active-appr-tab');if(tab==='system'){const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';if(!isAdmin){switchMasterTab('vendors',document.getElementById('mt-vendors'));return;}}
renderMasters();}
function _masterListSource(key){return key==='parties'?(State.DB.parties||[]):((State.DB.masters||{})[key]||[]);}
function renderMasterList(key,searchId,listId){const q=(document.getElementById(searchId)?.value||'').toLowerCase().trim();const el=document.getElementById(listId);if(!el)return;const items=_masterListSource(key).filter(v=>!q||v.toLowerCase().includes(q));if(!items.length){el.innerHTML='<div style="color:var(--mu);font-size:0.75rem;padding:8px 0">No items found</div>';return;}
const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';el.innerHTML=items.map(v=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--b1)"><span style="font-size:0.82rem">${v}</span>
      ${isAdmin?`<button onclick="deleteMasterItem('${key}','${v.replace(/'/g,"\'")}');renderMasterList('${key}','${searchId}','${listId}')" style="background:none;border:none;cursor:pointer;color:var(--re);font-size:0.75rem;padding:2px 6px">✕</button>`:''}
    </div>
  `).join('');}
async function deleteMasterItem(key,val){
// Jul 24 2026 fix — this used to write directly (splice + save()), no
// password, no server check — even though a password-protected server
// endpoint for exactly this already existed (handleMasterItemDelete,
// used by the "official" admin-direct-delete path). This was a second,
// unprotected door to the same action. Now uses the same existing,
// already-tested endpoint instead of building a new one.
const pwd=prompt('Enter your admin password to confirm deleting "'+val+'":');
if(!pwd){showToast('Delete cancelled — password required','err');return;}
try{
  const {ok,error,networkError}=await apiPost('/api/master-item/delete',{key,val,password:pwd,changedBy:State.currentUser?.name});
  if(networkError)throw new Error(error);
  if(!ok){showToast(error||'Could not delete','err');return;}
  showToast(val+' removed');renderMasters();
}catch(e){showToast('Network error — not deleted: '+e.message,'err');}
}
function switchEditLogTab(tab,el){['log','integrity'].forEach(t=>{const p=document.getElementById('elp-'+t);if(p)p.style.display=t===tab?'block':'none';});document.querySelectorAll('[id^="elt-"]').forEach(b=>b.classList.remove('active-appr-tab'));if(el)el.classList.add('active-appr-tab');if(tab==='log')renderEditLog();if(tab==='integrity')loadDailyCheckReport();}
// ─── Daily Balance Checker — client side (Jul 17 2026) ─────────────────────
// Renders the table exactly as finalized: Stage / Lot No / Vendor / Grade /
// Shade / Field / Live / Check 1 / Check 2 / What's Wrong. One row per real
// mismatch — clean fields never show a row. Jul 18 2026 — the separate
// Balance Audit tool this was originally built alongside has been removed;
// this checker does the same recompute check plus an independent
// conservation check, and doesn't have the reload-crash problem the old
// tool had. This is now the only balance-integrity check in the app.
function _renderDailyCheckReport(report){
  const el=document.getElementById('daily-check-results');
  if(!el)return;
  if(!report){el.innerHTML='<div style="color:var(--mu)">No check has run yet. Click "Run Now" to check today, or wait for the automatic overnight run.</div>';return;}
  const fmtD=v=>v?new Date(v).toLocaleString('en-GB'):'';
  const rows=report.rows||[];
  if(!rows.length){
    el.innerHTML=`<div style="color:var(--gr);font-weight:600;padding:16px 0">✓ Last checked ${fmtD(report.runAt)}. Everything matches — no issues found.</div>`;
    return;
  }
  const disagreements=rows.filter(r=>r.whatsWrong.includes('disagree'));
  let html=`<div style="margin-bottom:14px;font-weight:600">Last checked ${fmtD(report.runAt)}. Found <span style="color:var(--re)">${rows.length} issue(s)</span> — all flagged for your review, nothing changed automatically${disagreements.length?`, <span style="color:var(--re)">${disagreements.length} where the two checks disagree with each other</span>`:''}.</div>`;
  html+='<table style="width:100%;border-collapse:collapse;font-size:0.72rem"><thead><tr style="color:var(--mu);text-align:left"><th style="padding:5px 8px">Stage</th><th style="padding:5px 8px">Lot No</th><th style="padding:5px 8px">Vendor</th><th style="padding:5px 8px">Grade</th><th style="padding:5px 8px">Shade</th><th style="padding:5px 8px">Field</th><th style="padding:5px 8px">Live</th><th style="padding:5px 8px">Check 1</th><th style="padding:5px 8px">Check 2</th><th style="padding:5px 8px">What\'s Wrong</th></tr></thead><tbody>';
  // disagreements first — the most serious kind, where the two independent checks don't even agree with each other
  [...disagreements,...rows.filter(r=>!r.whatsWrong.includes('disagree'))].forEach(r=>{
    const wrongColor=r.whatsWrong.includes('disagree')?'var(--re)':'var(--ye)';
    html+=`<tr style="border-top:1px solid var(--b1)"><td style="padding:5px 8px">${r.stage}</td><td style="padding:5px 8px;color:var(--ac);font-weight:700">${r.lotNo}</td><td style="padding:5px 8px;color:var(--mu)">${r.vendor||'—'}</td><td style="padding:5px 8px;color:var(--mu)">${r.grade||'—'}</td><td style="padding:5px 8px;color:var(--mu)">${r.shade||'—'}</td><td style="padding:5px 8px;color:var(--mu)">${r.field}</td><td style="padding:5px 8px">${fmt(r.live)}</td><td style="padding:5px 8px">${fmt(r.check1)}</td><td style="padding:5px 8px">${fmt(r.check2)}</td><td style="padding:5px 8px;color:${wrongColor};font-weight:600">${r.whatsWrong}</td></tr>`;
  });
  html+='</tbody></table>';
  el.innerHTML=html;
}

async function loadDailyCheckReport(){
  const el=document.getElementById('daily-check-results');
  if(el)el.innerHTML='<div style="color:var(--mu)">Loading...</div>';
  try{
    const res=await fetch(WORKER_URL+'/api/daily-check/latest',{headers:_postHeaders()});
    const data=await res.json();
    _renderDailyCheckReport(data.report);
  }catch(e){
    if(el)el.innerHTML=`<div class="alert-err">Could not load — ${e.message}</div>`;
  }
}

async function runDailyCheckNow(){
  if(State.currentUser&&State.currentUser.role!=='admin'&&State.currentUser.role!=='manager'){showToast('Admin/Manager only','err');return;}
  const btn=document.getElementById('daily-check-run-btn');
  const el=document.getElementById('daily-check-results');
  if(btn)btn.disabled=true;
  if(el)el.innerHTML='<div style="color:var(--mu)">Started — running in the background, checking today\'s full data. This can take a little while for a large dataset. Checking for the result...</div>';
  try{
    const {ok,data,error,networkError}=await apiPost('/api/daily-check/run-now',{changedBy:State.currentUser.name});
  if(networkError)throw new Error(error);
  if(!ok){showToast(error||'Could not start','err');if(btn)btn.disabled=false;return;}
    showToast('Daily check started ✓ — running in the background');
    // Poll for the result every few seconds, same non-blocking spirit as the run itself
    let attempts=0;
    const poll=setInterval(async()=>{
      attempts++;
      const r=await fetch(WORKER_URL+'/api/daily-check/latest',{headers:_postHeaders()});
      const d=await r.json();
      const isToday=d.report&&d.report.id===new Date().toISOString().slice(0,10);
      if(isToday||attempts>=20){
        clearInterval(poll);
        _renderDailyCheckReport(d.report);
        if(btn)btn.disabled=false;
      }
    },3000);
  }catch(e){
    showToast('Network error: '+e.message,'err');
    if(btn)btn.disabled=false;
  }
}
window.runDailyCheckNow=runDailyCheckNow;
window.loadDailyCheckReport=loadDailyCheckReport;

function openMasterEdit(key,oldVal){const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';if(!isAdmin){showToast('Admin/Manager only','err');return;}
const labels={vendors:'Vendor',mills:'Mill',grades:'Grade',workers:'Worker',parties:'Party',machines:'Machine'};const label=labels[key]||key;const overlay=document.createElement('div');overlay.id='master-edit-overlay';overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center';overlay.innerHTML=`
    <div style="background:var(--s1);border-radius:12px;padding:24px;width:380px;border:1px solid var(--b2)"><div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--mu);margin-bottom:16px">Edit ${label}</div><div style="margin-bottom:14px"><div style="font-size:0.72rem;color:var(--mu);margin-bottom:6px">Current value</div><div style="font-size:0.9rem;font-weight:600;color:var(--ac)">${oldVal}</div></div><div style="margin-bottom:16px"><label style="font-size:0.72rem;color:var(--mu);display:block;margin-bottom:6px">New value</label><input class="fi" id="master-edit-input" value="${oldVal}" style="width:100%"></div><div style="background:rgba(240,165,0,0.08);border:1px solid rgba(240,165,0,0.2);border-radius:8px;padding:10px 12px;margin-bottom:16px;font-size:0.7rem;color:var(--mu)">
        ⚠ This will cascade the change across all linked entries — lots, stage entries, dye lots, dispatches etc.
      </div><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn btn-ghost btn-sm" onclick="document.getElementById('master-edit-overlay').remove()">Cancel</button><button class="btn btn-primary btn-sm" onclick="saveMasterEdit('${key}','${oldVal.replace(/'/g,"\'")}')">Save & Cascade</button></div></div>
  `;document.body.appendChild(overlay);setTimeout(()=>document.getElementById('master-edit-input')?.focus(),50);}
async function saveMasterEdit(key,oldVal){const newVal=document.getElementById('master-edit-input')?.value.trim();if(!newVal){showToast('Value cannot be empty','err');return;}
if(newVal===oldVal){document.getElementById('master-edit-overlay')?.remove();return;}
const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';if(!isAdmin){showToast('Admin/Manager only','err');return;}
try{
  const {ok,data,error,networkError}=await apiPost('/api/master-edit',{key,oldVal,newVal,changedBy:State.currentUser.name});
  if(networkError)throw new Error(error);
  if(!ok){showToast(error||'Could not update','err');return;}
  document.getElementById('master-edit-overlay')?.remove();showToast(`${newVal} updated & cascaded ✓`);renderMasters();renderAll();
}catch(e){showToast('Network error — not saved: '+e.message,'err');}
}
function updateStageSummaryBars(){const fmt=n=>n>=10000?Math.round(n).toLocaleString('en-IN'):parseFloat(n.toFixed(1)).toLocaleString('en-IN');const chip=(label,qty,col)=>`
    <div style="display:flex;align-items:center;gap:8px;background:var(--s2);border:1px solid var(--b1);border-radius:8px;padding:6px 12px"><span style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:${col}">${label}</span><span style="color:var(--mu)">·</span><span style="color:var(--tx);font-weight:600">${qty}</span></div>`;const softBar=document.getElementById('soft-summary-bar');if(softBar){const pendRM=(State.DB.lots||[]).filter(l=>{const b=getRMBalance(l.id,l.grade,l.vendor);return b.units>0||b.weight>0;});const pendRMBags=pendRM.reduce((a,l)=>a+getRMBalance(l.id,l.grade,l.vendor).units,0);const pendRMKg=pendRM.reduce((a,l)=>a+getRMBalance(l.id,l.grade,l.vendor).weight,0);const readyDye=(State.DB.lots||[]).filter(l=>{const b=getSoftBalanceAvailable(l.id,l.grade,l.vendor);return b.units>0||b.weight>0;});const readyDyeBags=readyDye.reduce((a,l)=>a+getSoftBalanceAvailable(l.id,l.grade,l.vendor).units,0);const readyDyeKg=readyDye.reduce((a,l)=>a+getSoftBalanceAvailable(l.id,l.grade,l.vendor).weight,0);const _srBtn=document.getElementById('stg-btn-stage-ready');if(_srBtn){const _sw=_srBtn.querySelector('.stg-tab-wt');if(_sw)_sw.textContent=fmt(readyDyeBags)+'b / '+fmt(readyDyeKg)+'kg';}
const _spBtn=document.getElementById('stg-btn-stage-pending');if(_spBtn){const _sw=_spBtn.querySelector('.stg-tab-wt');if(_sw)_sw.textContent=fmt(pendRMBags)+'b / '+fmt(pendRMKg)+'kg';}
softBar.innerHTML='';softBar.style.paddingBottom='0';softBar.style.display='none';}
const dyeBar=document.getElementById('dye-summary-bar');if(dyeBar){const pendSoft=(State.DB.lots||[]).filter(l=>{const b=getSoftBalanceAvailable(l.id,l.grade,l.vendor);return b.units>0||b.weight>0;});const pendSoftBags=pendSoft.reduce((a,l)=>a+getSoftBalanceAvailable(l.id,l.grade,l.vendor).units,0);const pendSoftKg=pendSoft.reduce((a,l)=>a+getSoftBalanceAvailable(l.id,l.grade,l.vendor).weight,0);const apprDye=appr(State.DB.dyeLots||[]);const readyWind=apprDye.filter(d=>{const b=getDyeBalAvailable(d.id);return b.units>0||b.weight>0;});const readyWindC=readyWind.reduce((a,d)=>a+getDyeBalAvailable(d.id).units,0);const readyWindKg=readyWind.reduce((a,d)=>a+getDyeBalAvailable(d.id).weight,0);const _drBtn=document.getElementById('stg-btn-dye-ready');if(_drBtn){const _dw=_drBtn.querySelector('.stg-tab-wt');if(_dw)_dw.textContent=fmt(readyWindC)+'c / '+fmt(readyWindKg)+'kg';}
const _dpBtn=document.getElementById('stg-btn-dye-pending');if(_dpBtn){const _dw=_dpBtn.querySelector('.stg-tab-wt');if(_dw)_dw.textContent=fmt(pendSoftBags)+'b / '+fmt(pendSoftKg)+'kg';}
dyeBar.innerHTML='';dyeBar.style.display='none';}
const windBar=document.getElementById('wind-summary-bar');if(windBar){const apprDye2=appr(State.DB.dyeLots||[]);const pendDye=apprDye2.filter(d=>{const b=getDyeBalAvailable(d.id);return b.units>0||b.weight>0;});const pendDyeC=pendDye.reduce((a,d)=>a+getDyeBalAvailable(d.id).units,0);const pendDyeKg=pendDye.reduce((a,d)=>a+getDyeBalAvailable(d.id).weight,0);const readyPack=apprDye2.filter(d=>{const b=getWindBalAvailable(d.id);return b.units>0||b.weight>0;});const readyPackC=readyPack.reduce((a,d)=>a+getWindBalAvailable(d.id).units,0);const readyPackKg=readyPack.reduce((a,d)=>a+getWindBalAvailable(d.id).weight,0);const _wrBtn=document.getElementById('stg-btn-wind-ready');if(_wrBtn){const _ww=_wrBtn.querySelector('.stg-tab-wt');if(_ww)_ww.textContent=fmt(readyPackC)+'c / '+fmt(readyPackKg)+'kg';}
const _wpBtn=document.getElementById('stg-btn-wind-pending');if(_wpBtn){const _ww=_wpBtn.querySelector('.stg-tab-wt');if(_ww)_ww.textContent=fmt(pendDyeC)+'c / '+fmt(pendDyeKg)+'kg';}
windBar.innerHTML='';windBar.style.display='none';}
const packBar=document.getElementById('pack-summary-bar');if(packBar){const apprDye3=appr(State.DB.dyeLots||[]);const pendWind=apprDye3.filter(d=>{const b=getWindBalAvailable(d.id);return b.units>0||b.weight>0;});const pendWindC=pendWind.reduce((a,d)=>a+getWindBalAvailable(d.id).units,0);const pendWindKg=pendWind.reduce((a,d)=>a+getWindBalAvailable(d.id).weight,0);const readyDisp=apprDye3.filter(d=>{const b=getPackBalAvailable(d.id);return b.units>0||b.weight>0;});const readyDispB=readyDisp.reduce((a,d)=>a+(getPackBalAvailable(d.id).units||0),0);const readyDispKg=readyDisp.reduce((a,d)=>a+getPackBalAvailable(d.id).weight,0);const _prBtn=document.getElementById('stg-btn-pack-ready');if(_prBtn){const _pw=_prBtn.querySelector('.stg-tab-wt');if(_pw)_pw.textContent=fmt(readyDispB)+'b / '+fmt(readyDispKg)+'kg';}
const _ppBtn=document.getElementById('stg-btn-pack-pending');if(_ppBtn){const _pw=_ppBtn.querySelector('.stg-tab-wt');if(_pw)_pw.textContent=fmt(pendWindC)+'c / '+fmt(pendWindKg)+'kg';}
packBar.innerHTML='';packBar.style.display='none';}
const dispBar=document.getElementById('dispatch-summary-bar');if(dispBar){const apprDye4=appr(State.DB.dyeLots||[]);const pendPack=apprDye4.filter(d=>{const b=getPackBal(d.id);return b.units>0||b.weight>0;});const pendPackB=pendPack.reduce((a,d)=>a+getPackBal(d.id).bags,0);const pendPackKg=pendPack.reduce((a,d)=>a+getPackBal(d.id).weight,0);const _dspBtn=document.getElementById('stg-btn-dispatch-ready');if(_dspBtn){const _dspw=_dspBtn.querySelector('.stg-tab-wt');if(_dspw)_dspw.textContent=fmt(pendPackB)+'b / '+fmt(pendPackKg)+'kg';}
dispBar.innerHTML='';dispBar.style.display='none';}}
function runBackup(isManual){if(!State.firebaseLoaded||!State.fbDB){console.log('Backup skipped: Firebase not confirmed ready');return;}
if(!Array.isArray(State.DB.lots)){console.log('Backup skipped: DB.lots missing — structure invalid');return;}
const currentTotal=getTotalEntries();if(!isManual){if(currentTotal<10){console.log('Backup skipped: total entries ('+currentTotal+') below minimum of 10');return;}
State.fbDB.ref('/backups').orderByKey().limitToLast(1).once('value',snap=>{const all=snap.val()||{};const keys=Object.keys(all);if(keys.length>0){const last=all[keys[0]];const lastTotal=(last.stageEntries||0)+(last.dyeBatches||0)+(last.dyeLots||0)
+(last.windEntries||0)+(last.packEntries||0)+(last.dispatches||0);const currentVoidLog=(State.DB.voidLog||[]).length;const currentDelReq=(State.DB.deleteRequests||[]).length;const lastVoidLog=last.voidLog||0;const lastDelReq=last.deleteRequests||0;const validDeletion=(currentVoidLog>lastVoidLog)||(currentDelReq>lastDelReq);if(lastTotal>0&&currentTotal<lastTotal&&!validDeletion){console.warn('Backup skipped: entries dropped '+lastTotal+' → '+currentTotal+' — no void/delete activity detected');return;}}
_writeBackup(currentTotal,false);});}else{_writeBackup(currentTotal,true);}}
function _writeBackup(currentTotal,isManual){const now=new Date();const ts=now.toISOString().slice(0,16).replace(/[T:]/g,'-');
// Store meta and data separately — modal only fetches meta (1KB), restore fetches data (4MB)
const meta={savedAt:now.toISOString(),isManual:isManual||false,lots:(State.DB.lots||[]).length,stageEntries:(State.DB.stageEntries||[]).length,dyeBatches:(State.DB.dyeBatches||[]).length,dyeLots:(State.DB.dyeLots||[]).length,windEntries:(State.DB.windEntries||[]).length,packEntries:(State.DB.packEntries||[]).length,dispatches:(State.DB.dispatches||[]).length,totalEntries:currentTotal,voidLog:(State.DB.voidLog||[]).length,deleteRequests:(State.DB.deleteRequests||[]).length,users:(State.DB.users||[]).length};
const updates={};
updates['/backups/'+ts+'/meta']=meta;
updates['/backups/'+ts+'/data']=JSON.parse(JSON.stringify(State.DB));
State.fbDB.ref().update(updates).then(()=>{
  console.log('✓ Backup '+(isManual?'[Manual]':'[Auto]')+' /backups/'+ts+' — '+currentTotal+' entries, '+(State.DB.lots||[]).length+' lots');
  // Cleanup: shallow fetch (keys only, ~1KB) — delete oldest if >20
  _fbAuthedFetch('/backups.json?shallow=true').then(r=>r.json()).then(function(shallowKeys){
    if(!shallowKeys)return;
    const keys=Object.keys(shallowKeys).sort();
    if(keys.length>20){
      keys.slice(0,keys.length-20).forEach(k=>State.fbDB.ref('/backups/'+k).remove());
      console.log('Backup retention: kept last 20, deleted',keys.length-20,'old backups');
    }
  }).catch(e=>console.warn('Backup cleanup failed:',e));
  if(isManual&&typeof showToast==='function')showToast('Backup saved to Firebase ✓ — '+currentTotal+' entries');
}).catch(e=>{console.warn('Backup write failed:',e);if(isManual&&typeof showToast==='function')showToast('Backup failed — check connection','err');});
try{localStorage.setItem('tcv2_backup',JSON.stringify(State.DB));}catch(e){}
try{const _meta2=JSON.parse(localStorage.getItem('tcv2_backup_meta')||'{}');_meta2.lastBackup=now.toISOString();_meta2.lastTotal=currentTotal;_meta2.lastLots=(State.DB.lots||[]).length;localStorage.setItem('tcv2_backup_meta',JSON.stringify(_meta2));}catch(e){}}
function manualBackup(){if(!State.firebaseLoaded||!State.fbDB){if(typeof showToast==='function')showToast('Cannot backup — Firebase not connected','err');return;}
runBackup(true);}
function exportFirebaseBackup(key){showToast('Preparing download...');_fbAuthedFetch('/backups/'+key+'/data.json').then(r=>r.json()).then(function(b){if(!b){showToast('Backup data not found','err');return;}const b2={data:b};b=b2;
const blob=new Blob([JSON.stringify({tc:b.data},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='ThreadControl_Backup_'+key+'.json';a.click();URL.revokeObjectURL(a.href);showToast('Backup downloaded ✓');}).catch(e=>showToast('Download failed — '+e.message,'err'));}
async function restoreFromBackup(key,lots,totalEntries){
const confirmed=confirm('RESTORE FROM BACKUP\n\n'
+'Timestamp: '+key+'\n'
+'Lots: '+lots+' | Entries: '+totalEntries+'\n\n'
+'This will REPLACE all current data (except user accounts, which are managed separately) with this backup.\n'
+'Current data will be lost unless you export it first.\n\n'
+'Are you absolutely sure?');if(!confirmed)return;const confirmed2=confirm('FINAL CONFIRMATION\n\nType YES in your mind — this cannot be undone. Proceed?');if(!confirmed2)return;
const pwd=prompt('Enter your admin password to confirm this restore:');
if(!pwd){showToast('Restore cancelled — password required','err');return;}
showToast('Restoring backup... please wait');
try{
  const {ok,data,error,networkError}=await apiPost('/api/backup/restore',{key,password:pwd,changedBy:State.currentUser?.name});
  if(networkError)throw new Error(error);
  if(!ok){showToast(error||'Restore failed','err');return;}
  console.log('[Restore] Backup restored from: '+key+' by '+data.restoredBy);
  showToast('✓ Backup restored (user accounts unaffected) — reloading in 3 seconds');
  setTimeout(()=>window.location.reload(),3000);
}catch(e){showToast('Restore failed — '+e.message,'err');}
}
function getBackupList(){try{const backups=JSON.parse(localStorage.getItem(BACKUP_KEY)||'{}');return Object.entries(backups).sort((a,b)=>b[0].localeCompare(a[0])).map(([date,info])=>({date,savedAt:info.savedAt,lots:info.lots||0,entries:info.entries||0,dispatches:info.dispatches||0}));}catch(e){return[];}}
function exportBackupJSON(dateKey){try{let data;if(dateKey==='live'){data={tc:JSON.parse(JSON.stringify(State.DB))};}else{const backups=JSON.parse(localStorage.getItem(BACKUP_KEY)||'{}');if(!backups[dateKey]){alert('Backup not found');return;}
data={tc:backups[dateKey].data};}
const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`ThreadControl_Backup_${dateKey === 'live' ? new Date().toISOString().split('T')[0] : dateKey}.json`;a.click();URL.revokeObjectURL(url);showToast('Backup downloaded ✓');}catch(e){alert('Export failed: '+e.message);}}
function exportCurrentCSV(){try{exportCSV();}catch(e){alert('CSV export failed: '+e.message);}}
function showBackupModal(){document.getElementById('backup-modal-content').innerHTML=`
    <div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:8px;padding:12px 14px;margin-bottom:16px;"><div style="font-size:0.7rem;font-weight:700;color:var(--gr);margin-bottom:4px;">AUTO-BACKUP STATUS</div><div style="font-size:0.78rem;color:var(--tx)">Last backup: <strong><span id="last-backup-time">Loading...</span></strong></div><div style="font-size:0.7rem;color:var(--mu);margin-top:2px">
        ☁ Cloudflare cron every 6hrs · Manual backup available · Last ${MAX_BACKUPS} backups kept in Firebase
      </div></div><div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;"><button class="btn btn-primary btn-sm" onclick="exportBackupJSON('live')">⬇ Export Live JSON</button><button class="btn btn-ghost btn-sm" onclick="exportCurrentCSV()">⬇ Export CSV</button><button class="btn btn-ghost btn-sm" onclick="manualBackup();setTimeout(showBackupModal,1000)">↺ Backup Now</button></div><div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--mu);margin-bottom:8px;">
      ☁ FIREBASE BACKUPS (last 30 days — available on any device)
    </div><div id="fb-backup-list" style="margin-bottom:16px;"><div style="color:var(--mu);font-size:0.75rem;padding:10px 0">Loading Firebase backups...</div></div><div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--mu);margin-bottom:8px;">
      💾 LOCAL BACKUPS (this browser only)
    </div><div id="local-backup-list"></div>`;openModal('backup-modal');if(State.fbDB){const fbEl=document.getElementById('fb-backup-list');const renderBackupTable=(backups,type)=>{const keys=Object.keys(backups).sort().reverse();if(!keys.length)return`<div style="color:var(--mu);font-size:0.75rem;padding:8px 0">No ${type} backups yet</div>`;return`<div class="tbl" style="max-height:220px;overflow-y:auto;margin-bottom:12px;"><table style="width:100%"><thead><tr><th style="padding:5px 8px;font-size:0.58rem;text-transform:uppercase;color:var(--mu);text-align:left">${type} Slot</th><th style="padding:5px 8px;font-size:0.58rem;text-transform:uppercase;color:var(--mu);text-align:left">Saved At</th><th style="padding:5px 8px;font-size:0.58rem;text-transform:uppercase;color:var(--mu);text-align:left">Records</th><th style="padding:5px 8px"></th></tr></thead><tbody>${keys.map(k=>{
            const b=backups[k];
            return `<tr><td style="padding:6px 8px;font-size:0.75rem;font-weight:700;color:var(--ac)">${k}</td><td style="padding:6px 8px;font-size:0.68rem;color:var(--mu)">${new Date(b.savedAt).toLocaleString('en-GB')}</td><td style="padding:6px 8px;font-size:0.68rem;color:var(--tx)">${b.lots||0}L · ${b.entries||0}E · ${b.dispatches||0}D · ${b.total||0}total</td><td style="padding:6px 8px;"><button class="btn btn-ghost btn-xs"onclick="exportFirebaseBackup('${type.toLowerCase()}','${k}')">⬇ JSON</button><button class="btn btn-danger btn-xs"style="margin-left:4px"onclick="deleteFirebaseBackup('${type.toLowerCase()}','${k}')">🗑</button></td></tr>`;
          }).join('')}</tbody></table></div>`;};const _fbUrl='/backups.json?shallow=true';_fbAuthedFetch(_fbUrl).then(r=>r.json()).then(function(shallowKeys){if(!fbEl)return;if(!shallowKeys||!Object.keys(shallowKeys).length){fbEl.innerHTML='<div style="color:var(--mu);font-size:0.75rem;padding:8px 0">No Firebase backups yet — click Backup Now to create one</div>';return;}
const keys=Object.keys(shallowKeys).sort().reverse().slice(0,20);const metaPromises=keys.map(k=>_fbAuthedFetch('/backups/'+k+'/meta.json').then(r=>r.json()).then(meta=>{return{key:k,meta:meta||{}};}).catch(()=>({key:k,meta:{}})));Promise.all(metaPromises).then(function(results){const backups={};results.forEach(r=>{if(r)backups[r.key]=r.meta;});window._fbBackups=backups;window._fbBackupKeys=keys;const _lastKey=keys[0];if(_lastKey&&backups[_lastKey]&&backups[_lastKey].savedAt){const _ltEl=document.getElementById('last-backup-time');if(_ltEl){const _lb=backups[_lastKey];const _src=_lb.source==='cron'?' (Cron)':(_lb.isManual?' (Manual)':' (Auto)');_ltEl.textContent=new Date(_lb.savedAt).toLocaleString('en-GB')+_src;}}
const rows=keys.map(function(k,idx){const b=backups[k];const dt=b.savedAt?new Date(b.savedAt).toLocaleString('en-GB'):k;const total=b.totalEntries||((b.stageEntries||0)+(b.dyeBatches||0)+(b.dyeLots||0)+(b.windEntries||0)+(b.packEntries||0)+(b.dispatches||0));const typeLabel=b.isManual?'<span style="color:var(--ac)">Manual</span>':'<span style="color:var(--mu)">Auto</span>';return'<tr style="border-top:1px solid var(--b1)">'
+'<td style="padding:6px 8px;white-space:nowrap;font-size:0.7rem">'+dt+'</td>'
+'<td style="padding:6px 8px">'+(b.lots||0)+'</td>'
+'<td style="padding:6px 8px">'+total+'</td>'
+'<td style="padding:6px 8px">'+typeLabel+'</td>'
+'<td style="padding:6px 8px;white-space:nowrap">'
+'<button class="btn btn-ghost btn-xs fb-exp-btn" data-key="'+k+'" style="margin-right:4px">⬇ JSON</button>'
+'<button class="btn btn-xs fb-rst-btn" data-key="'+k+'" data-lots="'+(b.lots||0)+'" data-total="'+total+'" '
+'style="background:rgba(239,68,68,0.1);color:var(--re);border:1px solid rgba(239,68,68,0.3);">↩ Restore</button>'
+'</td>'
+'</tr>';}).join('');fbEl.innerHTML='<div style="font-size:0.62rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--ac);margin-bottom:8px;">'
+'☁ FIREBASE BACKUPS (LAST 20 — AVAILABLE ON ANY DEVICE)</div>'
+'<div class="tbl-wrap" style="max-height:300px;overflow-y:auto;">'
+'<table style="width:100%;border-collapse:collapse;font-size:0.72rem;">'
+'<thead><tr style="background:var(--s2)">'
+'<th style="padding:6px 8px;text-align:left;color:var(--mu)">Saved At</th>'
+'<th style="padding:6px 8px;text-align:left;color:var(--mu)">Lots</th>'
+'<th style="padding:6px 8px;text-align:left;color:var(--mu)">Entries</th>'
+'<th style="padding:6px 8px;text-align:left;color:var(--mu)">Type</th>'
+'<th>Actions</th>'
+'</tr></thead>'
+'<tbody>'+rows+'</tbody>'
+'</table></div>';fbEl.addEventListener('click',function(ev){const expBtn=ev.target.closest('.fb-exp-btn');const rstBtn=ev.target.closest('.fb-rst-btn');if(expBtn)exportFirebaseBackup(expBtn.dataset.key);if(rstBtn)restoreFromBackup(rstBtn.dataset.key,parseInt(rstBtn.dataset.lots),parseInt(rstBtn.dataset.total));});});});}else{const fbEl=document.getElementById('fb-backup-list');if(fbEl)fbEl.innerHTML='<div style="color:var(--mu);font-size:0.75rem;padding:8px 0">Firebase not connected</div>';}
const localBackups=getBackupList();const localEl=document.getElementById('local-backup-list');if(localEl){if(!localBackups.length){localEl.innerHTML='<div style="color:var(--mu);font-size:0.75rem;padding:8px 0">No local backups yet</div>';}else{localEl.innerHTML=`<div class="tbl"><table style="width:100%"><tbody>${localBackups.map(b=>`<tr><td style="padding:7px 10px;font-size:0.8rem;font-weight:700;color:var(--ac)">${b.date}</td><td style="padding:7px 10px;font-size:0.7rem;color:var(--mu)">${new Date(b.savedAt).toLocaleString('en-GB')}</td><td style="padding:7px 10px;font-size:0.72rem;color:var(--tx)">${b.lots}lots · ${b.entries}entries</td><td style="padding:7px 10px;"><button class="btn btn-ghost btn-xs"onclick="exportBackupJSON('${b.date}')">⬇ JSON</button></td></tr>`).join('')}</tbody></table></div>`;}}}
async function deleteFirebaseBackup(type,dateKey){
if(!confirm('Delete '+type+' backup for '+dateKey+'?'))return;
const pwd=prompt('Enter your admin password to confirm this delete:');
if(!pwd){showToast('Delete cancelled — password required','err');return;}
try{
  const {ok,error,networkError}=await apiPost('/api/backup/delete',{type,dateKey,password:pwd});
  if(networkError)throw new Error(error);
  if(!ok){showToast(error||'Delete failed','err');return;}
  showToast('Backup deleted');
  showBackupModal();
}catch(e){alert('Delete failed: '+e.message);}
}
function renderChallan(){
  const selDate=document.getElementById('ch-date-filter')?.value||'';
  const selParty=document.getElementById('ch-party-filter')?.value||'';
  const selChallan=document.getElementById('ch-challan-filter')?.value||'';
  _loadCatalog('dispatches',()=>{
    if(selDate||selParty||selChallan){
      _hydrateChallanFilter(selDate,selParty,selChallan,()=>{_renderChallanCore();});
    }else{
      _renderChallanCore();
    }
  });
}
function _renderChallanCore(){const filterBar=document.getElementById('challan-filter-bar');const summaryEl=document.getElementById('challan-summary');const container=document.getElementById('challan-container');if(!container)return;const allDisps=(State.DB.dispatches||[]).filter(d=>d.status==='Approved');const challanMap={};allDisps.forEach(d=>{
  // Jul 29 2026 fix — real, confirmed gap: a dispatch with neither a
  // challanId nor an invoiceNo used to be silently skipped here entirely
  // — genuinely dispatched material with no trace anywhere on this
  // screen. Confirmed the field is optional at dispatch time, not
  // required, so this was a real, live gap, not a hypothetical one. Now
  // each such dispatch gets its own visible entry instead, clearly
  // marked, so it's findable rather than invisible.
  const key=d.challanId||(d.invoiceNo&&d.invoiceNo.trim()?'inv-'+d.invoiceNo.trim():'no-challan-'+d.id);
  if(!challanMap[key])challanMap[key]={challanId:key,challanNo:d.invoiceNo&&d.invoiceNo.trim()?d.invoiceNo:'⚠ No challan/invoice',party:d.party,date:d.date,entries:[]};challanMap[key].entries.push(d);});const allChallans=Object.values(challanMap).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
const _dropdownDisps=_dispatchesForDropdown();const _dropdownMap={};_dropdownDisps.forEach(d=>{const key=d.challanId||(d.invoiceNo&&d.invoiceNo.trim()?'inv-'+d.invoiceNo.trim():'no-challan-'+d.id);if(!_dropdownMap[key])_dropdownMap[key]={challanId:key,challanNo:d.invoiceNo&&d.invoiceNo.trim()?d.invoiceNo:'⚠ No challan/invoice',party:d.party,date:d.date};});const allChallansForDropdown=Object.values(_dropdownMap);
const challanSortVal=(no)=>{const m=(no||'').match(/(\d+)(?!.*\d)/);return m?parseInt(m[1]):0;};const selParty=document.getElementById('ch-party-filter')?document.getElementById('ch-party-filter').value:'';const selChallan=document.getElementById('ch-challan-filter')?document.getElementById('ch-challan-filter').value:'';const selDate=document.getElementById('ch-date-filter')?document.getElementById('ch-date-filter').value:'';const allParties=[...new Set(allChallansForDropdown.map(c=>c.party))].filter(Boolean).sort();const _anyFilterSet=!!(selDate||selParty||selChallan);let filtered=_anyFilterSet?allChallans:[];if(selDate)filtered=filtered.filter(c=>c.date===selDate);if(selParty)filtered=filtered.filter(c=>c.party===selParty);if(selChallan)filtered=filtered.filter(c=>c.challanNo===selChallan||c.challanId===selChallan);const partiesForDate=selDate?[...new Set(allChallansForDropdown.filter(c=>c.date===selDate).map(c=>c.party))].filter(Boolean).sort():allParties;const challansForFilter=allChallansForDropdown.filter(c=>(!selDate||c.date===selDate)&&(!selParty||c.party===selParty)).map(c=>({id:c.challanId,no:c.challanNo})).sort((a,b)=>challanSortVal(b.no)-challanSortVal(a.no));if(filterBar)filterBar.innerHTML=`
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px;"><input type="date" class="fi" id="ch-date-filter" style="max-width:160px" value="${selDate}" onchange="renderChallan()"><select class="fs" id="ch-party-filter" style="max-width:200px" onchange="renderChallan()"><option value="">All Parties</option>
        ${partiesForDate.map(p=>`<option value="${p}"${p===selParty?'selected':''}>${p}</option>`).join('')}
      </select><select class="fs" id="ch-challan-filter" style="max-width:200px" onchange="renderChallan()"><option value="">All Challans</option>
        ${challansForFilter.map(c=>`<option value="${c.id}"${c.id===selChallan?'selected':''}>${c.no}</option>`).join('')}
      </select>
      ${selDate||selParty||selChallan ? `<button class="btn btn-ghost btn-sm"onclick="document.getElementById('ch-date-filter').value='';document.getElementById('ch-party-filter').value='';document.getElementById('ch-challan-filter').value='';renderChallan()">✕ Clear</button>` : ''}
    </div>`;const totBags=filtered.reduce((a,c)=>a+c.entries.reduce((b,d)=>b+(d.bags||0),0),0);const totWeight=filtered.reduce((a,c)=>a+c.entries.reduce((b,d)=>b+(d.weight||0),0),0);const totParties=[...new Set(filtered.map(c=>c.party))].length;if(summaryEl)summaryEl.innerHTML=!_anyFilterSet?'':`
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:16px;"><div style="background:var(--s2);border-radius:8px;padding:12px 14px;"><div style="font-size:0.7rem;color:var(--mu);margin-bottom:4px;">Total Challans</div><div style="font-size:1.2rem;font-weight:700;">${filtered.length}</div></div><div style="background:var(--s2);border-radius:8px;padding:12px 14px;"><div style="font-size:0.7rem;color:var(--mu);margin-bottom:4px;">Total Bags</div><div style="font-size:1.2rem;font-weight:700;">${totBags}b</div></div><div style="background:var(--s2);border-radius:8px;padding:12px 14px;"><div style="font-size:0.7rem;color:var(--mu);margin-bottom:4px;">Total Weight</div><div style="font-size:1.2rem;font-weight:700;">${fmt(totWeight)} kg</div></div><div style="background:var(--s2);border-radius:8px;padding:12px 14px;"><div style="font-size:0.7rem;color:var(--mu);margin-bottom:4px;">Parties Served</div><div style="font-size:1.2rem;font-weight:700;">${totParties}</div></div></div>`;if(!filtered.length){container.innerHTML=_anyFilterSet?'<div class="empty"><div class="empty-icon">📋</div><div class="empty-text">No challans found</div></div>':'<div class="empty"><div class="empty-icon">📋</div><div class="empty-text">Select a date, party, or challan above to view records</div></div>';return;}
container.innerHTML=filtered.map(c=>{const totB=c.entries.reduce((a,d)=>a+(d.bags||0),0);const totW=c.entries.reduce((a,d)=>a+(d.weight||0),0);return`<div class="card gap-b" style="margin-bottom:12px;"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;"><div><span style="font-size:1rem;font-weight:800;color:var(--ac)">${c.challanNo}</span><span style="font-size:0.8rem;color:var(--mu);margin-left:12px;">${c.party}</span></div><span style="font-size:0.75rem;color:var(--mu)">${c.date||'—'}</span></div><div style="border-top:1px solid var(--b1);padding-top:10px;"><div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:8px;font-size:0.68rem;font-weight:700;text-transform:uppercase;color:var(--mu);padding:0 6px;margin-bottom:6px;"><span>Dye Lot</span><span>Shade</span><span>Bags</span><span>Weight</span></div>
        ${c.entries.map(d=>`<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:8px;font-size:0.78rem;padding:6px;background:var(--s2);border-radius:6px;margin-bottom:4px;"><span class="mono"style="font-weight:700;color:var(--ac);cursor:pointer;text-decoration:underline"onclick="openDyeLifecycle('${d.dyeLotId||''}');">${d.dyeLotNo||'—'}</span><span>${d.shade||'—'}</span><span>${d.bags||0}b</span><span>${fmt(d.weight||0)}kg</span></div>`).join('')}
        <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:8px;font-size:0.78rem;padding:6px;border-top:1px solid var(--b1);margin-top:4px;font-weight:700;"><span style="color:var(--mu)">${c.entries.length} lot${c.entries.length>1?'s':''}</span><span></span><span>${totB}b</span><span>${fmt(totW)} kg</span></div></div></div>`;}).join('');}
function loadDyeEntriesIfNeeded(callback){if(State._dyeEntriesLoaded||State.DB.dyeEntries.length>0){if(callback)callback();return;}
if(!State.firebaseLoaded||!State.fbDB){if(callback)callback();return;}
State.fbDB.ref('/tc/dyeEntries').once('value',snap=>{State.DB.dyeEntries=snap.val()||[];State._dyeEntriesLoaded=true;console.log('[Lazy] dyeEntries loaded:',State.DB.dyeEntries.length,'entries');if(callback)callback();});}
window.addEventListener('resize',setupMobileNav);
initTheme();
try{try{initFirebase();}catch(e){console.warn('Firebase init error:',e);}
const _sess=sessionStorage.getItem('tcv2_session');if(_sess){try{const _sd=JSON.parse(_sess);if(_sd&&_sd.username){State.currentUser=_sd;window.currentUser=State.currentUser;console.log('[Auth] Session restored:',State.currentUser.name,'/',State.currentUser.role);if(State.firebaseLoaded){onLogin();}else{_waitForDBThenLogin();}}else{showLoginScreenSafe();}}catch(e){showLoginScreenSafe();}}else{showLoginScreenSafe();}}catch(e){console.error('Init error:',e);try{document.getElementById('login-screen').classList.remove('hidden');}catch(e2){}}
window.onerror=function(msg,src,line,col,err){console.error("🔥 JS ERROR:",msg,"at",line+":"+col);};
document.addEventListener('DOMContentLoaded',function(){const navItems=document.querySelectorAll('.nav-item, .mbn-item, .mob-drawer-item');const pages=document.querySelectorAll('.page');function switchPage(target){if(!target)return;pages.forEach(p=>p.classList.remove('active'));let page=document.getElementById(target)||document.getElementById(target+'-page');if(page){page.classList.add('active');}else{console.error('❌ Page not found:',target);}}
navItems.forEach(item=>{item.addEventListener('click',function(){const target=this.getAttribute('data-page');navItems.forEach(i=>i.classList.remove('active'));this.classList.add('active');switchPage(target);});});const first=document.querySelector('.nav-item.active');if(first){switchPage(first.getAttribute('data-page'));}else if(navItems.length){navItems[0].classList.add('active');switchPage(navItems[0].getAttribute('data-page'));}});
function updateApprCounts(){}
function repairLotCascade(){if(State.currentUser?.role!=='admin'&&State.currentUser?.role!=='manager'){showToast('Admin/Manager only','err');return;}
let fixed=0;const report=[];const checkLots=['5176','4314','4340'];checkLots.forEach(lid=>{const lot=State.DB.lots.find(l=>l.id===lid);if(!lot){console.warn('[repair] lot',lid,'not in DB.lots');return;}
console.log('[repair] lot',lid,'current: grade='+lot.grade+' vendor='+lot.vendor);(State.DB.stageEntries||[]).filter(e=>e.lotId===lid&&e.stage==='Soft').forEach(e=>{console.log('[repair] SE',e.id,'grade='+e.grade+' vendor='+e.vendor,'match='+(e.grade===lot.grade&&e.vendor===lot.vendor));});(State.DB.dyeLots||[]).forEach(d=>{(d.sources||[]).filter(s=>s.lotId===lid).forEach(s=>{console.log('[repair] DL',d.dyeLotNo,'src grade='+s.grade+' vendor='+s.vendor,'match='+(s.grade===lot.grade&&s.vendor===lot.vendor));});});});State.DB.lots.forEach(l=>{(State.DB.stageEntries||[]).forEach(e=>{if(e.lotId===l.id&&e.stage==='Soft'){const otherLot=State.DB.lots.find(ol=>ol.id===e.lotId&&ol.grade===e.grade&&ol.vendor===e.vendor);if(!otherLot){e.grade=l.grade;e.vendor=l.vendor;fixed++;report.push('SE:'+e.id);}}});(State.DB.dyeLots||[]).forEach(d=>{(d.sources||[]).forEach(s=>{if(s.lotId===l.id&&s.sourceType==='rm'){const otherLot=State.DB.lots.find(ol=>ol.id===s.lotId&&ol.grade===s.grade&&ol.vendor===s.vendor);if(!otherLot){s.grade=l.grade;s.vendor=l.vendor;fixed++;report.push('DL:'+d.dyeLotNo);}}});});(State.DB.dyeEntries||[]).forEach(d=>{(d.sources||[]).forEach(s=>{if(s.lotId===l.id&&s.sourceType==='rm'){const otherLot=State.DB.lots.find(ol=>ol.id===s.lotId&&ol.grade===s.grade&&ol.vendor===s.vendor);if(!otherLot){s.grade=l.grade;s.vendor=l.vendor;fixed++;report.push('DE:'+d.id);}}});});});console.log('[repair] fixed='+fixed,report);if(fixed>0){save();renderAll();showToast(fixed+' records repaired ✓','ok');}
else showToast('No orphaned records found — check console for lot details','ok');}
function openVoidRMLotCascade(lotId,grade,vendor){if(!State.currentUser||(State.currentUser.role!=='admin'&&State.currentUser.role!=='manager')){showToast('Admin/Manager only','err');return;}
const lot=getLotByKey(lotId,grade,vendor);if(!lot||!lot.id){showToast('Lot not found','err');return;}
const softEntries=(State.DB.stageEntries||[]).filter(e=>e.lotId===lotId&&e.grade===grade&&e.vendor===vendor&&e.stage==='Soft'&&e.status!=='Voided');const linkedDyeLots=(State.DB.dyeLots||[]).filter(d=>d.status!=='Voided'&&(d.sources||[]).some(s=>s.lotId===lotId&&s.grade===grade&&s.vendor===vendor));const dyeIds=linkedDyeLots.map(d=>d.id);const windEntries=(State.DB.windEntries||[]).filter(e=>dyeIds.includes(e.dyeLotId)&&e.status!=='Voided');const packEntries=(State.DB.packEntries||[]).filter(e=>dyeIds.includes(e.dyeLotId)&&e.status!=='Voided');const dispatches=(State.DB.dispatches||[]).filter(e=>dyeIds.includes(e.dyeLotId)&&e.status!=='Voided');const summary=`Lot ${lotId} · ${grade} · ${vendor}\n\n`
+(softEntries.length?`💧 ${softEntries.length} Soft entries\n`:'')
+(linkedDyeLots.length?`🎨 ${linkedDyeLots.length} Dye lots: ${linkedDyeLots.map(d=>d.dyeLotNo).join(', ')}\n`:'')
+(windEntries.length?`🌀 ${windEntries.length} Wind entries\n`:'')
+(packEntries.length?`📦 ${packEntries.length} Pack entries\n`:'')
+(dispatches.length?`🚚 ${dispatches.length} Dispatches — ⚠ ALREADY SENT!\n`:'')
+'\nThis CANNOT be undone. Proceed?';if(!confirm(summary))return;const reason=prompt('Enter void reason (min 10 chars):');if(!reason||reason.trim().length<10){showToast('Reason too short','err');return;}
window._vrlKey={lotId,grade,vendor,reason:reason.trim()};submitVoidRMLotCascade();}
async function submitVoidRMLotCascade(){
  // Jul 14 2026 — Item C cutover. All cascade logic and the write now live
  // in worker.js (POST /api/void-rm-lot), committed atomically.
  const{lotId,grade,vendor}=window._vrlKey||{};if(!lotId)return;const reason=window._vrlKey?.reason||'Admin cascade void';
  try{
    const {ok,data,error,networkError}=await apiPost('/api/void-rm-lot',{lotId,grade,vendor,reason,changedBy:State.currentUser.name});
  if(networkError)throw new Error(error);
  if(!ok){showToast(error||'Cascade void failed','err');return;}
    showToast(`Cascade void complete \u2713${data.voidCount?' ('+data.voidCount+' records)':''}`,'ok');renderAll();window._vrlKey=null;
  }catch(e){showToast('Network error \u2014 cascade void not saved: '+e.message,'err');}
}

function vtOnVendorChange(v){State.vtSelectedVendor=v;State.vtSelectedLot='';_loadCatalog('lots',()=>{renderVendorV2();});}
function vtOnStatusFilter(v){State.vtSelectedLot='';renderVendorV2();} 

// Same as core.js — inline HTML handlers need explicit window bindings
// under ES modules.
window.addDeadStockRow = addDeadStockRow;
window.addDispatchLotRow = addDispatchLotRow;
window.addDyeSourceRow = addDyeSourceRow;
window.addMachine = addMachine;
window.addMaster = addMaster;
window.addRecycleRow = addRecycleRow;
window.addResidualRow = addResidualRow;
window.addUser = addUser;
window.adminPasswordAction = adminPasswordAction;
window.approveAllCurrentTab = approveAllCurrentTab;
window.cancelPartialDelivery = cancelPartialDelivery;
window.changeUserPasswordAdmin = changeUserPasswordAdmin;
window.checkRMLotDuplicate = checkRMLotDuplicate;
window.closeMobDrawer = closeMobDrawer;
window.confirmAdminPwd = confirmAdminPwd;
window.confirmMasterDelete = confirmMasterDelete;
window.confirmPartialDelivery = confirmPartialDelivery;
window.dyeEndIOCheck = dyeEndIOCheck;
window.dyeSplitCalc = dyeSplitCalc;
window.executeClearStage = executeClearStage;
window.exportCSV = exportCSV;
window.exportEditLog = exportEditLog;
window.exportPDF = exportPDF;
window.exportToExcel = exportToExcel;
window.mobNav = mobNav;
window.navFromMenu = navFromMenu;
window.onDyeEndEntrySelect = onDyeEndEntrySelect;
window.onDyeEndSerialInput = onDyeEndSerialInput;
window.onRMRGradeChange = onRMRGradeChange;
window.onRMRLotChange = onRMRLotChange;
window.onRMRVendorChange = onRMRVendorChange;
window.onResidualTransferComboChange = onResidualTransferComboChange;
window.openDispatchModal = openDispatchModal;
window.openDyeEndModal = openDyeEndModal;
window.openDyeStartModal = openDyeStartModal;
window.openMobDrawer = openMobDrawer;
window.openPackModal = openPackModal;
window.openPartyOrderModal = openPartyOrderModal;
window.openRMModal = openRMModal;
window.openRMReturnModal = openRMReturnModal;
window.openResidualTransferModal = openResidualTransferModal;
window.openStageModal = openStageModal;
window.openWindModal = openWindModal;
window.packGainCheck = packGainCheck;
window.recalcAllSummaries = recalcAllSummaries;
window.rejectDeleteRequest = rejectDeleteRequest;
window.renderAnDailyLog = renderAnDailyLog;
window.renderComparison = renderComparison;
window.renderDyeLifecycle = renderDyeLifecycle;
window.renderDyeLifecycleSelect = renderDyeLifecycleSelect;
window.renderEditLog = renderEditLog;
window.renderLifecycle = renderLifecycle;
window.renderMachineHealth = renderMachineHealth;
window.renderMasterList = renderMasterList;
window.renderSearch = renderSearch;
window.renderTrend = renderTrend;
window.renderVendorV2 = renderVendorV2;
window.renderWorkerScorecard = renderWorkerScorecard;
window.rptDaily = rptDaily;
window.rptFlow = rptFlow;
window.rptGrade = rptGrade;
window.rptMachine = rptMachine;
window.rptPack = rptPack;
window.rptShade = rptShade;
window.rptWaste = rptWaste;
window.rptWorker = rptWorker;
window.saveAgingThresholds = saveAgingThresholds;
window.saveFlag = saveFlag;
window.setAnDate = setAnDate;
window.setCmpQuick = setCmpQuick;
window.setDashPeriod = setDashPeriod;
window.setMHPeriod = setMHPeriod;
window.setRptFilter = setRptFilter;
window.setTrendGroup = setTrendGroup;
window.showAnTab = showAnTab;
window.showBackupModal = showBackupModal;
window.showMobileMenu = showMobileMenu;
window.showRMTab = showRMTab;
window.showStockRegTab = showStockRegTab;
window.showTab = showTab;
window.showWindEndRef = showWindEndRef;
window.submitDeadStock = submitDeadStock;
window.submitDeleteRequest = submitDeleteRequest;
window.submitDispatch = submitDispatch;
window.submitDyeEndNew = submitDyeEndNew;
window.submitDyeSplit = submitDyeSplit;
window.submitDyeStartNew = submitDyeStartNew;
window.submitEditEntry = submitEditEntry;
window.submitLinkOrder = submitLinkOrder;
window.submitPack = submitPack;
window.submitPartyOrder = submitPartyOrder;
window.submitRM = submitRM;
window.submitRMEdit = submitRMEdit;
window.submitRMReturn = submitRMReturn;
window.submitResidualTransfer = submitResidualTransfer;
window.submitScrap = submitScrap;
window.submitStageEntry = submitStageEntry;
window.submitVoid2 = submitVoid2;
window.submitVoidEntry = submitVoidEntry;
window.submitWind = submitWind;
window.switchApprTab = switchApprTab;
window.switchEditLogTab = switchEditLogTab;
window.switchMasterTab = switchMasterTab;
window.switchStgTab = switchStgTab;
window.switchStockTab = switchStockTab;
window.switchWipTab = switchWipTab;
window.updateDLCDropdown = updateDLCDropdown;
window.updateLCLotDropdown = updateLCLotDropdown;
window.vtOnStatusFilter = vtOnStatusFilter;
window.vtOnVendorChange = vtOnVendorChange;
window.vtSelectLot = vtSelectLot;

// Circular-import fix (Jul 10 2026): core.js calls these 6 pages.js
// functions via window.x() instead of `import`, breaking a circular
// dependency that caused a real TDZ crash in staging — core.js's own
// import {...} from './pages.js' forced pages.js's top-level code
// (window.addEventListener registrations) to run before core.js finished
// initializing its own State/isOnline, throwing "Cannot access before
// initialization" and aborting the rest of the script. See AGENTS.md.
window.onWindDyeLotSelect = onWindDyeLotSelect;
window.populateSelects = populateSelects;
window.renderAll = renderAll;
window.renderLoginDemoCards = renderLoginDemoCards;
window.renderWorkerView = renderWorkerView;
window.setupRMEditLogTab = setupRMEditLogTab;

// Round 2 (Jul 10 2026) — see core.js for explanation.
window._renderDispSummaryData = _renderDispSummaryData;
window._rptTblSort = _rptTblSort;
window._showFilterClearBtn = _showFilterClearBtn;
window.addResidualToNewDye = addResidualToNewDye;
window.applyTableFilter = applyTableFilter;
window.approveDispatch = approveDispatch;
window.approveDyeLot = approveDyeLot;
window.approveEntry = approveEntry;
window.approvePackEntry = approvePackEntry;
window.approveWindEntry = approveWindEntry;
window.bevSortToggle = bevSortToggle;
window.cancelPartyOrder = cancelPartyOrder;
window.clearMachFilter = clearMachFilter;
window.clearSingleFilter = clearSingleFilter;
window.clearWorkFilter = clearWorkFilter;
window.dashAlertNav = dashAlertNav;
window.deleteFirebaseBackup = deleteFirebaseBackup;
window.deleteMasterItem = deleteMasterItem;
window.deleteUser = deleteUser;
window.executeOverride = executeOverride;
window.exportBackupJSON = exportBackupJSON;
window.exportCurrentCSV = exportCurrentCSV;
window.exportFirebaseBackup = exportFirebaseBackup;
window.fillLogin = fillLogin;
window.filterLotOpts = filterLotOpts;
window.manualBackup = manualBackup;
window.navToParty = navToParty;
window.onAdsGradeChange = onAdsGradeChange;
window.onAdsVendorChange = onAdsVendorChange;
window.onDSRowSelect = onDSRowSelect;
window.onDispLotChange = onDispLotChange;
window.onDispRowInput = onDispRowInput;
window.onDsrGradeChange = onDsrGradeChange;
window.onDsrVendorChange = onDsrVendorChange;
window.onDyeSourceLotChange = onDyeSourceLotChange;
window.onRecycleLotSelect = onRecycleLotSelect;
window.onResidualRowChange = onResidualRowChange;
window.openAddDelivery = openAddDelivery;
window.openAdminDelConfirm = openAdminDelConfirm;
window.openAdminDirectDelete = openAdminDirectDelete;
window.openChangePwModal = openChangePwModal;
window.openClearStage = openClearStage;
window.openDeadStockModal = openDeadStockModal;
window.openDeleteRequest = openDeleteRequest;
window.openDyeLifecycle = openDyeLifecycle;
window.openDyeSplitModal = openDyeSplitModal;
window.openEditEntryModal = openEditEntryModal;
window.openFlagModal = openFlagModal;
window.openLinkOrder = openLinkOrder;
window.openMasterEdit = openMasterEdit;
window.openOverride = openOverride;
window.openPartyFromDyeLot = openPartyFromDyeLot;
window.openRMEdit = openRMEdit;
window.openRMLifecycle = openRMLifecycle;
window.openScrapModal = openScrapModal;
window.openVoidEntry = openVoidEntry;
window.openVoidModal = openVoidModal;
window.openVoidRMLotCascade = openVoidRMLotCascade;
window.recalcLotSummary = recalcLotSummary;
window.refreshWDyeLots = refreshWDyeLots;
window.rejectDispatch = rejectDispatch;
window.rejectDyeLot = rejectDyeLot;
window.rejectEntry = rejectEntry;
window.rejectPackEntry = rejectPackEntry;
window.rejectWindEntry = rejectWindEntry;
window.removeDispatchLotRow = removeDispatchLotRow;
window.renderChallan = renderChallan;
window.renderDyeStock = renderDyeStock;
window.renderPartyTracker = renderPartyTracker;
window.renderRMStock = renderRMStock;
window.saveDyeLotStartingNo = saveDyeLotStartingNo;
window.saveMasterEdit = saveMasterEdit;
window.setPackFilter = setPackFilter;
window.setWasteFilter = setWasteFilter;
window.setWasteStage = setWasteStage;
window.showStageEndRef = showStageEndRef;
window.submitOverride = submitOverride;
window.toggleDeliveries = toggleDeliveries;
window.toggleLCStage = toggleLCStage;
window.toggleSort = toggleSort;
window.toggleSourceRows = toggleSourceRows;
window.toggleUser = toggleUser;
window.updateDyeTotal = updateDyeTotal;
window.updateLotAvailHint = updateLotAvailHint;
window.updateMachineCap = updateMachineCap;
window.updateStageAvail = updateStageAvail;
window.checkRMUidStatus = checkRMUidStatus;
window.checkOrphanedLots = checkOrphanedLots;
window.cleanupOrphanedLots = cleanupOrphanedLots;
window.runRMUidMigration = runRMUidMigration;
window.voidDyeSplit = voidDyeSplit;
window.voidResidualTransfer = voidResidualTransfer;
window.openEditResidualTransfer = openEditResidualTransfer;
window.submitEditResidualTransfer = submitEditResidualTransfer;
window.voidScrap = voidScrap;
window.voidDeadStock = voidDeadStock;
window.openEditDeadStock = openEditDeadStock;
window.submitEditDeadStock = submitEditDeadStock;
window.voidRMDelivery = voidRMDelivery;
window.voidRMReturn = voidRMReturn;
window.openEditRMReturn = openEditRMReturn;
window.submitEditRMReturn = submitEditRMReturn;
window.vtSelectVendor = vtSelectVendor;
window.wDispRowAvail = wDispRowAvail;
window.wDispAddLotRow = wDispAddLotRow;
window.wDyeAddSourceRow = wDyeAddSourceRow;
window.wDyeCalcTotal = wDyeCalcTotal;
window.wJumpStage = wJumpStage;
window.wPackLotChange = wPackLotChange;
window.wShowDyeEndRef = wShowDyeEndRef;
window.wShowEndRef = wShowEndRef;
window.wSubmitDisp = wSubmitDisp;
window.wSubmitDyeEnd = wSubmitDyeEnd;
window.wSubmitDyeStart = wSubmitDyeStart;
window.wSubmitEnd = wSubmitEnd;
window.wSubmitPack = wSubmitPack;
window.wSubmitStart = wSubmitStart;
window.wSubmitWindEnd = wSubmitWindEnd;
window.wSubmitWindStart = wSubmitWindStart;
window.wSwitchTab = wSwitchTab;
window.wTab = wTab;
window.wUpdateAvail = wUpdateAvail;
window.wWindLotChange = wWindLotChange;

// Round 3 (Jul 10 2026, found by Antigravity's review): these were also
// missed in the first two window-binding passes.
window.vtToggleVoided = vtToggleVoided;
window.renderDashPartyDispatch = renderDashPartyDispatch;
