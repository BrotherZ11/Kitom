-- ============================================================
-- KITOM v2.2.1 · 28 · DATOS SEMILLA
-- CAMBIO vs v2.2 (punto 11): todos los INSERT de catálogo ahora usan
-- ON CONFLICT DO NOTHING sobre su clave natural (code, o la
-- combinación única de catalog_translations / symptom_species). Antes
-- este archivo solo podía ejecutarse una vez sobre una base vacía; si
-- se volvía a ejecutar (por error, o al reaplicar el script completo
-- de v2.2.1 sobre una base que ya tenía estos datos de v2.2), fallaba
-- por violación de UNIQUE. Ahora es seguro de reejecutar: las filas
-- ya existentes se dejan tal cual, no se duplican ni se pisan datos
-- que pudieran haberse editado a mano después del seed inicial (por
-- eso es DO NOTHING y no DO UPDATE — no queremos sobrescribir
-- cambios manuales posteriores sin querer).
-- ============================================================

insert into public.species (code, scientific_name, category, is_active) values
  ('dog',           'Canis lupus familiaris', 'mammal', true),
  ('cat',           'Felis catus',            'mammal', true),
  ('rabbit',        'Oryctolagus cuniculus',  'mammal', false),
  ('horse',         'Equus ferus caballus',   'mammal', false),
  ('bird_other',    null,                     'bird',   false),
  ('reptile_other', null,                     'reptile',false),
  ('other',         null,                     'other',  false)
on conflict (code) do nothing;

insert into public.catalog_translations (entity_type, entity_id, locale, field, value)
select 'species', id, 'es', 'name', case code
  when 'dog' then 'Perro' when 'cat' then 'Gato' when 'rabbit' then 'Conejo'
  when 'horse' then 'Caballo' when 'bird_other' then 'Ave (otro)'
  when 'reptile_other' then 'Reptil (otro)' when 'other' then 'Otro' end
from public.species
on conflict (entity_type, entity_id, locale, field) do nothing;

insert into public.catalog_translations (entity_type, entity_id, locale, field, value)
select 'species', id, 'en', 'name', case code
  when 'dog' then 'Dog' when 'cat' then 'Cat' when 'rabbit' then 'Rabbit'
  when 'horse' then 'Horse' when 'bird_other' then 'Bird (other)'
  when 'reptile_other' then 'Reptile (other)' when 'other' then 'Other' end
from public.species
on conflict (entity_type, entity_id, locale, field) do nothing;

insert into public.symptoms_catalog (code, category) values
  ('watery_eyes', 'ocular'), ('limping', 'motor'), ('lethargy', 'general'),
  ('wound', 'skin'), ('appetite_loss', 'digestive'), ('excessive_vocal', 'behavior')
on conflict (code) do nothing;

insert into public.catalog_translations (entity_type, entity_id, locale, field, value)
select 'symptom', id, 'es', 'label', case code
  when 'watery_eyes' then 'Ojos llorosos' when 'limping' then 'Cojera'
  when 'lethargy' then 'Decaimiento' when 'wound' then 'Heridas visibles'
  when 'appetite_loss' then 'Falta de apetito' when 'excessive_vocal' then 'Vocalización excesiva' end
from public.symptoms_catalog
on conflict (entity_type, entity_id, locale, field) do nothing;

insert into public.catalog_translations (entity_type, entity_id, locale, field, value)
select 'symptom', id, 'en', 'label', case code
  when 'watery_eyes' then 'Watery eyes' when 'limping' then 'Limping'
  when 'lethargy' then 'Lethargy' when 'wound' then 'Visible wound'
  when 'appetite_loss' then 'Loss of appetite' when 'excessive_vocal' then 'Excessive vocalization' end
from public.symptoms_catalog
on conflict (entity_type, entity_id, locale, field) do nothing;

insert into public.symptom_species (symptom_id, species_id)
select sc.id, sp.id from public.symptoms_catalog sc
cross join public.species sp
where sp.code in ('dog','cat')
on conflict (symptom_id, species_id) do nothing;

insert into public.achievements_catalog (code, icon, sort_order, criteria) values
  ('first_log', 'paw', 1, '{"type":"count","metric":"daily_logs","value":1}'),
  ('streak_7', 'flame', 2, '{"type":"streak","days":7}'),
  ('first_photo_scan', 'camera', 3, '{"type":"count","metric":"ai_analysis_requests","value":1}'),
  ('streak_30', 'trophy', 4, '{"type":"streak","days":30}')
on conflict (code) do nothing;

insert into public.catalog_translations (entity_type, entity_id, locale, field, value)
select 'achievement', id, 'es', 'title', case code
  when 'first_log' then 'Primer registro' when 'streak_7' then '7 días seguidos'
  when 'first_photo_scan' then 'Primer análisis con IA' when 'streak_30' then 'Constancia mensual' end
from public.achievements_catalog
on conflict (entity_type, entity_id, locale, field) do nothing;

insert into public.catalog_translations (entity_type, entity_id, locale, field, value)
select 'achievement', id, 'en', 'title', case code
  when 'first_log' then 'First log' when 'streak_7' then '7-day streak'
  when 'first_photo_scan' then 'First AI analysis' when 'streak_30' then 'Monthly consistency' end
from public.achievements_catalog
on conflict (entity_type, entity_id, locale, field) do nothing;

insert into public.catalog_translations (entity_type, entity_id, locale, field, value)
select 'achievement', id, 'es', 'description', case code
  when 'first_log' then 'Completaste tu primer registro diario'
  when 'streak_7' then 'Registraste el bienestar de tu mascota 7 días seguidos'
  when 'first_photo_scan' then 'Usaste el análisis con foto por primera vez'
  when 'streak_30' then '30 días de registro seguidos' end
from public.achievements_catalog
on conflict (entity_type, entity_id, locale, field) do nothing;

insert into public.catalog_translations (entity_type, entity_id, locale, field, value)
select 'achievement', id, 'en', 'description', case code
  when 'first_log' then 'You completed your first daily log'
  when 'streak_7' then 'You logged your pet''s wellbeing 7 days in a row'
  when 'first_photo_scan' then 'You used the photo AI analysis for the first time'
  when 'streak_30' then '30 days of logging in a row' end
from public.achievements_catalog
on conflict (entity_type, entity_id, locale, field) do nothing;
