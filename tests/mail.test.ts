import { describe, expect, it } from 'vitest';
import { digestMail, noticeMail } from '../src/lib/mail.ts';

const card = { url: 'https://giro.test/annuncio/l-010', photo: 'https://giro.test/foto/l-010.webp', title: 'Divano 3 posti', price: 'CHF 250.–', place: 'Giubiasco', badges: [] };

describe('email con il disegno del sito', () => {
  it('avviso: logo, etichetta, scheda dell\'annuncio, bottone e link per spegnerlo', () => {
    const m = noticeMail({ to: 'a@b.ch', title: 'Nuovo annuncio per «sofà»', body: 'Divano · CHF 250.–', url: '/annuncio/l-010', origin: 'https://giro.test', unsubscribe: 'https://giro.test/email-avvisi?u=1&t=x&tipo=ricerche', about: 'Nuovi annunci per le tue ricerche salvate', kind: 'ricerca', listing: card });
    expect(m.html).toContain('https://giro.test/email/giro-logo.png');
    expect(m.html).toContain('Ricerca salvata');
    expect(m.html).toContain('Divano 3 posti');
    expect(m.html).toContain("Apri l&#39;annuncio");
    // La disiscrizione nell'HTML è codificata (& → &amp;), nell'intestazione no
    expect(m.html).toContain('email-avvisi?u=1&amp;t=x&amp;tipo=ricerche');
    expect(m.headers?.['List-Unsubscribe']).toBe('<https://giro.test/email-avvisi?u=1&t=x&tipo=ricerche>');
    // Per un nuovo annuncio il testo non ripete la scheda
    expect(m.html).not.toContain('Divano · CHF 250.–</p>');
    expect(m.text).toContain('Apri: https://giro.test/annuncio/l-010');
  });

  it('testi degli utenti codificati', () => {
    const m = noticeMail({ to: 'a@b.ch', title: '<script>x</script>', body: '<b>ciao</b>', url: '/avvisi', origin: 'https://giro.test', unsubscribe: null, kind: 'risposta' });
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&lt;b&gt;ciao&lt;/b&gt;');
  });

  it('riassunto: una riga per avviso, prezzo solo per i prezzi ridotti', () => {
    const m = digestMail({
      to: 'a@b.ch',
      origin: 'https://giro.test',
      unsubscribe: null,
      items: [
        { title: 'Prezzo ridotto: Divano', body: 'Ora CHF 250.–', url: '/annuncio/l-010', kind: 'prezzo', listing: card },
        { title: 'Hanno risposto', body: '«Sì»', url: '/annuncio/l-010#domande', kind: 'risposta', listing: card },
      ],
    });
    expect(m.subject).toBe('Il riassunto di oggi: 2 avvisi');
    expect(m.html).toContain('2 avvisi che non hai ancora visto');
    expect(m.html.match(/CHF 250\.–<\/span>/g)?.length).toBe(1);
  });
});
