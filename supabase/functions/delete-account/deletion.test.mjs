// Pruebas de delete-account (Node, sin Deno), con Auth, BD y Storage falsos:
//   node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON supabase/functions/delete-account/*.test.mjs
// Contra el Supabase local (Auth, RLS, RPC, trigger y Storage reales): run-integration.mjs.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildPlan,
  chooseNewOwner,
  CONFIRM_TOKEN,
  executePlan,
  expectedFromPlan,
  GatewayError,
  handleDeleteAccountRequest,
  MAX_PETS,
  parseRequestBody,
  planMatches,
} from './deletion.ts';
import { createRestAdmin, createRestAuth, createRestUserGateway } from './rest.ts';

const ME = '11111111-1111-4111-8111-111111111111';
const ANA = '22222222-2222-4222-8222-222222222222';
const BEA = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const REX = 'aaaaaaaa-0000-4000-8000-000000000001';
const KIKA = 'aaaaaaaa-0000-4000-8000-000000000002';
const SHARED = 'aaaaaaaa-0000-4000-8000-000000000003';
const ENV = { supabaseUrl: 'http://127.0.0.1:54321', anonKey: 'anon-key', serviceKey: 'service-key-that-must-never-be-logged' };

const member = (userId, role, status, acceptedAt, extra = {}) => ({
  user_id: userId,
  full_name: null,
  role,
  status,
  invited_at: '2026-01-01T00:00:00Z',
  accepted_at: acceptedAt,
  ...extra,
});

/**
 * BD falsa con lo que autorizan RLS y las RPC: mascotas con propietario, co-tutores por mascota, avatares
 * por ruta. `transfer_pet_ownership` cambia el propietario y deja al anterior como editor, como la real.
 */
function fakeWorld({ pets = [], members = {}, avatars = [], failOn = {} } = {}) {
  const state = {
    pets: pets.map((pet) => ({ ...pet })),
    members: Object.fromEntries(Object.entries(members).map(([id, list]) => [id, list.map((m) => ({ ...m }))])),
    avatars: [...avatars],
    users: new Set([ME, ANA, BEA, OTHER]),
    calls: [],
  };
  const fail = (step) => {
    if (failOn[step] && failOn[step]-- > 0) throw new GatewayError(`${step}_failed`);
  };
  const user = {
    async ownedPets(userId, limit) {
      state.calls.push('ownedPets');
      fail('ownedPets');
      return state.pets.filter((pet) => pet.owner === userId).slice(0, limit).map(({ id, name }) => ({ id, name }));
    },
    async petMembers(petId) {
      state.calls.push('petMembers');
      return state.members[petId] ?? [];
    },
    async sharedPetIds(userId) {
      return Object.entries(state.members)
        .filter(([, list]) => list.some((m) => m.user_id === userId && m.status === 'accepted'))
        .map(([petId]) => petId);
    },
    async transferPet(petId, newOwnerId) {
      state.calls.push(`transfer:${petId}:${newOwnerId}`);
      fail('transfer');
      const pet = state.pets.find((item) => item.id === petId);
      const previous = pet.owner;
      pet.owner = newOwnerId;
      state.members[petId] = [
        ...(state.members[petId] ?? []).filter((m) => m.user_id !== newOwnerId),
        member(previous, 'editor', 'accepted', '2026-10-29T00:00:00Z'),
      ];
    },
    async deletePet(petId, userId) {
      state.calls.push(`delete:${petId}`);
      fail('deletePet');
      const before = state.pets.length;
      state.pets = state.pets.filter((pet) => !(pet.id === petId && pet.owner === userId));
      if (state.pets.length < before) delete state.members[petId];
      return state.pets.length < before;
    },
    async listAvatars(userId) {
      fail('listAvatars');
      return state.avatars.filter((name) => name.startsWith(`${userId}/`));
    },
    async removeAvatars(names) {
      state.calls.push('removeAvatars');
      const before = state.avatars.length;
      state.avatars = state.avatars.filter((name) => !names.includes(name));
      return before - state.avatars.length;
    },
  };
  const admin = {
    async deleteUser(userId) {
      state.calls.push('deleteUser');
      fail('deleteUser');
      if (state.pets.some((pet) => pet.owner === userId)) throw new GatewayError('auth_admin_http_500');
      return state.users.delete(userId) ? 'deleted' : 'not_found';
    },
  };
  const auth = {
    async userFromToken(token) {
      if (token === 'bad') return { status: 'invalid' };
      return state.users.has(ME) ? { status: 'ok', userId: ME } : { status: 'not_found' };
    },
  };
  return { state, user, admin, auth };
}

