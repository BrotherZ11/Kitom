// Pruebas de `local-daily-log.ts` (modelo local, validación y transiciones) con el runner de Node
// (`npm test`). Ver frontend/CLAUDE.md.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createLocalStore } from '../../../lib/local-store/local-store.ts';
import { createMemoryStorage } from '../../../lib/local-store/memory-storage.ts';
import { mergeDailyLogContent } from './daily-log-merge.ts';
import { contentFromRow } from './daily-log-content.ts';
import {
  LocalDailyLogStateError,
  applyLocalEdit,
  applySyncFailure,
  applySyncSuccess,
  isSyncDue,
  localDailyLogId,
  localDailyLogs,
  parseLocalDailyLog,
  resolveConflict,
  retryFailedSync,
  setConflictRemote,
  toSentOperation,
  toSyncPrecondition,
} from './local-daily-log.ts';
import { MAX_SYNC_ATTEMPTS, SYNC_BACKOFF_MAX_MS } from './sync-backoff.ts';
import { classifySyncError } from './sync-errors.ts';

const USER = 'a0000000-0000-4000-8000-000000000001';
const OTHER_USER = 'a0000000-0000-4000-8000-000000000002';
const PET = 'b0000000-0000-4000-8000-000000000001';
const OTHER_PET = 'b0000000-0000-4000-8000-000000000002';
const DATE = '2026-10-13';
const NOW = Date.UTC(2026, 9, 13, 10, 0, 0);
// PostgREST: microsegundos y sin ceros finales (aquí, cinco decimales).
const VERSION = '2026-10-13T09:14:26.89152+00:00';
const NEXT_VERSION = '2026-10-13T10:00:01.000457+00:00';
const OP_1 = '00000000-0000-4000-8000-000000000001';

function content(overrides = {}) {
  return {
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
  };
}

function row(overrides = {}) {
  return {
    id: 'c0000000-0000-4000-8000-000000000001',
    pet_id: PET,
    logged_by: USER,
    last_edited_by: null,
    log_date: DATE,
    ...content(),
    created_at: '2026-10-13T08:00:00.123456+00:00',
    updated_at: VERSION,
    ...overrides,
  };
}

function ids() {
  let count = 0;
  return () => `00000000-0000-4000-8000-${String((count += 1)).padStart(12, '0')}`;
}

const env = (now = NOW, createOperationId = ids()) => ({ now, createOperationId });
const edit = (overrides = {}) => ({ userId: USER, petId: PET, logDate: DATE, content: content(), baseRow: null, ...overrides });
const failure = (error, status) => classifySyncError(error, status);
const NETWORK = failure(new TypeError('Network request failed'));
const SERVER = failure({ message: 'Bad Gateway' }, 502);
const conflictError = (details) => failure({ code: 'P0001', hint: 'daily_log_conflict', details }, 400);

/** Registro pendiente sobre una fila del servidor, con una edición local. */
function pendingLog(localContent = content({ energy_level: 5 }), baseRow = row()) {
  return applyLocalEdit(null, edit({ content: localContent, baseRow }), env());
}

