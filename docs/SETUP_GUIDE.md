# Kitom — Guía de configuración de cuentas y servicios

Pasos, en orden, de lo que solo puede hacer el responsable en los paneles de Supabase, Google y el
proveedor de correo. Por qué funciona así: [`AUTH.md`](AUTH.md). Publicación y builds:
[`DEPLOYMENT.md`](DEPLOYMENT.md) §8.

Comprobado el 2026-11-04; dominio y correo, el 2026-11-07. Lo marcado **[confirmar]** no se ha podido verificar en una fuente oficial, o
depende de lo que muestre tu consola: compruébalo allí antes de actuar. Esto no es asesoramiento legal.

## Resumen de decisiones

| Pregunta | Respuesta | Motivo |
|---|---|---|
| ¿Cuenta de Play personal o de organización? | **Personal ahora**, salvo que la empresa ya exista | La de organización exige D-U-N-S y una entidad real. La app se puede transferir después |
| ¿Hace falta dominio? | **Sí**: `kitom.app` (Cloudflare, comprado el 2026-11-07) | Play no lo exige, pero sin él no hay emails fiables a usuarios reales ni marca propia en la pantalla de Google |
| ¿Hace falta SMTP propio? | **Sí, es obligatorio para usuarios reales**: Resend | El SMTP de Supabase solo entrega a miembros de la organización y unos 2 correos/hora |
| ¿Zoho y Resend a la vez? | **Sí, son compatibles** | Zoho es el buzón (`soporte@kitom.app`, registros en la raíz) y Resend envía los correos de la app (registros en `send.` y `resend._domainkey`) |
| ¿Quitar la URI `…supabase.co` de Google? | **Todavía no** | Sin ella, «Continuar con Google» deja de funcionar. Opciones en el [paso 4](#la-uri-de-supabaseco) |
| ¿Los términos en la app bastan? | No | La app ya los muestra dentro, pero Play pide además una URL pública: `site/` sigue publicada |

## Orden recomendado

1. [Web en kitom.app](#1-web-en-kitomapp-github-pages): sin ella, los enlaces de email no llevan a ningún sitio.
2. [Correo](#2-correo-zoho-y-resend).
3. [Supabase Auth](#3-supabase-auth).
4. [Google Cloud](#4-google-cloud-continuar-con-google).
5. [Comprobar con la APK](#5-comprobar-con-la-apk).
6. [Google Play](#6-cuenta-de-google-play).

Los pasos 3 y 4 se repiten en el proyecto de producción de Supabase cuando exista; `kitom-dev` sirve para
probar, no para usuarios reales.

## 1. Web en kitom.app (GitHub Pages)

La carpeta `site/` ya se publica en `https://brotherz11.github.io/Kitom/`. Pasarla a `kitom.app`:

1. **Verifica el dominio en GitHub** (evita que otra cuenta lo use): tu foto › **Settings › Pages › Add a
   domain**, escribe `kitom.app` y crea en Cloudflare el registro TXT que te indique
   (`_github-pages-challenge-brotherz11`). Pulsa **Verify**.
2. **Registros DNS en Cloudflare** (**kitom.app › DNS › Records**), todos con la nube gris, **DNS only**:

   | Tipo | Nombre | Contenido |
   |---|---|---|
   | A | `@` | `185.199.108.153` |
   | A | `@` | `185.199.109.153` |
   | A | `@` | `185.199.110.153` |
   | A | `@` | `185.199.111.153` |
   | AAAA | `@` | `2606:50c0:8000::153` |
   | AAAA | `@` | `2606:50c0:8001::153` |
   | AAAA | `@` | `2606:50c0:8002::153` |
   | AAAA | `@` | `2606:50c0:8003::153` |
   | CNAME | `www` | `brotherz11.github.io` |

   No toques los registros MX y TXT de Zoho y Resend: conviven con estos. Con la nube naranja (proxy),
   GitHub puede no conseguir el certificado.
3. **Repositorio Kitom › Settings › Pages › Custom domain:** `kitom.app` › **Save**. Espera a que diga
   «DNS check successful» y marca **Enforce HTTPS**. El certificado puede tardar desde minutos hasta un día.
   Los dominios `.app` solo funcionan con HTTPS, así que hasta entonces el navegador no abrirá la web.
4. Comprueba que abren:
   - `https://kitom.app/` (inicio)
   - `https://kitom.app/privacy.html`
   - `https://kitom.app/terms.html`
   - `https://kitom.app/delete-account.html`
   - `https://kitom.app/auth/callback.html?flow=signup`, que debe decir «¡Email confirmado!»
   - `https://brotherz11.github.io/Kitom/privacy.html`, que debe llevar a `kitom.app`

La fuente oficial de esas IP es la [guía de dominios de GitHub Pages](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).

## 2. Correo (Zoho y Resend)

Cada servicio hace una cosa, y no se pisan:

| Servicio | Para qué | Registros DNS |
|---|---|---|
| Zoho Mail | Buzón `soporte@kitom.app`: recibir y responder a usuarios, y el email público de Play y Google | En la raíz: MX (`mx.zoho.eu`…), SPF `v=spf1 include:zohomail.eu ~all` y DKIM `zmail._domainkey` |
| Resend | Correos automáticos de la app (confirmar el email, recuperar la contraseña) | En `send.kitom.app` (MX y SPF) y DKIM `resend._domainkey` |

Comprobado en el DNS público el 2026-11-07: los dos están bien publicados.

Reglas para no romperlo:

- **Un solo registro SPF por nombre.** Si algún día otro servicio envía como `@kitom.app` desde la raíz, añade
  su `include:` al SPF de Zoho, nunca un segundo `v=spf1`.
- **Añade DMARC** (falta): registro TXT con nombre `_dmarc` y valor `v=DMARC1; p=none; rua=mailto:soporte@kitom.app`.
  Gmail y Yahoo lo tienen en cuenta para no mandar los correos a spam. Cuando lleves unas semanas sin
  problemas, cambia `p=none` por `p=quarantine`.

**¿Es Zoho buena opción?** Sí, para empezar. Su plan gratuito solo funciona en su web y su app (sin IMAP)
**[confirmar en tu plan]**. Alternativas: Cloudflare Email Routing (gratis, pero solo reenvía a tu Gmail;
para responder como `soporte@` hay que configurar más cosas) o Google Workspace (de pago). No hace falta
cambiar.

**Resend** (ya creado): dominio `kitom.app` en **Verified** y una **API key** con permiso de envío. La clave
es un secreto: no la pegues en el repositorio.

**Conectarlo a Supabase** (**Project Settings › Authentication › SMTP Settings**, o el apartado de SMTP
bajo Authentication si tu panel lo muestra allí):

| Campo | Valor |
|---|---|
| Enable Custom SMTP | activado |
| Sender email | `soporte@kitom.app` (si alguien responde, la respuesta llega a Zoho) |
| Sender name | `Kitom` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | la clave de Resend |

Después, en **Authentication › Rate Limits**, sube «emails sent» a 30 por hora o más. Hay una
[integración directa de Resend](https://supabase.com/partners/integrations/resend) que rellena estos campos.

Prueba el envío pidiendo «¿Has olvidado la contraseña?» con un email tuyo y mira **Resend › Emails**.

## 3. Supabase Auth

Panel: **Authentication** del proyecto. Hazlo cuando `https://kitom.app/auth/callback.html` ya abra (paso 1).

**URL Configuration**

- **Site URL:** `https://kitom.app/auth/callback.html`
- **Redirect URLs**, añade:
  - `https://kitom.app/auth/callback.html**` (enlaces de email)
  - `kitom://**` (vuelta de Google a la app)
  - `https://brotherz11.github.io/Kitom/auth/callback.html**`: déjala mientras uses APK compiladas antes del
    2026-11-07, que aún piden esa dirección. Quítala cuando ya no quede ninguna.
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
2. **Verifica `kitom.app` en [Search Console](https://search.google.com/search-console)** con la misma cuenta:
   propiedad de tipo **Dominio**, `kitom.app`. Te dará un TXT para Cloudflare (o lo crea solo si aceptas
   la conexión con Cloudflare). Google no deja usar un dominio que no hayas verificado.
3. **Branding:**

   | Campo | Valor |
   |---|---|
   | Nombre de la app | `Kitom` |
   | Correo de asistencia | El desplegable solo ofrece tu cuenta de Google y los grupos que administras **[confirmar]**: elige tu cuenta |
   | Logotipo | `frontend/assets/brand/store/kitom-logo-google-120.jpg` (120 × 120, JPG; Google admite JPG, PNG o BMP de hasta 1 MB) |
   | Página principal de la aplicación | `https://kitom.app/` |
   | Política de privacidad | `https://kitom.app/privacy.html` |
   | Condiciones del servicio | `https://kitom.app/terms.html` |
   | Dominios autorizados | `kitom.app` y, mientras exista la URI de Supabase, `pxlqiyspovaevcusyszj.supabase.co` |
   | Correo del desarrollador | `soporte@kitom.app` |

   Las tres URL ya llevan `https://`. Funcionan cuando termines el paso 1.
4. **Audience:** tipo **External**.
5. **Data Access:** solo `openid`, `email` y `profile`. Al no ser sensibles, no exigen verificación de la app.
6. **Audience › Publish app** (de *Testing* a *In production*). Mientras siga en *Testing*, solo entran las
   cuentas de **Test users**, y las demás ven un error de acceso.

**Credenciales** (**Clients › Create client**):

1. Tipo: **Web application**. No hace falta un cliente Android: el acceso va por el navegador.
2. **Authorized redirect URIs:** `https://pxlqiyspovaevcusyszj.supabase.co/auth/v1/callback`
3. Copia el Client ID y el Client secret a **Supabase › Authentication › Sign In / Providers › Google**. Ese
   secreto solo vive en Supabase.

### La URI de `supabase.co`

**Por qué está.** Con el acceso por navegador, Google devuelve al usuario a Supabase, y Supabase a la app.
Google solo acepta las URI de esta lista, así que es una medida de seguridad, no un fallo: si quitas
`https://pxlqiyspovaevcusyszj.supabase.co/auth/v1/callback`, el acceso da `redirect_uri_mismatch`.

**Lo que sí es un problema** es lo que ve el usuario («continuar a `pxlqiyspovaevcusyszj.supabase.co`») y la
verificación de marca, que es lo que hace aparecer «Kitom» y el logo. Google [exige verificar todos los dominios
autorizados](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification),
también el de las URI de un cliente Web, y `supabase.co` no es tuyo. Hay dos salidas:

| | Acceso nativo en Android (recomendado) | Dominio propio en Supabase |
|---|---|---|
| Qué ve el usuario | El selector de cuentas de Android, sin navegador | El navegador con `auth.kitom.app` |
| URI de redirección | Ninguna: se quita la de `supabase.co` | `https://auth.kitom.app/auth/v1/callback` |
| Coste | Gratis | Plan Pro (25 USD/mes) más el complemento de 10 USD/mes ([precio](https://supabase.com/docs/guides/platform/manage-your-usage/custom-domains)) |
| Cambios | Un paquete nuevo en la app y una build nueva; clientes Android en Google Cloud con la huella SHA-1 de cada firma | Ninguno en la app más allá de la URL de Supabase |
| Web | El acceso con Google en la versión web se quitaría o seguiría con `supabase.co` | Igual que ahora |

Ninguna de las dos está hecha. Hasta decidir: rellena el Branding, sube el logo (no se verá hasta verificar) y
**no** pidas todavía **Verify branding**.

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
durante 14 días y que tu nombre quede público. Como email de desarrollador usa `soporte@kitom.app`, que ya es
el de la app y las páginas legales.

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
