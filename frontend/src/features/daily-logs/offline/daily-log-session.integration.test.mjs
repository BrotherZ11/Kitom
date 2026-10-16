// Fase 5 contra el Supabase LOCAL: cambio de cuenta y cierre de sesión con un cliente de Supabase
// COMPARTIDO (como en la app), con Auth, RLS y `save_daily_log` reales. `npm run test:integration`;
// en `npm test` se omiten (no hay URL). Nunca contra `kitom-dev`.
//
// Crean dos usuarios `it-…@kitom.test` (quedan en el Auth local) y mascotas que se borran al terminar.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { createClient } from '@supabase/supabase-js';

import { createOwnerAccessToken } from '../../auth/owner-session.ts';
import { createSignOutFlow } from '../../auth/sign-out-flow.ts';
import { createLocalStore } from '../../../lib/local-store/local-store.ts';
import { createMemoryStorage } from '../../../lib/local-store/memory-storage.ts';
import { summarizeUnsynced } from './daily-log-cache.ts';
import { createDailyLogRemote } from './daily-log-remote.ts';
import { createDailyLogRepository } from './daily-log-repository.ts';
import { createDailyLogSyncEngine } from './daily-log-sync-engine.ts';
import { createDailyLogSyncSessions } from './daily-log-sync-sessions.ts';

const URL_ = process.env.KITOM_IT_SUPABASE_URL;
const ANON_KEY = process.env.KITOM_IT_SUPABASE_ANON_KEY;
const isLocal = URL_ !== undefined && ['127.0.0.1', 'localhost'].includes(new URL(URL_).hostname);
const skip = !URL_ || !ANON_KEY ? 'sin Supabase local (npm run test:integration)' : !isLocal ? 'la URL no es local' : false;

const authOptions = { persistSession: false, autoRefreshToken: false };
const daysAgo = (days) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
const content = (overrides = {}) => ({
  energy_level: 3,
  appetite_level: 3,
  mood_level: 3,
  activity_level: null,
  sleep_quality: null,
  vocalization_level: null,
  social_interaction_level: null,
  unusual_behavior: false,
  unusual_behavior_notes: null,
  notes: null,
  tags: [],
  ...overrides,
});

async function signUp() {
  const supabase = createClient(URL_, ANON_KEY, { auth: authOptions });
  const email = `it-${randomUUID()}@kitom.test`;
  const password = `It-${randomUUID()}`;
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error || !data.session) throw error ?? new Error('El Auth local exige confirmar el email');
  return { supabase, userId: data.user.id, email, password };
}

/** Usuario del JWT de una cabecera `Authorization` (solo para anotar quién hizo cada petición). */
const subjectOf = (authorization) => {
  try {
    return JSON.parse(Buffer.from(authorization.split(' ')[1].split('.')[1], 'base64url').toString()).sub ?? null;
  } catch {
    return null;
  }
};

/**
 * La app: UN cliente de Supabase compartido (su sesión cambia al entrar con otra cuenta), las
 * sesiones de sincronización por usuario como en el proveedor y un `fetch` que anota cada guardado
 * (quién y con qué argumentos) y puede retener el siguiente.
 */
function app() {
  const saves = [];
  let hold = null;
  const fetch_ = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/rest/v1/rpc/save_daily_log')) {
      const headers = new Headers(init?.headers);
      saves.push({ userId: subjectOf(headers.get('Authorization')), args: JSON.parse(init.body) });
      if (hold) {
        const wait = hold;
        hold = null;
        await wait;
      }
    }
    return fetch(input, init);
  };
  const supabase = createClient(URL_, ANON_KEY, { auth: authOptions, global: { fetch: fetch_ } });
  const net = { online: true };
  const disk = new Map();
  const sessions = createDailyLogSyncSessions((userId) => {
    const repository = createDailyLogRepository(createLocalStore(createMemoryStorage(disk), userId));
    const engine = createDailyLogSyncEngine({
      repository,
      remote: createDailyLogRemote(supabase, { accessToken: createOwnerAccessToken(supabase.auth, userId) }),
      isOnline: () => net.online,
      now: Date.now,
      createOperationId: randomUUID,
      random: () => 0,
    });
    return { repository, engine };
  });

  return {
    supabase,
    saves,
    net,
    sessions,
    holdNextSave() {
      let release;
      hold = new Promise((resolve) => (release = resolve));
      return () => release();
    },
    /** Entra con `user` en el cliente compartido y monta su sesión de sincronización. */
    async signIn(user) {
      const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: user.password });
      if (error) throw error;
      const session = sessions.activate(user.userId);
      session.engine.setSessionUserId(user.userId);
      return session;
    },
    flowFor(user) {
      const { repository, engine } = sessions.get(user.userId);
      return createSignOutFlow({
        checkUnsynced: async () => summarizeUnsynced(await repository.list()),
        syncNow: () => engine.syncNow({ timeoutMs: 15_000 }),
        signOut: async () => {
          const { error } = await supabase.auth.signOut({ scope: 'local' });
          sessions.deactivate(user.userId);
          return { error };
        },
      });
    },
  };
}

/** 12. Todos los guardados que salieron llevan exactamente una precondición. */
function assertAllPreconditioned(saves) {
  assert.ok(saves.length > 0);
  for (const { args } of saves) {
    assert.ok((args.p_expected_updated_at != null) !== (args.p_expect_absent === true), JSON.stringify(args));
  }
}

