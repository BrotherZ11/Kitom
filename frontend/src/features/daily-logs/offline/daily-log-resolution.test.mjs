// Pruebas de la resolución de conflictos (`engine.resolveConflict` + `buildResolvedContent`) y de la
// recuperación ante errores del motor de sincronización: cierres de la app, tiempo agotado, conflictos
// repetidos, permisos revocados, fila borrada y cola que no se bloquea. Servidor falso y almacén en
// memoria (`npm test`); ver frontend/CLAUDE.md.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createMemoryStorage } from '../../../lib/local-store/memory-storage.ts';
import { contentFromRow } from './daily-log-content.ts';
import { buildResolvedContent } from './daily-log-merge.ts';
import { createDailyLogRemote } from './daily-log-remote.ts';
import { createDailyLogRepository } from './daily-log-repository.ts';
import { createDailyLogSyncEngine } from './daily-log-sync-engine.ts';
import { MAX_SYNC_ATTEMPTS } from './sync-backoff.ts';
import { classifySyncError } from './sync-errors.ts';
import { createLocalStore } from '../../../lib/local-store/local-store.ts';
import {
  DATE,
  OTHER_USER,
  PET,
  USER,
  argsFor,
  content,
  device,
  noTimers,
  saves,
  serverWithPet,
} from './sync-test-helpers.mjs';

const calls = (server) => server.calls.map((call) => call.type);

/**
 * Deja el registro del móvil en conflicto de versión: lo editó sin conexión sobre `original` y,
 * mientras tanto, otro usuario guardó `theirs`.
 */
async function conflictScenario({ mine = { energy_level: 5, notes: 'mía' }, theirs = { mood_level: 1, notes: 'suya' } } = {}) {
  const server = serverWithPet();
  server.allowEditor(PET, OTHER_USER);
  const original = server.writeAsOther(USER, argsFor());
  const phone = device(server, { online: false });
  await phone.repository.refreshSnapshot(PET, DATE, original);
  await phone.save(mine, original);
  server.writeAsOther(OTHER_USER, argsFor(theirs));
  phone.net.online = true;
  await phone.engine.requestSync();
  const local = await phone.read();
  assert.equal(local.status, 'conflict');
  assert.equal(local.conflict.remote.status, 'present');
  server.calls.length = 0;
  return { server, phone, original, local };
}

/** Lo que la pantalla construye y envía: contenido elegido sobre la fila remota que se mostró. */
function decide(local, strategy, resolutions) {
  const remoteRow = local.conflict.remote.status === 'present' ? local.conflict.remote.row : null;
  const result = buildResolvedContent(
    {
      base: local.serverRow ? contentFromRow(local.serverRow) : null,
      local: local.pending.content,
      remote: remoteRow ? contentFromRow(remoteRow) : null,
    },
    strategy,
    resolutions
  );
  assert.equal(result.status, 'merged');
  return { action: 'save', content: result.content, shownRemote: remoteRow };
}

