import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createPasswordRecoveryTracker,
  isRecoveryPendingFor,
  parseRecoveryMarker,
  PASSWORD_RECOVERY_STORAGE_KEY,
  recoveryChangeFor,
} from './password-recovery.ts';

const KEY = PASSWORD_RECOVERY_STORAGE_KEY;

function memoryStorage(initial = {}) {
  const disk = new Map(Object.entries(initial));
  return {
    disk,
    getItem: async (key) => disk.get(key) ?? null,
    setItem: async (key, value) => void disk.set(key, value),
    removeItem: async (key) => void disk.delete(key),
  };
}

/** Espera a que terminen las escrituras encadenadas (microtareas). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const signedIn = (userId, cause = 'SIGNED_IN') => ({ cause, status: 'signed_in', userId });
const marker = (userId) => JSON.stringify({ userId, startedAt: 1 });

describe('parseRecoveryMarker', () => {
  it('solo acepta { userId, startedAt } válidos', () => {
    assert.deepEqual(parseRecoveryMarker(marker('u1')), { userId: 'u1', startedAt: 1 });
    assert.equal(parseRecoveryMarker(null), null);
    assert.equal(parseRecoveryMarker('no-json'), null);
    assert.equal(parseRecoveryMarker('{"userId":""}'), null);
    assert.equal(parseRecoveryMarker('{"userId":"u1"}'), null);
    assert.equal(parseRecoveryMarker('null'), null);
  });
});

describe('recoveryChangeFor', () => {
  it('PASSWORD_RECOVERY con sesión marca a ese usuario (también si ya había sesión)', () => {
    assert.deepEqual(recoveryChangeFor(signedIn('u1', 'PASSWORD_RECOVERY'), null), { type: 'set', userId: 'u1' });
    assert.deepEqual(recoveryChangeFor(signedIn('u2', 'PASSWORD_RECOVERY'), 'u1'), { type: 'set', userId: 'u2' });
  });

  it('se borra si la sesión deja de ser del usuario marcado', () => {
    assert.deepEqual(recoveryChangeFor({ cause: 'SIGNED_OUT', status: 'signed_out', userId: null }, 'u1'), { type: 'clear' });
    assert.deepEqual(recoveryChangeFor(signedIn('u2'), 'u1'), { type: 'clear' });
  });

  it('se mantiene con la misma cuenta, también sin conexión', () => {
    assert.equal(recoveryChangeFor(signedIn('u1', 'TOKEN_REFRESHED'), 'u1'), null);
    assert.equal(recoveryChangeFor(signedIn('u1', 'USER_UPDATED'), 'u1'), null);
    assert.equal(recoveryChangeFor({ cause: 'storage', status: 'offline', userId: 'u1' }, 'u1'), null);
    assert.equal(recoveryChangeFor(signedIn('u1'), null), null);
  });
});

describe('createPasswordRecoveryTracker', () => {
  it('arranque en frío con la marca del usuario de la sesión: recuperación pendiente', async () => {
    const storage = memoryStorage({ [KEY]: marker('u1') });
    const tracker = createPasswordRecoveryTracker({ storage });
    assert.equal(tracker.getSnapshot().loaded, false);
    tracker.authChanged(signedIn('u1', 'INITIAL_SESSION'));
    await tracker.load();
    assert.deepEqual(tracker.getSnapshot(), { loaded: true, userId: 'u1' });
    assert.equal(isRecoveryPendingFor(tracker.getSnapshot(), 'u1'), true);
    assert.equal(isRecoveryPendingFor(tracker.getSnapshot(), 'u2'), false);
  });

  it('la sesión llega después de leer la marca: sigue pendiente', async () => {
    const storage = memoryStorage({ [KEY]: marker('u1') });
    const tracker = createPasswordRecoveryTracker({ storage });
    await tracker.load();
    tracker.authChanged({ cause: 'storage', status: 'offline', userId: 'u1' });
    assert.equal(isRecoveryPendingFor(tracker.getSnapshot(), 'u1'), true);
  });

  it('marca de otra cuenta o sin sesión al arrancar: se borra y no se bloquea', async () => {
    const storage = memoryStorage({ [KEY]: marker('u1') });
    const tracker = createPasswordRecoveryTracker({ storage });
    tracker.authChanged(signedIn('u2', 'INITIAL_SESSION'));
    await tracker.load();
    await settle();
    assert.deepEqual(tracker.getSnapshot(), { loaded: true, userId: null });
    assert.equal(storage.disk.has(KEY), false);

    const storage2 = memoryStorage({ [KEY]: marker('u1') });
    const tracker2 = createPasswordRecoveryTracker({ storage: storage2 });
    await tracker2.load();
    tracker2.authChanged({ cause: 'INITIAL_SESSION', status: 'signed_out', userId: null });
    await settle();
    assert.equal(tracker2.getSnapshot().userId, null);
    assert.equal(storage2.disk.has(KEY), false);
  });

  it('PASSWORD_RECOVERY guarda la marca; guardar la contraseña la borra', async () => {
    const storage = memoryStorage();
    const tracker = createPasswordRecoveryTracker({ storage, now: () => 42 });
    await tracker.load();
    let notified = 0;
    tracker.subscribe(() => notified++);
    tracker.authChanged(signedIn('u1', 'PASSWORD_RECOVERY'));
    await settle();
    assert.equal(isRecoveryPendingFor(tracker.getSnapshot(), 'u1'), true);
    assert.deepEqual(JSON.parse(storage.disk.get(KEY)), { userId: 'u1', startedAt: 42 });
    tracker.authChanged(signedIn('u1', 'USER_UPDATED'));
    tracker.completed();
    await settle();
    assert.equal(tracker.getSnapshot().userId, null);
    assert.equal(storage.disk.has(KEY), false);
    assert.equal(notified, 2);
  });

  it('cerrar sesión durante la recuperación la borra', async () => {
    const storage = memoryStorage();
    const tracker = createPasswordRecoveryTracker({ storage });
    await tracker.load();
    tracker.authChanged(signedIn('u1', 'PASSWORD_RECOVERY'));
    tracker.authChanged({ cause: 'SIGNED_OUT', status: 'signed_out', userId: null });
    await settle();
    assert.equal(tracker.getSnapshot().userId, null);
    assert.equal(storage.disk.has(KEY), false);
  });

  it('un PASSWORD_RECOVERY antes de terminar la lectura manda sobre lo leído', async () => {
    let release;
    const storage = memoryStorage({ [KEY]: marker('viejo') });
    const slow = { ...storage, getItem: () => new Promise((resolve) => (release = () => resolve(marker('viejo')))) };
    const tracker = createPasswordRecoveryTracker({ storage: slow });
    const loading = tracker.load();
    tracker.authChanged(signedIn('u1', 'PASSWORD_RECOVERY'));
    release();
    await loading;
    await settle();
    assert.deepEqual(tracker.getSnapshot(), { loaded: true, userId: 'u1' });
    assert.equal(JSON.parse(storage.disk.get(KEY)).userId, 'u1');
  });

  it('si el almacenamiento falla: sin marca al leer y la recuperación en curso sigue en memoria', async () => {
    const errors = [];
    const broken = {
      getItem: async () => {
        throw new Error('keystore');
      },
      setItem: async () => {
        throw new Error('keystore');
      },
      removeItem: async () => {},
    };
    const tracker = createPasswordRecoveryTracker({ storage: broken, onStorageError: (error) => errors.push(error) });
    await tracker.load();
    assert.deepEqual(tracker.getSnapshot(), { loaded: true, userId: null });
    tracker.authChanged(signedIn('u1', 'PASSWORD_RECOVERY'));
    await settle();
    assert.equal(isRecoveryPendingFor(tracker.getSnapshot(), 'u1'), true);
    assert.equal(errors.length, 2);
  });

  it('sin leer la marca no hay recuperación pendiente para nadie', () => {
    assert.equal(isRecoveryPendingFor({ loaded: false, userId: 'u1' }, 'u1'), false);
    assert.equal(isRecoveryPendingFor({ loaded: true, userId: 'u1' }, null), false);
  });
});
