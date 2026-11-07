import { ActionError, defineAction, type ActionAPIContext } from 'astro:actions';
import { z } from 'astro/zod';
import { parseCatalog } from '../core/catalog.ts';
import { invalidateListingPages } from '../lib/cache.ts';
import { siteOrigin } from '../lib/notify.ts';
import { bulkApply, bulkPreview, importCatalog, ProError, requirePro, restoreBulk } from '../lib/pro.ts';
import { requireUser } from './account.ts';

const asActionError = (error: unknown) => (error instanceof ProError ? new ActionError({ code: 'BAD_REQUEST', message: error.message }) : error);
const optional = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullish());

/** Il catalogo arriva da un file (CSV) o incollato nel riquadro. */
async function catalogText(input: { file?: File | null; csv?: string | null }): Promise<string> {
  if (input.file && input.file.size > 0) {
    if (input.file.size > 512 * 1024) throw new ActionError({ code: 'BAD_REQUEST', message: 'Il file supera i 512 KB.' });
    return await input.file.text();
  }
  return input.csv ?? '';
}

async function pro(context: ActionAPIContext) {
  const { supabase, user } = requireUser(context);
  try {
    await requirePro(user.id);
  } catch (error) {
    throw asActionError(error);
  }
  return { supabase, user, origin: siteOrigin(context.url.origin), invalidate: () => invalidateListingPages(context) };
}

/** Negozi Pro: dati del negozio, modifiche in blocco a parole, import del catalogo. */
export const proActions = {
  saveShop: defineAction({
    accept: 'form',
    input: z.object({
      name: z.string().trim().min(2, 'Il nome del negozio è troppo corto.').max(60),
      about: optional(600),
      address: optional(120),
      website: z.preprocess((v) => (v === '' ? null : v), z.string().trim().url('Scrivi un indirizzo web completo, con https://').max(200).nullish()),
      phone: optional(30),
      hours: optional(200),
    }),
    handler: async (input, context) => {
      const { supabase, user } = requireUser(context);
      const { data, error } = await supabase
        .from('shops')
        .update({ ...input, updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .select('user_id');
      if (error) throw new ActionError({ code: 'BAD_REQUEST', message: `Negozio non salvato: ${error.message}` });
      if (!data?.length) throw new ActionError({ code: 'NOT_FOUND', message: 'Prima attiva Pro.' });
      await invalidateListingPages(context);
      return { name: input.name };
    },
  }),

  bulkPreview: defineAction({
    accept: 'form',
    input: z.object({ phrase: z.string().trim().min(3).max(200) }),
    handler: async ({ phrase }, context) => {
      const { user } = await pro(context);
      try {
        const { plan, items } = bulkPreview(user.id, phrase);
        return { phrase, pct: plan.pct, endsAt: plan.endsAt, query: plan.query, items };
      } catch (error) {
        throw asActionError(error);
      }
    },
  }),

  bulkApply: defineAction({
    accept: 'form',
    input: z.object({ phrase: z.string().trim().min(3).max(200) }),
    handler: async ({ phrase }, context) => {
      const { supabase, user, origin, invalidate } = await pro(context);
      try {
        return await bulkApply(supabase, user.id, phrase, origin, invalidate);
      } catch (error) {
        throw asActionError(error);
      }
    },
  }),

  bulkUndo: defineAction({
    accept: 'form',
    input: z.object({ id: z.string().uuid() }),
    handler: async ({ id }, context) => {
      const { user, invalidate } = await pro(context);
      try {
        const restored = await restoreBulk(id, user.id);
        await invalidate();
        return { restored };
      } catch (error) {
        throw asActionError(error);
      }
    },
  }),

  catalogPreview: defineAction({
    accept: 'form',
    input: z.object({ file: z.instanceof(File).nullish(), csv: z.string().max(200_000).nullish(), comune: z.string().max(80).nullish() }),
    handler: async (input, context) => {
      await pro(context);
      const text = await catalogText(input);
      const { rows, error } = parseCatalog(text, input.comune ?? undefined);
      if (error) throw new ActionError({ code: 'BAD_REQUEST', message: error });
      return { csv: text, comune: input.comune ?? '', rows };
    },
  }),

  catalogImport: defineAction({
    accept: 'form',
    input: z.object({ csv: z.string().max(200_000), comune: z.string().max(80).nullish() }),
    handler: async ({ csv, comune }, context) => {
      const { supabase, user, origin, invalidate } = await pro(context);
      const { rows, error } = parseCatalog(csv, comune ?? undefined);
      if (error) throw new ActionError({ code: 'BAD_REQUEST', message: error });
      try {
        return await importCatalog(supabase, user.id, rows, origin, invalidate);
      } catch (error) {
        throw asActionError(error);
      }
    },
  }),
};
