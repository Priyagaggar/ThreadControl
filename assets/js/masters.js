// masters.js — Masters page (Vendors/Mills/Grades/Machines/Workers/Parties CRUD,
// System tab settings, admin diagnostic/migration tools).
// Aug 6 2026 — Phase 1, Step 4 of the module-split plan. Extracted byte-for-
// byte from pages.js. Inventory verified two independent ways (function-name
// scan + every onclick/onchange string embedded in generated HTML AND in
// index.html's static Masters section) before extraction, independently
// cross-checked by Antigravity against the real file — same result both times.
// (Note: initially reported as 27 items — arithmetic miscount, actual count
// is 28, corrected before extraction; no missing/duplicate item involved.)

import { State, apiPost, closeModal, fmtTS, save, setAlert, showToast, WORKER_URL, _getHeaders, _postHeaders, openModal, today } from './core.js';
import { currentFY, renderAll } from './pages.js';

export function _masterListSource(key){return key==='parties'?(State.DB.parties||[]):((State.DB.masters||{})[key]||[]);}

// Aug 26 2026 — real, direct extension built via direct discussion
// with Priyam: a simple, flexible toggle per real master list — either
// alphabetical, or the order items were genuinely added in (the
// array's own, natural order, since a new value is always pushed to
// the end). Stored per-key, so different tabs can each keep their own
// choice independently.
if(!window._masterSortMode) window._masterSortMode = {};
export function getMasterSortMode(key){ return window._masterSortMode[key] || 'added'; }
export function setMasterSortMode(key,mode){ window._masterSortMode[key] = mode; document.getElementById('sort-toggle-'+key)?.remove(); renderMasterList(key, _MASTER_SEARCH_ID[key]||('ms-'+key), 'm-'+key); renderMasters(); }
export function _sortMasterItems(key, items){
  const mode = getMasterSortMode(key);
  if(mode === 'alpha') return [...items].sort((a,b)=>a.localeCompare(b, undefined, {sensitivity:'base'}));
  // Aug 26 2026 — real, direct fix built via direct discussion with
  // Priyam: "Recently added" was genuinely showing FIFO, oldest first
  // — the exact opposite of what the label itself implies. A new
  // value is always pushed to the array's own end, so the newest,
  // most recently added item now genuinely shows first, at the top.
  return [...items].reverse();
}
// Aug 26 2026 — real, direct extension: injects the sort toggle right
// after a real master's own search box, once, the first time it's
// ever rendered — avoids touching 9 separate real HTML sections by
// hand, since a real, manual edit that size risks the exact kind of
// div-balance mistake made earlier today.
// Aug 26 2026 — real, direct extension: the real, actual search box ID
// for each master key — most of the older 5 use a singular id
// (ms-vendor, not ms-vendors), while all 4 real machine types match
// the key exactly (ms-softMachines). Mapped explicitly, rather than
// assuming one single pattern fits every real key.
const _MASTER_SEARCH_ID = { vendors:'ms-vendor', mills:'ms-mill', grades:'ms-grade', workers:'ms-worker', parties:'ms-party', softMachines:'ms-softMachines', dyeMachines:'ms-dyeMachines', windMachines:'ms-windMachines', packMachines:'ms-packMachines' };
export function _ensureSortToggle(key){
  const searchId = _MASTER_SEARCH_ID[key] || ('ms-'+key);
  const searchInput = document.getElementById(searchId);
  if(!searchInput || document.getElementById('sort-toggle-'+key)) return;
  const mode = getMasterSortMode(key);
  const toggle = document.createElement('div');
  toggle.id = 'sort-toggle-'+key;
  toggle.style.cssText = 'display:flex;gap:6px;margin-bottom:10px;font-size:0.72rem;color:var(--mu);align-items:center';
  toggle.innerHTML = `<span>Sort:</span>
    <button class="btn btn-ghost btn-xs" style="${mode==='added'?'background:var(--s2);color:var(--tx)':''}" onclick="setMasterSortMode('${key}','added')">Recently added</button>
    <button class="btn btn-ghost btn-xs" style="${mode==='alpha'?'background:var(--s2);color:var(--tx)':''}" onclick="setMasterSortMode('${key}','alpha')">A–Z</button>`;
  searchInput.insertAdjacentElement('afterend', toggle);
}

// Aug 26 2026 — real, direct rebuild built via direct discussion with
// Priyam: machines from before this change lived in one, single,
// shared list — this shows each one still sitting there, letting it
// be moved into its correct, real stage list with one click.
function _renderMachineMigration(){
  const old=State.DB.masters.machines||[];
  const wrap=document.getElementById('mp-machines-migration');
  const list=document.getElementById('mp-machines-migration-list');
  if(!wrap||!list)return;
  if(!old.length){wrap.style.display='none';return;}
  wrap.style.display='';
  list.innerHTML=old.map(m=>`<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(245,158,11,0.15)"><span style="font-size:0.8rem;font-weight:600;flex:1">${m}</span><select class="fs" id="mig-stage-${m}" style="width:120px;font-size:0.72rem"><option value="">Assign to...</option><option value="softMachines">Soft</option><option value="dyeMachines">Dye</option><option value="windMachines">Wind</option><option value="packMachines">Pack</option></select><button class="btn btn-primary btn-xs" onclick="migrateMachine('${m}')">Move</button></div>`).join('');
}

// Aug 26 2026 — real, direct extension: capacity is genuinely per-
// machine, not per-stage, so this stays one, single, shared table
// across all 4 real lists, plus anything still unmigrated.
function _renderMachineCapacity(){
  const el=document.getElementById('m-machine-capacity');
  if(!el)return;
  const all=[...new Set([
    ...(State.DB.masters.softMachines||[]),
    ...(State.DB.masters.dyeMachines||[]),
    ...(State.DB.masters.windMachines||[]),
    ...(State.DB.masters.packMachines||[]),
    ...(State.DB.masters.machines||[])
  ])];
  el.innerHTML=all.map(m=>{const cap=(State.DB.masters.machineCapacity||{})[m]||{maxHrs:'',maxOut:''};return `<tr><td style="font-size:.8rem;font-weight:600">${m}</td><td><input class="fi" type="number" value="${cap.maxHrs||''}" placeholder="hrs" style="width:70px;padding:4px 7px;font-size:.75rem" onchange="updateMachineCap('${m}','maxHrs',+this.value)"></td><td><input class="fi" type="number" value="${cap.maxOut||''}" placeholder="units" style="width:80px;padding:4px 7px;font-size:.75rem" onchange="updateMachineCap('${m}','maxOut',+this.value)"></td></tr>`;}).join('')||'<tr><td colspan="3" style="color:var(--mu);font-size:.75rem;padding:8px 0">No machines added yet</td></tr>';
}

// Aug 26 2026 — real, direct extension: moves one machine from the old,
// shared list into its correct, real stage list. Reuses the exact same
// generic add/delete path already proven for Vendors, so the move is
// a real, single, atomic step — the existing rename cascade already,
// separately, correctly handles keeping every real entry pointed at
// the right name if that name later changes too.
export async function migrateMachine(machine){
  const stage=document.getElementById('mig-stage-'+machine)?.value;
  if(!stage){showToast('Select a stage first','err');return;}
  try{
    const {ok,error,networkError}=await apiPost('/api/masters/migrate-machine',{machine,stage,role:State.currentUser?.role});
    if(networkError)throw new Error(error);
    if(!ok){showToast(error||'Could not move machine','err');return;}
    State.DB.masters.machines=(State.DB.masters.machines||[]).filter(m=>m!==machine);
    State.DB.masters[stage]=State.DB.masters[stage]||[];
    if(!State.DB.masters[stage].includes(machine))State.DB.masters[stage].push(machine);
    showToast(machine+' moved ✓','success');renderMasters();
  }catch(e){showToast('Network error — '+e.message,'err');}
}

// Aug 26 2026 — real, direct extension built via direct discussion
// with Priyam: finds every real value used by a real record but
// missing from Masters — a name deleted at some point, or never
// added properly in the first place. Each missing value gets a real,
// direct "Add" button, right next to it.
export async function scanMissingMasters(){
  const el=document.getElementById('scan-missing-status');
  if(!el)return;
  el.textContent='Scanning...';
  try{
    const res=await fetch(WORKER_URL+'/api/masters/scan-missing',{headers:_postHeaders()});
    const data=await res.json();
    if(!res.ok){el.textContent='Error — '+(data.error||'could not scan');return;}
    const labels={vendors:'Vendors',mills:'Mills',grades:'Grades',workers:'Workers',parties:'Parties',softMachines:'Soft Machines',dyeMachines:'Dye Machines',windMachines:'Wind Machines',packMachines:'Pack Machines'};
    const rows=Object.entries(labels).map(([key,label])=>{
      const missing=data[key]||[];
      if(!missing.length)return '';
      return `<div style="margin-bottom:10px"><div style="font-size:0.75rem;font-weight:700;color:var(--ye);margin-bottom:4px">${label} — ${missing.length} missing</div>`+
        missing.map(v=>{
          // Sep 10 2026 — real, direct diagnostic built via direct
          // discussion with Priyam, from his own real, repeated
          // experience: a party kept appearing to still be missing
          // even after "Add back". Shows exactly which real
          // dispatch(es) — active or archived — are the actual
          // source, so the real record can be traced directly instead
          // of guessing at a cause.
          const srcList=(key==='parties'&&data.partySources&&data.partySources[v])?data.partySources[v]:null;
          const srcHtml=srcList&&srcList.length?`<div style="font-size:0.68rem;color:var(--mu);margin-top:2px">Found on: ${srcList.map(s=>`Dispatch ${s.dispatchId}${s.archived?' (archived)':''}`).join(', ')}</div>`:'';
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--b1)"><div><span style="font-size:0.78rem">${v}</span>${srcHtml}</div><button class="btn btn-primary btn-xs" onclick="addMissingMaster('${key}','${v.replace(/'/g,"\\'")}')">+ Add back</button></div>`;
        }).join('')+
        `</div>`;
    }).join('');
    el.innerHTML=rows||'<span style="color:var(--gr)">✓ Nothing missing — every real value in use is already in Masters</span>';
  }catch(e){el.textContent='Network error — '+e.message;}
}

