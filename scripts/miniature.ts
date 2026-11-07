/**
 * Miniature per le foto caricate prima che ci fossero (src/lib/photo-store.ts): per ogni foto senza small_path
 * scarica la foto intera, crea <nome>-sm.webp accanto e aggiorna la riga (miniatura, larghezza e altezza vere).
 * Le foto di esempio (/foto/...) hanno già la loro versione piccola. Si può rilanciare: rifà solo quelle che mancano.
 * Dopo, il sito le mostra al prossimo aggiornamento degli annunci in memoria (o riavviandolo).
 * Uso: pnpm foto:miniature   (legge .env: indirizzo di Supabase e chiave segreta)
 */
import { createClient } from '@supabase/supabase-js';
import { CACHE, makeThumbnail, smallPathFor } from '../src/lib/photo-store.ts';

const url = process.env.SUPABASE_INTERNAL_URL || process.env.PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error('Servono PUBLIC_SUPABASE_URL (o SUPABASE_INTERNAL_URL) e SUPABASE_SECRET_KEY nel .env');
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: rows, error } = await admin.from('listing_photos').select('id, storage_path').is('small_path', null).not('storage_path', 'like', '/%');
if (error) {
  console.error(`Foto non lette: ${error.message}`);
  process.exit(1);
}

let done = 0;
let failed = 0;
for (const row of rows ?? []) {
  try {
    const { data: file, error: downloadError } = await admin.storage.from('foto').download(row.storage_path);
    if (downloadError || !file) throw new Error(downloadError?.message ?? 'non trovata');
    const thumb = await makeThumbnail(await file.arrayBuffer());
    const small = smallPathFor(row.storage_path);
    const { error: uploadError } = await admin.storage.from('foto').upload(small, thumb.bytes, { contentType: 'image/webp', upsert: true, cacheControl: CACHE });
    if (uploadError) throw new Error(uploadError.message);
    const { error: rowError } = await admin
      .from('listing_photos')
      .update({ small_path: small, width: thumb.width || null, height: thumb.height || null })
      .eq('id', row.id);
    if (rowError) throw new Error(rowError.message);
    done++;
    console.log(`✓ ${small} (${Math.round(file.size / 1024)} KB → ${Math.round(thumb.bytes.length / 1024)} KB)`);
  } catch (e) {
    failed++;
    console.warn(`✗ ${row.storage_path}: ${(e as Error).message}`);
  }
}
console.log(`Miniature create: ${done} su ${rows?.length ?? 0} foto${failed ? `, non riuscite: ${failed}` : ''}.`);
if (failed) process.exit(1);
