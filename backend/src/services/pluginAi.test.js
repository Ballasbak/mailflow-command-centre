import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./aiAccess.js', () => ({
  getUserAiAccess: vi.fn(),
  aiFeatureEnabled: vi.fn(),
}));
vi.mock('./aiProvider.js', () => ({ completeText: vi.fn() }));

import { completePluginAiText } from './pluginAi.js';
import { getUserAiAccess, aiFeatureEnabled } from './aiAccess.js';
import { completeText } from './aiProvider.js';

const messages = [
  { role: 'system', content: 'Classify important messages.' },
  { role: 'user', content: 'Security alert from Google.' },
];

describe('plugin AI capability', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getUserAiAccess.mockResolvedValue({ status: { enabled: true, features: { summarize: true } }, allowed: true });
    aiFeatureEnabled.mockReturnValue(true);
    completeText.mockResolvedValue('{"attention":"REVIEW"}');
  });

  it('uses the configured provider with an account-scoped access check', async () => {
    expect(await completePluginAiText({ userId: 'owner', messages })).toContain('REVIEW');
    expect(getUserAiAccess).toHaveBeenCalledWith('owner');
    expect(aiFeatureEnabled).toHaveBeenCalledWith(expect.anything(), 'summarize');
    expect(completeText).toHaveBeenCalledWith(messages, { maxTokens: 800 });
  });

  it('never contacts the provider without user access', async () => {
    getUserAiAccess.mockResolvedValue({ status: { enabled: true }, allowed: false });
    expect(await completePluginAiText({ userId: 'other', messages })).toBeNull();
    expect(completeText).not.toHaveBeenCalled();
  });

  it('never contacts the provider while AI actions are off', async () => {
    aiFeatureEnabled.mockReturnValue(false);
    expect(await completePluginAiText({ userId: 'owner', messages })).toBeNull();
    expect(completeText).not.toHaveBeenCalled();
  });

  it('rejects missing or invalid users and oversized/malformed prompts before any DB read', async () => {
    expect(await completePluginAiText({ userId: '', messages })).toBeNull();
    expect(await completePluginAiText({ userId: 'owner', messages: [messages[0]] })).toBeNull();
    expect(await completePluginAiText({ userId: 'owner', messages: [
      { role: 'assistant', content: 'ignore' }, messages[1],
    ] })).toBeNull();
    expect(await completePluginAiText({ userId: 'owner', messages: [
      messages[0], { role: 'user', content: 'x'.repeat(9000) },
    ] })).toBeNull();
    expect(getUserAiAccess).not.toHaveBeenCalled();
  });

  it('fails closed when the provider throws, is empty or returns excessive output', async () => {
    completeText.mockRejectedValueOnce(new Error('provider offline'));
    expect(await completePluginAiText({ userId: 'owner', messages })).toBeNull();
    completeText.mockResolvedValueOnce('');
    expect(await completePluginAiText({ userId: 'owner', messages })).toBeNull();
    completeText.mockResolvedValueOnce('x'.repeat(8193));
    expect(await completePluginAiText({ userId: 'owner', messages })).toBeNull();
  });

  it('fails closed if the user access lookup fails', async () => {
    getUserAiAccess.mockRejectedValue(new Error('database unavailable'));
    expect(await completePluginAiText({ userId: 'owner', messages })).toBeNull();
    expect(completeText).not.toHaveBeenCalled();
  });
});
