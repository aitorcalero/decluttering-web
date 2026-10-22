import { beforeEach, describe, expect, it } from 'vitest';
import { assertLogAllowed, BlockedRequest, isLogServiceUrl, LOG_FIELDS, LOG_TAG, LOG_TITLE, type LogGuardContext } from './guard';
import { createNudgeLog, isAppLog, LOG_DESCRIPTION, LOG_SNIPPET, tableDefinition } from './nudge-log';
import { MAX_THUMB_BYTES, SEND_THUMBNAILS } from '../notify/thumbnail';
import { applyNudgeLog, buildRow, latestByOwner, readRows, sendsOf, withSend } from './rows';
import { createFakeLogOrg, FAKE_PORTAL } from './fake';
import { getLogChoice, setLogChoice } from './choice';
import { clearNudgeLogs, forgetNudgeLog, getNudgeLog, getNudgeSends, onNudgeLogChange, setNudgeLog } from './store';
import { createSessionNudgeLog } from './session';
import { WritesDisabled } from '../notify/notifier';
import { evaluate, PRESETS } from '../domain/stale';
import { nudgedRecently } from '../domain/cooldown';
import type { Data, Service } from '../domain/types';
import type { StorageLike } from '../cache/settings';

const ORG = 'devorg0000000001';
const ME = 'admin_me';
const SVC = 'https://services9.arcgis.com/FakeOrg0000000000/arcgis/rest/services/Decluttering_nudge_log_0000beef/FeatureServer';
const OTHER_SVC = 'https://services9.arcgis.com/FakeOrg0000000000/arcgis/rest/services/Parcels/FeatureServer';
const REST = `${FAKE_PORTAL}/sharing/rest`;
const ctx = (over: Partial<LogGuardContext> = {}): LogGuardContext => ({ portal: FAKE_PORTAL, self: ME, serviceUrl: SVC, newServiceUrl: null, ...over });
const ID = 'a'.repeat(32), ID2 = 'b'.repeat(32);

const createParams = (over: Record<string, string> = {}) => ({
  outputType: 'featureService', title: LOG_TITLE, tags: `${LOG_TAG},Decluttering`,
  createParameters: JSON.stringify({ name: 'Decluttering_nudge_log_0123abcd', hasStaticData: false }), ...over,
});
const adds = (attrs: Record<string, unknown>) => ({ adds: JSON.stringify([{ attributes: attrs }]), rollbackOnFailure: 'true' });

