-- Ricavi: pagamenti (per ora solo "di prova"), negozi Pro, vetrina mirata, annunci a pagamento per categoria,
-- partner locali e pagamento protetto tra privati.

-- Avvisi sui pagamenti (pagamento protetto trattenuto, rilasciato, rimborsato)
alter type public.notification_kind add value if not exists 'pagamento';

-- Ogni pagamento, qualunque cosa compri. Li scrive solo il server; ognuno vede i propri,
-- chi vende vede i pagamenti protetti a suo favore.
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('pro', 'vetrina', 'annuncio', 'protetto')),
  amount_chf numeric(10, 2) not null check (amount_chf > 0),
  -- La parte che resta a giro.shop (commissione del pagamento protetto); per gli altri tipi è tutto
  fee_chf numeric(10, 2) not null default 0 check (fee_chf >= 0),
  description text not null check (char_length(description) <= 200),
  status text not null default 'in_attesa'
    check (status in ('in_attesa', 'pagato', 'annullato', 'trattenuto', 'rilasciato', 'rimborsato', 'contestato')),
  provider text not null default 'prova',
  provider_ref text,
  listing_id text references public.listings (id) on delete set null,
  conversation_id uuid references public.conversations (id) on delete set null,
  -- Chi riceve i soldi del pagamento protetto
  payee_id uuid references public.profiles (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now()
);
create index payments_user_idx on public.payments (user_id, created_at desc);
create index payments_listing_idx on public.payments (listing_id) where listing_id is not null;
create index payments_held_idx on public.payments (status) where status in ('trattenuto', 'contestato');
alter table public.payments enable row level security;
create policy "ognuno vede i propri pagamenti e quelli a suo favore" on public.payments
  for select using ((select auth.uid()) in (user_id, payee_id));
grant select on public.payments to authenticated;
grant select, insert, update, delete on public.payments to service_role;

-- Negozi Pro: la pagina venditore diventa la pagina del negozio. Attivo finché active_until è nel futuro
-- (lo decide il server dopo il pagamento); i dati del negozio li scrive chi lo gestisce.
create table public.shops (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 60),
  about text check (char_length(about) <= 600),
  address text check (char_length(address) <= 120),
  website text check (website ~ '^https?://' and char_length(website) <= 200),
  phone text check (char_length(phone) <= 30),
  hours text check (char_length(hours) <= 200),
  active_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.shops enable row level security;
create policy "negozi attivi visibili a tutti, il proprio sempre" on public.shops
  for select using (active_until > now() or user_id = (select auth.uid()));
create policy "ognuno crea il proprio negozio" on public.shops
  for insert with check (user_id = (select auth.uid()) and active_until is null);
create policy "ognuno cambia il proprio negozio" on public.shops
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select on public.shops to anon, authenticated;
grant insert (user_id, name, about, address, website, phone, hours) on public.shops to authenticated;
grant update (name, about, address, website, phone, hours, updated_at) on public.shops to authenticated;
grant select, insert, update, delete on public.shops to service_role;

create function public.is_pro(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.shops s where s.user_id = p_user and s.active_until > now());
$$;
grant execute on function public.is_pro(uuid) to anon, authenticated, service_role;

-- Modifiche in blocco dei negozi Pro ("tutti gli sci -20% fino a domenica"): i prezzi di prima, per tornare indietro
create table public.bulk_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  phrase text not null check (char_length(phrase) <= 200),
  pct numeric(5, 2) not null,
  ends_at timestamptz,
  -- [{ "listing_id": "...", "old": 100, "new": 80 }]
  items jsonb not null,
  created_at timestamptz not null default now(),
  restored_at timestamptz
);
create index bulk_changes_open_idx on public.bulk_changes (ends_at) where ends_at is not null and restored_at is null;
alter table public.bulk_changes enable row level security;
create policy "ognuno vede le proprie modifiche in blocco" on public.bulk_changes
  for select using (user_id = (select auth.uid()));
grant select on public.bulk_changes to authenticated;
grant select, insert, update, delete on public.bulk_changes to service_role;

