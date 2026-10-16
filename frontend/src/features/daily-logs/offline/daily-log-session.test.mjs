// Fase 5: ciclo de vida de la sesión y protección de los datos offline (`npm test`). Motor y almacén
// reales, `createDailyLogRemote` real sobre un cliente de Supabase falso que, como PostgREST, actúa
// como el usuario del token que lleva la petición (y, como supabase-js, usa la sesión vigente del
// cliente compartido si la petición no lleva token propio), y el servidor falso de `save_daily_log`.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { QueryClient } from '@tanstack/query-core';

import { createOwnerAccessToken } from '../../auth/owner-session.ts';
import { createSignOutFlow } from '../../auth/sign-out-flow.ts';
import { createLocalStore } from '../../../lib/local-store/local-store.ts';
import { createMemoryStorage } from '../../../lib/local-store/memory-storage.ts';
import { dailyLogKeys } from '../query-keys.ts';
import {
  applyLocalChangeToCache,
  ownerScopedSnapshots,
  readDailyLogThroughRepository,
  summarizeUnsynced,
} from './daily-log-cache.ts';
import { createDailyLogRemote } from './daily-log-remote.ts';
import { createDailyLogRepository, DailyLogRepositoryError } from './daily-log-repository.ts';
import { createDailyLogSyncEngine } from './daily-log-sync-engine.ts';
import { createDailyLogSyncSessions } from './daily-log-sync-sessions.ts';
import { localDailyLogs } from './local-daily-log.ts';
import { argsFor, content, DATE, OTHER_USER, PET, T0, USER } from './sync-test-helpers.mjs';
import { createFakeServer } from './fake-daily-log-server.mjs';

const A = USER;
const B = OTHER_USER;
const OTHER_PET = 'b0000000-0000-4000-8000-000000000002';
const DATE_2 = '2026-10-14';
const TIMEOUT_MS = 15_000;

const tick = () => new Promise((resolve) => setImmediate(resolve));
async function until(condition) {
  for (let i = 0; i < 200 && !condition(); i += 1) await tick();
  assert.ok(condition(), 'la condición no llegó a cumplirse');
}

const fakeJwt = (sub) =>
  `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.firma`;
const subjectOf = (authorization) =>
  authorization ? JSON.parse(Buffer.from(authorization.split(' ')[1].split('.')[1], 'base64url').toString()).sub : null;

/** `supabase.auth` falso: la sesión vigente del cliente compartido de la app. */
function fakeAuth() {
  const auth = {
    session: null,
    signIn(userId) {
      auth.session = { access_token: fakeJwt(userId), user: { id: userId } };
    },
    signOut() {
      auth.session = null;
    },
    async getSession() {
      return { data: { session: auth.session }, error: null };
    },
  };
  return auth;
}

/**
 * Cliente de Supabase falso y compartido. Cada petición actúa como el usuario del token de su
 * cabecera `Authorization`; sin cabecera propia, como supabase-js, usaría la sesión vigente del
 * cliente (`auth`). `requests` anota quién la hizo y con qué argumentos.
 */
function fakeSupabase(server, auth) {
  const requests = [];
  const toPostgrest = (result) =>
    result.ok ? { data: result.data, error: null, status: 200 } : { data: null, error: result.error, status: result.status ?? 0 };
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
        const authorization = chain.headers.Authorization ?? (auth.session ? `Bearer ${auth.session.access_token}` : null);
        return run(subjectOf(authorization), chain).then(toPostgrest).then(resolve, reject);
      },
    };
    return chain;
  };
  return {
    requests,
    rpc: (name, args) =>
      builder((userId) => {
        requests.push({ type: 'save', userId, args });
        if (!userId) return Promise.resolve({ ok: false, status: 401, error: { code: '42501' } });
        return server.remoteFor(userId).save(args);
      }),
    from: () =>
      builder((userId, chain) => {
        requests.push({ type: 'fetch', userId });
        if (!userId) return Promise.resolve({ ok: true, data: null });
        return server.remoteFor(userId).fetch(chain.filters.pet_id, chain.filters.log_date);
      }),
  };
}

/**
 * La app en un dispositivo: un disco, el cliente compartido con su sesión, las sesiones de
 * sincronización por usuario (como el proveedor) y el reloj y los temporizadores falsos.
 */
