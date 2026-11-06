/**
 * Foto di esempio per gli annunci di prova, da Openverse (licenze CC0, pubblico dominio, CC BY).
 *
 *   node scripts/fetch-photos.ts search          cerca i candidati per ogni annuncio
 *   node scripts/fetch-photos.ts sheet           foglio provini delle foto scelte
 *   node scripts/fetch-photos.ts sheet l-020     foglio provini dei candidati di un annuncio
 *   node scripts/fetch-photos.ts build           scarica, ritaglia 4:3 in WebP, scrive src/data/photos.ts
 *
 * I file intermedi restano in .cache/photos (ignorata da git).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { LISTINGS } from '../src/data/listings.ts';

const ROOT = new URL('../', import.meta.url);
const CACHE = new URL('.cache/photos/', ROOT);
const ORIG = new URL('orig/', CACHE);
const OUT = new URL('public/foto/', ROOT);
const CANDIDATES_FILE = new URL('candidates.json', CACHE);
const UA = 'PiazzaPrototype/0.1 (local prototype)';

/** Ricerca in inglese per ogni annuncio pubblicato: Openverse trova di più. */
const QUERIES: Record<string, string> = {
  'l-001': 'walnut wood desk',
  'l-002': 'vintage wooden desk drawers',
  'l-003': 'standing desk wood',
  'l-004': 'white desk home office',
  'l-005': "children's desk",
  'l-006': "wooden desk",
  'l-007': "mid century desk",
  'l-008': "dining table",
  'l-009': "bookcase",
  'l-010': 'grey sofa living room',
  'l-011': "velvet armchair",
  'l-014': 'Bianchi road bike',
  'l-015': "road bike",
  'l-016': 'Specialized Allez',
  'l-019': "e-bike",
  'l-020': "children's bicycle",
  'l-021': 'kids bike training wheels',
  'l-022': "kids bicycle",
  'l-023': 'hardtail mountain bike',
  'l-024': "skis",
  'l-025': 'ski boots',
  'l-026': 'ski helmet',
  'l-027': "snowboard",
  'l-029': "snowshoe",
  'l-030': "winter jacket",
  'l-031': 'Vespa PX',
  'l-032': 'red Vespa scooter',
  'l-033': 'Piaggio Liberty scooter',
  'l-034': "pram",
  'l-035': 'child car seat',
  'l-036': "iPhone",
  'l-037': 'MacBook Air',
  'l-038': 'Nintendo Switch',
  'l-039': 'Xbox Series S',
  'l-040': "Nikon DSLR camera",
  'l-041': 'Jura coffee machine',
  'l-042': 'washing machine',
  'l-043': 'classical guitar',
  'l-044': 'Yamaha digital piano',
  'l-045': "lawnmower",
  'l-046': 'Weber gas grill',
  'l-047': "cardboard boxes",
  'l-048': 'Swiss franc coins',
};

/**
 * Candidato scelto dopo la revisione sul foglio provini (predefinito: il primo).
 * Un numero è l'indice tra i candidati dell'annuncio; "l-019#4" prende un candidato di un altro annuncio.
 */
const PICKS: Record<string, number | string> = {
  'l-001': 4,
  'l-026': 1,
  'l-038': 2,
  'l-044': 2,
  'l-004': 'l-007#0',
  'l-005': 'l-007#3',
  'l-006': 1,
  'l-007': 1,
  'l-008': 3,
  'l-009': 2,
  'l-011': 0,
  'l-015': 0,
  'l-019': 5,
  'l-020': 'l-019#4',
  'l-021': 'l-020#1',
  'l-022': 5,
  'l-024': 5,
  'l-027': 5,
  'l-029': 3,
  'l-030': 0,
  'l-034': 1,
  'l-036': 0,
  'l-040': 5,
  'l-045': 1,
  'l-047': 1,
};

function chosen(candidates: Record<string, Candidate[]>, id: string): Candidate | undefined {
  const pick = PICKS[id] ?? 0;
  if (typeof pick === 'string') {
    const [other, index] = pick.split('#');
    return candidates[other]?.[Number(index)];
  }
  return candidates[id]?.[pick];
}

