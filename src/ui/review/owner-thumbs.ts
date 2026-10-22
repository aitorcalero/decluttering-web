/**
 * DC-115 (FB-74): owners' ArcGIS Online profile pictures on Review, loaded one card at a time as the card comes into view.
 *
 * Security notes (this file, and `fetchUserThumbnail` in src/auth/session.ts, which it reuses):
 * - Each picture is a plain GET to `community/users/{username}/info/{file}` with the token in the `X-Esri-Authorization`
 *   header, never in the URL (so it can't reach history, logs or a Referer). The picture is shown from a `blob:` URL.
 * - That path is not on the scan guard's allow-list (src/scan/request.ts) because these reads do not go through it: they are
 *   `fetch` with GET and no parameters. The URL is built here from the encoded username and a strictly checked file name
 *   only (`thumbFile`); anything else is dropped and the card keeps its initials.
 * - Nothing is fetched in the demo or the simulator, nor without a signed-in session. `blob:` URLs are revoked in `dispose`.
 */
import { fetchUserThumbnail } from '../../auth/session';

type Fetcher = typeof fetchUserThumbnail;
type Manager = Parameters<Fetcher>[0];

/** At most this many pictures are in flight at once. */
export const MAX_CONCURRENT = 4;

const FILE = /^[A-Za-z0-9_][A-Za-z0-9._-]*(\/[A-Za-z0-9_][A-Za-z0-9._-]*)?$/;

/**
 * The picture's file name from what the scan stored: either the bare file name (`thumb.png`) or the full
 * `.../community/users/{username}/info/{file}` URL it builds. Null when there is none or it looks wrong.
 */
export function thumbFile(username: string, thumbnail: string | null | undefined): string | null {
  if (!thumbnail || !username) return null;
  let file = thumbnail;
  if (/^[a-z][a-z0-9+.-]*:/i.test(file)) {
    if (!/^https:/i.test(file)) return null;
    const mark = `/community/users/${username}/info/`;
    const at = file.indexOf(mark);
    if (at < 0) return null;
    file = file.slice(at + mark.length);
  }
  return FILE.test(file) && !file.includes('..') ? file : null;
}

export interface OwnerThumbsDeps {
  /** The signed-in session, or null (no fetching then). */
  getManager: () => Manager | null;
  /** False in the demo and the simulator. */
  enabled?: () => boolean;
  /** Called when a picture arrives. */
  onChange?: () => void;
  fetchThumb?: Fetcher;
  revoke?: (url: string) => void;
  max?: number;
}

/** Fetches, caches (by username, for the session) and revokes the pictures. */
export class OwnerThumbs {
  private cache = new Map<string, string | null>();
  private queued: { username: string; file: string }[] = [];
  private asked = new Set<string>();
  private active = 0;
  private ctl = new AbortController();
  private gone = false;

  constructor(private deps: OwnerThumbsDeps) {}

  /** The `blob:` URL for this owner, if one has loaded. */
  get(username: string): string | undefined { return this.cache.get(username) ?? undefined; }

  /** Asks for an owner's picture (once). Does nothing in the demo, without a session, or without a usable file name. */
  request(username: string, thumbnail: string | null | undefined): void {
    if (this.gone || this.asked.has(username)) return;
    if (this.deps.enabled && !this.deps.enabled()) return;
    const file = thumbFile(username, thumbnail);
    if (!file) return;
    this.asked.add(username);
    this.queued.push({ username, file });
    this.pump();
  }

  private pump(): void {
    const max = this.deps.max ?? MAX_CONCURRENT;
    while (!this.gone && this.active < max && this.queued.length) {
      const job = this.queued.shift()!;
      const manager = this.deps.getManager();
      if (!manager) { this.cache.set(job.username, null); continue; }
      this.active++;
      void (this.deps.fetchThumb ?? fetchUserThumbnail)(manager, { username: job.username, thumbnail: job.file }, { signal: this.ctl.signal })
        .catch(() => null)
        .then((url) => {
          this.active--;
          if (this.gone) { if (url) (this.deps.revoke ?? URL.revokeObjectURL)(url); return; }
          this.cache.set(job.username, url);
          if (url) this.deps.onChange?.();
          this.pump();
        });
    }
  }

  /** Review went away or the user signed out: stop, and revoke every `blob:` URL. */
  dispose(): void {
    this.gone = true;
    this.ctl.abort();
    this.queued = [];
    const revoke = this.deps.revoke ?? URL.revokeObjectURL;
    for (const url of this.cache.values()) if (url) revoke(url);
    this.cache.clear();
    this.asked.clear();
  }
}

/**
 * Where an owner's profile and content page is, in the admin's own org. `customBaseUrl` is the org's custom base URL
 * (`portals/self`), e.g. `maps.arcgis.com`; without it the standard host is used. Null when the org has no `urlKey`.
 */
export function ownerContentUrl(org: { urlKey?: string; customBaseUrl?: string }, username: string): string | null {
  const key = (org.urlKey ?? '').trim();
  if (!key || !username) return null;
  const base = (org.customBaseUrl ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '') || 'maps.arcgis.com';
  if (!/^[a-z0-9.-]+$/i.test(key) || !/^[a-z0-9.-]+$/i.test(base)) return null;
  return `https://${key}.${base}/home/user.html?user=${encodeURIComponent(username)}`;
}
