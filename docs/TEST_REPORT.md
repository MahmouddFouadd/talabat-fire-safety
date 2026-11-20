# TEST_REPORT — 2026-11-20

All results below were produced by actually running the commands in the development sandbox.

| Suite | Command | Result |
|---|---|---|
| Lint | `npm run lint` | ✅ 0 errors, 0 warnings |
| Types | `npm run typecheck` | ✅ strict mode, 0 errors |
| Unit | `npm test` | ✅ 8 / 8 (Sunday-week maths, CSV escaping) |
| Build | `npm run build` | ✅ PWA precache 32 files |
| Database security | migrations + `tests/sql/10_rls_and_rpc_tests.sql` on PostgreSQL 16 | ✅ 33 / 33 checks |
| Migrations idempotent | all migrations applied twice | ✅ no errors |
| End-to-end + responsive | `npx playwright test` | ✅ 20 / 20 (4 scenarios × 5 viewports) |

## Database checks (selection)
anon reads nothing and cannot call business RPCs · technician sees only own 13 stores / own staff row / no audit · cannot change base quantities · cannot escalate role · cannot insert inspections directly · count mismatch rejected · another technician's store rejected · valid submission creates the right issues with correct priorities · replay with same client_id is idempotent · duplicate week blocked · technician cannot resolve issues · technician B cannot read technician A's inspections or issues · admin sees all · resolve requires notes · resolved issue keeps its inspection link · rename keeps store_code · dashboard numbers come from rows · last admin cannot be disabled · login link locked from the API · store changes audited · audit log not deletable · bootstrap_admin not callable by anon or technicians.

## UI scenarios × viewports
Viewports: 1440×900, 1280×720, 768×1024 (touch), Pixel 7 (412×915), 360×740. Every page asserted to have **no horizontal overflow**.
1. Admin dashboard shows database figures.
2. Admin pages (stores, issues, equipment, inspections, users, settings) render.
3. Language switch flips RTL↔LTR and keeps the current page.
4. Technician sees only own stores, cannot advance with a wrong tally, completes all steps, sees auto-issues, submits and gets the inspection number.
Screenshots: `test-results/shots/` (45 images, a sample is included in the delivery).

## Not tested here (and why)
| Item | Reason | Where it runs |
|---|---|---|
| iPhone Safari / iPad (WebKit) | sandbox has Chromium only | CI `ci.yml` adds `iphone-14-safari` and `ipad-safari` projects |
| Live Supabase (real Auth, rate limits, Edge Function) | sandbox has no network access to supabase.co | after deployment: follow the checklist below |
| APK build/install | no Android SDK in sandbox | `android.yml` on GitHub runners |

UI tests use a deterministic Supabase stand-in fed with fixtures exported from a database built by the real migrations; RLS itself is verified by the SQL suite.

## Post-deployment checklist (5 minutes)
1. Sign in as admin → dashboard shows 66 stores.
2. Create a login for one technician → sign in on a phone → forced password change → only that zone's stores appear.
3. Submit one inspection with 1 damaged extinguisher → issue appears for admin → assign → resolve with notes.
4. Turn off Wi-Fi mid-inspection → submit → "Waiting to send" → Wi-Fi on → sent once.
5. Try 5 wrong passwords → rate-limit message.
