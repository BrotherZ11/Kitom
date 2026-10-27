# Decisiones técnicas

Registro breve de decisiones técnicas relevantes: contexto, decisión y consecuencias. Las más
recientes, arriba. El detalle de cada contrato vive en su documento de referencia.

## 2026-10-26 — Fase 11: estabilización E2E (conectividad, fotos por propietario)

**Contexto.** Validación de los flujos integrados en el emulador Android, en web y contra el Supabase
local. Aparecieron dos defectos entre funcionalidades que las pruebas por módulo no cubrían. Sin cambios
de esquema.

**Decisión.**
- La señal de red (`lib/connectivity.ts`) ya no depende solo de los eventos: se vuelve a leer al volver a
  primer plano y cada 10 s mientras diga «sin conexión». Motivo: en el emulador, el último evento de
  `expo-network` puede decir «sin conexión» con la Wi-Fi conectada, y los motores no sincronizaban hasta
  otro cambio de red. Es una consulta local al sistema, no una petición; con conexión no se relee. Se
  descartó relajar `isOnline` (seguiría el mismo evento) y hacer comprobaciones de red reales (coste y
  falsos negativos). Completa la conectividad de 2026-10-13 (que solo usaba eventos y una lectura
  inicial).
- Las fotos usan un cliente de supabase-js por propietario (opción `accessToken`, sin Auth propio): el
  token de la sesión del dueño o la petición no sale (`ownerTokenOrThrow`, nunca `null`, que supabase-js
  convertiría en la clave anónima). Motivo: Storage no permite fijar la cabecera petición a petición, y
  el diario de fotos es una cola de un usuario. Mismo principio que Pets y Daily Logs (fase 5).
- La fila «Cambios sin sincronizar» de Ajustes cuenta registros y mascotas, como el cierre de sesión.

**Consecuencias.**
- La sincronización se recupera sola tras un evento de red erróneo (como mucho en 10 s o al volver a la
  app).
- Ninguna cola (registros, mascotas, fotos) envía con la sesión de otra cuenta.
- Sigue pendiente: coordinación entre pestañas de web (los datos son correctos, pero la otra pestaña
  muestra un estado viejo hasta recargar) y la limpieza de Storage en el servidor.

## 2026-10-26 — Pets offline, fase 10: eliminación guardada en el dispositivo y ciclo de vida de las fotos

**Contexto.** Borrar una mascota exigía conexión y no tenía precondición: borraba la versión que
hubiera, aunque otro dispositivo la acabara de cambiar. Las fotos cambiaban `photo_path` sin
precondición, y un fallo sin respuesta al referenciar una foto nueva la borraba aunque el servidor
pudiera haber aplicado el cambio (una foto referenciada y borrada). Sin cambios de esquema.

**Decisión.**
- La eliminación es una operación más del motor de Pets (`kind: 'delete'`), no un borrado optimista:
  una por mascota, que sustituye a la pendiente y guarda lo necesario para deshacerla (`restore`).
  Se puede deshacer mientras el servidor no la haya podido aplicar (ni confirmada ni en vuelo).
- Precondición `updated_at` con PostgREST (`delete … eq('updated_at', base)`): es una sola sentencia y
  Postgres vuelve a evaluar el `WHERE` si otra transacción cambió la fila (comprobado con sesiones
  simultáneas en `pets_delete_concurrency.sh`). No hace falta RPC ni migración. Se descartó
  `SELECT` + `DELETE` (no es atómico).
- Un alta incierta nunca se da por no creada: se busca por su `client_request_id` antes de decidir.
- 0 filas se decide leyendo la fila. Ya no está, o no se ve: se cierra la operación (RLS no distingue
  «borrada» de «sin acceso»; para quien la quería borrar, el resultado es el mismo). Misma versión: sin
  permiso. Versión nueva: conflicto, salvo que sea la edición de este dispositivo que llegó sin
  respuesta. Confirmada, queda una lápida (`synced`): la mascota no reaparece por una respuesta antigua.
- Mientras hay una eliminación, la mascota no está en la lista ni puede ser la activa, y no se abren sus
  registros diarios. Los ya guardados no se tocan nunca.
- Fotos: precondición sobre el propio `photo_path` (no sobre `updated_at`, que cambiaría con cualquier
  edición). Un objeto solo se borra cuando se sabe que nadie lo referencia. Lo que no se puede cerrar
  queda en un diario local de rutas exactas (nunca un barrido: las fotos de consulta comparten bucket).
- Lo que necesita el servidor (borrar los objetos de una mascota ya eliminada) se propone aparte y no
  se implementa sin aprobación: `docs/proposals/2026-10-26-pet-photos-cleanup.md`.

**Consecuencias.**
- Eliminar funciona sin conexión, con estados visibles, deshacer y conflictos que decide el usuario.
- Garantías: no se borra una versión que el usuario no vio; un alta incierta no se cancela a ciegas; una
  eliminación confirmada no se deshace por una lectura anterior; no se borra ninguna foto referenciada.
- Límites: los objetos de Storage de una mascota eliminada quedan huérfanos hasta la limpieza en el
  servidor; la precondición no cubre registros o recordatorios añadidos por otro usuario mientras tanto
  (la cascada los borra); las lápidas y el diario `blocked` no se limpian solos.

## 2026-10-26 — Pets offline, fase 9: catálogo de razas en el dispositivo

**Contexto.** Sin conexión solo se podía elegir una raza del catálogo si se había cargado en la misma
sesión. En la fase 8 se descartó guardarlo (tamaño, y la raza es opcional). Sin cambios de esquema.

**Decisión.** Modifica la de la fase 8 (2026-10-21) en este punto.

- Una consulta por idioma con el catálogo completo (todas las especies, activas e inactivas) en lugar
  de una por especie con solo las activas. El filtro de activas y de especie y la búsqueda pasan al
  cliente. Así sin conexión sirve cualquier especie y la ficha tiene el nombre de una raza desactivada.
  Son unas 225 razas y 400 traducciones (la consulta de traducciones ya traía todas las del idioma). Si
  PostgREST recorta la respuesta (`max_rows`), es un error y no se guarda.
