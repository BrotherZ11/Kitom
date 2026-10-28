# Changelog

Cambios relevantes del proyecto, en orden cronológico inverso. El detalle de cada contrato o
decisión permanece en su documento de referencia.

## 2026-10-28

- Fase 13, recordatorios (rama `feat/reminders-mvp`, sin cambios de esquema):
  - Listado de lo pendiente de todas las mascotas (`/reminders`) y resumen de la agenda en la ficha.
  - Los recordatorios de una mascota con una eliminación guardada en el dispositivo dejan de avisar y no
    se pueden cambiar; los avisos usan solo pendientes futuros.
  - El detalle ya no promete un aviso que no llegará (web, sin permiso, hora pasada).
  - Un co-tutor lector que intente escribir ve «sin permiso», no «lo cambió otra persona».
  - Un cambio de zona del dispositivo se aplica en el siguiente arranque (Hermes guarda la zona); los
    recordatorios suenan a su hora igualmente.
  - Acceso a datos con cliente inyectado y pruebas de integración contra el Supabase local; pruebas de
    zona horaria y del ciclo de vida de los avisos.
  - Propuesta de agenda sin conexión: `docs/proposals/2026-10-28-reminders-offline.md`.

- Migraciones de la limpieza de Storage (`20261027194904`, `20261027194908`, `20261028114317`) aplicadas
  en `kitom-dev` (`db push` del usuario; comprobado con `migration list`) y tipos regenerados con
  `--linked` (solo las 6 RPC nuevas). La Edge Function `pet-storage-cleanup` sigue sin desplegar.

- Revisión de seguridad de la limpieza de Storage, antes del PR (rama `db/pet-storage-cleanup`, sin
  aplicar en `kitom-dev`):
  - Migración `20261028114317_pet_storage_cleanup_guards.sql`: las RPC no trabajan si su propietario no ve
    `storage.objects` entero (vería 0 objetos y terminaría en falso) o si falta el CHECK de `photo_path`.
  - Pruebas más estrictas (TUS, recuento de RPC, aislamiento de la concurrencia) y aplicación desde cero
    comprobada.
  - Hallazgos abiertos en `docs/proposals/2026-10-26-pet-photos-cleanup.md`.

## 2026-10-27

- Fase 12B, limpieza de fotos de mascotas eliminadas (rama `db/pet-storage-cleanup`, sin aplicar en
  `kitom-dev`):
  - Migraciones `20261027194904_pets_photo_path_own_pet.sql` (CHECK: `photo_path` solo de la propia
    mascota) y `20261027194908_pet_storage_cleanup.sql` (cola privada, trigger al borrar y RPC solo para
    `service_role`).
  - Edge Function `pet-storage-cleanup`: secreto propio, modo informe por defecto, solo `pet-photos`.
  - Bucket `pet-photos` y `verify_jwt = false` de la función en `config.toml`, solo para el local.
  - Pruebas pgTAP, de concurrencia, unitarias y de integración contra el Storage local.
  - Diseño, despliegue y límites: `docs/proposals/2026-10-26-pet-photos-cleanup.md`.

## 2026-10-26

- Fase 11, estabilización E2E (rama `feat/pets-offline-writes`, sin cambios de esquema): validación en
  el emulador Android (Expo Go), en web y contra el Supabase local. Corregido: la señal de red podía
  quedarse en «sin conexión» con la Wi-Fi conectada y la sincronización no volvía (ahora se relee al
  volver a primer plano y cada 10 s sin conexión); el diario de fotos podía enviar con la sesión de otra
  cuenta (ahora, cliente por propietario); Ajustes decía «Todo está subido» con cambios de mascotas
  pendientes. Pruebas de flujos cruzados y un caso de concurrencia nuevos; `.gradle/` del módulo nativo
  ignorado. Resultados y lista pendiente de Storage en `FRONTEND_ARCHITECTURE.md` §5 «Estabilización E2E
  (fase 11)».

