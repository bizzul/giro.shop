-- Assistente venditore: risponde alle domande ripetitive, scarta le offerte sotto il minimo, propone orari di ritiro.
-- Accettare resta sempre una decisione di chi vende. Impostazioni private, fuori dal profilo (che è pubblico).

create table public.seller_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  assistant_on boolean not null default false,
  -- Quando di solito si può ritirare (chiavi di core/pickup.ts: sab-mattina, sere, ...)
  availability text[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.seller_settings enable row level security;

create policy "ognuno vede le proprie impostazioni di vendita" on public.seller_settings
  for select using (user_id = (select auth.uid()));
create policy "ognuno crea le proprie impostazioni di vendita" on public.seller_settings
  for insert with check (user_id = (select auth.uid()));
create policy "ognuno cambia le proprie impostazioni di vendita" on public.seller_settings
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select, insert on public.seller_settings to authenticated;
grant update (assistant_on, availability, updated_at) on public.seller_settings to authenticated;
grant select, insert, update, delete on public.seller_settings to service_role;
