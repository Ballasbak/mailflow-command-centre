import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db.js', () => ({ query: vi.fn() }));
import { query } from './db.js';
import { attentionQueryInput, listAttentionItems, mapAttentionRow } from './attentionRead.js';

const USER = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const MSG = '33333333-3333-4333-8333-333333333333';

function row(status = 'DONE', attention = 'YES') {
  return {
    id: MSG, account_id: ACCOUNT, mailbox: 'owner@example.test',
    from_name: 'Example Support', from_email: 'support@example.test',
    subject: 'A customer needs help',
    date: new Date('2026-10-21T04:00:00Z'),
    synced_at: new Date('2026-10-21T04:01:00Z'),
    annotation: {
      status,
      result: { attention, priority: 'HIGH', category: 'CUSTOMER',
        why: 'The customer reports an issue.', action: 'Reply to the customer.', deadline: 'NONE' },
    },
    body_text: 'PRIVATE BODY MUST NEVER BE SENT',
    auth_pass: 'PRIVATE PASSWORD MUST NEVER BE SENT',
  };
}

describe('Attention Triage read-only feed', () => {
  beforeEach(() => {
    query.mockReset();
    query.mockResolvedValue({ rows: [row()] });
  });

  it('scopes every query to the logged-in owner, optional account, and bounded limit', async () => {
    const output = await listAttentionItems({ userId: USER, accountId: ACCOUNT, limit: 20 });
    const [sql, args] = query.mock.calls[0];
    expect(sql).toContain('JOIN email_accounts a ON a.id = m.account_id');
    expect(sql).toContain('a.user_id = $1::uuid');
    expect(sql).toContain('m.is_deleted = false');
    expect(sql).toContain('m.account_id = $2::uuid');
    expect(sql).toContain("IN ('YES', 'REVIEW')");
    expect(sql).toContain('NOT IN (\'RESOLVED\', \'EXPECTED\')');
    expect(sql).toContain('LIMIT $4::int');
    expect(sql).not.toMatch(/m\.body_text|m\.body_html|auth_pass|DELETE FROM|UPDATE messages/i);
    expect(args).toEqual([USER, ACCOUNT, 'attention-triage', 21]);
    expect(output).toMatchObject({ hasMore: false,
      items: [{ id: MSG, accountId: ACCOUNT, category: 'CUSTOMER', priority: 'HIGH' }],
    });
  });

  it('does not return mail content, raw annotations, or secrets', async () => {
    const data = await listAttentionItems({ userId: USER });
    expect(JSON.stringify(data)).not.toMatch(/PRIVATE BODY|PRIVATE PASSWORD/);
    expect(data.items[0]).not.toHaveProperty('annotation');
    expect(data.items[0]).not.toHaveProperty('body_text');
    expect(data.items[0].why).toBe('The customer reports an issue.');
  });

  it('includes a review item when the model repeatedly fails', () => {
    const review = mapAttentionRow({ ...row('NEEDS_REVIEW'), annotation: {
      status: 'NEEDS_REVIEW', lastError: 'ai_unavailable',
    } });
    expect(review).toMatchObject({ attention: 'REVIEW', jobStatus: 'NEEDS_REVIEW',
      priority: 'UNASSESSED', why: '' });
  });

  it('makes queue/retry items visible so failures are not silently hidden', () => {
    for (const status of ['QUEUED', 'RETRY', 'PROCESSING']) {
      const item = mapAttentionRow({ ...row(), annotation: { status } });
      expect(item).toMatchObject({ attention: 'REVIEW', jobStatus: status });
    }
  });

  it('hides NO classifications and resolved/expected owner acknowledgements', () => {
    expect(mapAttentionRow(row('DONE', 'NO'))).toBeNull();
    for (const ownerStatus of ['RESOLVED', 'EXPECTED']) {
      expect(mapAttentionRow({ ...row(), annotation: {
        ...row().annotation, ownerStatus,
      } })).toBeNull();
    }
  });

  it('never trusts raw database output as a safe API response', () => {
    const malformed = mapAttentionRow({
      ...row(), annotation: { status: 'DONE', result: {
        attention: 'YES', why: 'x'.repeat(1000), category: 'CUSTOMER',
        priority: 'HIGH', action: 'act', deadline: 'NONE',
      } },
    });
    expect(malformed.why).toHaveLength(500);
    expect(malformed).not.toHaveProperty('credentials');
  });

  it('enforces a maximum page size and rejects malformed owner or account ids', async () => {
    expect(attentionQueryInput({ userId: USER })).toEqual({ userId: USER, accountId: null, limit: 30 });
    await expect(listAttentionItems({ userId: USER, limit: 500 })).rejects.toThrow(/limit/);
    await expect(listAttentionItems({ userId: USER, accountId: 'bad' })).rejects.toThrow(/account/);
    await expect(listAttentionItems({ userId: 'bad' })).rejects.toThrow(/user/);
    expect(query).not.toHaveBeenCalled();
  });

  it('indicates when the results exceed the page limit without fetching everything', async () => {
    query.mockResolvedValue({ rows: [row(), { ...row(), id: '44444444-4444-4444-8444-444444444444' }] });
    const result = await listAttentionItems({ userId: USER, limit: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.hasMore).toBe(true);
    expect(query.mock.calls[0][1][3]).toBe(2);
  });
});
