/**
 * Verifica le regole di sicurezza del database locale con utenti temporanei.
 * Uso: pnpm test:db   (con `supabase start` acceso)
 *
 * Crea venditore, acquirente e intruso, prova ciò che è permesso e ciò che è vietato
 * su annunci, foto, conversazioni, messaggi, offerte, cellulare, salvati, avvisi, domande,
 * voti, preferenze email, valutazioni, scadenza, segnalazioni e moderazione, poi cancella tutto.
 */
import { execFileSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { LISTING_SELECT } from '../src/core/store.ts';

const status = JSON.parse(execFileSync('supabase', ['status', '--output', 'json'], { encoding: 'utf8' }));
const URL: string = status.API_URL;
const PUBLISHABLE: string = status.PUBLISHABLE_KEY;
const admin = createClient(URL, status.SECRET_KEY, { auth: { persistSession: false } });

const results: Array<{ check: string; ok: boolean; detail?: string }> = [];
const expect = (check: string, ok: boolean, detail?: string) => results.push({ check, ok, detail });
const tag = Math.random().toString(36).slice(2, 8);

async function makeUser(name: string): Promise<{ client: SupabaseClient; id: string; email: string }> {
  const email = `${name}-${tag}@esempio.test`;
  const password = `Prova-${tag}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: name } });
  if (error || !data.user) throw new Error(`creazione ${name}: ${error?.message}`);
  const client = createClient(URL, PUBLISHABLE, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw new Error(`accesso ${name}: ${e.message}`);
  return { client, id: data.user.id, email };
}

const denied = (r: { error: unknown; data: unknown[] | null }) => Boolean(r.error) || (r.data?.length ?? 0) === 0;

const users: string[] = [];
try {
  const seller = await makeUser('venditore');
  const buyer = await makeUser('acquirente');
  const intruder = await makeUser('intruso');
  users.push(seller.id, buyer.id, intruder.id);
  const anon = createClient(URL, PUBLISHABLE, { auth: { persistSession: false } });

  // La copia degli annunci usata da ricerca e schede: se una relazione diventa ambigua, il sito ripiega sui dati di prova
  const snapshot = await anon.from('listings').select(LISTING_SELECT).limit(1);
  expect('la copia degli annunci si legge dal database', !snapshot.error, snapshot.error?.message);

  // Annunci
  const { data: listing, error: le } = await seller.client
    .from('listings')
    .insert({ seller_id: seller.id, status: 'pubblicato', title: `Prova sicurezza ${tag}`, category_id: 'altro', price_chf: 100, condition: 'buono', comune_id: 'lugano' })
    .select('id, published_at, expires_at')
    .single();
  expect('chi vende pubblica', !le && Boolean(listing?.published_at && listing?.expires_at), le?.message);
  const listingId = listing!.id as string;

  expect('anonimo non modifica annunci', denied(await anon.from('listings').update({ price_chf: 1 }).eq('id', listingId).select('id')));
  expect('intruso non modifica annunci altrui', denied(await intruder.client.from('listings').update({ price_chf: 1 }).eq('id', listingId).select('id')));
  expect('intruso non cancella annunci altrui', denied(await intruder.client.from('listings').delete().eq('id', listingId).select('id')));
  expect(
    'intruso non pubblica a nome di altri',
    Boolean(
      (await intruder.client.from('listings').insert({ seller_id: seller.id, title: 'finto', category_id: 'altro', price_chf: 1, condition: 'buono', comune_id: 'lugano' }).select('id')).error,
    ),
  );
  const upload = await intruder.client.storage.from('foto').upload(`${seller.id}/${listingId}/x.jpg`, new Blob(['x'], { type: 'image/jpeg' }), { contentType: 'image/jpeg' });
  expect('intruso non carica foto nella cartella altrui', Boolean(upload.error));

  // Cancellazione dei file: il proprietario ci riesce, l'intruso no
  const ownPath = `${seller.id}/${listingId}/prova.jpg`;
  const own = await seller.client.storage.from('foto').upload(ownPath, new Blob(['x'], { type: 'image/jpeg' }), { contentType: 'image/jpeg' });
  const exists = async () => ((await admin.storage.from('foto').list(`${seller.id}/${listingId}`)).data ?? []).some((f) => f.name === 'prova.jpg');
  await intruder.client.storage.from('foto').remove([ownPath]);
  expect('intruso non cancella foto altrui', !own.error && (await exists()));
  const removed = await seller.client.storage.from('foto').remove([ownPath]);
  expect('chi vende cancella le proprie foto', !removed.error && !(await exists()), removed.error?.message);

  const { data: edited, error: ee } = await seller.client.from('listings').update({ title: `Prova modificata ${tag}`, price_chf: 90 }).eq('id', listingId).select('updated_at');
  expect('chi vende modifica il proprio annuncio', !ee && Boolean(edited?.[0]?.updated_at), ee?.message);

  // Conversazioni
  const fake = await intruder.client.from('conversations').insert({ listing_id: listingId, buyer_id: buyer.id, seller_id: seller.id }).select('id');
  expect('nessuno apre conversazioni a nome di altri', Boolean(fake.error));
  const wrongSeller = await buyer.client.from('conversations').insert({ listing_id: listingId, buyer_id: buyer.id, seller_id: intruder.id }).select('id');
  expect('la conversazione va al vero venditore', Boolean(wrongSeller.error));
  const self = await seller.client.from('conversations').insert({ listing_id: listingId, buyer_id: seller.id, seller_id: seller.id }).select('id');
  expect('chi vende non scrive a se stesso', Boolean(self.error));

  const { data: conv, error: ce } = await buyer.client.from('conversations').insert({ listing_id: listingId, buyer_id: buyer.id, seller_id: seller.id }).select('id').single();
  expect('chi compra apre la conversazione', !ce && Boolean(conv?.id), ce?.message);
  const convId = conv!.id as string;

  // Messaggi
  const text = await buyer.client.from('messages').insert({ conversation_id: convId, sender_id: buyer.id, body: 'Ciao, è disponibile?' }).select('id').single();
  expect('chi compra scrive', !text.error, text.error?.message);
  expect('intruso non legge la conversazione', (await intruder.client.from('messages').select('id').eq('conversation_id', convId)).data?.length === 0);
  expect(
    'intruso non scrive nella conversazione',
    Boolean((await intruder.client.from('messages').insert({ conversation_id: convId, sender_id: intruder.id, body: 'spam' }).select('id')).error),
  );
  expect(
    'nessuno scrive a nome di altri',
    Boolean((await seller.client.from('messages').insert({ conversation_id: convId, sender_id: buyer.id, body: 'finto' }).select('id')).error),
  );
  expect(
    'nessuno crea note di sistema',
    Boolean((await buyer.client.from('messages').insert({ conversation_id: convId, sender_id: buyer.id, kind: 'sistema', body: 'Offerta accettata.' }).select('id')).error),
  );
  expect('chi scrive non cambia il testo inviato', denied(await buyer.client.from('messages').update({ body: 'cambiato' }).eq('id', text.data!.id).select('id')));
  expect('chi riceve segna come letto', !denied(await seller.client.from('messages').update({ read_at: new Date().toISOString() }).eq('id', text.data!.id).select('id')));

  // Offerte
  const offer = await buyer.client.from('messages').insert({ conversation_id: convId, sender_id: buyer.id, kind: 'offerta', offer_chf: 70, offer_status: 'in_attesa' }).select('id').single();
  expect('chi compra fa un\'offerta', !offer.error, offer.error?.message);
  const accepted = await buyer.client.from('messages').insert({ conversation_id: convId, sender_id: buyer.id, kind: 'offerta', offer_chf: 70, offer_status: 'accettata' }).select('id');
  expect('un\'offerta non nasce già accettata', Boolean(accepted.error));
  expect('chi offre non accetta la propria offerta', Boolean((await buyer.client.rpc('respond_to_offer', { p_message_id: offer.data!.id, p_decision: 'accettata' })).error));
  expect('intruso non risponde alle offerte', Boolean((await intruder.client.rpc('respond_to_offer', { p_message_id: offer.data!.id, p_decision: 'accettata' })).error));

  const counter = await seller.client.from('messages').insert({ conversation_id: convId, sender_id: seller.id, kind: 'offerta', offer_chf: 85, offer_status: 'in_attesa' }).select('id').single();
  const first = await buyer.client.from('messages').select('offer_status').eq('id', offer.data!.id).single();
  expect('una controfferta chiude l\'offerta precedente', !counter.error && first.data?.offer_status === 'rifiutata', counter.error?.message);

  const accept = await buyer.client.rpc('respond_to_offer', { p_message_id: counter.data!.id, p_decision: 'accettata' });
  const after = await admin.from('listings').select('status').eq('id', listingId).single();
  expect('chi riceve accetta e l\'annuncio va in trattativa', !accept.error && after.data?.status === 'in_trattativa', accept.error?.message);
  const again = await buyer.client.rpc('respond_to_offer', { p_message_id: counter.data!.id, p_decision: 'rifiutata' });
  expect('un\'offerta già decisa non cambia', Boolean(again.error));

  // Cellulare: numeri di prova con codice fisso, da supabase/config.toml
  const TEST_PHONES: Record<string, string> = { '+41791234567': '123456', '+41787654321': '654321', '+41761112233': '111222' };
  const { data: allUsers } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const taken = new Set((allUsers?.users ?? []).map((u) => (u.phone ? `+${u.phone}` : '')).filter(Boolean));
  const free = Object.keys(TEST_PHONES).filter((p) => !taken.has(p));
  if (free.length < 2) throw new Error('servono due cellulari di prova liberi: esegui `supabase db reset`');

  const [phone, other] = free;
  const change = await buyer.client.auth.updateUser({ phone });
  const verify = change.error ? null : await buyer.client.auth.verifyOtp({ phone, token: TEST_PHONES[phone], type: 'phone_change' });
  const profile = await admin.from('profiles').select('phone_verified_at').eq('id', buyer.id).single();
  expect('il cellulare si verifica con il codice', !change.error && !verify?.error && Boolean(profile.data?.phone_verified_at), change.error?.message ?? verify?.error?.message);

  const wrong = await intruder.client.auth.updateUser({ phone: other });
  const wrongVerify = wrong.error ? null : await intruder.client.auth.verifyOtp({ phone: other, token: '000000', type: 'phone_change' });
  const intruderProfile = await admin.from('profiles').select('phone_verified_at').eq('id', intruder.id).single();
  expect('un codice sbagliato non verifica', Boolean(wrongVerify?.error) && !intruderProfile.data?.phone_verified_at, wrong.error?.message);

  const stolen = await seller.client.auth.updateUser({ phone });
  expect('un cellulare già verificato da altri viene rifiutato', Boolean(stolen.error));

  // Storico prezzi, salvati, avvisi, domande pubbliche, vendita e valutazioni
  const { data: second } = await seller.client
    .from('listings')
    .insert({ seller_id: seller.id, status: 'pubblicato', title: `Prova domande ${tag}`, category_id: 'altro', price_chf: 80, condition: 'buono', comune_id: 'lugano' })
    .select('id')
    .single();
  const qListing = second!.id as string;
  await seller.client.from('listings').update({ price_chf: 60 }).eq('id', qListing);
  const hist = await anon.from('price_history').select('price_chf').eq('listing_id', qListing).order('changed_at');
  expect('lo storico registra pubblicazione e ribasso', hist.data?.map((h) => Number(h.price_chf)).join(',') === '80,60', JSON.stringify(hist.data));

  expect('ognuno salva per sé', !(await buyer.client.from('favorites').insert({ user_id: buyer.id, listing_id: qListing })).error);
  expect('nessuno salva a nome di altri', Boolean((await intruder.client.from('favorites').insert({ user_id: buyer.id, listing_id: listingId })).error));
  expect('i salvati degli altri non si vedono', (await intruder.client.from('favorites').select('user_id').eq('user_id', buyer.id)).data?.length === 0);
  expect('il conteggio dei salvati è pubblico, senza nomi', Number((await anon.rpc('favorite_count', { listing: qListing })).data) === 1);

  const note = await admin.from('notifications').insert({ user_id: buyer.id, kind: 'prezzo', title: 'Prova', url: '/' }).select('id').single();
  expect('gli avvisi li scrive solo il server', Boolean((await buyer.client.from('notifications').insert({ user_id: buyer.id, kind: 'prezzo', title: 'finto', url: '/' })).error));
  expect('gli avvisi degli altri non si vedono', (await intruder.client.from('notifications').select('id').eq('id', note.data!.id)).data?.length === 0);
  expect("chi riceve segna l'avviso come letto", !denied(await buyer.client.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', note.data!.id).select('id')));
  expect("il testo dell'avviso non si cambia", Boolean((await buyer.client.from('notifications').update({ title: 'cambiato' }).eq('id', note.data!.id)).error));

  const q = await buyer.client.from('questions').insert({ listing_id: qListing, asker_id: buyer.id, body: 'Funziona ancora?' }).select('id').single();
  expect('chi compra fa una domanda pubblica', !q.error, q.error?.message);
  expect('chi vende non si fa domande da solo', Boolean((await seller.client.from('questions').insert({ listing_id: qListing, asker_id: seller.id, body: 'Domanda finta' })).error));
  expect('una domanda non nasce con la risposta', Boolean((await buyer.client.from('questions').insert({ listing_id: qListing, asker_id: buyer.id, body: 'Altra?', answer: 'sì' })).error));
  expect('chi chiede non si risponde da solo', denied(await buyer.client.from('questions').update({ answer: 'sì' }).eq('id', q.data!.id).select('id')));
  expect('intruso non risponde alle domande', denied(await intruder.client.from('questions').update({ answer: 'sì' }).eq('id', q.data!.id).select('id')));
  expect('chi vende risponde', !denied(await seller.client.from('questions').update({ answer: 'Sì, funziona.', answered_at: new Date().toISOString() }).eq('id', q.data!.id).select('id')));
  expect('domande e risposte le vedono tutti', (await anon.from('questions').select('answer').eq('id', q.data!.id)).data?.[0]?.answer === 'Sì, funziona.');

  // Voto "utile": uno a testa, non sulla propria domanda; il conteggio è pubblico, i nomi no
  expect('chi chiede non vota la propria domanda', Boolean((await buyer.client.from('question_votes').insert({ question_id: q.data!.id, user_id: buyer.id })).error));
  expect('nessuno vota a nome di altri', Boolean((await intruder.client.from('question_votes').insert({ question_id: q.data!.id, user_id: seller.id })).error));
  expect('si vota una risposta utile', !(await intruder.client.from('question_votes').insert({ question_id: q.data!.id, user_id: intruder.id })).error);
  expect('un solo voto a testa', Boolean((await intruder.client.from('question_votes').insert({ question_id: q.data!.id, user_id: intruder.id })).error));
  expect('il conteggio dei voti è pubblico', (await anon.from('questions').select('helpful').eq('id', q.data!.id)).data?.[0]?.helpful === 1);
  expect('chi ha votato resta privato', denied(await anon.from('question_votes').select('user_id').eq('question_id', q.data!.id)) && denied(await seller.client.from('question_votes').select('user_id').eq('question_id', q.data!.id)));
  expect('il conteggio non si scrive a mano', Boolean((await seller.client.from('questions').update({ helpful: 99 }).eq('id', q.data!.id)).error));
  await intruder.client.from('question_votes').delete().eq('question_id', q.data!.id).eq('user_id', intruder.id);
  expect('togliere il voto abbassa il conteggio', (await anon.from('questions').select('helpful').eq('id', q.data!.id)).data?.[0]?.helpful === 0);

  // Email degli avvisi: ognuno spegne le proprie
  expect('ognuno spegne le proprie email', !denied(await buyer.client.from('profiles').update({ notify_email: false }).eq('id', buyer.id).select('id')));
  expect('nessuno spegne le email di altri', denied(await intruder.client.from('profiles').update({ notify_email: false }).eq('id', seller.id).select('id')));

  expect('non si vende a chi non ha mai scritto', Boolean((await seller.client.from('listings').update({ status: 'venduto', buyer_id: intruder.id }).eq('id', listingId)).error));
  expect('si vende a chi ha scritto', !(await seller.client.from('listings').update({ status: 'venduto', buyer_id: buyer.id }).eq('id', listingId)).error);
  expect('chi compra valuta chi vende', !(await buyer.client.from('ratings').insert({ listing_id: listingId, rater_id: buyer.id, rated_id: seller.id, stars: 5, tags: ['puntuale'] })).error);
  expect('una sola valutazione per vendita', Boolean((await buyer.client.from('ratings').insert({ listing_id: listingId, rater_id: buyer.id, rated_id: seller.id, stars: 1 })).error));
  expect('intruso non valuta', Boolean((await intruder.client.from('ratings').insert({ listing_id: listingId, rater_id: intruder.id, rated_id: seller.id, stars: 1 })).error));
  expect('niente etichette inventate nelle valutazioni', Boolean((await seller.client.from('ratings').insert({ listing_id: listingId, rater_id: seller.id, rated_id: buyer.id, stars: 4, tags: ['truffatore'] })).error));
  // Scadenza: non si sposta oltre 90 giorni, e tornando in vendita riparte
  const far = new Date(Date.now() + 400 * 864e5).toISOString();
  await seller.client.from('listings').update({ expires_at: far }).eq('id', qListing);
  const clamped = await seller.client.from('listings').select('expires_at').eq('id', qListing).single();
  expect('la scadenza non va oltre 90 giorni', new Date(clamped.data!.expires_at).getTime() < Date.now() + 91 * 864e5, clamped.data?.expires_at);
  await admin.from('listings').update({ status: 'scaduto', expires_at: new Date(Date.now() - 864e5).toISOString() }).eq('id', qListing);
  expect('un annuncio scaduto non lo vede nessuno', denied(await anon.from('listings').select('id').eq('id', qListing)));
  expect('chi vende vede il proprio annuncio scaduto', !denied(await seller.client.from('listings').select('id').eq('id', qListing)));
  await seller.client.from('listings').update({ status: 'pubblicato' }).eq('id', qListing);
  const renewed = await seller.client.from('listings').select('expires_at').eq('id', qListing).single();
  expect('tornando in vendita la scadenza riparte da 90 giorni', new Date(renewed.data!.expires_at).getTime() > Date.now() + 89 * 864e5, renewed.data?.expires_at);

  // Moderazione: nessuno si nomina da solo, chi vende non toglie il "nascosto"
  expect('nessuno si nomina moderatore', Boolean((await intruder.client.from('profiles').update({ is_moderator: true }).eq('id', intruder.id)).error));
  await admin.from('listings').update({ hidden_at: new Date().toISOString(), hidden_reason: 'prova' }).eq('id', qListing);
  expect('un annuncio nascosto non lo vede nessuno', denied(await anon.from('listings').select('id').eq('id', qListing)));
  await seller.client.from('listings').update({ hidden_at: null, title: `Prova domande ${tag} bis` }).eq('id', qListing);
  const still = await admin.from('listings').select('hidden_at, title').eq('id', qListing).single();
  expect('chi vende non toglie il "nascosto"', Boolean(still.data?.hidden_at) && still.data?.title.endsWith('bis') === true, JSON.stringify(still.data));
  await admin.from('listings').update({ hidden_at: null, hidden_reason: null }).eq('id', qListing);

  // Segnalazioni
  const witness = await makeUser('testimone');
  users.push(witness.id);
  const report = (who: SupabaseClient, id: string, extra: Record<string, unknown> = {}) =>
    who.from('reports').insert({ reporter_id: id, listing_id: qListing, reason: 'truffa', ...extra });
  expect('anonimo non segnala', Boolean((await anon.from('reports').insert({ reporter_id: buyer.id, listing_id: qListing, reason: 'truffa' })).error));
  expect('chi vende non segnala il proprio annuncio', Boolean((await report(seller.client, seller.id)).error));
  expect('nessuno segnala a nome di altri', Boolean((await report(intruder.client, buyer.id)).error));
  expect('chi compra segnala un annuncio', !(await report(buyer.client, buyer.id)).error);
  expect('una segnalazione a testa per contenuto', Boolean((await report(buyer.client, buyer.id, { reason: 'spam' })).error));
  expect('le segnalazioni degli altri non si vedono', (await intruder.client.from('reports').select('id').eq('reporter_id', buyer.id)).data?.length === 0);
  expect('due segnalazioni non bastano a nascondere', !denied(await anon.from('listings').select('id').eq('id', qListing)) && !(await report(intruder.client, intruder.id)).error);
  expect('alla terza persona l\'annuncio si nasconde', !(await report(witness.client, witness.id)).error && denied(await anon.from('listings').select('id').eq('id', qListing)));
  await admin.from('listings').update({ hidden_at: null, hidden_reason: null }).eq('id', qListing);
  expect('si segnala una domanda', !(await report(intruder.client, intruder.id, { question_id: q.data!.id, reason: 'offensivo' })).error);
  expect('alla seconda persona la domanda si nasconde', !(await report(witness.client, witness.id, { question_id: q.data!.id, reason: 'offensivo' })).error && denied(await anon.from('questions').select('id').eq('id', q.data!.id)));

  const stats = await anon.rpc('seller_stats', { seller: seller.id });
  const st = (stats.data as Array<{ rating_count: number; sold: number }> | null)?.[0];
  expect('affidabilità di chi vende visibile a tutti', st?.rating_count === 1 && st?.sold === 1, JSON.stringify(stats.data ?? stats.error));
} catch (error) {
  expect('esecuzione', false, (error as Error).message);
} finally {
  for (const id of users) await admin.auth.admin.deleteUser(id);
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.check}${r.ok || !r.detail ? '' : ` — ${r.detail}`}`);
console.log(`\n${results.length - failed.length}/${results.length} controlli superati; utenti temporanei cancellati.`);
process.exit(failed.length ? 1 : 0);
