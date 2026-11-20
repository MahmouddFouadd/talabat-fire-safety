# CURRENT_FEATURES — what the pilot does today

Legend: ✅ works · ⚠️ works with bugs · ❌ visible in UI but not functional · 🔒 security-relevant

## 1. Screens and server functions

| Area | Frontend function(s) | Server function | State |
|---|---|---|---|
| Startup / data load | `loadSheetsData`, `adminRefreshFromSheets` | `getBootstrapData` | ⚠️🔒 loads **all** users, stores, inspections, issues before login |
| Login (name dropdown + 4-digit PIN pad) | `populateLoginDropdown`, `doLogin`, `pp/pdel/pclear` | `getUsersForSignIn`, `validateLogin` | ⚠️🔒 no session, no rate limit |
| Technician store list (KPIs, status per store) | `launchTech`, `renderStoreList` | — | ⚠️ filters by `zone`, server checks `assigned_tech_id` |
| Inspection wizard, 7 steps | `startIns`, `renderStep`, `fNext/fBack`, step renderers | — | ⚠️ see bugs |
| Submit inspection | `submitIns` | `saveInspection` | ⚠️ issues not sent; statuses wrong |
| Duplicate override ("submit anyway") | `dupOverride` | `saveInspection(allowDuplicate)` | ⚠️🔒 any user can override |
| Admin dashboard (8 KPIs, 4 charts, store heat-map, overdue table) | `vDash`, `bZone`, `bTrend`, `bEquip`, `bPrio`, `renderCTab` | — | ⚠️ trend chart hardcoded |
| Stores view + add store | `vStores`, `showAddStoreForm`, `saveNewStore` | `addStore` | ✅🔒 |
| Inspection log | `vInspections` | — | ✅ |
| Open issues | `vIssues` | — | ❌ read-only; no assign/progress/resolve |
| Extinguishers / Hose cabinets / Fire alarm views | `vExt`, `vHose`, `vAlarm` | — | ✅ |
| Zones / Technicians | `vZones`, `vTechs` | — | ⚠️ zones hardcoded Zone 1–4 |
| Flagged stores | `vFlagged` | — | ✅ |
| Store drill-down panel | `drill`, `closeDrill` | — | ✅ |
| Equipment Setup (base quantities) | `vEquipmentSetup`, `saveEquipmentRecord` | `saveEquipment`, `getStoreEquipment` | ✅🔒 no server role check |
| Admin Settings → users (add, rename, activate) | `asRenderUsers`, `asAddUser`, `asSaveUser`, `asToggleUser` | `adminAddUser`, `adminUpdateUser` | ✅🔒 PIN stored plaintext |
| Admin Settings → stores (edit, activate) | `asRenderStoresMgr`, `asSaveStore`, `assToggleStore` | `adminUpdateStore` | ✅🔒 |
| System Configuration (identity, inspection, UX, zones) | `vSysConfig`, `sysSave*`, `sysAddZone` | `getAppConfig`, `saveAppConfig` | ⚠️ `weekStart` saved but ignored by week maths |
| Database & Integration (test/switch/rollback sheet) | `vSysDatabase` | `testSheetConnection`, `switchDatabase` | ⚠️ switch only records intent; obsolete after Supabase |
| UI Editor (login text/colours, preview, publish) | `vSysUI`, `sysPublishUI` | `saveAppConfig` | ✅🔒 |
| Audit Log (last 200) | `vSysAudit` | `getAuditLog` | ✅🔒 readable by anyone |
| Backup / Restore (config JSON only) | `vSysBackup`, `sysRestoreFromBackup` | `saveAppConfig` | ⚠️ config only, not data |
| Handover (instructions text) | `vSysHandover` | — | ✅ static text |
| CSV export (store status) | `doExport` | — | ⚠️ no escaping, client-side only |

## 2. Inspection form — fields and current rules (to be preserved)

