import { describe, expect, it } from 'vitest';
import { rescanClock, canRescan, type RescanState } from './rescan';

const DAY = 86_400_000;
const now = new Date('2026-10-21T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const base: RescanState = { running: false, stopped: false, demo: false, savedAt: ago(2 * DAY), now };

describe('canRescan (DC-105)', () => {
  it('shows on results a day old or more', () => {
    expect(canRescan(base)).toBe(true);
    expect(canRescan({ ...base, savedAt: ago(DAY) })).toBe(true);
    expect(canRescan({ ...base, savedAt: ago(6 * DAY) })).toBe(true);
  });
  it('hides on results under a day old, such as right after a fresh scan', () => {
    expect(canRescan({ ...base, savedAt: ago(DAY - 1) })).toBe(false);
    expect(canRescan({ ...base, savedAt: ago(0) })).toBe(false);
  });
  it('shows after a failed refresh, whatever the age', () => {
    expect(canRescan({ ...base, savedAt: ago(1000), refreshFailed: true })).toBe(true);
  });
  it('hides while a scan is running, even if the refresh failed before', () => {
    expect(canRescan({ ...base, running: true })).toBe(false);
    expect(canRescan({ ...base, running: true, refreshFailed: true })).toBe(false);
  });
  it('hides after Stop (Resume is offered instead)', () => {
    expect(canRescan({ ...base, stopped: true })).toBe(false);
    expect(canRescan({ ...base, stopped: true, refreshFailed: true })).toBe(false);
  });
  it('hides in the demo', () => {
    expect(canRescan({ ...base, demo: true })).toBe(false);
    expect(canRescan({ ...base, demo: true, simulated: true })).toBe(false);
  });
  it('hides when the age is not known, unless the refresh failed', () => {
    expect(canRescan({ ...base, savedAt: undefined })).toBe(false);
    expect(canRescan({ ...base, savedAt: undefined, refreshFailed: true })).toBe(true);
  });
  it('shows in the simulator (dev only) once the scan is done', () => {
    expect(canRescan({ ...base, simulated: true, savedAt: ago(0) })).toBe(true);
    expect(canRescan({ ...base, simulated: true, savedAt: ago(0), running: true })).toBe(false);
  });
});

describe('rescanClock', () => {
  it('goes by the last full read, so a quiet background refresh does not hide Rescan', () => {
    expect(rescanClock({ fullScan: { at: '2026-10-01T00:00:00.000Z' } }, '2026-10-20T00:00:00.000Z')).toBe('2026-10-01T00:00:00.000Z');
  });
  it('falls back to when the results were saved, or nothing', () => {
    expect(rescanClock({ fullScan: {} }, '2026-10-20T00:00:00.000Z')).toBe('2026-10-20T00:00:00.000Z');
    expect(rescanClock(null, '')).toBeUndefined();
  });
});
