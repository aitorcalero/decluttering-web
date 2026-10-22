import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Data } from '../domain/types';
import { PRESETS, evaluate } from '../domain/stale';
import { emailOwners, viewsContext } from './email-selection';
import { buildDigest, TONES } from '../ui/emails/digest';

const data = JSON.parse(readFileSync(new URL('../../public/demo/mock-small.json', import.meta.url), 'utf8')) as Data;
const t = { ...PRESETS.strict };

describe('review selection -> email owners', () => {
  const ev = evaluate(data, t, { depsKnown: true });
  const withRows = ev.owners.filter((o) => o.rows.length >= 1);

  it('carries only the ticked items, per owner, as links to the org’s own items', () => {
    expect(withRows.length).toBeGreaterThan(0);
    const o = withRows[0]!;
    const pick = o.rows[0]!.source.id;
    const owners = emailOwners({ data, thresholds: t, canSeeUsage: true, depsKnown: true, items: [pick] });
    const mine = owners.find((x) => x.username === o.owner.username)!;
    expect(mine.rows.map((r) => r.id)).toEqual([pick]);
    expect(mine.rows[0]!.url).toContain(data.org.urlKey);
    expect(owners.filter((x) => x.username !== o.owner.username).every((x) => x.rows.length === 0)).toBe(true);
    const d = buildDigest(mine, TONES.friendly, { admin: { name: 'A', username: 'a' }, org: data.org });
    expect(d.items).toBe(1);
    for (const r of o.rows.slice(1)) expect(d.html).not.toContain(r.source.id);
  });

  it('nobody ticked: every owner has no rows', () => {
    const owners = emailOwners({ data, thresholds: t, canSeeUsage: true, depsKnown: true, items: [] });
    expect(owners.every((o) => o.rows.length === 0)).toBe(true);
  });
});

describe('DC-083: views as context in the email, never claiming what was not checked (FB-15)', () => {
  const ref = Date.parse('2026-10-10T09:00:00Z');
  const row = (o: Partial<Parameters<typeof viewsContext>[0]> = {}) => ({ numViews: 585557, lastUsedDaysAgo: 220, useKnown: true, noUseRecorded: false, ...o });

  it('says the views and when it was last used, by month', () => {
    expect(viewsContext(row(), ref)).toBe("It's been viewed 585,557 times since it was published, but nobody has used it since March.");
    expect(viewsContext(row({ lastUsedDaysAgo: 400 }), ref)).toBe("It's been viewed 585,557 times since it was published, but nobody has used it since September 2025.");
    expect(viewsContext(row({ numViews: 1 }), ref)).toMatch(/^It's been viewed once since/);
  });

  it('no record, requests only, unknown and no usage access', () => {
    expect(viewsContext(row({ noUseRecorded: true, lastUsedDaysAgo: null }), ref)).toBe("It's been viewed 585,557 times since it was published, but no use has been recorded since at least November 2022.");
    expect(viewsContext(row({ lastUsedDaysAgo: null }), ref)).toMatch(/nobody has asked for its data in the last year\.$/);
    expect(viewsContext(row({ useKnown: false }), ref)).toBe("It's been viewed 585,557 times since it was published.");
    expect(viewsContext(row(), ref, false)).toBe("It's been viewed 585,557 times since it was published.");
  });

  it('no count, or none: no sentence', () => {
    expect(viewsContext(row({ numViews: null }), ref)).toBeNull();
    expect(viewsContext(row({ numViews: 0 }), ref)).toBeNull();
  });

  it('the digest says it on its own line, and the why line drops the views part', () => {
    const owners = emailOwners({ data, thresholds: t, canSeeUsage: true, depsKnown: true, items: evaluate(data, t).families.map((r) => r.source.id) });
    const o = owners.find((x) => x.rows.length)!;
    const r = o.rows[0]!;
    expect(r.why).toMatch(/views? all time$/);
    expect(r.context).toMatch(/^It's been viewed /);
    const d = buildDigest({ ...o, rows: [r] }, TONES.friendly, { admin: { name: 'A', username: 'a' }, org: data.org });
    expect(d.html).not.toMatch(/views? all time/);
    expect(d.html).toContain(r.context!.replace(/'/g, '&#39;'));
    expect(d.html).toMatch(/Last used \d+ months ago/);
  });
});

describe('DC-083: the demo mock carries lastViewed and numViews', () => {
  it('has stale rows under Balanced and Strict, from more than one owner, with lastViewed and numViews on every service', () => {
    for (const p of [PRESETS.balanced, PRESETS.strict]) expect(evaluate(data, p).totals.owners).toBeGreaterThan(1);
    expect(data.services.every((s) => s.lastViewed !== undefined && typeof s.numViews === 'number')).toBe(true);
  });
});
