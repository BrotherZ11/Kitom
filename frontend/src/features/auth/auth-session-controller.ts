import { singleFlight } from '../../lib/single-flight.ts';
import { SessionUnavailableError } from '../../lib/user-token-fetch.ts';
import {
  AUTH_STARTUP_TIMEOUT_MS,
  authUserId,
  createAuthStateMachine,
  type AuthState,
  type StorageCheck,
} from './auth-state.ts';
import { readPersistedIdentity, type SessionStorageLike } from './persisted-session.ts';

/**
 * Sesión de la app: conecta Supabase Auth, la sesión guardada en el dispositivo (`auth-state.ts`) y los
 * disparadores de recuperación. Módulo puro (todo se inyecta; se prueba con `npm test`); el proveedor
 * React es `auth-context.tsx`.
 *
 * - Arranque: decide `INITIAL_SESSION`. Sin él en `startupTimeoutMs`, la sesión guardada (sin red).
 * - `offline` → `signed_in`: al recuperar la conexión, al volver a primer plano, a petición (`recover`)
 *   y, mientras dure `offline`, cada `recoveryIntervalMs`, se pide la sesión a Supabase Auth
 *   (`getSession`, que la renueva si puede), con tope de tiempo y una sola petición a la vez. Tras un
 *   fallo de renovación, Supabase devuelve ese mismo fallo durante 60 s sin volver a pedir nada: el
 *   reintento periódico cubre la red que vuelve dentro de ese margen (en móvil el temporizador de
 *   renovación de supabase-js solo arranca con un cambio de `AppState`).
 * - `signOut`: con la sesión utilizable, el de Supabase Auth (con el mismo tope). Si Supabase no la quita
 *   (sin red y con el token caducado devuelve el error de renovación sin borrarla) o el estado es
 *   `offline`, se borra solo del dispositivo: el usuario siempre puede cerrar sesión. Sin red, el
 *   servidor no se entera (el token de renovación sigue vigente allí hasta que caduque).
 */

type SessionLike = { user: { id: string } };

export type AuthClientLike<S extends SessionLike> = {
  onAuthStateChange(callback: (event: string, session: S | null) => void): {
    data: { subscription: { unsubscribe(): void } };
  };
  getSession(): Promise<{ data: { session: S | null }; error: unknown }>;
  signOut(): Promise<{ error: unknown }>;
};