const standardWorld = (options = {}) =>
  fakeWorld({
    pets: [
      { id: REX, name: 'Rex', owner: ME },
      { id: KIKA, name: 'Kika', owner: ME },
      { id: SHARED, name: 'Luna', owner: OTHER },
    ],
    members: {
      // Rex: Bea es editora desde antes que Ana; un lector y una editora pendiente no cuentan.
      [REX]: [
        member(ANA, 'editor', 'accepted', '2026-05-01T00:00:00Z', { full_name: 'Ana' }),
        member(BEA, 'editor', 'accepted', '2026-03-01T00:00:00Z', { full_name: '  Bea  ' }),
        member(OTHER, 'viewer', 'accepted', '2026-01-01T00:00:00Z'),
      ],
      // Kika: solo un lector y una editora pendiente → se borra.
      [KIKA]: [member(ANA, 'viewer', 'accepted', '2026-01-01T00:00:00Z'), member(BEA, 'editor', 'pending', null)],
      [SHARED]: [member(ME, 'viewer', 'accepted', '2026-02-01T00:00:00Z')],
    },
    avatars: [`${ME}/a.jpg`, `${ME}/old/b.jpg`, `${ANA}/c.jpg`],
    ...options,
  });

function request(body, { token = 'user-jwt', method = 'POST' } = {}) {
  return new Request('http://localhost/functions/v1/delete-account', {
    method,
    headers: { ...(token === null ? {} : { Authorization: `Bearer ${token}` }), 'Content-Type': 'application/json' },
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
}

async function call(world, body, options) {
  const logs = [];
  const log = (event, fields) => logs.push({ event, ...fields });
  const response = await handleDeleteAccountRequest(request(body, options), ENV, () => ({ ...world, log }), log);
  return { status: response.status, body: await response.json(), logs, headers: response.headers };
}

describe('parseRequestBody', () => {
  it('acepta solo preview o delete con la confirmación exacta y el plan visto', () => {
    assert.deepEqual(parseRequestBody('{"mode":"preview"}'), { mode: 'preview' });
    assert.deepEqual(parseRequestBody(JSON.stringify({ mode: 'delete', confirm: CONFIRM_TOKEN, expected: [] })), {
      mode: 'delete',
      expected: [],
    });
    const expected = [
      { pet_id: REX.toUpperCase(), action: 'transfer', new_owner_id: BEA },
      { pet_id: KIKA, action: 'delete' },
    ];
    assert.deepEqual(parseRequestBody(JSON.stringify({ mode: 'delete', confirm: 'DELETE', expected })).expected, [
      { pet_id: REX, action: 'transfer', new_owner_id: BEA },
      { pet_id: KIKA, action: 'delete' },
    ]);
  });

  it('rechaza cualquier otra cosa (también un id de usuario en el cuerpo)', () => {
    const bad = [
      '',
      'null',
      '[]',
      'no json',
      '{"mode":"preview","user_id":"x"}',
      '{"mode":"delete","confirm":"DELETE"}',
      '{"mode":"delete","confirm":"delete","expected":[]}',
      '{"mode":"delete","confirm":"DELETE","expected":[],"user_id":"' + OTHER + '"}',
      '{"mode":"delete","confirm":"DELETE","expected":[{"pet_id":"no-uuid","action":"delete"}]}',
      `{"mode":"delete","confirm":"DELETE","expected":[{"pet_id":"${KIKA}","action":"delete","new_owner_id":"${ANA}"}]}`,
      `{"mode":"delete","confirm":"DELETE","expected":[{"pet_id":"${KIKA}","action":"transfer"}]}`,
      `{"mode":"delete","confirm":"DELETE","expected":[{"pet_id":"${KIKA}","action":"delete"},{"pet_id":"${KIKA}","action":"delete"}]}`,
      `{"mode":"delete","confirm":"DELETE","expected":[{"pet_id":"${KIKA}","action":"archive"}]}`,
      '{"mode":"wipe"}',
    ];
    for (const text of bad) assert.equal(parseRequestBody(text), null, text);
    const tooMany = Array.from({ length: MAX_PETS + 1 }, (_, i) => ({
      pet_id: `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, '0')}`,
      action: 'delete',
    }));
    assert.equal(parseRequestBody(JSON.stringify({ mode: 'delete', confirm: 'DELETE', expected: tooMany })), null);
    assert.equal(parseRequestBody(`{"mode":"preview","x":"${'a'.repeat(70_000)}"}`), null);
  });
});

describe('chooseNewOwner', () => {
  it('el editor aceptado más antiguo; ni lectores, ni pendientes, ni el propio usuario', () => {
    const members = [
      member(ANA, 'editor', 'accepted', '2026-05-01T00:00:00Z'),
      member(BEA, 'editor', 'accepted', '2026-03-01T00:00:00Z'),
      member(OTHER, 'viewer', 'accepted', '2026-01-01T00:00:00Z'),
      member(ME, 'editor', 'accepted', '2025-01-01T00:00:00Z'),
    ];
    assert.equal(chooseNewOwner(members, ME).user_id, BEA);
    assert.equal(chooseNewOwner([member(ANA, 'editor', 'pending', null), member(BEA, 'viewer', 'accepted', 'x')], ME), null);
    // Sin fecha de aceptación va detrás; a igualdad, por invitación y por id.
    assert.equal(chooseNewOwner([member(ANA, 'editor', 'accepted', null), member(BEA, 'editor', 'accepted', '2026-09-01T00:00:00Z')], ME).user_id, BEA);
    assert.equal(chooseNewOwner([member(BEA, 'editor', 'accepted', null), member(ANA, 'editor', 'accepted', null)], ME).user_id, ANA);
  });
});

describe('plan', () => {
  it('transfiere a la editora más antigua, borra lo que no tiene editor y cuenta lo compartido', async () => {
    const world = standardWorld();
    const plan = await buildPlan(world.user, ME);
    assert.deepEqual(plan, {
      transfer: [{ pet_id: REX, pet_name: 'Rex', new_owner_id: BEA, new_owner_name: 'Bea' }],
      delete: [{ pet_id: KIKA, pet_name: 'Kika' }],
      leave_shared: 1,
    });
    assert.ok(planMatches(plan, expectedFromPlan(plan)));
  });

  it('planMatches: lo que sigue siendo suyo debe estar confirmado igual; lo que ya no está no importa', () => {
    const plan = {
      transfer: [{ pet_id: REX, pet_name: 'Rex', new_owner_id: BEA, new_owner_name: null }],
      delete: [{ pet_id: KIKA, pet_name: 'Kika' }],
      leave_shared: 0,
    };
    assert.ok(planMatches(plan, expectedFromPlan(plan)));
    assert.ok(planMatches({ transfer: [], delete: [], leave_shared: 3 }, expectedFromPlan(plan)), 'todo hecho ya');
    assert.equal(planMatches(plan, [{ pet_id: REX, action: 'transfer', new_owner_id: ANA }, { pet_id: KIKA, action: 'delete' }]), false);
    assert.equal(planMatches(plan, [{ pet_id: REX, action: 'delete' }, { pet_id: KIKA, action: 'delete' }]), false);
    assert.equal(planMatches(plan, [{ pet_id: REX, action: 'transfer', new_owner_id: BEA }]), false, 'Kika no se confirmó');
    assert.equal(planMatches(plan, []), false);
  });
});

describe('handleDeleteAccountRequest', () => {
  it('preview: devuelve el plan sin cambiar nada y sin usar la clave de servicio', async () => {
    const world = standardWorld();
    const { status, body, logs, headers } = await call(world, { mode: 'preview' });
    assert.equal(status, 200);
    assert.equal(body.status, 'preview');
    assert.equal(body.plan.transfer[0].new_owner_id, BEA);
    assert.equal(headers.get('Access-Control-Allow-Origin'), '*');
    assert.ok(!world.state.calls.some((c) => c.startsWith('transfer') || c.startsWith('delete') || c === 'removeAvatars'));
    assert.deepEqual(logs, [{ event: 'delete_account.preview', transfer: 1, delete: 1, leave_shared: 1 }]);
  });

  it('delete: transfiere, borra, quita los avatares propios y por último borra el usuario', async () => {
    const world = standardWorld();
    const preview = await call(world, { mode: 'preview' });
    const { status, body } = await call(world, { mode: 'delete', confirm: CONFIRM_TOKEN, expected: expectedFromPlan(preview.body.plan) });
    assert.equal(status, 200);
    assert.deepEqual(body, { status: 'deleted', transferred: 1, deleted: 1, avatars_removed: 2 });
    assert.deepEqual(world.state.calls.filter((c) => c !== 'ownedPets' && c !== 'petMembers'), [
      `transfer:${REX}:${BEA}`,
      `delete:${KIKA}`,
      'removeAvatars',
      'deleteUser',
    ]);
    assert.equal(world.state.pets.find((pet) => pet.id === REX).owner, BEA);
    assert.equal(world.state.pets.some((pet) => pet.id === KIKA), false);
    assert.deepEqual(world.state.avatars, [`${ANA}/c.jpg`]);
    assert.equal(world.state.users.has(ME), false);
    // Repetir con el mismo JWT: la cuenta ya no existe (respuesta final).
    const again = await call(world, { mode: 'delete', confirm: CONFIRM_TOKEN, expected: [] });
    assert.deepEqual([again.status, again.body], [410, { error: 'account_not_found' }]);
  });

  it('plan cambiado entre lo visto y el borrado: 409 con el plan nuevo, sin tocar nada', async () => {
    const world = standardWorld();
    const preview = await call(world, { mode: 'preview' });
    // Bea deja de ser co-tutora: Rex pasaría a Ana.
    world.state.members[REX] = world.state.members[REX].filter((m) => m.user_id !== BEA);
    const { status, body } = await call(world, { mode: 'delete', confirm: CONFIRM_TOKEN, expected: expectedFromPlan(preview.body.plan) });
    assert.equal(status, 409);
    assert.equal(body.error, 'plan_changed');
    assert.equal(body.plan.transfer[0].new_owner_id, ANA);
    assert.ok(!world.state.calls.some((c) => c.startsWith('transfer') || c.startsWith('delete')));
  });

  it('un fallo a medias se puede repetir y converge (lo transferido ya no es suyo)', async () => {
    const world = standardWorld({ failOn: { deletePet: 1 } });
    const preview = await call(world, { mode: 'preview' });
    const expected = expectedFromPlan(preview.body.plan);
    const first = await call(world, { mode: 'delete', confirm: CONFIRM_TOKEN, expected });
    assert.equal(first.status, 500);
    assert.deepEqual(first.body, { error: 'deletion_incomplete', step: 'delete_pet', transferred: 1, deleted: 0, avatars_removed: 0 });
    assert.deepEqual(first.logs.at(-1), { event: 'delete_account.failed', step: 'delete_pet', code: 'deletePet_failed', transferred: 1, deleted: 0, avatars_removed: 0 });
    assert.ok(world.state.users.has(ME), 'sin borrar el usuario');

    const second = await call(world, { mode: 'delete', confirm: CONFIRM_TOKEN, expected });
    assert.deepEqual([second.status, second.body], [200, { status: 'deleted', transferred: 0, deleted: 1, avatars_removed: 2 }]);
    assert.equal(world.state.pets.find((pet) => pet.id === REX).owner, BEA);
  });

  it('si falla el borrado del usuario, el reintento con el plan vacío lo termina', async () => {
    const world = standardWorld({ failOn: { deleteUser: 1 } });
    const preview = await call(world, { mode: 'preview' });
    const first = await call(world, { mode: 'delete', confirm: CONFIRM_TOKEN, expected: expectedFromPlan(preview.body.plan) });
    assert.equal(first.body.step, 'delete_user');
    const replanned = await call(world, { mode: 'preview' });
    assert.deepEqual(replanned.body.plan, { transfer: [], delete: [], leave_shared: 2 });
    const second = await call(world, { mode: 'delete', confirm: CONFIRM_TOKEN, expected: [] });
    assert.equal(second.status, 200);
  });

  it('una mascota creada durante el borrado: no se borra el usuario y se pide revisar', async () => {
    const world = standardWorld();
    const preview = await call(world, { mode: 'preview' });
    const original = world.user.removeAvatars;
    world.user.removeAvatars = async (names) => {
      world.state.pets.push({ id: 'aaaaaaaa-0000-4000-8000-000000000009', name: 'Nueva', owner: ME });
      return original(names);
    };
    const { status, body } = await call(world, { mode: 'delete', confirm: CONFIRM_TOKEN, expected: expectedFromPlan(preview.body.plan) });
    assert.equal(status, 409);
    assert.deepEqual(body.plan.delete, [{ pet_id: 'aaaaaaaa-0000-4000-8000-000000000009', pet_name: 'Nueva' }]);
    assert.ok(!world.state.calls.includes('deleteUser'));
  });

  it('seguridad: sin JWT, JWT inválido, cuerpo inválido o método distinto no tocan nada', async () => {
    const world = standardWorld();
    assert.deepEqual(await call(world, { mode: 'preview' }, { token: null }).then((r) => [r.status, r.body]), [401, { error: 'not_authenticated' }]);
    assert.deepEqual(await call(world, { mode: 'preview' }, { token: 'bad' }).then((r) => [r.status, r.body]), [401, { error: 'not_authenticated' }]);
    assert.equal((await call(world, { mode: 'delete', confirm: 'yes', expected: [] })).status, 400);
    assert.equal((await call(world, { mode: 'preview', user_id: OTHER })).status, 400);
    assert.equal((await call(world, null, { method: 'GET' })).status, 405);
    const options = await handleDeleteAccountRequest(new Request('http://localhost', { method: 'OPTIONS' }), ENV, () => world, () => {});
    assert.equal(options.status, 200);
    assert.equal(world.state.calls.length, 0, 'ni siquiera se leyó el plan');
  });

  it('sin configuración: 500 sin llamar a nada; plan ilegible: 500 server_error', async () => {
    const world = standardWorld({ failOn: { ownedPets: 1 } });
    const misconfigured = await handleDeleteAccountRequest(request({ mode: 'preview' }), { ...ENV, serviceKey: undefined }, () => world, () => {});
    assert.deepEqual([misconfigured.status, await misconfigured.json()], [500, { error: 'server_misconfigured' }]);
    const { status, body, logs } = await call(world, { mode: 'preview' });
    assert.deepEqual([status, body], [500, { error: 'server_error' }]);
    assert.equal(JSON.stringify(logs).includes(ENV.serviceKey), false);
  });

  it('demasiadas mascotas: 409 too_many_pets', async () => {
    const pets = Array.from({ length: MAX_PETS + 1 }, (_, i) => ({ id: `bbbbbbbb-0000-4000-8000-${String(i).padStart(12, '0')}`, name: `P${i}`, owner: ME }));
    const { status, body } = await call(fakeWorld({ pets }), { mode: 'preview' });
    assert.deepEqual([status, body], [409, { error: 'too_many_pets' }]);
  });

  it('los registros solo llevan códigos y recuentos (ni nombres, ni ids)', async () => {
    const world = standardWorld();
    const preview = await call(world, { mode: 'preview' });
    const done = await call(world, { mode: 'delete', confirm: CONFIRM_TOKEN, expected: expectedFromPlan(preview.body.plan) });
    const text = JSON.stringify([...preview.logs, ...done.logs]);
    for (const secret of ['Rex', 'Kika', 'Bea', ME, BEA, REX, KIKA, ENV.serviceKey]) assert.equal(text.includes(secret), false, secret);
  });
});

describe('executePlan', () => {
  it('un fallo al transferir se para antes de borrar nada', async () => {
    const world = standardWorld({ failOn: { transfer: 1 } });
    const plan = await buildPlan(world.user, ME);
    const outcome = await executePlan(world, ME, plan);
    assert.deepEqual(outcome, { status: 'failed', step: 'transfer', code: 'transfer_failed', transferred: 0, deleted: 0, avatars_removed: 0 });
    assert.equal(world.state.pets.length, 3);
    assert.ok(!world.state.calls.includes('deleteUser'));
  });

  it('un fallo al listar avatares no borra el usuario', async () => {
    const world = standardWorld({ failOn: { listAvatars: 1 } });
    const outcome = await executePlan(world, ME, await buildPlan(world.user, ME));
    assert.equal(outcome.step, 'avatars');
    assert.ok(world.state.users.has(ME));
  });
});

describe('rest', () => {
  const fakeFetch = (handler) => {
    const requests = [];
    const doFetch = async (url, init) => {
      requests.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
      return handler(url, init);
    };
    return { requests, doFetch };
  };
  const jsonResponse = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('auth: usuario del JWT con la clave anónima; usuario borrado → not_found; otro 401 → invalid', async () => {
    const { requests, doFetch } = fakeFetch(async (url, init) =>
      init.headers.Authorization === 'Bearer ok'
        ? jsonResponse(200, { id: ME.toUpperCase() })
        : init.headers.Authorization === 'Bearer gone'
          ? jsonResponse(403, { code: 403, error_code: 'user_not_found', msg: 'User from sub claim in JWT does not exist' })
          : jsonResponse(401, { code: 401, error_code: 'bad_jwt' })
    );
    const auth = createRestAuth({ url: 'http://127.0.0.1:54321/', apiKey: 'anon', fetch: doFetch });
    assert.deepEqual(await auth.userFromToken('ok'), { status: 'ok', userId: ME });
    assert.deepEqual(await auth.userFromToken('gone'), { status: 'not_found' });
    assert.deepEqual(await auth.userFromToken('expired'), { status: 'invalid' });
    assert.equal(requests[0].url, 'http://127.0.0.1:54321/auth/v1/user');
    assert.equal(requests[0].headers.apikey, 'anon');
  });

  it('usuario: todo con su JWT; borrar mascota filtra por propietario; errores como códigos', async () => {
    const { requests, doFetch } = fakeFetch(async (url, init) => {
      if (url.includes('/rpc/transfer_pet_ownership')) return jsonResponse(400, { code: 'P0001', message: 'Solo el propietario…', hint: null });
      if (init.method === 'DELETE' && url.includes('/rest/v1/pets')) return jsonResponse(200, [{ id: KIKA }]);
      if (url.includes('/object/list/avatars')) {
        const { prefix } = JSON.parse(init.body);
        return jsonResponse(200, prefix === ME ? [{ name: 'a.jpg', id: 'x' }, { name: 'old', id: null }] : [{ name: 'b.jpg', id: 'y' }]);
      }
      if (url.endsWith('/object/avatars')) return jsonResponse(200, JSON.parse(init.body).prefixes.map((name) => ({ name })));
      return jsonResponse(500, { message: 'secret detail' });
    });
    const user = createRestUserGateway({ url: 'http://127.0.0.1:54321', apiKey: 'anon', token: 'user-jwt', fetch: doFetch });
    await assert.rejects(user.transferPet(REX, BEA), (error) => error instanceof GatewayError && error.code === 'rpc_p0001');
    assert.equal(await user.deletePet(KIKA, ME), true);
    const avatars = await user.listAvatars(ME);
    assert.deepEqual(avatars, [`${ME}/a.jpg`, `${ME}/old/b.jpg`]);
    assert.equal(await user.removeAvatars(avatars), 2);
    await assert.rejects(user.ownedPets(ME, 5), (error) => error.code === 'rest_http_500' && !error.message.includes('secret'));
    assert.ok(requests.every((r) => r.headers.Authorization === 'Bearer user-jwt' && r.headers.apikey === 'anon'));
    const deletion = requests.find((r) => r.method === 'DELETE' && r.url.includes('/rest/v1/pets'));
    assert.match(deletion.url, new RegExp(`id=eq.${KIKA}&owner_id=eq.${ME}`));
  });

  it('avatares: sin bucket no hay nada que borrar', async () => {
    const { doFetch } = fakeFetch(async () => jsonResponse(400, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' }));
    const user = createRestUserGateway({ url: 'http://127.0.0.1:54321', apiKey: 'anon', token: 't', fetch: doFetch });
    assert.deepEqual(await user.listAvatars(ME), []);
  });

  it('admin: borra con la clave de servicio; 404 = ya no existe; la red, un código', async () => {
    const { requests, doFetch } = fakeFetch(async (url) => (url.endsWith(ME) ? new Response('{}', { status: 200 }) : new Response('{}', { status: 404 })));
    const admin = createRestAdmin({ url: 'http://127.0.0.1:54321', apiKey: 'service', fetch: doFetch });
    assert.equal(await admin.deleteUser(ME), 'deleted');
    assert.equal(await admin.deleteUser(ANA), 'not_found');
    assert.equal(requests[0].url, `http://127.0.0.1:54321/auth/v1/admin/users/${ME}`);
    assert.equal(requests[0].method, 'DELETE');
    await assert.rejects(admin.deleteUser('not-a-uuid'), (error) => error.code === 'invalid_user_id');
    const offline = createRestAdmin({ url: 'http://127.0.0.1:54321', apiKey: 'service', fetch: async () => { throw new TypeError('fetch failed'); } });
    await assert.rejects(offline.deleteUser(ME), (error) => error.code === 'network');
  });
});
