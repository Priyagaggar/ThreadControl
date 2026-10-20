// recyclesoft.js — Recycle Phase 2b: the Recycle page (Stock + Soft tabs) and the Recycle Soft Start/End modal.
import { State, apiPost, openModal, closeModal, showToast, fmt, fmtHrs, fmtTS, hrsBetween, machinesForStage, workersSorted,
  getRCStatus, getRecycleSteelAvail, getRecycleSoftenedAvail, _refreshAndRender } from './core.js';
import { renderAll } from './pages.js';

export function switchRecycleTab(tab, el) {
  State._recycleTab = tab;
  ['stock', 'soft'].forEach(t => {
    const panel = document.getElementById('rcp-panel-' + t);
    if (panel) panel.style.display = t === tab ? '' : 'none';
    const btn = document.getElementById('rcp-tab-' + t);
    if (btn) btn.classList.toggle('active', t === tab);
  });
  if (tab === 'stock') renderRecycleStockPools(); else renderRecycleSoftEntries();
}

export function renderRecyclePage() { switchRecycleTab(State._recycleTab || 'stock', null); }

export function renderRecycleStockPools() {
  const tbody = document.getElementById('rcp-stock-tbody');
  if (!tbody) return;
  const rows = (State.DB.recycleStock || []).filter(r => r.status !== 'Voided');
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="7" style="color:var(--mu);text-align:center;padding:16px">No recycle stock yet</td></tr>'; return; }
  tbody.innerHTML = rows.map(r => {
    const st = getRCStatus(r.id);
    const steel = getRecycleSteelAvail(r.id), soft = getRecycleSoftenedAvail(r.id);
    const stColor = st.available ? 'var(--gr)' : (st.status === 'Consumed' || st.status === 'Scrapped') ? 'var(--mu)' : 'var(--ye)';
    return `<tr><td class="mono" style="color:var(--ac);font-weight:700">${r.id}</td><td class="mono" style="color:var(--ac)">${r.dyeLotNo || ''}</td><td style="font-size:0.78rem">${r.shade || ''}</td>` +
      `<td class="mono">${steel.units} cones / ${fmt(steel.weight)}kg</td><td class="mono">${soft.units} cones / ${fmt(soft.weight)}kg</td>` +
      `<td><span style="font-size:0.7rem;font-weight:700;color:${stColor}">${st.status}</span></td>` +
      `<td style="white-space:nowrap"><button class="btn btn-ghost btn-xs" onclick="openRecycleSoftModal('Start','${r.id}')">Soft</button> <button class="btn btn-danger btn-xs" onclick="openScrapModal('${r.id}','recycle')">Scrap</button></td></tr>`;
  }).join('');
}

export function renderRecycleSoftEntries() {
  const tbody = document.getElementById('rcp-soft-tbody');
  if (!tbody) return;
  const rows = [...(State.DB.recycleSoft || [])].sort((a, b) => (b.startTime || '').localeCompare(a.startTime || ''));
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="10" style="color:var(--mu);text-align:center;padding:16px">No Recycle Soft entries yet</td></tr>'; return; }
  const stC = { InProgress: 'var(--bl)', Pending: 'var(--ye)', Approved: 'var(--gr)', Rejected: 'var(--re)', Voided: 'var(--mu)' };
  tbody.innerHTML = rows.map(e => `<tr><td class="mono" style="color:var(--ac);font-weight:700">${e.id}</td><td class="mono" style="color:var(--ac)">${e.recycleId || ''}</td><td class="mono">${e.dyeLotNo || ''}</td>` +
    `<td class="mono">${e.inCones || 0}c / ${fmt(e.inWeight)}kg</td><td class="mono">${e.outCones ? e.outCones + 'c / ' + fmt(e.outWeight) + 'kg' : '—'}</td>` +
    `<td class="mono" style="color:var(--mu)">${e.wasteCones != null ? e.wasteCones + 'c / ' + fmt(e.wasteWeight) + 'kg' : '—'}</td>` +
    `<td style="font-size:0.72rem">${e.machine || ''}</td><td style="font-size:0.72rem">${e.startWorker || ''}</td>` +
    `<td><span style="font-size:0.7rem;font-weight:700;color:${stC[e.status] || 'var(--tx)'}">${e.status}</span></td>` +
    `<td style="white-space:nowrap">${e.status === 'InProgress' ? `<button class="btn btn-success btn-xs" onclick="openRecycleSoftModal('End','${e.id}')">End</button>` : ''}${(e.status === 'Approved' || e.status === 'Edited-Approved' || e.status === 'Rejected') ? `<button class="btn btn-ghost btn-xs" onclick="openEditEntryModal('${e.id}','recycleSoft')">Edit</button> <button class="btn btn-danger btn-xs" onclick="openVoidRecycleSoftModal('${e.id}')">Void</button>` : ''}</td></tr>`).join('');
}

