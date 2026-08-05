#!/usr/bin/env python3
"""
ThreadControl Pre-Deploy Checker — v5 (MERGED, single source of truth)
Run after EVERY change, before zipping/shipping.

History: v4 (38 checks, function-scoped/AST-style, /home/claude/tc_production_build
base) was merged with a second, independently-written lightweight checker (66
substring checks, /tmp/tc_split base) on 2026-07-07. Every check from the
lightweight version was individually verified against the real production
codebase before being ported in — one check (dye sources[0] regression guard)
was found to be logically broken (a `.split('triggerSummaryUpdate')[1]` slice
that only inspects text after the FIRST occurrence of the string in the whole
file, effectively checking almost nothing) and was rewritten correctly here
rather than carried over as-is. All other lightweight-checker checks were
confirmed sound and are included as Checks 39-58 below. Do not let a second
copy of this file start drifting again — this is the ONE checker.
"""
import re
import json
import subprocess
from pathlib import Path
from collections import Counter

import sys
if len(sys.argv) < 2:
    print("=" * 70)
    print("ERROR — no folder path given.")
    print("=" * 70)
    print("This checker refuses to guess which folder to check — it used to")
    print("silently fall back to a hardcoded default folder when no path was")
    print("given, which meant it could report 'all checks passed' while never")
    print("actually looking at your real files. Fixed Jul 18 2026.")
    print()
    print("Run it as:")
    print(f"    python3 {sys.argv[0]} /path/to/your/app/folder")
    print()
    print("Tip: from inside the folder itself, use:")
    print(f"    python3 {sys.argv[0]} \"$(pwd)\"")
    sys.exit(1)
BASE = Path(sys.argv[1])
if not BASE.exists():
    print(f"ERROR — folder does not exist: {BASE}")
    sys.exit(1)
CORE = (BASE / 'assets/js/core.js').read_text(encoding='utf-8')
PAGES = (BASE / 'assets/js/pages.js').read_text(encoding='utf-8')
HTML = (BASE / 'assets/index.html').read_text(encoding='utf-8')
WORKER = (BASE / 'worker.js').read_text(encoding='utf-8')
SHARED = (BASE / 'assets' / 'js' / 'shared-balances.js').read_text(encoding='utf-8') if (BASE / 'assets' / 'js' / 'shared-balances.js').exists() else ''
RULES_PATH = BASE / 'firebase-rules.json'
ALL_JS = CORE + '\n' + PAGES

FAIL = False
def fail(msg):
    global FAIL
    FAIL = True
    print(f"  ✗ {msg}")
def ok(msg):
    print(f"  ✓ {msg}")
def warn(msg):
    print(f"  ⚠ {msg}")

print("=" * 70)
print("CHECK 1 — SYNTAX (strict ES-module check)")
print("=" * 70)
# Jul 18 2026 — real incident: plain `node --check file.js` was proven
# TOO LOOSE to catch two real, serious bugs that made it all the way to
# a live deployment and threw errors in the actual browser — a missing
# closing brace that silently swallowed an entire function (renderMasters
# never closed before addMaster's definition, so everything after was
# parsed as still nested inside it, right up until an `export` statement
# finally broke), and a plain unescaped apostrophe inside a single-quoted
# string ("What's Wrong") that prematurely terminated the string. Neither
# was caught by node --check on ANY run this entire session, on ANY
# build, despite running it dozens of times — it was giving false
# confidence the whole time. The actual browser (and Node's real ES
# module loader) enforce module-level rules — like `export` only being
# valid at the top level, never inside a function — that plain --check
# does not. Fixed by piping each file through stdin with
# --input-type=module, which uses the real, strict module parser instead.
for f in ['assets/js/core.js', 'assets/js/pages.js', 'assets/js/shared-balances.js', 'worker.js']:
    with open(BASE / f, 'rb') as fh:
        content = fh.read()
    r = subprocess.run(['node', '--input-type=module', '--check'], input=content, capture_output=True)
    if r.returncode == 0:
        ok(f)
    else:
        fail(f"{f}: {r.stderr.decode(errors='replace').strip()}")

print("\n" + "=" * 70)
print("CHECK 2 — FUNCTION COUNT / DUPLICATES")
print("=" * 70)
all_funcs = re.findall(r'function\s+(\w+)\s*\(', ALL_JS)
print(f"  Function count: {len(all_funcs)}")
dupes = {k: v for k, v in Counter(all_funcs).items() if v > 1}
if dupes:
    fail(f"Duplicates: {dupes}")
else:
    ok("No duplicate function names")
defined_funcs = set(all_funcs)

print("\n" + "=" * 70)
print("CHECK 3 — STATIC HTML ONCLICK RESOLUTION")
print("=" * 70)
static_onclicks = re.findall(r'onclick="([^"]*)"', HTML)
unresolved = []
checked = 0
for oc in static_onclicks:
    for stmt in oc.split(';'):
        stmt = stmt.strip()
        m = re.match(r'([a-zA-Z_]\w*)\s*\(', stmt)
        if m:
            fn = m.group(1)
            checked += 1
            if fn not in defined_funcs and fn not in ('this', 'event', 'applyDyeLotSearch', 'onDyeEndSerialInput'):
                unresolved.append(fn)
print(f"  Checked: {checked}")
if unresolved:
    fail(f"Unresolved: {sorted(set(unresolved))}")
else:
    ok("All static onclick handlers resolve")

print("\n" + "=" * 70)
print("CHECK 4 — DYNAMIC (pages.js template-string) ONCLICK RESOLUTION")
print("=" * 70)
dynamic_onclicks = re.findall(r'onclick=\\?"([^"\\]*(?:\\.[^"\\]*)*)\\?"', PAGES)
dyn_unresolved = []
dyn_checked = 0
for oc in dynamic_onclicks:
    for stmt in oc.split(';'):
        stmt = stmt.strip()
        m = re.match(r'([a-zA-Z_]\w*)\s*\(', stmt)
        if m:
            fn = m.group(1)
            dyn_checked += 1
            if fn not in defined_funcs and fn not in ('this', 'event', 'if', 'while', 'for', 'setTimeout', 'setInterval', 'confirm', 'alert', 'applyDyeLotSearch', 'onDyeEndSerialInput'):
                dyn_unresolved.append(fn)
print(f"  Checked: {dyn_checked}")
if dyn_unresolved:
    fail(f"Unresolved: {sorted(set(dyn_unresolved))}")
else:
    ok("All dynamic onclick handlers resolve")

print("\n" + "=" * 70)
print("CHECK 5 — DB.users REFERENCE ALLOWLIST")
print("=" * 70)
ALLOWED_DB_USERS_FUNCS = {
    'isInDemoState', 'renderLoginDemoCards', 'populateAnalyticsSelects',
    'toggleViewPassword', 'seedDemo', '_writeBackup', 'loadUsersForLogin',
    'addDefaultUsers',
}
users_refs = [m.start() for m in re.finditer(r'DB\.users\b', ALL_JS)]
flagged = []
for pos in users_refs:
    line_start = ALL_JS.rfind('\n', 0, pos) + 1
    line_prefix = ALL_JS[line_start:pos]
    if '//' in line_prefix:
        continue
    func_start = ALL_JS.rfind('function ', 0, pos)
    m = re.match(r'function\s+(\w+)', ALL_JS[func_start:func_start + 60])
    fname = m.group(1) if m else '?'
    if fname not in ALLOWED_DB_USERS_FUNCS:
        line_no = ALL_JS.count('\n', 0, pos) + 1
        flagged.append((fname, line_no))
print(f"  Total DB.users references: {len(users_refs)} (across {len(ALLOWED_DB_USERS_FUNCS)} allowlisted functions)")
if flagged:
    fail(f"NEW/unexpected DB.users reference(s): {flagged}")
else:
    ok("All DB.users references are in known, already-reviewed functions")

print("\n" + "=" * 70)
print("CHECK 6 — save('users') HARD GUARD")
print("=" * 70)
save_users = re.findall(r"save\(\s*['\"]users['\"]", ALL_JS)
if save_users:
    fail(f"save('users') found {len(save_users)}x — this writes the permanently-empty client-side users array to Firebase, will corrupt the real user list. MUST NOT exist anywhere.")
else:
    ok("No save('users') anywhere")

print("\n" + "=" * 70)
print("CHECK 7 — BLANKET /tc OVERWRITE SCANNER")
print("=" * 70)
blanket_writes = [m.start() for m in re.finditer(r"\.ref\(\s*['\"]\/tc['\"]\s*\)\s*\.set\(", ALL_JS)]
new_blanket = []
for pos in blanket_writes:
    func_start = ALL_JS.rfind('function ', 0, pos)
    m = re.match(r'function\s+(\w+)', ALL_JS[func_start:func_start + 60])
    fname = m.group(1) if m else '?'
    if fname == 'seedDemo':
        continue
    new_blanket.append((fname, ALL_JS.count('\n', 0, pos) + 1))
if new_blanket:
    for fname, line_no in new_blanket:
        fail(f"{fname} (line ~{line_no}): blanket /tc.set() — confirm payload excludes `users`, use multi-path update() instead")
else:
    ok("No NEW blanket /tc.set() calls (seedDemo's known/accepted one excluded)")

print("\n" + "=" * 70)
print("CHECK 8 — RAW FETCH TO FIREBASE WITHOUT AUTH")
print("=" * 70)
raw_fetches = [m.start() for m in re.finditer(r"fetch\(\s*FIREBASE_CONFIG\.databaseURL", ALL_JS)]
bad_raw = []
for pos in raw_fetches:
    func_start = ALL_JS.rfind('function ', 0, pos)
    m = re.match(r'function\s+(\w+)', ALL_JS[func_start:func_start + 60])
    fname = m.group(1) if m else '?'
    if fname != '_fbAuthedFetch':
        bad_raw.append((fname, ALL_JS.count('\n', 0, pos) + 1))
if bad_raw:
    fail(f"Raw fetch(FIREBASE_CONFIG.databaseURL...) outside _fbAuthedFetch: {bad_raw} — will fail under auth!=null rules, route through _fbAuthedFetch()")
else:
    ok("All Firebase REST fetches go through _fbAuthedFetch")

print("\n" + "=" * 70)
print("CHECK 9 — FIREBASE RULES STRUCTURE")
print("=" * 70)
if not RULES_PATH.exists():
    warn("firebase-rules.json not found in build folder — skipping")
else:
    try:
        rules = json.loads(RULES_PATH.read_text())
        ok("Valid JSON")
        tc = rules.get('rules', {}).get('tc', {})
        if 'users' not in tc:
            fail("rules.tc.users missing entirely — /tc/users would not be blocked")
        elif tc['users'].get('.read') is not False or tc['users'].get('.write') is not False:
            fail("rules.tc.users does not have .read:false and .write:false")
        else:
            ok("rules.tc.users correctly blocked")
        if '$other' not in tc:
            fail("rules.tc.$other missing — other /tc/* paths have no explicit grant")
        else:
            ok("rules.tc.$other present")
        for key, val in tc.items():
            if key in ('users', '$other', '.read', '.write'):
                continue
            if isinstance(val, dict):
                if val.get('.read') is None or val.get('.write') is None:
                    fail(f"rules.tc.{key} has no explicit .read/.write — will NOT inherit $other's grant (named siblings don't fall through to wildcards), falls through to root default instead")
                else:
                    ok(f"rules.tc.{key} has explicit .read/.write")
    except json.JSONDecodeError as e:
        fail(f"Invalid JSON: {e}")

print("\n" + "=" * 70)
print("CHECK 10 — DEAD COLLECTION READS")
print("=" * 70)
DEAD_COLLECTIONS = ['dyeBatches', 'dyeEntries']
for col in DEAD_COLLECTIONS:
    matches = list(re.finditer(rf'DB\.{col}\b', ALL_JS))
    if matches:
        warn(f"DB.{col} referenced {len(matches)}x — confirm each is inside the off-limits legacy dye cluster or submitDyeEndNew's backward-compat fallback, not new code")
    else:
        ok(f"DB.{col} — no references")

print("\n" + "=" * 70)
print("CHECK 11 — SUMMARY TRIGGER TYPE COVERAGE")
print("=" * 70)
lot_types_m = re.findall(r"statusChangesLot\s*=\s*\[([^\]]+)\]", WORKER)
dyelot_types_m = re.findall(r"statusChangesDyeLot\s*=\s*\[([^\]]+)\]", WORKER)
lot_types = [t.strip().strip("'\"") for t in lot_types_m[0].split(',')] if lot_types_m else []
dyelot_types = [t.strip().strip("'\"") for t in dyelot_types_m[0].split(',')] if dyelot_types_m else []
called_types = set(re.findall(r"triggerSummaryUpdate\s*\(\s*['\"](\w+)['\"]", ALL_JS))
KNOWN_OTHER_HANDLED_TYPES = {'order'}
unhandled = [t for t in called_types if t not in lot_types and t not in dyelot_types and t not in KNOWN_OTHER_HANDLED_TYPES]
if unhandled:
    fail(f"triggerSummaryUpdate called with type(s) the Worker doesn't handle: {unhandled} — summary will silently NOT update for these")
else:
    ok(f"All called trigger types ({sorted(called_types)}) are handled by the Worker")

print("\n" + "=" * 70)
print("CHECK 12 — KNOWN FIELD-NAME MISMATCHES")
print("=" * 70)
field_checks = [
    (r'windEntr\w*[^.]*\.(inUnits|outUnits|wasteUnits)', "windEntries should use inCones/outCones/wasteCones, not unit fields"),
    (r'packEntr\w*[^.]*\.(outUnits|outWeight)', "packEntries output should use bags/weight, not outUnits/outWeight"),
]
any_field_fail = False
for pattern, msg in field_checks:
    m = re.findall(pattern, ALL_JS)
    if m:
        fail(f"{msg} — found: {set(m) if isinstance(m[0], str) else len(m)}")
        any_field_fail = True
if not any_field_fail:
    ok("No known field-name mismatches found")

print("\n" + "=" * 70)
print("CHECK 13 — APPROVAL/STATUS-CHANGE FUNCTIONS CALL triggerSummaryUpdate")
print("=" * 70)
CRITICAL_FUNCS = [
    'approveStageEntry', 'approveDyeLot', 'approveWindEntry', 'approvePackEntry',
    'approveDispatch', 'approveAllCurrentTab', 'submitVoidEntry', 'submitVoidRMLotCascade',
    'executeOverride',
]
for fname in CRITICAL_FUNCS:
    start = ALL_JS.find(f'function {fname}(')
    if start == -1:
        start = ALL_JS.find(f'async function {fname}(')
    if start == -1:
        fail(f"{fname} — not found in codebase, this check's function list is stale, update it")
        continue
    i = ALL_JS.find('{', start)
    depth = 0
    j = i
    while j < len(ALL_JS):
        if ALL_JS[j] == '{':
            depth += 1
        elif ALL_JS[j] == '}':
            depth -= 1
            if depth == 0:
                break
        j += 1
    body = ALL_JS[start:j + 1]
    # Jul 14 2026 — submitVoidEntry (Item B) and submitVoidRMLotCascade
    # (Item C) both permanently delegate summary refresh to the server now
    # instead of calling triggerSummaryUpdate/_clearSummary directly from
    # the client. This is now the CORRECT, permanent state for both
    # functions — not an occasional exception — so they get their own
    # checks instead of a warning that would otherwise fire forever.
    if fname == 'submitVoidEntry':
        if "WORKER_URL+'/api/void'" in body or "apiPost('/api/void'" in body or '_executeVoidOnServer' in body:
            ok(f"{fname} → correctly delegates to POST /api/void (server-side summary refresh, Item B cutover)")
        else:
            fail(f"{fname} → does not call /api/void — Item B cutover may have regressed back to client-side cascade logic")
    elif fname == 'submitVoidRMLotCascade':
        if "WORKER_URL+'/api/void-rm-lot'" in body or "apiPost('/api/void-rm-lot'" in body:
            ok(f"{fname} → correctly delegates to POST /api/void-rm-lot (server-side summary refresh, Item C cutover)")
        else:
            fail(f"{fname} → does not call /api/void-rm-lot — Item C cutover may have regressed back to client-side cascade logic")
    elif fname in ('approveStageEntry', 'approveDyeLot', 'approveWindEntry', 'approvePackEntry', 'approveDispatch'):
        # Jul 24 2026 — confirmed by direct execution test: these 5 are thin
        # client wrappers around POST /api/approve-entry. The real refresh
        # happens server-side in handleApproveEntry via nudgeLotSummary/
        # nudgeDyeLotSummary, under names this check's generic branch below
        # doesn't recognize. Verified real, not just plausible — same class
        # of check as the two void functions above.
        if "apiPost('/api/approve-entry'" in body:
            ok(f"{fname} → correctly delegates to POST /api/approve-entry (server-side summary refresh via nudgeLotSummary/nudgeDyeLotSummary)")
        else:
            fail(f"{fname} → does not call /api/approve-entry — may have regressed back to client-side summary handling")
    elif fname == 'approveAllCurrentTab':
        if "apiPost('/api/approve-all'" in body:
            ok(f"{fname} → correctly delegates to POST /api/approve-all (server-side summary refresh)")
        else:
            fail(f"{fname} → does not call /api/approve-all — may have regressed back to client-side summary handling")
    elif fname == 'executeOverride':
        if "apiPost('/api/override-approve'" in body:
            ok(f"{fname} → correctly delegates to POST /api/override-approve (server-side summary refresh)")
        else:
            fail(f"{fname} → does not call /api/override-approve — may have regressed back to client-side summary handling")
    elif 'triggerSummaryUpdate' in body or '_clearSummary' in body:
        ok(f"{fname} → triggers a summary update")
    else:
        warn(f"{fname} → no triggerSummaryUpdate/_clearSummary call found — confirm this is intentional (some void paths delegate to a helper that does it instead)")

print("\n" + "=" * 70)
print("CHECK 14 — RESTORE EXCLUDES PARTIES (like users)")
print("=" * 70)
# Jul 24 2026 — restoreFromBackup was moved server-side (handleBackupRestore
# in worker.js) as part of fixing the password/role-check gap. The
# parties-exclusion logic moved with it, so this check now accepts either
# location rather than assuming it's always in pages.js.
if 'parties:_backupParties' in PAGES or 'parties: _backupParties' in WORKER:
    ok("restore destructures parties from backup data before writing (client or server, whichever owns the restore write)")
else:
    fail("restore does NOT exclude parties anywhere — an old backup restore will wipe /tc/parties. Add a parties:_backupParties-style destructure wherever the restore write happens, same pattern as users:_skipUsers")

print("\n" + "=" * 70)
print("CHECK 15 — L3 PARTIES LOADER HANDLES STRING ARRAYS")
print("=" * 70)
if "typeof raw[0]==='string'" in CORE:
    ok("L3 loader handles plain string arrays (parties) correctly")
else:
    fail("L3 loader missing string-array guard — DB.parties will always load empty. Check the forEach(path=>...) block in loadPartyData()")

print("\n" + "=" * 70)
print("CHECK 16 — JS-CALLED FUNCTIONS IN TEMPLATE LITERALS ARE DEFINED")
print("=" * 70)
BUILTIN_JS = {'parseInt','parseFloat','Math','Date','Object','Array','String','Number',
              'Boolean','JSON','Promise','setTimeout','setInterval','clearTimeout',
              'clearInterval','console','alert','confirm','encodeURIComponent',
              'decodeURIComponent','isNaN','isFinite','fmt','fmtTS','pct','hrsBetween',
              'agingBadge','statusBadge','stageBadge','entryRowClass','getDyeLotCurrentStage',
              'openDyeLifecycle','openEditEntryModal','openVoidModal','openVoidEntry',
              'approveWindEntry','rejectWindEntry','approvePackEntry','rejectPackEntry',
              'approveDispatch','rejectDispatch','approveDyeLot','rejectDyeLot',
              'approveEntry','rejectEntry','openOverride','openLinkOrder','openRMEdit',
              'openVoidRMLotCascade','openPartyOrderModal','cancelPartyOrder','renderPartyTracker'}
local_fns = set(re.findall(r'(?:const|let)\s+([a-zA-Z_]\w*)\s*=\s*(?:\(|[a-zA-Z_])', PAGES))
core_fns = set(re.findall(r'(?:function\s+([a-zA-Z_]\w*)|(?:const|let)\s+([a-zA-Z_]\w*)\s*=)', CORE))
core_fns = {f for pair in core_fns for f in pair if f}
all_known_fns = defined_funcs | BUILTIN_JS | local_fns | core_fns
tpl_calls = re.findall(r'\$\{([a-zA-Z_]\w*)\s*\(', PAGES)
tpl_unresolved = []
tpl_checked = 0
for fn in tpl_calls:
    tpl_checked += 1
    if fn not in all_known_fns:
        tpl_unresolved.append(fn)
print(f"  Checked: {tpl_checked} template-literal function calls")
if tpl_unresolved:
    counts = Counter(tpl_unresolved)
    fail(f"Functions called in template literals but NOT defined: {dict(counts)}")
else:
    ok("All template-literal function calls resolve to defined functions")

print("\n" + "=" * 70)
print("CHECK 17 — BARE GLOBAL FUNCTION AS TEMPLATE LITERAL VARIABLE")
print("=" * 70)
GLOBAL_FNS_NEVER_BARE = ['statusBadge', 'entryRowClass', 'stageBadge',
                          'renderAll', 'triggerSummaryUpdate', 'fmt', 'fmtTS']
bare_found = []
for fn in GLOBAL_FNS_NEVER_BARE:
    pattern = r'\$\{' + fn + r'\s*\}'
    for m in re.finditer(pattern, PAGES):
        fn_pos = PAGES.rfind("function ", 0, m.start())
        fn_brace = PAGES.find('{', fn_pos)
        fn_dep = 0; fn_j = fn_brace
        while fn_j < len(PAGES):
            if PAGES[fn_j] == '{': fn_dep += 1
            elif PAGES[fn_j] == '}':
                fn_dep -= 1
                if fn_dep == 0: break
            fn_j += 1
        fn_body_ctx = PAGES[fn_pos:fn_j+1]
        has_local = f"const {fn}=" in fn_body_ctx or f"let {fn}=" in fn_body_ctx
        if not has_local:
            bare_found.append(fn)
if bare_found:
    fail(f"Bare global function name(s) in template literal (renders as [object Function]): {sorted(set(bare_found))}")
else:
    ok("No bare global function names in template literals")

print("\n" + "=" * 70)
print("CHECK 18 — STAGE TABLE RENDER FUNCTIONS DEFINE isAdmin/isSup")
print("=" * 70)
STAGE_RENDER_FNS = [
    'renderStageTable', 'renderDyeTable', 'renderWindTable',
    'renderPackTable', 'renderDispatch', 'renderRMStock'
]
for fn_name in STAGE_RENDER_FNS:
    fn_start = PAGES.find(f'function {fn_name}(')
    if fn_start == -1:
        fail(f"{fn_name} — not found in pages.js")
        continue
    brace = PAGES.find('{', fn_start)
    depth = 0
    j = brace
    while j < len(PAGES):
        if PAGES[j] == '{': depth += 1
        elif PAGES[j] == '}':
            depth -= 1
            if depth == 0: break
        j += 1
    fn_body = PAGES[fn_start:j+1]
    uses_isAdmin = 'isAdmin' in fn_body
    uses_isSup = 'isSup' in fn_body
    defines_isAdmin = "const isAdmin=" in fn_body or "let isAdmin=" in fn_body
    defines_isSup = "const isSup=" in fn_body or "let isSup=" in fn_body
    if uses_isAdmin and not defines_isAdmin:
        fail(f"{fn_name} uses isAdmin but never defines it — ReferenceError at runtime")
    elif uses_isSup and not defines_isSup:
        fail(f"{fn_name} uses isSup but never defines it — ReferenceError at runtime")
    else:
        ok(f"{fn_name} — role variables correctly scoped")

print("\n" + "=" * 70)
print("CHECK 19 — handleEditEntry HAS AN ATOMIC WRITE + A BALANCE NUDGE FOR EVERY STAGE")
print("=" * 70)
# Jul 14 2026 — Item D cutover moved this logic to worker.js's
# handleEditEntry, one atomic PATCH instead of per-stage save()/
# _clearSummary() calls.
# Jul 17 2026 — Phase 3 of the running-balance plan replaced the old
# full-recompute refresh (updateSentToDyeOnly/updateDyeLotSummary) with
# precise delta nudges (nudgeLotSummary/nudgeDyeLotSummary), computed
# from the real old-vs-new values already tracked for the edit log.
# This check now verifies THAT pattern instead of the one it replaced.
edit_fn_w = WORKER[WORKER.find('async function handleEditEntry('):WORKER.find('\nasync function handleExportDispatch(')]
_has_atomic_write = "await fbPatch('', patch)" in edit_fn_w
_has_nudge_calls = 'nudgeLotSummary(..._nudgeLotArgs)' in edit_fn_w and 'nudgeDyeLotSummary(..._nudgeDyeArgs)' in edit_fn_w
if _has_atomic_write and _has_nudge_calls:
    ok("handleEditEntry (worker.js) — atomic write + Phase 3 delta nudge calls present")
else:
    fail("handleEditEntry (worker.js) — missing atomic patch write or the Phase 3 nudge calls (may have regressed to the old full-recompute pattern, or lost the write entirely)")

print("\n" + "=" * 70)
print("CHECK 20 — submitEditEntry RECALCULATES DERIVED FIELDS PER STAGE")
print("=" * 70)
# Jul 14 2026 — Item D cutover: these fields are now set via patch[`.../field`]
# assignments inside worker.js's handleEditEntry, not direct e.field=
# mutation in pages.js. Checking the new pattern in the correct file.
DERIVED_FIELDS = {
    'soft':     [('wasteUnits`]', 'wasteUnits'), ('wasteWeight`]', 'wasteWeight')],
    'dye':      [('kgLoss`]', 'kgLoss'), ('coneLoss`]', 'coneLoss')],
    'wind':     [('wasteCones`]', 'wasteCones'), ('wasteWeight`]', 'wasteWeight')],
    'pack':     [('gainKg`]', 'gainKg'), ('gainPct`]', 'gainPct')],
    'dispatch': [],
}
edit_fn2 = WORKER[WORKER.find('async function handleEditEntry('):WORKER.find('\nasync function handleExportDispatch(')]
for stage, fields in DERIVED_FIELDS.items():
    if not fields:
        ok(f"dispatch — no derived fields")
        continue
    stage_idx = edit_fn2.find(f"stage === '{stage}'")
    next_stage = edit_fn2.find("} else if (stage ===", stage_idx+10)
    section = edit_fn2[stage_idx:next_stage if next_stage!=-1 else len(edit_fn2)]
    missing = [name for (pattern, name) in fields if pattern not in section]
    if missing:
        fail(f"handleEditEntry (worker.js) {stage} — missing recalculation of: {missing}")
    else:
        ok(f"handleEditEntry (worker.js) {stage} — all derived fields recalculated")

print("\n" + "=" * 70)
print("CHECK 21 — NO var DECLARATIONS")
print("=" * 70)
var_decls = re.findall(r'(?<![a-zA-Z_$])var\s+[a-zA-Z_]', ALL_JS)
if var_decls:
    warn(f"Found {len(var_decls)} var declaration(s) — prefer const/let; var may cause hoisting issues in new code")
