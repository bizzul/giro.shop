-- giro.shop · scadenza degli annunci, segnalazioni e moderazione

-- Scadenza: un promemoria qualche giorno prima, poi lo stato "scaduto" (lo mette il server)
alter table public.listings add column expiry_notified_at timestamptz;

-- Date automatiche, aggiornate: tornando in vendita la scadenza riparte da 90 giorni,
-- e nessuno può spostarla più in là di 90 giorni da oggi
create or replace function public.set_listing_dates()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'pubblicato' and new.published_at is null then
    new.published_at := now();
  end if;
  if new.status = 'pubblicato'
     and (new.expires_at is null or (tg_op = 'UPDATE' and old.status not in ('pubblicato', 'in_trattativa'))) then
    new.expires_at := now() + interval '90 days';
    new.expiry_notified_at := null;
  end if;
  if new.expires_at is not null and new.expires_at > now() + interval '90 days 1 hour' then
    new.expires_at := now() + interval '90 days';
  end if;
  if new.status = 'venduto' and new.sold_at is null then
    new.sold_at := now();
  end if;
  return new;
end;
$$;

-- Moderazione: chi modera lo decide il database (nessuno può darsi il ruolo da solo)
alter table public.profiles add column is_moderator boolean not null default false;

-- Contenuti nascosti: dopo troppe segnalazioni o per decisione di chi modera
alter table public.listings add column hidden_at timestamptz, add column hidden_reason text;
alter table public.questions add column hidden_at timestamptz;
alter table public.ratings add column hidden_at timestamptz;

-- Chi vende non può togliere da solo un "nascosto" (lo fa solo il server, per conto di chi modera)
create function public.protect_hidden() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select auth.role()) in ('anon', 'authenticated') then
    new.hidden_at := old.hidden_at;
    new.hidden_reason := old.hidden_reason;
  end if;
  return new;
end $$;
create trigger listings_protect_hidden before update on public.listings
  for each row execute function public.protect_hidden();

drop policy "annunci pubblici e venduti visibili a tutti, il resto solo a chi vende" on public.listings;
create policy "annunci pubblici e venduti visibili a tutti se non nascosti, il resto solo a chi vende" on public.listings
  for select using (
    (status in ('pubblicato', 'in_trattativa', 'venduto') and hidden_at is null) or (select auth.uid()) = seller_id
  );

drop policy "domande visibili se l'annuncio è visibile" on public.questions;
create policy "domande visibili se l'annuncio è visibile e non sono nascoste" on public.questions
  for select using (hidden_at is null and exists (select 1 from public.listings l where l.id = listing_id));

drop policy "valutazioni visibili a tutti" on public.ratings;
create policy "valutazioni visibili a tutti se non nascoste" on public.ratings for select using (hidden_at is null);

-- Le valutazioni nascoste non contano nella media di chi vende
create or replace function public.seller_stats(seller uuid)
returns table (
  member_since timestamptz,
  phone_verified boolean,
  sold integer,
  conversations integer,
  answered integer,
  median_reply_minutes integer,
  rating_avg numeric,
  rating_count integer
)
language sql stable security definer set search_path = '' as $$
  with firsts as (
    select
      (select min(m.created_at) from public.messages m where m.conversation_id = c.id and m.sender_id = c.buyer_id) as asked_at,
      (select min(m.created_at) from public.messages m where m.conversation_id = c.id and m.sender_id = c.seller_id) as first_reply
    from public.conversations c
    where c.seller_id = seller
  ),
  replies as (
    select asked_at, case when first_reply >= asked_at then first_reply end as replied_at from firsts where asked_at is not null
  )
  select
    p.created_at,
    p.phone_verified_at is not null,
    (select count(*)::int from public.listings l where l.seller_id = seller and l.status = 'venduto'),
    (select count(*)::int from replies),
    (select count(*)::int from replies where replied_at is not null),
    (select (percentile_cont(0.5) within group (order by extract(epoch from replied_at - asked_at) / 60))::int from replies where replied_at is not null),
    (select round(avg(r.stars)::numeric, 1) from public.ratings r where r.rated_id = seller and r.hidden_at is null),
    (select count(*)::int from public.ratings r where r.rated_id = seller and r.hidden_at is null)
  from public.profiles p
  where p.id = seller
$$;

-- Segnalazioni: una per persona e per contenuto (annuncio, domanda o valutazione)
create type public.report_reason as enum ('truffa', 'vietato', 'offensivo', 'falso', 'spam', 'altro');
create type public.report_status as enum ('aperta', 'accolta', 'respinta');
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  -- L'annuncio c'è sempre: è il contenuto segnalato o il posto dove si trova la domanda o la valutazione
  listing_id text not null references public.listings (id) on delete cascade,
  question_id uuid references public.questions (id) on delete cascade,
  rating_id uuid references public.ratings (id) on delete cascade,
  target text generated always as (
    coalesce('domanda:' || question_id::text, 'valutazione:' || rating_id::text, 'annuncio:' || listing_id)
  ) stored,
  reason public.report_reason not null,
  note text check (char_length(note) <= 500),
  status public.report_status not null default 'aperta',
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  unique (reporter_id, target),
  check (num_nonnulls(question_id, rating_id) <= 1)
);
create index reports_open_idx on public.reports (target) where status = 'aperta';
alter table public.reports enable row level security;
create policy "ognuno vede le proprie segnalazioni" on public.reports
  for select using ((select auth.uid()) = reporter_id);
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
    and (rating_id is null or exists (select 1 from public.ratings r where r.id = rating_id))
  );

-- Troppe segnalazioni da persone diverse: il contenuto si nasconde finché chi modera non decide
create function public.hide_after_reports() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  reporters integer;
begin
  select count(distinct reporter_id) into reporters from public.reports where target = new.target and status = 'aperta';
  if new.question_id is not null and reporters >= 2 then
    update public.questions set hidden_at = now() where id = new.question_id and hidden_at is null;
  elsif new.rating_id is not null and reporters >= 2 then
    update public.ratings set hidden_at = now() where id = new.rating_id and hidden_at is null;
  elsif new.question_id is null and new.rating_id is null and reporters >= 3 then
    update public.listings set hidden_at = now(), hidden_reason = 'segnalazioni' where id = new.listing_id and hidden_at is null;
  end if;
  return null;
end $$;
create trigger reports_hide after insert on public.reports
  for each row execute function public.hide_after_reports();

grant select, insert on public.reports to authenticated;
grant select, insert, update, delete on public.reports to service_role;