// Aug 26 2026 — real, direct extension: adds a found-missing value
// straight back into its correct real list. Built as its own,
// complete function rather than calling addMaster, since that one
// specifically reads from an input field, not a direct value.
// Sep 10 2026 — real, direct fix built via direct discussion with
// Priyam, from a genuine real incident: clicking "Add back" here
// showed "added back ✓" immediately and the value reappeared in the
// list right away, but kept showing up as missing again on every
// re-scan — clicked repeatedly since morning with no lasting effect.
// Root cause: this was a second, separate function using the exact
// same unsafe pattern already fixed on the regular "Add" button
// earlier today (optimistic local update, unconfirmed save in the
// background) — just never updated at the same time since it wasn't
// known to exist yet. Now goes through the same safe, atomic,
// lock-protected add and genuinely waits for the server to confirm
// before updating anything the person sees.
export async function addMissingMaster(key,val){
  try{
    const res=await fetch(WORKER_URL+'/api/masters/add-item',{method:'POST',headers:_postHeaders(),body:JSON.stringify({key,value:val})});
    const data=await res.json().catch(()=>({}));
    if(!res.ok||!data.success){showToast(data.error||'Could not add '+val+' — not saved','err');return;}
    if(key==='parties'){State.DB.parties=data.list;}else{if(!State.DB.masters)State.DB.masters={};State.DB.masters[key]=data.list;}
    showToast(data.alreadyExisted?(val+' already exists'):(val+' added back ✓'));
    renderMasters();
    scanMissingMasters();
  }catch(e){showToast('Could not add '+val+' — '+e.message,'err');}
}

