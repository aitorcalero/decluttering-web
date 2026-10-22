// DC-121: the words on the "Send a test to me" toast, in one pure place. ArcGIS Online says success whether or not the
// recipient has a usable address, so the toast says where the test was sent and what to do if it doesn't turn up.
export interface ToastCopy { title: string; message: string }

/** DC-125b: added to the test toast when this test is what just unlocked sending to owners. */
export const UNLOCKED_LINE = 'Looks good? Sending to owners is now unlocked for this session.';

export function testToast(address: string | undefined, ownerFirstName: string, opts: { unlocked?: boolean } = {}): ToastCopy {
  const to = address?.trim();
  const more = opts.unlocked ? ` ${UNLOCKED_LINE}` : '';
  if (!to) return { title: 'Test sent to you', message: `A copy of ${ownerFirstName}'s digest is on its way to you. Nobody else got it.${more}` };
  return {
    title: 'Test accepted by ArcGIS Online',
    message: `Sent to ${to} (your profile email). It usually arrives within a minute. Nothing there? Check Junk, then wait a few minutes before sending again. Nobody else got it.${more}`,
  };
}

/**
 * TC4 (2026-10-22): ArcGIS's COM_1132 "Unable to send notification." covers several refusals, and the reason is only in
 * `response.error.details` (docs/research/agol-notify-usage.md). Say what it means in plain words.
 */
export function sendErrorText(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const details = (err as { response?: { error?: { details?: unknown } } }).response?.error?.details;
  const said = Array.isArray(details) ? details.map(String).filter(Boolean).join(' ') : '';
  if (/invalid links?/i.test(said)) {
    return 'ArcGIS Online wouldn’t send this email because it contains a link it doesn’t accept. Links to your org’s ArcGIS pages are fine; take out any other links and try again.';
  }
  if (/not allowed to receive/i.test(said)) {
    return 'ArcGIS Online wouldn’t send this email: someone on the list isn’t able to receive it from this group. Try again, and if it keeps happening, check they’re still a member of your organisation.';
  }
  if (said) return `ArcGIS Online wouldn’t send this email: ${said}`;
  return err.message;
}
