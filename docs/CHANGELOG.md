# CHANGELOG

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
