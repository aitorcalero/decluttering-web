import { describe, expect, it } from 'vitest';
import { SENDING_MODE, mayOptIn, orgMayOptIn, parseSendingMode } from './sending';

const A = 'AbCdEfGh12345678';
const B = 'ZyXwVuTs87654321';

describe('parseSendingMode (off unless exactly one of the known words)', () => {
  it('is off when unset, empty or junk', () => {
    for (const v of [undefined, null, '', ' ', 'on', 'true', 'yes', 'OPT-IN', 'List', 'opt_in', 'optin', 'list,opt-in', 0, 1, true, {}, []]) {
      expect(parseSendingMode(v)).toBe('off');
    }
  });
  it('reads the three words, ignoring surrounding spaces only', () => {
    expect(parseSendingMode('off')).toBe('off');
    expect(parseSendingMode('list')).toBe('list');
    expect(parseSendingMode(' opt-in ')).toBe('opt-in');
  });
  it('the build mode is exactly what VITE_SENDING parses to (a local .env may set it; CI has none, so off)', () => {
    expect(SENDING_MODE).toBe(parseSendingMode(import.meta.env.VITE_SENDING));
  });
});

describe('orgMayOptIn', () => {
  it('off: no org, whatever the list says', () => {
    expect(orgMayOptIn(A, 'off', A)).toBe(false);
    expect(orgMayOptIn(A, 'off', '')).toBe(false);
  });
  it('list: only listed orgs (exact match)', () => {
    expect(orgMayOptIn(A, 'list', A)).toBe(true);
    expect(orgMayOptIn(A, 'list', ` ${B}, ${A}`)).toBe(true);
    expect(orgMayOptIn(B, 'list', A)).toBe(false);
    expect(orgMayOptIn(A, 'list', '')).toBe(false);
    expect(orgMayOptIn(A, 'list', undefined)).toBe(false);
    expect(orgMayOptIn(A.toLowerCase(), 'list', A)).toBe(false);
  });
  it('opt-in: any org with an id, never a blank one', () => {
    expect(orgMayOptIn(A, 'opt-in', '')).toBe(true);
    expect(orgMayOptIn(B, 'opt-in', A)).toBe(true);
    for (const id of [undefined, null, '', '  ']) expect(orgMayOptIn(id, 'opt-in', A)).toBe(false);
  });
  it('an unknown mode value fails closed', () => {
    expect(orgMayOptIn(A, 'anything' as never, A)).toBe(false);
  });
});

describe('mayOptIn (what the construction guards use)', () => {
  it('defaults to the build mode: refuses an unlisted org unless the mode is opt-in', () => {
    expect(mayOptIn(A, {})).toBe(SENDING_MODE === 'opt-in');
  });
  it('a bare list override (tests) means list mode', () => {
    expect(mayOptIn(A, { writableOrgIds: [A] })).toBe(true);
    expect(mayOptIn(A, { writableOrgIds: [B] })).toBe(false);
    expect(mayOptIn(A, { writableOrgIds: [] })).toBe(false);
  });
  it('an explicit mode wins over the list', () => {
    expect(mayOptIn(A, { sendingMode: 'off', writableOrgIds: [A] })).toBe(false);
    expect(mayOptIn(A, { sendingMode: 'opt-in', writableOrgIds: [B] })).toBe(true);
    expect(mayOptIn(A, { sendingMode: 'list', writableOrgIds: [B] })).toBe(false);
  });
});
