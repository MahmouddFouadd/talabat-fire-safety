# CHANGELOG

## 1.6.0 — 2026-11-21 (security review — docs/SECURITY_REVIEW_2026-11-21.md)
- Missing files under /assets/ now return 404 instead of index.html (small Worker); the app reloads once on a stale chunk after a deploy.
- CSP, COOP and frame-ancestors sent as real HTTP headers; long-lived cache for hashed assets.
- One inspection per store per week holds under concurrent submissions (clear DUPLICATE_WEEK); admin overrides get their own audit row.
- Inspection submit: double-tap guard, timeouts are queued for retry (same client_id → no duplicate), one sync at a time.
- PIN sign-in no longer reveals which accounts exist (unknown accounts lock the same way).
- Sessions: password change ends other sessions; admin reset/deactivate/delete end all sessions; new "Sign out all devices" action.
- Audit log: request IP/user agent, rows cannot be edited/deleted/truncated, exports are audited.
- In-app JSON backup and inspections CSV no longer stop at 1000 rows; backup includes custom equipment tables.
- Dashboard issue KPIs count active stores only. API roles lose TRUNCATE/TRIGGER/REFERENCES.
- 28 new SQL security tests; CI runs every tests/sql file.

## 1.5.0 — 2026-11-21
- Admin full control: delete stores (with a typed confirmation when history exists — history is removed with it), zones (stores become “no zone”), users (Edge Function; users with inspection history must be deactivated instead), issues and inspections. Every delete is audited.
- Zone editor lists the zone's stores; add stores from other zones / unzoned, or remove them from the zone. Stores may have no zone.
- New equipment types from Settings (count or OK/problem, icon, issue priority). Assign them per store (or in bulk) in Equipment setup; they appear as inspection steps, in reports, issues and the dashboard. Built-in types can be renamed/switched off; unused custom types can be deleted.

## 1.4.0 — 2026-11-21
- Formal line icons for every inspected equipment type (powder, CO2, Fire Search, hose cabinet, alarm, pump) in the wizard, issues, dashboard, store cards, settings and equipment status.
- Equipment status page rebuilt: scrollable type pills, summary hero, card rows with coloured result chips.
- Issues: equipment icon badge, priority pill, compact actions (only the next step + resolve).
- Daily database backup to the `backups` branch (one copy, replaced every day; optional AES-256 encryption).
- CI pinned to Ubuntu 24.04 (Playwright dependencies).

## 1.3.0 — 2026-11-21
- Sign in with a PIN (4–6 digits) as an alternative to the password, with mobile number or username. PINs are bcrypt-hashed in a table no app role can read; 5 wrong tries lock it for 15 minutes, 15 disable it until reset. Users set their own PIN (key button); admins can set or remove a user's PIN.
- New Edge Function `pin-login` (anonymous sign-in endpoint).

## 1.2.0 — 2026-11-21
- New visual design: teal→olive hero gradients, white rounded cards, black pill buttons, floating pill navigation, segmented filters; Readex Pro font.
- talabat mart logo on sign-in, sidebar, app icon and splash screen.
- Sign in with the mobile number saved on the user (or username) + password; one number per active user.

## 1.1.0 — 2026-11-20
- Admin option: technicians see only assigned stores (default) or all stores in their zone.
- Fixed endless loading after sign-in; 20 s request timeout; explicit API grants for new Supabase projects.
- Latin digits in the Arabic UI; 360 px layout fixes.

## 1.0.0 — 2026-11-20
### New platform
- Supabase (Postgres + RLS + RPC + Auth + Edge Function) replaces Google Sheets / Apps Script.
- React + TypeScript app with new glass design (Talabat orange/burgundy), Arabic RTL + English, light/dark, desktop sidebar + mobile bubble navigation.
- PWA (installable on iPhone/Android) and Capacitor Android project; CI builds APK/AAB.
- Offline drafts and outbox with idempotent sync.

### Fixed from the pilot
- Issues are now created server-side and always saved (pilot sent an empty list).
- Per-equipment statuses derived correctly (pilot always saved "issue"/"fault").
- Hose-cabinet issues created (pilot compared Arabic values to English).
- Dashboard trend uses real data (pilot chart was hardcoded); no seed/demo inspections.
- Zones, equipment labels and settings are data, not code.
- Stores without base quantities can no longer be inspected as "all zeros = OK".
- Store name/technician name stored once (no drift); history keeps snapshots.
- Inspection date/week from the server clock (Cairo), week Sunday→Saturday.

### Security
- Real authentication (username + strong password, forced change, idle timeout); PINs removed.
- Every table protected by RLS; admin actions enforced in the database, not the browser.
- Insert-only audit log written by triggers with the real actor.
- CSP, no framing, CSV formula-injection protection, no service key in the client.

### Behaviour changes to confirm
- The manual "general status" chips per equipment were removed; status is derived from the counts/choices (removes contradictory entries).
- Fire-alarm components (battery low, detectors dirty, MCP/sounders faulty or missing) now open a **high** issue; a system fault stays **critical**. The pilot only raised an issue for a system fault.
- Hose cabinet: an issue opens when any component is not good **or** fewer cabinets are fully OK than installed.
- Pilot history (11 inspections, 7 issues, audit) is archived in the workbook and not imported.