describe('log allow-list', () => {
  it('allows the reads', () => {
    expect(assertLogAllowed(`${REST}/portals/self`, 'GET', {}, ctx())).toBe('portalSelf');
    expect(assertLogAllowed(`${REST}/search`, 'GET', { q: 'x' }, ctx())).toBe('search');
    expect(assertLogAllowed(`${REST}/content/users/${ME}`, 'GET', {}, ctx())).toBe('userContent');
    expect(assertLogAllowed(`${SVC}/0/query`, 'GET', { where: '1=1' }, ctx())).toBe('query');
  });
  it('another user\'s content is not readable, and reads are GET only', () => {
    expect(() => assertLogAllowed(`${REST}/content/users/someone_else`, 'GET', {}, ctx())).toThrow(BlockedRequest);
    expect(() => assertLogAllowed(`${REST}/search`, 'POST', {}, ctx())).toThrow(BlockedRequest);
  });
  it('createService only in my own content, with the exact title, the tag and the app service name', () => {
    const url = `${REST}/content/users/${ME}/createService`;
    expect(assertLogAllowed(url, 'POST', createParams(), ctx())).toBe('createService');
    expect(() => assertLogAllowed(`${REST}/content/users/other/createService`, 'POST', createParams(), ctx())).toThrow(/allow-list/);
    expect(() => assertLogAllowed(url, 'POST', createParams({ title: 'Decluttering nudge log 2' }), ctx())).toThrow(/exact title/);
    expect(() => assertLogAllowed(url, 'POST', createParams({ tags: 'Decluttering' }), ctx())).toThrow(/tag/);
    expect(() => assertLogAllowed(url, 'POST', createParams({ createParameters: JSON.stringify({ name: 'Parcels' }) }), ctx())).toThrow(/service name/);
    expect(() => assertLogAllowed(url, 'POST', createParams({ overwrite: 'true' }), ctx())).toThrow(/unexpected/);
    expect(() => assertLogAllowed(url, 'POST', createParams({ outputType: 'sceneService' }), ctx())).toThrow(/feature service/);
    expect(() => assertLogAllowed(url, 'GET', createParams(), ctx())).toThrow(BlockedRequest);
    expect(() => assertLogAllowed(url, 'POST', createParams(), ctx({ self: null }))).toThrow(BlockedRequest);
  });
  it('addToDefinition only on the service this session created, and only the one log table', () => {
    const url = SVC.replace('/rest/services/', '/rest/admin/services/') + '/addToDefinition';
    const def = { addToDefinition: JSON.stringify(tableDefinition()) };
    expect(assertLogAllowed(url, 'POST', def, ctx({ newServiceUrl: SVC }))).toBe('addToDefinition');
    expect(() => assertLogAllowed(url, 'POST', def, ctx())).toThrow(/this session created/);
    expect(() => assertLogAllowed(url, 'POST', { addToDefinition: JSON.stringify({ layers: [] }) }, ctx({ newServiceUrl: SVC }))).toThrow(/one log table/);
    const extra = tableDefinition(); extra.tables[0]!.fields.push({ name: 'email', alias: 'e', type: 'esriFieldTypeString', nullable: true, editable: true });
    expect(() => assertLogAllowed(url, 'POST', { addToDefinition: JSON.stringify(extra) }, ctx({ newServiceUrl: SVC }))).toThrow(/unexpected field/);
    const other = OTHER_SVC.replace('/rest/services/', '/rest/admin/services/') + '/addToDefinition';
    expect(() => assertLogAllowed(other, 'POST', def, ctx({ newServiceUrl: OTHER_SVC, serviceUrl: OTHER_SVC }))).toThrow(BlockedRequest);
  });
  it('applyEdits: adds only, on the app\'s table only, with the log\'s own fields only', () => {
    const row = buildRow({ owner: 'amy', sentAt: 1, itemIds: [ID], credits: 1, sender: ME });
    expect(assertLogAllowed(`${SVC}/0/applyEdits`, 'POST', adds(row), ctx())).toBe('applyEdits');
    expect(() => assertLogAllowed(`${SVC}/0/applyEdits`, 'POST', { ...adds(row), updates: '[]' }, ctx())).toThrow(/adds only/);
    expect(() => assertLogAllowed(`${SVC}/0/applyEdits`, 'POST', { deletes: '1' }, ctx())).toThrow(/adds only/);
    expect(() => assertLogAllowed(`${SVC}/0/applyEdits`, 'POST', adds({ ...row, email: 'a@b.c' }), ctx())).toThrow(/unexpected field/);
    expect(() => assertLogAllowed(`${SVC}/0/applyEdits`, 'POST', { adds: JSON.stringify([{ attributes: row, geometry: { x: 1, y: 1 } }]) }, ctx())).toThrow(/attributes only/);
    expect(() => assertLogAllowed(`${OTHER_SVC}/0/applyEdits`, 'POST', adds(row), ctx())).toThrow(BlockedRequest);
    expect(() => assertLogAllowed(`${SVC}/0/applyEdits`, 'POST', adds(row), ctx({ serviceUrl: null }))).toThrow(/no app log table/);
  });
  it("retitle (DC-075): only the app's own log item, only its title, only to the app's exact title", () => {
    const url = `${REST}/content/users/${ME}/items/${ID}/update`;
    const c = ctx({ logItemId: ID });
    expect(assertLogAllowed(url, 'POST', { title: LOG_TITLE }, c)).toBe('retitle');
    expect(() => assertLogAllowed(url, 'POST', { title: LOG_TITLE }, ctx())).toThrow(BlockedRequest);
    expect(() => assertLogAllowed(`${REST}/content/users/${ME}/items/${ID2}/update`, 'POST', { title: LOG_TITLE }, c)).toThrow(BlockedRequest);
    expect(() => assertLogAllowed(`${REST}/content/users/someone_else/items/${ID}/update`, 'POST', { title: LOG_TITLE }, c)).toThrow(BlockedRequest);
    expect(() => assertLogAllowed(url, 'POST', { title: 'Parcels' }, c)).toThrow(/exact title/);
    for (const extra of ['tags', 'description', 'snippet', 'url', 'text', 'access', 'typeKeywords']) {
      expect(() => assertLogAllowed(url, 'POST', { title: LOG_TITLE, [extra]: 'x' }, c)).toThrow(/title and thumbnail only/);
    }
    expect(() => assertLogAllowed(url, 'GET', { title: LOG_TITLE }, c)).toThrow(BlockedRequest);
  });
  it('retitle (ADR 0012): may also carry a PNG thumbnail of 200 KB or less, and nothing else', () => {
    const url = `${REST}/content/users/${ME}/items/${ID}/update`;
    const c = ctx({ logItemId: ID });
    const png = (n = 100, type = 'image/png') => new File([new Uint8Array(n)], 'thumbnail.png', { type });
    expect(assertLogAllowed(url, 'POST', { title: LOG_TITLE, thumbnail: png() }, c)).toBe('retitle');
    expect(assertLogAllowed(url, 'POST', { title: LOG_TITLE, thumbnail: png(MAX_THUMB_BYTES) }, c)).toBe('retitle');
    expect(assertLogAllowed(url, 'POST', { title: LOG_TITLE, thumbnail: new Blob([new Uint8Array(5)], { type: 'image/png' }) }, c)).toBe('retitle');
    for (const bad of [png(100, 'image/jpeg'), png(100, 'image/gif'), png(100, ''), png(MAX_THUMB_BYTES + 1), png(0), 'iVBORw0KGgo=', 5, { size: 5, type: 'image/png' }]) {
      expect(() => assertLogAllowed(url, 'POST', { title: LOG_TITLE, thumbnail: bad as never }, c), String(bad)).toThrow(/PNG of 200 KB or less/);
    }
    expect(() => assertLogAllowed(url, 'POST', { thumbnail: png() }, c)).toThrow(/exact title/);
    expect(() => assertLogAllowed(url, 'POST', { title: LOG_TITLE, thumbnail: png(), access: 'public' }, c)).toThrow(/title and thumbnail only/);
    expect(() => assertLogAllowed(`${REST}/content/users/someone_else/items/${ID}/update`, 'POST', { title: LOG_TITLE, thumbnail: png() }, c)).toThrow(BlockedRequest);
    expect(() => assertLogAllowed(`${REST}/content/users/${ME}/items/${ID2}/update`, 'POST', { title: LOG_TITLE, thumbnail: png() }, c)).toThrow(BlockedRequest);
  });
  it('deleteLog (ADR 0012): only the app log item, as POST, with no parameters but f', () => {
    const url = `${REST}/content/users/${ME}/items/${ID}/delete`;
    const c = ctx({ logItemId: ID });
    expect(assertLogAllowed(url, 'POST', {}, c)).toBe('deleteLog');
    expect(assertLogAllowed(url, 'POST', { f: 'json' }, c)).toBe('deleteLog');
    for (const extra of ['permanentDelete', 'force', 'title', 'deleteProtected']) {
      expect(() => assertLogAllowed(url, 'POST', { [extra]: 'true' }, c), extra).toThrow(/takes no parameters/);
    }
    expect(() => assertLogAllowed(url, 'GET', {}, c)).toThrow(BlockedRequest);
    expect(() => assertLogAllowed(url, 'PUT', {}, c)).toThrow(BlockedRequest);
    expect(() => assertLogAllowed(url, 'POST', {}, ctx())).toThrow(BlockedRequest); // no log item held
    expect(() => assertLogAllowed(url, 'POST', {}, ctx({ self: null, logItemId: ID }))).toThrow(BlockedRequest);
    expect(() => assertLogAllowed(`${REST}/content/users/${ME}/items/${ID2}/delete`, 'POST', {}, c)).toThrow(BlockedRequest); // another id
    expect(() => assertLogAllowed(`${REST}/content/users/someone_else/items/${ID}/delete`, 'POST', {}, c)).toThrow(BlockedRequest); // another user
    expect(() => assertLogAllowed(`${REST}/content/users/${ME}/items/${ID}/unprotect`, 'POST', {}, c)).toThrow(BlockedRequest);
    expect(() => assertLogAllowed(`${REST}/content/users/${ME}/items/${ID}/protect`, 'POST', {}, c)).toThrow(BlockedRequest);
    expect(() => assertLogAllowed(`${REST}/content/users/${ME}/deleteItems`, 'POST', {}, c)).toThrow(BlockedRequest);
    expect(() => assertLogAllowed(`${SVC.replace('/rest/services/', '/rest/admin/services/')}/delete`, 'POST', {}, c)).toThrow(BlockedRequest); // not the service
  });
  it('blocks everything else: other layers, deletes, updates, item and group calls, odd urls', () => {
    const c = ctx();
    for (const [url, m] of [
      [`${SVC}/1/query`, 'GET'], [`${SVC}/0/deleteFeatures`, 'POST'], [`${SVC}/0/updateFeatures`, 'POST'], [`${SVC}/0/addFeatures`, 'POST'],
      [`${SVC.replace('/rest/services/', '/rest/admin/services/')}/deleteFromDefinition`, 'POST'],
      [`${SVC.replace('/rest/services/', '/rest/admin/services/')}/updateDefinition`, 'POST'],
      [`${REST}/content/users/${ME}/items/${ID}/delete`, 'POST'], [`${REST}/content/users/${ME}/items/${ID}/update`, 'POST'],
      [`${REST}/content/users/${ME}/items/${ID}/share`, 'POST'], [`${REST}/community/createGroup`, 'POST'],
      [`${OTHER_SVC}/0/query`, 'GET'], [`${SVC}/0/query?where=1=1`, 'GET'], [`http://services9.arcgis.com/x`, 'GET'], [`${SVC}/../Parcels/0/query`, 'GET'],
    ] as const) {
      expect(() => assertLogAllowed(url, m, {}, c), url).toThrow(BlockedRequest);
    }
  });
  it('recognises only service urls with the app log name', () => {
    expect(isLogServiceUrl(SVC)).toBe(true);
    expect(isLogServiceUrl(OTHER_SVC)).toBe(false);
    expect(isLogServiceUrl(SVC.replace('https:', 'http:'))).toBe(false);
    expect(isLogServiceUrl(`${SVC}/0`)).toBe(false);
    expect(isLogServiceUrl(SVC.replace('arcgis.com', 'evil.example'))).toBe(false);
  });
});

