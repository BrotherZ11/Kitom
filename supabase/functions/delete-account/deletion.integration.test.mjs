// delete-account contra el Supabase LOCAL: Auth, PostgREST, RLS, las RPC, el trigger de pets y la API de
// Storage reales, con el mismo manejador HTTP que sirve la función (deletion.ts + rest.ts).
// `node supabase/functions/delete-account/run-integration.mjs`; sin esas variables se omite. Nunca contra
// `kitom-dev`.
//
// Crea sus propios usuarios `it-del-…@kitom.test`, mascotas, co-tutores, fotos y un avatar, y al terminar
// borra lo que queda (mascotas, objetos y usuarios). Si el bucket `avatars` no existe en el local, lo crea
// (privado) y lo borra al final. Quedan en la cola privada los trabajos de limpieza de las mascotas
// borradas, ya sin objetos (los cierra pet-storage-cleanup; sin SQL desde aquí).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { CONFIRM_TOKEN, expectedFromPlan, GatewayError, handleDeleteAccountRequest } from './deletion.ts';
import { createRestAdmin, createRestAuth, createRestUserGateway } from './rest.ts';

const URL_ = process.env.KITOM_IT_SUPABASE_URL;
const ANON_KEY = process.env.KITOM_IT_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.KITOM_IT_SUPABASE_SERVICE_ROLE_KEY;
const isLocal = URL_ !== undefined && ['127.0.0.1', 'localhost'].includes(new URL(URL_).hostname);
const skip = !URL_ || !ANON_KEY || !SERVICE_KEY ? 'sin Supabase local (run-integration.mjs)' : !isLocal ? 'la URL no es local' : false;

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);

