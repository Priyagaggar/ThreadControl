// challan.js — Challan page.
// Aug 6 2026 — Phase 1, Step 6 of the module-split plan. Extracted byte-for-
// byte from pages.js. Real inventory: renderChallan + _renderChallanCore.
// One cross-page reference (openDyeLifecycle, links to the not-yet-split
// Dye Lifecycle page) — imported from pages.js, same as every other
// remaining cross-page link so far.

import { State, fmt, _loadCatalog, _hydrateChallanFilter, _dispatchesForDropdown } from './core.js';
import { openDyeLifecycle } from './pages.js';

export function renderChallan(){
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

export function _renderChallanCore(){const filterBar=document.getElementById('challan-filter-bar');const summaryEl=document.getElementById('challan-summary');const container=document.getElementById('challan-container');if(!container)return;const allDisps=(State.DB.dispatches||[]).filter(d=>d.status==='Approved');const challanMap={};allDisps.forEach(d=>{
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

window.renderChallan = renderChallan;
