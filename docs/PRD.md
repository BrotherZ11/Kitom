# PRD - Kitom

## Kitom – Gestión y bienestar emocional de tu mascota

| Campo                 | Detalle                                                                  |
| --------------------- | ------------------------------------------------------------------------ |
| Versión del documento | 2.0                                                                      |
| Fecha                 | Agosto 2026                                                              |
| Estado                | Borrador actualizado tras análisis de mercado competitivo                |
| Plataformas objetivo  | iOS, Android (React Native) · Web (fase posterior)                       |
| Backend               | Supabase (Auth, Postgres, Storage, Realtime, Edge Functions)             |
| Idiomas               | Multi-idioma desde el lanzamiento (i18n), mercados a confirmar en Fase 0 |

---

## 0. Registro de cambios

### De la idea original a la v1.0

1. La IA de análisis por foto se divide en fases (MVP con LLM multimodal + RAG curado por veterinario; modelo propio entrenado queda como Fase 3, no comprometida).
2. El plan gratuito pasa a tener límites explícitos.
3. Web queda como fase posterior, no como entregable simultáneo al lanzamiento móvil.
4. Se añade perfil compartido / multi-tutor por mascota.
5. Se refuerza el marco legal y los disclaimers médicos.
6. Se elimina la promesa de "detectar enfermedades"; se sustituye por "detectar señales de alerta y orientar sobre cuándo acudir al veterinario".

### De la v1.0 a la v2.0 (este documento)

Tras un análisis del mercado actual (agosto 2026), se detecta que el espacio "bienestar emocional diario + IA por foto + gamificación" **ya no está vacío**: existen múltiples apps con posicionamiento muy similar o casi idéntico (Pawrpose, Mpet, PerkyPet AI, VetGPT, Omelo, Pet Check AI, PetPaw AI, entre otras), varias lanzadas en los últimos 6-9 meses. Esto obliga a los siguientes cambios:

1. **Se añade una sección de análisis competitivo explícito** (sección 3), inexistente en la v1.0.
2. **Se reescribe la propuesta de valor y diferenciación** (sección 6): la IA de foto+síntomas deja de tratarse como diferencial y pasa a considerarse funcionalidad de paridad ("table stakes"). El diferencial real debe construirse en confianza clínica visible, distribución/alianzas y profundidad del vínculo emocional/gamificación, no en la IA en sí.
3. **Se adelanta la exploración de alianzas con clínicas veterinarias** de Fase 3 a una validación temprana en Fase 0/1, como posible canal de adquisición y de confianza, no solo como monetización futura.
4. **Se revisa el modelo freemium**: al existir competidores con symptom-checker gratuito (ej. Omelo), competir "regalando menos" no es sostenible; se reorienta el valor premium hacia profundidad de historial, contexto longitudinal e informes para el veterinario, no solo cantidad de análisis.
5. **Se añade una sección de estrategia de adquisición / go-to-market** (sección 15), ausente en la v1.0, ahora crítica en un mercado saturado de apps "wrapper" de IA fáciles de replicar.
6. **Se añade una subsección de economía unitaria de la IA** (coste de inferencia por análisis vs. ARPU), necesaria antes de fijar límites del plan free.
7. **Se revisa el onboarding**: se pasa de pedir todos los campos del perfil de mascota de golpe a un perfil mínimo inicial + perfilado progresivo, para proteger la meta de activación (≥70% primer registro en la primera sesión).
8. **Se resuelve una inconsistencia interna**: la exportación de PDF aparecía como _Must_ de producto (7.7) pero relegada a Fase 2 en el roadmap; se mantiene en Fase 2 de desarrollo, pero se reclasifica como _Should_ del MVP y _Must_ a medio plazo, para eliminar la ambigüedad.
9. **Se añaden nuevos riesgos**: comoditización de la función de IA por la competencia, coste de adquisición (CAC) elevado en categoría saturada, dependencia de un proveedor externo de modelo multimodal.

---

## 1. Resumen ejecutivo

Kitom es una aplicación móvil de bienestar emocional y conductual para mascotas. Permite a los tutores registrar a diario el estado de ánimo, energía, apetito y comportamiento de su animal, y usa inteligencia artificial para detectar patrones de posible estrés, aburrimiento o malestar, alertando de forma temprana y con recomendaciones prácticas.

**Importante (v2.0):** el análisis asistido por foto + síntomas ya no puede presentarse como la función diferencial de Kitom — es una funcionalidad que varios competidores directos ya ofrecen en 2026. El diferencial real de Kitom debe apoyarse en tres pilares más defendibles: (a) el hábito diario de vínculo emocional con gamificación bien ejecutada, (b) la confianza clínica visible (aval veterinario real y comunicado, no solo interno) y (c) la distribución a través de canales de confianza (clínicas veterinarias, comunidad de tutores), más difíciles de copiar que un prompt de IA.

