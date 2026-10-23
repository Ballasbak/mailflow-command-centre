// Deliberate owner acknowledgement, scoped to a single actionable message.
// Only our plugin's JSONB owner fields change: no IMAP operation or email flag.
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

// The same visibility rule as the read-only feed: a completed actionable
// classification or a failed classification requiring review. No marking
// unassessed, pending, routine or another user's messages as resolved.
const ACK_SQL = [
  'UPDATE messages AS m',
  'SET plugin_annotations = jsonb_set(',
  "    COALESCE(m.plugin_annotations, '{}'::jsonb), ARRAY[$5::text],",
  "    COALESCE(m.plugin_annotations -> $5, '{}'::jsonb) ||",
  "    jsonb_build_object('ownerStatus', $3::text,",
  "      'ownerUpdatedAt', $4::text, 'ownerUpdatedBy', $1::text), true)",
  'FROM email_accounts AS a',
  'WHERE m.id = $2::uuid AND m.account_id = a.id',
  '  AND a.user_id = $1::uuid AND m.is_deleted = false',
  '  AND (',
  "    (m.plugin_annotations -> $5 ->> 'status') = 'NEEDS_REVIEW'",
  "    OR ((m.plugin_annotations -> $5 ->> 'status') = 'DONE'",
  "      AND (m.plugin_annotations -> $5 -> 'result' ->> 'attention') IN ('YES', 'REVIEW'))",
  '  )',
  'RETURNING m.id',
].join('\n');

export async function acknowledgeAttentionItem(input = {}) {
  const { userId, messageId, status, now } = validateAttentionAcknowledgement(input);
  const { rows } = await query(ACK_SQL, [
    userId, messageId, status, now.toISOString(), PLUGIN_ID,
  ]);
  // Not found, another owner, deleted, or non-actionable: all indistinguishable.
  return rows.length === 1;
}
