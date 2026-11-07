import { ActionError, defineAction, type ActionAPIContext } from 'astro:actions';
import { z } from 'astro/zod';
import { IMAGE_TYPES, MAX_PHOTOS, MAX_PHOTO_BYTES, type ImageMediaType } from '../core/draft.ts';
import { resolveComune } from '../core/comuni.ts';
import { getListing, photoUrl, refreshListings } from '../core/store.ts';
import { CATEGORY_IDS, CONDITIONS } from '../core/types.ts';
import { EMAIL_GROUPS, EMAIL_MODES, offKindsFromGroups, type EmailMode } from '../core/email-prefs.ts';
import { normalizeSwissMobile } from '../core/phone.ts';
import { HANDS } from '../core/hand.ts';
import { AVAILABILITY_KEYS } from '../core/pickup.ts';
import { listingFee } from '../core/pricing.ts';
import { createPayment } from '../lib/payments.ts';
import { MIN_PHOTOS, planPhotoOrder } from '../core/photos.ts';
import { invalidateListingPages } from '../lib/cache.ts';
import { afterPriceChange, afterPriceEdit, afterPublish, afterSale, afterTextChange } from '../lib/listing-events.ts';
import { siteOrigin } from '../lib/notify.ts';
import { adminClient } from '../lib/admin.ts';
import { disconnect } from '../lib/oauth.ts';
import { storePhoto, type StoredPhoto } from '../lib/photo-store.ts';
import { markPasskeyOffer } from '../lib/passkey-offer.ts';
import { allow } from '../lib/claude.ts';

/** Spedizione dal form: casella "si spedisce" e costo facoltativo. */
const shippingFields = {
  shipping: z.string().nullish(),
  shippingChf: z.preprocess((v) => (v === '' || v == null ? null : v), z.coerce.number().min(0, 'Il costo di spedizione non può essere negativo.').max(500).nullable()).optional(),
};
const shippingColumns = (input: { shipping?: string | null; shippingChf?: number | null }) => {
  const shipping = Boolean(input.shipping);
  return { shipping, shipping_chf: shipping ? (input.shippingChf ?? null) : null };
};

/** Impostazioni private dell'annuncio dal modulo di modifica: ribasso automatico e offerta minima. */
const emptyToNull = (v: unknown) => (v === '' || v == null ? null : v);
const sellerSettingsFields = {
  /** Presente solo nel modulo di modifica: senza, le impostazioni restano come sono. */
  settings: z.string().nullish(),
  dropOn: z.string().nullish(),
  dropPct: z.preprocess(emptyToNull, z.coerce.number().int().min(1).max(50).nullable()).optional(),
  dropDays: z.preprocess(emptyToNull, z.coerce.number().int().min(1).max(90).nullable()).optional(),
  dropFloor: z.preprocess(emptyToNull, z.coerce.number().min(0, 'Il minimo non può essere negativo.').max(1_000_000).nullable()).optional(),
  minOffer: z.preprocess(emptyToNull, z.coerce.number().min(0, "L'offerta minima non può essere negativa.").max(1_000_000).nullable()).optional(),
};
type SettingsInput = { settings?: string | null; dropOn?: string | null; dropPct?: number | null; dropDays?: number | null; dropFloor?: number | null; minOffer?: number | null };
interface ListingSettings {
  drop_pct: number | null;
  drop_every_days: number | null;
  drop_floor_chf: number | null;
  min_offer_chf: number | null;
}

function settingsFromForm(input: SettingsInput, price: number): ListingSettings | null {
  if (!input.settings) return null;
  const on = Boolean(input.dropOn);
  const floor = input.dropFloor ?? null;
  if (on && floor == null) throw new ActionError({ code: 'BAD_REQUEST', message: 'Ribasso automatico: indica sotto quale prezzo non scendere.' });
  if (on && floor != null && floor >= price) throw new ActionError({ code: 'BAD_REQUEST', message: 'Ribasso automatico: il minimo deve essere sotto il prezzo di adesso.' });
  return {
    drop_pct: on ? (input.dropPct ?? 10) : null,
    drop_every_days: on ? (input.dropDays ?? 14) : null,
    drop_floor_chf: on ? floor : null,
    min_offer_chf: input.minOffer ?? null,
  };
}

