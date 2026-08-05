<div align="center">

# 🧵 ThreadControl v2

**Textile Production ERP — Built for the Factory Floor**

Track every gram of yarn from raw material to customer dispatch.

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

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| ⚙️ Backend | Cloudflare Workers (edge, serverless, ~8,000 lines) |
| 🗃️ Database | Firebase Realtime Database |
| 💾 Storage | Cloudflare R2 (daily backups) |
| 🖥️ Frontend | Vanilla JS + HTML + CSS (no framework) |
| 📦 Deploy | Wrangler CLI |

---

## 📁 Project Structure

```
ThreadControl/
│
├── 📄 worker.js                  # Cloudflare Worker — entire backend
├── ⚙️  wrangler.toml              # Cloudflare deploy config (prod + staging)
├── 🔒 firebase-rules.json        # Firebase security rules
├── 🧪 tc_predeploy_check.py      # 99+ automated pre-deploy checks
├── 🖥️  tc_smoke_test.js           # Playwright end-to-end browser test
│
└── 📂 assets/
    ├── 🌐 index.html             # SPA shell + all modal HTML
    ├── 🎨 style.css              # Design system (dark/light theme)
    ├── ⚡ sw.js                  # Service Worker (PWA / offline)
    └── 📂 js/
        ├── core.js               # Firebase init, State, data loading
        ├── pages.js              # All UI rendering and page logic
        └── shared-balances.js    # Single source of truth for balance math
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

- All API calls require a signed Bearer session token (issued on login, verified server-side)
- `/tc/users` is blocked from all client reads by Firebase rules — only the Worker can access it via admin secret
- Firebase API keys in `core.js` are **public by design** (standard Firebase web SDK pattern) — real security is enforced by Firebase Rules
- The Firebase Database Secret is loaded from Cloudflare environment secrets at runtime — never hardcoded in source

---

## 📄 License

Private project. All rights reserved.
