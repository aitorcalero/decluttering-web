import { describe, expect, it } from 'vitest';
import { TOUR_KEY, markSeen, readMark, shouldAutoShow, writeMark, type ShowContext, type StorageLike } from './rule';
import { TOUR_STEPS, stepsFor } from './steps';

const base: ShowContext = { fast: false, myItems: false, mark: null, shownThisSession: false, automated: false, optedIn: false };
const memory = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
};
const blocked: StorageLike = {
  getItem: () => { throw new Error('SecurityError'); },
  setItem: () => { throw new Error('SecurityError'); },
};

describe('shouldAutoShow', () => {
  it('shows on the first visit', () => {
    expect(shouldAutoShow(base)).toBe(true);
  });
  it('does not show once it was shown or skipped ("seen")', () => {
    expect(shouldAutoShow({ ...base, mark: 'seen' })).toBe(false);
  });
  it('does not show after "Don\'t show again"', () => {
    expect(shouldAutoShow({ ...base, mark: 'never' })).toBe(false);
  });
  it('does not show in the quick demo', () => {
    expect(shouldAutoShow({ ...base, fast: true })).toBe(false);
  });
  it('does not show on My items (no owners to tick, no Emails)', () => {
    expect(shouldAutoShow({ ...base, myItems: true })).toBe(false);
  });
  it('shows at most once per page load, even if storage could not remember', () => {
    expect(shouldAutoShow({ ...base, shownThisSession: true })).toBe(false);
  });
  it('stays out of automated browsers unless a test opts in', () => {
    expect(shouldAutoShow({ ...base, automated: true })).toBe(false);
    expect(shouldAutoShow({ ...base, automated: true, optedIn: true })).toBe(true);
  });
});

describe('the stored choice', () => {
  it('round-trips under decluttering:tour-review', () => {
    const s = memory();
    expect(readMark(s)).toBeNull();
    writeMark('seen', s);
    expect(s.data.get(TOUR_KEY)).toBe('seen');
    expect(TOUR_KEY).toBe('decluttering:tour-review');
    expect(readMark(s)).toBe('seen');
    writeMark('never', s);
    expect(readMark(s)).toBe('never');
  });
  it("markSeen keeps an earlier 'Don't show again'", () => {
    const s = memory();
    markSeen(s);
    expect(readMark(s)).toBe('seen');
    writeMark('never', s);
    markSeen(s);
    expect(readMark(s)).toBe('never');
    expect(() => markSeen(blocked)).not.toThrow();
  });
  it('ignores anything else that is stored', () => {
    const s = memory();
    s.setItem(TOUR_KEY, 'whatever');
    expect(readMark(s)).toBeNull();
  });
  it('blocked storage reads as nothing stored and never throws', () => {
    expect(readMark(blocked)).toBeNull();
    expect(() => writeMark('seen', blocked)).not.toThrow();
    expect(readMark(null)).toBeNull();
    expect(() => writeMark('never', null)).not.toThrow();
  });
});

describe('the steps', () => {
  it('has at most five, each with at most two sentences', () => {
    expect(TOUR_STEPS.length).toBeLessThanOrEqual(5);
    for (const s of TOUR_STEPS) expect(s.text.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(2);
  });
  it('goes chart, rules, row, tick, next', () => {
    expect(stepsFor({ solo: false }).map((s) => s.id)).toEqual(['chart', 'rules', 'row', 'tick', 'next']);
  });
  it('solo drops the tick and Emails steps', () => {
    expect(stepsFor({ solo: true }).map((s) => s.id)).toEqual(['chart', 'rules', 'row']);
  });
});
