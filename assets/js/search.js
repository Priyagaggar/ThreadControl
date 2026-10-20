// search.js — global Search page.
// Aug 6 2026 — Phase 1, Step 5 of the module-split plan. Extracted byte-for-
// byte from pages.js. Real inventory: renderSearch + searchNavTo — the
// second one (used as every search result's click-action) was missed in
// Claude's own first pass, caught by Antigravity's independent check.
// buildDyeLotSearch was already correctly moved to shared.js in Step 2 —
// not part of this extraction. makeDyeLotSearch (a different, Wind/Pack-
// shared dropdown widget, confusingly similar name) stays in pages.js —
// not owned by Search, left for a separate cleanup later.

import { State, getSoftBalanceWeight, getRMBalance, getSoftConsumedByDye, fmt, nav, _tableFilters } from './core.js';
import { clearRMFilters, clearDispFilters, clearSEFilters } from './shared.js';
import { renderRMTable } from './rm.js';
import { renderPartyTracker } from './party.js';
import { vtSelectVendor } from './vendor.js';
import { renderStageTable } from './soft.js';
import { renderDyeTable, clearDyeFilters } from './dye.js';
import { renderWindTable, clearWindFilters } from './wind.js';
import { renderPackTable, clearPackFilters } from './pack.js';
import { renderDispatch } from './dispatch.js';