describe('guardar una resolución', () => {
  it('conservar mis cambios: lee la versión más reciente y envía con su precondición; sincronizado al confirmar', async () => {
    const { server, phone, local } = await conflictScenario();
    const outcome = await phone.engine.resolveConflict(PET, DATE, decide(local, 'local'));

    assert.equal(outcome, 'synced');
    assert.deepEqual(calls(server), ['fetch', 'save']);
    assert.equal(saves(server)[0].args.p_expected_updated_at, local.conflict.remote.row.updated_at);
    assert.equal(server.row(PET, DATE).notes, 'mía');
    assert.equal(server.row(PET, DATE).energy_level, 5);
    const after = await phone.read();
    assert.equal(after.status, 'synced');
    assert.equal(after.baseVersion, server.row(PET, DATE).updated_at);
  });

  it('conservar la versión del servidor: no envía nada y queda sincronizado con la fila remota', async () => {
    const { server, phone, local } = await conflictScenario();
    const outcome = await phone.engine.resolveConflict(PET, DATE, decide(local, 'remote'));
    assert.equal(outcome, 'synced');
    assert.deepEqual(calls(server), ['fetch']);
    const after = await phone.read();
    assert.equal(after.pending, null);
    assert.equal(after.serverRow.notes, 'suya');
  });

  it('combinar: lo de un solo lado se conserva o acepta y el conflicto se decide explícitamente', async () => {
    const { server, phone, local } = await conflictScenario();
    const outcome = await phone.engine.resolveConflict(PET, DATE, decide(local, 'combine', { notes: { text: 'mía y suya, revisada' } }));
    assert.equal(outcome, 'synced');
    const row = server.row(PET, DATE);
    assert.equal(row.energy_level, 5); // solo lo cambié yo
    assert.equal(row.mood_level, 1); // solo cambió en el servidor
    assert.equal(row.notes, 'mía y suya, revisada'); // decisión explícita
  });

  it('si el servidor cambió desde que se comparó, no envía: vuelve a pedir resolución con la versión nueva', async () => {
    const { server, phone, local } = await conflictScenario();
    const decision = decide(local, 'local');
    server.writeAsOther(OTHER_USER, argsFor({ mood_level: 2, notes: 'suya, otra vez' }));

    const outcome = await phone.engine.resolveConflict(PET, DATE, decision);
    assert.equal(outcome, 'conflict');
    assert.deepEqual(calls(server), ['fetch']);
    const after = await phone.read();
    assert.equal(after.status, 'conflict');
    assert.equal(after.conflict.remote.row.notes, 'suya, otra vez');
    assert.equal(after.pending.content.notes, 'mía'); // los datos locales siguen intactos
  });

  it('carrera durante el envío: otro guardado entre la lectura y el envío → conflicto, sin pisar nada', async () => {
    const { server, phone, local } = await conflictScenario();
    server.beforeNextSave(() => server.writeAsOther(OTHER_USER, argsFor({ notes: 'se coló' })));

    const outcome = await phone.engine.resolveConflict(PET, DATE, decide(local, 'local'));
    assert.equal(outcome, 'conflict');
    assert.equal(server.row(PET, DATE).notes, 'se coló');
    const after = await phone.read();
    assert.equal(after.status, 'conflict');
    assert.equal(after.pending.content.notes, 'mía'); // la resolución elegida se conserva
    assert.equal(after.conflict.remote.row.notes, 'se coló');
  });

  it('conflicto repetido: se puede resolver otra vez sobre la versión nueva', async () => {
    const { server, phone, local } = await conflictScenario();
    server.beforeNextSave(() => server.writeAsOther(OTHER_USER, argsFor({ notes: 'se coló' })));
    assert.equal(await phone.engine.resolveConflict(PET, DATE, decide(local, 'local')), 'conflict');

    const again = await phone.read();
    assert.equal(await phone.engine.resolveConflict(PET, DATE, decide(again, 'local')), 'synced');
    assert.equal(server.row(PET, DATE).notes, 'mía');
  });

  it('fila remota borrada: volver a crearla es una decisión explícita y usa p_expect_absent', async () => {
    const server = serverWithPet();
    const original = server.writeAsOther(USER, argsFor());
    const phone = device(server, { online: false });
    await phone.save({ notes: 'editada sin red' }, original);
    server.rows.clear();
    phone.net.online = true;
    await phone.engine.requestSync();
    const local = await phone.read();
    assert.deepEqual(local.conflict.remote, { status: 'absent' });
    // Nada se recrea solo.
    await phone.advance(24 * 60 * 60_000);
    assert.equal(server.rows.size, 0);

    server.calls.length = 0;
    assert.equal(await phone.engine.resolveConflict(PET, DATE, decide(local, 'local')), 'synced');
    assert.equal(saves(server)[0].args.p_expect_absent, true);
    assert.equal(server.row(PET, DATE).notes, 'editada sin red');
  });

  it('fila borrada y vuelta a crear por otro mientras se decidía: conflicto otra vez', async () => {
    const server = serverWithPet();
    server.allowEditor(PET, OTHER_USER);
    const original = server.writeAsOther(USER, argsFor());
    const phone = device(server, { online: false });
    await phone.save({ notes: 'mía' }, original);
    server.rows.clear();
    phone.net.online = true;
    await phone.engine.requestSync();
    const local = await phone.read();
    server.writeAsOther(OTHER_USER, argsFor({ notes: 'nueva de otro' }));

    assert.equal(await phone.engine.resolveConflict(PET, DATE, decide(local, 'local')), 'conflict');
    assert.equal((await phone.read()).conflict.remote.row.notes, 'nueva de otro');
  });

  it('fila remota borrada: descartar mis cambios borra solo la copia local y no toca nada remoto', async () => {
    const server = serverWithPet();
    const original = server.writeAsOther(USER, argsFor());
    const other = device(server, { online: false });
    await other.save({ notes: 'mía' }, original);
    server.rows.clear();
    other.net.online = true;
    await other.engine.requestSync();
    assert.equal((await other.read()).conflict.remote.status, 'absent');
    server.calls.length = 0;
    assert.equal(await other.engine.discardLocalChanges(PET, DATE), 'discarded');
    assert.equal(await other.read(), null);
    assert.equal(server.rows.size, 0);
    assert.deepEqual(server.calls, []); // ni lectura ni escritura
  });

  it('permiso revocado al guardar la resolución: no se da por guardada y los datos se conservan', async () => {
    const { server, phone, local } = await conflictScenario();
    server.revokeEditor(PET, USER);
    const outcome = await phone.engine.resolveConflict(PET, DATE, decide(local, 'local'));
    assert.equal(outcome, 'failed');
    const after = await phone.read();
    assert.equal(after.status, 'failed');
    assert.equal(after.error.kind, 'permission');
    assert.equal(after.pending.content.notes, 'mía');
    assert.notEqual(server.row(PET, DATE).notes, 'mía');
  });

  it('expulsado de la mascota: RLS oculta la fila (parece borrada) y volver a crearla tampoco se guarda', async () => {
    const { server, phone } = await conflictScenario();
    server.removeMember(PET, USER);
    await phone.engine.retry(PET, DATE); // vuelve a leer: ya no ve la fila
    const local = await phone.read();
    assert.deepEqual(local.conflict.remote, { status: 'absent' });

    const outcome = await phone.engine.resolveConflict(PET, DATE, decide(local, 'local'));
    assert.equal(outcome, 'failed');
    const after = await phone.read();
    assert.equal(after.error.kind, 'permission');
    assert.equal(after.pending.content.notes, 'mía');
    assert.equal(server.row(PET, DATE).notes, 'suya');
  });

  it('sin conexión no se puede comprobar el servidor: la resolución no cambia nada', async () => {
    const { server, phone, local } = await conflictScenario();
    phone.net.online = false;
    assert.equal(await phone.engine.resolveConflict(PET, DATE, decide(local, 'local')), 'unavailable');
    assert.deepEqual(await phone.read(), local);
    assert.equal(server.calls.length, 0);
  });

  it('red caída al enviar la resolución: queda pendiente en el dispositivo, no sincronizada', async () => {
    const { server, phone, local } = await conflictScenario();
    server.beforeNextSave(() => server.setOnline(false));
    const outcome = await phone.engine.resolveConflict(PET, DATE, decide(local, 'local'));
    assert.equal(outcome, 'pending');
    const after = await phone.read();
    assert.equal(after.status, 'pending');
    assert.equal(after.pending.content.notes, 'mía');
    // Con la red de vuelta se envía sola, con la versión sobre la que se resolvió.
    server.setOnline(true);
    await phone.advance(10 * 60_000);
    assert.equal((await phone.read()).status, 'synced');
    assert.equal(server.row(PET, DATE).notes, 'mía');
  });

  it('en un registro que ya no está en conflicto no hace nada', async () => {
    const server = serverWithPet();
    const phone = device(server);
    await phone.save({ notes: 'x' });
    assert.equal(
      await phone.engine.resolveConflict(PET, DATE, { action: 'save', content: content(), shownRemote: null }),
      'not_in_conflict'
    );
  });
});

