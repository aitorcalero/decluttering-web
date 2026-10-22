import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { assertNotifyAllowed, guardNotifyRequest, BlockedRequest, GROUP_TITLE, NOTIFY_ALLOW } from './guard';
import { createGroupNotifier, WritesDisabled, htmlToText, CREATE_GROUP_PRIVILEGE, MAX_USERS_PER_CALL, GROUP_SNIPPET, GROUP_TAGS } from './notifier';
import { createThumbnailLoader, MAX_THUMB_BYTES, SEND_THUMBNAILS } from './thumbnail';
import { createSessionNotifier } from './session';
import type { RequestFn } from '../scan/types';

const ME = 'admin_me';
const GID = 'a'.repeat(32);
const OTHER_GID = 'b'.repeat(32);
const ORG = 'DevOrg0123456789';
/** A writable org for these tests (DC-058: the notifier refuses to exist otherwise). */
const W = { orgId: ORG, writableOrgIds: [ORG] };

interface Call { path: string; method: string; params: Record<string, string | number | Blob> }
const png = (bytes = 100, type = 'image/png') => new File([new Uint8Array(bytes)], 'thumbnail.png', { type });
const createParams = (over: Record<string, unknown> = {}) => ({
  title: GROUP_TITLE, access: 'private', isInvitationOnly: 'true', isViewOnly: 'true', hiddenMembers: 'true', tags: GROUP_TAGS, snippet: GROUP_SNIPPET, description: 'd', ...over,
});

/** A fake RequestFn: records every call that reaches it and answers like ArcGIS Online. */
function fakeOrg(o: {
  groups?: Array<{ id: string; title: string; owner: string }>;
  privileges?: string[];
  notAdded?: string[];
  notRemoved?: string[];
  /** Who is in the group (community/groups/{id}/users). */
  members?: string[];
  groupOwner?: string;
  failNotify?: boolean;
  orgId?: string;
} = {}) {
  const calls: Call[] = [];
  const request: RequestFn = async (path, params = {}, options = {}) => {
    calls.push({ path, method: options.method ?? 'GET', params });
    if (path === 'portals/self') return { id: o.orgId ?? ORG, user: { username: ME, privileges: o.privileges ?? [CREATE_GROUP_PRIVILEGE] } };
    if (path === 'community/groups') return { results: o.groups ?? [] };
    if (path === 'community/createGroup') return { success: true, group: { id: GID, title: params.title, owner: ME, access: params.access } };
    if (path.endsWith('/users') && path.startsWith('community/groups/')) return { owner: o.groupOwner ?? ME, admins: [], users: o.members ?? [] };
    if (path.endsWith('/addUsers')) return { notAdded: (o.notAdded ?? []).filter((u) => String(params.users).split(',').includes(u)) };
    if (path.endsWith('/removeUsers')) return { notRemoved: (o.notRemoved ?? []).filter((u) => String(params.users).split(',').includes(u)) };
    if (path.endsWith('/createNotification')) { if (o.failNotify) throw new Error('COM_1132'); return { success: true }; }
    if (path.endsWith('/delete')) return { success: true };
    throw new Error(`unexpected ${path}`);
  };
  return { calls, request, writes: () => calls.filter((c) => c.method === 'POST').map((c) => c.path.replace(/[0-9a-f]{32}/, '<g>')) };
}

