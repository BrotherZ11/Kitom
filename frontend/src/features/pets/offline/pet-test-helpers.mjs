// Ayudantes de las pruebas de la copia de mascotas (`npm test`). No es un test (no termina en `.test.mjs`).
import { randomUUID } from 'node:crypto';

import { createLocalStore } from '../../../lib/local-store/local-store.ts';
import { createMemoryStorage } from '../../../lib/local-store/memory-storage.ts';
import { createPetCacheRepository } from './pet-cache-repository.ts';

export const USER_A = '11111111-1111-4111-8111-111111111111';
export const USER_B = '22222222-2222-4222-8222-222222222222';
export const SPECIES = '33333333-3333-4333-8333-333333333333';

/** Fila de `pets` válida (las columnas de `PET_COLUMNS`). */
export function makePet(overrides = {}) {
  return {
    id: randomUUID(),
    owner_id: USER_A,
    name: 'Luna',
    species_id: SPECIES,
    sex: 'female',
    breed: null,
    breed_id: null,
    breed_status: null,
    birth_date: '2020-05-01',
    weight_kg: 4.2,
    sterilized: true,
    known_conditions: null,
    allergies: ['polen'],
    temperament_notes: null,
    photo_path: null,
    is_active: true,
    created_at: '2026-10-01T09:00:00.000001+00:00',
    updated_at: '2026-10-01T09:00:00.000001+00:00',
    ...overrides,
  };
}

/** `updated_at` de PostgREST `n` segundos después de la base. */
export const at = (seconds) =>
  `2026-10-01T09:${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.000001+00:00`;

/** Reloj falso del dispositivo (ISO), que avanza un segundo en cada lectura. */
export function fakeClock(start = Date.parse('2026-10-20T12:00:00Z')) {
  let now = start;
  return () => {
    now += 1000;
    return new Date(now).toISOString();
  };
}

/** Disco compartido (como AsyncStorage tras reiniciar) y un repositorio por usuario sobre él. */
export function device(disk = new Map()) {
  return {
    disk,
    repository(userId, options = {}) {
      return createPetCacheRepository(createLocalStore(createMemoryStorage(disk), userId), { now: fakeClock(), ...options });
    },
  };
}

/** Promesa controlable desde fuera (para retener una respuesta). */
export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
