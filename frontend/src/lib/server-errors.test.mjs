import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyServerError, isNetworkError } from './server-errors.ts';

describe('server-errors', () => {
  it('reconoce fallos de red y peticiones retenidas sin sesión', () => {
    assert.equal(isNetworkError(new TypeError('Network request failed')), true);
    assert.equal(isNetworkError({ message: 'TypeError: fetch failed' }), true);
    assert.equal(isNetworkError({ name: 'SessionUnavailableError', message: 'x' }), true);
    assert.equal(isNetworkError({ message: 'session_unavailable: request not sent' }), true);
    assert.equal(isNetworkError({ code: '42501', message: 'permission denied' }), false);
    assert.equal(isNetworkError(null), false);
  });

  it('clasifica los códigos de PostgREST y Postgres', () => {
    assert.equal(classifyServerError({ code: '42501' }), 'not_allowed');
    assert.equal(classifyServerError({ code: 'PGRST116' }), 'not_found');
    assert.equal(classifyServerError({ code: '23514' }), 'invalid');
    assert.equal(classifyServerError({ code: 'P0001' }), 'invalid');
    assert.equal(classifyServerError(new TypeError('Failed to fetch')), 'network');
    assert.equal(classifyServerError({ code: 'XX000' }), 'unknown');
  });
});
