import type { APIRoute } from 'astro';
import { authorizationServerMetadata, oauthJson, preflight } from '../../core/oauth.ts';
import { siteOrigin } from '../../lib/notify.ts';

/** Metadati del server di autorizzazione (RFC 8414): i client MCP li leggono per sapere dove far accedere la persona. */
export const GET: APIRoute = ({ url }) => {
  const res = oauthJson(authorizationServerMetadata(siteOrigin(url.origin)));
  res.headers.set('Cache-Control', 'public, max-age=3600');
  return res;
};
export const OPTIONS: APIRoute = () => preflight();
