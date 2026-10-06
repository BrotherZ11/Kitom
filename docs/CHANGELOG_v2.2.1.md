# CHANGELOG — Kitom SQL v2.2.1 (FINAL)

Microversión de seguridad/contrato sobre v2.2. No es una nueva iteración de arquitectura: ni una tabla nueva, ni un rediseño, ni funcionalidad de producto añadida. Base: `Kitom_SQL_v2_2`. Sustituye por completo a esa carpeta.

## Security

- **[P0] AI feedback ownership corregido.** `submit_ai_feedback()` comprobaba `is_pet_member(req.pet_id)`, lo que permitía que cualquier co-tutor con acceso a la mascota sobrescribiera el feedback de un análisis pedido por OTRO usuario. Ahora exige `req.requested_by = auth.uid()`. No se creó una tabla `ai_analysis_feedback` nueva ni se admiten varios feedbacks por análisis — se mantiene el modelo actual, solo se corrigió quién puede escribir.
- **[P0] Edge Functions reautorizadas de forma independiente.** `ai-analysis-process` y `generate-pet-report` ya no asumen que la RPC de validación previa (`request_ai_analysis()` / `request_generate_report()`) ya dejó todo autorizado. Cada una valida el JWT, obtiene `auth.uid()` por su cuenta, y vuelve a comprobar la regla de negocio correspondiente (`requested_by = auth.uid()` para IA; `can_edit_pet(pet_id)` para reportes) antes de usar `service_role`. Código de referencia en `edge-functions/`.
- **[P0] Protección de operaciones `service_role`.** Ninguna de las tres Edge Functions nuevas/revisadas (`ai-analysis-process`, `generate-pet-report`, `delete-account`) usa `service_role` como sustituto de autorización — siempre se valida identidad y permiso ANTES de tocar el cliente admin.
- **[P1] `EXECUTE` de mínimo privilegio corregido en 3 funciones.** `is_pet_member()`, `can_edit_pet()` e `is_org_member()` solo revocaban `EXECUTE` de `anon`, no de `public`. Postgres concede `EXECUTE` a `PUBLIC` automáticamente al crear una función; revocarlo de un rol concreto no anula lo heredado de `PUBLIC`. En la práctica, estas tres funciones seguían siendo ejecutables por `anon` en v2.2 pese a la intención del `REVOKE`. Corregido añadiendo `public` explícitamente en las tres.

## Integrity

- **[P1] Validación de `profiles.timezone`.** Nuevo trigger (`validate_profile_timezone`) que rechaza cualquier valor que no exista en `pg_timezone_names`. No podía ser un `CHECK` — Postgres no permite que un `CHECK` consulte otra tabla/vista, es una restricción real del motor, no una preferencia de estilo. Acepta nombres IANA (`Europe/Madrid`, `America/New_York`...), rechaza abreviaturas. Si llega `NULL`, se sustituye por `'UTC'` en vez de fallar.
- **[P0] Protección de doble procesamiento de IA.** Nueva `claim_ai_analysis_for_processing()`: transición atómica `pending -> processing` mediante `UPDATE ... WHERE status = 'pending'`. Si dos invocaciones de `ai-analysis-process` llegan casi a la vez para el mismo `analysis_id`, como mucho una consigue el cambio de estado. Se añadió `'processing'` a `ai_request_status` (encaja limpiamente: un valor más en un enum existente, sin tocar ninguna relación).

## Backend Contracts

- **`ai-analysis-process`** (`edge-functions/ai-analysis-process/index.ts`): valida JWT → obtiene `auth.uid()` → valida formato de `analysis_id` → busca el análisis con `service_role` → comprueba `requested_by = auth.uid()` → reclama atómicamente (`claim_ai_analysis_for_processing`) → procesa → guarda únicamente campos backend-owned → `completed` o `failed`.
- **`generate-pet-report`** (`edge-functions/generate-pet-report/index.ts`): valida JWT → obtiene `auth.uid()` → valida `pet_id`/fechas → comprueba `can_edit_pet(pet_id)` (con el cliente de usuario, para que `auth.uid()` sea el correcto dentro de la función SQL) → genera el PDF → sube a un bucket fijo (`shared-reports`, nunca desde el cliente) → crea `pet_shared_reports` con `generated_by`/`file_path` siempre derivados en el backend.
- **`delete-account`** (`edge-functions/delete-account/index.ts`, nueva/formalizada): valida JWT → obtiene `auth.uid()` (ignora cualquier `user_id` del body) → comprueba `owner_has_pets()` ella misma → si tiene mascotas, `409 has_pets`; si no, `auth.admin.deleteUser()` con `service_role`.

