# Kitom — Datos personales y privacidad (inventario técnico)

Revisión 2026-10-29. **No es la política de privacidad** ni asesoramiento legal: es el inventario de lo
que la app trata realmente, según el código, para que la asesoría legal redacte la política y para
rellenar las declaraciones de las tiendas. Requisitos de producto: PRD §9 y §13. Hallazgos
relacionados: SEC-02, SEC-03, SEC-08 en [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md).

## 1. Datos tratados

| Categoría | Datos | Dónde | Origen | Finalidad |
|---|---|---|---|---|
| Cuenta | email, contraseña (hash en Supabase Auth), identidad de Google si se usa | Supabase Auth | usuario / Google | acceso |
| Perfil | nombre, avatar externo de Google (`external_avatar_url`, copiado al registrarse), zona horaria, idioma (`locale`, no se escribe aún), tema (solo en el dispositivo), aceptación del aviso veterinario (fecha y versión), `marketing_opt_in` (desactivado por defecto) | `profiles` | usuario | funcionamiento, cumplimiento |
| Mascota | nombre, especie, raza, fecha de nacimiento, sexo, peso, esterilización, condiciones conocidas, alergias, notas de temperamento, foto | `pets`, Storage `pet-photos` | usuario | funcionamiento |
| Registro diario | ánimo, energía, apetito, actividad, sueño, vocalización, interacción social, conducta inusual (y su nota), etiquetas, notas libres, autor y último editor | `daily_logs` | usuario y co-tutores | seguimiento |
| Agenda | tipo, título, descripción (puede incluir medicación), fechas, repetición, estado | `reminders` | usuario | recordatorios y avisos locales |
| Consultas con IA | foto, síntomas, contexto de la mascota y de los últimos registros, resultado, valoración, coste estimado | `ai_analysis_requests`, `ai_analysis_symptoms`, `pet-photos` | usuario + proveedor de IA | orientación (no diagnóstico) |
| Co-tutores | email del invitado (no se guarda; se busca su cuenta), relación y rol | `pet_co_owners` | dueño | compartir la mascota |
| Plan | plan y estado (siempre `free` hoy) | `subscriptions` | servidor | cupo de IA |
| Técnicos | tokens de sesión (SecureStore), copia local de mascotas, registros y catálogo (AsyncStorage, **sin cifrar**), avisos programados | dispositivo | app | modo offline |
| Sin uso todavía | teléfono, avatar, tokens push, eventos de analítica, referidos de clínicas, informes compartidos | tablas existentes sin cliente | — | — |

Datos de terceros: las fotos pueden incluir personas (la app pide repetirlas si sale alguien).

## 2. Encargados y transferencias

| Proveedor | Qué recibe | Notas |
|---|---|---|
| Supabase | todo lo anterior (base de datos, Auth, Storage, Edge Functions) | región de `kitom-dev` no verificada; producción: elegir región UE |
| Google (Gemini, AI Studio) | foto, síntomas, datos de la mascota y notas recientes del registro (sin nombres) | **en el plan gratuito, Google puede usar el contenido para mejorar sus productos** (`DECISIONS.md`): no apto para usuarios reales sin plan de pago o aviso explícito |
| OpenAI (alternativo, desactivado por defecto) | lo mismo que Gemini | solo si `AI_PROVIDER=openai` |
| Google (OAuth) | inicio de sesión con Google | si el usuario lo elige |
| Expo / EAS | ninguno en runtime hoy (no se usan push remotas ni EAS Update) | revisar si se adopta EAS Update o push |

## 3. Retención

| Dato | Hoy | Necesario |
|---|---|---|
| Cuenta y todo lo asociado | indefinida; **sin eliminación** | eliminación desde la app (P0-02) |
| Mascota borrada | filas borradas en cascada; fotos encoladas para limpieza, **limpieza sin desplegar** | desplegar limpieza (P1-04) |
| Fotos de consultas | indefinida | definir plazo |
| `reminder-attachments`, `shared-reports`, `avatars` | sin uso; sin limpieza | definir antes de usarlos |
| Copia local en el dispositivo | persiste tras cerrar sesión | purga (P1-09) |
| Respuestas crudas del proveedor (`response_raw`) | indefinida, no visibles para el cliente | definir plazo |

## 4. Derechos del usuario (RGPD)

| Derecho | Estado |
|---|---|
| Acceso / portabilidad | **no implementado**; la pantalla de privacidad dice que se puede pedir, pero sin canal |
| Rectificación | sí, desde la app (perfil, mascotas, registros) |
| Supresión | **no implementado** (SEC-02) |
| Oposición a marketing | `marketing_opt_in` revocable en ajustes |
| Información (art. 13) | **sin política de privacidad** (SEC-03) |

## 5. Borrador para las declaraciones de tienda (a validar por legal)

- Datos recogidos: email, nombre, fotos, información de salud **de la mascota** (no del usuario),
  contenido generado por el usuario (notas), identificadores de la cuenta.
- Compartidos con terceros: fotos y datos de la mascota con el proveedor de IA para prestar el servicio.
- Cifrado en tránsito: sí (HTTPS). Eliminación a petición: **no hasta P0-02**.
- Sin publicidad ni seguimiento entre apps; sin analítica hoy.
