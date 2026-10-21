import { describe, expect, it } from 'vitest';
import { isUuid, isPluginId } from './pluginMessageIdentifiers.js';

describe('shared plugin message identifier validation', () => {
  it('accepts complete standard UUIDs with five sections (8-4-4-4-12)', () => {
    for (const value of [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
    ]) {
      expect(isUuid(value)).toBe(true);
    }
  });

  it('rejects shortened UUIDs missing the fourth segment', () => {
    expect(isUuid('11111111-1111-4111-111111111111')).toBe(false);
  });

  it('rejects malformed, injected and non-string UUID inputs', () => {
    for (const value of [
      '', null, undefined, 1, {}, '11',
      '{11111111-1111-4111-8111-111111111111}',
      '11111111-1111-4111-8111-111111111111 OR TRUE',
      '11111111-1111-4111-8111-11111111111g',
    ]) {
      expect(isUuid(value)).toBe(false);
    }
  });

  it('accepts intended plugin names and rejects invalid ones', () => {
    expect(isPluginId('attention-triage')).toBe(true);
    expect(isPluginId('a')).toBe(true);
    for (const value of ['', null, undefined, 'Attention Triage', 'bad_name', '-bad', 'bad-']) {
      expect(isPluginId(value)).toBe(false);
    }
  });
});
