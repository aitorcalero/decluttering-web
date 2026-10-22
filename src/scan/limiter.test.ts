// DC-071a: the shared adaptive limiter, with fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIMIT_MAX, LIMIT_START, createLimiter } from './limiter';

const tooMany = (retryAfter?: number) => Object.assign(new Error('Too many requests'), { status: 429, ...(retryAfter ? { retryAfter } : {}) });

/** A call that answers after `ms` (fake time), or fails with `err`. */
const after = <T>(ms: number, v: T, err?: unknown) => () => new Promise<T>((res, rej) => setTimeout(() => (err ? rej(err) : res(v)), ms));

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => { vi.useRealTimers(); });

describe('createLimiter', () => {
  it('starts at 6 in flight and queues the rest', async () => {
    const l = createLimiter();
    expect(LIMIT_START).toBe(6);
    const ps = Array.from({ length: 20 }, (_, i) => l.run(after(100, i)));
    expect(l.state()).toMatchObject({ limit: 6, inFlight: 6, queued: 14 });
    await vi.advanceTimersByTimeAsync(100);
    expect(l.state().completed).toBe(6);
    await vi.runAllTimersAsync();
    expect(await Promise.all(ps)).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it('grows by one after each run of healthy answers, up to 12', async () => {
    const l = createLimiter();
    let most = 0;
    l.onSettle = () => { most = Math.max(most, l.state().inFlight); };
    const ps = Array.from({ length: 300 }, () => l.run(after(50, 1)));
    await vi.runAllTimersAsync();
    await Promise.all(ps);
    expect(l.state().limit).toBe(LIMIT_MAX);
    expect(LIMIT_MAX).toBe(12);
    expect(most).toBeLessThanOrEqual(12);
  });

  it('halves on a 429 once per burst, and honours retryAfter before sending more', async () => {
    const l = createLimiter({ initial: 8 });
    const sent: number[] = [];
    // The first 8 go out together; 3 of them are told to slow down (retryAfter 2 s).
    const ps = Array.from({ length: 12 }, (_, i) => l.run(() => { sent.push(Date.now()); return after(100, i, i < 3 ? tooMany(2) : undefined)(); }).catch((e) => e));
    expect(l.state().inFlight).toBe(8);
    await vi.advanceTimersByTimeAsync(100);
    expect(l.state()).toMatchObject({ limit: 4, throttles: 1, paused: true, slowedDown: true });
    expect(sent).toHaveLength(8); // nothing new while paused
    await vi.advanceTimersByTimeAsync(1999);
    expect(sent).toHaveLength(8);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toHaveLength(12);
    expect(sent.slice(8).every((t) => t >= 2100)).toBe(true);
    await vi.runAllTimersAsync();
    const out = await Promise.all(ps);
    expect(out.filter((x) => x instanceof Error)).toHaveLength(3);
  });

  it('a 503 counts as a throttle; other failures neither grow nor shrink the limit', async () => {
    const l = createLimiter();
    await Promise.all([
      l.run(after(10, 0, Object.assign(new Error('x'), { status: 400 }))).catch(() => 0),
      l.run(after(10, 0, Object.assign(new Error('x'), { code: 'HTTP 404' }))).catch(() => 0),
      vi.advanceTimersByTimeAsync(10),
    ]);
    expect(l.state()).toMatchObject({ limit: 6, throttles: 0 });
    await Promise.all([l.run(after(10, 0, Object.assign(new Error('x'), { code: 'HTTP 503' }))).catch(() => 0), vi.advanceTimersByTimeAsync(10)]);
    expect(l.state()).toMatchObject({ limit: 3, throttles: 1, paused: false });
  });

  it('never drops below the minimum', async () => {
    const l = createLimiter({ initial: 2 });
    for (let k = 0; k < 4; k++) {
      await Promise.all([l.run(after(10, 0, tooMany())).catch(() => 0), vi.advanceTimersByTimeAsync(10)]);
    }
    expect(l.state().limit).toBe(1);
  });

  it('sends lower priority numbers first, in order within a priority', async () => {
    const l = createLimiter({ initial: 1, max: 1 });
    const order: string[] = [];
    const job = (name: string) => () => { order.push(name); return after(10, name)(); };
    const ps = [
      l.run(job('first')), // goes straight out
      l.run(job('deps1'), { priority: 3 }), l.run(job('size1'), { priority: 2 }), l.run(job('find2'), { priority: 0 }),
      l.run(job('deps2'), { priority: 3 }), l.run(job('size2'), { priority: 2 }),
    ];
    await vi.runAllTimersAsync();
    await Promise.all(ps);
    expect(order).toEqual(['first', 'find2', 'size1', 'size2', 'deps1', 'deps2']);
  });

  it('an abort drops queued calls with AbortError and never sends them', async () => {
    const l = createLimiter({ initial: 1, max: 1 });
    const ctl = new AbortController();
    const fn = vi.fn(after(10, 'x'));
    const first = l.run(after(10, 'a'));
    const queued = l.run(fn, { signal: ctl.signal });
    ctl.abort();
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    await vi.runAllTimersAsync();
    expect(await first).toBe('a');
    expect(fn).not.toHaveBeenCalled();
    expect(l.state().queued).toBe(0);
    await expect(l.run(fn, { signal: ctl.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