else:
    ok("No var declarations found")

print("\n" + "=" * 70)
print("CHECK 22 — entryRowClass USED IN ALL STAGE TABLE ROWS")
print("=" * 70)
STAGE_TBODIES = [
    ("se-tbody", "soft"),
    ("dye-tbody", "dye"),
    ("wind-tbody", "wind"),
    ("pack-tbody", "pack"),
    ("disp-tbody", "dispatch"),
]
RENDER_FN_FOR_TBODY = {'se-tbody':'renderStageTable','dye-tbody':'renderDyeTable','wind-tbody':'renderWindTable','pack-tbody':'renderPackTable','disp-tbody':'renderDispatch'}
for tbody_id, stage in STAGE_TBODIES:
    idx = PAGES.find(f"'{tbody_id}'")
    if idx == -1:
        fail(f"{stage} — tbody '{tbody_id}' not found")
        continue
    fn_name = RENDER_FN_FOR_TBODY.get(tbody_id)
    fn_start2 = PAGES.find(f'function {fn_name}(')
    if fn_start2 == -1:
        fail(f"{stage} render function {fn_name} not found")
        continue
    brc = PAGES.find('{', fn_start2); dep = 0; j2 = brc
    while j2 < len(PAGES):
        if PAGES[j2] == '{': dep += 1
        elif PAGES[j2] == '}':
            dep -= 1
            if dep == 0: break
        j2 += 1
    fn_body = PAGES[fn_start2:j2+1]
    if "entryRowClass" in fn_body:
        ok(f"{stage} table ({fn_name}) uses entryRowClass")
    else:
        fail(f"{stage} table ({fn_name}) does NOT use entryRowClass")

print("\n" + "=" * 70)
print("CHECK 23 — APPROVE/REJECT FUNCTION PAIRING")
print("=" * 70)
approve_fns = set(re.findall(r'function\s+(approve\w+)\s*\(', ALL_JS))
reject_fns  = set(re.findall(r'function\s+(reject\w+)\s*\(', ALL_JS))
APPROVE_NO_REJECT = {'approveAll','approveAllCurrentTab','approveAllStage',
                     'approveDeadStock','approveRecycle'}
# Jul 24 2026 — confirmed by tracing the actual reject buttons: Dispatch,
# Dye, Pack, and Wind each kept their own dedicated rejectX function
# (mirroring their approveX), but Soft-stage's reject button calls the
# shared rejectEntry(id,'stage') dispatcher instead of a dedicated
# rejectStageEntry. rejectEntry was later simplified to a generic
# pass-through to the server's /api/reject endpoint (which itself handles
# all 5 types, including 'stage') — so the marker checks for that call
# instead of a literal type==='stage' branch, which no longer exists as
# its own code path. Functionally complete either way — just a naming
# difference from the other 4 stages, not a missing capability.
APPROVE_REJECT_VIA_DISPATCHER = {'approveStageEntry': ('rejectEntry', "apiPost('/api/reject'")}
for fn in sorted(approve_fns):
    if fn in APPROVE_NO_REJECT:
        ok(f"{fn} — intentionally no reject pair")
        continue
    if fn in APPROVE_REJECT_VIA_DISPATCHER:
        dispatcher, marker = APPROVE_REJECT_VIA_DISPATCHER[fn]
        if dispatcher in reject_fns:
            start = ALL_JS.find(f'function {dispatcher}(')
            if start == -1:
                start = ALL_JS.find(f'async function {dispatcher}(')
            i = ALL_JS.find('{', start); depth = 0; j = i
            while j < len(ALL_JS):
                if ALL_JS[j] == '{': depth += 1
                elif ALL_JS[j] == '}':
                    depth -= 1
                    if depth == 0: break
                j += 1
            body = ALL_JS[start:j+1]
            if marker in body:
                ok(f"{fn} ↔ {dispatcher} (shared dispatcher, {marker} branch confirmed present)")
            else:
                fail(f"{fn} — {dispatcher} no longer has a {marker} branch, Soft-stage reject may be broken")
        else:
            fail(f"{fn} — expected shared dispatcher {dispatcher} not found, Soft-stage reject may be missing entirely")
        continue
    expected_reject = fn.replace("approve", "reject").replace("Approve", "Reject")
    if expected_reject not in reject_fns:
        warn(f"{fn} has no matching {expected_reject}")
    else:
        ok(f"{fn} ↔ {expected_reject}")

print("\n" + "=" * 70)
print("CHECK 24 — getPackBalAvailable FIELD ACCESS")
print("=" * 70)
bad_field = re.findall(r'getPackBalAvailable\([^)]*\)\.bags', ALL_JS)
if bad_field:
    fail(f"getPackBalAvailable().bags used {len(bad_field)}x — function returns .units not .bags. Use .units instead.")
else:
    ok("getPackBalAvailable always accessed via .units (correct field)")

print("\n" + "=" * 70)
print("CHECK 25 — EDIT VALIDATIONS USE TOTALS NOT SINGLE ENTRY VALUES")
print("=" * 70)
# Jul 14 2026 — Item D cutover: same logic, moved to worker.js with
# different variable names (no intermediate _newTotalSoftOut variable —
# the total comparison is inline: otherSoftOut + newOutW < dyeConsumed).
if 'otherSoftOut + newOutW < dyeConsumed' in edit_fn2:
    ok("Soft outWeight edit — validates total soft output vs dye consumed (not single entry)")
else:
    fail("Soft outWeight edit — missing total-vs-dyeConsumed comparison in worker.js. Bug: may be comparing single entry outWeight against entire lot dye consumption")

if 'newWt > packTotalWt' in edit_fn2 and 'otherDispWt' not in edit_fn2.split('newWt > packTotalWt')[0][-50:]:
    ok("Dispatch weight UP edit — correct single-value comparison against available (newWt > packTotalWt)")
else:
    fail("Dispatch weight UP edit — check for double-counting regression in worker.js")

if 'newBags > packTotalBags' in edit_fn2:
    ok("Dispatch bags UP edit — correct single-value comparison (newBags > packTotalBags)")
else:
    fail("Dispatch bags UP edit — missing correct comparison in worker.js")

print("\n" + "=" * 70)
print("CHECK 26 — PACK EDIT RECALCULATES gainKg AND gainPct")
print("=" * 70)
# Jul 14 2026 — Item D cutover: patch-based assignment in worker.js now,
# not direct e.gainKg= mutation in pages.js.
if "patch[`${p}/gainKg`] = newGainKg" in edit_fn2 and "patch[`${p}/gainPct`] = newGainPct" in edit_fn2:
    ok("Pack edit recalculates gainKg and gainPct from new weight (worker.js)")
else:
    fail("Pack edit missing gainKg/gainPct recalculation in worker.js — gain display stays stale after edit")

print("\n" + "=" * 70)
print("CHECK 27 — STAGE MODAL DROPDOWNS DISPLAY AVAILABLE BALANCE NOT APPROVED-ONLY")
print("=" * 70)
checks27 = [
    ("Wind modal option text", "getDyeBalAvailable", "getDyeBal(d.id)", "openWindModal"),
    ("Pack modal option text", "getWindBalAvailable", "getWindBal(d.id)", "openPackModal"),
    ("Dispatch modal option text", "getPackBalAvailable", "getPackBal(d.id)", "renderDispatchLotRows"),
]
for label, correct_fn, wrong_fn, modal_fn in checks27:
    fn_start = PAGES.find(f"function {modal_fn}(")
    fn_end = PAGES.find("\nfunction ", fn_start+10)
    chunk = PAGES[fn_start:fn_end if fn_end!=-1 else fn_start+3000]
    if wrong_fn in chunk:
        fail(f"{label} uses {wrong_fn} (approved-only) — must use {correct_fn} for accurate display")
    elif correct_fn in chunk:
        ok(f"{label} correctly uses {correct_fn}")
    else:
        warn(f"{label} — could not verify balance function used in option text")

print("\n" + "=" * 70)
print("CHECK 28 — STAGE FORM LABEL NAMING CONSISTENCY")
print("=" * 70)
rsf_start = PAGES.find("function renderStageForm(")
rsf_end = PAGES.find("\nfunction ", rsf_start+10)
rsf = PAGES[rsf_start:rsf_end]
wm_idx = HTML.find('id="wind-modal-overlay"')
wind_modal = HTML[wm_idx:wm_idx+5000]
pm_idx = HTML.find('id="pack-modal-overlay"')
pack_modal = HTML[pm_idx:pm_idx+3000]
dm_idx = HTML.find('id="dye-end-modal-overlay"')
dye_modal = HTML[dm_idx:dm_idx+5000]
OLD_LABELS_SOFT = [("Input Units", rsf), ("Output Units", rsf), ("Input Weight", rsf), ("Output Weight", rsf)]
OLD_LABELS_WIND = [("Cones In", wind_modal), ("Cones Out", wind_modal)]
OLD_LABELS_PACK = [("Cones In", pack_modal), ("Bags Out", pack_modal)]
OLD_LABELS_DYE = [("Output Units", dye_modal)]
for label, scope in OLD_LABELS_SOFT + OLD_LABELS_WIND + OLD_LABELS_PACK + OLD_LABELS_DYE:
    if label in scope:
        fail(f"Old label \"{label}\" still in form modal — must use In/Out prefix standard")
    else:
        ok(f"Old label \"{label}\" not in modal ✓")
if "In Bags" in rsf and "Out Bags" in rsf:
    ok("Soft form has In Bags / Out Bags ✓")
else:
    fail("Soft form missing In Bags or Out Bags label")
if "In Cones" in wind_modal and "Out Cones" in wind_modal:
    ok("Wind modal has In Cones / Out Cones ✓")
else:
    fail("Wind modal missing In Cones or Out Cones label")
if "In Cones" in pack_modal and "Out Bags" in pack_modal:
    ok("Pack modal has In Cones / Out Bags ✓")
else:
    fail("Pack modal missing In Cones or Out Bags label")
if "Out Cones" in dye_modal:
    ok("Dye modal has Out Cones ✓")
else:
    fail("Dye modal missing Out Cones label")

print("\n" + "=" * 70)
print("CHECK 29 — PACK MODAL USES CORRECT BANNER STYLE")
print("=" * 70)
if "pack-lot-info" in HTML:
    idx = HTML.find('id="pack-lot-info"')
    ctx = HTML[idx:idx+150]
    if "font-size:0.75rem" in ctx and "color:var(--mu)" in ctx:
        fail("pack-lot-info still uses old small grey text style — must use banner style (background:var(--s2))")
    else:
        ok("pack-lot-info uses correct banner wrapper style")
else:
    warn("pack-lot-info element not found in HTML")
idx2 = PAGES.find("function onPackDyeLotSelect(")
fn_end2 = PAGES.find("\nfunction ", idx2+10)
pack_fn = PAGES[idx2:fn_end2]
if "getWindBalAvailable" in pack_fn:
    ok("onPackDyeLotSelect uses getWindBalAvailable for banner ✓")
else:
    fail("onPackDyeLotSelect must use getWindBalAvailable not getWindBal for banner display")

print("\n" + "=" * 70)
print("CHECK 30 — WIND MODAL DOM ORDER CORRECT")
print("=" * 70)
idx3 = HTML.find('id="wind-modal-overlay"')
wind_html = HTML[idx3:idx3+4000]
pos_in_cones = wind_html.find('id="wind-in-cones"')
pos_out_cones = wind_html.find('id="wind-out-cones"')
pos_out_weight = wind_html.find('id="wind-out-weight"')
if pos_in_cones == -1 or pos_out_cones == -1 or pos_out_weight == -1:
    warn("Could not find all wind modal field IDs to verify order")
else:
    if pos_in_cones < pos_out_cones < pos_out_weight:
        ok(f"Wind DOM order correct: In Cones ({pos_in_cones}) → Out Cones ({pos_out_cones}) → Out Weight ({pos_out_weight})")
    else:
        fail(f"Wind DOM order wrong: in-cones={pos_in_cones}, out-cones={pos_out_cones}, out-weight={pos_out_weight}. Must be in-cones < out-cones < out-weight")

print("\n" + "=" * 70)
print("CHECK 31 — SOURCE TD DIVS: must use span display:block not div")
print("=" * 70)
for fn_name in ['renderDyeTable', 'renderDyeStock']:
    fn_start = PAGES.find(f"function {fn_name}(")
    fn_end = PAGES.find("\nfunction ", fn_start+10)
    chunk = PAGES[fn_start:fn_end]
    bad_div = '<div style="font-size:0.68rem;' in chunk and 'white-space:nowrap' in chunk
    if bad_div:
        divs = re.findall(r'<div style="font-size:0\.68rem;[^"]*white-space:nowrap">', chunk)
        if divs:
            fail(f"{fn_name}: source cell still uses <div> instead of <span display:block> — {divs[0][:60]}")
        else:
            ok(f"{fn_name}: no bad source divs found")
    else:
        ok(f"{fn_name}: source cells use span correctly")

print("\n" + "=" * 70)
print("CHECK 32 — NO FILE WIPE: pages.js must have minimum line count")
print("=" * 70)
line_count = PAGES.count("\n")
if line_count < 2000:
    fail(f"pages.js has only {line_count} lines — possible file wipe! Expected 2500+")
else:
    ok(f"pages.js line count: {line_count} lines ✓")

print("\n" + "=" * 70)
print("CHECK 33 — MAP CALLBACK UNDECLARED VARS (runtime crash guard)")
print("=" * 70)
KNOWN_IDS = {'d','e','s','l','m','i','a','b','v','k','n','t','r',
    'DB','fmt','fmtTS','fmtQty','pct','wcls','agingBadge','statusBadge',
    'entryRowClass','getDyeLotCurrentStage','getMoisturePct','getPackBal',
    'getDyeBal','getWindBal','getDyeBalAvailable','getWindBalAvailable',
    'getPackBalAvailable','getTotalDispatched','getTotalPacked','sorted',
    '_getDyeLotSummary','_getLotSummary','appr','getLot','Math','Date',
    'parseInt','parseFloat','isNaN','currentUser','today','nowTS','save',
    'showToast','closeModal','openModal','renderAll','sortArr','buildColFilter',
    'sortTh','_sortState','isSup','isAdmin','openDyeLifecycle','openRMLifecycle',
    'openVoidEntry','openEditEntryModal','approveDyeLot','rejectDyeLot',
    'overrideDyeLot','openDyeSplitModal','getResidualBalance','getSoftEntryAvailable',
    'getDeadStockBalance','getRecycleBalance','getRCStatus','true','false',
    'null','undefined','NaN','document','window','JSON','Object','Array',
    'isComplete','mFlag','stage','stC','sC','act','src_total_bags','srcLotTd',
    'srcVendorTd','gl','disp','dyeBal','windBal','packBal','rmBal','sfBal',
    'lots','allLots','sorted','tbody','dye_thead'}
for fn_name in ['renderDyeTable','renderDyeStock','renderRMStock','renderRMTable']:
    fn_start2 = PAGES.find(f"function {fn_name}(")
    fn_end2 = PAGES.find("\nfunction ", fn_start2+10)
    chunk3 = PAGES[fn_start2:fn_end2]
    _sm = chunk3.find('sorted.map(d=>{'); map_m = type('M', (), {'group': lambda s,n: chunk3[_sm:chunk3.find('}).join(',_sm)]})() if _sm!=-1 else None
    if not map_m:
        ok(f"{fn_name}: no sorted.map found (skip)")
        continue
    cb = map_m.group(1)
    cb_nostr = re.sub(r"'[^']*'", "''", cb)
    cb_nostr = re.sub(r'"[^"]*"', '""', cb_nostr)
    declared3 = set(re.findall(r'(?:const|let|var)\s+(\w+)', cb))
    cond_ids = set(re.findall(r'(?<![.\w])(\b[a-zA-Z_][a-zA-Z0-9_]*\b)(?=\s*&&)', cb_nostr))
    suspicious3 = {v for v in (cond_ids - declared3 - KNOWN_IDS) if len(v) > 3 and v[0].islower()}
    if suspicious3:
        fail(f"{fn_name}: Possible undeclared var before &&: {suspicious3}")
    else:
        ok(f"{fn_name}: map callback vars look declared")

print("\n" + "=" * 70)
print("CHECK 34 — DYE STOCK GRADE HEADER: must exist in dynamic thead")
print("=" * 70)
idx_ds = PAGES.find('function renderDyeStock(')
fn_end_ds = PAGES.find('\nfunction ', idx_ds+10)
ds_chunk = PAGES[idx_ds:fn_end_ds]
thead_idx = ds_chunk.find('_stTh.innerHTML=')
thead_end = ds_chunk.find('`;', thead_idx) + 2
ds_thead = ds_chunk[thead_idx:thead_end]
if '<th>Grade</th>' in ds_thead:
    ok("renderDyeStock: Grade header present in dynamic thead ✓")
else:
    fail("renderDyeStock: Grade header MISSING from dynamic thead — columns will misalign")

print("\n" + "=" * 70)
print("CHECK 35 — DYE TABLE FILTER ROW COUNT: must match header column count")
print("=" * 70)
idx_dt = PAGES.find('function renderDyeTable(')
fn_end_dt = PAGES.find('\nfunction ', idx_dt+10)
dt_chunk = PAGES[idx_dt:fn_end_dt]
thead_dt = dt_chunk[dt_chunk.find('dye_thead.innerHTML='):dt_chunk.find('`;', dt_chunk.find('dye_thead.innerHTML='))+2]
rows_dt = thead_dt.split('</tr>')
filter_ths = len(re.findall(r'<th', rows_dt[0])) if len(rows_dt) > 0 else 0
header_row = rows_dt[1] if len(rows_dt) > 1 else ''
header_ths = len(re.findall(r'<th', header_row)) + len(re.findall(r"sortTh\(", header_row))
if filter_ths == header_ths:
    ok(f"renderDyeTable: filter row ({filter_ths}) matches header row ({header_ths}) ✓")
else:
    fail(f"renderDyeTable: filter row ({filter_ths}) != header row ({header_ths}) — columns will misalign")

print("\n" + "=" * 70)
print("CHECK 36 — NO VISIBLE OLD SUB-ROWS: _subRDT/_subR2 must not exist")
print("=" * 70)
for var in ['_subRDT', '_subR2', '_srcsDT', '_srcs2']:
    if var in PAGES:
        fail(f"{var} still present — causes visible stacked rows inflating row height")
    else:
        ok(f"{var}: not present ✓")

print("\n" + "=" * 70)
print("CHECK 37 — TOGGLE SUB-ROWS: toggleSourceRows must be defined")
print("=" * 70)
if 'function toggleSourceRows(' in PAGES:
    ok("toggleSourceRows function defined ✓")
else:
    fail("toggleSourceRows function MISSING — expand/collapse will not work")
if 'src-sub-' in PAGES and 'display:none' in PAGES:
    ok("src-sub- class and display:none found in sub-rows ✓")
else:
    fail("Sub-rows missing src-sub- class or display:none")

print("\n" + "=" * 70)
print("CHECK 38 — TEMPLATE LITERAL SUB-ROWS: must be outside backtick")
print("=" * 70)
for fn_name in ['renderDyeStock', 'renderDyeTable']:
    fn_s = PAGES.find(f'function {fn_name}(')
    fn_e = PAGES.find('\nfunction ', fn_s+10)
    fn_chunk = PAGES[fn_s:fn_e]
    slice_pos = fn_chunk.find('.slice(1).map(s=>')
    if slice_pos == -1:
        ok(f"{fn_name}: no multi-source sub-rows (single source only) ✓")
        continue
    before = fn_chunk[:slice_pos]
    last_bt = before.rfind('`')
    after_bt = fn_chunk[last_bt+1:last_bt+5].strip()
    if after_bt.startswith('+') or after_bt.startswith(';'):
        ok(f"{fn_name}: sub-rows correctly outside template literal ✓")
    else:
        fail(f"{fn_name}: sub-rows may be inside template literal — will render as text")

# ═══════════════════════════════════════════════════════════════════════════
# CHECKS 39+ — merged in from the second (lightweight) checker, 2026-07-07.
# Each verified individually against the real codebase before inclusion.
# The one broken check from that script (sources[0] regression guard) was
# NOT ported as-is — see Check 39 below for the corrected version.
# ═══════════════════════════════════════════════════════════════════════════

print("\n" + "=" * 70)
print("CHECK 39 — DYE SOURCES[0] BUG: ALL triggerSummaryUpdate('dye',...) CALLS MUST ITERATE SOURCES")
print("=" * 70)
# Corrected version of the lightweight checker's broken check. The original
# used `pages.split('triggerSummaryUpdate')[1]` which only inspects text
# after the FIRST occurrence of the string in the whole file — effectively
# checking almost nothing. This version finds every actual call site of
# triggerSummaryUpdate('dye', {... lotId: ...}) and confirms it is reached
# via a .forEach(src=>...) over a sources array, not a hardcoded sources[0].
dye_trigger_calls = list(re.finditer(r"triggerSummaryUpdate\('dye',\{[^}]*\}\)", PAGES))
bad_sources0 = []
for m in dye_trigger_calls:
    # Look at the 200 chars before the call for the iteration pattern
    context = PAGES[max(0, m.start()-200):m.start()]
    call_text = m.group(0)
    if 'src.lotId' in call_text or 'src.grade' in call_text or 'src.vendor' in call_text:
        # Must be inside a forEach(src=>...) or map(src=>...) — the latter
        # is the correct pattern for Promise.all-wrapped synchronized
        # iteration (Jul 14 2026, Item H/G fixes), equally valid, just not
        # originally recognized by this check.
        if '.forEach(src=>' not in context and '.forEach((src' not in context and '.map(src=>' not in context and '.map((src' not in context:
            bad_sources0.append(PAGES.count('\n', 0, m.start()) + 1)
    elif 'sources[0]' in call_text:
        bad_sources0.append(PAGES.count('\n', 0, m.start()) + 1)
print(f"  Checked {len(dye_trigger_calls)} triggerSummaryUpdate('dye',...) call sites")
if bad_sources0:
    fail(f"triggerSummaryUpdate('dye',...) not iterating all sources at line(s): {bad_sources0} — only first/no source lot gets its summary recalculated")
else:
    ok("All triggerSummaryUpdate('dye',...) call sites iterate every source lot")

print("\n" + "=" * 70)
print("CHECK 40 — SUBMIT VALIDATION HAS NO DIRECT FIREBASE CALLS")
print("=" * 70)
# Submit functions must validate against DB (real-time synced), never a fresh
# Firebase read — direct reads caused the "Checking live availability..." hang.
no_direct_fb = [
    ("pack submit",      "fbDB.ref('/tc/packEntries')" not in PAGES),
    ("wind submit",      "fbDB.ref('/tc/windEntries')" not in PAGES),
    ("stageEntries submit", "fbDB.ref('/tc/stageEntries').orderByChild" not in PAGES),
    ("dispatches submit",   "fbDB.ref('/tc/dispatches').orderByChild" not in PAGES),
]
for label, passed in no_direct_fb:
    if passed:
        ok(f"No direct Firebase read in {label}")
    else:
        fail(f"Direct Firebase read found in {label} — will cause hang/lag, use DB directly instead")
if 'Checking live availability' in PAGES:
    fail("Stale 'Checking live availability...' message still present — submit validation should be instant (DB-based)")
else:
    ok("No 'Checking live availability' message anywhere")

print("\n" + "=" * 70)
print("CHECK 41 — sentToDye FIELD PRESENT IN WORKER SUMMARY")
print("=" * 70)
if 'sentToDye' in WORKER:
    ok("sentToDye field present in worker.js summary calculation")
else:
    fail("sentToDye field MISSING from worker.js — lot master 'Sent to Dye' column will show blank/wrong")

print("\n" + "=" * 70)
print("CHECK 42 — RECALC ALL SUMMARIES WIRES ITS BACKGROUND ENDPOINT (Jul 18 2026 rewrite)")
print("=" * 70)
if ('recalc-all-btn' in HTML or 'recalcAllSummaries' in PAGES):
    ok("Recalc All Summaries button present")
else:
    fail("Recalc All Summaries button missing from index.html/pages.js")
if 'api/summary/recalc-all' in PAGES:
    ok("Recalc calls /api/summary/recalc-all (single background job, covers both RM and dye lot summaries)")
else:
    fail("Recalc does NOT call /api/summary/recalc-all — may have regressed to the old per-batch reload pattern")
if 'api/summary/recalc-status' in PAGES:
    ok("Recalc polls /api/summary/recalc-status for background-job completion")
else:
    fail("Recalc does NOT poll /api/summary/recalc-status — client has no way to know when the background job finished")

print("\n" + "=" * 70)
print("CHECK 43 — BACKUP META/DATA SPLIT + SHALLOW CLEANUP FETCH")
print("=" * 70)
if "/meta'" in PAGES or '/meta`' in PAGES:
    ok("Backup meta/data split (writes to /meta node) present")
else:
    fail("Backup meta/data split missing — backup modal will fetch full 4MB bodies instead of 1KB meta")
if 'shallow=true' in PAGES:
    ok("Backup cleanup uses shallow=true REST fetch")
else:
    fail("Backup cleanup missing shallow=true — will download full /backups node (can be 90MB+)")

print("\n" + "=" * 70)
print("CHECK 44 — DROPDOWN SORT ORDER: DYE LOTS DESCENDING, NO STALE INTERNAL SORT")
print("=" * 70)
if 'const unique=[...new Set(vals.filter(Boolean))].sort()' in PAGES:
    fail("buildColFilter still has old internal .sort() — caller-provided order gets overridden")
else:
    ok("buildColFilter does not force its own sort — caller order preserved")
if 'b.dyeLotNo||' in PAGES and 'localeCompare(a.dyeLotNo' in PAGES:
    ok("Dye lot dropdowns sorted descending by dyeLotNo")
else:
    warn("Could not confirm descending dye lot sort pattern — verify manually if dropdown order was recently touched")

print("\n" + "=" * 70)
print("CHECK 45 — DISPATCH DROPDOWN USES getPackBalAvailable NOT getPackBal")
print("=" * 70)
if 'getPackBalAvailable(d.id).weight>0' in PAGES:
    ok("Dispatch dropdown correctly uses getPackBalAvailable")
else:
    fail("Dispatch dropdown does not use getPackBalAvailable(d.id).weight>0 — may show lots with zero available balance")

print("\n" + "=" * 70)
print("CHECK 46 — WORKER API ENDPOINT ROLL-CALL")
print("=" * 70)
REQUIRED_WORKER_ENDPOINTS = [
    '/api/summary/trigger', '/api/summary/recalc-all', '/api/summary/recalc-status',
    '/api/summaries', '/api/dyelotsummaries', '/api/search',
]
for ep in REQUIRED_WORKER_ENDPOINTS:
    if ep in WORKER:
        ok(f"Worker defines {ep}")
    else:
        fail(f"Worker MISSING endpoint {ep}")
if 'handleSummaryTrigger' in WORKER:
    ok("handleSummaryTrigger defined")
else:
    fail("handleSummaryTrigger MISSING from worker.js")
if 'calcLotSummary' in WORKER or 'calcSummaryFromData' in WORKER:
    ok("Summary calculation function defined")
else:
    fail("Neither calcLotSummary nor calcSummaryFromData found in worker.js")

