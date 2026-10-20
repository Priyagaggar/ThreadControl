// stockregister.js — Stock Register page (Dead Stock, Recycle Stock,
// Residual Log/Stock, Scrap Log — 5 sub-tabs).
// Aug 6 2026 — Phase 1, Step 14 of the module-split plan. Extracted byte-
// for-byte from pages.js. Real inventory: 7 functions, found via AST
// reachability. Real cross-references: 4 of them (voidDeadStock,
// voidResidualTransfer, voidDyeSplit, voidScrap) initially appeared
// missing from pages.js entirely — turned out to be declared as 'async
// function', not plain 'function', which a naive search missed; found by
// broadening the search rather than assuming they were already gone.
// 6 more newly exported (openDeadStockModal, openEditDeadStock,
// openRMLifecycle, openScrapModal, openEditResidualTransfer,
// addResidualToNewDye); openDyeLifecycle already exported.

import { State, _sortState, fmt, fmtDate, fmtTS, getDeadStockBalance, getDeadStockConesBalance, getRCStatus, getRecycleSteelBal, getRecycleSteelAvail, getRecycleSoftenedAvail, _summaryKey, getSoftBalanceAvailable, getSoftBalanceWeightAvailable, _isLotOnHold, openModal, apiPost, showToast, _refreshAndRender, closeModal, nav, _openSimpleVoidPreview, _doSimpleVoidConfirm } from './core.js';
import { buildColFilter, sortArr, sortTh } from './shared.js';
import { openDyeLifecycle, openRMLifecycle, renderAll } from './pages.js';
import { voidDyeSplit, openDyeStartModal } from './dye.js';

export function showStockRegTab(tab, el){
  const tabs=['dead','recycle','residual','scraplog'];
  tabs.forEach(t=>{
    const panel=document.getElementById('sr-panel-'+t);
    const btn=document.getElementById('sr-tab-'+t);
    if(panel)panel.style.display=t===tab?'':'none';
    if(btn)btn.classList.toggle('active',t===tab);
  });
  // Update add button
  const addBtn=document.getElementById('sr-add-btn');
  if(addBtn){
    if(tab==='dead')addBtn.innerHTML='<button class="btn btn-primary btn-sm" onclick="openDeadStockModal()">+ Add Dead Stock</button>';
    else addBtn.innerHTML='';
  }
  // Render appropriate content
  if(tab==='dead')renderDeadStock();
  else if(tab==='recycle')renderRecycleStock();
  else if(tab==='residual'){renderResidualStock();renderResidualLog();}
  else if(tab==='scraplog')renderScrapLog();
  window._stockRegTab=tab;
}

export function getResidualBalance(rsId){
  const rs=(State.DB.residualStock||[]).find(x=>x.id===rsId);
  if(!rs)return 0;
  // Subtract what's been used in dye lots as residual source — excludes Void/Rejected
  // dye lots (Jul 8 2026 fix: was previously counting voided/rejected dye lots as
  // "used", permanently understating balance — matches getDeadStockBalance/getRecycleBalance)
  const used=(State.DB.dyeLots||[]).filter(d=>d.status!=='Rejected'&&d.status!=='Void'&&d.status!=='Voided').reduce((a,d)=>{
    const s=(d.sources||[]).find(s=>s.residualId===rsId);
    return a+(s?.weight||0);
  },0);
  // Jul 15 2026 — matches calcDeadStockBalance/calcRecycleBalance's scrap
  // deduction. Currently unreachable through the UI (no Scrap button is
  // wired to residual stock — openScrapModal is only ever called with
  // 'dead'/'recycle'), but the formula itself had the same gap recycle
  // balance did before today's fix. Closed for consistency across all 3
  // material types, not because it's actively being hit right now.
  const scrapped=(State.DB.scrapLog||[]).filter(s=>s.entryId===rsId&&s.type==='residual').reduce((a,s)=>a+(s.weight||0),0);
  return Math.max(0,(rs.weight||0)-used-scrapped);
}

