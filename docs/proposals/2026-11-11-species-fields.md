# Campos por especie en la ficha y el registro diario (propuesta, fase 16A)

> **Aprobada e implementada el 2026-11-11** (todas las recomendaciones del §9; rama `feat/species-fields-wellness`).
> Migración `20261111120000_species_fields.sql` aplicada en `kitom-dev` el 2026-11-12, con el seed de razas; contrato en
> `docs/README.md` §15.1 y `docs/FRONTEND_ARCHITECTURE.md` «Campos por especie». Diferencias con este texto: los
> campos del caballo son 6 (sin «se tumbó o se revolcó»), el catálogo no guarda `summary_kind` (el resumen se deduce
> del tipo de campo) y la «vitamina C» de la cobaya es una elección única. Las listas siguen pendientes de revisión
> veterinaria antes de publicar.
>
> **Estado original: propuesta para aprobación (2026-11-11).** Solo auditoría y diseño: sin código, sin
> migraciones y sin operaciones remotas. Alcance decidido por el usuario el 2026-11-11: **ficha y
> registro diario**, **las 9 especies del catálogo**, y **antes de la fase 15B** (el resumen de
> bienestar, `2026-11-10-wellness-reports.md`, se adaptará a lo que se apruebe aquí). Las decisiones que
> requieren aprobación están en el §9. **Las listas de campos del §4 son un borrador de producto: hay que
> validarlas con el veterinario asesor antes de la migración.**

**Conclusión:** se recomienda un **catálogo de campos por especie en la base de datos** (tabla nueva,
mantenida con migraciones) y **una columna `jsonb` validada** en `pets` y otra en `daily_logs`. Las 7
escalas actuales se mantienen como núcleo común, y cada especie decide cuáles le aplican. Así se
conservan el guardado atómico, la precondición `updated_at`, el modo sin conexión (una columna más en el
mismo registro) y la compatibilidad con las versiones de la app ya instaladas. Activar las 7 especies
nuevas exige además catálogos (tipos de ave y de reptil, razas), síntomas por especie, límites, textos
legales y una decisión sobre la IA (§6).

---

## 1. Auditoría: lo que hay hoy

### 1.1 Especies

- `species` (baseline): `code`, `scientific_name`, `category`, `parent_species_id`, `is_active`. Siembra
  en `supabase/seed.sql`, con 9 especies: **activas `dog` y `cat`**; inactivas `rabbit`, `guinea_pig`,
  `hamster`, `horse`, `bird_other`, `reptile_other` y `other`. El seed dice que activarlas es «una decisión
  de producto que exige también vincular síntomas en `symptom_species`».
- Nombres en `catalog_translations` (`entity_type` limitado por CHECK a `species`, `symptom` y
  `achievement`). «Ave (otra)» y «Reptil (otro)» son nombres pensados para especies que no están en el
  catálogo, no para cuando son las únicas opciones de ave y de reptil.
- `parent_species_id` existe pero no se usa.

### 1.2 Ficha de la mascota (`pets`)

Columnas comunes a todas las especies: `name`, `species_id`, `sex` (`male|female|unknown`), `breed_status`
+ `breed_id`/`breed` (FK compuesta `(breed_id, species_id) → breeds`), `birth_date`, `weight_kg`
(`numeric(9,3)`, > 0), `sterilized`, `known_conditions[]` y `allergies[]` (≤ 100 × 200), `temperament_notes`
(≤ 2000) y `photo_path`. Escritura por **GRANT por columna** y PostgREST directo (sin RPC). Edición sin
conexión con precondición `updated_at` y alta idempotente con `client_request_id` (fase 8). La especie se
puede cambiar al editar, con confirmación (`pet-form.tsx`).

- Razas (`supabase/seeds/breeds.sql`): **155 de perro y 43 de gato; ninguna de las demás especies.**
- Límites de plausibilidad (`pet-plausibility.ts`, solo en el formulario): ya tiene peso y edad máximos
  para las 9 especies.
- El peso se pide en kg en todas las especies. En un hámster (30–200 g) eso obliga a escribir «0,045».

### 1.3 Registro diario (`daily_logs`)

