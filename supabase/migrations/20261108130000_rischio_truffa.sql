-- Rischio truffa degli annunci: punteggio e motivi calcolati dal server a ogni pubblicazione o modifica.
-- Li leggono solo il server e la pagina di moderazione (con la chiave di servizio): nessuna policy.

create table public.listing_risk (
  listing_id text primary key references public.listings (id) on delete cascade,
  score real not null check (score between 0 and 1),
  signals text[] not null default '{}',
  reasons text[] not null default '{}',
  checked_at timestamptz not null default now(),
  -- Chi modera l'ha guardato e va bene (vale finché il punteggio non sale)
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_score real
);

create index listing_risk_open_idx on public.listing_risk (score desc) where reviewed_at is null;

alter table public.listing_risk enable row level security;
grant select, insert, update, delete on public.listing_risk to service_role;