-- Vetrina mirata: l'annuncio va in cima alle ricerche che gli corrispondono e chi lo cerca riceve un avviso.
-- Pubblica (serve a mostrare «In vetrina»), la scrive solo il server dopo il pagamento.
create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  listing_id text not null references public.listings (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  payment_id uuid references public.payments (id) on delete set null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  notified integer not null default 0,
  created_at timestamptz not null default now()
);
create index promotions_listing_idx on public.promotions (listing_id, ends_at desc);
alter table public.promotions enable row level security;
create policy "le vetrine si vedono" on public.promotions for select using (true);
grant select on public.promotions to anon, authenticated;
grant select, insert, update, delete on public.promotions to service_role;

-- Affitti: categoria nuova, a pagamento come auto e moto
insert into public.categories (id, name) values ('affitti', 'Affitti') on conflict (id) do nothing;

-- Annunci a pagamento: il prezzo della pubblicazione per categoria (uguale a PAID_CATEGORIES in src/core/pricing.ts)
create table public.listing_fees (
  category_id text primary key references public.categories (id),
  price_chf numeric(10, 2) not null check (price_chf > 0)
);
insert into public.listing_fees (category_id, price_chf) values ('auto', 9.90), ('moto_scooter', 4.90), ('affitti', 19.90);
alter table public.listing_fees enable row level security;
create policy "tariffe visibili a tutti" on public.listing_fees for select using (true);
grant select on public.listing_fees to anon, authenticated, service_role;

-- Un annuncio in una categoria a pagamento si pubblica solo se è pagato, o se chi vende ha un negozio Pro.
-- Vale per ogni strada (sito, connettore MCP, accesso diretto al database): è un trigger.
create function public.require_listing_fee() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status not in ('pubblicato', 'in_trattativa') then
    return new;
  end if;
  -- Dal database direttamente (dati di prova, manutenzione): nessun controllo. Dal sito e dal connettore sì.
  if (select auth.role()) is null then
    return new;
  end if;
  if not exists (select 1 from public.listing_fees f where f.category_id = new.category_id) then
    return new;
  end if;
  -- Già pubblicato nella stessa categoria: niente da pagare di nuovo (modifiche, rinnovi, trattativa)
  if tg_op = 'UPDATE' and old.status in ('pubblicato', 'in_trattativa', 'venduto', 'scaduto', 'archiviato')
     and old.category_id = new.category_id then
    return new;
  end if;
  if public.is_pro(new.seller_id) then
    return new;
  end if;
  if exists (
    select 1 from public.payments p
    where p.listing_id = new.id and p.kind = 'annuncio' and p.status = 'pagato'
  ) then
    return new;
  end if;
  raise exception 'La pubblicazione in questa categoria è a pagamento.' using errcode = 'P0001', hint = 'listing_fee';
end;
$$;

create trigger listings_require_fee
  before insert or update of status, category_id on public.listings
  for each row execute function public.require_listing_fee();

-- Partner locali (sgombero, traslochi, trasporto...): pagano per ogni contatto ricevuto.
-- Le richieste per diventare partner nascono spente; le accende chi modera.
create table public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  service text not null check (service in ('sgombero', 'traslochi', 'trasporto', 'riparazioni', 'pulizie')),
  about text check (char_length(about) <= 400),
  districts text[] not null default '{}',
  website text check (website ~ '^https?://' and char_length(website) <= 200),
  phone text check (char_length(phone) <= 30),
  email text not null check (char_length(email) <= 120),
  fee_chf numeric(10, 2) not null default 5 check (fee_chf >= 0),
  active boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.partners enable row level security;
create policy "partner attivi visibili a tutti" on public.partners for select using (active);
grant select (id, name, service, about, districts, website, phone, active) on public.partners to anon, authenticated;
grant select, insert, update, delete on public.partners to service_role;

create table public.partner_leads (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  name text not null check (char_length(name) <= 80),
  contact text not null check (char_length(contact) <= 120),
  message text not null check (char_length(message) <= 1000),
  listing_id text references public.listings (id) on delete set null,
  fee_chf numeric(10, 2) not null default 0,
  created_at timestamptz not null default now(),
  emailed_at timestamptz
);
create index partner_leads_partner_idx on public.partner_leads (partner_id, created_at desc);
alter table public.partner_leads enable row level security;
grant select, insert, update, delete on public.partner_leads to service_role;