describe('notify allow-list', () => {
  const ctx = { self: ME, groupId: GID };
  it.each([
    ['community/groups/' + GID + '/update', 'POST'],
    ['community/groups/' + GID + '/invite', 'POST'],
    ['community/groups/' + GID + '/reassign', 'POST'],
    ['community/users/' + ME + '/update', 'POST'],
    ['community/users/' + ME + '/delete', 'POST'],
    ['content/users/' + ME + '/createService', 'POST'],
    ['content/users/' + ME + '/items/' + GID + '/delete', 'POST'],
    ['content/items/' + GID + '/share', 'POST'],
    ['content/users/' + ME + '/unshareItems', 'POST'],
    ['portals/self/invite', 'POST'],
    ['portals/self/update', 'POST'],
    ['portals/self/usage', 'POST'],
    ['search', 'GET'],
    ['community/createGroup', 'GET'],
    ['community/groups/' + GID + '/createNotification', 'GET'],
    ['community/groups', 'POST'],
    ['https://evil.example/community/createGroup', 'POST'],
    ['community/createGroup?x=1', 'POST'],
    ['community/groups/../createGroup', 'POST'],
    ['/community/createGroup', 'POST'],
  ])('rejects %s (%s)', (path, method) => {
    expect(() => assertNotifyAllowed(path, method, ctx)).toThrow(/BLOCKED/);
  });

  it('allows exactly the listed writes, as POST, for the app group only', () => {
    expect(assertNotifyAllowed('community/createGroup', 'POST', ctx, createParams())).toBe('createGroup');
    for (const op of ['addUsers', 'removeUsers', 'createNotification', 'delete']) {
      expect(() => assertNotifyAllowed(`community/groups/${GID}/${op}`, 'POST', ctx)).not.toThrow();
      expect(() => assertNotifyAllowed(`community/groups/${OTHER_GID}/${op}`, 'POST', ctx)).toThrow(/own group/);
      expect(() => assertNotifyAllowed(`community/groups/${GID}/${op}`, 'POST', { self: ME })).toThrow(/own group/);
    }
    expect(NOTIFY_ALLOW.filter((r) => r.methods.includes('POST')).map((r) => r.op).sort())
      .toEqual(['addUsers', 'createGroup', 'createNotification', 'deleteGroup', 'removeUsers']);
  });

  it('reads only the signed-in user', () => {
    expect(assertNotifyAllowed(`community/users/${ME}`, 'GET', ctx)).toBe('user');
    expect(() => assertNotifyAllowed('community/users/someone_else', 'GET', ctx)).toThrow(/signed-in user/);
  });

  it('never reaches the network for a blocked call', async () => {
    const org = fakeOrg();
    const n = createGroupNotifier({ request: org.request, ...W });
    await expect(n.add(['owner_a'])).rejects.toThrow(/not set up/);
    await expect(n.sendTest('s', '<p>x</p>')).rejects.toThrow(/not set up/);
    expect(org.writes()).toEqual([]);
  });
});

