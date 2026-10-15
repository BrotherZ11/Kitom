// Pruebas de la vista combinada servidor + dispositivo (`daily-log-view.ts`) y de la coherencia con
// la caché de TanStack (`daily-log-cache.ts`, con el QueryClient real de `@tanstack/query-core`).
// `npm test`; ver frontend/CLAUDE.md.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { QueryClient } from '@tanstack/query-core';

import { DailyLogError } from '../daily-log-errors.ts';
import { dailyLogKeys } from '../query-keys.ts';
import { applyLocalChangeToCache } from './daily-log-cache.ts';
import {
  describeConflict,
  resolveDailyLogDetail,
  resolveDailyLogHistory,
  toDisplayRow,
  toRemoteState,
} from './daily-log-view.ts';
import {
  applyLocalEdit,
  applySyncFailure,
  createSyncedLocalDailyLog,
  setConflictRemote,
  toSentOperation,
} from './local-daily-log.ts';
import { classifySyncError } from './sync-errors.ts';

const USER = 'a0000000-0000-4000-8000-000000000001';
const PET = 'b0000000-0000-4000-8000-000000000001';
const TODAY = '2026-10-15';

const content = (overrides = {}) => ({
  energy_level: 3,
  appetite_level: null,
  mood_level: null,
  activity_level: null,
  sleep_quality: null,
  vocalization_level: null,
  social_interaction_level: null,
  unusual_behavior: false,
  unusual_behavior_notes: null,
  notes: null,
  tags: [],
  ...overrides,
});

const row = (date, overrides = {}) => ({
  id: `id-${date}`,
  pet_id: PET,
  logged_by: USER,
  last_edited_by: null,
  log_date: date,
  ...content(),
  created_at: '2026-10-01T08:00:00.1+00:00',
  updated_at: `${date}T09:00:00.123456+00:00`,
  ...overrides,
});

const pending = (date, overrides = {}, baseRow = null) =>
  applyLocalEdit(
    null,
    { userId: USER, petId: PET, logDate: date, content: content(overrides), baseRow },
    { now: 1, createOperationId: randomUUID }
  );
const snapshot = (date, overrides = {}) =>
  createSyncedLocalDailyLog({ userId: USER, petId: PET, logDate: date }, row(date, overrides));

const networkError = new DailyLogError('network', new TypeError('Network request failed'));
const ready = (data) => ({ status: 'ready', data });

describe('toRemoteState', () => {
  const query = (overrides) => ({ data: undefined, error: null, status: 'pending', fetchStatus: 'fetching', ...overrides });

  it('con datos (aunque el refresco falle) es éxito; null también es un dato', () => {
    assert.deepEqual(toRemoteState(query({ data: null, status: 'success', fetchStatus: 'idle' })), { status: 'success', data: null });
    assert.equal(toRemoteState(query({ data: row(TODAY), status: 'error', error: networkError })).status, 'success');
  });

  it('error de red o consulta en pausa (web sin conexión) = servidor no disponible', () => {
    assert.equal(toRemoteState(query({ status: 'error', error: networkError })).status, 'unavailable');
    assert.equal(toRemoteState(query({ fetchStatus: 'paused' })).status, 'unavailable');
  });

  it('otro error es un error; sin datos ni error, cargando', () => {
    assert.equal(toRemoteState(query({ status: 'error', error: new DailyLogError('not_allowed') })).status, 'error');
    assert.equal(toRemoteState(query({})).status, 'loading');
  });
});

