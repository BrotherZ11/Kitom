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
