# Phenomenal Grow — V1 Implementation Plan

**Source:** `Docs/PHENOMENAL GROW.md` (V1 PRD, 48 sections)
**Promise:** Turn Conversations Into Growth / Never lose the conversation
**Journey:** Capture → Understand → Act → Follow Up → Convert → Retain → Re-engage

---

## 1. How to read this plan

- PRD Tier 1 (Core) must all ship in V1. Tier 2 (Important) ships in V1 but phased after core is stable. Tier 3 is explicitly out.
- V1 exclusions (non-negotiable): AI, broadcast/mass messaging, full booking, email marketing, accounting/invoicing, website builder, social management, project management, ticketing, enterprise CRM complexity, advanced ad analytics.
- Every phase ends with acceptance criteria mapped to PRD questions: Who / Where from / What happening / What next / What outcome.

---

## 2. Architectural decisions (LOCKED 2026-10-11 — update here if they change)

### 2.1 Stack (locked)

| Layer | Choice | Why |
|---|---|---|
| Monorepo | Turborepo + pnpm workspaces | One repo for web + api + jobs + shared types; matches 8 product areas without fragmentation |
| Web app | Next.js (App Router, TypeScript) + Tailwind + shadcn/ui | Covers PRD mobile (`do the work`) + desktop (`manage the work`) as one responsive PWA; fastest to V1, no native app needed |
| API | NestJS (TypeScript, REST) + Prisma ORM | Clear module boundaries (contacts, inbox, pipelines, follow-ups, appointments, orgs); RBAC + multi-tenancy easier than Next API routes alone |
| DB | Device-native PostgreSQL (Windows service) in dev; Compose Postgres on VPS | No WSL/Docker needed on laptop; JSONB for custom fields, full-text search for contacts |
| Queue / scheduler | pg-boss (Postgres-backed, no Redis anywhere) | Required for: follow-up sequences, reminders, re-engagement timers, DNC enforcement, appointment nudges. One less service to run. |
| Realtime | WebSocket (Socket.io) API → Next.js | Inbox needs-reply, assignment, reply-received badges without polling |
| Auth | Better Auth (email + password) in `apps/web`, Prisma-backed sessions | PRD needs multi-org membership + Owner/Agent roles; NestJS API verifies the Better Auth session per request |
| File storage | Cloudflare R2 via S3-compatible API (`packages/storage`). Supabase is NOT used. | Inbox attachments view; R2 = S3 API, no vendor SDK lock-in |
| Hosting | Web on Cloudflare Pages, API + worker + Postgres + Redis on a VPS with Docker. Vercel is NOT used. | Cheap, preview-friendly web + full-control backend; single-VPS Compose remains the fallback |

**Alternative if solo-founder speed > scalability:** Next.js full-stack (API routes + Prisma + Trigger.dev for jobs) and split NestJS out only when team grows. Decision needed before Phase 0 exit.

### 2.2 Multi-tenancy model

- Every row scoped by `organisationId`. No cross-org queries ever.
- Membership: `User <> OrganisationMembership (role: OWNER | AGENT, active)` — one user can belong to LifeSolve Studio + Phenomenal Network separately (PRD §37).
- Agent visibility rule enforced at query layer, not just UI: Agents only see assigned contacts (PRD §30). Admin sees all.
- Deactivation (PRD §32): `membership.active=false` → reassign flow → history preserved (activities keep `actorId` snapshot).

### 2.3 WhatsApp integration strategy

- **Use official WhatsApp Business Cloud API only** (via Meta or BSP like Twilio/360dialog). Abstraction layer `WhatsAppProvider` interface so multiple numbers (§23) and future BSP swap don't touch domain logic.
- Rule out unofficial libraries (Baileys etc.) for V1: bannable, breaks sequences/reminders reliability.
- Webhook → normalize → `conversation-events` queue → idempotent ingest (dedupe by provider message ID).
- One person = one contact: match inbound by `phone (E.164)` + `organisation + whatsappNumberId`; if archived/inactive → reactivate, never duplicate (§10).
- Outbound replies + sequence messages go through templates where Meta requires it (24h window awareness). DNC (§9) is a hard stop checked at enqueue + send time.
- Attachments: download from provider, store in S3, link to message.

### 2.4 Domain boundaries (NestJS modules)

