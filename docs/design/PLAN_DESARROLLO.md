# Plan de desarrollo del diseño v2

Guía para que Claude Code implemente el diseño de `docs/design/` por fases. Cada fase es un PR propio
(`feat/…`) con lint, tipos y docs al día. Las reglas de `CLAUDE.md` y `frontend/CLAUDE.md` mandan sobre
este plan: si algo de aquí choca con ellas, se para y se pregunta.

## Estado (2026-10-19)

Implementado en `feat/ui-brand-implementation` por fases de trabajo F0–F5 (no coinciden una a una con
las de este plan): base visual y componentes, bienvenida y acceso (1.1–1.5, 1.8, 1.9), mascotas (3.1–3.3,
3.6–3.11), Hoy (4.1, 4.3, 4.6; sin señales ni agenda), registro (5.1–5.8, 5.10; el conflicto 5.9 como
pantalla, no hoja), historial (6.1–6.3, 6.5), agenda «Próximamente», «Tu cuenta» mínima (10.1) y estados
globales (12.1–12.3). MVP (2026-10-21, `feat/mvp-completion`): 2.1, 2.3, 2.4, 3.4, 3.5, 8.1–8.7 (sin
adjuntos ni avisos por tipo), 9.1–9.2, 10.1–10.4, 10.7 y 10.8. Pendiente: 1.6–1.7 (teléfono), 2.2
(solo español), 4.2/4.5 y 6.4 (señales), 6.6 (límite del plan), 7.x (IA), 9.3, 10.5, 10.6, 10.9, 11.x
(Premium) y 12.4. Detalle: `docs/CHANGELOG.md` y `docs/DECISIONS.md`.

## Reglas para todas las fases

- **Fuentes de verdad**: `supabase/migrations/` > `docs/FRONTEND_ARCHITECTURE.md` > este diseño. Antes
  de pintar un dato, comprobar que la columna o RPC existe. Lo que el diseño pide y la BD no tiene está
  en `PANTALLAS.md` §6: no se inventa en el cliente ni se crea migración sin aprobación (PR `db/…` aparte).
- **Textos**: todo el copy del prototipo va a `src/i18n/locales/es.ts` (y su clave en `en.ts`). Nunca
  «diagnóstico»/«diagnostica». Disclaimer visible en cada resultado de orientación.
- **Paquetes**: solo con permiso del usuario y con `npx expo install`. Los que hacen falta están en
  cada fase.
- **Patrón de features**: datos solo en `features/<x>/api/`, hooks de TanStack Query, componentes sin
  `supabase`; escrituras con columnas explícitas. Estado de UI compartido (mascota activa, tema) en
  React Context. Nada de Zustand/Redux ni react-navigation directo.
- **Accesibilidad**: objetivos ≥ 44 px, `accessibilityRole`/`accessibilityLabel` en todo control,
  contraste de los tokens (no inventar colores), texto escalable (`maxFontSizeMultiplier` 1,6 en
  controles), «reducir movimiento» desactiva animaciones.
- **Terminado** (por pantalla): coincide con su tablero (`PANTALLAS.md` da el archivo), tiene todos
  los estados dibujados (carga, vacío, error, éxito, deshabilitado), tema claro y oscuro, textos en
  i18n, `npx expo lint` y `npx tsc --noEmit` limpios, `npm test` verde si hay lógica pura, docs y
  `CLAUDE.md` › «Estado conocido» actualizados. No marcar como hecho lo que solo está maquetado.

## Fase 0 · Base visual

Requiere permiso para instalar: `@expo-google-fonts/hanken-grotesk`, `@expo-google-fonts/ibm-plex-mono`,
`react-native-svg`, `lucide-react-native`.

1. Copiar `docs/design/tokens/tokens.ts` a `frontend/src/theme/tokens.ts` (sigue siendo generado: se
   cambia `docs/design/fuente/brand.py`, se regenera y se vuelve a copiar).
2. `ThemeProvider` (React Context) con preferencia claro / oscuro / sistema (`useColorScheme()`); la
   preferencia es local del dispositivo (no hay columna). Sustituir `src/constants/theme.ts` y conectar
   el tema de Expo Router.
3. Cargar las fuentes en `src/app/_layout.tsx` antes de ocultar el splash.
4. `app.json`: icono, icono adaptativo de Android (fondo `#0E3B39`), splash (`splash-icon.png` sobre
   `#F2F5F3`) y favicon desde `frontend/assets/brand/app-icon/` (detalle en `GUIA-DE-MARCA.md` › «Icono
   de app»). Exige un development build nuevo.
5. Componentes en `src/components/ui/` siguiendo el tablero «0.1 Componentes y estados» y
   `docs/design/componentes/`: Button (primary, secondary, ghost, danger, urgent; lg/md/sm; cargando),
   IconButton, TextField (foco, error, correcto, bloqueado, prefijo, textarea), OtpInput,
   SegmentedControl, Chip, StepSelector 1–5 (sustituye al slider), Switch, Checkbox, Radio, ListItem,
   Alert, Toast, Banner, Skeleton, EmptyState, BottomSheet, Dialog, Tag/UrgencyTag, Avatar, StreakRing,
   Medal. Sustituyen a los mínimos actuales (`screen`, `button`, `text-field`, `option-group`,
   `query-state`) sin romper las pantallas que ya los usan.

## Fase 1 · Navegación

Barra: **Hoy · Historial · Registrar · Agenda · Perfil** (decisión en `docs/DECISIONS.md`, 2026-10-16).

- Grupo de pestañas dentro de `(app)` (`Tabs` de Expo Router) con cuatro destinos y un botón central
  «Registrar» que no es destino: abre el registro de hoy de la mascota activa como pantalla modal.
  Punto sol mientras hoy está pendiente; «Hecho» y edición cuando ya existe el registro.
