// Pruebas del arranque y del ciclo de la sesión (`auth-session-controller.ts`, `auth-state.ts`,
// `persisted-session.ts`) con el `supabase.auth` falso de `fake-supabase-auth.mjs` (`npm test`).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createAuthSessionController } from './auth-session-controller.ts';
import { createAuthStateMachine } from './auth-state.ts';
import { createFakeSupabaseAuth, fakeJwt, makeSession } from './fake-supabase-auth.mjs';
import { parsePersistedSession } from './persisted-session.ts';

const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'a0000000-0000-4000-8000-000000000002';
const KEY = 'sb-test-auth-token';
const T0 = Date.UTC(2026, 9, 16, 9, 0, 0);
const STARTUP_MS = 4_000;
const RECOVERY_MS = 10_000;

const tick = async (n = 5) => {
  for (let i = 0; i < n; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

/**
 * Un arranque de la app: el disco (sesión guardada) sobrevive entre arranques; reloj, red y
 * temporizadores son falsos. `stored`: sesión guardada antes de abrir la app.
 */
function boot({ disk = new Map(), stored = null, online = true, hang = false, revoked = new Set(), storage } = {}) {
  const clock = { now: T0 };
  if (stored) disk.set(KEY, JSON.stringify(stored));
  const net = { online, hang };
  const auth = createFakeSupabaseAuth({ disk, key: KEY, clock, net, server: { revoked } });
  const timers = [];
  const online$ = new Set();
  const foreground$ = new Set();
  const controller = createAuthSessionController({
    auth,
    storage: storage ?? auth.storage,
    storageKey: KEY,
    subscribeOnline: (listener) => (online$.add(listener), () => online$.delete(listener)),
    subscribeForeground: (listener) => (foreground$.add(listener), () => foreground$.delete(listener)),
    startupTimeoutMs: STARTUP_MS,
    recoveryTimeoutMs: RECOVERY_MS,
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
  const changes = [];
  controller.subscribe((state, previous, cause) => changes.push({ status: state.status, from: previous.status, cause }));
  const stop = controller.start();
  return {
    disk,
    clock,
    net,
    auth,
    controller,
    changes,
    stop,
    state: () => controller.getState(),
    async advance(ms) {
      clock.now += ms;
      for (const timer of timers.filter((item) => item.at <= clock.now)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.callback();
      }
      await tick();
    },
    goOnline() {
      net.online = true;
      for (const listener of online$) listener(true);
    },
    foreground() {
      for (const listener of foreground$) listener();
    },
  };
}

const valid = (userId = A) => makeSession(userId, { expiresAt: Math.floor(T0 / 1000) + 1800 });
const expired = (userId = A) => makeSession(userId, { expiresAt: Math.floor(T0 / 1000) - 600 });

describe('arranque en frío', () => {
  it('1. sin conexión con una sesión guardada vigente: utilizable al momento, sin peticiones', async () => {
    const app = boot({ stored: valid(), online: false });
    await tick();
    const state = app.state();
    assert.equal(state.status, 'signed_in');
    assert.equal(state.userId, A);
    assert.equal(app.auth.calls.refresh, 0);
  });

  it('2. sin sesión guardada: flujo de autenticación, sin identidad', async () => {
    const app = boot();
    await tick();
    assert.equal(app.state().status, 'signed_out');
    assert.equal(app.controller.isCurrentUser(A), false);
  });

  it('3/4. sin conexión y con el token caducado: «offline» con su usuario, no un cierre de sesión', async () => {
    const app = boot({ stored: expired(), online: false });
    await tick();
    const state = app.state();
    assert.equal(state.status, 'offline');
    assert.equal(state.reason, 'refresh_failed');
    assert.equal(state.userId, A);
    assert.equal(app.controller.isCurrentUser(A), true);
    assert.ok(app.disk.has(KEY)); // la sesión sigue guardada
    assert.deepEqual(app.changes.map((change) => change.status), ['offline']); // nunca pasó por signed_out
  });

  it('4. sin poder renovar: recuperar no cambia nada y nunca espera más del tope', async () => {
    const app = boot({ stored: expired(), online: false });
    await tick();
    await app.controller.recover();
    assert.equal(app.state().status, 'offline');

    // Red que cuelga: el intento se abandona al cumplirse el tope.
    app.net.hang = true;
    const recovering = app.controller.recover();
    await tick();
    await app.advance(RECOVERY_MS);
    await recovering;
    assert.equal(app.state().status, 'offline');
    assert.ok(app.disk.has(KEY));
  });

  it('el token de renovación rechazado por el servidor sí es un cierre de sesión (sin datos)', async () => {
    const session = expired();
    const app = boot({ stored: session, revoked: new Set([session.refresh_token]) });
    await tick();
    assert.equal(app.state().status, 'signed_out');
    assert.equal(app.disk.has(KEY), false);
  });

  it('arranque lento (la red cuelga): a los 4 s se abre «offline» con la sesión guardada', async () => {
    const app = boot({ stored: expired(), online: true, hang: true });
    await tick();
    assert.equal(app.state().status, 'loading');
    await app.advance(STARTUP_MS);
    assert.equal(app.state().status, 'offline');
    assert.equal(app.state().reason, 'slow_start');
    // 10. La respuesta tardía de la inicialización (renovación correcta) pasa a sesión utilizable.
    app.auth.release();
    await tick(10);
    assert.equal(app.state().status, 'signed_in');
    assert.equal(app.state().userId, A);
  });

  it('arranque lento sin sesión guardada: login al cumplirse el tope', async () => {
    const auth = { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) };
    const timers = [];
    const controller = createAuthSessionController({
      auth: { ...auth, getSession: async () => ({ data: { session: null }, error: null }), signOut: async () => ({ error: null }) },
      storage: { getItem: async () => null, removeItem: async () => {} },
      storageKey: KEY,
      setTimer: (callback) => (timers.push(callback), callback),
      clearTimer: () => {},
    });
    controller.start();
    assert.equal(controller.getState().status, 'loading');
    timers[0]();
    await tick();
    assert.equal(controller.getState().status, 'signed_out');
  });

  it('sesión guardada que no se puede atribuir (token de otra cuenta, ilegible): no se abre nada', async () => {
    const forged = { ...expired(A), access_token: fakeJwt(B) };
    const app = boot({ stored: forged, online: false });
    await tick();
    assert.equal(app.state().status, 'signed_out');
    const broken = boot({ online: false });
    broken.disk.set(KEY, '{no json');
    assert.equal(parsePersistedSession(broken.disk.get(KEY)).status, 'unreadable');
  });

  it('almacenamiento que falla al leer la sesión: no hay identidad (login), no se inventa', async () => {
    const disk = new Map([[KEY, JSON.stringify(expired())]]);
    const failing = { getItem: async () => Promise.reject(new Error('keychain')), removeItem: async () => {} };
    const app = boot({ disk, online: false, storage: failing });
    await tick();
    assert.equal(app.state().status, 'signed_out');
  });
});

describe('recuperación', () => {
  it('8. vuelve la red: se renueva la sesión y pasa a utilizable (misma cuenta)', async () => {
    const app = boot({ stored: expired(), online: false });
    await tick();
    assert.equal(app.state().status, 'offline');
    app.goOnline();
    await tick(10);
    assert.equal(app.state().status, 'signed_in');
    assert.equal(app.state().userId, A);
    assert.deepEqual(app.changes.at(-1), { status: 'signed_in', from: 'offline', cause: 'TOKEN_REFRESHED' });
  });

  it('red y primer plano a la vez: una sola comprobación de la sesión', async () => {
    const app = boot({ stored: expired(), online: false });
    await tick();
    const before = app.auth.calls.getSession;
    app.goOnline();
    app.foreground();
    app.foreground();
    await tick(10);
    assert.equal(app.auth.calls.getSession - before, 1);
    assert.equal(app.state().status, 'signed_in');
  });

  it('la red vuelve sin aviso (o dentro del enfriamiento de Supabase): se reintenta cada 30 s solo en «offline»', async () => {
    const app = boot({ stored: expired(), online: false });
    await tick();
    assert.equal(app.state().status, 'offline');
    const first = app.auth.calls.getSession;
    await app.advance(30_000); // sigue sin red: otro intento, sigue «offline»
    assert.equal(app.auth.calls.getSession, first + 1);
    assert.equal(app.state().status, 'offline');
    app.net.online = true; // vuelve la red sin evento de conectividad
    await app.advance(30_000);
    await tick(10);
    assert.equal(app.state().status, 'signed_in');
    const after = app.auth.calls.getSession;
    await app.advance(120_000); // con sesión utilizable ya no se reintenta
    assert.equal(app.auth.calls.getSession, after);
  });

  it('parado el controlador (app cerrada o desmontada) no queda ningún reintento', async () => {
    const app = boot({ stored: expired(), online: false });
    await tick();
    app.stop();
    const calls = app.auth.calls.getSession;
    await app.advance(120_000);
    assert.equal(app.auth.calls.getSession, calls);
  });

  it('fuera de «offline» no se pide nada al volver la red', async () => {
    const app = boot({ stored: valid() });
    await tick();
    app.goOnline();
    app.foreground();
    await tick();
    assert.equal(app.auth.calls.getSession, 0);
  });

  it('10. una lectura del almacenamiento que llega tarde no deshace un evento posterior', () => {
    const machine = createAuthStateMachine();
    const check = machine.authEvent('INITIAL_SESSION', null);
    machine.authEvent('SIGNED_IN', valid(B));
    machine.storageRead(check, { status: 'found', user: { id: A }, expiresAt: 0 });
    assert.equal(machine.getState().status, 'signed_in');
    assert.equal(machine.getState().userId, B);
    // Y el tope de arranque ya no hace nada tras INITIAL_SESSION.
    assert.equal(machine.startupTimeout(), null);
  });
});

describe('llamadas al servidor', () => {
  it('12. sin sesión utilizable fallan al instante sin llamar a nada; con ella, se hacen', async () => {
    const app = boot({ stored: expired(), online: false });
    await tick();
    let calls = 0;
    const call = async () => (calls += 1);
    await assert.rejects(app.controller.serverCall(call), (error) => error.name === 'SessionUnavailableError');
    assert.equal(calls, 0);
    app.goOnline();
    await tick(10);
    assert.equal(await app.controller.serverCall(call), 1);
  });
});

describe('cerrar sesión sin poder renovar', () => {
  it('13. en «offline» la sesión se quita del dispositivo (Supabase no puede) y se va al login', async () => {
    const app = boot({ stored: expired(), online: false });
    await tick();
    assert.deepEqual(await app.controller.signOut(), { error: null });
    assert.equal(app.state().status, 'signed_out');
    assert.equal(app.disk.has(KEY), false);
    assert.equal(app.auth.calls.signOut, 0);
  });

  it('con sesión «utilizable» pero sin red y con el token caducado: Supabase no la quita; se quita aquí', async () => {
    const app = boot({ stored: valid() });
    await tick();
    assert.equal(app.state().status, 'signed_in');
    // Pasa una hora sin red: el token caduca con la app abierta.
    app.net.online = false;
    app.clock.now += 2 * 3600_000;
    const result = await app.controller.signOut();
    assert.equal(result.error.name, 'AuthRetryableFetchError'); // informativo
    assert.equal(app.state().status, 'signed_out');
    assert.equal(app.disk.has(KEY), false);
  });

  it('dos cierres a la vez: uno solo', async () => {
    const app = boot({ stored: valid() });
    await tick();
    await Promise.all([app.controller.signOut(), app.controller.signOut()]);
    assert.equal(app.auth.calls.signOut, 1);
    assert.equal(app.state().status, 'signed_out');
  });
});