export function renderDeadStock(){

  const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';
  const isSup=State.currentUser?.role==='supervisor'||isAdmin;
  const sumEl=document.getElementById('ds-summary');
  if(sumEl){
    const total=(State.DB.deadStock||[]).length;
    const availWt=(State.DB.deadStock||[]).filter(d=>d.status==='Approved').reduce((a,d)=>a+getDeadStockBalance(d.id),0);
    const consumed=(State.DB.deadStock||[]).filter(d=>getDeadStockBalance(d.id)<=0&&d.status==='Approved').length;
    sumEl.innerHTML=`<div style="display:flex;gap:14px;flex-wrap:wrap;font-size:0.78rem;">
      <div style="padding:8px 14px;background:var(--s2);border-radius:8px;border-left:3px solid var(--ac)"><div style="font-size:1.1rem;font-weight:800;color:var(--ac)">${total}</div><div style="color:var(--mu)">Total entries</div></div>
      <div style="padding:8px 14px;background:var(--s2);border-radius:8px;border-left:3px solid var(--gr)"><div style="font-size:1.1rem;font-weight:800;color:var(--gr)">${fmt(availWt)}kg</div><div style="color:var(--mu)">Available</div></div>
      <div style="padding:8px 14px;background:var(--s2);border-radius:8px;border-left:3px solid var(--mu)"><div style="font-size:1.1rem;font-weight:800;color:var(--mu)">${consumed}</div><div style="color:var(--mu)">Fully consumed</div></div>
    </div>`;
    const steelEl=document.getElementById('ds-steel-summary');
    const plasticEl=document.getElementById('ds-plastic-summary');
    const byGrade=(type)=>{
      const entries=(State.DB.deadStock||[]).filter(d=>d.type===type);
      const grades={};
      entries.forEach(d=>{const bal=getDeadStockBalance(d.id);if(bal>0){grades[d.grade]=(grades[d.grade]||0)+bal;}});
      const keys=Object.keys(grades);
      if(!keys.length)return'<div style="color:var(--mu);font-size:0.75rem;padding:8px 0">None available</div>';
      return keys.sort().map(g=>`<div style="display:flex;justify-content:space-between;padding:5px 0;font-size:0.78rem;border-bottom:1px solid var(--b1)"><span class="badge b-rm">${g}</span><span class="mono" style="color:var(--gr)">${fmt(grades[g])}kg</span></div>`).join('');
    };
    if(steelEl)steelEl.innerHTML=byGrade('Steel');
    if(plasticEl)plasticEl.innerHTML=byGrade('Plastic');
  }
  const tbody=document.getElementById('ds-tbody');if(!tbody)return;
  const _ft=document.getElementById('dsf-type')?.value||'';
  const _fg=document.getElementById('dsf-grade')?.value||'';
  const allDS=State.DB.deadStock||[];
  const dsTypes=[...new Set(allDS.filter(d=>(!_fg||(d.grade||'')===_fg)).map(d=>d.type).filter(Boolean))].sort();
  const dsGrades=[...new Set(allDS.filter(d=>(!_ft||d.type===_ft)).map(d=>d.grade).filter(Boolean))].sort();
  const ds_thead=document.getElementById('ds-thead');
  if(ds_thead){ds_thead.innerHTML=`
    <tr class="tbl-filter-row">
      <th></th>
      <th>${buildColFilter(dsTypes,'dsf-type','Type')}</th>
      <th>${buildColFilter(dsGrades,'dsf-grade','Grade')}</th>
      <th></th><th></th><th></th><th></th><th></th><th></th>
    </tr>
    <tr>
      <th>ID</th><th>Type</th><th>Grade</th>
      <th>Weight (kg)</th><th>Cones</th><th>Remaining</th>
      <th>Used In</th><th>Consumed On</th><th>Date Added</th><th>Actions</th>
    </tr>`;
    if(_ft)document.getElementById('dsf-type').value=_ft;
    if(_fg)document.getElementById('dsf-grade').value=_fg;
  }
  const entries=allDS.filter(d=>(!_ft||d.type===_ft)&&(!_fg||(d.grade||'')===_fg))
    .sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
  if(!entries.length){tbody.innerHTML=`<tr><td colspan="9"><div class="empty"><div class="empty-icon">📦</div><div class="empty-text">✕ No dead stock entries yet</div></div></td></tr>`;return;}
  const isSteel=d=>d.type==='Steel';
  tbody.innerHTML=entries.map(d=>{
    const bal=getDeadStockBalance(d.id);
    // Sep 10 2026 — real, direct extension built via direct discussion
    // with Priyam: cones now has a real remaining balance too, same as
    // weight already did, reduced by whatever's already genuinely
    // recorded on a real Dye source.
    const conesBal=d.cones!=null?getDeadStockConesBalance(d.id):null;
    const consumed=bal<=0;
    let usedInHTML='<span style="color:var(--mu)">—</span>';
    let consumedOnHTML='<span style="color:var(--mu)">—</span>';
    if(isSteel(d)){
      const dyeUses=(State.DB.dyeLots||[]).filter(dl=>(dl.sources||[]).some(s=>s.deadStockId===d.id));
      if(dyeUses.length){
        usedInHTML=dyeUses.map(dl=>{
          const src=(dl.sources||[]).find(s=>s.deadStockId===d.id);
          return`<div><span style="color:var(--ac);cursor:pointer;font-weight:700;font-size:0.72rem" onclick="openDyeLifecycle('${dl.id}')">${dl.dyeLotNo||dl.id}</span> <span style="color:var(--mu);font-size:0.65rem">(${fmt(src?.weight||0)}kg)</span></div>`;
        }).join('');
        const dates=dyeUses.map(dl=>dl.startTime||'').filter(Boolean).sort();
        if(dates.length)consumedOnHTML=`<span style="font-size:0.72rem">${fmtTS(dates[dates.length-1])}</span>`;
      }else{usedInHTML='<span style="color:var(--gr);font-size:0.72rem">→ Ready for Dye</span>';}
    }else{
      const softUses=(State.DB.stageEntries||[]).filter(e=>e.deadStockId===d.id&&e.stage==='Soft'&&e.status!=='Void');
      if(softUses.length){
        usedInHTML=softUses.map(e=>`<div><span style="color:var(--ac);cursor:pointer;font-weight:700;font-size:0.72rem" onclick="openRMLifecycle('${e.lotId}')">${e.lotId}</span> <span style="color:var(--mu);font-size:0.65rem">(${e.status})</span></div>`).join('');
        const dates=softUses.map(e=>e.startTime||'').filter(Boolean).sort();
        if(dates.length)consumedOnHTML=`<span style="font-size:0.72rem">${fmtTS(dates[dates.length-1])}</span>`;
      }else{usedInHTML='<span style="color:var(--gr);font-size:0.72rem">→ Ready for Soft</span>';}
    }
    return`<tr style="${consumed||d.status==='Voided'?'opacity:0.5':''}">
      <td class="mono" style="color:var(--mu);font-size:0.72rem">${d.id}</td>
      <td><span class="badge" style="background:${isSteel(d)?'rgba(100,150,255,0.15)':'rgba(255,165,0,0.15)'};color:${isSteel(d)?'var(--ac)':'var(--ye)'}">${d.type}</span></td>
      <td><span class="badge b-rm">${d.grade}</span></td>
      <td class="mono">${fmt(d.weight)}kg</td>
      <td class="mono">${d.cones!=null?d.cones:'<span style="color:var(--mu)">—</span>'}</td>
      <td class="mono" style="color:${bal>0?'var(--tx)':'var(--mu)'}">
        ${d.status==='Voided'?'<span class="badge b-void">Voided</span>':fmt(bal)+'kg'}
        ${d.status!=='Voided'&&conesBal!=null?`<div style="font-size:0.65rem;color:${conesBal>0?'var(--mu)':'var(--re)'}">${conesBal} cones</div>`:''}
      </td>
      <td>${usedInHTML}</td>
      <td>${consumedOnHTML}</td>
      <td style="font-size:0.72rem;color:var(--mu)">${fmtDate(d.date)}<br>
        <span style="font-size:0.65rem">${d.addedBy||'—'}</span>
      </td>
      <td style="white-space:nowrap">
        ${d.status==='Voided'?'':`${isAdmin&&bal>0?`<button class="btn btn-danger btn-xs" onclick="openScrapModal('${d.id}','dead')">Scrap</button>`:''}
        ${isSup?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Edit" onclick="openEditDeadStock('${d.id}')">✏</button><button class="btn btn-ghost btn-xs tc-tip" data-tip="Void" style="color:var(--re)" onclick="voidDeadStock('${d.id}')">🗑</button>`:''}
        ${!isAdmin&&!isSup?'':bal<=0?'<span style="font-size:0.68rem;color:var(--mu)">Consumed</span>':''}`}
      </td>
    </tr>`;
  }).join('');
}

export function renderRecycleStock(){const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';const isSup=State.currentUser?.role==='supervisor'||isAdmin;const _fRc=document.getElementById('rcf-rcno')?.value||'';const _fLot=document.getElementById('rcf-lot')?.value||'';const _fSh=document.getElementById('rcf-shade')?.value||'';const allRC=State.DB.recycleStock||[];const rcNos=[...new Set(allRC.filter(r=>(!_fLot||r.dyeLotNo===_fLot)&&(!_fSh||r.shade===_fSh)).map(r=>r.id).filter(Boolean))].sort();const dyeLots=[...new Set(allRC.filter(r=>(!_fRc||r.id===_fRc)&&(!_fSh||r.shade===_fSh)).map(r=>r.dyeLotNo).filter(Boolean))].sort();const shades_rc=[...new Set(allRC.filter(r=>(!_fRc||r.id===_fRc)&&(!_fLot||r.dyeLotNo===_fLot)).map(r=>r.shade).filter(Boolean))].sort();const _rcTh=document.getElementById('rc-thead');if(_rcTh){_rcTh.innerHTML=`
      <tr class="tbl-filter-row"><th>${buildColFilter(rcNos,'rcf-rcno','RC No')}</th><th>${buildColFilter(dyeLots,'rcf-lot','Dye Lot')}</th><th>${buildColFilter(shades_rc,'rcf-shade','Shade')}</th><th></th><th></th><th></th><th></th><th></th><th></th><th></th></tr><tr>
        ${sortTh('rcstock','id','ID')}
        ${sortTh('rcstock','dyeLotNo','Dye Lot')}
        ${sortTh('rcstock','shade','Shade')}
        ${sortTh('rcstock','weight','Off (cones / kg)')}<th>On Steel now (cones / kg)</th>
        ${sortTh('rcstock','status','Status')}
        ${sortTh('rcstock','createdAt','Date')}
        <th>Added By</th><th>Actions</th></tr>`;if(_fRc)document.getElementById('rcf-rcno').value=_fRc;if(_fLot)document.getElementById('rcf-lot').value=_fLot;if(_fSh)document.getElementById('rcf-shade').value=_fSh;}
const _rcF=(State.DB.recycleStock||[]).filter(r=>(!_fRc||r.id===_fRc)&&(!_fLot||r.dyeLotNo===_fLot)&&(!_fSh||r.shade===_fSh));const entries=_sortState.rcstock?.col?sortArr(_rcF,_sortState.rcstock.col,_sortState.rcstock.dir):[..._rcF].sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));const tbody=document.getElementById('rc-tbody');if(!tbody)return;if(!entries.length){tbody.innerHTML=`<tr><td colspan="10"><div class="empty"><div class="empty-icon">♻</div><div class="empty-text">✕ No recycle stock yet — created automatically when dye lots are split</div></div></td></tr>`;return;}
tbody.innerHTML=entries.map(r=>{const bal=getRecycleSteelBal(r.id);const av=getRecycleSteelAvail(r.id);const rcSt=getRCStatus(r.id);const stColor=rcSt.available?'var(--gr)':(rcSt.status==='Consumed'||rcSt.status==='Scrapped')?'var(--mu)':'var(--ye)';const voided=r.status==='Voided';const consumed=rcSt.status==='Consumed'||rcSt.status==='Scrapped';return`<tr style="${consumed||voided?'opacity:0.6':''}"><td class="mono" style="color:var(--ac);font-weight:700">${r.id}</td><td class="mono" style="color:var(--ac)">${r.dyeLotNo||''}</td><td style="font-size:0.78rem">${r.shade||''}</td><td class="mono">${r.cones!=null?r.cones+' cones / ':''}${fmt(r.weight)}kg</td><td class="mono">${voided?'<span class="badge b-void">Voided</span>':`${bal.units} cones / ${fmt(bal.weight)}kg<div style="font-size:0.62rem;color:var(--mu)">free to use: ${av.units} cones / ${fmt(av.weight)}kg</div>`}</td><td><span style="font-size:0.7rem;font-weight:700;color:${stColor}">${voided?'Split Undone':rcSt.status}</span></td><td style="font-size:0.68rem;color:var(--mu);max-width:140px;overflow:hidden;text-overflow:ellipsis">${r.reason||''}</td><td style="white-space:nowrap">${r.markedAt?fmtTS(r.markedAt):''}</td><td style="font-size:0.7rem;color:var(--mu)">${r.markedBy||''}</td><td style="white-space:nowrap">${voided?'':`${!consumed&&isAdmin?`<button class="btn btn-danger btn-xs" onclick="openScrapModal('${r.id}','recycle')">Scrap</button>`:''}${isAdmin?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Undo Split" style="color:var(--re)" onclick="voidDyeSplit('${r.id}')">&#8617;</button>`:''}${consumed?`<span style="font-size:0.68rem;color:var(--mu)">${rcSt.status}</span>`:''}`}</td></tr>`;}).join('');const sumEl=document.getElementById('rc-summary');if(sumEl){const all=(State.DB.recycleStock||[]).filter(r=>r.status!=='Voided');const total=all.length;const availList=all.filter(r=>getRCStatus(r.id).available);const availC=availList.reduce((a,r)=>a+getRecycleSteelAvail(r.id).units,0);const availWt=availList.reduce((a,r)=>a+getRecycleSteelAvail(r.id).weight,0);const inUse=all.filter(r=>getRCStatus(r.id).status.includes('In Use')).length;const usedUp=all.filter(r=>{const t=getRCStatus(r.id).status;return t==='Consumed'||t==='Scrapped';}).length;sumEl.innerHTML=`<div style="display:flex;gap:16px;flex-wrap:wrap;font-size:0.78rem;"><div style="padding:8px 14px;background:var(--s2);border-radius:8px;border-left:3px solid var(--ac)"><div style="font-size:1.1rem;font-weight:800;color:var(--ac)">${total}</div><div style="color:var(--mu)">Total RC entries</div></div><div style="padding:8px 14px;background:var(--s2);border-radius:8px;border-left:3px solid var(--gr)"><div style="font-size:1.1rem;font-weight:800;color:var(--gr)">${availList.length}</div><div style="color:var(--mu)">Free to use (${availC} cones / ${fmt(availWt)}kg)</div></div><div style="padding:8px 14px;background:var(--s2);border-radius:8px;border-left:3px solid var(--ye)"><div style="font-size:1.1rem;font-weight:800;color:var(--ye)">${inUse}</div><div style="color:var(--mu)">Claimed by a running Dye</div></div><div style="padding:8px 14px;background:var(--s2);border-radius:8px;border-left:3px solid var(--mu)"><div style="font-size:1.1rem;font-weight:800;color:var(--mu)">${usedUp}</div><div style="color:var(--mu)">Used up / scrapped</div></div></div>`;}}