`organisations / users / whatsapp-numbers / contacts / conversations+messages / pipelines / followups+sequences / appointments / capture-forms / import-export / reports / notifications / activities`

Shared kernel: `Outcome (ONGOING|CONVERTED|NOT_CONVERTED + reason)`, `ContactStatus (ACTIVE|INACTIVE|ARCHIVED|DNC)`, `ActivityEvent` (single timeline writer — every mutation emits an event, §29).

### 2.5 Core data model (first migration)

```
Organisation(id, name, slug)
User(id, name, email, phone)
OrganisationMembership(id, orgId, userId, role, active)
WhatsappNumber(id, orgId, provider, providerNumberId, label, assignmentRules)
Contact(id, orgId, name, phoneE164 unique-per-org, email, source, referredBy, status, assignedAgentId, customFields JSONB, lastMessageAt, nextActionAt)
ContactMerge(id, orgId, survivingId, mergedId, mergedAt, snapshot)
Tag(id, orgId, name) + ContactTag(contactId, tagId)
Pipeline(id, orgId, name, type) + Stage(id, pipelineId, name, order, expectedAction, isOutcomeStage)
ContactPipeline(contactId, pipelineId, stageId, outcome, outcomeReason, enteredAt, convertedAt)
Conversation(id, orgId, contactId, whatsappNumberId, status: OPEN|CLOSED, assignedAgentId)
Message(id, orgId, conversationId, providerMessageId unique, direction, type, body, mediaUrl, sentAt)
Note(id, orgId, contactId, authorId, body)
Followup(id, orgId, contactId, type: MANUAL, dueAt, title, doneAt)
Sequence(id, orgId, name, kind: GUIDED|CUSTOM) + Step(id, seqId, dayOffset, template, order) + Enrollment(id, seqId, contactId, status: ACTIVE|PAUSED|STOPPED|COMPLETED, nextRunAt)
Appointment(id, orgId, contactId, date, time, type, assigneeId, status: SCHEDULED|COMPLETED|CANCELLED|NOSHOW)
CaptureForm(id, orgId, name, fields JSON, source, pipelineId, stageId, assigneeId, sequenceId)
Activity(id, orgId, contactId, type, actorId, payload JSON, at)
SavedView(id, orgId, ownerId, name, filters JSON)
```

Indexes: `(orgId, phoneE164)`, `(orgId, assignedAgentId, nextActionAt)`, `(orgId, status)`, full-text on name/phone/email.

### 2.6 Sequence / reminder engine rules (PRD §18)

State machine per enrollment: `ACTIVE → PAUSED (on reply) → ACTIVE (manual resume) | STOPPED (convert | DNC | booking | manual) | COMPLETED`.
- Every tick: skip if `contact.status=DNC` or enrollment stopped.
- Reply webhook auto-pauses active enrollments and creates `Needs Reply` signal.
- Convert / appointment-booked stops or swaps sequence per pipeline config.
- Re-engagement (§20) is a scheduled scan: `inactive > N days → enroll` (configurable per org).

### 2.7 Reporting model

No OLAP in V1. Materialized counters + direct queries (§35): contacts (new/active/inactive/archived/sources), pipeline (entered/progressed/converted/not/ongoing), follow-ups (completed/due/overdue/outstanding), conversions (+reasons), source funnel (`source → conversations → conversions`), agent activity. Daily rollup job populates `report_daily(orgId, date, metrics JSON)`.

---

## 3. Design system (before any feature UI)

### 3.1 Principles (from PRD §4)

Actions over administration. Home answers “Who needs me right now?” Every active contact shows a next action. Simple surface, powerful underneath. Guided customisation (starter pipelines/tags/sequences, never blank).

### 3.2 Tokens

- Type: Inter (UI) — 13/14 base, 20/24 headings; tabular numerals for counts/dates.
- Color: neutral slate base + one action green (WhatsApp-adjacent, not WhatsApp clone) + amber (due) / red (overdue/DNC) / violet (conversion). DNC always high-contrast badge.
- Shape: 10px radius cards, 8px inputs; 44px touch targets (mobile-first).
- Density: inbox list comfortable on desktop, compact on mobile; pipeline board horizontal scroll on mobile, drag on desktop.

### 3.3 Component inventory (build once in `packages/ui`)

