# Changelog

Cambios relevantes del proyecto, en orden cronológico inverso. El detalle de cada contrato o
decisión permanece en su documento de referencia.

## 2026-10-16

- Diseño de la app v2 en `docs/design/` (solo diseño, sin código): inventario de 90 pantallas y
  estados (`PANTALLAS.md`), plan de implementación por fases (`PLAN_DESARROLLO.md`), guía de marca,
  tokens (`tokens/`, con `chartActivity` y `chartSleep` nuevos), reglas de componentes, fuentes del
  prototipo navegable (`prototipo/`) y sus generadores (`fuente/`). Logos e iconos de app en
  `frontend/assets/brand/` (aún sin enlazar en `app.json`). Decisión de navegación en `DECISIONS.md`.

## 2026-10-13

- Daily Logs offline, fase 1 (infraestructura, sin conectar a las pantallas): `LocalStore` sobre
  AsyncStorage con claves por usuario y registro (`frontend/src/lib/local-store/`), modelo local del
  registro diario, clasificación de errores, backoff y fusión a tres bandas
  (`frontend/src/features/daily-logs/offline/`), y señal de conectividad de `expo-network` en
  TanStack Query (`lib/connectivity.ts`, `lib/query-defaults.ts`, `lib/query-client.ts`), y generador
  único de identificadores de operación (`lib/operation-id.ts`, `lib/device-operation-id.ts`).
  Dependencias nuevas: `@react-native-async-storage/async-storage` 2.2.0, `expo-network` ~57.0.2 y
  `expo-crypto` ~57.0.4 (requieren un development build nuevo). Sin cambios de BD, de UX ni del
  guardado actual. Almacenamiento real comprobado en emulador Android y en navegador
  (`local-store-check.ts`); iOS sin probar. Contrato en `FRONTEND_ARCHITECTURE.md` §5; decisión en
  `DECISIONS.md`.
- La migración `20261010160332_daily_logs_concurrency.sql` consta aplicada en `kitom-dev`. Tipos
  regenerados (`save_daily_log` con `p_expected_updated_at?` y `p_expect_absent?`); el archivo se
  normalizó a UTF-8 (la regeneración desde PowerShell lo había dejado en UTF-16).
- `.gitattributes`: los scripts `*.sh` siempre con finales LF (con `core.autocrlf=true` salían con
  CRLF y bash fallaba).

## 2026-10-10

- Backend de registros diarios, fase 0 del modo offline: nueva migración
  `20261010160332_daily_logs_concurrency.sql`. `save_daily_log` acepta las precondiciones opcionales
  `p_expected_updated_at` y `p_expect_absent` y devuelve `P0001` con `hint` `daily_log_conflict` si
  otro guardado se adelantó, en vez de pisarlo. Sustituye la firma de 13 parámetros por una de 15 (sin
  sobrecarga); las llamadas actuales siguen funcionando igual. Sin cambios de tablas, RLS ni grants.
  Validada en local desde `db reset` con 215 pruebas pgTAP y la nueva prueba de sesiones simultáneas
  `supabase/tests/concurrency/daily_logs_concurrency.sh`. Frontend sin cambios de código. Contrato en
  `FRONTEND_ARCHITECTURE.md` §4 «DailyLogScreen»; decisión en `DECISIONS.md`.

## 2026-10-09

- Historial de Daily Logs: lista por mascota (`log_date` descendente, 20 por página con carga
  progresiva) y consulta/edición de registros anteriores con el formulario existente y
  `save_daily_log`, conservando la fecha original. Viewers en solo lectura. Entrada «Ver historial»
  desde la ficha. Sin cambios de BD. Contrato en `FRONTEND_ARCHITECTURE.md` §4 «HistoryScreen»;
  decisión en `DECISIONS.md`.

## 2026-10-08

- Daily Logs frontend, fase 1: registro de **hoy** de una mascota (crear y editar, online) en
  `(app)/pets/[id]/daily-log`, con entrada desde la ficha. Escalas 1–5 sin valor inicial, «Todo como
  siempre», comportamiento inusual, etiquetas cerradas y notas; guardado solo con `save_daily_log`.
  "Hoy" en la zona del perfil → dispositivo → UTC. Nueva feature `frontend/src/features/daily-logs/` y
  `lib/submit-guard.ts`. Sin cambios de BD. Contrato en `FRONTEND_ARCHITECTURE.md` §4
  «DailyLogScreen»; decisión en `DECISIONS.md`.
