/**
 * Una sola ejecución a la vez de `task`: mientras hay una en curso, las llamadas siguientes reciben esa
 * misma promesa en vez de empezar otra (p. ej. cerrar sesión desde dos sitios a la vez). Módulo puro.
 * A diferencia de `submit-guard.ts`, quien llega tarde también espera al resultado.
 */
export function singleFlight<T>(task: () => Promise<T>): () => Promise<T> {
  let current: Promise<T> | null = null;
  return () => {
    current ??= task().finally(() => {
      current = null;
    });
    return current;
  };
}
