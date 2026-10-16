// Pruebas de integración del motor de sincronización contra el Supabase LOCAL (Postgres real, RLS,
// `save_daily_log` con precondiciones). Se ejecutan con `npm run test:integration`
// (`scripts/test-integration.mjs`); en `npm test` se omiten (no hay URL). Nunca contra `kitom-dev`.
//
// Crean dos usuarios `it-…@kitom.test` (quedan en el Auth local) y mascotas que se borran al terminar.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { createClient } from '@supabase/supabase-js';

import { createOwnerAccessToken } from '../../auth/owner-session.ts';
import { createLocalStore } from '../../../lib/local-store/local-store.ts';
import { createMemoryStorage } from '../../../lib/local-store/memory-storage.ts';
import { readDailyLogThroughRepository } from './daily-log-cache.ts';
import { contentFromRow } from './daily-log-content.ts';
import { buildResolvedContent } from './daily-log-merge.ts';
import { createDailyLogRemote } from './daily-log-remote.ts';
import { createDailyLogRepository } from './daily-log-repository.ts';
import { createDailyLogSyncEngine } from './daily-log-sync-engine.ts';

const URL_ = process.env.KITOM_IT_SUPABASE_URL;
const ANON_KEY = process.env.KITOM_IT_SUPABASE_ANON_KEY;
const isLocal = URL_ !== undefined && ['127.0.0.1', 'localhost'].includes(new URL(URL_).hostname);
const skip = !URL_ || !ANON_KEY ? 'sin Supabase local (npm run test:integration)' : !isLocal ? 'la URL no es local' : false;

const client = () => createClient(URL_, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

/** Fecha `YYYY-MM-DD` de hace `days` días en UTC (perfil sin zona horaria = UTC en el servidor). */
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
  const supabase = client();
  const { data, error } = await supabase.auth.signUp({
    email: `it-${randomUUID()}@kitom.test`,
    password: `It-${randomUUID()}`,
  });
  if (error || !data.session) throw error ?? new Error('El Auth local exige confirmar el email');
  return { supabase, userId: data.user.id };
}

/** Remoto autorizado con la sesión del propietario `user` (la del cliente `supabase`, por defecto el suyo). */
const remoteOf = (user, supabase = user.supabase) =>
  createDailyLogRemote(supabase, { accessToken: createOwnerAccessToken(supabase.auth, user.userId) });

/** Un dispositivo: almacén en memoria y motor con el cliente (y la sesión) de `user`. */
function device(user, { remote = remoteOf(user) } = {}) {
  const net = { online: true };
  const repository = createDailyLogRepository(createLocalStore(createMemoryStorage(), user.userId));
  const engine = createDailyLogSyncEngine({
    repository,
    remote,
    isOnline: () => net.online,
    now: Date.now,
    createOperationId: randomUUID,
    random: () => 0,
  });
  engine.start();
  engine.setSessionUserId(user.userId);
  return {
    net,
    repository,
    engine,
    async save(petId, logDate, overrides, baseRow = null) {
      await engine.saveLocal({ petId, logDate, content: content(overrides), baseRow });
      await engine.idle();
      return repository.read(petId, logDate);
    },
    async sync() {
      await engine.requestSync();
      await engine.idle();
    },
  };
}

