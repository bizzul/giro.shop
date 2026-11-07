-- Miniature delle foto caricate: <cartella>/<nome>-sm.webp, larga 480 px, accanto alla foto intera (src/lib/photo-store.ts).
-- Le schede degli elenchi usano la miniatura; vuota (foto vecchie, miniatura non riuscita) = la foto intera.
-- Le foto già caricate prima di questa colonna: pnpm foto:miniature
alter table public.listing_photos
  add column small_path text;

comment on column public.listing_photos.small_path is 'Miniatura WebP da 480 px nello Storage «foto», per le schede degli elenchi; null = si usa storage_path';
