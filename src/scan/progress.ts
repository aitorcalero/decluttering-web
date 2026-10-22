// DC-071a: the scan's progress model (three stages, overall percent, estimate inputs) for the scan screen (DC-071b).
// Every phase reports its counts here; the meter turns them into ScanStages and hands them out at most every
// STAGE_EMIT_MS, and straight away when a stage changes state. Pure apart from the injected clock: no DOM, no timers.
import type { Limiter } from './limiter';
import type { ScanEstimate, ScanStages, StageId, StagePart, StageProgress, StageState } from './types';

export const STAGE_EMIT_MS = 250;
/** Rates look back this far. */
export const RATE_WINDOW_MS = 10_000;

export const STAGE_LABELS: Record<StageId, string> = {
  find: 'Finding layers',
  measure: 'Checking use and size',
  deps: 'Checking maps and apps',
};

export type PartKey = 'services' | 'owners' | 'usage' | 'views' | 'sizes' | 'listing' | 'maps';

const STAGE_OF: Record<PartKey, StageId> = {
  services: 'find', owners: 'find', usage: 'measure', views: 'measure', sizes: 'measure', listing: 'deps', maps: 'deps',
};
const HEADLINE: Record<StageId, PartKey> = { find: 'services', measure: 'sizes', deps: 'maps' };
/** How much each part weighs inside its stage's fraction. */
const WEIGHT: Record<PartKey, number> = { services: 0.8, owners: 0.2, usage: 0.2, views: 0.3, sizes: 0.5, listing: 0.05, maps: 0.95 };
const PAGE = 100;

interface Sample { t: number; n: number }

export interface MeterOptions {
  emit?: (s: ScanStages) => void;
  /** ms; default performance.now. */
  clock?: () => number;
  limiter?: Pick<Limiter, 'state'>;
  emitMs?: number;
}

export class ScanMeter {
  private readonly parts = new Map<PartKey, StagePart>();
  /** Planned calls left for a part, when the phase knows better than the default (sizes, once planned). */
  private readonly planned = new Map<PartKey, number>();
  private readonly started = new Map<StageId, number>();
  private readonly ended = new Map<StageId, number>();
  private readonly samples: Record<StageId, Sample[]> = { find: [], measure: [], deps: [] };
  private readonly callSamples: Sample[] = [];
  private readonly t0: number;
  private readonly clock: () => number;
  private calls = 0;
  private lastEmit = -Infinity;
  private lastStates = '';
  private ready = false;
  private done = false;
  private wasStopped = false;
  /** Calls that were still to make when Stop was pressed: a stopped scan's percent is work done over done plus this. */
  private leftAtStop = 0;
  private depsSkipped = false;

  constructor(private readonly o: MeterOptions = {}) {
    this.clock = o.clock ?? (() => performance.now());
    this.t0 = this.clock();
    this.begin('find');
    this.begin('measure'); // usage starts alongside find
  }

  private now() { return this.clock() - this.t0; }

  /** A stage's work has begun (find and measure begin at once; deps when the first map is read). */
  begin(stage: StageId) { if (!this.started.has(stage)) { this.started.set(stage, this.now()); this.changed(); } }

  /** A part's count. total null: not known yet. */
  set(part: PartKey, done: number, total: number | null) {
    this.parts.set(part, { done, total });
    const stage = STAGE_OF[part];
    if (HEADLINE[stage] === part) this.sample(this.samples[stage], done);
    this.changed();
  }

  /** The calls a part still needs, when its phase has planned them (otherwise one per item, or one per search page). */
  plan(part: PartKey, callsLeft: number) { this.planned.set(part, Math.max(0, callsLeft)); }

  /** No maps and apps will be read (depsMode none). */
  skipDeps() { this.depsSkipped = true; this.set('listing', 0, 0); this.set('maps', 0, 0); }

  /** One call finished (answered or failed). */
  call() { this.calls++; this.sample(this.callSamples, this.calls); }

  /** The core is in: the review can open. */
  core() { this.ready = true; this.changed(true); }

  /** Everything has ended; stopped: Stop was pressed after the core. */
  finish(stopped: boolean) { if (stopped && !this.done) this.leftAtStop = this.callsLeft(); this.done = true; this.wasStopped = stopped; this.changed(true); }

  private sample(xs: Sample[], n: number) {
    const t = this.now();
    xs.push({ t, n });
    while (xs.length > 2 && (xs[0] as Sample).t < t - RATE_WINDOW_MS) xs.shift();
  }

  private static rate(xs: Sample[]): number | null {
    const a = xs[0], b = xs[xs.length - 1];
    if (!a || !b || b.t - a.t < 1000) return null;
    return ((b.n - a.n) * 1000) / (b.t - a.t);
  }