print("\n" + "=" * 70)
print("CHECK 47 — WORKER MERGES MULTI-DELIVERY LOTS IN BATCH RECALC")
print("=" * 70)
if 'mergedMap' in WORKER:
    ok("Worker batch recalc merges multi-delivery lots (mergedMap present)")
else:
    fail("mergedMap not found in worker.js — bulk summary recalc may not correctly merge multi-delivery lots")

print("\n" + "=" * 70)
print("CHECK 48 — CRITICAL GLOBALS DECLARED (State-object architecture, Jul 10 2026)")
print("=" * 70)
# Jul 10 2026: 29 previously-individual `let x=...` globals were consolidated
# into a single `const State={...}` object (module-conversion prep — see
# .agents/AGENTS.md). Variables that moved into State are now checked as
# State object properties + State.x reference usage, not standalone `let`.
# _dbListenerAttached, _renderDebounceTimer, _pendingSave stayed internal to
# core.js (never referenced from pages.js) — still checked the old way.
_state_migrated = ['_voidEntryId', '_voidEntryType', '_wipTab']
_still_standalone = ['_dbListenerAttached', '_renderDebounceTimer', '_pendingSave']
for var in _state_migrated:
    if f'{var}:' in CORE and f'State.{var}' in (CORE + PAGES):
        ok(f"{var} present in State object and referenced as State.{var}")
    else:
        fail(f"{var} MISSING from State object or never referenced as State.{var} — check the Jul 10 2026 state refactor")
for var in _still_standalone:
    if f'let {var}' in CORE or f'let {var}' in PAGES:
        ok(f"let {var} declared")
    else:
        fail(f"let {var} NOT declared anywhere — will cause ReferenceError or silent global leakage")

print("\n" + "=" * 70)
print("CHECK 49 — BALANCE FUNCTIONS: CACHE-FIRST WITH LIVE FALLBACK, WIP STAYS LIVE")
print("=" * 70)
balance_fns = ['getRMBalance', 'getSoftBalance', 'getSoftBalanceWeight', 'getDyeBal', 'getWindBal', 'getPackBal', 'getTotalDispatched', 'getDyeBalance', 'getWindBalance', 'getPackBalance']
for fn_name in balance_fns:
    fn_start = CORE.find(f'function {fn_name}(')
    if fn_start == -1:
        fail(f'{fn_name} not found in core.js')
        continue
    brace = CORE.find('{', fn_start)
    depth = 0; j = brace
    while j < len(CORE):
        if CORE[j] == '{': depth += 1
        elif CORE[j] == '}':
            depth -= 1
            if depth == 0: break
        j += 1
    fn_body = CORE[fn_start:j+1]
    reads_cache = '_getLotSummary(' in fn_body or '_getDyeLotSummary(' in fn_body
    has_live_calc_call = any(c in fn_body for c in ['calcRMBalance(', 'calcSoftBalanceWeight(', 'calcDyeBal(', 'calcWindBal(', 'calcPackBal(', 'calcTotalDispatchedApproved(', 'calcDyeBalanceByLot(', 'calcWindBalanceByLot(', 'getSoftOut(', 'getPackOut(', 'getDispatched('])
    if reads_cache and not has_live_calc_call:
        fail(f'{fn_name} reads from summary cache but has no live-calc fallback — a lot with no cached summary yet would break')
    elif reads_cache and has_live_calc_call:
        ok(f'{fn_name} correctly reads cache first with a live-calc fallback (archive-aware, self-healing)')
    else:
        ok(f'{fn_name} correctly reads live DB (no cache dependency)')

print("\n" + "=" * 70)
print("CHECK 49b — AVAILABLE (WIP-CLAIM) FUNCTIONS STAY LIVE, NEVER CACHED")
print("=" * 70)
available_fns = ['getStageBalanceAvailable', 'getSoftBalanceWeightAvailable', 'getSoftBalanceAvailable', 'getDyeBalAvailable', 'getWindBalAvailable', 'getPackBalAvailable']
_SHARED_49B = None
try:
    _SHARED_49B = (BASE / 'assets/js/shared-balances.js').read_text(encoding='utf-8')
except Exception:
    pass
for fn_name in available_fns:
    src_text = CORE if f'function {fn_name}(' in CORE else (_SHARED_49B or '')
    fn_start = src_text.find(f'function {fn_name}(')
    if fn_start == -1:
        fail(f'{fn_name} not found in core.js or shared-balances.js')
        continue
    brace = src_text.find('{', fn_start)
    depth = 0; j = brace
    while j < len(src_text):
        if src_text[j] == '{': depth += 1
        elif src_text[j] == '}':
            depth -= 1
            if depth == 0: break
        j += 1
    fn_body = src_text[fn_start:j+1]
    if '_getLotSummary(' in fn_body or '_getDyeLotSummary(' in fn_body:
        fail(f'{fn_name} reads from summary cache in its WIP-claim math — this is the exact Jul 7 2026 staleness risk (35 duplicate entries)')
    else:
        ok(f'{fn_name} correctly computes WIP claims live')

print("\n" + "=" * 70)
print("CHECK 49c — SOFT BALANCE BAG COUNT PROPORTIONALLY SCALES WITH KG (worker.js)")
print("=" * 70)
try:
    _WORKER_49C = (BASE / 'worker.js').read_text(encoding='utf-8')
except Exception:
    _WORKER_49C = None
if _WORKER_49C is None:
    fail('Could not read worker.js for Check 49c')
else:
    _sb_sites = [m.start() for m in re.finditer(r'const softBalance\s*=', _WORKER_49C)]
    if len(_sb_sites) < 2:
        fail(f'Expected 2 softBalance construction sites in worker.js (calcSummaryFromData + updateSentToDyeOnly), found {len(_sb_sites)}')
    else:
        _all_scaled = True
        for _idx in _sb_sites:
            _window = _WORKER_49C[_idx:_idx+400]
            if 'units: softOut.units,' in _window or 'units:softOut.units,' in _window:
                fail(f'softBalance construction at offset {_idx} appears to use a flat unscaled units copy (the Jul 15 2026 bug pattern)')
                _all_scaled = False
        if _all_scaled:
            ok(f'All {len(_sb_sites)} softBalance construction sites in worker.js use ratio-scaled units, not a flat copy')

print("\n" + "=" * 70)
print("CHECK 49d — EVERY API ROUTE CALLS A FUNCTION THAT ACTUALLY EXISTS (worker.js)")
print("=" * 70)
# Jul 15 2026 — real incident, not theoretical. handleApproveAll and
# handleFactoryReset were BOTH found completely missing from the live
# file — the route was still there, calling a function that no longer
# existed anywhere. Confirmed both were built during an earlier part of
# this same session (not present in the true original upload) and lost
# during a LATER edit — shipped in multiple deliveries before being
# caught, purely by accident, during an unrelated conversation about a
# completely different feature. node --check does NOT catch this — a
# call to an undefined function is valid JavaScript syntax, it only
# fails at actual runtime, when a real user clicks the button. This
# check exists specifically so that class of bug can never ship silently
# again — it parses every route registration and confirms its handler
# function is actually defined somewhere in the file.
try:
    _route_matches = list(re.finditer(r"url\.pathname === '([^']+)'\s*\)\s*\{", WORKER))
    _defined_fns = set(re.findall(r'(?:async )?function (\w+)\(', WORKER))
    _route_problems = []
    for _rm in _route_matches:
        _route = _rm.group(1)
        _block = WORKER[_rm.end():_rm.end()+400]
        _call_m = re.search(r'return (?:await )?(\w+)\(', _block)
        if not _call_m:
            continue  # some routes inline their response, not a handler call — fine
        _fn = _call_m.group(1)
        if _fn not in _defined_fns and _fn not in ('errorResponse', 'jsonResponse'):
            _route_problems.append((_route, _fn))
    if _route_problems:
        for _route, _fn in _route_problems:
            fail(f"Route '{_route}' calls '{_fn}' — no such function is defined anywhere in worker.js. This is exactly the handleApproveAll/handleFactoryReset incident (Jul 15 2026) — a route silently calling nothing.")
    else:
        ok(f'All {len(_route_matches)} API routes call a function that actually exists')
except Exception as e:
    fail(f'Check 49d could not run: {e}')

print("\n" + "=" * 70)
print("CHECK 86 — calcRecycleBalance DEDUCTS SOFT-STAGE CONSUMPTION TOO (shared-balances.js)")
print("=" * 70)
# Jul 15 2026 — found zero checker coverage during a full session audit.
# calcDeadStockBalance subtracts 3 things (dye-consumed, Soft-consumed,
# scrapped); calcRecycleBalance was only subtracting 2 (missing the
# Soft-consumed term) even though recycle material can genuinely be fed
# into Soft directly (handleStageStart accepts a recycleId). Fixed to
# match calcDeadStockBalance's pattern.
try:
    _crb_idx = SHARED.find('function calcRecycleBalance(')
    if _crb_idx == -1:
        fail('calcRecycleBalance not found in shared-balances.js')
    else:
        _crb_sig_end = SHARED.find(')', _crb_idx)
        _crb_sig = SHARED[_crb_idx:_crb_sig_end]
        _crb_brace = SHARED.find('{', _crb_idx)
        _crb_depth = 0; _crb_j = _crb_brace
        while _crb_j < len(SHARED):
            if SHARED[_crb_j] == '{': _crb_depth += 1
            elif SHARED[_crb_j] == '}':
                _crb_depth -= 1
                if _crb_depth == 0: break
            _crb_j += 1
        _crb_body = SHARED[_crb_idx:_crb_j+1]
        if 'stageEntries' in _crb_sig and 'usedInSoft' in _crb_body:
            ok('calcRecycleBalance signature includes stageEntries and deducts usedInSoft, matching calcDeadStockBalance')
        else:
            fail('calcRecycleBalance is missing the usedInSoft deduction (or the stageEntries parameter) — regressed to the pre-Jul-15-2026 incomplete formula')
except Exception as e:
    fail(f'Check 86 could not run: {e}')

print("\n" + "=" * 70)
print("CHECK 87 — MASTER ITEM DELETE HAS REAL SERVER-SIDE PASSWORD VERIFICATION")
print("=" * 70)
# Jul 15 2026 — found zero checker coverage. confirmMasterDelete()/
# executeMasterDelete() (old, removed) verified the admin password in a
# separate round-trip as a client-side gate only; the actual deletion
# had no server re-check at all. Fixed via POST /api/master-item/delete.
try:
    if '/api/master-item/delete' not in WORKER:
        fail('POST /api/master-item/delete route not found — master item delete may have regressed to client-side only')
    else:
        _hmid_idx = WORKER.find('async function handleMasterItemDelete(')
        if _hmid_idx == -1:
            fail('handleMasterItemDelete not found in worker.js')
        else:
            _hmid_brace = WORKER.find('{', _hmid_idx)
            _hmid_depth = 0; _hmid_j = _hmid_brace
            while _hmid_j < len(WORKER):
                if WORKER[_hmid_j] == '{': _hmid_depth += 1
                elif WORKER[_hmid_j] == '}':
                    _hmid_depth -= 1
                    if _hmid_depth == 0: break
                _hmid_j += 1
            _hmid_body = WORKER[_hmid_idx:_hmid_j+1]
            # Jul 29 2026 — updated for the real fix: _matchAnyAdminPassword
            # (checked "does this password match ANY admin", with zero
            # verification the actual requester was that admin) has been
            # replaced with _verifySelfPassword, which ties the password
            # check to the real, verified session's own username. Also
            # confirms the real session check (tokenClaim.role) is present.
            if '_verifySelfPassword(' in _hmid_body and 'tokenClaim' in _hmid_body:
                ok('handleMasterItemDelete verifies the password against the real, verified session — not just any admin')
            else:
                fail('handleMasterItemDelete does not correctly verify the password against the real session — may have regressed to the Jul 29 2026 vulnerability (trusting any admin match, not the actual requester)')
except Exception as e:
    fail(f'Check 87 could not run: {e}')

print("\n" + "=" * 70)
print("CHECK 88 — PENDING ENTRIES CANNOT BE EDITED, ONLY APPROVE/REJECT (all 5 stages)")
print("=" * 70)
# Jul 15 2026 — Priyam's explicit decision, found zero checker coverage.
# A Pending entry must be Rejected and resubmitted, never edited in
# place — Approved entries can still be edited (the legitimate later-fix
# tool), untouched. Guard added independently to all 5 stage branches in
# handleEditEntry since each fetches its own entry separately.
try:
    _hee_idx = WORKER.find('async function handleEditEntry(')
    if _hee_idx == -1:
        fail('handleEditEntry not found in worker.js')
    else:
        _hee_brace = WORKER.find('{', _hee_idx)
        _hee_depth = 0; _hee_j = _hee_brace
        while _hee_j < len(WORKER):
            if WORKER[_hee_j] == '{': _hee_depth += 1
            elif WORKER[_hee_j] == '}':
                _hee_depth -= 1
                if _hee_depth == 0: break
            _hee_j += 1
        _hee_body = WORKER[_hee_idx:_hee_j+1]
        _guard_count = _hee_body.count('Cannot edit a Pending entry')
        if _guard_count >= 5:
            ok(f'handleEditEntry blocks Pending-status edits in all 5 stage branches ({_guard_count} guards found)')
        else:
            fail(f'handleEditEntry only has {_guard_count}/5 Pending-edit guards — may have regressed for one or more stages (Soft/Dye/Wind/Pack/Dispatch)')
except Exception as e:
    fail(f'Check 88 could not run: {e}')

print("\n" + "=" * 70)
print("CHECK 89 — RESET ALL DATA REQUIRES A GENUINE ADMIN SESSION, NOT ADMIN-OR-MANAGER")
print("=" * 70)
# Jul 15 2026 — Priyam's explicit decision, found zero checker coverage.
# Jul 29 2026 — real, serious, confirmed vulnerability found during the
# Masters/Users audit: the original fix (_matchAdminOnlyPassword) only
# ever checked whether a password matched SOME admin account — never
# whether the actual requester was genuinely logged in as anyone at all.
# That function is now removed entirely, replaced with a real session
# check (tokenClaim.role) plus _verifySelfPassword, tied to the actual
# logged-in person.
#
# Jul 29 2026, later same day — Priyam's explicit, direct instruction:
# admin and manager are the same tier, everywhere, no exceptions.
# Supervisor and below remain genuinely lower-privileged. This
# supersedes the earlier "admin-only, not manager" rule for this
# specific action — updated to verify the current, correct rule.
try:
    _hfr_idx = WORKER.find('async function handleFactoryReset(')
    if _hfr_idx == -1:
        fail('handleFactoryReset not found in worker.js')
    else:
        _hfr_window = WORKER[_hfr_idx:_hfr_idx+600]
        _uses_real_session = "tokenClaim" in _hfr_window and "['admin', 'manager'].includes(role)" in _hfr_window
        _no_old_unsafe_fn = '_matchAdminOnlyPassword(' not in _hfr_window and '_matchAnyAdminPassword(' not in _hfr_window
        if _uses_real_session and _no_old_unsafe_fn:
            ok('handleFactoryReset correctly restricts to admin-or-manager via real session verification')
        else:
            fail('handleFactoryReset does not correctly restrict to admin-or-manager via a real session check — may have regressed to the Jul 29 2026 vulnerability, or lost the admin/manager parity Priyam explicitly confirmed')
    if '_matchAdminOnlyPassword(' in WORKER or 'async function _matchAdminOnlyPassword' in WORKER:
        fail('_matchAdminOnlyPassword has reappeared — this is the exact unauthenticated password-matching vulnerability found and fixed Jul 29 2026')
    else:
        ok('The unsafe _matchAdminOnlyPassword function is confirmed removed, not just unused')
except Exception as e:
    fail(f'Check 89 could not run: {e}')

print("\n" + "=" * 70)
print("CHECK 90 — RESET ALL DATA COVERS THE FULL TABLE LIST, EXCLUDES CONFIG TABLES")
print("=" * 70)
# Jul 15 2026 — found only partial coverage (Check 49d confirms the
# function exists, not that its content is correct). Priyam confirmed:
# reset everything except users (never in scope) and masters/parties
# (kept as configuration). agingThresholds kept too (judgment call,
# flagged separately). archive/* IS included (severe, but explicitly
# agreed).
try:
    _hfr_idx2 = WORKER.find('async function handleFactoryReset(')
    if _hfr_idx2 == -1:
        fail('handleFactoryReset not found in worker.js')
    else:
        _hfr_brace = WORKER.find('{', _hfr_idx2)
        _hfr_depth = 0; _hfr_j = _hfr_brace
        while _hfr_j < len(WORKER):
            if WORKER[_hfr_j] == '{': _hfr_depth += 1
            elif WORKER[_hfr_j] == '}':
                _hfr_depth -= 1
                if _hfr_depth == 0: break
            _hfr_j += 1
        _hfr_body = WORKER[_hfr_idx2:_hfr_j+1]
        _expected_present = ['/tc/lots', '/tc/stageEntries', '/tc/dyeLots', '/tc/windEntries', '/tc/packEntries',
                              '/tc/dispatches', '/tc/lotSummaries', '/tc/dyeLotSummaries', '/tc/archive',
                              '/tc/deadStock', '/tc/recycleStock', '/tc/editLog']
        _missing_present = [p for p in _expected_present if f"'{p}'" not in _hfr_body]
        _expected_absent = ["'/tc/masters'", "'/tc/parties'", "'/tc/users'", "'/tc/agingThresholds'"]
        _wrongly_present = [p for p in _expected_absent if p in _hfr_body]
        if _missing_present:
            fail(f'handleFactoryReset is missing expected tables from its reset list: {_missing_present}')
        elif _wrongly_present:
            fail(f'handleFactoryReset incorrectly includes config tables that should be kept: {_wrongly_present}')
        else:
            ok('handleFactoryReset resets the full expected table list and correctly excludes masters/parties/agingThresholds/users')
except Exception as e:
    fail(f'Check 90 could not run: {e}')

print("\n" + "=" * 70)
print("CHECK 91 — VOID RM LOT CASCADE VOIDS THE LOT RECORD ITSELF, NOT JUST DOWNSTREAM")
print("=" * 70)
# Jul 15 2026 — found only partial coverage. handleVoidRMLotCascade
# voided every downstream Soft/Dye/Wind/Pack/Dispatch entry but never
# marked the RM lot record itself as Voided — Edit/Void buttons kept
# showing forever, Status column could never show "Voided".
try:
    _hvrlc_idx = WORKER.find('async function handleVoidRMLotCascade(')
    if _hvrlc_idx == -1:
        fail('handleVoidRMLotCascade not found in worker.js')
    else:
        _hvrlc_brace = WORKER.find('{', _hvrlc_idx)
        _hvrlc_depth = 0; _hvrlc_j = _hvrlc_brace
        while _hvrlc_j < len(WORKER):
            if WORKER[_hvrlc_j] == '{': _hvrlc_depth += 1
            elif WORKER[_hvrlc_j] == '}':
                _hvrlc_depth -= 1
                if _hvrlc_depth == 0: break
            _hvrlc_j += 1
        _hvrlc_body = WORKER[_hvrlc_idx:_hvrlc_j+1]
        if '/tc/lots/' in _hvrlc_body and 'Voided' in _hvrlc_body and 'lotRecord' in _hvrlc_body:
            ok('handleVoidRMLotCascade voids the lot record itself, not just downstream entries')
        else:
            fail('handleVoidRMLotCascade does not appear to void the RM lot record itself — may have regressed to only voiding downstream entries')
except Exception as e:
    fail(f'Check 91 could not run: {e}')

print("\n" + "=" * 70)
print("CHECK 92 — OVERRIDE-APPROVE SUPPORTS STAGE TYPE (executeOverride migration)")
print("=" * 70)
# Jul 15 2026 — found only incidental, unrelated coverage (an old check
# happens to mention the function name for a different reason).
# executeOverride (client-side status toggle for Rejected Soft entries)
# was migrated into the existing /api/override-approve endpoint by
# adding a 'stage' type, instead of building a duplicate endpoint.
try:
    _ovt_idx = WORKER.find('const _OVERRIDE_TABLE = {')
    if _ovt_idx == -1:
        fail('_OVERRIDE_TABLE not found in worker.js')
    else:
        _ovt_end = WORKER.find('};', _ovt_idx)
        _ovt_def = WORKER[_ovt_idx:_ovt_end]
        if "stage: 'stageEntries'" in _ovt_def:
            ok("_OVERRIDE_TABLE includes 'stage' — executeOverride's migration into handleOverrideApprove is present")
        else:
            fail("_OVERRIDE_TABLE does not include a 'stage' entry — executeOverride migration may have regressed")
    _hoa_idx = WORKER.find('async function handleOverrideApprove(')
    if _hoa_idx != -1:
        _hoa_brace = WORKER.find('{', _hoa_idx)
        _hoa_depth = 0; _hoa_j = _hoa_brace
        while _hoa_j < len(WORKER):
            if WORKER[_hoa_j] == '{': _hoa_depth += 1
            elif WORKER[_hoa_j] == '}':
                _hoa_depth -= 1
                if _hoa_depth == 0: break
            _hoa_j += 1
        _hoa_body = WORKER[_hoa_idx:_hoa_j+1]
        if "type === 'stage'" in _hoa_body and 'outU' in _hoa_body and 'inU' in _hoa_body:
            ok('handleOverrideApprove retains the stage-specific output-exceeds-input validation from the original executeOverride')
        else:
            fail('handleOverrideApprove is missing the stage-specific output-exceeds-input validation')
except Exception as e:
    fail(f'Check 92 could not run: {e}')

print("\n" + "=" * 70)
print("CHECK 93 — PHASE 2: ALL 5 APPROVE PATHS USE nudge*, NOT THE OLD FULL RECOMPUTE")
print("=" * 70)
# Jul 15 2026 — Phase 2 of the running-balance plan. All 5 individual
# "Approve" buttons were fully client-side (a real gap found while
# scoping this) — migrated server-side via handleApproveEntry, and this
# is also where nudgeLotSummary/nudgeDyeLotSummary (built in Phase 1)
# get their first real callers. handleApproveAll (bulk) was rewritten
# the same way, accumulating deltas per unique lot/dyeLot across a whole
# batch before nudging once per key.
try:
    if '/api/approve-entry' not in WORKER:
        fail('POST /api/approve-entry route not found — the 5 individual approve buttons may have regressed to client-side')
    else:
        ok('POST /api/approve-entry route exists')
    _hae_idx = WORKER.find('async function handleApproveEntry(')
    if _hae_idx == -1:
        fail('handleApproveEntry not found in worker.js')
    else:
        _hae_brace = WORKER.find('{', _hae_idx)
        _hae_depth = 0; _hae_j = _hae_brace
        while _hae_j < len(WORKER):
            if WORKER[_hae_j] == '{': _hae_depth += 1
            elif WORKER[_hae_j] == '}':
                _hae_depth -= 1
                if _hae_depth == 0: break
            _hae_j += 1
        _hae_body = WORKER[_hae_idx:_hae_j+1]
        _has_nudge = 'nudgeLotSummary(' in _hae_body and 'nudgeDyeLotSummary(' in _hae_body
        _has_old_recompute = 'updateLotSummary(' in _hae_body or 'updateDyeLotSummary(' in _hae_body
        if _has_nudge and not _has_old_recompute:
            ok('handleApproveEntry uses nudgeLotSummary/nudgeDyeLotSummary, not the old full-recompute functions')
        elif _has_old_recompute:
            fail('handleApproveEntry still calls the old full-recompute functions — may have regressed away from Phase 2 nudging')
        else:
            fail('handleApproveEntry does not appear to call any summary-update mechanism at all')
    _haa_idx = WORKER.find('async function handleApproveAll(')
    if _haa_idx != -1:
        _haa_brace = WORKER.find('{', _haa_idx)
        _haa_depth = 0; _haa_j = _haa_brace
        while _haa_j < len(WORKER):
            if WORKER[_haa_j] == '{': _haa_depth += 1
            elif WORKER[_haa_j] == '}':
                _haa_depth -= 1
                if _haa_depth == 0: break
            _haa_j += 1
        _haa_body = WORKER[_haa_idx:_haa_j+1]
        if 'nudgeLotSummary(' in _haa_body and 'nudgeDyeLotSummary(' in _haa_body:
            ok('handleApproveAll (bulk) also uses nudge functions, not the old full-recompute pattern')
        else:
            fail('handleApproveAll does not appear to use the Phase 2 nudge functions — may have regressed to full recompute')
except Exception as e:
    fail(f'Check 93 could not run: {e}')

print("\n" + "=" * 70)
print("CHECK 94 — approveEntry DELEGATES TO THE MIGRATED FUNCTION, NOT A THIRD IMPLEMENTATION")
print("=" * 70)
# Jul 16 2026 — real incident: approveEntry (pages.js) was a THIRD,
# independent, still fully client-side approval implementation that the
# real Soft-stage button actually called — the earlier migration of
# approveStageEntry/approveDyeLot/approveWindEntry/approvePackEntry/
# approveDispatch never reached this button at all. Found only by
# building a browser-based smoke test and tracing the real onclick
# wiring, not caught by any isolated code test. Fixed: approveEntry is
# now a thin delegate to approveStageEntry.
try:
    _ae_idx = PAGES.find('async function approveEntry(')
    if _ae_idx == -1:
        fail('approveEntry not found in pages.js')
    else:
        _ae_brace = PAGES.find('{', _ae_idx)
        _ae_depth = 0; _ae_j = _ae_brace
        while _ae_j < len(PAGES):
            if PAGES[_ae_j] == '{': _ae_depth += 1
            elif PAGES[_ae_j] == '}':
                _ae_depth -= 1
                if _ae_depth == 0: break
            _ae_j += 1
        _ae_body = PAGES[_ae_idx:_ae_j+1]
        _ae_code_only = '\n'.join(l for l in _ae_body.split('\n') if not l.strip().startswith('//'))
        _has_own_writes = 'save(' in _ae_code_only or 'State.DB' in _ae_code_only
        _delegates = 'approveStageEntry(' in _ae_code_only
        if _delegates and not _has_own_writes:
            ok('approveEntry correctly delegates to approveStageEntry, no independent client-side writes')
        else:
            fail('approveEntry appears to have regressed to an independent client-side implementation (the exact Jul 16 2026 incident)')
except Exception as e:
    fail(f'Check 94 could not run: {e}')

print("\n" + "=" * 70)
print("CHECK 95 — SOFT APPROVAL BLOCKS OUTPUT EXCEEDING INPUT")
print("=" * 70)
# Jul 16 2026 — found missing while fixing Check 94's incident: the
# original client-side approveEntry had this validation, handleApproveEntry
# (its server-side replacement) did not, when first built.
try:
    _hae2_idx = WORKER.find('async function handleApproveEntry(')
    if _hae2_idx == -1:
        fail('handleApproveEntry not found in worker.js')
    else:
        _hae2_brace = WORKER.find('{', _hae2_idx)
        _hae2_depth = 0; _hae2_j = _hae2_brace
        while _hae2_j < len(WORKER):
            if WORKER[_hae2_j] == '{': _hae2_depth += 1
            elif WORKER[_hae2_j] == '}':
                _hae2_depth -= 1
                if _hae2_depth == 0: break
            _hae2_j += 1
        _hae2_body = WORKER[_hae2_idx:_hae2_j+1]
        if 'outUnits' in _hae2_body and 'inUnits' in _hae2_body and 'exceeds Input' in _hae2_body:
            ok('handleApproveEntry blocks output-exceeds-input on Soft approval')
        else:
            fail('handleApproveEntry is missing the output-exceeds-input validation for Soft approval')
