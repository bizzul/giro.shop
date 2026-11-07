-- Ricerche contate, anonime: per "Si cerca in Ticino" e Cercasi.
-- Si conta solo l'oggetto riconosciuto ("bici da corsa"), per zona e giorno: niente persona, niente indirizzo IP,
-- niente frase intera. Le righe vecchie (oltre 60 giorni) le toglie la manutenzione.

create table public.search_counts (
  term text not null check (char_length(term) between 2 and 60),
  label text not null check (char_length(label) between 2 and 60),
  district text not null default '',
  day date not null,
  n integer not null default 0 check (n >= 0),
  primary key (term, district, day)
);

alter table public.search_counts enable row level security;
grant select, insert, update, delete on public.search_counts to service_role;

-- Una ricerca in più (la chiama solo il server)
create function public.count_search(p_term text, p_label text, p_district text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.search_counts (term, label, district, day, n)
  values (p_term, p_label, coalesce(p_district, ''), (now() at time zone 'Europe/Zurich')::date, 1)
  on conflict (term, district, day) do update set n = public.search_counts.n + 1, label = excluded.label;
$$;

revoke execute on function public.count_search(text, text, text) from public, anon, authenticated;
grant execute on function public.count_search(text, text, text) to service_role;