describe('applyLocalEdit: crear la operación pendiente', () => {
  it('registro nuevo (sin fila en el servidor): se esperará que no exista', () => {
    const log = applyLocalEdit(null, edit({ content: content({ notes: '  primera nota ' }) }), env());
    assert.deepEqual(log, {
      userId: USER,
      petId: PET,
      logDate: DATE,
      serverRow: null,
      baseVersion: null,
      status: 'pending',
      pending: {
        operationId: OP_1,
        revision: 1,
        content: content({ notes: 'primera nota' }),
        attempts: 0,
        countedAttempts: 0,
        nextAttemptAt: null,
        editedAt: NOW,
      },
      error: null,
      conflict: null,
    });
    assert.deepEqual(toSyncPrecondition(log), { p_expect_absent: true });
    assert.equal(isSyncDue(log, NOW), true);
  });

  it('edición de una fila existente: la base es la fila que cargó el formulario', () => {
    const log = pendingLog();
    assert.deepEqual(log.serverRow, row());
    assert.equal(log.baseVersion, VERSION);
    assert.deepEqual(toSyncPrecondition(log), { p_expected_updated_at: VERSION });
  });

  it('sin cambios respecto a la fila del servidor no se crea ninguna operación', () => {
    const createOperationId = () => assert.fail('no debe crear operación');
    const log = applyLocalEdit(null, edit({ content: content({ notes: ' ' }), baseRow: row() }), env(NOW, createOperationId));
    assert.equal(log.status, 'synced');
    assert.equal(log.pending, null);
  });

  it('rechaza datos que no se podrían guardar', () => {
    const invalid = (overrides) =>
      assert.throws(
        () => applyLocalEdit(null, edit(overrides), env()),
        (error) => error instanceof LocalDailyLogStateError && error.code === 'invalid_record'
      );
    invalid({ logDate: '2026-02-30' });
    invalid({ logDate: '13/10/2026' });
    invalid({ userId: 'no-es-uuid' });
    invalid({ content: content({ energy_level: 6 }) });
    invalid({ baseRow: row({ pet_id: OTHER_PET }) });
    invalid({ baseRow: row({ log_date: '2026-10-12' }) });
  });
});

describe('applyLocalEdit: edición repetida del mismo registro', () => {
  it('actualiza la misma operación: no se duplica ni cambia de id', () => {
    const env1 = env();
    let log = applyLocalEdit(null, edit({ content: content({ energy_level: 4 }), baseRow: row() }), env1);
    log = applyLocalEdit(log, edit({ content: content({ energy_level: 5 }), baseRow: row() }), { ...env1, now: NOW + 1_000 });
    log = applyLocalEdit(log, edit({ content: content({ energy_level: 5, notes: 'mejor' }) }), { ...env1, now: NOW + 2_000 });

    assert.equal(log.pending.operationId, OP_1);
    assert.equal(log.pending.revision, 3);
    assert.equal(log.pending.editedAt, NOW + 2_000);
    assert.deepEqual(log.pending.content, content({ energy_level: 5, notes: 'mejor' }));
    assert.equal(log.status, 'pending');
  });

  it('la base no cambia con las ediciones siguientes, aunque llegue otra fila', () => {
    const first = pendingLog();
    const second = applyLocalEdit(
      first,
      edit({ content: content({ energy_level: 1 }), baseRow: row({ updated_at: NEXT_VERSION, energy_level: 2 }) }),
      env()
    );
    assert.equal(second.baseVersion, VERSION);
    assert.deepEqual(second.serverRow, first.serverRow);
  });

  it('en el almacén local sigue habiendo una sola clave por registro', async () => {
    const disk = new Map();
    const store = createLocalStore(createMemoryStorage(disk), USER);
    const id = localDailyLogId(PET, DATE);
    const envOnce = env();
    let log = null;
    for (const energy of [1, 2, 4, 5]) {
      const read = await store.read(localDailyLogs, id);
      log = applyLocalEdit(read.status === 'found' ? read.value : null, edit({ content: content({ energy_level: energy }), baseRow: row() }), envOnce);
      await store.write(localDailyLogs, id, log);
    }
    assert.deepEqual([...disk.keys()], [`kitom:v1:${USER}:daily-logs:${PET}:${DATE}`]);
    assert.deepEqual(await store.list(localDailyLogs, [PET]), [[PET, DATE]]);
    const stored = (await store.read(localDailyLogs, id)).value;
    assert.equal(stored.pending.operationId, OP_1);
    assert.equal(stored.pending.revision, 4);
    assert.equal(stored.pending.content.energy_level, 5);
  });

  it('editar reinicia los reintentos; un fallo permanente vuelve a quedar pendiente', () => {
    let log = pendingLog();
    log = applySyncFailure(log, toSentOperation(log), NETWORK, { now: NOW, backoff: { random: () => 0 } });
    assert.equal(log.pending.attempts, 1);
    log = applyLocalEdit(log, edit({ content: content({ energy_level: 2 }) }), env(NOW + 10));
    assert.equal(log.pending.attempts, 0);
    assert.equal(log.pending.nextAttemptAt, null);
    assert.equal(log.error, null);

    log = applySyncFailure(log, toSentOperation(log), failure({ code: '23514' }, 400), { now: NOW });
    assert.equal(log.status, 'failed');
    log = applyLocalEdit(log, edit({ content: content({ energy_level: 4 }) }), env(NOW + 20));
    assert.equal(log.status, 'pending');
  });

  it('la fecha y la identidad no cambian nunca', () => {
    const log = pendingLog();
    const mismatch = (overrides) =>
      assert.throws(
        () => applyLocalEdit(log, edit(overrides), env()),
        (error) => error instanceof LocalDailyLogStateError && error.code === 'identity_mismatch'
      );
    mismatch({ logDate: '2026-10-14' });
    mismatch({ petId: OTHER_PET });
    mismatch({ userId: OTHER_USER });

    // Ninguna transición toca `logDate`, pase el tiempo que pase.
    const muchLater = NOW + 9 * 24 * 60 * 60_000;
    let next = applySyncFailure(log, toSentOperation(log), NETWORK, { now: muchLater });
    next = applyLocalEdit(next, edit({ content: content({ energy_level: 1 }) }), env(muchLater));
    next = applySyncSuccess(next, toSentOperation(next), row({ energy_level: 1, updated_at: NEXT_VERSION }));
    assert.equal(next.logDate, DATE);
    assert.equal(next.serverRow.log_date, DATE);
  });
});