**Visión:** convertirse en la app de referencia para el bienestar diario (no solo clínico) de perros y gatos, ocupando el espacio que hoy no cubre ni el veterinario (visitas puntuales) ni las apps de salud puramente clínicas (historiales, vacunas) — sabiendo que otras apps intentan ocupar ese mismo espacio y que la ejecución, no la idea, será el factor decisivo.

**No-objetivo:** Kitom no es una app de diagnóstico veterinario ni sustituye la consulta profesional. Esto debe quedar explícito en producto, copys y términos legales.

---

## 2. Problema y oportunidad

- Los tutores de mascotas suelen notar que "algo raro pasa" con su animal, pero no saben interpretar si es una señal seria o algo pasajero, y muchas visitas al veterinario son reactivas (cuando el problema ya es grave) o innecesarias (por ansiedad del tutor).
- No existe una única herramienta dominante de diario emocional para mascotas, comparable a lo que ya existe para el bienestar humano (apps de mood tracking, sueño, hábitos) — aunque sí existen ya varias herramientas compitiendo por ese espacio (ver sección 3).
- El vínculo emocional con la mascota es un gran motor de uso recurrente: los tutores quieren sentir que "entienden" mejor a su animal, no solo gestionarlo administrativamente.
- **Validación de mercado (v2.0):** la existencia de al menos 8-10 apps atacando variaciones de esta misma idea en el último año confirma que la demanda es real. Esto es una señal positiva sobre el problema, pero negativa sobre la facilidad de diferenciarse: la oportunidad ya no es "crear la categoría", sino "ganar la categoría".

---

## 3. Análisis competitivo _(nuevo en v2.0)_

### 3.1 Panorama actual (agosto 2026)

| Categoría                                         | Apps                                                                | Qué ofrecen                                                                                                            | Qué implica para Kitom                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| IA symptom-checker (foto + texto)                 | Pet Check AI, VetGPT, PetPaw AI, Pet AI: Vet Health Assistant, Mpet | Sube foto + síntomas, IA da orientación y nivel de urgencia; VetGPT cubre 64+ especies                                 | La función de IA de Kitom (sección 9) es paridad, no diferencial                             |
| Symptom-checker gratuito con respaldo veterinario | Omelo                                                               | Symptom-checker 100% gratis, +500 rutas de decisión clínica revisadas por veterinarios                                 | Presiona el modelo freemium: alguien ya regala lo que Kitom limita en free                   |
| Wellness/mood tracking + IA                       | PerkyPet AI, Pawrpose, Pets Care                                    | Registro diario de energía/apetito/ánimo, gráficos, análisis de foto para detectar estados como ansioso/calmado/activo | Pawrpose en particular es casi idéntico al pitch de Kitom (mood + foto + journal + gráficos) |
| Recordatorios y gestión clínica                   | PetDesk, 11pets, VitusVet, Whistle Health                           | Vacunas, citas, comunicación con clínica; normalmente sin interpretar tendencias                                       | Base instalada y confianza de clínicas ya establecida                                        |
| Telemedicina veterinaria                          | AirVet, Pawp                                                        | Acceso a veterinario real por chat/vídeo                                                                               | Complementarios, no directos, pero compiten por el mismo "momento de duda a las 3 AM"        |

### 3.2 Lectura estratégica

- El mercado de pet tech alcanzó ~15.600 M$ en 2025 y el segmento de apps de cuidado se proyecta en ~3.800 M$ para 2033: la categoría crece, pero también atrae oferta constante.
- La mayoría de competidores directos son productos "wrapper" de LLM (foto + prompt + modelo de terceros) lanzados en los últimos 6-9 meses. La barrera técnica de entrada es baja — lo que Kitom puede construir en 12-14 semanas, otro equipo también puede, y varios ya lo hicieron.
- Conclusión: **la IA ya no es un foso defendible.** El foso tiene que construirse en confianza clínica visible, distribución (alianzas, comunidad) y calidad de ejecución del hábito diario/gamificación, que son más lentos de copiar.

### 3.3 Qué validar antes de construir (acción para Fase 0)

- Testear explícitamente frente a competidores nombrados: "¿elegirías Kitom teniendo Omelo gratis o Pawrpose disponible? ¿Por qué?".
- Entrevistar a veterinarios sobre si estarían dispuestos a recomendar/prescribir Kitom a sus clientes (posible canal de distribución y de confianza).
- Mapear si alguno de los competidores ya tiene tracción real (reviews, valoraciones, señales de retención) para no subestimar el punto de partida.

---

## 4. Objetivos de producto y métricas de éxito

