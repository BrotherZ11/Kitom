// Pruebas de `pet-view.ts` y `pet-form-gate.ts` (`npm test`): qué ve cada pantalla de mascotas según
// el servidor, la copia del dispositivo y la conexión.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveDailyLogPetContext } from '../../daily-logs/daily-log-pet-context.ts';
import { resolveUnsyncedList } from '../../daily-logs/offline/daily-log-view.ts';
import { resolveEditPetForm, resolveNewPetForm } from './pet-form-gate.ts';
import {
  formatSavedAt,
  petDetailAsQuery,
  resolvePetDetailView,
  resolvePetListView,
  resolvePetPhotoState,
} from './pet-view.ts';
import { makePet } from './pet-test-helpers.mjs';

const OFFLINE = { name: 'SessionUnavailableError', message: 'session_unavailable: request not sent' };
const FORBIDDEN = { code: '42501' };
const isOfflineError = (error) => error === OFFLINE;
const SAVED_AT = '2026-10-20T10:00:00.000Z';

const remote = {
  pending: { status: 'pending', data: undefined, error: null, dataUpdatedAt: 0 },
  ok: (data, dataUpdatedAt = Date.parse(SAVED_AT)) => ({ status: 'success', data, error: null, dataUpdatedAt }),
  failed: (error, data = undefined) => ({ status: 'error', data, error, dataUpdatedAt: data ? Date.parse(SAVED_AT) : 0 }),
};
const local = {
  pending: { status: 'pending', data: undefined, error: null },
  ok: (data) => ({ status: 'success', data, error: null }),
  failed: (error) => ({ status: 'error', data: undefined, error }),
};
const list = (input) => resolvePetListView({ serverUsable: true, isOfflineError, local: local.pending, ...input });
const detail = (input) => resolvePetDetailView({ serverUsable: true, isOfflineError, local: local.pending, ...input });

describe('lista', () => {
  const luna = makePet();
  const saved = { status: 'loaded', savedAt: SAVED_AT, pets: [luna] };

  it('con conexión: lo del servidor, al día; mientras carga la primera vez, cargando (no la copia)', () => {
    assert.deepEqual(list({ remote: remote.ok([luna]) }), {
      state: 'ready',
      pets: [luna],
      source: 'server',
      stale: false,
      savedAt: null,
    });
    assert.deepEqual(list({ remote: remote.pending, local: local.ok(saved) }), { state: 'loading' });
  });

  it('2. sin conexión con copia: la última lista guardada, marcada como posiblemente desactualizada', () => {
    const view = list({ remote: remote.failed(OFFLINE), local: local.ok(saved) });
    assert.deepEqual(view, { state: 'ready', pets: [luna], source: 'device', stale: true, savedAt: SAVED_AT });
    // Sesión `offline` (la query ni se ejecuta): igual.
    assert.equal(list({ remote: remote.pending, serverUsable: false, local: local.ok(saved) }).source, 'device');
  });

  it('3. vacía confirmada (lista vacía) ≠ nunca cargada («no disponible sin conexión»)', () => {
    const empty = list({ remote: remote.failed(OFFLINE), local: local.ok({ status: 'loaded', savedAt: SAVED_AT, pets: [] }) });
    assert.equal(empty.state, 'ready');
    assert.deepEqual(empty.pets, []);
    assert.deepEqual(list({ remote: remote.failed(OFFLINE), local: local.ok({ status: 'never_loaded' }) }), {
      state: 'offline_unavailable',
    });
  });

  it('5. copia ilegible: error del dispositivo (recuperable), nunca una lista vacía', () => {
    const error = new Error('local_read_failed');
    assert.deepEqual(list({ remote: remote.failed(OFFLINE), local: local.failed(error) }), { state: 'local_error', error });
  });

  it('datos del servidor en memoria y se pierde la conexión: siguen, con aviso y su hora', () => {
    const view = list({ remote: remote.failed(OFFLINE, [luna]) });
    assert.equal(view.source, 'server');
    assert.equal(view.stale, true);
    assert.equal(view.savedAt, SAVED_AT);
    assert.equal(list({ remote: remote.ok([luna]), serverUsable: false }).stale, true);
  });

  it('otro error del servidor sigue siendo un error (la copia no lo tapa)', () => {
    assert.deepEqual(list({ remote: remote.failed(FORBIDDEN), local: local.ok(saved) }), { state: 'error', error: FORBIDDEN });
  });
});

