/**
 * Genera supabase/seed.sql dai dati di prova del prototipo.
 * Uso: node scripts/seed-sql.ts > supabase/seed.sql
 */
import { COMUNI } from '../src/core/comuni.ts';
import { CATEGORIES } from '../src/core/categories.ts';
import { LISTINGS } from '../src/data/listings.ts';

const q = (v: string | null | undefined) => (v == null ? 'null' : `'${v.replace(/'/g, "''")}'`);
const arr = (items: string[]) => `array[${items.map(q).join(', ')}]::text[]`;
const json = (v: unknown) => `${q(JSON.stringify(v))}::jsonb`;

const out: string[] = ['-- Generato da scripts/seed-sql.ts: dati di prova, non modificare a mano.', 'begin;', ''];

out.push('insert into public.comuni (id, name, cap, district, lat, lon, aliases) values');
out.push(
  COMUNI.map((c) => `  (${q(c.id)}, ${q(c.name)}, ${q(c.cap)}, ${q(c.district)}, ${c.lat}, ${c.lon}, ${arr(c.aliases ?? [])})`).join(',\n') +
    '\non conflict (id) do nothing;',
  '',
);

out.push('insert into public.categories (id, name) values');
out.push(CATEGORIES.map((c) => `  (${q(c.id)}, ${q(c.name)})`).join(',\n') + '\non conflict (id) do nothing;', '');

out.push(
  'insert into public.listings (status, title, description, category_id, tags, attributes, price_chf, negotiable, condition, comune_id, ai_source, published_at, sold_at, sold_price_chf) values',
);
out.push(
  LISTINGS.map(
    (l) =>
      `  (${q(l.status)}, ${q(l.title)}, ${q(l.description)}, ${q(l.category)}, ${arr(l.tags)}, ${json(l.attributes)}, ${l.priceChf}, ${Boolean(
        l.negotiable,
      )}, ${q(l.condition)}, ${q(l.comuneId)}, 'manuale', ${q(l.publishedAt)}, ${l.status === 'venduto' ? q(l.publishedAt) : 'null'}, ${
        l.soldPriceChf ?? 'null'
      })`,
  ).join(',\n') + ';',
  '',
);

out.push('commit;', '');
process.stdout.write(out.join('\n'));
