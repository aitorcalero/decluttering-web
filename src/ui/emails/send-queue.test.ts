import { describe, expect, it } from 'vitest';
import { createSendQueue, tidyLine, tidyWarning, type SendFn, type SendOutcome } from './send-queue';

const entries = (...us: string[]) => us.map((u) => ({ username: u, fullName: u.toUpperCase(), subject: `s-${u}`, html: `h-${u}` }));

/** A fake send that records the order, can hold an owner until released, and can fail. */
function fakeSend(opts: { failOnce?: string[]; throwNotRemoved?: string; outcome?: Record<string, SendOutcome> } = {}) {
  const order: string[] = [];
  let inFlight = 0, maxInFlight = 0;
  const failed = new Set<string>();
  const gates = new Map<string, () => void>();
  const send: SendFn = async (u, subject, html) => {
    order.push(u);
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    expect(subject).toBe(`s-${u}`);
    expect(html).toBe(`h-${u}`);
    await new Promise<void>((r) => { if (holdAll) gates.set(u, r); else r(); });
    inFlight--;
    if (opts.failOnce?.includes(u) && !failed.has(u)) { failed.add(u); throw new Error('timed out'); }
    if (opts.throwNotRemoved === u) throw Object.assign(new Error('notify failed'), { notRemoved: [u] });
    return opts.outcome?.[u] ?? { sent: true, notRemoved: [] };
  };
  let holdAll = false;
  return {
    send, order, failed,
    get maxInFlight() { return maxInFlight; },
    hold() { holdAll = true; },
    release(u: string) { gates.get(u)?.(); gates.delete(u); },
    releaseAll() { holdAll = false; for (const [, r] of gates) r(); gates.clear(); },
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('send queue', () => {
  it('sends one owner at a time, in order, each once', async () => {
    const f = fakeSend();
    const q = createSendQueue(entries('a', 'b', 'c', 'a'), f.send);
    await q.run();
    expect(f.order).toEqual(['a', 'b', 'c']);
    expect(f.maxInFlight).toBe(1);
    const s = q.snapshot();
    expect(s.sent).toBe(3);
    expect(s.finished).toBe(true);
    expect(s.items.map((i) => i.phase)).toEqual(['done', 'done', 'done']);
  });

  it('pauses between owners and resumes from the next one', async () => {
    const f = fakeSend();
    f.hold();
    const q = createSendQueue(entries('a', 'b', 'c'), f.send);
    const running = q.run();
    await tick();
    expect(q.snapshot().current).toBe('a');
    q.pause(); // a is in flight: it finishes, b doesn't start
    f.release('a');
    await running;
    expect(f.order).toEqual(['a']);
    let s = q.snapshot();
    expect(s.paused).toBe(true);
    expect(s.finished).toBe(false);
    expect(s.items.map((i) => i.phase)).toEqual(['done', 'waiting', 'waiting']);
    f.releaseAll();
    await q.resume();
    s = q.snapshot();
    expect(f.order).toEqual(['a', 'b', 'c']);
    expect(s.sent).toBe(3);
    expect(s.paused).toBe(false);
  });

  it('carries on past a failure, and retry sends just that owner again', async () => {
    const f = fakeSend({ failOnce: ['b'] });
    const q = createSendQueue(entries('a', 'b', 'c'), f.send);
    await q.run();
    let s = q.snapshot();
    expect(s.items.map((i) => i.phase)).toEqual(['done', 'failed', 'done']);
    expect(s.items[1]!.error).toBe('timed out');
    expect(s.failed).toBe(1);
    expect(s.finished).toBe(true);
    await q.retry('b');
    s = q.snapshot();
    expect(f.order).toEqual(['a', 'b', 'c', 'b']);
    expect(s.items[1]!.phase).toBe('done');
    expect(s.items[1]!.attempts).toBe(2);
    expect(s.failed).toBe(0);
  });

  it('retry does nothing for an owner who was already sent (no second email)', async () => {
    const f = fakeSend();
    const q = createSendQueue(entries('a'), f.send);
    await q.run();
    await q.retry('a');
    await q.sendOne('a');
    expect(f.order).toEqual(['a']);
  });

  it('collects notRemoved from results and from errors', async () => {
    const f = fakeSend({ throwNotRemoved: 'b', outcome: { a: { sent: true, notRemoved: ['a'] } } });
    const q = createSendQueue(entries('a', 'b'), f.send);
    await q.run();
    const s = q.snapshot();
    expect(s.items[0]!.phase).toBe('done');
    expect(s.items[1]!.phase).toBe('failed');
    expect(s.notRemoved).toEqual(['a', 'b']);
  });

  it('marks notAdded owners and sends them nothing more', async () => {
    const f = fakeSend({ outcome: { a: { sent: false, notAdded: true, notRemoved: [] } } });
    const q = createSendQueue(entries('a'), f.send);
    await q.run();
    expect(q.snapshot().items[0]!.phase).toBe('not-added');
    expect(q.snapshot().failed).toBe(1);
  });

  it('one at a time: sendOne, skip, and giving up on failed owners', async () => {
    const f = fakeSend({ failOnce: ['a'] });
    const q = createSendQueue(entries('a', 'b', 'c'), f.send);
    await q.sendOne('a');
    expect(q.snapshot().items[0]!.phase).toBe('failed');
    q.skip('b');
    await q.sendOne('c');
    q.giveUpFailed();
    const s = q.snapshot();
    expect(s.items.map((i) => i.phase)).toEqual(['skipped', 'skipped', 'done']);
    expect(f.order).toEqual(['a', 'c']);
    expect(s.finished).toBe(true);
  });

  it('reports each phase change, for the live region', async () => {
    const f = fakeSend();
    const seen: string[] = [];
    const q = createSendQueue(entries('a', 'b'), f.send, (e) => { if (e.type === 'phase') seen.push(`${e.item.username}:${e.item.phase}`); });
    await q.run();
    expect(seen).toEqual(['a:sending', 'a:done', 'b:sending', 'b:done']);
  });
});

describe('tidy lines (DC-068)', () => {
  it('is quiet when nobody was left over', () => {
    expect(tidyLine({ removed: [], notRemoved: [] })).toBeNull();
    expect(tidyWarning({ notRemoved: [] })).toBeNull();
  });
  it('says how many were taken out', () => {
    expect(tidyLine({ removed: ['a', 'b'], notRemoved: [] })).toBe('Tidied the group: 2 people left over from an earlier run were taken out.');
    expect(tidyLine({ removed: ['a'], notRemoved: [] })).toBe('Tidied the group: 1 person left over from an earlier run was taken out.');
  });
  it('names anyone who could not be removed', () => {
    expect(tidyWarning({ notRemoved: ['x'] })).toMatch(/1 person .*\(x\)/);
  });
});