describe('find-or-create the group', () => {
  it('reuses an existing group with the exact title owned by the admin', async () => {
    const org = fakeOrg({ groups: [
      { id: OTHER_GID, title: `${GROUP_TITLE} (old)`, owner: ME },
      { id: 'c'.repeat(32), title: GROUP_TITLE, owner: 'someone_else' },
      { id: GID, title: GROUP_TITLE, owner: ME },
    ] });
    const n = createGroupNotifier({ request: org.request, ...W });
    const g = await n.createGroup();
    expect(g).toMatchObject({ id: GID, reused: true });
    expect(org.writes()).toEqual([]);
  });

  it('creates a private, invitation-only group when none exists, once', async () => {
    const org = fakeOrg();
    const n = createGroupNotifier({ request: org.request, ...W });
    const g = await n.createGroup();
    await n.createGroup();
    expect(g).toMatchObject({ id: GID, title: GROUP_TITLE, reused: false });
    expect(org.writes()).toEqual(['community/createGroup']);
    const create = org.calls.find((c) => c.path === 'community/createGroup')!;
    expect(create.params).toMatchObject({ title: GROUP_TITLE, access: 'private', isInvitationOnly: 'true', hiddenMembers: 'true' });
    expect(String(create.params.description)).toMatch(/About > App data in your org/);
    expect(create.params).toMatchObject({ tags: 'Decluttering,decluttering-notifications', snippet: GROUP_SNIPPET });
    expect(GROUP_SNIPPET.length).toBeLessThan(250);
  });

  it('SEND_THUMBNAILS is on (DC-122), so by default the group thumbnail is loaded and sent; sendThumbnails: false turns it off', async () => {
    expect(SEND_THUMBNAILS).toBe(true);
    const org = fakeOrg();
    let loads = 0;
    const n = createGroupNotifier({ request: org.request, ...W, loadThumbnail: async () => { loads++; return png(); } });
    await n.createGroup();
    expect(loads).toBe(1);
    expect(org.calls.find((c) => c.path === 'community/createGroup')!.params.thumbnail).toBeInstanceOf(Blob);
    const off = fakeOrg();
    let offLoads = 0;
    await createGroupNotifier({ request: off.request, ...W, sendThumbnails: false, loadThumbnail: async () => { offLoads++; return png(); } }).createGroup();
    expect(offLoads).toBe(0);
    expect('thumbnail' in off.calls.find((c) => c.path === 'community/createGroup')!.params).toBe(false);
  });

  it('sends the PNG thumbnail on createGroup when switched on', async () => {
    const org = fakeOrg();
    const asked: string[] = [];
    const t = png();
    const n = createGroupNotifier({ request: org.request, ...W, sendThumbnails: true, loadThumbnail: async (k) => { asked.push(k); return t; } });
    await n.createGroup();
    expect(asked).toEqual(['group']);
    expect(org.calls.find((c) => c.path === 'community/createGroup')!.params.thumbnail).toBe(t);
    expect(org.writes()).toEqual(['community/createGroup']);
  });

  it('still creates the group when the thumbnail cannot be loaded', async () => {
    for (const loadThumbnail of [async () => null, async (): Promise<null> => { throw new Error('offline'); }]) {
      const org = fakeOrg();
      const n = createGroupNotifier({ request: org.request, ...W, sendThumbnails: true, loadThumbnail });
      await expect(n.createGroup()).resolves.toMatchObject({ id: GID });
      expect('thumbnail' in org.calls.find((c) => c.path === 'community/createGroup')!.params).toBe(false);
    }
  });

  describe('DC-122: a refused thumbnail never stops the group', () => {
    const withRefusal = (mode: 'throw' | 'notsuccess', failBoth = false) => {
      const org = fakeOrg();
      const request: RequestFn = async (path, params = {}, options = {}) => {
        if (path === 'community/createGroup' && (failBoth || 'thumbnail' in params)) {
          org.calls.push({ path, method: options.method ?? 'GET', params });
          if (mode === 'throw') throw new Error('multipart refused');
          return { success: false };
        }
        return org.request(path, params, options);
      };
      return { org, request };
    };
    const creates = (org: ReturnType<typeof fakeOrg>) => org.calls.filter((c) => c.path === 'community/createGroup');

    it.each(['throw', 'notsuccess'] as const)('retries once without the thumbnail when ArcGIS refuses it (%s)', async (mode) => {
      const { org, request } = withRefusal(mode);
      const n = createGroupNotifier({ request, ...W, sendThumbnails: true, loadThumbnail: async () => png() });
      const g = await n.createGroup();
      expect(g).toMatchObject({ id: GID, title: GROUP_TITLE, reused: false, thumbnail: false });
      const sent = creates(org);
      expect(sent).toHaveLength(2);
      expect('thumbnail' in sent[0]!.params).toBe(true);
      expect('thumbnail' in sent[1]!.params).toBe(false);
      expect(sent[1]!.params).toMatchObject({ title: GROUP_TITLE, access: 'private', isInvitationOnly: 'true' });
    });

    it('records thumbnail: true when it was accepted, and false when none was sent', async () => {
      const ok = fakeOrg();
      expect(await createGroupNotifier({ request: ok.request, ...W, sendThumbnails: true, loadThumbnail: async () => png() }).createGroup()).toMatchObject({ thumbnail: true });
      const none = fakeOrg();
      expect(await createGroupNotifier({ request: none.request, ...W, sendThumbnails: false }).createGroup()).toMatchObject({ thumbnail: false });
    });

    it('throws as before if the retry also fails, after exactly one retry', async () => {
      const { org, request } = withRefusal('throw', true);
      const n = createGroupNotifier({ request, ...W, sendThumbnails: true, loadThumbnail: async () => png() });
      await expect(n.createGroup()).rejects.toThrow(/multipart refused/);
      expect(creates(org)).toHaveLength(2);
      expect(n.group).toBeNull();
    });

    it('does not retry when no thumbnail was attached', async () => {
      const { org, request } = withRefusal('throw', true);
      const n = createGroupNotifier({ request, ...W, sendThumbnails: false });
      await expect(n.createGroup()).rejects.toThrow(/multipart refused/);
      expect(creates(org)).toHaveLength(1);
    });

    it('the retry goes through the guarded request, and a guard-blocked thumbnail is not retried', async () => {
      const org = fakeOrg();
      const n = createGroupNotifier({ request: org.request, ...W, sendThumbnails: true, loadThumbnail: async () => png(100, 'image/gif') });
      await expect(n.createGroup()).rejects.toThrow(/BLOCKED/);
      expect(creates(org)).toHaveLength(0);
      const { request } = withRefusal('throw');
      const seen: string[] = [];
      const spy: RequestFn = async (path, params = {}, options = {}) => { seen.push(path + ('thumbnail' in params ? '+thumb' : '')); return request(path, params, options); };
      await createGroupNotifier({ request: spy, ...W, sendThumbnails: true, loadThumbnail: async () => png() }).createGroup();
      expect(seen.filter((p) => p.startsWith('community/createGroup'))).toEqual(['community/createGroup+thumb', 'community/createGroup']);
    });

    it('the real group thumbnail is accepted by guardNotifyRequest', async () => {
      const file = new File([new Uint8Array(readFileSync('public/app-data/group-thumb.png'))], 'thumbnail.png', { type: 'image/png' });
      expect(file.size).toBeGreaterThan(0);
      expect(file.size).toBeLessThanOrEqual(MAX_THUMB_BYTES);
      const seen: Array<Record<string, unknown>> = [];
      const guarded = guardNotifyRequest((async (_p, params = {}) => { seen.push(params); return { success: true }; }) as RequestFn, () => ({ self: ME, groupId: null }));
      await expect(guarded('community/createGroup', createParams({ thumbnail: file }) as unknown as Record<string, string>, { method: 'POST' })).resolves.toBeTruthy();
      expect(seen[0]!.thumbnail).toBe(file);
    });
  });

  it('does not create anything in a read-only org (no notifier, no request)', () => {
    const org = fakeOrg();
    expect(() => createGroupNotifier({ request: org.request, orgId: 'OtherOrg0123456789', writableOrgIds: [ORG] })).toThrow(WritesDisabled);
    expect(org.calls).toEqual([]);
  });
});

