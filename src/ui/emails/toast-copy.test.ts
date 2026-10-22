import { describe, expect, it } from 'vitest';
import { testToast } from './toast-copy';

describe('the test-send toast (DC-121)', () => {
  it('names the address the test went to, and says nobody else got it', () => {
    const t = testToast('you@example.org', 'Sam');
    expect(t.title).toBe('Test accepted by ArcGIS Online');
    expect(t.message).toBe('Sent to you@example.org (your profile email). It usually arrives within a minute. Nothing there? Check Junk, then wait a few minutes before sending again. Nobody else got it.');
  });
  it('trims the address', () => {
    expect(testToast('  you@example.org ', 'Sam').message).toContain('Sent to you@example.org (your');
  });
  it('falls back to the old wording when the address is unknown', () => {
    for (const a of [undefined, '', '   ']) {
      const t = testToast(a, 'Sam');
      expect(t.title).toBe('Test sent to you');
      expect(t.message).toBe("A copy of Sam's digest is on its way to you. Nobody else got it.");
    }
  });
});