| Objetivo                              | Métrica (North Star y KPIs)                                                                                                          | Meta orientativa (6 meses post-lanzamiento) |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| Crear hábito diario de registro       | % de usuarios que registran al menos 4 días/semana                                                                                   | ≥ 35%                                       |
| Retención                             | Retención D1 / D7 / D30                                                                                                              | 45% / 25% / 12%                             |
| Activación                            | % de usuarios que crean perfil de mascota y hacen su primer registro en la primera sesión                                            | ≥ 70%                                       |
| Valor de la IA                        | % de registros con alerta que derivan en acción del usuario (marcar como resuelto, agendar vet, cambiar rutina)                      | ≥ 50%                                       |
| Monetización                          | Conversión free → premium                                                                                                            | 3–6%                                        |
| Satisfacción                          | NPS                                                                                                                                  | ≥ 40                                        |
| **Diferenciación validada** _(nuevo)_ | % de usuarios nuevos que, en encuesta de activación, identifican una razón específica para elegir Kitom sobre alternativas gratuitas | ≥ 40%                                       |

**North Star Metric propuesta:** _Registros de bienestar completados por mascota activa y por semana_ (mide simultáneamente hábito, valor percibido y engagement real, mejor que "usuarios activos" a secas).

---

## 5. Usuarios objetivo (personas)

**1. "Marta, la tutora primeriza ansiosa" (28 años)**
Adoptó su primer perro hace 6 meses. Busca tranquilidad y saber si lo está haciendo bien. Usa la app a diario, valora mucho las alertas y recomendaciones.

**2. "Javier, el tutor ocupado con rutina" (40 años)**
Tiene un gato desde hace años. Quiere control de vacunas, recordatorios y detectar rápido si algo cambia, sin invertir mucho tiempo. Uso más esporádico pero constante.

**3. "Lucía, la breeder/cuidadora de varias mascotas" (35 años)**
Tiene 3+ mascotas o cuida temporalmente animales de otros. Necesita perfiles múltiples y comparativas. Cliente potencial premium desde el día uno.

**4. "Familia compartiendo un perro" (pareja o padres e hijos)**
Necesitan que más de una persona registre datos de la misma mascota y vea el mismo historial.

---

## 6. Propuesta de valor y diferenciación _(reescrita en v2.0)_

### 6.1 Lo que ya no es diferencial

La tabla original comparaba Kitom contra "apps de salud veterinaria clásicas" y "apps de recordatorios genéricos", asumiendo que ninguna tenía IA ni gamificación. Esa comparación ya no describe el mercado real: existen apps con IA + mood tracking + gráficos (sección 3). Presentar la IA de foto+síntomas como diferencial en marketing sería inexacto y frágil.

### 6.2 Diferenciación revisada — elegir un ángulo, no listar features

| Dimensión                                                   | Ya es paridad (todo el mundo lo tiene)                                 | Puede ser diferencial real                                                               |
| ----------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| IA foto + síntomas                                          | Sí — Pet Check AI, VetGPT, PetPaw AI, Mpet, etc.                       | No, salvo que se combine con contexto longitudinal único                                 |
| Mood tracking diario + gráficos                             | Sí — Pawrpose, PerkyPet AI, Pets Care                                  | No por sí solo                                                                           |
| Gamificación (rachas, medallas)                             | Parcial — apps de hábitos humanos ya lo hacen bien (Finch, Tabby)      | Sí, si el nivel de pulido/vínculo emocional es notablemente superior                     |
| Aval veterinario **visible y comunicado** (no solo interno) | No, la mayoría lo usa solo como validación de contenido, no como marca | **Sí** — pocas comunican el respaldo clínico como parte central de la confianza de marca |
| Distribución vía clínicas veterinarias / seguros            | No, casi ninguna lo hace desde el lanzamiento                          | **Sí** — canal de adquisición y de confianza, y defensa frente a copias                  |
| Especialización (etapa de vida, condición, tipo de tutor)   | No, la mayoría es generalista                                          | **Sí** — ej. enfocarse en primeros 12 meses de un cachorro/gatito, o en mascotas senior  |

**Recomendación de producto:** elegir como mínimo uno de estos dos ángulos como eje de posicionamiento antes del desarrollo del MVP:

1. **Confianza clínica como marca**: veterinario colaborador visible (nombre, credencial, presencia en la app y en marketing), y explorar early-access con 1-2 clínicas reales como canal de distribución y prueba social.
2. **Especialización de nicho**: en lugar de "toda mascota, todo tutor", empezar por un segmento concreto (ej. tutores primerizos de cachorro/gatito en sus primeros 12 meses, el momento de mayor ansiedad y mayor frecuencia de registro) y expandir después.

### 6.3 Tabla comparativa actualizada

