import type { SupabaseClient } from '@supabase/supabase-js';
import { refreshListings } from '../core/store.ts';
import { notify, type Notice } from './notify.ts';

/**
 * Decisioni di moderazione, uguali per l'agente e per le persone:
 * nascondi (annunci, domande, valutazioni), sospendi (utenti, anche da una conversazione),
 * respingi, passa a una persona (solo l'agente) e annulla (solo le persone).
 * Ogni decisione finisce nel registro moderation_actions, con chi l'ha presa e perché.
 */

export type TargetKind = 'annuncio' | 'domanda' | 'valutazione' | 'utente' | 'conversazione';
export type Decision = 'nascondi' | 'respingi' | 'sospendi';
export type Actor = 'agente' | 'persona';

const TARGET = /^(annuncio|domanda|valutazione|utente|conversazione):(.+)$/;

export function parseTarget(target: string): { kind: TargetKind; id: string } | null {
  const m = target.match(TARGET);
  return m ? { kind: m[1] as TargetKind, id: m[2] } : null;
}

/** Cosa si può decidere per ogni tipo di contenuto. */
export function allowedDecisions(kind: TargetKind): Decision[] {
  return kind === 'utente' || kind === 'conversazione' ? ['sospendi', 'respingi'] : ['nascondi', 'respingi'];
}

export class ModerationError extends Error {}

export interface TargetInfo {
  kind: TargetKind;
  id: string;
  listingId: string | null;
  listingTitle: string | null;
  /** Chi ha pubblicato il contenuto, o l'utente segnalato. */
  userId: string | null;
  userName: string | null;
}

/** Di chi è il contenuto segnalato e a quale annuncio appartiene. */
export async function describeTarget(admin: SupabaseClient, target: string): Promise<TargetInfo> {
  const parsed = parseTarget(target);
  if (!parsed) throw new ModerationError(`Contenuto non valido: ${target}`);
  const { kind, id } = parsed;
  let listingId: string | null = null;
  let userId: string | null = null;
  if (kind === 'annuncio') {
    listingId = id;
  } else if (kind === 'domanda') {
    const { data } = await admin.from('questions').select('listing_id, asker_id').eq('id', id).maybeSingle();
    listingId = data?.listing_id ?? null;
    userId = data?.asker_id ?? null;
  } else if (kind === 'valutazione') {
    const { data } = await admin.from('ratings').select('listing_id, rater_id').eq('id', id).maybeSingle();
    listingId = data?.listing_id ?? null;
    userId = data?.rater_id ?? null;
  } else if (kind === 'utente') {
    userId = id;
  } else {
    const { data } = await admin.from('reports').select('listing_id, reported_user_id').eq('conversation_id', id).limit(1).maybeSingle();
    listingId = data?.listing_id ?? null;
    userId = data?.reported_user_id ?? null;
  }
  const { data: listing } = listingId
    ? await admin.from('listings').select('title, seller_id').eq('id', listingId).maybeSingle()
    : { data: null };
  if (kind === 'annuncio') userId = listing?.seller_id ?? null;
  const { data: profile } = userId ? await admin.from('profiles').select('display_name').eq('id', userId).maybeSingle() : { data: null };
  return { kind, id, listingId, listingTitle: listing?.title ?? null, userId, userName: profile?.display_name ?? null };
}

const whatOf = (t: TargetInfo) =>
  t.kind === 'annuncio'
    ? `l'annuncio «${t.listingTitle}»`
    : t.kind === 'domanda'
      ? `la domanda su «${t.listingTitle}»`
      : t.kind === 'valutazione'
        ? `la valutazione su «${t.listingTitle}»`
        : t.kind === 'conversazione'
          ? `la conversazione su «${t.listingTitle}»`
          : `l'utente ${t.userName ?? ''}`.trim();

export interface DecisionInput {
  admin: SupabaseClient;
  target: string;
  decision: Decision;
  actor: Actor;
  moderatorId?: string | null;
  /** Motivazione interna, la leggono solo le persone che moderano. */
  reason?: string | null;
  /** Messaggio per chi ha pubblicato o per l'utente sospeso. */
  message?: string | null;
  confidence?: number | null;
  model?: string | null;
  origin: string;
}

