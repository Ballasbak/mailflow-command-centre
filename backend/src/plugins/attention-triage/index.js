// Phase 1: a registered, inert plugin foundation.
// Do not attach inboxIngest, AI calls or mailbox mutations until separately tested.
export const attentionTriagePlugin = {
  id: 'attention-triage',
  name: 'Attention Triage (development)',
  version: '0.1.0',
  tier: 1,
};