| Step | Fields | Rule today |
|---|---|---|
| 1 Powder 6 kg | `p6qty` (from base, read-only), `p6good/p6dmg/p6miss`, `p6prnorm/low/empty` (kept, UI removed), `p6s`, `p6rmk` | good+dmg+miss must equal base qty |
| 2 CO2 | `co2qty`, `co2good/dmg/miss`, `co2wok/wlow/wempty` (kept, UI removed), `co2s`, `co2rmk` | same sum rule |
| 3 Fire Search (`fs`) | `fsqty`, `fsgood/dmg/miss`, `fss`, `fsrmk` | same sum rule |
| 4 Hose cabinets | `hcTotal` (base), `hcOk` (≤ total), `hcHose` (سليم/تالف/مفقود), `hcValve` (سليم/متصلب/تالف), `hcGlass` (سليم/مكسور/مفقود), `hcs`, `hcrmk` | hcOk clamped to total |
| 5 Fire alarm | `als` (يعمل/يوجد عطل), `alBat`, `alDet`, `alMCP`, `alSnd`, `alrmk`; `alf` kept = false | none |
| 6 Fire pump | `fpAvail` (يوجد/لا يوجد), `fpStatus`, `fpTested`, `fprmk` | if no pump → dependent fields forced "لا يوجد بالفرع" |
| 7 Review | `genrmk`, duplicate-override checkbox | duplicate per store + ISO week blocked unless overridden |

Overall status today: `warn` if any damage/missing, alarm fault, pump not working or not tested; else `ok`. `danger` is never produced by a submission — it only appears on the dashboard as "overdue".

Auto-created issues and priorities (frontend logic):
- Powder: damaged or missing → **high** if any missing, else **medium**
- CO2 damaged/missing → medium · Fire Search → medium · Hose → medium · Alarm fault → **critical** · Pump not working / not tested → **high**

Store status (dashboard): latest inspection in current ISO week → its overall status; otherwise last inspection > 7 days → overdue (`danger`), ≤ 7 days → `warn`; never inspected → `none`.

## 3. Business rules found that need your confirmation

1. Inspection week = **ISO week, Monday start** in code, but the `Weeks` sheet shows a Sunday–Saturday week and System Config has a `weekStart` option. Which is correct?
2. `fs` = "Fire Search" — what equipment is this exactly? Your brief mentions Foam extinguishers and Fire hose, which the app does not have.
3. Should zones stay tied 1:1 to a technician, or can a zone have several technicians / a technician several zones?
4. Who may override a duplicate weekly inspection — admin only?
5. Is `deadline` (Weeks sheet) a real rule (e.g. inspection due by a weekday)?

## 4. Functional bugs (verified in code and data)

| # | Bug | Evidence |
|---|---|---|
| F1 | **New issues are never sent to the server.** `sheetsPayload.issues` is built before the issues are pushed to `ISSUES`, so it is empty. | Only 7 issues for 11 inspections with damage in ≥5 stores |
| F2 | **Per-equipment status always saved as `issue` / `fault`.** Code compares Arabic chip values with English `'OK'` / `'OK — normal'`. | Every inspection row: `p6s=issue`, `als=fault` |
| F3 | Hose-cabinet issues never created: checks `'Issue found'`, chips are Arabic | No hose issue despite `hcHose=تالف` on DS1 |
| F4 | Fire Search auto-status compares to `'Issue found'` → never auto-flags | `stepFS` |
| F5 | Issue workflow (assign, in progress, resolve, notes, date) has no UI action and no server function | `vIssues`, Code.gs |
| F6 | Dashboard "Alarm faults" / "Hose issues" / equipment doughnut count only English names; server issues are Arabic → show 0 | `vDash`, `bEquip` |
| F7 | **Weekly trend chart is fake**: `[62,70,68,75,80,72,78,82,79,84,88,last]` | `bTrend` |
| F8 | 4 **seed inspections** (SEED-001..004, one for non-existent store `DC3`) live in the client and count on the dashboard | `INS` array |
| F9 | Stores without base equipment can be inspected with all-zero quantities and pass as OK | DS23 |
| F10 | Technician list filtered by zone, server authorises by assigned tech → mismatch after reassignment | `renderStoreList` vs `saveInspection` |
| F11 | Inspection date is the **client** date (`en-GB`), server stores server date; week key from client clock | `submitIns` |
| F12 | `initializeDatabase()` runs on **every page load** → 142 INIT audit rows, slow start | `doGet` |
| F13 | Store tech name and user name stored twice and already out of sync | Stores vs Users |
| F14 | Zones hardcoded (`Zone 1–4`) in charts and filters | `bZone`, `populateZoneFilter` |
| F15 | `weekStart` setting is saved but never used | `isoWeek` |
| F16 | Store status "warn" mixes "inspected with issues" and "inspected last week" | `storeStatus` |
| F17 | No pagination; whole sheets loaded into the browser each time | `getBootstrapData` |
| F18 | Mobile: single huge HTML, admin tables overflow on phones, CDN required on load | layout review |
