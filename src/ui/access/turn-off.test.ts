import { describe, expect, it } from 'vitest';
import { TURN_OFF, turnOffSending } from './turn-off';
import { COPY } from '../about/app-data';
import { capabilities } from '../../auth/access';
import { createGroupNotifier, GROUP_TITLE } from '../../notify';
import type { RequestFn } from '../../scan/types';

const ME = 'admin_me';
const ORG_ID = 'DevOrg0123456789';
const GID = 'a'.repeat(32);
const ORG = { id: ORG_ID, urlKey: 'acme' };
const PRIV = ['portal:admin:viewItems', 'portal:admin:viewUsers', 'portal:user:createGroup', 'portal:admin:assignToGroups'];

function groupOrg(o: { exists?: boolean; deleteError?: string } = {}) {
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

describe('the checklist row', () => {
  const row = (on: boolean) => capabilities(PRIV, true, true, on).items.find((i) => i.id === 'org-send')!;
  it('on for you offers Turn off; off for you offers Turn on; neither where sending is unavailable', () => {
    expect(row(true)).toMatchObject({ state: 'yes', action: 'turn-off' });
    expect(row(false)).toMatchObject({ state: 'neutral', action: 'turn-on' });
    expect(capabilities(PRIV, true, false, true).items.find((i) => i.id === 'org-send')?.action).toBeUndefined();
  });
});

describe('turning sending off', () => {
  it('removes only the admin own group, through the guarded delete, and nothing else', async () => {
    const g = groupOrg();
    expect(await turnOffSending(g.notifier, ORG)).toEqual({ ok: true });
    expect(g.posts().map((c) => c.path)).toEqual([`community/groups/${GID}/delete`]);
    expect(g.calls.every((c) => c.path.startsWith('community/groups') || c.path === 'portals/self')).toBe(true);
  });
  it('success means the group is gone, so the next read finds none (back to "off for you")', async () => {
    const g = groupOrg();
    await turnOffSending(g.notifier, ORG);
    expect(await g.notifier.findGroup()).toBeNull();
  });
  it('already gone is success and sends no write', async () => {
    const g = groupOrg({ exists: false });
    expect(await turnOffSending(g.notifier, ORG)).toEqual({ ok: true });
    expect(g.posts()).toEqual([]);
  });
  it('a refusal gives the friendly ADR 0012 message and a link, and the group stays', async () => {
    const g = groupOrg({ deleteError: 'You do not have permissions' });
    const r = await turnOffSending(g.notifier, ORG);
    expect(r).toEqual({ ok: false, message: COPY.groupFailed, href: `https://acme.maps.arcgis.com/home/group.html?id=${GID}` });
    expect(g.posts().length).toBe(1);
  });
  it('never touches the nudge log (it is not even in reach)', async () => {
    const g = groupOrg();
    await turnOffSending(g.notifier, ORG);
    expect(g.calls.some((c) => /items|addItem|applyEdits|FeatureServer/i.test(c.path))).toBe(false);
  });
});

describe('the words', () => {
  it('match the agreed copy and name the safe choice', () => {
    expect(TURN_OFF.heading).toBe('Turn off sending?');
    expect(TURN_OFF.body).toBe('We’ll remove your hidden group, so nothing more can be sent from here. Your nudge log stays, so owners you’ve nudged keep resting for six months. You can turn sending on again any time.');
    expect(TURN_OFF.yes).toBe('Turn off sending');
    expect(TURN_OFF.keep).toBe('Keep it on');
    expect(TURN_OFF.done).toBe('Sending is off. Your nudge log is still there.');
    expect(JSON.stringify(Object.values(TURN_OFF))).not.toContain('!');
  });
  it('About uses the same wording for the group removal and leaves the log removal alone', () => {
    expect(COPY.removeGroup).toBe('Turn off sending (remove your group)');
    expect(COPY.groupConfirmHeading).toBe(TURN_OFF.heading);
    expect(COPY.groupConfirm).toBe(TURN_OFF.body);
    expect(COPY.groupConfirmButton).toBe(TURN_OFF.yes);
    expect(COPY.groupKeep).toBe(TURN_OFF.keep);
    expect(COPY.deleteLog).toBe('Delete log…');
    expect(COPY.logConfirmButton).toBe('Delete log');
    expect(COPY.keep).toBe('Keep it');
  });
});
