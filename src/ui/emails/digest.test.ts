import { describe, expect, it } from 'vitest';
import { buildDigest, emailWhy, chipsToTokens, emailHtml, fillSubject, orderRows, outsideLinks, FOOTER_SITE, SITE_URL, TONES, tokensToChips, usedPlaceholders, type EmailOwner, type EmailRow } from './digest';

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
    expect(html).toContain('with Decluttering (simongis.github.io/decluttering-web), a free tool');
    expect(html).not.toContain('https://simongis.github.io');
    expect(html).toContain('Sent by Sam Admin from Test Org');
  });

  it('can link the site, or leave it out (ArcGIS refused the link in the dev org, COM_1132)', () => {
    const linked = emailHtml(TONES.brief.html, owner([row('a', 'look')]), ctx, { site: 'link' });
    expect(linked).toContain(`href="${SITE_URL}"`);
    const off = emailHtml(TONES.brief.html, owner([row('a', 'look')]), ctx, { site: 'off' });
    expect(off).not.toContain('simongis.github.io');
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

describe('FB-15 and FB-17: wording', () => {
  it('never says still checking or not checked; the used-by part is left out', () => {
    const base = 'Data requested on 0 days in the last 90 days · last updated Mar 2024';
    for (const tail of ['used by: still checking…', 'used by: not checked']) {
      const d = buildDigest(owner([row('a', 'look', 1, { why: `${base} · ${tail}` })]), friendly, ctx);
      expect(d.html).not.toMatch(/still checking|not checked|used by:/i);
      expect(d.html).toContain(base);
    }
    expect(emailWhy('x · used by 2 maps or apps')).toBe('x · used by 2 maps or apps');
  });

  it('says nothing about used-by for an item whose maps and apps were not all checked (DC-071b)', () => {
    const base = 'Data requested on 0 days in the last 90 days · last updated Mar 2024';
    for (const tail of ['not used by any maps or apps', 'used by 2 maps or apps']) {
      const d = buildDigest(owner([row('a', 'look', 1, { why: `${base} · ${tail}`, depsChecked: false })]), friendly, ctx);
      expect(d.html).not.toMatch(/used by/i);
      expect(d.html).toContain(base);
      // Checked (or not said): the line stays.
      expect(buildDigest(owner([row('a', 'look', 1, { why: `${base} · ${tail}`, depsChecked: true })]), friendly, ctx).html).toContain(tail);
      expect(buildDigest(owner([row('a', 'look', 1, { why: `${base} · ${tail}` })]), friendly, ctx).html).toContain(tail);
    }
  });

  it('signs off with Thanks, in every tone', () => {
    for (const t of Object.values(TONES)) expect(t.html).not.toMatch(/thanks a lot/i);
    expect(TONES.friendly.html).toContain('<p>Thanks,<br>');
  });
});