- Pets offline, fase 10 (rama `feat/pets-offline-writes`, sin cambios de esquema): eliminar una mascota
  se guarda en el dispositivo y lo envía el motor con precondición `updated_at`. Se puede deshacer hasta
  que el servidor la aplique. Un cambio de otro dispositivo es un conflicto que decide el usuario, y un
  alta sin confirmar se comprueba por su clave antes de borrarla. La mascota sale de la lista y de los
  registros diarios mientras tanto; las eliminaciones aparecen en «Eliminaciones pendientes», en
  «Cambios sin sincronizar» (que ahora incluye altas, ediciones y eliminaciones de mascotas) y en el
  cierre de sesión. Fotos: `photo_path` con precondición, ningún objeto referenciado se borra (corrige
  el borrado de la foto nueva tras un fallo sin respuesta) y un diario local resuelve lo pendiente.
  Prueba de concurrencia `pets_delete_concurrency.sh`. Propuesta de limpieza de Storage en el servidor,
  sin aplicar. Decisión en `DECISIONS.md`; contrato en `FRONTEND_ARCHITECTURE.md` §4 y §5.

- Pets offline, fase 9 (rama `feat/pets-offline-writes`, sin cambios de esquema): el catálogo de razas
  se guarda en el dispositivo (por usuario e idioma) y se puede buscar y elegir una raza sin conexión,
  también tras reiniciar la app. El selector distingue entre catálogo guardado, no descargado aún en el
  dispositivo, error del dispositivo y especie sin razas. La ficha muestra sin conexión el nombre de la
  raza. El formulario no envía una raza de otra especie. El catálogo se pide entero en una consulta por
  idioma. Decisión en `DECISIONS.md`; contrato en `FRONTEND_ARCHITECTURE.md` §4 «Pets» y §5 «Catálogo de
  razas sin conexión (fase 9)».

## 2026-10-23

- Co-tutores (rama `feat/co-owners`): «Co-tutores» en el perfil de la mascota (titular y co-tutores,
  invitar por email con permiso «Solo ver» o «Puede editar», cambiar el permiso y quitar el acceso),
  invitaciones recibidas con aceptar/rechazar (aviso en Hoy y en «sin mascotas») y, en la configuración
  inicial, aceptar una invitación en lugar de crear una mascota. Tipos de las tres RPC nuevas añadidos.
  Decisión en `DECISIONS.md`; contrato en `FRONTEND_ARCHITECTURE.md` §1 y §4 (CoOwnersScreen).
- Orientación con IA (rama `feat/ai-guidance`, sin cambios de esquema): Edge Function
  `ai-analysis-process` (Gemini de Google AI Studio con salida JSON por esquema; OpenAI como
  alternativa; validación sin «diagnóstico», suelo de urgencia
  por señales y simulador solo en local) y pantallas de consulta: asistente con foto opcional y señales,
  resultado por nivel con aviso, urgencias cercanas, valoración y cita en la agenda, consultas
  anteriores y pantalla de límite del plan gratuito. Entradas en Hoy y en el perfil de la mascota. La
  insignia «Primera consulta con foto» deja de ser «Próximamente». Prompt y reglas: borrador pendiente
  de validación veterinaria. Decisión en `DECISIONS.md`; contratos en `README.md` §8–9 y
  `FRONTEND_ARCHITECTURE.md` §1 y §4.
- Corregido (Android): un botón que pasaba de `secondary` a `primary` ya montado se quedaba sin icono
  ni texto (al quitar su borde). `Button` fija siempre `borderWidth`.
- Avisos exactos en Android: si los avisos de Kitom pueden retrasarse (sin «Alarmas y recordatorios»), la
  Agenda y Ajustes › Notificaciones lo dicen y llevan a ese ajuste; al concederlo, todos los avisos se
  reprograman para llegar a su hora. Permiso `SCHEDULE_EXACT_ALARM` y módulo nativo local
  `modules/kitom-exact-alarms` (necesita una build nativa nueva). Decisión en `DECISIONS.md`; contrato en
  `FRONTEND_ARCHITECTURE.md` §7.
