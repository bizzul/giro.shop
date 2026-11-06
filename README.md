# Piazza

Prototipo di un mercatino dell'usato per il Canton Ticino, costruito attorno all'AI:
l'annuncio nasce da una foto, la ricerca capisce le frasi e un server MCP permette di
cercare, stimare prezzi e preparare bozze dal proprio assistente AI.

Stato: Astro 7, nucleo di dominio, server MCP con 4 strumenti, bozza da foto con Claude e,
dalla Fase 1, **Supabase con account, pubblicazione e foto**. Senza Supabase il sito gira
lo stesso sui 48 annunci di prova in memoria.

## Avvio

```bash
pnpm install
cp .env.example .env      # poi compila le chiavi (vedi sotto)
supabase start            # Supabase in locale: serve Docker (OrbStack) acceso
pnpm dev                  # http://localhost:4321
```

### Supabase in locale

`supabase start` crea il database, applica le migrazioni in `supabase/migrations` e carica
`supabase/seed.sql` (48 annunci, 19 venditori di prova senza password, 43 foto con crediti).
Copia in `.env` i valori di `supabase status`: `API_URL` → `PUBLIC_SUPABASE_URL`,
`PUBLISHABLE_KEY` → `PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

- Studio (tabelle, utenti, storage): http://127.0.0.1:54323
- Mailpit, dove arrivano le email di accesso in sviluppo: http://127.0.0.1:54324
- Ripartire da zero con i dati di prova: `supabase db reset`

L'accesso è con link via email (PKCE, nessuna password). Il link va aperto nello stesso browser
da cui è stato chiesto.

Il cellulare si verifica con un SMS (`updateUser` + codice `phone_change`). In locale non parte nessun SMS:
in `supabase/config.toml` ci sono numeri di prova con codice fisso, per esempio 079 123 45 67 → 123456.
`[auth.sms] enable_confirmations` deve restare `true`, altrimenti il numero cambia senza codice.
Online serve un fornitore SMS vero (Twilio, Vonage o uno svizzero tramite il Send SMS hook).

`pnpm dev` e `pnpm start` alzano il limite delle intestazioni HTTP a 64 KB: su `localhost` il browser
manda a Piazza anche i cookie degli altri progetti locali, e il limite predefinito di Node (16 KB)
non basta.

| Comando | Cosa fa |
| --- | --- |
| `pnpm dev` | Sito in sviluppo su `localhost:4321` |
| `pnpm build` / `pnpm start` | Build di produzione e avvio con Node |
| `pnpm test` | Test di ricerca, stime, bozze, cellulare e server MCP |
| `pnpm test:db` | Controlli di sicurezza sul database locale con utenti temporanei (28 casi) |
| `pnpm mcp:smoke` | Prova il server MCP via HTTP (con `pnpm dev` acceso) |
| `pnpm mcp:stdio` | Server MCP via stdio, per Claude Desktop |
| `pnpm db:seed-sql` | Rigenera `supabase/seed.sql` dai dati di prova |
| `supabase db reset` | Ricrea il database locale da migrazioni e seed |
| `node scripts/fetch-photos.ts search \| sheet \| build` | Cerca, rivede e genera le foto di esempio |

## Foto

Le foto degli annunci di prova sono **foto di esempio** prese da [Openverse](https://openverse.org)
(Flickr e Wikimedia Commons), solo con licenze CC0, pubblico dominio o CC BY. Non ritraggono gli
oggetti reali degli annunci. Sono ritagliate in 4:3 e salvate in WebP in due misure
(`public/foto/l-XXX.webp` da circa 1024 px e `l-XXX-sm.webp` da 480 px). Autore, licenza e fonte
sono in `src/data/photos.ts` e compaiono sotto la foto nella scheda annuncio, come richiede CC BY.

Per cambiare una foto: `node scripts/fetch-photos.ts sheet l-029` mostra i candidati di quell'annuncio,
poi si aggiorna `PICKS` nello script e si rilancia `build`.

## Pagine

- `/` ricerca dal vivo e ultimi annunci
- `/cerca?q=…` ricerca in linguaggio naturale: la frase diventa filtri visibili (chip)
- `/annuncio/[id]` scheda con foto, stima di prezzo e stato (anche "venduto")
- `/vendi` "Scatta e vendi": foto e due righe → bozza → pubblicazione (serve l'accesso)
- `/accedi` accesso o registrazione con link via email; `/auth/callback` ritorno dal link
- `/miei-annunci` annunci propri: modifica, venduto (con prezzo), archivia, rimetti in vendita, elimina; verifica del cellulare; nome visibile; esci
- `/miei-annunci/[id]` modifica di un annuncio: testi, prezzo, trattabile, categoria, condizione, luogo, parole chiave, foto (togliere e aggiungere)
- `/messaggi` conversazioni come acquirente e venditore, con i non letti
- `/messaggi/[id]` conversazione con offerte (accetta, rifiuta, ritira, controfferta); si aggiorna da sola ogni 5 secondi
- `/connetti` come collegare un assistente AI
- `/mcp` endpoint MCP (Streamable HTTP, senza sessione)

## Dati, accesso e sicurezza

- Il server tiene in memoria una copia degli annunci pubblicati e venduti, aggiornata al massimo
  ogni 10 secondi e subito dopo ogni modifica: ricerca, stime e MCP restano veloci e sincroni.
- Home, ricerca e schede sono uguali per tutti e restano in cache; la sessione non viene letta lì.
  Il link all'account nell'intestazione è una server island (`server:defer`) caricata a parte.
- Le pagine private usano un client Supabase con la sessione dell'utente: sono le regole RLS
  del database a decidere cosa si può leggere e modificare. Le foto vanno nel bucket `foto`,
  ognuno solo nella propria cartella (`foto/<utente>/<annuncio>/n.jpg`).
- Messaggi e offerte: solo i due partecipanti vedono una conversazione; nessuno scrive a nome di altri
  né crea note di sistema. Accettare, rifiutare o ritirare un'offerta passa dalla funzione
  `respond_to_offer` del database, che controlla chi può fare cosa. Un'offerta accettata mette
  l'annuncio "in trattativa"; una nuova offerta chiude quelle ancora aperte nella conversazione.
- Dopo ogni modifica la cache delle pagine con annunci si svuota (`cache.invalidate`), così i
  cambiamenti si vedono subito.
- `pnpm test:db` verifica tutto questo con tre utenti temporanei (venditore, acquirente, intruso).

## Struttura

```text
src/
  core/        logica di dominio, senza dipendenze da Astro
    query.ts     frase → filtri ("sotto i 150 franchi vicino a Lugano")
    search.ts    ricerca con motivi di pertinenza e distanza
    price.ts     stima di prezzo da annunci simili, pubblicati e venduti
    draft.ts     bozza da foto con Claude (o regole semplici senza chiave)
    comuni.ts    località ticinesi e distanze
  data/        annunci di prova
  mcp/         server MCP (HTTP e stdio) sopra il nucleo
  actions/     Astro Actions sopra il nucleo
  pages/       pagine Astro, rese dal server con cache
  components/  card, ricerca, isola Preact "Scatta e vendi"