export function renderSearch(){const q=(document.getElementById('global-search-input')?.value||'').trim().toLowerCase();const el=document.getElementById('search-results');if(!el)return;if(!q||q.length<2){el.innerHTML='<div style="text-align:center;padding:60px 20px;color:var(--mu)"><div style="font-size:2rem;margin-bottom:12px">🔎</div><div style="font-size:0.85rem">Type at least 2 characters to search</div></div>';return;}
const results=[];const isLotSearch=/^[0-9]+$/.test(q)||q.startsWith('dye')||q.startsWith('se-');const isDyeLotSearch=q.startsWith('dye');(State.DB.lots||[]).forEach(l=>{if((l.id||'').toLowerCase().includes(q)||(l.vendor||'').toLowerCase().includes(q)||(l.grade||'').toLowerCase().includes(q)){const status=(()=>{const sfWt=getSoftBalanceWeight(l.id,l.grade,l.vendor);const rmBal=getRMBalance(l.id,l.grade,l.vendor);const sentDye=getSoftConsumedByDye(l.id,l.grade,l.vendor);return sentDye>0?'At Dye':sfWt>0?'At Soft':rmBal.units>0?'At RM':'Completed';})();const matchedByVendor=(l.vendor||'').toLowerCase().includes(q)&&!(l.id||'').toLowerCase().includes(q);const filterKey=matchedByVendor?'rmf-vendor':'rmf-lot';const filterVal=matchedByVendor?(l.vendor||''):(l.id||'');results.push({type:'rm',label:'RM Lot',id:l.id,title:l.id,sub:l.vendor+' · '+l.grade,status,color:'var(--cr)',action:`searchNavTo('rm',{'${filterKey}':'${filterVal.replace(/'/g,"\\'")}'})`});}});(State.DB.dyeLots||[]).forEach(d=>{if((d.dyeLotNo||'').toLowerCase().includes(q)||(d.shade||'').toLowerCase().includes(q)){results.push({type:'dye',label:'Dye Lot',id:d.id,title:d.dyeLotNo,sub:(d.shade||'')+(d.grade?' · '+d.grade:''),status:d.status,color:'var(--cd)',action:`searchNavTo('dye',{'dyef-lotno':'${(d.dyeLotNo||'').replace(/'/g,"\'")}'})`});}});const vendors=[...new Set((State.DB.lots||[]).map(l=>l.vendor).filter(Boolean))];vendors.forEach(v=>{if(v.toLowerCase().includes(q)){const count=(State.DB.lots||[]).filter(l=>l.vendor===v).length;results.push({type:'vendor',label:'Vendor',id:'v-'+v,title:v,sub:count+' RM lots',status:'',color:'var(--mu)',action:`searchNavTo('rm',{'rmf-vendor':'${v.replace(/'/g,"\'")}'})`});}});const parties=[...new Set((State.DB.dispatches||[]).map(d=>d.party).filter(Boolean))];parties.forEach(p=>{if(p.toLowerCase().includes(q)){const kg=(State.DB.dispatches||[]).filter(d=>d.party===p&&(d.status==='Approved'||d.status==='Edited-Approved')).reduce((a,d)=>a+(d.weight||0),0);results.push({type:'party',label:'Party',id:'p-'+p,title:p,sub:fmt(kg)+'kg dispatched',status:'',color:'var(--gr)',action:`searchNavTo('party',{'pt-party-filter':'${p.replace(/'/g,"\'")}'})`});}});(State.DB.stageEntries||[]).filter(e=>(e.lotId||'').toLowerCase().includes(q)||(e.vendor||'').toLowerCase().includes(q)||(e.grade||'').toLowerCase().includes(q)).slice(0,8).forEach(e=>{const matchedByVendor=(e.vendor||'').toLowerCase().includes(q)&&!(e.lotId||'').toLowerCase().includes(q);const filterKey=matchedByVendor?'sef-vendor':'sef-lot';const filterVal=matchedByVendor?(e.vendor||''):e.lotId;results.push({type:'soft',label:'Soft Entry',id:e.id,title:'Lot '+e.lotId,sub:(e.vendor||'—')+' · '+e.grade+' · '+e.status,status:e.status,color:'var(--cs)',action:`searchNavTo('stage',{'${filterKey}':'${filterVal.replace(/'/g,"\'")}'})`});});(State.DB.windEntries||[]).filter(e=>(e.dyeLotNo||'').toLowerCase().includes(q)||(e.shade||'').toLowerCase().includes(q)).slice(0,5).forEach(e=>{results.push({type:'wind',label:'Wind Entry',id:e.id,title:e.dyeLotNo||'—',sub:(e.shade||'')+(e.inCones?' · '+e.inCones+'c in':''),status:e.status,color:'var(--cw)',action:`searchNavTo('wind',{'windf-lot':'${(e.dyeLotNo||'').replace(/'/g,"\'")}'})`});});(State.DB.packEntries||[]).filter(e=>(e.dyeLotNo||'').toLowerCase().includes(q)||(e.shade||'').toLowerCase().includes(q)||(e.party||'').toLowerCase().includes(q)).slice(0,5).forEach(e=>{const matchedByParty=(e.party||'').toLowerCase().includes(q)&&!(e.dyeLotNo||'').toLowerCase().includes(q);const filterKey=matchedByParty?'packf-party':'packf-lot';const filterVal=matchedByParty?(e.party||''):(e.dyeLotNo||'');results.push({type:'pack',label:'Pack Entry',id:e.id,title:e.dyeLotNo||'—',sub:(e.shade||'')+(e.bags?' · '+e.bags+'b':'')+' · '+e.status,status:e.status,color:'var(--cp)',action:`searchNavTo('pack',{'${filterKey}':'${filterVal.replace(/'/g,"\'")}'})`});});(State.DB.dispatches||[]).filter(d=>(d.party||'').toLowerCase().includes(q)||(d.dyeLotNo||'').toLowerCase().includes(q)||(d.shade||'').toLowerCase().includes(q)).slice(0,5).forEach(d=>{const matchedByParty=(d.party||'').toLowerCase().includes(q);const filterKey=matchedByParty?'dispf-party':'dispf-lot';const filterVal=matchedByParty?(d.party||''):(d.dyeLotNo||'');results.push({type:'dispatch',label:'Dispatch',id:d.id,title:d.party,sub:(d.dyeLotNo||'')+(d.shade?' · '+d.shade:'')+'  '+fmt(d.bags||0)+'b / '+fmt(d.weight||0)+'kg',status:d.status,color:'var(--gr)',action:`searchNavTo('dispatch',{'${filterKey}':'${filterVal.replace(/'/g,"\'")}'})`});});
  const _archiveSearched=(State._archiveSearchedFor||{})[q];
  // Aug 26 2026 — real, direct fix built via direct discussion with
  // Priyam: the option to also check archive used to only ever appear
  // when the ENTIRE search, across all 8 categories combined, found
  // absolutely nothing — meaning if even one category (say, Wind)
  // found something active, the button never showed at all, even
  // though a different category (say, Dye) genuinely found nothing,
  // with real, older data still sitting in archive. Now always
  // available, every real search, regardless of what active data
  // already found — real, deliberate, never automatic, never running
  // silently in the background, exactly as agreed: only ever checks
  // archive on an explicit, real click.
  const _archiveBtnHtml=!_archiveSearched?'<div style="margin-top:16px;text-align:center"><button class="btn btn-ghost btn-sm" onclick="_searchArchive(\''+q.replace(/'/g,"\\'")+'\',()=>{renderSearch();})" style="font-size:0.8rem">🔍 Also search History (archived records)</button></div>':'<div style="font-size:0.75rem;margin-top:8px;color:var(--mu);text-align:center">History already searched for this — no further results found there</div>';
  if(!results.length){
    el.innerHTML='<div style="text-align:center;padding:60px 20px;color:var(--mu)"><div style="font-size:2rem;margin-bottom:12px">😶</div><div style="font-size:0.85rem">No results found for "'+q+'" in active data</div>'+_archiveBtnHtml+'</div>';
    return;
  }
const groups={};const order=['rm','dye','vendor','party','soft','wind','pack','dispatch'];const groupLabels={rm:'RM Lots',dye:'Dye Lots',vendor:'Vendors',party:'Parties',soft:'Soft Entries',wind:'Wind Entries',pack:'Pack Entries',dispatch:'Dispatches'};results.forEach(r=>{if(!groups[r.type])groups[r.type]=[];groups[r.type].push(r);});el.innerHTML=order.filter(k=>groups[k]).map(k=>`
    <div style="margin-bottom:20px"><div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--mu);margin-bottom:8px;padding:0 4px">${groupLabels[k]} <span style="color:var(--ac)">(${groups[k].length})</span></div>
      ${groups[k].map(r=>`<div onclick="${r.action}"style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--s2);border-radius:8px;margin-bottom:6px;cursor:pointer;border:1px solid var(--b1);transition:all 0.15s"
onmouseover="this.style.borderColor='var(--ac)';this.style.background='var(--s3)'"
onmouseout="this.style.borderColor='var(--b1)';this.style.background='var(--s2)'"><div style="display:flex;align-items:center;gap:12px"><div style="width:6px;height:36px;border-radius:3px;background:${r.color};flex-shrink:0"></div><div><div style="font-weight:700;font-size:0.85rem">${r.title}</div><div style="font-size:0.72rem;color:var(--mu);margin-top:2px">${r.sub}</div></div></div><div style="text-align:right"><div style="font-size:0.62rem;color:var(--mu);background:var(--s1);padding:2px 8px;border-radius:10px">${r.label}</div>${r.status?`<div style="font-size:0.65rem;margin-top:4px;color:${r.status==='Approved'||r.status==='Edited-Approved'?'var(--gr)':r.status==='Pending'?'var(--ye)':r.status==='Void'?'var(--re)':'var(--mu)'}">${r.status}</div>`:''}</div></div>`).join('')}
    </div>
  `).join('')+_archiveBtnHtml;}

