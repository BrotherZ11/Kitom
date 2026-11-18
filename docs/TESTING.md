# Kitom — Pruebas

Estrategia, comandos, resultados reales y huecos (revisión 2026-10-29). Reglas de ejecución de cada
suite: [`frontend/CLAUDE.md`](../frontend/CLAUDE.md) y [`supabase/CLAUDE.md`](../supabase/CLAUDE.md).

## 1. Estrategia

1. **Lógica pura** (sin React ni red) en módulos `.ts` probados con `node --test` (`*.test.mjs`):
   motores offline, fusiones, errores, fechas, modelos de pantalla.
2. **Integración contra Supabase local** (`*.integration.test.mjs`): flujos reales de API, RLS y
   sesión con usuarios creados al vuelo. Los scripts se niegan a correr si la URL no es local.
3. **Base de datos**: pgTAP en transacción con `ROLLBACK` (permisos por rol, integridad, RPC) y
   scripts de concurrencia con varias sesiones de `psql` (carreras que pgTAP no puede probar).
4. **Edge Functions**: módulos sin Deno probados con `node --test`; limpieza de Storage también contra
   el Storage local.
5. **Manual** en emulador Android (Expo Go o build debug nativa) y en web, registrada en `CHANGELOG.md`.

No hay tests de componentes React, E2E automatizados, pruebas de accesibilidad ni de rendimiento.

## 2. Comandos

| Suite | Comando | Requisitos |
|---|---|---|
| Tipos | `cd frontend && npx tsc --noEmit` | — |
| Lint | `cd frontend && npx expo lint` | — |
| Unitarias | `cd frontend && npm test` | — |
| Integración | `cd frontend && npm run test:integration` | `npx supabase start` |
| pgTAP | `npx supabase test db` (raíz) | Supabase local |
| Concurrencia | `bash supabase/tests/concurrency/<suite>_concurrency.sh` | Supabase local; `pet_storage_cleanup` necesita el bucket local |
| Edge Function IA | `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON supabase/functions/ai-analysis-process/*.test.mjs` | — |
| Edge Functions de suscripción | `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON supabase/functions/_shared/subscription.test.mjs` y `node supabase/functions/_shared/run-integration.mjs` | la integración, Supabase local (RevenueCat simulado) |
| Edge Function limpieza | `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON supabase/functions/pet-storage-cleanup/cleanup.test.mjs` y `node supabase/functions/pet-storage-cleanup/run-integration.mjs` | la integración, Supabase local |
| Salud del proyecto | `cd frontend && npx expo-doctor` | red |
| Dependencias | `cd frontend && npm audit --omit=dev` | red |
| Comparación visual | `cd frontend && npm run visual:compare` | web en marcha y credenciales de prueba por entorno |

## 3. Resultados de la auditoría (2026-10-29, Node 24.12, Supabase CLI 2.122)

| Comando | Resultado | Detalle |
|---|---|---|
| `npx tsc --noEmit` | **correcto** | 0 errores |
| `npx expo lint` | **correcto** | 0 errores, 0 avisos |
| `npm test` | **correcto** | 749/749 (55 archivos) |
| `npm run test:integration` | **correcto** | 63/63 (10 archivos); los `AuthRetryableFetchError` del log son de las pruebas que simulan falta de red |
| `npx supabase test db` | **fallido (1)** | 378/379; falla `daily_logs.test.sql` nº 121 (TEST-01, abajo) |
| Concurrencia `daily_logs`, `pets`, `pets_delete`, `pet_storage_cleanup` | **correcto** | todas las comprobaciones pasan |
| Unitarias `ai-analysis-process` | **correcto** | 14/14 |
| Unitarias `pet-storage-cleanup` | **correcto** | 26/26 |
| Integración `pet-storage-cleanup` | **fallido (1)** | 1/2 (TEST-02, abajo) |
| `npx expo-doctor` | **fallido (1 de 21)** | 5 paquetes con el parche por detrás del SDK: `expo`, `expo-router`, `expo-network`, `expo-notifications`, `@expo/ui` |
| `npm audit --omit=dev` | 15 avisos | 4 altas, 6 moderadas, 5 bajas; todas transitivas de herramientas de Expo (SEC-20) |
| Builds nativas, iOS, dispositivo físico | **no ejecutado** | fuera del alcance de esta auditoría |

