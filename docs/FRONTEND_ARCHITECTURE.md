# Kitom — Frontend Architecture (v2.2.1)

Documento de referencia para empezar el frontend sin tener que releer el SQL. Stack: React Native + Expo + TypeScript + Supabase.

---

## 1. Navegación

```
AUTH (stack, sin sesión)
├── Welcome
├── Login
├── Register
└── ForgotPassword

ONBOARDING (stack, sesión activa, onboarding_completed_at = null)
├── ProfileSetup
├── Disclaimer            (acepta -> profiles.disclaimer_accepted_at + disclaimer_version)
├── CreatePet
├── PetBasics              (especie, nombre, foto)
└── PetHealthInfo          (raza, nacimiento, peso... perfilado progresivo, no bloqueante)

APP (tabs, sesión activa, onboarding completo)
├── Home                   (selector de mascota activa + resumen)
├── PetOverview
│   ├── DailyLog
│   ├── History
│   ├── Reminders
│   ├── AIAnalysis
│   ├── Achievements
│   └── CoOwners
├── Profile
│   └── Settings
└── Paywall                (modal, no tab — se abre desde cualquier punto bloqueado)
```

## 2. Estados de Auth

```
loading                 -> splash, comprobando sesión
unauthenticated          -> stack AUTH
authenticated_onboarding -> stack ONBOARDING (profiles.onboarding_completed_at IS NULL)
ready                     -> stack APP
```

Derivar así (no guardar como estado aparte, calcularlo de lo que ya viene de Supabase):

```ts
type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'onboarding'; profile: Profile }
  | { status: 'ready'; profile: Profile; subscription: Subscription };
```

`activePet` y `permissions` (rol sobre la mascota activa: `owner` derivado de `pets.owner_id === session.user.id`, o `co_owner.role`) viven en el store de la app, no en el de auth — dependen de qué mascota está seleccionada, que puede cambiar sin recargar sesión.

## 3. Server state vs local state

| Tipo | Ejemplos | Dónde vive |
|---|---|---|
| Server state | `pets`, `daily_logs`, `reminders`, `subscriptions`... | React Query / TanStack Query (o SWR), nunca en un store global manual |
| Local UI state | tab activo, formulario abierto, texto en curso | `useState` local al componente |
| Offline persistence | `daily_logs` creados sin conexión | ver sección 6 |
| Derived state | "¿tengo acceso de edición a esta mascota?", "¿me queda cupo de IA?" | calculado a partir de server state, nunca duplicado a mano |

No se introduce Redux ni una capa de estado global adicional — con React Query + Context para sesión/mascota activa es suficiente para el alcance actual.

## 4. Contrato de datos por pantalla

### AuthScreens (Login/Register/ForgotPassword)
- **READ:** —
- **WRITE:** `supabase.auth.signIn/signUp/resetPasswordForEmail`
- **RPC / Edge Function / Storage:** ninguno

### ProfileSetup / Disclaimer (onboarding)
- **READ:** `profiles` (propia)
- **WRITE:** `profiles` (`full_name`, `locale`, `timezone`, `disclaimer_accepted_at`, `disclaimer_version`, `onboarding_completed_at` al terminar)
- **RPC:** ninguno
- **Storage:** ninguno todavía (el avatar se sube más adelante, no bloqueante)

### CreatePet / PetBasics / PetHealthInfo
- **READ:** `species` (`is_active = true`) + `catalog_translations` (`entity_type='species'`) para el selector
- **WRITE:** `pets` (insert; columnas físicas se pueden completar después, perfilado progresivo)
- **RPC:** ninguno
- **Storage:** `pet-photos` (insert, path `{pet_id}/{uuid}`)

### Home / PetOverview
- **READ:** `pets` (mascotas del usuario), `pet_streaks`, `daily_logs` (último registro), `reminders` (próximos)
- **WRITE:** —
- **RPC:** ninguno

### DailyLogScreen
- **READ:** `pets`, `daily_logs` (del día, si existe, para precargar el formulario)
- **WRITE:** `daily_logs` — **upsert** con `onConflict: 'pet_id,log_date'`, nunca insert repetido
- **RPC:** ninguno
- **Storage:** ninguno