describe('conservación exacta de updated_at', () => {
  it('la versión base es la cadena del servidor, también tras guardar y volver a leer', async () => {
    const store = createLocalStore(createMemoryStorage(), USER);
    const id = localDailyLogId(PET, DATE);
    for (const version of [VERSION, '2026-10-10T16:14:12.851355+00:00', '2026-10-10T16:14:12+00:00']) {
      await store.write(localDailyLogs, id, pendingLog(content({ energy_level: 5 }), row({ updated_at: version })));
      const { value } = await store.read(localDailyLogs, id);
      assert.equal(value.baseVersion, version);
      assert.equal(value.serverRow.updated_at, version);
      assert.deepEqual(toSyncPrecondition(value), { p_expected_updated_at: version });
      // Pasada por Date se perderían los microsegundos y nunca coincidiría.
      assert.notEqual(new Date(VERSION).toISOString(), VERSION);
    }
  });

  it('tras un guardado, la base pasa a ser el updated_at devuelto, tal cual', () => {
    const log = pendingLog();
    const saved = applySyncSuccess(log, toSentOperation(log), row({ energy_level: 5, updated_at: NEXT_VERSION }));
    assert.equal(saved.baseVersion, NEXT_VERSION);
    assert.equal(saved.status, 'synced');
    assert.equal(saved.pending, null);
  });

  it('un registro cuya versión base no es la de su fila no es válido', () => {
    const log = pendingLog();
    assert.equal(parseLocalDailyLog({ ...log, baseVersion: '2026-10-13T09:14:26.891+00:00' }), null);
    assert.equal(parseLocalDailyLog({ ...log, baseVersion: null }), null);
  });
});