`ActionCard (needs-reply/overdue/due)`, `ContactHeader (source/pipeline/stage/assignee/next-action)`, `Timeline`, `PipelineBoard + StageColumn`, `SequenceBuilder (day-offset steps)`, `CaptureForm renderer`, `SavedViewBar`, `CommandPalette (search contacts)`, `DNCBanner`, `MergeReview`, `TodayView`.
Patterns: every destructive action confirms; every automation shows “why” (e.g. “Paused — Sarah replied”); every empty state offers the guided next step.

### 3.4 Key screens (wireframe before code, per phase)

Home (action dashboard §6) → Inbox (split view §7) → Contact 360 (profile + timeline + pipelines + follow-ups §8/29) → Pipeline board (§14) → Follow-ups queue (§17) → Appointment day list (§21) → Reports simple tables (§35) → Settings (org, numbers, pipelines, tags, fields, sequences, team).

### 3.5 Accessibility / i18n readiness

WCAG AA contrast, keyboard-navigable inbox, date/time in org timezone; strings externalized (church vs business wording variants, §3.3 — never hardcode “Lead” where “Visitor” fits).

---

## 4. Phased delivery

### Phase 0 — Foundations (1–2 weeks)
**Goal:** decisions locked, skeleton running, design tokens live.
- Lock §2 stack + hosting + WhatsApp provider (Cloud API direct vs BSP).
- Turborepo scaffold: `apps/web, apps/api, apps/worker, packages/ui, packages/types, packages/config`.
- Auth + multi-org switcher + invites + OWNER/AGENT roles; org-scoped Prisma middleware.
- CI (lint/type/test/build), preview envs, Docker Compose local (pg + redis), seed script with demo org.
- Design tokens + `packages/ui` shell + App shell (nav: Home/Inbox/Contacts/Pipelines/Follow-ups/Appointments/Reports/Settings).
- **Exit:** `pnpm dev` runs web+api+worker; login → create org → invite agent → switch orgs. **PRD:** §30, §37, §38 partial.

### Phase 1 — Contacts 360 + team guardrails (2 weeks, Tier 1)
**Goal:** one person = one record + relationship memory.
- Contact CRUD, statuses (Active/Inactive/Archived/DNC with DNC hard-stop §9), reactivation on new message (§10).
- Tags (starter set + custom, §13), custom fields per org (§8), internal notes (§28), activity timeline writer (§29).
- Search/filters + saved views (§12), agent scoping (only assigned §30), deactivation → reassign (§32).
- Import (CSV mapping + dup detection) / export (§34 basic).
- Duplicate detect → warn → review → merge preserving all history (§11).
- **Exit:** create/search/merge/contact-timeline/demo import all work; agent sees only assigned.

### Phase 2 — WhatsApp Inbox (2–3 weeks, Tier 1)
**Goal:** work conversations without leaving the CRM (§7).
- Connect multiple numbers (§23), webhook verify + ingest (idempotent), E.164 normalize + match-or-create contact.
- Inbox views (Needs Reply / Follow-up Due / Unassigned / Assigned to Me / Recently Active / Closed), reply directly, attachments view, close conversation.
- Side panel context (source/pipeline/stage/assignee/next action), assign, create follow-up, move stage inline.
- Realtime badges + action notifications (reply/assignment) (§33).
- **Exit:** two numbers → inbound routes correctly; reply from CRM delivers; Needs Reply clears on reply.

### Phase 3 — Pipelines + outcomes (1–2 weeks, Tier 1)
**Goal:** journeys that fit church and business (§14–16, §36).
- Custom pipelines/stages (CRUD, reorder), starter templates (Business / Church / Coach), per-pipeline outcome definition.
- Contact in multiple pipelines simultaneously (§15); move stage from contact + inbox.
- Outcomes: Ongoing/Converted/Not Converted + reasons; not-converted stays re-engageable.
- **Exit:** Sarah flows Visitor→Volunteer without duplicate; business converts to Customer; reports can split converted/not/ongoing.