interface Candidate {
  id: string;
  title: string | null;
  url: string;
  creator: string | null;
  creator_url: string | null;
  license: string;
  license_version: string | null;
  license_url: string | null;
  foreign_landing_url: string;
  source: string;
  width: number;
  height: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function search(query: string): Promise<Candidate[]> {
  const params = new URLSearchParams({
    q: query,
    license: 'cc0,pdm,by',
    mature: 'false',
    page_size: '20', // il massimo senza registrazione
  });
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`https://api.openverse.org/v1/images/?${params}`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(30_000),
    }).catch(() => null);
    if (!res || res.status === 429 || res.status >= 500) {
      const wait = Number(res?.headers.get('retry-after') ?? 10 * (attempt + 1));
      console.error(`  ${res ? `errore ${res.status}` : 'nessuna risposta'}, riprovo tra ${wait}s`);
      await sleep(wait * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`Openverse ${res.status} per "${query}"`);
    const body = (await res.json()) as { results: Candidate[] };
    return body.results
      .filter((r) => r.url && r.width >= 640 && r.height >= 480 && r.width / r.height >= 0.75 && r.width / r.height <= 2.2)
      // prima le foto orizzontali: si ritagliano meglio in 4:3
      .sort((a, b) => Number(b.width >= b.height) - Number(a.width >= a.height))
      .slice(0, 8)
      .map((r) => ({
        id: r.id,
        title: r.title,
        url: r.url,
        creator: r.creator,
        creator_url: r.creator_url,
        license: r.license,
        license_version: r.license_version,
        license_url: r.license_url,
        foreign_landing_url: r.foreign_landing_url,
        source: r.source,
        width: r.width,
        height: r.height,
      }));
  }
  throw new Error(`Openverse non risponde per "${query}"`);
}

async function loadCandidates(): Promise<Record<string, Candidate[]>> {
  return JSON.parse(await readFile(CANDIDATES_FILE, 'utf8'));
}

/** Per Wikimedia chiede la miniatura da 1280 px invece dell'originale: più leggera e meno soggetta a limiti. */
function downloadUrl(c: Candidate): string {
  const m = c.url.match(/^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/(\w)\/(\w\w)\/([^/]+\.(?:jpe?g|png))$/i);
  if (m && c.width > 1280) return `https://upload.wikimedia.org/wikipedia/commons/thumb/${m[1]}/${m[2]}/${m[3]}/1280px-${m[3]}`;
  return c.url;
}

async function original(c: Candidate): Promise<Buffer> {
  const file = new URL(c.id, ORIG);
  try {
    return await readFile(file);
  } catch {
    // non ancora in cache
  }
  const url = downloadUrl(c);
  let res: Response | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(45_000) });
    if (res.status !== 429 && res.status < 500) break;
    await sleep(Number(res.headers.get('retry-after') ?? 5 * (attempt + 1)) * 1000);
  }
  if (!res?.ok) throw new Error(`download ${res?.status}: ${url}`);
  await sleep(600);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 30e6) throw new Error(`file troppo grande (${Math.round(buf.length / 1e6)} MB): ${c.url}`);
  await sharp(buf).metadata(); // verifica che sia davvero un'immagine
  await writeFile(file, buf);
  return buf;
}

