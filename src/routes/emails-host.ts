// DC-019: the Emails step's host. Builds the notifier and hands <dc-emails> the owners ticked on Review.
//  - Demo: the real notifier code on an in-memory fake org (nothing leaves the browser).
//  - Signed in, writable org: the session notifier (own allow-list), wrapped so owner sends throw unless
//    VITE_ALLOW_OWNER_SENDS is on. The test send goes to the signed-in admin only.
//  - Signed in, read-only org: no notifier at all; writing and previewing still work.
import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { ArcGISIdentityManager } from '@esri/arcgis-rest-request';
import { createSessionNotifier, WritesDisabled, type GroupNotifier } from '../notify';
import { PORTAL_URL } from '../auth/config';
import { ALLOW_OWNER_SENDS, gateNotifier, gateNudgeLog } from '../ui/emails/gate';
import { createDemoNotifier, createDemoNudgeLog } from '../ui/emails/demo-notifier';
import { createSessionNudgeLog, type NudgeLog } from '../log';
import type { Admin, EmailOwner } from '../ui/emails/digest';
import { emailOwners, getEmailSelection } from './email-selection';
import { go } from './router';
import { isSolo, onSoloChange } from './review-host';
import '../ui/emails/dc-emails';

export const DEMO_ADMIN: Admin = { name: 'Alex Ivanov', username: 'demo_admin', email: 'you@example.org' };

/** The demo's group starts with two people left over from an "earlier run", so the tidy line can be seen. */
const DEMO_LEFTOVERS = ['demo_left_over_1', 'demo_left_over_2'];

export interface EmailsHostProps {
  demo: boolean;
  manager?: ArcGISIdentityManager | null;
  admin: Admin;
  orgId: string;
  orgName: string;
  writable: boolean;
}

@customElement('app-emails')
export class AppEmails extends LitElement {
  @property({ type: Boolean }) demo = false;
  @property({ attribute: false }) manager: ArcGISIdentityManager | null = null;
  @property({ attribute: false }) admin: Admin = DEMO_ADMIN;
  @property() orgId = '';
  @property() orgName = '';
  @property({ type: Boolean }) writable = false;
  private notifier: GroupNotifier | null = null;
  /** DC-017: the nudge log (demo: an in-memory table; real: the session log, created and written only with owner sends on). */
  private nudgeLog: NudgeLog | null = null;
  private built = false;
  /** DC-103: Review found no one to nudge, so this step has no one in it: it sends the admin back to Review. */
  private offSolo: (() => void) | null = null;
  private memo: { sel: unknown; owners: EmailOwner[] } | null = null;

  /** Owners from the review's selection, worked out once per selection. */
  private ownersFor(sel: NonNullable<ReturnType<typeof getEmailSelection>>): EmailOwner[] {
    if (this.memo?.sel !== sel) this.memo = { sel, owners: emailOwners(sel) };
    return this.memo.owners;
  }

  protected override createRenderRoot(): HTMLElement { return this; }

  override connectedCallback(): void {
    super.connectedCallback();
    this.offSolo = onSoloChange(() => this.requestUpdate());
  }
  override disconnectedCallback(): void {
    this.offSolo?.(); this.offSolo = null;
    super.disconnectedCallback();
  }

  private build(): void {
    if (this.built || this.solo) return; // nothing is built for a solo org: no group, no log table
    this.built = true;
    if (this.demo) {
      // The second ticked owner stalls once so "Try again" can be seen (as in prototype D).
      const sel = getEmailSelection();
      const owners = sel ? this.ownersFor(sel).filter((o) => o.rows.length) : [];
      const failOnceFor = owners.length > 1 ? owners[1]!.username : null;
      this.notifier = createDemoNotifier({ self: this.admin.username, delayMs: 250, failOnceFor, leftover: DEMO_LEFTOVERS }).notifier;
      this.nudgeLog = createDemoNudgeLog({ self: this.admin.username, orgId: this.orgId, delayMs: 150 }).log;
      return;
    }
    if (!this.writable || !this.manager) { this.notifier = null; return; }
    try {
      const real = createSessionNotifier(this.manager, { portal: PORTAL_URL, self: this.admin.username, orgId: this.orgId });
      this.notifier = gateNotifier(real, ALLOW_OWNER_SENDS);
      this.nudgeLog = gateNudgeLog(createSessionNudgeLog(this.manager, { portal: PORTAL_URL, self: this.admin.username, orgId: this.orgId }), ALLOW_OWNER_SENDS);
    } catch (e) {
      if (!(e instanceof WritesDisabled)) throw e;
      this.notifier = null;
      this.nudgeLog = null;
    }
  }

  private get solo(): boolean { return isSolo(); }

  protected override willUpdate(): void { this.build(); }

  protected override updated(): void {
    if (this.solo) go('review');
  }

  protected override render() {
    if (this.solo) return html`<section data-page="emails" data-solo hidden></section>`;
    const sel = getEmailSelection();
    const back = () => go(this.demo ? 'demo' : 'review');
    if (!sel || !sel.items.length) {
      return html`<section data-page="emails" data-empty>
        <h1>Write the emails</h1>
        <p>Nobody is ticked yet. Tick an owner’s items on the review first.</p>
        <calcite-button data-action="emails-back" icon-start="arrow-left" @click=${back}>Back to review</calcite-button>
      </section>`;
    }
    return html`<dc-emails data-page="emails" .owners=${this.ownersFor(sel)} .admin=${this.admin} .org=${{ name: this.orgName }}
      .notifier=${this.notifier} .nudgeLog=${this.nudgeLog} orgId=${this.orgId} ?demo=${this.demo} ?writable=${this.demo || this.writable} ?allowOwnerSends=${ALLOW_OWNER_SENDS}
      @dc-emails-back=${back}></dc-emails>`;
  }
}

declare global { interface HTMLElementTagNameMap { 'app-emails': AppEmails } }
