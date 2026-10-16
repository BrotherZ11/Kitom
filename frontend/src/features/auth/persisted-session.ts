import { jwtSubject } from './owner-session.ts';

/**
 * Sesión de Supabase guardada en el dispositivo, leída **sin red** para saber de quién es. Módulo puro:
 * el almacenamiento se inyecta (el mismo que usa supabase-js: `secure-session-storage.ts`, con la clave
 * `AUTH_STORAGE_KEY` de `lib/supabase.ts`).
 *
 * Solo sirve para identificar al usuario cuando Supabase Auth no puede dar una sesión utilizable (sin
 * conexión y con el token caducado, o si el arranque tarda): abre su almacén local, nada más. Nunca se
 * usa para enviar nada ni dice que la sesión siga siendo válida en el servidor.
 *
 * Fiable = con la forma de una sesión de supabase-js y con el `sub` del token igual a `user.id`. Si no,
 * no hay identidad (falla cerrado): no se muestra ningún dato.
 */

export type PersistedUser = { id: string; email?: string } & Record<string, unknown>;

export type PersistedIdentity =
  | { status: 'found'; user: PersistedUser; expiresAt: number }
  | { status: 'none' }
  /** Hay algo guardado, pero no es una sesión legible o no se puede atribuir a un usuario. */
  | { status: 'unreadable' };

export type SessionStorageLike = {
  getItem(key: string): Promise<string | null> | string | null;
  removeItem(key: string): Promise<void> | void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parsePersistedSession(raw: string | null): PersistedIdentity {
  if (raw === null) return { status: 'none' };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { status: 'unreadable' };
  }
  if (!isRecord(value) || !isRecord(value.user)) return { status: 'unreadable' };
  const { access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt, user } = value;
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string' || typeof expiresAt !== 'number') {
    return { status: 'unreadable' };
  }
  const id = user.id;
  if (typeof id !== 'string' || id === '' || jwtSubject(accessToken) !== id) return { status: 'unreadable' };
  return { status: 'found', user: user as PersistedUser, expiresAt };
}

/** Lee la sesión guardada. Un fallo del almacenamiento cuenta como `unreadable` (no como «no hay»). */
export async function readPersistedIdentity(storage: SessionStorageLike, key: string): Promise<PersistedIdentity> {
  try {
    return parsePersistedSession(await storage.getItem(key));
  } catch {
    return { status: 'unreadable' };
  }
}
