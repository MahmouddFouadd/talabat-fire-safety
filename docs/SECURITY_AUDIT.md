# SECURITY_AUDIT — current pilot

Scope: `Code (2).gs`, `Index (5).html`, pilot workbook. Credential values are intentionally **not** reproduced in any document.

## Critical

| ID | Finding | Where | Impact | Fix in new system |
|---|---|---|---|---|
| S1 | **No server-side authentication or authorisation.** Every Apps Script function (`adminAddUser`, `adminUpdateUser`, `adminUpdateStore`, `addStore`, `saveEquipment`, `saveAppConfig`, `switchDatabase`, `getAuditLog`, `saveInspection`) can be called directly by anyone who opens the web-app URL. Identity is whatever `techId` the client sends. | Code.gs, deployment "Anyone" | Anyone can create admins, rename/deactivate users, change stores and base quantities, forge inspections in any technician's name | Supabase Auth JWT + RLS on every table; privileged writes via SECURITY DEFINER RPCs / Edge Functions that check `auth.uid()` role |
| S2 | **All data exposed before login.** `getBootstrapData` returns all users, stores, inspections and issues; called on page load | Code.gs / `loadSheetsData` | Full data leak | Nothing is fetched before sign-in; RLS limits technicians to their stores |
| S3 | **PINs hardcoded in source** (frontend `TECHS` array and backend `initializeDatabase` seed) | both files | Credentials public to anyone who views page source | Removed entirely; accounts re-provisioned |
| S4 | **PINs stored in plaintext** in `Users!E`, 4 digits only, no lockout | workbook | Trivial brute force (10,000 combinations) | Supabase Auth (bcrypt), optional PIN quick-unlock hashed server-side with attempt limits |
| S5 | `initializeDatabase()` silently **re-adds the seed users with seed PINs** if their rows are missing | Code.gs | A deleted/disabled account comes back | No seeding in production code |
| S6 | Duplicate-override flag is trusted from the client | `saveInspection` | Any technician can create multiple inspections per week | Admin-only override, enforced in RPC, audited |

## High

| ID | Finding | Fix |
|---|---|---|
| S7 | "Super admin" check is client-side only (`isSuperAdmin()`), comment claims backend enforces it — it does not | Role checked in DB policies |
| S8 | `setXFrameOptionsMode(ALLOWALL)` → page can be framed (clickjacking) | `frame-ancestors 'none'` CSP on hosting |
| S9 | Audit log entries for admin actions always say `ADMIN01`, regardless of who acted; audit is writable by any caller through the other functions | Audit written by DB triggers from `auth.uid()`, table is insert-only, no UPDATE/DELETE grants |
| S10 | No session expiry, no logout invalidation; refresh = full re-login but stolen URL needs no login at all | Supabase sessions, refresh-token rotation, idle timeout |
| S11 | No rate limiting on `validateLogin` | Supabase Auth rate limits + custom PIN attempt counter |
| S12 | Stored-XSS surface: 58 `innerHTML` writes; several values inserted unescaped (issue `store`, `zone`, `eq`, `to`, inspection dates, store codes in `onclick="drill('…')"`) | React escaping by default; no `dangerouslySetInnerHTML` |
| S13 | `saveAppConfig` accepts any key (only blocks keys containing pin/password/secret); restore-from-backup lets a caller write arbitrary config | Typed config table with allow-listed keys, admin only |
| S14 | `testSheetConnection` lets callers probe any spreadsheet the script owner can open | Removed (Sheets no longer used) |
| S15 | CSV export not escaped (formula injection `=…` in store names) | Server-side export with escaping and `'` prefix for formulas |

## Medium / Low

- CDN scripts (Chart.js, Tabler icons) loaded without Subresource Integrity → bundle locally.
- Server error messages returned raw (`err.toString()`) to the browser.
- Sheet ID hardcoded in Code.gs (not a secret, but should not be in a public repo).
- No input length limits on remarks.
- Personal names in audit `detail` free text.

## Credential handling decision

The 5 pilot PINs are treated as **compromised**:
1. They will not be migrated, printed, committed or used.
2. Each user gets a new Supabase account (email or `username@firesafety.local` style login decided with you) with an admin-set temporary password and forced change on first login.
3. Optional: technicians set a new personal 4–6 digit quick-unlock PIN on their own device after a full login; it is hashed server-side and locked after 5 failed tries.
4. Until the new system replaces it, **change the PINs in the live sheet now** and redeploy the pilot as "Only users in my domain" if possible.

## Security tests planned (Phase 6)

- Technician A cannot select/update stores, inspections, issues of technician B (direct REST calls with A's JWT).
- Technician cannot update `store_equipment`, `stores`, `profiles.role`, `audit_logs`.
- Anonymous key returns zero rows on every table.
- Duplicate inspection via replayed request rejected (idempotency key).
- Login brute force throttled; disabled user's session rejected.


## Status after implementation (2026-11-20)
| ID | Status |
|---|---|
| S1 | ✅ Fixed — RLS on every table, privileged writes only via checked RPCs / Edge Function (tests/sql) |
| S2 | ✅ Fixed — nothing readable before sign-in except login texts (`public_settings`) |
| S3/S4/S5 | ✅ Fixed — PINs not migrated, no seeding of credentials, Supabase Auth (bcrypt) + strong passwords + forced change |
| S6 | ✅ Fixed — duplicate override admin-only with reason, enforced in `submit_inspection` |
| S7 | ✅ Fixed — roles checked in the database |
| S8 | ✅ Fixed — `X-Frame-Options: DENY` (`public/_headers`) + CSP meta |
| S9 | ✅ Fixed — trigger-based audit with real actor; table insert-only |
| S10 | ✅ Fixed — Supabase sessions, idle sign-out (configurable), deactivation bans the login |
| S11 | ✅ Supabase Auth rate limits (verify after deploy) |
| S12 | ✅ Fixed — React escaping, no `dangerouslySetInnerHTML` |
| S13 | ✅ Fixed — allow-listed settings keys (CHECK constraint) |
| S14 | ✅ Removed with Sheets |
| S15 | ✅ Fixed — CSV escaping + BOM |
| CDN | ⚠️ Google Fonts still loaded from Google (falls back to system fonts offline); all JS bundled locally |
| Secret key shared in chat | ⚠️ Rotate it in Supabase (not used anywhere in this repository) |

## PIN sign-in (added 1.3.0)
- Optional second method; the password keeps working. PIN = 4–6 digits, sequences and repeats refused.
- Stored as bcrypt (`crypt`/`gen_salt('bf')`) in `staff_pins` — RLS on, no policies, no grants to anon/authenticated.
- Checked only by `pin_check()` (service role) inside the `pin-login` Edge Function; unknown users get the same answer and the same bcrypt work.
- Lockout: 5 wrong → 15 min; 15 in a row → disabled until the user sets a new PIN after a password sign-in or an admin resets it. Every success/failure is audited.
- On success the function creates a one-time sign-in token server-side and exchanges it immediately for a normal Supabase session; nothing is e-mailed or texted.
