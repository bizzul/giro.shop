import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  checkImportUrl,
  conditionFromLabel,
  draftFromImport,
  htmlToText,
  ImportError,
  isPhotoUrlAllowed,
  parseListingPage,
} from '../src/core/import-listing.ts';

const page = (name: string) => readFileSync(new URL(`./fixtures/import/${name}.html`, import.meta.url), 'utf8');

function errorOf(fn: () => unknown): ImportError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ImportError) return error;
    throw error;
  }
  throw new Error('nessun errore');
}

describe('link da importare', () => {
  it('accetta gli annunci dei tre portali e li porta alla versione italiana, senza parametri', () => {
    expect(checkImportUrl('https://www.tutti.ch/de/vi/83914489?utm_source=x#foto')).toEqual({ site: 'tutti', url: 'https://www.tutti.ch/it/vi/83914489' });
    expect(checkImportUrl('tutti.ch/it/vi/ticino/sport/bici/83914489')).toEqual({ site: 'tutti', url: 'https://www.tutti.ch/it/vi/83914489' });
    expect(checkImportUrl('https://www.anibis.ch/fr/vi/vaud/immobili/salle/54741082').url).toBe('https://www.anibis.ch/it/vi/54741082');
    expect(checkImportUrl('https://www.ricardo.ch/de/a/tisch-50cm-1321484990/')).toEqual({ site: 'ricardo', url: 'https://www.ricardo.ch/it/a/tisch-50cm-1321484990/' });
  });

  it('rifiuta altri siti, indirizzi interni e pagine che non sono annunci', () => {
    for (const raw of [
      'ciao',
      'https://www.tutti.ch.evil.com/it/vi/83914489',
      'https://evil.com/?u=https://www.tutti.ch/it/vi/83914489',
      'http://127.0.0.1/it/vi/83914489',
      'https://user:pw@www.tutti.ch/it/vi/83914489',
      'https://www.tutti.ch:8443/it/vi/83914489',
      'https://www.tutti.ch/it/q/ticino',
      'https://www.ricardo.ch/it/s/bicicletta',
      'https://www.anubis.ch/it/vi/1074109592',
    ]) {
      expect(errorOf(() => checkImportUrl(raw)).kind, raw).toBe('link');
    }
  });

  it('anubis.ch: suggerisce anibis.ch', () => {
    expect(errorOf(() => checkImportUrl('https://www.anubis.ch/it/vi/1074109592')).message).toContain('anibis.ch (con la i)');
  });

  it('scarica le foto solo dalle CDN dei portali', () => {
    expect(isPhotoUrlAllowed('https://c.tutti.ch/big/1.jpg')).toBe(true);
    expect(isPhotoUrlAllowed('https://img.ricardostatic.ch/images/a/t_1800x1350/x')).toBe(true);
    expect(isPhotoUrlAllowed('http://c.tutti.ch/big/1.jpg')).toBe(false);
    expect(isPhotoUrlAllowed('https://c.tutti.ch:444/big/1.jpg')).toBe(false);
    expect(isPhotoUrlAllowed('https://169.254.169.254/latest')).toBe(false);
  });
});

describe('tutti.ch', () => {
  const listing = parseListingPage('tutti', page('tutti'));

  it('legge titolo, testo, prezzo, luogo, categoria e foto', () => {
    expect(listing.title).toBe('Bici da corsa Bianchi Via Nirone 56 cm');
    expect(listing.description).toContain('Dotazione:');
    expect(listing.description).toContain('- Shimano 105');
    expect(listing.description).not.toContain('**');
    expect(listing.priceChf).toBe(650);
    expect(listing).toMatchObject({ postcode: '6500', city: 'Bellinzona', condition: 'buono', translated: false });
    expect(listing.categories).toEqual(['Biciclette', 'Tempo libero e sport']);
    expect(listing.photos).toEqual(['https://c.tutti.ch/big/1000000001.jpg', 'https://c.tutti.ch/big/1000000002.jpg', 'https://c.tutti.ch/big/1000000003.jpg']);
  });

  it('ne fa una bozza con comune e categoria di giro.shop', () => {
    const { draft, priceChf } = draftFromImport(listing);
    expect(priceChf).toBe(650);
    expect(draft.category).toBe('bici');
    expect(draft.comune?.id).toBe('bellinzona');
    expect(draft.title).toBe('Bici da corsa Bianchi Via Nirone 56 cm');
    expect(draft.warnings).toEqual([]);
  });

  it('senza __NEXT_DATA__ si accontenta di JSON-LD e og:', () => {
    const only = page('tutti').replace(/<script id="__NEXT_DATA__"[\s\S]*?<\/script>/, '');
    const l = parseListingPage('tutti', only);
    expect(l.title).toBe('Bici da corsa Bianchi Via Nirone 56 cm');
    expect(l.priceChf).toBe(650);
    expect(l.city).toBe('Bellinzona');
    expect(l.photos).toEqual(['https://c.tutti.ch/big/1000000001.jpg', 'https://c.tutti.ch/big/1000000002.jpg']);
  });

  it('riconosce un annuncio non più disponibile', () => {
    const sold = page('tutti').replace('schema.org/InStock', 'schema.org/SoldOut');
    expect(errorOf(() => parseListingPage('tutti', sold)).kind).toBe('scaduto');
  });
});

