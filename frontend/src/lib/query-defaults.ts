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
 * Ninguna feature fija su propio `networkMode`. Decisión y pendientes: `docs/DECISIONS.md` (2026-10-13).
 */
export function queryDefaultOptions(platform: 'web' | 'native'): DefaultOptions {
  const networkMode = platform === 'web' ? undefined : 'always';
  return {
    queries: {
      staleTime: 30_000,
      retry: 1,
      networkMode,
    },
    mutations: {
      retry: 0,
      networkMode,
    },
  };
}
