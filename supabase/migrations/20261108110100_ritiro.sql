-- Ritiro concordato, parte 2: giorno, ora e luogo dentro l'offerta o in una proposta a parte,
-- ritiro fissato nella conversazione, promemoria e la domanda "l'hai venduto?" dopo il ritiro.

alter table public.messages
  add column pickup_at timestamptz,
  add column pickup_place text check (char_length(pickup_place) <= 120),
  -- Scritto dall'assistente venditore a nome di chi vende (lo mette solo il server)
  add column by_assistant boolean not null default false;

-- Offerte e proposte di ritiro hanno uno stato; solo le offerte hanno un importo; il ritiro ha sempre un giorno
alter table public.messages drop constraint messages_check;
alter table public.messages
  add constraint messages_offer_amount check ((kind = 'offerta') = (offer_chf is not null)),
  add constraint messages_offer_status check ((kind in ('offerta', 'ritiro')) = (offer_status is not null)),
  add constraint messages_pickup check (
    (kind <> 'ritiro' or pickup_at is not null)
    and (kind in ('offerta', 'ritiro') or (pickup_at is null and pickup_place is null))
  );

alter table public.conversations
  add column pickup_at timestamptz,
  add column pickup_place text,
  add column pickup_agreed_at timestamptz,
  add column pickup_reminded_at timestamptz,
  add column sold_asked_at timestamptz,
  -- Com'è andato il ritiro, secondo chi vende
  add column pickup_outcome text check (pickup_outcome in ('venduto', 'non_venduto'));

create index conversations_pickup_idx on public.conversations (pickup_at) where pickup_at is not null and pickup_outcome is null;

-- Si scrive solo a proprio nome, mai come assistente; offerte e proposte di ritiro solo su annunci in vendita,
-- il ritiro nel futuro
drop policy "i partecipanti scrivono a proprio nome" on public.messages;
create policy "i partecipanti scrivono a proprio nome" on public.messages
  for insert with check (
    sender_id = (select auth.uid())
    and not by_assistant
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (select auth.uid()) in (c.buyer_id, c.seller_id)
    )
    and (
      kind = 'testo'
      or (
        kind in ('offerta', 'ritiro') and offer_status = 'in_attesa'
        and (pickup_at is null or pickup_at > now())
        and exists (
          select 1 from public.conversations c
          join public.listings l on l.id = c.listing_id
          where c.id = conversation_id and l.status in ('pubblicato', 'in_trattativa')
        )
      )
    )
  );

-- Dopo ogni messaggio: aggiorna la conversazione e chiude le offerte (o le proposte di ritiro) rimaste aperte
create or replace function public.after_message_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  if new.kind in ('offerta', 'ritiro') then
    update public.messages
    set offer_status = case when sender_id = new.sender_id then 'ritirata'::public.offer_status else 'rifiutata'::public.offer_status end
    where conversation_id = new.conversation_id
      and kind = new.kind
      and offer_status = 'in_attesa'
      and id <> new.id;
  end if;
  return new;
end;
$$;

-- Risposta a un'offerta o a una proposta di ritiro: accetta o rifiuta chi la riceve, ritira chi l'ha fatta.
-- Un ritiro accettato (da solo o dentro un'offerta) diventa il ritiro fissato della conversazione.
create or replace function public.respond_to_offer(p_message_id bigint, p_decision public.offer_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  m public.messages;
  c public.conversations;
  what text;
begin
  if me is null then
    raise exception 'Accedi per rispondere.' using errcode = '42501';
  end if;

  select * into m from public.messages where id = p_message_id and kind in ('offerta', 'ritiro') for update;
  if not found then
    raise exception 'Offerta non trovata.' using errcode = 'P0002';
  end if;
  select * into c from public.conversations where id = m.conversation_id;
  if me <> c.buyer_id and me <> c.seller_id then
    raise exception 'Offerta non trovata.' using errcode = 'P0002';
  end if;
  what := case when m.kind = 'ritiro' then 'Proposta di ritiro' else 'Offerta' end;
  if m.offer_status <> 'in_attesa' then
    raise exception '%', what || ' ha già una risposta.' using errcode = 'P0001';
  end if;

  if p_decision = 'ritirata' then
    if m.sender_id <> me then
      raise exception 'Solo chi l''ha fatta può ritirarla.' using errcode = '42501';
    end if;
  elsif p_decision in ('accettata', 'rifiutata') then
    if m.sender_id = me then
      raise exception 'Non puoi rispondere a una tua proposta.' using errcode = '42501';
    end if;
    if p_decision = 'accettata' and m.pickup_at is not null and m.pickup_at < now() then
      raise exception 'Il giorno proposto per il ritiro è già passato: proponine un altro.' using errcode = 'P0001';
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
    case
      when p_decision = 'accettata' and m.kind = 'ritiro' then 'Ritiro confermato.'
      when p_decision = 'accettata' and m.pickup_at is not null then 'Offerta accettata, con il ritiro proposto.'
      when p_decision = 'accettata' then 'Offerta accettata. Mettetevi d''accordo su ritiro e pagamento.'
      when p_decision = 'rifiutata' then what || ' rifiutata.'
      else what || ' ritirata.'
    end
  );

  if p_decision = 'accettata' then
    update public.listings set status = 'in_trattativa' where id = c.listing_id and status = 'pubblicato';
    if m.pickup_at is not null then
      update public.conversations
      set pickup_at = m.pickup_at, pickup_place = m.pickup_place, pickup_agreed_at = now(),
          pickup_reminded_at = null, sold_asked_at = null, pickup_outcome = null
      where id = c.id;
    end if;
  end if;
end;
$$;

-- Dopo il ritiro chi vende dice com'è andata. "Non venduto": l'annuncio torna in vendita.
create function public.set_pickup_outcome(p_conversation_id uuid, p_outcome text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.conversations;
begin
  select * into c from public.conversations where id = p_conversation_id and seller_id = auth.uid();
  if not found then
    raise exception 'Conversazione non trovata.' using errcode = 'P0002';
  end if;
  if p_outcome not in ('venduto', 'non_venduto') then
    raise exception 'Risposta non valida.' using errcode = '22023';
  end if;
  update public.conversations set pickup_outcome = p_outcome where id = c.id;
  if p_outcome = 'non_venduto' then
    update public.listings set status = 'pubblicato' where id = c.listing_id and status = 'in_trattativa';
    insert into public.messages (conversation_id, sender_id, kind, body)
    values (c.id, c.seller_id, 'sistema', 'Il ritiro non è andato a buon fine: l''annuncio è di nuovo in vendita.');
  end if;
end;
$$;

revoke execute on function public.set_pickup_outcome(uuid, text) from public, anon;
grant execute on function public.set_pickup_outcome(uuid, text) to authenticated;

grant update (pickup_reminded_at, sold_asked_at) on public.conversations to service_role;
