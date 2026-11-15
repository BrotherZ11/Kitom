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
-- Las 9 activas desde la migración *_species_fields.sql (decisión del
-- 2026-11-11), que también las crea si faltan. Orientación con IA en las 9
-- desde *_ai_guidance_v2.sql (species.ai_guidance_enabled, 2026-11-13), con
-- sus señales en la sección 2–3; borrador hasta la validación veterinaria.
-- Clave de conflicto: species_code_key UNIQUE (code).
insert into public.species (code, scientific_name, category, is_active) values
  ('dog',           'Canis lupus familiaris', 'mammal',  true),
  ('cat',           'Felis catus',            'mammal',  true),
  ('rabbit',        'Oryctolagus cuniculus',  'mammal',  true),
  ('guinea_pig',    'Cavia porcellus',        'mammal',  true),
  ('hamster',       null,                     'mammal',  true),
  ('horse',         'Equus ferus caballus',   'mammal',  true),
  ('bird_other',    null,                     'bird',    true),
  ('reptile_other', null,                     'reptile', true),
  ('other',         null,                     'other',   true)
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
  ('bird_other',    'es', 'Ave'),              ('bird_other',    'en', 'Bird'),
  ('reptile_other', 'es', 'Reptil'),           ('reptile_other', 'en', 'Reptile'),
  ('other',         'es', 'Otro'),             ('other',         'en', 'Other')
) as t(code, locale, value)
join public.species s on s.code = t.code
on conflict (entity_type, entity_id, locale, field) do nothing;

