// reports.js — Reports: the 8 report types (Flow, Shade, Grade, Pack,
// Waste, Machine, Worker, Daily), their shared router, filters, and
// table-sort helper.
// Aug 26 2026 — Module split effort, planned with Priyam: extracted
// byte-for-byte from pages.js, same real, established pattern as
// every other extraction. Real, complete inventory: 18 functions, all
// genuinely part of the same Reports domain. renderAnDailyLog was
// deliberately left out — despite living physically near these in
// pages.js, it's genuinely an Analytics function (called alongside
// renderComparison/renderTrend/etc), confirmed by checking who
// actually calls it before assuming.

import { State, _fetchReportSummaries, _fetchReportRange, calcMachineTotals, calcWorkerTotals, calcShadeTotals, calcDailyTotals, appr, closeModal, dateRange, fmt, fmtHrs, getTotalDispatched, hrsBetween, inRange, pct, rptState, today } from './core.js';
import { openDyeLifecycle } from './pages.js';

// Aug 26 2026 — real, confirmed edge case: the very first time Reports
// ever renders (before any date-filter button is clicked), rptState was
// pre-set in onLogin() without usesSnapshotData at all, meaning this
// exact page would still silently be archive-blind on its default view.
// This catches that specific case — any tab whose range was set but
// never actually fetched — before the router runs, fetching once and
// re-rendering, same as clicking a filter button would.
function _ensurePendingRangeLoaded(tab){
  const s=rptState[tab];
  if(s&&s.from&&s.to&&s.usesSnapshotData===undefined){
    s.usesSnapshotData='loading';
    _fetchReportRange(s.from,s.to,()=>{s.usesSnapshotData=true;renderReports();});
    return true;
  }
  return false;
}

export function renderReports(){const active=document.querySelector('[id^="rpt-"].tp.active,[id^="rpt-"].tab-panel.active');if(!active)return;const id=active.id;const tabMap={'rpt-flow':'flow','rpt-shade':'shade','rpt-grade':'grade','rpt-pack':'pack','rpt-waste':'waste','rpt-machine':'machine','rpt-worker':'worker','rpt-daily':'daily'};const tab=tabMap[id];if(tab&&_ensurePendingRangeLoaded(tab))return;if(id==='rpt-flow')rptFlow();else if(id==='rpt-shade')rptShade();else if(id==='rpt-grade')rptGrade();else if(id==='rpt-pack')rptPack();else if(id==='rpt-waste')rptWaste();else if(id==='rpt-machine')rptMachine();else if(id==='rpt-worker')rptWorker();else if(id==='rpt-daily')rptDaily();}

