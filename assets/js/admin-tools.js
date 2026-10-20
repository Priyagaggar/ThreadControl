// admin-tools.js — Admin Tools: password-confirmation actions,
// bring-back-a-rejected-entry overrides, and the stale/duplicate/
// address-mismatch scan tools from Masters' System tab.
// Aug 26 2026 — Module split effort, planned with Priyam: extracted
// byte-for-byte from pages.js, same real, established pattern as
// every other extraction. Real, complete inventory: 13 functions.
// Real, honest note per Priyam's direct instruction: the last 6
// functions here (runStaleLotScan through
// downloadLotAddressMismatchReport) are not currently wired to any
// live button — confirmed, genuinely superseded by newer, actively-
// used versions in masters.js. Deliberately kept, not deleted, since
// the same real, working logic could be useful again if this exact
// kind of scan is ever needed in the future.

import { State, WORKER_URL, _getHeaders, _refreshAndRender, apiPost, _postHeaders, _verifyPasswordViaWorker, closeModal, logout, openModal, setAlert, showToast, today } from './core.js';
import { checkRMUidStatus } from './masters.js';
import { _renderDailyCheckReport } from './editlog.js';
import { renderAll } from './pages.js';

export function adminPasswordAction(action,entryId='',entryType=''){document.getElementById('pwd-input').value='';document.getElementById('pwd-action').value=action;document.getElementById('pwd-entry-id').value=entryId;document.getElementById('pwd-entry-type').value=entryType;document.getElementById('pwd-alert').innerHTML='';const titles={reset:'⚠ Reset All Data'};const descs={reset:'⛔ DANGER: This will permanently erase ALL production data. Type RESET in the confirmation box and enter your password to continue. This CANNOT be undone.'};document.getElementById('pwd-modal-title').textContent=titles[action]||'Admin Confirmation';document.getElementById('pwd-modal-desc').textContent=descs[action]||'Enter admin password to continue.';const _cpRow=document.getElementById('pwd-confirm-row');const _cpField=document.getElementById('pwd-confirm-phrase');if(_cpRow){_cpRow.style.display=action==='reset'?'':'none';}
if(_cpField){_cpField.value='';}
openModal('pwd-modal');}

export async function confirmAdminPwd(){const pwd=document.getElementById('pwd-input').value;const action=document.getElementById('pwd-action').value;const entryId=document.getElementById('pwd-entry-id').value;const entryType=document.getElementById('pwd-entry-type').value;let confirmPhrase='';if(action==='reset'){confirmPhrase=(document.getElementById('pwd-confirm-phrase')?.value||'').trim();if(confirmPhrase!=='RESET'){setAlert('pwd-alert','Type RESET in the confirmation box to proceed','alert-err');return;}
closeModal('pwd-modal');await _executePwdAction(action,null,null,pwd,confirmPhrase);return;}
const matched=await _verifyPasswordViaWorker(pwd);
if(!matched){setAlert('pwd-alert','Incorrect password','alert-err');document.getElementById('pwd-input').value='';return;}
closeModal('pwd-modal');_executePwdAction(action,matched,{...matched});}

export async function _executePwdAction(action,admin,adminCopy,password,confirmPhrase){if(action==='reset'){const btn=document.querySelector('[onclick*="reset"]');if(btn)btn.textContent='Resetting...';
try{
  const {ok,data,error,networkError}=await apiPost('/api/admin/reset-all',{password,confirmPhrase});
  if(networkError)throw new Error(error);
  if(!ok){if(btn)btn.textContent='↺ Reset All Data';setAlert('pwd-alert',error||'Could not reset','alert-err');return;}
  const cleanDB={lots:[],stageEntries:[],dyeBatches:[],dispatches:[],voidLog:[],lotFlags:{},deleteRequests:[]};
  Object.assign(State.DB,cleanDB);localStorage.setItem('tcv2',JSON.stringify(State.DB));localStorage.setItem('tcv2_backup',JSON.stringify(State.DB));
  console.log('Reset complete — Firebase updated (user accounts unaffected)');logout();
}catch(e){if(btn)btn.textContent='↺ Reset All Data';setAlert('pwd-alert','Network error — not reset: '+e.message,'alert-err');}
}}

