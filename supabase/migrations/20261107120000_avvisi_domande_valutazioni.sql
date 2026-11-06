-- giro.shop · avvisi, annunci salvati, storico prezzi, domande pubbliche, valutazioni,
-- spedizione, punti chiave e traduzioni degli annunci

-- Annunci: spedizione, a chi è stato venduto, punti chiave scritti da Claude
alter table public.listings
  add column shipping boolean not null default false,
  add column shipping_chf numeric(8, 2) check (shipping_chf >= 0),
  add column buyer_id uuid references public.profiles (id) on delete set null,
  add column highlights text[] not null default '{}';

-- Chi compra dev'essere qualcuno che ha scritto per quell'annuncio; rimesso in vendita, si azzera
create function public.check_listing_buyer() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'venduto' then
    new.buyer_id := null;
  elsif new.buyer_id is not null and new.buyer_id is distinct from old.buyer_id then
    if not exists (select 1 from public.conversations c where c.listing_id = new.id and c.buyer_id = new.buyer_id) then
      raise exception 'Chi compra deve aver scritto per questo annuncio' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger listings_check_buyer before update on public.listings
  for each row execute function public.check_listing_buyer();

-- Storico dei prezzi: una riga alla pubblicazione e una a ogni cambio di prezzo
create table public.price_history (
  id bigint generated always as identity primary key,
  listing_id text not null references public.listings (id) on delete cascade,
  price_chf numeric(10, 2) not null,
  changed_at timestamptz not null default now()
);
create index price_history_listing_idx on public.price_history (listing_id, changed_at);

create function public.record_price() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.price_chf is distinct from old.price_chf then
    insert into public.price_history (listing_id, price_chf, changed_at)
    values (new.id, new.price_chf, case when tg_op = 'INSERT' then coalesce(new.published_at, now()) else now() end);
  end if;
  return new;
end $$;
create trigger listings_record_price after insert or update of price_chf on public.listings
  for each row execute function public.record_price();

insert into public.price_history (listing_id, price_chf, changed_at)
select id, price_chf, coalesce(published_at, created_at) from public.listings;

alter table public.price_history enable row level security;
create policy "storico visibile se l'annuncio è visibile" on public.price_history
  for select using (exists (select 1 from public.listings l where l.id = listing_id));

-- Annunci salvati (cuore)
create table public.favorites (
  user_id uuid not null references public.profiles (id) on delete cascade,
  listing_id text not null references public.listings (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);
create index favorites_listing_idx on public.favorites (listing_id);
alter table public.favorites enable row level security;
create policy "ognuno vede e gestisce i propri salvati" on public.favorites
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Quante persone hanno salvato un annuncio, senza dire chi
create function public.favorite_count(listing text) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.favorites where listing_id = listing
$$;

-- Avvisi: li scrive solo il server (ricerche salvate, prezzi, domande, valutazioni)
create type public.notification_kind as enum ('ricerca', 'prezzo', 'venduto', 'domanda', 'risposta', 'valutazione');
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind public.notification_kind not null,
  title text not null,
  body text not null default '',
  url text not null check (url like '/%'),
  listing_id text references public.listings (id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  emailed_at timestamptz
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;
alter table public.notifications enable row level security;
create policy "ognuno vede i propri avvisi" on public.notifications
  for select using ((select auth.uid()) = user_id);
create policy "ognuno segna come letti i propri avvisi" on public.notifications
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "ognuno cancella i propri avvisi" on public.notifications
  for delete using ((select auth.uid()) = user_id);

-- Domande pubbliche sugli annunci, con la risposta di chi vende
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  listing_id text not null references public.listings (id) on delete cascade,
  asker_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 3 and 500),
  answer text check (char_length(btrim(answer)) between 1 and 1000),
  answered_at timestamptz,
  created_at timestamptz not null default now()
);
create index questions_listing_idx on public.questions (listing_id, created_at);
alter table public.questions enable row level security;
create policy "domande visibili se l'annuncio è visibile" on public.questions
  for select using (exists (select 1 from public.listings l where l.id = listing_id));
create policy "si chiede a proprio nome, non sui propri annunci" on public.questions
  for insert with check (
    (select auth.uid()) = asker_id
    and answer is null
    and exists (
      select 1 from public.listings l
      where l.id = listing_id and l.status in ('pubblicato', 'in_trattativa') and l.seller_id <> (select auth.uid())
    )
  );
create policy "risponde chi vende" on public.questions
  for update
  using (exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = (select auth.uid())))
  with check (exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = (select auth.uid())));
create policy "cancella chi ha chiesto o chi vende" on public.questions
  for delete using (
    (select auth.uid()) = asker_id
    or exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = (select auth.uid()))
  );

-- Valutazioni dopo una vendita conclusa: chi compra valuta chi vende e viceversa
create table public.ratings (
  id uuid primary key default gen_random_uuid(),
  listing_id text not null references public.listings (id) on delete cascade,
  rater_id uuid not null references public.profiles (id) on delete cascade,
  rated_id uuid not null references public.profiles (id) on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  tags text[] not null default '{}' check (
    tags <@ array['puntuale', 'come descritto', 'gentile', 'risponde veloce', 'imballato bene', 'pagamento rapido']::text[]
  ),
  comment text check (char_length(comment) <= 500),
  created_at timestamptz not null default now(),
  unique (listing_id, rater_id),
  check (rater_id <> rated_id)
);
create index ratings_rated_idx on public.ratings (rated_id, created_at desc);
alter table public.ratings enable row level security;
create policy "valutazioni visibili a tutti" on public.ratings for select using (true);
create policy "valuta solo chi ha concluso la vendita" on public.ratings
  for insert with check (
    (select auth.uid()) = rater_id
    and exists (
      select 1 from public.listings l
      where l.id = listing_id and l.status = 'venduto' and l.buyer_id is not null
        and ((l.seller_id = rater_id and l.buyer_id = rated_id) or (l.buyer_id = rater_id and l.seller_id = rated_id))
    )
  );

-- Affidabilità di chi vende: solo numeri, nessun contenuto dei messaggi
create function public.seller_stats(seller uuid)
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
    (select round(avg(r.stars)::numeric, 1) from public.ratings r where r.rated_id = seller),
    (select count(*)::int from public.ratings r where r.rated_id = seller)
  from public.profiles p
  where p.id = seller
$$;

-- Traduzioni degli annunci, fatte da Claude e tenute in memoria finché il testo non cambia
create table public.listing_translations (
  listing_id text not null references public.listings (id) on delete cascade,
  lang text not null check (lang in ('de', 'fr', 'en')),
  source_hash text not null,
  title text not null,
  description text not null,
  created_at timestamptz not null default now(),
  primary key (listing_id, lang)
);
alter table public.listing_translations enable row level security;
create policy "traduzioni visibili se l'annuncio è visibile" on public.listing_translations
  for select using (exists (select 1 from public.listings l where l.id = listing_id));

-- Permessi: le tabelle nuove non li ricevono da sole
grant select on public.price_history, public.questions, public.ratings, public.listing_translations to anon, authenticated;
grant select, insert, delete on public.favorites to authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant insert (listing_id, asker_id, body) on public.questions to authenticated;
grant update (answer, answered_at) on public.questions to authenticated;
grant delete on public.questions to authenticated;
grant insert on public.ratings to authenticated;
grant execute on function public.favorite_count(text) to anon, authenticated;
grant execute on function public.seller_stats(uuid) to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on function public.favorite_count(text), public.seller_stats(uuid) to service_role;
