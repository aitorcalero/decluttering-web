import { describe, expect, it } from 'vitest';
import { homeRoute, parseRoute } from './router';

describe('parseRoute', () => {
  it('maps hashes to routes', () => {
    expect(parseRoute('#/demo')).toBe('demo');
    expect(parseRoute('#/app')).toBe('app');
    expect(parseRoute('#/review')).toBe('review');
    expect(parseRoute('#/error')).toBe('error');
    expect(parseRoute('#/demo/')).toBe('demo');
    expect(parseRoute('#/emails')).toBe('emails');
    expect(parseRoute('#/demo/emails')).toBe('demo-emails');
    expect(parseRoute('#/about')).toBe('about');
    expect(parseRoute('#/about/')).toBe('about');
  });
  it('falls back to landing', () => {
    expect(parseRoute('')).toBe('landing');
    expect(parseRoute('#/')).toBe('landing');
    expect(parseRoute('#/nope')).toBe('landing');
  });
});

describe('homeRoute (DC-098)', () => {
  it('the demo goes to its start', () => {
    expect(homeRoute('demo', false)).toBe('demo');
    expect(homeRoute('demo-emails', false)).toBe('demo');
  });
  it('signed in goes to the scan screen, from anywhere', () => {
    for (const r of ['app', 'review', 'emails', 'about', 'landing', 'error'] as const) expect(homeRoute(r, true)).toBe('app');
  });
  it('signed out goes to the landing page', () => {
    for (const r of ['app', 'review', 'emails', 'about', 'landing', 'error'] as const) expect(homeRoute(r, false)).toBe('landing');
  });
});
