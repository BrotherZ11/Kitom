# Decisiones técnicas

Registro breve de decisiones técnicas relevantes: contexto, decisión y consecuencias. Las más
recientes, arriba. El detalle de cada contrato vive en su documento de referencia.

## 2026-10-16 — Daily logs offline, fase 6: arranque en frío sin conexión

**Contexto.** Con el token de acceso caducado y sin red, supabase-js 2.117 reintenta la renovación ~25 s,
conserva la sesión guardada y emite `INITIAL_SESSION` sin sesión: la app mostraba el login tras hasta
25 s de splash, sin acceso a los registros guardados. Además `signOut()` en ese estado no borra la
sesión, cada petición de datos espera a la inicialización de supabase-js y, sin sesión utilizable, las
peticiones salían como `anon` (RLS devuelve «vacío», que podía pisar la copia local).

**Decisión.**
- Estado explícito `offline` (`auth-state.ts`): la sesión sigue guardada y su usuario se identifica en
  local (forma de la sesión y `sub` del JWT = `user.id`); se abre su almacén y nada más. Un
  `INITIAL_SESSION` sin sesión solo es cierre si el almacenamiento ya no la tiene. Tope de arranque de
  4 s. No se afirma que la sesión sea válida en el servidor.
- Se lee la sesión con la misma clave que supabase-js (`AUTH_STORAGE_KEY`, fijada con su valor por
  defecto: ningún usuario pierde la sesión). Se descartó guardar una copia propia de la identidad (otro
  dato que mantener coherente y otra fuente de verdad).
- Nada sale sin sesión utilizable: `serverCall` en las queries/mutaciones (falla al instante) y una
  guardia en el `fetch` del cliente que impide peticiones de datos como `anon` (con `ABORT_ERR` para
  que postgrest-js no las reintente). Se descartó desactivar las queries (`enabled: false` las deja
  cargando para siempre).
- Recuperación con `getSession()` al volver la red, al volver a primer plano, a petición y cada 30 s
  solo en `offline`; cerrar sesión en `offline` borra la sesión del dispositivo.
- Sin Pets offline: las pantallas de un registro funcionan sin la mascota en caché («Información de la
  mascota no disponible sin conexión») y se llega a ellas desde «Registros guardados en este
  dispositivo». Con el permiso desconocido se permite editar (RLS decide al sincronizar).

**Consecuencias.**
- Tras recuperar la red, la sesión puede tardar hasta ~60-90 s en renovarse (margen de supabase-js +
  reintento cada 30 s); hasta entonces no se sincroniza nada.
- Un arranque lento con red (renovación de más de 4 s) abre la app en `offline` unos segundos.
- Depende de detalles de supabase-js 2.117 (clave por defecto, conservación de la sesión ante errores
  reintentables, reintentos de postgrest-js): las pruebas con el supabase-js real lo vigilan; revisar al
  actualizarlo.

## 2026-10-16 — Daily logs offline, fase 5: ciclo de vida de la sesión y cierre de sesión

**Contexto.** El motor comprobaba que su sesión fuera la del dueño antes de cada envío, pero la
petición salía por el cliente compartido de Supabase con el token que tuviera **en ese instante**: si
la sesión cambiaba entre la comprobación y el `fetch`, una operación de A podía guardarse como B
(reproducido en `daily-log-session.test.mjs` quitando la protección). Además: un motor y un almacén
nuevos en cada montaje (dos instancias de la misma cuenta sin serializar sus escrituras), query keys
del servidor sin usuario, respuestas tardías que podían escribir en la caché entre el evento de Auth y
el desmontaje, y cerrar sesión sin avisar de los cambios que solo están en el dispositivo.

**Decisión.**
- Cada petición del motor lleva el token de la sesión del dueño, comprobado (sesión y `sub` del JWT)
  justo antes de enviarla y fijado en `Authorization`; sin él, no sale (401 local
  `owner_session_required`, política `wait_for_auth`). Se descartó un cliente de Supabase por usuario
  (más instancias de GoTrue y de su almacenamiento de sesión) y comprobar solo antes del envío (deja la
  ventana).
- Una instancia de almacén y motor por usuario y proceso; activar una para las demás.
- Todas las query keys de Daily Logs llevan el usuario; caché y copias de lecturas del servidor solo
  si `isCurrentUser(userId)` (síncrono con el evento de Auth). El proveedor no pinta nada sin usuario.
- Cerrar sesión con pendientes, conflictos o fallos (o sin poder comprobarlo) pide decidir: intentar
  sincronizar (pasada acotada de 15 s; cierra solo si no queda nada), conservar en el dispositivo y
  cerrar, o cancelar. Ninguna opción borra datos; sin descarte masivo. Una operación a la vez.
