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
y su corrección. TEST-02 sigue abierto.

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
| Eliminar cuenta | no existe | todo |

## 6. Criterios mínimos de aceptación (por cambio)

- `tsc`, lint, `npm test` y `test:integration` en verde.
- Cambio de BD: migración nueva + pgTAP del comportamiento + `npx supabase test db` en verde en local.
- Lógica con bloqueos o versiones: caso en `supabase/tests/concurrency/`.
- Flujo visible: validación manual en Android (y en iOS cuando exista build) registrada en `CHANGELOG.md`.