function app(server, { disk = new Map(), storage = createMemoryStorage(disk) } = {}) {
  const auth = fakeAuth();
  const client = fakeSupabase(server, auth);
  const net = { online: true };
  const clock = { now: T0 };
  const timers = [];
  const queryClient = new QueryClient();
  const signOuts = [];

  const sessions = createDailyLogSyncSessions((userId) => {
    const repository = createDailyLogRepository(createLocalStore(storage, userId));
    const engine = createDailyLogSyncEngine({
      repository,
      remote: createDailyLogRemote(client, { accessToken: createOwnerAccessToken(auth, userId) }),
      isOnline: () => net.online,
      now: () => clock.now,
      createOperationId: randomUUID,
      random: () => 0.5,
      setTimer: (callback, ms) => {
        const timer = { callback, at: clock.now + ms };
        timers.push(timer);
        return timer;
      },
      clearTimer: (timer) => {
        const index = timers.indexOf(timer);
        if (index >= 0) timers.splice(index, 1);
      },
    });
    return { userId, repository, engine };
  });

  let mounted = null;
  /** Lo que hace el proveedor al montar la zona autenticada de `userId` (sesión ya abierta). */
  const mount = (userId) => {
    const session = sessions.activate(userId);
    // Caché solo mientras la sesión vigente sea la de su dueño (`isCurrentUser`).
    const unsubscribe = session.repository.subscribe((change) => {
      if (auth.session?.user.id === userId) applyLocalChangeToCache(queryClient, userId, change);
    });
    session.engine.setSessionUserId(userId);
    const flow = createSignOutFlow({
      checkUnsynced: async () => summarizeUnsynced(await session.repository.list()),
      syncNow: () => session.engine.syncNow({ timeoutMs: TIMEOUT_MS }),
      signOut: async () => {
        signOuts.push(userId);
        // Supabase Auth borra la sesión y el proveedor desmonta la zona autenticada.
        auth.signOut();
        unmount();
        queryClient.clear();
        return { error: null };
      },
    });
    mounted = { userId, unsubscribe, session, flow };
    return { ...session, flow };
  };
  const unmount = () => {
    if (!mounted) return;
    mounted.flow.cancel();
    mounted.unsubscribe();
    sessions.deactivate(mounted.userId);
    mounted = null;
  };

  return {
    disk,
    auth,
    client,
    net,
    clock,
    timers,
    queryClient,
    sessions,
    signOuts,
    /** Iniciar sesión con `userId` (cerrando antes la zona de la cuenta anterior, si la había). */
    signIn(userId) {
      unmount();
      queryClient.clear();
      auth.signIn(userId);
      return mount(userId);
    },
    /** La sesión pasa a ser de otra cuenta sin cerrar la app (p. ej. otra pestaña en web). */
    switchTo(userId) {
      // Supabase Auth cambia la sesión al instante; React desmonta y monta después.
      auth.signIn(userId);
      return () => this.signIn(userId);
    },
    async runTimers() {
      for (const timer of timers.filter((item) => item.at <= clock.now)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.callback();
      }
      await tick();
    },
  };
}

function serverWithPets() {
  const server = createFakeServer();
  server.allowEditor(PET, A);
  server.allowEditor(OTHER_PET, A);
  server.allowEditor(PET, B);
  return server;
}

const save = (engine, overrides = {}, { petId = PET, logDate = DATE, baseRow = null } = {}) =>
  engine.saveLocal({ petId, logDate, content: content(overrides), baseRow });

/** 12. Ningún guardado sale sin exactamente una precondición. */
function assertAllPreconditioned(client) {
  for (const request of client.requests.filter((item) => item.type === 'save')) {
    const expected = request.args.p_expected_updated_at != null;
    const absent = request.args.p_expect_absent === true;
    assert.ok(expected !== absent, `guardado sin precondición única: ${JSON.stringify(request.args)}`);
  }
}

