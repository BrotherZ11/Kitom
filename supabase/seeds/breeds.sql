-- =====================================================================
-- KITOM · Seed de razas (perro y gato)
-- =====================================================================
-- Documentación: docs/SEED.md · Requiere: migración *_breeds.sql y seed.sql
-- (las especies 'dog' y 'cat' deben existir; si no, sus razas se omiten).
--
-- Criterio del catálogo:
--   Perros: razas reconocidas por la FCI/RSCE con presencia real en Europa y
--   España, completadas con AKC/The Kennel Club; razas españolas reconocidas
--   por la RSCE; American Pit Bull Terrier (UKC) por su relevancia en España.
--   Las variedades de tamaño o pelo de una misma raza FCI se unifican
--   (caniche, teckel, pastor belga, spitz alemán); se separan las razas
--   reconocidas como distintas con perfil de salud propio (schnauzer
--   miniatura/mediano/gigante, akita/akita americano, pomerania).
--   Gatos: razas reconocidas por al menos dos de FIFe, CFA y TICA. Las
--   variantes de pelo de una misma raza se unifican (oriental, manx/cymric,
--   persa/himalayo). Un gato doméstico sin raza es breed_status = 'mixed',
--   no una raza del catálogo.
--   Ante la duda sobre una raza, se deja fuera (siempre cabe pets.breed).
--
-- Columnas: species_code · code (estable, inglés snake_case) · nombre es ·
--   nombre en · alias es · alias en. Los alias son opcionales, separados por
--   '|', y sirven para la búsqueda (catalog_translations.field = 'aliases').
--
-- Garantías: una sola sentencia; INSERT ... ON CONFLICT DO NOTHING sobre
-- breeds_species_id_code_key y catalog_translations (entity_type, entity_id,
-- locale, field). Sin DELETE/TRUNCATE/DROP/UPDATE, sin UUIDs fijos, sin
-- datos de usuario. Idempotente: reejecutarlo no duplica ni modifica nada.
-- =====================================================================