export function renderResidualLog(){
  const tbody=document.getElementById('rl-tbody');if(!tbody)return;
  const isSup=State.currentUser?.role==='supervisor'||State.currentUser?.role==='admin'||State.currentUser?.role==='manager';
  const logs=(State.DB.residualLog||[]).slice().sort((a,b)=>(b.timestamp||'').localeCompare(a.timestamp||''));
  if(!logs.length){tbody.innerHTML=`<tr><td colspan="10"><div class="empty"><div class="empty-icon">📋</div><div class="empty-text">No residual/scrap transfers yet</div></div></td></tr>`;return;}
  tbody.innerHTML=logs.map(r=>{
    const typeColor=r.type==='residual'?'var(--ye)':'var(--re)';
    const typeLabel=r.type==='residual'?'→ Residual':'🗑 Scrap';
    return`<tr${r.status==='Voided'?' style="opacity:0.5"':''}>
      <td style="font-size:0.72rem;color:var(--mu)">${r.timestamp?fmtTS(r.timestamp):(r.date||'—')}</td>
      <td class="mono" style="color:var(--ac);font-weight:700">${r.lotId||'—'}</td>
      <td><span class="badge b-rm">${r.grade||'—'}</span></td>
      <td style="font-size:0.72rem">${r.vendor||'—'}</td>
      <td class="mono">${fmt(r.weight)}kg</td>
      <td><span style="color:${typeColor};font-size:0.72rem;font-weight:700">${typeLabel}</span></td>
      <td style="font-size:0.72rem;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.reason||''}">${r.reason||'—'}</td>
      <td style="font-size:0.72rem;color:var(--mu)">${r.by||'—'}</td>
      <td>${r.status==='Voided'?'<span class="badge b-void">Voided</span>':'<span style="font-size:0.72rem;font-weight:700;color:var(--gr)">Approved</span>'}</td>
      <td style="white-space:nowrap">${r.status==='Voided'?'—':`${isSup?`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Edit" onclick="openEditResidualTransfer('${r.id}')">✏</button><button class="btn btn-ghost btn-xs tc-tip" data-tip="Void" style="color:var(--re)" onclick="voidResidualTransfer('${r.id}')">🗑</button>`:''}`}</td>
    </tr>`;
  }).join('');
}

