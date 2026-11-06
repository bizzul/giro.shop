import type { APIRoute } from 'astro';
import { RESOURCE_PATH, oauthJson, preflight, protectedResourceMetadata } from '../../../core/oauth.ts';
import { siteOrigin } from '../../../lib/notify.ts';

/**
 * Metadati della risorsa protetta (RFC 9728) per il server MCP con accesso: /.well-known/oauth-protected-resource/mcp/account
 * (e, per i client che cercano alla radice, /.well-known/oauth-protected-resource).
 */
export const GET: APIRoute = ({ params, url }) => {
  const path = params.path ? `/${params.path}` : '';
  if (path && path !== RESOURCE_PATH) return new Response('Non trovato', { status: 404 });
  const res = oauthJson(protectedResourceMetadata(siteOrigin(url.origin)));
  res.headers.set('Cache-Control', 'public, max-age=3600');
  return res;
};
export const OPTIONS: APIRoute = () => preflight();
