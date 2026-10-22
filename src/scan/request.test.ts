import { describe, expect, it, vi } from 'vitest';
import { createRequest, type Sender } from './request';

const portal = 'https://www.arcgis.com';
const id = 'a'.repeat(32);

function setup(extra: Partial<Parameters<typeof createRequest>[1]> = {}) {
  const send = vi.fn<Sender>(async () => ({ ok: true }));
  return { send, req: createRequest(null, { portal, send, ...extra }) };
}

describe('createRequest', () => {
  it('sends allowed reads to the portal REST root', async () => {
    const { send, req } = setup();
    await req('search', { q: 'x', num: 100 });
    expect(send).toHaveBeenCalledWith(`${portal}/sharing/rest/search`, expect.objectContaining({ method: 'GET' }));
  });

  it('blocks anything off the allow-list before sending', async () => {
    const { send, req } = setup();
    await expect(req(`content/items/${id}/delete`)).rejects.toThrow(/BLOCKED/);
    await expect(req('search', {}, { method: 'POST' })).rejects.toThrow(/BLOCKED/);
    await expect(req('https://services.arcgis.com/x/FeatureServer/0')).rejects.toThrow(/BLOCKED/);
    expect(send).not.toHaveBeenCalled();
  });

  it('returns item data as text', async () => {
    const send = vi.fn<Sender>(async () => ({ a: 1 }));
    const req = createRequest(null, { portal, send });
    expect(await req(`content/items/${id}/data`, {}, { text: true })).toBe('{"a":1}');
  });

  it('limits the service search to one owner in my-items mode', async () => {
    const { send, req } = setup({ ownerOnly: 'sam' });
    await req('search', { q: 'orgid:o AND type:"Feature Service" AND typekeywords:"Hosted Service"' });
    expect((send.mock.calls[0][1].params.q as string)).toMatch(/AND owner:sam$/);
    await req('search', { q: 'orgid:o AND type:"Web Map"' });
    expect((send.mock.calls[1][1].params.q as string)).not.toContain('owner:sam');
  });

  it('answers the user list from the member themself in my-items mode', async () => {
    const send = vi.fn<Sender>(async () => ({ username: 'sam', fullName: 'Sam S', role: 'org_user' }));
    const req = createRequest(null, { portal, send, ownerOnly: 'sam' });
    const r = await req('portals/self/users') as { users: { username: string }[] };
    expect(r.users[0].username).toBe('sam');
    expect(send.mock.calls[0][0]).toBe(`${portal}/sharing/rest/community/self`);
  });

  it('skips the usage endpoint when it is not readable', async () => {
    const { send, req } = setup({ usageReadable: false });
    expect(await req('portals/self/usage', {})).toEqual({ data: [] });
    expect(send).not.toHaveBeenCalled();
  });
});
