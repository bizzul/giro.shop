/**
 * Le risposte che la persona collegata ha già trovato utili, in un annuncio.
 * La scheda è uguale per tutti e in cache: lo stato del bottone "Utile" arriva da qui.
 * GET /domande/voti?annuncio=l-001 → { voted: [id, …] }
 */
import type { APIRoute } from 'astro';
import { getListing } from '../../core/store.ts';

export const GET: APIRoute = async ({ url, locals }) => {
  const { user, supabase } = locals;
  const ids = (getListing(url.searchParams.get('annuncio') ?? '')?.questions ?? []).map((q) => q.id);
  if (!user || !supabase || ids.length === 0) return Response.json({ voted: [] });
  const { data } = await supabase.from('question_votes').select('question_id').eq('user_id', user.id).in('question_id', ids);
  return Response.json({ voted: (data ?? []).map((v) => v.question_id) });
};
