// Pruebas del motor de sincronización (`daily-log-sync-engine.ts`) con el almacén en memoria, un
// servidor falso con el contrato de `save_daily_log` y el QueryClient real de TanStack
// (`@tanstack/query-core`). `npm test`; ver frontend/CLAUDE.md.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, it } from 'node:test';

import { MutationObserver, QueryClient, onlineManager } from '@tanstack/query-core';

import { createLocalStore } from '../../../lib/local-store/local-store.ts';
import { createMemoryStorage } from '../../../lib/local-store/memory-storage.ts';
import { queryDefaultOptions } from '../../../lib/query-defaults.ts';
import { saveDailyLogMutationOptions } from './daily-log-cache.ts';
import { createDailyLogRepository } from './daily-log-repository.ts';
import { createDailyLogSyncEngine, syncKey } from './daily-log-sync-engine.ts';
import { createFakeServer } from './fake-daily-log-server.mjs';
import { MAX_SYNC_ATTEMPTS } from './sync-backoff.ts';
import {
  DATE,
  OTHER_USER,
  PET,
  T0,
  USER,
  argsFor,
  content,
  device,
  noTimers,
  saves,
  serverWithPet,
} from './sync-test-helpers.mjs';
import { connectSyncTriggers } from './sync-triggers.ts';


afterEach(() => onlineManager.setOnline(true));

describe('crear y editar sin conexión', () => {
  it('crear sin conexión: queda pendiente en el dispositivo y no se envía nada', async () => {
    const server = serverWithPet();
    const phone = device(server, { online: false });
    const saved = await phone.save({ notes: 'paseo' });
    await phone.engine.requestSync();

    assert.equal(saved.status, 'pending');
    assert.equal(saved.baseVersion, null);
    assert.equal((await phone.read()).pending.content.notes, 'paseo');
    assert.equal(server.calls.length, 0);
  });

  it('al volver la conexión se crea con p_expect_absent y queda sincronizado', async () => {
    const server = serverWithPet();
    const phone = device(server, { online: false });
    await phone.save({ notes: 'paseo' });

    phone.net.online = true;
    await phone.engine.requestSync();

    assert.equal(saves(server).length, 1);
    assert.equal(saves(server)[0].args.p_expect_absent, true);
    assert.equal('p_expected_updated_at' in saves(server)[0].args, false);
    const local = await phone.read();
    assert.equal(local.status, 'synced');
    assert.deepEqual(local.serverRow, server.row(PET, DATE));
  });

  it('editar sin conexión: se envía el updated_at exacto y la base no cambia hasta confirmar', async () => {
    const server = serverWithPet();
    const original = server.writeAsOther(USER, argsFor({ energy_level: 2 }));
    const phone = device(server, { online: false });
    await phone.repository.refreshSnapshot(PET, DATE, original);

    await phone.save({ energy_level: 5 }, original);
    await phone.save({ energy_level: 4 }, original);
    let local = await phone.read();
    assert.equal(local.baseVersion, original.updated_at);
    assert.equal(local.serverRow.updated_at, original.updated_at);

    phone.net.online = true;
    await phone.engine.requestSync();
    const [call] = saves(server);
    assert.equal(call.args.p_expected_updated_at, original.updated_at);
    assert.match(call.args.p_expected_updated_at, /\.\d{1,6}\+00:00$/);
    assert.equal(call.args.p_energy_level, 4);
    assert.equal(call.args.p_expect_absent, undefined);

    local = await phone.read();
    assert.equal(local.status, 'synced');
    assert.equal(local.baseVersion, server.row(PET, DATE).updated_at);
    assert.notEqual(local.baseVersion, original.updated_at);
  });

  it('nunca llama a la RPC sin precondición', async () => {
    const server = serverWithPet();
    const phone = device(server);
    await phone.save({ notes: 'uno' });
    await phone.engine.requestSync();
    await phone.save({ notes: 'dos' }, (await phone.read()).serverRow);
    await phone.engine.requestSync();
    for (const call of saves(server)) {
      assert.ok(call.args.p_expect_absent === true || typeof call.args.p_expected_updated_at === 'string');
    }
    assert.equal(server.row(PET, DATE).notes, 'dos');
  });
});

