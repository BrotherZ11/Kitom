# Kitom · Inventario de pantallas y componentes (prototipo v2)

Prototipo navegable: lienzo «Kitom · Prototipo» (92 tableros: 90 pantallas y estados de 390×844 más
«Componentes y estados» y «Mapa de navegación»). Fuentes en `prototipo/` (HTML de referencia, no código
de la app) y generador en `fuente/prototipo/` (`python3 build.py`). Tokens y componentes:
`tokens/tokens.ts` y `componentes/`. Guía de marca: `GUIA-DE-MARCA.md`. Plan de implementación:
`PLAN_DESARROLLO.md`. Rutas relativas a `docs/design/`.

**Todo lo que hay aquí es diseño.** Que una ruta «exista» significa que hay una pantalla básica en
`frontend/src/app/`, no que este diseño esté implementado.

Convenciones: mascota de ejemplo **Kika** (perra, plan gratuito),
usuario **David**, jueves 16 de octubre de 2026. Nombres, fechas, valores, clínicas y textos de
orientación son **contenido ficticio de ejemplo**. Los corchetes (`[PRECIO AL AÑO]`, `[LÍMITE]`,
`[Nombre de la clínica]`) son marcadores hasta que se decidan (PRD §10.4 y §14).

## 1. Navegación

Barra inferior de cinco posiciones: **Hoy · Historial · Registrar · Agenda · Perfil**.

- **Registrar** es una acción central, no un destino: abre el registro de hoy a pantalla completa
  (Expo Router: ruta modal fuera de `Tabs`). Punto sol = hoy pendiente; cuando ya está hecho pasa a
  «Hecho» y abre la edición del registro de hoy.
- **Historial** sustituye a «Tendencias» (semana, mes, días y alertas).
- **Perfil** es el de la mascota activa (datos, logros, consultas, alertas). La rueda abre «Tu cuenta y
  ajustes».
- **La orientación con foto no es pestaña** (PRD v2: el hábito es el centro, la IA es paridad). Se abre
  con «Consultar» en la cabecera de Hoy, desde las tarjetas de señal, desde Alertas y desde el perfil.
- **Cambio de mascota**: tocar el nombre en la cabecera abre el selector (hoja).

Esto cambia la propuesta anterior (Hoy · Tendencias · Consultar · Agenda · Perfil);
`componentes/TabBar/README.md` está actualizado.

Primer uso: Bienvenida → Cómo funciona → Crear cuenta (Google · email · teléfono) → Verificar email o
código → Tu perfil → Aviso veterinario (obligatorio) → Privacidad → Primera mascota → Mascota creada
(hora del recordatorio) → Permiso de avisos → Primer registro → Hoy. El aviso va después de la cuenta
porque su aceptación se guarda en `profiles.disclaimer_accepted_at`.

## 2. Pantallas

Ruta: «existe» = está en `frontend/src/app/`; «prop.» = nombre sugerido dentro de Expo Router.

### 1 · Arranque y cuenta

| # | Pantalla (archivo) | Ruta | Datos | Notas |
|---|---|---|---|---|
| 1.0 | Splash (`Splash`) | — | sesión | Símbolo sobre `surface-inverse`. |
| 1.1 | Bienvenida (`Main`) | prop. `(auth)/welcome` | — | «Ya tengo cuenta» → 1.5. |
| 1.2 | Cómo funciona (`Onboarding`) | prop. `(auth)/onboarding` | — | Tres ideas; «Saltar» → crear cuenta. |
| 1.3 | Crear cuenta · error (`Cuenta`) | `(auth)/register` existe | Supabase Auth | Error en el propio campo. |
| 1.4 | Verifica tu email (`VerificaEmail`) | prop., tras registro | Auth | Reenviar, cambiar email. |
| 1.5 | Iniciar sesión (`Login`) | `(auth)/login` existe | Auth, Google | Google cargando (interactivo); credenciales incorrectas. |
| 1.6 | Acceso con teléfono (`Telefono`) | prop. | Auth OTP | **Pendiente en Auth** (`docs/AUTH.md`). |
| 1.7 | Código de verificación (`Codigo`) | prop. | Auth OTP | Ajuste `error` en el lienzo. |
| 1.8 | Recuperar contraseña (`Recuperar`) | `(auth)/forgot-password` existe | Auth | Estado «enviado» (interactivo). |
| 1.9 | Nueva contraseña (`NuevaClave`) | `update-password` existe | Auth | Requisitos visibles. |

