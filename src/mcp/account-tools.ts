/**
 * Strumenti MCP che agiscono a nome di una persona, dopo l'accesso OAuth (endpoint /mcp/account).
 * Ogni strumento controlla il permesso concesso (ricerche, annunci) e lavora solo sui dati di quella persona:
 * il server usa la chiave di servizio, quindi i controlli "è tuo?" sono qui, espliciti, in ogni query.
 */
import { listingFee } from '../core/pricing.ts';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { CATEGORY_IDS, CONDITIONS } from '../core/types.ts';
import { parseQuery } from '../core/query.ts';
import { search } from '../core/search.ts';
import { resolveComune } from '../core/comuni.ts';
import { getListing, refreshListings } from '../core/store.ts';
import { MIN_PHOTOS } from '../core/photos.ts';
import { MAX_PHOTOS } from '../core/draft.ts';
import { formatChf } from '../core/format.ts';
import { adminClient } from '../lib/admin.ts';
import { forgetSavedSearches } from '../lib/demand.ts';
import { allow } from '../lib/claude.ts';
import { afterPriceChange, afterPublish, afterSale, afterTextChange } from '../lib/listing-events.ts';
import { fetchImage, ImageFetchError } from '../lib/fetch-image.ts';
import { storePhoto } from '../lib/photo-store.ts';
import type { AccessGrant } from '../lib/oauth.ts';
import type { Scope } from '../core/oauth.ts';

const MAX_SEARCHES = 20;
const PUBLISH_PER_DAY = 20;
const EXTENSION = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' } as const;

export interface AccountToolsOptions {
  grant: AccessGrant;
  baseUrl: string;
  /** Svuota la cache delle pagine con annunci dopo una modifica. */
  invalidate: () => Promise<void>;
}

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
const fail = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

export const ACCOUNT_TOOL_DOCS = [
  { name: 'save_search', scope: 'ricerche', summary: 'Salva una ricerca con avviso, direttamente nel tuo account.' },
  { name: 'my_saved_searches', scope: 'ricerche', summary: 'Le tue ricerche salvate, con quanti annunci corrispondono ora.' },
  { name: 'delete_saved_search', scope: 'ricerche', summary: 'Toglie una ricerca salvata.' },
  { name: 'publish_listing', scope: 'annunci', summary: 'Pubblica un annuncio a tuo nome (senza foto resta in bozza).' },
  { name: 'my_listings', scope: 'annunci', summary: 'I tuoi annunci, con stato, prezzo e scadenza.' },
  { name: 'update_listing', scope: 'annunci', summary: 'Cambia prezzo, testo o stato (venduto, ritirato, di nuovo in vendita).' },
] as const;

