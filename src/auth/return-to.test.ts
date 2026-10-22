import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSafeReturnPath } from './session';

describe('isSafeReturnPath', () => {
  beforeEach(() => { vi.stubGlobal('window', { location: { origin: 'http://localhost:5173' } }); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('accepts same-origin relative paths', () => {
    expect(isSafeReturnPath('/prototypes/d-converged/?data=live')).toBe(true);
    expect(isSafeReturnPath('/#/review')).toBe(true);
  });

  it('rejects anything that could leave the origin', () => {
    for (const p of ['//evil.example/x', 'https://evil.example/', 'javascript:alert(1)', '/\\evil.example', 'prototypes/x', '', '/a\nb', '/a\u007fb']) {
      expect(isSafeReturnPath(p), p).toBe(false);
    }
  });

  it('rejects non-strings', () => {
    expect(isSafeReturnPath(null)).toBe(false);
    expect(isSafeReturnPath(42)).toBe(false);
  });
});
