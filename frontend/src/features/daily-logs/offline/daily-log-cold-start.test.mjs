// Fase 6: arranque en frío sin conexión y recuperación (`npm test`). Cada `boot` es la app abierta
// desde cero sobre el mismo disco (sesión de Supabase + almacén local): controlador de sesión real con
// el `supabase.auth` falso, sesiones de sincronización por usuario como en el proveedor, motor y
// `createDailyLogRemote` reales (token del dueño) y el servidor falso de `save_daily_log`.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { QueryClient } from '@tanstack/query-core';

import { createAuthSessionController } from '../../auth/auth-session-controller.ts';
import { authUserId } from '../../auth/auth-state.ts';
import { createFakeSupabaseAuth, makeSession } from '../../auth/fake-supabase-auth.mjs';
import { createOwnerAccessToken } from '../../auth/owner-session.ts';
import { createLocalStore } from '../../../lib/local-store/local-store.ts';
import { createMemoryStorage } from '../../../lib/local-store/memory-storage.ts';
import { SessionUnavailableError } from '../../../lib/user-token-fetch.ts';
import { applyLocalChangeToCache, ownerScopedSnapshots, readDailyLogThroughRepository, summarizeUnsynced } from './daily-log-cache.ts';
import { createDailyLogRemote } from './daily-log-remote.ts';
import { createDailyLogRepository } from './daily-log-repository.ts';
import { createDailyLogSyncEngine } from './daily-log-sync-engine.ts';
import { createDailyLogSyncSessions } from './daily-log-sync-sessions.ts';
import { groupDeviceLogsByPet } from './daily-log-view.ts';
import { createFakeServer } from './fake-daily-log-server.mjs';
import { argsFor, content, DATE, OTHER_USER, PET, USER } from './sync-test-helpers.mjs';

const A = USER;
const B = OTHER_USER;
const KEY = 'sb-test-auth-token';
const DAY_2 = '2026-10-14';
const OTHER_PET = 'b0000000-0000-4000-8000-000000000002';
const HOUR = 3600_000;

const tick = async (n = 10) => {
  for (let i = 0; i < n; i += 1) await new Promise((resolve) => setImmediate(resolve));
};
const subjectOf = (authorization) =>
  authorization ? JSON.parse(Buffer.from(authorization.split(' ')[1].split('.')[1], 'base64url').toString()).sub : null;

function serverWithPets() {
  const server = createFakeServer();
  server.allowEditor(PET, A);
  server.allowEditor(OTHER_PET, A);
  server.allowEditor(PET, B);
  return server;
}

/**
 * Cliente de datos falso (PostgREST): actúa como el usuario del token de la cabecera. Sin token de
 * usuario, la guardia de `user-token-fetch.ts` no deja salir la petición. Sin red, error de red.
 */
function dataClient(server, net, requests) {
  const builder = (run) => {
    const chain = {
      headers: {},
      filters: {},
      setHeader: (name, value) => ((chain.headers[name] = value), chain),
      retry: () => chain,
      abortSignal: () => chain,
      select: () => chain,
      eq: (column, value) => ((chain.filters[column] = value), chain),
      maybeSingle: () => chain,
      then: (resolve, reject) => {
        const userId = subjectOf(chain.headers.Authorization);
        if (!userId) return Promise.reject(new SessionUnavailableError()).then(resolve, reject);
        if (!net.online) {
          return Promise.resolve({ data: null, error: { message: 'TypeError: Network request failed', code: '' }, status: 0 }).then(resolve, reject);
        }
        return run(userId, chain)
          .then((result) => (result.ok ? { data: result.data, error: null, status: 200 } : { data: null, error: result.error, status: result.status ?? 0 }))
          .then(resolve, reject);
      },
    };
    return chain;
  };
  return {
    rpc: (name, args) =>
      builder((userId) => {
        requests.push({ type: 'save', userId, args });
        return server.remoteFor(userId).save(args);
      }),
    from: () =>
      builder((userId, chain) => {
        requests.push({ type: 'fetch', userId });
        return server.remoteFor(userId).fetch(chain.filters.pet_id, chain.filters.log_date);
      }),
  };
}