with data (species_code, code, name_es, name_en, aliases_es, aliases_en) as (
  values
  -- -------------------------------------------------------------------
  -- PERROS · Pastores y boyeros (FCI grupo 1)
  -- -------------------------------------------------------------------
  ('dog', 'german_shepherd',            'Pastor alemán',                     'German Shepherd Dog',            'Alsaciano',                                   'Alsatian|German Shepherd'),
  ('dog', 'belgian_shepherd',           'Pastor belga',                      'Belgian Shepherd Dog',           'Malinois|Groenendael|Tervueren|Laekenois',    'Belgian Malinois|Groenendael|Tervuren|Laekenois'),
  ('dog', 'dutch_shepherd',             'Pastor holandés',                   'Dutch Shepherd',                 null,                                          null),
  ('dog', 'white_swiss_shepherd',       'Pastor blanco suizo',               'White Swiss Shepherd Dog',       'Pastor suizo',                                'Berger Blanc Suisse'),
  ('dog', 'czechoslovakian_wolfdog',    'Perro lobo checoslovaco',           'Czechoslovakian Wolfdog',        'Lobo checoslovaco',                           null),
  ('dog', 'border_collie',              'Border collie',                     'Border Collie',                  null,                                          null),
  ('dog', 'rough_collie',               'Collie de pelo largo',              'Rough Collie',                   'Collie',                                      'Collie'),
  ('dog', 'shetland_sheepdog',          'Pastor de Shetland',                'Shetland Sheepdog',              'Sheltie',                                     'Sheltie'),
  ('dog', 'bearded_collie',             'Bearded collie',                    'Bearded Collie',                 null,                                          null),
  ('dog', 'old_english_sheepdog',       'Antiguo pastor inglés',             'Old English Sheepdog',           'Bobtail',                                     'Bobtail'),
  ('dog', 'australian_shepherd',        'Pastor australiano',                'Australian Shepherd',            'Aussie',                                      'Aussie'),
  ('dog', 'australian_cattle_dog',      'Boyero australiano',                'Australian Cattle Dog',          'Blue heeler|Red heeler',                      'Blue Heeler|Red Heeler'),
  ('dog', 'australian_kelpie',          'Kelpie australiano',                'Australian Kelpie',              'Kelpie',                                      'Kelpie'),
  ('dog', 'pembroke_welsh_corgi',       'Welsh corgi Pembroke',              'Pembroke Welsh Corgi',           'Corgi',                                       'Corgi'),
  ('dog', 'cardigan_welsh_corgi',       'Welsh corgi Cardigan',              'Cardigan Welsh Corgi',           null,                                          null),
  ('dog', 'bouvier_des_flandres',       'Boyero de Flandes',                 'Bouvier des Flandres',           null,                                          null),
  ('dog', 'briard',                     'Pastor de Brie',                    'Briard',                         'Briard',                                      null),
  ('dog', 'beauceron',                  'Pastor de Beauce',                  'Beauceron',                      'Beauceron',                                   null),
  ('dog', 'pyrenean_shepherd',          'Pastor de los Pirineos',            'Pyrenean Shepherd',              null,                                          null),
  ('dog', 'catalan_sheepdog',           'Perro de pastor catalán',           'Catalan Sheepdog',               'Gos d''atura català|Gos d''atura|Pastor catalán', 'Gos d''Atura Català'),
  ('dog', 'majorca_shepherd',           'Perro de pastor mallorquín',        'Majorca Shepherd Dog',           'Ca de bestiar|Pastor mallorquín',             'Ca de Bestiar'),
  ('dog', 'basque_shepherd',            'Pastor vasco',                      'Basque Shepherd Dog',            'Euskal artzain txakurra',                     'Euskal Artzain Txakurra'),
  ('dog', 'schipperke',                 'Schipperke',                        'Schipperke',                     null,                                          null),
  ('dog', 'caucasian_shepherd',         'Pastor del Cáucaso',                'Caucasian Shepherd Dog',         null,                                          'Caucasian Ovcharka'),

  -- -------------------------------------------------------------------
  -- PERROS · Pinscher, schnauzer, molosos y boyeros suizos (FCI grupo 2)
  -- -------------------------------------------------------------------
  ('dog', 'dobermann',                  'Dobermann',                         'Dobermann',                      'Doberman',                                    'Doberman Pinscher|Doberman'),
  ('dog', 'german_pinscher',            'Pinscher alemán',                   'German Pinscher',                null,                                          null),
  ('dog', 'miniature_pinscher',         'Pinscher miniatura',                'Miniature Pinscher',             'Mini pinscher|Pinscher enano',                'Min Pin'),
  ('dog', 'affenpinscher',              'Affenpinscher',                     'Affenpinscher',                  null,                                          null),
  ('dog', 'miniature_schnauzer',        'Schnauzer miniatura',               'Miniature Schnauzer',            'Schnauzer enano',                             null),
  ('dog', 'standard_schnauzer',         'Schnauzer mediano',                 'Standard Schnauzer',             'Schnauzer',                                   'Schnauzer'),
  ('dog', 'giant_schnauzer',            'Schnauzer gigante',                 'Giant Schnauzer',                null,                                          null),
  ('dog', 'boxer',                      'Bóxer',                             'Boxer',                          'Boxer',                                       null),
  ('dog', 'rottweiler',                 'Rottweiler',                        'Rottweiler',                     null,                                          null),
  ('dog', 'great_dane',                 'Gran danés',                        'Great Dane',                     'Dogo alemán',                                 'Deutsche Dogge'),
  ('dog', 'bullmastiff',                'Bullmastiff',                       'Bullmastiff',                    null,                                          null),
  ('dog', 'mastiff',                    'Mastiff',                           'Mastiff',                        'Mastín inglés',                               'English Mastiff'),
  ('dog', 'neapolitan_mastiff',         'Mastín napolitano',                 'Neapolitan Mastiff',             null,                                          null),
  ('dog', 'spanish_mastiff',            'Mastín español',                    'Spanish Mastiff',                'Mastín',                                      null),
  ('dog', 'pyrenean_mastiff',           'Mastín del Pirineo',                'Pyrenean Mastiff',               null,                                          null),
  ('dog', 'cane_corso',                 'Cane corso',                        'Cane Corso',                     'Cane corso italiano',                         'Cane Corso Italiano|Italian Mastiff'),
  ('dog', 'dogue_de_bordeaux',          'Dogo de Burdeos',                   'Dogue de Bordeaux',              null,                                          'French Mastiff'),
  ('dog', 'dogo_argentino',             'Dogo argentino',                    'Dogo Argentino',                 null,                                          'Argentine Dogo'),
  ('dog', 'dogo_canario',               'Dogo canario',                      'Dogo Canario',                   'Presa canario|Perro de presa canario',        'Presa Canario'),
  ('dog', 'ca_de_bou',                  'Perro dogo mallorquín',             'Ca de Bou',                      'Ca de bou|Presa mallorquín',                  'Majorca Mastiff'),
  ('dog', 'spanish_alano',              'Alano español',                     'Spanish Alano',                  'Alano',                                       null),
  ('dog', 'fila_brasileiro',            'Fila brasileño',                    'Fila Brasileiro',                null,                                          'Brazilian Mastiff'),
  ('dog', 'tibetan_mastiff',            'Dogo del Tíbet',                    'Tibetan Mastiff',                'Mastín tibetano',                             null),
  ('dog', 'shar_pei',                   'Shar pei',                          'Shar Pei',                       null,                                          'Chinese Shar-Pei'),
  ('dog', 'english_bulldog',            'Bulldog inglés',                    'Bulldog',                        'Bulldog',                                     'English Bulldog|British Bulldog'),
  ('dog', 'saint_bernard',              'San Bernardo',                      'St. Bernard',                    null,                                          'Saint Bernard'),
  ('dog', 'bernese_mountain_dog',       'Boyero de Berna',                   'Bernese Mountain Dog',           null,                                          null),
  ('dog', 'greater_swiss_mountain_dog', 'Gran boyero suizo',                 'Greater Swiss Mountain Dog',     null,                                          null),
  ('dog', 'newfoundland',               'Terranova',                         'Newfoundland',                   null,                                          null),
  ('dog', 'leonberger',                 'Leonberger',                        'Leonberger',                     null,                                          null),
  ('dog', 'pyrenean_mountain_dog',      'Perro de montaña de los Pirineos',  'Pyrenean Mountain Dog',          'Montaña de los Pirineos',                     'Great Pyrenees'),
  ('dog', 'hovawart',                   'Hovawart',                          'Hovawart',                       null,                                          null),

  -- -------------------------------------------------------------------
  -- PERROS · Terriers (FCI grupo 3) y ratoneros españoles (RSCE)
  -- -------------------------------------------------------------------
  ('dog', 'yorkshire_terrier',          'Yorkshire terrier',                 'Yorkshire Terrier',              'Yorkshire',                                   'Yorkie'),
  ('dog', 'jack_russell_terrier',       'Jack Russell terrier',              'Jack Russell Terrier',           'Jack Russell',                                'Jack Russell'),
  ('dog', 'parson_russell_terrier',     'Parson Russell terrier',            'Parson Russell Terrier',         null,                                          null),
  ('dog', 'west_highland_white_terrier','West Highland white terrier',       'West Highland White Terrier',    'Westie',                                      'Westie'),
  ('dog', 'scottish_terrier',           'Terrier escocés',                   'Scottish Terrier',               'Scottish terrier',                            'Scottie'),
  ('dog', 'cairn_terrier',              'Cairn terrier',                     'Cairn Terrier',                  null,                                          null),
  ('dog', 'border_terrier',             'Border terrier',                    'Border Terrier',                 null,                                          null),
  ('dog', 'airedale_terrier',           'Airedale terrier',                  'Airedale Terrier',               null,                                          null),
  ('dog', 'welsh_terrier',              'Welsh terrier',                     'Welsh Terrier',                  null,                                          null),
  ('dog', 'soft_coated_wheaten_terrier','Terrier irlandés de pelo suave',    'Soft Coated Wheaten Terrier',    'Wheaten terrier',                             'Wheaten Terrier'),
  ('dog', 'smooth_fox_terrier',         'Fox terrier de pelo liso',          'Smooth Fox Terrier',             'Fox terrier',                                 'Fox Terrier'),
  ('dog', 'wire_fox_terrier',           'Fox terrier de pelo duro',          'Wire Fox Terrier',               'Fox terrier',                                 'Fox Terrier'),
  ('dog', 'german_hunting_terrier',     'Terrier alemán de caza',            'German Hunting Terrier',         'Jagdterrier',                                 'Jagdterrier'),
  ('dog', 'bull_terrier',               'Bull terrier',                      'Bull Terrier',                   null,                                          null),
  ('dog', 'miniature_bull_terrier',     'Bull terrier miniatura',            'Miniature Bull Terrier',         null,                                          null),
  ('dog', 'staffordshire_bull_terrier', 'Staffordshire bull terrier',        'Staffordshire Bull Terrier',     'Staffy',                                      'Staffy|Staffie'),
  ('dog', 'american_staffordshire_terrier','American Staffordshire terrier', 'American Staffordshire Terrier', 'Amstaff',                                     'AmStaff'),
  ('dog', 'american_pit_bull_terrier',  'American pit bull terrier',         'American Pit Bull Terrier',      'Pitbull|Pit bull',                            'Pit Bull|Pitbull'),
  ('dog', 'andalusian_ratter',          'Ratonero bodeguero andaluz',        'Andalusian Wine-Cellar Rat-Hunting Dog', 'Bodeguero|Ratonero andaluz',         'Andalusian Ratter'),
  ('dog', 'valencian_ratter',           'Ratonero valenciano',               'Valencian Ratter',               'Gos rater valencià',                          'Gos Rater Valencià'),

  -- -------------------------------------------------------------------
  -- PERROS · Teckels (FCI grupo 4)
  -- -------------------------------------------------------------------
  ('dog', 'dachshund',                  'Teckel',                            'Dachshund',                      'Dachshund|Perro salchicha',                   'Teckel|Sausage dog|Wiener dog'),

  -- -------------------------------------------------------------------
  -- PERROS · Spitz y tipo primitivo (FCI grupo 5)
  -- -------------------------------------------------------------------
  ('dog', 'siberian_husky',             'Husky siberiano',                   'Siberian Husky',                 'Husky',                                       'Husky'),
  ('dog', 'alaskan_malamute',           'Alaskan malamute',                  'Alaskan Malamute',               'Malamute',                                    'Malamute'),
  ('dog', 'samoyed',                    'Samoyedo',                          'Samoyed',                        null,                                          null),
  ('dog', 'akita',                      'Akita',                             'Akita',                          'Akita inu',                                   'Akita Inu|Japanese Akita'),
  ('dog', 'american_akita',             'Akita americano',                   'American Akita',                 null,                                          null),
  ('dog', 'shiba_inu',                  'Shiba inu',                         'Shiba Inu',                      'Shiba',                                       'Shiba'),
  ('dog', 'german_spitz',               'Spitz alemán',                      'German Spitz',                   'Keeshond',                               'Keeshond'),
  ('dog', 'pomeranian',                 'Pomerania',                         'Pomeranian',                     'Lulú de Pomerania|Spitz enano',               'Pom|Dwarf Spitz'),
  ('dog', 'japanese_spitz',             'Spitz japonés',                     'Japanese Spitz',                 null,                                          null),
  ('dog', 'eurasier',                   'Eurasier',                          'Eurasier',                       null,                                          null),
  ('dog', 'chow_chow',                  'Chow chow',                         'Chow Chow',                      null,                                          null),
  ('dog', 'basenji',                    'Basenji',                           'Basenji',                        null,                                          null),
  ('dog', 'pharaoh_hound',              'Perro del faraón',                  'Pharaoh Hound',                  null,                                          null),
  ('dog', 'ibizan_hound',               'Podenco ibicenco',                  'Ibizan Podenco',                 'Ca eivissenc',                                'Ibizan Hound'),
  ('dog', 'canarian_podenco',           'Podenco canario',                   'Canarian Warren Hound',          null,                                          'Podenco Canario'),
  ('dog', 'andalusian_podenco',         'Podenco andaluz',                   'Andalusian Hound',               null,                                          'Podenco Andaluz'),
  ('dog', 'portuguese_podengo',         'Podenco portugués',                 'Portuguese Podengo',             null,                                          null),
  ('dog', 'xoloitzcuintle',             'Perro sin pelo mexicano',           'Xoloitzcuintle',                 'Xoloitzcuintle|Xolo',                         'Xolo|Mexican Hairless Dog'),
  ('dog', 'peruvian_hairless_dog',      'Perro sin pelo del Perú',           'Peruvian Hairless Dog',          null,                                          null),

  -- -------------------------------------------------------------------
  -- PERROS · Sabuesos y rastreo (FCI grupo 6)
  -- -------------------------------------------------------------------
  ('dog', 'beagle',                     'Beagle',                            'Beagle',                         null,                                          null),
  ('dog', 'basset_hound',               'Basset hound',                      'Basset Hound',                   'Basset',                                      'Basset'),
  ('dog', 'bloodhound',                 'Perro de San Huberto',              'Bloodhound',                     'Bloodhound',                                  'St. Hubert Hound'),
  ('dog', 'spanish_hound',              'Sabueso español',                   'Spanish Hound',                  null,                                          null),
  ('dog', 'bavarian_mountain_scent_hound','Sabueso de montaña de Baviera',   'Bavarian Mountain Scent Hound',  'Sabueso bávaro',                              'Bavarian Mountain Hound'),
  ('dog', 'dalmatian',                  'Dálmata',                           'Dalmatian',                      null,                                          null),
  ('dog', 'rhodesian_ridgeback',        'Rhodesian ridgeback',               'Rhodesian Ridgeback',            null,                                          null),

  -- -------------------------------------------------------------------
  -- PERROS · Perros de muestra (FCI grupo 7)
  -- -------------------------------------------------------------------
  ('dog', 'german_shorthaired_pointer', 'Braco alemán de pelo corto',        'German Shorthaired Pointer',     'Kurzhaar',                                    'Kurzhaar'),
  ('dog', 'german_wirehaired_pointer',  'Braco alemán de pelo duro',         'German Wirehaired Pointer',      'Drahthaar',                                   'Drahthaar'),
  ('dog', 'weimaraner',                 'Braco de Weimar',                   'Weimaraner',                     'Weimaraner',                                  null),
  ('dog', 'hungarian_vizsla',           'Braco húngaro de pelo corto',       'Hungarian Vizsla',               'Vizsla',                                      'Vizsla'),
  ('dog', 'italian_pointer',            'Braco italiano',                    'Bracco Italiano',                null,                                          'Italian Pointer'),
  ('dog', 'burgos_pointer',             'Perdiguero de Burgos',              'Burgos Pointer',                 null,                                          null),
  ('dog', 'english_pointer',            'Pointer inglés',                    'English Pointer',                'Pointer',                                     'Pointer'),
  ('dog', 'english_setter',             'Setter inglés',                     'English Setter',                 null,                                          null),
  ('dog', 'irish_setter',               'Setter irlandés',                   'Irish Red Setter',               null,                                          'Irish Setter'),
  ('dog', 'gordon_setter',              'Setter Gordon',                     'Gordon Setter',                  null,                                          null),
  ('dog', 'brittany',                   'Epagneul bretón',                   'Brittany',                       'Bretón',                                      'Brittany Spaniel|Epagneul Breton'),

  -- -------------------------------------------------------------------
  -- PERROS · Cobradores, levantadores y de agua (FCI grupo 8)
  -- -------------------------------------------------------------------
  ('dog', 'labrador_retriever',         'Labrador retriever',                'Labrador Retriever',             'Labrador',                                    'Labrador|Lab'),
  ('dog', 'golden_retriever',           'Golden retriever',                  'Golden Retriever',               'Golden',                                      'Golden'),
  ('dog', 'flat_coated_retriever',      'Retriever de pelo liso',            'Flat-Coated Retriever',          'Flat coated',                                 null),
  ('dog', 'chesapeake_bay_retriever',   'Retriever de la bahía de Chesapeake','Chesapeake Bay Retriever',      'Chesapeake',                                  'Chessie'),
  ('dog', 'nova_scotia_duck_tolling_retriever','Retriever de Nueva Escocia', 'Nova Scotia Duck Tolling Retriever','Toller',                                 'Toller'),
  ('dog', 'english_cocker_spaniel',     'Cocker spaniel inglés',             'English Cocker Spaniel',         'Cocker inglés|Cocker',                        'Cocker Spaniel'),
  ('dog', 'american_cocker_spaniel',    'Cocker americano',                  'American Cocker Spaniel',        'Cocker spaniel americano',                    'Cocker Spaniel'),
  ('dog', 'english_springer_spaniel',   'Springer spaniel inglés',           'English Springer Spaniel',       'Springer',                                    'Springer'),
  ('dog', 'spanish_water_dog',          'Perro de agua español',             'Spanish Water Dog',              null,                                          null),
  ('dog', 'portuguese_water_dog',       'Perro de agua portugués',           'Portuguese Water Dog',           null,                                          null),
  ('dog', 'lagotto_romagnolo',          'Lagotto romagnolo',                 'Lagotto Romagnolo',              'Lagotto',                                     'Lagotto'),

  -- -------------------------------------------------------------------
  -- PERROS · Compañía (FCI grupo 9)
  -- -------------------------------------------------------------------
  ('dog', 'poodle',                     'Caniche',                           'Poodle',                         'Poodle|Caniche toy|Caniche enano',            'Toy Poodle|Miniature Poodle|Standard Poodle|Caniche'),
  ('dog', 'bichon_frise',               'Bichón frisé',                      'Bichon Frise',                   null,                                          null),
  ('dog', 'maltese',                    'Bichón maltés',                     'Maltese',                        'Maltés',                                      null),
  ('dog', 'bolognese',                  'Bichón boloñés',                    'Bolognese',                      'Boloñés',                                     null),
  ('dog', 'havanese',                   'Bichón habanero',                   'Havanese',                       'Habanero',                                    null),
  ('dog', 'coton_de_tulear',            'Coton de Tuléar',                   'Coton de Tulear',                null,                                          null),
  ('dog', 'shih_tzu',                   'Shih tzu',                          'Shih Tzu',                       null,                                          null),
  ('dog', 'lhasa_apso',                 'Lhasa apso',                        'Lhasa Apso',                     null,                                          null),
  ('dog', 'tibetan_terrier',            'Terrier tibetano',                  'Tibetan Terrier',                null,                                          null),
  ('dog', 'pekingese',                  'Pequinés',                          'Pekingese',                      null,                                          null),
  ('dog', 'pug',                        'Carlino',                           'Pug',                            'Pug',                                         'Mops'),
  ('dog', 'chihuahua',                  'Chihuahua',                         'Chihuahua',                      null,                                          null),
  ('dog', 'papillon',                   'Papillón',                          'Papillon',                       'Spaniel continental enano|Phalène',           'Continental Toy Spaniel|Phalene'),
  ('dog', 'cavalier_king_charles_spaniel','Cavalier King Charles spaniel',   'Cavalier King Charles Spaniel',  'Cavalier',                                    'Cavalier'),
  ('dog', 'king_charles_spaniel',       'King Charles spaniel',              'King Charles Spaniel',           null,                                          'English Toy Spaniel'),
  ('dog', 'japanese_chin',              'Spaniel japonés',                   'Japanese Chin',                  'Chin',                                        null),
  ('dog', 'chinese_crested',            'Perro crestado chino',              'Chinese Crested Dog',            'Crestado chino',                              'Chinese Crested'),
  ('dog', 'boston_terrier',             'Boston terrier',                    'Boston Terrier',                 null,                                          null),
  ('dog', 'french_bulldog',             'Bulldog francés',                   'French Bulldog',                 null,                                          'Frenchie'),
  ('dog', 'griffon_bruxellois',         'Grifón de Bruselas',                'Griffon Bruxellois',             null,                                          'Brussels Griffon'),
  ('dog', 'russian_toy',                'Toy ruso',                          'Russian Toy',                    'Russkiy toy',                                 'Russkiy Toy'),

  -- -------------------------------------------------------------------
  -- PERROS · Lebreles (FCI grupo 10)
  -- -------------------------------------------------------------------
  ('dog', 'spanish_greyhound',          'Galgo español',                     'Spanish Greyhound',              'Galgo',                                       'Galgo Español'),
  ('dog', 'greyhound',                  'Galgo inglés',                      'Greyhound',                      'Greyhound',                                   'English Greyhound'),
  ('dog', 'whippet',                    'Whippet',                           'Whippet',                        null,                                          null),
  ('dog', 'italian_greyhound',          'Lebrel italiano',                   'Italian Greyhound',              'Galgo italiano|Pequeño lebrel italiano',      'Italian Sighthound'),
  ('dog', 'afghan_hound',               'Lebrel afgano',                     'Afghan Hound',                   'Galgo afgano',                                null),
  ('dog', 'saluki',                     'Saluki',                            'Saluki',                         null,                                          null),
  ('dog', 'borzoi',                     'Borzoi',                            'Borzoi',                         'Galgo ruso',                                  'Russian Wolfhound'),
  ('dog', 'irish_wolfhound',            'Lebrel irlandés',                   'Irish Wolfhound',                'Irish wolfhound',                             null),
  ('dog', 'scottish_deerhound',         'Lebrel escocés',                    'Scottish Deerhound',             'Deerhound',                                   'Deerhound'),

  -- -------------------------------------------------------------------
  -- GATOS · Pelo largo y semilargo
  -- -------------------------------------------------------------------
  ('cat', 'persian',                    'Persa',                             'Persian',                        'Himalayo',                                    'Himalayan'),
  ('cat', 'maine_coon',                 'Maine coon',                        'Maine Coon',                     null,                                          null),
  ('cat', 'ragdoll',                    'Ragdoll',                           'Ragdoll',                        null,                                          null),
  ('cat', 'ragamuffin',                 'RagaMuffin',                        'RagaMuffin',                     null,                                          null),
  ('cat', 'norwegian_forest_cat',       'Bosque de Noruega',                 'Norwegian Forest Cat',           'Gato noruego del bosque',                     'Wegie'),
  ('cat', 'siberian',                   'Siberiano',                         'Siberian',                       'Neva masquerade',                             'Neva Masquerade'),
  ('cat', 'birman',                     'Sagrado de Birmania',               'Birman',                         'Birmano',                                     'Sacred Cat of Burma'),
  ('cat', 'turkish_angora',             'Angora turco',                      'Turkish Angora',                 'Angora',                                      null),
  ('cat', 'turkish_van',                'Van turco',                         'Turkish Van',                    null,                                          null),
  ('cat', 'balinese',                   'Balinés',                           'Balinese',                       null,                                          null),
  ('cat', 'somali',                     'Somalí',                            'Somali',                         null,                                          null),
  ('cat', 'british_longhair',           'Británico de pelo largo',           'British Longhair',               null,                                          null),
  ('cat', 'kurilian_bobtail',           'Bobtail de las Kuriles',            'Kurilian Bobtail',               null,                                          null),

  -- -------------------------------------------------------------------
  -- GATOS · Pelo corto
  -- -------------------------------------------------------------------
  ('cat', 'exotic_shorthair',           'Exótico de pelo corto',             'Exotic Shorthair',               'Exótico',                                     'Exotic'),
  ('cat', 'british_shorthair',          'Británico de pelo corto',           'British Shorthair',              'British',                                     null),
  ('cat', 'american_shorthair',         'Americano de pelo corto',           'American Shorthair',             null,                                          null),
  ('cat', 'scottish_fold',              'Scottish fold',                     'Scottish Fold',                  'Fold escocés',                                null),
  ('cat', 'chartreux',                  'Cartujo',                           'Chartreux',                      'Chartreux',                                   null),
  ('cat', 'russian_blue',               'Azul ruso',                         'Russian Blue',                   null,                                          null),
  ('cat', 'siamese',                    'Siamés',                            'Siamese',                        null,                                          null),
  ('cat', 'thai',                       'Thai',                              'Thai',                           'Siamés tradicional',                          'Traditional Siamese'),
  ('cat', 'oriental',                   'Oriental',                          'Oriental',                       'Oriental de pelo corto|Oriental de pelo largo','Oriental Shorthair|Oriental Longhair'),
  ('cat', 'abyssinian',                 'Abisinio',                          'Abyssinian',                     null,                                          null),
  ('cat', 'bengal',                     'Bengalí',                           'Bengal',                         'Bengal',                                      null),
  ('cat', 'egyptian_mau',               'Mau egipcio',                       'Egyptian Mau',                   null,                                          null),
  ('cat', 'ocicat',                     'Ocicat',                            'Ocicat',                         null,                                          null),
  ('cat', 'burmese',                    'Burmés',                            'Burmese',                        null,                                          null),
  ('cat', 'burmilla',                   'Burmilla',                          'Burmilla',                       null,                                          null),
  ('cat', 'bombay',                     'Bombay',                            'Bombay',                         null,                                          null),
  ('cat', 'tonkinese',                  'Tonkinés',                          'Tonkinese',                      null,                                          null),
  ('cat', 'korat',                      'Korat',                             'Korat',                          null,                                          null),
  ('cat', 'singapura',                  'Singapura',                         'Singapura',                      null,                                          null),
  ('cat', 'havana_brown',               'Havana',                            'Havana Brown',                   'Havana brown',                                'Havana'),
  ('cat', 'manx',                       'Manx',                              'Manx',                           'Gato de la isla de Man|Cymric',               'Cymric'),
  ('cat', 'japanese_bobtail',           'Bobtail japonés',                   'Japanese Bobtail',               null,                                          null),
  ('cat', 'american_bobtail',           'Bobtail americano',                 'American Bobtail',               null,                                          null),
  ('cat', 'american_curl',              'American curl',                     'American Curl',                  'Curl americano',                              null),

  -- -------------------------------------------------------------------
  -- GATOS · Sin pelo y pelo rizado
  -- -------------------------------------------------------------------
  ('cat', 'sphynx',                     'Esfinge',                           'Sphynx',                         'Sphynx|Gato esfinge',                         null),
  ('cat', 'peterbald',                  'Peterbald',                         'Peterbald',                      null,                                          null),
  ('cat', 'devon_rex',                  'Devon rex',                         'Devon Rex',                      null,                                          null),
  ('cat', 'cornish_rex',                'Cornish rex',                       'Cornish Rex',                    null,                                          null),
  ('cat', 'selkirk_rex',                'Selkirk rex',                       'Selkirk Rex',                    null,                                          null),
  ('cat', 'laperm',                     'LaPerm',                            'LaPerm',                         null,                                          null)
),
resolved as (
  -- Solo especies existentes; el join descarta filas de especies no sembradas.
  select s.id as species_id, d.*
  from data d
  join public.species s on s.code = d.species_code
),
inserted as (
  insert into public.breeds (species_id, code)
  select species_id, code from resolved
  on conflict (species_id, code) do nothing
  returning id, species_id, code
),
breed_ids as (
  -- Razas creadas ahora (inserted) más las que ya existían. La consulta sobre
  -- breeds ve el estado previo a esta sentencia, así que no hay solapes.
  select id, species_id, code from inserted
  union all
  select b.id, b.species_id, b.code
  from public.breeds b
  join resolved r on r.species_id = b.species_id and r.code = b.code
)
insert into public.catalog_translations (entity_type, entity_id, locale, field, value)
select 'breed', bi.id, t.locale, t.field, t.value
from resolved r
join breed_ids bi on bi.species_id = r.species_id and bi.code = r.code
cross join lateral (values
  ('es', 'name',    r.name_es),
  ('en', 'name',    r.name_en),
  ('es', 'aliases', r.aliases_es),
  ('en', 'aliases', r.aliases_en)
) as t (locale, field, value)
where t.value is not null
on conflict (entity_type, entity_id, locale, field) do nothing;
