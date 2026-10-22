import { describe, expect, it } from 'vitest';
import { TURN_ON_HEADING, TURN_ON_NEXT, TURN_ON_NO, TURN_ON_POINTS, TURN_ON_YES } from './turn-on-copy';

describe('Turn on sending copy', () => {
  it('is the agreed, reassuring wording', () => {
    expect(TURN_ON_HEADING).toBe('Turn on sending for you?');
    expect(TURN_ON_POINTS).toEqual([
      'You’re in control. Nothing is sent until you choose.',
      'We’ll set up one small hidden group in your org that only you can see.',
      'Each owner gets one friendly email, at most once every six months.',
      'You can switch it off any time.',
    ]);
    expect([TURN_ON_YES, TURN_ON_NO]).toEqual(['Turn on sending', 'Not now']);
    expect(TURN_ON_NEXT).toBe('Send yourself a test first. It goes only to you, so you can see exactly what owners will get.');
  });
  it('is not alarming', () => {
    expect([TURN_ON_HEADING, ...TURN_ON_POINTS, TURN_ON_NEXT].join(' ')).not.toMatch(/warning|danger|irreversible|!|\bwill be sent\b/i);
  });
});
