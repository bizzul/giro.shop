import { ActionError, defineAction, type ActionAPIContext } from 'astro:actions';
import { z } from 'astro/zod';
import { IMAGE_TYPES, MAX_PHOTOS, MAX_PHOTO_BYTES, type ImageMediaType } from '../core/draft.ts';
import { resolveComune } from '../core/comuni.ts';
import { refreshListings } from '../core/store.ts';
import { CATEGORY_IDS, CONDITIONS } from '../core/types.ts';
import { normalizeSwissMobile } from '../core/phone.ts';
import { MIN_PHOTOS, planPhotoOrder } from '../core/photos.ts';
import { invalidateListingPages } from '../lib/cache.ts';

/** Client Supabase con la sessione, oppure un errore chiaro. */
function requireSupabase(context: ActionAPIContext) {
  const supabase = context.locals.supabase;
  if (!supabase) throw new ActionError({ code: 'BAD_REQUEST', message: 'Supabase non è configurato.' });
  return supabase;
}

function requireUser(context: ActionAPIContext) {
  const supabase = requireSupabase(context);
  const user = context.locals.user;
  if (!user) throw new ActionError({ code: 'UNAUTHORIZED', message: 'Accedi per continuare.' });
  return { supabase, user };
}

/** Accetta solo percorsi interni, per non rimandare l'utente su altri siti dopo l'accesso. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/miei-annunci';
}

const EXTENSION: Record<ImageMediaType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export const account = {
  /** Manda un link di accesso via email: se l'account non esiste, lo crea. */
  sendMagicLink: defineAction({
    accept: 'form',
    input: z.object({
      email: z.string().trim().email('Scrivi un indirizzo email valido.'),
      next: z.string().nullish(),
    }),
    handler: async ({ email, next }, context) => {
      const supabase = requireSupabase(context);
      const redirect = new URL('/auth/callback', context.url.origin);
      redirect.searchParams.set('next', safeNext(next));
      const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect.href } });
      if (error) {
        throw new ActionError({
          code: error.status === 429 ? 'TOO_MANY_REQUESTS' : 'BAD_REQUEST',
          message: error.status === 429 ? 'Troppi tentativi: riprova tra qualche minuto.' : `Non riesco a mandare il link: ${error.message}`,
        });
      }
      return { email };
    },
  }),

  signOut: defineAction({
    accept: 'form',
    handler: async (_input, context) => {
      const supabase = requireSupabase(context);
      await supabase.auth.signOut();
      return { ok: true };
    },
  }),

  updateName: defineAction({
    accept: 'form',
    input: z.object({ displayName: z.string().trim().min(2, 'Almeno 2 caratteri.').max(40, 'Al massimo 40 caratteri.') }),
    handler: async ({ displayName }, context) => {
      const { supabase, user } = requireUser(context);
      const { error } = await supabase.from('profiles').update({ display_name: displayName }).eq('id', user.id);
      if (error) throw new ActionError({ code: 'BAD_REQUEST', message: `Non ho salvato il nome: ${error.message}` });
      await refreshListings(true);
      await invalidateListingPages(context);
      return { displayName };
    },
  }),

  /** Pubblica un annuncio con le sue foto. Le regole RLS garantiscono che chi vende sia l'utente. */
  publishListing: defineAction({
    accept: 'form',
    input: z.object({
      title: z.string().trim().min(3, 'Il titolo è troppo corto.').max(80, 'Il titolo supera gli 80 caratteri.'),
      description: z.string().trim().max(4000),
      category: z.enum(CATEGORY_IDS),
      condition: z.enum(CONDITIONS),
      price: z.coerce.number().min(0, 'Il prezzo non può essere negativo.').max(1_000_000),
      comune: z.string().trim().min(1, 'Scegli il comune di ritiro.'),
      tags: z.string().default('[]'),
      attributes: z.string().default('[]'),
      aiSource: z.enum(['claude', 'regole', 'manuale']),
      aiModel: z.string().nullish(),
      aiConfidence: z.coerce.number().min(0).max(1).nullish(),
      photos: z.array(z.instanceof(File)).optional(),
    }),
    handler: async (input, context) => {
      const { supabase, user } = requireUser(context);
      const comune = resolveComune(input.comune);
      if (!comune) throw new ActionError({ code: 'BAD_REQUEST', message: `Non conosco il comune "${input.comune}".` });

      const files = (input.photos ?? []).filter((f) => f.size > 0);
      if (files.length < MIN_PHOTOS) throw new ActionError({ code: 'BAD_REQUEST', message: "Aggiungi almeno una foto: la prima è la copertina dell'annuncio." });
      if (files.length > MAX_PHOTOS) throw new ActionError({ code: 'BAD_REQUEST', message: `Al massimo ${MAX_PHOTOS} foto.` });
      for (const f of files) {
        if (!IMAGE_TYPES.includes(f.type as ImageMediaType) || f.size > MAX_PHOTO_BYTES) {
          throw new ActionError({ code: 'BAD_REQUEST', message: `"${f.name}" non è un'immagine valida sotto i 5 MB.` });
        }
      }

      const tags = (JSON.parse(input.tags) as unknown[]).filter((t): t is string => typeof t === 'string').slice(0, 12);
      const attributes = Object.fromEntries(
        (JSON.parse(input.attributes) as Array<{ name?: unknown; value?: unknown }>)
          .filter((a) => typeof a.name === 'string' && typeof a.value === 'string')
          .slice(0, 12)
          .map((a) => [String(a.name).toLowerCase(), String(a.value)]),
      );

      const { data: listing, error } = await supabase
        .from('listings')
        .insert({
          seller_id: user.id,
          status: 'pubblicato',
          title: input.title,
          description: input.description,
          category_id: input.category,
          tags,
          attributes,
          price_chf: input.price,
          condition: input.condition,
          comune_id: comune.id,
          ai_source: input.aiSource,
          ai_model: input.aiModel ?? null,
          ai_confidence: input.aiConfidence ?? null,
        })
        .select('id')
        .single();
      if (error || !listing) throw new ActionError({ code: 'BAD_REQUEST', message: `Non ho pubblicato l'annuncio: ${error?.message}` });

      // Foto nella cartella dell'utente: foto/<utente>/<annuncio>/<n>.jpg
      const rows: Array<{ listing_id: string; storage_path: string; position: number }> = [];
      for (const [i, file] of files.entries()) {
        const path = `${user.id}/${listing.id}/${i}.${EXTENSION[file.type as ImageMediaType]}`;
        const { error: uploadError } = await supabase.storage.from('foto').upload(path, file, { contentType: file.type });
        if (uploadError) {
          await supabase.from('listings').delete().eq('id', listing.id);
          throw new ActionError({ code: 'BAD_REQUEST', message: `Caricamento della foto ${i + 1} non riuscito: ${uploadError.message}` });
        }
        rows.push({ listing_id: listing.id, storage_path: path, position: i });
      }
      if (rows.length) {
        const { error: photoError } = await supabase.from('listing_photos').insert(rows);
        if (photoError) throw new ActionError({ code: 'BAD_REQUEST', message: `Annuncio pubblicato, ma le foto non sono state collegate: ${photoError.message}` });
      }

      await refreshListings(true);
      await invalidateListingPages(context);
      return { id: listing.id as string };
    },
  }),

  /** Segna come venduto, rimette in vendita o archivia un proprio annuncio. */
  setListingStatus: defineAction({
    accept: 'form',
    input: z.object({
      id: z.string().min(1),
      status: z.enum(['pubblicato', 'venduto', 'archiviato']),
      soldPrice: z.coerce.number().min(0).max(1_000_000).nullish(),
    }),
    handler: async ({ id, status, soldPrice }, context) => {
      const { supabase, user } = requireUser(context);
      const patch: Record<string, unknown> = { status };
      if (status === 'venduto') patch.sold_price_chf = soldPrice ?? null;
      if (status === 'pubblicato') Object.assign(patch, { sold_at: null, sold_price_chf: null });
      const { data, error } = await supabase.from('listings').update(patch).eq('id', id).eq('seller_id', user.id).select('id');
      if (error) throw new ActionError({ code: 'BAD_REQUEST', message: `Non ho aggiornato l'annuncio: ${error.message}` });
      if (!data?.length) throw new ActionError({ code: 'NOT_FOUND', message: 'Annuncio non trovato tra i tuoi.' });
      await refreshListings(true);
      await invalidateListingPages(context);
      return { id, status };
    },
  }),

  /** Elimina un proprio annuncio e le sue foto. */
  deleteListing: defineAction({
    accept: 'form',
    input: z.object({ id: z.string().min(1) }),
    handler: async ({ id }, context) => {
      const { supabase, user } = requireUser(context);
      const folder = `${user.id}/${id}`;
      const { data: files } = await supabase.storage.from('foto').list(folder);
      if (files?.length) await supabase.storage.from('foto').remove(files.map((f) => `${folder}/${f.name}`));
      const { data, error } = await supabase.from('listings').delete().eq('id', id).eq('seller_id', user.id).select('id');
      if (error) throw new ActionError({ code: 'BAD_REQUEST', message: `Non ho eliminato l'annuncio: ${error.message}` });
      if (!data?.length) throw new ActionError({ code: 'NOT_FOUND', message: 'Annuncio non trovato tra i tuoi.' });
      await refreshListings(true);
      await invalidateListingPages(context);
      return { id };
    },
  }),
  /** Passo 1 della verifica del cellulare: Supabase manda un SMS con un codice a 6 cifre. */
  startPhoneVerification: defineAction({
    accept: 'form',
    input: z.object({ phone: z.string().trim().min(6, 'Scrivi il numero di cellulare.') }),
    handler: async ({ phone }, context) => {
      const { supabase } = requireUser(context);
      const e164 = normalizeSwissMobile(phone);
      if (!e164) throw new ActionError({ code: 'BAD_REQUEST', message: 'Serve un numero di cellulare svizzero (075–079), per esempio 079 123 45 67.' });
      const { error } = await supabase.auth.updateUser({ phone: e164 });
      if (error) {
        const taken = /already|exists|registered/i.test(error.message);
        throw new ActionError({
          code: taken ? 'CONFLICT' : 'BAD_REQUEST',
          message: taken ? 'Questo numero di cellulare è già collegato a un altro account.' : `Non riesco a mandare l'SMS: ${error.message}`,
        });
      }
      return { phone: e164 };
    },
  }),

  /** Passo 2: il codice ricevuto conferma il numero; il profilo diventa "cellulare verificato". */
  confirmPhone: defineAction({
    accept: 'form',
    input: z.object({
      phone: z.string().regex(/^\+417[5-9]\d{7}$/),
      code: z.string().trim().regex(/^\d{6}$/, 'Il codice ha 6 cifre.'),
    }),
    handler: async ({ phone, code }, context) => {
      const { supabase } = requireUser(context);
      const { error } = await supabase.auth.verifyOtp({ phone, token: code, type: 'phone_change' });
      if (error) throw new ActionError({ code: 'BAD_REQUEST', message: 'Codice errato o scaduto. Chiedine uno nuovo.' });
      await refreshListings(true);
      await invalidateListingPages(context);
      return { phone };
    },
  }),

  /** Modifica un annuncio già pubblicato: testi, prezzo, stato, luogo e foto (toglierne e aggiungerne). */
  updateListing: defineAction({
    accept: 'form',
    input: z.object({
      id: z.string().min(1),
      title: z.string().trim().min(3, 'Il titolo è troppo corto.').max(80, 'Il titolo supera gli 80 caratteri.'),
      description: z.string().trim().max(4000),
      category: z.enum(CATEGORY_IDS),
      condition: z.enum(CONDITIONS),
      price: z.coerce.number().min(0, 'Il prezzo non può essere negativo.').max(1_000_000),
      negotiable: z.string().nullish(),
      comune: z.string().trim().min(1, 'Scegli il comune di ritiro.'),
      tags: z.string().nullish(),
      /** Ordine dei riquadri: "e:<percorso>" foto già salvata, "n:<indice>" file nuovo. Il primo è la copertina. */
      order: z.array(z.string()).optional(),
      photos: z.array(z.instanceof(File)).optional(),
    }),
    handler: async (input, context) => {
      const { supabase, user } = requireUser(context);
      const comune = resolveComune(input.comune);
      if (!comune) throw new ActionError({ code: 'BAD_REQUEST', message: `Non conosco il comune "${input.comune}".` });

      const { data: current, error: readError } = await supabase
        .from('listings')
        .select('id, photos:listing_photos(id, storage_path, position)')
        .eq('id', input.id)
        .eq('seller_id', user.id)
        .maybeSingle();
      if (readError || !current) throw new ActionError({ code: 'NOT_FOUND', message: 'Annuncio non trovato tra i tuoi.' });

      // Prima si controllano le foto: se qualcosa non va, l'annuncio resta com'era
      const photos = (current.photos ?? []) as Array<{ id: number; storage_path: string; position: number }>;
      const files = (input.photos ?? []).filter((f) => f.size > 0);
      const plan = planPhotoOrder(input.order ?? [], photos.map((p) => p.storage_path), files.length);
      if (!plan.ok) throw new ActionError({ code: 'BAD_REQUEST', message: plan.error });
      for (const file of files) {
        if (!IMAGE_TYPES.includes(file.type as ImageMediaType) || file.size > MAX_PHOTO_BYTES) {
          throw new ActionError({ code: 'BAD_REQUEST', message: `"${file.name}" non è un'immagine JPEG, PNG o WebP sotto i 5 MB.` });
        }
      }

      const tags = (input.tags ?? '')
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 12);
      const { error } = await supabase
        .from('listings')
        .update({
          title: input.title,
          description: input.description,
          category_id: input.category,
          condition: input.condition,
          price_chf: input.price,
          negotiable: Boolean(input.negotiable),
          comune_id: comune.id,
          tags,
        })
        .eq('id', input.id)
        .eq('seller_id', user.id);
      if (error) throw new ActionError({ code: 'BAD_REQUEST', message: `Modifiche non salvate: ${error.message}` });

      // Foto nuove nella cartella dell'utente
      const uploaded = new Map<number, string>();
      for (const slot of plan.slots) {
        if (slot.kind !== 'new') continue;
        const file = files[slot.fileIndex];
        const path = `${user.id}/${input.id}/${Date.now()}-${slot.fileIndex}.${EXTENSION[file.type as ImageMediaType]}`;
        const { error: uploadError } = await supabase.storage.from('foto').upload(path, file, { contentType: file.type });
        if (uploadError) throw new ActionError({ code: 'BAD_REQUEST', message: `Caricamento di "${file.name}" non riuscito: ${uploadError.message}` });
        uploaded.set(slot.fileIndex, path);
      }

      // Posizioni nell'ordine scelto: la prima è la copertina
      const byPath = new Map(photos.map((p) => [p.storage_path, p]));
      for (const [position, slot] of plan.slots.entries()) {
        const result =
          slot.kind === 'existing'
            ? await supabase.from('listing_photos').update({ position }).eq('id', byPath.get(slot.path)!.id)
            : await supabase.from('listing_photos').insert({ listing_id: input.id, storage_path: uploaded.get(slot.fileIndex), position });
        if (result.error) throw new ActionError({ code: 'BAD_REQUEST', message: `Foto non salvate: ${result.error.message}` });
      }

      // Foto tolte: righe e file (solo quelli nella cartella dell'utente)
      const kept = new Set(plan.slots.flatMap((slot) => (slot.kind === 'existing' ? [slot.path] : [])));
      const removed = photos.filter((p) => !kept.has(p.storage_path));
      if (removed.length) {
        await supabase.from('listing_photos').delete().in('id', removed.map((p) => p.id));
        const own = removed.map((p) => p.storage_path).filter((path) => path.startsWith(`${user.id}/`));
        if (own.length) {
          const { data: gone, error: removeError } = await supabase.storage.from('foto').remove(own);
          if (removeError || (gone?.length ?? 0) < own.length) console.warn(`[piazza] foto non cancellate dallo storage: ${removeError?.message ?? own.join(', ')}`);
        }
      }

      await refreshListings(true);
      await invalidateListingPages(context);
      return { id: input.id };
    },
  }),
};
