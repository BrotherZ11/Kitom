# Resumen y evolución del bienestar (propuesta, fase 15A)

> **Implementada el 2026-11-11** (rama `feat/species-fields-wellness`, fases 15B–15E; contrato en
> `docs/FRONTEND_ARCHITECTURE.md` «WellnessScreen» y §5 «Resumen de bienestar sin conexión»). Falta la prueba sin
> conexión en Android y la revisión veterinaria del texto de las observaciones antes de publicar.
>
> **Estado: aprobada el 2026-11-11 con todas las recomendaciones del §9 (D-1 a D-13)**, incluida la
> revisión veterinaria del copy de Observaciones antes de publicarlas (D-9). Nada implementado todavía.
> **La 15B espera a los campos por especie** (`2026-11-11-species-fields.md`, decisión del usuario del
> 2026-11-11): las estadísticas pasarán a depender del catálogo de campos (§7 de esa propuesta). Al
> implementarla, el contrato pasa a `docs/FRONTEND_ARCHITECTURE.md` §4 y las decisiones a `docs/DECISIONS.md`.

**Conclusión:** se puede hacer **sin migraciones ni Edge Functions**. Con 90 días como máximo (y otros 90
para comparar), una mascota tiene ≤ 180 filas (`UNIQUE (pet_id, log_date)`). Una consulta por rango usa el
índice existente, y las cuentas se hacen en el cliente con los mismos datos combinados (servidor +
dispositivo) que ya usa el historial. Así funciona sin conexión, incluye los cambios pendientes y no
puede saltarse la RLS. Lo nuevo es sobre todo el frontend: un módulo puro de estadísticas, una consulta
por rango, un registro local de cobertura y tres pantallas hechas con componentes existentes.

**La principal advertencia es de producto, no técnica:** las escalas son ordinales y relativas a «lo
habitual». Una media o una puntuación global de bienestar diría más de lo que los datos permiten. La
propuesta muestra **cómo se reparten los días** (por debajo de lo habitual / como siempre / por encima),
siempre con el número de días registrados, y no ofrece ningún índice global.

---

## 1. Auditoría del esquema real

Fuentes: `supabase/migrations/20261006175453_remote_schema.sql` (baseline), `20261008150202_daily_logs_fixes.sql`,
`20261010160332_daily_logs_concurrency.sql`, `20261030090318_abuse_limits_and_db_hardening.sql` y
`20261105122353_account_deletion_audit_triggers.sql`. Todas están aplicadas en `kitom-dev` según `CLAUDE.md`. No se ha
consultado el remoto.

### 1.1 Tabla `daily_logs`

| Columna | Tipo | Restricciones | Notas |
|---|---|---|---|
| `id` | uuid | PK, `gen_random_uuid()` | El cliente no lo envía; la identidad funcional es (`pet_id`, `log_date`) |
| `pet_id` | uuid | NOT NULL, FK `pets` **ON DELETE CASCADE** | Inmutable (trigger `protect_daily_log_audit_fields`) |
| `logged_by` | uuid | FK `profiles` ON DELETE SET NULL | Quien lo creó. Inmutable salvo por la FK al borrar la cuenta (`20261105122353`) |
| `last_edited_by` | uuid | FK `profiles` ON DELETE SET NULL | Lo pone un trigger en cada UPDATE |
| `log_date` | date | NOT NULL, `UNIQUE (pet_id, log_date)` | Día natural, sin hora. Inmutable (sin GRANT de UPDATE y con trigger) |
| `energy_level`, `appetite_level`, `mood_level`, `activity_level` | smallint | CHECK 1–5, nulables | «Principales» en la UI |
| `sleep_quality`, `vocalization_level`, `social_interaction_level` | smallint | CHECK 1–5, nulables | «Detalles» en la UI (ver §1.2) |
| `unusual_behavior` | boolean | NOT NULL, default false | |
| `unusual_behavior_notes` | text | ≤ 1000 caracteres | Texto libre privado |
| `notes` | text | ≤ 2000 caracteres | Texto libre privado |
| `tags` | text[] | default `'{}'`, **nulable**, `tags <@ {vet_visit, home_change, new_pet}` | Lista cerrada; añadir una etiqueta requiere migración |
| `created_at` / `updated_at` | timestamptz | NOT NULL | `updated_at` lo mantiene el trigger `set_timestamp_daily_logs` y sirve de **versión** (precondición de `save_daily_log`, comparada al microsegundo) |

Otras reglas de la BD:

- **Sin registros vacíos** (`daily_logs_not_empty_check`): al menos una escala, el comportamiento inusual
  marcado o descrito, una nota o una etiqueta. Por tanto **puede haber registros sin ninguna escala**: un
  día registrado no siempre aporta datos a las escalas.
- **Fechas** (`validate_daily_log_date`): solo se crea entre hoy − 7 y hoy, en la zona del
  **propietario** (`profiles.timezone`; `NULL` = UTC). Un registro existente se edita sin límite de
  antigüedad. Así que cualquier día de los últimos 8 puede aparecer más tarde, y cualquier día pasado puede
  cambiar de contenido.
- **Escritura**: solo `save_daily_log` (SECURITY INVOKER) con precondición (`p_expected_updated_at` o
  `p_expect_absent`). Un conflicto devuelve `P0001` con `hint` `daily_log_conflict`. Sustituye el registro
  completo.
- **Sin historial de versiones ni borrado lógico.** Una edición sobrescribe la anterior y un borrado elimina la fila.
  Consecuencia: **un resumen no es reproducible en el tiempo**, porque el de ayer puede cambiar hoy.
- **Borrado**: la RLS lo permite a los editores (`daily_logs: delete editors`), pero la app aún no lo
  ofrece. Aun así, un editor puede borrar con la API, y el diseño debe tenerlo en cuenta (§5.3).
- **Rachas**: `pet_streaks` es una caché del servidor que recalcula `recompute_pet_streak` en cada
  escritura, con el «hoy» del propietario. Se lee con `pet_streaks: select members`. No hace falta para esta fase.

