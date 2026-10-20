import { jwtSubject } from './owner-session.ts';
import type { PersistedIdentity, PersistedUser } from './persisted-session.ts';

/**
 * Estado de la sesión de la app a partir de Supabase Auth y de la sesión guardada en el dispositivo.
 * Módulo puro (se prueba con `npm test`); el proveedor (`auth-context.tsx`) lo conecta.
 *
 * - `signed_in`: Supabase Auth da una sesión utilizable (token vigente o renovado). Que el servidor la
 *   siga aceptando solo se sabe al usarla.
 * - `offline`: Supabase Auth no da una sesión utilizable (sin conexión y con el token caducado, o el
 *   arranque tarda más de `AUTH_STARTUP_TIMEOUT_MS`), pero la sesión sigue guardada y se sabe de quién
 *   es (`persisted-session.ts`). Se abre el almacén local de ese usuario; no se envía nada ni se lee
 *   del servidor hasta volver a `signed_in`. **No** es un cierre de sesión.
 * - `signed_out`: no hay sesión guardada (o no se puede atribuir a nadie): flujo de autenticación.
 *
 * Identidad: una sesión solo identifica a un usuario si el `sub` de su token es `user.id`, igual que la
 * sesión guardada (`persisted-session.ts`). Una sesión incoherente (p. ej. un valor guardado a medias
 * mezclando dos cuentas) no abre nada: `signed_out`, sin borrar nada; iniciar sesión la sustituye.
 *
 * Supabase Auth, con el token caducado y sin red, reintenta la renovación hasta ~30 s y después emite
 * `INITIAL_SESSION` sin sesión aunque la conserve guardada (error reintentable). Por eso una sesión
 * `null` que no sea `SIGNED_OUT` no se cree sin mirar el almacenamiento.
 *
 * Carreras: cada evento invalida las lecturas del almacenamiento pedidas antes (un resultado tardío no
 * deshace un evento posterior).
 */

/** Tope del arranque: pasado este tiempo sin `INITIAL_SESSION`, decide la sesión guardada. */
export const AUTH_STARTUP_TIMEOUT_MS = 4_000;

type SessionLike = { access_token: string; user: { id: string } };

export type AuthState<S extends SessionLike> =
  | { status: 'loading' }
  | { status: 'signed_out' }
  | { status: 'signed_in'; session: S; userId: string }
  | {
      status: 'offline';
      user: PersistedUser;
      userId: string;
      /** `refresh_failed`: Supabase no pudo renovar la sesión; `slow_start`: el arranque no terminó a tiempo. */
      reason: 'refresh_failed' | 'slow_start';
    };

/** Lectura de la sesión guardada que hay que hacer y entregar con `storageRead`. */
export type StorageCheck = { readonly sequence: number; readonly reason: 'refresh_failed' | 'slow_start' };

export type AuthStateMachine<S extends SessionLike> = {
  getState(): AuthState<S>;
  /** Evento de Supabase Auth. Si devuelve una lectura, el estado depende de la sesión guardada. */
  authEvent(event: string, session: S | null): StorageCheck | null;
  /** Resultado de la lectura pedida. Se ignora si después llegó otro evento. */
  storageRead(check: StorageCheck, identity: PersistedIdentity): void;
  /** Fin del tope de arranque. Si `INITIAL_SESSION` aún no ha llegado, pide leer la sesión guardada. */
  startupTimeout(): StorageCheck | null;
  /** Cierre de sesión hecho solo en el dispositivo (sin red, Supabase Auth no puede). */
  signedOutLocally(): void;
};

export function authUserId<S extends SessionLike>(state: AuthState<S>): string | null {
  return state.status === 'signed_in' || state.status === 'offline' ? state.userId : null;
}

export function createAuthStateMachine<S extends SessionLike>(): AuthStateMachine<S> {
  let state: AuthState<S> = { status: 'loading' };
  let sequence = 0;
  let initialSeen = false;

  return {
    getState: () => state,

    authEvent(event, session) {
      sequence += 1;
      if (event === 'INITIAL_SESSION') initialSeen = true;
      if (session) {
        state =
          jwtSubject(session.access_token) === session.user.id
            ? { status: 'signed_in', session, userId: session.user.id }
            : { status: 'signed_out' };
        return null;
      }
      if (event === 'SIGNED_OUT') {
        state = { status: 'signed_out' };
        return null;
      }
      // Sin sesión, pero no es un cierre: puede que Supabase no haya podido renovarla.
      return { sequence, reason: 'refresh_failed' };
    },

    storageRead(check, identity) {
      if (check.sequence !== sequence) return;
      state =
        identity.status === 'found'
          ? { status: 'offline', user: identity.user, userId: identity.user.id, reason: check.reason }
          : { status: 'signed_out' };
    },

    startupTimeout() {
      if (initialSeen || state.status !== 'loading') return null;
      return { sequence, reason: 'slow_start' };
    },

    signedOutLocally() {
      sequence += 1;
      state = { status: 'signed_out' };
    },
  };
}
