// Authenticated, read-only Attention Triage API.
// Frontend clients never access the raw email database or provider credentials.
import { Router } from 'express';
import { requireAuth, isPluginActivated, listAttentionItems, acknowledgeAttentionItem, isUuid } from '../api.js';

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

export default router;