- Copia en `LocalStore` por usuario (`breed-catalog:<locale>`), aunque el catálogo es global. Se
  descartó una caché global: `LocalStore` exige un usuario en cada clave y cambiar ese contrato no
  compensa unos 30 KB por cuenta. Además, así la copia sigue las mismas reglas que el resto de datos
  locales.
- Mismo patrón que la copia de mascotas (fase 7): query del servidor que pasa por la copia, copia leída
  solo sin servidor y vista combinada con «vacío confirmado», «no disponible», error del dispositivo y
  error del servidor. Marcas de lectura para las respuestas tardías.
- También se usa la copia ante un error del servidor que no es de red (el catálogo no es crítico y la
  copia sigue siendo válida). Para la lista y la ficha de mascotas no cambia nada.
- Salvaguarda nueva: si el catálogo dice que la raza elegida es de otra especie, el formulario no se
  envía. Sin conexión, la FK la rechazaría más tarde y el alta o la edición se quedaría sin sincronizar.

**Consecuencias.**
- Con el catálogo descargado alguna vez (al abrir con conexión un formulario de mascota o la ficha de
  una mascota con raza del catálogo), se busca y se elige raza sin conexión, también tras reiniciar.
- Abrir la ficha de una mascota con raza descarga el catálogo completo una vez por sesión en vez de
  pedir esa raza por id.
- Sin coordinación entre pestañas de web; las copias de cuentas que no vuelven no se limpian solas.

## 2026-10-23 — Orientación con IA: Edge Function con Gemini y reglas de urgencia

**Contexto.** El análisis orientativo con foto y señales (PRD §8.4) era la parte *Must* que faltaba. El
esquema ya lo soporta (`request_ai_analysis`, cupo, `claim_ai_analysis_for_processing`, feedback), pero no
existían la Edge Function `ai-analysis-process` ni las pantallas. Sin cambios de esquema.

**Decisiones** (proveedor elegido por David, 2026-10-23: primero OpenAI, después Gemini).
- **Gemini (Google AI Studio)** por defecto: `generateContent` con `responseMimeType: application/json`
  y `responseJsonSchema` (el mismo esquema estricto), clave en la cabecera `x-goog-api-key`, 60 s de
  límite y sin `temperature` (Google recomienda el valor por defecto en Gemini 3). Modelo por defecto
  `gemini-3.5-flash-lite` (estable, con imagen y plan gratuito; la documentación lo recomienda para
  proyectos nuevos junto a `gemini-3.8-flash`, que en la prueba real tardó 64–80 s por consulta incluso
  con razonamiento bajo, por encima del límite de 60 s; flash-lite, unos 5 s), cambiable con
  `GEMINI_MODEL` sin tocar código. El
  razonamiento se cuenta como salida. 400/401/402/403/404 → `ai_misconfigured`; 429, 5xx, bloqueo o
  respuesta cortada → `ai_unavailable`. OpenAI (Chat Completions con Structured Outputs) se mantiene
  como alternativa (`AI_PROVIDER=openai`); el proveedor es intercambiable (`providers.ts`).
- **Plan gratuito de Gemini**: según los precios de Google, el contenido del plan gratuito se usa para
  mejorar sus productos. Vale para pruebas; antes de abrirlo a usuarios hay que pasar al plan de pago o
  avisarlo en la política de privacidad (la app dice que la foto no se usa para nada más).
- **La función se autoriza sola** (JWT → uid → parámetros → `requested_by` → `service_role` → reclamar
  la fila). Una fila `processing` de más de 3 min se marca `failed` (`timeout`) para poder reintentar.
- **Datos mínimos al proveedor**: especie, raza, edad en meses, sexo, esterilizado, peso, enfermedades y
  alergias, señales, registros de 7 días (30 con historial completo) y la foto. Ningún nombre. La
  intro lo dice antes de enviar.
- **Salida validada en el servidor**: nivel conocido, máximo 4 causas y 5 recomendaciones de 240
  caracteres, y se descarta toda frase con «diagnóstico». Si no queda nada útil, `failed` (no gasta
  cupo).
- **Suelo de urgencia por reglas**: decaimiento + falta de apetito, o herida + decaimiento, nunca por
  debajo de `consult_soon`. El mínimo se le indica al modelo en el prompt y, si aun así hay que subir el
  nivel, se antepone una recomendación acorde (para que no diga «vigila unos días» junto a «pide cita»).
- **Borrador**: `PROMPT_VERSION = 'draft-2026-10-23'`. El prompt y las reglas deben revisarlos un
  veterinario antes de abrirlo a usuarios.
- **Simulador** (`AI_PROVIDER=mock`): solo se acepta si `SUPABASE_URL` es local; permite probar de punta
  a punta sin clave ni coste.
- **Frontend**: polling de la fila (sin Realtime) y una reinvocación si sigue `pending`; límite del plan
  gratuito con pantalla propia, sin paywall («esperar a Premium»); urgencias cercanas como búsqueda en
  mapas (no hay clínica propia guardada).

**Consecuencias.** Para usarlo en `kitom-dev`, David define `GEMINI_API_KEY` (y, si quiere `cost_usd`,
`AI_INPUT_USD_PER_MTOK`/`AI_OUTPUT_USD_PER_MTOK`) y despliega la función. Probado en local con el
simulador (integración y emulador) y con Gemini real (2026-10-23): orientación completa en ~2 s con
`gemini-3.5-flash-lite`; un proyecto sin saldo (402) o una llamada que pasa de 60 s quedan como `failed`
sin gastar cupo. Si la función no está desplegada o no responde, la fila se queda `pending` y **sí** cuenta
en el cupo (regla del servidor: cuenta todo lo que no es `failed`). Sin probar la subida de la foto (en
local no hay buckets).

## 2026-10-23 — Co-tutores en la app: gestión, invitaciones y configuración inicial

**Contexto.** Con la migración `20261023082848` aplicada en `kitom-dev` faltaba la interfaz de co-tutores
(PRD §8, fase 2 y solo Premium en la tabla de planes; el diseño la marcaba «Próximamente»).

**Decisiones** (David pidió terminarla, 2026-10-23).
- Pantalla por mascota con titular y co-tutores; solo quien es titular invita, cambia el permiso y quita
  el acceso. Permisos con nombres de uso: «Solo ver» (`viewer`) y «Puede editar» (`editor`).
