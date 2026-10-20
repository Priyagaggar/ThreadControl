// party.js — Party Tracker page.
// Aug 6 2026 — Phase 1, Step 9 of the module-split plan. Extracted byte-for-
// byte from pages.js. Real inventory: renderPartyTracker,
// _renderPartyTrackerCore, getOrderFulfilled, updateOrderStatuses. Three
// cross-page references — openDyeLifecycle, openLinkOrder,
// openPartyOrderModal (all still in pages.js) — imported below. Note:
// search.js already imported renderPartyTracker FROM pages.js (used by
// searchNavTo for the 'party' destination) — that import needs updating
// to come from party.js directly now, since pages.js merely importing a
// name doesn't automatically re-export it to other files.

import { State, _dyeLotsForDropdown, _hydrateDyeLot, fmt, fmtTS, _refreshAndRender, apiPost, closeModal, nav, openModal, save, setAlert, showToast, today, _openSimpleVoidPreview } from './core.js';
import { openDyeLifecycle, renderAll } from './pages.js';

export function renderPartyTracker(){
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

export function _renderPartyTrackerCore(){
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
const _ptDisps=(State.DB.dispatches||[]).filter(d=>(d.status==='Approved'||d.status==='Edited-Approved')&&(!selectedParty||d.party===selectedParty));
const _ptDyeLots=[...new Set([..._ptDisps.map(d=>d.dyeLotNo),..._dyeLotsForDropdown().map(d=>d.dyeLotNo)].filter(Boolean))].sort();
if(filterBar){filterBar.innerHTML=`<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 0 14px 0;border-bottom:1px solid var(--b1);margin-bottom:16px;"><select id="pt-party-filter" class="fs" style="flex:1;min-width:150px;max-width:240px" onchange="renderPartyTracker()"><option value="">— Select Party —</option>${parties.map(p=>`<option value="${p}"${p===selectedParty?' selected':''}>${p}</option>`).join('')}</select><select id="pt-dylot-filter" class="fs" style="min-width:110px;max-width:160px" onchange="renderPartyTracker()"><option value="">All Lots</option>${_ptDyeLots.map(l=>`<option value="${l}"${l===selectedDyeLot?' selected':''}>${l}</option>`).join('')}</select><select id="pt-status-filter" class="fs" style="min-width:100px;max-width:140px" onchange="renderPartyTracker()"><option value="">All Status</option><option value="Open" ${selectedStatus==='Open'?'selected':''}>Open</option><option value="Partial" ${selectedStatus==='Partial'?'selected':''}>Partial</option><option value="Completed" ${selectedStatus==='Completed'?'selected':''}>Completed</option><option value="Cancelled" ${selectedStatus==='Cancelled'?'selected':''}>Cancelled</option><option value="Unlinked" ${selectedStatus==='Unlinked'?'selected':''}>Unlinked</option></select><select id="pt-due-filter" class="fs" style="min-width:100px;max-width:130px" onchange="renderPartyTracker()"><option value="">Any Due</option><option value="overdue" ${selectedDue==='overdue'?'selected':''}>Overdue</option><option value="1" ${selectedDue==='1'?'selected':''}>Due Today</option><option value="2" ${selectedDue==='2'?'selected':''}>Due in 1d</option><option value="3" ${selectedDue==='3'?'selected':''}>Due in 2d</option><option value="4" ${selectedDue==='4'?'selected':''}>Due in 3d</option></select><select id="pt-daysopen-filter" class="fs" style="min-width:110px;max-width:140px" onchange="renderPartyTracker()"><option value="">Any Duration</option><option value="7" ${selectedDaysOpen==='7'?'selected':''}>7+ days</option><option value="15" ${selectedDaysOpen==='15'?'selected':''}>15+ days</option><option value="30" ${selectedDaysOpen==='30'?'selected':''}>30+ days</option><option value="60" ${selectedDaysOpen==='60'?'selected':''}>60+ days</option></select>${selectedParty||selectedDyeLot||selectedStatus||selectedDue||selectedDaysOpen?`<button class="btn btn-ghost btn-sm" onclick="['pt-party-filter','pt-dylot-filter','pt-status-filter','pt-due-filter','pt-daysopen-filter'].forEach(function(id){let el=document.getElementById(id);if(el)el.value='';});renderPartyTracker()">✕ Clear</button>`:''}</div>`;}
if(!selectedParty&&!selectedStatus&&!selectedDue&&!selectedDaysOpen&&!selectedDyeLot){const _se=document.getElementById('pt-summary');if(_se)_se.innerHTML='';container.innerHTML='<div class="empty"><div class="empty-icon">🏢</div><div class="empty-text">Select a party or use filters to view orders</div></div>';return;}
const now_pt=new Date();
const filteredParties=(selectedParty?parties.filter(p=>p===selectedParty):parties).filter(party=>{
const pOrders=(State.DB.partyOrders||[]).filter(o=>o.party===party);
const pDisps=(State.DB.dispatches||[]).filter(d=>d.party===party&&(d.status==='Approved'||d.status==='Edited-Approved'));
if(selectedDyeLot&&!pDisps.some(d=>d.dyeLotNo===selectedDyeLot))return false;
if(selectedStatus==='Unlinked')return pDisps.some(d=>!d.orderId);
if(selectedStatus&&!pOrders.some(o=>o.status===selectedStatus))return false;
if(selectedDue){const activeOrds=pOrders.filter(o=>o.status!=='Completed'&&o.status!=='Cancelled'&&o.due);if(selectedDue==='overdue'){if(!activeOrds.some(o=>new Date(o.due)<now_pt))return false;}else{const days=parseInt(selectedDue);if(!activeOrds.some(o=>{const d=Math.ceil((new Date(o.due)-now_pt)/(1000*60*60*24));return d>=0&&d<days;}))return false;}}
if(selectedDaysOpen){const minDays=parseInt(selectedDaysOpen);const activeOrds=pOrders.filter(o=>o.status!=='Completed'&&o.status!=='Cancelled'&&o.date);if(!activeOrds.some(o=>Math.floor((now_pt-new Date(o.date))/(1000*60*60*24))>=minDays))return false;}
return true;});
const _allOrders=(State.DB.partyOrders||[]).filter(o=>filteredParties.includes(o.party));
if(!window._ptTimelineOpen)window._ptTimelineOpen={};
if(selectedDyeLot){filteredParties.forEach(party=>{const matchingDisps=(State.DB.dispatches||[]).filter(d=>d.party===party&&d.dyeLotNo===selectedDyeLot&&(d.status==='Approved'||d.status==='Edited-Approved'));if(matchingDisps.length){matchingDisps.forEach(d=>{if(d.orderId){window._ptTimelineOpen[`pt-ord-disp-${d.orderId}`]=true;}});}});}
const _allDisps=(State.DB.dispatches||[]).filter(d=>(d.status==='Approved'||d.status==='Edited-Approved')&&filteredParties.includes(d.party)&&(!selectedDyeLot||d.dyeLotNo===selectedDyeLot));
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
const allDisps=(State.DB.dispatches||[]).filter(d=>d.party===party&&(d.status==='Approved'||d.status==='Edited-Approved')&&!d.orderId&&(!selectedDyeLot||d.dyeLotNo===selectedDyeLot)&&(!_ordShades||_ordShades.has((d.shade||'').toLowerCase()))).sort((a,b)=>(b.timestamp||'').localeCompare(a.timestamp||''));
const _allPartyDisps=(State.DB.dispatches||[]).filter(d=>d.party===party&&(d.status==='Approved'||d.status==='Edited-Approved'));
const totalWt=_allPartyDisps.reduce((a,d)=>a+(d.weight||0),0);
const totalBg=_allPartyDisps.reduce((a,d)=>a+(d.bags||0),0);
const lastDisp=[..._allPartyDisps].sort((a,b)=>(b.timestamp||'').localeCompare(a.timestamp||''))[0];
const pendingQty=orders.filter(o=>o.status==='Open'||o.status==='Partial').reduce((a,o)=>a+(o.qtyOrdered-o.qtyFulfilled),0);
const overdueOrders=orders.filter(o=>o.due&&o.status!=='Completed'&&o.status!=='Cancelled'&&new Date(o.due)<new Date());
const activeOrders=orders.filter(o=>o.status==='Open'||o.status==='Partial'||overdueOrders.find(od=>od.id===o.id));
const doneOrders=orders.filter(o=>o.status==='Completed'||o.status==='Cancelled');
const renderOrderRow=o=>{const pct=o.qtyOrdered>0?Math.min(100,(o.qtyFulfilled/o.qtyOrdered*100)):0;const stC=o.status==='Completed'?'var(--gr)':o.status==='Partial'?'var(--ye)':o.status==='Cancelled'?'var(--re)':'var(--mu)';const stLabel=o.status==='Completed'?'✓ Done':o.status==='Partial'?'Partial':o.status==='Cancelled'?'Cancelled':'Open';const now=new Date();const isOverdue=o.due&&o.status!=='Completed'&&o.status!=='Cancelled'&&new Date(o.due)<now;const daysUntilDue=o.due&&o.status!=='Completed'&&o.status!=='Cancelled'?Math.ceil((new Date(o.due)-now)/(1000*60*60*24)):null;const daysSinceCreated=o.date?Math.floor((now-new Date(o.date))/(1000*60*60*24)):null;const dueWarning=()=>{if(!o.due||o.status==='Completed'||o.status==='Cancelled')return'';if(isOverdue)return`<div style="font-size:0.65rem;color:var(--re);font-weight:700;margin-top:3px;">⚠ OVERDUE by ${Math.abs(daysUntilDue)}d</div>`;if(daysUntilDue<=1)return`<div style="font-size:0.65rem;color:#f97316;font-weight:700;margin-top:3px;">⚡ Due tomorrow</div>`;if(daysUntilDue<=3)return`<div style="font-size:0.65rem;color:var(--ye);font-weight:700;margin-top:3px;">⏰ Due in ${daysUntilDue}d</div>`;return`<div style="font-size:0.62rem;color:var(--mu);margin-top:3px;">Due: ${o.due}</div>`;};const ordDisps=(State.DB.dispatches||[]).filter(d=>d.orderId===o.id&&(d.status==='Approved'||d.status==='Edited-Approved'));const dispKey=`pt-ord-disp-${o.id}`;const dispOpen=window._ptTimelineOpen&&window._ptTimelineOpen[dispKey];const dispHTML=ordDisps.length?`<div style="margin-top:10px;border-top:1px solid var(--b1);padding-top:8px;"><div onclick="event.stopPropagation();window._ptTimelineOpen=window._ptTimelineOpen||{};window._ptTimelineOpen['${dispKey}']=!window._ptTimelineOpen['${dispKey}'];renderPartyTracker();" style="font-size:0.68rem;font-weight:700;color:var(--ac);cursor:pointer;display:flex;align-items:center;gap:5px;"><span>${dispOpen?'▼':'▶'}</span><span>Dispatches (${ordDisps.length}) · ${ordDisps.reduce((a,d)=>a+(d.bags||0),0)}b / ${fmt(ordDisps.reduce((a,d)=>a+(d.weight||0),0))}kg</span></div>${dispOpen?`<div style="margin-top:8px;background:var(--s1);border-radius:6px;padding:6px 8px;"><div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:4px;font-size:0.6rem;font-weight:700;color:var(--mu);text-transform:uppercase;padding:3px 0;border-bottom:1px solid var(--b1);margin-bottom:4px;"><span>Dye Lot</span><span>Bags</span><span>Weight</span><span>Challan</span></div>${ordDisps.map(d=>`<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:4px;font-size:0.7rem;padding:4px 0;border-bottom:1px solid var(--b1);"><span style="color:var(--ac);font-weight:700;cursor:pointer;text-decoration:underline" onclick="openDyeLifecycle('${d.dyeLotId||''}')">${d.dyeLotNo||'—'}</span><span>${d.bags||0}b</span><span>${fmt(d.weight||0)}kg</span><span style="color:var(--mu)">${d.invoiceNo||'—'}</span></div>`).join('')}</div>`:''}` + `</div>`:(o.qtyFulfilled>0?`<div style="margin-top:8px;font-size:0.65rem;color:var(--mu);border-top:1px solid var(--b1);padding-top:6px;">No dispatches linked to this order</div>`:'');if(o.status==='Completed'||o.status==='Cancelled'){const bdrC=o.status==='Completed'?'var(--gr)':'var(--re)';return`<div style="padding:10px 12px;background:var(--s2);border-radius:10px;border-left:3px solid ${bdrC};"><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;"><span style="font-weight:700;font-size:0.8rem;color:var(--ac)">${o.id}</span>${o.shade?`<span style="font-size:0.75rem;color:var(--tx)">${o.shade}</span>`:''} ${o.grade?`<span style="font-size:0.65rem;color:var(--mu)">${o.grade}</span>`:''}<span style="font-size:0.65rem;font-weight:700;color:${stC}">${stLabel}</span></div><div style="font-size:0.68rem;color:var(--mu);margin-top:3px;">${o.status==='Completed'?`✓ ${fmt(o.qtyFulfilled)}kg fulfilled`:`✕ Cancelled${o.cancelReason?' — '+o.cancelReason:''}`}</div>${dispHTML}</div>`;}const bdrColor=isOverdue?'var(--re)':pct>0?'var(--ye)':'var(--b1)';return`<div style="padding:12px;background:var(--s2);border-radius:10px;border-left:3px solid ${bdrColor};display:flex;flex-direction:column;gap:0;"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;"><div style="flex:1;min-width:0;"><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;"><span style="font-weight:700;font-size:0.82rem;color:var(--ac)">${o.id}</span>${o.shade?`<span style="font-size:0.78rem;color:var(--tx);font-weight:600">${o.shade}</span>`:''} ${o.grade?`<span style="font-size:0.65rem;color:var(--mu)">${o.grade}</span>`:''}<span style="font-size:0.62rem;font-weight:700;padding:1px 6px;border-radius:4px;background:${isOverdue?'rgba(239,68,68,0.12)':pct>0?'rgba(234,179,8,0.12)':'var(--s3)'};color:${stC}">${stLabel}</span></div>${dueWarning()}${daysSinceCreated!==null?`<div style="font-size:0.62rem;color:var(--mu);margin-top:2px;">Open for ${daysSinceCreated}d</div>`:''}</div>${o.status!=='Completed'&&o.status!=='Cancelled'?`<button class="btn btn-ghost btn-xs" style="color:var(--re);flex-shrink:0" onclick="event.stopPropagation();cancelPartyOrder('${o.id}')">✕</button>`:''}</div><div style="margin-top:10px;"><div style="display:flex;justify-content:space-between;font-size:0.68rem;margin-bottom:5px;"><span style="color:var(--mu)">${fmt(o.qtyFulfilled)}kg done</span><span style="font-weight:700;color:var(--tx)">${fmt(o.qtyOrdered)}kg ordered</span><span style="color:var(--ye)">${fmt(Math.max(0,o.qtyOrdered-o.qtyFulfilled))}kg left</span></div><div style="height:6px;background:var(--s3);border-radius:3px;overflow:hidden;"><div style="height:100%;width:${pct.toFixed(1)}%;background:${pct>=100?'var(--gr)':pct>0?'var(--ye)':'var(--s3)'};border-radius:3px;transition:width 0.3s;"></div></div></div>${dispHTML}</div>`;};
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

export function getOrderFulfilled(orderId){let order=(State.DB.partyOrders||[]).find(function(o){return o.id===orderId;});if(!order)return 0;
const _os=(State.DB.orderSummaries||{})[orderId];if(_os)return _os.qtyFulfilled||0;
const oShade=(order.shade||'').trim().toLowerCase();let disps=(State.DB.dispatches||[]).filter(function(d){const dShade=(d.shade||'').trim().toLowerCase();return d.party===order.party&&dShade===oShade&&(d.status==='Approved'||d.status==='Edited-Approved');}).sort(function(a,b){return(a.timestamp||'').localeCompare(b.timestamp||'');});let orders=(State.DB.partyOrders||[]).filter(function(o){const s=(o.shade||'').trim().toLowerCase();return o.party===order.party&&s===oShade&&o.status!=='Cancelled';}).sort(function(a,b){return(a.date||'').localeCompare(b.date||'');});let rem={};orders.forEach(function(o){rem[o.id]=o.qtyOrdered;});let alloc={};orders.forEach(function(o){alloc[o.id]=0;});disps.forEach(function(d){let wt=d.weight||0;for(let i=0;i<orders.length;i++){if(wt<=0)break;let o=orders[i];let av=rem[o.id]||0;if(av<=0)continue;let tk=Math.min(wt,av);alloc[o.id]=(alloc[o.id]||0)+tk;rem[o.id]-=tk;wt-=tk;}});return alloc[orderId]||0;}

export function updateOrderStatuses(){(State.DB.partyOrders||[]).forEach(function(o){if(o.status==='Cancelled')return;let f=getOrderFulfilled(o.id);o.qtyFulfilled=f;if(f>=o.qtyOrdered-0.01)o.status='Completed';else if(f>0)o.status='Partial';else o.status='Open';});}

// Aug 26 2026 — Module split effort, folded here rather than into a
// new file: these actions genuinely belong alongside Party Tracker's
// own display code, already established here. Extracted byte-for-
// byte from pages.js.

export async function cancelPartyOrder(id){
  // Jul 15 2026 — Item P migration. Was: client mutates status directly then
  // save() through the generic /api/save passthrough — no server check that
  // the order exists or isn't already cancelled. Now: worker.js POST
  // /api/party-order/cancel does both checks server-side.
  if(State.currentUser&&State.currentUser.role!=='admin'&&State.currentUser.role!=='manager'&&State.currentUser.role!=='supervisor'){showToast('No permission','err');return;}
  let reason=prompt('Cancellation reason:');if(!reason||!reason.trim()){showToast('Reason required','err');return;}
  // Sep 10 2026 — real, genuine inconsistency found via a direct,
  // holistic uniformity audit Priyam asked for: every comparable
  // cancel/void action in this app requires a real password
  // confirmation before proceeding — this one, alone, didn't, for no
  // real reason found. Also now shows a real preview before
  // committing, matching Dead Stock/RM Return/Scrap/Residual
  // Transfer Void, which this action is structurally identical to.
  const pwd=prompt('Enter your password to confirm:');
  if(!pwd){showToast('Cancelled — password required','err');return;}
  await _openSimpleVoidPreview({
    endpoint:'/api/party-order/cancel',
    body:{id,reason:reason.trim(),password:pwd,username:State.currentUser?.username,changedBy:State.currentUser.name},
    label:(data)=>`Cancelling order for <strong>${data.party}</strong> — ${data.shade}, ${fmt(data.qty)}kg. This cannot be undone.`,
    refreshKeys:['partyOrders'],
    successMsg:'Order cancelled',
    extraRenderFn:renderPartyTracker,
  });
}

export function openPartyOrderModal(preParty){let isSup=State.currentUser&&(State.currentUser.role==='supervisor'||State.currentUser.role==='admin'||State.currentUser.role==='manager');if(!isSup){showToast('Supervisor/Admin only','err');return;}
document.getElementById('po-alert').innerHTML='';document.getElementById('po-qty').value='';document.getElementById('po-shade').value='';document.getElementById('po-notes').value='';document.getElementById('po-date').value=today();document.getElementById('po-due').value='';let parties=[...(State.DB.parties||[])].sort();document.getElementById('po-party').innerHTML='<option value="">Select party...</option>'+parties.map(function(p){return'<option value="'+p+'">'+p+'</option>';}).join('');if(preParty)document.getElementById('po-party').value=preParty;let grades=[...((State.DB.masters||{}).grades||[])].sort();document.getElementById('po-grade').innerHTML='<option value="">Any grade</option>'+grades.map(function(g){return'<option value="'+g+'">'+g+'</option>';}).join('');openModal('party-order-modal-overlay');}

export async function submitPartyOrder(){
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
    if(_poBtn)_poBtn.disabled=false;closeModal('party-order-modal-overlay');showToast('Order '+data.id+' created ✓');await _refreshAndRender(['partyOrders'],renderAll);
  }catch(e){sa('Network error — not saved: '+e.message);if(_poBtn)_poBtn.disabled=false;}
}

export function openLinkOrder(dispId){const d=(State.DB.dispatches||[]).find(x=>x.id===dispId);if(!d){showToast('Dispatch not found','err');return;}
document.getElementById('lo-disp-id').value=dispId;document.getElementById('lo-alert').innerHTML='';document.getElementById('lo-order-detail').textContent='';const shade=(d.shade||'').trim().toLowerCase();const openOrders=(State.DB.partyOrders||[]).filter(o=>o.party===d.party&&(o.shade||'').trim().toLowerCase()===shade&&o.status!=='Cancelled').sort((a,b)=>(a.date||'').localeCompare(b.date||''));const sel=document.getElementById('lo-order-select');sel.innerHTML='<option value="">Select order...</option>'+openOrders.map(o=>`<option value="${o.id}">${o.id} · ${o.shade} · ${fmt(o.qtyOrdered)}kg · ${o.date} [${o.status}]</option>`).join('');sel.onchange=function(){const o=openOrders.find(x=>x.id===sel.value);document.getElementById('lo-order-detail').textContent=o?`Ordered: ${fmt(o.qtyOrdered)}kg · Fulfilled: ${fmt(o.qtyFulfilled||0)}kg · Balance: ${fmt((o.qtyOrdered||0)-(o.qtyFulfilled||0))}kg`:''};if(!openOrders.length)sel.innerHTML=`<option value="">No orders found for ${d.party} + shade ${d.shade}. Create an order in Party Tracker first.</option>`;openModal('link-order-modal-overlay');}

export async function submitLinkOrder(){const dispId=document.getElementById('lo-disp-id').value;const orderId=document.getElementById('lo-order-select').value;if(!orderId){setAlert('lo-alert','Select an order','alert-err');return;}
try{const {ok,error,networkError}=await apiPost('/api/dispatch/link-order',{dispId,orderId,role:State.currentUser?.role});if(networkError)throw new Error(error);if(!ok){setAlert('lo-alert',error||'Could not link order','alert-err');return;}closeModal('link-order-modal-overlay');showToast('Order linked ✓');await _refreshAndRender(['dispatches','partyOrders'],renderAll);}catch(e){setAlert('lo-alert','Network error — '+e.message,'alert-err');}}

export function navToParty(el){const party=el.getAttribute('data-party');if(!party)return;nav('party',document.getElementById('ni-party'));setTimeout(()=>{const s=document.getElementById('pt-party-filter');if(s){s.value=party;renderPartyTracker();}},200);}

export function populatePartySelect(){const sel=document.getElementById('m-disp-party');if(!sel)return;const parties=State.DB.parties||[];sel.innerHTML='<option value="">Select Party</option>'
+parties.map(p=>`<option value="${p}">${p}</option>`).join('');}

export function openPartyFromDyeLot(party,dyeLotNo){nav('party',document.getElementById('ni-party'));setTimeout(function(){const partyFilter=document.getElementById('pt-party-filter');if(partyFilter){partyFilter.value=party;}
const dyeLotFilter=document.getElementById('pt-dylot-filter');if(dyeLotFilter&&dyeLotNo){dyeLotFilter.value=dyeLotNo;}
renderPartyTracker();},150);}

window.cancelPartyOrder = cancelPartyOrder;
window.openPartyOrderModal = openPartyOrderModal;
window.submitPartyOrder = submitPartyOrder;
window.openLinkOrder = openLinkOrder;
window.submitLinkOrder = submitLinkOrder;
window.navToParty = navToParty;
window.openPartyFromDyeLot = openPartyFromDyeLot;
