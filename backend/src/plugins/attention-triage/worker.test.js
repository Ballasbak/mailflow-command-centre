import { describe, expect, it, vi } from 'vitest';

vi.mock('../api.js', () => ({
  claimNextPluginMessage: vi.fn(),
  settlePluginMessage: vi.fn(),
  logger: { warn: vi.fn() },
}));
vi.mock('./classify.js', () => ({ classifyAttentionEmail: vi.fn() }));
vi.mock('./ingest.js', () => ({ triageEnabledForAccount: vi.fn() }));
import { attentionTriageTick } from './worker.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const MSG = '44444444-4444-4444-8444-444444444444';
const LEASE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const account = { id: A, user_id: USER };
const result = {
  version: 1, attention: 'YES', priority: 'HIGH',
  category: 'SECURITY', why: 'New password.', action: 'Confirm activity.', deadline: 'NONE',
};
function deps() {
  return {
    enabled: vi.fn().mockResolvedValue(true),
    claim: vi.fn().mockResolvedValue({
      id: MSG, leaseId: LEASE, attempts: 1,
      from_name: 'Google', from_email: 'security@example.test',
      subject: 'Alert', content: 'New password.',
    }),
    classify: vi.fn().mockResolvedValue({ ok: true, result }),
    settle: vi.fn().mockResolvedValue(true),
    warn: vi.fn(),
  };
}

describe('background Attention Triage tick', () => {
  it('claims and settles one message without touching its read state', async () => {
    const d = deps();
    await attentionTriageTick({ account }, d);
    expect(d.claim).toHaveBeenCalledOnce();
    expect(d.claim).toHaveBeenCalledWith({ accountId: A, pluginId: 'attention-triage' });
    expect(d.classify).toHaveBeenCalledWith({
      userId: USER, from: 'Google security@example.test',
      subject: 'Alert', body: 'New password.',
    });
    expect(d.settle).toHaveBeenCalledWith({
      accountId: A, pluginId: 'attention-triage', messageId: MSG,
      leaseId: LEASE, attempts: 1, outcome: { ok: true, result },
    });
    expect(d.warn).not.toHaveBeenCalled();
  });

  it('does not claim anything when plugin/account is disabled', async () => {
    const d = deps();
    d.enabled.mockResolvedValue(false);
    await attentionTriageTick({ account }, d);
    expect(d.claim).not.toHaveBeenCalled();
    expect(d.classify).not.toHaveBeenCalled();
  });

  it('does not call AI after the account is disabled between claim and processing', async () => {
    const d = deps();
    d.enabled.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await attentionTriageTick({ account }, d);
    expect(d.claim).toHaveBeenCalledOnce();
    expect(d.classify).not.toHaveBeenCalled();
    expect(d.settle).not.toHaveBeenCalled();
  });

  it('does nothing when the queue is empty', async () => {
    const d = deps();
    d.claim.mockResolvedValue(null);
    await attentionTriageTick({ account }, d);
    expect(d.classify).not.toHaveBeenCalled();
    expect(d.settle).not.toHaveBeenCalled();
  });

  it('passes an unsuccessful AI result to durable retry settlement', async () => {
    const d = deps();
    d.classify.mockResolvedValue({ ok: false, reason: 'ai_unavailable' });
    await attentionTriageTick({ account }, d);
    expect(d.settle).toHaveBeenCalledWith(expect.objectContaining({
      outcome: { ok: false, reason: 'ai_unavailable' },
    }));
    expect(d.warn).not.toHaveBeenCalled();
  });

  it('catches unexpected classifier errors as worker_error for retry', async () => {
    const d = deps();
    d.classify.mockRejectedValue(new Error('private sender: hidden@example.test'));
    await attentionTriageTick({ account }, d);
    expect(d.settle).toHaveBeenCalledWith(expect.objectContaining({
      outcome: { ok: false, reason: 'worker_error' },
    }));
    expect(d.warn).not.toHaveBeenCalled();
  });

  it('does not exceed the model-call attempt budget after a crashed lease', async () => {
    const d = deps();
    d.claim.mockResolvedValue({ id: MSG, leaseId: LEASE, attempts: 4 });
    await attentionTriageTick({ account }, d);
    expect(d.classify).not.toHaveBeenCalled();
    expect(d.settle).toHaveBeenCalledWith(expect.objectContaining({
      attempts: 4, outcome: { ok: false, reason: 'worker_error' },
    }));
  });

  it('ignores stale settlement results rather than overwriting another lease', async () => {
    const d = deps();
    d.settle.mockResolvedValue(false);
    await attentionTriageTick({ account }, d);
    expect(d.warn).toHaveBeenCalledWith(expect.stringContaining('stale result ignored'));
  });

  it('does not expose email data in logs after a storage error', async () => {
    const d = deps();
    d.claim.mockRejectedValue(new Error('secret email body'));
    await attentionTriageTick({ account }, d);
    expect(d.warn).toHaveBeenCalledOnce();
    expect(d.warn.mock.calls[0][0]).not.toMatch(/secret|email body/i);
  });

  it('uses a single flight across accounts; releases it on completion', async () => {
    const d = deps();
    let release;
    // Hold only the first AI call. The second must be allowed to complete
    // normally after the first releases the global single-flight lock.
    d.classify.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const first = attentionTriageTick({ account }, d);
    await vi.waitFor(() => expect(d.classify).toHaveBeenCalledOnce());
    // A second tick must not claim a second message while the model is busy.
    await attentionTriageTick({ account }, d);
    await attentionTriageTick({ account: { id: B, user_id: USER } }, d);
    expect(d.claim).toHaveBeenCalledTimes(1);
    release({ ok: true, result });
    await first;
    await attentionTriageTick({ account: { id: B, user_id: USER } }, d);
    expect(d.claim).toHaveBeenCalledTimes(2);
    expect(d.classify).toHaveBeenCalledTimes(2);
    expect(d.settle).toHaveBeenCalledTimes(2);
  });

  it('does not process an account with no verified owner', async () => {
    const d = deps();
    await attentionTriageTick({ account: { id: A } }, d);
    expect(d.enabled).not.toHaveBeenCalled();
    expect(d.classify).not.toHaveBeenCalled();
  });
});
