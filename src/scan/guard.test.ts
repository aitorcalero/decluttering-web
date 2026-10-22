import { describe, expect, it, vi } from 'vitest';
import { BlockedRequest, assertAllowed, guardRequest, isServiceUrl } from './guard';

const ID = '0123456789abcdef0123456789abcdef';
const ORG = 'AbCdEfGh12345678';

describe('assertAllowed', () => {
  it('allows the read endpoints', () => {
    const ok: [string, string][] = [
      ['portals/self', 'GET'], ['portals/self/users', 'GET'], [`portals/${ORG}/users`, 'GET'],
      ['portals/self/usage', 'POST'], [`portals/${ORG}/usage`, 'POST'], ['search', 'GET'],
      [`content/items/${ID}`, 'GET'], [`content/items/${ID}/data`, 'GET'], [`content/items/${ID}/relatedItems`, 'GET'],
      ['community/self', 'GET'],
    ];
    for (const [p, m] of ok) expect(assertAllowed(p, m), `${m} ${p}`).toBe(true);
  });

  it('rejects write endpoints with either method', () => {
    const writes = [
      'community/createGroup', `community/groups/${ID}/addUsers`, `community/groups/${ID}/removeUsers`,
      `community/groups/${ID}/createNotification`, `community/groups/${ID}/delete`,
      'content/users/someone/addItem', `content/users/someone/items/${ID}/update`,
      `content/users/someone/items/${ID}/delete`, `content/users/someone/items/${ID}/share`,
      `content/users/someone/items/${ID}/unshare`, `content/items/${ID}/update`, `content/items/${ID}/delete`,
      `content/items/${ID}/share`, `content/items/${ID}/unshare`, `content/items/${ID}/addRelationship`,
      'content/users/someone/createService', 'portals/self/invite', 'portals/self/update',
      `content/items/${ID}/dependencies`, 'generateToken', 'oauth2/signin', 'oauth2/revoke', '', 'unknown',
    ];
    for (const p of writes) for (const m of ['GET', 'POST'])
      expect(() => assertAllowed(p, m), `${m} ${p}`).toThrow(BlockedRequest);
  });

  it('DC-071a: allows exactly an owner\'s content listing (root and a folder by id), GET only', () => {
    for (const p of ['content/users/jo_smith', 'content/users/jo.smith@example', `content/users/jo-smith/${ID}`]) {
      expect(assertAllowed(p, 'GET'), p).toBe(true);
      expect(() => assertAllowed(p, 'POST'), `POST ${p}`).toThrow(BlockedRequest);
    }
    const no = [
      'content/users', 'content/users/', 'content/users/jo/', `content/users/jo/${ID}/`, `content/users/jo/${ID.slice(1)}`, `content/users/jo/${ID}x`,
      `content/users/jo/${ID.toUpperCase()}`, 'content/users/jo/folder', `content/users/jo/${ID}/${ID}`, `content/users/jo/items/${ID}`,
      'content/users/jo/addItem', 'content/users/jo/createService', 'content/users/jo/createFolder', `content/users/jo/${ID}/addItem`,
      `content/users/jo/${ID}/delete`, `content/users/jo/items/${ID}/delete`, 'content/users/jo/deleteItems', 'content/users/jo/moveItems',
      'content/users/jo/shareItems', 'content/users/..', 'content/users/.', `content/users/../${ID}`, 'content/users/jo%2faddItem',
      'content/users/jo smith', 'content/users/jo?f=json', 'content/users/jo#x', 'content/users/jo/../addItem',
      'xcontent/users/jo', 'content/usersx/jo', 'content/users/jo/FeatureServer',
    ];
    for (const p of no) for (const m of ['GET', 'POST']) expect(() => assertAllowed(p, m), `${m} ${p}`).toThrow(BlockedRequest);
  });

  it('enforces the method per endpoint', () => {
    expect(() => assertAllowed('search', 'POST')).toThrow(BlockedRequest);
    expect(() => assertAllowed('portals/self/usage', 'GET')).toThrow(BlockedRequest);
    expect(() => assertAllowed(`content/items/${ID}`, 'DELETE')).toThrow(BlockedRequest);
  });

  it('rejects smuggled paths', () => {
    for (const p of ['search?x=1', 'search#a', '../search', 'a/../search', '/search', 'search/', `content/items/${ID}%2fupdate`,
      'content\\items', ' search', 'portals//self', `content/items/${ID}/data/../update`])
      expect(() => assertAllowed(p, 'GET'), p).toThrow(BlockedRequest);
  });
});

