// DC-019: one digest per owner, built from the template the admin edits. Pure strings, no DOM, so it is tested in Node.
// Mirrors prototype D's email.js (tones, placeholders, the inline-styled item list, quick wins first, ADR 0010).
// Links: only the org's own item pages. ArcGIS Online refuses notifications with links it can't validate
// (COM_1132 "Invalid links in the message", docs/research/agol-notify-usage.md). The footer links to the hosted site (FB-16).
import type { Priority } from '../../domain/priority';

/** One ticked item, as the email needs it. `url` is the item's page in the admin's own org. */
export interface EmailRow {
  id: string; title: string; url: string; credits: number; sizeKnown: boolean; why: string; tidy: string | null; priority: Priority;
  /** FB-15 (DC-071a): false when not every map and app was read for this item, so the email says nothing about used-by. */
  depsChecked?: boolean;
  /** DC-083: total views as context ("It's been viewed 585,557 times since it was published, but nobody has used it since March."). */
  context?: string | null;
}

/** One owner on the Emails step. `rows` are the items ticked on Review for this owner only. */
export interface EmailOwner {
  username: string; fullName: string; email?: string;
  rows: EmailRow[];
  nudgedRecently: boolean; nudgedDaysAgo: number | null;
}

export interface Admin { name: string; username: string; email?: string }
export interface EmailOrg { name: string }

export type PlaceholderKey = 'firstName' | 'itemCount' | 'credits' | 'itemList' | 'adminName';
export const PLACEHOLDERS: [PlaceholderKey, string][] = [
  ['firstName', 'First name'], ['itemCount', 'Item count'], ['credits', 'Credits'], ['itemList', 'Item list'], ['adminName', 'Your name'],
];
export const PH_LABEL = Object.fromEntries(PLACEHOLDERS) as Record<PlaceholderKey, string>;

export type ToneKey = 'friendly' | 'brief' | 'formal';
export interface Tone { label: string; subject: string; html: string }

export const TONES: Record<ToneKey, Tone> = {
  friendly: {
    label: 'Friendly',
    subject: '{firstName}, {itemCount} of your ArcGIS items could use a quick look',
    html: `<p>Hi {firstName},</p>
<p>I was having a tidy-up of our ArcGIS Online org and spotted a few of your items that don't seem to be getting much use. Every item keeps costing credits just by sitting there, and these ones add up to about <b>{credits} credits a month</b>.</p>
<p>Here's what caught my eye:</p>
<p>{itemList}</p>
<p>No rush, and nothing has been touched. If something is still needed, just leave it be. If it isn't, a quick tidy-up would be lovely. And if you're not sure, reply to me and we'll work it out together.</p>
<p>Thanks,<br>{adminName}</p>`,
  },
  brief: {
    label: 'Brief',
    subject: 'ArcGIS Online: {itemCount} items to check',
    html: `<p>Hi {firstName},</p>
<p>{itemCount} of your ArcGIS Online items look unused. Together they cost about <b>{credits} credits a month</b>.</p>
<p>{itemList}</p>
<p>Still needed? Leave them. If not, please tidy them up. Questions? Just reply.</p>
<p>{adminName}</p>`,
  },
  formal: {
    label: 'Formal',
    subject: 'Review of your ArcGIS Online items ({itemCount})',
    html: `<p>Dear {firstName},</p>
<p>As part of a routine review of our ArcGIS Online organisation, we identified {itemCount} items that you own and that show little recent use. Retaining them is estimated to cost <b>{credits} credits a month</b>.</p>
<p>The items concerned are listed below.</p>
<p>{itemList}</p>
<p>Please review them and, where they are no longer required, remove them or arrange for them to be retired. No action has been taken on your behalf. If you wish to keep any of them, no reply is necessary.</p>
<p>Kind regards,<br>{adminName}</p>`,
  },
};

/** Email colours and font: inline styles only (mail clients drop style sheets). */
const C = { text: '#1c2b36', muted: '#4a5b66', link: '#164385', pine: '#006f48', line: '#d6dee4', tint: '#f3f6f8' };
const FONT = 'Arial, Helvetica, sans-serif';

export const esc = (s: unknown): string => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Credits a month: one decimal under 10, whole numbers above (same as the review). */
const credit = (c: number): string => (c < 10 ? c.toFixed(1) : Math.round(c).toLocaleString('en-AU'));
export const firstName = (fullName: string): string => fullName.trim().split(/\s+/)[0] || fullName;
export const totalCredits = (rows: Pick<EmailRow, 'credits'>[]): number => rows.reduce((s, r) => s + r.credits, 0);

