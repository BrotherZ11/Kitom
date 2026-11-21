// =====================================================================
// KITOM · Avisos de invitación de co-tutor: lógica (sin Deno ni red)
// =====================================================================
// La app llama a la función justo después de invitar (POST, JWT de quien
// invita). Se reservan los avisos pendientes de SUS invitaciones
// (pet_invitation_notifications_claim, solo service_role) y se envían:
//   - email con Resend (RESEND_API_KEY + INVITATION_EMAIL_FROM; sin ellos,
//     el canal se da por hecho con `not_configured`),
//   - push con el servicio de Expo a los tokens activos de la invitada.
// El resultado de cada canal se anota (pet_invitation_notifications_complete);
// un canal que falla se reintenta en la siguiente llamada (hasta 3).
// La respuesta es la misma haya o no avisos: no revela si un email tiene
// cuenta (como invite_pet_member_by_email).
// Contrato: docs/README.md §13.1. Pruebas: notify.test.mjs.
// =====================================================================

export type Log = (event: string, fields?: Record<string, unknown>) => void;

export type ClaimedNotification = {
  invitationId: string;
  invitedAt: string;
  inviteeEmail: string | null;
  inviteeLocale: string | null;
  inviterName: string | null;
  petName: string;
  role: 'viewer' | 'editor';
  alertsEnabled: boolean;
  sendEmail: boolean;
  sendPush: boolean;
  pushTokens: string[];
};

export type ChannelResult = { done: boolean; status: string };

export type CompleteInput = {
  invitationId: string;
  invitedAt: string;
  email: ChannelResult;
  push: ChannelResult;
  invalidTokens: string[];
};

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
};

export type PushMessage = {
  to: string;
  title: string;
  body: string;
  data: { url: string };
  sound: 'default';
  channelId: string;
  priority: 'high';
};

/** Resultado de un push por token, en el mismo orden: ok, no registrado (app desinstalada) o error. */
export type PushTicket = 'ok' | 'not_registered' | 'error';

export type NotifyGateways = {
  getUserId(token: string): Promise<string | null>;
  claim(inviterId: string): Promise<ClaimedNotification[]>;
  complete(input: CompleteInput): Promise<void>;
  /** `undefined` si el email no está configurado. */
  sendEmail?: (message: EmailMessage) => Promise<'sent' | 'rejected'>;
  sendPush(messages: PushMessage[]): Promise<PushTicket[]>;
  log: Log;
};

/** Error de un proveedor (Resend, Expo, PostgREST): solo un código, nunca el texto del servidor. */
export class NotifyError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.name = 'NotifyError';
    this.code = code;
  }
}

/** Canal de Android de los avisos de invitación (lo crea la app: features/notifications). */
export const INVITATIONS_CHANNEL_ID = 'invitations';
/** Ruta de la app que abre el push (Invitaciones). */
export const INVITATIONS_URL = '/invitations';
const SITE_URL = 'https://kitom.app';

type Lang = 'es' | 'en';