describe('isServiceUrl', () => {
  it('flags services hosts and service paths', () => {
    expect(isServiceUrl('https://services1.arcgis.com/abc/arcgis/rest/services/Foo/FeatureServer/0/query')).toBe(true);
    expect(isServiceUrl('https://tiles.arcgis.com/tiles/abc/arcgis/rest/services/T/MapServer')).toBe(true);
    expect(isServiceUrl('https://www.arcgis.com/sharing/rest/search/FeatureServer')).toBe(true);
    expect(isServiceUrl('https://gis.example.com/arcgis/rest/services/X')).toBe(true);
    expect(isServiceUrl('not a url/FeatureServer/0')).toBe(true);
  });
  it('lets plain portal urls through', () => {
    expect(isServiceUrl('https://www.arcgis.com/sharing/rest/search')).toBe(false);
  });
});

describe('guardRequest', () => {
  it('passes allowed calls through', async () => {
    const inner = vi.fn().mockResolvedValue({ ok: 1 });
    const g = guardRequest(inner);
    await expect(g('search', { q: 'x' })).resolves.toEqual({ ok: 1 });
    expect(inner).toHaveBeenCalledOnce();
  });
  it('blocks writes before the inner request is reached', async () => {
    const inner = vi.fn();
    const g = guardRequest(inner);
    await expect(g(`content/items/${ID}/delete`, {}, { method: 'POST' })).rejects.toBeInstanceOf(BlockedRequest);
    await expect(g('community/createGroup', {}, { method: 'POST' })).rejects.toBeInstanceOf(BlockedRequest);
    expect(inner).not.toHaveBeenCalled();
  });
  it('blocks service urls and absolute urls', async () => {
    const inner = vi.fn();
    const g = guardRequest(inner);
    await expect(g('https://services1.arcgis.com/abc/arcgis/rest/services/Foo/FeatureServer/0/query')).rejects.toBeInstanceOf(BlockedRequest);
    await expect(g('https://www.arcgis.com/sharing/rest/search')).rejects.toBeInstanceOf(BlockedRequest);
    await expect(g('services/Foo/FeatureServer/0/applyEdits', {}, { method: 'POST' })).rejects.toBeInstanceOf(BlockedRequest);
    expect(inner).not.toHaveBeenCalled();
  });
  it('defaults the method per endpoint: usage is POST, others GET', async () => {
    const inner = vi.fn().mockResolvedValue({});
    const g = guardRequest(inner);
    await g('portals/self/usage', {});
    await g('search', {});
    expect(inner.mock.calls[0][2]).toMatchObject({ method: 'POST' });
    expect(inner.mock.calls[1][2]).toMatchObject({ method: 'GET' });
  });
});

// DC-057: the scan makes no data requests to layers, so running it can never add a "day used". Do not loosen the guard.
describe('no data requests to layers (DC-057)', () => {
  const HOSTS = ['https://www.arcgis.com', 'https://myorg.maps.arcgis.com', 'https://services.arcgis.com', 'https://services1.arcgis.com',
    'https://services9.arcgis.com', 'https://services-ap1.arcgis.com', 'https://tiles.arcgis.com', 'https://features.arcgis.com'];
  const KINDS = ['FeatureServer', 'FeatureServer/0', 'FeatureServer/0/query?where=1%3D1', 'MapServer', 'MapServer/export', 'ImageServer',
    'VectorTileServer', 'VectorTileServer/tile/3/4/5'];

  it('blocks FeatureServer, MapServer, ImageServer and VectorTileServer urls on arcgis.com and hosted service hosts', () => {
    for (const h of HOSTS) for (const k of KINDS) {
      const url = `${h}/AbCdEfGh12345678/arcgis/rest/services/Roads/${k}`;
      expect(isServiceUrl(url), url).toBe(true);
      expect(() => assertAllowed(url, 'GET'), url).toThrow(BlockedRequest);
      expect(() => assertAllowed(url, 'POST'), url).toThrow(BlockedRequest);
    }
  });

  it('blocks /rest/services/ urls and relative service paths', () => {
    for (const url of ['https://www.arcgis.com/rest/services/', 'https://myorg.maps.arcgis.com/rest/services', 'https://services.arcgis.com/rest/services/',
      'rest/services/Roads/FeatureServer/0', '/rest/services/', 'services/Roads/MapServer']) {
      expect(isServiceUrl(url), url).toBe(true);
      expect(() => assertAllowed(url, 'GET'), url).toThrow(BlockedRequest);
    }
  });

  it('never reaches the network for a service url through guardRequest', async () => {
    const inner = vi.fn(async () => ({}));
    const guarded = guardRequest(inner as never);
    for (const h of HOSTS) for (const k of ['FeatureServer/0/query', 'MapServer', 'ImageServer', 'VectorTileServer'])
      await expect(guarded(`${h}/x/arcgis/rest/services/Roads/${k}`, {}, {})).rejects.toThrow(BlockedRequest);
    expect(inner).not.toHaveBeenCalled();
  });
});