export function rptFlow(){const{from,to}=getRptRange('flow');const el=document.getElementById('rpt-flow-c');if(!el)return;
let softE,softIn,softOut,softWaste,softHrs,dyeL,dyeIn,dyeOut,dyeLoss,dyeHrs,windE,windIn,windOut,windWaste,windHrs,packE,packIn,packOut,dispE,dispOut;
if(rptState['flow']?.usesSnapshotData&&State.DB.reportSummaries?.flow){
  // Aug 5 2026 — real gap found: the "All Time" button already fetched this
  // archive-aware data (recomputeReportSummaries, worker.js — merges active+
  // archive for every stage), but this report never read it, unlike Machine/
  // Worker/Daily/Shade which already did. Same fix pattern as those.
  const flow=State.DB.reportSummaries.flow;
  softIn=flow.softIn;softOut=flow.softOut;softWaste=flow.softWaste;softHrs=flow.softHrs;softE={length:flow.softEntriesCount};
  dyeIn=flow.dyeIn;dyeOut=flow.dyeOut;dyeLoss=-flow.dyeGain;dyeHrs=flow.dyeHrs;dyeL={length:flow.dyeLotsCount};
  windIn=flow.windIn;windOut=flow.windOut;windWaste=flow.windWaste;windHrs=flow.windHrs;windE={length:flow.windEntriesCount};
  packIn=flow.packIn;packOut=flow.packOut;packE={length:flow.packEntriesCount};
  dispOut=flow.dispOut;dispE={length:flow.dispatchesCount};
}else{
softE=appr(State.DB.stageEntries||[]).filter(e=>e.stage==='Soft'&&e.endTime&&inRange(e.endTime,from,to));softIn={bags:softE.reduce((a,e)=>a+(e.inUnits||0),0),kg:softE.reduce((a,e)=>a+(e.inWeight||0),0)};softOut={bags:softE.reduce((a,e)=>a+(e.outUnits||0),0),kg:softE.reduce((a,e)=>a+(e.outWeight||0),0)};softWaste={bags:softIn.bags-softOut.bags,kg:softIn.kg-softOut.kg};softHrs=softE.reduce((a,e)=>a+hrsBetween(e.startTime,e.endTime),0);dyeL=appr(State.DB.dyeLots||[]).filter(d=>d.endTime&&inRange(d.endTime,from,to));dyeIn={cones:dyeL.reduce((a,d)=>a+(d.totalInCones||0),0),kg:dyeL.reduce((a,d)=>a+(d.totalInWeight||0),0)};dyeOut={cones:dyeL.reduce((a,d)=>a+(d.outCones||0),0),kg:dyeL.reduce((a,d)=>a+Math.min(d.outWeight||0,d.totalInWeight||d.outWeight||0),0)};dyeLoss=dyeIn.kg-dyeOut.kg;dyeHrs=dyeL.reduce((a,d)=>a+hrsBetween(d.startTime,d.endTime),0);windE=appr(State.DB.windEntries||[]).filter(e=>e.endTime&&inRange(e.endTime,from,to));windIn={cones:windE.reduce((a,e)=>a+(e.inCones||0),0),kg:windE.reduce((a,e)=>a+(e.inWeight||0),0)};windOut={cones:windE.reduce((a,e)=>a+(e.outCones||0),0),kg:windE.reduce((a,e)=>a+(e.outWeight||0),0)};windWaste={cones:windIn.cones-windOut.cones,kg:windIn.kg-windOut.kg};windHrs=windE.reduce((a,e)=>a+hrsBetween(e.startTime,e.endTime),0);packE=appr(State.DB.packEntries||[]).filter(e=>inRange(e.timestamp,from,to));packIn={cones:packE.reduce((a,e)=>a+(e.inCones||0),0)};packOut={bags:packE.reduce((a,e)=>a+(e.bags||0),0),kg:packE.reduce((a,e)=>a+(e.weight||0),0)};dispE=appr(State.DB.dispatches||[]).filter(d=>inRange(d.timestamp,from,to));dispOut={bags:dispE.reduce((a,d)=>a+(d.bags||0),0),kg:dispE.reduce((a,d)=>a+(d.weight||0),0)};
}
const softWastePct=softIn.kg>0?((softWaste.kg/softIn.kg)*100).toFixed(1):0;const windWastePct=windIn.kg>0?((windWaste.kg/windIn.kg)*100).toFixed(1):0;const dyeLossPct=dyeIn.kg>0?((dyeLoss/dyeIn.kg)*100).toFixed(1):0;const kpiBar=(label,val,sub,col)=>`<div style="background:var(--s2);border-radius:10px;padding:12px 16px;flex:1;min-width:120px"><div style="font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--mu)">${label}</div><div style="font-family:monospace;font-size:1.1rem;font-weight:800;color:${col};margin:4px 0">${val}</div><div style="font-size:0.65rem;color:var(--mu)">${sub}</div></div>`;const wasteBar=(pct,col)=>`<div style="display:flex;align-items:center;gap:6px"><div style="flex:1;background:var(--s3);border-radius:3px;height:6px"><div style="width:${Math.min(pct,100)}%;height:100%;background:${col};border-radius:3px"></div></div><span style="font-size:0.68rem;font-weight:700;color:${col};min-width:36px">${pct}%</span></div>`;el.innerHTML=`
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
      ${kpiBar('Soft Output',fmt(softOut.kg)+'kg',softE.length+' entries','var(--cs)')}
      ${kpiBar('Dye Output',fmt(dyeOut.kg)+'kg',dyeL.length+' lots','var(--cd)')}
      ${kpiBar('Wind Output',fmt(windOut.kg)+'kg',windE.length+' entries','var(--cw)')}
      ${kpiBar('Packed',fmt(packOut.kg)+'kg',packOut.bags+'b','var(--cp)')}
      ${kpiBar('Dispatched',fmt(dispOut.kg)+'kg',dispOut.bags+'b','var(--gr)')}
    </div><div style="margin-bottom:16px"><div style="font-size:0.68rem;font-weight:700;color:var(--mu);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">Waste / Gain by Stage</div><div style="display:flex;flex-direction:column;gap:8px"><div style="display:flex;align-items:center;gap:10px"><span style="width:60px;font-size:0.72rem;color:var(--cs)">Soft</span>${wasteBar(softWastePct,'var(--re)')}<span style="font-size:0.68rem;color:var(--mu)">${fmt(softWaste.kg)}kg lost</span></div><div style="display:flex;align-items:center;gap:10px"><span style="width:60px;font-size:0.72rem;color:var(--cd)">Dye</span>${wasteBar(dyeLossPct,'var(--re)')}<span style="font-size:0.68rem;color:var(--mu)">${fmt(dyeLoss)}kg lost</span></div><div style="display:flex;align-items:center;gap:10px"><span style="width:60px;font-size:0.72rem;color:var(--cw)">Wind</span>${wasteBar(windWastePct,'var(--re)')}<span style="font-size:0.68rem;color:var(--mu)">${fmt(windWaste.kg)}kg lost</span></div></div></div>
  `+tblHTML(['Stage','In','Out','Waste / Gain','Proc Hrs','Entries'],[['🧵 Soft',softIn.bags+'b / '+fmt(softIn.kg)+'kg',softOut.bags+'b / '+fmt(softOut.kg)+'kg',softWastePct+'% waste',fmtHrs(softHrs),softE.length],['🎨 Dye',(dyeIn.cones||'?')+'c / '+fmt(dyeIn.kg)+'kg',(dyeOut.cones||'?')+'c / '+fmt(dyeOut.kg)+'kg',fmt(dyeLoss)+'kg lost',fmtHrs(dyeHrs),dyeL.length],['🌀 Wind',(windIn.cones||'?')+'c / '+fmt(windIn.kg)+'kg',(windOut.cones||'?')+'c / '+fmt(windOut.kg)+'kg',windWastePct+'% waste',fmtHrs(windHrs),windE.length],['📦 Pack',(packIn.cones||'?')+'c in',packOut.bags+'b / '+fmt(packOut.kg)+'kg','—','—',packE.length],['🚚 Dispatch','—',dispOut.bags+'b / '+fmt(dispOut.kg)+'kg','—','—',dispE.length],]);}