- Los datos locales de otras cuentas no se borran ni se migran: se aíslan y esperan a que vuelva su
  dueño. Un registro con dueño no verificable (`key_mismatch`) se protege como uno de versión
  desconocida.

**Consecuencias.**
- Una cuenta que no vuelve a entrar deja sus datos en el dispositivo (sin cifrar) indefinidamente;
  limpiarlos exige una decisión de producto (p. ej. al borrar la cuenta o con confirmación explícita).
- Una sesión caducada o revocada sale sin pantalla de decisión (no queda sesión con la que preguntar):
  equivale a «Conservar».
- El intento de sincronizar reintenta también los fallidos y vuelve a leer los conflictos (como
  «Reintentar»): un fallido por permisos vuelve a fallar sin pérdida; un pendiente que se queda a medias
  sigue pendiente con su backoff.
- Pets y el resto de queries conservan su aislamiento (vaciar la caché al cambiar de usuario).

## 2026-10-15 — Daily logs offline, fase 4: endurecimiento

**Contexto.** La auditoría de la fase 3 encontró que una lectura tardía podía hacer retroceder la
copia local y la caché, que el formulario se abría con una copia antigua, que un registro fallido no se
podía descartar, que los pendientes de una mascota sin acceso quedaban inalcanzables y que un 401 se
reenviaba en cada disparador.

**Decisión.**
- Versiones comparadas como instantes con microsegundos (sin `Date`) y marca de lectura en el almacén:
  una respuesta tardía solo se acepta si es estrictamente posterior. Las queries del servidor leen a
  través del almacén y la query del día descarta filas anteriores dentro de la escritura de TanStack.
  No se cancelan lecturas en vuelo (cancelar y escribir después deja una ventana).
- El formulario espera al servidor como mucho 3 s con conexión; nunca sin conexión. Una versión que
  llega después solo sustituye los valores si el usuario no ha tocado nada; si ya editó, se avisa y la
  precondición decide al guardar. Se elimina el remontaje del formulario al resolver conflictos.
- Descartar la copia local es una operación propia, solo local, para fallidos y conflictos con versión
  remota conocida; nunca para pendientes ni para conflictos sin leer el servidor.
- «Registros sin sincronizar» en la pantalla de inicio, que hoy es la única pantalla global estable de
  la zona autenticada: la lista sale del almacén local y no depende de ver la mascota.
- Tras un 401 solo una sesión nueva o renovada desbloquea el envío.

**Consecuencias.**
- La base de la precondición solo avanza con contenido idéntico o sin cambios del usuario; el resto de
  casos acaba en conflicto explícito, nunca en un pisado.
- La caché del historial espera a que cada fila pase por el almacén (algunas lecturas locales más por
  página).
- B6 (un toque en «Guardar resolución» sin petición y la pantalla arriba, en Android) no se reprodujo;
  ver hipótesis en `CHANGELOG.md`. No se da por corregido.
- Sustituye a la consecuencia de la fase 3 «descartar solo si el registro ya no está en el servidor».

## 2026-10-15 — Daily logs offline, fase 3: resolución de conflictos y recuperación

**Contexto.** La fase 2 detecta los conflictos y conserva los datos, pero el usuario no podía
resolverlos. Además había que revisar la recuperación ante errores y una ejecución de tests que se
quedó colgada.

**Decisión.**
- Pantalla propia de resolución (ruta `daily-logs/resolve/[date]`), no un diálogo: necesita espacio
  para comparar dato a dato y es accesible desde el estado de sincronización del formulario.
- Tres decisiones: mis cambios, los del servidor o combinar (automático solo lo que cambió un único
  lado y las etiquetas; lo cambiado en los dos sitios exige elegir). «Conservar ambas» solo como texto
  revisado y editable: se eliminó la combinación automática de notas de la API de fusión.
- Una resolución no es un guardado: se vuelve a leer el servidor; si cambió desde la comparación se
  pide resolver otra vez sin enviar nada; si no, se envía con la precondición de esa versión.
- Fila remota ausente: recrear o descartar, siempre a petición. RLS no distingue «borrada» de «sin
  acceso», así que el texto lo dice así; si no hay permiso, el envío falla con `42501` y se muestra
  como fallido, nunca como guardado.
- Cola: orden por fallos acumulados y antigüedad, para que un registro que falla siempre no bloquee
  al resto.
- Tests con tiempo límite (`--test-timeout`) y sin temporizadores reales en las pruebas del motor: un
  cuelgue falla en vez de bloquear la ejecución.

**Consecuencias.**
- El cuelgue observado en la fase 2 (una ejecución bajo un código mutado a propósito) no se reprodujo
  en 28 repeticiones con las mismas condiciones; se cubren sus causas posibles con lo anterior.