async function api(path, { method = 'GET', token, key = ANON_KEY, body, headers = {} } = {}) {
  const response = await fetch(`${URL_}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token ?? key}`,
      ...(body !== undefined && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

/** Lecturas y limpieza con la clave de servicio (sin RLS), solo en la prueba. */
const admin = (path, options = {}) => api(path, { ...options, key: SERVICE_KEY });

async function signUp(fullName) {
  const email = `it-del-${randomUUID()}@kitom.test`;
  const { status, data } = await api('/auth/v1/signup', { method: 'POST', body: { email, password: `It-${randomUUID()}` } });
  assert.equal(status, 200, 'el Auth local no exige confirmar el email');
  const user = { id: data.user.id, token: data.access_token };
  if (fullName) {
    const updated = await api(`/rest/v1/profiles?id=eq.${user.id}`, { method: 'PATCH', token: user.token, body: { full_name: fullName } });
    assert.equal(updated.status, 204);
  }
  return user;
}

const rpc = (user, name, args) => api(`/rest/v1/rpc/${name}`, { method: 'POST', token: user.token, body: args });

const uploadTo = (bucket, user, name) =>
  api(`/storage/v1/object/${bucket}/${name}`, {
    method: 'POST',
    token: user.token,
    body: JPEG,
    headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'false' },
  });

/** Nombres de objetos de una carpeta (lectura con la clave de servicio). */
async function objectsIn(bucket, folder) {
  const { status, data } = await admin(`/storage/v1/object/list/${bucket}`, { method: 'POST', body: { prefix: folder, limit: 100, offset: 0 } });
  if (status !== 200 || !Array.isArray(data)) return [];
  return data.filter((item) => item.id !== null).map((item) => `${folder}/${item.name}`);
}

const ownerOf = async (petId) => (await admin(`/rest/v1/pets?select=owner_id&id=eq.${petId}`)).data[0]?.owner_id ?? null;

/** Deps reales del manejador, con el JWT que llegue en la petición; `adminOverride` para simular un fallo. */
const realDeps = (adminOverride) => ({ url, anonKey, serviceKey, token }) => ({
  auth: createRestAuth({ url, apiKey: anonKey }),
  user: createRestUserGateway({ url, apiKey: anonKey, token }),
  admin: adminOverride ?? createRestAdmin({ url, apiKey: serviceKey }),
  log: () => {},
});

async function invoke(user, body, adminOverride) {
  const request = new Request(`${URL_}/functions/v1/delete-account`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const logs = [];
  const response = await handleDeleteAccountRequest(
    request,
    { supabaseUrl: URL_, anonKey: ANON_KEY, serviceKey: SERVICE_KEY },
    realDeps(adminOverride),
    (event, fields) => logs.push({ event, ...fields })
  );
  return { status: response.status, body: await response.json(), logs };
}

describe('delete-account contra el Supabase local', { skip }, () => {
  /** Quien borra su cuenta. */
  let me;
  /** Editoras de Rex (Bea acepta antes que Eva), lector de Kika y propietaria de Luna. */
  let bea;
  let eva;
  let carl;
  let dora;
  let speciesId;
  let createdAvatarsBucket = false;
  const pets = {};
  const users = [];

  const createPet = async (owner, name) => {
    const { status, data } = await api('/rest/v1/pets', {
      method: 'POST',
      token: owner.token,
      body: { owner_id: owner.id, name, species_id: speciesId },
      headers: { Prefer: 'return=representation' },
    });
    assert.equal(status, 201);
    return data[0].id;
  };

  /** Invita (como propietario) y, si se pide, acepta (como invitado). */
  const share = async (owner, petId, invitee, role, accept = true) => {
    const invited = await rpc(owner, 'invite_pet_member', { target_pet_id: petId, invitee_user_id: invitee.id, initial_role: role });
    assert.ok([200, 204].includes(invited.status), JSON.stringify(invited.data));
    if (!accept) return;
    const { data } = await api(`/rest/v1/pet_co_owners?select=id&pet_id=eq.${petId}&user_id=eq.${invitee.id}`, { token: invitee.token });
    const accepted = await rpc(invitee, 'accept_pet_invitation', { invitation_id: data[0].id });
    assert.ok([200, 204].includes(accepted.status), JSON.stringify(accepted.data));
  };

  before(async () => {
    const bucket = await admin('/storage/v1/bucket/avatars');
    if (bucket.status !== 200) {
      const created = await admin('/storage/v1/bucket', { method: 'POST', body: { id: 'avatars', name: 'avatars', public: false } });
      assert.equal(created.status, 200, 'crear el bucket avatars local');
      createdAvatarsBucket = true;
    }
    me = await signUp(null);
    bea = await signUp('Bea');
    eva = await signUp('Eva');
    carl = await signUp('Carl');
    dora = await signUp('Dora');
    users.push(me, bea, eva, carl, dora);
    const { data } = await api('/rest/v1/species?select=id&code=eq.dog', { token: me.token });
    speciesId = data[0].id;

    pets.rex = await createPet(me, 'Rex');
    pets.kika = await createPet(me, 'Kika');
    pets.luna = await createPet(dora, 'Luna');
    await share(me, pets.rex, bea, 'editor');
    await share(me, pets.rex, eva, 'editor');
    await share(me, pets.kika, carl, 'viewer');
    await share(me, pets.kika, bea, 'editor', false); // pendiente: no cuenta
    await share(dora, pets.luna, me, 'viewer');

    assert.equal((await uploadTo('pet-photos', me, `${pets.rex}/${randomUUID()}.jpg`)).status, 200);
    assert.equal((await uploadTo('pet-photos', me, `${pets.kika}/${randomUUID()}.jpg`)).status, 200);
    assert.equal((await uploadTo('avatars', me, `${me.id}/${randomUUID()}.jpg`)).status, 200);
  });

  after(async () => {
    // Lo que quede de cada mascota (sus fotos y la fila) y los usuarios, con la clave de servicio.
    for (const petId of Object.values(pets)) {
      const names = await objectsIn('pet-photos', petId);
      if (names.length) await admin('/storage/v1/object/pet-photos', { method: 'DELETE', body: { prefixes: names } });
      await admin(`/rest/v1/pets?id=eq.${petId}`, { method: 'DELETE' });
    }
    for (const user of users) {
      const avatars = await objectsIn('avatars', user.id);
      if (avatars.length) await admin('/storage/v1/object/avatars', { method: 'DELETE', body: { prefixes: avatars } });
      await admin(`/auth/v1/admin/users/${user.id}`, { method: 'DELETE' });
    }
    if (createdAvatarsBucket) await admin('/storage/v1/bucket/avatars', { method: 'DELETE' });
  });

  it('preview: Rex pasa a Bea (editora más antigua), Kika se borra, Luna solo se deja', async () => {
    const { status, body } = await invoke(me, { mode: 'preview' });
    assert.equal(status, 200);
    assert.deepEqual(body, {
      status: 'preview',
      plan: {
        transfer: [{ pet_id: pets.rex, pet_name: 'Rex', new_owner_id: bea.id, new_owner_name: 'Bea' }],
        delete: [{ pet_id: pets.kika, pet_name: 'Kika' }],
        leave_shared: 1,
      },
    });
  });

  it('lo confirmado no coincide: 409 con el plan y nada cambia', async () => {
    const { status, body } = await invoke(me, {
      mode: 'delete',
      confirm: CONFIRM_TOKEN,
      expected: [
        { pet_id: pets.rex, action: 'transfer', new_owner_id: eva.id },
        { pet_id: pets.kika, action: 'delete' },
      ],
    });
    assert.equal(status, 409);
    assert.equal(body.error, 'plan_changed');
    assert.equal(await ownerOf(pets.rex), me.id);
    assert.equal(await ownerOf(pets.kika), me.id);
  });

  it('JWT inválido: 401 sin tocar nada', async () => {
    const { status } = await invoke({ token: 'not-a-jwt' }, { mode: 'preview' });
    assert.equal(status, 401);
  });

  it('borrado con un fallo al final: lo hecho queda hecho y el reintento converge', async () => {
    const preview = await invoke(me, { mode: 'preview' });
    const failing = { deleteUser: async () => { throw new GatewayError('simulated'); } };
    const first = await invoke(me, { mode: 'delete', confirm: CONFIRM_TOKEN, expected: expectedFromPlan(preview.body.plan) }, failing);
    assert.equal(first.status, 500);
    assert.deepEqual(first.body, { error: 'deletion_incomplete', step: 'delete_user', transferred: 1, deleted: 1, avatars_removed: 1 });
    assert.equal(await ownerOf(pets.rex), bea.id, 'Rex ya es de Bea');
    assert.equal(await ownerOf(pets.kika), null, 'Kika ya no existe');

    // Desde el estado actual: nada que transferir ni borrar; Rex y Luna, compartidas con él.
    const replanned = await invoke(me, { mode: 'preview' });
    assert.deepEqual(replanned.body.plan, { transfer: [], delete: [], leave_shared: 2 });

    const second = await invoke(me, { mode: 'delete', confirm: CONFIRM_TOKEN, expected: expectedFromPlan(preview.body.plan) });
    assert.deepEqual([second.status, second.body], [200, { status: 'deleted', transferred: 0, deleted: 0, avatars_removed: 0 }]);
  });

  it('estado final: 0 filas y 0 objetos del usuario; Rex intacta con Bea; Kika borrada y su limpieza encolada', async () => {
    assert.equal((await admin(`/auth/v1/admin/users/${me.id}`)).status, 404, 'usuario de Auth borrado');
    assert.deepEqual((await admin(`/rest/v1/profiles?select=id&id=eq.${me.id}`)).data, []);
    assert.deepEqual((await admin(`/rest/v1/pets?select=id&owner_id=eq.${me.id}`)).data, []);
    assert.deepEqual((await admin(`/rest/v1/pet_co_owners?select=id&user_id=eq.${me.id}`)).data, []);
    assert.deepEqual((await admin(`/rest/v1/notification_preferences?select=user_id&user_id=eq.${me.id}`)).data, []);
    assert.deepEqual(await objectsIn('avatars', me.id), []);

    // Rex: de Bea, con sus datos y su foto; Eva sigue de editora.
    const { data: rex } = await api(`/rest/v1/pets?select=id,name,owner_id&id=eq.${pets.rex}`, { token: bea.token });
    assert.deepEqual(rex, [{ id: pets.rex, name: 'Rex', owner_id: bea.id }]);
    assert.equal((await objectsIn('pet-photos', pets.rex)).length, 1);
    const { data: members } = await rpc(bea, 'get_pet_members', { target_pet_id: pets.rex });
    assert.deepEqual(members.map((m) => [m.user_id, m.role, m.status]), [[eva.id, 'editor', 'accepted']]);

    // Kika: borrada; su carpeta en pet-photos tiene un trabajo de limpieza pendiente.
    assert.deepEqual((await admin(`/rest/v1/pets?select=id&id=eq.${pets.kika}`)).data, []);
    assert.deepEqual((await admin(`/rest/v1/pet_co_owners?select=id&pet_id=eq.${pets.kika}`)).data, []);
    const audit = await admin('/rest/v1/rpc/pet_storage_cleanup_audit', { method: 'POST', body: { p_limit: 1000 } });
    assert.equal(audit.status, 200);
    const folder = audit.data.find((row) => row.folder_pet_id === pets.kika);
    assert.equal(folder?.job_status, 'pending');

    // Luna: de Dora, sin él.
    assert.equal(await ownerOf(pets.luna), dora.id);
    const { data: luna } = await rpc(dora, 'get_pet_members', { target_pet_id: pets.luna });
    assert.deepEqual(luna, []);
  });

  it('repetir con el mismo JWT: 410 account_not_found', async () => {
    const preview = await invoke(me, { mode: 'preview' });
    assert.deepEqual([preview.status, preview.body], [410, { error: 'account_not_found' }]);
    const again = await invoke(me, { mode: 'delete', confirm: CONFIRM_TOKEN, expected: [] });
    assert.equal(again.status, 410);
  });
});
