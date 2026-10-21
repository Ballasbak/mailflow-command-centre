# Mail Command Centre — development plan

**Owner repository:** `Ballasbak/mailflow-command-centre`  
**Work branch:** `feature/attention-triage`  
**Upstream:** `maathimself/mailflow` (AGPL-3.0 / optional commercial licence)

## Goal

Make MailFlow surface *only messages requiring attention*, with a priority, reason,
action and any deadline, and allow the owner to mark a result resolved or expected.

Target inboxes: personal Gmail, RepairHub Google Workspace with aliases, and Yahoo.
The existing local MailFlow lab on port **8080** remains the working baseline.

## Phase 1 — repository foundation (this branch)

- Register an inert `attention-triage` plugin; **no automatic processing yet**.
- Define a strict, tested AI-output contract with `YES`, `NO` or `REVIEW`.
- Treat message bodies as untrusted text and parse/validate all AI output.
- No mailboxes, secrets, tokens, local volumes or user emails committed to GitHub.

## Phase 2A — permission-checked classifier bridge (36 baseline tests passed)

- Scoped AI provider bridge in `backend/src/services/pluginAi.js`, exposed through the
  reviewed plugin capability surface; requires current per-user AI permission and
  summarization feature enabled for each request.
- Bounded system/user prompts and response size; no raw provider access, keys or tokens
  exposed to the plugin.
- `classifyAttentionEmail()` orchestrates classification without reading or mutating mail.
  Provider failures, access denial and invalid JSON return explicit failed results —
  **never** `ATTENTION: NO`.
- Targeted offline unit tests added for access, failures, shape and safety.

## Phase 2B1 — incoming-email queue staging (36 baseline tests passed)

- When BOTH per-user activation and per-account opt-in are true, MailFlow's existing
  `inboxIngest` hook sends newly inserted inbox message ids (including already-read
  arrivals) to a bounded account-scoped database enqueue. Block-list/rule-deleted
  messages are excluded.
- Write-once `plugin_annotations['attention-triage'] = { status: 'QUEUED', ... }`:
  duplicate syncs never erase a classified result or an owner's future decision.
- The hook makes **no AI calls**, no changes to message read state and no IMAP writes.
- All activation gates are OFF by default. There is no UI or per-account enable
  route yet, so users cannot activate processing in this build.
- **Recovery limitation:** a queue-write error is logged without changing mail.
  Phase 2B3 can now recover inbox messages, but moved-by-rule and old-dated
  arrivals still need coverage before unattended live use.

## Phase 2B2 — AI background worker (59 focused tests passed)

- MailFlow's existing per-account plugin tick checks both activation gates before
  scheduling. On eligible connected accounts it runs once per minute.
- Only one AI request globally may be in flight at a time. A claim is an atomic
  `FOR UPDATE SKIP LOCKED` database operation with a ten-minute lease.
- The classifier runs **outside** IMAP synchronisation and saves results by a
  lease-ID compare-and-swap. Expired leases are reclaimable after process crashes;
  an old worker cannot overwrite a newer result or a future owner annotation.
- Provider/format errors retry after 5 and 15 minutes. Three failed AI attempts
  become `NEEDS_REVIEW`, **never** `ATTENTION: NO`.
- Classification only stores metadata in the plugin annotation. No message
  movement, reading flags, sending or deletion. Processing is opt-in and OFF.
- The recovery scan remains conservative, and activation controls do not
  exist yet. **Do not turn this on with real mail or deploy over the existing
  v3.8 lab** until all safety gaps are addressed.
- This is at-least-once AI processing after a crash; duplicate provider calls
  can occur during lease recovery, but the lease prevents stale result writes.

## Phase 2B3 — conservative incoming-email recovery (81 targeted tests passed)

- New messages whose initial queue write failed can be found using
  `messages.synced_at` and the absence of an Attention Triage annotation.
- Recovery is scoped to an account, the INBOX, a server-issued activation
  timestamp, and a 7-day lookback on the original email Date header.
- Each reconciliation queues at most 25 messages per tick with
  `FOR UPDATE SKIP LOCKED`, and leaves existing annotations untouched.
- Missing, malformed, noncanonical or future activation timestamps prevent
  both ingestion and worker activation. No activation controls exist yet.
- **Remaining gaps:** messages moved from INBOX by rules before failed
  enqueue, or newly delivered messages with Date headers older than seven
  days, can be missed. These cases need additional handling or visible
  manual review before unattended use. This is not 100% delivery assurance.
- A future activation route must record the starting timestamp server-side
  only after verifying an initial mailbox sync.

## Phase 2C1 — owner-scoped dashboard API (96 backend tests passed)

- An authenticated `GET /api/attention/items` endpoint is mounted by the
  bundled plugin at `/api/attention` and requires per-user plugin activation.
- Queries join `messages` to `email_accounts` and always filter by the signed-in
  user's ID; optional mailbox selection cannot reveal other users' mail.
- Returns only minimal sender, subject, time, priority, reason, recommended
  action and deadline. Email body/HTML, raw annotations and secrets are excluded.
- Hides classified NOISE and owner RESOLVED/EXPECTED records, but includes
  failed, queued, retrying and review-needed messages so failures stay visible.
- Maximum 50 results per request, read-only, with private/no-store caching.
- The GET feed remains read-only. Owner acknowledgement is a separate PATCH
  capability (Phase 2C3) that changes only plugin metadata.
- Unit tests are green; real PostgreSQL tests remain outstanding.
## Phase 2C2 — Needs Attention dashboard (5 frontend tests, lint, build passed)

- An activated-plugin-only `Needs Attention` nav entry opens its own modal,
  rather than taking over MailFlow's existing GTD right-hand sidebar.
