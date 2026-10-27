import type { LocalPetOperation } from './pet-operation.ts';
import type { PetDetailView } from './pet-view.ts';

/**
 * Qué muestran el alta y la edición de una mascota. Módulo puro (`npm test`).
 *
 * Desde la fase 8, crear y editar se guardan primero en el dispositivo y se envían al volver la
 * conexión, así que el formulario se abre sin conexión si hay con qué rellenarlo:
 * - el catálogo de especies (del servidor o de la copia del dispositivo, `species-snapshot.ts`);
 * - en la edición, la mascota (del servidor, de la copia o el borrador de un alta local). La base de la
 *   edición es esa versión: la precondición `updated_at` del envío detecta si cambió en el servidor.
 * Con `offline`, el formulario avisa de que se guardará en el dispositivo. Sin datos con qué rellenarlo,
 * «necesitas conexión». Una mascota con un conflicto o sin permiso no se vuelve a editar hasta decidir
 * qué hacer con lo guardado (`blocked`). Las fotos siguen necesitando conexión; eliminar se guarda en el
 * dispositivo (fase 10) y una mascota con una eliminación guardada no se edita (la ficha la enseña).
 */

type QueryLike = { status: 'pending' | 'success' | 'error'; error: unknown };

export type PetFormGate =
  | { state: 'form'; offline: boolean }
  | { state: 'loading' }
  /** Sin conexión y sin datos con los que mostrar el formulario. */
  | { state: 'offline' }
  /** Hay un conflicto o falta el permiso: primero se decide qué hacer con lo guardado. */
  | { state: 'blocked' }
  | { state: 'error'; error: unknown; source: 'pet' | 'species' }
  | { state: 'not_found' };

type GateInput = {
  species: QueryLike;
  /** Sesión utilizable y conexión según el sistema. */
  writable: boolean;
  isOfflineError: (error: unknown) => boolean;
};

function speciesProblem({ species, isOfflineError }: GateInput): PetFormGate | null {
  if (species.status === 'error') {
    return isOfflineError(species.error) ? { state: 'offline' } : { state: 'error', error: species.error, source: 'species' };
  }
  if (species.status === 'pending') return { state: 'loading' };
  return null;
}

export function resolveNewPetForm(input: GateInput): PetFormGate {
  return speciesProblem(input) ?? { state: 'form', offline: !input.writable };
}

export function resolveEditPetForm(input: GateInput & { pet: PetDetailView; op: LocalPetOperation | null }): PetFormGate {
  const { pet, op, writable } = input;
  if (pet.state === 'error') return { state: 'error', error: pet.error, source: 'pet' };
  if (pet.state === 'offline_unavailable' || pet.state === 'local_error') return { state: 'offline' };
  if (pet.state === 'unavailable' || pet.state === 'not_found') return { state: 'not_found' };
  if (pet.state === 'loading') return { state: 'loading' };
  if (op && (op.status === 'conflict' || op.status === 'forbidden')) return { state: 'blocked' };
  return speciesProblem(input) ?? { state: 'form', offline: !writable };
}
