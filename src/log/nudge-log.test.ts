import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { assertLogAllowed, LOG_TITLE } from './guard';
import { createNudgeLog } from './nudge-log';
import { createFakeLogOrg, FAKE_PORTAL } from './fake';
import { MAX_THUMB_BYTES } from '../notify/thumbnail';

// DC-122: a refused thumbnail never leaves the log untitled.
const ORG = 'devorg0000000001';
const ME = 'admin_me';
const png = () => new File([new Uint8Array(64)], 'thumbnail.png', { type: 'image/png' });
type Sender = Parameters<typeof createNudgeLog>[0]['send'];

function make(mode: 'throw' | 'error' | 'ok', failBoth = false) {
  const fake = createFakeLogOrg({ self: ME, orgId: ORG, titleFromName: true });
  const updates: Array<{ thumb: boolean }> = [];
  const send: Sender = async (url, r) => {
    if (url.endsWith('/update')) {
      const thumb = 'thumbnail' in r.params;
      updates.push({ thumb });
      if (mode !== 'ok' && (thumb || failBoth)) {
        if (mode === 'throw') throw new Error('multipart refused');
        return { error: { code: 400, message: 'bad thumbnail' } };
      }
    }
    return fake.send(url, r);
  };
  const log = createNudgeLog({ send, portal: FAKE_PORTAL, orgId: ORG, writableOrgIds: [ORG], random: () => '0123abcd', sendThumbnails: true, loadThumbnail: async () => png() });
  return { fake, log, updates };
}

describe('DC-122: the log is titled even when its thumbnail is refused', () => {
  it.each(['throw', 'error'] as const)('retries the title alone, once (%s)', async (mode) => {
    const { fake, log, updates } = make(mode);
    const t = await log.create();
    expect(t.title).toBe(LOG_TITLE);
    expect(fake.item?.title).toBe(LOG_TITLE);
    expect(updates).toEqual([{ thumb: true }, { thumb: false }]);
  });

  it('does one update only when the thumbnail is accepted', async () => {
    const { log, updates } = make('ok');
    await log.create();
    expect(updates).toEqual([{ thumb: true }]);
  });

  it('gives up quietly after the single retry if the title alone is also refused', async () => {
    const { log, updates } = make('throw', true);
    await expect(log.create()).resolves.toMatchObject({ reused: false });
    expect(updates).toHaveLength(2);
  });
});

describe('DC-122: the real log thumbnail passes the log guard', () => {
  it('is a non-empty PNG within the limit and is allowed on the retitle', () => {
    const file = new File([new Uint8Array(readFileSync('public/app-data/log-thumb.png'))], 'thumbnail.png', { type: 'image/png' });
    expect(file.size).toBeGreaterThan(0);
    expect(file.size).toBeLessThanOrEqual(MAX_THUMB_BYTES);
    const id = 'a'.repeat(32);
    const ctx = { portal: FAKE_PORTAL, self: ME, serviceUrl: null, newServiceUrl: null, logItemId: id };
    expect(assertLogAllowed(`${FAKE_PORTAL}/sharing/rest/content/users/${ME}/items/${id}/update`, 'POST', { title: LOG_TITLE, thumbnail: file }, ctx)).toBe('retitle');
  });
});
