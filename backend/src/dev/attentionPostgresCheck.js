// Manually invoked real-PostgreSQL integration rehearsal. NEVER loaded by the app.
// Only the dedicated cc_dev DB, disabled demo@example.invalid mailbox and NEW
// random synthetic message rows can be touched. No SMTP, IMAP or AI requests.
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { pool, query } from '../services/db.js';
import { enqueuePluginMessageIds } from '../services/pluginMessageQueue.js';
import { claimNextPluginMessage, settlePluginMessage } from '../services/pluginMessageWorker.js';
import { recoverMissingPluginMessages } from '../services/pluginMessageRecovery.js';
import { listAttentionItems } from '../services/attentionRead.js';
import { acknowledgeAttentionItem } from '../services/attentionAcknowledge.js';
import { buildAttentionMessages, parseAttentionResult } from '../plugins/attention-triage/policy.js';

const ACCOUNT = 'ca11c000-0000-4000-8000-000000000001';
const PLUGIN = 'attention-triage';
const FROM = 'synthetic@example.invalid';
const PREFIX = '[CC-DEV-INTEGRATION] ';
const created = [];
let guardPassed = false;

function at(base, offsetMs) {
  return new Date(base.getTime() + offsetMs);
}

async function annotation(messageId) {
  const { rows } = await query(
    "SELECT plugin_annotations -> $3 AS ann, is_read, subject FROM messages WHERE id = $1::uuid AND account_id = $2::uuid",
    [messageId, ACCOUNT, PLUGIN],
  );
  assert.equal(rows.length, 1, 'Temporary message must exist in only the synthetic account');
  return rows[0];
}

async function verifyEnvironment() {
  if (process.env.CC_DEV_SQL_TEST !== '1' ||
      process.env.DB_HOST !== 'postgres' ||
      process.env.DB_NAME !== 'cc_dev' ||
      process.env.DB_USER !== 'cc_dev') {
    throw new Error('REFUSED: only the cc_dev Docker network and explicit test flag are allowed');
  }

  const { rows: db } = await query(
    'SELECT current_database() AS db, current_user AS db_user',
  );
  assert.equal(db[0]?.db, 'cc_dev', 'Refusing the wrong PostgreSQL database');
  assert.equal(db[0]?.db_user, 'cc_dev', 'Refusing the wrong PostgreSQL role');

  const { rows: users } = await query('SELECT COUNT(*)::int AS n FROM users');
  assert.equal(users[0]?.n, 1, 'Expected exactly one throwaway development user');

  const { rows: accounts } = await query(
    'SELECT id, user_id, email_address, enabled, imap_host, auth_pass, oauth_refresh_token ' +
    'FROM email_accounts',
  );
  assert.equal(accounts.length, 1, 'Refusing any database with more than one mailbox');
  const demo = accounts[0];
  assert.equal(demo.id, ACCOUNT);
  assert.equal(demo.email_address, 'demo@example.invalid');
  assert.equal(demo.enabled, false, 'The synthetic mailbox must be disabled');
  assert.equal(demo.imap_host, null, 'No IMAP server is permitted');
  assert.equal(demo.auth_pass, null, 'No real credentials are permitted');
  assert.equal(demo.oauth_refresh_token, null, 'No OAuth token is permitted');

  const { rows: pending } = await query(
    "SELECT COUNT(*)::int AS n FROM messages WHERE account_id = $1::uuid " +
    "AND plugin_annotations -> $2 ->> 'status' IN ('QUEUED', 'RETRY', 'PROCESSING')",
    [ACCOUNT, PLUGIN],
  );
  assert.equal(pending[0]?.n, 0, 'Resolve existing queued test data before starting rehearsal');
  guardPassed = true;
  return demo.user_id;
}

async function createSyntheticMessage(subject) {
  const id = randomUUID();
  const uid = randomInt(100000000, 1900000000);
  const msgId = '<' + id + '@example.invalid>';
  const body = 'Temporary fictional queue test. No external AI or mail servers are used.';
  const { rowCount } = await query(
    'INSERT INTO messages (id, account_id, uid, folder, message_id, subject, ' +
    'from_name, from_email, date, snippet, body_text, is_read) ' +
    "VALUES ($1::uuid, $2::uuid, $3, 'INBOX', $4, $5, " +
    "'Synthetic Test', $6, NOW(), $7, $7, false)",
    [id, ACCOUNT, uid, msgId, PREFIX + subject, FROM, body],
  );
  assert.equal(rowCount, 1);
  created.push(id);
  return id;
}

