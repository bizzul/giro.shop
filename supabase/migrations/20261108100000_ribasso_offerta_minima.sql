-- Impostazioni private di chi vende, per annuncio: ribasso automatico e offerta minima.
-- Stanno fuori da listings perché quella tabella è leggibile da tutti: il prezzo minimo non lo deve vedere nessuno.

create table public.listing_settings (
  listing_id text primary key references public.listings (id) on delete cascade,
  seller_id uuid not null references public.profiles (id) on delete cascade,
  -- Ribasso automatico: -drop_pct% ogni drop_every_days giorni, mai sotto drop_floor_chf
  drop_pct smallint check (drop_pct between 1 and 50),
  drop_every_days smallint check (drop_every_days between 1 and 90),
  drop_floor_chf numeric(10, 2) check (drop_floor_chf >= 0),
  -- Da quando vale la regola attuale (il primo ribasso arriva dopo drop_every_days da qui) e l'ultimo ribasso
  drop_from timestamptz,
  drop_last_at timestamptz,
  -- Offerte sotto questa cifra le scarta l'assistente venditore (se acceso)
  min_offer_chf numeric(10, 2) check (min_offer_chf >= 0),
  -- Quando abbiamo suggerito di rivedere il prezzo (una volta sola per annuncio)
  price_tip_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((drop_pct is null) = (drop_every_days is null) and (drop_pct is null) = (drop_floor_chf is null))
);

alter table public.listing_settings enable row level security;

create policy "chi vende vede le impostazioni dei propri annunci" on public.listing_settings
  for select using (seller_id = (select auth.uid()));

create policy "chi vende imposta i propri annunci" on public.listing_settings
  for insert with check (
    seller_id = (select auth.uid())
    and exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = (select auth.uid()))
  );

create policy "chi vende cambia le impostazioni dei propri annunci" on public.listing_settings
  for update using (seller_id = (select auth.uid())) with check (seller_id = (select auth.uid()));

create policy "chi vende toglie le impostazioni dei propri annunci" on public.listing_settings
  for delete using (seller_id = (select auth.uid()));

grant select, insert, delete on public.listing_settings to authenticated;
grant update (drop_pct, drop_every_days, drop_floor_chf, drop_from, min_offer_chf, updated_at) on public.listing_settings to authenticated;
grant select, insert, update, delete on public.listing_settings to service_role;

-- Avvisi per chi vende: ribasso fatto, prezzo da rivedere, "l'hai venduto?"
alter type public.notification_kind add value if not exists 'consiglio';