/** Salva le impostazioni; se cambia la regola del ribasso, il conto dei giorni riparte da oggi. */
async function saveListingSettings(supabase: NonNullable<App.Locals['supabase']>, userId: string, listingId: string, next: ListingSettings) {
  const { data: current } = await supabase
    .from('listing_settings')
    .select('drop_pct, drop_every_days, drop_floor_chf, min_offer_chf')
    .eq('listing_id', listingId)
    .maybeSingle();
  const num = (v: unknown) => (v == null ? null : Number(v));
  const ruleChanged =
    !current || num(current.drop_pct) !== next.drop_pct || num(current.drop_every_days) !== next.drop_every_days || num(current.drop_floor_chf) !== next.drop_floor_chf;
  if (!current && next.drop_pct == null && next.min_offer_chf == null) return;
  if (current && !ruleChanged && num(current.min_offer_chf) === next.min_offer_chf) return;
  const now = new Date().toISOString();
  const patch = { ...next, ...(ruleChanged ? { drop_from: next.drop_pct != null ? now : null } : {}), updated_at: now };
  const { error } = current
    ? await supabase.from('listing_settings').update(patch).eq('listing_id', listingId)
    : await supabase.from('listing_settings').insert({ listing_id: listingId, seller_id: userId, ...patch });
  if (error) throw new ActionError({ code: 'BAD_REQUEST', message: `Impostazioni non salvate: ${error.message}` });
}

/** Client Supabase con la sessione, oppure un errore chiaro. */
function requireSupabase(context: ActionAPIContext) {
  const supabase = context.locals.supabase;
  if (!supabase) throw new ActionError({ code: 'BAD_REQUEST', message: 'Supabase non è configurato.' });
  return supabase;
}

