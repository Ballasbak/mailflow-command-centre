import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db.js', () => ({ query: vi.fn() }));
import { query } from './db.js';
import { recoverMissingPluginMessages } from './pluginMessageRecovery.js';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const MESSAGE = '22222222-2222-4222-8222-222222222222';
const ACTIVATED = '2026-10-20T10:00:00.000Z';
const NOW = new Date('2026-10-20T12:00:00.000Z');
const valid = { accountId: ACCOUNT, pluginId: 'attention-triage', activatedAt: ACTIVATED, now: NOW };

describe('Attention Triage inbox reconciliation', () => {
  beforeEach(() => {
    query.mockReset();
    query.mockResolvedValue({ rows: [{ id: MESSAGE }] });
  });

  it('recovers only bounded, eligible unannotated inbox messages after activation', async () => {
    expect(await recoverMissingPluginMessages(valid)).toEqual([MESSAGE]);
    expect(query).toHaveBeenCalledOnce();
    const [sql, args] = query.mock.calls[0];
    expect(sql).toMatch(/WITH candidates AS/);
    expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(sql).toMatch(/m.account_id = \$1/);
    expect(sql).toMatch(/m.folder = 'INBOX'/);
    expect(sql).toMatch(/m.is_deleted = false/);
    expect(sql).toMatch(/m.synced_at >= \$3::timestamptz/);
    expect(sql).toMatch(/m.synced_at <= \$4::timestamptz/);
    expect(sql).toMatch(/m.date IS NULL OR m.date >= \$5::timestamptz/);
    expect(sql).toMatch(/NOT \(COALESCE\(m.plugin_annotations/);
    expect(sql).toMatch(/LIMIT \$6/);
    expect(sql).toMatch(/UPDATE messages AS m/);
    expect(sql).not.toMatch(/DELETE FROM|is_read\s*=|is_starred\s*=|SET folder/i);
    expect(args.slice(0, 6)).toEqual([
      ACCOUNT, 'attention-triage', ACTIVATED, NOW.toISOString(),
      '2026-10-13T10:00:00.000Z', 25,
    ]);
    expect(JSON.parse(args[6])).toEqual({
      status: 'QUEUED', version: 1, attempts: 0,
      queuedAt: NOW.toISOString(), source: 'inbox-recovery',
    });
  });

  it('returns an empty result without classifying or altering the inbox when none are eligible', async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await recoverMissingPluginMessages(valid)).toEqual([]);
  });

  it('accepts smaller batches but rejects unbounded recovery requests', async () => {
    await recoverMissingPluginMessages({ ...valid, limit: 5 });
    expect(query.mock.calls[0][1][5]).toBe(5);
    query.mockReset();
    await expect(recoverMissingPluginMessages({ ...valid, limit: 1000 }))
      .rejects.toThrow(/limit/);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects absent or future activation baselines before any DB call', async () => {
    await expect(recoverMissingPluginMessages({ ...valid, activatedAt: null }))
      .rejects.toThrow(/baseline/);
    await expect(recoverMissingPluginMessages({
      ...valid, activatedAt: '2099-01-01T00:00:00Z',
    })).rejects.toThrow(/baseline/);
    await expect(recoverMissingPluginMessages({ ...valid, activatedAt: 'unparseable' }))
      .rejects.toThrow(/baseline/);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects the old four-section UUID format instead of silently accepting it', async () => {
    await expect(recoverMissingPluginMessages({
      ...valid, accountId: '11111111-1111-4111-111111111111',
    })).rejects.toThrow(/account/);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects invalid user-controlled identifiers before the SQL query', async () => {
    await expect(recoverMissingPluginMessages({ ...valid, accountId: 'invalid' }))
      .rejects.toThrow(/account/);
    await expect(recoverMissingPluginMessages({ ...valid, pluginId: 'wrong name' }))
      .rejects.toThrow(/plugin/);
    expect(query).not.toHaveBeenCalled();
  });

  it('does not run with invalid current times', async () => {
    await expect(recoverMissingPluginMessages({ ...valid, now: new Date('invalid') }))
      .rejects.toThrow(/current time/);
    expect(query).not.toHaveBeenCalled();
  });
});
