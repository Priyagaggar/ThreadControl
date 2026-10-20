import {Q,Qadd,Qsub,Qmax0,appr,seMatch,calcLotByKey,calcSoftIn,calcRMReturnedOut,calcRMBalance,calcSoftOut,calcSoftConsumedByDye,calcSoftResidualOut,calcSoftBalanceWeight,calcDyeBal,calcTotalPackedApproved,calcWindBal,calcTotalDispatchedApproved,calcPackBal,calcVendorRatioForDyeLot,calcDyeAllocated,calcWindInAllocated,calcWindOutAllocated,calcPackInAllocated,calcDispatchAllocated,calcDyeBalanceByLot,calcWindBalanceByLot,calcDyeBalAvailable,calcWindBalAvailable,calcPackBalAvailable,calcStageBalanceAvailable,calcSoftConsumedByDyeWIP,calcSoftBalanceWeightAvailable,calcSoftBalanceAvailable,calcDeadStockBalance,calcDeadStockConesBalance,calcRecycleSteelBal,calcRecycleSteelAvailable,calcRecycleSoftenedBal,calcRecycleSoftenedAvailable} from './shared-balances.js';
// Sep 24 2026 — Phase 2c integration, design reviewed and approved before this was written. Toggle defaults to OFF —
// with it off, every line below this import is dead code, never reached, and the app behaves byte-for-byte as it
// did before this phase. Reused exactly as already built and tested in Phases 2a/2b — nothing here rewrites either.
import { openTCDatabase, getAllRecords, TABLE_IDENTITY } from './idb-storage.js';
import { syncTable } from './smart-loader.js';
const SMART_LOADER_ENABLED = true; // STAGING ONLY — flipped on 2026-09-25 for real staging verification, per Priyam's request. Do not use this value for production until staging observation (getLoaderSessionState/getSyncStats + real Firebase usage) confirms it's safe.
const _FIREBASE_CONFIG_PROD={apiKey:"AIzaSyAYQnWzX_nJeSTPWJIz7y6Ef9hmbc3kuUk",authDomain:"threadcontrolproduction-2.firebaseapp.com",databaseURL:"https://threadcontrolproduction-2-default-rtdb.asia-southeast1.firebasedatabase.app",projectId:"threadcontrolproduction-2",storageBucket:"threadcontrolproduction-2.firebasestorage.app",messagingSenderId:"959963312722",appId:"1:959963312722:web:bfee5d00e6a25b94c8a58b",measurementId:"G-35EJP10SGG"};
const _FIREBASE_CONFIG_STAGING={apiKey:"AIzaSyCVWjY8gt9LTfxNLXXYet4kkVdT54WcbIQ",authDomain:"stagingthread.firebaseapp.com",databaseURL:"https://stagingthread-default-rtdb.firebaseio.com",projectId:"stagingthread",storageBucket:"stagingthread.firebasestorage.app",messagingSenderId:"350121995785",appId:"1:350121995785:web:cea6de640664853f2092d8"};
// Staging/production auto-detected from the hostname the app is served
// from — no manual config swap needed before deploying to either. Jul 10
// 2026: added when a genuinely separate staging Firebase project
// (stagingthread) was set up, so testing on staging can never touch
// production data.
const IS_STAGING=typeof window!=='undefined'&&window.location&&window.location.hostname.includes('staging');
const FIREBASE_CONFIG=IS_STAGING?_FIREBASE_CONFIG_STAGING:_FIREBASE_CONFIG_PROD;
const USE_FIREBASE=FIREBASE_CONFIG.databaseURL&&FIREBASE_CONFIG.databaseURL.length>10;
export const GSHEET_WEBHOOK_URL="";
export const WORKER_URL=IS_STAGING?"https://stagingthread.abhipolywork.workers.dev":"https://cold-breeze-bb3e.abhipolywork.workers.dev";
export function _getHeaders(){const t=sessionStorage.getItem('tc_token');return t?{'Authorization':'Bearer '+t}:{};}
export function _postHeaders(){return{..._getHeaders(),'Content-Type':'application/json'};}
// API_SECRET removed — auth via signed session token (Bearer) issued on login
export const State={
  _apprTab: 'soft',
  _bevFilter: {},
  _bevSort: {},
  _csf_t: undefined,
  _dashPeriod: 'month',
  _dyeEntriesLoaded: false,
  _editEntryId: '',
  _editEntryType: '',
  _layer3Loaded: {},
  _pendingDelivery: null,
  _stgTabs: {},
  _stockTab: 'rm',
  _voidEntryId: null,
  _voidEntryType: null,
  _vtShowVoided: {},
  _windMode: null,
  _wipTab: 'soft',
  anMHPeriod: '4weeks',
  anTrendGroup: 'week',
  currentPage: 'dashboard',
  currentUser: null,
  // Sep 25 2026 — the currently logged-in user's open per-user IndexedDB connection (per-user isolation design,
  // approved before this was written). null when no user is logged in, or between logout and the next login.
  currentDB: null,
  DB: {masters:{vendors:[],mills:[],grades:[],machines:[],workers:[]},lots:[],stageEntries:[],dyeBatches:[],dispatches:[],users:[],voidLog:[],lotFlags:{},dyeLotFlags:{},entryFlags:{},parties:[],deleteRequests:[],dyeLots:[],dyeEntries:[],windEntries:[],packEntries:[],editLog:[],rmEditLog:[],deadStock:[],recycleStock:[],scrapLog:[],residualStock:[],residualLog:[],rmReturnLog:[],partyOrders:[],holdOverrides:[],agingThresholds:{yellow:7,red:15}},
  deferredPrompt: null,
  fbDB: null,
  firebaseLoaded: false,
  stageAction: 'Start',
  touchStartY: 0,
  vtSelectedLot: null,
  vtSelectedVendor: null
};

export const STAGE_CONFIG={RM:{color:'var(--mu)',icon:'📦',label:'Raw Material'},Soft:{color:'var(--cs)',icon:'💧',label:'Softening'},Dye:{color:'var(--cd)',icon:'🎨',label:'Dyeing'},Wind:{color:'var(--cw)',icon:'🧵',label:'Winding'},Pack:{color:'var(--cp)',icon:'📦',label:'Packing'},Dispatch:{color:'var(--gr)',icon:'🚚',label:'Dispatch'}};
export const _inDayFn=ts=>{if(!ts)return false;const d=ts.split('T')[0];const selDate=document.getElementById('an-daily-date')?.value||new Date().toISOString().split('T')[0];return d===selDate;};



let _pendingSave=false;
let _nullRetryCount=0;
let _backupInterval=null;
let _dbListenerAttached=false;


let _renderDebounceTimer=null;
const setStatus=(msg,color)=>{const sk=document.getElementById('sk-storage');if(sk){sk.textContent=msg;sk.style.color=color||'var(--mu)';}console.log('[Firebase]',msg);};
// Aug 4 2026 — moved here, to genuine top-level module scope, after a
// real, confirmed bug: this used to live nested 3 levels deep inside
// initFirebase() → _startDataLoad(), invisible to anything defined
// outside that scope (_mergeArchiveIntoDb, _attachRealtimeListeners,
// _lotsForDropdown, _searchArchive) — causing a genuine, live
// "_sameLot is not defined" crash every time archive data merged or a
// real-time lot update arrived, on every single page load. Matches two
// lots by the real, permanent uid when both sides have one; falls back
// to text only for the rare not-yet-migrated case.
const _sameLot=(a,b)=>a&&b?(a.uid&&b.uid?a.uid===b.uid:(a.id===b.id&&a.grade===b.grade&&a.vendor===b.vendor)):false;
// Sep 25 2026 — per-user isolation (approved design): these must live at true module top level, not nested inside
// initFirebase() below — confirmed during this exact implementation that _startDataLoad() and everything the
// anonymous-auth callback triggers are nested three levels deep (module → initFirebase() → _startDataLoad()), which
// is fine for code nothing outside ever needs to reach, but logout() (defined far below, entirely outside
// initFirebase()) needs to reset _dataLoadStarted, so it cannot be trapped inside that nested closure.
let _firebaseAuthReady = false;
let _dataLoadStarted = false;
// Sep 2026 — same bridging pattern as _startDataLoadFn directly below: _runPhase2cSmartLoaderFlowNewer is defined
// inside _startDataLoad()'s own closure (it needs _buildRealApiFor/_SYNC_OUTCOME_IS_FATAL/_bumpStat, private to
// that closure) but must be callable from _loadLayer2, which lives at true top level, outside it. Assigned
// synchronously during _startDataLoad()'s own execution, long before _loadLayer2 is ever actually invoked
// (_loadLayer2 only runs 500ms after _onL1Ready, itself only reachable from deep inside _startDataLoad()'s own
// run) — so by the time _loadLayer2 calls it, it is always already set.
let _runLayer2SmartLoaderFn = null;
let _startDataLoadFn = null; // assigned once, inside initFirebase() below, at the exact point _startDataLoad is
// declared — _maybeStartDataLoad() lives at true top level and cannot otherwise reach a function nested inside
// initFirebase()'s own closure; this reference is the bridge between the two.
export function _maybeStartDataLoad() {
  if (_dataLoadStarted) return; // never start twice, regardless of which path calls this first
  if (!_firebaseAuthReady) return;
  if (!State.currentUser || !State.currentUser.id) return; // still don't know who's logging in — wait
  if (!_startDataLoadFn) return; // initFirebase() hasn't reached the point of defining it yet — nothing to call
  _dataLoadStarted = true;
  _startDataLoadFn();
}

