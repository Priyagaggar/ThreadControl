import {Q,Qadd,Qsub,Qmax0,appr,seMatch,calcLotByKey,calcSoftIn,calcRMReturnedOut,calcRMBalance,calcSoftOut,calcSoftConsumedByDye,calcSoftResidualOut,calcSoftBalanceWeight,calcDyeBal,calcTotalPackedApproved,calcWindBal,calcTotalDispatchedApproved,calcPackBal,calcVendorRatioForDyeLot,calcDyeAllocated,calcWindInAllocated,calcWindOutAllocated,calcPackInAllocated,calcDispatchAllocated,calcDyeBalanceByLot,calcWindBalanceByLot,calcDyeBalAvailable,calcWindBalAvailable,calcPackBalAvailable,calcStageBalanceAvailable,calcSoftConsumedByDyeWIP,calcSoftBalanceWeightAvailable,calcSoftBalanceAvailable,calcDeadStockBalance,calcRecycleBalance} from './shared-balances.js';
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
export function _getHeaders(){return{'Authorization':'Bearer '+(sessionStorage.getItem('tc_token')||'')};}
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
  DB: {masters:{vendors:[],mills:[],grades:[],machines:[],workers:[]},lots:[],stageEntries:[],dyeBatches:[],dispatches:[],users:[],voidLog:[],lotFlags:{},parties:[],deleteRequests:[],dyeLots:[],dyeEntries:[],windEntries:[],packEntries:[],editLog:[],rmEditLog:[],deadStock:[],recycleStock:[],scrapLog:[],residualStock:[],residualLog:[],rmReturnLog:[],partyOrders:[],agingThresholds:{yellow:7,red:15}},
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
        const mergedIdx=new Map(merged.map((e,i)=>[e.id,i]));
        changed.forEach(e=>{
          if(mergedIdx.has(e.id)) merged[mergedIdx.get(e.id)]=e;
          else { merged.push(e); mergedIdx.set(e.id,merged.length-1); }
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
firebase.auth().signInAnonymously().then(()=>{
  _startDataLoad();
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
  try{localStorage.setItem('tc_db_cache',JSON.stringify(State.DB));}catch(e){}
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
const _realKeyFor=(path,record)=>path==='lots'?_lotKey(record):record.id;
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

// Worker-served paths
_WORKER_PATHS.forEach(path=>{
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

  const _doFullFetch=()=>{
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
    _doFullFetch();
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
      const mergedIdx=new Map(merged.map((e,i)=>[e.id,i]));
      changed.forEach(e=>{
        if(mergedIdx.has(e.id)) merged[mergedIdx.get(e.id)]=e;
        else { merged.push(e); mergedIdx.set(e.id,merged.length-1); }
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
            if(path==='lots')console.warn('[L1-Incremental] missing lot keys (temporary diagnostic):',missingIds);
            _doFullFetch();
            return;
          }
          const finalArr=merged.filter(e=>!staleIds.includes(_realKeyFor(path,e)));
          State.DB[path]=finalArr;
          _l1Loaded.add(path);
          console.log('[L1-Incremental] loaded:',path,'→',finalArr.length,'entries (',changed.length,'changed,',staleIds.length,'removed, verified complete)');
          _onL1Ready();
        })
        .catch(err=>{
          console.warn('[L1-Incremental] verification failed ('+err.message+') for',path,'— falling back to full fetch to be safe');
          _doFullFetch();
        });
    })
    .catch(err=>{
      console.warn('[L1-Incremental] fetch failed ('+err.message+') for',path,'— falling back to full fetch');
      _doFullFetch();
    });
});

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

} // end _startDataLoad

}catch(e){console.error('[Firebase] Init failed',e);const sk=document.getElementById('sk-storage');if(sk){sk.textContent='⚠ Cannot connect';sk.style.color='var(--re)';}showLoginScreenSafe();}}
function _applyMigrations(){
  let _migV=false;
  (State.DB.stageEntries||[]).forEach(e=>{if(!e.vendor){const _m=State.DB.lots.filter(l=>l.id===e.lotId&&(l.grade===e.grade||!e.grade));if(_m.length===1&&_m[0].vendor){e.vendor=_m[0].vendor;_migV=true;}}});
  (State.DB.dyeBatches||[]).forEach(b=>{(b.sources||[]).forEach(s=>{if(!s.grade||!s.vendor){const _m=State.DB.lots.filter(l=>l.id===s.lotId&&(b.grade?l.grade===b.grade:true));if(_m.length===1){if(!s.grade)s.grade=_m[0].grade||'';if(!s.vendor)s.vendor=_m[0].vendor||'';_migV=true;}}});});
  if(_migV)console.log('[Firebase] Migration applied');
}
let _layer2Loaded=false;
function _loadLayer2(){
  if(_layer2Loaded)return;
  _layer2Loaded=true;
  const cutoff=new Date();cutoff.setDate(cutoff.getDate()-30);
  const cutoffISO=cutoff.toISOString();
  console.log('[L2] Loading background data...');

  // Load all L2 paths via Worker (Phase 4)
  const _l2AllPaths=['voidLog','editLog','deleteRequests','lotFlags','scrapLog','deadStock','recycleStock','residualLog','residualStock','rmReturnLog'];
  _l2AllPaths.forEach(path=>{
    fetch(WORKER_URL+'/api/data/'+path,{headers:_getHeaders()})
      .then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
      .then(d=>{
        const val=d.data;
        if(path==='lotFlags')State.DB.lotFlags=val||{};
        else{State.DB[path]=Array.isArray(val)?val:(val?Object.values(val):[]);}
        console.log('[L2-Worker] loaded:',path);
        if(State.currentUser){clearTimeout(_renderDebounceTimer);_renderDebounceTimer=setTimeout(()=>{window.renderAll();},300);}
      })
      .catch(err=>{
        console.warn('[L2-Worker] fallback:',path,err.message);
        State.fbDB.ref('/tc/'+path).once('value',snap=>{
          const val=snap.val();
          if(path==='lotFlags')State.DB.lotFlags=val||{};
          else{State.DB[path]=Array.isArray(val)?val:(val?Object.values(val):[]);}
          console.log('[L2-Fallback] loaded:',path);
          if(State.currentUser){clearTimeout(_renderDebounceTimer);_renderDebounceTimer=setTimeout(()=>{window.renderAll();},300);}
        });
      });
  });
}

