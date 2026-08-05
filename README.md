# 🧵 ThreadControl v2

**Textile Production ERP** — tracks raw material through the full manufacturing pipeline, from raw material intake to customer dispatch.

Built for a real textile yarn factory. Production-grade, running live on Cloudflare Workers + Firebase Realtime Database.

---

## What It Does

ThreadControl tracks every stage of yarn/thread production with live balance calculations, supervisor approval workflows, and full audit trails.

**Production Pipeline:**
```
Raw Material (RM) → Softening → Dyeing → Winding → Packing → Dispatch
```

At each stage, weight, cones, and bags are recorded. The system maintains real-time running balances across the entire chain — so managers always know exactly how much material is at each stage, where wastage occurred, and when a lot is fully dispatched.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Cloudflare Workers (edge, serverless) |
| Database | Firebase Realtime Database |
| Storage | Cloudflare R2 (daily backups) |
| Frontend | Vanilla JS + HTML + CSS (no framework, PWA) |
| Deploy | Wrangler CLI |

---

## Key Features

- **6-stage pipeline tracking** — RM → Soft → Dye → Wind → Pack → Dispatch
- **Live balance calculations** — real-time balance at every stage for every lot
- **Role-based access** — Worker / Supervisor / Admin roles with different permissions
- **Approval workflow** — every entry needs supervisor sign-off before affecting balances
- **Full audit trail** — every edit and void is logged with reason, timestamp, and who did it
- **Auto-archival** — fully dispatched lots automatically move to archive, keeping active data fast
- **Concurrency protection** — ETag-based balance locks prevent race conditions on simultaneous submissions
- **Duplicate submission guard** — idempotency keys prevent accidental double-entries
- **Incremental data loading** — only fetches changed records on refresh, not the full dataset
- **PWA** — installable on mobile, works offline
- **Two environments** — production and staging, auto-detected from hostname, zero shared data

---

## Project Structure

```
ThreadControl/
├── worker.js                 # Cloudflare Worker — entire backend (~8,000 lines)
├── wrangler.toml             # Cloudflare deploy config (prod + staging)
├── firebase-rules.json       # Firebase Realtime Database security rules
├── tc_predeploy_check.py     # 99+ automated pre-deploy checks
├── tc_smoke_test.js          # Playwright end-to-end browser test
└── assets/
    ├── index.html            # SPA shell + all modal HTML
    ├── style.css             # Complete design system (dark/light theme)
    ├── sw.js                 # Service Worker (offline/PWA)
    └── js/
        ├── core.js           # Firebase init, State, data loading
        ├── pages.js          # All UI rendering and page logic
        └── shared-balances.js # Single source of truth for balance formulas
```

---

## Database Schema (Firebase)

All data lives under `/tc/` in Firebase Realtime Database.

**Core production tables:**
- `lots` — Raw material lots (key: `lotId__grade__vendor`)
- `stageEntries` — Softening entries
- `dyeLots` — Dye lot records (with multi-source RM mixing)
- `windEntries` — Winding entries
- `packEntries` — Packing entries
- `dispatches` — Dispatch records

**Archive:** Fully-dispatched lots move to `/tc/archive/...` automatically.

**Pre-computed summaries:** `lotSummaries`, `dyeLotSummaries`, `partySummaries` — updated by the Worker after every approval.

---

## Environments

| | Production | Staging |
|---|---|---|
| Worker | `cold-breeze-bb3e` | `stagingthread` |
| Firebase | `threadcontrolproduction-2` | `stagingthread` |
| Deploy | `wrangler deploy` | `wrangler deploy --env staging` |

The app **auto-detects** which environment to use based on the hostname — no manual config swap needed.

---

## Setup (Self-Hosted)

To run your own instance:

### 1. Firebase
- Create a Firebase project
- Enable Realtime Database
- Publish `firebase-rules.json` to your project's database rules
- Generate a Database Secret (Project Settings → Service Accounts → Database Secrets)

### 2. Cloudflare
- Create a Cloudflare Workers account
- Install Wrangler: `npm install -g wrangler`
- Update `wrangler.toml` with your worker name and R2 bucket name
- Set secrets:
  ```
  wrangler secret put FIREBASE_DB_SECRET
  wrangler secret put API_SECRET
  wrangler secret put EXPORT_API_KEY
  ```

### 3. Update Firebase config in `core.js`
Replace the Firebase config objects at the top of `assets/js/core.js` with your own project's config (from Firebase Console → Project Settings → Your Apps).

### 4. Deploy
```bash
wrangler deploy
```

Then publish Firebase rules manually in the Firebase Console (separate step — `wrangler deploy` does not touch Firebase rules).

---

## Deploy Checklist

Two separate steps required every time:
1. `wrangler deploy` — pushes Worker + static assets to Cloudflare
2. Firebase Console → Realtime Database → Rules → Publish — deploys security rules

Neither step triggers the other.

---

## Security Notes

- All API calls require a signed Bearer session token (issued on login, verified server-side)
- `/tc/users` (user credentials) is blocked from all client reads by Firebase rules — only the Worker can access it
- Firebase API keys in `core.js` are public by design (standard Firebase web SDK pattern) — security is enforced by Firebase rules, not by keeping the API key secret
- The Firebase Database Secret is loaded from Cloudflare environment secrets at runtime — never hardcoded

---

## License

Private project. All rights reserved.
