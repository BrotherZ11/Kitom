# Kitom — Autenticación (Supabase Auth + Expo)

Cómo funciona la autenticación en la app y qué hay que configurar en Supabase y en Google para que
los enlaces de email y el login con Google funcionen. Código: `frontend/src/features/auth/`.

## 1. Métodos disponibles

| Método | Estado |
|---|---|
| Email + contraseña (registro, login, logout) | ✅ (mínimo 8 caracteres y aviso legal, sección 5) |
| Confirmación de email por enlace | ✅ (requiere configuración, sección 3) |
| Reenviar el email de confirmación | ✅ (espera de 60 s, sección 5) |
| Recuperación de contraseña por enlace | ✅ (requiere configuración, sección 3; sobrevive a cerrar la app) |
| Cambiar la contraseña en ajustes (pide la actual) | ✅ (sección 5) |
| Crear contraseña en una cuenta solo de Google | ✅ en `/settings/password`; falta la entrada en Seguridad (sección 5) |
| Google (OAuth en navegador del sistema) | ✅ (requiere configuración, sección 4) |
| Teléfono (OTP) | Retirado del alcance (decisión 2026-10-29; PRD §8.1 es histórico) |

## 2. Cómo funcionan los enlaces (deep links)

La app usa el **flujo PKCE** (`flowType: 'pkce'` en `src/lib/supabase.ts`):

1. Al registrarse, pedir recuperación o iniciar con Google, la app guarda un *code verifier* en el
   almacenamiento seguro del dispositivo y envía a Supabase una URL de retorno (`redirectTo`).
2. Supabase verifica el enlace o el login de Google y redirige a esa URL con un `code` de un solo uso.
3. La ruta `/auth-callback` (`src/app/auth-callback.tsx`, en el layout raíz: disponible con y sin
   sesión) intercambia el `code` por una sesión (`exchangeCodeForSession`). Sin el verifier local el
   `code` no sirve, así que no viajan tokens en la URL y otra app que registre el mismo esquema no
   puede robar la sesión. Si en 15 s no llega la URL o no hay respuesta, la pantalla lo dice y ofrece
   volver al inicio de sesión (o a la app, si hay sesión).
   - **Sin sesión** se canjea cualquier enlace (registro, recuperación, Google).
   - **Con sesión** solo se canjea la recuperación (p. ej. «Crear contraseña» desde ajustes). Un enlace
     de registro o el retorno de Google (que en Android también llega por aquí) no se canjea: no hace
     falta y podría cambiar de cuenta sin pasar por el cierre de sesión, que protege lo pendiente de
     sincronizar. Reglas puras y probadas en `features/auth/auth-callback-plan.ts`.
   - El mismo `code` se canjea una sola vez aunque llegue dos veces (`auth-redirect.ts`).
4. Tras el canje, la pantalla sale sola según el estado de la sesión:
   - confirmación de email o Google → app;
   - recuperación (evento `PASSWORD_RECOVERY`) → `/update-password`, y tras guardar → app. La
     recuperación pendiente se guarda en el dispositivo (sección 5).

URL de retorno generada con `Linking.createURL('auth-callback', { queryParams: { flow } })`:

| Entorno | URL |
|---|---|
| Release nativa, emails | `https://brotherz11.github.io/Kitom/auth/callback.html?flow=signup\|recovery` (página puente) |
| Release nativa, Google | `kitom://auth-callback?flow=oauth` |
| Development build | `kitom://auth-callback?flow=signup\|recovery\|oauth` |
| Expo Go | `exp://<ip>:<puerto>/--/auth-callback?flow=…` |
| Web (dev) | `http://localhost:8081/auth-callback?flow=…` |

**Página puente (`site/auth/callback.html`).** Un enlace `kitom://` en un correo abierto en el PC no lleva a
ninguna parte, y Supabase no permite saber dónde se abrirá. Por eso, en la app publicada, los enlaces de email
pasan por una página pública: en Android abre la app (`intent://`, con botón por si el navegador no lo permite
solo), en iOS con `kitom://`, y en el PC explica qué hacer. Para el registro, el email ya queda confirmado al
pulsar el enlace, así que basta con iniciar sesión en la app. La recuperación solo se completa en el móvil que
la pidió (el `code` no sirve sin su verifier), y la página pide otro enlace. Solo reenvía a la propia app, nunca
a una dirección de la URL.

