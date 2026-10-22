import { describe, expect, it } from 'vitest';
import { ABOUT_SECTIONS, APPROVED_APPS_URL, OPEN_DISCLAIMER, CONTACT_LINK_TEXT, CONTACT_URL, FLOWS, REPO_URL, backLabel, issuesLine, repoLine } from './content';
import { PRESETS } from '../../domain/stale';

const sentences = (s: string) => s.split(/(?<=[.?!])\s+/).filter(Boolean).length;

describe('About content (DC-021)', () => {
  it('has the eight sections, each with a lead of at most two sentences and some detail', () => {
    expect(ABOUT_SECTIONS.map((s) => s.id)).toEqual(['what', 'stale', 'views', 'data', 'email', 'touches', 'approved', 'open']);
    for (const s of ABOUT_SECTIONS) {
      expect(sentences(s.lead), s.id).toBeLessThanOrEqual(2);
      expect(s.detail.length, s.id).toBeGreaterThan(0);
    }
  });
  it('states the preset ages from PRESETS', () => {
    const text = JSON.stringify(ABOUT_SECTIONS.find((s) => s.id === 'stale'));
    expect(PRESETS.gentle.minDaysSinceUse).toBe(365);
    expect(text).toContain('Gentle 1 year');
    expect(text).toContain('Balanced 6 months');
    expect(text).toContain('Strict 3 months');
  });
  it('uses no exclamation marks', () => {
    expect(JSON.stringify(ABOUT_SECTIONS)).not.toContain('!');
  });
});

describe('About additions (DC-110)', () => {
  it('always links to the public repo, and VITE_REPO_URL overrides it only with a web address (FB-79)', () => {
    expect(REPO_URL).toBe('https://github.com/simongis/decluttering-web');
    expect(repoLine('https://github.com/acme/decluttering')).toEqual({ text: 'Source code on GitHub', href: 'https://github.com/acme/decluttering' });
    for (const v of [undefined, '', '   ', 'github.com/x', 'javascript:alert(1)']) {
      const r = repoLine(v);
      expect(r.href, String(v)).toBe(REPO_URL);
      expect(r.text).toBe('Source code on GitHub');
    }
  });
  it('points the self-hosted contact button at the author\'s LinkedIn (FB-80)', () => {
    expect(CONTACT_URL).toBe('https://www.linkedin.com/in/simongis/');
    expect(CONTACT_LINK_TEXT).toBe('Contact me');
    const open = JSON.stringify(ABOUT_SECTIONS.find((s) => s.id === 'open'));
    expect(open).toContain('self-hosted');
    expect(open).not.toContain('Esri Australia can help');
  });
  it('names where Back goes (FB-70)', () => {
    expect(backLabel('review')).toBe('Back to Review');
    expect(backLabel('app')).toBe('Back to the scan');
    expect(backLabel('landing')).toBe('Back to home');
  });
  it('says the app is unsupported and links issues to the repo (FB-71, FB-79)', () => {
    expect(issuesLine('https://github.com/a/b/').link.href).toBe('https://github.com/a/b/issues');
    const dflt = issuesLine('');
    expect(dflt.link.href).toBe('https://github.com/simongis/decluttering-web/issues');
    expect(dflt.before).toContain('without formal support');
  });
  it('explains used by as dependent items (FB-73)', () => {
    expect(JSON.stringify(ABOUT_SECTIONS.find((s) => s.id === 'stale'))).toContain('items that depend on it');
  });
  it('gives each diagram steps and a descriptive label, attached to the right section', () => {
    expect(ABOUT_SECTIONS.find((s) => s.id === 'email')?.flow).toBe('email');
    expect(ABOUT_SECTIONS.find((s) => s.id === 'data')?.flow).toBe('data');
    expect(FLOWS.email.steps.map((s) => s.icon)).toEqual(['user', 'group', 'envelope', 'table']);
    expect(FLOWS.email.label).toMatch(/hidden group/);
    expect(FLOWS.data.label).toMatch(/own ArcGIS Online org/);
  });
});

describe('About admin guide (DC-125f)', () => {
  it('has a section for administrators that links to the Esri security page and is honest about the steps', () => {
    const s = ABOUT_SECTIONS.find((x) => x.id === 'approved');
    expect(s?.title).toBe('For administrators: approving Decluttering');
    expect(APPROVED_APPS_URL).toBe('https://doc.arcgis.com/en/arcgis-online/administer/configure-security.htm');
    const text = JSON.stringify(s);
    expect(text).toContain('Approved apps');
    expect(text).toContain("We'll add exact steps here");
  });
});

describe('About disclaimer (user, 2026-10-23)', () => {
  it('says gently that it is independent, as is, test first, and invites a look at the code', () => {
    expect(OPEN_DISCLAIMER.before).toContain('independent, open-source project, not an Esri or Esri Australia product');
    expect(OPEN_DISCLAIMER.before).toContain('send yourself a test first');
    expect(OPEN_DISCLAIMER.before).toContain('policies');
    expect(OPEN_DISCLAIMER.linkText).toBe('review the code on GitHub');
  });
});