`tags` admite `NULL` en la columna. `save_daily_log` siempre escribe un array (`array(select distinct …)`),
pero un INSERT directo de un editor podría dejar `NULL`, y el CHECK lo acepta. Las estadísticas deben
tratar `NULL` como `[]`, igual que ya hace `toDailyLogFormValues`.

### 1.2 Significado de las escalas: qué está documentado y qué no

**Documentado** (`docs/DECISIONS.md` 2026-10-08 y 2026-10-19, `features/daily-logs/daily-log-form.ts`,
`scale-labels.ts`, `docs/design/PANTALLAS.md` §6). Es un contrato de la UI: **la BD solo sabe que son
enteros del 1 al 5.**

| Campo (columna) | Tipo de escala | 1 … 5 | Opciones en la UI |
|---|---|---|---|
| Energía (`energy_level`) | Relativa a lo habitual | mucho menos · menos · **como siempre** · más · mucho más | 5, obligatoria al crear |
| Apetito (`appetite_level`) | Relativa | ídem | 5, obligatoria al crear |
| Actividad (`activity_level`) | Relativa | ídem | 5, obligatoria al crear |
| Ánimo (`mood_level`) | Calidad | muy mal · mal · **normal** · bien · muy bien | 5, obligatoria al crear |
| Sueño (`sleep_quality`) | Calidad | ídem | **3 (peor / normal / mejor) guardadas como 2/3/4**, opcional |
| Vocalizaciones (`vocalization_level`) | Relativa | ídem relativa | **3 (menos / normal / más) → 2/3/4**, opcional |
| Interacción social (`social_interaction_level`) | Relativa | ídem relativa | **3 → 2/3/4**, opcional |

Hay tres consecuencias directas:

1. **El 3 es la referencia («como siempre» o «normal»), no un valor medio de una magnitud.** Las escalas
   relativas no miden cantidad: comparan con la percepción que el tutor tiene de lo habitual. Que
   «vocalizaciones más» o «actividad más» sea buena o mala señal **no está documentado** y no se le debe
   dar valor.
2. **Solo ánimo y sueño tienen dirección** (más alto = mejor según el tutor). `change-signals.ts` ya
   aplica ese criterio y no avisa de «mejor ánimo que de costumbre».
3. **Los detalles mezclan resoluciones.** Desde el 2026-10-19 se guardan 2/3/4, pero los 1 y 5 anteriores
   se conservan sin convertir. Un 4 de sueño nuevo («mejor») y un 4 antiguo («bien») no significan lo mismo.

**No documentado** (no se debe inventar):

- Qué es «lo habitual»: no hay una línea base definida. Es la impresión del tutor y puede ir cambiando.
- Si los pasos son equidistantes. No lo son por construcción: son etiquetas verbales, así que las medias
  aritméticas no tienen respaldo.
- Ningún umbral clínico, ni relación entre escalas, ni significado de las combinaciones.
- Qué cuenta como «comportamiento inusual»: es un interruptor con nota, sin catálogo.
- `PANTALLAS.md` §6, punto 1, deja pendiente confirmar cómo se lee «Menos» en el sueño en el historial
  (la columna es de calidad). La UI actual usa peor / normal / mejor. Hay que cerrarlo (D-10).

### 1.3 Etiquetas

`text[]` con tres códigos cerrados (`vet_visit`, `home_change`, `new_pet`), sin duplicados y ordenados por
la RPC. Las traducciones están en `i18n/locales/{es,en}.ts`. No hay etiquetas personalizadas (el diseño las deja para
«Pronto»). Contar días por etiqueta es trivial y fiable. Con tres códigos y pocas apariciones, cualquier
«patrón» asociado tendrá muy pocas muestras.

### 1.4 Seguridad y permisos de lectura

- **SELECT**: `daily_logs: select members` → `is_pet_member(pet_id)`, que es SECURITY DEFINER y STABLE
  desde `20261030090318`. Cubre al propietario y a los co-tutores con `status = 'accepted'`, **tanto
  `editor` como `viewer`**. Las invitaciones pendientes, rechazadas o revocadas no dan acceso. Un
  `viewer` ve todo el registro, también las notas: es una decisión vigente («el registro es de la mascota»).
- **INSERT, UPDATE y DELETE**: `can_edit_pet` (propietario o editor aceptado). En el INSERT, además, `logged_by = auth.uid()`.
- **Grants**: `anon` no tiene nada (`20261008150202` §5). `authenticated` tiene SELECT y DELETE de tabla,
  e INSERT y UPDATE por columna.
- La política está declarada `TO PUBLIC`, pero sin grants para `anon` no tiene efecto para él.
- **Pruebas actuales** (`supabase/tests/database/daily_logs.test.sql`): el viewer lee pero no crea, edita
  ni borra, y un ajeno no ve nada. **Hueco**: ninguna prueba de lectura con la invitación `pending`,
  `declined` o `revoked`, ni después de cambiar el rol o revocar el acceso (§7).

### 1.5 Consultas disponibles y rendimiento

- Índices: `daily_logs_pet_id_log_date_key` (UNIQUE `pet_id, log_date`), `idx_daily_logs_pet_date`
  (`pet_id, log_date DESC`), `idx_daily_logs_logged_by` e `idx_daily_logs_last_edited_by`. Un rango por
  mascota y fechas es un *index range scan* de como mucho 180 filas: coste despreciable.
- La RLS evalúa `is_pet_member` (STABLE) por consulta. No es un problema con este volumen.
- PostgREST limita las respuestas a 1000 filas por defecto, muy por encima de 180.
- Lo que ya consulta la app (`daily-log-history.ts`): páginas de 20 filas por cursor sobre `log_date`.
  Para cubrir 90 días habría que pedir 5 páginas, o 9 para 180 días, una tras otra. Por eso se propone una
  consulta por rango (§4.2) en vez de reutilizar el historial paginado.