supabase/      migrazione iniziale e seed generato
tests/         vitest
docs/          proposta di progetto (analisi, concept, grafica, piano)
```

Sito, Actions e server MCP usano le stesse funzioni di `src/core`: una sola fonte di regole
per persone e agenti. Il nucleo gira anche direttamente con Node 24 (`node src/mcp/stdio.ts`),
senza build.

## Connettore MCP

Strumenti: `search_listings`, `get_listing`, `estimate_price`, `create_draft`.
Nessuno pubblica o contatta qualcuno: `create_draft` prepara solo una bozza.
Le risposte segnalano che titoli e descrizioni sono testo degli utenti, da trattare come dati.

```bash
claude mcp add --transport http piazza http://localhost:4321/mcp
```

Per Claude Desktop (stdio) la configurazione pronta è nella pagina `/connetti`.

## Claude

`create_draft` e "Scatta e vendi" usano `claude-opus-5-5` (modificabile con `PIAZZA_DRAFT_MODEL`)
con output strutturato e il fallback lato server in caso di rifiuto. Senza `ANTHROPIC_API_KEY`
la bozza si crea dal testo con regole semplici e la pagina lo dice.

## Cosa manca (Fase 1 e oltre)

- Progetto Supabase online (per ora solo in locale) e messa online del sito
- Fornitore SMS reale per la verifica del cellulare online
- Avvisi via email per i nuovi messaggi (ora si vedono nel sito); messaggi in tempo reale con Supabase Realtime
- Ricerca per significato con embedding (colonna `embedding` già prevista)
- Avvisi, OAuth 2.1 sul server MCP, `publish_listing` con conferma
- Elenco ufficiale dei comuni con coordinate swisstopo (ora sono approssimative)
