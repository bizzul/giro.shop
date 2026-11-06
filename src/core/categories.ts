import type { CategoryId } from './types.ts';
import { tokenMatches } from './text.ts';

export interface Category {
  id: CategoryId;
  name: string;
  icon: string;
  /** [radice o frase normalizzata, etichetta da mostrare] */
  keywords: Array<[string, string]>;
}

export const CATEGORIES: Category[] = [
  {
    id: 'arredamento',
    name: 'Arredamento',
    icon: 'desk',
    keywords: [
      ['scrivani', 'Scrivanie'],
      ['tavol', 'Tavoli'],
      ['sedia', 'Sedie'],
      ['sedie', 'Sedie'],
      ['divan', 'Divani'],
      ['poltron', 'Poltrone'],
      ['armadi', 'Armadi'],
      ['libreri', 'Librerie'],
      ['lampad', 'Lampade'],
      ['cassettier', 'Cassettiere'],
      ['comodin', 'Comodini'],
      ['credenz', 'Credenze'],
      ['mobil', 'Mobili'],
      ['specchi', 'Specchi'],
    ],
  },
  {
    id: 'bici',
    name: 'Bici',
    icon: 'bike',
    keywords: [
      ['bici da corsa', 'Bici da corsa'],
      ['bici bambin', 'Bici per bambini'],
      ['bici bimb', 'Bici per bambini'],
      ['bici ragazz', 'Bici per ragazzi'],
      ['mountain bike', 'Mountain bike'],
      ['mtb', 'Mountain bike'],
      ['ebike', 'E-bike'],
      ['bici elettric', 'E-bike'],
      ['bici', 'Bici'],
      ['biciclett', 'Bici'],
      ['gravel', 'Gravel'],
    ],
  },
  {
    id: 'sport_inverno',
    name: 'Sci e montagna',
    icon: 'ski',
    keywords: [
      ['sci', 'Sci'],
      ['scarponi da sci', 'Scarponi da sci'],
      ['scarpon', 'Scarponi'],
      ['snowboard', 'Snowboard'],
      ['casco', 'Caschi'],
      ['ciaspol', 'Ciaspole'],
      ['racchette da neve', 'Ciaspole'],
    ],
  },
  {
    id: 'moto_scooter',
    name: 'Moto e scooter',
    icon: 'scooter',
    keywords: [
      ['vespa', 'Vespa'],
      ['lambrett', 'Lambretta'],
      ['scooter', 'Scooter'],
      ['motorin', 'Motorini'],
      ['ciclomotor', 'Ciclomotori'],
      ['moto', 'Moto'],
    ],
  },
  {
    id: 'auto',
    name: 'Auto',
    icon: 'car',
    keywords: [
      ['gomme invernali', 'Pneumatici'],
      ['pneumatic', 'Pneumatici'],
      ['cerchi', 'Cerchi'],
      ['auto', 'Auto'],
    ],
  },
  {
    id: 'bambini',
    name: 'Bambini',
    icon: 'stroller',
    keywords: [
      ['passeggin', 'Passeggini'],
      ['carrozzin', 'Carrozzine'],
      ['seggiolino auto', 'Seggiolini auto'],
      ['seggiolin', 'Seggiolini'],
      ['culla', 'Culle'],
      ['fasciatoi', 'Fasciatoi'],
      ['giocattol', 'Giocattoli'],
    ],
  },
  {
    id: 'elettronica',
    name: 'TV, audio e foto',
    icon: 'camera',
    keywords: [
      ['tv', 'TV'],
      ['televisor', 'TV'],
      ['fotocamer', 'Fotocamere'],
      ['reflex', 'Fotocamere'],
      ['obiettiv', 'Obiettivi'],
      ['cuffi', 'Cuffie'],
      ['giradischi', 'Giradischi'],
      ['drone', 'Droni'],
      ['casse', 'Casse audio'],
    ],
  },
  {
    id: 'telefonia',
    name: 'Telefonia',
    icon: 'phone',
    keywords: [
      ['natel', 'Natel'],
      ['iphone', 'iPhone'],
      ['smartphon', 'Smartphone'],
      ['telefon', 'Telefoni'],
      ['cellular', 'Cellulari'],
    ],
  },
  {
    id: 'informatica',
    name: 'Informatica',
    icon: 'laptop',
    keywords: [
      ['macbook', 'Portatili'],
      ['laptop', 'Portatili'],
      ['portatil', 'Portatili'],
      ['computer', 'Computer'],
      ['pc', 'Computer'],
      ['monitor', 'Monitor'],
      ['stampant', 'Stampanti'],
      ['ipad', 'Tablet'],
      ['tablet', 'Tablet'],
    ],
  },
  {
    id: 'videogiochi',
    name: 'Giochi e console',
    icon: 'gamepad',
    keywords: [
      ['playstation', 'PlayStation'],
      ['ps5', 'PlayStation'],
      ['ps4', 'PlayStation'],
      ['xbox', 'Xbox'],
      ['nintendo', 'Nintendo'],
      ['switch', 'Nintendo Switch'],
      ['wii', 'Nintendo'],
      ['console', 'Console'],
      ['videogioc', 'Videogiochi'],
      ['controller', 'Controller'],
    ],
  },
  {
    id: 'elettrodomestici',
    name: 'Elettrodomestici',
    icon: 'appliance',
    keywords: [
      ['macchina del caffe', 'Macchine del caffè'],
      ['macchina caffe', 'Macchine del caffè'],
      ['lavatric', 'Lavatrici'],
      ['lavastovigli', 'Lavastoviglie'],
      ['asciugatric', 'Asciugatrici'],
      ['frigo', 'Frigoriferi'],
      ['aspirapolver', 'Aspirapolvere'],
      ['forno', 'Forni'],
      ['microonde', 'Microonde'],
    ],
  },
  {
    id: 'abbigliamento',
    name: 'Abbigliamento',
    icon: 'shirt',
    keywords: [
      ['giacc', 'Giacche'],
      ['giubbott', 'Giubbotti'],
      ['cappott', 'Cappotti'],
      ['scarpe', 'Scarpe'],
      ['maglion', 'Maglioni'],
      ['pantalon', 'Pantaloni'],
      ['borsa', 'Borse'],
    ],
  },
  {
    id: 'musica',
    name: 'Musica e strumenti',
    icon: 'guitar',
    keywords: [
      ['chitarr', 'Chitarre'],
      ['pianoforte digitale', 'Pianoforti digitali'],
      ['pianofort', 'Pianoforti'],
      ['violin', 'Violini'],
      ['synth', 'Synth'],
      ['ampli', 'Amplificatori'],
    ],
  },
  {
    id: 'collezionismo',
    name: 'Antiquariato e collezioni',
    icon: 'vase',
    keywords: [
      ['antic', 'Antiquariato'],
      ['collezion', 'Collezionismo'],
      ['francobolli', 'Francobolli'],
      ['monete', 'Monete'],
    ],
  },
  {
    id: 'giardino',
    name: 'Casa e giardino',
    icon: 'garden',
    keywords: [
      ['tosaerba', 'Tosaerba'],
      ['barbecue', 'Barbecue'],
      ['grill', 'Barbecue'],
      ['ombrellon', 'Ombrelloni'],
      ['tagliasiepi', 'Tagliasiepi'],
      ['soffiator', 'Soffiatori'],
    ],
  },
  {
    id: 'altro',
    name: 'Altro',
    icon: 'box',
    keywords: [],
  },
];

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function getCategory(id: CategoryId): Category {
  return BY_ID.get(id) ?? (BY_ID.get('altro') as Category);
}