export function renderMasters(){if(!State.DB.masters)State.DB.masters={vendors:[],mills:[],grades:[],machines:[],workers:[],softMachines:[],dyeMachines:[],windMachines:[],packMachines:[]};if(!State.DB.parties)State.DB.parties=[];
['vendors','mills','grades','workers','parties','softMachines','dyeMachines','windMachines','packMachines'].forEach(k=>_ensureSortToggle(k));
renderMasterList('vendors','ms-vendor','m-vendors');renderMasterList('mills','ms-mill','m-mills');renderMasterList('grades','ms-grade','m-grades');renderMasterList('workers','ms-worker','m-workers');renderMasterList('parties','ms-party','m-parties');
// Aug 26 2026 — real, direct rebuild built via direct discussion with
// Priyam: machines now genuinely live in 4 separate, simple lists, one
// per real stage — exactly matching how Vendors already works.
renderMasterList('softMachines','ms-softMachines','m-softMachines');
renderMasterList('dyeMachines','ms-dyeMachines','m-dyeMachines');
renderMasterList('windMachines','ms-windMachines','m-windMachines');
renderMasterList('packMachines','ms-packMachines','m-packMachines');
_renderMachineMigration();
_renderMachineCapacity();
const _isAdminM=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';const sysBtn=document.getElementById('mt-system');if(sysBtn)sysBtn.style.display=_isAdminM?'':'none';const dmPanel=document.getElementById('data-mgmt-panel');if(dmPanel)dmPanel.style.display=_isAdminM?'':'none';const uidPanel=document.getElementById('rm-uid-panel');if(uidPanel)uidPanel.style.display=_isAdminM?'':'none';const agingWrap=document.getElementById('aging-inputs-wrap');if(agingWrap)agingWrap.style.pointerEvents=_isAdminM?'':'none',agingWrap.style.opacity=_isAdminM?'1':'0.4';const dmList=document.getElementById('data-mgmt-list');if(dmList&&_isAdminM){const _stages=[{key:'packEntries',label:'Pack Entries'},{key:'dispatches',label:'Dispatches'},{key:'partyOrders',label:'Party Orders'},{key:'windEntries',label:'Wind Entries'},{key:'stageEntries',label:'Stage Entries (Soft)'},{key:'dyeLots',label:'Dye Lots'},{key:'lots',label:'RM Lots'},];dmList.innerHTML=_stages.map(s=>`<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:var(--s2);border-radius:8px"><div><span style="font-size:0.78rem;font-weight:700">${s.label}</span><span style="font-size:0.65rem;color:var(--mu);margin-left:8px">${(State.DB[s.key]||[]).length} records</span></div><button class="btn btn-sm" style="background:rgba(239,68,68,0.12);color:var(--re);border:1px solid rgba(239,68,68,0.3)" onclick="openClearStage('${s.key}','${s.label}')">Clear All</button></div>`).join('');}
if(!State.DB.deleteRequests)State.DB.deleteRequests=[];const isAdmin=State.currentUser?.role==='manager';const reqPanel=document.getElementById('delete-requests-panel');const reqList=document.getElementById('delete-requests-list');const reqBadge=document.getElementById('delete-req-badge');const pending=(State.DB.deleteRequests||[]).filter(r=>r.status==='pending');if(reqPanel){if(isAdmin&&pending.length>0){reqPanel.style.display='block';if(reqBadge){reqBadge.textContent=pending.length+' pending';reqBadge.style.display='';}
reqList.innerHTML=pending.map(r=>`
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(239,68,68,0.15);"><div><div style="font-size:.82rem;font-weight:700;color:var(--re)">${r.val}</div><div style="font-size:.65rem;color:var(--mu)">${r.key} · Requested by ${r.by} · ${fmtTS(r.at)}</div>
            ${r.reason?`<div style="font-size:.65rem;color:var(--mu);font-style:italic">"${r.reason}"</div>`:''}
          </div><div style="display:flex;gap:6px;flex-shrink:0;margin-left:12px;"><button class="btn bs bxs" onclick="openAdminDelConfirm('${r.id}')">✓ Confirm</button><button class="btn bg bxs" onclick="rejectDeleteRequest('${r.id}')">✕ Reject</button></div></div>`).join('');}else{reqPanel.style.display='none';if(reqBadge)reqBadge.style.display='none';}}
['vendors','mills','grades','workers','parties','softMachines','dyeMachines','windMachines','packMachines'].forEach(k=>{const el=document.getElementById('m-'+k);if(!el)return;const rawList=k==='parties'?State.DB.parties:State.DB.masters[k];if(!rawList){el.innerHTML='<div style="color:var(--mu);font-size:.75rem;padding:5px 0">None added</div>';return;}
const list=_sortMasterItems(k,rawList);
el.innerHTML=list.map(v=>{const hasPending=(State.DB.deleteRequests||[]).some(r=>r.key===k&&r.val===v&&r.status==='pending');const safeV=v.replace(/'/g,"\\'").replace(/"/g,'&quot;');const editBtn=isAdmin?`<button class="btn btn-ghost bxs" onclick="openMasterEdit('${k}','${safeV}')">✏</button>`:'';const delBtn=isAdmin?`<button class="btn bd bxs" onclick="openAdminDirectDelete('${k}','${safeV}')">✕</button>`:hasPending?`<span style="font-size:.6rem;color:var(--ye);padding:2px 7px;border-radius:3px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.2)">⏳</span>`:`<button class="btn bg bxs" style="color:var(--re);border-color:rgba(239,68,68,.3)" onclick="openDeleteRequest('${k}','${safeV}')">📤</button>`;return`<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--b1);"><span style="font-size:.82rem">${v}</span><div style="display:flex;gap:4px;align-items:center">${editBtn}${delBtn}</div></div>`;}).join('')||`<div style="color:var(--mu);font-size:.75rem;padding:5px 0">None added</div>`;});const mEl=document.getElementById('m-machines');if(mEl){mEl.innerHTML=State.DB.masters.machines.map(m=>{const cap=(State.DB.masters.machineCapacity||{})[m]||{maxHrs:'',maxOut:''};const curStage=(State.DB.masters.machineStages||{})[m]||'';const hasPending=(State.DB.deleteRequests||[]).some(r=>r.key==='machines'&&r.val===m&&r.status==='pending');const delBtn=isAdmin?`<button class="btn bd bxs" onclick="openAdminDirectDelete('machines','${m}')">✕</button>`:hasPending?`<span style="font-size:.58rem;color:var(--ye)">⏳</span>`:`<button class="btn bg bxs" style="color:var(--re);border-color:rgba(239,68,68,.3);font-size:.6rem" onclick="openDeleteRequest('machines','${m}')">📤</button>`;const stageSel=`<select class="fs" style="font-size:.72rem;padding:3px 6px;${curStage?'':'border-color:rgba(245,158,11,.5)'}" onchange="setMachineStage('${m}',this.value)"><option value="">— Not set —</option>${['Soft','Dye','Wind','Pack'].map(s=>`<option value="${s}"${s===curStage?' selected':''}>${s}</option>`).join('')}</select>`;return`<tr><td style="font-size:.8rem;font-weight:600">${m}</td><td>${stageSel}</td><td><input class="fi" type="number" value="${cap.maxHrs||''}" placeholder="hrs" style="width:70px;padding:4px 7px;font-size:.75rem" onchange="updateMachineCap('${m}','maxHrs',+this.value)"></td><td><input class="fi" type="number" value="${cap.maxOut||''}" placeholder="units" style="width:80px;padding:4px 7px;font-size:.75rem" onchange="updateMachineCap('${m}','maxOut',+this.value)"></td><td>${delBtn}</td></tr>`;}).join('')||'<tr><td colspan="5" style="color:var(--mu);font-size:.75rem;padding:8px 0">No machines added</td></tr>';}
const dyeLotPanel=document.getElementById('masters-dye-lot-settings');if(dyeLotPanel){const fy=currentFY();const fySettings=(State.DB.masters.dyeLotSettings||[]).find(s=>s.fy===fy);const currentStart=fySettings?.startingNo||('DYE-'+fy+'-001');const isAdm2=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';dyeLotPanel.innerHTML=`
      <div style="font-size:0.78rem;color:var(--mu);margin-bottom:10px">
        Set the starting Dye Lot number for financial year <strong>${fy}</strong>. Admin only.
      </div><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><div style="font-size:0.9rem">Current: <strong style="color:var(--ac)">${currentStart}</strong></div>
        ${isAdm2?`<input type="text"id="dye-lot-start-input"value="${currentStart}"
style="width:160px;padding:6px 10px;border-radius:6px;border:1px solid var(--b2);background:var(--s2);color:var(--tx);font-size:0.85rem;font-family:monospace"><button class="btn btn-primary btn-sm"onclick="saveDyeLotStartingNo()">Save</button>`:'<span style="font-size:0.72rem;color:var(--mu)">(Admin only to change)</span>'}
      </div>`;}
const _ay=document.getElementById('aging-yellow');const _ar=document.getElementById('aging-red');if(_ay)_ay.value=(State.DB.agingThresholds?.yellow||7);if(_ar)_ar.value=(State.DB.agingThresholds?.red||15);}

export function renderMasterList(key,searchId,listId){const q=(document.getElementById(searchId)?.value||'').toLowerCase().trim();const el=document.getElementById(listId);if(!el)return;const items=_sortMasterItems(key,_masterListSource(key).filter(v=>!q||v.toLowerCase().includes(q)));if(!items.length){el.innerHTML='<div style="color:var(--mu);font-size:0.75rem;padding:8px 0">No items found</div>';return;}
const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';el.innerHTML=items.map(v=>{const hasPending=(State.DB.deleteRequests||[]).some(r=>r.key===key&&r.val===v&&r.status==='pending');const safeV=v.replace(/'/g,"\\'").replace(/"/g,'&quot;');const editBtn=isAdmin?`<button class="btn btn-ghost bxs" onclick="openMasterEdit('${key}','${safeV}')">✏</button>`:'';const delBtn=isAdmin?`<button class="btn bd bxs" onclick="openAdminDirectDelete('${key}','${safeV}')">✕</button>`:hasPending?`<span style="font-size:.6rem;color:var(--ye);padding:2px 7px;border-radius:3px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.2)">⏳</span>`:`<button class="btn bg bxs" style="color:var(--re);border-color:rgba(239,68,68,.3)" onclick="openDeleteRequest('${key}','${safeV}')">📤</button>`;return`<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--b1);"><span style="font-size:.82rem">${v}</span><div style="display:flex;gap:4px;align-items:center">${editBtn}${delBtn}</div></div>`;}).join('');}

export function switchMasterTab(tab,el){document.querySelectorAll('.master-panel').forEach(p=>p.style.display='none');document.querySelectorAll('[id^="mt-"]').forEach(b=>b.classList.remove('active-appr-tab'));const panel=document.getElementById('mp-'+tab);if(panel)panel.style.display='block';if(el)el.classList.add('active-appr-tab');if(tab==='system'){const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';if(!isAdmin){switchMasterTab('vendors',document.getElementById('mt-vendors'));return;}}
renderMasters();}

// Sep 10 2026 — real, root-cause fix built via direct discussion with
// Priyam, from a genuine real incident: a supervisor added a new
// worker, real entries were created using it, and the worker name
// later vanished from Masters entirely. This used to modify the
// browser's own local copy immediately, show "added ✓" right away,
// then fire an unwaited save in the background — so if that save
// genuinely failed (a real possibility, whether from a permission
// mismatch or two people saving around the same time), the person
// had already seen success and moved on, with the actual failure
// toast easy to miss a moment later. Now genuinely waits for the
// server to confirm before updating anything the person sees, and
// goes through a real, atomic add — fetching the current, fresh list
// right before writing, so a concurrent addition from someone else
// can never be silently overwritten.
export async function addMaster(key,inputId){
  const v=document.getElementById(inputId)?.value.trim();if(!v)return;
  const inp=document.getElementById(inputId);
  try{
    const res=await fetch(WORKER_URL+'/api/masters/add-item',{method:'POST',headers:_postHeaders(),body:JSON.stringify({key,value:v})});
    const data=await res.json().catch(()=>({}));
    if(!res.ok||!data.success){showToast(data.error||'Could not add '+v+' — not saved','err');return;}
    if(key==='parties'){State.DB.parties=data.list;}else{if(!State.DB.masters)State.DB.masters={vendors:[],mills:[],grades:[],machines:[],workers:[]};State.DB.masters[key]=data.list;}
    if(inp)inp.value='';
    renderMasters();
    showToast(data.alreadyExisted?(v+' already exists'):(v+' added ✓'));
  }catch(e){showToast('Could not add '+v+' — '+e.message,'err');}
}

export function openMasterEdit(key,oldVal){const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';if(!isAdmin){showToast('Admin/Manager only','err');return;}
const labels={vendors:'Vendor',mills:'Mill',grades:'Grade',workers:'Worker',parties:'Party',machines:'Machine'};const label=labels[key]||key;const overlay=document.createElement('div');overlay.id='master-edit-overlay';overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center';overlay.innerHTML=`
    <div style="background:var(--s1);border-radius:12px;padding:24px;width:380px;border:1px solid var(--b2)"><div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--mu);margin-bottom:16px">Edit ${label}</div><div style="margin-bottom:14px"><div style="font-size:0.72rem;color:var(--mu);margin-bottom:6px">Current value</div><div style="font-size:0.9rem;font-weight:600;color:var(--ac)">${oldVal}</div></div><div style="margin-bottom:16px"><label style="font-size:0.72rem;color:var(--mu);display:block;margin-bottom:6px">New value</label><input class="fi" id="master-edit-input" value="${oldVal}" style="width:100%"></div><div style="background:rgba(240,165,0,0.08);border:1px solid rgba(240,165,0,0.2);border-radius:8px;padding:10px 12px;margin-bottom:16px;font-size:0.7rem;color:var(--mu)">
        ⚠ This will cascade the change across all linked entries — lots, stage entries, dye lots, dispatches etc.
      </div><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn btn-ghost btn-sm" onclick="document.getElementById('master-edit-overlay').remove()">Cancel</button><button class="btn btn-primary btn-sm" onclick="saveMasterEdit('${key}','${oldVal.replace(/'/g,"\'")}')">Preview Changes</button></div></div>
  `;document.body.appendChild(overlay);setTimeout(()=>document.getElementById('master-edit-input')?.focus(),50);}

export async function saveMasterEdit(key,oldVal){const newVal=document.getElementById('master-edit-input')?.value.trim();if(!newVal){showToast('Value cannot be empty','err');return;}
if(newVal===oldVal){document.getElementById('master-edit-overlay')?.remove();return;}
const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';if(!isAdmin){showToast('Admin/Manager only','err');return;}
// Sep 10 2026 — real, direct new feature built via direct discussion
// with Priyam, establishing one clear rule across the whole app:
// every real action shows a genuine preview of its actual effect
// before committing — upgraded from only warning when the new name
// happened to collide with an existing one, to always showing the
// real scope of the change first.
try{
  const {ok,data,error,networkError}=await apiPost('/api/master-edit',{key,oldVal,newVal,changedBy:State.currentUser.name});
  if(networkError){showToast('Network error: '+networkError,'err');return;}
  if(!ok||data.error){showToast(data.error||error||'Could not preview','err');return;}
  const overlay=document.getElementById('master-edit-overlay');
  if(!overlay)return;
  const mergeHtml=data.isMerge?`<div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:8px 10px;margin-bottom:16px;font-size:.72rem;color:var(--re);font-weight:700">⚠ "${newVal}" already exists — this will merge "${oldVal}" into it${data.lotLevelMerges>0?`, including ${data.lotLevelMerges} real lot-level merge(s), combining their quantities`:''}. "${oldVal}" will be removed from Masters.</div>`:'';
  overlay.querySelector('div').innerHTML=`
    <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--mu);margin-bottom:16px">Preview — Confirm Change</div>
    <div style="margin-bottom:14px;font-size:.82rem;">Renaming <strong>${oldVal}</strong> → <strong>${newVal}</strong> will update <strong>${data.fieldsChanged}</strong> field(s) across your real entries.</div>
    ${mergeHtml}
    <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn btn-ghost btn-sm" onclick="document.getElementById('master-edit-overlay').remove()">Cancel</button><button class="btn btn-primary btn-sm" onclick="_doMasterEditConfirm('${key}','${oldVal.replace(/'/g,"\\'")}','${newVal.replace(/'/g,"\\'")}')">Confirm & Save</button></div>
  `;
}catch(e){showToast('Network error: '+e.message,'err');}
}

