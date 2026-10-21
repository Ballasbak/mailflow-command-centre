// Development-only registration. Default OFF: per-user activation and per-account
// opt-in are BOTH required. The worker is armed only on an eligible IMAP account's
// connection; reconnect after enabling it. Never runs against the working lab.
import { inboxIngest, triageEnabledForAccount } from './ingest.js';
import { attentionTriageTick } from './worker.js';

export const attentionTriagePlugin = {
  id: 'attention-triage',
  name: 'Attention Triage (development)',
  version: '0.4.0',
  tier: 1,
  hooks: {
    inboxIngest: {
      handler: inboxIngest,
      isActive: triageEnabledForAccount,
    },
  },
  sync: {
    intervalMs: 60000,
    isActive: triageEnabledForAccount,
    tick: attentionTriageTick,
  },
};