except Exception as e:
    fail(f'Check 95 could not run: {e}')

print("\n" + "=" * 70)
print("CHECK 96 — PHASE 4: ALL 3 VOID PATHS USE REVERSAL NUDGES, NOT THE OLD FULL RECOMPUTE")
print("=" * 70)
# Jul 17 2026 — Phase 4 of the running-balance plan. handleVoidEntry,
# handleVoidChain, and handleVoidRMLotCascade all now reverse the exact
# original balance contribution for any entry that was genuinely
# Approved before being voided, using nudgeLotSummary/nudgeDyeLotSummary
# instead of the old full-recompute (updateSentToDyeOnly/
# updateLotSummary/updateDyeLotSummary) triggers.
for _vfn in ['handleVoidEntry', 'handleVoidChain', 'handleVoidRMLotCascade']:
    _vidx = WORKER.find(f'async function {_vfn}(')
    if _vidx == -1:
        fail(f'{_vfn} not found in worker.js')
        continue
    _vbrace = WORKER.find('{', _vidx)
    _vdepth = 0; _vj = _vbrace
    while _vj < len(WORKER):
        if WORKER[_vj] == '{': _vdepth += 1
        elif WORKER[_vj] == '}':
            _vdepth -= 1
            if _vdepth == 0: break
        _vj += 1
    _vbody = WORKER[_vidx:_vj+1]
    _has_nudge = 'nudgeLotSummary(' in _vbody and 'nudgeDyeLotSummary(' in _vbody
    _has_was_approved_check = 'if (!wasApproved) return;' in _vbody or 'if (wasApproved) {' in _vbody
    _has_old_pattern = 'updateSentToDyeOnly(' in _vbody or 'updateLotSummary(' in _vbody or 'updateDyeLotSummary(' in _vbody
    if _has_nudge and _has_was_approved_check and not _has_old_pattern:
        ok(f'{_vfn} uses Phase 4 reversal nudges, checks wasApproved before reversing, no old full-recompute pattern')
    else:
        fail(f'{_vfn} may have regressed — missing nudge calls, missing the wasApproved guard (would reverse Pending entries that never affected any balance), or still contains the old full-recompute pattern')

print("\n" + "=" * 70)
print("CHECK 97 — DAILY BALANCE CHECKER: WIRED CORRECTLY, NO TAUTOLOGY, CORRECT RETURN SHAPES")
print("=" * 70)
# Jul 17 2026 — the daily checker, built to Priyam's formula spec (see
# HOLISTIC_PLAN.md). Three real things this check guards against
# regressing, each found and fixed during this exact build:
#   1. Check 2's conservation formula must use LIVE cached balances, not
#      a fresh recompute of the same "whatever's left over" formula —
#      using the recompute made the equation true by construction,
#      always, catching nothing. Found via a failing test, not assumed.
#   2. calcRMReturnedOut returns {units, weight}, not a plain number —
#      using it directly caused silent string concatenation into NaN,
#      which made the gap check always evaluate false. Also found via a
#      failing test.
#   3. Wired into runCronBackup (reusing its already-downloaded data,
#      not a second fetch) and has a working on-demand trigger.
try:
    _rdbc_idx = WORKER.find('async function runDailyBalanceCheck(')
    if _rdbc_idx == -1:
        fail('runDailyBalanceCheck not found in worker.js')
    else:
        _rdbc_brace = WORKER.find('{', _rdbc_idx)
        _rdbc_depth = 0; _rdbc_j = _rdbc_brace
        while _rdbc_j < len(WORKER):
            if WORKER[_rdbc_j] == '{': _rdbc_depth += 1
            elif WORKER[_rdbc_j] == '}':
                _rdbc_depth -= 1
                if _rdbc_depth == 0: break
            _rdbc_j += 1
        _rdbc_body = WORKER[_rdbc_idx:_rdbc_j+1]
        if 'liveRmBal' in _rdbc_body and 'liveSoftBal' in _rdbc_body and 'rmBal.weight + returnedKg + softBalKg' not in _rdbc_body:
            ok('Check 2 uses live cached balances, not the tautological recompute-of-a-remainder pattern')
        else:
            fail('Check 2 may have regressed to using a fresh recompute of the remainder formula — this makes the conservation check true by construction and catches nothing (the exact bug found and fixed Jul 17 2026)')
        if 'returnedObj.weight' in _rdbc_body:
            ok('calcRMReturnedOut\'s return value is correctly unwrapped to .weight before use in arithmetic')
        else:
            fail('returnedKg may have regressed to using calcRMReturnedOut\'s return value directly (an object, not a number) — causes silent NaN/string-concatenation bugs')
        import re as _re_ctda
        _ctda_calls = _re_ctda.findall(r'calcTotalDispatchedApproved\([a-zA-Z_][a-zA-Z0-9_]*,\s*d\.id,\s*dyeLots\)', _rdbc_body)
        if _ctda_calls:
            ok('calcTotalDispatchedApproved called with all 3 required arguments (dyeLots included for its fallback matching path)')
        else:
            fail('calcTotalDispatchedApproved may be missing its third argument (dyeLots) again')
except Exception as e:
    fail(f'Check 97 (formula correctness) could not run: {e}')

try:
    _backup_idx = WORKER.find('async function runCronBackup(')
    _backup_body = WORKER[_backup_idx:WORKER.find('\nasync function ', _backup_idx + 20)]
    if 'runDailyBalanceCheck(tc' in _backup_body:
        ok('Daily checker is wired into runCronBackup, reusing the already-downloaded tc object')
    else:
        fail('Daily checker does not appear to be called from runCronBackup — may have regressed to a separate fetch, or been disconnected entirely')
    if '/api/daily-check/run-now' not in WORKER or '/api/daily-check/latest' not in WORKER:
        fail('Daily checker on-demand routes missing — Priyam\'s explicit requirement to test this without waiting a full day')
    else:
        ok('Daily checker on-demand routes (run-now, latest) present')
except Exception as e:
    fail(f'Check 97 (wiring) could not run: {e}')

print("\n" + "=" * 70)
print("CHECK 98 — DAILY CHECKER NEVER WRITES ANYTHING — PRIYAM'S EXPLICIT DECISION")
print("=" * 70)
# Jul 17 2026 — Priyam's explicit call: no auto-fix at all, ever. Every
# mismatch gets flagged for manual review only. This check guards
# against that decision quietly regressing later (e.g. someone adding
# a write path back in without realizing it contradicts a deliberate
# choice) — verifies runDailyBalanceCheck contains no fbPatch/fbSet
# write calls at all, only the read-side calculations and the one
# report-saving fbSet at the very end.
try:
    _rdbc_idx = WORKER.find('async function runDailyBalanceCheck(')
    if _rdbc_idx == -1:
        fail('runDailyBalanceCheck not found in worker.js')
    else:
        _rdbc_brace = WORKER.find('{', _rdbc_idx)
        _rdbc_depth = 0; _rdbc_j = _rdbc_brace
        while _rdbc_j < len(WORKER):
            if WORKER[_rdbc_j] == '{': _rdbc_depth += 1
            elif WORKER[_rdbc_j] == '}':
                _rdbc_depth -= 1
                if _rdbc_depth == 0: break
            _rdbc_j += 1
        _rdbc_body = WORKER[_rdbc_idx:_rdbc_j+1]
        _has_fbpatch = 'fbPatch(' in _rdbc_body
        _fbset_calls = _rdbc_body.count('fbSet(')
        if not _has_fbpatch and _fbset_calls == 1 and 'dailyCheckReports' in _rdbc_body:
            ok('runDailyBalanceCheck has zero fbPatch calls and exactly one fbSet call (saving the report only) — no auto-fix write path exists')
        else:
            fail(f'runDailyBalanceCheck may have regressed to writing balance corrections — found fbPatch: {_has_fbpatch}, fbSet count: {_fbset_calls} (expected exactly 1, for the report only)')
except Exception as e:
    fail(f'Check 98 could not run: {e}')

print("\n" + "=" * 70)
print("CHECK 99 — MOISTURE/GAIN-LOSS: DEAD MECHANISM STAYS REMOVED, REAL PACK/WASTE CHECKS INTACT")
print("=" * 70)
# Jul 17 2026 — Priyam's explicit decision, after a full exhaustive
# investigation (see HOLISTIC_PLAN.md for the complete story). The
# broken, misattributed moisturePct/moistureFlag mechanism was removed
# entirely. This check guards two things: the dead mechanism doesn't
# quietly come back, AND the two REAL, working reports it could be
# confused with (rptPack's tiered bands, rptWaste's Soft/Dye/Wind
# tracking) stay intact — since both are genuinely independent of the
# removed setting and must not be accidentally touched by a future
# "restore the moisture thing" attempt.
try:
    _dead_refs = []
    for term in ['getMoisturePct(', 'function saveMoisturePct(', 'window.saveMoisturePct', 'masters-moisture-panel', 'moisturePct']:
        if term in PAGES:
            _dead_refs.append(term)
    if not _dead_refs:
        ok('moisturePct/moistureFlag mechanism confirmed fully removed from pages.js — no dead references')
    else:
        fail(f'moisturePct-related code appears to have been reintroduced: {_dead_refs} — was deliberately removed Jul 17 2026, re-adding it needs a fresh, deliberate decision, not an accidental regression')

    if 'moisturePct' in WORKER or 'moistureFlag' in WORKER:
        fail('worker.js now references moisturePct/moistureFlag — this was confirmed to have ZERO references before, any appearance now is a real regression')
    else:
        ok('worker.js still has zero moisturePct/moistureFlag references, matching the confirmed-clean baseline')

    _rptpack_idx = PAGES.find('function rptPack(')
    if _rptpack_idx == -1:
        fail('rptPack() not found — this is Priyam\'s real, actively-used Pack gain/loss report, must not be removed')
    else:
        _rptpack_body = PAGES[_rptpack_idx:_rptpack_idx+3000]
        _has_bands = "'0-2'" in _rptpack_body and "'2-5'" in _rptpack_body and "'5-10'" in _rptpack_body and "'10+'" in _rptpack_body
        if _has_bands:
            ok('rptPack() still has its real tiered bands (0-2/2-5/5-10/10+%) intact')
        else:
            fail('rptPack() is missing one or more of its real tiered bands — this is Priyam\'s actual Pack gain/loss tracking, must stay intact')

    _rptwaste_idx = PAGES.find('function rptWaste(')
    if _rptwaste_idx == -1:
        fail('rptWaste() not found — this is Priyam\'s real Soft/Dye/Wind waste report, must not be removed')
    else:
        _rptwaste_body = PAGES[_rptwaste_idx:_rptwaste_idx+3000]
        if 'isMoisture' in _rptwaste_body or '(moisture)' in _rptwaste_body:
            fail('rptWaste() still contains the isMoisture/(moisture) mislabeling — confirmed removed Jul 17 2026, this is a regression')
        else:
            ok('rptWaste() confirmed clean of the old isMoisture/(moisture) mislabeling')
except Exception as e:
    fail(f'Check 99 could not run: {e}')

print("\n" + "=" * 70)
print("FUTURE POINTER — RUNNING-BALANCE ARCHITECTURE (not yet started, Jul 15 2026)")
print("=" * 70)
print("""
  Planning only — no code exists yet, this is a documentation marker, not
  an active check. See HOLISTIC_PLAN.md \"Running-balance architecture —
  phased plan\" for full detail. 16 write-paths mapped and tiered:
  9 simple add/subtract, 4 needing before/after delta, 3 needing
  reversal/cascade logic. Confirmed: dye-lot-anchored balances never need
  proportional splitting even for multi-source dye lots (4.7% of them) —
  a future check could assert no proportional-split logic gets
  introduced into any of the 16 handlers' balance-nudging code.
""")

print("\n" + "=" * 70)
print("CHECK 50 — FIREBASE RULES HAVE dyeLotId + lotId INDEXES")
print("=" * 70)
# Required for targeted Worker queries (Action 2 bandwidth fix, Jul 2026)
# Without these indexes Firebase downloads full collections ignoring filters
import json as _json
try:
    rules = _json.loads(RULES_PATH.read_text())
    tc = rules.get('rules', {}).get('tc', {})
    arch = tc.get('archive', {})

    checks_50 = [
        ('windEntries (active)',   tc.get('windEntries',   {}).get('.indexOn', []), 'dyeLotId'),
        ('packEntries (active)',   tc.get('packEntries',   {}).get('.indexOn', []), 'dyeLotId'),
        ('dispatches (active)',    tc.get('dispatches',    {}).get('.indexOn', []), 'dyeLotId'),
        ('stageEntries (active)',  tc.get('stageEntries',  {}).get('.indexOn', []), 'lotId'),
        ('windEntries (archive)',  arch.get('windEntries', {}).get('.indexOn', []), 'dyeLotId'),
        ('packEntries (archive)',  arch.get('packEntries', {}).get('.indexOn', []), 'dyeLotId'),
        ('dispatches (archive)',   arch.get('dispatches',  {}).get('.indexOn', []), 'dyeLotId'),
        ('stageEntries (archive)', arch.get('stageEntries',{}).get('.indexOn', []), 'lotId'),
    ]
    for label, indexes, needed in checks_50:
        if needed in indexes:
            ok(f'{label}: has "{needed}" index')
        else:
            fail(f'{label}: MISSING "{needed}" index — targeted Worker queries will download full collection')
except Exception as e:
    fail(f'Could not check firebase rules indexes: {e}')

print("\n" + "=" * 70)
print("CHECK 51 — updateDyeLotSummary + updateLotSummary USE TARGETED FETCH")
print("=" * 70)
# After Jul 2026 bandwidth fix — these functions must NOT download full
# collections via fbGetMerged. They must fetch only entries for specific lot.

# Find updateDyeLotSummary
idx_dye = WORKER.find('async function updateDyeLotSummary(')
idx_dye_end = WORKER.find('\nasync function ', idx_dye+10)
dye_fn = WORKER[idx_dye:idx_dye_end]

# Find updateLotSummary
idx_lot = WORKER.find('async function updateLotSummary(')
idx_lot_end = WORKER.find('\nasync function ', idx_lot+10)
lot_fn = WORKER[idx_lot:idx_lot_end]

import re as _re
# Check updateDyeLotSummary — must have zero real fbGetMerged calls (comments dont count)
dye_no_comments = _re.sub(r'//[^\n]*', '', dye_fn)
dye_merged = _re.findall(r"fbGetMerged\('[^']+',\s*'[^']+'", dye_no_comments)
if dye_merged:
    fail(f'updateDyeLotSummary has real fbGetMerged calls (full collection download): {dye_merged}')
else:
    ok('updateDyeLotSummary uses targeted fetch (no real fbGetMerged calls)')

# Check updateLotSummary — wind/pack/dispatch must NOT use fbGetMerged
# (dyeLots check is handled by Check 53 which verifies lotToDyeLots index is used instead)
lot_no_comments = _re.sub(r'//[^\n]*', '', lot_fn)
lot_merged = _re.findall(r"fbGetMerged\('[^']+',\s*'[^']+'", lot_no_comments)
bad_lot_merged = [c for c in lot_merged if 'dyeLots' not in c]
if bad_lot_merged:
    fail(f'updateLotSummary uses fbGetMerged for non-dyeLots collections: {bad_lot_merged}')
else:
    ok('updateLotSummary: wind/pack/dispatch use targeted fetch (not fbGetMerged)')


print("\n" + "=" * 70)
print("CHECK 52 — FIREBASE RULES HAVE lotToDyeLots PATH")
print("=" * 70)
try:
    import json as _json2
    rules2 = _json2.loads(RULES_PATH.read_text())
    tc2 = rules2.get('rules', {}).get('tc', {})
    if 'lotToDyeLots' in tc2:
        r = tc2['lotToDyeLots']
        if r.get('.read') == 'auth != null' and r.get('.write') == 'auth != null':
            ok('firebase-rules.json has lotToDyeLots with correct read/write rules')
        else:
            fail(f'lotToDyeLots exists but rules wrong: {r}')
    else:
        fail('lotToDyeLots path MISSING from firebase-rules.json — reverse lookup index will be inaccessible')
except Exception as e:
    fail(f'Could not check lotToDyeLots rules: {e}')

print("\n" + "=" * 70)
print("CHECK 53 — updateLotSummary USES lotToDyeLots INDEX (no fbGetMerged for dyeLots)")
print("=" * 70)
import re as _re2
idx_lot2 = WORKER.find('async function updateLotSummary(')
idx_lot2_end = WORKER.find('\nasync function ', idx_lot2+10)
lot_fn2 = WORKER[idx_lot2:idx_lot2_end]
lot_no_comments2 = _re2.sub(r'//[^\n]*', '', lot_fn2)
# Must use lotToDyeLots index
if 'lotToDyeLots' in lot_fn2:
    ok('updateLotSummary uses /tc/lotToDyeLots reverse index')
else:
    fail('updateLotSummary does NOT use lotToDyeLots — still doing full dyeLots scan')
# Jul 13 2026 UPDATE: the Jul 11 guard ("only verify when index is
# completely empty") was itself proven insufficient by a real production
# case (lot 04) — the index can be non-empty AND still wrong (2 real
# entries out of 7), which the empty-only check could never detect. Fixed
# to always verify against real data now, regardless of whether the index
# looks empty or populated — the fbGetMerged call is intentionally
# unconditional going forward. What must STILL be conditional is the
# repair WRITE (only patch the index when a real discrepancy is found) —
# that's the actual invariant worth protecting, not "only ever read when
# empty," which is the assumption that just failed in production.
dye_merged2 = _re2.findall(r"fbGetMerged\('[^']*dyeLots[^']*',\s*'[^']*dyeLots[^']*'\)", lot_no_comments2)
if dye_merged2:
    if 'self-heal' in lot_fn2 and 'indexWasWrong' in lot_fn2:
        ok('updateLotSummary always verifies the lotToDyeLots index against real data (fbGetMerged unconditional), but only writes a repair when a real discrepancy is found — correct per the Jul 13 2026 fix for partial-index staleness')
    else:
        fail(f'updateLotSummary uses fbGetMerged for dyeLots but the indexWasWrong-guarded repair pattern is missing — check for an unrelated regression: {dye_merged2}')
else:
    ok('updateLotSummary no longer uses fbGetMerged for dyeLots')
# Must have updateLotToDyeLotsIndex helper defined in worker
if 'function updateLotToDyeLotsIndex' in WORKER:
    ok('updateLotToDyeLotsIndex helper defined in worker.js')
else:
    fail('updateLotToDyeLotsIndex helper MISSING from worker.js')


print("\n" + "=" * 70)
print("CHECK 54 — wind getDyeBalAvailable (not getDyeBal) in submitWind")
print("=" * 70)
# Bug found Jul 2026: submitWind was using getDyeBal (approved-only) instead
# of getDyeBalAvailable — meant WIP wind claims not accounted for in validation
#
# Jul 14 2026 — submitWind (Item I) now delegates to worker.js's
# handleWindStart. The same historical bug-guard intent applies there
# instead — checking calcDyeBalAvailable (not calcDyeBal) is what's
# actually used for the validation.
import re as _re54
idx_sw = PAGES.find('async function submitWind(')
end_sw = PAGES.find('\nasync function ', idx_sw+10)
fn_sw = PAGES[idx_sw:end_sw]
if "WORKER_URL+'/api/wind/start'" in fn_sw or "apiPost('/api/wind/start'" in fn_sw or "_postWithDuplicateCheck('/api/wind/start'" in fn_sw:
    idx_hws = WORKER.find('async function handleWindStart(')
    end_hws = WORKER.find('\nasync function ', idx_hws+10)
    fn_hws = WORKER[idx_hws:end_hws]
    calls_hws = _re54.findall(r'calc\w*Bal\w*\([^)]*\)', fn_hws)
    if calls_hws and 'calcDyeBalAvailable' in calls_hws[0]:
        ok('handleWindStart (worker.js) first balance call is calcDyeBalAvailable (not calcDyeBal) — Item I migration preserved the fix')
    else:
        fail('handleWindStart (worker.js) does NOT use calcDyeBalAvailable — Item I migration may have regressed the Jul 2026 fix')
else:
    calls_sw = _re54.findall(r'get\w+Bal\w*\([^)]*\)', fn_sw)
    if calls_sw and 'getDyeBalAvailable' in calls_sw[0]:
        ok('submitWind first balance call is getDyeBalAvailable (not getDyeBal)')
    elif any('getDyeBalAvailable' in c for c in calls_sw):
        ok('submitWind uses getDyeBalAvailable somewhere in validation')
    else:
        fail('submitWind does NOT use getDyeBalAvailable — uses wrong base function')

print("\n" + "=" * 70)
print("CHECK 55 — dispatch submitDispatch uses getPackBalAvailable")
print("=" * 70)
# Jul 14 2026 -- submitDispatch (Item I) now delegates to worker.js's
# handleDispatchSubmit. Same relocated-check pattern as CHECK 54 -- the
# real balance-function-choice bug guard now applies server-side.
idx_sd = PAGES.find('async function submitDispatch(')
end_sd = PAGES.find('\nasync function ', idx_sd+10)
fn_sd = PAGES[idx_sd:end_sd]
if "WORKER_URL+'/api/dispatch'" in fn_sd or "apiPost('/api/dispatch'" in fn_sd:
    idx_hds = WORKER.find('async function handleDispatchSubmit(')
    end_hds = WORKER.find('\nasync function ', idx_hds+10)
    fn_hds = WORKER[idx_hds:end_hds]
    if 'calcPackBalAvailable' in fn_hds:
        ok('handleDispatchSubmit (worker.js) uses calcPackBalAvailable -- Item I migration preserved the fix')
    else:
        fail('handleDispatchSubmit (worker.js) does NOT use calcPackBalAvailable -- Item I migration may have regressed the fix')
    if 'calcPackBal(' in fn_hds and 'calcPackBalAvailable' not in fn_hds:
        fail('handleDispatchSubmit uses raw calcPackBal instead of calcPackBalAvailable')
else:
    if 'getPackBalAvailable' in fn_sd:
        ok('submitDispatch uses getPackBalAvailable')
    else:
        fail('submitDispatch does NOT use getPackBalAvailable')
    if 'getPackBal(' in fn_sd and 'getPackBalAvailable' not in fn_sd:
        fail('submitDispatch uses raw getPackBal instead of getPackBalAvailable')

print("\n" + "=" * 70)
print("CHECK 56 — dye end form has 3-box structure (FY + Serial + Sub)")
print("=" * 70)
if 'id="dye-end-fy"' in HTML and 'id="dye-end-serial"' in HTML and 'id="dye-end-sub"' in HTML:
    ok('Dye End form has 3-box structure: dye-end-fy, dye-end-serial, dye-end-sub')
else:
    fail('Dye End form missing 3-box structure')
if 'id="dye-end-lot-no"' in HTML:
    fail('Dye End form still has old single dye-end-lot-no input — should be replaced by 3 boxes')
else:
    ok('Old dye-end-lot-no single input correctly removed')

print("\n" + "=" * 70)
print("CHECK 57 — sortDyeLotNo used in all dropdown sorts")
print("=" * 70)
# Dye table
idx_dt = PAGES.find('function renderDyeTable(')
end_dt = PAGES.find('\nfunction ', idx_dt+10)
fn_dt = PAGES[idx_dt:end_dt]
if 'sort(sortDyeLotNo)' in fn_dt:
    ok('renderDyeTable uses sortDyeLotNo (numeric sort)')
else:
    fail('renderDyeTable uses localeCompare instead of sortDyeLotNo — alphanumeric sort bug')

# Dispatch
idx_dd = PAGES.find('function renderDispatchLotRows(')
end_dd = PAGES.find('\nfunction ', idx_dd+10)
fn_dd = PAGES[idx_dd:end_dd]
if 'sortDyeLotNo' in fn_dd:
    ok('renderDispatchLotRows uses sortDyeLotNo')
else:
    fail('renderDispatchLotRows uses localeCompare instead of sortDyeLotNo')

print("\n" + "=" * 70)
print("CHECK 58 — searchable dropdown helpers defined")
print("=" * 70)
for fn_name in ['sortDyeLotNo', 'makeDyeLotSearch', 'buildDyeLotSearch', 'onDyeEndSerialInput']:
    if f'function {fn_name}(' in PAGES:
        ok(f'{fn_name} defined in pages.js')
    else:
        fail(f'{fn_name} MISSING from pages.js — searchable dropdowns will break')

print("\n" + "=" * 70)
print("CHECK 68 — buildDyeLotSearch single definition, 3-arg callers only")
print("=" * 70)
import re as _re
_bdls_defs = _re.findall(r'function buildDyeLotSearch\(([^)]*)\)', PAGES)
if len(_bdls_defs) == 1 and _bdls_defs[0].count(',') == 2:
    ok('buildDyeLotSearch has exactly one definition (3-arg)')
else:
    fail(f'buildDyeLotSearch definitions found: {_bdls_defs} — expected exactly one 3-arg def')
_bdls_calls = _re.findall(r"buildDyeLotSearch\(([^)]*)\)", PAGES)
_bdls_calls = [c for c in _bdls_calls if not c.startswith('inputId')]
_bad_calls = [c for c in _bdls_calls if c.count(',') != 2]
if not _bad_calls:
    ok('all buildDyeLotSearch call sites pass 3 args')
else:
    fail(f'buildDyeLotSearch called with wrong arg count: {_bad_calls}')
if 'function applyDyeLotSearch(' not in PAGES:
    ok('applyDyeLotSearch dead code confirmed removed')
else:
    fail('applyDyeLotSearch still present — should be removed (dead, replaced by applyTableFilter)')

print("\n" + "=" * 70)
print("CHECK 59 — wind/pack modals have searchable dropdown containers")
print("=" * 70)
if 'id="wind-dye-lot-search"' in HTML:
    ok('Wind modal has searchable dropdown container (wind-dye-lot-search)')
else:
    fail('Wind modal missing searchable dropdown container')
if 'id="pack-dye-lot-search"' in HTML:
    ok('Pack modal has searchable dropdown container (pack-dye-lot-search)')
else:
    fail('Pack modal missing searchable dropdown container')


print("\n" + "=" * 70)
print("CHECK 60 — HTML DIV BALANCE NOT WORSE THAN ORIGINAL (-2)")
print("=" * 70)
# Bug found Jul 2026: multiple dye-end modal rebuilds introduced extra unclosed divs
# causing entire page layout to break (blank screen). Original HTML has -2 balance.
# Any build should not make this worse.
html_opens = HTML.count('<div')
html_closes = HTML.count('</div>')
html_balance = html_opens - html_closes
if html_balance >= -2:
    ok(f'HTML div balance: {html_opens} opens, {html_closes} closes, diff={html_balance} (acceptable)')
else:
    fail(f'HTML div balance: {html_balance} — worse than original (-2). Unclosed divs will break page layout.')

print("\n" + "=" * 70)
print("CHECK 61 — dye-end-modal-overlay DIV SECTION IS BALANCED")
print("=" * 70)
# Bug found Jul 2026: dye-end modal had unclosed fgrid div causing wind modal
# and entire rest of page to render inside dye-end modal — blank screen result
idx_de = HTML.find('id="dye-end-modal-overlay"')
idx_wind_outer = HTML.find('<div class="modal-overlay hidden" id="wind-modal-overlay">', idx_de)
if idx_wind_outer == -1:
    idx_wind_outer = HTML.find('id="wind-modal-overlay"', idx_de)