describe('parseLocalDailyLog', () => {
  const valid = pendingLog();

  it('acepta un registro válido tras pasar por JSON', () => {
    assert.deepEqual(parseLocalDailyLog(JSON.parse(JSON.stringify(valid))), valid);
  });

  it('rechaza formas incorrectas', () => {
    const bad = (overrides) => assert.equal(parseLocalDailyLog({ ...valid, ...overrides }), null, JSON.stringify(overrides));
    assert.equal(parseLocalDailyLog(null), null);
    assert.equal(parseLocalDailyLog('texto'), null);
    assert.equal(parseLocalDailyLog([]), null);
    bad({ userId: 'A0000000-0000-4000-8000-000000000001' });
    bad({ petId: 42 });
    bad({ logDate: '2026-13-01' });
    bad({ logDate: '2026-10-13T00:00:00Z' });
    bad({ status: 'syncing' });
    bad({ serverRow: { ...row(), updated_at: 5 } });
    bad({ serverRow: { ...row(), energy_level: 9 } });
    bad({ pending: { ...valid.pending, operationId: '' } });
    bad({ pending: { ...valid.pending, revision: 0 } });
    bad({ pending: { ...valid.pending, attempts: -1 } });
    bad({ pending: { ...valid.pending, nextAttemptAt: 'mañana' } });
    bad({ pending: { ...valid.pending, content: { ...valid.pending.content, tags: 'vet_visit' } } });
    bad({ error: { kind: 'raro', reason: 'x', at: NOW } });
    bad({ error: { kind: 'network', reason: 'x'.repeat(500), at: NOW } });
  });

  it('rechaza estados incoherentes', () => {
    const bad = (overrides) => assert.equal(parseLocalDailyLog({ ...valid, ...overrides }), null, JSON.stringify(overrides));
    bad({ status: 'synced' }); // sincronizado con operación pendiente
    bad({ pending: null }); // pendiente sin operación
    bad({ status: 'failed' }); // fallido sin error
    bad({ status: 'conflict' }); // conflicto sin datos
    bad({ conflict: { detail: 'row_exists', remote: { status: 'not_fetched' }, detectedAt: NOW } }); // datos de conflicto sin estarlo
    bad({ status: 'synced', pending: null, serverRow: null, baseVersion: null }); // sincronizado sin fila
    bad({ serverRow: row({ pet_id: OTHER_PET }) }); // fila de otra mascota
  });

  it('el almacén local trata un registro no válido como corrupto, no como dato', async () => {
    const key = `kitom:v1:${USER}:daily-logs:${PET}:${DATE}`;
    const read = (data, v = 1) =>
      createLocalStore(createMemoryStorage(new Map([[key, JSON.stringify({ v, data })]])), USER).read(
        localDailyLogs,
        localDailyLogId(PET, DATE)
      );
    assert.equal((await read(valid)).status, 'found');
    assert.deepEqual(await read({ ...valid, status: 'synced' }), { status: 'corrupt', reason: 'invalid_data' });
    assert.deepEqual(await read({ ...valid, userId: OTHER_USER }), { status: 'corrupt', reason: 'key_mismatch' });
    assert.deepEqual(await read({ ...valid, logDate: '2026-10-12', serverRow: null, baseVersion: null }), {
      status: 'corrupt',
      reason: 'key_mismatch',
    });
    assert.deepEqual(await read(valid, 2), { status: 'unknown_version', version: 2 });
  });
});

describe('applySyncSuccess', () => {
  it('si hubo otra edición durante el envío, esa edición sigue pendiente sobre la fila nueva', () => {
    const log = pendingLog(content({ energy_level: 4 }));
    const sent = toSentOperation(log);
    const edited = applyLocalEdit(log, edit({ content: content({ energy_level: 5 }) }), env(NOW + 500));
    const after = applySyncSuccess(edited, sent, row({ energy_level: 4, updated_at: NEXT_VERSION }));

    assert.equal(after.status, 'pending');
    assert.equal(after.pending.operationId, OP_1);
    assert.equal(after.pending.content.energy_level, 5);
    assert.equal(after.baseVersion, NEXT_VERSION);
    assert.deepEqual(toSyncPrecondition(after), { p_expected_updated_at: NEXT_VERSION });
  });

  it('una creación confirmada deja de esperar que el registro no exista', () => {
    const log = applyLocalEdit(null, edit(), env());
    const after = applySyncSuccess(log, toSentOperation(log), row());
    assert.equal(after.status, 'synced');
    assert.deepEqual(toSyncPrecondition(after), { p_expected_updated_at: VERSION });
  });
});

