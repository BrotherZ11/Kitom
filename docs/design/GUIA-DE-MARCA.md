Kitom acompaña el día a día de una persona y su animal: registrar cómo está, entender sus cambios y saber cuándo hace falta un veterinario. La identidad se llama **Ritmo**: cuidar bien es una suma de días. Todo lo visual nace de dos ideas. El **símbolo** dibuja la K de Kitom con una oreja y una cola, las dos señales con las que un animal dice cómo está. El **anillo semanal** (seis días y el punto de hoy) es el lenguaje del hábito: racha, resumen de la Home y gráfico de la semana. Kitom está dedicada a Atom y Kika, los perros de quien la creó.

## Atributos

- **Cercanía**: hablamos de la mascota por su nombre y celebramos lo que hacéis juntos.
- **Tranquilidad y confianza**: orientamos sin alarmar y sin diagnosticar; las urgencias son inequívocas.
- **Calidad**: pocas piezas, bien hechas, iguales en toda la app.
- **Cuidado responsable**: siempre que haga falta, derivamos al veterinario.

## Logo

- Usa `kitom-logotipo` (el símbolo hace de K y el punto sol es el punto de la i) en splash, onboarding, web y materiales. Es la versión principal y la horizontal.
- Usa `kitom-simbolo` (versión compacta) cuando el espacio sea cuadrado o menor de 72 px de ancho: icono de app, cabecera compacta, avatar.
- Por debajo de 32 px usa `kitom-simbolo-pequeno`, el corte óptico para tamaños pequeños: trazo más grueso (9/64), oreja más corta, cola más abierta y punto sol mayor, para que no se empaste. Es el que llevan el favicon y el icono de notificación de Android.
- Sobre fondos oscuros o `laguna-900` usa las versiones `-inverso`. Para una sola tinta (grabados, fax, documentos en blanco y negro) usa `-mono-tinta` o `-mono-blanco`.
- Deja alrededor un espacio libre igual a la altura del punto de la i multiplicada por dos. Tamaño mínimo: símbolo 16 px de alto (con el corte pequeño); logotipo 72 px de ancho.
- Construcción (versión 1.0, cerrada): rejilla de 64 con trazo 7 y terminaciones redondas. El asta mide 46 unidades; el texto «ıtom» es Hanken Grotesk SemiBold convertido a trazados. En el logotipo el símbolo va al 95 %, sin su punto; entre la cola y la ı hay el mismo aire que entre la ı y la t, y el punto sol (diámetro 8) es el punto de la i. Los archivos de `logos/` son la única referencia: no se redibuja ni se compone a mano.
- El punto es siempre `accent` (sol) en las versiones a color. Es "hoy": no lo cambies de color ni lo quites salvo en las versiones mono.
- No rotes, no deformes, no añadas sombras, contornos ni degradados, no cambies la tipografía del logotipo y no escribas "kitom" en texto junto al símbolo (el símbolo ya es la K).

## Icono de app

- iOS: `app-icon-ios` (1024 px, fondo `laguna-900`, símbolo `niebla-100` y punto `accent`). iOS aplica el redondeo.
- Android: icono adaptativo con `android-adaptive-foreground` (símbolo dentro de la zona segura de 66 dp) sobre `android-adaptive-background` (`laguna-900`), más `android-monochrome` para los iconos temáticos de Android 13+.
- Splash: `splash-icon` (símbolo `laguna-900` sobre `bg`).
- Notificaciones de Android: `android-notification` (corte pequeño en blanco sobre transparente, 96 px; Android lo tiñe).
- Web: `favicon` (corte pequeño sobre `laguna-900`, 64 px).

## Color

