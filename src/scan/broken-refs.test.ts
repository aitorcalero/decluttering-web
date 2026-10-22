// DC-035a through the real pipeline, over the demo's made-up org (no network).
import { describe, expect, it } from 'vitest';
import { createDemoOrg } from '../demo/demo-org';
import { visibleBrokenRefs } from '../domain/broken-refs';
import { scanOrg } from './pipeline';
import { scanSession } from './session';
import type { RequestFn } from './types';

const NOW = Date.UTC(2026, 9, 10, 9);
const small = { speed: 0, now: () => NOW, services: 60, maps: 20, owners: 8 };
const opts = (orgId: string) => ({ portal: 'https://www.arcgis.com', orgId, now: () => NOW, sleep: async () => {}, random: () => 0 });

describe('the scan keeps references to layers that are gone', () => {
  it('finds the demo broken maps and not its decoy (other org and public Esri layers)', async () => {
    const d = createDemoOrg(small);
    const { data, depsKnown } = await scanOrg(d.org.request, opts(d.access.orgId));
    expect(depsKnown).toBe(true);
    const shown = visibleBrokenRefs(data, { depsComplete: true, mode: 'admin' });
    expect(shown.map((b) => b.title).sort()).toEqual(['Community Facilities Explorer', 'Flood Watch Viewer', 'Road Works Dashboard']);
    expect(shown.every((b) => b.missing.length === 1 && /^[0-9a-f]{32}$/.test(b.missing[0] as string))).toBe(true);
    expect(data.brokenRefs?.some((b) => b.title === 'Regional Overview Map')).toBe(false);
  });

  it('finds none in an org without broken maps, and never calls a service url', async () => {
    const d = createDemoOrg({ ...small, brokenMaps: 0 });
    const paths: string[] = [];
    const spy: RequestFn = (p, a, o) => { paths.push(p); return d.org.request(p, a, o); };
    const { data } = await scanOrg(spy, opts(d.access.orgId));
    expect(data.brokenRefs).toEqual([]);
    expect(paths.some((p) => /^https?:/.test(p) || /FeatureServer/i.test(p))).toBe(false);
  });

  it('a session scan carries the findings, and reuses them for maps that have not changed', async () => {
    const d = createDemoOrg(small);
    const first = await scanSession(d.org.request, opts(d.access.orgId));
    expect(first.data.brokenRefs).toHaveLength(3);
    const stamp = new Date(NOW + 1000).toISOString();
    const second = await scanSession(d.org.request, {
      ...opts(d.access.orgId),
      previous: { data: first.data, fetchedAt: { services: stamp, usage: stamp, users: stamp, dependencies: stamp }, savedAt: stamp, depsReadAt: Object.fromEntries((first.data.brokenRefs ?? []).map((b) => [b.id, stamp])) },
    });
    expect(second.data.brokenRefs?.map((b) => b.title).sort()).toEqual(first.data.brokenRefs?.map((b) => b.title).sort());
  });
});
