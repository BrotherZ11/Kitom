// Pruebas de `auto-refresh-gate.ts` (`npm test`) y de las premisas de auth-js en las que se apoya la
// recuperación de la sesión (`features/auth/auth-session-controller.ts`). Las de auth-js usan el
// cliente REAL con temporizadores y reloj simulados (`mock.timers`) y un `fetch` falso: si una versión
// nueva de supabase-js cambia ese comportamiento, fallan.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { createClient } from '@supabase/supabase-js';

import { createAutoRefreshGate } from './auto-refresh-gate.ts';

describe('createAutoRefreshGate', () => {
  const recorder = (initial) => {
    const calls = [];
    const gate = createAutoRefreshGate({
      start: () => calls.push('start'),
      stop: () => calls.push('stop'),
      ...initial,
    });
    return { calls, gate };
  };

  it('corre solo en primer plano y con conexión', () => {
    const { calls, gate } = recorder({ foreground: true, online: true });
    gate.sync();
    gate.setOnline(false);
    gate.setOnline(true);
    gate.setForeground(false);
    gate.setOnline(false);
    gate.setForeground(true); // sigue sin conexión: no arranca
    gate.setOnline(true);
    assert.deepEqual(calls, ['start', 'stop', 'start', 'stop', 'start']);
  });

  it('no repite start/stop si la decisión no cambia; `sync` la vuelve a aplicar siempre', () => {
    const { calls, gate } = recorder({ foreground: true, online: false });
    gate.sync();
    gate.setOnline(false);
    gate.setForeground(true);
    gate.sync(); // auth-js lo habrá arrancado por su cuenta al inicializarse
    assert.deepEqual(calls, ['stop', 'stop']);
  });
});

// --- Premisas de auth-js (supabase-js instalado) ---

const URL_ = 'http://127.0.0.1:54321';
const ANON = 'anon-key';
const KEY = 'sb-gate-test-auth-token';
const T0 = Date.UTC(2026, 9, 19, 9, 0, 0);
const USER = 'a0000000-0000-4000-8000-000000000001';

const jwt = (sub) =>
  `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.firma`;
const sessionExpiringIn = (seconds, refreshToken = 'refresh-0') => ({
  access_token: jwt(USER),
  refresh_token: refreshToken,
  expires_at: Math.floor(Date.now() / 1000) + seconds,
  expires_in: seconds,
  token_type: 'bearer',
  user: { id: USER, aud: 'authenticated', email: 'a@kitom.test' },
});