- **Observación sobre lo que ya hay:** las señales de cambio de Hoy (`change-signals.ts`) comparan los 3
  últimos días con los 28 anteriores, pero solo con las páginas cargadas. Con un registro diario, la
  primera página (20 filas) cubre unos 20 días, así que la referencia queda en ~17 días en lugar de 28. La
  consulta por rango de esta fase lo corregiría sin coste (opcional, D-11).

### 1.6 Modificaciones y sincronización offline (lo que afecta a las estadísticas)

Fuente: `docs/FRONTEND_ARCHITECTURE.md` §5 y `features/daily-logs/offline/`.

- **Guardar siempre es local** (`LocalStore`, AsyncStorage, clave `kitom:v1:<userId>:daily-logs:<petId>:<fecha>`).
  El motor envía la operación con precondición. Cada registro local guarda la última fila confirmada
  (`serverRow`) y, como mucho, **una** operación pendiente (`pending | failed | conflict`).
- **Vista combinada** (`resolveDailyLogHistory`): las filas del servidor, con lo pendiente del dispositivo
  encima y sin duplicar días. Sin conexión, solo se ve lo local. **Las estadísticas deben salir de esta
  misma vista** para no contradecir al historial.
- **Copias locales**: cada fila leída del servidor deja una copia (`readHistoryPageThroughRepository`).
  No hay caducidad ni límite de tamaño. Solo hay copia de lo que se ha cargado alguna vez, así que **sin
  conexión no se sabe si falta un día porque no hay registro o porque nunca se descargó.**
- **Borrados en el servidor**: una copia local `synced` solo desaparece si se vuelve a leer ese mismo día
  (`refreshSnapshot(…, null)`). Las páginas del historial no eliminan las copias de los días que ya no
  vienen. Hoy no hay borrado en la app, pero la RLS lo permite.
- **Acceso revocado**: con conexión, la RLS devuelve vacío. Sin conexión, las copias locales de esa
  mascota siguen visibles hasta que alguien las limpie, y la limpieza de datos locales de cuentas y
  mascotas que no vuelven está **pendiente** (`CLAUDE.md`).
- **«Hoy»** (`useTodayLogDate`): zona del perfil de **quien mira** → dispositivo → UTC. La BD valida con la
  zona del **propietario**. Un co-tutor en otra zona puede ver la ventana desplazada un día cerca de medianoche.
- `repository.list(petId)` lee las claves una a una. Con cientos de copias locales por mascota será lento
  (hay que medirlo en 15C).

### 1.7 Lo que ya existe en la UI y se reutiliza

- **Historial** (`pet-history.tsx`, tableros 6.1, 6.2, 6.3, 6.5 y 12.3): semana (5 series, como mucho 3 a
  la vez, con trazo propio), mes (calendario + minigráfica por serie), «Día a día» y el vacío con menos de 3
  registros (`TREND_THRESHOLD`). Regla vigente: **sin medias ni valoraciones** (`DECISIONS.md` 2026-10-13).
- **Componentes** (`components/ui/`): `TrendChart` y `Sparkline` (SVG propio con `react-native-svg` 15.15.4,
  geometría pura y probada en `chart-geometry.ts`, huecos sin interpolar), `MonthCalendar`, `WeekRing`,
  `SegmentedControl` (de 2 a 4 opciones), `Chip` (con marcador de serie), `Card`, `Banner`, `Tag`,
  `ProgressBar`, `ListItem`, `Skeleton` y `QueryState` (`LoadingState`, `ErrorState`, `EmptyState`).
- **Tokens de gráficas**: `chartEnergy`, `chartAppetite`, `chartMood`, `chartActivity`, `chartSleep` y
  `chartGrid`, con contraste ≥ 4,5:1 en los dos temas (`DECISIONS.md` 2026-10-16).
- **Señales de cambio** en Hoy: reglas descriptivas con umbrales mínimos de datos. Son el precedente de
  «Observaciones».

---

## 2. Alcance funcional recomendado

### 2.1 Principios

1. **Describir, no interpretar.** Se muestra lo que el tutor registró, cuántos días y cómo se reparten.
   Nada de causas, urgencias ni valoraciones de salud. Se evitan «diagnóstico» y «diagnostica»
   (`CLAUDE.md`) y también calificativos clínicos como «anormal», «preocupante» o «empeora».
2. **El denominador siempre a la vista**: «en 18 de los 30 días hay registro»; «apetito indicado en 17».
3. **Nunca rellenar ni estimar.** Un día sin registro es un hueco. Una escala sin indicar no cuenta como «como siempre».
4. **Sin índice global de bienestar.** Las escalas son de tipos distintos (relativas y de calidad), las
   relativas no tienen dirección y la escala es ordinal.
5. **Sin conclusiones con pocos datos.** Cada cifra comparativa tiene un mínimo; si no se alcanza, se
   explica por qué no se muestra.

### 2.2 Unidad de análisis: grupos de valor

Cada valor indicado se agrupa en tres categorías, iguales para todas las escalas:

| Grupo | Valores | Texto (relativa) | Texto (calidad: ánimo, sueño) |
|---|---|---|---|
| Por debajo | 1–2 | «Menos de lo habitual» | «Peor de lo normal» |
| Referencia | 3 | «Como siempre» | «Normal» |
| Por encima | 4–5 | «Más de lo habitual» | «Mejor de lo normal» |

Por qué se agrupa (D-1, D-2): unifica los detalles de 3 opciones con los 1 y 5 antiguos sin
convertir datos, coincide con cómo piensa el tutor («¿como siempre o no?») y evita medias. La intensidad
(1 frente a 2) no se pierde: se ve en la gráfica de Evolución, día a día y con el valor real.

### 2.3 Funciones

**A. Resumen de bienestar (por mascota y periodo)**

- Cobertura: días con registro / días del periodo, y si hoy aún falta («Hoy todavía sin registro»).
- Por escala (las 4 principales primero y los 3 detalles después):
  - Reparto de días en los tres grupos (barra apilada con números, no solo color).
  - `n` = días en que se indicó. Si `n` no llega al mínimo: «Pocos datos (n)».
  - Último valor indicado y su fecha (como ya hace el mes).