- BD: migración `20261023082848_pet_invitations_by_email.sql` (rama `db/pet-invitations-by-email`):
  invitar co-tutores por email sin revelar qué emails tienen cuenta, ver las invitaciones pendientes con el
  nombre de la mascota y de quien invita, y ver los co-tutores de una mascota con su nombre. Solo funciones
  nuevas (sin cambios de tablas ni RLS). Pruebas pgTAP nuevas. Validada en local; aplicada en `kitom-dev`
  (`db push` del usuario). Decisión en `DECISIONS.md`; contrato en `README.md` §13.

## 2026-10-21

- MVP (rama `feat/mvp-completion`, sin cambios de esquema):
  - Configuración inicial tras crear la cuenta: tu nombre, aviso veterinario (obligatorio, con fecha y
    versión), privacidad (comunicaciones desactivadas por defecto), primera mascota y hora del
    recordatorio diario. Las cuentas existentes pasan una vez por los pasos.
  - Agenda: recordatorios de vacunas, medicación, citas, baño, desparasitación y otros cuidados con día,
    hora, repetición y notas; lista (pendientes, hoy, próximos y hechos) y mes; hecho con «Deshacer»,
    posponer, editar y eliminar con confirmación. «Próximo» en Hoy y acceso desde el perfil.
  - Avisos locales (`expo-notifications`): recordatorio diario (no avisa si ya registraste) y aviso de
    cada recordatorio; tocar un aviso abre su pantalla. En Expo Go 57.0.9 no están disponibles (la app lo
    dice y sigue funcionando); en builds nativas sí.
  - Logros y racha: insignias del servidor con progreso, semana y detalle de cada insignia.
  - Tu cuenta: editar el nombre, plan, zona horaria («usar la de este móvil»), tema claro/oscuro/sistema,
    notificaciones, seguridad y cambio de contraseña, privacidad, ayuda y legal.
  - Corregido: el calendario del mes podía pasar el domingo a la fila siguiente.
  - Decisión en `DECISIONS.md`; contratos en `FRONTEND_ARCHITECTURE.md` §1, §2, §4 y §7.

- Pets offline, fase 8.5 (validación manual en Android y web y correcciones):
  - Cerrar sesión cuenta también las altas y ediciones de mascotas pendientes. Antes, con solo mascotas
    pendientes se cerraba sin preguntar.
  - El formulario de mascota se puede guardar sin conexión; antes el botón seguía deshabilitado.
  - Los cambios de mascotas que ya no ves (sin permiso o borradas) aparecen en «Mis mascotas» para
    copiarlos o descartarlos.
  - Sin el catálogo de razas se puede escribir la raza a mano, y la ficha ya no dice «Sin indicar»
    para una raza del catálogo cuyo nombre no se conoce.
  - Documentados los límites de `updated_at` y de varias pestañas en web.
  - Detalle en `FRONTEND_ARCHITECTURE.md` §5; decisión en `DECISIONS.md`.

- Pets offline, fase 8: crear y editar mascotas sin conexión. Se guarda en el dispositivo y se envía al
  volver la red.
  - Las altas llevan una clave que impide duplicarlas aunque se pierda la respuesta o se cierre la app.
  - Las ediciones se consolidan y se envían con la versión que se editó. Si otro dispositivo cambió los
    mismos datos, decide el usuario; si cambió otros, se conservan los dos.
  - Sin permiso, o si la mascota ya no está, los cambios se conservan para copiarlos o descartarlos.
  - La lista, la ficha y el perfil muestran el estado de cada mascota (pendiente, sincronizando,
    comprobando, conflicto, error, sin permiso).
  - Una mascota aún no creada en el servidor no tiene registros diarios ni foto.
  - El catálogo de especies se guarda en el dispositivo.
  - Fotos y borrado siguen necesitando conexión.
  - La migración `20261020135440` está aplicada en `kitom-dev` y los tipos regenerados.
  - Decisión en `DECISIONS.md`; contrato en `FRONTEND_ARCHITECTURE.md` §5 «Pets: altas y ediciones sin
    conexión (fase 8)».

## 2026-10-20

- BD: migración `20261020135440_pets_client_request_id.sql` (rama `db/pets-client-request-id`):
  `pets.client_request_id` con índice único por propietario y solo GRANT de INSERT, para que crear una
  mascota sin conexión y enviarla al volver la red no la duplique aunque se pierda la respuesta. Sin
  cambios de RLS, triggers ni `pets.id`. Pruebas pgTAP y de concurrencia nuevas (incluida la edición con
  precondición sobre `updated_at`, que no necesita cambios de esquema). Validada en local; pendiente de
  aplicar en `kitom-dev`. Decisión en `DECISIONS.md`; contrato en `README.md` §5.
