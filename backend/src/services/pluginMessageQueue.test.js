import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db.js', () => ({ query: vi.fn() }));
import { query } from './db.js';
import { enqueuePluginMessageIds } from './pluginMessageQueue.js';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const FIRST = '22222222-2222-4222-8222-222222222222';
const SECOND = '33333333-3333-4333-8333-333333333333';

describe('new-mail plugin queue', () => {
  beforeEach(() => {
    query.mockReset();
    query.mockResolvedValue({ rows: [{ id: FIRST }] });
  });

  it('writes only namespaced queue metadata for a specified account', async () => {
    const queued = await enqueuePluginMessageIds({
      accountId: ACCOUNT, pluginId: 'attention-triage',
      messageIds: [FIRST, SECOND, FIRST], now: new Date('2026-10-20T20:00:00Z'),
    });
    expect(queued).toEqual([FIRST]);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/UPDATE messages/);
    expect(sql).toMatch(/jsonb_set/);
    expect(sql).toMatch(/account_id = \$1/);
    expect(sql).toMatch(/id = ANY\(\$4::uuid\[\]\)/);
    expect(sql).toMatch(/is_deleted = false/);
    expect(sql).toMatch(/NOT \(COALESCE\(plugin_annotations/);
    expect(sql).not.toMatch(/DELETE FROM|mark.*read|is_read\s*=/i);
    expect(params[0]).toBe(ACCOUNT);
    expect(params[1]).toBe('attention-triage');
    expect(params[3]).toEqual([FIRST, SECOND]);
    expect(JSON.parse(params[2])).toEqual({
      status: 'QUEUED', version: 1, attempts: 0, queuedAt: '2026-10-20T20:00:00.000Z',
    });
  });

  it('does not hit the database for an empty batch', async () => {
    expect(await enqueuePluginMessageIds({ accountId: ACCOUNT, pluginId: 'attention-triage', messageIds: [] }))
      .toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns empty if the database skipped an existing annotation', async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await enqueuePluginMessageIds({ accountId: ACCOUNT, pluginId: 'attention-triage', messageIds: [FIRST] }))
      .toEqual([]);
  });

  it('rejects invalid account/plugin/message identifiers before touching the database', async () => {
    await expect(enqueuePluginMessageIds({ accountId: 'wrong', pluginId: 'attention-triage', messageIds: [FIRST] }))
      .rejects.toThrow(/account/);
    await expect(enqueuePluginMessageIds({ accountId: ACCOUNT, pluginId: 'OTHER plugin', messageIds: [FIRST] }))
      .rejects.toThrow(/plugin/);
    await expect(enqueuePluginMessageIds({ accountId: ACCOUNT, pluginId: 'attention-triage', messageIds: ['nope'] }))
      .rejects.toThrow(/message/);
    expect(query).not.toHaveBeenCalled();
  });

  it('requires the full five-section UUID format (8-4-4-4-12)', async () => {
    // Regression for the missing fourth UUID segment: a shortened format used
    // to match the implementation regex and made every valid account id fail.
    await expect(enqueuePluginMessageIds({
      accountId: '11111111-1111-4111-111111111111',
      pluginId: 'attention-triage', messageIds: [FIRST],
    })).rejects.toThrow(/account/);
    await expect(enqueuePluginMessageIds({
      accountId: ACCOUNT, pluginId: 'attention-triage',
      messageIds: ['22222222-2222-4222-222222222222'],
    })).rejects.toThrow(/message/);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects oversized batches rather than running an unbounded query', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => 'aaaaaaaa-aaaa-4aaa-8aaa-' + i.toString(16).padStart(12, '0'));
    await expect(enqueuePluginMessageIds({ accountId: ACCOUNT, pluginId: 'attention-triage', messageIds: ids }))
      .rejects.toThrow(/Too many/);
    expect(query).not.toHaveBeenCalled();
  });
});
