# IMPLEMENTATION_ROADMAP

> Status 2026-11-20: phases 1–6 done in code; phase 7 (deploy/APK) runs through GitHub Actions + DEPLOYMENT_GUIDE; scope changed to **master data only** and **week starts Sunday** by the owner.

## 0. Needed from you before Phase 3

| # | Item | Why |
|---|---|---|
| 1 | Export of the **deployed** Apps Script project (all files) | Supplied Code.gs is not what wrote the live sheet (PROJECT_AUDIT §3) |
| 2 | Answers to the 5 business questions in CURRENT_FEATURES §3 + what "Fire Search" is | No rule will be invented |
| 3 | A new Supabase project (free tier is fine) — share only the **Project URL** and **anon key** | Service-role key never leaves Supabase; migrations are run by you or by CI with a secret |
| 4 | GitHub: account to use and repo name (proposed private `talabat-fire-safety`) | I cannot push from this environment; you upload, or CI does it |
| 5 | Login style for users: email, or username mapped to an internal email | Supabase Auth needs one |
| 6 | Confirm technician names (`bassem`/`Yassem`, `samir`/`Sameer`) and the 3 orphan issues | Migration report |

## 1. Target architecture

```
React 18 + TypeScript + Vite + Tailwind + React Router + React Hook Form + Zod + TanStack Query
   ├─ i18n (ar RTL / en LTR), light + dark themes, glass design system
   ├─ PWA: manifest + service worker (Workbox), offline drafts in IndexedDB (no tokens stored there)
   └─ Capacitor 6 → Android (APK + AAB built in GitHub Actions), iOS project prepared
                │ supabase-js (anon key + user JWT only)
Supabase
   ├─ Auth (password, session refresh, admin-created users)
   ├─ Postgres + RLS on every table, CHECK/FK/UNIQUE constraints
   ├─ RPCs (SECURITY DEFINER): submit_inspection, set_store_equipment, update_issue, override_duplicate
   ├─ Edge Functions: admin_create_user / reset_password (service role stays server-side), export_csv
   └─ Storage (only if inspection photos are wanted)
Hosting: Cloudflare Pages (same as your other projects) · CI: GitHub Actions
```

Why this split: all business validation (sum rules, duplicate week, assigned-store check, issue generation) moves into **one** `submit_inspection` RPC so web, PWA, offline sync and APK cannot bypass it.

## 2. Phases

| Phase | Output | Gate |
|---|---|---|
| 1 Discovery ✅ | 5 audit docs (this folder) | — |
| 2 Architecture + design ⏳ | This roadmap, schema proposal, clickable design preview (desktop + mobile) | **Your approval of design + answers in §0** |
| 3 Database | `supabase/migrations/*.sql`, RLS, RPCs, triggers, seed for zones only; RLS test script with 3 roles | Tests pass on your Supabase project |
| 4 Data migration | `scripts/migrate_from_xlsx.py` (dry-run default), `MIGRATION_REPORT.md` with counts & anomalies | **Your approval before import** |
| 5 Application | All screens in CURRENT_FEATURES rebuilt + issue workflow + real trend charts | Feature checklist |
| 6 QA & security | Vitest unit, Playwright e2e at 375/390/768/1024/1440 px (incl. iPhone Safari WebKit), RLS attack tests | All critical/high fixed |
| 7 Deploy & package | Cloudflare Pages site, GitHub Actions APK/AAB artifacts, PWA install on iPhone | Verified APK installs |
| 8 Handover | README, ARCHITECTURE, DEPLOYMENT_GUIDE, MOBILE_BUILD_GUIDE, TEST_REPORT, CHANGELOG | — |

## 3. Bug fixes mapped to phases
F1–F4, F9, F11 → Phase 3 (`submit_inspection` derives statuses and creates issues server-side) · F5 → Phase 5 issue workflow · F6–F8, F14, F16 → Phase 5 dashboard from SQL views · F10, F13 → schema · F12, F17 → gone with Sheets · S1–S15 → Phases 3 & 6.

## 4. Offline sync design
Draft saved per store in IndexedDB with a `client_id` UUID → queued → `submit_inspection(client_id, …)`; server returns existing row if `client_id` already exists (idempotent); duplicate-week and validation errors are shown to the technician and the draft is kept, never silently dropped.

## 5. What cannot be done from this chat environment (honest limits)
- No GitHub credentials here → I deliver a ready repo zip + exact upload commands; CI then builds everything.
- No Android SDK here → the **APK is built by GitHub Actions** (Ubuntu runner with Android SDK) and attached to a Release; I will not claim an APK exists until that run succeeds and you install it.
- iOS IPA needs a Mac with Xcode and an Apple developer account → iPhone gets the installable PWA.
- I cannot reach your Supabase project → migrations are applied by you (SQL editor) or by CI with a secret you add.
