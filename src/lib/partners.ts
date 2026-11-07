import type { District } from '../core/types.ts';
import { adminClient } from './admin.ts';
import { sendMail } from './mail.ts';

/**
 * Partner locali: sgombero, traslochi, trasporto, riparazioni, pulizie.
 * Compaiono dove servono (dopo Svuota casa, su un mobile grande senza spedizione, nella pagina Partner)
 * e pagano per ogni contatto ricevuto (fattura a fine mese: i contatti con la tariffa restano in partner_leads).
 * Niente pubblicità a pagamento generica e niente tracciamento.
 */

export const SERVICES = {
  sgombero: 'Sgombero',
  traslochi: 'Traslochi',
  trasporto: 'Trasporto',
  riparazioni: 'Riparazioni',
  pulizie: 'Pulizie',
} as const;
export type Service = keyof typeof SERVICES;
export const SERVICE_KEYS = Object.keys(SERVICES) as Service[];

export interface Partner {
  id: string;
  name: string;
  service: Service;
  about: string | null;
  districts: string[];
  website: string | null;
  phone: string | null;
}

export class PartnerError extends Error {}

let cache: { at: number; list: Partner[] } | null = null;

/** I partner attivi (copia di al massimo un minuto). */
export async function activePartners(): Promise<Partner[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.list;
  const admin = adminClient();
  if (!admin) return [];
  const { data } = await admin.from('partners').select('id, name, service, about, districts, website, phone').eq('active', true).order('name');
  cache = { at: Date.now(), list: (data ?? []) as Partner[] };
  return cache.list;
}

/** I partner di un servizio che lavorano in una zona (senza zone = tutto il Ticino). */
export async function partnersFor(service?: Service | null, district?: District | string | null): Promise<Partner[]> {
  return (await activePartners()).filter(
    (p) => (!service || p.service === service) && (!district || p.districts.length === 0 || p.districts.includes(district)),
  );
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Una richiesta di preventivo: resta registrata (con la tariffa del partner) e arriva al partner per email. */
export async function contactPartner(input: {
  partnerId: string;
  userId: string | null;
  name: string;
  contact: string;
  message: string;
  listingId?: string | null;
  origin: string;
}): Promise<void> {
  const admin = adminClient();
  if (!admin) throw new PartnerError('Contatti non disponibili: manca la configurazione del server.');
  const { data: partner } = await admin.from('partners').select('id, name, email, fee_chf, active').eq('id', input.partnerId).maybeSingle();
  if (!partner?.active) throw new PartnerError('Questo partner non è più disponibile.');
  const { data: lead, error } = await admin
    .from('partner_leads')
    .insert({
      partner_id: partner.id,
      user_id: input.userId,
      name: input.name,
      contact: input.contact,
      message: input.message,
      listing_id: input.listingId ?? null,
      fee_chf: partner.fee_chf,
    })
    .select('id')
    .single();
  if (error || !lead) throw new PartnerError(`Richiesta non inviata: ${error?.message}`);
  const listingUrl = input.listingId ? `${input.origin}/annuncio/${input.listingId}` : null;
  const text = [
    `Nuova richiesta da giro.shop per ${partner.name}.`,
    '',
    `Nome: ${input.name}`,
    `Contatto: ${input.contact}`,
    listingUrl ? `Annuncio: ${listingUrl}` : '',
    '',
    input.message,
  ]
    .filter((l) => l !== null)
    .join('\n');
  const html = `<p>Nuova richiesta da giro.shop per <b>${escape(partner.name)}</b>.</p><p>Nome: ${escape(input.name)}<br>Contatto: ${escape(input.contact)}${
    listingUrl ? `<br>Annuncio: <a href="${escape(listingUrl)}">${escape(listingUrl)}</a>` : ''
  }</p><p>${escape(input.message).replace(/\n/g, '<br>')}</p>`;
  const sent = await sendMail({ to: partner.email, subject: `Richiesta da giro.shop: ${input.name}`, text, html });
  if (sent) await admin.from('partner_leads').update({ emailed_at: new Date().toISOString() }).eq('id', lead.id);
}

/** Richiesta per diventare partner: nasce spenta, la accende chi modera. */
export async function applyAsPartner(input: {
  name: string;
  service: Service;
  about?: string | null;
  districts: string[];
  website?: string | null;
  phone?: string | null;
  email: string;
}): Promise<void> {
  const admin = adminClient();
  if (!admin) throw new PartnerError('Richieste non disponibili: manca la configurazione del server.');
  const { error } = await admin.from('partners').insert({ ...input, active: false });
  if (error) throw new PartnerError(`Richiesta non inviata: ${error.message}`);
  cache = null;
}

export function forgetPartners(): void {
  cache = null;
}
