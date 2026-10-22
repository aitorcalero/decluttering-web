import { describe, expect, it, vi } from 'vitest';
import { askToNotify, notifyDone, notifyNote, type NotificationLike } from './notify-done';

function fake(permission: NotificationPermission, answer: NotificationPermission = 'granted') {
  const shown: { title: string; options?: NotificationOptions }[] = [];
  const N = class {
    static permission = permission;
    static requestPermission = vi.fn(async () => { N.permission = answer; return answer; });
    constructor(title: string, options?: NotificationOptions) { shown.push({ title, options }); }
  };
  return { N: N as unknown as NotificationLike & { requestPermission: ReturnType<typeof vi.fn> }, shown };
}

describe('"Tell me when it’s done" (DC-071b, FB-22)', () => {
  it('asks for permission only when asked, and only if the browser has not decided yet', async () => {
    const a = fake('default', 'granted');
    expect(await askToNotify(a.N)).toBe('notify');
    expect(a.N.requestPermission).toHaveBeenCalledTimes(1);

    const b = fake('granted');
    expect(await askToNotify(b.N)).toBe('notify');
    expect(b.N.requestPermission).not.toHaveBeenCalled();

    const c = fake('denied');
    expect(await askToNotify(c.N)).toBe('title');
    expect(c.N.requestPermission).not.toHaveBeenCalled();
  });

  it('falls back to the tab title when declined or unsupported', async () => {
    expect(await askToNotify(fake('default', 'denied').N)).toBe('title');
    expect(await askToNotify(fake('default', 'default').N)).toBe('title');
    expect(await askToNotify(undefined)).toBe('title');
  });

  it('notifies only when chosen, granted and the tab is hidden', () => {
    const f = fake('granted');
    expect(notifyDone('notify', { hidden: false, body: 'x' }, f.N)).toBe(false);
    expect(notifyDone('title', { hidden: true, body: 'x' }, f.N)).toBe(false);
    expect(notifyDone('off', { hidden: true, body: 'x' }, f.N)).toBe(false);
    expect(notifyDone('notify', { hidden: true, body: 'All done' }, f.N)).toBe(true);
    expect(f.shown).toHaveLength(1);
    expect(f.shown[0]?.options?.body).toBe('All done');
    expect(notifyDone('notify', { hidden: true, body: 'x' }, fake('denied').N)).toBe(false);
  });

  it('says what will happen in calm words', () => {
    expect(notifyNote('notify')).toMatch(/notification/);
    expect(notifyNote('title')).toMatch(/tab title/);
    expect(notifyNote('off')).toBe('');
  });
});
