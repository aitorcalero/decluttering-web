// The English catalogue: the source of truth for every message key. Other languages (es.ts, ...) must define the same keys;
// TypeScript and the catalogue test fail when one is missing. Values are plain strings with {name} placeholders, or plural forms.
export type PluralForms = { one: string; other: string; zero?: string; two?: string; few?: string; many?: string };
export type Message = string | PluralForms;

export const en = {
  'lang.label': 'Language',
  'steps.nav': 'Steps',
  'steps.scan': 'Scan',
  'steps.review': 'Review',
  'steps.emails': 'Emails',
  'steps.scanHint': 'The quick demo skips the scan.',
  'steps.reviewHint': 'Review opens once the scan has found your layers.',
  'steps.emailsHint': 'Tick an owner on Review to write emails.',
  'steps.line': 'Step {n} of {total}: {label}',
  'steps.count': 'step {n} of {total}',
  'steps.linkLabel': '{label}, step {n}',
  'steps.disabledLabel': '{label}, step {n}, not available yet. {hint}',
} as const satisfies Record<string, Message>;

export type MessageKey = keyof typeof en;