- Contexto de **mascota activa** (React Context, persistida en local): cabecera de Hoy con selector
  (hoja «3.9»). Historial, Agenda y Perfil muestran la mascota activa; las rutas actuales
  `pets/[id]/…` se conservan para enlaces directos.
- «Consultar» (orientación con foto) no es pestaña: botón en la cabecera de Hoy y accesos desde
  señales, Alertas y Perfil. La rueda de Perfil abre «Tu cuenta y ajustes».
- Actualizar `docs/FRONTEND_ARCHITECTURE.md` §1 con el árbol real cuando exista.

## Fase 2 · Arranque, cuenta y configuración inicial (secciones 1–2)

- Bienvenida y «Cómo funciona» antes de login/registro; rediseño de login, registro, recuperar y nueva
  contraseña (rutas existentes); «Verifica tu email».
- Configuración inicial protegida por `profiles.onboarding_completed_at IS NULL` (guard en el layout
  raíz, igual que hoy): Tu perfil (`full_name`, `locale`), Aviso veterinario
  (`disclaimer_accepted_at`, `disclaimer_version`, obligatorio), Privacidad (`marketing_opt_in`) →
  primera mascota → recordatorio diario (`notification_preferences`) → permiso de avisos →
  `onboarding_completed_at`. Comprobar en las políticas qué columnas puede escribir el usuario.
- **Bloqueado**: teléfono con código (1.6–1.7) hasta que Auth lo soporte (`docs/AUTH.md`).

## Fase 3 · Mascotas y Hoy (secciones 3–4)

- Perfil mínimo, foto (hoja, permiso denegado), mascota creada, perfil, edición progresiva
  (`known_conditions`, `sex = unknown`, raza con `breed_status`), selector, sin mascotas, eliminar.
- Hoy en sus seis estados con anillo semanal (`pet_streaks`, `daily_logs` de la semana), próxima tarea
  (`reminders`) y como mucho una señal. La «voz de la mascota» es preferencia local.
- El límite de mascotas del plan lo decide el servidor; el cliente solo muestra la respuesta.

## Fase 4 · Registro diario (sección 5)

- Rediseño de `features/daily-logs` con StepSelector, «Todo como siempre» y detalles opcionales
  (tres opciones → 2/3/4; etiquetas cerradas `vet_visit`/`home_change`/`new_pet`; comportamiento
  inusual + nota). Guardado, edición de hoy y anterior, error con datos conservados, salir sin guardar.
- Después, en su propio PR: conectar el motor offline (`features/daily-logs/offline/`, contrato en
  `FRONTEND_ARCHITECTURE.md` §5) y las pantallas sin conexión, conflicto (`daily_log_conflict`) y
  sincronizado. Hasta entonces esas tres pantallas no se implementan.

## Fase 5 · Historial (sección 6)

- Semana y mes con `react-native-svg`: cinco series (`chartEnergy`, `chartAppetite`, `chartMood`,
  `chartActivity`, `chartSleep`), máximo tres a la vez, trazo distinto por serie, huecos sin
  interpolar, pequeños múltiplos para comparar. Mensajes prudentes («parece», «en comparación con su
  semana habitual»).
- Detalle del día (ruta existente), historial vacío, límite del plan (lo decide el servidor).
- Historial de alertas: solo con las señales que el servidor ya expone; si no existen, se queda en
  diseño y se anota.

## Fase 6 · Agenda (sección 8)

- `reminders`: lista y mes, nuevo (hoja, seis tipos, `recurrence_rule`, adjunto en Storage), detalle,
  marcar hecho/deshacer (`status`), posponer (`snooze_until`), eliminar, vacía.
- Notificaciones: requiere permiso para `expo-notifications` y `push_tokens`/`register_push_token`.
  Pantalla de ajustes con `notification_preferences` y estado de permiso denegado.

## Fase 7 · Logros y ajustes (secciones 9–10)

- Logros (`pet_achievements`, `achievements_catalog` + `catalog_translations`), detalle, insignia
  conseguida. Retos semanales: solo «Próximamente».
- Tu cuenta y ajustes, seguridad, cambiar contraseña, consentimientos, fotos, ayuda, legal, cerrar
  sesión. **Bloqueado**: exportar datos y eliminar cuenta (Edge Functions pendientes; `delete-account`
  responde 409 `has_pets`, ver `PANTALLAS.md` §6.9).

## Fase 8 · Bloqueado por backend

No empezar sin que exista la pieza de servidor:

| Sección | Depende de |
|---|---|
| 7 · Orientación con foto | Edge Function `ai-analysis-process`; RPC `request_ai_analysis`, `get_ai_analysis_entitlement`, `submit_ai_feedback` (existen) |
| 11 · Premium | RevenueCat + `revenuecat-webhook`; el plan llega de `subscriptions` |
| 10.6 · Exportar e informe PDF | Edge Function de exportación / `generate-pet-report` |
| 10.9 · Eliminar cuenta | Edge Function `delete-account` |
| 1.6–1.7 · Teléfono | OTP en Supabase Auth |

## Decisiones pendientes del usuario

Las de `PANTALLAS.md` §6 que piden columnas o parámetros nuevos (consentimiento de fotos en servidor,
nota libre en la consulta, clínica propia, avisos por tipo y antelación, etiquetas de probabilidad en
el resultado) y los valores `[PRECIO]` y `[LÍMITE]`. Hasta que se decidan, la pantalla se implementa
sin ese elemento y se anota en `CLAUDE.md` › «Estado conocido».