## Push Tokens

- **[P1] Nueva `register_push_token()`.** Resuelve el caso "usuario A cierra sesión, usuario B inicia sesión en el mismo dispositivo, el token físico ya existe asignado a A". La función (SECURITY DEFINER) reasigna el token al `auth.uid()` que la invoca vía upsert (`ON CONFLICT (token) DO UPDATE ... SET user_id = auth.uid()`). Es seguro porque un push token es un identificador de dispositivo emitido por el SO, no un secreto de otro usuario. No se creó ninguna tabla nueva ni se cambió `UNIQUE(token)`. Documentado el ciclo de vida completo (login, app launch, token refresh, logout, cambio de usuario) en `FRONTEND_ARCHITECTURE.md`.

## i18n

- Sin cambios en esta versión.

## Documentation

- `README.md`: actualizado (no reescrito) — nuevas subsecciones 9.1 (ownership del feedback), 20.1 (push tokens), 20.2 (semántica de Storage paths por bucket); ampliada la sección 8 (Edge Functions) con el contrato de reautorización explícito; ampliada la sección 14 (timezone) con la validación IANA; ampliada la sección 21 (seguridad) con el hallazgo de `EXECUTE`/`PUBLIC`.
- `FRONTEND_ARCHITECTURE.md`: actualizado — contratos de `AIAnalysisScreen`, `ReportsScreen` y `DeleteAccountScreen` con la advertencia explícita de reautorización; nueva sección 7 (ciclo de vida de push tokens); nueva sección 9 (formato IANA de timezone); tabla de errores ampliada (`not_authorized`, `already_processing_or_done`, `has_pets`, `invalid_timezone`).
- Nuevo `CHANGELOG_v2.2.1.md` (este archivo).
- Nuevo `edge-functions/` con las 3 implementaciones de referencia en TypeScript/Deno.
- Nuevo `UPGRADE_from_v2.2.sql`: script de migración incremental para quien ya haya desplegado v2.2 con datos reales, separado de los 29 archivos de instalación limpia (que ya incluyen todos los cambios de v2.2.1 directamente).

## Archivos modificados respecto a v2.2

`01_enum_types.sql` (+ `'processing'`), `05_profiles.sql` (+ validación de timezone), `08_pet_access_control.sql` (fix EXECUTE), `11_ai_analysis_requests.sql` (feedback ownership + claim atómico), `19_push_tokens.sql` (+ `register_push_token`), `27_organizations_prep.sql` (fix EXECUTE), `28_seed_data.sql` (idempotente). Los 22 archivos restantes se re-verificaron sin encontrar más hallazgos y se mantienen idénticos a v2.2.

## Pendientes futuros (documentados, no bloquean frontend)

- Integración real del proveedor de IA (`callAiProvider()` en `ai-analysis-process`) y de la librería de generación de PDF (`generatePdf()` en `generate-pet-report`) — quedan como contratos definidos con la firma de entrada/salida ya fijada, pendientes de la fase de implementación real de Edge Functions.
- Todo lo ya documentado como pendiente en `CHANGELOG_v2.2.md` que no ha sido tocado en esta revisión (avatar entre co-tutores, RRULE completo, `received_at` en `subscription_events`, flujo de producto sobre `organizations`).

## Cierre

Con esta versión, la arquitectura de base de datos de Kitom se considera **cerrada**. Lo que queda a partir de aquí:

- Implementación frontend
- Implementación real de las Edge Functions (los tres archivos de `edge-functions/` son el contrato de seguridad y el esqueleto; falta la integración real del proveedor de IA y del generador de PDF)
- Integración RevenueCat
- Integración IA
- Tests, QA, despliegue

No se ha detectado ningún problema crítico adicional relacionado con los cambios de esta revisión que requiera una v2.3.
