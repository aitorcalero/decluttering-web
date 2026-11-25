import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Data } from '../domain/types';
import { PRESETS, evaluate } from '../domain/stale';
import { emailOwners, emailWhy, viewsContext } from './email-selection';
import { buildDigest, tone } from '../ui/emails/digest';
import { ensureLocale, getLocale, withLocale } from '../i18n';
import type { Row } from '../domain/types';

const TONES = { friendly: tone('friendly') };

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
    expect(r.why).not.toMatch(/views? all time/);
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

describe('FB-15: the email why line never says what was not checked', () => {
  const base = { lastUsedDaysAgo: 250, useKnown: true, noUseRecorded: false, lastModified: '2024-03-10T00:00:00Z', usedBy: 2, numViews: 99 } as unknown as Row;

  it('used-by only when every map and app was checked; never views, still checking or not checked', () => {
    expect(emailWhy(base, true, true)).toBe('Last used 8 months ago · last updated Mar 2024 · used by 2 maps or apps');
    expect(emailWhy(base, true, false)).toBe('Last used 8 months ago · last updated Mar 2024');
    expect(emailWhy({ ...base, usedBy: 0 } as Row, true, true)).toMatch(/no maps or apps use it$/);
    expect(emailWhy(base, false, false)).toBe('Last updated Mar 2024');
    for (const deps of [true, false]) expect(emailWhy(base, true, deps)).not.toMatch(/still checking|not checked|views/i);
  });
});

describe('owner emails in another language than the app', () => {
  beforeAll(async () => { await ensureLocale('es'); });
  const ref = Date.parse('2026-10-10T09:00:00Z');

  it('writes the why line, the views sentence and the tip in Spanish, and leaves the app in English', () => {
    const r = { lastUsedDaysAgo: 250, useKnown: true, noUseRecorded: false, lastModified: '2024-03-10T00:00:00Z', usedBy: 1, numViews: 1500 } as unknown as Row;
    expect(withLocale('es', () => emailWhy(r, true, true))).toBe('Último uso hace 8 meses · última actualización mar 2024 · usada por 1 mapa o aplicación');
    expect(withLocale('es', () => viewsContext(r, ref))).toBe('Se ha visualizado 1500 veces desde que se publicó, pero nadie la ha usado desde febrero.');
    expect(withLocale('es', () => viewsContext({ ...r, noUseRecorded: true }, ref))).toMatch(/desde al menos noviembre de 2022\.$/);
    const all = evaluate(data, t).families.map((x) => x.source.id);
    const owners = emailOwners({ data, thresholds: t, canSeeUsage: true, depsKnown: true, items: all }, 'es');
    const rows = owners.flatMap((o) => o.rows);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((x) => /^(Último uso|Sin uso|Sin solicitudes|Última actualización)/.test(x.why))).toBe(true);
    expect(rows.filter((x) => x.tidy).every((x) => x.tidy!.startsWith('Consejo:'))).toBe(true);
    expect(getLocale()).toBe('en');
    expect(emailOwners({ data, thresholds: t, canSeeUsage: true, depsKnown: true, items: all }).flatMap((o) => o.rows)[0]!.why).toMatch(/^(Last used|No use|No data|Last updated)/);
  });
});