- Descartar cambios locales solo existe para registros que ya no están en el servidor.
- Pendientes los mismos de la fase 2 salvo la resolución (ver `FRONTEND_ARCHITECTURE.md` §5).

## 2026-10-15 — Daily logs offline, fase 2: guardado local y motor de sincronización

**Contexto.** Con la base de la fase 1 (almacén, modelo, errores, backoff y fusión), falta guardar en
el dispositivo desde el formulario y enviar al servidor sin perder ni pisar datos.

**Decisión.**
- Guardar es siempre local: la mutación de TanStack solo escribe en el dispositivo y el envío lo hace
  un motor propio. Así ninguna petición de red queda en pausa en TanStack para enviarse sola después
  (era el riesgo en web, comprobado el 2026-10-13). `networkMode: 'always'` solo en esa mutación; el
  resto de la app no cambia.
- Motor de una sola pasada a la vez y una operación detrás de otra (evita carreras dentro de la
  instalación). Disparadores: guardado, arranque, conectividad, primer plano y sesión renovada.
- Siempre con precondición; el frontend deja de llamar a `save_daily_log` sin ella (se borró esa
  llamada de la API de pantallas). El backend la mantiene por compatibilidad.
- Conflicto = leer la fila remota. Si ya tiene lo enviado, sincronizado (cubre la respuesta perdida y
  la creación idéntica en dos dispositivos); si no, conflicto con los datos locales intactos. No se
  aplica todavía la fusión automática a tres bandas: la resolución (automática o elegida) llega con la
  pantalla de conflictos.
- Sesión: el motor nace sin sesión y solo envía si la sesión activa es del dueño del almacén; 401
  deja la operación esperando sin gastar intentos hasta que la sesión se renueve.
- Lecturas: vista combinada calculada en cada render a partir de la query del servidor y la del
  dispositivo (no se fusionan en la caché). Copia local de cada fila leída sin cambios pendientes,
  para mostrar lo último conocido sin conexión; nunca sustituye a una operación pendiente.
- Base del formulario: la fila que mostró al abrirse; solo avanza cuando el servidor confirma lo
  guardado desde ese formulario.
- Tiempo límite de 20 s por petición del motor y sin reintentos internos de supabase-js.
- Pruebas de integración contra el Supabase local con `npm run test:integration`
  (`scripts/test-integration.mjs`), que se niega a ejecutarse si la URL no es local.

**Consecuencias.**
- Los datos locales de un usuario quedan en el dispositivo al cambiar de cuenta (aislados por clave);
  limpiarlos y cerrar sesión con pendientes quedan para otra fase.
- Un conflicto necesita al usuario; en esta fase solo se muestra y se puede volver a comprobar.
- Con la app abierta en frío sin conexión no se puede llegar al formulario (Pets no es offline).
- Las pruebas de integración dejan usuarios `it-…@kitom.test` en el Auth local (borran sus mascotas).

## 2026-10-13 — Daily logs offline, fase 1: almacén local, conectividad y módulos puros

**Contexto.** Antes de guardar en local y sincronizar hace falta una base revisable: dónde y cómo se
guardan los datos, qué forma tiene un registro pendiente y qué pasa cuando el servidor tiene otra
versión. Esta fase no conecta nada a las pantallas ni envía operaciones.

**Decisión.**
- Almacén: AsyncStorage detrás de una interfaz propia (`KeyValueStorage`), con una clave por
  registro (`kitom:v1:<userId>:daily-logs:<petId>:<logDate>`) y un sobre con versión por colección.
  Se descartó guardar la cola en una sola clave (cada edición reescribiría todo y un fallo la
  corrompería entera). Los datos no válidos o de otra versión se señalan y no se borran solos.
- Riesgo aceptado: AsyncStorage no cifra en reposo y en web es `localStorage`. Las notas quedan en
  claro en el dispositivo; tokens y credenciales nunca van a este almacén.
- Una sola operación pendiente por registro. `operationId` es estable mientras la operación existe
  y `revision` cuenta las ediciones fundidas: así se sabe si el contenido cambió durante un envío.
  No se guarda un estado «enviando»: si la app muere a mitad, el reintento recibe conflicto y se
  resuelve comparando con la fila remota (no hay id de operación en el servidor).
- `operationId`: UUID v4 de `expo-crypto` (`randomUUID`), con un único generador
  (`lib/device-operation-id.ts`). Se eligió porque Hermes no expone `crypto.randomUUID` (comprobado en
  Android: `undefined`), usa el generador seguro del sistema en iOS y Android y WebCrypto en web, y
  va incluido en Expo Go. Sin alternativa con `Math.random`: si no hay fuente segura, no se crea la
  operación. El identificador nace con la operación y no cambia en reintentos ni ediciones.
