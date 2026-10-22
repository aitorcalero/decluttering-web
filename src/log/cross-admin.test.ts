import { describe, expect, it } from 'vitest';
import { assertOtherLogReadAllowed, BlockedRequest, LOG_TAG, LOG_TITLE } from './guard';
import { createNudgeLog, guardedOtherSend, isAppLogAnyOwner } from './nudge-log';
import { FAKE_PORTAL } from './fake';
import { logRead, mergeLogReads } from './rows';
import { nudgedRecently, othersUnreadableLine, renudgeLine } from '../domain/cooldown';

// DC-125c: the six-month rest counts every admin's nudges. Reads of other admins' logs are query-only.
const ORG = 'devorg0000000001';
const ME = 'admin_me';
const svc = (n: string) => `https://services9.arcgis.com/FakeOrg0000000000/arcgis/rest/services/Decluttering_nudge_log_${n}/FeatureServer`;
const item = (id: string, owner: string, n: string, over: Record<string, unknown> = {}) =>
  ({ id: id.repeat(32), title: LOG_TITLE, owner, type: 'Feature Service', access: 'private', url: svc(n), tags: [LOG_TAG, 'Decluttering'], ...over });
const MINE = item('a', ME, '0000aaaa');
const THEIRS = item('b', 'admin_other', '0000bbbb');

describe('isAppLogAnyOwner', () => {
  it('accepts any owner, still needs tag, type, title or name, and the service url shape', () => {
    expect(isAppLogAnyOwner(THEIRS)).toBe(true);
    expect(isAppLogAnyOwner(item('c', 'x', '0000cccc', { title: 'Decluttering_nudge_log_0000cccc' }))).toBe(true);
    expect(isAppLogAnyOwner({ ...THEIRS, tags: ['other'] })).toBe(false);
    expect(isAppLogAnyOwner({ ...THEIRS, title: 'My stuff' })).toBe(false);
    expect(isAppLogAnyOwner({ ...THEIRS, type: 'Table' })).toBe(false);
    expect(isAppLogAnyOwner({ ...THEIRS, url: 'https://evil.example.com/x/FeatureServer' })).toBe(false);
    expect(isAppLogAnyOwner({ ...THEIRS, owner: '' })).toBe(false);
    expect(isAppLogAnyOwner({ ...THEIRS, id: 'nope' })).toBe(false);
  });
});

describe("read-only guard for other admins' logs", () => {
  const q = `${svc('0000bbbb')}/0/query`;
  it('permits a GET query only', () => {
    expect(assertOtherLogReadAllowed(q, 'GET', { where: '1=1', outFields: 'owner,sent_at', resultOffset: 0 }, FAKE_PORTAL)).toBe('query');
  });
  it('refuses every write, and any other call, before a request is made', async () => {
    const bad: [string, string, Record<string, string | number>][] = [
      [`${svc('0000bbbb')}/0/applyEdits`, 'POST', { adds: '[]' }],
      [`${svc('0000bbbb').replace('/rest/services/', '/rest/admin/services/')}/addToDefinition`, 'POST', {}],
      [`${FAKE_PORTAL}/sharing/rest/content/users/admin_other/items/${'b'.repeat(32)}/update`, 'POST', { title: LOG_TITLE }],
      [`${FAKE_PORTAL}/sharing/rest/content/users/admin_other/items/${'b'.repeat(32)}/delete`, 'POST', {}],
      [`${FAKE_PORTAL}/sharing/rest/content/users/admin_other/createService`, 'POST', {}],
      [q, 'POST', { where: '1=1' }],
      [`${q}?x=1`, 'GET', {}],
      [q.replace('Decluttering_nudge_log_0000bbbb', 'SomeoneElsesService'), 'GET', { where: '1=1' }],
      [q, 'GET', { where: '1=1', adds: '[]' }],
    ];
    for (const [u, m, p] of bad) expect(() => assertOtherLogReadAllowed(u, m, p, FAKE_PORTAL)).toThrow(BlockedRequest);
    const calls: string[] = [];
    const send = guardedOtherSend(async (u) => { calls.push(u); return {}; }, FAKE_PORTAL);
    for (const [u, m, p] of bad) await expect(send(u, { method: m as 'GET' | 'POST', params: p })).rejects.toThrow(BlockedRequest);
    expect(calls).toEqual([]);
    await send(q, { method: 'GET', params: { where: '1=1' } });
    expect(calls).toEqual([q]);
  });
});

function rig(opts: { results?: unknown[][]; failQuery?: string; failSearch?: boolean; mineRows?: unknown[] } = {}) {
  const calls: { url: string; method: string; params: Record<string, unknown> }[] = [];
  const pages = opts.results ?? [[MINE, THEIRS]];
  const send = async (url: string, r: { method: 'GET' | 'POST'; params: Record<string, string | number> }) => {
    calls.push({ url, method: r.method, params: r.params });
    if (url.endsWith('/portals/self')) return { id: ORG, user: { username: ME } };
    if (url.endsWith('/search')) {
      if (opts.failSearch) throw new Error('search down');
      const idx = Math.min(Number(r.params.start ?? 1) - 1, pages.length - 1);
      return { results: pages[idx], nextStart: idx < pages.length - 1 ? idx + 2 : -1 };
    }
    if (url.endsWith('/0/query')) {
      if (opts.failQuery && url.includes(opts.failQuery)) return { error: { code: 403, message: 'no access' } };
      const rows = url.includes('0000bbbb') || url.includes('0000dddd')
        ? [{ owner: 'amy', sent_at: Date.parse('2026-09-01T00:00:00Z'), item_ids: '', item_count: 1, credits: 1, is_test: 0 }]
        : (opts.mineRows ?? []);
      return { features: rows.map((a) => ({ attributes: a })), exceededTransferLimit: false };
    }
    throw new Error(`unexpected ${url}`);
  };
  const log = createNudgeLog({ send, portal: FAKE_PORTAL, orgId: ORG, writableOrgIds: [ORG] });
  return { log, calls };
}