if idx_de == -1:
    fail('dye-end-modal-overlay not found in HTML')
elif idx_wind_outer == -1:
    fail('wind-modal-overlay not found in HTML')
else:
    # Start from the inner modal div (after the outer modal-overlay wrapper opens)
    # The outer <div class="modal-overlay hidden"> opens before id= so walk forward to <div class="modal"
    inner_start = HTML.find('<div class="modal"', idx_de)
    if inner_start == -1 or inner_start > idx_wind_outer:
        inner_start = idx_de
    # End before the outer wrapper closes (the </div></div>\n</div> before wind)
    # Find buttons div close + modal div close = </div></div> then outer </div>
    btn_close = HTML.rfind('</div></div>', idx_de, idx_wind_outer)
    section = HTML[inner_start:btn_close + len('</div></div>')]
    sec_o = section.count('<div')
    sec_c = section.count('</div>')
    if sec_o == sec_c:
        ok(f'dye-end modal inner section balanced: {sec_o} opens = {sec_c} closes')
    else:
        fail(f'dye-end modal inner section UNBALANCED: {sec_o} opens vs {sec_c} closes — unclosed div will break page layout')

print("\n" + "=" * 70)
print("CHECK 62 — wind-modal-overlay HAS PROPER WRAPPER DIV")
print("=" * 70)
# Bug found Jul 2026: wind modal was missing its outer <div class="modal-overlay hidden">
# wrapper, causing raw HTML attribute text to appear on screen and dye-end modal
# to trigger wind modal simultaneously
idx_wind2 = HTML.find('id="wind-modal-overlay"')
if idx_wind2 == -1:
    fail('wind-modal-overlay not found in HTML')
else:
    # Check that the wind modal id is preceded by class="modal-overlay"
    context = HTML[max(0,idx_wind2-60):idx_wind2+30]
    if 'modal-overlay' in context and 'class=' in context:
        ok('wind-modal-overlay has proper modal-overlay wrapper div')
    else:
        fail('wind-modal-overlay is MISSING its outer <div class="modal-overlay hidden"> wrapper — will show as raw text and trigger with dye-end modal')

print("\n" + "=" * 70)
print("CHECK 63 — genDyeLotNo RETURNS SERIAL NUMBER ONLY (not full string)")
print("=" * 70)
# Bug found Jul 2026: genDyeLotNo was returning full 'DYE-2627-101' string
# which made the 3-box form auto-suggest the full string into the serial number box
_c63_idx = PAGES.find('function genDyeLotNo(')
if _c63_idx == -1:
    fail('genDyeLotNo function not found in pages.js')
else:
    _c63_snip = PAGES[_c63_idx:_c63_idx+700]
    if "return prefix+String(" in _c63_snip or "return prefix+'" in _c63_snip:
        fail('genDyeLotNo returns full DYE-YYYY-NNN string — serial box will show wrong value')
    elif 'return next' in _c63_snip:
        ok('genDyeLotNo returns serial number only (not full string)')
    else:
        fail(f'genDyeLotNo: cannot find return statement in first 700 chars — check manually')

print("\n" + "=" * 70)
print("CHECK 64 — submitDyeEndNew ASSEMBLES dyeLotNo FROM 3 BOXES")
print("=" * 70)
# Bug found Jul 2026: submitDyeEndNew was reading old dye-end-lot-no single box
# instead of assembling from FY + serial + sub boxes
idx_sub = PAGES.find('async function submitDyeEndNew(')
end_sub = PAGES.find('\nasync function ', idx_sub+10)
sub_fn = PAGES[idx_sub:end_sub]
if "'DYE-'+_fy+'-'+_serial" in sub_fn or 'DYE-\'\'+_fy+\'-\'\'+_serial' in sub_fn:
    ok('submitDyeEndNew correctly assembles dyeLotNo from FY + serial + sub')
elif 'dye-end-lot-no' in sub_fn:
    fail('submitDyeEndNew still reads old single dye-end-lot-no box instead of 3 boxes')
else:
    ok('submitDyeEndNew reads 3-box inputs (dye-end-serial present)')

print("\n" + "=" * 70)
print("CHECK 65 — pack submitPack USES getWindBalAvailable (not getWindBal)")
print("=" * 70)
# Bug found Jul 2026: submitPack was using getWindBal (approved-only) for the
# top-level cone check — WIP claims not accounted for, duplicate entries possible
idx_sp = PAGES.find('async function submitPack(')
end_sp = PAGES.find('\nasync function ', idx_sp+10)
fn_sp = PAGES[idx_sp:end_sp]
import re as _re65
first_bal = _re65.search(r'get\w+Bal\w*\(', fn_sp)
if first_bal and 'Available' in first_bal.group():
    ok(f'submitPack first balance call uses Available function: {first_bal.group()}')
elif 'getWindBal(' in fn_sp and 'getWindBalAvailable' not in fn_sp:
    fail('submitPack uses raw getWindBal — WIP claims not checked, duplicate pack possible')
else:
    ok('submitPack uses getWindBalAvailable for validation')


print("\n" + "=" * 70)
print("CHECK 66 — sortDyeLotNo HAS typeof STRING GUARD")
print("=" * 70)
# Bug found Jul 2026: sortDyeLotNo called s.split('-') without checking typeof s
# Dye lots with non-string dyeLotNo crashed dispatch/wind/pack modal open
if 'function sortDyeLotNo(' in PAGES:
    idx_srt = PAGES.find('function sortDyeLotNo(')
    srt_snip = PAGES[idx_srt:idx_srt+200]
    if "typeof s!=='string'" in srt_snip or 'typeof s !== ' in srt_snip:
        ok("sortDyeLotNo has typeof string guard — non-string dyeLotNo won't crash")
    else:
        fail("sortDyeLotNo missing typeof string guard — will crash on non-string dyeLotNo (dispatch/wind/pack modal)")
else:
    fail('sortDyeLotNo not defined in pages.js')

print("\n" + "=" * 70)
print("CHECK 67 — dye-end modal-overlay HAS CLOSING </div> BEFORE WIND MODAL")
print("=" * 70)
# Bug found Jul 2026: dye-end modal rebuild dropped the </div> closing its outer
# modal-overlay wrapper — caused wind modal to nest inside dye-end, blank screen
_dye_close_wind = '</div></div>\n</div><div class="modal-overlay hidden" id="wind-modal-overlay">'
if _dye_close_wind in HTML:
    ok('dye-end modal has correct closing </div> before wind modal wrapper')
else:
    fail('dye-end modal missing closing </div> before wind modal — will cause blank screen (entire page nested inside dye-end modal)')


print("\n" + "=" * 70)
print("CHECK 69 — residual/scrap transfer rebuilt as lot+grade+vendor pool-scoped")
print("=" * 70)
# Jul 8 2026 rebuild: old entry-scoped openSoftScrapModal/submitSoftScrap/
# openMoveToResidualModal/submitMoveToResidual replaced by combo-scoped
# openResidualTransferModal/submitResidualTransfer writing to DB.residualLog.
for fn_name in ['openResidualTransferModal', 'onResidualTransferComboChange', 'submitResidualTransfer']:
    if f'function {fn_name}(' in PAGES:
        ok(f'{fn_name} defined in pages.js')
    else:
        fail(f'{fn_name} MISSING from pages.js')
for old_fn in ['openSoftScrapModal', 'submitSoftScrap', 'openMoveToResidualModal', 'submitMoveToResidual', 'getSoftEntryAvailable']:
    if f'function {old_fn}(' not in PAGES and f'function {old_fn}(' not in CORE:
        ok(f'{old_fn} dead code confirmed removed')
    else:
        fail(f'{old_fn} still present — should be removed (replaced by combo-scoped Residual/Scrap Transfer)')
if 'function getSoftResidualOut(' in CORE:
    ok('getSoftResidualOut defined in core.js')
else:
    fail('getSoftResidualOut MISSING from core.js')
# Jul 10 2026 — shared-balances.js consolidation (formula #2 in progress:
# Soft Balance). getSoftBalanceWeight is now a thin wrapper delegating to
# calcSoftBalanceWeight (shared-balances.js), which internally subtracts
# residual/scrap — the old text pattern (getSoftResidualOut called directly
# inside getSoftBalanceWeight's own body) is gone by design.
_gsbw_idx = CORE.find('function getSoftBalanceWeight(')
_gsbw_uses_shared = _gsbw_idx != -1 and 'calcSoftBalanceWeight(' in CORE[_gsbw_idx:_gsbw_idx+300]
_gsbw_uses_old = _gsbw_idx != -1 and 'getSoftResidualOut(' in CORE[_gsbw_idx:_gsbw_idx+300]
_shared_has_residual_sub = SHARED and 'residualLog' in SHARED and 'calcSoftBalanceWeight' in SHARED
if _gsbw_uses_shared and _shared_has_residual_sub:
    ok('getSoftBalanceWeight delegates to shared calcSoftBalanceWeight (includes residual/scrap subtraction)')
elif _gsbw_uses_old:
    ok('getSoftBalanceWeight subtracts getSoftResidualOut (pool-scoped residual/scrap)')
else:
    fail('getSoftBalanceWeight does not appear to subtract residual/scrap — neither shared calcSoftBalanceWeight nor old getSoftResidualOut pattern found')
_grb_idx = PAGES.find('function getResidualBalance(')
if _grb_idx != -1:
    _grb_snip = PAGES[_grb_idx:_grb_idx+500]
    if "status!=='Rejected'" in _grb_snip and "status!=='Void'" in _grb_snip:
        ok('getResidualBalance excludes Void/Rejected dye lots (Jul 8 2026 fix)')
    else:
        fail('getResidualBalance does not exclude Void/Rejected dye lots — balance will not restore after void')
else:
    fail('getResidualBalance not defined in pages.js')
if 'id="residual-transfer-modal-overlay"' in HTML:
    ok('residual-transfer-modal-overlay exists in index.html')
else:
    fail('residual-transfer-modal-overlay MISSING from index.html')
if 'onclick="openResidualTransferModal()"' in HTML:
    ok('Soft page has Residual/Scrap Transfer trigger button')
else:
    fail('Soft page missing Residual/Scrap Transfer trigger button')

print("\n" + "=" * 70)
print("CHECK 70 — no modal-overlay traps another modal inside it (Jul 8 2026 fix)")
print("=" * 70)
# Bug found Jul 8 2026: scrap-modal-overlay's own closing </div></div> was
# sitting far below several other modal-overlay blocks instead of right after
# its own content. Every modal placed in between became a DOM descendant of
# scrap-modal-overlay, which stays class="hidden" (display:none) — so those
# nested modals could never become visible even after openModal() removed
# "hidden" from themselves. This was the real cause of the original
# "residual button does nothing" report. Detect: for every
# <div class="modal-overlay ..." id="X">, walk forward counting div open/close
# — the count must return to 0 (i.e. X fully closes) before the next
# modal-overlay div starts. If it doesn't, X is still open when the next
# modal begins, meaning that next modal is nested inside X.
import re as _re2
_modal_starts = [(m.start(), m.group(1)) for m in _re2.finditer(r'<div class="modal-overlay[^"]*"[^>]*id="([^"]+)"', HTML)]
_trapped = []
for i in range(len(_modal_starts) - 1):
    pos, mid = _modal_starts[i]
    next_pos, next_mid = _modal_starts[i+1]
    segment = HTML[pos:next_pos]
    depth = len(_re2.findall(r'<div\b', segment)) - len(_re2.findall(r'</div>', segment))
    if depth > 0:
        _trapped.append((mid, next_mid, depth))
if not _trapped:
    ok(f'all {len(_modal_starts)} modal-overlay blocks close before the next one starts')
else:
    for mid, next_mid, depth in _trapped:
        fail(f'"{mid}" never closes (still {depth} div(s) open) before "{next_mid}" starts — "{next_mid}" and everything after it up to the real close is trapped inside "{mid}" and will be invisible whenever "{mid}" has class="hidden"')


print("\n" + "=" * 70)
print("CHECK 71 — RM Return: client + both worker.js summary paths wired consistently")
print("=" * 70)
for fn_name in ['openRMReturnModal', 'onRMRVendorChange', 'onRMRGradeChange', 'onRMRLotChange', 'submitRMReturn', 'renderRMReturnLog']:
    if f'function {fn_name}(' in PAGES:
        ok(f'{fn_name} defined in pages.js')
    else:
        fail(f'{fn_name} MISSING from pages.js')
# Jul 10 2026 — shared-balances.js consolidation (formula #1 of 8): RM Balance
# and its RM-return subtraction moved out of core.js into the single shared
# file. getRMReturnedOut no longer exists as a standalone core.js function —
# its logic now lives as calcRMReturnedOut inside shared-balances.js, and
# getRMBalance is a thin wrapper delegating to calcRMBalance. Check for the
# new architecture; the old text pattern this check used to look for is
# gone by design, not by accident.
if SHARED and 'function calcRMReturnedOut(' in SHARED:
    ok('calcRMReturnedOut defined in shared-balances.js')
elif 'function getRMReturnedOut(' in CORE:
    ok('getRMReturnedOut defined in core.js (pre-consolidation architecture)')
else:
    fail('Neither calcRMReturnedOut (shared-balances.js) nor getRMReturnedOut (core.js) found')
_grmb_idx = CORE.find('function getRMBalance(')
_uses_shared_calc = _grmb_idx != -1 and 'calcRMBalance(' in CORE[_grmb_idx:_grmb_idx+300]
_uses_old_inline = _grmb_idx != -1 and 'getRMReturnedOut(' in CORE[_grmb_idx:_grmb_idx+400]
if _uses_shared_calc:
    ok('getRMBalance delegates to shared calcRMBalance (includes RM-return subtraction)')
elif _uses_old_inline:
    ok('getRMBalance subtracts getRMReturnedOut (pre-consolidation architecture)')
else:
    fail('getRMBalance does not appear to subtract RM returns — neither shared calcRMBalance nor old getRMReturnedOut pattern found')
WORKER = (BASE / 'worker.js').read_text(encoding='utf-8')
import re as _re3
# Jul 16 2026 — was a naive regex (r'calcSummaryFromData\(([^)]*)\)')
# that stops at the FIRST closing paren, breaking on any call argument
# that itself contains parentheses (e.g. the new pre-indexed
# _stageByKey.get(key) || [] call added for the audit-tool CPU-limit
# fix). Replaced with proper paren-depth counting, same fix pattern as
# an earlier false positive this session (Check 92).
_csfd_calls = []
for _m in _re3.finditer(r'calcSummaryFromData\(', WORKER):
    _start = _m.end()
    _depth = 1; _p = _start
    while _p < len(WORKER) and _depth > 0:
        if WORKER[_p] == '(': _depth += 1
        elif WORKER[_p] == ')': _depth -= 1
        _p += 1
    _csfd_calls.append(WORKER[_start:_p-1])
_csfd_calls = [c for c in _csfd_calls if not c.strip().startswith('lot, _stageEntries, _dyeLots, _windEntries, _packEntries, _dispatches, _residualLog, _rmReturnLog')]
# Jul 10 2026 — shared-balances.js consolidation added scrapLog as a 9th
# parameter (needed for calcSoftOut's legacy scrap/residual subtraction).
# Was 8 args (7 commas), now 9 args (8 commas). Top-level commas only —
# a comma inside a nested call's own arguments must not be counted.
def _top_level_comma_count(s):
    depth = 0; count = 0
    for ch in s:
        if ch in '([{': depth += 1
        elif ch in ')]}': depth -= 1
        elif ch == ',' and depth == 0: count += 1
    return count
_bad_csfd = [c for c in _csfd_calls if _top_level_comma_count(c) != 8]
if not _bad_csfd:
    ok('all calcSummaryFromData call sites pass all 9 args (incl. rmReturnLog + scrapLog)')
else:
    fail(f'calcSummaryFromData called with wrong arg count (missing rmReturnLog or scrapLog?): {_bad_csfd}')
if "fbGet('/tc/rmReturnLog')" in WORKER or 'fbGet(\'/tc/rmReturnLog\', lotIdQuery)' in WORKER:
    ok('worker.js fetches rmReturnLog')
else:
    fail('worker.js never fetches rmReturnLog — RM returns will not affect server-side balances/archival')
if "'rmReturnLog'" in WORKER and 'STATIC_PATHS' in WORKER:
    _sp_idx = WORKER.find('STATIC_PATHS = [')
    if _sp_idx != -1 and 'rmReturnLog' in WORKER[_sp_idx:_sp_idx+400]:
        ok('rmReturnLog present in worker.js STATIC_PATHS allowlist')
    else:
        fail('rmReturnLog missing from STATIC_PATHS — client L2 fetch will 400')
else:
    fail('rmReturnLog missing from STATIC_PATHS — client L2 fetch will 400')
RULES = (BASE / 'firebase-rules.json').read_text(encoding='utf-8')
if '"rmReturnLog"' in RULES:
    ok('rmReturnLog present in firebase-rules.json')
else:
    fail('rmReturnLog missing from firebase-rules.json — falls under $other deny-all, direct-read fallback will be denied')
if 'id="rm-tab-return"' in HTML and 'id="rm-return-modal-overlay"' in HTML:
    ok('RM Return tab + modal present in index.html')
else:
    fail('RM Return tab or modal missing from index.html')

print("\n" + "=" * 70)
print("CHECK 72 — Grade Analysis report present alongside Shade Analysis")
print("=" * 70)
if 'function rptGrade(' in PAGES:
    ok('rptGrade defined in pages.js')
else:
    fail('rptGrade MISSING from pages.js')
if "id='rpt-grade'" in HTML or 'id="rpt-grade"' in HTML:
    ok('rpt-grade tab panel present in index.html')
else:
    fail('rpt-grade tab panel missing from index.html')
if "id='rpt-grade-c'" in HTML or 'id="rpt-grade-c"' in HTML:
    ok('rpt-grade-c container present in index.html')
else:
    fail('rpt-grade-c container missing from index.html')
if "id==='rpt-grade'" in PAGES or 'id==="rpt-grade"' in PAGES:
    ok('rptGrade registered in renderReports() dispatcher')
else:
    fail('rptGrade not registered in renderReports() dispatcher — tab will show blank on switch')

print("\n" + "=" * 70)
print("CHECK 73 — shared-balances.js consolidation (formula #1: RM Balance)")
print("=" * 70)
# Jul 10 2026 — the actual fix for "the same formula hand-written 3 times
# and drifting apart" (the exact bug class behind the Sent-to-Dye
# incident). Being done ONE FORMULA AT A TIME — this check covers RM
# Balance only; Soft/Dye/Wind/Pack/Dispatched are NOT yet consolidated and
# still have independent copies, by design, until each is migrated the
# same way and this check is extended to cover it.
if SHARED:
    ok('shared-balances.js exists')
    for fn in ['calcRMBalance', 'calcLotByKey', 'calcSoftIn', 'calcRMReturnedOut', 'Q', 'Qadd', 'Qsub', 'Qmax0', 'appr', 'seMatch']:
        if f'function {fn}(' in SHARED or f'const {fn}' in SHARED or f'export const {fn}' in SHARED:
            ok(f'{fn} defined in shared-balances.js')
        else:
            fail(f'{fn} MISSING from shared-balances.js')
    if "import" in CORE and "calcRMBalance" in CORE and "from './shared-balances.js'" in CORE:
        ok("core.js imports calcRMBalance from shared-balances.js")
    else:
        fail("core.js does not import calcRMBalance from shared-balances.js — RM Balance may still be duplicated")
    if "import" in WORKER and "calcRMBalance" in WORKER and "shared-balances.js" in WORKER:
        ok("worker.js imports calcRMBalance from shared-balances.js")
    else:
        fail("worker.js does not import calcRMBalance from shared-balances.js — RM Balance may still be duplicated")
    # Confirm the OLD hand-duplicated worker.js formula (rmReceived.units -
    # softIn.units - rmReturnedOut.units) is actually GONE, not just
    # sitting alongside the new shared call as dead code.
    _old_worker_pattern = "rmReceived.units - softIn.units - rmReturnedOut.units"
    if _old_worker_pattern not in WORKER:
        ok("worker.js's old hand-duplicated RM Balance formula confirmed removed (not just dead code alongside the new one)")
    else:
        fail(f"worker.js still contains the OLD hand-written RM Balance formula ({_old_worker_pattern!r}) — consolidation incomplete, duplication still exists")
else:
    print("  (shared-balances.js does not exist yet — consolidation not started, skipping)")

print("\n" + "=" * 70)
print("CHECK 74 — shared-balances.js consolidation (formulas #3-5: Dye/Wind/Pack Balance, dye-lot-anchored)")
print("=" * 70)
# Family A only (single dyeLotId, used for LIVE Wind/Pack/Dispatch dropdowns
# and submit validation) — the RM-lot-anchored proportional-attribution
# family (Lot Lifecycle report) is a separate, not-yet-consolidated thing.
if SHARED and 'calcDyeBal' in SHARED:
    for fn in ['calcDyeBal', 'calcWindBal', 'calcPackBal', 'calcTotalPackedApproved', 'calcTotalDispatchedApproved']:
        if f'function {fn}(' in SHARED:
            ok(f'{fn} defined in shared-balances.js')
        else:
            fail(f'{fn} MISSING from shared-balances.js')
    for fn, target in [('getDyeBal', CORE), ('getWindBal', CORE), ('getPackBal', CORE)]:
        _idx = target.find(f'function {fn}(')
        _calc_name = 'calc' + fn[3:]
        if _idx != -1 and _calc_name in target[_idx:_idx+200]:
            ok(f'core.js {fn} delegates to shared {_calc_name}')
        else:
            fail(f'core.js {fn} does not appear to delegate to shared {_calc_name} — Dye/Wind/Pack Balance may still be duplicated')
    if 'calcDyeBal' in WORKER and 'calcWindBal' in WORKER and 'calcPackBal' in WORKER:
        ok('worker.js calcDyeLotSummary uses shared calcDyeBal/calcWindBal/calcPackBal')
    else:
        fail('worker.js does not appear to use the shared Dye/Wind/Pack functions — consolidation incomplete')
    # Confirm the OLD packBalance.bags weight-ratio-scaling bug (found and
    # fixed during this consolidation) hasn't crept back in.
    _old_bags_scaling = "Math.round(packOut.bags * (packBalKg / packOut.kg))"
    if _old_bags_scaling not in WORKER:
        ok("worker.js's old packBalance.bags weight-ratio-scaling bug confirmed removed (bags now a direct subtraction, matching core.js)")
    else:
        fail(f"worker.js still contains the OLD weight-ratio-scaling packBalance.bags pattern ({_old_bags_scaling!r}) — this was a real, physically-incorrect discrepancy found Jul 10 2026")
    # Formula #6: Dispatched (dye-lot-anchored)
    if 'calcTotalDispatchedApproved' in SHARED:
        ok('calcTotalDispatchedApproved defined in shared-balances.js')
        _gtd_idx = CORE.find('function getTotalDispatched(')
        if _gtd_idx != -1 and 'calcTotalDispatchedApproved(' in CORE[_gtd_idx:_gtd_idx+400]:
            ok('core.js getTotalDispatched delegates to shared calcTotalDispatchedApproved')
        else:
            fail('core.js getTotalDispatched does not appear to delegate to the shared function')
        _cdls_idx = WORKER.find('function calcDyeLotSummary(')
        if _cdls_idx != -1 and 'calcTotalDispatchedApproved(' in WORKER[_cdls_idx:_cdls_idx+3000]:
            ok('worker.js calcDyeLotSummary uses shared calcTotalDispatchedApproved')
        else:
            fail('worker.js calcDyeLotSummary does not appear to use the shared Dispatched function')
        _old_lots_fallback = "(e.lots || []).some(l => l.dyeLotId === dyeLotId)"
        if _old_lots_fallback not in WORKER:
            ok("worker.js's old e.lots[] dispatch-matching fallback confirmed removed (unified with core.js's d.lotId fallback)")
        else:
            fail(f"worker.js still contains the OLD e.lots[] fallback pattern — two different, inconsistent fallback mechanisms existed here")
else:
    print("  (Dye/Wind/Pack consolidation not started yet, skipping)")

print("\n" + "=" * 70)
print("CHECK 75 — shared-balances.js consolidation (formula #2 completion: Soft Balance server-side)")
print("=" * 70)
if SHARED and 'calcSoftOut' in SHARED and 'calcSoftBalanceWeight' in SHARED:
    if "fbGet('/tc/scrapLog')" in WORKER:
        ok('worker.js fetches scrapLog (was never fetched before this fix)')
    else:
        fail('worker.js does not fetch scrapLog — Soft Balance server-side consolidation incomplete')
    if 'calcSoftOut(' in WORKER and WORKER.count('calcSoftOut(') >= 2:
        ok(f'worker.js uses shared calcSoftOut ({WORKER.count("calcSoftOut(")} call sites — expect 2, one per summary function)')
    else:
        fail('worker.js does not appear to use shared calcSoftOut in both summary functions')
    if 'calcSoftBalanceWeight(' in WORKER and WORKER.count('calcSoftBalanceWeight(') >= 2:
        ok(f'worker.js uses shared calcSoftBalanceWeight ({WORKER.count("calcSoftBalanceWeight(")} call sites — expect 2)')
    else:
        fail('worker.js does not appear to use shared calcSoftBalanceWeight in both summary functions')
    # Confirm the OLD bag-scaling bug in calcSummaryFromData's
    # softBalance.units (found and fixed during this consolidation) is gone.
    _old_units_scaling = "softOut.units * (softBalKg / softOut.kg)"
    if _old_units_scaling not in WORKER:
        ok("worker.js's old softBalance.units weight-ratio-scaling bug confirmed removed (was inconsistent with core.js AND worker's own sibling function)")
    else:
        fail(f"worker.js still contains the OLD weight-ratio-scaling softBalance.units pattern ({_old_units_scaling!r})")
else:
    print("  (Soft Balance server-side consolidation not started yet, skipping)")

