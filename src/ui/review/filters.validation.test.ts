// DC-084, updated for DC-083: the review's filter wording and wiring, and the scan dot map's rule, checked against what they say.
// Vitest runs in node here (no DOM), so the Lit components are not mounted: what dc-review.ts does with
// `canSeeUsage` (effective()) is reproduced through the public domain calls it makes. The DOM wiring of each
// dc-filters control is covered by e2e/filters.spec.ts. Findings: docs/research/filter-validation.md.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LAST_USED_OPTIONS, PRESETS, UPDATE_OPTIONS, evaluate } from '../../domain/stale';
import { LADDER, suggest } from '../../domain/suggest';
import type { Data, Owner, Service, Thresholds } from '../../domain/types';
import { includedRows, itemOn, optionsWith, quickWinsOnly, sayRule, sayWhy, selectionOf, sumSvc } from './helpers';
import { SCAN_THRESHOLDS, buildDots, dotWhy, withSmallFloor } from '../scan/dots';

const SCAN = '2026-10-10T09:00:00Z';
const DAY = 86400000;
const isoAgo = (d: number) => new Date(Date.parse(SCAN) - d * DAY).toISOString();
let seq = 0;
const svc = (o: Partial<Service> = {}): Service => {
  seq++;
  return {
    id: `u${seq}`, title: `Layer ${seq}`, owner: 'amy', created: isoAgo(900), modified: isoAgo(800), sizeMB: 50,
    access: 'private', isView: false, sourceId: null, usage: [], lastViewed: null, dependencies: [], ...o,
  };
};
const owner = (username: string, o: Partial<Owner> = {}): Owner => ({ username, fullName: username.toUpperCase(), disabled: false, thumbnail: null, lastNotified: null, ...o });
const org = (services: Service[], owners: Owner[]): Data => ({ org: { id: 'o', name: 'Org', urlKey: 'org', scannedAt: SCAN }, owners, services });
const usedDays = (k: number): [number, number][] => Array.from({ length: k }, (_, i) => [i, 1] as [number, number]);

/** What DcReview.effective() evaluates without usage access: the last-used rule is off (0). */
const effective = (t: Thresholds, canSeeUsage: boolean): Thresholds => (canSeeUsage ? t : { ...t, minDaysSinceUse: 0 });
/** A row as the why line needs it. */
const why = (o: { lastUsedDaysAgo?: number | null; usedBy?: number; noUseRecorded?: boolean; useKnown?: boolean; numViews?: number | null } = {}) =>
  ({ lastUsedDaysAgo: null, usedBy: 0, noUseRecorded: false, useKnown: true, numViews: null, lastModified: isoAgo(400), ...o });

describe('no usage access (canSeeUsage false)', () => {
  it('usage is ignored and every other filter still applies', () => {
    const data = org([
      svc({ title: 'busy', usage: usedDays(60) }),
      svc({ title: 'recent', usage: usedDays(60), modified: isoAgo(30) }),
      svc({ title: 'small', usage: usedDays(60), sizeMB: 2 }),
    ], [owner('amy')]);
    const titles = (t: Thresholds) => evaluate(data, t).families.map((r) => r.source.title);
    expect(titles(effective(PRESETS.balanced, true))).toEqual([]);
    expect(titles(effective(PRESETS.balanced, false))).toEqual(['busy']);
  });

  it('the rule in words leaves usage out, for each preset', () => {
    expect(sayRule(PRESETS.gentle, false)).toBe(
      "We pick out layers that were last updated more than a year ago, where no maps or apps use it and it is at least 20 MB. Usage isn't available with your access, so it isn't part of the rule.");
    expect(sayRule(PRESETS.strict, false, true)).toBe(
      "We pick out your layers that were last updated more than 3 months ago, where at most 2 maps or apps use it and it is at least 10 MB. Usage isn't available with your access, so it isn't part of the rule.");
    expect(sayRule({ ...PRESETS.balanced, minSizeMB: 0 }, false)).not.toMatch(/MB/);
    expect(sayRule({ ...PRESETS.balanced, minSizeMB: 1024 }, false)).toContain('at least 1 GB');
    for (const p of Object.values(PRESETS)) expect(sayRule(p, false)).not.toMatch(/data request|days used|last used|nobody has used/);
  });

  it('Balanced without usage says "at most 1 map or app uses it"', () => {
    expect(sayRule(PRESETS.balanced, false)).toContain('at most 1 map or app uses it');
  });

  it('the why line leaves usage out and keeps used-by and views', () => {
    expect(sayWhy(why({ lastUsedDaysAgo: 40, usedBy: 1 }), false)).toBe('Last updated Sep 2025 · used by 1 map or app');
    expect(sayWhy(why({ numViews: 12 }), false)).toBe('Last updated Sep 2025 · no maps or apps use it · 12 views all time');
  });
});

