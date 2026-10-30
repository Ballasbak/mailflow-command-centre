import { describe, expect, it, vi } from 'vitest';

vi.mock('../api.js', () => ({
  getAccountConfig: vi.fn(),
  recoverMissingPluginMessages: vi.fn(),
}));
vi.mock('./ingest.js', () => ({ triageEnabledForAccount: vi.fn() }));
import { reconcileUnqueuedInbox } from './reconcile.js';

const ID = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const account = { id: ID, user_id: USER };
const ACTIVATED = '2026-10-20T10:00:00.000Z';

function deps(config = { enabled: true, activatedAt: ACTIVATED }) {
  return {
    enabled: vi.fn().mockResolvedValue(true),
    getConfig: vi.fn().mockResolvedValue(config),
    recover: vi.fn().mockResolvedValue(['33333333-3333-4333-8333-333333333333']),
  };
}

describe('Attention Triage background inbox reconciliation', () => {
  it('uses a server-recorded baseline in a bounded account-scoped recovery', async () => {
    const d = deps();
    const found = await reconcileUnqueuedInbox({ account }, d);
    expect(found).toHaveLength(1);
    expect(d.enabled).toHaveBeenCalledWith({ account });
    expect(d.getConfig).toHaveBeenCalledWith('attention-triage', ID);
    expect(d.recover).toHaveBeenCalledWith({
      accountId: ID, pluginId: 'attention-triage', activatedAt: ACTIVATED, limit: 25,
    });
  });

  it('does not access configuration or recovery for disabled mailboxes', async () => {
    const d = deps();
    d.enabled.mockResolvedValue(false);
    expect(await reconcileUnqueuedInbox({ account }, d)).toEqual([]);
    expect(d.getConfig).not.toHaveBeenCalled();
    expect(d.recover).not.toHaveBeenCalled();
  });

  it('refuses to run without a server activation baseline', async () => {
    const d = deps({ enabled: true });
    expect(await reconcileUnqueuedInbox({ account }, d)).toEqual([]);
    expect(d.recover).not.toHaveBeenCalled();
  });

  it('refuses disabled per-account configuration even after outer gate', async () => {
    const d = deps({ enabled: false, activatedAt: ACTIVATED });
    expect(await reconcileUnqueuedInbox({ account }, d)).toEqual([]);
    expect(d.recover).not.toHaveBeenCalled();
  });

  it('refuses missing account ownership before any reads', async () => {
    const d = deps();
    expect(await reconcileUnqueuedInbox({ account: { id: ID } }, d)).toEqual([]);
    expect(d.enabled).not.toHaveBeenCalled();
    expect(d.getConfig).not.toHaveBeenCalled();
  });

  it('surfaces database failure to the worker for logging and retry next tick', async () => {
    const d = deps();
    d.recover.mockRejectedValue(new Error('transient database failure'));
    await expect(reconcileUnqueuedInbox({ account }, d)).rejects.toThrow(/transient/);
  });
});
