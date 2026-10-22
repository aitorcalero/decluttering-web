import { describe, expect, it } from 'vitest';
import type { OwnerGroup, Row } from '../../domain/types';
import { shapeSankey, OTHER_ID } from './shape';

const row = (credits: number, usedBy: number, views = 0): Row => ({
  credits, usedBy, views: Array.from({ length: views }, () => ({})),
}) as unknown as Row;

const group = (name: string, rows: Row[]): OwnerGroup => ({
  owner: { username: name, fullName: name.toUpperCase() },
  rows, credits: rows.reduce((s, r) => s + r.credits, 0),
}) as unknown as OwnerGroup;

describe('shapeSankey', () => {
  it('returns empty shape for no owners', () => {
    const s = shapeSankey([]);
    expect(s.owners).toEqual([]);
    expect(s.links).toEqual([]);
  });

  it('splits an owner into clear and risk links by usedBy', () => {
    const s = shapeSankey([group('a', [row(3, 0), row(2, 0), row(5, 2)])]);
    expect(s.links).toEqual([
      { source: 'a', target: 'clear', value: 5, owner: 'a' },
      { source: 'a', target: 'risk', value: 5, owner: 'a' },
    ]);
    expect(s.totals.clear).toEqual({ credits: 5, services: 2 });
    expect(s.totals.risk).toEqual({ credits: 5, services: 1 });
  });

  it('omits zero-value links', () => {
    const s = shapeSankey([group('a', [row(4, 0)])]);
    expect(s.links.map((l) => l.target)).toEqual(['clear']);
  });

  it('counts views as services', () => {
    const s = shapeSankey([group('a', [row(1, 0, 2)])]);
    expect(s.owners[0]!.services).toBe(3);
  });

  it('keeps top 10 and folds the rest into Other owners', () => {
    const owners = Array.from({ length: 13 }, (_, i) => group(`u${i}`, [row(10 - i * 0.1, 0)]));
    const s = shapeSankey(owners);
    expect(s.owners).toHaveLength(11);
    const other = s.owners[10]!;
    expect(other.id).toBe(OTHER_ID);
    expect(other.other).toBe(true);
    expect(other.count).toBe(3);
    expect(other.services).toBe(3);
    expect(other.credits).toBeCloseTo(9 + 8.9 + 8.8);
    expect(s.links.filter((l) => l.owner === OTHER_ID)).toHaveLength(1);
  });

  it('has no Other node at exactly 10 owners', () => {
    const owners = Array.from({ length: 10 }, (_, i) => group(`u${i}`, [row(1, 0)]));
    expect(shapeSankey(owners).owners.some((o) => o.other)).toBe(false);
  });
});
