// DC-019: the demo's notifier. The real group notifier (src/notify, with its own allow-list) on top of an in-memory
// fake of the few ArcGIS Online calls it makes. Nothing leaves the browser: there is no network sender here at all.
// One owner stalls once, so the demo can show "Try again" (as prototype D does).
import { createGroupNotifier, CREATE_GROUP_PRIVILEGE, type GroupNotifier } from '../../notify';
import type { RequestFn } from '../../scan/types';
import { createFakeLogOrg, createNudgeLog, FAKE_PORTAL, type NudgeLog } from '../../log';
import type { FakeLogCall } from '../../log/fake';

export const DEMO_ORG_ID = 'demo-org-not-real';

export interface FakeOrgOptions {
  self: string;
  /** Milliseconds per call (0 in tests). */
  delayMs?: number;
  /** This owner's first notify fails (shows "Try again"). */
  failOnceFor?: string | null;
  canCreateGroup?: boolean;
  /** Start with the app's group already there. */
  groupExists?: boolean;
  /** Owners already in the group, left by an earlier interrupted run. */
  leftover?: string[];
}

export interface FakeOrgCall { path: string; method: string; users?: string }

/** A fake RequestFn answering like ArcGIS Online. Records each call (paths only, group id masked). */
export function createFakeOrg(o: FakeOrgOptions) {
  const calls: FakeOrgCall[] = [];
  const GID = 'd'.repeat(32);
  let group = o.groupExists ? { id: GID, title: 'Decluttering notifications', owner: o.self, access: 'private' } : null;
  const members = new Set<string>(o.leftover ?? []);
  const failed = new Set<string>();
  const wait = () => new Promise<void>((r) => (o.delayMs ? setTimeout(r, o.delayMs) : r()));
  const request: RequestFn = async (path, params = {}, options = {}) => {
    const method = options.method ?? 'GET';
    calls.push({ path: path.replace(/[0-9a-f]{32}/, '<g>'), method, ...(params.users ? { users: String(params.users) } : {}) });
    await wait();
    const users = String(params.users ?? '').split(',').filter(Boolean);
    if (path === 'portals/self') return { id: DEMO_ORG_ID, user: { username: o.self, privileges: o.canCreateGroup === false ? [] : [CREATE_GROUP_PRIVILEGE] } };
    if (path === 'community/groups') return { results: group ? [group] : [] };
    if (path === 'community/createGroup') { group = { id: GID, title: String(params.title), owner: o.self, access: String(params.access) }; return { success: true, group }; }
    if (/\/users$/.test(path) && path.startsWith('community/groups/')) return { owner: o.self, admins: [], users: [...members] };
    if (path.endsWith('/addUsers')) { users.forEach((u) => members.add(u)); return { notAdded: [] }; }
    if (path.endsWith('/removeUsers')) { users.forEach((u) => members.delete(u)); return { notRemoved: [] }; }
    if (path.endsWith('/createNotification')) {
      const u = users[0];
      if (u && u === o.failOnceFor && !failed.has(u)) { failed.add(u); throw new Error('ArcGIS Online did not answer in time'); }
      if (users.some((x) => x !== o.self && !members.has(x))) throw new Error('One or more users in the list are not allowed to receive notifications');
      return { success: true };
    }
    if (path.endsWith('/delete')) { group = null; return { success: true }; }
    throw new Error(`The demo doesn't know ${path}`);
  };
  return { request, calls, members };
}

export function createDemoNotifier(o: FakeOrgOptions): { notifier: GroupNotifier; calls: FakeOrgCall[]; members: Set<string> } {
  const fake = createFakeOrg(o);
  const notifier = createGroupNotifier({ request: fake.request, orgId: DEMO_ORG_ID, writableOrgIds: [DEMO_ORG_ID], self: o.self });
  return { notifier, calls: fake.calls, members: fake.members };
}

/* ------------------------------------------------------------ the demo's nudge log (DC-017) */

let demoLog: { self: string; fake: ReturnType<typeof createFakeLogOrg> } | null = null;

/**
 * The real nudge log code on an in-memory fake table. The fake lives as long as the page, so going back to the review
 * and on to the emails again (a "later run") finds the log the first run created. Nothing leaves the browser.
 */
export function createDemoNudgeLog(o: { self: string; orgId: string; delayMs?: number }): { log: NudgeLog; calls: FakeLogCall[] } {
  if (!demoLog || demoLog.self !== o.self) demoLog = { self: o.self, fake: createFakeLogOrg({ self: o.self, orgId: o.orgId, delayMs: o.delayMs }) };
  const log = createNudgeLog({ send: demoLog.fake.send, portal: FAKE_PORTAL, orgId: o.orgId, writableOrgIds: [o.orgId], self: o.self });
  return { log, calls: demoLog.fake.calls };
}

/** Tests only: forget the demo's table. */
export function resetDemoNudgeLog(): void { demoLog = null; }