El esquema `kitom` está en `frontend/app.json` (`expo.scheme`). **Cambiarlo exige generar un nuevo
development build**; Expo Go siempre usa `exp://`.

## 3. Configuración de Supabase (Dashboard de `kitom-dev`)

La hace el usuario en el Dashboard, paso a paso en [`SETUP_GUIDE.md`](SETUP_GUIDE.md). Claude no modifica la
configuración remota (`config push` está bloqueado). `supabase/config.toml` solo describe el entorno local.

**Authentication > URL Configuration**

- **Redirect URLs** (añadir):
  - `https://brotherz11.github.io/Kitom/auth/callback.html**`: enlaces de email de la app publicada.
  - `kitom://**`: builds de la app.
  - `exp://**`: Expo Go. **Solo en el proyecto de desarrollo, nunca en producción.**
  - `http://localhost:8081/**`: solo si se prueba la versión web en local.
- **Site URL**: es la URL que se usa si `redirectTo` no está en la lista; por eso los enlaces
  abrían `localhost`. Se recomienda la página puente: `https://brotherz11.github.io/Kitom/auth/callback.html`.

Si `redirectTo` no coincide con ninguna Redirect URL, Supabase usa la Site URL en silencio.

**Authentication > Emails (plantillas)**

Las de Kitom están en `supabase/templates/` (el stack local las lee por `config.toml`; en el proyecto remoto
se pegan en el Dashboard) y usan `{{ .ConfirmationURL }}`, que ya incluye la URL de retorno. Si se
personalizan, deben seguir usándola. No construir el enlace con
`{{ .SiteURL }}`, porque ignora el `redirectTo` de la app. La plantilla **Reauthentication** (código
para cambiar la contraseña, sección 5) debe incluir `{{ .Token }}`.

### Configuración recomendada en el Dashboard de producción

Checklist para el proyecto de producción (y, en lo posible, `kitom-dev`). La aplica el usuario; la app
ya está preparada para cada punto (SEC-09 / SEC-17 de `SECURITY_AUDIT.md`).

- [ ] **Sign In / Providers › Email › Confirm email**: activado. La app muestra «Revisa tu correo» y
      permite reenviar el email; el login de una cuenta sin confirmar ofrece reenviarlo.
- [ ] **Minimum password length: 8** (la app ya lo exige y lo muestra: `MIN_PASSWORD_LENGTH`). Si se
      sube, cambiar también la constante y el texto `auth.passwordRule` (una prueba los compara).
- [ ] **Password requirements**: opcional (p. ej. letras y dígitos). La app no los muestra; el error
      del servidor llega como «La contraseña no es suficientemente segura».
- [ ] **Prevent use of leaked passwords** (protección de contraseñas filtradas, HaveIBeenPwned):
      activado (requiere plan Pro). La app lo explica con su propio mensaje (`pwned_password`).
- [ ] **Secure password change**: activado. Con una sesión de más de 24 h, Supabase pide un código por
      email para cambiar la contraseña; la app lo pide en ajustes (sección 5). Comprobarlo con una cuenta
      real antes de publicar (no se puede probar en local sin reiniciar el Auth con otra configuración).
- [ ] **Require current password when updating** (si el Dashboard lo ofrece; en GoTrue,
      `GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD`): recomendable, pero **validarlo antes
      en un proyecto de pruebas**: la app ya envía `current_password` al cambiarla en ajustes, pero no
      se ha comprobado si el servidor también lo exige en la recuperación (que no la conoce). Si lo
      exige, la recuperación dejaría de funcionar: no activarlo en ese caso.
- [ ] **Emails › SMTP Settings**: SMTP propio (el de Supabase solo admite unos pocos emails por hora y
      no es para producción). Remitente y dominio con SPF/DKIM.
- [ ] **Rate Limits**: revisar «emails sent per hour» (con SMTP propio, p. ej. 30–100), «sign-ups and
      sign-ins» y «token verifications». La app espera 60 s entre reenvíos y muestra
      «Demasiados intentos» si el servidor rechaza por límite.
- [ ] **URL Configuration › Redirect URLs**: la página puente y `kitom://**` (y nada de `exp://**` ni
      `localhost` en producción); **Site URL**: la página puente.