describe('ciclo de vida de la sesión contra el Supabase local', { skip }, () => {
  let userA;
  let userB;
  let speciesId;
  const pets = [];

  before(async () => {
    userA = await signUp();
    userB = await signUp();
    const { data, error } = await userA.supabase.from('species').select('id').limit(1).single();
    if (error) throw error;
    speciesId = data.id;
  });

  after(async () => {
    if (pets.length) await userA.supabase.from('pets').delete().in('id', pets);
  });

  async function newPet() {
    const { data, error } = await userA.supabase
      .from('pets')
      .insert({ name: 'Integración sesión', species_id: speciesId, owner_id: userA.userId })
      .select('id')
      .single();
    if (error) throw error;
    pets.push(data.id);
    return data.id;
  }

  const serverRow = async (petId, logDate) =>
    (await userA.supabase.from('daily_logs').select('*').eq('pet_id', petId).eq('log_date', logDate).maybeSingle()).data;

  it('6/7. el cliente compartido pasa a ser de B: la operación de A no sale (ni como B); al volver A, sale como A', async () => {
    const petId = await newPet();
    const date = daysAgo(0);
    const device = app();
    const a = await device.signIn(userA);
    device.net.online = false;
    await a.engine.saveLocal({ petId, logDate: date, content: content({ notes: 'de A' }), baseRow: null });

    // B entra en el mismo cliente; el motor de A todavía cree que la sesión es suya.
    const { error } = await device.supabase.auth.signInWithPassword({ email: userB.email, password: userB.password });
    if (error) throw error;
    device.net.online = true;
    await a.engine.requestSync();
    assert.deepEqual(device.saves, []);
    assert.equal(await serverRow(petId, date), null);
    const waiting = await a.repository.read(petId, date);
    assert.equal(waiting.status, 'pending');
    assert.equal(waiting.error.reason, 'owner_session_required');
    assert.equal(waiting.pending.attempts, 0);

    // 5. A vuelve a entrar: se recupera y se envía con el token de A.
    const again = await device.signIn(userA);
    assert.equal(again.repository, a.repository);
    await again.engine.requestSync();
    assert.equal((await again.repository.read(petId, date)).status, 'synced');
    assert.equal((await serverRow(petId, date)).logged_by, userA.userId);
    assert.deepEqual(device.saves.map((save) => save.userId), [userA.userId]);
    assertAllPreconditioned(device.saves);
  });

  it('7/8. cambio de cuenta con la petición de A en vuelo: el servidor la guarda como A y la respuesta va al almacén de A', async () => {
    const petId = await newPet();
    const date = daysAgo(1);
    const device = app();
    const a = await device.signIn(userA);
    const release = device.holdNextSave();
    await a.engine.saveLocal({ petId, logDate: date, content: content({ notes: 'en vuelo' }), baseRow: null });
    while (device.saves.length === 0) await new Promise((resolve) => setTimeout(resolve, 10));

    const b = await device.signIn(userB); // para y deja sin sesión a A
    release();
    await a.engine.idle();
    const row = await serverRow(petId, date);
    assert.equal(row.notes, 'en vuelo');
    assert.equal(row.logged_by, userA.userId);
    assert.equal((await a.repository.read(petId, date)).status, 'synced');
    assert.equal(await b.repository.read(petId, date), null);
    assert.deepEqual(await b.repository.list(), []);
    assert.deepEqual(device.saves.map((save) => save.userId), [userA.userId]);
  });

  it('3/4/5. sin conexión, conservar y cerrar sesión; al volver la misma cuenta, se sincroniza', async () => {
    const petId = await newPet();
    const date = daysAgo(2);
    const device = app();
    const a = await device.signIn(userA);
    device.net.online = false;
    await a.engine.saveLocal({ petId, logDate: date, content: content({ notes: 'conservado' }), baseRow: null });
    const flow = device.flowFor(userA);

    assert.equal((await flow.syncAndSignOut()).attempt, 'offline');
    assert.equal((await device.supabase.auth.getSession()).data.session.user.id, userA.userId);
    assert.equal((await flow.keepAndSignOut()).status, 'signed_out');
    assert.equal((await device.supabase.auth.getSession()).data.session, null);
    device.net.online = true;
    await a.engine.requestSync(); // parado y sin sesión: no envía
    assert.deepEqual(device.saves, []);

    const again = await device.signIn(userA);
    await again.engine.requestSync();
    assert.equal((await serverRow(petId, date)).notes, 'conservado');
    // Con todo enviado, intentar sincronizar y cerrar cierra la sesión.
    assert.equal((await device.flowFor(userA).syncAndSignOut()).status, 'signed_out');
    assertAllPreconditioned(device.saves);
  });

  it('10. permiso real denegado (42501) durante el intento: no cierra sesión y conserva los datos', async () => {
    const petId = await newPet();
    const date = daysAgo(0);
    const device = app();
    const b = await device.signIn(userB);
    device.net.online = false;
    await b.engine.saveLocal({ petId, logDate: date, content: content({ notes: 'de B, sin permiso' }), baseRow: null });
    device.net.online = true;

    const outcome = await device.flowFor(userB).syncAndSignOut();
    assert.deepEqual(outcome, { status: 'needs_decision', summary: { pending: 0, failed: 1, conflict: 0 }, attempt: 'incomplete' });
    assert.equal((await device.supabase.auth.getSession()).data.session.user.id, userB.userId);
    const failed = await b.repository.read(petId, date);
    assert.equal(failed.error.kind, 'permission');
    assert.equal(failed.pending.content.notes, 'de B, sin permiso');
    assert.equal(await serverRow(petId, date), null);
    assertAllPreconditioned(device.saves);
  });
});
