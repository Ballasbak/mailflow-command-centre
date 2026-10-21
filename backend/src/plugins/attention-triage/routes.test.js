import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api.js', () => ({
  requireAuth: (req, res, next) => next(),
  isPluginActivated: vi.fn(),
  listAttentionItems: vi.fn(),
  isUuid: vi.fn((value) => typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)),
}));

import router from './routes.js';
import { isPluginActivated, listAttentionItems } from '../api.js';

const USER = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '22222222-2222-4222-8222-222222222222';

function handler() {
  const layer = router.stack.find(item => item.route?.path === '/items');
  return layer?.route?.stack?.find(item => item.method === 'get')?.handle;
}
async function send(query = {}, session = { userId: USER }) {
  const req = { session, query };
  const res = {
    set: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  await handler()(req, res);
  return res;
}

describe('GET /api/attention/items', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    isPluginActivated.mockResolvedValue(true);
    listAttentionItems.mockResolvedValue({ items: [], hasMore: false });
  });

  it('registers one GET route, with no write endpoints', () => {
    expect(handler()).toBeTypeOf('function');
    const methods = router.stack.filter(x => x.route).map(x => Object.keys(x.route.methods));
    expect(methods).toEqual([['get']]);
  });

  it('passes the signed-in user, bounded limit and account filter to the scoped reader', async () => {
    const res = await send({ accountId: ACCOUNT, limit: '12' });
    expect(isPluginActivated).toHaveBeenCalledWith(USER, 'attention-triage');
    expect(listAttentionItems).toHaveBeenCalledWith({
      userId: USER, accountId: ACCOUNT, limit: 12,
    });
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(res.json).toHaveBeenCalledWith({ items: [], hasMore: false });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('defaults to a 30-item feed across owned mailboxes', async () => {
    await send();
    expect(listAttentionItems).toHaveBeenCalledWith({
      userId: USER, accountId: null, limit: 30,
    });
  });

  it('denies access when the plugin has not been activated', async () => {
    isPluginActivated.mockResolvedValue(false);
    const res = await send();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(listAttentionItems).not.toHaveBeenCalled();
  });

  it('rejects malformed and oversized inputs before looking up private messages', async () => {
    for (const query of [
      { accountId: 'wrong' }, { accountId: '11111111-1111-4111-111111111111' },
      { limit: '999' }, { limit: 'abc' }, { limit: '0' },
      { accountId: [ACCOUNT] },
    ]) {
      const res = await send(query);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(listAttentionItems).not.toHaveBeenCalled();
  });

  it('returns a generic error without leaking database or message content', async () => {
    listAttentionItems.mockRejectedValue(new Error('private@example.test email body secret'));
    const res = await send();
    expect(res.status).toHaveBeenCalledWith(503);
    const message = JSON.stringify(res.json.mock.calls[0][0]);
    expect(message).not.toContain('private@example.test');
    expect(message).not.toContain('secret');
  });

  it('fails closed on plugin-activation storage errors', async () => {
    isPluginActivated.mockRejectedValue(new Error('database offline'));
    const res = await send();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(listAttentionItems).not.toHaveBeenCalled();
  });
});