- Días con comportamiento inusual: recuento y lista de fechas (abren el día).
- Etiquetas: días con cada etiqueta.
- Sin texto libre en el resumen: las notas solo se ven al abrir el día (§6).

**B. Evolución**

- Selector de serie (como mucho 3 a la vez, como ahora) y de periodo: 7 / 30 / 90 días.
- 7 y 30 días: valores diarios con huecos (`TrendChart` ampliado para etiquetas espaciadas en el eje x).
- 90 días: **barras semanales apiladas** (13 columnas, días por grupo de cada semana). Una línea de 90
  puntos con huecos no se lee en móvil, y la barra semanal no necesita medias.
- Marcas de etiquetas y de comportamiento inusual en el eje temporal (puntos bajo la gráfica, con
  descripción accesible).

**C. Comparación entre periodos**

- El periodo actual frente al anterior de la misma longitud (los 30 días anteriores a los 30 actuales, por ejemplo).
- Se compara el **reparto** («Menos de lo habitual: 2 de 14 días → 7 de 15 días»), nunca medias ni porcentajes
  sueltos sin denominador.
- Solo si **los dos** periodos alcanzan el mínimo de esa escala (§2.4). Si no: «No hay datos suficientes para comparar».
- Sin flechas de «mejora» o «empeora» en las escalas relativas. En ánimo y sueño, como mucho «más días
  peor de lo normal», sin juicio de salud.

**D. Observaciones** (reglas fijas, descriptivas y con umbral; D-9)

Mismo patrón que `change-signals.ts`. Ejemplos de reglas permitidas:

- «Apetito: menos de lo habitual 3 días seguidos (del 2 al 4 de noviembre)». Rachas de días consecutivos
  en un mismo grupo, con un mínimo de 3.
- «Comportamiento inusual marcado 4 días en los últimos 30».
- «Días con “Visita al veterinario”: 2. Lo registrado esos días: …». Se muestran los días juntos, sin
  relacionarlos ni insinuar una causa.
- «Las escalas se han indicado en 9 de los 30 días»: aviso de cobertura baja.

Fuera de la v1, porque llevarían a interpretaciones erróneas con estos datos:

- Correlaciones entre escalas o entre etiquetas y escalas («cuando hay cambio de casa baja el apetito»).
- Patrones por día de la semana: con 90 días hay unas 13 muestras por día y sale ruido.
- Tendencias o regresiones («va a peor», pendientes) y predicciones.
- Cualquier umbral que sugiera ir al veterinario. Eso es de la orientación con IA, que tiene su aviso y su revisión.

### 2.4 Fiabilidad de cada estadística

| Estadística | Fiable | Condición o riesgo |
|---|---|---|
| Días con registro / días del periodo | Sí | Con conexión y el rango completo. Sin conexión, solo con cobertura conocida (§5) |
| Reparto en tres grupos por escala | Sí, si `n` ≥ mínimo | Mostrar `n`. Sesgo de registro: hay quien registra más los días raros |
| Último valor indicado | Sí | Fecha siempre visible |
| Recuento de etiquetas y de comportamiento inusual | Sí | Con pocas apariciones, solo el recuento, sin conclusiones |
| Rachas de días en un mismo grupo | Sí, con un mínimo de 3 días | Solo días consecutivos con valor; un hueco corta la racha |
| Comparación de repartos entre periodos | Con cautela | Los dos periodos con mínimo; denominadores visibles |
| Media o mediana por escala | **No** (no mostrar) | Ordinal, no equidistante, relativa a una referencia que cambia |
| Índice global de bienestar | **No** | Mezcla escalas sin dirección común; parece una nota clínica |
| Tendencia o pendiente | **No** | Pocos datos, huecos y referencia móvil |
| Correlaciones y patrones semanales | **No** | Muestras pequeñas: correlaciones espurias |
| Porcentajes sin denominador | **No** | «100 % de días con apetito bajo» puede ser 1 de 1 |

**Mínimos propuestos** (D-4), por escala y periodo: **7 días → 4 valores; 30 días → 12; 90 días → 30.**
Para comparar, los dos periodos deben alcanzarlos. Sigue en vigor el umbral de 3 registros para que haya
cualquier evolución (`TREND_THRESHOLD`).

### 2.5 Periodos, días sin registro y registros incompletos

- **Periodos móviles** que terminan **hoy** (en la zona de quien mira, la misma que el historial): 7 días =
  hoy − 6 … hoy. Hoy cuenta como día del periodo; si falta, se dice («hoy todavía sin registro») y no se
  presenta como hueco (D-3).
- **Días sin registro**: no entran en ningún grupo ni denominador de escala. Cuentan en la cobertura. En
  las gráficas son huecos.
- **Registros incompletos**: cada escala tiene su propio `n`. Un registro sin escalas (solo nota o
  etiqueta) cuenta como día registrado y para etiquetas y comportamiento inusual, pero no para las escalas.
  Los detalles suelen tener un `n` menor: se dice así («Sueño indicado en 6 días»), sin tratarlo como un fallo del tutor.
- **Datos antiguos de los detalles** (1 o 5): entran en su grupo como cualquier otro valor; en Evolución se
  muestra el valor real con su texto (`scaleValueLabel`).

### 2.6 Estados vacíos y con pocos datos

| Situación | Qué se muestra |
|---|---|
| Sin registros | Vacío sin culpa (como el 6.5) y «Registrar hoy» si puede editar |
| Entre 1 y 2 registros | «Su resumen aparecerá con 3 días registrados», `WeekRing` y lista de lo que hay |
| ≥ 3 registros, pero alguna escala bajo el mínimo | El resumen, con esa escala como «Pocos datos (n)» y sin barra |
| Periodo sin registros, pero con historial anterior | «No hay registros en los últimos 7 días», con enlace a 30 o 90 días |
| Comparación imposible | «No hay datos suficientes para comparar con los 30 días anteriores» |
| Mascota sin acceso o ya no visible | El estado actual de `ActivePetGate` y del perfil, nunca «0 registros» |
| Mascota creada sin conexión y aún sin id | `LocalPetLogsUnavailable`, el estado actual |

