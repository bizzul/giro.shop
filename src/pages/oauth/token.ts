import type { APIRoute } from 'astro';
import { oauthError, oauthJson, preflight } from '../../core/oauth.ts';
import { OAuthError, authenticateClient, exchangeCode, refreshTokens } from '../../lib/oauth.ts';

/** Endpoint dei token: codice + PKCE → token di accesso e di rinnovo; rinnovo con rotazione. */
export const POST: APIRoute = async ({ request }) => {
  const form = await request.formData().catch(() => null);
  if (!form) return oauthError('invalid_request', 'Corpo application/x-www-form-urlencoded richiesto.');
  try {
    const client = await authenticateClient(form, request.headers.get('authorization'));
    const grant = form.get('grant_type')?.toString();
    if (grant === 'authorization_code') return oauthJson(await exchangeCode(client, form));
    if (grant === 'refresh_token') return oauthJson(await refreshTokens(client, form));
    return oauthError('unsupported_grant_type', 'Sono supportati authorization_code e refresh_token.');
  } catch (error) {
    if (error instanceof OAuthError) {
      return oauthError(error.code, error.message, error.status, error.status === 401 ? { 'WWW-Authenticate': 'Basic realm="giro.shop"' } : {});
    }
    throw error;
  }
};
export const OPTIONS: APIRoute = () => preflight();
