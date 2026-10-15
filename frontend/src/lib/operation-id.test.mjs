// Pruebas de `operation-id.ts` con el runner de Node (`npm test`). Ver frontend/CLAUDE.md.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it, mock } from 'node:test';

import { OperationIdError, createOperationIdGenerator, isOperationId } from './operation-id.ts';

const fails = (generate, code) =>
  assert.throws(generate, (error) => error instanceof OperationIdError && error.code === code);

describe('createOperationIdGenerator', () => {
  it('devuelve UUID v4 en minúsculas, distintos entre sí', () => {
    // Fuente real y segura (la de Node); en la app es expo-crypto.
    const createOperationId = createOperationIdGenerator(randomUUID);
    const ids = new Set();
    for (let index = 0; index < 5_000; index += 1) {
      const id = createOperationId();
      assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      ids.add(id);
    }
    assert.equal(ids.size, 5_000);
  });

  it('normaliza a minúsculas lo que devuelva la fuente', () => {
    const createOperationId = createOperationIdGenerator(() => 'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D');
    assert.equal(createOperationId(), 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d');
  });

  it('pide un valor nuevo a la fuente en cada llamada, y solo uno', () => {
    const source = mock.fn(randomUUID);
    const createOperationId = createOperationIdGenerator(source);
    assert.equal(source.mock.callCount(), 0);
    createOperationId();
    createOperationId();
    assert.equal(source.mock.callCount(), 2);
  });

  it('nunca usa Math.random, ni cuando la fuente falla', () => {
    const random = mock.method(Math, 'random', () => assert.fail('Math.random no es una fuente válida'));
    try {
      createOperationIdGenerator(randomUUID)();
      fails(
        createOperationIdGenerator(() => {
          throw new TypeError('crypto.randomUUID is not a function');
        }),
        'unavailable'
      );
      fails(createOperationIdGenerator(() => undefined), 'invalid');
      assert.equal(random.mock.callCount(), 0);
    } finally {
      random.mock.restore();
    }
  });

  it('si la fuente no está disponible lanza `unavailable` y conserva la causa', () => {
    const cause = new Error('ERR_CRYPTO_UNAVAILABLE');
    assert.throws(
      createOperationIdGenerator(() => {
        throw cause;
      }),
      (error) => error instanceof OperationIdError && error.code === 'unavailable' && error.cause === cause
    );
  });

  it('rechaza lo que no sea un UUID v4', () => {
    for (const value of [
      '',
      'op-1',
      '0.8437291',
      '00000000-0000-0000-0000-000000000000', // nil
      'a1b2c3d4-e5f6-1a7b-8c9d-0e1f2a3b4c5d', // v1 (basado en tiempo)
      'a1b2c3d4-e5f6-4a7b-7c9d-0e1f2a3b4c5d', // variante incorrecta
      'a1b2c3d4e5f64a7b8c9d0e1f2a3b4c5d',
      null,
      42,
    ]) {
      fails(createOperationIdGenerator(() => value), 'invalid');
    }
  });
});

describe('isOperationId', () => {
  it('solo acepta UUID v4 en minúsculas', () => {
    assert.equal(isOperationId(randomUUID()), true);
    assert.equal(isOperationId(randomUUID().toUpperCase()), false);
    assert.equal(isOperationId('op-1'), false);
    assert.equal(isOperationId(undefined), false);
  });
});
