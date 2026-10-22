// DC-094 (dev only): `#/probe-usage`, a read-only probe for "are item views per day readable without writing anything?".
// Only ever loaded through `if (import.meta.env.DEV) await import('./dev/usage-probe')` in app-root.ts, so production
// builds drop it. It uses the signed-in session, sends GET requests only (to `search` and `portals/self/usage`), and
// shows counts only: item ids, numbers and error codes, never titles or owner names.
// Steps for the user: docs/research/usage-signals-deep-dive.md section 13.
import { html, nothing, type TemplateResult } from 'lit';

/** The only calls the probe may send. Anything else throws before a request is made. */
export const PROBE_PATHS = ['search', 'portals/self/usage'] as const;
export type ProbePath = (typeof PROBE_PATHS)[number];
export type ProbeParams = Record<string, string | number>;
export interface ProbeCall { method: 'GET'; path: ProbePath; params: ProbeParams }
/** Sends one call. The probe's own sender uses GET only (see defineUsageProbe). */
export type ProbeSend = (call: ProbeCall) => Promise<unknown>;

/** At most this many ids per run, so every GET stays well under URL length limits. */
export const MAX_IDS = 20;
export const MAX_DAYS = 150;
const DAY = 86_400_000;
const ID32 = /^[0-9a-f]{32}$/;

/** Ids from free text (commas, spaces or new lines), lower-cased, de-duplicated, at most MAX_IDS. */
export function parseIds(text: string): { ids: string[]; rejected: number; capped: boolean } {
  const parts = text.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const valid = [...new Set(parts.filter((p) => ID32.test(p)))];
  return { ids: valid.slice(0, MAX_IDS), rejected: parts.filter((p) => !ID32.test(p)).length, capped: valid.length > MAX_IDS };
}

/** Throws unless the call is a GET to one of PROBE_PATHS. */
export function assertProbeCall(call: { method: string; path: string }): void {
  if (call.method !== 'GET') throw new Error(`usage probe: ${call.method} is not allowed (GET only)`);
  if (!(PROBE_PATHS as readonly string[]).includes(call.path)) throw new Error(`usage probe: ${call.path} is not allowed`);
}

/** A usage variant: what is filtered on, and with which service type. */
export interface Variant { key: string; label: string; by: 'item' | 'service' | 'none'; stype?: string }

/**
 * The variants to try. `item, no stype` is what the ArcGIS API for Python's Item.usage sends for items that are not
 * feature, tile or vector tile services (name = the item id). `portal` is a service type in Esri's service usage report.
 * `service, features` is the known-good comparator (data requests, as the scan reads them).
 */
export const VARIANTS: readonly Variant[] = [
  { key: 'item', label: 'item id, no stype', by: 'item' },
  { key: 'item-portal', label: 'item id, stype=portal', by: 'item', stype: 'portal' },
  { key: 'service', label: 'service name, stype=features (requests)', by: 'service', stype: 'features' },
  { key: 'all-portal', label: 'no name filter, stype=portal (whole org)', by: 'none', stype: 'portal' },
];

const urlName = (u: unknown): string | null => (typeof u === 'string' ? /\/services\/([^/]+)\/(Feature|Map|VectorTile)Server/i.exec(u)?.[1] ?? null : null);

export interface ItemFacts { id: string; found: boolean; type: string; numViews: number | null; lastViewedHoursAgo: number | null; serviceName: string | null }

/** The usage call for one variant, or null when it has nothing to filter on. */
export function usageCall(v: Variant, items: readonly ItemFacts[], now: number, days: number): ProbeCall | null {
  const d = Math.min(MAX_DAYS, Math.max(1, Math.round(days)));
  const params: ProbeParams = { vars: 'num', groupby: 'name', etype: 'svcusg', period: '1d', startTime: now - d * DAY, endTime: now };
  if (v.stype) params.stype = v.stype;
  if (v.by === 'item') params.name = items.map((i) => i.id).join(',');
  if (v.by === 'service') {
    const names = [...new Set(items.map((i) => i.serviceName).filter((n): n is string => !!n))];
    if (!names.length) return null;
    params.name = names.join(',');
  }
  return { method: 'GET', path: 'portals/self/usage', params };
}

