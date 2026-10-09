/**
 * Evita envíos dobles: mientras una operación está en curso, las siguientes se ignoran. Cubre los
 * toques rápidos que llegan antes de que React vuelva a pintar el botón deshabilitado. Módulo puro.
 */
export type SubmitGuard = {
  /** Ejecuta `task` si no hay otra en curso; si la hay, devuelve `null` sin ejecutarla. */
  run<T>(task: () => Promise<T>): Promise<T> | null;
  isRunning(): boolean;
};

export function createSubmitGuard(): SubmitGuard {
  let running = false;
  return {
    run(task) {
      if (running) return null;
      running = true;
      return task().finally(() => {
        running = false;
      });
    },
    isRunning: () => running,
  };
}