export function openOverride(id,type,grade,vendor){if(State.currentUser?.role!=='admin'&&State.currentUser?.role!=='manager'){showToast('Admin only','err');return;}
// Aug 26 2026 — real, direct extension for RM Lots specifically, built
// via direct discussion with Priyam after a genuinely fair, direct
// criticism: RM was the only stage without any way to bring back a
// Voided lot. RM's own lookup needs the full lot+grade+vendor address,
// not just id alone — several different, real lots commonly share the
// same lot number, the exact same ambiguity already found and fixed
// for the void chain and the flag system.
const _ovColls={stage:State.DB.stageEntries,dye:State.DB.dyeLots,wind:State.DB.windEntries,pack:State.DB.packEntries,dispatch:State.DB.dispatches,rm:State.DB.lots};
const e=type==='rm'?(_ovColls.rm||[]).find(x=>x.id===id&&x.grade===grade&&x.vendor===vendor):(_ovColls[type]||[]).find(x=>x.id===id);
if(!e){showToast('Entry not found','err');return;}
if(e.status!=='Rejected'&&e.status!=='Voided'){showToast('Only Rejected or Voided entries can be brought back','err');return;}
document.getElementById('override-entry-id').value=id;document.getElementById('override-entry-type').value=type;document.getElementById('override-entry-grade').value=grade||'';document.getElementById('override-entry-vendor').value=vendor||'';document.getElementById('override-alert').innerHTML='';document.getElementById('override-reason-cat').value='';document.getElementById('override-reason-text').value='';document.getElementById('override-pwd').value='';const infoLines=[`<strong>${type.toUpperCase()} Entry</strong> — ID: ${id}`,`Status: <strong>${e.status}</strong>`];if(e.lotId)infoLines.push(`Lot: ${e.lotId} | Grade: ${e.grade||'—'}`);if(e.dyeLotNo)infoLines.push(`Dye Lot: ${e.dyeLotNo} | Shade: ${e.shade||'—'}`);document.getElementById('override-entry-info').innerHTML=infoLines.join('<br>');const fg=(label,fid,val,t='text')=>`<div class="fg"><label class="fl">${label}</label><input class="fi" type="${t}" id="${fid}" value="${val??''}"></div>`;let fields='';if(type==='stage')fields=fg('In Units','ov-inUnits',e.inUnits,'number')+fg('In Weight','ov-inWeight',e.inWeight,'number')+fg('Out Units','ov-outUnits',e.outUnits??'','number')+fg('Out Weight','ov-outWeight',e.outWeight??'','number');else if(type==='dye')fields=fg('Dye Lot No','ov-dyeLotNo',e.dyeLotNo)+fg('Shade','ov-shade',e.shade)+fg('In Cones','ov-totalInCones',e.totalInCones,'number')+fg('In Kg','ov-totalInWeight',e.totalInWeight,'number')+fg('Out Cones','ov-outCones',e.outCones,'number')+fg('Out Kg','ov-outWeight',e.outWeight,'number');else if(type==='wind')fields=fg('In Cones','ov-inCones',e.inCones,'number')+fg('In Kg','ov-inWeight',e.inWeight,'number')+fg('Out Cones','ov-outCones',e.outCones??'','number')+fg('Out Kg','ov-outWeight',e.outWeight??'','number');else if(type==='pack')fields=fg('In Cones','ov-inCones',e.inCones,'number')+fg('Bags Out','ov-bags',e.bags,'number')+fg('Weight (kg)','ov-weight',e.weight,'number');else if(type==='dispatch')fields=fg('Bags','ov-bags',e.bags,'number')+fg('Weight (kg)','ov-weight',e.weight,'number');document.getElementById('override-fields').innerHTML=fields;openModal('override-modal-overlay');}