- Invitaciones recibidas en su propia pantalla, avisadas en Hoy y en «sin mascotas». En la configuración
  inicial, quien no tiene mascotas pero sí invitaciones no está obligado a crear una: puede aceptar y
  terminar.
- **Sin límite por plan en la app**: el servidor no exige Premium para invitar y el cliente nunca decide
  el plan (CLAUDE.md). Si se quiere reservar a Premium, tiene que hacerlo una migración (pendiente de
  decisión, como el límite de mascotas).
- Tipos: las tres RPC se añadieron a mano a `database.types.ts` con las firmas que da
  `supabase gen types --local` (mismas migraciones que `kitom-dev`); regenerarlo entero desde el local
  cambia el formato de todo el archivo.

**Consecuencias.** Un co-tutor no puede dejar una mascota por sí mismo ni ver el nombre de quien es
titular (RLS). Probado en el emulador contra el Supabase local: invitar, aceptar desde la configuración
inicial, ver como co-tutora (solo lectura), cambiar el permiso y quitar el acceso.

## 2026-10-23 — Co-tutores: invitar por email sin revelar cuentas (migración)

**Contexto.** `invite_pet_member` pide el id del invitado y RLS no deja buscar usuarios; quien recibe una
invitación no puede leer la mascota ni el nombre de quien le invita (`is_pet_member` exige la invitación
aceptada; `profiles` solo propio). Sin cambios, el cliente no podía invitar ni mostrar invitaciones.

**Decisión** (aprobada por David el 2026-10-23). Tres RPC `SECURITY DEFINER`, sin tocar tablas, RLS ni las
RPC existentes: `invite_pet_member_by_email` (delega en `invite_pet_member`), `get_my_pet_invitations` y
`get_pet_members`. Para no convertirse en un buscador de cuentas, la invitación comprueba primero la
propiedad de la mascota y después responde lo mismo exista o no la cuenta, sea el propio email o haya ya
una invitación activa. No se envían emails: la invitación se ve en la app.

**Consecuencias.** La interfaz no puede confirmar que la persona tenga cuenta («si tiene cuenta, le llegará»).
Queda pendiente un límite de frecuencia de invitaciones y que un co-tutor pueda dejar una mascota por sí
mismo (hoy solo el propietario revoca). Validada en local (pgTAP); aplicada en `kitom-dev` por David.

## 2026-10-23 — Avisos exactos en Android con un módulo nativo local

**Contexto.** Los avisos de la agenda se programaban como alarmas inexactas (ventana de hasta 1 h): para
la medicación es demasiado. expo-notifications ya usa alarmas exactas cuando Android lo permite, pero
ningún módulo instalado deja consultar ni pedir ese permiso desde JavaScript.

**Decisión** (David, 2026-10-23). Declarar `SCHEDULE_EXACT_ALARM` (no `USE_EXACT_ALARM`, que Google Play
reserva a apps de alarma y calendario) y añadir un módulo local de Expo, `modules/kitom-exact-alarms`
(Kotlin, solo Android, sin paquetes nuevos), con `canScheduleExactAlarms` y `openExactAlarmSettings`. La
app lo explica y ofrece «Permitir» solo cuando los avisos están activados y el permiso no. El modo de
programación entra en la huella del aviso, así que al concederlo se reprograma todo como exacto.

**Consecuencias.** Requiere una build nativa nueva. Desde Android 14 el permiso empieza denegado y lo
concede el usuario en Ajustes; Google Play puede pedir justificar su uso (recordatorios de medicación).
Comprobado en el emulador (Android 16): sin permiso, ventana de 1 h; tras concederlo, `window=0`.

## 2026-10-21 — MVP: configuración inicial, agenda, avisos locales, logros y ajustes

**Contexto.** Con mascotas y registro diario terminados, faltaban partes *Must* del PRD que el esquema
ya soporta: aviso veterinario aceptado y configuración inicial (§8.1, §13), agenda y recordatorios
(§8.8), avisos (§8.9) y gamificación básica (§8.6). Sin cambios de esquema (ninguna migración).

**Decisiones.**
- **Configuración inicial dentro de `(app)`** (`setup/*`), no como stack separado: el layout de
  `(tabs)` redirige mientras `onboarding_completed_at` sea `NULL`. Una marca del dispositivo evita una
  petición al arrancar; sin sesión utilizable nunca se bloquea (no se encierra a nadie sin conexión).
  Las cuentas existentes pasan una vez por los pasos (deben aceptar el aviso); si ya tienen mascotas,
  terminan en Privacidad. `DISCLAIMER_VERSION = '1.0'`: cambiar el texto del aviso obliga a subirla.
- **Recordatorio que se repite = una fila.** «Hecho» avanza `due_at` a la siguiente vez futura (sigue
  `pending`) y «Deshacer» la restaura; no se crea una fila por ocurrencia (no hay columna de serie ni
  RPC, y duplicar filas complicaría editar y borrar). Consecuencia: no queda historial de cada toma de
  medicación; si se necesita, requerirá una tabla de ocurrencias (migración aparte).
- **Agenda solo con conexión** (sin copia en el dispositivo): escrituras con precondición
  `eq('updated_at', base)`; un cambio concurrente recarga la versión nueva en vez de pisarla.
- **Fechas de la agenda en hora local del dispositivo** (la de los avisos); el registro diario sigue
  usando la zona del perfil.
- **Avisos locales con `expo-notifications`** (aprobado por David, 2026-10-21): avisos de fecha concreta
  (no repetitivos) recalculados en la app, para no avisar del registro de un día ya hecho; diferencia
  con lo programado por identificador y huella. Sin push remoto ni `push_tokens` (necesitaría EAS/FCM).
- **Carga protegida de `expo-notifications`**: la última Expo Go de SDK 57 (57.0.9) no trae el módulo
  nativo `ExpoTopicSubscriptionModule` que importa el índice del paquete 57.0.23 y la app se cerraba al
  arrancar. Se carga con `require` dentro de `try` y, si falla, los avisos quedan «no disponibles» con
  un texto que lo dice. En builds nativas funciona.
