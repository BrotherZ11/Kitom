import type { Reminder } from '@/features/reminders/reminder-model';
import type { LocalCollection, LocalStore } from '@/lib/local-store/local-store';

import { compareVersions } from '../../daily-logs/offline/daily-log-version.ts';
import { toCachedReminder, isReminderUuid } from './reminder-operation.ts';

/**
 * Copia local de la agenda de un usuario, para verla sin conexión (agenda sin conexión, fase 14). Módulo puro:
 * el almacén y el reloj se inyectan. Solo entran respuestas correctas del servidor; un error nunca llega aquí,
 * así que una lista vacía solo puede sustituir a otra si el servidor la devolvió. Sin URLs firmadas ni tokens.
 *
 * Tres colecciones:
 * - `reminders` (`…:reminders:<id>`): la última versión conocida de cada recordatorio.
 * - `reminder-scopes` (`…:reminder-scopes:<alcance>`): qué devolvió la última lectura de un alcance (`pending`,
 *   `upcoming` o `pet-<id>`). No existe = nunca descargado; `ids: []` y `complete` = vacío **confirmado**.
 *   `complete: false` = la consulta llegó a su tope: lo que no vino no se da por desaparecido.
 * - `reminder-permissions` (`…:reminder-permissions:<petId>`): el último `can_edit_pet` confirmado. **Solo una
 *   indicación de interfaz** (decisión del 2026-11-05): nunca autoriza nada; quien decide es RLS al sincronizar.
 *
 * Orden: cada lectura toma una marca antes de pedir los datos. Por recordatorio, una observación con marca
 * posterior manda sobre la presencia, pero sus datos nunca retroceden (`updated_at`); una con marca anterior solo
 * se acepta si trae datos más nuevos de uno que sigue visible. La lista de un alcance solo la sustituye una marca
 * posterior. Las escrituras son de mejor esfuerzo: si el dispositivo falla, lo aceptado sigue en memoria.
 */

export type ReminderScope = 'pending' | 'upcoming' | `pet-${string}`;
export const petScope = (petId: string): ReminderScope => `pet-${petId}`;

export type ReminderSnapshot = { reminder: Reminder; savedAt: string };
export type ReminderScopeSnapshot = { savedAt: string; ids: string[]; complete: boolean };
export type ReminderPermissionSnapshot = { canEdit: boolean; savedAt: string };

const isIso = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const SNAPSHOTS: LocalCollection<ReminderSnapshot> = {
  name: 'reminders',
  version: 1,
  parse(data) {
    if (!isRecord(data) || !isIso(data.savedAt)) return null;
    const reminder = toCachedReminder(data.reminder);
    return reminder ? { reminder, savedAt: data.savedAt as string } : null;
  },
  matchesKey: (value, key) => key.id.length === 1 && value.reminder.id === key.id[0],
};

const SCOPES: LocalCollection<ReminderScopeSnapshot> = {
  name: 'reminder-scopes',
  version: 1,
  parse(data) {
    if (!isRecord(data) || !isIso(data.savedAt) || typeof data.complete !== 'boolean') return null;
    if (!Array.isArray(data.ids) || !data.ids.every(isReminderUuid)) return null;
    return { savedAt: data.savedAt as string, ids: data.ids as string[], complete: data.complete };
  },
};

const PERMISSIONS: LocalCollection<ReminderPermissionSnapshot> = {
  name: 'reminder-permissions',
  version: 1,
  parse(data) {
    if (!isRecord(data) || typeof data.canEdit !== 'boolean' || !isIso(data.savedAt)) return null;
    return { canEdit: data.canEdit, savedAt: data.savedAt as string };
  },
};

export type LocalReminderScope =
  | { status: 'never_loaded' }
  | { status: 'loaded'; savedAt: string; complete: boolean; reminders: Reminder[] };

export class ReminderCacheError extends Error {
  readonly code = 'local_read_failed';
  readonly reason: 'storage_failed' | 'invalid_data' | 'unknown_version' | 'missing_reminder';

  constructor(reason: ReminderCacheError['reason'], cause?: unknown) {
    super(`local_read_failed: ${reason}`, { cause });
    this.name = 'ReminderCacheError';
    this.reason = reason;
  }
}

