// Pruebas de los avisos de invitación (sin Deno ni red):
//   node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON supabase/functions/invitation-notify/notify.test.mjs
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildEmail,
  buildPushMessages,
  cleanName,
  escapeHtml,
  handleInvitationNotify,
  languageOf,
  NotifyError,
} from './notify.ts';
import { createExpoPushGateway, createQueueGateway, createResendGateway, toClaimed } from './rest.ts';

const INVITER = '6a2f8a8e-3b1c-4c55-9d7e-0a1b2c3d4e5f';
const INVITATION = '7b3f8a8e-3b1c-4c55-9d7e-0a1b2c3d4e5f';
const INVITED_AT = '2026-11-20T10:00:00.123456+00:00';

function item(overrides = {}) {
  return {
    invitationId: INVITATION,
    invitedAt: INVITED_AT,
    inviteeEmail: 'gema@example.test',
    inviteeLocale: 'es',
    inviterName: 'Olga',
    petName: 'Kika',
    role: 'editor',
    alertsEnabled: true,
    sendEmail: true,
    sendPush: true,
    pushTokens: ['ExponentPushToken[a]', 'ExponentPushToken[b]'],
    ...overrides,
  };
}

function request(token = 'jwt', method = 'POST') {
  return new Request('http://localhost/functions/v1/invitation-notify', {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

function gateways(overrides = {}) {
  const calls = { emails: [], pushes: [], completed: [], logs: [] };
  const value = {
    getUserId: async (token) => (token === 'jwt' ? INVITER : null),
    claim: async () => [item()],
    complete: async (input) => void calls.completed.push(input),
    sendEmail: async (message) => {
      calls.emails.push(message);
      return 'sent';
    },
    sendPush: async (messages) => {
      calls.pushes.push(messages);
      return messages.map(() => 'ok');
    },
    log: (event, fields) => void calls.logs.push({ event, ...fields }),
    ...overrides,
  };
  return { value, calls };
}

describe('mensajes', () => {
  test('idioma de la invitada: inglés solo si su perfil lo dice', () => {
    assert.equal(languageOf('en'), 'en');
    assert.equal(languageOf('en-GB'), 'en');
    assert.equal(languageOf('es'), 'es');
    assert.equal(languageOf(null), 'es');
  });

  test('los nombres se escapan en el HTML y se limpian', () => {
    assert.equal(escapeHtml(`<b>"x"&'y'</b>`), '&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/b&gt;');
    assert.equal(cleanName('  Ana\n\tLópez  '), 'Ana López');
    assert.equal(cleanName('x'.repeat(100)).length, 80);
    const email = buildEmail(item({ inviterName: '<script>alert(1)</script>', petName: 'K&K' }));
    assert.ok(!email.html.includes('<script>'));
    assert.ok(email.html.includes('&lt;script&gt;'));
    assert.ok(email.html.includes('K&amp;K'));
  });

  test('email en español con el permiso, sin «diagnóstico»', () => {
    const email = buildEmail(item());
    assert.equal(email.to, 'gema@example.test');
    assert.equal(email.subject, 'Olga te invita a cuidar de Kika en Kitom');
    assert.match(email.text, /ver y editar su ficha/);
    assert.match(email.text, /Ajustes › Notificaciones/);
    assert.doesNotMatch(email.html + email.text, /diagn[oó]stic/i);
    assert.equal(email.idempotencyKey, `kitom-invitation-${INVITATION}-${Date.parse(INVITED_AT)}`);
  });

  test('email en inglés y sin nombre de quien invita', () => {
    const email = buildEmail(item({ inviteeLocale: 'en', inviterName: null, role: 'viewer' }));
    assert.equal(email.subject, 'Someone invited you to look after Kika on Kitom');
    assert.match(email.text, /see their profile and logs/);
  });

  test('sin email no hay mensaje', () => {
    assert.equal(buildEmail(item({ inviteeEmail: null })), null);
  });

  test('un push por token, que abre Invitaciones por el canal de invitaciones', () => {
    const messages = buildPushMessages(item());
    assert.equal(messages.length, 2);
    assert.deepEqual(messages[0], {
      to: 'ExponentPushToken[a]',
      title: 'Invitación para cuidar de Kika',
      body: 'Olga te invita a cuidar de su mascota. Toca para responder.',
      data: { url: '/invitations' },
      sound: 'default',
      channelId: 'invitations',
      priority: 'high',
    });
  });
});

describe('handleInvitationNotify', () => {
  test('solo POST, con la función configurada y un JWT válido', async () => {
    const { value } = gateways();
    assert.equal((await handleInvitationNotify(request('jwt', 'GET'), { configured: true }, value)).status, 405);
    assert.equal((await handleInvitationNotify(request(), { configured: false }, value)).status, 500);
    assert.equal((await handleInvitationNotify(request(''), { configured: true }, value)).status, 401);
    assert.equal((await handleInvitationNotify(request('otro'), { configured: true }, value)).status, 401);
  });

  test('reserva los avisos del usuario del JWT, envía los dos canales y anota el resultado', async () => {
    let claimedFor = null;
    const { value, calls } = gateways({
      claim: async (inviterId) => {
        claimedFor = inviterId;
        return [item()];
      },
    });
    const response = await handleInvitationNotify(request(), { configured: true }, value);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
    assert.equal(claimedFor, INVITER);
    assert.equal(calls.emails.length, 1);
    assert.equal(calls.pushes[0].length, 2);
    assert.deepEqual(calls.completed, [
      {
        invitationId: INVITATION,
        invitedAt: INVITED_AT,
        email: { done: true, status: 'sent' },
        push: { done: true, status: 'sent' },
        invalidTokens: [],
      },
    ]);
    assert.ok(calls.logs.every((entry) => !JSON.stringify(entry).includes('example.test')));
  });

  test('sin avisos responde igual (no revela nada)', async () => {
    const { value, calls } = gateways({ claim: async () => [] });
    const response = await handleInvitationNotify(request(), { configured: true }, value);
    assert.deepEqual(await response.json(), { status: 'ok' });
    assert.equal(calls.completed.length, 0);
  });

  test('con los avisos apagados no se envía nada', async () => {
    const { value, calls } = gateways({ claim: async () => [item({ alertsEnabled: false })] });
    await handleInvitationNotify(request(), { configured: true }, value);
    assert.equal(calls.emails.length, 0);
    assert.equal(calls.pushes.length, 0);
    assert.deepEqual(calls.completed[0].email, { done: true, status: 'opted_out' });
    assert.deepEqual(calls.completed[0].push, { done: true, status: 'opted_out' });
  });

  test('solo los canales pendientes', async () => {
    const { value, calls } = gateways({ claim: async () => [item({ sendEmail: false })] });
    await handleInvitationNotify(request(), { configured: true }, value);
    assert.equal(calls.emails.length, 0);
    assert.deepEqual(calls.completed[0].email, { done: true, status: '' });
    assert.deepEqual(calls.completed[0].push, { done: true, status: 'sent' });
  });

  test('sin email configurado, sin dirección o sin dispositivos', async () => {
    const { value, calls } = gateways({
      sendEmail: undefined,
      claim: async () => [item({ pushTokens: [] }), item({ inviteeEmail: null, pushTokens: [] })],
    });
    await handleInvitationNotify(request(), { configured: true }, value);
    assert.deepEqual(calls.completed[0].email, { done: true, status: 'not_configured' });
    assert.deepEqual(calls.completed[0].push, { done: true, status: 'no_devices' });
    assert.deepEqual(calls.completed[1].email, { done: true, status: 'not_configured' });

    const second = gateways({ claim: async () => [item({ inviteeEmail: null })] });
    await handleInvitationNotify(request(), { configured: true }, second.value);
    assert.deepEqual(second.calls.completed[0].email, { done: true, status: 'no_email' });
  });

  test('un canal que falla queda para reintentar; el otro se da por hecho', async () => {
    const { value, calls } = gateways({
      sendEmail: async () => {
        throw new NotifyError('resend_http');
      },
    });
    await handleInvitationNotify(request(), { configured: true }, value);
    assert.deepEqual(calls.completed[0].email, { done: false, status: 'resend_http' });
    assert.deepEqual(calls.completed[0].push, { done: true, status: 'sent' });
  });

  test('tokens no registrados: se desactivan; si eran todos, no hay dispositivos', async () => {
    const partial = gateways({ sendPush: async () => ['not_registered', 'ok'] });
    await handleInvitationNotify(request(), { configured: true }, partial.value);
    assert.deepEqual(partial.calls.completed[0].push, { done: true, status: 'sent' });
    assert.deepEqual(partial.calls.completed[0].invalidTokens, ['ExponentPushToken[a]']);

    const none = gateways({ sendPush: async () => ['not_registered', 'not_registered'] });
    await handleInvitationNotify(request(), { configured: true }, none.value);
    assert.deepEqual(none.calls.completed[0].push, { done: true, status: 'no_devices' });

    const failed = gateways({ sendPush: async () => ['error', 'not_registered'] });
    await handleInvitationNotify(request(), { configured: true }, failed.value);
    assert.deepEqual(failed.calls.completed[0].push, { done: false, status: 'expo_error' });
    assert.deepEqual(failed.calls.completed[0].invalidTokens, ['ExponentPushToken[b]']);
  });

  test('si la cola falla, 500 sin detalles', async () => {
    const { value, calls } = gateways({
      claim: async () => {
        throw new NotifyError('claim_failed');
      },
    });
    const response = await handleInvitationNotify(request(), { configured: true }, value);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'server_error' });
    assert.deepEqual(calls.logs.at(-1), { event: 'invitation_notify_failed', code: 'claim_failed' });
  });
});

function fakeFetch(responses) {
  const requests = [];
  const fn = async (url, init) => {
    requests.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body ?? {}), { status: next.status ?? 200 });
  };
  return { fn, requests };
}

