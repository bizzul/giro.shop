-- giro.shop · il "nascosto" lo protegge l'utente che scrive davvero (current_user), non il ruolo della richiesta:
-- così il trigger delle segnalazioni (che gira come proprietario) può nascondere, chi vende no
create or replace function public.protect_hidden() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated') then
    new.hidden_at := old.hidden_at;
    new.hidden_reason := old.hidden_reason;
  end if;
  return new;
end $$;

-- Una valutazione si segnala dall'annuncio a cui appartiene
drop policy "si segnala a proprio nome contenuti visibili, non i propri annunci" on public.reports;
create policy "si segnala a proprio nome contenuti visibili, non i propri annunci" on public.reports
  for insert with check (
    (select auth.uid()) = reporter_id
    and status = 'aperta'
    and exists (
      select 1 from public.listings l
      where l.id = listing_id and l.hidden_at is null and l.status in ('pubblicato', 'in_trattativa', 'venduto')
        and (question_id is not null or rating_id is not null or l.seller_id <> (select auth.uid()))
    )
    and (question_id is null or exists (select 1 from public.questions q where q.id = question_id and q.listing_id = reports.listing_id))
    and (rating_id is null or exists (select 1 from public.ratings r where r.id = rating_id and r.listing_id = reports.listing_id))
  );
