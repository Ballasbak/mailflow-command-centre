// Default OFF, account opt-in (and per-user plugin activation) are both required.
// Phase 2B1 records new arrivals as QUEUED metadata. NO AI worker is wired yet.
import { inboxIngest, triageEnabledForAccount } from './ingest.js';

export const attentionTriagePlugin = {
  id: 'attention-triage',
  name: 'Attention Triage (development)',
  version: '0.2.0',
  tier: 1,
  hooks: {
    inboxIngest: {
      handler: inboxIngest,
      isActive: triageEnabledForAccount,
    },
  },
};
