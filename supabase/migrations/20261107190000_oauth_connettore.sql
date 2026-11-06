-- Accesso con OAuth 2.1 per il connettore AI (MCP): Claude e altri assistenti agiscono a nome di una persona
-- (salvare ricerche, pubblicare annunci) dopo che lei ha detto sì nella pagina di consenso.
-- Le tabelle le legge e scrive solo il server; dei codici e dei token si tiene solo l'impronta (SHA-256).

create table public.oauth_clients (
  id text primary key,
  -- Solo per i client "confidenziali"; i client pubblici usano PKCE senza segreto
  secret_hash text,
  name text not null check (char_length(name) between 1 and 100),
  uri text,
  redirect_uris text[] not null check (cardinality(redirect_uris) between 1 and 10),
  created_at timestamptz not null default now()
);

create table public.oauth_codes (
  code_hash text primary key,
  client_id text not null references public.oauth_clients (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  scopes text[] not null,
  resource text not null,
  expires_at timestamptz not null,
  used_at timestamptz
);

create table public.oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.oauth_clients (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  access_hash text not null unique,
  refresh_hash text unique,
  scopes text[] not null,
  resource text not null,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index oauth_tokens_user_idx on public.oauth_tokens (user_id) where revoked_at is null;

alter table public.oauth_clients enable row level security;
alter table public.oauth_codes enable row level security;
alter table public.oauth_tokens enable row level security;
revoke all on public.oauth_clients, public.oauth_codes, public.oauth_tokens from anon, authenticated;
grant select, insert, update, delete on public.oauth_clients, public.oauth_codes, public.oauth_tokens to service_role;
