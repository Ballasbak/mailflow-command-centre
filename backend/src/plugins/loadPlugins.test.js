import { describe, it, expect, vi } from 'vitest';

// gtd/index.js imports routes/gtd.js, which imports index.js (which starts the server).
// Mock the router module so this test only exercises registration, not the whole app.
vi.mock('../routes/gtd.js', () => ({ default: function gtdRouter() {} }));

import { createPluginRegistry } from './registry.js';
import { loadBundledPlugins } from './loadPlugins.js';

describe('loadBundledPlugins', () => {
  it('registers the GTD plugin as Tier-1 mounted at /api/gtd', () => {
    const r = createPluginRegistry();
    loadBundledPlugins(r);
    const gtd = r.get('gtd');
    expect(gtd).toBeTruthy();
    expect(gtd.tier).toBe(1);
    expect(gtd.router.base).toBe('/api/gtd');
    expect(typeof gtd.router.handler).toBe('function');
  });

  it('registers the default-off Attention Triage hook and background worker', () => {
    const r = createPluginRegistry();
    loadBundledPlugins(r);
    const plugin = r.get('attention-triage');
    expect(plugin?.tier).toBe(1);
    expect(plugin?.version).toBe('0.6.0');
    expect(plugin?.router?.base).toBe('/api/attention');
    expect(typeof plugin?.router?.handler).toBe('function');
    expect(typeof plugin?.hooks?.inboxIngest?.handler).toBe('function');
    expect(typeof plugin?.hooks?.inboxIngest?.isActive).toBe('function');
    expect(plugin?.sync?.intervalMs).toBe(60000);
    expect(typeof plugin?.sync?.isActive).toBe('function');
    expect(typeof plugin?.sync?.tick).toBe('function');
  });
});
