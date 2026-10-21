// Recover newly inserted inbox messages whose initial per-message annotation write failed.
// Narrow core capability: account-scoped, bounded, atomic writes in a single namespace.
// Does not inspect bodies or change IMAP flags, folders, read state or message content.
import { query } from './db.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLUGIN_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_RECOVERY_BATCH = 25;
const MAX_HEADER_SKEW_DAYS = 7;

// Conservative recovery scope:
// - m.synced_at is an INSERT timestamp from MailFlow's message schema.
// - activation baseline MUST be recorded server-side after the initial inbox sync.
// - mail with a very old Date header is not silently bulk-queued during subsequent backfills.
// - only inbox rows are recovered for now; moved-by-rule recovery needs a separate
//   provenance mechanism before the system is approved for unattended live use.
const RECOVER_SQL = [
  'WITH candidates AS (',
  '  SELECT m.id FROM messages m',
  '  WHERE m.account_id = $1',
  "    AND m.folder = 'INBOX' AND m.is_deleted = false",
  '    AND m.synced_at >= $3::timestamptz',
  '    AND m.synced_at <= $4::timestamptz',
  '    AND (m.date IS NULL OR m.date >= $5::timestamptz)',
  "    AND NOT (COALESCE(m.plugin_annotations, '{}'::jsonb) ? $2)",
  '  ORDER BY m.synced_at ASC, m.id',
  '  LIMIT $6 FOR UPDATE SKIP LOCKED',
  ')',
  'UPDATE messages AS m',
  'SET plugin_annotations = jsonb_set(',
  "  COALESCE(m.plugin_annotations, '{}'::jsonb),",
  '  ARRAY[$2::text], $7::jsonb, true)',
  'FROM candidates',
  'WHERE m.account_id = $1 AND m.id = candidates.id',
  "  AND NOT (COALESCE(m.plugin_annotations, '{}'::jsonb) ? $2)",
  'RETURNING m.id',
].join('\n');

export async function recoverMissingPluginMessages({
  accountId, pluginId, activatedAt, now = new Date(), limit = MAX_RECOVERY_BATCH,
} = {}) {
  if (!UUID_RE.test(accountId || '')) throw new TypeError('Invalid account id');
  if (!PLUGIN_RE.test(pluginId || '')) throw new TypeError('Invalid plugin id');
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError('Invalid current time');
  const start = typeof activatedAt === 'string' ? new Date(activatedAt) : activatedAt;
  if (!(start instanceof Date) || Number.isNaN(start.getTime()) || start > now) {
    throw new TypeError('Invalid activation baseline');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RECOVERY_BATCH) {
    throw new RangeError('Invalid recovery batch limit');
  }
  const headerFloor = new Date(start.getTime() - MAX_HEADER_SKEW_DAYS * 24 * 60 * 60000);
  const initial = {
    status: 'QUEUED',
    version: 1,
    attempts: 0,
    queuedAt: now.toISOString(),
    source: 'inbox-recovery',
  };
  const { rows } = await query(RECOVER_SQL, [
    accountId, pluginId, start.toISOString(), now.toISOString(),
    headerFloor.toISOString(), limit, JSON.stringify(initial),
  ]);
  return rows.map(row => row.id);
}