export function initFirebase(){if(!USE_FIREBASE)return;if(State.fbDB)return;
try{
firebase.initializeApp(FIREBASE_CONFIG);
State.fbDB=firebase.database();
setStatus('Connecting...','var(--ye)');

// Connection monitor — .info/connected is a synthetic SDK-only path, never subject to rules, safe pre-auth
// Jul 28 2026 — reconnection catch-up, confirmed design: dormant unless
// a real disconnect-then-reconnect actually happens — same "fire
// extinguisher" principle as everything else built today, not a
// background process running constantly. The listener itself keeps
// people updated live the vast majority of the time; this exists purely
// for the narrow gap where a brief drop could cause one specific update
// to be missed during reconnection. Reuses the exact same updatedSince +
// shallow-verify pattern already built and tested for login — nothing
// new invented, just applied to a second real trigger point.
let _wasDisconnectedAt = null;
State.fbDB.ref('.info/connected').on('value',snap=>{
  if(snap.val()===true){
    if(State.firebaseLoaded)setStatus('Firebase ✓','var(--gr)');else setStatus('Connected — loading data...','var(--ye)');
    if(_wasDisconnectedAt && State.firebaseLoaded){
      const since=_wasDisconnectedAt;
      _wasDisconnectedAt=null;
      _catchUpAfterReconnect(since);
    }
  }
  else{if(State.firebaseLoaded){setStatus('Reconnecting...','var(--ye)');console.warn('[Firebase] Connection lost — will auto-retry');_wasDisconnectedAt=new Date().toISOString();}}
});

function _catchUpAfterReconnect(since){
  const _hotPaths=['stageEntries','dyeLots','windEntries','packEntries','dispatches','lots'];
  let _anyChanged=false;
  let _pending=_hotPaths.length;
  const _checkDone=()=>{ _pending--; if(_pending===0 && _anyChanged && typeof window.renderAll==='function'){ setTimeout(()=>window.renderAll(),300); } };
  _hotPaths.forEach(path=>{
    fetch(WORKER_URL+'/api/data/'+path+'?updatedSince='+encodeURIComponent(since),{headers:_getHeaders()})
      .then(r=>{if(!r.ok) throw new Error('HTTP '+r.status); return r.json();})
      .then(data=>{
        const changed=(data.data||[]).filter(e=>e!=null&&typeof e==='object'&&e.id);
        const current=Array.isArray(State.DB[path])?State.DB[path]:[];
        const merged=[...current];
        // Aug 2 2026 fix — same real bug as the login-time incremental
        // loader: plain e.id collapses multiple real, different lots
        // that share the same lot number into one shared map slot.
        const mergedIdx=new Map(merged.map((e,i)=>[_realKeyFor(path,e),i]));
        changed.forEach(e=>{
          const k=_realKeyFor(path,e);
          if(mergedIdx.has(k)) merged[mergedIdx.get(k)]=e;
          else { merged.push(e); mergedIdx.set(k,merged.length-1); }
        });
        // Verification runs every time, regardless of whether the
        // incremental fetch itself found anything — this is the whole
        // point of it: catching what the incremental fetch might have
        // missed, not just double-checking what it already found.
        return fetch(WORKER_URL+'/api/data/'+path+'?shallow=true',{headers:_getHeaders()})
          .then(r=>{if(!r.ok) throw new Error('HTTP '+r.status); return r.json();})
          .then(shallowData=>{
            const realIds=new Set(shallowData.ids||[]);
            const localIds=new Set(merged.map(e=>_realKeyFor(path,e)));
            const missingIds=[...realIds].filter(id=>!localIds.has(id));
            if(missingIds.length>0){
              console.warn('[Reconnect-catchup] verification found gaps for',path,'— fetching missing records individually');
              missingIds.forEach(id=>{ if(path==='dyeLots')_hydrateDyeLot(id); });
            }
            const staleIds=[...localIds].filter(id=>!realIds.has(id));
            State.DB[path]=merged.filter(e=>!staleIds.includes(_realKeyFor(path,e)));
            if(changed.length>0||missingIds.length>0||staleIds.length>0){
              _anyChanged=true;
              console.log('[Reconnect-catchup] caught up:',path,'→',changed.length,'changed,',missingIds.length,'missing,',staleIds.length,'stale');
            }
          });
      })
      .catch(err=>console.warn('[Reconnect-catchup] failed for',path,':',err.message))
      .finally(_checkDone);
  });
}

loadLocal();

// Show cached UI instantly while Firebase loads
const _cachedRaw=localStorage.getItem('tc_db_cache');
if(_cachedRaw){try{const _cached=JSON.parse(_cachedRaw);if(_cached&&_cached.lots){State.DB={..._cached};setStatus('Loading from cache...','var(--mu)');}}catch(e){}}

// Anonymous sign-in gates ALL real Firebase data reads — rules require auth!=null
// on everything. Listeners and L1/L2 loads must not fire until this resolves.
// Sep 25 2026 — per-user isolation (approved design): data loading must ALSO wait until we know WHICH user is
// logged in, since it now opens that specific user's own IndexedDB database. Confirmed during audit: for a
// returning session (sessionStorage restore, in pages.js), State.currentUser is already set by the time this
// resolves — no change in behavior there. For a brand-new login, it is not set yet at this point, so this must
// wait rather than proceeding — _maybeStartDataLoad() is the shared guard both paths go through, called from here
// and, symmetrically, from doLogin()'s own success handler below once State.currentUser becomes known there.
// _startDataLoad (below) is a hoisted function declaration inside THIS function's own scope — this assignment
// bridges it to the top-level _startDataLoadFn reference so _maybeStartDataLoad() (defined outside initFirebase(),
// where _startDataLoad itself is not visible at all) can actually call it once both real conditions are met.
_startDataLoadFn = _startDataLoad;
firebase.auth().signInAnonymously().then(()=>{
  _firebaseAuthReady = true;
  _maybeStartDataLoad();
}).catch(err=>{
  console.error('[Firebase] Anonymous sign-in failed:',err);
  setStatus('⚠ Auth failed — contact admin','var(--re)');
});

function _startDataLoad(){

// ── LAYER 1: Startup-critical data ──
// Loads in parallel. App renders only after ALL of these are ready.
// NOTE: 'users' intentionally excluded — /tc/users is blocked by Firebase rules
// for client reads. Login + all admin-password checks go through the Worker now.
const L1_PATHS=['masters','parties','lotSummaries','dyeLotSummaries','partySummaries','orderSummaries'];
const L1_OPEN_PATHS=['stageEntries','dyeLots','windEntries','packEntries','dispatches','lots'];
const _l1Loaded=new Set();
const _l1Total=L1_PATHS.length+L1_OPEN_PATHS.length;

function _onL1Ready(){
  if(_l1Loaded.size<_l1Total)return;
  // All Layer 1 ready
  _applyMigrations();
  // DB.users is intentionally NOT loaded client-side anymore — don't require it here.
  const _structOk=Array.isArray(State.DB.lots)&&Array.isArray(State.DB.stageEntries);
  if(!_structOk){console.error('[Firebase] Structure validation failed');setStatus('⚠ Data error — contact admin','var(--re)');return;}
  State.firebaseLoaded=true;window.firebaseLoaded=true;
  setStatus('Firebase ✓','var(--gr)');
  try{localStorage.setItem('tc_db_cache',JSON.stringify(State.DB));}catch(e){console.warn('[cache] tc_db_cache save failed:',e.message,'— this is likely why some records keep re-appearing as missing on every reload, since the fresh, correct data never actually gets saved locally');}
  if(_pendingSave){_pendingSave=false;save();}
  window.DB=State.DB;window.currentUser=State.currentUser;
  if(State.currentUser){clearTimeout(_renderDebounceTimer);_renderDebounceTimer=setTimeout(()=>{window.renderAll();},80);}
  else{showLoginScreenSafe();window.renderLoginDemoCards();}
  // Start Layer 2 after UI renders
  setTimeout(_loadLayer2,500);
  // Attach real-time listeners
  _attachRealtimeListeners();
}

// Load static paths via Worker (Phase 3)
const SUMMARY_PATHS=['lotSummaries','dyeLotSummaries','partySummaries','orderSummaries'];
L1_PATHS.forEach(path=>{
  fetch(WORKER_URL+'/api/data/'+path,{headers:_getHeaders()})
    .then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
    .then(d=>{
      const val=d.data;
      if(path==='masters'){State.DB.masters=val||{};['vendors','mills','grades','machines','workers'].forEach(k=>{if(!State.DB.masters[k])State.DB.masters[k]=[];});}
      else if(path==='parties'){const raw=Array.isArray(val)?val:(val?Object.values(val):[]);State.DB.parties=raw.filter(x=>x&&typeof x==='string');}
      else if(SUMMARY_PATHS.includes(path)){State.DB[path]=val||{};console.log('[L1-Worker] loaded:',path,'→',Object.keys(State.DB[path]).length,'summaries');}
      else{const arr=Array.isArray(val)?val:(val?Object.values(val):[]);State.DB[path]=arr.filter(e=>e!=null&&typeof e==='object');}
      _l1Loaded.add(path);
      console.log('[L1-Worker] loaded:',path);
      _onL1Ready();
    })
    .catch(err=>{
      console.warn('[L1-Worker] static fallback:',path,err.message);
      State.fbDB.ref('/tc/'+path).once('value',snap=>{
        const val=snap.val();
        if(path==='masters'){State.DB.masters=val||{};['vendors','mills','grades','machines','workers'].forEach(k=>{if(!State.DB.masters[k])State.DB.masters[k]=[];});}
        else if(path==='parties'){const raw=Array.isArray(val)?val:(val?Object.values(val):[]);State.DB.parties=raw.filter(x=>x&&typeof x==='string');}
        else if(SUMMARY_PATHS.includes(path)){State.DB[path]=val||{};console.log('[L1] loaded:',path,'→',Object.keys(State.DB[path]).length,'summaries');}
        else{const arr=Array.isArray(val)?val:(val?Object.values(val):[]);State.DB[path]=arr.filter(e=>e!=null&&typeof e==='object');}
        _l1Loaded.add(path);
        console.log('[L1-Fallback] loaded:',path);
        _onL1Ready();
      });
    });
});

// Load only OPEN/RECENT entries for stage paths
// Use date-based queries where possible (Firebase supports single-value orderBy)
const _90daysAgo=new Date();_90daysAgo.setDate(_90daysAgo.getDate()-90);
const _90ISO=_90daysAgo.toISOString();

// Date fields per path
const _dateField={stageEntries:'startTime',dyeLots:'createdAt',windEntries:'startTime',packEntries:'timestamp',dispatches:'timestamp',lots:'date'};
// Jul 29 2026 fix — real, confirmed bug: the incremental-load
// verification step assumed every record's own .id field matched its
// actual Firebase key — true for 5 of the 6 hot tables, but NOT for
// lots, which use a composite key (lotId__grade__vendor, via _lotKey)
// since the same lot number can genuinely belong to different vendors.
// Comparing plain .id against the real, composite Firebase keys meant
// every single lot looked "missing" on every verification, forcing lots
// to fall back to a full fetch every time — the mechanism was safe
// (never showed wrong data), just never actually saved any bandwidth
// for this one table. This gives each record its real, correct key.
// Aug 18 2026 — real, live bug found via a genuine console error on
// staging: "_realKeyFor is not defined" firing for every table inside
// _catchUpAfterReconnect. That function is a real, hoisted `function`
// declaration sitting earlier in this file — but _realKeyFor was a
// `const`, which is NOT hoisted the same way. Converting this to a
// real function declaration too makes it fully hoisted and safely
// callable from anywhere in this module, regardless of exact call
// timing — closing this off at the root, not just this one call site.
function _realKeyFor(path,record){return path==='lots'?_lotKey(record):record.id;}
// Aug 2 2026 — the actual root cause found for the persistent
// "missing/duplicate lot" issue: many places across this file compared
// two lots by id+grade+vendor TEXT, which fails the instant that text
// has drifted even slightly (confirmed real case: a single trailing
// space). A systematic search (prompted directly by Priyam after a real
// bug was found in the live-update listeners) found this exact same
// pattern repeated in 7 more places. One shared, correct helper here
// instead of repeating the same fragile comparison inline everywhere —
// matches by the real, permanent uid when both sides have one, only
// falling back to text for the rare not-yet-migrated case.
// Aug 4 2026 — moved to genuine module-level scope (see near top of
// file) after a real, confirmed bug: this was nested 3 levels deep
// inside initFirebase() → _startDataLoad(), invisible to
// _mergeArchiveIntoDb, _attachRealtimeListeners, _lotsForDropdown, and
// _searchArchive — all defined outside that scope — causing a genuine,
// live "_sameLot is not defined" crash every single time archive data
// merged or a real-time lot update arrived. Every earlier check today
// only confirmed definition-before-use by line order, never actual
// scope visibility — this is exactly the gap that check missed.
// Open statuses per path (client-side filter after download)
const _openStatus={
  stageEntries:['InProgress','Pending'],
  dyeLots:['InProgress','Pending','Approved','Edited-Approved'],
  windEntries:['InProgress','Pending'],
  packEntries:['Pending','InProgress'],
  dispatches:['Pending'],
};

// Load latest N entries per stage — server-side limit, no full download
const _limitPerPath={stageEntries:9999,dyeLots:9999,windEntries:9999,packEntries:9999,dispatches:9999,lots:9999}; // no limits — archive keeps all active paths clean

// Phase 1: stageEntries + dyeLots load via Worker (server-side Firebase read)
// Remaining paths still use Firebase SDK direct (Phase 2 will migrate them)
const _WORKER_PATHS=['stageEntries','dyeLots','windEntries','packEntries','dispatches','lots']; // Phase 2: all open paths via Worker
const _FIREBASE_PATHS=L1_OPEN_PATHS.filter(p=>!_WORKER_PATHS.includes(p));

// Sep 23 2026 — Phase 0 of the bandwidth-architecture plan (design doc reviewed and approved before this was written):
// pure observability, zero change to any existing loading decision. Every counter below is incremented at a point that
// already exists and already runs today — this file adds a tally next to it, nothing more. 'targetedRecovery' is a real,
// reserved slot for a feature that does not exist yet (System A's progressive recovery, a later phase) — it stays at 0
// honestly until that code is actually built, rather than a stub that pretends something happens that doesn't yet.
const _SYNC_STATS_KEY='tc_sync_stats';
let _syncStats=(()=>{try{const r=localStorage.getItem(_SYNC_STATS_KEY);return r?JSON.parse(r):null;}catch(e){return null;}})()||{fullLoads:{},incrementalSuccess:{},verificationMismatch:{},targetedRecovery:{},since:new Date().toISOString()};
function _bumpStat(bucket,path,extra){
  const b=_syncStats[bucket]=_syncStats[bucket]||{};
  const e=b[path]=b[path]||{count:0};
  e.count++;
  if(extra)Object.keys(extra).forEach(k=>{e[k]=(e[k]||0)+extra[k];});
  try{localStorage.setItem(_SYNC_STATS_KEY,JSON.stringify(_syncStats));}catch(err){/* best-effort — never let stats tracking break real loading */}
}
window.getSyncStats=()=>JSON.parse(JSON.stringify(_syncStats));
window.resetSyncStats=()=>{_syncStats={fullLoads:{},incrementalSuccess:{},verificationMismatch:{},targetedRecovery:{},since:new Date().toISOString()};try{localStorage.setItem(_SYNC_STATS_KEY,JSON.stringify(_syncStats));}catch(e){}};

// Worker-served paths
// Sep 24 2026 — Phase 2c: this exact body, byte-for-byte, is now callable on its own so it can serve as both
// today's normal path (toggle off) and the guaranteed rollback path (toggle on, but Smart Loader was abandoned
// for this session) — the SAME code either way, never a second copy that could drift.
// Sep 24 2026 — Phase 2c integration. Session-level state, easy to inspect, matching the design's requirement.
let _loaderSessionState = { loaderPath: 'OLD', fallbackUsed: false, fallbackReason: null };
window.getLoaderSessionState = () => JSON.parse(JSON.stringify(_loaderSessionState));

// The real Worker-then-Firebase-fallback adapter for one table, reusing the exact same mechanisms the old loader
// already uses (WORKER_URL, _getHeaders, State.fbDB, _dateField) — never a second, parallel fetch implementation.
function _buildRealApiFor(path) {
  return {
    fetchFull: async () => {
      try {
        const r = await fetch(WORKER_URL+'/api/data/'+path+'?limit=9999',{headers:_getHeaders()});
        if(!r.ok) throw new Error('HTTP '+r.status);
        const data = await r.json();
        return (data.data||[]).filter(e=>e!=null&&typeof e==='object'&&e.id);
      } catch(err) {
        // Same real fallback the old loader already relies on — direct Firebase, never a silent empty result.
        // Sep 2026 — widened for the 9 newer synchronized tables, which have no entry in _dateField (they were
        // never date-ordered — only the original 6 ever were) and no archive: orderByChild(undefined) would be a
        // genuine error against the real Firebase SDK, so a table with no declared dateField reads the whole
        // node plainly instead, exactly like the Worker-side NEWER_SYNCED_PATHS branch now does.
        return await new Promise((resolve,reject)=>{
          const dateField=_dateField[path];
          const _ref=State.fbDB.ref('/tc/'+path);
          const _onSnap=snap=>{
            const val=snap.val();
            let arr=Array.isArray(val)?val:(val?Object.values(val):[]);
            resolve(arr.filter(e=>e!=null&&typeof e==='object'&&e.id));
          };
          if(dateField) _ref.orderByChild(dateField).limitToLast(9999).once('value',_onSnap,reject);
          else _ref.once('value',_onSnap,reject);
        });
      }
    },
    fetchIncremental: async (since) => {
      const r = await fetch(WORKER_URL+'/api/data/'+path+'?updatedSince='+encodeURIComponent(since),{headers:_getHeaders()});
      if(!r.ok) throw new Error('HTTP '+r.status);
      const data = await r.json();
      return (data.data||[]).filter(e=>e!=null&&typeof e==='object'&&e.id);
    },
    fetchShallowKeys: async () => {
      const r = await fetch(WORKER_URL+'/api/data/'+path+'?shallow=true',{headers:_getHeaders()});
      if(!r.ok) throw new Error('HTTP '+r.status);
      const data = await r.json();
      return data.ids||[];
    },
    fetchByKeys: async (keys) => {
      // Reuses the exact same real, already-proven mechanism the deep diagnostic uses to distinguish "archived"
      // from "genuinely gone" — checks both active and archive together, never active-only.
      // Sep 24 2026 — fix found and confirmed by Gap 4's real adapter test: this used to silently return [] on a
      // failed request, making "checked, found nothing" indistinguishable from "couldn't check at all" — unlike
      // every other method here, which throws. Now it throws too, giving one clean rule: [] means the check
      // genuinely succeeded and found nothing; an error means the check itself didn't happen.
      const r = await fetch(WORKER_URL+'/api/data/'+path+'?limit=9999&includeArchive=true',{headers:_getHeaders()});
      if(!r.ok) throw new Error('HTTP '+r.status);
      const data = await r.json();
      const all = (data&&data.data)||[];
      // TABLE_IDENTITY now covers all 15 tables (see idb-storage.js), so this adapter works unmodified for the
      // 9 newer tables too, not only the original 6.
      const identityFn = TABLE_IDENTITY[path];
      const keySet = new Set(keys);
      return all.filter(r=>{ try { return keySet.has(identityFn(r)); } catch(e) { return false; } });
    },
  };
}

const _SYNC_OUTCOME_IS_FATAL = new Set(['configError','fullLoadFailed','fullLoadIdentityError']);

// Sep 24 2026 — the atomic, all-or-nothing six-table flow. Every table's result is staged (IndexedDB, via
// syncTable) and never touches State.DB individually. Only once all six have genuinely settled — success or
// failure, in any order, none cancelled — is a single decision made for all six together: commit every one of
// them, or abandon Smart Loader entirely for this session and run the existing, unmodified old loader for all six.
// There is no path that leaves State.DB with a mixture of NEW and OLD results.
async function _runPhase2cSmartLoaderFlow() {
  let db;
  try {
    // Sep 25 2026 — per-user isolation (approved design): opens THIS logged-in user's own database, never a
    // shared one. _maybeStartDataLoad() (below) already guarantees State.currentUser is set before this function
    // is ever reached, so this never opens against an unknown/undefined user.
    db = await openTCDatabase(State.currentUser.id);
    State.currentDB = db; // the one central reference logout() closes — see logout() for the other half of this.
  } catch (e) {
    _loaderSessionState = { loaderPath: 'OLD', fallbackUsed: true, fallbackReason: 'IDB_OPEN_FAILED' };
    _WORKER_PATHS.forEach(_runOldLoaderForPath);
    return;
  }

  // Sep 25 2026 — per-user isolation (approved design): the automatic migration that used to run here has been
  // REMOVED, not just left disabled. With per-user databases now in place, blindly migrating the old, unscoped
  // tc_db_cache into whichever user's fresh database happens to open first would silently attribute that cache —
  // which could genuinely belong to a different person who last used this browser — to the wrong account. The
  // explicit, already-approved decision is: every user's new per-user database starts clean and gets its data
  // honestly from Firebase, never from this old, un-attributable shared cache.

  const settled = await Promise.allSettled(_WORKER_PATHS.map(async (path) => {
    const api = _buildRealApiFor(path);
    const result = await syncTable(db, { table: path, api });
    if (_SYNC_OUTCOME_IS_FATAL.has(result.outcome)) throw Object.assign(new Error('syncTable fatal outcome: '+result.outcome), { path, result });
    return { path, result };
  }));

  const failure = settled.find(s => s.status === 'rejected');
  if (failure) {
    const reason = (failure.reason && failure.reason.result && failure.reason.result.outcome === 'fullLoadIdentityError') ? 'IDENTITY_ERROR' : 'SMART_LOADER_ERROR';
    _loaderSessionState = { loaderPath: 'OLD', fallbackUsed: true, fallbackReason: reason };
    // Nothing from the settled Smart Loader results is used — every one of the six, including any that succeeded,
    // is (re)loaded by the existing, unmodified old loader, so the final state is never a mixture of the two.
    _WORKER_PATHS.forEach(_runOldLoaderForPath);
    return;
  }

  // ---- All six genuinely succeeded — commit together, exactly once ----
  _loaderSessionState = { loaderPath: 'NEW', fallbackUsed: false, fallbackReason: null };
  for (const { path, result } of settled.map(s => s.value)) {
    const arr = await getAllRecords(db, path);
    State.DB[path] = arr;
    _l1Loaded.add(path);
    if (result.outcome === 'fullLoad') _bumpStat('fullLoads', path, { ['reason_'+result.reason]: 1 });
    else if (result.outcome === 'incrementalSuccess') _bumpStat('incrementalSuccess', path);
    else if (result.outcome === 'targetedRecoverySuccess') _bumpStat('targetedRecovery', path, { recoveredCount: result.recoveredCount||0 });
    console.log('[L1-SmartLoader] loaded:',path,'→',arr.length,'entries (',result.outcome,')');
  }
  _onL1Ready();
}

function _runOldLoaderForPath(path) {
  // Jul 28 2026 — the actual bandwidth fix. Confirmed design: bandwidth
  // matters, but never at the cost of accuracy — every incremental path
  // below is followed by a real, cheap verification step, and anything
  // that doesn't check out falls straight back to the original, safe
  // full-fetch behavior. Nothing here is a permanent shortcut; it's a
  // shortcut that proves itself correct every single time, or bails out.
  const _cachedArr = Array.isArray(State.DB[path]) ? State.DB[path] : null;
  const _cachedWithStamps = _cachedArr ? _cachedArr.filter(e=>e&&e._updatedAt) : [];
  const _hasValidCache = _cachedArr && _cachedArr.length>0 && _cachedWithStamps.length>0;
  const _maxUpdated = _hasValidCache ? _cachedWithStamps.reduce((mx,e)=>e._updatedAt>mx?e._updatedAt:mx,'') : null;

  const _doFullFetch=(_reason)=>{
  _bumpStat('fullLoads',path,{['reason_'+(_reason||'unknown')]:1});
  fetch(WORKER_URL+'/api/data/'+path+'?limit=9999',{headers:_getHeaders()})
    .then(r=>{
      // Throw on any non-ok status (401, 500 etc) so .catch() handles fallback
      if(!r.ok) throw new Error('HTTP '+r.status);
      return r.json();
    })
    .then(data=>{
      const arr=(data.data||[]).filter(e=>e!=null&&typeof e==='object'&&e.id);
      State.DB[path]=arr;
      _l1Loaded.add(path);
      console.log('[L1-Worker] loaded (full):',path,'→',arr.length,'entries');
      _onL1Ready();
    })
    .catch(err=>{
      console.warn('[L1-Worker] failed ('+err.message+'), falling back to Firebase:',path);
      // Fallback to Firebase direct (handles expired tokens, Worker downtime etc.)
      const dateField=_dateField[path];
      State.fbDB.ref('/tc/'+path).orderByChild(dateField).limitToLast(9999).once('value',snap=>{
        const val=snap.val();
        let arr=Array.isArray(val)?val:(val?Object.values(val):[]);
        arr=arr.filter(e=>e!=null&&typeof e==='object'&&e.id);
        State.DB[path]=arr;
        _l1Loaded.add(path);
        console.log('[L1-Fallback] loaded:',path,'→',arr.length,'entries');
        _onL1Ready();
      });
    });
  };

  if(!_hasValidCache){
    // No usable local cache yet (first-ever load, cleared cache, or an
    // old cache from before this feature existed) — the original, safe
    // full-fetch behavior, completely unchanged.
    _doFullFetch('noCache');
    return;
  }

  // Incremental path — ask only for what's changed since the newest
  // record already in the local cache (using _updatedAt, which is
  // stamped on BOTH creation and every later change — so this correctly
  // catches an old record that was only just approved/edited/voided,
  // not just brand-new ones).
  fetch(WORKER_URL+'/api/data/'+path+'?updatedSince='+encodeURIComponent(_maxUpdated),{headers:_getHeaders()})
    .then(r=>{if(!r.ok) throw new Error('HTTP '+r.status); return r.json();})
    .then(data=>{
      const changed=(data.data||[]).filter(e=>e!=null&&typeof e==='object'&&e.id);
      const merged=[..._cachedArr];
      // Aug 2 2026 fix — real, confirmed bug: this used plain e.id as
      // the merge key for every table, which is correct everywhere
      // EXCEPT "lots", where multiple real, different lots genuinely
      // share the same id (same lot number, different vendor). That
      // collapsed all of them into one shared map slot, so any update
      // to ANY of them silently overwrote whichever one the map
      // happened to be pointing at — exactly how a real lot could
      // vanish and get replaced by a duplicate of an unrelated one.
      // Reuses _realKeyFor, the same real key already proven correct
      // for lots in the verification step below — now used
      // consistently in the merge step too, not just verification.
      const mergedIdx=new Map(merged.map((e,i)=>[_realKeyFor(path,e),i]));
      changed.forEach(e=>{
        const k=_realKeyFor(path,e);
        if(mergedIdx.has(k)) merged[mergedIdx.get(k)]=e;
        else { merged.push(e); mergedIdx.set(k,merged.length-1); }
      });
      // The real safety net: ask for just the current list of IDs (a
      // tiny request) and compare against what's now in memory. Bandwidth
      // is only actually saved once this confirms nothing was missed —
      // any mismatch falls straight back to a full, complete fetch.
      fetch(WORKER_URL+'/api/data/'+path+'?shallow=true',{headers:_getHeaders()})
        .then(r=>{if(!r.ok) throw new Error('HTTP '+r.status); return r.json();})
        .then(shallowData=>{
          const realIds=new Set(shallowData.ids||[]);
          const localIds=new Set(merged.map(e=>_realKeyFor(path,e)));
          const missingIds=[...realIds].filter(id=>!localIds.has(id));
          const staleIds=[...localIds].filter(id=>!realIds.has(id));
          if(missingIds.length>0){
            console.warn('[L1-Incremental] verification found',missingIds.length,'missing record(s) for',path,'— falling back to full fetch to stay accurate');
            console.warn('[L1-Incremental] missing keys (diagnostic):',missingIds);
            // Sep 22 2026 — real, direct extension built via direct discussion with Priyam: this deep diagnostic used
            // to only run for 'lots' (the only table with a composite id__grade__vendor key at the time it was built).
            // Priyam kept seeing this same warning for 'dyeLots' with no obvious recent cause, and pushing back
            // correctly each time a guess was offered instead of proof — so this now runs for EVERY table, generically,
            // using the record's own real key (whatever _realKeyFor actually computes for that path) rather than the
            // lot-specific id__grade__vendor split. Real evidence for every table, not just the one that happened to
            // get instrumented first.
            fetch(WORKER_URL+'/api/data/'+path+'?limit=9999&includeArchive=true',{headers:_getHeaders()})
              .then(r=>r.ok?r.json():null)
              .then(freshData=>{
                const freshRecords=(freshData&&freshData.data)||[];
                missingIds.forEach(missingKey=>{
                  const realMatch=freshRecords.find(r=>_realKeyFor(path,r)===missingKey);
                  const localMatches=path==='lots'?merged.filter(l=>l.id===missingKey.split('__')[0]):merged.filter(l=>l.id===missingKey);
                  console.warn('[L1-Incremental DEEP DIAGNOSTIC] Missing key for',path+':',missingKey);
                  console.warn('  REAL record (fresh from live database, active + archive both checked):',realMatch);
                  console.warn('  LOCAL record(s) sharing the same raw id, any other field:');
                  localMatches.forEach(l=>{
                    const computedKey=_realKeyFor(path,l);
                    console.warn('    id='+JSON.stringify(l.id)+' _updatedAt='+JSON.stringify(l._updatedAt)+' → computed key: '+computedKey+(computedKey===missingKey?' [MATCHES the missing key]':' [does NOT match]'));
                  });
                  if(realMatch){
                    console.warn('  Found it — genuinely exists, status: '+realMatch.status+', table: '+(realMatch._foundIn||'?').toUpperCase()+'.'+(realMatch._foundIn==='active'?' This is STILL ACTIVE — being excluded from the normal load is a real bug worth investigating further, not archival.':' Archived — normal lifecycle, not a bug.'));
                  } else if(localMatches.length===0){
                    console.warn('  Neither a live record with this exact key (checked active AND archive) NOR a local record with this raw id exists — this key was very likely computed from a record that has since been voided or deleted entirely, or from a real-time change happening in this exact instant.');
                  }
                });
              })
              .catch(e=>console.warn('[L1-Incremental DEEP DIAGNOSTIC] Could not complete the deeper check:',e.message));
            _bumpStat('verificationMismatch',path,{missingKeys:missingIds.length});
            _doFullFetch('verificationMismatch');
            return;
          }
          const finalArr=merged.filter(e=>!staleIds.includes(_realKeyFor(path,e)));
          State.DB[path]=finalArr;
          _l1Loaded.add(path);
          console.log('[L1-Incremental] loaded:',path,'→',finalArr.length,'entries (',changed.length,'changed,',staleIds.length,'removed, verified complete)');
          _bumpStat('incrementalSuccess',path);
          _onL1Ready();
        })
        .catch(err=>{
          console.warn('[L1-Incremental] verification failed ('+err.message+') for',path,'— falling back to full fetch to be safe');
          _doFullFetch('verificationError');
        });
    })
    .catch(err=>{
      console.warn('[L1-Incremental] fetch failed ('+err.message+') for',path,'— falling back to full fetch');
      _doFullFetch('incrementalFetchError');
    });
}

if (!SMART_LOADER_ENABLED) {
  _WORKER_PATHS.forEach(_runOldLoaderForPath);
} else {
  _runPhase2cSmartLoaderFlow();
}

// Firebase-direct paths (unchanged — Phase 2 will migrate these)
_FIREBASE_PATHS.forEach(path=>{
  const dateField=_dateField[path];
  const limit=_limitPerPath[path]||200;
  State.fbDB.ref('/tc/'+path).orderByChild(dateField).limitToLast(limit).once('value',snap=>{
    const val=snap.val();
    let arr=Array.isArray(val)?val:(val?Object.values(val):[]);
    arr=arr.filter(e=>e!=null&&e!==undefined&&typeof e==='object'&&e.id);
    State.DB[path]=arr;
    _l1Loaded.add(path);
    console.log('[L1] loaded:',path,'→',arr.length,'entries (latest '+limit+')');
    _onL1Ready();
  });
});

// Sep 2026 — the 9 newer synchronized tables' own atomic settle, mirroring _runPhase2cSmartLoaderFlow's exact
// all-or-nothing shape above for the original 6 (never a mixture of NEW and OLD results for these 9 either), but
// kept as its own separate flow rather than merged into the 6's — they have no archive counterpart and were never
// part of L1_OPEN_PATHS/_WORKER_PATHS's date-ordered, archive-aware old-loader fallback, so folding them into
// that exact same atomic group would require teaching that fallback about tables it was never designed for.
// Same engine (syncTable), same adapter builder (_buildRealApiFor) — a second, independent GROUP through the
// identical architecture, not a different one. Defined HERE, inside _startDataLoad()'s own closure (not at top
// level, where _loadLayer2 lives), because it genuinely needs _buildRealApiFor/_SYNC_OUTCOME_IS_FATAL/_bumpStat,
// all of which are themselves private to this same closure — bridged out to _loadLayer2 the same documented way
// _startDataLoadFn already bridges _startDataLoad() itself out to top-level _maybeStartDataLoad().
async function _runPhase2cSmartLoaderFlowNewer() {
  let db = State.currentDB;
  if (!db) {
    try {
      db = await openTCDatabase(State.currentUser.id);
      State.currentDB = db;
    } catch (e) {
      _loadLayer2OldPaths(_WORKER_PATHS_NEWER);
      return;
    }
  }

  const settled = await Promise.allSettled(_WORKER_PATHS_NEWER.map(async (path) => {
    const api = _buildRealApiFor(path);
    const result = await syncTable(db, { table: path, api });
    if (_SYNC_OUTCOME_IS_FATAL.has(result.outcome)) throw Object.assign(new Error('syncTable fatal outcome: '+result.outcome), { path, result });
    return { path, result };
  }));

  const failure = settled.find(s => s.status === 'rejected');
  if (failure) {
    // Same all-or-nothing guarantee as the 6-table flow: nothing from the settled Smart Loader results (including
    // any table that individually succeeded) is used — every one of the 9 is (re)loaded the old way instead.
    _loadLayer2OldPaths(_WORKER_PATHS_NEWER);
    return;
  }

  for (const { path, result } of settled.map(s => s.value)) {
    const arr = await getAllRecords(db, path);
    State.DB[path] = arr;
    if (result.outcome === 'fullLoad') _bumpStat('fullLoads', path, { ['reason_'+result.reason]: 1 });
    else if (result.outcome === 'incrementalSuccess') _bumpStat('incrementalSuccess', path);
    else if (result.outcome === 'targetedRecoverySuccess') _bumpStat('targetedRecovery', path, { recoveredCount: result.recoveredCount||0 });
    console.log('[L2-SmartLoader] loaded:',path,'→',arr.length,'entries (',result.outcome,')');
  }
  if(State.currentUser){clearTimeout(_renderDebounceTimer);_renderDebounceTimer=setTimeout(()=>{window.renderAll();},300);}
}
_runLayer2SmartLoaderFn = _runPhase2cSmartLoaderFlowNewer; // bridged to top-level _loadLayer2 — see declaration above initFirebase()

} // end _startDataLoad

}catch(e){console.error('[Firebase] Init failed',e);const sk=document.getElementById('sk-storage');if(sk){sk.textContent='⚠ Cannot connect';sk.style.color='var(--re)';}showLoginScreenSafe();}}
function _applyMigrations(){
  let _migV=false;
  (State.DB.stageEntries||[]).forEach(e=>{if(!e.vendor){const _m=State.DB.lots.filter(l=>l.id===e.lotId&&(l.grade===e.grade||!e.grade));if(_m.length===1&&_m[0].vendor){e.vendor=_m[0].vendor;_migV=true;}}});
  (State.DB.dyeBatches||[]).forEach(b=>{(b.sources||[]).forEach(s=>{if(!s.grade||!s.vendor){const _m=State.DB.lots.filter(l=>l.id===s.lotId&&(b.grade?l.grade===b.grade:true));if(_m.length===1){if(!s.grade)s.grade=_m[0].grade||'';if(!s.vendor)s.vendor=_m[0].vendor||'';_migV=true;}}});});
  if(_migV)console.log('[Firebase] Migration applied');
}
let _layer2Loaded=false;
// Sep 2026 — Smart Loader Phase 2c extension to the 9 newer synchronized tables. Pure extraction, zero logic
// change, of the exact per-path fetch body _loadLayer2 always used for every one of its paths — now reusable so
// the genuinely-config L2 paths (deleteRequests/lotFlags/dyeLotFlags/entryFlags/holdOverrides, never in scope for
// Smart Loader — same "config, not an identity-keyed record collection" reasoning idb-storage.js's header already
// applies to masters/parties/summaries) keep loading exactly as before, AND the 9 synced tables can fall back to
// this exact same, already-proven behavior if Smart Loader fails for any of them.
function _loadLayer2OldPaths(paths){
  paths.forEach(path=>{
    fetch(WORKER_URL+'/api/data/'+path,{headers:_getHeaders()})
      .then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
      .then(d=>{
        const val=d.data;
        if(path==='lotFlags'||path==='dyeLotFlags'||path==='entryFlags')State.DB[path]=val||{};
        else{State.DB[path]=Array.isArray(val)?val:(val?Object.values(val):[]);}
        console.log('[L2-Worker] loaded:',path);
        if(State.currentUser){clearTimeout(_renderDebounceTimer);_renderDebounceTimer=setTimeout(()=>{window.renderAll();},300);}
      })
      .catch(err=>{
        console.warn('[L2-Worker] fallback:',path,err.message);
        State.fbDB.ref('/tc/'+path).once('value',snap=>{
          const val=snap.val();
          if(path==='lotFlags'||path==='dyeLotFlags'||path==='entryFlags')State.DB[path]=val||{};
          else{State.DB[path]=Array.isArray(val)?val:(val?Object.values(val):[]);}
          console.log('[L2-Fallback] loaded:',path);
          if(State.currentUser){clearTimeout(_renderDebounceTimer);_renderDebounceTimer=setTimeout(()=>{window.renderAll();},300);}
        });
      });
  });
}

