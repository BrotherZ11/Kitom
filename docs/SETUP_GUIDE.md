# Kitom — Guía de configuración de cuentas y servicios

Pasos, en orden, de lo que solo puede hacer el responsable en los paneles de Supabase, Google y el
proveedor de correo. Por qué funciona así: [`AUTH.md`](AUTH.md). Publicación y builds:
[`DEPLOYMENT.md`](DEPLOYMENT.md) §8.

Comprobado el 2026-11-04. Lo marcado **[confirmar]** no se ha podido verificar en una fuente oficial, o
depende de lo que muestre tu consola: compruébalo allí antes de actuar. Esto no es asesoramiento legal.

## Resumen de decisiones

| Pregunta | Respuesta | Motivo |
|---|---|---|
| ¿Cuenta de Play personal o de organización? | **Personal ahora**, salvo que la empresa ya exista | La de organización exige D-U-N-S y una entidad real. La app se puede transferir después |
| ¿Hace falta dominio? | **Sí, muy recomendable** (unos 10-20 €/año **[confirmar]**) | Play no lo exige, pero sin él no hay emails fiables a usuarios reales ni marca propia en la pantalla de Google |
| ¿Hace falta SMTP propio? | **Sí, es obligatorio para usuarios reales** | El SMTP de Supabase solo entrega a miembros de la organización y unos 2 correos/hora |
| ¿Los términos en la app bastan? | No | La app ya los muestra dentro, pero Play pide además una URL pública: `site/` sigue publicada |

## Orden recomendado