### Tras las correcciones (mismo día)

| Rama | Comando | Resultado |
|---|---|---|
| `db/ai-quota-and-invitations` (migración aplicada en local con `migration up --local`) | `npx supabase test db` | **correcto**: 406/406 (9 archivos; nuevo `ai_quota.test.sql` y casos nuevos en `pet_invitations.test.sql`; TEST-01 corregido) |
| ídem | concurrencia (4 suites) | **correcto** |
| ídem | `npm run test:integration` | **correcto**: 63/63 |
| ídem | `npx supabase db diff --local` | sin diferencias en los objetos de la migración (el motor `pg-delta` lista como `CREATE OR REPLACE` funciones anteriores sin cambios) |
| `fix/audit-hardening` | `tsc`, `expo lint` | **correcto** |
| ídem | `npm test` | **correcto**: 752/752 (3 pruebas nuevas en `ai-analysis-model.test.mjs`) |
| ídem | `npm run test:integration` | **correcto**: 63/63 |

Antes de la migración, `ai_quota.test.sql` falló en local en los casos que reproducen SEC-01 (cupo
recuperado al recrear la mascota) y SEC-10 (consulta sin aviso aceptado): la prueba demuestra el fallo
y su corrección. TEST-02, corregido el 2026-11-18 (la prueba pone su trabajo el primero de la cola antes del informe).

### Registro, emails y APK contra `kitom-dev` (2026-11-04)

Build de release en emulador Android, con el bundle comprobado (`supabase.co` sí, `127.0.0.1` no):

- Inicio de sesión: sin aviso legal y con respuesta del servidor («contraseña incorrecta»), sin error de red.
- Google: abre `accounts.google.com` con `redirect_uri` de Supabase. **Sin completar:** falta una cuenta de Google.
- Página puente en Chrome: abre la app sola (con un código falso, que la app rechaza).
- **Sin probar:** acceso con una cuenta real (`usuario-a@kitom.test` ya no existe), confirmación y recuperación con
  correo real, y Redirect URLs del remoto. Quedan en `SETUP_GUIDE.md` §5.

En web contra el Supabase local: aviso único, sugerencia de email, `/legal/*`, 7000 kg y 1950 rechazados en un perro, y
7,5 kg aceptados. Correo de recuperación recibido en Mailpit con plantilla y asunto de Kitom. Página puente con
Playwright: PC (registro, recuperación, error por query y por fragmento), Android con y sin app, y flujo desconocido.

### Sentry (2026-11-04)

APK de release en emulador Android, contra el Supabase local, con una ruta temporal que forzaba los errores (ya retirada):

- Error de JS y cierre nativo recibidos en `kitom-app`, con entorno y release correctos. Hay que reabrir la app para que lleguen algunos eventos.
- Privacidad: con las reglas del panel activas (`DEPLOYMENT.md` §8, paso 10), ni el error de JS ni el cierre nativo guardan usuario, ubicación ni `device.id`.
- Stack trace: con los source maps subidos desde Gradle, el de JS muestra archivo, línea y código; el de Java también se lee.
- **Sin probar:** la subida desde EAS (aún sin proyecto) y un fallo en código nativo C/C++.

### Pruebas a fondo y Kitom Premium (2026-11-16)

Contra el Supabase local con las 20 migraciones (`migration up --local`, sin `db reset`). Hallazgos y lo no probado:
[`QA_2026-11-16.md`](QA_2026-11-16.md).

| Comando | Resultado |
|---|---|
| `npx supabase test db` | 803/803 (nueva: `premium_plans.test.sql`, 72 casos). Antes, 730/731: `ai_guidance_v2` nº 25 inestable (QA-03, corregido). Las suites que invitan o crean más de 2 mascotas hacen Premium a sus cuentas |
| Concurrencia | 7 suites correctas; nueva `premium_concurrency.sh` (8 altas a la vez de una cuenta gratuita con 1 mascota: pasa 1; 8 reenvíos de la misma alta: 23505, ninguno `pet_limit_reached`; Premium: pasan las 8) |
| Edge Functions | 83/83 + 29/29 unitarias de suscripción; integración de suscripción 7/7 (compra, cancelación, duplicado, caducidad, JWT falso, sin privilegios del usuario) |
| `npm test` | 1029/1029 (nuevas: `plan-model.test.mjs`) |
| `npm run test:integration` | 85/85 (nueva: `plan.integration.test.mjs`); las demás usan `scripts/integration-premium.mjs` |
| `tsc`, `expo lint` | correctos |
| `expo-doctor` | 20/21: 10 parches pendientes (QA-04) |
| `gradlew assembleDebug` (x86_64) con `react-native-purchases` 11.0.2 | correcta (un primer intento falló en Kotlin por memoria; repetido, compila). Instalada en el emulador: arranca y `/premium` dice que las compras no están disponibles (sin clave de RevenueCat) |