export interface CategoryMatch {
  id: CategoryId;
  keyword: string;
  label: string;
  /** Posizione della prima parola riconosciuta nel testo. */
  index: number;
  /** Quante parole occupa la corrispondenza. */
  length: number;
}

/**
 * Trova la categoria dall'oggetto nominato per primo:
 * "scrivania vintage" è arredamento, "seggiolino auto" è bambini.
 * A parità di posizione vince la corrispondenza più lunga.
 */
export function detectCategory(tokens: string[]): CategoryMatch | null {
  let best: CategoryMatch | null = null;
  for (let i = 0; i < tokens.length; i++) {
    for (const cat of CATEGORIES) {
      for (const [keyword, label] of cat.keywords) {
        const words = keyword.split(' ');
        let ok = false;
        if (words.length === 1) {
          ok = tokenMatches(tokens[i], keyword);
        } else {
          const slice = tokens.slice(i, i + words.length);
          ok =
            slice.length === words.length &&
            slice.every((t, j) => (j === words.length - 1 ? tokenMatches(t, words[j]) : t === words[j]));
        }
        if (!ok) continue;
        const better =
          !best || i < best.index || (i === best.index && keyword.length > best.keyword.length);
        if (better) best = { id: cat.id, keyword, label, index: i, length: words.length };
      }
    }
    if (best) return best;
  }
  return best;
}
