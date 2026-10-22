import { describe, expect, it } from 'vitest';
import type { ScanStages, StageProgress, StageId, StageState } from '../../scan/types';
import {
  ALL_DONE, BIG_ORG_AFTER_MS, ESTIMATE_AFTER_MS, STOPPED_LINE, announceLine, crawlLine, createEtaSmoother, currentLine,
  mapsToCheck, servicesExpected, stageCount, stageRows, tabTitle, usageIn, wantsBigOrgCard, wantsTips, TIPS_AFTER_MS,
} from './stages-view';

const LABEL: Record<StageId, string> = { find: 'Finding layers', measure: 'Checking use and size', deps: 'Checking maps and apps' };

function stage(id: StageId, state: StageState, done = 0, total: number | null = null, parts: StageProgress['parts'] = {}): StageProgress {
  return { id, label: LABEL[id], state, done, total, fraction: total ? done / total : 0, rate: null, startedMs: 0, endedMs: null, parts };
}

function stages(o: Partial<ScanStages> & { find?: StageProgress; measure?: StageProgress; deps?: StageProgress } = {}): ScanStages {
  const find = o.find ?? stage('find', 'working', 300, 7000);
  const measure = o.measure ?? stage('measure', 'working', 0, null, { usage: { done: 1, total: 3 } });
  const deps = o.deps ?? stage('deps', 'waiting');
  const all = [find, measure, deps];
  return {
    stages: [find, measure, deps],
    current: o.current !== undefined ? o.current : all.find((s) => s.state === 'working' || s.state === 'waiting')?.id ?? null,
    percent: o.percent ?? 12, readyToReview: o.readyToReview ?? false, finished: o.finished ?? false, stopped: o.stopped ?? false,
    elapsedMs: o.elapsedMs ?? 5000,
    estimate: { callsDone: 10, callsLeft: 100, callsPerSec: 10, etaMs: 10_000, limit: 6, inFlight: 6, queued: 3, slowedDown: false, throttles: 0, ...o.estimate },
  };
}

describe('stage counts and the current line (DC-071b, FB-19)', () => {
  it('counts with thousands separators, and says "so far" while the total is unknown', () => {
    expect(stageCount({ done: 1240, total: 3050 })).toBe('1,240 of 3,050');
    expect(stageCount({ done: 2300, total: null })).toBe('2,300 so far');
    expect(stageCount({ done: 0, total: null })).toBe('');
    expect(stageCount({ done: 12, total: 10 })).toBe('10 of 10');
  });

  it('names the current stage with its live count', () => {
    const st = stages({
      find: stage('find', 'done', 7000, 7000), measure: stage('measure', 'done', 7000, 7000),
      deps: stage('deps', 'working', 1240, 3050),
    });
    expect(currentLine(st)).toBe('Checking maps and apps: 1,240 of 3,050');
    expect(currentLine(stages({ find: stage('find', 'working', 0, null) }))).toBe('Finding layers…');
    expect(currentLine(null)).toBe('Getting started…');
    expect(currentLine(stages({ finished: true, current: null }))).toBe(ALL_DONE);
    expect(currentLine(stages({ stopped: true, current: null }))).toBe(STOPPED_LINE);
  });

  it('says what is moving while the size count is still at 0', () => {
    const find = stage('find', 'done', 7000, 7000);
    expect(currentLine(stages({ find, measure: stage('measure', 'working', 0, 7000, { usage: { done: 1, total: 3 } }) })))
      .toBe('Checking use and size: reading use for 7,000 layers…');
    expect(currentLine(stages({ find, measure: stage('measure', 'working', 0, 7000, { usage: { done: 3, total: 3 }, views: { done: 2, total: 9 } }) })))
      .toBe('Checking use and size: matching views to their layers…');
    expect(currentLine(stages({ find, measure: stage('measure', 'working', 12, 7000, { usage: { done: 1, total: 3 } }) })))
      .toBe('Checking use and size: 12 of 7,000');
    expect(servicesExpected(stages({ find }))).toBe(7000);
    expect(servicesExpected(null)).toBe(0);
  });

  it('announces the stage and readiness, never the counts, so the live region changes only with the stage', () => {
    const a = announceLine(stages({ find: stage('find', 'working', 100, 7000) }));
    const b = announceLine(stages({ find: stage('find', 'working', 2400, 7000) }));
    expect(a).toBe('Finding layers.');
    expect(b).toBe(a);
    expect(announceLine(stages({ readyToReview: true, current: 'deps' }))).toBe('Ready to review. Checking maps and apps.');
    expect(announceLine(stages({ finished: true }))).toBe(ALL_DONE);
    expect(announceLine(null)).toBe('Getting started.');
  });
});