### HistoryScreen
- **READ:** `daily_logs` (rango de fechas), `pet_streaks`
- **WRITE:** —
- **RPC:** ninguno

### RemindersScreen
- **READ:** `reminders`
- **WRITE:** `reminders` (insert/update sobre columnas permitidas — nunca `pet_id`/`created_by`/`created_at`)
- **RPC:** ninguno
- **Storage:** `reminder-attachments` (insert/delete)

### AIAnalysisScreen
- **READ:** `pets`, `ai_analysis_requests` (columnas públicas solamente — `select('*')` fallará a propósito), `symptoms_catalog` + `symptom_species` (filtrado por especie), `ai_analysis_symptoms`
- **WRITE:** ninguna escritura directa sobre campos internos de IA
- **RPC:** `get_ai_analysis_entitlement()` (antes de mostrar el botón), `request_ai_analysis(pet_id, photo_path, symptom_ids)`, `submit_ai_feedback(analysis_id, feedback, comment)` — **solo puede modificar el feedback de sus propias solicitudes** (`requested_by = auth.uid()`); un co-tutor puede ver el análisis de otro pero no valorarlo por él
- **Edge Function:** `ai-analysis-process(analysis_id)`, invocada justo después de que el RPC devuelva el `analysis_id`. **Importante para frontend:** esta llamada NO es un mero "disparo y olvido" confiando en que `request_ai_analysis()` ya autorizó todo — la Edge Function vuelve a validar el JWT y `requested_by` por su cuenta en cada invocación; si el frontend la reintenta o la llama para un `analysis_id` ajeno, recibirá `403 not_authorized`
- **Storage:** `pet-photos` (insert, antes de llamar al RPC)

### AchievementsScreen
- **READ:** `pet_achievements`, `achievements_catalog`, `catalog_translations` (`entity_type='achievement'`)
- **WRITE:** ninguna — se otorgan solos en el backend

### CoOwnersScreen
- **READ:** `pet_co_owners`, `pets`
- **WRITE:** ninguna directa
- **RPC:** `invite_pet_member`, `accept_pet_invitation`, `decline_pet_invitation`, `revoke_pet_invitation`, `change_pet_member_role`

### OwnershipTransferScreen
- **READ:** `pets`, `pet_co_owners` (co-tutores aceptados, candidatos a nuevo propietario)
- **WRITE:** **NO** update directo de `pets.owner_id` (Postgres lo rechazaría igualmente)
- **RPC:** `transfer_pet_ownership(pet_id, new_owner_id)`

### ReportsScreen
- **READ:** `pet_shared_reports`
- **WRITE:** ninguna directa
- **RPC:** `request_generate_report(pet_id, start, end)` — validación previa (cuota de fechas, acceso), no crea nada
- **Edge Function:** `generate-pet-report(pet_id, start, end)`, invocada tras el RPC. **Importante para frontend:** vuelve a comprobar el acceso a la mascota por su cuenta (misma regla `can_edit_pet`, no una nueva) — no basta con que `request_generate_report()` haya devuelto éxito antes
- **Storage:** `shared-reports` (solo lectura vía signed URL)

### SettingsScreen
- **READ:** `profiles`, `notification_preferences`, `push_tokens`
- **WRITE:** `profiles` (columnas permitidas), `notification_preferences`, `push_tokens`
- **RPC:** `register_push_token(token, platform, device_id, app_version, os_version)` — llamar en login, en app launch y en cada refresh de token (ver sección 10)
- **Storage:** `avatars` (insert/delete, path `{user_id}/{uuid}`)

### PaywallScreen
- **READ:** `subscriptions` (columnas públicas)
- **WRITE:** ninguna — RevenueCat gestiona la compra; `subscriptions` se actualiza vía webhook, nunca desde el cliente
- **RPC:** ninguno directo (RevenueCat SDK gestiona el checkout nativo)

