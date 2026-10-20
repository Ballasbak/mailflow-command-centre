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

## Phase 2A — permission-checked classifier bridge (implemented, tests pending)

- Scoped AI provider bridge in `backend/src/services/pluginAi.js`, exposed through the
  reviewed plugin capability surface; requires current per-user AI permission and
  summarization feature enabled for each request.
- Bounded system/user prompts and response size; no raw provider access, keys or tokens
  exposed to the plugin.
- `classifyAttentionEmail()` orchestrates classification without reading or mutating mail.
  Provider failures, access denial and invalid JSON return explicit failed results —
  **never** `ATTENTION: NO`.
- Targeted offline unit tests added for access, failures, shape and safety.

## Next development slices (not yet implemented)

1. Add opt-in account-level ingestion and a bounded, recoverable triage queue.
   Store results in the existing `messages.plugin_annotations['attention-triage']`.
   Deduplicate and retry failures; never silently treat failed AI as unimportant.
3. Add a read-only API and a `Needs Attention` dashboard view; statuses:
   OPEN / REVIEW / RESOLVED / EXPECTED. Keep owner decisions persistent.
4. Test against synthetic messages and a separate development Docker environment
   before connecting live mail. Ensure no cross-account data leaks.
5. Only after owner approval: activate one account, compare decisions to manual
   triage, set up alert delivery, then add remaining mailboxes.

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
npm test -- src/plugins/attention-triage/policy.test.js src/plugins/attention-triage/classify.test.js src/services/pluginAi.test.js src/plugins/loadPlugins.test.js
```