describe('stage rows', () => {
  it('three rows in order, waiting ones say so, owners fold into finding', () => {
    const rows = stageRows(stages({
      find: stage('find', 'done', 7000, 7000, { services: { done: 7000, total: 7000 }, owners: { done: 400, total: 400 } }),
    }));
    expect(rows.map((r) => r.id)).toEqual(['find', 'measure', 'deps']);
    expect(rows[0]).toMatchObject({ state: 'done', count: '7,000 of 7,000', detail: '400 owners' });
    expect(rows[2]).toMatchObject({ state: 'waiting', detail: 'Waiting its turn' });
  });

  it('a stopped stage says the next scan carries on', () => {
    const rows = stageRows(stages({ deps: stage('deps', 'stopped', 100, 3000), stopped: true }));
    expect(rows[2]?.detail).toMatch(/next time we carry on/);
  });

  it('my-items mode talks about matching to your account', () => {
    expect(stageRows(stages(), 'my-items')[0]?.detail).toBe('Matching them to your account');
  });
});

describe('tab title, crawl line, usage and maps', () => {
  it('shows the percent while running and Done at the end', () => {
    expect(tabTitle(stages({ percent: 42 }))).toBe('42% · Decluttering');
    expect(tabTitle(stages({ finished: true, percent: 100 }))).toBe('Done · Decluttering');
    expect(tabTitle(stages({ stopped: true }))).toBe('Stopped · Decluttering');
    expect(tabTitle(null)).toBe('Decluttering');
  });

  it('says how many requests at a time, and goes gently on a slow-down, never as an error', () => {
    expect(crawlLine({ limit: 8, slowedDown: false })).toBe('8 requests at a time · steady');
    expect(crawlLine({ limit: 3, slowedDown: true })).toMatch(/^Going gently/);
    expect(crawlLine({ limit: 0, slowedDown: false })).toBeNull();
    expect(crawlLine(null)).toBeNull();
  });

  it('usage is in only when every usage window is read', () => {
    expect(usageIn(stages())).toBe(false);
    expect(usageIn(stages({ measure: stage('measure', 'working', 0, null, { usage: { done: 3, total: 3 } }) }))).toBe(true);
    expect(usageIn(null)).toBe(true);
    expect(mapsToCheck(stages({ deps: stage('deps', 'working', 5, 3050) }))).toBe(3050);
  });
});

describe('the big-org card (FB-22)', () => {
  it('waits ~15 s, and shows only while there is a while to go', () => {
    expect(wantsBigOrgCard(stages({ elapsedMs: BIG_ORG_AFTER_MS - 1 }), null)).toBe(false);
    expect(wantsBigOrgCard(stages({ elapsedMs: BIG_ORG_AFTER_MS, estimate: { etaMs: 10 * 60_000 } as ScanStages['estimate'] }), null)).toBe(true);
    // Unknown estimate: assume it's long.
    expect(wantsBigOrgCard(stages({ elapsedMs: 20_000, estimate: { etaMs: null } as unknown as ScanStages['estimate'] }), null)).toBe(true);
    // Nearly done: no card.
    expect(wantsBigOrgCard(stages({ elapsedMs: 20_000 }), { ms: 20_000 })).toBe(false);
    expect(wantsBigOrgCard(stages({ elapsedMs: 20_000, finished: true }), null)).toBe(false);
    expect(wantsBigOrgCard(null, null)).toBe(false);
  });
});

