-- Su telefono i comandi (cerca, messaggi, avvisi, account, vendi) stanno in una barra sul lato del pollice:
-- a destra di base, a sinistra per chi è mancino. La scelta segue l'account da un dispositivo all'altro.

alter table public.profiles add column left_handed boolean not null default false;

grant update (left_handed) on public.profiles to authenticated;
