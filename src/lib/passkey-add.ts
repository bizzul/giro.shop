import { actions } from 'astro:actions';
import { creationOptionsFromJSON, credentialToJSON, isCancel } from './webauthn.ts';

/**
 * Aggiunge una passkey all'account con cui si è entrati: sfida dal server, il dispositivo crea la chiave,
 * il server la salva (src/actions/passkeys.ts). Annullare non è un errore: torna { ok: false } senza messaggio.
 */
export async function addPasskey(): Promise<{ ok: true } | { ok: false; message?: string }> {
  try {
    const start = await actions.passkeys.addOptions();
    if (start.error) return { ok: false, message: start.error.message };
    const credential = (await navigator.credentials.create({ publicKey: creationOptionsFromJSON(start.data.options) })) as PublicKeyCredential | null;
    if (!credential) return { ok: false };
    const result = await actions.passkeys.add({ challengeId: start.data.challengeId, credential: credentialToJSON(credential) });
    if (result.error) return { ok: false, message: result.error.message };
    return { ok: true };
  } catch (error) {
    if (isCancel(error)) return { ok: false };
    // InvalidStateError: questo dispositivo ha già una passkey per l'account (excludeCredentials)
    return {
      ok: false,
      message:
        error instanceof DOMException && error.name === 'InvalidStateError'
          ? 'Su questo dispositivo hai già una passkey per giro.shop.'
          : 'Questo dispositivo non è riuscito a creare la passkey. Riprova, o usa un altro dispositivo.',
    };
  }
}