- Uses `GET /api/attention/items` to show HIGH / REVIEW / All views with
  per-mailbox filtering, timestamps, sender, reason and suggested action.
- Supports a manual refresh and refreshes only while the dashboard is open.
- `Open email` uses MailFlow's existing authenticated message/reading-pane
  handling. No automated mark-read, send, move, archive or delete action added.
- A small generic `sidebar-nav` plugin seam is added to core Sidebar;
  all other UI files are in `frontend/src/plugins/attention-triage/`.
- The dashboard was read-only until Phase 2C3 introduced controlled owner
  acknowledgements. No message read/move/delete flags are changed.
- The frontend selector unit tests, lint and Vite build have passed.
## Phase 2C3 — explicit Expected / Resolved controls (implemented, tests pending)

- `PATCH /api/attention/items/:id/status` accepts only `OPEN`, `EXPECTED`
  and `RESOLVED` from the signed-in, activated plugin owner.
- The SQL joins the message account to the signed-in user and updates only
  `messages.plugin_annotations['attention-triage']`, preserving the classifier
  result, email content and flags. Non-actionable, deleted or other-owner
  messages are indistinguishable and are not modified.
- A successful action records the last status, the server timestamp and the
  acting user ID. Full append-only audit history is not implemented yet.
- The dashboard removes items only after a successful server response;
  failed saves remain visible with an error. Undo reopens the item.
- Action buttons appear only for completed classifications or `NEEDS_REVIEW`
  items, not for queued/processing/retrying messages.
- The new backend and frontend tests, along with frontend production build,
  must pass before this milestone is closed.
## Phase 2D — isolated local development lab (prepared, not started)

- A dedicated docker-compose.cc-dev.yml builds current fork source and
  binds only the frontend at 127.0.0.1:8081, away from the existing
  localhost:8080 application (which would otherwise share browser cookies
  if both used localhost). PostgreSQL, Redis and application services belong
  exclusively to the mailflow-cc-dev Compose project.
- scripts/prepare-attention-dev.mjs generates unique secrets locally into
  .env.cc-dev and never prints them. Git and Docker contexts exclude this file.
- scripts/seed-attention-dev.sql adds only idempotent synthetic data to cc_dev
  and refuses all other DB names/users and pre-existing real-mail accounts.
- The synthetic test account is disabled with no IMAP transport or credentials.
- Full instructions: docs/ATTENTION-ISOLATED-LAB.md.
- The owner has NOT yet started this new development instance. No live MailFlow
  database, image, SMTP/IMAP setting or container has been touched.
## Phase 2E — isolated real-PostgreSQL queue rehearsal (prepared, not executed)

- The synthetic dashboard/acknowledgement/Open Email exercise has passed.
  Opening the fictional customer email left is_read=false, ownerStatus=OPEN.
- A manually invoked guarded test is in
  backend/src/dev/attentionPostgresCheck.js. It checks actual enqueue, claim,
  lease recovery, retry, review, missing-annotation recovery, owner feed and
  acknowledgement/Undo SQL with three temporary fake rows.
- It rejects any database other than cc_dev, any live mailbox/credential,
  multiple development users, or missing explicit CC_DEV_SQL_TEST=1 opt-in.
- It does not call an AI provider or connect IMAP/SMTP. Fake model output
  exercises the strict local attention parser only.
- This is not a full real-AI end-to-end integration test. The integration
  rehearsal has not yet run; do not count it as passed until owner output.
- Runbook: docs/ATTENTION-ISOLATED-LAB.md (Phase D).
## Next development slices (not yet implemented)

1. Resolve moved-by-rule and old-dated recovery gaps without bulk
   classifying the historical mailbox.
2. Add authenticated per-account opt-in capturing the baseline server-side
   and a reliable immediate disable mechanism.
3. Test the new acknowledgement flow, then run end-to-end SQL checks
   against isolated PostgreSQL and a separate Docker development instance.
4. Add a durable per-action audit log before unattended live use.
5. Activate one mailbox only after owner approval, then expand carefully.
### Frontend checks (Node 22, isolated environment)

```powershell
cd C:\Users\fnico\Projects\mailflow-command-centre\frontend
npm ci
npm run lint
npm test -- src/plugins/attention-triage/attentionView.test.js
npm run build
```

These commands belong in an isolated Node 22 development container, not the
working MailFlow lab. Nothing should deploy or reuse live credentials.
## Safety rules

- Never send, reply, delete, mark read, move, archive, or unsubscribe automatically.
- No bulk classification of the imported mailbox by default.
- API/model failures must leave messages eligible for review and retry.
- Avoid alarming the owner about events already acknowledged as expected.
- Rate-limit AI calls and keep an audit of triage decisions / owner acknowledgements.
- Do not reuse the working `mailflow-lab` volumes, credentials or Docker ports.
- Do not assume a ChatGPT subscription supports unlimited unattended AI calls.

## Checks

When dependencies are installed in the development checkout:

```powershell
cd C:\Users\fnico\Projects\mailflow-command-centre\backend
npm ci
npm run lint:plugins
npm test -- src/plugins/attention-triage/policy.test.js src/plugins/attention-triage/classify.test.js src/services/pluginAi.test.js src/services/pluginMessageQueue.test.js src/services/pluginMessageRecovery.test.js src/services/pluginMessageWorker.test.js src/services/attentionRead.test.js src/services/attentionAcknowledge.test.js src/plugins/attention-triage/ingest.test.js src/plugins/attention-triage/baseline.test.js src/plugins/attention-triage/reconcile.test.js src/plugins/attention-triage/routes.test.js src/plugins/attention-triage/worker.test.js src/plugins/loadPlugins.test.js
```