describe('applySyncFailure: recuperables frente a permanentes', () => {
  it('red: cuenta el intento y programa el siguiente con backoff determinista', () => {
    let log = pendingLog();
    const waits = [];
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      log = applySyncFailure(log, toSentOperation(log), NETWORK, { now: NOW, backoff: { random: () => 0.5 } });
      waits.push(log.pending.nextAttemptAt - NOW);
      assert.equal(log.pending.attempts, attempt);
    }
    assert.deepEqual(waits, [1_500, 3_000, 6_000, 12_000]);
    assert.equal(log.status, 'pending');
    assert.deepEqual(log.error, { kind: 'network', reason: 'network', at: NOW });
    assert.equal(isSyncDue(log, NOW + 11_999), false);
    assert.equal(isSyncDue(log, NOW + 12_000), true);
  });

  it('los fallos de red no agotan los intentos: el registro nunca se abandona por estar sin conexión', () => {
    let log = pendingLog();
    for (let attempt = 0; attempt < MAX_SYNC_ATTEMPTS * 3; attempt += 1) {
      log = applySyncFailure(log, toSentOperation(log), NETWORK, { now: NOW });
    }
    assert.equal(log.status, 'pending');
    assert.equal(log.pending.attempts, MAX_SYNC_ATTEMPTS * 3);
  });

  it('fallos del servidor: se reintentan hasta el límite y entonces quedan en `failed`', () => {
    let log = pendingLog();
    for (let attempt = 1; attempt < MAX_SYNC_ATTEMPTS; attempt += 1) {
      log = applySyncFailure(log, toSentOperation(log), SERVER, { now: NOW });
      assert.equal(log.status, 'pending');
    }
    log = applySyncFailure(log, toSentOperation(log), SERVER, { now: NOW });
    assert.equal(log.status, 'failed');
    assert.equal(log.pending.attempts, MAX_SYNC_ATTEMPTS);
    assert.equal(log.pending.nextAttemptAt, null);
    assert.equal(isSyncDue(log, NOW + 24 * 60 * 60_000), false);
  });

  it('permisos y validación: `failed` al primer intento, conservando el contenido local', () => {
    for (const error of [failure({ code: '42501' }, 403), failure({ code: 'P0001', hint: 'log_date_too_old' }, 400)]) {
      const log = pendingLog(content({ energy_level: 5, notes: 'no se pierde' }));
      const after = applySyncFailure(log, toSentOperation(log), error, { now: NOW });
      assert.equal(after.status, 'failed');
      assert.equal(after.pending.attempts, 0);
      assert.equal(after.pending.content.notes, 'no se pierde');
      assert.equal(after.error.kind, error.kind);
      assert.equal(isSyncDue(after, NOW + 60_000), false);
    }
  });

  it('sin sesión: sigue pendiente y no cuenta como intento', () => {
    const log = pendingLog();
    const after = applySyncFailure(log, toSentOperation(log), failure({ code: 'PGRST301' }, 401), { now: NOW });
    assert.equal(after.status, 'pending');
    assert.equal(after.pending.attempts, 0);
    assert.equal(after.pending.nextAttemptAt, null);
    assert.deepEqual(after.error, { kind: 'auth', reason: 'PGRST301', at: NOW });
  });

  it('el fallo de un contenido ya sustituido no penaliza ni descarta la edición nueva', () => {
    const log = pendingLog(content({ energy_level: 4 }));
    const sent = toSentOperation(log);
    const edited = applyLocalEdit(log, edit({ content: content({ energy_level: 5 }) }), env(NOW + 500));
    for (const error of [NETWORK, failure({ code: '23514' }, 400)]) {
      const after = applySyncFailure(edited, sent, error, { now: NOW + 600 });
      assert.equal(after.status, 'pending');
      assert.equal(after.pending.attempts, 0);
      assert.equal(after.pending.content.energy_level, 5);
    }
  });

  it('el resultado de una operación que ya no existe se ignora', () => {
    const log = pendingLog();
    const synced = applySyncSuccess(log, toSentOperation(log), row({ energy_level: 5, updated_at: NEXT_VERSION }));
    assert.equal(applySyncFailure(synced, toSentOperation(log), NETWORK, { now: NOW }), synced);
    assert.throws(() => toSentOperation(synced), LocalDailyLogStateError);
  });
});

