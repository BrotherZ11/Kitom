-- =====================================================================
-- KITOM · Seed de datos de referencia (catálogos)
-- =====================================================================
-- Documentación: docs/SEED.md
--
-- Qué hace: inserta los catálogos que necesitan la app y la lógica SQL:
--   species · symptoms_catalog · symptom_species · achievements_catalog ·
--   catalog_translations (es/en de los anteriores).
--
-- Garantías:
--   * Aditivo e idempotente: solo INSERT ... ON CONFLICT DO NOTHING sobre las
--     constraints UNIQUE/PK reales. Se puede ejecutar cuantas veces se quiera.
--   * Nunca DELETE/TRUNCATE/DROP/UPDATE: no pisa ediciones manuales posteriores
--     (p. ej. activar una especie) ni borra nada.
--   * Sin datos de usuario: no toca auth.*, profiles, pets ni ninguna tabla
--     que dependa de un usuario. Sin UUIDs fijos: los ids se generan y las
--     relaciones se resuelven por `code`.
--   * Todo en una transacción: o se aplica completo o no se aplica nada.
--
-- No es una migración: el esquema vive en supabase/migrations/. En local se
-- aplica solo (config.toml [db.seed]); en kitom-dev se ejecuta a mano tras
-- aprobación (ver docs/SEED.md). Nunca mediante `db push`.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Especies
-- ---------------------------------------------------------------------
-- Activas (seleccionables al crear una mascota): perro y gato, según el
-- PRD (§16: "empezar con perro y gato, ampliar gradualmente"). El resto
-- queda preparado e inactivo; activarlas es una decisión de producto que
-- exige también vincular síntomas en symptom_species (sección 3).
-- Clave de conflicto: species_code_key UNIQUE (code).
insert into public.species (code, scientific_name, category, is_active) values
  ('dog',           'Canis lupus familiaris', 'mammal',  true),
  ('cat',           'Felis catus',            'mammal',  true),
  ('rabbit',        'Oryctolagus cuniculus',  'mammal',  false),
  ('guinea_pig',    'Cavia porcellus',        'mammal',  false),
  ('hamster',       null,                     'mammal',  false),
  ('horse',         'Equus ferus caballus',   'mammal',  false),
  ('bird_other',    null,                     'bird',    false),
  ('reptile_other', null,                     'reptile', false),
  ('other',         null,                     'other',   false)
on conflict (code) do nothing;

-- Nombres traducidos (field = 'name', el que lee el frontend).
-- Clave de conflicto: UNIQUE (entity_type, entity_id, locale, field).
insert into public.catalog_translations (entity_type, entity_id, locale, field, value)
select 'species', s.id, t.locale, 'name', t.value
from (values
  ('dog',           'es', 'Perro'),            ('dog',           'en', 'Dog'),
  ('cat',           'es', 'Gato'),             ('cat',           'en', 'Cat'),
  ('rabbit',        'es', 'Conejo'),           ('rabbit',        'en', 'Rabbit'),
  ('guinea_pig',    'es', 'Cobaya'),           ('guinea_pig',    'en', 'Guinea pig'),
  ('hamster',       'es', 'Hámster'),          ('hamster',       'en', 'Hamster'),
  ('horse',         'es', 'Caballo'),          ('horse',         'en', 'Horse'),
  ('bird_other',    'es', 'Ave (otra)'),       ('bird_other',    'en', 'Bird (other)'),
  ('reptile_other', 'es', 'Reptil (otro)'),    ('reptile_other', 'en', 'Reptile (other)'),
  ('other',         'es', 'Otro'),             ('other',         'en', 'Other')
) as t(code, locale, value)
join public.species s on s.code = t.code
on conflict (entity_type, entity_id, locale, field) do nothing;

-- ---------------------------------------------------------------------
-- 2. Síntomas visibles (análisis con IA, PRD §8.4)
-- ---------------------------------------------------------------------
-- Lista del PRD. Ampliarla requiere validación del veterinario colaborador.
-- Clave de conflicto: symptoms_catalog_code_key UNIQUE (code).
insert into public.symptoms_catalog (code, category) values
  ('watery_eyes',     'ocular'),
  ('limping',         'motor'),
  ('lethargy',        'general'),
  ('wound',           'skin'),
  ('appetite_loss',   'digestive'),
  ('excessive_vocal', 'behavior')
on conflict (code) do nothing;