async function rehearsal(userId) {
  const idA = await createSyntheticMessage('lease and retry');
  const idB = await createSyntheticMessage('third failure');
  const idC = await createSyntheticMessage('missing initial enqueue');
  const base = new Date();

  // 1. Actual enqueue SQL is idempotent and preserves original read status.
  const queuedA = await enqueuePluginMessageIds({
    accountId: ACCOUNT, pluginId: PLUGIN, messageIds: [idA], now: base,
  });
  assert.deepEqual(queuedA, [idA]);
  assert.deepEqual(await enqueuePluginMessageIds({
    accountId: ACCOUNT, pluginId: PLUGIN, messageIds: [idA], now: base,
  }), []);
  assert.equal((await annotation(idA)).ann.status, 'QUEUED');
  console.log('PASS 1/6: enqueue is durable and duplicate-safe');

  // 2. An active lease excludes other claims. A crashed lease is reclaimable;
  // a late worker cannot overwrite the newer result.
  const leaseA1 = randomUUID();
  const first = await claimNextPluginMessage({
    accountId: ACCOUNT, pluginId: PLUGIN, leaseId: leaseA1,
    now: at(base, 1000), leaseMs: 60000,
  });
  assert.equal(first?.id, idA);
  assert.equal(first.attempts, 1);
  assert.equal(await claimNextPluginMessage({
    accountId: ACCOUNT, pluginId: PLUGIN, leaseId: randomUUID(),
    now: at(base, 30000), leaseMs: 60000,
  }), null);

  const second = await claimNextPluginMessage({
    accountId: ACCOUNT, pluginId: PLUGIN, leaseId: randomUUID(),
    now: at(base, 62000), leaseMs: 60000,
  });
  assert.equal(second?.id, idA);
  assert.equal(second.attempts, 2);
  const ready = {
    version: 1, attention: 'YES', priority: 'HIGH', category: 'SECURITY',
    why: 'A synthetic notification needs an owner check.',
    action: 'Review this synthetic test item.', deadline: 'NONE',
  };
  assert.equal(await settlePluginMessage({
    accountId: ACCOUNT, pluginId: PLUGIN, messageId: idA,
    leaseId: leaseA1, attempts: 1, outcome: { ok: true, result: ready },
    now: at(base, 63000),
  }), false, 'Old lease must not settle after another worker claims');

  assert.equal(await settlePluginMessage({
    accountId: ACCOUNT, pluginId: PLUGIN, messageId: idA,
    leaseId: second.leaseId, attempts: second.attempts,
    outcome: { ok: false, reason: 'ai_unavailable' }, now: at(base, 64000),
  }), true);
  assert.equal((await annotation(idA)).ann.status, 'RETRY');
  assert.equal(await claimNextPluginMessage({
    accountId: ACCOUNT, pluginId: PLUGIN, leaseId: randomUUID(),
    now: at(base, 65000),
  }), null);

  const third = await claimNextPluginMessage({
    accountId: ACCOUNT, pluginId: PLUGIN, leaseId: randomUUID(),
    now: at(base, 17 * 60000),
  });
  assert.equal(third?.id, idA);
  assert.equal(third.attempts, 3);
  assert.equal(await settlePluginMessage({
    accountId: ACCOUNT, pluginId: PLUGIN, messageId: idA,
    leaseId: third.leaseId, attempts: third.attempts,
    outcome: { ok: true, result: ready }, now: at(base, 17 * 60000 + 1000),
  }), true);
  assert.equal((await annotation(idA)).ann.status, 'DONE');
  console.log('PASS 2/6: real lease, crash recovery, stale-write guard and delayed retry');

  // 3. Three simulated AI failures produce NEEDS_REVIEW (never silent NO).
  await enqueuePluginMessageIds({
    accountId: ACCOUNT, pluginId: PLUGIN, messageIds: [idB], now: base,
  });
  const attempts = [at(base, 1000), at(base, 7 * 60000), at(base, 24 * 60000)];
  for (let i = 0; i < 3; i++) {
    const claim = await claimNextPluginMessage({
      accountId: ACCOUNT, pluginId: PLUGIN, leaseId: randomUUID(),
      now: attempts[i],
    });
    assert.equal(claim?.id, idB);
    assert.equal(claim.attempts, i + 1);
    assert.equal(await settlePluginMessage({
      accountId: ACCOUNT, pluginId: PLUGIN, messageId: idB,
      leaseId: claim.leaseId, attempts: claim.attempts,
      outcome: { ok: false, reason: 'ai_unavailable' },
      now: at(attempts[i], 1000),
    }), true);
  }
  assert.equal((await annotation(idB)).ann.status, 'NEEDS_REVIEW');
  assert.equal((await annotation(idB)).ann.result, undefined);
  console.log('PASS 3/6: retries are bounded; exhausted jobs require manual review');

  // 4. An unannotated but newly synced message can be discovered via
  // the real recovery SQL without reprocessing existing annotated messages.
  const recovered = await recoverMissingPluginMessages({
    accountId: ACCOUNT, pluginId: PLUGIN,
    activatedAt: at(base, -60000).toISOString(),
    now: at(base, 2000), limit: 25,
  });
  assert(recovered.includes(idC), 'Missing initial annotation should be recovered');
  assert.equal((await annotation(idC)).ann.status, 'QUEUED');
  assert.equal((await annotation(idA)).ann.status, 'DONE');
  console.log('PASS 4/6: missing-enqueue recovery uses the real PostgreSQL query');

  // 5. Deterministic FAKE model reply through the real classification policy.
  // This intentionally does NOT call the AI provider or charge a subscription.
  const prompt = buildAttentionMessages({
    from: FROM, subject: PREFIX + 'missing initial enqueue',
    body: 'Fictional customer enquiry with no external sender.',
  });
  assert.equal(prompt.length, 2);
  const syntheticModelReply = JSON.stringify({
    attention: 'YES', priority: 'MEDIUM', category: 'CUSTOMER',
    why: 'A synthetic customer enquiry is awaiting review.',
    action: 'Check the fictional example.', deadline: 'NONE',
  });
  const classified = parseAttentionResult(syntheticModelReply);
  assert.equal(classified?.attention, 'YES');
  const recoveredJob = await claimNextPluginMessage({
    accountId: ACCOUNT, pluginId: PLUGIN, leaseId: randomUUID(),
    now: at(base, 3000),
  });
  assert.equal(recoveredJob?.id, idC);
  assert.equal(await settlePluginMessage({
    accountId: ACCOUNT, pluginId: PLUGIN, messageId: idC,
    leaseId: recoveredJob.leaseId, attempts: recoveredJob.attempts,
    outcome: { ok: true, result: classified }, now: at(base, 4000),
  }), true);

  const feed = await listAttentionItems({ userId, accountId: ACCOUNT, limit: 50 });
  const items = new Map(feed.items.map(item => [item.id, item]));
  assert.equal(items.get(idA)?.priority, 'HIGH');
  assert.equal(items.get(idB)?.jobStatus, 'NEEDS_REVIEW');
  assert.equal(items.get(idC)?.priority, 'MEDIUM');
  console.log('PASS 5/6: synthetic classification settlement appears in owner-scoped feed');

  // 6. Owner actions must preserve the message and classifier result.
  assert.equal(await acknowledgeAttentionItem({
    userId, messageId: idA, status: 'EXPECTED', now: at(base, 5000),
  }), true);
  assert(!((await listAttentionItems({
    userId, accountId: ACCOUNT, limit: 50,
  })).items.some(item => item.id === idA)));
  assert.deepEqual(await enqueuePluginMessageIds({
    accountId: ACCOUNT, pluginId: PLUGIN, messageIds: [idA],
  }), []);
  assert.equal(await acknowledgeAttentionItem({
    userId, messageId: idA, status: 'OPEN', now: at(base, 6000),
  }), true);
  const restored = await annotation(idA);
  assert.equal(restored.ann.ownerStatus, 'OPEN');
  assert.equal(restored.ann.result.attention, 'YES');
  for (const id of [idA, idB, idC]) {
    const row = await annotation(id);
    assert.equal(row.is_read, false, 'Triage must not mark emails read');
    assert(row.subject.startsWith(PREFIX), 'Triage must preserve subjects');
  }
  console.log('PASS 6/6: Expected and Undo preserve message data and read flags');
}