describe('findAllInOrg', () => {
  it('searches the org for any owner, with the owner filter gone and the org filter present', async () => {
    const { log, calls } = rig();
    const all = await log.findAllInOrg!();
    expect(all.map((t) => t.owner).sort()).toEqual(['admin_me', 'admin_other']);
    const s = calls.find((c) => c.url.endsWith('/search'));
    expect(String(s?.params.q)).not.toMatch(/owner:/);
    expect(String(s?.params.q)).toContain(`orgid:${ORG}`);
    expect(String(s?.params.q)).toContain(`tags:"${LOG_TAG}"`);
    expect(String(s?.params.q)).toContain('type:"Feature Service"');
    expect(s?.params.num).toBe(100);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });
  it("paginates and drops items that are not the app's log", async () => {
    const { log, calls } = rig({ results: [[MINE, { ...THEIRS, tags: [] }], [item('d', 'third', '0000dddd')]] });
    const all = await log.findAllInOrg!();
    expect(all.map((t) => t.owner)).toEqual(['admin_me', 'third']);
    expect(calls.filter((c) => c.url.endsWith('/search')).map((c) => c.params.start)).toEqual([1, 2]);
  });
  it("does not change which table is the admin's own", async () => {
    const { log } = rig();
    await log.findAllInOrg!();
    expect(log.table).toBeNull();
  });
});

describe('readOthers', () => {
  it("queries only other admins' logs, with GETs, and never writes", async () => {
    const { log, calls } = rig();
    const o = await log.readOthers!();
    expect(o.unreadable).toBe(false);
    expect(o.reads).toHaveLength(1);
    expect(o.reads[0]?.admin).toBe('admin_other');
    expect(o.reads[0]?.read.get('amy')).toBe('2026-09-01T00:00:00.000Z');
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    expect(calls.filter((c) => c.url.endsWith('/0/query')).every((c) => c.url.startsWith(svc('0000bbbb')))).toBe(true);
  });
  it('flags unreadable (and keeps the rest) when a log refuses, or the search fails; never throws', async () => {
    const x = rig({ failQuery: '0000bbbb' });
    expect(await x.log.readOthers!()).toMatchObject({ reads: [], unreadable: true });
    const y = rig({ failSearch: true });
    expect(await y.log.readOthers!()).toMatchObject({ reads: [], unreadable: true });
    const z = rig({ results: [[MINE, THEIRS, item('d', 'third', '0000dddd')]], failQuery: '0000dddd' });
    const r = await z.log.readOthers!();
    expect(r.unreadable).toBe(true);
    expect(r.reads.map((s) => s.admin)).toEqual(['admin_other']);
  });
});

describe('mergeLogReads', () => {
  const at = (s: string) => new Date(s).toISOString();
  const mine = logRead([['amy', at('2026-06-01T00:00:00Z')], ['bob', at('2026-09-01T00:00:00Z')]]);
  const theirs = logRead([['amy', at('2026-09-01T00:00:00Z')], ['bob', at('2026-07-01T00:00:00Z')], ['cat', at('2026-08-01T00:00:00Z')]]);
  it('latest wins, and records you versus another admin', () => {
    const m = mergeLogReads(mine, [{ admin: 'admin_other', read: theirs }], ME);
    expect(m.latest.get('amy')).toBe(at('2026-09-01T00:00:00Z'));
    expect(m.by.get('amy')).toEqual({ by: 'another-admin', admin: 'admin_other' });
    expect(m.by.get('bob')).toEqual({ by: 'you', admin: ME });
    expect(m.by.get('cat')).toEqual({ by: 'another-admin', admin: 'admin_other' });
  });
  it('a tie counts as you; with no own log and no others the result is empty', () => {
    const t = logRead([['bob', at('2026-09-01T00:00:00Z')]]);
    expect(mergeLogReads(mine, [{ admin: 'o', read: t }], ME).by.get('bob')?.by).toBe('you');
    expect(mergeLogReads(null, [], ME).latest.size).toBe(0);
    expect(mergeLogReads(null, [{ admin: 'o', read: t }], ME).by.get('bob')?.by).toBe('another-admin');
  });
  it("keeps the admin's own sends", () => {
    const own = logRead([], [{ owner: 'amy', sentAt: '2026-06-01T00:00:00.000Z', itemIds: [], itemCount: 1, credits: 1 }]);
    expect(mergeLogReads(own, [], ME).latest.sends).toHaveLength(1);
  });
  it('an owner nudged by another admin rests by default via lastNotified', () => {
    const m = mergeLogReads(null, [{ admin: 'o', read: theirs }], ME);
    expect(nudgedRecently({ lastNotified: m.latest.get('cat') ?? null }, new Date('2026-10-10T00:00:00Z'))).toBe(true);
  });
});

describe('renudgeLine and the fallback line', () => {
  it('singular, plural and none', () => {
    expect(renudgeLine([{}])).toBe('1 owner was nudged in the last six months, by you or another admin.');
    expect(renudgeLine([{}, {}, {}])).toBe('3 owners were nudged in the last six months, by you or another admin.');
    expect(renudgeLine([])).toBe('');
  });
  it('says plainly that only your own nudges are known', () => {
    expect(othersUnreadableLine()).toMatch(/only knows about nudges you sent/i);
  });
});
