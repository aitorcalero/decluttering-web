// DC-055 (size defaults that save credits) and DC-056 (counting today), updated for DC-083 ("last used"). Written test-first.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  PRESETS, SIZE_FLOOR_MB, SIZE_OPTIONS, evaluate, matchPreset, ruleLine, describe, whyLine,
  sizeChangeImpact, sizeReference, shouldAskAboutSize, smallItemsMessage,
} from './stale';
import { SUGGEST_SIZES, suggest, suggestSentence } from './suggest';
import { priorityOf } from './priority';
import type { Data, Service, Thresholds } from './types';

const SCAN = '2026-10-10T09:00:00Z';
const DAY = 86400000;
const isoAgo = (d: number) => new Date(Date.parse(SCAN) - d * DAY).toISOString();
let n = 0;
const svc = (o: Partial<Service> = {}): Service => ({
  id: `s${++n}`, title: `Service ${n}`, owner: 'amy', created: isoAgo(900), modified: isoAgo(800), sizeMB: 50,
  access: 'private', isView: false, sourceId: null, usage: [], dependencies: [], ...o,
});
const orgOf = (services: Service[]): Data => {
  const names = [...new Set(services.map((s) => s.owner))];
  return {
    org: { id: 'o', name: 'Org', urlKey: 'org', scannedAt: SCAN },
    owners: names.map((u) => ({ username: u, fullName: u, disabled: false, thumbnail: null, lastNotified: null })),
    services,
  };
};
const T: Thresholds = { minDaysSinceUse: 365, minDaysSinceUpdate: 365, maxUsedBy: 0, minSizeMB: 10 };

// ---------- DC-055: preset sizes ----------
test('presets carry a minimum size: Strict 10 MB, Balanced 15 MB, Gentle 20 MB; the floor is 10 MB', () => {
  assert.equal(PRESETS.strict.minSizeMB, 10);
  assert.equal(PRESETS.balanced.minSizeMB, 15);
  assert.equal(PRESETS.gentle.minSizeMB, 20);
  assert.equal(SIZE_FLOOR_MB, 10);
  for (const k of Object.keys(PRESETS) as (keyof typeof PRESETS)[]) assert.equal(matchPreset({ ...PRESETS[k] }), k);
  assert.equal(matchPreset({ ...PRESETS.balanced, minSizeMB: 0 }), 'custom');
  assert.equal(matchPreset({ ...PRESETS.balanced, minSizeMB: undefined }), 'custom'); // missing means any size
});

test('size options keep Any size and offer 10, 15, 20, 50 and 100 MB', () => {
  const v = SIZE_OPTIONS.map((o) => o.value);
  for (const want of [0, 10, 15, 20, 50, 100]) assert.ok(v.includes(want), `missing ${want}`);
  assert.deepEqual(v, [...v].sort((a, b) => a - b));
  assert.equal(SIZE_OPTIONS[0]?.label, 'Any size');
  assert.equal(SIZE_OPTIONS.find((o) => o.value === 15)?.label, '15 MB');
});

test('the size filter hides small known sizes but never unknown ones', () => {
  const data = orgOf([svc({ sizeMB: 5 }), svc({ sizeMB: 12 }), svc({ sizeMB: null })]);
  const ev = evaluate(data, { ...T, minSizeMB: 15 });
  assert.equal(ev.families.length, 1);
  assert.equal(ev.families[0]?.sizeKnown, false);
});

// ---------- DC-055: Suggested picks the minimum size from the data ----------
const fresh = (k: number) => Array.from({ length: k }, (_, i) => svc({ modified: isoAgo(10), owner: 'busy', usage: Array.from({ length: 11 }, (_, d) => [(i % 8) * 11 + d + 1, 1] as [number, number]) }));
const idle = (k: number, sizeMB: number | null, owner?: (i: number) => string) => Array.from({ length: k }, (_, i) => svc({ sizeMB, owner: owner ? owner(i) : `i${n}` }));

test('suggest: sizes run 10, 15, 20 MB and the suggestion never goes below 10 MB', () => {
  assert.deepEqual([...SUGGEST_SIZES], [10, 15, 20]);
  const s = suggest(orgOf([...idle(5, 50), ...fresh(55)]));
  assert.ok(s);
  assert.equal(s.thresholds.minSizeMB, 10);
  assert.equal(s.flagged, 5);
  // services under 10 MB are never part of a suggestion
  const tiny = suggest(orgOf([...idle(5, 50), ...idle(20, 5), ...fresh(35)]));
  assert.ok(tiny);
  assert.equal(tiny.flagged, 5);
  assert.ok((tiny.thresholds.minSizeMB ?? 0) >= 10);
});