- [ ] **Emails › Templates**: las de `supabase/templates/`. Exigen SMTP propio en proyectos gratuitos recientes.
- [ ] **Attack Protection › CAPTCHA**: solo si aparecen registros falsos (la app aún no envía
      `captchaToken`; activarlo sin cambiar la app rompería el registro).

## 4. Login con Google

La app abre el login de Google en el navegador del sistema (`expo-web-browser`,
`openAuthSessionAsync`) y vuelve por `/auth-callback`. Funciona en Expo Go y en builds sin módulos
nativos adicionales. La primera vez crea la cuenta; el trigger `handle_new_user` copia `full_name`
y `avatar_url` del perfil de Google a `profiles`.

**Google Cloud Console** (proyecto de Kitom):

1. *APIs & Services > OAuth consent screen*: configurar la pantalla de consentimiento (nombre de la
   app, email de soporte, dominios). Scopes: `openid`, `email` y `profile`. En modo *Testing*, añadir
   como *test users* las cuentas que van a probar.
2. *Credentials > Create credentials > OAuth client ID* de tipo **Web application**:
   - *Authorized redirect URIs*: `https://<project-ref>.supabase.co/auth/v1/callback`
     (aparece como *Callback URL* en la configuración del proveedor Google de Supabase).
3. Copiar el **Client ID** y el **Client secret**.

**Supabase Dashboard > Authentication > Sign In / Providers > Google**:

1. Activar Google.
2. Pegar el Client ID y el Client secret del cliente *Web application*.
3. Guardar. El Client secret solo vive en Supabase: nunca en el frontend ni en el repo.

No hacen falta client IDs de Android/iOS para este flujo. Solo serían necesarios si en el futuro se
cambia a Google Sign-In nativo (`signInWithIdToken`), que requiere un development build.

Si una cuenta con el mismo email ya existe con contraseña, Supabase vincula la identidad de Google
cuando el email está verificado.

## 5. Registro y contraseñas

**Registro con email** (`(auth)/register.tsx`). Bajo la contraseña se ve la regla «Mínimo 8
caracteres.» antes de enviar, y la app la comprueba (`validation.ts`: `MIN_PASSWORD_LENGTH`, contada en
caracteres). El email se valida con un patrón estricto y, ante una errata en un dominio habitual
(`gmial.com`), se ofrece corregirla sin impedir continuar (`suggestEmailCorrection`). Que el buzón exista solo
lo demuestra el email de confirmación: por eso «Confirm email» debe seguir activado.

Un único aviso legal bajo el formulario (`LegalNotice`) vale para el email y para Google; sus enlaces abren
los textos dentro de la app (`/legal/[doc]`). El inicio de sesión no lleva aviso: quien crea su cuenta con
Google desde allí lo ve en la configuración inicial (`setup/privacy`). La aceptación no se guarda en el
servidor. Errores del servidor:
`weak_password` (requisitos) y, con la protección activa, `pwned_password` (contraseña filtrada: motivo
`pwned` de `AuthWeakPasswordError`), ambos en el campo de contraseña. Iniciar sesión no aplica la regla
de 8 (las cuentas anteriores siguen entrando).

**Reenviar la confirmación.** En «Revisa tu correo» y cuando el login falla con `email_not_confirmed`
(Supabase solo lo dice con la contraseña correcta, así que no revela cuentas), «Reenviar email» llama a
`supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo } })` con la misma URL de
retorno que el registro (PKCE: el enlace nuevo vuelve a `/auth-callback` con un `code`). Tras cada envío
hay una espera visible de 60 s (`resend-cooldown.ts`); si Supabase responde por límite
(`over_email_send_rate_limit`), se muestra «Demasiados intentos…» y la espera vuelve a empezar.
Comprobado contra el Auth local con una cuenta sin confirmar: el reenvío llega con token PKCE y su
`code` se canjea en el mismo cliente; un segundo reenvío inmediato devuelve 429.

**Recuperación** (`/update-password`). Tras `PASSWORD_RECOVERY`, la recuperación pendiente se guarda en
el dispositivo **por usuario** (`password-recovery.ts`, clave `kitom-password-recovery` en el
almacenamiento seguro de la sesión). Mientras exista para el usuario de la sesión, la protección de
rutas lleva a `/update-password`, también tras cerrar la app y abrirla (incluso sin conexión: no se
entra en la app sin fijar la contraseña; «Cancelar y cerrar sesión» sigue disponible). El arranque
espera a leerla, como a la sesión. Se borra al guardar la contraseña, al cerrar sesión o si la sesión
pasa a ser de otra cuenta; si el almacenamiento falla al leer, no bloquea la app. La pantalla pide la
contraseña dos veces y muestra la regla de longitud.