export async function executeOverride(id,type){
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
    await _refreshAndRender(['stageEntries'],renderAll);showToast('Override: Approved ✓ — Live Stock updated');
  }catch(e){showToast('Network error — not saved: '+e.message,'err');}
}

export async function submitOverride(){const setAlert=msg=>{document.getElementById('override-alert').innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;};const id=document.getElementById('override-entry-id').value;const type=document.getElementById('override-entry-type').value;const grade=document.getElementById('override-entry-grade').value;const vendor=document.getElementById('override-entry-vendor').value;const reasonCat=document.getElementById('override-reason-cat').value;const reasonText=document.getElementById('override-reason-text').value.trim();const pwd=document.getElementById('override-pwd').value;if(!reasonCat){setAlert('Select override reason');return;}
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
// Aug 26 2026 — real, direct extension for RM: the server fetches this
// entry directly by /tc/lots/{id}, and RM Lots are genuinely stored
// keyed by their full lot+grade+vendor composite, not the raw lot
// number alone — several different, real lots commonly share the same
// number, the exact same ambiguity already fixed for void and flags.
const _serverId=type==='rm'?`${id}__${grade}__${vendor}`:id;
try{
  const {ok,data,error,networkError}=await apiPost('/api/override-approve',{type:_serverType,id:_serverId,fields,password:pwd,username:State.currentUser.username,reasonCat,reasonText,changedBy:State.currentUser.name});
  if(networkError)throw new Error(error);
  if(!ok){setAlert(error||'Could not bring back entry');return;}
  closeModal('override-modal-overlay');showToast('Entry brought back ✓','warn');
  const _ovTable={stage:'stageEntries',dye:'dyeLots',wind:'windEntries',pack:'packEntries',dispatch:'dispatches'}[type];
  await _refreshAndRender(_ovTable?[_ovTable]:[],renderAll);
}catch(e){setAlert('Network error — not saved: '+e.message);}
}

export async function runDailyCheckNow(){
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
    // Sep 8 2026 — real, direct fix built via direct discussion with
    // Priyam, from "manual run is failing" with no visible reason:
    // this used to only ever stop on a fresh report or a 60-second
    // timeout — a genuine crash meant staring at "running..." for the
    // full minute before silently giving up with nothing shown. Now
    // also stops the moment a fresh error (from this specific run,
    // not some old leftover one) shows up, and displays it.
    const runStartedAt=new Date().toISOString();
    let attempts=0;
    const poll=setInterval(async()=>{
      attempts++;
      const r=await fetch(WORKER_URL+'/api/daily-check/latest',{headers:_postHeaders()});
      const d=await r.json();
      const isToday=d.report&&d.report.id===new Date().toISOString().slice(0,10);
      const hasFreshError=d.lastError&&d.lastError.at&&d.lastError.at>runStartedAt;
      if(isToday||hasFreshError||attempts>=20){
        clearInterval(poll);
        _renderDailyCheckReport(d.report, hasFreshError?d.lastError:null, d.backupStatus, d.lastTiming);
        if(btn)btn.disabled=false;
      }
    },3000);
  }catch(e){
    showToast('Network error: '+e.message,'err');
    if(btn)btn.disabled=false;
  }
}

