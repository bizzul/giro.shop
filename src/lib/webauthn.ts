/**
 * Ponte tra le opzioni WebAuthn in JSON (come le manda Supabase Auth, con i byte in base64url) e l'API del browser,
 * che vuole ArrayBuffer. Usa i metodi nativi quando ci sono (parseCreationOptionsFromJSON, toJSON) e una
 * conversione a mano per i browser che non li hanno ancora. Si usa solo nel browser: vedi /accedi e /miei-annunci.
 */

type Json = Record<string, unknown>;

export function bytesToBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const b of view) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** true se il browser sa usare le passkey (non vuol dire che il dispositivo ne abbia una). */
export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function' && Boolean(navigator.credentials);
}

type Descriptor = { id: string; type: string; transports?: string[] };
const descriptors = (list: unknown) =>
  Array.isArray(list) ? (list as Descriptor[]).map((d) => ({ ...d, id: base64UrlToBytes(d.id) }) as PublicKeyCredentialDescriptor) : undefined;

/** Opzioni per creare una passkey (registrazione), dal JSON del server. */
export function creationOptionsFromJSON(options: Json): PublicKeyCredentialCreationOptions {
  const native = (PublicKeyCredential as unknown as { parseCreationOptionsFromJSON?: (o: Json) => PublicKeyCredentialCreationOptions }).parseCreationOptionsFromJSON;
  if (typeof native === 'function') return native(options);
  const user = options.user as Json;
  return {
    ...options,
    challenge: base64UrlToBytes(options.challenge as string),
    user: { ...user, id: base64UrlToBytes(user.id as string) },
    excludeCredentials: descriptors(options.excludeCredentials),
  } as unknown as PublicKeyCredentialCreationOptions;
}

/** Opzioni per usare una passkey (accesso), dal JSON del server. */
export function requestOptionsFromJSON(options: Json): PublicKeyCredentialRequestOptions {
  const native = (PublicKeyCredential as unknown as { parseRequestOptionsFromJSON?: (o: Json) => PublicKeyCredentialRequestOptions }).parseRequestOptionsFromJSON;
  if (typeof native === 'function') return native(options);
  return {
    ...options,
    challenge: base64UrlToBytes(options.challenge as string),
    allowCredentials: descriptors(options.allowCredentials),
  } as unknown as PublicKeyCredentialRequestOptions;
}

/** Una passkey in JSON, come la vuole il server (src/actions/passkeys.ts). */
export type CredentialJSON = {
  id: string;
  rawId: string;
  type: 'public-key';
  response: { clientDataJSON: string; [key: string]: unknown };
  [key: string]: unknown;
};

/** La passkey appena creata o usata, in JSON per il server (formato WebAuthn Level 3). */
export function credentialToJSON(credential: PublicKeyCredential): CredentialJSON {
  if (typeof credential.toJSON === 'function') return credential.toJSON() as unknown as CredentialJSON;
  const response = credential.response as AuthenticatorAttestationResponse & AuthenticatorAssertionResponse;
  const out: Json = {};
  for (const key of ['clientDataJSON', 'attestationObject', 'authenticatorData', 'signature', 'userHandle'] as const) {
    const value = response[key];
    if (value) out[key] = bytesToBase64Url(value);
  }
  if (typeof response.getTransports === 'function') out.transports = response.getTransports();
  return {
    id: credential.id,
    rawId: bytesToBase64Url(credential.rawId),
    type: 'public-key',
    response: out as CredentialJSON['response'],
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
  };
}

/**
 * true se l'errore del browser vuol dire «ci ho ripensato» (finestra chiusa, Annulla, tempo scaduto):
 * in quel caso non si mostra nessun errore.
 */
export function isCancel(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError');
}
