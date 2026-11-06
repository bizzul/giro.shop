import type { APIRoute } from 'astro';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createPiazzaServer } from '../mcp/server.ts';

/**
 * Endpoint MCP (Streamable HTTP, senza sessione): ogni richiesta crea un server nuovo.
 * Gli strumenti usano le stesse funzioni del sito.
 */
const handler = createMcpHandler(() =>
  createPiazzaServer({
    baseUrl: import.meta.env.PIAZZA_BASE_URL ?? process.env.PIAZZA_BASE_URL ?? 'http://localhost:4321',
    apiKey: import.meta.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY,
  }),
);

export const ALL: APIRoute = ({ request }) => handler.fetch(request);