describe('sincronización contra el Supabase local', { skip }, () => {
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
      .insert({ name: 'Integración', species_id: speciesId, owner_id: userA.userId })
      .select('id')
      .single();
    if (error) throw error;
    pets.push(data.id);
    return data.id;
  }

  const serverRow = async (petId, logDate) =>
    (await userA.supabase.from('daily_logs').select('*').eq('pet_id', petId).eq('log_date', logDate).maybeSingle()).data;

  it('crear sin conexión y sincronizar: p_expect_absent y versión con microsegundos tal cual', async () => {
    const petId = await newPet();
    const date = daysAgo(0);
    const phone = device(userA);
    phone.net.online = false;
    assert.equal((await phone.save(petId, date, { notes: '  creado sin red  ' })).status, 'pending');
    assert.equal(await serverRow(petId, date), null);

    phone.net.online = true;
    await phone.sync();
    const local = await phone.repository.read(petId, date);
    const row = await serverRow(petId, date);
    assert.equal(local.status, 'synced');
    assert.equal(row.notes, 'creado sin red');
    assert.equal(local.baseVersion, row.updated_at);
    assert.match(local.baseVersion, /\.\d{1,6}\+00:00$/);
  });

  it('editar con p_expected_updated_at exacto contra Postgres', async () => {
    const petId = await newPet();
    const date = daysAgo(1);
    const phone = device(userA);
    const created = await phone.save(petId, date, { energy_level: 2 });
    const edited = await phone.save(petId, date, { energy_level: 5, tags: ['vet_visit'] }, created.serverRow);
    assert.equal(edited.status, 'synced');
    const row = await serverRow(petId, date);
    assert.equal(row.energy_level, 5);
    assert.deepEqual(row.tags, ['vet_visit']);
    assert.equal(edited.baseVersion, row.updated_at);
    assert.notEqual(edited.baseVersion, created.baseVersion);
  });

  it('conflicto de versión entre dos dispositivos: la edición local se conserva y el servidor no cambia', async () => {
    const petId = await newPet();
    const date = daysAgo(2);
    const phone = device(userA);
    const tablet = device(userA);
    const v1 = (await phone.save(petId, date, { energy_level: 3 })).serverRow;

    // La tableta abre el registro (v1) y se queda sin conexión; el móvil guarda otra versión.
    tablet.net.online = false;
    await tablet.save(petId, date, { energy_level: 1, notes: 'tableta' }, v1);
    await phone.save(petId, date, { energy_level: 5, notes: 'móvil' }, v1);

    tablet.net.online = true;
    await tablet.sync();
    const local = await tablet.repository.read(petId, date);
    assert.equal(local.status, 'conflict');
    assert.equal(local.conflict.detail, 'version_mismatch');
    assert.equal(local.conflict.remote.row.notes, 'móvil');
    assert.equal(local.pending.content.notes, 'tableta');
    assert.equal((await serverRow(petId, date)).notes, 'móvil');
  });

  it('creación concurrente: distinto contenido → conflicto; mismo contenido → sincronizado sin reescribir', async () => {
    const petId = await newPet();
    const phone = device(userA);
    const tablet = device(userA);
    phone.net.online = false;
    tablet.net.online = false;

    const different = daysAgo(3);
    await phone.save(petId, different, { notes: 'móvil' });
    await tablet.save(petId, different, { notes: 'tableta' });
    const same = daysAgo(4);
    await phone.save(petId, same, { notes: 'igual' });
    await tablet.save(petId, same, { notes: 'igual' });

    phone.net.online = true;
    await phone.sync();
    const writtenSame = await serverRow(petId, same);

    tablet.net.online = true;
    await tablet.sync();
    const conflict = await tablet.repository.read(petId, different);
    assert.equal(conflict.status, 'conflict');
    assert.equal(conflict.conflict.detail, 'row_exists');
    assert.equal(conflict.conflict.remote.row.notes, 'móvil');

    const synced = await tablet.repository.read(petId, same);
    assert.equal(synced.status, 'synced');
    assert.equal((await serverRow(petId, same)).updated_at, writtenSame.updated_at);
  });

  it('respuesta perdida: el servidor guardó, el cliente no lo supo; se reconcilia leyendo la fila', async () => {
    const petId = await newPet();
    const date = daysAgo(5);
    const real = remoteOf(userA);
    let drop = true;
    const lossy = {
      ...real,
      async save(args) {
        const result = await real.save(args);
        if (drop && result.ok) {
          drop = false;
          return { ok: false, error: { message: 'TypeError: Network request failed', code: '' }, status: null };
        }
        return result;
      },
    };
    const phone = device(userA, { remote: lossy });
    const pending = await phone.save(petId, date, { notes: 'llegó, pero no la respuesta' });
    assert.equal(pending.status, 'pending');
    const written = await serverRow(petId, date);
    assert.equal(written.notes, 'llegó, pero no la respuesta');

    await phone.engine.retry(petId, date);
    await phone.engine.idle();
    const local = await phone.repository.read(petId, date);
    assert.equal(local.status, 'synced');
    assert.equal(local.baseVersion, written.updated_at);
    assert.equal((await serverRow(petId, date)).updated_at, written.updated_at);
  });

  it('permisos: otro usuario no puede escribir en la mascota; falla sin reintento y conserva los datos', async () => {
    const petId = await newPet();
    const date = daysAgo(0);
    const intruder = device(userB);
    const local = await intruder.save(petId, date, { notes: 'no debería' });
    assert.equal(local.status, 'failed');
    assert.equal(local.error.kind, 'permission');
    assert.equal(local.pending.content.notes, 'no debería');
    assert.equal(await serverRow(petId, date), null);
  });

  /** Conflicto de versión real: la tableta editó sin conexión sobre v1 y el móvil guardó v2. */
  async function versionConflict(petId, date, { remote } = {}) {
    const phone = device(userA);
    const tablet = device(userA, remote ? { remote } : undefined);
    const v1 = (await phone.save(petId, date, { energy_level: 3, notes: 'base' })).serverRow;
    tablet.net.online = false;
    await tablet.save(petId, date, { energy_level: 5, notes: 'tableta' }, v1);
    await phone.save(petId, date, { energy_level: 3, mood_level: 1, notes: 'móvil' }, v1);
    tablet.net.online = true;
    await tablet.sync();
    const local = await tablet.repository.read(petId, date);
    assert.equal(local.status, 'conflict');
    return { phone, tablet, local };
  }

  /** Lo que construye la pantalla de conflictos con la estrategia elegida. */
  function decision(local, strategy, resolutions) {
    const remoteRow = local.conflict.remote.row;
    const result = buildResolvedContent(
      { base: contentFromRow(local.serverRow), local: local.pending.content, remote: contentFromRow(remoteRow) },
      strategy,
      resolutions
    );
    assert.equal(result.status, 'merged');
    return { action: 'save', content: result.content, shownRemote: remoteRow };
  }

  it('resolver un conflicto combinando: se envía con la precondición de la versión mostrada', async () => {
    const petId = await newPet();
    const date = daysAgo(3);
    const { tablet, local } = await versionConflict(petId, date);

    const outcome = await tablet.engine.resolveConflict(
      petId,
      date,
      decision(local, 'combine', { notes: { text: 'tableta y móvil, revisada' } })
    );
    assert.equal(outcome, 'synced');
    const row = await serverRow(petId, date);
    assert.equal(row.energy_level, 5); // solo lo cambió la tableta
    assert.equal(row.mood_level, 1); // solo lo cambió el móvil
    assert.equal(row.notes, 'tableta y móvil, revisada'); // decisión explícita
    assert.equal((await tablet.repository.read(petId, date)).baseVersion, row.updated_at);
  });

  it('carrera durante el guardado de la resolución: otro guardado entre la lectura y el envío → conflicto otra vez', async () => {
    const petId = await newPet();
    const date = daysAgo(4);
    const real = remoteOf(userA);
    let race = null;
    const racing = {
      ...real,
      async save(args) {
        if (race) {
          const run = race;
          race = null;
          await run();
        }
        return real.save(args);
      },
    };
    const { phone, tablet, local } = await versionConflict(petId, date, { remote: racing });
    race = () => phone.save(petId, date, { energy_level: 2, notes: 'se coló' }, local.conflict.remote.row);

    const outcome = await tablet.engine.resolveConflict(petId, date, decision(local, 'local'));
    assert.equal(outcome, 'conflict');
    assert.equal((await serverRow(petId, date)).notes, 'se coló');
    const again = await tablet.repository.read(petId, date);
    assert.equal(again.pending.content.notes, 'tableta'); // la decisión se conserva
    assert.equal(again.conflict.remote.row.notes, 'se coló');

    // Se vuelve a resolver sobre la versión nueva.
    assert.equal(await tablet.engine.resolveConflict(petId, date, decision(again, 'local')), 'synced');
    assert.equal((await serverRow(petId, date)).notes, 'tableta');
  });

  it('resolver aceptando la versión del servidor no escribe nada', async () => {
    const petId = await newPet();
    const date = daysAgo(5);
    const { tablet, local } = await versionConflict(petId, date);
    const before = await serverRow(petId, date);
    assert.equal(await tablet.engine.resolveConflict(petId, date, decision(local, 'remote')), 'synced');
    assert.equal((await serverRow(petId, date)).updated_at, before.updated_at);
  });

  it('sin sesión válida en el cliente (token caducado o cerrado): espera, sin gastar intentos', async () => {
    const petId = await newPet();
    const date = daysAgo(1);
    // El motor cree que la sesión es la de A, pero el cliente ya no tiene sesión: no sale ninguna petición.
    const phone = device(userA, { remote: remoteOf(userA, client()) });
    const local = await phone.save(petId, date, { notes: 'esperando sesión' });
    assert.equal(local.status, 'pending');
    assert.equal(local.error.kind, 'auth');
    assert.equal(local.pending.attempts, 0);
  });

  /** Remoto que cuenta las peticiones (para comprobar que algo no llama al servidor). */
  function counting(remote) {
    const calls = [];
    return {
      calls,
      remote: {
        save: (args) => (calls.push('save'), remote.save(args)),
        fetch: (petId, logDate) => (calls.push('fetch'), remote.fetch(petId, logDate)),
      },
    };
  }

  it('401 real: más disparadores con la misma sesión no reenvían nada', async () => {
    const petId = await newPet();
    const date = daysAgo(1);
    // Token que el servidor rechaza (como uno caducado): 401 de PostgREST.
    const { calls, remote } = counting(createDailyLogRemote(client(), { accessToken: async () => ({ status: 'ok', token: 'caducado' }) }));
    const phone = device(userA, { remote });
    await phone.save(petId, date, { notes: 'esperando sesión' });
    assert.deepEqual(calls, ['save']);
    await phone.sync();
    await phone.sync();
    assert.deepEqual(calls, ['save']);
    assert.equal((await phone.repository.read(petId, date)).error.kind, 'auth');
  });

  it('lectura tardía contra Postgres: la versión confirmada (microsegundos) no retrocede', async () => {
    const petId = await newPet();
    const date = daysAgo(2);
    const phone = device(userA);
    const v1 = (await phone.save(petId, date, { notes: 'v1' })).serverRow;
    // Una lectura empieza (y obtiene v1) antes de que el motor confirme v2.
    let release;
    const late = readDailyLogThroughRepository(phone.repository, petId, date, async () => {
      const row = await serverRow(petId, date);
      await new Promise((resolve) => (release = resolve));
      return row;
    });
    while (!release) await new Promise((resolve) => setTimeout(resolve, 10));
    const v2 = (await phone.save(petId, date, { notes: 'v2' }, v1)).serverRow;
    release();
    const shown = await late;
    assert.equal(shown.updated_at, v2.updated_at);
    assert.equal((await phone.repository.read(petId, date)).baseVersion, v2.updated_at);
    assert.equal((await serverRow(petId, date)).notes, 'v2');
  });

  it('descartar tras un 42501 real: solo local, sin ninguna petición y sin tocar el servidor', async () => {
    const petId = await newPet();
    const date = daysAgo(0);
    const owner = device(userA);
    const existing = (await owner.save(petId, date, { notes: 'del dueño' })).serverRow;
    const { calls, remote } = counting(remoteOf(userB));
    const intruder = device(userB, { remote });
    // B no puede ver ni editar la mascota: su edición falla con permisos.
    const failed = await intruder.save(petId, date, { notes: 'de B' }, existing);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error.kind, 'permission');
    calls.length = 0;

    assert.equal(await intruder.engine.discardLocalChanges(petId, date), 'discarded');
    assert.deepEqual(calls, []);
    const kept = await intruder.repository.read(petId, date);
    assert.equal(kept.status, 'synced');
    assert.equal(kept.serverRow.updated_at, existing.updated_at);
    const server = await serverRow(petId, date);
    assert.equal(server.notes, 'del dueño');
    assert.equal(server.updated_at, existing.updated_at);
  });
});
