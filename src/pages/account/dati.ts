/**
 * "Scarica i tuoi dati": un file JSON con tutto quello che giro.shop tiene sulla persona collegata
 * (diritto di accesso e portabilità, nLPD). Si legge con le regole RLS della persona stessa.
 * GET /account/dati
 */
import type { APIRoute } from 'astro';
import { photoUrl } from '../../core/store.ts';
import { connectionsOf } from '../../lib/oauth.ts';

export const GET: APIRoute = async ({ locals, redirect }) => {
  const { user, supabase } = locals;
  if (!user || !supabase) return redirect('/accedi?next=/miei-annunci');

  const [{ data: auth }, { data: profile }, { data: listings }, { data: conversations }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from('profiles').select('display_name, created_at, phone_verified_at, email_mode, email_off, suspended_at, suspended_reason').eq('id', user.id).maybeSingle(),
    supabase
      .from('listings')
      .select('id, status, title, description, category_id, condition, price_chf, negotiable, shipping, shipping_chf, comune_id, tags, attributes, created_at, published_at, expires_at, sold_at, sold_price_chf, photos:listing_photos(storage_path, position), history:price_history(price_chf, changed_at)')
      .eq('seller_id', user.id)
      .order('created_at'),
    supabase.from('conversations').select('id, listing_id, buyer_id, seller_id, created_at').or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`),
  ]);
  const convIds = (conversations ?? []).map((c) => c.id as string);
  const listingIds = (listings ?? []).map((l) => l.id as string);
  const [{ data: messages }, { data: asked }, { data: answered }, { data: given }, { data: received }, { data: favorites }, { data: searches }, { data: notices }, { data: reports }, { data: appeals }, { data: decisions }] =
    await Promise.all([
      convIds.length ? supabase.from('messages').select('conversation_id, sender_id, kind, body, offer_chf, offer_status, created_at').in('conversation_id', convIds).order('created_at') : { data: [] },
      supabase.from('questions').select('listing_id, body, answer, created_at, answered_at').eq('asker_id', user.id),
      listingIds.length ? supabase.from('questions').select('listing_id, body, answer, created_at, answered_at').in('listing_id', listingIds) : { data: [] },
      supabase.from('ratings').select('listing_id, stars, tags, comment, created_at').eq('rater_id', user.id),
      supabase.from('ratings').select('listing_id, stars, tags, comment, created_at').eq('rated_id', user.id),
      supabase.from('favorites').select('listing_id, created_at').eq('user_id', user.id),
      supabase.from('alerts').select('query, created_at, last_notified_at').eq('user_id', user.id),
      supabase.from('notifications').select('kind, title, body, url, created_at, read_at').eq('user_id', user.id).order('created_at'),
      supabase.from('reports').select('target, reason, note, status, created_at').eq('reporter_id', user.id),
      supabase.from('appeals').select('message, status, reply, created_at, decided_at').eq('user_id', user.id),
      supabase.rpc('my_moderation_actions'),
    ]);

  const assistants = await connectionsOf(user.id);

  const data = {
    informazioni: 'Tutti i dati che giro.shop tiene sul tuo account, scaricati il ' + new Date().toLocaleString('it-CH') + '. Vedi /privacy.',
    account: {
      email: auth.user?.email ?? null,
      cellulare: auth.user?.phone ? `+${auth.user.phone}` : null,
      creato: auth.user?.created_at ?? null,
      ultimo_accesso: auth.user?.last_sign_in_at ?? null,
      ...profile,
    },
    annunci: (listings ?? []).map((l) => ({
      ...l,
      photos: undefined,
      foto: [...((l.photos as Array<{ storage_path: string; position: number }>) ?? [])].sort((a, b) => a.position - b.position).map((p) => photoUrl(p.storage_path)),
    })),
    // Nelle conversazioni ci sono anche i messaggi dell'altra persona: sono la tua corrispondenza
    conversazioni: (conversations ?? []).map((c) => ({
      annuncio: c.listing_id,
      ruolo: c.buyer_id === user.id ? 'compri' : 'vendi',
      iniziata: c.created_at,
      messaggi: (messages ?? [])
        .filter((m) => m.conversation_id === c.id)
        .map((m) => ({ da: m.sender_id === user.id ? 'tu' : "l'altra persona", tipo: m.kind, testo: m.body, offerta_chf: m.offer_chf, stato_offerta: m.offer_status, quando: m.created_at })),
    })),
    domande_fatte: asked ?? [],
    domande_sui_tuoi_annunci: answered ?? [],
    valutazioni_date: given ?? [],
    valutazioni_ricevute: received ?? [],
    annunci_salvati: favorites ?? [],
    ricerche_salvate: searches ?? [],
    avvisi: notices ?? [],
    segnalazioni_fatte: reports ?? [],
    decisioni_di_moderazione_su_di_te: decisions ?? [],
    contestazioni: appeals ?? [],
    // Dei token si tiene solo l'impronta: qui c'è chi è collegato, con quali permessi, da quando
    assistenti_collegati: assistants.map((a) => ({ nome: a.name, permessi: a.scopes, collegato: a.since, ultimo_uso: a.lastUsed })),
    nel_browser: 'Ricerche recenti, confronto e comune per le distanze stanno solo nel tuo browser (localStorage): non li riceviamo.',
  };

  const day = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="giro-shop-dati-${day}.json"`,
      'Cache-Control': 'private, no-store',
    },
  });
};
