# Kitom — Autenticación (Supabase Auth + Expo)

Cómo funciona la autenticación en la app y qué hay que configurar en Supabase y en Google para que
los enlaces de email y el login con Google funcionen. Código: `frontend/src/features/auth/`.

## 1. Métodos disponibles

| Método | Estado |
|---|---|
| Email + contraseña (registro, login, logout) | ✅ |
| Confirmación de email por enlace | ✅ (requiere configuración, sección 3) |
| Recuperación de contraseña por enlace | ✅ (requiere configuración, sección 3) |
| Google (OAuth en navegador del sistema) | ✅ (requiere configuración, sección 4) |
| Teléfono (OTP) | Pendiente (PRD §8.1) |

## 2. Cómo funcionan los enlaces (deep links)

La app usa el **flujo PKCE** (`flowType: 'pkce'` en `src/lib/supabase.ts`):

1. Al registrarse, pedir recuperación o iniciar con Google, la app guarda un *code verifier* en el
   almacenamiento seguro del dispositivo y envía a Supabase una URL de retorno (`redirectTo`).
2. Supabase verifica el enlace o el login de Google y redirige a esa URL con un `code` de un solo uso.
3. La ruta `/auth-callback` (`src/app/(auth)/auth-callback.tsx`) intercambia el `code` por una
   sesión (`exchangeCodeForSession`). Sin el verifier local el `code` no sirve, así que no viajan
   tokens en la URL y otra app que registre el mismo esquema no puede robar la sesión.
4. La protección de rutas del layout raíz redirige según el resultado:
   - confirmación de email o Google → app;
   - recuperación (evento `PASSWORD_RECOVERY`) → `/update-password`, y tras guardar → app.

URL de retorno generada con `Linking.createURL('auth-callback', { queryParams: { flow } })`:

| Entorno | URL |
|---|---|
| Development/production build | `kitom://auth-callback?flow=signup\|recovery\|oauth` |
| Expo Go | `exp://<ip>:<puerto>/--/auth-callback?flow=…` |
| Web (dev) | `http://localhost:8081/auth-callback?flow=…` |

El esquema `kitom` está en `frontend/app.json` (`expo.scheme`). **Cambiarlo exige generar un nuevo
development build**; Expo Go siempre usa `exp://`.

## 3. Configuración de Supabase (Dashboard de `kitom-dev`)

La hace el usuario en el Dashboard. Claude no modifica la configuración remota (`config push` está
bloqueado). `supabase/config.toml` solo describe el entorno local.

**Authentication > URL Configuration**

- **Redirect URLs** (añadir):
  - `kitom://**`: builds de la app.
  - `exp://**`: Expo Go. **Solo en el proyecto de desarrollo, nunca en producción.**
  - `http://localhost:8081/**`: solo si se prueba la versión web en local.
- **Site URL**: es la URL que se usa si `redirectTo` no está en la lista; por eso los enlaces
  abrían `localhost`. Mientras no haya web, se recomienda `kitom://auth-callback`.

Si `redirectTo` no coincide con ninguna Redirect URL, Supabase usa la Site URL en silencio.

**Authentication > Emails (plantillas)**

Las plantillas por defecto usan `{{ .ConfirmationURL }}`, que ya incluye la URL de retorno. Si se
personalizan, deben seguir usando `{{ .ConfirmationURL }}`. No construir el enlace con
`{{ .SiteURL }}`, porque ignora el `redirectTo` de la app.

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

## 5. Comportamientos y limitaciones conocidas

- **Abrir el enlace en el mismo dispositivo** donde se pidió. En otro dispositivo no existe el
  verifier PKCE:
  - Confirmación: el email queda confirmado igualmente; la app muestra «Tu email está confirmado,
    ya puedes iniciar sesión». En un ordenador, la redirección a `kitom://` no abre nada, pero la
    confirmación ya se ha hecho.
  - Recuperación: muestra «el enlace ha caducado o ya se ha usado»; hay que solicitar otro en el
    dispositivo donde se va a cambiar la contraseña.
- **Solo vale el último enlace pedido**: cada nuevo registro, recuperación o login con Google
  sustituye el verifier anterior; un enlace antiguo deja de valer.
- **La recuperación no sobrevive a un cierre de la app**: si se cierra antes de guardar la nueva
  contraseña, el usuario queda con sesión iniciada y entra a la app (el cambio de contraseña desde
  ajustes está pendiente).
- **Enlace abierto con sesión ya iniciada**: `/auth-callback` solo está disponible sin sesión, así
  que el enlace se ignora.
- **Cancelar el navegador de Google** no es un error: la app vuelve al formulario sin mensaje.
- **Google sin configurar**: el navegador muestra el error de Supabase (proveedor no habilitado); al
  cerrarlo, la app sigue en login.

## 6. Checklist de prueba (Expo Go o development build)

1. Registro con email nuevo → llega el email → abrir el enlace **en el móvil** → la app se abre y
   entra con sesión.
2. Login con email/contraseña → entra; logout → vuelve a login.
3. Recuperación → abrir el enlace en el móvil → pantalla «Nueva contraseña» → guardar → entra.
   Logout y login con la contraseña nueva.
4. Enlace caducado o ya usado → mensaje de enlace no válido.
5. «Continuar con Google» → elegir cuenta → entra. Repetir y cancelar → vuelve a login sin error.

## 7. Entorno local (`supabase/config.toml`)

Solo como referencia, sin cambios: el equivalente local está en `[auth]` (`site_url`,
`additional_redirect_urls`) y en `[auth.external.google]`, con el secreto como
`env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)`. No se usa mientras el desarrollo vaya contra `kitom-dev`.