export interface VariantResult {
  key: string; label: string;
  /** 'ok', 'skipped', or the error code or message ArcGIS returned. */
  status: string;
  rows: number;
  /** Rows whose name is a 32-hex item id (whole-org variant only says how many, never which). */
  idLikeRows: number;
  /** Per input item id: total in the window, days with any count, and days since the newest day with a count. */
  perItem: Record<string, { total: number; days: number; lastDayAgo: number | null } | null>;
}

export interface ProbeResult { at: number; days: number; items: ItemFacts[]; variants: VariantResult[] }

interface Row { name?: unknown; num?: readonly (readonly [unknown, unknown])[] }

function errorOf(res: unknown): string | null {
  const e = (res as { error?: { code?: unknown; message?: unknown; messageCode?: unknown } } | null)?.error;
  if (!e) return null;
  return [e.code, e.messageCode, e.message].filter((x) => x !== undefined && x !== '').join(' ');
}

function summarise(v: Variant, items: readonly ItemFacts[], res: unknown, now: number): VariantResult {
  const out: VariantResult = { key: v.key, label: v.label, status: 'ok', rows: 0, idLikeRows: 0, perItem: {} };
  const err = errorOf(res);
  if (err) return { ...out, status: err };
  const rows = ((res as { data?: unknown } | null)?.data as Row[] | undefined) ?? [];
  out.rows = rows.length;
  const series = new Map<string, Map<number, number>>();
  for (const r of rows) {
    const name = typeof r.name === 'string' ? r.name.toLowerCase() : '';
    if (ID32.test(name)) out.idLikeRows++;
    const m = series.get(name) ?? new Map<number, number>();
    for (const [ms, c] of r.num ?? []) { const t = Number(ms); if (Number.isFinite(t)) m.set(t, (m.get(t) ?? 0) + (Number(c) || 0)); }
    series.set(name, m);
  }
  for (const it of items) {
    const key = v.by === 'service' ? it.serviceName?.toLowerCase() : it.id;
    const m = key ? series.get(key) : undefined;
    if (!m) { out.perItem[it.id] = null; continue; }
    let total = 0, days = 0, last = 0;
    for (const [t, c] of m) if (c > 0) { total += c; days++; last = Math.max(last, t); }
    out.perItem[it.id] = { total, days, lastDayAgo: last ? Math.floor((now - last) / DAY) : null };
  }
  return out;
}

/** Runs the probe: one search for the items' numViews and lastViewed, then one usage call per variant. GET only. */
export async function runProbe(send: ProbeSend, ids: readonly string[], opts: { now?: number; days?: number } = {}): Promise<ProbeResult> {
  const now = opts.now ?? Date.now();
  const days = Math.min(MAX_DAYS, Math.max(1, Math.round(opts.days ?? 30)));
  const guarded: ProbeSend = (call) => { assertProbeCall(call); return send(call); };
  const list = ids.filter((i) => ID32.test(i)).slice(0, MAX_IDS);
  if (!list.length) return { at: now, days, items: [], variants: [] };

  const found = await guarded({ method: 'GET', path: 'search', params: { q: list.map((i) => `id:${i}`).join(' OR '), num: 100 } });
  const results = ((found as { results?: unknown } | null)?.results as Record<string, unknown>[] | undefined) ?? [];
  const byId = new Map(results.map((r) => [String(r.id), r]));
  const items: ItemFacts[] = list.map((id) => {
    const r = byId.get(id);
    const lv = typeof r?.lastViewed === 'number' && r.lastViewed > 0 ? r.lastViewed : null;
    return {
      id, found: !!r, type: typeof r?.type === 'string' ? r.type : '',
      numViews: typeof r?.numViews === 'number' ? r.numViews : null,
      lastViewedHoursAgo: lv === null ? null : Math.floor((now - lv) / 3_600_000),
      serviceName: urlName(r?.url),
    };
  });

  const variants: VariantResult[] = [];
  for (const v of VARIANTS) {
    const call = usageCall(v, items, now, days);
    if (!call) { variants.push({ key: v.key, label: v.label, status: 'skipped', rows: 0, idLikeRows: 0, perItem: {} }); continue; }
    try {
      variants.push(summarise(v, items, await guarded(call), now));
    } catch (e) {
      const err = e as { code?: unknown; message?: unknown };
      variants.push({ key: v.key, label: v.label, status: String(err.code ?? err.message ?? e), rows: 0, idLikeRows: 0, perItem: {} });
    }
  }
  return { at: now, days, items, variants };
}

