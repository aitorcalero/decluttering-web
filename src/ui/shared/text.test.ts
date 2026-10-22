import { describe, expect, it } from 'vitest';
import { agoText } from './text';

describe('agoText', () => {
  it('reads naturally from today to months', () => {
    expect(agoText(0)).toBe('today');
    expect(agoText(null)).toBe('today');
    expect(agoText(1)).toBe('yesterday');
    expect(agoText(4)).toBe('4 days ago');
    expect(agoText(7)).toBe('1 week ago');
    expect(agoText(30)).toBe('4 weeks ago');
    expect(agoText(70)).toBe('2 months ago');
  });
});
