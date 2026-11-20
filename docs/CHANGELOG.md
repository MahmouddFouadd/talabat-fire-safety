# CHANGELOG

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