describe('createGroup parameters (ADR 0012)', () => {
  const ctx = { self: ME, groupId: GID };
  const ok = (p: Record<string, unknown>) => assertNotifyAllowed('community/createGroup', 'POST', ctx, p);
  it('allows the labelled group, with or without a PNG thumbnail', () => {
    expect(ok(createParams())).toBe('createGroup');
    expect(ok(createParams({ thumbnail: png() }))).toBe('createGroup');
    expect(ok(createParams({ thumbnail: png(MAX_THUMB_BYTES) }))).toBe('createGroup');
  });
  it('blocks extra keys, another title, a public group and a bad thumbnail', () => {
    expect(() => ok(createParams({ sortField: 'x' }))).toThrow(/unexpected createGroup parameter/);
    expect(() => ok(createParams({ owner: 'someone' }))).toThrow(BlockedRequest);
    expect(() => ok(createParams({ title: 'Team GIS' }))).toThrow(/exact title/);
    expect(() => ok(createParams({ access: 'public' }))).toThrow(/private/);
    expect(() => ok(createParams({ access: 'org' }))).toThrow(/private/);
    for (const k of ['isInvitationOnly', 'isViewOnly', 'hiddenMembers']) {
      expect(() => ok(createParams({ [k]: 'false' })), k).toThrow(new RegExp(`${k} must be true`));
      const p: Record<string, unknown> = createParams(); delete p[k];
      expect(() => ok(p), `${k} missing`).toThrow(new RegExp(`${k} must be true`));
    }
    for (const bad of [png(100, 'image/jpeg'), png(100, ''), png(MAX_THUMB_BYTES + 1), png(0), 'iVBORw0KGgo=', { size: 1, type: 'image/png' }, null]) {
      expect(() => ok(createParams({ thumbnail: bad })), String(bad)).toThrow(/PNG of 200 KB or less/);
    }
  });
  it('is blocked for the wrong method, and a real call is checked before it reaches the request', async () => {
    expect(() => assertNotifyAllowed('community/createGroup', 'GET', ctx, createParams())).toThrow(BlockedRequest);
    const org = fakeOrg();
    const n = createGroupNotifier({ request: org.request, ...W, sendThumbnails: true, loadThumbnail: async () => png(100, 'image/gif') });
    await expect(n.createGroup()).rejects.toThrow(/BLOCKED/);
    expect(org.writes()).toEqual([]);
  });
});