### 2 · Configuración inicial y consentimientos

| # | Pantalla | Ruta | Datos | Notas |
|---|---|---|---|---|
| 2.1 | Tu perfil (`TuPerfil`) | prop. `(app)/setup/profile` | `profiles.full_name`, `locale`, `timezone` | Paso 1/3; zona del dispositivo. |
| 2.2 | Idioma · hoja (`Idioma`) | ídem | `profiles.locale` | es activo; en «próximamente». |
| 2.3 | Aviso veterinario (`Aviso`) | prop. `(app)/setup/disclaimer` | `disclaimer_accepted_at`, `disclaimer_version` | Paso 2/3; casilla obligatoria (interactivo). |
| 2.4 | Datos y privacidad (`Privacidad`) | prop. `(app)/setup/privacy` | `marketing_opt_in` | Paso 3/3; comunicaciones desactivadas por defecto. |

### 3 · Mascotas

| # | Pantalla | Ruta | Datos | Notas |
|---|---|---|---|---|
| 3.1 | Perfil mínimo (`MascotaNueva`) | `(app)/pets/new` existe | `pets.name`, `species_id`, `photo_path` | Perro/gato; «Otro» explica que no está disponible (especie inactiva). |
| 3.2 | Foto · hoja (`FotoHoja`) | ídem | Storage | Cámara, galería, quitar. |
| 3.3 | Sin permiso de fotos (`PermisoFotos`) | ídem | permiso del sistema | Abrir ajustes o seguir sin foto. |
| 3.4 | Mascota creada (`MascotaLista`) | prop., tras `pets/new` | `notification_preferences.daily_reminder_*` | Hora por defecto 20:00. |
| 3.5 | Permiso de avisos (`PermisoAvisos`) | ídem | permiso del sistema | Se explica antes del diálogo del sistema. |
| 3.6 | Perfil de mascota (`PerfilMascota`) | `(app)/pets/[id]` existe | `pets`, `pet_streaks`, logros, plan | Pestaña Perfil; ajuste `saved`. |
| 3.7 | Perfil · guardado (`PerfilGuardado`) | ídem | — | Toast «Cambios guardados». |
| 3.8 | Editar perfil (`CompletarPerfil`) | `(app)/pets/[id]/edit` existe | `breed_id/breed_status`, `birth_date`, `weight_kg`, `sex` (incl. `unknown`), `sterilized`, `known_conditions`, `allergies`, `temperament_notes` | Todo opcional; especie bloqueada. |
| 3.9 | Selector de mascota (`SelectorMascota`) | hoja global | `pets` | Añadir mascota (límite por plan, lo decide el servidor). |
| 3.10 | Sin mascotas (`SinMascotas`) | `(app)/index` | `pets` vacío | Tras borrar la última. |
| 3.11 | Eliminar mascota (`EliminarMascota`) | diálogo | `pets` delete | Consecuencias explícitas. |

### 4 · Hoy

