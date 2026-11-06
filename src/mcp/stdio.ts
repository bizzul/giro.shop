/**
 * Server MCP via stdio, per Claude Desktop o altri client locali.
 * Avvio: node src/mcp/stdio.ts
 * Con PUBLIC_SUPABASE_URL e PUBLIC_SUPABASE_PUBLISHABLE_KEY legge gli annunci da Supabase,
 * altrimenti usa i dati di prova.
 */
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createPiazzaServer } from './server.ts';
import { configureStore } from '../core/store.ts';

configureStore(process.env.PUBLIC_SUPABASE_URL, process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY);

const server = createPiazzaServer({
  baseUrl: process.env.PIAZZA_BASE_URL ?? 'http://localhost:4321',
  apiKey: process.env.ANTHROPIC_API_KEY,
});

await server.connect(new StdioServerTransport());