| Kitom (posicionamiento revisado)                         | Apps de IA symptom-checker (Omelo, VetGPT, Pet Check AI...) | Apps de mood-tracking similares (Pawrpose, PerkyPet AI)      | Apps de recordatorios clásicas              |
| -------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------- |
| Hábito diario + vínculo emocional + aval clínico visible | Foco puntual (momento de duda), no hábito diario            | Foco similar a Kitom, sin aval clínico comunicado como marca | Foco en tareas, sin IA ni vínculo emocional |
| Gamificación pulida y mensajes en "voz de la mascota"    | Nulo o mínimo                                               | Básico                                                       | Nulo                                        |
| Distribución vía clínicas/comunidad (a validar)          | Generalmente solo D2C                                       | Generalmente solo D2C                                        | A veces integrado con clínicas (PetDesk)    |

---

## 7. Alcance por fases

### Fase 0 — Discovery (4–6 semanas)

- Validación con usuarios reales (encuestas + prototipo Figma).
- Definición de marca y elección del ángulo de diferenciación (sección 6.2).
- Alianza con al menos 1 veterinario asesor para validar contenidos y prompts de IA, **y evaluar si ese veterinario o su clínica puede ser el primer canal de distribución/prueba piloto** (adelantado desde Fase 3).
- Test explícito de percepción frente a competidores nombrados (Omelo, Pawrpose, PerkyPet AI) — sección 3.3.
- Decisión de mercados de lanzamiento prioritarios, de la que depende la elección final de idiomas del MVP.

### Fase 1 — MVP (objetivo: 12–14 semanas de desarrollo)

- Autenticación (Google, email/contraseña, teléfono)
- Perfil de mascota — **perfil mínimo en onboarding + perfilado progresivo** (ver sección 8.2)
- Registro diario emocional/conductual (sliders + texto + etiquetas)
- Historial visual básico (gráficos por semana/mes)
- Agenda y recordatorios (vacunas, medicación, citas)
- Notificaciones push
- Análisis con IA (foto + síntomas) — versión "orientativa", Fase 1 del motor de IA (ver sección 10), **con límites de free calibrados por coste real, no solo por número arbitrario** (ver 10.4)
- Gamificación básica (rachas, medallas simples)
- Onboarding + perfil de usuario
- Multi-idioma: idioma(s) confirmados en Fase 0 según mercado prioritario; arquitectura preparada para añadir más
- **Exploración ligera de partnership con la clínica veterinaria colaboradora** como piloto de distribución (no desarrollo, solo relación comercial)

### Fase 2 — Post-lanzamiento (meses 4–8)

- Perfiles compartidos / multi-tutor por mascota
- Exportación de reportes en PDF para el veterinario (**Should del MVP, Must a medio plazo** — ver registro de cambios, punto 14)
- Desafíos semanales generados por IA
- Ampliación de idiomas
- Mejora del motor de IA con feedback de usuarios (¿fue útil esta sugerencia? sí/no)
- Suscripción premium completa + facturación
- Formalización de 2-3 alianzas con clínicas veterinarias como canal de adquisición

### Fase 3 — Escalado (meses 9+)

- Versión Web (probablemente React Native Web o app ligera separada)
- Modelo de IA propio entrenado con datos anonimizados y consentidos
- Portal para veterinarios/clínicas (acceso de solo lectura al historial compartido por el tutor)
- Alianzas B2B (marcas de alimentación, seguros de mascotas)
- Funcionalidad social/comunidad (backlog, no confirmado — evaluar antes de construir)

---

## 8. Requisitos funcionales detallados

Prioridad según MoSCoW: **M**ust have, **S**hould have, **C**ould have, **W**on't have (por ahora).

### 8.1 Autenticación y onboarding — _Must_

- Registro/login vía Google, email+contraseña, y teléfono (OTP vía Supabase Auth).
- Recuperación de contraseña.
- Onboarding obligatorio: crear al menos 1 mascota antes de acceder a la home.
- Pantalla de bienvenida explicando qué hace la app y **disclaimer de que no sustituye al veterinario** (debe aceptarse explícitamente).
- Consentimiento explícito y granular sobre uso de fotos para análisis de IA (ver sección 13).

### 8.2 Perfiles de mascota — _Must (revisado en v2.0)_

- **Perfil mínimo inicial** (bloqueante para acceder a la home): nombre, especie (perro/gato/otro), foto opcional. Objetivo: no dañar la meta de activación (≥70% primer registro en primera sesión).
- **Perfilado progresivo** (no bloqueante, solicitado en momentos naturales posteriores): raza, edad/fecha de nacimiento, género, peso, esterilización, enfermedades conocidas, alergias, notas de carácter.
- Edición libre en cualquier momento.
- Free: 1 mascota. Premium: mascotas ilimitadas.
- (Fase 2) Compartir perfil de mascota con otro usuario (co-tutor), con permisos de lectura/escritura.

### 8.3 Registro diario emocional y de comportamiento — _Must_