export async function _doMasterEditConfirm(key,oldVal,newVal){
try{
  const {ok,data,error,networkError}=await apiPost('/api/master-edit',{key,oldVal,newVal,changedBy:State.currentUser.name,confirm:true});
  if(networkError)throw new Error(error);
  if(!ok){showToast(error||'Could not update','err');return;}
  // Aug 6 2026 — real bug found and fixed: this used to only call renderMasters()
  // after the save, relying purely on the live-sync connection having already
  // updated State.DB before that render ran — a race it doesn't always win
  // (confirmed: it lost the race during real testing). addMaster already did
  // this correctly (patches State.DB locally before rendering); this brings
  // saveMasterEdit in line with that same, already-proven pattern.
  const arr=key==='parties'?(State.DB.parties=State.DB.parties||[]):(State.DB.masters[key]=State.DB.masters[key]||[]);
  const idx=arr.indexOf(oldVal);
  // Aug 26 2026 — real, direct extension: a real merge removes the old
  // name entirely, rather than replacing it in place, since the
  // destination name already, genuinely exists in this same list.
  if(arr.includes(newVal)&&idx!==-1){arr.splice(idx,1);}
  else if(idx!==-1)arr[idx]=newVal;else arr.push(newVal);
  document.getElementById('master-edit-overlay')?.remove();showToast(`${newVal} updated & cascaded ✓`);renderMasters();renderAll();
}catch(e){showToast('Network error — not saved: '+e.message,'err');}
}

export async function confirmMasterDelete(){const pwd=document.getElementById('admin-del-pwd').value;const reqId=document.getElementById('admin-del-req-id').value;
let key,val,deleteRequestId=null;
if(reqId.startsWith('direct__')){const parts=reqId.split('__');key=parts[1];val=parts[2];}
else{const req=(State.DB.deleteRequests||[]).find(r=>r.id===reqId);if(!req){setAlert('admin-del-alert','Request not found','alert-err');return;}
key=req.key;val=req.val;deleteRequestId=reqId;}
try{
  const {ok,data,error,networkError}=await apiPost('/api/master-item/delete',{key,val,password:pwd,deleteRequestId,changedBy:State.currentUser.name});
  if(networkError)throw new Error(error);
  if(!ok){setAlert('admin-del-alert',error||'Could not delete','alert-err');document.getElementById('admin-del-pwd').value='';return;}
  // Aug 6 2026 — same fix as the other master functions above.
  const arr=key==='parties'?(State.DB.parties=State.DB.parties||[]):(State.DB.masters[key]=State.DB.masters[key]||[]);
  const idx=arr.indexOf(val);
  if(idx!==-1)arr.splice(idx,1);
  if(deleteRequestId&&State.DB.deleteRequests){const dIdx=State.DB.deleteRequests.findIndex(r=>r.id===deleteRequestId);if(dIdx!==-1)State.DB.deleteRequests.splice(dIdx,1);}
  closeModal('admin-del-modal');showToast(val+' deleted ✓');renderMasters();
}catch(e){setAlert('admin-del-alert','Network error — not deleted: '+e.message,'alert-err');}
}

export async function deleteMasterItem(key,val){
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
  // Aug 6 2026 — same real fix as saveMasterEdit above: patch State.DB
  // locally instead of only relying on the live-sync connection beating
  // the render call.
  const arr=key==='parties'?(State.DB.parties=State.DB.parties||[]):(State.DB.masters[key]=State.DB.masters[key]||[]);
  const idx=arr.indexOf(val);
  if(idx!==-1)arr.splice(idx,1);
  showToast(val+' removed');renderMasters();
}catch(e){showToast('Network error — not deleted: '+e.message,'err');}
}

export async function addMachine(){const id=document.getElementById('mi-machine').value.trim();const hrs=parseFloat(document.getElementById('mi-machine-hrs').value)||24;const out=parseFloat(document.getElementById('mi-machine-out').value)||0;const stage=document.getElementById('mi-machine-stage')?.value||'';if(!id)return;if(!stage){showToast('Select which stage this machine belongs to','err');return;}try{const {ok,error,networkError}=await apiPost('/api/masters/setting',{action:'addMachine',machine:id,maxHrs:hrs,maxOut:out,stage,role:State.currentUser?.role});if(networkError)throw new Error(error);if(!ok){showToast(error||'Could not add machine','err');return;}
// Aug 6 2026 — same real fix as saveMasterEdit/deleteMasterItem: patch
// State.DB locally instead of only relying on the live-sync connection.
State.DB.masters.machines=State.DB.masters.machines||[];
if(!State.DB.masters.machines.includes(id))State.DB.masters.machines.push(id);
State.DB.masters.machineCapacity=State.DB.masters.machineCapacity||{};
State.DB.masters.machineCapacity[id]={maxHrs:hrs,maxOut:out};
// Aug 26 2026 — real, direct extension built via direct discussion with
// Priyam: each machine now genuinely carries which real stage it
// belongs to, so every stage's own form can correctly show only its
// own real machines, instead of every machine in the whole factory.
State.DB.masters.machineStages=State.DB.masters.machineStages||{};
State.DB.masters.machineStages[id]=stage;
document.getElementById('mi-machine').value='';document.getElementById('mi-machine-hrs').value='';document.getElementById('mi-machine-out').value='';if(document.getElementById('mi-machine-stage'))document.getElementById('mi-machine-stage').value='';renderMasters();}catch(e){showToast('Network error — '+e.message,'err');}}

// Aug 26 2026 — real, direct extension: lets an existing machine (added
// before this feature existed, with no stage yet) be tagged correctly.
export async function setMachineStage(machine,stage){if(!stage)return;try{const {ok,error,networkError}=await apiPost('/api/masters/setting',{action:'machineStage',machine,stage,role:State.currentUser?.role});if(networkError)throw new Error(error);if(!ok){showToast(error||'Could not save stage','err');return;}
State.DB.masters.machineStages=State.DB.masters.machineStages||{};
State.DB.masters.machineStages[machine]=stage;
showToast(machine+' tagged as '+stage,'success');renderMasters();}catch(e){showToast('Network error — '+e.message,'err');}}
export async function updateMachineCap(m,field,val){try{const {ok,error,networkError}=await apiPost('/api/masters/setting',{action:'machineCap',machine:m,field,val,role:State.currentUser?.role});if(networkError)throw new Error(error);if(!ok){showToast(error||'Could not save','err');return;}
// Aug 6 2026 — same fix as the others above. This one doesn't visibly
// look broken (the input box already shows what you typed, browser-
// native), but State.DB itself was still going stale until the live-sync
// connection caught up — a real risk for anything else reading machine
// capacity shortly after. Patched here for consistency, same reasoning.
State.DB.masters.machineCapacity=State.DB.masters.machineCapacity||{};
State.DB.masters.machineCapacity[m]=State.DB.masters.machineCapacity[m]||{};
State.DB.masters.machineCapacity[m][field]=val;
}catch(e){showToast('Network error — '+e.message,'err');}}

export function openAdminDelConfirm(reqId){const req=(State.DB.deleteRequests||[]).find(r=>r.id===reqId);if(!req)return;document.getElementById('admin-del-req-id').value=reqId;document.getElementById('admin-del-by').textContent=req.by+' · '+fmtTS(req.at);document.getElementById('admin-del-reason-show').textContent=req.key+': '+req.val+(req.reason?' — "'+req.reason+'"':'');document.getElementById('admin-del-pwd').value='';document.getElementById('admin-del-alert').innerHTML='';openModal('admin-del-modal');}

export function openAdminDirectDelete(key,val){document.getElementById('admin-del-req-id').value='direct__'+key+'__'+val;document.getElementById('admin-del-by').textContent='Direct delete by admin';document.getElementById('admin-del-reason-show').textContent=key+': '+val;document.getElementById('admin-del-pwd').value='';document.getElementById('admin-del-alert').innerHTML='';openModal('admin-del-modal');}

export function openClearStage(key,label){if(State.currentUser?.role!=='admin'&&State.currentUser?.role!=='manager'){showToast('Admin only','err');return;}
document.getElementById('clear-stage-key').value=key;document.getElementById('clear-stage-label').textContent='Collection: '+label;document.getElementById('clear-stage-confirm-text').value='';document.getElementById('clear-stage-password').value='';document.getElementById('clear-stage-alert').innerHTML='';openModal('clear-stage-modal');}

export function openDeleteRequest(key,val){document.getElementById('del-req-key').value=key;document.getElementById('del-req-val').value=val;document.getElementById('del-req-item-name').textContent=val;document.getElementById('del-req-item-type').textContent=key.charAt(0).toUpperCase()+key.slice(1);document.getElementById('del-req-reason').value='';document.getElementById('del-req-alert').innerHTML='';openModal('del-req-modal');}

export async function rejectDeleteRequest(reqId){if(!reqId){closeModal('admin-del-modal');return;}
try{const {ok,error,networkError}=await apiPost('/api/delete-request',{action:'reject',reqId,changedBy:State.currentUser?.name,role:State.currentUser?.role});if(networkError)throw new Error(error);if(!ok){showToast(error||'Could not reject','err');return;}
// Aug 6 2026 — same fix as the others above.
if(State.DB.deleteRequests){const idx=State.DB.deleteRequests.findIndex(r=>r.id===reqId);if(idx!==-1)State.DB.deleteRequests.splice(idx,1);}
closeModal('admin-del-modal');renderMasters();showToast('Request rejected');}catch(e){showToast('Network error — '+e.message,'err');}}

export async function saveDyeLotStartingNo(){const val=document.getElementById('dye-lot-start-input')?.value.trim();if(!val){showToast('Enter a starting number','err');return;}
const fy=currentFY();try{const {ok,error,networkError}=await apiPost('/api/masters/setting',{action:'dyeLotStartingNo',startingNo:val,fy,role:State.currentUser?.role});if(networkError)throw new Error(error);if(!ok){showToast(error||'Could not save','err');return;}
// Aug 6 2026 — same fix as the others above.
State.DB.masters.dyeLotSettings=State.DB.masters.dyeLotSettings||[];
const existing=State.DB.masters.dyeLotSettings.find(s=>s.fy===fy);
if(existing)existing.startingNo=val;else State.DB.masters.dyeLotSettings.push({fy,startingNo:val});
showToast(`Dye Lot starting number set to ${val} ✓`);renderMasters();}catch(e){showToast('Network error — '+e.message,'err');}}