**Recuperación con la sesión iniciada.** `/auth-callback` está fuera del grupo `(auth)`, así que el
enlace también funciona con sesión: se canjea, Supabase emite `PASSWORD_RECOVERY` con la sesión nueva y
la app lleva a `/update-password`. Si el enlace fuera de **otra** cuenta pedida antes en este dispositivo
(su verifier sigue guardado), la app pasa a esa cuenta como al revocarse una sesión: lo pendiente de la
anterior se conserva en el dispositivo, aislado por usuario.

**Cambiar la contraseña en ajustes** (`(app)/settings/password.tsx`, SEC-17). Pide la contraseña actual,
la nueva (con la regla visible) y su repetición. `change-password.ts`:
1. Comprueba la actual con un **cliente de Auth aparte, solo en memoria** (`password-check-client.ts`):
   `signInWithPassword` y, si es correcta, `signOut({ scope: 'local' })` de esa sesión (queda revocada en
   el servidor). La sesión de la app no cambia: ni eventos de Auth, ni rotación del token de renovación,
   ni efecto en los motores de sincronización (que usan el token del dueño). Los intentos fallidos
   cuentan en el límite de inicios de sesión de Supabase. Una contraseña incorrecta no llega a
   `updateUser`.
2. `updateUser({ password, current_password })`: si el proyecto exige la contraseña actual, el servidor
   la vuelve a comprobar (`current_password_invalid` → «La contraseña actual no es correcta»); si no, la
   ignora (comprobado en local).
3. Con **Secure password change** y una sesión de más de 24 h, Supabase responde
   `reauthentication_needed`: la app llama a `reauthenticate()` (código por email) y muestra «Confirma que
   eres tú» con el campo del código, «Reenviar código» (60 s) y `updateUser({ …, nonce })`. Sin probar
   contra un servidor real (en local está desactivado).

Alternativas descartadas: `reauthenticate()` siempre (exige un email en cada cambio y no comprueba la
contraseña: solo el acceso al correo) y `signInWithPassword` en el cliente de la app (sustituye la
sesión de la app, emite `SIGNED_IN` y deja la sesión anterior viva en el servidor).

**Crear contraseña (cuenta solo de Google).** Si `user.identities` no incluye `email`
(`accountHasPassword`), `/settings/password` no pide contraseña actual: ofrece «Enviarme el enlace»
(`resetPasswordForEmail` al email de la cuenta, con espera para reenviar) y el enlace abre
`/update-password` con la sesión iniciada. **Falta la entrada**: hoy Seguridad (`settings/security.tsx`)
solo enlaza a `/settings/password` si la cuenta tiene identidad `email`. No comprobado: si, tras fijarla,
Supabase añade la identidad `email` a la cuenta (si no, la pantalla seguiría ofreciendo «Crear
contraseña», que también funciona para cambiarla).

## 6. Comportamientos y limitaciones conocidas

- **Abrir el enlace en el mismo dispositivo** donde se pidió. En otro dispositivo no existe el
  verifier PKCE:
  - Confirmación: el email queda confirmado igualmente; la app muestra «Tu email está confirmado,
    ya puedes iniciar sesión». En un ordenador, la redirección a `kitom://` no abre nada, pero la
    confirmación ya se ha hecho.
  - Recuperación: muestra «el enlace ha caducado o ya se ha usado»; hay que solicitar otro en el
    dispositivo donde se va a cambiar la contraseña.
- **Solo vale el último enlace pedido**: cada nuevo registro, recuperación o login con Google
  sustituye el verifier anterior; un enlace antiguo deja de valer.
- **Recuperación y cierre de la app**: si se cierra antes de guardar la nueva contraseña, al abrirla
  vuelve a `/update-password` (sección 5). Solo se pierde si el almacenamiento seguro falla al escribir.
- **Enlace abierto con sesión ya iniciada**: solo se procesan los de recuperación; los de registro y
  el retorno de Google llevan a la app sin canjear nada.
