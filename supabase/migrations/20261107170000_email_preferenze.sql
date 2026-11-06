-- Email degli avvisi più flessibili:
-- - quando: subito (una email per avviso), un riassunto al giorno, oppure mai (solo nel sito);
-- - per cosa: i tipi di avviso che la persona non vuole per email.
-- Sostituisce il vecchio interruttore notify_email (spento → "mai").

alter table public.profiles
  add column email_mode text not null default 'subito' check (email_mode in ('subito', 'riassunto', 'mai')),
  add column email_off public.notification_kind[] not null default '{}',
  -- Ultimo riassunto mandato (lo aggiorna solo il server)
  add column digest_sent_at timestamptz;

update public.profiles set email_mode = 'mai' where notify_email = false;

alter table public.profiles drop column notify_email;

grant update (email_mode, email_off) on public.profiles to authenticated;

-- Il riassunto cerca gli avvisi non ancora mandati per email di una persona
create index if not exists notifications_digest_idx on public.notifications (user_id, created_at) where emailed_at is null;