/** ADR 0010: quick wins first, then the rest, each keeping the review's order. */
export function orderRows<T extends Pick<EmailRow, 'priority'>>(rows: T[]): { quick: T[]; rest: T[] } {
  return { quick: rows.filter((r) => r.priority === 'start'), rest: rows.filter((r) => r.priority !== 'start') };
}

/** FB-15: an email never says "used by: still checking…" or "not checked". When used-by isn't known, that part is left out. */
/** DC-083: the views count is said in a sentence of its own (EmailRow.context), so it leaves the why line. */
export const emailWhy = (why: string, depsChecked?: boolean): string =>
  why.split(' · ').filter((p) => !/^used by:|still checking|not checked/i.test(p.trim()) && (depsChecked !== false || !/\bused by\b/i.test(p)) && !/\bviews? all time$/i.test(p.trim())).join(' · ');

function card(r: EmailRow): string {
  const cr = r.sizeKnown ? `<span style="color:${C.pine};font-weight:bold;"> &middot; about ${credit(r.credits)} credits a month</span>` : '';
  const tip = r.tidy ? `<br><span style="color:${C.text};"><b>Tip:</b> ${esc(r.tidy.replace(/^tip:\s*/i, ''))}</span>` : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 10px;"><tr>
<td style="padding:10px 12px;background:${C.tint};border:1px solid ${C.line};font-family:${FONT};font-size:14px;line-height:1.5;color:${C.text};">
<a href="${esc(r.url)}" style="color:${C.link};font-weight:bold;text-decoration:underline;">${esc(r.title)}</a>${cr}<br>
<span style="color:${C.muted};">${esc(emailWhy(r.why, r.depsChecked))}</span>${r.context ? `<br><span style="color:${C.text};">${esc(r.context)}</span>` : ''}${tip}
</td></tr></table>`;
}

/** The item list: quick wins first under their own heading, then the total. */
export function itemListHtml(rows: EmailRow[]): string {
  const head = (t: string) => `<p style="margin:12px 0 6px;font-family:${FONT};font-size:14px;color:${C.text};"><b>${t}</b></p>`;
  const { quick, rest } = orderRows(rows);
  const items = quick.length
    ? head('The quickest wins') + quick.map(card).join('') + (rest.length ? head('Also on the list') + rest.map(card).join('') : '')
    : rows.map(card).join('');
  return `${items}<p style="margin:6px 0 0;font-family:${FONT};font-size:14px;color:${C.text};"><b>Tidying these could free about <span style="color:${C.pine};">${credit(totalCredits(rows))} credits a month</span>.</b></p>`;
}

interface Ctx { admin: Admin; org: EmailOrg }

/** Plain values for the subject (no HTML). */
function values(o: EmailOwner, ctx: Ctx): Record<Exclude<PlaceholderKey, 'itemList'>, string> {
  return { firstName: firstName(o.fullName), itemCount: String(o.rows.length), credits: credit(totalCredits(o.rows)), adminName: ctx.admin.name };
}

export function fillSubject(subject: string, o: EmailOwner, ctx: Ctx): string {
  const v = values(o, ctx);
  return subject
    .replace(/\{(firstName|itemCount|credits|adminName)\}/g, (_m, k: keyof typeof v) => v[k])
    .replace(/\{itemList\}/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Styles the admin's own paragraphs, lists and links (the item list is added after, with its own styles). */
function styleAuthorHtml(tpl: string): string {
  const P = `margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:1.55;color:${C.text};`;
  return tpl
    .replace(/<p(\s[^>]*)?>/gi, `<p style="${P}">`)
    .replace(/<(ul|ol)(\s[^>]*)?>/gi, (_m, t: string) => `<${t} style="margin:0 0 14px;padding-left:22px;font-family:${FONT};font-size:15px;line-height:1.55;color:${C.text};">`)
    .replace(/<li(\s[^>]*)?>/gi, '<li style="margin:0 0 4px;">')
    .replace(/<a\s[^>]*?href=(["'])([^"']*)\1[^>]*>/gi, (_m, _q: string, href: string) => `<a href="${href}" style="color:${C.link};text-decoration:underline;">`);
}

/** Fills the template for one owner. Values are escaped; the template itself is the admin's own HTML. */
export function fillBody(tpl: string, o: EmailOwner, ctx: Ctx): string {
  const v = values(o, ctx);
  let out = styleAuthorHtml(tpl);
  // A paragraph holding only the item list becomes the list itself (tables can't sit inside a <p>).
  out = out.replace(/<p[^>]*>\s*\{itemList\}\s*(<br\s*\/?>)?\s*<\/p>/g, '{itemList}');
  out = out.replace(/\{(firstName|itemCount|credits|adminName)\}/g, (_m, k: keyof typeof v) =>
    k === 'credits' ? `<span style="color:${C.pine};font-weight:bold;">${esc(v[k])}</span>` : esc(v[k]));
  return out.replace(/\{itemList\}/g, () => itemListHtml(o.rows));
}

/** FB-16 (DC-125g): the public site, named in the footer. ArcGIS Online refuses messages with links it can't validate
 * (COM_1132); in the dev-org test on 2026-10-22 it refused the github.io link, so the footer names the site in plain text
 * without the scheme (user's choice). 'link' and 'off' stay for later. A refused test never unlocks owner sends (DC-125b). */
export const SITE_URL = 'https://simongis.github.io/decluttering-web/';
export const SITE_TEXT = 'simongis.github.io/decluttering-web';
export type FooterSite = 'text' | 'link' | 'off';
export const FOOTER_SITE: FooterSite = 'text';

/** The email HTML: inline styles only, Arial, 600 px wide at most, with the "sent by" footer. */
export function emailHtml(tpl: string, o: EmailOwner, ctx: Ctx, opts: { site?: FooterSite } = {}): string {
  const site = opts.site ?? FOOTER_SITE;
  const name = site === 'link' ? `<a href="${SITE_URL}" style="color:${C.muted};text-decoration:underline;">Decluttering</a>`
    : site === 'text' ? `Decluttering (${SITE_TEXT})`
    : 'Decluttering';
  const foot = `<p style="margin:18px 0 0;font-family:${FONT};font-size:12px;line-height:1.5;color:${C.muted};">Sent by ${esc(ctx.admin.name)} from ${esc(ctx.org.name)} with ${name}, a free tool that runs in your browser. Nothing was changed or deleted.</p>`;
  return `<div style="max-width:600px;margin:0;font-family:${FONT};font-size:15px;line-height:1.55;color:${C.text};">${fillBody(tpl, o, ctx)}${foot}</div>`;
}

export interface Digest { username: string; subject: string; html: string; items: number; credits: number }

/** One owner's digest. Uses only that owner's ticked rows. `test` adds "[Test] " to the subject. */
export function buildDigest(o: EmailOwner, t: { subject: string; html: string }, ctx: Ctx, opts: { test?: boolean } = {}): Digest {
  const subject = fillSubject(t.subject, o, ctx);
  return {
    username: o.username,
    subject: opts.test ? `[Test] ${subject}` : subject,
    html: emailHtml(t.html, o, ctx),
    items: o.rows.length,
    credits: totalCredits(o.rows),
  };
}

/* ------------------------------------------------------------ editor <-> template (placeholder chips) */

const chip = (k: PlaceholderKey) => `<span class="ph" contenteditable="false" data-ph="${k}" title="Filled in for each owner">${esc(PH_LABEL[k])}</span>`;

/** `{firstName}` becomes a non-editable chip in the editor. Unknown tokens stay as typed. */
export const tokensToChips = (html: string): string =>
  html.replace(/\{(\w+)\}/g, (m, k: string) => (k in PH_LABEL ? chip(k as PlaceholderKey) : m));

/** Chips back to `{tokens}`. Works on the editor's innerHTML (the chip markup it was given, or the browser's version of it). */
export const chipsToTokens = (html: string): string =>
  html.replace(/<span\b[^>]*\bdata-ph="(\w+)"[^>]*>[\s\S]*?<\/span>/g, (m, k: string) => (k in PH_LABEL ? `{${k}}` : m));

/** Which placeholders a template uses, so the editor can warn when the item list is missing. */
export const usedPlaceholders = (tpl: string): PlaceholderKey[] =>
  PLACEHOLDERS.map(([k]) => k).filter((k) => tpl.includes(`{${k}}`));

/** Links in the admin's text that are not on ArcGIS: ArcGIS Online may refuse to send them (COM_1132). */
export function outsideLinks(tpl: string): string[] {
  const out: string[] = [];
  for (const m of tpl.matchAll(/href=(["'])([^"']*)\1/gi)) {
    try {
      const h = new URL(m[2]!).hostname.toLowerCase();
      if (!/(^|\.)arcgis\.com$/.test(h)) out.push(m[2]!);
    } catch { out.push(m[2]!); }
  }
  return out;
}
