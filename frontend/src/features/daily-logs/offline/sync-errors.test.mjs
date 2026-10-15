// Pruebas de `sync-errors.ts` con el runner de Node (`npm test`). Ver frontend/CLAUDE.md.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { toDailyLogError } from '../daily-log-errors.ts';
import { classifySyncError, isRecoverableSyncError } from './sync-errors.ts';

const classify = (error, status) => {
  const { kind, policy } = classifySyncError(error, status);
  return `${kind}/${policy}`;
};
const conflict = (details) => ({ code: 'P0001', message: '…', hint: 'daily_log_conflict', details });

describe('classifySyncError: red', () => {
  it('sin respuesta (fetch lanzó o se abortó) es red y se reintenta', () => {
    assert.equal(classify(new TypeError('Network request failed')), 'network/retry');
    assert.equal(classify(new TypeError('Failed to fetch')), 'network/retry');
    // postgrest-js devuelve el fallo de fetch como objeto, con status 0.
    assert.equal(classify({ message: 'TypeError: Network request failed', code: '', hint: '', details: '' }, 0), 'network/retry');
    assert.equal(classify({ name: 'AbortError', message: 'Aborted' }), 'network/retry');
    assert.equal(classify(new TypeError('Network request timed out')), 'network/retry');
    assert.equal(classify(new TypeError('Load failed')), 'network/retry');
    assert.equal(classify(new TypeError('NetworkError when attempting to fetch resource.')), 'network/retry');
  });

  it('un TypeError cualquiera no es un corte de red', () => {
    assert.equal(classify(new TypeError("Cannot read properties of undefined (reading 'rpc')")), 'unknown/retry');
    assert.equal(classify(new TypeError('x is not a function')), 'unknown/retry');
  });

  it('una respuesta HTTP fallida no es ausencia de red', () => {
    assert.equal(classify({ message: 'Failed to fetch upstream' }, 502), 'server/retry');
    assert.equal(classify({ message: 'network request failed' }, 400), 'unknown/give_up');
    assert.equal(classify(new TypeError('Failed to fetch'), 500), 'server/retry');
    assert.equal(classify({ code: '57014', message: 'canceling statement due to statement timeout' }, 500), 'server/retry');
  });
});

describe('classifySyncError: autenticación y permisos', () => {
  it('sin sesión válida se espera a tenerla, sin gastar intentos', () => {
    assert.equal(classify({ code: 'PGRST301', message: 'JWT expired' }, 401), 'auth/wait_for_auth');
    assert.equal(classify({ code: 'PGRST303', message: 'JWT expired' }), 'auth/wait_for_auth');
    assert.equal(classify({ code: '42501', message: 'permission denied for function save_daily_log' }, 401), 'auth/wait_for_auth');
    assert.equal(classify({ message: 'Unauthorized' }, 401), 'auth/wait_for_auth');
  });

  it('sin permiso de edición (viewer, acceso revocado) es permanente', () => {
    assert.equal(classify({ code: '42501', message: 'No tienes acceso de edición sobre esta mascota' }, 403), 'permission/give_up');
    assert.equal(classify({ code: '42501', message: '…' }), 'permission/give_up');
    assert.equal(classify({ message: 'Forbidden' }, 403), 'permission/give_up');
  });
});

describe('classifySyncError: validación', () => {
  it('fecha, CHECKs y tipos no se reintentan', () => {
    assert.equal(classify({ code: 'P0001', hint: 'log_date_future' }, 400), 'validation/give_up');
    assert.equal(classify({ code: 'P0001', hint: 'log_date_too_old' }, 400), 'validation/give_up');
    assert.equal(classify({ code: '23514', message: 'violates check constraint "daily_logs_not_empty_check"' }, 400), 'validation/give_up');
    assert.equal(classify({ code: '22P02', message: 'invalid input syntax' }, 400), 'validation/give_up');
    assert.equal(classify({ code: '22023', message: 'p_expected_updated_at y p_expect_absent…' }, 400), 'validation/give_up');
  });

  it('el código de diagnóstico es el hint o el código, nunca el mensaje', () => {
    assert.equal(classifySyncError({ code: 'P0001', hint: 'log_date_too_old', message: 'secreto' }).reason, 'log_date_too_old');
    assert.equal(classifySyncError({ code: '23514', message: 'nota privada' }).reason, '23514');
    assert.equal(classifySyncError({ message: 'nota privada' }, 418).reason, 'http_418');
    assert.equal(classifySyncError(new TypeError('Failed to fetch')).reason, 'network');
  });
});

describe('classifySyncError: conflictos', () => {
  it('la precondición no se cumple: hay que resolver, no reenviar', () => {
    for (const detail of ['version_mismatch', 'row_missing', 'row_exists']) {
      assert.deepEqual(classifySyncError(conflict(detail), 400), {
        kind: 'conflict',
        policy: 'resolve_conflict',
        reason: detail,
        conflict: detail,
      });
    }
  });

  it('conflicto sin motivo reconocible sigue siendo conflicto', () => {
    assert.deepEqual(classifySyncError(conflict('otro'), 400), {
      kind: 'conflict',
      policy: 'resolve_conflict',
      reason: 'daily_log_conflict',
      conflict: null,
    });
  });

  it('otra excepción P0001 no es un conflicto', () => {
    assert.equal(classify({ code: 'P0001', message: 'No se pudo guardar el registro diario' }, 400), 'unknown/give_up');
  });
});

describe('classifySyncError: recuperables frente a permanentes', () => {
  it('fallos transitorios del servidor se reintentan', () => {
    assert.equal(classify({ message: 'Service Unavailable' }, 503), 'server/retry');
    assert.equal(classify({ message: 'Too Many Requests' }, 429), 'server/retry');
    assert.equal(classify({ code: 'PGRST002', message: 'schema cache' }, 503), 'server/retry');
    assert.equal(classify({ code: '40001', message: 'could not serialize access' }, 400), 'server/retry');
    assert.equal(classify({ code: '53300', message: 'too many connections' }), 'server/retry');
  });

  it('lo desconocido: un 4xx no se repite; sin datos se reintenta (con límite)', () => {
    assert.equal(classify({ code: 'PGRST202', message: 'function not found' }, 404), 'unknown/give_up');
    assert.equal(classify({ code: 'XX000', message: 'boom' }), 'unknown/retry');
    assert.equal(classify(null), 'unknown/retry');
    assert.equal(classify('texto'), 'unknown/retry');
  });

  it('isRecoverableSyncError separa lo que puede completarse solo de lo que necesita al usuario', () => {
    const recoverable = (error, status) => isRecoverableSyncError(classifySyncError(error, status));
    assert.equal(recoverable(new TypeError('Network request failed')), true);
    assert.equal(recoverable({ message: 'Bad Gateway' }, 502), true);
    assert.equal(recoverable({ code: 'PGRST301' }, 401), true);
    assert.equal(recoverable({ code: '42501' }, 403), false);
    assert.equal(recoverable({ code: '23514' }, 400), false);
    assert.equal(recoverable({ code: 'P0001', hint: 'log_date_too_old' }, 400), false);
    assert.equal(recoverable(conflict('version_mismatch'), 400), false);
  });

  it('abre un DailyLogError para clasificar por su causa', () => {
    assert.equal(classify(toDailyLogError(conflict('row_exists')), 400), 'conflict/resolve_conflict');
    assert.equal(classify(toDailyLogError(new TypeError('Network request failed'))), 'network/retry');
    assert.equal(classify(toDailyLogError({ code: '42501', message: '…' })), 'permission/give_up');
  });
});
