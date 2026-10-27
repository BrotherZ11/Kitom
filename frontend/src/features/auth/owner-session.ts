/**
 * Token de acceso de la sesión del **propietario** de unos datos locales (p. ej. las operaciones de
 * Daily Logs de un usuario). Módulo puro, sin imports: el cliente de Auth se inyecta (se prueba con
 * `npm test` y contra el Supabase local).
 *
 * Quien escribe en el servidor en nombre de un usuario pide el token justo antes de la petición y lo
 * fija en su cabecera `Authorization`. Así la petición va autorizada como el propietario o no sale:
 * aunque la sesión cambie después (otra cuenta, cierre de sesión), lo que ya se envió lleva el token
 * del propietario, y lo que aún no se envió encuentra la sesión nueva y se detiene.
 *
 * Se comprueban dos cosas: que la sesión sea del propietario (`session.user.id`) y que el propio
 * token también lo sea (`sub` del JWT). Si algo no se puede verificar, no hay token (falla cerrado).
 */

export type OwnerAccessToken =
  | { status: 'ok'; token: string }
  /** No hay sesión. */
  | { status: 'no_session' }
  /** La sesión (o su token) es de otra cuenta. */
  | { status: 'other_user' }
  /** No se pudo leer o renovar la sesión (p. ej. la renovación del token falló sin conexión). */
  | { status: 'unavailable' };

/** Lo que se usa de `supabase.auth`: `getSession` devuelve la sesión vigente (renovada si hace falta). */
export type SessionSource = {
  getSession(): Promise<{
    data: { session: { access_token: string; user: { id: string } } | null };
    error: unknown;
  }>;
};

/** `sub` (usuario) del payload de un JWT, sin verificar la firma (eso lo hace el servidor). `null` si no se puede leer. */
export function jwtSubject(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3 || typeof globalThis.atob !== 'function') return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload: unknown = JSON.parse(globalThis.atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
    const sub = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>).sub : null;
    return typeof sub === 'string' && sub !== '' ? sub : null;
  } catch {
    return null;
  }
}

/** Proveedor del token de `ownerUserId`: cada llamada consulta la sesión vigente en ese momento. */
export function createOwnerAccessToken(auth: SessionSource, ownerUserId: string): () => Promise<OwnerAccessToken> {
  return async () => {
    let result: Awaited<ReturnType<SessionSource['getSession']>>;
    try {
      result = await auth.getSession();
    } catch {
      return { status: 'unavailable' };
    }
    const session = result.data.session;
    if (!session) return { status: result.error ? 'unavailable' : 'no_session' };
    if (session.user.id !== ownerUserId || jwtSubject(session.access_token) !== ownerUserId) {
      return { status: 'other_user' };
    }
    return { status: 'ok', token: session.access_token };
  };
}

/**
 * Para la opción `accessToken` de un cliente de supabase-js dedicado a un propietario (p. ej. las fotos
 * de mascota, fase 11): devuelve su token o **lanza** (`createError`), y así la petición no sale.
 * Devolver `null` no vale: supabase-js enviaría la petición con la clave anónima.
 */
export function ownerTokenOrThrow(
  accessToken: () => Promise<OwnerAccessToken>,
  createError: () => Error
): () => Promise<string> {
  return async () => {
    const owner = await accessToken().catch((): OwnerAccessToken => ({ status: 'unavailable' }));
    if (owner.status !== 'ok') throw createError();
    return owner.token;
  };
}