  private complete(k: PartKey) { const p = this.parts.get(k); return !!p && p.total !== null && p.done >= p.total; }

  private stageDone(id: StageId): boolean {
    if (id === 'find') return this.complete('services') && this.complete('owners');
    if (id === 'measure') return this.complete('usage') && this.complete('views') && this.complete('sizes');
    return this.depsSkipped || (this.complete('listing') && this.complete('maps'));
  }

  private stateOf(id: StageId): StageState {
    if (this.stageDone(id)) return 'done';
    if (this.done) return this.wasStopped ? 'stopped' : 'done';
    return this.started.has(id) ? 'working' : 'waiting';
  }

  private fraction(id: StageId): number {
    let sum = 0, got = 0;
    for (const k of Object.keys(STAGE_OF) as PartKey[]) {
      if (STAGE_OF[k] !== id) continue;
      const p = this.parts.get(k);
      const f = !p || p.total === null ? 0 : p.total === 0 ? 1 : Math.min(1, p.done / p.total);
      sum += WEIGHT[k]; got += WEIGHT[k] * f;
    }
    return sum ? got / sum : 0;
  }

  /** Calls still to make, estimated per part. */
  private callsLeft(): number {
    let left = 0;
    for (const k of Object.keys(STAGE_OF) as PartKey[]) {
      const p = this.parts.get(k);
      if (this.planned.has(k)) { left += this.planned.get(k) as number; continue; }
      if (k === 'listing' && this.depsSkipped) continue;
      const pages = k === 'services' || k === 'owners' || k === 'listing';
      if (!p || p.total === null) { left += pages ? 1 : 0; continue; }
      const rest = Math.max(0, p.total - p.done);
      left += pages ? Math.ceil(rest / PAGE) : rest;
    }
    return left;
  }

  private changed(force = false) {
    const states = (['find', 'measure', 'deps'] as StageId[]).map((id) => this.stateOf(id)).join();
    for (const id of ['find', 'measure', 'deps'] as StageId[]) {
      const s = this.stateOf(id);
      if ((s === 'done' || s === 'stopped') && !this.ended.has(id)) this.ended.set(id, this.now());
    }
    const t = this.now();
    if (!this.o.emit) { this.lastStates = states; return; }
    if (force || states !== this.lastStates || t - this.lastEmit >= (this.o.emitMs ?? STAGE_EMIT_MS)) {
      this.lastStates = states;
      this.lastEmit = t;
      this.o.emit(this.snapshot());
    }
  }

  snapshot(): ScanStages {
    const stages = (['find', 'measure', 'deps'] as StageId[]).map((id): StageProgress => {
      const head = this.parts.get(HEADLINE[id]);
      const parts: Record<string, StagePart> = {};
      for (const k of Object.keys(STAGE_OF) as PartKey[]) if (STAGE_OF[k] === id) parts[k] = { ...(this.parts.get(k) ?? { done: 0, total: null }) };
      const state = this.stateOf(id);
      return {
        id, label: STAGE_LABELS[id], state,
        done: head?.done ?? 0, total: head?.total ?? null,
        fraction: state === 'done' ? 1 : this.fraction(id),
        rate: ScanMeter.rate(this.samples[id]),
        startedMs: this.started.get(id) ?? null, endedMs: this.ended.get(id) ?? null,
        parts,
      };
    }) as ScanStages['stages'];
    const lim = this.o.limiter?.state();
    const callsLeft = this.done ? 0 : this.callsLeft();
    const callsPerSec = ScanMeter.rate(this.callSamples);
    const estimate: ScanEstimate = {
      callsDone: this.calls, callsLeft, callsPerSec,
      etaMs: callsPerSec && callsPerSec > 0 ? Math.round((callsLeft / callsPerSec) * 1000) : null,
      limit: lim?.limit ?? 0, inFlight: lim?.inFlight ?? 0, queued: lim?.queued ?? 0,
      slowedDown: lim?.slowedDown ?? false, throttles: lim?.throttles ?? 0,
    };
    const finished = this.done && !this.wasStopped;
    const total = this.calls + (this.done ? this.leftAtStop : callsLeft);
    const percent = finished ? 100 : total ? Math.min(99, Math.floor((100 * this.calls) / total)) : 0;
    return {
      stages,
      current: stages.find((s) => s.state === 'working' || s.state === 'waiting')?.id ?? null,
      percent, readyToReview: this.ready, finished, stopped: this.done && this.wasStopped,
      elapsedMs: Math.round(this.now()), estimate,
    };
  }
}
