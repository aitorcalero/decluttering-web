import { describe, expect, it, beforeEach } from 'vitest';
import { SEND_LIMITS, countToday, planSend, recordPageSend, pageSendsFor, clearPageSends, sentTodayFor, runCapNote, dayNote, DAY_FULL, effectiveLimits, forgetPageSends } from './limits';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0);
const now = at(2026, 10, 22, 15);

describe('send limits', () => {
  it('are one object with the ADR numbers', () => {
    expect(SEND_LIMITS).toEqual({ perRun: 40, perDay: 100, gapMs: 2000 });
  });

  it('counts only sends from today, by the local day', () => {
    const sends = [
      { sentAt: at(2026, 10, 22, 0).toISOString() },
      { sentAt: at(2026, 10, 22, 14).toISOString() },
      { sentAt: at(2026, 10, 21, 23).toISOString() },
      { sentAt: at(2026, 10, 23, 1).toISOString() },
      { sentAt: 'not a date' },
    ];
    expect(countToday(sends, now)).toBe(2);
  });

  describe('effective limits', () => {
    it('are the real ones outside the demo, whatever the hook says', () => {
      expect(effectiveLimits(false, { __DC_DEMO_LIMITS__: { perRun: 1 } })).toEqual(SEND_LIMITS);
      expect(effectiveLimits(true, undefined)).toEqual(SEND_LIMITS);
    });
    it('the demo hook can only lower them', () => {
      expect(effectiveLimits(true, { __DC_DEMO_LIMITS__: { perRun: 1, perDay: 3, gapMs: 10 } })).toEqual({ perRun: 1, perDay: 3, gapMs: 10 });
      expect(effectiveLimits(true, { __DC_DEMO_LIMITS__: { perRun: 500, perDay: 1000, gapMs: 99999 } })).toEqual(SEND_LIMITS);
      expect(effectiveLimits(true, { __DC_DEMO_LIMITS__: { perRun: -1, perDay: Number.NaN } })).toEqual(SEND_LIMITS);
    });
    it('plans against the limits given', () => {
      const p = planSend(3, 0, { perRun: 1, perDay: 100, gapMs: 0 });
      expect(p.go).toBe(1);
      expect(p.notes[0]).toMatch(/up to 1 owners at a time/);
    });
  });

  describe('plan', () => {
    it('sends everyone when under both limits', () => {
      expect(planSend(10, 0)).toMatchObject({ go: 10, notes: [], blocked: false, remainingToday: 100 });
    });
    it('caps a run at 40 and keeps the rest for the next run', () => {
      const p = planSend(55, 0);
      expect(p.go).toBe(40);
      expect(p.runCapped).toBe(true);
      expect(p.notes).toEqual([runCapNote()]);
      expect(runCapNote()).toBe('You can send to up to 40 owners at a time. Send these, then start another run for the rest.');
    });
    it('sends only what is left today and says so', () => {
      const p = planSend(30, 92);
      expect(p).toMatchObject({ go: 8, dayCapped: true, remainingToday: 8 });
      expect(p.notes).toEqual([dayNote(92, 8)]);
      expect(dayNote(92, 8)).toBe('You’ve sent 92 today. 8 more can go today; the rest tomorrow.');
    });
    it('applies the smaller of run and day limits', () => {
      expect(planSend(60, 80).go).toBe(20);
      expect(planSend(60, 50).go).toBe(40);
    });
    it('blocks at zero remaining, and past it never goes negative', () => {
      const p = planSend(5, 100);
      expect(p).toMatchObject({ go: 0, blocked: true, remainingToday: 0 });
      expect(p.notes).toEqual([DAY_FULL]);
      expect(planSend(5, 130)).toMatchObject({ go: 0, blocked: true, remainingToday: 0 });
    });
    it('with nobody ticked, nothing to send and no notes', () => {
      expect(planSend(0, 20)).toMatchObject({ go: 0, notes: [] });
    });
    it('treats junk input as the safe side', () => {
      expect(planSend(Number.NaN, 0).go).toBe(0);
      expect(planSend(5, Number.NaN).go).toBe(0);
    });
  });

  describe('sent today for this admin', () => {
    beforeEach(() => clearPageSends());
    const log = [{ sentAt: at(2026, 10, 22, 9).toISOString() }, { sentAt: at(2026, 10, 20, 9).toISOString() }];
    it('counts the log rows of today', () => {
      expect(sentTodayFor('org', 'me', log, now)).toBe(1);
    });
    it('adds sends made in this page that the log has not re-read', () => {
      recordPageSend('org', 'me', at(2026, 10, 22, 14));
      recordPageSend('org', 'me', at(2026, 10, 22, 14));
      expect(sentTodayFor('org', 'me', log, now)).toBe(3);
    });
    it('keeps page sends apart per admin and org, and ignores yesterday’s', () => {
      recordPageSend('org', 'other', now);
      recordPageSend('org2', 'me', now);
      recordPageSend('org', 'me', at(2026, 10, 21, 10));
      expect(sentTodayFor('org', 'me', log, now)).toBe(1);
    });
    it('forgets page sends once the log has been read back', () => {
      recordPageSend('org', 'me', now);
      expect(pageSendsFor('org', 'me')).toHaveLength(1);
      clearPageSends('org', 'me');
      expect(pageSendsFor('org', 'me')).toHaveLength(0);
    });
    it('forgets only the sends the log now holds', () => {
      const a = new Date(now), b = new Date(now);
      recordPageSend('org', 'me', a); recordPageSend('org', 'me', b);
      forgetPageSends('org', 'me', [a]);
      expect(pageSendsFor('org', 'me')).toEqual([b]);
      forgetPageSends('org', 'me', [b]);
      expect(pageSendsFor('org', 'me')).toEqual([]);
    });
    it('with no log read at all, counts page sends only', () => {
      recordPageSend('org', 'me', now);
      expect(sentTodayFor('org', 'me', undefined, now)).toBe(1);
    });
  });
});
