# MIGRATION_REPORT — master data (dry run on PostgreSQL 16, 2026-11-20)

Scope decided by the owner: **master data only**, everything else managed from the UI. The workbook was opened read-only and was not modified. The PIN column was never read.

| Source sheet | Rows | Target | Rows after migration | Result |
|---|---|---|---|---|
| Stores → zone values | 4 distinct | zones | 4 | ✅ |
| Users | 5 | staff (no credentials) | 5 | ✅ 4 technicians + 1 admin, names capitalised (`bassem`→`Bassem`, `samir`→`Samir`) |
| Stores | 66 | stores | 66 | ✅ all codes kept, 18 flagged, all active |
| Store_Equipment | 54 | store_equipment | 54 | ✅ quantities and `updated_at` kept |
| — | — | equipment_types | 6 | default labels (editable) |
| — | — | app_settings | 8 | defaults |
| Inspections (11), Issues (7), Audit_Log (296), Weeks (1), App_Config (1), Sheet1 (0) | — | not migrated | — | kept in the workbook as archive (owner decision) |

Checks performed: every store resolves to a zone and to an existing technician; no duplicate codes; quantities 0–9999; migration re-applied a second time with no changes (idempotent).

## Warnings to act on
1. **12 stores have no base quantities**: DS23, DS37, DS39, DS46, DS52, DS64, DS72, DS74, DS87, DS_CITYSTARS2, DS_SHOROUK3, DS_TAGAMOA10. Inspections for them are blocked until an admin fills them in (Equipment setup → "Missing quantities only").
2. Technician display names in the old Stores sheet (`Yassem`, `Sameer`) differed from the Users sheet; the Users sheet was used. Correct them in **Users** if needed.
3. Production run: not executed from here (the sandbox has no network access to Supabase). Run it with DEPLOYMENT_GUIDE step 1, then check: `select count(*) from stores` = 66, `store_equipment` = 54, `staff` = 5, `zones` = 4.
