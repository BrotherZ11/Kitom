// Mide la recuperación de la sesión y de la sincronización tras un arranque sin conexión, contra el
// Supabase LOCAL, con supabase-js real (`autoRefreshToken: true`, como la app: en Node, igual que en
// React Native, auth-js arranca su propio temporizador de renovación), el controlador de sesión, la
// guardia de `user-token-fetch.ts` y el motor de Daily Logs reales. Red, conectividad del sistema y
// AppState son simulados; los tiempos son reales (cada escenario tarda minutos).
//
// Uso (desde frontend/, con el Supabase local arrancado): node scripts/measure-session-recovery.mjs [escenario...]
// Escenarios: valid_offline restore_10s restore_45s restore_150s foreground revoked simultaneous slow
// failing (por defecto, todos en paralelo; ~5 min). MEASURE_TRACE=1 muestra la secuencia de cada uno.
// Resultados de referencia: docs/FRONTEND_ARCHITECTURE.md §5 «Estabilización de la sesión (fase 6.5)».
// Crea usuarios `measure-…@kitom.test` y mascotas en el Supabase local (no se borran). Nunca contra kitom-dev.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { createClient } from '@supabase/supabase-js';

import { createAuthSessionController } from '../src/features/auth/auth-session-controller.ts';
import { createOwnerAccessToken } from '../src/features/auth/owner-session.ts';
import { createDailyLogRemote } from '../src/features/daily-logs/offline/daily-log-remote.ts';
import { createDailyLogRepository } from '../src/features/daily-logs/offline/daily-log-repository.ts';
import { createDailyLogSyncEngine } from '../src/features/daily-logs/offline/daily-log-sync-engine.ts';
import { connectSyncTriggers } from '../src/features/daily-logs/offline/sync-triggers.ts';
import { createLocalStore } from '../src/lib/local-store/local-store.ts';
import { createMemoryStorage } from '../src/lib/local-store/memory-storage.ts';
import { createAuthRefreshFetch } from '../src/lib/auth-refresh-fetch.ts';
import { createAutoRefreshGate } from '../src/lib/auto-refresh-gate.ts';
import { createUserTokenFetch } from '../src/lib/user-token-fetch.ts';

