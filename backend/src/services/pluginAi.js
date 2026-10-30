// Narrow AI-completion bridge for bundled mail plugins.
// The provider credentials never leave core; per-user AI access is rechecked per call.
// This is deliberately not a raw provider/network capability.
import { completeText } from './aiProvider.js';
import { aiFeatureEnabled, getUserAiAccess } from './aiAccess.js';

const MAX_SYSTEM_CHARS = 4096;
const MAX_USER_CHARS = 8000;
const MAX_OUTPUT_CHARS = 8192;

// Only two-message classification-style requests are accepted, with bounded input.
// Null means unavailable, refused, failed or invalid: caller MUST NOT interpret it as NO.
export async function completePluginAiText({ userId, messages } = {}) {
  if (typeof userId !== 'string' || !userId.trim() || userId.length > 128) return null;
  if (!Array.isArray(messages) || messages.length !== 2) return null;
  if (messages[0]?.role !== 'system' || messages[1]?.role !== 'user') return null;
  if (typeof messages[0].content !== 'string' ||
      typeof messages[1].content !== 'string' ||
      !messages[0].content || !messages[1].content ||
      messages[0].content.length > MAX_SYSTEM_CHARS ||
      messages[1].content.length > MAX_USER_CHARS) return null;

  try {
    const { status, allowed } = await getUserAiAccess(userId);
    if (!allowed || !aiFeatureEnabled(status, 'summarize')) return null;
    const answer = await completeText(messages, { maxTokens: 800 });
    if (typeof answer !== 'string' || !answer.trim() ||
        answer.length > MAX_OUTPUT_CHARS) return null;
    return answer;
  } catch {
    // Never expose provider errors, request text, or credentials in logs/responses.
    return null;
  }
}