### Phase 4 — Follow-ups + sequences + re-engagement (2–3 weeks, Tier 1)
**Goal:** never lose the conversation (§17–20).
- Manual follow-ups (title/due/assignee/done), queue views (overdue/due-today).
- Guided templates (New Lead, Visitor, Appointment, Unresponsive, Customer, Event) + custom builder (day offsets).
- Engine (§2.6): pause on reply, stop on convert/DNC/booking; audit every pause/stop in timeline.
- Post-conversion journeys (§19) + inactivity scanner → re-engagement enroll → reactivate on reply.
- **Exit:** Day0/2/5/10/21 sequence fires correctly; reply pauses; DNC stops everything.

### Phase 5 — Home + Agent Today (1–2 weeks, Tier 1)
**Goal:** “Open → know what to do” (§6, §31).
- Home priority stack: Needs Reply → Overdue → Due Today → New Contacts → Active Opportunities → Snapshot.
- Agent Today (needs reply/overdue/due/appointments/recently assigned/completed); admin team rollup.
- Next-action invariant: every active contact surfaces one suggested action.
- **Exit:** usability test — new agent completes 5 actions without training.

### Phase 6 — Appointments + attribution + capture (2 weeks, Tier 2)
**Goal:** lightweight scheduling + know where people came from (§21–27, §24–25).
- Appointments (date/time/type/assignee/status), pipeline linkage, confirm/remind/post-follow-up via queue.
- Sources + referred-by split (§25), multi capture forms (§27) with per-form pipeline/stage/assignee/sequence, QR/embed.
- FB/IG attribution passthrough only (click/ad IDs → conversation → outcome, §24) — no ad platform build.
- **Exit:** form submit → contact + pipeline + sequence; appointment no-show tracked.

### Phase 7 — Reports + notifications polish (1–2 weeks, Tier 1/2 remainder)
**Goal:** what happened / what's working / what needs attention (§35, §33).
- Reports: contacts, pipeline, follow-ups, conversions (+reasons), source funnel, agent activity. CSV export.
- Notification prefs, action-only rule; appointment + sequence + assignment coverage.
- **Exit:** source report shows e.g. Instagram 80 → 14; agent report shows handled/completed/outstanding/conversions.

### Phase 8 — Onboarding, mobile PWA, hardening → V1 launch (2 weeks)
**Goal:** working in minutes (§38, §39) + production-ready.
- 5-step onboarding (name org → connect number → pick starter pipeline → add team → receive conversation); sample data toggle.
- PWA (install, offline inbox read, push for assignments/replies), mobile QA on real devices.
- Security (rate limits, audit log, backups, DNC compliance check), perf (inbox <1s, search <500ms), docs + demo video.
- **Exit:** fresh org onboarded in <10 min; V1 success criteria (§44) demonstrable end-to-end.

**Explicitly deferred:** AI (§40), broadcast (§41), all §42 exclusions.

---

## 5. Cross-cutting checklists

- **Testing:** unit (sequence state machine, merge, scoping) → integration (webhook→contact→timeline, sequence tick) → e2e (capture→assign→pipeline→follow-up→appointment→convert→re-engage). Contract tests for provider abstraction.
- **Observability:** structured logs with orgId/contactId, queue dashboards, webhook DLQ, daily report job, uptime + send-rate alerts.
- **Security/privacy:** org isolation tests, agent scope tests, PII encryption at rest (phone/email), media access signed URLs, DNC audit trail, GDPR-style export/delete.
- **Data migration:** CSV importer is the V1 migration path; field-map preview + dry-run + dup report before commit.

---

## 6. Milestones & rough sizing

- M0 Foundations (Phase 0) → M1 Contacts (Phase 1) → M2 Inbox live (Phase 2, first real conversations) → M3 Pipelines+Follow-ups (Phase 3–4, core promise works) → M4 Action home (Phase 5) → M5 Capture+Appointments (Phase 6) → M6 Reports (Phase 7) → V1 Launch (Phase 8).
- Solo/small-team estimate: ~13–18 weeks total at steady pace. Cut nothing from Tier 1; if pressed, defer import/export polish and extra guided templates to 1.1.

---

## 7. Immediate next actions (propose to start Phase 0)

1. Confirm stack + WhatsApp provider + hosting + repo branch strategy.
2. Scaffold monorepo + CI + local Docker + seed demo org.
3. Wireframe Home + Inbox + Contact 360 and lock design tokens.
4. Then build Phase 1 vertically (one org → contacts → timeline) before parallelizing.