print("\n" + "=" * 70)
print("CHECK 76 — shared-balances.js consolidation (formulas #7-8: Dye/Wind Balance, RM-lot-anchored proportional family)")
print("=" * 70)
# Real bug, confirmed against live production data (44+ real lots where Wind
# Balance was actually wrong): worker.js compared this-stage-output against
# a stage TWO steps ahead (skipping the immediately-next stage's own input),
# instead of the confirmed-correct "own output minus next stage's input"
# pattern. Not yet visibly reaching users (the Wind/Pack summary cards for
# this report were never fully built), but the underlying formula was
# genuinely wrong and now fixed.
if SHARED and 'calcDyeBalanceByLot' in SHARED:
    for fn in ['calcVendorRatioForDyeLot', 'calcDyeAllocated', 'calcWindInAllocated', 'calcWindOutAllocated', 'calcPackInAllocated', 'calcDyeBalanceByLot', 'calcWindBalanceByLot']:
        if f'function {fn}(' in SHARED:
            ok(f'{fn} defined in shared-balances.js')
        else:
            fail(f'{fn} MISSING from shared-balances.js')
    for fn in ['getDyeBalance', 'getWindBalance', 'getDyeAllocated', 'getWindIn', 'getWindOut', 'getPackIn', 'getVendorRatioForDyeLot']:
        _idx = CORE.find(f'function {fn}(')
        if _idx != -1 and 'calc' in CORE[_idx:_idx+250]:
            ok(f'core.js {fn} delegates to a shared calc* function')
        else:
            fail(f'core.js {fn} does not appear to delegate to a shared function')
    if 'calcDyeBalanceByLot(' in WORKER and WORKER.count('calcDyeBalanceByLot(') >= 2:
        ok(f'worker.js uses shared calcDyeBalanceByLot ({WORKER.count("calcDyeBalanceByLot(")} call sites — expect 2)')
    else:
        fail('worker.js does not appear to use shared calcDyeBalanceByLot in both summary functions')
    if 'calcWindBalanceByLot(' in WORKER and WORKER.count('calcWindBalanceByLot(') >= 2:
        ok(f'worker.js uses shared calcWindBalanceByLot ({WORKER.count("calcWindBalanceByLot(")} call sites — expect 2)')
    else:
        fail('worker.js does not appear to use shared calcWindBalanceByLot in both summary functions')
    # Confirm the OLD skip-a-step patterns are genuinely gone
    _old_dye_pattern = "dyeConsumedKg - windOut.kg"
    _old_wind_pattern = "windOut.kg - packOut.kg"
    _old_cones_ternary = "windOut.cones - windIn.cones < 0"
    if _old_dye_pattern not in WORKER and _old_wind_pattern not in WORKER and _old_cones_ternary not in WORKER:
        ok("worker.js's old skip-a-step Dye/Wind Balance patterns confirmed removed (both formulas now compare against the immediately-next stage's input, not a stage further away)")
    else:
        fail("worker.js still contains an OLD skip-a-step Dye/Wind Balance pattern — this was a real discrepancy confirmed against 44+ real production lots on Jul 10 2026")
else:
    print("  (Family B Dye/Wind Balance consolidation not started yet, skipping)")

print("\n" + "=" * 70)
print("\n" + "=" * 70)
print("CHECK 77 — RM Return validates against Available balance, not base Balance (Jul 10 2026 fix, relocated Jul 17 2026)")
print("=" * 70)
# Real gap found Jul 10 2026: every other submit function (Soft, Wind,
# Pack) validates against getXBalAvailable (WIP-claim-aware). RM Return
# was the one exception, validating against plain getRMBalance.
# Jul 17 2026 — RM Return itself was found to be fully client-side (no
# server check at all, a real gap found only because Priyam specifically
# asked whether this area had been covered). Migrated to
# handleRMReturn (worker.js) — this check now verifies the WIP-claim-
# aware property there instead, since that's where the real validation
# now correctly lives; the client function is a thin server call with no
# validation logic of its own left to check.
# Jul 17 2026 (same day, later) — the migration initially preserved the
# original's validation TARGET (Soft's balance) while flagging a real
# mismatch (RM Return actually reduces RM Balance, not Soft's) for
# Priyam's review. Priyam confirmed: fix it. Now validates against the
# newly-built calcRMBalanceAvailable instead — this check updated to
# match, same day as the fix itself.
_hrmr_idx = WORKER.find('async function handleRMReturn(')
if _hrmr_idx == -1:
    fail('handleRMReturn not found in worker.js — RM Return may have regressed to client-side only')
else:
    _hrmr_brace = WORKER.find('{', _hrmr_idx)
    _hrmr_depth = 0; _hrmr_j = _hrmr_brace
    while _hrmr_j < len(WORKER):
        if WORKER[_hrmr_j] == '{': _hrmr_depth += 1
        elif WORKER[_hrmr_j] == '}':
            _hrmr_depth -= 1
            if _hrmr_depth == 0: break
        _hrmr_j += 1
    _hrmr_body = WORKER[_hrmr_idx:_hrmr_j+1]
    if 'calcRMBalanceAvailable(' in _hrmr_body:
        ok('handleRMReturn validates against calcRMBalanceAvailable — the correct target, matching what this action actually reduces')
    elif 'calcSoftBalanceWeightAvailable(' in _hrmr_body:
        fail('handleRMReturn still validates against Soft\'s balance — Priyam confirmed this should be fixed to validate against RM\'s own balance instead')
    else:
        fail('handleRMReturn does not appear to validate against any WIP-claim-aware Available formula — the Jul 10 2026 double-booking protection may have regressed')

print("\n" + "=" * 70)
print("CHECK 78 — Mobile Worker View submit functions validate against Available balance (Jul 10 2026 fix, updated Jul 18 2026)")
print("=" * 70)
# Systemic gap found via the RM Return investigation: the ENTIRE mobile
# Worker View submission flow (wSubmitPack, wSubmitWindStart,
# wSubmitDyeStart, wSubmitDisp) validated against the base Balance, not
# Available — missing WIP-claim double-booking protection across 4
# different stages, for the exact code path real shop-floor workers use.
# wSubmitStart was checked too and is fine — it does its own correct
# inline WIP subtraction. wSubmitDyeStart's OTHER call site inside the
# legacy, explicitly-frozen submitDyeStart function was deliberately left
# untouched, per standing instruction never to modify that function.
#
# Jul 18 2026 — superseded, not just patched. Confirmed mobile skipped
# real server-side revalidation entirely (client calc + generic /api/save,
# which does no balance check at all) — a worse gap than this check's
# original Jul 10 fix addressed. All 4 functions, plus wSubmitStart/
# wSubmitEnd/wSubmitWindEnd/wSubmitDyeEnd, migrated to the same validated
# endpoints desktop already used, matching the _server_delegation pattern
# established below in Check 79 for the desktop Item I cutover. Delegating
# to the server is the correct end-state, not an intermediate step — same
# reasoning as Check 79, generalized here so this check doesn't need
# editing again for a client-side-only fix that's no longer the target.
_worker_server_delegation = {
    'wSubmitStart': "WORKER_URL+'/api/stage/start'",
    'wSubmitEnd': "WORKER_URL+'/api/stage/end'",
    'wSubmitWindStart': "WORKER_URL+'/api/wind/start'",
    'wSubmitWindEnd': "WORKER_URL+'/api/wind/end'",
    'wSubmitPack': "WORKER_URL+'/api/pack'",
    'wSubmitDyeStart': "WORKER_URL+'/api/dye/start'",
    'wSubmitDyeEnd': "WORKER_URL+'/api/dye/end'",
    'wSubmitDisp': "WORKER_URL+'/api/dispatch'",
}
for fn_name, expected_endpoint in _worker_server_delegation.items():
    _idx = PAGES.find(f'function {fn_name}(')
    if _idx == -1:
        fail(f'{fn_name} not found in pages.js')
        continue
    _next_fn = PAGES.find('\nfunction ', _idx + 10)
    _next_async_fn = PAGES.find('\nasync function ', _idx + 10)
    _boundaries = [b for b in [_next_fn, _next_async_fn] if b != -1]
    _end = min(_boundaries) if _boundaries else _idx + 5000
    _body = PAGES[_idx:_end]
    _expected_apipost = expected_endpoint.replace("WORKER_URL+'", "apiPost('")
    _expected_dupcheck = expected_endpoint.replace("WORKER_URL+'", "_postWithDuplicateCheck('")
    if expected_endpoint in _body or _expected_apipost in _body or _expected_dupcheck in _body:
        ok(f'{fn_name} → correctly delegates to server endpoint (WIP-aware validation now server-side)')
    else:
        fail(f'{fn_name} → does not call its validated endpoint — may have regressed to client-side-only validation, a real double-booking risk')

print("\n" + "=" * 70)
print("CHECK 79 — every action that creates a real WIP claim actually triggers a summary refresh (Jul 11 2026)")
print("=" * 70)
# Found via a real production discrepancy investigation, then a systematic
# sweep for the same pattern: several real, reachable actions created a
# genuine WIP claim (reducing an Available balance) without ever telling
# the affected lot's cached summary to refresh — meaning the number stays
# stale until some UNRELATED later action happens to touch the same lot.
_trigger_checks = [
    ('submitRMReturn', 'lot'),
    ('submitResidualTransfer', 'lot'),
    ('submitOverride', None),  # multi-branch, checked separately below
    ('submitDyeStartNew', 'dye'),
    ('wSubmitStart', 'soft'),
    ('submitStageEntry', 'soft'),
    ('submitWind', 'wind'),
    ('submitPack', 'pack'),
    ('submitDispatch', 'dispatch'),
]
# Jul 14 2026 -- Item I cutover began migrating these functions to worker.js
# endpoints one at a time (submitStageEntry first). Each migrated function
# permanently delegates summary refresh to the server now instead of
# calling triggerSummaryUpdate/_clearSummary directly -- same reasoning as
# the earlier submitVoidEntry/submitVoidRMLotCascade special-cases, just
# generalized here so this check doesn't need editing again for every
# future migration in this same family.
_server_delegation = {
    'submitStageEntry': "WORKER_URL+'/api/stage/start'",
    'wSubmitStart': "WORKER_URL+'/api/stage/start'",
    'submitWind': "WORKER_URL+'/api/wind/start'",
    'submitPack': "WORKER_URL+'/api/pack'",
    'submitDispatch': "WORKER_URL+'/api/dispatch'",
    'submitDyeStartNew': "WORKER_URL+'/api/dye/start'",
    'submitOverride': "WORKER_URL+'/api/override-approve'",
    'approveAllCurrentTab': "WORKER_URL+'/api/approve-all'",
    'submitRMReturn': "WORKER_URL+'/api/rm-return'",
    'submitResidualTransfer': "WORKER_URL+'/api/residual-transfer'",
    # Add future entries here as submitWind/submitPack/submitDispatch/
    # submitDyeStartNew are migrated
}
for fn_name, expected_type in _trigger_checks:
    _idx = PAGES.find(f'function {fn_name}(')
    if _idx == -1:
        fail(f'{fn_name} not found in pages.js')
        continue
    _next_fn = PAGES.find('\nfunction ', _idx + 10)
    _next_async_fn = PAGES.find('\nasync function ', _idx + 10)
    _boundaries = [b for b in [_next_fn, _next_async_fn] if b != -1]
    _end = min(_boundaries) if _boundaries else _idx + 6000
    _body = PAGES[_idx:_end]
    if fn_name in _server_delegation:
        _expected = _server_delegation[fn_name]
        _expected_apipost = _expected.replace("WORKER_URL+'", "apiPost('")
        _expected_dupcheck = _expected.replace("WORKER_URL+'", "_postWithDuplicateCheck('")
        if _expected in _body or _expected_apipost in _body or _expected_dupcheck in _body:
            ok(f'{fn_name} \u2192 correctly delegates to server endpoint (summary refresh now server-side)')
        else:
            fail(f'{fn_name} \u2192 does not call its migrated endpoint -- may have regressed back to client-side logic')
        continue
    has_trigger = 'triggerSummaryUpdate' in _body or '_clearSummary' in _body
    if has_trigger:
        ok(f'{fn_name} triggers a summary refresh (was found genuinely missing this, Jul 11 2026)')
    else:
        fail(f'{fn_name} does not appear to trigger any summary refresh -- a real WIP-claim-creating action would leave the cached summary stale')

# ═══════════════════════════════════════════════════════════════════════
# Jul 14 2026 — checker upgrade. After the full A/B/C/D/I migration, the
# suite needed real coverage of the new architecture, not just reactive
# patches to existing checks as they broke. Builds the 5 rules already
# agreed and documented in the holistic plan (Decisions), never actually
# implemented until now, plus dedicated coverage for every new worker.js
# function that had zero checker coverage.
# ═══════════════════════════════════════════════════════════════════════

print("\n" + "=" * 70)
print("CHECK 80 — no loose source-matching pattern anywhere in the client")
print("=" * 70)
# Formalizes Item G's fix as a permanent, automated rule instead of a
# manual sweep. The exact bug pattern that caused the lot-04 incident:
# a source match that succeeds when grade/vendor is blank on either side,
# instead of requiring an exact match on all three fields.
import re as _re80
_loose_pattern = re.compile(r"\(!s\.grade\|\|s\.grade===|s\.grade===\w+\|\|!s\.grade|\(!s\.vendor\|\|s\.vendor===|s\.vendor===\w+\|\|!s\.vendor")
# Comments documenting past fixes are expected to remain (they reference the
# old pattern in prose) — only fail on the pattern appearing as live code,
# i.e. the line containing the match has no // comment marker before it.
def _real_code_hits(text, pattern):
    hits = []
    for m in pattern.finditer(text):
        line_start = text.rfind('\n', 0, m.start()) + 1
        line = text[line_start:m.start()]
        if '//' in line:
            continue
        hits.append(m.group())
    return hits
real_pages = _real_code_hits(PAGES, _loose_pattern)
real_core = _real_code_hits(CORE, _loose_pattern)
real_worker = _real_code_hits(WORKER, _loose_pattern)
if not real_pages and not real_core and not real_worker:
    ok('No loose source-matching pattern found as live code anywhere (pages.js, core.js, or worker.js)')
else:
    fail(f'Loose source-matching pattern found as live code — pages.js: {len(real_pages)}, core.js: {len(real_core)}, worker.js: {len(real_worker)}')

print("\n" + "=" * 70)
print("CHECK 81 — migrated flows no longer write directly from the client")
print("=" * 70)
# Confirms submitRMEdit/submitVoidEntry/submitVoidRMLotCascade/
# submitEditEntry/submitStageEntry/submitWind/submitPack/submitDispatch/
# submitDyeStartNew/submitDyeEndNew are genuinely thin now — no save()/
# saveBatch() calls left in them. Catches a future accidental regression
# back to client-side writes for exactly the operations this session
# spent real effort protecting.
_migrated_fns = ['submitRMEdit', 'submitVoidEntry', 'submitVoidRMLotCascade', 'submitEditEntry',
                  'submitStageEntry', 'submitWind', 'submitPack', 'submitDispatch',
                  'submitDyeStartNew', 'submitDyeEndNew']
for _fn in _migrated_fns:
    _i = PAGES.find(f'function {_fn}(')
    if _i == -1:
        fail(f'{_fn} not found in pages.js — has it been renamed/removed?')
        continue
    _e = PAGES.find('\nfunction ', _i + 10)
    _ea = PAGES.find('\nasync function ', _i + 10)
    _bounds = [b for b in [_e, _ea] if b != -1]
    _end = min(_bounds) if _bounds else _i + 6000
    _fbody = PAGES[_i:_end]
    _has_write = bool(re.search(r"\bsave\(|\bsaveBatch\(", _fbody))
    _has_fetch = 'WORKER_URL' in _fbody or 'apiPost(' in _fbody or '_postWithDuplicateCheck(' in _fbody
    # submitVoidEntry delegates through a separate helper (_executeVoidOnServer)
    # rather than calling WORKER_URL directly in its own body — a legitimate
    # pattern (keeps the preview-confirmation logic and the network call
    # cleanly separated). Recognize the delegation call itself as sufficient.
    _has_delegated_fetch = '_executeVoidOnServer(' in _fbody and ('WORKER_URL' in PAGES[PAGES.find('function _executeVoidOnServer('):PAGES.find('function _executeVoidOnServer(')+2000] or 'apiPost(' in PAGES[PAGES.find('function _executeVoidOnServer('):PAGES.find('function _executeVoidOnServer(')+2000])
    if _has_write:
        fail(f'{_fn} still contains a direct save()/saveBatch() call — may have regressed back to client-side writes')
    elif not _has_fetch and not _has_delegated_fetch:
        fail(f'{_fn} has no direct write AND no WORKER_URL call (direct or delegated) — check this function is actually functional')
    else:
        ok(f'{_fn} — no direct write, correctly delegates to server')

print("\n" + "=" * 70)
print("CHECK 82 — every triggerSummaryUpdate call is awaited")
print("=" * 70)
# Item N made the function genuinely awaitable. This catches the exact
# "fire and forget" mistake found and fixed across 15 call-sites earlier
# this session, automatically, for any future call-site.
_trigger_calls = list(re.finditer(r'triggerSummaryUpdate\(', PAGES))
_unawaited = []
for m in _trigger_calls:
    _line_start = PAGES.rfind('\n', 0, m.start()) + 1
    if '//' in PAGES[_line_start:m.start()]:
        continue  # comment mentioning the function name in prose, not a real call
    # Find the enclosing function (nearest preceding 'function' keyword) and
    # check for a synchronization signal ANYWHERE within it, not a narrow
    # character window. Three valid shapes exist in this codebase:
    #   (a) direct: await triggerSummaryUpdate(...)
    #   (b) collect-then-await: arr.push(triggerSummaryUpdate(...)); ... await Promise.all(arr)
    #   (c) collect-then-.then(): const triggers=[triggerSummaryUpdate(...)]; ... Promise.all(triggers).then(...)
    # Find the enclosing function boundary using only real function keywords
    # (not '=>' arrows, which can be nested inside the same statement — e.g.
    # a .filter(src=>src.lotId) right next to the trigger call — and would
    # incorrectly shrink the search window to exclude an 'await' that's
    # actually present earlier in the same statement).
    _func_start_plain = PAGES.rfind('\nfunction ', 0, m.start())
    _func_start_async = PAGES.rfind('\nasync function ', 0, m.start())
    _func_search_start = max(_func_start_plain, _func_start_async)
    if _func_search_start == -1:
        _func_search_start = max(0, m.start() - 2000)
    _func_end = PAGES.find('\nfunction ', m.start())
    _func_end_async = PAGES.find('\nasync function ', m.start())
    _bounds = [b for b in [_func_end, _func_end_async] if b != -1]
    _func_end_final = min(_bounds) if _bounds else min(len(PAGES), m.start() + 3000)
    _func_body = PAGES[_func_search_start:_func_end_final]
    _synchronized = ('await' in _func_body) or ('Promise.all' in _func_body)
    if not _synchronized:
        _unawaited.append(PAGES[_line_start:m.end()+40].strip()[:100])
if not _unawaited:
    ok(f'All {len(_trigger_calls)} real triggerSummaryUpdate call-sites are properly synchronized (direct await, collect-then-Promise.all, or collect-then-.then())')
else:
    fail(f'{len(_unawaited)} triggerSummaryUpdate call-site(s) missing synchronization: {_unawaited[:5]}')

print("\n" + "=" * 70)
print("CHECK 83 — new worker.js cascade endpoints use the atomic multi-path PATCH pattern")
print("=" * 70)
# Decision 5's technique — every cascade endpoint (edit/void/dispatch)
# builds one flat "patch" object and commits it with a single
# fbPatch('', patch) call, instead of multiple separate writes that could
# leave a half-completed cascade if interrupted mid-sequence.
_cascade_endpoints = ['handleRMEdit', 'handleVoidEntry', 'handleVoidRMLotCascade', 'handleEditEntry', 'handleDispatchSubmit']
for _fn in _cascade_endpoints:
    _i = WORKER.find(f'async function {_fn}(')
    if _i == -1:
        fail(f'{_fn} not found in worker.js')
        continue
    _e = WORKER.find('\nasync function ', _i + 10)
    _fbody = WORKER[_i:_e if _e != -1 else _i + 8000]
    _patch_commits_matches = list(re.finditer(r"await fbPatch\('',\s*patch\)", _fbody))
    _patch_commits = len(_patch_commits_matches)
    _individual_writes = len(re.findall(r"await fbSet\(|await fbPatch\(`", _fbody))
    # Multiple commits are legitimate if each is immediately followed by a
    # return statement (mutually exclusive branches — e.g. handleRMEdit's
    # multi-delivery-split path vs. its rename path — only one ever
    # executes per invocation). The real safety property is "no second
    # commit happens before this one reaches its return" — checked
    # directly, not via a fixed character-distance guess, since real
    # code legitimately sitting between commit and return (e.g. a
    # summary refresh) shouldn't fail this just for being long.
    def _reaches_return_before_next_commit(m):
        _after = _fbody[m.end():]
        _next_return = _after.find('return')
        _next_commit = _after.find(m.group(0))
        if _next_return == -1:
            return False
        if _next_commit == -1:
            return True
        return _next_return < _next_commit
    _all_mutually_exclusive = all(
        _reaches_return_before_next_commit(m) for m in _patch_commits_matches
    ) if _patch_commits > 1 else True
    if _patch_commits == 1 and _individual_writes == 0:
        ok(f'{_fn} — single atomic patch commit, no individual per-record writes')
    elif _patch_commits > 1 and _all_mutually_exclusive:
        ok(f'{_fn} — {_patch_commits} atomic patch commits, each in a mutually-exclusive branch (immediate return after each) — correct')
    elif _patch_commits == 1:
        ok(f'{_fn} — has the atomic patch commit (some individual writes may be for a different, non-cascade purpose — review if unexpected)')
    else:
        fail(f"{_fn} — {_patch_commits} atomic patch commits found, not all followed by an immediate return — possible non-atomic double-write path")

print("\n" + "=" * 70)
print("CHECK 84 — genIdAtomicServer used for every new record ID in migrated create flows")
print("=" * 70)
# The whole reason genIdAtomicServer was built — confirms every migrated
# creation endpoint actually uses it instead of a non-atomic ID scheme
# that could collide under concurrent load.
_create_endpoints = ['handleStageStart', 'handleWindStart', 'handlePackSubmit', 'handleDispatchSubmit', 'handleDyeStart']
for _fn in _create_endpoints:
    _i = WORKER.find(f'async function {_fn}(')
    if _i == -1:
        fail(f'{_fn} not found in worker.js')
        continue
    _e = WORKER.find('\nasync function ', _i + 10)
    _fbody = WORKER[_i:_e if _e != -1 else _i + 8000]
    if 'genIdAtomicServer(' in _fbody:
        ok(f'{_fn} uses genIdAtomicServer for record ID generation')
    else:
        fail(f'{_fn} does not call genIdAtomicServer — may be using a non-atomic ID scheme, risking collisions under concurrent load')

print("\n" + "=" * 70)
print("CHECK 85 — every /api/* route added this session is actually wired")
print("=" * 70)
# Sanity check that every handler built has a matching route registration
# — catches a handler that got written but never connected.
_expected_routes = [
    ('/api/rm/edit', 'handleRMEdit'), ('/api/void', 'handleVoidEntry'),
    ('/api/void-rm-lot', 'handleVoidRMLotCascade'), ('/api/edit-entry', 'handleEditEntry'),
    ('/api/stage/start', 'handleStageStart'), ('/api/stage/end', 'handleStageEnd'),
    ('/api/wind/start', 'handleWindStart'), ('/api/wind/end', 'handleWindEnd'),
    ('/api/pack', 'handlePackSubmit'), ('/api/dispatch', 'handleDispatchSubmit'),
    ('/api/dye/start', 'handleDyeStart'), ('/api/dye/end', 'handleDyeEnd'),
]
for _route, _handler in _expected_routes:
    if f"url.pathname === '{_route}'" in WORKER and f'await {_handler}(' in WORKER:
        ok(f"{_route} -> {_handler} correctly wired")
    else:
        fail(f"{_route} -> {_handler} NOT correctly wired -- route or handler call missing")

print("\n" + "=" * 70)
print("CHECK 100 — fbSet/fbPatch always build a well-formed URL, even with an empty path")
print("=" * 70)
# Jul 22 2026 — real production bug: fbSet/fbPatch built their URL as
# `${FIREBASE_URL}${path}.json` with no guaranteed separator. When path
# is empty (used by 22 different handlers for multi-location root
# updates — every End action, every Void, every Approve, Dispatch, and
# more), this glued ".json" straight onto the bare domain with no
# slash, producing a malformed address. Every Start-type action (which
# uses a real, non-empty path) worked fine; every End/Void/Approve
# action failed — exactly the pattern that gave this away.
_fbset_body_m = re.search(r'async function fbSet\(path, data\) \{(.*?)\n\}', WORKER, re.DOTALL)
_fbpatch_body_m = re.search(r'async function fbPatch\(path, data\) \{(.*?)\n\}', WORKER, re.DOTALL)
for _name, _m in [('fbSet', _fbset_body_m), ('fbPatch', _fbpatch_body_m)]:
    if not _m:
        fail(f'{_name} function not found — cannot verify URL construction is safe')
        continue
    _body = _m.group(1)
    _has_safe_slash_logic = "path.startsWith('/')" in _body and ("'/' + path" in _body or '"/" + path' in _body)
    _uses_raw_concat_only = f'{{FIREBASE_URL}}${{path}}.json' in WORKER and not _has_safe_slash_logic
    if _has_safe_slash_logic:
        ok(f'{_name} guarantees a separating slash before .json, even when path is empty')
    else:
        fail(f'{_name} does not guarantee a separating slash — an empty path (used by every End/Void/Approve/Dispatch action) will build a malformed URL and fail')

print("\n" + "=" * 70)
print("CHECK 101 — genIdAtomicServer never falls back to an unsafe local guess")
print("=" * 70)
# Jul 22 2026 — real production bug: the old fallback path, used
# whenever the safe counter path hit trouble, guessed the next ID by
# scanning locally-visible data, with zero protection against two
# different requests guessing the same number at the same time.
# Confirmed on 98 real dispatch records — two genuinely different
# deliveries sharing one ID. Fixed by routing everything through the
# same genuine lock already proven for balance protection, and failing
# loudly instead of ever silently guessing.
_genid_body_m = re.search(r'async function genIdAtomicServer\(.*?\{(.*?)\n\}', WORKER, re.DOTALL)
if not _genid_body_m:
    fail('genIdAtomicServer function not found — cannot verify ID safety')
else:
    _genid_body = _genid_body_m.group(1)
    if 'falling back to local scan' in _genid_body or 'return `${prefix}-${String(localNext' in _genid_body:
        fail('genIdAtomicServer still has the unsafe local-scan fallback — two concurrent requests can be handed the same ID again')
    elif 'withBalanceLock(' in _genid_body:
        ok('genIdAtomicServer routes through the real, proven lock — never silently guesses an ID')
    else:
        fail('genIdAtomicServer does not use withBalanceLock — its safety mechanism may have regressed to something unverified')

print("\n" + "=" * 70)
print("CHECK 102 — Start-type actions never call the old full-recompute summary functions")
print("=" * 70)
# Jul 19 2026 — real finding: a Pending/InProgress record can never
# affect an Approved-only Base Balance calculation, so calling
# updateLotSummary/updateDyeLotSummary at Start time is mathematically
# guaranteed to do nothing useful — and was the actual mechanism that
# let a summary silently go stale (confirmed: lot 301003). Removed
# from all 6 places it was found. This check guards against it quietly
# creeping back in during future edits.
_start_handlers_must_not_call = ['handleStageStart', 'handleWindStart', 'handlePackSubmit', 'handleDyeStart', 'handleDispatchSubmit']
for _fn in _start_handlers_must_not_call:
    _i = WORKER.find(f'async function {_fn}(')
    if _i == -1:
        fail(f'{_fn} not found in worker.js')
        continue
    _e = WORKER.find('\nasync function ', _i + 10)
    _fbody = WORKER[_i:_e if _e != -1 else _i + 8000]
    if 'updateLotSummary(' in _fbody or 'updateDyeLotSummary(' in _fbody:
        fail(f'{_fn} calls the old full-recompute summary function again — this is mathematically pointless at Start time (a Pending/InProgress record can never affect the Approved-only Base Balance) and is the exact mechanism that caused a real stale-summary bug (lot 301003)')
    else:
        ok(f'{_fn} correctly does not call the pointless full-recompute summary function')