- Fondo de pantalla `bg`; tarjetas y campos `surface`; diálogos y hojas `surface-raised`. Texto en `ink` y secundario en `ink-muted`.
- `primary` (laguna) es la única tinta de acción: botón principal, pestaña activa, enlaces, foco y la serie de energía.
- `accent` (sol) se reserva para "hoy", rachas e insignias. Es relleno, nunca texto sobre claro: para texto en tono sol usa `accent-ink`.
- `surface-warm` con `warm-ink` es la voz de la mascota y las celebraciones. `surface-brand` marca selección y paneles suaves.
- Los cuatro colores de urgencia (`observe-*`, `routine-*`, `vet-*`, `urgent`) significan solo urgencia veterinaria. No los uses para decorar, para gráficos ni para errores de sistema (para eso están `success-*` y `danger*`).
- Nada de degradados ni de más de un acento por pantalla.
- Tema oscuro completo: cada token tiene valor claro y oscuro. Todo par texto/fondo de la guía cumple 4,5:1 en los dos temas; marcas, bordes de control e iconos, 3:1. `ink-subtle` solo para placeholders y deshabilitados.

## Tipografía

- Hanken Grotesk para toda la interfaz; IBM Plex Mono solo para cifras, fechas, unidades y antetítulos (`data-*`, `overline`).
- Un `display` como máximo por pantalla. Títulos de pantalla en `title-1`, secciones en `title-2`, tarjetas en `title-3`, texto en `body`.
- Frases en minúscula inicial normal (sentence case). Nunca todo en mayúsculas salvo `overline`.
- Respeta el tamaño de texto del sistema; los controles limitan el escalado a 1,6×. Ningún texto se trunca a una línea si puede envolver.

## Espaciado, forma y superficies

- Rejilla de 4 px: `space-1` a `space-16`. Margen lateral de pantalla `space-5` (20); relleno de tarjeta `space-4`; entre bloques `space-6`.
- Radios: `radius-md` para botones y campos, `radius-lg` para tarjetas, `radius-xl` para hojas y diálogos, `radius-xs` para etiquetas, `radius-full` para avatares.
- Tarjetas `surface` con `elevation-1`; en tema oscuro la elevación es un filete claro, no una sombra. Tarjetas planas (`border-hairline` en `line`) dentro de otras tarjetas.
- Áreas seguras siempre (react-native-safe-area-context). El botón principal de una pantalla va abajo, a `space-3` del área segura.

## Iconografía

- Lucide (lucide-react-native, pendiente de instalar) con trazo 2 px, terminaciones redondas y rejilla de 24. Tamaños `icon-xs` a `icon-lg`; por defecto `icon-md`.
- Iconos fijos: Hoy `home`, Historial `chart-line`, Registrar `plus`, Agenda `calendar`, Perfil `user`, Consultar `camera` (botón de cabecera); urgencias `eye`, `refresh-cw`, `stethoscope`, `triangle-alert`.
- Un icono nunca va solo si transmite un estado: siempre con texto o `accessibilityLabel`.
- Nada de huellas, huesos ni siluetas de perro y gato como decoración. El único motivo animal es el símbolo.

## Imagen

- Fotografía real de la mascota del usuario, siempre protagonista: luz de día, en casa o de paseo, a la altura del animal. Recortes circulares en avatares y `radius-xl` en cabeceras.
- Fotografía de marca (tiendas, web): documental, tonos verdes y arena, personas solo como manos o de espaldas. Nunca animales de estudio con fondo blanco ni stock con filtros.
- Ilustración solo de línea fina en `ink` para explicar posturas y señales en la orientación (orejas, cola, postura), sin caras ni expresiones de dibujo animado.

## Movimiento

- `duration-fast` (120 ms) para pulsaciones, `duration-base` (200 ms) para transiciones de pantalla y hojas, `duration-slow` (320 ms) para completar el día. Curva estándar `0.2, 0, 0, 1`.
- Un único momento de celebración: el punto de hoy se rellena al guardar el registro. Sin confeti. Con "reducir movimiento", cambios instantáneos.

## Voz y tono