describe('thumbnail loader', () => {
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3];
  const answer = (body: Uint8Array, ok = true): typeof fetch => (async () => ({ ok, arrayBuffer: async () => body.slice().buffer })) as unknown as typeof fetch;
  it('fetches the app own PNG from this origin as a PNG File', async () => {
    const urls: string[] = [];
    const f = (async (u: string) => { urls.push(u); return answer(new Uint8Array(PNG))(u); }) as unknown as typeof fetch;
    const t = await createThumbnailLoader(f, '/')('group');
    expect(urls).toEqual(['/app-data/group-thumb.png']);
    expect(t).toBeInstanceOf(File);
    expect(t).toMatchObject({ type: 'image/png', size: PNG.length, name: 'thumbnail.png' });
    expect(await createThumbnailLoader(f, '/decluttering/')('log')).not.toBeNull();
    expect(urls[1]).toBe('/decluttering/app-data/log-thumb.png');
  });
  it('gives null for a missing file, an HTML fallback page, an oversize file, a network error, or an off-site base', async () => {
    expect(await createThumbnailLoader(answer(new Uint8Array(PNG), false), '/')('group')).toBeNull();
    expect(await createThumbnailLoader(answer(new TextEncoder().encode('<!doctype html>')), '/')('group')).toBeNull();
    expect(await createThumbnailLoader(answer(new Uint8Array([...PNG, ...new Array(MAX_THUMB_BYTES).fill(0)])), '/')('log')).toBeNull();
    expect(await createThumbnailLoader((async () => { throw new Error('x'); }) as unknown as typeof fetch, '/')('log')).toBeNull();
    let called = false;
    const spy = (async () => { called = true; return { ok: true, arrayBuffer: async () => new Uint8Array(PNG).buffer }; }) as unknown as typeof fetch;
    expect(await createThumbnailLoader(spy, 'https://cdn.example/')('group')).toBeNull();
    expect(await createThumbnailLoader(spy, '//cdn.example/')('group')).toBeNull();
    expect(called).toBe(false);
  });
});

describe('sendTest', () => {
  it('sends only to the signed-in user, with no add or remove', async () => {
    const org = fakeOrg({ groups: [{ id: GID, title: GROUP_TITLE, owner: ME }] });
    const n = createGroupNotifier({ request: org.request, ...W });
    await n.createGroup();
    const r = await n.sendTest('[Test] hello', '<p>Hi <b>there</b></p>');
    expect(org.writes()).toEqual(['community/groups/<g>/createNotification']);
    const call = org.calls.find((c) => c.path.endsWith('/createNotification'))!;
    expect(call.params).toEqual({ notificationChannelType: 'email', subject: '[Test] hello', message: '<p>Hi <b>there</b></p>', users: ME });
    expect(r).toMatchObject({ to: [ME], subject: '[Test] hello', subjectLength: 12, messageLength: 22, format: 'html' });
  });

  it('has no way to name another recipient', async () => {
    const org = fakeOrg({ groups: [{ id: GID, title: GROUP_TITLE, owner: ME }] });
    const n = createGroupNotifier({ request: org.request, ...W });
    await n.createGroup();
    // Extra arguments are ignored by design: the recipient is always the signed-in user.
    await (n.sendTest as (...a: unknown[]) => Promise<unknown>)('s', '<p>x</p>', 'html', 'owner_a');
    const call = org.calls.find((c) => c.path.endsWith('/createNotification'))!;
    expect(call.params.users).toBe(ME);
    expect(n.sendTest.length).toBeLessThanOrEqual(3);
  });

  it('can send a plain-text fallback', async () => {
    const org = fakeOrg({ groups: [{ id: GID, title: GROUP_TITLE, owner: ME }] });
    const n = createGroupNotifier({ request: org.request, ...W });
    await n.createGroup();
    const r = await n.sendTest('s', '<p>Hi,</p><p><a href="https://x.example/i">Item</a></p>', 'text');
    expect(org.calls.at(-1)!.params.message).toBe('Hi,\n\nItem (https://x.example/i)');
    expect(r.format).toBe('text');
  });
});