- **Tema claro/oscuro/sistema como preferencia del dispositivo** (AsyncStorage), no de la cuenta (no hay
  columna, `PANTALLAS.md` §6.4). El proveedor no pinta hasta leerla (sin destello del otro tema).
- **Cambiar contraseña con «Repite la contraseña»** (tablero 10.3): la pantalla es nueva y no cambia el
  comportamiento de la recuperación. La longitud mínima sigue siendo la de Supabase Auth (sin regla
  visible, decisión del 2026-10-16 pendiente).
- **`MonthCalendar` en filas de 7 celdas `flex: 1`**: con anchos de `100/7 %` el redondeo pasaba el
  domingo a la fila siguiente en algunos anchos de contenedor (visto en la agenda).
- **Selectores de día y hora propios** (hojas con calendario y pasos de hora/minuto) en lugar de un
  paquete nativo: funcionan igual en Android, iOS y web y siguen la marca.

**Pendiente (requiere backend, migración o decisión).** Adjuntos de recordatorios (Storage), avisos por
tipo y antelación (sin columnas), señales automáticas e historial de alertas (deben venir del servidor),
orientación con foto (Edge Function `ai-analysis-process`), invitar co-tutores (no hay forma de buscar un
usuario por email: `invite_pet_member` pide su id), límite de mascotas del plan gratuito (el servidor no
lo aplica), exportar/eliminar la cuenta, Premium y la clínica propia.

## 2026-10-21 — Pets offline, fase 8.5: cierre de sesión con todas las fuentes y endurecimiento

**Contexto.** En la validación manual de la fase 8 (emulador Android y web contra el Supabase local) se
reprodujeron varios defectos. El cierre de sesión solo contaba los registros diarios: con altas o
ediciones de mascotas pendientes y ningún registro, cerraba sin preguntar. El formulario bloqueaba el
envío sin conexión. Las ediciones de mascotas que ya no se ven no aparecían en ningún sitio. Y sin el
catálogo de razas no se podía escribir la raza a mano.

**Decisión.**

- El flujo de cierre de sesión (`sign-out-flow.ts`, sin cambios de comportamiento) recibe un resumen de
  las dos fuentes (`createAppSignOutFlow` en `unsynced-changes.ts`) y se monta en un proveedor propio
  (`features/auth/sign-out-provider.tsx`) dentro de los de Daily Logs y Pets; deja de vivir en el de
  Daily Logs.
  - Cuentan como no sincronizadas: altas, ediciones, enviadas sin confirmar, conflictos, fallidas,
    sin permiso e ilegibles.
  - «Sincronizar y cerrar» cierra solo si el total es 0.
  - Si un almacén no se puede leer, se pide decisión.
- `PetForm` ya no bloquea el envío con `offline`: solo avisa.
- La lista de mascotas muestra aparte las ediciones de mascotas que ya no devuelve el servidor
  (`orphanedEdits`).
- El selector de razas ofrece el texto libre aunque el catálogo no cargue. `formatBreed` muestra «Con
  raza» si no conoce el nombre de una raza del catálogo.
- No se cambia la precondición `updated_at`. El límite de dos `now()` iguales se documenta y se propone
  una fase `db/` con columna de versión. Se descartó comparar todas las columnas en el `WHERE` sin
  migración: es frágil con listas de texto.
- No hay coordinación entre pestañas en web. La idempotencia evita duplicados; la ventana restante
  queda documentada.

**Consecuencias.** El cierre de sesión ya no puede ocultar operaciones de mascotas: ni cierra sin
avisar ni las descarta, y cada cuenta conserva las suyas aisladas. El resultado de la validación
manual está en `FRONTEND_ARCHITECTURE.md` §5 («Validación y endurecimiento (fase 8.5)»).

## 2026-10-21 — Pets offline, fase 8: altas y ediciones guardadas en el dispositivo

**Contexto.** Con la fase 7 se podían ver mascotas sin conexión, pero no crearlas ni editarlas. La
migración del 2026-10-20 (`client_request_id`) hace el alta idempotente. Ya está aplicada en
`kitom-dev` (lo hizo el usuario) y los tipos están regenerados.

**Decisión.**

- Una operación local por mascota en `LocalStore` (`pet-ops`): alta con id local `local-<uuid>` o
  edición con su fila base. Contenido editable validado, `operationId` estable, estado, intentos, último
  error e `inFlightSince`. Las ediciones se consolidan en una operación. El alta confirmada queda como
  mapeo persistente `localId → petId`.
- Un motor propio (`pet-sync-engine.ts`) con las reglas del de Daily Logs: guardar es local, envía el
  motor, una pasada a la vez, sesión y token del dueño, backoff y 401 hasta una sesión nueva. El motor
  de Daily Logs no cambia; se reutilizan la clasificación de errores, el backoff, los disparadores y las
  sesiones por usuario.
- Alta: el `INSERT` con `client_request_id`. Un reenvío da `23505` y se lee por la clave, así que no se
  repite nunca a ciegas sin la clave. Edición: compare-and-set con `updated_at`. Ante 0 filas, la fila
  leída decide si ya está, si no hay permiso, si se reaplica o si hay conflicto; un conflicto lo decide
  el usuario por grupos de campos, sin unir textos. Nada se marca sincronizado sin la fila del servidor.
- Las mascotas pendientes de crear no tienen registros diarios hasta existir en el servidor (decisión
  del usuario). Así ningún registro queda con un id temporal y el motor de Daily Logs no cambia.
- El alta y la edición online pasan por el mismo camino (dispositivo → motor) y esperan hasta 5 s a la
  confirmación. Se retiran `useCreatePet` y `useUpdatePet`. Borrar sigue siendo online, y la foto se
  sube tras la confirmación del alta.
- Esto modifica la fase 7: los formularios se abren sin conexión si hay datos con qué rellenarlos,
  editando también sobre la copia del dispositivo (la precondición detecta si cambió). Para eso se
  guarda en el dispositivo el catálogo de especies. Se descartó guardar el de razas (tamaño, y es
  opcional).
- `Pet` es la fila sin `client_request_id`: la app no la lee.

**Consecuencias.**
- Crear y editar funcionan sin conexión, con estados visibles y recuperación tras perder la respuesta o
  cerrar la app.
