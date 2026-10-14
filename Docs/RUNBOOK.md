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

## Release readiness (validated 2026-10-14, branch `phase-2b/migration-proof`)

### Environment variables (names only — never commit values)
- Auth/data: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ENCRYPTION_KEY` (min 16 chars; AES-256-GCM for WhatsApp tokens + webhook secrets, fail-closed).
- Meta Cloud API: `WHATSAPP_VERIFY_TOKEN` (legacy shared webhook), `WHATSAPP_APP_SECRET` (legacy signatures), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_API_VERSION` (default `v26.0`), `WHATSAPP_FALLBACK_TEMPLATE` (approved template for out-of-window sends).
- Dev-only escapes (never production): `SKIP_WHATSAPP_SIGNATURE=1`, `WHATSAPP_DRY_RUN=1`, `SKIP_ENGINE=1`, `ALLOW_LEGACY_PLAINTEXT=1` (single migration run only).
- Storage/push: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `API_INTERNAL_URL`, `API_PORT`, `WEB_PORT`.
- Tests only: `TEST_DATABASE_URL` (must end in `_test`/`-test`; the suite refuses anything else — see `vitest.setup.ts`).

### Isolated test database (local)
- Provision: `CREATE DATABASE pgrow_mig_test;` on the local dev Postgres (never on the VPS/production host).
- Run: `TEST_DATABASE_URL="postgresql://<user>:<pass>@localhost:5432/pgrow_mig_test?schema=public" npx vitest run --config ./vitest.config.ts --fileParallelism=false`.
- Integration specs (`ingest`, `isolation`) truncate their own tables per test; they never touch `pgrow` (dev) or production.

### Migration execution (validated)
- Order (lexicographic, verified from-scratch): `20261014110000_init` → `20261014110001_message_status` → `20261014120000_org_webhook_config`. A previous `20261014071940_*` prefix applied the status migration before the init migration and failed (`relation "Message" does not exist`); it was renamed, content unchanged.
- Rehearsal: fresh local DB + `prisma migrate deploy` → all 3 applied; `prisma migrate status` → "up to date" (zero drift vs `prisma/schema.prisma`); 31 tables, 0 rows.
- Staging/production: use `prisma migrate deploy` (never `db push` outside local dev). The legacy `pgrow_test` DB predates migration history (`db:push`-built) and is unsuitable for deploy rehearsal — use a fresh `*_test` database.

### Manual Meta configuration (per organisation, Settings → Meta integration)
1. In Meta → WhatsApp → API Setup copy Phone Number ID, Business Account ID, permanent access token.
2. Connect number in Settings (token encrypted at rest, never displayed again; blank token on edit = keep).
3. Set org webhook secrets (verify token 8–128 chars, app secret from Meta app); point the Meta app at `https://<api>/whatsapp/webhook/org/<orgId>`. Legacy shared path `/whatsapp/webhook` (env tokens) keeps working.
4. Press Test connection: `Saved — not yet tested` vs `Tested OK · <time>` are distinct states; failures carry next steps, never credentials.
5. Disconnect is blocked while any conversation history exists (deleting a number cascades to conversations/messages) — history is never deleted by a settings click.

### Template requirements
- Out-of-window sends require an approved template (`WHATSAPP_FALLBACK_TEMPLATE`); without one the send fails openly with an actionable error — free-form text is never silently substituted.
- Template names must be lowercase `a-z0-9_` as approved in Meta; language like `en_US`; body parameter ≤ 1024 chars. Rejections persist a FAILED message row + timeline event.

### Media storage
- Attachments: Meta download → R2 (`wa/<orgId>/<providerMessageId>`) → message row updated. Download/storage failures become `conversation.media_failed` timeline events; the inbound message is never rolled back. Attachments > 32 MB are refused with an event.
- R2 bucket versioning recommended; DB dumps + R2 versions = full restore (see Backups above).

### Rollback
- Code: redeploy previous image/commit (migrations here are additive only — safe to roll code back without DB rollback).
- Data: `pg_restore` to a new DB, verify, switch `DATABASE_URL`. Rotate `ENCRYPTION_KEY`-dependent secrets only if the key itself is rotated (tokens become undecryptable → reconnect numbers, re-save webhook secrets).

### Tested vs live matrix
- Proven locally (80/80 tests, migration rehearsal, `web` production build): webhook verify (legacy + per-org), number save/edit/test/disconnect guards, status progression/duplicates/out-of-order/tenant isolation, template validation + mocked sends, media failure paths via mocked storage, inbox/sequence/report flows per existing specs.
- NOT proven (no live credentials): real Meta send/receive, real status receipts from Meta, real R2 round-trip, production `migrate deploy`, Pages/VPS deploy.

## Local testing guide (teacher / demo on this machine)

### Startup (two terminals, repo root `D:\Phenomenal Grow`)
1. Terminal 1 (API): `pnpm --filter @pgrow/api dev` → waits on `http://localhost:4000` (`/health` returns `{"ok":true,...}`).
2. Terminal 2 (web): `pnpm --filter @pgrow/web dev` → open `http://localhost:3000`.
3. Prerequisites: local Postgres running (port 5432) and `pnpm install` already done. No seeds or rebuilds needed — demo data is present.

### Shutdown
- Press `Ctrl+C` in each terminal. If a port is busy, do not start a duplicate — check `http://localhost:3000` and `http://localhost:4000/health` first.

### Login
- Open `http://localhost:3000/login`, sign in with email + password (use “Sign up” for a fresh demo user, or an existing account). First login lands on onboarding; pick an organisation to reach Home (`/home`).

### Sample data (already present)
- Contacts (`/contacts`), inbox threads (`/inbox`), pipelines, follow-ups, appointments and reports all have demo rows. Create a contact manually to exercise capture → assign → pipeline → follow-up → convert end to end.

### Manual Meta configuration (`/settings`, owner only)
1. Connect number: label + Phone Number ID + Business Account ID + permanent access token (stored encrypted, never shown again; blank token on edit keeps the stored one).
2. Organisation webhook: save verify token + app secret, point the Meta app at `/whatsapp/webhook/org/<orgId>`.
3. Press **Test connection**: `Saved — not yet tested` vs `Tested OK · <time>` are different states. A lost-key token reports “cannot be decrypted — reconnect the number”.
4. Never paste tokens into chat/terminal — enter them only in the settings form. Never send messages to real customers from demo data.

### Webhook prerequisites (live Meta only)
- Meta must reach the API over a public HTTPS URL; `localhost` cannot receive Meta webhooks. For a live demo either expose the API (tunnel) or skip inbound and demo outbound + statuses after connecting a number.

### What works without live Meta credentials
- Everything except actual send/receive: contacts, inbox UI, pipelines, sequences (dry-run), appointments, reports, settings validation, and every automated test (`npx vitest run --config ./vitest.config.ts --fileParallelism=false` needs only the local isolated test DB).

### Known limitations
- `WHATSAPP_DRY_RUN=1` logs outbound instead of calling Meta (dev only).
- Out-of-window replies need an approved `WHATSAPP_FALLBACK_TEMPLATE`, else the send fails openly with an explanation.
- Disconnecting a number is blocked while it has conversation history (history is never auto-deleted).