describe('the rule in words, with usage', () => {
  it('sayRule is describe() reworded for the admin and the member', () => {
    expect(sayRule(PRESETS.balanced, true)).toBe(
      'We pick out layers nobody has used for more than 6 months, last updated more than 6 months ago, used by at most 1 map or app, and at least 15 MB.');
    expect(sayRule(PRESETS.gentle, true, true)).toMatch(/^We pick out your layers nobody has used for more than a year, /);
  });

  it('the why line while maps and apps are being read says so instead of a used-by number, and keeps the views', () => {
    const row = why({ lastUsedDaysAgo: 240, numViews: 585557 });
    expect(sayWhy(row, true, false)).toBe('Last used 8 months ago · last updated Sep 2025 · used by: still checking… · 585,557 views all time');
    expect(sayWhy(row, true, false, true)).toBe('Last used 8 months ago · last updated Sep 2025 · used by: not checked · 585,557 views all time');
    expect(sayWhy(row, true)).toBe('Last used 8 months ago · last updated Sep 2025 · no maps or apps use it · 585,557 views all time');
  });

  it('the unknown and no-record lines (research 7.2)', () => {
    expect(sayWhy(why({ useKnown: false }), true)).toBe("Last used: unknown (we couldn't read all of its use) · last updated Sep 2025 · no maps or apps use it");
    expect(sayWhy(why({ noUseRecorded: true }), true)).toBe('No use recorded since at least November 2022 · last updated Sep 2025 · no maps or apps use it');
    expect(sayWhy(why({ lastUsedDaysAgo: 0 }), true)).toMatch(/^Last used today · /);
  });
});

describe('owners: ticks and the figures the header shows', () => {
  const data = org([svc({ owner: 'amy' }), svc({ owner: 'amy' }), svc({ owner: 'bob' }), svc({ owner: 'dee' })], [
    owner('amy'), owner('bob', { lastNotified: isoAgo(30) }), owner('dee', { disabled: true }),
  ]);
  const ev = evaluate(data, PRESETS.balanced);

  it('a recently nudged owner starts unticked; everyone else ticked; disabled owners are not offered', () => {
    const none = new Map<string, boolean>();
    const sel = selectionOf(ev.owners, none);
    expect(sel.owners).toEqual(['amy']);
    expect(sel.items).toHaveLength(2);
    expect(ev.owners.map((o) => o.owner.username).sort()).toEqual(['amy', 'bob']);
    const bob = ev.owners.find((o) => o.owner.username === 'bob')!;
    expect(bob.rows.every((r) => !itemOn(none, bob, r))).toBe(true);
    expect(includedRows(new Map([[bob.rows[0]!.source.id, true]]), bob)).toHaveLength(1); // an explicit tick wins
  });

  it('the header service count (sum over owners) equals evaluate totals, and leaves out disabled owners', () => {
    expect(ev.owners.reduce((n, o) => n + sumSvc(o.rows), 0)).toBe(ev.totals.services);
    expect(ev.totals.services).toBe(3);
    expect(ev.totals.unreachableFamilies).toBe(1);
  });
});

