import { describe, expect, it } from 'vitest';
import { hasEmail, noEmailLine, selectAll, selectionOf, selectNone, splitByEmail } from './select';

describe('owners without an email (DC-121)', () => {
  const o = (username: string, email?: string) => ({ username, email });
  it('hasEmail: empty and whitespace do not count', () => {
    expect(hasEmail(o('a', 'a@example.org'))).toBe(true);
    expect(hasEmail(o('a'))).toBe(false);
    expect(hasEmail(o('a', ''))).toBe(false);
    expect(hasEmail(o('a', '   '))).toBe(false);
  });
  it('splits reachable owners from those with no email on file', () => {
    const r = splitByEmail([o('a', 'a@example.org'), o('b'), o('c', ' '), o('d', 'd@example.org')]);
    expect(r.known).toBe(true);
    expect(r.reachable.map((x) => x.username)).toEqual(['a', 'd']);
    expect(r.noEmail.map((x) => x.username)).toEqual(['b', 'c']);
  });
  it('when no owner has an email at all (cached scan, emails not loaded) nobody is excluded', () => {
    const r = splitByEmail([o('a'), o('b')]);
    expect(r.known).toBe(false);
    expect(r.reachable.length).toBe(2);
    expect(r.noEmail).toEqual([]);
  });
  it('an empty list is fine', () => {
    expect(splitByEmail([])).toEqual({ known: false, reachable: [], noEmail: [] });
  });
  it('the confirm line', () => {
    expect(noEmailLine(2, 7)).toBe('2 of 7 owners have no email on file, so they won’t get one.');
    expect(noEmailLine(1, 3)).toBe('1 of 3 owners has no email on file, so they won’t get one.');
    expect(noEmailLine(0, 3)).toBeNull();
  });
});

describe('owner selection (FB-24)', () => {
  const owners = ['a', 'b', 'c'];
  it('reports none, some and all with a count', () => {
    expect(selectionOf(owners, new Set())).toEqual({ state: 'none', count: 0, total: 3, label: '0 of 3 selected' });
    expect(selectionOf(owners, new Set(['a']))).toMatchObject({ state: 'some', count: 1 });
    expect(selectionOf(owners, new Set(owners)).state).toBe('all');
  });
  it('ignores ticked usernames that are not sendable', () => {
    expect(selectionOf(owners, new Set(['zed']))).toMatchObject({ state: 'none', count: 0 });
  });
  it('select all and none give the new sets', () => {
    expect([...selectAll(owners)]).toEqual(owners);
    expect(selectNone().size).toBe(0);
  });
  it('no sendable owners counts as none', () => {
    expect(selectionOf([], new Set()).state).toBe('none');
  });
});
