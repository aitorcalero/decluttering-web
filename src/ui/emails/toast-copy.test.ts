import { describe, expect, it } from 'vitest';
import { testToast, UNLOCKED_LINE, sendErrorText } from './toast-copy';

describe('the test-send toast (DC-121)', () => {
  it('names the address the test went to, and says nobody else got it', () => {
    const t = testToast('you@example.org', 'Sam');
    expect(t.title).toBe('Test accepted by ArcGIS Online');
    expect(t.message).toBe('Sent to you@example.org (your profile email). It usually arrives within a minute. Nothing there? Check Junk, then wait a few minutes before sending again. Nobody else got it.');
  });
  it('trims the address', () => {
    expect(testToast('  you@example.org ', 'Sam').message).toContain('Sent to you@example.org (your');
  });
  it('falls back to the old wording when the address is unknown', () => {
    for (const a of [undefined, '', '   ']) {
      const t = testToast(a, 'Sam');
      expect(t.title).toBe('Test sent to you');
      expect(t.message).toBe("A copy of Sam's digest is on its way to you. Nobody else got it.");
    }
  });
});

describe('the unlock line (DC-125b)', () => {
  it('adds one friendly line only when this test just unlocked sending', () => {
    const plain = testToast('you@example.org', 'Sam');
    const on = testToast('you@example.org', 'Sam', { unlocked: true });
    expect(on.message).toBe(`${plain.message} ${UNLOCKED_LINE}`);
    expect(UNLOCKED_LINE).toBe('Looks good? Sending to owners is now unlocked for this session.');
    expect(testToast('you@example.org', 'Sam', { unlocked: false })).toEqual(plain);
  });
});

describe('sendErrorText (TC4, COM_1132)', () => {
  const arcgis = (details: string[]) => Object.assign(new Error('COM_1132: Unable to send notification.'), {
    name: 'ArcGISRequestError', code: 400, response: { error: { code: 400, messageCode: 'COM_1132', message: 'Unable to send notification.', details } },
  });
  it('says plainly when ArcGIS refused a link in the message', () => {
    const t = sendErrorText(arcgis(['Invalid links in the message.']));
    expect(t).toMatch(/link/i);
    expect(t).toMatch(/ArcGIS Online wouldn.t send/);
    expect(t).not.toContain('COM_1132:');
  });
  it('says plainly when a recipient is not allowed to receive it', () => {
    expect(sendErrorText(arcgis(['One or more users in the list are not allowed to receive notifications']))).toMatch(/isn.t able to receive/);
  });
  it('shows ArcGIS’s own detail for anything else, and the plain message for non-ArcGIS errors', () => {
    expect(sendErrorText(arcgis(['Something new.']))).toContain('Something new.');
    expect(sendErrorText(new Error('Network down'))).toBe('Network down');
    expect(sendErrorText('x')).toBe('x');
  });
});