- Sliders/selectores para: energía, apetito, estado de ánimo, actividad física, sueño, vocalizaciones, interacción social, comportamientos inusuales.
- Campo de texto libre opcional.
- Etiquetas rápidas configurables ("día de visita", "cambio de casa", "nueva mascota en casa", etc.).
- Debe completarse en menos de 45 segundos en el flujo estándar (objetivo de UX, medible en analítica).
- Posibilidad de registrar en modo offline; se sincroniza al recuperar conexión.

### 8.4 Análisis con IA (foto + síntomas) — _Must (versión Fase 1 del motor, ver sección 10)_

- El usuario sube una foto y selecciona síntomas visibles de una lista predefinida (ojos llorosos, cojera, decaimiento, heridas, falta de apetito, vocalización excesiva, etc.).
- El sistema devuelve:
  - Posibles causas orientativas (no diagnóstico).
  - Nivel de urgencia: **Observar** / **Cambio de rutina recomendado** / **Consultar veterinario pronto** / **Urgente, acudir ahora**.
  - Recomendaciones prácticas.
  - Disclaimer visible en cada resultado.
- Límite de análisis en el plan free calibrado por coste real de inferencia, no un número arbitrario (ver 10.4).
- Cada resultado debe poder marcarse como "útil / no útil" para mejorar el sistema con el tiempo (feedback loop).
- **Diferenciador a explorar:** el análisis usa el historial y contexto acumulado de la mascota (no solo la foto puntual), algo que un symptom-checker genérico sin registro diario no puede ofrecer.

### 8.5 Sugerencias personalizadas — _Should_

- Basadas en historial + perfil (especie, raza, edad): cambios de rutina, juegos, enriquecimiento ambiental, tips de descanso.
- Frecuencia configurable por el usuario (para no generar fatiga de notificaciones).

### 8.6 Gamificación y vínculo emocional — _Should, pero tratado como palanca de diferenciación clave (ver 6.2)_

- Rachas de registro diario.
- Medallas/insignias por constancia y por completar hitos (ej. "7 días seguidos", "primer registro con foto").
- Mensajes "en primera persona de la mascota" (tono cálido, opcional/activable).
- Desafíos semanales sugeridos por IA (Fase 2).

### 8.7 Historial visual y reportes — _Must_

- Gráficos por día/semana/mes de estado emocional, energía, apetito, actividad.
- Línea de tiempo de alertas recibidas (fecha + causa + urgencia).
- Exportación de reportes en PDF para compartir con el veterinario (**Should del MVP / Must a medio plazo** — desarrollo en Fase 2).

### 8.8 Agenda y recordatorios — _Must_

- Calendario de actividades, eventos y recordatorios (medicación, vacunas, citas veterinarias, baño, desparasitación).
- Adjuntar documentos/fotos (ej. receta médica) — almacenamiento en Supabase Storage.
- Notificaciones push configurables por tipo de recordatorio.

### 8.9 Notificaciones y alertas — _Must_

- Alertas automáticas ante cambios bruscos de comportamiento/hábitos (detectadas por reglas + IA sobre el historial).
- Tono empático, orientado a la acción, nunca alarmista ("Notamos que Rocco ha comido menos estos 3 días, ¿quieres registrar más detalles o ver posibles causas?").
- Recordatorio diario configurable para no olvidar el registro (con opción de desactivar).

### 8.10 Multiplataforma — _Must (móvil) / Should (web, fase posterior)_

- iOS y Android vía React Native (Expo recomendado para acelerar desarrollo, OTA updates y gestión de notificaciones push).
- Web: evaluar en Fase 3 vía React Native Web o una app web ligera con las funciones clave (no necesariamente paridad 100%).

---

## 9. Requisitos no funcionales

| Categoría               | Requisito                                                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rendimiento             | Tiempo de carga inicial < 2s en conexión 4G; registro diario completable offline                                                                      |
| Disponibilidad          | 99.5% uptime del backend (Supabase)                                                                                                                   |
| Seguridad               | Row Level Security (RLS) en todas las tablas de Supabase; cada usuario solo accede a sus propios datos y a los de mascotas compartidas explícitamente |
| Privacidad              | Cumplimiento GDPR (usuarios UE) y equivalentes; derecho a exportar y eliminar todos los datos del usuario                                             |
| Almacenamiento de fotos | Buckets privados con URLs firmadas de corta duración, nunca públicas por defecto                                                                      |
| Accesibilidad           | Tipografía escalable, etiquetas para lectores de pantalla, no depender solo del color para transmitir estado (usar iconos + texto)                    |
| Internacionalización    | Arquitectura i18n desde el día 1, detección de idioma del dispositivo con fallback a inglés                                                           |
| Offline-first           | Cache local (ej. WatermelonDB o almacenamiento local + cola de sincronización) para registros diarios                                                 |
| Observabilidad          | Analítica de producto (ej. PostHog/Amplitude) + logging de errores (ej. Sentry) desde el MVP                                                          |

---