-- Etiquetas traducidas (field = 'label').
insert into public.catalog_translations (entity_type, entity_id, locale, field, value)
select 'symptom', sc.id, t.locale, 'label', t.value
from (values
  ('watery_eyes',     'es', 'Ojos llorosos'),          ('watery_eyes',     'en', 'Watery eyes'),
  ('limping',         'es', 'Cojera'),                 ('limping',         'en', 'Limping'),
  ('lethargy',        'es', 'Decaimiento'),            ('lethargy',        'en', 'Lethargy'),
  ('wound',           'es', 'Heridas visibles'),       ('wound',           'en', 'Visible wound'),
  ('appetite_loss',   'es', 'Falta de apetito'),       ('appetite_loss',   'en', 'Loss of appetite'),
  ('excessive_vocal', 'es', 'Vocalización excesiva'),  ('excessive_vocal', 'en', 'Excessive vocalization')
) as t(code, locale, value)
join public.symptoms_catalog sc on sc.code = t.code
on conflict (entity_type, entity_id, locale, field) do nothing;

-- ---------------------------------------------------------------------
-- 3. Compatibilidad síntoma–especie
-- ---------------------------------------------------------------------
-- request_ai_analysis() y el trigger validate_symptom_species_compat
-- rechazan cualquier síntoma sin fila aquí para la especie de la mascota.
-- Solo especies activas (perro y gato).
-- Clave de conflicto: symptom_species_pkey PRIMARY KEY (symptom_id, species_id).
insert into public.symptom_species (symptom_id, species_id)
select sc.id, s.id
from public.symptoms_catalog sc
join (values
  ('watery_eyes'), ('limping'), ('lethargy'), ('wound'), ('appetite_loss'), ('excessive_vocal')
) as symptom(code) on symptom.code = sc.code
cross join public.species s
where s.code in ('dog', 'cat')
on conflict (symptom_id, species_id) do nothing;

-- ---------------------------------------------------------------------
-- 4. Logros
-- ---------------------------------------------------------------------
-- Los códigos deben coincidir EXACTAMENTE con los que otorga la BD:
--   recompute_pet_streak() → first_log, streak_7, streak_30
--   request_ai_analysis()  → first_photo_scan
-- award_pet_achievement() ignora en silencio un código inexistente.
-- Clave de conflicto: achievements_catalog_code_key UNIQUE (code).
insert into public.achievements_catalog (code, icon, sort_order, criteria) values
  ('first_log',        'paw',    1, '{"type":"count","metric":"daily_logs","value":1}'),
  ('streak_7',         'flame',  2, '{"type":"streak","days":7}'),
  ('first_photo_scan', 'camera', 3, '{"type":"count","metric":"ai_analysis_requests","value":1}'),
  ('streak_30',        'trophy', 4, '{"type":"streak","days":30}')
on conflict (code) do nothing;

-- Título y descripción traducidos (field = 'title' / 'description').
insert into public.catalog_translations (entity_type, entity_id, locale, field, value)
select 'achievement', a.id, t.locale, t.field, t.value
from (values
  ('first_log',        'es', 'title',       'Primer registro'),
  ('first_log',        'en', 'title',       'First log'),
  ('first_log',        'es', 'description', 'Completaste tu primer registro diario'),
  ('first_log',        'en', 'description', 'You completed your first daily log'),
  ('streak_7',         'es', 'title',       '7 días seguidos'),
  ('streak_7',         'en', 'title',       '7-day streak'),
  ('streak_7',         'es', 'description', 'Registraste el bienestar de tu mascota 7 días seguidos'),
  ('streak_7',         'en', 'description', 'You logged your pet''s wellbeing 7 days in a row'),
  ('first_photo_scan', 'es', 'title',       'Primer análisis con IA'),
  ('first_photo_scan', 'en', 'title',       'First AI analysis'),
  ('first_photo_scan', 'es', 'description', 'Usaste el análisis con foto por primera vez'),
  ('first_photo_scan', 'en', 'description', 'You used the photo AI analysis for the first time'),
  ('streak_30',        'es', 'title',       'Constancia mensual'),
  ('streak_30',        'en', 'title',       'Monthly consistency'),
  ('streak_30',        'es', 'description', '30 días de registro seguidos'),
  ('streak_30',        'en', 'description', '30 days of logging in a row')
) as t(code, locale, field, value)
join public.achievements_catalog a on a.code = t.code
on conflict (entity_type, entity_id, locale, field) do nothing;

commit;