describe('owner sends', () => {
  const ready = async (o: Parameters<typeof fakeOrg>[0] = {}) => {
    const org = fakeOrg({ groups: [{ id: GID, title: GROUP_TITLE, owner: ME }], ...o });
    const n = createGroupNotifier({ request: org.request, ...W });
    await n.createGroup();
    return { org, n };
  };

  it('adds, notifies, then removes, in that order', async () => {
    const { org, n } = await ready();
    const r = await n.sendToOwner('owner_a', 'subj', '<p>x</p>');
    expect(org.writes()).toEqual(['community/groups/<g>/addUsers', 'community/groups/<g>/createNotification', 'community/groups/<g>/removeUsers']);
    expect(org.calls.filter((c) => c.method === 'POST').map((c) => c.params.users)).toEqual(['owner_a', 'owner_a', 'owner_a']);
    expect(r).toMatchObject({ username: 'owner_a', sent: true, notRemoved: [] });
  });

  it('skips the notify when the owner could not be added', async () => {
    const { org, n } = await ready({ notAdded: ['owner_a'] });
    const r = await n.sendToOwner('owner_a', 'subj', '<p>x</p>');
    expect(r).toMatchObject({ sent: false, notAdded: true });
    expect(org.writes()).toEqual(['community/groups/<g>/addUsers']);
  });

  it('reports owners left in the group (notRemoved)', async () => {
    const { n } = await ready({ notRemoved: ['owner_a'] });
    const r = await n.sendToOwner('owner_a', 'subj', '<p>x</p>');
    expect(r).toMatchObject({ sent: true, notRemoved: ['owner_a'] });
  });

  it('still removes the owner when the notify fails', async () => {
    const { org, n } = await ready({ failNotify: true });
    await expect(n.sendToOwner('owner_a', 'subj', '<p>x</p>')).rejects.toMatchObject({ message: 'COM_1132', notRemoved: [] });
    expect(org.writes().at(-1)).toBe('community/groups/<g>/removeUsers');
  });

  it('batches add and remove at 25 users per call', async () => {
    const { org, n } = await ready();
    const users = Array.from({ length: MAX_USERS_PER_CALL + 3 }, (_, i) => `u${i}`);
    await n.add(users);
    const adds = org.calls.filter((c) => c.path.endsWith('/addUsers'));
    expect(adds.map((c) => String(c.params.users).split(',').length)).toEqual([25, 3]);
  });

  it('rejects usernames that could smuggle in extra recipients', async () => {
    const { org, n } = await ready();
    await expect(n.sendToOwner('owner_a,owner_b', 's', 'x')).rejects.toThrow(/Invalid username/);
    await expect(n.notify(['owner a'], 's', 'x')).rejects.toThrow(/Invalid username/);
    expect(org.writes()).toEqual([]);
  });
});

describe('deleteGroup', () => {
  it("deletes the app's own group", async () => {
    const org = fakeOrg({ groups: [{ id: GID, title: GROUP_TITLE, owner: ME }] });
    const n = createGroupNotifier({ request: org.request, ...W });
    await n.createGroup();
    await n.deleteGroup();
    expect(org.writes()).toEqual(['community/groups/<g>/delete']);
    expect(n.group).toBeNull();
  });

  it('refuses a group whose title is not the app’s', async () => {
    const groups = [{ id: GID, title: GROUP_TITLE, owner: ME }];
    const org = fakeOrg({ groups });
    const n = createGroupNotifier({ request: org.request, ...W });
    await n.createGroup();
    // Someone renamed the group since: the re-check before delete no longer finds the exact title.
    groups[0].title = 'Team GIS';
    await expect(n.deleteGroup()).rejects.toThrow(/Refusing/);
    expect(org.writes()).toEqual([]);
  });

  it('refuses when no group is held, and never deletes any other id', async () => {
    const org = fakeOrg();
    const n = createGroupNotifier({ request: org.request, ...W });
    await expect(n.deleteGroup()).rejects.toThrow(/not set up/);
    expect(() => assertNotifyAllowed(`community/groups/${OTHER_GID}/delete`, 'POST', { self: ME, groupId: GID })).toThrow(/BLOCKED/);
    expect(org.writes()).toEqual([]);
  });

  it('sends no parameters, and the guard blocks any (ADR 0012)', async () => {
    const org = fakeOrg({ groups: [{ id: GID, title: GROUP_TITLE, owner: ME }] });
    const n = createGroupNotifier({ request: org.request, ...W });
    await n.createGroup();
    await n.deleteGroup();
    expect(org.calls.find((c) => c.path.endsWith('/delete'))!.params).toEqual({});
    const ctx = { self: ME, groupId: GID };
    const path = `community/groups/${GID}/delete`;
    expect(assertNotifyAllowed(path, 'POST', ctx, {})).toBe('deleteGroup');
    for (const p of [{ permanentDelete: 'true' }, { force: 'true' }, { f: 'json' }, { title: GROUP_TITLE }]) {
      expect(() => assertNotifyAllowed(path, 'POST', ctx, p)).toThrow(/takes no parameters/);
    }
    expect(() => assertNotifyAllowed(path, 'GET', ctx, {})).toThrow(BlockedRequest);
    expect(() => assertNotifyAllowed(`community/groups/${OTHER_GID}/delete`, 'POST', ctx, {})).toThrow(/own group/);
  });
});

