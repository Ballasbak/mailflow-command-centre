// Durable, leased Attention Triage jobs stored in the existing per-message annotation.
// SQL operations only touch our plugin's JSONB namespace; never IMAP flags/mail content.
import { randomUUID } from 'node:crypto';
import { query } from './db.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLUGIN_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LEASE_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 3;

function validIds(accountId, pluginId) {
  if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw new TypeError('Invalid account id');
  if (typeof pluginId !== 'string' || !PLUGIN_RE.test(pluginId)) throw new TypeError('Invalid plugin id');
}
function validDate(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new TypeError('Invalid date');
}

// One atomic SQL statement claims at most one ready item. FOR UPDATE SKIP LOCKED
// stops simultaneous workers claiming the same row; lease expiry recovers crashes.
const CLAIM_SQL = [
  'WITH candidate AS (',
  '  SELECT id FROM messages',
  '  WHERE account_id = $1 AND is_deleted = false',
  '    AND (',
  "      (plugin_annotations -> $2 ->> 'status') = 'QUEUED'",
  "      OR ((plugin_annotations -> $2 ->> 'status') = 'RETRY'",
  "        AND ((plugin_annotations -> $2 ->> 'nextAttemptAt') IS NULL",
  "          OR (plugin_annotations -> $2 ->> 'nextAttemptAt')::timestamptz <= $3::timestamptz))",
  "      OR ((plugin_annotations -> $2 ->> 'status') = 'PROCESSING'",
  "        AND ((plugin_annotations -> $2 ->> 'leaseUntil') IS NULL",
  "          OR (plugin_annotations -> $2 ->> 'leaseUntil')::timestamptz < $3::timestamptz))",
  '    )',
  "  ORDER BY (plugin_annotations -> $2 ->> 'queuedAt') ASC NULLS LAST, id",
  '  LIMIT 1 FOR UPDATE SKIP LOCKED',
  ')',
  'UPDATE messages AS m',
  'SET plugin_annotations = jsonb_set(',
  "  COALESCE(m.plugin_annotations, '{}'::jsonb), ARRAY[$2::text],",
  "  COALESCE(m.plugin_annotations -> $2, '{}'::jsonb) ||",
  "    jsonb_build_object('status', 'PROCESSING',",
  "      'attempts', COALESCE((m.plugin_annotations -> $2 ->> 'attempts')::int, 0) + 1,",
  "      'leaseId', $4::text, 'leaseUntil', $5::text, 'updatedAt', $3::text), true)",
  'FROM candidate',
  'WHERE m.id = candidate.id AND m.account_id = $1',
  'RETURNING m.id, m.subject, m.from_name, m.from_email,',
  "  COALESCE(NULLIF(m.body_text, ''), m.snippet) AS content,",
  "  (m.plugin_annotations -> $2 ->> 'attempts')::int AS attempts",
].join('\n');

export async function claimNextPluginMessage({
  accountId, pluginId, now = new Date(), leaseId = randomUUID(), leaseMs = LEASE_MS,
} = {}) {
  validIds(accountId, pluginId);
  validDate(now);
  if (!UUID_RE.test(leaseId)) throw new TypeError('Invalid lease id');
  if (!Number.isInteger(leaseMs) || leaseMs < 60000 || leaseMs > 3600000) {
    throw new RangeError('Invalid lease duration');
  }
  const leaseUntil = new Date(now.getTime() + leaseMs).toISOString();
  const { rows } = await query(CLAIM_SQL, [accountId, pluginId, now.toISOString(), leaseId, leaseUntil]);
  return rows[0] ? { ...rows[0], leaseId, leaseUntil } : null;
}

export function buildPluginSettlement({ outcome, attempts, now = new Date() } = {}) {
  validDate(now);
  if (!Number.isInteger(attempts) || attempts < 1) throw new TypeError('Invalid attempts');
  const updatedAt = now.toISOString();
  if (outcome?.ok === true && outcome.result?.version === 1) {
    return {
      status: 'DONE', result: outcome.result, completedAt: updatedAt, updatedAt,
      leaseId: null, leaseUntil: null, nextAttemptAt: null, lastError: null,
    };
  }
  // Never save a failed AI call as "NO". Retries are delayed and bounded.
  // After exhaustion, NEEDS_REVIEW remains visible for eventual owner inspection.
  const reason = ['ai_unavailable', 'invalid_ai_result', 'missing_owner'].includes(outcome?.reason)
    ? outcome.reason : 'worker_error';
  if (attempts >= MAX_ATTEMPTS) {
    return {
      status: 'NEEDS_REVIEW', updatedAt, leaseId: null, leaseUntil: null,
      nextAttemptAt: null, lastError: reason,
    };
  }
  const delayMs = attempts === 1 ? 5 * 60000 : 15 * 60000;
  return {
    status: 'RETRY', updatedAt, leaseId: null, leaseUntil: null,
    nextAttemptAt: new Date(now.getTime() + delayMs).toISOString(), lastError: reason,
  };
}

// Compare-and-swap: late workers cannot replace a newer classification, even
// after an expired lease is claimed by another process. Merge only our fields;
// never overwrite any future owner acknowledgment stored in the annotation.
const SETTLE_SQL = [
  'UPDATE messages AS m',
  'SET plugin_annotations = jsonb_set(',
  "  COALESCE(m.plugin_annotations, '{}'::jsonb), ARRAY[$2::text],",
  "  COALESCE(m.plugin_annotations -> $2, '{}'::jsonb) || $5::jsonb, true)",
  'WHERE m.account_id = $1 AND m.id = $3::uuid AND m.is_deleted = false',
  "  AND (m.plugin_annotations -> $2 ->> 'status') = 'PROCESSING'",
  "  AND (m.plugin_annotations -> $2 ->> 'leaseId') = $4::text",
  'RETURNING m.id',
].join('\n');

export async function settlePluginMessage({
  accountId, pluginId, messageId, leaseId, attempts, outcome, now = new Date(),
} = {}) {
  validIds(accountId, pluginId);
  if (!UUID_RE.test(messageId || '')) throw new TypeError('Invalid message id');
  if (!UUID_RE.test(leaseId || '')) throw new TypeError('Invalid lease id');
  const patch = buildPluginSettlement({ outcome, attempts, now });
  const { rows } = await query(SETTLE_SQL, [
    accountId, pluginId, messageId, leaseId, JSON.stringify(patch),
  ]);
  return rows.length === 1;
}
