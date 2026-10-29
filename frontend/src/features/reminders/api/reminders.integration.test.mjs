// Agenda contra el Supabase LOCAL: las funciones reales de `reminders-remote.ts` con Auth, RLS
// (`can_edit_pet` / `is_pet_member`), GRANT por columna, triggers y la precondición `updated_at`.
// Propietaria, co-tutora editora, co-tutor lector y otra cuenta. `npm run test:integration`; en
// `npm test` se omiten. Nunca contra `kitom-dev`.
//
// Crean usuarios `it-…@kitom.test` (quedan en el Auth local) y mascotas que se borran al terminar (sus
// recordatorios se van en cascada).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { createClient } from '@supabase/supabase-js';

import { classifyServerError } from '../../../lib/server-errors.ts';
import { createRemindersRemote, ReminderChangedError, ReminderNotWritableError } from './reminders-remote.ts';

const URL_ = process.env.KITOM_IT_SUPABASE_URL;
const ANON_KEY = process.env.KITOM_IT_SUPABASE_ANON_KEY;
const isLocal = URL_ !== undefined && ['127.0.0.1', 'localhost'].includes(new URL(URL_).hostname);
const skip = !URL_ || !ANON_KEY ? 'sin Supabase local (npm run test:integration)' : !isLocal ? 'la URL no es local' : false;

const authOptions = { persistSession: false, autoRefreshToken: false };
const DAY = 86_400_000;

/** Una cuenta con su cliente; `net.online = false` corta la red de ese cliente. */
async function signUp() {
  const net = { online: true };
  const fetch_ = (input, init) => (net.online ? fetch(input, init) : Promise.reject(new TypeError('Network request failed')));
  const supabase = createClient(URL_, ANON_KEY, { auth: authOptions, global: { fetch: fetch_ } });
  const email = `it-${randomUUID()}@kitom.test`;
  const { data, error } = await supabase.auth.signUp({ email, password: `It-${randomUUID()}` });
  if (error || !data.session) throw error ?? new Error('El Auth local exige confirmar el email');
  return { supabase, userId: data.user.id, email, net, remote: createRemindersRemote(supabase) };
}

/** Rechazo de una escritura que no tocó filas, con su motivo. */
const notWritable = (reason) => (error) => {
  assert.ok(error instanceof ReminderNotWritableError, `${error?.name}: ${error?.message}`);
  assert.equal(error.reason, reason);
  return true;
};

const write = (overrides = {}) => ({
  type: 'medication',
  title: 'Pastilla',
  description: null,
  due_at: new Date(Date.now() + DAY).toISOString(),
  recurrence_rule: null,
  ...overrides,
});

