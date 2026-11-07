-- Ritiro concordato, parte 1: i nuovi valori (vanno in una migrazione a parte, prima di usarli)

-- Proposta di ritiro in conversazione: giorno, ora e luogo, da accettare con un tocco
alter type public.message_kind add value if not exists 'ritiro';
-- Promemoria del ritiro a chi vende e a chi compra
alter type public.notification_kind add value if not exists 'ritiro';
