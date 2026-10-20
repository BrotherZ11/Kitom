/**
 * `fetch` del cliente de Supabase para que una respuesta que no viene del servidor de Auth nunca cierre
 * la sesión. Módulo puro (se prueba con `npm test` contra auth-js real).
 *
 * auth-js trata como fallo de red (reintentable, la sesión se conserva) los fallos de `fetch` y los 5xx.
 * Cualquier otra respuesta de error a la renovación del token la toma como rechazo: con el token de
 * acceso caducado **borra la sesión y emite `SIGNED_OUT`**. Un proxy, un portal cautivo o una CDN que
 * responde, por ejemplo, un 403 o un 404 en HTML cerraría así la sesión sin que el servidor la haya
 * visto. El servidor de Auth (y su pasarela) siempre responde JSON: una respuesta de error a la
 * renovación que no lo es se convierte en un fallo de red. Las respuestas JSON (también los rechazos
 * reales: token revocado o ya usado) y el resto de peticiones no se tocan.
 */

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createAuthRefreshFetch({ fetch, supabaseUrl }: { fetch: Fetch; supabaseUrl: string }): Fetch {
  const base = supabaseUrl.endsWith('/') ? supabaseUrl : `${supabaseUrl}/`;
  const tokenUrl = new URL('auth/v1/token', base).href;

  return async (input, init) => {
    const response = await fetch(input, init);
    if (response.ok) return response;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(tokenUrl) || !url.includes('grant_type=refresh_token')) return response;
    if ((response.headers.get('Content-Type') ?? '').includes('json')) return response;
    throw new TypeError(`Network request failed: non-JSON ${response.status} response to the token refresh`);
  };
}
