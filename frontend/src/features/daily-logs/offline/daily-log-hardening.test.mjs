// Pruebas del endurecimiento de Daily Logs offline (fase 4): lecturas tardías que no hacen retroceder
// la copia local ni la caché, descartar una copia local, registros sin sincronizar, esperar a una
// sesión nueva tras un 401 y resultados de resolución sin "sincronizado" sin evidencia. Servidor
// falso, almacén en memoria y el QueryClient real de `@tanstack/query-core` (`npm test`).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { QueryClient } from '@tanstack/query-core';

import { createLocalStore } from '../../../lib/local-store/local-store.ts';
import { createMemoryStorage } from '../../../lib/local-store/memory-storage.ts';
import { dailyLogKeys } from '../query-keys.ts';
import {
  applyLocalChangeToCache,
  dailyLogDetailQueryOptions,
  isUnsynced,
  readDailyLogThroughRepository,
  readHistoryPageThroughRepository,
} from './daily-log-cache.ts';
import { contentFromRow } from './daily-log-content.ts';
import { createDailyLogRepository } from './daily-log-repository.ts';
import { compareVersions } from './daily-log-version.ts';
import { resolveDailyLogDetail, resolveDailyLogHistory, resolveUnsyncedList, toLocalState } from './daily-log-view.ts';
import { createSyncedLocalDailyLog, discardLocalChanges } from './local-daily-log.ts';
import {
  DATE,
  OTHER_USER,
  PET,
  USER,
  argsFor,
  content,
  device,
  saves,
  serverWithPet,
} from './sync-test-helpers.mjs';

const PET_2 = 'b0000000-0000-4000-8000-000000000002';
const DATE_2 = '2026-10-14';
const V1 = '2026-10-15T09:00:00.100001+00:00';
const V2 = '2026-10-15T09:00:00.100002+00:00'; // 1 µs después: `Date` no lo distingue
const V3 = '2026-10-15T10:00:00.3+00:00';

const row = (version, overrides = {}) => ({
  id: 'c0000000-0000-4000-8000-000000000001',
  pet_id: PET,
  log_date: DATE,
  logged_by: USER,
  last_edited_by: null,
  ...content(),
  created_at: '2026-10-15T08:00:00.1+00:00',
  updated_at: version,
  ...overrides,
});
const synced = (version, overrides) =>
  createSyncedLocalDailyLog({ userId: USER, petId: PET, logDate: DATE }, row(version, overrides));

function setup(disk = new Map()) {
  return { disk, repository: createDailyLogRepository(createLocalStore(createMemoryStorage(disk), USER)) };
}

/** Promesa que se resuelve a mano: una respuesta del servidor que llega cuando decide la prueba. */
function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

/** Caché conectada al almacén del dispositivo, como en `DailyLogSyncProvider`. */
function connectCache(repository) {
  const client = new QueryClient();
  repository.subscribe((change) => applyLocalChangeToCache(client, USER, change));
  return client;
}

const writeCalls = (server) => server.calls.filter((call) => call.type === 'save');

describe('versiones (updated_at) con su precisión original', () => {
  it('compara microsegundos sin pasar por Date', () => {
    assert.equal(new Date(V1).getTime(), new Date(V2).getTime()); // Date pierde la diferencia
    assert.equal(compareVersions(V2, V1), 1);
    assert.equal(compareVersions(V1, V2), -1);
    assert.equal(compareVersions('2026-10-15T09:14:26.9+00:00', '2026-10-15T09:14:26.89152+00:00'), 1);
  });

  it('el mismo instante escrito de otra forma es la misma versión', () => {
    assert.equal(compareVersions('2026-10-15T09:00:00.5+00:00', '2026-10-15T09:00:00.500000+00:00'), 0);
    assert.equal(compareVersions('2026-10-15T11:00:00+02:00', '2026-10-15T09:00:00Z'), 0);
    assert.equal(compareVersions('2026-10-15 09:00:00+00', '2026-10-15T09:00:00+00:00'), 0);
    assert.equal(compareVersions('2026-03-01T00:00:00+00:00', '2026-02-28T23:59:59.999999+00:00'), 1);
  });

  it('lo que no tiene el formato esperado no se puede comparar (null)', () => {
    assert.equal(compareVersions('ayer', V1), null);
    assert.equal(compareVersions('2026-02-30T09:00:00+00:00', V1), null);
    assert.equal(compareVersions(`${V1}0`, V1), null); // más de 6 decimales
  });
});