export function renderResidualStock(){
  const el=document.getElementById('rs-tbody');if(!el)return;
  const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';
  const all=State.DB.residualStock||[];
  // Summary
  const sumEl=document.getElementById('rs-summary');
  if(sumEl){
    const totalWt=all.reduce((a,r)=>a+getResidualBalance(r.id),0);
    const grades=new Set(all.filter(r=>getResidualBalance(r.id)>0).map(r=>r.grade));
    sumEl.innerHTML=`<div style="display:flex;gap:14px;flex-wrap:wrap;font-size:0.78rem;margin-bottom:16px;">
      <div style="padding:8px 14px;background:var(--s2);border-radius:8px;border-left:3px solid var(--ye)">
        <div style="font-size:1.1rem;font-weight:800;color:var(--ye)">${fmt(totalWt)}kg</div>
        <div style="color:var(--mu)">Total available</div>
      </div>
      <div style="padding:8px 14px;background:var(--s2);border-radius:8px;border-left:3px solid var(--ac)">
        <div style="font-size:1.1rem;font-weight:800;color:var(--ac)">${grades.size}</div>
        <div style="color:var(--mu)">Active grades</div>
      </div>
    </div>`;
  }
  // Header
  const thead=document.getElementById('rs-thead');
  if(thead)thead.innerHTML=`<tr><th>Grade</th><th>Total Added</th><th>Remaining</th><th>Contributions</th><th>Used In</th><th>Consumed On</th><th>Actions</th></tr>`;
  if(!all.length){el.innerHTML=`<tr><td colspan="5"><div class="empty"><div class="empty-icon">🔄</div><div class="empty-text">No residual stock yet — move soft entry remnants here</div></div></td></tr>`;return;}
  el.innerHTML=all.sort((a,b)=>b.weight-a.weight).map(r=>{
    const bal=getResidualBalance(r.id);
    const contribs=(r.contributions||[]);
    const contribHtml=contribs.map(c=>`<div style="font-size:0.65rem;color:var(--mu);padding:2px 0">→ ${c.lotId||'—'} · ${c.vendor||'—'} · <strong>${fmt(c.weight)}kg</strong> · ${c.movedBy||'—'} · ${c.timestamp?fmtTS(c.timestamp):'—'}</div>`).join('');
    const _rsDyeUses=(State.DB.dyeLots||[]).filter(dl=>(dl.sources||[]).some(s=>s.residualId===r.id));
    const _rsUsedInHTML=_rsDyeUses.length
      ?_rsDyeUses.map(dl=>{
          const src=(dl.sources||[]).find(s=>s.residualId===r.id);
          return`<div><span style="color:var(--ac);cursor:pointer;font-weight:700;font-size:0.72rem" onclick="openDyeLifecycle('${dl.id}')">${dl.dyeLotNo||dl.id}</span> <span style="color:var(--mu);font-size:0.65rem">(${fmt(src?.weight||0)}kg)</span></div>`;
        }).join('')
      :'<span style="color:var(--gr);font-size:0.72rem">→ Ready for Dye</span>';
    const _rsDates=_rsDyeUses.map(dl=>dl.startTime||'').filter(Boolean).sort();
    const _rsConsumedOn=_rsDates.length?`<span style="font-size:0.72rem">${fmtTS(_rsDates[_rsDates.length-1])}</span>`:'<span style="color:var(--mu)">—</span>';
    return`<tr>
      <td><span class="badge b-rm">${r.grade}</span></td>
      <td class="mono">${fmt(r.weight)}kg</td>
      <td class="mono" style="color:${bal>0?'var(--gr)':'var(--mu)'}">
        ${fmt(bal)}kg
      </td>
      <td>
        <details><summary style="cursor:pointer;font-size:0.7rem;color:var(--mu)">${contribs.length} contribution${contribs.length!==1?'s':''}</summary>
        <div style="padding:4px 0">${contribHtml}</div></details>
      </td>
      <td>${_rsUsedInHTML}</td>
      <td>${_rsConsumedOn}</td>
      <td style="white-space:nowrap">
        ${bal>0?`<button class="btn btn-primary btn-xs" onclick="addResidualToNewDye('${r.id}','${r.grade}')">+ Add to Dye</button>`:''}
      </td>
    </tr>`;
  }).join('');
}

export function renderScrapLog(){
  const el=document.getElementById('scrap-log-content');
  if(!el)return;
  const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';
  const logs=(State.DB.scrapLog||[]).sort((a,b)=>(b.timestamp||'').localeCompare(a.timestamp||''));
  if(!logs.length){el.innerHTML='<div style="color:var(--mu);font-size:0.78rem;padding:16px;text-align:center">No scrap entries yet</div>';return;}
  el.innerHTML='<div class="tbl"><table><thead><tr><th>ID</th><th>Type</th><th>Source</th><th>Grade</th><th>Weight (kg / cones)</th><th>Reason</th><th>By</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead><tbody>'+
  logs.map(s=>`<tr${s.status==='Voided'?' style="opacity:0.5"':''}>
    <td class="mono" style="font-size:0.7rem;color:var(--mu)">${s.id||'—'}</td>
    <td><span class="badge" style="background:${s.type==='soft'?'rgba(239,68,68,0.15)':'rgba(250,204,21,0.15)'};color:${s.type==='soft'?'var(--re)':'var(--ye)'}">${s.type||'—'}</span></td>
    <td class="mono" style="font-size:0.72rem">${s.entryId||s.rsId||'—'}</td>
    <td>${s.grade||'—'}</td>
    <td class="mono" style="color:var(--re)">${fmt(s.weight||0)}kg${s.cones!=null?' / '+s.cones+' cones':''}</td>
    <td style="font-size:0.72rem;color:var(--mu)">${s.reason||'—'}</td>
    <td style="font-size:0.72rem">${s.scrappedBy||'—'}</td>
    <td style="font-size:0.72rem;color:var(--mu)">${s.date||'—'}</td>
    <td>${s.status==='Voided'?'<span class="badge b-void">Voided</span>':'<span style="font-size:0.72rem;font-weight:700;color:var(--gr)">Approved</span>'}</td>
    <td>${s.status==='Voided'||!isAdmin?'':`<button class="btn btn-ghost btn-xs tc-tip" data-tip="Void" style="color:var(--re)" onclick="voidScrap('${s.id}')">🗑</button>`}</td>
  </tr>`).join('')+'</tbody></table></div>';
}

window.showStockRegTab = showStockRegTab;

// Aug 26 2026 — Module split effort, folded here rather than into a
// new file: these add/edit/void forms genuinely belong alongside
// Dead Stock/Recycle/Residual/Scrap's own display code, already
// established here. Extracted byte-for-byte from pages.js.

export function addDeadStockRow(){const list=document.getElementById('dye-dead-list');if(!list)return;const steelDS=(State.DB.deadStock||[]).filter(d=>d.status==='Approved'&&d.type==='Steel'&&getDeadStockBalance(d.id)>0);const plasticDSSoftened=(State.DB.deadStock||[]).filter(d=>{if(d.status!=='Approved'||d.type!=='Plastic')return false;const softDone=(State.DB.stageEntries||[]).some(e=>e.deadStockId===d.id&&e.stage==='Soft'&&(e.status==='Approved'||e.status==='Edited-Approved')&&e.outWeight>0);return softDone&&getDeadStockBalance(d.id)>0;});const allAvail=[...steelDS,...plasticDSSoftened];if(!allAvail.length){showToast('No dead stock available for dye (steel cone or softened plastic)','err');return;}
const rowId='dds-'+Date.now();const div=document.createElement('div');div.id=rowId;div.style.cssText='display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap;';div.innerHTML=`
    <select class="fs" style="flex:1;min-width:180px" onchange="onDSRowSelect('${rowId}')"><option value="">Select Dead Stock...</option><optgroup label="Steel Cone (direct to dye)">
        ${steelDS.map(d=>`<option value="${d.id}|steel">${d.id}— ${d.grade}— Steel(${fmt(getDeadStockBalance(d.id))}kg)</option>`).join('')}
      </optgroup>
      ${plasticDSSoftened.length?`<optgroup label="Plastic → Softened (ready for dye)">${plasticDSSoftened.map(d=>{const softEntry=(State.DB.stageEntries||[]).find(e=>e.deadStockId===d.id&&e.stage==='Soft'&&(e.status==='Approved'||e.status==='Edited-Approved'));const softOut=softEntry?.outWeight||0;return`<option value="${d.id}|plastic">${d.id} — ${d.grade} — Plastic/Softened (${fmt(softOut)}kg out)</option>`;}).join('')}</optgroup>`:''}
    </select><input class="fi" type="number" id="${rowId}-wt" data-field="weight" placeholder="Weight (kg)" step="0.01" style="width:130px" min="0.01"><input class="fi" type="number" id="${rowId}-cones" data-field="cones" placeholder="Cones" step="1" style="width:100px" min="1"><span id="${rowId}-info" style="font-size:0.68rem;color:var(--mu)"></span><button class="btn btn-ghost btn-xs" style="color:var(--re)" onclick="document.getElementById('${rowId}').remove()">✕</button>`;list.appendChild(div);}