describe('6. ficha', () => {
  const luna = makePet();
  const snapshot = { pet: luna, savedAt: SAVED_AT, unavailableAt: null };

  it('sin conexión con copia: la copia, con aviso', () => {
    assert.deepEqual(detail({ remote: remote.failed(OFFLINE), local: local.ok(snapshot) }), {
      state: 'ready',
      pet: luna,
      source: 'device',
      stale: true,
      savedAt: SAVED_AT,
    });
  });

  it('sin conexión y nunca guardada: «no disponible sin conexión», nunca «no existe»', () => {
    assert.deepEqual(detail({ remote: remote.failed(OFFLINE), local: local.ok(null) }), { state: 'offline_unavailable' });
    assert.deepEqual(detail({ remote: remote.pending, serverUsable: false, local: local.ok(null) }), {
      state: 'offline_unavailable',
    });
  });

  it('«no existe» solo cuando lo dice el servidor', () => {
    assert.deepEqual(detail({ remote: remote.ok(null) }), { state: 'not_found' });
  });

  it('11. sin conexión, la copia de una mascota que el servidor ya no devolvía: «no disponible» (copia conservada)', () => {
    const gone = { ...snapshot, unavailableAt: SAVED_AT };
    assert.deepEqual(detail({ remote: remote.failed(OFFLINE), local: local.ok(gone) }), { state: 'unavailable', snapshot: gone });
  });

  it('con la forma de una query para el registro diario: nombre de la copia; sin copia, «sin conexión»', () => {
    const offlineError = { message: 'Network request failed' };
    const fromCopy = petDetailAsQuery(detail({ remote: remote.failed(OFFLINE), local: local.ok(snapshot) }), offlineError);
    const canEditOffline = { data: undefined, isError: true, error: offlineError };
    const isNetwork = (error) => error === offlineError;
    assert.equal(resolveDailyLogPetContext(fromCopy, canEditOffline, isNetwork).name, 'Luna');

    const noCopy = petDetailAsQuery(detail({ remote: remote.failed(OFFLINE), local: local.ok(null) }), offlineError);
    assert.deepEqual(resolveDailyLogPetContext(noCopy, canEditOffline, isNetwork), {
      state: 'ready',
      name: null,
      canEdit: true,
      permissionUnknown: true,
    });
    const unreadable = petDetailAsQuery(detail({ remote: remote.failed(OFFLINE), local: local.failed(new Error('x')) }), offlineError);
    assert.equal(resolveDailyLogPetContext(unreadable, canEditOffline, isNetwork).state, 'ready');
  });
});

describe('13. foto', () => {
  const path = 'b0000000-0000-4000-8000-000000000001/0b8c2d55-9a11-4f0e-8a51-0d1f3a7c9e10.jpg';
  const photo = (url, imageFailed = false) => resolvePetPhotoState({ photoPath: path, url, imageFailed, isOfflineError });

  it('sin conexión o con la imagen caducada: «no disponible»; el path es la clave de caché', () => {
    assert.deepEqual(photo({ status: 'success', data: 'https://signed', error: null }), {
      state: 'ready',
      url: 'https://signed',
      cacheKey: path,
    });
    assert.deepEqual(photo({ status: 'error', data: undefined, error: OFFLINE }), { state: 'unavailable' });
    assert.deepEqual(photo({ status: 'success', data: 'https://caducada', error: null }, true), { state: 'unavailable' });
    assert.equal(photo({ status: 'error', data: undefined, error: FORBIDDEN }).state, 'error');
    assert.equal(photo({ status: 'pending', data: undefined, error: null }).state, 'loading');
    assert.equal(resolvePetPhotoState({ photoPath: null, url: { status: 'pending' }, imageFailed: false, isOfflineError }).state, 'none');
  });
});

