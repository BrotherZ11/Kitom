/**
 * Señal de conectividad para TanStack Query (`onlineManager`). Módulo puro (sin imports): la fuente
 * real (`expo-network`) se conecta en `query-client.ts` y aquí se prueba con una falsa.
 *
 * Es una señal, no una garantía: "hay red" no significa que Supabase responda, y una petición que
 * falla no significa que no haya red. Esto solo refleja lo que dice el sistema operativo.
 */

/** Estado de red tal como lo da el proveedor: cualquier campo puede faltar. */
export type NetworkSnapshot = {
  isConnected?: boolean;
  isInternetReachable?: boolean;
};

export type NetworkSource = {
  getState(): Promise<NetworkSnapshot>;
  addListener(listener: (state: NetworkSnapshot) => void): { remove(): void };
};

/**
 * Solo hay "sin conexión" cuando el sistema lo afirma (`isConnected === false`). Un estado
 * desconocido cuenta como conectado: si no lo está, la petición fallará y se tratará como error de
 * red. `isInternetReachable` no se usa: en Android es `false` en redes sin salida validada a
 * internet (portal cautivo, red local de desarrollo) aunque el servidor sea alcanzable.
 */
export function isOnline(state: NetworkSnapshot | null | undefined): boolean {
  return state?.isConnected !== false;
}

/** Relecturas del estado además de los eventos (fase 11). Todo opcional: sin ellas, solo eventos. */
export type ConnectivityRechecks = {
  /** Avisa cuando la app vuelve a primer plano (p. ej. `AppState` → `active`). */
  subscribeForeground?: (listener: () => void) => () => void;
  /** Mientras la señal diga «sin conexión», se vuelve a leer cada `offlineRecheckMs`. */
  offlineRecheckMs?: number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

/**
 * Función para `onlineManager.setEventListener`: se suscribe a los cambios de red, lee el estado
 * inicial y devuelve la limpieza. Si leer el estado o suscribirse falla, se conserva el último
 * valor conocido (al arrancar, "conectado"): un error de lectura nunca se convierte en "sin conexión".
 *
 * Los eventos del proveedor pueden quedarse atrás: en Android (comprobado en el emulador con Expo Go)
 * al reactivar Wi-Fi y datos a la vez, el último evento puede decir «sin conexión» con la Wi-Fi ya
 * conectada, y nada lo corregía: los motores de sincronización no enviaban hasta otro cambio de red.
 * Por eso el estado también se vuelve a leer al volver a primer plano y, mientras diga «sin conexión»,
 * cada `offlineRecheckMs` (una consulta local al sistema, no una petición de red). Una relectura nunca
 * pisa un evento que llegó mientras se leía.
 */
export function createConnectivityListener(source: NetworkSource, rechecks: ConnectivityRechecks = {}) {
  const setTimer = rechecks.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearTimer = rechecks.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  return (setOnline: (online: boolean) => void): (() => void) => {
    let active = true;
    /** Estados publicados (eventos o relecturas): una relectura solo vale si no llegó otro mientras tanto. */
    let published = 0;
    let subscription: { remove(): void } | null = null;
    let unsubscribeForeground: (() => void) | null = null;
    let timer: unknown = null;

    const cancelRecheck = () => {
      if (timer !== null) clearTimer(timer);
      timer = null;
    };

    const notify = (state: NetworkSnapshot) => {
      if (!active) return;
      published += 1;
      const online = isOnline(state);
      setOnline(online);
      cancelRecheck();
      if (!online && rechecks.offlineRecheckMs) {
        timer = setTimer(() => {
          timer = null;
          reread();
        }, rechecks.offlineRecheckMs);
      }
    };

    /** Lee el estado actual; si mientras tanto llegó otro estado (más reciente), se descarta. */
    function reread() {
      const startedAt = published;
      Promise.resolve()
        .then(() => source.getState())
        .then((state) => {
          if (published === startedAt) notify(state);
        })
        .catch(() => {});
    }

    try {
      subscription = source.addListener(notify);
    } catch {
      // Sin eventos de red: queda el estado inicial.
    }
    try {
      unsubscribeForeground = rechecks.subscribeForeground?.(reread) ?? null;
    } catch {
      // Sin aviso de primer plano: quedan los eventos y la relectura sin conexión.
    }

    // El estado inicial solo vale si todavía no ha llegado un evento (más reciente).
    reread();

    return () => {
      active = false;
      cancelRecheck();
      try {
        subscription?.remove();
      } catch {
        // La suscripción ya no existe.
      }
      try {
        unsubscribeForeground?.();
      } catch {
        // Ya no existe.
      }
      subscription = null;
      unsubscribeForeground = null;
    };
  };
}
