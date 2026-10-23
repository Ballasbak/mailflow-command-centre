import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db.js', () => ({ query: vi.fn() }));
import { query } from './db.js';
import {
  acknowledgeAttentionItem, OWNER_STATUSES, validateAttentionAcknowledgement,
} from './attentionAcknowledge.js';

const USER = '11111111-1111-4111-8111-111111111111';
const MESSAGE = '22222222-2222-4222-8222-222222222222';
const TIME = new Date('2026-10-21T10:00:00.000Z');
const valid = { userId: USER, messageId: MESSAGE, status: 'EXPECTED', now: TIME };

describe('owner-controlled attention acknowledgement', () => {
  beforeEach(() => {
    query.mockReset();
    query.mockResolvedValue({ rows: [{ id: MESSAGE }] });
  });

  it('accepts only OPEN, EXPECTED and RESOLVED and a valid owner/message', () => {
    expect(OWNER_STATUSES).toEqual(['OPEN', 'RESOLVED', 'EXPECTED']);
    expect(validateAttentionAcknowledgement(valid)).toEqual(valid);
    for (const status of OWNER_STATUSES) {
      expect(validateAttentionAcknowledgement({ ...valid, status }).status).toBe(status);
    }
  });

  it('updates only the plugin annotation on an owned, actionable message', async () => {
    expect(await acknowledgeAttentionItem(valid)).toBe(true);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('UPDATE messages AS m');
    expect(sql).toContain('FROM email_accounts AS a');
    expect(sql).toContain('m.account_id = a.id');
    expect(sql).toContain('a.user_id = $1::uuid');
    expect(sql).toContain('m.is_deleted = false');
    expect(sql).toContain("->> 'status') = 'DONE'");
    expect(sql).toContain("->> 'status') = 'NEEDS_REVIEW'");
    expect(sql).toContain("IN ('YES', 'REVIEW')");
    expect(sql).toContain("jsonb_build_object('ownerStatus', $3::text");
    expect(sql).toContain('ownerUpdatedBy');
    expect(sql).toContain('COALESCE(m.plugin_annotations -> $5');
    expect(sql).not.toMatch(/DELETE FROM|SET\s+is_read|SET\s+folder|body_text\s*=|body_html\s*=/i);
    expect(params).toEqual([USER, MESSAGE, 'EXPECTED', TIME.toISOString(), 'attention-triage']);
  });

  it('records deliberate actions only after the database acknowledges them', async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await acknowledgeAttentionItem(valid)).toBe(false);
  });

  it('does not reveal another user or nonexistent messages through different results', async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await acknowledgeAttentionItem({ ...valid, status: 'RESOLVED' })).toBe(false);
    const sql = query.mock.calls[0][0];
    expect(sql).toContain('a.user_id = $1::uuid');
    expect(sql).toContain('RETURNING m.id');
  });

  it('can reopen a previously acknowledged actionable item', async () => {
    expect(await acknowledgeAttentionItem({ ...valid, status: 'OPEN' })).toBe(true);
    expect(query.mock.calls[0][1][2]).toBe('OPEN');
  });

  it('rejects invalid statuses or user inputs before doing any DB work', async () => {
    await expect(acknowledgeAttentionItem({ ...valid, userId: 'no' })).rejects.toThrow(/user/);
    await expect(acknowledgeAttentionItem({ ...valid, messageId: 'bad' })).rejects.toThrow(/message/);
    await expect(acknowledgeAttentionItem({ ...valid, status: 'DELETE' })).rejects.toThrow(/status/);
    await expect(acknowledgeAttentionItem({ ...valid, status: 'QUEUED' })).rejects.toThrow(/status/);
    await expect(acknowledgeAttentionItem({ ...valid, now: new Date('bad') })).rejects.toThrow(/timestamp/);
    expect(query).not.toHaveBeenCalled();
  });

  it('does not accept inherited properties as acknowledgement statuses', async () => {
    await expect(acknowledgeAttentionItem({ ...valid, status: 'toString' }))
      .rejects.toThrow(/status/);
    expect(query).not.toHaveBeenCalled();
  });
});
