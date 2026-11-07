-- Le categorie che mancavano rispetto a MercatinoTicino (src/core/categories.ts)
insert into public.categories (id, name) values
  ('immobili', 'Case e immobili'),
  ('lavoro', 'Lavoro'),
  ('servizi', 'Servizi'),
  ('animali', 'Animali'),
  ('libri', 'Libri e film'),
  ('sport', 'Sport e hobby'),
  ('eventi', 'Eventi e biglietti'),
  ('viaggi', 'Viaggi e vacanze'),
  ('salute', 'Salute e bellezza'),
  ('gastronomia', 'Vini e gastronomia'),
  ('affari', 'Affari e attività')
on conflict (id) do nothing;