### 2.7 Última sincronización y modo sin conexión

- Con conexión y datos al día: no se muestra nada.
- Sin conexión: el `Banner` actual («Sin conexión…») y una línea «Datos del dispositivo, actualizados el
  {fecha, hora}» (de la cobertura, §5).
- Si el periodo no está entero en el dispositivo: «Sin conexión solo hay N de los 30 días en este
  dispositivo». Las cifras se calculan con lo que hay y se marcan como **parciales**; la comparación no se muestra.
- Con cambios sin sincronizar dentro del periodo: «Incluye N registros sin sincronizar» (D-5). Los días en
  conflicto o fallidos, con la versión del dispositivo y su estado, igual que el historial.

---

## 3. Pantallas y navegación

### 3.1 Recomendación (D-6): rutas nuevas en la pila de la mascota, sin tocar la barra

```
(app)/pets/[id]/wellness/index.tsx      Resumen        (periodo 7 · 30 · 90)
(app)/pets/[id]/wellness/evolution.tsx  Evolución      (?period=7|30|90&series=…)
(app)/pets/[id]/wellness/patterns.tsx   Observaciones  (?period=…)
```

- **Entradas**:
  1. Pestaña **Historial**: una tarjeta nueva arriba («Últimos 30 días · 18 de 30 días registrados ›»)
     sobre el panel Semana/Mes actual, que no cambia.
  2. **Perfil de la mascota**: una fila «Resumen de bienestar».
  3. Opcional: la tarjeta de señal de Hoy, con «Ver evolución».
- Las tres pantallas comparten el periodo (parámetro de ruta) y, en la cabecera del Resumen, un
  `SegmentedControl` de 3 opciones. Evolución y Observaciones se abren desde secciones del Resumen
  («Ver evolución ›», «Ver observaciones ›»).
- Por qué no una pestaña ni un cambio del Historial: la barra de cinco posiciones está decidida
  (`DECISIONS.md` 2026-10-16), el Historial está implementado y validado, y la pila `pets/[id]/…` ya es el
  patrón para las vistas por mascota (logros, consultas, co-tutores). Así se mantiene la mascota activa
  como contexto y se puede enlazar a una mascota concreta.
- Alternativa, si se prefiere: en Historial, cambiar «Semana | Mes» por «Resumen | Evolución | Días». Es
  más directa, pero rehace una pantalla validada.

### 3.2 Contenido de cada pantalla (solo componentes existentes salvo lo indicado)

**Resumen** (`Screen` + `TopBar` con el nombre de la mascota)

1. `SegmentedControl` 7 · 30 · 90.
2. `Card` de cobertura: «18 de 30 días con registro», `ProgressBar`, nota de hoy pendiente o de datos sin conexión.
3. `Card flush` con una fila por escala (`ListItem` ampliado): nombre, `n`, **DistributionBar** (nuevo, §3.3) y último valor.
4. `Card` de comportamiento inusual y etiquetas: recuentos con `Tag` y enlaces a los días.
5. «Comparado con los 30 días anteriores»: filas de texto con los dos repartos, o el estado de «no hay datos suficientes».
6. Pie: aviso fijo «Kitom resume lo que has registrado; no es una valoración veterinaria» (copy por revisar).

**Evolución**: chips de serie (la lógica de `toggleSeries`) + `TrendChart` (7 y 30 días) o barras semanales
(90 días) + puntos de etiquetas y de comportamiento inusual + lista «Días» que abre `daily-logs/[date]`.
Mantiene los huecos y la descripción accesible de lo que se ve, sin interpretar, como el gráfico actual.

**Observaciones**: lista de tarjetas (`Card` + `Alert` de tipo `info`, nunca `warn` ni `bad`) generada por las
reglas del §2.3 D. Cada una dice qué regla la produce y con qué días. Si no hay ninguna, «No hay nada que
destacar con lo registrado», que no es un «todo bien».

### 3.3 Componentes nuevos o ampliados

- **`DistributionBar`** (nuevo, en `components/ui/`): barra horizontal de 3 segmentos con los tokens
  existentes (`chartGrid` para la referencia y un tono de la serie para los extremos), **números visibles**
  y textura o separadores para no depender del color. Pasa por el diseño (`docs/design/componentes/`)
  antes de implementarlo.
- **`TrendChart`**: hoy pinta todas las etiquetas del eje x en fila, lo que no sirve para 30 puntos. Se
  amplía con etiquetas espaciadas (cada 7 días) y un punto en cada valor aislado (un día suelto entre huecos).
- **Barras semanales** (90 días): `WeeklyDistributionChart` nuevo sobre `chart-geometry.ts`, o una variante de `DistributionBar` en vertical.
- No hace falta ninguna librería nueva (§4.6).

---

## 4. Arquitectura técnica

### 4.1 Dónde vive

`frontend/src/features/wellness/`. Feature propia, porque mezcla escalas, etiquetas y cobertura, pero
depende de `features/daily-logs` para los tipos, las query keys, el repositorio y la vista combinada:

- `wellness-stats.ts` (puro, `npm test`): ventanas, grupos, repartos, mínimos, comparación y cobertura.
- `wellness-observations.ts` (puro): las reglas del §2.3 D.
- `hooks/use-wellness.ts`: une la consulta por rango, lo local y la cobertura, y devuelve el estado de la pantalla.
- `components/…` y las rutas del §3.1.

### 4.2 Consultas (TanStack Query)

- **Una consulta por rango** que cubre el periodo actual y el anterior:
  `daily_logs?pet_id=eq.X&log_date=gte.{hoy−2P+1}&log_date=lte.{hoy}&order=log_date.desc`, con como mucho
  180 filas. Va en `daily-logs/api` (`fetchDailyLogRange`) y en un módulo puro como `queryHistoryPage`,
  probado contra el Supabase local.
