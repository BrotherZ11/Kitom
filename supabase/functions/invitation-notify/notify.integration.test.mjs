// Integración de invitation-notify contra el Supabase LOCAL: Auth, invite_pet_member_by_email,
// register_push_token y las RPC de la cola reales; Resend y Expo simulados (sin red ni claves reales).
// Lanzar con `node supabase/functions/invitation-notify/run-integration.mjs` (se niega si la URL no es local).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { handleInvitationNotify } from './notify.ts';
import { createAuthGateway, createQueueGateway } from './rest.ts';

const URL_ = process.env.KITOM_IT_SUPABASE_URL;
const ANON = process.env.KITOM_IT_SUPABASE_ANON_KEY;
const SERVICE = process.env.KITOM_IT_SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SERVICE || !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(URL_)) {
  throw new Error('Solo contra el Supabase local: usa run-integration.mjs');
}

const PASSWORD = 'Prueba123!integration';
const stamp = Date.now();
const users = {
  owner: { email: `notify-owner-${stamp}@example.test`, name: 'Olga' },
  guest: { email: `notify-guest-${stamp}@example.test`, name: 'Gema' },
};
const pushToken = `ExponentPushToken[it-${stamp}]`;
let petId;

async function api(path, { method = 'GET', bearer = SERVICE, apikey = SERVICE, body, prefer } = {}) {
  const headers = { apikey, Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(`${URL_}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const rpc = (name, user, body = {}) => api(`/rest/v1/rpc/${name}`, { method: 'POST', bearer: user.token, apikey: ANON, body });

function request(token) {
  return new Request('http://localhost/functions/v1/invitation-notify', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
}

function gateways(sent) {
  return {
    ...createAuthGateway({ url: URL_, anonKey: ANON }),
    ...createQueueGateway({ url: URL_, serviceKey: SERVICE }),
    sendEmail: async (message) => {
      sent.emails.push(message);
      return 'sent';
    },
    sendPush: async (messages) => {
      sent.pushes.push(...messages);
      return messages.map(() => 'ok');
    },
    log: () => {},
  };
}

before(async () => {
  for (const user of Object.values(users)) {
    const created = await api('/auth/v1/admin/users', {
      method: 'POST',
      body: { email: user.email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: user.name } },
    });
    assert.equal(created.status, 200, 'alta del usuario de prueba');
    user.id = created.body.id;
    const session = await api('/auth/v1/token?grant_type=password', { method: 'POST', bearer: ANON, apikey: ANON, body: { email: user.email, password: PASSWORD } });
    user.token = session.body.access_token;
    assert.ok(user.token);
  }
  // Invitar exige Premium.
  const premium = await api(`/rest/v1/subscriptions?user_id=eq.${users.owner.id}`, { method: 'PATCH', body: { plan: 'premium' } });
  assert.ok(premium.status < 300, 'cuenta Premium');
  const species = await api('/rest/v1/species?code=eq.dog&select=id');
  const pet = await api('/rest/v1/pets', {
    method: 'POST',
    prefer: 'return=representation',
    body: { owner_id: users.owner.id, name: 'Kika', species_id: species.body[0].id },
  });
  assert.equal(pet.status, 201, 'alta de la mascota');
  petId = pet.body[0].id;
});

after(async () => {
  if (petId) await api(`/rest/v1/pets?id=eq.${petId}`, { method: 'DELETE' });
  for (const user of Object.values(users)) {
    if (user.id) await api(`/auth/v1/admin/users/${user.id}`, { method: 'DELETE' });
  }
});

describe('invitation-notify contra el Supabase local', () => {
  test('el cliente no puede ejecutar las RPC de la cola', async () => {
    const claim = await rpc('pet_invitation_notifications_claim', users.owner, { p_inviter_id: users.owner.id });
    assert.ok([401, 403, 404].includes(claim.status), `claim → ${claim.status}`);
  });

  test('invitar, avisar por email y push una sola vez', async () => {
    const registered = await rpc('register_push_token', users.guest, { p_token: pushToken, p_platform: 'android' });
    assert.ok(registered.status < 300, 'la invitada registra su dispositivo');

    const invited = await rpc('invite_pet_member_by_email', users.owner, { target_pet_id: petId, invitee_email: users.guest.email });
    assert.ok(invited.status < 300, 'la propietaria invita');

    // Quien no invitó no dispara los avisos de otros.
    const strangerSent = { emails: [], pushes: [] };
    const stranger = await handleInvitationNotify(request(users.guest.token), { configured: true }, gateways(strangerSent));
    assert.equal(stranger.status, 200);
    assert.equal(strangerSent.emails.length + strangerSent.pushes.length, 0);

    const sent = { emails: [], pushes: [] };
    const response = await handleInvitationNotify(request(users.owner.token), { configured: true }, gateways(sent));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
    assert.equal(sent.emails.length, 1);
    assert.equal(sent.emails[0].to, users.guest.email);
    assert.equal(sent.emails[0].subject, 'Olga te invita a cuidar de Kika en Kitom');
    assert.deepEqual(sent.pushes.map((message) => message.to), [pushToken]);
    assert.deepEqual(sent.pushes[0].data, { url: '/invitations' });

    const again = { emails: [], pushes: [] };
    await handleInvitationNotify(request(users.owner.token), { configured: true }, gateways(again));
    assert.equal(again.emails.length + again.pushes.length, 0, 'un aviso enviado no se repite');
  });

  test('un JWT no válido no procesa nada', async () => {
    const response = await handleInvitationNotify(request('no-valido'), { configured: true }, gateways({ emails: [], pushes: [] }));
    assert.equal(response.status, 401);
  });
});
