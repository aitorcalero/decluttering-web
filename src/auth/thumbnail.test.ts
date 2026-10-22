import { describe, expect, it, vi } from 'vitest';
import { fetchUserThumbnail, userThumbnailUrl } from './session';

// DC-098: the profile picture is fetched with the token in a header, never in a URL, and shown from a blob: URL.
const TOKEN = 'not-a-real-token';
const manager = { getToken: vi.fn(async () => TOKEN) };
const PORTAL = 'https://example.maps.arcgis.com';

function image(type = 'image/png', status = 200) {
  return new Response(new Blob([new Uint8Array([137, 80, 78, 71])], { type }), { status, headers: { 'content-type': type } });
}

describe('userThumbnailUrl', () => {
  it('builds the community info path and encodes each part', () => {
    expect(userThumbnailUrl(`${PORTAL}/`, 'a b@x', 'my pic.png')).toBe(`${PORTAL}/sharing/rest/community/users/a%20b%40x/info/my%20pic.png`);
    expect(userThumbnailUrl(PORTAL, 'u', 'thumbnail/x.jpg')).toBe(`${PORTAL}/sharing/rest/community/users/u/info/thumbnail/x.jpg`);
  });
});

describe('fetchUserThumbnail', () => {
  it('sends the token only in the X-Esri-Authorization header and returns a blob: URL', async () => {
    const fetchFn = vi.fn(async () => image());
    const createUrl = vi.fn(() => 'blob:http://localhost/abc');
    const out = await fetchUserThumbnail(manager, { username: 'test.admin', thumbnail: 'me.png' }, { portal: PORTAL, fetchFn, createUrl });
    expect(out).toBe('blob:http://localhost/abc');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${PORTAL}/sharing/rest/community/users/test.admin/info/me.png`);
    expect(url).not.toContain(TOKEN);
    expect(url).not.toMatch(/token=/i);
    expect((init.headers as Record<string, string>)['X-Esri-Authorization']).toBe(`Bearer ${TOKEN}`);
    expect(init.referrerPolicy).toBe('no-referrer');
    expect(init.credentials).toBe('omit');
    expect(createUrl).toHaveBeenCalledWith(expect.any(Blob));
  });

  it('returns null without a thumbnail, without calling the network', async () => {
    const fetchFn = vi.fn(async () => image());
    expect(await fetchUserThumbnail(manager, { username: 'u' }, { portal: PORTAL, fetchFn })).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('returns null on an error status, a JSON error answered with 200, or a network failure', async () => {
    const createUrl = vi.fn(() => 'blob:x');
    const user = { username: 'u', thumbnail: 't.png' };
    expect(await fetchUserThumbnail(manager, user, { portal: PORTAL, createUrl, fetchFn: async () => image('image/png', 404) })).toBeNull();
    expect(await fetchUserThumbnail(manager, user, { portal: PORTAL, createUrl, fetchFn: async () => new Response('{"error":{"code":498}}', { headers: { 'content-type': 'application/json' } }) })).toBeNull();
    expect(await fetchUserThumbnail(manager, user, { portal: PORTAL, createUrl, fetchFn: async () => { throw new TypeError('offline'); } })).toBeNull();
    expect(createUrl).not.toHaveBeenCalled();
  });
});
