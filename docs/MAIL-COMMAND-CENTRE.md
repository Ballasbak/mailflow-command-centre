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
- **Known incomplete failure mode:** an enqueue database error is logged without
  changing the user's email, but there is no durable reconciliation scan to
  re-discover that message yet. Do NOT enable for live use until recovery is built.

## Phase 2B2 — AI background worker (implemented, tests pending)

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
- The queue still needs a recovery scan for failures at the *initial enqueue*
  stage, and activation controls do not yet exist. **Do not turn it on with real
  mail or deploy it over the local v3.8 lab** until those are addressed.
- This is at-least-once AI processing after a crash; duplicate provider calls
  can occur during lease recovery, but the lease prevents stale result writes.

## Next development slices (not yet implemented)

1. Build initial enqueue reconciliation, bounded to new mail after a recorded
   per-account activation baseline. Prove no old-mail bulk reprocessing.
2. Add authenticated per-account activation controls and a read-only API and
   `Needs Attention` dashboard with owner OPEN / REVIEW / RESOLVED / EXPECTED states.
3. Test with a separate PostgreSQL integration environment and isolated Docker
   development instance, with no shared credentials, ports or mail volumes.
4. Only after owner approval: turn on one mailbox, verify real classifications,
   monitor errors and limits, then add further accounts and alerts.

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
npm test -- src/plugins/attention-triage/policy.test.js src/plugins/attention-triage/classify.test.js src/services/pluginAi.test.js src/services/pluginMessageQueue.test.js src/services/pluginMessageWorker.test.js src/plugins/attention-triage/ingest.test.js src/plugins/attention-triage/worker.test.js src/plugins/loadPlugins.test.js
```