export function searchNavTo(page,filters){nav(page,document.getElementById('ni-'+page));setTimeout(()=>{
// Aug 6 2026 — real bug found by Priyam: _tableFilters is one single,
// shared object across every page's filters — searchNavTo only ever
// ADDED new filter keys into it, never cleared what a previous, unrelated
// search had left behind. Searching active, then archive, for a related
// but different term could leave an old filter combined with the new
// one, over-constraining the destination table until manually cleared.
// Fix: clear the destination page's own filters first, using the exact
// same clear functions the app's own "Clear Filters" buttons already use
// — not a new mechanism, just applying the existing one at the right
// moment. party/vendor don't need a dedicated clear: vendor already
// fully overwrites its one value each time (no leftover-object risk),
// and party uses a single filter key, cleared inline below.
if(page==='stage')clearSEFilters();else if(page==='dye')clearDyeFilters();else if(page==='wind')clearWindFilters();else if(page==='pack')clearPackFilters();else if(page==='dispatch')clearDispFilters();else if(page==='rm')clearRMFilters();else if(page==='party'){_tableFilters['pt-party-filter']='';const el=document.getElementById('pt-party-filter');if(el)el.value='';}
Object.entries(filters).forEach(([id,val])=>{const el=document.getElementById(id);if(el)el.value=val;_tableFilters[id]=val;});if(page==='stage')renderStageTable();else if(page==='dye')renderDyeTable();else if(page==='wind')renderWindTable();else if(page==='pack')renderPackTable();else if(page==='dispatch')renderDispatch();else if(page==='rm')renderRMTable();else if(page==='party')renderPartyTracker();else if(page==='vendor'){State.vtSelectedVendor=Object.values(filters)[0];vtSelectVendor();}},200);}

window.renderSearch = renderSearch;
window.searchNavTo = searchNavTo;