- Fusión por unidades con conflicto explícito cuando ambos lados cambian lo mismo. Etiquetas como
  conjunto (sin conflicto posible). Notas: siempre conflicto, nunca concatenación automática.
  `unusual_behavior` y su nota, juntos. Fila remota borrada y fusión vacía quedan sin resolver.
- Errores: `network` solo si no hubo respuesta, decidido por el mensaje de `fetch` y no por el tipo
  (un `TypeError` de programación no debe reintentarse sin fin). Dos contadores: `attempts` (todos los
  envíos fallidos; marca el backoff) y `countedAttempts` (solo los fallos con respuesta; marca el
  límite). Así una racha sin conexión no acerca la operación a `failed`. Agotar el límite no borra
  nada: queda `failed` con su contenido y su error hasta que el usuario reintente o edite. Permisos
  y validación pasan a `failed` al primer fallo; el conflicto nunca se reintenta. Sin sesión se
  espera sin contar intentos.
- Backoff (2 s × 2ⁿ, tope 5 min) y límite (8): valores provisionales, sin datos que los respalden.
  Se validan en la fase de sincronización.
- Conectividad: `expo-network` → `onlineManager`. En móvil se fija `networkMode: 'always'`. No es
  una política nueva: antes no había señal de red en móvil y todo se intentaba siempre; `always`
  mantiene eso ahora que la señal existe. Con el modo por defecto cambiarían todas las features: las
  queries se quedarían cargando y las seis mutaciones (crear, editar y borrar mascota, subir y quitar
  foto, guardar registro) quedarían en pausa y se enviarían solas al reconectar. Tampoco se activa
  la revalidación al reconectar en móvil. En web no se cambia el modo que ya tenía. Auth y la zona
  horaria no usan TanStack Query. Comprobado con tests contra `@tanstack/query-core` y a mano en un
  emulador Android (guardar sin red da error al instante, nada se envía al reconectar, una consulta
  sin red termina en error con «Reintentar»).
- Tests: los módulos puros se importan entre sí con ruta relativa y extensión `.ts` (así los ejecuta
  Node sin compilar); `allowImportingTsExtensions` en `tsconfig.json`.

**Consecuencias.**
- `expo-network` tiene código nativo: hace falta un development build nuevo (Expo Go ya lo incluye).
- Pendiente de decidir en la fase 2: en **web**, con el navegador sin conexión, TanStack Query ya
  pausaba las mutaciones y las enviaba al reconectar (comportamiento anterior, sin tocar); para
  Daily Logs eso es un guardado sin precondición diferido. Comprobado en navegador: sin red no sale
  ninguna petición ni se muestra error, y al reconectar se envía solo. Cambio mínimo propuesto, sin
  aplicar: `networkMode: 'always'` en la mutación de `useSaveDailyLog` (no un cambio global).
- `expo-crypto` también tiene código nativo (mismo development build nuevo que `expo-network`).
- Expo Doctor sigue con una comprobación pendiente: `@expo/ui`, `expo`, `expo-router` y
  `expo-splash-screen` van un parche por detrás del esperado. No se actualizan aquí por ser ajenos a
  esta fase; van en un cambio propio (`chore/`).
- Pendiente: conectar el guardado local y el motor de sincronización, borrar los datos locales al
  cerrar sesión, generador de `operationId`, UI de conflictos y de estado de sincronización.
- Contrato: `FRONTEND_ARCHITECTURE.md` §5 «Infraestructura».

## 2026-10-10 — Daily logs: concurrencia optimista en save_daily_log (fase 0 del modo offline)

**Contexto.** `save_daily_log` sustituye el registro completo sin comprobar si cambió desde que el
cliente lo leyó: con dos dispositivos, un co-tutor o una edición sin conexión, el segundo guardado
pisa al primero sin avisar (reproducido en la app web). Leer y luego guardar desde el cliente no lo
arregla: entre las dos llamadas puede entrar otro guardado.

**Decisión** (migración `20261010160332_daily_logs_concurrency.sql`; solo cambia la función).
- Dos precondiciones opcionales: `p_expected_updated_at` (editar solo la versión leída) y
  `p_expect_absent` (crear solo si no existe). Son excluyentes (`22023` si llegan las dos).
- La versión es `daily_logs.updated_at`: ya existe, ya la devuelve la RPC y la mantiene un trigger.
  Se descartó una columna `revision` por exigir cambio de tabla, grants y tipos para el mismo efecto
  práctico (ver riesgo abajo).
- Atomicidad sin bloqueos explícitos: la versión se compara en el `WHERE` del propio `UPDATE` (un
  escritor concurrente hace esperar al segundo, que reevalúa el `WHERE` sobre la fila ya cambiada) y
  la creación se apoya en `UNIQUE (pet_id, log_date)`.
