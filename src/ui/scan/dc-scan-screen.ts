import { LitElement, html, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import '@esri/calcite-components/dist/components/calcite-panel';
import '@esri/calcite-components/dist/components/calcite-block';
import '@esri/calcite-components/dist/components/calcite-list';
import '@esri/calcite-components/dist/components/calcite-list-item';
import '@esri/calcite-components/dist/components/calcite-loader';
import '@esri/calcite-components/dist/components/calcite-icon';
import '@esri/calcite-components/dist/components/calcite-button';
import { fmtInt, formatMB } from '../../domain/format';
import type { Org } from '../../domain/types';
import type { ScanStages } from '../../scan/types';
import type { DotModel } from './dots';
import { sweepNote } from '../../domain/sweep';
import { finishClause } from '../../domain/outcomes';
import { getNudgeSummary, onNudgeLogChange } from '../../log/store';
import { scanActions, type FlowState } from './scan-flow';
import { announceLine, crawlLine, currentLine, mapsToCheck, servicesExpected, stageRows, usageIn, wantsBigOrgCard, wantsTips } from './stages-view';
import { askToNotify, notifyNote, type NotifyChoice } from './notify-done';
import './dc-dot-map';
import './dc-tips';

/*
 * DC-064, reworked in DC-071b: the signed-in scan screen. One current-stage line with a live count, one overall bar with
 * percent and a smoothed estimate, a quiet line on how many requests run at once (FB-19, FB-23), and the three stages
 * (Finding layers, Checking use and size, Checking maps and apps) from the scan's own progress model (ScanStages).
 * After ~15 s, if there is a while to go, a calm big-org card (not a modal) offers Review now, Keep going and Tell me
 * when it's done, and a "While you wait" card with tips appears alongside (FB-20, FB-22). The dot map gets the room.
 * Events (bubbling): dc-scan-review, dc-scan-stop, dc-scan-retry, dc-scan-resume (DC-102, after a stop), dc-scan-notify (detail: NotifyChoice),
 * dc-count-sweeps (detail: boolean, DC-086: count days when everything was touched at once).
 * Only stage changes, readiness and completion are announced (a visually hidden role=status); counts, percent,
 * the estimate and tips are not.
 */

export const REASSURANCE = 'Runs in your browser; nothing is sent to us. A copy stays in this browser for next time; clear it when you sign out.';

const plural = (n: number, a: string, b: string) => `${fmtInt(n)} ${n === 1 ? a : b}`;
const credit = (c: number) => (c < 10 ? c.toFixed(1) : fmtInt(c));

@customElement('dc-scan-screen')
export class DcScanScreen extends LitElement {
  @property() mode = 'admin';
  @property({ attribute: false }) orgName = '';
  @property({ attribute: false }) fullName = '';
  @property() flow: FlowState = 'scanning';
  /** The scan's three-stage progress (DC-071a); null before the first reading. */
  @property({ attribute: false }) stages: ScanStages | null = null;
  @property({ attribute: false }) model: DotModel = { dots: [], revealed: false, exact: false, staleMin: 0.3, maxSizeMB: 1, stats: { found: 0, staleServices: 0, credits: 0, sizeMB: 0 } };
  /** The org (its id finds the finish line's "since your last nudges", DC-096). */
  @property({ attribute: false }) org: Pick<Org, 'urlKey'> & Partial<Pick<Org, 'id'>> = { urlKey: '' };
  /** The smoothed estimate (stages-view createEtaSmoother), or null to hide it. */
  @property({ attribute: false }) eta: { ms: number; text: string } | null = null;
  @property({ attribute: false }) error = '';
  /** Maps and apps have all been checked, so "used by" (and the stale count) is final. */
  @property({ type: Boolean }) depsKnown = false;
  /** How we'll tell them it's done, once they've asked. */
  @property({ attribute: false }) notify: NotifyChoice = 'off';
  /** DC-111: extra content under the heading (the access checklist), supplied by app-root. */
  @property({ attribute: false }) aside: unknown = nothing;

  /** The big-org card has appeared in this scan (it stays until Keep going or the end, so it never flickers). */
  @state() private bigSeen = false;
  /** FB-77: the tips have appeared in this scan (they stay for the rest of it). */
  @state() private tipsSeen = false;
  @state() private bigDismissed = false;
  @state() private asking = false;

  protected override createRenderRoot(): HTMLElement { return this; }

  /** DC-096: the finish line's clause appears once the scan's log read is in. */
  private offLog: (() => void) | null = null;
  override connectedCallback(): void { super.connectedCallback(); this.offLog = onNudgeLogChange(() => this.requestUpdate()); }
  override disconnectedCallback(): void { this.offLog?.(); this.offLog = null; super.disconnectedCallback(); }

  private send(name: 'dc-scan-review' | 'dc-scan-stop' | 'dc-scan-retry' | 'dc-scan-resume'): void {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }));
  }

  private get running(): boolean { return this.flow === 'scanning' || this.flow === 'background'; }

  protected override willUpdate(changed: PropertyValues<this>): void {
    // A new scan: the card can come back.
    if (changed.has('flow') && this.flow === 'scanning' && changed.get('flow') !== 'scanning' && changed.get('flow') !== undefined) { this.bigSeen = false; this.tipsSeen = false; this.bigDismissed = false; }
    if (!this.tipsSeen && this.running && wantsTips(this.stages, this.eta)) this.tipsSeen = true;
    if (!this.bigSeen && this.running && wantsBigOrgCard(this.stages, this.eta)) this.bigSeen = true;
  }

  protected override updated(changed: PropertyValues<this>): void {
    // When the scan finishes, the Stop button goes away: keep keyboard focus on the actions, on the new primary button.
    const was = changed.get('flow') as FlowState | undefined;
    if (was && was !== this.flow && (this.flow === 'done') && (!document.activeElement || document.activeElement === document.body)) {
      void (this.querySelector('[data-action="review"]') as (HTMLElement & { setFocus?: () => Promise<void> }) | null)?.setFocus?.();
    }
  }

  /** "Tell me when it's done": the only place Notification permission is asked for. */
  private async tellMe(): Promise<void> {
    this.asking = true;
    const choice = await askToNotify();
    this.asking = false;
    this.dispatchEvent(new CustomEvent<NotifyChoice>('dc-scan-notify', { detail: choice, bubbles: true, composed: true }));
  }

  private announce(): string {
    if (this.flow === 'error') return '';
    if (this.flow === 'done') return announceLine(this.stages && { ...this.stages, finished: true });
    return announceLine(this.stages);
  }

  private renderProgress() {
    const st = this.stages;
    const pct = this.flow === 'done' ? 100 : st?.percent ?? 0;
    const crawl = this.running ? crawlLine(st?.estimate) : null;
    const line = this.flow === 'error' ? 'The scan didn’t finish.' : this.flow === 'done' ? currentLine(st && { ...st, finished: true }) : currentLine(st);
    const a = scanActions(this.flow);
    return html`
      <div class="scan-progress" data-scan="progress">
        <div class="sp-main">
          <div class="sp-line" data-scan="detail">${line}</div>
          ${this.flow === 'error' ? nothing : html`
            <div class="sp-bar" role="progressbar" aria-label="Scan progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${pct}>
              <i style="transform: scaleX(${pct / 100})"></i></div>
            <div class="sp-meta" data-scan="meta">
              <span>${this.flow === 'stopped' ? `Stopped at ${pct}%` : `${pct}% done`}${this.running && this.eta ? ` · ${this.eta.text}` : ''}</span>
              ${crawl ? html`<span class="sp-crawl" data-scan="crawl">${crawl}</span>` : nothing}
            </div>`}
        </div>
        <div class="scan-actions" data-scan="actions">
          ${a.resume ? html`
            <calcite-button data-action="resume" icon-start="play-f" @click=${() => this.send('dc-scan-resume')}>${a.resume}</calcite-button>` : nothing}
          ${a.primary ? html`
            <calcite-button data-action="review" icon-end="arrow-right" appearance=${a.resume ? 'outline' : 'solid'} @click=${() => this.send('dc-scan-review')}>${a.primary.label}</calcite-button>` : nothing}
          ${a.stop ? html`
            <calcite-button data-action="stop" class="stop" appearance="outline" kind="brand" icon-start="stop-square-f" @click=${() => this.send('dc-scan-stop')}>${a.stop}</calcite-button>` : nothing}
          ${a.primary?.helper ? html`<p class="scan-helper" data-scan="helper">${a.primary.helper}</p>` : nothing}
        </div>
      </div>`;
  }

  private renderBigOrg() {
    if (!this.bigSeen || this.bigDismissed || !this.running) return nothing;
    const maps = mapsToCheck(this.stages);
    const services = this.model.stats.found;
    const big = services >= 1000 || (maps ?? 0) >= 1000;
    const canReview = this.flow === 'background';
    const what = maps ? `${plural(maps, 'map or app', 'maps and apps')} to look inside` : 'There’s a lot to look through';
    const chosen = this.notify !== 'off';
    return html`
      <section class="big-org" data-scan="big-org" aria-labelledby="dc-big-org-h">
        <calcite-icon icon="clock" scale="m" aria-hidden="true"></calcite-icon>
        <div class="bo-body">
          <h2 id="dc-big-org-h">${big ? 'This is a big organisation' : 'This one takes a little while'}</h2>
          <p>${what}, so the first scan takes a while. If you stop, we pick up where we left off.</p>
          <p class="bo-note">${canReview ? 'Review now and the rest fills in.' : 'Review opens once the basics are in.'}</p>
          ${chosen ? html`<p class="bo-note" data-scan="notify-note">${notifyNote(this.notify)}</p>` : html`<p class="bo-note">You can leave this tab open and come back.</p>`}
          <div class="bo-actions">
            <calcite-button data-action="big-review" ?disabled=${!canReview} icon-end="arrow-right" @click=${() => this.send('dc-scan-review')}>Review now</calcite-button>
            <calcite-button data-action="keep-going" appearance="outline" @click=${() => { this.bigDismissed = true; }}>Keep going</calcite-button>
            ${chosen ? nothing : html`<calcite-button data-action="tell-me" appearance="transparent" icon-start="bell" ?loading=${this.asking} @click=${() => void this.tellMe()}>Tell me when it’s done</calcite-button>`}
          </div>
        </div>
      </section>`;
  }

  private renderCredits() {
    const m = this.model, s = m.stats;
    const checking = !this.depsKnown && this.flow !== 'done';
    const sub = m.exact
      ? `${this.mode === 'my-items' ? plural(s.staleServices, 'layer looks', 'layers look') : plural(s.staleServices, 'service looks', 'services look')} stale${checking ? ' so far' : ''} · ${formatMB(s.sizeMB)}${checking ? ' · still checking maps and apps, so this may shift' : ''}`
      : 'Waiting for the numbers…';
    return html`
      <calcite-block heading="Credits you could save" description="Potential, per month" expanded data-scan="credits">
        <div class="block-pad" aria-live="off">
          <div class="big">${fmtInt(s.credits)}</div>
          <p class="big-sub">${sub}</p>
        </div>
      </calcite-block>`;
  }

  private renderStages() {
    const rows = stageRows(this.flow === 'done' && this.stages ? { ...this.stages, stages: this.stages.stages.map((s) => (s.state === 'working' || s.state === 'waiting' ? { ...s, state: 'done' as const } : s)) as ScanStages['stages'] } : this.stages, this.mode);
    return html`
      <calcite-panel heading="What we’re up to" data-scan="phases">
        <calcite-list interaction-mode="static" label="Scan stages">
          ${rows.length ? rows.map((r) => html`
            <calcite-list-item label=${r.label} description=${[r.state === 'waiting' ? '' : r.count, r.detail].filter(Boolean).join(' · ')} data-phase=${r.id} data-state=${r.state}>
              <span slot="content-start">
                ${r.state === 'working' && this.flow !== 'error'
                  ? html`<calcite-loader inline label="Working"></calcite-loader>`
                  : html`<calcite-icon class="phase-icon ${r.state === 'done' ? 'done' : ''}" icon=${r.state === 'done' ? 'check-circle' : r.state === 'stopped' ? 'pause' : 'circle'} scale="s"></calcite-icon>`}
              </span>
            </calcite-list-item>`) : html`<calcite-list-item label="Getting started" description="Asking ArcGIS Online what’s there"></calcite-list-item>`}
        </calcite-list>
      </calcite-panel>`;
  }

  private renderWait() {
    if (!this.tipsSeen || !this.running) return nothing;
    const st = this.stages;
    const cur = st?.current ? st.stages.find((s) => s.id === st.current) : undefined;
    const sub = cur?.id === 'deps' && cur.total ? `While we check ${plural(cur.total, 'map or app', 'maps and apps')}` : 'While the scan carries on';
    return html`
      <section class="wait-card" data-scan="wait" aria-labelledby="dc-wait-h">
        <header>
          <calcite-icon icon="hourglass-active" scale="s" aria-hidden="true"></calcite-icon>
          <h2 id="dc-wait-h">While you wait</h2>
          <span class="wc-sub">${sub}</span>
        </header>
        <dc-tips .showAfterMs=${0}></dc-tips>
      </section>`;
  }

  private renderAfter() {
    const a = scanActions(this.flow);
    const s = this.model.stats;
    return html`
      ${this.error ? html`
        <div class="scan-error">
          <p role="alert" data-scan="error">${this.error}</p>
          ${a.retry ? html`<calcite-button data-action="retry" @click=${() => this.send('dc-scan-retry')}>Try again</calcite-button>` : nothing}
        </div>` : nothing}
      ${this.flow === 'done' ? html`
        <div class="note" data-note="scan-done">
          <calcite-icon icon="information" scale="s"></calcite-icon>
          <div><strong>That is the lot</strong><span>${this.mode === 'my-items' ? plural(s.staleServices, 'layer looks', 'layers look') : plural(s.staleServices, 'service looks', 'services look')} stale, worth about ${credit(s.credits)} credits a month. Have a look?</span>
            ${this.renderSince()}
            ${this.renderSweeps()}</div>
        </div>` : nothing}`;
  }

  /** DC-096: one short clause about past nudges, when something nudged is no longer in the org. */
  private renderSince() {
    if (this.mode === 'my-items' || !this.org.id) return nothing;
    const text = finishClause(getNudgeSummary(this.org.id));
    return text ? html`<span class="since-note" data-note="since-nudges">${text}</span>` : nothing;
  }

  /** DC-086: the same calm note as the review, on the finish line, when many layers were touched at once. */
  private renderSweeps() {
    const sw = this.model.sweeps;
    if (!sw) return nothing;
    const n = sweepNote(sw, sw.counting);
    return html`<span class="sweep-note" data-note="sweeps" data-sweep-dates=${sw.dates} data-counting=${String(sw.counting)}>${n.text}
      <calcite-button scale="s" appearance="transparent" kind="brand" data-action="count-sweeps"
        @click=${() => this.dispatchEvent(new CustomEvent<boolean>('dc-count-sweeps', { detail: !sw.counting, bubbles: true, composed: true }))}>${n.action}</calcite-button></span>`;
  }

  protected override render() {
    const me = this.mode === 'my-items';
    const n = this.model.stats.found;
    const exact = this.model.exact;
    return html`
      <section data-page="app" data-mode=${this.mode} data-flow=${this.flow} class="scan-page">
        <div>
          <h1>${me ? 'Having a look at your hosted feature layers' : `Taking a look around ${this.orgName || 'your organisation'}`}</h1>
          <p class="lede reassure">${this.fullName ? `Signed in as ${this.fullName}. ` : ''}${me
            ? 'We’re only reading here. Nothing in your account gets changed, moved or deleted, and nothing leaves your browser.'
            : 'We’re only reading here. Nothing in your org gets changed, moved or deleted, and nothing leaves it.'}</p>
        </div>
        ${this.aside}
        <p class="dc-sr" role="status" data-scan="announce">${this.announce()}</p>
        ${this.renderProgress()}
        ${this.renderAfter()}
        ${this.renderBigOrg()}
        <div class="scan-grid">
          <calcite-panel heading=${me ? 'Every dot is one of your hosted feature layers' : 'Every dot is a hosted feature service'}
            description=${n ? `${fmtInt(n)} of ${me ? 'yours' : 'them'}${exact ? ', to be exact' : ' so far'}` : 'Looking for them…'}>
            <div class="dots-wrap">
              <dc-dot-map .model=${this.model} .org=${this.org} ?finding=${this.stages?.current === 'find' && this.running}
                ?live=${this.running} .expected=${servicesExpected(this.stages)} ?lenses-ready=${usageIn(this.stages) || !this.running}></dc-dot-map>
              <p class="dm-foot"><calcite-icon icon="lock" scale="s"></calcite-icon><span>${REASSURANCE}</span></p>
            </div>
          </calcite-panel>
          <div class="side">
            ${this.renderWait()}
            ${this.renderCredits()}
            ${this.renderStages()}
          </div>
        </div>
      </section>`;
  }
}

declare global { interface HTMLElementTagNameMap { 'dc-scan-screen': DcScanScreen } }