describe('límites de reintentos: la operación nunca se pierde', () => {
  const fail = (log, error, now = NOW) =>
    applySyncFailure(log, toSentOperation(log), error, { now, backoff: { random: () => 1 } });
  const exhaust = (log) => {
    let next = log;
    for (let attempt = 0; attempt < MAX_SYNC_ATTEMPTS; attempt += 1) next = fail(next, SERVER);
    return next;
  };

  it('agotar los intentos deja la operación en `failed`, con su contenido y el error a la vista', async () => {
    const local = content({ energy_level: 5, notes: 'no se pierde' });
    const failed = exhaust(pendingLog(local));
    assert.equal(failed.status, 'failed');
    assert.deepEqual(failed.pending.content, local);
    assert.equal(failed.pending.operationId, OP_1);
    assert.deepEqual(failed.error, { kind: 'server', reason: 'http_502', at: NOW });
    assert.equal(failed.baseVersion, VERSION);

    // Sigue en el almacén local tal cual: nada lo borra.
    const store = createLocalStore(createMemoryStorage(), USER);
    await store.write(localDailyLogs, localDailyLogId(PET, DATE), failed);
    assert.deepEqual(await store.read(localDailyLogs, localDailyLogId(PET, DATE)), { status: 'found', value: failed });
  });

  it('el límite es exacto: un fallo menos sigue pendiente', () => {
    let log = pendingLog();
    for (let attempt = 1; attempt < MAX_SYNC_ATTEMPTS; attempt += 1) log = fail(log, SERVER);
    assert.equal(log.status, 'pending');
    assert.equal(log.pending.countedAttempts, MAX_SYNC_ATTEMPTS - 1);
    assert.notEqual(log.pending.nextAttemptAt, null);
    assert.equal(fail(log, SERVER).status, 'failed');
  });

  it('tras agotarse no se reintenta sola, pase el tiempo que pase', () => {
    const failed = exhaust(pendingLog());
    assert.equal(failed.pending.nextAttemptAt, null);
    for (const later of [0, 60_000, 24 * 60 * 60_000, 30 * 24 * 60 * 60_000]) {
      assert.equal(isSyncDue(failed, NOW + later), false);
    }
  });

  it('solo cuentan los fallos con respuesta del servidor: una racha sin conexión no acerca al límite', () => {
    let log = pendingLog();
    for (let attempt = 0; attempt < 20; attempt += 1) log = fail(log, NETWORK);
    assert.equal(log.pending.attempts, 20);
    assert.equal(log.pending.countedAttempts, 0);

    // El primer fallo del servidor después de la racha no agota la operación.
    log = fail(log, SERVER);
    assert.equal(log.status, 'pending');
    assert.equal(log.pending.countedAttempts, 1);
    for (let attempt = 2; attempt < MAX_SYNC_ATTEMPTS; attempt += 1) log = fail(fail(log, NETWORK), SERVER);
    assert.equal(log.status, 'pending');
    assert.equal(fail(log, SERVER).status, 'failed');
  });

  it('la espera crece con todos los fallos y se queda en el tope', () => {
    let log = pendingLog();
    const waits = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      log = fail(log, NETWORK);
      waits.push(log.pending.nextAttemptAt - NOW);
    }
    assert.deepEqual(waits.slice(0, 4), [2_000, 4_000, 8_000, 16_000]);
    assert.equal(waits.at(-1), SYNC_BACKOFF_MAX_MS);
    assert.ok(waits.every((wait, index) => index === 0 || wait >= waits[index - 1]));
  });

  it('permisos: `failed` al primer fallo y sin reintento automático', () => {
    const log = pendingLog(content({ notes: 'sigue aquí' }));
    const denied = fail(log, failure({ code: '42501', message: 'No tienes acceso de edición sobre esta mascota' }, 403));
    assert.equal(denied.status, 'failed');
    assert.equal(denied.pending.attempts, 0);
    assert.equal(denied.pending.nextAttemptAt, null);
    assert.equal(denied.pending.content.notes, 'sigue aquí');
    assert.deepEqual(denied.error, { kind: 'permission', reason: '42501', at: NOW });
    assert.equal(isSyncDue(denied, NOW + 24 * 60 * 60_000), false);
  });

  it('un error de programación (TypeError que no es de red) no se reintenta sin límite', () => {
    const bug = failure(new TypeError("Cannot read properties of undefined (reading 'rpc')"));
    assert.equal(bug.kind, 'unknown');
    let log = pendingLog();
    for (let attempt = 0; attempt < MAX_SYNC_ATTEMPTS; attempt += 1) log = fail(log, bug);
    assert.equal(log.status, 'failed');
    assert.notEqual(log.pending, null);
  });

  it('reintento manual: vuelve a `pending` siendo la misma operación', () => {
    const failed = exhaust(pendingLog(content({ energy_level: 5 })));
    const retried = retryFailedSync(failed);
    assert.equal(retried.status, 'pending');
    assert.deepEqual(retried.pending, { ...failed.pending, attempts: 0, countedAttempts: 0, nextAttemptAt: null });
    assert.deepEqual(retried.error, failed.error);
    assert.equal(isSyncDue(retried, NOW), true);

    // Solo actúa sobre operaciones fallidas.
    const pending = pendingLog();
    assert.equal(retryFailedSync(pending), pending);
    const inConflict = fail(pending, conflictError('version_mismatch'));
    assert.equal(retryFailedSync(inConflict), inConflict);
  });

  it('el identificador se genera una vez: ni reintentos, ni ediciones, ni conflictos crean otro', () => {
    let calls = 0;
    const createOperationId = () => {
      calls += 1;
      return `00000000-0000-4000-8000-${String(calls).padStart(12, '0')}`;
    };
    let log = applyLocalEdit(null, edit({ content: content({ energy_level: 5 }), baseRow: row() }), env(NOW, createOperationId));
    for (let attempt = 0; attempt < 5; attempt += 1) log = fail(log, NETWORK);
    log = applyLocalEdit(log, edit({ content: content({ energy_level: 4 }) }), env(NOW, createOperationId));
    log = retryFailedSync(exhaust(log));
    log = fail(log, failure({ code: 'PGRST301' }, 401));
    log = fail(log, conflictError('version_mismatch'));
    log = resolveConflict(log, { remoteRow: row({ mood_level: 2, updated_at: NEXT_VERSION }), content: content({ energy_level: 4, mood_level: 2 }) }, { now: NOW });

    assert.equal(calls, 1);
    assert.equal(log.pending.operationId, OP_1);
    assert.equal(log.status, 'pending');

    // Solo una operación nueva (tras sincronizar la anterior) pide otro identificador.
    const synced = applySyncSuccess(log, toSentOperation(log), row({ energy_level: 4, mood_level: 2, updated_at: NEXT_VERSION }));
    const next = applyLocalEdit(synced, edit({ content: content({ energy_level: 1 }), baseRow: synced.serverRow }), env(NOW, createOperationId));
    assert.equal(calls, 2);
    assert.notEqual(next.pending.operationId, OP_1);
  });

  it('el modelo solo acepta identificadores UUID v4 y contadores coherentes', () => {
    const valid = pendingLog();
    const bad = (pending) => assert.equal(parseLocalDailyLog({ ...valid, pending: { ...valid.pending, ...pending } }), null);
    bad({ operationId: 'op-1' });
    bad({ operationId: '0.7312945' });
    bad({ operationId: OP_1.toUpperCase().replace('0', 'A') });
    bad({ countedAttempts: 1 }); // más que `attempts`
    bad({ countedAttempts: -1 });
    bad({ countedAttempts: undefined });
    assert.throws(
      () => applyLocalEdit(null, edit(), env(NOW, () => 'no-es-uuid')),
      (error) => error instanceof LocalDailyLogStateError && error.code === 'invalid_record'
    );
  });
});

