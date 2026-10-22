import { describe, expect, it } from 'vitest';
import { COPY, canShowAppData, detectAppData, removeAppGroup, removeAppLog, type AppDataOrg } from './app-data';
import { createGroupNotifier, GROUP_TITLE } from '../../notify';
import { createFakeLogOrg, createNudgeLog, FAKE_PORTAL, LOG_TITLE } from '../../log';
import type { RequestFn } from '../../scan/types';

const ME = 'admin_me';
const ORG_ID = 'DevOrg0123456789';
const GID = 'a'.repeat(32);
const ORG: AppDataOrg = { id: ORG_ID, urlKey: 'acme' };

interface GroupOrgOpts { exists?: boolean; deleteError?: string }
function groupOrg(o: GroupOrgOpts = {}) {
  const calls: { path: string; method: string }[] = [];
  let exists = o.exists ?? true;
  const request: RequestFn = async (path, _params = {}, options = {}) => {
    calls.push({ path, method: options.method ?? 'GET' });
    if (path === 'portals/self') return { id: ORG_ID, user: { username: ME, privileges: [] } };
    if (path === 'community/groups') return { results: exists ? [{ id: GID, title: GROUP_TITLE, owner: ME, access: 'private' }] : [] };
    if (path.endsWith('/delete')) {
      if (o.deleteError) throw Object.assign(new Error(o.deleteError), { code: 400 });
      exists = false;
      return { success: true };
    }
    throw new Error(`unexpected ${path}`);
  };
  const notifier = createGroupNotifier({ request, orgId: ORG_ID, writableOrgIds: [ORG_ID] });
  return { notifier, calls, posts: () => calls.filter((c) => c.method === 'POST') };
}

function logOrg(o: Parameters<typeof createFakeLogOrg>[0] extends infer T ? Partial<T> : never = {}) {
  const fake = createFakeLogOrg({ self: ME, orgId: ORG_ID, exists: true, ...o });
  const log = createNudgeLog({ send: fake.send, portal: FAKE_PORTAL, orgId: ORG_ID, writableOrgIds: [ORG_ID] });
  return { fake, log };
}

describe('the section only exists for a writable org with something to look for', () => {
  it('needs writable, an org, and a notifier or a log', () => {
    const g = groupOrg();
    expect(canShowAppData({ notifier: g.notifier, writable: true, org: ORG })).toBe(true);
    expect(canShowAppData({ nudgeLog: logOrg().log, writable: true, org: ORG })).toBe(true);
    expect(canShowAppData({ notifier: g.notifier, writable: false, org: ORG })).toBe(false);
    expect(canShowAppData({ notifier: g.notifier, writable: true, org: null })).toBe(false);
    expect(canShowAppData({ writable: true, org: ORG })).toBe(false);
    expect(canShowAppData({ notifier: null, nudgeLog: null, writable: true, org: ORG })).toBe(false);
    expect(canShowAppData({})).toBe(false);
  });
  it('a read-only org sends no request, even with a notifier and log in hand', async () => {
    const g = groupOrg();
    const l = logOrg();
    expect(await detectAppData({ notifier: g.notifier, nudgeLog: l.log, writable: false, org: ORG })).toEqual({ group: null, log: null });
    expect(g.calls).toEqual([]);
    expect(l.fake.calls).toEqual([]);
  });
});

