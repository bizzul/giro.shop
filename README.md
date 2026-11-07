# giro.shop

Mercatino dell'usato tra privati in Ticino, costruito attorno all'AI: l'annuncio nasce da una foto, la ricerca capisce
le frasi (e il significato delle parole) e un connettore MCP permette di cercare, salvare ricerche e pubblicare
parlando con il proprio assistente.

**Online:** https://giro.omarbeltraminelli.com, un prototipo con annunci di prova, che gira su un Mac mini con
Supabase in locale ([come](deploy/macmini/LEGGIMI.md)).

![Home: ricerca a frasi, affare del giorno e ultimi annunci](docs/screenshots/01-home.webp)

## Indice

- [Funzionalità](#funzionalità)
  - [Cercare](#cercare)
  - [La scheda annuncio](#la-scheda-annuncio)
  - [Vendere](#vendere)
  - [Trattare](#trattare)
  - [Avvisi ed email](#avvisi-ed-email)
  - [Fiducia e moderazione](#fiducia-e-moderazione)
  - [Assistente AI (MCP)](#assistente-ai-mcp)
  - [Privacy e dati](#privacy-e-dati)
- [Come è fatto](#come-è-fatto)
- [Avvio in locale](#avvio-in-locale)
- [Test](#test)
- [Online sul Mac mini](#online-sul-mac-mini)
- [Struttura](#struttura)
- [Foto di esempio](#foto-di-esempio)
- [Cosa manca](#cosa-manca)

## Funzionalità

### Cercare

- **Frasi al posto dei filtri.** «scrivania in legno sotto i 150 franchi vicino a Lugano» diventa categoria, prezzo,
  zona con raggio e materiale. Ogni filtro capito è un chip che si toglie con un clic; i risultati si aggiornano mentre
  scrivi, senza ricaricare la pagina.
- **Ricerca per significato.** «sofà» trova il divano, «Fahrrad» le bici, «per fare il caffè» la macchina del caffè,
  anche se l'annuncio non contiene quelle parole. Usa un modello che gira sul server (EmbeddingGemma), non un servizio
  esterno. Gli annunci trovati così sono segnati «stesso significato» e vengono dopo quelli con le parole esatte;
  prezzo, zona e gli altri filtri valgono comunque.
- **Motivi di pertinenza** su ogni scheda («noce massello · sotto budget»), **giudizio sul prezzo** (sotto mercato,
  prezzo giusto, sopra mercato) e **stato** (nuovo oggi, trattabile, in trattativa, regalo).
- **Ordine:** pertinenza, più recenti, prezzo, più vicini. Gli annunci si caricano a pagine con «Mostra altri».
- **Distanze da te:** scrivi il tuo comune (con ricerca, anche per CAP) o usa la posizione una volta sola; il comune
  resta solo nel browser.
- **Suggerimenti** mentre scrivi e **ricerche recenti** (salvate solo nel browser).
- **Cerca con una foto:** fotografi un oggetto e Claude scrive la ricerca (serve la chiave di Claude).
- **Affare del giorno** in home e pagina **Confronta** per mettere annunci uno accanto all'altro.

<p>
  <img src="docs/screenshots/02-ricerca.webp" alt="Una frase diventa filtri: categoria, prezzo, zona, materiale" width="49%">
  <img src="docs/screenshots/03-significato.webp" alt="«sofà» trova il divano: stesso significato" width="49%">
</p>
<p>
  <img src="docs/screenshots/05-distanze.webp" alt="Da dove parti? Il comune si scrive e si sceglie" width="49%">
</p>

### La scheda annuncio

- Foto, prezzo, **stima dagli annunci simili** (pubblicati e venduti) e giudizio sul prezzo.
- **In sintesi:** i punti chiave, scritti da Claude o, senza chiave, da regole semplici.
- **Domande pubbliche** con risposta di chi vende e voto «utile», così le stesse domande non arrivano dieci volte.
- **Storico del prezzo** con grafico; chi ha salvato l'annuncio viene avvisato quando il prezzo cala.
- **Traduzione** in tedesco, francese e inglese (con Claude).
- Salva (cuore), confronta, scrivi a chi vende, segnala. Profilo di chi vende con valutazioni e tempi di risposta.
- Per Google: dati strutturati (Product/Offer), link canonici, sitemap e robots.txt.

<p>
  <img src="docs/screenshots/04-annuncio.webp" alt="Scheda annuncio con stima del prezzo e sintesi" width="62%">
  <img src="docs/screenshots/04b-domande-prezzo.webp" alt="Domande pubbliche e storico del prezzo" width="36%">
</p>

### Vendere

- **Scatta e vendi:** da 1 a 5 foto e due righe. Claude riconosce l'oggetto, scrive titolo, descrizione, condizione,
  dettagli e parole chiave e propone una fascia di prezzo dagli annunci simili. I campi scritti dall'assistente hanno
  l'anello blu: si controllano prima di pubblicare. Senza chiave di Claude la bozza nasce dal testo con regole
  semplici, e la pagina lo dice.
- Comune di ritiro con ricerca, spedizione con costo facoltativo, prezzo trattabile.
- **I miei annunci:** modifica con salvataggio automatico (niente bottoni «Salva», una notifica conferma), foto da
  aggiungere e riordinare, venduto (con prezzo e a chi), archivia, rimetti in vendita, elimina.
- **Scadenza:** gli annunci restano online 90 giorni, con promemoria 3 giorni prima e rinnovo con un tocco.
- **Valutazioni** reciproche dopo una vendita, solo tra chi ha davvero trattato.

![Scatta e vendi: foto, bozza, prezzo dagli annunci simili](docs/screenshots/06-vendi.webp)

### Trattare

- Messaggi tra chi compra e chi vende, con **offerte**: accetta, rifiuta, ritira, controfferta. Un'offerta accettata
  mette l'annuncio «in trattativa». La conversazione si aggiorna da sola.
- Consigli di sicurezza nella conversazione e la guida «Comprare e vendere sicuri».

![Conversazione con offerte](docs/screenshots/07-messaggi.webp)

### Avvisi ed email

- **Ricerche salvate:** un avviso quando arriva un annuncio che corrisponde, anche detto con altre parole
  («sofà» avvisa per un divano, con una soglia di somiglianza più alta di quella della ricerca).
- Avvisi per prezzi ridotti e vendite degli annunci salvati, domande e risposte, valutazioni, scadenze.
- Tutto resta nel sito, sotto la campanella. Per email si sceglie **quando** (subito, un riassunto al giorno alle 18,
  mai) e **per cosa** (cinque tipi). Ogni email ha il link per spegnere solo quel tipo, anche con un clic dal programma
  di posta.

<p>
  <img src="docs/screenshots/09-avvisi.webp" alt="Avvisi" width="49%">
  <img src="docs/screenshots/08-account.webp" alt="Email degli avvisi: quando e per cosa" width="49%">
</p>

### Fiducia e moderazione

- **Cellulare verificato** con un codice via SMS (il numero non è mai mostrato).
- **Segnalazioni** di annunci, domande, valutazioni, utenti e conversazioni (solo da chi ne fa parte). Dopo alcune
  segnalazioni di persone diverse il contenuto si nasconde finché qualcuno non lo controlla.
- **Agente di moderazione** (Claude): legge la segnalazione, il contenuto, le foto dell'annuncio, chi ha pubblicato e
  quanto è affidabile chi segnala, poi prende una sola decisione. Nasconde o respinge da solo solo con sicurezza almeno
  0.85; su utenti e conversazioni decide sempre una persona. I limiti sono nel codice, non solo nel prompt.
- **Pagina di moderazione** per le persone: decisioni, proposte dell'agente, registro, annullamento.
- **Contestazioni:** chi riceve una decisione la può contestare; la rivede sempre una persona.
- Sospensione degli account per violazioni gravi o ripetute.

![Pagina di moderazione](docs/screenshots/12-moderazione.webp)

### Assistente AI (MCP)

Due indirizzi per Claude o un altro client MCP:

| Indirizzo | Accesso | Strumenti |
| --- | --- | --- |
| `/mcp` | nessuno | `search_listings`, `get_listing`, `estimate_price`, `create_draft`, `save_search` (con link di conferma) |
| `/mcp/account` | OAuth 2.1 | gli stessi, più `save_search`, `my_saved_searches`, `delete_saved_search`, `publish_listing`, `my_listings`, `update_listing` a nome della persona |

- **OAuth 2.1 completo:** metadati (RFC 8414 e 9728), registrazione dinamica dei client, PKCE obbligatorio, token di
  un'ora con rinnovo a rotazione, revoca, `iss` nella risposta (RFC 9207). Funziona con claude.ai, Claude Code e MCP
  Inspector.
- **Pagina di consenso** che dice cosa l'assistente potrà e non potrà fare; permessi separati per ricerche e annunci.
- **Assistenti collegati** in «I miei annunci», da scollegare con un clic (smettono subito di funzionare).
- `publish_listing` accetta foto come indirizzi https, scaricate in modo sicuro (niente reti interne, solo immagini
  vere fino a 5 MB); senza foto l'annuncio resta in bozza.
- Le risposte segnalano che titoli e descrizioni sono testo degli utenti, da trattare come dati.

<p>
  <img src="docs/screenshots/10-connettore.webp" alt="Pagina del connettore AI" width="49%">
  <img src="docs/screenshots/11-consenso.webp" alt="Consenso OAuth per collegare Claude" width="49%">
</p>

### Privacy e dati

- Informativa sulla privacy (nLPD) e condizioni d'uso, con le regole della comunità prese dalla stessa fonte usata
  dall'agente di moderazione.
- **Scarica i tuoi dati** (un file JSON con tutto) ed **elimina l'account** dalla pagina dell'account.
- Solo cookie tecnici, niente tracciamento. Accesso con link via email, senza password.

### Sul telefono

![Ricerca e scheda annuncio sul telefono](docs/screenshots/13-telefono.webp)

## Come è fatto

- **Astro 7** con rendering sul server (adapter Node), isole **Preact** per le parti interattive, Astro Actions per i
  moduli, server islands per le parti personali delle pagine in cache.
- **Supabase**: Postgres con regole RLS (ognuno vede e modifica solo ciò che può), accesso con link via email (PKCE),
  Storage per le foto. Funzioni e trigger nel database per offerte, scadenze, segnalazioni e sospensioni.
- **Un solo nucleo** in `src/core` (frase → filtri, ricerca, stime, bozze, comuni) usato dal sito, dalle Actions e dal
  server MCP: le stesse regole per persone e agenti. Il server tiene in memoria una copia degli annunci pubblicati,
  aggiornata dopo ogni modifica.
- **Claude** (`claude-opus-5-5`, facoltativo): bozze da foto, sintesi, traduzioni, ricerca con foto, moderazione.
  Senza chiave tutto il resto funziona.
- **EmbeddingGemma** (via transformers.js, sul server, circa 200 MB scaricati una volta) per la ricerca per significato;
  i vettori stanno in una tabella che solo il server legge e scrive.
- Lavori periodici (promemoria di scadenza, annunci scaduti, riassunto delle email, vettori nuovi) agganciati alle
  richieste, al massimo ogni 15 minuti.

## Avvio in locale

Serve Docker acceso.

```bash
pnpm install
cp .env.example .env              # poi compila le chiavi (vedi sotto)
pnpm exec supabase start          # Supabase in locale: database, migrazioni e dati di prova
pnpm dev                          # http://localhost:4321
```

Da `pnpm exec supabase status` copia in `.env`:
- `API_URL` in `PUBLIC_SUPABASE_URL`;
- `PUBLISHABLE_KEY` in `PUBLIC_SUPABASE_PUBLISHABLE_KEY`;
- `SECRET_KEY` in `SUPABASE_SECRET_KEY`.

La CLI di Supabase e pnpm hanno versioni fisse nel progetto.

| Variabile | A cosa serve |
| --- | --- |
| `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase, come lo vedono i browser |
| `SUPABASE_SECRET_KEY` | Solo server: avvisi, email, moderazione, OAuth, ricerca per significato |
| `SUPABASE_INTERNAL_URL` | Facoltativa: indirizzo interno di Supabase per il server (dietro un tunnel) |
| `PIAZZA_BASE_URL` | Indirizzo pubblico del sito (link nelle email, OAuth, sitemap) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Email degli avvisi; in locale Mailpit |
| `ANTHROPIC_API_KEY` | Facoltativa: Claude |

- Studio: http://127.0.0.1:54323 · Mailpit (email di accesso in sviluppo): http://127.0.0.1:54324
- L'accesso è con link via email: va aperto nello stesso browser da cui è stato chiesto.
- In locale il cellulare si verifica con numeri di prova a codice fisso (es. 079 123 45 67 → 123456).
- Utente di prova: `prova@esempio.test` (moderatore).

## Test

| Comando | Cosa verifica |
| --- | --- |
| `pnpm test` | 86 test unitari: ricerca, significato, stime, bozze, avvisi, email, OAuth, SEO, MCP |
| `pnpm test:e2e` | 14 test nel browser (Playwright con il Chrome installato), con accessi veri via email: ricerca, significato, distanze, Scatta e vendi, avviso per significato, offerta accettata, ricerca salvata, email, collegare un assistente |
| `pnpm test:db` | 83 controlli di sicurezza sul database con utenti temporanei (RLS, permessi, trigger) |
| `pnpm test:moderazione` | 37 controlli sull'agente di moderazione con un modello finto che segue un copione |
| `pnpm test:oauth` | 25 controlli sul login OAuth del connettore con il client MCP ufficiale |
| `pnpm mcp:smoke` | Prova il server MCP via HTTP |
| `pnpm screenshots` | Rifà le immagini di questo README |

I test nel browser e i controlli servono `pnpm exec supabase start` e `pnpm dev` accesi; puliscono quello che creano.

## Online sul Mac mini

Il sito gira sul Mac mini di casa con Supabase in locale ed è pubblico attraverso un tunnel Cloudflare: passano solo il
sito e l'API di Supabase che serve ai browser. Per aggiornarlo, dal MacBook:

```bash
git push macmini main && ssh macmini ~/piazza/deploy/macmini/aggiorna.sh
```

Tutto il resto (porte, avvio automatico, email vere, riavvii) è in [deploy/macmini/LEGGIMI.md](deploy/macmini/LEGGIMI.md).

## Struttura

```text
src/
  core/        logica di dominio senza Astro: frasi → filtri, ricerca, stime, bozze, comuni, email, OAuth
  lib/         lato server: Supabase, email, avvisi, moderazione, ricerca per significato, OAuth, manutenzione
  actions/     Astro Actions (moduli del sito)
  mcp/         server MCP (HTTP e stdio) e strumenti dell'account
  pages/       pagine ed endpoint (anche /oauth e /.well-known)
  components/  schede, ricerca, isole Preact (Scatta e vendi, comune ricercabile, foto)
supabase/      configurazione, migrazioni e dati di prova
tests/         test unitari (vitest)
e2e/           test nel browser (Playwright)
scripts/       controlli su database, moderazione e OAuth, screenshot, foto di esempio
deploy/macmini/  avvio sul Mac mini: launchd, tunnel, aggiornamento, guida
docs/          proposta di progetto e screenshot
```

## Foto di esempio

Le foto degli annunci di prova sono **foto di esempio** prese da [Openverse](https://openverse.org) (Flickr e
Wikimedia Commons), solo con licenze CC0, pubblico dominio o CC BY. Non ritraggono gli oggetti reali degli annunci.
Autore, licenza e fonte sono in `src/data/photos.ts` e compaiono sotto la foto nella scheda annuncio, come richiede
CC BY. Per cambiarne una: `node scripts/fetch-photos.ts sheet l-029`, poi si aggiorna `PICKS` nello script e si
rilancia `build`.

## Cosa manca

- Servizio email vero sul Mac mini (SMTP), per accessi e avvisi fuori casa
- Fornitore SMS per verificare il cellulare online
- Chiave di Claude online per bozze da foto, traduzioni, ricerca con foto e agente di moderazione
- Elenco ufficiale dei comuni con coordinate swisstopo (ora 33 comuni con coordinate approssimative)
- Testi legali: dati tra parentesi quadre da completare e revisione di un giurista
