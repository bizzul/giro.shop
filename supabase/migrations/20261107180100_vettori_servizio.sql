-- I vettori della ricerca per significato li legge e scrive solo il server (chiave di servizio)
grant select, insert, update, delete on public.listing_embeddings to service_role;