export function onDSRowSelect(rowId){const sel=document.querySelector('#'+rowId+' select');const infoEl=document.getElementById(rowId+'-info');const wtEl=document.getElementById(rowId+'-wt');const conesEl=document.getElementById(rowId+'-cones');if(!sel||!infoEl)return;const val=sel.value;if(!val){infoEl.textContent='';return;}
const[dsId,coneType]=val.split('|');const ds=(State.DB.deadStock||[]).find(d=>d.id===dsId);if(!ds){return;}
// Sep 10 2026 — real, direct extension built via direct discussion
// with Priyam: cones now has a real remaining balance too, same as
// weight already did — shown and enforced here, for a Steel (direct)
// source only, since Plastic goes through Soft first, where cones
// was never tracked at all.
if(coneType==='plastic'){const softEntry=(State.DB.stageEntries||[]).find(e=>e.deadStockId===dsId&&e.stage==='Soft'&&(e.status==='Approved'||e.status==='Edited-Approved'));const softOut=softEntry?.outWeight||0;infoEl.textContent=`Soft output: ${fmt(softOut)}kg available`;if(wtEl)wtEl.max=softOut;}else{const bal=getDeadStockBalance(dsId);const conesBal=ds.cones!=null?getDeadStockConesBalance(dsId):null;infoEl.textContent=`Available: ${fmt(bal)}kg`+(conesBal!=null?` / ${conesBal} cones`:'');if(wtEl)wtEl.max=bal;if(conesEl&&conesBal!=null)conesEl.max=conesBal;}}

export function onDsrVendorChange(rowId){const row=document.getElementById(rowId);const vendor=row.querySelector('select').value;const gradeEl=document.getElementById(rowId+'-grade');const lotEl=document.getElementById(rowId+'-lot');gradeEl.innerHTML='<option value="">Select grade...</option>';lotEl.innerHTML='<option value="">Select lot...</option>';gradeEl.disabled=true;lotEl.disabled=true;if(!vendor)return;const hasAvail=l=>{if(l.status==='Voided'||l.status==='Merged'||_isLotOnHold(l.id,l.grade,l.vendor))return false;const tKey=_summaryKey(l.id,l.grade,l.vendor);const t=State._trueSoftAvail?.[tKey];return t?t.units>0:getSoftBalanceAvailable(l.id,l.grade,l.vendor).units>0;};const grades=[...new Set(State.DB.lots.filter(l=>l.vendor===vendor&&hasAvail(l)).map(l=>l.grade))].sort();if(!grades.length){gradeEl.innerHTML='<option value="">No grades available</option>';return;}
gradeEl.innerHTML='<option value="">Select grade...</option>'+grades.map(g=>`<option value="${g}">${g}</option>`).join('');gradeEl.disabled=false;}

export function onDsrGradeChange(rowId){const row=document.getElementById(rowId);const vendor=row.querySelector('select').value;const grade=document.getElementById(rowId+'-grade').value;const lotEl=document.getElementById(rowId+'-lot');lotEl.innerHTML='<option value="">Select lot...</option>';lotEl.disabled=true;if(!vendor||!grade)return;const trueBal=l=>{const tKey=_summaryKey(l.id,l.grade,l.vendor);return State._trueSoftAvail?.[tKey]||getSoftBalanceAvailable(l.id,l.grade,l.vendor);};const lots=State.DB.lots.filter(l=>l.status!=='Voided'&&l.status!=='Merged'&&!_isLotOnHold(l.id,l.grade,l.vendor)&&l.vendor===vendor&&l.grade===grade&&trueBal(l).units>0).sort((a,b)=>(a.id||'').localeCompare(b.id||''));if(!lots.length){lotEl.innerHTML='<option value="">No lots available</option>';return;}
lotEl.innerHTML='<option value="">Select lot...</option>'+lots.map(l=>{const bal=trueBal(l);return`<option value="${l.id}||${l.grade}||${l.vendor}">${l.id} (${fmt(bal.units)}b / ${fmt(bal.weight)}kg avail)</option>`;}).join('');lotEl.disabled=false;}

export function addRecycleRow(){const list=document.getElementById('dye-recycle-list');if(!list)return;const anyFree=r=>{const s=getRecycleSteelAvail(r.id),f=getRecycleSoftenedAvail(r.id);return s.weight>0||s.units>0||f.weight>0||f.units>0;};const available=(State.DB.recycleStock||[]).filter(r=>r.status!=='Voided'&&anyFree(r));if(!available.length){list.innerHTML='<div style="color:var(--mu);font-size:0.75rem;padding:8px">No recycle stock free to use (all used up, scrapped, or already claimed by a running dye batch)</div>';return;}
const rowId='drc-'+Date.now();const div=document.createElement('div');div.id=rowId;div.style.cssText='display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap;';div.innerHTML=`
    <select class="fs" style="flex:1;min-width:160px" data-field="rc" onchange="onRecycleLotSelect('${rowId}')"><option value="">Select RC entry...</option>
      ${available.map(r=>`<option value="${r.id}">${r.id}— ${r.dyeLotNo}— ${r.shade}(steel ${getRecycleSteelAvail(r.id).units}c/${fmt(getRecycleSteelAvail(r.id).weight)}kg, softened ${getRecycleSoftenedAvail(r.id).units}c/${fmt(getRecycleSoftenedAvail(r.id).weight)}kg)</option>`).join('')}
    </select><select class="fs" id="${rowId}-pool" data-field="pool" style="width:110px" onchange="onRecycleLotSelect('${rowId}')"><option value="steel">On Steel</option><option value="softened">Softened</option></select><input class="fi" type="number" id="${rowId}-wt" data-field="weight" placeholder="Weight (kg)" step="0.01" style="width:120px" min="0.01"><input class="fi" type="number" id="${rowId}-cones" data-field="cones" placeholder="Cones" step="1" style="width:90px" min="1"><span id="${rowId}-bal" style="font-size:0.7rem;color:var(--mu);white-space:nowrap"></span><button class="btn btn-ghost btn-xs" style="color:var(--re)" onclick="document.getElementById('${rowId}').remove()">✕</button>`;list.appendChild(div);}

export function addResidualRow(presetId,presetGrade){
  const list=document.getElementById('dye-residual-list');if(!list)return;
  const available=(State.DB.residualStock||[]).filter(r=>getResidualBalance(r.id)>0);
  if(!available.length){list.innerHTML='<div style="color:var(--mu);font-size:0.75rem;padding:8px">No residual stock available</div>';return;}
  const rowId='drs-'+Date.now();
  const div=document.createElement('div');
  div.id=rowId;div.style.cssText='display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap;';
  const opts=available.map(r=>`<option value="${r.id}" ${r.id===presetId?'selected':''}>${r.grade} — ${fmt(getResidualBalance(r.id))}kg avail</option>`).join('');
  div.innerHTML=`<select class="fs" style="flex:2;min-width:200px;font-size:0.75rem" onchange="onResidualRowChange(this,'${rowId}')">
    <option value="">Select residual grade...</option>${opts}</select>
  <input type="number" class="fi" placeholder="Weight (kg)" step="0.01" style="width:100px" id="${rowId}-wt">
  <button class="btn btn-ghost btn-xs" style="color:var(--re)" onclick="document.getElementById('${rowId}').remove()">✕</button>`;
  list.appendChild(div);
  if(presetId)setTimeout(()=>onResidualRowChange(list.querySelector('select'),rowId),100);
}

