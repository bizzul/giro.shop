import type { APIRoute } from 'astro';
import { oauthError, preflight, CORS } from '../../core/oauth.ts';
import { OAuthError, authenticateClient, revokeToken } from '../../lib/oauth.ts';

/** Revoca (RFC 7009): risponde 200 anche per token sconosciuti, così non si scopre quali esistono. */
export const POST: APIRoute = async ({ request }) => {
  const form = await request.formData().catch(() => null);
  const token = form?.get('token')?.toString();
  if (!form || !token) return oauthError('invalid_request', 'Manca il token da revocare.');
  try {
    const client = await authenticateClient(form, request.headers.get('authorization'));
    await revokeToken(client, token);
    return new Response(null, { status: 200, headers: { 'Cache-Control': 'no-store', ...CORS } });
  } catch (error) {
    if (error instanceof OAuthError) return oauthError(error.code, error.message, error.status);
    throw error;
  }
};
export const OPTIONS: APIRoute = () => preflight();
