// =====================================================================
// KITOM · Avisos de invitación: Auth, PostgREST, Resend y Expo por HTTP
// =====================================================================
// Con `fetch`, para que el mismo código corra en Deno y en las pruebas de Node.
// Los errores son códigos (NotifyError), nunca el mensaje del servidor, la URL
// ni claves. Ningún registro lleva emails, nombres ni tokens.
// =====================================================================
import {
  NotifyError,
  type ClaimedNotification,
  type CompleteInput,
  type EmailMessage,
  type PushMessage,
  type PushTicket,
} from './notify.ts';

const REQUEST_TIMEOUT_MS = 10_000;
const RESEND_API = 'https://api.resend.com/emails';
const EXPO_PUSH_API = 'https://exp.host/--/api/v2/push/send';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Http = { fetch?: typeof fetch; timeoutMs?: number };

function base(url: string): string {
  return url.replace(/\/+$/, '');
}

async function call(http: Http, url: string, init: RequestInit): Promise<Response> {
  try {
    return await (http.fetch ?? fetch)(url, { ...init, signal: AbortSignal.timeout(http.timeoutMs ?? REQUEST_TIMEOUT_MS) });
  } catch {
    throw new NotifyError('network');
  }
}

export function createAuthGateway(config: Http & { url: string; anonKey: string }) {
  return {
    async getUserId(token: string): Promise<string | null> {
      let response: Response;
      try {
        response = await call(config, `${base(config.url)}/auth/v1/user`, {
          method: 'GET',
          headers: { apikey: config.anonKey, Authorization: `Bearer ${token}` },
        });
      } catch {
        return null;
      }
      if (!response.ok) return null;
      const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
      return typeof body?.id === 'string' && UUID.test(body.id) ? body.id : null;
    },
  };
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Fila de pet_invitation_notifications_claim → aviso. Una fila sin lo esencial se descarta. */
export function toClaimed(row: unknown): ClaimedNotification | null {
  if (typeof row !== 'object' || row === null) return null;
  const r = row as Record<string, unknown>;
  const invitationId = asString(r.invitation_id);
  const invitedAt = asString(r.invited_at);
  if (!invitationId || !UUID.test(invitationId) || !invitedAt) return null;
  return {
    invitationId,
    invitedAt,
    inviteeEmail: asString(r.invitee_email),
    inviteeLocale: asString(r.invitee_locale),
    inviterName: asString(r.inviter_name),
    petName: asString(r.pet_name) ?? '',
    role: r.role === 'editor' ? 'editor' : 'viewer',
    alertsEnabled: r.alerts_enabled !== false,
    sendEmail: r.send_email === true,
    sendPush: r.send_push === true,
    pushTokens: Array.isArray(r.push_tokens) ? r.push_tokens.filter((token): token is string => typeof token === 'string') : [],
  };
}

export function createQueueGateway(config: Http & { url: string; serviceKey: string }) {
  const headers = {
    apikey: config.serviceKey,
    Authorization: `Bearer ${config.serviceKey}`,
    'Content-Type': 'application/json',
  };
  return {
    async claim(inviterId: string): Promise<ClaimedNotification[]> {
      const response = await call(config, `${base(config.url)}/rest/v1/rpc/pet_invitation_notifications_claim`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ p_inviter_id: inviterId, p_limit: 5 }),
      });
      if (!response.ok) throw new NotifyError('claim_failed');
      const rows = (await response.json().catch(() => null)) as unknown;
      if (!Array.isArray(rows)) throw new NotifyError('claim_failed');
      return rows.map(toClaimed).filter((item): item is ClaimedNotification => item !== null);
    },
    async complete(input: CompleteInput): Promise<void> {
      const response = await call(config, `${base(config.url)}/rest/v1/rpc/pet_invitation_notifications_complete`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          p_invitation_id: input.invitationId,
          p_invited_at: input.invitedAt,
          p_email_done: input.email.done,
          p_email_status: input.email.status || null,
          p_push_done: input.push.done,
          p_push_status: input.push.status || null,
          p_invalid_tokens: input.invalidTokens.slice(0, 20),
        }),
      });
      if (!response.ok) throw new NotifyError('complete_failed');
    },
  };
}

export function createResendGateway(config: Http & { apiKey: string; from: string; apiUrl?: string }) {
  return {
    async sendEmail(message: EmailMessage): Promise<'sent' | 'rejected'> {
      const response = await call(config, config.apiUrl ?? RESEND_API, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': message.idempotencyKey,
        },
        body: JSON.stringify({
          from: config.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      });
      if (response.ok) return 'sent';
      // Un email que Resend no acepta (dirección o remitente no válidos) no mejora al repetirlo.
      if (response.status === 400 || response.status === 403 || response.status === 422) return 'rejected';
      throw new NotifyError('resend_http');
    },
  };
}

export function createExpoPushGateway(config: Http & { accessToken?: string; apiUrl?: string }) {
  return {
    async sendPush(messages: PushMessage[]): Promise<PushTicket[]> {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      };
      if (config.accessToken) headers.Authorization = `Bearer ${config.accessToken}`;
      const response = await call(config, config.apiUrl ?? EXPO_PUSH_API, {
        method: 'POST',
        headers,
        body: JSON.stringify(messages),
      });
      if (!response.ok) throw new NotifyError('expo_http');
      const body = (await response.json().catch(() => null)) as { data?: unknown } | null;
      if (!Array.isArray(body?.data)) throw new NotifyError('expo_http');
      return messages.map((_, index) => {
        const ticket = (body.data as unknown[])[index] as { status?: unknown; details?: { error?: unknown } } | undefined;
        if (ticket?.status === 'ok') return 'ok';
        if (ticket?.details?.error === 'DeviceNotRegistered') return 'not_registered';
        return 'error';
      });
    },
  };
}
