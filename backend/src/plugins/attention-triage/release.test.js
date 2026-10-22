import { describe, expect, it } from 'vitest';
import { attentionAutomationReleased } from './release.js';

describe('Attention Triage development release fuse', () => {
  it('stays off even when a runtime environment variable suggests activation', () => {
    expect(attentionAutomationReleased()).toBe(false);
  });
});
