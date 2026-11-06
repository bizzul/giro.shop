-- giro.shop · valori nuovi negli elenchi (in un file a parte: vanno salvati prima di poterli usare)
alter type public.listing_status add value if not exists 'scaduto';
alter type public.notification_kind add value if not exists 'scadenza';
alter type public.notification_kind add value if not exists 'segnalazione';
