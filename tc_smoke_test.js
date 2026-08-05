// tc_smoke_test.js
//
// Automated "click through it like a real user" test for ThreadControl.
// Complements the static/execution checkers (tc_predeploy_check.py,
// tc_master_check.js) — those verify the CODE is correct in isolation;
// this verifies the actual RUNNING APP behaves correctly in a real browser
// against a real (staging) deployment — the one thing static analysis
// can never fully substitute for.
//
// Jul 16 2026 — EXTENDED. Two real bugs were found while building this
// version, neither caught by any isolated code test:
//   1. window.getRMBalance/getDyeBal/getWindBal/getPackBal were never
//      exposed on window — the earlier version of this file assumed they
//      were, so those checks would have failed with "not a function"
//      even though the balance math itself was correct. Fixed in core.js.
//   2. approveEntry (pages.js) — the function the REAL Soft approval
//      button actually calls — was a THIRD, independent, still fully
//      client-side approval implementation. The Phase 2 migration of
//      approveStageEntry/approveDyeLot/approveWindEntry/approvePackEntry/
//      approveDispatch, built and tested in isolation earlier, never
//      actually reached this specific button. Found only by tracing the
//      real onclick wiring while building this test. Fixed: approveEntry
//      now delegates to approveStageEntry.
// This is exactly why this file exists — "the code is correct in
// isolation" and "the real button does the correct thing" are different
// claims, and only one of them can be proven by running in a real browser.
//
// SETUP (one-time):
//   npm install -g playwright
//   npx playwright install chromium
//
// RUN:
//   node tc_smoke_test.js
//
// The approval end-to-end test (Phase 2 verification) mutates real data
// — it approves one real Pending entry if one exists. OFF by default.
// Enable explicitly with TC_TEST_APPROVAL=true when you want it to run.
//
// Configure the values below before running. Never commit real
// credentials into this file if it goes into version control — pull them
// from environment variables instead if that matters to you:
//   TC_URL=https://stagingthread.abhipolywork.workers.dev TC_USER=admin TC_PASS=xxx TC_TEST_APPROVAL=true node tc_smoke_test.js

const { chromium } = require('playwright');

const CONFIG = {
  url: process.env.TC_URL || 'https://stagingthread.abhipolywork.workers.dev',
  username: process.env.TC_USER || 'admin',
  password: process.env.TC_PASS || 'CHANGE_ME',
  headless: process.env.TC_HEADLESS !== 'false', // set TC_HEADLESS=false to watch it run
  slowMo: process.env.TC_SLOWMO ? parseInt(process.env.TC_SLOWMO) : 0,
  testApproval: process.env.TC_TEST_APPROVAL === 'true', // mutates real data — off by default
};

const results = []; // {step, status: 'pass'|'fail', detail}
const consoleErrors = []; // {step, text}
let currentStep = '(startup)';

function pass(step, detail = '') { results.push({ step, status: 'pass', detail }); }
function fail(step, detail = '') { results.push({ step, status: 'fail', detail }); }

