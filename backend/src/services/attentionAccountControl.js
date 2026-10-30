// Owner-scoped attention account controls. This phase exposes account status
// and an emergency OFF switch only. Enabling automation is intentionally locked
// until the release fuse and historical-mail safeguards are reviewed.
import { query } from './db.js';
import { isUuid } from './pluginMessageIdentifiers.js';

const PLUGIN = 'attention-triage';

function requireUserId(userId) {
  if (!isUuid(userId)) throw new TypeError('Invalid user id');
}

export function projectAttentionAccount(row) {
  const config = row.config && typeof row.config === 'object' && !Array.isArray(row.config)
    ? row.config : {};
  return {
    id: row.id,
    name: typeof row.name === 'string' ? row.name : '',
    emailAddress: typeof row.email_address === 'string' ? row.email_address : '',
    mailboxEnabled: row.enabled === true,
    protocol: row.protocol === 'imap' ? 'imap' : 'other',
    // A stored opt-in is NOT equivalent to permission to run in this build.
    storedOptIn: config.enabled === true,
    monitoringEnabled: false,
    canEnable: false,
    releaseHold: 'Automatic classification is locked during development',
    lastSyncAt: row.last_sync ?? null, // informational; NOT backfill completion
  };
}

const LIST_SQL = [
  'SELECT a.id, a.name, a.email_address, a.enabled, a.protocol, a.last_sync,',
  '       pc.config',
  '  FROM email_accounts a',
  '  LEFT JOIN plugin_account_config pc',
  '    ON pc.account_id = a.id AND pc.plugin_id = $2',
  ' WHERE a.user_id = $1::uuid',
  ' ORDER BY a.sort_order, a.created_at, a.id',
].join('\n');

export async function listOwnedAttentionAccounts({ userId } = {}) {
  requireUserId(userId);
  const { rows } = await query(LIST_SQL, [userId, PLUGIN]);
  return rows.map(projectAttentionAccount);
}

// Atomic owned-account opt-out, with baseline invalidation. A fast OFF request
// cannot accidentally leave the old activatedAt timestamp ready for reuse.
// This deliberately does not invoke IMAP disconnects or change email flags.
const DISABLE_SQL = [
  'INSERT INTO plugin_account_config (plugin_id, account_id, config, updated_at)',
  "SELECT $3::text, a.id, '{\"enabled\":false}'::jsonb, NOW()",
  '  FROM email_accounts a',
  ' WHERE a.id = $2::uuid AND a.user_id = $1::uuid',
  'ON CONFLICT (plugin_id, account_id)',
  '  DO UPDATE SET',
  "    config = (COALESCE(plugin_account_config.config, '{}'::jsonb)",
  "              - 'activatedAt') || '{\"enabled\":false}'::jsonb,",
  '    updated_at = NOW()',
  'RETURNING account_id',
].join('\n');

export async function disableOwnedAttentionAccount({ userId, accountId } = {}) {
  requireUserId(userId);
  if (!isUuid(accountId)) throw new TypeError('Invalid account id');
  const { rows } = await query(DISABLE_SQL, [userId, accountId, PLUGIN]);
  return rows.length === 1;
}