| # | Pantalla | Ruta | Datos | Notas |
|---|---|---|---|---|
| 4.1 | Usuario nuevo (`HomeNuevo`) | `(app)/index` existe | `daily_logs` vacío | Invita al primer registro. |
| 4.2 | Día pendiente con señal (`Home`) | ídem | `daily_logs` semana, señal, `reminders` | Una tarjeta de señal como mucho. |
| 4.3 | Día registrado (`HomeHecho`) | ídem | ídem | Ajustes `dark`, `petVoice`, `synced`. |
| 4.4 | Tema oscuro (`HomeOscuro`) | ídem | — | Importa 4.3 con `dark`. |
| 4.5 | Con alerta relevante (`HomeAlerta`) | ídem | señal `consult_soon` | «Llamar a mi clínica» primero. |
| 4.6 | Pocos datos y sin agenda (`HomePocos`) | ídem | — | Mensajes sin conclusiones. |

### 5 · Registro diario (< 45 s)

| # | Pantalla | Ruta | Datos | Notas |
|---|---|---|---|---|
| 5.1 | Bienestar (`Registro`) | `(app)/pets/[id]/daily-log` existe | RPC `save_daily_log`: `energy`, `appetite`, `mood`, `activity_level` (1–5) | «Todo como siempre»; tocar de nuevo deselecciona (interactivo). |
| 5.2 | Detalles opcionales (`RegistroDetalles`) | ídem | `sleep_quality`, `vocalization_level`, `social_interaction_level` (2/3/4), `unusual_behavior(_notes)`, `tags` (3 cerrados), `notes` | No bloquea guardar. |
| 5.3 | Guardado (`RegistroGuardado`) | ídem | `pet_streaks` | Punto de hoy relleno; progreso «7 días seguidos». |
| 5.4 | Editar registro anterior (`RegistroEditar`) | `(app)/pets/[id]/daily-logs/[date]` existe | ídem | Fecha visible en cabecera. |
| 5.5 | Editar el de hoy (`RegistroHoyEditar`) | `daily-log` | ídem | Desde «Hecho» en la barra. |
| 5.6 | Error al guardar (`RegistroError`) | ídem | — | Respuestas conservadas, reintentar. |
| 5.7 | Salir sin guardar (`RegistroDescartar`) | diálogo | — | Solo si hay cambios. |
| 5.8 | Sin conexión (`RegistroOffline`) | ídem | almacén local (FRONTEND_ARCHITECTURE §5) | **Motor offline no conectado.** |
| 5.9 | Conflicto (`RegistroConflicto`) | hoja | `hint = daily_log_conflict` | Elegir versión; **el frontend aún no envía precondiciones.** |
| 5.10 | Sincronizado (`RegistroSync`) | `(app)/index` | — | Importa 4.3 con `synced`. |

### 6 · Historial y evolución

| # | Pantalla | Ruta | Datos | Notas |
|---|---|---|---|---|
| 6.1 | Semana (`Tendencias`) | `(app)/pets/[id]/daily-logs` existe | `daily_logs` por rango | 5 series, máx. 3 a la vez (interactivo); huecos sin interpolar; mensaje prudente. |
| 6.2 | Mes (`HistorialMes`) | ídem | ídem | Calendario + pequeños múltiplos. |
| 6.3 | Detalle del día (`DiaDetalle`) | `daily-logs/[date]` existe | `daily_logs`, `logged_by`, `last_edited_by` | Editar → 5.4. |
| 6.4 | Historial de alertas (`Alertas`) | prop. `pets/[id]/alerts` | señales + `ai_analysis_requests` | Filtros por nivel. |
| 6.5 | Sin datos suficientes (`HistorialVacio`) | ídem 6.1 | — | Vacío sin culpa. |
| 6.6 | Límite del plan (`HistorialLimite`) | ídem | plan desde servidor | Lo anterior a `[LÍMITE]` difuminado. |

### 7 · Orientación con foto y síntomas