- Conflicto = `P0001` con `hint` `daily_log_conflict` (mismo patrón que `log_date_future`) y `detail`
  `version_mismatch` | `row_missing` | `row_exists`. No se devuelve la fila remota: el cliente la lee
  después (ya tiene SELECT por RLS).
- Los permisos van antes: viewer y ajeno reciben `42501` exista o no el registro, así el error no
  sirve para averiguar nada. Si el permiso se revoca en mitad de la llamada también es `42501`.
- Un registro borrado desde que se leyó es un conflicto (`row_missing`), no se recrea solo.
- Con `p_expect_absent` se comprueba la existencia antes del `INSERT`: si no, un registro antiguo que
  ya existe daría «fuera de la ventana de 7 días» (trigger BEFORE INSERT) en vez de conflicto.
- Firma: se borra la de 13 parámetros y se crea una de 15 con default en los dos nuevos. Con
  `CREATE OR REPLACE` habrían quedado dos funciones y las llamadas actuales seguirían usando la
  antigua. Mismos permisos que antes (`authenticated` y `service_role`; ni `PUBLIC` ni `anon`).
- Reintentos: no hay id de operación en el servidor. Si se pierde la respuesta de un guardado, el
  reintento recibe conflicto y el cliente compara el contenido remoto con el enviado.

**Consecuencias.**
- Transición: sin precondiciones la RPC se comporta como antes (gana el último guardado y puede
  pisar en silencio otro guardado). Es lo que envía el frontend actual. **No se usa para la
  sincronización offline**: cada operación de la cola envía una precondición. Cuando no queden
  clientes sin ella, se podrá exigir en otra migración.
- Riesgo aceptado: `updated_at` es la hora de inicio de la transacción (`now()`), no un contador. Dos
  escrituras de la misma fila en la misma transacción, o dos transacciones iniciadas en el mismo
  microsegundo, dejan la misma versión. Los clientes hacen una llamada por transacción, así que solo
  afectaría a scripts de backend o a una coincidencia de microsegundo con un guardado sin
  precondición. Si se quiere cerrar del todo: trigger propio de `daily_logs` con `clock_timestamp()`
  estrictamente creciente (requiere aprobación; esquema y triggers sin cambios en esta fase).
- El cliente debe guardar y reenviar `updated_at` como la cadena original que devuelve PostgREST
  (microsegundos), nunca pasada por `Date`: truncada a milisegundos no coincide nunca y todo guardado
  daría conflicto.
- Pruebas: `supabase/tests/database/daily_logs.test.sql` §13 (lógica, en secuencia) y
  `supabase/tests/concurrency/daily_logs_concurrency.sh` (sesiones simultáneas reales, solo local).
  Contrato: `FRONTEND_ARCHITECTURE.md` §4 «DailyLogScreen» y `README.md` §15.

## 2026-10-09 — Historial de Daily Logs: cursor sobre log_date, carga progresiva y edición en el mismo formulario

**Decisión.**
- Paginación por cursor (keyset) sobre `log_date`, no por `offset`: `log_date` es único por mascota y
  está indexado (`UNIQUE (pet_id, log_date)`), y el cursor no se desplaza si se guarda un registro nuevo
  mientras se navega. 20 registros por página; se pide uno de más para saber si hay otra página sin
  una consulta extra al final.
- Carga progresiva con un botón explícito («Cargar registros anteriores») dentro de la pantalla con
  scroll, no lista virtualizada con scroll infinito: evita anidar `FlatList` en el `ScrollView` de
  `Screen` y es suficiente para páginas de 20. Si el historial crece mucho por sesión, pasar a
  `FlatList`.
- Ruta por fecha (`daily-logs/[date]`), no por id: la identidad del registro es (`pet_id`, `log_date`),
  igual que en la RPC y en el futuro modo offline. Abrir un día sin registro no lo crea.
- Se reutiliza `DailyLogEditor` sin cambios: recibe la fecha de la fila guardada, así que editar
  conserva el `log_date` original.
- Resumen de la lista: solo lo indicado (escalas con su texto, etiquetas, comportamiento inusual,
  notas). Sin medias ni valoraciones, coherente con que Kitom no interpreta clínicamente.
- Guardar (hoy o histórico) actualiza en caché el registro y la página del historial que lo contenga
  y revalida solo las queries de esa mascota.

**Consecuencias.** Sin cambios de BD. `pet_streaks` aún no se muestra en el historial. La lista no es
virtualizada.

## 2026-10-08 — Daily Logs frontend (fase 1): registro de hoy, online

**Decisión.**
- "Hoy" se calcula solo en `features/daily-logs/log-date.ts`: día del calendario con `Intl` en la zona
  del perfil → dispositivo → `UTC`. Nunca `toISOString()` (en Madrid daría el día siguiente entre las
  00:00 y las 02:00). La pantalla fija la fecha al abrirse para que el registro en curso no cambie de
  día si se cruza la medianoche.
