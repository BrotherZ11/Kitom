import type { SyncNowOutcome } from '@/features/daily-logs/offline/daily-log-sync-engine';

/**
 * Cierre de sesión con cambios que solo existen en este dispositivo. Módulo puro: la comprobación de
 * cambios, la pasada de sincronización y el cierre de sesión se inyectan (se prueba con `npm test`).
 *
 * - `request()`: sin cambios sin sincronizar, cierra sesión (comportamiento de siempre); con ellos, o
 *   si no se pueden comprobar, no cierra y pide una decisión.
 * - `syncAndSignOut()` (A): una pasada acotada y, solo si después no queda nada sin sincronizar,
 *   cierra sesión. Si queda algo, vuelve a pedir la decisión con lo que queda y por qué.
 * - `keepAndSignOut()` (B): cierra sesión sin tocar los datos locales (se conservan en el dispositivo,
 *   aislados por usuario, y se recuperan al volver a entrar con la misma cuenta).
 * - `cancel()` (C): no cambia nada; si había una pasada de A en curso, sigue en segundo plano pero ya no
 *   cierra sesión al terminar.
 *
 * Nunca descarta datos: ninguna opción borra nada del dispositivo. Una operación a la vez: mientras hay
 * una en curso, las demás devuelven `busy` (dobles toques, dos pantallas a la vez).
 */

export type UnsyncedSummary = { pending: number; failed: number; conflict: number };

export function unsyncedTotal(summary: UnsyncedSummary): number {
  return summary.pending + summary.failed + summary.conflict;
}

/**
 * Por qué no se cerró la sesión tras intentar sincronizar:
 * - `incomplete`: la pasada terminó y quedan cambios (conflictos, fallos, la red cayó a mitad…).
 * - `timed_out`: se agotó el tiempo; la pasada sigue en segundo plano.
 * - `offline`: sin conexión no se intentó.
 * - `session`: la sesión no permite enviar (p. ej. el servidor la rechazó); hay que volver a entrar.
 */
export type SyncAttemptResult = 'incomplete' | 'timed_out' | 'offline' | 'session';

export type SignOutOutcome<E> =
  | { status: 'signed_out'; error: E | null }
  /** `summary: null` = no se pudo leer lo guardado en el dispositivo (no significa que no haya nada). */
  | { status: 'needs_decision'; summary: UnsyncedSummary | null; attempt: SyncAttemptResult | null }
  | { status: 'cancelled' }
  | { status: 'busy' };

export type SignOutFlowState = 'idle' | 'checking' | 'syncing' | 'signing_out';

export type SignOutFlowDeps<E> = {
  /** Cambios sin confirmar de la cuenta activa, leídos del dispositivo. Lanza si no se pueden leer. */
  checkUnsynced(): Promise<UnsyncedSummary>;
  /** Pasada acotada de sincronización (`engine.syncNow`). */
  syncNow(): Promise<SyncNowOutcome>;
  signOut(): Promise<{ error: E | null }>;
};

export type SignOutFlow<E> = {
  request(): Promise<SignOutOutcome<E>>;
  syncAndSignOut(): Promise<SignOutOutcome<E>>;
  keepAndSignOut(): Promise<SignOutOutcome<E>>;
  cancel(): void;
  getState(): SignOutFlowState;
  subscribe(listener: () => void): () => void;
};

export function createSignOutFlow<E>(deps: SignOutFlowDeps<E>): SignOutFlow<E> {
  const listeners = new Set<() => void>();
  let state: SignOutFlowState = 'idle';
  // Cada `cancel` invalida lo que esté en curso: una pasada que termina después ya no cierra sesión.
  let generation = 0;

  const setState = (next: SignOutFlowState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  const check = async (): Promise<UnsyncedSummary | null> => {
    try {
      return await deps.checkUnsynced();
    } catch {
      return null;
    }
  };

  const signOut = async (): Promise<SignOutOutcome<E>> => {
    setState('signing_out');
    try {
      const { error } = await deps.signOut();
      return { status: 'signed_out', error };
    } finally {
      setState('idle');
    }
  };

  /** Ejecuta `task` si no hay otra en curso. */
  const exclusive = async (
    first: SignOutFlowState,
    task: (isCurrent: () => boolean) => Promise<SignOutOutcome<E>>
  ): Promise<SignOutOutcome<E>> => {
    if (state !== 'idle') return { status: 'busy' };
    const mine = ++generation;
    setState(first);
    const isCurrent = () => mine === generation;
    try {
      return await task(isCurrent);
    } finally {
      // Si se canceló, el estado ya es de otra operación (o `idle`): no se toca.
      if (isCurrent() && state === first) setState('idle');
    }
  };

  return {
    request: () =>
      exclusive('checking', async () => {
        const summary = await check();
        if (summary && unsyncedTotal(summary) === 0) return signOut();
        return { status: 'needs_decision', summary, attempt: null };
      }),

    syncAndSignOut: () =>
      exclusive('syncing', async (isCurrent) => {
        let attempt: SyncAttemptResult = 'incomplete';
        try {
          const sync = await deps.syncNow();
          if (sync.status === 'timed_out') attempt = 'timed_out';
          if (sync.status === 'unavailable') attempt = sync.reason === 'offline' ? 'offline' : 'session';
        } catch {
          // Fallo del almacén local durante la pasada: se vuelve a comprobar qué queda.
        }
        const summary = await check();
        if (!isCurrent()) return { status: 'cancelled' };
        // Solo se cierra sesión si lo leído del dispositivo confirma que no queda nada.
        if (summary && unsyncedTotal(summary) === 0) return signOut();
        return { status: 'needs_decision', summary, attempt };
      }),

    keepAndSignOut: () => exclusive('signing_out', () => signOut()),

    cancel() {
      if (state === 'signing_out') return;
      generation += 1;
      if (state !== 'idle') setState('idle');
    },

    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
