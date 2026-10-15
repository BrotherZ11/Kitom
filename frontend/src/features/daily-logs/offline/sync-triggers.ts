/**
 * Cuándo pedir una pasada de sincronización: al arrancar, al recuperar la conectividad y al volver
 * la app a primer plano. Módulo puro: las fuentes de eventos se inyectan. Todas acaban en
 * `requestSync`, que ya agrupa las peticiones simultáneas en una sola pasada.
 */

export type SyncTriggerSources = {
  /** Se llama con `true`/`false` cuando cambia la conectividad (p. ej. `onlineManager.subscribe`). */
  subscribeOnline: (listener: (online: boolean) => void) => () => void;
  /** Se llama cuando la app vuelve a primer plano. */
  subscribeForeground: (listener: () => void) => () => void;
};

export function connectSyncTriggers(requestSync: () => unknown, sources: SyncTriggerSources): () => void {
  const unsubscribeOnline = sources.subscribeOnline((online) => {
    if (online) void requestSync();
  });
  const unsubscribeForeground = sources.subscribeForeground(() => void requestSync());
  void requestSync();
  return () => {
    unsubscribeOnline();
    unsubscribeForeground();
  };
}