- Android: identificador de paquete `com.kitom.app` en `app.json` (necesario para compilar la APK de
  prueba en local; no se debe cambiar). La APK de prueba va firmada con la clave de depuración y
  apunta al Supabase del `.env` (`kitom-dev`).
- Pets offline, fase 7 (solo lectura): la lista de mascotas, las fichas, las pestañas y el nombre de la
  mascota en los registros se pueden ver sin conexión con la última copia guardada en el dispositivo
  (aviso «Sin conexión: datos guardados…» con la fecha). Sin copia: «no disponible sin conexión» (nunca
  «no existe» ni «no tienes mascotas»); una lista vacía confirmada por el servidor se distingue de una
  que nunca se cargó; una copia ilegible es un error que se puede reintentar. Solo se guardan
  respuestas correctas de la cuenta activa; una respuesta tardía no hace retroceder la copia; las copias
  de otras cuentas no se ven ni se borran. Crear, editar, borrar y fotos siguen necesitando conexión
  (aviso y envío bloqueado). Foto sin conexión o caducada: «no disponible», sin tocar `photo_path`. Sin
  cambios de BD ni de dependencias. Contrato en `FRONTEND_ARCHITECTURE.md` §5 «Pets sin conexión
  (fase 7)»; decisión en `DECISIONS.md`.
- Móvil: al volver la red se vuelven a pedir solas las consultas que fallaron sin conexión (p. ej. la
  lista de mascotas ya no se queda en «No hay conexión» hasta pulsar «Reintentar»). Solo las
  caducadas y en pantalla; sin sesión utilizable no sale ninguna, y red, primer plano y renovación de
  la sesión a la vez dan una sola petición por consulta. Web, las mutaciones y Daily Logs no cambian.
  Modifica la decisión del 2026-10-13 (`DECISIONS.md`); contrato en `FRONTEND_ARCHITECTURE.md` §5.

## 2026-10-19

- Daily Logs offline, fase 6.5 (estabilización de la sesión en móvil): al volver la red tras un arranque
  sin conexión, la sesión se renueva al momento (0,12 s medidos; antes 25,6 s) y los pendientes se
  sincronizan después (0,24 s). Sin conexión ya no se intenta renovar (ni el temporizador de supabase-js
  ni la app), así que al volver la red no hay que esperar el bloqueo de 60 s de supabase-js; con
  conexión pero sin sesión, se reintenta cada 5 s sin peticiones de más. Corregido: una respuesta de
  error que no es del servidor de Auth (p. ej. un 403 en HTML de un proxy) cerraba la sesión con el
  token caducado; una sesión rechazada que supabase-js no pudiera borrar se reintentaba sin fin; una
  comprobación tardía podía aplicarse a otra cuenta; una sesión guardada a medias que mezclara dos
  cuentas podía identificar a una de ellas. Sin cambios de BD ni de dependencias. Tiempos, política y
  premisas de supabase-js en `FRONTEND_ARCHITECTURE.md` §5 «Estabilización de la sesión (fase 6.5)»;
  decisión en `DECISIONS.md`; medición repetible con `frontend/scripts/measure-session-recovery.mjs`.
  Verificado en el emulador Android (Android 16, Expo Go 57.0.9 con SecureStore nativo, Supabase local
  cortado de verdad con el modo avión): arranque sin red con el token vigente (sesión leída del
  SecureStore, sin login) y con el token caducado tras 1 h (aviso «Sesión sin comprobar»; seguir así
  tras ir y volver de segundo plano durante los reintentos), crear y editar sin red, cerrar la app y
  conservarlo, al volver la red una sola renovación y una sola escritura (`save_daily_log` con
  precondición, 200, sin conflicto; renovación a los 3,3 s de quitar el modo avión, de los que ~3 s son
  la reconexión del wifi del emulador), cambio de cuenta sin ver datos de la otra y cierre de sesión sin
  red conservando los cambios (otra cuenta no los ve ni los envía; al volver la cuenta, se envían una
  vez). No verificado en dispositivo: volver la red con la app en segundo plano y cerrar sesión en
  `offline` con el token caducado (cubiertos con supabase-js real en Node).