export function onResidualRowChange(sel,rowId){
  const rsId=sel.value;
  const rs=(State.DB.residualStock||[]).find(r=>r.id===rsId);
  const bal=rs?getResidualBalance(rsId):0;
  const wtEl=document.getElementById(rowId+'-wt');
  if(wtEl){wtEl.max=bal;wtEl.placeholder=`0 – ${fmt(bal)}kg`;}
}

export function onRecycleLotSelect(rowId){const sel=document.querySelector('#'+rowId+' select[data-field="rc"]');const poolSel=document.getElementById(rowId+'-pool');const balEl=document.getElementById(rowId+'-bal');if(!sel||!balEl)return;const rcId=sel.value;if(!rcId){balEl.textContent='';return;}
const pool=poolSel?poolSel.value:'steel';const av=pool==='softened'?getRecycleSoftenedAvail(rcId):getRecycleSteelAvail(rcId);const st=getRCStatus(rcId);balEl.textContent=`Free (${pool==='softened'?'Softened':'On Steel'}): ${av.units} cones / ${fmt(av.weight)}kg | ${st.status}`;const _wt=document.getElementById(rowId+'-wt');if(_wt)_wt.max=av.weight;const _cn=document.getElementById(rowId+'-cones');if(_cn)_cn.max=av.units;}

export function openDeadStockModal(){document.getElementById('ds-alert').innerHTML='';document.getElementById('ds-type').value='';document.getElementById('ds-weight').value='';document.getElementById('ds-cones').value='';document.getElementById('ds-note').value='';const G=State.DB.masters.grades||[];document.getElementById('ds-grade').innerHTML=`<option value="">Select grade...</option>`+G.map(g=>`<option value="${g}">${g}</option>`).join('');openModal('deadstock-modal-overlay');}

export async function submitDeadStock(){const setAlert=msg=>{document.getElementById('ds-alert').innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;};const type=document.getElementById('ds-type').value;const grade=document.getElementById('ds-grade').value;const weight=parseFloat(document.getElementById('ds-weight').value)||0;const cones=parseInt(document.getElementById('ds-cones').value)||0;const note=document.getElementById('ds-note').value.trim();if(!type){setAlert('Select cone type');return;}
if(!grade){setAlert('Select grade');return;}
if(weight<=0){setAlert('Enter weight');return;}
if(cones<=0){setAlert('Enter cones count');return;}
try{
  const {ok,data,error,networkError}=await apiPost('/api/dead-stock/create',{type,grade,weight,cones,note,changedBy:State.currentUser.name});
  if(networkError)throw new Error(error);
  if(!ok){setAlert(error||'Could not save');return;}
  closeModal('deadstock-modal-overlay');showToast('Dead stock entry added ✓');await _refreshAndRender(['deadStock'],renderAll);
}catch(e){setAlert('Network error — not saved: '+e.message);}
}

export function openEditDeadStock(id){
  const rec=(State.DB.deadStock||[]).find(x=>x.id===id);if(!rec)return;
  // Sep 10 2026 — real, direct fix built via direct discussion with
  // Priyam: this used to be a chain of separate prompt() dialogs, one
  // field at a time — not matching how editing works everywhere else
  // in this app, a single, real modal with all fields shown together.
  // Rebuilt to match, reusing the same field layout as its own Add
  // Dead Stock modal.
  document.getElementById('ds-edit-alert').innerHTML='';
  document.getElementById('ds-edit-id').value=id;
  document.getElementById('ds-edit-type').value=rec.type;
  const G=State.DB.masters.grades||[];
  document.getElementById('ds-edit-grade').innerHTML=`<option value="">Select grade...</option>`+G.map(g=>`<option value="${g}">${g}</option>`).join('');
  document.getElementById('ds-edit-grade').value=rec.grade;
  document.getElementById('ds-edit-weight').value=rec.weight;
  document.getElementById('ds-edit-cones').value=rec.cones??'';
  document.getElementById('ds-edit-note').value=rec.note||'';
  openModal('deadstock-edit-modal-overlay');
}

export async function submitEditDeadStockModal(){
  const setAlert=msg=>{document.getElementById('ds-edit-alert').innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;};
  const id=document.getElementById('ds-edit-id').value;
  const type=document.getElementById('ds-edit-type').value;
  const grade=document.getElementById('ds-edit-grade').value;
  const weight=parseFloat(document.getElementById('ds-edit-weight').value)||0;
  const cones=parseInt(document.getElementById('ds-edit-cones').value)||0;
  const note=document.getElementById('ds-edit-note').value.trim();
  if(!grade){setAlert('Select grade');return;}
  if(weight<=0){setAlert('Enter weight');return;}
  if(cones<=0){setAlert('Enter cones count');return;}
  // Sep 10 2026 — real, direct new feature built via direct discussion
  // with Priyam, establishing one clear rule across the whole app:
  // every real action shows a genuine preview of its actual effect
  // before committing. This first call is read-only (dryRun) — the
  // real save only happens if Confirm is clicked on the preview shown
  // next, reusing the exact same real validation either way.
  try{
    const {ok,data,error,networkError}=await apiPost('/api/dead-stock/edit',{id,type,grade,weight,cones,note,dryRun:true});
    if(networkError){setAlert('Network error: '+error);return;}
    if(!ok||data.error){setAlert(data.error||error||'Could not preview');return;}
    _pendingDeadStockEditBody={id,type,grade,weight,cones,note};
    _renderDeadStockPreview(data);
    closeModal('deadstock-edit-modal-overlay');
    const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';
    document.getElementById('deadstock-preview-pwd-row').style.display=isAdmin?'none':'';
    document.getElementById('deadstock-preview-pwd').value='';
    document.getElementById('deadstock-preview-alert').innerHTML='';
    openModal('deadstock-preview-modal-overlay');
  }catch(e){setAlert('Network error: '+e.message);}
}

let _pendingDeadStockEditBody=null;

