# Kitom — Auditoría de seguridad

Revisión: **2026-10-29** sobre `main` @ `41d0a07` (13 migraciones). Documento vivo: cada hallazgo
lleva su estado de corrección; al corregir uno, actualizar la fila y la sección «Estado».
Contexto general y resto de la auditoría: [`PROJECT_STATUS.md`](PROJECT_STATUS.md). Plan de
corrección: [`ROADMAP.md`](ROADMAP.md).

## 1. Alcance y método

| Superficie | Cómo se revisó | Resultado |
|---|---|---|
| Migraciones (`supabase/migrations/`), RLS, grants, funciones, triggers, Storage | lectura completa del SQL | revisado |
| `kitom-dev` (remoto) | **solo lectura** con el MCP de Supabase, con aprobación del usuario: advisors de seguridad y rendimiento, lista de migraciones y de Edge Functions, `storage.buckets`, extensiones, recuentos agregados (sin datos personales) | revisado |
| Edge Functions `ai-analysis-process` y `pet-storage-cleanup` | lectura del código + tests unitarios e integración local | revisado |
| Frontend (`frontend/src`): sesión, almacenamiento, deep links, llamadas a datos, logs | lectura del código + `npm test` + `test:integration` | revisado |
| Secretos en el repositorio y en todo el historial de git | búsqueda de patrones (JWT, `sk-`, `AIza`, `sb_secret_`, claves privadas, `.env`) | revisado: **ninguno** |
| Dependencias | `npm audit --omit=dev` | revisado |
| Configuración de Auth del remoto (confirmación de email, longitud de contraseña, URLs de redirección, SMTP, Google) | no accesible por SQL ni MCP | **no verificado** (solo `config.toml`, que es local) |
| Secretos de Edge Functions en el remoto | deliberadamente no consultados | **no verificado** |
| Builds nativas (binario Android/iOS), ofuscación, almacenamiento real en dispositivo | sin dispositivo ni build en esta auditoría | **no verificado** |
| Pruebas dinámicas contra el remoto (ataques reales) | no realizadas (prohibido sin autorización) | **no realizado** |

No se ha hecho ninguna escritura ni operación destructiva contra `kitom-dev`. Que no aparezcan más
hallazgos no significa que no existan: las superficies «no verificado» siguen abiertas.

### Controles que sí funcionan (verificados)

- RLS activa en las 23 tablas de `public` y en `private.pet_storage_cleanup_jobs` (sin políticas, a propósito).
- Todas las funciones `SECURITY DEFINER` fijan `search_path`; `EXECUTE` revocado a `PUBLIC`/`anon` en todas.
  Las 19 que puede ejecutar `authenticated` comprueban `auth.uid()` y la pertenencia a la mascota.
- Columnas inmutables protegidas por grants de columna (`pets.owner_id`, `pets.id`, `daily_logs.log_date`…).
- El cliente no puede escribir `ai_analysis_requests`, `subscriptions`, `pet_achievements` ni `pet_streaks`:
  estado de IA, plan y logros los decide el servidor (regla de `CLAUDE.md` cumplida).
- `ai-analysis-process`: valida el JWT, toma el usuario del JWT, valida `analysis_id`, reautoriza
  (`requested_by`) y solo entonces usa `service_role`; reclamo atómico; el proveedor `mock` se niega fuera de local.
- `pet-storage-cleanup`: secreto propio comparado en tiempo constante, modo informe por defecto, bucket fijo.
- Sesión en el móvil en SecureStore (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`); ninguna petición de datos
  sale sin token de usuario (`user-token-fetch`, probado); `console.*` solo bajo `__DEV__`.
- Sin secretos en el repo ni en el historial; `.env` y claves de firma ignorados por git.
- Solo dos `EXPO_PUBLIC_*` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`), ambas públicas por diseño.
- Buckets del remoto: los 4 privados (`avatars`, `pet-photos`, `reminder-attachments`, `shared-reports`).

## 2. Resumen de hallazgos

| Severidad | Nº | IDs |
|---|---|---|
| CRÍTICA | 0 | — |
| ALTA | 3 | SEC-01, SEC-02, SEC-03 |
| MEDIA | 6 | SEC-04 … SEC-09 |
| BAJA | 10 | SEC-10 … SEC-19 |
| INFORMATIVA | 3 | SEC-20 … SEC-22 |

## 3. Hallazgos

Formato: severidad · confianza · componente · evidencia · escenario · impacto · solución · esfuerzo ·
prueba de verificación · estado.