describe('scan dot map rule', () => {
  const found = (d: Data) => d.services.map((s) => ({ id: s.id, title: s.title, owner: s.owner }));
  const sized = (d: Data) => new Map(d.services.filter((s) => s.sizeMB !== null).map((s) => [s.id, s.sizeMB as number]));
  const dataOf = () => org([
    svc({ owner: 'amy', sizeMB: 40 }), svc({ owner: 'amy', sizeMB: 1 }), svc({ owner: 'bob', usage: usedDays(10) }),
    svc({ owner: 'dee', sizeMB: 80 }), svc({ owner: 'bob', sizeMB: null }),
  ], [owner('amy'), owner('bob'), owner('dee', { disabled: true })]);

  it('the dot map judges with Balanced', () => {
    expect(SCAN_THRESHOLDS).toEqual(PRESETS.balanced);
  });

  it('its totals are the review totals under Balanced (reachable owners only)', () => {
    const d = dataOf();
    const m = buildDots({ found: found(d), sized: sized(d), data: d, depsKnown: true });
    const T = evaluate(d, PRESETS.balanced).totals;
    expect(m.stats).toMatchObject({ staleServices: T.services, credits: T.credits, sizeMB: T.sizeMB });
  });

  it('a disabled owner\'s stale item stays a stale dot, outside the stale total, and its tip says why (DC-085)', () => {
    const d = dataOf();
    const m = buildDots({ found: found(d), sized: sized(d), data: d, depsKnown: true });
    const staleDots = m.dots.filter((x) => x.kind === 'stale');
    expect(staleDots).toHaveLength(3); // amy 40 MB, dee 80 MB, bob unmeasured
    expect(m.stats.staleServices).toBe(2);
    const dee = staleDots.filter((x) => x.owner === 'DEE');
    expect(dee).toHaveLength(1);
    expect(dotWhy(dee[0]!)).toContain("Owner can't be emailed: their account is disabled");
    expect(staleDots.filter((x) => x.owner !== 'DEE').every((x) => !dotWhy(x).includes('disabled'))).toBe(true);
  });

  it('LIMITATION: the dot map stays on Balanced while the review starts on Suggested, so the numbers can differ', () => {
    // An org where Suggested is not Balanced: 15 stale families from 15 owners, last used and updated 100 days ago.
    const services = [
      ...Array.from({ length: 15 }, (_, i) => svc({ owner: `p${i}`, modified: isoAgo(100), lastViewed: isoAgo(100) })),
      ...Array.from({ length: 85 }, (_, i) => svc({ owner: `f${i}`, modified: isoAgo(5), usage: usedDays(1) })),
    ];
    const d = org(services, [...new Set(services.map((s) => s.owner))].map((u) => owner(u)));
    const s = suggest(d);
    expect(s).not.toBeNull();
    expect(s!.preset).not.toBe('balanced');
    const m = buildDots({ found: found(d), sized: sized(d), data: d, depsKnown: true });
    expect(m.stats.staleServices).toBe(0);
    expect(evaluate(d, s!.thresholds).totals.services).toBe(15);
  });

  it('the small-layer display floor never hides a stale, in-zone or unmeasured dot', () => {
    const d = org([
      svc({ title: 'tiny stale', sizeMB: 1, owner: 'amy' }),               // stale only if size passes: 1 MB < 15, so fine
      svc({ title: 'tiny used', sizeMB: 1, usage: usedDays(10) }),
      svc({ title: 'unmeasured', sizeMB: null, usage: usedDays(10) }),
    ], [owner('amy')]);
    const m = buildDots({ found: found(d), sized: sized(d), data: d, depsKnown: true }, { ...PRESETS.balanced, minSizeMB: 0 });
    const { model, hidden } = withSmallFloor(m, { floorMB: 3, show: false });
    const kept = model.dots.map((x) => x.title).sort();
    expect(kept).toEqual(['tiny stale', 'unmeasured']);
    expect(hidden.count).toBe(1);
  });
});