## 10. El motor de IA — enfoque honesto y por fases

Este es el punto de mayor riesgo técnico, legal, **de expectativas y ahora también de comoditización competitiva**, por lo que merece una sección propia.

**Fase 1 (MVP):**

- Modelo multimodal (LLM con capacidad de visión) al que se le envía la foto + síntomas seleccionados + contexto del perfil e historial de la mascota, mediante un prompt cuidadosamente diseñado y validado por un veterinario colaborador, apoyado en una base de conocimiento curada (RAG) con contenidos revisados profesionalmente.
- El resultado se presenta siempre como **orientación informativa**, con niveles de urgencia claros y una llamada a la acción hacia el veterinario cuando corresponda.
- Todas las llamadas al modelo de IA se hacen desde una Supabase Edge Function (nunca desde el cliente).

**Fase 2:**

- Recolección de feedback estructurado (¿fue útil?, ¿qué diagnosticó el veterinario finalmente, si el usuario quiere compartirlo?) para medir precisión real.
- Ajuste de prompts y base de conocimiento con más casos.

**Fase 3 (aspiracional, no comprometida en el lanzamiento):**

- Modelo propio entrenado con datos anonimizados de usuarios que hayan dado consentimiento explícito, una vez exista volumen suficiente y con supervisión veterinaria en el proceso de etiquetado.

**Importante:** ningún copy de marketing ni de producto debe usar la palabra "diagnóstico" o "diagnostica". Usar siempre "orientación", "posibles causas", "señales de alerta".

### 10.4 Economía unitaria de la IA _(nuevo en v2.0)_

- Antes de fijar el límite del plan free (actualmente "3 análisis/mes"), modelar: coste por llamada multimodal (imagen + texto) del proveedor elegido × nº estimado de usuarios free activos = coste mensual total, comparado con el ARPU esperado de premium.
- Riesgo específico: al existir un competidor (Omelo) con symptom-checker gratuito sin límite aparente, un límite de free demasiado restrictivo puede empujar a los usuarios a usar Kitom solo para el registro diario y a un competidor para el análisis de IA — perdiendo el cross-sell hacia premium.
- Mitigación recomendada: en vez de competir en "cuántos análisis gratis", diferenciar el valor premium en la **profundidad de contexto** (análisis que usa historial completo, no solo la foto puntual) y en el informe para el veterinario, funciones que un competidor sin registro diario no puede replicar fácilmente.
- Cachear resultados similares y monitorizar coste por usuario activo desde el primer día en producción (no solo en pruebas).

---

## 11. Modelo de datos (entidades principales)