### SEC-01 — La cuota mensual de IA se elude borrando y recreando la mascota
- **ALTA · CONFIRMADO** · `get_ai_analysis_entitlement`, FK `ai_analysis_requests.pet_id`.
- **Evidencia**: la cuota cuenta filas de `ai_analysis_requests` del mes (`20261006175453_remote_schema.sql:706-710`);
  esas filas se borran en cascada con la mascota (`:1582`, `ON DELETE CASCADE`) y el dueño puede borrar sus mascotas (política `pets: delete owner`).
- **Escenario**: usuario free pide 3 análisis, borra la mascota, la vuelve a crear y repite sin límite.
- **Impacto**: coste de proveedor ilimitado por usuario; el plan Premium pierde sentido.
- **Solución**: registro de uso que sobrevive al borrado (tabla privada sin FK a `pets`) del que cuente la cuota.
- **Esfuerzo**: 0,5–1 día (migración + pgTAP). **Prueba**: pgTAP que pide 3, borra la mascota, recrea y espera `can_request = false`.
- **Estado**: corrección en preparación (rama `db/…`, ver `ROADMAP.md` P0-01).

### SEC-02 — Sin eliminación de cuenta ni exportación de datos
- **ALTA · CONFIRMADO** · Edge Function `delete-account` inexistente; UI oculta (`frontend/src/app/(app)/settings/index.tsx:58-62`);
  FK `pets.owner_id … ON DELETE RESTRICT` (`remote_schema.sql:1631`).
- **Escenario**: un usuario pide borrar su cuenta; no hay forma en la app ni por web; desde el Dashboard falla si tiene mascotas.
- **Impacto**: incumple el requisito de Google Play y App Store (eliminación de cuenta desde la app) y el derecho de supresión/portabilidad del RGPD (art. 17 y 20). La pantalla de privacidad dice que se puede pedir una copia o el borrado, pero no da canal.
- **Solución**: `delete-account` (contrato ya en `docs/README.md` §12 y `FRONTEND_ARCHITECTURE.md` «DeleteAccountScreen»), URL web de solicitud de borrado, exportación (JSON) o canal de solicitud documentado.
- **Esfuerzo**: 3–5 días. **Prueba**: integración local: cuenta con mascotas, co-tutorías y fotos → borrar → 0 filas y 0 objetos del usuario; reintento idempotente.
- **Estado**: pendiente (`ROADMAP.md` P0-02).

### SEC-03 — Tratamiento de datos sin base legal documentada y consentimiento de IA inexacto
- **ALTA · CONFIRMADO** · `frontend/src/i18n/locales/es.ts:505`, `docs/DECISIONS.md:234-235`, `settings/legal.tsx`.
- **Evidencia**: el texto de consentimiento dice «Kitom no la usa para nada más», pero la foto, notas y datos de la mascota se envían a Google (Gemini) y, según `DECISIONS.md`, el plan gratuito de Gemini usa el contenido para mejorar sus productos. No hay política de privacidad ni términos («se publicarán antes del lanzamiento»); el consentimiento de la foto es solo una casilla en el cliente.
- **Impacto**: información engañosa al usuario; incumplimiento RGPD (art. 13, encargados del tratamiento) y de las declaraciones de privacidad de las tiendas.
- **Solución**: plan de pago de Gemini (o proveedor sin uso para entrenamiento) antes de usuarios reales; política de privacidad y términos redactados por asesoría legal y enlazados en registro, ajustes y fichas de tienda; texto de consentimiento exacto. Inventario de datos en [`PRIVACY.md`](PRIVACY.md).
- **Esfuerzo**: 1 día técnico + asesoría legal. **Prueba**: revisión legal; enlaces accesibles desde la app sin sesión.
- **Estado**: pendiente (`ROADMAP.md` P0-03).

### SEC-04 — Enumeración de cuentas por email con las invitaciones
- **MEDIA · CONFIRMADO** · `invite_pet_member_by_email` (`20261023082848_pet_invitations_by_email.sql:26-70`).
- **Evidencia**: la respuesta es igual exista o no la cuenta, pero solo si existe se crea la fila en `pet_co_owners`, que el dueño ve después (`get_pet_members` / política SELECT), con `user_id` y nombre. Confirmado por `supabase/tests/database/pet_invitations.test.sql:91-95`. Sin límite de frecuencia.
- **Escenario**: cualquiera crea una mascota de usar y tirar e invita emails para saber cuáles tienen cuenta en Kitom y su nombre.
- **Impacto**: fuga de datos personales (pertenencia a la app + nombre).
- **Solución**: invitaciones pendientes por email en una tabla propia, sin revelar `user_id`/nombre hasta que el invitado acepte; límite diario de invitaciones por usuario.
- **Esfuerzo**: 2–3 días (migración + frontend de co-tutores). **Prueba**: pgTAP: invitar a un email existente y a uno inexistente deja el mismo estado visible para el dueño.
- **Estado**: pendiente (`ROADMAP.md` P1-07).

