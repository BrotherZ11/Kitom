import type { Pet } from '@/features/pets/types';

import type { LocalPetList } from './pet-cache-repository.ts';
import type { PetSnapshot } from './pet-snapshot.ts';

/**
 * Vistas de la lista y la ficha de mascotas: servidor (TanStack Query) + copia del dispositivo. Módulo
 * puro (`npm test`). Lo que decide cada pantalla sale de aquí; los componentes solo pintan.
 *
 * - Con datos del servidor en memoria se usan esos (pasaron por la copia local, así que son la versión
 *   más reciente conocida). Si ya no se puede usar el servidor o el último refresco falló por la red,
 *   se marcan como posiblemente desactualizados.
 * - Sin datos del servidor y sin poder usarlo (sin conexión, sesión `offline` o petición fallida por la
 *   red): la copia del dispositivo. Si no hay copia, «no disponible sin conexión», nunca «no existe» ni
 *   «no hay mascotas». Si la copia no se puede leer, un error del dispositivo (recuperable).
 * - Con conexión y sesión, mientras llega la primera respuesta, se carga como siempre (no se enseña la
 *   copia para luego sustituirla).
 * - Otros errores del servidor siguen siendo errores.
 */

type RemoteQuery<T> = {
  status: 'pending' | 'success' | 'error';
  data: T | undefined;
  error: unknown;
  /** Momento (ms) de los datos en memoria (`dataUpdatedAt` de TanStack Query). */
  dataUpdatedAt: number;
};

type LocalQuery<T> = { status: 'pending' | 'success' | 'error'; data: T | undefined; error: unknown };

export type PetViewInput<R, L> = {
  remote: RemoteQuery<R>;
  local: LocalQuery<L>;
  /** Sesión utilizable (`canUseServer`) y conexión según el sistema. */
  serverUsable: boolean;
  isOfflineError: (error: unknown) => boolean;
};

/** De dónde salen los datos y si pueden estar desactualizados (`savedAt`: ISO, para «actualizado…»). */
export type PetFreshness = { source: 'server' | 'device'; stale: boolean; savedAt: string | null };

export type PetListView =
  | { state: 'loading' }
  | ({ state: 'ready'; pets: Pet[] } & PetFreshness)
  /** Error del servidor que no es de conexión. */
  | { state: 'error'; error: unknown }
  /** Sin conexión y la lista nunca se guardó en este dispositivo. */
  | { state: 'offline_unavailable' }
  /** Sin conexión y la copia del dispositivo no se pudo leer. */
  | { state: 'local_error'; error: unknown };

export type PetDetailView =
  | { state: 'loading' }
  | ({ state: 'ready'; pet: Pet } & PetFreshness)
  /** El servidor dice que no existe o que no hay acceso. */
  | { state: 'not_found' }
  /** Sin conexión; la última vez que se comprobó, el servidor ya no la devolvía (copia conservada). */
  | { state: 'unavailable'; snapshot: PetSnapshot }
  | { state: 'error'; error: unknown }
  /** Sin conexión y esta mascota nunca se guardó en este dispositivo. */
  | { state: 'offline_unavailable' }
  | { state: 'local_error'; error: unknown };

type Offline<L> =
  | { kind: 'remote_data' }
  | { kind: 'loading' }
  | { kind: 'error'; error: unknown }
  | { kind: 'local'; local: LocalQuery<L> };

function staleness(input: PetViewInput<unknown, unknown>): PetFreshness {
  const { remote, serverUsable, isOfflineError } = input;
  const stale = !serverUsable || (remote.status === 'error' && isOfflineError(remote.error));
  return {
    source: 'server',
    stale,
    savedAt: stale && remote.dataUpdatedAt > 0 ? new Date(remote.dataUpdatedAt).toISOString() : null,
  };
}

function classify<R, L>(input: PetViewInput<R, L>): Offline<L> {
  const { remote, local, serverUsable, isOfflineError } = input;
  if (remote.data !== undefined) return { kind: 'remote_data' };
  if (remote.status === 'error' && !isOfflineError(remote.error)) return { kind: 'error', error: remote.error };
  const offline = remote.status === 'error' || !serverUsable;
  if (!offline) return { kind: 'loading' };
  return { kind: 'local', local };
}

