# Daily backup & restore

**What:** every day at 03:00 Cairo, the *Daily database backup* workflow dumps the Supabase database
(schema + all data in `public`, except PIN hashes) and force-pushes it to the **`backups`** branch.
The branch always contains only the latest backup (yesterday's is replaced), as requested.

**Setup (once):**
1. The workflow reuses the `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` secrets you already added.
2. Recommended: add a secret **`BACKUP_PASSPHRASE`** (a long password you keep somewhere safe). The files are then
   encrypted with AES-256; without it they are stored as plain `.sql.gz` in the private repo (names and phone numbers are inside).
3. Run it once by hand: Actions → *Daily database backup* → Run workflow.

**Notes**
- Only one copy is kept. If you ever want a few days of history, say so — the workflow can keep the last N.
- GitHub pauses scheduled workflows in repos with no activity for 60 days; a push or a manual run re-enables it.
- Supabase also keeps its own daily backups on paid plans; this one is independent of the Supabase plan.

**Restore (into an empty Supabase project or after a disaster)**
```bash
git fetch origin backups && git checkout origin/backups -- .
# if encrypted:
gpg -d schema.sql.gz.gpg > schema.sql.gz && gpg -d data.sql.gz.gpg > data.sql.gz
gunzip schema.sql.gz data.sql.gz
psql "<connection string from Supabase → Connect>" -f schema.sql
psql "<connection string>" -f data.sql
```
Auth users (logins) live in Supabase's `auth` schema and are not part of this dump: after a restore into a new
project, re-create logins from the Users page (passwords/PINs are reset by design).
