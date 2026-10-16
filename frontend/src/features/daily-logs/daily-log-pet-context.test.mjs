// Pruebas de `daily-log-pet-context.ts` (`npm test`): la mascota no está en caché y no hay conexión.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveDailyLogPetContext } from './daily-log-pet-context.ts';

const OFFLINE = { message: 'TypeError: Network request failed' };
const FORBIDDEN = { code: '42501' };
const isOffline = (error) => error === OFFLINE;
const ok = (data) => ({ data, isError: false, error: null });
const failed = (error) => ({ data: undefined, isError: true, error });
const pending = { data: undefined, isError: false, error: null };

describe('resolveDailyLogPetContext', () => {
  it('11. sin la mascota en caché y sin conexión: el registro sigue, sin nombre inventado y con permiso desconocido', () => {
    assert.deepEqual(resolveDailyLogPetContext(failed(OFFLINE), failed(OFFLINE), isOffline), {
      state: 'ready',
      name: null,
      canEdit: true,
      permissionUnknown: true,
    });
  });

  it('con los datos (en caché o del servidor): los del servidor', () => {
    assert.deepEqual(resolveDailyLogPetContext(ok({ name: 'Luna' }), ok(false), isOffline), {
      state: 'ready',
      name: 'Luna',
      canEdit: false,
      permissionUnknown: false,
    });
    // Nombre en caché y permiso no: se conoce el nombre, el permiso no.
    assert.deepEqual(resolveDailyLogPetContext(ok({ name: 'Luna' }), failed(OFFLINE), isOffline).permissionUnknown, true);
  });

  it('otros errores siguen siendo errores; no existe o sin acceso → not_found; cargando → loading', () => {
    assert.deepEqual(resolveDailyLogPetContext(failed(FORBIDDEN), ok(true), isOffline), {
      state: 'error',
      error: FORBIDDEN,
      source: 'pet',
    });
    assert.equal(resolveDailyLogPetContext(ok({ name: 'Luna' }), failed(FORBIDDEN), isOffline).source, 'permission');
    assert.equal(resolveDailyLogPetContext(ok(null), failed(OFFLINE), isOffline).state, 'not_found');
    assert.equal(resolveDailyLogPetContext(pending, failed(OFFLINE), isOffline).state, 'loading');
    assert.equal(resolveDailyLogPetContext(failed(OFFLINE), pending, isOffline).state, 'loading');
  });
});