describe('resolveDailyLogDetail', () => {
  const resolve = (remote, record, extra = {}) =>
    resolveDailyLogDetail({ remote, local: ready(record), syncing: false, allowOfflineCreate: false, ...extra });

  it('lo pendiente prevalece sobre el servidor, también con conexión', () => {
    const server = row(TODAY, { notes: 'servidor' });
    const local = pending(TODAY, { notes: 'local' }, server);
    const view = resolve({ status: 'success', data: row(TODAY, { notes: 'más nuevo' }) }, local);
    assert.equal(view.content.notes, 'local');
    assert.equal(view.source, 'local');
    assert.equal(view.syncStatus, 'pending');
    assert.equal(view.baseRow, local.serverRow);
  });

  it('sin pendientes manda el servidor (la copia local es solo el último dato conocido)', () => {
    const view = resolve({ status: 'success', data: row(TODAY, { notes: 'nuevo' }) }, snapshot(TODAY, { notes: 'viejo' }));
    assert.equal(view.content.notes, 'nuevo');
    assert.equal(view.source, 'remote');
    assert.equal(view.syncStatus, 'synced');
    assert.equal(view.offline, false);
  });

  it('sin conexión muestra el último dato local conocido', () => {
    const view = resolve({ status: 'unavailable', error: networkError }, snapshot(TODAY, { notes: 'guardado' }));
    assert.equal(view.state, 'ready');
    assert.equal(view.content.notes, 'guardado');
    assert.equal(view.offline, true);
    assert.equal(view.source, 'local');
  });

  it('sin conexión y sin nada local: hoy se puede empezar; un día anterior da error de red', () => {
    const offline = { status: 'unavailable', error: networkError };
    const today = resolve(offline, null, { allowOfflineCreate: true });
    assert.equal(today.state, 'ready');
    assert.equal(today.content, null);
    assert.equal(today.baseRow, null);
    assert.equal(resolve(offline, null).state, 'error');
  });

  it('mientras carga el servidor (sin esperar) se ve la copia local, marcada como no comprobada', () => {
    const view = resolve({ status: 'loading' }, snapshot(TODAY));
    assert.equal(view.state, 'ready');
    assert.equal(view.checking, true);
    assert.equal(view.offline, false);
    assert.equal(resolve({ status: 'loading' }, null).state, 'loading');
  });

  it('errores que no son de red se muestran; sin registro, contenido null', () => {
    assert.equal(resolve({ status: 'error', error: new DailyLogError('unknown') }, null).state, 'error');
    const empty = resolve({ status: 'success', data: null }, null);
    assert.equal(empty.content, null);
    assert.equal(empty.syncStatus, null);
  });

  it('estado visible: sincronizando, conflicto y fallido', () => {
    const local = pending(TODAY);
    assert.equal(resolveDailyLogDetail({ remote: { status: 'loading' }, local: ready(local), syncing: true, allowOfflineCreate: false }).syncStatus, 'syncing');
    const failed = applySyncFailure(local, toSentOperation(local), classifySyncError({ code: '42501' }, 403), { now: 1 });
    assert.equal(resolve({ status: 'loading' }, failed).syncStatus, 'failed');
    const conflict = applySyncFailure(local, toSentOperation(local), classifySyncError({ code: 'P0001', hint: 'daily_log_conflict', details: 'row_exists' }, 400), { now: 1 });
    assert.equal(resolve({ status: 'loading' }, conflict).syncStatus, 'conflict');
  });
});

describe('resolveDailyLogDetail: esperar al servidor antes de abrir el formulario', () => {
  const copy = snapshot(TODAY, { notes: 'copia antigua' });
  const resolve = (remote, record, extra = {}) =>
    resolveDailyLogDetail({ remote, local: ready(record), syncing: false, allowOfflineCreate: false, ...extra });

  it('servidor rápido: se abre con la versión del servidor', () => {
    const view = resolve({ status: 'success', data: row(TODAY, { notes: 'actual' }) }, copy, { waitForRemote: true });
    assert.equal(view.source, 'remote');
    assert.equal(view.content.notes, 'actual');
  });

  it('servidor lento, con conexión y dentro del tope: espera (cargando), no abre la copia antigua', () => {
    assert.equal(resolve({ status: 'loading' }, copy, { waitForRemote: true }).state, 'loading');
    assert.equal(resolve({ status: 'loading' }, null, { waitForRemote: true, allowOfflineCreate: true }).state, 'loading');
  });

  it('tope agotado: se abre con la copia del dispositivo indicando que el servidor no se ha comprobado', () => {
    const view = resolve({ status: 'loading' }, copy, { waitForRemote: false });
    assert.equal(view.state, 'ready');
    assert.equal(view.source, 'local');
    assert.equal(view.content.notes, 'copia antigua');
    assert.equal(view.checking, true);
    // Hoy sin nada guardado: se puede empezar (se creará con p_expect_absent).
    const today = resolve({ status: 'loading' }, null, { waitForRemote: false, allowOfflineCreate: true });
    assert.equal(today.state, 'ready');
    assert.equal(today.content, null);
    assert.equal(today.checking, true);
  });

  it('sin conexión no se espera: la copia local al momento, marcada como sin conexión', () => {
    // Quien llama no pide esperar sin conexión; y si la query ya falló por red, tampoco se espera.
    const view = resolve({ status: 'unavailable', error: networkError }, copy, { waitForRemote: true });
    assert.equal(view.state, 'ready');
    assert.equal(view.offline, true);
    assert.equal(view.checking, false);
  });

  it('con cambios pendientes no se espera nunca: lo pendiente prevalece', () => {
    const local = pending(TODAY, { notes: 'mío' });
    const view = resolve({ status: 'loading' }, local, { waitForRemote: true });
    assert.equal(view.state, 'ready');
    assert.equal(view.content.notes, 'mío');
  });
});