export async function saveAgingThresholds(){let y=parseInt(document.getElementById('aging-yellow')?.value)||7;let r=parseInt(document.getElementById('aging-red')?.value)||15;try{const {ok,error,networkError}=await apiPost('/api/masters/setting',{action:'agingThresholds',yellow:y,red:r,role:State.currentUser?.role});if(networkError)throw new Error(error);if(!ok){showToast(error||'Could not save','err');return;}showToast('Saved ✓');}catch(e){showToast('Network error — '+e.message,'err');}}

export async function checkOrphanedLots(){
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

export async function checkRMUidStatus(){
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

export async function checkUidBackfillStatus(){
  const el=document.getElementById('rm-uid-backfill-status');if(!el)return;
  el.textContent='Checking...';
  try{
    const res=await fetch(WORKER_URL+'/api/admin/verify-uid-backfill',{headers:_getHeaders()});
    const data=await res.json();
    if(!res.ok||!data.success){el.innerHTML='<span style="color:var(--re)">Could not check status</span>';return;}
    if(data.complete&&data.addressColumnComplete){
      el.innerHTML=`<span style="color:var(--gr)">✓ Complete — Soft, Dye Sources, RM Returns, Residual Log/Stock, and RM delivery voids all have both the permanent ID and the saved address column</span>`;
    }else{
      // Aug 2 2026 — genuinely, honestly checked separately: the ID
      // and the address column are two different things that may not
      // both be done, especially if the backfill was run before the
      // address column feature existed.
      let html=`<span style="color:var(--ye)">Permanent ID — Soft: ${data.totalSoftEntries-data.softMissingUid}/${data.totalSoftEntries}. Dye Sources: ${data.totalRmDyeSources-data.rmSourcesMissingUid}/${data.totalRmDyeSources}. RM Returns: ${data.totalRmReturns-data.rmReturnsMissingUid}/${data.totalRmReturns}. Residual Log: ${data.totalResidualLog-data.residualLogMissingUid}/${data.totalResidualLog}. Residual Stock: ${data.totalResidualContributions-data.residualContributionsMissingUid}/${data.totalResidualContributions}. RM Voids: ${data.totalRmDeliveryVoids-data.rmDeliveryVoidsMissingUid}/${data.totalRmDeliveryVoids}.</span>`;
      if(!data.addressColumnComplete){
        html+=`<br><span style="color:var(--ye)">Address column — Soft: ${data.totalSoftEntries-data.softMissingAddressColumn}/${data.totalSoftEntries}. Dye Sources: ${data.totalRmDyeSources-data.rmSourcesMissingAddressColumn}/${data.totalRmDyeSources}. RM Returns: ${data.totalRmReturns-data.rmReturnsMissingAddressColumn}/${data.totalRmReturns}. Residual Log: ${data.totalResidualLog-data.residualLogMissingAddressColumn}/${data.totalResidualLog}. Residual Stock: ${data.totalResidualContributions-data.residualContributionsMissingAddressColumn}/${data.totalResidualContributions}. RM Voids: ${data.totalRmDeliveryVoids-data.rmDeliveryVoidsMissingAddressColumn}/${data.totalRmDeliveryVoids}.</span>`;
      }
      el.innerHTML=html;
    }
  }catch(e){el.innerHTML='<span style="color:var(--re)">Network error — '+e.message+'</span>';}
}

export async function downloadAllLotIssuesReport(){
  if(typeof XLSX==='undefined'){showToast('SheetJS not loaded','err');return;}
  showToast('Building report...');
  try{
    const [staleRes,dupRes,mismatchRes]=await Promise.all([
      fetch(WORKER_URL+'/api/admin/scan-stale-lot-addresses',{headers:_getHeaders()}),
      fetch(WORKER_URL+'/api/admin/scan-duplicate-lot-ids',{headers:_getHeaders()}),
      fetch(WORKER_URL+'/api/admin/scan-lot-address-mismatches',{headers:_getHeaders()}),
    ]);
    const [stale,dup,mismatch]=await Promise.all([staleRes.json(),dupRes.json(),mismatchRes.json()]);
    if(!staleRes.ok||!stale.success||!dupRes.ok||!dup.success||!mismatchRes.ok||!mismatch.success){showToast('Could not build report — a scan failed','err');return;}

    const wb=XLSX.utils.book_new();

    // Duplicate Lot IDs
    const dupRows=[];const relatedRows=[];
    (dup.genuineDuplicates||[]).forEach(d=>{
      d.copies.forEach(c=>{
        const r=c.fullRecord||{};
        const row={'Lot ID':d.lotId,'Grade (identity)':d.grade,'Vendor (identity)':d.vendor,'Table':c.table,'Firebase Key':c.key,'Does address match its own grade/vendor text?':c.addressMatchesOwnText?'YES':'NO','Real Downstream Usage (records referencing this permanent ID)':c.realUsageCount,'Same ID on both copies?':d.sameUidAcrossCopies?'YES':'NO'};
        Object.keys(r).forEach(k=>{
          if(k==='deliveries'&&Array.isArray(r[k])){row['Deliveries (raw)']=JSON.stringify(r[k]);}
          else if(typeof r[k]==='object'){row[k]=JSON.stringify(r[k]);}
          else{row[k]=r[k];}
        });
        dupRows.push(row);
        (c.relatedRecords||[]).forEach(rr=>{relatedRows.push({'Lot ID':d.lotId,'Permanent ID':r.uid,'Table (source record was found in)':rr.table,'Record Detail (raw)':JSON.stringify(rr.record)});});
      });
    });
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(dupRows.length?dupRows:[{'Note':'None found — clean'}]),'Duplicate Lot IDs');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(relatedRows.length?relatedRows:[{'Note':'No related records found for any duplicate'}]),'Related Records (Full List)');

    // Stale Addresses
    const staleSoftRows=(stale.staleSnapshots||[]).map(s=>({'Soft Entry ID':s.id,'Lot ID':s.lotId,'Grade':s.grade,'Vendor':s.vendor,'Saved Snapshot Address':s.savedSnapshot}));
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(staleSoftRows.length?staleSoftRows:[{'Note':'None found — clean'}]),'Stale Soft Snapshots');
    const staleReturnRows=(stale.staleReturns||[]).map(r=>({'RM Return ID':r.id,'Lot ID':r.lotId,'Grade':r.grade,'Vendor':r.vendor}));
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(staleReturnRows.length?staleReturnRows:[{'Note':'None found — clean'}]),'Stale RM Returns');
    const staleResidualRows=(stale.staleResiduals||[]).map(r=>({'Residual ID':r.id,'Lot ID':r.lotId,'Grade':r.grade,'Vendor':r.vendor}));
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(staleResidualRows.length?staleResidualRows:[{'Note':'None found — clean'}]),'Stale Residuals');

    // Lot Address Mismatches
    const mismatchRows=(mismatch.mismatches||[]).map(m=>{
      const r=m.fullRecord||{};
      const row={'Table':m.table,'Saved (Stored) Address':m.storedKey,'Correct Address (from own text)':m.correctKey};
      Object.keys(r).forEach(k=>{
        if(k==='deliveries'&&Array.isArray(r[k])){row['Deliveries (raw)']=JSON.stringify(r[k]);}
        else if(typeof r[k]==='object'){row[k]=JSON.stringify(r[k]);}
        else{row[k]=r[k];}
      });
      return row;
    });
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(mismatchRows.length?mismatchRows:[{'Note':'None found — clean'}]),'Lot Address Mismatches');

    // Combined summary
    const summaryRows=[
      {'Check':'Duplicate lot IDs (active+archive)','Total Checked':dup.totalLotsChecked,'Issues Found':dup.genuineDuplicateCount},
      {'Check':'Stale Soft entry snapshots','Total Checked':stale.totalSoftEntries,'Issues Found':stale.staleSnapshotCount},
      {'Check':'Stale RM Returns','Total Checked':stale.totalRmReturns,'Issues Found':stale.staleReturnCount},
      {'Check':'Stale Residuals','Total Checked':stale.totalResiduals,'Issues Found':stale.staleResidualCount},
      {'Check':'Lot address matches own text','Total Checked':mismatch.totalLotsChecked,'Issues Found':mismatch.mismatchCount},
    ];
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(summaryRows),'Summary');

    XLSX.writeFile(wb,`ThreadControl_Lot_Issues_Report_${today()}.xlsx`);
    showToast('Report downloaded ✓');
  }catch(e){showToast('Failed to build report: '+e.message,'err');}
}