export type AuthSessionControllerDeps<S extends SessionLike> = {
  auth: AuthClientLike<S>;
  storage: SessionStorageLike;
  storageKey: string;
  subscribeOnline?: (listener: (online: boolean) => void) => () => void;
  subscribeForeground?: (listener: () => void) => () => void;
  startupTimeoutMs?: number;
  /** Tope de `recover` (la renovación de Supabase Auth puede reintentar hasta ~30 s). */
  recoveryTimeoutMs?: number;
  /** Cada cuánto se reintenta mientras el estado sea `offline`. */
  recoveryIntervalMs?: number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

/** Qué causó el cambio: el evento de Supabase Auth o una decisión de este módulo. */
export type AuthChangeCause = string | 'storage' | 'startup_timeout' | 'recovered' | 'local_sign_out';

export type AuthStateListener<S extends SessionLike> = (
  state: AuthState<S>,
  previous: AuthState<S>,
  cause: AuthChangeCause
) => void;

export const AUTH_RECOVERY_TIMEOUT_MS = 10_000;
/** Igual que el temporizador de renovación de supabase-js (30 s). */
export const AUTH_RECOVERY_INTERVAL_MS = 30_000;

export type AuthSessionController<S extends SessionLike> = {
  /** Se suscribe a Supabase Auth y arranca el tope de inicio. Devuelve la función para parar. */
  start(): () => void;
  getState(): AuthState<S>;
  /** Avisa en el mismo instante de cada cambio (antes de que React vuelva a pintar). */
  subscribe(listener: AuthStateListener<S>): () => void;
  /** ¿`userId` es el usuario de la sesión de la app (utilizable u `offline`)? */
  isCurrentUser(userId: string): boolean;
  /** En `offline`, intenta obtener una sesión utilizable. Una a la vez; nunca más de `recoveryTimeoutMs`. */
  recover(): Promise<void>;
  signOut(): Promise<{ error: unknown }>;
  /**
   * Ejecuta `call` solo si en este momento la sesión es utilizable (`signed_in`); si no, falla al
   * instante con `SessionUnavailableError` sin llamar a nada (supabase-js haría esperar la petición
   * a su inicialización, hasta ~30 s sin red).
   */
  serverCall<T>(call: () => Promise<T>): Promise<T>;
};

export function createAuthSessionController<S extends SessionLike>(
  deps: AuthSessionControllerDeps<S>
): AuthSessionController<S> {
  const machine = createAuthStateMachine<S>();
  const listeners = new Set<AuthStateListener<S>>();
  const setTimer = deps.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const startupTimeoutMs = deps.startupTimeoutMs ?? AUTH_STARTUP_TIMEOUT_MS;
  const recoveryTimeoutMs = deps.recoveryTimeoutMs ?? AUTH_RECOVERY_TIMEOUT_MS;
  const recoveryIntervalMs = deps.recoveryIntervalMs ?? AUTH_RECOVERY_INTERVAL_MS;
  let running = false;
  let retryTimer: unknown = null;

  /** Reintento periódico solo mientras el estado sea `offline` (y el controlador esté en marcha). */
  const scheduleRetry = () => {
    const offline = running && machine.getState().status === 'offline';
    if (!offline && retryTimer !== null) {
      clearTimer(retryTimer);
      retryTimer = null;
    }
    if (offline && retryTimer === null) {
      retryTimer = setTimer(() => {
        retryTimer = null;
        void recover().finally(scheduleRetry);
      }, recoveryIntervalMs);
    }
  };

  const transition = <T>(cause: AuthChangeCause, change: () => T): T => {
    const previous = machine.getState();
    const result = change();
    const state = machine.getState();
    if (state !== previous) {
      scheduleRetry();
      for (const listener of listeners) listener(state, previous, cause);
    }
    return result;
  };

  const readStorage = (check: StorageCheck, cause: AuthChangeCause) => {
    void readPersistedIdentity(deps.storage, deps.storageKey).then((identity) =>
      transition(cause, () => machine.storageRead(check, identity))
    );
  };

  const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> => {
    let handle: unknown = null;
    const timeout = new Promise<'timeout'>((resolve) => {
      handle = setTimer(() => resolve('timeout'), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimer(handle));
  };

  const recover = singleFlight(async () => {
    if (machine.getState().status !== 'offline') return;
    let result: Awaited<ReturnType<AuthClientLike<S>['getSession']>> | 'timeout';
    try {
      result = await withTimeout(deps.auth.getSession(), recoveryTimeoutMs);
    } catch {
      return;
    }
    if (result === 'timeout' || !result.data.session) return;
    const session = result.data.session;
    // Normalmente Supabase ya habrá emitido TOKEN_REFRESHED; si no (el token seguía vigente), se aplica.
    if (machine.getState().status === 'offline') {
      transition('recovered', () => machine.authEvent('SESSION_RECOVERED', session));
    }
  });

  const removeLocally = async () => {
    await deps.storage.removeItem(deps.storageKey);
    transition('local_sign_out', () => machine.signedOutLocally());
  };

  const signOut = singleFlight(async (): Promise<{ error: unknown }> => {
    if (machine.getState().status === 'offline') {
      try {
        await removeLocally();
        return { error: null };
      } catch (error) {
        return { error };
      }
    }
    let error: unknown = null;
    try {
      // Con el token caducado y sin red, Supabase reintenta la renovación antes de cerrar (hasta ~30 s).
      const result = await withTimeout(deps.auth.signOut(), recoveryTimeoutMs);
      if (result !== 'timeout') error = result.error;
    } catch (thrown) {
      error = thrown;
    }
    // Si la sesión sigue guardada (Supabase no pudo quitarla), se quita del dispositivo.
    try {
      const left = await readPersistedIdentity(deps.storage, deps.storageKey);
      if (left.status !== 'none') await removeLocally();
    } catch (removal) {
      error ??= removal;
    }
    return { error };
  });

  return {
    start() {
      running = true;
      const {
        data: { subscription },
      } = deps.auth.onAuthStateChange((event, session) => {
        const check = transition(event, () => machine.authEvent(event, session));
        if (check) readStorage(check, 'storage');
      });
      const timer = setTimer(() => {
        const check = machine.startupTimeout();
        if (check) readStorage(check, 'startup_timeout');
      }, startupTimeoutMs);
      const triggers = () => void recover();
      const unsubscribeOnline = deps.subscribeOnline?.((online) => online && triggers());
      const unsubscribeForeground = deps.subscribeForeground?.(triggers);
      return () => {
        running = false;
        scheduleRetry();
        clearTimer(timer);
        unsubscribeOnline?.();
        unsubscribeForeground?.();
        subscription.unsubscribe();
      };
    },
    getState: () => machine.getState(),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isCurrentUser: (userId) => authUserId(machine.getState()) === userId,
    recover,
    signOut,
    serverCall: (call) =>
      machine.getState().status === 'signed_in' ? call() : Promise.reject(new SessionUnavailableError()),
  };
}