- **Columnas completas** (`DAILY_LOG_COLUMNS`) y paso por el repositorio, como el historial
  (`readHistoryPageThroughRepository`): cada fila deja su copia local y se puede ver sin conexión. Las
  estadísticas ignoran `notes` y `unusual_behavior_notes`. Alternativa descartada: pedir solo las columnas
  numéricas. Reduce la carga (tampoco mucho: notas ≤ 2000 caracteres × 180), pero esas filas parciales no
  pueden ser copias locales válidas (`parseDailyLogRow`) y harían falta dos cachés.
- Clave: `dailyLogKeys.range(userId, petId, start, end)` bajo `['daily-logs']`. Lleva el usuario, como
  todas, y se vacía al cambiar de cuenta.
- Tras sincronizar un registro: invalidar `['daily-logs', 'range', userId, petId]`, igual que hoy se
  actualiza el historial (`applyLocalChangeToCache`).
- `staleTime` por defecto (30 s). Sin `refetchInterval`. Al cambiar de periodo se reutiliza la consulta de 90
  días si ya está cargada y es más amplia (el de 7 y el de 30 salen de ella). Es una optimización opcional.

### 4.3 Agregación: en el cliente

| Criterio | Cliente | RPC en Postgres |
|---|---|---|
| Volumen | ≤ 180 filas: trivial | Sin ventaja apreciable |
| Sin conexión | Funciona con las copias locales | No funciona |
| Cambios pendientes | Los incluye (vista combinada) | No los ve: contradice al historial |
| Permisos | Solo las filas que deja la RLS | Necesitaría SECURITY INVOKER o una comprobación explícita |
| Coste de cambio | Módulo puro y probado | Migración, tipos, pgTAP y `db push` |

**No hace falta migración ni Edge Function.** Si más adelante el informe PDF (`generate-pet-report`,
pendiente) necesita las mismas cifras en el servidor, se reescribirán en la Edge Function a partir de la
especificación del módulo puro. Es un riesgo de divergencia, anotado en el §8.

### 4.4 Paginación y límites

- Sin paginación en esta función: el periodo máximo es acotado. Por seguridad, `limit(2 × 90 + 1)`. Una
  fila de más indicaría un error de rango y se registraría (Sentry, sin contenido).
- El historial «Día a día» sigue paginado como ahora.

### 4.5 Coste

Una petición de ≤ 180 filas por apertura y mascota, después de los 30 s de `staleTime`. Ningún coste de
cómputo en el servidor más allá de la lectura con índice. Sin tablas nuevas ni triggers.

### 4.6 Gráficas: librerías

| Opción | Valoración |
|---|---|
| **SVG propio** (`react-native-svg` 15.15.4, ya instalado, y `chart-geometry.ts`) | **Recomendada.** Ya en uso, probada, con tokens y accesibilidad propios y compatible con Expo Go, nativo y web. Solo hay que añadir barras y etiquetas espaciadas |
| victory-native (Skia) | Añade `@shopify/react-native-skia` (binario grande; en web, CanvasKit en WASM). Demasiado para barras y líneas |
| react-native-gifted-charts | Depende de `react-native-svg` y de un paquete de degradados. Otro sistema visual que habría que domar para respetar los tokens |
| react-native-chart-kit | Poco mantenida; sin huecos (interpola) |

Cualquier paquete nuevo requiere permiso y `npx expo install` (`CLAUDE.md`); la recomendación es no añadir ninguno.

---

## 5. Estrategia offline

### 5.1 Qué se ve sin conexión

Las estadísticas se calculan sobre la vista combinada: copias locales `synced` más las operaciones
`pending`, `failed` y `conflict`, con su contenido local. Es la misma regla que el historial, así que el
resumen y la lista de días nunca se contradicen.

### 5.2 Cobertura conocida (nuevo, sin esquema)

El problema es que, sin conexión, la falta de un día puede significar que no hay registro o que nunca se
descargó. La propuesta (D-7) es una colección nueva de `LocalStore`, `daily-log-coverage`, por usuario y
mascota: los rangos de fechas leídos **completos** del servidor y cuándo (`{ start, end, fetchedAt }[]`,
fusionados). La escribe la consulta por rango cuando termina bien, y opcionalmente el historial paginado
(cada página cubre desde su cursor hasta la última fila).

- Rango del periodo cubierto → cifras completas y «actualizado el …».
- No cubierto → cifras **parciales** marcadas, sin comparación.
- Versión de colección 1, validada al leerla como las demás. Sin contenido sensible: solo fechas.

### 5.3 Reconciliación de borrados (cambio en la capa de lectura)

Cuando la consulta por rango devuelve las filas de un rango completo, las copias locales `synced` de ese
rango que **no** vienen y no tienen operación pendiente se eliminan (`refreshSnapshot(…, null)`). Así un
día borrado en el servidor desaparece también del resumen sin conexión. Una copia con operación pendiente
nunca se toca: el motor de sincronización ya resuelve esos casos (`row_missing`).

### 5.4 Rendimiento del almacén local

`repository.list(petId)` lee cada clave por separado. Se propone `listRange(petId, start, end)`, que
filtra los ids por fecha **antes** de leer (la fecha va en la clave). Hay que medirlo en 15C con 365
registros en el emulador Android antes de dar la fase por buena.

### 5.5 Lo que queda fuera

- Limpiar las copias de mascotas a las que se ha perdido el acceso estando sin conexión. Ya está pendiente
  en el proyecto («limpieza de datos locales de cuentas que no vuelven»). Esta fase no lo empeora, porque
  el historial ya muestra esas copias, pero el resumen las sumaría (riesgo R-6).
- Coordinación entre pestañas en web (pendiente general).

---

## 6. Seguridad y privacidad