function _rcOptionsForSoften() {
  return (State.DB.recycleStock || []).filter(r => r.status !== 'Voided' && (getRecycleSteelAvail(r.id).weight > 0 || getRecycleSteelAvail(r.id).units > 0));
}

export function openRecycleSoftModal(mode, presetId) {
  State._rcsoftMode = mode;
  document.getElementById('rcsoft-modal-title').textContent = mode === 'Start' ? '▶ Start Soften' : '✓ End Soften';
  document.getElementById('rcsoft-alert').innerHTML = '';
  document.getElementById('rcsoft-notes').value = '';
  const show = (id, v) => { const el = document.getElementById(id); if (el) el.style.display = v ? '' : 'none'; };
  const M = machinesForStage('Soft'), W = workersSorted();
  const opts = arr => '<option value="">Select...</option>' + arr.map(v => `<option value="${v}">${v}</option>`).join('');
  const mSel = document.getElementById('rcsoft-machine-select'); if (mSel) mSel.innerHTML = opts(M);
  const wSel = document.getElementById('rcsoft-worker-select'); if (wSel) wSel.innerHTML = opts(W);
  if (mode === 'Start') {
    show('rcsoft-rc-row', true); show('rcsoft-in-cones-row', true); show('rcsoft-in-weight-row', true);
    show('rcsoft-machine-row', true); show('rcsoft-worker-row', true);
    show('rcsoft-entry-row', false); show('rcsoft-end-ref', false); show('rcsoft-out-cones-row', false); show('rcsoft-out-weight-row', false);
    document.getElementById('rcsoft-in-cones').value = ''; document.getElementById('rcsoft-in-weight').value = '';
    const rcSel = document.getElementById('rcsoft-rc-select');
    const avail = _rcOptionsForSoften();
    if (rcSel) rcSel.innerHTML = '<option value="">Select...</option>' + avail.map(r => {
      const av = getRecycleSteelAvail(r.id);
      return `<option value="${r.id}" ${r.id === presetId ? 'selected' : ''}>${r.id} — ${r.dyeLotNo || ''} — ${r.shade || ''} (${av.units} cones / ${fmt(av.weight)}kg free)</option>`;
    }).join('');
    onRecycleSoftRcSelect();
    document.getElementById('rcsoft-submit-btn').textContent = '▶ Start Soften';
  } else {
    show('rcsoft-rc-row', false); show('rcsoft-in-cones-row', false); show('rcsoft-in-weight-row', false);
    show('rcsoft-machine-row', false); show('rcsoft-worker-row', false);
    show('rcsoft-entry-row', true); show('rcsoft-out-cones-row', true); show('rcsoft-out-weight-row', true);
    document.getElementById('rcsoft-out-cones').value = ''; document.getElementById('rcsoft-out-weight').value = '';
    const inProg = (State.DB.recycleSoft || []).filter(e => e.status === 'InProgress');
    const entSel = document.getElementById('rcsoft-entry-select');
    if (entSel) entSel.innerHTML = '<option value="">Select entry...</option>' + inProg.map(e =>
      `<option value="${e.id}" ${e.id === presetId ? 'selected' : ''}>${e.id} — ${e.dyeLotNo || ''} | ${e.inCones || 0} cones, ${fmt(e.inWeight)}kg in</option>`).join('');
    document.getElementById('rcsoft-submit-btn').textContent = '✓ End Soften';
    showRecycleSoftEndRef();
  }
  openModal('rcsoft-modal-overlay');
}