export function registerAccountTools(server: McpServer, options: AccountToolsOptions): void {
  const { grant, baseUrl, invalidate } = options;
  const userId = grant.userId;
  const admin = adminClient();
  const has = (scope: Scope) => grant.scopes.includes(scope);
  const missing = (scope: Scope) => fail(`Permesso "${scope}" non concesso: scollega e ricollega giro.shop dall'assistente, accettando anche questo permesso.`);

  if (!admin) return;

  // ── Ricerche salvate ────────────────────────────────────────────────────────

  server.registerTool(
    'save_search',
    {
      title: 'Salva una ricerca con avviso',
      description:
        "Salva una ricerca nell'account della persona: giro.shop le scriverà (nel sito e per email) quando arriva un annuncio che corrisponde. Usalo quando la persona chiede di essere avvisata.",
      inputSchema: z.object({
        query: z.string().min(2).max(200).describe('La ricerca come frase: "bici da corsa sotto i 500 franchi vicino a Bellinzona"'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query }) => {
      if (!has('ricerche')) return missing('ricerche');
      await refreshListings();
      const q = query.trim();
      const { data: existing } = await admin.from('alerts').select('id, query').eq('user_id', userId);
      const same = (existing ?? []).find((a) => a.query.trim().toLowerCase() === q.toLowerCase());
      const { chips, total } = search(q, { limit: 1 });
      if (same) return text({ saved: true, already_saved: true, id: same.id, query: q, matching_now: total, manage_url: `${baseUrl}/salvati#ricerche` });
      if ((existing?.length ?? 0) >= MAX_SEARCHES) return fail(`La persona ha già ${MAX_SEARCHES} ricerche salvate: prima toglierne una (delete_saved_search).`);
      const { filters } = parseQuery(q);
      const { data, error } = await admin.from('alerts').insert({ user_id: userId, query: q, filters }).select('id').single();
      forgetSavedSearches();
      if (error || !data) return fail(`Ricerca non salvata: ${error?.message}`);
      return text({
        saved: true,
        id: data.id,
        query: q,
        understood_as: chips.map((c) => `${c.key}: ${c.value}`),
        matching_now: total,
        manage_url: `${baseUrl}/salvati#ricerche`,
      });
    },
  );

  server.registerTool(
    'my_saved_searches',
    {
      title: 'Le mie ricerche salvate',
      description: 'Le ricerche con avviso della persona e quanti annunci corrispondono adesso.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      if (!has('ricerche')) return missing('ricerche');
      await refreshListings();
      const { data } = await admin.from('alerts').select('id, query, created_at').eq('user_id', userId).order('created_at', { ascending: false });
      return text({
        searches: (data ?? []).map((a) => ({
          id: a.id,
          query: a.query,
          saved_at: a.created_at,
          matching_now: search(a.query, { limit: 1 }).total,
          results_url: `${baseUrl}/cerca?q=${encodeURIComponent(a.query)}`,
        })),
      });
    },
  );

  server.registerTool(
    'delete_saved_search',
    {
      title: 'Togli una ricerca salvata',
      description: 'Toglie una ricerca salvata della persona (non arriveranno più avvisi per quella ricerca).',
      inputSchema: z.object({ id: z.string().uuid().describe('Id della ricerca, da my_saved_searches') }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      if (!has('ricerche')) return missing('ricerche');
      const { data, error } = await admin.from('alerts').delete().eq('id', id).eq('user_id', userId).select('query');
      forgetSavedSearches();
      if (error) return fail(`Ricerca non tolta: ${error.message}`);
      if (!data?.length) return fail('Ricerca non trovata tra quelle della persona.');
      return text({ deleted: true, query: data[0].query });
    },
  );

  // ── Annunci ────────────────────────────────────────────────────────────────

  server.registerTool(
    'publish_listing',
    {
      title: 'Pubblica un annuncio',
      description: [
        "Pubblica un annuncio a nome della persona: diventa visibile a tutti su giro.shop. Chiedi sempre conferma alla persona prima di pubblicare, mostrandole titolo, prezzo e comune.",
        'Per preparare i campi puoi usare prima create_draft.',
        `Servono da ${MIN_PHOTOS} a ${MAX_PHOTOS} foto come indirizzi https pubblici (photo_urls): solo foto dell'oggetto vero, della persona o che lei può usare.`,
        "Senza foto l'annuncio resta in bozza: restituisce il link dove la persona aggiunge le foto e lo pubblica.",
      ].join(' '),
      inputSchema: z.object({
        title: z.string().trim().min(3).max(80),
        description: z.string().trim().max(4000),
        category: z.enum(CATEGORY_IDS),
        condition: z.enum(CONDITIONS),
        price_chf: z.number().min(0).max(1_000_000),
        comune: z.string().describe('Comune ticinese di ritiro, es. "Lugano"'),
        negotiable: z.boolean().optional().describe('Prezzo trattabile'),
        tags: z.array(z.string().max(40)).max(12).optional(),
        shipping: z.boolean().optional().describe('Chi vende può anche spedire'),
        shipping_chf: z.number().min(0).max(500).optional(),
        photo_urls: z.array(z.string().url()).max(MAX_PHOTOS).optional().describe('Foto dell\'oggetto, indirizzi https; la prima è la copertina'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (input) => {
      if (!has('annunci')) return missing('annunci');
      if (!allow(`mcp-publish:${userId}`, PUBLISH_PER_DAY, 24 * 60 * 60_000)) return fail(`Al massimo ${PUBLISH_PER_DAY} annunci al giorno dal connettore.`);
      const comune = resolveComune(input.comune);
      if (!comune) return fail(`Non conosco il comune "${input.comune}". Usa un comune ticinese, es. Lugano, Bellinzona, Locarno.`);

      // Prima le foto: se una non si scarica, non si crea niente
      const photos: Array<{ type: keyof typeof EXTENSION; bytes: Buffer }> = [];
      for (const [i, url] of (input.photo_urls ?? []).entries()) {
        try {
          photos.push(await fetchImage(url));
        } catch (error) {
          const why = error instanceof ImageFetchError ? error.message : 'errore di rete';
          return fail(`La foto ${i + 1} (${url}) non si può usare: ${why}. Nessun annuncio creato.`);
        }
      }
      // Auto, moto e affitti senza negozio Pro: in bozza, la pubblicazione si paga dal sito
      const fee = listingFee(input.category);
      const { data: pro } = fee ? await admin.rpc('is_pro', { p_user: userId }) : { data: true };
      const unpaid = Boolean(fee && !pro);
      const draft = photos.length < MIN_PHOTOS || unpaid;

      const { data: listing, error } = await admin
        .from('listings')
        .insert({
          seller_id: userId,
          status: draft ? 'bozza' : 'pubblicato',
          title: input.title,
          description: input.description,
          category_id: input.category,
          tags: input.tags ?? [],
          attributes: {},
          price_chf: input.price_chf,
          negotiable: input.negotiable ?? false,
          condition: input.condition,
          comune_id: comune.id,
          shipping: Boolean(input.shipping),
          shipping_chf: input.shipping ? (input.shipping_chf ?? null) : null,
          ai_source: 'claude',
          ai_model: `mcp:${grant.clientName}`.slice(0, 80),
        })
        .select('id')
        .single();
      if (error || !listing) return fail(`Annuncio non creato: ${error?.message}`);

      for (const [i, photo] of photos.entries()) {
        const path = `${userId}/${listing.id}/${i}.${EXTENSION[photo.type]}`;
        // Con la miniatura accanto (src/lib/photo-store.ts)
        const stored = await storePhoto(admin, path, photo.bytes, photo.type);
        const { error: rowError } = stored.error !== null ? { error: null } : await admin.from('listing_photos').insert({ listing_id: listing.id, position: i, ...stored.photo });
        if (stored.error !== null || rowError) {
          await admin.from('listings').delete().eq('id', listing.id);
          return fail(`Foto ${i + 1} non salvata (${stored.error ?? rowError?.message}): nessun annuncio creato.`);
        }
      }

      await refreshListings(true);
      await invalidate();
      const editUrl = `${baseUrl}/miei-annunci/${listing.id}`;
      if (unpaid && photos.length >= MIN_PHOTOS) {
        return text({
          published: false,
          status: 'bozza',
          id: listing.id,
          next_step: `In questa categoria la pubblicazione costa ${formatChf(fee!)} (gratis con un negozio Pro). Mostra questo link alla persona: in I miei annunci tocca «Paga e pubblica».`,
          pay_url: `${baseUrl}/miei-annunci#a-${listing.id}`,
        });
      }
      if (draft) {
        return text({
          published: false,
          status: 'bozza',
          id: listing.id,
          next_step: `Serve almeno una foto. Mostra questo link alla persona: aggiunge la foto e poi tocca «Pubblica» in I miei annunci.`,
          add_photos_url: editUrl,
        });
      }
      afterPublish(listing.id, baseUrl, invalidate);
      return text({ published: true, id: listing.id, url: `${baseUrl}/annuncio/${listing.id}`, edit_url: editUrl, photos: photos.length });
    },
  );

  server.registerTool(
    'my_listings',
    {
      title: 'I miei annunci',
      description: 'Gli annunci della persona (anche bozze, venduti e scaduti) con stato, prezzo e scadenza.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      if (!has('annunci')) return missing('annunci');
      const { data } = await admin
        .from('listings')
        .select('id, title, price_chf, status, published_at, expires_at, hidden_at, photos:listing_photos(count)')
        .eq('seller_id', userId)
        .order('created_at', { ascending: false })
        .limit(100);
      return text({
        listings: (data ?? []).map((l) => ({
          id: l.id,
          title: l.title,
          price_chf: Number(l.price_chf),
          status: l.status,
          hidden_by_moderation: Boolean(l.hidden_at),
          photos: (l.photos as unknown as Array<{ count: number }>)[0]?.count ?? 0,
          published_at: l.published_at,
          expires_at: l.expires_at,
          url: `${baseUrl}/annuncio/${l.id}`,
          edit_url: `${baseUrl}/miei-annunci/${l.id}`,
        })),
      });
    },
  );

  server.registerTool(
    'update_listing',
    {
      title: 'Modifica un annuncio',
      description:
        "Cambia prezzo, titolo, descrizione o stato di un annuncio della persona. Stati: 'pubblicato' (di nuovo in vendita, o pubblica una bozza con foto), 'venduto', 'archiviato' (ritirato). Chiedi conferma prima.",
      inputSchema: z.object({
        id: z.string().describe("Id dell'annuncio, da my_listings"),
        price_chf: z.number().min(0).max(1_000_000).optional(),
        title: z.string().trim().min(3).max(80).optional(),
        description: z.string().trim().max(4000).optional(),
        status: z.enum(['pubblicato', 'venduto', 'archiviato']).optional(),
        sold_price_chf: z.number().min(0).max(1_000_000).optional().describe('Con status "venduto": a quanto'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      if (!has('annunci')) return missing('annunci');
      const { data: current } = await admin
        .from('listings')
        .select('id, status, price_chf, hidden_at, listing_photos(count)')
        .eq('id', input.id)
        .eq('seller_id', userId)
        .maybeSingle();
      if (!current) return fail('Annuncio non trovato tra quelli della persona.');
      if (current.hidden_at) return fail("L'annuncio è nascosto dalla moderazione: si può contestare dal sito, non da qui.");
      const patch: Record<string, unknown> = {};
      if (input.price_chf != null) patch.price_chf = input.price_chf;
      if (input.title) patch.title = input.title;
      if (input.description != null) patch.description = input.description;
      if (input.status) {
        const photos = (current.listing_photos as unknown as Array<{ count: number }>)[0]?.count ?? 0;
        if (input.status === 'pubblicato' && photos < MIN_PHOTOS) return fail(`Per pubblicare serve almeno una foto: la persona la aggiunge qui ${baseUrl}/miei-annunci/${input.id}`);
        patch.status = input.status;
        if (input.status === 'venduto') patch.sold_price_chf = input.sold_price_chf ?? null;
        if (input.status === 'pubblicato') Object.assign(patch, { sold_at: null, sold_price_chf: null });
      }
      if (!Object.keys(patch).length) return fail('Niente da cambiare.');
      const before = getListing(input.id);
      const { error } = await admin.from('listings').update(patch).eq('id', input.id).eq('seller_id', userId);
      if (error) return fail(`Annuncio non aggiornato: ${error.message}`);
      await refreshListings(true);
      await invalidate();
      const after = getListing(input.id);
      if (current.status === 'bozza' && input.status === 'pubblicato') afterPublish(input.id, baseUrl, invalidate);
      else if (input.title || input.description != null) afterTextChange(input.id, invalidate);
      if (before && after && input.price_chf != null && Number(current.price_chf) !== input.price_chf) {
        await afterPriceChange(after, Number(current.price_chf), input.price_chf, baseUrl);
      }
      if (before && input.status === 'venduto' && current.status !== 'venduto') await afterSale(before, null, null, baseUrl);
      return text({
        updated: true,
        id: input.id,
        status: input.status ?? current.status,
        price: formatChf(input.price_chf ?? Number(current.price_chf)),
        url: `${baseUrl}/annuncio/${input.id}`,
      });
    },
  );
}