describe('find-or-create', () => {
  const make = (o: Partial<Parameters<typeof createFakeLogOrg>[0]> = {}) => {
    const fake = createFakeLogOrg({ self: ME, orgId: ORG, ...o });
    const log = createNudgeLog({ send: fake.send, portal: FAKE_PORTAL, orgId: ORG, writableOrgIds: [ORG], random: () => '0123abcd' });
    return { fake, log };
  };
  it('finds nothing and creates nothing on a read', async () => {
    const { fake, log } = make();
    expect(await log.find()).toBeNull();
    expect(new Map(await log.read())).toEqual(new Map());
    expect(fake.calls.map((c) => c.path)).toEqual(['/sharing/rest/portals/self', '/sharing/rest/search', `/sharing/rest/content/users/${ME}`]);
  });
  it('creates once: createService with the exact title, then addToDefinition; a second run finds it', async () => {
    const { fake, log } = make();
    const t = await log.create();
    expect(t).toMatchObject({ title: LOG_TITLE, owner: ME, reused: false });
    expect(fake.calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual([
      `/sharing/rest/content/users/${ME}/createService`, '/FakeOrg0000000000/arcgis/rest/admin/services/<log>/FeatureServer/addToDefinition',
      `/sharing/rest/content/users/${ME}/items/<id>/update`,
    ]);
    expect(await log.create()).toBe(t);
    const again = createNudgeLog({ send: fake.send, portal: FAKE_PORTAL, orgId: ORG, writableOrgIds: [ORG] });
    expect(await again.create()).toMatchObject({ reused: true, serviceUrl: t.serviceUrl });
    expect(fake.calls.filter((c) => c.path.endsWith('/createService'))).toHaveLength(1);
  });
  it('a second run straight after finds it through the content list when search lags', async () => {
    const { fake, log } = make({ searchLags: true });
    await log.create();
    const again = createNudgeLog({ send: fake.send, portal: FAKE_PORTAL, orgId: ORG, writableOrgIds: [ORG] });
    expect(await again.find()).toMatchObject({ reused: true });
    expect(fake.calls.filter((c) => c.path.endsWith('/createService'))).toHaveLength(1);
  });
  it('DC-075: sets the title after creating, since ArcGIS Online titles the item with the service name', async () => {
    const { fake, log } = make({ titleFromName: true });
    expect(await log.create()).toMatchObject({ title: LOG_TITLE });
    expect(fake.item?.title).toBe(LOG_TITLE);
    const upd = fake.calls.find((c) => c.path.endsWith('/update'));
    expect(upd?.params).toEqual(['title']);
  });
  it('DC-075: an existing log titled with its service name is retitled at the next create, never on a read', async () => {
    const { fake, log } = make({ exists: true, existingTitle: 'Decluttering_nudge_log_0000beef' });
    await log.find(); await log.read();
    expect(fake.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    const t = await log.create();
    expect(t).toMatchObject({ title: LOG_TITLE, reused: true });
    expect(fake.item?.title).toBe(LOG_TITLE);
    expect(fake.calls.filter((c) => c.path.endsWith('/update'))).toHaveLength(1);
    const again = createNudgeLog({ send: fake.send, portal: FAKE_PORTAL, orgId: ORG, writableOrgIds: [ORG] });
    await again.create();
    expect(fake.calls.filter((c) => c.path.endsWith('/update'))).toHaveLength(1); // already right: no second update
  });
  it('DC-075: a failed retitle does not stop the log from working', async () => {
    const { log } = make({ titleFromName: true, updateFails: true });
    const t = await log.create();
    expect(t.title).toMatch(/^Decluttering_nudge_log_/);
    expect(await log.record({ owner: 'amy', sentAt: 1, itemIds: [ID], credits: 1, sender: ME })).toBe(1);
  });
  it('finds a log titled with its service name (if ArcGIS Online ignores the title)', async () => {
    const { fake, log } = make({ titleFromName: true });
    await log.create();
    const again = createNudgeLog({ send: fake.send, portal: FAKE_PORTAL, orgId: ORG, writableOrgIds: [ORG] });
    expect(await again.find()).not.toBeNull();
  });
  it('ignores look-alikes: someone else\'s, untagged, wrong type or a different service', () => {
    const it0 = { id: ID, title: LOG_TITLE, owner: ME, type: 'Feature Service', tags: [LOG_TAG], url: SVC };
    expect(isAppLog(it0, ME)).toBe(true);
    expect(isAppLog({ ...it0, owner: 'other' }, ME)).toBe(false);
    expect(isAppLog({ ...it0, tags: [] }, ME)).toBe(false);
    expect(isAppLog({ ...it0, type: 'Table' }, ME)).toBe(false);
    expect(isAppLog({ ...it0, url: OTHER_SVC }, ME)).toBe(false);
    expect(isAppLog({ ...it0, title: 'My nudge log' }, ME)).toBe(false);
  });
  it('records adds and reads them back as latest per owner', async () => {
    const { fake, log } = make();
    await log.create();
    expect(await log.record({ owner: 'amy', sentAt: new Date('2026-01-01T00:00:00Z'), itemIds: [ID], credits: 1.234, sender: ME })).toBe(1);
    await log.record({ owner: 'amy', sentAt: new Date('2026-05-01T00:00:00Z'), itemIds: [ID2], credits: 2, sender: ME });
    await log.record({ owner: ME, sentAt: new Date('2026-03-01T00:00:00Z'), itemIds: [], credits: 0, sender: ME, test: true });
    const read = await log.read();
    expect(new Map(read)).toEqual(new Map([['amy', '2026-05-01T00:00:00.000Z'], [ME, '2026-03-01T00:00:00.000Z']]));
    // DC-096: the same read also gives the sends, without the test row.
    expect(read.sends).toEqual([
      { owner: 'amy', sentAt: '2026-01-01T00:00:00.000Z', itemIds: [ID], itemCount: 1, credits: 1.23 },
      { owner: 'amy', sentAt: '2026-05-01T00:00:00.000Z', itemIds: [ID2], itemCount: 1, credits: 2 },
    ]);
    expect(fake.rows[2]).toMatchObject({ owner: ME, item_count: 0, is_test: 1 });
    const writes = fake.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/applyEdits'));
    expect(writes.every((c) => c.params.join() === 'adds,rollbackOnFailure')).toBe(true);
  });
  it('record needs the table first', async () => {
    const { log } = make();
    await expect(log.record({ owner: 'amy', sentAt: 1, itemIds: [], credits: 0, sender: ME })).rejects.toThrow(/not set up/);
  });
  it('refuses to exist in an org that is not writable, and when the signed-in org changes', async () => {
    const fake = createFakeLogOrg({ self: ME, orgId: ORG });
    expect(() => createNudgeLog({ send: fake.send, portal: FAKE_PORTAL, orgId: ORG, writableOrgIds: [] })).toThrow(WritesDisabled);
    expect(() => createSessionNudgeLog(null, { portal: FAKE_PORTAL, orgId: ORG, writableOrgIds: 'other', send: fake.send })).toThrow(WritesDisabled);
    const log = createNudgeLog({ send: fake.send, portal: FAKE_PORTAL, orgId: 'another0000000001', writableOrgIds: ['another0000000001'] });
    await expect(log.find()).rejects.toThrow(WritesDisabled);
  });
});

describe('DC-096: reading the sends back', () => {
  const make = (rows: Record<string, unknown>[]) => {
    const fake = createFakeLogOrg({ self: ME, orgId: ORG, exists: true, rows });
    return { fake, log: createNudgeLog({ send: fake.send, portal: FAKE_PORTAL, orgId: ORG, writableOrgIds: [ORG] }) };
  };
  it('one read, GET only, gives latest-by-owner and the sends; test rows are left out of the sends only', async () => {
    const { fake, log } = make([
      { owner: 'amy', sent_at: 2000, item_ids: `${ID},${ID2}`, item_count: 2, credits: 5, is_test: 0 },
      { owner: ME, sent_at: 3000, item_ids: ID, item_count: 1, credits: 1, is_test: 1 },
    ]);
    await log.find();
    const before = fake.calls.length;
    const read = await log.read();
    const calls = fake.calls.slice(before);
    expect(calls).toHaveLength(1);
    expect(calls.every((c) => c.method === 'GET' && c.path.endsWith('/0/query'))).toBe(true);
    expect(fake.calls.some((c) => c.method !== 'GET')).toBe(false);
    expect(read).toBeInstanceOf(Map);
    expect(read.get(ME)).toBe(new Date(3000).toISOString());
    expect(read.sends).toEqual([{ owner: 'amy', sentAt: new Date(2000).toISOString(), itemIds: [ID, ID2], itemCount: 2, credits: 5 }]);
  });
  it('sendsOf skips junk: no owner, no time, test rows; bad ids are dropped and counts kept', () => {
    expect(sendsOf([
      { attributes: { owner: 'amy', sent_at: 1000, item_ids: `${ID}, nope ,${ID2}`, item_count: 5, credits: '2.5' } },
      { attributes: { owner: '', sent_at: 1 } }, { attributes: { owner: 'bob', sent_at: null } }, {},
      { attributes: { owner: 'cat', sent_at: 1, is_test: 1 } },
      { attributes: { owner: 'dan', sent_at: 1, item_ids: null, item_count: null, credits: null } },
    ])).toEqual([
      { owner: 'amy', sentAt: new Date(1000).toISOString(), itemIds: [ID, ID2], itemCount: 5, credits: 2.5 },
      { owner: 'dan', sentAt: new Date(1).toISOString(), itemIds: [], itemCount: 0, credits: 0 },
    ]);
  });
  it('readRows builds both views from one set of features', () => {
    const r = readRows([{ attributes: { owner: 'amy', sent_at: 1000, item_ids: ID, item_count: 1, credits: 1 } }]);
    expect(r).toBeInstanceOf(Map);
    expect(Object.keys(r)).toEqual([]);
    expect(r.get('amy')).toBe(new Date(1000).toISOString());
    expect(r.sends).toHaveLength(1);
  });
  it('no log: an empty read with no sends', async () => {
    const fake = createFakeLogOrg({ self: ME, orgId: ORG });
    const log = createNudgeLog({ send: fake.send, portal: FAKE_PORTAL, orgId: ORG, writableOrgIds: [ORG] });
    await log.find();
    const r = await log.read();
    expect(r.size).toBe(0);
    expect(r.sends).toEqual([]);
  });
});

describe('row building', () => {
  const base = { owner: 'amy', sentAt: new Date('2026-10-15T01:02:03Z'), itemIds: [ID, ID2, ID], credits: 3.14159, sender: ME };
  it('has exactly the log fields: no email address, no message body', () => {
    const r = buildRow({ ...base, email: 'amy@example.org', html: '<p>Hi</p>', subject: 'x' } as never);
    expect(Object.keys(r).sort()).toEqual([...LOG_FIELDS].sort());
    expect(JSON.stringify(r)).not.toMatch(/example\.org|<p>|Hi/);
    expect(r).toMatchObject({ owner: 'amy', sent_at: Date.parse('2026-10-15T01:02:03Z'), item_ids: `${ID},${ID2}`, item_count: 2, credits: 3.14, sender: ME, is_test: 0 });
  });
  it('rejects bad usernames, times and ids', () => {
    expect(() => buildRow({ ...base, owner: 'a b' })).toThrow();
    expect(() => buildRow({ ...base, owner: 'a,b' })).toThrow();
    expect(() => buildRow({ ...base, sender: '' })).toThrow();
    expect(() => buildRow({ ...base, sentAt: 'nope' })).toThrow();
    expect(() => buildRow({ ...base, itemIds: ['not-an-id'] })).toThrow();
  });
  it('caps the id list at the field length but keeps the full count', () => {
    const ids = Array.from({ length: 400 }, (_, i) => i.toString(16).padStart(32, '0'));
    const r = buildRow({ ...base, itemIds: ids });
    expect(String(r.item_ids).length).toBeLessThanOrEqual(8000);
    expect(r.item_count).toBe(400);
  });
  it('a test row is marked', () => {
    expect(buildRow({ ...base, test: true, itemIds: [] })).toMatchObject({ is_test: 1, item_count: 0, item_ids: '' });
  });
});

describe('reading into lastNotified, and the cooldown', () => {
  const SCAN = '2026-10-15T00:00:00.000Z';
  const isoAgo = (d: number) => new Date(Date.parse(SCAN) - d * 864e5).toISOString();
  const svc = (id: string, owner: string): Service => ({
    id, title: id, owner, created: isoAgo(900), modified: isoAgo(800), sizeMB: 100, access: 'private', isView: false, sourceId: null, usage: [], dependencies: [],
  });
  const data: Data = {
    org: { id: ORG, name: 'Org', urlKey: 'org', scannedAt: SCAN },
    owners: [
      { username: 'amy', fullName: 'Amy', disabled: false, thumbnail: null, lastNotified: null },
      { username: 'bob', fullName: 'Bob', disabled: false, thumbnail: null, lastNotified: isoAgo(10) },
      { username: 'cat', fullName: 'Cat', disabled: false, thumbnail: null, lastNotified: null },
    ],
    services: [svc(ID, 'amy'), svc(ID2, 'bob'), svc('c'.repeat(32), 'cat')],
  };
  it('latestByOwner keeps the latest per owner and skips junk', () => {
    const m = latestByOwner([
      { attributes: { owner: 'amy', sent_at: 1000 } }, { attributes: { owner: 'amy', sent_at: 3000 } }, { attributes: { owner: 'amy', sent_at: 2000 } },
      { attributes: { owner: '', sent_at: 1 } }, { attributes: { owner: 'bob', sent_at: null } }, {},
    ]);
    expect(m).toEqual(new Map([['amy', new Date(3000).toISOString()]]));
  });
  it('sets lastNotified to the later of the data and the log, and leaves the data alone otherwise', () => {
    const out = applyNudgeLog(data, new Map([['amy', isoAgo(3)], ['bob', isoAgo(50)], ['nobody', isoAgo(1)]]));
    expect(out.owners.map((o) => o.lastNotified)).toEqual([isoAgo(3), isoAgo(10), null]);
    expect(data.owners[0]!.lastNotified).toBeNull();
    expect(applyNudgeLog(data, new Map())).toBe(data);
    expect(applyNudgeLog(data, undefined)).toBe(data);
  });
  it('a logged owner is flagged and unticked by default; past six months they are not', () => {
    const out = applyNudgeLog(data, new Map([['amy', isoAgo(0)], ['cat', isoAgo(200)]]));
    const ev = evaluate(out, PRESETS.balanced);
    const by = new Map(ev.owners.map((o) => [o.owner.username, o]));
    expect(by.get('amy')).toMatchObject({ nudgedRecently: true, defaultTicked: false, nudgedDaysAgo: 0 });
    expect(by.get('cat')).toMatchObject({ nudgedRecently: false, defaultTicked: true });
    expect(nudgedRecently(out.owners[0]!, Date.parse(SCAN))).toBe(true);
  });
  it('withSend adds a send at once, never moving a date backwards', () => {
    const m = withSend(new Map([['amy', isoAgo(1)]]), 'amy', new Date(Date.parse(SCAN) - 5 * 864e5));
    expect(m.get('amy')).toBe(isoAgo(1));
    expect(withSend(null, 'bob', new Date(SCAN)).get('bob')).toBe(SCAN);
  });
});

describe('"send without a log" is remembered', () => {
  const mem = (): StorageLike => {
    const m = new Map<string, string>();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); }, key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
  };
  it('per org, under the app prefix, and can be changed later', () => {
    const s = mem();
    expect(getLogChoice(ORG, s)).toBeNull();
    setLogChoice(ORG, 'none', s);
    expect(getLogChoice(ORG, s)).toBe('none');
    expect(getLogChoice('other', s)).toBeNull();
    expect(s.key(0)).toMatch(/^decluttering:/);
    setLogChoice(ORG, 'log', s);
    expect(getLogChoice(ORG, s)).toBe('log');
  });
  it('blocked storage is harmless', () => {
    const bad = { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); } } as unknown as StorageLike;
    expect(getLogChoice(ORG, bad)).toBeNull();
    expect(() => setLogChoice(ORG, 'none', bad)).not.toThrow();
    expect(getLogChoice(ORG, null)).toBeNull();
  });
});

