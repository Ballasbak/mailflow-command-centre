import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db.js', () => ({ query: vi.fn() }));
import { query } from './db.js';
import {
  listOwnedAttentionAccounts, projectAttentionAccount, disableOwnedAttentionAccount,
} from './attentionAccountControl.js';

const USER = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '22222222-2222-4222-8222-222222222222';

describe('owner-scoped Attention Triage account control', () => {
  beforeEach(() => {
    query.mockReset();
    query.mockResolvedValue({ rows: [] });
  });

  it('lists only accounts owned by the signed-in user, without returning secrets', async () => {
    query.mockResolvedValue({ rows: [{
      id: ACCOUNT, name: 'Example', email_address: 'demo@example.invalid',
      enabled: false, protocol: 'imap', last_sync: null,
      config: {}, auth_pass: 'DO NOT LEAK',
    }] });
    const rows = await listOwnedAttentionAccounts({ userId: USER });
    expect(rows).toEqual([{
      id: ACCOUNT, name: 'Example', emailAddress: 'demo@example.invalid',
      mailboxEnabled: false, protocol: 'imap', storedOptIn: false,
      monitoringEnabled: false, canEnable: false,
      releaseHold: 'Automatic classification is locked during development',
      lastSyncAt: null,
    }]);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/a.user_id = \$1::uuid/);
    expect(sql).toMatch(/pc.account_id = a.id AND pc.plugin_id = \$2/);
    expect(sql).not.toMatch(/auth_pass|oauth_access_token|oauth_refresh_token|password_hash|SELECT\s+\*/i);
    expect(params).toEqual([USER, 'attention-triage']);
    expect(JSON.stringify(rows)).not.toContain('DO NOT LEAK');
  });

  it('does not report monitoring active just because stale config says enabled', () => {
    const row = projectAttentionAccount({
      id: ACCOUNT, enabled: true, protocol: 'imap',
      config: { enabled: true, activatedAt: '2026-10-20T10:00:00.000Z' },
    });
    expect(row.storedOptIn).toBe(true);
    expect(row.monitoringEnabled).toBe(false);
    expect(row.canEnable).toBe(false);
  });

  it('disables only a mailbox belonging to this user and removes the old baseline', async () => {
    query.mockResolvedValue({ rows: [{ account_id: ACCOUNT }] });
    expect(await disableOwnedAttentionAccount({ userId: USER, accountId: ACCOUNT })).toBe(true);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO plugin_account_config/);
    expect(sql).toMatch(/FROM email_accounts a/);
    expect(sql).toMatch(/a.user_id = \$1::uuid/);
    expect(sql).toMatch(/a.id = \$2::uuid/);
    expect(sql).toMatch(/ON CONFLICT \(plugin_id, account_id\)/);
    expect(sql).toMatch(/- 'activatedAt'/);
    expect(sql).toMatch(/"enabled":false/);
    expect(sql).not.toMatch(/UPDATE email_accounts|UPDATE messages|DELETE FROM|is_read\s*=/);
    expect(params).toEqual([USER, ACCOUNT, 'attention-triage']);
  });

  it('returns a uniform not-found outcome for an unowned or missing account', async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await disableOwnedAttentionAccount({ userId: USER, accountId: ACCOUNT })).toBe(false);
  });

  it('rejects invalid owner/account UUIDs before querying the database', async () => {
    await expect(listOwnedAttentionAccounts({ userId: 'bad' })).rejects.toThrow(/user/);
    await expect(disableOwnedAttentionAccount({ userId: USER, accountId: 'bad' }))
      .rejects.toThrow(/account/);
    await expect(disableOwnedAttentionAccount({ userId: 'bad', accountId: ACCOUNT }))
      .rejects.toThrow(/user/);
    expect(query).not.toHaveBeenCalled();
  });

  it('fails closed when configuration is malformed or absent', () => {
    expect(projectAttentionAccount({ id: ACCOUNT, config: null }).monitoringEnabled).toBe(false);
    expect(projectAttentionAccount({ id: ACCOUNT, config: [] }).storedOptIn).toBe(false);
    expect(projectAttentionAccount({ id: ACCOUNT, config: 'enabled' }).canEnable).toBe(false);
  });
});
