import { LitElement, html, svg, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { sparkGeometry } from './helpers';

/** DC-101: say what the bars cover, and that last used also counts opens. */
export const SPARK_TITLE = 'Days with data requests per week, last 13 weeks, today included (UTC). One request makes a day. Context only: Last used also counts opens.';

/** 13 weeks of days with data requests per week (UTC). DC-083: context only; the rule uses last used. */
@customElement('dc-sparkline')
export class DcSparkline extends LitElement {
  @property({ attribute: false }) weekly: number[] = [];

  protected override createRenderRoot(): HTMLElement { return this; }

  override render() {
    if (!Array.isArray(this.weekly) || !this.weekly.length) return nothing;
    const g = sparkGeometry(this.weekly);
    return html`<span class="spark" title=${SPARK_TITLE}>
      <svg width=${g.width} height=${g.height} viewBox="0 0 ${g.width} ${g.height}" role="img" aria-label="Data requested on ${g.total} of the last 91 days" aria-description=${SPARK_TITLE}>
        ${g.bars.map((b) => svg`
          ${b.zero
            ? svg`<rect class="z" x=${b.x} y=${b.y} width="3" height="1"></rect>`
            : svg`<rect class="b" x=${b.x} y=${b.y} width="3" height=${b.h} rx="0.6"></rect>`}`)}
      </svg><small>request days</small></span>`;
  }
}
declare global { interface HTMLElementTagNameMap { 'dc-sparkline': DcSparkline } }