describe('Quick wins only is the truth for what is shown, counted and sent (DC-085)', () => {
  const demo = JSON.parse(readFileSync(new URL('../../../public/demo/mock-small.json', import.meta.url), 'utf8')) as Data;
  const ev = evaluate(demo, PRESETS.strict);
  const hasMix = ev.owners.some((o) => o.rows.some((r) => r.priority !== 'start'));

  it('the demo has hidden rows to test with', () => { expect(hasMix).toBe(true); });

  it('keeps only Quick win rows, drops owners with none, and recounts credits, unmeasured and startCount', () => {
    const q = quickWinsOnly(ev.owners);
    expect(q.length).toBe(ev.owners.filter((o) => o.startCount > 0).length);
    for (const o of q) {
      expect(o.rows.every((r) => r.priority === 'start')).toBe(true);
      expect(o.startCount).toBe(o.rows.length);
      expect(o.credits).toBeCloseTo(o.rows.reduce((a, r) => a + r.credits, 0));
      expect(o.unmeasured).toBe(o.rows.filter((r) => !r.sizeKnown).length);
    }
  });

  it('the selection (what the action bar and Emails step get) holds only visible items, and ticks come back when it is off', () => {
    const all = new Map<string, boolean>(ev.owners.flatMap((o) => o.rows.map((r) => [r.source.id, true] as [string, boolean])));
    const full = selectionOf(ev.owners, all);
    const quick = selectionOf(quickWinsOnly(ev.owners), all);
    const hidden = ev.owners.flatMap((o) => o.rows).filter((r) => r.priority !== 'start').map((r) => r.source.id);
    expect(quick.items.some((id) => hidden.includes(id))).toBe(false);
    expect(quick.items.length).toBeLessThan(full.items.length);
    expect(quick.services).toBeLessThan(full.services);
    expect(selectionOf(ev.owners, all)).toEqual(full); // the ticks themselves were never changed
  });
});

describe('dropdown options for values the lists do not offer (DC-085, DC-083 keys)', () => {
  const labelsOf = (key: Parameters<typeof optionsWith>[0], list: Parameters<typeof optionsWith>[1], v: number) =>
    optionsWith(key, list, v).map((o) => o.label);

  it('a hand-edited 120 days last used reads "4 months", placed in order', () => {
    expect(labelsOf('minDaysSinceUse', LAST_USED_OPTIONS, 120)).toEqual(['3 months', '4 months', '6 months', '9 months', '1 year', '2 years']);
    expect(labelsOf('minDaysSinceUse', LAST_USED_OPTIONS, 45)).toContain('45 days');
    expect(labelsOf('minDaysSinceUse', LAST_USED_OPTIONS, 1095)).toContain('3 years');
  });
  it('the update list offers 9 months itself now', () => {
    expect(labelsOf('minDaysSinceUpdate', UPDATE_OPTIONS, 270)).toEqual(['3 months', '6 months', '9 months', '1 year', '2 years', '3 years']);
  });
  it('a value already offered leaves the list alone', () => {
    expect(optionsWith('minDaysSinceUse', LAST_USED_OPTIONS, 180)).toBe(LAST_USED_OPTIONS);
    expect(optionsWith('minDaysSinceUpdate', UPDATE_OPTIONS, 270)).toBe(UPDATE_OPTIONS);
  });
  it('every Suggested rung is an option the lists already offer', () => {
    for (const [used, upd] of LADDER) {
      expect(optionsWith('minDaysSinceUse', LAST_USED_OPTIONS, used)).toBe(LAST_USED_OPTIONS);
      expect(optionsWith('minDaysSinceUpdate', UPDATE_OPTIONS, upd)).toBe(UPDATE_OPTIONS);
    }
  });
});
