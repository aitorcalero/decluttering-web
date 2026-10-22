// DC-019: the Emails step (prototype D's email.js, re-implemented in Lit). Write and preview one digest per owner,
// send a test to yourself, and only after an explicit confirm send real digests, one owner at a time, with pause,
// resume and retry. Who may send what is decided in ./gate; digests are built in ./digest; the run is ./send-queue.
// Light DOM, so the global Calcite and token styles apply (src/styles/emails.css).
import { noEmailLine, selectAll, selectionOf, selectNone, splitByEmail } from './select';
import { testToast } from './toast-copy';
import { LitElement, html, nothing, type PropertyValues } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import '@esri/calcite-components/dist/components/calcite-action';
import '@esri/calcite-components/dist/components/calcite-alert';
import '@esri/calcite-components/dist/components/calcite-avatar';
import '@esri/calcite-components/dist/components/calcite-button';
import '@esri/calcite-components/dist/components/calcite-checkbox';
import '@esri/calcite-components/dist/components/calcite-dialog';
import '@esri/calcite-components/dist/components/calcite-icon';
import '@esri/calcite-components/dist/components/calcite-input';
import '@esri/calcite-components/dist/components/calcite-label';
import '@esri/calcite-components/dist/components/calcite-loader';
import '@esri/calcite-components/dist/components/calcite-notice';
import '@esri/calcite-components/dist/components/calcite-panel';
import '@esri/calcite-components/dist/components/calcite-progress';
import '@esri/calcite-components/dist/components/calcite-radio-button';
import '@esri/calcite-components/dist/components/calcite-radio-button-group';
import '@esri/calcite-components/dist/components/calcite-segmented-control';
import '@esri/calcite-components/dist/components/calcite-segmented-control-item';
import '../../styles/emails.css';
import { GROUP_TITLE, type GroupNotifier } from '../../notify';
import { getLogChoice, getNudgeLog, LOG_TITLE, setLogChoice, setNudgeLog, withSend, type LogChoice, type NudgeLog } from '../../log';
import { agoText, credit, plural } from '../shared/text';
import {
  buildDigest, chipsToTokens, emailHtml, esc, fillSubject, firstName, outsideLinks, PH_LABEL, PLACEHOLDERS, TONES, tokensToChips, totalCredits,
  usedPlaceholders, type Admin, type EmailOrg, type EmailOwner, type PlaceholderKey, type ToneKey,
} from './digest';
import { nextSendStep, sendGate, type Gate, type SendStep } from './gate';
import { createSendQueue, tidyLine, tidyWarning, type QueueItem, type QueueSnapshot, type SendQueue } from './send-queue';

const INTRO_KEY = 'dc-email-intro-hidden';
const introHidden = (): boolean => { try { return localStorage.getItem(INTRO_KEY) === '1'; } catch { return false; } };

/** The template draft survives leaving and coming back to this step, in memory only (it can name nobody). */
const draft: { tone: ToneKey; subject: string; tpl: string; dirty: boolean } = {
  tone: 'friendly', subject: TONES.friendly.subject, tpl: TONES.friendly.html, dirty: false,
};

type SetupState = 'work' | 'done' | 'reuse';
interface Toast { title: string; message: string; kind: 'success' | 'danger' }
type Dialog = 'intro' | 'consent' | 'confirm' | 'tone' | 'link' | null;

const PHASE_LABEL: Record<QueueItem['phase'], string> = {
  waiting: 'Waiting its turn', sending: 'Adding, sending, removing from the group…', done: 'Sent and removed from the group',
  failed: 'Didn’t go through', skipped: 'Left for another time', 'not-added': 'Couldn’t be added to the group, so nothing was sent',
};

@customElement('dc-emails')
export class DcEmails extends LitElement {
  /** Every owner on the review's list; `rows` holds only their ticked items (none: shown, but can't be sent to). */
  @property({ attribute: false }) owners: EmailOwner[] = [];
  @property({ attribute: false }) admin: Admin = { name: '', username: '' };
  @property({ attribute: false }) org: EmailOrg = { name: '' };
  /** null: this org is read-only in this build (DC-058), so nothing can be sent. */
  @property({ attribute: false }) notifier: GroupNotifier | null = null;
  @property({ type: Boolean }) demo = false;
  @property({ type: Boolean }) writable = false;
  @property({ type: Boolean }) allowOwnerSends = false;
  /** DC-017: the nudge log (null: no log possible here, e.g. a read-only org). */
  @property({ attribute: false }) nudgeLog: NudgeLog | null = null;
  /** The org the review data is from: the remembered log choice and the in-memory log are per org. */
  @property() orgId = '';

  @state() private tone: ToneKey = draft.tone;
  @state() private subject = draft.subject;
  @state() private tpl = draft.tpl;
  @state() private ticked = new Set<string>();
  @state() private sel: string | null = null;
  @state() private canCreate: boolean | null = null;
  @state() private missing = '';
  @state() private setup: SetupState | null = null;
  /** DC-068: what tidying the group before this run did. */
  @state() private tidy: { line: string | null; warn: string | null } | null = null;
  @state() private testBusy = false;
  @state() private testSentAt: number | null = null;
  @state() private step: SendStep = 'compose';
  @state() private mode: 'all' | 'one' = 'all';
  @state() private oneIdx = 0;
  @state() private snap: QueueSnapshot | null = null;
  @state() private dialog: Dialog = null;
  @state() private toast: Toast | null = null;
  @state() private live = '';
  @state() private lifeChoice: 'keep' | 'remove' = 'keep';
  @state() private groupRemoved: 'no' | 'working' | 'yes' = 'no';
  /** DC-017: null while unknown. */
  @state() private logExists: boolean | null = null;
  @state() private logChoice: LogChoice = 'log';
  @state() private logSetup: SetupState | null = null;
  @state() private logged = 0;
  @state() private logWarn = '';
  /** The choice in force for the run under way (fixed at confirm). */
  private logOn = false;
  private pendingTone: ToneKey | null = null;
  private queue: SendQueue | null = null;
  private savedRange: Range | null = null;
  private returnFocus: HTMLElement | null = null;
  private checkedFor: GroupNotifier | null | undefined = undefined;

  @query('.em-editor') private editor!: HTMLElement;

  protected override createRenderRoot(): HTMLElement { return this; }

  /* ------------------------------------------------------------ derived */
  private get ctx() { return { admin: this.admin, org: this.org }; }
  private get template() { return { subject: this.subject, html: this.tpl }; }
  /** DC-121: who has no email on file (none are flagged when no address was loaded at all). */
  private get noEmail(): Set<string> { return new Set(splitByEmail(this.owners).noEmail.map((o) => o.username)); }
  private get sendable(): EmailOwner[] { const no = this.noEmail; return this.owners.filter((o) => o.rows.length > 0 && !no.has(o.username)); }
  private get picked(): EmailOwner[] { return this.sendable.filter((o) => this.ticked.has(o.username)); }
  private get previewOwner(): EmailOwner | undefined {
    return this.sendable.find((o) => o.username === this.sel) ?? this.picked[0] ?? this.sendable[0];
  }
  private get gate(): Gate {
    return sendGate({
      demo: this.demo, allowOwnerSends: this.allowOwnerSends, writable: this.writable && !!this.notifier,
      canCreate: this.notifier ? this.canCreate : false, missing: this.missing, owners: this.picked.length,
      adminEmail: this.admin.email,
    });
  }