1. [GitHub Pages](#1-github-pages): sin él, los enlaces de email no llevan a ningún sitio.
2. [Dominio y correo](#2-dominio-y-correo-resend).
3. [Supabase Auth](#3-supabase-auth).
4. [Google Cloud](#4-google-cloud-continuar-con-google).
5. [Comprobar con la APK](#5-comprobar-con-la-apk).
6. [Google Play](#6-cuenta-de-google-play).

Los pasos 3 y 4 se repiten en el proyecto de producción de Supabase cuando exista; `kitom-dev` sirve para
probar, no para usuarios reales.

## 1. GitHub Pages

1. Sube `main` (`git push`). El workflow `Pages` se lanza solo porque el cambio toca `site/`.
2. Si no arranca: **GitHub › Actions › Pages › Run workflow**.
3. Comprueba que abren:
   - `https://brotherz11.github.io/Kitom/privacy.html`
   - `https://brotherz11.github.io/Kitom/terms.html`
   - `https://brotherz11.github.io/Kitom/delete-account.html`
   - `https://brotherz11.github.io/Kitom/auth/callback.html?flow=signup`, que debe decir «¡Email confirmado!»

## 2. Dominio y correo (Resend)

**Comprar el dominio.** En cualquier registrador (Cloudflare, Namecheap, DonDominio…). Elige un nombre que
quieras conservar: acabará en los correos, en Google y en Play.

**Crear el correo:**

1. Crea una cuenta en [Resend](https://resend.com). El plan gratuito da 3000 correos al mes y 100 al día.
2. **Domains › Add domain**: añade tu dominio (o `mail.tudominio.com`) y una región de la UE si la ofrece.
3. Copia los registros DNS que te da (SPF y DKIM) en tu registrador y espera a que salga **Verified**.
4. **API Keys › Create**: crea una clave con permiso de envío. Es un secreto: no la pegues en el repositorio.

**Conectarlo a Supabase** (**Project Settings › Authentication › SMTP Settings**, o el apartado de SMTP
bajo Authentication si tu panel lo muestra allí):

| Campo | Valor |
|---|---|
| Enable Custom SMTP | activado |
| Sender email | `no-reply@tudominio.com` |
| Sender name | `Kitom` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | la clave de Resend |

Después, en **Authentication › Rate Limits**, sube «emails sent» a 30 por hora o más. Hay una
[integración directa de Resend](https://supabase.com/partners/integrations/resend) que rellena estos campos.

**Sin dominio todavía (solo para la beta):** una cuenta de Gmail con verificación en dos pasos y una
«contraseña de aplicación» (`smtp.gmail.com`, puerto 465) funciona con pocos usuarios **[confirmar límites]**.
Los correos pueden caer en spam y el remitente será esa cuenta, así que no sirve para producción.

## 3. Supabase Auth

Panel: **Authentication** del proyecto.

**URL Configuration**

- **Site URL:** `https://brotherz11.github.io/Kitom/auth/callback.html`
- **Redirect URLs**, añade:
  - `https://brotherz11.github.io/Kitom/auth/callback.html**` (enlaces de email)
  - `kitom://**` (vuelta de Google a la app)
  - Solo en `kitom-dev`, para desarrollar: `exp://**`

Si una URL no está en la lista, Supabase usa la Site URL sin avisar.

**Emails › Templates.** Con SMTP propio ya activado, pega cada plantilla de `supabase/templates/`:

| Plantilla | Archivo | Asunto |
|---|---|---|
| Confirm signup | `confirmation.html` | `Confirma tu email en Kitom` |
| Reset password | `recovery.html` | `Cambia tu contraseña de Kitom` |
| Change email address | `email_change.html` | `Confirma el cambio de email en Kitom` |
| Reauthentication | `reauthentication.html` | `Tu código de seguridad de Kitom` |

Antes del SMTP propio puede que el panel no te deje editarlas: [desde el 3 de junio de 2026](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier),
los proyectos gratuitos nuevos con el SMTP por defecto no pueden.

**Sign In / Providers › Email**

- **Confirm email:** activado (ya lo está en `kitom-dev`).
- **Minimum password length:** 8.
- **Secure password change:** activado.
- **Prevent use of leaked passwords:** actívalo si tienes plan Pro **[confirmar]**. En el plan gratuito queda
  desactivado; no bloquea la publicación.

**Sign In / Providers › Google:** paso 4.

## 4. Google Cloud («Continuar con Google»)

Usa la cuenta de Google que vaya a ser dueña del proyecto: conviene que sea la misma de Play.

**Pantalla de consentimiento** ([console.cloud.google.com](https://console.cloud.google.com) › **Google Auth Platform**):

1. Crea o elige un proyecto llamado `Kitom`.
2. **Branding:** nombre `Kitom`, email de soporte, logotipo (`frontend/assets/brand/`) y las URL de privacidad y
   términos del paso 1.
3. **Audience:** tipo **External**.
4. **Data Access:** solo `openid`, `email` y `profile`. Al no ser sensibles, no exigen verificación de la app.
5. **Audience › Publish app** (de *Testing* a *In production*). Mientras siga en *Testing*, solo entran las
   cuentas de **Test users**, y las demás ven un error de acceso.

**Credenciales** (**Clients › Create client**):

1. Tipo: **Web application**. No hace falta un cliente Android: el acceso va por el navegador.
2. **Authorized redirect URIs:** `https://pxlqiyspovaevcusyszj.supabase.co/auth/v1/callback`
3. Copia el Client ID y el Client secret a **Supabase › Authentication › Sign In / Providers › Google**. Ese
   secreto solo vive en Supabase.

**Nombre que ve el usuario.** Sin verificar la marca, Google enseña `…supabase.co` en vez de «Kitom». Para que
salga Kitom:

1. Publica la web en tu dominio (GitHub › Settings › Pages › Custom domain) y cambia `LEGAL_SITE_URL` en
   `frontend/src/lib/legal-links.ts`, la Site URL y las Redirect URLs.
2. Verifica el dominio en [Search Console](https://search.google.com/search-console) con la misma cuenta.
3. **Branding › Verify branding**. Google [tarda unos 2-3 días](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification).

Puede que Google pida verificar también el dominio de la URL de redirección, y eso requeriría un dominio
personalizado en Supabase, que es de pago **[confirmar]**. No bloquea el acceso: solo cambia lo que se ve.

## 5. Comprobar con la APK

Con la APK instalada en un móvil real:

| Prueba | Resultado esperado |
|---|---|
| Registro con un email tuyo | Llega «Confirma tu email» con el diseño de Kitom |
| Abrir ese enlace en el móvil | Se abre la app con la sesión iniciada |
| Otro registro, abriendo el enlace en el PC | «¡Email confirmado!»; luego entras en la app con la contraseña |
| «¿Has olvidado la contraseña?» y abrir el enlace en el móvil | Pantalla para elegir contraseña nueva |
| Continuar con Google | Vuelve a la app con la sesión iniciada |

**Si algo falla:**

| Síntoma | Causa probable | Solución |
|---|---|---|
| «No hay conexión» con red | La APK apunta a otro servidor | Vuelve a compilar sin variables `EXPO_PUBLIC_*` en la terminal (`DEPLOYMENT.md` §4) |
| No llega el correo | Sin SMTP propio, o dominio sin verificar | Paso 2; mira **Authentication › Logs** y **Resend › Emails** |
| El enlace del correo abre otra página | Falta en Redirect URLs | Paso 3 |
| «Este enlace ya no vale» sin haberlo pulsado antes | Caducado, o un antivirus de correo lo abrió antes que tú | Pide otro; si el email ya consta confirmado, inicia sesión |
| Google: `redirect_uri_mismatch` | URI mal copiada | Paso 4, credenciales |
| Google: acceso bloqueado o `access_denied` | App en *Testing* | Publícala o añade la cuenta a Test users |
| Google acaba bien, pero no vuelve a la app | Falta `kitom://**` | Paso 3 |

## 6. Cuenta de Google Play

### Cuál elegir

|  | Personal | Organización |
|---|---|---|
| Para quién | Uso personal, aunque ganes dinero | Empresa o actividad comercial registrada |
| Necesitas | Nombre legal, domicilio, teléfono y email verificados | Lo anterior de la empresa, más **D-U-N-S**, web y teléfono |
| Lo que se ve en Play | Tu nombre legal, país y email de desarrollador (también la dirección si monetizas) | Nombre, dirección, email y teléfono de la empresa |
| Antes de producción | **Prueba cerrada con 12 personas o más durante 14 días seguidos** y revisión (~7 días) | Según la comunidad, sin ese requisito **[confirmar]** |
| Tiempo hasta empezar | Días | Semanas: empresa más D-U-N-S (hasta 30 días) |
| Coste | Pago único de 25 USD | Pago único de 25 USD, más constituir la empresa |

Fuentes: [tipos de cuenta](https://support.google.com/googleplay/android-developer/answer/13634885?hl=es) ·
[información requerida](https://support.google.com/googleplay/android-developer/answer/13628312?hl=es) ·
[requisito de pruebas](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en) ·
[comunidad, 12 testers](https://support.google.com/googleplay/android-developer/community-guide/255621488/everything-about-the-12-testers-requirement?hl=en).

**Recomendación: personal**, porque hoy no hay empresa y Kitom es gratuita. El coste real son los 12 testers
durante 14 días y que tu nombre y email queden públicos. Si prefieres no exponerlos, crea un email solo para
Kitom y cambia `SUPPORT_EMAIL` y las páginas de `site/`.

**Un riesgo que comprobar antes de pagar.** Google [exige cuenta de organización para ciertas categorías](https://support.google.com/googleplay/android-developer/answer/13634885?hl=es),
entre ellas **salud**, y la [declaración de apps de salud](https://support.google.com/googleplay/android-developer/answer/14738291?hl=en)
es obligatoria para todas. Las apps para mascotas no aparecen en lo que he consultado **[confirmar]**. Si Play
considerase Kitom una app de salud, haría falta una cuenta de organización. Puedes preguntarlo al soporte de
Play Console antes de la revisión.

**Pasar a empresa más adelante.** Crea la cuenta de organización y [transfiere la app](https://support.google.com/googleplay/android-developer/contact/appt)
desde la personal: la ficha, los usuarios y el nombre del paquete `com.kitom.app` se conservan **[confirmar en
el formulario]**. Necesitas las dos cuentas activas y el identificador de la transacción de registro de la de
destino. Si después cierras la personal, Google [devuelve su tarifa](https://support.google.com/googleplay/android-developer/answer/9023898?hl=en).
Al cambiar de responsable hay que actualizar también la política, los términos y las declaraciones.

### Camino A: cuenta personal

1. Entra con la cuenta de Google que será dueña en [play.google.com/console/signup](https://play.google.com/console/signup).
2. Elige **uso personal** («Yourself»).
3. Rellena el perfil de pagos con tu nombre legal y tu domicilio, tal como figuran en tu documento.
4. Añade el email de desarrollador (público) y un teléfono de contacto, y verifica los dos.
5. Paga la tarifa y sube el documento de identidad que te pidan.
6. Si la consola pregunta si eres comerciante («trader», normativa europea), contesta según tu caso **[confirmar]**.
7. Crea la app `Kitom` (app, gratuita) y sigue `DEPLOYMENT.md` §8 E y `STORE_LISTING.md`.
8. **Pruebas › Prueba cerrada:** sube la build `production` de EAS e invita a 12 personas o más. Deben
   permanecer apuntadas 14 días seguidos: invita a unas cuantas de más por si alguien se va.
9. **Solicita acceso a producción** en el panel, cuando se cumpla el plazo, y responde al cuestionario.

### Camino B: cuenta de organización

1. **Constituye la entidad.** Si es una SL, con notaría y Registro Mercantil. Pide consejo a una gestoría.
   Si un autónomo puede obtener D-U-N-S y usar esta cuenta: **[confirmar con Dun & Bradstreet]**.
2. **Pide el D-U-N-S** en la [página de Dun & Bradstreet para Google](https://support.google.com/googleplay/android-developer/answer/13628312?hl=es).
   Es gratis y puede tardar hasta 30 días. Desconfía de terceros que cobran por ello.
3. **Comprueba los datos.** El nombre y la dirección de D&B deben coincidir letra por letra con el perfil de
   pagos que crearás en Google.
4. **Prepara lo público:** web en tu dominio, email de la empresa (`hola@tudominio.com`) y teléfono.
5. **Crea una cuenta de Google de la empresa**, no tu Gmail personal.
6. En [play.google.com/console/signup](https://play.google.com/console/signup), elige **organización**.
7. Crea el perfil de pagos de organización e introduce el D-U-N-S.
8. Añade la web, verifícala y rellena el email y el teléfono públicos y los de contacto con Google.
9. Paga la tarifa y entrega los documentos que pida la verificación.
10. Cambia el responsable en `site/privacy.html` y `site/terms.html` (y `en/`), ejecuta `npm run legal:build`,
    cambia `SUPPORT_EMAIL` y actualiza `docs/PRIVACY.md`.
11. Crea la app y sigue `DEPLOYMENT.md` §8 E y `STORE_LISTING.md`.
12. Usa la misma organización en Google Cloud (paso 4) para que el proyecto no dependa de una persona.