describe('M1: una lectura tardía no hace retroceder la copia local (D1)', () => {
  it('respuesta iniciada antes de una confirmación y con una versión anterior: se conserva la nueva', async () => {
    const { repository } = setup();
    await repository.refreshSnapshot(PET, DATE, row(V1));
    const mark = repository.snapshotMark(); // empieza la lectura
    await repository.update(PET, DATE, () => synced(V3, { notes: 'confirmada' })); // el motor confirma
    const latest = await repository.refreshSnapshot(PET, DATE, row(V2, { notes: 'vieja' }), mark);
    assert.equal(latest.updated_at, V3);
    assert.equal((await repository.read(PET, DATE)).serverRow.notes, 'confirmada');
  });

  it('una versión anterior nunca sustituye a la que hay, aunque la lectura parezca reciente', async () => {
    const { repository } = setup();
    await repository.refreshSnapshot(PET, DATE, row(V3));
    assert.equal((await repository.refreshSnapshot(PET, DATE, row(V1))).updated_at, V3);
    assert.equal((await repository.read(PET, DATE)).baseVersion, V3);
  });

  it('una ausencia que llega tarde no borra la copia confirmada; una ausencia reciente sí', async () => {
    const { repository } = setup();
    const mark = repository.snapshotMark();
    await repository.update(PET, DATE, () => synced(V2)); // creada y confirmada durante la lectura
    assert.equal((await repository.refreshSnapshot(PET, DATE, null, mark)).updated_at, V2);
    assert.equal((await repository.read(PET, DATE)).baseVersion, V2);

    assert.equal(await repository.refreshSnapshot(PET, DATE, null, repository.snapshotMark()), null);
    assert.equal(await repository.read(PET, DATE), null);
  });

  it('respuestas fuera de orden: la segunda lectura llega primero y la primera no la deshace', async () => {
    const { repository } = setup();
    const first = repository.snapshotMark();
    const second = repository.snapshotMark();
    await repository.refreshSnapshot(PET, DATE, row(V2), second);
    await repository.refreshSnapshot(PET, DATE, row(V1), first);
    assert.equal((await repository.read(PET, DATE)).baseVersion, V2);
  });

  it('lectura tardía con una versión claramente posterior: se acepta', async () => {
    const { repository } = setup();
    const mark = repository.snapshotMark();
    await repository.update(PET, DATE, () => synced(V1));
    await repository.refreshSnapshot(PET, DATE, row(V3), mark);
    assert.equal((await repository.read(PET, DATE)).baseVersion, V3);
  });

  it('versiones iguales: no se escribe nada; no comparables: solo una lectura reciente sustituye', async () => {
    const { repository, disk } = setup();
    await repository.refreshSnapshot(PET, DATE, row(V1));
    const before = [...disk.values()][0];
    await repository.refreshSnapshot(PET, DATE, row('2026-10-15T09:00:00.100001Z'));
    assert.equal([...disk.values()][0], before);

    const mark = repository.snapshotMark();
    await repository.update(PET, DATE, () => synced(V2));
    await repository.refreshSnapshot(PET, DATE, row('versión rara'), mark);
    assert.equal((await repository.read(PET, DATE)).baseVersion, V2);
  });

  it('nunca toca una operación pendiente ni un conflicto, llegue lo que llegue', async () => {
    const server = serverWithPet();
    const original = server.writeAsOther(USER, argsFor());
    const phone = device(server, { online: false });
    await phone.repository.refreshSnapshot(PET, DATE, original);
    await phone.save({ notes: 'mía' }, original);
    const pending = await phone.read();
    for (const value of [null, row(V1), row('2030-01-01T00:00:00+00:00')]) {
      await phone.repository.refreshSnapshot(PET, DATE, value, 0);
      await phone.repository.refreshSnapshot(PET, DATE, value);
    }
    assert.deepEqual(await phone.read(), pending);
  });
});