// Sep 2026 — the 9 newer synchronized tables' plain path list. Declared at true top level (unlike the flow
// function that actually runs the sync, which must live inside _startDataLoad()'s closure — see
// _runPhase2cSmartLoaderFlowNewer there, and the _runLayer2SmartLoaderFn bridge above initFirebase()) since it's
// just a plain array with no dependency on anything closure-private, and is also needed here by _loadLayer2's own
// fallback branch.
const _WORKER_PATHS_NEWER=['deadStock','recycleStock','scrapLog','recycleSoft','residualLog','residualStock','rmReturnLog','voidLog','editLog'];

function _loadLayer2(){
  if(_layer2Loaded)return;
  _layer2Loaded=true;
  const cutoff=new Date();cutoff.setDate(cutoff.getDate()-30);
  const cutoffISO=cutoff.toISOString();
  console.log('[L2] Loading background data...');

  // Sep 2026 — kept as the exact original, single list (same 14 paths, same order) rather than rewritten into
  // two separately-declared arrays, so every one of these 14 names is still found together, in this one place —
  // genuinely-config L2 paths (never identity-keyed record collections, so never in Smart Loader scope) are
  // derived from it by excluding the 9 synced ones, rather than retyped as their own separate literal that could
  // quietly drift from this one. _l2ConfigPaths still loads exactly as it always has, via _loadLayer2OldPaths —
  // regardless of the toggle below.
  const _l2AllPaths=['voidLog','editLog','deleteRequests','lotFlags','dyeLotFlags','entryFlags','scrapLog','deadStock','recycleStock','recycleSoft','residualLog','residualStock','rmReturnLog','holdOverrides'];
  const _l2ConfigPaths=_l2AllPaths.filter(p=>!_WORKER_PATHS_NEWER.includes(p));
  _loadLayer2OldPaths(_l2ConfigPaths);

  // Toggle defaults to ON for staging only (same SMART_LOADER_ENABLED flag the 6-table L1 flow already uses) —
  // with it off, the 9 synced tables load exactly as before this phase (old per-path fetch, every time, no
  // local cache), byte-for-byte the same as the original, single _l2AllPaths list used to behave. Calls through
  // the bridge (see _runLayer2SmartLoaderFn's declaration above initFirebase()) since the real flow function is
  // defined inside _startDataLoad()'s own closure, not reachable directly from here; a defensive fallback to the
  // old per-path behavior covers the practically-impossible case where _loadLayer2 somehow runs before
  // _startDataLoad() has set the bridge at all.
  if (SMART_LOADER_ENABLED && _runLayer2SmartLoaderFn) {
    _runLayer2SmartLoaderFn();
  } else {
    _loadLayer2OldPaths(_WORKER_PATHS_NEWER);
  }
}

const _ARCHIVE_PATHS = ['dyeLots','windEntries','packEntries','dispatches','lots','stageEntries'];

// Aug 6 2026 — replaced localStorage archive caching with IndexedDB, the
// real, permanent fix for the quota-exceeded issue (localStorage's hard
// ~5-10MB-per-origin ceiling, small and fixed; IndexedDB's real quota
// scales to hundreds of MB, sometimes GB, and only grows more necessary
// as the archive itself keeps growing over the factory's real lifetime).
// IndexedDB stores real JS objects/arrays directly via structured clone —
// no more JSON.stringify/parse overhead either. Genuinely async (unlike
// localStorage's synchronous get/set), but _loadArchiveWithCache already
// used a callback-based interface, not a return value, so this change
// stays entirely internal — its own external signature, and both of its
// 2 real external callers (core.js's own Reports L3 loader, pages.js's
// Excel export), are completely unchanged.
//
// IMPORTANT — genuinely could not be tested live in this environment:
// IndexedDB does not exist in Node.js, so unlike every other fix built
// this session, this one could only be verified for syntax and logical
// correctness by reading it carefully, not by actually running it. Needs
// real browser testing on staging before being trusted in production —
// more so than anything else fixed today.
const _IDB_NAME = 'tc_archive_db';
const _IDB_VERSION = 1;
const _IDB_STORE = 'archive_cache';

function _openArchiveDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error('IndexedDB not available')); return; }
    const req = indexedDB.open(_IDB_NAME, _IDB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(_IDB_STORE)) db.createObjectStore(_IDB_STORE);
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function _getArchiveCache() {
  try {
    const db = await _openArchiveDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(_IDB_STORE, 'readonly');
      const store = tx.objectStore(_IDB_STORE);
      const tsReq = store.get('ts');
      const dataReq = store.get('data');
      let ts, data, count = 0;
      const checkDone = () => { count++; if (count === 2) resolve((!ts || !data) ? null : { ts, data }); };
      tsReq.onsuccess = () => { ts = tsReq.result; checkDone(); };
      dataReq.onsuccess = () => { data = dataReq.result; checkDone(); };
      tx.onerror = () => resolve(null);
    });
  } catch (e) { return null; }
}

async function _setArchiveCache(data, ts) {
  try {
    const db = await _openArchiveDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(_IDB_STORE, 'readwrite');
      tx.objectStore(_IDB_STORE).put(data, 'data');
      tx.objectStore(_IDB_STORE).put(ts, 'ts');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    console.log('[cache] Archive saved to IndexedDB, ts:', ts);
  } catch (e) {
    // IndexedDB can still genuinely fail in rare cases (private/incognito
    // mode in some browsers, disk truly full) — same safe, non-crashing
    // fallback as before, now with real IndexedDB-specific context in the
    // warning rather than a stale localStorage-specific message.
    let approxSizeMB = '?';
    try { approxSizeMB = (JSON.stringify(data).length / (1024*1024)).toFixed(1); } catch(e2) {}
    console.warn(`[cache] IndexedDB save failed (attempted ~${approxSizeMB}MB): ${e.message}`);
  }
}
function _mergeArchiveIntoDb(cachedData) {
  _ARCHIVE_PATHS.forEach(path => {
    const arr = (cachedData[path] || []).filter(x => x && x.id);
    arr.forEach(x => {
      if (path === 'lots') {
        const existing = (State.DB[path]||[]).find(l => _sameLot(l, x));
        if (existing) {
          const newD = (x.deliveries||[]).filter(d => !(existing.deliveries||[]).some(e => e.addedAt===d.addedAt));
          if (newD.length) { existing.deliveries=[...(existing.deliveries||[]),...newD]; existing.units+=x.units||0; existing.weight+=x.weight||0; }
        } else State.DB[path] = [...(State.DB[path]||[]), x];
      } else {
        // Sep 10 2026 — real, root-cause fix built via direct
        // discussion with Priyam, tracing a genuine dye lot ID
        // collision in his real production data all the way back to
        // here: an external Firebase import can reset the ID counter
        // (fixed separately so it self-corrects going forward), but
        // when two genuinely different real dye lots ended up sharing
        // one id, this exact "already have an id match, skip it"
        // merge check meant the archived one could never even reach
        // the browser at all — not just missing from exports, but
        // completely invisible everywhere in the app (Search, Vendor
        // Tracker, Reports). dyeLotNo is the one field guaranteed
        // genuinely unique even when id collides, so it's checked
        // too here specifically — a same-id match only counts as
        // "already have it" when the dye lot number also matches.
        const isDup = path === 'dyeLots'
          ? (State.DB[path]||[]).find(e => e.id===x.id && e.dyeLotNo===x.dyeLotNo)
          : (State.DB[path]||[]).find(e => e.id===x.id);
        if (!isDup) State.DB[path] = [...(State.DB[path]||[]), x];
      }
    });
  });
  console.log('[cache] Archive data merged into State.DB');
}
async function _fetchAndCacheArchive(serverTs, cb) {
  const totalPaths = _ARCHIVE_PATHS.length;
  let done = 0;
  const freshData = {};
  // Aug 6 2026 — real, confirmed issue found via live console testing:
  // if serverTs comes in blank (meaning /tc/archiveLastUpdated was never
  // actually written in Firebase), the cache could never validate on any
  // FUTURE load either — _loadArchiveWithCache's own deliberate
  // `serverTs !== ''` safety check blocks trusting the cache permanently,
  // not just this once.
  //
  // Aug 6 2026 (later) — real, live testing on staging found a direct
  // client write to this path genuinely blocked: PERMISSION_DENIED,
  // confirmed against the real, deployed Firebase rules (archiveLastUpdated
  // isn't an individually named path, falls under the $other catch-all
  // which explicitly denies everything). Routed through the server
  // instead — POST /api/archive/heal-timestamp — using the same
  // admin-level Firebase access every other genuinely important write
  // already relies on.
  //
  // Aug 6 2026 (later still) — real bug caught before shipping: the
  // server generates its OWN fresh timestamp when healing, genuinely
  // different (different exact millisecond) from whatever the client
  // would generate independently. If the client used its own separately-
  // generated timestamp for this cache save while the server saved a
  // DIFFERENT one to Firebase, the very next reload would compare the
  // server's real value against this reload's mismatched local cache
  // value — missing again, even though the heal genuinely succeeded.
  // Fixed by genuinely awaiting the heal call and using the exact
  // timestamp the server actually confirmed, not a separately-guessed one.
  //
  // Aug 6 2026 (yet later) — real bug found after 3 consecutive real
  // staging tests kept showing a miss with zero visible error: this never
  // actually checked whether the heal request succeeded — only whether
  // the fetch() call itself threw. A real server-side failure (wrong
  // auth, fbSet itself failing) returns a normal, valid JSON error body
  // ({error: message}, non-200 status) — no exception, so the try/catch
  // never fired, and healData.ts was silently undefined, silently falling
  // through to a locally-made timestamp that never actually reached
  // Firebase. This exactly explains the symptom: consistently "miss",
  // never a visible warning. Now explicitly checks healRes.ok and
  // healData.success, logs a clear, specific failure reason either way,
  // and — critically — logs a clear SUCCESS message too, so the very
  // next real test gives an unambiguous answer instead of more guessing.
  let effectiveTs = serverTs;
  if (!serverTs) {
    try {
      const healRes = await fetch(WORKER_URL + '/api/archive/heal-timestamp', { method: 'POST', headers: _postHeaders() });
      const healData = await healRes.json();
      if (healRes.ok && healData.success && healData.ts) {
        effectiveTs = healData.ts;
        console.log('[cache] Self-heal succeeded — archiveLastUpdated set to:', effectiveTs, '— server wrote to Firebase host:', healData._diagnosticFirebaseHost);
      } else {
        console.warn('[cache] Self-heal request completed but did not succeed — status:', healRes.status, 'body:', JSON.stringify(healData));
        effectiveTs = new Date().toISOString();
      }
    } catch (e) {
      console.warn('[cache] Could not self-heal blank archiveLastUpdated (request itself failed):', e.message);
      effectiveTs = new Date().toISOString();
    }
  }
  _ARCHIVE_PATHS.forEach(path => {
    State.fbDB.ref('/tc/archive/'+path).once('value', snap => {
      const val = snap.val();
      freshData[path] = (Array.isArray(val) ? val : Object.values(val||{})).filter(x => x && x.id);
      if (++done === totalPaths) {
        _setArchiveCache(freshData, effectiveTs);
        try { _mergeArchiveIntoDb(freshData); } catch (e) { console.error('[cache] Archive merge failed, continuing with what is available:', e); }
        cb && cb();
      }
    }).catch(() => { if (++done === totalPaths) { cb && cb(); } });
  });
}
export async function _loadArchiveWithCache(cb) {
  // Get server timestamp
  State.fbDB.ref('/tc/archiveLastUpdated').once('value', async snap => {
    const serverTs = snap.val() || '';
    const cached = await _getArchiveCache();
    if (cached && cached.ts === serverTs && serverTs !== '') {
      // Cache is valid — use it
      console.log('[cache] Archive cache hit — loading from IndexedDB');
      // Aug 4 2026 — real, confirmed issue: an uncaught error inside
      // the merge (e.g. a stale-cached JS bundle missing a helper)
      // silently stopped this whole function before cb() ever ran —
      // meaning export, and anything else waiting on archive data,
      // would just hang forever with no visible error to the user.
      // Wrapped so the callback always fires, degrading to
      // active-data-only rather than failing completely silently.
      try { _mergeArchiveIntoDb(cached.data); } catch (e) { console.error('[cache] Archive merge failed, continuing with what is available:', e); }
      cb && cb();
    } else {
      // Cache miss or stale — fetch from Firebase and reset layer3 flags
      console.log('[cache] Archive cache miss — fetching from Firebase');
      // Reset layer3 flags so pages re-fetch with fresh archive data
      if (cached && cached.ts !== serverTs) {
        State._layer3Loaded = {};
        console.log('[cache] Archive updated — reset layer3 flags');
      }
      _fetchAndCacheArchive(serverTs, cb);
    }
  }).catch(() => {
    _fetchAndCacheArchive('', cb);
  });
}
// Targeted archive search — asks the worker for just the rows matching the typed
// query (active data is NOT re-searched here, caller already has that). Only the
// matches are merged into State.DB, not the full archive tables (Jul 12 2026,
// replaces _loadArchiveWithCache for the "Search in History" button specifically —
// that function still exists as-is for Reports, which genuinely needs full archive).
export async function _searchArchive(q, cb) {
  try {
    const res = await fetch(WORKER_URL+'/api/search-archive?q='+encodeURIComponent(q), {headers:_getHeaders()});
    const data = await res.json();
    const r = data.results || {};
    const mergeById = (path, arr) => {
      // Sep 10 2026 — same real, root-cause fix as _mergeArchiveIntoDb
      // above: an id match alone isn't enough proof of "already have
      // it" for dyeLots specifically, since a real, confirmed
      // collision means two genuinely different dye lots can share
      // one id — dyeLotNo is the field guaranteed unique even then.
      (arr||[]).forEach(x => {
        const isDup = path === 'dyeLots'
          ? (State.DB[path]||[]).some(e=>e.id===x.id && e.dyeLotNo===x.dyeLotNo)
          : (State.DB[path]||[]).some(e=>e.id===x.id);
        if(!isDup) State.DB[path]=[...(State.DB[path]||[]),x];
      });
    };
    mergeById('dyeLots', r.dyeLots);
    mergeById('stageEntries', r.stageEntries);
    mergeById('windEntries', r.windEntries);
    mergeById('packEntries', r.packEntries);
    mergeById('dispatches', r.dispatches);
    (r.lots||[]).forEach(x => {
      if(!(State.DB.lots||[]).some(l=>_sameLot(l,x))) State.DB.lots=[...(State.DB.lots||[]),x];
    });
    State._archiveSearchedFor = State._archiveSearchedFor || {};
    State._archiveSearchedFor[q] = true;
  } catch(e) { console.warn('[searchArchive] failed', e); }
  cb && cb();
}
// Lightweight catalog loader — fetches names/IDs only (not full records) so discovery
// dropdowns (Vendor Tracker, Lot Lifecycle, Dye Lifecycle) can show every vendor/lot/dye-lot
// that exists, including fully-archived ones, WITHOUT downloading the full archive.
// Results go into a separate holding array (DB._lotsCatalog / DB._dyeLotsCatalog) —
// never merged into DB.lots/DB.dyeLots directly, since stub records only have 2-3 fields
// and would show as blank/NaN anywhere else that expects a full record (dashboard, reports, etc).
export async function _loadCatalog(path,cb){
  const catalogKey='_'+path+'Catalog';
  if(State._layer3Loaded[catalogKey]){cb&&cb();return;}
  try{
    const res=await fetch(WORKER_URL+'/api/catalog?path='+path,{headers:_getHeaders()});
    const data=await res.json();
    State.DB[catalogKey]=data.results||[];
    State._layer3Loaded[catalogKey]=true;
  }catch(e){console.warn('[Catalog] Failed to load catalog for',path,e);}
  cb&&cb();
}