export async function runAllLotScans(){
  const el=document.getElementById('rm-scan-all-status');if(!el)return;
  el.textContent='Scanning...';
  try{
    const [staleRes,dupRes,mismatchRes]=await Promise.all([
      fetch(WORKER_URL+'/api/admin/scan-stale-lot-addresses',{headers:_getHeaders()}),
      fetch(WORKER_URL+'/api/admin/scan-duplicate-lot-ids',{headers:_getHeaders()}),
      fetch(WORKER_URL+'/api/admin/scan-lot-address-mismatches',{headers:_getHeaders()}),
    ]);
    const [stale,dup,mismatch]=await Promise.all([staleRes.json(),dupRes.json(),mismatchRes.json()]);
    if(!staleRes.ok||!stale.success||!dupRes.ok||!dup.success||!mismatchRes.ok||!mismatch.success){
      el.innerHTML='<span style="color:var(--re)">Could not complete one or more scans</span>';return;
    }
    const allClean=stale.clean&&dup.clean&&mismatch.clean;
    if(allClean){
      el.innerHTML=`<span style="color:var(--gr)">✓ Clean — checked stale addresses (${stale.totalSoftEntries} Soft, ${stale.totalRmReturns} RM Returns, ${stale.totalResiduals} Residuals), duplicate lot IDs (${dup.totalLotsChecked} lots), and lot address mismatches (${mismatch.totalLotsChecked} lots) — nothing found</span>`;
    }else{
      let html='<span style="color:var(--ye)">Found issues: ';
      const parts=[];
      if(!stale.clean)parts.push(`${stale.staleSnapshotCount+stale.staleReturnCount+stale.staleResidualCount} stale address record(s)`);
      if(!dup.clean)parts.push(`${dup.genuineDuplicateCount} duplicate lot(s)`);
      if(!mismatch.clean)parts.push(`${mismatch.mismatchCount} lot address mismatch(es)`);
      html+=parts.join(', ')+'. Download the full report for the complete, real data.</span>';
      el.innerHTML=html;
      console.warn('[Scan All] Stale addresses:',stale);
      console.warn('[Scan All] Duplicate lot IDs:',dup);
      console.warn('[Scan All] Lot address mismatches:',mismatch);
    }
  }catch(e){el.innerHTML='<span style="color:var(--re)">Network error — '+e.message+'</span>';}
}

export async function runCorrectDuplicateLots(){
  const el=document.getElementById('rm-correct-dup-status');if(!el)return;
  el.textContent='Running a fresh scan first...';
  try{
    // Aug 2 2026 — always re-scan right now, fresh, rather than trust
    // an earlier scan result that might be stale by the time this runs.
    const res=await fetch(WORKER_URL+'/api/admin/scan-duplicate-lot-ids',{headers:_getHeaders()});
    const data=await res.json();
    if(!res.ok||!data.success){el.innerHTML='<span style="color:var(--re)">Could not run the scan</span>';return;}
    if(data.clean){el.innerHTML='<span style="color:var(--gr)">✓ Nothing to correct — no genuine duplicates found</span>';return;}

    // Build the plan: for each duplicate, keep whichever copy has real,
    // genuine downstream usage. If neither or both have usage, skip it
    // and flag for manual review rather than guess.
    const targets=[];
    const skippedForReview=[];
    data.genuineDuplicates.forEach(d=>{
      const withUsage=d.copies.filter(c=>c.realUsageCount>0);
      if(withUsage.length!==1){skippedForReview.push({lotId:d.lotId,reason:withUsage.length===0?'neither copy has real usage':'both copies have real usage'});return;}
      const keep=withUsage[0];
      const remove=d.copies.find(c=>c!==keep);
      targets.push({lotId:d.lotId,grade:d.grade,vendor:d.vendor,keepUid:keep.fullRecord.uid,removeUid:remove.fullRecord.uid,removeTable:remove.table,removeKey:remove.key,
        _keepUsage:keep.realUsageCount,_removeUsage:remove.realUsageCount,_keepTable:keep.table,_addressOk:keep.addressMatchesOwnText});
    });

    if(targets.length===0){
      el.innerHTML='<span style="color:var(--ye)">Found duplicates, but none could be safely, automatically decided — see console for details, needs manual review</span>';
      console.warn('[Correct Duplicate Lots] Skipped, needs manual review:',skippedForReview);
      return;
    }

    let confirmMsg=`This will correct ${targets.length} duplicate lot(s):\n\n`;
    targets.forEach(t=>{
      confirmMsg+=`Lot ${t.lotId} (${t.grade}, ${t.vendor}):\n`;
      confirmMsg+=`  Keep: ${t.keepUid} (${t._keepTable}, ${t._keepUsage} real record(s) using it)${t._addressOk?'':' — its address will be corrected to match its own text'}\n`;
      confirmMsg+=`  Remove: ${t.removeUid} (${t._removeUsage} real records using it)\n\n`;
    });
    if(skippedForReview.length)confirmMsg+=`Skipping ${skippedForReview.length} lot(s) that need manual review — see console.\n\n`;
    confirmMsg+='Proceed?';

    if(!confirm(confirmMsg)){el.innerHTML='<span style="color:var(--mu)">Cancelled — nothing changed</span>';return;}

    el.textContent='Correcting...';
    const cRes=await fetch(WORKER_URL+'/api/admin/correct-duplicate-lots',{method:'POST',headers:_postHeaders(),body:JSON.stringify({targets})});
    const cData=await cRes.json();
    if(!cRes.ok||!cData.success){el.innerHTML='<span style="color:var(--re)">Correction failed: '+(cData.error||'unknown error')+'</span>';return;}

    console.warn('[Correct Duplicate Lots] Complete:',cData.results);
    const errors=cData.results.filter(r=>r.error);
    if(errors.length){
      el.innerHTML=`<span style="color:var(--ye)">Completed with ${errors.length} issue(s) — check console</span>`;
    }else{
      el.innerHTML=`<span style="color:var(--gr)">✓ Corrected ${cData.results.length} lot(s) — addresses fixed, duplicates removed, all real records repointed. Full detail in console.</span>`;
    }
    showToast('Duplicate lots corrected ✓');
  }catch(e){el.innerHTML='<span style="color:var(--re)">Error: '+e.message+'</span>';}
}

// Sep 10 2026 — real, direct fix built via direct discussion with
// Priyam: every other repair tool on this page has a separate,
// read-only "check first" button before its "fix" button — this one
// was missing that, only ever scanning as a hidden first step inside
// the fix button itself. Genuinely read-only, changes nothing —
// exactly like "Scan for Lot Issues" above does for the RM lot tools.
export async function checkDyeLotIdCollisions(){
  const el=document.getElementById('dye-id-collision-status');if(!el)return;
  el.textContent='Checking...';
  try{
    const res=await fetch(WORKER_URL+'/api/admin/scan-dye-lot-id-collisions',{headers:_getHeaders()});
    const data=await res.json();
    if(!res.ok||!data.success){el.innerHTML='<span style="color:var(--re)">Could not run the check</span>';return;}
    if(data.clean){el.innerHTML='<span style="color:var(--gr)">✓ Clean — no dye lot ID collisions found</span>';return;}
    let html=`<span style="color:var(--re)">Found ${data.collisionCount} collision(s):</span><ul style="margin:8px 0 0 18px;padding:0">`;
    data.collisions.forEach(c=>{
      c.copies.forEach(copy=>{
        html+=`<li>${copy.dyeLotNo} (${copy.table}, created ${new Date(copy.createdAt).toLocaleDateString()}) — ${copy.windCount} wind, ${copy.packCount} pack, ${copy.dispatchCount} dispatch record(s)</li>`;
      });
    });
    html+='</ul>';
    el.innerHTML=html;
    console.warn('[Dye Lot ID Collisions] Full scan detail:',data.collisions);
  }catch(e){el.innerHTML='<span style="color:var(--re)">Error: '+e.message+'</span>';}
}

// Sep 10 2026 — real, direct feature built via direct discussion with
// Priyam, tracing a genuine ID collision in his real production data
// back to its actual cause: Firebase's own import/export tool, used
// directly against the database, resets the ID counter that
// genIdAtomicServer relies on (fixed separately, going forward — this
// is the one-time repair for collisions that already happened before
// that fix existed). Deliberately its own tool, not folded into the
// RM lot "duplicate" tool above — this is a genuinely different
// situation: two DIFFERENT real dye batches sharing one ID, not one
// real thing recorded twice. Nothing gets deleted or merged; the
// older copy gets a real, fresh, unique ID.
export async function runFixDyeLotIdCollisions(){
  const el=document.getElementById('dye-id-collision-status');if(!el)return;
  el.textContent='Running a fresh scan first...';
  try{
    const res=await fetch(WORKER_URL+'/api/admin/scan-dye-lot-id-collisions',{headers:_getHeaders()});
    const data=await res.json();
    if(!res.ok||!data.success){el.innerHTML='<span style="color:var(--re)">Could not run the scan</span>';return;}
    if(data.clean){el.innerHTML='<span style="color:var(--gr)">✓ Nothing to correct — no dye lot ID collisions found</span>';return;}

    // Always fix whichever copy was created earlier — the newer one
    // is far more likely to still have someone actively looking at it
    // right now, so the older, already-settled copy is the lower-risk
    // one to renumber.
    const targets=[];
    data.collisions.forEach(c=>{
      const sorted=[...c.copies].sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));
      const older=sorted[0], newer=sorted[sorted.length-1];
      targets.push({dyeLotNo:older.dyeLotNo,currentId:older.fullRecord.id,table:older.table,
        _newerDyeLotNo:newer.dyeLotNo,_olderCounts:{wind:older.windCount,pack:older.packCount,dispatch:older.dispatchCount}});
    });

    let confirmMsg=`This will correct ${targets.length} dye lot ID collision(s):\n\n`;
    targets.forEach(t=>{
      confirmMsg+=`Shared ID currently used by both ${t.dyeLotNo} and ${t._newerDyeLotNo}:\n`;
      confirmMsg+=`  ${t.dyeLotNo} (older, ${t.table}) will get a fresh, unique ID — ${t._olderCounts.wind} wind, ${t._olderCounts.pack} pack, ${t._olderCounts.dispatch} dispatch record(s) will be repointed to it\n`;
      confirmMsg+=`  ${t._newerDyeLotNo} keeps its current ID, completely untouched\n\n`;
    });
    confirmMsg+='Proceed?';
    if(!confirm(confirmMsg)){el.innerHTML='<span style="color:var(--mu)">Cancelled — nothing changed</span>';return;}

    const password=prompt('Enter your password to confirm this correction:');
    if(!password){el.innerHTML='<span style="color:var(--mu)">Cancelled — nothing changed</span>';return;}

    el.textContent='Correcting...';
    const cRes=await fetch(WORKER_URL+'/api/admin/fix-dye-lot-id-collisions',{method:'POST',headers:_postHeaders(),body:JSON.stringify({targets:targets.map(({_newerDyeLotNo,_olderCounts,...t})=>t),password,changedBy:State.currentUser?.name})});
    const cData=await cRes.json();
    if(!cRes.ok||!cData.success){el.innerHTML='<span style="color:var(--re)">Correction failed: '+(cData.error||'unknown error')+'</span>';return;}

    console.warn('[Fix Dye Lot ID Collisions] Complete:',cData.results);
    const errors=cData.results.filter(r=>r.error);
    if(errors.length){
      el.innerHTML=`<span style="color:var(--ye)">Completed with ${errors.length} issue(s) — check console</span>`;
    }else{
      el.innerHTML=`<span style="color:var(--gr)">✓ Corrected ${cData.results.length} dye lot ID collision(s) — full detail in console.</span>`;
    }
    showToast('Dye lot ID collisions corrected ✓');
  }catch(e){el.innerHTML='<span style="color:var(--re)">Error: '+e.message+'</span>';}
}

