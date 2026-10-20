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
 *   (`getSession`, que la renueva si puede), con tope de tiempo y una sola petición a la vez. Solo si
 *   `canAttemptRecovery()` (con conexión según el sistema y en primer plano): sin conexión, cada intento
 *   de auth-js reintenta ~25 s y, al fallar, bloquea las renovaciones 60 s (devuelve el mismo fallo sin
 *   pedir nada), así que intentar sin red solo retrasa la renovación cuando la red vuelve.
 * - Reintento cada 5 s: no añade peticiones. auth-js comparte la renovación en curso entre todas las
 *   llamadas y, durante esos 60 s, responde con el fallo guardado; el intervalo corto solo acorta lo
 *   que se tarda en notar que el bloqueo ha terminado. Premisas probadas contra auth-js real en
 *   `lib/auto-refresh-gate.test.mjs` (si cambian, esas pruebas fallan). El temporizador de renovación
 *   de auth-js también corre solo con conexión y en primer plano (`lib/auto-refresh-gate.ts`).
 * - Sesión rechazada por el servidor (token de renovación revocado o ya usado): auth-js la borra y emite
 *   `SIGNED_OUT`. Si no pudo borrarla, se quita del dispositivo aquí; si tampoco se puede, se deja de
 *   intentar (no hay nada que renovar). Nunca se reintenta una sesión rechazada.
 * - Una respuesta que llega cuando la sesión de la app ya no es la que se intentaba recuperar (otra
 *   cuenta, cierre de sesión) no cambia nada.
 * - `signOut`: con la sesión utilizable, el de Supabase Auth (con el mismo tope). Si Supabase no la quita
 *   (sin red y con el token caducado devuelve el error de renovación sin borrarla) o el estado es
 *   `offline`, se borra solo del dispositivo: el usuario siempre puede cerrar sesión. Sin red, el
 *   servidor no se entera (el token de renovación sigue vigente allí hasta que caduque).
 */

type SessionLike = { access_token: string; user: { id: string } };

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
  /** ¿Se puede intentar renovar ahora? Con conexión según el sistema y la app en primer plano. */
  canAttemptRecovery?: () => boolean;
  startupTimeoutMs?: number;
  /** Tope de `recover` (la renovación de Supabase Auth puede reintentar hasta ~30 s). */
  recoveryTimeoutMs?: number;
  /** Cada cuánto se reintenta mientras el estado sea `offline` (y se pueda intentar). */
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
export const AUTH_RECOVERY_INTERVAL_MS = 5_000;

/**
 * ¿El servidor de Auth rechazó la sesión (token de renovación inexistente, revocado o ya usado)? Los
 * fallos de red, los 5xx, los tiempos agotados y los límites de peticiones no lo son. Se mira la forma
 * pública de los errores de auth-js (`name`, `status`), probada con sus clases en las pruebas.
 */
export function isSessionRejected(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, status } = error as { name?: unknown; status?: unknown };
  if (name === 'AuthSessionMissingError') return true;
  return (
    name === 'AuthApiError' &&
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429
  );
}

export type AuthSessionController<S extends SessionLike> = {
  /** Se suscribe a Supabase Auth y arranca el tope de inicio. Devuelve la función para parar. */
  start(): () => void;
  getState(): AuthState<S>;
  /** Avisa en el mismo instante de cada cambio (antes de que React vuelva a pintar). */
  subscribe(listener: AuthStateListener<S>): () => void;
  /** ¿`userId` es el usuario de la sesión de la app (utilizable u `offline`)? */
  isCurrentUser(userId: string): boolean;
  /**
   * En `offline`, intenta obtener una sesión utilizable. Una a la vez; nunca más de `recoveryTimeoutMs`.
   * No hace nada si no se puede intentar (`canAttemptRecovery`) o si el servidor ya rechazó la sesión.
   */
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
  const canAttemptRecovery = deps.canAttemptRecovery ?? (() => true);
  const startupTimeoutMs = deps.startupTimeoutMs ?? AUTH_STARTUP_TIMEOUT_MS;
  const recoveryTimeoutMs = deps.recoveryTimeoutMs ?? AUTH_RECOVERY_TIMEOUT_MS;
  const recoveryIntervalMs = deps.recoveryIntervalMs ?? AUTH_RECOVERY_INTERVAL_MS;
  let running = false;
  let retryTimer: unknown = null;
  /** Usuario cuya sesión rechazó el servidor sin que se pudiera quitar del dispositivo. */
  let rejectedUserId: string | null = null;

  const shouldRetry = () => {
    const state = machine.getState();
    return running && state.status === 'offline' && state.userId !== rejectedUserId && canAttemptRecovery();
  };

  /**
   * Siguiente intento, contado desde que termina el anterior. Sin conexión o en segundo plano no se
   * programa: lo reanudan el evento de red o el de primer plano.
   */
  const scheduleRetry = () => {
    if (!shouldRetry()) {
      if (retryTimer !== null) clearTimer(retryTimer);
      retryTimer = null;
      return;
    }
    retryTimer ??= setTimer(() => {
      retryTimer = null;
      void attempt();
    }, recoveryIntervalMs);
  };

  const transition = <T>(cause: AuthChangeCause, change: () => T): T => {
    const previous = machine.getState();
    const result = change();
    const state = machine.getState();
    if (state !== previous) {
      if (state.status !== 'offline') rejectedUserId = null;
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

  const removeLocally = async () => {
    await deps.storage.removeItem(deps.storageKey);
    transition('local_sign_out', () => machine.signedOutLocally());
  };

  const recover = singleFlight(async () => {
    const target = machine.getState();
    if (target.status !== 'offline' || target.userId === rejectedUserId || !canAttemptRecovery()) return;
    let result: Awaited<ReturnType<AuthClientLike<S>['getSession']>> | 'timeout';
    try {
      result = await withTimeout(deps.auth.getSession(), recoveryTimeoutMs);
    } catch {
      return;
    }
    if (result === 'timeout') return;
    // Respuesta tardía: la sesión de la app ya no es la que se intentaba recuperar.
    const current = machine.getState();
    if (current.status !== 'offline' || current.userId !== target.userId) return;
    const session = result.data.session;
    if (session) {
      // Normalmente Supabase ya habrá emitido TOKEN_REFRESHED; si no (el token seguía vigente), se aplica.
      // De otra cuenta no se aplica: eso lo deciden los eventos de Supabase Auth.
      if (session.user.id === target.userId) {
        transition('recovered', () => machine.authEvent('SESSION_RECOVERED', session));
      }
      return;
    }
    if (!result.error) {
      // Supabase ya no tiene sesión guardada (se quitó sin `SIGNED_OUT`): no queda nada que recuperar.
      transition('storage', () => machine.signedOutLocally());
      return;
    }
    if (isSessionRejected(result.error)) {
      // auth-js la habría borrado (y emitido SIGNED_OUT); sigue aquí: no pudo. Nada que renovar.
      rejectedUserId = target.userId;
      try {
        await removeLocally();
      } catch {
        // Sin poder quitarla, queda `offline` sin más intentos; cerrar sesión lo vuelve a probar.
      }
    }
  });

  /** Intento automático (red, primer plano o temporizador); al terminar, programa el siguiente. */
  const attempt = () => recover().finally(scheduleRetry);

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
      const unsubscribeOnline = deps.subscribeOnline?.((online) => {
        if (online) void attempt();
        else scheduleRetry();
      });
      const unsubscribeForeground = deps.subscribeForeground?.(() => void attempt());
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