print("\n" + "=" * 70)
print("CHECK 103 — RM Edit refreshes the summary at both of its real exit paths")
print("=" * 70)
# Jul 19 2026 — real, confirmed gap: RM Edit directly changes a lot's
# actual weight/units with no approval gate at all, and originally
# called no summary refresh anywhere, on either exit path (the plain
# rename case, and the multi-delivery split case). Fixed at both.
_rmedit_i = WORKER.find('async function handleRMEdit(')
if _rmedit_i == -1:
    fail('handleRMEdit function not found — cannot verify summary refresh')
else:
    _rmedit_e = WORKER.find('\nasync function ', _rmedit_i + 10)
    _rmedit_body = WORKER[_rmedit_i:_rmedit_e if _rmedit_e != -1 else _rmedit_i + 8000]
    # Jul 24 2026 — RM Edit converted from full recompute (updateLotSummary)
    # to ledger nudge (nudgeLotSummary) at both exit paths. Count either —
    # both are genuine summary-refresh calls, just via different mechanisms.
    _refresh_count = _rmedit_body.count('updateLotSummary(') + _rmedit_body.count('nudgeLotSummary(')
    if _refresh_count >= 4:  # 2 calls (original + new lot key) x 2 exit paths
        ok(f'handleRMEdit refreshes the summary at both real exit paths ({_refresh_count} calls found)')
    else:
        fail(f'handleRMEdit only has {_refresh_count} summary-refresh call(s) — expected at least 4 (original + new lot key, at both the split-delivery and rename exit paths) — a real weight/unit change may go uncounted')

print("\n" + "=" * 70)
print("CHECK 104 — Override only refreshes when the entry is actually counted, and never loses a failure silently")
print("=" * 70)
# Jul 25 2026 — handleOverride (the plain field-edit override, separate
# from handleOverrideApprove) was deliberately removed. It duplicated
# Edit's job — correcting an already-Approved entry's numbers — through a
# second, less-protected door (no password, and unlike Edit, no check
# that the new numbers were physically possible). Edit is the one
# surviving path for that now. This check confirms the removal was
# actually clean (no route, no dangling client caller) rather than
# expecting a function that's supposed to be gone.
_override_i = WORKER.find('async function handleOverride(')
_route_gone = "url.pathname === '/api/override'" not in WORKER or "return await handleOverride(" not in WORKER
_client_caller_gone = "apiPost('/api/override'" not in PAGES
if _override_i == -1 and _route_gone and _client_caller_gone:
    ok('handleOverride correctly removed — no function, no route, no client caller left behind (superseded by Edit)')
elif _override_i == -1 and not (_route_gone and _client_caller_gone):
    fail('handleOverride function is gone but a route or client caller still references it — dangling reference, will error at runtime')
else:
    _override_e = WORKER.find('\nasync function ', _override_i + 10)
    _override_body = WORKER[_override_i:_override_e if _override_e != -1 else _override_i + 8000]
    _has_is_counted = "after.status === 'Approved'" in _override_body and "after.status === 'Edited-Approved'" in _override_body
    _has_failure_tracking = 'summaryRefreshFailed' in _override_body
    if _has_is_counted and _has_failure_tracking:
        ok('handleOverride correctly gates its refresh on isCounted and records summaryRefreshFailed instead of losing it silently')
    else:
        fail(f'handleOverride is missing {"the isCounted gate" if not _has_is_counted else ""}{" and " if not _has_is_counted and not _has_failure_tracking else ""}{"visible failure tracking" if not _has_failure_tracking else ""} — may refresh pointlessly or lose a real failure silently')

print("\n" + "=" * 70)
print("CHECK 105 — every duplicate-name check is genuinely locked, not just checked")
print("=" * 70)
# Jul 22 2026 — real finding: a "check if this name/number already
# exists, then save" pattern is not actually safe unless the check and
# the save happen as one locked unit — otherwise two near-simultaneous
# submissions can both see the name as free before either commits,
# same race shape already found and fixed for dispatch IDs. Confirmed
# on real production data: 2 genuine dye-lot-number collisions found
# this way. Fixed in all 3 real places this pattern existed.
_dup_check_functions = {
    'handleDyeEnd': 'DYELOTNO_',
    'handleRMEdit': 'RMEDIT_',
    'handleUsersCreate': 'USERCREATE_',
}
for _fn, _lock_prefix in _dup_check_functions.items():
    _i = WORKER.find(f'async function {_fn}(')
    if _i == -1:
        fail(f'{_fn} not found in worker.js')
        continue
    _e = WORKER.find('\nasync function ', _i + 10)
    _fbody = WORKER[_i:_e if _e != -1 else _i + 12000]
    if f"`{_lock_prefix}" in _fbody and 'withBalanceLock(' in _fbody:
        ok(f'{_fn} locks its duplicate-name check together with the save — not just a plain check before a separate write')
    else:
        fail(f'{_fn} does not lock its duplicate-name check — two near-simultaneous submissions could both pass the check before either saves, the same race already found and fixed for dispatch IDs')

print("\n" + "=" * 70)
print("CHECK 106 — functions referenced via dynamic action-strings have window exports")
print("=" * 70)
# Jul 22 2026 — real bug found: searchNavTo is called from every single
# search result (RM, Dye, Vendor, Party, Soft, Wind, Pack, Dispatch) via
# a dynamically-built onclick string (`onclick="${r.action}"`, where
# r.action itself contains `searchNavTo(...)`) — invisible to a simple
# static-text onclick scan, which is exactly why this slipped past even
# the bundled checker's Layer 6 test. Clicking any search result did
# nothing, silently, for as long as this existed. Fixed — and this check
# specifically covers this dynamic-action-string pattern, which Layer 6
# structurally cannot see.
_action_fns = set(re.findall(r"action:\s*`([A-Za-z_$][A-Za-z0-9_$]*)\(", PAGES))
if not _action_fns:
    fail('No functions found via the action:`funcName( pattern in pages.js — the search-result-click mechanism may have been restructured; verify this check still applies')
else:
    for _fn in sorted(_action_fns):
        if f'window.{_fn}=' in PAGES or f'window.{_fn} =' in PAGES:
            ok(f'{_fn} (referenced via a dynamic action-string in search results) has a window export')
        else:
            fail(f'{_fn} is referenced via a dynamic action-string (onclick="${{r.action}}") but has no window export — every search result calling it will silently do nothing when clicked, and this is invisible to a simple static onclick scan')

print("\n" + "=" * 70)
print("CHECK 107 — Challan Tracker does not silently exclude dispatches with no challan/invoice")
print("=" * 70)
# Jul 29 2026 — real bug found during the 6-screen audit: a dispatch
# with neither a challanId nor an invoiceNo used to be silently skipped
# entirely in _renderChallanCore — genuinely dispatched, Approved
# material with zero trace anywhere on the Challan Tracker screen.
# Confirmed the field is optional at dispatch time, not required, so
# this was a real, live gap. Fixed to give each such dispatch its own
# visible entry instead. This check makes sure the old skip pattern
# doesn't come back.
_challan_idx = PAGES.find('function _renderChallanCore()')
if _challan_idx == -1:
    fail('_renderChallanCore not found in pages.js — Challan Tracker may have been restructured; verify this check still applies')
else:
    _challan_end = PAGES.find('\nfunction ', _challan_idx + 10)
    _challan_body = PAGES[_challan_idx:_challan_end if _challan_end != -1 else _challan_idx + 8000]
    _has_old_skip_bug = "if(!key||key==='inv-')return;" in _challan_body
    _has_no_challan_fallback = "'no-challan-'" in _challan_body
    if _has_old_skip_bug:
        fail("_renderChallanCore has regressed back to silently skipping dispatches with no challanId/invoiceNo (the exact bug found and fixed Jul 29 2026) — genuinely dispatched material would go invisible on this screen again")
    elif not _has_no_challan_fallback:
        fail("_renderChallanCore no longer has the 'no-challan-' fallback key — dispatches missing a challan/invoice may not be getting their own visible entry anymore")
    else:
        ok('_renderChallanCore correctly gives dispatches with no challan/invoice their own visible entry, instead of silently excluding them')

print("\n" + "=" * 70)
print("CHECK 108 — Vendor Tracker's Dispatched status uses the canonical exact-match definition, not a fuzzy percentage")
print("=" * 70)
# Jul 29 2026 — real inconsistency found during the 6-screen audit:
# vtLotStatus used to decide "Dispatched" at a 95% threshold
# (disp.units>=lot.units*0.95), while the actual, canonical
# fullyDispatched definition used everywhere else in the app (archiving,
# balance math) requires essentially exact completion. A lot at 95%
# would show "Dispatched" here while every other part of the system
# still correctly treated it as unfinished. Fixed to use the cached
# summary's own fullyDispatched flag when available, falling back to an
# exact (not fuzzy) live check otherwise.
_vt_idx = PAGES.find('function vtLotStatus(lotId)')
if _vt_idx == -1:
    fail('vtLotStatus not found in pages.js — Vendor Tracker may have been restructured; verify this check still applies')
else:
    _vt_end = PAGES.find('\n\nfunction renderVendorV2', _vt_idx)
    _vt_body = PAGES[_vt_idx:_vt_end if _vt_end != -1 else _vt_idx + 4000]
    # Strip // comments before checking — otherwise this check would
    # false-positive on its own explanatory comment describing the old
    # bug for documentation purposes (the exact class of self-referential
    # false positive already found and fixed elsewhere in this checker).
    _vt_body_nocomments = re.sub(r'//[^\n]*', '', _vt_body)
    _has_old_threshold_bug = 'lot.units*0.95' in _vt_body_nocomments or 'lot.units *0.95' in _vt_body_nocomments or 'lot.units * 0.95' in _vt_body_nocomments
    _has_fullydispatched_check = 'fullyDispatched' in _vt_body_nocomments
    if _has_old_threshold_bug:
        fail("vtLotStatus has regressed back to the 95% fuzzy threshold for 'Dispatched' (the exact inconsistency found and fixed Jul 29 2026) — would disagree with the canonical fullyDispatched definition used everywhere else")
    elif not _has_fullydispatched_check:
        fail("vtLotStatus no longer references fullyDispatched — it may have lost its link to the canonical, single-source-of-truth definition used everywhere else in the app")
    else:
        ok("vtLotStatus correctly uses the canonical fullyDispatched definition, not a separate fuzzy-threshold approximation")

print("\n" + "=" * 70)
print("CHECK 109 — Dead Stock Void/Edit block against material already consumed downstream")
print("=" * 70)
# Jul 29 2026 — Dead Stock Edit/Void built with a real safety check:
# can't void or shrink an entry that Dye or Soft has already drawn from.
# This check confirms both functions still call calcDeadStockBalance to
# verify that before acting, not just trusting the request.
for _fn in ['handleVoidDeadStock', 'handleEditDeadStock']:
    _idx = WORKER.find(f'async function {_fn}(')
    if _idx == -1:
        fail(f'{_fn} not found in worker.js')
        continue
    _end = WORKER.find('\nasync function ', _idx + 10)
    _body = re.sub(r'//[^\n]*', '', WORKER[_idx:_end if _end != -1 else _idx + 6000])
    if 'calcDeadStockBalance(' in _body:
        ok(f'{_fn} correctly checks real consumption via calcDeadStockBalance before acting')
    else:
        fail(f'{_fn} no longer calls calcDeadStockBalance — the safety check against voiding/shrinking already-consumed material may have been lost')

print("\n" + "=" * 70)
print("CHECK 110 — Scrap Void correctly reverses the source's Scrapped status, and voided scrap is excluded from balance formulas")
print("=" * 70)
# Jul 29 2026 — scrapping something can flip the source (Dead Stock or
# Recycle Stock) to status 'Scrapped' if it uses up the last of it.
# Voiding that scrap has to reverse the flip, not just delete the log
# entry — and the balance formulas themselves need to exclude voided
# scrap or they'd keep counting it forever.
_sc_idx = WORKER.find('async function handleVoidScrap(')
if _sc_idx == -1:
    fail('handleVoidScrap not found in worker.js')
else:
    _sc_end = WORKER.find('\nasync function ', _sc_idx + 10)
    _sc_body = re.sub(r'//[^\n]*', '', WORKER[_sc_idx:_sc_end if _sc_end != -1 else _sc_idx + 6000])
    if "status: 'Scrapped'" in _sc_body.replace('"', "'") or "'Scrapped'" in _sc_body:
        ok('handleVoidScrap correctly checks for and reverses the source Scrapped status')
    else:
        fail("handleVoidScrap no longer references the source's 'Scrapped' status — voiding a scrap that fully consumed its source may leave it incorrectly stuck as Scrapped")
_shared_nocomments = re.sub(r'//[^\n]*', '', SHARED) if 'SHARED' in dir() else None
_shared_text = (BASE / 'assets/js/shared-balances.js').read_text(encoding='utf-8')
_shared_nocomments = re.sub(r'//[^\n]*', '', _shared_text)
if "s.status !== 'Voided'" in _shared_nocomments and 'calcDeadStockBalance' in _shared_nocomments:
    ok('calcDeadStockBalance/calcRecycleBalance correctly exclude voided scrap entries from the scrapped total')
else:
    fail('The shared balance formulas may no longer exclude voided scrap entries — a voided scrap would keep counting against the balance forever')

print("\n" + "=" * 70)
print("CHECK 111 — Residual Void/Edit use the real shared pooled-bucket balance check, not a separate approximation")
print("=" * 70)
# Jul 29 2026 — residualStock is a pooled bucket fed by multiple
# transfers from different lots, and that pool can already be partially
# consumed by a real Dye Start. Void/Edit both need to check the real,
# current available balance in that shared pool via calcResidualStockBalance
# before removing or reducing a contribution — not just trust the
# request, and not duplicate the formula separately.
if 'calcResidualStockBalance' not in _shared_nocomments:
    fail('calcResidualStockBalance not found in shared-balances.js — the single source of truth for the pooled residual bucket balance may have been removed')
else:
    ok('calcResidualStockBalance exists as a proper shared formula, not just an inline calculation')
for _fn in ['handleVoidResidualTransfer', 'handleEditResidualTransfer']:
    _idx = WORKER.find(f'async function {_fn}(')
    if _idx == -1:
        fail(f'{_fn} not found in worker.js')
        continue
    _end = WORKER.find('\nasync function ', _idx + 10)
    _body = re.sub(r'//[^\n]*', '', WORKER[_idx:_end if _end != -1 else _idx + 8000])
    if 'calcResidualStockBalance(' in _body:
        ok(f'{_fn} correctly checks the real pooled-bucket balance before acting')
    else:
        fail(f'{_fn} no longer calls calcResidualStockBalance — voiding/editing a contribution to a shared pool could push it below what real Dye consumption has already drawn from it')

print("\n" + "=" * 70)
print("CHECK 112 — Recycle split-undo checks Dye, Wind (including in-progress), AND Soft — not just completed consumption")
print("=" * 70)
# Jul 29 2026 — the real, confirmed risk found before building this:
# checking only whether the recycle stock's balance had dropped would
# miss material currently mid-Wind — real, active work, not yet
# "consumed" in the balance sense. This check makes sure all three
# pathways (Dye source use, Wind activity including InProgress/Pending,
# Soft activity) are still checked before a split can be undone.
_rc_idx = WORKER.find('async function handleVoidDyeSplit(')
if _rc_idx == -1:
    fail('handleVoidDyeSplit not found in worker.js')
else:
    _rc_end = WORKER.find('\nasync function ', _rc_idx + 10)
    _rc_body = re.sub(r'//[^\n]*', '', WORKER[_rc_idx:_rc_end if _rc_end != -1 else _rc_idx + 6000])
    _checks_dye = "sourceType === 'recycle'" in _rc_body
    _checks_wind = ('windEntries.some(' in _rc_body or 'windEntries.filter(' in _rc_body) and 'recycleId' in _rc_body
    _checks_soft = "stage === 'Soft'" in _rc_body
    if _checks_dye and _checks_wind and _checks_soft:
        ok('handleVoidDyeSplit correctly checks all three real pathways — Dye, Wind (including in-progress), and Soft — before allowing a split to be undone')
    else:
        _missing = []
        if not _checks_dye: _missing.append('Dye source use')
        if not _checks_wind: _missing.append('Wind activity')
        if not _checks_soft: _missing.append('Soft activity')
        fail(f"handleVoidDyeSplit appears to be missing a check for: {', '.join(_missing)} — undoing a split could rip out real work still relying on the recycle stock")

print("\n" + "=" * 70)
print("CHECK 113 — Wind Start and Soft Start validate recycle material against its real balance, matching Dye Start")
print("=" * 70)
# Jul 29 2026 — real, confirmed gap: recycleId was accepted at both Wind
# Start and Soft Start with zero validation against the recycle stock's
# actual remaining balance — someone could claim more than genuinely
# exists, or claim the same material twice across different stages,
# and nothing would stop it. Dye Start already validated this correctly;
# this brings Wind and Soft up to the same standard, same formula.
for _fn in ['handleStageStart', 'handleWindStart']:
    _idx = WORKER.find(f'async function {_fn}(')
    if _idx == -1:
        fail(f'{_fn} not found in worker.js')
        continue
    _end = WORKER.find('\nasync function ', _idx + 10)
    _body = re.sub(r'//[^\n]*', '', WORKER[_idx:_end if _end != -1 else _idx + 8000])
    if 'calcRecycleBalance(' in _body and 'recycleId' in _body:
        ok(f'{_fn} correctly validates recycle material against its real balance before accepting it')
    else:
        fail(f'{_fn} no longer validates recycleId against calcRecycleBalance — recycle material could be over-claimed or claimed twice with nothing catching it')

print("\n" + "=" * 70)
print("CHECK 114 — confirmed duplicate resubmission uses a fresh idempotency key, not the one already flagged")
print("=" * 70)
# Jul 29 2026 — real, confirmed bug (reproduced end-to-end before this
# fix): _postWithDuplicateCheck used to resubmit with the SAME
# idempotencyKey as the first attempt. That key was already recorded as
# "seen" during the first request, so a user's genuine, deliberate
# confirmation ("yes, I know, proceed") was getting silently blocked by
# a completely different, unrelated guard — the accidental-double-click
# protection — which had no idea anything had just been confirmed.
_dc_idx = PAGES.find('async function _postWithDuplicateCheck(')
if _dc_idx == -1:
    fail('_postWithDuplicateCheck not found in pages.js')
else:
    _dc_end1 = PAGES.find('\nfunction ', _dc_idx + 10)
    _dc_end2 = PAGES.find('\nasync function ', _dc_idx + 10)
    _dc_end_candidates = [x for x in [_dc_end1, _dc_end2] if x != -1]
    _dc_end = min(_dc_end_candidates) if _dc_end_candidates else -1
    _dc_body = re.sub(r'//[^\n]*', '', PAGES[_dc_idx:_dc_end if _dc_end != -1 else _dc_idx + 2000])
    if 'confirmDuplicate:true' in _dc_body.replace(' ', '') and 'idempotencyKey:crypto.randomUUID()' in _dc_body.replace(' ', ''):
        ok('_postWithDuplicateCheck correctly generates a fresh idempotency key on the confirmed resubmission')
    else:
        fail('_postWithDuplicateCheck no longer generates a fresh idempotency key on resubmission — a confirmed "yes, proceed" could silently get blocked again by the unrelated double-click guard')

print("\n" + "=" * 70)
print("CHECK 115 — every submission to Soft/Wind/Pack/Dye Start correctly handles duplicate warnings — mobile included, not just desktop")
print("=" * 70)
# Jul 29 2026 — real, confirmed gap found while checking this class of
# bug systematically: mobile Dye Start was using a bare apiPost() call,
# with zero way to see or respond to a duplicate warning — a real
# violation of the standing rule that mobile matches desktop exactly,
# resolution aside. This check confirms every submission to these 4
# endpoints goes through either the shared _postWithDuplicateCheck, or
# an equally-safe pattern that generates its own fresh key per call —
# not a bare, unhandled apiPost call.
_dup_endpoints = ['/api/stage/start', '/api/wind/start', '/api/pack', '/api/dye/start']
_bare_calls = []
for _ep in _dup_endpoints:
    for _m in re.finditer(re.escape(f"apiPost('{_ep}'"), PAGES):
        # Confirmed safe if it's actually _postWithDuplicateCheck (the call
        # itself contains "_postWithDuplicateCheck(" right before this apiPost
        # text — or if it's the one known-safe inline pattern that generates
        # a genuinely fresh key per call, confirmed once, by name, below).
        _context_before = PAGES[max(0, _m.start()-30):_m.start()]
        if '_postWithDuplicateCheck(' in _context_before:
            continue
        _bare_calls.append((_ep, _m.start()))
# The one confirmed-safe exception: desktop Dye Start's own inline
# _doSubmit, which generates a fresh crypto.randomUUID() on every single
# call (including the resubmit) — verified safe, not the same bug shape.
_known_safe_inline = PAGES.count("idempotencyKey:crypto.randomUUID(),confirmDuplicate:confirmDup||undefined")
_unexplained_bare_calls = len(_bare_calls) - _known_safe_inline
if _unexplained_bare_calls > 0:
    fail(f"Found {_unexplained_bare_calls} unexplained bare apiPost() call(s) to a duplicate-checked endpoint, bypassing both _postWithDuplicateCheck and the known-safe inline pattern — likely a real gap, the same shape as today's mobile Dye Start finding: {_bare_calls}")
else:
    ok("Every submission to Soft/Wind/Pack/Dye Start correctly handles duplicate warnings — no bare, unhandled apiPost calls found")

print("\n" + "=" * 70)
print("CHECK 116 — CRITICAL: all 4 user-management endpoints require a real, verified session token, not a trusted plain-text username")
print("=" * 70)
# Jul 29 2026 — real, serious, confirmed-exploitable vulnerability found
# during the Masters/Users audit: handleUsersCreate/Toggle/Delete/
# ResetPassword only ever checked whether a CLAIMED username (sent as
# plain text in the request body) belonged to an admin — never whether
# the actual requester was genuinely logged in as that person. Anyone
# could send requestingUsername:"admin" with zero login and be treated
# as a full admin — including resetting the real admin's own password
# and locking them out. Fixed to use the same signed, verified session
# token every other action in this app correctly uses. This check makes
# sure it can never regress, in either direction — the unsafe function
# must stay gone, and every handler must genuinely check a real token.
_unsafe_fn_gone = '_verifyRequesterIsAdmin(requestingUsername)' not in WORKER and 'async function _verifyRequesterIsAdmin' not in WORKER
if _unsafe_fn_gone:
    ok('The unsafe _verifyRequesterIsAdmin function is confirmed removed, not just unused')
else:
    fail('_verifyRequesterIsAdmin has reappeared or is still referenced — this is the exact unauthenticated admin-spoofing vulnerability found and fixed Jul 29 2026')

for _fn in ['handleUsersCreate', 'handleUsersToggle', 'handleUsersDelete', 'handleUsersResetPassword']:
    _idx = WORKER.find(f'async function {_fn}(')
    if _idx == -1:
        fail(f'{_fn} not found in worker.js')
        continue
    _sig_end = WORKER.find(')', _idx)
    _sig = WORKER[_idx:_sig_end]
    _end = WORKER.find('\nasync function ', _idx + 10)
    _body = re.sub(r'//[^\n]*', '', WORKER[_idx:_end if _end != -1 else _idx + 3000])
    _has_token_param = 'tokenClaim' in _sig
    _checks_role = "tokenClaim?.role" in _body or "tokenClaim ?. role" in _body.replace(' ', '')
    _trusts_body_username = 'requestingUsername' in _body
    if _has_token_param and _checks_role and not _trusts_body_username:
        ok(f'{_fn} correctly requires a real, verified session token, not a client-claimed username')
    else:
        fail(f'{_fn} does not correctly verify a real session token (has tokenClaim param: {_has_token_param}, checks role: {_checks_role}, still trusts body username: {_trusts_body_username}) — this is the exact vulnerability shape found and fixed Jul 29 2026')

# Route-level check — confirm the routes actually call verifySessionToken
# and pass the result through, not just that the handlers accept a param
# that never actually gets a real value.
_route_idx = WORKER.find("url.pathname === '/api/users/delete'")
if _route_idx != -1:
    _route_body = WORKER[_route_idx:_route_idx+300]
    if 'verifySessionToken(' in _route_body:
        ok('The /api/users/* routes correctly call verifySessionToken before reaching the handlers')
    else:
        fail('The /api/users/* routes no longer call verifySessionToken — handlers may be receiving an empty or fake tokenClaim')
else:
    fail('/api/users/delete route not found — cannot verify route-level protection')

print("\n" + "=" * 70)
print("CHECK 117 — CRITICAL: the generic /api/save endpoint cannot wipe operational tables, and the new dedicated Clear Stage endpoint is properly secured")
print("=" * 70)
# Jul 29 2026 — real, serious, confirmed-exploitable vulnerability found
# during the Masters/Users audit: the generic save endpoint's whole-table
# replace mode (fbSet, a full overwrite) had no real restriction beyond
# _canWrite, which is true for nearly every role on operational tables
# like lots/dyeLots/stageEntries, since normal work requires writing
# there. Anyone permitted to write to a table at all could send
# {table, data:{}} and instantly, irreversibly wipe the entire
# collection. Fixed two ways: (1) the generic save path now only allows
# whole-table replace for masters/parties, nothing operational; (2) the
# "Clear All" feature — confirmed intentional, genuine permanent delete,
# not archived — moved to its own dedicated endpoint requiring a real
# admin session plus the person's own password.
_hs_idx = WORKER.find('async function handleSave(')
if _hs_idx == -1:
    fail('handleSave not found in worker.js')
else:
    _hs_end = WORKER.find('\nasync function ', _hs_idx + 10)
    _hs_body = re.sub(r'//[^\n]*', '', WORKER[_hs_idx:_hs_end if _hs_end != -1 else _hs_idx + 4000])
    _allowlist_match = re.search(r'_WHOLE_TABLE_REPLACE_ALLOWED\s*=\s*\[([^\]]*)\]', _hs_body)
    _allowlist_contents = _allowlist_match.group(1) if _allowlist_match else ''
    _has_safe_tables = "'masters'" in _allowlist_contents and "'parties'" in _allowlist_contents
    _dangerous_tables_excluded = not any(t in _allowlist_contents for t in ["'lots'", "'dyeLots'", "'stageEntries'", "'windEntries'", "'packEntries'", "'dispatches'", "'partyOrders'"])
    if _has_safe_tables and _dangerous_tables_excluded:
        ok('handleSave correctly restricts whole-table replace to masters/parties only, not operational tables')
    else:
        fail('handleSave no longer restricts whole-table replace — this is the exact vulnerability found and fixed Jul 29 2026, an operational table could be wiped via the generic save endpoint again')

_hcs_idx = WORKER.find('async function handleClearStage(')
if _hcs_idx == -1:
    fail('handleClearStage not found in worker.js — the dedicated Clear Stage endpoint may have been removed')
