// DC-017: the admin's answer to "Keep a nudge log?", remembered in this browser per org, and changeable at any send.
// Under the app's `decluttering:` prefix, so "Clear saved data" and /reset.html forget it too.
import { PREFIX, type StorageLike } from '../cache/settings';

export type LogChoice = 'log' | 'none';

const key = (orgId: string) => `${PREFIX}nudgeLogChoice:${orgId}`;
const browserStore = (): StorageLike | null => { try { return localStorage; } catch { return null; } };

export function getLogChoice(orgId: string, storage: StorageLike | null = browserStore()): LogChoice | null {
  try {
    const v = storage?.getItem(key(orgId));
    return v === 'log' || v === 'none' ? v : null;
  } catch { return null; }
}

export function setLogChoice(orgId: string, choice: LogChoice, storage: StorageLike | null = browserStore()): void {
  try { storage?.setItem(key(orgId), choice); } catch { /* storage blocked: we ask again next time */ }
}
