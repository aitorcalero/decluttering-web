import { describe, expect, it } from 'vitest';
import { createDemoOrg, DEMO_SERVICES, DEMO_USERNAME } from './demo-org';
import { getNudgeSends, readSeededLog, setNudgeLog } from '../log';

const NOW = Date.UTC(2026, 9, 10, 9);

type Page = { nextStart: number; results: { id: string; title: string; owner: string }[] };
async function allServices(demo: ReturnType<typeof createDemoOrg>): Promise<Page['results']> {
  const out: Page['results'] = [];
  for (let start = 1; start > 0;) {
    const r = await demo.org.request('search', { q: 'orgid:X AND typekeywords:"Hosted Service"', num: 100, start }) as Page;
    out.push(...r.results);
    start = r.nextStart;
  }
  return out;
}

describe('the demo org (DC-116)', () => {
  const demo = createDemoOrg({ speed: 0, now: () => NOW });

  it('has 437 hosted feature layers with unique, tidy titles and believable owners', async () => {
    const rows = await allServices(demo);
    expect(rows).toHaveLength(DEMO_SERVICES);
    expect(new Set(rows.map((r) => r.id)).size).toBe(DEMO_SERVICES);
    expect(new Set(rows.map((r) => r.title)).size).toBe(DEMO_SERVICES);
    expect(rows.filter((r) => / [0-9a-f]{4}$/.test(r.title) && !/ (19|20)\d\d$/.test(r.title) && !/ \d$/.test(r.title))).toEqual([]);
    const owners = demo.org.world.owners;
    expect(owners[0]).toMatchObject({ username: DEMO_USERNAME, fullName: 'Alex Ivanov' });
    expect(owners.length).toBeGreaterThan(15);
    expect(owners.every((o) => !/sim/.test(o.username) && /@(riverside\.example\.org|example\.org)$/.test(o.email ?? ''))).toBe(true);
    expect(demo.access).toMatchObject({ mode: 'admin', username: DEMO_USERNAME, usageReadable: true });
  });

  it('is the same every time (fixed seed)', async () => {
    const again = createDemoOrg({ speed: 0, now: () => NOW });
    expect((await allServices(again)).map((r) => r.id)).toEqual((await allServices(demo)).map((r) => r.id));
  });

  it('seeds past sends for "Since your nudges", with the test send left out', async () => {
    const log = await readSeededLog({ self: DEMO_USERNAME, orgId: demo.access.orgId, rows: demo.nudgeRows() });
    setNudgeLog(demo.access.orgId, log);
    const sends = getNudgeSends(demo.access.orgId);
    expect(sends?.length).toBeGreaterThan(3);
    expect(sends?.some((x) => x.owner === DEMO_USERNAME)).toBe(false);
  });

  it('rush() answers waiting calls at once and later ones on the next tick', async () => {
    const slow = createDemoOrg({ now: () => NOW });
    const t0 = performance.now();
    const waiting = slow.org.request('search', { q: 'orgid:X AND typekeywords:"Hosted Service"', num: 100, start: 1 });
    slow.org.rush();
    await waiting;
    await slow.org.request('portals/self/users', { num: 100, start: 1 });
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