describe('anibis.ch', () => {
  const listing = parseListingPage('anibis', page('anibis'));

  it('legge la pagina e scarta le foto fuori dalla CDN', () => {
    expect(listing.title).toBe('Divano letto 3 posti grigio');
    expect(listing.description).toContain('"sfoderabile"');
    expect(listing.priceChf).toBe(180);
    expect(listing.condition).toBe('come_nuovo');
    expect(listing.translated).toBe(true);
    expect(listing.photos).toEqual(['https://c.anibis.ch/big/2000000001.jpg', 'https://c.anibis.ch/big/2000000002.jpg']);
  });

  it('bozza: arredamento a Minusio, con l\'avviso della traduzione', () => {
    const { draft } = draftFromImport(listing);
    expect(draft.category).toBe('arredamento');
    expect(draft.comune?.id).toBe('minusio');
    expect(draft.condition).toBe('come_nuovo');
    expect(draft.warnings.join(' ')).toMatch(/tradotto in automatico/);
  });
});

describe('ricardo.ch', () => {
  const listing = parseListingPage('ricardo', page('ricardo'));

  it('legge articolo, descrizione HTML, prezzo "compralo subito" e foto grandi', () => {
    expect(listing.title).toBe('Tavolo da giardino rotondo 60 cm');
    expect(listing.description).toBe('Tavolo da giardino in metallo verniciato.\n\n- Diametro 60 cm\n- Altezza 73 cm\n\nQualche graffio sul piano.\nRitiro a Lugano.');
    expect(listing.priceChf).toBe(110);
    expect(listing).toMatchObject({ postcode: '6900', city: 'Lugano', condition: 'usato' });
    expect(listing.categories).toEqual(['Tavoli', 'Mobili']);
    expect(listing.photos).toEqual([
      'https://img.ricardostatic.ch/images/aaaa-1111/t_1800x1350/tavolo-da-giardino',
      'https://img.ricardostatic.ch/images/bbbb-2222/t_1800x1350/tavolo-da-giardino',
    ]);
  });

  it('asta senza "compralo subito": prezzo di partenza in franchi', () => {
    const auction = page('ricardo').replace('"offer_type":"auction_with_buynow"', '"offer_type":"auction"');
    expect(parseListingPage('ricardo', auction).priceChf).toBe(90);
  });

  it('bozza: tavolo in arredamento, ritiro a Lugano', () => {
    const { draft, priceChf } = draftFromImport(listing);
    expect(draft.category).toBe('arredamento');
    expect(draft.comune?.id).toBe('lugano');
    expect(priceChf).toBe(110);
  });

  it('asta finita: annuncio scaduto', () => {
    const closed = page('ricardo').replace('window.isClosedPdp=false', 'window.isClosedPdp=true');
    expect(errorOf(() => parseListingPage('ricardo', closed)).kind).toBe('scaduto');
  });

  it('pagina captcha: il sito blocca il server', () => {
    expect(errorOf(() => parseListingPage('ricardo', page('ricardo-captcha'))).kind).toBe('bloccato');
  });
});

describe('aiuti', () => {
  it('condizioni dei portali nella scala di giro.shop', () => {
    expect(conditionFromLabel('Nuovo')).toBe('nuovo');
    expect(conditionFromLabel('Come nuovo')).toBe('come_nuovo');
    expect(conditionFromLabel('Usato')).toBe('buono');
    expect(conditionFromLabel('Difettoso')).toBe('da_riparare');
    expect(conditionFromLabel('boh')).toBeNull();
  });

  it('fuori dal Ticino: niente comune, un avviso', () => {
    const { draft } = draftFromImport({ ...parseListingPage('tutti', page('tutti')), postcode: '6010', city: 'Kriens' });
    expect(draft.comune).toBeNull();
    expect(draft.warnings[0]).toContain('6010 Kriens');
  });

  it('htmlToText toglie i tag e decodifica le entità', () => {
    expect(htmlToText('<p>a &amp; b</p><script>x()</script><p>&#x1f534; c</p>')).toBe('a & b\n\n🔴 c');
  });
});
