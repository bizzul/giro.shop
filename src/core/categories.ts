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
      ['natel', 'Cellulari'],
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
    id: 'affitti',
    name: 'Affitti',
    icon: 'house',
    keywords: [
      ['box auto', 'Box e posteggi'],
      ['posteggi', 'Box e posteggi'],
      ['appartament', 'Appartamenti'],
      ['monolocal', 'Monolocali'],
      ['bilocal', 'Bilocali'],
      ['trilocal', 'Trilocali'],
      ['locali', 'Appartamenti'],
      ['affitt', 'Affitti'],
      ['stanza', 'Stanze'],
      ['rustic', 'Rustici'],
    ],
  },
  {
    id: 'immobili',
    name: 'Case e immobili',
    icon: 'key',
    keywords: [
      ['villett', 'Villette'],
      ['villa', 'Ville'],
      ['unifamiliar', 'Case unifamiliari'],
      ['palazzin', 'Palazzine'],
      ['terren', 'Terreni'],
      ['immobil', 'Immobili'],
    ],
  },
  {
    id: 'lavoro',
    name: 'Lavoro',
    icon: 'briefcase',
    keywords: [
      ['part time', 'Part time'],
      ['impieg', 'Impieghi'],
      ['apprendist', 'Apprendistati'],
      ['stage', 'Stage'],
      ['badant', 'Badanti'],
      ['camerier', 'Camerieri'],
      ['colf', 'Colf'],
      ['lavoro', 'Lavoro'],
    ],
  },
  {
    id: 'servizi',
    name: 'Servizi',
    icon: 'wrench',
    keywords: [
      ['traslochi', 'Traslochi'],
      ['sgomber', 'Sgomberi'],
      ['ripetizion', 'Ripetizioni'],
      ['lezion', 'Lezioni'],
      ['pulizi', 'Pulizie'],
      ['giardinier', 'Giardinieri'],
      ['idraulic', 'Idraulici'],
      ['elettricist', 'Elettricisti'],
      ['imbianch', 'Imbianchini'],
      ['babysitter', 'Baby sitter'],
      ['dogsitter', 'Dog sitter'],
      ['riparazion', 'Riparazioni'],
      ['servizi', 'Servizi'],
    ],
  },
  {
    id: 'animali',
    name: 'Animali',
    icon: 'paw',
    keywords: [
      ['cucciol', 'Cuccioli'],
      ['cagnolin', 'Cani'],
      ['cane', 'Cani'],
      ['gattin', 'Gatti'],
      ['gatto', 'Gatti'],
      ['gatti', 'Gatti'],
      ['acquari', 'Acquari'],
      ['criceti', 'Roditori'],
      ['conigli', 'Conigli'],
      ['pappagall', 'Uccelli'],
      ['cavallo', 'Cavalli'],
      ['cavalli', 'Cavalli'],
      ['cuccia', 'Cucce'],
      ['tiragraffi', 'Tiragraffi'],
      ['guinzagl', 'Guinzagli'],
    ],
  },
  {
    id: 'libri',
    name: 'Libri e film',
    icon: 'book',
    keywords: [
      ['libro', 'Libri'],
      ['libri', 'Libri'],
      ['fumett', 'Fumetti'],
      ['manga', 'Manga'],
      ['romanz', 'Romanzi'],
      ['enciclopedi', 'Enciclopedie'],
      ['dvd', 'DVD'],
      ['bluray', 'Blu-ray'],
    ],
  },
  {
    id: 'sport',
    name: 'Sport e hobby',
    icon: 'ball',
    keywords: [
      ['canna da pesca', 'Pesca'],
      ['cyclette', 'Cyclette'],
      ['tapis', 'Tapis roulant'],
      ['kayak', 'Kayak'],
      ['canoa', 'Canoe'],
      ['canoe', 'Canoe'],
      ['pallon', 'Palloni'],
      ['tennis', 'Tennis'],
      ['golf', 'Golf'],
      ['campegg', 'Campeggio'],
      ['fitness', 'Fitness'],
      ['palestra', 'Palestra'],
      ['skateboard', 'Skateboard'],
    ],
  },
  {
    id: 'eventi',
    name: 'Eventi e biglietti',
    icon: 'ticket',
    keywords: [
      ['bigliett', 'Biglietti'],
      ['concert', 'Concerti'],
      ['abbonament', 'Abbonamenti'],
      ['festival', 'Festival'],
      ['spettacol', 'Spettacoli'],
    ],
  },
  {
    id: 'viaggi',
    name: 'Viaggi e vacanze',
    icon: 'suitcase',
    keywords: [
      ['vacanz', 'Vacanze'],
      ['valigi', 'Valigie'],
      ['trolley', 'Trolley'],
      ['crocier', 'Crociere'],
      ['viaggi', 'Viaggi'],
    ],
  },
  {
    id: 'salute',
    name: 'Salute e bellezza',
    icon: 'drop',
    keywords: [
      ['sedia a rotelle', 'Sedie a rotelle'],
      ['deambulator', 'Deambulatori'],
      ['profum', 'Profumi'],
      ['trucc', 'Trucchi'],
      ['cosmetic', 'Cosmetici'],
      ['crema', 'Creme'],
      ['rasoio', 'Rasoi'],
    ],
  },
  {
    id: 'gastronomia',
    name: 'Vini e gastronomia',
    icon: 'bottle',
    keywords: [
      ['vino', 'Vini'],
      ['vini', 'Vini'],
      ['merlot', 'Merlot'],
      ['grappa', 'Grappe'],
      ['formagg', 'Formaggi'],
      ['miele', 'Miele'],
      ['salum', 'Salumi'],
      ['castagn', 'Castagne'],
    ],
  },
  {
    id: 'affari',
    name: 'Affari e attività',
    icon: 'shop',
    keywords: [
      ['cession', 'Cessioni di attività'],
      ['avviament', 'Attività in vendita'],
      ['franchising', 'Franchising'],
      ['licenza', 'Licenze'],
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