7 escalas comunes (detalle en `2026-11-10-wellness-reports.md` §1.2), `unusual_behavior` y su nota,
`notes` y `tags` (3 códigos cerrados). Se guarda solo con la RPC `save_daily_log` (15 parámetros, sustituye
el registro completo, precondición `updated_at` o `expect_absent`), y sin conexión en `LocalStore` con el
motor de sincronización. Las 4 principales son obligatorias al crear, pero solo en la UI: la BD solo exige
que el registro no esté vacío.

Varias escalas no tienen sentido en algunas especies: el «ánimo» o la «calidad del sueño» de un reptil no
se pueden observar de forma fiable, y la «interacción social» de un hámster sirio, que vive solo, tampoco
dice nada. Hoy se pedirían igual.

### 1.4 Quién lee estos datos

| Consumidor | Qué lee | Impacto |
|---|---|---|
| `ai-analysis-process` (`index.ts`, `guidance.ts`) | Ficha (sin `temperament_notes`) y, de los registros, energía, apetito, ánimo, actividad, comportamiento inusual y etiquetas. Traduce solo `dog`→perro y `cat`→gato; las reglas de urgencia hablan de perros y gatos | Añadir los campos por especie al contexto; decidir la IA para especies nuevas (§6.3) |
| Historial y señales de Hoy | Las 7 columnas | Las escalas que no aplican se ocultan; los campos de especie, en el detalle del día |
| Resumen de bienestar (15B, aprobado) | Las 7 columnas | Pasa a depender del catálogo (§7) |
| Descargar mis datos (`data-export.ts`) | Columnas explícitas | Añadir `species_data` |
| Offline (`daily-log-content.ts`, `pet-snapshot.ts`) | Contenido validado al leerlo | Formatos locales nuevos (versión de colección) |
| `symptom_species` y `validate_symptom_species_compat` | Síntomas solo para perro y gato | Con otras especies, `request_ai_analysis` rechazaría cualquier síntoma |
| Textos | «Por ahora, perros y gatos» (`i18n` es/en), términos de `site/` («perros y gatos»), PRD y ficha de la tienda | Hay que actualizarlos al activar las especies |

---

## 2. Principios

1. **Lo común sigue siendo común.** Los campos que ya existen no se duplican por especie. Vacunas,
   desparasitación y citas siguen en la **agenda** (`reminders`), no en la ficha.
2. **Registro diario en menos de 45 s** (PRD §8.3): los campos de especie van en el paso de detalles
   opcionales. Cada especie tiene como mucho **4 principales** y **6 campos propios** al día.
3. **Observar, no diagnosticar.** Los campos describen lo que ve el tutor («hizo cacas: sí, pocas, no»).
   No hay campos que pidan interpretar («¿tiene estasis?») ni textos de urgencia. La IA sigue siendo el
   único sitio con niveles de urgencia, con su aviso.
4. **Sin datos personales nuevos.** El microchip se registra como sí/no/no sé, sin el número.
5. **Todo opcional en la ficha** (perfilado progresivo, PRD §8.2). Ningún campo de especie bloquea crear una mascota.
6. **Unidades naturales**: gramos para los animales pequeños y centímetros para los terrarios. Se guarda
   siempre en la unidad del catálogo (el peso, en kg en `weight_kg`).

---

## 3. Modelo de datos recomendado (D-1)

### 3.1 Opciones evaluadas

| Opción | A favor | En contra |
|---|---|---|
| **A. Columnas nuevas** en `pets` y `daily_logs` (unas 60) | Tipos y CHECK nativos | Tablas muy anchas y casi siempre vacías, un GRANT por columna, `save_daily_log` con decenas de parámetros, y cada campo nuevo cambia la firma y los tipos |
| **B. Catálogo + `jsonb` validado** (recomendada) | Una columna por tabla, mismo registro (atomicidad, precondición y offline intactos), y campos nuevos sin cambiar firmas | La validación va en un trigger, no en CHECK nativos; las consultas por campo usan `->>` |
| C. Tablas EAV (una fila por valor) | Normalizada | Varias filas por registro: rompe el guardado atómico, la precondición `updated_at` y el motor offline, que trabaja con un registro por día |

### 3.2 Esquema (opción B)

Una migración nueva en su propio PR `db/…`, con aprobación previa:

- **`public.species_fields`**: un catálogo que **escribe la migración**, no el seed, porque la validación
  depende de él y debe existir igual en todos los entornos.
  - `id uuid`, `species_id uuid` (FK), `scope` (`profile` | `daily`), `code` (snake_case, único por
    especie y ámbito) y `kind`.
  - `kind` es uno de: `scale_relative` (1–5 o 2/3/4), `scale_quality`, `choice`, `multi_choice`,
    `boolean`, `integer`, `decimal` o `core` (una de las 7 columnas de `daily_logs`).
  - `options text[]` (códigos), `min`/`max numeric`, `unit` (`g`, `kg`, `cm`, `min`, `°C`…), `position`,
    `is_primary` (de las principales del registro), `is_active` y `summary_kind` (cómo lo resume el §7).
  - RLS de solo lectura para `authenticated`, como `species` y `breeds`.
- **`pets.species_data jsonb NOT NULL DEFAULT '{}'`** y **`daily_logs.species_data jsonb NOT NULL DEFAULT
  '{}'`**, con GRANT de INSERT y UPDATE en `pets`, y en `daily_logs` solo a través de la RPC.
- **Trigger `validate_species_data`** (BEFORE INSERT/UPDATE, SECURITY DEFINER, `search_path` fijo):
  - Solo valida si `species_data` cambia (`IS DISTINCT FROM`), para que un registro antiguo se pueda seguir
    editando en sus campos comunes.
  - Exige claves que existan para la especie **actual** de la mascota y el ámbito, con el tipo, las
    opciones y los rangos del catálogo; los campos inactivos no se aceptan en valores nuevos.
  - Tamaño máximo (p. ej. 4 KB) y nada de texto libre (no hay `kind` de texto: las notas siguen en
    `notes`, `unusual_behavior_notes` y `temperament_notes`).
  - Errores con `hint` estable (`species_data_invalid`) y `detail` = código del campo, como el resto de los contratos.
- **`daily_logs_not_empty_check`**: se sustituye por la misma regla más «o `species_data` con algún valor».
  Es una restricción nueva en una migración nueva; las anteriores no se tocan.
- **`save_daily_log`**: nuevo parámetro `p_species_data jsonb DEFAULT NULL` al final. Se borra la firma de
  15 parámetros y se crea la de 16, sin sobrecarga, como en `20261010160332`. **`NULL` = conservar lo
  guardado**; `'{}'` = vaciar. Así una app antigua, que no envía el parámetro, no borra los datos de
  especie que haya escrito otra versión (§5).
- **Cambio de especie**: si cambia `pets.species_id`, el trigger vacía `pets.species_data`, porque los
  campos ya no serían válidos. Los registros diarios anteriores conservan sus datos, que el historial
  muestra con el catálogo de la especie con la que se guardaron (o sin mostrar, D-7).
- Índices: ninguno de entrada (las consultas son por `pet_id` + fecha). Si el resumen filtrara por un campo, se mide antes.

### 3.3 Textos y copia en la app

- Los textos de los campos y sus opciones van en `i18n` (es/en) por código, como las etiquetas: funcionan
  sin conexión y en el arranque en frío.
- La app lleva una **copia del catálogo** (`features/species/species-fields.ts`), y una prueba de
  integración contra el Supabase local comprueba que coincide con la tabla, igual que se haría con los
  tipos generados. Añadir un campo = migración + versión de la app. Mientras tanto, las apps antiguas
  conservan y reenvían las claves que no conocen (§5).
- La Edge Function de IA tiene su propio mapa de textos en español (`guidance.ts`), probado contra el mismo catálogo.

---

## 4. Campos por especie (borrador para validación veterinaria)

Notación: **P** = principal del registro (obligatoria al crear); *opc.* = opcional; las opciones van entre
llaves. Lo común (§1.2) no se repite.

### 4.1 Núcleo común: qué escalas se muestran

