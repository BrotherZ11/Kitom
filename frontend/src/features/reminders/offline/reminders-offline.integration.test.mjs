// Agenda sin conexión (fase 14) contra el Supabase LOCAL, con Auth, RLS, el índice de la clave y un cliente de Supabase
// COMPARTIDO, como en la app. `npm run test:integration`; en `npm test` se omiten. Nunca contra `kitom-dev`.
// Los números son los casos del encargo. Crean usuarios `it-…@kitom.test` y mascotas que se borran al terminar.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { createClient } from '@supabase/supabase-js';

import { createOwnerAccessToken } from '../../auth/owner-session.ts';
import { createLocalStore } from '../../../lib/local-store/local-store.ts';
import { createMemoryStorage } from '../../../lib/local-store/memory-storage.ts';
import { createReminderReadsRemote, createReminderWritesRemote } from '../api/reminder-writes-remote.ts';
import { createReminderCacheRepository, petScope } from './reminder-cache-repository.ts';
import { createReminderOperationRepository } from './reminder-operation-repository.ts';
import { createReminderSyncEngine } from './reminder-sync-engine.ts';

const URL_ = process.env.KITOM_IT_SUPABASE_URL;
const ANON_KEY = process.env.KITOM_IT_SUPABASE_ANON_KEY;
const isLocal = URL_ !== undefined && ['127.0.0.1', 'localhost'].includes(new URL(URL_).hostname);
const skip = !URL_ || !ANON_KEY ? 'sin Supabase local (npm run test:integration)' : !isLocal ? 'la URL no es local' : false;

const authOptions = { persistSession: false, autoRefreshToken: false };

async function signUp() {
  const supabase = createClient(URL_, ANON_KEY, { auth: authOptions });
  const email = `it-${randomUUID()}@kitom.test`;
  const password = `It-${randomUUID()}`;
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error || !data.session) throw error ?? new Error('El Auth local exige confirmar el email');
  return { supabase, userId: data.user.id, email, password };
}

const subjectOf = (authorization) => {
  try {
    return JSON.parse(Buffer.from(authorization.split(' ')[1].split('.')[1], 'base64url').toString()).sub ?? null;
  } catch {
    return null;
  }
};

/** Un dispositivo: un cliente compartido, una red que se corta y altas o ediciones cuya respuesta se pierde. */
function app(disk = new Map()) {
  const net = { online: true };
  const requests = [];
  let lose = null;
  const fetch_ = async (input, init) => {
    if (!net.online) throw new TypeError('Network request failed');
    const url = String(input instanceof Request ? input.url : input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = new URL(url).pathname;
    if (path === '/rest/v1/reminders') requests.push({ method, userId: subjectOf(new Headers(init?.headers).get('Authorization')) });
    const response = await fetch(input, init);
    if (path === '/rest/v1/reminders' && lose === method) {
      lose = null;
      throw new TypeError('Network request failed');
    }
    return response;
  };
  const supabase = createClient(URL_, ANON_KEY, { auth: authOptions, global: { fetch: fetch_ } });
  const engines = new Map();
  const sessionFor = (userId) => {
    if (!engines.has(userId)) {
      const store = createLocalStore(createMemoryStorage(disk), userId);
      const operations = createReminderOperationRepository(store);
      const cache = createReminderCacheRepository(store);
      const accessToken = createOwnerAccessToken(supabase.auth, userId);
      const engine = createReminderSyncEngine({
        operations,
        cache,
        remote: createReminderWritesRemote(supabase, { ownerUserId: userId, accessToken }),
        isOnline: () => net.online,
        now: Date.now,
        createOperationId: randomUUID,
        random: () => 0,
      });
      engines.set(userId, { operations, cache, engine, reads: createReminderReadsRemote(supabase, { accessToken }) });
    }
    return engines.get(userId);
  };
  return {
    net,
    requests,
    disk,
    supabase,
    sessionFor,
    loseNext: (method) => (lose = method),
    async signIn(user) {
      const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: user.password });
      if (error) throw error;
      for (const [id, other] of engines) {
        if (id !== user.userId) {
          other.engine.stop();
          other.engine.setSessionUserId(null);
        }
      }
      const session = sessionFor(user.userId);
      session.engine.start();
      session.engine.setSessionUserId(user.userId);
      return session;
    },
  };
}

