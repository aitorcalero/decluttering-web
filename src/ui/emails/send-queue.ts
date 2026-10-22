// DC-019: the real-send queue. One owner at a time (add -> notify -> remove happens inside `send`, the notifier's
// sendToOwner). Pause takes effect between owners, never halfway through one, so nobody is left in the group by a pause.
// Pure: no DOM; the send function and the change listener are injected, so tests use a fake.

export type QueuePhase = 'waiting' | 'sending' | 'done' | 'failed' | 'skipped' | 'not-added';

export interface QueueEntry { username: string; fullName: string; subject: string; html: string }

export interface QueueItem extends QueueEntry {
  phase: QueuePhase;
  error: string;
  /** Usernames ArcGIS Online said it couldn't take out of the group again (tidied next time). */
  notRemoved: string[];
  attempts: number;
}

/** What the notifier's sendToOwner returns (OwnerSendResult), narrowed to what the queue reads. */
export interface SendOutcome { sent: boolean; notAdded?: boolean; notRemoved: string[] }
export type SendFn = (username: string, subject: string, html: string) => Promise<SendOutcome>;

export interface QueueSnapshot {
  items: QueueItem[];
  running: boolean;
  paused: boolean;
  /** Nothing is waiting or in flight (failed ones may still be retried). */
  finished: boolean;
  sent: number;
  failed: number;
  current: string | null;
  notRemoved: string[];
}

export type QueueEvent = { type: 'phase'; item: QueueItem } | { type: 'state' };

export interface SendQueue {
  snapshot(): QueueSnapshot;
  /** Sends every waiting owner in order, one at a time. Resolves when none is waiting, or when paused. */
  run(): Promise<void>;
  pause(): void;
  /** Lifts a pause and carries on from the next waiting owner. */
  resume(): Promise<void>;
  /** A failed owner goes back to waiting and, unless something is already running, is sent now. */
  retry(username: string): Promise<void>;
  /** Sends just this owner (the "one at a time" mode). Does nothing while another send is in flight. */
  sendOne(username: string): Promise<void>;
  skip(username: string): void;
  /** Failed owners become skipped ("Finish without the rest"). */
  giveUpFailed(): void;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e)) || 'Something went wrong';

export function createSendQueue(entries: QueueEntry[], send: SendFn, onChange: (e: QueueEvent) => void = () => {}): SendQueue {
  const seen = new Set<string>();
  const items: QueueItem[] = [];
  for (const e of entries) {
    if (seen.has(e.username)) continue; // one digest per owner, ever, per run
    seen.add(e.username);
    items.push({ ...e, phase: 'waiting', error: '', notRemoved: [], attempts: 0 });
  }
  let running = false, paused = false, current: string | null = null;
  const find = (u: string) => items.find((i) => i.username === u);
  const changed = (item?: QueueItem) => onChange(item ? { type: 'phase', item } : { type: 'state' });

  async function sendItem(item: QueueItem): Promise<void> {
    current = item.username;
    item.phase = 'sending'; item.error = ''; item.attempts += 1;
    changed(item);
    try {
      const r = await send(item.username, item.subject, item.html);
      item.notRemoved = r.notRemoved ?? [];
      item.phase = r.notAdded ? 'not-added' : r.sent ? 'done' : 'failed';
      if (item.phase === 'not-added') item.error = 'ArcGIS Online couldn’t add them to the group, so nothing was sent';
      else if (item.phase === 'failed') item.error = 'ArcGIS Online didn’t confirm the email';
    } catch (e) {
      item.phase = 'failed';
      item.error = msg(e);
      const nr = (e as { notRemoved?: unknown })?.notRemoved;
      item.notRemoved = Array.isArray(nr) ? nr.map(String) : [];
    }
    current = null;
    changed(item);
  }

  const api: SendQueue = {
    snapshot() {
      const sent = items.filter((i) => i.phase === 'done').length;
      const failed = items.filter((i) => i.phase === 'failed' || i.phase === 'not-added').length;
      return {
        items: items.map((i) => ({ ...i, notRemoved: [...i.notRemoved] })),
        running, paused, current, sent, failed,
        finished: !running && !items.some((i) => i.phase === 'waiting' || i.phase === 'sending'),
        notRemoved: [...new Set(items.flatMap((i) => i.notRemoved))],
      };
    },
    async run() {
      if (running) return;
      running = true; changed();
      try {
        for (;;) {
          if (paused) break;
          const next = items.find((i) => i.phase === 'waiting');
          if (!next) break;
          await sendItem(next);
        }
      } finally {
        running = false; changed();
      }
    },
    pause() { if (!paused) { paused = true; changed(); } },
    async resume() { if (!paused) return; paused = false; changed(); await api.run(); },
    async retry(username) {
      const it = find(username);
      if (!it || (it.phase !== 'failed' && it.phase !== 'not-added')) return;
      it.phase = 'waiting'; it.error = ''; changed(it);
      if (!running && !paused) await api.run();
    },
    async sendOne(username) {
      const it = find(username);
      if (!it || running || it.phase === 'done' || it.phase === 'sending') return;
      running = true; changed();
      try { await sendItem(it); } finally { running = false; changed(); }
    },
    skip(username) {
      const it = find(username);
      if (it && it.phase !== 'done' && it.phase !== 'sending') { it.phase = 'skipped'; changed(it); }
    },
    giveUpFailed() {
      for (const it of items) if (it.phase === 'failed' || it.phase === 'not-added') it.phase = 'skipped';
      changed();
    },
  };
  return api;
}

/** DC-068: the calm line after the group was tidied before a run (null when nobody was left over). */
export function tidyLine(r: { removed: string[]; notRemoved: string[] }): string | null {
  const n = r.removed.length;
  if (!n) return null;
  return `Tidied the group: ${n === 1 ? '1 person' : `${n} people`} left over from an earlier run ${n === 1 ? 'was' : 'were'} taken out.`;
}

/** DC-068: shown when ArcGIS Online wouldn't take someone out of the group. */
export function tidyWarning(r: { notRemoved: string[] }): string | null {
  const n = r.notRemoved.length;
  return n ? `${n === 1 ? '1 person' : `${n} people`} left over from an earlier run couldn't be taken out of the hidden group (${r.notRemoved.join(', ')}). You can remove them in ArcGIS Online under Groups. Nobody in the group is emailed unless they're in this run.` : null;
}
