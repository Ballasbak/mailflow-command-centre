// Bounded, account-scoped, write-once queue for new-message plugin annotations.
// This never changes IMAP flags, folders, message bodies or reading state.
import { query } from './db.js';
import { isUuid, isPluginId } from './pluginMessageIdentifiers.js';

const MAX_BATCH = 100;

// Returns newly queued message ids. Existing annotations are never overwritten:
// this also protects future RESOLVED/EXPECTED decisions from a duplicate sync.
export async function enqueuePluginMessageIds({ accountId, pluginId, messageIds, now = new Date() } = {}) {
  if (!isUuid(accountId)) throw new TypeError('Invalid account id');
  if (!isPluginId(pluginId)) throw new TypeError('Invalid plugin id');
  if (!Array.isArray(messageIds)) throw new TypeError('messageIds must be an array');
  const ids = [...new Set(messageIds)];
  if (ids.length > MAX_BATCH) throw new RangeError('Too many messages in one queue batch');
  if (!ids.every(isUuid)) {
    throw new TypeError('Invalid message id');
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError('Invalid timestamp');
  if (!ids.length) return [];

  const initial = {
    status: 'QUEUED',
    version: 1,
    attempts: 0,
    queuedAt: now.toISOString(),
  };
  // IMPORTANT: WHERE account_id enforces account isolation; NOT ? preserves
  // previous results; is_deleted=false excludes removed inbox-rule/block-list rows.
  const { rows } = await query(
    'UPDATE messages ' +
    'SET plugin_annotations = jsonb_set(' +
      "COALESCE(plugin_annotations, '{}'::jsonb), " +
      'ARRAY[$2::text], $3::jsonb, true' +
    ') ' +
    'WHERE account_id = $1 ' +
      'AND id = ANY($4::uuid[]) ' +
      'AND is_deleted = false ' +
      "AND NOT (COALESCE(plugin_annotations, '{}'::jsonb) ? $2) " +
    'RETURNING id',
    [accountId, pluginId, JSON.stringify(initial), ids],
  );
  return rows.map(row => row.id);
}