| # | Pantalla | Ruta | Datos | Notas |
|---|---|---|---|---|
| 7.1 | Introducción (`ConsultaIntro`) | prop. `pets/[id]/analysis/new` | — | Qué es y qué no es. |
| 7.2 | Consentimiento de fotos (`ConsentimientoFoto`) | hoja | **sin columna** (punto abierto 4) | Uso para la consulta obligatorio si hay foto; mejorar el modelo, desactivado. |
| 7.3 | Hacer la foto (`ConsultaFoto`) | ídem | cámara | Aviso de no incluir personas. |
| 7.4 | Vista previa (`ConsultaPrevia`) | ídem | Storage | Repetir o usar. |
| 7.5 | Señales (`Consulta`) | ídem | `symptoms_catalog` (6) | Al menos una (interactivo). |
| 7.6 | Revisar (`ConsultaRevision`) | ídem | RPC `request_ai_analysis(pet_id, photo_path, symptom_ids)` | Foto opcional. |
| 7.7 | Preparando (`Analizando`) | prop. `analysis/[id]` | `status` `pending/processing` | Edge Function `ai-analysis-process` **pendiente**. |
| 7.8–7.11 | Resultados (`ResultadoObservar`, `Resultado`, `ResultadoPronto`, `ResultadoUrgente`) | ídem | `urgency_level`, `possible_causes`, `recommendations`; RPC `submit_ai_feedback` | Nivel con color + icono + texto; disclaimer siempre; urgente: llamar primero, valoración después. |
| 7.12 | Error (`ConsultaError`) | ídem | `status = failed` | Reintentar sin perder lo elegido. |
| 7.13 | Límite de consultas (`ConsultaLimite`) | ídem | RPC `get_ai_analysis_entitlement` | `[LÍMITE]`. |
| 7.14 | Consultas anteriores (`Consultas`) | prop. `pets/[id]/analysis` | `ai_analysis_requests` | Pide valorar la urgente más tarde. |

### 8 · Agenda y recordatorios

| # | Pantalla | Ruta | Datos | Notas |
|---|---|---|---|---|
| 8.1 | Lista (`Agenda`) | prop. `(app)/agenda` | `reminders` (`status`) | Vencidos arriba; hecho con un toque y deshacer (interactivo). |
| 8.2 | Calendario (`AgendaMes`) | ídem | ídem | Puntos por día. |
| 8.3 | Nuevo recordatorio (`Recordatorio`) | hoja | `type` (6), `recurrence_rule`, `attachment_path` | Tipos y repetición interactivos. |
| 8.4 | Detalle (`RecordatorioDetalle`) | prop. `agenda/[id]` | ídem, `snooze_until` | Hecho, posponer, editar, eliminar. |
| 8.5 | Eliminar (`RecordatorioEliminar`) | diálogo | — | Avisa de que se borran los próximos avisos y el adjunto. |
| 8.6 | Sin eventos (`AgendaVacia`) | ídem | — | Invita a apuntar vacunas, medicación y citas. |
| 8.7 | Notificaciones (`AvisosAjustes`) | prop. `settings/notifications` | `notification_preferences` | Ajuste `denied`: permiso del sistema denegado. |

### 9 · Logros y vínculo

| # | Pantalla | Ruta | Datos | Notas |
|---|---|---|---|---|
| 9.1 | Logros y racha (`Logros`) | prop. `pets/[id]/achievements` | `pet_streaks`, logros | Retos semanales marcados «Próximamente»; voz de la mascota. |
| 9.2 | Detalle de insignia (`LogroDetalle`) | hoja | catálogo (4) | — |
| 9.3 | Insignia conseguida (`LogroNuevo`) | tras guardar | — | Sin confeti. |

### 10 · Perfil de usuario y ajustes