describe('canCreateGroup and the session notifier', () => {
  it('reads the privilege from portals/self', async () => {
    expect(await createGroupNotifier({ request: fakeOrg().request, ...W }).canCreateGroup()).toEqual({ ok: true });
    expect(await createGroupNotifier({ request: fakeOrg({ privileges: [] }).request, ...W }).canCreateGroup()).toMatchObject({ ok: false });
  });

  it('sends through the injected sender with f=json added by the real sender only', async () => {
    const seen: string[] = [];
    const n = createSessionNotifier(null, {
      portal: 'https://www.arcgis.com/', self: ME, ...W,
      send: async (url, o) => { seen.push(`${o.method} ${url}`); return url.endsWith('/community/groups') ? { results: [] } : { success: true, group: { id: GID, title: GROUP_TITLE, owner: ME } }; },
    });
    await n.createGroup();
    expect(seen).toEqual(['GET https://www.arcgis.com/sharing/rest/community/groups', 'POST https://www.arcgis.com/sharing/rest/community/createGroup']);
  });
});

describe('read-only orgs (DC-058)', () => {
  const sender = () => { const seen: string[] = []; return { seen, send: async (url: string) => { seen.push(url); return {}; } }; };

  it('refuses to construct when the org is not writable, and makes no request', () => {
    const org = fakeOrg();
    for (const writableOrgIds of [[], '', 'SomeOtherOrg1234', ['SomeOtherOrg1234']]) {
      expect(() => createGroupNotifier({ request: org.request, orgId: ORG, writableOrgIds })).toThrow(WritesDisabled);
    }
    expect(() => createGroupNotifier({ request: org.request, orgId: '', writableOrgIds: [''] })).toThrow(/switched off/);
    expect(org.calls).toEqual([]);
  });

  it('defaults to the build list, which is empty in tests: no writes anywhere', () => {
    expect(() => createGroupNotifier({ request: fakeOrg().request, orgId: ORG })).toThrow(WritesDisabled);
  });

  it('ADR 0013: off refuses every org, list refuses unlisted ones, opt-in allows any org with an id', () => {
    const org = fakeOrg();
    expect(() => createGroupNotifier({ request: org.request, orgId: ORG, sendingMode: 'off', writableOrgIds: [ORG] })).toThrow(WritesDisabled);
    expect(() => createGroupNotifier({ request: org.request, orgId: ORG, sendingMode: 'list', writableOrgIds: ['SomeOtherOrg1234'] })).toThrow(WritesDisabled);
    expect(() => createGroupNotifier({ request: org.request, orgId: ORG, sendingMode: 'list' })).toThrow(WritesDisabled);
    expect(() => createGroupNotifier({ request: org.request, orgId: '', sendingMode: 'opt-in' })).toThrow(WritesDisabled);
    expect(() => createGroupNotifier({ request: org.request, orgId: ORG, sendingMode: 'list', writableOrgIds: [ORG] })).not.toThrow();
    expect(() => createGroupNotifier({ request: org.request, orgId: ORG, sendingMode: 'opt-in' })).not.toThrow();
    expect(org.calls).toEqual([]);
  });

  it('ADR 0013: the session notifier honours the mode too, and builds no sender when refused', () => {
    const s = sender();
    expect(() => createSessionNotifier(null, { portal: 'https://www.arcgis.com', self: ME, orgId: ORG, sendingMode: 'off', writableOrgIds: [ORG], send: s.send })).toThrow(WritesDisabled);
    expect(() => createSessionNotifier(null, { portal: 'https://www.arcgis.com', self: ME, orgId: ORG, sendingMode: 'opt-in', send: s.send })).not.toThrow();
    expect(s.seen).toEqual([]);
  });

  it('the session notifier refuses before building a sender', () => {
    const s = sender();
    expect(() => createSessionNotifier(null, { portal: 'https://www.arcgis.com', self: ME, orgId: ORG, writableOrgIds: [], send: s.send })).toThrow(WritesDisabled);
    expect(() => createSessionNotifier(null, { portal: 'https://www.arcgis.com', self: ME, orgId: ORG, send: s.send })).toThrow(WritesDisabled);
    expect(s.seen).toEqual([]);
  });

  it('stops before any write if portals/self names a different org', async () => {
    const org = fakeOrg({ orgId: 'SomeOtherOrg1234' });
    const n = createGroupNotifier({ request: org.request, ...W });
    await expect(n.createGroup()).rejects.toThrow(WritesDisabled);
    expect(org.writes()).toEqual([]);
  });
});

