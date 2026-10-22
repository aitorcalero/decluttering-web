// ADR 0013 / DC-125e: the words for turning sending off, shared by the checklist and About › App data (a separate file so the two never import each other in a loop).
/** The words, shared with About › App data so both places mean the same thing. */
export const TURN_OFF = {
  heading: 'Turn off sending?',
  body: 'We’ll remove your hidden group, so nothing more can be sent from here. Your nudge log stays, so owners you’ve nudged keep resting for six months. You can turn sending on again any time.',
  yes: 'Turn off sending',
  keep: 'Keep it on',
  done: 'Sending is off. Your nudge log is still there.',
} as const;