export function languageOf(locale: string | null | undefined): Lang {
  return typeof locale === 'string' && locale.toLowerCase().startsWith('en') ? 'en' : 'es';
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Una línea, sin caracteres de control y con un máximo razonable (nombres escritos por personas). */
export function cleanName(value: string | null | undefined, max = 80): string {
  const text = (value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const COPY = {
  es: {
    someone: 'Alguien',
    subject: (by: string, pet: string) => `${by} te invita a cuidar de ${pet} en Kitom`,
    hello: 'Hola:',
    lead: (by: string, pet: string) => `${by} te ha invitado a cuidar de ${pet} en Kitom.`,
    role: { viewer: 'Podrás ver su ficha y sus registros.', editor: 'Podrás ver y editar su ficha y sus registros.' },
    how: 'Abre Kitom en tu móvil y entra en Invitaciones, en Hoy, para aceptarla o rechazarla.',
    ignore: 'Si no conoces a esta persona, rechaza la invitación o ignora este mensaje.',
    footer:
      'Recibes este email porque tienes una cuenta de Kitom. Puedes desactivar estos avisos en Ajustes › Notificaciones.',
    pushTitle: (pet: string) => `Invitación para cuidar de ${pet}`,
    pushBody: (by: string) => `${by} te invita a cuidar de su mascota. Toca para responder.`,
  },
  en: {
    someone: 'Someone',
    subject: (by: string, pet: string) => `${by} invited you to look after ${pet} on Kitom`,
    hello: 'Hi,',
    lead: (by: string, pet: string) => `${by} has invited you to look after ${pet} on Kitom.`,
    role: { viewer: 'You will be able to see their profile and logs.', editor: 'You will be able to see and edit their profile and logs.' },
    how: 'Open Kitom on your phone and go to Invitations, on Today, to accept or decline it.',
    ignore: "If you don't know this person, decline the invitation or ignore this message.",
    footer: 'You are receiving this email because you have a Kitom account. You can turn these notices off in Settings › Notifications.',
    pushTitle: (pet: string) => `Invitation to look after ${pet}`,
    pushBody: (by: string) => `${by} invited you to look after their pet. Tap to respond.`,
  },
} as const;

export function buildEmail(item: ClaimedNotification): EmailMessage | null {
  if (!item.inviteeEmail) return null;
  const lang = languageOf(item.inviteeLocale);
  const copy = COPY[lang];
  const by = cleanName(item.inviterName) || copy.someone;
  const pet = cleanName(item.petName) || 'Kitom';
  const paragraphs = [copy.lead(by, pet), copy.role[item.role], copy.how, copy.ignore];
  const html = [
    `<!doctype html><html lang="${lang}"><body style="margin:0;padding:24px;background:#F2F5F3;font-family:Arial,Helvetica,sans-serif;color:#13201F">`,
    '<div style="max-width:520px;margin:0 auto;background:#FFFFFF;border-radius:16px;padding:28px">',
    '<p style="margin:0 0 20px;font-size:20px;font-weight:bold;color:#0E3B39">Kitom</p>',
    `<p style="margin:0 0 12px;font-size:16px;line-height:24px">${escapeHtml(copy.hello)}</p>`,
    ...paragraphs.map((text) => `<p style="margin:0 0 12px;font-size:16px;line-height:24px">${escapeHtml(text)}</p>`),
    `<p style="margin:24px 0 0;font-size:13px;line-height:20px;color:#5B6B69">${escapeHtml(copy.footer)} <a href="${SITE_URL}" style="color:#0E3B39">kitom.app</a></p>`,
    '</div></body></html>',
  ].join('');
  const text = [copy.hello, '', ...paragraphs, '', copy.footer, SITE_URL].join('\n');
  return {
    to: item.inviteeEmail,
    subject: copy.subject(by, pet),
    html,
    text,
    // Resend no envía dos veces el mismo mensaje (24 h): un reintento tras un corte no duplica el email.
    idempotencyKey: `kitom-invitation-${item.invitationId}-${Date.parse(item.invitedAt) || 0}`,
  };
}

export function buildPushMessages(item: ClaimedNotification): PushMessage[] {
  const copy = COPY[languageOf(item.inviteeLocale)];
  const by = cleanName(item.inviterName) || copy.someone;
  const pet = cleanName(item.petName) || 'Kitom';
  return item.pushTokens.map((to) => ({
    to,
    title: copy.pushTitle(pet),
    body: copy.pushBody(by),
    data: { url: INVITATIONS_URL },
    sound: 'default',
    channelId: INVITATIONS_CHANNEL_ID,
    priority: 'high',
  }));
}

function codeOf(error: unknown): string {
  return error instanceof NotifyError ? error.code : 'unexpected';
}

async function deliverEmail(item: ClaimedNotification, gateways: NotifyGateways): Promise<ChannelResult> {
  if (!item.sendEmail) return { done: true, status: '' };
  if (!gateways.sendEmail) return { done: true, status: 'not_configured' };
  const message = buildEmail(item);
  if (!message) return { done: true, status: 'no_email' };
  try {
    const result = await gateways.sendEmail(message);
    return { done: true, status: result };
  } catch (error) {
    return { done: false, status: codeOf(error) };
  }
}

async function deliverPush(item: ClaimedNotification, gateways: NotifyGateways): Promise<ChannelResult & { invalid: string[] }> {
  if (!item.sendPush) return { done: true, status: '', invalid: [] };
  const messages = buildPushMessages(item);
  if (messages.length === 0) return { done: true, status: 'no_devices', invalid: [] };
  let tickets: PushTicket[];
  try {
    tickets = await gateways.sendPush(messages);
  } catch (error) {
    return { done: false, status: codeOf(error), invalid: [] };
  }
  const invalid = messages.filter((_, index) => tickets[index] === 'not_registered').map((message) => message.to);
  if (tickets.some((ticket) => ticket === 'ok')) return { done: true, status: 'sent', invalid };
  if (invalid.length === messages.length) return { done: true, status: 'no_devices', invalid };
  return { done: false, status: 'expo_error', invalid };
}

/** Envía los avisos reservados de un usuario. Devuelve cuántos procesó (solo para el registro). */
export async function notifyInviter(inviterId: string, gateways: NotifyGateways): Promise<number> {
  const items = await gateways.claim(inviterId);
  for (const item of items) {
    let email: ChannelResult;
    let push: ChannelResult & { invalid: string[] };
    if (!item.alertsEnabled) {
      email = { done: true, status: 'opted_out' };
      push = { done: true, status: 'opted_out', invalid: [] };
    } else {
      [email, push] = await Promise.all([deliverEmail(item, gateways), deliverPush(item, gateways)]);
    }
    await gateways.complete({
      invitationId: item.invitationId,
      invitedAt: item.invitedAt,
      email: { done: email.done, status: email.status },
      push: { done: push.done, status: push.status },
      invalidTokens: push.invalid,
    });
    gateways.log('invitation_notify', {
      email: email.status || 'skipped',
      push: push.status || 'skipped',
      invalid_tokens: push.invalid.length,
    });
  }
  return items.length;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export type NotifyConfig = { configured: boolean };

export async function handleInvitationNotify(
  request: Request,
  config: NotifyConfig,
  gateways: NotifyGateways,
): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!config.configured) {
    gateways.log('invitation_notify_misconfigured');
    return json(500, { error: 'server_misconfigured' });
  }
  const header = request.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  let userId: string | null = null;
  if (token) {
    try {
      userId = await gateways.getUserId(token);
    } catch {
      userId = null;
    }
  }
  if (!userId) return json(401, { error: 'not_authenticated' });

  try {
    await notifyInviter(userId, gateways);
  } catch (error) {
    gateways.log('invitation_notify_failed', { code: codeOf(error) });
    return json(500, { error: 'server_error' });
  }
  // Misma respuesta con avisos o sin ellos.
  return json(200, { status: 'ok' });
}