A mano (web y emulador Android, Supabase local): recorrido completo con conexión, sin conexión y arranque en frío sin
conexión (`QA_2026-11-16.md` §1); Kitom Premium con una cuenta gratuita y con una compra simulada con
`apply_subscription_state`. **Sin probar:** una compra real (necesita Play Console y RevenueCat), el webhook real e iOS.

### Acceso nativo con Google en Android (2026-11-16)

| Comando | Resultado |
|---|---|
| `npm test` | 1017/1017 (nuevas: `google-sign-in-plan.test.mjs`, 13 casos: elección nativo/navegador, cancelación, `DEVELOPER_ERROR`, Play Services, red) |
| `expo lint` / `tsc` | correctos |
| `gradlew assembleRelease` (x86_64) | correcta con `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` de prueba; el bundle contiene `supabase.co` y el ID, y no `127.0.0.1` |

A mano, APK release en el emulador Android (API 36.1, imagen con Play Store y sin cuenta de Google):

- «Continuar con Google» abre el flujo de cuentas de los servicios de Google Play (`com.google.android.gms`), **sin
  navegador**: el camino nativo se elige y el módulo carga en la build.
- Volver atrás desde ese flujo devuelve al inicio de sesión («Hola de nuevo») sin mensaje de error ni cierre de la app (cancelación).
- **Sin probar:** el canje real del ID token con Supabase (hace falta el ID del cliente web en la build y en Supabase, y un
  cliente Android con el SHA-1 de la clave de depuración en Google Cloud), `DEVELOPER_ERROR` con una cuenta en el
  emulador y un móvil físico. Expo Go y web siguen con el navegador (cubierto por las pruebas unitarias).

### Orientación con IA v2 y pantallas pequeñas (2026-11-13)

Contra el Supabase local con las 19 migraciones (`migration up --local`, sin `db reset`) y el seed reejecutado:

| Comando | Resultado |
|---|---|
| `npx supabase test db` | 731/731 (nueva: `ai_guidance_v2.test.sql`, 50 casos; `species_fields.test.sql` actualizado: IA en las 9 especies y el rechazo `ai_species_unsupported` probado desactivando una) |
| `abuse_limits_concurrency.sh` | correcto con la firma nueva de `request_ai_analysis` |
| `npx supabase db diff --local` | sin diferencias en los objetos de `20261113134252` (solo el ruido conocido de `pg-delta`) |
| `npm test` | 1006/1006 (nuevas: contexto, señales agrupadas, señales urgentes por especie, texto para compartir) |
| `npm run test:integration` | 81/81 (`species-fields-parity` reescrita: un reptil pide orientación con sus señales y contexto; «vómitos» se rechaza en reptil) |
| Unitarias de Edge Functions | 83/83 (`ai-analysis-process`: prompt v2, filtros de dosis y «diagnosis», reintentos y modelo de respaldo de Gemini, `urgency.test.mjs` con paridad app/servidor/seed) |
| `expo lint` | correcto |
| `tsc` | correcto tras regenerar `database.types.ts` con `--linked` (2026-11-15, migración aplicada en `kitom-dev`) |

A mano, con `ai-analysis-process` servida en local con `AI_PROVIDER=mock`:

- **Web (Playwright, 360 × 740):** consulta de un conejo de principio a fin: señales agrupadas, aviso urgente al marcar
  «No hace heces» (en el pie, sin mover los chips; posiciones medidas antes y después), contexto, revisión y resultado
  `urgent` por la regla de especie, con resumen, señales de alerta, «Para tu veterinario», compartir y «Lo que contaste».
  Barrido de 21 rutas a 320 × 568 sin desbordes horizontales.