export function rptMachine(){const{from,to}=getRptRange('machine');const el=document.getElementById('rpt-mach-c');if(!el)return;
let d;
if(rptState['machine']?.usesSnapshotData&&State.DB.reportSummaries?.machine){
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

export function rptWorker(){const{from,to}=getRptRange('worker');const el=document.getElementById('rpt-work-c');if(!el)return;
let d;
if(rptState['worker']?.usesSnapshotData&&State.DB.reportSummaries?.worker){
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

export function rptDaily(){const{from,to}=getRptRange('daily');
let d;
if(rptState['daily']?.usesSnapshotData&&State.DB.reportSummaries?.daily){
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

export function rptShade(){const{from,to}=getRptRange('shade');const el=document.getElementById('rpt-shade-c');if(!el)return;
let shadeMap;
if(rptState['shade']?.usesSnapshotData&&State.DB.reportSummaries?.shade){
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

export function rptGrade(){
  const{from,to}=getRptRange('grade');const el=document.getElementById('rpt-grade-c');if(!el)return;
  let gradeMap;
  if(rptState['grade']?.usesSnapshotData&&State.DB.reportSummaries?.grade){
    gradeMap=State.DB.reportSummaries.grade;
  }else{
  gradeMap={};
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
  }
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

export function rptPack(){const{from,to}=getRptRange('pack');const el=document.getElementById('rpt-pack-c');if(!el)return;const _packFilter=window._packFilter||'all';const _dyeLotFilter=window._packDyeLotFilter||'';const dlSel=document.getElementById('rpt-pack-dyelot');if(dlSel){const allLots=appr(State.DB.dyeLots||[]).filter(d=>d.status==='Approved'||d.status==='Edited-Approved').sort((a,b)=>(a.dyeLotNo||'').localeCompare(b.dyeLotNo||''));const current=dlSel.value;dlSel.innerHTML='<option value="">All Dye Lots</option>'+allLots.map(d=>`<option value="${d.id}">${d.dyeLotNo}${d.shade?' — '+d.shade:''}</option>`).join('');if(current)dlSel.value=current;}
let rows;
if(rptState['pack']?.usesSnapshotData&&State.DB.reportSummaries?.pack){
  rows=State.DB.reportSummaries.pack.filter(r=>!_dyeLotFilter||r.id===_dyeLotFilter);
}else{
const lots=appr(State.DB.dyeLots||[]).filter(d=>(d.status==='Approved'||d.status==='Edited-Approved')&&(!_dyeLotFilter||d.id===_dyeLotFilter));rows=lots.map(d=>{const packE=appr(State.DB.packEntries||[]).filter(e=>e.dyeLotId===d.id&&inRange(e.timestamp,from,to));if(!packE.length)return null;const windEntries=appr(State.DB.windEntries||[]).filter(e=>e.dyeLotId===d.id&&e.endTime);const windOutKg=windEntries.reduce((a,e)=>a+(e.outWeight||0),0);if(!windOutKg)return null;const packKg=packE.reduce((a,e)=>a+(e.weight||0),0);const packBags=packE.reduce((a,e)=>a+(e.bags||0),0);const packBal=windOutKg-packKg;if(packBal>1)return null;const gainLoss=packKg-windOutKg;const pct=windOutKg>0?((gainLoss/windOutKg)*100).toFixed(1):0;return{id:d.id,dyeLotNo:d.dyeLotNo,shade:d.shade,grade:(d.sources||[])[0]?.grade||'—',windKg:windOutKg,packKg,packBags,gainLoss,pct:parseFloat(pct)};}).filter(Boolean);
}
let filtered=rows;if(_packFilter==='gain')filtered=rows.filter(r=>r.gainLoss>0);else if(_packFilter==='loss')filtered=rows.filter(r=>r.gainLoss<0);else if(_packFilter==='0-2')filtered=rows.filter(r=>Math.abs(r.pct)>0&&Math.abs(r.pct)<=2);else if(_packFilter==='2-5')filtered=rows.filter(r=>Math.abs(r.pct)>2&&Math.abs(r.pct)<=5);else if(_packFilter==='5-10')filtered=rows.filter(r=>Math.abs(r.pct)>5&&Math.abs(r.pct)<=10);else if(_packFilter==='10+')filtered=rows.filter(r=>Math.abs(r.pct)>10);filtered.sort((a,b)=>b.pct-a.pct);const gains=rows.filter(r=>r.gainLoss>0).length;const losses=rows.filter(r=>r.gainLoss<0).length;el.innerHTML=`<div style="margin-bottom:14px"><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;align-items:center"><span style="font-size:0.68rem;color:var(--mu);font-weight:700">Type:</span><button class="btn btn-ghost btn-sm" style="${_packFilter==='all'?'background:var(--ac);color:#000':''}" onclick="setPackFilter('all')">All (${rows.length})</button><button class="btn btn-ghost btn-sm" style="${_packFilter==='gain'?'background:var(--gr);color:#fff':''}" onclick="setPackFilter('gain')">🟢 Gain (${gains})</button><button class="btn btn-ghost btn-sm" style="${_packFilter==='loss'?'background:var(--re);color:#fff':''}" onclick="setPackFilter('loss')">🔴 Loss (${losses})</button></div><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><span style="font-size:0.68rem;color:var(--mu);font-weight:700">Range:</span><button class="btn btn-ghost btn-sm" style="${_packFilter==='0-2'?'background:var(--ye);color:#000':''}" onclick="setPackFilter('0-2')">0–2%</button><button class="btn btn-ghost btn-sm" style="${_packFilter==='2-5'?'background:#f97316;color:#fff':''}" onclick="setPackFilter('2-5')">2–5%</button><button class="btn btn-ghost btn-sm" style="${_packFilter==='5-10'?'background:var(--re);color:#fff':''}" onclick="setPackFilter('5-10')">5–10%</button><button class="btn btn-ghost btn-sm" style="${_packFilter==='10+'?'background:var(--re);color:#fff':''}" onclick="setPackFilter('10+')">10%+</button><span style="font-size:0.68rem;color:var(--mu);margin-left:auto">${filtered.length} lots shown</span></div></div>`
+(filtered.length?(()=>{const getRangeLabel=(pct)=>{const abs=Math.abs(pct);if(abs<0.01)return{label:'⚪ Break Even',col:'var(--mu)',order:0};if(abs<=2)return pct>0?{label:'🟢 Gain 0-2%',col:'var(--gr)',order:1}:{label:'🔴 Loss 0-2%',col:'var(--re)',order:5};if(abs<=5)return pct>0?{label:'🟢 Gain 2-5%',col:'var(--gr)',order:2}:{label:'🟠 Loss 2-5%',col:'#f97316',order:6};if(abs<=10)return pct>0?{label:'🟢 Gain 5-10%',col:'var(--gr)',order:3}:{label:'🔴 Loss 5-10%',col:'var(--re)',order:7};return pct>0?{label:'🟢 Gain 10%+',col:'var(--gr)',order:4}:{label:'🔴 Loss 10%+',col:'var(--re)',order:8};};const groups={};filtered.forEach(r=>{const g=getRangeLabel(r.pct);if(!groups[g.label])groups[g.label]={...g,rows:[]};groups[g.label].rows.push(r);});return Object.values(groups).sort((a,b)=>a.order-b.order).map(g=>`
      <div style="margin-bottom:16px"><div style="font-size:0.72rem;font-weight:800;color:${g.col};padding:6px 0;border-bottom:2px solid ${g.col};margin-bottom:8px">${g.label} (${g.rows.length} lots)</div><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:0.73rem"><thead><tr style="background:var(--s2)"><th style="padding:8px;text-align:left">Dye Lot</th><th style="padding:8px">Shade</th><th style="padding:8px">Grade</th><th style="padding:8px;text-align:right">Wind Out (kg)</th><th style="padding:8px;text-align:right">Pack Out (kg)</th><th style="padding:8px;text-align:right">Bags</th><th style="padding:8px;text-align:right">Gain/Loss (kg)</th><th style="padding:8px;text-align:right">%</th></tr></thead><tbody>
          ${g.rows.map(r=>`<tr style="border-bottom:1px solid var(--b1)"><td style="padding:8px"><span onclick="openDyeLifecycle('${r.id}')"style="color:var(--ac);font-weight:700;cursor:pointer;font-family:monospace">${r.dyeLotNo}</span></td><td style="padding:8px;color:var(--cd)">${r.shade}</td><td style="padding:8px;color:var(--mu);font-size:0.72rem">${r.grade}</td><td style="padding:8px;text-align:right;font-family:monospace">${fmt(r.windKg)}</td><td style="padding:8px;text-align:right;font-family:monospace;font-weight:700">${fmt(r.packKg)}</td><td style="padding:8px;text-align:right">${r.packBags}</td><td style="padding:8px;text-align:right;font-family:monospace;font-weight:700;color:${r.gainLoss>=0?'var(--gr)':'var(--re)'}">${r.gainLoss>=0?'+':''}${fmt(r.gainLoss)}</td><td style="padding:8px;text-align:right;font-weight:700;color:${r.pct>=0?'var(--gr)':'var(--re)'}">${r.pct>=0?'+':''}${r.pct}%</td></tr>`).join('')}
          </tbody></table></div></div>`).join('');})():'<div style="padding:20px;color:var(--mu);text-align:center">No completed lots for selected filter</div>');}

export function rptWaste(){const{from,to}=getRptRange('waste');const sumEl=document.getElementById('rpt-waste-summary');const lotsEl=document.getElementById('rpt-waste-lots');if(!sumEl||!lotsEl)return;
let stages,lotRows;
if(rptState['waste']?.usesSnapshotData&&State.DB.reportSummaries?.waste){
  stages=State.DB.reportSummaries.waste.stages;
  lotRows=State.DB.reportSummaries.waste.lotRows;
}else{
const softE=appr(State.DB.stageEntries||[]).filter(e=>e.stage==='Soft'&&e.endTime&&inRange(e.endTime,from,to));const softIn=softE.reduce((a,e)=>a+(e.inWeight||0),0);const softOut=softE.reduce((a,e)=>a+(e.outWeight||0),0);const dyeL=appr(State.DB.dyeLots||[]).filter(d=>d.endTime&&inRange(d.endTime,from,to));const dyeIn=dyeL.reduce((a,d)=>a+(d.totalInWeight||0),0);const dyeOut=dyeL.reduce((a,d)=>a+(d.outWeight||0),0);const windE=appr(State.DB.windEntries||[]).filter(e=>e.endTime&&inRange(e.endTime,from,to));const windIn=windE.reduce((a,e)=>a+(e.inWeight||0),0);const windOut=windE.reduce((a,e)=>a+(e.outWeight||0),0);stages=[{name:'🧵 Soft',col:'var(--cs)',inKg:softIn,outKg:softOut,entries:softE.length},{name:'🎨 Dye',col:'var(--cd)',inKg:dyeIn,outKg:dyeOut,entries:dyeL.length},{name:'🌀 Wind',col:'var(--cw)',inKg:windIn,outKg:windOut,entries:windE.length},];
lotRows=[];const softByLot={};softE.forEach(e=>{if(!softByLot[e.lotId])softByLot[e.lotId]={inKg:0,outKg:0};softByLot[e.lotId].inKg+=e.inWeight||0;softByLot[e.lotId].outKg+=e.outWeight||0;});Object.entries(softByLot).forEach(([lotId,v])=>{const diff=v.outKg-v.inKg;const pct=v.inKg>0?((Math.abs(diff)/v.inKg)*100).toFixed(1):0;lotRows.push({label:lotId,shade:'—',stage:'Soft',inKg:v.inKg,outKg:v.outKg,diff,pct:parseFloat(pct),id:null,type:'rm'});});dyeL.forEach(d=>{const diff=(d.outWeight||0)-(d.totalInWeight||0);const pct=d.totalInWeight>0?((Math.abs(diff)/d.totalInWeight)*100).toFixed(1):0;lotRows.push({label:d.dyeLotNo,shade:d.shade||'',stage:'Dye',inKg:d.totalInWeight||0,outKg:d.outWeight||0,diff,pct:parseFloat(pct),id:d.id,type:'dye'});});const windByDL={};windE.forEach(e=>{if(!windByDL[e.dyeLotId])windByDL[e.dyeLotId]={dyeLotNo:e.dyeLotNo,shade:e.shade,id:e.dyeLotId,inKg:0,outKg:0};windByDL[e.dyeLotId].inKg+=e.inWeight||0;windByDL[e.dyeLotId].outKg+=e.outWeight||0;});Object.values(windByDL).forEach(v=>{const diff=v.outKg-v.inKg;const pct=v.inKg>0?((Math.abs(diff)/v.inKg)*100).toFixed(1):0;lotRows.push({label:v.dyeLotNo,shade:v.shade||'',stage:'Wind',inKg:v.inKg,outKg:v.outKg,diff,pct:parseFloat(pct),id:v.id,type:'dye'});});lotRows.sort((a,b)=>Math.abs(b.diff)-Math.abs(a.diff));
}
sumEl.innerHTML='<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:0.73rem">'
+'<thead><tr style="background:var(--s2)"><th style="padding:8px;text-align:left">Stage</th>'
+'<th style="padding:8px;text-align:right">In kg</th><th style="padding:8px;text-align:right">Out kg</th>'
+'<th style="padding:8px;text-align:right">Diff kg</th><th style="padding:8px;text-align:right">%</th>'
+'<th style="padding:8px">Visual</th><th style="padding:8px;text-align:right">Entries</th>'
+'</tr></thead><tbody>'
+stages.map(s=>{const diff=s.outKg-s.inKg;const pct=s.inKg>0?((Math.abs(diff)/s.inKg)*100).toFixed(1):0;const isGain=diff>=0;const col=isGain?'var(--gr)':'var(--re)';return`<tr style="border-bottom:1px solid var(--b1)"><td style="padding:8px;font-weight:700;color:${s.col}">${s.name}</td><td style="padding:8px;text-align:right;font-family:monospace">${fmt(s.inKg)}</td><td style="padding:8px;text-align:right;font-family:monospace">${fmt(s.outKg)}</td><td style="padding:8px;text-align:right;font-family:monospace;font-weight:700;color:${col}">${isGain?'+':''}${fmt(diff)}</td><td style="padding:8px;text-align:right;font-weight:700;color:${col}">${isGain?'+':''}${pct}%</td><td style="padding:8px"><div style="background:var(--s3);border-radius:3px;height:8px;width:120px"><div style="width:${Math.min(pct,100)}%;height:100%;background:${col};border-radius:3px"></div></div></td><td style="padding:8px;text-align:right;color:var(--mu)">${s.entries}</td></tr>`;}).join('')+'</tbody></table></div>';
const threshold=5;const _wFilter=window._wasteFilter||'issues';const _wStage=window._wasteStage||'all';let filteredLots=lotRows;if(_wFilter==='issues')filteredLots=filteredLots.filter(r=>Math.abs(r.diff)>0.01);else if(_wFilter==='loss')filteredLots=filteredLots.filter(r=>r.diff<-0.01);else if(_wFilter==='gain')filteredLots=filteredLots.filter(r=>r.diff>0.01);else if(_wFilter==='high')filteredLots=filteredLots.filter(r=>Math.abs(r.pct)>=threshold);if(_wStage!=='all')filteredLots=filteredLots.filter(r=>r.stage===_wStage);const filterBar=`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center"><span style="font-size:0.68rem;color:var(--mu);font-weight:700">Filter:</span><button class="btn btn-ghost btn-sm" style="${_wFilter==='issues'?'background:var(--ac);color:#000':''}" onclick="setWasteFilter('issues')">⚠ Issues</button><button class="btn btn-ghost btn-sm" style="${_wFilter==='loss'?'background:var(--re);color:#fff':''}" onclick="setWasteFilter('loss')">🔴 Loss only</button><button class="btn btn-ghost btn-sm" style="${_wFilter==='gain'?'background:var(--gr);color:#fff':''}" onclick="setWasteFilter('gain')">🟢 Gain only</button><button class="btn btn-ghost btn-sm" style="${_wFilter==='high'?'background:var(--ye);color:#000':''}" onclick="setWasteFilter('high')">⚠ High (≥${threshold}%)</button><select class="fs" style="max-width:120px" id="rpt-waste-stage" onchange="setWasteStage(this.value)"><option value="all" ${_wStage==='all'?'selected':''}>All Stages</option><option value="Soft" ${_wStage==='Soft'?'selected':''}>Soft</option><option value="Dye" ${_wStage==='Dye'?'selected':''}>Dye</option><option value="Wind" ${_wStage==='Wind'?'selected':''}>Wind</option></select><span style="font-size:0.68rem;color:var(--mu);margin-left:auto">${filteredLots.length} of ${lotRows.length} lots</span></div>`;lotsEl.innerHTML=filterBar+'<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:0.73rem">'
+'<thead><tr style="background:var(--s2)"><th style="padding:8px;text-align:left">Lot</th>'
+'<th style="padding:8px">Shade</th><th style="padding:8px">Stage</th>'
+'<th style="padding:8px;text-align:right">In kg</th><th style="padding:8px;text-align:right">Out kg</th>'
+'<th style="padding:8px;text-align:right">Diff kg</th><th style="padding:8px;text-align:right">%</th>'
+'</tr></thead><tbody>'
+filteredLots.map(r=>{const isGain=r.diff>=0;const isOutlier=Math.abs(r.pct)>=threshold;const col=isGain?'var(--gr)':'var(--re)';return`<tr style="border-bottom:1px solid var(--b1);${isOutlier?'background:rgba(239,68,68,0.04)':''}"><td style="padding:8px">${r.type==='dye'?`<span onclick="openDyeLifecycle('${r.id}')"style="color:var(--ac);font-weight:700;cursor:pointer;font-family:monospace">${r.label}</span>`:`<span style="font-family:monospace;font-weight:700">${r.label}</span>`}${isOutlier?' <span style="font-size:0.58rem;background:rgba(239,68,68,0.15);color:var(--re);padding:1px 4px;border-radius:3px">⚠ HIGH</span>':''}</td><td style="padding:8px;color:var(--mu);font-size:0.68rem">${r.shade}</td><td style="padding:8px;font-size:0.68rem;color:var(--mu)">${r.stage}</td><td style="padding:8px;text-align:right;font-family:monospace">${fmt(r.inKg)}</td><td style="padding:8px;text-align:right;font-family:monospace">${fmt(r.outKg)}</td><td style="padding:8px;text-align:right;font-family:monospace;font-weight:700;color:${col}">${isGain?'+':''}${fmt(r.diff)}</td><td style="padding:8px;text-align:right;font-weight:700;color:${col}">${isGain?'+':''}${r.pct}%</td></tr>`;}).join('')+'</tbody></table></div>';}

export function setRptFilter(tab,preset,el){
  if(preset==='all'){
    _fetchReportSummaries(()=>{
      rptState[tab]={from:'2020-01-01',to:new Date().toISOString().slice(0,10),usesSnapshotData:true};
      const fromEl=document.getElementById(`rpt-${tab}-from`);const toEl=document.getElementById(`rpt-${tab}-to`);
      if(fromEl)fromEl.value=rptState[tab].from;if(toEl)toEl.value=rptState[tab].to;
      if(el){el.closest('.dfb-quick').querySelectorAll('.dfb-qbtn').forEach(b=>b.classList.remove('active'));el.classList.add('active');}
      renderReports();
    });
    return;
  }
const r=dateRange(preset);const fromEl=document.getElementById(`rpt-${tab}-from`);const toEl=document.getElementById(`rpt-${tab}-to`);
_fetchReportRange(r.from,r.to,()=>{
  rptState[tab]={from:r.from,to:r.to,usesSnapshotData:true};
  if(fromEl)fromEl.value=r.from;if(toEl)toEl.value=r.to;
  if(el){el.closest('.dfb-quick').querySelectorAll('.dfb-qbtn').forEach(b=>b.classList.remove('active'));el.classList.add('active');}
  renderReports();
});}

export function getRptRange(tab){const fromEl=document.getElementById(`rpt-${tab}-from`);const toEl=document.getElementById(`rpt-${tab}-to`);const from=fromEl?.value||rptState[tab]?.from||'';const to=toEl?.value||rptState[tab]?.to||'';return{from,to};}

export function setPackFilter(val){window._packFilter=val;rptPack();}

export function clearMachFilter(){window._machStageFilter='all';window._machMachFilter='all';rptMachine();}

export function clearWorkFilter(){window._workStageFilter='all';window._workWorkerFilter='all';rptWorker();}

export function setWasteFilter(val){window._wasteFilter=val;rptWaste();}

export function tblHTML(headers,rows){if(!rows.length)return'<div class="empty empty-text" style="padding:20px">✕ No data for this period — try a wider date range</div>';const ths=headers.map((h,i)=>`<th style="cursor:pointer;user-select:none;white-space:nowrap" onclick="_rptTblSort(this,${i})">${h} <span style="color:var(--mu);font-size:0.6rem">↕</span></th>`).join('');return`<div style="overflow-x:auto"><table class="tbl" data-rpt-sort=""><thead><tr>${ths}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td class="mono">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;}

export function _rptTblSort(thEl,colIdx){const table=thEl.closest('table');if(!table)return;const tbody=table.querySelector('tbody');const trs=[...tbody.querySelectorAll('tr')];const cur=table.dataset.rptSort||'';const dir=(cur===`${colIdx}asc`)?'desc':'asc';table.dataset.rptSort=`${colIdx}${dir}`;trs.sort((a,b)=>{const av=a.cells[colIdx]?.textContent.trim()||'';const bv=b.cells[colIdx]?.textContent.trim()||'';const an=parseFloat(av.replace(/[^0-9.-]/g,'')),bn=parseFloat(bv.replace(/[^0-9.-]/g,''));const cmp=(!isNaN(an)&&!isNaN(bn))?(an-bn):av.localeCompare(bv);return dir==='asc'?cmp:-cmp;});trs.forEach(tr=>tbody.appendChild(tr));table.querySelectorAll('thead th span').forEach((s,i)=>{s.textContent=i===colIdx?(dir==='asc'?' ↑':' ↓'):' ↕';});}

export function exportPDF(){const activeTab=document.querySelector('[id^="rpt-"].tp.active,[id^="rpt-"].tab-panel.active');if(!activeTab){alert('No report tab active');return;}
const tabTitle=document.querySelector('.tab.active')?.textContent?.trim()||'Report';const content=activeTab.innerHTML;const win=window.open('','_blank');win.document.write(`<!DOCTYPE html><html><head><title>ThreadControl — ${tabTitle}</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:#1a1a1a;padding:20px}h1{font-size:16px;font-weight:700;margin-bottom:4px;color:#0f1116}.meta{font-size:10px;color:#666;margin-bottom:16px;padding-bottom:8px;border-bottom:2px solid #f0a500}table{width:100%;border-collapse:collapse;margin-top:10px}th{background:#0f1116;color:#fff;padding:6px 8px;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.05em}td{padding:5px 8px;border-bottom:1px solid #e5e7eb;font-size:10px}tr:nth-child(even) td{background:#f9fafb}.badge{display:inline-block;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:700}.card{border:1px solid #e5e7eb;border-radius:6px;padding:12px;margin-bottom:12px}.card-title{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#666;margin-bottom:8px}@media print{body{padding:10px}button{display:none}}.wc-zero{color:#888;font-weight:400}.wc-low{color:#dc2626;font-weight:700}.wc-mid{color:#dc2626;font-weight:700}.wc-high{color:#dc2626;font-weight:700}</style></head><body><h1>ThreadControl — ${tabTitle}</h1><div class="meta">
      Generated: ${new Date().toLocaleString('en-GB')} &nbsp;|&nbsp; 
      By: ${State.currentUser?.name||'—'} &nbsp;|&nbsp;
      Total Lots: ${State.DB.lots.length} &nbsp;|&nbsp;
      Report Period: All approved data
    </div>
    ${content}
    <scr'+'ipt>window.onload=()=>{window.print();window.close();}</scr'+'ipt><div class="staging-banner">⚠ STAGING — NOT PRODUCTION</div><div class="modal-overlay hidden" id="override-modal-overlay"><div class="modal" style="max-width:560px"><h2>⚡ Admin Override</h2><div id="override-alert"></div><div style="background:var(--s2);border-radius:8px;padding:10px 14px;font-size:0.75rem;margin-bottom:14px;" id="override-entry-info"></div><div class="fgrid" id="override-fields"></div><div class="fgrid" style="margin-top:12px;"><div class="fg"><label class="fl">Override Reason *</label><select class="fs" id="override-reason-cat"><option value="">Select reason...</option><option>Admin correction</option><option>Data entry error</option><option>Wrong lot/grade selected</option><option>Quantity correction</option><option>Weight correction</option><option>Status correction</option><option>Other</option></select></div><div class="fg fg-full"><label class="fl">Reason detail *</label><textarea class="fi" id="override-reason-text" rows="2" placeholder="Explain why this override is needed..."></textarea></div></div><input type="hidden" id="override-entry-id"><input type="hidden" id="override-entry-type"><div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal('override-modal-overlay')">Cancel</button><button class="btn btn-danger" onclick="submitOverride()">⚡ Apply Override</button></div></div>
</div></body></html>`);win.document.close();}

window.rptFlow = rptFlow;
window.rptShade = rptShade;
window.rptGrade = rptGrade;
window.rptPack = rptPack;
window.rptWaste = rptWaste;
window.rptMachine = rptMachine;
window.rptWorker = rptWorker;
window.rptDaily = rptDaily;
window.setRptFilter = setRptFilter;
window.setPackFilter = setPackFilter;
window.exportPDF = exportPDF;
