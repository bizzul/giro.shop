-- Piazza · ruolo di servizio
-- Serve ai lavori lato server (avvisi, scadenze, pulizie) e ai test. Ignora le regole RLS:
-- la sua chiave non va mai nel browser né nel server MCP pubblico.

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
