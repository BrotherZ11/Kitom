// Servidor falso de `reminders` para las pruebas del motor de la agenda (`npm test`). Reproduce lo que importa del
// real (comprobado contra el Supabase local en `reminders-offline.integration.test.mjs` y en
// `supabase/tests/concurrency/reminders_concurrency.sh`):
// - alta: id del servidor; `client_request_id` único por creador (reenvío → 23505); sin permiso → 42501 (antes que el índice);
// - edición y borrado: `eq('updated_at', base)` → la fila, o 0 filas (otra versión, sin permiso o no existe);
// - lectura: la fila si el usuario es miembro; `updated_at` nuevo en cada escritura.
// `net.online = false`: ninguna petición llega. `loseNextResponse()`: se aplica pero la respuesta se pierde.
// `holdNext()`: retiene la siguiente respuesta hasta soltarla. No es un test (no termina en `.test.mjs`).
import { randomUUID } from 'node:crypto';

const NETWORK = { message: 'TypeError: Network request failed' };
const FORBIDDEN = { ok: false, error: { code: '42501', message: 'new row violates row-level security policy' }, status: 403 };

export function createFakeReminderServer() {
  const rows = new Map();
  const editors = new Map(); // petId → Set(userId)
  const viewers = new Map(); // petId → Set(userId)
  const calls = [];
  const net = { online: true };
  let clock = Date.parse('2026-11-05T10:00:00Z');
  let lose = false;
  let hold = null;

  const stamp = () => {
    clock += 1000;
    return new Date(clock).toISOString().replace('Z', '+00:00').replace('.000', '.123456');
  };
  const canEdit = (petId, userId) => editors.get(petId)?.has(userId) ?? false;
  const canRead = (petId, userId) => canEdit(petId, userId) || (viewers.get(petId)?.has(userId) ?? false);
  const toRow = (reminder) => {
    const { client_request_id, ...rest } = reminder;
    void client_request_id;
    return { ...rest };
  };

  async function respond(apply) {
    if (!net.online) return { ok: false, error: NETWORK, status: null };
    const result = apply();
    if (hold) {
      const wait = hold;
      hold = null;
      await wait;
    }
    if (lose) {
      lose = false;
      return { ok: false, error: NETWORK, status: null };
    }
    return result;
  }

  const remoteFor = (userId) => ({
    create(petId, content, clientRequestId) {
      calls.push({ userId, op: 'create', petId, clientRequestId, payload: { ...content } });
      return respond(() => {
        if (!canEdit(petId, userId)) return FORBIDDEN;
        for (const row of rows.values()) {
          if (row.created_by === userId && row.client_request_id === clientRequestId) return { ok: true, duplicate: true };
        }
        const at = stamp();
        const row = {
          id: randomUUID(),
          pet_id: petId,
          attachment_path: null,
          created_by: userId,
          created_at: at,
          updated_at: at,
          client_request_id: clientRequestId,
          ...content,
          // El servidor devuelve los instantes con su propio formato.
          due_at: new Date(content.due_at).toISOString().replace('Z', '+00:00'),
        };
        rows.set(row.id, row);
        return { ok: true, data: toRow(row), duplicate: false };
      });
    },
    findByRequestId(clientRequestId) {
      calls.push({ userId, op: 'findByRequestId', clientRequestId });
      return respond(() => {
        const row = [...rows.values()].find((item) => item.created_by === userId && item.client_request_id === clientRequestId && canRead(item.pet_id, userId));
        return { ok: true, data: row ? toRow(row) : null };
      });
    },
    update(id, content, baseUpdatedAt) {
      calls.push({ userId, op: 'update', id, baseUpdatedAt, payload: { ...content } });
      return respond(() => {
        const row = rows.get(id);
        if (!row || !canEdit(row.pet_id, userId) || row.updated_at !== baseUpdatedAt) return { ok: true, data: null };
        Object.assign(row, content, { updated_at: stamp() });
        return { ok: true, data: toRow(row) };
      });
    },
    fetch(id) {
      calls.push({ userId, op: 'fetch', id });
      return respond(() => {
        const row = rows.get(id);
        return { ok: true, data: row && canRead(row.pet_id, userId) ? toRow(row) : null };
      });
    },
    delete(id, baseUpdatedAt) {
      calls.push({ userId, op: 'delete', id, baseUpdatedAt });
      return respond(() => {
        const row = rows.get(id);
        if (!row || !canEdit(row.pet_id, userId) || row.updated_at !== baseUpdatedAt) return { ok: true, data: false };
        rows.delete(id);
        return { ok: true, data: true };
      });
    },
    canEdit(petId) {
      calls.push({ userId, op: 'canEdit', petId });
      return respond(() => ({ ok: true, data: canEdit(petId, userId) }));
    },
  });

  return {
    net,
    calls,
    rows,
    remoteFor,
    addEditor(petId, userId) {
      if (!editors.has(petId)) editors.set(petId, new Set());
      editors.get(petId).add(userId);
    },
    /** Lo baja a lector: sigue leyendo, ya no escribe. */
    demote(petId, userId) {
      editors.get(petId)?.delete(userId);
      if (!viewers.has(petId)) viewers.set(petId, new Set());
      viewers.get(petId).add(userId);
    },
    /** Lo expulsa: ni lee ni escribe. */
    remove(petId, userId) {
      editors.get(petId)?.delete(userId);
      viewers.get(petId)?.delete(userId);
    },
    insertElsewhere(petId, content, createdBy = null) {
      const at = stamp();
      const row = { id: randomUUID(), pet_id: petId, attachment_path: null, created_by: createdBy, created_at: at, updated_at: at, client_request_id: null, ...content };
      rows.set(row.id, row);
      return toRow(row);
    },
    editElsewhere(id, changes) {
      Object.assign(rows.get(id), changes, { updated_at: stamp() });
      return toRow(rows.get(id));
    },
    deleteElsewhere(id) {
      rows.delete(id);
    },
    rowOf: (id) => (rows.has(id) ? toRow(rows.get(id)) : null),
    loseNextResponse() {
      lose = true;
    },
    holdNext() {
      let release;
      hold = new Promise((resolve) => (release = resolve));
      return () => release();
    },
  };
}
