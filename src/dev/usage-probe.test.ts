import { describe, expect, it } from 'vitest';
import { assertProbeCall, MAX_IDS, parseIds, runProbe, VARIANTS, type ProbeCall } from './usage-probe';

const A = 'a'.repeat(32), B = 'b'.repeat(32);
const NOW = Date.UTC(2026, 9, 17, 12);
const DAY = 86_400_000;
const day = (n: number) => Date.UTC(2026, 9, 17) - n * DAY;

/** A fake org: records every call and answers search and usage. */
function fakeOrg(usage: (c: ProbeCall) => unknown = () => ({ data: [] })) {
  const calls: ProbeCall[] = [];
  const send = async (c: ProbeCall) => {
    calls.push(c);
    if (c.path === 'search') return { results: [
      { id: A, type: 'Feature Service', numViews: 40, lastViewed: NOW - 5 * 3_600_000, url: 'https://services1.arcgis.com/X/arcgis/rest/services/Footpaths/FeatureServer', title: 'Secret title', owner: 'someone' },
      { id: B, type: 'Web Map', numViews: 93, lastViewed: -1 },
    ] };
    return usage(c);
  };
  return { calls, send };
}

describe('DC-094 usage probe: read-only', () => {
  it('sends GET requests only, and only to search and portals/self/usage', async () => {
    const org = fakeOrg();
    await runProbe(org.send, [A, B], { now: NOW });
    expect(org.calls.length).toBe(1 + VARIANTS.length);
    for (const c of org.calls) {
      expect(c.method).toBe('GET');
      expect(['search', 'portals/self/usage']).toContain(c.path);
    }
  });

  it('refuses anything that is not a GET to an allowed path', () => {
    expect(() => assertProbeCall({ method: 'POST', path: 'portals/self/usage' })).toThrow(/GET only/);
    expect(() => assertProbeCall({ method: 'GET', path: 'community/users/me/report' })).toThrow(/not allowed/);
    expect(() => assertProbeCall({ method: 'GET', path: 'content/users/me/addItem' })).toThrow(/not allowed/);
    expect(() => assertProbeCall({ method: 'GET', path: 'search' })).not.toThrow();
  });

  it('an item the search cannot find still leads to GET reads only', async () => {
    const calls: unknown[] = [];
    const result = await runProbe(async (c) => { calls.push(c); return { results: [] }; }, [A], { now: NOW });
    expect(calls.every((c) => (c as ProbeCall).method === 'GET')).toBe(true);
    expect(result.items[0]?.found).toBe(false);
  });
});

describe('DC-094 usage probe: inputs and results', () => {
  it('parses ids from free text, drops junk and caps the list', () => {
    expect(parseIds(`${A}, ${A.toUpperCase()}\n${B} nope`)).toEqual({ ids: [A, B], rejected: 1, capped: false });
    const many = Array.from({ length: MAX_IDS + 5 }, (_, i) => i.toString(16).padStart(32, '0')).join(',');
    const p = parseIds(many);
    expect(p.ids.length).toBe(MAX_IDS);
    expect(p.capped).toBe(true);
  });

  it('builds the variants: item ids with no stype and with portal, service names with features, whole org portal', async () => {
    const org = fakeOrg();
    await runProbe(org.send, [A, B], { now: NOW, days: 30 });
    const usage = org.calls.filter((c) => c.path === 'portals/self/usage').map((c) => c.params);
    expect(usage.map((p) => [p.name, p.stype])).toEqual([[`${A},${B}`, undefined], [`${A},${B}`, 'portal'], ['Footpaths', 'features'], [undefined, 'portal']]);
    for (const p of usage) expect(p).toMatchObject({ vars: 'num', groupby: 'name', etype: 'svcusg', period: '1d', startTime: NOW - 30 * DAY, endTime: NOW });
  });

  it('caps the window at 150 days', async () => {
    const org = fakeOrg();
    await runProbe(org.send, [A], { now: NOW, days: 400 });
    expect(org.calls.find((c) => c.path === 'portals/self/usage')?.params.startTime).toBe(NOW - 150 * DAY);
  });

  it('summarises counts per item and per variant, and keeps no titles or owners', async () => {
    const org = fakeOrg((c) => {
      if (c.params.stype === 'portal' && c.params.name === undefined) return { data: [{ name: A, num: [[String(day(1)), '3']] }, { name: 'Some_Service', num: [] }] };
      if (c.params.stype === 'portal') return { error: { code: 400, message: 'Unable to process request' } };
      if (c.params.stype === 'features') return { data: [{ name: 'footpaths', num: [[String(day(0)), '12'], [String(day(2)), '0']] }] };
      return { data: [{ name: A, num: [[String(day(3)), '2'], [String(day(1)), '1'], [String(day(0)), '0']] }] };
    });
    const r = await runProbe(org.send, [A, B], { now: NOW });
    expect(r.items[0]).toEqual({ id: A, found: true, type: 'Feature Service', numViews: 40, lastViewedHoursAgo: 5, serviceName: 'Footpaths' });
    expect(r.items[1]).toMatchObject({ id: B, numViews: 93, lastViewedHoursAgo: null, serviceName: null });
    const v = Object.fromEntries(r.variants.map((x) => [x.key, x]));
    expect(v.item?.perItem).toEqual({ [A]: { total: 3, days: 2, lastDayAgo: 1 }, [B]: null });
    expect(v['item-portal']?.status).toBe('400 Unable to process request');
    expect(v.service?.perItem[A]).toEqual({ total: 12, days: 1, lastDayAgo: 0 });
    expect(v['all-portal']).toMatchObject({ rows: 2, idLikeRows: 1 });
    expect(JSON.stringify(r)).not.toMatch(/Secret title|someone/);
  });
});
