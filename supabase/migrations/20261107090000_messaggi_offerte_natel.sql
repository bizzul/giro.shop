-- Piazza · messaggi, offerte, natel verificato e data di modifica

create type public.message_kind as enum ('testo', 'offerta', 'sistema');
create type public.offer_status as enum ('in_attesa', 'accettata', 'rifiutata', 'ritirata');

-- Una conversazione per annuncio e per chi compra
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  listing_id text not null references public.listings (id) on delete cascade,
  buyer_id uuid not null references public.profiles (id) on delete cascade,
  seller_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  unique (listing_id, buyer_id),
  check (buyer_id <> seller_id)
);

-- Messaggi di testo, offerte (con importo e stato) e note di sistema
create table public.messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  kind public.message_kind not null default 'testo',
  body text not null default '' check (char_length(body) <= 2000),
  offer_chf numeric(10, 2) check (offer_chf > 0),
  offer_status public.offer_status,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check ((kind = 'offerta') = (offer_chf is not null and offer_status is not null)),
  check (kind <> 'testo' or char_length(btrim(body)) > 0)
);

create index conversations_buyer_idx on public.conversations (buyer_id, last_message_at desc);
create index conversations_seller_idx on public.conversations (seller_id, last_message_at desc);
create index conversations_listing_idx on public.conversations (listing_id);
create index messages_conversation_idx on public.messages (conversation_id, created_at);
create index messages_unread_idx on public.messages (conversation_id) where read_at is null;

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

create policy "conversazioni visibili ai due partecipanti" on public.conversations
  for select using ((select auth.uid()) in (buyer_id, seller_id));

-- Si apre una conversazione solo come acquirente, su un annuncio in vendita, verso il suo vero venditore
create policy "chi compra apre la conversazione" on public.conversations
  for insert with check (
    buyer_id = (select auth.uid())
    and seller_id = (
      select l.seller_id from public.listings l
      where l.id = listing_id and l.status in ('pubblicato', 'in_trattativa')
    )
  );

create policy "messaggi visibili ai due partecipanti" on public.messages
  for select using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (select auth.uid()) in (c.buyer_id, c.seller_id)
    )
  );

-- Si scrive solo a proprio nome; le offerte nascono "in attesa" e solo su annunci ancora in vendita
create policy "i partecipanti scrivono a proprio nome" on public.messages
  for insert with check (
    sender_id = (select auth.uid())
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (select auth.uid()) in (c.buyer_id, c.seller_id)
    )
    and (
      kind = 'testo'
      or (
        kind = 'offerta' and offer_status = 'in_attesa'
        and exists (
          select 1 from public.conversations c
          join public.listings l on l.id = c.listing_id
          where c.id = conversation_id and l.status in ('pubblicato', 'in_trattativa')
        )
      )
    )
  );

-- Chi riceve un messaggio può segnarlo come letto (solo la colonna read_at, vedi i permessi)
create policy "chi riceve segna come letto" on public.messages
  for update
  using (
    sender_id <> (select auth.uid())
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (select auth.uid()) in (c.buyer_id, c.seller_id)
    )
  )
  with check (sender_id <> (select auth.uid()));

-- Dopo ogni messaggio: aggiorna la conversazione e chiude le offerte rimaste aperte
create function public.after_message_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  if new.kind = 'offerta' then
    update public.messages
    set offer_status = case when sender_id = new.sender_id then 'ritirata'::public.offer_status else 'rifiutata'::public.offer_status end
    where conversation_id = new.conversation_id
      and kind = 'offerta'
      and offer_status = 'in_attesa'
      and id <> new.id;
  end if;
  return new;
end;
$$;

create trigger messages_after_insert
  after insert on public.messages
  for each row execute function public.after_message_insert();

-- Risposta a un'offerta: accetta o rifiuta chi la riceve, ritira chi l'ha fatta
create function public.respond_to_offer(p_message_id bigint, p_decision public.offer_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  m public.messages;
  c public.conversations;
begin
  if me is null then
    raise exception 'Accedi per rispondere.' using errcode = '42501';
  end if;

  select * into m from public.messages where id = p_message_id and kind = 'offerta' for update;
  if not found then
    raise exception 'Offerta non trovata.' using errcode = 'P0002';
  end if;
  select * into c from public.conversations where id = m.conversation_id;
  if me <> c.buyer_id and me <> c.seller_id then
    raise exception 'Offerta non trovata.' using errcode = 'P0002';
  end if;
  if m.offer_status <> 'in_attesa' then
    raise exception 'Questa offerta ha già una risposta.' using errcode = 'P0001';
  end if;

  if p_decision = 'ritirata' then
    if m.sender_id <> me then
      raise exception 'Solo chi ha fatto l''offerta può ritirarla.' using errcode = '42501';
    end if;
  elsif p_decision in ('accettata', 'rifiutata') then
    if m.sender_id = me then
      raise exception 'Non puoi rispondere a una tua offerta.' using errcode = '42501';
    end if;
  else
    raise exception 'Risposta non valida.' using errcode = '22023';
  end if;

  update public.messages set offer_status = p_decision where id = m.id;
  insert into public.messages (conversation_id, sender_id, kind, body)
  values (
    c.id,
    me,
    'sistema',
    case p_decision
      when 'accettata' then 'Offerta accettata. Mettetevi d''accordo su ritiro e pagamento.'
      when 'rifiutata' then 'Offerta rifiutata.'
      else 'Offerta ritirata.'
    end
  );

  if p_decision = 'accettata' then
    update public.listings set status = 'in_trattativa' where id = c.listing_id and status = 'pubblicato';
  end if;
end;
$$;

revoke execute on function public.respond_to_offer(bigint, public.offer_status) from public, anon;
grant execute on function public.respond_to_offer(bigint, public.offer_status) to authenticated;

-- Natel verificato: quando Supabase conferma il numero, il profilo lo mostra
create function public.sync_phone_verified()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.phone_confirmed_at is distinct from old.phone_confirmed_at then
    update public.profiles set phone_verified_at = new.phone_confirmed_at where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_phone_confirmed
  after update on auth.users
  for each row execute function public.sync_phone_verified();

-- Data dell'ultima modifica dell'annuncio
alter table public.listings add column updated_at timestamptz;

create function public.set_listing_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger listings_updated_at
  before update on public.listings
  for each row execute function public.set_listing_updated_at();

-- Permessi
grant select, insert on public.conversations to authenticated;
grant select, insert on public.messages to authenticated;
grant update (read_at) on public.messages to authenticated;
grant select, insert, update, delete on public.conversations, public.messages to service_role;