- Garantías reales:
  - Un alta no se duplica.
  - Una edición nunca pisa un cambio del servidor en los mismos campos.
  - Lo que el servidor rechaza se conserva.
- Límites:
  - Una mascota borrada en otro dispositivo antes de recuperar la respuesta se vuelve a crear.
  - El aviso de cerrar sesión no cuenta las operaciones de mascotas (se conservan). Corregido en la fase 8.5.
  - Sin conexión, la raza del catálogo solo se puede elegir si se cargó en la sesión.

## 2026-10-20 — Pets: clave de cliente para el alta idempotente (migración, fase 8)

**Contexto.** La fase 8 (crear y editar mascotas sin conexión) envía al volver la red el alta guardada
en el dispositivo. Si el servidor la crea pero la respuesta se pierde, el cliente no puede saber si
existe: `authenticated` no puede fijar `pets.id` (no tiene GRANT de INSERT sobre `id`; comprobado en
local: `42501`), no hay más restricción única que la PK, ni columna de clave de operación, ni RPC de
alta. Repetir el `INSERT` podría duplicar la mascota y buscarla por contenido es heurístico (la petición
puede seguir en curso en el servidor y dos mascotas iguales son legítimas).

**Decisión.**

- Migración `20261020135440_pets_client_request_id.sql`: `pets.client_request_id uuid` (nullable), índice
  único parcial `(owner_id, client_request_id)` y `GRANT INSERT (client_request_id)` (sin UPDATE). El
  cliente genera la clave por alta (UUID v4, `createOperationId`) y la guarda con la operación; reenviar
  el alta es siempre seguro: `23505` en `pets_owner_client_request_id_key` → se lee la fila por la
  clave. Ligada al propietario (no revela claves de otras cuentas). RLS, triggers e `id` sin cambios.
- Descartado `GRANT INSERT (id)`: los objetos de Storage de una mascota borrada se quedan en
  `{pet_id}/…`, y quien conociera ese id (p. ej. un antiguo co-tutor) podría crear otra mascota con el
  mismo id y pasar `is_pet_member` sobre esas fotos. Descartada también una RPC `create_pet` con tabla de
  claves (más backend que mantener para lo mismo) y la reconciliación por contenido sin backend
  (heurística; puede duplicar por decisión del usuario).
- Ediciones sin cambios de esquema: `update … where id = … and updated_at = <base>` es un compare-and-set
  atómico (0 filas si otra escritura cambió la versión; también 0 sin permiso, por RLS: el cliente lo
  distingue leyendo la fila y `can_edit_pet`). Probado con sesiones simultáneas reales
  (`supabase/tests/concurrency/pets_concurrency.sh`).
- Daily Logs: una mascota pendiente de crear no admite registros diarios hasta existir en el servidor
  (no se cambia el motor de Daily Logs ni queda ningún registro con un id temporal).

**Consecuencias.** PR `db/` propio; el usuario aplica la migración en `kitom-dev` y se regeneran los
tipos antes de usar la columna en el frontend. Límite: si la mascota se creó y otro dispositivo la
borró antes de que este recupere la respuesta, el reenvío la vuelve a crear (no es un duplicado).

## 2026-10-20 — Pets offline, fase 7: copia de solo lectura de la lista y las fichas

**Contexto.** Hasta ahora Pets solo funcionaba con conexión: en un arranque en frío sin red (o con la
sesión `offline`) la lista daba «No hay conexión», la ficha un error y las pestañas no tenían mascota
activa; los registros diarios se alcanzaban sin nombre desde «Registros guardados en este
dispositivo». Esta fase permite **leer** mascotas sin conexión; las escrituras siguen necesitando el
servidor.

**Decisión.**

- Copia en `LocalStore` (sin abstracción nueva), por usuario y validada al leer: `pets:<petId>`
  (`{ pet, savedAt, unavailableAt }`, solo las columnas de `PET_COLUMNS`) y `pets-list:current`
  (`{ savedAt, petIds }`). La lista sin guardar = «nunca cargada»; `petIds: []` = vacía confirmada por
  el servidor. Ni URLs firmadas, ni `can_edit_pet`, ni tokens. Lo ilegible es un error recuperable,
  nunca una lista vacía, y la siguiente respuesta correcta lo sustituye (es copia de datos del
  servidor). Nada se borra solo: una mascota que el servidor deja de devolver conserva su copia con
  `unavailableAt` (y sus Daily Logs locales no se tocan); cambiar de cuenta no borra las copias de otras.
- Solo entran respuestas correctas, autenticadas como el dueño y con su sesión aún vigente: lecturas con
  el token del dueño fijado en la cabecera (`createOwnerAccessToken`, como el motor de Daily Logs),
  siempre por `serverCall`, y se guardan solo si `isCurrentUser(userId)` al terminar. Un error, la
  sesión sin comprobar o una respuesta de otra cuenta nunca llegan al almacén.
- Orden: marca de lectura en memoria antes de cada petición (como Daily Logs). Por mascota manda la
  lectura iniciada más tarde para la visibilidad, pero los datos no retroceden por `updated_at`; una
  respuesta tardía solo entra si trae un `updated_at` estrictamente posterior de una mascota visible.
  `updated_at` no basta (lo pone `now()`, inicio de la transacción, y no cambia con la visibilidad): la
  estrategia conservadora no sustituye datos con una respuesta cuya actualidad no se puede demostrar, y
  la siguiente lectura corrige un orden equivocado.
- Lista y ficha: `enabled: canUseServer` además de `serverCall` (en `offline` no se ejecuta ningún
  `queryFn`). Modifica, solo para estas dos queries, lo descartado el 2026-10-16 («`enabled: false` las
  deja cargando para siempre»): la vista combinada (`pet-view.ts`) trata «pendiente sin servidor» como
  sin conexión y muestra la copia. Al recuperar la sesión hay una sola petición (la invalidación de
  AuthProvider llega antes de que se habiliten). `can_edit_pet` y la racha no cambian.
- Query keys de la lista y la ficha con `userId` (como Daily Logs). La caché de TanStack Query sigue
  sin persistirse.
