import { describe, expect, it } from 'vitest';
import { validActivationBaseline } from './baseline.js';

const now = new Date('2026-10-21T05:00:00.000Z');

describe('Attention Triage activation baseline', () => {
  it('accepts a canonical UTC activation timestamp in the past', () => {
    expect(validActivationBaseline('2026-10-20T10:00:00.000Z', now)).toBe(true);
  });
  it('rejects missing, malformed, noncanonical or future timestamps', () => {
    for (const candidate of [undefined, null, '', '2026-10-20', '2026-10-20T10:00:00Z',
      '2026-10-20T11:00:00+01:00', '2026-10-22T10:00:00.000Z', {},
    ]) {
      expect(validActivationBaseline(candidate, now)).toBe(false);
    }
  });
});
