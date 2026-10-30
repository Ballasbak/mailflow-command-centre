// Durable, owner-scoped acknowledgement with a metadata-only audit event.
// Mail content, flags and folders are never changed; the audit insert and
// owner-status update are one PostgreSQL statement, so both succeed or neither.
import { query } from './db.js';
import { isUuid } from './pluginMessageIdentifiers.js';

const PLUGIN_ID = 'attention-triage';
export const OWNER_STATUSES = Object.freeze(['OPEN', 'RESOLVED', 'EXPECTED']);

export function validateAttentionAcknowledgement({ userId, messageId, status, now = new Date() } = {}) {
  if (!isUuid(userId)) throw new TypeError('Invalid user id');
  if (!isUuid(messageId)) throw new TypeError('Invalid message id');
  if (!OWNER_STATUSES.includes(status)) throw new TypeError('Invalid acknowledgement status');
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('Invalid acknowledgement timestamp');
  }
  return { userId, messageId, status, now };
}

// Locks the eligible message so previousStatus is accurate even with concurrent
// owner actions. Only update an actionable row owned by the signed-in user.
// A successful update MUST also insert its audit event in the same statement.
// The audit row deliberately contains IDs/statuses/timestamps only.
const ACK_SQL = [
  'WITH eligible AS MATERIALIZED (',
  '  SELECT m.id, m.account_id,',
  "    COALESCE(m.plugin_annotations -> $5 ->> 'ownerStatus', 'OPEN') AS previous_status",
  '  FROM messages AS m',
  '  JOIN email_accounts AS a ON a.id = m.account_id',
  '  WHERE m.id = $2::uuid AND a.user_id = $1::uuid AND m.is_deleted = false',
  '    AND (',
  "      (m.plugin_annotations -> $5 ->> 'status') = 'NEEDS_REVIEW'",
  "      OR ((m.plugin_annotations -> $5 ->> 'status') = 'DONE'",
  "        AND (m.plugin_annotations -> $5 -> 'result' ->> 'attention') IN ('YES', 'REVIEW'))",
  '    )',
  '  FOR UPDATE OF m',
  '), changed AS (',
  '  UPDATE messages AS m',
  '  SET plugin_annotations = jsonb_set(',
  "    COALESCE(m.plugin_annotations, '{}'::jsonb), ARRAY[$5::text],",
  "    COALESCE(m.plugin_annotations -> $5, '{}'::jsonb) ||",
  "      jsonb_build_object('ownerStatus', $3::text,",
  "        'ownerUpdatedAt', $4::text, 'ownerUpdatedBy', $1::text), true)",
  '  FROM eligible AS e',
  '  WHERE m.id = e.id AND m.account_id = e.account_id',
  '  RETURNING m.id, m.account_id',
  ')',
  'INSERT INTO attention_action_audit',
  '  (user_id, account_id, message_id, action, previous_status, new_status, occurred_at)',
  "SELECT $1::uuid, c.account_id, c.id, 'OWNER_STATUS',",
  "       CASE WHEN e.previous_status IN ('OPEN', 'RESOLVED', 'EXPECTED')",
  "         THEN e.previous_status ELSE 'OPEN' END,",
  '       $3::text, $4::timestamptz',
  'FROM changed c JOIN eligible e ON e.id = c.id',
  'RETURNING message_id AS id',
].join('\n');

export async function acknowledgeAttentionItem(input = {}) {
  const { userId, messageId, status, now } = validateAttentionAcknowledgement(input);
  const { rows } = await query(ACK_SQL, [
    userId, messageId, status, now.toISOString(), PLUGIN_ID,
  ]);
  // Not found, another owner, deleted, or non-actionable: all indistinguishable.
  return rows.length === 1;
}