export function resolvePetListView(input: PetViewInput<Pet[], LocalPetList>): PetListView {
  const kind = classify(input);
  if (kind.kind === 'remote_data') return { state: 'ready', pets: input.remote.data!, ...staleness(input) };
  if (kind.kind === 'loading') return { state: 'loading' };
  if (kind.kind === 'error') return { state: 'error', error: kind.error };

  const { local } = kind;
  if (local.status === 'error') return { state: 'local_error', error: local.error };
  if (local.status === 'pending' || local.data === undefined) return { state: 'loading' };
  if (local.data.status === 'never_loaded') return { state: 'offline_unavailable' };
  return { state: 'ready', pets: local.data.pets, source: 'device', stale: true, savedAt: local.data.savedAt };
}

export function resolvePetDetailView(input: PetViewInput<Pet | null, PetSnapshot | null>): PetDetailView {
  const kind = classify(input);
  if (kind.kind === 'remote_data') {
    const pet = input.remote.data!;
    return pet === null ? { state: 'not_found' } : { state: 'ready', pet, ...staleness(input) };
  }
  if (kind.kind === 'loading') return { state: 'loading' };
  if (kind.kind === 'error') return { state: 'error', error: kind.error };

  const { local } = kind;
  if (local.status === 'error') return { state: 'local_error', error: local.error };
  if (local.status === 'pending' || local.data === undefined) return { state: 'loading' };
  const snapshot = local.data;
  if (snapshot === null) return { state: 'offline_unavailable' };
  if (snapshot.unavailableAt !== null) return { state: 'unavailable', snapshot };
  return { state: 'ready', pet: snapshot.pet, source: 'device', stale: true, savedAt: snapshot.savedAt };
}

/**
 * La ficha con la forma de una query (`data`/`isError`/`error`), para las pantallas que solo
 * necesitan el nombre y distinguir «sin conexión» (registro diario, `daily-log-pet-context.ts`):
 * - copia o servidor → `data` = mascota; no existe, o no disponible según la copia → `data` = `null`;
 * - sin copia, o copia ilegible, sin conexión → error de conexión (`offlineError`): el registro sigue
 *   disponible sin el nombre, como antes de existir la copia.
 */
export function petDetailAsQuery(
  view: PetDetailView,
  offlineError: unknown
): { data: Pet | null | undefined; isPending: boolean; isError: boolean; error: unknown } {
  switch (view.state) {
    case 'ready':
      return { data: view.pet, isPending: false, isError: false, error: null };
    case 'not_found':
    case 'unavailable':
      return { data: null, isPending: false, isError: false, error: null };
    case 'error':
      return { data: undefined, isPending: false, isError: true, error: view.error };
    case 'offline_unavailable':
    case 'local_error':
      return { data: undefined, isPending: false, isError: true, error: offlineError };
    case 'loading':
      return { data: undefined, isPending: true, isError: false, error: null };
  }
}

/** Estado de la foto de cabecera o del avatar. `photo_path` no se toca nunca por un fallo al mostrarla. */
export type PetPhotoState =
  | { state: 'none' }
  | { state: 'loading' }
  | { state: 'ready'; url: string; cacheKey: string }
  /** Sin conexión, sin sesión utilizable o la imagen no se pudo descargar (p. ej. URL caducada). */
  | { state: 'unavailable' }
  | { state: 'error'; error: unknown };

export function resolvePetPhotoState({
  photoPath,
  url,
  imageFailed,
  isOfflineError,
}: {
  photoPath: string | null;
  url: { status: 'pending' | 'success' | 'error'; data: string | undefined; error: unknown };
  /** La descarga de la imagen con la URL actual falló. */
  imageFailed: boolean;
  isOfflineError: (error: unknown) => boolean;
}): PetPhotoState {
  if (photoPath === null) return { state: 'none' };
  if (url.data !== undefined && !imageFailed) return { state: 'ready', url: url.data, cacheKey: photoPath };
  if (imageFailed) return { state: 'unavailable' };
  if (url.status === 'error') return isOfflineError(url.error) ? { state: 'unavailable' } : { state: 'error', error: url.error };
  return { state: 'loading' };
}

/** «Actualizado: 20 oct, 14:05» (en el idioma activo). `null` si no se puede formatear. */
export function formatSavedAt(savedAt: string | null, locale: string): string | null {
  if (!savedAt) return null;
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
}
