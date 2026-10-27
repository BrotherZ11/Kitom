import type { Breed } from '@/features/pets/types';

import type { LocalBreedCatalog } from './breed-catalog-repository.ts';

/**
 * Qué muestra el selector de razas: catálogo del servidor (TanStack Query) + copia del dispositivo.
 * Módulo puro (`npm test`); los componentes solo pintan lo que sale de aquí.
 *
 * - Con el catálogo del servidor en memoria, ese (ya pasó por la copia: es el más reciente conocido).
 * - Con conexión y sesión, mientras llega la primera respuesta, se carga (no se enseña la copia para
 *   luego sustituirla).
 * - Sin servidor (sin conexión, sesión `offline` o petición fallida por la red) o con un error del
 *   servidor: la copia del dispositivo, si la hay. Sin copia (o no válida), «no disponible sin
 *   conexión» o el error del servidor; si el almacenamiento falla, un error del dispositivo. Nunca un
 *   catálogo vacío que el servidor no haya confirmado.
 */

type QueryLike<T> = { status: 'pending' | 'success' | 'error'; data: T | undefined; error: unknown };

export type BreedCatalogView =
  | { state: 'loading' }
  /** `savedAt`: cuándo se guardó la copia (solo con `source: 'device'`). */
  | { state: 'ready'; breeds: Breed[]; source: 'server' | 'device'; savedAt: string | null }
  /** Error del servidor que no es de conexión, sin copia que mostrar. */
  | { state: 'error'; error: unknown }
  /** Sin conexión y el catálogo nunca se descargó en este dispositivo (o la copia no es válida). */
  | { state: 'offline_unavailable' }
  /** Sin conexión y el almacenamiento del dispositivo no se pudo leer. */
  | { state: 'local_error'; error: unknown };

export type BreedCatalogViewInput = {
  remote: QueryLike<Breed[]>;
  local: QueryLike<LocalBreedCatalog>;
  /** Sesión utilizable (`canUseServer`) y conexión según el sistema. */
  serverUsable: boolean;
  isOfflineError: (error: unknown) => boolean;
};

/** ¿Hace falta leer la copia del dispositivo? (Solo si no hay catálogo del servidor que mostrar.) */
export function needsLocalBreedCatalog(remote: QueryLike<Breed[]>, serverUsable: boolean): boolean {
  return remote.data === undefined && (remote.status === 'error' || !serverUsable);
}

export function resolveBreedCatalogView({ remote, local, serverUsable, isOfflineError }: BreedCatalogViewInput): BreedCatalogView {
  if (remote.data !== undefined) return { state: 'ready', breeds: remote.data, source: 'server', savedAt: null };

  const serverError = remote.status === 'error' && !isOfflineError(remote.error);
  const offline = !serverUsable || remote.status === 'error';
  if (!offline) return { state: 'loading' };

  if (local.status === 'error') return serverError ? { state: 'error', error: remote.error } : { state: 'local_error', error: local.error };
  if (local.status === 'pending' || local.data === undefined) return { state: 'loading' };
  if (local.data.status === 'loaded') {
    return { state: 'ready', breeds: local.data.breeds, source: 'device', savedAt: local.data.savedAt };
  }
  return serverError ? { state: 'error', error: remote.error } : { state: 'offline_unavailable' };
}

/** Razas que se pueden elegir para una especie: activas y de esa especie, en el orden del catálogo. */
export function selectableBreeds(breeds: readonly Breed[], speciesId: string): Breed[] {
  return breeds.filter((breed) => breed.isActive && breed.speciesId === speciesId);
}

/** Una raza del catálogo por id (activa o no), o `undefined` si el catálogo no la tiene. */
export function findBreed(view: BreedCatalogView, breedId: string | null): Breed | undefined {
  if (view.state !== 'ready' || !breedId) return undefined;
  return view.breeds.find((breed) => breed.id === breedId);
}
