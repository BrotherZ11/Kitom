import type { DefaultOptions } from '@tanstack/react-query';

/**
 * Opciones por defecto del QueryClient. Módulo puro (solo imports de tipos): se prueba con
 * `npm test` contra `@tanstack/query-core`.
 *
 * `networkMode` por plataforma: al conectar la señal de red (`connectivity.ts`) se conserva lo que
 * cada plataforma hacía antes de tenerla. No es una política nueva.
 * - Móvil: TanStack Query no recibía ninguna señal (siempre "conectado"), así que toda petición se
 *   intentaba y, sin red, fallaba con error de red. `always` es exactamente eso. Con el modo por
 *   defecto (`online`), sin conexión las queries se quedarían cargando y **todas** las mutaciones
 *   (crear, editar y borrar mascotas, subir y quitar fotos, guardar registros) quedarían en pausa y
 *   se ejecutarían solas al reconectar.
 * - Web: ya recibía la señal del navegador y usaba el modo por defecto; no se toca.
 *
 * Revalidación al reconectar (`refetchOnReconnect`), solo en móvil (decisión del 2026-10-20, que
 * modifica la del 2026-10-13): con `always` TanStack Query la desactiva por defecto, y una query que
 * falló sin red (p. ej. la lista de mascotas) se quedaba en error hasta pulsar «Reintentar». Ahora, al
 * volver la red, se vuelven a pedir las queries **caducadas** que tengan observadores, como en web.
 * Es seguro porque toda query de servidor pasa por `serverCall`: sin sesión utilizable (`offline` o
 * sin comprobar) falla al instante sin enviar nada, y al recuperar la sesión AuthProvider las vuelve
 * a pedir. Las mutaciones no cambian: no quedan en pausa ni se reenvían solas al reconectar.
 *
 * Solo Daily Logs fija su propio `networkMode` (`daily-log-cache.ts`). Decisiones: `docs/DECISIONS.md`
 * (2026-10-13 y 2026-10-20).
 */
/**
 * Un reintento, salvo si la petición ni salió por no haber sesión utilizable (`SessionUnavailableError` de
 * `serverCall`/`user-token-fetch.ts`): repetirla daría lo mismo y solo retrasaba un segundo la copia del dispositivo al
 * arrancar sin conexión (QA-02). Por nombre o mensaje: este módulo no importa nada en ejecución.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  if (typeof error === 'object' && error !== null) {
    const { name, message } = error as { name?: unknown; message?: unknown };
    if (name === 'SessionUnavailableError') return false;
    if (typeof message === 'string' && message.includes('session_unavailable')) return false;
  }
  return true;
}

export function queryDefaultOptions(platform: 'web' | 'native'): DefaultOptions {
  const networkMode = platform === 'web' ? undefined : 'always';
  return {
    queries: {
      staleTime: 30_000,
      retry: shouldRetryQuery,
      networkMode,
      ...(platform === 'native' ? { refetchOnReconnect: true } : {}),
    },
    mutations: {
      retry: 0,
      networkMode,
    },
  };
}