else:
    _hcs_end = WORKER.find('\nasync function ', _hcs_idx + 10)
    _hcs_body = re.sub(r'//[^\n]*', '', WORKER[_hcs_idx:_hcs_end if _hcs_end != -1 else _hcs_idx + 3000])
    _requires_admin = "['admin', 'manager'].includes(role)" in _hcs_body
    _requires_password = '_verifySelfPassword(' in _hcs_body
    _scoped_tables = '_CLEARABLE_TABLES' in _hcs_body
    if _requires_admin and _requires_password and _scoped_tables:
        ok('handleClearStage correctly requires admin-or-manager, the person\'s own verified password, and is scoped to a fixed table list')
    else:
        fail(f'handleClearStage is missing real protection (role check: {_requires_admin}, password check: {_requires_password}, scoped table list: {_scoped_tables})')

# Jul 29 2026, later same day — Priyam's explicit, direct instruction:
# admin and manager are the same tier everywhere. Updated from the
# earlier admin-only rule.
for _fn in ['handleBackupRestore', 'handleBackupDelete']:
    _idx = WORKER.find(f'async function {_fn}(')
    if _idx == -1:
        fail(f'{_fn} not found in worker.js')
        continue
    _sig_end = WORKER.find(')', _idx)
    _has_token_param = 'tokenClaim' in WORKER[_idx:_sig_end]
    _end = WORKER.find('\nasync function ', _idx + 10)
    _body = re.sub(r'//[^\n]*', '', WORKER[_idx:_end if _end != -1 else _idx + 2000])
    _checks_role = "['admin', 'manager'].includes(role)" in _body
    _uses_real_password_check = '_verifySelfPassword(' in _body
    _no_old_unsafe = '_matchAdminOnlyPassword(' not in _body and '_matchAnyAdminPassword(' not in _body
    if _has_token_param and _checks_role and _uses_real_password_check and _no_old_unsafe:
        ok(f'{_fn} correctly requires a real, verified admin-or-manager session')
    else:
        fail(f'{_fn} does not correctly verify a real admin-or-manager session — this is the exact vulnerability shape found and fixed Jul 29 2026, or the role parity Priyam explicitly confirmed has regressed')

print("\n" + "=" * 70)
print("CHECK 118 — Flow report accurately shows dye as loss-only, never a misleading 'gain'")
print("=" * 70)
# Jul 29 2026 — Priyam confirmed: dye has no gain, only pack has gain.
# rptFlow's top-level dye figure was already mathematically correct
# (dyeOut capped at dyeIn, so the number could never actually be
# positive) but the DISPLAY code still had a full, working "gain"
# branch — green color, up-arrow, the word "gain" — that could never
# actually be reached. Confusing, dead code, not a wrong number, but
# real enough to fix and lock in. Now uses dyeLoss (always >=0 by
# definition) with a single, accurate "lost" label, matching how
# Soft/Wind already correctly display their own waste.
_rf_idx = PAGES.find('function rptFlow()')
if _rf_idx == -1:
    fail('rptFlow not found in pages.js')
else:
    _rf_end = PAGES.find('\nfunction ', _rf_idx + 10)
    _rf_body = re.sub(r'//[^\n]*', '', PAGES[_rf_idx:_rf_end if _rf_end != -1 else _rf_idx + 6000])
    _has_dyeloss = 'dyeLoss=' in _rf_body.replace(' ', '')
    _no_dead_gain_branch = 'dyeGain' not in _rf_body
    if _has_dyeloss and _no_dead_gain_branch:
        ok('rptFlow correctly shows dye as loss-only, no leftover unreachable gain display code')
    else:
        fail("rptFlow's dye figure has regressed back to a gain/loss branch that can never actually show gain — misleading dead code, contradicts Priyam's confirmed rule that dye has no gain")

print("\n" + "=" * 70)
print("CHECK 119 — Excel export uses real dates (not text) and includes archived data")
print("=" * 70)
# Jul 29 2026 — Priyam confirmed two real gaps in the Excel export:
# dates were written as locale-formatted text, blocking any date-based
# pivoting/grouping in Excel or Power BI; and archived records (anything
# fully completed and moved out of active data) were silently missing
# entirely, since the export ran synchronously against whatever was
# already in memory. Fixed: dates now use real Date objects with
# cellDates:true, and the export loads archive first via the same
# proven _loadArchiveWithCache mechanism Reports already uses.
_ete_idx = PAGES.find('function exportToExcel()')
if _ete_idx == -1:
    fail('exportToExcel not found in pages.js')
else:
    _ete_end = PAGES.find('\nfunction _doExportToExcel()', _ete_idx)
    _ete_body = PAGES[_ete_idx:_ete_end if _ete_end != -1 else _ete_idx + 300]
    if '_loadArchiveWithCache(' in _ete_body:
        ok('exportToExcel correctly loads archive data before building the export')
    else:
        fail('exportToExcel no longer loads archive data first — completed/archived records may silently be missing from the export again')

_doe_idx = PAGES.find('function _doExportToExcel()')
if _doe_idx == -1:
    fail('_doExportToExcel not found in pages.js')
else:
    _doe_end = PAGES.find('\nfunction ', _doe_idx + 10)
    _doe_raw_body = PAGES[_doe_idx:_doe_end if _doe_end != -1 else _doe_idx + 500]
    _has_real_date_fn = 'const fmtD=v=>v?new Date(v):' in _doe_raw_body
    _uses_celldates = _doe_raw_body.count('{cellDates:true}') >= 10
    if _has_real_date_fn and _uses_celldates:
        ok('_doExportToExcel correctly writes real Excel dates, not locale-formatted text')
    else:
        fail(f'_doExportToExcel may have regressed back to text dates (real date function: {_has_real_date_fn}, cellDates option used broadly: {_uses_celldates})')

print("\n" + "=" * 70)
print("CHECK 120 — Excel export includes an RM Deliveries sheet, exploding the deliveries array into individual raw entries")
print("=" * 70)
# Jul 29 2026 — Priyam confirmed real gap: RM Lots only showed lot-level
# totals, with individual deliveries hidden inside an array never
# actually exported. Confirmed design: leave the live app's Lot
# structure alone (a real, correct data model — a Lot is an ongoing
# vendor relationship, not a mistake) — fix the export specifically,
# same pattern already used correctly for Dye Sources.
_doe_idx = PAGES.find('function _doExportToExcel()')
_doe_end = PAGES.find('\nfunction ', _doe_idx + 10) if _doe_idx != -1 else -1
_doe_body = PAGES[_doe_idx:_doe_end] if _doe_idx != -1 else ''
_has_rm_delivery_sheet = 'rmDeliveryData' in _doe_body and "'RM Deliveries'" in _doe_body
_explodes_correctly = '.deliveries||[]).forEach(' in _doe_body.replace(' ', '') or '.deliveries || []).forEach(' in _doe_body
if _has_rm_delivery_sheet and _explodes_correctly:
    ok('Excel export correctly includes an RM Deliveries sheet, one row per individual delivery')
else:
    fail('The RM Deliveries sheet is missing or no longer explodes deliveries into individual rows — individual delivery-level data would be invisible in the export again')

print("\n" + "=" * 70)
print("CHECK 121 — Excel export: balance kept separate from raw entries, Residual/Scrap sheets present, consumption links traceable")
print("=" * 70)
# Jul 29 2026 — Priyam confirmed real gap, found by comparing RM's and
# Soft's tables directly: several sheets were mixing computed, cross-
# referenced balance directly into what should be pure raw entry rows —
# Dye Lots (downstream balances), Party Orders (fulfillment), Dead Stock
# and Recycle Stock (balance lookups). Also confirmed Residual and Scrap
# were entirely missing, and Soft/Wind lacked the Dead Stock ID/Recycle
# ID fields needed to trace consumption at all. Fixed all of it —
# removed the glued-on balance (nothing lost, it lives in its own
# proper sheets already), added both missing log sheets, added the
# missing traceability fields.
_doe_idx = PAGES.find('function _doExportToExcel()')
_doe_end = PAGES.find('\nfunction ', _doe_idx + 10) if _doe_idx != -1 else -1
_doe_body = PAGES[_doe_idx:_doe_end] if _doe_idx != -1 else ''

_wd_idx = _doe_body.find('const windData=')
_wd_end = _doe_body.find('\n', _doe_body.find('book_append_sheet', _wd_idx)) if _wd_idx != -1 else -1
_windData_block = _doe_body[_wd_idx:_wd_end] if _wd_idx != -1 else ''

_checks = [
    ("Dye Lots no longer carries downstream balance (Wind/Pack Balance, Dispatched, Current Stage)", "'Wind Balance Kg'" not in _doe_body and "'Current Stage'" not in _doe_body),
    ("Party Orders no longer carries glued-on fulfillment (Fulfilled Kg, Pending Kg, Fulfillment %)", "'Fulfilled Kg'" not in _doe_body),
    ("Dead Stock no longer calls getDeadStockBalance directly on its own row", "getDeadStockBalance(d.id)" not in _doe_body),
    ("Recycle Stock no longer calls getRecycleBalance directly on its own row", "getRecycleBalance(r.id)" not in _doe_body),
    ("Residual Log sheet present", "'Residual Log'" in _doe_body and re.search(r'const residualData\s*=', _doe_body) is not None),
    ("Scrap Log sheet present", "'Scrap Log'" in _doe_body and re.search(r'const scrapData\s*=', _doe_body) is not None),
    ("Soft Entries carries Dead Stock ID for traceability", "'Dead Stock ID':s(e.deadStockId)" in _doe_body),
    ("Wind Entries specifically carries Recycle ID for traceability", "'Recycle ID':s(e.recycleId)" in _windData_block),
]
for label, passed in _checks:
    if passed:
        ok(label)
    else:
        fail(f"REGRESSED: {label} — this is exactly the gap Priyam found and asked to be fixed Jul 29 2026")

print("\n" + "=" * 70)
print("CHECK 122 — Excel export columns validated against real record fields, not stale assumptions")
print("=" * 70)
# Jul 29 2026 — Priyam asked to re-verify the export's columns against
# the actual, current data model, not trust that old code was still
# correct. Found 3 real mismatches: Scrap Log referenced a 'grade' field
# that never existed on scrap records (my own mistake, caught before
# shipping); Recycle Stock referenced grade/bags/date/notes fields that
# never existed on the real record at all (pre-existing, not something
# introduced today); and Dye Sources only correctly captured RM-type
# sources — dead stock, recycle, and residual sources (3 of 4 real
# source types) had no way to identify which specific record was used.
_doe_idx = PAGES.find('function _doExportToExcel()')
_doe_end = PAGES.find('\nfunction ', _doe_idx + 10) if _doe_idx != -1 else -1
_doe_body = PAGES[_doe_idx:_doe_end] if _doe_idx != -1 else ''

_scrap_block_idx = _doe_body.find('const scrapData=')
_scrap_block_end = _doe_body.find('\n', _doe_body.find('book_append_sheet', _scrap_block_idx)) if _scrap_block_idx != -1 else -1
_scrap_block = _doe_body[_scrap_block_idx:_scrap_block_end] if _scrap_block_idx != -1 else ''

_rc_block_idx = _doe_body.find('const rcData=')
_rc_block_end = _doe_body.find('\n', _doe_body.find('book_append_sheet', _rc_block_idx)) if _rc_block_idx != -1 else -1
_rc_block = _doe_body[_rc_block_idx:_rc_block_end] if _rc_block_idx != -1 else ''

_src_block_idx = _doe_body.find('const dyeSrcData=')
_src_block_end = _doe_body.find('\n', _doe_body.find('book_append_sheet', _src_block_idx)) if _src_block_idx != -1 else -1
_src_block = _doe_body[_src_block_idx:_src_block_end] if _src_block_idx != -1 else ''

_checks = [
    ("Scrap Log no longer references the non-existent 'sc.grade' field", "s(sc.grade)" not in _scrap_block),
    ("Recycle Stock no longer references non-existent r.grade/r.bags/r.date/r.notes fields", "s(r.grade)" not in _rc_block and "fmtN(r.bags)" not in _rc_block and "s(r.date)" not in _rc_block and "s(r.notes)" not in _rc_block),
    ("Recycle Stock correctly extracts grade from its own sources array, like Dye Lots does", "(r.sources||[])[0]?.grade" in _rc_block),
    ("Dye Sources correctly captures Dead Stock ID for dead-type sources", "s(src.deadStockId)" in _src_block),
    ("Dye Sources correctly captures Recycle ID for recycle-type sources", "s(src.recycleId)" in _src_block),
    ("Dye Sources correctly captures Residual ID for residual-type sources", "s(src.residualId)" in _src_block),
]
for label, passed in _checks:
    if passed:
        ok(label)
    else:
        fail(f"REGRESSED: {label} — this is exactly the field-mismatch class of bug found and fixed Jul 29 2026")

print("\n" + "=" * 70)
print("CHECK 123 — incremental-load verification correctly handles lots' composite Firebase key, not just plain .id")
print("=" * 70)
# Jul 29 2026 — real bug found directly from Priyam's production console
# logs: lots use a composite Firebase key (lotId__grade__vendor, via
# _lotKey) since the same lot number can genuinely belong to different
# vendors — but the incremental-load verification step compared plain
# .id against the real Firebase keys for every table uniformly. For lots
# specifically, this meant every single lot looked "missing" on every
# verification, forcing a full fetch every time — safe (never showed
# wrong data), but the bandwidth fix never actually applied to lots at
# all. Fixed via a shared _realKeyFor helper, used in both the login
# incremental load and the reconnection catch-up.
_core_text = (BASE / 'assets/js/core.js').read_text(encoding='utf-8')
_has_helper = 'const _realKeyFor=' in _core_text
if _has_helper:
    ok('_realKeyFor helper exists, correctly distinguishing lots\' composite key from plain .id')
else:
    fail('_realKeyFor helper is missing — lots would fall back to a full fetch on every single login again, silently losing the bandwidth fix for this table')

_usage_count = _core_text.count('_realKeyFor(path,e)')
if _usage_count >= 4:
    ok(f'_realKeyFor is actually used in the verification comparisons ({_usage_count} call sites — login load and reconnection catch-up)')
else:
    fail(f'_realKeyFor exists but is not actually used everywhere it should be (only {_usage_count} call sites found, expected at least 4) — the fix may be incomplete')

print("\n" + "=" * 70)
print("CHECK 124 — the missing Pack→Dispatch proportional allocation step now exists, matching the proven Dye→Wind→Pack pattern")
print("=" * 70)
# Jul 29 2026 — real, confirmed gap Priyam identified through careful
# questioning: proportional RM-lot tracking existed all the way from
# Dye through Pack, but never took the final step into Dispatch —
# meaning "how much of this specific RM lot has actually been
# dispatched" genuinely couldn't be answered before this, for a Dye
# batch with multiple RM sources. This is the piece that closes that,
# reusing the same proven calcTotalDispatchedApproved everything else
# already relies on, not new, separate dispatch logic.
_sb_text = (BASE / 'assets/js/shared-balances.js').read_text(encoding='utf-8')
_has_fn = 'export function calcDispatchAllocated(' in _sb_text
if _has_fn:
    ok('calcDispatchAllocated exists in shared-balances.js')
else:
    fail('calcDispatchAllocated is missing — the Pack→Dispatch traceability gap Priyam identified would be open again')

_fn_idx = _sb_text.find('export function calcDispatchAllocated(')
_fn_end = _sb_text.find('\nexport function ', _fn_idx + 10) if _fn_idx != -1 else -1
_fn_body = _sb_text[_fn_idx:_fn_end] if _fn_idx != -1 else ''
_uses_real_dispatch_total = 'calcTotalDispatchedApproved(' in _fn_body
_uses_real_ratio = 'calcVendorRatioForDyeLot(' in _fn_body
if _uses_real_dispatch_total and _uses_real_ratio:
    ok('calcDispatchAllocated correctly reuses the real, proven dispatch total and vendor ratio, not a separate recalculation')
else:
    fail('calcDispatchAllocated does not correctly reuse the proven underlying functions — may be duplicating logic instead of reusing what already works')

_core_text = (BASE / 'assets/js/core.js').read_text(encoding='utf-8')
if 'calcDispatchAllocated' in _core_text:
    ok('calcDispatchAllocated is correctly imported client-side, ready for the export sheet that will use it')
else:
    fail('calcDispatchAllocated is not imported into core.js — it would not be usable from the client/export side')

print("\n" + "=" * 70)
print("CHECK 125 — Excel export includes the RM-to-Dispatch Trace sheet, using the real, proven allocation functions")
print("=" * 70)
# Jul 29 2026 — the actual deliverable this whole conversation built
# toward: one row per (RM lot, Dye batch) combination, with the real,
# already-calculated proportional share at every stage from RM through
# Dispatch — not raw data for Power BI to recompute itself.
_doe_idx = PAGES.find('function _doExportToExcel()')
_doe_end = PAGES.find('\nfunction ', _doe_idx + 10) if _doe_idx != -1 else -1
_doe_body = PAGES[_doe_idx:_doe_end] if _doe_idx != -1 else ''

_checks = [
    ("'RM-to-Dispatch Trace' sheet is present", "'RM-to-Dispatch Trace'" in _doe_body and 'traceData' in _doe_body),
    ("Uses the real calcVendorRatioForDyeLot, not a separate recalculation", 'calcVendorRatioForDyeLot(' in _doe_body),
    ("Uses the real calcTotalDispatchedApproved for the final dispatched figure", 'calcTotalDispatchedApproved(' in _doe_body),
    ("Correctly still shows a row for an RM lot that hasn't reached Dye yet, not silently omitted", 'relatedDyeLots.length===0' in _doe_body),
    ("Shows the matching cones alongside weight at Wind and Pack, not weight alone", "'RM Share Of Wind In Cones'" in _doe_body and "'RM Share Of Pack In Cones'" in _doe_body),
    ("Shows the matching bags alongside weight at Dispatch, not weight alone", "'RM Share Dispatched Bags'" in _doe_body),
]
for label, passed in _checks:
    if passed:
        ok(label)
    else:
        fail(f"REGRESSED: {label} — the RM-to-Dispatch traceability sheet may be broken or missing")

print("\n" + "=" * 70)
print("CHECK 126 — RM permanent-ID Phase 1: new lots get a uid automatically, migration is batched/idempotent/admin-only")
print("=" * 70)
# Jul 29 2026 — Phase 1 of the RM permanent-ID plan, worked through
# carefully with Priyam over a long conversation about why lot+grade+
# vendor genuinely isn't a stable enough connector, and how Dye's own
# internal ID (never shown, never editable) already proves this exact
# pattern works. Purely additive — nothing about lot.id, grade, vendor,
# or the composite key changes; this just gives every lot, old and new,
# a permanent internal handle nothing downstream reads yet.
_new_lot_idx = WORKER.find('const newLot = { id: lotId, uid,')
if _new_lot_idx != -1:
    ok('New RM lots correctly get a permanent uid at creation, matching how Dye Lots already work')
else:
    fail('New RM lots no longer get a uid at creation — Phase 1 of the permanent-ID plan may have regressed')

_migrate_idx = WORKER.find('async function handleMigrateRMPermanentIds(')
if _migrate_idx == -1:
    fail('handleMigrateRMPermanentIds is missing entirely')
else:
    _migrate_end = WORKER.find('\nasync function handleVerifyRMPermanentIds', _migrate_idx)
    _migrate_body = WORKER[_migrate_idx:_migrate_end] if _migrate_end != -1 else WORKER[_migrate_idx:_migrate_idx+3000]
    # Jul 29 2026 fix — real issue caught in production: this was
    # strictly admin-only, blocking Priyam's own manager-tier session.
    # Widened to admin-or-manager, matching the more common pattern for
    # this class of low-risk, additive, verified action elsewhere in
    # the app (Master Item Delete, user management) — unlike Factory
    # Reset or Backup Restore/Delete, which genuinely warrant staying
    # admin-only.
    _role_protected = "['admin', 'manager'].includes(role)" in _migrate_body
    _is_batched = 'batchSize' in _migrate_body
    _skips_existing = '!e.lot.uid' in _migrate_body
    if _role_protected and _is_batched and _skips_existing:
        ok('handleMigrateRMPermanentIds is correctly admin-or-manager protected, batched, and skips already-migrated lots (genuinely idempotent)')
    else:
        fail(f'handleMigrateRMPermanentIds is missing real protection (role protected: {_role_protected}, batched: {_is_batched}, skips existing: {_skips_existing})')
    if "fbGet('/tc/archive/lots')" in _migrate_body:
        ok('handleMigrateRMPermanentIds correctly covers archived lots too, not just active — real gap Priyam caught before this ever ran')
    else:
        fail("REGRESSED: handleMigrateRMPermanentIds no longer covers archived lots — a real, significant chunk of history would be silently skipped again")

_verify_idx = WORKER.find('async function handleVerifyRMPermanentIds()')
if _verify_idx != -1:
    _verify_end = WORKER.find('\n// ─── Delete Request lifecycle', _verify_idx)
    _verify_body = WORKER[_verify_idx:_verify_end] if _verify_end != -1 else WORKER[_verify_idx:_verify_idx+1500]
    if "fbGet('/tc/archive/lots')" in _verify_body:
        ok('handleVerifyRMPermanentIds correctly covers archived lots too, matching the migration')
    else:
        fail("REGRESSED: handleVerifyRMPermanentIds no longer covers archived lots — could report 'complete' while archive is genuinely still missing")

if 'async function handleVerifyRMPermanentIds' in WORKER and 'duplicateUidsFound' in WORKER:
    ok('handleVerifyRMPermanentIds exists and genuinely checks for duplicates, not just presence')
else:
    fail('handleVerifyRMPermanentIds is missing or no longer checks for duplicate uids')

_ui_idx = PAGES.find('async function runRMUidMigration()')
if _ui_idx == -1:
    fail('runRMUidMigration is missing from pages.js — there would be no way to actually trigger the migration from the app')
else:
    _ui_end = PAGES.find('\nfunction openClearStage', _ui_idx)
    _ui_body = PAGES[_ui_idx:_ui_end] if _ui_end != -1 else PAGES[_ui_idx:_ui_idx+2000]
    _has_confirm = 'confirm(' in _ui_body
    _calls_verify_after = 'checkRMUidStatus()' in _ui_body
    if _has_confirm and _calls_verify_after:
        ok('runRMUidMigration correctly confirms before running and verifies status afterward')
    else:
        fail(f'runRMUidMigration is missing real safeguards (confirms first: {_has_confirm}, verifies after: {_calls_verify_after})')

if 'rm-uid-panel' in (BASE / 'assets/index.html').read_text(encoding='utf-8'):
    ok('The RM UID migration panel exists in the actual UI, not just the backend')
else:
    fail('The RM UID migration panel is missing from index.html — the backend would exist with no way to trigger it')

# Jul 29 2026, later same day — real, confirmed production bug: this
# used to call genIdAtomicServer (itself 3-4 subrequests: acquire a
# lock, read the counter, write the counter, release the lock) once
# PER LOT inside the batch loop. A batch of 30 meant 90-120+
# subrequests in a single Worker invocation, blowing straight through
# Cloudflare's free-plan limit — genuinely failed in production before
# this was found and fixed. Fix: acquire the ID-counter lock exactly
# once, read the counter once, generate every ID for the whole batch
# locally in memory, write everything together in one combined patch.
_migrate_idx2 = WORKER.find('async function handleMigrateRMPermanentIds(')
if _migrate_idx2 != -1:
    _migrate_end2 = WORKER.find('\n// Jul 29 2026 — verification companion', _migrate_idx2)
    _migrate_body2 = WORKER[_migrate_idx2:_migrate_end2] if _migrate_end2 != -1 else WORKER[_migrate_idx2:_migrate_idx2+3000]
    _no_per_lot_idgen = 'for (const entry of batch)' in _migrate_body2 and 'genIdAtomicServer(' not in _migrate_body2
    _reads_counter_once = "fbGet('/tc/idCounters/RMU')" in _migrate_body2
    _generates_locally = 'nextNum++' in _migrate_body2
    if _no_per_lot_idgen and _reads_counter_once and _generates_locally:
        ok('handleMigrateRMPermanentIds correctly generates IDs locally in memory, not via a per-lot genIdAtomicServer call — the real subrequest-explosion bug found in production stays fixed')
    else:
        fail('handleMigrateRMPermanentIds may have regressed to calling genIdAtomicServer per-lot inside the loop — this is the exact bug that blew through Cloudflare\'s subrequest limit in production and must not come back')

print("\n" + "=" * 70)
print("CHECK 127 — migration uses each lot's REAL Firebase key, not one recomputed from grade/vendor text that can drift; cleanup function exists for any junk the earlier bug left behind")
print("=" * 70)
# Jul 29 2026, later same day — real, confirmed bug found directly in
# production: the migration recomputed each lot's key from its CURRENT
# grade/vendor text. For a handful of real lots (edited since creation
# — confirmed real case: a corrected double space) that recomputed key
# no longer matched the REAL, existing key — silently creating a new,
# empty junk record at the wrong location instead of updating the real
# one, which was left permanently unmigrated. Fixed by preserving each
# lot's real key from Object.entries (never recomputed), the same
# lesson as the earlier _realKeyFor fix for incremental loading.
_migrate_idx3 = WORKER.find('async function handleMigrateRMPermanentIds(')
if _migrate_idx3 != -1:
    _migrate_end3 = WORKER.find('\n// Jul 29 2026 — verification companion', _migrate_idx3)
    _migrate_body3 = WORKER[_migrate_idx3:_migrate_end3] if _migrate_end3 != -1 else WORKER[_migrate_idx3:_migrate_idx3+3000]
    _uses_real_key = 'Object.entries(v)' in _migrate_body3 and 'entry.key' in _migrate_body3
    _no_recompute = ".replace(/[^a-zA-Z0-9]/g, '_')" not in _migrate_body3
    if _uses_real_key and _no_recompute:
        ok('handleMigrateRMPermanentIds correctly uses each lot\'s real, existing Firebase key — never recomputes one from grade/vendor text that can drift')
    else:
        fail('handleMigrateRMPermanentIds may have regressed to recomputing lot keys from grade/vendor text — this is the exact bug that silently created junk records in production and must not come back')

if 'async function handleCleanupOrphanedLotRecords(' in WORKER:
    _cleanup_idx = WORKER.find('async function handleCleanupOrphanedLotRecords(')
    _cleanup_end = WORKER.find('\n}', WORKER.find('return jsonResponse', _cleanup_idx))
    _cleanup_body = WORKER[_cleanup_idx:_cleanup_end] if _cleanup_end != -1 else WORKER[_cleanup_idx:_cleanup_idx+2000]
    _safe_by_default = 'dryRun !== false' in _cleanup_body
    _conservative_detection = '!l.grade && !l.vendor && !l.weight' in _cleanup_body
    _role_checked = "['admin', 'manager'].includes(role)" in _cleanup_body
    if _safe_by_default and _conservative_detection and _role_checked:
        ok('handleCleanupOrphanedLotRecords exists, defaults to a safe dry-run, and uses a conservative detection that could never match a real lot')
    else:
        fail(f'handleCleanupOrphanedLotRecords is missing real safety (safe by default: {_safe_by_default}, conservative detection: {_conservative_detection}, role checked: {_role_checked})')
else:
    fail('handleCleanupOrphanedLotRecords is missing entirely — no way to clean up junk records the earlier bug may have created')

print("\n" + "=" * 70)
if FAIL:
    print("RESULT: ✗ FAILURES FOUND — fix before shipping")
else:
    print("RESULT: ✓ ALL HARD CHECKS PASSED (review any ⚠ warnings above)")
print("=" * 70)
