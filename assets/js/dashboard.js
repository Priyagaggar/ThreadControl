// dashboard.js — Dashboard: the main summary/overview screen, its
// alerts, receive-vs-dispatch chart, party-dispatch widget, and the
// balance-imbalance detector.
// Aug 26 2026 — Module split effort, planned with Priyam: extracted
// byte-for-byte from pages.js, matching the same real, established
// pattern used for every other extraction so far. Real, complete
// inventory: 9 functions, all genuinely part of the same Dashboard
// domain.

import { State, fmt, getPackBal, getRMBalance, getSoftBalanceWeight, nav, pct, today } from './core.js';
import { renderPartyTracker } from './party.js';
import { openDyeLifecycle } from './pages.js';

export function renderDashboard(){const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';const _adminBtnGroup=document.getElementById('admin-btn-group');if(_adminBtnGroup)_adminBtnGroup.style.display=isAdmin?'flex':'none';const _resetBtn=document.getElementById('reset-all-btn');if(_resetBtn)_resetBtn.style.display=isAdmin?'':'none';renderImbalanceWidget();const allLots=State.DB.lots||[],allDyeLots=State.DB.dyeLots||[];const now=new Date(),dsfn=ts=>ts?Math.floor((now-new Date(ts))/86400000):null;const rmBalU=allLots.reduce((a,l)=>{const b=getRMBalance(l.id,l.grade,l.vendor);return a+(b.units||0);},0);const rmBalKg=allLots.reduce((a,l)=>{const b=getRMBalance(l.id,l.grade,l.vendor);return a+(b.weight||0);},0);
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

export function dashAlertNav(dueVal){nav('party',document.getElementById('ni-party'));setTimeout(function(){let el=document.getElementById('pt-due-filter');if(el){el.value=dueVal;renderPartyTracker();}},200);}

export function renderDashAlerts(){const el=document.getElementById('dash-order-alerts');if(!el)return;const _today=today();const _now=new Date();const activeOrders=(State.DB.partyOrders||[]).filter(o=>o.status!=='Completed'&&o.status!=='Cancelled'&&o.due);const overdue=activeOrders.filter(o=>o.due<_today);const dueToday=activeOrders.filter(o=>o.due===_today);const due3=activeOrders.filter(o=>{const days=Math.ceil((new Date(o.due)-_now)/(1000*60*60*24));return days>0&&days<=3;});if(!overdue.length&&!dueToday.length&&!due3.length){el.innerHTML='<div style="display:flex;align-items:center;gap:8px;padding:16px 0;">'+'<span style="font-size:1rem">✅</span>'+'<span style="font-size:0.78rem;color:var(--gr);font-weight:700">All orders on track</span>'+'</div>';return;}
const rows=[];if(overdue.length)rows.push('<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--b1)">'+'<span style="font-size:0.95rem">🔴</span>'+'<span style="font-size:0.78rem;font-weight:700;color:var(--re)">Overdue: '+overdue.length+' order'+(overdue.length>1?'s':'')+'</span>'+'<span style="font-size:0.7rem;color:var(--mu)">'+overdue.slice(0,3).map(o=>o.party).join(', ')+(overdue.length>3?'...':'')+'</span>'+'<button class="btn btn-ghost btn-xs" style="margin-left:auto" onclick="dashAlertNav(\"overdue\")">View →</button>'+'</div>');if(dueToday.length)rows.push('<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--b1)">'+'<span style="font-size:0.95rem">🟠</span>'+'<span style="font-size:0.78rem;font-weight:700;color:#f97316">Due Today: '+dueToday.length+' order'+(dueToday.length>1?'s':'')+'</span>'+'<span style="font-size:0.7rem;color:var(--mu)">'+dueToday.slice(0,3).map(o=>o.party).join(', ')+(dueToday.length>3?'...':'')+'</span>'+'<button class="btn btn-ghost btn-xs" style="margin-left:auto" onclick="dashAlertNav(\"1\")">View →</button>'+'</div>');if(due3.length)rows.push('<div style="display:flex;align-items:center;gap:10px;padding:6px 0">'+'<span style="font-size:0.95rem">🟡</span>'+'<span style="font-size:0.78rem;font-weight:700;color:var(--ye)">Due in 3 days: '+due3.length+' order'+(due3.length>1?'s':'')+'</span>'+'<span style="font-size:0.7rem;color:var(--mu)">'+due3.slice(0,3).map(o=>o.party).join(', ')+(due3.length>3?'...':'')+'</span>'+'<button class="btn btn-ghost btn-xs" style="margin-left:auto" onclick="dashAlertNav(\"4\")">View →</button>'+'</div>');el.innerHTML=rows.join('');}

export function setDashPeriod(p,btn){
  State._dashPeriod=p;
  document.querySelectorAll('.dash-period-btn').forEach(b=>b.classList.remove('active-period'));
  if(btn)btn.classList.add('active-period');
  renderDashRcvVsDis();
  renderDashPartyDispatch();
}

export function _dashDateFilter(ts){if(!ts)return false;const d=new Date(ts);const now=new Date();if(State._dashPeriod==='week'){const w=new Date(now);w.setDate(w.getDate()-7);return d>=w;}
if(State._dashPeriod==='month'){const m=new Date(now);m.setDate(m.getDate()-30);return d>=m;}
return true;}

export function renderDashRcvVsDis(){const el=document.getElementById('dash-rcv-vs-dis');if(!el)return;const allLots=State.DB.lots||[];const allDisps=(State.DB.dispatches||[]).filter(d=>d.status==='Approved');const disFiltered=allDisps.filter(d=>_dashDateFilter(d.timestamp));
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

export function renderDashPartyDispatch(){const el=document.getElementById('dash-party-dispatch');if(!el)return;
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

export function renderImbalanceWidget(){const el=document.getElementById('dashboard-imbalance-widget');if(!el)return;const issues=detectImbalances();if(!issues.length){el.style.display='none';return;}
el.style.display='';el.innerHTML=`<div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);border-radius:10px;padding:12px 16px;margin-bottom:16px;"><div style="font-size:0.78rem;font-weight:700;color:var(--re);margin-bottom:8px;">⚠ ${issues.length} ${issues.length===1?'entry needs':'entries need'} attention</div>
    ${issues.slice(0,3).map(i=>`<div style="font-size:0.72rem;color:var(--mu);padding:3px 0;"><span class="badge b-void"style="font-size:0.58rem;margin-right:6px">${i.stage}</span>${i.id}— ${i.msg}</div>`).join('')}
    ${issues.length>3?`<div style="font-size:0.68rem;color:var(--re);margin-top:4px;">+${issues.length-3}more —<span onclick="nav('editlog',document.getElementById('ni-editlog'))"style="cursor:pointer;text-decoration:underline">view edit log</span></div>`:''}
  </div>`;}

export function detectImbalances(){const issues=[];(State.DB.stageEntries||[]).filter(e=>e.status!=='Voided'&&e.stage==='Soft'&&e.endTime).forEach(e=>{if((e.outWeight||0)>(e.inWeight||0)+0.01)
issues.push({id:e.id,stage:'Soft',msg:`Output ${fmt(e.outWeight)}kg exceeds input ${fmt(e.inWeight)}kg`});});
// Sep 8 2026 — real, direct fix built via direct discussion with
// Priyam: this used to check every lot regardless of status — a
// Voided or Merged (dead) lot's stale, frozen balance could trigger
// a false "needs attention" alert here, sending someone chasing a
// problem that isn't real, just an old, closed-out lot.
(State.DB.lots||[]).filter(l=>l.status!=='Voided'&&l.status!=='Merged').forEach(l=>{const softBal=getSoftBalanceWeight(l.id,l.grade,l.vendor);if(softBal<-0.01)
issues.push({id:l.id,stage:'Soft',msg:`Lot ${l.id} soft balance negative: ${fmt(softBal)}kg`});});(State.DB.windEntries||[]).filter(e=>e.status!=='Voided'&&e.outWeight).forEach(e=>{if((e.outWeight||0)>(e.inWeight||0)+0.01)
issues.push({id:e.id,stage:'Wind',msg:`Output ${fmt(e.outWeight)}kg exceeds input ${fmt(e.inWeight)}kg`});});(State.DB.dyeLots||[]).filter(d=>d.status==='Approved'||d.status==='Edited-Approved').forEach(d=>{const packBal=getPackBal(d.id);if(packBal.weight<-0.01)
issues.push({id:d.dyeLotNo,stage:'Pack',msg:`${d.dyeLotNo} pack balance negative: ${fmt(packBal.weight)}kg`});});return issues;}

window.setDashPeriod = setDashPeriod;
window.dashAlertNav = dashAlertNav;