- Una pantalla por día con el registro completo: abrir no crea nada; guardar envía todos los campos
  a `save_daily_log` (la RPC sustituye el registro). La fila devuelta se pasa al formulario y a la
  caché; un refetch posterior no pisa lo que el usuario está editando.
- Escalas sin valor inicial; volver a tocar la opción elegida la deja en `null` (sin indicar).
  «Todo como siempre» solo rellena el formulario.
- La nota de comportamiento inusual no se envía con el interruptor desactivado: el campo no se ve y
  no debe guardarse texto oculto (se conserva en pantalla por si se reactiva).
- Tipos de la RPC: los generados no admiten `null` en parámetros de función; `SaveDailyLogArgs`
  lo corrige solo para los parámetros que la RPC acepta y se convierte en un único punto de la API.
- Permisos solo como UX con `can_edit_pet` (lo mismo que Pets); sin lógica por `owner_id`.

**Consecuencias.** Un co-tutor en otra zona horaria calcula "hoy" con la suya, pero la BD valida con
la del propietario: alrededor de medianoche podría recibir `invalid_date` (los co-tutores aún no
tienen UI; pendiente una RPC tipo `pet_local_today`). Contrato: `FRONTEND_ARCHITECTURE.md` §4.

## 2026-10-08 — Zona horaria del perfil: NULL = sin configurar e inicialización desde el dispositivo

**Contexto.** `profiles.timezone` ya existía (`text NOT NULL DEFAULT 'UTC'`) y su trigger convertía
`NULL` en `'UTC'`: no se podía distinguir "nunca configurada" de "el usuario está en UTC", así que la
app no podía inicializarla sin pisar una elección real. Además `pg_timezone_names` acepta abreviaturas
y alias (`CET`, `GMT+0`, `EST5EDT`, `posix/…`), en contra del contrato documentado.

**Decisión** (migración `20261008155257_profile_timezone.sql`; sin columna nueva).
- `timezone` admite `NULL` y no tiene default. `NULL` = sin configurar; el servidor sigue usando `UTC`
  donde necesita un "hoy" (`coalesce`, sin cambios en `daily_logs`).
- Los `'UTC'` existentes pasan a `NULL`: siempre eran el default (no hay pantalla para elegirla).
- Validación sin catálogo propio: el trigger exige `UTC` o Área/Ubicación existente en
  `pg_timezone_names`, y solo valida cuando el valor cambia (guardar lo mismo es un no-op y un valor
  heredado no bloquea editar el resto del perfil). La app aplica la misma regla, más `Intl`.
- Inicialización en la app: una vez por usuario y arranque, `update … where id = $user and timezone
  is null`. La condición en la propia consulta hace el guardado atómico e idempotente y garantiza que
  nunca se sobrescribe un valor existente (sin leer antes). Si no hay zona válida o falla, no se hace
  nada y la app sigue.
- Detección con `Intl.DateTimeFormat().resolvedOptions().timeZone`, sin dependencias nuevas
  (`expo-localization` no está instalado y no aporta nada para esto).
- RLS y grants sin cambios: `authenticated` ya tenía `UPDATE (timezone)` y `profiles: update own`.

**Consecuencias.** Si el usuario viaja, el perfil conserva la zona inicial hasta que exista un ajuste
manual (Settings, pendiente). Pruebas: `supabase/tests/database/profile_timezone.test.sql` y
`frontend/src/features/profile/timezone.test.mjs` (`npm test`, runner de Node sin dependencias).

## 2026-10-08 — Daily logs: un registro por día, guardado por RPC y reglas de contenido en la BD

**Contexto.** `daily_logs` existía desde la baseline (columnas = PRD §8.3), pero ninguna escritura
funcionaba (`recompute_pet_streak` sumaba `date + bigint`), el upsert documentado necesitaba UPDATE
sobre columnas inmutables, y borrar una mascota con 2+ registros violaba la FK de `pet_streaks` (el
trigger de rachas recalculaba durante la cascada).

**Decisión** (migración `20261008150202_daily_logs_fixes.sql`).
- Un único registro por mascota y día (`UNIQUE (pet_id, log_date)`): es el estado general del día, la
  clave natural sirve de idempotencia offline y el cliente no envía `id`. Sin síntomas en el MVP: son
  del flujo de IA (PRD §8.4) y no se crea `daily_log_symptoms`.
- El registro es de la mascota: owner y editores aceptados crean, editan y borran cualquier registro;
  `viewer` solo lee. RLS sin cambios. `last_edited_by` registra la última modificación.
