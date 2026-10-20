// Read-only classification orchestration. Does not read, write, move or mark mail.
import { completePluginAiText } from '../api.js';
import { buildAttentionMessages, parseAttentionResult } from './policy.js';

export async function classifyAttentionEmail({ userId, from, subject, body } = {},
  complete = completePluginAiText) {
  // The background caller must take userId from an owned account, never from email text.
  if (typeof userId !== 'string' || !userId.trim()) {
    return { ok: false, reason: 'missing_owner' };
  }
  const messages = buildAttentionMessages({ from, subject, body });
  let raw = null;
  try {
    raw = await complete({ userId, messages });
  } catch {
    return { ok: false, reason: 'ai_unavailable' };
  }
  if (!raw) return { ok: false, reason: 'ai_unavailable' };
  const result = parseAttentionResult(raw);
  if (!result) return { ok: false, reason: 'invalid_ai_result' };
  return { ok: true, result };
}
