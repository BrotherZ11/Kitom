import { toAuthErrorCode, type AuthErrorCode } from './auth-error-code.ts';

/**
 * Cambio de contraseña desde ajustes con la contraseña actual (SEC-17). Módulo puro: Supabase Auth se
 * inyecta (se prueba con `npm test` y contra el Supabase local).
 *
 * 1. Comprobar la contraseña actual **sin tocar la sesión de la app** (`verifyCurrentPassword`): un
 *    inicio de sesión con un cliente de Auth aparte, en memoria, cuya sesión se revoca enseguida. La
 *    sesión de la app no cambia (ni eventos ni rotación del token de renovación) y los fallos cuentan en
 *    el límite de intentos de inicio de sesión de Supabase.
 * 2. `updateUser({ password, current_password })`. Si el proyecto exige la contraseña actual (GoTrue
 *    `update_password_require_current_password`), el servidor la vuelve a comprobar; si no, la ignora.
 * 3. Con «Secure password change» activo y una sesión de más de 24 h, Supabase responde
 *    `reauthentication_needed`: se pide un código por email (`reauthenticate`) y se repite el paso 2 con
 *    `nonce` (`needs_code`). El paso 1 no se repite: la contraseña actual ya se comprobó.
 */

export type AuthAttemptResult = { error: unknown };

/**
 * ¿La cuenta tiene contraseña? Sí si tiene la identidad `email` de Supabase Auth (`user.identities`,
 * como en ajustes › Seguridad). Si no se conocen las identidades (lista ausente o vacía) se supone que sí:
 * pedir la contraseña actual es lo seguro; quien no la tenga puede usar «He olvidado mi contraseña».
 * Solo Google (sin `email`): se crea con el enlace de recuperación, no hay contraseña actual que pedir.
 */
export function accountHasPassword(identities: readonly { provider: string }[] | null | undefined): boolean {
  if (!identities || identities.length === 0) return true;
  return identities.some((identity) => identity.provider === 'email');
}

/** Lo que se usa del cliente de Auth temporal (en memoria, sin persistir) para comprobar la contraseña. */
export type PasswordCheckAuth = {
  signInWithPassword(credentials: { email: string; password: string }): Promise<{
    data: { user: { id: string } | null; session: unknown };
    error: unknown;
  }>;
  signOut(options: { scope: 'local' }): Promise<AuthAttemptResult>;
};

export type ChangePasswordAuth = {
  /** Cliente de Auth nuevo y desechable (nunca el de la app). */
  createCheckClient(): PasswordCheckAuth;
  updateUser(attributes: { password: string; current_password: string; nonce?: string }): Promise<AuthAttemptResult>;
  reauthenticate(): Promise<AuthAttemptResult>;
};

export type ChangePasswordResult =
  | { status: 'done' }
  /** Supabase pide el código enviado por email: repetir con `nonce`. */
  | { status: 'needs_code' }
  | { status: 'error'; error: AuthErrorCode };

function isAuthErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code;
}

/**
 * ¿Es `password` la contraseña de `userId` (`email`)? La sesión de comprobación se cierra en el
 * servidor (`scope: 'local'`: solo esa) aunque el usuario no coincida; si el cierre falla, caduca sola.
 */
export async function verifyCurrentPassword(
  auth: Pick<ChangePasswordAuth, 'createCheckClient'>,
  input: { userId: string; email: string; password: string }
): Promise<AuthErrorCode | null> {
  const client = auth.createCheckClient();
  let result: Awaited<ReturnType<PasswordCheckAuth['signInWithPassword']>>;
  try {
    result = await client.signInWithPassword({ email: input.email, password: input.password });
  } catch (error) {
    return toAuthErrorCode(error);
  }
  if (result.error) {
    const code = toAuthErrorCode(result.error);
    return code === 'invalid_credentials' ? 'wrong_current_password' : code;
  }
  if (result.data.session) {
    try {
      await client.signOut({ scope: 'local' });
    } catch {
      // Sin cerrar en el servidor, la sesión de comprobación caduca sola; nunca se guardó.
    }
  }
  // El email del usuario cambió en otro sitio, o la sesión es de otra cuenta: no se da por buena.
  return result.data.user?.id === input.userId ? null : 'wrong_current_password';
}

export async function changePassword(
  auth: ChangePasswordAuth,
  input: { userId: string; email: string; currentPassword: string; newPassword: string; nonce?: string }
): Promise<ChangePasswordResult> {
  if (input.nonce === undefined) {
    const wrong = await verifyCurrentPassword(auth, { userId: input.userId, email: input.email, password: input.currentPassword });
    if (wrong) return { status: 'error', error: wrong };
  }

  let update: AuthAttemptResult;
  try {
    update = await auth.updateUser({
      password: input.newPassword,
      current_password: input.currentPassword,
      ...(input.nonce === undefined ? {} : { nonce: input.nonce.trim() }),
    });
  } catch (error) {
    return { status: 'error', error: toAuthErrorCode(error) };
  }
  if (!update.error) return { status: 'done' };

  if (isAuthErrorCode(update.error, 'reauthentication_needed') && input.nonce === undefined) {
    return requestCode(auth);
  }
  return { status: 'error', error: toAuthErrorCode(update.error) };
}

/** Pide (o vuelve a pedir) el código de verificación por email. */
export async function requestCode(auth: Pick<ChangePasswordAuth, 'reauthenticate'>): Promise<ChangePasswordResult> {
  try {
    const { error } = await auth.reauthenticate();
    return error ? { status: 'error', error: toAuthErrorCode(error) } : { status: 'needs_code' };
  } catch (error) {
    return { status: 'error', error: toAuthErrorCode(error) };
  }
}