| Comprobación | Resultado de la auditoría | Diseño |
|---|---|---|
| El viewer solo ve lo autorizado | `is_pet_member`: el viewer aceptado lee todo el registro de la mascota, incluidas las notas (vigente) | Las estadísticas no muestran más que el historial: mismo acceso |
| Agregados por mascota | Se calculan en el cliente sobre filas ya filtradas por la RLS | No hay ninguna ruta SECURITY DEFINER nueva. Si algún día hay una RPC: SECURITY INVOKER o `is_pet_member` explícito, y pgTAP |
| Sin fugas entre propietarios | La consulta solo filtra `pet_id` y la RLS decide. Las query keys y `LocalStore` van por `userId`; la caché se vacía al cambiar de cuenta | El `pet_id` de la ruta no se da por bueno: una lista vacía de una mascota no visible se muestra como «sin acceso» (`ActivePetGate` o la consulta de la mascota), no como «0 registros» |
| Pendientes, rechazadas y revocadas | Sin acceso según la definición de `is_pet_member`, pero **sin prueba pgTAP** de lectura de `daily_logs` en esos estados | Añadir las pruebas en 15C (solo `supabase/tests/`, sin migración) |
| Compartir informes | No se comparte nada en esta fase (D-8). `pet_shared_reports` y `request_generate_report` son un esbozo, sin Edge Function. `shared_reports: select members` y la política de Storage `shared-reports` dejan leer **cualquier** informe de la mascota a todos sus miembros (también a un viewer, aunque solo un editor podría generarlo) | En la fase del PDF: excluir `notes` y `unusual_behavior_notes` por defecto (incluirlas solo marcándolo), no poner nombres ni emails de co-tutores, URL firmada de corta duración, revisar los buckets sin límite de tamaño ni tipo y añadir las pruebas de `pet_shared_reports` y Storage que lista `SECURITY_AUDIT.md` §4 |
| Capturas | Una captura del resumen lleva el nombre de la mascota y las cifras, pero no texto libre | El resumen no muestra notas (§2.3 A) |
| Registros técnicos | `LocalStore` no escribe contenido en logs | Las estadísticas tampoco se envían a Sentry ni a analítica: solo códigos de error |
| Grants sobrantes (fuera de alcance) | En la baseline, `anon` y `authenticated` tienen grants de escritura sobre `pet_shared_reports` y `pet_streaks`. Sin políticas que los permitan, la RLS los bloquea | Anotarlo para la fase del PDF. No requiere acción ahora |

---

## 7. Pruebas

Niveles: **U** = unitaria pura (`npm test`); **I** = integración contra el Supabase local
(`npm run test:integration`); **P** = pgTAP local; **M** = manual (emulador Android y web).

| Caso | Nivel | Qué se comprueba |
|---|---|---|
| Mascota sin registros | U, M | Vacío sin culpa; sin barras ni comparación; «Registrar hoy» solo si puede editar |
| Un solo registro | U | Cobertura 1/N; ninguna escala alcanza el mínimo; mensaje de 3 registros |
| Registro sin escalas (solo nota o etiqueta) | U | Cuenta como día y para etiquetas, no para escalas |
| Escalas incompletas | U | `n` por escala; los detalles con `n` menor; «Pocos datos (n)» |
| Detalles con valores antiguos 1 y 5 | U | Entran en los grupos 1–2 y 4–5; Evolución muestra su texto original |
| `tags = NULL` | U | Se trata como `[]` |
| Días sin registro | U | No entran en los denominadores de las escalas; huecos en las gráficas, sin interpolar |
| Hoy sin registro | U | «Hoy todavía sin registro»; no se trata como un hueco del pasado |
| Mínimos por periodo (7/30/90) | U | Umbrales exactos: justo por debajo y justo en el mínimo |
| Comparación con un solo periodo suficiente | U | «No hay datos suficientes para comparar» |
| Rachas de observaciones | U | Un hueco corta la racha; un mínimo de 3; nunca cruza el inicio del periodo |
| Periodos con distinta cantidad de datos | U | Los repartos con sus denominadores; ningún porcentaje sin `n` |
| Cambio pendiente sin conexión | U, M | Las cifras usan el contenido local; aviso «Incluye N sin sincronizar» |
| Conflicto de sincronización | U, M | Se usa la versión del dispositivo (D-5); tras resolver, las cifras cambian sin recargar |
| Fallo definitivo (`failed`) | U | Igual que pendiente, con el estado visible |
| Sin conexión con cobertura completa | U, M | Cifras completas y «actualizado el …» |
| Sin conexión sin cobertura | U, M | Cifras parciales marcadas y sin comparación |
| Borrado en el servidor | I | La consulta por rango elimina la copia `synced` y conserva la pendiente |
| Respuesta tardía de otra sesión | U, I | No llega a las queries de la cuenta activa (claves con `userId`) |
| Zona horaria de quien mira | U | Ventanas con «hoy» en `Pacific/Kiritimati` (+14) y `Pacific/Pago_Pago` (−11). Aritmética de fechas en UTC |
| Co-tutor en otra zona | U, M | Ventana desplazada un día cerca de medianoche, sin error ni duplicados |
| Cambio de horario de verano | U | 7 días = 7 fechas naturales en las semanas del cambio |
| Viewer | I, P | Lee y ve las mismas cifras que el propietario; no ve acciones de edición |
| Invitación pendiente, rechazada o revocada | P, I | 0 filas de `daily_logs` (**pgTAP nuevo**) |
| Se revoca el acceso con la pantalla abierta | I, M | El siguiente refetch da vacío → «sin acceso»; las copias se eliminan por reconciliación |
| Rol de editor a viewer | I | Sigue leyendo; desaparecen las acciones de editar |
| Ajeno con `pet_id` válido en la ruta | I | 0 filas; «sin acceso», nunca «0 registros» |
| Cambio de cuenta | I, M | Ni la caché ni la cobertura de la cuenta anterior se ven |
| 365 registros locales | M | Tiempo de apertura del resumen sin conexión en Android (objetivo < 500 ms, por confirmar) |
| Accesibilidad | M | Lector de pantalla: barras con texto («Apetito: 3 días menos, 10 como siempre, 1 más; indicado en 14 de 30»); texto escalado; sin depender del color |
| Copy | Revisión | Ninguna aparición de «diagnóstico», «diagnostica», «anormal» ni «empeora»; aviso visible |

