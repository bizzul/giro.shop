/**
 * Passkey facoltative: nome leggibile del dispositivo e messaggi d'errore in italiano.
 * Il resto (sfida, verifica, sessione) lo fa Supabase Auth: vedi src/actions/passkeys.ts.
 */

/** Quante passkey può avere un account (GOTRUE_PASSKEY_MAX_PASSKEYS_PER_USER, predefinito di Supabase). */
export const MAX_PASSKEYS = 10;

/**
 * Nome con cui la passkey compare nell'account, preso dal browser che la crea: «iPhone · Safari», «Mac · Chrome».
 * Serve solo a riconoscerla nell'elenco: la passkey vera può poi sincronizzarsi su altri dispositivi.
 */
export function passkeyName(userAgent: string | null | undefined): string {
  const ua = userAgent ?? '';
  const device = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Macintosh|Mac OS X/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : /CrOS/.test(ua)
              ? 'Chromebook'
              : /Linux/.test(ua)
                ? 'Linux'
                : null;
  // L'ordine conta: Edge e Opera dicono anche «Chrome», Chrome dice anche «Safari»
  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /SamsungBrowser\//.test(ua)
        ? 'Samsung Internet'
        : /Firefox\/|FxiOS\//.test(ua)
          ? 'Firefox'
          : /Chrome\/|CriOS\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : null;
  const name = [device, browser].filter(Boolean).join(' · ');
  return name || 'Passkey';
}

/** Codici d'errore di Supabase Auth per le passkey → cosa dire a chi sta entrando o aggiungendo una passkey. */
export function passkeyErrorMessage(code: string | undefined, status?: number): string {
  if (status === 429 || code === 'over_request_rate_limit') return 'Troppi tentativi: riprova tra qualche minuto.';
  switch (code) {
    case 'webauthn_challenge_expired':
    case 'webauthn_challenge_not_found':
      return 'È passato troppo tempo: riprova.';
    // Supabase dà verification_failed anche per una passkey tolta dall'account e rimasta sul dispositivo
    case 'webauthn_credential_not_found':
    case 'webauthn_verification_failed':
      return "Questa passkey non è riconosciuta: forse l'hai tolta dal tuo account. Entra con il link via email, poi puoi aggiungerne una nuova.";
    case 'webauthn_credential_exists':
      return 'Questa passkey è già collegata al tuo account.';
    case 'too_many_passkeys':
      return `Hai già ${MAX_PASSKEYS} passkey: togline una prima di aggiungerne un'altra.`;
    case 'passkey_disabled':
    case 'feature_disabled':
      return 'Le passkey non sono attive su questo sito.';
    default:
      return 'Non è andata: riprova.';
  }
}
