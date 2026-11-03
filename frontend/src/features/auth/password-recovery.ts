/**
 * Recuperación de contraseña pendiente, guardada en el dispositivo (BUG-07 / SEC-17). Módulo puro: el
 * almacenamiento se inyecta (en la app, `secureSessionStorage`, el mismo de la sesión) y se prueba con
 * `npm test`.
 *
 * Una sesión abierta desde un enlace de recuperación (`PASSWORD_RECOVERY`) solo sirve para fijar una
 * contraseña nueva: la protección de rutas lleva a `/update-password` mientras haya una recuperación
 * pendiente **de ese mismo usuario**. Antes vivía solo en memoria: si la app se cerraba antes de
 * guardar la contraseña, al volver se entraba en la app con la sesión de recuperación.
 *
 * Reglas:
 * - `PASSWORD_RECOVERY` con sesión → pendiente para ese usuario (también si ya había sesión: el enlace se
 *   puede abrir con la sesión iniciada).
 * - Cualquier otro cambio cuyo usuario no sea el de la marca (cierre de sesión, sesión rechazada, otra
 *   cuenta) → se borra: la marca solo vive mientras dura la sesión de ese usuario.
 * - Contraseña guardada (`completed`) → se borra.
 * - Sin conexión (`offline`) con la marca del mismo usuario sigue pendiente: no se entra en la app sin
 *   fijar la contraseña (o cancelar, que cierra la sesión).
 * - Arranque: hasta leer la marca no está `loaded` (el layout raíz espera, como con la sesión). Si la
 *   lectura falla o el valor no es legible, no hay recuperación pendiente (no se bloquea la app). Un
 *   evento que llega antes de terminar la lectura manda sobre lo leído.
 * - Escribir o borrar en el dispositivo puede fallar: el estado en memoria se aplica igualmente (la
 *   recuperación en curso sigue funcionando; solo se perdería tras cerrar la app).
 */

export const PASSWORD_RECOVERY_STORAGE_KEY = 'kitom-password-recovery';

export type RecoveryMarker = { userId: string; startedAt: number };

export type RecoverySnapshot = {
  /** `false` hasta leer la marca guardada al arrancar. */
  loaded: boolean;
  /** Usuario con una recuperación pendiente, o `null`. */
  userId: string | null;
};

export type RecoveryStorage = {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
};

/** Estado de la sesión que necesita el tracker (`auth-state.ts`: `status` y `authUserId`). */
export type RecoveryAuthChange = {
  cause: string;
  status: 'loading' | 'signed_in' | 'offline' | 'signed_out';
  userId: string | null;
};

export function parseRecoveryMarker(raw: string | null): RecoveryMarker | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const { userId, startedAt } = value as Record<string, unknown>;
    if (typeof userId !== 'string' || userId === '' || typeof startedAt !== 'number') return null;
    return { userId, startedAt };
  } catch {
    return null;
  }
}

/**
 * Decisión pura: ¿qué hacer con la marca (`pendingUserId`) tras un cambio de sesión? `set`: guardar
 * para ese usuario; `clear`: borrarla; `null`: dejarla como está.
 */
export function recoveryChangeFor(
  change: RecoveryAuthChange,
  pendingUserId: string | null
): { type: 'set'; userId: string } | { type: 'clear' } | null {
  if (change.cause === 'PASSWORD_RECOVERY' && change.userId !== null && change.status === 'signed_in') {
    return { type: 'set', userId: change.userId };
  }
  if (change.status === 'loading') return null;
  if (pendingUserId !== null && change.userId !== pendingUserId) return { type: 'clear' };
  return null;
}

/** ¿Hay que mostrar `/update-password` a `userId`? */
export function isRecoveryPendingFor(snapshot: RecoverySnapshot, userId: string | null): boolean {
  return snapshot.loaded && userId !== null && snapshot.userId === userId;
}

export type PasswordRecoveryTracker = {
  /** Lee la marca guardada (una vez, al arrancar). */
  load(): Promise<void>;
  /** Cambio de la sesión (en el mismo instante del evento de Supabase Auth). */
  authChanged(change: RecoveryAuthChange): void;
  /** Contraseña nueva guardada: termina la recuperación. */
  completed(): void;
  getSnapshot(): RecoverySnapshot;
  subscribe(listener: () => void): () => void;
};

export function createPasswordRecoveryTracker(deps: {
  storage: RecoveryStorage;
  key?: string;
  now?: () => number;
  onStorageError?: (error: unknown) => void;
}): PasswordRecoveryTracker {
  const key = deps.key ?? PASSWORD_RECOVERY_STORAGE_KEY;
  const now = deps.now ?? Date.now;
  const listeners = new Set<() => void>();
  let snapshot: RecoverySnapshot = { loaded: false, userId: null };
  /** Último estado de la sesión visto (para conciliar la marca leída al arrancar). */
  let lastAuth: RecoveryAuthChange | null = null;
  /** Hubo un `set`/`clear` antes de terminar la lectura: lo leído ya no vale. */
  let decidedBeforeLoad = false;
  /** Escrituras en orden: la última decisión es la que queda guardada. */
  let writes: Promise<void> = Promise.resolve();

  const publish = (next: RecoverySnapshot) => {
    if (next.loaded === snapshot.loaded && next.userId === snapshot.userId) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const persist = (userId: string | null) => {
    writes = writes.then(async () => {
      try {
        if (userId === null) await deps.storage.removeItem(key);
        else await deps.storage.setItem(key, JSON.stringify({ userId, startedAt: now() } satisfies RecoveryMarker));
      } catch (error) {
        deps.onStorageError?.(error);
      }
    });
  };

  const apply = (change: ReturnType<typeof recoveryChangeFor>) => {
    if (change === null) return;
    if (!snapshot.loaded) decidedBeforeLoad = true;
    const userId = change.type === 'set' ? change.userId : null;
    persist(userId);
    publish({ loaded: snapshot.loaded, userId });
  };

  return {
    async load() {
      let marker: RecoveryMarker | null = null;
      try {
        marker = parseRecoveryMarker(await deps.storage.getItem(key));
      } catch (error) {
        deps.onStorageError?.(error);
      }
      if (snapshot.loaded) return;
      if (decidedBeforeLoad) {
        publish({ loaded: true, userId: snapshot.userId });
        return;
      }
      let userId = marker?.userId ?? null;
      // La sesión ya se resolvió mientras se leía: una marca de otro usuario (o sin sesión) no vale.
      if (userId !== null && lastAuth !== null && recoveryChangeFor(lastAuth, userId)?.type === 'clear') {
        userId = null;
        persist(null);
      }
      publish({ loaded: true, userId });
    },
    authChanged(change) {
      lastAuth = change;
      apply(recoveryChangeFor(change, snapshot.userId));
    },
    completed() {
      if (snapshot.userId === null && snapshot.loaded) return;
      apply({ type: 'clear' });
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