| Escala | Perro | Gato | Conejo | Cobaya | Hámster | Caballo | Ave | Reptil | Otro |
|---|---|---|---|---|---|---|---|---|---|
| Energía | P | P | P | P | P | P | P | P | P |
| Apetito | P | P | P | P | P | P | P | P | P |
| Ánimo | P | P | P | P | opc. | P | P | — | opc. |
| Actividad | P | P | P | P | P | P | P | P | P |
| Sueño | opc. | opc. | — | — | — | opc. | — | — | opc. |
| Vocalizaciones | opc. | opc. | — | opc. | — | opc. | opc. | — | opc. |
| Interacción social | opc. | opc. | opc. | opc. | — | opc. | opc. | — | opc. |

«—» = no se pregunta y queda `NULL`. Perro y gato quedan **exactamente como hoy**.

### 4.2 Perro

- **Ficha**:
  - Microchip {sí, no, no sé}.
  - Vive {dentro, fuera, ambos}.
  - Alimentación {pienso seco, húmedo, mixta, casera, cruda/BARF, otra}; comidas al día (1–6).
  - Paseos habituales al día (0–8).
  - Convive con {niños, otros perros, gatos, otros animales} (*multi*).
  - Educación {ninguna, básica, avanzada, trabajo/deporte}.
- **Diario** (*opc.*):
  - Paseos (0–10) y minutos de paseo (0–600).
  - Agua {menos, como siempre, más}.
  - Deposiciones {normales, blandas, líquidas, duras, no hizo}.
  - Vómito {sí, no}.
  - Rascado o lamido {menos, como siempre, más}.

### 4.3 Gato

- **Ficha**:
  - Microchip {sí, no, no sé}.
  - Acceso al exterior {nunca, balcón o terraza protegidos, salidas supervisadas, libre}.
  - Areneros (0–10) y tipo de arena {aglomerante, sílice, vegetal, otra}.
  - Alimentación {pienso seco, húmedo, mixta, casera, otra}.
  - Fuente de agua {cuenco, fuente, ambas}.
  - Convive con {otros gatos, perros, niños, otros animales} (*multi*).
- **Diario** (*opc.*):
  - Uso del arenero, orina {menos, como siempre, más, fuera del arenero}.
  - Deposiciones {normales, blandas, líquidas, duras, no hizo}.
  - Agua {menos, como siempre, más}.
  - Acicalado {menos, como siempre, más}.
  - Vómito o bola de pelo {no, bola de pelo, vómito}.
  - Se escondió más de lo habitual {sí, no}.

### 4.4 Conejo

- **Ficha**:
  - Alojamiento {jaula, parque, suelto en casa, exterior}.
  - Horas fuera de la jaula al día (0–24).
  - Heno a libre disposición {sí, no}.
  - Verdura fresca a diario {sí, no}.
  - Pienso {ninguno, extrusionado, mezcla de semillas}.
  - Convive con otro conejo {sí, no}.
  - Tipo de suelo {duro, alfombra, mixto}.
- **Diario** (*opc.*):
  - Comió heno {nada, menos, como siempre}.
  - Cacas {como siempre, menos o más pequeñas, ninguna vista}.
  - Cecotrofos sin comer {sí, no}.
  - Agua {menos, como siempre, más}.
  - Postura encorvada o quieto en un rincón {sí, no}.

### 4.5 Cobaya

- **Ficha**:
  - Alojamiento {jaula, parque, suelto, exterior}.
  - Compañeros (0–10).
  - Aporte de vitamina C {verdura rica en vitamina C, suplemento, pienso con vitamina C, ninguno, no sé} (*multi*).
  - Heno a libre disposición {sí, no}.
- **Diario** (*opc.*):
  - Comió heno {nada, menos, como siempre}.
  - Cacas {como siempre, menos, ninguna vista}.
  - Agua {menos, como siempre, más}.
  - Peso hoy en gramos (100–2500). Pesar a menudo es una práctica habitual en cobayas.

### 4.6 Hámster

- **Ficha**:
  - Tipo, del catálogo de razas: {sirio, enano ruso, Campbell, roborovski, chino}.
  - Superficie de la jaula en cm² (500–20 000).
  - Diámetro de la rueda en cm (10–40).
  - Profundidad del sustrato en cm (0–60).
  - Vive solo {sí, no}.
- **Diario** (*opc.*):
  - Usó la rueda {no, poco, como siempre, mucho}.
  - Comida acaparada o desaparecida {menos, como siempre, más}.
  - Cacas {como siempre, menos, ninguna vista}.
  - Peso hoy en gramos (15–250).