const cell = (p: VariantResult['perItem'][string] | undefined): string =>
  p === undefined ? '' : p === null ? 'no row' : `${p.total} over ${p.days} d${p.lastDayAgo === null ? '' : `, last ${p.lastDayAgo} d ago`}`;

/** The results as a table: ids and counts only. */
export function probeTable(r: ProbeResult): TemplateResult {
  return html`
    <p>Read ${new Date(r.at).toISOString()}, window ${r.days} days (UTC days, today included).</p>
    <table data-probe="results">
      <thead><tr><th>Item id</th><th>Type</th><th>numViews</th><th>lastViewed (hours ago)</th>${r.variants.map((v) => html`<th>${v.label}<br><small>${v.status}${v.status === 'ok' ? ` · ${v.rows} rows${v.key === 'all-portal' ? `, ${v.idLikeRows} keyed by an item id` : ''}` : ''}</small></th>`)}</tr></thead>
      <tbody>${r.items.map((it) => html`<tr>
        <td><code>${it.id}</code></td><td>${it.found ? it.type : 'not found'}</td><td>${it.numViews ?? ''}</td><td>${it.lastViewedHoursAgo ?? 'blank'}</td>
        ${r.variants.map((v) => html`<td>${v.key === 'all-portal' ? cell(v.perItem[it.id]) || '' : cell(v.perItem[it.id])}</td>`)}</tr>`)}</tbody>
    </table>`;
}

/**
 * Defines `<dc-usage-probe>`. Called only from app-root in dev; the class is created here, not at import, so the pure
 * functions above can be unit-tested without a DOM.
 */
export async function defineUsageProbe(): Promise<void> {
  if (customElements.get('dc-usage-probe')) return;
  const { LitElement } = await import('lit');
  const { request } = await import('@esri/arcgis-rest-request');
  const { loadSession } = await import('../auth/session');

  class UsageProbe extends LitElement {
    static override properties = { busy: { state: true }, result: { state: true }, note: { state: true } };
    busy = false;
    result: ProbeResult | null = null;
    note = '';
    protected override createRenderRoot(): HTMLElement { return this; }

    private async run(): Promise<void> {
      const manager = loadSession();
      if (!manager) { this.note = 'Not signed in in this tab. Open #/ , sign in, then come back to #/probe-usage in the same tab and reload.'; return; }
      const ta = this.querySelector('textarea'), daysEl = this.querySelector('input');
      const parsed = parseIds(ta?.value ?? '');
      this.note = [parsed.rejected ? `${parsed.rejected} entries were not item ids and were skipped.` : '', parsed.capped ? `Only the first ${MAX_IDS} ids are used.` : ''].filter(Boolean).join(' ');
      if (!parsed.ids.length) { this.note = 'Paste one or more 32-character item ids.'; return; }
      const base = manager.portal.replace(/\/+$/, '');
      // GET only: maxUrlLength is raised so arcgis-rest-request never switches a long GET to POST.
      const send: ProbeSend = (call) => {
        assertProbeCall(call);
        return request(`${base}/${call.path}`, { authentication: manager, httpMethod: 'GET', maxUrlLength: 1_000_000, params: { f: 'json', ...call.params } });
      };
      this.busy = true;
      try { this.result = await runProbe(send, parsed.ids, { days: Number(daysEl?.value) || 30 }); }
      catch (e) { this.note = e instanceof Error ? e.message : String(e); }
      finally { this.busy = false; }
    }

    protected override render() {
      return html`
        <section data-page="probe-usage">
          <h1>Usage probe (dev only, read-only)</h1>
          <p>GET requests only, to <code>search</code> and <code>portals/self/usage</code>. Shows ids and counts only.</p>
          <label>Item ids (comma or one per line, at most ${MAX_IDS})<br><textarea rows="4" cols="70"></textarea></label><br>
          <label>Days (1 to ${MAX_DAYS}) <input type="number" min="1" max=${MAX_DAYS} value="30"></label>
          <button data-action="probe" ?disabled=${this.busy} @click=${() => void this.run()}>${this.busy ? 'Reading…' : 'Read'}</button>
          ${this.note ? html`<p role="note">${this.note}</p>` : nothing}
          ${this.result ? probeTable(this.result) : nothing}
        </section>`;
    }
  }
  customElements.define('dc-usage-probe', UsageProbe);
}
