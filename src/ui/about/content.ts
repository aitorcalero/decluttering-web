// DC-021: the words on the About page, as plain data so a test can check them and one place edits them.
// Each section has a short lead (two sentences at most) and, behind an expander, the detail. The "last used" wording
// matches the info popovers in src/ui/review/dc-filters.ts (USAGE_*). Rule numbers come from PRESETS so they can't drift.
// DC-110: plain, warm copy (docs/tone-of-voice.md), the GitHub line, the self-hosted line and two small diagrams.
import { PRESETS, PRESET_NAMES, span } from '../../domain/stale';

export type Block = { p: string } | { ul: string[] };
export type FlowId = 'email' | 'data';
export interface AboutSection { id: string; title: string; lead: string; detail: Block[]; flow?: FlowId }
export interface FlowStep { icon: string; label: string; note: string }
export interface Flow { label: string; steps: FlowStep[] }

const preset = (k: 'gentle' | 'balanced' | 'strict') => `${PRESET_NAMES[k]} ${span(PRESETS[k].minDaysSinceUse).replace(/^a /, '1 ')}`;

/** FB-80: the author's LinkedIn profile (user's choice 2026-10-22); it replaced the Esri Australia contact page here. */
export const CONTACT_URL = 'https://www.linkedin.com/in/simongis/';
export const CONTACT_LINK_TEXT = 'Contact me';
export const REPO_TEXT_LINKED = 'Source code on GitHub';
/** FB-79: the public repository. Every build links to it; VITE_REPO_URL overrides it (a fork or self-host). */
export const REPO_URL = 'https://github.com/simongis/decluttering-web';