/** Deja avanzar el reloj simulado en pasos cortos, dejando correr las promesas entre paso y paso. */
async function advance(ms, step = 100) {
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    mock.timers.tick(Math.min(step, ms - elapsed));
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Cliente real con la sesión guardada y una red falsa: `net.online` decide si la renovación responde. */
function client(stored, net, { autoRefreshToken = true } = {}) {
  const disk = new Map([[KEY, JSON.stringify(stored)]]);
  const refreshes = [];
  const fetch = async (input) => {
    const url = String(input);
    if (!url.includes('grant_type=refresh_token')) throw new Error(`petición inesperada: ${url}`);
    refreshes.push(Date.now());
    if (!net.online) throw new TypeError('Network request failed');
    // Cada renovación correcta devuelve `refresh-ok-<n.º de petición>`.
    const next = sessionExpiringIn(3600, `refresh-ok-${refreshes.length}`);
    return new Response(JSON.stringify(next), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const supabase = createClient(URL_, ANON, {
    auth: {
      storage: {
        getItem: async (key) => disk.get(key) ?? null,
        setItem: async (key, value) => void disk.set(key, value),
        removeItem: async (key) => void disk.delete(key),
      },
      storageKey: KEY,
      persistSession: true,
      autoRefreshToken,
      detectSessionInUrl: false,
    },
    global: { fetch },
  });
  return { supabase, refreshes, disk };
}

describe('premisas de auth-js', () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: T0 });
    mock.method(console, 'warn', () => {}); // auth-js avisa de cada renovación fallida
  });
  afterEach(() => {
    mock.timers.reset();
    mock.restoreAll();
  });

  it('fuera del navegador (como React Native) arranca su temporizador al inicializarse, sin mirar la red', async () => {
    // Token que vence en 100 s: la inicialización no lo renueva (margen de 90 s), el temporizador sí.
    const { supabase, refreshes } = client(sessionExpiringIn(100), { online: false });
    await supabase.auth.initialize();
    await advance(200);
    assert.equal(refreshes.length, 1, 'la pasada inmediata del temporizador intenta renovar');
    await supabase.auth.stopAutoRefresh();
    await advance(30_000); // termina el reintento en curso
  });

  it('parado el temporizador no se renueva nada; al arrancarlo, una pasada inmediata', async () => {
    const { supabase, refreshes } = client(sessionExpiringIn(3600), { online: true });
    await supabase.auth.initialize();
    await advance(200);
    await supabase.auth.stopAutoRefresh(); // la puerta, sin conexión
    mock.timers.setTime(Date.now() + 3540_000); // a 60 s de caducar: el temporizador lo renovaría
    await advance(90_000);
    assert.equal(refreshes.length, 0);
    await supabase.auth.startAutoRefresh(); // vuelve la red
    await advance(200);
    assert.equal(refreshes.length, 1);
    await supabase.auth.stopAutoRefresh();
  });

  it('una renovación a la vez: varias peticiones de sesión simultáneas comparten la misma', async () => {
    const net = { online: true };
    // Sin renovación al inicializar ni temporizador: solo las tres peticiones de sesión.
    const { supabase, refreshes } = client(sessionExpiringIn(-600), net, { autoRefreshToken: false });
    await supabase.auth.initialize();
    const results = Promise.all([supabase.auth.getSession(), supabase.auth.getSession(), supabase.auth.getSession()]);
    await advance(500);
    const sessions = await results;
    assert.equal(refreshes.length, 1);
    assert.ok(sessions.every(({ data }) => data.session?.refresh_token === 'refresh-ok-1'));
  });

  it('tras una renovación fallida sin red reintenta ~25 s y después devuelve ese fallo 60 s sin pedir nada', async () => {
    const net = { online: false };
    const { supabase, refreshes, disk } = client(sessionExpiringIn(-600), net);
    // La inicialización intenta renovar (token caducado): reintentos con espera creciente.
    const initialized = supabase.auth.initialize();
    await advance(30_000);
    await initialized;
    await supabase.auth.stopAutoRefresh();
    const attempts = refreshes.length;
    assert.ok(attempts >= 5 && attempts <= 10, `intentos de la renovación: ${attempts}`);
    assert.ok(refreshes.at(-1) - refreshes[0] < 30_000);
    assert.ok(disk.has(KEY), 'un fallo de red no borra la sesión');

    // La red vuelve enseguida, pero durante el enfriamiento no sale ninguna petición.
    net.online = true;
    const cached = await supabase.auth.getSession();
    assert.equal(cached.data.session, null);
    assert.equal(cached.error?.name, 'AuthRetryableFetchError');
    assert.equal(refreshes.length, attempts);

    // El enfriamiento es de 60 s desde el último intento fallido.
    const failedAt = refreshes.at(-1);
    await advance(failedAt + 59_000 - Date.now());
    assert.equal((await supabase.auth.getSession()).data.session, null, 'a los 59 s sigue el fallo guardado');
    assert.equal(refreshes.length, attempts);
    await advance(2_000);
    const renewed = supabase.auth.getSession();
    await advance(200);
    assert.equal((await renewed).data.session?.refresh_token, `refresh-ok-${attempts + 1}`);
    assert.equal(refreshes.length, attempts + 1);
  });
});
