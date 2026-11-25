// DC-019: one digest per owner, built from the template the admin edits. Pure strings, no DOM, so it is tested in Node.
// Mirrors prototype D's email.js (tones, placeholders, the inline-styled item list, quick wins first, ADR 0010).
// Links: only the org's own item pages. ArcGIS Online refuses notifications with links it can't validate
// (COM_1132 "Invalid links in the message", docs/research/agol-notify-usage.md). The footer links to the hosted site (FB-16).
import type { Priority } from '../../domain/priority';
import { formatNumber, t } from '../../i18n';

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
const PH_KEYS: PlaceholderKey[] = ['firstName', 'itemCount', 'credits', 'itemList', 'adminName'];
/** A placeholder's chip label, in the app's language (the editor's, not the email's). */
export const phLabel = (k: PlaceholderKey): string => t(`emails.ph.${k}`);
/** Each placeholder with its label, in the app's language. */
export const placeholders = (): [PlaceholderKey, string][] => PH_KEYS.map((k) => [k, phLabel(k)]);
export type ToneKey = 'friendly' | 'brief' | 'formal';
export const TONE_KEYS: ToneKey[] = ['friendly', 'brief', 'formal'];
export interface Tone { label: string; subject: string; html: string }
/**
 * A tone's starting template, from the catalogue in the current language: call it inside withLocale(emailLocale, ...)
 * for the template, and outside for the label the app shows.
 */
export const tone = (k: ToneKey): Tone => ({ label: t(`emails.tone.${k}`), subject: t(`emails.tpl.${k}.subject`), html: t(`emails.tpl.${k}.html`) });/** Email colours and font: inline styles only (mail clients drop style sheets). */
const C = { text: '#1c2b36', muted: '#4a5b66', link: '#164385', pine: '#006f48', line: '#d6dee4', tint: '#f3f6f8' };
const FONT = 'Arial, Helvetica, sans-serif';