- Guardado con `save_daily_log` **SECURITY INVOKER**: aplica la RLS y los grants de quien llama; pone
  `logged_by = auth.uid()` solo al crear; sustituye el registro completo. UPDATE y después INSERT
  (con reintento ante `unique_violation`), no `INSERT … ON CONFLICT`: los triggers BEFORE INSERT se
  ejecutan antes de detectar el conflicto y la ventana de fechas impediría editar registros antiguos.
- Escalas 1–5 sin valor por defecto (un 3 inventaría datos): relativas a lo habitual para energía,
  apetito, actividad, vocalización e interacción social; de calidad para ánimo y sueño. La escala no
  está en la BD (los CHECK 1–5 ya existían); es contrato de la UI y de la futura IA.
- Fechas: crear solo entre hoy y hoy − 7 en la zona del propietario (limita rellenar rachas a
  posteriori); editar sin límite; `log_date` inmutable (sin GRANT de UPDATE + trigger). Si el perfil
  del propietario no tiene zona sincronizada, vale `UTC` (default de `profiles.timezone`).
- Sin registros vacíos (`daily_logs_not_empty_check`): al menos un nivel, comportamiento inusual
  marcado o descrito, una nota con texto o una etiqueta.
- Tags de lista cerrada en un CHECK (`vet_visit`, `home_change`, `new_pet`, del PRD §8.3): añadir uno
  requiere migración, a cambio de que la IA y los informes reciban siempre códigos conocidos. Se
  descartó una tabla de catálogo con traducciones por ser excesiva para tres valores.
- Límites de texto: no había ningún criterio previo en la app. `notes` ≤ **2000** caracteres (unas
  300 palabras: holgado para un diario y acotado para el contexto de la IA) y
  `unusual_behavior_notes` ≤ **1000** (describe una sola conducta). Se cuentan caracteres, no bytes.
- Rachas: solo se corrigió el tipo (`rn::integer`). Al borrar un registro durante la cascada del
  borrado de la mascota no se recalcula (su racha se borra con ella), lo que hace el borrado
  independiente del orden de cascada, que depende de los OID de cada entorno.
- Grants: `anon` sin nada; `authenticated` sin TRUNCATE/REFERENCES/TRIGGER/MAINTAIN ni UPDATE de
  `log_date`.

**Consecuencias.** Un registro nuevo creado offline que tarde más de 7 días en sincronizarse se
rechaza. Con 8 días de ventana se puede ganar `streak_7` rellenando la semana anterior (aceptado).
Hasta sincronizar `profiles.timezone` desde el frontend, los usuarios por delante de UTC no pueden
registrar "hoy" entre su medianoche y la medianoche UTC. Pruebas: `supabase/tests/database/daily_logs.test.sql`.
Contrato: `FRONTEND_ARCHITECTURE.md` §4 «DailyLogScreen» y §5.

## 2026-10-07 — Fotos de mascota: JPEG ≤ 1600 px, path único por subida y referencia antes que archivo

**Contexto.** `pets.photo_path` y el bucket privado `pet-photos` (con políticas por `pet_id`) ya
existían. Las políticas llaman a `safe_pet_id_from_path`, cuyo EXECUTE estaba revocado a
`authenticated`, así que ninguna operación de Storage podía funcionar.

**Decisión.**
- Migración mínima `20261007182429_grant_safe_pet_id_from_path.sql`: solo `grant execute` a
  `authenticated`. Sin cambiar políticas ni buckets; la autorización sigue en `can_edit_pet` /
  `is_pet_member`.
- Formato de salida único **JPEG** (`image/jpeg`, `.jpg`): lo decodifican Android, iOS, web y los
  proveedores de IA; HEIC no se ve en web y WebP con pérdida no es universal en los modelos. Entrada
  aceptada: JPEG, PNG, WebP, HEIC/HEIF; el resto (GIF, archivos no imagen) se rechaza.
- Lado mayor ≤ **1600 px**, calidad **0.8**, sin recorte: ~200–800 KB, nitidez suficiente para un
  perfil y para reutilizar la foto en un análisis de imagen (los modelos de visión suelen reducir a
  ~1500 px). Límites duros: 25 MB de entrada, 5 MB de salida.
- Path `{pet_id}/{uuid}.jpg`: compatible con las políticas, sin datos personales y sin colisiones.
  Como no hay política UPDATE, cambiar la foto sube un objeto nuevo y borra el anterior **después** de
  actualizar `photo_path`.
- Al quitar la foto se limpia primero `photo_path` y luego se borra el objeto: un fallo parcial deja
  como mucho un objeto huérfano, nunca una referencia rota.
- Se descartó subir la foto dentro del formulario de datos: un fallo de Storage no debe bloquear la
  edición de la mascota.

**Consecuencias.** Pueden quedar objetos huérfanos (fallos parciales y mascotas borradas); pendiente
una limpieza en backend. En web solo se ofrece la galería. Contrato: `FRONTEND_ARCHITECTURE.md` §4.