// Combines the real (full) records with catalog stubs for dropdown display, deduped —
// real records win if a lot/dye-lot exists in both (already hydrated).
export function _lotsForDropdown(){
  const real=State.DB.lots||[];
  const stubs=(State.DB._lotsCatalog||[]).filter(c=>!real.some(l=>_sameLot(l,c)));
  return[...real,...stubs];
}
export function _dyeLotsForDropdown(){
  const real=State.DB.dyeLots||[];
  const stubs=(State.DB._dyeLotsCatalog||[]).filter(c=>!real.some(d=>d.id===c.id));
  return[...real,...stubs];
}

// Sep 8 2026 — real, direct fix built via direct discussion with
// Priyam: the Dye Lifecycle dropdown used to be built by 3 separate,
// independently-written pieces of code (page-arrival, shade-filter-
// change, jump-to-a-specific-lot) — two of them agreed, one didn't
// (excluded InProgress lots and sorted differently). Same underlying
// problem as the machine-list and eligibility-list drift found
// earlier this session: every real consumer now calls this one
// function instead of writing its own version of the same filter.
// InProgress lots are excluded — a lot still running doesn't have a
// finished lifecycle to review yet.
// Sep 8 2026 — real, direct fix built via direct discussion with
// Priyam: the flag feature genuinely never worked once saved. The
// server (handleLotFlag/handleDyeLotFlag/handleEntryFlag, worker.js)
// sanitizes every real ID before writing — replacing hyphens, spaces,
// slashes (all common in real IDs like "SE-0001" or a grade like
// "2/30 RC", which contains an illegal-for-Firebase-keys '/') with
// underscores. Necessary on the write side. But every read side
// (flagPill/dyeFlagPill/entryFlagPill) looked the flag up using the
// raw, unsanitized ID instead — so the two keys almost never matched.
// The save always succeeded, silently, and the flag then vanished
// from view — looked completely broken, because it functionally was.
// These two match the server's own sanitization exactly, so the
// client looks up the same key it was actually written to.
export function _flagKeyRM(lotId,grade,vendor){return `${(lotId||'').replace(/[^a-zA-Z0-9]/g,'_')}__${(grade||'').replace(/[^a-zA-Z0-9]/g,'_')}__${(vendor||'').replace(/[^a-zA-Z0-9]/g,'_')}`;}
export function _flagKeySafe(id){return String(id||'').replace(/[^a-zA-Z0-9]/g,'_');}
// Sep 8 2026 — real, direct feature built via direct discussion with
// Priyam: a "Hold"-flagged lot/dye lot now genuinely excludes itself
// from every real picker dropdown, matching the same exclusion
// pattern already used for Voided/Merged. The actual enforcement is
// server-side (handleStageStart/handleDyeStart/handleWindStart/
// handlePackSubmit/handleDispatchSubmit, worker.js) — this is the
// client-side convenience that keeps someone from picking it in the
// first place, not a replacement for the real gate.
export function _isLotOnHold(lotId,grade,vendor){const f=(State.DB.lotFlags||{})[_flagKeyRM(lotId,grade,vendor)];return f&&f.type==='hold';}
export function _isDyeLotOnHold(dyeLotId){const f=(State.DB.dyeLotFlags||{})[_flagKeySafe(dyeLotId)];return f&&f.type==='hold';}
export function eligibleDyeLifecycleLots(shade){
  return _dyeLotsForDropdown()
    .filter(d=>d.status!=='InProgress')
    .filter(d=>!shade||(d.shade||'').toLowerCase()===shade.toLowerCase())
    .sort(sortDyeLotNo);
}

// Fetches Wind/Pack/Dispatch for one dye lot via the targeted search API and merges
// into the real collections. Used by both lot-hydration and dye-lot-hydration below.
async function _fetchDyeLotChain(dyeLotId){
  try{
    const[wRes,pRes,dRes]=await Promise.all([
      fetch(WORKER_URL+'/api/search?path=windEntries&dyeLotId='+encodeURIComponent(dyeLotId)+'&limit=200',{headers:_getHeaders()}),
      fetch(WORKER_URL+'/api/search?path=packEntries&dyeLotId='+encodeURIComponent(dyeLotId)+'&limit=200',{headers:_getHeaders()}),
      fetch(WORKER_URL+'/api/search?path=dispatches&dyeLotId='+encodeURIComponent(dyeLotId)+'&limit=200',{headers:_getHeaders()}),
    ]);
    const[wData,pData,dData]=await Promise.all([wRes.json(),pRes.json(),dRes.json()]);
    (wData.results||[]).forEach(w=>{if(!(State.DB.windEntries||[]).some(e=>e.id===w.id))State.DB.windEntries=[...(State.DB.windEntries||[]),w];});
    (pData.results||[]).forEach(p=>{if(!(State.DB.packEntries||[]).some(e=>e.id===p.id))State.DB.packEntries=[...(State.DB.packEntries||[]),p];});
    (dData.results||[]).forEach(d=>{if(!(State.DB.dispatches||[]).some(e=>e.id===d.id))State.DB.dispatches=[...(State.DB.dispatches||[]),d];});
  }catch(e){console.warn('[Hydrate] Failed to fetch chain for dyeLot',dyeLotId,e);}
}

// Fetches the FULL record for one RM lot (if only a catalog stub is present), then walks
// the chain: this lot's dye lots, then each dye lot's Wind/Pack/Dispatch. Calls cb when
// everything needed to render this one lot's full journey is in DB.
export async function _hydrateLot(lotId,grade,vendor,cb){
  try{
    const existing=(State.DB.lots||[]).find(l=>l.id===lotId&&l.grade===grade&&l.vendor===vendor);
    if(!existing){
      const res=await fetch(WORKER_URL+'/api/search?path=lots&lotId='+encodeURIComponent(lotId)+'&grade='+encodeURIComponent(grade)+'&vendor='+encodeURIComponent(vendor),{headers:_getHeaders()});
      const data=await res.json();
      const full=(data.results||[])[0];
      if(full)State.DB.lots=[...(State.DB.lots||[]),full];
    }
    const res2=await fetch(WORKER_URL+'/api/search?path=dyeLots&lotId='+encodeURIComponent(lotId)+'&grade='+encodeURIComponent(grade)+'&vendor='+encodeURIComponent(vendor)+'&limit=200',{headers:_getHeaders()});
    const data2=await res2.json();
    const linkedDyeLots=data2.results||[];
    linkedDyeLots.forEach(dl=>{if(!(State.DB.dyeLots||[]).some(d=>d.id===dl.id))State.DB.dyeLots=[...(State.DB.dyeLots||[]),dl];});
    await Promise.all(linkedDyeLots.map(dl=>_fetchDyeLotChain(dl.id)));
  }catch(e){console.warn('[Hydrate] Failed to hydrate lot',lotId,e);}
  cb&&cb();
}

// Fetches the FULL record for one dye lot (if only a catalog stub is present), then its
// Wind/Pack/Dispatch chain. Used by Dye Lifecycle's direct-by-dyeLot lookup.
export async function _hydrateDyeLot(dyeLotId,cb){
  try{
    const existing=(State.DB.dyeLots||[]).find(d=>d.id===dyeLotId);
    if(!existing||!existing.sources){
      const res=await fetch(WORKER_URL+'/api/search?path=dyeLots&dyeLotId='+encodeURIComponent(dyeLotId),{headers:_getHeaders()});
      const data=await res.json();
      const full=(data.results||[])[0];
      if(full){State.DB.dyeLots=(State.DB.dyeLots||[]).filter(d=>d.id!==dyeLotId);State.DB.dyeLots.push(full);}
    }
    await _fetchDyeLotChain(dyeLotId);
  }catch(e){console.warn('[Hydrate] Failed to hydrate dyeLot',dyeLotId,e);}
  cb&&cb();
}

export function _dispatchesForDropdown(){
  const real=State.DB.dispatches||[];
  const stubs=(State.DB._dispatchesCatalog||[]).filter(c=>!real.some(d=>d.id===c.id));
  return[...real,...stubs];
}

// Fetches full dispatch records matching whichever Challan filters are active (date/party/challanId,
// any combination) and merges into DB.dispatches. Used by Challan now that it only shows results
// once at least one filter is set — no longer needs the full archive download.
export async function _hydrateChallanFilter(selDate,selParty,selChallan,cb){
  try{
    let url=WORKER_URL+'/api/search?path=dispatches&limit=500';
    if(selDate)url+='&date='+encodeURIComponent(selDate);
    if(selParty)url+='&party='+encodeURIComponent(selParty);
    if(selChallan)url+='&challanId='+encodeURIComponent(selChallan);
    const res=await fetch(url,{headers:_getHeaders()});
    const data=await res.json();
    (data.results||[]).forEach(d=>{if(!(State.DB.dispatches||[]).some(e=>e.id===d.id))State.DB.dispatches=[...(State.DB.dispatches||[]),d];});
  }catch(e){console.warn('[Hydrate] Failed to hydrate challan filter',e);}
  cb&&cb();
}

function loadVendorTrackerData(cb){
  if(State._layer3Loaded.vendor)return cb&&cb();
  console.log('[L3] Loading vendor tracker data...');
  // lots/stageEntries/dyeLots/windEntries/packEntries/dispatches already loaded at L1 + kept live via realtime listeners — no need to refetch
  // Discovery dropdown only needs lightweight catalog now — full per-lot data is hydrated on selection via _hydrateLot
  _loadCatalog('lots',()=>{State._layer3Loaded.vendor=true;console.log('[L3] Vendor data ready');cb&&cb();});
}
function loadPartyTrackerData(cb){
  if(State._layer3Loaded.party)return cb&&cb();
  console.log('[L3] Loading party tracker data...');
  // dispatches/dyeLots already loaded at L1 — only parties/partyOrders are genuinely new here
  // Archive no longer auto-loaded — dye lot dropdown uses catalog, specific dye lot hydrated on selection
  const paths=['parties','partyOrders'];
  let done=0;
  paths.forEach(path=>State.fbDB.ref('/tc/'+path).once('value',snap=>{
    const raw=Array.isArray(snap.val())?snap.val():(snap.val()?Object.values(snap.val()):[]);
    if(raw.length&&typeof raw[0]==='string'){State.DB[path]=raw.filter(Boolean);}
    else{const arr=raw.filter(x=>x&&x.id);arr.forEach(x=>{if(!(State.DB[path]||[]).find(e=>e.id===x.id))State.DB[path]=[...(State.DB[path]||[]),x];});}
    if(++done===paths.length){
      _loadCatalog('dyeLots',()=>{State._layer3Loaded.party=true;console.log('[L3] Party data ready');cb&&cb();});
    }
  }));
}
function loadReportsData(cb){
  if(State._layer3Loaded.reports)return cb&&cb();
  console.log('[L3] Loading reports data...');
  // lots/stageEntries/dyeLots/windEntries/packEntries/dispatches already loaded at L1 + kept live via realtime listeners — only partyOrders is genuinely new here
  const paths=['partyOrders'];
  let done=0;
  paths.forEach(path=>State.fbDB.ref('/tc/'+path).once('value',snap=>{
    const arr=(Array.isArray(snap.val())?snap.val():(snap.val()?Object.values(snap.val()):[])).filter(x=>x&&x.id);
    arr.forEach(x=>{if(!(State.DB[path]||[]).find(e=>e.id===x.id))State.DB[path]=[...(State.DB[path]||[]),x];});
    if(++done===paths.length){
      _loadArchiveWithCache(()=>{State._layer3Loaded.reports=true;console.log('[L3] Reports data ready');cb&&cb();});
    }
  }));
}

function refreshOpenModalAvailability(){
  // Wind Start modal — refresh dye lot dropdown + re-check selected value
  const windOverlay=document.getElementById('wind-modal-overlay');
  if(windOverlay&&!windOverlay.classList.contains('hidden')&&typeof State._windMode!=='undefined'&&State._windMode==='Start'){
    const sel=document.getElementById('wind-dye-lot-select');
    if(sel){
      const prevVal=sel.value;
      const availLots=(State.DB.dyeLots||[]).filter(d=>(d.status==='Approved'||d.status==='Edited-Approved')&&getDyeBalAvailable(d.id).weight>0);
      const stillEligible=availLots.some(d=>d.id===prevVal);
      sel.innerHTML='<option value="">Select Dye Lot...</option>'+availLots.map(d=>{const b=getDyeBalAvailable(d.id);return `<option value="${d.id}">${d.dyeLotNo} — ${d.shade} (${b.units||0}c / ${fmt(b.weight)}kg avail)</option>`;}).join('');
      if(stillEligible){sel.value=prevVal;}
      if(typeof window.onWindDyeLotSelect==='function')window.onWindDyeLotSelect();
      if(!stillEligible&&prevVal){const alertEl=document.getElementById('wind-alert');if(alertEl)alertEl.innerHTML='<div class="alert-err" style="margin-bottom:8px">⚠ Selected dye lot balance changed — please re-select</div>';}
    }
  }
  // Pack modal — same pattern
  const packOverlay=document.getElementById('pack-modal-overlay');
  if(packOverlay&&!packOverlay.classList.contains('hidden')){
    const sel=document.getElementById('pack-dye-lot-select');
    if(sel){
      const prevVal=sel.value;
      const availLots=(State.DB.dyeLots||[]).filter(d=>(d.status==='Approved'||d.status==='Edited-Approved')&&getWindBalAvailable(d.id).weight>0);
      const stillEligible=availLots.some(d=>d.id===prevVal);
      sel.innerHTML='<option value="">Select Dye Lot...</option>'+availLots.map(d=>{const b=getWindBalAvailable(d.id);return `<option value="${d.id}">${d.dyeLotNo} — ${d.shade} (${b.units||0}c / ${fmt(b.weight)}kg avail)</option>`;}).join('');
      if(stillEligible){sel.value=prevVal;}
      if(!stillEligible&&prevVal){const alertEl=document.getElementById('pack-alert');if(alertEl)alertEl.innerHTML='<div class="alert-err" style="margin-bottom:8px">⚠ Selected dye lot balance changed — please re-select</div>';}
    }
  }
  // Soft/Stage modal — refresh lot dropdown
  const stageOverlay=document.getElementById('stage-modal');
  if(stageOverlay&&!stageOverlay.classList.contains('hidden')&&typeof State.stageAction!=='undefined'&&State.stageAction==='Start'){
    const lotSel=document.getElementById('sf-lot-stage');
    if(lotSel){
      const prevVal=lotSel.value;
      if(prevVal){
        const parts=prevVal.split('||');const _checkLotId=parts[0],_checkStage=parts[1],_checkGrade=parts[2]||'',_checkVendor=parts[3]||'';
        const bal=stageBalance(_checkLotId,_checkStage,_checkGrade,_checkVendor);
        if(bal.units<=0&&bal.weight<=0){const alertEl=document.getElementById('stage-alert');if(alertEl)alertEl.innerHTML='<div class="alert-err" style="margin-bottom:8px">⚠ Selected lot balance changed — please re-select</div>';}
      }
    }
  }
}


export function getDyeBalAvailable(dyeLotId){return calcDyeBalAvailable(State.DB.dyeLots,State.DB.windEntries,dyeLotId);}
export function getWindBalAvailable(dyeLotId){return calcWindBalAvailable(State.DB.windEntries,State.DB.packEntries,dyeLotId);}
export function getPackBalAvailable(dyeLotId){return calcPackBalAvailable(State.DB.packEntries,State.DB.dispatches,dyeLotId);}
export function getStageBalanceAvailable(lotId,stage,grade,vendor){if(stage!=='Soft')return stageBalance(lotId,stage,grade,vendor);return calcStageBalanceAvailable(State.DB.lots,State.DB.stageEntries,State.DB.rmReturnLog,lotId,grade,vendor);}