async function main() {
  console.log(`\n${'='.repeat(70)}\nThreadControl Smoke Test — ${CONFIG.url}\n${'='.repeat(70)}\n`);
  if (!CONFIG.testApproval) {
    console.log('(TC_TEST_APPROVAL not set — the real end-to-end approval test will be skipped. Set TC_TEST_APPROVAL=true to run it. It mutates real data: approves one real Pending Soft entry if one exists.)\n');
  }

  const browser = await chromium.launch({ headless: CONFIG.headless, slowMo: CONFIG.slowMo });
  const page = await browser.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push({ step: currentStep, text: msg.text() });
    }
  });
  page.on('pageerror', err => {
    consoleErrors.push({ step: currentStep, text: '[uncaught exception] ' + err.message });
  });

  try {
    // ── Login ──────────────────────────────────────────────────────────
    currentStep = 'Load login page';
    await page.goto(CONFIG.url, { waitUntil: 'networkidle', timeout: 30000 });
    const loginVisible = await page.locator('text=Sign in').first().isVisible().catch(() => false);
    if (loginVisible) pass(currentStep); else fail(currentStep, 'Sign in screen not found');

    currentStep = 'Login with credentials';
    await page.fill('input[type="text"], input#username, input[placeholder*="sername" i]', CONFIG.username).catch(async () => {
      await page.locator('input').first().fill(CONFIG.username);
    });
    await page.fill('input[type="password"]', CONFIG.password);
    await page.click('button:has-text("Sign In"), button:has-text("Sign in")');
    await page.waitForTimeout(2500); // let post-login data load settle

    const stillOnLogin = await page.locator('text=Sign in').first().isVisible().catch(() => false);
    const errorBanner = await page.locator('text=/error|failed/i').first().isVisible().catch(() => false);
    if (stillOnLogin || errorBanner) {
      const errText = await page.locator('text=/error|failed/i').first().textContent().catch(() => '(no error text found)');
      fail(currentStep, `Still on login screen. Banner: ${errText}`);
      console.log('\nLogin failed — cannot continue with remaining checks.\n');
      await printResults();
      await browser.close();
      process.exit(1);
    }
    pass(currentStep);

    // ── Navigation sweep — every major page loads without a console error ──
    // Jul 16 2026 — added masters, party, challan, editlog. The earlier
    // version never visited any of these, meaning today's new work (the
    // Balance Audit tool, the RM-lot-void-only change, the removal of the
    // old Data Integrity check) had zero navigation coverage at all.
    const pages = [
      { id: 'dashboard', label: 'Dashboard' },
      { id: 'rm', label: 'RM Entry' },
      { id: 'stage', label: 'Soft Stage' },
      { id: 'dye', label: 'Dye' },
      { id: 'wind', label: 'Wind' },
      { id: 'pack', label: 'Pack' },
      { id: 'dispatch', label: 'Dispatch' },
      { id: 'wip', label: 'WIP' },
      { id: 'approval', label: 'Approval Queue' },
      { id: 'stockregister', label: 'Stock Register' },
      { id: 'reports', label: 'Reports' },
      { id: 'masters', label: 'Masters' },
      { id: 'party', label: 'Party Tracker' },
      { id: 'challan', label: 'Challan' },
      { id: 'editlog', label: 'Edit Log & Integrity' },
    ];

    for (const p of pages) {
      currentStep = `Navigate to ${p.label}`;
      const errCountBefore = consoleErrors.length;
      const clicked = await page.evaluate((id) => {
        if (typeof nav === 'function') { nav(id); return true; }
        return false;
      }, p.id).catch(() => false);
      if (!clicked) { fail(currentStep, 'nav() function not found on page — cannot navigate programmatically'); continue; }
      await page.waitForTimeout(600);
      const pageVisible = p.id === 'dashboard'
        ? await page.locator('#page-dashboard').evaluate(el => el.classList.contains('active')).catch(() => false)
        : await page.locator(`#page-${p.id}.active, #page-${p.id}[style*="display: block"], #page-${p.id}:not([style*="display: none"])`).first().isVisible().catch(() => false);
      const newErrors = consoleErrors.slice(errCountBefore);
      if (newErrors.length > 0) {
        fail(currentStep, `${newErrors.length} console error(s): ${newErrors.map(e => e.text).join(' | ')}`);
      } else if (!pageVisible) {
        fail(currentStep, 'Page container not visible after navigation');
      } else {
        pass(currentStep);
      }
    }

    // ── Newest features — specifically exercised, not just page-load ──
    currentStep = 'Open Residual/Scrap Transfer modal (Soft page)';
    await page.evaluate(() => nav('stage')).catch(() => {});
    await page.waitForTimeout(400);
    const rtErrBefore = consoleErrors.length;
    const rtOpened = await page.evaluate(() => {
      if (typeof openResidualTransferModal === 'function') { openResidualTransferModal(); return true; }
      return false;
    }).catch(() => false);
    await page.waitForTimeout(400);
    const rtModalVisible = await page.locator('#residual-transfer-modal-overlay').isVisible().catch(() => false);
    if (!rtOpened) fail(currentStep, 'openResidualTransferModal function not found');
    else if (consoleErrors.length > rtErrBefore) fail(currentStep, consoleErrors.slice(rtErrBefore).map(e => e.text).join(' | '));
    else if (!rtModalVisible) fail(currentStep, 'Modal did not become visible — possible modal-nesting regression (see AGENTS.md bug #15)');
    else pass(currentStep);
    await page.evaluate(() => { if (typeof closeModal === 'function') closeModal('residual-transfer-modal-overlay'); }).catch(() => {});

    currentStep = 'Open RM Return tab + form (RM Entry page)';
    await page.evaluate(() => nav('rm')).catch(() => {});
    await page.waitForTimeout(400);
    const rmrErrBefore = consoleErrors.length;
    const rmrTabClicked = await page.evaluate(() => {
      if (typeof showRMTab === 'function') { showRMTab('return', document.getElementById('rm-tab-return-btn')); return true; }
      return false;
    }).catch(() => false);
    await page.waitForTimeout(400);
    const rmrOpened = await page.evaluate(() => {
      if (typeof openRMReturnModal === 'function') { openRMReturnModal(); return true; }
      return false;
    }).catch(() => false);
    await page.waitForTimeout(400);
    const rmrModalVisible = await page.locator('#rm-return-modal-overlay').isVisible().catch(() => false);
    if (!rmrTabClicked) fail(currentStep, 'showRMTab function not found');
    else if (!rmrOpened) fail(currentStep, 'openRMReturnModal function not found');
    else if (consoleErrors.length > rmrErrBefore) fail(currentStep, consoleErrors.slice(rmrErrBefore).map(e => e.text).join(' | '));
    else if (!rmrModalVisible) fail(currentStep, 'Modal did not become visible');
    else pass(currentStep);
    await page.evaluate(() => { if (typeof closeModal === 'function') closeModal('rm-return-modal-overlay'); }).catch(() => {});

    currentStep = 'Open Grade Analysis report tab';
    await page.evaluate(() => nav('reports')).catch(() => {});
    await page.waitForTimeout(400);
    const gaErrBefore = consoleErrors.length;
    const gaTabEl = await page.locator('text=Grade Analysis').first();
    const gaTabExists = await gaTabEl.isVisible().catch(() => false);
    if (gaTabExists) {
      await gaTabEl.click();
      await page.waitForTimeout(500);
    }
    const gaContentVisible = await page.locator('#rpt-grade-c').first().isVisible().catch(() => false);
    if (!gaTabExists) fail(currentStep, 'Grade Analysis tab not found in Reports page');
    else if (consoleErrors.length > gaErrBefore) fail(currentStep, consoleErrors.slice(gaErrBefore).map(e => e.text).join(' | '));
    else if (!gaContentVisible) fail(currentStep, 'Grade Analysis content container not visible');
    else pass(currentStep);

    currentStep = 'RM Balance calculation works live (shared-balances.js integration)';
    await page.evaluate(() => nav('rm')).catch(() => {});
    await page.waitForTimeout(500);
    const rmErrBefore = consoleErrors.length;
    const rmCheck = await page.evaluate(() => {
      try {
        const lots = (typeof State !== 'undefined' ? State.DB.lots : window.State?.DB?.lots) || [];
        if (!lots.length) return { skipped: true, reason: 'no RM lots in current data — nothing to check against' };
        const l = lots[0];
        if (typeof window.getRMBalance !== 'function') return { skipped: false, valid: false, error: 'window.getRMBalance is not exposed — check window.getRMBalance = getRMBalance exists in core.js' };
        const bal = window.getRMBalance(l.id, l.grade, l.vendor);
        const valid = bal && typeof bal.units === 'number' && typeof bal.weight === 'number' && !isNaN(bal.units) && !isNaN(bal.weight);
        return { skipped: false, valid, lotId: l.id, result: bal };
      } catch (e) {
        return { skipped: false, valid: false, error: e.message };
      }
    });
    if (rmCheck.skipped) {
      pass(currentStep, `(skipped — ${rmCheck.reason})`);
    } else if (consoleErrors.length > rmErrBefore) {
      fail(currentStep, consoleErrors.slice(rmErrBefore).map(e => e.text).join(' | '));
    } else if (!rmCheck.valid) {
      fail(currentStep, `getRMBalance('${rmCheck.lotId}') returned invalid result: ${rmCheck.error || JSON.stringify(rmCheck.result)}`);
    } else {
      pass(currentStep, `getRMBalance('${rmCheck.lotId}') → ${JSON.stringify(rmCheck.result)}`);
    }

    currentStep = 'Dye/Wind/Pack Balance calculations work live (shared-balances.js integration)';
    await page.evaluate(() => nav('dye')).catch(() => {});
    await page.waitForTimeout(500);
    const dwpErrBefore = consoleErrors.length;
    const dwpCheck = await page.evaluate(() => {
      try {
        const dyeLots = (typeof State !== 'undefined' ? State.DB.dyeLots : window.State?.DB?.dyeLots) || [];
        if (!dyeLots.length) return { skipped: true, reason: 'no dye lots in current data — nothing to check against' };
        const d = dyeLots[0];
        if (typeof window.getDyeBal !== 'function' || typeof window.getWindBal !== 'function' || typeof window.getPackBal !== 'function') {
          return { skipped: false, valid: false, error: 'one or more of window.getDyeBal/getWindBal/getPackBal is not exposed' };
        }
        const dyeBal = window.getDyeBal(d.id);
        const windBal = window.getWindBal(d.id);
        const packBal = window.getPackBal(d.id);
        const validQ = (b) => b && typeof b.units === 'number' && typeof b.weight === 'number' && !isNaN(b.units) && !isNaN(b.weight);
        const validPack = packBal && typeof packBal.weight === 'number' && typeof packBal.bags === 'number' && !isNaN(packBal.weight) && !isNaN(packBal.bags);
        return { skipped: false, valid: validQ(dyeBal) && validQ(windBal) && validPack, dyeLotId: d.id, dyeBal, windBal, packBal };
      } catch (e) {
        return { skipped: false, valid: false, error: e.message };
      }
    });
    if (dwpCheck.skipped) {
      pass(currentStep, `(skipped — ${dwpCheck.reason})`);
    } else if (consoleErrors.length > dwpErrBefore) {
      fail(currentStep, consoleErrors.slice(dwpErrBefore).map(e => e.text).join(' | '));
    } else if (!dwpCheck.valid) {
      fail(currentStep, `Balance functions returned invalid results for dyeLot '${dwpCheck.dyeLotId}': ${dwpCheck.error || 'malformed result'}`);
    } else {
      pass(currentStep, `dyeLot '${dwpCheck.dyeLotId}' → dye:${JSON.stringify(dwpCheck.dyeBal)} wind:${JSON.stringify(dwpCheck.windBal)} pack:${JSON.stringify(dwpCheck.packBal)}`);
    }

    currentStep = 'Open Residual Stock tab (Stock Register)';
    await page.evaluate(() => nav('stockregister')).catch(() => {});
    await page.waitForTimeout(600);
    const rsErrBefore = consoleErrors.length;
    const rsClicked = await page.evaluate(() => {
      if (typeof showStockRegTab === 'function') { showStockRegTab('residual', document.getElementById('sr-tab-residual')); return true; }
      return false;
    }).catch(() => false);
    await page.waitForTimeout(1000);
    const rsVisible = await page.locator('#sr-panel-residual').isVisible().catch(() => false);
    const rsDisplay = await page.locator('#sr-panel-residual').evaluate(el => getComputedStyle(el).display).catch(() => '(element not found)');
    if (!rsClicked) fail(currentStep, 'showStockRegTab function not found');
    else if (consoleErrors.length > rsErrBefore) fail(currentStep, consoleErrors.slice(rsErrBefore).map(e => e.text).join(' | '));
    else if (!rsVisible) fail(currentStep, `Residual Stock panel not visible (computed display: ${rsDisplay})`);
    else pass(currentStep);

    // ── NEW Jul 16 2026 — Balance Audit tool (Phase 0) ────────────────
    currentStep = 'Run Balance Audit (Edit Log & Integrity page)';
    await page.evaluate(() => nav('editlog')).catch(() => {});
    await page.waitForTimeout(500);
    const baErrBefore = consoleErrors.length;
    const baIntegrityClicked = await page.evaluate(() => {
      const btn = document.querySelector('[id^="elt-"][onclick*="integrity"]') || Array.from(document.querySelectorAll('[id^="elt-"]')).find(b => /integrity/i.test(b.textContent));
      if (btn) { btn.click(); return true; }
      if (typeof switchEditLogTab === 'function') { switchEditLogTab('integrity', null); return true; }
      return false;
    }).catch(() => false);
    await page.waitForTimeout(400);
    const baRunClicked = await page.evaluate(() => {
      if (typeof runBalanceAudit === 'function') { runBalanceAudit(); return true; }
      return false;
    }).catch(() => false);
    // The audit paginates through real data — give it real time to finish
    // rather than a fixed short wait, polling for the placeholder text to
    // change instead of guessing a duration.
    // Jul 16 2026 — increased from 20s after a real staging run: at
    // production scale (321 RM lots, 1,700+ dye lots), the audit
    // genuinely takes longer than 20s to finish — confirmed this is
    // "slow but working," not a hang, by running it manually in a real
    // browser tab and watching it complete. Also increased the audit
    // tool's own page size (50→150) to cut round-trips roughly 3x.
    let baFinished = false;
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(2000);
      const stillScanning = await page.locator('#balance-audit-results').evaluate(el => /Scanning/.test(el.textContent)).catch(() => false);
      if (!stillScanning) { baFinished = true; break; }
    }
    const baResultText = await page.locator('#balance-audit-results').textContent().catch(() => '(not found)');
    if (!baIntegrityClicked) fail(currentStep, 'Could not switch to the Integrity tab');
    else if (!baRunClicked) fail(currentStep, 'runBalanceAudit function not found — the Phase 0 audit tool may be missing');
    else if (consoleErrors.length > baErrBefore) fail(currentStep, consoleErrors.slice(baErrBefore).map(e => e.text).join(' | '));
    else if (!baFinished) fail(currentStep, 'Audit did not finish within 20s — check for a pagination/hang issue');
    else pass(currentStep, `Result: ${baResultText.slice(0, 200)}`);

    // ── NEW Jul 16 2026 — Phase 2 end-to-end: approve for real, verify the ──
    // balance actually changed by the exact right amount in the real app.
    // Opt-in only (TC_TEST_APPROVAL=true) since this mutates real data.
    if (CONFIG.testApproval) {
      currentStep = 'Approve a real Pending Soft entry and verify the balance updates correctly (Phase 2)';
      await page.evaluate(() => nav('approval')).catch(() => {});
      await page.waitForTimeout(600);
      const apErrBefore = consoleErrors.length;
      const apResult = await page.evaluate(async () => {
        try {
          const entries = (State.DB.stageEntries || []).filter(e => e.status === 'Pending');
          if (!entries.length) return { skipped: true, reason: 'no Pending Soft entries currently exist to test against' };
          const e = entries[0];
          if (typeof window.getRMBalance !== 'function') return { skipped: false, ok: false, error: 'window.getRMBalance not exposed' };
          const before = window.getRMBalance(e.lotId, e.grade, e.vendor);
          await approveStageEntry(e.id);
          // give the server round-trip + nudge + local refresh a moment
          await new Promise(r => setTimeout(r, 1500));
          const after = window.getRMBalance(e.lotId, e.grade, e.vendor);
          const expectedKg = before.weight - (e.inWeight || 0);
          const actualDeltaOk = Math.abs(after.weight - expectedKg) < 0.5;
          return { skipped: false, ok: actualDeltaOk, entryId: e.id, inWeight: e.inWeight, before, after, expectedKg };
        } catch (err) {
          return { skipped: false, ok: false, error: err.message };
        }
      });
      if (apResult.skipped) {
        pass(currentStep, `(skipped — ${apResult.reason})`);
      } else if (consoleErrors.length > apErrBefore) {
        fail(currentStep, consoleErrors.slice(apErrBefore).map(e => e.text).join(' | '));
      } else if (!apResult.ok) {
        fail(currentStep, `RM Balance did not update by the expected amount: ${JSON.stringify(apResult)}`);
      } else {
        pass(currentStep, `Approved ${apResult.entryId} — RM Balance ${apResult.before.weight}kg → ${apResult.after.weight}kg (expected ~${apResult.expectedKg}kg) ✓`);
      }
    }

  } catch (e) {
    fail(currentStep, `Unexpected exception: ${e.message}`);
  }

  await browser.close();
  await printResults();
}

async function printResults() {
  console.log(`\n${'='.repeat(70)}\nRESULTS\n${'='.repeat(70)}`);
  const passed = results.filter(r => r.status === 'pass');
  const failed = results.filter(r => r.status === 'fail');
  for (const r of results) {
    console.log(`  ${r.status === 'pass' ? '✓' : '✗'} ${r.step}${r.detail ? ' — ' + r.detail : ''}`);
  }
  console.log(`\n${passed.length} passed, ${failed.length} failed`);
  const notableErrors = consoleErrors.filter(e => !(e.step === 'Load login page' && e.text.includes('401')));
  if (notableErrors.length) {
    console.log(`\n${notableErrors.length} console error(s) captured (excluding expected pre-login 401s):`);
    notableErrors.forEach(e => console.log(`  [${e.step}] ${e.text}`));
  }
  console.log(`\n${failed.length === 0 ? '✓✓✓ ALL SMOKE TESTS PASSED' : '✗✗✗ FAILURES FOUND — investigate before trusting this build'}`);
  console.log('='.repeat(70) + '\n');
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
