# Kitom — Seed de datos de referencia

Los seeds cargan los **catálogos** que necesitan la app y la lógica SQL. Son independientes de las
migraciones: las migraciones definen la estructura (`supabase/migrations/`); los seeds solo insertan
datos de referencia.

| Archivo | Contenido | Requiere |
|---|---|---|
| `supabase/seed.sql` | Especies, síntomas, compatibilidad síntoma–especie, logros y sus traducciones | Migración base |
| `supabase/seeds/breeds.sql` | Razas de perro y gato con nombres y alias es/en | Migración `*_breeds.sql` y `seed.sql` |

Orden obligatorio: **`seed.sql` → `seeds/breeds.sql`** (las razas se enlazan a especies por `code`).
En local lo fija `config.toml` → `[db.seed] sql_paths = ["./seed.sql", "./seeds/breeds.sql"]`.

## 1. Qué contiene

### `seed.sql`

| Tabla | Filas | Para qué |
|---|---|---|
| `species` | 9: `dog`, `cat` **activas**; `rabbit`, `guinea_pig`, `hamster`, `horse`, `bird_other`, `reptile_other`, `other` inactivas | Selector de especie al crear mascota (solo activas) |
| `catalog_translations` (`species`, `name`) | 18 (es/en) | Nombre visible de la especie |
| `symptoms_catalog` | 6 (lista del PRD §8.4) | Síntomas seleccionables en el análisis con IA |
| `catalog_translations` (`symptom`, `label`) | 12 (es/en) | Etiqueta visible del síntoma |
| `symptom_species` | 12 (6 síntomas × perro y gato) | `request_ai_analysis()` y el trigger `validate_symptom_species_compat` rechazan síntomas sin fila aquí |
| `achievements_catalog` | 4: `first_log`, `streak_7`, `first_photo_scan`, `streak_30` | Códigos que otorgan `recompute_pet_streak()` y `request_ai_analysis()` |
| `catalog_translations` (`achievement`, `title`/`description`) | 16 (es/en) | Textos de los logros |

Total: 77 filas.

### `seeds/breeds.sql`

| Tabla | Filas | Para qué |
|---|---|---|
| `breeds` | 198: 155 de perro y 43 de gato | Selector de raza (opcional) al crear/editar mascota |
| `catalog_translations` (`breed`, `name`) | 396 (es/en, todas las razas) | Nombre visible de la raza |
| `catalog_translations` (`breed`, `aliases`) | 198 (104 es + 94 en, solo cuando aportan) | Búsqueda por sinónimos; valores separados por `\|` |

Total: 792 filas. Ninguna raza para especies inactivas.

### Criterios

- **Solo perro y gato activos**: el PRD (§16) pide empezar con perro y gato y ampliar gradualmente
  por la precisión de la IA. Activar otra especie es una decisión de producto y requiere además
  vincularle síntomas en `symptom_species`; si no, el análisis con IA fallaría para esa especie.
- **Síntomas**: exactamente los del PRD. Ampliar la lista requiere validación veterinaria (PRD §10).
- **Logros**: los códigos coinciden con los que usa la BD; `award_pet_achievement()` ignora en
  silencio un código que no exista, así que no se deben renombrar.
- **Razas de perro**: reconocidas por FCI/RSCE con presencia real en Europa y España, completadas con
  AKC/The Kennel Club; razas españolas de la RSCE (p. ej. alano español, podenco andaluz, ratoneros
  bodeguero andaluz y valenciano, pastor vasco). Excepción documentada: American Pit Bull Terrier (UKC),
  por su relevancia en España.
- **Razas de gato**: reconocidas por al menos dos de FIFe, CFA y TICA. Fuera: European Shorthair (solo
  FIFe; en España «europeo común» suele significar gato sin raza), Savannah, Munchkin, Toyger,
  Donskoy y otras con reconocimiento dudoso o en un solo registro.
- **Variedades**: se unifican las variedades de tamaño o pelo de una misma raza (caniche, teckel,
  pastor belga, spitz alemán; persa/himalayo, oriental, manx/cymric) y se separan las razas
  reconocidas como distintas con perfil de salud propio (schnauzer miniatura/mediano/gigante,
  akita/akita americano, pomerania, bull terrier/bull terrier miniatura).
- **Sin razas ficticias**: «mestizo» y «no sé» son `pets.breed_status`, no razas. Una raza no
  catalogada se guarda como texto en `pets.breed` (`breed_status = 'known'`).
- **Códigos** estables en inglés snake_case (`labrador_retriever`), únicos por especie. Nombres:
  `es` según FCI/RSCE o el uso común en España; `en` según FCI/AKC/Kennel Club o FIFe/CFA/TICA.
- Ante la duda sobre una raza, se deja fuera.

## 2. Qué NO toca (deliberadamente)

- **Datos de usuario**: `auth.*`, `profiles`, `pets`, `pet_co_owners`, `daily_logs`, `reminders`,
  `ai_analysis_requests`, `ai_analysis_symptoms`, `pet_achievements`, `pet_streaks`, `push_tokens`,
  `notification_preferences`, `pet_shared_reports`, `analytics_events`, `clinic_referrals`.
  Se crean con usuarios reales desde la app. `profiles`, `notification_preferences` y
  `subscriptions` los crea el trigger `handle_new_user` al registrarse.