describe('M1: la caché de TanStack no retrocede (D2, D2b)', () => {
  it('D2: una copia local anterior no sustituye la fila del día ni la del historial', () => {
    const client = new QueryClient();
    client.setQueryData(dailyLogKeys.detail(USER, PET, DATE), row(V3, { notes: 'nueva' }));
    client.setQueryData(dailyLogKeys.history(USER, PET), { pages: [{ logs: [row(V3)], nextCursor: null }], pageParams: [null] });
    applyLocalChangeToCache(client, USER, { petId: PET, logDate: DATE, record: synced(V2), previous: null });
    assert.equal(client.getQueryData(dailyLogKeys.detail(USER, PET, DATE)).updated_at, V3);
    assert.equal(client.getQueryData(dailyLogKeys.history(USER, PET)).pages[0].logs[0].updated_at, V3);
  });

  it('D2b: una lectura en vuelo antes de que el motor confirme no pisa la fila confirmada', async () => {
    const server = serverWithPet();
    const v1 = server.writeAsOther(USER, argsFor({ notes: 'v1' }));
    const phone = device(server);
    await phone.repository.refreshSnapshot(PET, DATE, v1);
    const client = connectCache(phone.repository);

    const response = deferred(); // la petición GET del registro del día, todavía sin respuesta
    const fetching = client.fetchQuery({
      queryKey: dailyLogKeys.detail(USER, PET, DATE),
      queryFn: () => readDailyLogThroughRepository(phone.repository, PET, DATE, () => response.promise),
      ...dailyLogDetailQueryOptions,
    });
    await phone.save({ notes: 'confirmada' }, v1); // el motor envía y el servidor confirma v2
    const confirmed = server.row(PET, DATE);
    assert.equal(client.getQueryData(dailyLogKeys.detail(USER, PET, DATE)).updated_at, confirmed.updated_at);

    response.resolve({ ...v1 }); // llega la respuesta antigua
    await fetching;
    assert.equal(client.getQueryData(dailyLogKeys.detail(USER, PET, DATE)).notes, 'confirmada');
    assert.equal((await phone.read()).baseVersion, confirmed.updated_at);
  });

  it('aunque el almacén falle, la query del día no acepta una fila anterior a la que tiene', async () => {
    const client = new QueryClient();
    const response = deferred();
    const broken = { snapshotMark: () => 0, refreshSnapshot: () => Promise.reject(new Error('disco')) };
    const fetching = client.fetchQuery({
      queryKey: dailyLogKeys.detail(USER, PET, DATE),
      queryFn: () => readDailyLogThroughRepository(broken, PET, DATE, () => response.promise),
      ...dailyLogDetailQueryOptions,
    });
    client.setQueryData(dailyLogKeys.detail(USER, PET, DATE), row(V3));
    response.resolve(row(V1));
    await fetching;
    assert.equal(client.getQueryData(dailyLogKeys.detail(USER, PET, DATE)).updated_at, V3);
  });

  it('una página del historial que llega tarde muestra la versión confirmada, no la antigua', async () => {
    const server = serverWithPet();
    const v1 = server.writeAsOther(USER, argsFor({ notes: 'v1' }));
    const phone = device(server);
    await phone.repository.refreshSnapshot(PET, DATE, v1);
    const page = deferred();
    const reading = readHistoryPageThroughRepository(phone.repository, PET, () => page.promise);
    await phone.save({ notes: 'confirmada' }, v1);
    page.resolve({ logs: [{ ...v1 }], nextCursor: null });
    const result = await reading;
    assert.equal(result.logs[0].notes, 'confirmada');
    assert.equal((await phone.read()).serverRow.notes, 'confirmada');
  });
});