describe('cerrar sesión con registros de Daily Logs sin sincronizar', () => {
  it('1. sin pendientes: cierra sesión sin preguntar (comportamiento de siempre)', async () => {
    const server = serverWithPets();
    const device = app(server);
    const { engine, flow } = device.signIn(A);
    await save(engine, { notes: 'enviado' });
    await engine.idle();
    assert.deepEqual(await flow.request(), { status: 'signed_out', error: null });
    assert.deepEqual(device.signOuts, [A]);
  });

  it('2. con pendientes y «Cancelar»: la sesión sigue y nada cambia', async () => {
    const server = serverWithPets();
    const device = app(server);
    const { engine, repository, flow } = device.signIn(A);
    device.net.online = false;
    await save(engine, { notes: 'solo aquí' });
    const before = [...device.disk.entries()];

    const outcome = await flow.request();
    assert.deepEqual(outcome, { status: 'needs_decision', summary: { pending: 1, failed: 0, conflict: 0 }, attempt: null });
    flow.cancel();
    assert.deepEqual(device.signOuts, []);
    assert.deepEqual([...device.disk.entries()], before);
    assert.equal(device.auth.session.user.id, A);
    assert.equal((await repository.read(PET, DATE)).status, 'pending');
  });

  it('3. intentar sincronizar y cerrar: envía con precondición (sin esperar al backoff) y solo entonces cierra', async () => {
    const server = serverWithPets();
    const device = app(server);
    const { engine, repository, flow } = device.signIn(A);
    // Un fallo de servidor deja la operación esperando su backoff: el intento del usuario no espera.
    server.failNext({ ok: false, status: 503, error: { code: '' } });
    await save(engine, { notes: 'antes de salir' });
    await engine.idle();
    assert.ok((await repository.read(PET, DATE)).pending.nextAttemptAt > device.clock.now);

    assert.deepEqual(await flow.syncAndSignOut(), { status: 'signed_out', error: null });
    assert.equal(server.row(PET, DATE).notes, 'antes de salir');
    assert.equal((await repository.read(PET, DATE)).status, 'synced');
    assert.deepEqual(device.signOuts, [A]);
    assertAllPreconditioned(device.client);
  });

  it('4. sin conexión: el intento no espera a la red; conservar y cerrar deja los datos en el dispositivo', async () => {
    const server = serverWithPets();
    const device = app(server);
    const { engine, flow } = device.signIn(A);
    device.net.online = false;
    await save(engine, { notes: 'sin red' });

    const attempt = await flow.syncAndSignOut();
    assert.deepEqual(attempt, { status: 'needs_decision', summary: { pending: 1, failed: 0, conflict: 0 }, attempt: 'offline' });
    assert.equal(device.client.requests.length, 0);
    assert.deepEqual(device.signOuts, []);

    assert.equal((await flow.keepAndSignOut()).status, 'signed_out');
    assert.equal(device.auth.session, null);
    // Sigue en el dispositivo, con su operación y su contenido, bajo la clave de A.
    const keys = [...device.disk.keys()];
    assert.equal(keys.length, 1);
    assert.ok(keys[0].startsWith(`kitom:v1:${A}:`));
    const stored = JSON.parse(device.disk.get(keys[0])).data;
    assert.equal(stored.status, 'pending');
    assert.equal(stored.pending.content.notes, 'sin red');
    // Ya sin sesión, aunque vuelva la red, no se envía nada.
    device.net.online = true;
    await device.sessions.get(A).engine.requestSync();
    assert.equal(device.client.requests.length, 0);
  });

  it('se agota el tiempo del intento: no cierra; la pasada sigue y se aplica al terminar', async () => {
    const server = serverWithPets();
    const device = app(server);
    const { engine, repository, flow } = device.signIn(A);
    device.net.online = false;
    await save(engine, { notes: 'lento' });
    device.net.online = true;

    const release = server.holdNextSave();
    const attempt = flow.syncAndSignOut();
    await until(() => device.client.requests.length === 1);
    device.clock.now += TIMEOUT_MS;
    await device.runTimers();
    assert.deepEqual(await attempt, { status: 'needs_decision', summary: { pending: 1, failed: 0, conflict: 0 }, attempt: 'timed_out' });
    assert.deepEqual(device.signOuts, []);

    release();
    await engine.idle();
    assert.equal((await repository.read(PET, DATE)).status, 'synced');
    assert.deepEqual(device.signOuts, []); // nunca se cierra sola
  });

  it('10. conflictos y permisos durante el intento: no cierra, los datos siguen y se puede volver a decidir', async () => {
    const server = serverWithPets();
    const device = app(server);
    const { engine, repository, flow } = device.signIn(A);
    device.net.online = false;
    await save(engine, { notes: 'mi versión' });
    await save(engine, { notes: 'sin permiso' }, { petId: OTHER_PET, logDate: DATE_2 });
    // Mientras, otra persona crea el registro (conflicto) y A pierde la edición de la otra mascota.
    server.writeAsOther(B, argsFor({ notes: 'la de B' }));
    server.revokeEditor(OTHER_PET, A);
    device.net.online = true;

    const outcome = await flow.syncAndSignOut();
    assert.deepEqual(outcome, { status: 'needs_decision', summary: { pending: 0, failed: 1, conflict: 1 }, attempt: 'incomplete' });
    assert.deepEqual(device.signOuts, []);
    const conflict = await repository.read(PET, DATE);
    assert.equal(conflict.status, 'conflict');
    assert.equal(conflict.pending.content.notes, 'mi versión');
    assert.equal(conflict.conflict.remote.row.notes, 'la de B');
    const failed = await repository.read(OTHER_PET, DATE_2);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error.kind, 'permission');
    assert.equal(failed.pending.content.notes, 'sin permiso');
    assert.equal(server.row(PET, DATE).notes, 'la de B');

    // El descarte individual sigue funcionando; después, otro intento.
    assert.equal(await engine.discardLocalChanges(OTHER_PET, DATE_2), 'discarded');
    assert.equal((await flow.syncAndSignOut()).status, 'needs_decision');
    assertAllPreconditioned(device.client);
  });

  it('13. 401 durante el intento: no cierra ni gasta intentos; la operación sigue pendiente', async () => {
    const server = serverWithPets();
    const device = app(server);
    const { engine, repository, flow } = device.signIn(A);
    device.net.online = false;
    await save(engine, { notes: 'token caducado' });
    device.net.online = true;
    server.failNext({ ok: false, status: 401, error: { code: 'PGRST301' } });

    const outcome = await flow.syncAndSignOut();
    assert.equal(outcome.status, 'needs_decision');
    assert.equal(outcome.summary.pending, 1);
    // Un segundo intento con la misma sesión ni siquiera sale (`session`).
    assert.deepEqual((await flow.syncAndSignOut()).attempt, 'session');
    const local = await repository.read(PET, DATE);
    assert.equal(local.pending.attempts, 0);
    assert.equal(local.pending.content.notes, 'token caducado');
  });
});

