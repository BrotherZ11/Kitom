// Pruebas del arranque y del ciclo de la sesión (`auth-session-controller.ts`, `auth-state.ts`,
// `persisted-session.ts`) con el `supabase.auth` falso de `fake-supabase-auth.mjs` (`npm test`).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError } from '@supabase/supabase-js';

import { createAuthSessionController, isSessionRejected } from './auth-session-controller.ts';
import { createAuthStateMachine } from './auth-state.ts';
import { createFakeSupabaseAuth, fakeJwt, makeSession } from './fake-supabase-auth.mjs';
import { parsePersistedSession } from './persisted-session.ts';

const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'a0000000-0000-4000-8000-000000000002';
const KEY = 'sb-test-auth-token';
const T0 = Date.UTC(2026, 9, 16, 9, 0, 0);
const STARTUP_MS = 4_000;
const RECOVERY_MS = 10_000;
const INTERVAL_MS = 5_000;

const tick = async (n = 5) => {
  for (let i = 0; i < n; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

/**
 * Un arranque de la app: el disco (sesión guardada) sobrevive entre arranques; reloj, red y
 * temporizadores son falsos. `stored`: sesión guardada antes de abrir la app. `online`: la red y lo que
 * dice el sistema; `osOnline` permite que difieran (p. ej. wifi sin salida a internet).
 */
function boot({
  disk = new Map(),
  stored = null,
  online = true,
  osOnline = online,
  hang = false,
  revoked = new Set(),
  keepRejected = false,
  storage,
} = {}) {
  const clock = { now: T0 };
  if (stored) disk.set(KEY, JSON.stringify(stored));
  const net = { online, hang };
  const os = { online: osOnline, foreground: true };
  const auth = createFakeSupabaseAuth({ disk, key: KEY, clock, net, server: { revoked, keepRejected } });
  const timers = [];
  const online$ = new Set();
  const foreground$ = new Set();
  const controller = createAuthSessionController({
    auth,
    storage: storage ?? auth.storage,
    storageKey: KEY,
    subscribeOnline: (listener) => (online$.add(listener), () => online$.delete(listener)),
    subscribeForeground: (listener) => (foreground$.add(listener), () => foreground$.delete(listener)),
    canAttemptRecovery: () => os.online && os.foreground,
    startupTimeoutMs: STARTUP_MS,
    recoveryTimeoutMs: RECOVERY_MS,
    recoveryIntervalMs: INTERVAL_MS,
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
    os,
    auth,
    controller,
    changes,
    stop,
    timers,
    state: () => controller.getState(),
    /** Avanza el reloj de una vez: vencen los temporizadores pendientes a esa hora. */
    async advance(ms) {
      clock.now += ms;
      for (const timer of timers.filter((item) => item.at <= clock.now)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.callback();
      }
      await tick();
    },
    /** Avanza el reloj en pasos de 1 s (los temporizadores que se reprograman también vencen). */
    async run(ms) {
      for (let elapsed = 0; elapsed < ms; elapsed += 1_000) await this.advance(1_000);
    },
    /** Vuelve la red y el sistema lo notifica. */
    goOnline() {
      net.online = true;
      os.online = true;
      for (const listener of online$) listener(true);
    },
    goOffline() {
      net.online = false;
      os.online = false;
      for (const listener of online$) listener(false);
    },
    background() {
      os.foreground = false;
    },
    foreground() {
      os.foreground = true;
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
    // Wifi sin salida a internet: el sistema dice «conectado», pero la renovación no llega.
    const app = boot({ stored: expired(), online: false, osOnline: true });
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

  it('sesión de Supabase incoherente (token de otra cuenta, p. ej. un valor guardado a medias): no identifica a nadie', async () => {
    // Token vigente: supabase-js la entregaría tal cual en INITIAL_SESSION.
    const forged = { ...valid(A), access_token: fakeJwt(B) };
    const app = boot({ stored: forged, online: true });
    await tick();
    assert.equal(app.state().status, 'signed_out');
    assert.equal(app.controller.isCurrentUser(A), false);
    assert.equal(app.controller.isCurrentUser(B), false);
    assert.ok(app.disk.has(KEY)); // no se borra nada: iniciar sesión la sustituye
  });

  it('almacenamiento que falla al leer la sesión: no hay identidad (login), no se inventa ni se borra', async () => {
    const disk = new Map([[KEY, JSON.stringify(expired())]]);
    let removals = 0;
    const failing = {
      getItem: async () => Promise.reject(new Error('keychain')),
      removeItem: async () => void (removals += 1),
    };
    const app = boot({ disk, online: false, storage: failing });
    await tick();
    assert.equal(app.state().status, 'signed_out');
    assert.equal(removals, 0);
    assert.ok(disk.has(KEY));
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

  it('sin conexión según el sistema no se intenta nada (ni temporizador, ni primer plano, ni a petición)', async () => {
    const app = boot({ stored: expired(), online: false });
    await tick();
    const before = app.auth.calls.getSession;
    await app.run(120_000);
    app.foreground();
    await app.controller.recover();
    await tick();
    assert.equal(app.auth.calls.getSession, before);
    assert.equal(app.timers.filter((timer) => timer.at > app.clock.now).length, 0, 'ningún temporizador pendiente');
    assert.equal(app.state().status, 'offline');
  });

  it('tras un intento fallido por la red, la sesión se recupera al volver la red', async () => {
    const app = boot({ stored: expired(), online: false, osOnline: true });
    await tick();
    await app.controller.recover(); // falla: sin red de verdad
    assert.equal(app.state().status, 'offline');
    app.goOnline();
    await tick(10);
    assert.equal(app.state().status, 'signed_in');
  });

  it('red, primer plano, temporizador y botón a la vez: una sola comprobación de la sesión', async () => {
    const app = boot({ stored: expired(), online: false });
    await tick();
    const before = app.auth.calls.getSession;
    app.net.hang = true; // la comprobación tarda: todo llega mientras está en curso
    app.goOnline();
    app.foreground();
    app.foreground();
    void app.controller.recover();
    await app.advance(INTERVAL_MS);
    assert.equal(app.auth.calls.getSession - before, 1);
    app.auth.release();
    await tick(10);
    assert.equal(app.auth.calls.getSession - before, 1);
    assert.equal(app.state().status, 'signed_in');
  });

  it('con «conectado» pero sin respuesta: reintenta cada 5 s, contado desde el final del anterior, solo en «offline»', async () => {
    const app = boot({ stored: expired(), online: false, osOnline: true });
    await tick();
    assert.equal(app.state().status, 'offline');
    const first = app.auth.calls.getSession;
    await app.run(30_000);
    assert.equal(app.auth.calls.getSession - first, 6);
    assert.equal(app.state().status, 'offline');
    app.net.online = true; // la red vuelve sin evento de conectividad
    await app.run(INTERVAL_MS);
    await tick(10);
    assert.equal(app.state().status, 'signed_in');
    const after = app.auth.calls.getSession;
    await app.run(60_000); // con sesión utilizable ya no se reintenta
    assert.equal(app.auth.calls.getSession, after);
  });

  it('en segundo plano no se reintenta; al volver a primer plano, un intento y se reanuda el ciclo', async () => {
    const app = boot({ stored: expired(), online: false, osOnline: true });
    await tick();
    app.background();
    await app.run(INTERVAL_MS); // el intento que estaba programado ya no se hace ni se reprograma
    const calls = app.auth.calls.getSession;
    await app.run(60_000);
    assert.equal(app.auth.calls.getSession, calls);
    app.net.online = true;
    app.foreground();
    await tick(10);
    assert.equal(app.auth.calls.getSession, calls + 1);
    assert.equal(app.state().status, 'signed_in');
  });

  it('la red se va otra vez: se dejan de programar intentos', async () => {
    const app = boot({ stored: expired(), online: false, osOnline: true });
    await tick();
    app.goOffline();
    const calls = app.auth.calls.getSession;
    await app.run(60_000);
    assert.equal(app.auth.calls.getSession, calls);
  });

  it('parado el controlador (app cerrada o desmontada) no queda ningún reintento', async () => {
    const app = boot({ stored: expired(), online: false, osOnline: true });
    await tick();
    app.stop();
    const calls = app.auth.calls.getSession;
    await app.run(60_000);
    assert.equal(app.auth.calls.getSession, calls);
  });

  it('fuera de «offline» no se pide nada al volver la red', async () => {
    const app = boot({ stored: valid() });
    await tick();
    app.goOnline();
    app.foreground();
    await app.run(30_000);
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

/** Auth falso a mano: `getSession` devuelve lo que se resuelva después con `respond`. */
function manualAuth() {
  const listeners = new Set();
  const pending = [];
  return {
    emit: (event, session) => listeners.forEach((listener) => listener(event, session)),
    respond: (result) => pending.shift()(result),
    get pendingCount() {
      return pending.length;
    },
    onAuthStateChange(callback) {
      listeners.add(callback);
      return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
    },
    getSession: () => new Promise((resolve) => pending.push(resolve)),
    signOut: async () => ({ error: null }),
  };
}

describe('respuestas tardías', () => {
  const start = (disk) => {
    const auth = manualAuth();
    const storage = {
      getItem: async (key) => disk.get(key) ?? null,
      removeItem: async (key) => void disk.delete(key),
    };
    // Sin reintentos automáticos: solo cuenta la comprobación que se resuelve a mano.
    const controller = createAuthSessionController({
      auth,
      storage,
      storageKey: KEY,
      canAttemptRecovery: () => true,
      recoveryIntervalMs: 3_600_000,
      recoveryTimeoutMs: 3_600_000,
    });
    const stop = controller.start();
    return { auth, controller, stop };
  };

  it('la comprobación de la cuenta anterior llega después de cambiar de cuenta: no cambia nada', async (t) => {
    const disk = new Map([[KEY, JSON.stringify(expired(A))]]);
    const { auth, controller, stop } = start(disk);
    t.after(stop);
    auth.emit('INITIAL_SESSION', null);
    await tick();
    assert.equal(controller.getState().status, 'offline');
    const recovering = controller.recover(); // la comprobación de A queda en curso
    await controller.signOut(); // cierre sin red
    auth.emit('SIGNED_IN', valid(B)); // entra otra cuenta
    assert.equal(controller.getState().userId, B);
    auth.respond({ data: { session: valid(A) }, error: null });
    await recovering;
    assert.equal(controller.getState().status, 'signed_in');
    assert.equal(controller.getState().userId, B);
  });

  it('la comprobación llega con la sesión de otra cuenta mientras sigue «offline»: no se aplica', async (t) => {
    const disk = new Map([[KEY, JSON.stringify(expired(A))]]);
    const { auth, controller, stop } = start(disk);
    t.after(stop);
    auth.emit('INITIAL_SESSION', null);
    await tick();
    const recovering = controller.recover();
    auth.respond({ data: { session: valid(B) }, error: null });
    await recovering;
    assert.equal(controller.getState().status, 'offline');
    assert.equal(controller.getState().userId, A);
  });

  it('Supabase ya no tiene la sesión (quitada sin SIGNED_OUT): login, sin más intentos', async (t) => {
    const disk = new Map([[KEY, JSON.stringify(expired(A))]]);
    const { auth, controller, stop } = start(disk);
    t.after(stop);
    auth.emit('INITIAL_SESSION', null);
    await tick();
    const recovering = controller.recover();
    auth.respond({ data: { session: null }, error: null });
    await recovering;
    assert.equal(controller.getState().status, 'signed_out');
    await controller.recover();
    assert.equal(auth.pendingCount, 0);
  });

  it('la comprobación de la misma cuenta llega tras cerrar sesión: sigue cerrada', async (t) => {
    const disk = new Map([[KEY, JSON.stringify(expired(A))]]);
    const { auth, controller, stop } = start(disk);
    t.after(stop);
    auth.emit('INITIAL_SESSION', null);
    await tick();
    const recovering = controller.recover();
    await controller.signOut();
    auth.respond({ data: { session: valid(A) }, error: null });
    await recovering;
    assert.equal(controller.getState().status, 'signed_out');
  });
});

describe('sesión rechazada', () => {
  it('isSessionRejected: solo los rechazos del servidor de Auth (con las clases reales de auth-js)', () => {
    assert.equal(isSessionRejected(new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found')), true);
    assert.equal(isSessionRejected(new AuthApiError('already used', 400, 'refresh_token_already_used')), true);
    assert.equal(isSessionRejected(new AuthSessionMissingError()), true);
    assert.equal(isSessionRejected(new AuthApiError('rate limit', 429, 'over_request_rate_limit')), false);
    assert.equal(isSessionRejected(new AuthRetryableFetchError('Failed to fetch', 0)), false);
    assert.equal(isSessionRejected(new AuthRetryableFetchError('Service Unavailable', 503)), false);
    assert.equal(isSessionRejected(null), false);
    assert.equal(isSessionRejected({ name: 'TimeoutError' }), false);
  });

  it('revocada mientras no había red: al volver, cierre de sesión y ningún intento más', async () => {
    const session = expired();
    const revoked = new Set();
    const app = boot({ stored: session, online: false, revoked });
    await tick();
    assert.equal(app.state().status, 'offline');
    revoked.add(session.refresh_token); // cierre global desde otro dispositivo
    app.goOnline();
    await tick(10);
    assert.equal(app.state().status, 'signed_out');
    const calls = app.auth.calls.getSession + app.auth.calls.refresh;
    app.foreground();
    await app.run(120_000);
    assert.equal(app.auth.calls.getSession + app.auth.calls.refresh, calls);
  });

  it('rechazada pero auth-js no pudo borrarla: se quita del dispositivo aquí (login), sin reintentos', async () => {
    const session = expired();
    const app = boot({ stored: session, online: false, revoked: new Set([session.refresh_token]), keepRejected: true });
    await tick();
    assert.equal(app.state().status, 'offline');
    app.goOnline();
    await tick(10);
    assert.equal(app.state().status, 'signed_out');
    assert.equal(app.disk.has(KEY), false);
    assert.deepEqual(app.changes.at(-1), { status: 'signed_out', from: 'offline', cause: 'local_sign_out' });
  });

  it('rechazada y tampoco se puede borrar aquí: queda «offline» sin más intentos (no un bucle)', async () => {
    const session = expired();
    const disk = new Map([[KEY, JSON.stringify(session)]]);
    const storage = {
      getItem: async (key) => disk.get(key) ?? null,
      removeItem: async () => Promise.reject(new Error('keychain')),
    };
    const app = boot({ disk, online: false, revoked: new Set([session.refresh_token]), keepRejected: true, storage });
    await tick();
    app.goOnline();
    await tick(10);
    assert.equal(app.state().status, 'offline');
    const calls = app.auth.calls.getSession;
    app.foreground();
    app.goOnline();
    await app.controller.recover();
    await app.run(120_000);
    assert.equal(app.auth.calls.getSession, calls);
    // Cerrar sesión lo vuelve a intentar y, si falla, lo dice (no cierra en silencio).
    const result = await app.controller.signOut();
    assert.match(String(result.error), /keychain/);
    assert.equal(app.state().status, 'offline');
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

  it('mientras la sesión está sin comprobar (arranque en curso) tampoco sale nada', async () => {
    const app = boot({ stored: expired(), online: true, hang: true });
    await tick();
    assert.equal(app.state().status, 'loading');
    let calls = 0;
    await assert.rejects(
      app.controller.serverCall(async () => (calls += 1)),
      (error) => error.name === 'SessionUnavailableError'
    );
    assert.equal(calls, 0);
    app.auth.release();
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

  it('en «offline», si el almacenamiento no deja borrarla: error visible, sigue la sesión (no se cierra en silencio)', async () => {
    const disk = new Map([[KEY, JSON.stringify(expired())]]);
    const storage = {
      getItem: async (key) => disk.get(key) ?? null,
      removeItem: async () => Promise.reject(new Error('keychain')),
    };
    const app = boot({ disk, online: false, storage });
    await tick();
    const result = await app.controller.signOut();
    assert.match(String(result.error), /keychain/);
    assert.equal(app.state().status, 'offline');
    assert.ok(disk.has(KEY));
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