/** Conflicto de versión: el móvil editó sin conexión y otro usuario guardó mientras tanto. */
async function conflictScenario() {
  const server = serverWithPet();
  server.allowEditor(PET, OTHER_USER);
  const original = server.writeAsOther(USER, argsFor());
  const phone = device(server, { online: false });
  await phone.repository.refreshSnapshot(PET, DATE, original);
  await phone.save({ notes: 'mía' }, original);
  server.writeAsOther(OTHER_USER, argsFor({ notes: 'suya' }));
  phone.net.online = true;
  await phone.engine.requestSync();
  return { server, phone, original };
}

describe('M3: descartar la copia de este dispositivo', () => {
  it('sin permiso al crear: desaparece la copia local; el servidor no recibe ninguna petición', async () => {
    const server = serverWithPet();
    server.revokeEditor(PET, USER);
    const phone = device(server);
    await phone.save({ notes: 'sin permiso' });
    assert.equal((await phone.read()).status, 'failed');
    const before = server.calls.length;

    assert.equal(await phone.engine.discardLocalChanges(PET, DATE), 'discarded');
    assert.equal(await phone.read(), null);
    assert.equal(server.calls.length, before); // ni lectura ni escritura
    assert.equal(server.row(PET, DATE), null);
  });

  it('sin permiso al editar: queda la última versión confirmada y la del servidor sigue intacta', async () => {
    const server = serverWithPet();
    const original = server.writeAsOther(USER, argsFor({ notes: 'servidor' }));
    const phone = device(server);
    await phone.repository.refreshSnapshot(PET, DATE, original);
    server.revokeEditor(PET, USER);
    await phone.save({ notes: 'mía' }, original);
    const writes = writeCalls(server).length;

    assert.equal(await phone.engine.discardLocalChanges(PET, DATE), 'discarded');
    const local = await phone.read();
    assert.equal(local.status, 'synced');
    assert.deepEqual(local.serverRow, original);
    assert.equal(writeCalls(server).length, writes);
    assert.deepEqual(server.row(PET, DATE), original);
  });

  it('fecha no válida (validación): se puede descartar', async () => {
    const server = serverWithPet();
    server.failForDate(DATE, {
      ok: false,
      status: 400,
      error: { code: 'P0001', hint: 'log_date_too_old', message: '…' },
    });
    const phone = device(server);
    await phone.save({ notes: 'fuera de plazo' });
    const failed = await phone.read();
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error.kind, 'validation');
    assert.equal(await phone.engine.discardLocalChanges(PET, DATE), 'discarded');
    assert.equal(await phone.read(), null);
  });

  it('conflicto con la versión remota leída: queda la versión del servidor, sin enviar nada', async () => {
    const { server, phone } = await conflictScenario();
    const local = await phone.read();
    assert.equal(local.conflict.remote.status, 'present');
    const calls = server.calls.length;
    assert.equal(await phone.engine.discardLocalChanges(PET, DATE), 'discarded');
    const after = await phone.read();
    assert.equal(after.status, 'synced');
    assert.equal(after.serverRow.notes, 'suya');
    assert.equal(server.calls.length, calls);
  });

  it('conflicto sin leer la versión remota: no se descarta (no hay versión fiable que conservar)', async () => {
    const { phone } = await conflictScenario();
    await phone.repository.update(PET, DATE, (log) => ({ ...log, conflict: { ...log.conflict, remote: { status: 'not_fetched' } } }));
    const before = await phone.read();
    phone.net.online = false;
    assert.equal(await phone.engine.discardLocalChanges(PET, DATE), 'remote_unknown');
    assert.deepEqual(await phone.read(), before);
  });

  it('una operación todavía pendiente no se descarta y se sigue enviando después', async () => {
    const server = serverWithPet();
    const phone = device(server, { online: false });
    await phone.save({ notes: 'pendiente' });
    assert.equal(await phone.engine.discardLocalChanges(PET, DATE), 'not_discardable');
    assert.equal((await phone.read()).pending.content.notes, 'pendiente');
    phone.net.online = true;
    await phone.engine.requestSync();
    assert.equal(server.row(PET, DATE).notes, 'pendiente');
  });

  it('espera a que termine la pasada en curso antes de decidir', async () => {
    const server = serverWithPet();
    server.revokeEditor(PET, USER);
    const phone = device(server);
    await phone.save({ notes: 'fallida' });
    server.allowEditor(PET_2, USER);
    const release = server.holdNextSave();
    await phone.engine.saveLocal({ petId: PET_2, logDate: DATE, content: content({ notes: 'otra' }), baseRow: null });
    let settled = false;
    const discarding = phone.engine.discardLocalChanges(PET, DATE).then((outcome) => {
      settled = true;
      return outcome;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false); // hay un envío en vuelo
    release();
    assert.equal(await discarding, 'discarded');
    assert.equal((await phone.repository.read(PET_2, DATE)).status, 'synced');
  });

  it('la transición pura: solo fallidos y conflictos con versión remota conocida', () => {
    assert.equal(discardLocalChanges(null).status, 'not_discardable');
    assert.equal(discardLocalChanges(synced(V1)).status, 'not_discardable');
  });
});

