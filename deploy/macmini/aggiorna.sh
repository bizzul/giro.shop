#!/bin/zsh
# Aggiorna giro.shop sul Mac mini dopo un `git push macmini main` dal MacBook (o un `git pull`):
# dipendenze, database (Supabase locale + nuove migrazioni), build e riavvio del sito. Non tocca i dati.
set -euo pipefail
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH
cd "$(dirname "$0")/../.."

echo "→ dipendenze"
pnpm install --frozen-lockfile

echo "→ Supabase"
./node_modules/.bin/supabase start >/dev/null
./node_modules/.bin/supabase migration up

echo "→ build"
pnpm build

echo "→ riavvio del sito"
launchctl kickstart -k "gui/$(id -u)/com.omarbeltraminelli.giro"
sleep 3
curl -fsS -o /dev/null -w "sito: %{http_code}\n" http://127.0.0.1:4321/ || { echo "Il sito non risponde: guarda ~/Library/Logs/giro.log"; exit 1; }
