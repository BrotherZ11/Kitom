# Kitom — Datos personales y privacidad (inventario técnico)

Revisión 2026-10-29. **Inventario técnico**, no asesoramiento legal: lo que la app trata realmente,
según el código. Los textos para el usuario son las páginas públicas de [`site/`](../site/README.md)
(política de privacidad, términos y eliminación de la cuenta, en español y en inglés, en vigor desde el
2026-10-30), publicadas en GitHub Pages (base: `LEGAL_SITE_URL` de `frontend/src/lib/legal-links.ts`) y copiadas en la app (`/legal/[doc]`). Si cambia algo
de este inventario, revisar también esas páginas y los textos de la app (`settings.legalScreen`,
`settings.privacyScreen`, `consult.*`). Requisitos de producto: PRD §9 y §13. Hallazgos relacionados:
SEC-02, SEC-03, SEC-08 en [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md).

Responsable: David Zarzavilla Borrego (persona física, España; contacto `SUPPORT_EMAIL`). Marco: RGPD +
LOPDGDD; autoridad de control: AEPD. Edad mínima de la app: 16 años. Revisión legal recomendada antes
del lanzamiento.

## 1. Datos tratados

| Categoría | Datos | Dónde | Origen | Finalidad | Base legal (política) |
|---|---|---|---|---|---|
| Cuenta | email, contraseña (hash en Supabase Auth), identidad de Google si se usa | Supabase Auth | usuario / Google | acceso | contrato |
| Perfil | nombre, avatar externo de Google (`external_avatar_url`, copiado al registrarse), zona horaria, idioma (`locale`, no se escribe aún), tema (solo en el dispositivo), aceptación del aviso veterinario (fecha y versión), `marketing_opt_in` (desactivado por defecto) | `profiles` | usuario | funcionamiento, cumplimiento | contrato; interés legítimo (aviso); consentimiento (`marketing_opt_in`) |
| Mascota | nombre, especie, raza, fecha de nacimiento, sexo, peso, esterilización, condiciones conocidas, alergias, notas de temperamento, foto | `pets`, Storage `pet-photos` | usuario | funcionamiento | contrato |
| Registro diario | ánimo, energía, apetito, actividad, sueño, vocalización, interacción social, conducta inusual (y su nota), etiquetas, notas libres, autor y último editor | `daily_logs` | usuario y co-tutores | seguimiento | contrato |
| Agenda | tipo, título, descripción (puede incluir medicación), fechas, repetición, estado | `reminders` (y copia en el dispositivo) | usuario | recordatorios y avisos locales | contrato |
| Consultas con IA | foto, síntomas, contexto de la mascota y de los últimos registros, resultado, `response_raw`, valoración, coste estimado | `ai_analysis_requests`, `ai_analysis_symptoms`, `pet-photos` | usuario + proveedor de IA | orientación (no diagnóstico) | contrato; casilla de confirmación antes de enviar la foto |
| Uso de la IA | `analysis_id`, `user_id`, fecha, si cuenta (sin contenido) | `private.ai_analysis_usage` | servidor | cupo mensual (sobrevive al borrado de la mascota) | contrato |
| Co-tutores | email del invitado (no se guarda; se busca su cuenta), relación y rol | `pet_co_owners` | dueño | compartir la mascota | contrato |
| Plan | plan y estado (siempre `free` hoy; no se muestra en la app) | `subscriptions` | servidor | cupo de IA | contrato |
| Técnicos | tokens de sesión (SecureStore), copia local de mascotas, registros y catálogo (AsyncStorage, **sin cifrar**), avisos programados | dispositivo | app | modo offline | contrato |
| Errores | informes de fallos sin email, nombre ni contenido (Sentry; ver la nota sobre IP e identificador de instalación) y logs del servidor (IP, hora, petición) | Sentry, Supabase | app / servidor | seguridad y corrección de errores | interés legítimo |
| Sin uso todavía | teléfono (login por teléfono retirado del alcance, decisión 2026-10-29), avatar propio, tokens push, eventos de analítica, referidos de clínicas, informes compartidos | tablas existentes sin cliente | — | — | — |

Datos de terceros: las fotos pueden incluir personas (la app pide repetirlas si sale alguien).

## 2. Encargados y transferencias

