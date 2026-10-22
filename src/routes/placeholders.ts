import { html } from 'lit';
import type { AccessMode } from '../auth/access';

interface ModeCopy { title: string; lead: string; gets: string[] }

export const MODE_COPY: Record<AccessMode, ModeCopy> = {
  admin: {
    title: 'Admin',
    lead: 'You can review the whole organisation and nudge owners.',
    gets: ['Scan your organisation for stale hosted feature services', 'Review them with plain-language reasons', 'Send each owner one friendly email'],
  },
  'admin-cant-send': {
    title: 'Admin, can’t send',
    lead: 'You can review the whole organisation. Emailing owners needs two more privileges.',
    gets: ['Scan your organisation for stale hosted feature services', 'Review them with plain-language reasons', 'The email step explains which privileges to ask for: create groups and assign to groups'],
  },
  'my-items': {
    title: 'My items',
    lead: 'You can review your own hosted feature services.',
    gets: ['The same stale rules, applied to your own services', 'Why each one is flagged, and what tidying it would save', 'A note you can copy and share with your admin'],
  },
};

export function modePlaceholder(mode: AccessMode, who: string) {
  const c = MODE_COPY[mode];
  return html`
    <section data-page="app" data-mode=${mode}>
      <h1>Signed in as ${who}</h1>
      <p>Access: <strong data-mode-label>${c.title}</strong></p>
      <p>${c.lead}</p>
      <p>What you’ll get:</p>
      <ul>${c.gets.map((g) => html`<li>${g}</li>`)}</ul>
      <p><em>The scan itself is coming soon.</em></p>
    </section>`;
}
