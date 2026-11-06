-- Piazza · schema iniziale
-- Annunci strutturati (non testo libero), comuni con coordinate, foto, avvisi
-- e registro delle azioni fatte dagli agenti MCP.

create extension if not exists vector with schema extensions;

create type public.listing_condition as enum ('nuovo', 'come_nuovo', 'buono', 'usato', 'da_riparare');
create type public.listing_status as enum ('bozza', 'pubblicato', 'in_trattativa', 'venduto', 'archiviato');

-- Comuni ticinesi. Nella Fase 1 si caricano dall'elenco ufficiale con coordinate swisstopo.
create table public.comuni (
  id text primary key,
  name text not null,
  cap text not null,
  district text not null check (
    district in ('Bellinzona', 'Blenio', 'Leventina', 'Locarno', 'Lugano', 'Mendrisio', 'Riviera', 'Vallemaggia')
  ),
  lat double precision not null,
  lon double precision not null,
  aliases text[] not null default '{}'
);

create table public.categories (
  id text primary key,
  name text not null,
  parent_id text references public.categories (id),
  -- Attributi previsti per la categoria, es. [{"name": "taglia"}, {"name": "ruote"}]
  attributes jsonb not null default '[]'::jsonb
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  phone_verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.listings (
  -- Testo: gli annunci di prova tengono id leggibili (l-001), i nuovi ricevono un UUID
  id text primary key default gen_random_uuid()::text,
  seller_id uuid references public.profiles (id) on delete cascade,
  status public.listing_status not null default 'bozza',
  title text not null check (char_length(title) between 3 and 80),
  description text not null default '',
  category_id text not null references public.categories (id),
  tags text[] not null default '{}',
  attributes jsonb not null default '{}'::jsonb,
  price_chf numeric(10, 2) not null check (price_chf >= 0),
  -- Prezzo come scritto da chi vende, se in un'altra valuta: {"amount": 4000, "currency": "EUR"}
  price_original jsonb,
  negotiable boolean not null default false,
  condition public.listing_condition not null,
  comune_id text not null references public.comuni (id),
  -- Chi ha scritto la bozza: Claude, regole semplici o la persona
  ai_source text check (ai_source in ('claude', 'regole', 'manuale')),
  ai_model text,
  ai_confidence real check (ai_confidence between 0 and 1),
  -- Embedding multilingue per la ricerca per significato e "trova simili"
  embedding extensions.vector(1024),
  search_text tsvector generated always as (to_tsvector('italian', title || ' ' || description)) stored,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  expires_at timestamptz,
  sold_at timestamptz,
  sold_price_chf numeric(10, 2) check (sold_price_chf >= 0)
);

create table public.listing_photos (
  id uuid primary key default gen_random_uuid(),
  listing_id text not null references public.listings (id) on delete cascade,
  storage_path text not null,
  position smallint not null default 0,
  ai_caption text,
  created_at timestamptz not null default now()
);

-- Ricerche salvate: notifica quando arriva un annuncio compatibile
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  query text not null,
  filters jsonb not null,
  created_at timestamptz not null default now(),
  last_notified_at timestamptz
);

-- Ogni azione fatta da un assistente AI tramite MCP, con l'eventuale conferma della persona
create table public.agent_actions (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles (id) on delete set null,
  client_name text,
  tool text not null,
  input jsonb not null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create index listings_status_published_idx on public.listings (status, published_at desc);
create index listings_category_idx on public.listings (category_id) where status = 'pubblicato';
create index listings_comune_idx on public.listings (comune_id);
create index listings_price_idx on public.listings (price_chf);
create index listings_seller_idx on public.listings (seller_id);
create index listings_tags_idx on public.listings using gin (tags);
create index listings_search_idx on public.listings using gin (search_text);
create index listings_embedding_idx on public.listings using hnsw (embedding extensions.vector_cosine_ops);
create index listing_photos_listing_idx on public.listing_photos (listing_id, position);
create index alerts_user_idx on public.alerts (user_id);
create index agent_actions_user_idx on public.agent_actions (user_id, created_at desc);

-- Accessi (Row Level Security)
alter table public.comuni enable row level security;
create policy "comuni leggibili da tutti" on public.comuni for select using (true);

alter table public.categories enable row level security;
create policy "categorie leggibili da tutti" on public.categories for select using (true);

alter table public.profiles enable row level security;
create policy "profili leggibili da tutti" on public.profiles for select using (true);
create policy "ognuno modifica il proprio profilo" on public.profiles
  for update using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

alter table public.listings enable row level security;
create policy "annunci pubblici visibili a tutti, bozze solo a chi vende" on public.listings
  for select using (status in ('pubblicato', 'in_trattativa') or (select auth.uid()) = seller_id);
create policy "chi vende crea i propri annunci" on public.listings
  for insert with check ((select auth.uid()) = seller_id);
create policy "chi vende modifica i propri annunci" on public.listings
  for update using ((select auth.uid()) = seller_id) with check ((select auth.uid()) = seller_id);
create policy "chi vende cancella i propri annunci" on public.listings
  for delete using ((select auth.uid()) = seller_id);

alter table public.listing_photos enable row level security;
create policy "foto visibili se l'annuncio è visibile" on public.listing_photos
  for select using (exists (select 1 from public.listings l where l.id = listing_id));
create policy "foto gestite da chi vende" on public.listing_photos
  for all
  using (exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = (select auth.uid())))
  with check (exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = (select auth.uid())));

alter table public.alerts enable row level security;
create policy "ognuno vede e gestisce i propri avvisi" on public.alerts
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

alter table public.agent_actions enable row level security;
create policy "ognuno vede le azioni fatte per suo conto" on public.agent_actions
  for select using ((select auth.uid()) = user_id);