/** The GitHub line: always a link. VITE_REPO_URL wins when it is a web address, otherwise the public repository. */
export function repoLine(url: string | undefined): { text: string; href: string } {
  const u = (url ?? '').trim();
  return { text: REPO_TEXT_LINKED, href: /^https?:\/\//i.test(u) ? u : REPO_URL };
}

/** Small diagrams drawn with Calcite icons. Each renders as one role="img" whose aria-label is `label`. */
export const FLOWS: Record<FlowId, Flow> = {
  email: {
    label: 'How the email is sent: you choose to send. The app uses a hidden group that only you can see. Each owner gets one email. A row is added to your nudge log, a table in your org.',
    steps: [
      { icon: 'user', label: 'You', note: 'choose to send' },
      { icon: 'group', label: 'Hidden group', note: 'only you can see it' },
      { icon: 'envelope', label: 'One email', note: 'to each owner' },
      { icon: 'table', label: 'Nudge log', note: 'a table in your org' },
    ],
  },
  data: {
    label: 'Your data: your browser talks only to your own ArcGIS Online org. There is no Decluttering server.',
    steps: [
      { icon: 'browser', label: 'Your browser', note: 'where this runs' },
      { icon: 'organization', label: 'Your org', note: 'the only place it talks to' },
    ],
  },
};

/** FB-70: the Back link label for the route About was opened from. */
export function backLabel(route: string | undefined): string {
  switch (route) {
    case 'review': case 'emails': return 'Back to Review';
    case 'app': return 'Back to the scan';
    case 'demo': case 'demo-emails': return 'Back to the demo';
    default: return 'Back to home';
  }
}

/** FB-71: the "not supported" line; links to {repo}/issues. */
export function issuesLine(url: string | undefined): { before: string; link: { text: string; href: string }; after: string } {
  const r = repoLine(url);
  const before = 'Decluttering is offered as is, without formal support. You can raise issues ';
  return { before, link: { text: 'on GitHub', href: r.href.replace(/\/+$/, '') + '/issues' }, after: '.' };
}

export const ABOUT_INTRO = 'Decluttering helps you tidy your ArcGIS Online org by asking people, never by deleting anything.';

export const ABOUT_SECTIONS: AboutSection[] = [
  {
    id: 'what',
    title: 'What it does',
    lead: "It spots hosted feature layers nobody seems to be using, then sends their owners one friendly email. It never deletes or changes anyone's items.",
    detail: [
      { p: 'You look over what it found, pick who to nudge, and send. The owners decide what happens to their own layers.' },
    ],
  },
  {
    id: 'stale',
    title: 'How "stale" is decided',
    lead: 'A layer gets picked out when it hasn’t been used or updated for a while, few maps or apps use it, and it is big enough to matter. Every number is yours to see and change.',
    detail: [
      { p: 'For example: a 40 MB layer nobody has opened since March, last edited two years ago, and used by no maps or apps. It ticks every box, so it is picked out. If lots of maps and apps used it, it would be left alone.' },
      { p: '"Used by" is the number of maps and apps in your org that use the layer: the items that depend on it. A layer other items rely on is one to be careful with.' },
      { p: `You don’t have to start from scratch. Three starting points fill in the numbers: ${preset('gentle')}, ${preset('balanced')}, ${preset('strict')}. A layer must meet all four parts: last used more than that long ago, last updated more than that long ago, used by at most a set number of maps or apps, and at least the minimum size.` },
      { p: '"Last used" is the newer of two dates ArcGIS Online keeps for a layer and its hosted views: when it was last opened, and the last day (UTC) its data was requested.' },
      { ul: [
        'Counts as use: opening it (its item page, Map Viewer, or a map or app that uses it), and a map, app, script or admin requesting its data.',
        'Set aside: one or two requests on a day when many layers were touched, which is usually a crawler. More than 10 requests still counts.',
        "Does not count: Decluttering itself. It never requests your layers' data.",
      ] },
      { p: 'The little bars on each layer show the days with data requests in the last 13 weeks, today included. One request makes a day. They are there for context only.' },
      { p: 'When it can’t be sure, it leans towards "used". If a layer\'s usage can’t be fully read, it shows "Last used: unknown" and is never picked out. A blank "last viewed" means no use has been recorded since November 2022.' },
    ],
  },
  {
    id: 'views',
    title: 'Total views',
    lead: 'Total views is there for context, and for sorting ("Least viewed"). It isn’t part of the rule.',
    detail: [
      { p: 'It counts all time, so it can’t tell you whether anyone is looking at a layer now. Last used already covers every view, and more.' },
      { p: 'Every view also counts as use, so a views limit would only hide layers that Last used already calls idle. Sort by Least viewed to see the rarely opened ones first.' },
      { p: "A layer's views go up by one when its item page, Map Viewer, or an app loading the layer by item id opens it. Drawing, panning and querying the layer don’t add views." },
    ],
  },
  {
    id: 'data',
    title: 'Your data',
    lead: 'The scan only reads your org. Nothing leaves your browser except to your own ArcGIS Online org.',
    flow: 'data',
    detail: [
      { p: 'There is no Decluttering server and no third-party storage. If you choose to keep a nudge log, it is a hosted table in your own org. It records who was nudged, when, and which items. It never keeps the message text.' },
      { p: 'Your settings and the last scan stay in this browser only, and you can clear them any time.' },
      // DC-104: said only on a build that carries the Cloudflare beacon (the hosted site), so it is never claimed elsewhere.
      ...(import.meta.env.VITE_CF_BEACON_TOKEN
        ? [{ p: 'This site counts anonymous page views with Cloudflare Web Analytics: no cookies, and nothing about your org, its items or its people.' }]
        : []),
    ],
  },
  {
    id: 'email',
    title: 'How the email is sent',
    lead: 'ArcGIS Online sends notifications through groups, so sending uses one hidden, invitation-only group. Each owner gets one digest, then is left alone for six months.',
    flow: 'email',
    detail: [
      { p: 'The group is created only when you choose to send, and only after asking you. For each owner the app adds them, notifies them and removes them, so the group is empty between sends.' },
      { p: 'A test send goes to you, not to the owner. A real send happens only when you confirm it.' },
      { p: 'The hidden group and the nudge log are the only things the app creates. Both are labelled “Decluttering” in ArcGIS Online, and you can remove either one from “App data in your org” below.' },
    ],
  },
  {
    id: 'touches',
    title: 'What the scan touches',
    lead: "To see what uses each layer, the scan looks inside every map and app. It never touches the layers' data.",
    detail: [
      { p: 'Looking inside a map or app adds one view to it, the first time. Later scans only re-read the maps and apps that have changed since.' },
    ],
  },
  {
    id: 'open',
    title: 'Open source and customisable',
    lead: 'You can read exactly what Decluttering does, and adapt it to your own org.',
    detail: [
      { p: 'The code is open, so your team can check the rules, change the wording of the email, or run its own copy.' },
      { p: 'Want it inside your own network, sending through your own mail server? Get in touch about a self-hosted version.' },
    ],
  },
];