- Dependencias de Expo actualizadas a las versiones recomendadas para SDK 57 (solo parches): `expo`
  57.0.30, `expo-router` 57.0.28, `@expo/ui` 57.0.25, `expo-linking` 57.0.13, `expo-splash-screen`
  57.0.10 y `expo-constants` 57.0.22 (`npx expo install --fix`). React Native y React no cambian.
- Diseño v2, F2 (bienvenida): pantalla de bienvenida (1.1) como entrada sin sesión y «Cómo funciona»
  (1.2); «Ya tengo cuenta» lleva al login y el «atrás» del login vuelve a la bienvenida.
- Diseño v2, F5 (navegación y Hoy): barra Hoy · Historial · Registrar · Agenda · Perfil; Hoy con la
  semana de la mascota activa (anillo, mensaje, valores del día, evolución o «Su semana»), selector de
  mascota, avisos de conexión, de sesión y de registros sin sincronizar, y aviso al subirse el de hoy.
  Agenda «Próximamente». «Tu cuenta» mínima (email, mascotas, pendientes, zona horaria, cerrar sesión).
- Diseño v2, F4 (registro e historial): registro en dos pasos con progreso, «Todo como siempre» de las
  4 principales (obligatorias al crear), detalles de tres opciones (2/3/4, sin convertir los valores
  anteriores), pantalla «Hecho», confirmación al salir con cambios y error con lo marcado intacto;
  historial con semana (hasta 3 series), mes (calendario y una línea por serie), día a día con huecos,
  estado sin datos suficientes y detalle del día de solo lectura con «Editar este día». Estados de
  sincronización con icono y texto; resolución de conflictos, registros sin sincronizar y cierre de
  sesión con pendientes con el nuevo diseño (misma lógica).
- Diseño v2, F3 (mascotas): alta con foto, especie en tarjetas y datos opcionales; perfil con foto,
  datos, «Completa el perfil» y racha (`pet_streaks`, solo lectura); edición con hoja de foto (permiso
  denegado incluido), borrado con diálogo y aviso «Cambios guardados»; lista de mascotas renovada.
- Editar mascota: la especie aparece bloqueada y se puede corregir con «¿Te has equivocado? Cambiar la
  especie» (con confirmación: la raza elegida se borra).
- Limpieza: retirada la capa de compatibilidad de F0 (`ThemedText`, `constants/theme.ts` y los nombres de
  color antiguos de `useTheme()`), 21 textos sin uso y el paquete `expo-device`, que no se usaba.
- Revisión de funcionalidad frente a `main`: la ficha `/pets/[id]` vuelve a tener el registro de hoy de
  esa mascota, todos sus datos (también los no indicados) y el cambio de foto; el historial vuelve a
  resumir todas las escalas de cada día; el registro vuelve a indicar «Sincronizado».
- `npm run visual:compare` cubre Hoy, registro, detalles, historial (semana y mes), detalle del día,
  perfil, edición, alta, agenda y ajustes (`KITOM_VC_PET_ID`, mascota de la cuenta local).

- Acceso, correcciones de fidelidad (auditoría visual): el contenido de login, registro y recuperar
  queda a la altura de los tableros (rejilla vertical de `Screen` y fila de la barra superior
  reservada), «Enlace enviado» y «Revisa tu correo» arriba como en los tableros 1.8 y 1.4, enlace «He
  olvidado mi contraseña» con 15/22 · 600 (`TextLink`) y sin el recuadro de foco del navegador en los
  campos en web (el foco sigue marcado por el borde del campo). Sin cambios de comportamiento.

## 2026-10-16

