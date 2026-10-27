// Servidor falso de `pets` para las pruebas del motor de altas y ediciones (`npm test`). Reproduce lo
// que importa del real (comprobado contra el Supabase local en `pets-offline-writes.integration.test.mjs`
// y `supabase/tests/concurrency/pets_concurrency.sh`):
// - alta: id del servidor; `client_request_id` único por propietario (reenvío → 23505 del índice);
// - edición: `update … eq('updated_at', base)` → la fila o 0 filas (otra versión, sin permiso o no existe);
// - `updated_at` nuevo en cada edición; lectura: la fila si el usuario es miembro.
// - eliminación (fase 10): `delete … eq('updated_at', base)` solo del propietario (`pets: delete owner`)
//   → `true` o `false` (0 filas: otra versión, no es el propietario o ya no existe).
// `net.online = false`: ninguna petición llega. `loseNextResponse()`: la siguiente se aplica pero la
// respuesta se pierde (error de red). `holdNext()`: retiene la siguiente respuesta hasta soltarla.
// No es un test (no termina en `.test.mjs`).
import { randomUUID } from 'node:crypto';

const NETWORK = { message: 'TypeError: Network request failed' };

export function createFakePetServer({ owner }) {
  const pets = new Map();
  const editors = new Map(); // petId → Set(userId)
  const calls = [];
  const net = { online: true };
  let clock = Date.parse('2026-10-20T10:00:00Z');
  let lose = false;
  let hold = null;

  const stamp = () => {
    clock += 1000;
    return new Date(clock).toISOString().replace('Z', '+00:00').replace('.000', '.123456');
  };
  const visible = (pet, userId) => pet.owner_id === userId || editors.get(pet.id)?.has(userId);
  const canEdit = (pet, userId) => visible(pet, userId);
  // Lo que devuelve PostgREST con `PET_COLUMNS` (sin `client_request_id`).
  const row = (pet) => {
    const { client_request_id, ...rest } = pet;
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

  /** El remoto de un usuario (lo que haría `createPetWritesRemote` con su token). */
  const remoteFor = (userId) => ({
    create(content, clientRequestId) {
      calls.push({ userId, op: 'create', payload: { ...content }, clientRequestId });
      return respond(() => {
        for (const pet of pets.values()) {
          if (pet.owner_id === userId && pet.client_request_id === clientRequestId) return { ok: true, duplicate: true };
        }
        const at = stamp();
        const pet = {
          id: randomUUID(),
          owner_id: userId,
          ...content,
          photo_path: null,
          is_active: true,
          created_at: at,
          updated_at: at,
          client_request_id: clientRequestId,
        };
        pets.set(pet.id, pet);
        return { ok: true, data: row(pet), duplicate: false };
      });
    },
    findByRequestId(clientRequestId) {
      calls.push({ userId, op: 'findByRequestId', clientRequestId });
      return respond(() => {
        const pet = [...pets.values()].find((item) => item.owner_id === userId && item.client_request_id === clientRequestId);
        return { ok: true, data: pet ? row(pet) : null };
      });
    },
    update(petId, content, baseUpdatedAt) {
      calls.push({ userId, op: 'update', petId, payload: { ...content }, baseUpdatedAt });
      return respond(() => {
        const pet = pets.get(petId);
        if (!pet || !canEdit(pet, userId) || pet.updated_at !== baseUpdatedAt) return { ok: true, data: null };
        Object.assign(pet, content, { updated_at: stamp() });
        return { ok: true, data: row(pet) };
      });
    },
    fetch(petId) {
      calls.push({ userId, op: 'fetch', petId });
      return respond(() => {
        const pet = pets.get(petId);
        return { ok: true, data: pet && visible(pet, userId) ? row(pet) : null };
      });
    },
    delete(petId, baseUpdatedAt) {
      calls.push({ userId, op: 'delete', petId, baseUpdatedAt });
      return respond(() => {
        const pet = pets.get(petId);
        if (!pet || pet.owner_id !== userId || pet.updated_at !== baseUpdatedAt) return { ok: true, data: false };
        pets.delete(petId);
        return { ok: true, data: true };
      });
    },
  });

  return {
    net,
    calls,
    pets,
    remote: remoteFor(owner),
    remoteFor,
    /** Escritura hecha fuera de este dispositivo (otra sesión o co-tutor). */
    editElsewhere(petId, changes) {
      Object.assign(pets.get(petId), changes, { updated_at: stamp() });
      return row(pets.get(petId));
    },
    insertElsewhere(pet) {
      const at = stamp();
      const stored = { photo_path: null, is_active: true, created_at: at, updated_at: at, client_request_id: null, ...pet };
      pets.set(stored.id, stored);
      return row(stored);
    },
    addEditor(petId, userId) {
      if (!editors.has(petId)) editors.set(petId, new Set());
      editors.get(petId).add(userId);
    },
    removeEditor(petId, userId) {
      editors.get(petId)?.delete(userId);
    },
    deleteElsewhere(petId) {
      pets.delete(petId);
    },
    rowOf: (petId) => (pets.has(petId) ? row(pets.get(petId)) : null),
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