/** Applica una decisione su un contenuto con segnalazioni aperte. */
export async function applyDecision(input: DecisionInput): Promise<{ actionId: string; info: TargetInfo }> {
  const { admin, target, decision, actor } = input;
  const info = await describeTarget(admin, input.target);
  if (!allowedDecisions(info.kind).includes(decision)) {
    throw new ModerationError(`«${decision}» non vale per ${info.kind === 'utente' || info.kind === 'conversazione' ? 'utenti e conversazioni' : 'questo contenuto'}.`);
  }
  const { data: open } = await admin.from('reports').select('reporter_id').eq('target', target).eq('status', 'aperta');
  if (!open?.length) throw new ModerationError('Nessuna segnalazione aperta su questo contenuto.');

  const now = new Date().toISOString();
  const notices: Notice[] = [];
  const reporters = [...new Set(open.map((r) => r.reporter_id as string))];
  const what = whatOf(info);
  const listingId = info.listingId ?? undefined;

  if (decision === 'nascondi') {
    const table = info.kind === 'annuncio' ? 'listings' : info.kind === 'domanda' ? 'questions' : 'ratings';
    const patch = info.kind === 'annuncio' ? { hidden_at: now, hidden_reason: input.message || 'moderazione' } : { hidden_at: now };
    const { error } = await admin.from(table).update(patch).eq('id', info.id);
    if (error) throw new ModerationError(`Non nascosto: ${error.message}`);
    if (info.kind === 'annuncio' && info.userId) {
      notices.push({
        userId: info.userId,
        kind: 'segnalazione',
        title: `«${info.listingTitle}» è stato nascosto`,
        body: input.message || 'Non rispetta le regole di giro.shop. Se pensi sia un errore, scrivici rispondendo a questa email.',
        url: `/miei-annunci#a-${info.id}`,
        listingId,
      });
    }
  } else if (decision === 'sospendi') {
    if (!info.userId) throw new ModerationError('Non so quale utente sospendere.');
    const { error } = await admin.from('profiles').update({ suspended_at: now, suspended_reason: input.message || 'moderazione' }).eq('id', info.userId);
    if (error) throw new ModerationError(`Account non sospeso: ${error.message}`);
    await admin.from('listings').update({ hidden_at: now, hidden_reason: 'utente sospeso' }).eq('seller_id', info.userId).is('hidden_at', null);
    notices.push({
      userId: info.userId,
      kind: 'segnalazione',
      title: 'Il tuo account è sospeso',
      body: input.message || 'Non rispetta le regole di giro.shop: i tuoi annunci non sono visibili e non puoi scrivere. Se pensi sia un errore, rispondi a questa email.',
      url: '/miei-annunci',
    });
  } else if (info.kind === 'annuncio') {
    // Respinta: se l'annuncio era nascosto solo per le segnalazioni, torna visibile
    const { data: l } = await admin.from('listings').select('hidden_at, hidden_reason').eq('id', info.id).maybeSingle();
    if (l?.hidden_at && l.hidden_reason === 'segnalazioni') {
      await admin.from('listings').update({ hidden_at: null, hidden_reason: null }).eq('id', info.id);
      if (info.userId) {
        notices.push({
          userId: info.userId,
          kind: 'segnalazione',
          title: `«${info.listingTitle}» è di nuovo visibile`,
          body: "L'abbiamo controllato: è tutto a posto.",
          url: `/annuncio/${info.id}`,
          listingId,
        });
      }
    }
  } else if (info.kind === 'domanda' || info.kind === 'valutazione') {
    await admin.from(info.kind === 'domanda' ? 'questions' : 'ratings').update({ hidden_at: null }).eq('id', info.id);
  }

  if (decision !== 'respingi') {
    notices.push(
      ...reporters.map((userId) => ({
        userId,
        kind: 'segnalazione' as const,
        title: decision === 'sospendi' ? `Abbiamo sospeso l'account che hai segnalato` : `Abbiamo tolto ${what}`,
        body: 'Grazie della segnalazione: aiuta tutti a comprare e vendere tranquilli.',
        url: '/avvisi',
        listingId,
      })),
    );
  }

  await admin
    .from('reports')
    .update({ status: decision === 'respingi' ? 'respinta' : 'accolta', handled_at: now, ...(actor === 'agente' ? { agent_reviewed_at: now } : {}) })
    .eq('target', target)
    .eq('status', 'aperta');

  const { data: action, error: logError } = await admin
    .from('moderation_actions')
    .insert({
      target,
      listing_id: info.listingId,
      user_id: info.userId,
      action: decision,
      actor,
      moderator_id: input.moderatorId ?? null,
      reason: input.reason ?? null,
      message: input.message ?? null,
      confidence: input.confidence ?? null,
      model: input.model ?? null,
    })
    .select('id')
    .single();
  if (logError || !action) throw new ModerationError(`Decisione presa ma non registrata: ${logError?.message}`);

  await notify(notices, input.origin);
  await refreshListings(true);
  return { actionId: action.id as string, info };
}

