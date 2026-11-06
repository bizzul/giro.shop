/**
 * Regole di giro.shop: le usa l'agente di moderazione per decidere e le può leggere chiunque.
 * Scritte per persone, brevi, verificabili dal contenuto.
 */
export const REPORT_REASONS = {
  truffa: 'Sembra una truffa',
  vietato: 'Oggetto vietato o pericoloso',
  offensivo: 'Contenuto offensivo o molesto',
  falso: 'Descrizione o profilo falsi',
  spam: 'Spam o pubblicità',
  altro: 'Altro',
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;

export const COMMUNITY_RULES = `Regole di giro.shop (mercatino dell'usato tra privati in Ticino):
1. Oggetti vietati: armi e munizioni, droghe e farmaci con ricetta, animali vivi, documenti d'identità, merce contraffatta o rubata, contenuti per adulti, alcol e tabacco a minori.
2. Niente truffe: chiedere pagamenti anticipati a sconosciuti, link di pagamento esterni, codici ricevuti per SMS, prezzi irrealistici con fretta e pressione, spostare la trattativa fuori dal sito per evitare controlli, annunci copiati da altri.
3. Rispetto: niente insulti, discriminazioni, minacce, molestie, né dati personali di altre persone.
4. Niente spam: annunci duplicati, pubblicità di attività, link non pertinenti.
5. Onestà: descrizione e foto dell'oggetto vero, nello stato vero.
Non sono violazioni: un prezzo alto o basso, un oggetto che non piace, un disaccordo sulla trattativa, un errore di battitura.`;