describe('M4: registros sin sincronizar, desde el almacén local', () => {
  it('lista pendientes, fallidos y conflictos (no los sincronizados), con o sin acceso a la mascota', async () => {
    const server = serverWithPet();
    server.allowEditor(PET_2, USER);
    const phone = device(server, { online: false });
    await phone.save({ notes: 'pendiente' });
    await phone.engine.saveLocal({ petId: PET_2, logDate: DATE_2, content: content({ notes: 'expulsado' }), baseRow: null });
    await phone.repository.refreshSnapshot(PET, DATE_2, { ...row(V1), log_date: DATE_2 });

    // Ya no es miembro de la segunda mascota: RLS la oculta y el envío falla.
    server.removeMember(PET_2, USER);
    phone.net.online = true;
    server.setOnline(false);
    await phone.engine.requestSync(); // sin red: siguen pendientes
    const records = (await phone.repository.list()).filter(isUnsynced);
    const view = resolveUnsyncedList({
      local: toLocalState({ data: records, status: 'success' }, []),
      pets: [{ id: PET, name: 'Luna' }], // la lista remota de mascotas ya no incluye PET_2
      syncingKey: null,
    });
    assert.equal(view.state, 'ready');
    assert.deepEqual(
      view.items.map((item) => [item.record.petId, item.record.logDate, item.petName, item.syncStatus]),
      [
        [PET, DATE, 'Luna', 'pending'],
        [PET_2, DATE_2, null, 'pending'],
      ]
    );

    server.setOnline(true);
    await phone.engine.requestSync();
    assert.equal((await phone.repository.read(PET_2, DATE_2)).status, 'failed'); // sigue ahí, no se borra
  });

  it('una mascota eliminada (o sin acceso) no borra sus pendientes', async () => {
    const server = serverWithPet();
    const phone = device(server, { online: false });
    await phone.save({ notes: 'de una mascota que ya no está' });
    server.removeMember(PET, USER);
    phone.net.online = true;
    await phone.engine.requestSync();
    const [record] = (await phone.repository.list()).filter(isUnsynced);
    assert.equal(record.status, 'failed');
    assert.equal(record.pending.content.notes, 'de una mascota que ya no está');
  });

  it('cambio de usuario en el mismo dispositivo: cada uno ve solo lo suyo, también al reabrir', async () => {
    const server = serverWithPet();
    const disk = new Map();
    const userA = device(server, { disk, online: false });
    await userA.save({ notes: 'de A' });
    const userB = device(server, { userId: OTHER_USER, disk, online: false });
    assert.deepEqual((await userB.repository.list()).filter(isUnsynced), []);

    const reopenedA = device(server, { disk, online: false });
    const listed = (await reopenedA.repository.list()).filter(isUnsynced);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].userId, USER);
  });

  it('el contador se revalida cuando un registro entra o sale de la lista, no con cada copia', async () => {
    const server = serverWithPet();
    const phone = device(server, { online: false });
    const client = connectCache(phone.repository);
    const key = dailyLogKeys.unsynced(USER);
    const count = async () => {
      await client.refetchQueries({ queryKey: key });
      return client.getQueryData(key).length;
    };
    await client.fetchQuery({ queryKey: key, queryFn: async () => (await phone.repository.list()).filter(isUnsynced) });
    const invalidated = () => client.getQueryState(key).isInvalidated;

    await phone.repository.refreshSnapshot(PET, DATE_2, { ...row(V1), log_date: DATE_2 });
    assert.equal(invalidated(), false); // una copia sincronizada no cambia la lista
    await phone.save({ notes: 'nuevo' });
    assert.equal(invalidated(), true);
    assert.equal(await count(), 1);

    phone.net.online = true;
    await phone.engine.requestSync();
    assert.equal(invalidated(), true);
    assert.equal(await count(), 0);
  });
});

