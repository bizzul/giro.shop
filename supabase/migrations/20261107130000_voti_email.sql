-- giro.shop · voto "utile" sulle domande e preferenza per le email degli avvisi

-- Email degli avvisi: si possono spegnere dall'account o con il link in fondo a ogni email
alter table public.profiles add column notify_email boolean not null default true;
grant update (notify_email) on public.profiles to authenticated;

-- Voto "utile" sulle risposte: il conteggio sta sulla domanda, chi ha votato resta privato
alter table public.questions add column helpful integer not null default 0;

create table public.question_votes (
  question_id uuid not null references public.questions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (question_id, user_id)
);
create index question_votes_user_idx on public.question_votes (user_id);
alter table public.question_votes enable row level security;
create policy "ognuno vede i propri voti" on public.question_votes
  for select using ((select auth.uid()) = user_id);
create policy "si vota a proprio nome, solo risposte date e non alle proprie domande" on public.question_votes
  for insert with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.questions q
      where q.id = question_id and q.answer is not null and q.asker_id <> (select auth.uid())
    )
  );
create policy "ognuno toglie il proprio voto" on public.question_votes
  for delete using ((select auth.uid()) = user_id);

create function public.count_question_votes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  qid uuid := coalesce(new.question_id, old.question_id);
begin
  update public.questions set helpful = (select count(*) from public.question_votes v where v.question_id = qid) where id = qid;
  return null;
end $$;
create trigger question_votes_count after insert or delete on public.question_votes
  for each row execute function public.count_question_votes();

grant select, insert, delete on public.question_votes to authenticated;
grant select, insert, update, delete on public.question_votes to service_role;
