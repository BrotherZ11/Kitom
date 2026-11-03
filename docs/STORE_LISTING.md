# Kitom — Ficha y declaraciones de Google Play (borrador)

Textos para copiar en Play Console. Revisados contra lo que la app hace hoy (2026-11-03); las respuestas de
declaraciones son una propuesta a validar en la consola y con asesoría legal, porque los formularios cambian. Regla de
producto: nunca «diagnóstico» ni «diagnostica»; se habla de «orientación» y «señales de alerta». Inventario de datos:
[`PRIVACY.md`](PRIVACY.md).

## Ficha (español)

**Nombre** (máx. 30): `Kitom: bienestar de tu mascota`

**Descripción breve** (máx. 80): `Registra cómo está tu perro o gato cada día y entiende sus cambios.`

**Descripción completa** (máx. 4000):

```text
El buen cuidado es una suma de días. Kitom te ayuda a registrar en menos de un minuto cómo está tu perro o tu gato, a entender sus cambios y a saber cuándo conviene ir al veterinario.

REGISTRA SU DÍA
Energía, apetito, ánimo y actividad en unos segundos. Funciona también sin conexión: lo guardamos en tu móvil y lo subimos cuando vuelvas a tener red.

ENTIENDE SUS CAMBIOS
Gráficos por semana y por mes, y un aviso cuando los últimos días se apartan de lo normal en tu mascota.

NO OLVIDES SUS CUIDADOS
Vacunas, medicación, citas, baños y desparasitación, con recordatorios a su hora, repetición y posponer.

CONSULTA CON UNA FOTO
Si algo te preocupa, describe las señales y añade una foto: recibirás una orientación con posibles causas, señales de alerta y cuándo acudir al veterinario. Incluye 3 consultas al mes.

CUÍDALA EN EQUIPO
Invita a tu familia o a quien te ayude, con permisos de edición o solo de lectura.

MANTÉN LA RUTINA
Rachas y logros para que el hábito se quede.

TUS DATOS, BAJO TU CONTROL
Puedes descargar tus datos y eliminar tu cuenta desde la propia app. Sin publicidad y sin vender tus datos.

IMPORTANTE
Kitom ofrece orientación general sobre el bienestar de tu mascota. No es una valoración médica y no sustituye la atención veterinaria profesional. Ante una urgencia, acude a un veterinario.
```

## Listing (English)

**Name** (max 30): `Kitom: pet wellbeing tracker`

**Short description** (max 80): `Log how your dog or cat is doing each day and understand their changes.`

**Full description** (max 4000):

```text
Good care is a sum of days. Kitom helps you log how your dog or cat is doing in under a minute, understand their changes and know when it's worth seeing a vet.

LOG THEIR DAY
Energy, appetite, mood and activity in seconds. It also works offline: we keep it on your phone and upload it when you're back online.

UNDERSTAND THEIR CHANGES
Weekly and monthly charts, and a notice when recent days differ from what's normal for your pet.

DON'T FORGET THEIR CARE
Vaccines, medication, appointments, baths and deworming, with on-time reminders, repeats and snooze.

ASK WITH A PHOTO
If something worries you, describe the signs and add a photo: you'll get guidance with possible causes, warning signs and when to see a vet. Includes 3 checks a month.

CARE AS A TEAM
Invite family or helpers, with edit or read-only access.

KEEP THE ROUTINE
Streaks and achievements so the habit sticks.

YOUR DATA, UNDER YOUR CONTROL
You can download your data and delete your account from the app itself. No ads and no selling your data.

IMPORTANT
Kitom offers general guidance about your pet's wellbeing. It isn't a medical assessment and doesn't replace professional veterinary care. In an emergency, go to a vet.
```

## Datos de la ficha

| Campo | Propuesta |
|---|---|
| Categoría | Estilo de vida (mascotas) |
| Política de privacidad | `https://brotherz11.github.io/Kitom/privacy.html` |
| Eliminación de cuenta | `https://brotherz11.github.io/Kitom/delete-account.html` |
| Email de contacto | el de `frontend/src/lib/legal-links.ts` |
| Público objetivo | mayores de 16 años (como dicen los términos); no dirigida a menores |
| Anuncios | no contiene |
| Precio | gratis, sin compras en la app |
| Acceso para la revisión | crear una cuenta de prueba con una mascota y varios registros, e indicarla en «Acceso a la app» (hay inicio de sesión obligatorio) |
| Capturas (mín. 2, recomendado 4–8) | Hoy, registro del día, historial, agenda, consulta con resultado, tarjeta de señales; con datos de ejemplo, sin datos reales |

## Seguridad de los datos (Data Safety)

Recogidos, cifrados en tránsito y con eliminación a petición del usuario. Ninguno se usa para publicidad.

| Tipo de dato | Finalidad | ¿Opcional? |
|---|---|---|
| Información personal: email, nombre | gestión de la cuenta, funcionamiento | email obligatorio; nombre opcional |
| Fotos | funcionamiento (ficha y consultas) | opcional |
| Otro contenido del usuario: registros, notas, agenda, datos de la mascota | funcionamiento | sí, lo aporta el usuario |
| Información de la app y rendimiento: registros de fallos y diagnósticos técnicos | analítica de estabilidad (Sentry), solo si se activa el DSN | no |

- **Compartidos:** Supabase, Google (Gemini) y Sentry actúan como proveedores de servicio por cuenta de Kitom; según la
  definición de Play eso no suele contar como «compartir». **A validar:** la foto y los datos de la mascota salen hacia Google
  para preparar la orientación, y debe quedar reflejado como corresponda.
- **Datos de salud:** son de la mascota, no del usuario. Comprobar si el formulario pide declararlos igualmente.
- **Sin** ubicación, contactos, identificadores publicitarios ni seguimiento entre apps.

## Permisos que Play puede pedir justificar

**`SCHEDULE_EXACT_ALARM`** (texto propuesto):

> Kitom permite programar recordatorios de medicación, vacunas y citas veterinarias de las mascotas. Estos avisos deben llegar a la
> hora exacta elegida por el usuario: una medicación fuera de hora puede afectar al tratamiento del animal. El usuario crea cada
> recordatorio y puede conceder o retirar el permiso; si no lo concede, los avisos pueden retrasarse.

Si Play no acepta el uso, la alternativa es quitar el permiso: el código ya contempla que no esté concedido.

**Cámara y fotos:** solo al elegir una foto de la mascota o de una consulta; desde Android 13 se usa el selector del sistema, sin
permiso de almacenamiento.

**Notificaciones:** recordatorios locales; se piden con explicación durante la configuración inicial.

## Otras declaraciones

- **Clasificación de contenido:** cuestionario IARC; sin violencia, sexo, drogas ni compras. Interacción entre usuarios limitada
  (compartir una mascota con invitados por email; sin chat ni contenido público).
- **IA generativa:** si la consola pregunta por contenido generado por IA, indicar que la orientación se genera con un modelo; el
  resultado no es público, siempre lleva el aviso y se puede valorar dentro de la app.
- **Apps de salud:** la app es de mascotas, no de salud humana; comprobar si aplica la declaración de apps de salud.
- **Cuentas personales nuevas de Play:** suelen exigir una prueba cerrada con testers durante varios días antes de producción. Verificar
  el requisito vigente en la consola y prever ese plazo.
