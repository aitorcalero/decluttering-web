import { describe, expect, it } from 'vitest';
import { APPROVAL_MESSAGE, oauthErrorMessage, parseOAuthError } from './oauth-error';

describe('parseOAuthError', () => {
  it('reads error and description', () => {
    expect(parseOAuthError('?error=access_denied&error_description=No+way')).toEqual({ error: 'access_denied', description: 'No way' });
  });
  it('returns null on a normal return or empty query', () => {
    expect(parseOAuthError('?code=abc&state=xyz')).toBeNull();
    expect(parseOAuthError('')).toBeNull();
  });
});

describe('oauthErrorMessage', () => {
  it('always mentions app approval', () => {
    expect(oauthErrorMessage(new Error('boom'))).toContain('approve');
    expect(oauthErrorMessage(undefined)).toBe(APPROVAL_MESSAGE);
  });
});