describe('finding what the app made (read only)', () => {
  it('finds the group and the log, counts sends (not test rows) and links to ArcGIS Online', async () => {
    const g = groupOrg();
    const l = logOrg({ rows: [
      { owner: 'amy', sent_at: 1000, item_ids: 'b'.repeat(32), item_count: 1, credits: 1, is_test: 0 },
      { owner: 'bob', sent_at: 2000, item_ids: 'b'.repeat(32), item_count: 1, credits: 1, is_test: 0 },
      { owner: ME, sent_at: 3000, item_ids: '', item_count: 0, credits: 0, is_test: 1 },
    ] });
    const r = await detectAppData({ notifier: g.notifier, nudgeLog: l.log, writable: true, org: ORG });
    expect(r?.group).toEqual({ id: GID, title: GROUP_TITLE, href: `https://acme.maps.arcgis.com/home/group.html?id=${GID}` });
    expect(r?.log).toMatchObject({ title: LOG_TITLE, sends: 2, href: `https://acme.maps.arcgis.com/home/item.html?id=${'e'.repeat(32)}` });
    expect(g.posts()).toEqual([]);
    expect(l.fake.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });
  it('shows nothing for what is not there, and drops the result when aborted', async () => {
    const g = groupOrg({ exists: false });
    const l = logOrg({ exists: false });
    expect(await detectAppData({ notifier: g.notifier, nudgeLog: l.log, writable: true, org: ORG })).toEqual({ group: null, log: null });
    const ac = new AbortController();
    ac.abort();
    expect(await detectAppData({ notifier: groupOrg().notifier, writable: true, org: ORG }, ac.signal)).toBeNull();
  });
});

describe('removing the group', () => {
  it('deletes the app group', async () => {
    const g = groupOrg();
    expect(await removeAppGroup(g.notifier, ORG)).toEqual({ ok: true, already: false });
    expect(g.posts().map((c) => c.path)).toEqual([`community/groups/${GID}/delete`]);
  });
  it('already gone counts as success, with nothing sent', async () => {
    const g = groupOrg({ exists: false });
    expect(await removeAppGroup(g.notifier, ORG)).toEqual({ ok: true, already: true });
    expect(g.posts()).toEqual([]);
  });
  it('"does not exist" from the delete counts as success; any other error gives the friendly message and a link', async () => {
    expect(await removeAppGroup(groupOrg({ deleteError: 'Group does not exist' }).notifier, ORG)).toEqual({ ok: true, already: true });
    const r = await removeAppGroup(groupOrg({ deleteError: 'You do not have permissions' }).notifier, ORG);
    expect(r).toEqual({ ok: false, message: COPY.groupFailed, href: `https://acme.maps.arcgis.com/home/group.html?id=${GID}` });
  });
});

describe('deleting the log', () => {
  it('deletes the app log', async () => {
    const l = logOrg();
    await l.log.find();
    expect(await removeAppLog(l.log, ORG, 'e'.repeat(32))).toEqual({ ok: true, already: false });
    expect(l.fake.deleted).toBe(1);
  });
  it('already gone counts as success', async () => {
    const l = logOrg();
    await l.log.find();
    l.fake.removeNow();
    expect(await removeAppLog(l.log, ORG, 'e'.repeat(32))).toEqual({ ok: true, already: true });
  });
  it('any other error gives the friendly message and the item link, and the log stays', async () => {
    const l = logOrg({ deleteFails: true });
    await l.log.find();
    const r = await removeAppLog(l.log, ORG, 'e'.repeat(32));
    expect(r).toEqual({ ok: false, message: COPY.logFailed, href: `https://acme.maps.arcgis.com/home/item.html?id=${'e'.repeat(32)}` });
    expect(l.fake.item).not.toBeNull();
  });
  it('a log that is not the app log is refused, with the friendly message', async () => {
    const l = logOrg();
    await l.log.find();
    l.fake.item!.title = 'Parcels';
    expect((await removeAppLog(l.log, ORG, 'e'.repeat(32))).ok).toBe(false);
    expect(l.fake.deleted).toBe(0);
  });
});

describe('the words', () => {
  it('state the cost of deleting the log, plainly', () => {
    const t = COPY.logConfirm(12);
    expect(t).toContain('“Decluttering nudge log”');
    expect(t).toContain('with its 12 rows');
    expect(t).toContain('owners could be nudged again sooner than six months');
    expect(t).toContain('Review can no longer show what happened since a nudge');
    expect(COPY.logConfirm(1)).toContain('its 1 row.');
    expect(COPY.logConfirm(null)).toContain('with its rows.');
  });
  it('say only the app own group goes', () => {
    expect(COPY.groupConfirm).toContain('remove your hidden group');
    expect(COPY.groupConfirm).toContain('Your nudge log stays');
  });
  it('count sends, and use no exclamation marks', () => {
    expect(COPY.logNote(0)).toBe('0 sends recorded.');
    expect(COPY.logNote(1)).toBe('1 send recorded.');
    expect(JSON.stringify(Object.values(COPY).filter((v) => typeof v === 'string'))).not.toContain('!');
  });
});
