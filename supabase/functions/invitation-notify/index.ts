// =====================================================================
// KITOM · Edge Function invitation-notify
// =====================================================================
// Avisa por email y push a quien recibe una invitación de co-tutor. La llama
// la app justo después de invitar: POST con el JWT de quien invita, sin cuerpo.
//   200 { status: 'ok' } (haya o no avisos: no revela si el email tiene cuenta)
//   401 not_authenticated · 405 method_not_allowed · 500 server_misconfigured | server_error
// Contrato: docs/README.md §13.1. Lógica y pruebas: notify.ts, rest.ts y notify.test.mjs.
//
// verify_jwt = true (config.toml) y la función vuelve a comprobar el JWT con Auth.
// SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY las da la plataforma.
// Secretos (los pone el responsable: supabase/functions/deploy-template.sh):
//   RESEND_API_KEY y INVITATION_EMAIL_FROM (p. ej. "Kitom <avisos@kitom.app>", de un
//   dominio verificado en Resend): sin ellos no hay email (el push sigue).
//   EXPO_ACCESS_TOKEN: opcional, solo si se activa la seguridad de push en Expo.
// =====================================================================
import { handleInvitationNotify, type Log } from './notify.ts';
import { createAuthGateway, createExpoPushGateway, createQueueGateway, createResendGateway } from './rest.ts';

const log: Log = (event, fields) => console.log(JSON.stringify({ event, ...fields }));

Deno.serve((request) => {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const resendKey = Deno.env.get('RESEND_API_KEY') ?? '';
  const from = Deno.env.get('INVITATION_EMAIL_FROM') ?? '';
  if (!resendKey || !from) log('invitation_notify_email_disabled');
  return handleInvitationNotify(
    request,
    { configured: Boolean(url && anonKey && serviceKey) },
    {
      ...createAuthGateway({ url, anonKey }),
      ...createQueueGateway({ url, serviceKey }),
      sendEmail: resendKey && from ? createResendGateway({ apiKey: resendKey, from }).sendEmail : undefined,
      ...createExpoPushGateway({ accessToken: Deno.env.get('EXPO_ACCESS_TOKEN') || undefined }),
      log,
    },
  );
});
