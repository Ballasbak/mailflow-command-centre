// Manually invoked metadata-audit integration check. Never loaded by MailFlow.
// Requires the dedicated offline cc_dev database and explicit CC_DEV_AUDIT_TEST=1.
// New random synthetic rows only; cleans up its own rows, never connects to mail/AI.
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { pool, query } from '../services/db.js';
import { acknowledgeAttentionItem } from '../services/attentionAcknowledge.js';
import { attentionAutomationReleased } from '../plugins/attention-triage/release.js';

const ACCOUNT = 'ca11c000-0000-4000-8000-000000000001';
const ids = [];
let guarded = false;

async function preflight() {
  if (process.env.CC_DEV_AUDIT_TEST !== '1' ||
    process.env.DB_HOST !== 'postgres' ||
    process.env.DB_NAME !== 'cc_dev' ||
    process.env.DB_USER !== 'cc_dev') {
    throw new Error('REFUSED: requires isolated cc_dev and explicit test flag');
  }
  const state = await query('SELECT current_database() AS db, current_user AS role');
  assert.equal(state.rows[0]?.db, 'cc_dev');
  assert.equal(state.rows[0]?.role, 'cc_dev');
  assert.equal(attentionAutomationReleased(), false, 'The automation release fuse must stay closed');

  const users = await query('SELECT id FROM users');
  assert.equal(users.rows.length, 1, 'Exactly one test user required');
  const accounts = await query(
    'SELECT id, email_address, enabled, imap_host, auth_pass, oauth_refresh_token FROM email_accounts',
  );
  assert.equal(accounts.rows.length, 1, 'One synthetic mailbox required');
  const a = accounts.rows[0];
  assert.equal(a.id, ACCOUNT);
  assert.equal(a.email_address, 'demo@example.invalid');
  assert.equal(a.enabled, false);
  assert.equal(a.imap_host, null);
  assert.equal(a.auth_pass, null);
  assert.equal(a.oauth_refresh_token, null);
  const table = await query("SELECT to_regclass('public.attention_action_audit') AS name");
  assert.equal(table.rows[0]?.name, 'attention_action_audit', 'Audit schema migration must exist');
  guarded = true;
  return users.rows[0].id;
}

async function fakeMessage(attention) {
  const id = randomUUID();
  const content = '[CC-DEV-AUDIT] temporary synthetic message';
  const annotation = {
    'attention-triage': {
      status: 'DONE', ownerStatus: 'OPEN',
      result: { version: 1, attention, priority: 'HIGH', category: 'SECURITY',
        why: 'Fictional audit test', action: 'None', deadline: 'NONE' },
    },
  };
  await query(
    'INSERT INTO messages (id, account_id, uid, folder, message_id, subject, ' +
    'from_name, from_email, date, snippet, body_text, is_read, plugin_annotations) ' +
    "VALUES ($1::uuid, $2::uuid, $3, 'INBOX', $4, $5, " +
    "'Synthetic', 'synthetic@example.invalid', NOW(), $6, $6, false, $7::jsonb)",
    [id, ACCOUNT, randomInt(200000000, 1900000000), '<' + id + '@example.invalid>',
      content, content, JSON.stringify(annotation)],
  );
  ids.push(id);
  return id;
}

async function auditRows(messageId) {
  const { rows } = await query(
    'SELECT action, previous_status, new_status, user_id, account_id, message_id ' +
    'FROM attention_action_audit WHERE message_id = $1::uuid ORDER BY id',
    [messageId],
  );
  return rows;
}

async function run(userId) {
  const id = await fakeMessage('YES');
  const noiseId = await fakeMessage('NO');
  const otherUser = randomUUID();
  const original = await query(
    'SELECT is_read, folder, body_text, subject FROM messages WHERE id=$1::uuid', [id],
  );

  assert.equal(await acknowledgeAttentionItem({ userId, messageId: id, status: 'EXPECTED' }), true);
  assert.equal(await acknowledgeAttentionItem({ userId, messageId: id, status: 'OPEN' }), true);

  const audit = await auditRows(id);
  assert.equal(audit.length, 2);
  assert.deepEqual(audit.map(r => [r.previous_status, r.new_status]),
    [['OPEN', 'EXPECTED'], ['EXPECTED', 'OPEN']]);
  assert.ok(audit.every(r => r.action === 'OWNER_STATUS' &&
    r.user_id === userId && r.account_id === ACCOUNT && r.message_id === id));

  assert.equal(await acknowledgeAttentionItem({
    userId: otherUser, messageId: id, status: 'RESOLVED',
  }), false, 'An unrelated user must not change or audit the message');
  assert.equal(await acknowledgeAttentionItem({
    userId, messageId: noiseId, status: 'RESOLVED',
  }), false, 'Noise messages must not be acknowledged as actionable');
  assert.equal((await auditRows(id)).length, 2);
  assert.equal((await auditRows(noiseId)).length, 0);

  const after = await query(
    'SELECT is_read, folder, body_text, subject, ' +
    "plugin_annotations -> 'attention-triage' ->> 'ownerStatus' AS owner_status " +
    'FROM messages WHERE id=$1::uuid',
    [id],
  );
  assert.deepEqual(
    [after.rows[0].is_read, after.rows[0].folder, after.rows[0].body_text, after.rows[0].subject],
    [original.rows[0].is_read, original.rows[0].folder,
      original.rows[0].body_text, original.rows[0].subject],
  );
  assert.equal(after.rows[0].owner_status, 'OPEN');
  console.log('PASS: real PostgreSQL atomic owner audit, undo, user isolation and content preservation');
}

async function cleanup() {
  if (!guarded || !ids.length) return;
  await query('DELETE FROM attention_action_audit WHERE account_id=$2::uuid AND message_id=ANY($1::uuid[])',
    [ids, ACCOUNT]);
  await query('DELETE FROM messages WHERE account_id=$2::uuid AND id=ANY($1::uuid[])',
    [ids, ACCOUNT]);
  console.log('Cleanup: removed only temporary synthetic audit and message rows');
}

let failure;
try {
  const userId = await preflight();
  console.log('Guard passed: cc_dev synthetic-only audit test');
  await run(userId);
} catch (error) {
  failure = error;
  console.error('FAIL: audit rehearsal:', error.message);
} finally {
  try { await cleanup(); } catch (error) {
    failure ??= error;
    console.error('Cleanup error:', error.message);
  }
  await pool.end();
}
if (failure) process.exitCode = 1;
