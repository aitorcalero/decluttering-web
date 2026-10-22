// The notifier's own allow-list (DC-018, ADR 0002). Separate from the scan's read-only guard, which stays unchanged.
// It lists the few writes that sending needs and the reads that support them; anything else throws before a request.
// Group-scoped calls (writes, and the members read for tidying, DC-068) are allowed only for the app's own group id, and user reads only for the signed-in user.
import type { Method, RequestFn } from '../scan/types';
import { isPngThumbnail } from './thumbnail';

export const GROUP_TITLE = 'Decluttering notifications';

/** Same name as the scan guard's error, so callers that count blocked calls (live.js's fence) treat them alike. */
export class BlockedRequest extends Error {
  constructor(what: string, reason: string) {
    super(`BLOCKED (notify guard): ${what} - ${reason}`);
    this.name = 'BlockedRequest';
  }
}

const ID32 = '[0-9a-f]{32}';
const USER = '[^/]+';

export type NotifyOp = 'createGroup' | 'addUsers' | 'removeUsers' | 'createNotification' | 'deleteGroup' | 'searchGroups' | 'groupUsers' | 'user' | 'portalSelf';

interface Rule { op: NotifyOp; re: RegExp; methods: Method[] }

/** Paths are relative to <portal>/sharing/rest/ and anchored. Writes are POST only. */
export const NOTIFY_ALLOW: Rule[] = [
  { op: 'createGroup', re: /^community\/createGroup$/, methods: ['POST'] },
  { op: 'addUsers', re: new RegExp(`^community/groups/(${ID32})/addUsers$`), methods: ['POST'] },
  { op: 'removeUsers', re: new RegExp(`^community/groups/(${ID32})/removeUsers$`), methods: ['POST'] },
  { op: 'createNotification', re: new RegExp(`^community/groups/(${ID32})/createNotification$`), methods: ['POST'] },
  { op: 'deleteGroup', re: new RegExp(`^community/groups/(${ID32})/delete$`), methods: ['POST'] },
  { op: 'groupUsers', re: new RegExp(`^community/groups/(${ID32})/users$`), methods: ['GET'] },
  { op: 'searchGroups', re: /^community\/groups$/, methods: ['GET'] },
  { op: 'user', re: new RegExp(`^community/users/(${USER})$`), methods: ['GET'] },
  { op: 'portalSelf', re: /^portals\/self$/, methods: ['GET'] },
];

/** The keys createGroup may carry (ADR 0012). Anything else, or a group that is not private and titled as ours, is blocked. */
const CREATE_GROUP_KEYS = ['f', 'title', 'access', 'isInvitationOnly', 'isViewOnly', 'hiddenMembers', 'tags', 'snippet', 'description', 'thumbnail'];

function checkCreateGroup(p: Record<string, unknown>): void {
  const what = 'community/createGroup';
  if (Object.keys(p).some((k) => !CREATE_GROUP_KEYS.includes(k))) throw new BlockedRequest(what, 'unexpected createGroup parameter');
  if (p.title !== GROUP_TITLE) throw new BlockedRequest(what, "not the app's exact title");
  if (p.access !== 'private') throw new BlockedRequest(what, 'the group must be private');
  // Invitation-only, view-only, members hidden: the group can never be created any less private than ADR 0002 says.
  for (const k of ['isInvitationOnly', 'isViewOnly', 'hiddenMembers']) if (String(p[k]) !== 'true') throw new BlockedRequest(what, `${k} must be true`);
  if ('thumbnail' in p && !isPngThumbnail(p.thumbnail)) throw new BlockedRequest(what, 'the thumbnail must be a PNG of 200 KB or less');
}

export interface NotifyGuardContext {
  /** The signed-in username; `community/users/{u}` is allowed only for this user. */
  self?: string | null;
  /** The app's own group id. Group-scoped writes are allowed only for this id; with none, they are all blocked. */
  groupId?: string | null;
}

const WRITE_OPS: NotifyOp[] = ['createGroup', 'addUsers', 'removeUsers', 'createNotification', 'deleteGroup'];
export const isWriteOp = (op: NotifyOp): boolean => WRITE_OPS.includes(op);

/**
 * Returns the matched operation, or throws BlockedRequest. Never makes a request.
 * `params` is what the call will send. When given, createGroup's parameters are checked and deleteGroup must carry none
 * (ADR 0012). guardNotifyRequest always passes it, so every real call is checked.
 */
export function assertNotifyAllowed(path: string, method: string, ctx: NotifyGuardContext = {}, params?: Record<string, unknown>): NotifyOp {
  if (typeof path !== 'string' || !path) throw new BlockedRequest(String(path), 'empty path');
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) throw new BlockedRequest(path, 'absolute urls are not allowed');
  if (/[?#%\\\s]|(^|\/)\.\.?(\/|$)|\/\/|^\/|\/$/.test(path)) throw new BlockedRequest(path, 'malformed path');
  const m = String(method).toUpperCase();
  const rule = NOTIFY_ALLOW.find((r) => r.re.test(path));
  if (!rule) throw new BlockedRequest(path, 'endpoint is not on the notifier allow-list');
  if (!(rule.methods as string[]).includes(m)) throw new BlockedRequest(`${m} ${path}`, 'method not allowed for this endpoint');
  const arg = rule.re.exec(path)?.[1];
  if (rule.op === 'user' && (!ctx.self || arg !== ctx.self)) throw new BlockedRequest(path, 'only the signed-in user can be read');
  if (['addUsers', 'removeUsers', 'createNotification', 'deleteGroup', 'groupUsers'].includes(rule.op) && (!ctx.groupId || arg !== ctx.groupId)) {
    throw new BlockedRequest(path.replace(/[0-9a-f]{32}/g, '<id>'), "not the app's own group");
  }
  if (params) {
    if (rule.op === 'createGroup') checkCreateGroup(params);
    if (rule.op === 'deleteGroup' && Object.keys(params).length) throw new BlockedRequest(path.replace(/[0-9a-f]{32}/g, '<id>'), 'deleting a group takes no parameters');
  }
  return rule.op;
}

/** Wraps a raw request function: every call is checked against NOTIFY_ALLOW first, with the context read at call time. */
export function guardNotifyRequest(inner: RequestFn, ctx: () => NotifyGuardContext): RequestFn {
  return async (path, params = {}, options = {}) => {
    const rule = NOTIFY_ALLOW.find((r) => r.re.test(path));
    const method = (options.method ?? rule?.methods[0] ?? 'GET').toUpperCase() as Method;
    assertNotifyAllowed(path, method, ctx(), params);
    return inner(path, params, { ...options, method });
  };
}