export async function runStaleLotScan(){
  const el=document.getElementById('rm-stale-scan-status');if(!el)return;
  el.textContent='Scanning...';
  try{
    const res=await fetch(WORKER_URL+'/api/admin/scan-stale-lot-addresses',{headers:_getHeaders()});
    const data=await res.json();
    if(!res.ok||!data.success){el.innerHTML='<span style="color:var(--re)">Could not complete the scan</span>';return;}
    if(data.clean){
      el.innerHTML=`<span style="color:var(--gr)">✓ Clean — checked ${data.totalSoftEntries} Soft entries, ${data.totalRmReturns} RM Returns, ${data.totalResiduals} Residual records, no stale addresses found</span>`;
    }else{
      let html=`<span style="color:var(--ye)">Found real issues:</span><ul style="margin:6px 0 0 18px;padding:0">`;
      if(data.staleSnapshotCount>0)html+=`<li>${data.staleSnapshotCount} Soft entr${data.staleSnapshotCount===1?'y':'ies'} with a stale saved address</li>`;
      if(data.staleReturnCount>0)html+=`<li>${data.staleReturnCount} RM Return${data.staleReturnCount===1?'':'s'} whose text no longer matches its lot</li>`;
      if(data.staleResidualCount>0)html+=`<li>${data.staleResidualCount} Residual record${data.staleResidualCount===1?'':'s'} whose text no longer matches its lot</li>`;
      html+='</ul><div style="margin-top:6px;font-size:0.68rem">Check the browser console for the full, detailed list of every affected record.</div>';
      el.innerHTML=html;
      console.warn('[Stale Lot Address Scan] Full results:',data);
      if(data.staleSnapshots?.length)console.warn('[Stale Lot Address Scan] Soft entries with stale snapshots:',data.staleSnapshots);
      if(data.staleReturns?.length)console.warn('[Stale Lot Address Scan] RM Returns with stale text:',data.staleReturns);
      if(data.staleResiduals?.length)console.warn('[Stale Lot Address Scan] Residuals with stale text:',data.staleResiduals);
    }
  }catch(e){el.innerHTML='<span style="color:var(--re)">Network error — '+e.message+'</span>';}
}

export async function runDuplicateLotScan(){
  const el=document.getElementById('rm-dup-scan-status');if(!el)return;
  el.textContent='Scanning...';
  try{
    const res=await fetch(WORKER_URL+'/api/admin/scan-duplicate-lot-ids',{headers:_getHeaders()});
    const data=await res.json();
    if(!res.ok||!data.success){el.innerHTML='<span style="color:var(--re)">Could not complete the scan</span>';return;}
    if(data.clean){
      el.innerHTML=`<span style="color:var(--gr)">✓ Clean — checked ${data.totalLotsChecked} lot records (active + archive), no lot exists in both at once, no duplicate permanent IDs found</span>`;
    }else{
      const sameIdCount=data.genuineDuplicates.filter(d=>d.sameUidAcrossCopies).length;
      const diffIdCount=data.genuineDuplicateCount-sameIdCount;
      let html=`<span style="color:${diffIdCount>0?'var(--re)':'var(--ye)'}">Found ${data.genuineDuplicateCount} real lot(s) existing in both active and archive`;
      if(diffIdCount>0)html+=` — <strong>${diffIdCount} of them have two DIFFERENT permanent IDs</strong>, genuinely needing correction`;
      if(sameIdCount>0)html+=`, ${sameIdCount} correctly share the same ID already`;
      html+='.</span><div style="margin-top:6px;font-size:0.68rem">Check the browser console for the full, detailed list.</div>';
      el.innerHTML=html;
      console.warn('[Duplicate Lot ID Scan] '+data.genuineDuplicateCount+' genuine duplicate(s) found:');
      data.genuineDuplicates.forEach((d,i)=>{
        console.warn(`  #${i+1} — Lot ${d.lotId}, grade="${d.grade}", vendor="${d.vendor}"`);
        d.copies.forEach(c=>{
          console.warn(`      ${c.table.toUpperCase()}: key="${c.key}" | permanent ID = ${c.fullRecord.uid} | address matches its own text? ${c.addressMatchesOwnText?'YES':'NO'} | ${c.realUsageCount} real record(s) reference this ID`);
          console.warn('      Full record:',c.fullRecord);
          if(c.relatedRecords.length){console.warn('      All related records:',c.relatedRecords);}
        });
        console.warn(`      → Same ID on both copies? ${d.sameUidAcrossCopies?'YES, already fine':'NO — genuinely different IDs, needs correction'}`);
      });
    }
  }catch(e){el.innerHTML='<span style="color:var(--re)">Network error — '+e.message+'</span>';}
}

