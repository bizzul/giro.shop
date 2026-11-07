import { ActionError, defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { createDraft, DraftError, IMAGE_TYPES, MAX_PHOTOS, MAX_PHOTO_BYTES } from '../core/draft.ts';
import type { DraftImage, ImageMediaType } from '../core/draft.ts';
import { estimatePrice } from '../core/price.ts';
import { CATEGORY_IDS, CONDITIONS, type Listing } from '../core/types.ts';
import { resolveComune } from '../core/comuni.ts';
import { demandForDraft } from '../lib/demand.ts';
import { houseDrafts, MAX_HOUSE_PHOTOS } from '../core/house.ts';
import { allow } from '../lib/claude.ts';
import { account } from './account.ts';
import { alerts } from './alerts.ts';
import { appeals } from './appeals.ts';
import { messages } from './messages.ts';
import { moderation } from './moderation.ts';
import { questions } from './questions.ts';
import { ratings } from './ratings.ts';
import { reports } from './reports.ts';

/** Le stesse funzioni del nucleo usate dal server MCP, esposte al sito come Astro Actions. */
export const server = {
  account,
  alerts,
  appeals,
  messages,
  moderation,
  questions,
  ratings,
  reports,
  createDraft: defineAction({
    accept: 'form',
    input: z.object({
      photos: z.array(z.instanceof(File)).optional(),
      notes: z.string().max(2000).nullish(),
      comune: z.string().max(80).nullish(),
    }),
    handler: async ({ photos, notes, comune }) => {
      const files = (photos ?? []).filter((f) => f.size > 0);
      if (files.length > MAX_PHOTOS) {
        throw new ActionError({ code: 'BAD_REQUEST', message: `Puoi caricare al massimo ${MAX_PHOTOS} foto.` });
      }
      const images: DraftImage[] = [];
      for (const file of files) {
        if (!IMAGE_TYPES.includes(file.type as ImageMediaType)) {
          throw new ActionError({
            code: 'BAD_REQUEST',
            message: `"${file.name}" non è un'immagine JPEG, PNG, GIF o WebP.`,
          });
        }
        if (file.size > MAX_PHOTO_BYTES) {
          throw new ActionError({ code: 'BAD_REQUEST', message: `"${file.name}" supera i 5 MB.` });
        }
        const data = Buffer.from(await file.arrayBuffer()).toString('base64');
        images.push({ kind: 'base64', mediaType: file.type as ImageMediaType, data });
      }
      try {
        return await createDraft({
          images,
          notes: notes ?? undefined,
          comune: comune ?? undefined,
          apiKey: import.meta.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY,
        });
      } catch (error) {
        if (error instanceof DraftError) throw new ActionError({ code: 'BAD_REQUEST', message: error.message });
        throw error;
      }
    },
  }),

  /** Svuota casa: una bozza per ogni oggetto nelle foto (con Claude) o per ogni foto (senza). */
  houseDrafts: defineAction({
    accept: 'form',
    input: z.object({
      photos: z.array(z.instanceof(File)).optional(),
      hint: z.array(z.string().max(300)).default([]),
      notes: z.string().max(2000).nullish(),
    }),
    handler: async ({ photos, hint, notes }, context) => {
      const files = (photos ?? []).filter((f) => f.size > 0);
      if (files.length > MAX_HOUSE_PHOTOS) throw new ActionError({ code: 'BAD_REQUEST', message: `Al massimo ${MAX_HOUSE_PHOTOS} foto alla volta.` });
      // Molte foto in una volta costano: un limite per persona (o indirizzo) all'ora
      if (!allow(`casa:${context.locals.user?.id ?? context.clientAddress}`, 12, 60 * 60_000)) {
        throw new ActionError({ code: 'TOO_MANY_REQUESTS', message: 'Troppe richieste in poco tempo: riprova tra un po\'.' });
      }
      const images: DraftImage[] = [];
      for (const file of files) {
        if (!IMAGE_TYPES.includes(file.type as ImageMediaType) || file.size > MAX_PHOTO_BYTES) {
          throw new ActionError({ code: 'BAD_REQUEST', message: `"${file.name}" non è un'immagine JPEG, PNG o WebP sotto i 5 MB.` });
        }
        images.push({ kind: 'base64', mediaType: file.type as ImageMediaType, data: Buffer.from(await file.arrayBuffer()).toString('base64') });
      }
      try {
        return await houseDrafts({ images, hints: hint, notes: notes ?? undefined, apiKey: import.meta.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY });
      } catch (error) {
        if (error instanceof DraftError) throw new ActionError({ code: 'BAD_REQUEST', message: error.message });
        throw error;
      }
    },
  }),

  /** "Lo cercano in 4": quante ricerche salvate corrispondono a una bozza, e con che budget (solo numeri). */
  demand: defineAction({
    input: z.object({
      title: z.string().trim().min(1).max(120),
      description: z.string().max(4000).default(''),
      tags: z.array(z.string().max(60)).max(20).default([]),
      category: z.enum(CATEGORY_IDS),
      condition: z.enum(CONDITIONS),
      comune: z.string().max(80),
      shipping: z.boolean().default(false),
    }),
    handler: async (input, context) => {
      const comune = resolveComune(input.comune);
      if (!comune) return { people: 0, budget: null };
      const draft: Listing = {
        id: 'bozza',
        title: input.title,
        description: input.description,
        category: input.category,
        tags: input.tags,
        attributes: {},
        priceChf: 0,
        condition: input.condition,
        comuneId: comune.id,
        publishedAt: new Date().toISOString(),
        status: 'pubblicato',
        seller: { name: '', verified: false },
        sellerId: context.locals.user?.id,
        shipping: input.shipping,
      };
      return demandForDraft(draft);
    },
  }),

  estimatePrice: defineAction({
    input: z.object({
      text: z.string().min(2).max(300),
      category: z.enum(CATEGORY_IDS).optional(),
      condition: z.enum(CONDITIONS).optional(),
    }),
    handler: async (input) => estimatePrice(input),
  }),
};