describe('aislamiento entre cuentas', () => {
  it('5. volver a entrar con la misma cuenta recupera sus operaciones y las envía con su token', async () => {
    const server = serverWithPets();
    const disk = new Map();
    const device = app(server, { disk });
    const first = device.signIn(A);
    device.net.online = false;
    await save(first.engine, { notes: 'guardado antes de salir' });
    await first.flow.keepAndSignOut();

    device.net.online = true;
    const again = device.signIn(A);
    assert.equal(again.repository, first.repository); // la misma instancia: escrituras de una en una
    assert.deepEqual(summarizeUnsynced(await again.repository.list()), { pending: 1, failed: 0, conflict: 0 });
    await again.engine.requestSync();
    assert.equal((await again.repository.read(PET, DATE)).status, 'synced');
    assert.equal(server.row(PET, DATE).logged_by, A);
    assert.deepEqual(device.client.requests.map((request) => request.userId), [A]);
  });

  it('5b. tras reiniciar la app (otra instancia sobre el mismo disco) también se recuperan', async () => {
    const server = serverWithPets();
    const disk = new Map();
    const before = app(server, { disk });
    before.net.online = false;
    await save(before.signIn(A).engine, { notes: 'antes del reinicio' });

    const after = app(server, { disk });
    const { engine, repository } = after.signIn(A);
    await engine.requestSync();
    assert.equal((await repository.read(PET, DATE)).status, 'synced');
    assert.equal(server.row(PET, DATE).notes, 'antes del reinicio');
  });

  it('6. otra cuenta no ve ni sincroniza las operaciones de la anterior (y no se borran)', async () => {
    const server = serverWithPets();
    const disk = new Map();
    const device = app(server, { disk });
    const a = device.signIn(A);
    device.net.online = false;
    await save(a.engine, { notes: 'de A' });
    await a.flow.keepAndSignOut();
    const aKeys = [...disk.entries()];

    device.net.online = true;
    const b = device.signIn(B);
    assert.deepEqual(await b.repository.list(), []);
    assert.equal(await b.repository.read(PET, DATE), null); // misma mascota y día: otra clave
    assert.deepEqual(await b.flow.request(), { status: 'signed_out', error: null }); // B no tiene nada pendiente
    device.signIn(B);
    assert.deepEqual(await device.sessions.get(B).engine.syncNow({ timeoutMs: TIMEOUT_MS }), { status: 'completed' });
    // A, sin sesión, tampoco envía aunque alguien le pida una pasada.
    await device.sessions.get(A).engine.requestSync();
    assert.deepEqual(device.client.requests, []);
    assert.equal(server.row(PET, DATE), null);
    assert.deepEqual([...disk.entries()].filter(([key]) => key.includes(A)), aKeys);
    // La caché de B no tiene nada de A.
    assert.ok(device.queryClient.getQueryCache().getAll().every((query) => !query.queryKey.includes(A)));
  });

  it('el motor de A cree que sigue su sesión, pero el cliente ya es de B: no sale nada (token de A o nada)', async () => {
    const server = serverWithPets();
    const device = app(server);
    const a = device.signIn(A);
    device.net.online = false;
    await save(a.engine, { notes: 'de A' });
    // La sesión del cliente cambia a B antes de que el proveedor avise al motor de A.
    device.switchTo(B);
    device.net.online = true;
    await a.engine.requestSync();
    // Sin el token de A no se hace ninguna petición; nunca como B.
    assert.deepEqual(device.client.requests, []);
    const local = await a.repository.read(PET, DATE);
    assert.equal(local.status, 'pending');
    assert.equal(local.pending.attempts, 0);
    assert.equal(local.error.reason, 'owner_session_required');
    assert.equal(server.row(PET, DATE), null);
  });

  it('7/8. cambio de cuenta con una petición en vuelo: sale como A, la respuesta tardía va a A y no a la caché de B', async () => {
    const server = serverWithPets();
    const device = app(server);
    const a = device.signIn(A);
    const release = server.holdNextSave();
    const saving = save(a.engine, { notes: 'en vuelo' });
    await saving;
    await until(() => device.client.requests.length === 1);

    // B entra mientras la petición de A sigue en vuelo; la de A se hizo con el token de A.
    const remount = device.switchTo(B);
    const b = remount();
    await save(b.engine, { notes: 'de B, otro día' }, { logDate: DATE_2 });
    await b.engine.idle();
    assert.equal(device.client.requests[0].userId, A);

    release();
    await a.engine.idle();
    // El servidor la guardó como A; el dispositivo la confirma en el almacén de A.
    assert.equal(server.row(PET, DATE).logged_by, A);
    assert.equal((await a.repository.read(PET, DATE)).status, 'synced');
    // Nada de A en el almacén ni en la caché de B.
    assert.equal(await b.repository.read(PET, DATE), null);
    const keys = device.queryClient.getQueryCache().getAll().map((query) => query.queryKey);
    assert.ok(keys.length > 0);
    assert.ok(keys.every((key) => key.includes(B) && !key.includes(A)), JSON.stringify(keys));
    assert.equal(device.queryClient.getQueryData(dailyLogKeys.detail(B, PET, DATE)), undefined);
    // Lo de B salió como B; nada de A salió como B.
    for (const request of device.client.requests) {
      assert.equal(request.userId, request.args.p_log_date === DATE ? A : B);
    }
    assertAllPreconditioned(device.client);
  });

  it('8. respuesta tardía entre el evento de Auth y el desmontaje: se guarda en A pero no entra en la caché', async () => {
    const server = serverWithPets();
    const device = app(server);
    const a = device.signIn(A);
    const release = server.holdNextSave();
    await save(a.engine, { notes: 'tarde' });
    await until(() => device.client.requests.length === 1);
    device.queryClient.clear();
    device.switchTo(B); // la suscripción de A sigue (React aún no ha desmontado)
    release();
    await a.engine.idle();
    assert.equal((await a.repository.read(PET, DATE)).status, 'synced');
    assert.deepEqual(device.queryClient.getQueryCache().getAll(), []);
  });

  it('lecturas del servidor que terminan con otra cuenta no se copian en el almacén del dueño', async () => {
    const server = serverWithPets();
    const device = app(server);
    const a = device.signIn(A);
    const snapshots = ownerScopedSnapshots(a.repository, () => device.auth.session?.user.id === A);
    const row = server.writeAsOther(B, argsFor({ notes: 'del servidor' }));
    const shown = await readDailyLogThroughRepository(snapshots, PET, DATE, async () => {
      device.switchTo(B);
      return row;
    });
    assert.equal(shown, row);
    assert.equal(await a.repository.read(PET, DATE), null);
  });

  it('9. la app se cierra con un intento en vuelo: al reiniciar sigue con sesión y la operación se reconcilia sin duplicar', async () => {
    const server = serverWithPets();
    const disk = new Map();
    // Tras el «cierre», las escrituras de la instancia anterior ya no llegan al disco.
    let crashed = false;
    const base = createMemoryStorage(disk);
    const dying = { ...base, setItem: (key, value) => (crashed ? Promise.resolve() : base.setItem(key, value)) };
    const before = app(server, { disk, storage: dying });
    const a = before.signIn(A);
    before.net.online = false;
    await save(a.engine, { notes: 'al cerrar la app' });
    before.net.online = true;

    const release = server.holdNextSave();
    void a.flow.syncAndSignOut();
    await until(() => before.client.requests.length === 1);
    crashed = true;
    release(); // el servidor la procesa, pero el dispositivo ya no se entera
    await a.engine.idle();
    assert.deepEqual(before.signOuts, []);
    const stored = server.row(PET, DATE);
    assert.equal(stored.notes, 'al cerrar la app');

    // Reinicio: la sesión persistida sigue (no se cerró) y la operación sigue pendiente.
    const after = app(server, { disk });
    const { engine, repository } = after.signIn(A);
    assert.equal((await repository.read(PET, DATE)).status, 'pending');
    await engine.requestSync();
    // Conflicto `row_exists` → se lee la fila → mismo contenido → sincronizado, sin otra escritura.
    assert.equal((await repository.read(PET, DATE)).status, 'synced');
    assert.equal(server.row(PET, DATE).updated_at, stored.updated_at);
    assertAllPreconditioned(after.client);
  });
});