describe('persistencia entre arranques', () => {
  it('cerrar y volver a abrir la app con operaciones pendientes: se sincronizan al abrir', async () => {
    const server = serverWithPet();
    const disk = new Map();
    const before = device(server, { disk, online: false });
    await before.save({ mood_level: 5, notes: 'antes de cerrar' });
    before.engine.stop();

    const after = device(server, { disk, online: true });
    assert.equal((await after.read()).status, 'pending');
    await after.engine.requestSync();

    assert.equal(saves(server).length, 1);
    assert.equal(server.row(PET, DATE).notes, 'antes de cerrar');
    assert.equal((await after.read()).status, 'synced');
  });

  it('el identificador de operación se conserva al reabrir y en los reintentos', async () => {
    const server = serverWithPet();
    const disk = new Map();
    const before = device(server, { disk, online: true });
    server.setOnline(false);
    await before.save({ notes: 'x' });
    await before.engine.requestSync();
    const { operationId } = (await before.read()).pending;
    assert.equal(before.ids.count, 1);

    const after = device(server, { disk });
    await after.advance(60_000);
    assert.equal((await after.read()).pending.operationId, operationId);
    assert.equal(after.ids.count, 0);
  });
});

describe('conectividad y una sola pasada', () => {
  it('sincroniza al recuperar la conectividad (onlineManager)', async () => {
    const server = serverWithPet();
    onlineManager.setOnline(false);
    const repository = createDailyLogRepository(createLocalStore(createMemoryStorage(), USER));
    const engine = createDailyLogSyncEngine({
      repository,
      remote: server.remoteFor(USER),
      isOnline: () => onlineManager.isOnline(),
      now: () => T0,
      createOperationId: randomUUID,
      // Sin temporizadores reales: ninguna espera de backoff mantiene vivo el proceso de pruebas.
      ...noTimers,
    });
    engine.start();
    engine.setSessionUserId(USER);
    const foreground = new Set();
    const disconnect = connectSyncTriggers(engine.requestSync, {
      subscribeOnline: (listener) => onlineManager.subscribe(listener),
      subscribeForeground: (listener) => {
        foreground.add(listener);
        return () => foreground.delete(listener);
      },
    });

    await engine.saveLocal({ petId: PET, logDate: DATE, content: content(), baseRow: null });
    await engine.requestSync();
    assert.equal(saves(server).length, 0);

    onlineManager.setOnline(true);
    await engine.requestSync();
    assert.equal(saves(server).length, 1);
    assert.equal((await repository.read(PET, DATE)).status, 'synced');

    // Volver a primer plano pide otra pasada, que no tiene nada que enviar.
    for (const listener of foreground) listener();
    await engine.requestSync();
    assert.equal(saves(server).length, 1);

    disconnect();
    assert.equal(foreground.size, 0);
  });

  it('muchos disparadores a la vez dan una sola pasada y un solo envío', async () => {
    const server = serverWithPet();
    const phone = device(server, { online: false });
    await phone.save({ notes: 'una vez' });
    phone.net.online = true;

    await Promise.all([
      phone.engine.requestSync(),
      phone.engine.requestSync(),
      phone.engine.requestSync(),
      phone.engine.requestSync(),
    ]);
    assert.equal(saves(server).length, 1);
  });

  it('procesa una operación detrás de otra, la más antigua primero', async () => {
    const server = serverWithPet();
    const phone = device(server, { online: false });
    await phone.engine.saveLocal({ petId: PET, logDate: '2026-10-14', content: content(), baseRow: null });
    phone.clock.now += 1_000;
    await phone.engine.saveLocal({ petId: PET, logDate: '2026-10-15', content: content(), baseRow: null });
    phone.net.online = true;

    const release = server.holdNextSave();
    const pass = phone.engine.requestSync();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(saves(server).length, 1);
    assert.equal(phone.engine.getSyncingKey(), syncKey(PET, '2026-10-14'));
    release();
    await pass;
    assert.deepEqual(
      saves(server).map((call) => call.args.p_log_date),
      ['2026-10-14', '2026-10-15']
    );
    assert.equal(phone.engine.getSyncingKey(), null);
  });

  it('un fallo de red programa el siguiente intento con backoff y lo ejecuta al vencer', async () => {
    const server = serverWithPet();
    const phone = device(server);
    server.setOnline(false);
    await phone.save();
    await phone.engine.requestSync();
    const local = await phone.read();
    assert.equal(local.status, 'pending');
    assert.equal(local.error.kind, 'network');
    assert.equal(phone.timers.length, 1);
    assert.equal(phone.timers[0].at, local.pending.nextAttemptAt);

    server.setOnline(true);
    await phone.advance(local.pending.nextAttemptAt - phone.clock.now);
    assert.equal((await phone.read()).status, 'synced');
  });
});

