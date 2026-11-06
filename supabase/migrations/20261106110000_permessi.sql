-- Piazza · permessi delle API
-- Le tabelle nuove non sono esposte di default: concediamo solo ciò che serve.
-- Le regole RLS decidono poi quali righe ognuno vede o modifica.

grant select on public.comuni, public.categories, public.profiles, public.listings, public.listing_photos
  to anon, authenticated;

grant insert, update, delete on public.listings, public.listing_photos to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select, insert, update, delete on public.alerts to authenticated;
grant select on public.agent_actions to authenticated;
