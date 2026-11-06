-- Ricerca per significato: un vettore per annuncio, calcolato dal server con un modello locale (EmbeddingGemma, 768 dimensioni).
-- I vettori stanno in una tabella che solo il server legge e scrive: chi vende non li può truccare
-- per far comparire il proprio annuncio in ricerche che non c'entrano.
-- La vecchia colonna listings.embedding (1024 dimensioni, mai usata, scrivibile da chi vende) se ne va.

drop index if exists public.listings_embedding_idx;
alter table public.listings drop column if exists embedding;

create table public.listing_embeddings (
  listing_id text primary key references public.listings (id) on delete cascade,
  -- Modello e testo da cui viene il vettore: se cambiano, il server lo ricalcola
  model text not null,
  source_hash text not null,
  embedding extensions.vector(768) not null,
  updated_at timestamptz not null default now()
);

alter table public.listing_embeddings enable row level security;
-- Nessuna regola per anon e authenticated: niente accesso dal browser, solo la chiave di servizio
revoke all on public.listing_embeddings from anon, authenticated;
