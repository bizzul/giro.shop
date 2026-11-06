-- giro.shop · nuovo tipo di avviso (in un file a parte: va salvato prima di poterlo usare)
alter type public.notification_kind add value if not exists 'contestazione';
