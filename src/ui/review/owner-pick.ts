// Review: picking one owner (every owner in the org, not only those on the list), and why the stale zone holds more
// layers than the list. Pure, so the counts are tested without a page.
import type { Data, EvaluateResult, Thresholds } from '../../domain/types';
import type { Dot, DotModel } from '../scan/dots';

export interface OwnerChoice { username: string; name: string; /** Layers on the list (families) under the rule. */ listed: number; /** All their layers (sources, views not counted). */ total: number }

/** Every owner with at least one layer, by name. `listed` counts their rows on the list (reachable and disabled owners). */
export function ownerChoices(data: Data, ev: Pick<EvaluateResult, 'owners' | 'unreachable'> | null): OwnerChoice[] {
  const names = new Map(data.owners.map((o) => [o.username, o.fullName || o.username]));
  const total = new Map<string, number>();
  for (const s of data.services) if (!s.isView) total.set(s.owner, (total.get(s.owner) ?? 0) + 1);
  const listed = new Map<string, number>();
  for (const g of [...(ev?.owners ?? []), ...(ev?.unreachable ?? [])]) listed.set(g.owner.username, (listed.get(g.owner.username) ?? 0) + g.rows.length);
  return [...total.entries()]
    .map(([username, n]) => ({ username, name: names.get(username) ?? username, listed: listed.get(username) ?? 0, total: n }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.username.localeCompare(b.username));
}

/** The dot model with only this owner's layers (the same model back when no owner is picked). */
export function modelForOwner(m: DotModel, owner: string | null): DotModel {
  if (!owner) return m;
  return { ...m, dots: m.dots.filter((d) => d.ownerId === owner) };
}

export interface ZoneBreakdown {
  /** Layers whose last used and last updated put them in the shaded zone. */
  zone: number;
  /** Of those, the ones the rule picks out (on the list). */
  listed: number;
  /** Of those not on the list, why (a layer can have more than one reason). */
  unknownUse: number; small: number; used: number;
  /** Not on the list for none of the above: content status (authoritative left out, deprecated left out). */
  other: number;
}

type ZoneDot = Pick<Dot, 'kind' | 'view' | 'daysSinceUpdate' | 'lastUsedDaysAgo' | 'useKnown' | 'sized' | 'sizeMB' | 'usedBy'>;

/**
 * The zone is drawn from two parts of the rule (last updated across, last used up); the list needs all of them. This counts
 * the layers in the zone, those on the list, and why the others are not.
 */
export function zoneBreakdown(dots: readonly ZoneDot[], t: Thresholds, depsKnown: boolean): ZoneBreakdown {
  const out: ZoneBreakdown = { zone: 0, listed: 0, unknownUse: 0, small: 0, used: 0, other: 0 };
  for (const d of dots) {
    if (d.view) continue;
    const inZone = d.daysSinceUpdate >= t.minDaysSinceUpdate && (t.minDaysSinceUse <= 0 || d.lastUsedDaysAgo === null || d.lastUsedDaysAgo >= t.minDaysSinceUse);
    if (!inZone) continue;
    out.zone++;
    if (d.kind === 'stale') { out.listed++; continue; }
    let why = false;
    if (t.minDaysSinceUse > 0 && d.useKnown === false) { out.unknownUse++; why = true; }
    if (d.sized && d.sizeMB < (t.minSizeMB || 0)) { out.small++; why = true; }
    if (depsKnown && d.usedBy > t.maxUsedBy) { out.used++; why = true; }
    if (!why) out.other++;
  }
  return out;
}
