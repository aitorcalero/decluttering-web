// DC-121: the words on the "Send a test to me" toast, in one pure place. ArcGIS Online says success whether or not the
// recipient has a usable address, so the toast says where the test was sent and what to do if it doesn't turn up.
export interface ToastCopy { title: string; message: string }

export function testToast(address: string | undefined, ownerFirstName: string): ToastCopy {
  const to = address?.trim();
  if (!to) return { title: 'Test sent to you', message: `A copy of ${ownerFirstName}'s digest is on its way to you. Nobody else got it.` };
  return {
    title: 'Test accepted by ArcGIS Online',
    message: `Sent to ${to} (your profile email). It usually arrives within a minute. Nothing there? Check Junk, then wait a few minutes before sending again. Nobody else got it.`,
  };
}