export function requireUser(context: ActionAPIContext) {
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
      // Indirizzo pubblico (dietro un tunnel la richiesta arriva in http su 127.0.0.1)
      const redirect = new URL('/auth/callback', siteOrigin(context.url.origin));
      redirect.searchParams.set('next', safeNext(next));
      const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect.href } });
      if (error) {
        throw new ActionError({
          code: error.status === 429 ? 'TOO_MANY_REQUESTS' : 'BAD_REQUEST',
          message: error.status === 429 ? 'Troppi tentativi: riprova tra qualche minuto.' : `Non riesco a mandare il link: ${error.message}`,
        });
      }
      return { email, next: safeNext(next) };
    },
  }),

  /**
   * Accesso con il codice a 6 cifre della stessa email del link: si scrive nella pagina, senza cambiare app o browser
   * (Vendi, /accedi). La sessione si scrive nei cookie, come con il link.
   */
  verifyCode: defineAction({
    input: z.object({
      email: z.string().trim().email('Scrivi un indirizzo email valido.'),
      code: z.string().trim().regex(/^\d{6}$/, 'Il codice ha 6 cifre.'),
      next: z.string().nullish(),
    }),
    handler: async ({ email, code, next }, context) => {
      const supabase = requireSupabase(context);
      if (!allow(`codice:${context.clientAddress}`, 20, 10 * 60_000)) {
        throw new ActionError({ code: 'TOO_MANY_REQUESTS', message: 'Troppi tentativi: riprova tra qualche minuto.' });
      }
      const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
      if (error) {
        throw new ActionError({
          code: error.status === 429 ? 'TOO_MANY_REQUESTS' : 'BAD_REQUEST',
          message: error.status === 429 ? 'Troppi tentativi: riprova tra qualche minuto.' : 'Codice sbagliato o scaduto: controlla l\'ultima email o chiedine uno nuovo.',
        });
      }
      await markPasskeyOffer(supabase, context.cookies, context.url.protocol === 'https:');
      return { next: safeNext(next) };
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

  /**
   * Elimina l'account e tutto ciò che gli appartiene: annunci e foto, conversazioni (anche per l'altra persona),
   * domande, valutazioni, salvati, ricerche, avvisi, segnalazioni. Il registro di moderazione resta senza il nome.
   */
  deleteAccount: defineAction({
    accept: 'form',
    input: z.object({ confirm: z.string().trim() }),
    handler: async ({ confirm }, context) => {
      const { supabase, user } = requireUser(context);
      if (confirm.toUpperCase() !== 'ELIMINA') throw new ActionError({ code: 'BAD_REQUEST', message: 'Per confermare scrivi ELIMINA.' });
      const admin = adminClient();
      if (!admin) throw new ActionError({ code: 'BAD_REQUEST', message: "Eliminazione non disponibile: manca la configurazione del server." });

      // Le foto, cartella per cartella (una per annuncio)
      const { data: folders } = await admin.storage.from('foto').list(user.id, { limit: 1000 });
      const paths: string[] = [];
      for (const entry of folders ?? []) {
        const { data: files } = await admin.storage.from('foto').list(`${user.id}/${entry.name}`, { limit: 1000 });
        if (files?.length) paths.push(...files.map((f) => `${user.id}/${entry.name}/${f.name}`));
        else paths.push(`${user.id}/${entry.name}`);
      }
      if (paths.length) await admin.storage.from('foto').remove(paths);

      await supabase.auth.signOut();
      const { error } = await admin.auth.admin.deleteUser(user.id);
      if (error) throw new ActionError({ code: 'BAD_REQUEST', message: `Account non eliminato: ${error.message}` });
      await refreshListings(true);
      await invalidateListingPages(context);
      return { ok: true };
    },
  }),

  /**
   * Email degli avvisi: quando (subito, riassunto della sera, mai) e per cosa (i gruppi accesi).
   * Gli avvisi nel sito restano sempre.
   */
  setEmailNotices: defineAction({
    accept: 'form',
    input: z.object({
      mode: z.enum(EMAIL_MODES as [EmailMode, ...EmailMode[]]),
      group: z.array(z.string()).default([]),
    }),
    handler: async ({ mode, group }, context) => {
      const { supabase, user } = requireUser(context);
      const off = offKindsFromGroups(group);
      const { error } = await supabase.from('profiles').update({ email_mode: mode, email_off: off }).eq('id', user.id);
      if (error) throw new ActionError({ code: 'BAD_REQUEST', message: `Preferenza non salvata: ${error.message}` });
      return { mode, on: EMAIL_GROUPS.filter((g) => group.includes(g.key)).length };
    },
  }),

  /** Da che lato sta la barra dei comandi su telefono: a destra, oppure a sinistra per chi è mancino. */
  setHand: defineAction({
    accept: 'form',
    input: z.object({ hand: z.enum(HANDS) }),
    handler: async ({ hand }, context) => {
      const { supabase, user } = requireUser(context);
      const { error } = await supabase.from('profiles').update({ left_handed: hand === 'sinistra' }).eq('id', user.id);
      if (error) throw new ActionError({ code: 'BAD_REQUEST', message: `Preferenza non salvata: ${error.message}` });
      return { hand };
    },
  }),

  /** Assistente venditore: acceso o spento, e quando di solito si può ritirare. */
  setAssistant: defineAction({
    accept: 'form',
    input: z.object({
      assistant: z.string().nullish(),
      availability: z.array(z.enum(AVAILABILITY_KEYS as [string, ...string[]])).default([]),
    }),
    handler: async ({ assistant, availability }, context) => {
      const { supabase, user } = requireUser(context);
      const on = Boolean(assistant);
      const patch = { assistant_on: on, availability, updated_at: new Date().toISOString() };
      const { data: current } = await supabase.from('seller_settings').select('user_id').eq('user_id', user.id).maybeSingle();
      const { error } = current
        ? await supabase.from('seller_settings').update(patch).eq('user_id', user.id)
        : await supabase.from('seller_settings').insert({ user_id: user.id, ...patch });
      if (error) throw new ActionError({ code: 'BAD_REQUEST', message: `Impostazione non salvata: ${error.message}` });
      return { on, slots: availability.length };
    },
  }),

  /** Scollega un assistente AI (connettore MCP con OAuth): i suoi token smettono subito di valere. */
  disconnectAssistant: defineAction({
    accept: 'form',
    input: z.object({ clientId: z.string().min(1).max(100) }),
    handler: async ({ clientId }, context) => {
      const { user } = requireUser(context);
      await disconnect(user.id, clientId);
      return { clientId };
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
      ...shippingFields,
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

      // Auto, moto e affitti: senza negozio Pro l'annuncio nasce in bozza e si pubblica dopo il pagamento
      const fee = listingFee(input.category);
      const { data: pro } = fee ? await supabase.rpc('is_pro', { p_user: user.id }) : { data: true };
      const mustPay = Boolean(fee && !pro);
      const { data: listing, error } = await supabase
        .from('listings')
        .insert({
          seller_id: user.id,
          status: mustPay ? 'bozza' : 'pubblicato',
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
          ...shippingColumns(input),
        })
        .select('id')
        .single();
      if (error || !listing) throw new ActionError({ code: 'BAD_REQUEST', message: `Non ho pubblicato l'annuncio: ${error?.message}` });

      // Foto nella cartella dell'utente: foto/<utente>/<annuncio>/<n>.jpg, con la miniatura <n>-sm.webp accanto
      const rows: Array<StoredPhoto & { listing_id: string; position: number }> = [];
      for (const [i, file] of files.entries()) {
        const path = `${user.id}/${listing.id}/${i}.${EXTENSION[file.type as ImageMediaType]}`;
        const stored = await storePhoto(supabase, path, file, file.type);
        if (stored.error !== null) {
          await supabase.from('listings').delete().eq('id', listing.id);
          throw new ActionError({ code: 'BAD_REQUEST', message: `Caricamento della foto ${i + 1} non riuscito: ${stored.error}` });
        }
        rows.push({ listing_id: listing.id, position: i, ...stored.photo });
      }
      if (rows.length) {
        const { error: photoError } = await supabase.from('listing_photos').insert(rows);
        if (photoError) throw new ActionError({ code: 'BAD_REQUEST', message: `Annuncio pubblicato, ma le foto non sono state collegate: ${photoError.message}` });
      }

      if (mustPay) {
        const payment = await createPayment({
          userId: user.id,
          kind: 'annuncio',
          amountChf: fee!,
          description: `Pubblicazione per 90 giorni: «${input.title}»`,
          listingId: listing.id,
          returnUrl: `/annuncio/${listing.id}`,
        });
        return { id: listing.id as string, payUrl: payment.url as string | undefined };
      }
      await refreshListings(true);
      await invalidateListingPages(context);
      afterPublish(listing.id, siteOrigin(context.url.origin), () => invalidateListingPages(context));
      return { id: listing.id as string, payUrl: undefined as string | undefined };
    },
  }),

  /** Segna come venduto, rimette in vendita, pubblica una bozza o archivia un proprio annuncio. */
  setListingStatus: defineAction({
    accept: 'form',
    input: z.object({
      id: z.string().min(1),
      status: z.enum(['pubblicato', 'venduto', 'archiviato']),
      soldPrice: z.preprocess((v) => (v === '' ? null : v), z.coerce.number().min(0).max(1_000_000).nullish()),
      /** A chi è stato venduto, tra chi ha scritto: serve per valutarsi a vicenda. */
      buyerId: z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullish()),
      /** Dalla domanda "com'è andato il ritiro?": la conversazione del ritiro si chiude come venduto. */
      pickupConversationId: z.string().uuid().nullish(),
    }),
    handler: async ({ id, status, soldPrice, buyerId, pickupConversationId }, context) => {
      const { supabase, user } = requireUser(context);
      const before = getListing(id);
      // Una bozza (es. preparata da un assistente AI collegato) si pubblica solo con almeno una foto
      const { data: current } = await supabase.from('listings').select('status, listing_photos(count)').eq('id', id).eq('seller_id', user.id).maybeSingle();
      const wasDraft = current?.status === 'bozza';
      if (wasDraft && status === 'pubblicato' && ((current?.listing_photos as unknown as Array<{ count: number }>)?.[0]?.count ?? 0) < MIN_PHOTOS) {
        throw new ActionError({ code: 'BAD_REQUEST', message: "Aggiungi almeno una foto prima di pubblicare: la prima è la copertina dell'annuncio." });
      }
      const patch: Record<string, unknown> = { status };
      if (status === 'venduto') Object.assign(patch, { sold_price_chf: soldPrice ?? null, buyer_id: buyerId ?? null });
      if (status === 'pubblicato') Object.assign(patch, { sold_at: null, sold_price_chf: null });
      const { data, error } = await supabase.from('listings').update(patch).eq('id', id).eq('seller_id', user.id).select('id');
      if (error) throw new ActionError({ code: 'BAD_REQUEST', message: `Non ho aggiornato l'annuncio: ${error.message}` });
      if (!data?.length) throw new ActionError({ code: 'NOT_FOUND', message: 'Annuncio non trovato tra i tuoi.' });
      if (status === 'venduto' && pickupConversationId) await supabase.rpc('set_pickup_outcome', { p_conversation_id: pickupConversationId, p_outcome: 'venduto' });
      await refreshListings(true);
      await invalidateListingPages(context);
      if (status === 'venduto' && before && before.status !== 'venduto') {
        const { data: buyer } = buyerId ? await supabase.from('profiles').select('display_name').eq('id', buyerId).maybeSingle() : { data: null };
        await afterSale(before, buyerId ?? null, buyer?.display_name ?? null, siteOrigin(context.url.origin));
      }
      if (wasDraft && status === 'pubblicato') afterPublish(id, siteOrigin(context.url.origin), () => invalidateListingPages(context));
      return { id, status };
    },
  }),

  /** Rinnova un annuncio in scadenza o scaduto: altri 90 giorni da oggi. */
  renewListing: defineAction({
    accept: 'form',
    input: z.object({ id: z.string().min(1) }),
    handler: async ({ id }, context) => {
      const { supabase, user } = requireUser(context);
      const { data: current } = await supabase.from('listings').select('status').eq('id', id).eq('seller_id', user.id).maybeSingle();
      if (!current) throw new ActionError({ code: 'NOT_FOUND', message: 'Annuncio non trovato tra i tuoi.' });
      if (!['pubblicato', 'in_trattativa', 'scaduto'].includes(current.status)) {
        throw new ActionError({ code: 'BAD_REQUEST', message: 'Si rinnovano solo gli annunci in vendita o scaduti.' });
      }
      const expires = new Date(Date.now() + 90 * 864e5).toISOString();
      const { error } = await supabase
        .from('listings')
        .update({ status: current.status === 'scaduto' ? 'pubblicato' : current.status, expires_at: expires, expiry_notified_at: null })
        .eq('id', id)
        .eq('seller_id', user.id);
      if (error) throw new ActionError({ code: 'BAD_REQUEST', message: `Annuncio non rinnovato: ${error.message}` });
      await refreshListings(true);
      await invalidateListingPages(context);
      return { id, expires };
    },
  }),

  /** Abbassa il prezzo con un tocco (dal consiglio "sei sopra il mercato"): chi ha salvato l'annuncio viene avvisato. */
  lowerPrice: defineAction({
    accept: 'form',
    input: z.object({ id: z.string().min(1), price: z.coerce.number().min(0).max(1_000_000) }),
    handler: async ({ id, price }, context) => {
      const { supabase, user } = requireUser(context);
      const { data: current } = await supabase.from('listings').select('price_chf').eq('id', id).eq('seller_id', user.id).maybeSingle();
      if (!current) throw new ActionError({ code: 'NOT_FOUND', message: 'Annuncio non trovato tra i tuoi.' });
      const old = Number(current.price_chf);
      if (!(price < old)) throw new ActionError({ code: 'BAD_REQUEST', message: 'Il nuovo prezzo deve essere più basso di quello attuale.' });
      const { error } = await supabase.from('listings').update({ price_chf: price }).eq('id', id).eq('seller_id', user.id);
      if (error) throw new ActionError({ code: 'BAD_REQUEST', message: `Prezzo non cambiato: ${error.message}` });
      await refreshListings(true);
      await invalidateListingPages(context);
      const updated = getListing(id);
      if (updated) await afterPriceChange(updated, old, price, siteOrigin(context.url.origin));
      return { id, price, old };
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
      ...shippingFields,
      ...sellerSettingsFields,
    }),
    handler: async (input, context) => {
      const { supabase, user } = requireUser(context);
      const comune = resolveComune(input.comune);
      if (!comune) throw new ActionError({ code: 'BAD_REQUEST', message: `Non conosco il comune "${input.comune}".` });
      // Impostazioni private (ribasso, offerta minima): si controllano prima di toccare l'annuncio
      const settings = settingsFromForm(input, input.price);

      const { data: current, error: readError } = await supabase
        .from('listings')
        .select('id, title, description, price_chf, photos:listing_photos(id, storage_path, small_path, position)')
        .eq('id', input.id)
        .eq('seller_id', user.id)
        .maybeSingle();
      if (readError || !current) throw new ActionError({ code: 'NOT_FOUND', message: 'Annuncio non trovato tra i tuoi.' });

      // Prima si controllano le foto: se qualcosa non va, l'annuncio resta com'era
      const photos = (current.photos ?? []) as Array<{ id: number; storage_path: string; small_path: string | null; position: number }>;
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
          ...shippingColumns(input),
        })
        .eq('id', input.id)
        .eq('seller_id', user.id);
      if (error) throw new ActionError({ code: 'BAD_REQUEST', message: `Modifiche non salvate: ${error.message}` });
      if (settings) await saveListingSettings(supabase, user.id, input.id, settings);

      // Foto nuove nella cartella dell'utente, con la miniatura accanto
      const uploaded = new Map<number, StoredPhoto>();
      for (const slot of plan.slots) {
        if (slot.kind !== 'new') continue;
        const file = files[slot.fileIndex];
        const path = `${user.id}/${input.id}/${Date.now()}-${slot.fileIndex}.${EXTENSION[file.type as ImageMediaType]}`;
        const stored = await storePhoto(supabase, path, file, file.type);
        if (stored.error !== null) throw new ActionError({ code: 'BAD_REQUEST', message: `Caricamento di "${file.name}" non riuscito: ${stored.error}` });
        uploaded.set(slot.fileIndex, stored.photo);
      }

      // Posizioni nell'ordine scelto: la prima è la copertina
      const byPath = new Map(photos.map((p) => [p.storage_path, p]));
      for (const [position, slot] of plan.slots.entries()) {
        const result =
          slot.kind === 'existing'
            ? await supabase.from('listing_photos').update({ position }).eq('id', byPath.get(slot.path)!.id)
            : await supabase.from('listing_photos').insert({ listing_id: input.id, position, ...uploaded.get(slot.fileIndex)! });
        if (result.error) throw new ActionError({ code: 'BAD_REQUEST', message: `Foto non salvate: ${result.error.message}` });
      }

      // Foto tolte: righe e file (solo quelli nella cartella dell'utente)
      const kept = new Set(plan.slots.flatMap((slot) => (slot.kind === 'existing' ? [slot.path] : [])));
      const removed = photos.filter((p) => !kept.has(p.storage_path));
      if (removed.length) {
        await supabase.from('listing_photos').delete().in('id', removed.map((p) => p.id));
        // Anche le miniature
        const own = removed.flatMap((p) => [p.storage_path, p.small_path ?? '']).filter((path) => path.startsWith(`${user.id}/`));
        if (own.length) {
          const { data: gone, error: removeError } = await supabase.storage.from('foto').remove(own);
          if (removeError || (gone?.length ?? 0) < own.length) console.warn(`[piazza] foto non cancellate dallo storage: ${removeError?.message ?? own.join(', ')}`);
        }
      }

      await refreshListings(true);
      await invalidateListingPages(context);
      const updated = getListing(input.id);
      if (updated) await afterPriceChange(updated, Number(current.price_chf), input.price, siteOrigin(context.url.origin));
      if (current.title !== input.title || current.description !== input.description) {
        afterTextChange(input.id, () => invalidateListingPages(context));
      } else if (Number(current.price_chf) !== input.price) {
        afterPriceEdit(input.id);
      }
      // Le foto come sono ora, nell'ordine: chi salva da solo (senza ricaricare) le usa per non rimandarle
      const paths = plan.slots.map((slot) => (slot.kind === 'existing' ? slot.path : uploaded.get(slot.fileIndex)!.storage_path));
      return { id: input.id, photos: paths.map((path) => ({ path, url: photoUrl(path) })) };
    },
  }),
};