  /* ------------------------------------------------------------ lifecycle */
  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('owners')) {
      this.ticked = new Set(this.sendable.map((o) => o.username));
      if (!this.sendable.some((o) => o.username === this.sel)) this.sel = this.sendable[0]?.username ?? null;
    }
    if (this.checkedFor !== this.notifier) { this.checkedFor = this.notifier; void this.checkRole(); }
    if (changed.has('orgId')) this.logChoice = getLogChoice(this.orgId) ?? 'log';
    if (changed.has('nudgeLog')) void this.checkLog();
    if (!this.hasUpdated && !introHidden()) { this.returnFocus = null; this.dialog = 'intro'; }
  }

  protected override firstUpdated(): void {
    this.loadEditor(this.tpl);
  }

  /** Reads only: the role's privileges, then whether the app's hidden group is already there. */
  private async checkRole(): Promise<void> {
    const n = this.notifier;
    this.canCreate = null;
    if (!n) return;
    try {
      const r = await n.canCreateGroup();
      if (n !== this.notifier) return;
      this.missing = r.missing ?? '';
      if (r.ok) await n.findGroup();
      this.canCreate = r.ok;
    } catch (e) {
      if (n !== this.notifier) return;
      this.canCreate = false;
      this.missing = '';
      this.showToast('We couldn’t check your role', e instanceof Error ? e.message : String(e), 'danger');
    }
  }

  /** DC-017: a read only: is the app's nudge log already in the admin's content? */
  private async checkLog(): Promise<void> {
    const l = this.nudgeLog;
    this.logExists = null;
    if (!l) return;
    try {
      const t = await l.find();
      if (l === this.nudgeLog) this.logExists = !!t;
    } catch {
      if (l === this.nudgeLog) this.logExists = false;
    }
  }

  /* ------------------------------------------------------------ editor */
  private loadEditor(tpl: string): void {
    if (this.editor) this.editor.innerHTML = tokensToChips(tpl);
  }
  private readEditor = (): void => {
    this.tpl = chipsToTokens(this.editor.innerHTML);
    draft.tpl = this.tpl; draft.dirty = true;
  };
  private remember = (): void => {
    const s = getSelection();
    if (s?.rangeCount && this.editor.contains(s.anchorNode)) this.savedRange = s.getRangeAt(0).cloneRange();
  };
  private restore(): void {
    this.editor.focus();
    const s = getSelection();
    if (!s) return;
    if (this.savedRange) { s.removeAllRanges(); s.addRange(this.savedRange); return; }
    const r = document.createRange(); r.selectNodeContents(this.editor); r.collapse(false);
    s.removeAllRanges(); s.addRange(r);
  }
  private exec(cmd: string, value?: string): void {
    this.restore();
    document.execCommand(cmd, false, value);
    this.readEditor();
    this.remember();
  }
  private onPaste = (e: ClipboardEvent): void => {
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') ?? '');
  };
  private insertPlaceholder(k: PlaceholderKey): void {
    this.exec('insertHTML', `<span class="ph" contenteditable="false" data-ph="${k}" title="Filled in for each owner">${esc(PH_LABEL[k])}</span>&nbsp;`);
  }
  private addLink = (): void => {
    const input = this.querySelector<HTMLInputElement>('#em-link-url');
    const url = (input?.value ?? '').trim();
    this.closeDialog();
    if (!/^https?:\/\/\S+$/i.test(url)) return;
    const sel = this.savedRange;
    if (!sel || sel.collapsed) this.exec('insertHTML', `<a href="${esc(url)}">${esc(url)}</a>`);
    else this.exec('createLink', url);
  };

  private onTone = (e: Event): void => {
    const k = (e.target as HTMLInputElement).value as ToneKey;
    if (k === this.tone) return;
    if (!draft.dirty) { this.applyTone(k); return; }
    this.pendingTone = k;
    this.openDialog('tone', null);
  };
  private applyTone(k: ToneKey): void {
    this.tone = k; this.subject = TONES[k].subject; this.tpl = TONES[k].html;
    Object.assign(draft, { tone: k, subject: this.subject, tpl: this.tpl, dirty: false });
    this.loadEditor(this.tpl);
  }
  private keepTone(): void {
    this.pendingTone = null;
    const item = this.querySelector<HTMLElement & { checked: boolean }>(`#em-tone calcite-segmented-control-item[value="${this.tone}"]`);
    if (item) item.checked = true;
  }

  /* ------------------------------------------------------------ dialogs (focus goes back where it came from) */
  private openDialog(d: Exclude<Dialog, null>, from: EventTarget | null): void {
    this.returnFocus = (from as HTMLElement | null) ?? (document.activeElement as HTMLElement | null);
    this.dialog = d;
  }
  private closeDialog(): void {
    const was = this.dialog;
    this.dialog = null;
    if (was === 'tone' && this.pendingTone) this.keepTone();
    // A dialog that opened by itself (the first-visit "Before you send") has no opener: go to the page heading, not the logo (A11Y-04).
    const opener = this.returnFocus;
    const back = opener && opener !== document.body && opener.isConnected ? opener : this.querySelector<HTMLElement>('#email-h');
    this.returnFocus = null;
    if (back && was !== 'confirm') requestAnimationFrame(() => {
      const el = back as HTMLElement & { setFocus?: () => Promise<void> };
      if (el.setFocus) void el.setFocus(); else el.focus?.();
    });
  }
  /** A11Y-04: a dialog opens on its marked control (the field, or the safe choice), not on Calcite's Close button. */
  private focusMarked = (e: Event): void => {
    const el = (e.currentTarget as HTMLElement).querySelector<HTMLElement & { setFocus?: () => Promise<void> }>('[data-focus]');
    if (el) requestAnimationFrame(() => { if (el.setFocus) void el.setFocus(); else el.focus(); });
  };
  private onDialogClose = (d: Dialog) => () => { if (this.dialog === d) this.closeDialog(); };
  private closeIntro = (): void => {
    const skip = this.querySelector<HTMLInputElement>('#em-intro-skip')?.checked;
    try { if (skip) localStorage.setItem(INTRO_KEY, '1'); else localStorage.removeItem(INTRO_KEY); } catch { /* storage blocked: it shows again */ }
    this.closeDialog();
  };

  private showToast(title: string, message: string, kind: Toast['kind'] = 'success'): void {
    this.toast = { title, message, kind };
    this.live = `${title}. ${message}`;
  }

  /* ------------------------------------------------------------ test to me */
  private onTest = (e: Event): void => {
    if (!this.gate.test.ok || this.testBusy || !this.notifier) return;
    // ADR 0005 tier 2: creating the group needs the admin's OK first; an existing group is simply reused.
    if (!this.notifier.group) { this.openDialog('consent', e.currentTarget); return; }
    void this.sendTest();
  };
  private async sendTest(): Promise<void> {
    const n = this.notifier, o = this.previewOwner;
    if (!n || !o || this.testBusy || !this.gate.test.ok) return;
    this.testBusy = true;
    try {
      await this.ensureGroup();
      const d = buildDigest(o, this.template, this.ctx, { test: true });
      await n.sendTest(d.subject, d.html); // to the signed-in admin only; there is no way to name anyone else
      this.testSentAt = Date.now();
      const t = testToast(this.admin.email, firstName(o.fullName));
      this.showToast(t.title, t.message);
    } catch (err) {
      this.showToast('The test didn’t go through', err instanceof Error ? err.message : String(err), 'danger');
    } finally {
      this.testBusy = false;
    }
  }
  /** Find-or-create the hidden group, showing a status row while it works. */
  private async ensureGroup(): Promise<void> {
    const n = this.notifier!;
    if (n.group) { this.setup = 'reuse'; return; }
    this.setup = 'work';
    try {
      const g = await n.createGroup();
      this.setup = g.reused ? 'reuse' : 'done';
    } catch (e) {
      this.setup = null;
      throw e;
    }
  }

  /* ------------------------------------------------------------ real sends */
  private onReal = (e: Event): void => {
    const next = nextSendStep(this.step, { type: 'ask' }, this.gate);
    if (next !== 'confirming') return;
    this.step = next;
    this.openDialog('confirm', e.currentTarget);
  };
  private cancelConfirm = (): void => {
    this.step = nextSendStep(this.step, { type: 'cancel' }, this.gate);
    this.closeDialog();
  };
  private confirmSend = (): void => {
    const next = nextSendStep(this.step, { type: 'confirm' }, this.gate);
    this.dialog = null;
    if (next === 'sending') {
      // The admin's answer is remembered for next time, and can be changed at any send.
      if (this.nudgeLog) setLogChoice(this.orgId, this.logChoice);
      this.logOn = !!this.nudgeLog && this.logChoice === 'log';
    }
    this.step = next;
    if (next === 'sending') void this.startRun();
  };

  private async startRun(): Promise<void> {
    const n = this.notifier;
    if (!n) { this.step = 'compose'; return; }
    const entries = this.picked.map((o) => {
      const d = buildDigest(o, this.template, this.ctx);
      return { username: o.username, fullName: o.fullName, subject: d.subject, html: d.html };
    });
    const total = entries.length;
    const q = createSendQueue(entries, async (u, s, h) => {
      const r = await n.sendToOwner(u, s, h);
      if (r.sent && !r.notAdded && this.logOn) await this.logSend(u);
      return r;
    }, (ev) => {
      this.snap = q.snapshot();
      if (ev.type !== 'phase') return;
      const i = this.snap.items.findIndex((x) => x.username === ev.item.username) + 1;
      const who = ev.item.fullName;
      if (ev.item.phase === 'sending') this.live = `Sending to ${who}, ${i} of ${total}.`;
      else if (ev.item.phase === 'done') this.live = `Sent to ${who}. ${this.snap.sent} of ${total} sent.`;
      else if (ev.item.phase === 'failed' || ev.item.phase === 'not-added') this.live = `${who}: didn’t go through. ${ev.item.error}`;
    });
    this.queue = q;
    this.snap = q.snapshot();
    this.toast = null;
    this.oneIdx = 0;
    this.groupRemoved = 'no';
    this.tidy = null;
    this.lifeChoice = 'keep';
    this.logged = 0; this.logWarn = ''; this.logSetup = null;
    this.live = this.mode === 'one' ? 'One owner at a time. Nothing goes out until you press Send on an owner.' : `Sending ${plural(total, 'digest', 'digests')}, one owner at a time.`;
    try {
      await this.ensureGroup();
      if (this.logOn) await this.ensureLog();
    } catch (err) {
      this.showToast('Setup didn’t finish', err instanceof Error ? err.message : String(err), 'danger');
      this.queue = null; this.snap = null; this.step = 'compose';
      return;
    }
    await this.tidyFirst(n);
    if (this.mode === 'all') { await q.run(); this.afterRun(); }
    else this.requestUpdate();
  }
  /** DC-017: find-or-create the nudge log (the admin chose it at confirm), showing a status row while it works. */
  private async ensureLog(): Promise<void> {
    const l = this.nudgeLog!;
    if (l.table) { this.logSetup = 'reuse'; return; }
    this.logSetup = 'work';
    try {
      const t = await l.create();
      this.logSetup = t.reused ? 'reuse' : 'done';
      this.logExists = true;
    } catch (e) {
      this.logSetup = null;
      throw e;
    }
  }
  /** DC-017: one row per owner actually sent to. A failed row never undoes or fails the send; it warns. */
  private async logSend(username: string): Promise<void> {
    const l = this.nudgeLog, o = this.owners.find((x) => x.username === username);
    if (!l || !o) return;
    const at = new Date();
    try {
      await l.record({ owner: username, sentAt: at, itemIds: o.rows.map((r) => r.id), credits: totalCredits(o.rows), sender: this.admin.username });
      this.logged += 1;
      setNudgeLog(this.orgId, withSend(getNudgeLog(this.orgId), username, at));
    } catch (e) {
      this.logWarn = `The email went, but the nudge log didn't take a note of it (${e instanceof Error ? e.message : String(e)}). Next time we may not flag who you nudged.`;
    }
  }
  /** DC-017: after a logged run, read the table back so the review shows what it really holds. */
  private async readBack(): Promise<void> {
    const l = this.nudgeLog;
    if (!l?.table || !this.logged) return;
    try { setNudgeLog(this.orgId, await l.read()); } catch { /* the rows just added are already shown */ }
  }

  /** DC-068 (ADR 0002): each owner-send run starts by taking leftovers out of the app's group. A failure warns, never blocks. */
  private async tidyFirst(n: GroupNotifier): Promise<void> {
    try {
      const r = await n.tidyGroup();
      this.tidy = { line: tidyLine(r), warn: tidyWarning(r) };
      if (this.tidy.line) this.live = this.tidy.line;
    } catch (e) {
      this.tidy = { line: null, warn: `The group couldn't be tidied first (${e instanceof Error ? e.message : String(e)}). Nobody in it is emailed unless they're in this run.` };
    }
  }
  private afterRun(): void {
    const s = this.queue?.snapshot();
    if (s && s.finished && s.failed === 0 && this.mode === 'all') this.finish();
  }
  private finish(): void {
    if (this.queue?.snapshot().running) return;
    this.step = nextSendStep(this.step, { type: 'finished' }, this.gate);
    this.snap = this.queue?.snapshot() ?? null;
    const sent = this.snap?.sent ?? 0;
    void this.readBack();
    this.live = sent ? `All done. ${plural(sent, 'owner has', 'owners have')} their email.` : 'Nothing was sent.';
    requestAnimationFrame(() => this.querySelector<HTMLElement & { setFocus?: () => void }>('#done-back')?.setFocus?.());
  }
  private togglePause = async (): Promise<void> => {
    const q = this.queue;
    if (!q) return;
    if (q.snapshot().paused) { this.live = 'Resumed.'; await q.resume(); this.afterRun(); }
    else { q.pause(); this.live = 'Paused. Nothing further goes out until you resume.'; }
  };
  private retry = async (u: string): Promise<void> => {
    const q = this.queue;
    if (!q || q.snapshot().running) return;
    await q.retry(u);
    this.afterRun();
  };
  private giveUp = (): void => { this.queue?.giveUpFailed(); this.finish(); };

  /* one at a time */
  private async oneSend(): Promise<void> {
    const q = this.queue, s = this.snap;
    const cur = s?.items[this.oneIdx];
    if (!q || !cur || s.running) return;
    await q.sendOne(cur.username);
  }
  private oneAdvance(): void {
    if (!this.snap) return;
    if (this.oneIdx + 1 >= this.snap.items.length) this.finish();
    else this.oneIdx += 1;
  }

  private async removeGroup(): Promise<void> {
    const n = this.notifier;
    if (!n?.group) return;
    this.groupRemoved = 'working';
    try {
      await n.deleteGroup();
      this.groupRemoved = 'yes';
      this.live = 'The hidden group was removed.';
    } catch (e) {
      this.groupRemoved = 'no';
      this.showToast('The group wasn’t removed', e instanceof Error ? e.message : String(e), 'danger');
    }
  }

  private again = (): void => {
    this.step = nextSendStep(this.step, { type: 'again' }, this.gate);
    this.queue = null; this.snap = null; this.setup = null; this.tidy = null; this.logSetup = null;
  };

  private back = (): void => { this.dispatchEvent(new CustomEvent('dc-emails-back', { bubbles: true, composed: true })); };

  /* ------------------------------------------------------------ rendering */
  private whyOff(o: EmailOwner): { icon: string; text: string } | null {
    if (this.noEmail.has(o.username)) return { icon: 'email-address', text: 'No email on file' };
    if (o.rows.length) return null;
    if (o.nudgedRecently) return { icon: 'clock', text: `Nudged ${agoText(o.nudgedDaysAgo)}, so resting for now. Tick their items on the review to include them.` };
    return { icon: 'information', text: 'No items ticked on the review step.' };
  }

  private renderOwners() {
    const sel = selectionOf(this.sendable.map((o) => o.username), this.ticked), locked = this.step !== 'compose';
    return html`<div class="em-selectbar" data-select-bar style="display:flex;align-items:center;gap:0.25rem;padding:0.25rem 0.5rem;flex-wrap:wrap;">
      <calcite-button data-action="select-all" scale="s" appearance="transparent" kind="neutral" ?disabled=${locked || sel.state === 'all' || !sel.total}
        @click=${() => { this.ticked = selectAll(this.sendable.map((o) => o.username)); }}>Select all</calcite-button>
      <calcite-button data-action="select-none" scale="s" appearance="transparent" kind="neutral" ?disabled=${locked || sel.state === 'none'}
        @click=${() => { this.ticked = selectNone(); }}>Select none</calcite-button>
      <small class="muted" data-select-count role="status" aria-live="polite">${sel.label}</small>
    </div>
    <ul class="em-owner-list" aria-label="Owners">${this.owners.map((o) => {
      const why = this.whyOff(o), on = !why && this.ticked.has(o.username), selected = o.username === this.previewOwner?.username;
      return html`<li class="em-owner ${selected ? 'sel' : ''} ${on ? '' : 'off'} ${why ? 'dis' : ''}" data-owner=${o.username}>
        <calcite-checkbox label="Send ${o.fullName} a digest" ?checked=${on} ?disabled=${!!why || this.step !== 'compose'}
          @calciteCheckboxChange=${(e: Event) => {
            const next = new Set(this.ticked);
            if ((e.target as HTMLInputElement).checked) next.add(o.username); else next.delete(o.username);
            this.ticked = next;
          }}></calcite-checkbox>
        <button type="button" class="em-pick" aria-pressed=${selected ? 'true' : 'false'} ?disabled=${!!why}
          @click=${() => { this.sel = o.username; }}>
          <span class="em-oid"><b>${o.fullName}</b><small>${o.rows.length ? `${plural(o.rows.length, 'item', 'items')} · ≈ ${credit(totalCredits(o.rows))} credits a month` : 'Nothing ticked'}</small>
          ${why ? html`<span class="em-why"><calcite-icon icon=${why.icon} scale="s" aria-hidden="true"></calcite-icon>${why.text}</span>` : nothing}</span>
        </button>
      </li>`;
    })}</ul>`;
  }

  private inbox(o: EmailOwner) {
    const from = this.admin.email ? `<${this.admin.email}>` : '(you)';
    return html`<div class="inbox">
      <div class="inbox-meta">
        <div class="inbox-subj" data-preview="subject">${fillSubject(this.subject, o, this.ctx)}</div>
        <div class="inbox-line"><calcite-avatar scale="s" full-name=${this.admin.name} username=${this.admin.username}></calcite-avatar>
          <span><b>${this.admin.name}</b> <span class="muted">${from}</span><br><span class="muted small">to ${o.fullName}${o.email ? ` <${o.email}>` : ''}</span></span></div>
      </div>
      <div class="inbox-body" data-preview="body">${unsafeHTML(emailHtml(this.tpl, o, this.ctx))}</div>
    </div>`;
  }

  private renderEditor() {
    const used = usedPlaceholders(this.tpl);
    const outside = outsideLinks(this.tpl);
    return html`<div class="em-edit-body">
      <calcite-segmented-control id="em-tone" width="full" scale="m" label="Tone" @calciteSegmentedControlChange=${this.onTone}>
        ${(Object.keys(TONES) as ToneKey[]).map((k) => html`<calcite-segmented-control-item value=${k} ?checked=${k === this.tone}>${TONES[k].label}</calcite-segmented-control-item>`)}
      </calcite-segmented-control>
      <calcite-label>Subject<calcite-input id="em-subject" scale="s" label="Subject" .value=${this.subject}
        @calciteInputInput=${(e: Event) => { this.subject = (e.target as HTMLInputElement).value; draft.subject = this.subject; draft.dirty = true; }}></calcite-input></calcite-label>
      <div class="em-tools" role="toolbar" aria-label="Formatting" @mousedown=${(e: Event) => e.preventDefault()}>
        <calcite-button scale="s" appearance="outline-fill" kind="neutral" label="Bold" @click=${() => this.exec('bold')}><b>B</b></calcite-button>
        <calcite-button scale="s" appearance="outline-fill" kind="neutral" label="Italic" @click=${() => this.exec('italic')}><i>I</i></calcite-button>
        <calcite-button scale="s" appearance="outline-fill" kind="neutral" icon-start="link" label="Link" @click=${(e: Event) => { this.remember(); this.openDialog('link', e.currentTarget); }}></calcite-button>
        <calcite-button scale="s" appearance="outline-fill" kind="neutral" label="Bullet list" @click=${() => this.exec('insertUnorderedList')}>&bull; List</calcite-button>
      </div>
      <div class="em-editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Email template" spellcheck="true"
        @input=${this.readEditor} @paste=${this.onPaste} @keyup=${this.remember} @mouseup=${this.remember} @focusout=${this.remember}></div>
      <div class="em-chips" @mousedown=${(e: Event) => e.preventDefault()}><span class="muted small">Add a placeholder:</span>
        ${PLACEHOLDERS.map(([k, l]) => html`<calcite-button data-ph=${k} scale="s" appearance="outline" kind="brand" icon-start="plus" @click=${() => this.insertPlaceholder(k)}>${l}</calcite-button>`)}
      </div>
      ${used.includes('itemList') ? nothing : html`<calcite-notice open scale="s" kind="warning" icon="exclamation-mark-triangle"><div slot="message">The template has no item list, so owners won't see which items you mean. Add the “Item list” placeholder.</div></calcite-notice>`}
      ${outside.length ? html`<calcite-notice open scale="s" kind="warning" icon="link"><div slot="message">ArcGIS Online may refuse to send links it can't check, such as ${outside[0]}. Links to your org's own items are fine.</div></calcite-notice>` : nothing}
    </div>`;
  }

  private setupRow() {
    if (!this.setup) return nothing;
    const t = this.tidy;
    const tidyRows = t ? html`${t.line ? html`<div class="em-setup done" data-tidy="done" role="status"><calcite-icon icon="group" scale="s" aria-hidden="true"></calcite-icon><span>${t.line}</span><calcite-icon class="ok" icon="check-circle" scale="s" aria-hidden="true"></calcite-icon></div>` : nothing}
      ${t.warn ? html`<div class="em-setup em-warn" data-tidy="warn" role="alert"><calcite-icon icon="exclamation-mark-triangle" scale="s" aria-hidden="true"></calcite-icon><span>${t.warn}</span></div>` : nothing}` : nothing;
    const text = this.setup === 'work' ? `Creating the hidden group “${GROUP_TITLE}”…`
      : this.setup === 'done' ? `Created the hidden group “${GROUP_TITLE}”. Hidden and invitation-only; only you can see it.`
      : `Using the hidden group “${GROUP_TITLE}” again. Only you can see it.`;
    return html`${tidyRows}<div class="em-setup ${this.setup}" data-setup=${this.setup}><calcite-icon icon="group" scale="s" aria-hidden="true"></calcite-icon><span>${text}</span>
      ${this.setup === 'work' ? html`<calcite-loader inline label="Working"></calcite-loader>` : html`<calcite-icon class="ok" icon="check-circle" scale="s" aria-hidden="true"></calcite-icon>`}</div>${this.logRow()}`;
  }

  /** DC-017: the nudge log's status while a run is set up, and a warning if a row didn't go in. */
  private logRow() {
    const s = this.logSetup;
    const text = s === 'work' ? `Creating your private nudge log “${LOG_TITLE}”…`
      : s === 'done' ? `Created your private nudge log “${LOG_TITLE}”. Only you can see it.`
      : `Adding to your private nudge log “${LOG_TITLE}”.`;
    return html`${s ? html`<div class="em-setup ${s}" data-log-setup=${s}><calcite-icon icon="table" scale="s" aria-hidden="true"></calcite-icon><span>${text}</span>
      ${s === 'work' ? html`<calcite-loader inline label="Working"></calcite-loader>` : html`<calcite-icon class="ok" icon="check-circle" scale="s" aria-hidden="true"></calcite-icon>`}</div>` : nothing}
      ${this.logWarn ? html`<div class="em-setup em-warn" data-log="warn" role="alert"><calcite-icon icon="exclamation-mark-triangle" scale="s" aria-hidden="true"></calcite-icon><span>${this.logWarn}</span></div>` : nothing}`;
  }

  private renderBar() {
    const g = this.gate, n = this.picked;
    const items = n.reduce((s, o) => s + o.rows.length, 0);
    const realLabel = this.mode === 'one' ? `Go through ${plural(n.length, 'owner', 'owners')} one by one` : `Send to ${plural(n.length, 'owner', 'owners')}`;
    const blockNote = g.test.reason === 'read-only' ? 'Sending is off for this organisation in this build. You can still write and preview every email.'
      : g.test.reason === 'no-privilege' ? `${g.test.message} Ask an administrator to add it to your role. You can still write and preview every email here.`
      : g.test.reason === 'no-email' ? g.test.message ?? null
      : null;
    return html`<div class="em-bar" data-bar="emails">
      <div class="em-setup-list">${this.setupRow()}</div>
      ${blockNote ? html`<div class="em-setup em-warn" role="note" data-note=${g.test.reason!}><calcite-icon icon="lock" scale="s" aria-hidden="true"></calcite-icon><span>${blockNote}</span></div>` : nothing}
      <div class="em-bar-row">
        <div class="em-bar-sum"><b data-bar-main>${n.length ? `${plural(n.length, 'owner', 'owners')} · ${plural(items, 'item', 'items')}` : 'No one ticked yet'}</b>
          <span>${this.testSentAt ? 'Your test has been sent. Check your inbox.' : 'Send yourself a test first. It only goes to you.'}</span>
          ${this.demo ? html`<span class="em-bar-note"><calcite-icon icon="information" scale="s" aria-hidden="true"></calcite-icon>Demo: nothing is really sent.</span>`
            : html`<span class="em-bar-note"><calcite-icon icon="lock" scale="s" aria-hidden="true"></calcite-icon>Sent from your own ArcGIS Online org, from this browser. Nothing goes through us.</span>`}</div>
        <div class="em-bar-act">
          <calcite-segmented-control id="em-mode" scale="s" label="How to send" @calciteSegmentedControlChange=${(e: Event) => { this.mode = (e.target as HTMLInputElement).value as 'all' | 'one'; }}>
            <calcite-segmented-control-item value="all" ?checked=${this.mode === 'all'}>All at once</calcite-segmented-control-item>
            <calcite-segmented-control-item value="one" ?checked=${this.mode === 'one'}>One at a time</calcite-segmented-control-item>
          </calcite-segmented-control>
          <calcite-button data-action="test" appearance="outline" kind="brand" icon-start="email-address" ?disabled=${!g.test.ok || !this.previewOwner} ?loading=${this.testBusy}
            @click=${this.onTest}>Send a test to me</calcite-button>
          <span class="em-real-wrap">
            <calcite-button data-action="send" icon-start="envelope" ?disabled=${!g.owners.ok} title=${g.owners.ok ? '' : g.owners.message ?? ''} aria-description=${g.owners.ok ? nothing : g.owners.message ?? nothing} @click=${this.onReal}>${realLabel}</calcite-button>
            ${g.owners.reason === 'owner-sends-off' ? html`<small class="em-off" data-note="owner-sends-off">${g.owners.message}</small>` : nothing}
          </span>
        </div>
      </div>
    </div>`;
  }

  private renderCompose() {
    const o = this.previewOwner;
    return html`<div class="em-head">
        <div><h1 id="email-h" tabindex="-1">Write the emails</h1>
        <p class="lede">One digest per owner. Nothing leaves your browser until you send.</p></div>
        <div class="em-head-act">
          <calcite-action icon="information" text="Before you send" text-enabled scale="s" appearance="transparent" @click=${(e: Event) => this.openDialog('intro', e.currentTarget)}></calcite-action>
          <calcite-button data-action="emails-back" appearance="transparent" kind="neutral" icon-start="arrow-left" scale="s" @click=${this.back}>Back to review</calcite-button>
        </div>
      </div>
      <div class="em-grid">
        <calcite-panel heading="Who gets one" class="em-owners">${this.renderOwners()}</calcite-panel>
        <calcite-panel heading="The template" description="Edit once; it's filled in for each owner." class="em-edit">${this.renderEditor()}</calcite-panel>
        <calcite-panel heading="Preview" description=${o ? `${o.fullName}'s email, with only their ticked items` : 'How it lands in an inbox'} class="em-prev">
          <div class="em-prev-body">${o ? this.inbox(o) : html`<p class="muted">Tick an owner to see their email.</p>`}</div></calcite-panel>
      </div>
      ${this.renderBar()}`;
  }

  private runRow(it: QueueItem) {
    const icon = it.phase === 'done' ? html`<calcite-icon icon="check-circle" scale="s" class="ok"></calcite-icon>`
      : it.phase === 'failed' || it.phase === 'not-added' ? html`<calcite-icon icon="exclamation-mark-triangle" scale="s" class="bad"></calcite-icon>`
      : it.phase === 'sending' ? html`<calcite-loader inline label="Working"></calcite-loader>` : html`<calcite-icon icon="circle" scale="s"></calcite-icon>`;
    const failed = it.phase === 'failed' || it.phase === 'not-added';
    return html`<li class="run-row ${it.phase}" data-run=${it.username} data-phase=${it.phase}>
      <span class="ri">${icon}</span><calcite-avatar scale="s" full-name=${it.fullName} username=${it.username}></calcite-avatar>
      <span class="rn"><b>${it.fullName}</b><small>${PHASE_LABEL[it.phase]}${failed && it.error ? `: ${it.error}` : ''}</small></span>
      ${failed ? html`<calcite-button scale="s" appearance="outline" kind="brand" icon-start="reset" data-action="retry" ?disabled=${this.snap?.running ?? false}
        @click=${() => void this.retry(it.username)}>Try again</calcite-button>` : nothing}
    </li>`;
  }

  private renderRun() {
    const s = this.snap;
    if (!s) return nothing;
    if (this.mode === 'one') return this.renderOne(s);
    const n = s.items.length;
    const settingUp = this.setup === 'work';
    const heading = settingUp ? 'Getting things ready' : s.finished ? 'Nearly there' : s.paused ? 'Paused' : 'Sending the digests';
    const sub = settingUp ? 'Setting up in your own org. Nothing has been sent yet.'
      : s.finished ? `${s.sent} sent, ${s.failed} didn't go through. Have another go at the ones that stalled.`
      : s.paused ? (s.running ? 'Finishing this owner, then nothing further goes out until you resume.' : 'Nothing further goes out until you resume.')
      : 'One owner at a time: add, send, remove, so the group stays empty.';
    return html`<div class="run" data-run-state=${s.finished ? 'finished' : s.paused ? 'paused' : 'running'}>
      <div class="run-head"><div><h1>${heading}</h1><p class="lede">${sub}</p></div>
        <div class="run-act">${s.finished
          ? html`<calcite-button data-action="finish" appearance="outline" kind="neutral" @click=${this.giveUp}>Finish without the rest</calcite-button>`
          : html`<calcite-button data-action="pause" appearance="outline" kind="neutral" icon-start=${s.paused ? 'play' : 'pause'} ?disabled=${settingUp}
              @click=${this.togglePause}>${s.paused ? 'Resume' : 'Pause'}</calcite-button>`}</div></div>
      <div class="em-setup-list">${this.setupRow()}</div>
      <calcite-progress type="determinate" value=${n ? s.sent / n : 0} label="Send progress"></calcite-progress>
      <p class="muted small" data-run-count>${s.sent} of ${n} sent</p>
      <ul class="run-list" aria-label="Owners">${s.items.map((it) => this.runRow(it))}</ul>
      ${this.demo ? html`<p class="em-note"><calcite-icon icon="information" scale="s" aria-hidden="true"></calcite-icon>Demo: nothing is really sent.</p>`
        : html`<p class="em-note"><calcite-icon icon="lock" scale="s" aria-hidden="true"></calcite-icon>Sent from your own ArcGIS Online org, from this browser. Nothing goes through us.</p>`}
    </div>`;
  }

  private renderOne(s: QueueSnapshot) {
    const it = s.items[this.oneIdx];
    if (!it) return nothing;
    const o = this.owners.find((x) => x.username === it.username)!;
    const busy = s.running || this.setup === 'work';
    const failed = it.phase === 'failed' || it.phase === 'not-added';
    return html`<div class="run one" data-run-state="one">
      <div class="run-head"><div><h1>One owner at a time</h1>
        <p class="lede">${this.setup === 'work' ? 'Setting up in your own org. Nothing has been sent yet.' : `${s.sent} sent so far. Nothing goes out until you press Send on an owner.`}</p></div>
        <calcite-button data-action="stop" appearance="outline" kind="neutral" ?disabled=${busy} @click=${() => this.finish()}>Stop here</calcite-button></div>
      <div class="em-setup-list">${this.setupRow()}</div>
      <calcite-progress type="determinate" value=${this.oneIdx / s.items.length} label="Progress"></calcite-progress>
      <p class="one-count">${this.oneIdx + 1} of ${s.items.length}</p>
      <div class="one-card">
        <div class="one-who"><calcite-avatar scale="m" full-name=${o.fullName} username=${o.username}></calcite-avatar>
          <span><b>${o.fullName}</b><small>${plural(o.rows.length, 'item', 'items')} · ≈ ${credit(totalCredits(o.rows))} credits a month</small></span>
          <span class="one-status ${it.phase}" data-phase=${it.phase}>${it.phase === 'waiting' ? '' : `${PHASE_LABEL[it.phase]}${failed && it.error ? `: ${it.error}` : ''}`}</span></div>
        ${this.inbox(o)}
      </div>
      <div class="one-act">
        <calcite-button appearance="transparent" kind="neutral" icon-start="arrow-left" ?disabled=${busy || this.oneIdx === 0} @click=${() => { this.oneIdx -= 1; }}>Back</calcite-button>
        ${it.phase === 'done'
          ? html`<calcite-button data-action="next" icon-end="arrow-right" ?disabled=${busy} @click=${() => this.oneAdvance()}>Next owner</calcite-button>`
          : html`<calcite-button data-action="skip" appearance="outline" kind="neutral" ?disabled=${busy} @click=${() => { this.queue?.skip(it.username); this.oneAdvance(); }}>Skip</calcite-button>
            <calcite-button data-action="send-one" icon-start="envelope" ?disabled=${busy} ?loading=${it.phase === 'sending'} @click=${() => void this.oneSend()}>${failed ? 'Try again' : 'Send this one'}</calcite-button>`}
      </div>
    </div>`;
  }

  private renderDone() {
    const s = this.snap;
    const sentU = new Set(s?.items.filter((i) => i.phase === 'done').map((i) => i.username) ?? []);
    const sent = this.owners.filter((o) => sentU.has(o.username));
    const items = sent.reduce((a, o) => a + o.rows.length, 0), cr = sent.reduce((a, o) => a + totalCredits(o.rows), 0);
    const notRemoved = s?.notRemoved ?? [];
    const hasGroup = !!this.notifier?.group || this.groupRemoved === 'yes';
    return html`<div class="em-done" data-done=${sent.length}>
      <div class="confetti" aria-hidden="true">${sent.length ? Array.from({ length: 28 }, (_, i) => html`<i style="--x:${(i * 37) % 100}%;--d:${(i % 7) * 0.18}s;--c:${['var(--dc-brand-500)', 'var(--dc-pine)', 'var(--dc-amber)', 'var(--dc-raspberry)'][i % 4]};--s:${6 + (i % 3) * 3}px"></i>`) : nothing}</div>
      <div class="done-card">
        <div class="done-badge"><calcite-icon icon="envelope" scale="l"></calcite-icon></div>
        <h1>${sent.length ? 'All sent. Nicely done.' : 'Nothing was sent'}</h1>
        <p class="lede">${sent.length
          ? html`${plural(sent.length, 'owner has', 'owners have')} a friendly note about ${plural(items, 'item', 'items')}. If they all get tidied, about <b class="cr">${credit(cr)} credits a month</b> come back to the org.`
          : 'No one was emailed, and nothing was changed.'}</p>
        <ul class="done-facts">
          <li><calcite-icon icon="check" scale="s"></calcite-icon>Nothing was deleted or changed in anyone's account.</li>
          ${hasGroup ? (notRemoved.length
            ? html`<li class="warn"><calcite-icon icon="exclamation-mark-triangle" scale="s"></calcite-icon>${plural(notRemoved.length, 'owner', 'owners')} couldn't be taken out of the hidden group. You can remove them in ArcGIS Online under Groups.</li>`
            : html`<li><calcite-icon icon="check" scale="s"></calcite-icon>Every owner is out of the hidden group again.</li>`) : nothing}
          ${!sent.length ? nothing : this.logged
            ? html`<li data-done-log="kept"><calcite-icon icon="check" scale="s"></calcite-icon>${plural(this.logged, 'send was', 'sends were')} noted in your private nudge log, so next time we'll flag who you've just nudged.</li>`
            : html`<li data-done-log="none"><calcite-icon icon="check" scale="s"></calcite-icon>No nudge log was kept, so next time we can't flag who you already nudged.</li>`}
          ${this.logWarn ? html`<li class="warn"><calcite-icon icon="exclamation-mark-triangle" scale="s"></calcite-icon>${this.logWarn}</li>` : nothing}
        </ul>
        ${hasGroup ? html`<div class="done-life">
          <h2 class="em-h3"><calcite-icon icon="group" scale="s" aria-hidden="true"></calcite-icon> The hidden group</h2>
          ${this.groupRemoved === 'yes' ? html`<div class="em-setup done" role="status"><span>Removed. Only the app's own group went; nobody's items were touched.</span></div>` : html`
          <calcite-radio-button-group name="em-life" layout="vertical" scale="m" @calciteRadioButtonGroupChange=${(e: Event) => { this.lifeChoice = (e.target as HTMLInputElement & { selectedItem?: { value: string } }).selectedItem?.value === 'remove' ? 'remove' : 'keep'; }}>
            <calcite-label layout="inline"><calcite-radio-button value="keep" ?checked=${this.lifeChoice === 'keep'}></calcite-radio-button><span><b>Keep the hidden group for next time (recommended).</b> It's empty and only you can see it.</span></calcite-label>
            <calcite-label layout="inline"><calcite-radio-button value="remove" ?checked=${this.lifeChoice === 'remove'}></calcite-radio-button><span><b>Remove it now.</b> Only the app's own group goes, never anyone's items. We'd ask before creating it again.</span></calcite-label>
          </calcite-radio-button-group>
          ${this.lifeChoice === 'remove' ? html`<calcite-button data-action="remove-group" appearance="outline" kind="danger" icon-start="group" scale="s" ?loading=${this.groupRemoved === 'working'}
            @click=${() => void this.removeGroup()}>Remove the hidden group</calcite-button>` : nothing}`}
        </div>` : nothing}
        <div class="done-act"><calcite-button id="done-back" icon-start="arrow-left" @click=${this.back}>Back to review</calcite-button>
          <calcite-button appearance="outline" kind="neutral" @click=${this.again}>Write more emails</calcite-button></div>
      </div>
    </div>`;
  }

  /** DC-017 (ADR 0005 tier 3): the nudge-log choice in the confirm dialog. */
  private renderLogChoice() {
    if (!this.nudgeLog) {
      return html`<p class="muted small" data-log-choice="unavailable">No nudge log here, so next time we can't flag who you already nudged.</p>`;
    }
    const exists = this.logExists === true;
    return html`<h3 class="em-h3">Keep a nudge log?</h3>
      <calcite-radio-button-group name="em-log" layout="vertical" scale="m" data-log-choice=${this.logChoice}
        @calciteRadioButtonGroupChange=${(e: Event) => { this.logChoice = (e.currentTarget as HTMLElement & { selectedItem?: { value: string } }).selectedItem?.value === 'none' ? 'none' : 'log'; }}>
        <calcite-label layout="inline"><calcite-radio-button value="log" data-log-option="log" ?checked=${this.logChoice === 'log'}></calcite-radio-button><span>${exists
          ? html`<b>Add to your nudge log (recommended).</b> One row per owner in your private table “${LOG_TITLE}”: who, when and which items.`
          : html`<b>Keep a nudge log (recommended).</b> We create one small private table, “${LOG_TITLE}”, in your own content: who was nudged, when and which items. It uses a negligible amount of storage.`}
          No email addresses or message text. You can delete it any time from About; you’d lose the six-month memory.</span></calcite-label>
        <calcite-label layout="inline"><calcite-radio-button value="none" data-log-option="none" ?checked=${this.logChoice === 'none'}></calcite-radio-button><span><b>Send without a log.</b> Nothing else is created, but next time we can't flag who you nudged. We'll remember this choice.</span></calcite-label>
      </calcite-radio-button-group>`;
  }

  private renderDialogs() {
    const n = this.picked, items = n.reduce((s, o) => s + o.rows.length, 0), cr = n.reduce((s, o) => s + totalCredits(o.rows), 0);
    const needGroup = !this.notifier?.group;
    const one = this.mode === 'one';
    const skipped = this.noEmail, noMail = this.owners.filter((o) => o.rows.length > 0 && skipped.has(o.username)).length;
    const noMailLine = noEmailLine(noMail, n.length + noMail);
    return html`
      <calcite-dialog id="em-intro" modal @calciteDialogOpen=${this.focusMarked} heading="Before you send" width-scale="s" .open=${this.dialog === 'intro'} @calciteDialogClose=${this.onDialogClose('intro')}>
        <ul class="em-intro">
          <li><calcite-icon icon="envelope" scale="m" aria-hidden="true"></calcite-icon><span><b>Nothing goes out until you press Send and confirm.</b> Your test goes only to you.</span></li>
          <li><calcite-icon icon="organization" scale="m" aria-hidden="true"></calcite-icon><span><b>Email goes through your own ArcGIS Online org, from this browser.</b> Nothing passes through us.</span></li>
          <li><calcite-icon icon="group" scale="m" aria-hidden="true"></calcite-icon><span><b>Sending needs one hidden group.</b> Invitation-only and visible only to you. We ask before creating it, then reuse it. You can remove it any time from About.</span></li>
          <li><calcite-icon icon="list-check" scale="m" aria-hidden="true"></calcite-icon><span><b>Your pace.</b> Send all at once, or one owner at a time.</span></li>
        </ul>
        <calcite-label layout="inline" slot="footer-start"><calcite-checkbox id="em-intro-skip" ?checked=${introHidden()}></calcite-checkbox>Don't show this again</calcite-label>
        <calcite-button slot="footer-end" data-action="intro-ok" data-focus @click=${this.closeIntro}>Got it</calcite-button>
      </calcite-dialog>

      <calcite-dialog id="em-consent" modal @calciteDialogOpen=${this.focusMarked} heading="Create the hidden group?" width-scale="s" .open=${this.dialog === 'consent'} @calciteDialogClose=${this.onDialogClose('consent')}>
        <p>To send email, ArcGIS Online needs a group to send through. With your OK, we'll create one now in your org:</p>
        <div class="em-group-card"><calcite-icon icon="group" scale="m" aria-hidden="true"></calcite-icon><div><b>${GROUP_TITLE}</b>
          <ul class="em-settings"><li>Hidden: it doesn't appear in searches</li><li>Invitation-only: nobody can join by themselves</li><li>Members can't see each other</li><li>Only you can see it</li><li>Labelled “${GROUP_TITLE}”, so you can spot it</li></ul></div></div>
        <p class="muted small">Created once and reused. You can remove it later from About, or in ArcGIS Online under Groups. Your test goes only to you.</p>
        <calcite-button slot="footer-start" appearance="transparent" kind="neutral" data-focus @click=${() => this.closeDialog()}>Not now</calcite-button>
        <calcite-button slot="footer-end" data-action="consent-yes" icon-start="group" @click=${() => { this.dialog = null; void this.sendTest(); }}>Create the group and send my test</calcite-button>
      </calcite-dialog>

      <calcite-dialog id="em-confirm" modal @calciteDialogOpen=${this.focusMarked} heading=${one ? 'Ready to start?' : 'Ready to send?'} width-scale="s" .open=${this.dialog === 'confirm'} @calciteDialogClose=${() => { if (this.dialog === 'confirm') this.cancelConfirm(); }}>
        <div data-confirm>
          <p><b>${plural(n.length, 'owner', 'owners')}</b> will each get one email, covering <b>${plural(items, 'item', 'items')}</b> (about ${credit(cr)} credits a month between them). This is the real thing, not a test.${one ? ' You’ll see each email first and choose Send or Skip. Nothing goes out until you press Send on that owner.' : ''}</p>
          <p>We use your hidden group, “${GROUP_TITLE}”: each owner is added, sent their one email, and removed again straight after.${needGroup ? ' It doesn’t exist yet, so we create it first: hidden, invitation-only, and only you can see it.' : ''}</p>
          ${noMailLine ? html`<p data-confirm-noemail>${noMailLine}</p>` : nothing}
          ${this.testSentAt ? nothing : html`<calcite-notice open kind="warning" icon="exclamation-mark-triangle" scale="s"><div slot="message">You haven't sent yourself a test yet. It only takes a moment.</div></calcite-notice>`}
          ${this.renderLogChoice()}
        </div>
        <calcite-button slot="footer-start" appearance="transparent" kind="neutral" data-focus @click=${this.cancelConfirm}>Go back</calcite-button>
        <calcite-button slot="footer-end" data-action="confirm-send" icon-start="envelope" @click=${this.confirmSend}>${one ? 'Start, one at a time' : `Send ${plural(n.length, 'email', 'emails')} for real`}</calcite-button>
      </calcite-dialog>

      <calcite-dialog id="em-tone-dlg" modal @calciteDialogOpen=${this.focusMarked} heading="Switch tone?" width-scale="s" .open=${this.dialog === 'tone'} @calciteDialogClose=${this.onDialogClose('tone')}>
        <p>Switching to ${this.pendingTone ? TONES[this.pendingTone].label : ''} replaces the template and subject you've edited. Start again from that tone?</p>
        <calcite-button slot="footer-start" appearance="transparent" kind="neutral" data-focus @click=${() => this.closeDialog()}>Keep my edits</calcite-button>
        <calcite-button slot="footer-end" @click=${() => { const k = this.pendingTone; this.pendingTone = null; this.closeDialog(); if (k) this.applyTone(k); }}>Switch and replace</calcite-button>
      </calcite-dialog>

      <calcite-dialog id="em-link-dlg" modal @calciteDialogOpen=${this.focusMarked} heading="Add a link" width-scale="s" .open=${this.dialog === 'link'} @calciteDialogClose=${this.onDialogClose('link')}>
        <calcite-label>Web address<calcite-input id="em-link-url" data-focus type="url" placeholder="https://" label="Web address" value="https://"
          @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') this.addLink(); }}></calcite-input></calcite-label>
        <p class="muted small">Links to your org's own items are safest: ArcGIS Online may refuse to send links it can't check.</p>
        <calcite-button slot="footer-end" @click=${this.addLink}>Add link</calcite-button>
      </calcite-dialog>

      <calcite-alert kind=${this.toast?.kind ?? 'success'} icon=${this.toast?.kind === 'danger' ? 'exclamation-mark-triangle' : 'envelope'} auto-close auto-close-duration="medium" placement="bottom" label="Notice"
        .open=${!!this.toast} @calciteAlertClose=${() => { this.toast = null; }}>
        <div slot="title">${this.toast?.title ?? ''}</div><div slot="message" data-toast>${this.toast?.message ?? ''}</div>
      </calcite-alert>`;
  }

  override render() {
    const composing = this.step === 'compose' || this.step === 'confirming';
    return html`<div class="em" data-step=${this.step}>
      <div class="em-compose" ?hidden=${!composing}>${this.renderCompose()}</div>
      ${this.step === 'sending' ? this.renderRun() : nothing}
      ${this.step === 'done' ? this.renderDone() : nothing}
      <p class="dc-sr" role="status" aria-live="polite" data-live>${this.live}</p>
      ${this.renderDialogs()}
    </div>`;
  }
}

declare global { interface HTMLElementTagNameMap { 'dc-emails': DcEmails } }