describe('errores de lectura local: nunca una lista vacía', () => {
  const failed = toLocalState({ data: undefined, error: new Error('disco'), status: 'error' }, []);

  it('registros sin sincronizar, historial y registro del día muestran el error de lectura', () => {
    const unsynced = resolveUnsyncedList({ local: failed, pets: undefined, syncingKey: null });
    assert.equal(unsynced.state, 'error');
    assert.equal(unsynced.error.code, 'local_read_failed');

    const history = resolveDailyLogHistory({
      remote: { status: 'success', data: { pages: [{ logs: [], nextCursor: null }], hasNextPage: false } },
      local: failed,
      syncingKey: null,
    });
    assert.equal(history.state, 'error');

    const detail = resolveDailyLogDetail({
      remote: { status: 'success', data: null },
      local: toLocalState({ data: undefined, error: new Error('disco'), status: 'error' }, null),
      syncing: false,
      allowOfflineCreate: true,
    });
    assert.equal(detail.state, 'error');
    assert.equal(detail.error.code, 'local_read_failed');
  });

  it('si ya había datos y falla una relectura, se siguen mostrando', () => {
    const local = toLocalState({ data: [synced(V1)], error: new Error('disco'), status: 'error' }, []);
    assert.equal(local.status, 'ready');
  });
});