const status = JSON.parse(
  execFileSync('npx', ['supabase', 'status', '-o', 'json'], {
    cwd: new URL('../..', import.meta.url),
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
);
const URL_ = status.API_URL;
const ANON = status.ANON_KEY;
if (!['127.0.0.1', 'localhost'].includes(new URL(URL_).hostname)) throw new Error('La API no es local.');

const KEY = 'sb-measure-auth-token';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const today = () => new Date().toISOString().slice(0, 10);
const content = (notes) => ({
  energy_level: 3,
  appetite_level: 3,
  mood_level: 3,
  activity_level: null,
  sleep_quality: null,
  vocalization_level: null,
  social_interaction_level: null,
  unusual_behavior: false,
  unusual_behavior_notes: null,
  notes,
  tags: [],
});

async function createUser() {
  const client = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `measure-${randomUUID()}@kitom.test`;
  const password = `M-${randomUUID()}`;
  const { data, error } = await client.auth.signUp({ email, password });
  if (error || !data.session) throw error ?? new Error('El Auth local exige confirmar el email');
  const species = await client.from('species').select('id').limit(1).single();
  const pet = await client
    .from('pets')
    .insert({ name: 'Medición', species_id: species.data.id, owner_id: data.user.id })
    .select('id')
    .single();
  if (pet.error) throw pet.error;
  return { client, userId: data.user.id, petId: pet.data.id, session: data.session };
}

/**
 * Un arranque de la app. `network`: 'offline' (fetch falla al momento, como RN sin red), 'online',
 * 'hang' (las peticiones no terminan hasta `release`) o 'error503' (la renovación responde 503).
 */
async function boot({ user, expired, network, timeline }) {
  const t0 = performance.now();
  const now = () => Math.round(performance.now() - t0);
  const marks = [];
  const mark = (what) => {
    marks.push({ t: now(), what });
    timeline?.(`${String(now()).padStart(7)} ms  ${what}`);
  };
  const net = { mode: network, osOnline: network !== 'offline', foreground: true };
  const held = [];
  const requests = [];

  const transport = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const kind = url.includes('grant_type=refresh_token')
      ? 'refresh'
      : url.includes('/rest/v1/')
        ? 'rest'
        : url.includes('/auth/v1/')
          ? 'auth'
          : 'other';
    requests.push({ t: now(), kind, mode: net.mode });
    if (net.mode === 'offline') throw new TypeError('Network request failed');
    if (net.mode === 'hang') {
      await new Promise((resolve) => held.push(resolve));
      if (net.mode === 'offline') throw new TypeError('Network request failed');
    }
    if (net.mode === 'error503' && kind === 'refresh') {
      return new Response('{"message":"unavailable"}', { status: 503, headers: { 'Content-Type': 'application/json' } });
    }
    return fetch(input, init);
  };

  const sessionDisk = new Map();
  const stored = expired ? { ...user.session, expires_at: Math.floor(Date.now() / 1000) - 600 } : user.session;
  sessionDisk.set(KEY, JSON.stringify(stored));
  const storage = {
    getItem: async (key) => sessionDisk.get(key) ?? null,
    setItem: async (key, value) => void sessionDisk.set(key, value),
    removeItem: async (key) => void sessionDisk.delete(key),
  };
  const supabase = createClient(URL_, ANON, {
    auth: { storage, storageKey: KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    global: {
      fetch: createUserTokenFetch({
        fetch: createAuthRefreshFetch({ fetch: transport, supabaseUrl: URL_ }),
        supabaseUrl: URL_,
        anonKey: ANON,
      }),
    },
  });

  // `onlineManager` y AppState simulados.
  const online$ = new Set();
  const foreground$ = new Set();
  const subscribeOnline = (listener) => (online$.add(listener), () => online$.delete(listener));
  const subscribeForeground = (listener) => (foreground$.add(listener), () => foreground$.delete(listener));

  // `lib/supabase.ts`: temporizador de auth-js solo en primer plano y con conexión.
  const gate = createAutoRefreshGate({
    start: () => void supabase.auth.startAutoRefresh(),
    stop: () => void supabase.auth.stopAutoRefresh(),
    foreground: true,
    online: net.osOnline,
  });
  // Como `lib/supabase.ts`: auth-js arranca su temporizador al inicializarse; después se reaplica.
  void supabase.auth.initialize().then(() => setTimeout(gate.sync, 0));

  // Temporizadores del controlador: en segundo plano el proceso está congelado (Android congela las
  // apps en caché); lo que venza entonces se ejecuta al volver a primer plano.
  const frozen = [];
  const controller = createAuthSessionController({
    auth: supabase.auth,
    storage,
    storageKey: KEY,
    subscribeOnline,
    subscribeForeground,
    canAttemptRecovery: () => net.osOnline && net.foreground,
    setTimer: (callback, ms) =>
      setTimeout(() => (net.foreground ? callback() : frozen.push(callback)), ms),
    clearTimer: (handle) => clearTimeout(handle),
  });

  // Motor de Daily Logs con un registro pendiente de un arranque anterior.
  const disk = new Map();
  const repository = createDailyLogRepository(createLocalStore(createMemoryStorage(disk), user.userId));
  const engine = createDailyLogSyncEngine({
    repository,
    remote: createDailyLogRemote(supabase, { accessToken: createOwnerAccessToken(supabase.auth, user.userId) }),
    isOnline: () => net.osOnline,
    now: Date.now,
    createOperationId: randomUUID,
  });
  await engine.saveLocal({ petId: user.petId, logDate: today(), content: content('medición'), baseRow: null });

  // Lo que hacen `AuthProvider` y `DailyLogSyncProvider` al cambiar la sesión.
  controller.subscribe((next, previous, cause) => {
    mark(`estado ${previous.status} → ${next.status} (${cause})`);
    engine.setSessionUserId(next.status === 'signed_in' ? next.userId : null);
    if (next.status === 'signed_in') void engine.requestSync();
    if (previous.status === 'offline' && next.status === 'signed_in') {
      // `queryClient.invalidateQueries()`: las queries activas se vuelven a pedir.
      void controller
        .serverCall(() => supabase.from('pets').select('id').eq('id', user.petId))
        .then(({ error }) => mark(error ? `consulta con error ${error.message}` : 'consulta de datos correcta'))
        .catch((error) => mark(`consulta rechazada ${error.message}`));
    }
  });
  const stop = controller.start();
  engine.start();
  const disconnect = connectSyncTriggers(engine.requestSync, { subscribeOnline, subscribeForeground });
  const unsubscribeRepository = repository.subscribe(() => {
    void repository.read(user.petId, today()).then((log) => {
      if (log.status === 'synced' && !marks.some((item) => item.what === 'sincronizado')) mark('sincronizado');
    });
  });

  return {
    supabase,
    controller,
    marks,
    requests,
    now,
    mark,
    net,
    state: () => controller.getState(),
    async waitFor(condition, ms) {
      const started = performance.now();
      while (!condition()) {
        if (performance.now() - started > ms) return false;
        await sleep(20);
      }
      return true;
    },
    /** La red vuelve; `event`: el sistema lo notifica (onlineManager). */
    restore({ event = true } = {}) {
      net.mode = 'online';
      for (const resolve of held.splice(0)) resolve();
      mark('RED RESTABLECIDA');
      if (event) this.osOnline(true);
    },
    osOnline(online) {
      net.osOnline = online;
      gate.setOnline(online);
      for (const listener of online$) listener(online);
    },
    background() {
      net.foreground = false;
      mark('segundo plano');
      gate.setForeground(false);
    },
    foreground() {
      net.foreground = true;
      mark('primer plano');
      gate.setForeground(true);
      for (const listener of foreground$) listener();
      for (const callback of frozen.splice(0)) callback();
    },
    async stop() {
      unsubscribeRepository();
      disconnect();
      engine.stop();
      stop();
      await supabase.auth.stopAutoRefresh();
    },
  };
}

const since = (app, from, what) => {
  const found = app.marks.find((item) => item.t >= from && item.what.startsWith(what));
  return found ? found.t - from : null;
};
const refreshes = (app, from = 0, to = Infinity) =>
  app.requests.filter((request) => request.kind === 'refresh' && request.t >= from && request.t < to).length;

function report(name, app, from, extra = {}) {
  const result = {
    escenario: name,
    sesion_renovada_ms: since(app, from, 'estado offline → signed_in'),
    consultas_reanudadas_ms: since(app, from, 'consulta de datos correcta'),
    sincronizado_ms: since(app, from, 'sincronizado'),
    renovaciones_totales: refreshes(app),
    renovaciones_tras_red: refreshes(app, from),
    estado_final: app.state().status,
    ...extra,
  };
  console.log(JSON.stringify(result));
  if (process.env.MEASURE_TRACE) {
    for (const item of app.marks) console.log(`    ${String(item.t).padStart(7)} ms  ${item.what}`);
    for (const request of app.requests) console.log(`    ${String(request.t).padStart(7)} ms  -> ${request.kind} (${request.mode})`);
  }
  return result;
}

const scenarios = {
  /** 1. Arranque sin conexión con token vigente. */
  async valid_offline() {
    const app = await boot({ user: await createUser(), expired: false, network: 'offline' });
    await app.waitFor(() => app.state().status !== 'loading', 10_000);
    const ready = app.now();
    const statusAtStart = app.state().status;
    await sleep(5_000);
    app.restore();
    const from = app.now();
    await app.waitFor(() => app.marks.some((item) => item.what === 'sincronizado'), 60_000);
    report('1. vigente sin red', app, from, { estado_inicial: statusAtStart, listo_ms: ready, peticiones_sin_red: app.requests.filter((r) => r.mode === 'offline').length });
    await app.stop();
  },

  /** 2/3. Token caducado sin red; la red vuelve en primer plano tras `at` ms. */
  async expired_offline_restore_at(at) {
    const app = await boot({ user: await createUser(), expired: true, network: 'offline' });
    await app.waitFor(() => app.state().status !== 'loading', 10_000);
    const ready = app.now();
    const readyStatus = app.state().status;
    await sleep(Math.max(0, at - app.now()));
    const offlineRefreshes = refreshes(app);
    app.restore();
    const from = app.now();
    await app.waitFor(() => app.marks.some((item) => item.what === 'sincronizado'), 150_000);
    report(`3. caducado sin red, red en primer plano a los ${at / 1000} s`, app, from, {
      estado_inicial: readyStatus,
      listo_ms: ready,
      renovaciones_sin_red: offlineRefreshes,
    });
    await app.stop();
  },

  /** 4. La red vuelve con la app en segundo plano; se mide desde la vuelta a primer plano. */
  async foreground_after_background() {
    const app = await boot({ user: await createUser(), expired: true, network: 'offline' });
    await app.waitFor(() => app.state().status !== 'loading', 10_000);
    await sleep(20_000 - app.now());
    app.background();
    await sleep(60_000 - app.now());
    app.net.mode = 'online'; // la red vuelve, pero con el proceso congelado nadie se entera
    app.mark('RED RESTABLECIDA (en segundo plano)');
    await sleep(90_000 - app.now());
    app.net.osOnline = true;
    app.foreground();
    app.osOnline(true); // al reanudarse llega también el estado de la red
    const from = app.now();
    await app.waitFor(() => app.marks.some((item) => item.what === 'sincronizado'), 150_000);
    report('4. red recuperada en segundo plano, medido desde primer plano', app, from);
    await app.stop();
  },

  /** 5. Sesión revocada en el servidor mientras la app estaba sin red. */
  async revoked() {
    const user = await createUser();
    const app = await boot({ user, expired: true, network: 'offline' });
    await app.waitFor(() => app.state().status !== 'loading', 10_000);
    // Cierre global desde otro dispositivo: el token de renovación deja de valer.
    const other = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    await other.auth.setSession({ access_token: user.session.access_token, refresh_token: user.session.refresh_token });
    const { error } = await other.auth.signOut({ scope: 'global' });
    if (error) throw error;
    await sleep(40_000 - app.now());
    app.restore();
    const from = app.now();
    await app.waitFor(() => app.state().status === 'signed_out', 150_000);
    const out = app.now();
    await sleep(90_000);
    report('5. sesión revocada', app, from, {
      cierre_ms: out - from,
      renovaciones_tras_cierre_90s: refreshes(app, out),
      sesion_guardada: app.state().status,
    });
    await app.stop();
  },

  /** 6. Red, primer plano y temporizador a la vez, sin enfriamiento de auth-js de por medio. */
  async simultaneous() {
    const app = await boot({ user: await createUser(), expired: true, network: 'offline' });
    await app.waitFor(() => app.state().status !== 'loading', 10_000);
    await sleep(150_000 - app.now());
    const offlineRefreshes = refreshes(app);
    app.net.mode = 'online';
    app.mark('RED RESTABLECIDA');
    const from = app.now();
    app.osOnline(true);
    app.foreground();
    void app.controller.recover();
    void app.controller.recover();
    await app.waitFor(() => app.marks.some((item) => item.what === 'sincronizado'), 150_000);
    report('6. eventos simultáneos (red + primer plano + recover x2)', app, from, { renovaciones_sin_red: offlineRefreshes });
    await app.stop();
  },

  /** 7a. Servidor lento: la red «cuelga» 15 s tras volver. */
  async slow() {
    const app = await boot({ user: await createUser(), expired: true, network: 'offline' });
    await app.waitFor(() => app.state().status !== 'loading', 10_000);
    await sleep(150_000 - app.now());
    app.net.mode = 'hang';
    app.mark('RED RESTABLECIDA (lenta)');
    const from = app.now();
    app.osOnline(true);
    await sleep(15_000);
    app.restore({ event: false });
    await app.waitFor(() => app.marks.some((item) => item.what === 'sincronizado'), 150_000);
    report('7a. renovación lenta (15 s colgada)', app, from);
    await app.stop();
  },

  /** 7b. Renovación que falla repetidamente (503) con red durante 3 min; luego se arregla. */
  async failing() {
    const app = await boot({ user: await createUser(), expired: true, network: 'offline' });
    await app.waitFor(() => app.state().status !== 'loading', 10_000);
    await sleep(30_000 - app.now());
    app.net.mode = 'error503';
    app.osOnline(true);
    app.mark('RED CON 503');
    const failingFrom = app.now();
    await sleep(180_000);
    const failingRefreshes = refreshes(app, failingFrom);
    app.restore({ event: false });
    const from = app.now();
    await app.waitFor(() => app.marks.some((item) => item.what === 'sincronizado'), 150_000);
    report('7b. 503 repetidos 180 s y después servidor sano (sin evento)', app, from, {
      renovaciones_en_180s_con_503: failingRefreshes,
    });
    await app.stop();
  },
};

const selected = process.argv.slice(2);
const runs = {
  valid_offline: () => scenarios.valid_offline(),
  restore_10s: () => scenarios.expired_offline_restore_at(10_000),
  restore_45s: () => scenarios.expired_offline_restore_at(45_000),
  restore_150s: () => scenarios.expired_offline_restore_at(150_000),
  foreground: () => scenarios.foreground_after_background(),
  revoked: () => scenarios.revoked(),
  simultaneous: () => scenarios.simultaneous(),
  slow: () => scenarios.slow(),
  failing: () => scenarios.failing(),
};
const names = selected.length ? selected : Object.keys(runs);
console.log(`# ${new Date().toISOString()}`);
await Promise.all(names.map((name) => runs[name]().catch((error) => console.log(JSON.stringify({ escenario: name, error: String(error) })))));
