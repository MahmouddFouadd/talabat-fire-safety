# DATABASE_MAPPING — Google Sheets → Supabase Postgres

> Superseded in part (2026-11-20): only master data is migrated (see MIGRATION_REPORT.md); `profiles` became `staff`; weeks are keyed by `week_start` (Sunday). The final schema is in DATABASE_SCHEMA.md.

Principles: keep every stable ID (`store_code`, `user_id`, `inspection_id`, `issue_id`), keep every inspection field, normalise only where it removes drift (names, zones), never store PINs.

## 1. Proposed tables

```
zones(id uuid PK, code text UNIQUE 'Zone 1', name_ar, name_en, active)

profiles(id uuid PK = auth.users.id, legacy_user_id text UNIQUE 'TECH001',
         full_name, role enum(admin, technician), zone_id FK zones NULL,
         active bool, created_at, updated_at)

stores(store_code text PK, name, zone_id FK zones, assigned_tech_id FK profiles NULL,
       active bool, flagged bool, created_at, updated_at)
       -- tech name is NOT stored: joined from profiles (fixes drift)

store_equipment(store_code PK/FK stores, p6_qty, co2_qty, fs_qty, hc_total  int CHECK 0..9999,
                updated_by FK profiles, updated_at)

weeks(week_key text PK '2026-W45', year, start_date date, end_date date, deadline date NULL, status, notes)

inspections(inspection_id text PK, store_code FK, tech_id FK profiles, week_key FK weeks,
            inspection_date date, submitted_at timestamptz, client_id uuid UNIQUE (idempotency),
            -- snapshot of names at submit time for history:
            store_name_snapshot, zone_snapshot, tech_name_snapshot,
            p6_qty,p6_good,p6_dmg,p6_miss,p6_pr_norm,p6_pr_low,p6_pr_empty,p6_status,p6_rmk,
            co2_qty,co2_good,co2_dmg,co2_miss,co2_w_ok,co2_w_low,co2_w_empty,co2_status,co2_rmk,
            fs_qty,fs_good,fs_dmg,fs_miss,fs_status,fs_rmk,
            hc_total,hc_ok,hc_hose,hc_valve,hc_glass,hc_status,hc_rmk,
            al_status,al_panel_fault,al_battery,al_detectors,al_mcp,al_sounders,al_rmk,
            fp_available,fp_status,fp_tested,fp_rmk,
            overall_status enum(ok,warn,danger), general_remarks,
            duplicate_override bool, override_by FK profiles NULL, override_reason,
            legacy_status_unreliable bool  -- true for migrated pilot rows (bug F2)
            CHECK (p6_good+p6_dmg+p6_miss = p6_qty) ... same for co2, fs
            CHECK (hc_ok <= hc_total) CHECK all counts >= 0)
   UNIQUE (store_code, week_key) WHERE duplicate_override = false

issues(issue_id text PK, inspection_id FK inspections NULL (legacy orphans), store_code FK,
       equipment enum(p6, co2, fs, hose_cabinet, fire_alarm, fire_pump, other),
       description, priority enum(critical,high,medium,low),
       status enum(open, assigned, in_progress, resolved, closed),
       assigned_to FK profiles NULL, created_at, created_by,
       resolved_at, resolved_by, resolution_notes,
       CHECK (status <> 'resolved' OR (resolved_at IS NOT NULL AND resolution_notes <> '')))

issue_events(id, issue_id FK, from_status, to_status, note, actor, at)   -- history

audit_logs(id bigserial, at timestamptz, actor_id uuid NULL, legacy_actor text,
           action text, entity text, entity_id text, store_code text, detail jsonb)
           -- INSERT only via trigger/RPC; no UPDATE/DELETE for any role

app_config(key text PK allow-listed, value jsonb, updated_by, updated_at)

attachments(id, inspection_id/issue_id, storage_path, mime, size, uploaded_by)  -- only if photos are wanted
```

Why inspection fields stay as columns (not an EAV detail table): reports, CSV export and dashboard all read them per equipment type; a flat row with CHECK constraints gives exact server-side validation with simple queries. An `inspection_items` table can be added later if new equipment types become configurable.

## 2. Sheet → table column mapping

### Users → profiles (+ auth.users)
| Sheet | Target | Note |
|---|---|---|
| user_id | profiles.legacy_user_id | stable |
| name | profiles.full_name | Users sheet is source of truth (`bassem`, `samir`) — **confirm spelling** vs Stores (`Yassem`, `Sameer`) |
| role | profiles.role | `technician` / `admin` |
| zone | profiles.zone_id | `ALL` → NULL for admin |
| pin | **dropped** | compromised |
| active | profiles.active | |

### Stores → stores (+ zones)
| store_code→PK · store_name→name · zone→zone_id · assigned_tech_id→assigned_tech_id · assigned_tech_name→**dropped (derived)** · active · flag→flagged |

### Store_Equipment → store_equipment
| store_code · p6qty→p6_qty · co2qty→co2_qty · fsqty→fs_qty · hcTotal→hc_total · updated_by ('Admin')→admin profile · updated_at (ISO) |
12 stores have no row → created only when admin sets them; until then inspection of that store is **blocked** with a clear message (fix F9 — confirm).

### Inspections → inspections
All 53 columns map 1:1 (renamed to snake_case as listed above). Special handling:
| Sheet | Rule |
|---|---|
| date (`dd/MM/yyyy` text) | parsed strictly as day/month/year; cross-checked against `submitted_at` (Cairo time) |
| week_key | kept as-is (historical) |
| store_name, zone, tech_name | → `*_snapshot` |
| p6s, co2s, fss, hcs, als | migrated but `legacy_status_unreliable = true` (always "issue/fault" due to bug F2); new code derives them |
| overall_status | kept |

### Issues → issues
| issue_id, inspection_id, store_code kept · store_name/zone/tech_name dropped (join) · equipment Arabic text → enum via fixed map (طفايات البودرة 6كجم→p6, طفايات CO2→co2, معدات Fire Search→fs, نظام إنذار الحريق→fire_alarm …) and original text kept in `description` · Open→open · created_date: 2026-01-11 → **2026-11-01** (re-derived from inspection submitted_at) |
3 issues reference `INS-MVY9NZF472Y` which is missing → imported with `inspection_id = NULL` and `legacy_inspection_ref` kept, flagged in report (needs your decision).

### Audit_Log → audit_logs
All 296 rows kept verbatim with `legacy_actor`. Proposal: mark the 142 `INIT` rows as `system_noise` (kept, filtered out of default view).

### Weeks / App_Config
Weeks row kept, dates corrected to 2026-11-01 / 2026-11-07 **after confirmation**. App_Config: only allow-listed UI keys migrated; `dbLastCheck`, sheet IDs dropped.

## 3. Migration validation checks (dry run)
Counts per table · every FK resolves · sum rules hold for every inspection · no PIN column anywhere in target · per-store latest inspection date equal before/after · report written to `MIGRATION_REPORT.md`.