export async function cleanupOrphanedLots(){
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

export async function downloadLotIssuesReport(){
  if(typeof XLSX==='undefined'){showToast('SheetJS not loaded','err');return;}
  showToast('Building report...');
  try{
    const [staleRes,dupRes]=await Promise.all([
      fetch(WORKER_URL+'/api/admin/scan-stale-lot-addresses',{headers:_getHeaders()}),
      fetch(WORKER_URL+'/api/admin/scan-duplicate-lot-ids',{headers:_getHeaders()}),
    ]);
    const stale=await staleRes.json();
    const dup=await dupRes.json();
    if(!stale.success||!dup.success){showToast('Could not build report — scan failed','err');return;}

    const wb=XLSX.utils.book_new();

    // Sheet 1 — Duplicate lot IDs (active vs archive), one row per copy, side by side comparison possible
    const dupRows=[];
    const relatedRows=[];
    (dup.genuineDuplicates||[]).forEach(d=>{
      d.copies.forEach(c=>{
        // Aug 2 2026 — genuinely, completely full detail, every field
        // from the real record as its own column, since a summary was
        // fairly, directly challenged as not enough to actually trust.
        const r=c.fullRecord||{};
        const row={'Lot ID':d.lotId,'Grade (identity)':d.grade,'Vendor (identity)':d.vendor,'Table':c.table,'Firebase Key':c.key,'Does address match its own grade/vendor text?':c.addressMatchesOwnText?'YES':'NO','Real Downstream Usage (records referencing this permanent ID)':c.realUsageCount,'Same ID on both copies?':d.sameUidAcrossCopies?'YES':'NO'};
        Object.keys(r).forEach(k=>{
          if(k==='deliveries'&&Array.isArray(r[k])){row['Deliveries (raw)']=JSON.stringify(r[k]);}
          else if(typeof r[k]==='object'){row[k]=JSON.stringify(r[k]);}
          else{row[k]=r[k];}
        });
        dupRows.push(row);
        // Aug 2 2026 — Priyam's direct, fair correction: not just a
        // count, the actual, complete list of every real related
        // record, one row each, so this can genuinely be checked.
        (c.relatedRecords||[]).forEach(rr=>{
          relatedRows.push({'Lot ID':d.lotId,'Permanent ID':r.uid,'Table (source record was found in)':rr.table,'Record Detail (raw)':JSON.stringify(rr.record)});
        });
      });
    });
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(dupRows),'Duplicate Lot IDs');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(relatedRows.length?relatedRows:[{'Note':'No related records found for any duplicate'}]),'Related Records (Full List)');

    // Sheet 2 — Stale Soft entry snapshots
    const staleSoftRows=(stale.staleSnapshots||[]).map(s=>({'Soft Entry ID':s.id,'Lot ID':s.lotId,'Grade':s.grade,'Vendor':s.vendor,'Saved Snapshot Address':s.savedSnapshot}));
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(staleSoftRows.length?staleSoftRows:[{'Note':'None found — clean'}]),'Stale Soft Snapshots');

    // Sheet 3 — Stale RM Returns
    const staleReturnRows=(stale.staleReturns||[]).map(r=>({'RM Return ID':r.id,'Lot ID':r.lotId,'Grade':r.grade,'Vendor':r.vendor}));
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(staleReturnRows.length?staleReturnRows:[{'Note':'None found — clean'}]),'Stale RM Returns');

    // Sheet 4 — Stale Residuals
    const staleResidualRows=(stale.staleResiduals||[]).map(r=>({'Residual ID':r.id,'Lot ID':r.lotId,'Grade':r.grade,'Vendor':r.vendor}));
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(staleResidualRows.length?staleResidualRows:[{'Note':'None found — clean'}]),'Stale Residuals');

    // Sheet 5 — Summary, so the totals are visible at a glance too
    const summaryRows=[
      {'Check':'Duplicate lot IDs (active+archive)','Total Checked':dup.totalLotsChecked,'Issues Found':dup.genuineDuplicateCount},
      {'Check':'Stale Soft entry snapshots','Total Checked':stale.totalSoftEntries,'Issues Found':stale.staleSnapshotCount},
      {'Check':'Stale RM Returns','Total Checked':stale.totalRmReturns,'Issues Found':stale.staleReturnCount},
      {'Check':'Stale Residuals','Total Checked':stale.totalResiduals,'Issues Found':stale.staleResidualCount},
    ];
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(summaryRows),'Summary');

    XLSX.writeFile(wb,`ThreadControl_Lot_Issues_Report_${today()}.xlsx`);
    showToast('Report downloaded ✓');
  }catch(e){showToast('Failed to build report: '+e.message,'err');}
}

