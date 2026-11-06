-- giro.shop · contestare una decisione di moderazione (contenuto nascosto o account sospeso)

create type public.appeal_status as enum ('aperta', 'accolta', 'respinta');
create table public.appeals (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references public.moderation_actions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  message text not null check (char_length(btrim(message)) between 10 and 1500),
  status public.appeal_status not null default 'aperta',
  reply text check (char_length(reply) <= 1000),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null,
  -- Una contestazione per decisione
  unique (action_id)
);
create index appeals_open_idx on public.appeals (created_at) where status = 'aperta';

-- Il registro delle decisioni lo legge solo il server: questa funzione dice se una persona
-- può contestare una decisione (che la riguarda, nascondi o sospendi, non già annullata)
create function public.can_appeal(p_action uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.moderation_actions a
    where a.id = p_action and a.user_id = (select auth.uid()) and a.action in ('nascondi', 'sospendi') and a.undone_at is null
  )
$$;

-- Le decisioni che riguardano la persona collegata, con l'eventuale contestazione (senza chi ha deciso)
create function public.my_moderation_actions()
returns table (
  id uuid,
  target text,
  listing_id text,
  action text,
  message text,
  created_at timestamptz,
  undone_at timestamptz,
  appeal_status public.appeal_status,
  appeal_reply text
)
language sql stable security definer set search_path = '' as $$
  select a.id, a.target, a.listing_id, a.action, a.message, a.created_at, a.undone_at, p.status, p.reply
  from public.moderation_actions a
  left join public.appeals p on p.action_id = a.id
  where a.user_id = (select auth.uid()) and a.action in ('nascondi', 'sospendi')
  order by a.created_at desc
$$;

alter table public.appeals enable row level security;
create policy "ognuno vede le proprie contestazioni" on public.appeals
  for select using ((select auth.uid()) = user_id);
create policy "si contesta a proprio nome una decisione che ci riguarda" on public.appeals
  for insert with check (
    (select auth.uid()) = user_id and status = 'aperta' and reply is null and decided_at is null and public.can_appeal(action_id)
  );

grant select, insert on public.appeals to authenticated;
grant select, insert, update, delete on public.appeals to service_role;
grant execute on function public.can_appeal(uuid), public.my_moderation_actions() to authenticated;
