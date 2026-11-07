# giro.shop sul Mac mini

Il sito gira sul Mac mini (`obmd-mac-mini.local`, utente `obmd`) con Supabase in locale, ed è pubblico su
**https://giro.omarbeltraminelli.com** attraverso un tunnel Cloudflare.

```
internet ─► Cloudflare ─► tunnel «giro» (cloudflared sul Mac mini)
                              ├─ /auth/v1, /rest/v1, /storage/v1 ─► Supabase (Kong) 127.0.0.1:54421
                              └─ tutto il resto ─────────────────► sito Astro      127.0.0.1:4321
```

Studio (54423), database (54422) e Mailpit (54424) **non** passano dal tunnel: si aprono solo dal Mac mini o dalla
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
git push macmini main && ssh macmini ~/piazza/deploy/macmini/aggiorna.sh
```

`aggiorna.sh` installa le dipendenze, applica le nuove migrazioni, rifà la build e riavvia il sito. I dati restano.
Dopo ogni modifica a `~/piazza/.env` va rilanciato anche lui: i valori entrano nella build.
Il codice va anche su GitHub (`git push`, repository privato `bizzul/piazza`).

## Email vere

Finché non c'è un servizio SMTP:
- i link di accesso li manda Supabase a **Mailpit**, sul Mac mini: si leggono su http://obmd-mac-mini.local:54424;
- le email degli avvisi non partono (gli avvisi restano nel sito, sotto la campanella).

Con un servizio SMTP (es. Infomaniak, Brevo, Postmark), sul Mac mini:

1. In `~/piazza/.env` compila `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` (email degli avvisi).
2. In `~/piazza/supabase/.env` aggiungi (email di accesso):
   ```
   SUPABASE_AUTH_EMAIL_SMTP_ENABLED=true
   SUPABASE_AUTH_EMAIL_SMTP_HOST=smtp.esempio.ch
   SUPABASE_AUTH_EMAIL_SMTP_PORT=587
   SUPABASE_AUTH_EMAIL_SMTP_USER=...
   SUPABASE_AUTH_EMAIL_SMTP_PASS=...
   SUPABASE_AUTH_EMAIL_SMTP_ADMIN_EMAIL=accesso@omarbeltraminelli.com
   SUPABASE_AUTH_EMAIL_SMTP_SENDER_NAME=giro.shop
   ```
3. Riavvia Supabase e rifai la build (i valori di `.env` entrano nella build):
   `cd ~/piazza && pnpm exec supabase stop && pnpm exec supabase start && deploy/macmini/aggiorna.sh`
   (`supabase stop` senza `--no-backup` tiene i dati).

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
5. Tunnel: `cloudflared tunnel create giro`, `cloudflared tunnel route dns giro giro.omarbeltraminelli.com`.

Il modello della ricerca per significato (~200 MB) si scarica al primo avvio in `~/piazza/.cache/modelli`.