export async function runLotAddressMismatchScan(){
  const el=document.getElementById('rm-addr-mismatch-status');if(!el)return;
  el.textContent='Scanning...';
  try{
    const res=await fetch(WORKER_URL+'/api/admin/scan-lot-address-mismatches',{headers:_getHeaders()});
    const data=await res.json();
    if(!res.ok||!data.success){el.innerHTML='<span style="color:var(--re)">Could not complete the scan</span>';return;}
    if(data.clean){
      el.innerHTML=`<span style="color:var(--gr)">✓ Clean — checked ${data.totalLotsChecked} lots, every one correctly matches its own text</span>`;
    }else{
      el.innerHTML=`<span style="color:var(--ye)">Found ${data.mismatchCount} lot(s) whose saved address does not match their own current text. Download the Excel file for the complete, real data on each one.</span>`;
      console.warn('[Lot Address Mismatch Scan] Full results:',data);
    }
  }catch(e){el.innerHTML='<span style="color:var(--re)">Network error — '+e.message+'</span>';}
}

export async function downloadLotAddressMismatchReport(){
  if(typeof XLSX==='undefined'){showToast('SheetJS not loaded','err');return;}
  showToast('Building report...');
  try{
    const res=await fetch(WORKER_URL+'/api/admin/scan-lot-address-mismatches',{headers:_getHeaders()});
    const data=await res.json();
    if(!res.ok||!data.success){showToast('Could not build report — scan failed','err');return;}

    const wb=XLSX.utils.book_new();
    // Aug 5 2026 — same principle as everything else built today: the
    // complete, real record for each mismatch, every field as its own
    // column, so this can be checked directly, not summarized.
    const rows=data.mismatches.map(m=>{
      const r=m.fullRecord||{};
      const row={'Table':m.table,'Saved (Stored) Address':m.storedKey,'Correct Address (from own text)':m.correctKey};
      Object.keys(r).forEach(k=>{
        if(k==='deliveries'&&Array.isArray(r[k])){row['Deliveries (raw)']=JSON.stringify(r[k]);}
        else if(typeof r[k]==='object'){row[k]=JSON.stringify(r[k]);}
        else{row[k]=r[k];}
      });
      return row;
    });
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows.length?rows:[{'Note':'None found — clean, every lot correctly matches its own text'}]),'Lot Address Mismatches');
    const summaryRows=[{'Check':'Lot address matches own text','Total Lots Checked':data.totalLotsChecked,'Mismatches Found':data.mismatchCount}];
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(summaryRows),'Summary');

    XLSX.writeFile(wb,`ThreadControl_Lot_Address_Mismatches_${today()}.xlsx`);
    showToast('Report downloaded ✓');
  }catch(e){showToast('Failed to build report: '+e.message,'err');}
}

window.adminPasswordAction = adminPasswordAction;
window.confirmAdminPwd = confirmAdminPwd;
window.openOverride = openOverride;
window.executeOverride = executeOverride;
window.submitOverride = submitOverride;
window.runDailyCheckNow = runDailyCheckNow;
