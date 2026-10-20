// backup-export.js — Backup & Export: Excel/CSV/PDF export of the
// entire app's data, and the whole Firebase + local backup system.
// Aug 26 2026 — Module split effort, planned with Priyam: extracted
// byte-for-byte from pages.js, same real, established pattern as
// every other extraction. Real, complete inventory: 14 functions.
// fmtN deliberately stays in pages.js and is imported from there,
// confirmed genuinely shared — used by 6 other places outside these
// 14 functions too, not exclusive to Backup & Export.

import { BACKUP_KEY, MAX_BACKUPS, State, _fbAuthedFetch, _loadArchiveWithCache, apiPost, getSoftResidualOut, getRMReturnedOut, appr, getDyeBal, getDyeLotCurrentStage, getPackBal, getRMBalance, getSoftBalanceWeight, getSoftConsumedByDye, getSoftOut, getTotalDispatched, getTotalEntries, getVendorRatioForDyeLot, getWindBal, openModal, showToast, today } from './core.js';
import { fmtN } from './pages.js';

export function manualBackup(){if(!State.firebaseLoaded||!State.fbDB){if(typeof showToast==='function')showToast('Cannot backup — Firebase not connected','err');return;}
runBackup(true);}

export function exportFirebaseBackup(key){showToast('Preparing download...');_fbAuthedFetch('/backups/'+key+'/data.json').then(r=>r.json()).then(function(b){if(!b){showToast('Backup data not found','err');return;}const b2={data:b};b=b2;
const blob=new Blob([JSON.stringify({tc:b.data},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='ThreadControl_Backup_'+key+'.json';a.click();URL.revokeObjectURL(a.href);showToast('Backup downloaded ✓');}).catch(e=>showToast('Download failed — '+e.message,'err'));}

export async function restoreFromBackup(key,lots,totalEntries){
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

export async function deleteFirebaseBackup(type,dateKey){
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

export function exportBackupJSON(dateKey){try{let data;if(dateKey==='live'){data={tc:JSON.parse(JSON.stringify(State.DB))};}else{const backups=JSON.parse(localStorage.getItem(BACKUP_KEY)||'{}');if(!backups[dateKey]){alert('Backup not found');return;}
data={tc:backups[dateKey].data};}
const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`ThreadControl_Backup_${dateKey === 'live' ? new Date().toISOString().split('T')[0] : dateKey}.json`;a.click();URL.revokeObjectURL(url);showToast('Backup downloaded ✓');}catch(e){alert('Export failed: '+e.message);}}

export function exportCurrentCSV(){try{exportCSV();}catch(e){alert('CSV export failed: '+e.message);}}

export function getBackupList(){try{const backups=JSON.parse(localStorage.getItem(BACKUP_KEY)||'{}');return Object.entries(backups).sort((a,b)=>b[0].localeCompare(a[0])).map(([date,info])=>({date,savedAt:info.savedAt,lots:info.lots||0,entries:info.entries||0,dispatches:info.dispatches||0}));}catch(e){return[];}}

export function showBackupModal(){document.getElementById('backup-modal-content').innerHTML=`
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

export function runBackup(isManual){if(!State.firebaseLoaded||!State.fbDB){console.log('Backup skipped: Firebase not confirmed ready');return;}
if(!Array.isArray(State.DB.lots)){console.log('Backup skipped: DB.lots missing — structure invalid');return;}
const currentTotal=getTotalEntries();if(!isManual){if(currentTotal<10){console.log('Backup skipped: total entries ('+currentTotal+') below minimum of 10');return;}
State.fbDB.ref('/backups').orderByKey().limitToLast(1).once('value',snap=>{const all=snap.val()||{};const keys=Object.keys(all);if(keys.length>0){const last=all[keys[0]];const lastTotal=(last.stageEntries||0)+(last.dyeBatches||0)+(last.dyeLots||0)
+(last.windEntries||0)+(last.packEntries||0)+(last.dispatches||0);const currentVoidLog=(State.DB.voidLog||[]).length;const currentDelReq=(State.DB.deleteRequests||[]).length;const lastVoidLog=last.voidLog||0;const lastDelReq=last.deleteRequests||0;const validDeletion=(currentVoidLog>lastVoidLog)||(currentDelReq>lastDelReq);if(lastTotal>0&&currentTotal<lastTotal&&!validDeletion){console.warn('Backup skipped: entries dropped '+lastTotal+' → '+currentTotal+' — no void/delete activity detected');return;}}
_writeBackup(currentTotal,false);});}else{_writeBackup(currentTotal,true);}}

export function _writeBackup(currentTotal,isManual){const now=new Date();const ts=now.toISOString().slice(0,16).replace(/[T:]/g,'-');
// Store meta and data separately — modal only fetches meta (1KB), restore fetches data (4MB)
const meta={savedAt:now.toISOString(),isManual:isManual||false,lots:(State.DB.lots||[]).length,stageEntries:(State.DB.stageEntries||[]).length,dyeBatches:(State.DB.dyeBatches||[]).length,dyeLots:(State.DB.dyeLots||[]).length,windEntries:(State.DB.windEntries||[]).length,packEntries:(State.DB.packEntries||[]).length,dispatches:(State.DB.dispatches||[]).length,totalEntries:currentTotal,voidLog:(State.DB.voidLog||[]).length,deleteRequests:(State.DB.deleteRequests||[]).length,users:(State.DB.users||[]).length};
const updates={};
updates['/backups/'+ts+'/meta']=meta;
updates['/backups/'+ts+'/data']=JSON.parse(JSON.stringify(State.DB));
State.fbDB.ref().update(updates).then(()=>{
  console.log('✓ Backup '+(isManual?'[Manual]':'[Auto]')+' /backups/'+ts+' — '+currentTotal+' entries, '+(State.DB.lots||[]).length+' lots');
  // Cleanup: shallow fetch (keys only, ~1KB) — delete oldest beyond MAX_BACKUPS.
  // Aug 6 2026 — real, confirmed bug: this used a hardcoded 20 here, while
  // the automatic nightly backup (worker.js) correctly used MAX_BACKUPS (5)
  // — two systems writing into the SAME /backups/ location, silently
  // disagreeing on how many should exist. Also: this file's own MAX_BACKUPS
  // constant said 7, not 5 — a second, separate mismatch against the
  // server's real 5. Both now aligned to 5, single source of truth.
  _fbAuthedFetch('/backups.json?shallow=true').then(r=>r.json()).then(function(shallowKeys){
    if(!shallowKeys)return;
    const keys=Object.keys(shallowKeys).sort();
    if(keys.length>MAX_BACKUPS){
      keys.slice(0,keys.length-MAX_BACKUPS).forEach(k=>State.fbDB.ref('/backups/'+k).remove());
      console.log('Backup retention: kept last '+MAX_BACKUPS+', deleted',keys.length-MAX_BACKUPS,'old backups');
    }
  }).catch(e=>console.warn('Backup cleanup failed:',e));
  if(isManual&&typeof showToast==='function')showToast('Backup saved to Firebase ✓ — '+currentTotal+' entries');
}).catch(e=>{console.warn('Backup write failed:',e);if(isManual&&typeof showToast==='function')showToast('Backup failed — check connection','err');});
try{localStorage.setItem('tcv2_backup',JSON.stringify(State.DB));}catch(e){}
try{const _meta2=JSON.parse(localStorage.getItem('tcv2_backup_meta')||'{}');_meta2.lastBackup=now.toISOString();_meta2.lastTotal=currentTotal;_meta2.lastLots=(State.DB.lots||[]).length;localStorage.setItem('tcv2_backup_meta',JSON.stringify(_meta2));}catch(e){}}

export function exportToExcel(){if(typeof XLSX==='undefined'){showToast('SheetJS not loaded','err');return;}
showToast('Preparing export — merging in archived data...');
_loadArchiveWithCache(()=>{_doExportToExcel();});
}

export function _doExportToExcel(){
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
  rawRows.push({stage:'Soft',entryId:s(e.id),lotId:s(e.lotId),dyeLotId:'',dyeLotNo:'',shade:'',grade:s(e.grade),vendor:s(e.vendor),mill:'',party:'',orderId:'',challanId:'',invoiceNo:'',machine:s(e.machine),startWorker:s(e.startWorker),endWorker:s(e.endWorker),worker:'',startTime:fmtD(e.startTime),endTime:fmtD(e.endTime),timestamp:'',status:s(e.status),approvedBy:s(e.approvedBy),approvedAt:fmtD(e.approvedAt),inUnits_bags:fmtN(e.inUnits),inWeight_kg:fmtN(e.inWeight),outUnits_bags:fmtN(e.outUnits),outWeight_kg:fmtN(e.outWeight),wasteUnits_bags:fmtN(e.wasteUnits),wasteWeight_kg:fmtN(e.wasteWeight),inCones:'',outCones:'',wasteCones:'',bags:'',weight_kg:'',gainKg:'',gainPct:'',kgLoss:'',kgLossPct:'',coneLoss:'',sourceLotId:'',sourceGrade:'',sourceVendor:'',sourceCones:'',sourceWeight_kg:'',deliveryDate:'',deliveryBags:'',deliveryKg:'',addedBy:'',qtyOrdered_kg:'',qtyFulfilled_kg:'',dueDate:'',cancelReason:'',notes:s([e.startNote,e.endNote?('End: '+e.endNote):''].filter(Boolean).join(' | ')),createdAt:''});
});

// Dye lots — one row per source lot
(State.DB.dyeLots||[]).forEach(d=>{
  const sources=(d.sources||[]);
  const baseRow={stage:'Dye',entryId:s(d.id),lotId:'',dyeLotId:s(d.id),dyeLotNo:s(d.dyeLotNo),shade:s(d.shade),grade:sources[0]?.grade||'',vendor:sources[0]?.vendor||'',mill:'',party:'',orderId:'',challanId:'',invoiceNo:'',machine:s(d.machine),startWorker:s(d.startWorker),endWorker:s(d.endWorker),worker:'',startTime:fmtD(d.startTime),endTime:fmtD(d.endTime),timestamp:'',status:s(d.status),approvedBy:s(d.approvedBy),approvedAt:fmtD(d.approvedAt),inUnits_bags:'',inWeight_kg:fmtN(d.totalInWeight),outUnits_bags:'',outWeight_kg:fmtN(d.outWeight),wasteUnits_bags:'',wasteWeight_kg:fmtN(d.kgLoss),inCones:fmtN(d.totalInCones),outCones:fmtN(d.outCones),wasteCones:fmtN(d.coneLoss),bags:'',weight_kg:'',gainKg:'',gainPct:'',kgLoss:fmtN(d.kgLoss),kgLossPct:fmtN(d.kgLossPct),coneLoss:fmtN(d.coneLoss),deliveryDate:'',deliveryBags:'',deliveryKg:'',addedBy:'',qtyOrdered_kg:'',qtyFulfilled_kg:'',dueDate:'',cancelReason:'',notes:s([d.startNote??d.notes,d.endNote?('End: '+d.endNote):''].filter(Boolean).join(' | ')),createdAt:fmtD(d.createdAt)};
  if(!sources.length){rawRows.push({...baseRow,lotId:'',sourceLotId:'',sourceGrade:'',sourceVendor:'',sourceCones:'',sourceWeight_kg:''});}
  else{sources.forEach(src=>{rawRows.push({...baseRow,lotId:s(src.lotId),sourceLotId:s(src.lotId),sourceGrade:s(src.grade),sourceVendor:s(src.vendor),sourceCones:fmtN(src.cones),sourceWeight_kg:fmtN(src.weight)});});}
});

// Wind entries
(State.DB.windEntries||[]).forEach(e=>{
  rawRows.push({stage:'Wind',entryId:s(e.id),lotId:'',dyeLotId:s(e.dyeLotId),dyeLotNo:s(e.dyeLotNo),shade:s(e.shade),grade:s(e.grade),vendor:'',mill:'',party:'',orderId:'',challanId:'',invoiceNo:'',machine:s(e.machine),startWorker:s(e.startWorker),endWorker:s(e.endWorker),worker:'',startTime:fmtD(e.startTime),endTime:fmtD(e.endTime),timestamp:'',status:s(e.status),approvedBy:s(e.approvedBy),approvedAt:fmtD(e.approvedAt),inUnits_bags:'',inWeight_kg:fmtN(e.inWeight),outUnits_bags:'',outWeight_kg:fmtN(e.outWeight),wasteUnits_bags:'',wasteWeight_kg:fmtN(e.wasteWeight),inCones:fmtN(e.inCones),outCones:fmtN(e.outCones),wasteCones:fmtN(e.wasteCones),bags:'',weight_kg:'',gainKg:'',gainPct:'',kgLoss:'',kgLossPct:'',coneLoss:'',sourceLotId:'',sourceGrade:'',sourceVendor:'',sourceCones:'',sourceWeight_kg:'',deliveryDate:'',deliveryBags:'',deliveryKg:'',addedBy:'',qtyOrdered_kg:'',qtyFulfilled_kg:'',dueDate:'',cancelReason:'',notes:s([e.notes,e.endNotes?('End: '+e.endNotes):''].filter(Boolean).join(' | ')),createdAt:''});
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
const rmData=(State.DB.lots||[]).map(l=>({'Permanent ID':s(l.uid),'Lot ID':s(l.id),'Vendor':s(l.vendor),'Mill':s(l.mill),'Grade':s(l.grade),'Units (bags)':fmtN(l.units),'Weight (kg)':fmtN(l.weight),'Date':s(l.date),'Status':s(l.status)||'Active','Deliveries Count':(l.deliveries||[]).length,'RM Return Units':getRMReturnedOut(l.id,l.grade,l.vendor).units,'RM Return Kg':getRMReturnedOut(l.id,l.grade,l.vendor).weight,'RM Balance Units':getRMBalance(l.id,l.grade,l.vendor).units,'RM Balance Kg':getRMBalance(l.id,l.grade,l.vendor).weight,'Soft Balance Kg':getSoftBalanceWeight(l.id,l.grade,l.vendor),'Sent To Dye Kg':getSoftConsumedByDye(l.id,l.grade,l.vendor),'Residual Kg':getSoftResidualOut(l.id,l.grade,l.vendor),'Created At':fmtD(l.createdAt)}));
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
const softData=(State.DB.stageEntries||[]).filter(e=>e.stage==='Soft').map(e=>({'Entry ID':s(e.id),'Lot ID':s(e.lotId),'Permanent ID':s(e.lotUid),'Grade':s(e.grade),'Vendor':s(e.vendor),'Dead Stock ID':s(e.deadStockId),'Recycle ID':s(e.recycleId),'Machine':s(e.machine),'Start Worker':s(e.startWorker),'End Worker':s(e.endWorker),'In Bags':fmtN(e.inUnits),'In Kg':fmtN(e.inWeight),'Out Bags':fmtN(e.outUnits),'Out Kg':fmtN(e.outWeight),'Waste Bags':fmtN(e.wasteUnits),'Waste Kg':fmtN(e.wasteWeight),'Waste %':fmtN(e.inWeight)>0?((fmtN(e.wasteWeight)/fmtN(e.inWeight))*100).toFixed(2):0,'Start Time':fmtD(e.startTime),'End Time':fmtD(e.endTime),'Status':s(e.status),'Approved By':s(e.approvedBy),'Approved At':fmtD(e.approvedAt),'Start Note':s(e.startNote),'End Note':s(e.endNote)}));
XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(softData,{cellDates:true}),'Soft Entries');

// Dye Lots
const dyeLotData=(State.DB.dyeLots||[]).map(d=>({'Dye Lot ID':s(d.id),'Dye Lot No':s(d.dyeLotNo),'Shade':s(d.shade),'Grade':(d.sources||[])[0]?.grade||'','Source Lots':(d.sources||[]).map(s=>s.lotId).join(', '),'Source Vendors':(d.sources||[]).map(s=>s.vendor).join(', '),'Machine':s(d.machine),'Start Worker':s(d.startWorker),'End Worker':s(d.endWorker),'Total In Cones':fmtN(d.totalInCones),'Total In Kg':fmtN(d.totalInWeight),'Out Cones':fmtN(d.outCones),'Out Kg':fmtN(d.outWeight),'Kg Loss':fmtN(d.kgLoss),'Kg Loss %':fmtN(d.kgLossPct),'Cone Loss':fmtN(d.coneLoss),'Dye Balance Cones':getDyeBal(d.id).units,'Dye Balance Kg':getDyeBal(d.id).weight,'Wind Balance Cones':getWindBal(d.id).units,'Wind Balance Kg':getWindBal(d.id).weight,'Pack Balance Bags':getPackBal(d.id).bags,'Pack Balance Kg':getPackBal(d.id).weight,'Dispatched Bags':getTotalDispatched(d.id).bags,'Dispatched Kg':getTotalDispatched(d.id).weight,'Current Stage':getDyeLotCurrentStage(d.id),'Start Time':fmtD(d.startTime),'End Time':fmtD(d.endTime),'Status':s(d.status),'Approved By':s(d.approvedBy),'Notes':s(d.startNote??d.notes),'End Notes':s(d.endNote)}));
XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(dyeLotData,{cellDates:true}),'Dye Lots');

// Dye Sources (exploded)
const dyeSrcData=[];(State.DB.dyeLots||[]).forEach(d=>{(d.sources||[]).forEach(src=>{dyeSrcData.push({'Dye Lot ID':s(d.id),'Dye Lot No':s(d.dyeLotNo),'Shade':s(d.shade),'Status':s(d.status),'Source Type':s(src.sourceType)||'rm','Source Lot ID':s(src.lotId),'Source Permanent ID':s(src.lotUid),'Dead Stock ID':s(src.deadStockId),'Recycle ID':s(src.recycleId),'Residual ID':s(src.residualId),'Source Grade':s(src.grade),'Source Vendor':s(src.vendor),'Source Cones':fmtN(src.cones),'Source Weight Kg':fmtN(src.weight)});});});
XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(dyeSrcData,{cellDates:true}),'Dye Sources');

// Wind Entries
const windData=(State.DB.windEntries||[]).map(e=>({'Entry ID':s(e.id),'Dye Lot ID':s(e.dyeLotId),'Dye Lot No':s(e.dyeLotNo),'Shade':s(e.shade),'Grade':s(e.grade),'Recycle ID':s(e.recycleId),'Machine':s(e.machine),'Start Worker':s(e.startWorker),'End Worker':s(e.endWorker),'In Cones':fmtN(e.inCones),'In Kg':fmtN(e.inWeight),'Out Cones':fmtN(e.outCones),'Out Kg':fmtN(e.outWeight),'Waste Cones':fmtN(e.wasteCones),'Waste Kg':fmtN(e.wasteWeight),'Waste %':fmtN(e.inWeight)>0?((fmtN(e.wasteWeight)/fmtN(e.inWeight))*100).toFixed(2):0,'Start Time':fmtD(e.startTime),'End Time':fmtD(e.endTime),'Status':s(e.status),'Approved By':s(e.approvedBy),'Notes':s(e.notes),'End Notes':s(e.endNotes)}));
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
// Sep 21 2026 — real, direct addition: 'Recovered %' per recycle entry. Recovered = the off yarn's real, cumulative approved use as a
// dye source (sourceType 'recycle', either pool — On Steel direct re-dye, or Softened via Recycle Soft) — the plan's own definition,
// "off yarn recovered through re-dye". Not a live balance: scrap and what's still sitting free are NOT subtracted from the off total,
// so this only ever grows as more of a given batch's off yarn genuinely gets re-dyed, whichever route it took.
const _rcApprovedDye=(State.DB.dyeLots||[]).filter(d=>d.status==='Approved'||d.status==='Edited-Approved');
const _rcRecovered=rcId=>_rcApprovedDye.reduce((a,d)=>(d.sources||[]).reduce((a2,src)=>src.sourceType==='recycle'&&src.recycleId===rcId?{cones:a2.cones+(src.cones||0),weight:a2.weight+(src.weight||0)}:a2,a),{cones:0,weight:0});
const rcData=(State.DB.recycleStock||[]).map(r=>{const _rec=_rcRecovered(r.id);const _pct=r.weight>0?(_rec.weight/r.weight*100):(r.cones>0?(_rec.cones/r.cones*100):0);return {'ID':s(r.id),'Dye Lot ID':s(r.dyeLotId),'Dye Lot No':s(r.dyeLotNo),'Shade':s(r.shade),'Grade':(r.sources||[])[0]?.grade||'','Off Cones':fmtN(r.cones),'Weight Kg':fmtN(r.weight),'Good Cones':fmtN(r.goodCones),'Good Portion Kg':fmtN(r.goodPortion),'Recovered Cones':fmtN(_rec.cones),'Recovered Kg':fmtN(_rec.weight),'Recovered %':Math.round(_pct*10)/10,'Reason':s(r.reason),'Status':s(r.status),'Marked By':s(r.markedBy),'Marked At':fmtD(r.markedAt),'Approved By':s(r.approvedBy),'Created At':fmtD(r.createdAt)};});
XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rcData,{cellDates:true}),'Recycle Stock');
const rcsData=(State.DB.recycleSoft||[]).map(e=>({'ID':s(e.id),'Recycle ID':s(e.recycleId),'Dye Lot No':s(e.dyeLotNo),'Shade':s(e.shade),'In Cones':fmtN(e.inCones),'In Weight Kg':fmtN(e.inWeight),'Out Cones':fmtN(e.outCones),'Out Weight Kg':fmtN(e.outWeight),'Waste Cones':fmtN(e.wasteCones),'Waste Weight Kg':fmtN(e.wasteWeight),'Machine':s(e.machine),'Start Worker':s(e.startWorker),'End Worker':s(e.endWorker),'Status':s(e.status),'Approved By':s(e.approvedBy),'Start Time':fmtD(e.startTime),'End Time':fmtD(e.endTime)}));
XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rcsData,{cellDates:true}),'Recycle Soft');

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

// Aug 26 2026 — real, genuine gaps found via direct discussion with
// Priyam, who caught this by comparing the export against the live
// app screens directly: RM Return, Void Log, and Residual Stock were
// all completely absent. Same simple, flat pattern already proven for
// Residual Log and Scrap Log right above — one row per real event,
// no exploding needed for RM Return and Void Log; Residual Stock's
// contributions[] gets exploded the same way RM Lot's deliveries[]
// already does.
const rmReturnData=(State.DB.rmReturnLog||[]).map(r=>({'Return ID':s(r.id),'Lot ID':s(r.lotId),'Permanent ID':s(r.lotUid),'Grade':s(r.grade),'Vendor':s(r.vendor),'Bags':fmtN(r.units),'Weight Kg':fmtN(r.weight),'Reason Category':s(r.reasonCat),'Reason':s(r.reason),'Status':s(r.status)||'Approved','By':s(r.by),'Edited By':s(r.editedBy),'Edited At':fmtD(r.editedAt),'Date':s(r.date),'Timestamp':fmtD(r.timestamp)}));
XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rmReturnData,{cellDates:true}),'RM Returns');

const voidLogData=(State.DB.voidLog||[]).map(v=>({'Void ID':s(v.id),'Entry ID':s(v.entryId),'Type':s(v.type),'Lot ID':s(v.lotId),'Permanent ID':s(v.lotUid),'Grade':s(v.grade),'Vendor':s(v.vendor),'Reason':s(v.reason),'By':s(v.by),'At':fmtD(v.at)}));
XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(voidLogData,{cellDates:true}),'Void Log');

const residualStockData=[];
(State.DB.residualStock||[]).forEach(rs=>{
  const base={'Stock ID':s(rs.id),'Grade':s(rs.grade),'Total Weight Kg':fmtN(rs.weight),'Status':s(rs.status)||'Active','Created At':fmtD(rs.createdAt)};
  const contribs=rs.contributions||[];
  if(!contribs.length){residualStockData.push({...base,'Contribution Lot ID':'','Contribution Permanent ID':'','Contribution Vendor':'','Contribution Weight Kg':'','Contribution Residual Log ID':'','Moved By':'','Contribution Timestamp':''});}
  else{contribs.forEach(c=>{residualStockData.push({...base,'Contribution Lot ID':s(c.lotId),'Contribution Permanent ID':s(c.lotUid),'Contribution Vendor':s(c.vendor),'Contribution Weight Kg':fmtN(c.weight),'Contribution Residual Log ID':s(c.residualLogId),'Moved By':s(c.movedBy),'Contribution Timestamp':fmtD(c.timestamp)});});}
});
XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(residualStockData,{cellDates:true}),'Residual Stock');

const scrapData=(State.DB.scrapLog||[]).map(sc=>({'Scrap ID':s(sc.id),'Entry ID':s(sc.entryId),'Type':s(sc.type),'Weight Kg':fmtN(sc.weight),'Cones':fmtN(sc.cones),'Pool':s(sc.pool),'Reason':s(sc.reason),'Status':s(sc.status)||'Approved','Scrapped By':s(sc.scrappedBy),'Date':s(sc.date),'Timestamp':fmtD(sc.timestamp)}));
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
  const relatedDyeLots=(State.DB.dyeLots||[]).filter(d=>getVendorRatioForDyeLot(d,l.id,l.grade,l.vendor)>0);
  const softOut=getSoftOut(l.id,l.grade,l.vendor);
  if(relatedDyeLots.length===0){
    // This RM lot hasn't reached Dye yet (or never will) — still a real,
    // valid row, just with the downstream stages correctly showing zero,
    // not silently omitted from the sheet.
    traceData.push({'RM Permanent ID':s(l.uid),'RM Lot ID':s(l.id),'RM Grade':s(l.grade),'RM Vendor':s(l.vendor),'RM Total Weight Kg':fmtN(l.weight),'Soft Output Kg (total, all dye batches)':fmtN(softOut.weight),'Dye Lot ID':'','Dye Lot No':'','Shade':'','Dye Lot Status':'','RM Share Of This Batch %':'','RM Share Of Dye Input Cones':'','RM Share Of Dye Input Kg':'','RM Share Of Wind In Cones':'','RM Share Of Wind In Kg':'','RM Share Of Wind Out Cones':'','RM Share Of Wind Out Kg':'','RM Share Of Pack In Cones':'','RM Share Of Pack In Kg':'','RM Share Dispatched Bags':0,'RM Share Dispatched Kg':0,'Difference (Input - Dispatched) Kg':''});
    return;
  }
  relatedDyeLots.forEach(d=>{
    const ratio=getVendorRatioForDyeLot(d,l.id,l.grade,l.vendor);
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
    const dispatchedThisLot=getTotalDispatched(d.id);
    const rmShareDispatched=(dispatchedThisLot.weight||0)*ratio;
    const rmShareDispatchedBags=Math.round((dispatchedThisLot.bags||0)*ratio);
    const rmShareOfInput=src?src.weight:0;
    traceData.push({
      'RM Permanent ID':s(l.uid),'RM Lot ID':s(l.id),'RM Grade':s(l.grade),'RM Vendor':s(l.vendor),'RM Total Weight Kg':fmtN(l.weight),
      'Soft Output Kg (total, all dye batches)':fmtN(softOut.weight),
      'Dye Lot ID':s(d.id),'Dye Lot No':s(d.dyeLotNo),'Shade':s(d.shade),'Dye Lot Status':s(d.status),
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

export function exportCSV(){
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

export function showGSheetStatus(msg,type){const el=document.getElementById('gsheet-status-banner');if(!el)return;const c={ok:'background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);color:var(--gr)',err:'background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);color:var(--re)',warn:'background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);color:var(--ye)',info:'background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);color:var(--bl)'};el.style.cssText=(c[type]||c.info)+';display:block;padding:12px 16px;border-radius:8px;font-size:0.78rem;margin:12px 26px;';el.innerHTML=msg;}

window.manualBackup = manualBackup;
window.exportFirebaseBackup = exportFirebaseBackup;
window.restoreFromBackup = restoreFromBackup;
window.deleteFirebaseBackup = deleteFirebaseBackup;
window.exportBackupJSON = exportBackupJSON;
window.exportCurrentCSV = exportCurrentCSV;
window.showBackupModal = showBackupModal;
window.exportToExcel = exportToExcel;
window.exportCSV = exportCSV;
