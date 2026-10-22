import { test } from 'vitest';
import assert from 'node:assert/strict';
import { nudgedRecently } from './cooldown';
import type { Owner } from './types';

const REF = new Date('2026-10-10T09:00:00Z');
const isoAgo = (d: number) => new Date(REF.getTime() - d * 86400000).toISOString();
const owner = (lastNotified: string | null): Owner => ({
  username: 'amy', fullName: 'Amy A', disabled: false, thumbnail: null, lastNotified,
});

test('never nudged is not recent', () => {
  assert.equal(nudgedRecently(owner(null), REF), false);
});

test('default cooldown is 182 days, inclusive (ADR 0005: a flag, not a skip)', () => {
  assert.equal(nudgedRecently(owner(isoAgo(0)), REF), true);
  assert.equal(nudgedRecently(owner(isoAgo(100)), REF), true);
  assert.equal(nudgedRecently(owner(isoAgo(182)), REF), true);
  assert.equal(nudgedRecently(owner(isoAgo(183)), REF), false);
});

test('days can be overridden, and refDate may be a ms timestamp', () => {
  assert.equal(nudgedRecently(owner(isoAgo(40)), REF, 30), false);
  assert.equal(nudgedRecently(owner(isoAgo(30)), REF, 30), true);
  assert.equal(nudgedRecently(owner(isoAgo(10)), REF.getTime()), true);
});

test('a nudge dated after the reference date counts as recent', () => {
  assert.equal(nudgedRecently(owner(isoAgo(-5)), REF), true);
});