describe('the in-memory store', () => {
  beforeEach(() => clearNudgeLogs());
  it('keeps the log per org and tells listeners', () => {
    let n = 0;
    const off = onNudgeLogChange(() => { n++; });
    setNudgeLog(ORG, new Map([['amy', 'x']]));
    expect(getNudgeLog(ORG)?.get('amy')).toBe('x');
    expect(getNudgeLog('other')).toBeUndefined();
    off();
    setNudgeLog(ORG, new Map());
    expect(n).toBe(1);
  });
  it('DC-096: keeps the sends from a full read; a plain map (a send shown at once) keeps the sends it had', () => {
    expect(getNudgeSends(ORG)).toBeUndefined();
    setNudgeLog(ORG, readRows([{ attributes: { owner: 'amy', sent_at: 1000, item_ids: ID, item_count: 1, credits: 1 } }]));
    expect(getNudgeSends(ORG)).toHaveLength(1);
    setNudgeLog(ORG, withSend(getNudgeLog(ORG), 'bob', new Date(5000)));
    expect(getNudgeSends(ORG)).toHaveLength(1);
    expect(getNudgeLog(ORG)?.get('bob')).toBe(new Date(5000).toISOString());
  });
  it('DC-096: stays in memory: nothing goes into browser storage', () => {
    const writes: string[] = [];
    const spy = { setItem: (k: string) => { writes.push(k); }, getItem: () => null, removeItem: () => undefined, clear: () => undefined, key: () => null, length: 0 };
    const g = globalThis as unknown as { localStorage?: unknown; sessionStorage?: unknown };
    const prev = [g.localStorage, g.sessionStorage];
    g.localStorage = spy; g.sessionStorage = spy;
    try {
      setNudgeLog(ORG, readRows([{ attributes: { owner: 'amy', sent_at: 1000, item_ids: ID, item_count: 1, credits: 1 } }]));
      getNudgeSends(ORG); getNudgeLog(ORG);
    } finally { [g.localStorage, g.sessionStorage] = prev; }
    expect(writes).toEqual([]);
  });
});

