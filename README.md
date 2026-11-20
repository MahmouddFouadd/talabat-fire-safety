# Fire Safety Management — Talabat Mart

Weekly fire-safety inspections for Talabat Mart stores: technicians inspect from their phones (Android app or installed web app, works offline), admins manage stores, equipment, issues and users from a laptop. Arabic (RTL) and English, light and dark.

| Part | Technology |
|---|---|
| Web app / PWA | React 18 · TypeScript · Vite · Tailwind · TanStack Query · Zod |
| Backend | Supabase: Postgres + Row Level Security, RPCs, Auth, one Edge Function |
| Android | Capacitor 6 (APK/AAB built by GitHub Actions) |
| iPhone | Installable PWA (Safari → Share → Add to Home Screen) |

## Quick start (development)
```bash
npm ci
cp .env.example .env    # optional — defaults point to the production project's public URL + anon key
npm run dev
```
Quality gates: `npm run lint && npm run typecheck && npm test && npm run build && npx playwright test`.

## Repository map
```
src/                     React app (pages/admin, pages/tech, lib, components)
supabase/migrations/     Versioned SQL (schema, RLS + RPCs, master data)
supabase/setup_all.sql   Same migrations in one file for the SQL editor
supabase/functions/      admin-users Edge Function (only place the service key is used)
scripts/                 build_master_seed.py (Excel → master-data SQL, never reads PINs)
tests/sql                RLS / RPC security tests (plain Postgres)
tests/e2e                Playwright functional + responsive tests (5–7 device sizes)
android/                 Capacitor Android project
docs/                    Audit, architecture, security, deployment, test report
```

Start here: **docs/DEPLOYMENT_GUIDE.md**.
