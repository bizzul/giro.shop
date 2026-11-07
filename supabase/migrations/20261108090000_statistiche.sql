-- Statistiche per chi vende: visite per giorno (senza sapere chi guarda), salvataggi, contatti, domande

create table public.listing_views (
  listing_id text not null references public.listings (id) on delete cascade,
  day date not null,
  views integer not null default 0 check (views >= 0),
  primary key (listing_id, day)
);

-- Nessuna policy: nessuno legge o scrive direttamente. Si conta con count_listing_view (solo il server)
-- e chi vende vede i propri numeri con my_listing_stats.
alter table public.listing_views enable row level security;

-- Una visita a un annuncio in vendita. La chiama il server, che non conta chi vende.
create function public.count_listing_view(p_listing_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.listings l
    where l.id = p_listing_id and l.status in ('pubblicato', 'in_trattativa') and l.hidden_at is null
  ) then
    return;
  end if;
  insert into public.listing_views (listing_id, day, views)
  values (p_listing_id, (now() at time zone 'Europe/Zurich')::date, 1)
  on conflict (listing_id, day) do update set views = public.listing_views.views + 1;
end;
$$;

revoke execute on function public.count_listing_view(text) from public, anon, authenticated;
grant execute on function public.count_listing_view(text) to service_role;

-- I numeri dei propri annunci: visite (in tutto e negli ultimi 7 giorni), salvati, contatti, domande.
-- Nessun nome: chi ha salvato o guardato resta anonimo.
create function public.my_listing_stats()
returns table (
  listing_id text,
  views_total bigint,
  views_week bigint,
  saves bigint,
  contacts bigint,
  questions bigint,
  last_contact_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    l.id,
    coalesce((select sum(v.views) from public.listing_views v where v.listing_id = l.id), 0)::bigint,
    coalesce((
      select sum(v.views) from public.listing_views v
      where v.listing_id = l.id and v.day > (now() at time zone 'Europe/Zurich')::date - 7
    ), 0)::bigint,
    (select count(*) from public.favorites f where f.listing_id = l.id),
    (select count(*) from public.conversations c where c.listing_id = l.id),
    (select count(*) from public.questions q where q.listing_id = l.id),
    (select max(c.created_at) from public.conversations c where c.listing_id = l.id)
  from public.listings l
  where l.seller_id = (select auth.uid());
$$;

revoke execute on function public.my_listing_stats() from public, anon;
grant execute on function public.my_listing_stats() to authenticated, service_role;

grant select, insert, update, delete on public.listing_views to service_role;
