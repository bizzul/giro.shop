/**
 * Genera supabase/seed.sql dai dati di prova del prototipo.
 * Uso: node scripts/seed-sql.ts > supabase/seed.sql
 *
 * Crea un utente finto per ogni venditore (email @esempio.test, senza password: non può accedere),
 * gli annunci con i loro id leggibili (l-001…) e le foto di esempio con i crediti.
 */
import { COMUNI } from '../src/core/comuni.ts';
import { CATEGORIES } from '../src/core/categories.ts';
import { LISTINGS } from '../src/data/listings.ts';
import { PHOTOS } from '../src/data/photos.ts';
import { normalize } from '../src/core/text.ts';

const q = (v: string | null | undefined) => (v == null ? 'null' : `'${v.replace(/'/g, "''")}'`);
const arr = (items: string[]) => `array[${items.map(q).join(', ')}]::text[]`;
const json = (v: unknown) => `${q(JSON.stringify(v))}::jsonb`;
const email = (name: string) => `${normalize(name).replace(/ /g, '.')}@esempio.test`;

const out: string[] = ['-- Generato da scripts/seed-sql.ts: dati di prova, non modificare a mano.', 'begin;', ''];

out.push('insert into public.comuni (id, name, cap, district, lat, lon, aliases) values');
out.push(
  COMUNI.map((c) => `  (${q(c.id)}, ${q(c.name)}, ${q(c.cap)}, ${q(c.district)}, ${c.lat}, ${c.lon}, ${arr(c.aliases ?? [])})`).join(',\n') +
    '\non conflict (id) do nothing;',
  '',
);

out.push('insert into public.categories (id, name) values');
out.push(CATEGORIES.map((c) => `  (${q(c.id)}, ${q(c.name)})`).join(',\n') + '\non conflict (id) do nothing;', '');

// Venditori: un utente per nome; verificato se lo è in almeno un annuncio
const sellers = new Map<string, boolean>();
for (const l of LISTINGS) sellers.set(l.seller.name, (sellers.get(l.seller.name) ?? false) || l.seller.verified);

out.push('-- Venditori di prova: il profilo nasce dal trigger on_auth_user_created');
out.push(
  'insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change) values',
);
out.push(
  [...sellers.keys()]
    .map(
      (name) =>
        `  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', ${q(email(name))}, '', now(), '{"provider":"email","providers":["email"]}'::jsonb, ${json(
          { display_name: name },
        )}, now(), now(), '', '', '', '')`,
    )
    .join(',\n') + ';',
  '',
);
const verified = [...sellers].filter(([, v]) => v).map(([name]) => q(email(name)));
out.push(
  `update public.profiles p set phone_verified_at = now() from auth.users u where u.id = p.id and u.email in (${verified.join(', ')});`,
  '',
);

out.push(
  'insert into public.listings (id, seller_id, status, title, description, category_id, tags, attributes, price_chf, negotiable, condition, comune_id, ai_source, published_at, sold_at, sold_price_chf) values',
);
out.push(
  LISTINGS.map(
    (l) =>
      `  (${q(l.id)}, (select id from auth.users where email = ${q(email(l.seller.name))}), ${q(l.status)}, ${q(l.title)}, ${q(
        l.description,
      )}, ${q(l.category)}, ${arr(l.tags)}, ${json(l.attributes)}, ${l.priceChf}, ${Boolean(l.negotiable)}, ${q(l.condition)}, ${q(
        l.comuneId,
      )}, 'manuale', ${q(l.publishedAt)}, ${l.status === 'venduto' ? q(l.publishedAt) : 'null'}, ${l.soldPriceChf ?? 'null'})`,
  ).join(',\n') + ';',
  '',
);

const photos = Object.entries(PHOTOS);
out.push('-- Foto di esempio (servite da /public/foto), con i crediti richiesti dalla licenza');
out.push('insert into public.listing_photos (listing_id, storage_path, position, credit, width, height) values');
out.push(
  photos.map(([id, p]) => `  (${q(id)}, ${q(p.src)}, 0, ${json(p.credit)}, ${p.width}, ${p.height})`).join(',\n') + ';',
  '',
);

out.push('commit;', '');
process.stdout.write(out.join('\n'));
