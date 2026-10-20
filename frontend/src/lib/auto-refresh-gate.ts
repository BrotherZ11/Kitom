/**
 * Cuándo corre el temporizador de renovación de supabase-js en móvil: solo con la app en primer plano
 * **y** con conexión según el sistema. Módulo puro (sin imports): `start`/`stop` son
 * `supabase.auth.startAutoRefresh`/`stopAutoRefresh` y se conectan en `lib/supabase.ts`.
 *
 * Por qué también la red (auth-js 2.117, probado en `auto-refresh-gate.test.mjs`): sin conexión, cada
 * pasada del temporizador (cada 30 s) con el token caducado reintenta la renovación ~25 s y, al fallar,
 * auth-js devuelve ese mismo fallo durante 60 s sin volver a intentarlo. Si la red vuelve dentro de ese
 * margen, la sesión no se puede renovar hasta que termine. Sin intentos mientras el sistema dice «sin
 * conexión», al volver la red la renovación sale al momento. «Sin conexión» es solo
 * `isConnected === false` (`lib/connectivity.ts`); un estado desconocido cuenta como conectado.
 *
 * auth-js arranca el temporizador por su cuenta al terminar de inicializarse, sin mirar la red: tras
 * su inicialización hay que llamar a `sync()` para volver a aplicar la decisión.
 */

export type AutoRefreshGate = {
  setForeground(foreground: boolean): void;
  setOnline(online: boolean): void;
  /** Aplica la decisión aunque no haya cambiado (p. ej. después de que auth-js lo arrancara solo). */
  sync(): void;
};

export function createAutoRefreshGate({
  start,
  stop,
  foreground,
  online,
}: {
  start: () => void;
  stop: () => void;
  foreground: boolean;
  online: boolean;
}): AutoRefreshGate {
  let isForeground = foreground;
  let isOnline = online;
  let running: boolean | null = null;

  const apply = (force: boolean) => {
    const next = isForeground && isOnline;
    if (!force && next === running) return;
    running = next;
    if (next) start();
    else stop();
  };

  return {
    setForeground(value) {
      isForeground = value;
      apply(false);
    },
    setOnline(value) {
      isOnline = value;
      apply(false);
    },
    sync: () => apply(true),
  };
}
