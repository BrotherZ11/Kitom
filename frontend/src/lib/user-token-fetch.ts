/**
 * `fetch` del cliente de Supabase que nunca envía una petición de datos (PostgREST, Storage, Edge
 * Functions) sin el token de un usuario. Módulo puro (se prueba con `npm test`).
 *
 * Sin sesión utilizable (p. ej. arranque sin conexión con el token caducado: Supabase Auth aún no lo ha
 * podido renovar), supabase-js enviaría la petición como `anon` y RLS respondería «vacío»: una lista de
 * mascotas vacía o un registro «que no existe», que la app tomaría por datos reales y podría copiar
 * sobre lo guardado en el dispositivo. Esas peticiones no salen: fallan en el momento con
 * `SessionUnavailableError`, que la app trata como «sin conexión». Auth (`/auth/v1`) no se toca.
 *
 * postgrest-js reintenta (1 s, 2 s, 4 s) cualquier GET cuyo `fetch` falle, salvo los abortos: el error
 * lleva `code: 'ABORT_ERR'` para fallar sin esperas (probado contra el postgrest-js instalado en
 * `user-token-fetch.test.mjs`). TanStack Query conserva su propio reintento.
 */

export const SESSION_UNAVAILABLE = 'session_unavailable';

export class SessionUnavailableError extends Error {
  /** Para postgrest-js es un aborto: no lo reintenta. El motivo real va en `name` y `message`. */
  readonly code = 'ABORT_ERR';

  constructor() {
    // postgrest-js y storage-js solo conservan el nombre y el mensaje: el mensaje lleva el código.
    super(`${SESSION_UNAVAILABLE}: request not sent without a user session`);
    this.name = 'SessionUnavailableError';
  }
}

/** ¿El error (o su mensaje, tal como lo deja supabase-js) viene de esta guardia? */
export function isSessionUnavailableError(error: unknown): boolean {
  if (error instanceof SessionUnavailableError) return true;
  const message = typeof error === 'object' && error !== null ? (error as { message?: unknown }).message : null;
  return typeof message === 'string' && message.includes(SESSION_UNAVAILABLE);
}

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const DATA_PATHS = ['rest/v1/', 'storage/v1/', 'functions/v1/'];

export function createUserTokenFetch({
  fetch,
  supabaseUrl,
  anonKey,
}: {
  fetch: Fetch;
  supabaseUrl: string;
  anonKey: string;
}): Fetch {
  const base = supabaseUrl.endsWith('/') ? supabaseUrl : `${supabaseUrl}/`;
  const guarded = DATA_PATHS.map((path) => new URL(path, base).href);

  return (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (guarded.some((prefix) => url.startsWith(prefix))) {
      const headers = new Headers(init?.headers ?? (typeof input === 'object' && 'headers' in input ? input.headers : undefined));
      const authorization = headers.get('Authorization');
      if (!authorization || authorization === `Bearer ${anonKey}`) return Promise.reject(new SessionUnavailableError());
    }
    return fetch(input, init);
  };
}