-- ---------------------------------------------------------------------
-- 2–3. Señales de la orientación con IA, sus nombres y sus especies
-- ---------------------------------------------------------------------
-- Una sola sentencia (como seeds/breeds.sql): cada señal con su categoría
-- (agrupa la pantalla de señales), su nombre es/en y las especies en las que
-- tiene sentido. request_ai_analysis() y el trigger
-- validate_symptom_species_compat rechazan una señal sin fila en
-- symptom_species para la especie de la mascota.
--
-- Las 6 primeras son las del PRD §8.4 (perro y gato desde el 2026-10); el
-- resto y las demás especies, del 2026-11-13 (orientación para las 9
-- especies, migración *_ai_guidance_v2.sql). BORRADOR: la lista, sus
-- especies y las reglas de urgencia de la Edge Function
-- (supabase/functions/ai-analysis-process/urgency.ts) deben validarse con el
-- veterinario asesor antes de publicar. Ejemplos de criterio: conejo, cobaya,
-- hámster y caballo no pueden vomitar (sin «vómitos»); «regurgita» solo en
-- ave y reptil; el pico, la muda o la cola al respirar, en su especie.
--
-- Categorías (textos en la app: consult.signs.categories): general,
-- digestive, oral, urinary, respiratory, skin, ocular (ojos y oídos), motor,
-- neuro, behavior.
-- Por DO NOTHING, reejecutarlo añade señales y especies nuevas sin cambiar
-- los nombres ni las categorías ya sembrados.
-- Claves de conflicto: symptoms_catalog_code_key UNIQUE (code), UNIQUE
-- (entity_type, entity_id, locale, field) y symptom_species_pkey.
with src (code, category, label_es, label_en, species) as (values
  -- General
  ('lethargy',              'general',     'Decaimiento',                                    'Lethargy',                                        array['dog','cat','rabbit','guinea_pig','hamster','horse','bird_other','reptile_other','other']),
  ('weight_loss',           'general',     'Pérdida de peso',                                'Weight loss',                                     array['dog','cat','rabbit','guinea_pig','hamster','horse','bird_other','reptile_other','other']),
  ('excessive_thirst',      'general',     'Bebe mucho más de lo normal',                    'Drinking much more than usual',                   array['dog','cat','rabbit','guinea_pig','hamster','horse','bird_other','other']),
  ('pain_signs',            'general',     'Parece dolorido al tocarlo o al moverse',        'Seems to be in pain when touched or moving',      array['dog','cat','rabbit','guinea_pig','hamster','horse','other']),
  ('toxin_ingestion',       'general',     'Puede haber comido algo tóxico',                 'May have eaten something toxic',                  array['dog','cat','rabbit','guinea_pig','hamster','horse','bird_other','reptile_other','other']),
  ('pale_gums',             'general',     'Encías pálidas, blancas o azuladas',             'Pale, white or bluish gums',                      array['dog','cat','horse','other']),
  ('sweating',              'general',     'Suda sin haber hecho ejercicio',                 'Sweating without having exercised',               array['horse']),
  -- Digestivo
  ('appetite_loss',         'digestive',   'Falta de apetito',                               'Loss of appetite',                                array['dog','cat','rabbit','guinea_pig','hamster','horse','bird_other','reptile_other','other']),
  ('not_eating',            'digestive',   'No come nada',                                   'Not eating at all',                               array['dog','cat','rabbit','guinea_pig','hamster','horse','bird_other','reptile_other','other']),
  ('vomiting',              'digestive',   'Vómitos',                                        'Vomiting',                                        array['dog','cat','other']),
  ('unproductive_retching', 'digestive',   'Arcadas sin conseguir vomitar',                  'Retching without bringing anything up',           array['dog']),
  ('regurgitation',         'digestive',   'Regurgita la comida',                            'Regurgitating food',                              array['bird_other','reptile_other']),
  ('diarrhea',              'digestive',   'Diarrea o heces muy blandas',                    'Diarrhoea or very soft stools',                   array['dog','cat','rabbit','guinea_pig','hamster','horse','reptile_other','other']),
  ('constipation',          'digestive',   'Le cuesta defecar',                              'Straining to pass stools',                        array['dog','cat','reptile_other','other']),
  ('no_droppings',          'digestive',   'No hace heces',                                  'Not passing droppings',                           array['rabbit','guinea_pig','hamster','horse','other']),
  ('small_droppings',       'digestive',   'Heces más pequeñas o escasas',                   'Smaller or fewer droppings',                      array['rabbit','guinea_pig']),
  ('droppings_change',      'digestive',   'Excrementos de color o aspecto distinto',        'Droppings changed in colour or look',             array['bird_other','reptile_other']),
  ('bloated_abdomen',       'digestive',   'Abdomen hinchado o duro',                        'Swollen or hard belly',                           array['dog','cat','rabbit','guinea_pig','horse','other']),
  ('colic_signs',           'digestive',   'Escarba, se mira el flanco o intenta revolcarse','Pawing, looking at its flank or trying to roll',  array['horse']),
  ('soiled_rear',           'digestive',   'Trasero sucio o mojado',                         'Dirty or wet rear end',                           array['rabbit','guinea_pig','hamster']),
  -- Boca
  ('drooling',              'oral',        'Babea mucho',                                    'Drooling a lot',                                  array['dog','cat','rabbit','guinea_pig','horse','other']),
  ('dental_problems',       'oral',        'Le cuesta masticar o se le cae la comida',       'Trouble chewing or dropping food',                array['dog','cat','rabbit','guinea_pig','hamster','horse','other']),
  ('teeth_grinding',        'oral',        'Rechina los dientes',                            'Grinding its teeth',                              array['rabbit','guinea_pig']),
  ('mouth_changes',         'oral',        'Boca con mucosidad, hinchazón o manchas',        'Mucus, swelling or spots in the mouth',           array['reptile_other']),
  ('beak_changes',          'oral',        'Pico dañado, deformado o demasiado largo',       'Damaged, misshapen or overgrown beak',            array['bird_other']),
  -- Orina
  ('urination_changes',     'urinary',     'Orina más o menos de lo normal',                 'Urinating more or less than usual',               array['dog','cat','rabbit','guinea_pig','hamster','horse','other']),
  ('straining_to_urinate',  'urinary',     'Hace fuerza para orinar y sale poco o nada',     'Straining to urinate with little or nothing out', array['dog','cat','rabbit','guinea_pig','other']),
  ('blood_in_urine',        'urinary',     'Sangre en la orina',                             'Blood in the urine',                              array['dog','cat','rabbit','guinea_pig','hamster','horse','other']),
  ('urinating_outside_box', 'urinary',     'Orina fuera del arenero',                        'Urinating outside the litter box',                array['cat','rabbit']),
  -- Respiración
  ('breathing_difficulty',  'respiratory', 'Le cuesta respirar',                             'Difficulty breathing',                            array['dog','cat','rabbit','guinea_pig','hamster','horse','bird_other','reptile_other','other']),
  ('open_mouth_breathing',  'respiratory', 'Respira con la boca abierta',                    'Breathing with its mouth open',                   array['cat','rabbit','guinea_pig','hamster','bird_other','reptile_other']),
  ('breathing_noises',      'respiratory', 'Ruidos o pitidos al respirar',                   'Noisy or wheezy breathing',                       array['dog','cat','rabbit','guinea_pig','hamster','horse','bird_other','reptile_other','other']),
  ('coughing',              'respiratory', 'Tos',                                            'Coughing',                                        array['dog','cat','horse','other']),
  ('sneezing',              'respiratory', 'Estornudos',                                     'Sneezing',                                        array['dog','cat','rabbit','guinea_pig','hamster','bird_other','other']),
  ('nasal_discharge',       'respiratory', 'Mucosidad o secreción por la nariz',             'Nasal discharge',                                 array['dog','cat','rabbit','guinea_pig','hamster','horse','bird_other','reptile_other','other']),
  ('tail_bobbing',          'respiratory', 'Mueve la cola al respirar',                      'Tail bobbing with each breath',                   array['bird_other']),
  -- Piel, pelo, plumas y escamas
  ('wound',                 'skin',        'Heridas visibles',                               'Visible wound',                                   array['dog','cat','rabbit','guinea_pig','hamster','horse','bird_other','reptile_other','other']),
  ('bleeding',              'skin',        'Sangrado',                                       'Bleeding',                                        array['dog','cat','rabbit','guinea_pig','hamster','horse','bird_other','reptile_other','other']),
  ('swelling',              'skin',        'Bulto o hinchazón',                              'Lump or swelling',                                array['dog','cat','rabbit','guinea_pig','hamster','horse','bird_other','reptile_other','other']),
  ('itching',               'skin',        'Se rasca o se lame mucho',                       'Scratching or licking a lot',                     array['dog','cat','rabbit','guinea_pig','hamster','horse','other']),
  ('hair_loss',             'skin',        'Pérdida de pelo o calvas',                       'Hair loss or bald patches',                       array['dog','cat','rabbit','guinea_pig','hamster','horse','other']),
  ('skin_redness',          'skin',        'Piel enrojecida, con costras o caspa',           'Red, crusty or flaky skin',                       array['dog','cat','rabbit','guinea_pig','hamster','horse','other']),
  ('parasites_seen',        'skin',        'Pulgas, garrapatas, ácaros u otros parásitos',   'Fleas, ticks, mites or other parasites',          array['dog','cat','rabbit','guinea_pig','hamster','horse','bird_other','reptile_other','other']),
  ('fly_larvae',            'skin',        'Gusanos o larvas en la piel o el pelo',          'Maggots on the skin or fur',                      array['dog','cat','rabbit','guinea_pig','horse','other']),
  ('overgrown_nails',       'skin',        'Uñas demasiado largas',                          'Overgrown nails',                                 array['rabbit','guinea_pig','hamster','bird_other','reptile_other']),
  ('feather_plucking',      'skin',        'Se arranca las plumas',                          'Plucking its feathers',                           array['bird_other']),
  ('fluffed_feathers',      'skin',        'Plumas ahuecadas durante mucho rato',            'Fluffed-up feathers for long periods',            array['bird_other']),
  ('retained_shed',         'skin',        'Muda incompleta o restos de piel pegados',       'Incomplete shed or stuck skin',                   array['reptile_other']),
  ('scale_changes',         'skin',        'Escamas o caparazón con manchas, blandos o dañados', 'Scales or shell discoloured, soft or damaged', array['reptile_other']),
  -- Ojos y oídos
  ('watery_eyes',           'ocular',      'Ojos llorosos',                                  'Watery eyes',                                     array['dog','cat','rabbit','guinea_pig','hamster','horse','bird_other','reptile_other','other']),
  ('eye_redness',           'ocular',      'Ojos rojos, hinchados o con legañas',            'Red, swollen or crusty eyes',                     array['dog','cat','rabbit','guinea_pig','hamster','horse','bird_other','reptile_other','other']),
  ('squinting',             'ocular',      'Guiña o mantiene un ojo cerrado',                'Squinting or keeping an eye closed',              array['dog','cat','rabbit','guinea_pig','hamster','horse','other']),
  ('sunken_eyes',           'ocular',      'Ojos hundidos',                                  'Sunken eyes',                                     array['rabbit','guinea_pig','bird_other','reptile_other','other']),
  ('ear_problems',          'ocular',      'Se rasca las orejas, mal olor o secreción',      'Ear scratching, odour or discharge',              array['dog','cat','rabbit','guinea_pig','horse','other']),
  ('head_shaking',          'ocular',      'Sacude la cabeza a menudo',                      'Shaking its head often',                          array['dog','cat','rabbit','horse']),
  -- Movimiento
  ('limping',               'motor',       'Cojera',                                         'Limping',                                         array['dog','cat','rabbit','guinea_pig','hamster','horse','bird_other','reptile_other','other']),
  ('stiffness',             'motor',       'Rigidez o le cuesta levantarse',                 'Stiffness or trouble getting up',                 array['dog','cat','rabbit','guinea_pig','horse','other']),
  ('hind_limb_weakness',    'motor',       'Debilidad o arrastra las patas traseras',        'Weak or dragging hind legs',                      array['dog','cat','rabbit','guinea_pig','hamster','reptile_other','other']),
  ('cant_stand',            'motor',       'No se tiene en pie o se ha desplomado',          'Can''t stand or has collapsed',                   array['dog','cat','rabbit','guinea_pig','hamster','horse','bird_other','reptile_other','other']),
  ('swollen_limbs',         'motor',       'Patas o mandíbula hinchadas o blandas',          'Swollen or soft legs or jaw',                     array['reptile_other']),
  ('sitting_on_floor',      'motor',       'Se queda en el suelo de la jaula',               'Staying on the cage floor',                       array['bird_other']),
  ('hoof_heat',             'motor',       'Casco caliente o pulso fuerte en la pata',       'Hot hoof or strong pulse in the leg',             array['horse']),
  -- Sistema nervioso
  ('seizures',              'neuro',       'Convulsiones',                                   'Seizures',                                        array['dog','cat','rabbit','guinea_pig','hamster','horse','bird_other','reptile_other','other']),
  ('trembling',             'neuro',       'Temblores',                                      'Trembling or shivering',                          array['dog','cat','rabbit','guinea_pig','hamster','horse','bird_other','other']),
  ('balance_loss',          'neuro',       'Pierde el equilibrio o camina en círculos',      'Losing balance or walking in circles',            array['dog','cat','rabbit','guinea_pig','hamster','horse','bird_other','reptile_other','other']),
  ('head_tilt',             'neuro',       'Cabeza ladeada',                                 'Head tilt',                                       array['dog','cat','rabbit','guinea_pig','hamster','bird_other','reptile_other','other']),
  ('disorientation',        'neuro',       'Desorientado o no responde como siempre',        'Disoriented or less responsive than usual',       array['dog','cat','rabbit','guinea_pig','hamster','horse','bird_other','reptile_other','other']),
  -- Comportamiento
  ('excessive_vocal',       'behavior',    'Vocalización excesiva',                          'Excessive vocalization',                          array['dog','cat','guinea_pig','horse','bird_other','other']),
  ('hiding',                'behavior',    'Se esconde más de lo normal',                    'Hiding more than usual',                          array['dog','cat','rabbit','guinea_pig','hamster','bird_other','reptile_other','other']),
  ('aggression_change',     'behavior',    'Más irritable o agresivo',                       'More irritable or aggressive',                    array['dog','cat','rabbit','guinea_pig','hamster','horse','bird_other','reptile_other','other']),
  ('restlessness',          'behavior',    'Inquieto, no encuentra postura',                 'Restless, can''t settle',                         array['dog','cat','horse','other']),
  ('not_basking',           'behavior',    'No se coloca bajo el foco de calor',             'Not basking',                                     array['reptile_other'])
),
inserted as (
  insert into public.symptoms_catalog (code, category)
  select code, category from src
  on conflict (code) do nothing
  returning id, code
),
-- Las filas insertadas en esta sentencia solo se ven por RETURNING.
symptom_ids as (
  select id, code from inserted
  union all
  select sc.id, sc.code from public.symptoms_catalog sc join src on src.code = sc.code
),
labels as (
  insert into public.catalog_translations (entity_type, entity_id, locale, field, value)
  select 'symptom', si.id, l.locale, 'label', l.value
  from symptom_ids si
  join src on src.code = si.code
  cross join lateral (values ('es', src.label_es), ('en', src.label_en)) as l (locale, value)
  on conflict (entity_type, entity_id, locale, field) do nothing
  returning 1
)
insert into public.symptom_species (symptom_id, species_id)
select si.id, s.id
from symptom_ids si
join src on src.code = si.code
cross join lateral unnest(src.species) as sp (code)
join public.species s on s.code = sp.code
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
