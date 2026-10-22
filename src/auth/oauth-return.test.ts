import { describe, expect, it } from 'vitest';
import { isOAuthReturn } from './session';

// DC-088: decides, before the first paint, whether to show "Signing you in…" instead of the landing page.
describe('isOAuthReturn', () => {
  it('is true for the redirect back with a code or an OAuth error', () => {
    expect(isOAuthReturn('?code=abc&state=%7B%7D')).toBe(true);
    expect(isOAuthReturn('?error=access_denied&error_description=nope')).toBe(true);
  });

  it('is false for a plain visit', () => {
    for (const s of ['', '?', '?data=live', '?codes=1']) expect(isOAuthReturn(s), s).toBe(false);
  });
});