describe('conflictos', () => {
  it('el conflicto no se reintenta: queda a la espera de leer la fila remota', () => {
    const log = pendingLog();
    const after = applySyncFailure(log, toSentOperation(log), conflictError('version_mismatch'), { now: NOW });
    assert.equal(after.status, 'conflict');
    assert.deepEqual(after.conflict, { detail: 'version_mismatch', remote: { status: 'not_fetched' }, detectedAt: NOW });
    assert.equal(after.pending.attempts, 0);
    assert.equal(isSyncDue(after, NOW + 24 * 60 * 60_000), false);
    // La base sigue siendo la fila que se editó: hace falta para fusionar a tres bandas.
    assert.equal(after.baseVersion, VERSION);
  });

  it('una edición local durante el conflicto se conserva y el conflicto sigue', () => {
    const log = pendingLog();
    let after = applySyncFailure(log, toSentOperation(log), conflictError('version_mismatch'), { now: NOW });
    after = applyLocalEdit(after, edit({ content: content({ energy_level: 1 }) }), env(NOW + 10));
    assert.equal(after.status, 'conflict');
    assert.equal(after.pending.content.energy_level, 1);
    assert.notEqual(after.conflict, null);
  });

  it('guarda la fila remota (o su ausencia) y sobrevive al almacén local', async () => {
    const store = createLocalStore(createMemoryStorage(), USER);
    const id = localDailyLogId(PET, DATE);
    const log = pendingLog();
    const inConflict = applySyncFailure(log, toSentOperation(log), conflictError('version_mismatch'), { now: NOW });
    const remoteRow = row({ mood_level: 2, updated_at: NEXT_VERSION });

    const withRemote = setConflictRemote(inConflict, remoteRow);
    await store.write(localDailyLogs, id, withRemote);
    const stored = (await store.read(localDailyLogs, id)).value;
    assert.deepEqual(stored.conflict.remote, { status: 'present', row: remoteRow });
    assert.equal(stored.conflict.remote.row.updated_at, NEXT_VERSION);

    assert.deepEqual(setConflictRemote(inConflict, null).conflict.remote, { status: 'absent' });
    assert.throws(() => setConflictRemote(log, remoteRow), LocalDailyLogStateError);
    assert.throws(() => setConflictRemote(inConflict, row({ pet_id: OTHER_PET })), LocalDailyLogStateError);
  });

  it('fusión limpia: lo local queda pendiente sobre la fila remota', () => {
    const log = pendingLog(content({ energy_level: 5 }));
    const inConflict = applySyncFailure(log, toSentOperation(log), conflictError('version_mismatch'), { now: NOW });
    const remoteRow = row({ mood_level: 2, updated_at: NEXT_VERSION });
    const merge = mergeDailyLogContent({
      base: contentFromRow(inConflict.serverRow),
      local: inConflict.pending.content,
      remote: contentFromRow(remoteRow),
    });
    assert.equal(merge.status, 'merged');

    const resolved = resolveConflict(inConflict, { remoteRow, content: merge.content }, { now: NOW + 50 });
    assert.equal(resolved.status, 'pending');
    assert.equal(resolved.conflict, null);
    assert.equal(resolved.error, null);
    assert.equal(resolved.baseVersion, NEXT_VERSION);
    assert.equal(resolved.pending.operationId, OP_1);
    assert.deepEqual(resolved.pending.content, content({ energy_level: 5, mood_level: 2 }));
    assert.equal(isSyncDue(resolved, NOW + 50), true);
  });

  it('respuesta perdida: si el servidor ya tiene lo enviado, queda sincronizado sin reenviar', () => {
    const log = pendingLog(content({ energy_level: 5 }));
    const inConflict = applySyncFailure(log, toSentOperation(log), conflictError('version_mismatch'), { now: NOW });
    const remoteRow = row({ energy_level: 5, updated_at: NEXT_VERSION });
    const resolved = resolveConflict(inConflict, { remoteRow, content: inConflict.pending.content }, { now: NOW });
    assert.equal(resolved.status, 'synced');
    assert.equal(resolved.pending, null);
    assert.equal(resolved.baseVersion, NEXT_VERSION);
  });

  it('fila remota borrada y el usuario decide recrearla: se esperará que no exista', () => {
    const log = pendingLog();
    const inConflict = applySyncFailure(log, toSentOperation(log), conflictError('row_missing'), { now: NOW });
    const resolved = resolveConflict(inConflict, { remoteRow: null, content: inConflict.pending.content }, { now: NOW });
    assert.equal(resolved.status, 'pending');
    assert.deepEqual(toSyncPrecondition(resolved), { p_expect_absent: true });
    assert.throws(() => resolveConflict(log, { remoteRow: null, content: content() }, { now: NOW }), LocalDailyLogStateError);
  });
});
