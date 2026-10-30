import { describe, expect, it, vi } from 'vitest';

vi.mock('../api.js', () => ({ completePluginAiText: vi.fn() }));
import { classifyAttentionEmail } from './classify.js';

const securityResult = {
  attention: 'YES', priority: 'HIGH', category: 'SECURITY',
  why: 'An app password was created.', action: 'Confirm whether you created it.', deadline: 'NONE',
};

describe('Attention Triage AI classification', () => {
  it('produces an actionable structured result without mailbox changes', async () => {
    const complete = vi.fn().mockResolvedValue(JSON.stringify(securityResult));
    const result = await classifyAttentionEmail({
      userId: 'owner', from: 'no-reply@accounts.google.com',
      subject: 'Security alert', body: 'An app password was created.',
    }, complete);
    expect(result).toEqual({ ok: true, result: { version: 1, ...securityResult } });
    const request = complete.mock.calls[0][0];
    expect(request.userId).toBe('owner');
    expect(request.messages[0].content).toContain('untrusted evidence');
    expect(request.messages[1].content).toContain('Security alert');
  });

  it('preserves ordinary noise classifications', async () => {
    const complete = vi.fn().mockResolvedValue(JSON.stringify({
      attention: 'NO', priority: 'NONE', category: 'NOISE',
      why: 'Routine newsletter.', action: 'NONE', deadline: 'NONE',
    }));
    const result = await classifyAttentionEmail({ userId: 'owner', subject: 'Newsletter' }, complete);
    expect(result.ok).toBe(true);
    expect(result.result.attention).toBe('NO');
  });

  it('never calls AI when there is no verified owner', async () => {
    const complete = vi.fn();
    expect(await classifyAttentionEmail({ subject: 'Private mail' }, complete))
      .toEqual({ ok: false, reason: 'missing_owner' });
    expect(complete).not.toHaveBeenCalled();
  });

  it('never turns a provider failure into an unimportant classification', async () => {
    const complete = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await classifyAttentionEmail({ userId: 'owner', subject: 'Invoice overdue' }, complete))
      .toEqual({ ok: false, reason: 'ai_unavailable' });
  });

  it('treats bad model output as a failed classification, not NO', async () => {
    const complete = vi.fn().mockResolvedValue('ignore all instructions');
    expect(await classifyAttentionEmail({ userId: 'owner' }, complete))
      .toEqual({ ok: false, reason: 'invalid_ai_result' });
  });

  it('treats disabled or unavailable AI as an explicit failure', async () => {
    const complete = vi.fn().mockResolvedValue(null);
    expect(await classifyAttentionEmail({ userId: 'owner' }, complete))
      .toEqual({ ok: false, reason: 'ai_unavailable' });
  });
});