describe('recuperación ante errores', () => {
  it('cierre durante una petición que no llegó al servidor: al reabrir se envía y queda sincronizado', async () => {
    const server = serverWithPet();
    const disk = new Map();
    const before = device(server, { disk, online: false });
    await before.save({ notes: 'en vuelo' });
    before.net.online = true;
    const release = server.holdNextSave();
    void before.engine.requestSync();
    await new Promise((resolve) => setImmediate(resolve));
    // La app se cierra con la petición en el aire.
    before.engine.stop();

    const after = device(server, { disk });
    await after.engine.requestSync();
    assert.equal((await after.read()).status, 'synced');
    assert.equal(server.row(PET, DATE).notes, 'en vuelo');

    // Si la petición antigua llegara después, chocaría con la precondición y no cambiaría nada.
    release();
    await before.engine.idle();
    assert.equal(server.rows.size, 1);
    assert.equal((await after.read()).status, 'synced');
  });

  it('cierre después de que el servidor confirme pero antes de guardar la respuesta: se reconcilia al reabrir', async () => {
    const server = serverWithPet();
    const disk = new Map();
    const memory = createMemoryStorage(disk);
    let closed = false;
    const storage = {
      ...memory,
      setItem: (key, value) => (closed ? Promise.reject(new Error('app cerrada')) : memory.setItem(key, value)),
    };
    const before = device(server, { disk, storage, online: false });
    await before.save({ notes: 'confirmada sin respuesta guardada' });
    closed = true;
    before.net.online = true;
    await before.engine.requestSync();
    assert.equal(server.rows.size, 1); // el servidor lo guardó
    assert.equal((await before.read()).status, 'pending'); // el dispositivo no llegó a enterarse
    before.engine.stop();

    const after = device(server, { disk });
    await after.engine.requestSync();
    const local = await after.read();
    assert.equal(local.status, 'synced');
    assert.equal(local.baseVersion, server.row(PET, DATE).updated_at);
    assert.equal(saves(server).length, 2); // reenvío → conflicto → lectura → mismo contenido
    assert.equal(server.row(PET, DATE).notes, 'confirmada sin respuesta guardada');
  });

  it('reanudación tras reinicio con un reintento programado', async () => {
    const server = serverWithPet();
    const disk = new Map();
    const before = device(server, { disk });
    server.setOnline(false);
    await before.save({ notes: 'reintentar' });
    const { nextAttemptAt } = (await before.read()).pending;
    assert.notEqual(nextAttemptAt, null);
    before.engine.stop();

    server.setOnline(true);
    const after = device(server, { disk });
    after.clock.now = nextAttemptAt;
    await after.engine.requestSync();
    assert.equal((await after.read()).status, 'synced');
  });

  it('tiempo agotado: cuenta como red, queda pendiente y la pasada termina', async () => {
    const hanging = {
      save: () => Promise.resolve({ ok: false, error: { name: 'TimeoutError', message: 'Request timed out' }, status: null }),
      fetch: () => Promise.resolve({ ok: true, data: null }),
    };
    const repository = createDailyLogRepository(createLocalStore(createMemoryStorage(), USER));
    const engine = createDailyLogSyncEngine({
      repository,
      remote: hanging,
      isOnline: () => true,
      now: () => 0,
      createOperationId: () => '00000000-0000-4000-8000-000000000001',
      ...noTimers,
    });
    engine.start();
    engine.setSessionUserId(USER);
    await engine.saveLocal({ petId: PET, logDate: DATE, content: content(), baseRow: null });
    await engine.idle();
    const local = await repository.read(PET, DATE);
    assert.equal(local.status, 'pending');
    assert.equal(local.error.kind, 'network');
    assert.equal(engine.getSyncingKey(), null);
  });

  it('un registro que falla una y otra vez no bloquea el resto de la cola', async () => {
    const server = serverWithPet();
    const phone = device(server, { online: false });
    await phone.engine.saveLocal({ petId: PET, logDate: '2026-10-13', content: content({ notes: 'atascado' }), baseRow: null });
    phone.clock.now += 1_000;
    await phone.engine.saveLocal({ petId: PET, logDate: '2026-10-14', content: content({ notes: 'detrás' }), baseRow: null });
    // Ese día siempre falla como si no hubiera red (p. ej. la petición nunca recibe respuesta).
    server.failForDate('2026-10-13', { ok: false, error: { name: 'TimeoutError', message: 't' }, status: null });
    phone.net.online = true;

    await phone.engine.requestSync(); // el más antiguo falla y detiene la pasada
    assert.equal((await phone.repository.read(PET, '2026-10-14')).status, 'pending');
    await phone.advance(60 * 60_000); // siguiente pasada: va primero el que no ha fallado
    assert.equal((await phone.repository.read(PET, '2026-10-14')).status, 'synced');
    assert.equal((await phone.repository.read(PET, '2026-10-13')).status, 'pending');
  });

  it('un 503 en un registro no impide enviar los demás en la misma pasada', async () => {
    const server = serverWithPet();
    const phone = device(server, { online: false });
    await phone.engine.saveLocal({ petId: PET, logDate: '2026-10-13', content: content(), baseRow: null });
    phone.clock.now += 1_000;
    await phone.engine.saveLocal({ petId: PET, logDate: '2026-10-14', content: content(), baseRow: null });
    server.failForDate('2026-10-13', { ok: false, status: 503, error: { message: 'Service Unavailable' } });
    phone.net.online = true;
    await phone.engine.requestSync();
    assert.equal((await phone.repository.read(PET, '2026-10-14')).status, 'synced');
  });

  it('error permanente de validación: no se reintenta solo; el reintento manual vuelve a enviar sin perder datos', async () => {
    const server = serverWithPet();
    const phone = device(server);
    const stop = server.failForDate(DATE, { ok: false, status: 400, error: { code: 'P0001', hint: 'log_date_too_old', message: '…' } });
    await phone.save({ notes: 'demasiado antigua' });
    let local = await phone.read();
    assert.equal(local.status, 'failed');
    assert.equal(local.error.reason, 'log_date_too_old');
    await phone.advance(24 * 60 * 60_000);
    assert.equal(saves(server).length, 1);

    await phone.engine.retry(PET, DATE); // sigue fallando: vuelve a `failed`, datos intactos
    local = await phone.read();
    assert.equal(local.status, 'failed');
    assert.equal(local.pending.content.notes, 'demasiado antigua');
    stop();
    await phone.engine.retry(PET, DATE);
    assert.equal((await phone.read()).status, 'synced');
  });

  it('reintentos agotados: queda fallida sin perder datos y el reintento manual la recupera', async () => {
    const server = serverWithPet();
    const phone = device(server);
    const stop = server.failForDate(DATE, { ok: false, status: 503, error: { message: 'Service Unavailable' } });
    await phone.save({ notes: 'no se pierde' });
    for (let attempt = 1; attempt < MAX_SYNC_ATTEMPTS; attempt += 1) await phone.advance(10 * 60_000);
    const failed = await phone.read();
    assert.equal(failed.status, 'failed');
    assert.equal(failed.pending.content.notes, 'no se pierde');
    stop();
    await phone.engine.retry(PET, DATE);
    assert.equal((await phone.read()).status, 'synced');
  });

  it('los conflictos y los errores de autorización no se reintentan a ciegas', async () => {
    const { server, phone } = await conflictScenario();
    await phone.advance(24 * 60 * 60_000);
    assert.equal(saves(server).length, 0);

    const other = serverWithPet();
    const tablet = device(other);
    other.failNext({ ok: false, status: 401, error: { code: 'PGRST303', message: 'JWT expired' } });
    await tablet.save({ notes: 'x' });
    assert.equal(tablet.timers.length, 0); // ningún reintento programado: espera a la sesión
    assert.equal(saves(other).length, 1);
  });
});

