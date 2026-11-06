/**
 * Verifica le regole di sicurezza del database locale con utenti temporanei.
 * Uso: pnpm test:db   (con `supabase start` acceso)
 *
 * Crea venditore, acquirente e intruso, prova ciò che è permesso e ciò che è vietato
 * su annunci, foto, conversazioni, messaggi, offerte e cellulare, poi cancella tutto.
 */
import { execFileSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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
} catch (error) {
  expect('esecuzione', false, (error as Error).message);
} finally {
  for (const id of users) await admin.auth.admin.deleteUser(id);
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.check}${r.ok || !r.detail ? '' : ` — ${r.detail}`}`);
console.log(`\n${results.length - failed.length}/${results.length} controlli superati; utenti temporanei cancellati.`);
process.exit(failed.length ? 1 : 0);
