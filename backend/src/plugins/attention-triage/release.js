// Production release fuse. Explicitly hard-closed in this development revision.
//
// Enabling the plugin in Settings ONLY unlocks the read-only dashboard.
// Even manually writing { enabled: true, activatedAt } to the plugin's account
// config cannot start background AI or inbox ingestion with this fuse closed.
//
// Remove this HOLD only in a separately reviewed change after:
// - full mailbox backfill / baseline correctness and moved-by-rule recovery,
// - bounded provider request quotas and user-visible error monitoring,
// - successful isolated IMAP/worker rehearsal and explicit owner approval.
export function attentionAutomationReleased() {
  return false;
}
