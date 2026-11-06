/**
 * Verifica l'agente di moderazione senza chiamare Claude: un "modello finto" chiama gli strumenti veri
 * dell'agente in sequenza, sul database locale, con utenti temporanei. Controlla i limiti (sicurezza,
 * una sola decisione, utenti e conversazioni solo alle persone, conversazione privata solo se segnalata),
 * il registro, l'annullamento e la sospensione degli account.
 * Uso: pnpm test:moderazione   (con `supabase start` acceso)
 */
import { execFileSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type Anthropic from '@anthropic-ai/sdk';

const status = JSON.parse(execFileSync('supabase', ['status', '--output', 'json'], { encoding: 'utf8' }));
process.env.PUBLIC_SUPABASE_URL = status.API_URL;
process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY = status.PUBLISHABLE_KEY;
process.env.SUPABASE_SECRET_KEY = status.SECRET_KEY;
delete process.env.SMTP_HOST; // niente email durante la verifica

const { moderateWithAgent } = await import('../src/lib/moderation-agent.ts');
const { applyDecision, undoAction } = await import('../src/lib/moderation.ts');

const admin = createClient(status.API_URL, status.SECRET_KEY, { auth: { persistSession: false } });
const results: Array<{ check: string; ok: boolean; detail?: string }> = [];
const expect = (check: string, ok: boolean, detail?: string) => results.push({ check, ok, detail });
const tag = Math.random().toString(36).slice(2, 8);
const ORIGIN = 'http://localhost:4321';

async function makeUser(name: string): Promise<{ client: SupabaseClient; id: string }> {
  const email = `${name}-${tag}@esempio.test`;
  const password = `Prova-${tag}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: name } });
  if (error || !data.user) throw new Error(`creazione ${name}: ${error?.message}`);
  const client = createClient(status.API_URL, status.PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await client.auth.signInWithPassword({ email, password });
  return { client, id: data.user.id };
}

type Tool = { name: string; run: (input: Record<string, unknown>) => Promise<unknown> };
/** Un "modello" che segue un copione: chiama gli strumenti dell'agente e registra le risposte. */
function scriptedClient(script: (call: (name: string, input?: Record<string, unknown>) => Promise<string>) => Promise<void>) {
  const transcript: Array<{ name: string; output: string }> = [];
  const client = {
    beta: {
      messages: {
        toolRunner: async (params: { tools: Tool[] }) => {
          const tools = new Map(params.tools.map((t) => [t.name, t]));
          const call = async (name: string, input: Record<string, unknown> = {}) => {
            const tool = tools.get(name);
            const output = tool ? String(await tool.run(input)) : `strumento non disponibile: ${name}`;
            transcript.push({ name, output });
            return output;
          };
          await script(call);
          return { content: [{ type: 'text', text: 'Fine del copione.' }], stop_reason: 'end_turn' };
        },
      },
    },
  } as unknown as Anthropic;
  return { client, transcript };
}

const users: string[] = [];
const targets: string[] = [];
try {
  const seller = await makeUser('venditore');
  const reporter = await makeUser('segnalante');
  const buyer = await makeUser('compratore');
  const mod = await makeUser('moderatore');
  users.push(seller.id, reporter.id, buyer.id, mod.id);
  await admin.from('profiles').update({ is_moderator: true }).eq('id', mod.id);

  const listing = async (title: string, description: string) => {
    const { data, error } = await seller.client
      .from('listings')
      .insert({ seller_id: seller.id, status: 'pubblicato', title, description, category_id: 'altro', price_chf: 50, condition: 'buono', comune_id: 'lugano' })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return data.id as string;
  };

  // A. Truffa evidente: l'agente nasconde da solo
  const scam = await listing(`iPhone nuovo ${tag}`, 'Per riservarlo paga in anticipo con questo link: pagamento-sicuro.example');
  await reporter.client.from('reports').insert({ reporter_id: reporter.id, listing_id: scam, reason: 'truffa', note: 'Chiede soldi prima' });
  const tA = `annuncio:${scam}`;
  targets.push(tA);
  const a = scriptedClient(async (call) => {
    await call('leggi_segnalazioni');
    await call('leggi_annuncio', { id: scam });
    await call('leggi_utente', { id: seller.id });
    await call('nascondi', { motivazione: 'La descrizione chiede un pagamento anticipato con un link esterno (regola 2).', messaggio: 'Il tuo annuncio chiede un pagamento anticipato con un link esterno: non è permesso su giro.shop.', sicurezza: 0.95 });
    await call('respingi', { motivazione: 'Prova di una seconda decisione nello stesso esame.', sicurezza: 0.99 });
  });
  const outA = await moderateWithAgent(tA, ORIGIN, { client: a.client });
  const hiddenA = await admin.from('listings').select('hidden_at, hidden_reason').eq('id', scam).single();
  const reportsA = await admin.from('reports').select('status, agent_reviewed_at').eq('target', tA);
  expect("l'agente legge le segnalazioni senza nomi", a.transcript[0].output.includes('persona 1') && !a.transcript[0].output.includes('segnalante'));
  expect("l'agente vede il prezzo rispetto ai simili", a.transcript[1].output.includes('prezzo_rispetto_ai_simili'));
  expect("l'agente nasconde una truffa evidente", 'action' in outA && outA.action === 'nascondi' && Boolean(hiddenA.data?.hidden_at), JSON.stringify(outA));
  expect('una sola decisione per esame', a.transcript[4].output.includes('già preso una decisione'), a.transcript[4].output);
  expect('le segnalazioni risultano accolte ed esaminate', reportsA.data?.every((r) => r.status === 'accolta' && r.agent_reviewed_at) === true);
  const logA = await admin.from('moderation_actions').select('id, actor, action, confidence, message').eq('target', tA).single();
  expect('la decisione è nel registro, con sicurezza e messaggio', logA.data?.actor === 'agente' && logA.data?.action === 'nascondi' && logA.data?.confidence === 0.95 && Boolean(logA.data?.message));
  const peek = await reporter.client.from('moderation_actions').select('id');
  expect('il registro non lo legge nessun utente', Boolean(peek.error) || peek.data?.length === 0);

  // B. Una persona annulla la decisione dell'agente
  await undoAction(admin, logA.data!.id, mod.id, ORIGIN);
  const visibleB = await admin.from('listings').select('hidden_at').eq('id', scam).single();
  const logB = await admin.from('moderation_actions').select('action, undone_at').eq('target', tA).order('created_at');
  expect('annullare rimette visibile il contenuto', visibleB.data?.hidden_at === null);
  expect("l'annullamento resta nel registro", logB.data?.length === 2 && Boolean(logB.data[0].undone_at) && logB.data[1].action === 'annulla');
  let twice = false;
  try {
    await undoAction(admin, logA.data!.id, mod.id, ORIGIN);
  } catch {
    twice = true;
  }
  expect('una decisione si annulla una volta sola', twice);

  // C. Poco sicuro: non decide, passa a una persona
  const doubtful = await listing(`Bici usata ${tag}`, 'Bici da città, qualche graffio.');
  await reporter.client.from('reports').insert({ reporter_id: reporter.id, listing_id: doubtful, reason: 'falso' });
  const tC = `annuncio:${doubtful}`;
  targets.push(tC);
  const c = scriptedClient(async (call) => {
    await call('leggi_annuncio', { id: doubtful });
    await call('nascondi', { motivazione: 'Forse le foto non sono dell\'oggetto, ma non è chiaro.', messaggio: 'Prova di messaggio per chi vende.', sicurezza: 0.6 });
    await call('passa_a_persona', { proposta: 'respingi', motivazione: 'Nessuna prova di descrizione falsa nel contenuto.', sicurezza: 0.6 });
  });
  const outC = await moderateWithAgent(tC, ORIGIN, { client: c.client });
  const reportsC = await admin.from('reports').select('status, agent_reviewed_at').eq('target', tC);
  expect('sotto 0.85 di sicurezza non nasconde', c.transcript[1].output.includes('Sicurezza sotto'), c.transcript[1].output);
  expect('nel dubbio passa a una persona con una proposta', 'action' in outC && outC.action === 'passa' && reportsC.data?.every((r) => r.status === 'aperta' && r.agent_reviewed_at) === true);

  // D. Conversazione privata: la legge solo se è quella segnalata, e non decide
  const { data: conv } = await buyer.client.from('conversations').insert({ listing_id: doubtful, buyer_id: buyer.id, seller_id: seller.id }).select('id').single();
  await seller.client.from('messages').insert({ conversation_id: conv!.id, sender_id: seller.id, body: 'Mandami 50 franchi prima, poi spedisco.' });
  const reportD = await buyer.client.from('reports').insert({ reporter_id: buyer.id, listing_id: doubtful, conversation_id: conv!.id, reported_user_id: seller.id, reason: 'truffa' });
  expect('chi fa parte della conversazione la segnala', !reportD.error, reportD.error?.message);
  const notMine = await reporter.client.from('reports').insert({ reporter_id: reporter.id, listing_id: doubtful, conversation_id: conv!.id, reported_user_id: seller.id, reason: 'truffa' });
  expect('chi non ne fa parte non la segnala', Boolean(notMine.error));
  const tD = `conversazione:${conv!.id}`;
  targets.push(tD);
  const d = scriptedClient(async (call) => {
    await call('leggi_conversazione', { id: '00000000-0000-0000-0000-000000000000' });
    await call('leggi_conversazione', { id: conv!.id });
    await call('respingi', { motivazione: 'Prova: decidere da solo su una conversazione.', sicurezza: 0.99 });
    await call('passa_a_persona', { proposta: 'sospendi', motivazione: 'Chi vende chiede un pagamento anticipato in privato (regola 2).', sicurezza: 0.8 });
  });
  const outD = await moderateWithAgent(tD, ORIGIN, { client: d.client });
  expect("l'agente non legge altre conversazioni", d.transcript[0].output.startsWith('Non autorizzato'));
  expect("l'agente legge la conversazione segnalata", d.transcript[1].output.includes('Mandami 50 franchi prima'));
  expect('su una conversazione non decide da solo', d.transcript[2].output.includes('non decidi tu'));
  expect('propone la sospensione a una persona', 'action' in outD && outD.action === 'passa');

  // E. Una persona sospende, poi annulla
  const { actionId: suspendId } = await applyDecision({ admin, target: tD, decision: 'sospendi', actor: 'persona', moderatorId: mod.id, message: 'Pagamenti anticipati in privato.', origin: ORIGIN });
  const suspended = await admin.from('profiles').select('suspended_at').eq('id', seller.id).single();
  const hiddenE = await admin.from('listings').select('hidden_reason').eq('seller_id', seller.id);
  const blocked = await seller.client.from('listings').insert({ seller_id: seller.id, status: 'pubblicato', title: 'Nuovo annuncio', category_id: 'altro', price_chf: 1, condition: 'buono', comune_id: 'lugano' });
  const blockedMsg = await seller.client.from('messages').insert({ conversation_id: conv!.id, sender_id: seller.id, body: 'Ancora io' });
  expect('sospendere nasconde tutti i suoi annunci', Boolean(suspended.data?.suspended_at) && hiddenE.data?.every((l) => l.hidden_reason === 'utente sospeso') === true);
  expect('un account sospeso non pubblica e non scrive', Boolean(blocked.error) && Boolean(blockedMsg.error), blocked.error?.message);
  expect("nessuno si toglie la sospensione da solo", Boolean((await seller.client.from('profiles').update({ suspended_at: null }).eq('id', seller.id)).error));
  await undoAction(admin, suspendId, mod.id, ORIGIN);
  const back = await admin.from('profiles').select('suspended_at').eq('id', seller.id).single();
  const visibleE = await admin.from('listings').select('hidden_reason').eq('seller_id', seller.id).eq('hidden_reason', 'utente sospeso');
  const canWrite = await seller.client.from('messages').insert({ conversation_id: conv!.id, sender_id: seller.id, body: 'Di nuovo attivo' });
  expect('annullare la sospensione riattiva account e annunci', back.data?.suspended_at === null && visibleE.data?.length === 0 && !canWrite.error, canWrite.error?.message);

  // F. Utente intero: si segnala, non se stessi; senza decisione dell'agente decide una persona
  expect('non si segnala se stessi', Boolean((await reporter.client.from('reports').insert({ reporter_id: reporter.id, reported_user_id: reporter.id, reason: 'spam' })).error));
  const userReport = await reporter.client.from('reports').insert({ reporter_id: reporter.id, reported_user_id: buyer.id, reason: 'spam' }).select('target').single();
  expect('si segnala un utente intero', !userReport.error && userReport.data?.target === `utente:${buyer.id}`, userReport.error?.message);
  const tF = `utente:${buyer.id}`;
  targets.push(tF);
  const f = scriptedClient(async (call) => {
    await call('leggi_utente', { id: buyer.id });
  });
  const outF = await moderateWithAgent(tF, ORIGIN, { client: f.client });
  const logF = await admin.from('moderation_actions').select('action, confidence').eq('target', tF).single();
  expect("senza decisione dell'agente, decide una persona", 'action' in outF && outF.action === 'passa' && logF.data?.confidence === 0);
  expect('le segnalazioni già esaminate non si reinseriscono come nuove', Boolean((await reporter.client.from('reports').insert({ reporter_id: buyer.id, reported_user_id: reporter.id, reason: 'spam', agent_reviewed_at: new Date().toISOString() })).error));

  // G. Contestazioni: solo chi è coinvolto, una volta, e decide una persona
  const contested = await listing(`Orologio ${tag}`, 'Orologio da polso, funzionante.');
  await reporter.client.from('reports').insert({ reporter_id: reporter.id, listing_id: contested, reason: 'falso' });
  const tG = `annuncio:${contested}`;
  targets.push(tG);
  const { actionId: hideG } = await applyDecision({ admin, target: tG, decision: 'nascondi', actor: 'agente', reason: 'Prova', confidence: 0.9, origin: ORIGIN });
  const mine = await seller.client.rpc('my_moderation_actions');
  const theirs = await reporter.client.rpc('my_moderation_actions');
  expect('chi pubblica vede le decisioni che lo riguardano', (mine.data as Array<{ id: string }> | null)?.some((d) => d.id === hideG) === true);
  expect('gli altri non le vedono', !(theirs.data as Array<{ id: string }> | null)?.some((d) => d.id === hideG));
  expect('si contesta solo una decisione che ci riguarda', Boolean((await reporter.client.from('appeals').insert({ action_id: hideG, user_id: reporter.id, message: 'Non mi riguarda ma contesto' })).error));
  expect('una contestazione non nasce già accolta', Boolean((await seller.client.from('appeals').insert({ action_id: hideG, user_id: seller.id, message: 'Lo scrivo io che è accolta', status: 'accolta' })).error));
  const appeal = await seller.client.from('appeals').insert({ action_id: hideG, user_id: seller.id, message: "L'orologio è mio, ho lo scontrino." }).select('id').single();
  expect('chi è coinvolto contesta la decisione', !appeal.error, appeal.error?.message);
  expect('una contestazione per decisione', Boolean((await seller.client.from('appeals').insert({ action_id: hideG, user_id: seller.id, message: 'Seconda contestazione' })).error));
  expect('le contestazioni degli altri non si leggono', (await reporter.client.from('appeals').select('id').eq('id', appeal.data?.id ?? '')).data?.length === 0);
  await undoAction(admin, hideG, mod.id, ORIGIN);
  const notAgain = await seller.client.rpc('can_appeal', { p_action: hideG });
  expect('una decisione annullata non si contesta più', notAgain.data === false);
} catch (error) {
  expect('esecuzione', false, (error as Error).stack ?? String(error));
} finally {
  if (targets.length) await admin.from('moderation_actions').delete().in('target', targets);
  for (const id of users) await admin.auth.admin.deleteUser(id);
}

for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.check}${!r.ok && r.detail ? `\n    ${r.detail}` : ''}`);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} controlli superati; utenti temporanei cancellati.`);
process.exit(failed.length ? 1 : 0);