// Sep 10 2026 — real, direct feature built via direct discussion with
// Priyam, from his own real observation that his Excel export's "Dye
// Lots" total and "Dye Sources" breakdown didn't match: found and
// fixed the actual, ongoing cause (a Dye edit's total never used to
// update its source breakdown — now it does, for every new edit,
// proportionally). This is the other half — a real dye lot edited
// before that fix existed. Genuinely read-only, changes nothing.
export async function checkDyeSourceMismatches(){
  const el=document.getElementById('dye-source-mismatch-status');if(!el)return;
  el.textContent='Checking...';
  try{
    const res=await fetch(WORKER_URL+'/api/admin/scan-dye-source-mismatches',{headers:_getHeaders()});
    const data=await res.json();
    if(!res.ok||!data.success){el.innerHTML='<span style="color:var(--re)">Could not run the check</span>';return;}
    if(data.clean){el.innerHTML=`<span style="color:var(--gr)">✓ Clean — checked ${data.checkedCount} dye lot(s), all sources genuinely tally with their own total</span>`;return;}
    // Sep 10 2026 — real, direct rebuild built via direct discussion
    // with Priyam, from his own real, careful review of his real 12
    // mismatches: this is genuinely 4 different situations, not one —
    // shown separately here so it's clear which ones a fix can
    // actually help, and which ones genuinely need a real, human look
    // instead.
    const autoFixable=data.results.filter(r=>r.autoFixable);
    const needsReview=data.results.filter(r=>!r.autoFixable);
    let html=`<span style="color:var(--re)">Found ${data.mismatchCount} dye lot(s) whose sources don't tally with their own total:</span>`;
    if(autoFixable.length){
      html+=`<div style="margin-top:8px;font-size:0.75rem;font-weight:700;color:var(--gr)">✓ ${autoFixable.length} can be safely auto-corrected:</div><ul style="margin:4px 0 0 18px;padding:0">`;
      autoFixable.forEach(r=>{
        const catLabel=r.category==='zero_cones_single_source'?' (cones was never recorded on this source — will be set directly)':'';
        html+=`<li>${r.dyeLotNo} (${r.table}) — total says ${r.totalInWeight}kg / ${r.totalInCones} cones, sources sum to ${r.sourceWeight}kg / ${r.sourceCones} cones${catLabel}</li>`;
      });
      html+='</ul>';
    }
    if(needsReview.length){
      html+=`<div style="margin-top:10px;font-size:0.75rem;font-weight:700;color:var(--ye)">⚠ ${needsReview.length} need a real, human look first — a fix would not be safe here:</div><ul style="margin:4px 0 0 18px;padding:0">`;
      needsReview.forEach(r=>{
        const reason=r.category==='swapped'?'weight and cones look genuinely swapped — a real data-entry mix-up, not drift':r.category==='no_evidence'?'no real edit history shows anyone ever deliberately correcting this lot\'s own total — with no evidence for which number is genuinely true, an automated fix could just as easily overwrite the correct one':'the gap here is unusually large relative to the real numbers involved';
        html+=`<li>${r.dyeLotNo} (${r.table}) — total says ${r.totalInWeight}kg / ${r.totalInCones} cones, sources sum to ${r.sourceWeight}kg / ${r.sourceCones} cones — <em>${reason}</em></li>`;
      });
      html+='</ul>';
    }
    el.innerHTML=html;
    console.warn('[Dye Source Mismatches] Full scan detail:',data.results);
  }catch(e){el.innerHTML='<span style="color:var(--re)">Error: '+e.message+'</span>';}
}

export async function runFixDyeSourceMismatches(){
  const el=document.getElementById('dye-source-mismatch-status');if(!el)return;
  el.textContent='Running a fresh scan first...';
  try{
    const res=await fetch(WORKER_URL+'/api/admin/scan-dye-source-mismatches',{headers:_getHeaders()});
    const data=await res.json();
    if(!res.ok||!data.success){el.innerHTML='<span style="color:var(--re)">Could not run the scan</span>';return;}
    if(data.clean){el.innerHTML='<span style="color:var(--gr)">✓ Nothing to correct — all dye lot sources already tally with their own total</span>';return;}

    // Sep 10 2026 — real, direct rebuild: only the genuinely
    // auto-fixable ones are ever sent for correction — swapped and
    // suspicious cases are never included here, no matter what, since
    // an automated fix would be actively wrong for both.
    const autoFixable=data.results.filter(r=>r.autoFixable);
    const needsReview=data.results.filter(r=>!r.autoFixable);
    if(!autoFixable.length){
      el.innerHTML=`<span style="color:var(--ye)">None of the ${data.mismatchCount} mismatch(es) found are safe to auto-correct — all ${needsReview.length} need a real, human look first (see the Check results above for why).</span>`;
      return;
    }

    const targets=autoFixable.map(r=>({key:r.key,table:r.table,dyeLotId:r.dyeLotId,_dyeLotNo:r.dyeLotNo,_totalInWeight:r.totalInWeight,_sourceWeight:r.sourceWeight,_category:r.category}));
    let confirmMsg=`This will correct ${targets.length} dye lot(s) whose source breakdown doesn't tally with their own total:\n\n`;
    targets.forEach(t=>{
      const how=t._category==='zero_cones_single_source'?'cones will be set directly to match the lot\'s own total (there\'s only one source, so 100% of it genuinely belongs there)':`sources will be rescaled from summing to ${t._sourceWeight}kg to correctly sum to the lot's own real total, ${t._totalInWeight}kg`;
      confirmMsg+=`${t._dyeLotNo}: ${how}\n`;
    });
    if(needsReview.length){
      confirmMsg+=`\n${needsReview.length} other mismatch(es) found are NOT included — they need a real, human look first, not an automated fix.`;
    }
    confirmMsg+='\n\nProceed?';
    if(!confirm(confirmMsg)){el.innerHTML='<span style="color:var(--mu)">Cancelled — nothing changed</span>';return;}

    const password=prompt('Enter your password to confirm this correction:');
    if(!password){el.innerHTML='<span style="color:var(--mu)">Cancelled — nothing changed</span>';return;}

    el.textContent='Correcting...';
    const cRes=await fetch(WORKER_URL+'/api/admin/fix-dye-source-mismatches',{method:'POST',headers:_postHeaders(),body:JSON.stringify({targets:targets.map(({_dyeLotNo,_totalInWeight,_sourceWeight,_category,...t})=>t),password})});
    const cData=await cRes.json();
    if(!cRes.ok||!cData.success){el.innerHTML='<span style="color:var(--re)">Correction failed: '+(cData.error||'unknown error')+'</span>';return;}

    console.warn('[Fix Dye Source Mismatches] Complete:',cData.results);
    const errors=cData.results.filter(r=>r.error);
    const reviewNote=needsReview.length?` ${needsReview.length} other mismatch(es) still need a real, human look — see the Check results above.`:'';
    if(errors.length){
      el.innerHTML=`<span style="color:var(--ye)">Completed with ${errors.length} issue(s) — check console</span>`;
    }else{
      el.innerHTML=`<span style="color:var(--gr)">✓ Corrected ${cData.results.length} dye lot(s) — sources now genuinely tally with their own total.${reviewNote} Full detail in console.</span>`;
    }
    showToast('Dye source mismatches corrected ✓');
  }catch(e){el.innerHTML='<span style="color:var(--re)">Error: '+e.message+'</span>';}
}