export function onRecycleSoftRcSelect() {
  const sel = document.getElementById('rcsoft-rc-select');
  const info = document.getElementById('rcsoft-rc-info');
  if (!sel || !info) return;
  const rcId = sel.value;
  if (!rcId) { info.textContent = ''; return; }
  const av = getRecycleSteelAvail(rcId);
  info.textContent = `Free: ${av.units} cones / ${fmt(av.weight)}kg`;
  const c = document.getElementById('rcsoft-in-cones'); if (c) c.max = av.units;
  const w = document.getElementById('rcsoft-in-weight'); if (w) w.max = av.weight;
}

export function showRecycleSoftEndRef() {
  const id = document.getElementById('rcsoft-entry-select')?.value;
  const ref = document.getElementById('rcsoft-end-ref');
  if (!id) { if (ref) ref.style.display = 'none'; return; }
  const e = (State.DB.recycleSoft || []).find(x => x.id === id);
  if (!e || !ref) { if (ref) ref.style.display = 'none'; return; }
  ref.style.display = 'block';
  const elapsed = hrsBetween(e.startTime, new Date().toISOString());
  ref.innerHTML = `<div style="font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--gr);margin-bottom:10px;">📋 Start Reference — Recycle Soft</div>` +
    `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">` +
    `<div><div style="font-size:.58rem;color:var(--mu);text-transform:uppercase;">Recycle / Dye Lot</div><div style="font-size:.82rem;font-weight:700">${e.recycleId || '—'}</div><div style="font-size:.65rem;color:var(--mu)">${e.dyeLotNo || ''}</div></div>` +
    `<div><div style="font-size:.58rem;color:var(--mu);text-transform:uppercase;">Input Loaded</div><div style="font-size:.9rem;font-weight:700;color:var(--bl)">${e.inCones || 0}c / ${fmt(e.inWeight)}kg</div></div>` +
    `<div><div style="font-size:.58rem;color:var(--mu);text-transform:uppercase;">Running Time</div><div style="font-size:.9rem;font-weight:700;color:var(--cy)">${fmtHrs(elapsed)}</div><div style="font-size:.65rem;color:var(--mu)">since ${fmtTS(e.startTime)}</div></div></div>` +
    `<div style="margin-top:8px;padding:7px 10px;background:rgba(59,130,246,.08);border-radius:5px;font-size:.7rem;color:var(--bl);">ℹ Output cannot exceed <strong>${e.inCones}c / ${fmt(e.inWeight)}kg</strong></div>`;
  const oc = document.getElementById('rcsoft-out-cones'); if (oc) { oc.max = e.inCones; oc.placeholder = '0–' + e.inCones; }
  const ow = document.getElementById('rcsoft-out-weight'); if (ow) { ow.max = e.inWeight; ow.placeholder = '0–' + fmt(e.inWeight); }
}

