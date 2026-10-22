import type { OwnerGroup, Row } from '../../domain/types';

export const OTHER_ID = '__other';
export const TOP_N = 10;

export interface SankeyOwner {
  id: string; label: string; rows: Row[]; credits: number; services: number;
  kind: 'owner'; other?: boolean; count?: number;
}
export interface SankeyLink { source: string; target: 'clear' | 'risk'; value: number; owner: string }
export interface SankeyShape {
  owners: SankeyOwner[];
  links: SankeyLink[];
  totals: { clear: { credits: number; services: number }; risk: { credits: number; services: number } };
}

const svcCount = (r: Row): number => 1 + r.views.length;
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/** Top N owners plus an "Other owners" node, and owner -> clear/risk links valued in credits. */
export function shapeSankey(groups: OwnerGroup[], topN = TOP_N): SankeyShape {
  const mk = (rows: Row[], credits: number) => ({ rows, credits, services: sum(rows.map(svcCount)) });
  const owners: SankeyOwner[] = groups.slice(0, topN).map((g) => ({
    id: g.owner.username, label: g.owner.fullName, kind: 'owner', ...mk(g.rows, g.credits),
  }));
  const rest = groups.slice(topN);
  if (rest.length) {
    owners.push({
      id: OTHER_ID, label: 'Other owners', kind: 'owner', other: true, count: rest.length,
      ...mk(rest.flatMap((g) => g.rows), sum(rest.map((g) => g.credits))),
    });
  }
  const links: SankeyLink[] = [];
  const totals = { clear: { credits: 0, services: 0 }, risk: { credits: 0, services: 0 } };
  for (const o of owners) {
    for (const [target, rows] of [
      ['clear', o.rows.filter((r) => r.usedBy === 0)],
      ['risk', o.rows.filter((r) => r.usedBy > 0)],
    ] as const) {
      const value = sum(rows.map((r) => r.credits));
      if (value > 0) links.push({ source: o.id, target, value, owner: o.id });
      totals[target].credits += value;
      totals[target].services += rows.length;
    }
  }
  return { owners, links, totals };
}