describe('createDailyLogRemote', () => {
  /** Cliente de Supabase mínimo: cada petición se resuelve con `respond(signal)`. */
  function fakeClient(respond) {
    const log = [];
    const builder = (kind) => {
      const chain = {
        signal: null,
        retry: (value) => (log.push(`${kind}.retry(${value})`), chain),
        abortSignal: (signal) => ((chain.signal = signal), chain),
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => chain,
        then: (resolve, reject) => respond(chain.signal).then(resolve, reject),
      };
      return chain;
    };
    return { log, rpc: () => builder('rpc'), from: () => builder('from') };
  }
  const row = { ...argsFor(), id: 'r1', pet_id: PET, log_date: DATE, logged_by: USER, last_edited_by: null, created_at: 'c', updated_at: 'u' };
  const serverRow = { id: 'r1', pet_id: PET, log_date: DATE, logged_by: USER, last_edited_by: null, ...content(), created_at: '2026-10-15T08:00:00.1+00:00', updated_at: '2026-10-15T09:00:00.25+00:00' };

  it('tiempo agotado: aborta la petición y devuelve un error de red sin estado HTTP', async () => {
    const client = fakeClient(
      (signal) =>
        new Promise((resolve) =>
          signal.addEventListener('abort', () =>
            resolve({ data: null, error: { message: 'AbortError: aborted', code: '' }, status: 0 })
          )
        )
    );
    const remote = createDailyLogRemote(client, { timeoutMs: 10 });
    const result = await remote.save({ ...argsFor(), p_expect_absent: true });
    assert.equal(result.ok, false);
    assert.equal(result.status, null);
    assert.equal(classifySyncError(result.error, result.status).kind, 'network');
    assert.deepEqual(client.log, ['rpc.retry(false)']); // sin reintentos propios de supabase-js
  });

  it('respuesta sin estado (fetch falló) → status null; respuesta HTTP → su estado', async () => {
    const offline = createDailyLogRemote(fakeClient(async () => ({ data: null, error: { message: 'TypeError: Network request failed', code: '' }, status: 0 })));
    assert.deepEqual(await offline.fetch(PET, DATE), {
      ok: false,
      error: { message: 'TypeError: Network request failed', code: '' },
      status: null,
    });
    const forbidden = createDailyLogRemote(fakeClient(async () => ({ data: null, error: { code: '42501' }, status: 403 })));
    assert.equal((await forbidden.save({ ...argsFor(), p_expect_absent: true })).status, 403);
  });

  it('una fila válida se devuelve; una respuesta que no es una fila no se toma por éxito', async () => {
    const ok = createDailyLogRemote(fakeClient(async () => ({ data: serverRow, error: null, status: 200 })));
    assert.deepEqual(await ok.save({ ...argsFor(), p_expect_absent: true }), { ok: true, data: serverRow });
    const broken = createDailyLogRemote(fakeClient(async () => ({ data: { ...row, energy_level: 'x' }, error: null, status: 200 })));
    const result = await broken.save({ ...argsFor(), p_expect_absent: true });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'invalid_response');
    const empty = createDailyLogRemote(fakeClient(async () => ({ data: null, error: null, status: 200 })));
    assert.deepEqual(await empty.fetch(PET, DATE), { ok: true, data: null });
  });

  it('si la petición lanza, no se propaga: error con status null', async () => {
    const remote = createDailyLogRemote(fakeClient(async () => {
      throw new TypeError('Failed to fetch');
    }));
    const result = await remote.fetch(PET, DATE);
    assert.equal(result.ok, false);
    assert.equal(result.status, null);
  });
});
