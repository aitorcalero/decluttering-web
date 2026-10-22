// DC-116 (FB-75): the made-up org the demo scans. The real scan pipeline runs against this in-browser fake (no network, no
// sign-in, nothing cached), so the demo plays the dot map, the stages and the quips, then Review, then Emails.
// Loaded only through `import('./demo/demo-org')` on the demo route, so it sits in its own chunk, not in the main one.
import type { AccessInfo } from '../auth/session';
import type { Data } from '../domain/types';
import { createSimulatedOrg, simulatedNudgeRows, type SimulatedOrg, type SimulatedOrgConfig } from './simulated-org';

export const DEMO_SERVICES = 437;
export const DEMO_ORG_ID = 'DEMO000000000437';
export const DEMO_ORG_NAME = 'Riverside Shire Council';
export const DEMO_USERNAME = 'demo_admin';

/**
 * Multiplies the made-up latencies below. 1.3 plays the scan in about 37 seconds (measured: 29 seconds at 1; the basics are in
 * after about a third of that, when Review now appears). Raise it to slow the demo down, lower it to speed it up; 0 answers on
 * the next tick (tests, and "Skip to results").
 */
export const DEMO_PACE = 1.3;

export function demoConfig(over: Partial<SimulatedOrgConfig> = {}): Partial<SimulatedOrgConfig> {
  return {
    services: DEMO_SERVICES, seed: 437, orgId: DEMO_ORG_ID, orgName: DEMO_ORG_NAME, viewShare: 0.2,
    owners: 26, maps: 190, unreadableMaps: 0, brokenMaps: 3, rate429: 0, speed: DEMO_PACE,
    tidy: { admin: { username: DEMO_USERNAME, fullName: 'Alex Ivanov', email: 'you@example.org' }, usernameSuffix: '_riverside', emailDomain: 'riverside.example.org', size: { medianMB: 3, sigma: 2 }, kinds: [0.06, 0.2, 0.4, 0.6] },
    latency: { search: 1500, item: 520, data: 640, related: 520, users: 1400, usageMin: 5200, usageMax: 9000 },
    ...over,
  };
}

export interface DemoOrg { org: SimulatedOrg; access: AccessInfo; nudgeRows(): Record<string, unknown>[] }

/** The demo's org and the admin signed in to it. Not writable in the real sense: the Emails step runs on the demo notifier. */
export function createDemoOrg(over: Partial<SimulatedOrgConfig> = {}): DemoOrg {
  const org = createSimulatedOrg(demoConfig(over));
  const access: AccessInfo = {
    mode: 'admin', username: DEMO_USERNAME, fullName: 'Alex Ivanov', orgName: DEMO_ORG_NAME, orgId: DEMO_ORG_ID,
    role: 'org_admin', usageReadable: true, writable: true,
  };
  // The past sends are worked out from the made-up world itself, so they are ready before the first page of the scan lands.
  const nudgeRows = () => {
    const MB = 1024 * 1024;
    const data = {
      org: { id: DEMO_ORG_ID, name: DEMO_ORG_NAME, urlKey: '', scannedAt: new Date().toISOString() },
      services: org.world.services.map((s) => ({ id: s.id, owner: s.owner, sizeMB: s.size / MB, isView: s.typeKeywords.includes('View Service') })),
    } as unknown as Data;
    return simulatedNudgeRows(data, org.config.seed, DEMO_USERNAME);
  };
  return { org, access, nudgeRows };
}