- Corrección (de nuevo): `frontend/src/types/database.types.ts` volvía a estar en UTF-16 tras regenerarlo
  desde PowerShell; vuelve a UTF-8 con el mismo contenido.
- La migración `20261008155257_profile_timezone.sql` consta aplicada en `kitom-dev`.

- Zona horaria del perfil: `profiles.timezone` admite `NULL` (= sin configurar) y la app la inicializa
  con la del dispositivo sin sobrescribir nunca un valor existente. Nueva migración
  `20261008155257_profile_timezone.sql` (validada en local; **pendiente de aplicar en `kitom-dev`**) y
  nueva feature `frontend/src/features/profile/`. Primeros tests unitarios del frontend (`npm test`,
  runner de Node sin dependencias). Contrato en `FRONTEND_ARCHITECTURE.md` §9; decisión en `DECISIONS.md`.
- Corrección: `frontend/src/types/database.types.ts` se había guardado en UTF-16 (ESLint fallaba con
  "File appears to be binary"); vuelve a UTF-8 con el mismo contenido.
- La migración `20261008150202_daily_logs_fixes.sql` consta aplicada en `kitom-dev`.

- Backend de registros diarios: nueva migración `20261008150202_daily_logs_fixes.sql`. Corrige dos
  bugs del diseño original: ninguna escritura en `daily_logs` funcionaba (`recompute_pet_streak`) y
  borrar una mascota con 2+ registros fallaba (FK de `pet_streaks`). Añade la RPC `save_daily_log`, la
  ventana de creación de 7 días, `log_date` inmutable, los CHECK de tags, notas y registro vacío, y
  endurece los grants. Validada en local desde `db reset` con 134 pruebas pgTAP
  (`supabase/tests/database/daily_logs.test.sql`); **pendiente de aplicar en `kitom-dev`**. Frontend
  pendiente. Contrato en `FRONTEND_ARCHITECTURE.md` §4 «DailyLogScreen»; decisión en `DECISIONS.md`.
- Documentación: las migraciones `20261007172110` y `20261007182429` constan aplicadas en `kitom-dev`.

## 2026-10-07

- Fotos de mascota: añadir desde galería o cámara, previsualizar, cambiar y eliminar desde la ficha,
  en el bucket privado `pet-photos` con URLs firmadas. Nuevas dependencias `expo-image-picker` y
  `expo-image-manipulator` (requieren nuevo development build). Nueva migración
  `20261007182429_grant_safe_pet_id_from_path.sql` (sin ella Storage rechaza todas las operaciones);
  **pendiente de aplicar en `kitom-dev`**. Contrato en `FRONTEND_ARCHITECTURE.md` §4 «Pets: fotos»;
  decisión en `DECISIONS.md`.
- Corrección: crear una mascota fallaba con `42501` (RLS) por el `RETURNING` del insert. Nueva
  migración `20261007172110_pets_select_policy_owner.sql`; pendiente de aplicar en `kitom-dev`.
- Pets usa el catálogo de razas: selección de estado (con raza / mestizo / desconocida), buscador por
  especie con alias y opción de raza no catalogada; la raza es opcional y puede quedar sin contestar.
  Tipos regenerados desde `kitom-dev`, mensajes de error de raza propios e idioma `en` añadido al
  i18n (activo sigue siendo `es`). Contrato en `FRONTEND_ARCHITECTURE.md` §4 «Pets».
- Nueva migración de razas (`breeds`, `breed_status`, `pets.breed_id`/`breed_status`, FK compuesta
  especie↔raza) y seed `supabase/seeds/breeds.sql` con 198 razas (155 de perro, 43 de gato) en es/en.
  Validados en local; pendientes de aplicar en `kitom-dev`. Decisión en `DECISIONS.md`, catálogo en
  `SEED.md`.
- Nuevo seed de datos de referencia `supabase/seed.sql` (especies, síntomas, compatibilidad
  síntoma–especie, logros y traducciones es/en), idempotente y aditivo. Validado en local; pendiente
  de ejecutar en `kitom-dev`. Detalle en `SEED.md`.
- Primera funcionalidad de producto: gestión de mascotas (lista, alta, detalle, edición y borrado)
  sobre el esquema existente, con acceso decidido por RLS y preparada para mascotas compartidas.
  Contrato en `FRONTEND_ARCHITECTURE.md` §4 «Pets»; decisión en `DECISIONS.md`.
- Nuevo `docs/DECISIONS.md` para registrar decisiones técnicas.
- Se estableció el mantenimiento proactivo de la estructura y documentación del repositorio como
  parte de cada tarea, con registro de cambios relevantes e instrucciones específicas por área.