| # | Pantalla | Ruta | Datos | Notas |
|---|---|---|---|---|
| 10.1 | Tu cuenta y ajustes (`Ajustes`) | prop. `(app)/settings` | `profiles`, preferencias | Tema y voz locales (punto abierto 4). |
| 10.2 | Seguridad (`Seguridad`) | prop. `settings/security` | Auth | Métodos de acceso, cerrar sesión en todos. |
| 10.3 | Cambiar contraseña (`CambiarClave`) | ídem | Auth | Errores en campo. |
| 10.4 | Consentimientos (`Consentimientos`) | prop. `settings/privacy` | `marketing_opt_in`, aviso | Revocables. |
| 10.5 | Fotos (`Fotos`) | prop. `settings/photos` | Storage | Borrar fotos de consultas. |
| 10.6 | Exportar (`Exportar`) | prop. `settings/export` | **Edge Function pendiente** | Estado «preparando» (interactivo). |
| 10.7 | Ayuda (`Ayuda`) | prop. `settings/help` | — | Preguntas frecuentes (interactivo). |
| 10.8 | Legal y app (`Legal`) | prop. `settings/legal` | — | Versión de la app. |
| 10.9 | Eliminar cuenta (`EliminarCuenta`) | diálogo | Edge Function `delete-account` **pendiente** (409 `has_pets`) | Lista lo que se borra; sugiere exportar antes. |

### 11 · Suscripción y Premium

| # | Pantalla | Ruta | Datos | Notas |
|---|---|---|---|---|
| 11.1 | Comparativa (`Premium`) | prop. `(app)/premium` | RevenueCat **pendiente** | Funciones futuras «Pronto»; mensual/anual (interactivo); `[PRECIO]`. |
| 11.2 | Premium activado (`PremiumActivo`) | ídem | `revenuecat-webhook` **pendiente** | El plan lo confirma el servidor. |
| 11.3 | Gestionar (`Suscripcion`) | prop. `settings/subscription` | `subscriptions` | Renovación y cancelación explicadas. |
| 11.4 | Cancelada (`SuscripcionCancelada`) | ídem | `cancel_at_period_end`, `current_period_end` | Qué se conserva. |
| 11.5 | Restaurar compras (`RestaurarCompras`) | diálogo | tienda | — |
| 11.6 | Función de Premium (`PlanBloqueado`) | hoja | plan desde servidor | Sin presión; cerrar visible. |

### 12 · Estados globales

| # | Pantalla | Notas |
|---|---|---|
| 12.1 | Cargando (`Cargando`) | Esqueleto tras 300 ms. |
| 12.2 | Sin conexión (`SinConexion`) | Se puede seguir registrando. |
| 12.3 | Error de carga (`ErrorRed`) | Reintentar. |
| 12.4 | Sesión caducada (`SesionCaducada`) | Lo no subido sigue en el móvil. |

Vacíos, permisos, confirmaciones, borrados, errores de formulario, éxito, pendiente de sincronizar y
bloqueo por plan están en su sección. El tablero 0.1 reúne todos los estados de los componentes.

## 3. Componentes

Todos en `kitom.css` del prototipo (mismos tokens que `tokens.ts`). Nuevos respecto a v1 marcados *.

| Componente | Variantes / estados |
|---|---|
| Button | primary, secondary, ghost, danger, urgent, onurgent; 52/44/36; deshabilitado; *cargando (spinner + gerundio) |
| IconButton | transparente, `soft`; 44×44 |
| TextField | normal, foco, error, *correcto, *bloqueado, ayuda, textarea, *prefijo (teléfono) |
| *OtpInput | 6 casillas; error |
| SegmentedControl | 2 o 3 opciones; también como pestañas |
| Chip | on/off, con color de serie, deshabilitado (máx. 3 series) |
| StepSelector 1–5 | sin marcar, marcado, deseleccionar |
| Switch | on/off, accesible (`role="switch"`) |
| Checkbox / *Radio | on/off |
| Avatar | 32/40/64/96 |
| StreakRing | días on/off/hueco; hoy pendiente/hecho |
| TrendChart | 5 series (energía, apetito, ánimo, *actividad, *sueño) con color + trazo; banda de señal; *pequeños múltiplos |
| *MonthCalendar | registrado, señal, hoy, seleccionado, fuera de mes |
| *Timeline | alertas por nivel |
| UrgencyTag / UrgencyPanel | observe, routine, vet, urgent |
| Alert | info, ok, warn, bad |
| *Toast / *Banner | con «Deshacer»; banner de conexión y pendiente de enviar |
| *Skeleton / *EmptyState | — |
| ListItem / ReminderItem | con icono, subtítulo, valor, chevron; hecho tachado |
| Badge / *Medal | ganada, en progreso, bloqueada, grande |
| *WeekDots | progreso semanal L–D |
| TabBar | 4 destinos + *acción central (pendiente / hecho) |
| BottomSheet / Dialog | asa, cierre, acción fija; alertdialog destructivo |
| PlanOption / ComparisonTable | radio grande; marca «Pronto» |
| *Viewfinder | marco de cámara, disparador, miniatura |
| *FeedbackButtons | útil / no útil |

