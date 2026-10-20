<div align="center">

# 🧵 ThreadControl

**Textile Production ERP — Built for the Factory Floor**

Track every gram of yarn from raw material to customer dispatch.

> 🔒 **Deployment Note:** Live environments (production and staging) are private client systems and are not publicly accessible.

![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)
![Firebase](https://img.shields.io/badge/Firebase-Realtime_DB-FFCA28?style=for-the-badge&logo=firebase&logoColor=black)
![JavaScript](https://img.shields.io/badge/JavaScript-Vanilla_JS-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![PWA](https://img.shields.io/badge/PWA-Installable-5A0FC8?style=for-the-badge&logo=pwa&logoColor=white)

</div>

---

## 🏭 What It Does

ThreadControl tracks every stage of yarn/thread production with **live balance calculations**, supervisor approval workflows, and a full audit trail.

### Production Pipeline

```
📦 Raw Material  →  💧 Softening  →  🎨 Dyeing  →  🧵 Winding  →  📦 Packing  →  🚚 Dispatch
```

At every stage — weight, cones, and bags are logged, approved, and reflected instantly in running balances. Managers always know exactly where material is, how much is left, and when a lot is fully done.

---

## ✨ Key Features

| Feature | Description |
|---|---|
| 📊 **Live Balances** | Real-time balance at every stage for every lot |
| ✅ **Approval Workflow** | Every entry needs supervisor sign-off before affecting stock |
| 🔐 **Role-Based Access** | Worker / Supervisor / Admin with distinct permissions |
| 📝 **Full Audit Trail** | Every edit and void logged with reason, timestamp, and who did it |
| 🗄️ **Auto-Archival** | Fully dispatched lots auto-move to archive, keeping active data fast |
| 🔒 **Race Protection** | ETag-based balance locks prevent simultaneous double-submissions |
| ⚡ **Idempotency Guard** | Duplicate submission protection on every write |
| 📶 **Incremental Loading** | Only fetches changed records on refresh — not the full dataset |
| 📱 **PWA** | Installable on mobile, offline-capable |
| 🌐 **Dual Environments** | Prod + staging auto-detected from hostname, zero shared data |
| 💾 **Daily Backups** | Automatic daily snapshots to Cloudflare R2 |
| 📈 **Analytics & Reports** | Throughput trends, machine/worker performance, grade analysis |
| 🚩 **Flag System** | Manual + automatic flags per lot/entry — auto-clears when risk resolves |
| 🔁 **Reassign Source** | Move partial amounts between dye lot sources with live balance preview |
| ↩️ **Undo** | Undo any edit or reassign — with downstream impact check before proceeding |
| 🧩 **Dye Split** | Split a dye lot into good/recycle portions with downstream safety warnings |
| 🛡️ **Login Rate Limiter** | Escalating lockouts, role-based strictness, Turnstile CAPTCHA, 30-day memory |
| 🍪 **HttpOnly Session Token** | Session token stored in HttpOnly cookie — never readable by JavaScript |
| 🔗 **CORS Hardened** | Requests accepted only from the app's own two real domains |
| 🔎 **Masters Integrity Scan** | Detects values used in real records but missing from Masters — with one-click restore |

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| ⚙️ Backend | Cloudflare Workers (edge, serverless) |
| 🗃️ Database | Firebase Realtime Database |
| 💾 Storage | Cloudflare R2 (daily backups) |
| 🖥️ Frontend | Vanilla JS + HTML + CSS (no framework, modular ES modules) |
| 📦 Deploy | Wrangler CLI |

---

## 📁 Project Structure

```
ThreadControl/
│
├── 📄 worker.js                  # Cloudflare Worker — entire backend
├── ⚙️  wrangler.toml              # Cloudflare deploy config (prod + staging)
├── 🔒 firebase-rules.json        # Firebase security rules
├── 🧪 tc_predeploy_check.py      # 666-check, 6-layer pre-deploy verification suite
├── 🖥️  tc_smoke_test.js           # Playwright end-to-end browser test
│
└── 📂 assets/
    ├── 🌐 index.html             # SPA shell + all modal HTML
    ├── 🎨 style.css              # Design system (dark/light theme)
    ├── ⚡ sw.js                  # Service Worker (PWA / offline)
    └── 📂 js/
        ├── core.js               # Firebase init, State, data loading, balance accessors
        ├── shared-balances.js    # Single source of truth for all balance math
        ├── shared.js             # Shared UI utilities used across page modules
        ├── smart-loader.js       # Incremental + layered data loading strategy
        ├── summary-loader.js     # Pre-computed summary fetching and caching
        ├── idb-storage.js        # IndexedDB persistence layer
        ├── pages.js              # Top-level page router
        │
        ├── dashboard.js          # Live KPIs, alerts, pending approvals
        ├── rm.js                 # Raw Material intake and lot management
        ├── soft.js               # Softening stage entries
        ├── dye.js                # Dye lot management (multi-source, split, recycle)
        ├── wind.js               # Winding entries
        ├── pack.js               # Packing entries
        ├── dispatch.js           # Dispatch (single + multi-lot)
        ├── stock.js              # Live stock view across all stages
        ├── approval.js           # Supervisor approval queue
        ├── wip.js                # Work In Progress tracker
        ├── stockregister.js      # Ledger-style running totals
        ├── lifecycle.js          # Full RM lot lifecycle trace
        ├── dyelifecycle.js       # Dye lot lifecycle trace
        ├── analytics.js          # Charts and throughput analytics
        ├── reports.js            # Tabular reports (waste, grade, pack)
        ├── challan.js            # Challan lookup and generation
        ├── party.js              # Customer/party tracker
        ├── vendor.js             # Vendor balance summary
        ├── editlog.js            # Audit trail of all edits and voids
        ├── search.js             # Global search across all stages
        ├── masters.js            # Admin: grades, vendors, mills, machines, workers
        ├── users.js              # Admin: user accounts and roles
        ├── recyclesoft.js        # Residual/Scrap transfer management
        ├── admin-tools.js        # Admin utilities and system tools
        ├── worker-view.js        # Worker-facing simplified view
        └── backup-export.js      # Manual backup trigger + Excel/Power BI export
```

---

## 🗄️ Database Schema (Firebase)

All data lives under `/tc/` in Firebase Realtime Database.

**Core tables:**
- `lots` — Raw material lots *(key: `lotId__grade__vendor`)*
- `stageEntries` — Softening entries
- `dyeLots` — Dye lot records *(supports multi-source RM mixing)*
- `windEntries` — Winding entries
- `packEntries` — Packing entries
- `dispatches` — Dispatch records

**Log tables:**
- `residualLog` — Residual/Scrap transfers out of Soft balance
- `rmReturnLog` — RM returned to vendor
- `voidLog` / `editLog` — Full audit trail
- `lotFlags` / `dyeLotFlags` / `entryFlags` — Flag system per stage

**Archive:** `/tc/archive/...` — fully dispatched lots move here automatically.

**Pre-computed summaries:** `lotSummaries`, `dyeLotSummaries`, `partySummaries` — kept fresh by the Worker after every approval.

---

## 🌍 Environments

| | 🟢 Production | 🟡 Staging |
|---|---|---|
| Worker | `cold-breeze-bb3e` | `stagingthread` |
| Firebase | `threadcontrolproduction-2` | `stagingthread` |
| Deploy | `wrangler deploy` | `wrangler deploy --env staging` |

Auto-detected from hostname — no manual config swap needed.

---

## 🚀 Setup (Self-Hosted)

### 1️⃣ Firebase
- Create a Firebase project → enable Realtime Database
- Publish `firebase-rules.json` to your database rules (Firebase Console → Rules → Publish)
- Generate a Database Secret (Project Settings → Service Accounts → Database Secrets)

### 2️⃣ Cloudflare
- Create a Cloudflare Workers account
- Install Wrangler: `npm install -g wrangler`
- Update `wrangler.toml` with your worker name + R2 bucket
- Set secrets:
```bash
wrangler secret put FIREBASE_DB_SECRET
wrangler secret put API_SECRET
wrangler secret put EXPORT_API_KEY
```

### 3️⃣ Firebase Config
Replace the Firebase config objects at the top of `assets/js/core.js` with your own project config (Firebase Console → Project Settings → Your Apps).

### 4️⃣ Deploy
```bash
wrangler deploy
```
> ⚠️ Firebase rules must be published separately in Firebase Console — `wrangler deploy` does not touch them.

---

## 📋 Deploy Checklist

Every deploy needs **two separate steps:**

- [ ] `wrangler deploy` → pushes Worker + static assets to Cloudflare
- [ ] Firebase Console → Realtime Database → Rules → **Publish** → deploys security rules

Neither step triggers the other.

---

## 🔐 Security

- All API calls require a signed Bearer session token stored in an **HttpOnly cookie** — JavaScript cannot read it
- Login protected by **Turnstile CAPTCHA** and **escalating rate limiting** (role-based strictness, 30-day memory)
- **CORS** restricted to the app's two real domains only — no cross-origin requests accepted
- `/tc/users` is blocked from all client reads by Firebase rules — only the Worker can access it via admin secret
- Firebase API keys in `core.js` are **public by design** (standard Firebase web SDK pattern) — real security is enforced by Firebase Rules
- The Firebase Database Secret is loaded from Cloudflare environment secrets at runtime — never hardcoded in source

---

## 🧪 Quality & Verification

`tc_predeploy_check.py` runs a **6-layer, 666-check** verification suite before every deploy:

| Layer | What it checks |
|---|---|
| 1 | Static pattern checks across all JS files |
| 2 | Function presence in correct module files |
| 3 | AST-level syntax and structure validation |
| 4 | Balance formula correctness with test numbers |
| 5 | Randomised scenario generation (hundreds per law) |
| 6 | Client vs Worker cross-check on balance results |

`tc_smoke_test.js` (Playwright) clicks through the real deployed app — login, every major page, all key workflows — against a real staging environment.

---

## 📄 License

Code shared for portfolio purposes. Live production systems and client data remain private and confidential.