describe('la pasada se detiene sin red o sin sesión', () => {
  it('un fallo de red detiene la pasada: no se intentan los demás registros', async () => {
    const server = serverWithPet();
    const phone = device(server, { online: false });
    await phone.engine.saveLocal({ petId: PET, logDate: '2026-10-13', content: content(), baseRow: null });
    await phone.engine.saveLocal({ petId: PET, logDate: '2026-10-14', content: content(), baseRow: null });
    phone.net.online = true;
    server.setOnline(false); // la señal dice que hay red, pero el servidor no responde

    await phone.engine.requestSync();
    assert.equal(saves(server).length, 1);
    assert.equal((await phone.repository.read(PET, '2026-10-14')).pending.attempts, 0);
  });

  it('un 401 detiene la pasada: no se intentan los demás registros', async () => {
    const server = serverWithPet();
    const phone = device(server, { online: false });
    await phone.engine.saveLocal({ petId: PET, logDate: '2026-10-13', content: content(), baseRow: null });
    await phone.engine.saveLocal({ petId: PET, logDate: '2026-10-14', content: content(), baseRow: null });
    phone.net.online = true;
    server.failNext({ ok: false, status: 401, error: { code: 'PGRST303', message: 'JWT expired' } });

    await phone.engine.requestSync();
    assert.equal(saves(server).length, 1);
  });
});