---

## 8. Plan de implementación (15B–15F)

Cada subfase en su rama `feat/…`. Sin cambios de BD. Las pruebas pgTAP nuevas solo tocan
`supabase/tests/`, sin migraciones. Si en algún momento hiciera falta un cambio de esquema, iría en su
propio PR `db/…` con aprobación previa.

| Fase | Contenido | Hecho cuando |
|---|---|---|
| **15B** Dominio | `features/wellness/wellness-stats.ts` y `wellness-observations.ts` (puros): ventanas, grupos, repartos, mínimos, comparación, cobertura y reglas. Pruebas U de la tabla del §7 | `npm test` en verde; ninguna dependencia nueva |
| **15C** Datos y offline | `fetchDailyLogRange` (pura más la API), `dailyLogKeys.range` e invalidación tras sincronizar, colección `daily-log-coverage`, reconciliación de borrados, `listRange`, `useWellness`. Pruebas I (RLS por rol y estado, borrados, cambio de cuenta) y pgTAP de lectura para pendiente, rechazada y revocada. Medición con 365 registros | Integración y pgTAP en verde en local; medición anotada en `TESTING.md` |
| **15D** Resumen | Ruta `pets/[id]/wellness`, entradas desde Historial y Perfil, selector de periodo, `DistributionBar` (antes, diseño en `docs/design/componentes/`), estados del §2.6 y §2.7, i18n es/en y accesibilidad | `lint` y `tsc` limpios; validación M en web y Android |
| **15E** Evolución y observaciones | `TrendChart` con etiquetas espaciadas y puntos aislados, barras semanales de 90 días, marcas de etiquetas y comportamiento inusual, pantalla de Observaciones | Copy revisado (D-9); validación M |
| **15F** Cierre | E2E en el emulador Android (con y sin conexión, conflicto, viewer) y en web; documentación: `FRONTEND_ARCHITECTURE.md` §4 (pantalla nueva) y §5 (cobertura), `DECISIONS.md`, `CHANGELOG.md`, `TESTING.md`, `PANTALLAS.md` §6 y `PROJECT_STATUS.md` | Definición de «terminado» de `CLAUDE.md` |

Opcional, fuera del camino crítico: llevar las señales de cambio de Hoy a la consulta por rango, para que
su referencia de 28 días esté completa (§1.5, D-11).

---

## 9. Riesgos y decisiones que requieren aprobación

### 9.1 Decisiones

| # | Decisión | Recomendación |
|---|---|---|
| D-1 | Cómo representar las escalas | Reparto en 3 grupos con `n`; **sin medias ni índice global de bienestar** |
| D-2 | Agrupar 1–2 y 4–5 (también los detalles antiguos) | Sí; la intensidad se ve en Evolución |
| D-3 | Periodos | Móviles de 7, 30 y 90 días que terminan hoy (zona de quien mira), con hoy incluido y señalado si falta |
| D-4 | Mínimos | 4, 12 y 30 valores por escala para 7, 30 y 90 días; comparar solo si los dos periodos llegan |
| D-5 | Cambios pendientes, fallidos y en conflicto | Incluirlos con la versión del dispositivo y un aviso (como el historial) |
| D-6 | Navegación | Rutas `pets/[id]/wellness/{index,evolution,patterns}` con entradas desde Historial y Perfil; la barra no cambia |
| D-7 | Cobertura local y reconciliación de borrados | Nueva colección `daily-log-coverage` y eliminación de copias `synced` ausentes en un rango completo |
| D-8 | Compartir | Nada en la fase 15. El PDF para el veterinario va en una fase propia (`generate-pet-report`) con las reglas del §6 |
| D-9 | Observaciones | Solo reglas descriptivas del §2.3 D, sin correlaciones, patrones semanales ni tendencias. ¿El copy necesita revisión veterinaria antes de publicar? (Recomendado: sí, como con la IA) |
| D-10 | Textos del sueño | Confirmar «peor / normal / mejor» (calidad), que es lo que hace hoy la UI (`PANTALLAS.md` §6.1) |
| D-11 | Señales de Hoy con la consulta por rango | Opcional; corrige la referencia truncada |
| D-12 | Límite del plan (PRD: gratis 30 días, Premium completo) | En la v1, 90 días para todos (Premium está fuera de la v1). Un límite futuro solo en el cliente no protege nada: la RLS deja leer todo el historial |
| D-13 | Nombre | «Resumen de bienestar»; reservar «informe» para el PDF |

### 9.2 Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| R-1 | Que se lea como una valoración clínica | Principios del §2.1, aviso fijo, sin colores de alarma (`Alert` solo `info`) y revisión del copy |
| R-2 | Sesgo de registro: se registra más los días raros | Cobertura siempre visible; sin porcentajes sin denominador |
| R-3 | La referencia «lo habitual» cambia con el tiempo; comparar 90 días puede engañar | Comparar repartos, no niveles; explicarlo en una ayuda breve |
| R-4 | Detalles con resoluciones mezcladas (3 y 5 opciones) | Agrupación (D-2) |
| R-5 | Las ediciones retroactivas cambian resúmenes ya vistos; no hay historial de versiones | Aceptado. Cuando haya PDF, el informe será una instantánea fechada |
| R-6 | Copias locales de mascotas revocadas o con días borrados, sin conexión | Reconciliación en cada lectura con conexión (§5.3); limpieza general pendiente en el proyecto |
| R-7 | Rendimiento de `LocalStore` con muchos registros | `listRange` y medición en 15C |
| R-8 | Co-tutor en otra zona horaria: ventana desplazada un día | Documentado; mismo comportamiento que el historial |
| R-9 | Que las cifras del cliente y de un futuro PDF en el servidor no coincidan | Especificación única en el módulo puro, casos de prueba compartidos y reescritos en la Edge Function |
| R-10 | `TrendChart` ilegible con 30 o 90 puntos | Etiquetas espaciadas y barras semanales para 90 días |