describe('12. formularios de alta y edición: escrituras que necesitan conexión', () => {
  const species = { ok: { status: 'success', error: null }, pending: { status: 'pending', error: null } };

  it('alta: sin conexión, «necesitas conexión»; si el formulario se puede mostrar, con envío bloqueado', () => {
    assert.deepEqual(resolveNewPetForm({ species: species.pending, writable: false, isOfflineError }), { state: 'offline' });
    assert.deepEqual(resolveNewPetForm({ species: { status: 'error', error: OFFLINE }, writable: true, isOfflineError }), {
      state: 'offline',
    });
    assert.deepEqual(resolveNewPetForm({ species: species.ok, writable: false, isOfflineError }), { state: 'form', offline: true });
    assert.deepEqual(resolveNewPetForm({ species: species.ok, writable: true, isOfflineError }), { state: 'form', offline: false });
  });

  it('edición: nunca sobre la copia del dispositivo; sin conexión con datos del servidor, envío bloqueado', () => {
    const luna = makePet();
    const fromDevice = { state: 'ready', pet: luna, source: 'device', stale: true, savedAt: SAVED_AT };
    const fromServer = { state: 'ready', pet: luna, source: 'server', stale: false, savedAt: null };
    const gate = (pet, writable, speciesQuery = species.ok) =>
      resolveEditPetForm({ pet, species: speciesQuery, writable, isOfflineError });

    assert.deepEqual(gate(fromDevice, false), { state: 'offline' });
    assert.deepEqual(gate({ state: 'offline_unavailable' }, false), { state: 'offline' });
    assert.deepEqual(gate({ state: 'loading' }, false), { state: 'offline' });
    assert.deepEqual(gate(fromServer, false), { state: 'form', offline: true });
    assert.deepEqual(gate(fromServer, true), { state: 'form', offline: false });
    assert.deepEqual(gate({ state: 'not_found' }, true), { state: 'not_found' });
    assert.deepEqual(gate(fromServer, true, { status: 'error', error: FORBIDDEN }), {
      state: 'error',
      error: FORBIDDEN,
      source: 'species',
    });
  });
});

it('15. «Registros sin sincronizar»: con la lista de la copia del dispositivo sigue igual (y pone nombres)', () => {
  const luna = makePet({ name: 'Luna' });
  const gone = 'c0000000-0000-4000-8000-000000000009';
  const record = (petId, logDate) => ({ petId, logDate, status: 'pending' });
  const view = list({
    remote: remote.failed(OFFLINE),
    local: local.ok({ status: 'loaded', savedAt: SAVED_AT, pets: [luna] }),
  });
  const unsynced = resolveUnsyncedList({
    local: { status: 'ready', data: [record(luna.id, '2026-10-19'), record(gone, '2026-10-18')] },
    pets: view.state === 'ready' ? view.pets : undefined,
    syncingKey: null,
  });
  assert.deepEqual(
    unsynced.items.map((item) => [item.record.petId, item.petName]),
    [
      [luna.id, 'Luna'],
      [gone, null],
    ]
  );
  // Sin lista (nunca cargada): la de pendientes no depende de ella.
  assert.equal(resolveUnsyncedList({ local: { status: 'ready', data: [record(gone, '2026-10-18')] }, pets: undefined, syncingKey: null }).items.length, 1);
});

it('formatSavedAt: fecha y hora en el idioma; nada si no hay fecha válida', () => {
  assert.match(formatSavedAt(SAVED_AT, 'es'), /20/);
  assert.equal(formatSavedAt(null, 'es'), null);
  assert.equal(formatSavedAt('no', 'es'), null);
});