describe('resolveDailyLogHistory', () => {
  const page = (dates, nextCursor = null) => ({ logs: dates.map((date) => row(date)), nextCursor });
  const resolve = (remote, records, syncingKey = null) =>
    resolveDailyLogHistory({ remote, local: ready(records), syncingKey });

  it('historial remoto combinado con cambios pendientes: sustituye el día y no duplica', () => {
    const view = resolve(
      { status: 'success', data: { pages: [page(['2026-10-15', '2026-10-14'])], hasNextPage: false } },
      [pending('2026-10-14', { notes: 'editado sin red' }, row('2026-10-14')), snapshot('2026-10-15')]
    );
    assert.deepEqual(view.items.map((item) => item.log.log_date), ['2026-10-15', '2026-10-14']);
    assert.equal(view.items[1].log.notes, 'editado sin red');
    assert.equal(view.items[1].syncStatus, 'pending');
    assert.equal(view.items[0].syncStatus, 'synced');
  });

  it('un registro creado sin conexión aparece en su sitio si cae en lo cargado', () => {
    const view = resolve(
      { status: 'success', data: { pages: [page(['2026-10-15', '2026-10-12'], '2026-10-12')], hasNextPage: true } },
      [pending('2026-10-13'), pending('2026-10-01')]
    );
    // El 1 de octubre es más antiguo que lo cargado: aparecerá al cargar su página.
    assert.deepEqual(view.items.map((item) => item.log.log_date), ['2026-10-15', '2026-10-13', '2026-10-12']);
  });

  it('sin más páginas, todos los pendientes aparecen, ordenados', () => {
    const view = resolve(
      { status: 'success', data: { pages: [page(['2026-10-15'])], hasNextPage: false } },
      [pending('2026-09-01')]
    );
    assert.deepEqual(view.items.map((item) => item.log.log_date), ['2026-10-15', '2026-09-01']);
  });

  it('paginación sin duplicados aunque el mismo día venga en dos páginas', () => {
    const view = resolve(
      { status: 'success', data: { pages: [page(['2026-10-15', '2026-10-14']), page(['2026-10-14', '2026-10-13'])], hasNextPage: false } },
      []
    );
    assert.deepEqual(view.items.map((item) => item.log.log_date), ['2026-10-15', '2026-10-14', '2026-10-13']);
  });

  it('sin conexión: se muestra lo guardado en el dispositivo', () => {
    const view = resolve({ status: 'unavailable', error: networkError }, [snapshot('2026-10-10'), pending('2026-10-15')]);
    assert.equal(view.state, 'ready');
    assert.equal(view.offline, true);
    assert.deepEqual(view.items.map((item) => item.log.log_date), ['2026-10-15', '2026-10-10']);
  });

  it('un error de red sin nada local es un error, nunca una lista vacía', () => {
    const view = resolve({ status: 'unavailable', error: networkError }, []);
    assert.equal(view.state, 'error');
  });

  it('el registro que se está enviando se marca como sincronizando', () => {
    const view = resolve(
      { status: 'success', data: { pages: [page([])], hasNextPage: false } },
      [pending(TODAY)],
      `${PET}/${TODAY}`
    );
    assert.equal(view.items[0].syncStatus, 'syncing');
  });
});