export function getSoftBalanceWeightAvailable(lotId,grade,vendor){return calcSoftBalanceWeightAvailable(State.DB.stageEntries,State.DB.lots,State.DB.scrapLog,State.DB.dyeLots,State.DB.residualLog,lotId,grade,vendor);}

export function getSoftBalanceAvailable(lotId,grade,vendor){
  const bal=getSoftBalance(lotId,grade,vendor);
  return calcSoftBalanceAvailable(State.DB.stageEntries,State.DB.lots,State.DB.scrapLog,State.DB.dyeLots,State.DB.residualLog,bal,lotId,grade,vendor);
}

function _attachRealtimeListeners(){
  if(_dbListenerAttached)return;
  _dbListenerAttached=true;
  const _onListenerError=(path,evt)=>err=>{console.error(`[Firebase] Listener error on /tc/${path} (${evt}):`,err.message||err);setStatus('⚠ Sync error — refresh page','var(--re)');};
  const realtimePaths=['stageEntries','dyeLots','windEntries','packEntries','dispatches'];
  // Date field per path — used to filter child_added to only NEW entries (not historical replay)
  const _rtDateField={stageEntries:'startTime',dyeLots:'createdAt',windEntries:'startTime',packEntries:'timestamp',dispatches:'timestamp'};
  const _rtNow=new Date().toISOString(); // snapshot at listener attach time
  realtimePaths.forEach(path=>{
    const _rtDf=_rtDateField[path]||'timestamp';
    // New entry added by someone else — startAt(_rtNow) skips replaying existing entries
    // Firebase child_added normally fires for ALL existing children first — this prevents that
    State.fbDB.ref('/tc/'+path).orderByChild(_rtDf).startAt(_rtNow).on('child_added',snap=>{
      const item=snap.val();if(!item||typeof item!=='object'||!item.id)return;
      State.DB[path]=State.DB[path]||[];
      const existingIdx=State.DB[path].findIndex(x=>x.id===item.id);
      if(existingIdx===-1){
        State.DB[path].push(item);
        clearTimeout(_renderDebounceTimer);_renderDebounceTimer=setTimeout(()=>{if(State.currentUser){if(State.currentUser.role==='worker'&&typeof window.renderWorkerView==='function')window.renderWorkerView();else window.renderAll();refreshOpenModalAvailability();}},80);
      }
    },_onListenerError(path,'child_added'));
    // Entry changed (approved, rejected, voided, edited)
    State.fbDB.ref('/tc/'+path).on('child_changed',snap=>{
      const item=snap.val();if(!item||!item.id)return;
      State.DB[path]=State.DB[path]||[];
      State.DB[path]=State.DB[path].filter(x=>x.id!==item.id);
      State.DB[path].push(item);
      clearTimeout(_renderDebounceTimer);_renderDebounceTimer=setTimeout(()=>{if(State.currentUser){if(State.currentUser.role==='worker'&&typeof window.renderWorkerView==='function')window.renderWorkerView();else window.renderAll();refreshOpenModalAvailability();}},80);
    },_onListenerError(path,'child_changed'));
    // Also listen to lots for RM changes
  });
  // RM lots real-time (new lot added) — startAt today to skip historical replay
  const _rtLotNow=new Date().toISOString().split('T')[0];
  State.fbDB.ref('/tc/lots').orderByChild('date').startAt(_rtLotNow).on('child_added',snap=>{
    const item=snap.val();if(!item||!item.id)return;
    // Aug 2 2026 fix — real, confirmed bug: matching by id+grade+vendor
    // TEXT instead of a stable identity meant a lot whose text had ever
    // drifted even slightly (the same class of issue the whole
    // permanent-ID plan exists to fix) could get silently duplicated
    // here — this listener fires for EVERY lot on any bulk update
    // (confirmed directly: the backfill touching all 362 lots
    // reproduced this exactly, every single time). Match by the real,
    // permanent uid when both sides have one — falls back to the old
    // text match only for the rare not-yet-migrated case.
    const exists=(State.DB.lots||[]).find(x=>_sameLot(x,item));
    if(!exists){State.DB.lots=State.DB.lots||[];State.DB.lots.push(item);clearTimeout(_renderDebounceTimer);_renderDebounceTimer=setTimeout(()=>{if(State.currentUser){if(State.currentUser.role==='worker'&&typeof window.renderWorkerView==='function')window.renderWorkerView();else window.renderAll();refreshOpenModalAvailability();}},80);}
  },_onListenerError('lots','child_added'));
  State.fbDB.ref('/tc/lots').on('child_changed',snap=>{
    const item=snap.val();if(!item||!item.id)return;
    const idx=(State.DB.lots||[]).findIndex(x=>_sameLot(x,item));
    if(idx!==-1)State.DB.lots[idx]=item;else State.DB.lots.push(item);
    clearTimeout(_renderDebounceTimer);_renderDebounceTimer=setTimeout(()=>{if(State.currentUser){if(State.currentUser.role==='worker'&&typeof window.renderWorkerView==='function')window.renderWorkerView();else window.renderAll();refreshOpenModalAvailability();}},80);
  },_onListenerError('lots','child_changed'));

  // Aug 26 2026 — real, root-cause fix built via direct discussion with
  // Priyam: getRMBalance, getSoftBalance, getDyeBal, and 7 other real
  // balance functions all check this cached summary FIRST, before ever
  // falling back to a live calculation — but nothing anywhere in the
  // app ever told the browser to fetch a fresh copy of this cache after
  // an edit. The underlying transaction data (stageEntries, dyeLots,
  // etc.) was always correctly kept live via the listeners above — the
  // cache itself, sitting one step downstream of all of them, never
  // was. Same real, proven pattern as those listeners, adapted for the
  // fact that this table is a plain object keyed by summary key, not
  // an array of records with their own .id — so no searching or
  // matching is needed, just a direct write to that same key.
  const _summaryPaths=['lotSummaries','dyeLotSummaries'];
  _summaryPaths.forEach(path=>{
    State.fbDB.ref('/tc/'+path).on('child_added',snap=>{
      const item=snap.val();if(!item)return;
      State.DB[path]=State.DB[path]||{};
      State.DB[path][snap.key]=item;
      clearTimeout(_renderDebounceTimer);_renderDebounceTimer=setTimeout(()=>{if(State.currentUser){if(State.currentUser.role==='worker'&&typeof window.renderWorkerView==='function')window.renderWorkerView();else window.renderAll();refreshOpenModalAvailability();}},80);
    },_onListenerError(path,'child_added'));
    State.fbDB.ref('/tc/'+path).on('child_changed',snap=>{
      const item=snap.val();if(!item)return;
      State.DB[path]=State.DB[path]||{};
      State.DB[path][snap.key]=item;
      clearTimeout(_renderDebounceTimer);_renderDebounceTimer=setTimeout(()=>{if(State.currentUser){if(State.currentUser.role==='worker'&&typeof window.renderWorkerView==='function')window.renderWorkerView();else window.renderAll();refreshOpenModalAvailability();}},80);
    },_onListenerError(path,'child_changed'));
    State.fbDB.ref('/tc/'+path).on('child_removed',snap=>{
      if(State.DB[path])delete State.DB[path][snap.key];
    },_onListenerError(path,'child_removed'));
  });

  // child_removed listeners — triggered when worker archives an entry
  // Removes from DB memory immediately so UI stays correct without refresh
  const _archiveRemovedPaths=['dyeLots','windEntries','packEntries','dispatches','lots','stageEntries'];
  _archiveRemovedPaths.forEach(path=>{
    State.fbDB.ref('/tc/'+path).on('child_removed',snap=>{
      const item=snap.val();if(!item||!item.id)return;
      const before=(State.DB[path]||[]).length;
      if(path==='lots'){
        // Aug 2 2026 fix — same real bug as child_added/child_changed
        // above: match by the real, permanent uid when available, not
        // text that can drift.
        State.DB[path]=(State.DB[path]||[]).filter(x=>!_sameLot(x,item));
      } else {
        State.DB[path]=(State.DB[path]||[]).filter(x=>x.id!==item.id);
      }
      if(State.DB[path].length!==before){
        console.log('[archive] removed from memory:',path,item.id);
        clearTimeout(_renderDebounceTimer);_renderDebounceTimer=setTimeout(()=>{if(State.currentUser){if(State.currentUser.role==='worker'&&typeof window.renderWorkerView==='function')window.renderWorkerView();else window.renderAll();refreshOpenModalAvailability();}},80);
      }
    },_onListenerError(path,'child_removed'));
    // Archive child_added listeners removed — reactivation handled by active child_added, avoid downloading archive on startup
  });
  console.log('[Firebase] Real-time listeners attached');
}
async function sha256(str){const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(str));return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');}
function isHashed(p){return typeof p==='string'&&p.length===64&&/^[0-9a-f]+$/.test(p);}

function loadFirebaseData(){console.log('loadFirebaseData() called — delegating to initFirebase flow (no-op)');}
// Sep 22 2026 — real, confirmed bug found via a live staging check (Priyam ran it through Claude in Chrome): a lot number
// containing a hyphen or space (e.g. "OLD-210", "230 RC" — completely normal, real lot numbers) computed a DIFFERENT key
// here than the server's own summaryKey() does, because summaryKey() sanitizes the lot id too and this never did. That
// meant the incremental-load verification permanently, every single time, thought those lots were "missing" (server-side
// key sanitized, e.g. "OLD_210"; this function's own key left the id raw, e.g. "OLD-210") — not a race condition, not
// stale data, just two formulas disagreeing. Data was never actually lost (the code already falls back to a full,
// correct fetch whenever this happens), but it silently lost the incremental path's bandwidth saving for every lot
// number containing a special character, permanently, and printed a scary-looking diagnostic for something totally
// normal. Fixed by sanitizing the id here exactly the same way summaryKey() already does server-side.
export function _lotKey(lot){
  const i=(lot.id||'').replace(/[^a-zA-Z0-9]/g,'_');
  const g=(lot.grade||'').replace(/[^a-zA-Z0-9]/g,'_');
  const v=(lot.vendor||'').replace(/[^a-zA-Z0-9]/g,'_');
  return i+'__'+g+'__'+v;
}
const _partialTables=['lots','stageEntries','dyeLots','windEntries','packEntries','dispatches','partyOrders','voidLog','editLog','deleteRequests'];
export function save(section, item){
  // Always update local backup
  try{localStorage.setItem('tcv2_backup',JSON.stringify(State.DB));}catch(e){}

  if(!State.firebaseLoaded){_pendingSave=true;console.log('[save] queued — not ready');return;}

  // Aug 26 2026 — real fix: the login token no longer lives in
  // sessionStorage at all, since it's now a real HttpOnly cookie the
  // browser sends automatically — JavaScript can no longer read it to
  // pre-check "do I have a token" the way this used to. The real
  // fetch below already correctly authenticates via that cookie, and
  // its own .catch() below already calls _saveFailed if that genuinely
  // fails (a real 401), so this pre-check simply isn't needed anymore.

  // Route through Worker (Sub-phase A)
  let body;
  if(section && item && item.id){
    body={table:section,item};
    console.log('[save-W] single item → /tc/'+section+'/'+item.id);
  } else if(section && State.DB[section]!==undefined){
    if(_partialTables.includes(section)){
      const items=(State.DB[section]||[]).filter(x=>x&&x.id);
      body={table:section,items};
      console.log('[save-W] table update → /tc/'+section,items.length,'records');
    } else {
      body={table:section,data:State.DB[section]};
      console.log('[save-W] full table → /tc/'+section);
    }
  } else {
    // Full DB fallback — send each partial table separately
    _partialTables.forEach(sec=>{
      const items=(State.DB[sec]||[]).filter(x=>x&&x.id);
      if(items.length>0)save(sec);
    });
    return;
  }

  fetch(WORKER_URL+'/api/save',{method:'POST',headers:_postHeaders(),body:JSON.stringify(body)})
    .then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
    .then(d=>{if(!d.success)throw new Error(d.error||'Save failed');console.log('[save-W] ✓',section);})
    .catch(err=>{
      console.warn('[save-W] failed:',err.message);
      _saveFailed(section);
    });
}

// Jul 15 2026 — Item Q fix. Was: _saveDirect() — wrote straight to Firebase
// with the browser's own SDK, bypassing the Worker's role/table checks
// (_canWrite) entirely, whenever the token was missing or the Worker call
// failed. Silent — no error shown to the user, who'd believe the save
// succeeded. Closed the bypass: on failure, the change is NOT written
// anywhere (local backup above already preserved it for this device/
// session) and the user is told explicitly, instead of a silent Firebase-
// direct write with zero validation.
function _saveFailed(section){
  if(typeof showToast==='function')showToast('Could not save '+(section||'change')+' — server unreachable. Not saved.','err');
}

function loadLocal(){const d=localStorage.getItem('tcv2')||localStorage.getItem('tcv2_backup');if(d){try{State.DB=JSON.parse(d);}catch(e){}}}
export {Q,Qsub,Qmax0} from './shared-balances.js';
export const fU=n=>+(n||0).toFixed(1);
export const fW=n=>+(n||0).toFixed(2);
export const fmt=v=>(+v||0).toLocaleString('en-IN',{maximumFractionDigits:2});
export function fmtQty(count,kg,label){const hc=count!=null&&count>0;const hk=kg!=null&&kg>0;if(hc&&hk)return count+label+' / '+fmt(kg)+'kg';if(hc)return count+label;if(hk)return fmt(kg)+'kg';return'—';}
export const fmtQ=(q,label='u',sep=' / ')=>`${fmt(q.units)}${label}${sep}${fmt(q.weight)}kg`;
export const today=()=>new Date().toISOString().split('T')[0];
export const nowTS=()=>new Date().toISOString();
export const fmtTS=ts=>{if(!ts)return'—';const d=new Date(ts);return d.toLocaleDateString('en-GB')+' '+d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});};
export const fmtDate=d=>{if(!d)return'—';const p=d.split('-');return p.length===3?p[2]+'/'+p[1]+'/'+p[0]:d;};
export const fmtRelTS=ts=>{if(!ts)return'—';const d=new Date(ts);const now=new Date();const sec=Math.floor((now-d)/1000);const min=Math.floor(sec/60);const hr=Math.floor(min/60);const day=Math.floor(hr/24);let rel;if(sec<60)rel='just now';else if(min<60)rel=min+'m ago';else if(hr<24)rel=hr+'h ago';else if(day<7)rel=day+'d ago';else rel=fmtDate(ts.split('T')[0]);return'<span title="'+fmtTS(ts)+'" style="cursor:default">'+rel+'</span>';};
export const genId=(p,arr)=>{const existing=(arr||[]).map(x=>{const n=parseInt((x.id||'').split('-').pop());return isNaN(n)?0:n;});const next=existing.length?Math.max(...existing)+1:1;return`${p}-${String(next).padStart(4,'0')}`;};
export async function genIdAtomic(p,arr){
  // Atomic ID generation via Firebase transaction - closes the race condition where
  // two near-simultaneous submissions could compute the same "next" ID locally.
  // Falls back to local scan if Firebase unavailable (offline mode).
  const localNext=()=>{const existing=(arr||[]).map(x=>{const n=parseInt((x.id||'').split('-').pop());return isNaN(n)?0:n;});return existing.length?Math.max(...existing)+1:1;};
  if(!State.fbDB||!State.firebaseLoaded)return`${p}-${String(localNext()).padStart(4,'0')}`;
  try{
    const result=await State.fbDB.ref('/tc/idCounters/'+p).transaction(current=>(current||(localNext()-1))+1);
    if(result.committed&&result.snapshot.val()){
      return`${p}-${String(result.snapshot.val()).padStart(4,'0')}`;
    }
  }catch(e){console.warn('[genIdAtomic] transaction failed, falling back to local scan:',e);}
  return`${p}-${String(localNext()).padStart(4,'0')}`;
}
export const pct=(num,den)=>den>0?((num/den)*100).toFixed(1)+'%':'0%';
// Aug 6 2026 (later same session) — simplified per Priyam's explicit,
// direct instruction: waste = red, gain = green, simple binary. Replaces
// the old 4-level severity gradient (zero/low/mid/high) entirely — no
// more graduated yellow/orange warning levels, just red or green,
// matching the new signed waste/gain convention (negative=waste,
// positive=gain) built the same session.
export const wcls=v=>+v<0?'wc-waste':+v>0?'wc-gain':'wc-zero';

// ─── Shared table-cell formatters — used by RM/Stage/Dye/Wind/Pack/Dispatch ───
// Fix the format here once, every table using it updates together.
export function qtyCell(units,weight,unitLabel){
  // Single-line plain mono quantity: "144c / 148.8kg" — the standard across all tables
  const u=units!=null?fmt(units)+unitLabel:'—';
  const w=weight!=null?' / '+fmt(weight)+'kg':'';
  return u+w;
}
export function mwCell(value){
  // Machine/Worker cell — grey text, consistent across all stages
  return `<td style="vertical-align:top;font-size:0.72rem;color:var(--mu)">${value||'—'}</td>`;
}
export function dtCell(tsValue){
  // Date/Time cell — grey mono text, consistent across all stages
  return `<td class="mono" style="vertical-align:top;font-size:0.65rem;color:var(--mu)">${fmtTS(tsValue)}</td>`;
}
export function wasteCell(wasteQty,wasteWeight,wastePct,unitLabel){
  // Aug 6 2026 (later same session) — extended for Pack's consolidation:
  // Pack has no separate quantity concept (only weight), unlike
  // Soft/Wind/Dye which always have both qty and weight together. Shows
  // whichever pieces are real; never a stray dash/slash when only one
  // side genuinely applies. Color falls back to the weight's own sign
  // when there's no quantity at all, so Pack colors correctly too.
  const q=wasteQty!=null?wasteQty+unitLabel:'';
  const w=wasteWeight!=null?fmt(wasteWeight)+'kg':'';
  const combined=q&&w?q+' / '+w:(q||w||'—');
  const colorBasis=wasteQty!=null?wasteQty:wasteWeight;
  return `<td style="vertical-align:top" class="mono ${wcls(colorBasis)}">${combined}</td>`;
}
export function wastePctCell(wastePct){
  return `<td style="vertical-align:top" class="${wcls(parseFloat(wastePct))}">${wastePct}</td>`;
}
export function balCell(units,weight,unitLabel,activeColor){
  // Balance/stock cell — grey when zero, distinct color (passed in) when has value
  const hasVal=(units||0)>0||(weight||0)>0;
  const color=hasVal?(activeColor||'var(--tx)'):'var(--mu)';
  return `<td class="mono" style="color:${color}">${units||0}${unitLabel} / ${fmt(weight||0)}kg</td>`;
}
export const SCOL={Soft:'var(--cs)',Dye:'var(--cd)',Wind:'var(--cw)',Pack:'var(--cp)',RM:'var(--cr)'};
export {appr} from './shared-balances.js';
export {calcFlowTotals, calcMachineTotals, calcWorkerTotals, calcShadeTotals, calcDailyTotals} from './shared-balances.js';
function consumed(arr){return(arr||[]).filter(x=>x.status!=='Rejected'&&x.status!=='Voided'&&x.status!=='Void'&&!x.voided);}
export function getLot(id){return State.DB.lots.find(l=>l.id===id)||{};}
export {seMatch} from './shared-balances.js';
export function getLotByKey(lotId,grade,vendor){return calcLotByKey(State.DB.lots,lotId,grade,vendor);}
export function getSoftIn(lotId,grade,vendor){return calcSoftIn(State.DB.stageEntries,State.DB.lots,lotId,grade,vendor);}
export function getSoftOut(lotId,grade,vendor){return calcSoftOut(State.DB.stageEntries,State.DB.lots,State.DB.scrapLog,lotId,grade,vendor);}
// Shared by backup-list/export/restore — these use raw REST fetch() (not the SDK)
// specifically to use REST-only features like ?shallow=true for lightweight key
// listing. Firebase REST accepts an ID token in the same ?auth= slot a legacy
// secret would use, so this keeps them working under auth!=null rules.
export function _fbAuthedFetch(path){
  if(!firebase.auth().currentUser)return fetch(FIREBASE_CONFIG.databaseURL+path);
  return firebase.auth().currentUser.getIdToken().then(token=>{
    const sep=path.includes('?')?'&':'?';
    return fetch(FIREBASE_CONFIG.databaseURL+path+sep+'auth='+token);
  });
}