### SEC-05 — Una invitación puede ir a una cuenta con el email sin confirmar
- **MEDIA · PROBABLE** · mismo RPC (`:57`, busca en `auth.users` por `lower(email)` sin mirar `email_confirmed_at`, baneo ni borrado).
- **Escenario**: si el remoto permite entrar sin confirmar el email (no verificable desde aquí; en local `enable_confirmations = false`), un atacante registra el email de la víctima y recibe las invitaciones dirigidas a ella.
- **Impacto**: acceso a los datos de salud de la mascota de un tercero.
- **Solución**: exigir `email_confirmed_at is not null` y cuenta no baneada/borrada; activar la confirmación de email en el remoto.
- **Esfuerzo**: 1–2 h. **Prueba**: pgTAP con una cuenta sin confirmar → no se crea invitación.
- **Estado**: corrección en preparación (rama `db/…`, `ROADMAP.md` P0-01).

### SEC-06 — Los análisis fallidos no cuentan: abuso de coste del proveedor
- **MEDIA · PROBABLE** · cuota (`status <> 'failed'`), `ai-analysis-process/index.ts`, `guidance.ts`.
- **Escenario**: un usuario provoca salidas inválidas (texto libre que empuja al modelo a usar palabras prohibidas) o bloqueos del proveedor; cada intento cuesta una llamada pagada y no consume cupo.
- **Impacto**: coste sin límite (sin beneficio para el atacante).
- **Solución**: contar los fallos posteriores a llamar al proveedor en un límite diario aparte (decisión de producto: cuántos).
- **Esfuerzo**: 0,5 día tras la decisión. **Prueba**: pgTAP/integración: N fallos con coste → la petición N+1 se rechaza.
- **Estado**: pendiente de decisión (`ROADMAP.md` P1-06).

### SEC-07 — Buckets sin límite de tamaño ni de tipo
- **MEDIA · CONFIRMADO (remoto)** · `storage.buckets` en `kitom-dev`: `file_size_limit` y `allowed_mime_types` nulos en los 4; en local, límite global de 50 MiB (`supabase/config.toml:119`). La configuración de los buckets no está en migraciones.
- **Escenario**: un editor sube archivos grandes o de cualquier tipo a la carpeta de su mascota.
- **Impacto**: coste de almacenamiento, contenido no deseado alojado; la Edge Function de IA descarga antes de rechazar >5 MB.
- **Solución**: `pet-photos` limitado a 5 MB y `image/jpeg` (la app y el CHECK `pets_photo_path_own_pet` solo usan `.jpg`), y límites para los demás cuando tengan uso; versionado en una migración.
- **Esfuerzo**: 1–2 h. **Prueba**: subida de 6 MB o PNG → rechazada; foto real de la app → aceptada.
- **Estado**: corrección en preparación (rama `db/…`, `ROADMAP.md` P0-01).

### SEC-08 — Datos de salud sin cifrar en el dispositivo tras cerrar sesión
- **MEDIA · CONFIRMADO** · `frontend/src/lib/local-store/` (AsyncStorage / `localStorage` en web); `sign-out-flow.ts` («conservar» mantiene los datos a propósito).
- **Escenario**: dispositivo compartido o perdido; en web, cualquier XSS lee la copia local y la sesión (`secure-session-storage.ts:30-40` usa `localStorage`).
- **Impacto**: exposición de registros diarios y fichas de mascotas.
- **Solución**: purgar la copia local al cerrar sesión cuando no quedan pendientes y ofrecer «borrar datos de este dispositivo»; limpieza de cuentas que no vuelven (ya listada como pendiente); valorar cifrado con clave en SecureStore.
- **Esfuerzo**: 1–2 días. **Prueba**: tests del flujo de cierre de sesión + `checkLocalStore` en dispositivo.
- **Estado**: pendiente (`ROADMAP.md` P1-09).