**Tokens nuevos**: `chartActivity` #6B7A1F / oscuro #B9C46A (4,74:1 / 8,37:1) y `chartSleep` #7B5EA7 /
oscuro #C2A8E8 (5,25:1 / 7,54:1), con trazo discontinuo propio. Ya están en `fuente/brand.py` y en
`tokens/` (regenerados).

## 4. Transiciones

- Pasos de cuenta y configuración: deslizamiento horizontal, 200 ms; el indicador avanza.
- Registrar → registro: pantalla completa desde abajo, 320 ms. Cerrar sin cambios no pregunta.
- Al guardar: el punto de hoy se rellena (320 ms). Es la única celebración; las insignias se anuncian
  después, sin confeti.
- Hojas y diálogos: velo + subida 200 ms. Toasts 4 s. Con «reducir movimiento», todo instantáneo.
- Resultado urgente: sin animación decorativa.

## 5. MVP y futuro

Futuro, marcado en pantalla como «Pronto» o «Próximamente»: retos semanales, co-tutores, informe PDF
para el veterinario, orientación con todo el historial, idioma inglés, etiquetas personalizadas.

## 6. Puntos abiertos para desarrollo

1. **Detalles del registro (decidido)**: sueño, vocalizaciones e interacción social con tres opciones
   (menos / normal / más) guardadas como 2 / 3 / 4. Decisión de David, 16 oct 2026. Para el sueño la
   columna es de calidad (2 = Mal): conviene confirmar que «Menos» se lee igual en el historial.
2. **Comportamiento inusual**: interruptor + nota (`unusual_behavior`, `unusual_behavior_notes`); sin catálogo.
3. **Resultado de la orientación**: `possible_causes` es `text[]` sin probabilidad; las etiquetas de
   probabilidad y «Consulta a tu veterinario si…» necesitan `response_raw` o columnas nuevas.
4. **Preferencias sin columna**: tema y voz de la mascota (pueden ser locales); el consentimiento de
   fotos para mejorar el modelo debe guardarse en servidor (migración aparte, con aprobación).
5. **Nota libre en la consulta**: `request_ai_analysis` no recibe texto libre; o se quita del diseño o
   necesita parámetro nuevo.
6. **Avisos por tipo y antelación del recordatorio**: sin columnas en `notification_preferences` /
   `reminders`.
7. **Clínica veterinaria** (nombre y teléfono para «Llamar a mi clínica»): no hay vínculo entre usuario o
   mascota y su clínica. `vet_clinics` existe pero es el catálogo de clínicas asociadas para referidos
   (`create_clinic_referral`), no la clínica propia del usuario.
8. **Exportar datos** e informe PDF: dependen de Edge Functions pendientes.
9. **Eliminar cuenta con mascotas**: `delete-account` devuelve 409 `has_pets`; el diálogo explica qué
   pasa, pero falta decidir el flujo (borrar mascotas primero o en cascada).
10. **Límites del plan gratuito y precios**: marcadores hasta cerrar PRD §10.4 y §14.
11. **Paquetes pendientes de instalar (requieren permiso)**: `@expo-google-fonts/hanken-grotesk`,
    `@expo-google-fonts/ibm-plex-mono`, `lucide-react-native` y `react-native-svg`.
