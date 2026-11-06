-- giro.shop · segnalare utenti e conversazioni, sospensione degli account,
-- registro delle decisioni di moderazione (dell'agente e delle persone)

-- Segnalazioni: oltre ad annunci, domande e valutazioni, anche utenti e conversazioni private
drop index public.reports_open_idx;
alter table public.reports drop constraint reports_reporter_id_target_key;
alter table public.reports drop constraint reports_check;
alter table public.reports drop column target;
alter table public.reports alter column listing_id drop not null;
alter table public.reports
  add column reported_user_id uuid references public.profiles (id) on delete cascade,
  add column conversation_id uuid references public.conversations (id) on delete cascade,
  -- Quando l'agente di moderazione l'ha esaminata (così non la riesamina a ogni giro)
  add column agent_reviewed_at timestamptz;
alter table public.reports add column target text generated always as (
  coalesce(
    'domanda:' || question_id::text,
    'valutazione:' || rating_id::text,
    'conversazione:' || conversation_id::text,
    'annuncio:' || listing_id,
    'utente:' || reported_user_id::text
  )
) stored;
alter table public.reports add constraint reports_one_per_reporter unique (reporter_id, target);
alter table public.reports add constraint reports_one_target check (
  num_nonnulls(question_id, rating_id, conversation_id) <= 1 and (listing_id is not null or reported_user_id is not null)
);
create index reports_open_idx on public.reports (target) where status = 'aperta';

drop policy "si segnala a proprio nome contenuti visibili, non i propri annunci" on public.reports;
create policy "si segnala a proprio nome: contenuti visibili, utenti, conversazioni di cui si fa parte" on public.reports
  for insert with check (
    (select auth.uid()) = reporter_id
    and status = 'aperta'
    and agent_reviewed_at is null
    and (
      -- Annuncio, domanda o valutazione visibili (non il proprio annuncio)
      (
        conversation_id is null and reported_user_id is null and listing_id is not null
        and exists (
          select 1 from public.listings l
          where l.id = listing_id and l.hidden_at is null and l.status in ('pubblicato', 'in_trattativa', 'venduto')
            and (question_id is not null or rating_id is not null or l.seller_id <> (select auth.uid()))
        )
        and (question_id is null or exists (select 1 from public.questions q where q.id = question_id and q.listing_id = reports.listing_id))
        and (rating_id is null or exists (select 1 from public.ratings r where r.id = rating_id and r.listing_id = reports.listing_id))
      )
      -- Un utente intero (non se stessi)
      or (
        conversation_id is null and listing_id is null and question_id is null and rating_id is null
        and reported_user_id is not null and reported_user_id <> (select auth.uid())
      )
      -- Una conversazione di cui si fa parte: si segnala l'altra persona
      or (
        conversation_id is not null and question_id is null and rating_id is null
        and exists (
          select 1 from public.conversations c
          where c.id = conversation_id and c.listing_id = reports.listing_id
            and (
              (c.buyer_id = (select auth.uid()) and c.seller_id = reported_user_id)
              or (c.seller_id = (select auth.uid()) and c.buyer_id = reported_user_id)
            )
        )
      )
    )
  );

-- Nascondere da soli dopo troppe segnalazioni vale per annunci, domande e valutazioni;
-- utenti e conversazioni li decide sempre qualcuno (l'agente propone, una persona sospende)
create or replace function public.hide_after_reports() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  reporters integer;
begin
  select count(distinct reporter_id) into reporters from public.reports where target = new.target and status = 'aperta';
  if new.question_id is not null and reporters >= 2 then
    update public.questions set hidden_at = now() where id = new.question_id and hidden_at is null;
  elsif new.rating_id is not null and reporters >= 2 then
    update public.ratings set hidden_at = now() where id = new.rating_id and hidden_at is null;
  elsif new.target like 'annuncio:%' and reporters >= 3 then
    update public.listings set hidden_at = now(), hidden_reason = 'segnalazioni' where id = new.listing_id and hidden_at is null;
  end if;
  return null;
end $$;

-- Account sospesi: non pubblicano, non modificano annunci, non scrivono, non chiedono, non valutano
alter table public.profiles add column suspended_at timestamptz, add column suspended_reason text;

create function public.block_suspended() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated')
     and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.suspended_at is not null) then
    raise exception 'Il tuo account è sospeso: non puoi pubblicare né scrivere.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger listings_block_suspended before insert or update on public.listings
  for each row execute function public.block_suspended();
create trigger conversations_block_suspended before insert on public.conversations
  for each row execute function public.block_suspended();
create trigger messages_block_suspended before insert on public.messages
  for each row execute function public.block_suspended();
create trigger questions_block_suspended before insert or update on public.questions
  for each row execute function public.block_suspended();
create trigger ratings_block_suspended before insert on public.ratings
  for each row execute function public.block_suspended();

-- Registro delle decisioni: chi (agente o persona), cosa, perché; si può annullare
create type public.moderation_actor as enum ('agente', 'persona');
create table public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  target text not null,
  listing_id text references public.listings (id) on delete set null,
  -- La persona interessata: chi ha pubblicato il contenuto o l'utente segnalato
  user_id uuid references public.profiles (id) on delete set null,
  action text not null check (action in ('nascondi', 'respingi', 'sospendi', 'passa', 'annulla')),
  actor public.moderation_actor not null,
  moderator_id uuid references public.profiles (id) on delete set null,
  -- Proposta dell'agente quando passa la decisione a una persona
  proposal text check (proposal in ('nascondi', 'respingi', 'sospendi')),
  reason text,
  message text,
  confidence real check (confidence between 0 and 1),
  model text,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid references public.profiles (id) on delete set null
);
create index moderation_actions_target_idx on public.moderation_actions (target, created_at desc);
create index moderation_actions_recent_idx on public.moderation_actions (created_at desc);
-- Nessuna regola per utenti: lo legge e lo scrive solo il server
alter table public.moderation_actions enable row level security;

grant select, insert, update, delete on public.moderation_actions to service_role;