describe('toDisplayRow y describeConflict', () => {
  it('un registro solo local se muestra con su contenido y un id local', () => {
    const display = toDisplayRow(pending(TODAY, { notes: 'nuevo' }));
    assert.equal(display.id, `local:${PET}:${TODAY}`);
    assert.equal(display.notes, 'nuevo');
    assert.equal(display.log_date, TODAY);
  });

  it('el conflicto describe qué datos difieren, sin contenido', () => {
    const local = pending(TODAY, { energy_level: 5, notes: 'mía', tags: ['vet_visit'] }, row(TODAY));
    const inConflict = applySyncFailure(local, toSentOperation(local), classifySyncError({ code: 'P0001', hint: 'daily_log_conflict', details: 'version_mismatch' }, 400), { now: 1 });
    assert.deepEqual(describeConflict(inConflict), { remote: 'not_fetched', fields: [] });
    const withRemote = setConflictRemote(inConflict, row(TODAY, { energy_level: 1, updated_at: '2026-10-15T10:00:00.5+00:00' }));
    assert.deepEqual(describeConflict(withRemote), { remote: 'present', fields: ['energy_level', 'notes', 'tags'] });
    assert.deepEqual(describeConflict(setConflictRemote(inConflict, null)), { remote: 'absent', fields: [] });
    assert.equal(describeConflict(local), null);
  });
});

describe('applyLocalChangeToCache: queries de hoy e historial coherentes', () => {
  function cache() {
    const client = new QueryClient();
    client.setQueryData(dailyLogKeys.detail(PET, TODAY), null);
    client.setQueryData(dailyLogKeys.history(PET), {
      pages: [{ logs: [row('2026-10-14', { notes: 'antes' })], nextCursor: null }],
      pageParams: [null],
    });
    return client;
  }
  const invalidated = (client, key) => client.getQueryState(key)?.isInvalidated === true;

  it('cambio local pendiente: solo se actualiza lo local; el servidor no se toca', () => {
    const client = cache();
    const record = pending(TODAY, { notes: 'sin enviar' });
    applyLocalChangeToCache(client, USER, { petId: PET, logDate: TODAY, record });
    assert.deepEqual(client.getQueryData(dailyLogKeys.local(USER, PET, TODAY)), record);
    assert.equal(client.getQueryData(dailyLogKeys.detail(PET, TODAY)), null);
    assert.equal(invalidated(client, dailyLogKeys.history(PET)), false);
  });

  it('confirmado por el servidor: la fila pasa al registro del día y al historial', () => {
    const client = cache();
    const confirmed = createSyncedLocalDailyLog(
      { userId: USER, petId: PET, logDate: '2026-10-14' },
      row('2026-10-14', { notes: 'después', updated_at: '2026-10-15T11:00:00.75+00:00' })
    );
    applyLocalChangeToCache(client, USER, { petId: PET, logDate: '2026-10-14', record: confirmed });
    assert.equal(client.getQueryData(dailyLogKeys.detail(PET, '2026-10-14')).notes, 'después');
    assert.equal(client.getQueryData(dailyLogKeys.history(PET)).pages[0].logs[0].notes, 'después');
    assert.equal(invalidated(client, dailyLogKeys.history(PET)), false);
  });

  it('un día nuevo confirmado que no estaba en el historial lo revalida para que aparezca', () => {
    const client = cache();
    const confirmed = createSyncedLocalDailyLog({ userId: USER, petId: PET, logDate: TODAY }, row(TODAY));
    applyLocalChangeToCache(client, USER, { petId: PET, logDate: TODAY, record: confirmed });
    assert.equal(client.getQueryData(dailyLogKeys.detail(PET, TODAY)).id, `id-${TODAY}`);
    assert.equal(invalidated(client, dailyLogKeys.history(PET)), true);
  });

  it('la lista local de la mascota se revalida con cada cambio', () => {
    const client = cache();
    client.setQueryData(dailyLogKeys.localList(USER, PET), []);
    applyLocalChangeToCache(client, USER, { petId: PET, logDate: TODAY, record: pending(TODAY) });
    assert.equal(invalidated(client, dailyLogKeys.localList(USER, PET)), true);
  });
});
