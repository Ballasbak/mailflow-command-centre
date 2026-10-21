import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api.js', () => ({
  requireAuth: (req, res, next) => next(),
  isPluginActivated: vi.fn(),
  listAttentionItems: vi.fn(),
  acknowledgeAttentionItem: vi.fn(),
  isUuid: (value) => typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
}));

import router from './routes.js';
import { isPluginActivated, listAttentionItems, acknowledgeAttentionItem } from '../api.js';

const USER = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '22222222-2222-4222-8222-222222222222';

function handler(method = 'get', path = '/items') {
  const layer = router.stack.find(item => item.route?.path === path);
  return layer?.route?.stack?.find(item => item.method === method)?.handle;
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

async function patchSend({ id = '33333333-3333-4333-8333-333333333333', status = 'EXPECTED' } = {},
  session = { userId: USER }) {
  const req = { session, params: { id }, body: { status } };
  const res = {
    set: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  await handler('patch', '/items/:id/status')(req, res);
  return res;
}

describe('GET /api/attention/items', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    isPluginActivated.mockResolvedValue(true);
    listAttentionItems.mockResolvedValue({ items: [], hasMore: false });
    acknowledgeAttentionItem.mockResolvedValue(true);
  });

  it('registers only a read endpoint and one controlled owner-acknowledgement endpoint', () => {
    expect(handler()).toBeTypeOf('function');
    const methods = router.stack.filter(x => x.route).map(x => Object.keys(x.route.methods));
    expect(methods).toEqual([['get'], ['patch']]);
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


describe('PATCH /api/attention/items/:id/status', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    isPluginActivated.mockResolvedValue(true);
    acknowledgeAttentionItem.mockResolvedValue(true);
  });

  it('allows a logged-in owner to mark a message as EXPECTED', async () => {
    const res = await patchSend();
    expect(isPluginActivated).toHaveBeenCalledWith(USER, 'attention-triage');
    expect(acknowledgeAttentionItem).toHaveBeenCalledWith({
      userId: USER, messageId: '33333333-3333-4333-8333-333333333333',
      status: 'EXPECTED',
    });
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(res.json).toHaveBeenCalledWith({
      ok: true, id: '33333333-3333-4333-8333-333333333333', ownerStatus: 'EXPECTED',
    });
  });

  it('accepts RESOLVED and OPEN (undo) as deliberate owner actions', async () => {
    for (const status of ['RESOLVED', 'OPEN']) {
      const res = await patchSend({ status });
      expect(res.json.mock.calls[0][0].ownerStatus).toBe(status);
    }
    expect(acknowledgeAttentionItem).toHaveBeenCalledTimes(2);
  });

  it('refuses malformed message IDs and statuses before any database action', async () => {
    for (const values of [
      { id: 'invalid' }, { id: '11111111-1111-4111-111111111111' },
      { status: 'DELETE' }, { status: 'RETRY' }, { status: null }, { status: ['EXPECTED'] },
    ]) {
      const res = await patchSend(values);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(isPluginActivated).not.toHaveBeenCalled();
    expect(acknowledgeAttentionItem).not.toHaveBeenCalled();
  });

  it('denies owners who have not activated the plugin', async () => {
    isPluginActivated.mockResolvedValue(false);
    const res = await patchSend();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(acknowledgeAttentionItem).not.toHaveBeenCalled();
  });

  it('does not distinguish missing, deleted, non-actionable or other-owner messages', async () => {
    acknowledgeAttentionItem.mockResolvedValue(false);
    const res = await patchSend();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Attention item not found' });
  });

  it('fails closed with no private details when storage is unavailable', async () => {
    acknowledgeAttentionItem.mockRejectedValue(new Error('private email body: secret'));
    const res = await patchSend();
    expect(res.status).toHaveBeenCalledWith(503);
    const body = JSON.stringify(res.json.mock.calls[0][0]);
    expect(body).not.toContain('private email body');
    expect(body).not.toContain('secret');
  });
});
