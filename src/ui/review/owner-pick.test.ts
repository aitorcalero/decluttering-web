import { describe, expect, it } from 'vitest';
import { modelForOwner, ownerChoices, zoneBreakdown } from './owner-pick';
import type { Data, Service } from '../../domain/types';
import type { DotModel } from '../scan/dots';

const svc = (id: string, owner: string, o: Partial<Service> = {}): Service => ({
  id, title: id, owner, created: '2020-01-01', modified: '2020-01-01', sizeMB: 10, access: 'private', isView: false, sourceId: null, usage: [], dependencies: [], ...o,
});
const data = {
  org: { id: 'o', name: 'O', urlKey: 'o', scannedAt: '2026-01-01' },
  owners: [{ username: 'b', fullName: 'Bea', disabled: false, thumbnail: null, lastNotified: null }, { username: 'a', fullName: 'Ana', disabled: false, thumbnail: null, lastNotified: null }],
  services: [svc('1', 'a'), svc('2', 'a'), svc('3', 'b'), svc('4', 'c'), svc('v', 'a', { isView: true, sourceId: '1' })],
} as Data;

describe('ownerChoices', () => {
  it('lists every owner with a layer, by name, with layers on the list and in all (views not counted)', () => {
    const ev = { owners: [{ owner: { username: 'a' }, rows: [{}] }], unreachable: [{ owner: { username: 'b' }, rows: [{}, {}] }] } as never;
    expect(ownerChoices(data, ev)).toEqual([
      { username: 'a', name: 'Ana', listed: 1, total: 2 },
      { username: 'b', name: 'Bea', listed: 2, total: 1 },
      { username: 'c', name: 'c', listed: 0, total: 1 }, // no profile: the username
    ]);
  });
  it('works before the rule is evaluated', () => {
    expect(ownerChoices(data, null).map((o) => o.listed)).toEqual([0, 0, 0]);
  });
});

describe('modelForOwner', () => {
  const m = { dots: [{ id: '1', ownerId: 'a' }, { id: '3', ownerId: 'b' }] } as unknown as DotModel;
  it('keeps only that owner’s dots, and the same model when no owner is picked', () => {
    expect(modelForOwner(m, 'b').dots.map((d) => d.id)).toEqual(['3']);
    expect(modelForOwner(m, null)).toBe(m);
  });
});

describe('zoneBreakdown', () => {
  const t = { minDaysSinceUse: 730, minDaysSinceUpdate: 730, maxUsedBy: 0, minSizeMB: 10 };
  const d = (o: object) => ({ kind: 'fine', daysSinceUpdate: 900, lastUsedDaysAgo: null, useKnown: true, sized: true, sizeMB: 50, usedBy: 0, ...o }) as never;
  it('counts the zone, the list, and why the rest are not on it', () => {
    const b = zoneBreakdown([
      d({ kind: 'stale' }),
      d({ useKnown: false }), // no use recorded: last use unknown past a year
      d({ useKnown: false, sizeMB: 2 }), // two reasons
      d({ usedBy: 3 }),
      d({}), // in the zone, none of the reasons: content status
      d({ daysSinceUpdate: 100 }), // updated recently: not in the zone
      d({ lastUsedDaysAgo: 30 }), // used recently: not in the zone
      d({ kind: 'stale', view: true }), // views are their source's
    ], t, true);
    expect(b).toEqual({ zone: 5, listed: 1, unknownUse: 2, small: 1, used: 1, other: 1 });
  });
  it('does not blame maps and apps while they are still being read, nor last use when the rule skips it', () => {
    expect(zoneBreakdown([d({ usedBy: 3 })], t, false)).toMatchObject({ used: 0, other: 1 });
    expect(zoneBreakdown([d({ useKnown: false, lastUsedDaysAgo: 5 })], { ...t, minDaysSinceUse: 0 }, true)).toMatchObject({ zone: 1, unknownUse: 0 });
  });
});
