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

/**
 * Función para `onlineManager.setEventListener`: se suscribe a los cambios de red, lee el estado
 * inicial y devuelve la limpieza. Si leer el estado o suscribirse falla, se conserva el último
 * valor conocido (al arrancar, "conectado"): un error de lectura nunca se convierte en "sin conexión".
 */
export function createConnectivityListener(source: NetworkSource) {
  return (setOnline: (online: boolean) => void): (() => void) => {
    let active = true;
    let notified = false;
    let subscription: { remove(): void } | null = null;

    const notify = (state: NetworkSnapshot) => {
      if (!active) return;
      notified = true;
      setOnline(isOnline(state));
    };

    try {
      subscription = source.addListener(notify);
    } catch {
      // Sin eventos de red: queda el estado inicial.
    }

    // El estado inicial solo vale si todavía no ha llegado un evento (más reciente).
    Promise.resolve()
      .then(() => source.getState())
      .then((state) => {
        if (!notified) notify(state);
      })
      .catch(() => {});

    return () => {
      active = false;
      try {
        subscription?.remove();
      } catch {
        // La suscripción ya no existe.
      }
      subscription = null;
    };
  };
}
