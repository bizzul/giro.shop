import { ActionError, defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { adminClient } from '../lib/admin.ts';
import { notify, siteOrigin } from '../lib/notify.ts';
import { requireUser } from './account.ts';

/** Contestare una decisione di moderazione che ci riguarda (contenuto nascosto, account sospeso). */
export const appeals = {
  create: defineAction({
    accept: 'form',
    input: z.object({
      actionId: z.string().uuid(),
      message: z.string().trim().min(10, 'Spiega in qualche parola perché pensi sia un errore.').max(1500, 'Al massimo 1500 caratteri.'),
    }),
    handler: async ({ actionId, message }, context) => {
      const { supabase, user } = requireUser(context);
      const { error } = await supabase.from('appeals').insert({ action_id: actionId, user_id: user.id, message });
      if (error) {
        if (error.code === '23505') throw new ActionError({ code: 'CONFLICT', message: 'Hai già contestato questa decisione: ti rispondiamo appena possibile.' });
        throw new ActionError({ code: 'BAD_REQUEST', message: 'Questa decisione non si può contestare (forse è già stata annullata).' });
      }
      // Avviso a chi modera
      const admin = adminClient();
      if (admin) {
        const [{ data: mods }, { data: me }] = await Promise.all([
          admin.from('profiles').select('id').eq('is_moderator', true),
          admin.from('profiles').select('display_name').eq('id', user.id).maybeSingle(),
        ]);
        await notify(
          (mods ?? [])
            .filter((m) => m.id !== user.id)
            .map((m) => ({
              userId: m.id as string,
              kind: 'contestazione' as const,
              title: `${me?.display_name ?? 'Qualcuno'} contesta una decisione`,
              body: message.slice(0, 200),
              url: '/moderazione#contestazioni',
            })),
          siteOrigin(context.url.origin),
        );
      }
      return { actionId };
    },
  }),
};