### DeleteAccountScreen
- **READ:** `owner_has_pets()` (para mostrar de antemano si hay que transferir mascotas primero — solo es UX, no la autorización real)
- **WRITE:** ninguna directa
- **Edge Function:** `delete-account` — **es la única vía real de borrado.** Ignora cualquier `user_id` que el cliente pudiera enviar (no hace falta enviarlo: usa el JWT), y vuelve a comprobar `owner_has_pets()` ella misma antes de borrar. Si el usuario tiene mascotas, responde `409 has_pets` y el frontend debe dirigir a `OwnershipTransferScreen` — no intentar el borrado de nuevo hasta que se resuelva

## 5. Offline (daily logs)

```
Usuario completa el formulario
  ↓
Persistencia local inmediata (SQLite/MMKV/AsyncStorage — cualquiera vale,
no hace falta una solución compleja) con un id local temporal
  ↓
Si hay red: intenta upsert directo a Supabase
Si no hay red: se queda en cola de sincronización
  ↓
Al recuperar conexión: procesa la cola en orden
  ↓
success  -> marca como sincronizado, sustituye el id local por el real
conflict -> el UNIQUE(pet_id, log_date) puede rechazar si ya existe un
            registro de ese día hecho desde otro dispositivo mientras
            este estaba offline: en ese caso, hacer upsert (no insert)
            para que gane el último guardado, o mostrar un diff simple
            si se quiere ser más cuidadoso — no es necesario para el MVP
retry    -> reintento con backoff simple; no bloquea la cola completa
            si un solo item falla
```

Casos a manejar explícitamente en la UI:
- **Fecha inválida / futura:** `validate_daily_log_date` la rechazará; mostrar el error tal cual lo da la excepción, no reintentar automáticamente.
- **Permisos perdidos mientras estaba offline** (p. ej. el owner revocó el acceso del co-tutor): el upsert fallará por RLS al reconectar; mostrar "ya no tienes acceso a esta mascota", no reintentar indefinidamente.
- **Timezone:** el `log_date` se calcula en el momento de crear el registro (sección 14 del README), no al sincronizar — así un registro offline no cambia de día solo por tardar en subir.

## 6. Errores — comportamiento esperado

| Código/situación | Comportamiento en UI |
|---|---|
| `not_authenticated` | redirigir a Login, limpiar sesión local |
| `not_pet_member` | "no tienes acceso a esta mascota", volver a Home |
| `not_pet_editor` | ocultar/deshabilitar la acción de escritura, no solo mostrar error al fallar |
| `permission_denied` (genérico de Postgres) | mensaje genérico + botón de reportar, no debería ocurrir si la UI ya oculta lo que no se puede hacer |
| `not_authorized` (Edge Function reautorizándose, ver sección 4) | tratar igual que `permission_denied` — indica que se intentó una acción sobre un recurso ajeno |
| `subscription_limit_reached` | abrir `Paywall` con el mensaje de `get_ai_analysis_entitlement()` |
| `ai_unavailable` (Edge Function caída/timeout) | mostrar estado `failed`, permitir reintentar (no consume cupo) |
| `already_processing_or_done` (respuesta de `ai-analysis-process`) | no es un error: tratar como éxito silencioso, seguir el poll/Realtime normal sobre la fila |
| `network_offline` | banner persistente, cola de sincronización visible |
| `storage_upload_failed` | reintentar la subida antes de llamar al RPC que depende de ese path |
| `invitation_expired` (estado ya no es `pending`) | refrescar la lista de invitaciones, mensaje claro |
| `ownership_transfer_failed` | mostrar el motivo exacto que da la excepción de `transfer_pet_ownership` (usuario no es co-tutor aceptado, etc.) |
| `invalid_log_date` | mismo tratamiento que "fecha inválida / futura" arriba |
| `has_pets` (respuesta 409 de `delete-account`) | dirigir a `OwnershipTransferScreen`, mensaje "transfiere tus mascotas antes de eliminar la cuenta" |
| `invalid_timezone` | si ocurre, es un bug del cliente: revisar que se está enviando un nombre IANA (ver sección 9), nunca una abreviatura |

## 7. Push tokens — ciclo de vida (nuevo en v2.2.1)

`push_tokens.token` es único a nivel global (es un identificador del dispositivo/instalación emitido por el sistema operativo, no algo exclusivo de una cuenta). El mismo teléfono puede tener sesiones de distintos usuarios a lo largo del tiempo, así que el frontend debe seguir esta disciplina exacta:

