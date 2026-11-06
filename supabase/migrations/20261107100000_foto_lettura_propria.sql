-- Piazza · storage: ognuno vede i file della propria cartella
-- Senza questa regola le API dello storage non trovano i file da cancellare (togliere una foto,
-- eliminare un annuncio) e la cancellazione non fa nulla, in silenzio. Le foto restano comunque
-- pubbliche tramite il loro indirizzo: il bucket "foto" è pubblico.

create policy "foto: ognuno vede i file della propria cartella" on storage.objects
  for select to authenticated
  using (bucket_id = 'foto' and (storage.foldername(name))[1] = (select auth.uid())::text);
