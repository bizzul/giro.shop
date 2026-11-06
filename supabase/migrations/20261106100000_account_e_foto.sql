-- Piazza · account, foto e date automatiche

-- Il profilo nasce con l'account: nome da metadati o dalla parte prima della @
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Date di pubblicazione, scadenza (90 giorni) e vendita impostate dal database
create function public.set_listing_dates()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'pubblicato' and new.published_at is null then
    new.published_at := now();
  end if;
  if new.status = 'pubblicato' and new.expires_at is null then
    new.expires_at := now() + interval '90 days';
  end if;
  if new.status = 'venduto' and new.sold_at is null then
    new.sold_at := now();
  end if;
  return new;
end;
$$;

create trigger listings_dates
  before insert or update on public.listings
  for each row execute function public.set_listing_dates();

-- Foto: crediti (obbligatori per le foto di esempio CC BY) e misure
alter table public.listing_photos
  add column credit jsonb,
  add column width integer,
  add column height integer;

-- Gli annunci venduti restano leggibili: mostrano "venduto" e migliorano le stime di prezzo
drop policy "annunci pubblici visibili a tutti, bozze solo a chi vende" on public.listings;
create policy "annunci pubblici e venduti visibili a tutti, il resto solo a chi vende" on public.listings
  for select using (status in ('pubblicato', 'in_trattativa', 'venduto') or (select auth.uid()) = seller_id);

-- Bucket pubblico per le foto degli annunci: ognuno scrive solo nella propria cartella (id utente)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('foto', 'foto', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create policy "foto: ognuno carica nella propria cartella" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'foto' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "foto: ognuno cancella dalla propria cartella" on storage.objects
  for delete to authenticated
  using (bucket_id = 'foto' and (storage.foldername(name))[1] = (select auth.uid())::text);
