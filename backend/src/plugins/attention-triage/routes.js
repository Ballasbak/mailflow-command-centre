// Authenticated, read-only Attention Triage API.
// Frontend clients never access the raw email database or provider credentials.
import { Router } from 'express';
import { requireAuth, isPluginActivated, listAttentionItems, acknowledgeAttentionItem,
  listOwnedAttentionAccounts, disableOwnedAttentionAccount, isUuid } from '../api.js';

const router = Router();
router.use(requireAuth);

// GET /api/attention/items?accountId=<owned account UUID>&limit=30
// Disabled by default until the owner explicitly activates the plugin.
router.get('/items', async (req, res) => {
  const userId = req.session?.userId;
  const accountId = req.query?.accountId ?? null;
  const rawLimit = req.query?.limit;
  const limit = rawLimit === undefined ? 30 : Number(rawLimit);

  if ((accountId !== null && (
    !isUuid(accountId)
  )) || !Number.isInteger(limit) || limit < 1 || limit > 50) {
    return res.status(400).json({ error: 'Invalid attention feed parameters' });
  }

  // Require the plugin toggle even for reads, but never require the mailbox
  // worker to be online. Previously classified items remain viewable.
  try {
    if (!await isPluginActivated(userId, 'attention-triage')) {
      return res.status(403).json({ error: 'Attention Triage is not activated' });
    }
    const feed = await listAttentionItems({ userId, accountId, limit });
    res.set('Cache-Control', 'private, no-store');
    return res.json(feed);
  } catch {
    return res.status(503).json({ error: 'Attention feed is temporarily unavailable' });
  }
});

// PATCH /api/attention/items/:id/status { status: 'RESOLVED' | 'EXPECTED' | 'OPEN' }
// Deliberate owner action only. The global /api middleware checks the
// X-Requested-With CSRF header for any modifying request.
router.patch('/items/:id/status', async (req, res) => {
  const userId = req.session?.userId;
  const messageId = req.params?.id;
  const status = req.body?.status;
  if (!isUuid(messageId) || !['OPEN', 'RESOLVED', 'EXPECTED'].includes(status)) {
    return res.status(400).json({ error: 'Invalid attention acknowledgement' });
  }
  try {
    if (!await isPluginActivated(userId, 'attention-triage')) {
      return res.status(403).json({ error: 'Attention Triage is not activated' });
    }
    const updated = await acknowledgeAttentionItem({ userId, messageId, status });
    if (!updated) return res.status(404).json({ error: 'Attention item not found' });
    res.set('Cache-Control', 'private, no-store');
    return res.json({ ok: true, id: messageId, ownerStatus: status });
  } catch {
    return res.status(503).json({ error: 'Attention acknowledgement is temporarily unavailable' });
  }
});

// GET /api/attention/accounts
// The read-only dashboard toggle does NOT enable automated mailbox processing.
router.get('/accounts', async (req, res) => {
  try {
    if (!await isPluginActivated(req.session?.userId, 'attention-triage')) {
      return res.status(403).json({ error: 'Attention Triage is not activated' });
    }
    const accounts = await listOwnedAttentionAccounts({ userId: req.session.userId });
    res.set('Cache-Control', 'private, no-store');
    return res.json({ accounts, automationReleased: false });
  } catch {
    return res.status(503).json({ error: 'Attention account controls are temporarily unavailable' });
  }
});

// PATCH /api/attention/accounts/:id/automation { enabled: false }
// This phase supports EMERGENCY OFF only. Never accept a client-provided
// activation baseline, never turn on a worker, and never trigger IMAP reconnect.
router.patch('/accounts/:id/automation', async (req, res) => {
  const accountId = req.params?.id;
  const enabled = req.body?.enabled;
  if (!isUuid(accountId) || typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'Invalid attention account request' });
  }
  if (enabled) {
    return res.status(423).json({
      error: 'Automatic classification is locked until the release safeguards pass',
    });
  }
  try {
    const disabled = await disableOwnedAttentionAccount({
      userId: req.session.userId, accountId,
    });
    if (!disabled) return res.status(404).json({ error: 'Attention account not found' });
    res.set('Cache-Control', 'private, no-store');
    return res.json({ ok: true, accountId, enabled: false });
  } catch {
    return res.status(503).json({ error: 'Attention account control is temporarily unavailable' });
  }
});

export default router;
