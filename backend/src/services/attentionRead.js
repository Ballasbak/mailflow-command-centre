// Owner-scoped, read-only Attention Triage feed.
// The caller can never select another user's mailbox: ownership is checked in SQL.
// Email bodies, HTML, provider credentials and raw plugin JSON stay on the server.
import { query } from './db.js';
import { isUuid } from './pluginMessageIdentifiers.js';

const PLUGIN_ID = 'attention-triage';
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 30;
const VISIBLE = new Set(['QUEUED', 'RETRY', 'PROCESSING', 'NEEDS_REVIEW']);
const ATTENTION = new Set(['YES', 'REVIEW']);
const CLOSED = new Set(['RESOLVED', 'EXPECTED']);

export function attentionQueryInput({ userId, accountId = null, limit = DEFAULT_LIMIT } = {}) {
  if (!isUuid(userId)) throw new TypeError('Invalid user id');
  if (accountId !== null && !isUuid(accountId)) throw new TypeError('Invalid account id');
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new RangeError('Invalid attention feed limit');
  }
  return { userId, accountId, limit };
}

// Explicit projection: never spread a raw DB row or unsanitised provider object
// into a response. Model text will be escaped by React when displayed.
function brief(value, length) {
  return typeof value === 'string' ? value.slice(0, length) : '';
}

export function mapAttentionRow(row) {
  const ann = row.annotation && typeof row.annotation === 'object' && !Array.isArray(row.annotation)
    ? row.annotation : {};
  const status = brief(ann.status, 30);
  const decision = brief(ann.result?.attention, 20);
  const ownerStatus = brief(ann.ownerStatus, 32) || 'OPEN';
  if (CLOSED.has(ownerStatus)) return null;
  if (!VISIBLE.has(status) && !(status === 'DONE' && ATTENTION.has(decision))) return null;
  const output = {
    id: row.id,
    accountId: row.account_id,
    mailbox: brief(row.mailbox, 255),
    from: brief(row.from_name || row.from_email, 255),
    fromEmail: brief(row.from_email, 255),
    subject: brief(row.subject, 300),
    receivedAt: row.date ?? row.synced_at ?? null,
    jobStatus: status,
    ownerStatus,
    attention: status === 'DONE' && ATTENTION.has(decision) ? decision : 'REVIEW',
    priority: status === 'DONE' ? brief(ann.result?.priority, 12) : 'UNASSESSED',
    category: status === 'DONE' ? brief(ann.result?.category, 48) : 'UNASSESSED',
    why: status === 'DONE' ? brief(ann.result?.why, 500) : '',
    action: status === 'DONE' ? brief(ann.result?.action, 500) : '',
    deadline: status === 'DONE' ? brief(ann.result?.deadline, 160) : '',
  };
  return output;
}

const FEED_SQL = [
  'SELECT m.id, m.account_id, a.email_address AS mailbox,',
  '       m.from_name, m.from_email, m.subject, m.date, m.synced_at,',
  '       m.plugin_annotations -> $3 AS annotation',
  '  FROM messages m',
  '  JOIN email_accounts a ON a.id = m.account_id',
  ' WHERE a.user_id = $1::uuid AND m.is_deleted = false',
  '   AND ($2::uuid IS NULL OR m.account_id = $2::uuid)',
  '   AND (',
  "       (m.plugin_annotations -> $3 ->> 'status') IN ('QUEUED', 'RETRY', 'PROCESSING', 'NEEDS_REVIEW')",
  "    OR ((m.plugin_annotations -> $3 ->> 'status') = 'DONE'",
  "        AND (m.plugin_annotations -> $3 -> 'result' ->> 'attention') IN ('YES', 'REVIEW'))",
  '   )',
  "   AND COALESCE(m.plugin_annotations -> $3 ->> 'ownerStatus', 'OPEN') NOT IN ('RESOLVED', 'EXPECTED')",
  ' ORDER BY',
  "   CASE (m.plugin_annotations -> $3 -> 'result' ->> 'priority')",
  "     WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 WHEN 'LOW' THEN 2 ELSE 3 END,",
  '   m.date DESC NULLS LAST, m.synced_at DESC, m.id',
  ' LIMIT $4::int',
].join('\n');

export async function listAttentionItems(input) {
  const { userId, accountId, limit } = attentionQueryInput(input);
  const { rows } = await query(FEED_SQL, [userId, accountId, PLUGIN_ID, limit + 1]);
  const items = rows.slice(0, limit).map(mapAttentionRow).filter(Boolean);
  return { items, hasMore: rows.length > limit };
}
