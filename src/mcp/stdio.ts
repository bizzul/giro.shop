/**
 * Server MCP via stdio, per Claude Desktop o altri client locali.
 * Avvio: node src/mcp/stdio.ts
 */
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createPiazzaServer } from './server.ts';

const server = createPiazzaServer({
  baseUrl: process.env.PIAZZA_BASE_URL ?? 'http://localhost:4321',
  apiKey: process.env.ANTHROPIC_API_KEY,
});

await server.connect(new StdioServerTransport());
