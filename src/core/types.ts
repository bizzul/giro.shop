export type Condition = 'nuovo' | 'come_nuovo' | 'buono' | 'usato' | 'da_riparare';

export const CONDITIONS = ['nuovo', 'come_nuovo', 'buono', 'usato', 'da_riparare'] as const;

export const CATEGORY_IDS = [
  'arredamento',
  'bici',
  'sport_inverno',
  'moto_scooter',
  'auto',
  'bambini',
  'elettronica',
  'telefonia',
  'informatica',
  'videogiochi',
  'elettrodomestici',
  'abbigliamento',
  'musica',
  'collezionismo',
  'giardino',
  'altro',
] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];

export type District =
  | 'Bellinzona'
  | 'Blenio'
  | 'Leventina'
  | 'Locarno'
  | 'Lugano'
  | 'Mendrisio'
  | 'Riviera'
  | 'Vallemaggia';

export interface Comune {
  id: string;
  name: string;
  cap: string;
  district: District;
  lat: number;
  lon: number;
  /** Altri modi di chiamarlo nelle ricerche (frazioni, regioni). */
  aliases?: string[];
}

export type ListingStatus = 'pubblicato' | 'venduto';

export interface Listing {
  id: string;
  title: string;
  description: string;
  category: CategoryId;
  tags: string[];
  attributes: Record<string, string>;
  /** Prezzo richiesto in CHF; 0 significa "regalo". */
  priceChf: number;
  negotiable?: boolean;
  condition: Condition;
  comuneId: string;
  publishedAt: string;
  status: ListingStatus;
  soldPriceChf?: number;
  seller: { name: string; verified: boolean };
  /** Id dell'account di chi vende (solo con Supabase). */
  sellerId?: string;
  /** Un'offerta è stata accettata: l'annuncio resta visibile ma è "in trattativa". */
  negotiating?: boolean;
  photos?: Photo[];
  /** Si può spedire; shippingChf è il costo indicato da chi vende (vuoto = da concordare). */
  shipping?: boolean;
  shippingChf?: number;
  /** Chi ha comprato, quando chi vende l'ha indicato (serve per le valutazioni). */
  buyerId?: string;
  /** Punti chiave scritti da Claude alla pubblicazione. */
  highlights?: string[];
  /** Prezzi nel tempo, dal più vecchio: il primo è quello di pubblicazione. */
  priceHistory?: PricePoint[];
  /** Domande pubbliche con le risposte di chi vende, dalla più vecchia. */
  questions?: Question[];
}

export interface PricePoint {
  priceChf: number;
  at: string;
}

export interface Question {
  id: string;
  body: string;
  askerName: string;
  createdAt: string;
  answer?: string;
  answeredAt?: string;
  /** Quante persone hanno trovato utile la risposta. */
  helpful: number;
}

/** Foto di un annuncio, in due misure, con i crediti richiesti dalla licenza. */
export interface Photo {
  src: string;
  srcSmall: string;
  width: number;
  height: number;
  /** Solo per le foto di esempio con licenza CC: le foto degli utenti non ne hanno. */
  credit?: PhotoCredit | null;
}

export interface PhotoCredit {
  author: string | null;
  authorUrl: string | null;
  license: string;
  licenseUrl: string | null;
  source: string;
  sourceUrl: string;
}

/** Un gruppo di parole equivalenti: basta che l'annuncio ne contenga una. */
export interface TermGroup {
  term: string;
  alts: string[];
  kind: 'materiale' | 'parola';
}

export interface SearchFilters {
  raw: string;
  category?: CategoryId;
  categoryLabel?: string;
  /** Il nome dell'oggetto cercato (es. scrivania): l'annuncio deve contenerlo. */
  required?: { term: string; alts: string[] };
  groups: TermGroup[];
  minPrice?: number;
  maxPrice?: number;
  comuneId?: string;
  radiusKm?: number;
  conditions?: Condition[];
  includeBroken?: boolean;
  yearFrom?: number;
  yearTo?: number;
  wheelRange?: [number, number];
  pickup?: boolean;
  /** Solo annunci che si possono spedire. */
  shipping?: boolean;
}

export interface Chip {
  key: string;
  value: string;
  /** La frase senza questo filtro, se si può togliere. */
  without?: string;
}

export type PriceVerdict = 'sotto_mercato' | 'prezzo_giusto' | 'sopra_mercato';

export interface PriceEstimate {
  low: number;
  mid: number;
  high: number;
  /** Quanti annunci sono stati usati per la stima. */
  comparables: number;
  soldComparables: number;
  basis: 'simili' | 'categoria';
  confidence: 'alta' | 'media' | 'bassa';
  comparableIds: string[];
}

export interface SearchHit {
  listing: Listing;
  comune: Comune;
  distanceKm?: number;
  score: number;
  reasons: string[];
  verdict?: PriceVerdict;
  /** Trovato per significato (non contiene le parole cercate): la similarità 0–1. */
  meaning?: number;
}

export interface SearchResult {
  filters: SearchFilters;
  chips: Chip[];
  hits: SearchHit[];
  /** Quanti annunci corrispondono in tutto (hits può esserne solo una parte). */
  total: number;
  /** Quanti di questi sono stati trovati solo per significato. */
  byMeaning?: number;
}