- Diseño v2, F2 (acceso): login, registro, recuperar contraseña, nueva contraseña y callback de Auth
  con la composición, los textos y los componentes del diseño (Google con su logo, separador «o con tu
  email», errores en su campo, acción principal abajo, «Revisa tu correo» y «Enlace enviado» como
  estados propios). Misma lógica de sesión, mismos flujos y mensajes de error. Pendiente de decidir lo
  que el diseño pide y la app no soporta (teléfono, texto legal, reenviar email, repetir contraseña,
  longitud mínima visible). Decisión en `DECISIONS.md`.

- Marca en la app: nombre visible «Kitom», icono de iOS, icono adaptativo de Android (con monocromo),
  splash y favicon de `frontend/assets/brand/app-icon/` (`slug` y esquema `kitom` sin cambiar).
  Regenerados desde sus SVG los PNG que estaban mal rasterizados (icono de iOS, fondo adaptativo,
  favicon y notificación). Eliminados los recursos de la plantilla de Expo (`assets/images/`,
  `assets/expo.icon/`). Se ven en una build nativa; Expo Go muestra los suyos.
- Nuevo `npm run start:local`: arranca la app contra el Supabase local sin tocar `.env`, comprobando
  antes que el endpoint efectivo es local y responde (si no, no arranca). Uso en `frontend/CLAUDE.md`.

- Diseño v2, F1 (componentes): componentes de marca en `src/components/ui/` según los tableros y las
  fichas de `docs/design/componentes/` (botones, campos, selectores, escala de pasos, interruptor,
  tarjetas, listas, alertas, bandas, etiquetas, avatar, estados de carga/vacío/error, diálogo, hoja
  inferior y avisos breves), con claro/oscuro, respuesta al pulsar y respeto a «reducir movimiento».
  Las pantallas existentes ya usan los nuevos `Button`, `TextField`, `OptionGroup`, `FormMessage`,
  estados y `Screen`, y cabeceras de marca; sin cambios de comportamiento ni de datos. Galería solo de
  desarrollo en `/dev-components`. Eliminados `global.css` y `themed-view.tsx` (sin uso). Corregido:
  en tema oscuro, el color `danger` antiguo tapaba al token `danger`. Decisión en `DECISIONS.md`.

- Diseño v2, F0 (base visual): toda la app usa ya la paleta «Ritmo» (claro y oscuro según el sistema) y
  las fuentes de marca (Hanken Grotesk e IBM Plex Mono); las cabeceras de navegación y el fondo de la
  ventana siguen el tema. Nuevos `src/theme/` (tokens, tema, fuentes) y componente `Text`. Dependencias
  nuevas: `react-native-svg`, `lucide-react-native` y las dos de fuentes. Sin cambios de comportamiento,
  datos ni BD. Decisión en `DECISIONS.md`.

- Daily Logs offline, fase 6 (arranque en frío sin conexión): abrir la app sin red con la sesión
  caducada ya no lleva al login tras ~25 s de espera: en 4 s como máximo se abre con los datos guardados
  en el dispositivo del usuario de esa sesión y el aviso «Sesión sin comprobar» («Volver a comprobar»).
  No se envía ni se lee nada del servidor hasta renovar la sesión (al volver la red, al volver a primer
  plano o cada 30 s); entonces se sincroniza con precondición. Sin conexión, la lista de mascotas ofrece
  «Registros guardados en este dispositivo» y el registro de hoy y el historial se abren sin la mascota
  en caché («Información de la mascota no disponible sin conexión»). Corregido: cerrar sesión sin red con
  el token caducado no la cerraba; las peticiones de datos sin sesión salían como `anon` (respuestas
  vacías) y esperaban hasta ~25 s. Sin cambios de BD. Contrato en `FRONTEND_ARCHITECTURE.md` §5
  «Arranque en frío sin conexión»; decisión en `DECISIONS.md`.