| Momento | Acción |
|---|---|
| **Login** | `rpc('register_push_token', { token, platform, device_id, app_version, os_version })` |
| **App launch** (con sesión ya activa) | repetir `register_push_token` — barato, idempotente, corrige `last_seen_at` |
| **Token refresh** (el SO rota el token) | repetir `register_push_token` con el nuevo `token` |
| **Logout** | recomendado (no obligatorio): `supabase.from('push_tokens').delete().eq('token', currentToken)` antes de cerrar sesión |
| **Cambio de usuario en el mismo dispositivo** | no hace falta lógica especial: el siguiente login vuelve a llamar `register_push_token`, que reasigna el token al nuevo `auth.uid()` automáticamente |

No intentar hacer `insert`/`update` directo sobre `push_tokens` para este caso — si el token ya pertenece a otro usuario, la policy `manage own` lo bloqueará (correctamente). `register_push_token` es la única vía pensada para el traspaso.

## 8. Seguridad en el cliente

- **La `service_role` key NUNCA va en la app** — solo `anon` key + JWT de sesión.
- El cliente **nunca** confía en valores que él mismo generó o recibió para decidir lógica de negocio: `user_id`, `owner_id`, plan de suscripción, entitlement de IA, coste/modelo/proveedor/estado/resultado de IA, `used_full_history`. Todo eso se re-lee siempre desde Supabase (RLS/RPC son la autoridad), nunca se calcula ni se confía en el lado del cliente aunque "ya se sepa" por una pantalla anterior.
- **Ninguna llamada a una RPC de validación (`request_ai_analysis`, `request_generate_report`, o consultar `owner_has_pets`) sustituye la autorización real de la Edge Function que viene después.** El frontend debe estar preparado para que `ai-analysis-process`, `generate-pet-report` o `delete-account` devuelvan `403`/`409` aunque el paso anterior haya ido bien — no es un bug, es el contrato de seguridad: cada Edge Function se autoriza a sí misma de forma independiente (ver sección 4, `AIAnalysisScreen`/`ReportsScreen`/`DeleteAccountScreen`).
- Cualquier UI que oculte una acción por permisos (botones deshabilitados, pantallas no accesibles) es solo UX — la protección real está en la base de datos, así que un fallo de UI nunca es un fallo de seguridad.

## 9. Timezone — formato exacto que espera el backend

`profiles.timezone` se valida contra `pg_timezone_names` en el servidor (ver README, sección 14). El frontend debe enviar siempre un **nombre IANA completo**:

- ✅ `Europe/Madrid`, `America/New_York`, `Asia/Tokyo`, `UTC`
- ❌ `CET`, `PST`, `GMT+1` — abreviaturas/offsets ambiguos, la validación los rechaza

En React Native/Expo, obtener el nombre IANA del dispositivo con `Intl.DateTimeFormat().resolvedOptions().timeZone` (ya devuelve el formato correcto nativamente) — no construirlo a mano a partir del offset UTC del dispositivo.

## 10. TypeScript

Generar tipos directamente desde el esquema, no mantenerlos a mano:

```bash
supabase gen types typescript --project-id <project-id> --schema public > src/types/database.types.ts
```

Repetir cada vez que cambie el esquema. Los tipos de los parámetros/retorno de las funciones RPC (`request_ai_analysis`, `transfer_pet_ownership`, `register_push_token`...) también se generan ahí — usarlos directamente en las llamadas `supabase.rpc(...)` en vez de redefinir interfaces manuales que puedan desincronizarse.

## 11. Orden de construcción del frontend

| Fase | Contenido |
|---|---|
| 1 | Auth + Profile |
| 2 | Onboarding + Create Pet |
| 3 | Home + Pet Dashboard |
| 4 | Daily Logs + Offline |
| 5 | Reminders |
| 6 | AI |
| 7 | Co-owners |
| 8 | Achievements + Streaks |
| 9 | Subscription / Paywall |
| 10 | Reports / Sharing |

Cada fase debe dejar la app usable de principio a fin con lo construido hasta ese punto (no bloques a medio terminar) antes de pasar a la siguiente.
