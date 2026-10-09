// Pruebas de `daily-log-errors.ts` con el runner de Node (`npm test`). Ver frontend/CLAUDE.md.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { toDailyLogError } from './daily-log-errors.ts';

const code = (error) => toDailyLogError(error).code;

describe('toDailyLogError', () => {
  it('red', () => {
    assert.equal(code(new TypeError('Network request failed')), 'network');
    assert.equal(code({ message: 'TypeError: Failed to fetch' }), 'network');
  });

  it('permisos (viewer, ajeno, sin sesión)', () => {
    assert.equal(code({ code: '42501', message: 'No tienes acceso de edición sobre esta mascota' }), 'not_allowed');
  });

  it('fecha fuera de la ventana o futura, por el hint', () => {
    assert.equal(code({ code: 'P0001', message: '…', hint: 'log_date_future' }), 'invalid_date');
    assert.equal(code({ code: 'P0001', message: '…', hint: 'log_date_too_old' }), 'invalid_date');
    assert.equal(code({ code: 'P0001', message: 'otra excepción', hint: null }), 'unknown');
  });

  it('CHECKs de daily_logs por nombre de constraint', () => {
    const check = (name) => ({ code: '23514', message: `violates check constraint "${name}"` });
    assert.equal(code(check('daily_logs_not_empty_check')), 'empty');
    assert.equal(code(check('daily_logs_notes_length_check')), 'notes_too_long');
    assert.equal(code(check('daily_logs_unusual_behavior_notes_length_check')), 'notes_too_long');
    assert.equal(code(check('daily_logs_tags_check')), 'invalid_tag');
    assert.equal(code(check('daily_logs_mood_level_check')), 'invalid_value');
  });

  it('desconocido', () => {
    assert.equal(code({ code: 'XX000', message: 'boom' }), 'unknown');
    assert.equal(code(null), 'unknown');
  });
});
