import { describe, expect, it } from 'vitest';
import { INITIAL_FLOW, REVIEW_NOW, REVIEW_NOW_HELPER, SEE_RESULTS, RESUME_SCAN, STOP_EARLY, STOP_KEEP, nextFlow, scanActions, type Flow, type FlowEvent } from './scan-flow';

const run = (events: FlowEvent[], from: Flow = INITIAL_FLOW): Flow => events.reduce(nextFlow, from);

describe('scan flow (DC-064)', () => {
  it('a fresh scan starts on Scan and stays there after the core', () => {
    expect(run([{ type: 'start', cached: false }])).toEqual({ state: 'scanning', view: 'scan', cached: false });
    expect(run([{ type: 'start', cached: false }, { type: 'core' }])).toEqual({ state: 'background', view: 'scan', cached: false });
  });

  it('stays on Scan when everything is done, until the person chooses', () => {
    const done = run([{ type: 'start', cached: false }, { type: 'core' }, { type: 'finished', stopped: false }]);
    expect(done).toEqual({ state: 'done', view: 'scan', cached: false });
    expect(nextFlow(done, { type: 'review' })).toEqual({ state: 'done', view: 'review', cached: false });
  });

  it('"Review now" mid-check opens the review while maps and apps carry on, and the scan can finish there', () => {
    const mid = run([{ type: 'start', cached: false }, { type: 'core' }, { type: 'review' }]);
    expect(mid).toEqual({ state: 'background', view: 'review', cached: false });
    expect(nextFlow(mid, { type: 'finished', stopped: false })).toEqual({ state: 'done', view: 'review', cached: false });
    expect(nextFlow(mid, { type: 'scan' }).view).toBe('scan');
  });

  it('there is nothing to review before the core', () => {
    expect(run([{ type: 'start', cached: false }, { type: 'review' }]).view).toBe('scan');
  });

  it('stop after the core opens the review with what is known (DC-053)', () => {
    expect(run([{ type: 'start', cached: false }, { type: 'core' }, { type: 'finished', stopped: true }]))
      .toEqual({ state: 'stopped', view: 'review', cached: false });
  });

  it('resuming a stopped scan goes back to scanning on the scan screen, and can finish', () => {
    const stopped = run([{ type: 'start', cached: false }, { type: 'core' }, { type: 'finished', stopped: true }]);
    const again = nextFlow(stopped, { type: 'start', cached: false });
    expect(again).toEqual({ state: 'scanning', view: 'scan', cached: false });
    expect(run([{ type: 'core' }, { type: 'finished', stopped: false }], again).state).toBe('done');
  });

  it('stop before the core is an error on Scan, with Try again', () => {
    const f = run([{ type: 'start', cached: false }, { type: 'failed' }]);
    expect(f).toEqual({ state: 'error', view: 'scan', cached: false });
    expect(scanActions(f.state)).toEqual({ primary: null, stop: null, retry: true });
    expect(nextFlow(f, { type: 'start', cached: false }).state).toBe('scanning');
  });

  it('cached fast path: straight to the review, the refresh runs behind it, a failed refresh keeps the review', () => {
    const c = run([{ type: 'start', cached: true }]);
    expect(c).toEqual({ state: 'scanning', view: 'review', cached: true });
    expect(run([{ type: 'core' }, { type: 'finished', stopped: false }], c)).toEqual({ state: 'done', view: 'review', cached: true });
    expect(nextFlow(c, { type: 'failed' })).toEqual({ state: 'done', view: 'review', cached: true });
  });

  it('late events after the end change nothing', () => {
    const done = run([{ type: 'start', cached: false }, { type: 'core' }, { type: 'finished', stopped: false }]);
    expect(nextFlow(done, { type: 'core' })).toBe(done);
    expect(nextFlow(done, { type: 'finished', stopped: true })).toBe(done);
  });

  it('actions per state: Stop labels keep DC-053; "Review now" with its helper; "See what we found" at the end', () => {
    expect(scanActions('scanning')).toEqual({ primary: null, stop: STOP_EARLY, retry: false });
    expect(scanActions('background')).toEqual({ primary: { label: REVIEW_NOW, helper: REVIEW_NOW_HELPER }, stop: STOP_KEEP, retry: false });
    expect(scanActions('done')).toEqual({ primary: { label: SEE_RESULTS }, stop: null, retry: false });
    expect(scanActions('stopped')).toEqual({ primary: { label: SEE_RESULTS }, stop: null, retry: false, resume: RESUME_SCAN });
    expect(RESUME_SCAN).toBe('Resume scan');
    expect(STOP_EARLY).toBe('Stop scanning');
    expect(STOP_KEEP).toBe('Stop and review what we have');
    expect(REVIEW_NOW).toBe('Review now');
    expect(SEE_RESULTS).toBe('See what we found');
  });
});
