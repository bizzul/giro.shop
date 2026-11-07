/**
 * Scrive i modelli delle email di Supabase Auth (supabase/templates/*.html) con lo stesso disegno delle email del sito
 * (src/lib/email-design.ts): una sola fonte. I segnaposto {{ .SiteURL }} e {{ .ConfirmationURL }} li riempie Supabase.
 * Uso: pnpm email:modelli   (poi riavvia Supabase: `pnpm exec supabase stop && pnpm exec supabase start`)
 */
import { writeFileSync } from 'node:fs';
import { button, emailLayout, heading, label, note, paragraph } from '../src/lib/email-design.ts';

const SITE = '{{ .SiteURL }}';
const LINK = '{{ .ConfirmationURL }}';

const templates: Record<string, string> = {
  accesso: emailLayout({
    origin: SITE,
    preheader: "Il link vale un'ora. Aprilo nello stesso browser da cui l'hai chiesto.",
    body:
      label('Accesso') +
      heading('Entra in giro.shop') +
      paragraph("Tocca il bottone per entrare. Il link vale un'ora e va aperto nello stesso browser da cui l'hai chiesto.") +
      button(LINK, 'Entra') +
      note("Non l'hai chiesto tu? Ignora questa email: senza il link nessuno entra nel tuo account. Non ti chiederemo mai una password o un codice per email."),
  }),
  conferma: emailLayout({
    origin: SITE,
    preheader: "Conferma la tua email per creare l'account.",
    body:
      label('Benvenuto') +
      heading('Conferma la tua email') +
      paragraph("Tocca il bottone per creare l'account ed entrare. Il link vale un'ora e va aperto nello stesso browser da cui l'hai chiesto.") +
      button(LINK, 'Conferma ed entra') +
      note("Non ti sei iscritto tu? Ignora questa email: senza conferma l'account non si attiva."),
  }),
};

for (const [name, html] of Object.entries(templates)) {
  writeFileSync(`supabase/templates/${name}.html`, html);
  console.log(`✓ supabase/templates/${name}.html`);
}