- **Sistema**: `subscriptions`, `subscription_events` (los gestiona el webhook de RevenueCat).
- **`vet_clinics`**: son datos reales de clínicas colaboradoras; no se inventan.
- **Storage**: los buckets (`pet-photos`, `reminder-attachments`, `shared-reports`, `avatars`) ya
  existen en `kitom-dev`. En local no existen; se resolverá aparte (declararlos en `config.toml`).
- **Enums** (`reminder_type`, `pet_sex`, `breed_status`, `urgency_level`…): son tipos del esquema.
- **Esquema**: ni tablas, ni RLS, ni funciones (eso es de las migraciones).

## 3. Garantías

- **Idempotente y aditivo**: solo `INSERT … ON CONFLICT DO NOTHING` sobre las constraints reales
  (`species.code`, `symptoms_catalog.code`, `achievements_catalog.code`, PK de `symptom_species`,
  `breeds (species_id, code)`, `UNIQUE (entity_type, entity_id, locale, field)` de
  `catalog_translations`).
- **Sin `DELETE`, `TRUNCATE`, `DROP` ni `UPDATE`**: no borra nada y no pisa ediciones manuales. Por
  ejemplo, si se activa una especie a mano, volver a ejecutar el seed no la desactiva.
- **Sin UUIDs fijos**: los ids se generan y las relaciones se resuelven por `code`.
- **Atómico**: `seed.sql` va en `begin … commit`; `breeds.sql` es una única sentencia (CTEs), así que
  también se aplica entera o no se aplica.

Consecuencia de `DO NOTHING`: **cambiar un texto o un valor ya sembrado no se propaga** al volver a
ejecutar el seed. Para corregir datos existentes en un entorno, hacer un cambio explícito y revisado.
Añadir razas nuevas al final de `breeds.sql` sí se propaga al reejecutarlo.

## 4. Ejecución en local

Operaciones permitidas según las reglas del repo (Docker necesario):

- `npx supabase start`: en una BD local nueva aplica las migraciones y después los seeds en orden.
- `npx supabase db reset --local`: recrea la BD local desde cero, con migraciones y seeds. **Borra los
  datos locales**: solo con aprobación explícita y nunca con `--linked` ni `--db-url`.
- Reejecutar solo los seeds sobre la BD local, sin resetear:
  ```bash
  docker exec -i supabase_db_Kitom psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/seed.sql
  docker exec -i supabase_db_Kitom psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/seeds/breeds.sql
  ```

## 5. Ejecución en `kitom-dev` (remoto)

**Requiere aprobación explícita y la ejecuta el usuario.** Claude no ejecuta SQL contra el remoto.

Orden:

1. **Migración `*_breeds.sql`** (cambio de esquema): como cualquier migración, la aplica el usuario
   tras revisarla. Sin ella, `seeds/breeds.sql` falla porque la tabla `breeds` no existe.
2. **`supabase/seed.sql`**.
3. **`supabase/seeds/breeds.sql`**.

Para los seeds (pasos 2 y 3):

- **No usar `supabase db push`** (ni `--include-seed`): los seeds no son migraciones.
- Opción recomendada: Dashboard de Supabase → *SQL Editor* → pegar el contenido del archivo → *Run*.
- Alternativa: `psql "<connection string de kitom-dev>" -v ON_ERROR_STOP=1 -f <archivo>`.

Antes de ejecutar: comprobar que se trata del proyecto `kitom-dev` y que el archivo es el revisado.

## 6. Comprobación

Consultas de solo lectura (SQL Editor o local):

```sql
select 'species' as tabla, count(*) from public.species
union all select 'species activas', count(*) from public.species where is_active
union all select 'symptoms_catalog', count(*) from public.symptoms_catalog
union all select 'symptom_species', count(*) from public.symptom_species
union all select 'achievements_catalog', count(*) from public.achievements_catalog
union all select 'traducciones (seed.sql)', count(*) from public.catalog_translations where entity_type <> 'breed'
union all select 'breeds', count(*) from public.breeds
union all select 'breed names', count(*) from public.catalog_translations where entity_type = 'breed' and field = 'name'
union all select 'breed aliases', count(*) from public.catalog_translations where entity_type = 'breed' and field = 'aliases';
-- Esperado: 9 · 2 · 6 · 12 · 4 · 46 · 198 · 396 · 198

-- Razas sin nombre en es o en (debe devolver 0 filas)
select b.code
from public.breeds b
where (select count(*) from public.catalog_translations t
       where t.entity_type = 'breed' and t.entity_id = b.id
         and t.field = 'name' and t.locale in ('es', 'en')) <> 2;
```

En la app: «Mis mascotas» → «Añadir mascota» debe ofrecer **Gato** y **Perro** (el selector de raza
llegará con la tarea de frontend de razas).

## 7. Datos de prueba de usuario

No hay seed de datos de usuario: dependen de un usuario real de `auth.users` y de RLS. Los datos de
prueba se crean desde la app con una cuenta real (registro → crear mascota…). Cuando existan
funcionalidades que necesiten volumen (p. ej. semanas de registros diarios para probar rachas e
historial), se documentará un procedimiento basado en un usuario autenticado real.
