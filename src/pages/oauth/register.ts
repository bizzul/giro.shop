import type { APIRoute } from 'astro';
import { oauthError, oauthJson, preflight } from '../../core/oauth.ts';
import { OAuthError, registerClient } from '../../lib/oauth.ts';
import { allow } from '../../lib/claude.ts';

/** Registrazione dinamica dei client (RFC 7591), come la usano Claude e gli altri client MCP. */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  // Registrare non dà accesso a niente, ma si limita lo stesso per evitare tabelle piene di client finti
  if (!allow(`oauth-register:${clientAddress}`, 20, 60 * 60_000)) return oauthError('slow_down', 'Troppe registrazioni: riprova più tardi.', 429);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return oauthError('invalid_client_metadata', 'Serve un oggetto JSON con i metadati del client.');
  try {
    return oauthJson(await registerClient(body as Record<string, unknown>), 201);
  } catch (error) {
    if (error instanceof OAuthError) return oauthError(error.code, error.message, error.status);
    throw error;
  }
};
export const OPTIONS: APIRoute = () => preflight();
