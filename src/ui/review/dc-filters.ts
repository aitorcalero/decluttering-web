import { LitElement, html, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import '@esri/calcite-components/dist/components/calcite-action';
import '@esri/calcite-components/dist/components/calcite-panel';
import '@esri/calcite-components/dist/components/calcite-popover';
import '@esri/calcite-components/dist/components/calcite-icon';
import '@esri/calcite-components/dist/components/calcite-block';
import '@esri/calcite-components/dist/components/calcite-segmented-control';
import '@esri/calcite-components/dist/components/calcite-segmented-control-item';
import '@esri/calcite-components/dist/components/calcite-label';
import '@esri/calcite-components/dist/components/calcite-select';
import '@esri/calcite-components/dist/components/calcite-option';
import '@esri/calcite-components/dist/components/calcite-switch';
import '@esri/calcite-components/dist/components/calcite-dialog';
import '@esri/calcite-components/dist/components/calcite-button';
import '@esri/calcite-components/dist/components/calcite-checkbox';
import type { Option, Thresholds } from '../../domain/types';
import {
  LAST_USED_OPTIONS, PRESETS, PRESET_NAMES, SIZE_OPTIONS, UPDATE_OPTIONS, USED_BY_OPTIONS, matchPreset, ruleLine,
  shouldAskAboutSize, sizeReference, smallItemsMessage, type PresetName, type SizeImpact,
} from '../../domain/stale';
import { LADDER, suggestSentence, type Suggestion } from '../../domain/suggest';
import { optionsWith, sayRule } from './helpers';

type NumKey = 'minDaysSinceUse' | 'minDaysSinceUpdate' | 'maxUsedBy' | 'minSizeMB';
const NA = 'Not available with your access';
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const FLIP = ['bottom-start', 'bottom-end', 'top-start', 'top-end'] as const; // narrow screens: no room on the right
const SMALL_KEY = 'decluttering:small-items-hidden'; // DC-055: "Don't show this again"
const smallHidden = (): boolean => { try { return localStorage.getItem(SMALL_KEY) === '1'; } catch { return false; } };
const hideSmall = (): void => { try { localStorage.setItem(SMALL_KEY, '1'); } catch { /* private mode */ } };

/**
 * DC-083 / DC-095: what "last used" measures (research 7.2). Plain data, one place to edit. DC-094 may change the definition.
 * `counts` and `aside` each get an icon in the popover; the text says it all.
 */
export const USAGE_INFO = 'Last used is the newer of two dates ArcGIS Online keeps for a layer and its hosted views: when it was last opened, and the last day (UTC) its data was requested.';
export const USAGE_COUNTS = [
  'Opening it: its item page, Map Viewer, or a map or app that uses it. Each of these also adds a view.',
  'A map, app, script or admin requesting its data.',
];
export const USAGE_ASIDE = 'One or two requests on a day when many layers were touched, usually a crawler. More than 10 requests still counts. The note above the list lets you count these back in.';
export const USAGE_NOTE = "Decluttering itself never requests your layers' data. The small bars on each layer show days with data requests only.";
/** DC-114 (FB-73): what "Used by" counts, in the About page's words ("maps and apps that use this layer"). */
export const USED_BY_INFO = 'Used by is the number of maps and apps in your org that use the layer: the other items that depend on it. "At most 1" means one map or app may still use it.';
export const USAGE_UNKNOWN = "If usage can't be fully read, a layer shows \"Last used: unknown\" and is never picked out. A blank \"last viewed\" means no recorded use since November 2022.";

/** DC-095: the starting point table, built from PRESETS so it never drifts from the real numbers. */
const agoShort = (d: number): string => (d >= 365 ? `${Math.round(d / 365)} yr` : `${Math.round(d / 30)} mo`);
const usedByShort = (n: number): string => (n === 0 ? 'none' : `${n} or fewer`);
export const PRESET_TABLE_HEAD = ['', 'Last used', 'Last updated', 'Used by', 'Size'] as const;
export function presetTableRows(): string[][] {
  return (['gentle', 'balanced', 'strict'] as const).map((k) => {
    const t = PRESETS[k];
    return [PRESET_NAMES[k], `${agoShort(t.minDaysSinceUse)}+`, `${agoShort(t.minDaysSinceUpdate)}+`, usedByShort(t.maxUsedBy), `${t.minSizeMB ?? 0} MB+`];
  });
}

/**
 * "What counts as stale?" panel: presets, plain-number dropdowns.
 * Fires `dc-thresholds-change` with the full Thresholds, and `dc-preset-pick` ({ preset }) when a starting point is chosen.
 * `suggestion` (from suggest()) enables the Suggested starting point; `selected` says which one to show as chosen.
 * When `canSeeUsage` is false the usage filters are disabled.
 * `sizeImpact(toMB)` (DC-055): what a lower minimum size would add. When set, lowering the size below the starting
 * point's asks first, unless it adds nothing.
 */
@customElement('dc-filters')
export class DcFilters extends LitElement {
  @property({ attribute: false }) thresholds: Thresholds = { ...PRESETS.balanced };
  @property({ type: Boolean, attribute: 'can-see-usage' }) canSeeUsage = true;
  @property({ type: Boolean }) member = false;
  @property({ attribute: false }) suggestion: Suggestion | null = null;
  /** The starting point to show as chosen. Defaults to whatever the numbers match. */
  @property() selected: PresetName | '' = '';
  @property({ attribute: false }) sizeImpact: ((toMB: number) => SizeImpact) | null = null;

  /** The size change waiting on the dialog, with what it adds. */
  @state() private asking: SizeImpact | null = null;
  @query('#small-never') private never?: HTMLInputElement;
  @query('calcite-select[label="Minimum size"]') private sizeSelect?: HTMLSelectElement;

  protected override createRenderRoot(): HTMLElement { return this; }

  private set(patch: Partial<Thresholds>) {
    this.dispatchEvent(new CustomEvent('dc-thresholds-change', { detail: { ...this.thresholds, ...patch }, bubbles: true, composed: true }));
  }

  private preset(name: string) {
    // Custom keeps the numbers as they are: it only says the starting point is no longer one of the named ones.
    if (name === 'custom') { this.dispatchEvent(new CustomEvent('dc-preset-pick', { detail: { preset: 'custom' }, bubbles: true, composed: true })); return; }
    const t = name === 'suggested' ? this.suggestion?.thresholds : name in PRESETS ? PRESETS[name as keyof typeof PRESETS] : undefined;
    if (!t) return;
    this.dispatchEvent(new CustomEvent('dc-preset-pick', { detail: { preset: name }, bubbles: true, composed: true }));
    this.dispatchEvent(new CustomEvent('dc-thresholds-change', { detail: { ...t }, bubbles: true, composed: true }));
  }

  /** DC-055: lowering the minimum size below the starting point's asks first, when it adds anything. */
  private changeSize(toMB: number) {
    const fromMB = this.thresholds.minSizeMB ?? 0;
    const shown = this.selected || matchPreset(this.thresholds);
    const ref = sizeReference(shown, this.suggestion?.thresholds.minSizeMB);
    if (!this.sizeImpact || this.member || smallHidden() || !shouldAskAboutSize(fromMB, toMB, ref)) { this.set({ minSizeMB: toMB }); return; }
    const imp = this.sizeImpact(toMB);
    if (!imp.families) { this.set({ minSizeMB: toMB }); return; }
    this.asking = imp;
  }

  private answer(include: boolean) {
    const imp = this.asking;
    if (!imp) return;
    if (this.never?.checked) hideSmall();
    this.asking = null;
    if (include) this.set({ minSizeMB: imp.toMB });
    else if (this.sizeSelect) this.sizeSelect.value = String(imp.fromMB); // the select already shows the new value: put it back
  }

  /** A hand-edited value that is not in the list gets its own option, so the select never lies. */
  private options(key: NumKey, list: Option[]) {
    const cur = this.thresholds[key] ?? 0;
    return optionsWith(key, list, cur).map((o) => html`<calcite-option value=${String(o.value)} ?selected=${o.value === cur}>${o.label}</calcite-option>`);
  }

  private select(key: NumKey, label: string, list: Option[], disabled = false) {
    return html`<calcite-select scale="s" label=${label} ?disabled=${disabled}
      @calciteSelectChange=${(e: Event) => {
        const v = Number((e.target as HTMLSelectElement).value);
        if (key === 'minSizeMB') this.changeSize(v); else this.set({ [key]: v });
      }}>${this.options(key, list)}</calcite-select>`;
  }

  /**
   * DC-114 (FB-72): fit an opened popover to the screen. Calcite keeps a tall popover attached to its button, so on a short
   * screen it can hang off the bottom. Once open, trim the scrolling body by whatever spills below (or above) the window, then
   * reposition. The close button stays in the header, which never scrolls.
   */
  private fitPopover = (e: Event): void => {
    const pop = e.currentTarget as HTMLElement & { reposition?: (delayed?: boolean) => Promise<void> };
    const body = pop.querySelector<HTMLElement>('.pop');
    const box = pop.shadowRoot?.querySelector<HTMLElement>('.container');
    if (!body || !box) return;
    const MARGIN = 16, MIN = 112;
    body.style.maxHeight = '';
    pop.setAttribute('placement', 'right-start');
    requestAnimationFrame(() => {
      const r = box.getBoundingClientRect();
      const vh = window.innerHeight;
      if (r.bottom <= vh - MARGIN && r.top >= MARGIN) return;
      // Calcite shifts a tall popover up until it touches the window edge, so a smaller overshoot is not enough: size the box to
      // the room below the button (where it naturally starts), keeping a clear margin under it. A11Y-06.
      const ref = pop.getRootNode() instanceof Document || pop.getRootNode() instanceof ShadowRoot
        ? (pop.getRootNode() as Document | ShadowRoot).getElementById?.(pop.getAttribute('reference-element') ?? '') : null;
      const rr = ref?.getBoundingClientRect();
      const chrome = r.height - body.clientHeight; // header and borders around the scrolling body
      let room = Math.min(vh - MARGIN - Math.max(MARGIN, rr ? rr.top : r.top), vh - 2 * MARGIN);
      if (rr && room - chrome < 200) { // too little room below the button: grow upwards from it instead
        pop.setAttribute('placement', 'right-end');
        room = Math.min(rr.bottom - MARGIN, vh - 2 * MARGIN);
      }
      body.style.maxHeight = `${Math.max(MIN, Math.min(body.clientHeight, room - chrome - 4))}px`;
      // Then trim whatever still spills (a popover Calcite has already shifted, at the top or the bottom), a few times at most.
      const settle = async (left: number): Promise<void> => {
        await pop.reposition?.(true);
        await new Promise((res) => requestAnimationFrame(res));
        const b = box.getBoundingClientRect();
        const over = Math.max(0, b.bottom - (vh - MARGIN)) + Math.max(0, MARGIN - b.top);
        if (!over || left <= 0 || body.clientHeight <= MIN) return;
        body.style.maxHeight = `${Math.max(MIN, body.clientHeight - over - 4)}px`;
        await settle(left - 1);
      };
      void settle(3);
    });
  };

  private smallDialog() {
    const imp = this.asking;
    return html`<calcite-dialog id="small-dlg" modal width-scale="m" heading="Include small items?" ?open=${!!imp}
      @calciteDialogClose=${() => this.answer(false)}>
      <div class="dlg small-dlg"><p class="lede" data-msg="small">${imp ? smallItemsMessage(imp) : ''}</p></div>
      <calcite-label slot="footer-start" layout="inline"><calcite-checkbox id="small-never"></calcite-checkbox>Don't show this again</calcite-label>
      <calcite-button slot="footer-end" appearance="outline" @click=${() => this.answer(true)}>Include small items</calcite-button>
      <calcite-button slot="footer-end" @click=${() => this.answer(false)}>Keep the ${imp ? imp.fromMB : ''} MB minimum</calcite-button>
    </calcite-dialog>`;
  }

  override render() {
    const t = this.thresholds, u = this.canSeeUsage;
    const preset = this.selected || matchPreset(t);
    const sug = this.suggestion;
    const kinds = (Object.keys(PRESET_NAMES) as PresetName[]).filter((k) => k !== 'suggested' || sug);
    return html`<calcite-panel heading="What counts as stale?">
      <calcite-block heading="Starting point" expanded>
        <calcite-action slot="actions-end" id="preset-info" icon="information" scale="s" text="How the starting points work" label="How the starting points work"></calcite-action>
        <calcite-segmented-control width="full" scale="s" label="Starting point"
          @calciteSegmentedControlChange=${(e: Event) => this.preset((e.target as HTMLInputElement).value)}>
          ${kinds.map((k) =>
            html`<calcite-segmented-control-item value=${k} ?checked=${preset === k}>${PRESET_NAMES[k]}</calcite-segmented-control-item>`)}
        </calcite-segmented-control>
        <p class="words" title=${preset === 'suggested' && sug ? suggestSentence(sug) : nothing}>${u ? ruleLine(t) : sayRule(t, u, this.member)}${preset === 'suggested' && sug ? html`<span class="dc-sr"> ${suggestSentence(sug)}</span>` : nothing}</p>
        <calcite-popover reference-element="preset-info" placement="right-start" .flipPlacements=${FLIP} closable overlay-positioning="fixed" label="How the starting points work" heading="Starting point" @calcitePopoverOpen=${this.fitPopover}>
          <div class="pop" tabindex="0" role="region" aria-label="How the starting points work">
            <p><b>Suggested</b> is worked out from your org: the gentlest of ${WORDS[LADDER.length] ?? LADDER.length} settings that flags about 15% of services of 10 MB or more, with at most 40 owners.</p>
            <p>Gentle, Balanced and Strict are fixed. A layer must meet all four.</p>
            <table class="pop-table">
              <thead><tr>${PRESET_TABLE_HEAD.map((h) => html`<th scope="col">${h}</th>`)}</tr></thead>
              <tbody>${presetTableRows().map(([name, ...cells]) => html`<tr><th scope="row">${name}</th>${cells.map((c) => html`<td>${c}</td>`)}</tr>`)}</tbody>
            </table>
            <p>${USED_BY_INFO}</p>
            <p>Smaller services save little (10 MB is about 2.4 credits a month) so are left out. Suggested picks 10 to 20 MB.</p>
            <p><b>Tidy priority</b> is ranked within your own stale items.</p>
          </div>
        </calcite-popover>
      </calcite-block>

      <calcite-block heading="Adjust" expanded>
        <calcite-action slot="actions-end" id="usage-info" icon="information" scale="s" text="What counts as last used" label="What counts as last used"></calcite-action>
        <calcite-popover reference-element="usage-info" placement="right-start" .flipPlacements=${FLIP} closable overlay-positioning="fixed" label="What counts as last used" heading="Last used" @calcitePopoverOpen=${this.fitPopover}>
          <div class="pop" tabindex="0" role="region" aria-label="What counts as last used">
            <p>${USAGE_INFO}</p>
            <ul class="pop-list" aria-label="What counts">
              ${USAGE_COUNTS.map((c) => html`<li><calcite-icon icon="check-circle" scale="s" aria-hidden="true" class="ok"></calcite-icon><span><b>Counts:</b> ${c}</span></li>`)}
              <li><calcite-icon icon="minus-circle" scale="s" aria-hidden="true" class="aside"></calcite-icon><span><b>Set aside:</b> ${USAGE_ASIDE}</span></li>
            </ul>
            <p>${USAGE_NOTE}</p>
            <p>${USAGE_UNKNOWN}</p>
          </div>
        </calcite-popover>
        <div class="fields">
          <calcite-label>Last used: more than<span class="sel-ago">${this.select('minDaysSinceUse', 'Last used', LAST_USED_OPTIONS, !u)}<span>ago</span></span></calcite-label>
          ${u ? nothing : html`<p class="hint">${NA}: the rule uses last updated, used by and size.</p>`}
          <calcite-label>Last updated: more than<span class="sel-ago">${this.select('minDaysSinceUpdate', 'Last updated', UPDATE_OPTIONS)}<span>ago</span></span></calcite-label>
          <calcite-label>Used by${this.select('maxUsedBy', 'Used by', USED_BY_OPTIONS)}</calcite-label>
          <calcite-label>Size: at least${this.select('minSizeMB', 'Minimum size', SIZE_OPTIONS)}</calcite-label>
        </div>
      </calcite-block>

    </calcite-panel>
    ${this.smallDialog()}`;
  }
}
declare global { interface HTMLElementTagNameMap { 'dc-filters': DcFilters } }