export const esc = (s: unknown): string => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Credits a month: one decimal under 10, whole numbers above (same as the review), in the current language. */
const credit = (c: number): string =>
  (c < 10 ? formatNumber(c, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : formatNumber(Math.round(c)));
/** A message with {credits} wrapped in `wrap`, in the language's own word order. The text is escaped. */
const withCredits = (key: 'emails.digest.itemCredits' | 'emails.digest.total', c: number, wrap: (v: string) => string): string =>
  t(key).split('{credits}').map(esc).join(wrap(esc(credit(c))));
export const firstName = (fullName: string): string => fullName.trim().split(/\s+/)[0] || fullName;
export const totalCredits = (rows: Pick<EmailRow, 'credits'>[]): number => rows.reduce((s, r) => s + r.credits, 0);

/** ADR 0010: quick wins first, then the rest, each keeping the review's order. */
export function orderRows<T extends Pick<EmailRow, 'priority'>>(rows: T[]): { quick: T[]; rest: T[] } {
  return { quick: rows.filter((r) => r.priority === 'start'), rest: rows.filter((r) => r.priority !== 'start') };
}

/** FB-15 and DC-083: the why line comes in ready for the email (routes/email-selection): no unchecked used-by, no views. */
function card(r: EmailRow): string {
  const cr = r.sizeKnown ? `<span style="color:${C.pine};font-weight:bold;"> &middot; ${withCredits('emails.digest.itemCredits', r.credits, (v) => v)}</span>` : '';
  // The tidy tip starts with its label ("Tip:", "Consejo:"), which the email sets in bold.
  const label = t('emails.digest.tip');
  const tidy = r.tidy && r.tidy.startsWith(label) ? r.tidy.slice(label.length).trim() : r.tidy;
  const tip = tidy ? `<br><span style="color:${C.text};"><b>${esc(label)}</b> ${esc(tidy)}</span>` : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 10px;"><tr>
<td style="padding:10px 12px;background:${C.tint};border:1px solid ${C.line};font-family:${FONT};font-size:14px;line-height:1.5;color:${C.text};">
<a href="${esc(r.url)}" style="color:${C.link};font-weight:bold;text-decoration:underline;">${esc(r.title)}</a>${cr}<br>
<span style="color:${C.muted};">${esc(r.why)}</span>${r.context ? `<br><span style="color:${C.text};">${esc(r.context)}</span>` : ''}${tip}
</td></tr></table>`;
}

/** The item list: quick wins first under their own heading, then the total. */
export function itemListHtml(rows: EmailRow[]): string {
  const head = (s: string) => `<p style="margin:12px 0 6px;font-family:${FONT};font-size:14px;color:${C.text};"><b>${esc(s)}</b></p>`;
  const { quick, rest } = orderRows(rows);
  const items = quick.length
    ? head(t('emails.digest.quick')) + quick.map(card).join('') + (rest.length ? head(t('emails.digest.rest')) + rest.map(card).join('') : '')
    : rows.map(card).join('');
  const total = withCredits('emails.digest.total', totalCredits(rows), (v) => `<span style="color:${C.pine};">${v}</span>`);
  return `${items}<p style="margin:6px 0 0;font-family:${FONT};font-size:14px;color:${C.text};"><b>${total}</b></p>`;
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
export const SITE_URL = 'https://aitorcalero.github.io/decluttering-web/';
export const SITE_TEXT = 'aitorcalero.github.io/decluttering-web';
export type FooterSite = 'text' | 'link' | 'off';
export const FOOTER_SITE: FooterSite = 'text';

/** The email HTML: inline styles only, Arial, 600 px wide at most, with the "sent by" footer. */
export function emailHtml(tpl: string, o: EmailOwner, ctx: Ctx, opts: { site?: FooterSite } = {}): string {
  const site = opts.site ?? FOOTER_SITE;
  const name = site === 'link' ? `<a href="${SITE_URL}" style="color:${C.muted};text-decoration:underline;">Decluttering</a>`
    : site === 'text' ? `Decluttering (${SITE_TEXT})`
    : 'Decluttering';
  const parts: Record<string, string> = { admin: esc(ctx.admin.name), org: esc(ctx.org.name), site: name };
  const line = esc(t('emails.digest.footer')).replace(/\{(admin|org|site)\}/g, (_m, k: string) => parts[k]!);
  const foot = `<p style="margin:18px 0 0;font-family:${FONT};font-size:12px;line-height:1.5;color:${C.muted};">${line}</p>`;
  return `<div style="max-width:600px;margin:0;font-family:${FONT};font-size:15px;line-height:1.55;color:${C.text};">${fillBody(tpl, o, ctx)}${foot}</div>`;
}

export interface Digest { username: string; subject: string; html: string; items: number; credits: number }

/**
 * One owner's digest. Uses only that owner's ticked rows. `test` marks the subject ("[Test] …"). Everything the app adds
 * (item list, footer, test mark, numbers) is in the current language: build it inside withLocale(emailLocale, ...).
 */
export function buildDigest(o: EmailOwner, tpl: { subject: string; html: string }, ctx: Ctx, opts: { test?: boolean } = {}): Digest {
  const subject = fillSubject(tpl.subject, o, ctx);
  return {
    username: o.username,
    subject: opts.test ? t('emails.digest.test', { subject }) : subject,
    html: emailHtml(tpl.html, o, ctx),
    items: o.rows.length,
    credits: totalCredits(o.rows),
  };
}

/* ------------------------------------------------------------ editor <-> template (placeholder chips) */

const isPh = (k: string): k is PlaceholderKey => (PH_KEYS as string[]).includes(k);
const chip = (k: PlaceholderKey) => `<span class="ph" contenteditable="false" data-ph="${k}" title="${esc(t('emails.placeholder.title'))}">${esc(phLabel(k))}</span>`;

/** `{firstName}` becomes a non-editable chip in the editor (labelled in the app's language). Unknown tokens stay as typed. */
export const tokensToChips = (html: string): string =>
  html.replace(/\{(\w+)\}/g, (m, k: string) => (isPh(k) ? chip(k) : m));

/** Chips back to `{tokens}`. Works on the editor's innerHTML (the chip markup it was given, or the browser's version of it). */
export const chipsToTokens = (html: string): string =>
  html.replace(/<span\b[^>]*\bdata-ph="(\w+)"[^>]*>[\s\S]*?<\/span>/g, (m, k: string) => (isPh(k) ? `{${k}}` : m));

/** Which placeholders a template uses, so the editor can warn when the item list is missing. */
export const usedPlaceholders = (tpl: string): PlaceholderKey[] =>
  PH_KEYS.filter((k) => tpl.includes(`{${k}}`));

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