- **Emulador Android (Expo Go, 360 × 640 dp y 320 × 568 dp, letra al 100 % y al 130 %):** alta de cuenta, configuración
  inicial, gata con registro del día y consulta urgente («Hace fuerza para orinar»). Corregido en esta sesión: texto de la
  bienvenida bajo los botones, casilla del aviso veterinario fuera de la vista, casillas del resumen de Hoy cortadas,
  contenido dibujado bajo la barra de estado, pasos de la consulta que heredaban el desplazamiento, chips que cambiaban
  de ancho al marcarlos, etiquetas de la barra de pestañas sin límite de escala y día/hora de la agenda cortados a 320 dp.
- **Sin probar:** Gemini real con el prompt v2 (lo despliega el usuario), foto en la consulta, build nativa y móvil físico.

### Campos por especie y resumen de bienestar (2026-11-11, fases 15 y 16)

Contra el Supabase local con las 18 migraciones (`migration up --local`, sin `db reset`):

| Comando | Resultado |
|---|---|
| `npx supabase test db` | 681/681 (nuevas: `species_fields.test.sql`, `daily_logs_read_access.test.sql`; `daily_logs.test.sql` actualizado a la firma de 16 parámetros y a los GRANT de `species_data`) |
| `npm test` | 999/999 (nuevas: `species-fields`, `species-content`, `wellness-stats`, peso por especie en `pet-plausibility`) |
| `npm run test:integration` | 81/81 (nueva: `species-fields-parity.integration.test.mjs`: catálogo app = BD, ficha y registro con datos de especie, IA rechazada por especie). Tres ejecuciones seguidas correctas; una primera falló en el alta de usuario por el límite local de Auth (`sign_in_sign_ups = 30` cada 5 min) al encadenar ejecuciones |
| Unitarias `ai-analysis-process` | 19/19 (nueva: `species-labels.test.mjs`, textos idénticos a los de la app) |
| Seed `breeds.sql` | aplicado dos veces dentro de una transacción en local: cada especie salvo «Otro» con razas o tipos, nombres es/en, sin duplicados |
| `tsc`, `expo lint` | correctos |
| Web contra el Supabase local (Playwright) | alta de un conejo con sus campos, registro del día con «Su especie» sincronizado, detalle del día, resumen 7 días con los repartos correctos, evolución 30 y 90 días, observaciones; validación de un campo fuera de rango en el registro de un perro. Sin errores de consola |

**No probado todavía:** emulador Android (registro y resumen sin conexión, cobertura parcial, rendimiento con muchos
registros locales), concurrencia de `daily_logs` con la firma nueva (`daily_logs_concurrency.sh`; las llamadas existentes
resuelven a la misma función). La migración y el seed ya están en `kitom-dev` (2026-11-12): los tipos regenerados con
`--linked` coinciden con los que se habían añadido a mano (solo cambia el orden de los campos).

### Agenda sin conexión: frontend (2026-11-06, fase 14)

Contra el Supabase local con las 17 migraciones (`migration up --local`, sin `db reset`):

| Comando | Resultado |
|---|---|
| `npm test` | 941/941 (74 nuevas: `reminder-sync-engine`, `reminder-offline`) |
| `npm run test:integration` | 76/76 (10 nuevas: `reminders-offline.integration.test.mjs`) |
| `tsc`, `expo lint` | correctos |
| `expo export` Android y web | correctos |
| `expo-doctor` | 20/21: hay parches nuevos de paquetes de Expo (`expo` 57.0.32 frente a 57.0.31…), sin actualizar en esta fase |

En la primera ejecución completa de la integración, las suites de razas y de la agenda online se cancelaron en su
`before` (lectura de especies vacía), como ya pasó el 2026-11-05; aisladas pasan, y al repetirla, 76/76. Sin explicar.
Validación a mano en el emulador Android (2026-11-06; build de depuración nativa, Supabase local, modo avión para
cortar la red), con la propietaria y una co-tutora editora:

- **Con conexión:** la agenda carga y guarda la copia y el permiso.
- **En modo avión:**
  - la agenda dice que se ve la copia del dispositivo;
  - se crea un recordatorio («Guardado en este dispositivo») y se marca otro como hecho;
  - los avisos siguen la agenda: el del alta nueva se programa y el del hecho se cancela; los 14 diarios no se tocan.
- **Arranque en frío sin conexión:** «Hoy» y la agenda salen de la copia, con los cambios locales encima, y «Cambios
  sin sincronizar» los lista.
- **Al volver la red:**
  - el alta se crea una sola vez, con su clave;
  - el hecho conserva la hora real a la que se marcó;
  - una edición del mismo título que la co-tutora cambió en el servidor queda en conflicto, con las dos versiones;
  - «Quedarme con lo mío» la envía, y los avisos quedan sin duplicar con el id del servidor.
- **Eliminar sin conexión:** desaparece de la lista y se cancela su aviso. El cierre de sesión la cuenta en «Agenda»;
  al volver la red se envía sola y, al cerrar sesión, no queda ningún aviso de Kitom.
- **Permiso revocado:** la co-tutora crea sin conexión y la propietaria la baja a lectora. Al volver, RLS lo rechaza,
  queda «Sin permiso», se conserva, el servidor no tiene nada y solo se descarta cuando ella lo pide.
- **Corregido durante la prueba:** Ajustes decía «hay cambios de mascotas» por un cambio de la agenda.
- **Sin probar a mano:** web, posponer y «Deshacer», y la red que vuelve con la app en segundo plano.

### Borrar una cuenta y agenda sin conexión: backend (2026-11-05, en local)

Migraciones `20261105093545` y `20261105122353`, juntas. Sobre un Supabase local desechable: primero las 15 migraciones de `kitom-dev`
y luego estas dos con `migration up`, como haría un `db push`; `db diff` contra una base aplicada desde cero (17): sin cambios.

| Comando | Sin la corrección de D-11 | Con las dos migraciones |
|---|---|---|
| `account_deletion_audit.test.sql` | falla | 81/81 |
| `reminders_client_request_id.test.sql` | — | 28/28 |
| `npx supabase test db` | — | 619 casos, 13 archivos |
| `account_deletion_concurrency.sh` | falla | 27 comprobaciones |
| `reminders_concurrency.sh` | — | 22 comprobaciones |
| Otras suites de concurrencia (`daily_logs`, `pets`, `pets_delete`, `abuse_limits`, `pet_storage_cleanup`) | — | 21, 17, 20, 9 y 30 comprobaciones |
| `delete-account`, integración con Auth real | 7/9 | 9/9 |
| Edge Functions, unitarias | — | 62/62 |
| `npm run test:integration` | — | 66/66 |
| `npm test`, `tsc`, `expo lint` (frontend sin cambios) | — | 867/867, correctos |
| Borrar una cuenta con 3650 registros (Auth real) | HTTP 504 a los 10 s | HTTP 200 en 418 ms |

`delete-account` con fallos inyectados en cada paso que escribe (fallo, respuesta perdida y muerte de la función, 26 casos, con un arnés fuera del repo):
todos dejan hecho lo anterior y todos convergen al reintentar. Una clave de servicio inválida transfiere y borra antes de fallar: `ROADMAP.md` P1-13.

### Integración de la primera versión (2026-11-03)

| Comando | Resultado |
|---|---|
| `tsc`, `expo lint`, `expo-doctor` | correctos (21/21) |
| `npm test` | 867/867 (2026-11-04) |
| `npm run test:integration` | 66/66 |
| `npx supabase test db` | 510/510 (11 archivos) |
| Concurrencia (5 suites) | correctas |
| Edge Functions, unitarias | 62/62 |
| `delete-account`, integración local | 6/6 |

Manual en emulador Android (build de depuración, inglés, Supabase local): registro con términos, configuración inicial, selector
de fecha, registro del día, avisos, descargar los datos (JSON revisado), eliminar la cuenta de punta a punta e iniciar sesión.
Después: cerrar sesión con todo subido borra la copia local (24 → 0 claves de AsyncStorage en el dispositivo); recuperación de contraseña
con PKCE `s256` (`auth.flow_state`) y sin avisos de WebCrypto; **build de release** (`assembleRelease`, bundle embebido, `targetSdk` 36,
`allowBackup` desactivado, permisos revisados con `aapt`), arranca sin Metro y, sin red, muestra los datos locales con «Sin conexión».
En las builds de depuración, el indicador de la pestaña activa puede verse rectangular; en release sale redondeado.
Web: inicio de sesión. **Sin probar:** móvil físico, iOS, emails reales, fotos con un bucket remoto, IA en el remoto.