const esc = (s: string) => s.replace(/[<>&"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[ch] as string);

async function tile(buf: Buffer | null, label: string): Promise<Buffer> {
  const W = 300;
  const H = 225;
  const layers: Array<{ input: Buffer; top: number; left: number }> = [];
  if (buf) {
    const img = await sharp(buf).rotate().resize(W, H, { fit: 'cover', position: 'attention' }).toBuffer();
    layers.push({ input: img, top: 0, left: 0 });
  }
  const bar = Buffer.from(
    `<svg width="${W}" height="28"><rect width="${W}" height="28" fill="#0d1120"/><text x="8" y="19" font-family="Helvetica, Arial" font-size="14" fill="#ffffff">${esc(label.slice(0, 38))}</text></svg>`,
  );
  layers.push({ input: bar, top: H, left: 0 });
  return sharp({ create: { width: W, height: H + 28, channels: 3, background: '#3a3f4f' } })
    .composite(layers)
    .png()
    .toBuffer();
}

async function sheet(only?: string) {
  const candidates = await loadCandidates();
  const tiles: Buffer[] = [];
  if (only) {
    // Una riga per annuncio, con i primi 6 candidati: "sheet l-004,l-005"
    for (const id of only.split(',')) {
      const list = candidates[id] ?? [];
      for (let i = 0; i < 6; i++) {
        const c = list[i];
        const buf = c ? await original(c).catch((e) => (console.error(`  ${id} #${i}: ${e.message}`), null)) : null;
        tiles.push(await tile(buf, c ? `${id} #${i} ${c.source}` : `${id} #${i} —`));
      }
    }
  } else {
    for (const l of LISTINGS) {
      if (!candidates[l.id]) continue;
      const c = chosen(candidates, l.id);
      const buf = c ? await original(c).catch((e) => (console.error(`  ${l.id}: ${e.message}`), null)) : null;
      tiles.push(await tile(buf, `${l.id} ${l.title}`));
    }
  }
  const cols = 6;
  const rows = Math.ceil(tiles.length / cols);
  const out = new URL(only ? `sheet-${only.split(',')[0]}.jpg` : 'sheet.jpg', CACHE);
  await sharp({ create: { width: cols * 300, height: rows * 253, channels: 3, background: '#000000' } })
    .composite(tiles.map((input, i) => ({ input, left: (i % cols) * 300, top: Math.floor(i / cols) * 253 })))
    .jpeg({ quality: 70 })
    .toFile(out.pathname);
  console.log(`Foglio provini: ${decodeURIComponent(out.pathname)}`);
}

function licenseLabel(c: Candidate): string {
  if (c.license === 'cc0') return 'CC0';
  if (c.license === 'pdm') return 'Pubblico dominio';
  return `CC ${c.license.toUpperCase()}${c.license_version ? ` ${c.license_version}` : ''}`;
}

async function build() {
  const candidates = await loadCandidates();
  await mkdir(OUT, { recursive: true });
  const photos: Record<string, unknown> = {};
  const used = new Map<string, string>();
  for (const l of LISTINGS) {
    if (!candidates[l.id]) continue;
    const c = chosen(candidates, l.id);
    if (!c) {
      console.error(`  ${l.id}: nessun candidato scelto`);
      continue;
    }
    if (used.has(c.id)) console.error(`  ${l.id}: stessa foto di ${used.get(c.id)}`);
    used.set(c.id, l.id);
    const buf = await original(c);
    const large = await sharp(buf)
      .rotate()
      .resize(1280, 960, { fit: 'cover', position: 'attention', withoutEnlargement: true })
      .webp({ quality: 72 })
      .toFile(new URL(`${l.id}.webp`, OUT).pathname);
    await sharp(buf)
      .rotate()
      .resize(480, 360, { fit: 'cover', position: 'attention' })
      .webp({ quality: 70 })
      .toFile(new URL(`${l.id}-sm.webp`, OUT).pathname);
    photos[l.id] = {
      src: `/foto/${l.id}.webp`,
      srcSmall: `/foto/${l.id}-sm.webp`,
      width: large.width,
      height: large.height,
      credit: {
        author: c.creator,
        authorUrl: c.creator_url,
        license: licenseLabel(c),
        licenseUrl: c.license_url,
        source: c.source,
        sourceUrl: c.foreign_landing_url,
      },
    };
    console.log(`  ${l.id} ✓ ${large.width}×${large.height} · ${licenseLabel(c)} · ${c.creator ?? 'autore sconosciuto'}`);
  }
  const file = [
    '// Generato da scripts/fetch-photos.ts: foto di esempio da Openverse. Non modificare a mano.',
    "import type { Photo } from '../core/types.ts';",
    '',
    `export const PHOTOS: Record<string, Photo> = ${JSON.stringify(photos, null, 2)};`,
    '',
  ].join('\n');
  await writeFile(new URL('src/data/photos.ts', ROOT), file);
  console.log(`Scritte ${Object.keys(photos).length} foto in public/foto e src/data/photos.ts`);
}

await mkdir(ORIG, { recursive: true });
const [cmd, arg] = process.argv.slice(2);

if (cmd === 'search') {
  // Rifà le ricerche mancanti o vuote; con --force tutte; con "l-019,l-024" solo quelle.
  const redo = arg && arg !== '--force' ? new Set(arg.split(',')) : null;
  const out: Record<string, Candidate[]> = arg === '--force' ? {} : await loadCandidates().catch(() => ({}));
  for (const [id, query] of Object.entries(QUERIES)) {
    if (redo ? !redo.has(id) : out[id]?.length) continue;
    out[id] = await search(query);
    console.log(`  ${id} "${query}": ${out[id].length} candidati`);
    await writeFile(CANDIDATES_FILE, JSON.stringify(out, null, 2));
    await sleep(1500);
  }
  const empty = Object.keys(QUERIES).filter((id) => !out[id]?.length);
  console.log(empty.length ? `Senza candidati: ${empty.join(', ')}` : 'Tutti gli annunci hanno candidati.');
} else if (cmd === 'sheet') {
  await sheet(arg);
} else if (cmd === 'build') {
  await build();
} else {
  console.log('Uso: node scripts/fetch-photos.ts search | sheet [id] | build');
}
