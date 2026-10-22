import { describe, expect, it, vi } from 'vitest';
import { MAX_CONCURRENT, OwnerThumbs, ownerContentUrl, thumbFile } from './owner-thumbs';

// DC-115: owners' pictures load lazily, 4 at a time, once per username, with the token only in a header (fetchUserThumbnail).
const manager = { getToken: vi.fn(async () => 'not-a-real-token') };
const PORTAL = 'https://www.arcgis.com';

/** A fetcher whose calls stay pending until released, so concurrency can be seen. */
function gated() {
  const waits: Array<(url: string | null) => void> = [];
  const calls: Array<{ username: string; thumbnail?: string }> = [];
  const fetchThumb = vi.fn((_m: unknown, u: { username: string; thumbnail?: string }) => {
    calls.push(u);
    return new Promise<string | null>((res) => { waits.push(res); });
  });
  return { fetchThumb: fetchThumb as never, waits, calls };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('thumbFile', () => {
  it('takes a bare file name, or the file out of the URL the scan stores', () => {
    expect(thumbFile('ann', 'thumb.png')).toBe('thumb.png');
    expect(thumbFile('ann', `${PORTAL}/sharing/rest/community/users/ann/info/thumb.png`)).toBe('thumb.png');
    expect(thumbFile('ann', 'thumbnail/ago_1.png')).toBe('thumbnail/ago_1.png');
  });
  it('drops anything that is not a plain file name', () => {
    for (const bad of ['../x.png', 'a/../b.png', '/etc/x', 'x.png?token=1', 'x#y', 'javascript:alert(1)', 'http://a/community/users/ann/info/x.png',
      `${PORTAL}/sharing/rest/community/users/bob/info/x.png`, 'a b.png', '', null, undefined]) expect(thumbFile('ann', bad as string)).toBeNull();
  });
});

describe('OwnerThumbs', () => {
  it('loads nothing until a card asks (only visible cards load)', async () => {
    const g = gated();
    new OwnerThumbs({ getManager: () => manager, fetchThumb: g.fetchThumb });
    await tick();
    expect(g.calls).toHaveLength(0);
  });

  it('runs at most 4 at once and starts the next as one finishes', async () => {
    const g = gated();
    const t = new OwnerThumbs({ getManager: () => manager, fetchThumb: g.fetchThumb });
    for (let i = 0; i < 7; i++) t.request(`u${i}`, 'p.png');
    expect(MAX_CONCURRENT).toBe(4);
    expect(g.calls).toHaveLength(4);
    g.waits[0]!('blob:0'); await tick();
    expect(g.calls).toHaveLength(5);
    expect(t.get('u0')).toBe('blob:0');
  });

  it('asks once per username, even after it failed', async () => {
    const g = gated();
    const t = new OwnerThumbs({ getManager: () => manager, fetchThumb: g.fetchThumb });
    t.request('ann', 'p.png'); t.request('ann', 'p.png');
    g.waits[0]!(null); await tick();
    t.request('ann', 'p.png');
    expect(g.calls).toHaveLength(1);
    expect(t.get('ann')).toBeUndefined();
  });

  it('puts no token in the URL: the fetch gets only a user and a file name', async () => {
    const g = gated();
    const t = new OwnerThumbs({ getManager: () => manager, fetchThumb: g.fetchThumb });
    t.request('ann', `${PORTAL}/sharing/rest/community/users/ann/info/p.png?token=abc`);
    expect(g.calls).toHaveLength(0);
    t.request('ann', `${PORTAL}/sharing/rest/community/users/ann/info/p.png`);
    expect(g.calls).toEqual([{ username: 'ann', thumbnail: 'p.png' }]);
  });

  it('fetches through fetchUserThumbnail with the token in a header, not the URL', async () => {
    const seen: Array<[string, RequestInit]> = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (u: string, init: RequestInit) => {
      seen.push([u, init]);
      return new Response(new Blob([new Uint8Array([1])], { type: 'image/png' }), { headers: { 'content-type': 'image/png' } });
    }) as never;
    const create = URL.createObjectURL;
    URL.createObjectURL = () => 'blob:http://x/1';
    try {
      const t = new OwnerThumbs({ getManager: () => manager });
      t.request('ann', 'p.png');
      await tick(); await tick();
      expect(seen).toHaveLength(1);
      expect(seen[0]![0]).not.toContain('not-a-real-token');
      expect((seen[0]![1].headers as Record<string, string>)['X-Esri-Authorization']).toBe('Bearer not-a-real-token');
      expect(t.get('ann')).toBe('blob:http://x/1');
    } finally { globalThis.fetch = orig; URL.createObjectURL = create; }
  });

  it('revokes every URL on dispose, and one that arrives late', async () => {
    const g = gated(); const revoke = vi.fn();
    const t = new OwnerThumbs({ getManager: () => manager, fetchThumb: g.fetchThumb, revoke });
    t.request('a', 'p.png'); t.request('b', 'p.png');
    g.waits[0]!('blob:a'); await tick();
    t.dispose();
    expect(revoke).toHaveBeenCalledWith('blob:a');
    g.waits[1]!('blob:b'); await tick();
    expect(revoke).toHaveBeenCalledWith('blob:b');
    expect(t.get('a')).toBeUndefined();
    t.request('c', 'p.png');
    expect(g.calls).toHaveLength(2);
  });

  it('loads nothing in the demo (disabled) or without a session', async () => {
    const g = gated();
    const off = new OwnerThumbs({ getManager: () => manager, enabled: () => false, fetchThumb: g.fetchThumb });
    off.request('ann', 'p.png');
    const none = new OwnerThumbs({ getManager: () => null, fetchThumb: g.fetchThumb });
    none.request('ann', 'p.png'); await tick();
    expect(g.calls).toHaveLength(0);
  });
});

describe('ownerContentUrl', () => {
  it('uses the org urlKey on the standard host', () => {
    expect(ownerContentUrl({ urlKey: 'acme' }, 'ann.lee')).toBe('https://acme.maps.arcgis.com/home/user.html?user=ann.lee');
  });
  it('uses the org custom base URL when there is one, and encodes the username', () => {
    expect(ownerContentUrl({ urlKey: 'acme', customBaseUrl: 'maps.example.com' }, 'a b@c')).toBe('https://acme.maps.example.com/home/user.html?user=a%20b%40c');
    expect(ownerContentUrl({ urlKey: 'acme', customBaseUrl: 'https://maps.example.com/' }, 'x')).toBe('https://acme.maps.example.com/home/user.html?user=x');
  });
  it('gives no link without a urlKey, or with an odd one', () => {
    expect(ownerContentUrl({ urlKey: '' }, 'ann')).toBeNull();
    expect(ownerContentUrl({}, 'ann')).toBeNull();
    expect(ownerContentUrl({ urlKey: 'a/b' }, 'ann')).toBeNull();
  });
});
