// Conservative inbox reconciliation. Called only from an enabled, background
// plugin tick; never touches mail or sends an AI request.
import { getAccountConfig, recoverMissingPluginMessages } from '../api.js';
import { validActivationBaseline } from './baseline.js';
import { triageEnabledForAccount } from './ingest.js';

const PLUGIN_ID = 'attention-triage';

export async function reconcileUnqueuedInbox({ account } = {}, {
  enabled = triageEnabledForAccount,
  getConfig = getAccountConfig,
  recover = recoverMissingPluginMessages,
} = {}) {
  if (!account?.id || !account?.user_id) return [];
  // Repeat the gate inside the reconciliation step so a direct caller cannot
  // bypass the per-user and per-account activation checks.
  if (!await enabled({ account })) return [];
  const config = await getConfig(PLUGIN_ID, account.id);
  if (config?.enabled !== true || !validActivationBaseline(config?.activatedAt)) return [];
  return recover({
    accountId: account.id, pluginId: PLUGIN_ID,
    activatedAt: config.activatedAt, limit: 25,
  });
}