### SEC-09 — Endurecimiento de Auth pendiente
- **MEDIA · CONFIRMADO (parcial)** · advisor remoto: **protección de contraseñas filtradas desactivada**; `config.toml` (local): longitud mínima 6, sin requisitos, `enable_confirmations = false`, `secure_password_change = false`, MFA desactivado, sin captcha. El resto del remoto: **por verificar** en el Dashboard.
- **Impacto**: cuentas con contraseñas débiles o filtradas; registros falsos.
- **Solución**: en el proyecto de producción, mínimo 8 + protección de filtradas + confirmación de email + `secure_password_change` + SMTP propio + captcha si hay abuso; reflejar lo aplicable en `config.toml`.
- **Esfuerzo**: 2–4 h (Dashboard, usuario). **Prueba**: registro con contraseña filtrada → rechazado; login sin confirmar → rechazado.
- **Estado**: pendiente (`ROADMAP.md` P0-04).

### SEC-10 — El aviso veterinario solo se exige en el cliente
- **BAJA · CONFIRMADO** · `request_ai_analysis` no comprueba `profiles.disclaimer_accepted_at`, que además el cliente puede escribir.
- **Impacto**: cumplimiento (el PRD exige aceptarlo antes de usar la IA); un cliente modificado lo salta.
- **Solución**: comprobarlo en `request_ai_analysis`. **Esfuerzo**: 1 h. **Prueba**: pgTAP sin aviso → error.
- **Estado**: corrección en preparación (rama `db/…`).

### SEC-11 — Privilegios de tabla sobrantes para `anon` y `authenticated`
- **BAJA · CONFIRMADO** · `anon` conserva DML completo y `TRUNCATE` en casi todas las tablas; `authenticated`, `TRUNCATE`/`TRIGGER`/`REFERENCES` (`remote_schema.sql:2267-2807`). RLS bloquea el DML; `TRUNCATE` no pasa por RLS aunque PostgREST no lo expone.
- **Solución**: revocar `TRUNCATE, TRIGGER, REFERENCES` a ambos roles (defensa en profundidad). **Esfuerzo**: 1 h. **Prueba**: pgTAP de privilegios.
- **Estado**: corrección en preparación (rama `db/…`).

### SEC-12 — Avisos del linter de Supabase
- **BAJA · CONFIRMADO (remoto)** · `public.trigger_set_timestamp` sin `search_path` fijo; extensión `pg_trgm` en `public`.
- **Solución**: fijar `search_path` (migración en preparación); mover `pg_trgm` a `extensions` solo con plan (los índices trigram dependen de ella). **Esfuerzo**: 1 h / 0,5 día.
- **Estado**: `search_path` en preparación; `pg_trgm` pendiente (P2).

### SEC-13 — Códigos de referido de clínicas legibles por todos
- **BAJA–MEDIA · CONFIRMADO** · `vet_clinics.referral_code` con SELECT para `authenticated` (`:2803`); `create_clinic_referral` acepta cualquier código.
- **Impacto**: autoatribución a cualquier clínica (relevante si hay pagos por referido). Sin cliente que lo use hoy.
- **Solución**: no exponer `referral_code`; validar el canal. **Estado**: pendiente (P3, antes de activar referidos).

### SEC-14 — Reasignación de tokens push y teléfono como oráculo
- **BAJA · CONFIRMADO** · `register_push_token` hace `ON CONFLICT (token) DO UPDATE SET user_id = auth.uid()`; `profiles.phone` es único, editable y sin verificar.
- **Impacto**: quien conozca el token de otro dispositivo le redirige los avisos; el error de unicidad revela si un teléfono está registrado. Sin cliente que los use hoy.
- **Solución**: solo reasignar si `device_id` coincide; teléfono solo tras OTP. **Estado**: pendiente (antes de activar push/teléfono).

### SEC-15 — Un co-tutor editor puede borrar cualquier objeto de la carpeta de la mascota
- **BAJA–MEDIA · CONFIRMADO** · políticas de `pet-photos` (DELETE para editores, sin dueño del objeto).
- **Impacto**: un co-tutor puede borrar la foto de perfil o fotos de consultas de otros. **Solución**: DELETE solo del `owner` del objeto o del dueño de la mascota. **Estado**: pendiente (P2).

### SEC-16 — `ai-analysis-process`: escrituras de estado sin condición
- **BAJA · PROBABLE** · `index.ts:81-83` (`markFailed`) y `:261-279` no filtran por `status = 'processing'`; la caducidad usa `created_at` y no el momento del reclamo (`:220`).
- **Impacto**: con dos ejecuciones solapadas, un `completed` puede pasar a `failed` (y dejar de contar cupo).
- **Solución**: `update … where status = 'processing'` y caducidad desde el reclamo. **Estado**: pendiente (P1-05).

