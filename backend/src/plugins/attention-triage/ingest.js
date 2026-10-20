// Fast, opt-in ingest hook: only queue DB metadata. Never call AI from the IMAP sync.
import {
  enqueuePluginMessageIds,
  getAccountConfig,
  isPluginActivatedForAccount,
  logger,
} from '../api.js';

const PLUGIN_ID = 'attention-triage';

export function selectAttentionCandidates(newInboxIds, deletedIds) {
  const excluded = deletedIds instanceof Set ? deletedIds : new Set(deletedIds || []);
  return [...new Set((newInboxIds || []).filter(id => !excluded.has(id)))];
}

// Activation requires BOTH MailFlow's per-user plugin toggle AND the per-account
// opt-in. The missing config defaults to OFF. Any failed gate is OFF, not ON.
export async function triageEnabledForAccount({ account } = {}) {
  if (!account?.id || !account?.user_id) return false;
  try {
    if (!await isPluginActivatedForAccount(PLUGIN_ID, account.id)) return false;
    const config = await getAccountConfig(PLUGIN_ID, account.id);
    return config?.enabled === true;
  } catch {
    return false;
  }
}

export async function inboxIngest({ account, newInboxIds, deletedIds } = {}) {
  // The registry awaits this gate for candidate collection, but its dispatch
  // path does not await async gates; check again inside the handler.
  if (!await triageEnabledForAccount({ account })) return;
  const ids = selectAttentionCandidates(newInboxIds, deletedIds);
  if (!ids.length) return;
  try {
    await enqueuePluginMessageIds({
      accountId: account.id, pluginId: PLUGIN_ID, messageIds: ids,
    });
  } catch {
    // Do not disclose sender, subject or body in logs.
    // A future reconciler must recover unqueued arrivals if persistence fails.
    logger.warn('Attention triage enqueue failed; recovery not yet enabled');
  }
}
