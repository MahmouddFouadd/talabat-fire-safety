# DATABASE_SCHEMA

Source of truth: `supabase/migrations/`. Summary:

| Table / object | Purpose | Who can write |
|---|---|---|
| zones | code, Arabic/English names, order, active | admin |
| staff | people: name, username, role, zone, phone, active, `auth_user_id` (linked login) | admin (login link: Edge Function only) |
| stores | `store_code` PK, name, zone, assigned technician, active, flagged, notes | admin |
| equipment_types | p6, co2, fs, hc, al, fp — labels + active | admin (update) |
| store_equipment | permanent base quantities per store (0–9999) | admin |
| app_settings | allow-listed keys (names, login texts, overdue days, idle timeout, require remarks) | admin |
| inspections | one row per inspection, all equipment fields, sums enforced by CHECK; unique (store, week_start) unless admin override | `submit_inspection()` only |
| issues | auto-created from inspections, priority, status workflow, resolution | `submit_inspection()`, `update_issue()` |
| issue_events | issue status history | `update_issue()` |
| audit_logs | insert-only change log | triggers / Edge Function |
| v_store_status (view, security_invoker) | status per store: ok · issues · pending · overdue · never | read via RLS |
| dashboard_summary(zone) | all dashboard numbers incl. 12-week trend | admin |

### Store status rules
- inspected this week → **ok** or **issues** (from overall status)
- never inspected → **never**
- last inspection older than `overdue_days` (default 7) → **overdue**
- otherwise → **pending** (due this week)

### Issue rules (unchanged from the pilot, now server-side)
Powder damaged/missing → medium (high if any missing) · CO2 → medium · Fire Search → medium · Hose cabinet (any component not good or fewer fully-OK cabinets) → medium · Fire alarm fault → critical, other alarm component problems → high · Fire pump not running / not tested → high.

### Technician store scope (Settings → "Stores shown to a technician")
`app_settings.tech_store_scope`:
- `assigned` (default): a technician works on stores assigned to them by name.
- `zone`: assigned stores **plus** every store in the technician's zone (set the zone on the Users page). Several technicians can share a zone; the one-inspection-per-store-per-week rule still applies.
One SQL helper, `can_access_store()`, is used by RLS (stores, base quantities, issues, inspections) and by `submit_inspection`, so the app and the API always agree.