### 4.7 Caballo

- **Ficha**:
  - Alzada en cm (70–200).
  - Uso {ocio, deporte, trabajo, cría, retirado}.
  - Alojamiento {box, box con paddock, pradera, mixto}.
  - Herrado {sin herrar, delanteras, las cuatro}.
  - Forraje {heno, hierba, ensilado, mixto}; concentrado al día en kg (0–10).
- **Diario** (*opc.*):
  - Trabajo realizado en minutos (0–480) e intensidad {suave, media, alta}.
  - Forraje {menos, como siempre, más}.
  - Agua {menos, como siempre, más}.
  - Cacas {como siempre, menos, blandas, ninguna vista}.
  - Se tumbó o se revolcó más de lo habitual {sí, no}.
  - Cojera observada {no, leve, evidente}. Es una observación, sin interpretación.

### 4.8 Ave

- **Ficha**:
  - Tipo, del catálogo de razas: {periquito, ninfa, canario, agaporni, diamante mandarín, loro gris,
    amazona, cotorra, otro}.
  - Alojamiento {jaula, voladera, libre en casa}.
  - Horas fuera de la jaula al día (0–24).
  - Alas recortadas {sí, no}.
  - Anilla {sí, no, no sé}.
  - Dieta base {semillas, pienso extrusionado, mixta} y fruta o verdura a diario {sí, no}.
  - Vive con otras aves {sí, no}.
- **Diario** (*opc.*):
  - Plumaje {normal, ahuecado, arrancado o picado}.
  - Excrementos {como siempre, más líquidos, de otro color, menos}.
  - Comió {menos, como siempre, más}.
  - Baño {sí, no}.
  - Tiempo fuera de la jaula en minutos (0–1440).

### 4.9 Reptil

En los reptiles el registro diario encaja peor: muchos comen una vez por semana o menos. Por eso los
campos son de lo que **ocurrió** ese día, no escalas.

- **Ficha**:
  - Tipo, del catálogo de razas: {gecko leopardo, dragón barbudo, pitón real, serpiente del maíz,
    tortuga mediterránea, tortuga de agua, iguana, camaleón, otro}.
  - Dieta {insectívora, herbívora, carnívora, omnívora}.
  - Terrario: largo, ancho y alto en cm (10–400).
  - Zona caliente y zona fría en °C (10–50).
  - Tipo de UVB {ninguno, T5, T8, vapor de mercurio, no sé} y fecha del último cambio de UVB.
  - Brumación o hibernación {sí, no, no aplica}.
- **Diario** (*opc.*):
  - Comió {no tocaba, sí, rechazó}.
  - Muda {no, en muda, completa, incompleta}.
  - Defecó {sí, no}.
  - Temperatura medida en la zona caliente, en °C (10–50).
  - Baño o pulverización {sí, no}.

### 4.10 Otro

Sin campos propios. Las 7 escalas se muestran todas, como opcionales salvo las principales comunes. Si
más adelante se añaden especies con nombre, cada una tendrá sus campos.

---

## 5. Offline y compatibilidad entre versiones

- **Mismo registro, misma precondición.** `species_data` viaja en el contenido completo del registro y de
  la ficha, así que el motor de sincronización, los conflictos y la fusión no cambian de forma.
  `sameDailyLogContent` y el formulario de conflictos comparan también `species_data`, campo a campo, con
  sus textos.
- **Formatos locales**: nueva versión de las colecciones `daily-logs` y `pets` en `LocalStore`, con
  migración de la v1 al leerla (`species_data = {}`). Una copia que no se puede leer no se borra sola, como hasta ahora.
- **Claves desconocidas.** Una versión de la app que no conoce un campo nuevo debe conservarlo y
  reenviarlo al editar, nunca quitarlo. Con `NULL` = «conservar» en la RPC, las versiones ya instaladas,
  que no envían el parámetro, tampoco lo borran.
- **Pendientes que crucen la actualización.** Una operación local creada con la v1 se envía sin el
  parámetro, así que no toca `species_data`. Hay que probarlo.
