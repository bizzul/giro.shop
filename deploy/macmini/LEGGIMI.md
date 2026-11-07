# giro.shop sul Mac mini

Il sito gira sul Mac mini (`obmd-mac-mini.local`, utente `obmd`) con Supabase in locale, ed è pubblico su
**https://giro.omarbeltraminelli.com** attraverso un tunnel Cloudflare.

```
internet ─► Cloudflare ─► tunnel «giro» (cloudflared sul Mac mini)
                              ├─ /auth/v1, /rest/v1, /storage/v1 ─► Supabase (Kong) 127.0.0.1:54421
                              └─ tutto il resto ─────────────────► sito Astro      127.0.0.1:4321
```

Studio (54423), database (54422) e Mailpit (54424, inutilizzato da quando c'è Resend) **non** passano dal tunnel: si aprono solo dal Mac mini o dalla
rete di casa (es. http://obmd-mac-mini.local:54423).

## Cosa gira e dove

| Cosa | Come parte | Log |
| --- | --- | --- |
| Supabase (progetto `piazza`, porte 54420–54429) | `pnpm exec supabase start` (container Docker) | `docker logs supabase_auth_piazza` |
| Sito | LaunchAgent `com.omarbeltraminelli.giro` (all'accesso, si riavvia da solo) | `~/Library/Logs/giro.log` |
| Tunnel | LaunchAgent `com.omarbeltraminelli.giro-tunnel` | `~/Library/Logs/giro-tunnel.log` |

Le porte di Supabase sono diverse da quelle di wintax (54321–54329): le sceglie `supabase/.env` sul Mac mini
(variabili `SUPABASE_*_PORT`, mai su git), insieme agli indirizzi pubblici usati nei link di accesso.

## Aggiornare il sito

Dal MacBook, nella cartella del progetto:

```bash
git push macmini main && ssh macmini 'piazza/deploy/macmini/aggiorna.sh'
```

`aggiorna.sh` installa le dipendenze, applica le nuove migrazioni, rifà la build e riavvia il sito. I dati restano.
Dopo ogni modifica a `~/piazza/.env` va rilanciato anche lui: i valori entrano nella build.
Il codice va anche su GitHub (`git push`, repository privato `bizzul/giro.shop`).

## Email (Resend)

Le email partono con [Resend](https://resend.com), dal dominio verificato `giro.omarbeltraminelli.com`:

| Email | Chi la manda | Mittente | Impostazioni sul Mac mini |
| --- | --- | --- | --- |
| Link di accesso | Supabase Auth | `accesso@giro.omarbeltraminelli.com` | `~/piazza/supabase/.env`: `SUPABASE_AUTH_EMAIL_SMTP_*` |
| Avvisi e riassunto della sera | il sito | `avvisi@giro.omarbeltraminelli.com` | `~/piazza/.env`: `SMTP_*`, `MAIL_FROM` |

Server `smtp.resend.com`, porta 465, utente `resend`, password = chiave API di Resend (in entrambi i file, mai su git).
La sezione `[auth.email.smtp]` di `supabase/config.toml` resta spenta: sul MacBook le email vanno a Mailpit.

Gli account di prova hanno indirizzi finti (`@esempio.test`): con Resend le loro email non partono, così non tornano
indietro e non rovinano la reputazione del dominio (`src/lib/mail.ts`, `deliverable`).

**Cambiare la chiave:** sostituiscila in `SMTP_PASS` (`.env`) e in `SUPABASE_AUTH_EMAIL_SMTP_PASS` (`supabase/.env`), poi
`cd ~/piazza && pnpm exec supabase stop && pnpm exec supabase start && deploy/macmini/aggiorna.sh`
(`supabase stop` senza `--no-backup` tiene i dati).

## Passkey

Le passkey sono facoltative: chi vuole ne aggiunge una dall'account e poi entra senza aspettare l'email. Sono legate a un
dominio: `supabase/config.toml` dice `localhost` (per il MacBook), sul Mac mini va il dominio pubblico. Una riga in
`~/piazza/supabase/.env`:

```bash
SUPABASE_AUTH_WEBAUTHN_RP_ID=giro.omarbeltraminelli.com
```

poi `cd ~/piazza && pnpm exec supabase stop && pnpm exec supabase start && deploy/macmini/aggiorna.sh`.
L'indirizzo `https://giro.omarbeltraminelli.com` è già tra le origini ammesse (`rp_origins` in `supabase/config.toml`).
Controllo: `docker inspect supabase_auth_piazza --format '{{range .Config.Env}}{{println .}}{{end}}' | grep WEBAUTHN`
deve dire `GOTRUE_WEBAUTHN_RP_ID=giro.omarbeltraminelli.com`. Senza la riga, aggiungere una passkey dà errore.
**Non cambiare più il dominio dopo:** le passkey già create smettono di funzionare (resta il link via email).

## Comandi utili (sul Mac mini)

```bash
cd ~/piazza && pnpm exec supabase status          # porte e chiavi
launchctl kickstart -k gui/$(id -u)/com.omarbeltraminelli.giro          # riavvia il sito
launchctl kickstart -k gui/$(id -u)/com.omarbeltraminelli.giro-tunnel   # riavvia il tunnel
tail -f ~/Library/Logs/giro.log
```

## Dopo un riavvio del Mac mini

Docker Desktop riparte all'accesso e con lui i container di Supabase; il sito e il tunnel partono con i LaunchAgent.
Se Supabase non c'è (`pnpm exec supabase status` dà errore): `cd ~/piazza && pnpm exec supabase start`.

## Prima installazione (già fatta il 7 novembre 2026)

1. Codice: `git push macmini main` dal MacBook (il Mac mini ha un repository con `receive.denyCurrentBranch=updateInstead`).
2. `supabase/.env` con le porte, `pnpm install`, `pnpm exec supabase start`.
3. Dati copiati dal MacBook: account e identità (`auth.users`, `auth.identities`), tutte le tabelle di `public`, le foto
   del bucket `foto`.
4. `.env` da `deploy/macmini/env.esempio`, `pnpm build`, LaunchAgent in `~/Library/LaunchAgents`.
5. Tunnel: `cloudflared tunnel create giro`, poi il record DNS **con il certificato del dominio giusto**:
   `cloudflared --origincert ~/.cloudflared/cert-omarbeltraminelli.pem tunnel route dns giro giro.omarbeltraminelli.com`.
   Senza `--origincert` cloudflared usa `cert.pem`, che è della zona evoltech.ch, e crea il record sbagliato
   `giro.omarbeltraminelli.com.evoltech.ch`.
6. LaunchAgent: copia i due `.plist` di questa cartella in `~/Library/LaunchAgents` e
   `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/<nome>.plist`.

Il modello della ricerca per significato (~200 MB) si scarica al primo avvio in `~/piazza/.cache/modelli`.