### Fallos analizados

- **TEST-01** — el caso 121 comprueba una **precondición** del escenario «cascada desfavorable»: que el
  trigger de FK de `pet_streaks` se dispare antes que el de `daily_logs`. Postgres los ordena por
  nombre (`RI_ConstraintTrigger_a_<oid>`) como texto; en el local actual el OID recreado
  (`…_109945`) ordena **antes** que `…_18339`, así que el escenario no se reproduce (los casos de
  borrado siguientes pasan, pero en orden favorable). Es una fragilidad de la prueba, no de la app.
  Corrección: recrear las dos FK en el orden adecuado dentro de la prueba.
- **TEST-02** — el caso de informe pide un lote de 1 y espera ver los 4 objetos de su mascota; la cola
  local tiene 392 trabajos `pending` vencidos dejados por otras pruebas que borran mascotas, y la
  función toma el más antiguo. La prueba supone una cola vacía. Corrección: aislar la prueba (procesar
  solo su trabajo o vaciar la cola de forma controlada) y que las suites que borran mascotas limpien sus
  trabajos.

## 4. Cobertura y huecos

Cubierto con solidez: motores offline de registros y mascotas, sesión y cierre de sesión, permisos de
`daily_logs`, `pets` y `reminders`, invitación por email, limpieza de Storage, concurrencia.

Pendiente (por prioridad):

1. **IA**: pgTAP de `request_ai_analysis`, `get_ai_analysis_entitlement` (incluido el bypass SEC-01),
   `submit_ai_feedback`; integración de `ai-analysis-process` con `AI_PROVIDER=mock` (autorización,
   reclamo, fallos).
2. **Eliminación de cuenta** (cuando exista): integración completa.
3. **Permisos no probados**: ver la tabla de [`DATABASE.md`](DATABASE.md) §3 (suscripciones, push,
   preferencias, clínicas, informes, catálogos, `transfer_pet_ownership`, buckets distintos de `pet-photos`).
4. **Frontend sin tests**: `auth-redirect.ts`, `auth-errors.ts`, `validation.ts`, `pet-form.ts`,
   `reminder-errors.ts`, capa `api/`, hooks y pantallas.
5. **E2E** de los flujos críticos (Maestro o Detox) en Android e iOS.
6. **Accesibilidad**: lector de pantalla (TalkBack/VoiceOver), tamaño de texto del sistema, contraste.
7. **Rendimiento**: historial con meses de registros, agenda con cientos de recordatorios, arranque en frío.

## 5. Flujos críticos que deben cubrirse antes del lanzamiento

| Flujo | Automatizado hoy | Falta |
|---|---|---|
| Registro → confirmación de email → configuración inicial → primera mascota | parcial (integración de auth) | E2E en dispositivo |
| Registro diario offline → reconexión → sincronización / conflicto | sí | E2E |
| Recordatorio → aviso local a su hora (Android exacto, iOS) | no | prueba en dispositivo |
| Consulta con IA de principio a fin contra `kitom-dev` | no | ejecución real con secreto y veterinario |
| Invitar co-tutor → aceptar → editar con rol | parcial (pgTAP) | E2E |
| Cerrar sesión con pendientes / cambiar de cuenta | sí | E2E |
| Eliminar cuenta | sí (integración local) | móvil físico |
| Comprar, cancelar y restaurar Kitom Premium | parcial (pgTAP, Edge Functions e integración con RevenueCat simulado) | compra real con un tester de licencia |

## 6. Criterios mínimos de aceptación (por cambio)

- `tsc`, lint, `npm test` y `test:integration` en verde.
- Cambio de BD: migración nueva + pgTAP del comportamiento + `npx supabase test db` en verde en local.
- Lógica con bloqueos o versiones: caso en `supabase/tests/concurrency/`.
- Flujo visible: validación manual en Android (y en iOS cuando exista build) registrada en `CHANGELOG.md`.