## 2026-10-07 — Razas en el frontend: pregunta progresiva y payload siempre coherente

**Decisión.**
- La raza se pregunta en dos pasos: estado (*Con raza* / *Mestizo* / *Sin raza*) y, solo con raza,
  buscador del catálogo (nombre y alias, sin tildes) u «Otra / no aparece» (texto libre). Sin elegir
  nada queda `breed_status = NULL`; «Prefiero no indicarlo ahora» vuelve a ese estado. Nunca se
  convierte «sin contestar» en `unknown`.
- `toPetFields` genera siempre una de las cinco combinaciones válidas del CHECK, aunque el estado del
  formulario conserve restos (id o texto) de una opción anterior.
- Al cambiar de especie se descarta la raza concreta (catálogo o texto) y vuelve a «sin contestar»;
  mestizo y desconocida se conservan porque siguen siendo válidos para cualquier especie.
- El buscador pinta como máximo 25 resultados y pide afinar la búsqueda; sin texto muestra el
  catálogo en orden alfabético.

## 2026-10-07 — Razas: catálogo por especie, raza opcional y estado explícito

**Contexto.** `pets.breed` era texto libre: no permitía distinguir «sin contestar», «no sé» y
«mestizo», ni relacionar la raza con conocimiento clínico, ni impedir una raza de otra especie.

**Decisión** (migración `20261007152630_breeds.sql`).
- Tabla `breeds` ligada a `species` (`UNIQUE (species_id, code)`); nombres y alias en
  `catalog_translations` (`entity_type = 'breed'`), sin sistema de traducciones paralelo.
- `pets.breed_id` nullable y `pets.breed_status` (`known | mixed | unknown`, `NULL` = no preguntado).
  «Mestizo» y «No sé» son estados, no razas ficticias. Se descartó resolverlos solo en la UI porque
  todos acabarían en `NULL` y se perdería información útil para el perfilado progresivo y la IA.
- CHECK `pets_breed_status_check`: `known` exige exactamente uno de `breed_id` (catálogo) o `breed`
  (texto libre para razas no catalogadas); el resto de estados exige ambos `NULL`.
- Integridad especie ↔ raza con **FK compuesta** `pets (breed_id, species_id) → breeds (id, species_id)`,
  sin trigger: imposible asociar una raza de otra especie y cambiar la especie falla mientras haya
  una raza incompatible.
- `breeds` es de solo lectura para `authenticated` (RLS + `revoke all`/`grant select`); las razas no se
  borran, se desactivan con `is_active`.

**Consecuencias.** El frontend debe vaciar la raza al cambiar de especie y añadir `breed_id`/
`breed_status` a sus columnas de lectura y escritura (siguiente tarea). Catálogo y criterios: `SEED.md`.

## 2026-10-07 — Pets: RLS decide la visibilidad y las escrituras envían solo columnas editables

**Contexto.** `pets` se comparte entre propietario y co-tutores (`pet_co_owners`). La seguridad está
en tres capas de BD: GRANT por columna (sin UPDATE de `owner_id`), RLS (`is_pet_member`,
`can_edit_pet`, borrado solo del propietario) y triggers (`protect_pet_structural_fields`,
`validate_pet_birth_date`).

**Decisión.**
- Las lecturas no filtran por `owner_id`: RLS devuelve propias y compartidas.
- Corrección (migración `20261007172110`): la política SELECT pasa a ser
  `owner_id = auth.uid() OR is_pet_member(id)`. Con solo `is_pet_member(id)`, `INSERT … RETURNING`
  fallaba (42501) porque la política SELECT se evalúa sobre la fila nueva antes de que exista en la
  tabla. Las filas visibles no cambian.
- `owner_id` lo fija la capa de datos con el usuario de la sesión al crear; nunca sale del formulario
  y nunca se envía en un update. Las escrituras construyen el payload con una lista explícita de
  columnas editables (`pets-api.ts`), así que propiedades extra no llegan a Supabase.
- Las acciones de la UI se ocultan con `can_edit_pet` (editar) y `owner_id === user.id` (borrar), solo
  como UX. Un update o delete que RLS filtra (0 filas) se trata como `not_allowed`.
- `is_active` (archivar) y `photo_path` (subida) no se exponen todavía.

**Consecuencias.** Las mascotas compartidas funcionarán sin cambios cuando se implementen las
invitaciones. Contrato completo: `FRONTEND_ARCHITECTURE.md` §4 «Pets».

## 2026-10-07 — Auth: flujo PKCE y deep links con esquema `kitom`

Ver `AUTH.md` §2. Los enlaces de email y el retorno de Google vuelven a `/auth-callback` con un `code`
de un solo uso que solo sirve en el dispositivo que inició el flujo.