export async function runCorrectLotAddresses(){
  const el=document.getElementById('rm-addr-mismatch-status');if(!el)return;
  el.textContent='Running a fresh scan first...';
  try{
    // Aug 5 2026 — always re-scan right now, fresh, same safety
    // principle as the duplicate-lot correction.
    const res=await fetch(WORKER_URL+'/api/admin/scan-lot-address-mismatches',{headers:_getHeaders()});
    const data=await res.json();
    if(!res.ok||!data.success){el.innerHTML='<span style="color:var(--re)">Could not run the scan</span>';return;}
    if(data.clean){el.innerHTML='<span style="color:var(--gr)">✓ Nothing to correct — every lot already matches its own text</span>';return;}

    const targets=data.mismatches.map(m=>({table:m.table,storedKey:m.storedKey,_correctKey:m.correctKey}));
    let confirmMsg=`This will correct ${targets.length} lot address(es), moving each to match its own current text:\n\n`;
    targets.forEach(t=>{ confirmMsg+=`  ${t.storedKey}\n  → ${t._correctKey}\n\n`; });
    confirmMsg+='Proceed?';

    if(!confirm(confirmMsg)){el.innerHTML='<span style="color:var(--mu)">Cancelled — nothing changed</span>';return;}

    el.textContent='Correcting...';
    const cRes=await fetch(WORKER_URL+'/api/admin/correct-lot-addresses',{method:'POST',headers:_postHeaders(),body:JSON.stringify({targets:targets.map(t=>({table:t.table,storedKey:t.storedKey}))})});
    const cData=await cRes.json();
    if(!cRes.ok||!cData.success){el.innerHTML='<span style="color:var(--re)">Correction failed: '+(cData.error||'unknown error')+'</span>';return;}

    console.warn('[Correct Lot Addresses] Complete:',cData.results);
    const errors=cData.results.filter(r=>r.error);
    if(errors.length){
      el.innerHTML=`<span style="color:var(--ye)">Completed with ${errors.length} issue(s) — check console</span>`;
    }else{
      el.innerHTML=`<span style="color:var(--gr)">✓ Corrected ${cData.results.length} lot(s) — addresses fixed, all real records repointed. Full detail in console.</span>`;
    }
    showToast('Lot addresses corrected ✓');
  }catch(e){el.innerHTML='<span style="color:var(--re)">Error: '+e.message+'</span>';}
}

export async function runRMUidMigration(){
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

export async function runUidBackfill(){
  if(!confirm('Backfill both the permanent ID AND the saved address column onto all existing records that reference an RM lot — Soft entries, Dye Sources, RM Returns, Residual Log/Stock, and RM delivery voids? Safe and additive — only adds what\'s missing, using each real RM lot\'s own already-confirmed identity. Nothing else changes. Safe to run more than once.'))return;
  const el=document.getElementById('rm-uid-backfill-status');if(!el)return;
  const steps=[
    {label:'Soft entries',url:'/api/admin/backfill-soft-uid'},
    {label:'Dye Sources',url:'/api/admin/backfill-dyesource-uid'},
    {label:'RM Returns',url:'/api/admin/backfill-rmreturn-uid'},
    {label:'Residual Log/Stock',url:'/api/admin/backfill-residual-uid'},
    {label:'RM delivery voids',url:'/api/admin/backfill-voidlog-uid'},
  ];
  const totals={};
  const allSkipped=[];
  try{
    for(const step of steps){
      totals[step.label]=0;
      let rounds=0;
      while(rounds<20){
        el.innerHTML=`Backfilling ${step.label}... (${totals[step.label]} done so far)`;
        const res=await fetch(WORKER_URL+step.url,{method:'POST',headers:_postHeaders(),body:JSON.stringify({batchSize:200})});
        const data=await res.json();
        if(!res.ok||!data.success){el.innerHTML=`<span style="color:var(--re)">${step.label} backfill failed: ${data.error||'unknown error'}</span>`;return;}
        totals[step.label]+=data.backfilled||0;
        // Aug 2 2026 — Priyam's direct, correct point: the scan already
        // confirmed everything should match, so a real skip here is a
        // genuine, unexpected finding, not something to fold silently
        // into a count. Collected and surfaced directly.
        if(data.skippedDetail?.length)allSkipped.push(...data.skippedDetail.map(d=>({...d,table:step.label})));
        rounds++;
        if(data.alreadyDone||data.remaining===0)break;
      }
    }
    const summary=steps.map(s=>`${totals[s.label]} ${s.label}`).join(', ');
    if(allSkipped.length>0){
      console.warn('[Backfill] Genuine skips found — did not match any real lot, worth investigating:',allSkipped);
      el.innerHTML=`<span style="color:var(--ye)">Backfill complete — ${summary}. But ${allSkipped.length} record(s) could not find a matching lot at all — genuinely unexpected, check the browser console for the full list.</span>`;
    }else{
      showToast('Backfill complete ✓ — '+summary+' (zero skips)');
    }
    await checkUidBackfillStatus();
  }catch(e){el.innerHTML='<span style="color:var(--re)">Network error — not fully completed: '+e.message+'</span>';}
}

export async function runTrimBackupsNow(){
  const el=document.getElementById('backup-trim-status');if(!el)return;
  if(!confirm('This will permanently delete old backups beyond the most recent 5, on both Firebase and Cloudflare R2. Proceed?'))return;
  el.textContent='Trimming...';
  try{
    const res=await fetch(WORKER_URL+'/api/admin/trim-backups-now',{method:'POST',headers:_postHeaders()});
    const data=await res.json();
    if(!res.ok||!data.success){el.innerHTML='<span style="color:var(--re)">Could not run the cleanup</span>';return;}
    el.innerHTML=`<span style="color:var(--gr)">✓ Firebase: had ${data.firebase.before}, deleted ${data.firebase.deleted}, now ${data.firebase.after}. `
      +(data.r2.skipped?`R2: ${data.r2.skipped}.`:`R2: had ${data.r2.before}, deleted ${data.r2.deleted}, now ${data.r2.after}.`)+'</span>';
  }catch(e){el.innerHTML='<span style="color:var(--re)">Failed — check connection</span>';}
}

window.renderMasterList = renderMasterList;
window.switchMasterTab = switchMasterTab;
window.addMaster = addMaster;
window.openMasterEdit = openMasterEdit;
window.saveMasterEdit = saveMasterEdit;
window._doMasterEditConfirm = _doMasterEditConfirm;
window.confirmMasterDelete = confirmMasterDelete;
window.deleteMasterItem = deleteMasterItem;
window.addMachine = addMachine;
window.setMachineStage = setMachineStage;
window.migrateMachine = migrateMachine;
window.setMasterSortMode = setMasterSortMode;
window.scanMissingMasters = scanMissingMasters;
window.addMissingMaster = addMissingMaster;
window.updateMachineCap = updateMachineCap;
window.openAdminDelConfirm = openAdminDelConfirm;
window.openAdminDirectDelete = openAdminDirectDelete;
window.openClearStage = openClearStage;
window.openDeleteRequest = openDeleteRequest;
window.rejectDeleteRequest = rejectDeleteRequest;
window.saveDyeLotStartingNo = saveDyeLotStartingNo;
window.saveAgingThresholds = saveAgingThresholds;
window.checkOrphanedLots = checkOrphanedLots;
window.checkRMUidStatus = checkRMUidStatus;
window.checkUidBackfillStatus = checkUidBackfillStatus;
window.downloadAllLotIssuesReport = downloadAllLotIssuesReport;
window.runAllLotScans = runAllLotScans;
window.runCorrectDuplicateLots = runCorrectDuplicateLots;
window.checkDyeLotIdCollisions = checkDyeLotIdCollisions;
window.runFixDyeLotIdCollisions = runFixDyeLotIdCollisions;
window.checkDyeSourceMismatches = checkDyeSourceMismatches;
window.runFixDyeSourceMismatches = runFixDyeSourceMismatches;
window.runCorrectLotAddresses = runCorrectLotAddresses;
window.runRMUidMigration = runRMUidMigration;
window.runUidBackfill = runUidBackfill;
window.runTrimBackupsNow = runTrimBackupsNow;

// Aug 26 2026 — real, admin-only button built via direct discussion
// with Priyam, giving him an actual way to use the 2 backend tools
// built earlier today — checking, and fixing, any real account still
// sitting with a plaintext or old SHA-256 password, since the
// automatic upgrade only ever fires the moment that specific account
// logs in. Same real pattern as checkRMUidStatus right above.
export async function checkPasswordSecurity(){
  const el=document.getElementById('password-security-status');if(!el)return;
  const fixBtn=document.getElementById('password-security-fix-btn');
  el.textContent='Checking...';
  try{
    const res=await fetch(WORKER_URL+'/api/admin/check-password-security',{headers:_getHeaders()});
    const data=await res.json();
    if(!res.ok){el.innerHTML='<span style="color:var(--re)">Could not check status</span>';return;}
    if(data.needsUpgrade===0){
      el.innerHTML=`<span style="color:var(--gr)">✓ All ${data.totalUsers} accounts are already on the secure format</span>`;
      if(fixBtn)fixBtn.disabled=true;
    }else{
      const names=data.report.filter(r=>r.format!=='pbkdf2 (secure)').map(r=>r.name).join(', ');
      el.innerHTML=`<span style="color:var(--ye)">⚠ ${data.needsUpgrade} of ${data.totalUsers} accounts still need upgrading: ${names}</span>`;
      if(fixBtn)fixBtn.disabled=false;
    }
  }catch(e){el.innerHTML='<span style="color:var(--re)">Network error — '+e.message+'</span>';}
}

export async function runForceUpgradePasswords(){
  if(!confirm('Upgrade every remaining account to the secure password format now? This cannot be undone, but nothing changes for anyone logging in — their real password stays the same, just stored safely.'))return;
  const el=document.getElementById('password-security-status');if(!el)return;
  const fixBtn=document.getElementById('password-security-fix-btn');
  el.textContent='Upgrading...';
  try{
    const {ok,data,error,networkError}=await apiPost('/api/admin/force-upgrade-passwords',{});
    if(networkError)throw new Error(error);
    if(!ok){el.innerHTML='<span style="color:var(--re)">'+(error||'Could not upgrade')+'</span>';return;}
    el.innerHTML=`<span style="color:var(--gr)">✓ Upgraded ${data.upgraded} account(s) — all ${data.totalUsers} are now secure</span>`;
    if(fixBtn)fixBtn.disabled=true;
    showToast('Passwords upgraded ✓');
  }catch(e){el.innerHTML='<span style="color:var(--re)">Network error — '+e.message+'</span>';}
}

window.checkPasswordSecurity = checkPasswordSecurity;
window.runForceUpgradePasswords = runForceUpgradePasswords;