describe('TanStack no envía nada por su cuenta', () => {
  it('web sin conexión: el guardado no queda en pausa, se guarda en local y no se reenvía al reconectar', async () => {
    const server = serverWithPet();
    onlineManager.setOnline(false);
    const client = new QueryClient({ defaultOptions: queryDefaultOptions('web') });
    client.mount();
    const repository = createDailyLogRepository(createLocalStore(createMemoryStorage(), USER));
    const engine = createDailyLogSyncEngine({
      repository,
      remote: server.remoteFor(USER),
      isOnline: () => onlineManager.isOnline(),
      now: () => T0,
      createOperationId: randomUUID,
      // Sin temporizadores reales: ninguna espera de backoff mantiene vivo el proceso de pruebas.
      ...noTimers,
    });
    engine.start();
    engine.setSessionUserId(USER);
    let localSaves = 0;
    const options = saveDailyLogMutationOptions((input) => {
      localSaves += 1;
      return engine.saveLocal(input);
    });
    const mutation = new MutationObserver(client, options);

    const saved = await mutation.mutate({ petId: PET, logDate: DATE, content: content(), baseRow: null });
    assert.equal(saved.status, 'pending');
    assert.equal(mutation.getCurrentResult().isPaused, false);
    assert.equal(server.calls.length, 0);

    // Al reconectar, TanStack no repite la mutación; envía el motor, una vez.
    onlineManager.setOnline(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(localSaves, 1);
    assert.equal(server.calls.length, 0);
    await engine.requestSync();
    assert.equal(saves(server).length, 1);

    client.unmount();
  });
});

describe('conflictos', () => {
  it('creación concurrente con contenido distinto: conflicto con la fila remota y la edición local intacta', async () => {
    const server = serverWithPet();
    const phone = device(server, { online: false });
    await phone.save({ notes: 'desde el móvil' });
    server.writeAsOther(OTHER_USER, argsFor({ notes: 'desde la web' }));

    phone.net.online = true;
    await phone.engine.requestSync();
    const local = await phone.read();
    assert.equal(local.status, 'conflict');
    assert.equal(local.conflict.detail, 'row_exists');
    assert.equal(local.conflict.remote.status, 'present');
    assert.equal(local.conflict.remote.row.notes, 'desde la web');
    assert.equal(local.pending.content.notes, 'desde el móvil');
    assert.equal(local.baseVersion, null);
    assert.equal(server.row(PET, DATE).notes, 'desde la web');

    // No se reintenta como si fuera red.
    await phone.advance(24 * 60 * 60_000);
    assert.equal(saves(server).length, 1);
  });

  it('creación concurrente con el mismo contenido: queda sincronizado sin volver a enviar', async () => {
    const server = serverWithPet();
    const phone = device(server, { online: false });
    await phone.save({ notes: 'igual' });
    const remote = server.writeAsOther(USER, argsFor({ notes: 'igual ' }));

    phone.net.online = true;
    await phone.engine.requestSync();
    const local = await phone.read();
    assert.equal(local.status, 'synced');
    assert.equal(local.baseVersion, remote.updated_at);
    assert.equal(saves(server).length, 1);
  });

  it('conflicto de versión: otro dispositivo cambió el registro; se conserva la edición local', async () => {
    const server = serverWithPet();
    const original = server.writeAsOther(USER, argsFor({ energy_level: 3 }));
    const phone = device(server, { online: false });
    await phone.save({ energy_level: 5, notes: 'mía' }, original);
    server.writeAsOther(OTHER_USER, argsFor({ energy_level: 1 }));

    phone.net.online = true;
    await phone.engine.requestSync();
    const local = await phone.read();
    assert.equal(local.status, 'conflict');
    assert.equal(local.conflict.detail, 'version_mismatch');
    assert.equal(local.conflict.remote.row.energy_level, 1);
    assert.equal(local.pending.content.energy_level, 5);
    assert.equal(local.baseVersion, original.updated_at);
    assert.equal(server.row(PET, DATE).energy_level, 1);

    // Editar en conflicto lo conserva y sigue en conflicto, sin enviar.
    await phone.save({ energy_level: 4, notes: 'mía' }, original);
    await phone.engine.requestSync();
    assert.equal((await phone.read()).status, 'conflict');
    assert.equal(saves(server).length, 1);
  });

  it('«Reintentar» en conflicto vuelve a comparar con el servidor', async () => {
    const server = serverWithPet();
    const original = server.writeAsOther(USER, argsFor({ energy_level: 3 }));
    const phone = device(server);
    server.writeAsOther(OTHER_USER, argsFor({ energy_level: 1 }));
    await phone.save({ energy_level: 5 }, original);
    await phone.engine.requestSync();
    assert.equal((await phone.read()).status, 'conflict');

    // El otro dispositivo acaba guardando lo mismo que este: ya no hay conflicto.
    server.writeAsOther(OTHER_USER, argsFor({ energy_level: 5 }));
    await phone.engine.retry(PET, DATE);
    assert.equal((await phone.read()).status, 'synced');
    assert.equal(saves(server).length, 1);
  });

  it('el registro se borró en el servidor: conflicto sin recrearlo solo', async () => {
    const server = serverWithPet();
    const original = server.writeAsOther(USER, argsFor());
    const phone = device(server, { online: false });
    await phone.save({ notes: 'editado sin red' }, original);
    server.rows.clear();

    phone.net.online = true;
    await phone.engine.requestSync();
    const local = await phone.read();
    assert.equal(local.status, 'conflict');
    assert.equal(local.conflict.detail, 'row_missing');
    assert.deepEqual(local.conflict.remote, { status: 'absent' });
    assert.equal(server.rows.size, 0);
  });

  it('si no se puede leer la fila remota, el conflicto espera y se vuelve a leer más tarde', async () => {
    const server = serverWithPet();
    const original = server.writeAsOther(USER, argsFor());
    const phone = device(server, { online: false });
    server.writeAsOther(OTHER_USER, argsFor({ notes: 'otro' }));
    await phone.save({ notes: 'mío' }, original);

    const realFetch = server.remoteFor;
    let first = true;
    phone.engine.stop();
    const flaky = {
      ...realFetch(USER),
      fetch: async (...args) => {
        if (first) {
          first = false;
          return { ok: false, error: { message: 'TypeError: Network request failed', code: '' }, status: null };
        }
        return realFetch(USER).fetch(...args);
      },
    };
    const engine = createDailyLogSyncEngine({
      repository: phone.repository,
      remote: flaky,
      isOnline: () => true,
      now: () => T0,
      createOperationId: randomUUID,
      // Sin temporizadores reales: ninguna espera de backoff mantiene vivo el proceso de pruebas.
      ...noTimers,
    });
    engine.start();
    engine.setSessionUserId(USER);
    await engine.requestSync();
    assert.deepEqual((await phone.read()).conflict.remote, { status: 'not_fetched' });

    await engine.requestSync();
    const local = await phone.read();
    assert.equal(local.conflict.remote.status, 'present');
    assert.equal(local.conflict.remote.row.notes, 'otro');
  });
});

describe('respuesta perdida', () => {
  it('se guardó pero no llegó la respuesta: al reintentar se lee la fila y, si coincide, queda sincronizado', async () => {
    const server = serverWithPet();
    const original = server.writeAsOther(USER, argsFor({ energy_level: 2 }));
    const phone = device(server);
    await phone.repository.refreshSnapshot(PET, DATE, original);
    server.dropNextResponse();

    await phone.save({ energy_level: 5, notes: 'enviado' }, original);
    let local = await phone.read();
    // Un error sin respuesta nunca es una confirmación.
    assert.equal(local.status, 'pending');
    assert.equal(local.error.kind, 'network');
    assert.equal(local.baseVersion, original.updated_at);
    assert.equal(server.row(PET, DATE).notes, 'enviado');

    await phone.advance(10 * 60_000);
    local = await phone.read();
    assert.equal(local.status, 'synced');
    assert.equal(local.baseVersion, server.row(PET, DATE).updated_at);
    // Segundo envío con la versión antigua → conflicto → lectura → mismo contenido. Nada se escribe dos veces.
    assert.deepEqual(
      server.calls.map((call) => call.type),
      ['save', 'save', 'fetch']
    );
    assert.equal(server.row(PET, DATE).updated_at, local.serverRow.updated_at);
  });

  it('creación cuya respuesta se pierde: el reintento recibe row_exists y reconcilia', async () => {
    const server = serverWithPet();
    const phone = device(server);
    server.dropNextResponse();
    await phone.save({ notes: 'nuevo' });
    assert.equal((await phone.read()).status, 'pending');

    await phone.advance(10 * 60_000);
    assert.equal((await phone.read()).status, 'synced');
    assert.equal(server.rows.size, 1);
  });

  it('si mientras tanto el servidor tiene otra cosa, conflicto con los datos locales', async () => {
    const server = serverWithPet();
    const phone = device(server);
    server.dropNextResponse();
    await phone.save({ notes: 'mío' });
    server.writeAsOther(OTHER_USER, argsFor({ notes: 'de otro, después' }));

    await phone.advance(10 * 60_000);
    const local = await phone.read();
    assert.equal(local.status, 'conflict');
    assert.equal(local.pending.content.notes, 'mío');
  });

  it('un error genérico de la RPC no se toma por éxito: sigue pendiente', async () => {
    const server = serverWithPet();
    const phone = device(server);
    server.failNext({ ok: false, status: 500, error: { code: 'XX000', message: 'boom' } });
    await phone.save({ notes: 'x' });
    const local = await phone.read();
    assert.equal(local.status, 'pending');
    assert.equal(local.error.kind, 'server');
    assert.equal(server.rows.size, 0);
  });
});

describe('cola local', () => {
  it('edición repetida: una operación por registro, sin duplicados, y se envía solo lo último', async () => {
    const server = serverWithPet();
    const disk = new Map();
    const phone = device(server, { disk, online: false });
    await phone.save({ energy_level: 1 });
    await phone.save({ energy_level: 2 });
    await phone.save({ energy_level: 4, notes: 'final' });

    assert.equal(disk.size, 1);
    assert.equal(phone.ids.count, 1);
    const local = await phone.read();
    assert.equal(local.pending.revision, 3);

    phone.net.online = true;
    await phone.engine.requestSync();
    assert.equal(saves(server).length, 1);
    assert.equal(saves(server)[0].args.p_energy_level, 4);
  });

  it('una edición durante el envío no se pierde: se envía después sobre la fila nueva', async () => {
    const server = serverWithPet();
    const phone = device(server, { online: false });
    await phone.save({ notes: 'primera' });
    phone.net.online = true;

    const release = server.holdNextSave();
    const pass = phone.engine.requestSync();
    await new Promise((resolve) => setImmediate(resolve));
    await phone.engine.saveLocal({ petId: PET, logDate: DATE, content: content({ notes: 'segunda' }), baseRow: null });
    release();
    await pass;
    await phone.engine.requestSync();

    assert.equal(saves(server).length, 2);
    // La segunda va sobre la fila que creó la primera.
    assert.equal(saves(server)[0].args.p_expect_absent, true);
    assert.equal(typeof saves(server)[1].args.p_expected_updated_at, 'string');
    assert.equal(server.row(PET, DATE).notes, 'segunda');
    assert.equal((await phone.read()).status, 'synced');
  });

  it('las escrituras locales simultáneas no se pisan', async () => {
    const server = serverWithPet();
    const phone = device(server, { online: false });
    await Promise.all([
      phone.engine.saveLocal({ petId: PET, logDate: '2026-10-13', content: content(), baseRow: null }),
      phone.engine.saveLocal({ petId: PET, logDate: '2026-10-14', content: content(), baseRow: null }),
      phone.save({ notes: 'a' }),
      phone.save({ notes: 'b' }),
    ]);
    const all = await phone.repository.list();
    assert.equal(all.length, 3);
    assert.equal((await phone.read()).pending.revision, 2);
  });
});

describe('errores permanentes, sesión y usuario', () => {
  it('sin permiso: falla, no se reintenta sola y conserva los datos; «Reintentar» vuelve a enviar', async () => {
    const server = createFakeServer(); // nadie puede editar la mascota
    const phone = device(server);
    await phone.save({ notes: 'sin permiso' });
    let local = await phone.read();
    assert.equal(local.status, 'failed');
    assert.equal(local.error.kind, 'permission');
    assert.equal(local.pending.content.notes, 'sin permiso');

    await phone.advance(24 * 60 * 60_000);
    assert.equal(saves(server).length, 1);

    // Corregida la causa (vuelve a ser editor), el usuario reintenta.
    server.allowEditor(PET, USER);
    await phone.engine.retry(PET, DATE);
    local = await phone.read();
    assert.equal(local.status, 'synced');
    assert.equal(saves(server).length, 2);
  });

  it('errores del servidor: se reintentan con límite y quedan fallidos sin perder datos', async () => {
    const server = serverWithPet();
    const phone = device(server);
    for (let attempt = 0; attempt < MAX_SYNC_ATTEMPTS; attempt += 1) {
      server.failNext({ ok: false, status: 503, error: { message: 'Service Unavailable' } });
      if (attempt === 0) await phone.save({ notes: 'resiste' });
      else await phone.advance(10 * 60_000);
    }
    const local = await phone.read();
    assert.equal(local.status, 'failed');
    assert.equal(local.pending.content.notes, 'resiste');
    assert.equal(saves(server).length, MAX_SYNC_ATTEMPTS);
  });

  it('sesión ausente: guarda en local pero no envía; al haber sesión, envía', async () => {
    const server = serverWithPet();
    const phone = device(server, { session: null });
    await phone.save({ notes: 'sin sesión' });
    await phone.engine.requestSync();
    assert.equal(server.calls.length, 0);
    assert.equal((await phone.read()).status, 'pending');

    phone.engine.setSessionUserId(USER);
    await phone.engine.requestSync();
    assert.equal(saves(server).length, 1);
  });

  it('sesión caducada (401): se espera sin gastar intentos y sin bucle', async () => {
    const server = serverWithPet();
    const phone = device(server);
    server.failNext({ ok: false, status: 401, error: { code: 'PGRST303', message: 'JWT expired' } });
    await phone.engine.saveLocal({ petId: PET, logDate: DATE, content: content(), baseRow: null });
    await phone.engine.idle(); // la pasada que disparó el guardado
    const local = await phone.read();
    assert.equal(local.status, 'pending');
    assert.equal(local.error.kind, 'auth');
    assert.equal(local.pending.attempts, 0);
    assert.equal(local.pending.nextAttemptAt, null);
    assert.equal(saves(server).length, 1);
    assert.equal(phone.timers.length, 0); // ningún reintento programado: espera a la sesión

    // Otra pasada con la misma sesión (primer plano, red) no reenvía: el token sigue sin valer.
    await phone.engine.requestSync();
    assert.equal(saves(server).length, 1);

    // Sesión renovada → otra pasada → se envía.
    phone.engine.setSessionUserId(USER);
    await phone.engine.requestSync();
    assert.equal((await phone.read()).status, 'synced');
    assert.equal(saves(server).length, 2);
  });

  it('cambio de usuario: la sesión de otro usuario nunca envía las operaciones de este', async () => {
    const server = serverWithPet();
    server.allowEditor(PET, OTHER_USER);
    const disk = new Map();
    const phoneA = device(server, { disk, online: false });
    await phoneA.save({ notes: 'de A' });

    phoneA.net.online = true;
    phoneA.engine.setSessionUserId(OTHER_USER);
    await phoneA.engine.requestSync();
    assert.equal(server.calls.length, 0);

    // El almacén de B, en el mismo dispositivo, no ve lo de A.
    const phoneB = device(server, { userId: OTHER_USER, disk });
    assert.deepEqual(await phoneB.repository.list(), []);
    await phoneB.engine.requestSync();
    assert.equal(server.calls.length, 0);

    phoneA.engine.setSessionUserId(USER);
    await phoneA.engine.requestSync();
    assert.equal(saves(server).length, 1);
    assert.equal(saves(server)[0].userId, USER);
  });

  it('parado no envía nada', async () => {
    const server = serverWithPet();
    const phone = device(server, { online: false });
    await phone.save();
    phone.engine.stop();
    phone.net.online = true;
    await phone.engine.requestSync();
    assert.equal(server.calls.length, 0);
  });
});
