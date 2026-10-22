import { test } from 'vitest';
import assert from 'node:assert/strict';
import { noOneToNudge } from './solo';
import type { EvaluateResult, Owner, OwnerGroup, UnreachableGroup } from './types';

const owner = (username: string, disabled = false): Owner => ({ username, fullName: username, email: `${username}@example.org`, disabled, thumbnail: null, lastNotified: null });
const group = (username: string): OwnerGroup => ({
  owner: owner(username), rows: [], credits: 0, sizeMB: 0, unmeasured: 0, startCount: 0, disabled: false, nudgedRecently: false, nudgedDaysAgo: null, defaultTicked: true,
});
const lost = (username: string): UnreachableGroup => ({ owner: owner(username, true), rows: [], credits: 0, sizeMB: 0 });
const ev = (owners: string[], unreachable: string[] = []): Pick<EvaluateResult, 'owners' | 'unreachable'> => ({ owners: owners.map(group), unreachable: unreachable.map(lost) });

test('only the admin is flagged: no one to nudge', () => {
  assert.equal(noOneToNudge(ev(['admin']), 'admin'), true);
});

test('the admin plus a disabled owner: still no one to nudge (disabled accounts cannot get email)', () => {
  assert.equal(noOneToNudge(ev(['admin'], ['gone_user']), 'admin'), true);
});

test('the admin plus one other owner: there is someone to nudge', () => {
  assert.equal(noOneToNudge(ev(['admin', 'sam']), 'admin'), false);
});

test('another owner alone is someone to nudge', () => {
  assert.equal(noOneToNudge(ev(['sam']), 'admin'), false);
});

test('nothing flagged: not the solo case (the "all tidy" state stays)', () => {
  assert.equal(noOneToNudge(ev([]), 'admin'), false);
  assert.equal(noOneToNudge(ev([], ['gone_user']), 'admin'), false);
});

test('only disabled owners flagged: not the solo case', () => {
  assert.equal(noOneToNudge(ev([], ['gone_user']), 'admin'), false);
});

test('no known admin (the demo): never solo', () => {
  assert.equal(noOneToNudge(ev(['admin']), ''), false);
});

test('usernames compare without regard to case', () => {
  assert.equal(noOneToNudge(ev(['Admin']), 'admin'), true);
});
