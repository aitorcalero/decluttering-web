// ADR 0013: the words of the "Turn on sending" opt-in. Warm and reassuring; one source for Emails and the access checklist.
export const TURN_ON_HEADING = 'Turn on sending for you?';
export const TURN_ON_POINTS: readonly string[] = [
  'You’re in control. Nothing is sent until you choose.',
  'We’ll set up one small hidden group in your org that only you can see.',
  'Each owner gets one friendly email, at most once every six months.',
  'You can switch it off any time.',
];
export const TURN_ON_YES = 'Turn on sending';
export const TURN_ON_NO = 'Not now';
/** After a successful turn-on. */
export const TURN_ON_NEXT = 'Send yourself a test first. It goes only to you, so you can see exactly what owners will get.';
