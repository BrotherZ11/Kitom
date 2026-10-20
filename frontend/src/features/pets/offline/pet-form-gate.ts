import type { PetDetailView } from './pet-view.ts';

/**
 * Qué muestran el alta y la edición de una mascota según la conexión. Módulo puro (`npm test`).
 * Crear, editar y eliminar mascotas necesitan el servidor: no hay escrituras de mascotas sin conexión.
 *
 * - Sin poder usar el servidor (`writable` falso: sin conexión o sesión sin comprobar), un formulario
 *   que aún no se puede mostrar se sustituye por «necesitas conexión» (nunca un formulario que parezca
 *   que va a guardar). Si los datos para mostrarlo ya estaban en memoria, se muestra con `offline`:
 *   aviso visible y envío deshabilitado (lo escrito se conserva hasta que vuelva la conexión).
 * - La edición nunca se abre sobre la copia del dispositivo (puede estar desactualizada).
 */

type QueryLike = { status: 'pending' | 'success' | 'error'; error: unknown };

export type PetFormGate =
  | { state: 'form'; offline: boolean }
  | { state: 'loading' }
  | { state: 'offline' }
  | { state: 'error'; error: unknown; source: 'pet' | 'species' }
  | { state: 'not_found' };

type GateInput = {
  species: QueryLike;
  /** Sesión utilizable y conexión según el sistema. */
  writable: boolean;
  isOfflineError: (error: unknown) => boolean;
};

function speciesProblem({ species, writable, isOfflineError }: GateInput): PetFormGate | null {
  if (species.status === 'error') {
    return !writable || isOfflineError(species.error)
      ? { state: 'offline' }
      : { state: 'error', error: species.error, source: 'species' };
  }
  if (species.status === 'pending') return writable ? { state: 'loading' } : { state: 'offline' };
  return null;
}

export function resolveNewPetForm(input: GateInput): PetFormGate {
  return speciesProblem(input) ?? { state: 'form', offline: !input.writable };
}

export function resolveEditPetForm(input: GateInput & { pet: PetDetailView }): PetFormGate {
  const { pet, writable } = input;
  if (pet.state === 'error') return { state: 'error', error: pet.error, source: 'pet' };
  if (pet.state === 'offline_unavailable' || pet.state === 'local_error' || pet.state === 'unavailable') {
    return { state: 'offline' };
  }
  if (pet.state === 'ready' && pet.source === 'device') return { state: 'offline' };
  if (pet.state === 'loading') return writable ? { state: 'loading' } : { state: 'offline' };
  const species = speciesProblem(input);
  if (species) return species;
  if (pet.state === 'not_found') return { state: 'not_found' };
  return { state: 'form', offline: !writable };
}