describe('createDailyLogSyncSessions', () => {
  const fakeEngine = (log, userId) => ({
    start: () => log.push(`start ${userId}`),
    stop: () => log.push(`stop ${userId}`),
    setSessionUserId: (id) => log.push(`session ${userId}=${id}`),
  });

  it('una instancia por usuario; activar una para y deja sin sesión las demás', () => {
    const log = [];
    let created = 0;
    const sessions = createDailyLogSyncSessions((userId) => ((created += 1), { userId, engine: fakeEngine(log, userId) }));
    const a = sessions.activate(A);
    assert.equal(sessions.get(A), a);
    sessions.activate(B);
    sessions.deactivate(B);
    assert.equal(sessions.activate(A), a);
    assert.equal(created, 2);
    assert.deepEqual(log, [`start ${A}`, `stop ${A}`, `session ${A}=null`, `start ${B}`, `stop ${B}`, `session ${B}=null`, `stop ${B}`, `session ${B}=null`, `start ${A}`]);
  });
});

describe('propiedad no verificable', () => {
  it('un registro guardado bajo la clave de A pero con otro dueño no se lista, no se envía y no se sobrescribe', async () => {
    const server = serverWithPets();
    const disk = new Map();
    const device = app(server, { disk });
    const b = device.signIn(B);
    device.net.online = false;
    await save(b.engine, { notes: 'de B' });
    // Alguien (otra versión, un fallo) deja ese registro bajo la clave de A.
    const [[keyB, raw]] = [...disk.entries()];
    const keyA = keyB.replace(B, A);
    disk.set(keyA, raw);

    device.net.online = true;
    const a = device.signIn(A);
    assert.deepEqual(await a.repository.list(), []);
    assert.equal((await createLocalStore(createMemoryStorage(disk), A).read(localDailyLogs, [PET, DATE])).reason, 'key_mismatch');
    await assert.rejects(
      save(a.engine, { notes: 'encima' }),
      (error) => error instanceof DailyLogRepositoryError && error.code === 'ownership_unverified'
    );
    await a.engine.requestSync();
    assert.equal(disk.get(keyA), raw); // se conserva tal cual
    assert.deepEqual(device.client.requests, []);
  });
});