test('suggest: more than the target at 10 MB steps the size up to 15, then 20 MB', () => {
  // N = 60 -> target 9, floor 4.5. At the gentlest rung: 6 at 50 MB, 4 at 17 MB, 4 at 12 MB.
  const at10 = [...idle(6, 50), ...idle(4, 17), ...idle(4, 12)];
  const s = suggest(orgOf([...at10, ...fresh(46)]));
  assert.ok(s);
  assert.equal(s.rung, 0);
  assert.equal(s.thresholds.minSizeMB, 20); // 14 > 9 at 10 MB, 10 > 9 at 15 MB, 6 at 20 MB
  assert.equal(s.flagged, 6);
  assert.equal(s.preset, 'gentle');         // the gentlest rung at 20 MB is exactly Gentle
  const mid = suggest(orgOf([...idle(6, 50), ...idle(6, 12), ...fresh(48)]));
  assert.ok(mid);
  assert.equal(mid.thresholds.minSizeMB, 15); // 12 > 9 at 10 MB; 6 at 15 MB is within target
});

test('suggest: a size step that would drop below half the target is not taken', () => {
  const s = suggest(orgOf([...idle(12, 12), ...fresh(48)])); // 12 > 9 at 10 MB, but 0 at 15 MB
  assert.ok(s);
  assert.equal(s.thresholds.minSizeMB, 10);
  assert.equal(s.flagged, 12);
});

test('suggest: too many owners at 10 MB steps the size up before falling back to a gentler rung', () => {
  // N = 300 -> target 45, floor 22.5. Gentlest rung: 30 owners with 50 MB items, 30 more with 12 MB items.
  const big = idle(30, 50, (i) => `big${i}`), small = idle(30, 12, (i) => `small${i}`);
  const s = suggest(orgOf([...big, ...small, ...fresh(240)]));
  assert.ok(s);
  assert.equal(s.rung, 0);
  assert.equal(s.thresholds.minSizeMB, 15);
  assert.equal(s.owners, 30);
  assert.equal(s.capped, false);
});

test('suggest: the 15% target is taken from services of at least 10 MB, so an org of mostly small services still gets one', () => {
  // 120 families, only 20 of them 10 MB or more: target 3 (15% of 20), not 18 (15% of 120)
  const s = suggest(orgOf([...idle(3, 50), ...fresh(17), ...idle(100, 2)]));
  assert.ok(s);
  assert.equal(s.flagged, 3);
  assert.equal(s.target, 3);
  assert.equal(s.total, 120);
  assert.equal(s.eligible, 20);
  // unknown sizes are eligible (they may well be big)
  assert.equal(suggest(orgOf([...idle(3, null), ...fresh(17), ...idle(100, 2)]))?.eligible, 20);
});

test('suggest: unknown sizes always count, whatever the size', () => {
  const s = suggest(orgOf([...idle(5, null), ...fresh(55)]));
  assert.ok(s);
  assert.equal(s.flagged, 5);
});

test('suggestSentence mentions the minimum size', () => {
  const s = suggest(orgOf([...idle(5, 50), ...fresh(55)]));
  assert.ok(s);
  assert.match(suggestSentence(s), /at least 10 MB/);
});

// ---------- DC-055: the "include small items" dialog ----------
test('sizeReference: the starting point\'s size; Suggested uses its own; Custom falls back to the 10 MB floor', () => {
  assert.equal(sizeReference('gentle'), 20);
  assert.equal(sizeReference('balanced'), 15);
  assert.equal(sizeReference('strict'), 10);
  assert.equal(sizeReference('suggested', 15), 15);
  assert.equal(sizeReference('suggested'), 10);
  assert.equal(sizeReference('custom'), 10);
});

test('shouldAskAboutSize: only when going down and below the reference', () => {
  assert.equal(shouldAskAboutSize(15, 0, 15), true);
  assert.equal(shouldAskAboutSize(15, 10, 15), true);
  assert.equal(shouldAskAboutSize(15, 20, 15), false); // going up
  assert.equal(shouldAskAboutSize(10, 10, 15), false); // no change
  assert.equal(shouldAskAboutSize(10, 15, 10), false);
  assert.equal(shouldAskAboutSize(20, 15, 10), false); // still at or above the reference
});

test('sizeChangeImpact counts the families, owners and credits a lower minimum adds (known sizes only)', () => {
  const data = orgOf([
    svc({ sizeMB: 50, owner: 'amy' }),
    svc({ sizeMB: 5, owner: 'amy' }), svc({ sizeMB: 2, owner: 'bob' }), svc({ sizeMB: 3, owner: 'cat' }),
    svc({ sizeMB: 0.5, owner: 'cat' }),
    svc({ sizeMB: null, owner: 'dan' }),                    // being measured: on the list either way
    svc({ sizeMB: 4, owner: 'amy', modified: isoAgo(5) }), // not stale for other reasons: never added
  ]);
  const imp = sizeChangeImpact(data, T, 0);
  assert.equal(imp.families, 4);
  assert.equal(imp.owners, 3);    // amy, bob, cat
  assert.equal(imp.newOwners, 2); // bob and cat were not on the list yet
  assert.ok(Math.abs(imp.sizeMB - 10.5) < 1e-9);
  assert.ok(Math.abs(imp.credits - 2.52) < 1e-9);
  assert.equal(imp.unmeasured, 1);
  assert.equal(imp.fromMB, 10);
  assert.equal(imp.toMB, 0);
  // to 3 MB: only 5 and 3 MB come in
  const three = sizeChangeImpact(data, T, 3);
  assert.equal(three.families, 2);
  // raising the minimum adds nothing
  assert.equal(sizeChangeImpact(data, T, 20).families, 0);
});

