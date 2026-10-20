/**
 * Datos de la mascota que necesitan las pantallas de un registro (nombre y permiso de edición). El
 * nombre puede venir de la copia del dispositivo (`usePet`, fase 7); el permiso, solo del servidor
 * (nunca se guarda). Módulo puro (se prueba con `npm test`).
 *
 * Sin conexión, o sin sesión utilizable, y sin esos datos (p. ej. arranque en frío sin copia), el
 * registro se sigue pudiendo ver y editar en el dispositivo: el nombre queda `null` («información de la
 * mascota no disponible sin conexión»; nunca se inventa) y el permiso, desconocido. Con permiso
 * desconocido se permite editar: es solo UX (RLS decide al sincronizar; si no hay permiso, el registro
 * queda «No se pudo sincronizar» con los datos intactos, como cuando se pierde el acceso sin conexión).
 * Cualquier otro error sigue siendo un error.
 */

type QueryLike<T> = { data: T | undefined; isError: boolean; error: unknown };

export type DailyLogPetContext =
  | { state: 'loading' }
  | { state: 'error'; error: unknown; source: 'pet' | 'permission' }
  /** El servidor dice que no existe o que no hay acceso. */
  | { state: 'not_found' }
  | { state: 'ready'; name: string | null; canEdit: boolean; permissionUnknown: boolean };

export function resolveDailyLogPetContext(
  pet: QueryLike<{ name: string } | null>,
  canEdit: QueryLike<boolean>,
  isOfflineError: (error: unknown) => boolean
): DailyLogPetContext {
  if (pet.data === null) return { state: 'not_found' };

  const petOffline = pet.data === undefined && pet.isError && isOfflineError(pet.error);
  const permissionOffline = canEdit.data === undefined && canEdit.isError && isOfflineError(canEdit.error);

  if (pet.data === undefined && pet.isError && !petOffline) return { state: 'error', error: pet.error, source: 'pet' };
  if (canEdit.data === undefined && canEdit.isError && !permissionOffline) {
    return { state: 'error', error: canEdit.error, source: 'permission' };
  }
  if ((pet.data === undefined && !petOffline) || (canEdit.data === undefined && !permissionOffline)) {
    return { state: 'loading' };
  }
  return {
    state: 'ready',
    name: pet.data?.name ?? null,
    canEdit: canEdit.data ?? true,
    permissionUnknown: canEdit.data === undefined,
  };
}