/** La app arrancada desde cero sobre `disk`, a la hora `now`, con o sin red. */
function boot(server, { disk, now, online, hang = false }) {
  const clock = { now };
  const net = { online, hang };
  const requests = [];
  const auth = createFakeSupabaseAuth({ disk, key: KEY, clock, net });
  const client = dataClient(server, net, requests);
  const queryClient = new QueryClient();
  const timers = [];
  const setTimer = (callback, ms) => {
    const timer = { callback, at: clock.now + ms };
    timers.push(timer);
    return timer;
  };
  const clearTimer = (timer) => {
    const index = timers.indexOf(timer);
    if (index >= 0) timers.splice(index, 1);
  };
  const online$ = new Set();
  const controller = createAuthSessionController({
    auth,
    storage: auth.storage,
    storageKey: KEY,
    subscribeOnline: (listener) => (online$.add(listener), () => online$.delete(listener)),
    setTimer,
    clearTimer,
  });
  const sessions = createDailyLogSyncSessions((userId) => {
    const repository = createDailyLogRepository(createLocalStore(createMemoryStorage(disk), userId));
    const engine = createDailyLogSyncEngine({
      repository,
      remote: createDailyLogRemote(client, { accessToken: createOwnerAccessToken(auth, userId) }),
      isOnline: () => net.online,
      now: () => clock.now,
      createOperationId: randomUUID,
      random: () => 0.5,
      setTimer,
      clearTimer,
    });
    return { userId, repository, engine };
  });

  // Lo que hacen AuthProvider y DailyLogSyncProvider con cada cambio de la sesión.
  let mounted = null;
  controller.subscribe((state, previous) => {
    const userId = authUserId(state);
    if (authUserId(previous) !== null && authUserId(previous) !== userId) queryClient.clear();
    if (mounted && mounted.userId !== userId) {
      mounted.unsubscribe();
      sessions.deactivate(mounted.userId);
      mounted = null;
    }
    if (userId && !mounted) {
      const session = sessions.activate(userId);
      const unsubscribe = session.repository.subscribe((change) => {
        if (controller.isCurrentUser(userId)) applyLocalChangeToCache(queryClient, userId, change);
      });
      mounted = { userId, unsubscribe, ...session };
    }
    if (mounted) {
      mounted.engine.setSessionUserId(state.status === 'signed_in' ? userId : null);
      if (state.status === 'signed_in') void mounted.engine.requestSync();
    }
  });
  const stop = controller.start();

  return {
    clock,
    net,
    auth,
    requests,
    controller,
    queryClient,
    sessions,
    stop,
    state: () => controller.getState(),
    /** Zona autenticada montada (almacén y motor del usuario identificado). */
    zone: () => mounted,
    async advance(ms) {
      clock.now += ms;
      for (const timer of timers.filter((item) => item.at <= clock.now)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.callback();
      }
      await tick();
    },
    async goOnline() {
      net.online = true;
      for (const listener of online$) listener(true);
      await tick(20);
      // Disparador del motor al recuperar la conectividad (`sync-triggers.ts`).
      await mounted?.engine.requestSync();
      await mounted?.engine.idle();
    },
  };
}

const T0 = Date.UTC(2026, 9, 15, 10, 0, 0);
const save = (zone, overrides = {}, { petId = PET, logDate = DATE, baseRow = null } = {}) =>
  zone.engine.saveLocal({ petId, logDate, content: content(overrides), baseRow });
const saves = (app) => app.requests.filter((request) => request.type === 'save');

/** Día 1: con red, A entra y guarda sin conexión; la app se cierra. */
async function dayOne(server, disk, prepare) {
  const app = boot(server, { disk, now: T0, online: true });
  await tick();
  await app.auth.signIn(A);
  await tick();
  app.net.online = false;
  await prepare(app.zone(), app);
  app.stop();
  return app;
}

