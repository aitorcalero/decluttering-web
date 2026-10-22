import { describe, expect, it } from 'vitest';
import { beaconPlugins, cfBeacon, contentSecurityPolicy } from './vite.config';

describe('Content Security Policy', () => {
  const dir = (csp: string, name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';
  it('allows scripts from this site only (plus the beacon), never inline or eval', () => {
    const s = dir(contentSecurityPolicy(), 'script-src');
    expect(s).toBe("script-src 'self' https://static.cloudflareinsights.com");
    expect(contentSecurityPolicy()).toContain("object-src 'none'");
  });
  it('sends data only to ArcGIS Online, or an https Enterprise portal when set', () => {
    expect(dir(contentSecurityPolicy(), 'connect-src')).toBe("connect-src 'self' https://*.arcgis.com https://cloudflareinsights.com");
    expect(dir(contentSecurityPolicy('https://gis.example.org/portal'), 'connect-src')).toContain('https://gis.example.org');
    expect(contentSecurityPolicy('http://plain.example.org')).not.toContain('plain.example.org');
    expect(contentSecurityPolicy('not a url; script-src *')).not.toContain('script-src *');
  });
});

type Hook = () => { attrs: Record<string, unknown> }[] | undefined;
const tagsOf = (token: string | undefined) => ((cfBeacon(token).transformIndexHtml as unknown) as Hook)();

describe('Cloudflare beacon plugin', () => {
  it('adds nothing without a token', () => {
    expect(beaconPlugins('production', {})).toEqual([]);
    expect(beaconPlugins('production', { VITE_CF_BEACON_TOKEN: '  ' })).toEqual([]);
    expect(tagsOf(undefined)).toBeUndefined();
  });
  it('adds nothing outside a production build, even with a token', () => {
    expect(beaconPlugins('development', { VITE_CF_BEACON_TOKEN: 'abc123' })).toEqual([]);
    expect(beaconPlugins('test', { VITE_CF_BEACON_TOKEN: 'abc123' })).toEqual([]);
  });
  it('injects one script in a production build with a token', () => {
    expect(beaconPlugins('production', { VITE_CF_BEACON_TOKEN: 'abc123' })).toHaveLength(1);
    const tags = tagsOf('abc123');
    expect(tags).toHaveLength(1);
    expect(tags![0].attrs['data-cf-beacon']).toBe('{"token":"abc123"}');
  });
  it('refuses a token that is not plain alphanumeric', () => {
    expect(tagsOf('a"><script>')).toBeUndefined();
  });
});