function _partyKey(party){return(party||'').replace(/[^a-zA-Z0-9]/g,'_');}

// Shared by all 6 password-confirmation call sites — DB.users is intentionally
// never loaded client-side anymore, so every password check goes through here.
// Pass username to check one specific user (self-checks); omit to check against
// any active admin/manager (admin-confirmation modals).
export async function _verifyPasswordViaWorker(password,username){
  try{
    const res=await fetch(WORKER_URL+'/api/verify-password',{method:'POST',headers:_postHeaders(),body:JSON.stringify(username?{password,username}:{password})});
    const data=await res.json();
    if(res.ok&&data.success)return data.user;
    return null;
  }catch(e){console.error('[Verify] Worker request failed:',e);return null;}
}

export async function triggerSummaryUpdate(type, opts) {
  const body = { type, ...opts };

  // ── Immediately evict stale summary from memory ──────────────────────────
  // This ensures live calculation fallback kicks in instantly while worker
  // recalculates. Prevents stale cached value from persisting on worker failure.
  if (opts && opts.lotId && opts.grade && opts.vendor) {
    const _sk = _summaryKey(opts.lotId, opts.grade, opts.vendor);
    if (State.DB.lotSummaries) delete State.DB.lotSummaries[_sk];
  }
  if (opts && opts.dyeLotId) {
    if (State.DB.dyeLotSummaries) delete State.DB.dyeLotSummaries[opts.dyeLotId];
  }

  // Jul 11 2026 — this was the last confirmed gap: the message asking the
  // server to recalculate had zero retry. If it failed to even reach the
  // server (a dropped connection, a bad moment on the network), the local
  // eviction above still made THIS session show a correct live-calculated
  // number — but nothing was ever saved anywhere, so the real database
  // stayed exactly as wrong as before, invisible to every other user, and
  // invisible again to this same session on next reload. Now retries up to
  // 3 times (250ms, 500ms backoff — same pattern already proven for the
  // index write), and if all 3 genuinely fail, writes a real, visible
  // failure record directly to Firebase (bypassing the worker, since the
  // worker is what's unreachable) — same measurement approach as the
  // index-write smoke detector, kept in a separately-named table so the
  // two failure classes (index write vs trigger call) can be told apart.
  //
  // Jul 14 2026 (Item N) — this function is now genuinely `async` and
  // returns the real result, instead of being fire-and-forget by design.
  // Confirmed via a real code read that `await triggerSummaryUpdate(...)`
  // used to resolve instantly with nothing, never actually waiting for the
  // network call or retries — this was the exact underlying mechanism
  // behind the race condition found and fixed for recalcLotSummary earlier
  // this session, just never fixed at the source. Existing callers that
  // don't await it are unaffected — fire-and-forget still works exactly as
  // before, since not awaiting an async function is always valid.
  const _sleep = ms => new Promise(r => setTimeout(r, ms));
  const _attemptTrigger = async (attempt) => {
    try {
      const res = await fetch(WORKER_URL + '/api/summary/trigger', {
        method: 'POST',
        headers: _postHeaders(),
        body: JSON.stringify(body)
      });
      const d = await res.json();
      if (d.success) {
        // Re-fetch fresh summary into memory after worker writes it
        if (opts.lotId && opts.grade && opts.vendor) {
          const _sk = _summaryKey(opts.lotId, opts.grade, opts.vendor);
          State.fbDB.ref('/tc/lotSummaries/' + _sk).once('value', s => {
            const val = s.val();
            if (val) { State.DB.lotSummaries = State.DB.lotSummaries || {}; State.DB.lotSummaries[_sk] = val; }
            window.renderAll();
          });
        }
        if (d.results.dyeLotSummary && d.results.dyeLotSummary.updated && opts.dyeLotId) {
          State.fbDB.ref('/tc/dyeLotSummaries/' + opts.dyeLotId).once('value', s => {
            const val = s.val();
            if (val) { State.DB.dyeLotSummaries = State.DB.dyeLotSummaries || {}; State.DB.dyeLotSummaries[opts.dyeLotId] = val; }
          });
        }
        if (Array.isArray(d.results.partySummaries)) {
          d.results.partySummaries.forEach(party => {
            State.fbDB.ref('/tc/partySummaries/' + _partyKey(party)).once('value', s => {
              const val = s.val();
              if (val) { State.DB.partySummaries = State.DB.partySummaries || {}; State.DB.partySummaries[_partyKey(party)] = val; }
            });
          });
        }
        if (Array.isArray(d.results.orderSummaries)) {
          d.results.orderSummaries.forEach(orderId => {
            State.fbDB.ref('/tc/orderSummaries/' + orderId).once('value', s => {
              const val = s.val();
              if (val) { State.DB.orderSummaries = State.DB.orderSummaries || {}; State.DB.orderSummaries[orderId] = val; }
            });
          });
        }
        console.log('[summary] updated:', type, opts);
        return { success: true, results: d.results };
      } else if (attempt < 3) {
        await _sleep(attempt * 250);
        return _attemptTrigger(attempt + 1);
      } else {
        _recordTriggerFailure(type, opts, 'server responded without success');
        return { success: false, reason: 'server responded without success' };
      }
    } catch (e) {
      if (attempt < 3) {
        await _sleep(attempt * 250);
        return _attemptTrigger(attempt + 1);
      } else {
        // Worker unreachable after 3 attempts — summary already evicted
        // from memory above so THIS session's live calculation fallback is
        // safe. But nothing was saved anywhere, so record that visibly.
        console.warn('[summary] trigger failed after 3 attempts:', e);
        _recordTriggerFailure(type, opts, e.message || 'network error');
        window.renderAll();
        return { success: false, reason: e.message || 'network error' };
      }
    }
  };
  return _attemptTrigger(1);
}

function _recordTriggerFailure(type, opts, errorMsg) {
  try {
    if (!State.fbDB || !State.firebaseLoaded) return;
    const failId = 'TCF-' + Date.now() + '-' + Math.random().toString(36).slice(2,8);
    State.fbDB.ref('/tc/triggerCallFailures/' + failId).set({
      type, opts, error: errorMsg, timestamp: new Date().toISOString(),
    }).catch(()=>{}); // if even this fails, nothing more we can do client-side
  } catch(e) { /* best-effort only */ }
}
export function _summaryKey(lotId,grade,vendor){return (lotId||'').replace(/[^a-zA-Z0-9]/g,'_')+'__'+(grade||'').replace(/[^a-zA-Z0-9]/g,'_')+'__'+(vendor||'').replace(/[^a-zA-Z0-9]/g,'_');}
export function _getLotSummary(lotId,grade,vendor){return(State.DB.lotSummaries||{})[_summaryKey(lotId,grade,vendor)]||null;}
export function _getDyeLotSummary(dyeLotId){return(State.DB.dyeLotSummaries||{})[dyeLotId]||null;}
export function getRMBalance(lotId,grade,vendor){const s=_getLotSummary(lotId,grade,vendor);if(s&&s.rmBalance)return Q(s.rmBalance.units||0,s.rmBalance.kg||0);return calcRMBalance(State.DB.lots,State.DB.stageEntries,State.DB.rmReturnLog,lotId,grade,vendor);}
export function getDyeConsumedFromLot(lotId,grade,vendor){const l=getLotByKey(lotId,grade,vendor);if(!l.id)return Q(0,0);const softOut=getSoftOut(lotId,grade,vendor);const totalSoftBags=softOut.units||0;const totalSoftKg=softOut.weight||1;
// Jul 13 2026 — was a separate, hand-duplicated matching implementation with
// the same loose grade/vendor fallback bug found and fixed in
// calcSoftConsumedByDye (shared-balances.js). Never migrated to the shared
// function, so that earlier fix never reached this one — this dropdown's
// "avail" label was still vulnerable independently. Now calls the single
// shared, strict-matching formula instead of maintaining a second copy.
const totalKgConsumed=calcSoftConsumedByDye(State.DB.dyeLots,lotId,l.grade,l.vendor);const bagsConsumed=Math.round(totalSoftBags*(totalKgConsumed/totalSoftKg));return Q(bagsConsumed,totalKgConsumed);}
export function getSoftBalance(lotId,grade,vendor){const s=_getLotSummary(lotId,grade,vendor);if(s&&s.softBalance)return Q(s.softBalance.units||0,s.softBalance.kg||0);const softOut=getSoftOut(lotId,grade,vendor);const dyeConsumedKg=getDyeConsumedFromLot(lotId,grade,vendor).weight||0;const residualKg=getSoftResidualOut(lotId,grade,vendor);
// Jul 14 2026 — was missing residual deduction entirely, unlike getSoftBalanceWeight
// which already subtracted it (Jul 8 2026 residual system build). Confirmed with
// Priyam: KG is the real precise number; bags is a rounded best-effort display
// figure, not chased for precision — a bag is a discrete physical thing, fractional
// bags don't mean anything. Floor at zero is a pure safety net (shouldn't trigger
// if residual's own available-balance check is working, costs nothing to have).
const balKg=Math.max(0,(softOut.weight||0)-dyeConsumedKg-residualKg);const balBags=softOut.weight>0?Math.max(0,Math.round((softOut.units||0)*(balKg/softOut.weight))):0;return Q(balBags,balKg);}
export function getDyeAllocated(lotId,grade,vendor){return calcDyeAllocated(State.DB.dyeLots,lotId,grade,vendor);}
export function getVendorRatioForDyeLot(dyeLot,lotId,grade,vendor){return calcVendorRatioForDyeLot(dyeLot,lotId,grade,vendor);}
export function getWindIn(lotId,grade,vendor){return calcWindInAllocated(State.DB.dyeLots,State.DB.windEntries,lotId,grade,vendor);}
export function getWindOut(lotId,grade,vendor){return calcWindOutAllocated(State.DB.dyeLots,State.DB.windEntries,lotId,grade,vendor);}
export function getDyeBalance(lotId,grade,vendor){const s=_getLotSummary(lotId,grade,vendor);if(s)return Q(s.dyeBalance?s.dyeBalance.cones||0:0,s.dyeBalance?s.dyeBalance.kg||0:0);return calcDyeBalanceByLot(State.DB.dyeLots,State.DB.windEntries,lotId,grade,vendor);}
export function getPackIn(lotId,grade,vendor){return calcPackInAllocated(State.DB.dyeLots,State.DB.packEntries,lotId,grade,vendor);}
export function getPackOut(lotId,grade,vendor){const l=getLotByKey(lotId,grade,vendor);if(!l.id)return Q(0,0);
// Jul 14 2026 — Item G. Was loose matching (blank grade/vendor on either
// side matched anything) — same bug class fixed elsewhere this session.
const dyeLots=(State.DB.dyeLots||[]).filter(d=>(d.sources||[]).some(s=>s.lotId===lotId&&s.grade===l.grade&&s.vendor===l.vendor));return dyeLots.reduce((acc,d)=>{const ratio=getVendorRatioForDyeLot(d,lotId,l.grade,l.vendor);if(!ratio)return acc;const entries=(State.DB.packEntries||[]).filter(e=>e.dyeLotId===d.id&&(e.status==='Approved'||e.status==='Edited-Approved'));const totalBags=entries.reduce((a,e)=>a+(e.bags||0),0);const totalWeight=entries.reduce((a,e)=>a+(e.weight||0),0);return Qadd(acc,Q(Math.round(totalBags*ratio),totalWeight*ratio));},Q(0,0));}
export function getWindBalance(lotId,grade,vendor){const s=_getLotSummary(lotId,grade,vendor);if(s)return Q(s.windBalance?s.windBalance.cones||0:0,s.windBalance?s.windBalance.kg||0:0);return calcWindBalanceByLot(State.DB.dyeLots,State.DB.windEntries,State.DB.packEntries,lotId,grade,vendor);}
export function getDispatched(lotId,grade,vendor){const l=getLotByKey(lotId,grade,vendor);
// Jul 14 2026 — Item G. Was loose matching, fixed to strict.
const dyeLots=(State.DB.dyeLots||[]).filter(d=>(d.sources||[]).some(s=>s.lotId===lotId&&s.grade===grade&&s.vendor===vendor));return dyeLots.reduce((acc,d)=>{const ratio=getVendorRatioForDyeLot(d,lotId,grade,vendor);if(!ratio)return acc;const disps=appr(State.DB.dispatches||[]).filter(e=>e.dyeLotId===d.id);const totalBags=disps.reduce((a,e)=>a+(e.units||e.bags||0),0);const totalWeight=disps.reduce((a,e)=>a+(e.weight||0),0);return Qadd(acc,Q(Math.round(totalBags*ratio),totalWeight*ratio));},Q(0,0));}
export function getPackBalance(lotId,grade,vendor){const s=_getLotSummary(lotId,grade,vendor);if(s)return{units:s.packBalance?s.packBalance.bags||0:0,weight:s.packBalance?s.packBalance.kg||0:0};return Qmax0(Qsub(getPackOut(lotId,grade,vendor),getDispatched(lotId,grade,vendor)));}
export function getGradePool(grade){return State.DB.lots.filter(l=>l.grade===grade).reduce((acc,l)=>Qadd(acc,Qmax0(getSoftBalance(l.id,l.grade,l.vendor))),Q(0,0));}
// Sep 8 2026 — real, direct fix built via direct discussion with
// Priyam: a Voided or Merged (dead, superseded) RM lot should never
// appear as a pickable option in any stage-start dropdown, same
// principle applied consistently everywhere a lot gets listed for
// selection, not just relying on its balance happening to be zero.
// Sep 8 2026 — moved here from dye.js during the shared-eligibility-
// function consolidation with Priyam: this is a general dye-lot sort
// utility used by many stages (Wind, Pack, Dispatch, Dye End,
// Lifecycle), not Dye-specific business logic, and core.js can't
// import from dye.js without creating a circular dependency (dye.js
// already imports from core.js) — so it lives here now, and dye.js
// imports it back for its own use.
export function sortDyeLotNo(a,b){const serial=s=>{if(!s||typeof s!=='string')return 0;const parts=s.split('-');return parseInt(parts[2])||0;};return serial(b)-serial(a);}
// Sep 8 2026 — shared-eligibility-function consolidation, planned with
// Priyam: these 5 functions are the single, real source of truth for
// "what belongs in this dropdown" — every consumer (desktop forms AND
// Worker View) calls these instead of writing its own copy of the same
// filter/sort, closing the exact drift pattern that caused the WIP
// double-booking gap and the machine-4-list gap to go unnoticed in
// Worker View for as long as they did.
export function eligibleWindLots(){return(State.DB.dyeLots||[]).filter(d=>(d.status==='Approved'||d.status==='Edited-Approved')&&!_isDyeLotOnHold(d.id)&&(getDyeBalAvailable(d.id).weight>0||getDyeBalAvailable(d.id).units>0)).sort(sortDyeLotNo);}
export function eligiblePackLots(){return(State.DB.dyeLots||[]).filter(d=>(d.status==='Approved'||d.status==='Edited-Approved')&&!_isDyeLotOnHold(d.id)&&(getWindBalAvailable(d.id).weight>0||getWindBalAvailable(d.id).units>0)).sort(sortDyeLotNo);}
export function eligibleDispatchLots(){return(State.DB.dyeLots||[]).filter(d=>(d.status==='Approved'||d.status==='Edited-Approved')&&!_isDyeLotOnHold(d.id)&&(getPackBalAvailable(d.id).units>0||getPackBalAvailable(d.id).weight>0)).sort(sortDyeLotNo);}
export function machinesForStage(stage){const key={Soft:'softMachines',Dye:'dyeMachines',Wind:'windMachines',Pack:'packMachines'}[stage];return[...((State.DB.masters||{})[key]||[])].sort();}
// Sep 8 2026 — real, direct fix built via direct discussion with
// Priyam: Machine Health (and its own machine filter dropdown) used
// to read the old, single shared masters.machines list — but machines
// now genuinely live in 4 separate per-stage lists, and a machine
// added only to one of those (say, windMachines) was invisible here,
// not wrong, just never shown. Unions all 4 real lists instead of the
// stale shared one.
export function allMachinesSorted(){const m=State.DB.masters||{};return[...new Set([...(m.softMachines||[]),...(m.dyeMachines||[]),...(m.windMachines||[]),...(m.packMachines||[])])].sort();}
export function workersSorted(){return[...((State.DB.masters||{}).workers||[])].sort();}
export function lotsForStage(stage){if(stage==='Soft'){return(State.DB.lots||[]).filter(l=>{if(l.status==='Voided'||l.status==='Merged'||_isLotOnHold(l.id,l.grade,l.vendor))return false;const b=getRMBalance(l.id,l.grade,l.vendor);return b.units>0||b.weight>0;}).sort((a,b)=>(a.id||'').localeCompare(b.id||''));}
if(stage==='Dye'){return(State.DB.lots||[]).filter(l=>l.status!=='Voided'&&l.status!=='Merged'&&!_isLotOnHold(l.id,l.grade,l.vendor)&&(getSoftBalance(l.id,l.grade,l.vendor).units>0||getSoftBalance(l.id,l.grade,l.vendor).weight>0)).sort((a,b)=>(a.id||'').localeCompare(b.id||''));}
return[];}

export function stageBalance(lotId,stage,grade,vendor){if(!grade||!vendor){const l=getLot(lotId);grade=l.grade;vendor=l.vendor;}
if(stage==='Soft')return getRMBalance(lotId,grade,vendor);if(stage==='Wind')return getDyeBalance(lotId,grade,vendor);if(stage==='Pack')return getWindBalance(lotId,grade,vendor);if(stage==='Dispatch')return getPackBalance(lotId,grade,vendor);return Q(0,0);}

function doLogin(){const u=document.getElementById('li-u').value.trim();const p=document.getElementById('li-p').value;const errEl=document.getElementById('lerr');const btn=document.querySelector('.lbtn');if(!u||!p){if(errEl){errEl.style.display='block';errEl.textContent='Enter username and password';}
return;}
// Aug 26 2026 — real Turnstile check, built via direct discussion with
// Priyam: window.turnstile.getResponse() reads the token the widget
// already generated in the background. If it's genuinely empty, the
// visitor hasn't been verified yet — stop here, same as any other
// required field, rather than sending an empty token the server would
// correctly reject anyway.
const turnstileToken=window.turnstile?.getResponse()||'';
if(!turnstileToken){if(errEl){errEl.style.display='block';errEl.textContent='Please complete the verification below';}
return;}
if(errEl)errEl.style.display='none';if(btn){btn.textContent='Signing in...';btn.disabled=true;}
fetch(WORKER_URL+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p,turnstileToken})})
.then(r=>r.json().then(data=>({ok:r.ok,data})))
.then(({ok,data})=>{
  if(ok&&data.success){
    State.currentUser=data.user;window.currentUser=State.currentUser;sessionStorage.setItem('tcv2_session',JSON.stringify(State.currentUser));
    _maybeStartDataLoad(); // Sep 25 2026 — per-user isolation: now that we know WHO logged in, this either starts
    // data loading for real (if Firebase's anonymous auth already resolved) or is a safe no-op that the anon-auth
    // callback above will correctly complete once it resolves — never starts loading twice either way.
    const rememberMe=document.getElementById('remember-me')?.checked;
    if(rememberMe){localStorage.setItem('tc_remember',JSON.stringify({username:u}));}
    else{localStorage.removeItem('tc_remember');}
    if(btn){btn.textContent='Sign In →';btn.disabled=false;}
    // Worker login resolves independently of the client's own Firebase load —
    // wait for firebaseLoaded before rendering, same as session-restore does,
    // or onLogin() would render against an empty/partial DB.
    if(State.firebaseLoaded){onLogin();}else{_waitForDBThenLogin();}
  }else{
    if(errEl){errEl.style.display='block';errEl.textContent=data.error||'Incorrect username or password';}
    if(btn){btn.textContent='Sign In →';btn.disabled=false;}
    // Real, a Turnstile token can only ever be used once — reset the
    // widget on any failure so the next attempt gets a fresh, valid one.
    window.turnstile?.reset();
  }
})
.catch(err=>{
  console.error('[Login] Worker request failed:',err);
  if(errEl){errEl.style.display='block';errEl.textContent='Could not reach server — check connection and try again';}
  if(btn){btn.textContent='Sign In →';btn.disabled=false;}
  window.turnstile?.reset();
});}