describe('agenda contra el Supabase local', { skip }, () => {
  let owner;
  let editor;
  let viewer;
  let stranger;
  let petId;
  let otherPetId;
  const pets = [];

  before(async () => {
    [owner, editor, viewer, stranger] = await Promise.all([signUp(), signUp(), signUp(), signUp()]);
    const { data: species } = await owner.supabase.from('species').select('id').eq('is_active', true).limit(1).single();
    const createPet = async (user, name) => {
      const { data, error } = await user.supabase
        .from('pets')
        .insert({ owner_id: user.userId, name, species_id: species.id })
        .select('id')
        .single();
      if (error) throw error;
      pets.push([user, data.id]);
      return data.id;
    };
    petId = await createPet(owner, 'Kika');
    otherPetId = await createPet(stranger, 'Rex');
    // Co-tutores por email, como en la app: invitar y aceptar.
    for (const [user, role] of [
      [editor, 'editor'],
      [viewer, 'viewer'],
    ]) {
      const invited = await owner.supabase.rpc('invite_pet_member_by_email', {
        target_pet_id: petId,
        invitee_email: user.email,
        initial_role: role,
      });
      if (invited.error) throw invited.error;
      const { data: invitations, error } = await user.supabase.rpc('get_my_pet_invitations');
      if (error) throw error;
      const accepted = await user.supabase.rpc('accept_pet_invitation', { invitation_id: invitations[0].invitation_id });
      if (accepted.error) throw accepted.error;
    }
  });

  after(async () => {
    for (const [user, id] of pets) await user.supabase.from('pets').delete().eq('id', id);
  });

  it('la propietaria crea, edita, marca hecho, reabre y borra', async () => {
    const created = await owner.remote.createReminder(petId, owner.userId, write({ recurrence_rule: 'FREQ=WEEKLY' }));
    assert.equal(created.pet_id, petId);
    assert.equal(created.created_by, owner.userId);
    assert.equal(created.status, 'pending');
    assert.equal(created.recurrence_rule, 'FREQ=WEEKLY');

    const edited = await owner.remote.updateReminder(created.id, { title: 'Pastilla del corazón' }, created.updated_at);
    assert.equal(edited.title, 'Pastilla del corazón');

    const done = await owner.remote.updateReminder(created.id, { status: 'completed' }, edited.updated_at);
    assert.ok(done.completed_at, 'el trigger pone completed_at');
    const reopened = await owner.remote.updateReminder(created.id, { status: 'pending' }, done.updated_at);
    assert.equal(reopened.completed_at, null);

    await owner.remote.deleteReminder(created.id);
    assert.equal(await owner.remote.fetchReminder(created.id), null);
    await assert.rejects(owner.remote.deleteReminder(created.id), notWritable('gone'));
  });

  it('una edición con una versión ya cambiada no pisa nada (ReminderChangedError)', async () => {
    const created = await owner.remote.createReminder(petId, owner.userId, write());
    const byEditor = await editor.remote.updateReminder(created.id, { title: 'Cambiado por Edu' }, created.updated_at);
    await assert.rejects(
      owner.remote.updateReminder(created.id, { title: 'Pisado' }, created.updated_at),
      ReminderChangedError
    );
    assert.equal((await owner.remote.fetchReminder(created.id)).title, byEditor.title);
  });

  it('la co-tutora editora crea y edita; no puede crear a nombre de otra cuenta', async () => {
    const created = await editor.remote.createReminder(petId, editor.userId, write({ type: 'bath', title: 'Baño' }));
    assert.equal(created.created_by, editor.userId);
    await editor.remote.updateReminder(created.id, { due_at: new Date(Date.now() + 2 * DAY).toISOString() }, created.updated_at);
    await assert.rejects(editor.remote.createReminder(petId, owner.userId, write()), (error) => {
      assert.equal(classifyServerError(error), 'not_allowed');
      return true;
    });
  });

  it('el co-tutor lector ve la agenda pero no puede crear, editar ni borrar', async () => {
    const created = await owner.remote.createReminder(petId, owner.userId, write({ title: 'Solo lectura' }));
    const seen = await viewer.remote.fetchPetReminders(petId);
    assert.ok(seen.some((item) => item.id === created.id));
    await assert.rejects(viewer.remote.createReminder(petId, viewer.userId, write()), (error) => {
      assert.equal(error.code, '42501');
      return true;
    });
    // RLS deja la fila fuera (0 filas): se dice que falta permiso, no que otro la cambió.
    await assert.rejects(viewer.remote.updateReminder(created.id, { title: 'Lector' }, created.updated_at), notWritable('not_allowed'));
    await assert.rejects(viewer.remote.updateReminder(created.id, { title: 'Lector' }), notWritable('not_allowed'));
    await assert.rejects(viewer.remote.deleteReminder(created.id), notWritable('not_allowed'));
    // Con una versión vieja, el lector sí ve que cambió (el conflicto se comprueba antes que el permiso).
    await owner.remote.updateReminder(created.id, { description: 'Nota' }, created.updated_at);
    await assert.rejects(viewer.remote.updateReminder(created.id, { title: 'Lector' }, created.updated_at), ReminderChangedError);
    assert.equal((await owner.remote.fetchReminder(created.id)).title, 'Solo lectura');
  });

  it('otra cuenta no ve ni toca la agenda ajena (aislamiento entre cuentas)', async () => {
    const created = await owner.remote.createReminder(petId, owner.userId, write({ title: 'Privado' }));
    assert.deepEqual(await stranger.remote.fetchPetReminders(petId), []);
    assert.equal(await stranger.remote.fetchReminder(created.id), null);
    assert.ok(!(await stranger.remote.fetchPendingReminders()).some((item) => item.pet_id === petId));
    assert.ok(!(await stranger.remote.fetchUpcomingReminders()).some((item) => item.pet_id === petId));
    await assert.rejects(stranger.remote.createReminder(petId, stranger.userId, write()), (error) => {
      assert.equal(classifyServerError(error), 'not_allowed');
      return true;
    });
    await assert.rejects(stranger.remote.updateReminder(created.id, { title: 'Ajeno' }), notWritable('gone'));
    await assert.rejects(stranger.remote.deleteReminder(created.id), notWritable('gone'));
  });

  it('un recordatorio no cambia de mascota (sin GRANT de UPDATE sobre pet_id)', async () => {
    const created = await owner.remote.createReminder(petId, owner.userId, write({ title: 'Fijo' }));
    for (const target of [otherPetId, petId]) {
      const { error } = await owner.supabase.from('reminders').update({ pet_id: target }).eq('id', created.id);
      assert.equal(error?.code, '42501');
    }
    const { error } = await owner.supabase.from('reminders').update({ created_by: editor.userId }).eq('id', created.id);
    assert.equal(error?.code, '42501');
    assert.equal((await owner.remote.fetchReminder(created.id)).pet_id, petId);
  });

  it('validación del servidor: repetición fuera del contrato', async () => {
    await assert.rejects(owner.remote.createReminder(petId, owner.userId, write({ recurrence_rule: 'cada lunes' })), (error) => {
      assert.equal(classifyServerError(error), 'invalid');
      return true;
    });
  });

  it('para los avisos solo llegan los pendientes que aún tienen que sonar', async () => {
    const now = new Date();
    const future = await owner.remote.createReminder(petId, owner.userId, write({ title: 'Futuro' }));
    const overdue = await owner.remote.createReminder(
      petId,
      owner.userId,
      write({ title: 'Vencido', due_at: new Date(now.getTime() - DAY).toISOString() })
    );
    const snoozed = await owner.remote.createReminder(
      petId,
      owner.userId,
      write({ title: 'Pospuesto', due_at: new Date(now.getTime() - DAY).toISOString() })
    );
    await owner.remote.updateReminder(snoozed.id, { snooze_until: new Date(now.getTime() + 3_600_000).toISOString() });
    const done = await owner.remote.createReminder(petId, owner.userId, write({ title: 'Hecho' }));
    await owner.remote.updateReminder(done.id, { status: 'completed' });

    for (const user of [owner, editor, viewer]) {
      const ids = new Set((await user.remote.fetchUpcomingReminders(now)).map((item) => item.id));
      assert.ok(ids.has(future.id) && ids.has(snoozed.id), 'los futuros y los pospuestos a una hora futura');
      assert.ok(!ids.has(overdue.id) && !ids.has(done.id), 'ni los vencidos ni los hechos');
    }
    const pending = new Set((await owner.remote.fetchPendingReminders()).map((item) => item.id));
    assert.ok(pending.has(overdue.id) && pending.has(future.id) && !pending.has(done.id), 'el listado general sí incluye los vencidos');
  });

  it('la agenda de la mascota guarda los hechos de los últimos 30 días', async () => {
    const recent = await owner.remote.createReminder(petId, owner.userId, write({ title: 'Hecho hace poco' }));
    const old = await owner.remote.createReminder(petId, owner.userId, write({ title: 'Hecho hace mucho' }));
    await owner.remote.updateReminder(recent.id, { status: 'completed' });
    // completed_at tiene GRANT de UPDATE: se fecha atrás para probar el filtro.
    const { error } = await owner.supabase
      .from('reminders')
      .update({ status: 'completed', completed_at: new Date(Date.now() - 40 * DAY).toISOString() })
      .eq('id', old.id);
    if (error) throw error;
    const ids = new Set((await owner.remote.fetchPetReminders(petId)).map((item) => item.id));
    assert.ok(ids.has(recent.id));
    assert.ok(!ids.has(old.id));
  });

  it('desactivar y activar: editores sí, lector no; un desactivado no llega a los avisos', async () => {
    const now = new Date();
    const created = await owner.remote.createReminder(petId, owner.userId, write({ title: 'Antibiótico' }));
    assert.equal(created.is_active, true, 'se crea activo');

    const off = await editor.remote.updateReminder(created.id, { is_active: false }, created.updated_at);
    assert.equal(off.is_active, false);
    assert.equal(off.status, 'pending', 'desactivar no cambia status');
    assert.equal(off.completed_at, null);
    for (const user of [owner, editor, viewer]) {
      assert.ok(!(await user.remote.fetchUpcomingReminders(now)).some((item) => item.id === created.id), 'sin aviso');
    }
    const pendingRow = (await owner.remote.fetchPendingReminders()).find((item) => item.id === created.id);
    assert.equal(pendingRow?.is_active, false, 'el listado general lo trae (como desactivado)');

    await assert.rejects(viewer.remote.updateReminder(created.id, { is_active: true }, off.updated_at), notWritable('not_allowed'));
    await assert.rejects(owner.remote.updateReminder(created.id, { is_active: true }, created.updated_at), ReminderChangedError);

    const on = await owner.remote.updateReminder(created.id, { is_active: true }, off.updated_at);
    assert.equal(on.is_active, true);
    assert.ok((await viewer.remote.fetchUpcomingReminders(now)).some((item) => item.id === created.id), 'vuelve a avisar');
  });

  it('sin red o sin sesión: error de red o de permiso, nunca datos de otra cuenta', async () => {
    owner.net.online = false;
    try {
      await assert.rejects(owner.remote.fetchPetReminders(petId), (error) => {
        assert.equal(classifyServerError(error), 'network');
        return true;
      });
      await assert.rejects(owner.remote.createReminder(petId, owner.userId, write()), (error) => {
        assert.equal(classifyServerError(error), 'network');
        return true;
      });
    } finally {
      owner.net.online = true;
    }
    const anonymous = createRemindersRemote(createClient(URL_, ANON_KEY, { auth: authOptions }));
    await assert.rejects(anonymous.fetchPetReminders(petId), (error) => {
      assert.equal(classifyServerError(error), 'not_allowed');
      return true;
    });
  });

  it('al perder la co-tutoría se deja de ver y de poder cambiar la agenda', async () => {
    const created = await owner.remote.createReminder(petId, owner.userId, write({ title: 'Antes de salir' }));
    const { data: members, error } = await owner.supabase.rpc('get_pet_members', { target_pet_id: petId });
    if (error) throw error;
    const editorMember = members.find((member) => member.user_id === editor.userId);
    const revoked = await owner.supabase.rpc('revoke_pet_invitation', { invitation_id: editorMember.invitation_id });
    if (revoked.error) throw revoked.error;
    assert.equal(await editor.remote.fetchReminder(created.id), null);
    await assert.rejects(editor.remote.updateReminder(created.id, { title: 'Sin acceso' }), notWritable('gone'));
  });

  it('al borrar la mascota sus recordatorios desaparecen para todos', async () => {
    const created = await owner.remote.createReminder(petId, owner.userId, write({ title: 'Se va con la mascota' }));
    const { error } = await owner.supabase.from('pets').delete().eq('id', petId);
    if (error) throw error;
    pets.splice(pets.findIndex(([, id]) => id === petId), 1);
    for (const user of [owner, viewer]) {
      assert.equal(await user.remote.fetchReminder(created.id), null);
      assert.ok(!(await user.remote.fetchUpcomingReminders()).some((item) => item.pet_id === petId));
    }
  });
});