/** L'agente non decide da solo: lascia una proposta e chiede a una persona. */
export async function proposeToHuman(
  admin: SupabaseClient,
  target: string,
  proposal: { proposal: Decision; reason: string; confidence: number; model: string },
  origin: string,
): Promise<string> {
  const info = await describeTarget(admin, target);
  const now = new Date().toISOString();
  await admin.from('reports').update({ agent_reviewed_at: now }).eq('target', target).eq('status', 'aperta');
  const { data, error } = await admin
    .from('moderation_actions')
    .insert({
      target,
      listing_id: info.listingId,
      user_id: info.userId,
      action: 'passa',
      actor: 'agente',
      proposal: proposal.proposal,
      reason: proposal.reason,
      confidence: proposal.confidence,
      model: proposal.model,
    })
    .select('id')
    .single();
  if (error || !data) throw new ModerationError(`Proposta non registrata: ${error?.message}`);
  const { data: mods } = await admin.from('profiles').select('id').eq('is_moderator', true);
  await notify(
    (mods ?? []).map((m) => ({
      userId: m.id as string,
      kind: 'segnalazione' as const,
      title: `Serve una decisione: ${whatOf(info)}`,
      body: `L'agente propone «${proposal.proposal}» (sicurezza ${Math.round(proposal.confidence * 100)}%). ${proposal.reason}`.slice(0, 280),
      url: '/moderazione',
      listingId: info.listingId ?? undefined,
    })),
    origin,
  );
  return data.id as string;
}

/** Annulla una decisione (solo le persone): ripristina il contenuto o l'account e avvisa chi è coinvolto. */
export async function undoAction(admin: SupabaseClient, actionId: string, moderatorId: string, origin: string): Promise<void> {
  const { data: a } = await admin.from('moderation_actions').select('*').eq('id', actionId).maybeSingle();
  if (!a) throw new ModerationError('Decisione non trovata.');
  if (a.undone_at) throw new ModerationError('Questa decisione è già stata annullata.');
  if (!['nascondi', 'sospendi', 'respingi'].includes(a.action)) throw new ModerationError('Questa voce non si annulla.');
  const info = await describeTarget(admin, a.target);
  const now = new Date().toISOString();
  const notices: Notice[] = [];

  if (a.action === 'nascondi') {
    if (info.kind === 'annuncio') {
      await admin.from('listings').update({ hidden_at: null, hidden_reason: null }).eq('id', info.id).neq('hidden_reason', 'utente sospeso');
      if (info.userId) {
        notices.push({
          userId: info.userId,
          kind: 'segnalazione',
          title: `«${info.listingTitle}» è di nuovo visibile`,
          body: "Abbiamo ricontrollato: ci scusiamo per l'errore.",
          url: `/annuncio/${info.id}`,
          listingId: info.id,
        });
      }
    } else {
      await admin.from(info.kind === 'domanda' ? 'questions' : 'ratings').update({ hidden_at: null }).eq('id', info.id);
    }
    await admin.from('reports').update({ status: 'respinta', handled_at: now }).eq('target', a.target).eq('status', 'accolta');
  } else if (a.action === 'sospendi' && a.user_id) {
    await admin.from('profiles').update({ suspended_at: null, suspended_reason: null }).eq('id', a.user_id);
    await admin.from('listings').update({ hidden_at: null, hidden_reason: null }).eq('seller_id', a.user_id).eq('hidden_reason', 'utente sospeso');
    await admin.from('reports').update({ status: 'respinta', handled_at: now }).eq('target', a.target).eq('status', 'accolta');
    notices.push({
      userId: a.user_id,
      kind: 'segnalazione',
      title: 'Il tuo account è di nuovo attivo',
      body: "Abbiamo ricontrollato: i tuoi annunci sono di nuovo visibili. Ci scusiamo per l'errore.",
      url: '/miei-annunci',
    });
  } else if (a.action === 'respingi') {
    // Le segnalazioni respinte con questa decisione tornano da decidere (da una persona)
    const since = new Date(new Date(a.created_at).getTime() - 5000).toISOString();
    await admin.from('reports').update({ status: 'aperta', handled_at: null }).eq('target', a.target).eq('status', 'respinta').gte('handled_at', since);
  }

  await admin.from('moderation_actions').update({ undone_at: now, undone_by: moderatorId }).eq('id', actionId);
  await admin.from('moderation_actions').insert({
    target: a.target,
    listing_id: a.listing_id,
    user_id: a.user_id,
    action: 'annulla',
    actor: 'persona',
    moderator_id: moderatorId,
    reason: `Annullata la decisione «${a.action}» del ${new Date(a.created_at).toLocaleString('it-CH')}`,
  });
  await notify(notices, origin);
  await refreshListings(true);
}