export function logout(){
  // Aug 26 2026 — real, genuine fix: the real session cookie is
  // HttpOnly, so it must be cleared by the server itself, not by
  // JavaScript directly. This calls that real, dedicated endpoint
  // first — deliberately not waiting on it, since the person should
  // never be stuck watching a spinner just to log out; the local
  // state clears immediately either way, exactly as it always has.
  fetch(WORKER_URL+'/api/logout',{method:'POST',headers:_getHeaders()}).catch(()=>{});
  // Sep 25 2026 — per-user isolation (approved design): stop using this user's database and close the connection —
  // but never delete it. Their own next login should reopen this exact same database and reuse their existing
  // cache, not pay for a fresh full download. _dataLoadStarted is also reset here so the NEXT login (of anyone,
  // including a different user on this same browser) correctly starts its own, fresh data-load sequence rather
  // than being silently skipped as "already started" from this session.
  if(State.currentDB){try{State.currentDB.close();}catch(e){}}
  State.currentDB=null;
  _dataLoadStarted=false;
  State.currentUser=null;window.currentUser=null;sessionStorage.removeItem('tcv2_session');sessionStorage.removeItem('tc_token');localStorage.removeItem('tc_remember');localStorage.removeItem('tcv2');localStorage.removeItem('tcv2_backup');document.getElementById('login-screen').classList.remove('hidden');document.getElementById('worker-view').style.display='none';document.getElementById('app').classList.remove('flex');const tb=document.getElementById('mob-topbar');if(tb)tb.style.display='none';document.getElementById('li-u').value='';document.getElementById('li-p').value='';window.renderLoginDemoCards(true);}
export function onLogin(){document.getElementById('login-screen').classList.add('hidden');if(State.currentUser.role==='worker'){document.getElementById('worker-view').style.display='block';document.getElementById('app').classList.remove('flex');window.renderWorkerView();}else{document.getElementById('app').classList.add('flex');document.getElementById('worker-view').style.display='none';setupSidebar();setupMobileNav();window.setupRMEditLogTab();['flow','shade','pack','waste','machine','worker','party'].forEach(t=>{const r=dateRange('month');rptState[t]={from:r.from,to:r.to};});const dr=dateRange('daily');rptState['daily']={from:dr.from,to:dr.to};window.renderAll();}}

export function nav(id,el){State.currentPage=id;document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));document.querySelectorAll('.ni,.nav-item').forEach(n=>n.classList.remove('active'));const pg=document.getElementById('page-'+id);if(pg)pg.classList.add('active');if(el)el.classList.add('active');else document.getElementById('ni-'+id)?.classList.add('active');if(typeof updateMobileNavActive==='function')updateMobileNavActive(id);
// Layer 3: load on-demand data when section opened
if(id==='dispatch'){window.renderAll();return;}
if(id==='challan'){window.renderAll();return;}
if(id==='vendor'&&typeof loadVendorTrackerData==='function'){loadVendorTrackerData(()=>{window.renderAll();});return;}
if(id==='party'&&typeof loadPartyTrackerData==='function'){loadPartyTrackerData(()=>{window.renderAll();});return;}
if(id==='reports'&&typeof loadReportsData==='function'){loadReportsData(()=>{window.renderAll();});return;}
if(id==='analytics'){window.renderAll();return;}
if(id==='lifecycle'){window.renderAll();return;}
if(id==='dyelifecycle'){window.renderAll();return;}
window.renderAll();}



export function getDeadStockBalance(id){return calcDeadStockBalance(State.DB.deadStock,State.DB.dyeLots,State.DB.stageEntries,State.DB.scrapLog,id);}
export function getDeadStockConesBalance(id){return calcDeadStockConesBalance(State.DB.deadStock,State.DB.dyeLots,id);}
export function getDyeBal(dyeLotId){const s=_getDyeLotSummary(dyeLotId);if(s&&s.dyeBalance)return Q(s.dyeBalance.cones||0,s.dyeBalance.kg||0);return calcDyeBal(State.DB.dyeLots,State.DB.windEntries,dyeLotId);}
export function getDyeLotCurrentStage(dyeLotId){const packBal=getPackBal(dyeLotId);const disp=getTotalDispatched(dyeLotId);const packed=getTotalPacked(dyeLotId);const windBal=getWindBal(dyeLotId);const dyeBal=getDyeBal(dyeLotId);const lot=(State.DB.dyeLots||[]).find(d=>d.id===dyeLotId);if(!lot||!(lot.status==='Approved'||lot.status==='Edited-Approved'))return'At Dye';if(packed.weight>0&&packBal.weight<=0&&disp.weight>0)return'Completed';if(packed.weight>0)return'At Pack';if(windBal.weight>0||getWindOutput(dyeLotId)>0)return'At Wind';if(dyeBal>0)return'At Dye';return'At Dye';}

export function getPackBal(dyeLotId){const s=_getDyeLotSummary(dyeLotId);if(s&&s.packBalance)return{weight:s.packBalance.kg||0,bags:s.packBalance.bags||0};return calcPackBal(State.DB.packEntries,State.DB.dispatches,dyeLotId);}

export function getRecycleSteelBal(rcId){return calcRecycleSteelBal(State.DB.recycleStock,State.DB.dyeLots,State.DB.scrapLog,rcId,State.DB.recycleSoft);}
export function getRecycleSteelAvail(rcId){return calcRecycleSteelAvailable(State.DB.recycleStock,State.DB.dyeLots,State.DB.scrapLog,rcId,State.DB.recycleSoft);}
export function getRecycleSoftenedBal(rcId){return calcRecycleSoftenedBal(State.DB.recycleStock,State.DB.recycleSoft,State.DB.dyeLots,State.DB.scrapLog,rcId);}
export function getRecycleSoftenedAvail(rcId){return calcRecycleSoftenedAvailable(State.DB.recycleStock,State.DB.recycleSoft,State.DB.dyeLots,State.DB.scrapLog,rcId);}
// Sep 19 2026 — Recycle Phase 1: two states only. The old Wind/Soft statuses ("At Wind", "Wound — Needs Soft", "Ready for Dye (post-wind)") belonged to
// a route that does not exist (there is no Recycle Wind). `available` = something is still free to use (cones AND kg checked separately).
export function getRCStatus(rcId){const rc=(State.DB.recycleStock||[]).find(r=>r.id===rcId);if(!rc)return{status:'Unknown',available:false};if(rc.status==='Voided')return{status:'Voided',available:false};if(rc.status==='Scrapped')return{status:'Scrapped',available:false};const bal=getRecycleSteelBal(rcId),av=getRecycleSteelAvail(rcId);if(bal.weight<=0.01&&bal.units<=0)return{status:'Consumed',available:false};if(bal.weight<=0.01||bal.units<=0)return{status:'Leftover (only cones or only kg remain)',available:false};if(av.weight<=0.01||av.units<=0)return{status:'On Steel — In Use (Dye running)',available:false};return{status:'On Steel — Available',available:true};}
export function getSoftResidualOut(lotId,grade,vendor){return calcSoftResidualOut(State.DB.residualLog,lotId,grade,vendor);}
export function getRMReturnedOut(lotId,grade,vendor){return calcRMReturnedOut(State.DB.rmReturnLog,lotId,grade,vendor);}
export function getSoftBalanceWeight(lotId,grade,vendor){const s=_getLotSummary(lotId,grade,vendor);if(s&&s.softBalance)return s.softBalance.kg||0;return calcSoftBalanceWeight(State.DB.stageEntries,State.DB.lots,State.DB.scrapLog,State.DB.dyeLots,State.DB.residualLog,lotId,grade,vendor);}
// Aug 26 2026 — real, direct extension built via direct discussion with
// Priyam: the true, real, unclamped Soft-available number — Soft
// balance minus whatever's already, genuinely claimed by other, still-
// pending Dye work — computed directly, locally, from data already,
// genuinely sitting in the browser, matching the exact same formula
// the server's own /api/soft-available endpoint uses. Correct for
export function getSoftConsumedByDye(lotId,grade,vendor){return calcSoftConsumedByDye(State.DB.dyeLots,lotId,grade,vendor);}
export function getTotalDispatched(dyeLotId){const s=_getDyeLotSummary(dyeLotId);if(s&&s.dispatched)return{weight:s.dispatched.kg||0,bags:s.dispatched.bags||0};return calcTotalDispatchedApproved(State.DB.dispatches,dyeLotId,State.DB.dyeLots);}
export function getTotalPacked(dyeLotId){const entries=(State.DB.packEntries||[]).filter(e=>e.dyeLotId===dyeLotId&&e.status!=='Rejected'&&e.status!=='Void'&&e.status!=='Voided'&&!e.voided);return{weight:entries.reduce((a,e)=>a+(e.weight||0),0),bags:entries.reduce((a,e)=>a+(e.bags||0),0),cones:entries.reduce((a,e)=>a+(e.inCones||0),0)};}


export function getWindBal(dyeLotId){const s=_getDyeLotSummary(dyeLotId);if(s&&s.windBalance)return Q(s.windBalance.cones||0,s.windBalance.kg||0);return calcWindBal(State.DB.windEntries,State.DB.packEntries,dyeLotId);}

export function getWindOutput(dyeLotId){
  // Jul 14 2026 — Item F. Was 'Approved' only, missing 'Edited-Approved' —
  // same bug class fixed elsewhere this session (Approved + Edited-Approved
  // both count, confirmed with Priyam; Void never counts, globally).
  return appr(State.DB.windEntries||[]).filter(e=>e.dyeLotId===dyeLotId&&e.endTime).reduce((a,e)=>a+(e.outWeight||0),0);
}
export function isEntryLocked(id,stage){if(stage==='soft'){const e=State.DB.stageEntries.find(x=>x.id===id);if(!e)return false;return(State.DB.dispatches||[]).some(d=>d.dyeLotId&&d.status==='Approved'&&(State.DB.dyeLots||[]).some(dl=>dl.id===d.dyeLotId&&(dl.sources||[]).some(s=>s.lotId===e.lotId)));}
if(stage==='dispatch'){const d=(State.DB.dispatches||[]).find(x=>x.id===id);return d?.status==='Approved';}
return false;}

const EDIT_REASON_CATS=['Data entry error','Weight measurement correction','Wrong lot selected','Supervisor correction','Admin correction','Other'];


function daysSince(ts){if(!ts)return null;return Math.floor((new Date()-new Date(ts))/86400000);}
function agingColor(days){let t=State.DB.agingThresholds||{yellow:7,red:15};if(days===null||days===undefined)return'var(--mu)';if(days>=t.red)return'var(--re)';if(days>=t.yellow)return'var(--ye)';return'var(--gr)';}
export function agingBadge(days){if(days===null||days===undefined)return'<span style="color:var(--mu)">—</span>';let c=agingColor(days);return'<span style="color:'+c+';font-weight:700">'+days+'d</span>';}







export function dateRange(preset){const now=new Date();const y=now.getFullYear();const m=now.getMonth();const pad=n=>String(n).padStart(2,'0');const fmt=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;const startOfWeek=d=>{const dd=new Date(d);dd.setDate(d.getDate()-d.getDay()+1);return dd;};if(preset==='today'){const t=fmt(now);return{from:t,to:t};}
if(preset==='yesterday'){const d=new Date(now);d.setDate(d.getDate()-1);const t=fmt(d);return{from:t,to:t};}
if(preset==='week'){return{from:fmt(startOfWeek(now)),to:fmt(now)};}
if(preset==='last_week'){const s=startOfWeek(now);s.setDate(s.getDate()-7);const e=new Date(s);e.setDate(e.getDate()+6);return{from:fmt(s),to:fmt(e)};}
if(preset==='month'){return{from:`${y}-${pad(m+1)}-01`,to:fmt(now)};}
if(preset==='last_month'){const lm=m===0?11:m-1;const ly=m===0?y-1:y;const lastDay=new Date(y,m,0).getDate();return{from:`${ly}-${pad(lm+1)}-01`,to:`${ly}-${pad(lm+1)}-${lastDay}`};}
return{from:'2020-01-01',to:fmt(now)};}
export function inRange(ts,from,to){if(!ts)return false;const d=ts.split('T')[0];return(!from||d>=from)&&(!to||d<=to);}
export function hrsBetween(ts1,ts2){if(!ts1||!ts2)return 0;return Math.max(0,(new Date(ts2)-new Date(ts1))/3600000);}
export function fmtHrs(h){h=+h||0;return h>=1?`${h.toFixed(1)}h`:`${(h*60).toFixed(0)}m`;}
export function fmtDuration(ts1,ts2){const h=hrsBetween(ts1,ts2);if(h<0.01)return'—';const days=Math.floor(h/24);const hrs=h%24;return days>0?`${days}d ${hrs.toFixed(1)}h`:`${h.toFixed(1)}h`;}
export const rptState={};
export const lcExpanded={};
export function openModal(id){window.populateSelects();const el=document.getElementById(id);if(!el)return;if(el.classList.contains('modal-overlay')){el.classList.remove('hidden');}
else{el.classList.add('open');}}
export function closeModal(id){const el=document.getElementById(id);if(!el)return;if(el.classList.contains('modal-overlay')){el.classList.add('hidden');}
else{el.classList.remove('open');}
clearAlerts();}
export function parseLotSelectValue(raw){const parts=(raw||'').split('||');return{lotId:parts[0]||'',grade:parts[1]||'',vendor:parts[2]||''};}
export async function apiPost(endpoint,payload){
  try{
    const res=await fetch(WORKER_URL+endpoint,{method:'POST',headers:_postHeaders(),body:JSON.stringify(payload)});
    const data=await res.json();
    // Aug 26 2026 — real, direct, genuine bug found via Priyam's own,
    // direct network-tab screenshot: a real "warn first" response
    // (Dye split, undo, master merge) never includes success:true —
    // only warning:true — since it's a genuine, deliberate pause for
    // confirmation, not a failure. This treated every one of those as
    // a failure, silently, before the real warning ever had a chance
    // to reach the screen.
    if(!res.ok||(!data.success&&!data.warning))return{ok:false,data,error:data.error||'Request failed',networkError:false};
    return{ok:true,data,error:null,networkError:false};
  }catch(e){
    return{ok:false,data:null,error:e.message,networkError:true};
  }
}

// Aug 6 2026 — real, shared fix for the "screen doesn't update until hard
// refresh" pattern, confirmed present in 59 real functions across the
// app. The original Masters fix (Aug 6, earlier same session) patched
// State.DB directly with the known, just-saved value — works cleanly
// when a save's own result tells you exactly what changed. Doesn't work
// for bulk actions (like "Approve All"), where the server only reports
// how many records changed, not which ones or what their new values
// are — nothing concrete to patch with.
//
// Real fix instead of guessing: after ANY save succeeds, actively ask
// the server what's genuinely there right now for the specific table(s)
// that save affects, then render from that real, fresh answer — never
// trusting that the background live-sync connection has already caught
// up by the time the screen redraws. Same real principle behind every
// fix built this session: never trust a number without genuinely
// checking it first.
//
// Confirmed both static-shaped tables (masters, users, lotSummaries —
// objects keyed by ID) and stage-shaped tables (stageEntries, dyeLots,
// etc — arrays) both use `data` as the real response key, verified
// directly from worker.js's own handleGetActiveData — so this one
// helper genuinely works for every real table in the app, not just some.
export async function _refreshAndRender(paths, renderFns) {
  await Promise.all((Array.isArray(paths) ? paths : [paths]).map(async (path) => {
    try {
      const res = await fetch(WORKER_URL + '/api/data/' + path, { headers: _getHeaders() });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      const rawFresh = json.data ?? (json.static ? {} : []);
      // Sep 10 2026 — real, root-cause fix built via direct discussion
      // with Priyam, from his own real, direct observation: an edit
      // genuinely succeeded on the server, but the screen kept showing
      // the old value until a full page reload. The initial page load
      // (core.js's own L2 loader, just above) always normalizes a
      // static, object-shaped path into a real array via
      // Object.values() — this post-save refresh never did the same,
      // so a static path stored as an object (like Dead Stock, once a
      // touched record migrates it to a properly keyed structure)
      // landed here as a raw object instead, silently breaking every
      // array method (.filter, .sort, etc.) the real render functions
      // depend on — the exact reason it looked stuck until reload.
      // lotFlags/dyeLotFlags/entryFlags are deliberately, genuinely
      // kept as real, keyed objects everywhere else in this app (the
      // same 3 exceptions the initial loader above already carves
      // out) — normalizing those into arrays here would break every
      // real lookup by key that depends on them staying objects.
      const _keepAsObject = path === 'lotFlags' || path === 'dyeLotFlags' || path === 'entryFlags';
      const fresh = _keepAsObject ? rawFresh : (Array.isArray(rawFresh) ? rawFresh : (rawFresh && typeof rawFresh === 'object' ? Object.values(rawFresh) : rawFresh));
      // Aug 26 2026 — real, direct, genuine bug found via direct
      // discussion with Priyam, across 3 real, separate places today:
      // this used to completely overwrite State.DB[path] with only
      // the real, active-only list this endpoint actually returns —
      // silently wiping out any real, already-archived record that
      // had genuinely been merged in earlier (e.g. by opening its
      // page, or an earlier export). A real edit on an old, already-
      // archived batch would then correctly succeed on the server, yet
      // that same batch would completely vanish from the screen right
      // after, since the refresh threw away the merged copy that had
      // it. Only merges for real, array-shaped data (which is the
      // only kind that genuinely has an archive) — keeps any existing,
      // real record not present in the fresh list, replaces any real
      // record that is, by its own real id.
      if (Array.isArray(fresh) && Array.isArray(State.DB[path])) {
        const freshIds = new Set(fresh.map(r => r && r.id).filter(Boolean));
        const keptArchived = State.DB[path].filter(r => r && r.id && !freshIds.has(r.id));
        State.DB[path] = [...fresh, ...keptArchived];
      } else {
        State.DB[path] = fresh;
      }
    } catch (e) {
      console.warn('[refresh] Failed to refresh', path, ':', e.message);
    }
  }));
  (Array.isArray(renderFns) ? renderFns : [renderFns]).forEach(fn => { if (typeof fn === 'function') fn(); });
}
export function setAlert(id,msg,cls,opts){const el=document.getElementById(id);if(!el)return;const classPrefix=(opts&&opts.classPrefix)||'alert';el.innerHTML=`<div class="${classPrefix} ${cls}">${msg}</div>`;if(opts&&opts.autoClear){setTimeout(()=>{if(el)el.innerHTML='';},opts.autoClear===true?3000:opts.autoClear);}}
export function clearAlerts(){document.querySelectorAll('[id$="-alert"]').forEach(el=>el.innerHTML='');}