- **Cerrar sesión con registros diarios sin sincronizar**: no se cierra sin decidir (intentar
  sincronizar, conservar en el dispositivo o cancelar); los conservados se recuperan al volver a entrar
  con la misma cuenta en ese dispositivo. Una sesión caducada o revocada sale sin preguntar y conserva
  los datos igual. Detalle: `FRONTEND_ARCHITECTURE.md` §5 «Sesión y cierre de sesión».
- **Abrir la app sin conexión**: con el token vigente, la sesión se usa sin comprobarla en el servidor.
  Con el token caducado no se puede renovar: la app abre (en 4 s como máximo) con los datos guardados
  en el dispositivo y el aviso «Sesión sin comprobar», sin enviar ni leer nada del servidor hasta
  renovarla; no es un cierre de sesión. Cerrar sesión en ese estado la borra del dispositivo (el
  servidor no se entera). Detalle: `FRONTEND_ARCHITECTURE.md` §5 «Arranque en frío sin conexión».
- **Cancelar el navegador de Google** no es un error: la app vuelve al formulario sin mensaje.
- **Google sin configurar**: el navegador muestra el error de Supabase (proveedor no habilitado); al
  cerrarlo, la app sigue en login.

## 7. Checklist de prueba (Expo Go o development build)

1. Registro con email nuevo → llega el email → abrir el enlace **en el móvil** → la app se abre y
   entra con sesión. Antes: con 7 caracteres o sin marcar la casilla no se envía; los enlaces de
   Términos y Privacidad abren el navegador dentro de la app. En «Revisa tu correo», «Reenviar email»
   → llega otro (espera de 60 s visible); el enlace nuevo también entra.
2. Login con email/contraseña → entra; logout → vuelve a login.
3. Recuperación → abrir el enlace en el móvil → pantalla «Crea una contraseña nueva» → guardar → entra.
   Logout y login con la contraseña nueva. Repetir, pero cerrar la app del todo en «Crea una contraseña
   nueva» y abrirla: vuelve a esa pantalla (no a la app).
4. Con la sesión iniciada: pedir la recuperación (o «Crear contraseña» en una cuenta de Google) y abrir
   el enlace → «Crea una contraseña nueva» → guardar → app.
5. Ajustes › Cambiar contraseña: con la actual incorrecta → «La contraseña actual no es correcta» y nada
   cambia; con la correcta → cambiada. Con «Secure password change» activo y una sesión de más de 24 h
   → «Confirma que eres tú» → código del email → cambiada.
6. Login de una cuenta sin confirmar → «Confirma tu email…» y «Reenviar email».
7. Enlace caducado o ya usado → mensaje de enlace no válido.
8. «Continuar con Google» → elegir cuenta → entra. Repetir y cancelar → vuelve a login sin error.
9. Sin conexión, guardar un registro diario → «Cerrar sesión» → pantalla con «Pendientes de
   sincronizar: 1». «Intentar sincronizar…» → «Sin conexión…» y sigue la sesión. «Conservar…» → login.
   Entrar con otra cuenta → no aparece. Volver a entrar con la primera (con red) → se sincroniza.
10. Cerrar la app del todo, esperar a que caduque el token (1 h) y abrirla en modo avión → inicio con
   «Sesión sin comprobar». Mis mascotas → «Registros guardados en este dispositivo» → «Registro de
   hoy» → editar y guardar (pendiente). Quitar el modo avión → en ≤ 90 s desaparece el aviso y se
   sincroniza.

## 8. Entorno local (`supabase/config.toml`)

Solo como referencia, sin cambios: el equivalente local está en `[auth]` (`site_url`,
`additional_redirect_urls`) y en `[auth.external.google]`, con el secreto como
`env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)`. No se usa mientras el desarrollo vaya contra `kitom-dev`.

Diferencias con la configuración recomendada (sección 3) que conviene conocer al probar en local
(no se cambian para no reiniciar el Auth local, compartido): longitud mínima 6 (la app exige 8: el
error del servidor por longitud solo se ve llamando a la API), confirmación de email desactivada (no hay
«Revisa tu correo» ni `email_not_confirmed` para cuentas creadas desde la app),
`secure_password_change = false` (no se pide código al cambiar la contraseña) y 2 emails por hora para
todo el proyecto (Mailpit en `http://127.0.0.1:54324`). Pruebas de integración de Auth:
`features/auth/change-password.integration.test.mjs` (comprobación de la contraseña actual y cambio).
