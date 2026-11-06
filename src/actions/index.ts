import { ActionError, defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { createDraft, DraftError, IMAGE_TYPES, MAX_PHOTOS, MAX_PHOTO_BYTES } from '../core/draft.ts';
import type { DraftImage, ImageMediaType } from '../core/draft.ts';
import { estimatePrice } from '../core/price.ts';
import { CATEGORY_IDS, CONDITIONS } from '../core/types.ts';
import { account } from './account.ts';

/** Le stesse funzioni del nucleo usate dal server MCP, esposte al sito come Astro Actions. */
export const server = {
  account,
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

  estimatePrice: defineAction({
    input: z.object({
      text: z.string().min(2).max(300),
      category: z.enum(CATEGORY_IDS).optional(),
      condition: z.enum(CONDITIONS).optional(),
    }),
    handler: async (input) => estimatePrice(input),
  }),
};