| Proveedor | Qué recibe | Notas |
|---|---|---|
| Supabase | todo lo anterior (base de datos, Auth, Storage, Edge Functions) | región de `kitom-dev` no verificada; **la política dice «Unión Europea»**: crear producción en una región UE o corregir `site/privacy.html` (comentario `CONFIRMAR`) |
| Google (Gemini API, AI Studio) | foto, síntomas, datos de la mascota (especie, raza, edad, peso, sexo, esterilizado, condiciones, alergias) y registros recientes con notas; sin nombres ni email | la política describe el **plan de pago** (Google no usa el contenido para mejorar sus productos). En el plan gratuito sí lo usa (`DECISIONS.md`): **no abrir a usuarios reales hasta activar el de pago** |
| OpenAI (alternativo, desactivado por defecto) | lo mismo que Gemini | solo si `AI_PROVIDER=openai`; **no figura en la política**: añadirlo antes de activarlo |
| Google (OAuth) | inicio de sesión con Google | si el usuario lo elige |
| Sentry | informes de errores sin email, nombre ni contenido | en la política (retención 90 días). Comprobado el 2026-11-04: la IP llega a Sentry, que deducía de ella la ubicación aproximada, y los cierres nativos llevan un identificador de instalación que `beforeSend` no puede quitar. Las reglas del panel los eliminan al llegar y no se guardan (`DEPLOYMENT.md` §8, paso 10), pero salen del dispositivo: revisar si la política y la ficha de Play deben mencionarlo |
| Expo / EAS | ninguno en runtime hoy (no se usan push remotas ni EAS Update) | revisar la política si se adopta EAS Update o push |
| GitHub Pages | IP de las visitas a `site/` (registro técnico de GitHub) | sin cookies ni analítica |

Transferencias fuera del EEE (Google, Sentry, Expo, GitHub): la política se apoya en el Marco de
Privacidad de Datos UE-EE. UU. o en cláusulas contractuales tipo.

## 3. Retención

Plazos publicados en la política (`site/privacy.html` §6) y estado real:

| Dato | Plazo publicado | Estado técnico |
|---|---|---|
| Cuenta y perfil | hasta eliminar la cuenta; borrado ≤ 30 días | eliminación desde la app en construcción (P0-02); por email, manual |
| Mascotas, registros y agenda | hasta borrarlos o eliminar la mascota o la cuenta | borrado en cascada con la mascota |
| Fotos de mascota | hasta cambiarlas o eliminar la mascota o la cuenta; Storage ≤ 30 días | encoladas para limpieza; **Edge Function `pet-storage-cleanup` sin desplegar** (P1-04): desplegarla antes del lanzamiento |
| Consultas con IA (foto, señales, resultado, `response_raw`) | con la consulta, hasta eliminar la mascota o la cuenta | igual que las mascotas; no hay borrado de una consulta suelta |
| Registro de uso de la IA | mientras exista la cuenta | `ON DELETE CASCADE` con el perfil |
| Contenido enviado a Google | lo que fije Google para detectar abusos (plan de pago) | depende del plan de Google |
| Informes de errores | 90 días | comprobar que la retención del plan de Sentry lo cumple |
| Logs del servidor | máximo 90 días | según el plan de Supabase |
| Copias de seguridad | se sobrescriben en ≤ 30 días | según el plan de Supabase |
| Emails de soporte | 12 meses tras cerrar la conversación | manual |
| Solicitudes de derechos | 3 años (fecha, email y respuesta) | manual |
| Copia local en el dispositivo | hasta cerrar sesión con todo subido, eliminar la cuenta, desinstalar o borrar los datos de la app | al cerrar sesión con todo subido se borra; si el usuario elige conservar cambios pendientes, se queda |
| `reminder-attachments`, `shared-reports`, `avatars` | — | sin uso; definir antes de usarlos |

Al eliminar la cuenta: las mascotas propias pasan a un co-tutor `editor` si lo hay; si no, se eliminan
con sus datos y fotos. Lo escrito en mascotas que siguen existiendo queda con el autor a `NULL`
(`daily_logs.logged_by`/`last_edited_by`, `reminders.created_by`, `ai_analysis_requests.requested_by`:
`ON DELETE SET NULL`).

## 4. Derechos del usuario (RGPD)

| Derecho | Canal |
|---|---|
| Información (art. 13) | política de privacidad pública, enlazada en Ajustes › Legal y Privacidad y en la consulta con IA |
| Acceso / portabilidad | Ajustes › Descargar mis datos (JSON; en construcción) o por email |
| Rectificación | desde la app (perfil, mascotas, registros) |
| Supresión | Ajustes › Eliminar cuenta (en construcción) o por email (`site/delete-account.html`, ≤ 30 días) |
| Oposición / limitación | por email |
| Retirar el consentimiento de marketing | `marketing_opt_in` revocable en Ajustes › Privacidad |
| Reclamación | AEPD |

Email de soporte: `SUPPORT_EMAIL` (`frontend/src/lib/legal-links.ts`), con `mailto:` en Ayuda,
Privacidad y Legal. Plazo de respuesta publicado: un mes (ampliable dos más, avisando).

## 5. Borrador para las declaraciones de tienda (a validar por legal)

- Datos recogidos: email, nombre, fotos, información de salud **de la mascota** (no del usuario),
  contenido generado por el usuario (notas), identificadores de la cuenta, informes de fallos.
- Compartidos con terceros: fotos y datos de la mascota con el proveedor de IA para prestar el servicio.
- Cifrado en tránsito: sí (HTTPS). Eliminación a petición: sí, en la app (P0-02) y por la URL web.
- Sin publicidad ni seguimiento entre apps; sin analítica hoy.