- Escrituras: crear, editar, borrar y fotos siguen necesitando conexión; sin ella se avisa y no se
  puede enviar (sin cola). Sin conexión no se ofrecen editar ni la foto (el permiso no se puede
  comprobar) y la edición nunca se abre sobre la copia. Las filas devueltas por crear, editar y borrar
  actualizan la copia; el flujo de fotos no cambia (la lista invalidada trae el `photo_path` nuevo).
- Foto sin conexión o con la URL caducada: «no disponible», sin tocar `photo_path`.

**Consecuencias.** Las pestañas, la lista, la ficha y el nombre en los registros funcionan sin conexión
con datos posiblemente desactualizados (se avisa con la fecha). Una mascota creada o compartida en otro
dispositivo no aparece sin conexión hasta que se lea con conexión. La copia de cuentas que no vuelven
sigue en el dispositivo (limpieza pendiente, como la de Daily Logs). Contrato:
`FRONTEND_ARCHITECTURE.md` §5 «Pets sin conexión (fase 7)».

## 2026-10-20 — Revalidación al reconectar en móvil (modifica la decisión del 2026-10-13)

**Contexto.** El 2026-10-13 se fijó `networkMode: 'always'` en móvil y, para no cambiar nada más, no se
activó la revalidación al reconectar (con `always`, TanStack Query la desactiva por defecto). Al probar
la fase 6.5 en el emulador, con el token vigente la sesión nunca pasa por `offline` (no hay
invalidación al recuperarla) y la lista de mascotas que falló sin red se quedaba en «No hay conexión»
tras volver la red, hasta pulsar «Reintentar». Con el token caducado no pasaba (AuthProvider vuelve a
pedir las queries al recuperar la sesión).

**Decisión.**

- `refetchOnReconnect: true` en las opciones por defecto de las queries **solo en móvil**
  (`lib/query-defaults.ts`). Al volver la red se vuelven a pedir las queries caducadas con
  observadores, como ya hacía web. `networkMode: 'always'` no cambia, ni las mutaciones (no quedan en
  pausa ni se reenvían solas) ni nada de web.
- Requisito: ninguna query de servidor sale sin sesión utilizable. Todas pasan por `serverCall`
  (también la de zona horaria, que solo se apoyaba en `enabled`): en `offline` o con la sesión sin
  comprobar, la revalidación falla al instante sin enviar nada.
- Sin peticiones duplicadas: con red, primer plano y recuperación de la sesión a la vez, TanStack
  Query reutiliza la petición en curso, y la invalidación de AuthProvider solo sustituye intentos que
  `serverCall` ya había cortado sin red (probado contra `@tanstack/query-core` con el controlador de
  sesión). Se descartó invalidar al reconectar desde AuthProvider (duplicaría a TanStack Query) y
  reintentar solo la lista de mascotas (el problema es de todas las queries).
- Daily Logs no cambia: sus lecturas del servidor pasan por el almacén local (una lectura tardía no
  retrocede la versión), sus queries locales tienen `staleTime: Infinity` (no se releen al reconectar)
  y las escrituras siguen siendo solo del motor, con precondición.

**Consecuencias.** Al reconectar en móvil puede haber algunas peticiones más (solo de queries caducadas
y en pantalla). La decisión del 2026-10-13 queda modificada en ese punto; el resto sigue vigente.

## 2026-10-19 — Daily Logs offline, fase 6.5: estabilización de la sesión en móvil

**Contexto.** En la fase 6 la renovación tras recuperar la red tardó 25,7 s y se añadió un reintento
cada 30 s sin volver a medir, con la premisa de que en móvil el temporizador de renovación de
supabase-js solo arranca con un cambio de `AppState`. Medido ahora contra el Supabase local con
supabase-js real (`FRONTEND_ARCHITECTURE.md` §5 «Estabilización de la sesión (fase 6.5)»): esa premisa
es falsa (auth-js arranca su temporizador al inicializarse fuera del navegador) y la espera venía de que,
sin red, el temporizador de auth-js y el reintento de la app intentaban renovar cada pocos segundos;
cada intento fallido bloquea las renovaciones 60 s, así que al volver la red casi siempre había que
esperar ese bloqueo (25–51 s).

**Decisión.**

- No intentar renovar mientras el sistema dice «sin conexión»: el temporizador de auth-js corre solo en
  primer plano y con conexión (`lib/auto-refresh-gate.ts`) y el controlador solo intenta con conexión y
  en primer plano. Al volver la red la renovación sale al momento (0,12 s medidos).
- Mantener el reintento periódico existente (no uno nuevo) pero cada 5 s y solo con conexión: durante el
  bloqueo de auth-js no genera peticiones (fallo guardado y una renovación compartida, probado contra
  auth-js real) y acorta lo que se tarda en notar que terminó. Se descartó quitarlo y depender del
  temporizador de auth-js (hasta 30 s más por su fase) y calcular el fin del bloqueo (depende de una
  constante interna y de fallos que la app no ve).
- Sesión rechazada: nunca se reintenta; si auth-js no pudo borrarla, se quita del dispositivo.
- Las respuestas de error no JSON a la renovación cuentan como fallo de red (`lib/auth-refresh-fetch.ts`):
  auth-js borraría la sesión por un 403 en HTML de un proxy (probado). Se descartó cambiar el código de
  estado o tocar otras rutas de Auth.
- Identidad coherente también con la sesión de Supabase (`sub` del token = `user.id`); el troceado de
  SecureStore pasa a un módulo puro (`lib/chunked-storage.ts`) sin cambiar formato ni orden de escritura
  (escribir el recuento al final hace que una lectura concurrente durante una renovación vea la sesión,
  no «ninguna»).

**Consecuencias.** Sin cambios de BD ni de dependencias. Quedan limitados por el bloqueo de 60 s de
auth-js: la red que vuelve dentro del primer minuto tras un arranque sin conexión con el token caducado,
la sesión revocada y los fallos repetidos del servidor. En web el temporizador sigue gestionado por
auth-js. Detectado en el emulador: en móvil TanStack Query no volvía a pedir las queries al reconectar
(decisión del 2026-10-13); resuelto en la entrada del 2026-10-20.

## 2026-10-19 — Especie bloqueada al editar y limpieza de lo que no se usa