function setupSidebar(){const u=State.currentUser;document.getElementById('su-av').textContent=u.name[0];document.getElementById('su-name').textContent=u.name;document.getElementById('su-role').textContent=u.role.charAt(0).toUpperCase()+u.role.slice(1);const backupBtn=document.getElementById('sb-backup-btn');if(backupBtn)backupBtn.style.display=(u.role==='admin'||u.role==='manager'||u.role==='supervisor')?'':'none';const usersNav=document.getElementById('ni-users');const setupSec=document.getElementById('sb-setup-sec');if(usersNav)usersNav.style.display=u.role==='manager'?'':'none';const wipNav=document.getElementById('ni-wip');if(wipNav)wipNav.style.display=u.role==='worker'?'none':'';setupMobileNav();}

let isOnline=navigator.onLine;
export function updateOnlineStatus(){const wasOnline=isOnline;isOnline=navigator.onLine;const banner=document.getElementById('offline-banner');if(!banner)return;if(!isOnline){banner.textContent='📵 No connection — please reconnect and try again';banner.className='show';}else if(!wasOnline&&isOnline){banner.textContent='✅ Back online';banner.className='show synced';setTimeout(()=>{banner.className='';},3000);}else{banner.className='';}}
const originalSave=save;

function haptic(type='light'){if('vibrate'in navigator){const patterns={light:[10],medium:[30],success:[10,50,10],error:[100,50,100]};navigator.vibrate(patterns[type]||[10]);}}

export function showToast(msg,type){haptic('success');const t=document.getElementById('toast');if(!t)return;const icons={err:'✕',warn:'⚠',info:'ℹ'};const cls={err:'t-err',warn:'t-warn',info:'t-info'};t.className='toast '+(cls[type]||'t-success');const icon=icons[type]||'✓';t.innerHTML='<span style="font-size:1rem">'+icon+'</span><span>'+msg+'</span>';t.classList.add('show');clearTimeout(t._toastTimer);t._toastTimer=setTimeout(()=>t.classList.remove('show'),2400);}
export function setupMobileNav(){const isMobile=window.innerWidth<=760;const topbar=document.getElementById('mob-topbar');if(topbar){topbar.style.display=isMobile?'flex':'none';}
const setupSec=document.getElementById('mob-setup-sec');if(setupSec)setupSec.style.display=(State.currentUser?.role==='manager')?'':'none';}
export function updateMobileNavBadges(){const pend=(State.DB.stageEntries||[]).filter(e=>e.status==='Pending').length
+(State.DB.dyeLots||[]).filter(b=>b.status==='Pending').length
+(State.DB.windEntries||[]).filter(e=>e.status==='Pending').length
+(State.DB.packEntries||[]).filter(e=>e.status==='Pending').length
+(State.DB.dispatches||[]).filter(e=>e.status==='Pending').length;const wipCount=(State.DB.stageEntries||[]).filter(e=>e.status==='InProgress').length
+(State.DB.dyeLots||[]).filter(b=>b.status==='InProgress').length
+(State.DB.windEntries||[]).filter(e=>e.status==='InProgress').length;['pend-badge','pend-badge2'].forEach(id=>{const el=document.getElementById(id);if(el){el.textContent=pend;el.style.display=pend?'flex':'none';}});['wip-badge','wip-badge-sb'].forEach(id=>{const el=document.getElementById(id);if(el){el.textContent=wipCount;el.style.display=wipCount?'flex':'none';}});const mobPend=document.getElementById('mob-pend-badge');if(mobPend){mobPend.textContent=pend;mobPend.style.display=pend?'inline':'none';}
const mobWip=document.getElementById('mob-wip-badge');if(mobWip){mobWip.textContent=wipCount;mobWip.style.display=wipCount?'inline':'none';}
const mbnPend=document.getElementById('mbn-pend-badge');if(mbnPend){mbnPend.textContent=pend;mbnPend.style.display=pend?'inline-flex':'none';}
const mbnWip=document.getElementById('mbn-wip-badge');if(mbnWip){mbnWip.textContent=wipCount;mbnWip.style.display=wipCount?'inline-flex':'none';}}
export function showAlert(msg,title='Notice'){return new Promise(resolve=>{let el=document.getElementById('_sam-overlay');if(!el){el=document.createElement('div');el.id='_sam-overlay';el.className='overlay';el.innerHTML='<div class="modal" style="max-width:440px"><div id="_sam-title" style="font-size:0.95rem;font-weight:800;color:#fff;margin-bottom:10px"></div><div id="_sam-msg" style="font-size:0.82rem;color:var(--mu);line-height:1.6;margin-bottom:20px;white-space:pre-wrap"></div><div class="modal-foot"><button class="btn btn-ghost btn-sm" id="_sam-ok">OK</button></div></div>';document.body.appendChild(el);}document.getElementById('_sam-title').textContent=title;document.getElementById('_sam-msg').textContent=msg;const okBtn=document.getElementById('_sam-ok');el.classList.add('open');const close=()=>{el.classList.remove('open');okBtn.onclick=null;resolve();};okBtn.onclick=close;});}
export function showConfirm(msg,title='Confirm',confirmLabel='Confirm',isDanger=true){return new Promise(resolve=>{let el=document.getElementById('_scm-overlay');if(!el){el=document.createElement('div');el.id='_scm-overlay';el.className='overlay';el.innerHTML='<div class="modal" style="max-width:460px"><div id="_scm-title" style="font-size:0.95rem;font-weight:800;color:#fff;margin-bottom:10px"></div><div id="_scm-msg" style="font-size:0.82rem;color:var(--mu);line-height:1.6;margin-bottom:20px;white-space:pre-wrap"></div><div class="modal-foot"><button class="btn btn-ghost btn-sm" id="_scm-cancel">Cancel</button><button class="btn btn-sm" id="_scm-ok" style="font-weight:700"></button></div></div>';document.body.appendChild(el);}document.getElementById('_scm-title').textContent=title;document.getElementById('_scm-msg').textContent=msg;const okBtn=document.getElementById('_scm-ok');okBtn.textContent=confirmLabel;okBtn.className='btn btn-sm '+(isDanger?'btn-danger':'btn-primary');el.classList.add('open');const close=val=>{el.classList.remove('open');okBtn.onclick=null;document.getElementById('_scm-cancel').onclick=null;resolve(val);};okBtn.onclick=()=>close(true);document.getElementById('_scm-cancel').onclick=()=>close(false);});}

function updateMobileNavActive(id){
  document.querySelectorAll('.mbn-item').forEach(el=>el.classList.remove('active'));
  const directMatch=document.getElementById('mbn-'+id);
  if(directMatch){directMatch.classList.add('active');return;}
  // Pages without a dedicated bottom-nav icon fall under the "More" drawer
  const moreBtn=document.getElementById('mbn-more');
  if(moreBtn)moreBtn.classList.add('active');
}
export const FLAG_COLORS={hold:{emoji:'🔴',label:'Hold',bg:'rgba(239,68,68,0.12)',color:'var(--re)',border:'rgba(239,68,68,0.3)'},warn:{emoji:'🟡',label:'Warning',bg:'rgba(245,158,11,0.12)',color:'var(--ye)',border:'rgba(245,158,11,0.3)'},info:{emoji:'🔵',label:'Info',bg:'rgba(59,130,246,0.12)',color:'var(--bl)',border:'rgba(59,130,246,0.3)'},good:{emoji:'🟢',label:'Premium',bg:'rgba(34,197,94,0.12)',color:'var(--gr)',border:'rgba(34,197,94,0.3)'},};

export const _tableFilters={};
export const _filterTableMap={'sef-':{clearFn:'clearSEFilters',btnId:'sef-clear-btn',ids:['sef-lot','sef-vendor','sef-grade','sef-status']},'dyef-':{clearFn:'clearDyeFilters',btnId:'dyef-clear-btn',ids:['dyef-lotno','dyef-srclot','dyef-srcvendor','dyef-grade-col','dyef-grade','dyef-status']},'dispf-':{clearFn:'clearDispFilters',btnId:'dispf-clear-btn',ids:['dispf-lot','dispf-party','dispf-shade','dispf-grade','dispf-invoice','dispf-status']},'windf-':{clearFn:'clearWindFilters',btnId:'windf-clear-btn',ids:['windf-lot','windf-grade','windf-shade','windf-status']},'packf-':{clearFn:'clearPackFilters',btnId:'packf-clear-btn',ids:['packf-lot','packf-grade','packf-shade','packf-status']},'st-dsf-':{clearFn:'clearDyeStockFilters',btnId:'st-dsf-clear-btn',ids:['st-dsf-l','st-dsf-shade','st-dsf-sl','st-dsf-sv','st-dsf-status']},'dsf-':{clearFn:'clearDeadStockFilters',btnId:'dsf-clear-btn',ids:['dsf-type','dsf-grade','dsf-status']},'elf-':{clearFn:'clearEditLogFilters',btnId:'elf-clear-btn',ids:['elf-stage','elf-by','elf-type']},'rcf-':{clearFn:'clearRecycleFilters',btnId:'rcf-clear-btn',ids:['rcf-rcno','rcf-lot','rcf-shade','rcf-grade','rcf-status']},'st-rmf-':{clearFn:'clearRMStockFilters',btnId:'st-rmf-clear-btn',ids:['st-rmf-l','st-rmf-v','st-rmf-g','st-rmf-s']},'rmf-':{clearFn:'clearRMFilters',btnId:'rmf-clear-btn',ids:['rmf-lot','rmf-vendor','rmf-grade','rmf-status']},'rmrf-':{clearFn:'clearRMReturnFilters',btnId:'rmrf-clear-btn',ids:['rmrf-lot','rmrf-vendor','rmrf-grade','rmrf-status']},};
export const _sortState={rm:{col:null,dir:1},stock:{col:null,dir:1},se:{col:null,dir:1},dye:{col:null,dir:1},disp:{col:null,dir:1},wind:{col:null,dir:1},pack:{col:null,dir:1},el:{col:null,dir:1},rcstock:{col:null,dir:1},rmstock:{col:null,dir:1},dyestock:{col:null,dir:1},};
const THEME_KEY='tc_theme';
export function initTheme(){const saved=localStorage.getItem(THEME_KEY)||'dark';applyTheme(saved,false);}
function toggleTheme(){const isLight=document.body.classList.contains('light-mode');applyTheme(isLight?'dark':'light',true);}
function applyTheme(mode,save){const isLight=mode==='light';document.body.classList.toggle('light-mode',isLight);const label=isLight?'🌙 Dark':'☀ Light';['theme-btn','mob-theme-btn','login-theme-btn'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=label;});if(save)localStorage.setItem(THEME_KEY,mode);}
export const BACKUP_KEY='tcv2_auto_backup';
const BACKUP_META_KEY='tcv2_backup_meta';
export const MAX_BACKUPS=5;
export function getTotalEntries(){return(State.DB.stageEntries||[]).length
+([...(State.DB.dyeBatches||[]),...(State.DB.dyeEntries||[])]).length
+(State.DB.dyeLots||[]).length
+(State.DB.windEntries||[]).length
+(State.DB.packEntries||[]).length
+(State.DB.dispatches||[]).length;}

export function _waitForDBThenLogin(){document.getElementById('login-screen').classList.add('hidden');const _loadDiv=document.createElement('div');_loadDiv.id='_firebase-wait';_loadDiv.style.cssText='position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--bg);z-index:9999';_loadDiv.innerHTML='<div style="font-size:1.5rem;margin-bottom:12px">⏳</div><div style="color:var(--mu);font-size:0.85rem">Connecting to server...</div>';document.body.appendChild(_loadDiv);let _waited=0;const _t=setInterval(()=>{_waited+=300;if(State.firebaseLoaded){clearInterval(_t);const _ld=document.getElementById('_firebase-wait');if(_ld)_ld.remove();onLogin();}else if(_waited>15000){clearInterval(_t);const _ld=document.getElementById('_firebase-wait');if(_ld)_ld.innerHTML='<div style="color:var(--re);font-size:0.85rem;text-align:center;padding:20px">Connection timeout.<br><a href="javascript:location.reload()" style="color:var(--ac)">Reload</a></div>';}},300);}
export function showLoginScreenSafe(){try{if(State.currentUser){document.getElementById('login-screen').classList.add('hidden');if(State.currentUser.role==='worker'){document.getElementById('worker-view').style.display='block';document.getElementById('app').classList.remove('flex');window.renderWorkerView();}else{document.getElementById('app').classList.add('flex');document.getElementById('worker-view').style.display='none';try{setupSidebar();}catch(e){console.warn('setupSidebar:',e);}
try{setupMobileNav();}catch(e){}
try{window.setupRMEditLogTab();}catch(e){}
try{['flow','shade','pack','waste','machine','worker','party'].forEach(t=>{const r=dateRange('month');rptState[t]={from:r.from,to:r.to};});const _dr=dateRange('daily');rptState['daily']={from:_dr.from,to:_dr.to};}catch(e){}
try{window.renderAll();}catch(e){console.warn('renderAll:',e);}}}else{document.getElementById('login-screen').classList.remove('hidden');document.getElementById('app').classList.remove('flex');document.getElementById('worker-view').style.display='none';try{const rem=localStorage.getItem('tc_remember');if(rem){const c=JSON.parse(rem);const uEl=document.getElementById('li-u');const rEl=document.getElementById('remember-me');if(uEl)uEl.value=c.username||'';if(rEl)rEl.checked=true;}}catch(e){}
try{window.renderLoginDemoCards();}catch(e){}}}catch(e){console.error('showLoginScreenSafe error:',e);try{document.getElementById('login-screen').classList.remove('hidden');}catch(e2){}}}
// Inline HTML onclick="" attributes run in global scope and cannot
// import anything — these explicit window bindings are required under
// ES modules (added Stage 2, Jul 10 2026). See .agents/AGENTS.md.
window.closeModal = closeModal;
window.doLogin = doLogin;
window.logout = logout;
window.nav = nav;
window.toggleTheme = toggleTheme;

// Round 2 (Jul 10 2026): these handler names are generated dynamically
// inside pages.js/core.js template-literal HTML strings (table row
// actions, search inputs, etc.) — missed in the first window-binding pass,
// which only scanned index.html static markup. Found via full source scan.
window._loadArchiveWithCache = _loadArchiveWithCache;
// _searchArchive (Jul 12 2026): referenced bare inside renderSearch's HTML-string
// "Search in History" button onclick, same pattern as _loadArchiveWithCache above.
window._searchArchive = _searchArchive;
// _fetchReportSummaries (Jul 12 2026): backs the "All Time" report preset. Calls
// /api/reports/all-time — worker recomputes only if /tc/reportSummaries is stale,
// otherwise returns the cached totals. Stores result at State.DB.reportSummaries.
export async function _fetchReportSummaries(cb) {
  try {
    const res = await fetch(WORKER_URL+'/api/reports/all-time', {headers:_getHeaders()});
    const data = await res.json();
    State.DB.reportSummaries = data.results || null;
  } catch(e) { console.warn('[fetchReportSummaries] failed', e); State.DB.reportSummaries = null; }
  cb && cb();
}

// Aug 26 2026 — real, direct extension built via thorough discussion with
// Priyam: Today/This Week/This Month never checked archive at all before
// this, unlike All Time above, which correctly did. Mirrors that exact
// same function, just passing the real from/to range through to the new
// /api/reports/range endpoint, which reuses the same, already-proven
// snapshot mechanism — frozen days read as-is, today calculated live.
export async function _fetchReportRange(from, to, cb) {
  try {
    const res = await fetch(WORKER_URL+`/api/reports/range?from=${from}&to=${to}`, {headers:_getHeaders()});
    const data = await res.json();
    State.DB.reportSummaries = data.results || null;
  } catch(e) { console.warn('[fetchReportRange] failed', e); State.DB.reportSummaries = null; }
  cb && cb();
}
window._fetchReportSummaries = _fetchReportSummaries;
// _fetchTrueSoftAvailable (Jul 13 2026): backs the Dye Start form's RM lot
// dropdown chain. Fetched once when adding a source row, cached for that
// session — every stage of the Vendor→Grade→Lot cascade, plus the final
// submit check, reads from this same true (active+archive, always-
// verified) data instead of each independently live-calculating from
// State.DB (browser active-only), which is what let lot 04 get over-
// committed in the first place.
export async function _fetchTrueSoftAvailable(cb) {
  try {
    const res = await fetch(WORKER_URL+'/api/soft-available', {headers:_getHeaders()});
    const data = await res.json();
    State._trueSoftAvail = {};
    (data.available||[]).forEach(r => { State._trueSoftAvail[_summaryKey(r.lotId,r.grade,r.vendor)] = r; });
  } catch(e) { console.warn('[trueSoftAvailable] failed', e); State._trueSoftAvail = null; }
  cb && cb();
}
window._fetchTrueSoftAvailable = _fetchTrueSoftAvailable;

// Round 3 (Jul 10 2026, found by Antigravity's review): State itself and
// _tableFilters are referenced bare inside HTML-string handlers (not just
// individual functions). State is `const`, never reassigned — only its
// properties mutate — so a plain window.State = State binding is
// permanently safe and fixes any State.x reference inside an onclick
// string, current or future. _tableFilters is likewise `const`, only ever
// mutated via property assignment, same safety guarantee.
// Sep 10 2026 — real, direct new feature built via a genuinely long,
// careful design discussion with Priyam, establishing one clear rule
// across the whole app: every real action shows a genuine preview of
// its actual effect before committing. Shared by Dead Stock, RM
// Return, Scrap, and Residual Transfer Void — all four are simple
// enough (one entry, no cascade) to reuse the exact same small
// preview modal and confirm flow, rather than building four nearly
// identical ones.
let _pendingSimpleVoid = null;

export async function _openSimpleVoidPreview({ endpoint, body, label, refreshKeys, successMsg, extraRenderFn }) {
  try {
    const { ok, data, error, networkError } = await apiPost(endpoint, { ...body, dryRun: true });
    if (networkError) { showToast('Network error: ' + error, 'err'); return; }
    if (!ok || data.error) { showToast(data.error || error || 'Could not preview', 'err'); return; }
    _pendingSimpleVoid = { endpoint, body, refreshKeys, successMsg, extraRenderFn };
    document.getElementById('simple-void-preview-body').innerHTML = `<div style="font-size:.82rem;">${label(data)}</div>`;
    document.getElementById('simple-void-preview-alert').innerHTML = '';
    openModal('simple-void-preview-modal-overlay');
  } catch (e) { showToast('Network error: ' + e.message, 'err'); }
}

export async function _doSimpleVoidConfirm() {
  const setAlert = msg => { document.getElementById('simple-void-preview-alert').innerHTML = `<div class="alert-err" style="margin-bottom:8px">${msg}</div>`; };
  const pending = _pendingSimpleVoid;
  if (!pending) return;
  const _btn = document.getElementById('simple-void-preview-confirm-btn');
  if (_btn) _btn.disabled = true;
  try {
    const { ok, error, networkError } = await apiPost(pending.endpoint, pending.body);
    if (networkError) throw new Error(error);
    if (!ok) { setAlert(error || 'Could not void entry'); if (_btn) _btn.disabled = false; return; }
    closeModal('simple-void-preview-modal-overlay');
    showToast(pending.successMsg);
    _pendingSimpleVoid = null;
    if (pending.extraRenderFn) pending.extraRenderFn();
    await _refreshAndRender(pending.refreshKeys, window.renderAll);
  } catch (e) { setAlert('Network error — not voided: ' + e.message); if (_btn) _btn.disabled = false; }
}
window._doSimpleVoidConfirm = _doSimpleVoidConfirm;

window.State = State;
// Jul 16 2026 — exposed for tc_smoke_test.js (Playwright browser testing)
// and manual debugging from the browser console. These are pure,
// read-only calculations (no side effects), safe to expose the same way
// window.State already is.
window.getRMBalance = getRMBalance;
window.getSoftBalance = getSoftBalance;
window.getDyeBal = getDyeBal;
window.getWindBal = getWindBal;
window.getPackBal = getPackBal;
window.getTotalDispatched = getTotalDispatched;
window._tableFilters = _tableFilters;