describe('B1: un 401 espera a una sesión nueva', () => {
  const expired = { ok: false, status: 401, error: { code: 'PGRST303', message: 'JWT expired' } };

  it('varios disparadores con la misma sesión: un solo envío; con la sesión renovada, se envía', async () => {
    const server = serverWithPet();
    const phone = device(server);
    server.failNext(expired);
    await phone.save({ notes: 'esperando sesión' });
    assert.equal(saves(server).length, 1);

    for (let i = 0; i < 5; i += 1) await phone.engine.requestSync(); // primer plano, red, nuevos guardados…
    await phone.engine.saveLocal({ petId: PET, logDate: DATE_2, content: content(), baseRow: null });
    await phone.engine.idle();
    assert.equal(saves(server).length, 1);
    assert.equal((await phone.read()).error.kind, 'auth');

    phone.engine.setSessionUserId(USER); // TOKEN_REFRESHED
    await phone.engine.requestSync();
    assert.equal(saves(server).length, 3);
    assert.equal((await phone.read()).status, 'synced');
  });

  it('un 401 de una sesión ya sustituida no bloquea la nueva', async () => {
    const server = serverWithPet();
    const phone = device(server);
    const release = server.holdNextSave();
    server.failNext(expired);
    const saving = phone.save({ notes: 'x' });
    while (!saves(server).length) await new Promise((resolve) => setImmediate(resolve));
    phone.engine.setSessionUserId(USER); // la sesión se renueva mientras la petición está en vuelo
    release();
    await saving;
    await phone.engine.requestSync();
    assert.equal(saves(server).length, 2);
    assert.equal((await phone.read()).status, 'synced');
  });

  it('tras un 401, resolver un conflicto no llama al servidor hasta renovar la sesión', async () => {
    const { server, phone } = await conflictScenario();
    const local = await phone.read();
    server.failNext(expired); // otro registro recibe el 401: la sesión no vale
    await phone.engine.saveLocal({ petId: PET, logDate: DATE_2, content: content(), baseRow: null });
    await phone.engine.idle();
    server.calls.length = 0;

    const decision = { action: 'save', content: local.pending.content, shownRemote: local.conflict.remote.row };
    assert.equal(await phone.engine.resolveConflict(PET, DATE, decision), 'unavailable');
    assert.deepEqual(server.calls, []);
    assert.equal((await phone.read()).status, 'conflict'); // no cambió nada

    phone.engine.setSessionUserId(USER);
    assert.equal(await phone.engine.resolveConflict(PET, DATE, decision), 'synced');
  });
});

describe('B4: resolver nunca termina en «sincronizado» sin evidencia', () => {
  it('si el registro desaparece del dispositivo durante el envío de la resolución, no es «synced»', async () => {
    const { server, phone } = await conflictScenario();
    const local = await phone.read();
    const release = server.holdNextSave();
    const resolving = phone.engine.resolveConflict(PET, DATE, {
      action: 'save',
      content: local.pending.content,
      shownRemote: local.conflict.remote.row,
    });
    while (!saves(server).length) await new Promise((resolve) => setImmediate(resolve));
    await phone.repository.update(PET, DATE, () => null);
    release();
    assert.equal(await resolving, 'not_in_conflict');
  });

  it('«synced» solo con contenido idéntico comprobado en el servidor o confirmado por él', async () => {
    const { server, phone } = await conflictScenario();
    const local = await phone.read();
    const remoteRow = local.conflict.remote.row;
    const outcome = await phone.engine.resolveConflict(PET, DATE, {
      action: 'save',
      content: contentFromRow(remoteRow),
      shownRemote: remoteRow,
    });
    assert.equal(outcome, 'synced');
    assert.equal(writeCalls(server).length, 1); // solo el envío original que provocó el conflicto
    assert.deepEqual((await phone.read()).serverRow, server.row(PET, DATE));
  });
});

describe('B6: «Guardar resolución» con una pasada en curso (hipótesis)', () => {
  it('espera a la pasada en curso y después lee el servidor y envía: no se pierde el toque', async () => {
    const { server, phone } = await conflictScenario();
    const local = await phone.read();
    server.allowEditor(PET_2, USER);
    const release = server.holdNextSave();
    await phone.engine.saveLocal({ petId: PET_2, logDate: DATE, content: content(), baseRow: null });
    server.calls.length = 0;
    let settled = false;
    const resolving = phone.engine
      .resolveConflict(PET, DATE, { action: 'save', content: local.pending.content, shownRemote: local.conflict.remote.row })
      .then((outcome) => {
        settled = true;
        return outcome;
      });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    assert.equal(server.calls.filter((call) => call.petId === PET || call.args?.p_pet_id === PET).length, 0);
    release();
    assert.equal(await resolving, 'synced');
    assert.equal(server.row(PET, DATE).notes, 'mía');
  });
});
