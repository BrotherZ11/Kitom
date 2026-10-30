// Pruebas de `account-deletion.ts` con el runner de Node (`npm test`). Ver frontend/CLAUDE.md.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AccountDeletionError,
  DELETE_ACCOUNT_CONFIRM,
  deletionErrorFromThrown,
  deletionRequestBody,
  finishAccountDeletion,
  parseDeletionPlan,
  readDeleteResponse,
  readPreviewResponse,
} from './account-deletion.ts';

const REX = 'aaaaaaaa-0000-4000-8000-000000000001';
const KIKA = 'aaaaaaaa-0000-4000-8000-000000000002';
const BEA = '33333333-3333-4333-8333-333333333333';

const serverPlan = {
  transfer: [{ pet_id: REX, pet_name: 'Rex', new_owner_id: BEA, new_owner_name: 'Bea' }],
  delete: [{ pet_id: KIKA, pet_name: 'Kika' }],
  leave_shared: 2,
};
const plan = {
  transfer: [{ petId: REX, petName: 'Rex', newOwnerId: BEA, newOwnerName: 'Bea' }],
  delete: [{ petId: KIKA, petName: 'Kika' }],
  leaveShared: 2,
};

const failsWith = (fn, code) => assert.throws(fn, (error) => error instanceof AccountDeletionError && error.code === code);

describe('plan', () => {
  it('lee el plan de la función y rechaza otra forma', () => {
    assert.deepEqual(parseDeletionPlan(serverPlan), plan);
    assert.deepEqual(
      parseDeletionPlan({ ...serverPlan, transfer: [{ ...serverPlan.transfer[0], new_owner_name: null }] }).transfer[0].newOwnerName,
      null
    );
    assert.equal(parseDeletionPlan({ ...serverPlan, leave_shared: -1 }), null);
    assert.equal(parseDeletionPlan({ ...serverPlan, delete: [{ pet_id: KIKA }] }), null);
    assert.equal(parseDeletionPlan({ ...serverPlan, transfer: [{ pet_id: REX, pet_name: 'Rex' }] }), null);
    assert.equal(parseDeletionPlan(null), null);
  });

  it('confirma exactamente el plan mostrado', () => {
    assert.deepEqual(deletionRequestBody(plan), {
      mode: 'delete',
      confirm: DELETE_ACCOUNT_CONFIRM,
      expected: [
        { pet_id: REX, action: 'transfer', new_owner_id: BEA },
        { pet_id: KIKA, action: 'delete' },
      ],
    });
  });
});

describe('respuestas', () => {
  it('vista previa: plan, cuenta ya borrada o error', () => {
    assert.deepEqual(readPreviewResponse(200, { status: 'preview', plan: serverPlan }), { status: 'ready', plan });
    assert.deepEqual(readPreviewResponse(410, { error: 'account_not_found' }), { status: 'already_deleted' });
    failsWith(() => readPreviewResponse(200, { status: 'preview', plan: {} }), 'server');
    failsWith(() => readPreviewResponse(401, { error: 'not_authenticated' }), 'session');
    failsWith(() => readPreviewResponse(409, { error: 'too_many_pets' }), 'too_many_pets');
    failsWith(() => readPreviewResponse(500, { error: 'server_error' }), 'server');
  });

  it('borrado: hecho, ya borrada (lo mismo para la app), plan cambiado con el plan nuevo, a medias', () => {
    assert.deepEqual(readDeleteResponse(200, { status: 'deleted', transferred: 1, deleted: 1, avatars_removed: 0 }), { status: 'deleted' });
    assert.deepEqual(readDeleteResponse(410, { error: 'account_not_found' }), { status: 'already_deleted' });
    assert.throws(
      () => readDeleteResponse(409, { error: 'plan_changed', plan: serverPlan }),
      (error) => error.code === 'plan_changed' && error.plan.transfer[0].newOwnerName === 'Bea'
    );
    // Un 409 sin plan legible no se puede volver a confirmar.
    failsWith(() => readDeleteResponse(409, { error: 'plan_changed' }), 'server');
    failsWith(() => readDeleteResponse(500, { error: 'deletion_incomplete', step: 'transfer' }), 'incomplete');
    failsWith(() => readDeleteResponse(400, { error: 'invalid_request' }), 'server');
    failsWith(() => readDeleteResponse(200, null), 'server');
    // 410 con otro cuerpo no es «ya borrada».
    failsWith(() => readDeleteResponse(410, {}), 'server');
  });

  it('errores sin respuesta: red y sesión no utilizable son `network`', () => {
    assert.equal(deletionErrorFromThrown(new TypeError('Network request failed')).code, 'network');
    assert.equal(deletionErrorFromThrown(Object.assign(new Error('x'), { name: 'FunctionsFetchError' })).code, 'network');
    assert.equal(deletionErrorFromThrown(Object.assign(new Error('x'), { name: 'SessionUnavailableError' })).code, 'network');
    assert.equal(deletionErrorFromThrown(new Error('Failed to fetch')).code, 'network');
    assert.equal(deletionErrorFromThrown(Object.assign(new Error('x'), { name: 'FunctionsRelayError' })).code, 'server');
    const known = new AccountDeletionError('incomplete');
    assert.equal(deletionErrorFromThrown(known), known);
  });
});

describe('finishAccountDeletion', () => {
  const engine = (calls, name, idle = () => Promise.resolve()) => ({
    stop: () => calls.push(`stop:${name}`),
    idle: () => {
      calls.push(`idle:${name}`);
      return idle();
    },
  });

  it('para los motores, borra lo local y los avisos, cierra sesión y vuelve a borrar', async () => {
    const calls = [];
    const result = await finishAccountDeletion({
      engines: [engine(calls, 'daily'), engine(calls, 'pets')],
      idleTimeoutMs: 1000,
      clearLocalData: async () => calls.push('clear'),
      cancelNotifications: async () => calls.push('notifications'),
      signOut: async () => calls.push('signOut'),
    });
    assert.deepEqual(result, { localDataCleared: true });
    assert.deepEqual(calls, ['stop:daily', 'stop:pets', 'idle:daily', 'idle:pets', 'clear', 'notifications', 'signOut', 'clear']);
  });

  it('no espera más del tope a un envío colgado y nunca lanza', async () => {
    const calls = [];
    let waited = null;
    const result = await finishAccountDeletion({
      engines: [engine(calls, 'daily', () => new Promise(() => {}))],
      idleTimeoutMs: 1234,
      wait: async (ms) => {
        waited = ms;
      },
      clearLocalData: async () => {
        throw new Error('storage');
      },
      cancelNotifications: async () => {
        throw new Error('notifications');
      },
      signOut: async () => {
        throw new Error('user_not_found');
      },
    });
    assert.equal(waited, 1234);
    assert.deepEqual(result, { localDataCleared: false });
  });

  it('basta con que uno de los dos borrados funcione', async () => {
    let attempt = 0;
    const result = await finishAccountDeletion({
      engines: [],
      idleTimeoutMs: 10,
      clearLocalData: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('storage');
      },
      cancelNotifications: async () => {},
      signOut: async () => ({ error: 'network' }),
    });
    assert.deepEqual(result, { localDataCleared: true });
  });
});