| Tabla                  | Campos clave                                                                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`                | id, email, teléfono, nombre, foto, idioma, plan (free/premium), created_at                                                                         |
| `pets`                 | id, owner_id, nombre, especie, raza, fecha_nacimiento, género, peso, esterilizado, enfermedades, alergias, foto_url, notas                         |
| `pet_co_owners`        | pet_id, user_id, rol (owner/editor/viewer) — _Fase 2_                                                                                              |
| `daily_logs`           | id, pet_id, fecha, energía, apetito, ánimo, actividad, sueño, vocalizaciones, interacción_social, comportamiento_inusual, texto_libre, etiquetas[] |
| `symptoms_catalog`     | id, nombre, especie_aplicable, categoría                                                                                                           |
| `ai_analysis_requests` | id, pet_id, foto_url, síntomas_seleccionados[], resultado_json, nivel_urgencia, feedback_util (bool, null)                                         |
| `reminders`            | id, pet_id, tipo (vacuna/medicación/cita/baño/desparasitación), fecha, adjunto_url, estado                                                         |
| `achievements`         | id, pet_id, tipo, fecha_obtenida                                                                                                                   |
| `subscriptions`        | id, user_id, plan, estado, fecha_inicio, fecha_renovación, proveedor_pago                                                                          |

Todas las tablas con RLS activada: `owner_id = auth.uid()` o pertenencia en `pet_co_owners`.

_Nota (v2.0):_ si se valida el ángulo de distribución vía clínicas (sección 6.2), prever en Fase 2 una tabla `vet_clinics` / `clinic_referrals` para trazar el canal de adquisición, sin necesidad de construirla en el MVP.

---

## 12. Arquitectura técnica (alto nivel)

- **Frontend:** React Native (Expo), con `react-navigation`, `react-i18next`, gestión de estado con Zustand o Redux Toolkit, almacenamiento local offline (ej. MMKV + cola de sync).
- **Backend:** Supabase
  - **Auth:** Google, email/password, phone OTP.
  - **Postgres:** modelo de datos anterior, con RLS.
  - **Storage:** fotos de mascotas y adjuntos, buckets privados.
  - **Edge Functions:** proxy hacia el proveedor de IA (nunca exponer la API key en el cliente), lógica de reglas de alertas, generación de PDF de reportes.
  - **Realtime:** para sincronizar perfiles compartidos entre co-tutores.
- **Notificaciones push:** Expo Push Notifications (o Firebase Cloud Messaging como alternativa).
- **Analítica:** PostHog o Amplitude + Sentry para errores. **Instrumentar desde el MVP el evento de comparación con competidores** (ver métrica de diferenciación validada, sección 4).
- **Pagos/suscripciones:** RevenueCat integrado con Supabase para reflejar el estado del plan.

---

## 13. Consideraciones legales, éticas y de seguridad clínica

- **Disclaimer obligatorio y persistente:** Kitom no diagnostica ni sustituye la atención veterinaria profesional. Debe aceptarse en el onboarding y repetirse en cada resultado de IA.
- **Escalado de urgencia:** cualquier combinación de síntomas graves debe mostrar de forma prioritaria "Contacta a tu veterinario ahora" con datos de contacto de emergencia si el usuario los ha configurado.
- **Consentimiento sobre fotos:** explicar claramente si las fotos se usan solo para el análisis puntual o también (de forma opcional y separada) para mejorar el modelo. Nunca activar esto último por defecto.
- **Privacidad de terceros en fotos:** avisar al usuario de que evite incluir personas identificables en las fotos que suba.
- **Cumplimiento normativo:** GDPR (UE), y revisar equivalentes locales según los mercados de lanzamiento (ej. CCPA en California).
- **Regulación de telemedicina veterinaria** _(nuevo en v2.0)_: revisar, según los mercados de lanzamiento, si existen requisitos legales sobre qué constituye una relación veterinario-paciente-cliente (VCPR en EE.UU. y equivalentes) que puedan afectar al lenguaje o alcance permitido de la orientación de IA, incluso con disclaimers.
- **Términos de servicio y política de privacidad** redactados por asesoría legal antes del lanzamiento público (no cubierto por este PRD).

---

## 14. Modelo de negocio y monetización _(revisado en v2.0)_

**Freemium con suscripción Kitom Premium.**

|                                   | Free                                                                | Premium                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mascotas                          | 1                                                                   | Ilimitadas                                                                                                                                            |
| Registro diario                   | Ilimitado                                                           | Ilimitado                                                                                                                                             |
| Historial visual                  | Últimos 30 días                                                     | Histórico completo                                                                                                                                    |
| Análisis con IA (foto+síntomas)   | Limitado según coste real (a definir con 10.4), con contexto básico | Ilimitado, **con contexto de historial completo** (diferenciador defendible frente a symptom-checkers sin registro diario)                            |
| Exportar reporte PDF              | No                                                                  | Sí                                                                                                                                                    |
| Perfiles compartidos (co-tutores) | No                                                                  | Sí                                                                                                                                                    |
| Recordatorios/agenda              | Básico                                                              | Avanzado (múltiples recordatorios, adjuntos ilimitados)                                                                                               |
| Precio orientativo                | —                                                                   | 4,99–7,99 €/mes o 39,99–59,99 €/año — **validar explícitamente frente a la existencia de alternativas gratuitas (Omelo) antes de fijar precio final** |

**Nota estratégica (v2.0):** no competir en "cuánto regalamos gratis" frente a apps que ya ofrecen symptom-checkers sin coste — es una carrera que Kitom no tiene por qué ganar. Competir en profundidad de seguimiento longitudinal, vínculo emocional y confianza clínica, que sí son monetizables de forma sostenible.

**Fuentes de ingreso futuras (Fase 3, no comprometidas):** alianzas con marcas de alimentación/seguros de mascotas, portal para clínicas veterinarias (posible modelo B2B/B2B2C).

---

## 15. Estrategia de adquisición y go-to-market _(nueva en v2.0)_

Ausente en la v1.0; se considera crítica dado que la categoría está saturada de apps con barrera técnica baja, donde ganar no depende solo del producto.

- **Canales a explorar desde Fase 0/1:**
  - Alianza con veterinario(s) colaborador(es) como embajadores/canal de referencia hacia sus clientes.
  - ASO (App Store Optimization) específico frente a términos donde ya compiten apps similares (ej. "diario emocional mascota", "mi perro está triste").
  - Contenido y comunidad orgánica (redes sociales centradas en el vínculo emocional con la mascota, no solo en la función de IA).
  - Exploración temprana (no comprometida) de partnerships con clínicas veterinarias locales como piloto de distribución.
- **Métricas de adquisición a definir antes del lanzamiento:** CAC objetivo por canal, LTV estimado según el ARPU de la sección 14, y ratio LTV:CAC mínimo aceptable antes de escalar inversión en marketing pago.
- **Mensaje de posicionamiento a testear en Fase 0:** validar con usuarios reales cuál de los dos ángulos de la sección 6.2 (confianza clínica vs. especialización de nicho) genera mayor intención de descarga/pago frente a los competidores ya identificados.

---

## 16. Riesgos y mitigaciones

| Riesgo                                                                   | Impacto                                         | Mitigación                                                                                                                           |
| ------------------------------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Un usuario retrasa una visita veterinaria confiando solo en la IA        | Alto (reputacional/legal/bienestar animal)      | Disclaimers persistentes, escalado claro de urgencia, copy revisado por veterinario                                                  |
| Sesgo o baja precisión del modelo de IA en razas/especies poco comunes   | Medio                                           | Empezar con perro y gato, ampliar gradualmente                                                                                       |
| Baja adopción del hábito diario                                          | Alto (afecta retención)                         | Gamificación, recordatorios bien calibrados, UX de registro ultra-rápido                                                             |
| Coste de inferencia de IA a escala                                       | Medio                                           | Límites por plan free calibrados por coste real, cacheo de resultados similares, monitorización de coste por usuario (ver 10.4)      |
| Fotos con datos sensibles (personas, ubicación)                          | Medio                                           | Aviso explícito al subir foto, opción de recorte automático sugerido                                                                 |
| Fragmentación por mantener móvil + web a la vez desde el inicio          | Medio                                           | Web pospuesta a Fase 3                                                                                                               |
| **Comoditización de la función de IA por competencia directa** _(nuevo)_ | Alto (erosiona la propuesta de valor percibida) | No comunicar la IA como diferencial principal; construir marca sobre confianza clínica, distribución y gamificación (sección 6.2)    |
| **CAC elevado en categoría saturada** _(nuevo)_                          | Alto (viabilidad del negocio)                   | Validar canales de bajo coste (alianzas clínicas, orgánico) antes de escalar en pago; definir ratio LTV:CAC mínimo antes de invertir |
| **Dependencia de un proveedor externo de modelo multimodal** _(nuevo)_   | Medio (coste/disponibilidad)                    | Diseñar la Edge Function de forma que el proveedor de IA sea intercambiable; monitorizar alternativas de coste/calidad               |

---

## 17. Métricas y analítica a instrumentar desde el MVP

- Funnel de onboarding (registro → primera mascota → primer log diario).
- Registros diarios completados por mascota/semana (North Star).
- Uso de la función de IA (nº de análisis, % marcados como útiles).
- Retención D1/D7/D30.
- Conversión free → premium y motivo de upgrade (paywall trigger).
- Notificaciones: tasa de apertura y de opt-out.
- **Diferenciación percibida** _(nuevo)_: encuesta corta en activación sobre por qué se eligió Kitom frente a alternativas conocidas.
- **CAC y canal de adquisición** _(nuevo)_: coste por instalación/activación por canal, para poder comparar contra el ratio LTV:CAC definido en sección 15.

---

## 18. Roadmap resumido

| Fase                | Contenido                                                                                                 | Duración estimada |
| ------------------- | --------------------------------------------------------------------------------------------------------- | ----------------- |
| 0. Discovery        | Validación, diseño, alianza veterinaria, elección de ángulo de diferenciación, test frente a competidores | 4–6 semanas       |
| 1. MVP              | Todo lo marcado _Must_ en sección 8, con onboarding progresivo y economía de IA calibrada                 | 12–14 semanas     |
| 2. Post-lanzamiento | Co-tutores, PDF, mejoras de IA, más idiomas, suscripciones completas, primeras alianzas con clínicas      | 4 meses           |
| 3. Escalado         | Web, modelo propio de IA, portal veterinario, alianzas B2B                                                | 6+ meses          |

---

## 19. Preguntas abiertas para próxima iteración

1. ¿Qué proveedor de modelo multimodal se usará para el análisis de fotos (coste, calidad, políticas de uso de imágenes)?
2. ¿Se dispone ya de un veterinario colaborador para validar contenidos y prompts, o hay que buscarlo antes del desarrollo? ¿Está dispuesto a actuar también como canal de distribución piloto?
3. ¿Mercados de lanzamiento prioritarios? (afecta a idiomas, cumplimiento normativo, precios y regulación de telemedicina veterinaria)
4. ¿Se plantea versión "clínica" para veterinarias como canal de adquisición (B2B2C) antes de los 12 meses, dado que el mercado ya está saturado en D2C puro?
5. **¿Cuál de los dos ángulos de diferenciación (confianza clínica visible vs. especialización de nicho) se valida mejor en Fase 0?** _(nuevo)_
6. **¿Cuál es el ratio LTV:CAC mínimo aceptable antes de invertir en adquisición pagada, dado el nivel de saturación de la categoría?** _(nuevo)_
7. **¿Qué límite de análisis de IA en el plan free es sostenible según el coste real de inferencia, sin perder usuarios frente a alternativas gratuitas como Omelo?** _(nuevo)_

---

_Fin del documento._
