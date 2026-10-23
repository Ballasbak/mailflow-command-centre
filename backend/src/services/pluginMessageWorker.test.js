import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db.js', () => ({ query: vi.fn() }));
vi.mock('node:crypto', () => ({ randomUUID: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }));
import { query } from './db.js';
import {
  buildPluginSettlement, claimNextPluginMessage, settlePluginMessage,
} from './pluginMessageWorker.js';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const MESSAGE = '22222222-2222-4222-8222-222222222222';
const LEASE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW = new Date('2026-10-20T20:00:00.000Z');
const ids = { accountId: ACCOUNT, pluginId: 'attention-triage' };
const result = {
  version: 1, attention: 'YES', priority: 'HIGH', category: 'SECURITY',
  why: 'New app password.', action: 'Confirm whether it was you.', deadline: 'NONE',
};

describe('durable Attention Triage worker storage', () => {
  beforeEach(() => {
    query.mockReset();
  });

  it('claims exactly one job with a unique lease under an account-scoped DB lock', async () => {
    query.mockResolvedValue({ rows: [{
      id: MESSAGE, subject: 'Security alert', from_email: 'security@example.com',
      content: 'New password.', attempts: 1,
    }] });
    const job = await claimNextPluginMessage({ ...ids, now: NOW });
    expect(job.leaseId).toBe(LEASE);
    expect(job.attempts).toBe(1);
    expect(job.id).toBe(MESSAGE);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/WITH candidate AS/);
    expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(sql).toMatch(/LIMIT 1/);
    expect(sql).toMatch(/m.account_id = \$1/);
    expect(sql).toMatch(/is_deleted = false/);
    expect(sql).toMatch(/'QUEUED'/);
    expect(sql).toMatch(/'RETRY'/);
    expect(sql).toMatch(/'PROCESSING'/);
    expect(sql).toMatch(/leaseUntil/);
    expect(sql).toMatch(/attempts/);
    expect(sql).not.toMatch(/DELETE FROM|is_read\s*=|is_starred\s*=/i);
    expect(params).toEqual([
      ACCOUNT, 'attention-triage', NOW.toISOString(), LEASE, '2026-10-20T20:10:00.000Z',
    ]);
  });

  it('returns null when there is no work and makes no AI request', async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await claimNextPluginMessage({ ...ids, now: NOW })).toBeNull();
  });

  it('includes stale PROCESSING jobs for crash recovery without taking unexpired leases', async () => {
    query.mockResolvedValue({ rows: [] });
    await claimNextPluginMessage({ ...ids, now: NOW });
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/leaseUntil.+IS NULL/);
    expect(sql).toMatch(/leaseUntil.+::timestamptz < \$3::timestamptz/);
    expect(sql).toMatch(/nextAttemptAt.+::timestamptz <= \$3::timestamptz/);
  });

  it('rejects invalid ids and leases before hitting the database', async () => {
    await expect(claimNextPluginMessage({ ...ids, accountId: 'bad' })).rejects.toThrow(/account/);
    await expect(claimNextPluginMessage({ ...ids, pluginId: 'bad name' })).rejects.toThrow(/plugin/);
    await expect(claimNextPluginMessage({ ...ids, leaseId: 'bad' })).rejects.toThrow(/lease/);
    await expect(claimNextPluginMessage({ ...ids, leaseMs: 120 })).rejects.toThrow(/duration/);
    expect(query).not.toHaveBeenCalled();
  });

  it('marks a valid AI response DONE with its classification', () => {
    const patch = buildPluginSettlement({ outcome: { ok: true, result }, attempts: 1, now: NOW });
    expect(patch).toMatchObject({
      status: 'DONE', result, completedAt: NOW.toISOString(), nextAttemptAt: null,
      leaseId: null, leaseUntil: null, lastError: null,
    });
    expect(patch).not.toHaveProperty('ownerStatus');
  });

  it('retries an AI outage without ever classifying it as NO', () => {
    const patch = buildPluginSettlement({
      outcome: { ok: false, reason: 'ai_unavailable' }, attempts: 1, now: NOW,
    });
    expect(patch).toMatchObject({
      status: 'RETRY', lastError: 'ai_unavailable',
      nextAttemptAt: '2026-10-20T20:05:00.000Z',
    });
    expect(patch).not.toHaveProperty('result');
  });

  it('backs off a second failure for fifteen minutes', () => {
    const patch = buildPluginSettlement({
      outcome: { ok: false, reason: 'invalid_ai_result' }, attempts: 2, now: NOW,
    });
    expect(patch.status).toBe('RETRY');
    expect(patch.nextAttemptAt).toBe('2026-10-20T20:15:00.000Z');
  });

  it('raises NEEDS_REVIEW after three failures instead of dismissing the email', () => {
    const patch = buildPluginSettlement({
      outcome: { ok: false, reason: 'ai_unavailable' }, attempts: 3, now: NOW,
    });
    expect(patch.status).toBe('NEEDS_REVIEW');
    expect(patch.lastError).toBe('ai_unavailable');
    expect(patch.nextAttemptAt).toBeNull();
    expect(patch).not.toHaveProperty('result');
  });

  it('never persists raw provider exceptions or email content as failure reasons', () => {
    const patch = buildPluginSettlement({
      outcome: { ok: false, reason: 'Sensitive: actual body text' }, attempts: 1, now: NOW,
    });
    expect(patch.lastError).toBe('worker_error');
    expect(JSON.stringify(patch)).not.toContain('Sensitive: actual');
  });

  it('settles only the current PROCESSING lease; preserves owner-owned fields', async () => {
    query.mockResolvedValue({ rows: [{ id: MESSAGE }] });
    expect(await settlePluginMessage({
      ...ids, messageId: MESSAGE, leaseId: LEASE, attempts: 1,
      outcome: { ok: true, result }, now: NOW,
    })).toBe(true);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/UPDATE messages AS m/);
    expect(sql).toMatch(/m.id = \$3::uuid/);
    expect(sql).toMatch(/m.account_id = \$1/);
    expect(sql).toMatch(/'status'\) = 'PROCESSING'/);
    expect(sql).toMatch(/'leaseId'\) = \$4::text/);
    expect(sql).toMatch(/COALESCE\(m.plugin_annotations -> \$2, '\{\}'::jsonb\) \|\| \$5::jsonb/);
    expect(sql).not.toMatch(/DELETE FROM|is_read\s*=/i);
    expect(params.slice(0, 4)).toEqual([ACCOUNT, 'attention-triage', MESSAGE, LEASE]);
    expect(JSON.parse(params[4]).status).toBe('DONE');
  });

  it('drops late results when another worker owns the lease', async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await settlePluginMessage({
      ...ids, messageId: MESSAGE, leaseId: LEASE, attempts: 1,
      outcome: { ok: true, result }, now: NOW,
    })).toBe(false);
  });

  it('validates settlement ids and attempts before database mutation', async () => {
    await expect(settlePluginMessage({
      ...ids, messageId: 'broken', leaseId: LEASE, attempts: 1,
    })).rejects.toThrow(/message/);
    await expect(settlePluginMessage({
      ...ids, messageId: MESSAGE, leaseId: LEASE, attempts: 0,
    })).rejects.toThrow(/attempts/);
    expect(query).not.toHaveBeenCalled();
  });
});