function _renderDeadStockPreview(data){
  const box=document.getElementById('deadstock-preview-body');
  const weightChanged=Math.abs(data.newWeight-data.oldWeight)>0.01;
  const conesChanged=data.newCones!==data.oldCones;
  box.innerHTML=`
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:10px;">
      <div><div style="font-size:.6rem;color:var(--mu);text-transform:uppercase;letter-spacing:.08em">Weight</div><div style="font-size:.95rem"><span style="color:var(--mu)">${fmt(data.oldWeight)}kg</span> → <span style="font-weight:800;${weightChanged?'color:var(--ac)':''}">${fmt(data.newWeight)}kg</span></div></div>
      <div><div style="font-size:.6rem;color:var(--mu);text-transform:uppercase;letter-spacing:.08em">Cones</div><div style="font-size:.95rem"><span style="color:var(--mu)">${data.oldCones??'—'}</span> → <span style="font-weight:800;${conesChanged?'color:var(--ac)':''}">${data.newCones??'—'}</span></div></div>
    </div>
    ${data.wouldTriggerAdminOverride?`<div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:8px 10px;font-size:.72rem;color:var(--re);font-weight:700">⚠ ${fmt(data.alreadyConsumed)}kg has already been consumed from this entry — saving this will leave a real shortfall, flagged for review.</div>`:''}
  `;
}

export async function _doDeadStockEditSave(){
  const setAlert=msg=>{document.getElementById('deadstock-preview-alert').innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;};
  const body=_pendingDeadStockEditBody;
  if(!body)return;
  const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';
  let pwd='';
  if(!isAdmin){pwd=document.getElementById('deadstock-preview-pwd').value;if(!pwd){setAlert('Enter your password');return;}}
  const _pbtn=document.getElementById('deadstock-preview-confirm-btn');
  if(_pbtn)_pbtn.disabled=true;
  await submitEditDeadStock(body.id,body.type,body.grade,body.weight,body.cones,body.note,setAlert,pwd,true);
  if(_pbtn)_pbtn.disabled=false;
}

// Sep 10 2026 — kept as its own real function (rather than inlined
// into the modal handler above) per the module-split safety net —
// this exact function existed before today's extraction and stays
// findable, exactly once, matching that same real discipline.
export async function submitEditDeadStock(id,type,grade,weight,cones,note,setAlert,pwd,fromPreview){
  try{
    const {ok,error,networkError}=await apiPost('/api/dead-stock/edit',{id,type,grade,weight,cones,note,changedBy:State.currentUser?.name,password:pwd||'',username:State.currentUser?.username});
    if(networkError)throw new Error(error);
    if(!ok){(setAlert||((m)=>showToast(m,'err')))(error||'Could not edit entry');return;}
    if(fromPreview)closeModal('deadstock-preview-modal-overlay');
    if(document.getElementById('deadstock-edit-modal-overlay'))closeModal('deadstock-edit-modal-overlay');
    showToast('Dead stock entry updated ✓');await _refreshAndRender(['deadStock'],renderAll);
  }catch(e){(setAlert||((m)=>showToast(m,'err')))('Network error — not saved: '+e.message);}
}

export async function voidDeadStock(id){
  const rec=(State.DB.deadStock||[]).find(x=>x.id===id);if(!rec)return;
  const reason=prompt('Reason for voiding (optional but recommended):')||'';
  const pwd=prompt('Enter your password to confirm:');
  if(!pwd){showToast('Void cancelled — password required','err');return;}
  await _openSimpleVoidPreview({
    endpoint:'/api/dead-stock/void',
    body:{id,reason,password:pwd,username:State.currentUser?.username,changedBy:State.currentUser?.name},
    label:(data)=>`Voiding Dead Stock entry <strong>${id}</strong> — ${data.entryGrade}, ${fmt(data.entryWeight)}kg. This cannot be undone.`,
    refreshKeys:['deadStock'],
    successMsg:'Dead stock entry voided ✓',
  });
}

export async function voidScrap(id){
  const rec=(State.DB.scrapLog||[]).find(x=>x.id===id);if(!rec)return;
  const reason=prompt('Reason for voiding (optional but recommended):')||'';
  const pwd=prompt('Enter your password to confirm:');
  if(!pwd){showToast('Void cancelled — password required','err');return;}
  await _openSimpleVoidPreview({
    endpoint:'/api/scrap/void',
    body:{id,reason,password:pwd,username:State.currentUser?.username,changedBy:State.currentUser?.name},
    label:(data)=>`Voiding Scrap entry <strong>${id}</strong> — ${fmt(data.entryWeight)}kg${data.entryCones?' / '+data.entryCones+' cones':''}. This gives the weight back to the source and cannot be undone.`,
    refreshKeys:['scrapLog'],
    successMsg:'Scrap entry voided ✓',
  });
}

export function onResidualTransferComboChange(){
  const sel=document.getElementById('rt-combo');
  const val=sel?.value;
  const infoEl=document.getElementById('rt-info');
  const wtEl=document.getElementById('rt-weight');
  if(!val){infoEl.innerHTML='';wtEl.max='';return;}
  const[lotId,grade,vendor]=val.split('||');
  const avail=getSoftBalanceWeightAvailable(lotId,grade,vendor);
  const bagsAvail=sel.selectedOptions[0]?.dataset.bags||0;
  infoEl.innerHTML=`Available to transfer: <strong style="color:var(--ye)">${fmt(avail)}kg / ${bagsAvail}b</strong>`;
  wtEl.max=avail;
}

export async function submitResidualTransfer(){
  const setAlert=msg=>{document.getElementById('rt-alert').innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;};
  const combo=document.getElementById('rt-combo')?.value;
  const weight=parseFloat(document.getElementById('rt-weight')?.value)||0;
  const type=document.getElementById('rt-type')?.value||'residual';
  const reason=document.getElementById('rt-reason')?.value.trim();
  if(!combo){setAlert('Select a lot + grade + vendor');return;}
  const[lotId,grade,vendor]=combo.split('||');
  if(weight<=0){setAlert('Enter weight to transfer');return;}
  if(!reason){setAlert('Enter reason');return;}
  try{
    const {ok,data,error,networkError}=await apiPost('/api/residual-transfer',{lotId,grade,vendor,weight,type,reason,changedBy:State.currentUser.name});
  if(networkError)throw new Error(error);
  if(!ok){setAlert(error||'Could not process transfer');return;}
    closeModal('residual-transfer-modal-overlay');
    showToast(type==='residual'?`Moved ${fmt(weight)}kg to Residual Stock (${grade}) ✓`:`Scrapped ${fmt(weight)}kg ✓`);
    renderResidualLog();await _refreshAndRender(['residualLog'],renderAll);
  }catch(e){setAlert('Network error — not saved: '+e.message);}
}

export function addResidualToNewDye(rsId,grade){
  // Navigate to dye start and pre-fill residual source
  nav('dye',document.getElementById('ni-dye'));
  setTimeout(()=>{openDyeStartModal();setTimeout(()=>{addResidualRow(rsId,grade);},200);},300);
}

export async function voidResidualTransfer(id){
  const rec=(State.DB.residualLog||[]).find(x=>x.id===id);if(!rec)return;
  const reason=prompt('Reason for voiding (optional but recommended):')||'';
  const pwd=prompt('Enter your password to confirm:');
  if(!pwd){showToast('Void cancelled — password required','err');return;}
  await _openSimpleVoidPreview({
    endpoint:'/api/residual-transfer/void',
    body:{id,reason,password:pwd,username:State.currentUser?.username,changedBy:State.currentUser?.name},
    label:(data)=>`Voiding ${rec.type==='residual'?'Residual':'Scrap'} transfer <strong>${id}</strong> — ${data.lotId}, ${fmt(data.entryWeight)}kg. This cannot be undone.`,
    refreshKeys:['residualLog'],
    successMsg:'Transfer voided ✓',
  });
}

export function openEditResidualTransfer(id){
  const rec=(State.DB.residualLog||[]).find(x=>x.id===id);if(!rec)return;
  // Sep 10 2026 — real, direct new feature built via direct discussion
  // with Priyam, establishing one clear rule across the whole app:
  // every real action shows a genuine preview of its actual effect
  // before committing — upgraded from the old prompt()-based flow to
  // a real modal, matching the same pattern already proven for Dead
  // Stock and Dye Input.
  document.getElementById('residual-edit-id').value=id;
  document.getElementById('residual-edit-weight').value=rec.weight||'';
  document.getElementById('residual-edit-reason').value=rec.reason||'';
  document.getElementById('residual-edit-alert').innerHTML='';
  openModal('residual-edit-modal-overlay');
}

export async function submitEditResidualTransferModal(){
  const setAlert=msg=>{document.getElementById('residual-edit-alert').innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;};
  const id=document.getElementById('residual-edit-id').value;
  const weight=parseFloat(document.getElementById('residual-edit-weight').value)||0;
  const reason=document.getElementById('residual-edit-reason').value.trim();
  if(weight<=0){setAlert('Enter weight');return;}
  if(!reason){setAlert('Enter reason');return;}
  try{
    const {ok,data,error,networkError}=await apiPost('/api/residual-transfer/edit',{id,weight,reason,dryRun:true});
    if(networkError){setAlert('Network error: '+error);return;}
    if(!ok||data.error){setAlert(data.error||error||'Could not preview');return;}
    _pendingResidualEditBody={id,weight,reason};
    _renderResidualPreview(data);
    closeModal('residual-edit-modal-overlay');
    const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';
    document.getElementById('residual-preview-pwd-row').style.display=isAdmin?'none':'';
    document.getElementById('residual-preview-pwd').value='';
    document.getElementById('residual-preview-alert').innerHTML='';
    openModal('residual-preview-modal-overlay');
  }catch(e){setAlert('Network error: '+e.message);}
}

let _pendingResidualEditBody=null;

function _renderResidualPreview(data){
  const box=document.getElementById('residual-preview-body');
  const weightChanged=Math.abs(data.newWeight-data.oldWeight)>0.01;
  box.innerHTML=`
    <div style="margin-bottom:10px;"><div style="font-size:.6rem;color:var(--mu);text-transform:uppercase;letter-spacing:.08em">Weight</div><div style="font-size:.95rem"><span style="color:var(--mu)">${fmt(data.oldWeight)}kg</span> → <span style="font-weight:800;${weightChanged?'color:var(--ac)':''}">${fmt(data.newWeight)}kg</span></div></div>
    ${data.wouldTriggerAdminOverride?`<div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:8px 10px;font-size:.72rem;color:var(--re);font-weight:700">⚠ Only ${fmt(data.pooledBalance)}kg is currently unconsumed in the shared pool — saving this will leave a real shortfall, flagged for review.</div>`:''}
  `;
}

export async function _doResidualEditSave(){
  const setAlert=msg=>{document.getElementById('residual-preview-alert').innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;};
  const body=_pendingResidualEditBody;
  if(!body)return;
  const isAdmin=State.currentUser?.role==='admin'||State.currentUser?.role==='manager';
  let pwd='';
  if(!isAdmin){pwd=document.getElementById('residual-preview-pwd').value;if(!pwd){setAlert('Enter your password');return;}}
  const _pbtn=document.getElementById('residual-preview-confirm-btn');
  if(_pbtn)_pbtn.disabled=true;
  try{
    const {ok,error,networkError}=await apiPost('/api/residual-transfer/edit',{id:body.id,weight:body.weight,reason:body.reason,changedBy:State.currentUser?.name,password:pwd,username:State.currentUser?.username});
    if(networkError)throw new Error(error);
    if(!ok){setAlert(error||'Could not edit transfer');if(_pbtn)_pbtn.disabled=false;return;}
    closeModal('residual-preview-modal-overlay');
    showToast('Transfer updated ✓');
    _pendingResidualEditBody=null;
    await _refreshAndRender(['residualLog'],renderAll);
  }catch(e){setAlert('Network error — not saved: '+e.message);if(_pbtn)_pbtn.disabled=false;}
}

export function openScrapModal(id,type){if(State.currentUser?.role!=='admin'&&State.currentUser?.role!=='manager'){showToast('Admin only','err');return;}
document.getElementById('scrap-entry-id').value=id;document.getElementById('scrap-entry-type').value=type;document.getElementById('scrap-alert').innerHTML='';document.getElementById('scrap-weight').value='';document.getElementById('scrap-reason').value='';const _sr=document.getElementById('scrap-cones-row');if(_sr){_sr.style.display=type==='recycle'?'':'none';const _sc=document.getElementById('scrap-cones');if(_sc)_sc.value='';}const _pr=document.getElementById('scrap-pool-row');if(_pr){_pr.style.display=type==='recycle'?'':'none';const _pp=document.getElementById('scrap-pool');if(_pp)_pp.value='steel';}const info=document.getElementById('scrap-info');if(type==='dead'){const ds=(State.DB.deadStock||[]).find(x=>x.id===id);const bal=getDeadStockBalance(id);info.innerHTML=`Dead Stock ${id} — ${ds?.grade} — ${ds?.type}<br>Remaining balance: <strong>${fmt(bal)}kg</strong>`;}else{const rc=(State.DB.recycleStock||[]).find(x=>x.id===id);const steel=getRecycleSteelAvail(id);const soft=getRecycleSoftenedAvail(id);info.innerHTML=`Recycle ${id} — ${rc?.dyeLotNo} — ${rc?.shade}<br>On Steel free: <strong>${steel.units} cones / ${fmt(steel.weight)}kg</strong> · Softened free: <strong>${soft.units} cones / ${fmt(soft.weight)}kg</strong>`;}
openModal('scrap-modal-overlay');}


export function onScrapPoolChange(){const type=document.getElementById('scrap-entry-type')?.value;if(type!=='recycle')return;const id=document.getElementById('scrap-entry-id')?.value;const pool=document.getElementById('scrap-pool')?.value==='softened'?'softened':'steel';const av=pool==='softened'?getRecycleSoftenedAvail(id):getRecycleSteelAvail(id);const _wt=document.getElementById('scrap-weight');if(_wt)_wt.max=av.weight;const _cn=document.getElementById('scrap-cones');if(_cn)_cn.max=av.units;}
export async function submitScrap(){const setAlert=msg=>{document.getElementById('scrap-alert').innerHTML=`<div class="alert-err" style="margin-bottom:8px">${msg}</div>`;};const id=document.getElementById('scrap-entry-id').value;const type=document.getElementById('scrap-entry-type').value;const weight=parseFloat(document.getElementById('scrap-weight').value)||0;const reason=document.getElementById('scrap-reason').value.trim();const cones=parseInt(document.getElementById('scrap-cones')?.value);const pool=document.getElementById('scrap-pool')?.value==='softened'?'softened':'steel';
if(type==='recycle'){if(isNaN(cones)||cones<0){setAlert('Enter the cones to scrap');return;}if(weight<=0&&cones<=0){setAlert('Enter the weight and/or the cones to scrap');return;}}else if(weight<=0){setAlert('Enter weight to scrap');return;}
if(reason.length<10){setAlert('Reason must be at least 10 characters');return;}
try{
  const {ok,data,error,networkError}=await apiPost('/api/scrap',{id,type,weight,...(type==='recycle'?{cones,pool}:{}),reason,changedBy:State.currentUser.name});
  if(networkError)throw new Error(error);
  if(!ok){setAlert(error||'Could not record scrap');return;}
  closeModal('scrap-modal-overlay');showToast('Scrap recorded ✓');await _refreshAndRender(['scrapLog'],renderAll);
}catch(e){setAlert('Network error — not saved: '+e.message);}
}




// Real, restored during the complete audit — these 18 window bindings
// were correctly written the first time, but got accidentally removed
// by a later, separate str_replace meant only for a different,
// pre-existing duplicate block, since the text happened to match.
// Confirmed via direct audit, not assumed.
window.addDeadStockRow = addDeadStockRow;
window.onDSRowSelect = onDSRowSelect;
window.addRecycleRow = addRecycleRow;
window.addResidualRow = addResidualRow;
window.onResidualRowChange = onResidualRowChange;
window.onRecycleLotSelect = onRecycleLotSelect;
window.openDeadStockModal = openDeadStockModal;
window.submitDeadStock = submitDeadStock;
window.openEditDeadStock = openEditDeadStock;
window.submitEditDeadStockModal = submitEditDeadStockModal;
window._doDeadStockEditSave = _doDeadStockEditSave;
window.voidDeadStock = voidDeadStock;
window.voidScrap = voidScrap;
window.onScrapPoolChange = onScrapPoolChange;
window.onResidualTransferComboChange = onResidualTransferComboChange;
window.submitResidualTransfer = submitResidualTransfer;
window.addResidualToNewDye = addResidualToNewDye;
window.voidResidualTransfer = voidResidualTransfer;
window.openEditResidualTransfer = openEditResidualTransfer;
window.submitEditResidualTransferModal = submitEditResidualTransferModal;
window._doResidualEditSave = _doResidualEditSave;
window.openScrapModal = openScrapModal;
window.submitScrap = submitScrap;
window.onDsrVendorChange = onDsrVendorChange;
window.onDsrGradeChange = onDsrGradeChange;
