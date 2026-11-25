import { beforeAll, describe, expect, it } from 'vitest';
import { buildDigest, chipsToTokens, emailHtml, fillSubject, orderRows, outsideLinks, FOOTER_SITE, SITE_URL, tone, TONE_KEYS, tokensToChips, usedPlaceholders, type EmailOwner, type EmailRow, type ToneKey } from './digest';
import { ensureLocale, withLocale } from '../../i18n';

const TONES = Object.fromEntries(TONE_KEYS.map((k) => [k, tone(k)])) as Record<ToneKey, ReturnType<typeof tone>>;

const row = (id: string, priority: EmailRow['priority'], credits = 1, extra: Partial<EmailRow> = {}): EmailRow => ({
  id, title: `Item ${id}`, url: `https://example.maps.arcgis.com/home/item.html?id=${id}`, credits, sizeKnown: true,
  why: `Why ${id}`, tidy: null, priority, ...extra,
});
const owner = (rows: EmailRow[], extra: Partial<EmailOwner> = {}): EmailOwner => ({
  username: 'jo_smith', fullName: 'Jo Smith', rows, nudgedRecently: false, nudgedDaysAgo: null, ...extra,
});
const ctx = { admin: { name: 'Sam Admin', username: 'sam' }, org: { name: 'Test Org' } };
const friendly = { subject: TONES.friendly.subject, html: TONES.friendly.html };

describe('digest per owner', () => {
  it('lists only the rows it is given (the ticked ones) and counts them', () => {
    const d = buildDigest(owner([row('a', 'look', 2), row('b', 'low', 0.5)]), friendly, ctx);
    expect(d.items).toBe(2);
    expect(d.credits).toBe(2.5);
    expect(d.html).toContain('Item a');
    expect(d.html).toContain('Item b');
    expect(d.html).not.toContain('Item c');
    expect(d.subject).toBe('Jo, 2 of your ArcGIS items could use a quick look');
  });

  it('puts quick wins first under their own heading', () => {
    const d = buildDigest(owner([row('late', 'look'), row('win', 'start'), row('low', 'low')]), friendly, ctx);
    const iWin = d.html.indexOf('Item win'), iLate = d.html.indexOf('Item late'), iLow = d.html.indexOf('Item low');
    expect(d.html).toContain('The quickest wins');
    expect(d.html).toContain('Also on the list');
    expect(iWin).toBeLessThan(iLate);
    expect(iLate).toBeLessThan(iLow);
    expect(orderRows([row('x', 'look'), row('y', 'start')]).quick.map((r) => r.id)).toEqual(['y']);
  });

  it('has no "quickest wins" heading when there are none', () => {
    const d = buildDigest(owner([row('a', 'look')]), friendly, ctx);
    expect(d.html).not.toContain('The quickest wins');
  });

  it('escapes titles, names and why lines', () => {
    const d = buildDigest(owner([row('a', 'look', 1, { title: '<script>x</script>', why: 'a & b' })], { fullName: 'Jo <b>' }), friendly, ctx);
    expect(d.html).not.toContain('<script>');
    expect(d.html).toContain('&lt;script&gt;');
    expect(d.html).toContain('a &amp; b');
  });

  it('marks a test with [Test] in the subject', () => {
    expect(buildDigest(owner([row('a', 'look')]), friendly, ctx, { test: true }).subject).toMatch(/^\[Test\] Jo, 1 of/);
  });

  it('links only to the item pages; the footer names the site in plain text, not a link (FB-16, TC4)', () => {
    const html = emailHtml(TONES.brief.html, owner([row('a', 'look')]), ctx);
    const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(links).toEqual(['https://example.maps.arcgis.com/home/item.html?id=a']);
    expect(FOOTER_SITE).toBe('text');
    expect(html).toContain('with Decluttering (aitorcalero.github.io/decluttering-web), a free tool');
    expect(html).not.toContain('https://aitorcalero.github.io');
    expect(html).toContain('Sent by Sam Admin from Test Org');
  });

  it('can link the site, or leave it out (ArcGIS refused the link in the dev org, COM_1132)', () => {
    const linked = emailHtml(TONES.brief.html, owner([row('a', 'look')]), ctx, { site: 'link' });
    expect(linked).toContain(`href="${SITE_URL}"`);
    const off = emailHtml(TONES.brief.html, owner([row('a', 'look')]), ctx, { site: 'off' });
    expect(off).not.toContain('aitorcalero.github.io');
    expect(off).toContain('with Decluttering, a free tool');
  });

  it('skips the credits note for an item whose size is not measured', () => {
    const html = emailHtml('<p>{itemList}</p>', owner([row('a', 'look', 0, { sizeKnown: false })]), ctx);
    expect(html).not.toMatch(/Item a<\/a><span[^>]*> &middot; about/);
  });

  it('turns a tidy hint into a Tip line', () => {
    const html = emailHtml('<p>{itemList}</p>', owner([row('a', 'look', 1, { tidy: 'Tip: add a description' })]), ctx);
    expect(html).toContain('<b>Tip:</b> add a description');
  });
});

