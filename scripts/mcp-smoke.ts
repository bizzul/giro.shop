/**
 * Prova il server MCP via HTTP, come farebbe un assistente AI.
 * Uso: node scripts/mcp-smoke.ts [http://localhost:4321/mcp]
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const url = new URL(process.argv[2] ?? 'http://localhost:4321/mcp');
const client = new Client({ name: 'piazza-smoke', version: '1.0.0' });

function show(label: string, result: unknown) {
  const r = result as { isError?: boolean; content: Array<{ type: string; text?: string }> };
  const body = r.content.find((c) => c.type === 'text')?.text ?? '';
  console.log(`\n── ${label}${r.isError ? ' (errore)' : ''}`);
  console.log(body.length > 1400 ? `${body.slice(0, 1400)}\n…` : body);
  if (r.isError) process.exitCode = 1;
}

await client.connect(new StreamableHTTPClientTransport(url));
const { tools } = await client.listTools();
console.log(`Collegato a ${url.href}. Strumenti: ${tools.map((t) => t.name).join(', ')}`);

show(
  'search_listings',
  await client.callTool({ name: 'search_listings', arguments: { query: 'scrivania in legno sotto i 150 franchi vicino a Lugano', limit: 3 } }),
);
show('estimate_price', await client.callTool({ name: 'estimate_price', arguments: { item: 'bici da corsa Bianchi telaio 55', condition: 'buono' } }));
show(
  'create_draft',
  await client.callTool({
    name: 'create_draft',
    arguments: {
      description: 'Sci Atomic Redster 170 cm con attacchi, lamine affilate, qualche graffio sulla soletta',
      pickup_comune: 'Locarno',
    },
  }),
);

await client.close();
