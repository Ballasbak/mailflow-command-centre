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

## Phase 2B3 — conservative incoming-email recovery (implemented, tests pending)

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

## Phase 2C1 — owner-scoped dashboard API (implemented, tests pending)

- An authenticated `GET /api/attention/items` endpoint is mounted by the
  bundled plugin at `/api/attention` and requires per-user plugin activation.
- Queries join `messages` to `email_accounts` and always filter by the signed-in
  user's ID; optional mailbox selection cannot reveal other users' mail.
- Returns only minimal sender, subject, time, priority, reason, recommended
  action and deadline. Email body/HTML, raw annotations and secrets are excluded.
- Hides classified NOISE and owner RESOLVED/EXPECTED records, but includes
  failed, queued, retrying and review-needed messages so failures stay visible.
- Maximum 50 results per request, read-only, with private/no-store caching.
- No frontend dashboard or owner acknowledgment controls have been wired yet.
- Unit tests for the API and reader are pending, as are real PostgreSQL checks.
## Next development slices (not yet implemented)

1. Resolve moved-by-rule and old-dated recovery gaps without bulk
   classifying the historical mailbox.
2. Add authenticated per-account opt-in capturing the baseline server-side
   and a reliable immediate disable mechanism.
3. Build the Needs Attention dashboard and owner-controlled
   RESOLVED / EXPECTED acknowledgements against this read-only API.
4. Test SQL against real isolated PostgreSQL and a separate Docker dev
   instance, without reusing lab volumes, credentials or ports.
5. Activate one mailbox only after owner approval, then expand carefully.
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
npm test -- src/plugins/attention-triage/policy.test.js src/plugins/attention-triage/classify.test.js src/services/pluginAi.test.js src/services/pluginMessageQueue.test.js src/services/pluginMessageRecovery.test.js src/services/pluginMessageWorker.test.js src/services/attentionRead.test.js src/plugins/attention-triage/ingest.test.js src/plugins/attention-triage/baseline.test.js src/plugins/attention-triage/reconcile.test.js src/plugins/attention-triage/routes.test.js src/plugins/attention-triage/worker.test.js src/plugins/loadPlugins.test.js
```