- **Catálogo sin conexión**: va en la app (§3.3); no hace falta descargar nada para registrar.
- **Fichas**: `species_data` entra en `PetFields` y en la precondición de la edición, y viaja junto con el
  alta idempotente (`client_request_id`).

---

## 6. Activar las 7 especies nuevas

### 6.1 Catálogos

- **Razas o tipos** para conejo, cobaya, hámster, caballo, ave y reptil, en `supabase/seeds/breeds.sql`
  con es/en y alias. Es un seed: lo ejecuta el usuario en `kitom-dev` (`docs/SEED.md`).
- **Nombres**: «Ave (otra)» y «Reptil (otro)» deberían pasar a «Ave» y «Reptil», con el tipo concreto como
  raza. El seed solo inserta (`ON CONFLICT DO NOTHING`), así que cambiar un texto ya sembrado requiere una
  migración de datos o que el usuario lo actualice (D-6). Los códigos (`bird_other`, `reptile_other`) no se cambian.
- **`is_active = true`** para las 9: es una migración de datos, porque el seed no actualiza filas.

### 6.2 Plausibilidad y unidades

- `pet-plausibility.ts` ya tiene límites para las 9. Se añaden mínimos (un hámster de 30 kg es una errata) y
  la unidad de entrada del peso: gramos para hámster, cobaya, ave y reptiles pequeños, guardando kg.
- Los rangos del §4 se repiten en el catálogo (servidor) y en la copia de la app.

### 6.3 Orientación con IA (D-4)

- Para las especies nuevas habría que vincular síntomas en `symptom_species` (algunos no aplican:
  «vocalización excesiva» en un reptil), adaptar el texto del sistema (hoy habla de perros y gatos), añadir
  los campos de especie al contexto y que el veterinario revise los avisos de urgencia propios (por
  ejemplo, en conejos y cobayas dejar de comer o no hacer cacas es urgente).
- **Recomendación:** activar las especies para la ficha, el registro y el historial, pero dejar la
  orientación con IA **solo para perro y gato** hasta que el veterinario valide cada especie. La pantalla
  «Consultar» lo dirá («Próximamente para conejos»). Requiere comprobarlo en `request_ai_analysis` (servidor)
  y no solo en la UI.

### 6.4 Textos legales y de la tienda

`i18n` («Por ahora, perros y gatos»), `site/terms.html` y `site/en/terms.html` («perros y gatos»),
`docs/STORE_LISTING.md` y PRD §16. Los términos los publica el usuario.

---

## 7. Efecto en el resumen de bienestar (15B, ya aprobado)

El resumen pasa a depender del catálogo, con estas formas de resumir (`summary_kind`):

| Tipo de campo | Resumen | Comparación entre periodos |
|---|---|---|
| Escala (núcleo o de especie) | Reparto en 3 grupos (D-1 del 15A) | Sí, con los mínimos del 15A |
| `boolean` | Días con «sí» / días indicados | Sí, con los mínimos |
| `choice` | Días por opción | Solo recuentos |
| `integer` / `decimal` con unidad (paseos, minutos, peso, temperatura) | Mediana, mínimo y máximo, con `n`. Aquí sí son cantidades | Mediana de cada periodo, con `n` |
| `multi_choice` | Días por opción | Solo recuentos |

Las escalas que no aplican a una especie no aparecen. Lo demás del 15A no cambia: denominadores visibles,
sin índice global, sin correlaciones y con la revisión veterinaria de Observaciones.

---

## 8. Plan de implementación

Va antes de la 15B, que después se ajusta (§7).

