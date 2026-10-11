# Phenomenal Grow — Runbook (V1)

## Local dev (Windows, no Docker)
- Postgres 17 runs as a user process: `D:\pgsql\pgsql\bin\pg_ctl.exe -D D:\pgdata -l D:\pgdata\log.txt -W start`
  (auto-starts on logon via `pgrow-postgres.bat` in the Startup folder).
- Copy `.env.example` → `.env` and fill secrets. Generate values:
  - `BETTER_AUTH_SECRET`: 32 random base64 bytes
  - `ENCRYPTION_KEY`: 32 random base64 bytes (WhatsApp token encryption at rest)
  - `VAPID_*`: `node -e "console.log(JSON.stringify(require('web-push').generateVAPIDKeys()))"` from `apps/api`
- `pnpm install`, `pnpm db:push`, `pnpm db:seed`, `pnpm dev` (turbo: web :3000, api :4000, worker placeholder).
- Dev-only escapes (never in production): `SKIP_WHATSAPP_SIGNATURE=1`, `WHATSAPP_DRY_RUN=1`, `SKIP_ENGINE=1`.

## Backups
- Nightly: `"D:\pgsql\pgsql\bin\pg_dump.exe" -h localhost -U pgrow -Fc pgrow > D:\backups\pgrow-%DATE%.dump`
- Restore: `pg_restore -h localhost -U pgrow -d pgrow-new <file>`, verify, switch `DATABASE_URL`.
- Media lives in Cloudflare R2 (versioned bucket recommended); DB dumps hold everything else.

## Production layout
- Web → Cloudflare Pages (Next.js). Env: `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `DATABASE_URL` (pooler), `API_INTERNAL_URL`, `R2_*`.
- API + engine → VPS with Docker (`docker-compose.yml`: postgres + api + worker images).
- Storage → Cloudflare R2 (S3 API). Never Supabase.
- WhatsApp → Meta Cloud API direct. Webhook: `https://<api>/whatsapp/webhook` with `WHATSAPP_VERIFY_TOKEN`; signatures enforced via `WHATSAPP_APP_SECRET` (no skips in prod).
- Mobile → PWA (manifest + service worker ship with web). Push needs `VAPID_*`; rotate VAPID + `ENCRYPTION_KEY` on any leak.

## Security notes
- Agents see only assigned contacts (query-layer enforcement); reports are owner-only.
- WhatsApp tokens are AES-256-GCM encrypted (`ENCRYPTION_KEY`); legacy plaintext rows still read (re-save to migrate).
- Rate limits: 600 req/min global, 60 req/min on public forms.
- DNC: `/reports` → compliance audit shows automations/outbound on DNC contacts (must stay zero).
- Secrets rotation: Better Auth (log everyone out), Meta token (re-register number), R2 keys, VAPID.

## Going live checklist
1. VPS up, Compose running, `db:push` + smoke login.
2. Pages deploy with prod env; `BETTER_AUTH_URL` = public web URL.
3. Meta app → webhook configured → test message → contact auto-created.
4. R2 keys in; send an attachment; open the signed URL.
5. Register number (token encrypted), unset all `SKIP_*`/`DRY_RUN`.
6. Run DNC audit; confirm COMPLIANT.