describe('htmlToText', () => {
  it('keeps links and paragraphs', () => {
    expect(htmlToText('<p>Hi &amp; bye<br>next</p><ul><li>One</li></ul>')).toBe('Hi & bye\nnext\n\n- One');
  });
});

describe('tidyGroup (DC-068): leftovers from an interrupted run', () => {
  const members = (n: number) => Array.from({ length: n }, (_, i) => `left_${i}`);
  async function ready(o: Parameters<typeof fakeOrg>[0] = {}) {
    const org = fakeOrg({ groups: [{ id: GID, title: GROUP_TITLE, owner: ME }], ...o });
    const n = createGroupNotifier({ request: org.request, ...W });
    await n.findGroup();
    return { org, n };
  }
  it('the members read is a GET allowed for the app group only', () => {
    const ctx = { self: ME, groupId: GID };
    expect(assertNotifyAllowed(`community/groups/${GID}/users`, 'GET', ctx)).toBe('groupUsers');
    expect(() => assertNotifyAllowed(`community/groups/${OTHER_GID}/users`, 'GET', ctx)).toThrow(/own group/);
    expect(() => assertNotifyAllowed(`community/groups/${GID}/users`, 'GET', { self: ME })).toThrow(/own group/);
    expect(() => assertNotifyAllowed(`community/groups/${GID}/users`, 'POST', ctx)).toThrow(/method/);
  });
  it('removes everyone but the signed-in admin and reports who went', async () => {
    const { org, n } = await ready({ members: [ME, 'left_a', 'left_b'] });
    expect(await n.tidyGroup()).toEqual({ removed: ['left_a', 'left_b'], notRemoved: [] });
    expect(org.calls.filter((c) => c.method === 'POST').map((c) => [c.path.split('/').pop(), c.params.users])).toEqual([['removeUsers', 'left_a,left_b']]);
  });
  it('does nothing (and writes nothing) when the group is empty or holds only the admin', async () => {
    const { org, n } = await ready({ members: [ME] });
    expect(await n.tidyGroup()).toEqual({ removed: [], notRemoved: [] });
    expect(org.calls.some((c) => c.method === 'POST')).toBe(false);
  });
  it('batches removals at the per-call limit and never adds anyone', async () => {
    const { org, n } = await ready({ members: members(MAX_USERS_PER_CALL + 3) });
    const r = await n.tidyGroup();
    expect(r.removed).toHaveLength(MAX_USERS_PER_CALL + 3);
    const posts = org.calls.filter((c) => c.method === 'POST');
    expect(posts.map((c) => String(c.params.users).split(',').length)).toEqual([MAX_USERS_PER_CALL, 3]);
    expect(posts.every((c) => c.path.endsWith('/removeUsers'))).toBe(true);
  });
  it('surfaces the ones ArcGIS Online would not remove', async () => {
    const { n } = await ready({ members: ['left_a', 'left_b'], notRemoved: ['left_b'] });
    expect(await n.tidyGroup()).toEqual({ removed: ['left_a'], notRemoved: ['left_b'] });
  });
  it('needs the group to be set up first', async () => {
    const org = fakeOrg();
    const n = createGroupNotifier({ request: org.request, ...W });
    await expect(n.tidyGroup()).rejects.toThrow(/not set up/);
  });
  it('throws WritesDisabled in a read-only org, with no request', () => {
    const request: RequestFn = async () => { throw new Error('no request'); };
    expect(() => createGroupNotifier({ request, orgId: 'OtherOrg12345678', writableOrgIds: [ORG] })).toThrow(WritesDisabled);
  });
});
