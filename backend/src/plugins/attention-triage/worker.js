// Single-flight AI worker. One message per tick, at most one AI request globally.
// IMAP sync only enqueues; this task runs on MailFlow's existing plugin tick.
import { claimNextPluginMessage, settlePluginMessage, logger } from '../api.js';
import { classifyAttentionEmail } from './classify.js';
import { triageEnabledForAccount } from './ingest.js';
import { reconcileUnqueuedInbox } from './reconcile.js';

const PLUGIN_ID = 'attention-triage';
const MAX_AI_ATTEMPTS = 3;
const activeAccounts = new Set();
let activeCount = 0;

export async function attentionTriageTick({ account } = {}, {
  enabled = triageEnabledForAccount,
  reconcile = reconcileUnqueuedInbox,
  claim = claimNextPluginMessage,
  classify = classifyAttentionEmail,
  settle = settlePluginMessage,
  warn = logger.warn,
} = {}) {
  if (!account?.id || !account?.user_id) return;
  // No model calls, DB claims or side effects on disabled accounts.
  try {
    if (!await enabled({ account })) return;
  } catch { return; }
  if (activeAccounts.has(account.id) || activeCount >= 1) return;

  activeAccounts.add(account.id);
  activeCount++;
  try {
    // This background step may repair a failed initial queue write. A recovery
    // query failure must not block work that was already durably queued.
    try {
      await reconcile({ account });
    } catch {
      warn('Attention Triage: inbox reconciliation failed; queued work remains available');
    }
    // The owner may have switched off the plugin while reconciliation ran.
    if (!await enabled({ account })) return;
    const job = await claim({ accountId: account.id, pluginId: PLUGIN_ID });
    if (!job) return;
    // A plugin switched off between its timer gate and claim must not run AI.
    // Its lease will naturally expire; the queue is persisted.
    if (!await enabled({ account })) return;
    let outcome = { ok: false, reason: 'worker_error' };
    if (Number(job.attempts) <= MAX_AI_ATTEMPTS) {
      try {
        outcome = await classify({
          userId: account.user_id,
          from: [job.from_name, job.from_email].filter(Boolean).join(' '),
          subject: job.subject || '',
          body: job.content || '',
        });
      } catch {
        // Unexpected AI adapter errors retry using the same lease; never call
        // email actions or convert a failure into ATTENTION: NO.
      }
    }
    const applied = await settle({
      accountId: account.id, pluginId: PLUGIN_ID,
      messageId: job.id, leaseId: job.leaseId,
      attempts: Number(job.attempts), outcome,
    });
    if (!applied) warn('Attention Triage: stale result ignored; another lease owns the message');
  } catch {
    // No email identifiers or content in logs. An unsettled claim is recoverable
    // after its lease expires; do not swallow the problem by setting NO.
    warn('Attention Triage: worker error; pending message stays recoverable');
  } finally {
    activeAccounts.delete(account.id);
    activeCount--;
  }
}