### SEC-17 — Contraseña: cambio sin reautenticación y recuperación no persistida
- **BAJA · CONFIRMADO** · `settings/password.tsx` llama a `updateUser` sin pedir la contraseña actual; `isRecoveringPassword` solo vive en memoria (`auth-context.tsx:107`): si la app se cierra durante la recuperación, al volver se entra con la sesión de recuperación sin fijar contraseña.
- **Solución**: `secure_password_change` / reautenticación (nonce) y persistir el estado de recuperación. **Estado**: pendiente (P1-10).

### SEC-18 — Campos de texto sin longitud máxima en la base
- **BAJA · PROBABLE** · p. ej. `pets.name`, `temperament_notes`, `profiles.full_name`, `submit_ai_feedback.feedback_comment`, `analytics_events.properties` (los de `daily_logs` sí están limitados).
- **Impacto**: abuso de almacenamiento; textos enormes que llegan al prompt (recortados en la Edge Function). **Solución**: CHECKs de longitud. **Estado**: pendiente (P2).

### SEC-19 — Objetos huérfanos y retención sin definir en Storage
- **BAJA · CONFIRMADO** · la app sube la foto de la consulta antes de `request_ai_analysis` (`use-ai-analysis.ts`); si la RPC falla, el objeto queda y cada reintento sube otra copia. `reminder-attachments`, `shared-reports` y `avatars` no tienen limpieza; la de `pet-photos` está sin desplegar.
- **Solución**: borrar la foto si la RPC falla y reutilizarla al reintentar (frontend); retención por bucket (`PRIVACY.md`). **Estado**: corrección en preparación (rama `fix/…`) para la parte de cliente.

### SEC-20 — Vulnerabilidades en dependencias (tooling)
- **INFORMATIVA · CONFIRMADO** · `npm audit --omit=dev`: 15 (4 altas, 6 moderadas, 5 bajas), todas transitivas de herramientas de Expo (`@expo/cli`, `node-forge`, `zod`, `xcode`, `uuid`…). La corrección automática propone bajar a Expo 51 (no aplicar). No se ha confirmado que alguna llegue al runtime de la app.
- **Solución**: actualizar los parches del SDK 57 (`npx expo install --check`, `expo-doctor` señala 5) y revisar de nuevo. **Estado**: pendiente (P2).

### SEC-21 — Sin límites de frecuencia propios
- **INFORMATIVA** · Solo los de Auth y la cuota mensual de IA; ningún límite por minuto en RPC ni en `ai-analysis-process`; CORS `*` (aceptable: exige JWT).
- **Solución**: límite por usuario en `request_ai_analysis` (p. ej. 1/min) y en invitaciones. **Estado**: pendiente (P1/P2).

### SEC-22 — Rutas de desarrollo y restos de plantilla
- **INFORMATIVA** · `dev-components` va en el bundle (protegida con `__DEV__`, la exportación web estática genera su HTML); `frontend/LICENSE` es la MIT de la plantilla de Expo («650 Industries») en un proyecto privado.
- **Solución**: excluir la ruta de builds de producción; decidir la licencia. **Estado**: pendiente (P2).

## 4. Pruebas de seguridad pendientes

- pgTAP: RLS/privilegios de `ai_analysis_requests`, `ai_analysis_symptoms`, `push_tokens`, `notification_preferences`,
  `subscriptions`, `subscription_events`, `vet_clinics`, `clinic_referrals`, `pet_shared_reports`, `analytics_events`;
  RPC `request_ai_analysis`, `get_ai_analysis_entitlement`, `submit_ai_feedback`, `transfer_pet_ownership`,
  `change_pet_member_role`, `revoke_pet_invitation`, `register_push_token`, `create_clinic_referral`;
  políticas de Storage de `avatars`, `reminder-attachments`, `shared-reports`.
- Integración de `ai-analysis-process` (autorización, reclamo, fallos) con el proveedor `mock` en local.
- Revisión de la configuración de Auth del proyecto de producción (Dashboard).
- Prueba en dispositivo: SecureStore, copia local tras cerrar sesión, permisos.

## 5. Estado de las correcciones

| ID | Estado |
|---|---|
| SEC-01, SEC-05, SEC-07, SEC-10, SEC-11, SEC-12 (`search_path`) | en preparación — rama `db/…` (solo local; `db push` lo ejecuta el usuario) |
| SEC-19 (cliente) | en preparación — rama `fix/…` |
| Resto | pendiente — ver `ROADMAP.md` |