| Fase | Contenido | Hecho cuando |
|---|---|---|
| **16B** BD (PR `db/…`) | `species_fields` con los campos aprobados, columnas `species_data`, trigger de validación, nueva `daily_logs_not_empty_check`, `save_daily_log` de 16 parámetros, cambio de especie, activación y nombres (D-6), y la comprobación de IA por especie en `request_ai_analysis` (D-4). pgTAP: validación por tipo, especie y ámbito, permisos (viewer, ajeno), `NULL` = conservar, cambio de especie y tamaño máximo | pgTAP y `db diff --local` en verde; **`db push` y tipos con `--linked` los hace el usuario** |
| **16C** Dominio de la app | `features/species/species-fields.ts` (copia del catálogo y prueba de paridad), modelos de contenido con `species_data` y claves desconocidas, formatos locales v2 con migración, plausibilidad y unidades | `npm test` e integración en verde |
| **16D** Ficha | Sección «Sobre {especie}» en el formulario y en la ficha, con unidades y textos es/en | Validación manual en web y Android, también sin conexión |
| **16E** Registro diario | Escalas según la especie (§4.1), campos propios en «Detalles», detalle del día y conflictos | Registro de perro y gato sin cambios; un registro de cada especie nueva en < 45 s |
| **16F** Especies nuevas | Seeds de razas y tipos (el usuario los ejecuta en `kitom-dev`), textos de la app y de `site/`, IA restringida (§6.3) y contexto de IA con los campos de especie para perro y gato | Validación del veterinario de los §4 y §6.3 |
| **16G** Cierre | E2E Android y web; documentación: `docs/README.md` (contrato), `DATABASE.md`, `FRONTEND_ARCHITECTURE.md` §4 y §5, `DECISIONS.md`, `CHANGELOG.md`, `TESTING.md`, `PANTALLAS.md`, `SEED.md` y `supabase/CLAUDE.md` | Definición de «terminado» |

### Pruebas clave (además de las de cada fase)

- Un campo de gato en una mascota perro, una opción inexistente, un número fuera de rango o un tipo
  incorrecto → `species_data_invalid` con el código del campo.
- Una app antigua (sin `p_species_data`) edita un registro con datos de especie → se conservan.
- Una operación sin conexión creada antes de actualizar la app → se sincroniza sin perder nada.
- Cambio de especie con la ficha completa → `species_data` vacío; los registros antiguos siguen siendo legibles y editables.
- Conflicto en el que solo cambian campos de especie → la pantalla de conflictos los muestra.
- Viewer → lee `species_data`; no lo edita (RLS y RPC).
- Una especie sin IA → `request_ai_analysis` la rechaza en el servidor con un `hint` propio.
- Hámster con el peso en gramos → se guarda en kg con 3 decimales sin perder precisión.

---

## 9. Decisiones que requieren aprobación

| # | Decisión | Recomendación |
|---|---|---|
| D-1 | Modelo de datos | Catálogo `species_fields` mantenido con migraciones y `species_data jsonb` validado por trigger (§3) |
| D-2 | Listas de campos | Borrador del §4 → revisión del veterinario asesor antes de la 16B. ¿Hay campos que quieras añadir o quitar ya? |
| D-3 | Núcleo común por especie | Matriz del §4.1. Perro y gato sin cambios |
| D-4 | IA para especies nuevas | Solo perro y gato hasta la validación veterinaria, con bloqueo en el servidor |
| D-5 | Textos de los campos | En `i18n` de la app (es/en) y mapa en español en la Edge Function, con pruebas de paridad (no en `catalog_translations`) |
| D-6 | «Ave (otra)» / «Reptil (otro)» | Renombrar a «Ave» / «Reptil» (migración de datos), con el tipo concreto como raza |
| D-7 | Registros guardados con otra especie | Se conservan y se muestran con el catálogo de la especie con la que se guardaron |
| D-8 | Microchip | Solo sí/no/no sé, sin número |
| D-9 | Peso diario en cobaya y hámster | Campo de registro diario (no edita `pets.weight_kg`) |
| D-10 | Orden | 16B–16G y después la 15B adaptada (§7) |

### Riesgos

- **Precisión de los campos**: un campo mal planteado (por ejemplo, de cuidados de reptiles) puede dar
  consejos implícitos erróneos. Por eso hace falta la revisión veterinaria (D-2).
- **Registro más largo**: más campos van contra los 45 s. Mitigación: límite de 4 principales y 6 propios, y todo opcional en Detalles.
- **Catálogo duplicado** (BD, app y Edge Function): puede desalinearse. Mitigación: pruebas de paridad en local.
- **Versiones antiguas instaladas**: no muestran los campos nuevos. Mitigación: «`NULL` = conservar» y claves desconocidas preservadas.
- **Mayor alcance de producto**: 9 especies multiplican la validación manual, el soporte y los textos legales.
- **Reptiles**: el registro diario encaja mal con animales que comen una vez por semana. El §4.9 lo resuelve con eventos.
