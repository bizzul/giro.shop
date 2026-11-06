import type { APIRoute } from 'astro';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createPiazzaServer } from '../../mcp/server.ts';
import { CORS, RESOURCE_PATH, resourceMetadataUrl } from '../../core/oauth.ts';
import { verifyAccessToken } from '../../lib/oauth.ts';
import { siteOrigin } from '../../lib/notify.ts';
import { invalidateListingPages } from '../../lib/cache.ts';

/**
 * Endpoint MCP con accesso (OAuth 2.1): gli stessi strumenti di /mcp più quelli che agiscono a nome della persona.
 * Senza token valido risponde 401 con l'indirizzo dei metadati (RFC 9728): il client MCP fa accedere la persona e riprova.
 */
export const ALL: APIRoute = async (context) => {
  const { request, url } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id' } });
  }
  const origin = siteOrigin(url.origin);
  const resource = `${origin}${RESOURCE_PATH}`;
  const header = request.headers.get('authorization') ?? '';
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? '';
  const grant = token ? await verifyAccessToken(token, resource) : null;
  if (!grant) {
    const challenge = [`Bearer resource_metadata="${resourceMetadataUrl(origin)}"`, token ? 'error="invalid_token", error_description="Token scaduto o revocato"' : '']
      .filter(Boolean)
      .join(', ');
    return new Response(JSON.stringify({ error: token ? 'invalid_token' : 'unauthorized', error_description: 'Serve l\'accesso a giro.shop.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': challenge, 'Cache-Control': 'no-store', ...CORS, 'Access-Control-Expose-Headers': 'WWW-Authenticate' },
    });
  }

  const handler = createMcpHandler(() =>
    createPiazzaServer({
      baseUrl: origin,
      apiKey: import.meta.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY,
      account: { grant, invalidate: () => invalidateListingPages(context) },
    }),
  );
  const response = await handler.fetch(request, {
    authInfo: { token, clientId: grant.clientId, scopes: grant.scopes, expiresAt: grant.expiresAt, resource: new URL(resource) },
  });
  response.headers.set('Cache-Control', 'no-store');
  return response;
};