describe('the estimate smoother', () => {
  const at = (t: number, etaMs: number | null, extra: Partial<ScanStages> = {}) =>
    stages({ elapsedMs: t, estimate: { etaMs } as ScanStages['estimate'], ...extra });

  it('stays hidden before 15 s, and until a few readings agree', () => {
    const s = createEtaSmoother();
    expect(s.add(at(2000, 600_000))).toBeNull();
    expect(s.add(at(ESTIMATE_AFTER_MS - 1, 600_000))).toBeNull();
    const fresh = createEtaSmoother();
    expect(fresh.add(at(20_000, 600_000))).toBeNull();
    expect(fresh.add(at(20_250, 590_000))).toBeNull();
    expect(fresh.add(at(20_500, 600_000))?.text).toBe('about 12 minutes left'); // with 20% slack
  });

  it('a wild reading resets the agreement before it shows, and is damped after', () => {
    const s = createEtaSmoother();
    s.add(at(16_000, 600_000)); s.add(at(16_250, 600_000));
    expect(s.add(at(16_500, 6_000_000))).toBeNull();
    for (let t = 17_000; t < 20_000; t += 250) s.add(at(t, 600_000));
    const shown = s.add(at(20_000, 600_000));
    expect(shown).not.toBeNull();
    const after = s.add(at(20_250, 3_000_000));
    expect((after?.ms ?? 0)).toBeLessThan(1_300_000);
  });

  it('counts down with time when the readings are steady', () => {
    const s = createEtaSmoother();
    let last = Infinity;
    for (let t = 15_000, eta = 300_000; t <= 60_000; t += 1000, eta -= 1000) {
      const r = s.add(at(t, eta));
      if (r) { expect(r.ms).toBeLessThanOrEqual(last + 1); last = r.ms; }
    }
    expect(last).toBeLessThan(300_000);
  });

  it('keeps showing through a missing reading, and hides when the scan ends', () => {
    const s = createEtaSmoother();
    for (let t = 15_000; t <= 17_000; t += 500) s.add(at(t, 200_000));
    expect(s.add(at(17_500, null))).not.toBeNull();
    expect(s.add(at(18_000, 200_000, { finished: true }))).toBeNull();
  });
});

describe('the wait tips (FB-77)', () => {
  const eta = (etaMs: number | null) => ({ etaMs }) as unknown as ScanStages['estimate'];
  it('never shows for a short scan (under a minute in all)', () => {
    expect(wantsTips(stages({ elapsedMs: TIPS_AFTER_MS, estimate: eta(30_000) }), null)).toBe(false);
    expect(wantsTips(stages({ elapsedMs: TIPS_AFTER_MS }), { ms: 40_000 })).toBe(false);
  });
  it('shows at about 10 s when the whole scan is a minute or more', () => {
    expect(wantsTips(stages({ elapsedMs: TIPS_AFTER_MS - 1, estimate: eta(120_000) }), null)).toBe(false);
    expect(wantsTips(stages({ elapsedMs: TIPS_AFTER_MS, estimate: eta(60_000) }), null)).toBe(true);
    expect(wantsTips(stages({ elapsedMs: TIPS_AFTER_MS }), { ms: 50_000 })).toBe(true);
  });
  it('an unknown estimate counts as long', () => {
    expect(wantsTips(stages({ elapsedMs: TIPS_AFTER_MS, estimate: eta(null) }), null)).toBe(true);
  });
  it('hides when stopped, finished or absent', () => {
    expect(wantsTips(stages({ elapsedMs: 20_000, estimate: eta(null), finished: true }), null)).toBe(false);
    expect(wantsTips(stages({ elapsedMs: 20_000, estimate: eta(null), stopped: true }), null)).toBe(false);
    expect(wantsTips(null, null)).toBe(false);
  });
});
