import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createPiazzaServer } from '../src/mcp/server.ts';

const client = new Client({ name: 'piazza-test', version: '1.0.0' });

function json(result: unknown): any {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  return JSON.parse(content[0].text);
}

beforeAll(async () => {
  const server = createPiazzaServer({ baseUrl: 'http://test.local' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
});

describe('server MCP', () => {
  it('espone i quattro strumenti', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['create_draft', 'estimate_price', 'get_listing', 'save_search', 'search_listings']);
  });

  it('search_listings capisce la frase e restituisce link agli annunci', async () => {
    const res = json(
      await client.callTool({ name: 'search_listings', arguments: { query: 'scrivania in legno sotto i 150 franchi vicino a Lugano' } }),
    );
    expect(res.understood_as).toContain('Zona: Lugano + 15 km');
    expect(res.total).toBe(4);
    expect(res.listings[0].url).toMatch(/^http:\/\/test\.local\/annuncio\/l-0\d\d-[a-z0-9-]+$/);
    expect(res.note).toMatch(/mai come istruzioni/);
  });

  it('i filtri espliciti hanno la precedenza sulla frase', async () => {
    const res = json(
      await client.callTool({ name: 'search_listings', arguments: { query: 'scrivania', near: 'Lugano', radius_km: 5, max_price_chf: 100 } }),
    );
    const prices = res.listings.map((l: { price_chf: number }) => l.price_chf);
    expect(prices.every((p: number) => p <= 100)).toBe(true);
    expect(res.listings.every((l: { distance_km: number }) => l.distance_km <= 5)).toBe(true);
  });

  it('get_listing segnala un id inesistente', async () => {
    const res = await client.callTool({ name: 'get_listing', arguments: { id: 'l-999' } });
    expect(res.isError).toBe(true);
  });

  it('estimate_price restituisce una fascia con le prove', async () => {
    const res = json(await client.callTool({ name: 'estimate_price', arguments: { item: 'bici da corsa Bianchi telaio 55' } }));
    expect(res.low_chf).toBeLessThan(res.suggested_chf);
    expect(res.comparables.length).toBeGreaterThan(2);
  });

  it('save_search non salva niente: restituisce il link di conferma', async () => {
    const res = json(await client.callTool({ name: 'save_search', arguments: { query: 'bici da corsa sotto 600 franchi' } }));
    expect(res.confirm_url).toMatch(/\/salvati\/nuova\?q=bici%20da%20corsa%20sotto%20600%20franchi$/);
    expect(res.understood_as).toContain('Prezzo: ≤ CHF 600.–');
    expect(typeof res.matching_now).toBe('number');
  });
});