describe('pasarelas HTTP', () => {
  test('toClaimed valida la fila', () => {
    assert.equal(toClaimed(null), null);
    assert.equal(toClaimed({ invitation_id: 'x', invited_at: INVITED_AT }), null);
    assert.deepEqual(
      toClaimed({
        invitation_id: INVITATION,
        invited_at: INVITED_AT,
        invitee_email: 'a@b.test',
        invitee_locale: 'en',
        inviter_name: null,
        pet_name: 'Kika',
        role: 'viewer',
        alerts_enabled: true,
        send_email: true,
        send_push: false,
        push_tokens: ['t', 3],
      }),
      {
        invitationId: INVITATION,
        invitedAt: INVITED_AT,
        inviteeEmail: 'a@b.test',
        inviteeLocale: 'en',
        inviterName: null,
        petName: 'Kika',
        role: 'viewer',
        alertsEnabled: true,
        sendEmail: true,
        sendPush: false,
        pushTokens: ['t'],
      },
    );
  });

  test('cola: reserva con la clave de servicio y anota sin estados vacíos', async () => {
    const { fn, requests } = fakeFetch([{ body: [] }, { body: true }, { status: 500 }]);
    const queue = createQueueGateway({ url: 'http://db.test/', serviceKey: 'service', fetch: fn });
    assert.deepEqual(await queue.claim(INVITER), []);
    assert.equal(requests[0].url, 'http://db.test/rest/v1/rpc/pet_invitation_notifications_claim');
    assert.equal(requests[0].init.headers.Authorization, 'Bearer service');
    assert.deepEqual(requests[0].body, { p_inviter_id: INVITER, p_limit: 5 });
    await queue.complete({
      invitationId: INVITATION,
      invitedAt: INVITED_AT,
      email: { done: true, status: '' },
      push: { done: false, status: 'expo_http' },
      invalidTokens: [],
    });
    assert.equal(requests[1].body.p_email_status, null);
    assert.equal(requests[1].body.p_push_status, 'expo_http');
    await assert.rejects(() => queue.claim(INVITER), { code: 'claim_failed' });
  });

  test('Resend: clave idempotente; 422 no se reintenta, 5xx sí', async () => {
    const { fn, requests } = fakeFetch([{ status: 200 }, { status: 422 }, { status: 503 }, new Error('offline')]);
    const resend = createResendGateway({ apiKey: 're_x', from: 'Kitom <avisos@kitom.app>', fetch: fn });
    const message = buildEmail(item());
    assert.equal(await resend.sendEmail(message), 'sent');
    assert.equal(requests[0].init.headers['Idempotency-Key'], message.idempotencyKey);
    assert.deepEqual(requests[0].body.to, ['gema@example.test']);
    assert.equal(requests[0].body.from, 'Kitom <avisos@kitom.app>');
    assert.equal(await resend.sendEmail(message), 'rejected');
    await assert.rejects(() => resend.sendEmail(message), { code: 'resend_http' });
    await assert.rejects(() => resend.sendEmail(message), { code: 'network' });
  });

  test('Expo: un resultado por mensaje y token de acceso opcional', async () => {
    const { fn, requests } = fakeFetch([
      {
        body: {
          data: [
            { status: 'ok', id: '1' },
            { status: 'error', details: { error: 'DeviceNotRegistered' } },
            { status: 'error', details: { error: 'MessageRateExceeded' } },
          ],
        },
      },
      { status: 500 },
    ]);
    const expo = createExpoPushGateway({ accessToken: 'expo-token', fetch: fn });
    const messages = buildPushMessages(item({ pushTokens: ['a', 'b', 'c'] }));
    assert.deepEqual(await expo.sendPush(messages), ['ok', 'not_registered', 'error']);
    assert.equal(requests[0].init.headers.Authorization, 'Bearer expo-token');
    assert.equal(requests[0].body.length, 3);
    await assert.rejects(() => expo.sendPush(messages), { code: 'expo_http' });
  });
});
