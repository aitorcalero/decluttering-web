// DC-071a: one shared, adaptive request limiter for every scan phase (docs/research/large-org-scan.md, section 1).
// Starts at 6 in flight and grows by one after each run of healthy responses, up to 12. A throttle (HTTP 429 or 503)
// halves it, once per "epoch" (a burst of 429s from calls already in flight counts once), and a retryAfter pauses new
// calls until it has passed. Queued calls go out by priority (lower first), first come first served within a priority.
// The limiter only decides when a call starts; retries are the caller's (withRetry in pipeline.ts).

export interface LimiterOptions {
  /** In flight at the start. Default 6. */
  initial?: number;
  /** Most in flight. Default 12. */
  max?: number;
  /** Fewest in flight after halving. Default 1. */
  min?: number;
  /** Is this rejection ArcGIS Online asking us to slow down? Default: HTTP 429 or 503. */
  isThrottle?: (e: unknown) => boolean;
  /** Seconds the server asked us to wait, from the rejection. Default: its `retryAfter`. */
  retryAfterOf?: (e: unknown) => number | null;
  /** Waits ms (the pause for a retryAfter). Default setTimeout; the scan passes its own sleep so tests stay fast. */
  delay?: (ms: number) => Promise<void>;
}

export interface LimiterState {
  /** How many calls may be in flight now. */
  limit: number;
  inFlight: number;
  queued: number;
  /** Calls finished (answered or failed). */
  completed: number;
  /** Times the limit was halved. */
  throttles: number;
  /** True while new calls wait for a server's retryAfter. */
  paused: boolean;
  /** True from a throttle until the limit has grown back once. */
  slowedDown: boolean;
}

export interface RunOptions { priority?: number; signal?: AbortSignal }

export interface Limiter {
  run<T>(fn: () => Promise<T>, o?: RunOptions): Promise<T>;
  state(): LimiterState;
  /** Called after every finished call (for rates and estimates). */
  onSettle?: () => void;
}

export const LIMIT_START = 6;
export const LIMIT_MAX = 12;

export function statusOf(e: unknown): number | null {
  const o = e as { status?: unknown; code?: unknown } | null;
  const raw = o?.status ?? o?.code;
  const n = Number(typeof raw === 'string' ? /^HTTP (\d{3})$/.exec(raw)?.[1] ?? raw : raw); // arcgis-rest-js reports transport failures as code "HTTP 503"
  return Number.isFinite(n) ? n : null;
}

const defaultThrottle = (e: unknown) => { const s = statusOf(e); return s === 429 || s === 503; };
const defaultRetryAfter = (e: unknown) => { const n = Number((e as { retryAfter?: unknown } | null)?.retryAfter); return n > 0 ? n : null; };

function abortError(): Error {
  const e = new Error('The scan was stopped.');
  e.name = 'AbortError';
  return e;
}

interface Task { fn: () => Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void; signal?: AbortSignal; onAbort?: () => void }

export function createLimiter(o: LimiterOptions = {}): Limiter {
  const max = Math.max(1, o.max ?? LIMIT_MAX);
  const min = Math.max(1, Math.min(max, o.min ?? 1));
  const isThrottle = o.isThrottle ?? defaultThrottle;
  const retryAfterOf = o.retryAfterOf ?? defaultRetryAfter;
  let limit = Math.max(min, Math.min(max, o.initial ?? LIMIT_START));
  let inFlight = 0, completed = 0, throttles = 0, healthy = 0, epoch = 0, slowedDown = false;
  const delay = o.delay ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  // A retryAfter pauses new calls; the latest one wins (each pause has a generation, and only the latest releases).
  let paused = false, pauseGen = 0;
  const queues = new Map<number, Task[]>(); // priority -> FIFO
  let queued = 0;

  const take = (): Task | undefined => {
    const keys = [...queues.keys()].sort((a, b) => a - b);
    for (const k of keys) {
      const q = queues.get(k) as Task[];
      const t = q.shift();
      if (!q.length) queues.delete(k);
      if (t) { queued--; return t; }
    }
    return undefined;
  };

  const pump = () => {
    if (paused) return;
    while (inFlight < limit && queued > 0) {
      const t = take();
      if (!t) break;
      if (t.onAbort) t.signal?.removeEventListener('abort', t.onAbort);
      start(t);
    }
  };

  const start = (t: Task) => {
    inFlight++;
    const mine = epoch;
    let p: Promise<unknown>;
    try { p = t.fn(); } catch (e) { p = Promise.reject(e); }
    p.then(
      (v) => { settle(mine, null); t.resolve(v); },
      (e) => { settle(mine, e); t.reject(e); },
    );
  };

  const settle = (mine: number, err: unknown) => {
    inFlight--;
    completed++;
    if (err !== null && isThrottle(err)) {
      if (mine === epoch) {
        // The first throttle of this epoch halves the limit; later ones from calls already in flight don't halve again.
        epoch++;
        throttles++;
        limit = Math.max(min, Math.floor(limit / 2));
        healthy = 0;
        slowedDown = true;
      }
      const after = retryAfterOf(err);
      if (after) {
        const g = ++pauseGen;
        paused = true;
        void delay(after * 1000).catch(() => {}).then(() => { if (g === pauseGen) { paused = false; pump(); } });
      }
    } else if (err === null && mine === epoch) {
      // A run of `limit` healthy answers to calls sent at the current limit earns one more lane. Other failures, and
      // answers to calls sent before the last change, neither grow nor shrink it.
      healthy++;
      if (healthy >= limit && limit < max) { limit++; healthy = 0; epoch++; slowedDown = false; }
    }
    limiter.onSettle?.();
    pump();
  };

  const limiter: Limiter = {
    run<T>(fn: () => Promise<T>, ro: RunOptions = {}): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        if (ro.signal?.aborted) { reject(abortError()); return; }
        const t: Task = { fn, resolve: resolve as (v: unknown) => void, reject, signal: ro.signal };
        const pr = ro.priority ?? 0;
        if (ro.signal) {
          t.onAbort = () => {
            const q = queues.get(pr);
            const k = q ? q.indexOf(t) : -1;
            if (q && k >= 0) { q.splice(k, 1); queued--; if (!q.length) queues.delete(pr); reject(abortError()); }
          };
          ro.signal.addEventListener('abort', t.onAbort, { once: true });
        }
        const q = queues.get(pr) ?? [];
        q.push(t);
        queues.set(pr, q);
        queued++;
        pump();
      });
    },
    state: () => ({ limit, inFlight, queued, completed, throttles, paused, slowedDown }),
  };
  return limiter;
}
