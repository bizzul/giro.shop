/**
 * Scarica una foto da un indirizzo dato da un assistente AI (connettore MCP), senza aprire la rete interna al server:
 * - solo https, porta 443, al massimo 3 redirect (ricontrollati uno per uno);
 * - l'indirizzo IP viene controllato al momento della connessione (niente localhost, reti private, link-local,
 *   metadati del cloud), quindi un nome che cambia IP tra controllo e connessione non passa;
 * - al massimo 5 MB, solo JPEG, PNG, WebP e GIF, 10 secondi.
 */
import { request } from 'node:https';
import { lookup } from 'node:dns';
import { isIP, type LookupFunction } from 'node:net';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export type FetchedImageType = (typeof TYPES)[number];

export class ImageFetchError extends Error {}

/** Indirizzi che un server non deve mai chiamare per conto di altri. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local, metadati del cloud
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6 === '::' || v6 === '::1') return true;
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v6);
}

const safeLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, '', 0);
    const list = addresses as Array<{ address: string; family: number }>;
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad || !list.length) return callback(new ImageFetchError(`indirizzo non ammesso (${hostname})`), '', 0);
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

export interface FetchedImage {
  type: FetchedImageType;
  bytes: Buffer;
}

export function checkImageUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ImageFetchError('indirizzo non valido');
  }
  if (url.protocol !== 'https:') throw new ImageFetchError('serve un indirizzo https');
  if (url.port && url.port !== '443') throw new ImageFetchError('porta non ammessa');
  if (url.username || url.password) throw new ImageFetchError('indirizzo con credenziali non ammesso');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && isPrivateAddress(host)) throw new ImageFetchError('indirizzo non ammesso');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new ImageFetchError('indirizzo non ammesso');
  }
  return url;
}

function getOnce(url: URL): Promise<{ status: number; location?: string; type: string; bytes: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      { method: 'GET', lookup: safeLookup, timeout: 10_000, headers: { 'User-Agent': 'giro.shop/1.0 (foto annuncio)', Accept: TYPES.join(', ') } },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, location: res.headers.location, type: '', bytes: Buffer.alloc(0) });
        }
        const declared = Number(res.headers['content-length'] ?? 0);
        if (declared > MAX_IMAGE_BYTES) {
          res.destroy();
          return reject(new ImageFetchError('foto più grande di 5 MB'));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_IMAGE_BYTES) {
            res.destroy();
            reject(new ImageFetchError('foto più grande di 5 MB'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ status, type: String(res.headers['content-type'] ?? '').split(';')[0].trim(), bytes: Buffer.concat(chunks) }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new ImageFetchError('la foto non arriva (10 secondi)')));
    req.on('error', (e) => reject(e instanceof ImageFetchError ? e : new ImageFetchError(e.message)));
    req.end();
  });
}

/** Riconosce il formato dai primi byte: non ci si fida solo del Content-Type. */
export function sniffImage(bytes: Buffer): FetchedImageType | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length > 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (bytes.length > 6 && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif';
  return null;
}

export async function fetchImage(raw: string): Promise<FetchedImage> {
  let url = checkImageUrl(raw);
  for (let hop = 0; hop <= 3; hop++) {
    const res = await getOnce(url);
    if (res.location) {
      url = checkImageUrl(new URL(res.location, url).href);
      continue;
    }
    if (res.status !== 200) throw new ImageFetchError(`il sito risponde ${res.status}`);
    const type = sniffImage(res.bytes);
    if (!type) throw new ImageFetchError('non è una foto JPEG, PNG, WebP o GIF');
    return { type, bytes: res.bytes };
  }
  throw new ImageFetchError('troppi redirect');
}