let passed = false;
try {
  const userId = await verifyEnvironment();
  console.log('Guard passed: isolated cc_dev, disabled synthetic mailbox, no real credentials');
  await rehearsal(userId);
  passed = true;
} catch (error) {
  console.error('FAILED: development PostgreSQL integration rehearsal: ' + error.message);
  process.exitCode = 1;
} finally {
  if (guardPassed && created.length > 0) {
    try {
      const result = await query(
        'DELETE FROM messages WHERE account_id = $1::uuid ' +
        "AND id = ANY($2::uuid[]) AND from_email = $3 AND subject LIKE '[CC-DEV-INTEGRATION] %'",
        [ACCOUNT, created, FROM],
      );
      if (result.rowCount !== created.length) {
        console.error('WARNING: temporary synthetic cleanup was incomplete; inspect cc_dev only');
        process.exitCode = 1;
      } else {
        console.log('Cleanup: removed only ' + created.length + ' temporary synthetic test rows');
      }
    } catch {
      console.error('WARNING: temporary synthetic cleanup failed; inspect cc_dev only');
      process.exitCode = 1;
    }
  }
  await pool.end();
}
if (passed && process.exitCode !== 1) {
  console.log('PASS: PostgreSQL queue and deterministic fake-AI rehearsal complete');
}
