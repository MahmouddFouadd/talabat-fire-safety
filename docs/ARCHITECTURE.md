# ARCHITECTURE

```
Phone (Android APK / iPhone PWA)        Laptop (browser)
        │  same React bundle (HashRouter, works offline as PWA)
        ▼
supabase-js ── anon key + user JWT (never the service key)
        │
        ├── PostgREST: tables/views protected by RLS
        ├── RPC  submit_inspection(p)   ← only way to create an inspection; validates & creates issues
        ├── RPC  update_issue(...)      ← admin issue workflow + history
        ├── RPC  dashboard_summary()    ← all dashboard figures computed in SQL
        └── Edge Function admin-users   ← create login / reset password / (de)activate (service role inside Supabase)
```

## Key design decisions
| Decision | Why |
|---|---|
| Business rules live in Postgres (`submit_inspection`) | Web, PWA, offline sync and APK cannot bypass them; quantities come from `store_equipment`, not from the client |
| `staff` table separate from `auth.users` | Master data (people, assignments) can be migrated and managed before anyone has a login; a login is linked later and only by the Edge Function |
| Store code is the primary key and immutable in the UI | Renames never break history; FK `on update cascade` protects against data fixes |
| Inspections are insert-only and keep name snapshots | History stays true even if a store/technician is renamed |
| Week = Sunday→Saturday, Africa/Cairo, keyed by `week_start` | Business decision 2026-11-20; one inspection per store per week (unique partial index) |
| Equipment checklist columns are fixed; names/on-off are data (`equipment_types`) | Exact server validation with CHECK constraints while labels stay editable in the UI |
| HashRouter + relative base | Same build runs on Cloudflare Pages, as an installed PWA and inside Capacitor |
| Offline: drafts + outbox in IndexedDB, `client_id` idempotency key | A retried submission returns the existing record; failures are kept and shown, never dropped |
| Audit by triggers into an insert-only table | Every change to master data, issues and inspections is recorded with the real actor |

## Roles
- **admin** — everything; only role that can change master data, issues, settings, override a weekly duplicate.
- **technician** — reads only stores assigned to them (and their base quantities/issues), submits inspections for those stores, sees own history.