test('smallItemsMessage is plain about what a smaller minimum adds', () => {
  const msg = smallItemsMessage({ families: 23, owners: 9, newOwners: 4, credits: 4.2, sizeMB: 17.5, unmeasured: 0, fromMB: 10, toMB: 0, baseCredits: 148 });
  assert.equal(msg, 'This adds 23 small services from 9 owners, worth about 4 credits a month in total, 3% more than the 148 already on the list. Worth it for a tidy-up, but it adds names to the digest for little saving.');
  // The verdict follows the numbers (controller review): big next to the list, but thinly spread
  const thin = smallItemsMessage({ families: 97, owners: 24, newOwners: 19, credits: 41, sizeMB: 170, unmeasured: 0, fromMB: 15, toMB: 0, baseCredits: 148 });
  assert.equal(thin, 'This adds 97 small services from 24 owners, worth about 41 credits a month in total, 28% more than the 148 already on the list. A worthwhile saving, but spread thinly: on average each is worth under a credit a month.');
  const worth = smallItemsMessage({ families: 5, owners: 2, newOwners: 1, credits: 30, sizeMB: 125, unmeasured: 0, fromMB: 15, toMB: 10, baseCredits: 100 });
  assert.match(worth, /30% more than the 100 already on the list\. A worthwhile saving\.$/);

  const one = smallItemsMessage({ families: 1, owners: 1, newOwners: 0, credits: 0.3, sizeMB: 1.2, unmeasured: 3, fromMB: 10, toMB: 1 });
  assert.match(one, /^This adds 1 small service from 1 owner, worth less than 1 credit a month in total\./);
  assert.match(one, /3 services are still being measured/);
  assert.ok(!/delet|waste|must/i.test(msg + one));
});

// ---------- DC-056: today counts (DC-083: as last used) ----------
test('a service used only today is used today and is never flagged', () => {
  const today = svc({ usage: [[0, 3]] });
  const data = orgOf([today, svc()]);
  for (const t of [T, ...Object.values(PRESETS)]) assert.equal(evaluate(data, t).families.some((r) => r.source.id === today.id), false);
  const all = evaluate(data, { ...T, minDaysSinceUse: 0 }).families.find((r) => r.source.id === today.id);
  assert.ok(all);
  assert.equal(all.lastUsedDaysAgo, 0);
  assert.match(all.why, /^Last used today · /);
});

test('suggest counts today too: no rung flags a service used today', () => {
  const usedToday = Array.from({ length: 5 }, () => svc({ usage: [[0, 1]] }));
  assert.equal(suggest(orgOf([...usedToday, ...fresh(55)])), null);
});

test('a day many services share is use like any other (DC-057)', () => {
  const others = Array.from({ length: 4 }, () => svc({ usage: [[0, 1], [5, 1], [120, 1]] })); // every service used on 0, 5 and 120
  const mine = svc({ usage: [[200, 1]] });
  const shared = svc({ usage: [[120, 1]] });
  const ev = evaluate(orgOf([mine, shared, ...others]), { ...T, minDaysSinceUse: 180 });
  assert.equal(ev.families.some((r) => r.source.id === mine.id), true);
  assert.equal(ev.families.some((r) => r.source.id === shared.id), false); // the shared day still counts as use
});

// ---------- DC-083: wording says "last used" ----------
test('why-lines and rule lines talk about last use, and say how it was measured', () => {
  const row = { lastUsedDaysAgo: 240, useKnown: true, noUseRecorded: false, lastModified: isoAgo(400), usedBy: 0 };
  assert.match(whyLine(row), /^Last used 8 months ago · last updated /);
  assert.match(whyLine({ ...row, lastUsedDaysAgo: null }), /^No data requests in the last year · /);
  assert.match(whyLine({ ...row, noUseRecorded: true }), /^No use recorded since at least November 2022 · /);
  assert.equal(ruleLine(PRESETS.gentle), 'Last used more than a year ago · last updated more than a year ago · used by no maps or apps · at least 20 MB');
  const d = describe(PRESETS.balanced);
  assert.match(d, /nobody has used for more than 6 months/);
  assert.match(d, /at least 15 MB/);
  const r = svc({ sizeMB: 120 });
  const row2 = evaluate(orgOf([r]), T).families[0];
  assert.ok(row2);
  assert.match(priorityOf(row2, [row2]).reason, /no data requests in the last year/);
  for (const l of [whyLine(row), ruleLine(PRESETS.strict), d, describe(T)]) {
    assert.ok(!/quiet|usage call|script|bot|non-human|touched|days used/i.test(l), l);
  }
});
