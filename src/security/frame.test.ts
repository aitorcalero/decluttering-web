import { describe, expect, it } from 'vitest';
import { isFramed } from './frame';

describe('clickjacking: the app does not start inside a frame', () => {
  it('own tab: not framed', () => {
    const w = {} as Window; Object.assign(w, { self: w, top: w });
    expect(isFramed(w)).toBe(false);
  });
  it('inside a frame, or a top window it may not read: framed', () => {
    expect(isFramed({ self: {} as Window, top: {} as Window })).toBe(true);
    const locked = { self: {} as Window, get top(): Window { throw new Error('cross-origin'); } };
    expect(isFramed(locked)).toBe(true);
  });
});
