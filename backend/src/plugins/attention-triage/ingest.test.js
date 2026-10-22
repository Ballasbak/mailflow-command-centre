import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api.js', () => ({
  enqueuePluginMessageIds: vi.fn(),
  getAccountConfig: vi.fn(),
  isPluginActivatedForAccount: vi.fn(),
  logger: { warn: vi.fn() },
}));
import { enqueuePluginMessageIds, getAccountConfig, isPluginActivatedForAccount, logger } from '../api.js';
vi.mock('./release.js', () => ({ attentionAutomationReleased: vi.fn() }));
import { attentionAutomationReleased } from './release.js';
import { inboxIngest, selectAttentionCandidates, triageEnabledForAccount } from './ingest.js';

const A = '11111111-1111-4111-8111-111111111111';
const M1 = '22222222-2222-4222-8222-222222222222';
const M2 = '33333333-3333-4333-8333-333333333333';
const account = { id: A, user_id: '44444444-4444-4444-8444-444444444444' };

describe('Attention Triage inbox ingest', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    attentionAutomationReleased.mockReturnValue(true);
    isPluginActivatedForAccount.mockResolvedValue(false);
    getAccountConfig.mockResolvedValue({});
    enqueuePluginMessageIds.mockResolvedValue([M1]);
  });

  it('does nothing by default; no user activation means no account config read', async () => {
    await inboxIngest({ account, newInboxIds: [M1], deletedIds: new Set() });
    expect(isPluginActivatedForAccount).toHaveBeenCalledWith('attention-triage', A);
    expect(getAccountConfig).not.toHaveBeenCalled();
    expect(enqueuePluginMessageIds).not.toHaveBeenCalled();
  });

  it('requires explicit per-account consent even when the plugin is activated', async () => {
    isPluginActivatedForAccount.mockResolvedValue(true);
    await inboxIngest({ account, newInboxIds: [M1] });
    expect(getAccountConfig).toHaveBeenCalledWith('attention-triage', A);
    expect(enqueuePluginMessageIds).not.toHaveBeenCalled();
  });

  it('blocks automation without a recorded activation baseline', async () => {
    isPluginActivatedForAccount.mockResolvedValue(true);
    getAccountConfig.mockResolvedValue({ enabled: true });
    expect(await triageEnabledForAccount({ account })).toBe(false);
    await inboxIngest({ account, newInboxIds: [M1] });
    expect(enqueuePluginMessageIds).not.toHaveBeenCalled();
  });

  it('cannot ingest even with valid account consent while the release fuse is closed', async () => {
    isPluginActivatedForAccount.mockResolvedValue(true);
    getAccountConfig.mockResolvedValue({
      enabled: true, activatedAt: '2026-10-20T10:00:00.000Z',
    });
    attentionAutomationReleased.mockReturnValue(false);
    expect(await triageEnabledForAccount({ account })).toBe(false);
    await inboxIngest({ account, newInboxIds: [M1] });
    expect(enqueuePluginMessageIds).not.toHaveBeenCalled();
  });

  it('queues only genuinely new and still-present arrivals (including read arrivals)', async () => {
    isPluginActivatedForAccount.mockResolvedValue(true);
    getAccountConfig.mockResolvedValue({ enabled: true, activatedAt: '2026-10-20T10:00:00.000Z' });
    await inboxIngest({
      account, newInboxIds: [M1, M2, M1], deletedIds: new Set([M2]),
    });
    expect(enqueuePluginMessageIds).toHaveBeenCalledWith({
      accountId: A, pluginId: 'attention-triage', messageIds: [M1],
    });
  });

  it('splits a large arrival into bounded batches', async () => {
    isPluginActivatedForAccount.mockResolvedValue(true);
    getAccountConfig.mockResolvedValue({ enabled: true, activatedAt: '2026-10-20T10:00:00.000Z' });
    const ids = Array.from({ length: 205 },
      (_, i) => 'aaaaaaaa-aaaa-4aaa-8aaa-' + i.toString(16).padStart(12, '0'));
    await inboxIngest({ account, newInboxIds: ids });
    expect(enqueuePluginMessageIds).toHaveBeenCalledTimes(3);
    expect(enqueuePluginMessageIds.mock.calls.map(call => call[0].messageIds.length))
      .toEqual([100, 100, 5]);
  });

  it('returns without queue work when all arrivals were deleted by inbox rules', async () => {
    isPluginActivatedForAccount.mockResolvedValue(true);
    getAccountConfig.mockResolvedValue({ enabled: true, activatedAt: '2026-10-20T10:00:00.000Z' });
    await inboxIngest({ account, newInboxIds: [M2], deletedIds: [M2] });
    expect(enqueuePluginMessageIds).not.toHaveBeenCalled();
  });

  it('does not queue if the account identity is missing or the gate fails', async () => {
    expect(await triageEnabledForAccount({ account: { id: A } })).toBe(false);
    isPluginActivatedForAccount.mockRejectedValue(new Error('permissions unavailable'));
    expect(await triageEnabledForAccount({ account })).toBe(false);
    expect(enqueuePluginMessageIds).not.toHaveBeenCalled();
  });

  it('logs a generic error without accidentally exposing private email content', async () => {
    isPluginActivatedForAccount.mockResolvedValue(true);
    getAccountConfig.mockResolvedValue({ enabled: true, activatedAt: '2026-10-20T10:00:00.000Z' });
    enqueuePluginMessageIds.mockRejectedValue(new Error('email-body confidential'));
    await inboxIngest({ account, newInboxIds: [M1] });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).not.toContain('email-body');
  });

  it('selects candidates deterministically and excludes deleted ids', () => {
    expect(selectAttentionCandidates([M1, M2, M1], new Set([M2]))).toEqual([M1]);
    expect(selectAttentionCandidates([], new Set())).toEqual([]);
  });
});