const content = (overrides = {}) => ({
  type: 'vaccine',
  title: 'Rabia',
  description: null,
  due_at: new Date(Date.now() + 86_400_000).toISOString(),
  recurrence_rule: null,
  snooze_until: null,
  status: 'pending',
  completed_at: null,
  is_active: true,
  ...overrides,
});

describe('agenda sin conexión contra el Supabase local', { skip }, () => {
  let owner;
  let editor;
  let viewer;
  let species;
  const pets = [];

  const createPet = async (user = owner) => {
    const { data, error } = await user.supabase
      .from('pets')
      .insert({ owner_id: user.userId, name: 'Kika', species_id: species })
      .select('id')
      .single();
    if (error) throw error;
    pets.push({ id: data.id, user });
    return data.id;
  };

  const share = async (petId, invitee, role, by = owner) => {
    const invite = await by.supabase.rpc('invite_pet_member', { target_pet_id: petId, invitee_user_id: invitee.userId, initial_role: role });
    if (invite.error) throw invite.error;
    const { data } = await invitee.supabase.from('pet_co_owners').select('id').eq('pet_id', petId).eq('user_id', invitee.userId).single();
    const accepted = await invitee.supabase.rpc('accept_pet_invitation', { invitation_id: data.id });
    if (accepted.error) throw accepted.error;
  };

  const rowsOf = async (petId, user = owner) => {
    const { data, error } = await user.supabase.from('reminders').select('*').eq('pet_id', petId);
    if (error) throw error;
    return data;
  };

  before(async () => {
    owner = await signUp();
    editor = await signUp();
    viewer = await signUp();
    const { data, error } = await owner.supabase.from('species').select('id').eq('code', 'dog').single();
    if (error) throw error;
    species = data.id;
  });

  after(async () => {
    for (const { id, user } of pets) await user.supabase.from('pets').delete().eq('id', id);
  });

  it('1 y 2. primera carga, copia y lectura al reiniciar sin conexión', async () => {
    const petId = await createPet();
    await owner.supabase.from('reminders').insert({ pet_id: petId, created_by: owner.userId, ...content({ title: 'Del servidor' }) });
    const device = app();
    const { cache, reads } = await device.signIn(owner);
    const mark = cache.beginRead();
    const rows = await reads.petReminders(petId);
    await cache.applyScope(mark, petScope(petId), rows, { complete: true });
    device.net.online = false;
    const restarted = createReminderCacheRepository(createLocalStore(createMemoryStorage(device.disk), owner.userId));
    const saved = await restarted.readScope(petScope(petId));
    assert.deepEqual(saved.reminders.map((row) => row.title), ['Del servidor']);
  });

  it('4 y 19. crear sin conexión y sincronizar una vez, aunque se pida varias', async () => {
    const petId = await createPet();
    const device = app();
    device.net.online = false;
    const { engine, operations } = await (async () => {
      device.net.online = true;
      const session = await device.signIn(owner);
      device.net.online = false;
      return session;
    })();
    const saved = await engine.saveCreate(petId, content({ title: 'Sin red' }));
    await engine.idle();
    assert.equal((await rowsOf(petId)).length, 0);
    device.net.online = true;
    await Promise.all([engine.requestSync(), engine.requestSync()]);
    await engine.requestSync();
    const rows = await rowsOf(petId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].client_request_id, saved.operationId);
    assert.equal((await operations.read(saved.localId)).status, 'synced');
    assert.ok(device.requests.every((request) => request.userId === owner.userId), 'con el token del dueño');
  });

  it('8. respuesta perdida tras crear: 23505 real, lectura por la clave y sin duplicar', async () => {
    const petId = await createPet();
    const device = app();
    const { engine, operations } = await device.signIn(owner);
    device.loseNext('POST');
    const saved = await engine.saveCreate(petId, content({ title: 'Perdida' }));
    await engine.idle();
    let op = await operations.read(saved.localId);
    assert.notEqual(op.inFlightSince, null);
    assert.equal((await rowsOf(petId)).length, 1, 'se creó');
    await operations.update(saved.localId, (current) => ({ ...current, nextAttemptAt: null }));
    await engine.requestSync();
    op = await operations.read(saved.localId);
    assert.equal(op.status, 'synced');
    const rows = await rowsOf(petId);
    assert.equal(rows.length, 1, 'no se duplica');
    assert.equal(op.reminderId, rows[0].id);
  });

  it('14. reinicio con una operación incierta: otra instancia termina el trabajo', async () => {
    const petId = await createPet();
    const device = app();
    const { engine } = await device.signIn(owner);
    device.loseNext('POST');
    const saved = await engine.saveCreate(petId, content({ title: 'Incierta' }));
    await engine.idle();
    engine.stop();
    const restarted = app(device.disk);
    const session = await restarted.signIn(owner);
    await session.operations.update(saved.localId, (current) => ({ ...current, nextAttemptAt: null }));
    await session.engine.requestSync();
    assert.equal((await session.operations.read(saved.localId)).status, 'synced');
    assert.equal((await rowsOf(petId)).length, 1);
  });

  it('5, 6 y 7. editar, desactivar y eliminar sin conexión', async () => {
    const petId = await createPet();
    const device = app();
    const { engine, operations, cache } = await device.signIn(owner);
    const { data: row } = await owner.supabase
      .from('reminders')
      .insert({ pet_id: petId, created_by: owner.userId, ...content() })
      .select('id, pet_id, type, title, description, due_at, snooze_until, recurrence_rule, status, is_active, completed_at, attachment_path, created_by, created_at, updated_at')
      .single();
    await cache.applyReminder(cache.beginRead(), row.id, row);

    device.net.online = false;
    await engine.saveEdit(row.id, { title: 'Editada', is_active: false }, row);
    await engine.idle();
    device.net.online = true;
    await engine.requestSync();
    let [server] = await rowsOf(petId);
    assert.deepEqual([server.title, server.is_active], ['Editada', false]);
    assert.equal(await operations.read(row.id), null);

    // «Hecho» conserva la hora real aunque se envíe después.
    const doneAt = new Date(Date.now() - 3_600_000).toISOString();
    device.net.online = false;
    const cached = (await cache.readReminder(row.id)).reminder;
    await engine.saveEdit(row.id, { status: 'completed', completed_at: doneAt }, cached);
    device.net.online = true;
    await engine.requestSync();
    [server] = await rowsOf(petId);
    assert.equal(server.status, 'completed');
    assert.equal(Date.parse(server.completed_at), Date.parse(doneAt), 'el trigger respeta la hora enviada');

    device.net.online = false;
    await engine.requestDelete(row.id, (await cache.readReminder(row.id)).reminder);
    device.net.online = true;
    await engine.requestSync();
    assert.equal((await rowsOf(petId)).length, 0);
    assert.equal((await operations.read(row.id)).status, 'synced', 'lápida');
  });

  it('9. conflicto entre dos sesiones reales: no pisa y se resuelve', async () => {
    const petId = await createPet();
    await share(petId, editor, 'editor');
    const device = app();
    const { engine, operations } = await device.signIn(owner);
    const { data: row } = await owner.supabase
      .from('reminders')
      .insert({ pet_id: petId, created_by: owner.userId, ...content() })
      .select('id, pet_id, type, title, description, due_at, snooze_until, recurrence_rule, status, is_active, completed_at, attachment_path, created_by, created_at, updated_at')
      .single();
    device.net.online = false;
    await engine.saveEdit(row.id, { title: 'Mío' }, row);
    const edit = await editor.supabase.from('reminders').update({ title: 'Suyo' }).eq('id', row.id);
    assert.equal(edit.error, null);
    device.net.online = true;
    await engine.requestSync();
    const op = await operations.read(row.id);
    assert.equal(op.status, 'conflict');
    assert.equal((await rowsOf(petId))[0].title, 'Suyo');
    assert.equal(await engine.resolveConflict(row.id, { choice: 'local', shownRemote: op.conflictRemote }), 'synced');
    assert.equal((await rowsOf(petId))[0].title, 'Mío');
  });

  it('10. permiso revocado antes de sincronizar: RLS real, se conserva y no se duplica', async () => {
    const petId = await createPet();
    await share(petId, editor, 'editor');
    const device = app();
    const { engine, operations } = await device.signIn(editor);
    const { data: row } = await owner.supabase
      .from('reminders')
      .insert({ pet_id: petId, created_by: owner.userId, ...content() })
      .select('id, pet_id, type, title, description, due_at, snooze_until, recurrence_rule, status, is_active, completed_at, attachment_path, created_by, created_at, updated_at')
      .single();
    device.net.online = false;
    const created = await engine.saveCreate(petId, content({ title: 'Del editor' }));
    await engine.saveEdit(row.id, { title: 'Edición del editor' }, row);
    await engine.idle();

    const { data: membership } = await owner.supabase.from('pet_co_owners').select('id').eq('pet_id', petId).eq('user_id', editor.userId).single();
    const demoted = await owner.supabase.rpc('change_pet_member_role', { invitation_id: membership.id, new_role: 'viewer' });
    assert.equal(demoted.error, null);
    device.net.online = true;
    await engine.requestSync();
    const createOp = await operations.read(created.localId);
    const editOp = await operations.read(row.id);
    assert.equal(createOp.status, 'forbidden', 'alta: 42501');
    assert.equal(editOp.status, 'forbidden', 'edición: 0 filas con la misma versión');
    assert.equal(createOp.content.title, 'Del editor');
    const rows = await rowsOf(petId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, 'Rabia');
    assert.equal(await engine.discard(created.localId), 'discarded');
  });

  it('un lector no crea aunque lo intente (RLS), y sin conexión queda `forbidden` al enviar', async () => {
    const petId = await createPet();
    await share(petId, viewer, 'viewer');
    const device = app();
    const { engine, operations } = await device.signIn(viewer);
    const saved = await engine.saveCreate(petId, content({ title: 'Del lector' }));
    await engine.idle();
    assert.equal((await operations.read(saved.localId)).status, 'forbidden');
    assert.equal((await rowsOf(petId)).length, 0);
  });

  it('11 y 18. cambio de cuenta con pendientes: cada operación sale con su dueño y solo con él', async () => {
    const petA = await createPet(owner);
    const petB = await createPet(editor);
    const device = app();
    const a = await device.signIn(owner);
    device.net.online = false;
    const fromA = await a.engine.saveCreate(petA, content({ title: 'De A' }));
    await a.engine.idle();

    device.net.online = true;
    const b = await device.signIn(editor);
    await b.engine.saveCreate(petB, content({ title: 'De B' }));
    await b.engine.idle();
    assert.equal((await a.operations.read(fromA.localId)).status, 'pending', 'lo de A sigue sin enviar');
    assert.equal((await rowsOf(petA)).length, 0);
    assert.deepEqual((await b.operations.list()).map((op) => op.content.title), ['De B']);
    assert.ok(device.requests.every((request) => request.userId === editor.userId), 'nada de A sale con la sesión de B');

    const backToA = await device.signIn(owner);
    await backToA.engine.requestSync();
    const rows = await rowsOf(petA);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].created_by, owner.userId);
  });

  it('16. mascota borrada mientras había operaciones: el servidor rechaza y nada resucita', async () => {
    const petId = await createPet();
    const device = app();
    const { engine, operations } = await device.signIn(owner);
    device.net.online = false;
    const saved = await engine.saveCreate(petId, content({ title: 'Huérfana' }));
    await engine.idle();
    const removed = await owner.supabase.from('pets').delete().eq('id', petId);
    assert.equal(removed.error, null);
    device.net.online = true;
    await engine.requestSync();
    assert.equal((await operations.read(saved.localId)).status, 'forbidden');
    assert.equal((await rowsOf(petId)).length, 0);
  });
});