describe('ADR 0012: labels, thumbnails and removal of the log', () => {
  const png = () => new File([new Uint8Array(64)], 'thumbnail.png', { type: 'image/png' });
  const make = (o: Partial<Parameters<typeof createFakeLogOrg>[0]> = {}, extra: { sendThumbnails?: boolean; loadThumbnail?: () => Promise<Blob | null> } = {}) => {
    const fake = createFakeLogOrg({ self: ME, orgId: ORG, ...o });
    const log = createNudgeLog({ send: fake.send, portal: FAKE_PORTAL, orgId: ORG, writableOrgIds: [ORG], random: () => '0123abcd', ...extra });
    return { fake, log };
  };
  const posts = (fake: ReturnType<typeof createFakeLogOrg>) => fake.calls.filter((c) => c.method === 'POST');

  it('creates the log with the announced labels: title, summary, description, tags', async () => {
    const { fake, log } = make();
    await log.create();
    expect(fake.creates).toHaveLength(1);
    const c = fake.creates[0]!;
    expect(c).toMatchObject({ title: LOG_TITLE, snippet: LOG_SNIPPET, description: LOG_DESCRIPTION, tags: `${LOG_TAG},Decluttering` });
    expect(LOG_SNIPPET).toBe('Who the Decluttering app nudged, and when. Private; safe to delete.');
    expect(LOG_DESCRIPTION).toContain('About > App data in your org');
    expect(LOG_DESCRIPTION).toContain('sooner than six months');
    expect(LOG_SNIPPET.length).toBeLessThan(250);
  });

  it('SEND_THUMBNAILS is on (DC-122); sendThumbnails: false still loads and sends none', async () => {
    expect(SEND_THUMBNAILS).toBe(true);
    let loads = 0;
    const { fake, log } = make({ titleFromName: true }, { sendThumbnails: false, loadThumbnail: async () => { loads++; return png(); } });
    await log.create();
    expect(loads).toBe(0);
    expect(fake.uploads).toEqual([]);
    expect(fake.calls.find((c) => c.path.endsWith('/update'))?.params).toEqual(['title']);
  });

  it('with thumbnails on, the title update carries a PNG: no extra write for a log that needs its title', async () => {
    const { fake, log } = make({ titleFromName: true }, { sendThumbnails: true, loadThumbnail: async () => png() });
    await log.create();
    expect(posts(fake).map((c) => c.path.replace(/.*\/(items|services)/, '$1'))).toHaveLength(3); // createService, addToDefinition, one update
    expect(fake.calls.find((c) => c.path.endsWith('/update'))?.params).toEqual(['thumbnail', 'title']);
    expect(fake.uploads).toEqual([{ path: `/sharing/rest/content/users/${ME}/items/<id>/update`, param: 'thumbnail', type: 'image/png', size: 64 }]);
  });

  it('with thumbnails on, a new log whose title was already right still gets one update, once', async () => {
    const { fake, log } = make({}, { sendThumbnails: true, loadThumbnail: async () => png() });
    await log.create();
    await log.create();
    expect(fake.calls.filter((c) => c.path.endsWith('/update'))).toHaveLength(1);
    expect(fake.uploads).toHaveLength(1);
  });

  it('with thumbnails on, a log found with the right title is left alone (no write)', async () => {
    const { fake, log } = make({ exists: true }, { sendThumbnails: true, loadThumbnail: async () => png() });
    await log.create();
    expect(posts(fake)).toEqual([]);
  });

  it('a thumbnail that cannot be loaded, or an update that is refused, does not stop the log', async () => {
    const a = make({ titleFromName: true }, { sendThumbnails: true, loadThumbnail: async () => null });
    expect(await a.log.create()).toMatchObject({ title: LOG_TITLE });
    expect(a.fake.uploads).toEqual([]);
    const b = make({ updateFails: true }, { sendThumbnails: true, loadThumbnail: async () => png() });
    await expect(b.log.create()).resolves.toMatchObject({ reused: false });
  });

  it('a thumbnail the guard refuses is never sent', async () => {
    const bad = new File([new Uint8Array(10)], 'x.jpg', { type: 'image/jpeg' });
    const { fake, log } = make({ titleFromName: true }, { sendThumbnails: true, loadThumbnail: async () => bad });
    await log.create(); // best effort: the blocked update is swallowed, the log still works
    expect(fake.calls.filter((c) => c.path.endsWith('/update'))).toEqual([]);
    expect(fake.uploads).toEqual([]);
  });

  describe('deleteLog', () => {
    it('re-reads the item, then posts the delete with no parameters, and forgets the log', async () => {
      const { fake, log } = make({ exists: true, rows: [{ owner: 'amy', sent_at: 1000, item_ids: ID, item_count: 1, credits: 1, is_test: 0 }] });
      await log.find();
      const before = fake.calls.length;
      expect(await log.deleteLog()).toBe('deleted');
      const calls = fake.calls.slice(before);
      expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
        'GET /sharing/rest/search',
        `POST /sharing/rest/content/users/${ME}/items/<id>/delete`,
      ]);
      expect(calls[1]!.params).toEqual([]);
      expect(fake.deleted).toBe(1);
      expect(fake.item).toBeNull();
      expect(log.table).toBeNull();
      expect(await log.find()).toBeNull();
      await expect(log.record({ owner: 'amy', sentAt: 1, itemIds: [], credits: 0, sender: ME })).rejects.toThrow(/not set up/);
      expect((await log.read()).size).toBe(0);
    });

    it('can create a fresh log afterwards', async () => {
      const { fake, log } = make({ exists: true });
      await log.find();
      await log.deleteLog();
      expect(await log.create()).toMatchObject({ reused: false });
      expect(fake.calls.filter((c) => c.path.endsWith('/createService'))).toHaveLength(1);
    });

    it('finds the item through the content list when search does not show it (a lagging index)', async () => {
      const { fake, log } = make({ searchLags: true });
      await log.create();
      const again = createNudgeLog({ send: fake.send, portal: FAKE_PORTAL, orgId: ORG, writableOrgIds: [ORG] });
      await again.find();
      expect(await again.deleteLog()).toBe('deleted');
    });

    it('does nothing and sends nothing when no log is held', async () => {
      const { fake, log } = make({ exists: true });
      await expect(log.deleteLog()).rejects.toThrow(/not set up/);
      expect(fake.calls).toEqual([]);
    });

    it('refuses, with no delete sent, when the item is no longer the app log (renamed, or its tag removed)', async () => {
      const edits: ((i: NonNullable<ReturnType<typeof createFakeLogOrg>['item']>) => void)[] = [
        (i) => { i.title = 'Parcels'; }, (i) => { i.tags = ['Decluttering']; }, (i) => { i.title = 'Decluttering nudge log 2'; }, (i) => { i.owner = 'someone_else'; }, (i) => { i.type = 'Table'; },
      ];
      for (const edit of edits) {
        const { fake, log } = make({ exists: true });
        await log.find();
        edit(fake.item!);
        await expect(log.deleteLog()).rejects.toThrow(/Refusing to delete/);
        expect(posts(fake)).toEqual([]);
        expect(log.table).not.toBeNull();
      }
    });

    it('refuses an item whose service url is not the one it holds', async () => {
      const fake = createFakeLogOrg({ self: ME, orgId: ORG, exists: true });
      const send: typeof fake.send = async (url, r) => {
        const res = await fake.send(url, r) as { results?: { url?: string }[] };
        if (url.endsWith('/search') && fake.calls.filter((c) => c.path.endsWith('/search')).length > 1 && res.results?.[0]) {
          return { results: [{ ...res.results[0], url: OTHER_SVC }] };
        }
        return res;
      };
      const log = createNudgeLog({ send, portal: FAKE_PORTAL, orgId: ORG, writableOrgIds: [ORG] });
      await log.find();
      await expect(log.deleteLog()).rejects.toThrow(/Refusing to delete/);
      expect(posts(fake)).toEqual([]);
    });

    it('says gone, and posts nothing, when the item was already removed', async () => {
      const { fake, log } = make({ exists: true });
      await log.find();
      fake.removeNow();
      expect(await log.deleteLog()).toBe('gone');
      expect(posts(fake)).toEqual([]);
      expect(log.table).toBeNull();
      expect(fake.deleted).toBe(0);
    });

    it('treats "does not exist" from the delete itself as gone, and any other refusal as an error that keeps the log held', async () => {
      const fake = createFakeLogOrg({ self: ME, orgId: ORG, exists: true });
      let mode: 'missing' | 'protected' = 'missing';
      const send: typeof fake.send = async (url, r) => {
        if (url.endsWith('/delete')) return { error: { code: 400, message: mode === 'missing' ? 'Item does not exist or is inaccessible.' : 'Item is protected from deletion' } };
        return fake.send(url, r);
      };
      const log = createNudgeLog({ send, portal: FAKE_PORTAL, orgId: ORG, writableOrgIds: [ORG] });
      await log.find();
      mode = 'protected';
      await expect(log.deleteLog()).rejects.toThrow(/protected/);
      expect(log.table).not.toBeNull();
      mode = 'missing';
      expect(await log.deleteLog()).toBe('gone');
      expect(log.table).toBeNull();
    });

    it('a delete-protected item is reported, not forced', async () => {
      const { fake, log } = make({ exists: true, deleteFails: true });
      await log.find();
      await expect(log.deleteLog()).rejects.toThrow(/protected/);
      expect(fake.item).not.toBeNull();
      expect(posts(fake).map((c) => c.params)).toEqual([[]]);
    });

    it('is unreachable in a read-only org: no log object, no request', () => {
      const fake = createFakeLogOrg({ self: ME, orgId: ORG, exists: true });
      expect(() => createNudgeLog({ send: fake.send, portal: FAKE_PORTAL, orgId: ORG, writableOrgIds: [] })).toThrow(WritesDisabled);
      expect(() => createNudgeLog({ send: fake.send, portal: FAKE_PORTAL, orgId: ORG, writableOrgIds: ['another0000000001'] })).toThrow(WritesDisabled);
      expect(fake.calls).toEqual([]);
    });
  });

  it('forgetNudgeLog drops the org cache and tells listeners', () => {
    clearNudgeLogs();
    setNudgeLog(ORG, readRows([{ attributes: { owner: 'amy', sent_at: 1000, item_ids: ID, item_count: 1, credits: 1 } }]));
    let n = 0;
    const off = onNudgeLogChange(() => { n++; });
    forgetNudgeLog(ORG);
    off();
    expect(getNudgeLog(ORG)).toBeUndefined();
    expect(getNudgeSends(ORG)).toBeUndefined();
    expect(n).toBe(1);
  });
});