describe('arranque en frío sin conexión', () => {
  it('1/5/12. con sesión guardada y token caducado: abre los datos de A, no envía nada y sincroniza al volver la red', async () => {
    const server = serverWithPets();
    const disk = new Map();
    await dayOne(server, disk, (zone) => save(zone, { notes: 'del día anterior' }));

    // Dos horas después, sin red: el token de acceso ha caducado y no se puede renovar.
    const app = boot(server, { disk, now: T0 + 2 * HOUR, online: false });
    await tick();
    assert.equal(app.state().status, 'offline');
    const zone = app.zone();
    assert.equal(zone.userId, A);
    const records = await zone.repository.list();
    assert.deepEqual(summarizeUnsynced(records), { pending: 1, failed: 0, conflict: 0 });
    assert.equal(records[0].pending.content.notes, 'del día anterior');
    assert.deepEqual(groupDeviceLogsByPet(records), [{ petId: PET, count: 1, latestDate: DATE }]);

    // 12. Sin sesión utilizable no sale nada, aunque se pida (ni el intento del cierre de sesión).
    await zone.engine.requestSync();
    assert.deepEqual(await zone.engine.syncNow({ timeoutMs: 15_000 }), { status: 'unavailable', reason: 'session' });
    assert.deepEqual(app.requests, []);

    // 8. Vuelve la red: se renueva la sesión y solo entonces se envía, con precondición y como A.
    await app.goOnline();
    assert.equal(app.state().status, 'signed_in');
    assert.equal((await zone.repository.read(PET, DATE)).status, 'synced');
    assert.equal(server.row(PET, DATE).logged_by, A);
    assert.deepEqual(saves(app).map((request) => [request.userId, request.args.p_expect_absent]), [[A, true]]);
  });

  it('2. sin sesión guardada: login, sin almacén abierto (aunque haya datos de otras cuentas en el disco)', async () => {
    const server = serverWithPets();
    const disk = new Map();
    const first = await dayOne(server, disk, (zone) => save(zone, { notes: 'de A' }));
    await first.controller.signOut(); // sin red: se quita del dispositivo
    const app = boot(server, { disk, now: T0 + HOUR, online: false });
    await tick();
    assert.equal(app.state().status, 'signed_out');
    assert.equal(app.zone(), null);
    assert.ok([...disk.keys()].some((key) => key.startsWith(`kitom:v1:${A}:`))); // conservado, oculto
  });

  it('6. reinicio con un conflicto sin resolver: se ve, se puede descartar sin conexión y nunca se reenvía solo', async () => {
    const server = serverWithPets();
    const disk = new Map();
    await dayOne(server, disk, async (zone, app) => {
      await save(zone, { notes: 'mía' });
      server.writeAsOther(B, argsFor({ notes: 'de B' }));
      app.net.online = true;
      await zone.engine.requestSync(); // conflicto row_exists → se lee la fila de B
      app.net.online = false;
    });
    const app = boot(server, { disk, now: T0 + 2 * HOUR, online: false });
    await tick();
    const zone = app.zone();
    const conflict = await zone.repository.read(PET, DATE);
    assert.equal(conflict.status, 'conflict');
    assert.equal(conflict.conflict.remote.row.notes, 'de B');

    await app.goOnline();
    await zone.engine.requestSync();
    assert.deepEqual(saves(app), []); // un conflicto no se reintenta solo
    assert.equal((await zone.repository.read(PET, DATE)).status, 'conflict');

    app.net.online = false;
    assert.equal(await zone.engine.discardLocalChanges(PET, DATE), 'discarded');
    assert.equal((await zone.repository.read(PET, DATE)).serverRow.notes, 'de B');
    assert.deepEqual(saves(app), []);
  });

  it('7. reinicio con un error de sincronización (sin permiso): sigue fallido, con sus datos, y no se reintenta solo', async () => {
    const server = serverWithPets();
    const disk = new Map();
    await dayOne(server, disk, async (zone, app) => {
      await save(zone, { notes: 'sin permiso' }, { petId: OTHER_PET, logDate: DAY_2 });
      server.revokeEditor(OTHER_PET, A);
      app.net.online = true;
      await zone.engine.requestSync();
      app.net.online = false;
    });
    const app = boot(server, { disk, now: T0 + 2 * HOUR, online: false });
    await tick();
    const zone = app.zone();
    assert.equal((await zone.repository.read(OTHER_PET, DAY_2)).status, 'failed');
    await app.goOnline();
    await zone.engine.requestSync();
    assert.deepEqual(saves(app), []);
    const failed = await zone.repository.read(OTHER_PET, DAY_2);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.pending.content.notes, 'sin permiso');
  });

  it('9. dos cuentas en reinicios seguidos: cada arranque abre solo el almacén de su sesión', async () => {
    const server = serverWithPets();
    const disk = new Map();
    const first = await dayOne(server, disk, (zone) => save(zone, { notes: 'de A' }));
    await first.controller.signOut();

    // B entra (con red), guarda sin conexión y cierra la app.
    const second = boot(server, { disk, now: T0 + HOUR, online: true });
    await tick();
    await second.auth.signIn(B);
    await tick();
    second.net.online = false;
    await save(second.zone(), { notes: 'de B' }, { logDate: DAY_2 });
    second.stop();

    // Arranque sin red con la sesión (caducada) de B: solo lo de B.
    const third = boot(server, { disk, now: T0 + 3 * HOUR, online: false });
    await tick();
    assert.equal(third.state().status, 'offline');
    assert.equal(third.zone().userId, B);
    const seen = await third.zone().repository.list();
    assert.deepEqual(seen.map((log) => [log.userId, log.logDate]), [[B, DAY_2]]);
    assert.equal(third.controller.isCurrentUser(A), false);
    // Al volver la red, B envía lo suyo y nada de A.
    await third.goOnline();
    assert.deepEqual(saves(third).map((request) => request.userId), [B]);
    assert.equal(server.row(PET, DATE), null);
    assert.ok(third.queryClient.getQueryCache().getAll().every((query) => !query.queryKey.includes(A)));
  });

  it('10. respuesta tardía de la inicialización (red que cuelga): primero «offline», después utilizable, sin envíos antes', async () => {
    const server = serverWithPets();
    const disk = new Map();
    await dayOne(server, disk, (zone) => save(zone, { notes: 'arranque lento' }));
    const app = boot(server, { disk, now: T0 + 2 * HOUR, online: true, hang: true });
    await tick();
    assert.equal(app.state().status, 'loading');
    await app.advance(4_000);
    assert.equal(app.state().status, 'offline');
    assert.equal(app.state().reason, 'slow_start');
    await app.zone().engine.requestSync();
    assert.deepEqual(app.requests, []);

    app.auth.release();
    await tick(20);
    await app.zone().engine.idle();
    assert.equal(app.state().status, 'signed_in');
    assert.equal((await app.zone().repository.read(PET, DATE)).status, 'synced');
  });

  it('una lectura del servidor sin sesión utilizable no sale y no sustituye la copia del dispositivo', async () => {
    const server = serverWithPets();
    const disk = new Map();
    await dayOne(server, disk, async (zone, app) => {
      app.net.online = true;
      await save(zone, { notes: 'copia sincronizada' });
      await zone.engine.idle();
    });
    const app = boot(server, { disk, now: T0 + 2 * HOUR, online: true, hang: true });
    await tick();
    await app.advance(4_000); // «offline» por arranque lento
    const zone = app.zone();
    const before = await zone.repository.read(PET, DATE);
    assert.equal(before.status, 'synced');
    // La query del día sin token de usuario: la guardia la corta; nada de «no existe» ni lista vacía.
    const anonymous = dataClient(server, app.net, app.requests);
    const read = readDailyLogThroughRepository(
      ownerScopedSnapshots(zone.repository, () => app.controller.isCurrentUser(A)),
      PET,
      DATE,
      async () => {
        const { data, error } = await anonymous.from('daily_logs').select('*').eq('pet_id', PET).eq('log_date', DATE).maybeSingle();
        if (error) throw error;
        return data;
      }
    );
    await assert.rejects(read, SessionUnavailableError);
    assert.deepEqual(await zone.repository.read(PET, DATE), before);
    assert.deepEqual(app.requests, []);
  });

  it('13. la app se cierra durante el arranque y durante la sincronización: nada se pierde ni se duplica', async () => {
    const server = serverWithPets();
    const disk = new Map();
    await dayOne(server, disk, (zone) => save(zone, { notes: 'no perder' }));

    // Se cierra durante el arranque (todavía «loading»).
    const interrupted = boot(server, { disk, now: T0 + 2 * HOUR, online: true, hang: true });
    await tick();
    interrupted.stop();
    assert.equal(JSON.parse([...disk].find(([key]) => key.startsWith('kitom:v1:'))[1]).data.status, 'pending');

    // Arranca, se recupera y se cierra con el envío en vuelo (el servidor lo procesa, la app no se entera).
    const syncing = boot(server, { disk, now: T0 + 2 * HOUR, online: false });
    await tick();
    const release = server.holdNextSave();
    syncing.net.online = true;
    await syncing.controller.recover();
    await tick(20);
    assert.equal(saves(syncing).length, 1);
    syncing.stop();
    syncing.sessions.deactivate(A);
    const crashed = new Map(disk); // lo que quedó en disco en el momento del cierre
    release();
    await tick();
    const stored = server.row(PET, DATE);
    assert.equal(stored.notes, 'no perder');

    // Reinicio sobre el disco del cierre: la operación seguía pendiente; se reconcilia sin reescribir.
    const restarted = boot(server, { disk: crashed, now: T0 + 3 * HOUR, online: true });
    await tick(20);
    await restarted.zone().engine.idle();
    assert.equal(restarted.state().status, 'signed_in');
    assert.equal((await restarted.zone().repository.read(PET, DATE)).status, 'synced');
    assert.equal(server.row(PET, DATE).updated_at, stored.updated_at);
    for (const request of saves(restarted)) {
      assert.ok((request.args.p_expected_updated_at != null) !== (request.args.p_expect_absent === true));
    }
  });
});

describe('sesión utilizable sin conexión', () => {
  it('token aún vigente y sin red: sesión utilizable (sin comprobar en el servidor); sin conexión no se intenta enviar', async () => {
    const server = serverWithPets();
    const disk = new Map([[KEY, JSON.stringify(makeSession(A, { expiresAt: Math.floor(T0 / 1000) + 1800 }))]]);
    const app = boot(server, { disk, now: T0, online: false });
    await tick();
    assert.equal(app.state().status, 'signed_in');
    const zone = app.zone();
    await save(zone, { notes: 'vigente' });
    await zone.engine.idle();
    const local = await zone.repository.read(PET, DATE);
    assert.equal(local.status, 'pending');
    assert.equal(local.pending.attempts, 0);
    assert.deepEqual(app.requests, []);
    // Con red, se envía con el token (vigente) de A.
    await app.goOnline();
    assert.equal((await zone.repository.read(PET, DATE)).status, 'synced');
    assert.deepEqual(saves(app).map((request) => request.userId), [A]);
  });
});