describe('template placeholders', () => {
  it('fills every placeholder in the subject', () => {
    const s = fillSubject('{firstName}|{itemCount}|{credits}|{adminName}|{itemList}', owner([row('a', 'look', 12.4), row('b', 'look', 0.2)]), ctx);
    expect(s).toBe('Jo|2|13|Sam Admin|');
  });

  it('fills the body, and an item-list paragraph becomes the list itself', () => {
    const html = emailHtml('<p>Hi {firstName}, {itemCount} items from {adminName}: {credits}</p><p>{itemList}</p>', owner([row('a', 'look', 3)]), ctx);
    expect(html).toContain('Hi Jo, 1 items from Sam Admin:');
    expect(html).toMatch(/<span style="[^"]*">3\.0<\/span>/);
    expect(html).not.toMatch(/<p[^>]*>\s*<table/);
    expect(html).not.toMatch(/\{\w+\}/);
  });

  it('keeps unknown tokens as typed', () => {
    expect(fillSubject('Hello {nope}', owner([]), ctx)).toBe('Hello {nope}');
    expect(tokensToChips('{nope}')).toBe('{nope}');
  });

  it('round-trips between tokens and editor chips', () => {
    const tpl = TONES.friendly.html;
    const chips = tokensToChips(tpl);
    expect(chips).toContain('data-ph="firstName"');
    expect(chips).not.toContain('{firstName}');
    expect(chipsToTokens(chips)).toBe(tpl);
    // The browser may reorder attributes; the data-ph attribute is what counts.
    expect(chipsToTokens('<span contenteditable="false" class="ph" data-ph="credits">Credits</span>')).toBe('{credits}');
  });

  it('reports which placeholders a template uses', () => {
    expect(usedPlaceholders('<p>{firstName}</p>')).toEqual(['firstName']);
    expect(usedPlaceholders(TONES.brief.html)).toContain('itemList');
  });

  it('flags links ArcGIS Online may refuse', () => {
    expect(outsideLinks('<a href="https://example.com/x">x</a><a href="https://org.maps.arcgis.com/home">y</a>')).toEqual(['https://example.com/x']);
  });
});

describe('FB-17: wording', () => {
  it('signs off with Thanks, in every tone', () => {
    for (const t of Object.values(TONES)) expect(t.html).not.toMatch(/thanks a lot/i);
    expect(TONES.friendly.html).toContain('<p>Thanks,<br>');
  });
});

describe('owner emails in Spanish (the email language, not the app language)', () => {
  beforeAll(async () => { await ensureLocale('es'); });
  const es = <T>(fn: () => T): T => withLocale('es', fn);

  it('every tone has a Spanish subject and template with the same placeholders', () => {
    for (const k of TONE_KEYS) {
      const s = es(() => tone(k));
      expect(s.html).not.toBe(TONES[k].html);
      expect(usedPlaceholders(s.html)).toEqual(usedPlaceholders(TONES[k].html));
      expect(usedPlaceholders(s.subject)).toEqual(usedPlaceholders(TONES[k].subject));
    }
  });

  it('writes what the app adds in Spanish: headings, credits, tip, total, footer and the test mark', () => {
    const o = owner([row('win', 'start', 2.5, { tidy: 'Consejo: unas etiquetas ayudan al equipo a encontrarla.' }), row('b', 'look', 1234)]);
    const d = es(() => buildDigest(o, es(() => tone('friendly')), ctx, { test: true }));
    expect(d.subject).toBe('[Prueba] Jo, 2 de tus elementos de ArcGIS merecen un vistazo');
    expect(d.html).toContain('Las mejoras más rápidas');
    expect(d.html).toContain('También en la lista');
    expect(d.html).toContain('unos 2,5 créditos al mes');
    expect(d.html).toContain('<b>Consejo:</b> unas etiquetas');
    expect(d.html).toMatch(/Ordenar estos elementos podría liberar unos <span[^>]*>1237<\/span> créditos al mes\./);
    expect(d.html).toContain('Enviado por Sam Admin desde Test Org con Decluttering (aitorcalero.github.io/decluttering-web)');
    expect(d.html).not.toMatch(/credits a month|Sent by|quickest wins/);
  });

  it('leaves the app language alone', () => {
    es(() => tone('brief'));
    expect(tone('brief').subject).toBe('ArcGIS Online: {itemCount} items to check');
  });
});