**Contexto.** El tablero 3.8 pide la especie bloqueada al editar una mascota, pero el usuario puede
haberse equivocado al crearla. Tras F3–F5 quedaban sin uso la capa de compatibilidad de F0, 21 textos y
el paquete `expo-device` (de la plantilla de Expo; no lo importa nada ni lo necesita otro paquete).

**Decisión.**

- La especie se muestra bloqueada y se puede corregir con «¿Te has equivocado? Cambiar la especie»,
  tras una confirmación que explica que la raza elegida se borra. Solo cambia la presentación: la
  escritura es la misma (`species_id` en el update de `pets`).
- Se retiran `components/themed-text.tsx`, `constants/theme.ts`, los nombres de color antiguos de
  `useTheme()`, las claves de i18n sin uso y `expo-device`. Se conservan los originales SVG del kit de
  marca (`frontend/assets/brand/`, fuente de los PNG y del futuro icono de notificación) y las
  dependencias que pide `expo-router` (`@expo/ui`, `expo-glass-effect`, `expo-symbols`) o que usan web,
  el router y Reanimated sin importarse directamente.

**Consecuencias.** `useTheme()` devuelve solo tokens. Para volver a usar `expo-device` (p. ej. con los
avisos push) hay que instalarlo de nuevo con `npx expo install`.

## 2026-10-19 — Diseño v2, F3–F5: navegación, Hoy, mascotas, registro e historial

**Contexto.** Los tableros 3–6 y 10.1 piden una barra de cinco posiciones, Hoy con la semana, el
registro en dos pasos con detalles de tres opciones, historial con gráficos y perfil de mascota. Había
que hacerlo sin cambiar URL, contratos de Supabase ni el modo offline, y sin mostrar datos o acciones
que no existen.

**Decisión.**

- Navegación: grupo `(app)/(tabs)` con `Tabs` de `expo-router/js-tabs` y barra propia (`TabBar`). Hoy
  sigue en `/`; nuevas `/history`, `/agenda`, `/profile` y `/settings`. «Registrar» es una acción que
  abre el registro de hoy como modal. Las rutas de `pets/...` no cambian.
- Mascota activa en React Context, recordada por usuario en el dispositivo (`local-store`); si ya no es
  visible, la primera. No se guarda en el servidor.
- Registro: al crear, las 4 principales son obligatorias; al editar, «no vacío» como antes. Detalles con
  tres opciones guardadas como 2/3/4, sin convertir los 1/5 ya guardados (aprobado por el usuario).
- Sin backend o sin decisión, no se muestra o se marca «Próximamente» sin acción: Agenda, señales y
  alertas, «Consultar», voz de la mascota, idea del día, logros/insignias, co-tutores, informe,
  límites del plan y la mayor parte de los ajustes.
- La racha del perfil sale de `pet_streaks` (servidor); la de Hoy, de los registros cargados
  (servidor + dispositivo), para que cuente lo guardado sin conexión. Ninguna se rellena ni se estima.
- Confirmación de salir sin guardar con `beforeRemove` (`useLeaveConfirmation`), sin dependencias.

**Consecuencias.** Las pestañas Agenda y Perfil quedan preparadas para recordatorios, logros y
consultas cuando existan sus servicios. En web, sin conexión las consultas se pausan (`query-defaults.ts`),
así que el flujo sin conexión del registro solo se puede validar en nativo.

## 2026-10-16 — Diseño v2, F2: pantallas de acceso

**Contexto.** Los tableros 1.3–1.9 cambian la composición de login, registro, recuperar y nueva
contraseña, y añaden elementos que hoy no tienen soporte. F2 no debía cambiar la lógica de sesión,
los contratos de Supabase, la protección de rutas ni los enlaces de retorno.

**Decisión.**

- Misma lógica y mismos mensajes de error; cambian la composición y los textos de títulos, subtítulos
  y botones (los del prototipo, en `es` y `en`). El error se muestra en su campo cuando es de un campo
  (`authErrorField`); `missing_fields` y los de red o servidor, en una alerta sobre el botón.
- Registro con confirmación pendiente y recuperación enviada pasan a un estado de pantalla completa
  («Revisa tu correo», «Enlace enviado») en vez de un mensaje bajo el formulario; «Cambiar el email»
  vuelve al formulario con los datos.
- Sin cabecera nativa en `(auth)`: barra propia con «Volver» solo si hay historial. En nueva
  contraseña, «atrás» es «Cancelar y cerrar sesión» (mismo efecto que el botón anterior).
- No se implementa lo que no tiene soporte o cambiaría el comportamiento: acceso con teléfono (Auth
  sin OTP), botón «atrás» del login a la bienvenida (no existe), texto legal con enlaces (no hay
  páginas legales), «Reenviar enlace» y «Abrir mi correo» (sin API ni librería), repetir la contraseña
  nueva y la regla visible «Mínimo 8 caracteres» (el mínimo real lo fija Supabase Auth: 6 en local,
  sin confirmar en `kitom-dev`).

**Consecuencias.** Los elementos omitidos quedan pendientes de decisión (y, algunos, de backend). Si se
decide una longitud mínima, debe fijarse en Supabase Auth y mostrarse la misma en la app.

## 2026-10-16 — Pruebas contra el Supabase local sin tocar `.env`

**Contexto.** Para validar pantallas con sesión hace falta un backend; usar `kitom-dev` arriesga
escrituras en el remoto. `frontend/.env` apunta al remoto y no se debe modificar.

**Decisión.** `npm run start:local` pasa la URL y la clave anónima del Supabase local como variables
del proceso (prioridad sobre `.env*` en Expo) y, antes de arrancar Metro, verifica con `@expo/env` el
endpoint efectivo, que sea `127.0.0.1`/`localhost` y que responda; ante cualquier duda termina sin
arrancar. Siempre con `--clear`. Se descartó un `.env.local` (lo cargaría también `npx expo start`
normal y un descuido lo haría persistente) y cambiar `.env` (prohibido).

**Consecuencias.** Las cuentas de prueba se crean en local desde la app. En el emulador Android hace
falta `adb reverse` para llegar al Supabase local; en un móvil físico no se puede usar.