const _CACHE_KEY = 'tc_archive_cache';
const _CACHE_TS_KEY = 'tc_archive_ts';
const _ARCHIVE_PATHS = ['dyeLots','windEntries','packEntries','dispatches','lots','stageEntries'];
function _getArchiveCache() {
  try {
    const ts = localStorage.getItem(_CACHE_TS_KEY);
    const raw = localStorage.getItem(_CACHE_KEY);
    if (!ts || !raw) return null;
    return { ts, data: JSON.parse(raw) };
  } catch(e) { return null; }
}
function _setArchiveCache(data, ts) {
  try {
    localStorage.setItem(_CACHE_KEY, JSON.stringify(data));
    localStorage.setItem(_CACHE_TS_KEY, ts);
    console.log('[cache] Archive saved to localStorage, ts:', ts);
  } catch(e) { console.warn('[cache] localStorage save failed:', e.message); }
}
function _mergeArchiveIntoDb(cachedData) {
  _ARCHIVE_PATHS.forEach(path => {
    const arr = (cachedData[path] || []).filter(x => x && x.id);
    arr.forEach(x => {
      if (path === 'lots') {
        const existing = (State.DB[path]||[]).find(l => l.id===x.id && l.grade===x.grade && l.vendor===x.vendor);
        if (existing) {
          const newD = (x.deliveries||[]).filter(d => !(existing.deliveries||[]).some(e => e.addedAt===d.addedAt));
          if (newD.length) { existing.deliveries=[...(existing.deliveries||[]),...newD]; existing.units+=x.units||0; existing.weight+=x.weight||0; }
        } else State.DB[path] = [...(State.DB[path]||[]), x];
      } else {
        if (!(State.DB[path]||[]).find(e => e.id===x.id)) State.DB[path] = [...(State.DB[path]||[]), x];
      }
    });
  });
  console.log('[cache] Archive loaded from localStorage');
}
function _fetchAndCacheArchive(serverTs, cb) {
  const totalPaths = _ARCHIVE_PATHS.length;
  let done = 0;
  const freshData = {};
  _ARCHIVE_PATHS.forEach(path => {
    State.fbDB.ref('/tc/archive/'+path).once('value', snap => {
      const val = snap.val();
      freshData[path] = (Array.isArray(val) ? val : Object.values(val||{})).filter(x => x && x.id);
      if (++done === totalPaths) {
        _setArchiveCache(freshData, serverTs);
        _mergeArchiveIntoDb(freshData);
        cb && cb();
      }
    }).catch(() => { if (++done === totalPaths) { cb && cb(); } });
  });
}
export function _loadArchiveWithCache(cb) {
  // Get server timestamp
  State.fbDB.ref('/tc/archiveLastUpdated').once('value', snap => {
    const serverTs = snap.val() || '';
    const cached = _getArchiveCache();
    if (cached && cached.ts === serverTs && serverTs !== '') {
      // Cache is valid — use it
      console.log('[cache] Archive cache hit — loading from localStorage');
      _mergeArchiveIntoDb(cached.data);
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
      (arr||[]).forEach(x => { if(!(State.DB[path]||[]).some(e=>e.id===x.id)) State.DB[path]=[...(State.DB[path]||[]),x]; });
    };
    mergeById('dyeLots', r.dyeLots);
    mergeById('stageEntries', r.stageEntries);
    mergeById('windEntries', r.windEntries);
    mergeById('packEntries', r.packEntries);
    mergeById('dispatches', r.dispatches);
    (r.lots||[]).forEach(x => {
      if(!(State.DB.lots||[]).some(l=>l.id===x.id&&l.grade===x.grade&&l.vendor===x.vendor)) State.DB.lots=[...(State.DB.lots||[]),x];
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
  const stubs=(State.DB._lotsCatalog||[]).filter(c=>!real.some(l=>l.id===c.id&&l.grade===c.grade&&l.vendor===c.vendor));
  return[...real,...stubs];
}
export function _dyeLotsForDropdown(){
  const real=State.DB.dyeLots||[];
  const stubs=(State.DB._dyeLotsCatalog||[]).filter(c=>!real.some(d=>d.id===c.id));
  return[...real,...stubs];
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


function getSoftConsumedByDyeWIP(lotId,grade,vendor){return calcSoftConsumedByDyeWIP(State.DB.dyeLots,lotId,grade,vendor);}
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
    const exists=(State.DB.lots||[]).find(x=>x.id===item.id&&x.grade===item.grade&&x.vendor===item.vendor);
    if(!exists){State.DB.lots=State.DB.lots||[];State.DB.lots.push(item);clearTimeout(_renderDebounceTimer);_renderDebounceTimer=setTimeout(()=>{if(State.currentUser){if(State.currentUser.role==='worker'&&typeof window.renderWorkerView==='function')window.renderWorkerView();else window.renderAll();refreshOpenModalAvailability();}},80);}
  },_onListenerError('lots','child_added'));
  State.fbDB.ref('/tc/lots').on('child_changed',snap=>{
    const item=snap.val();if(!item||!item.id)return;
    const idx=(State.DB.lots||[]).findIndex(x=>x.id===item.id&&x.grade===item.grade&&x.vendor===item.vendor);
    if(idx!==-1)State.DB.lots[idx]=item;else State.DB.lots.push(item);
    clearTimeout(_renderDebounceTimer);_renderDebounceTimer=setTimeout(()=>{if(State.currentUser){if(State.currentUser.role==='worker'&&typeof window.renderWorkerView==='function')window.renderWorkerView();else window.renderAll();refreshOpenModalAvailability();}},80);
  },_onListenerError('lots','child_changed'));

  // child_removed listeners — triggered when worker archives an entry
  // Removes from DB memory immediately so UI stays correct without refresh
  const _archiveRemovedPaths=['dyeLots','windEntries','packEntries','dispatches','lots','stageEntries'];
  _archiveRemovedPaths.forEach(path=>{
    State.fbDB.ref('/tc/'+path).on('child_removed',snap=>{
      const item=snap.val();if(!item||!item.id)return;
      const before=(State.DB[path]||[]).length;
      if(path==='lots'){
        // Lots are unique by id+grade+vendor — must use composite key to avoid deleting other combos
        State.DB[path]=(State.DB[path]||[]).filter(x=>!(x.id===item.id&&x.grade===item.grade&&x.vendor===item.vendor));
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
function loadUsersForLogin(){if(!State.fbDB)return;State.fbDB.ref('/tc/users').once('value',snap=>{const users=snap.val();if(users&&Array.isArray(users)){State.DB.users=users;console.log('Users loaded for login:',users.length);}}).catch(e=>console.warn('Could not load users:',e));}
function loadFirebaseData(){console.log('loadFirebaseData() called — delegating to initFirebase flow (no-op)');}
export function _lotKey(lot){
  const g=(lot.grade||'').replace(/[^a-zA-Z0-9]/g,'_');
  const v=(lot.vendor||'').replace(/[^a-zA-Z0-9]/g,'_');
  return lot.id+'__'+g+'__'+v;
}
const _partialTables=['lots','stageEntries','dyeLots','windEntries','packEntries','dispatches','partyOrders','voidLog','editLog','deleteRequests'];
export function save(section, item){
  // Always update local backup
  try{localStorage.setItem('tcv2_backup',JSON.stringify(State.DB));}catch(e){}

  if(!State.firebaseLoaded){_pendingSave=true;console.log('[save] queued — not ready');return;}

  const _token=sessionStorage.getItem('tc_token')||'';
  if(!_token){console.warn('[save] no token — cannot save');_saveFailed(section);return;}

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
function firebaseDelete(section,id){
  if(!id)return;
  const _token=sessionStorage.getItem('tc_token')||'';
  if(!_token){console.warn('[delete] no token — cannot delete');_saveFailed(section);return;}
  fetch(WORKER_URL+'/api/delete',{method:'POST',headers:_postHeaders(),body:JSON.stringify({table:section,id})})
    .then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
    .then(d=>{if(!d.success)throw new Error(d.error||'Delete failed');console.log('[delete-W] ✓',section,id);})
    .catch(err=>{
      console.warn('[delete-W] failed:',err.message);
      _saveFailed(section);
    });
}
function loadLocal(){const d=localStorage.getItem('tcv2')||localStorage.getItem('tcv2_backup');if(d){try{State.DB=JSON.parse(d);}catch(e){}}}
export {Q,Qsub,Qmax0} from './shared-balances.js';
export const fU=n=>+(n||0).toFixed(1);
export const fW=n=>+(n||0).toFixed(2);
export const fmt=v=>(+v||0).toLocaleString('en-IN',{maximumFractionDigits:2});
export function fmtQty(count,kg,label){const hc=count!=null&&count>0;const hk=kg!=null&&kg>0;if(hc&&hk)return count+label+' / '+fmt(kg)+'kg';if(hc)return count+label;if(hk)return fmt(kg)+'kg';return'—';}
export const fmtQ=(q,sep=' / ')=>`${fmt(q.units)}u${sep}${fmt(q.weight)}kg`;
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
export const wcls=v=>+v<=0?'wc-zero':+v>10?'wc-high':+v>5?'wc-mid':'wc-low';

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
  // Waste cell with color-coded class based on percentage — fixes the duplicate-class bug pattern
  const q=wasteQty!=null&&wasteQty>0?wasteQty+unitLabel:'—';
  const w=wasteWeight!=null&&wasteWeight>0?' / '+fmt(wasteWeight)+'kg':'';
  return `<td style="vertical-align:top" class="mono ${wcls(parseFloat(wastePct))}">${q}${w}</td>`;
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
export function _summaryKey(lotId,grade,vendor){return lotId+'__'+(grade||'').replace(/[^a-zA-Z0-9]/g,'_')+'__'+(vendor||'').replace(/[^a-zA-Z0-9]/g,'_');}
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
export function lotsForStage(stage){if(stage==='Soft'){return(State.DB.lots||[]).filter(l=>getRMBalance(l.id,l.grade,l.vendor).units>0);}
if(stage==='Dye'){return(State.DB.lots||[]).filter(l=>getSoftBalance(l.id,l.grade,l.vendor).units>0||getSoftBalance(l.id,l.grade,l.vendor).weight>0);}
return[];}
function lotsInProgress(stage){return State.DB.stageEntries.filter(e=>e.status==='InProgress'&&e.stage===stage);}
export function stageBalance(lotId,stage,grade,vendor){if(!grade||!vendor){const l=getLot(lotId);grade=l.grade;vendor=l.vendor;}
if(stage==='Soft')return getRMBalance(lotId,grade,vendor);if(stage==='Wind')return getDyeBalance(lotId,grade,vendor);if(stage==='Pack')return getWindBalance(lotId,grade,vendor);if(stage==='Dispatch')return getPackBalance(lotId,grade,vendor);return Q(0,0);}
function addDefaultUsers(){if(!State.DB.users)State.DB.users=[];const hasAdmin=State.DB.users.findIndex(u=>u.role==='manager'||u.username==='admin');if(hasAdmin===-1){State.DB.users.unshift({id:'u1',name:'Admin',username:'admin',password:'admin123',role:'manager',stage:'all',active:true});console.warn('No Firebase — using local fallback admin. Real credentials will load when Firebase connects.');}}
function doLogin(){const u=document.getElementById('li-u').value.trim();const p=document.getElementById('li-p').value;const errEl=document.getElementById('lerr');const btn=document.querySelector('.lbtn');if(!u||!p){if(errEl){errEl.style.display='block';errEl.textContent='Enter username and password';}
return;}
if(errEl)errEl.style.display='none';if(btn){btn.textContent='Signing in...';btn.disabled=true;}
fetch(WORKER_URL+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})})
.then(r=>r.json().then(data=>({ok:r.ok,data})))
.then(({ok,data})=>{
  if(ok&&data.success){
    State.currentUser=data.user;window.currentUser=State.currentUser;sessionStorage.setItem('tcv2_session',JSON.stringify(State.currentUser));if(data.token)sessionStorage.setItem('tc_token',data.token);
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
  }
})
.catch(err=>{
  console.error('[Login] Worker request failed:',err);
  if(errEl){errEl.style.display='block';errEl.textContent='Could not reach server — check connection and try again';}
  if(btn){btn.textContent='Sign In →';btn.disabled=false;}
});}
function doLoginFail(errEl,btn){if(!State.firebaseLoaded){if(errEl){errEl.style.display='block';errEl.textContent='Still connecting... please wait a moment and try again.';}}else{if(errEl){errEl.style.display='block';errEl.textContent='Incorrect username or password';}}
if(btn){btn.textContent='Sign In →';btn.disabled=false;}}
export function logout(){State.currentUser=null;window.currentUser=null;sessionStorage.removeItem('tcv2_session');sessionStorage.removeItem('tc_token');localStorage.removeItem('tc_remember');localStorage.removeItem('tcv2');localStorage.removeItem('tcv2_backup');document.getElementById('login-screen').classList.remove('hidden');document.getElementById('worker-view').style.display='none';document.getElementById('app').classList.remove('flex');const tb=document.getElementById('mob-topbar');if(tb)tb.style.display='none';document.getElementById('li-u').value='';document.getElementById('li-p').value='';window.renderLoginDemoCards(true);}
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
export function getDyeBal(dyeLotId){const s=_getDyeLotSummary(dyeLotId);if(s&&s.dyeBalance)return Q(s.dyeBalance.cones||0,s.dyeBalance.kg||0);return calcDyeBal(State.DB.dyeLots,State.DB.windEntries,dyeLotId);}
export function getDyeLotCurrentStage(dyeLotId){const packBal=getPackBal(dyeLotId);const disp=getTotalDispatched(dyeLotId);const packed=getTotalPacked(dyeLotId);const windBal=getWindBal(dyeLotId);const dyeBal=getDyeBal(dyeLotId);const lot=(State.DB.dyeLots||[]).find(d=>d.id===dyeLotId);if(!lot||!(lot.status==='Approved'||lot.status==='Edited-Approved'))return'At Dye';if(packed.weight>0&&packBal.weight<=0&&disp.weight>0)return'Completed';if(packed.weight>0)return'At Pack';if(windBal.weight>0||getWindOutput(dyeLotId)>0)return'At Wind';if(dyeBal>0)return'At Dye';return'At Dye';}
function getDyeLotOutputWeight(dyeLotId){const lot=(State.DB.dyeLots||[]).find(d=>d.id===dyeLotId);return lot&&(lot.status==='Approved'||lot.status==='Edited-Approved')?(lot.outWeight||0):0;}
export function getPackBal(dyeLotId){const s=_getDyeLotSummary(dyeLotId);if(s&&s.packBalance)return{weight:s.packBalance.kg||0,bags:s.packBalance.bags||0};return calcPackBal(State.DB.packEntries,State.DB.dispatches,dyeLotId);}
function getPackConsumed(dyeLotId){return(State.DB.windEntries||[]).filter(e=>e.dyeLotId===dyeLotId&&e.status!=='Rejected'&&e.status!=='Void'&&e.endTime).reduce((a,e)=>a+(e.outWeight||0),0);}
export function getRCStatus(rcId){const rc=(State.DB.recycleStock||[]).find(r=>r.id===rcId);if(!rc)return{status:'Unknown',available:false};const bal=getRecycleBalance(rcId);if(bal<=0)return{status:'Consumed',available:false};const windEntries=(State.DB.windEntries||[]).filter(e=>e.recycleId===rcId&&e.status!=='Void'&&e.status!=='Rejected');const approvedWinds=windEntries.filter(e=>e.status==='Approved'||e.status==='Edited-Approved');const inProgressWind=windEntries.find(e=>e.status==='InProgress');const pendingWind=windEntries.find(e=>e.status==='Pending');if(inProgressWind)return{status:'At Wind (InProgress)',available:false};if(pendingWind)return{status:'At Wind (Pending Approval)',available:false};if(approvedWinds.length>0){const lastWindTime=approvedWinds.reduce((a,e)=>e.approvedAt>a?e.approvedAt:a,'');const softAfterWind=(State.DB.stageEntries||[]).find(e=>e.recycleId===rcId&&e.stage==='Soft'&&(e.status==='Approved'||e.status==='Edited-Approved')&&e.endTime>lastWindTime);if(!softAfterWind){const softInProgress=(State.DB.stageEntries||[]).find(e=>e.recycleId===rcId&&e.stage==='Soft'&&e.status==='InProgress');if(softInProgress)return{status:'At Soft',available:false};return{status:'Wound — Needs Soft',available:false};}
return{status:'Ready for Dye (post-wind)',available:true};}
return{status:'On Steel — Available',available:true};}
export function getRecycleBalance(rcId){return calcRecycleBalance(State.DB.recycleStock,State.DB.dyeLots,State.DB.stageEntries,State.DB.scrapLog,rcId);}
export function getSoftResidualOut(lotId,grade,vendor){return calcSoftResidualOut(State.DB.residualLog,lotId,grade,vendor);}
export function getRMReturnedOut(lotId,grade,vendor){return calcRMReturnedOut(State.DB.rmReturnLog,lotId,grade,vendor);}
export function getSoftBalanceWeight(lotId,grade,vendor){const s=_getLotSummary(lotId,grade,vendor);if(s&&s.softBalance)return s.softBalance.kg||0;return calcSoftBalanceWeight(State.DB.stageEntries,State.DB.lots,State.DB.scrapLog,State.DB.dyeLots,State.DB.residualLog,lotId,grade,vendor);}
export function getSoftConsumedByDye(lotId,grade,vendor){return calcSoftConsumedByDye(State.DB.dyeLots,lotId,grade,vendor);}
export function getTotalDispatched(dyeLotId){const s=_getDyeLotSummary(dyeLotId);if(s&&s.dispatched)return{weight:s.dispatched.kg||0,bags:s.dispatched.bags||0};return calcTotalDispatchedApproved(State.DB.dispatches,dyeLotId,State.DB.dyeLots);}
export function getTotalPacked(dyeLotId){const entries=(State.DB.packEntries||[]).filter(e=>e.dyeLotId===dyeLotId&&e.status!=='Rejected'&&e.status!=='Void'&&e.status!=='Voided'&&!e.voided);return{weight:entries.reduce((a,e)=>a+(e.weight||0),0),bags:entries.reduce((a,e)=>a+(e.bags||0),0),cones:entries.reduce((a,e)=>a+(e.inCones||0),0)};}
function getTotalPackedApproved(dyeLotId){return calcTotalPackedApproved(State.DB.packEntries,dyeLotId);}
function getTotalDispatchedApproved(dyeLotId){return calcTotalDispatchedApproved(State.DB.dispatches,dyeLotId);}
export function getWindBal(dyeLotId){const s=_getDyeLotSummary(dyeLotId);if(s&&s.windBalance)return Q(s.windBalance.cones||0,s.windBalance.kg||0);return calcWindBal(State.DB.windEntries,State.DB.packEntries,dyeLotId);}
function getWindConsumed(dyeLotId){return(State.DB.windEntries||[]).filter(e=>e.dyeLotId===dyeLotId&&e.status!=='Rejected'&&e.status!=='Void').reduce((a,e)=>a+(e.inWeight||0),0);}
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
    if(!res.ok||!data.success)return{ok:false,data,error:data.error||'Request failed',networkError:false};
    return{ok:true,data,error:null,networkError:false};
  }catch(e){
    return{ok:false,data:null,error:e.message,networkError:true};
  }
}
export function setAlert(id,msg,cls,opts){const el=document.getElementById(id);if(!el)return;const classPrefix=(opts&&opts.classPrefix)||'alert';el.innerHTML=`<div class="${classPrefix} ${cls}">${msg}</div>`;if(opts&&opts.autoClear){setTimeout(()=>{if(el)el.innerHTML='';},opts.autoClear===true?3000:opts.autoClear);}}
export function clearAlerts(){document.querySelectorAll('[id$="-alert"]').forEach(el=>el.innerHTML='');}



function setupSidebar(){const u=State.currentUser;document.getElementById('su-av').textContent=u.name[0];document.getElementById('su-name').textContent=u.name;document.getElementById('su-role').textContent=u.role.charAt(0).toUpperCase()+u.role.slice(1);const backupBtn=document.getElementById('sb-backup-btn');if(backupBtn)backupBtn.style.display=(u.role==='admin'||u.role==='manager'||u.role==='supervisor')?'':'none';const usersNav=document.getElementById('ni-users');const setupSec=document.getElementById('sb-setup-sec');if(usersNav)usersNav.style.display=u.role==='manager'?'':'none';const wipNav=document.getElementById('ni-wip');if(wipNav)wipNav.style.display=u.role==='worker'?'none':'';setupMobileNav();}

let isOnline=navigator.onLine;
export function updateOnlineStatus(){const wasOnline=isOnline;isOnline=navigator.onLine;const banner=document.getElementById('offline-banner');if(!banner)return;if(!isOnline){banner.textContent='📵 No connection — please reconnect and try again';banner.className='show';}else if(!wasOnline&&isOnline){banner.textContent='✅ Back online';banner.className='show synced';setTimeout(()=>{banner.className='';},3000);}else{banner.className='';}}
const originalSave=save;
function hideLoading(){const el=document.getElementById('ptr-indicator');if(el)el.classList.remove('loading');}
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
export const _filterTableMap={'sef-':{clearFn:'clearSEFilters',btnId:'sef-clear-btn',ids:['sef-lot','sef-vendor','sef-grade','sef-status']},'dyef-':{clearFn:'clearDyeFilters',btnId:'dyef-clear-btn',ids:['dyef-lotno','dyef-srclot','dyef-srcvendor','dyef-grade-col','dyef-grade','dyef-status']},'dispf-':{clearFn:'clearDispFilters',btnId:'dispf-clear-btn',ids:['dispf-lot','dispf-party','dispf-shade','dispf-grade','dispf-invoice','dispf-status']},'windf-':{clearFn:'clearWindFilters',btnId:'windf-clear-btn',ids:['windf-lot','windf-grade','windf-shade','windf-status']},'packf-':{clearFn:'clearPackFilters',btnId:'packf-clear-btn',ids:['packf-lot','packf-grade','packf-shade','packf-status']},'st-dsf-':{clearFn:'clearDyeStockFilters',btnId:'st-dsf-clear-btn',ids:['st-dsf-l','st-dsf-shade','st-dsf-sl','st-dsf-sv','st-dsf-status']},'dsf-':{clearFn:'clearDeadStockFilters',btnId:'dsf-clear-btn',ids:['dsf-type','dsf-grade','dsf-status']},'elf-':{clearFn:'clearEditLogFilters',btnId:'elf-clear-btn',ids:['elf-stage','elf-by','elf-type']},'rcf-':{clearFn:'clearRecycleFilters',btnId:'rcf-clear-btn',ids:['rcf-rcno','rcf-lot','rcf-shade','rcf-grade','rcf-status']},'st-rmf-':{clearFn:'clearRMStockFilters',btnId:'st-rmf-clear-btn',ids:['st-rmf-l','st-rmf-v','st-rmf-g','st-rmf-s']},'rmf-':{clearFn:'clearRMFilters',btnId:'rmf-clear-btn',ids:['rmf-lot','rmf-vendor','rmf-grade']},};
export const _sortState={rm:{col:null,dir:1},stock:{col:null,dir:1},se:{col:null,dir:1},dye:{col:null,dir:1},disp:{col:null,dir:1},wind:{col:null,dir:1},pack:{col:null,dir:1},el:{col:null,dir:1},rcstock:{col:null,dir:1},rmstock:{col:null,dir:1},dyestock:{col:null,dir:1},};
const THEME_KEY='tc_theme';
export function initTheme(){const saved=localStorage.getItem(THEME_KEY)||'dark';applyTheme(saved,false);}
function toggleTheme(){const isLight=document.body.classList.contains('light-mode');applyTheme(isLight?'dark':'light',true);}
function applyTheme(mode,save){const isLight=mode==='light';document.body.classList.toggle('light-mode',isLight);const label=isLight?'🌙 Dark':'☀ Light';['theme-btn','mob-theme-btn','login-theme-btn'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=label;});if(save)localStorage.setItem(THEME_KEY,mode);}
export const BACKUP_KEY='tcv2_auto_backup';
const BACKUP_META_KEY='tcv2_backup_meta';
export const MAX_BACKUPS=7;
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