- Daily Logs offline, fase 5 (sesión y cierre de sesión): cerrar sesión con registros pendientes, en
  conflicto o fallidos ya no cierra sin preguntar: nueva pantalla con cuántos hay y tres opciones
  (intentar sincronizar y cerrar, solo si no queda nada; conservar en este dispositivo y cerrar;
  cancelar). Sin pendientes, todo sigue igual. Los cambios conservados se recuperan al volver a entrar
  con la misma cuenta en este dispositivo; otra cuenta nunca los ve ni los envía. Corregido: una
  operación podía enviarse con la sesión de otra cuenta si la sesión cambiaba justo antes del envío
  (ahora cada petición lleva el token del dueño o no sale). Query keys de Daily Logs con el usuario,
  respuestas tardías fuera de la caché de la cuenta nueva, una sola instancia de motor por cuenta,
  cierre de sesión sin dobles ejecuciones y registros de dueño no verificable protegidos. Sin cambios
  de BD. Contrato en `FRONTEND_ARCHITECTURE.md` §5 «Sesión y cierre de sesión»; decisión en
  `DECISIONS.md`.

- Diseño de la app v2 en `docs/design/` (solo diseño, sin código): inventario de 90 pantallas y
  estados (`PANTALLAS.md`), plan de implementación por fases (`PLAN_DESARROLLO.md`), guía de marca,
  tokens (`tokens/`, con `chartActivity` y `chartSleep` nuevos), reglas de componentes, fuentes del
  prototipo navegable (`prototipo/`) y sus generadores (`fuente/`). Logos e iconos de app en
  `frontend/assets/brand/` (aún sin enlazar en `app.json`). Decisión de navegación en `DECISIONS.md`.

## 2026-10-15

- Daily Logs offline, fase 4 (endurecimiento): una lectura del servidor que llega tarde ya no hace
  retroceder la copia local ni la caché (versiones con microsegundos, sin `Date`); el formulario espera
  hasta 3 s al servidor con conexión, se abre con la copia del dispositivo si tarda o no hay conexión
  (indicándolo) y solo carga una versión posterior si no se ha tocado; descartar la copia de este
  dispositivo en registros fallidos o en conflicto (solo local, con confirmación); «Registros sin
  sincronizar» con contador en la pantalla de inicio, también para mascotas sin acceso; un 401 espera a
  una sesión nueva; errores de lectura local visibles como error; la pantalla de resolución explica el
  estado sin conexión. Sin cambios de BD. B6 (toque en «Guardar resolución» sin petición, Android) no
  reproducido: las únicas salidas sin petición son una pasada en curso (espera y continúa, con prueba),
  sin red o sin sesión (muestra «No se ha podido comprobar…») y registro ya resuelto; en la prueba
  original el segundo toque sí funcionó con la decisión intacta, así que no hubo remontaje. Contrato en
  `FRONTEND_ARCHITECTURE.md` §5 «Endurecimiento»; decisión en `DECISIONS.md`.

- Daily Logs offline, fase 3: pantalla para resolver conflictos (tu versión, la del servidor, qué
  difiere y quién lo cambió; conservar mis cambios, los del servidor o combinar con decisión explícita
  en lo cambiado por ambos; notas «ambas» solo como texto revisado) y detalle de los registros que no
  se pudieron sincronizar. Guardar una resolución vuelve a leer el servidor y la envía con
  precondición; si cambió otra vez, se pide de nuevo. Fila remota ausente: recrear o descartar a
  petición. La cola ya no se queda atascada en un registro que falla siempre. Tests con tiempo
  límite. Sin cambios de BD. Contrato en `FRONTEND_ARCHITECTURE.md` §5; decisión en `DECISIONS.md`.

- Daily Logs offline, fase 2: el registro de hoy y los registros del historial se guardan primero en
  el dispositivo y un motor de sincronización los envía con `save_daily_log` y precondición
  (`p_expected_updated_at` / `p_expect_absent`), una operación detrás de otra, al guardar, al
  recuperar la conexión, al volver a primer plano y al renovarse la sesión. Sin conexión se muestran
  los últimos datos conocidos. Estados visibles (Sincronizado, Pendiente de sincronizar,
  Sincronizando, Conflicto pendiente de resolver, No se pudo sincronizar) y «Reintentar». Conflictos y
  respuestas perdidas se reconcilian leyendo la fila remota, sin pisar datos. En web solo la
  mutación de guardado de Daily Logs pasa a `networkMode: 'always'`. Nueva orden
  `npm run test:integration` (Supabase local). Sin cambios de BD. Contrato en
  `FRONTEND_ARCHITECTURE.md` §4 y §5; decisión en `DECISIONS.md`.

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
