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
- Unit tests are green; real PostgreSQL read and acknowledgement behaviour
  passed with synthetic mail on the isolated development stack.
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
## Phase 2C3 — explicit Expected / Resolved controls (PASS — synthetic browser exercise)

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
- Targeted unit tests (109 backend and 6 frontend), both lint checks and the
  Vite build passed. The owner verified real PostgreSQL-backed Expected,
  Resolved, Undo and persistence with synthetic messages.
## Phase 2D — isolated local development lab (PASS — synthetic browser rehearsal)

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
- The owner started the dedicated development stack and verified four healthy
  services. Synthetic email/dashboard exercises passed: 4 attention items,
  2 filtered out, Expected / Resolved / Undo and persistence. Open Email left
  the original synthetic message unread and ownerStatus=OPEN. This did not
  change the separate original working MailFlow installation.
## Phase 2E — isolated real-PostgreSQL queue rehearsal (PASS — 21 October 2026)

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
- Owner execution returned Guard passed, PASS 1/6 through PASS 6/6, and
  Cleanup: removed only 3 temporary synthetic test rows. All six real-SQL
  checks passed: enqueue and deduplication, leases and stale-write protection,
  retry limits, missing-annotation recovery, simulated classification, and
  owner acknowledgement/Undo preservation.
- The test used deterministic FAKE model output. It did not call a real AI
  provider or connect an email account; do not treat it as live AI proof.
- Runbook: docs/ATTENTION-ISOLATED-LAB.md (Phase D).
## Phase 2F1 — owner-scoped mailbox controls (implemented, targeted tests PASS — 30 October 2026)

- Introduces a hard-coded FALSE release fuse for automated inbox ingestion and
  background AI ticks. An old plugin configuration or accidental environment
  variable cannot turn on automatic classification in this revision.
- An authenticated owner-only GET /api/attention/accounts lists each user's
  mailbox safely, distinguishes recorded opt-in from effective monitoring,
  and always reports canEnable=false, monitoringEnabled=false.
- An authenticated PATCH /api/attention/accounts/:id/automation accepts
  only enabled=false. All requests with enabled=true return HTTP 423 (locked).
- Disable is one account-owner-filtered SQL operation that also deletes the
  old activatedAt baseline. It does not disconnect or modify the mailbox.
- A collapsed 'Monitoring controls' section in the dashboard shows account
  status and a Disable button for any previously recorded opt-in.
- Ingest additionally refuses disabled and non-IMAP accounts.
- Verification on 30 October 2026: 60 targeted backend tests across seven
  files passed, plugin boundary lint passed, all 6 frontend Attention View
  tests passed, frontend plugin lint passed and production Vite build passed.
  Both updated 8081 development images were rebuilt and all four development
  containers reported healthy. HTTP checks: 8080 and 8081 returned 200;
  unauthenticated Attention account status correctly returned HTTP 401.
  The release fuse remained hard-coded false inside the running backend.
  Main 8080 remained version 3.8.0 with one real Gmail account untouched.
- IMPORTANT: this is **staging**, not approval to activate an email account.
  The activation path remains deliberately unavailable until initial backfill,
  moved-by-rule/old-dated recovery and AI usage limits are addressed.
## Phase 2F2 — durable owner-decision audit (PASS — 30 October 2026)

- Migration `0069_attention_action_audit.sql` adds a metadata-only audit table
  for owner actions: actor, account ID, message ID, previous/new status and time.
  The table deliberately stores **no email bodies, subjects, sender addresses or keys**.
- The existing Expected / Resolved / Undo endpoint now writes a status update and
  audit event as one atomic PostgreSQL statement. If recording fails, both fail.
  Ownership, deleted-message and actionable-message checks remain enforced.
- An application-level append-only history is retained if a message is expunged;
  deleting a user cascades to delete their audit records. This is not a tamper-proof
  cryptographic log or a complete audit of automatic AI decisions.
- `backend/src/dev/attentionAuditPostgresCheck.js` provides a guarded offline
  test against the isolated cc_dev database only, with random temporary synthetic
  rows removed on completion.
- The existing queue rehearsal now verifies audit status transitions and cleans
  only its own temporary audit events. No real mailbox is connected.
- **Verified against isolated PostgreSQL:** migration 0069 applied, guarded
  audit rehearsal PASS (Expected, Undo, wrong-owner denial, noise exclusion,
  message content/read flag preservation); original queue rehearsal PASS 6/6
  with audited owner actions. All temporary audit/message rows cleaned up.
  A separate Node 22 regression run passed 60 focused tests and lint.
- Run audit test only inside the private cc_dev Docker project:

  ```powershell
  docker compose -p mailflow-cc-dev --env-file .env.cc-dev -f docker-compose.cc-dev.yml run --rm -T --no-deps -e CC_DEV_AUDIT_TEST=1 backend node src/dev/attentionAuditPostgresCheck.js
  ```
- Automatic classification and email sending remain **hard-disabled** by the
  existing release fuse. This is not approval for live deployment.

## Next development slices (not yet implemented)

1. Resolve moved-by-rule and old-dated recovery gaps without bulk
   classifying the historical mailbox.
2. Complete the account activation path ONLY after the remaining release
   safeguards pass. OFF-only controls are now implemented in Phase 2F1.
3. Test the entire processing path with deterministic stubbed model replies
   after explicit per-account activation safeguards are built, then verify
   provider limits before authorizing any real AI use.
4. Extend the owner-action audit to AI processing, failed jobs and future outgoing
   replies; add a private owner-visible history before unattended live use.
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
