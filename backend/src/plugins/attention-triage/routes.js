// Authenticated, read-only Attention Triage API.
// Frontend clients never access the raw email database or provider credentials.
import { Router } from 'express';
import { requireAuth, isPluginActivated, listAttentionItems } from '../api.js';

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
    typeof accountId !== 'string' || !/^[0-9a-f-]{36}$/i.test(accountId)
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

export default router;