export async function submitRecycleSoft() {
  const setAlert = msg => { document.getElementById('rcsoft-alert').innerHTML = `<div class="alert-err" style="margin-bottom:8px">${msg}</div>`; };
  const btn = document.getElementById('rcsoft-submit-btn');
  if (State._rcsoftMode === 'Start') {
    const recycleId = document.getElementById('rcsoft-rc-select').value;
    const inCones = parseInt(document.getElementById('rcsoft-in-cones')?.value) || 0;
    const inWeight = parseFloat(document.getElementById('rcsoft-in-weight')?.value) || 0;
    const machine = document.getElementById('rcsoft-machine-select')?.value || '';
    const worker = document.getElementById('rcsoft-worker-select')?.value || '';
    const notes = document.getElementById('rcsoft-notes').value.trim();
    if (!recycleId) { setAlert('Select a recycle entry'); return; }
    if (inCones <= 0) { setAlert('Enter cones'); return; }
    if (inWeight <= 0) { setAlert('Weight must be > 0'); return; }
    if (!machine) { setAlert('Select machine'); return; }
    if (!worker) { setAlert('Select worker'); return; }
    if (btn) btn.disabled = true;
    try {
      const { ok, error, networkError } = await apiPost('/api/recycle-soft/start', { recycleId, inCones, inWeight, machine, worker, notes, changedBy: State.currentUser.name, idempotencyKey: crypto.randomUUID() });
      if (networkError) throw new Error(error);
      if (!ok) { setAlert(error || 'Failed to start'); if (btn) btn.disabled = false; return; }
      if (btn) btn.disabled = false; closeModal('rcsoft-modal-overlay'); showToast('Recycle Soft started ✓');
      await _refreshAndRender(['recycleSoft'], renderAll);
    } catch (e) { setAlert('Network error — not saved: ' + e.message); if (btn) btn.disabled = false; }
  } else {
    const id = document.getElementById('rcsoft-entry-select').value;
    const outCones = parseInt(document.getElementById('rcsoft-out-cones')?.value) || 0;
    const outWeight = parseFloat(document.getElementById('rcsoft-out-weight')?.value) || 0;
    const notes = document.getElementById('rcsoft-notes').value.trim();
    if (!id) { setAlert('Select an entry to end'); return; }
    if (outCones <= 0) { setAlert('Enter output cones'); return; }
    if (outWeight <= 0) { setAlert('Output weight must be > 0'); return; }
    if (btn) btn.disabled = true;
    try {
      const { ok, error, networkError } = await apiPost('/api/recycle-soft/end', { id, outCones, outWeight, notes, changedBy: State.currentUser.name, idempotencyKey: crypto.randomUUID() });
      if (networkError) throw new Error(error);
      if (!ok) { setAlert(error || 'Failed to end'); if (btn) btn.disabled = false; return; }
      if (btn) btn.disabled = false; closeModal('rcsoft-modal-overlay'); showToast('Recycle Soft ended ✓ — pending approval');
      await _refreshAndRender(['recycleSoft'], renderAll);
    } catch (e) { setAlert('Network error — not saved: ' + e.message); if (btn) btn.disabled = false; }
  }
}

export async function approveRecycleSoft(id) {
  try {
    const { ok, error, networkError } = await apiPost('/api/approve-entry', { type: 'recycleSoft', id, changedBy: State.currentUser.name });
    if (networkError) throw new Error(error);
    if (!ok) { showToast(error || 'Could not approve', 'err'); return; }
    showToast('Recycle Soft approved ✓'); await _refreshAndRender(['recycleSoft'], renderAll);
  } catch (e) { showToast('Network error — ' + e.message, 'err'); }
}

export async function rejectRecycleSoft(id) {
  try {
    const { ok, error, networkError } = await apiPost('/api/reject', { type: 'recycleSoft', id, changedBy: State.currentUser?.name, role: State.currentUser?.role });
    if (networkError) throw new Error(error);
    if (!ok) { showToast(error || 'Reject failed', 'err'); return; }
    showToast('Recycle Soft rejected', 'err'); await _refreshAndRender(['recycleSoft'], renderAll);
  } catch (e) { showToast('Network error — ' + e.message, 'err'); }
}

window.switchRecycleTab = switchRecycleTab;
window.openRecycleSoftModal = openRecycleSoftModal;
window.onRecycleSoftRcSelect = onRecycleSoftRcSelect;
window.showRecycleSoftEndRef = showRecycleSoftEndRef;
window.submitRecycleSoft = submitRecycleSoft;
window.approveRecycleSoft = approveRecycleSoft;
window.rejectRecycleSoft = rejectRecycleSoft;