export type ReminderCacheRepository = {
  readonly userId: string;
  beginRead(): number;
  readScope(scope: ReminderScope): Promise<LocalReminderScope>;
  readReminder(id: string): Promise<ReminderSnapshot | null>;
  /** Aplica una lista correcta de un alcance. Devuelve lo que se debe mostrar (nunca datos más viejos). */
  applyScope(mark: number, scope: ReminderScope, rows: readonly Reminder[], options: { complete: boolean }): Promise<Reminder[]>;
  /** Una fila leída o escrita en el servidor (`null` = no existe o sin acceso). */
  applyReminder(mark: number, id: string, row: Reminder | null): Promise<Reminder | null>;
  readPermission(petId: string): Promise<boolean | null>;
  applyPermission(petId: string, canEdit: boolean): Promise<void>;
};

type Entry = { mark: number; snapshot: ReminderSnapshot | null };

export function createReminderCacheRepository(
  store: LocalStore,
  { now = () => new Date().toISOString() }: { now?: () => string } = {}
): ReminderCacheRepository {
  let queue: Promise<unknown> = Promise.resolve();
  let marks = 0;
  const entries = new Map<string, Entry>();
  const scopeMarks = new Map<ReminderScope, number>();
  const scopes = new Map<ReminderScope, ReminderScopeSnapshot>();

  const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };
  const bestEffort = async (write: () => Promise<void>) => {
    try {
      await write();
    } catch {
      // Lo aceptado sigue en memoria y la próxima lectura correcta lo reintenta.
    }
  };

  const currentSnapshot = async (id: string): Promise<ReminderSnapshot | null> => {
    const entry = entries.get(id);
    if (entry) return entry.snapshot;
    try {
      const result = await store.read(SNAPSHOTS, [id]);
      return result.status === 'found' ? result.value : null;
    } catch {
      return null;
    }
  };

  const currentScope = async (scope: ReminderScope): Promise<ReminderScopeSnapshot | null> => {
    const known = scopes.get(scope);
    if (known) return known;
    try {
      const result = await store.read(SCOPES, [scope]);
      return result.status === 'found' ? result.value : null;
    } catch {
      return null;
    }
  };

  const writeScope = async (scope: ReminderScope, next: ReminderScopeSnapshot) => {
    scopes.set(scope, next);
    await bestEffort(() => store.write(SCOPES, [scope], next));
  };

  const allScopeNames = async (): Promise<ReminderScope[]> => {
    const names = new Set<ReminderScope>(scopes.keys());
    try {
      for (const [name] of await store.list(SCOPES)) if (name) names.add(name as ReminderScope);
    } catch {
      // Sin listar: solo los conocidos en este proceso.
    }
    return [...names];
  };

  const accept = async (id: string, mark: number, snapshot: ReminderSnapshot | null, write: boolean) => {
    entries.set(id, { mark, snapshot });
    if (!write) return;
    await bestEffort(() => (snapshot ? store.write(SNAPSHOTS, [id], snapshot) : store.remove(SNAPSHOTS, [id])));
  };

  /** Observación de un recordatorio (`row` validada o `null` = ausente). Devuelve la copia visible. */
  const observe = async (mark: number, id: string, row: Reminder | null): Promise<ReminderSnapshot | null> => {
    const lastMark = entries.get(id)?.mark ?? 0;
    const current = await currentSnapshot(id);
    const savedAt = now();
    if (mark > lastMark) {
      if (row === null) {
        await accept(id, mark, null, current !== null);
        return null;
      }
      const order = current ? compareVersions(row.updated_at, current.reminder.updated_at) : 1;
      const data = order === -1 || order === null ? current!.reminder : row;
      const next = { reminder: data, savedAt };
      await accept(id, mark, next, true);
      return next;
    }
    if (row && current && compareVersions(row.updated_at, current.reminder.updated_at) === 1) {
      const next = { reminder: row, savedAt };
      await accept(id, lastMark, next, true);
      return next;
    }
    return current;
  };

  const belongsTo = (scope: ReminderScope, reminder: Reminder) => {
    if (scope === 'pending' || scope === 'upcoming') return reminder.status === 'pending';
    return scope === petScope(reminder.pet_id);
  };

  /** Una lista sustituye a la anterior: lo que deja de estar en todos los alcances se olvida. */
  const forgetUnreferenced = async (mark: number, removed: readonly string[], except: ReminderScope, keep: ReadonlySet<string>) => {
    if (removed.length === 0) return;
    const others = await allScopeNames();
    const referenced = new Set<string>(keep);
    for (const name of others) {
      if (name === except) continue;
      for (const id of (await currentScope(name))?.ids ?? []) referenced.add(id);
    }
    for (const id of removed) {
      if (!referenced.has(id)) await observe(mark, id, null);
    }
  };

  return {
    userId: store.userId,

    beginRead: () => {
      marks += 1;
      return marks;
    },

    readScope: (scope) =>
      exclusive(async () => {
        let result;
        try {
          result = await store.read(SCOPES, [scope]);
        } catch (error) {
          throw new ReminderCacheError('storage_failed', error);
        }
        if (result.status === 'missing') return { status: 'never_loaded' } as const;
        if (result.status === 'unknown_version') throw new ReminderCacheError('unknown_version');
        if (result.status === 'corrupt') throw new ReminderCacheError('invalid_data');
        const reminders: Reminder[] = [];
        for (const id of result.value.ids) {
          let snapshot;
          try {
            snapshot = await store.read(SNAPSHOTS, [id]);
          } catch (error) {
            throw new ReminderCacheError('storage_failed', error);
          }
          // Una fila de la lista sin copia legible: la lista no está completa, no se muestra a medias.
          if (snapshot.status !== 'found') throw new ReminderCacheError('missing_reminder');
          reminders.push(snapshot.value.reminder);
        }
        return { status: 'loaded', savedAt: result.value.savedAt, complete: result.value.complete, reminders };
      }),

    readReminder: (id) =>
      exclusive(async () => {
        if (!isReminderUuid(id)) return null;
        let result;
        try {
          result = await store.read(SNAPSHOTS, [id]);
        } catch (error) {
          throw new ReminderCacheError('storage_failed', error);
        }
        if (result.status === 'found') return result.value;
        if (result.status === 'missing') return null;
        throw new ReminderCacheError(result.status === 'unknown_version' ? 'unknown_version' : 'invalid_data');
      }),

    applyScope: (mark, scope, rows, { complete }) =>
      exclusive(async () => {
        const parsed = rows.map(toCachedReminder);
        // Una fila que no se podría volver a leer: no se guarda nada de esta respuesta.
        if (parsed.some((row) => row === null)) return [...rows];
        const shown: Reminder[] = [];
        for (const row of parsed as Reminder[]) {
          const snapshot = await observe(mark, row.id, row);
          if (snapshot) shown.push(snapshot.reminder);
        }
        if (mark <= (scopeMarks.get(scope) ?? 0)) return shown;
        scopeMarks.set(scope, mark);
        const previous = await currentScope(scope);
        const returned = new Set(shown.map((row) => row.id));
        const kept = complete ? [] : (previous?.ids ?? []).filter((id) => !returned.has(id));
        await writeScope(scope, { savedAt: now(), ids: [...returned, ...kept], complete });
        if (complete) {
          await forgetUnreferenced(mark, (previous?.ids ?? []).filter((id) => !returned.has(id)), scope, returned);
        }
        return shown;
      }),

    applyReminder: (mark, id, row) =>
      exclusive(async () => {
        if (!isReminderUuid(id)) return row;
        const parsed = row === null ? null : toCachedReminder(row);
        if (row !== null && (parsed === null || parsed.id !== id)) return row;
        const visible = await observe(mark, id, parsed);
        // Las listas guardadas reflejan lo último que se sabe de esta fila (alta, «hecho», borrado).
        for (const scope of await allScopeNames()) {
          const current = await currentScope(scope);
          if (!current) continue;
          const included = current.ids.includes(id);
          const belongs = visible !== null && belongsTo(scope, visible.reminder);
          if (belongs && !included) await writeScope(scope, { ...current, ids: [...current.ids, id] });
          if (!belongs && included) await writeScope(scope, { ...current, ids: current.ids.filter((item) => item !== id) });
        }
        return visible?.reminder ?? null;
      }),

    readPermission: (petId) =>
      exclusive(async () => {
        if (!isReminderUuid(petId)) return null;
        try {
          const result = await store.read(PERMISSIONS, [petId]);
          return result.status === 'found' ? result.value.canEdit : null;
        } catch {
          // Sin poder leerlo: valor desconocido, es decir, solo lectura.
          return null;
        }
      }),

    applyPermission: (petId, canEdit) =>
      exclusive(async () => {
        if (!isReminderUuid(petId)) return;
        await bestEffort(() => store.write(PERMISSIONS, [petId], { canEdit, savedAt: now() }));
      }),
  };
}
