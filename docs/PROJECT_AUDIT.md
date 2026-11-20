# PROJECT_AUDIT — Talabat Mart Fire Safety (Pilot 2.0)

Audit date: 2026-11-20 · Phase 1 (Discovery) · No source files were modified.

## 1. What was inspected

| File | Size | Role |
|---|---|---|
| `Index (5).html` | 4,364 lines / 247 KB | Whole frontend: HTML + CSS + 154 JS functions, served by Apps Script `HtmlService` |
| `Code (2).gs` | 999 lines / 44 KB | Apps Script backend, 20 server functions over Google Sheets |
| `Fire Safety — Talabat Mart Pilot.xlsx` | 9 sheets | Pilot database export |
| Reference images/videos | 3 images, 2 reels | Design direction only (glassy dashboards, animated bottom nav) |

## 2. Architecture today

```
Browser (Index.html, vanilla JS, Chart.js 4.4.1 + Tabler icons from CDN)
   │  google.script.run  (wrapped in gasRun() promise)
   ▼
Apps Script web app — "Execute as Me / Anyone" deployment
   │  SpreadsheetApp.openById(SHEET_ID)
   ▼
Google Sheet: Users · Stores · Inspections · Issues · Audit_Log · Store_Equipment · App_Config · Weeks
```

There is no session: after `validateLogin` succeeds, the browser keeps the user object in a JS variable (`curTech`) and every later server call simply trusts IDs sent by the client.

## 3. Is the backend complete? — No, the supplied Code.gs is not the deployed version

Evidence that the live sheet was written by code that is **not** in `Code (2).gs`:

1. **Issue IDs** in the sheet look like `ISS-MVYA0QGUV6V-01` (inspection id + sequence). `Code.gs` generates `ISS-<timestamp><random>`.
2. **Issue equipment names** in the sheet are Arabic (`طفايات البودرة 6كجم`, `نظام إنذار الحريق`). The frontend creates English names (`6 KG powder`, `Fire alarm`).
3. **`Weeks` sheet** ("Auto-created on first use") — no function in Code.gs creates or reads it.
4. **No issue-update function** exists (assign / in-progress / resolve), yet the UI shows those statuses.

**Action required before claiming full migration:** export the *currently deployed* Apps Script project (all `.gs` and `.html` files, plus deployment version number). See IMPLEMENTATION_ROADMAP §0.

## 4. Severity summary

| Severity | Count | Headline |
|---|---|---|
| Critical | 6 | No server-side auth on any admin function; all data readable without login; PINs hardcoded in source and stored in plaintext; issues never reach the server; per-equipment status always saved as "issue/fault"; fake trend data on dashboard |
| High | 9 | Issue workflow not implemented; super-admin check client-only; tech portal filters by zone but server by assigned tech; dates stored as ambiguous text; KPI mismatch Arabic/English; orphan issues; 12 stores without equipment base; seed inspections shown as real; clickjacking (ALLOWALL) |
| Medium | 10+ | Denormalised names drifting, week definition ambiguous, no pagination, CDN dependencies, export unescaped, etc. |

Full lists: **SECURITY_AUDIT.md** (security) and **CURRENT_FEATURES.md §4** (functional bugs).

## 5. Data findings (pilot workbook)

| Sheet | Rows | Notes |
|---|---|---|
| Sheet1 | 0 | Empty — drop |
| Weeks | 1 | `2026-W44`, start/end stored as 2026-01-11 / 2026-07-11 → almost certainly **1 Nov / 7 Nov** mis-parsed as US dates |
| App_Config | 1 | only `dbLastCheck` |
| Users | 5 | 4 technicians + 1 admin, **plaintext PIN column (compromised — not reproduced here)** |
| Stores | 66 | all active; 18 flagged; codes unique |
| Inspections | 11 | dates are text `dd/MM/yyyy`; 0 duplicate store+week |
| Issues | 7 | **3 reference `INS-MVY9NZF472Y` which does not exist** in Inspections; all `created_date` = 2026-01-11 (= 1 Nov mis-parsed) |
| Audit_Log | 296 | 142 INIT (written on every page load), 113 LOGIN_SUCCESS, 34 SUBMIT_INSPECTION, 5 LOGIN_FAILED |
| Store_Equipment | 54 | **12 stores have no base quantities** |

Reconciliation red flags:
- Audit shows **34 SUBMIT_INSPECTION** events but only **11** inspection rows exist → 23 rows were deleted or lost. Must be explained before go-live.
- 11 inspections contain damaged/missing equipment in at least 5 stores (DS30, DS6, DS71, DS1, …) but only 2 inspections have issue rows → confirms the "issues never sent" bug.
- `DS23` inspection was submitted with all quantities 0 because the store has no equipment base → recorded as "ok".
- Technician names differ between sheets: Users says `bassem`/`samir`, Stores says `Yassem`/`Sameer`.
- Admin user name in sheet is `Admin-(ENG Anwer)`.

## 6. Risk to the migration

- Business rules that live only in the deployed (missing) code may be lost → get the deployed code.
- Date ambiguity: every Sheets-typed date must be re-derived from ISO `submitted_at` where possible.
- Equipment field `fs` is labelled **"Fire Search / معدات الإطفاء"** in the app. Your brief lists **Foam extinguishers** and **Fire hose** — neither exists in the app or data. Needs confirmation (see roadmap open questions). Nothing will be renamed or invented until confirmed.
- Fire pump (`fp*`) step exists in the app and data but is not named in the brief — it will be preserved.

## 7. Recommendation

Proceed with React + TypeScript + Vite + Tailwind + Supabase (Auth, Postgres+RLS, Edge Functions) + PWA + Capacitor Android, built and released through GitHub Actions. Details: IMPLEMENTATION_ROADMAP.md.