Hablamos como una amiga que sabe de animales: cercana, tranquila y clara. Tuteamos. Usamos el nombre de la mascota. Frases cortas, verbos concretos, cero tecnicismos.

- **Nunca** "diagnóstico", "diagnostica", "detectamos enfermedades". Sí "orientación", "posibles causas", "señales de alerta".
- Cada resultado de orientación termina con: "Esta orientación es informativa y no sustituye a un veterinario."
- Sin alarmismo y sin culpa: "Notamos que Kika ha comido menos estos 3 días. ¿Quieres añadir detalles o ver posibles causas?"
- En urgencias, directo y sin suavizar: "Lleva a Atom al veterinario ahora."
- Voz de la mascota (opcional, activable en ajustes): primera persona, una frase, nunca en alertas ni en resultados de orientación. "Hoy he dormido mucho. ¿Paseo largo?"
- Botones con verbo + objeto: "Registrar el día", "Guardar cambios", "Llamar a mi clínica".

### Microcopy

| Momento | Texto |
|---|---|
| Home, día pendiente | Falta el registro de hoy · Unos 40 segundos |
| Registro guardado | Hecho. Kika lleva 5 de 7 días esta semana. |
| Racha rota | Empezáis otra racha hoy. |
| Sin conexión | Guardamos el registro en el móvil y lo subiremos al volver la conexión. |
| Conflicto de edición | Alguien ha editado este registro. Revisa los cambios antes de guardar los tuyos. |
| Foto para orientación | Evita que salgan personas en la foto. |
| Error de carga | No hemos podido cargar el historial. Revisa la conexión. |

### Notificaciones

| Tipo | Título | Texto |
|---|---|---|
| Recordatorio diario | ¿Qué tal ha ido el día de Kika? | Un minuto para tu registro de hoy. |
| Patrón detectado | Kika ha comido menos estos 3 días | Abre Kitom para añadir detalles o ver posibles causas. |
| Agenda | Mañana: vacuna anual de Atom | Sábado 18 a las 10:00. |
| Medicación | Hora de la pastilla de Atom | Márcala como dada cuando se la des. |
| Insignia | Primera semana completa | Siete días seguidos cuidando de Kika. |

Máximo una notificación de hábito al día; el usuario elige la hora y puede desactivarla.

## Accesibilidad e idiomas

- Contraste mínimo de la guía en los dos temas; foco visible con `focus-ring`.
- Área táctil mínima `size-touch-min` (44).
- Estado = color + icono + texto, siempre.
- Todos los textos en archivos de traducción (i18n), con un 30 % de holgura de longitud. Fechas y números con el formato del idioma. Diseño preparado para escritura de derecha a izquierda: los iconos direccionales se reflejan; el símbolo no.

## Uso correcto e incorrecto

| Sí | No |
|---|---|
| El símbolo sobre `bg`, `surface` o `laguna-900` | El símbolo sobre fotos sin una placa `surface` |
| El punto sol en el símbolo y en el día de hoy | El sol como color de texto o de botón |
| Urgencias con su color, su icono y su texto | Rojo para decorar, para gráficos o para una racha rota |
| Una acción principal por pantalla | Dos botones `primary` juntos |
| Foto real de la mascota del usuario | Huellas, huesos o mascotas de dibujo animado |
| "Posibles causas" y "orientación" | "Diagnóstico" o promesas médicas |

## Implementación (React Native)

- Tokens en `tokens.ts` (colores claro/oscuro, tipografía, espaciado, radios, bordes, elevación, iconos, tamaños, movimiento y urgencias con su valor de la base de datos). Un ThemeProvider (React Context) elige el tema con `useColorScheme()`.
- Fuentes con `@expo-google-fonts/hanken-grotesk` e `@expo-google-fonts/ibm-plex-mono` (pendientes de instalar).
- Los componentes de este sistema son la referencia visual; los estilos web (`bundle.css`) documentan medidas y estados con los mismos tokens.
