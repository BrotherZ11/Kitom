import type { DailyLogSyncEngine } from './daily-log-sync-engine.ts';

/**
 * Sesiones de sincronización (almacén + motor) por usuario. Módulo puro: `create` se inyecta.
 *
 * Una sola instancia por usuario mientras dure el proceso: si la misma cuenta cierra sesión y vuelve a
 * entrar con una petición todavía en vuelo, la sesión nueva reutiliza el mismo almacén (sus escrituras
 * siguen siendo de una en una) y el mismo motor (la pasada en curso se junta con la siguiente en vez de
 * enviar la misma operación dos veces).
 *
 * Solo una activa a la vez: activar la de un usuario para y deja sin sesión las de los demás. Nada de
 * esto borra datos: los de otras cuentas siguen en el dispositivo, aislados por su clave de usuario, y
 * se recuperan cuando esa misma cuenta vuelve a iniciar sesión.
 */

type SessionEngine = Pick<DailyLogSyncEngine, 'start' | 'stop' | 'setSessionUserId'>;

export type DailyLogSyncSessions<T> = {
  /** Sesión de `userId` (siempre la misma instancia). No la activa. */
  get(userId: string): T;
  /** Activa (`start`) la de `userId`; antes para y deja sin sesión las de cualquier otro usuario. */
  activate(userId: string): T;
  /** Para la de `userId` y la deja sin sesión: no envía nada hasta volver a activarse con su sesión. */
  deactivate(userId: string): void;
};

export function createDailyLogSyncSessions<T extends { engine: SessionEngine }>(
  create: (userId: string) => T
): DailyLogSyncSessions<T> {
  const sessions = new Map<string, T>();

  const park = (session: T) => {
    session.engine.stop();
    session.engine.setSessionUserId(null);
  };

  const get = (userId: string): T => {
    let session = sessions.get(userId);
    if (!session) {
      session = create(userId);
      sessions.set(userId, session);
    }
    return session;
  };

  return {
    get,
    activate(userId) {
      for (const [id, other] of sessions) if (id !== userId) park(other);
      const session = get(userId);
      session.engine.start();
      return session;
    },
    deactivate(userId) {
      const session = sessions.get(userId);
      if (session) park(session);
    },
  };
}
