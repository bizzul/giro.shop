# Piazza

Prototipo di un mercatino dell'usato per il Canton Ticino, costruito attorno all'AI:
l'annuncio nasce da una foto, la ricerca capisce le frasi e un server MCP permette di
cercare, stimare prezzi e preparare bozze dal proprio assistente AI.

Corrisponde ai "primi 10 giorni" del piano di attacco: Astro 7, nucleo di dominio,
server MCP con 4 strumenti, bozza da foto con Claude e schema Supabase pronto.
Gli annunci sono **dati di prova in memoria** (48 annunci inventati).

## Avvio

```bash
pnpm install
cp .env.example .env      # facoltativo: ANTHROPIC_API_KEY per leggere le foto
pnpm dev                  # http://localhost:4321
```

| Comando | Cosa fa |
| --- | --- |
| `pnpm dev` | Sito in sviluppo su `localhost:4321` |
| `pnpm build` / `pnpm start` | Build di produzione e avvio con Node |
| `pnpm test` | Test di ricerca, stime, bozze e server MCP |
| `pnpm mcp:smoke` | Prova il server MCP via HTTP (con `pnpm dev` acceso) |
| `pnpm mcp:stdio` | Server MCP via stdio, per Claude Desktop |
| `pnpm db:seed-sql` | Rigenera `supabase/seed.sql` dai dati di prova |
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

- `/` ricerca e ultimi annunci
- `/cerca?q=…` ricerca in linguaggio naturale: la frase diventa filtri visibili (chip)
- `/annuncio/[id]` scheda con stima di prezzo dagli annunci simili
- `/vendi` "Scatta e vendi": foto e due righe → bozza con prezzo suggerito
- `/connetti` come collegare un assistente AI
- `/mcp` endpoint MCP (Streamable HTTP, senza sessione)

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

- Annunci su Supabase al posto dei dati in memoria (schema già in `supabase/migrations`)
- Account, foto salvate, pubblicazione, messaggi e offerte
- Ricerca per significato con embedding (colonna `embedding` già prevista)
- Avvisi, OAuth 2.1 sul server MCP, `publish_listing` con conferma
- Elenco ufficiale dei comuni con coordinate swisstopo (ora sono approssimative)