## 2026-10-16 — Diseño v2, F1: componentes de marca

**Contexto.** F1 crea los componentes compartidos que usarán las pantallas de acceso, mascotas y
registro. El prototipo (`kitom.css`) y las fichas dan medidas y estados; había que fijar cómo se
implementan en React Native sin dependencias nuevas.

**Decisión.**

- Solo los componentes con uso previsto en F2–F4 (ver `frontend/CLAUDE.md` › «Tema y diseño»). Quedan
  para su fase: StreakRing y la animación del punto de hoy (F4/F5), TrendChart, OtpInput, Medal,
  UrgencyTag. Las APIs de `Button`, `TextField`, `OptionGroup`, `FormMessage` y `query-state` se
  mantienen (salvo `variant="link"`, que pasa a `ghost`), así las pantallas actuales adoptan el diseño
  sin reescribirse.
- Cuando la ficha y el prototipo difieren, manda el prototipo (p. ej. botón deshabilitado sobre fondo
  hundido, no por opacidad; alertas de información y aviso con los tonos del tablero 0.1).
- Iconos Lucide importados uno a uno en `components/ui/icons.ts`; ESLint prohíbe la raíz del paquete
  (Metro no descarta código: serían ~1.900 iconos en el bundle).
- Sombras como `boxShadow` (nueva arquitectura: iOS, Android y web) generadas desde los tokens de
  elevación; en oscuro, filete. Las props `shadow*` están obsoletas en web.
- Superposiciones con `Modal` y entradas de Reanimated (200 ms, `ReduceMotion.System`); sin gestos de
  arrastre (no aprobados). Toast con proveedor propio en el layout raíz, solo para éxitos.
- Galería `/dev-components` solo en desarrollo (`Stack.Protected guard={__DEV__}`), única excepción a la
  regla de i18n.

**Consecuencias.** Las pantallas ya tienen la apariencia básica de marca, pero su composición sigue
siendo la anterior hasta F2–F4. El nombre de color antiguo `danger` se retiró (tapaba al token en
oscuro); el compilador impide que otro nombre antiguo coincida con un token.

## 2026-10-16 — Diseño v2, F0: tema por contexto, fuentes de marca y migración por capas

**Contexto.** El frontend usaba la paleta y las fuentes de la plantilla de Expo (`constants/theme.ts`,
`ThemedText`) en ~30 archivos. El diseño v2 trae tokens generados para React Native y pide adaptar las
pantallas por fases sin perder funcionalidad.

**Decisión.**

- Tokens copiados tal cual a `frontend/src/theme/tokens.ts` (siguen siendo generados).
  `AppThemeProvider` (React Context) elige claro/oscuro con `useColorScheme()` y también fija el tema de
  Expo Router y el fondo de la ventana. La preferencia manual se añadirá con la pantalla de ajustes; no
  se guarda nada hasta entonces.
- Fuentes con `@expo-google-fonts/*` importadas por peso (solo los 4 cortes de los tokens) y cargadas
  en tiempo de ejecución con `useFonts`: funciona en Expo Go, sin build nativo. El splash espera a las
  fuentes; si fallan, la app arranca con las del sistema.
- Migración por capas: `useTheme()` y `ThemedText` mantienen su API anterior, pero ya resuelven a
  tokens; así toda la app cambia de paleta y tipografía a la vez, y cada pantalla pasa a los componentes
  del diseño en su fase. Se descartó reescribir todas las pantallas de golpe (diff enorme y difícil de
  revisar, en particular en el código offline de Daily Logs).
- Dependencias: `react-native-svg` 15.15.4 (la del SDK 57), `lucide-react-native` 1.58 y las dos de
  fuentes; instaladas con `npx expo install`, sin actualizar nada más.

**Consecuencias.** Hasta terminar F4 conviven los nombres de color antiguos y los tokens; los antiguos
no se usan en código nuevo y se retiran al final. `ThemedText` limita sus tipos a los usados
(`default`, `small`, `smallBold`, `subtitle`).

## 2026-10-16 — Diseño v2: navegación, orden del primer uso y tokens de gráficas

**Contexto.** El diseño completo de la app (`docs/design/`, 90 pantallas) tenía que fijar la barra
inferior, dónde vive la orientación con IA y el orden del primer uso. David delegó la elección de la
barra («usa la que creas que es mejor»).

**Decisión.**

- Barra: Hoy · Historial · Registrar · Agenda · Perfil. «Registrar» es una acción central que abre el
  registro de hoy a pantalla completa, no un destino. Se descartó «Consultar» como pestaña: el PRD v2
  pone el hábito diario en el centro y la IA como paridad; «Consultar» va en la cabecera de Hoy, en
  las señales, en Alertas y en el perfil de la mascota. «Tendencias» pasa a llamarse «Historial».
- Primer uso: bienvenida → cómo funciona → cuenta → verificación → perfil → aviso veterinario →
  privacidad → primera mascota → recordatorio diario → permiso de avisos → primer registro. El aviso
  va después de la cuenta porque se guarda en `profiles.disclaimer_accepted_at` (coincide con
  `FRONTEND_ARCHITECTURE.md` §1).
- Gráficas: cinco series con dos tokens nuevos, `chartActivity` (#6B7A1F / #B9C46A) y `chartSleep`
  (#7B5EA7 / #C2A8E8), contraste ≥ 4,5:1 sobre el fondo claro y oscuro de las tarjetas; máximo tres
  series a la vez y trazo distinto por serie para no depender del color.
- Tema y voz de la mascota: preferencias locales del dispositivo (no hay columnas).

**Consecuencias.** `FRONTEND_ARCHITECTURE.md` §1 describe destinos lógicos; la barra concreta está en
`docs/design/PANTALLAS.md` §1. Las diferencias del diseño con la BD están en `PANTALLAS.md` §6 y no se
implementan sin decisión o migración aprobada.

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
  la revalidación al reconectar en móvil (**modificado el 2026-10-20**: ahora sí, ver esa entrada).
  En web no se cambia el modo que ya tenía. Auth y la zona
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

- La raza se pregunta en dos pasos: estado (_Con raza_ / _Mestizo_ / _Sin raza_) y, solo con raza,
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
