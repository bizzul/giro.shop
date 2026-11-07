import { ActionError, defineAction, type ActionAPIContext } from 'astro:actions';
import { z } from 'astro/zod';
import { passkeyErrorMessage, passkeyName } from '../core/passkey.ts';
import { allow } from '../lib/claude.ts';
import { requireUser } from './account.ts';

/**
 * Passkey facoltative, con Supabase Auth. Il link via email resta sempre il modo principale per entrare:
 * chi vuole aggiunge una passkey dall'account e la volta dopo entra con impronta, viso o PIN del dispositivo.
 *
 * Ogni cerimonia ha due passi, entrambi dal server (la sessione vive nei cookie, come per il link):
 * 1. …Options: Supabase dà una sfida, il browser la firma con navigator.credentials (src/lib/webauthn.ts);
 * 2. la firma torna qui, Supabase la verifica. Per l'accesso, la sessione si scrive nei cookie in questo passo.
 */

type PasskeyError = { code?: string; status?: number; message?: string } | null;

function fail(error: PasskeyError): never {
  const status = error?.status;
  throw new ActionError({
    code: status === 429 ? 'TOO_MANY_REQUESTS' : status === 401 ? 'UNAUTHORIZED' : 'BAD_REQUEST',
    message: passkeyErrorMessage(error?.code, status),
  });
}

function requireSupabase(context: ActionAPIContext) {
  const supabase = context.locals.supabase;
  if (!supabase) throw new ActionError({ code: 'BAD_REQUEST', message: 'Supabase non è configurato.' });
  return supabase;
}

/** La passkey firmata dal browser (PublicKeyCredential.toJSON): i campi binari sono testo base64url. */
const b64 = z.string().max(16_384).regex(/^[A-Za-z0-9_-]*$/);
const credential = z.looseObject({
  id: b64.min(1),
  rawId: b64.min(1),
  type: z.literal('public-key'),
  response: z.looseObject({ clientDataJSON: b64.min(1) }),
});

/** Le opzioni WebAuthn passano dal server al browser così come le manda Supabase. */
const asOptions = (options: unknown) => options as Record<string, unknown>;
const asCredential = <T>(value: z.infer<typeof credential>) => value as unknown as T;

type Supabase = ReturnType<typeof requireSupabase>;
type VerifyRegistration = Parameters<Supabase['auth']['passkey']['verifyRegistration']>[0]['credential'];
type VerifyAuthentication = Parameters<Supabase['auth']['passkey']['verifyAuthentication']>[0]['credential'];

export const passkeys = {
  /** Accesso, passo 1: una sfida per qualunque passkey del sito (non serve scrivere l'email). */
  loginOptions: defineAction({
    handler: async (_input, context) => {
      const supabase = requireSupabase(context);
      if (!allow(`passkey:${context.clientAddress}`, 30, 5 * 60_000)) fail({ status: 429 });
      const { data, error } = await supabase.auth.passkey.startAuthentication();
      if (error || !data) fail(error);
      return { challengeId: data.challenge_id, options: asOptions(data.options) };
    },
  }),

  /** Accesso, passo 2: Supabase controlla la firma e apre la sessione (cookie). */
  login: defineAction({
    input: z.object({ challengeId: z.string().uuid(), credential }),
    handler: async ({ challengeId, credential }, context) => {
      const supabase = requireSupabase(context);
      const { data, error } = await supabase.auth.passkey.verifyAuthentication({
        challengeId,
        credential: asCredential<VerifyAuthentication>(credential),
      });
      if (error || !data?.session) fail(error);
      return { ok: true };
    },
  }),

  /** Aggiunta, passo 1: una sfida legata all'account con cui si è entrati. */
  addOptions: defineAction({
    handler: async (_input, context) => {
      const { supabase } = requireUser(context);
      const { data, error } = await supabase.auth.passkey.startRegistration();
      if (error || !data) fail(error);
      return { challengeId: data.challenge_id, options: asOptions(data.options) };
    },
  }),

  /** Aggiunta, passo 2: Supabase salva la chiave pubblica; il nome viene dal browser («Mac · Safari»). */
  add: defineAction({
    input: z.object({ challengeId: z.string().uuid(), credential }),
    handler: async ({ challengeId, credential }, context) => {
      const { supabase } = requireUser(context);
      const { data, error } = await supabase.auth.passkey.verifyRegistration({
        challengeId,
        credential: asCredential<VerifyRegistration>(credential),
      });
      if (error || !data) fail(error);
      const name = passkeyName(context.request.headers.get('user-agent'));
      // Senza nome la passkey resta valida: nell'elenco compare come «Passkey»
      await supabase.auth.passkey.update({ passkeyId: data.id, friendlyName: name });
      return { id: data.id, name };
    },
  }),

  /** Toglie una passkey dall'account. Il dispositivo la tiene finché non la cancelli anche lì, ma non apre più niente. */
  remove: defineAction({
    accept: 'form',
    input: z.object({ id: z.string().uuid() }),
    handler: async ({ id }, context) => {
      const { supabase } = requireUser(context);
      const { error } = await supabase.auth.passkey.delete({ passkeyId: id });
      if (error) throw new ActionError({ code: 'BAD_REQUEST', message: `Non ho tolto la passkey: ${error.message}` });
      return { ok: true };
    },
  }),
};
